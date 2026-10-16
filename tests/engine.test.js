import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, makeConfig } from '../src/config.js';
import { classify, crossesWall, distance, generateSource, meter, seededRandom, signal, solveCandidates, validPoint, wallForLevel } from '../src/engine.js';

const config = makeConfig();
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const observations = (source, points, level = 1, current = config) => points.map(point => ({ point, value: signal(source, point, level, current).value }));
const includes = (candidates, source, current = config) => candidates.some(candidate => distance(candidate, source) <= current.candidateMergeDistance);

test('configuration creates independent immutable snapshots with the specified defaults', () => {
  const input = { measurements: 5, wall: { x: 750 } };
  const first = makeConfig(input);
  const second = makeConfig();
  input.wall.x = 10;
  assert.equal(first.wall.x, 750);
  assert.equal(second.wall.x, 780);
  assert.equal(DEFAULT_CONFIG.version, '0.2.0');
  assert.equal(DEFAULT_CONFIG.measurements, 4);
  assert.equal(DEFAULT_CONFIG.measurementMs, 1000);
  assert.notEqual(first.wall, second.wall);
  assert.notEqual(second.wall, DEFAULT_CONFIG.wall);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.wall));
  assert.throws(() => { first.wall.x = 1; }, TypeError);
  for (const count of [3, 4, 5]) assert.equal(makeConfig({ measurements: count }).measurements, count);
});

test('invalid settings fail early instead of silently changing the game rules', () => {
  for (const override of [
    { measurements: 2 }, { measurements: 6 }, { measurements: 3.5 },
    { K: 0 }, { h: 0 }, { b: -1 }, { wallTransmission: 0 }, { wallTransmission: 1.1 },
    { measurementMs: -1 }, { meterScale: NaN }, { successRatio: 0.2, nearRatio: 0.1 },
    { sourceMarginRatio: 0.5 }, { displayDecimals: 1.5 }, { numericRelativeTolerance: 0.05 },
    { wall: { x: 0 } }, { wall: { height: 1000 } }, { wall: null }, { typo: 1 }, { wall: { typo: 1 } },
  ]) assert.throws(() => makeConfig(override));
});

test('continuous points and wall-inclusive invalid regions follow logical coordinates', () => {
  assert.equal(wallForLevel(1, config), null);
  assert.equal(wallForLevel(2, config), config.wall);
  assert.ok(validPoint({ x: 123.456789, y: 999.999 }, 1, config));
  assert.ok(validPoint({ x: 0, y: 1000 }, 2, config));
  assert.ok(validPoint({ x: 800, y: 500 }, 1, config));
  for (const point of [{ x: 800, y: 500 }, { x: 780, y: 500 }, { x: 820, y: 770 }, { x: -0.001, y: 0 }, { x: NaN, y: 1 }]) {
    assert.equal(validPoint(point, 2, config), false);
  }
  assert.throws(() => wallForLevel(3, config));
});

test('wall crossing requires positive interior length; corners, edges, and endpoints alone do not count', () => {
  const wall = { x: 4, y: 4, width: 2, height: 2 };
  const cases = [
    [{ x: 2, y: 5 }, { x: 8, y: 5 }, true],
    [{ x: 5, y: 2 }, { x: 5, y: 8 }, true],
    [{ x: 2, y: 2 }, { x: 8, y: 8 }, true],
    [{ x: 2, y: 4 }, { x: 8, y: 4 }, false],
    [{ x: 2, y: 6 }, { x: 6, y: 2 }, false],
    [{ x: 2, y: 5 }, { x: 4, y: 5 }, false],
    [{ x: 4, y: 3 }, { x: 4, y: 8 }, false],
    [{ x: 2, y: 4.000001 }, { x: 8, y: 4.000001 }, true],
    [{ x: 5, y: 5 }, { x: 5, y: 5 }, false],
    [{ x: 3, y: 3 }, { x: 3, y: 8 }, false],
  ];
  for (const [a, b, expected] of cases) {
    assert.equal(crossesWall(a, b, wall), expected, JSON.stringify({ a, b }));
    assert.equal(crossesWall(b, a, wall), expected, 'direction must not affect intersection');
  }
  assert.equal(crossesWall({ x: 0, y: 0 }, { x: 2, y: 2 }, null), false);
});

