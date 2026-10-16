import { test, expect } from '@playwright/test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { generateSource, seededRandom } from '../src/engine.js';

// Interact exclusively through the page's controls and rendered DOM. Expected
// locations are independently generated from the documented debug seed; no
// hidden browser game state is exposed or modified by these tests.
const points = [
  { x: 180, y: 140 }, { x: 1400, y: 140 }, { x: 180, y: 860 },
  { x: 1400, y: 860 }, { x: 580, y: 650 },
];
const pageErrors = new WeakMap();
const action = (page, name) => page.locator(`[data-action="${name}"]`);
const recordButtons = page => page.locator('button[data-record]');
const resultMetric = (page, name) => page.locator(`[data-metric="${name}"]`);

async function expectNoResultMetrics(page) {
  await expect(page.locator('[data-metric="source-error"], [data-metric="candidate-error"]')).toHaveCount(0);
}

async function displayedPoint(page, marker) {
  const transform = await page.locator(`#field .${marker}`).getAttribute('transform');
  const coordinates = transform.match(/translate\(\s*([-+\d.e]+)[,\s]+([-+\d.e]+)\s*\)/i);
  expect(coordinates, `Expected a public SVG point transform, got ${transform}`).not.toBeNull();
  return { x: Number(coordinates[1]), y: Number(coordinates[2]) };
}

function errorPercentage(first, second) {
  return (Math.hypot(first.x - second.x, first.y - second.y)
    / Math.min(DEFAULT_CONFIG.width, DEFAULT_CONFIG.height) * 100).toFixed(2);
}

async function expectPercentage(page, metric, expected) {
  await expect(resultMetric(page, metric)).toBeVisible();
  const text = (await resultMetric(page, metric).innerText()).replace(/\s/g, '');
  expect(text).toContain(`${expected}%`);
}

async function expectNoHorizontalOverflow(page, width) {
  const sizes = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(sizes.document).toBeLessThanOrEqual(width + 1);
  expect(sizes.body).toBeLessThanOrEqual(width + 1);
  expect(sizes.viewport).toBeLessThanOrEqual(width + 1);
}

async function expectReadableMapText(page) {
  const readLabels = () => page.locator('#field text').evaluateAll(elements => elements.map(element => {
    const matrix = element.getScreenCTM();
    return {
      text: element.textContent,
      // SVG font-size is expressed in map units. Include its complete screen
      // transform to catch labels that shrink when the map fits a phone.
      pixels: parseFloat(getComputedStyle(element).fontSize) * Math.hypot(matrix.c, matrix.d),
    };
  }));
  // Playwright's clock advances game timers, but native ResizeObserver delivery
  // still follows real layout frames. Wait for that frame after rotating.
  await expect.poll(async () => {
    const labels = await readLabels();
    return labels.length > 0 && labels.every(label => label.pixels >= 15 && label.pixels <= 17);
  }, { message: 'Map labels must settle at a readable, constant screen size' }).toBe(true);
  const labels = await readLabels();
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    expect(label.pixels, `Map label “${label.text}” must remain legible in CSS pixels`).toBeGreaterThanOrEqual(15);
    expect(label.pixels, `Map label “${label.text}” must not grow with the map`).toBeLessThanOrEqual(17);
  }
}

test.beforeEach(async ({ context }) => {
  const errors = [];
  pageErrors.set(context, errors);
  const observe = page => page.on('pageerror', error => errors.push(error.message));
  context.pages().forEach(observe);
  context.on('page', observe);
});

test.afterEach(async ({ context }) => {
  expect(pageErrors.get(context), 'Every opened game page must remain free of uncaught errors').toEqual([]);
});

async function openGame(page, seed = 'browser-default') {
  await page.clock.install();
  await page.goto(`./?seed=${encodeURIComponent(seed)}`);
  await expect(page.locator('#app')).toBeVisible();
  await expect(action(page, 'start')).toBeVisible();
  // Freeze elapsed time between interactions; runFor advances real application
  // timers and animation frames without changing its rules or configuration.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
}

