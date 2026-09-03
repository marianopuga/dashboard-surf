// ===========================================================================
// Scoring engine
//
// Pure functions, no DOM, no fetch. Everything on the page — the spot list, the
// per-spot forecast tiles, the map arrows, the time slider — scores through
// here, so "how good is it" is defined in exactly one place.
//
// The engine takes a normalised `cond` object rather than a raw API payload, so
// it does not care whether the numbers came from the measured MHL buoy or from
// the forecast model:
//
//   cond = {
//     hs:           significant wave height, metres (buoy Hs units)
//     periodS:      peak period, seconds
//     swellFromDeg: compass bearing the swell is coming FROM
//     windFromDeg:  compass bearing the wind is coming FROM
//     windKmh:      wind speed, km/h
//     tideState:    "low" | "mid" | "high" | null
//   }
//
// Tiers are assigned by explicit rules rather than by thresholding a blended
// number. A weighted sum can drift as weights are tuned; a rule cannot. The
// rubric this encodes is:
//
//   going off its tits — overhead, offshore, on long-period ground swell
//   pumping            — head high or overhead, with offshore wind
//   ok                 — rideable, with offshore wind or no real wind at all
//   flat               — anything else
//
// The continuous `total` exists only to order spots *within* a tier. The three
// contributions it is built from are shown permanently in the UI, so they are
// deliberately harsh: direction and size multiply rather than average, wind
// falls off as a cosine rather than linearly, and tide reports null where the
// spot has no tide preference instead of a free 1.0. An earlier, gentler set
// produced the obvious tell that a "flat" spot could still show swell in the
// seventies and tide at a hundred.
// ===========================================================================

