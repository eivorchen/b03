import { DEFAULT_CONFIG } from './config.js';
import { GameSession } from './session.js';
import { distance, signal, meter, seededRandom, wallForLevel } from './engine.js';

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
const titles = { 1: '基础定位', 2: '隔墙寻源' };
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = ms => `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}`;
const button = (action, text, kind = 'secondary', disabled = false) => `<button class="button ${kind}" data-action="${action}" ${disabled ? 'disabled' : ''}>${text}</button>`;

function header() {
  return `<header class="site-header"><button class="brand" data-action="home" aria-label="信号寻踪，返回开始页"><span class="brand-mark">↗</span><span class="brand-copy">信号寻踪<span class="eyebrow">SIGNAL TRACE / B03</span></span></button><div class="version"><span class="status-dot"></span> 核能文化节 <span>v${DEFAULT_CONFIG.version}</span></div></header>`;
}
function footer() {
  return `<footer class="site-footer"><span>工物系核能文化节 · 一次关于信息与判断的小实验</span><span>模拟信号 · 全程无声 · 无需登录</span></footer>`;
}
function home() {
  const c = game.nextConfig;
  return `<main class="home-grid"><section class="hero-copy"><p class="eyebrow">FIELD EXPERIMENT 003</p><h1 class="hero-title">看见读数，<br>找到<span>隐藏的源。</span></h1><p class="lede">地图里藏着一个信号源。选 ${c.measurements} 个地方测一下，比较信号的强弱，最后标出你认为它所在的位置。</p><div class="facts"><div class="fact"><strong>${c.measurements}</strong><span>次测量机会</span></div><div class="fact"><strong>2</strong><span>种寻踪挑战</span></div><div class="fact"><strong>≈ 1 min</strong><span>每关体验 · 不限时</span></div></div><div class="level-list" role="group" aria-label="选择关卡">${[1,2].map(n=>`<button class="level-option" data-level="${n}" aria-pressed="${level===n}"><span class="level-no">0${n}</span><span class="level-body"><strong>${titles[n]}</strong><span>${n===1?'从远近与强弱中寻找线索':'加入一道屏障，重新理解读数'}</span></span><span aria-hidden="true">↗</span></button>`).join('')}</div><p class="level-rule">${level===2?`屏障让源贡献 ×${c.wallTransmission}，背景不变。读数低，也可能是被挡住了。`:`比较不同位置的信号，${c.measurements} 次测量后自由标出源位置。`}</p><div class="home-actions">${button('start','开始寻踪 ↗','primary')}${button('demo',`先看演示 · ${c.demoMs/1000} 秒`)}</div><details class="settings"><summary>试玩设置</summary><label>每关测量次数 <select id="measurements" aria-label="每关测量次数">${[3,4,5].map(n=>`<option value="${n}" ${c.measurements===n?'selected':''}>${n} 次</option>`).join('')}</select></label><label>每次测量等待 <select id="measurement-ms" aria-label="每次测量等待">${[1000,3000].map(n=>`<option value="${n}" ${c.measurementMs===n?'selected':''}>${n/1000} 秒${n===3000?'（默认）':''}</option>`).join('')}</select></label><p>仅作用于下一局。首轮建议保留三次测量、三秒等待。</p></details></section><aside class="home-visual" aria-label="玩法示意：三次读数提供线索"><div class="eyebrow">OBSERVE · COMPARE · LOCATE</div><svg viewBox="0 0 580 600" role="img" aria-label="三个测点的强度记录示意"><path d="M40 410 Q150 460 210 330 T440 220 T550 90" fill="none" stroke="#d9dfd2" stroke-width="100"/><path d="M20 510 Q130 550 230 430 T530 350 M60 80 Q200 20 270 160 T550 200" class="poster-line"/><path d="M90 160 L425 230 L230 430" fill="none" stroke="#9aab9d" stroke-dasharray="4 12" stroke-width="2"/>${[{x:90,y:160,n:'01',w:50},{x:425,y:230,n:'02',w:100},{x:230,y:430,n:'03',w:170}].map(p=>`<g transform="translate(${p.x} ${p.y})"><rect x="-8" y="-8" width="16" height="16" rx="3" fill="#d56c45"/><text x="18" y="5" class="poster-label">${p.n}</text><rect x="-30" y="30" width="180" height="5" fill="#dee1d7"/><rect x="-30" y="30" width="${p.w}" height="5" fill="#567261"/></g>`).join('')}<text x="36" y="570" class="poster-label">每次测量，都是一条新的线索。</text></svg><p>强，不一定更近。<br>让不同位置的读数，相互验证。</p></aside></main>`;
}