test('wall attenuation halves source contribution, preserves background, and never stacks', () => {
  const source = { x: 500, y: 500 };
  const point = { x: 1100, y: 500 };
  const open = signal(source, point, 1, config);
  const blocked = signal(source, point, 2, config);
  close(blocked.sourceContribution, open.sourceContribution * 0.5);
  close(blocked.value, config.b + (open.value - config.b) * 0.5);
  assert.equal(blocked.attenuated, true);
  assert.equal(open.attenuated, false);
  assert.deepEqual(signal(source, point, 2, config), blocked);
  assert.notEqual(blocked.value, open.value * 0.5);
  assert.equal(signal({ x: 500, y: 230 }, { x: 1100, y: 230 }, 2, config).attenuated, false);
});

test('zero distance is finite, exact values are retained, and meter is fixed across readings', () => {
  const source = { x: 250.123456, y: 350.654321 };
  const peak = signal(source, source, 1, config);
  close(peak.value, config.b + config.K / config.h ** 2);
  assert.equal(meter(peak.value, config), 1);
  assert.equal(meter(config.b, config), 0);
  assert.equal(meter(config.b - 10, config), 0);
  assert.equal(meter(Infinity, config), 0);
  const reading = signal(source, { x: 1050.25, y: 902.1 }, 1, config).value;
  assert.notEqual(reading, Number(reading.toFixed(1)));
  const expected = Math.log1p((reading - config.b) / config.meterScale) / Math.log1p((config.K / config.h ** 2) / config.meterScale);
  close(meter(reading, config), expected);
  signal(source, { x: 10, y: 10 }, 1, config);
  assert.equal(meter(reading, config), expected);
});

test('seeded continuous generation is reproducible, independent, margin-safe, and cannot hang on a constant RNG', () => {
  const a = seededRandom('B03');
  const b = seededRandom('B03');
  const margin = Math.min(config.width, config.height) * config.sourceMarginRatio;
  for (let index = 0; index < 300; index++) {
    const point = generateSource(2, config, a);
    assert.deepEqual(point, generateSource(2, config, b));
    assert.ok(validPoint(point, 2, config));
    assert.ok(point.x >= margin && point.x <= config.width - margin);
    assert.ok(point.y >= margin && point.y <= config.height - margin);
  }
  const excluded = generateSource(1, config, () => 0.5);
  assert.ok(distance(generateSource(1, config, () => 0.5, excluded), excluded) > config.candidateMergeDistance);
  assert.ok(validPoint(generateSource(2, config, () => 0.5), 2, config));
  assert.throws(() => generateSource(1, config, () => 1));
});

test('three collinear observations retain both mirror candidates and recognize a reasonable alternative', () => {
  const source = { x: 800, y: 300 };
  const mirror = { x: 800, y: 700 };
  const records = observations(source, [{ x: 200, y: 500 }, { x: 700, y: 500 }, { x: 1400, y: 500 }]);
  const candidates = solveCandidates(records, 1, config);
  assert.equal(candidates.length, 2);
  assert.ok(includes(candidates, source));
  assert.ok(includes(candidates, mirror));
  const result = classify(mirror, source, candidates, config);
  assert.equal(result.status, 'reasonable');
  close(result.error, 400);
  close(result.nearestDistance, 0);
});

test('fourth and fifth records are used to reject former mirror solutions and inconsistent data', () => {
  const source = { x: 800, y: 300 };
  const points = [{ x: 200, y: 500 }, { x: 700, y: 500 }, { x: 1400, y: 500 }, { x: 500, y: 100 }, { x: 1200, y: 850 }];
  for (const count of [4, 5]) {
    const current = makeConfig({ measurements: count });
    const records = observations(source, points.slice(0, count), 1, current);
    const candidates = solveCandidates(records, 1, current);
    assert.equal(candidates.length, 1);
    assert.ok(includes(candidates, source, current));
    records.at(-1).value *= 1.001;
    assert.deepEqual(solveCandidates(records, 1, current), []);
  }
});

test('second-level candidates reject algebraic mirrors that do not have the assumed actual attenuation', () => {
  const source = { x: 900, y: 500 };
  const mirror = { x: 300, y: 500 };
  const points = [{ x: 600, y: 100 }, { x: 600, y: 500 }, { x: 600, y: 900 }];
  const records = observations(source, points, 2);
  assert.ok(points.every(point => signal(source, point, 2, config).attenuated));
  assert.ok(points.every(point => !signal(mirror, point, 2, config).attenuated));
  const candidates = solveCandidates(records, 2, config);
  assert.ok(includes(candidates, source));
  assert.ok(!includes(candidates, mirror));
  assert.equal(candidates.length, 1);
});

