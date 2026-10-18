import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSession } from '../src/session.js';
import { classify, signal, solveCandidates } from '../src/engine.js';

const source = { x: 400, y: 300 };
const points = [
  { x: 120.25, y: 100.75 }, { x: 1350, y: 100 }, { x: 150, y: 850 },
  { x: 1400, y: 850 }, { x: 600, y: 650 },
];

function create(overrides = {}, dependencies = {}) {
  return new GameSession({ measurementMs: 20, ...overrides }, { now: () => 1000, ...dependencies });
}

function measure(game, point, now) {
  assert.equal(game.select(point), true);
  assert.equal(game.beginMeasurement(now), true);
  assert.equal(game.tick(now + game.state.config.measurementMs), true);
}

function completeMeasurements(game, startedAt = 0) {
  for (let index = 0; index < game.state.config.measurements; index += 1) {
    measure(game, points[index], startedAt + index * 100 + 10);
  }
}

test('selection is continuous, silent, cancellable, and never consumes a measurement', () => {
  let reads = 0;
  const game = create({}, { signal: (...args) => { reads += 1; return signal(...args); } });
  assert.equal(game.state.phase, 'home');
  assert.equal(game.elapsedMs, 0);
  assert.equal(game.select(points[0]), false);
  game.start(1, { source, now: 100 });
  assert.equal(game.select(points[0]), true);
  assert.deepEqual(game.state.pending, points[0]);
  assert.equal(game.state.used, 0);
  assert.equal(game.cancelSelection(), true);
  assert.equal(game.state.pending, null);
  assert.equal(game.cancelSelection(), false);
  assert.equal(game.beginMeasurement(101), false);
  assert.equal(game.submit(101), false);
  assert.equal(game.tick(10000), false);
  assert.equal(reads, 0);
});

test('rapid confirmations and movement cannot alter a locked measurement or debit twice', () => {
  const game = create();
  game.start(1, { source, now: 0 });
  const selected = { ...points[0] };
  game.select(selected);
  selected.x = 999;
  assert.equal(game.beginMeasurement(10), true);
  assert.equal(game.state.measurementStartedAt, 10);
  assert.equal(game.state.measurementDeadline, 30);
  for (let index = 0; index < 12; index += 1) {
    assert.equal(game.beginMeasurement(11 + index), false);
    assert.equal(game.select(points[1]), false);
    assert.equal(game.cancelSelection(), false);
  }
  assert.equal(game.state.used, 1);
  assert.equal(game.tick(29.999), false);
  assert.equal(game.state.records.length, 0);
  assert.equal(game.tick(30), true);
  assert.equal(game.tick(9999), false);
  assert.deepEqual(game.state.records[0].point, points[0]);
  assert.equal(game.state.used, 1);
  assert.equal(game.state.records.length, 1);
  assert.equal(game.state.phase, 'select');
  assert.ok(Object.isFrozen(game.state.records[0].point));
});

for (const level of [1, 2]) {
  test(`default level ${level} uses three one-second locked measurements and reveals percentages only after submission`, () => {
    let judgements = 0;
    const game = new GameSession({}, {
      now: () => 0,
      classify: (...args) => { judgements += 1; return classify(...args); },
    });
    const assertUnrevealed = () => {
      assert.equal(game.state.result, null);
      assert.equal(judgements, 0);
      assert.ok(!JSON.stringify(game.state).includes('"errorPercent"'));
      assert.ok(!JSON.stringify(game.state).includes('"nearestPercent"'));
    };
    assert.equal(game.nextConfig.version, '0.4.2');
    assert.equal(game.nextConfig.measurements, 3);
    assert.equal(game.nextConfig.measurementMs, 1000);
    assertUnrevealed();
    game.start(level, { source, now: 0 });
    assertUnrevealed();
    for (let index = 0; index < 3; index++) {
      const now = index * 1000;
      assert.equal(game.select(points[index]), true);
      assertUnrevealed();
      assert.equal(game.submit(now), false);
      assert.equal(game.beginMeasurement(now), true);
      assert.equal(game.state.measurementDeadline, now + 1000);
      for (let repeat = 0; repeat < 10; repeat++) {
        assert.equal(game.beginMeasurement(now + repeat), false);
        assert.equal(game.select(points[(index + 1) % 3]), false);
        assert.equal(game.cancelSelection(), false);
        assert.equal(game.submit(now + repeat), false);
      }
      assert.equal(game.state.used, index + 1);
      assert.equal(game.tick(now + 999), false);
      assert.equal(game.state.records.length, index);
      assertUnrevealed();
      assert.equal(game.tick(now + 1000), true);
      assert.equal(game.tick(now + 1000), false);
      assert.equal(game.state.records.length, index + 1);
      assertUnrevealed();
    }
    assert.equal(game.state.phase, 'locate');
    assert.equal(game.beginMeasurement(4000), false);
    assert.equal(game.submit(4000), false);
    assert.equal(game.select(points[2]), true);
    assertUnrevealed();
    assert.equal(game.cancelSelection(), true);
    assertUnrevealed();
    assert.equal(game.select(source), true);
    assertUnrevealed();
    assert.equal(game.submit(4500), true);
    assert.equal(game.state.phase, 'result');
    assert.equal(game.state.result.status, 'success');
    assert.equal(game.state.result.errorPercent, 0);
    assert.ok(game.state.result.nearestPercent < 1e-8);
    assert.equal(judgements, 1);
    assert.equal(game.submit(4501), false);
    assert.equal(judgements, 1);
    game.start(level, { source: { x: 1200, y: 650 }, now: 5000 });
    assert.equal(game.state.result, null);
    assert.ok(!JSON.stringify(game.state).includes('"errorPercent"'));
    assert.ok(!JSON.stringify(game.state).includes('"nearestPercent"'));
  });
}