function baseMap(config) {
  const { width:w, height:h } = config;
  return `<rect class="map-land" width="${w}" height="${h}"/><g transform="scale(${w/1600} ${h/1000})" aria-hidden="true"><path class="map-river" d="M-100 760 C300 720 330 990 710 880 S1150 560 1700 700"/><path class="map-contour" d="M-70 240 Q250 60 480 220 T930 130 T1700 230 M-70 300 Q250 120 480 280 T930 190 T1700 290 M-70 360 Q250 180 480 340 T930 250 T1700 350"/><path class="map-path" d="M170 0 L270 380 L130 740 L190 1000 M0 530 Q450 430 640 550 T1600 420 M1350 0 L1270 410 L1380 1000"/><text x="48" y="70" class="map-label">B03 / FIELD</text><text x="1260" y="944" class="map-label">连续测量场</text></g>`;
}
function marker(point, type, label, extra = '') {
  const x=Number(point.x), y=Number(point.y);
  const config=screen==='demo'?demo.config:game.state.config;
  const labelY=type==='guess' && game.state.phase==='result' ? (y>config.height-65?-70:56) : (y<65?56:-33);
  const labelX=x<120?20:x>config.width-120?-20:0;
  const anchor=x<120?'start':x>config.width-120?'end':'middle';
  const shape=type==='true-source'?'<path d="M0 -24 L7 -7 L24 0 L7 7 L0 24 L-7 7 L-24 0 L-7 -7 Z"/>':type==='guess'?'<path d="M0 -22 L22 0 L0 22 L-22 0 Z"/>':'<rect x="-17" y="-17" width="34" height="34" rx="8"/>';
  return `<g class="${type} ${extra}" transform="translate(${x} ${y})">${shape}<text x="${labelX}" y="${labelY}" text-anchor="${anchor}">${escape(label)}</text></g>`;
}
function mapHTML() {
  const s=game.state;
  const c=screen==='demo'?demo.config:s.config;
  const wall=screen==='demo'?(demo.wallVisible?wallForLevel(demo.level,c):null):wallForLevel(s.level,c);
  let layers='',pathLabels='';
  if(screen==='game' && s.phase==='result') {
    const src=s.source;
    if(s.level===2) {
      layers+=s.records.map(r=>`<path class="source-path ${r.attenuated?'blocked':''}" d="M${src.x} ${src.y} L${r.point.x} ${r.point.y}"/>`).join('');
      pathLabels=s.records.map((r,i)=>`<text class="path-label" x="${(src.x+r.point.x)/2}" y="${(src.y+r.point.y)/2-14}">${i+1}${r.attenuated?` · 源 ×${c.wallTransmission}`:' · 直达'}</text>`).join('');
    }
    layers+=`<path class="result-line" d="M${src.x} ${src.y} L${s.guess.x} ${s.guess.y}"/>`;
    if(s.result.status==='reasonable' && s.result.candidate) layers+=marker(s.result.candidate,'candidate','有效候选');
  }
  if(wall) layers+=`<rect class="wall" x="${wall.x}" y="${wall.y}" width="${wall.width}" height="${wall.height}"/><text class="wall-label" x="${wall.x+wall.width+18}" y="${wall.y+40}">屏障</text>`;
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
function field() {
  const c=screen==='demo'?demo.config:game.state.config;
  const n=screen==='demo'?demo.level:game.state.level;
  return `<section class="map-panel"><div class="map-topline"><span class="eyebrow">${screen==='demo'?'DEMONSTRATION':'EXPLORATION FIELD'} / 0${n}</span><span>${n===2?'一道屏障 · 两端可选点':'无屏障 · 连续选点'}</span></div><div class="map-wrap" style="--map-ratio:${c.width/c.height}"><svg id="field" viewBox="0 0 ${c.width} ${c.height}" role="img" aria-label="${screen==='demo'?'已知源演示地图':'连续地图，点击选择位置；方向键可微调，Enter选定'}" tabindex="${screen==='demo'?'-1':'0'}">${mapHTML()}</svg></div><div class="map-caption"><span>${screen==='demo'?'演示中的读数会实时变化':'点选后再确认 · 地图装饰不影响信号'}</span><span class="legend">■ 测点　◇ 你的定位${game.state.phase==='result'||screen==='demo'?'　✦ 信号源':''}</span></div></section>`;
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
  let comparison=isDemo?demo.caption:'完成测量后，读数会保留在这里。';
  if(!isDemo && records.length===1) comparison='第一条线索已记录。换个位置，再比较。';
  if(previous!==undefined) {
    const difference=last-previous;
    comparison=Math.abs(difference)<1e-9?`与测点 ${records.length-1} 的信号相同`:`比测点 ${records.length-1} 信号${difference>0?'增强':'减弱'} ${formatDifference(Math.abs(difference),c)}`;
    if(Math.abs(difference)>1e-9 && Math.abs(difference)<.1) comparison+= '（差异很小）';
  }
  const max=records.length?Math.max(...records.map(r=>r.value)):0;
  return `<section class="instrument" aria-label="信号仪表"><div class="instrument-top"><span class="eyebrow">SIGNAL READER</span><span class="badge">固定量程</span></div><div class="reading" id="reading">${last===undefined?'—':displayValue(last,records,c)}<span class="reading-unit">模拟信号</span></div><div class="meter-track"><div id="meter-fill" class="meter-fill" style="width:${last===undefined?0:meter(last,c)*100}%"></div></div><div class="meter-scale"><span>弱</span><span>强</span></div><p class="comparison" id="comparison" aria-live="polite">${escape(comparison)}</p>${isDemo?'':`<div class="records" aria-label="测量记录">${Array.from({length:c.measurements},(_,i)=>{
    const r=records[i];
    return r?`<button class="record ${selectedRecord===i?'active':''}" data-record="${i}" aria-label="查看测点 ${i+1}，读数 ${displayValue(r.value,records,c)}"><span class="record-no">${String(i+1).padStart(2,'0')}</span><span class="record-content"><span class="record-reading">${displayValue(r.value,records,c)} ${Math.abs(r.value-max)<1e-9?'<small>最强</small>':''}</span><span class="record-meter"><span style="width:${meter(r.value,c)*100}%"></span></span></span></button>`:`<div class="record empty"><span class="record-no">${String(i+1).padStart(2,'0')}</span><span>等待测量</span></div>`;
  }).join('')}</div>`}</section>`;
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
  if(s.phase==='error') return `<section class="action-panel" role="alert"><p class="phase-label">判定暂时遇到问题</p><p class="status-copy">${escape(s.error)} 本局记录已保留，这不会被记作定位失败。</p><div class="button-row">${button('retry-judgement','重试判定','primary')}${button('restart','重新开始本关')}${button('home','返回开始页','quiet')}</div></section>`;
  const measuring=s.phase==='measuring', locating=s.phase==='locate';
  const text=measuring?'探测器正在采样，请稍候…':locating?'测量已完成，请标出信号源位置。':s.pending?'测点已选好。确认后使用一次机会。':'在地图上选一个位置，开始收集线索。';
  return `<section class="action-panel"><p class="phase-label">${measuring?'测量进行中':locating?'最后一步 / 自由定位':`第 ${s.records.length+1} 次 / 共 ${s.config.measurements} 次测量`}</p><p class="status-copy" role="status">${text}</p>${measuring?'<div class="progress-track" role="progressbar" aria-label="测量进度" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" id="measurement-progress"></div></div>':''}<p class="hint" aria-live="polite">${escape(notice||collinearHint(s))}</p><div class="button-row">${locating?button('submit','确认定位 ↗','primary',!s.guess):button('measure',measuring?'测量中…':'确认测量','primary',measuring||!s.pending)}${button('cancel','取消选点','quiet',measuring||!(s.pending||s.guess))}</div><div class="utility-actions">${button('restart','重新开始','quiet')}${button('switch','切换关卡','quiet')}${button('home','返回开始页','quiet')}</div></section>`;
}
function result() {
  const s=game.state,r=s.result,L=Math.min(s.config.width,s.config.height);
  let feedback=r.status==='reasonable'?`你的判断也符合这 ${s.config.measurements} 次测量，现有信息尚不能区分。`:r.status==='success'?'你标出的区域覆盖了真实信号源。':r.status==='near'?'你已接近测量支持的位置。下一局试着让测点分布更开。':'把不同方向的读数放在一起比较，再试一次。';
  if(r.candidates.length>1 && r.status!=='reasonable') feedback+=` 本局存在 ${r.candidates.length} 个有效位置，当前测量不能唯一确定源。`;
  if(s.level===2) feedback+=' 图中已标出每次测量的真实路径；穿墙只削弱源贡献，背景不变。';
  return `<section class="result-panel" aria-label="定位结果"><p class="eyebrow">EXPERIMENT COMPLETE</p><h2 class="result-title">${escape(r.label)}</h2><div class="result-stats"><div><strong>${(r.error/L*100).toFixed(2)}<small>%</small></strong><span>距真源 / 地图短边</span></div><div><strong>${r.error.toFixed(1)}</strong><span>逻辑距离单位</span></div><div><strong>${time(r.elapsedMs)}</strong><span>${s.used} 次测量 · 本局用时</span></div></div><p class="result-feedback">${feedback}</p><div class="result-actions">${button('restart','再玩本关 ↗','primary')}${button('switch','进入另一关')}${button('demo','重看本关演示','quiet')}${button('home','返回开始页','quiet')}</div></section>`;
}
function gameView() {
  const s=game.state;
  return `<main class="game-view"><div class="game-heading"><div><p class="eyebrow">CHALLENGE 0${s.level}</p><h1 class="game-title">${titles[s.level]}</h1></div><div class="game-meta"><span class="pill">已用 ${s.used} / ${s.config.measurements} 次</span><span class="clock" id="clock">${time(game.elapsed())}</span></div></div><div class="play-layout">${field()}<aside class="readout-column">${instrument()}${actions()}</aside></div></main>`;
}
function demoView() {
  return `<main class="game-view"><div class="game-heading"><div><p class="eyebrow">QUICK DEMONSTRATION / 不消耗正式次数</p><h1 class="game-title">${demo.level===1?'距离如何改变读数':'屏障如何影响信号'}</h1></div><span class="pill">已知源演示 · <span id="demo-time">${Math.ceil(demo.config.demoMs/1000)}</span> 秒</span></div><div class="play-layout">${field()}<aside class="readout-column">${instrument()}<section class="demo-panel"><p>这里的源是公开的。正式挑战中，只有确认测量后才会出现读数。</p><div class="progress-track"><div class="progress-fill" id="demo-progress"></div></div><div class="button-row">${button('start','跳过演示，开始','primary')}${button('replay-demo','重看','quiet')}${button('demo-back','返回','quiet')}</div></section></aside></div></main>`;
}
function render() {
  root.innerHTML=header()+(screen==='home'?home():screen==='demo'?demoView():gameView())+footer();
  lastPhase=game.state.phase;
  bindMap();
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
    d.caption=['在较远的位置，先记住这个读数。','探测器靠近，信号增强。','再靠近一些。单次读数不能给出方向。'][phase];
  } else {
    d.wallVisible=t>=.42;
    d.caption=d.wallVisible?`同一源、同一测点，加入屏障后：源贡献 ×${c.wallTransmission}，背景不变。`:'先看没有屏障时的读数。源与测点都保持不动。';
  }
  d.reading=signal(d.source,d.point,d.wallVisible?2:1,c).value;
  if($('#field')&&$('#demo-progress')&&screen==='demo') {
    $('#field').innerHTML=mapHTML();
    $('#reading').innerHTML=`${displayValue(d.reading,[],c)}<span class="reading-unit">模拟信号</span>`;
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
  if(!game.select(point)){game.cancelSelection();notice='请选择地图内、屏障以外的位置，并与已有测点保持一点距离。';}
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