async function configure(page, measurements = 3, measurementMs = 1000) {
  const settings = page.locator('details.settings');
  if (!await settings.evaluate(element => element.open)) await settings.locator('summary').click();
  await page.getByLabel('每关测量次数', { exact: true }).selectOption(String(measurements));
  await page.getByLabel('每次测量等待', { exact: true }).selectOption(String(measurementMs));
}

async function startGame(page, { level = 1, measurements = 3, measurementMs = 1000 } = {}) {
  await configure(page, measurements, measurementMs);
  await page.locator(`[data-level="${level}"]`).click();
  await action(page, 'start').click();
  await expect(page.locator('.game-title')).toHaveText(level === 1 ? '基础定位' : '隔墙寻源');
  await expect(page.locator('.game-meta .pill')).toHaveText(`已用 0 / ${measurements} 次`);
}

async function choosePoint(page, point) {
  const field = page.locator('#field');
  await field.scrollIntoViewIfNeeded();
  const bounds = await field.boundingBox();
  expect(bounds).not.toBeNull();
  await field.click({ position: {
    x: point.x / DEFAULT_CONFIG.width * bounds.width,
    y: point.y / DEFAULT_CONFIG.height * bounds.height,
  } });
}

async function chooseExactPoint(page, point) {
  const field = page.locator('#field');
  await field.scrollIntoViewIfNeeded();
  const bounds = await field.boundingBox();
  // A floating-point PointerEvent exercises the map's public coordinate input
  // without OS mouse-pixel rounding. This does not access hidden game state.
  const pointer = {
    pointerId: 42, pointerType: 'mouse', button: 0,
    clientX: bounds.x + point.x / DEFAULT_CONFIG.width * bounds.width,
    clientY: bounds.y + point.y / DEFAULT_CONFIG.height * bounds.height,
  };
  await field.dispatchEvent('pointerdown', pointer);
  await field.dispatchEvent('pointerup', pointer);
}

async function finishMeasurement(page, point, index, duration = 1000) {
  await choosePoint(page, point);
  await expect(action(page, 'measure')).toBeEnabled();
  await action(page, 'measure').click();
  await expect(recordButtons(page)).toHaveCount(index);
  await page.clock.runFor(duration + 50);
  await expect(recordButtons(page)).toHaveCount(index + 1);
}

async function completeGame(page, measurements = 3, guess = { x: 300, y: 400 }) {
  for (let index = 0; index < measurements; index += 1) {
    await finishMeasurement(page, points[index], index);
  }
  await expect(action(page, 'submit')).toBeDisabled();
  await choosePoint(page, guess);
  await expect(page.locator('.result-panel')).toHaveCount(0);
  await action(page, 'submit').click();
  await expect(page.locator('.result-panel')).toBeVisible();
}

async function publicSnapshot(page) {
  return {
    count: await page.locator('.game-meta .pill').innerText(),
    reading: await page.locator('#reading').innerText(),
    comparison: await page.locator('#comparison').innerText(),
    records: await recordButtons(page).allTextContents(),
    measurements: await page.locator('#field .measurement').evaluateAll(elements => elements.map(element => element.getAttribute('transform'))),
    pending: await page.locator('#field .pending').getAttribute('transform').catch(() => null),
  };
}

