import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '../src/config.js';
import { seededRandom, generateSource } from '../src/engine.js';

// Reproducible visual evidence against the local preview, using an isolated browser.
const output=new URL('../docs/screenshots/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  const page=await context.newPage();
  await page.goto('http://127.0.0.1:4173/b03/?seed=acceptance-visual');
  await page.locator('#app').waitFor({state:'visible'});
  await page.screenshot({path:fileURLToPath(new URL('desktop-home.png',output)),fullPage:true});
  await page.locator('.settings summary').click();
  await page.locator('#measurement-ms').selectOption('1000');
  await page.locator('[data-level="2"]').click();
  await page.locator('[data-action="start"]').click();
  async function select(point) {
    const field=page.locator('#field');await field.scrollIntoViewIfNeeded();
    const box=await field.boundingBox();
    await field.click({position:{x:point.x/1600*box.width,y:point.y/1000*box.height}});
  }
  let count=0;
  for(const point of [{x:180,y:140},{x:1400,y:140},{x:180,y:860}]) {
    await select(point);await page.locator('[data-action="measure"]').click();
    count++;
    await page.locator(`button[data-record="${count-1}"]`).waitFor({state:'visible'});
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:fileURLToPath(new URL('mobile-locate.png',output)),fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  await select(generateSource(2,DEFAULT_CONFIG,seededRandom('acceptance-visual')));
  await page.locator('[data-action="submit"]').click();
  await page.locator('.result-panel').waitFor({state:'visible'});
  await page.screenshot({path:fileURLToPath(new URL('desktop-result.png',output)),fullPage:true});
  const environment={date:new Date().toISOString(),browser:browser.version(),node:process.version,platform:process.platform,arch:process.arch,viewports:['1280x900','390x844'],url:'http://127.0.0.1:4173/b03/',note:'本机 Chrome 与尺寸模拟；不代表真手机或微信验收。'};
  await writeFile(new URL('environment.json',output),JSON.stringify(environment,null,2)+'\n');
  console.log(JSON.stringify(environment));
} finally {await browser.close();}
