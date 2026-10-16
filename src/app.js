import { DEFAULT_CONFIG } from './config.js';
import { GameSession } from './session.js';
import { distance, signal, meter, seededRandom, wallForLevel, readingReferences } from './engine.js';

const $ = (selector) => document.querySelector(selector);
const root = $('#app');
const game = new GameSession();
const params = new URLSearchParams(location.search);
const random = params.has('seed') ? seededRandom(params.get('seed')) : Math.random;
let level = 1;
let screen = 'home';
let demo = null;
let selectedRecord = -1;
let notice = '';
let lastPhase = '';
let lastClock = '';
let mapObserver = null;
const titles = { 1: '基础定位', 2: '隔墙寻源' };
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = ms => `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}`;
const button = (action, text, kind = 'secondary', disabled = false) => `<button class="button ${kind}" data-action="${action}" ${disabled ? 'disabled' : ''}>${text}</button>`;

function header() {
  return `<header class="site-header"><button class="brand" data-action="home" aria-label="信号寻踪，返回开始页"><span class="brand-mark">↗</span><span class="brand-copy">信号寻踪</span></button><span class="version">B03 · v${DEFAULT_CONFIG.version}</span></header>`;
}
function footer() {
  return screen==='home'?'<footer class="site-footer">核能文化节</footer>':'';
}
function helpPanel(n, c) {
  return `<details class="help"><summary>玩法说明</summary><p>点击地图选点，再确认测量。用完 ${c.measurements} 次后，标出源位置并提交。</p>${n===2?`<p>信号穿过屏障时，源贡献 ×${c.wallTransmission}，背景不变。读数较低，也可能是被屏障挡住。</p>`:''}<p>读数和强度条使用固定尺度。地图装饰不影响信号；悬停、拖动不会产生读数。</p><p class="keyboard-help">也可用方向键微调位置，Enter 选定，Esc 取消。</p></details>`;
}
function home() {
  const c = game.nextConfig;
  return `<main class="home-grid"><section class="hero-copy"><h1 class="hero-title">寻找<span>隐藏的源</span></h1><p class="lede">比较不同位置的信号，标出你认为的源位置。</p><div class="level-list" role="group" aria-label="选择关卡">${[1,2].map(n=>`<button class="level-option" data-level="${n}" aria-pressed="${level===n}"><span class="level-no">0${n}</span><span class="level-body"><strong>${titles[n]}</strong><span>${n===1?'无屏障':'一道屏障'}</span></span></button>`).join('')}</div><p class="round-summary"><span>${c.measurements} 次测量</span><span>每次 ${c.measurementMs/1000} 秒</span></p><div class="home-actions">${button('start','开始寻踪','primary')}${button('demo','演示')}</div><div class="home-details"><details class="settings"><summary>设置</summary><label>每关测量次数 <select id="measurements" aria-label="每关测量次数">${[3,4,5].map(n=>`<option value="${n}" ${c.measurements===n?'selected':''}>${n} 次${n===DEFAULT_CONFIG.measurements?'（默认）':''}</option>`).join('')}</select></label><label>每次测量等待 <select id="measurement-ms" aria-label="每次测量等待">${[1000,3000].map(n=>`<option value="${n}" ${c.measurementMs===n?'selected':''}>${n/1000} 秒${n===DEFAULT_CONFIG.measurementMs?'（默认）':''}</option>`).join('')}</select></label></details>${helpPanel(level,c)}</div></section><aside class="home-visual" aria-hidden="true"><svg viewBox="0 0 580 600"><path d="M40 410 Q150 460 210 330 T440 220 T550 90" fill="none" stroke="#d9dfd2" stroke-width="100"/><path d="M20 510 Q130 550 230 430 T530 350 M60 80 Q200 20 270 160 T550 200" class="poster-line"/><path d="M90 120 L425 180 L180 335 L380 470" fill="none" stroke="#9aab9d" stroke-dasharray="4 12" stroke-width="2"/>${[{x:90,y:120,n:'01',w:40},{x:425,y:180,n:'02',w:80},{x:180,y:335,n:'03',w:130},{x:380,y:470,n:'04',w:105}].map(p=>`<g transform="translate(${p.x} ${p.y})"><rect x="-8" y="-8" width="16" height="16" rx="3" fill="#b54e24"/><text x="18" y="5" class="poster-label">${p.n}</text><rect x="-30" y="30" width="150" height="5" fill="#dee1d7"/><rect x="-30" y="30" width="${p.w}" height="5" fill="#567261"/></g>`).join('')}</svg></aside></main>`;
}