for (const level of [1, 2]) {
  test(`level ${level} starts directly with four one-second measurements and reveals no result metrics early`, async ({ page }) => {
    const seed = `browser-default-four-${level}`;
    const source = generateSource(level, DEFAULT_CONFIG, seededRandom(seed));
    await openGame(page, seed);
    // Check the defaults without opening or changing the settings disclosure.
    await expect(page.getByLabel('每关测量次数', { exact: true })).toHaveValue('4');
    await expect(page.getByLabel('每次测量等待', { exact: true })).toHaveValue('1000');
    await page.locator(`[data-level="${level}"]`).click();
    await action(page, 'start').click();
    await expect(page.locator('.game-meta .pill')).toHaveText('已用 0 / 4 次');
    await expectNoResultMetrics(page);
    for (let index = 0; index < 4; index += 1) {
      await choosePoint(page, points[index]);
      await expectNoResultMetrics(page);
      await expect(page.locator('.game-meta .pill')).toHaveText(`已用 ${index} / 4 次`);
      await action(page, 'measure').click();
      for (let repeat = 0; repeat < 6; repeat += 1) await action(page, 'measure').dispatchEvent('click');
      await expect(page.locator('.game-meta .pill')).toHaveText(`已用 ${index + 1} / 4 次`);
      await expectNoResultMetrics(page);
      await page.clock.runFor(999);
      await expect(recordButtons(page)).toHaveCount(index);
      await expect(action(page, 'measure')).toBeDisabled();
      await page.clock.runFor(1);
      // The deadline is exactly 1000 ms; rendering happens at the first frame
      // at or after that deadline, which can be one frame later.
      await page.clock.runFor(17);
      await expect(recordButtons(page)).toHaveCount(index + 1);
      await expectNoResultMetrics(page);
      if (index < 3) await expect(action(page, 'submit')).toHaveCount(0);
    }
    await expect(action(page, 'submit')).toBeDisabled();
    await choosePoint(page, source);
    const guess = await displayedPoint(page, 'guess');
    await expectNoResultMetrics(page);
    await action(page, 'submit').click();
    await expect(page.locator('.result-title')).toHaveText('定位成功');
    await expectPercentage(page, 'source-error', errorPercentage(guess, source));
    await expect(page.locator('.game-meta .pill')).toHaveText('已用 4 / 4 次');
  });
}

test('an exact source submission displays a zero error of 0.00%', async ({ page }) => {
  const seed = 'browser-zero-error';
  const source = generateSource(1, DEFAULT_CONFIG, seededRandom(seed));
  await openGame(page, seed);
  await startGame(page);
  for (let index = 0; index < 3; index += 1) await finishMeasurement(page, points[index], index);
  await chooseExactPoint(page, source);
  const guess = await displayedPoint(page, 'guess');
  expect(guess.x).toBeCloseTo(source.x, 9);
  expect(guess.y).toBeCloseTo(source.y, 9);
  await expectNoResultMetrics(page);
  await action(page, 'submit').click();
  await expect(page.locator('.result-title')).toHaveText('定位成功');
  await expectPercentage(page, 'source-error', '0.00');
});

