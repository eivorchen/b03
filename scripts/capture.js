import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '../src/config.js';
import { seededRandom, generateSource } from '../src/engine.js';

// Reproducible visual evidence against the local preview, using an isolated browser.
const output=new URL(`../docs/screenshots/${DEFAULT_CONFIG.version}/`,import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce',colorScheme:'light'});
  const page=await context.newPage();
  async function capture(name) {
    await page.evaluate(()=>document.fonts.ready);
    await page.evaluate(()=>window.scrollTo(0,0));
    if(await page.locator('.marker-glyph text').count()) {
      // ResizeObserver updates SVG glyph scale after viewport changes.
      await expect.poll(()=>page.locator('.marker-glyph text').first().evaluate(el=>{
        const matrix=el.getScreenCTM();
        return Math.round(parseFloat(getComputedStyle(el).fontSize)*Math.hypot(matrix.a,matrix.b));
      })).toBe(16);
    }
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.screenshot({path:fileURLToPath(new URL(name,output)),fullPage:true});
  }
  async function capturePress(name) {
    await page.emulateMedia({reducedMotion:'no-preference'});
    const button=page.locator('[data-action="start"]');
    const box=await button.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.down();
    await expect(button).toHaveClass(/\bis-pressed\b/);
    await capture(name);
    // Cancel outside the button so a screenshot does not start a round.
    await page.mouse.move(0,0);await page.mouse.up();
    await page.emulateMedia({reducedMotion:'reduce'});
  }
  await page.goto('http://127.0.0.1:4173/b03/?seed=acceptance-visual');
  await page.locator('#app').waitFor({state:'visible'});
  await capture('desktop-home-light.png');
  await capturePress('desktop-press-light.png');
  await page.locator('.theme-switch [data-theme="dark"]').click();
  await capture('desktop-home-dark.png');
  await capturePress('desktop-press-dark.png');
  await page.locator('.theme-switch [data-theme="light"]').click();
  await page.locator('[data-level="2"]').click();
  await page.locator('[data-action="start"]').click();
  await expect(page.locator('.game-meta .pill')).toHaveText(`已用 0 / ${DEFAULT_CONFIG.measurements} 次`);
  async function select(point) {
    const field=page.locator('#field');await field.scrollIntoViewIfNeeded();
    const box=await field.boundingBox();
    await field.click({position:{x:point.x/1600*box.width,y:point.y/1000*box.height}});
  }
  let count=0;
  const points=[{x:180,y:140},{x:1400,y:140},{x:180,y:860},{x:1400,y:860}];
  for(const point of points.slice(0,2)) {
    await select(point);await page.locator('[data-action="measure"]').click();
    count++;
    await page.locator(`button[data-record="${count-1}"]`).waitFor({state:'visible'});
  }
  await select(points[2]);
  await page.setViewportSize({width:390,height:844});
  await capture('mobile-light.png');
  await page.locator('.theme-switch [data-theme="dark"]').click();
  await capture('mobile-dark.png');
  await page.setViewportSize({width:320,height:740});
  await capture('narrow-dark.png');
  await page.setViewportSize({width:844,height:390});
  await capture('landscape-dark.png');
  await page.setViewportSize({width:1280,height:900});
  for(const point of points.slice(2,DEFAULT_CONFIG.measurements)) {
    await select(point);await page.locator('[data-action="measure"]').click();
    count++;
    await page.locator(`button[data-record="${count-1}"]`).waitFor({state:'visible'});
  }
  await select(generateSource(2,DEFAULT_CONFIG,seededRandom('acceptance-visual')));
  await page.locator('[data-action="submit"]').click();
  await page.locator('.result-panel').waitFor({state:'visible'});
  await capture('desktop-result-dark.png');
  await page.locator('.theme-switch [data-theme="light"]').click();
  await capture('desktop-result-light.png');
  const environment={date:new Date().toISOString(),version:DEFAULT_CONFIG.version,browser:browser.version(),node:process.version,platform:process.platform,arch:process.arch,viewports:['1280x900','390x844','320x740','844x390'],themes:['light','dark'],url:'http://127.0.0.1:4173/b03/',note:'本机 Chrome 与尺寸模拟；不代表真手机或微信验收。'};
  await writeFile(new URL('environment.json',output),JSON.stringify(environment,null,2)+'\n');
  console.log(JSON.stringify(environment));
} finally {await browser.close();}