test('weak but similar readings do not make a nearby-looking wrong source valid', () => {
  const source = { x: 1500, y: 900 };
  const wrong = { x: 1490, y: 890 };
  const points = [{ x: 20, y: 20 }, { x: 100, y: 20 }, { x: 20, y: 100 }];
  const records = observations(source, points);
  assert.ok(records.every((record, index) => Math.abs(signal(wrong, points[index], 1, config).value / record.value - 1) < 0.05));
  const candidates = solveCandidates(records, 1, config);
  assert.ok(includes(candidates, source));
  assert.ok(!includes(candidates, wrong));
});

test('peak-distance, exact-collinear, near-collinear, and map-edge degeneracies preserve the true source', () => {
  const cases = [
    { source: { x: 300, y: 400 }, points: [{ x: 300, y: 400 }, { x: 1500, y: 700 }, { x: 200, y: 900 }] },
    { source: { x: 800, y: 500 }, points: [{ x: 100, y: 500 }, { x: 600, y: 500 }, { x: 1400, y: 500 }] },
    { source: { x: 800, y: 500.00000001 }, points: [{ x: 100, y: 500 }, { x: 600, y: 500.000000001 }, { x: 1400, y: 500 }] },
    { source: { x: 1500, y: 900 }, points: [{ x: 100, y: 500 }, { x: 600, y: 500.00000001 }, { x: 1400, y: 500 }] },
    { source: { x: 0, y: 0 }, points: [{ x: 200, y: 200 }, { x: 700, y: 200 }, { x: 1200, y: 600 }] },
    { source: { x: 1600, y: 1000 }, points: [{ x: 200, y: 200 }, { x: 700, y: 200 }, { x: 1200, y: 600 }] },
  ];
  for (const { source, points } of cases) {
    const candidates = solveCandidates(observations(source, points), 1, config);
    assert.ok(includes(candidates, source), JSON.stringify({ source, candidates }));
    assert.equal(classify(source, source, candidates, config).status, 'success');
  }
});

test('wall tangency is consistently handled in both reading and candidate validation', () => {
  const source = { x: 500, y: 230 };
  const points = [{ x: 1100, y: 230 }, { x: 200, y: 100 }, { x: 400, y: 900 }];
  assert.equal(signal(source, points[0], 2, config).attenuated, false);
  assert.ok(includes(solveCandidates(observations(source, points, 2), 2, config), source));
});

test('tightly clustered collinear measurements do not turn floating-point cancellation into a missing true source', () => {
  const rng = seededRandom('close-collinear');
  for (let iteration = 0; iteration < 1000; iteration++) {
    const y = 50 + rng() * 900;
    const source = { x: 700 + rng() * 850, y };
    const points = [{ x: 20 + rng() * 2, y }, { x: 33 + rng() * 2, y }, { x: 46 + rng() * 2, y }];
    const candidates = solveCandidates(observations(source, points), 1, config);
    assert.ok(includes(candidates, source), JSON.stringify({ iteration, source, points, candidates }));
    assert.equal(classify(source, source, candidates, config).status, 'success');
  }
});

test('corner tangency and the same line moved into the wall remain distinct under inversion', () => {
  for (const offset of [0, 0.001]) {
    const source = { x: 500, y: 510 + offset };
    // The unshifted segment touches the upper-left corner (780,230) only.
    const points = [{ x: 950, y: 60 + offset }, { x: 300, y: 100 }, { x: 1200, y: 900 }];
    assert.equal(signal(source, points[0], 2, config).attenuated, offset > 0);
    assert.ok(includes(solveCandidates(observations(source, points, 2), 2, config), source));
  }
});