for (const level of [1, 2]) {
  for (const measurements of [3, 4, 5]) {
    test(`level ${level} completes ${measurements} measurements with separate, guarded confirmations`, async ({ page }) => {
      const seed = `browser-level-${level}-count-${measurements}`;
      const source = generateSource(level, DEFAULT_CONFIG, seededRandom(seed));
      await openGame(page, seed);
      await startGame(page, { level, measurements });
      await expect(page.locator('#field .wall')).toHaveCount(level === 2 ? 1 : 0);
      await expect(page.locator('.record')).toHaveCount(measurements);
      await expect(action(page, 'measure')).toBeDisabled();
      await expectNoResultMetrics(page);
      for (let index = 0; index < measurements; index += 1) {
        const previousReading = await page.locator('#reading').innerText();
        await choosePoint(page, points[index]);
        await expect(page.locator('.game-meta .pill')).toHaveText(`已用 ${index} / ${measurements} 次`);
        await expect(page.locator('#reading')).toHaveText(previousReading, { useInnerText: true });
        await expect(page.locator('#field .true-source, #field .candidate')).toHaveCount(0);
        if (index === 0) {
          await action(page, 'cancel').click();
          await expect(page.locator('#field .pending')).toHaveCount(0);
          await expect(action(page, 'measure')).toBeDisabled();
          await choosePoint(page, points[index]);
        }
        await action(page, 'measure').click();
        // Dispatch repeated confirmation attempts against the public button;
        // its disabled state and delegated click guard must reject each one.
        for (let repeat = 0; repeat < 5; repeat += 1) await action(page, 'measure').dispatchEvent('click');
        await expect(page.locator('.game-meta .pill')).toHaveText(`已用 ${index + 1} / ${measurements} 次`);
        await expect(recordButtons(page)).toHaveCount(index);
        await expect(action(page, 'cancel')).toBeDisabled();
        const locked = await page.locator('#field .pending').getAttribute('transform');
        await choosePoint(page, { x: 650, y: 100 });
        await expect(page.locator('#field .pending')).toHaveAttribute('transform', locked);
        await page.clock.runFor(1050);
        await expect(recordButtons(page)).toHaveCount(index + 1);
      }
      await expect(action(page, 'submit')).toBeDisabled();
      const reading = await page.locator('#reading').innerText();
      await choosePoint(page, { x: 100, y: 50 });
      await action(page, 'cancel').click();
      await expect(action(page, 'submit')).toBeDisabled();
      await choosePoint(page, source);
      await expect(page.locator('#reading')).toHaveText(reading, { useInnerText: true });
      await expect(page.locator('#field .true-source')).toHaveCount(0);
      const guess = await displayedPoint(page, 'guess');
      await expectNoResultMetrics(page);
      await action(page, 'submit').click();
      await expect(page.locator('.result-title')).toHaveText('定位成功');
      await expect(page.locator('#field .true-source')).toHaveCount(1);
      await expect(page.locator('.game-meta .pill')).toHaveText(`已用 ${measurements} / ${measurements} 次`);
      await expectPercentage(page, 'source-error', errorPercentage(guess, source));
      await expect(recordButtons(page)).toHaveCount(measurements);
      if (level === 2) await expect(page.locator('#field .source-path')).toHaveCount(measurements);
    });
  }
}

test('replay, level switch and home cancel in-flight work without stale completions', async ({ page }) => {
  await openGame(page);
  await startGame(page, { measurementMs: 3000 });
  await choosePoint(page, points[0]);
  await action(page, 'measure').click();
  await page.clock.runFor(1500);
  await action(page, 'restart').click();
  await page.clock.runFor(4000);
  await expect(recordButtons(page)).toHaveCount(0);
  await expect(page.locator('.game-meta .pill')).toHaveText('已用 0 / 3 次');
  await choosePoint(page, points[1]);
  await action(page, 'measure').click();
  await action(page, 'switch').click();
  await page.clock.runFor(4000);
  await expect(page.locator('.game-title')).toHaveText('隔墙寻源');
  await expect(recordButtons(page)).toHaveCount(0);
  await expect(page.locator('.game-meta .pill')).toHaveText('已用 0 / 3 次');
  await choosePoint(page, points[2]);
  await action(page, 'measure').click();
  await action(page, 'home').last().click();
  await page.clock.runFor(4000);
  await expect(page.locator('.hero-title')).toBeVisible();
  await action(page, 'start').click();
  await expect(recordButtons(page)).toHaveCount(0);
  await expect(page.locator('.game-meta .pill')).toHaveText('已用 0 / 3 次');
});

test('history only emphasizes the selected point and cannot reveal another reading', async ({ page }) => {
  await openGame(page);
  await startGame(page);
  await finishMeasurement(page, points[0], 0);
  await finishMeasurement(page, points[1], 1);
  await choosePoint(page, points[2]);
  const before = await publicSnapshot(page);
  await page.locator('[data-record="0"]').click();
  expect(await publicSnapshot(page)).toEqual(before);
  await expect(page.locator('#field .measurement.selected')).toHaveCount(1);
  await expect(page.locator('#field .true-source, #field .candidate, #field .source-path')).toHaveCount(0);
  await page.locator('[data-record="1"]').click();
  expect(await publicSnapshot(page)).toEqual(before);
});

