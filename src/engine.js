export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function wallForLevel(level, config) {
  if (level !== 1 && level !== 2) throw new RangeError('关卡必须为 1 或 2');
  return level === 2 ? config.wall : null;
}

export function validPoint(point, level, config) {
  const wall = wallForLevel(level, config);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || point.x < 0 || point.x > config.width || point.y < 0 || point.y > config.height) return false;
  return !wall || point.x < wall.x || point.x > wall.x + wall.width
    || point.y < wall.y || point.y > wall.y + wall.height;
}

/** Clip against open rectangle slabs. A boundary-only contact has no interior interval. */
export function crossesWall(a, b, wall, epsilon = 1e-9) {
  if (!wall) return false;
  const length = distance(a, b);
  if (length === 0) return false;
  let enter = 0;
  let leave = 1;
  for (const [axis, boundaryStart, boundaryEnd] of [
    ['x', wall.x, wall.x + wall.width],
    ['y', wall.y, wall.y + wall.height],
  ]) {
    // Resolve points within numerical precision of an edge as that edge. This
    // keeps an analytically tangent path tangent after circle inversion has
    // introduced a few coordinate ulps (epsilon is 1e-9 logical units).
    const start = boundaryStart + epsilon;
    const end = boundaryEnd - epsilon;
    if (start >= end) return false;
    const delta = b[axis] - a[axis];
    if (delta === 0) {
      if (a[axis] <= start || a[axis] >= end) return false;
      continue;
    }
    const first = (start - a[axis]) / delta;
    const last = (end - a[axis]) / delta;
    enter = Math.max(enter, Math.min(first, last));
    leave = Math.min(leave, Math.max(first, last));
    if (leave <= enter) return false;
  }
  // Exclude intervals below the same numerical resolution.
  return (leave - enter) * length > epsilon;
}

export function signal(source, point, level, config) {
  if (!validPoint(source, level, config) || !validPoint(point, level, config)) {
    throw new RangeError('信号源和测点必须在有效地图区域');
  }
  const attenuated = crossesWall(source, point, wallForLevel(level, config), config.geometryEpsilon);
  const r = distance(source, point) / Math.min(config.width, config.height);
  const sourceContribution = (attenuated ? config.wallTransmission : 1) * config.K / (r * r + config.h * config.h);
  return { value: config.b + sourceContribution, sourceContribution, attenuated };
}

/** Accepts the total reading; subtract background exactly once for the fixed meter. */
export function meter(value, config) {
  if (!Number.isFinite(value)) return 0;
  const contribution = Math.max(0, value - config.b);
  const maximum = config.K / (config.h * config.h);
  return Math.min(1, Math.max(0, Math.log1p(contribution / config.meterScale) / Math.log1p(maximum / config.meterScale)));
}

export function seededRandom(seed) {
  let state = 2166136261;
  for (const character of String(seed)) {
    state = Math.imul(state ^ character.codePointAt(0), 16777619) >>> 0;
  }
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSource(level, config, rng = Math.random, exclude = null) {
  const margin = Math.min(config.width, config.height) * config.sourceMarginRatio;
  const xRange = config.width - 2 * margin;
  const yRange = config.height - 2 * margin;
  const allowed = point => validPoint(point, level, config)
    && (!exclude || distance(point, exclude) > config.candidateMergeDistance);
  for (let attempt = 0; attempt < 256; attempt++) {
    const xRandom = rng();
    const yRandom = rng();
    if (![xRandom, yRandom].every(value => Number.isFinite(value) && value >= 0 && value < 1)) {
      throw new RangeError('随机数生成器必须返回 [0, 1) 中的有限数值');
    }
    const point = { x: margin + xRandom * xRange, y: margin + yRandom * yRange };
    if (allowed(point)) return point;
  }
  // A constant or unlucky debug RNG must not hang the game.
  for (let y = 0; y <= 8; y++) {
    for (let x = 0; x <= 8; x++) {
      const point = { x: margin + xRange * x / 8, y: margin + yRange * y / 8 };
      if (allowed(point)) return point;
    }
  }
  throw new Error('当前配置没有可生成的独立源位置');
}

function readingMatches(actual, expected, tolerance) {
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(actual), Math.abs(expected));
}

/**
 * Enumerate attenuation hypotheses, intersect the furthest pair of circles,
 * and validate every observation using the actual wall geometry. All geometry
 * is normalized by the short edge to keep round-off independent of display size.
 */
