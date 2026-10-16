const defaults = {
  version: '0.1.0',
  width: 1600,
  height: 1000,
  measurements: 3,
  measurementMs: 3000,
  K: 100,
  h: 0.10,
  b: 5,
  wallTransmission: 0.5,
  meterScale: 20,
  displayDecimals: 1,
  successRatio: 0.05,
  nearRatio: 0.10,
  sourceMarginRatio: 0.02,
  minPointDistanceRatio: 0.01,
  collinearRatio: 0.03,
  // Numerical tolerances are independent of the player's spatial tolerances.
  numericRelativeTolerance: 1e-10,
  geometryEpsilon: 1e-9,
  candidateMergeDistance: 1e-3,
  demoMs: 12000,
  wall: { x: 780, y: 230, width: 40, height: 540 },
};

function freeze(config) {
  Object.freeze(config.wall);
  return Object.freeze(config);
}

export const DEFAULT_CONFIG = freeze({ ...defaults, wall: { ...defaults.wall } });

/** Make an independently owned, immutable configuration for one game. */
export function makeConfig(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('配置必须是对象');
  }
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(defaults, key)) throw new RangeError(`未知配置：${key}`);
  }
  if (overrides.wall !== undefined && (!overrides.wall || typeof overrides.wall !== 'object' || Array.isArray(overrides.wall))) {
    throw new TypeError('屏障配置必须是对象');
  }
  for (const key of Object.keys(overrides.wall ?? {})) {
    if (!Object.hasOwn(defaults.wall, key)) throw new RangeError(`未知屏障配置：${key}`);
  }
  const config = { ...defaults, ...overrides, wall: { ...defaults.wall, ...overrides.wall } };
  const positive = ['width', 'height', 'K', 'h', 'meterScale', 'successRatio', 'nearRatio', 'numericRelativeTolerance', 'candidateMergeDistance', 'demoMs'];
  const nonnegative = ['measurementMs', 'b', 'sourceMarginRatio', 'minPointDistanceRatio', 'collinearRatio', 'geometryEpsilon'];
  for (const key of positive) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) throw new RangeError(`${key} 必须是有限正数`);
  }
  for (const key of nonnegative) {
    if (!Number.isFinite(config[key]) || config[key] < 0) throw new RangeError(`${key} 必须是有限非负数`);
  }
  if (typeof config.version !== 'string' || !config.version.trim()) throw new RangeError('版本号不能为空');
  if (!Number.isInteger(config.measurements) || config.measurements < 3 || config.measurements > 5) {
    throw new RangeError('首版支持每关 3 至 5 次测量');
  }
  if (!Number.isInteger(config.displayDecimals) || config.displayDecimals < 0 || config.displayDecimals > 6) {
    throw new RangeError('显示小数位须为 0 至 6 的整数');
  }
  if (!Number.isFinite(config.wallTransmission) || config.wallTransmission <= 0 || config.wallTransmission > 1) {
    throw new RangeError('屏障透过系数须大于 0 且不超过 1');
  }
  if (config.nearRatio < config.successRatio || config.nearRatio > 1) throw new RangeError('接近容差须不小于成功容差且不超过短边');
  if (config.sourceMarginRatio >= 0.5 || config.minPointDistanceRatio >= 0.5 || config.collinearRatio > 1) {
    throw new RangeError('地图比例参数超出有效范围');
  }
  if (config.numericRelativeTolerance > 1e-7) throw new RangeError('候选数值误差不能替代玩家空间容差');
  const wall = config.wall;
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(wall[key]) || wall[key] <= 0) throw new RangeError(`屏障 ${key} 必须是有限正数`);
  }
  if (wall.x + wall.width >= config.width || wall.y + wall.height >= config.height) {
    throw new RangeError('屏障两侧和两端必须留出空间');
  }
  const margin = Math.min(config.width, config.height) * config.sourceMarginRatio;
  if (wall.x <= margin && wall.x + wall.width >= config.width - margin && wall.y <= margin && wall.y + wall.height >= config.height - margin) {
    throw new RangeError('屏障不能覆盖全部源生成区域');
  }
  return freeze(config);
}
