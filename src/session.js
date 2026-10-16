import { makeConfig } from './config.js';
import { classify, distance, generateSource, signal, solveCandidates, validPoint } from './engine.js';

const defaultNow = () => performance.now();

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function pointCopy(point) {
  return { x: point.x, y: point.y };
}

function homeState(config) {
  return freeze({
    phase: 'home', level: null, config, source: null, records: [],
    pending: null, guess: null, used: 0, startedAt: null, endedAt: null,
    measurementStartedAt: null, measurementDeadline: null, result: null, error: null,
  });
}

/**
 * A timer-free game state machine. The UI supplies monotonic timestamps to tick;
 * no callback retains a source or point from a previous game.
 *
 * State snapshots are read-only. Read `state` again after an accepted action.
 * A true return value means an action was accepted, including a submission
 * whose solver then enters the recoverable `error` state.
 */
export class GameSession {
  #state;
  #nextConfig;
  #lastSource = null;
  #clock;
  #dependencies;

  constructor(overrides = {}, dependencies = {}) {
    this.#nextConfig = makeConfig(overrides);
    this.#state = homeState(this.#nextConfig);
    this.#clock = dependencies.now ?? defaultNow;
    this.#dependencies = {
      signal, solveCandidates, classify, generateSource, ...dependencies,
    };
  }

  get state() { return this.#state; }
  get nextConfig() { return this.#nextConfig; }
  get elapsedMs() { return this.elapsed(); }

  elapsed(now = this.#clock()) {
    if (this.#state.startedAt === null) return 0;
    const end = this.#state.endedAt ?? now;
    return Number.isFinite(end) ? Math.max(0, end - this.#state.startedAt) : 0;
  }

  configure(overrides = {}) {
    this.#nextConfig = makeConfig({
      ...this.#nextConfig,
      ...overrides,
      wall: { ...this.#nextConfig.wall, ...overrides.wall },
    });
    return true;
  }

  start(level, { source, rng = Math.random, now = this.#clock() } = {}) {
    if (level !== 1 && level !== 2) throw new RangeError('关卡必须是 1 或 2。');
    if (!Number.isFinite(now)) throw new TypeError('开局时间必须是有限数值。');
    const config = this.#nextConfig;
    const nextSource = source ?? this.#dependencies.generateSource(level, config, rng, this.#lastSource);
    if (!validPoint(nextSource, level, config)) throw new RangeError('信号源位置无效。');
    const copiedSource = pointCopy(nextSource);
    this.#lastSource = copiedSource;
    this.#state = freeze({
      ...homeState(config), phase: 'select', level,
      source: copiedSource, startedAt: now,
    });
    return this.#state;
  }

  #pointAllowed(point, forMeasurement) {
    const { config, level, records } = this.#state;
    if (!validPoint(point, level, config)) return false;
    if (!forMeasurement) return true;
    const minimum = Math.min(config.width, config.height) * config.minPointDistanceRatio;
    return records.every(record => {
      const separation = distance(record.point, point);
      return separation > 0 && separation >= minimum;
    });
  }

  select(point) {
    const { phase } = this.#state;
    if (phase !== 'select' && phase !== 'locate') return false;
    if (!this.#pointAllowed(point, phase === 'select')) return false;
    this.#state = freeze({
      ...this.#state,
      [phase === 'select' ? 'pending' : 'guess']: pointCopy(point),
    });
    return true;
  }

  cancelSelection() {
    const { phase, pending, guess } = this.#state;
    const field = phase === 'select' && pending ? 'pending' : phase === 'locate' && guess ? 'guess' : null;
    if (!field) return false;
    this.#state = freeze({ ...this.#state, [field]: null });
    return true;
  }

  beginMeasurement(now = this.#clock()) {
    const { phase, pending, used, config } = this.#state;
    if (phase !== 'select' || !pending || used >= config.measurements || !Number.isFinite(now)) return false;
    if (!this.#pointAllowed(pending, true)) return false;
    this.#state = freeze({
      ...this.#state, phase: 'measuring', used: used + 1,
      pending: pointCopy(pending), measurementStartedAt: now,
      measurementDeadline: now + config.measurementMs,
    });
    return true;
  }

  tick(now = this.#clock()) {
    const current = this.#state;
    if (current.phase !== 'measuring' || !Number.isFinite(now) || now < current.measurementDeadline) return false;
    const reading = this.#dependencies.signal(current.source, current.pending, current.level, current.config);
    const record = { point: pointCopy(current.pending), ...reading };
    this.#state = freeze({
      ...current,
      phase: current.used >= current.config.measurements ? 'locate' : 'select',
      records: [...current.records, record], pending: null,
      measurementStartedAt: null, measurementDeadline: null,
    });
    return true;
  }

  #judge() {
    const current = this.#state;
    try {
      const candidates = this.#dependencies.solveCandidates(current.records, current.level, current.config);
      const classification = this.#dependencies.classify(current.guess, current.source, candidates, current.config);
      this.#state = freeze({
        ...current, phase: 'result', error: null,
        result: { ...classification, candidates, elapsedMs: this.elapsed() },
      });
    } catch {
      this.#state = freeze({
        ...current, phase: 'error', result: null,
        error: '判定暂时无法完成，测量记录已保留。请重试判定或重新开始。',
      });
    }
    return true;
  }

  submit(now = this.#clock()) {
    const { phase, guess, records, config } = this.#state;
    if (phase !== 'locate' || !guess || records.length !== config.measurements || !Number.isFinite(now)) return false;
    if (!this.#pointAllowed(guess, false)) return false;
    this.#state = freeze({ ...this.#state, endedAt: now });
    return this.#judge();
  }

  retryJudgement(now = this.#clock()) {
    if (this.#state.phase !== 'error' || !Number.isFinite(now)) return false;
    // The player's clock stopped on their original submission; a program
    // failure and retry must not add time to their recorded result.
    return this.#judge();
  }

  resetToHome() {
    this.#state = homeState(this.#nextConfig);
    return true;
  }
}