export function solveCandidates(records, level, config) {
  wallForLevel(level, config);
  if (!Array.isArray(records) || records.length < 2 || records.length > 5) {
    throw new RangeError('候选求解需要 2 至 5 条完整测量记录');
  }
  for (const record of records) {
    if (!validPoint(record.point, level, config) || !Number.isFinite(record.value) || record.value <= config.b) {
      throw new RangeError('测量记录无效');
    }
  }
  const scale = Math.min(config.width, config.height);
  const points = records.map(record => ({ x: record.point.x / scale, y: record.point.y / scale }));
  let pair = [0, 1];
  let separation = 0;
  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      const current = distance(points[a], points[b]);
      if (current > separation) {
        separation = current;
        pair = [a, b];
      }
    }
  }
  if (separation <= config.geometryEpsilon / scale) throw new Error('测点重合，无法求有限候选集合');
  const [first, second] = pair;
  const a = points[first];
  const b = points[second];
  const direction = { x: (b.x - a.x) / separation, y: (b.y - a.y) / separation };
  const candidates = [];
  const hypothesisCount = level === 2 ? 2 ** records.length : 1;
  for (let mask = 0; mask < hypothesisCount; mask++) {
    const radiusSquares = records.map((record, index) => {
      const attenuation = level === 2 && (mask & (1 << index)) ? config.wallTransmission : 1;
      return attenuation * config.K / (record.value - config.b) - config.h * config.h;
    });
    // This allowance covers arithmetic cancellation at zero distance only.
    const roundoff = 64 * Number.EPSILON * Math.max(1, ...radiusSquares.map(Math.abs));
    if (radiusSquares.some(square => square < -roundoff)) continue;
    for (let index = 0; index < radiusSquares.length; index++) radiusSquares[index] = Math.max(0, radiusSquares[index]);
    const along = (radiusSquares[first] - radiusSquares[second] + separation * separation) / (2 * separation);
    const heightSquare = radiusSquares[first] - along * along;
    // Distance inversion is ill-conditioned for a distant source and a small
    // collinear cluster. Propagate the division by separation before deciding
    // a negative height is physically impossible; final model validation still
    // rejects every candidate that does not explain the complete record set.
    const heightRoundoff = roundoff * (1 + Math.abs(along) / separation);
    if (heightSquare < -heightRoundoff) continue;
    const height = Math.sqrt(Math.max(0, heightSquare));
    for (const sign of height === 0 ? [1] : [1, -1]) {
      const candidate = {
        x: (a.x + direction.x * along - direction.y * height * sign) * scale,
        y: (a.y + direction.y * along + direction.x * height * sign) * scale,
      };
      // Snap only round-off outside an exact map edge; never move a wall-edge point.
      for (const [axis, maximum] of [['x', config.width], ['y', config.height]]) {
        if (candidate[axis] < 0 && candidate[axis] >= -config.geometryEpsilon) candidate[axis] = 0;
        if (candidate[axis] > maximum && candidate[axis] <= maximum + config.geometryEpsilon) candidate[axis] = maximum;
      }
      if (!validPoint(candidate, level, config)) continue;
      const consistent = records.every(record => readingMatches(
        signal(candidate, record.point, level, config).value, record.value, config.numericRelativeTolerance,
      ));
      if (!consistent) continue;
      if (!candidates.some(existing => distance(existing, candidate) <= config.candidateMergeDistance)) candidates.push(candidate);
    }
  }
  return candidates;
}

export function classify(guess, source, candidates, config) {
  if (!candidates?.length || !candidates.some(candidate => distance(candidate, source) <= config.candidateMergeDistance)) {
    throw new Error('候选校验异常：真实源不在候选集合中，请重试本关');
  }
  if (!guess || !Number.isFinite(guess.x) || !Number.isFinite(guess.y)) throw new RangeError('最终定位点无效');
  const error = distance(guess, source);
  const candidate = candidates.reduce((nearest, current) => distance(guess, current) < distance(guess, nearest) ? current : nearest);
  const nearestDistance = distance(guess, candidate);
  const scale = Math.min(config.width, config.height);
  // A few ulps ensure inclusive boundaries survive coordinate subtraction.
  const boundaryEpsilon = 16 * Number.EPSILON * Math.max(config.width, config.height);
  let status = 'miss';
  let label = '尚未定位';
  if (error <= config.successRatio * scale + boundaryEpsilon) {
    status = 'success';
    label = '定位成功';
  } else if (nearestDistance <= config.successRatio * scale + boundaryEpsilon) {
    status = 'reasonable';
    label = '合理判断（存在多解）';
  } else if (nearestDistance <= config.nearRatio * scale + boundaryEpsilon) {
    status = 'near';
    label = '接近可行位置';
  }
  return { status, label, error, nearestDistance, candidate };
}