/** Wind at or below this is treated as "no wind" for rubric purposes. */
const LIGHT_WIND_KMH = 10;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Smallest angle between two compass bearings, 0–180. */
function angleDiff(a, b) {
  if (a == null || b == null) return null;
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Is `bearing` inside the arc running clockwise from `a0` to `a1`? */
function inArc(bearing, a0, a1) {
  if (bearing == null) return false;
  const span = (a1 - a0 + 360) % 360;
  const off = (bearing - a0 + 360) % 360;
  return off <= span;
}

/** Degrees by which `bearing` misses the arc; 0 when it is inside. */
function arcMiss(bearing, a0, a1) {
  if (bearing == null) return 180;
  if (inArc(bearing, a0, a1)) return 0;
  return Math.min(angleDiff(bearing, a0), angleDiff(bearing, a1));
}

/**
 * Swell windows are hand-drawn round numbers, so their edges are soft in
 * reality. Without a shoulder a swell 2° outside a window flips a spot from
 * rideable to flat, which is a cliff in the data rather than in the ocean —
 * a due-south 172° swell would read "flat" everywhere against a window that
 * happens to stop at 170°. The swell contribution still decays smoothly, so a
 * shoulder spot scores low rather than being silently promoted.
 */
const WINDOW_SHOULDER_DEG = 12;

const SIZE_ORDER = ["flat", "small", "chest", "head_high", "overhead"];
const SIZE_LABEL = {
  flat: "flat",
  small: "small",
  chest: "chest high",
  head_high: "head high",
  overhead: "overhead",
};

/**
 * Where this swell sits on *this* spot's personal size ladder. The bands below
 * head high are derived by splitting the spot's rideable range, so no extra
 * hand-authored numbers are needed beyond good_size_m and size_ref_m.
 */
function classifySize(spot, hs) {
  if (hs == null) return "flat";
  const min = spot.good_size_m[0];
  const { head_high, overhead } = spot.size_ref_m;
  if (hs < min) return "flat";
  if (hs >= overhead) return "overhead";
  if (hs >= head_high) return "head_high";
  return hs < (min + head_high) / 2 ? "small" : "chest";
}

const atLeastHeadHigh = (sizeClass) =>
  SIZE_ORDER.indexOf(sizeClass) >= SIZE_ORDER.indexOf("head_high");

/**
 * Wind relative to the beach. Direction and strength are kept separate on
 * purpose: a 5 km/h offshore breeze is both "light" and "offshore", and the
 * rubric needs to see the direction rather than have it swallowed by the
 * light-wind case.
 */
function classifyWind(spot, windFromDeg, windKmh) {
  if (windFromDeg == null) return { dir: "unknown", light: windKmh != null && windKmh < LIGHT_WIND_KMH, rel: null };
  const rel = angleDiff(windFromDeg, (spot.facing_deg + 180) % 360); // 0 = straight offshore
  const light = windKmh != null && windKmh < LIGHT_WIND_KMH;
  let dir;
  if (rel < 45) dir = "offshore";
  else if (rel < 100) dir = "cross";
  else dir = "onshore";
  return { dir, light, rel };
}

// --- continuous contributions, used for the visible breakdown and ordering ---

/**
 * Size fit across a spot's rideable band. The falloff inside the band is steep
 * on purpose: the old 0.3 coefficient meant anything merely *rideable* scored
 * at least 0.7, so a knee-high day still showed a swell score in the high
 * seventies. At 0.65 the bottom of the band scores ~0.35, which is what
 * "technically surfable" should look like next to a properly good day.
 */
function triangularScore(v, [lo, hi]) {
  if (v == null) return 0.5;
  const mid = (lo + hi) / 2;
  if (v >= lo && v <= hi) return 1 - (0.65 * Math.abs(v - mid)) / ((hi - lo) / 2 || 1);
  const dist = v < lo ? lo - v : v - hi;
  return Math.max(0, 0.35 - dist / (hi - lo || 1));
}

/**
 * How well the swell direction gets into this spot at all. Full marks inside
 * the window, half by the edge of the shoulder, nothing much beyond it — the
 * old version gave a swell 60° off the window ~0.5 just for existing, which is
 * why a "flat" spot could still show a swell score in the seventies.
 */
function windowFit(spot, cond) {
  const miss = arcMiss(cond.swellFromDeg, spot.swell_window[0], spot.swell_window[1]);
  if (miss === 0) return 1;
  if (miss <= WINDOW_SHOULDER_DEG) return 1 - 0.5 * (miss / WINDOW_SHOULDER_DEG);
  return Math.max(0, 0.5 - 0.5 * ((miss - WINDOW_SHOULDER_DEG) / 40));
}

/** Direction and size multiply rather than average: a perfect size in a swell
 *  the beach cannot see is still nothing, and the number should say so. */
function swellContribution(spot, cond) {
  if (cond.hs == null || cond.swellFromDeg == null) return 0;
  const sizeFit = triangularScore(cond.hs, spot.good_size_m);
  const periodGate = spot.min_period_s
    ? (cond.periodS != null && cond.periodS >= spot.min_period_s ? 1 : 0.35)
    : 1;
  return clamp01(windowFit(spot, cond) * sizeFit * periodGate);
}

/**
 * Wind quality, falling off as a raised cosine from straight offshore. The
 * previous linear `1 - rel/180` scored a full cross-shore at 0.5, which reads
 * as "half decent" for a wind that is actually ruining the wave. This gives
 * roughly: offshore 1.0, 45° 0.78, cross-shore 0.33, 135° 0.05, onshore 0.
 */
function windContribution(spot, cond) {
  const w = classifyWind(spot, cond.windFromDeg, cond.windKmh);
  if (w.rel == null) return w.light ? 0.65 : 0.4;
  let base = Math.pow((1 + Math.cos(w.rel * Math.PI / 180)) / 2, 1.6);
  // Glassy forgives direction — but only up to "fine", never to "great".
  if (w.light) base = Math.max(base, 0.65);
  if (cond.windKmh != null && cond.windKmh > 20 && w.rel > 110) base = Math.min(base, 0.08);
  if (cond.windKmh != null && cond.windKmh > 30) base *= 0.75; // even offshore gets bumpy
  return clamp01(base);
}

/**
 * Null — not 1 — where the spot has no tide preference. Showing a flat 100 for
 * every beach made the breakdown look like tide was carrying the score when it
 * simply does not apply; the UI renders null as "n/a".
 */
function tideContribution(spot, cond) {
  if (spot.tide_pref !== "mid-high") return null;
  if (!cond.tideState) return null;
  if (cond.tideState === "low") return 0.25;
  if (cond.tideState === "rising-from-low") return 0.6;
  if (cond.tideState === "high") return 0.9;
  return 1;
}

// --- the rubric ------------------------------------------------------------

const TIERS = {
  epic: { key: "epic", label: "going off its tits", cls: "q-epic", rank: 4 },
  pumping: { key: "pumping", label: "pumping", cls: "q-pumping", rank: 3 },
  ok: { key: "ok", label: "ok", cls: "q-ok", rank: 2 },
  flat: { key: "flat", label: "flat", cls: "q-flat", rank: 1 },
};

/**
 * Score one spot against one set of conditions.
 * Returns the tier plus the three contributions the UI shows permanently.
 */
function scoreSpot(spot, cond) {
  const sizeClass = classifySize(spot, cond.hs);
  const wind = classifyWind(spot, cond.windFromDeg, cond.windKmh);

  const miss = arcMiss(cond.swellFromDeg, spot.swell_window[0], spot.swell_window[1]);
  const inWindow = miss === 0;
  const reaches = miss <= WINDOW_SHOULDER_DEG;
  const periodOK = !spot.min_period_s || (cond.periodS != null && cond.periodS >= spot.min_period_s);
  const rideable = reaches && sizeClass !== "flat" && periodOK;

  const swell = swellContribution(spot, cond);
  const windScore = windContribution(spot, cond);
  const tide = tideContribution(spot, cond);
  // Tide only enters the weighted total where it actually applies, otherwise
  // its weight is redistributed instead of being filled with a free 1.0.
  const total = tide == null
    ? swell * 0.55 + windScore * 0.45
    : swell * 0.45 + windScore * 0.4 + tide * 0.15;

  // Long-period ground swell is what separates a big day from a great one.
  const groundSwell = cond.periodS != null && cond.periodS >= 11;

  let tier;
  if (rideable && sizeClass === "overhead" && wind.dir === "offshore" && groundSwell) tier = TIERS.epic;
  else if (rideable && atLeastHeadHigh(sizeClass) && wind.dir === "offshore") tier = TIERS.pumping;
  else if (rideable && (wind.dir === "offshore" || wind.light)) tier = TIERS.ok;
  else tier = TIERS.flat;

  // A shallow reef at dead low is not pumping however good the swell looks.
  let demoted = false;
  if (tier.rank >= 3 && spot.tide_pref === "mid-high" && cond.tideState === "low") {
    tier = TIERS.ok;
    demoted = true;
  }

  return {
    tier: tier.key,
    tierLabel: tier.label,
    tierCls: tier.cls,
    tierRank: tier.rank,
    sizeClass,
    sizeLabel: SIZE_LABEL[sizeClass],
    windDir: wind.dir,
    windLight: wind.light,
    windRel: wind.rel,
    rideable,
    inWindow,
    windowMissDeg: miss,
    periodOK,
    demotedByTide: demoted,
    swell,
    wind: windScore,
    tide,
    total,
  };
}

/** Sort helper: tier first, then the continuous score within the tier. */
function compareScored(a, b) {
  return b.score.tierRank - a.score.tierRank || b.score.total - a.score.total;
}

const SCORE = {
  LIGHT_WIND_KMH,
  SIZE_ORDER,
  SIZE_LABEL,
  TIERS,
  angleDiff,
  inArc,
  arcMiss,
  windowFit,
  clamp01,
  WINDOW_SHOULDER_DEG,
  classifySize,
  classifyWind,
  atLeastHeadHigh,
  triangularScore,
  scoreSpot,
  compareScored,
};

if (typeof module !== "undefined" && module.exports) module.exports = SCORE;