test('invalid points, wall boundaries, and duplicate or nearby measurements are rejected', () => {
  const game = create();
  game.start(2, { source, now: 0 });
  const { wall, width, height } = game.state.config;
  for (const point of [
    { x: -1, y: 10 }, { x: width + 1, y: 10 }, { x: 1, y: height + 1 },
    { x: NaN, y: 10 }, { x: Infinity, y: 10 },
    { x: wall.x, y: wall.y },
    { x: wall.x + wall.width / 2, y: wall.y + wall.height / 2 },
  ]) assert.equal(game.select(point), false);
  measure(game, points[0], 10);
  assert.equal(game.select(points[0]), false);
  assert.equal(game.select({ x: points[0].x + 1, y: points[0].y }), false);
  const spacing = Math.min(width, height) * game.state.config.minPointDistanceRatio;
  assert.equal(game.select({ x: points[0].x + spacing, y: points[0].y }), true);
  assert.equal(game.state.used, 1);
});

for (const measurements of [3, 4, 5]) {
  test(`${measurements} measurements require a separate final selection and confirmation`, () => {
    let reads = 0;
    const game = create({ measurements }, { signal: (...args) => { reads += 1; return signal(...args); } });
    game.start(1, { source, now: 100 });
    completeMeasurements(game, 100);
    assert.equal(game.state.phase, 'locate');
    assert.equal(game.state.records.length, measurements);
    assert.equal(game.state.used, measurements);
    assert.equal(game.state.guess, null);
    assert.equal(game.beginMeasurement(800), false);
    assert.equal(game.submit(800), false);
    assert.equal(game.select(points[2]), true);
    assert.equal(game.state.result, null);
    assert.equal(game.cancelSelection(), true);
    assert.equal(game.submit(800), false);
    assert.equal(game.select(source), true);
    assert.equal(reads, measurements);
    assert.equal(game.submit(900), true);
    assert.equal(game.state.phase, 'result');
    assert.equal(game.state.result.error, 0);
    assert.equal(game.state.result.elapsedMs, 800);
    assert.equal(game.elapsed(20000), 800);
    assert.equal(game.submit(901), false);
    assert.equal(game.select(points[1]), false);
    assert.equal(game.cancelSelection(), false);
    assert.equal(reads, measurements);
  });
}

test('next-game configuration cannot alter an in-progress game or its timer', () => {
  const game = create();
  const initial = game.start(1, { source, now: 0 });
  game.select(points[0]);
  game.beginMeasurement(10);
  assert.equal(game.configure({ measurements: 5, measurementMs: 200, K: 200 }), true);
  assert.equal(game.state.config.measurements, 3);
  assert.equal(game.state.config.K, initial.config.K);
  assert.equal(game.state.measurementDeadline, 30);
  assert.equal(game.nextConfig.measurements, 5);
  game.tick(30);
  measure(game, points[1], 100);
  assert.equal(game.state.phase, 'select');
  measure(game, points[2], 200);
  assert.equal(game.state.phase, 'locate');
  const next = game.start(2, { source: { x: 1200, y: 650 }, now: 400 });
  assert.equal(next.config.measurements, 5);
  assert.equal(next.config.measurementMs, 200);
  assert.equal(next.config.K, 200);
  assert.equal(next.records.length, 0);
  assert.ok(Object.isFrozen(next.config));
});