function baseMap(config) {
  const { width:w, height:h } = config;
  return `<rect class="map-land" width="${w}" height="${h}"/><g transform="scale(${w/1600} ${h/1000})" aria-hidden="true"><path class="map-river" d="M-100 760 C300 720 330 990 710 880 S1150 560 1700 700"/><path class="map-contour" d="M-70 240 Q250 60 480 220 T930 130 T1700 230 M-70 300 Q250 120 480 280 T930 190 T1700 290 M-70 360 Q250 180 480 340 T930 250 T1700 350"/><path class="map-path" d="M170 0 L270 380 L130 740 L190 1000 M0 530 Q450 430 640 550 T1600 420 M1350 0 L1270 410 L1380 1000"/></g>`;
}
function mapUnitsPerPixel(config) {
  const width = $('#field')?.getBoundingClientRect().width || Math.min(800, window.innerWidth - 36);
  return config.width / Math.max(1, width);
}
function marker(point, type, label, extra = '') {
  const x=Number(point.x), y=Number(point.y);
  const config=screen==='demo'?demo.config:game.state.config;
  const units=mapUnitsPerPixel(config), edge=Array.from(String(label)).length*8+10;
  const labelY=type==='guess' && game.state.phase==='result' ? (y>config.height-34*units?-34:25) : (y<28*units?25:-18);
  const labelX=x<edge*units?8:x>config.width-edge*units?-8:0;
  const anchor=x<edge*units?'start':x>config.width-edge*units?'end':'middle';
  const shape=type==='true-source'?'<path d="M0 -9 L3 -3 L9 0 L3 3 L0 9 L-3 3 L-9 0 L-3 -3 Z"/>':type==='guess'?'<path d="M0 -8 L8 0 L0 8 L-8 0 Z"/>':'<rect x="-6" y="-6" width="12" height="12" rx="3"/>';
  return `<g class="${type} ${extra}" transform="translate(${x} ${y})"><g class="marker-glyph" transform="scale(${units})">${shape}<text x="${labelX}" y="${labelY}" text-anchor="${anchor}">${escape(label)}</text></g></g>`;
}
function mapHTML() {
  const s=game.state;
  const c=screen==='demo'?demo.config:s.config;
  const wall=screen==='demo'?(demo.wallVisible?wallForLevel(demo.level,c):null):wallForLevel(s.level,c);
  const units=mapUnitsPerPixel(c);
  let layers='',pathLabels='';
  if(screen==='game' && s.phase==='result') {
    const src=s.source;
    if(s.level===2) {
      layers+=s.records.map(r=>`<path class="source-path ${r.attenuated?'blocked':''}" d="M${src.x} ${src.y} L${r.point.x} ${r.point.y}"/>`).join('');
      pathLabels=s.records.map((r,i)=>r.attenuated?`<text class="path-label" text-anchor="middle" transform="translate(${Math.max(52*units,Math.min(c.width-52*units,(src.x+r.point.x)/2))} ${Math.max(20*units,(src.y+r.point.y)/2-12*units)}) scale(${units})">${i+1} · ×${c.wallTransmission}</text>`:'').join('');
    }
    layers+=`<path class="result-line" d="M${src.x} ${src.y} L${s.guess.x} ${s.guess.y}"/>`;
    if(s.result.status==='reasonable' && s.result.candidate) layers+=marker(s.result.candidate,'candidate','有效候选');
  }
  if(wall) layers+=`<rect class="wall" x="${wall.x}" y="${wall.y}" width="${wall.width}" height="${wall.height}"/><text class="wall-label" transform="translate(${wall.x+wall.width+8*units} ${wall.y+18*units}) scale(${units})">屏障</text>`;
  layers+=pathLabels;
  if(screen==='demo') {
    layers+=marker(demo.source,'true-source','已知源')+marker(demo.point,'measurement','演示测点');
  } else {
    layers+=s.records.map((r,i)=>marker(r.point,'measurement',String(i+1),selectedRecord===i?'selected':'')).join('');
    if(s.pending) layers+=marker(s.pending,'pending',s.phase==='measuring'?'测量中':'待测');
    if(s.guess) layers+=marker(s.guess,'guess','你的定位');
    if(s.phase==='result') layers+=marker(s.source,'true-source','真实源');
  }
  return `${baseMap(c)}${layers}`;
}
function signalReference(config, currentLevel) {
  const references=readingReferences(config);
  const ticks=references.filter(r=>r.distance!==null && r.distance<=config.width).sort((a,b)=>a.distance-b.distance);
  const outside=references.filter(r=>r.distance===null || r.distance>config.width);
  return `<section class="signal-reference" aria-label="固定信号距离参考"><div class="reference-heading"><h2>无遮挡距离参考</h2><span class="reference-formula">强度 ∝ 1/r<sup>2</sup><small>远距离近似</small></span></div><div class="reference-ruler"><span class="reference-origin">距源 0</span>${ticks.map(r=>`<span class="reference-tick" data-reading="${r.value}" style="left:${r.distance/config.width*100}%"><span class="reference-tick-label"><strong>读数 ${r.value}</strong><small>${r.ratio.toFixed(2)}×短边</small></span></span>`).join('')}</div><p class="reference-outside">${outside.map(r=>r.distance===null?`读数 ${r.value}：当前参数下不可达`:`读数 ${r.value} → ${r.ratio.toFixed(2)}×短边（${r.exceedsMap?'超出地图范围':'超出尺长'}）`).join('；')}</p><p class="reference-note">尺长与地图同尺度；r 为到源距离。${currentLevel===2?`<br>穿墙后源信号 ×${config.wallTransmission}，背景不变。`:''}</p></section>`;
}
function field() {
  const c=screen==='demo'?demo.config:game.state.config;
  const currentLevel=screen==='demo'?demo.level:game.state.level;
  const reveal=screen==='demo'||game.state.phase==='result';
  return `<section class="map-panel"><div class="map-surface" style="--map-ratio:${c.width/c.height}">${signalReference(c,currentLevel)}<div class="map-wrap"><svg id="field" viewBox="0 0 ${c.width} ${c.height}" role="img" aria-label="${screen==='demo'?'已知源演示地图':'连续地图，点击选择位置；方向键可微调，Enter选定'}" tabindex="${screen==='demo'?'-1':'0'}">${mapHTML()}</svg></div>${reveal?`<div class="map-caption"><span class="legend">■ 测点　◇ 你的定位　✦ 信号源</span>${currentLevel===2?`<span>穿墙路径标注：源信号 ×${c.wallTransmission}</span>`:''}</div>`:''}</div></section>`;
}
function displayValue(value, records, config) {
  let decimals=config.displayDecimals;
  // Keep close but distinct recorded values distinguishable without changing them.
  while(decimals<6 && records.some(r=>Math.abs(r.value-value)>1e-9 && r.value.toFixed(decimals)===value.toFixed(decimals))) decimals++;
  return value.toFixed(decimals);
}
function formatDifference(value, config) {
  let decimals=config.displayDecimals;
  while(decimals<6 && Number(value.toFixed(decimals))===0 && value>0)decimals++;
  return value.toFixed(decimals);
}
function instrument() {
  const s=game.state, isDemo=screen==='demo', c=isDemo?demo.config:s.config;
  const records=isDemo?[]:s.records;
  const last=isDemo?demo.reading:records.at(-1)?.value;
  const previous=records.at(-2)?.value;
  let comparison=isDemo?demo.caption:'';
  if(!isDemo && records.length===1) comparison='已记录测点 1';
  if(previous!==undefined) {
    const difference=last-previous;
    comparison=Math.abs(difference)<1e-9?`与测点 ${records.length-1} 相同`:`比测点 ${records.length-1} ${difference>0?'增强':'减弱'} ${formatDifference(Math.abs(difference),c)}`;
    if(Math.abs(difference)>1e-9 && Math.abs(difference)<.1) comparison+= '（差异很小）';
  }
  return `<section class="instrument" aria-label="信号仪表"><div class="instrument-top"><span>信号读数</span><span class="badge">固定量程</span></div><div class="reading" id="reading">${last===undefined?'—':displayValue(last,records,c)}</div><div class="meter-track"><div id="meter-fill" class="meter-fill" style="width:${last===undefined?0:meter(last,c)*100}%"></div></div><div class="meter-scale"><span>弱</span><span>强</span></div><p class="comparison" id="comparison" aria-live="polite">${escape(comparison)}</p></section>`;
}
function recordsPanel() {
  const s=game.state,c=s.config,records=s.records;
  const max=records.length?Math.max(...records.map(r=>r.value)):0;
  return `<section class="records-panel" aria-label="测量记录"><h2>测量记录</h2><div class="records">${Array.from({length:c.measurements},(_,i)=>{
    const r=records[i];
    return r?`<button class="record ${selectedRecord===i?'active':''}" data-record="${i}" aria-label="查看测点 ${i+1}，读数 ${displayValue(r.value,records,c)}"><span class="record-no">${String(i+1).padStart(2,'0')}</span><span class="record-content"><span class="record-reading">${displayValue(r.value,records,c)} ${Math.abs(r.value-max)<1e-9?'<small>最强</small>':''}</span><span class="record-meter"><span style="width:${meter(r.value,c)*100}%"></span></span></span></button>`:`<div class="record empty"><span class="record-no">${String(i+1).padStart(2,'0')}</span><span>—</span></div>`;
  }).join('')}</div></section>`;
}
function collinearHint(s) {
  if(s.phase!=='select'||s.records.length!==s.config.measurements-1||!s.pending||s.records.length<2) return '';
  const points=[...s.records.map(r=>r.point),s.pending];
  let a=points[0],b=points[1],span=distance(a,b);
  for(const p of points) for(const q of points) if(distance(p,q)>span){a=p;b=q;span=distance(p,q);}
  const offset=p=>Math.abs((b.y-a.y)*p.x-(b.x-a.x)*p.y+b.x*a.y-b.y*a.x)/span;
  return points.every(p=>offset(p)<Math.min(s.config.width,s.config.height)*s.config.collinearRatio)?'换个方向测量，可能更容易判断。':'';
}
function actions() {
  const s=game.state;
  if(s.phase==='result') return result();
  if(s.phase==='error') return `<section class="action-panel" role="alert"><p class="status-copy">判定暂时遇到问题</p><p class="hint">${escape(s.error)} 记录已保留，本局不记为失败。</p><div class="button-row">${button('retry-judgement','重试判定','primary')}${button('restart','重玩')}${button('home','返回','quiet')}</div></section>`;
  const measuring=s.phase==='measuring', locating=s.phase==='locate';
  const text=measuring?'测量中…':locating?(s.guess?'位置已选好，确认定位。':'在地图上标出源的位置。'):s.pending?'测点已选好。':'点击地图，选择测点。';
  return `<section class="action-panel"><p class="status-copy" role="status">${text}</p>${measuring?'<div class="progress-track" role="progressbar" aria-label="测量进度" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" id="measurement-progress"></div></div>':''}<p class="hint" aria-live="polite">${escape(notice||collinearHint(s))}</p><div class="button-row">${locating?button('submit','确认定位','primary',!s.guess):button('measure',measuring?'测量中…':'确认测量','primary',measuring||!s.pending)}${button('cancel','取消选点','quiet',measuring||!(s.pending||s.guess))}</div><div class="utility-actions">${button('restart','重玩','quiet')}${button('switch','换关','quiet')}${button('home','返回','quiet')}</div></section>`;
}
function result() {
  const s=game.state,r=s.result;
  let feedback=r.status==='reasonable'?'你的定位符合全部测量，现有信息尚不能区分。':r.status==='success'?'你找到了信号源。':r.status==='near'?'你已接近测量支持的位置。':'下次试着从不同方向测量。';
  if(r.candidates.length>1 && r.status!=='reasonable') feedback+=' 本局存在多个有效位置，现有信息尚不能区分。';
  if(s.level===2) feedback+=' 穿墙路径已标出。';
  return `<section class="result-panel" aria-label="定位结果"><h2 class="result-title">${escape(r.label)}</h2><div class="result-stats"><div><strong data-metric="source-error">${r.errorPercent.toFixed(2)}%</strong><span>距真源偏差</span></div>${r.candidates.length>1?`<div><strong data-metric="candidate-error">${r.nearestPercent.toFixed(2)}%</strong><span>距最近有效位置</span></div>`:''}<div><strong>${time(r.elapsedMs)}</strong><span>${s.used} 次测量 · 用时</span></div></div><p class="metric-note">偏差占地图短边的比例，越低越准。</p><p class="result-feedback">${feedback}</p><div class="result-actions">${button('restart','再玩本关','primary')}${button('switch','另一关')}${button('demo','演示','quiet')}${button('home','返回','quiet')}</div></section>`;
}
function gameView() {
  const s=game.state;
  return `<main class="game-view"><div class="game-heading"><h1 class="game-title">${titles[s.level]}</h1><div class="game-meta"><span class="pill">已用 ${s.used} / ${s.config.measurements} 次</span><span class="clock" id="clock">${time(game.elapsed())}</span></div></div><div class="play-layout">${field()}<aside class="readout-column">${s.phase==='result'?'':instrument()}${actions()}${recordsPanel()}${helpPanel(s.level,s.config)}</aside></div></main>`;
}
function demoView() {
  return `<main class="game-view"><div class="game-heading"><h1 class="game-title">${demo.level===1?'距离与读数':'屏障与读数'}</h1><span class="pill">演示 · <span id="demo-time">${Math.ceil(demo.config.demoMs/1000)}</span> 秒</span></div><div class="play-layout">${field()}<aside class="readout-column">${instrument()}<section class="demo-panel"><div class="progress-track"><div class="progress-fill" id="demo-progress"></div></div><div class="button-row">${button('start','开始挑战','primary')}${button('replay-demo','重看','quiet')}${button('demo-back','返回','quiet')}</div></section>${helpPanel(demo.level,demo.config)}</aside></div></main>`;
}
function render() {
  mapObserver?.disconnect();
  root.innerHTML=header()+(screen==='home'?home():screen==='demo'?demoView():gameView())+footer();
  lastPhase=game.state.phase;
  bindMap();
  const map=$('#field');
  if(map) {
    // SVG positions stay in game units; glyphs and text keep a readable CSS-pixel size.
    const redraw=()=>{if(map.isConnected)map.innerHTML=mapHTML();};
    redraw();
    mapObserver=new ResizeObserver(redraw);
    mapObserver.observe(map);
  }
}
function start() {
  demo=null;screen='game';selectedRecord=-1;notice='';game.start(level,{rng:random});render();window.scrollTo(0,0);
}
function showDemo() {
  const returnScreen=screen==='demo'?demo.returnScreen:screen;
  const c=game.nextConfig;
  demo={level,config:c,source:{x:c.width*.25,y:c.height*.5},point:{x:c.width*.72,y:c.height*.5},wallVisible:false,startedAt:performance.now(),returnScreen,reading:0,caption:''};
  screen='demo';updateDemo(performance.now());render();window.scrollTo(0,0);
}
function updateDemo(now) {
  const d=demo,c=d.config,t=Math.min(1,(now-d.startedAt)/c.demoMs);
  if(d.level===1) {
    const phase=Math.min(2,Math.floor(t*3));
    const positions=[.83,.53,.35];
    d.point={x:c.width*positions[phase],y:c.height*.55};d.wallVisible=false;
    d.caption=['距离较远，信号较弱。','靠近源，信号增强。','继续靠近，信号更强。'][phase];
  } else {
    d.wallVisible=t>=.42;
    d.caption=d.wallVisible?`加入屏障：源贡献 ×${c.wallTransmission}，背景不变。`:'先看无屏障时的读数。';
  }
  d.reading=signal(d.source,d.point,d.wallVisible?2:1,c).value;
  if($('#field')&&$('#demo-progress')&&screen==='demo') {
    $('#field').innerHTML=mapHTML();
    $('#reading').textContent=displayValue(d.reading,[],c);
    $('#meter-fill').style.width=`${meter(d.reading,c)*100}%`;
    if($('#comparison').textContent!==d.caption) $('#comparison').textContent=d.caption;
    $('#demo-time').textContent=String(Math.ceil((1-t)*c.demoMs/1000));
    $('#demo-progress').style.width=`${t*100}%`;
  }
  if(t===1 && $('#demo-time')) $('#demo-time').textContent='0（演示完成）';
}
root.addEventListener('click', event=>{
  const target=event.target.closest('button');if(!target||target.disabled)return;
  if(target.dataset.level){level=Number(target.dataset.level);render();return;}
  if(target.dataset.record!==undefined){selectedRecord=Number(target.dataset.record);render();return;}
  const action=target.dataset.action;
  notice='';
  if(action==='start'||action==='restart') start();
  else if(action==='switch'){level=level===1?2:1;start();}
  else if(action==='home'){demo=null;screen='home';game.resetToHome();render();window.scrollTo(0,0);}
  else if(action==='demo'||action==='replay-demo')showDemo();
  else if(action==='demo-back'){screen=demo.returnScreen;demo=null;render();window.scrollTo(0,0);}
  else if(action==='measure'){game.beginMeasurement(performance.now());render();}
  else if(action==='cancel'){game.cancelSelection();render();}
  else if(action==='submit'){game.submit(performance.now());render();}
  else if(action==='retry-judgement'){game.retryJudgement(performance.now());render();}
});
root.addEventListener('change', event=>{
  if(event.target.id==='measurements')game.configure({measurements:Number(event.target.value)});
  if(event.target.id==='measurement-ms')game.configure({measurementMs:Number(event.target.value)});
  // Preserve the settings disclosure while updating configuration-dependent copy.
  const open=$('.settings')?.open;render();if(open&&$('.settings'))$('.settings').open=true;
});
function choose(point) {
  if(screen!=='game'||!['select','locate'].includes(game.state.phase))return;
  if(!game.select(point)){game.cancelSelection();notice='请避开屏障和已有测点。';}
  else notice='';
  render();
}
function bindMap() {
  const field=$('#field');if(!field||screen!=='game')return;
  const pointers=new Map();let multi=false;
  field.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size>1)multi=true;
    if(event.isTrusted)field.setPointerCapture?.(event.pointerId);
  });
  field.addEventListener('pointercancel',event=>{pointers.delete(event.pointerId);multi=pointers.size>0;});
  field.addEventListener('pointerup',event=>{
    const down=pointers.get(event.pointerId);pointers.delete(event.pointerId);
    if(!down)return;
    const reject=multi||Math.hypot(event.clientX-down.x,event.clientY-down.y)>10;
    if(!pointers.size)multi=false;
    if(reject)return;
    const bounds=field.getBoundingClientRect(),c=game.state.config;
    choose({x:(event.clientX-bounds.left)/bounds.width*c.width,y:(event.clientY-bounds.top)/bounds.height*c.height});
  });
  field.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter','Escape'].includes(event.key))return;
    event.preventDefault();
    if(event.key==='Escape'){game.cancelSelection();render();$('#field')?.focus();return;}
    if(!['select','locate'].includes(game.state.phase))return;
    const s=game.state,c=s.config,p={...(s.pending||s.guess||{x:c.width*.3,y:c.height*.5})};
    const step=Math.min(c.width,c.height)*(event.shiftKey?.001:.01);
    if(event.key==='ArrowLeft')p.x-=step;if(event.key==='ArrowRight')p.x+=step;
    if(event.key==='ArrowUp')p.y-=step;if(event.key==='ArrowDown')p.y+=step;
    choose(p);$('#field')?.focus();
  });
}
function frame(now) {
  if(screen==='demo')updateDemo(now);
  if(screen==='game') {
    game.tick(now);
    if(game.state.phase!==lastPhase)render();
    const clock=time(game.elapsed(now));
    if(clock!==lastClock&&$('#clock')){$('#clock').textContent=clock;lastClock=clock;}
    const s=game.state;
    if(s.phase==='measuring'&&$('#measurement-progress')) {
      const p=Math.max(0,Math.min(100,(now-s.measurementStartedAt)/(s.measurementDeadline-s.measurementStartedAt)*100));
      $('#measurement-progress').style.width=`${p}%`;
      $('#measurement-progress').parentElement.setAttribute('aria-valuenow',String(Math.round(p)));
    }
  }
  requestAnimationFrame(frame);
}
render();
requestAnimationFrame(frame);