for (const level of [1, 2]) {
  test(`level ${level} demo can finish, replay and skip without stopping later game timers`, async ({ page }) => {
    await openGame(page);
    await configure(page);
    await page.locator(`[data-level="${level}"]`).click();
    await action(page, 'demo').click();
    await expect(page.locator('#field .true-source')).toHaveCount(1);
    await expect(page.locator('.game-meta')).toHaveCount(0);
    await page.clock.runFor(12_100);
    await expect(page.locator('.game-heading .pill')).toContainText('演示完成');
    await page.clock.runFor(250); // Regression: a completed demo must survive subsequent frames.
    await action(page, 'replay-demo').click();
    await expect(page.locator('.game-heading .pill')).toContainText('12');
    await page.clock.runFor(1000);
    await action(page, 'demo-back').click();
    await expect(page.locator('.hero-title')).toBeVisible();
    await action(page, 'demo').click();
    await action(page, 'start').click();
    await expect(page.locator('.game-meta .pill')).toHaveText('已用 0 / 3 次');
    await expect(page.locator('#field .true-source')).toHaveCount(0);
    await finishMeasurement(page, points[0], 0);
  });
}

test('a result-page demo returns to the same result and can start a fresh game', async ({ page }) => {
  await openGame(page);
  await startGame(page);
  await completeGame(page);
  const originalResult = await page.locator('.result-panel').innerText();
  const originalSource = await page.locator('#field .true-source').getAttribute('transform');
  await action(page, 'demo').click();
  await expect(page.locator('.demo-panel')).toBeVisible();
  await page.clock.runFor(12_100);
  await action(page, 'demo-back').click();
  await expect(page.locator('.result-panel')).toHaveText(originalResult, { useInnerText: true });
  await expect(page.locator('#field .true-source')).toHaveAttribute('transform', originalSource);
  await action(page, 'demo').click();
  await action(page, 'start').click();
  await expect(recordButtons(page)).toHaveCount(0);
  await expect(page.locator('.game-meta .pill')).toHaveText('已用 0 / 3 次');
  await finishMeasurement(page, points[0], 0);
});

test('collinear measurements recognize a distinct mirrored source without previewing candidates', async ({ page }) => {
  let seed, source;
  for (let index = 0; index < 100; index += 1) {
    seed = `browser-mirror-${index}`;
    source = generateSource(1, DEFAULT_CONFIG, seededRandom(seed));
    if (Math.abs(source.y - DEFAULT_CONFIG.height / 2) > 150) break;
  }
  expect(Math.abs(source.y - DEFAULT_CONFIG.height / 2)).toBeGreaterThan(150);
  await openGame(page, seed);
  await startGame(page);
  // Keyboard selection gives exactly collinear logical y coordinates without
  // depending on subpixel pointer rounding at the current viewport size.
  for (const [index, keys] of [
    ['ArrowLeft', 'ArrowLeft', 'ArrowLeft'], ['Enter'], ['ArrowRight', 'ArrowRight', 'ArrowRight'],
  ].entries()) {
    for (const key of keys) await page.locator('#field').press(key);
    if (index === 2) await expect(page.locator('.hint')).toContainText('换个方向');
    await action(page, 'measure').click();
    await page.clock.runFor(1050);
    await expect(recordButtons(page)).toHaveCount(index + 1);
  }
  await expect(page.locator('#field .candidate, #field .true-source')).toHaveCount(0);
  const mirror = { x: source.x, y: DEFAULT_CONFIG.height - source.y };
  await choosePoint(page, mirror);
  const guess = await displayedPoint(page, 'guess');
  await expectNoResultMetrics(page);
  await action(page, 'submit').click();
  await expect(page.locator('.result-title')).toContainText('合理判断');
  await expect(page.locator('#field .candidate')).toHaveCount(1);
  await expectPercentage(page, 'source-error', errorPercentage(guess, source));
  await expectPercentage(page, 'candidate-error', errorPercentage(guess, mirror));
  expect(Number(errorPercentage(guess, mirror))).toBeLessThan(Number(errorPercentage(guess, source)));
});