test('replaying or changing levels during measurement discards all previous work', () => {
  for (const nextLevel of [1, 2]) {
    const game = create();
    game.start(1, { source, now: 0 });
    game.select(points[0]);
    game.beginMeasurement(10);
    const newSource = { x: 1200, y: 650 };
    game.start(nextLevel, { source: newSource, now: 15 });
    assert.equal(game.tick(30), false);
    assert.equal(game.state.level, nextLevel);
    assert.deepEqual(game.state.source, newSource);
    assert.equal(game.state.used, 0);
    assert.equal(game.state.records.length, 0);
    game.select(points[1]);
    game.beginMeasurement(31);
    assert.equal(game.tick(50), false);
    assert.equal(game.tick(51), true);
    assert.deepEqual(game.state.records[0].point, points[1]);
    assert.equal(game.state.records[0].value, signal(newSource, points[1], nextLevel, game.state.config).value);
  }
});

test('returning home cancels a measurement and retains next-game settings', () => {
  const game = create();
  game.start(1, { source, now: 0 });
  game.select(points[0]);
  game.beginMeasurement(10);
  game.configure({ measurements: 5 });
  assert.equal(game.resetToHome(), true);
  assert.equal(game.tick(30), false);
  assert.equal(game.state.phase, 'home');
  assert.equal(game.state.source, null);
  assert.equal(game.state.used, 0);
  assert.equal(game.elapsed(300), 0);
  assert.equal(game.state.config.measurements, 5);
});

test('automatic source generation excludes the previous source even with a fixed RNG', () => {
  const game = create();
  const first = game.start(1, { rng: () => 0.25, now: 0 }).source;
  const second = game.start(2, { rng: () => 0.25, now: 10 }).source;
  assert.notDeepEqual(second, first);
  assert.equal(game.state.records.length, 0);
  assert.equal(game.state.used, 0);
});

test('missing true-source candidates enter a recoverable error and do not count as a loss', () => {
  let fail = true;
  const game = create({}, {
    solveCandidates: (...args) => fail ? [] : solveCandidates(...args),
  });
  game.start(1, { source, now: 0 });
  completeMeasurements(game);
  game.select(source);
  const records = game.state.records;
  assert.equal(game.submit(500), true);
  assert.equal(game.state.phase, 'error');
  assert.equal(game.state.result, null);
  assert.ok(game.state.error);
  assert.equal(game.state.records, records);
  assert.equal(game.elapsed(10000), 500);
  assert.equal(game.retryJudgement(600), true);
  assert.equal(game.state.phase, 'error');
  fail = false;
  assert.equal(game.retryJudgement(800), true);
  assert.equal(game.state.phase, 'result');
  assert.equal(game.state.error, null);
  assert.equal(game.state.result.error, 0);
  assert.equal(game.state.result.elapsedMs, 500);
  assert.equal(game.state.records, records);
  assert.equal(game.retryJudgement(900), false);
});

test('a thrown solver failure also preserves the submitted guess and all measurements', () => {
  const game = create({}, { solveCandidates: () => { throw new Error('test solver failure'); } });
  game.start(2, { source, now: 0 });
  completeMeasurements(game);
  game.select(source);
  assert.equal(game.submit(500), true);
  assert.equal(game.state.phase, 'error');
  assert.deepEqual(game.state.guess, source);
  assert.equal(game.state.records.length, 3);
  assert.equal(game.state.used, 3);
  assert.equal(game.state.result, null);
  game.start(1, { source, now: 700 });
  assert.equal(game.state.error, null);
  assert.equal(game.state.records.length, 0);
});

test('game instances keep their source, records, settings, and progress independent', () => {
  const first = create();
  const second = create({ measurements: 5 });
  first.start(1, { source, now: 0 });
  second.start(2, { source: { x: 1200, y: 700 }, now: 50 });
  measure(first, points[0], 10);
  assert.equal(second.state.used, 0);
  assert.equal(second.state.records.length, 0);
  assert.equal(second.state.config.measurements, 5);
  second.resetToHome();
  assert.equal(first.state.records.length, 1);
  assert.deepEqual(first.state.source, source);
});