test('inclusive success and near boundaries use logical distances, while the next outside point does not pass', () => {
  const source = { x: 300, y: 300 };
  const mirror = { x: 1100, y: 300 };
  const candidates = [source, mirror];
  assert.equal(classify({ x: 350, y: 300 }, source, candidates, config).status, 'success');
  assert.equal(classify({ x: 350.000001, y: 300 }, source, candidates, config).status, 'near');
  assert.equal(classify({ x: 1150, y: 300 }, source, candidates, config).status, 'reasonable');
  assert.equal(classify({ x: 1150.000001, y: 300 }, source, candidates, config).status, 'near');
  assert.equal(classify({ x: 1200, y: 300 }, source, candidates, config).status, 'near');
  assert.equal(classify({ x: 1200.000001, y: 300 }, source, candidates, config).status, 'miss');
  const changed = makeConfig({ successRatio: 0.02, nearRatio: 0.04 });
  assert.equal(classify({ x: 340, y: 300 }, source, candidates, changed).status, 'near');
  assert.equal(classify({ x: 340.000001, y: 300 }, source, candidates, changed).status, 'miss');
  assert.deepEqual(signal(source, { x: 100, y: 100 }, 1, changed), signal(source, { x: 100, y: 100 }, 1, config));
});

test('an exact guess reports zero error percentages without changing the successful grade', () => {
  const source = { x: 300, y: 300 };
  const result = classify(source, source, [source], config);
  assert.equal(result.status, 'success');
  assert.equal(result.errorPercent, 0);
  assert.equal(result.nearestPercent, 0);
});

test('result percentages normalize by the short edge for either nonsquare map orientation', () => {
  const source = { x: 100, y: 100 };
  const guess = { x: 280, y: 100 };
  for (const dimensions of [{ width: 1600, height: 900 }, { width: 900, height: 1600 }]) {
    const current = makeConfig(dimensions);
    const result = classify(guess, source, [source], current);
    close(result.error, 180);
    close(result.errorPercent, 20);
    close(result.nearestPercent, 20);
    assert.equal(result.status, 'miss');
  }
});

test('mirror solutions retain separate true-source and nearest-valid-candidate percentages', () => {
  const source = { x: 800, y: 300 };
  const mirror = { x: 800, y: 700 };
  const records = observations(source, [{ x: 200, y: 500 }, { x: 600, y: 500 }, { x: 1000, y: 500 }, { x: 1400, y: 500 }]);
  const candidates = solveCandidates(records, 1, config);
  const result = classify({ x: mirror.x, y: mirror.y + 30 }, source, candidates, config);
  assert.equal(result.status, 'reasonable');
  close(result.errorPercent, 43);
  close(result.nearestPercent, 3);
  close(distance(result.candidate, mirror), 0);
});

test('error percentages above one short edge are not clipped to 100 percent', () => {
  const source = { x: 0, y: 0 };
  const guess = { x: config.width, y: config.height };
  const result = classify(guess, source, [source], config);
  const expected = Math.hypot(config.width, config.height) / Math.min(config.width, config.height) * 100;
  assert.equal(result.status, 'miss');
  assert.ok(result.errorPercent > 100);
  close(result.errorPercent, expected);
  close(result.nearestPercent, expected);
});

test('missing true candidates trigger an explicit program anomaly rather than a failure grade', () => {
  const source = { x: 300, y: 300 };
  assert.throws(() => classify(source, source, [], config), /候选校验异常/);
  assert.throws(() => classify(source, source, [{ x: 310, y: 310 }], config), /候选校验异常/);
  assert.throws(() => solveCandidates([{ point: source, value: 10 }], 1, config));
  assert.throws(() => solveCandidates([{ point: source, value: 10 }, { point: source, value: 10 }], 1, config), /重合/);
});

test('seeded property: true source survives all records for 3, 4, and 5 observations in both levels', () => {
  for (const level of [1, 2]) {
    for (const count of [3, 4, 5]) {
      const current = makeConfig({ measurements: count });
      const rng = seededRandom(`true-source-${level}-${count}`);
      for (let iteration = 0; iteration < 500; iteration++) {
        const source = generateSource(level, current, rng);
        const points = [];
        while (points.length < count) {
          const point = { x: rng() * current.width, y: rng() * current.height };
          if (validPoint(point, level, current) && points.every(existing => distance(existing, point) >= current.minPointDistanceRatio * current.height)) points.push(point);
        }
        const records = observations(source, points, level, current);
        const candidates = solveCandidates(records, level, current);
        assert.ok(includes(candidates, source, current), JSON.stringify({ level, count, iteration, source, points, candidates }));
        assert.equal(classify(source, source, candidates, current).status, 'success');
        for (const candidate of candidates) {
          assert.ok(validPoint(candidate, level, current));
          for (const record of records) {
            const predicted = signal(candidate, record.point, level, current).value;
            assert.ok(Math.abs(predicted - record.value) <= current.numericRelativeTolerance * Math.max(1, predicted, record.value));
          }
        }
      }
    }
  }
});