test.describe('mobile-sized Chrome emulation (not a substitute for physical phone testing)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

  test('map labels stay readable on narrow phones and rotation preserves points and reference layout', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await openGame(page, 'browser-readable-map');
    await startGame(page, { level: 2 });
    await finishMeasurement(page, points[0], 0);
    await choosePoint(page, points[1]);
    const before = await publicSnapshot(page);
    const viewports = [
      { width: 320, height: 740 }, { width: 390, height: 844 },
      { width: 844, height: 390 }, { width: 740, height: 320 },
    ];
    async function checkLayout(viewport) {
      await page.setViewportSize(viewport);
      await page.clock.runFor(50);
      await expectReadableMapText(page);
      await expectNoHorizontalOverflow(page, viewport.width);
      const field = await page.locator('#field').boundingBox();
      expect(field.width / field.height).toBeCloseTo(1.6, 2);
      const reference = page.locator('.signal-reference');
      await expect(reference).toBeVisible();
      const bounds = await reference.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(-1);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(await reference.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    }
    for (const viewport of viewports) {
      await checkLayout(viewport);
      expect(await publicSnapshot(page)).toEqual(before);
      await expect(page.locator('#field .true-source')).toHaveCount(0);
    }
    await finishMeasurement(page, points[1], 1);
    await finishMeasurement(page, points[2], 2);
    await choosePoint(page, { x: 850, y: 580 });
    const guess = await displayedPoint(page, 'guess');
    await expectReadableMapText(page);
    await action(page, 'submit').click();
    const source = await displayedPoint(page, 'true-source');
    for (const viewport of viewports) {
      await checkLayout(viewport);
      expect(await displayedPoint(page, 'guess')).toEqual(guess);
      expect(await displayedPoint(page, 'true-source')).toEqual(source);
    }
  });

  test('the reading-distance reference stays fixed through both levels and never previews the source', async ({ page }) => {
    await openGame(page, 'browser-fixed-reference');
    await startGame(page);
    let firstScale;
    for (const level of [1, 2]) {
      if (level === 2) await action(page, 'switch').click();
      const reference = page.locator('.signal-reference');
      await expect(reference).toBeVisible();
      const original = await reference.innerHTML();
      const ticks = reference.locator('.reference-tick[data-reading]');
      const outside = reference.locator('.reference-outside');
      await expect(ticks).toHaveCount(2);
      await expect(reference.locator('.reference-tick[data-reading="1000"]')).toContainText('0.30');
      await expect(reference.locator('.reference-tick[data-reading="100"]')).toContainText('1.02');
      await expect(outside).toContainText('10');
      await expect(outside).toContainText('4.47');
      await expect(outside).toContainText('超出地图');
      const scale = { ticks: await ticks.allTextContents(), outside: await outside.textContent() };
      if (firstScale) expect(scale).toEqual(firstScale);
      else firstScale = scale;
      const field = await page.locator('#field').boundingBox();
      // The two ticks must correspond to about 19% and 64% of the visible
      // map width, rather than evenly spaced decorative scale divisions.
      for (const [reading, fraction] of [['1000', 0.188], ['100', 0.638]]) {
        const tick = await reference.locator(`.reference-tick[data-reading="${reading}"]`).boundingBox();
        expect((tick.x - field.x) / field.width).toBeCloseTo(fraction, 2);
      }
      async function expectFixedReference(hideSource = true) {
        expect(await reference.innerHTML()).toBe(original);
        if (hideSource) await expect(page.locator('#field .true-source, #field .candidate, #field .source-path')).toHaveCount(0);
      }
      await expectFixedReference();
      await choosePoint(page, points[0]);
      await expectFixedReference();
      await choosePoint(page, points[1]);
      await expectFixedReference();
      for (let index = 0; index < 3; index += 1) {
        await finishMeasurement(page, points[index], index);
        await expectFixedReference();
      }
      await choosePoint(page, { x: 300, y: 400 });
      await expectFixedReference();
      await choosePoint(page, { x: 1200, y: 600 });
      await expectFixedReference();
      await action(page, 'submit').click();
      await expectFixedReference(false);
      await action(page, 'restart').click();
      await expectFixedReference();
    }
  });

  test('touch scrolling, cancelled pointers and multiple fingers do not select or spend measurements', async ({ page, context }) => {
    await openGame(page);
    await startGame(page);
    const field = page.locator('#field');
    await field.scrollIntoViewIfNeeded();
    const box = await field.boundingBox();
    const origin = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.2 };
    const touch = (id, x = origin.x, y = origin.y) => ({ id, x, y, radiusX: 1, radiusY: 1, force: 1 });
    // Chrome input dispatch creates active, trusted touch pointers, so the
    // application's pointer capture and native scroll cancellation also run.
    const input = await context.newCDPSession(page);
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(1), touch(2, origin.x + 40)] });
    await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(3)] });
    await input.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(4)] });
    await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(4, origin.x, origin.y - 70)] });
    await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('#field .pending')).toHaveCount(0);
    await expect(action(page, 'measure')).toBeDisabled();
    await expect(page.locator('.game-meta .pill')).toHaveText('已用 0 / 3 次');
    await field.scrollIntoViewIfNeeded();
    const current = await field.boundingBox();
    await page.touchscreen.tap(current.x + current.width * 0.2, current.y + current.height * 0.2);
    // A cancelled gesture must not permanently block the next independent tap.
    await expect(page.locator('#field .pending')).toHaveCount(1);
    await expect(page.locator('.game-meta .pill')).toHaveText('已用 0 / 3 次');
    await action(page, 'cancel').click();
    await expect(page.locator('#field .pending')).toHaveCount(0);
    await input.detach();
  });

  test('portrait-to-landscape resize preserves coordinates, readings, pending point and hidden source', async ({ page }) => {
    const seed = 'browser-resize';
    const source = generateSource(1, DEFAULT_CONFIG, seededRandom(seed));
    await openGame(page, seed);
    await startGame(page);
    await finishMeasurement(page, points[0], 0);
    await choosePoint(page, points[1]);
    const before = await publicSnapshot(page);
    for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 760 }]) {
      await page.setViewportSize(viewport);
      await page.clock.runFor(50);
      expect(await publicSnapshot(page)).toEqual(before);
      const bounds = await page.locator('#field').boundingBox();
      expect(bounds.width / bounds.height).toBeCloseTo(1.6, 2);
      expect(bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.height).toBeLessThanOrEqual(viewport.height);
      await expect(page.locator('#field .true-source')).toHaveCount(0);
    }
    await finishMeasurement(page, points[1], 1);
    await finishMeasurement(page, points[2], 2);
    await choosePoint(page, source);
    await action(page, 'submit').click();
    await expect(page.locator('.result-title')).toHaveText('定位成功');
  });

  test('a 320px-wide phone has no horizontal overflow and can finish, inspect results and replay', async ({ page }) => {
    const width = 320;
    const seed = 'browser-narrow-phone';
    const source = generateSource(1, DEFAULT_CONFIG, seededRandom(seed));
    await page.setViewportSize({ width, height: 740 });
    await openGame(page, seed);
    await expectNoHorizontalOverflow(page, width);
    const disclosures = await page.locator('details').all();
    for (const disclosure of disclosures) {
      await disclosure.locator('summary').click();
      await expectNoHorizontalOverflow(page, width);
      await disclosure.locator('summary').click();
    }
    await action(page, 'start').click();
    await expect(page.locator('.game-meta .pill')).toHaveText('已用 0 / 4 次');
    for (let index = 0; index < 4; index += 1) {
      await finishMeasurement(page, points[index], index);
      await expectNoHorizontalOverflow(page, width);
      await expectNoResultMetrics(page);
    }
    await choosePoint(page, source);
    await action(page, 'submit').click();
    await expect(page.locator('.result-title')).toHaveText('定位成功');
    await expect(resultMetric(page, 'source-error')).toBeVisible();
    await expectNoHorizontalOverflow(page, width);
    await action(page, 'demo').click();
    await expectNoHorizontalOverflow(page, width);
    await action(page, 'start').click();
    await expect(page.locator('.game-meta .pill')).toHaveText('已用 0 / 4 次');
    await action(page, 'switch').click();
    await expect(page.locator('.game-title')).toHaveText('隔墙寻源');
    await finishMeasurement(page, points[0], 0);
    await expectNoHorizontalOverflow(page, width);
  });
});

test('after loading, both levels, demos and replay complete with the browser offline', async ({ page, context }) => {
  await openGame(page);
  await configure(page);
  await context.setOffline(true);
  try {
    await action(page, 'demo').click();
    await page.clock.runFor(12_100);
    await action(page, 'start').click();
    await completeGame(page);
    await action(page, 'switch').click();
    await expect(page.locator('.game-title')).toHaveText('隔墙寻源');
    await completeGame(page);
    await action(page, 'demo').click();
    await page.clock.runFor(12_100);
    await action(page, 'replay-demo').click();
    await page.clock.runFor(5000);
    await action(page, 'start').click();
    await finishMeasurement(page, points[0], 0);
    await action(page, 'restart').click();
    await finishMeasurement(page, points[1], 0);
  } finally {
    await context.setOffline(false);
  }
});

test('two open pages keep independent configuration, measurements and replay state', async ({ page, context }) => {
  const other = await context.newPage();
  await openGame(page, 'browser-device-one');
  await openGame(other, 'browser-device-two');
  await startGame(page);
  await startGame(other, { level: 2, measurements: 5 });
  await finishMeasurement(page, points[0], 0);
  await expect(recordButtons(other)).toHaveCount(0);
  await expect(other.locator('.game-meta .pill')).toHaveText('已用 0 / 5 次');
  await finishMeasurement(other, points[1], 0);
  await action(other, 'restart').click();
  await expect(recordButtons(page)).toHaveCount(1);
  await expect(page.locator('.game-meta .pill')).toHaveText('已用 1 / 3 次');
  await expect(recordButtons(other)).toHaveCount(0);
  await other.close();
});

for (const blocked of ['**/src/app.js*', '**/styles.css*']) {
  test(`failed ${blocked.includes('app.js') ? 'application module' : 'stylesheet'} shows a retry that recovers`, async ({ page }) => {
    await page.clock.install();
    await page.route(blocked, route => route.abort('failed'));
    await page.goto('./');
    await page.clock.runFor(8100);
    await expect(page.locator('#loading-message')).toContainText('资源暂时未能加载');
    await expect(page.locator('#retry-load')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    await page.unroute(blocked);
    await page.locator('#retry-load').click();
    await expect(page.locator('#app')).toBeVisible();
    await expect(action(page, 'start')).toBeVisible();
    await expect(page.locator('#loading')).toBeHidden();
  });
}

test('project-subpath resources load and direct reload returns to a usable start page', async ({ page }) => {
  const assets = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (/\.(js|css)$/.test(url.pathname)) assets.push({ pathname: url.pathname, status: response.status() });
  });
  await openGame(page, 'browser-subpath');
  expect(assets.length).toBeGreaterThanOrEqual(5);
  expect(assets.every(asset => asset.pathname.startsWith('/b03/') && asset.status === 200)).toBe(true);
  await startGame(page);
  await finishMeasurement(page, points[0], 0);
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('.hero-title')).toBeVisible();
  await action(page, 'start').click();
  await expect(page.locator('.game-meta .pill')).toHaveText('已用 0 / 4 次');
  await expect(page.locator('#field .true-source')).toHaveCount(0);
});

test('a stalled required module times out to a recoverable resource error', async ({ page }) => {
  await page.clock.install();
  let stalled;
  await page.route('**/src/engine.js*', route => { stalled=route; });
  await page.goto('./', { waitUntil:'domcontentloaded' });
  await expect.poll(() => Boolean(stalled)).toBe(true);
  await page.clock.runFor(12_100);
  await expect(page.locator('#loading-message')).toContainText('资源暂时未能加载');
  await expect(page.locator('#retry-load')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
  await stalled.abort('failed');
  await page.unroute('**/src/engine.js*');
  await page.locator('#retry-load').click();
  await expect(page.locator('#app')).toBeVisible();
});
