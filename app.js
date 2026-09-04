// ===========================================================================
// Geometry
//
// Every bearing on this page is a compass bearing (0 = N, 90 = E, clockwise).
// The chart projection is angle-true, so a bearing converts to a screen vector
// with nothing more than sin/cos — no map library, no reprojection.
// ===========================================================================

const RAD = Math.PI / 180;

/** Unit vector pointing along a compass bearing, in SVG screen space (y down). */
function vec(bearing) {
  return { x: Math.sin(bearing * RAD), y: -Math.cos(bearing * RAD) };
}

const COMPASS_16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
/** Forecast hours only carry a numeric bearing; this gives them the same
 *  compass letters the measured API responses already provide. */
const degToCompass = (deg) => (deg == null ? null : COMPASS_16[Math.round(deg / 22.5) % 16]);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Arrow length as a function of energy, not a fixed size — this is what makes
 * "the swell has picked up" or "the wind is howling" readable on the map
 * itself, not just in the numbers next to it. Swell height and wind speed are
 * linearly mapped onto a length range and clamped, rather than modelled as
 * true wave energy (∝ height² × period): the map needs a comparative cue, not
 * a physically exact one, and a clamped linear scale keeps light and violent
 * days both legible instead of one making the other invisible.
 */
const lenForSwell = (hs) => hs == null ? 66 : clamp(32 + ((hs - 0.3) / 2.2) * 78, 32, 112);
const lenForWind = (kmh) => kmh == null ? 58 : clamp(28 + (kmh / 35) * 74, 28, 104);

// angleDiff() and inArc() are defined in score.js, which loads first: the scoring
// engine needs them and has to stay loadable on its own (test.html loads it
// without app.js), so it owns them and they are in scope here already.

function project(lat, lng) {
  return {
    x: ((lng - COAST.lngW) / (COAST.lngE - COAST.lngW)) * COAST.W,
    y: ((COAST.latN - lat) / (COAST.latN - COAST.latS)) * COAST.H,
  };
}

const COAST_PTS = COAST.coast
  .slice(1)
  .split(" L")
  .map((p) => {
    const [x, y] = p.trim().split(/\s+/).map(Number);
    return { x, y };
  });

/**
 * Nearest point on the shoreline polyline, so every pin sits on the beach
 * rather than floating next to it.
 *
 * The move is capped: the coordinates are already good (they come from OSM's
 * own beach features), so this is a nudge of a few pixels, not a relocation.
 * Uncapped, a spot tucked inside a bay — where "nearest point on the
 * coastline" is not a meaningful idea — can jump over 100 m and swap places
 * with its neighbour, putting the map out of geographic order.
 */
function snapToShore(p, maxMove = 6) {
  let best = { d: Infinity, x: p.x, y: p.y };
  for (let i = 0; i < COAST_PTS.length - 1; i++) {
    const a = COAST_PTS[i], b = COAST_PTS[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.d) best = { d, x: q.x, y: q.y };
  }
  if (best.d <= maxMove) return { x: best.x, y: best.y };
  const k = maxMove / best.d;
  return { x: p.x + (best.x - p.x) * k, y: p.y + (best.y - p.y) * k };
}

/**
 * How far east the shore lies at a given y — used to place the swell and wind
 * arrows a consistent distance offshore rather than on an arbitrary grid.
 */
const SHORE_X = (() => {
  const step = 6, n = Math.ceil(COAST.H / step) + 1;
  const arr = new Array(n).fill(null);
  for (const p of COAST_PTS) {
    const i = Math.round(p.y / step);
    if (i >= 0 && i < n) arr[i] = Math.max(arr[i] ?? -Infinity, p.x);
  }
  let last = COAST.W * 0.4;
  for (let i = 0; i < n; i++) (arr[i] == null ? (arr[i] = last) : (last = arr[i]));
  for (let i = n - 1; i >= 0; i--) if (arr[i] == null) arr[i] = last;
  return (y) => arr[Math.max(0, Math.min(n - 1, Math.round(y / step)))];
})();

// ===========================================================================
// Reading the conditions against a beach
//
// A raw bearing tells you nothing on its own — 110° is a dream at Long Reef and
// a flat day in a north-facing bay. What matters is the bearing *relative to
// the beach*, so
// everything below is expressed in that frame and given a plain-language name.
// ===========================================================================

/** Swell relative to the beach face. 0° incidence = straight in. */
function readSwell(spot, swellFrom) {
  if (swellFrom == null) return { text: "no data", inc: null, lit: false };
  const inc = angleDiff(swellFrom, spot.facing_deg);
  const miss = SCORE.arcMiss(swellFrom, spot.swell_window[0], spot.swell_window[1]);
  const lit = miss <= SCORE.WINDOW_SHOULDER_DEG; // matches the engine's rideability gate
  if (miss > SCORE.WINDOW_SHOULDER_DEG) return { text: "outside window", inc, lit };
  if (miss > 0) return { text: "edge of window", inc, lit };
  if (inc < 25) return { text: "straight in", inc, lit };
  if (inc < 55) return { text: "somewhat cross", inc, lit };
  return { text: "very cross", inc, lit };
}

/** Wind relative to the beach. 0° = straight offshore, 180° = straight onshore. */
function readWind(spot, windFrom, kmh) {
  if (windFrom == null) return { text: "no data", rel: null };
  const rel = angleDiff(windFrom, (spot.facing_deg + 180) % 360);
  if (kmh != null && kmh < SCORE.LIGHT_WIND_KMH) return { text: "calm", rel };
  let text;
  if (rel < 45) text = "offshore";
  else if (rel < 80) text = "cross-offshore";
  else if (rel < 100) text = "cross";
  else if (rel < 135) text = "cross-onshore";
  else text = "onshore";
  return { text, rel };
}

// ===========================================================================
// Scoring adapters
//
// The rubric itself lives in score.js. These two helpers only translate the
// wire formats into the engine's neutral `cond` shape, so measured buoy data
// and modelled forecast data score through exactly the same code path.
// ===========================================================================

/** Measured now: MHL buoy + BOM wind, as they arrive over the wire. */
function condFromMeasured(swell, wind, tideState) {
  return {
    hs: swell.wave_height_hs_m ?? null,
    periodS: swell.wave_period_tp1_s ?? null,
    swellFromDeg: swell.wave_direction_deg ?? null,
    windFromDeg: wind.wind_dir_deg ?? null,
    windKmh: wind.wind_speed_kmh ?? null,
    tideState: tideState ?? null,
  };
}

/** One hour of the Open-Meteo forecast series. */
function condFromForecast(hour, tideState) {
  if (!hour) return null;
  return {
    hs: hour.hs ?? null,
    periodS: hour.periodS ?? null,
    swellFromDeg: hour.swellFromDeg ?? null,
    windFromDeg: hour.windFromDeg ?? null,
    windKmh: hour.windKmh ?? null,
    tideState: tideState ?? null,
  };
}

/**
 * The single time axis the whole page reads from. `offset` is hours from load
 * time: 0 is "right now", using the actually-measured buoy/BOM values per the
 * "measured for now, model for later" split; 1..48 look up that hour in the
 * forecast series. Either way the result is the same neutral `cond` shape, an
 * absolute timestamp, and whether it is measured or modelled — so a slider
 * tick and the initial paint are the exact same code path.
 */
function condAt(offset) {
  const ms = offset === 0 ? Date.now() : STATE.baseMs + offset * FORECAST.HOUR_MS;
  const tideState = STATE.tideModel && STATE.tideModel.ok ? STATE.tideModel.stateAt(ms) : null;
  if (offset === 0) {
    return { cond: condFromMeasured(STATE.swell, STATE.wind, tideState), ms, isMeasured: true };
  }
  const hour = STATE.hours && STATE.hours.ok ? STATE.hours.at(ms) : null;
  return { cond: condFromForecast(hour, tideState) ?? {}, ms, isMeasured: false };
}

/**
 * Tide state/height/next-turn at any instant. One algorithm (the cosine
 * interpolation in forecast.js) now serves the live "now" band, the verdict,
 * every forecast tile, and the slider — previously "now" had its own
 * separate, coarser calculation, which is exactly the kind of split that lets
 * the displayed time silently disagree with itself.
 */
function tideAt(tideModel, ms) {
  if (!tideModel || !tideModel.ok) return null;
  return { state: tideModel.stateAt(ms), next: tideModel.nextAfter(ms), height: tideModel.heightAt(ms) };
}

// ===========================================================================
// Arrow primitives
//
// Swell and wind are told apart by three redundant channels — hue, stroke
// pattern and head shape — so they stay distinguishable in greyscale and for
// colour-blind readers, not just by colour.
//   swell : solid shaft, filled triangular head, Coffee
//   wind  : dashed shaft, open chevron head,     Olive
// Both point the way the energy is *travelling*, i.e. 180° off the "coming
// from" bearing that MHL and BOM report.
// ===========================================================================

const n1 = (v) => v.toFixed(1);

/**
 * One arrow, from (x1,y1) to (x2,y2). `k` prefixes the CSS classes so the chart
 * and the 44px row dial share the geometry and differ only in styling.
 * `filled` picks the head: a solid triangle for swell, an open chevron for wind.
 */
function arrowTo(x1, y1, x2, y2, k, filled, cased) {
  const dx = x2 - x1, dy = y2 - y1;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const h = Math.min(18, L * 0.42);

  let shaftD, headD;
  if (filled) {
    const w = h * 0.4;
    const bx = x2 - ux * h, by = y2 - uy * h;
    const px = -uy, py = ux;
    shaftD = `M${n1(x1)} ${n1(y1)} L${n1(bx)} ${n1(by)}`;
    headD = `M${n1(x2)} ${n1(y2)} L${n1(bx + px * w)} ${n1(by + py * w)}
             L${n1(bx - px * w)} ${n1(by - py * w)} Z`;
  } else {
    const c = Math.cos(150 * RAD), s = Math.sin(150 * RAD);
    const l1 = { x: ux * c - uy * s, y: ux * s + uy * c };
    const l2 = { x: ux * c + uy * s, y: -ux * s + uy * c };
    shaftD = `M${n1(x1)} ${n1(y1)} L${n1(x2)} ${n1(y2)}`;
    headD = `M${n1(x2 + l1.x * h)} ${n1(y2 + l1.y * h)} L${n1(x2)} ${n1(y2)}
             L${n1(x2 + l2.x * h)} ${n1(y2 + l2.y * h)}`;
  }

  // A casing knocks the arrow out of whatever runs beneath it. Needed because a
  // pure side-shore swell lies exactly along the dial's shoreline and would
  // otherwise vanish into it.
  const casing = cased
    ? `<path class="${k}-casing" d="${shaftD}"/><path class="${k}-casing" d="${headD}"/>`
    : "";
  return `<g>${casing}<path class="${k}-arrow" d="${shaftD}"/><path class="${k}-head" d="${headD}"/></g>`;
}

/** Compass-anchored arrow, centred on (cx,cy), pointing the way energy travels. */
function bearingArrow(cx, cy, from, len, k, filled) {
  const d = vec((from + 180) % 360);
  return arrowTo(cx - d.x * len / 2, cy - d.y * len / 2,
                 cx + d.x * len / 2, cy + d.y * len / 2, k, filled);
}

const swellArrow = (cx, cy, from, len = 30, k = "swell") => bearingArrow(cx, cy, from, len, k, true);
const windArrow = (cx, cy, from, len = 26, k = "wind") => bearingArrow(cx, cy, from, len, k, false);

/** Pie wedge from bearing a0 clockwise to a1, centred on (cx,cy). */
function wedge(cx, cy, r, a0, a1, cls) {
  const p0 = vec(a0), p1 = vec(a1);
  const large = (a1 - a0 + 360) % 360 > 180 ? 1 : 0;
  return `<path class="${cls}" d="M${cx} ${cy}
    L${(cx + p0.x * r).toFixed(1)} ${(cy + p0.y * r).toFixed(1)}
    A${r} ${r} 0 ${large} 1 ${(cx + p1.x * r).toFixed(1)} ${(cy + p1.y * r).toFixed(1)} Z"/>`;
}

// ===========================================================================
// The chart
// ===========================================================================

// The chart is drawn with a gutter of land to the west, purely so the spot
// labels have somewhere to sit without being clipped or pushed out to sea,
// where the arrows live.
const GUTTER = -54;
const VIEW = { x: GUTTER, w: COAST.W - GUTTER };

// The shoreline runs south (first point) to north (last). Closing it westward
// gives the land, eastward gives the sea; the sea polygon doubles as the clip
// for the swell field so no crest line ever strays onto the beach.
const LAND_PATH = `${COAST.coast} L${GUTTER - 60} -60 L${GUTTER - 60} ${COAST.H + 60} Z`;
const SEA_PATH = `${COAST.coast} L${COAST.W + 60} -60 L${COAST.W + 60} ${COAST.H + 60} Z`;

const CREST_SPACING = 26;
/** How many line-spacings the field travels per animation cycle. Must match
 *  the opacity-pattern length below or the loop will visibly jump. */
const CREST_CYCLE = 3;

// A crest is drawn as a sine curve rather than a ruled line. WAVE_LEN is the
// along-crest wavelength of that undulation and WAVE_AMP how far it swings —
// both in chart units. Deliberately long and shallow: real swell crests are
// nearly straight over a few hundred metres, and a tighter wiggle stops
// reading as water and starts reading as a decorative squiggle.
const WAVE_LEN = 88;
const WAVE_AMP = 4.6;
const CREST_STEP = 9;   // sampling interval along the crest

/**
 * The swell train — long undulating crests marching at the coast.
 *
 * Two things stop this from reading as a hatch pattern. First the crests are
 * curves, not rules: each one swings about its own axis on a long sine, and
 * neighbouring crests are offset in phase so the troughs of one sit against
 * the peaks of the next, which is what gives the field its rolling texture.
 *
 * Second, the crests are NOT uniform in weight. A perfectly even set of lines
 * translated by exactly one spacing is pixel-identical to where it started, so
 * the motion would be imperceptible — there is no feature to track. Varying
 * weight, opacity, amplitude and phase on a 3-crest cycle gives the eye
 * something to follow, and translating a whole cycle keeps the loop seamless.
 * Everything that varies is therefore a function of `k % CREST_CYCLE` only.
 */
function crestField(from) {
  const d = vec((from + 180) % 360);        // travel direction
  const p = { x: -d.y, y: d.x };            // along the crest
  const cx = VIEW.x + VIEW.w / 2, cy = COAST.H / 2;
  // Half the view diagonal plus a margin covers every corner at any rotation.
  // (The old value was ~2.5x this, which generated geometry that was always
  // clipped away — costly for a field that is now curves rather than lines.)
  const reach = Math.hypot(VIEW.w, COAST.H) / 2 + 30;
  const span = Math.ceil(reach / CREST_SPACING);
  const k2 = (2 * Math.PI) / WAVE_LEN;
  let out = "";
  for (let k = -span; k <= span; k++) {
    // ((k % 3) + 3) % 3 keeps the phase stable through negative k.
    const phase = ((k % CREST_CYCLE) + CREST_CYCLE) % CREST_CYCLE;
    const ax = cx + d.x * k * CREST_SPACING, ay = cy + d.y * k * CREST_SPACING;
    const amp = WAVE_AMP * [1, 0.72, 0.88][phase];
    const shift = [0, 2.3, 4.4][phase];     // radians — staggers the crests
    let dd = "";
    for (let s = -reach; s <= reach; s += CREST_STEP) {
      const off = amp * Math.sin(s * k2 + shift);
      const x = ax + p.x * s + d.x * off;
      const y = ay + p.y * s + d.y * off;
      dd += `${dd ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    out += `<path class="swell-crest crest-${phase}" d="${dd}"/>`;
  }
  return out;
}

// The fleet. Fixed points in open water, chosen against the geography rather
// than derived from the spots: every one sits east of the shoreline's furthest
// point (x≈193, at Long Reef) and clear of both the pin cluster and the
// cartouche, so no ship can ever land on a reading. `drift` is how far it
// wanders and `dur` how long one round trip takes — slow enough to notice only
// if you watch, which is the point.
// The fleet. Only size and posture are fixed here — where each ship is and
// where it is going is decided per voyage, at run time (see sailFleet).
// `rot` and `flip` exist to break up the formation: three copies of one plate
// at one angle read as clip-art rather than as ships that happen to be out
// there.
const FLEET = [
  // 74 was too wide: the sea lane is only ~90 units across, so the largest
  // hull filled it and left nothing for the water either side of it.
  // `roll` and `heave` are deliberately not multiples of each other. Two
  // motions on periods that do not divide evenly never come back into the same
  // relationship, so the combined movement does not repeat — which is what
  // stops it reading as a mechanism. A single sine at one frequency is a
  // metronome no matter how small you make it.
  { w: 66, rot: -4, flip: false, roll: 11,  heave: 7.3 },
  { w: 52, rot: 6,  flip: true,  roll: 8.5, heave: 5.9 },
  { w: 43, rot: -8, flip: false, roll: 7,   heave: 4.7 },
];

// The water a ship may sail in: east of the shoreline's furthest point
// (x≈193, at Long Reef) and stopping short of the cartouche in the bottom
// corner, so no hull ever crosses a reading.
const SEA_LANE = { x0: 214, x1: 302, y0: 20, y1: 505 };

/** The fleet's DOM, kept across re-renders so voyages are never restarted. */
let FLEET_NODE = null;
const SHIP_ASPECT = 248 / 199;   // assets/ship-cutout.png, height / width

// ===========================================================================
// The chart
//
// Decoration (compass rose, galleon, sea serpent) lives in chrome.js; this
// file stays about data. Arrows are no longer drawn as an ambient field over
// the water — they belong to a spot, and appear only when one is selected.
// ===========================================================================

/**
 * A vertical tide gauge on the chart: the column fills toward high water and
 * drains toward low. Height comes from the same cosine interpolation that
 * feeds the scoring, so the gauge and the tide score can never disagree, and
 * it is normalised against the actual range of the published tide table rather
 * than a fixed 0–2 m so a neap day still uses the whole column.
 */
function tideGauge(cond, x, h) {
  const t = STATE.tideModel;
  if (!t || !t.ok) return "";
  const ms = STATE.ms ?? Date.now();
  const height = t.heightAt(ms);
  if (height == null) return "";

  const hs = t.events.map((e) => e.height_m);
  const lo = Math.min(...hs), hi = Math.max(...hs);
  const frac = hi > lo ? clamp((height - lo) / (hi - lo), 0, 1) : 0.5;

  const y = 40, w = 9;
  const fillH = h * frac;
  const next = t.nextAfter(ms);
  const rising = next ? next.type === "high" : null;

  return `<g class="tide-gauge">
    <text class="tide-cap" x="${x + w / 2}" y="${y - 10}" text-anchor="middle">TIDE</text>
    <rect class="tide-tube" x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5"/>
    <rect class="tide-fill" x="${x}" y="${(y + h - fillH).toFixed(1)}" width="${w}"
          height="${fillH.toFixed(1)}" rx="1.5"/>
    <line class="tide-mark" x1="${x - 3}" y1="${(y + h - fillH).toFixed(1)}"
          x2="${x + w + 3}" y2="${(y + h - fillH).toFixed(1)}"/>
    <text class="tide-val" x="${x + w + 6}" y="${(y + h - fillH + 3).toFixed(1)}">${height.toFixed(1)}m</text>
    ${rising == null ? "" : `<text class="tide-cap" x="${x + w / 2}" y="${y + h + 12}"
      text-anchor="middle">${rising ? "▲" : "▼"}</text>`}
  </g>`;
}

/**
 * Send the fleet sailing.
 *
 * Each ship gets its own voyage — a start, a finish, and a duration — fades in
 * as it comes over the horizon, crosses, and fades out; then a *new* voyage is
 * chosen and it comes back somewhere else. The randomness is real rather than
 * a long looping animation, which is the difference between "the sea has ships
 * on it" and "three sprites are on a timer".
 *
 * Done through the Web Animations API rather than CSS keyframes because the
 * numbers change every voyage: CSS would need its keyframes rewritten each
 * time, whereas here the next voyage is just the next call. The gap before a
 * ship reappears is part of it — an empty sea that fills again reads as
 * distance, where three permanently-present ships read as decoration.
 *
 * Every animation is a transform/opacity pair, so this stays on the compositor
 * and costs nothing per frame regardless of how much else is repainting.
 */
function sailFleet(svg) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // Still put them on the water — just becalmed, at a fixed spread.
    svg.querySelectorAll(".ship-voyage").forEach((g, i) => {
      // Spread over the same lane the voyages use, evenly, so becalmed ships
      // are as far apart as sailing ones ever get.
      const y = SEA_LANE.y0 + ((i + 1) / (FLEET.length + 1)) * (SEA_LANE.y1 - SEA_LANE.y0);
      g.setAttribute("transform", `translate(${(SEA_LANE.x0 + SEA_LANE.x1) / 2},${y.toFixed(1)})`);
    });
    return;
  }

  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  // The lane is only ~90 units wide and the largest hull is most of that, so
  // two ships cannot pass each other side by side — left to pick freely they
  // drift into the same water and collide, which looks like a rendering fault
  // rather than like shipping. So the lane is cut into bands and a ship claims
  // one for the whole voyage; which band it gets is still random among those
  // free, and a ship waiting over the horizon holds nothing.
  //
  // Two numbers here are what actually keep hulls apart, and the first attempt
  // got both wrong:
  //
  //   BAND_PAD  Ships travel only the middle of their band. Without it a ship
  //             reaches full opacity ~18% into its run, which was still inside
  //             the neighbouring band, so two hulls were solid and touching at
  //             the boundary. The pad guarantees 2*BAND_PAD of clear water
  //             between any two visible ships; the tallest hull is 60*1.246 =
  //             75 units, so two half-heights is 75 and 100 clears it.
  //
  //   BANDS     Fewer bands than ships. Three bands over this lane left each
  //             one too short to sail once padded, and every ship was always
  //             on screen. With two, each voyage gets real distance and one of
  //             the three hulls is always over the horizon — so which ships
  //             are out, and where, keeps changing.
  const BANDS = 2;
  const BAND_PAD = 50;
  const bandH = (SEA_LANE.y1 - SEA_LANE.y0) / BANDS;
  const taken = new Set();

  svg.querySelectorAll(".ship-voyage").forEach((g, i) => {
    const beam = FLEET[i].w * 0.5;   // keep the hull off the lane's edges
    const lane = () => rand(SEA_LANE.x0 + beam, SEA_LANE.x1 - beam);
    let seeded = false;
    let current = null;

    const voyage = () => {
      const free = [];
      for (let b = 0; b < BANDS; b++) if (!taken.has(b)) free.push(b);
      if (!free.length) return void setTimeout(voyage, rand(4000, 14000));
      const band = free[Math.floor(Math.random() * free.length)];
      taken.add(band);

      // Every ship works north, up the coast. Alternating the direction at
      // random was what made the movement read wrong: with two hulls on screen
      // one would slide up while the other slid down, which no fleet does, and
      // a ship reversing its course on its next voyage looked like a glitch
      // rather than a passage. Both ends stay strictly inside the padded band,
      // so a hull is never solid anywhere near a neighbouring band's water.
      const top = SEA_LANE.y0 + band * bandH + BAND_PAD;
      const bot = SEA_LANE.y0 + (band + 1) * bandH - BAND_PAD;
      // One track, not two independent draws. Picking the start and finish x
      // separately let a ship crab sideways across the lane as it went; a
      // couple of units of lateral wander is a course held in a seaway.
      const trackX = lane();
      const driftX = trackX + rand(-4, 4);
      // Element.animate() *adds* an animation; the previous one keeps filling
      // forever otherwise, so they accumulate one per voyage for as long as the
      // page is open. Retire it explicitly.
      if (current) current.cancel();
      const anim = g.animate(
        [
          { transform: `translate(${trackX.toFixed(1)}px,${bot.toFixed(1)}px)`, opacity: 0 },
          { opacity: 1, offset: 0.14 },
          { opacity: 1, offset: 0.76 },
          // A long fade at the head of the run: the ship should thin out into
          // the distance over the last quarter of its passage, not switch off.
          { transform: `translate(${driftX.toFixed(1)}px,${top.toFixed(1)}px)`, opacity: 0 },
        ],
        // Slow. This is a ship seen from a long way off, not a boat crossing a
        // pond: ~140 units in two to three and a half minutes works out under
        // a pixel a second on screen, which is movement you notice only if you
        // stay with it.
        { duration: rand(115000, 205000), easing: "linear", fill: "forwards" }
      );
      current = anim;
      // The very first voyage starts part-way through, at a point that is
      // already past the fade-in, so ships are visible on the first frame.
      // Every voyage after this one begins at its start, as it should.
      if (!seeded) {
        seeded = true;
        anim.currentTime = anim.effect.getTiming().duration * rand(0.22, 0.7);
      }
      // A pause over the horizon before the next one, so the sea is sometimes
      // emptier than it is now and the reappearance is not on a beat.
      anim.onfinish = () => {
        taken.delete(band);
        setTimeout(voyage, rand(6000, 20000));
      };
    };

    // Sail immediately, and start the first voyage already under way (see
    // `seeded` above) so the sea has ships on it the moment the page opens
    // rather than a minute later.
    voyage();
  });
}

/** A five-pointed star, points up, centred on (cx,cy) with circumradius r. */
function starPath(cx, cy, r, inner = 0.42) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (-90 + i * 36) * (Math.PI / 180);
    const rr = i % 2 ? r * inner : r;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`);
  }
  return `M${pts.join("L")}Z`;
}

/**
 * The cartouche: the three numbers the chart's own graphics can only show as
 * shape and direction — how big, how long between waves, how hard it is
 * blowing. It reads for the *selected* spot, so it and the star agree by
 * default (the page opens on the best spot) but diverge as you look around,
 * which is what makes comparing spots worth doing.
 */
function cartouche(spot, score, cond, x, y, w) {
  const hs = score?.hsAtSpot;
  const rows = [
    ["WAVE", hs == null ? "—" : fmtFt(hs, false), "ft"],
    ["PERIOD", cond.periodS == null ? "—" : fmtNum(cond.periodS, 0), "s"],
    ["WIND", cond.windKmh == null ? "—" : String(Math.round(cond.windKmh)), "km/h"],
  ];
  const h = 30 + rows.length * 26;
  const lines = rows.map(([label, val, unit], i) => {
    const ry = y + 34 + i * 26;
    return `<text class="cart-label" x="${x + 12}" y="${ry}">${label}</text>
      <text class="cart-val num" x="${x + w - 12}" y="${ry}" text-anchor="end">${val}<tspan
        class="cart-unit"> ${unit}</tspan></text>`;
  }).join("");
  // Double rule, the way a chart cartouche is always framed.
  return `<g class="cartouche">
    <rect class="cart-bg" x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/>
    <rect class="cart-edge" x="${x + 3.5}" y="${y + 3.5}" width="${w - 7}" height="${h - 7}" rx="1"/>
    <text class="cart-title" x="${x + w / 2}" y="${y + 16}" text-anchor="middle">${
      spot ? spot.short.toUpperCase() : "CONDITIONS"}</text>
    ${lines}
  </g>`;
}

function renderChart(rows, cond, activeId) {
  const svg = document.getElementById("chart");
  svg.setAttribute("viewBox", `${VIEW.x} 0 ${VIEW.w} ${COAST.H}`);

  const swellFrom = cond.swellFromDeg;
  const windFrom = cond.windFromDeg;
  const swellLen = lenForSwell(cond.hs);
  const windLen = lenForWind(cond.windKmh);

  // The sea itself: parallel swell lines marching in the swell's travel
  // direction. These carry the "where is it coming from" reading for the whole
  // chart, so the ambient arrow field that used to sit over the water is gone —
  // arrows now belong to a spot, and only appear when one is selected.
  // Animated by translating one line-spacing along the swell's travel vector
  // and looping — because the spacing is uniform, the loop point is invisible
  // and the whole field reads as a swell train marching at the coast.
  let field = "";
  if (swellFrom != null) {
    const d = vec((swellFrom + 180) % 360);
    const dist = CREST_SPACING * CREST_CYCLE;
    field = `<g class="swell-lines" clip-path="url(#sea-clip)"
       style="--tx:${(d.x * dist).toFixed(2)}px; --ty:${(d.y * dist).toFixed(2)}px">
       ${crestField(swellFrom)}</g>`;
  }

  // South and North Steyne sit within a few hundred metres of each other,
  // so their labels would overlap. Walk them north to south and push each one
  // clear of the last — the leader line is implied by the label's own offset.
  // Walk in authored north-to-south order (`order` runs south to north) rather
  // than by measured y, so a pixel of snapping can never reorder the labels.
  const labelY = new Map();
  let prev = -Infinity;
  for (const { spot } of rows.slice().sort((a, b) => b.spot.order - a.spot.order)) {
    const y = Math.max(spot.xy.y, prev + 12);
    labelY.set(spot.id, y);
    prev = y;
  }

  // The best spot at this hour, from the same ranking the verdict card uses —
  // not from the selection, so the mark keeps answering "where do I go" even
  // while you are looking at somewhere else. Nothing is starred when nothing
  // is worth the trip.
  // Always marked, even when the whole coast is flat. Hiding the star on flat
  // hours meant it blinked out and back as the slider crossed them, which
  // reads as a bug; and "the least bad of a bad lot" is still the answer to
  // where you'd go. The flat case is told apart by the star's treatment (see
  // .pin.is-best.q-flat), not by its absence.
  const bestRow = rows.length ? rows.slice().sort(SCORE.compareScored)[0] : null;
  const bestId = bestRow ? bestRow.spot.id : null;

  // Split into two layers: the active spot's geometry sits under every pin, so
  // a wedge can never cover a neighbouring dot.
  const geometry = [];
  const pins = rows.map(({ spot, score }) => {
    const p = spot.xy;
    const isActive = spot.id === activeId;
    if (isActive) {
      // Only the active spot gets its full geometry — eleven swell windows at
      // once is noise, one is an explanation.
      const R = 56;
      const f = vec(spot.facing_deg);
      const e0 = vec(spot.swell_window[0]), e1 = vec(spot.swell_window[1]);
      const n = (v) => v.toFixed(1);
      geometry.push(
        wedge(p.x, p.y, R, spot.swell_window[0], spot.swell_window[1], "window-wedge"),
        `<path class="window-edge" d="M${n(p.x)} ${n(p.y)} L${n(p.x + e0.x * R)} ${n(p.y + e0.y * R)}
           M${n(p.x)} ${n(p.y)} L${n(p.x + e1.x * R)} ${n(p.y + e1.y * R)}"/>`,
        // The shore-normal tick is the reference the swell arrow is read against:
        // the angle between the two IS the incidence, straight off the drawing.
        `<line class="shore-normal" x1="${n(p.x)}" y1="${n(p.y)}"
           x2="${n(p.x + f.x * 34)}" y2="${n(p.y + f.y * 34)}"/>`,
        // Both arrows repeated at the selected spot, held off so they don't
        // collide with the label — swell in Coffee, wind in Olive, so the two
        // are told apart by colour as well as by shaft style even this close
        // together. Both scale with the same energy the field arrows use.
        swellFrom != null
          ? swellArrow(p.x + vec(swellFrom).x * 86, p.y + vec(swellFrom).y * 86, swellFrom, swellLen)
          : "",
        windFrom != null
          ? windArrow(p.x + vec(windFrom).x * 62, p.y + vec(windFrom).y * 62, windFrom, windLen)
          : ""
      );
    }
    // The best spot's marker IS a star — it replaces the dot rather than
    // sitting beside it, so there is exactly one mark per spot and the star is
    // read as "this one" instead of as another piece of chart furniture.
    const isBest = spot.id === bestId;
    return `<g class="pin ${score.tierCls} ${isActive ? "is-active" : ""} ${isBest ? "is-best" : ""}"
              data-spot="${spot.id}"
              transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
        <circle class="halo" r="${isBest ? 15 : 9}"/>
        ${isBest
          ? `<path class="star-glow" d="${starPath(0, 0, 17)}"/>
             <path class="dot dot-star" d="${starPath(0, 0, 11.5)}"/>`
          : `<circle class="dot" r="4.5"/>`}
      </g>`;
  });

  // Labels ride in their own layer above every dot, otherwise a neighbouring
  // pin lands on top of the previous spot's name and clips it.
  const labels = rows.map(({ spot }) => {
    const p = spot.xy;
    return `<text class="name ${spot.id === activeId ? "is-active" : ""}"
      x="${(p.x - 11).toFixed(1)}" y="${(labelY.get(spot.id) + 3).toFixed(1)}"
      text-anchor="end">${spot.short}</text>`;
  });

  // Open-water fixed points for the chart decoration, well clear of every pin
  // (which cluster within ~150–250 in this projection) and of the field-arrow
  // band. Chosen once against the geography, not derived from spot positions,
  // because they are chart furniture, not data.
  // No rose is drawn any more, but the rhumb lines still need a node to
  // radiate from — an unmarked bearing node is ordinary on a portolan chart.
  const ROSE = { x: 266, y: 566, r: 20 };

  // The fleet. Each ship is drawn at the origin and moved entirely by an
  // animation assigned in JS (see sailFleet), so the markup here carries no
  // position at all — that is what lets each voyage be different and lets a
  // new one be chosen every time a ship sails off.
  const fleet = FLEET.map((s, i) => `
    <g class="ship-voyage" data-ship="${i}">
      <!-- The water the hull has pushed aside. This is a filled patch of sea
           colour laid OVER the crests, not a hole cut in them, which is the
           whole reason it can move: a mask would have to be re-cut every frame
           to follow a ship, whereas a sibling inside the moving group follows
           for free. Its soft edge makes the swell fade out around the hull
           rather than stop against a rim. -->
      <ellipse class="ship-clearing" cx="0" cy="0"
               rx="${(s.w * 0.62).toFixed(1)}" ry="${(s.w * 0.72).toFixed(1)}"
               fill="url(#ship-clearing)"/>
      <g class="ship-heave" style="--dur:${s.heave}s">
        <g class="ship-roll" style="--dur:${s.roll}s">
          <g transform="rotate(${s.rot})${s.flip ? " scale(-1 1)" : ""}">
            ${CHROME.plate("assets/ship-cutout.png", 0, 0, s.w, "ship", SHIP_ASPECT)}
          </g>
        </g>
      </g>
    </g>`).join("");

  const active = SPOTS.find((s) => s.id === activeId);
  const activeScore = rows.find((r) => r.spot.id === activeId)?.score;
  const CART_W = 118;

  svg.innerHTML = `
    <defs>
      <clipPath id="sea-clip"><path d="${SEA_PATH}"/></clipPath>
      <!-- Stipple for the land. It was the one large flat fill left on the
           chart, and a flat slab beside a textured page reads as a hole rather
           than as ground. Two dots on an off-square, rotated grid: the offset
           and the rotation stop the eye finding rows in it. -->
      <pattern id="land-tex" width="7" height="7" patternUnits="userSpaceOnUse"
               patternTransform="rotate(17)">
        <circle class="land-stipple" cx="1.5" cy="1.5" r="0.55"/>
        <circle class="land-stipple" cx="4.9" cy="4.3" r="0.4"/>
      </pattern>
      <!-- The patch of settled water a hull sits in: opaque sea at the centre,
           falling away to nothing so the swell fades into it. -->
      <radialGradient id="ship-clearing">
        <stop offset="0.42" class="clearing-in"/>
        <stop offset="1" class="clearing-out"/>
      </radialGradient>
    </defs>
    <rect class="sea" x="${VIEW.x}" y="0" width="${VIEW.w}" height="${COAST.H}"/>
    <g clip-path="url(#sea-clip)">
      ${COAST.contours.map((d) => `<path class="depth" d="${d}"/>`).join("")}
      <g class="chart-chrome chrome-under">
        ${CHROME.rhumbLines(ROSE.x, ROSE.y, 620)}
      </g>
    </g>
    ${field}
    <g class="chart-chrome fleet-layer" clip-path="url(#sea-clip)"></g>
    <path class="land" d="${LAND_PATH}"/>
    <path class="land-tex" d="${LAND_PATH}"/>
    <path class="shore" d="${COAST.coast}"/>
    ${COAST.rocks.map((d) => `<path class="rock" d="${d}"/>`).join("")}
    ${geometry.join("")}
    ${pins.join("")}
    ${labels.join("")}
    ${tideGauge(cond, VIEW.x + 16, 108)}
    ${cartouche(active, activeScore, cond, VIEW.x + VIEW.w - CART_W - 10, COAST.H - 130, CART_W)}
  `;

  // The fleet is built ONCE and then moved into each fresh render, rather than
  // re-rendered with everything else. renderChart runs on every slider tick and
  // every hover, and rebuilding the ships would restart their voyages each
  // time — they would never get anywhere. Re-parenting an element does not
  // cancel its running animations, so moving the node keeps every ship exactly
  // where it had sailed to.
  const layer = svg.querySelector(".fleet-layer");
  if (!FLEET_NODE) {
    FLEET_NODE = document.createElementNS("http://www.w3.org/2000/svg", "g");
    FLEET_NODE.innerHTML = fleet;
    layer.appendChild(FLEET_NODE);
    sailFleet(FLEET_NODE);
  } else {
    layer.appendChild(FLEET_NODE);
  }

  svg.querySelectorAll(".pin").forEach((g) => {
    const id = g.dataset.spot;
    g.addEventListener("click", () => selectSpot(id, true));
    g.addEventListener("mouseenter", () => selectSpot(id, false));
  });

  const activeSpot = SPOTS.find((s) => s.id === activeId);
  document.getElementById("chart-active").textContent = activeSpot?.name ?? "—";
  renderMapFooter(activeSpot, cond);
}

/** Wind at the selected spot, shown under the map — its own arrow, its own
 *  colour, independent of whatever the shared field arrows are doing. */
function renderMapFooter(spot, cond) {
  const el = document.getElementById("chart-wind");
  if (!spot) { el.innerHTML = ""; return; }
  const compass = degToCompass(cond.windFromDeg);
  el.innerHTML = cond.windFromDeg == null
    ? `<span class="label">Wind at ${spot.short}</span><span class="cw-val">no data</span>`
    : `<span class="label">Wind at ${spot.short}</span>
       <svg class="cw-arrow" viewBox="0 0 16 16" aria-hidden="true">
         ${windArrow(8, 8, cond.windFromDeg, 11, "wind")}
       </svg>
       <span class="cw-val num">${compass} ${Math.round(cond.windFromDeg)}° · ${cond.windKmh == null ? "—" : Math.round(cond.windKmh)} km/h</span>`;
}

const legendSvg = (inner) => `<svg viewBox="0 0 34 12" aria-hidden="true">${inner}</svg>`;

function renderLegend() {
  document.getElementById("chart-legend").innerHTML = `
    <div>${legendSvg(swellArrow(17, 6, 270, 26))} Swell — length shows size</div>
    <div>${legendSvg(windArrow(17, 6, 270, 24))} Wind — length shows strength</div>
    <div>${legendSvg(`<path class="window-wedge" d="M2 11 L2 1 A10 10 0 0 1 12 11 Z"/>
      <path class="window-edge" d="M2 11 L2 1 M2 11 L12 11"/>`)} Pick a spot to see its arrows</div>`;
}

// ===========================================================================
// The per-spot dial — the same visual language as the chart, at 44px
// ===========================================================================

/**
 * The row dial, drawn in the *beach's own* reference frame rather than in
 * absolute compass orientation: the shore is always the vertical line, land is
 * always the tinted half on the left, open ocean is always on the right.
 *
 * That normalisation is the whole point. Eleven dials each rotated to its own
 * true compass heading are eleven puzzles; normalised, they are directly
 * comparable, and the two readings you actually care about become positional:
 *   · a swell arrow entering horizontally  = straight in;  steeply = side-shore
 *   · a wind arrow starting on the LEFT    = offshore (blowing out to sea)
 *     a wind arrow starting on the RIGHT   = onshore  (blowing the surf apart)
 * You read good-or-bad off which side the dashed arrow comes from, at a glance,
 * with no degrees involved.
 */
function dial(spot, swellFrom, windFrom) {
  const CX = 25, CY = 22, R = 19;
  const read = readSwell(spot, swellFrom);

  // Relative bearing -> screen angle. vec(θ + 90) points along (cos θ, sin θ),
  // i.e. θ = 0 is straight offshore and lands on the right of the dial.
  const rel = (b) => (((b - spot.facing_deg) % 360) + 540) % 360 - 180;
  const at = (theta, r) => {
    const v = vec(theta + 90);
    return { x: CX + v.x * r, y: CY + v.y * r };
  };

  // An opaque plate of its own, so the arrow casings always have a known colour
  // to knock out against no matter what the row behind is doing.
  let g = `<rect class="dial-bg" x="0" y="1" width="50" height="${CY * 2 - 2}"/>`;
  g += `<rect class="land-half" x="0" y="1" width="${CX}" height="${CY * 2 - 2}"/>`;
  g += wedge(CX, CY, R, rel(spot.swell_window[0]) + 90, rel(spot.swell_window[1]) + 90, "win");
  g += `<line class="face" x1="${CX}" y1="2.5" x2="${CX}" y2="${CY * 2 - 2.5}"/>`;

  if (swellFrom != null) {
    const a = at(rel(swellFrom), R), b = at(rel(swellFrom), 6);
    g += arrowTo(a.x, a.y, b.x, b.y, "sw", true, true);
  }
  if (windFrom != null) {
    const a = at(rel(windFrom), R), b = at(rel(windFrom), 7);
    g += arrowTo(a.x, a.y, b.x, b.y, "wd", false, true);
  }
  return `<svg class="dial ${read.lit ? "" : "is-shadowed"}" viewBox="0 0 50 44"
    aria-hidden="true">${g}</svg>`;
}

// ===========================================================================
// Text
// ===========================================================================

const fmtDeg = (deg, compass) => (deg == null ? "n/a" : `${compass ?? ""} ${Math.round(deg)}°`.trim());

/** The buoy reports raw precision (0.768 m, 12.93 s); the surf does not. */
const fmtNum = (v, dp = 1) => (v == null ? "—" : Number(v).toFixed(dp));

// Wave height is stored and scored in metres (buoy Hs, matching spots.js), but
// surfers here talk in feet, so metres never reach the screen — only this does.
const M_TO_FT = 3.28084;
const toFt = (m) => (m == null ? null : m * M_TO_FT);
/** Rounded to the half-foot, the way a surf report actually reads. */
function fmtFt(m, withUnit = true) {
  const ft = toFt(m);
  if (ft == null) return "—";
  const r = Math.round(ft * 2) / 2;
  return `${r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)}${withUnit ? " ft" : ""}`;
}

/** A null value means "does not apply here" (tide at a beach with no tide
 *  preference), which is shown as n/a rather than as a free full bar. */
function meter(label, value) {
  if (value == null) {
    return `<div class="meter is-na">
      <span class="label">${label}</span>
      <span class="val">n/a</span>
      <div class="track"></div>
    </div>`;
  }
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const band = pct < 35 ? "is-bad" : pct < 65 ? "is-mid" : "is-good";
  return `<div class="meter ${band}">
    <span class="label">${label}</span>
    <span class="val num">${pct}</span>
    <div class="track"><div class="fill" style="width:${pct}%"></div></div>
  </div>`;
}

/**
 * Tier badge. Carries the rating on three independent channels — fill/ink,
 * glyph shape, and the word itself — so it never depends on hue alone:
 *   prime  filled diamond   ok  half-filled circle   flat  open dash
 */
const TIER_GLYPH = {
  prime: '<path d="M5 0 L10 5 L5 10 L0 5 Z"/>',
  ok: '<path d="M5 0 A5 5 0 0 1 5 10 Z"/><circle cx="5" cy="5" r="4.4" fill="none" stroke-width="1.2"/>',
  flat: '<rect x="0.5" y="4.2" width="9" height="1.6" rx="0.8"/>',
};

function badge(score) {
  return `<span class="badge ${score.tierCls}">
    <svg class="tier-glyph" viewBox="0 0 10 10" aria-hidden="true">${TIER_GLYPH[score.tier]}</svg>
    ${score.tierLabel}
  </span>`;
}

// ===========================================================================
// Forecast bar
//
// Two sections per spot: today in five parts, then morning/afternoon across the
// week. Each scrolls inside itself — the page itself must never scroll
// sideways, which is the whole constraint at 375px.
//
// Tiles carry the tier the same way the badges do (fill, glyph, and for the
// arrows a hue) rather than by colour alone. Arrows are CSS border triangles
// rotated by the travel bearing: at this size a shape distinction would be
// illegible anyway, and 200+ inline SVGs would cost more than they return.
// ===========================================================================

function forecastTile(spot, slot, tideModel) {
  const h = slot.hour;
  const tideState = tideModel.ok ? tideModel.stateAt(slot.ts) : null;
  const cond = condFromForecast(h, tideState);
  const score = SCORE.scoreSpot(spot, cond);
  const swellTravel = h.swellFromDeg == null ? null : (h.swellFromDeg + 180) % 360;
  const windTravel = h.windFromDeg == null ? null : (h.windFromDeg + 180) % 360;

  return `<div class="fc-tile ${score.tierCls} ${slot.past ? "is-past" : ""}"
     data-ts="${slot.ts}" data-spot="${spot.id}"
     title="${slot.label} · ${fmtFt(score.hsAtSpot)} at ${spot.short} @ ${fmtNum(h.periodS, 0)}s · wind ${Math.round(h.windKmh ?? 0)} km/h · ${score.tierLabel}">
    <span class="fc-when">${slot.label}</span>
    <span class="fc-hs num">${fmtFt(score.hsAtSpot, false)}<span class="fc-unit">ft</span></span>
    <span class="fc-period num">${fmtNum(h.periodS, 0)}s</span>
    <span class="fc-arrows">
      ${swellTravel == null ? "" : `<i class="fc-arr fc-sw" style="--rot:${Math.round(swellTravel)}deg"></i>`}
      ${windTravel == null ? "" : `<i class="fc-arr fc-wd" style="--rot:${Math.round(windTravel)}deg"></i>`}
    </span>
    <span class="fc-wind num">${h.windKmh == null ? "—" : Math.round(h.windKmh)}</span>
  </div>`;
}

function forecastBar(spot, slots, tideModel) {
  if (!slots.today.length && !slots.tomorrow.length) return "";

  // Every column carries a day cell, blank when it is not the first of its day.
  // Without it the labelled and unlabelled columns start at different heights.
  const dayCell = (s, i, arr) => {
    const first = i === 0 || arr[i - 1].day.dayKey !== s.day.dayKey;
    return `<span class="fc-day">${first ? s.day.weekday : ""}</span>`;
  };
  const strip = (list) => list.map((s) => forecastTile(spot, s, tideModel)).join("");

  return `<div class="fc">
    <div class="fc-days">
      <div class="fc-section">
        <span class="fc-head label">Today</span>
        <div class="fc-strip">${strip(slots.today)}</div>
      </div>
      <div class="fc-section">
        <span class="fc-head label">Tomorrow</span>
        <div class="fc-strip">${strip(slots.tomorrow)}</div>
      </div>
    </div>
    ${!slots.week.length ? "" : `
    <button class="fc-toggle" type="button" data-week="${spot.id}" aria-expanded="false">
      <span class="fc-toggle-mark" aria-hidden="true"></span> Rest of the week
    </button>
    <div class="fc-section fc-section-week" id="week-${spot.id}" hidden>
      <div class="fc-strip">${slots.week.map((s, i, arr) =>
        `<div class="fc-col">${dayCell(s, i, arr)}${forecastTile(spot, s, tideModel)}</div>`).join("")}</div>
    </div>`}
  </div>`;
}

function renderConditions(swell, wind, tideModel, errors, tidePending) {
  const t = tideAt(tideModel, Date.now());
  const tideFig = t && t.next
    ? `${t.next.height_m}<span class="unit"> m</span>`
    : `—`;
  const tideMeta = t && t.next
    ? `${t.next.type === "high" ? "High tide" : "Low tide"} <strong>${t.next.time_display}</strong> · now ${t.state}`
    : tidePending ? "Reading the BOM table…" : "No tide data";

  document.getElementById("conditions").innerHTML = `
    ${errors.length ? `<p class="alert">${errors.join(" · ")}</p>` : ""}
    <div class="reading">
      <span class="label">Swell · SYDDOW buoy</span>
      <div class="figure num">${fmtFt(swell.wave_height_hs_m, false)}<span class="unit"> ft</span><span class="sep">/</span>${fmtNum(swell.wave_period_tp1_s, 1)}<span class="unit"> s</span></div>
      <p class="meta">From <strong>${fmtDeg(swell.wave_direction_deg, swell.wave_direction_compass)}</strong> · ${swell.observed_at ?? "n/a"}</p>
    </div>
    <div class="reading">
      <span class="label">Wind · BOM North Head</span>
      <div class="figure num">${wind.wind_speed_kmh ?? "—"}<span class="unit"> km/h</span></div>
      <p class="meta">From <strong>${fmtDeg(wind.wind_dir_deg, wind.wind_dir_compass)}</strong> · gusts ${wind.gust_kmh ?? "—"} km/h</p>
    </div>
    <div class="reading">
      <span class="label">Tide · Fort Denison</span>
      <div class="figure num">${tideFig}</div>
      <p class="meta">${tideMeta}</p>
    </div>`;
}

/**
 * Plain-language read of what the session would actually feel like. Built from
 * the same classifications the score uses, so it can never describe a good
 * wave next to a "flat" badge — every clause is derived, not written.
 */
function surfNarrative(spot, score, cond, tideInfo) {
  const size = {
    flat: "Barely a ripple",
    small: "Small, knee-to-waist stuff",
    chest: "Waist-to-chest sets",
    head_high: "Head-high sets",
    overhead: "Overhead and serious",
  }[score.sizeClass];

  const period = cond.periodS == null ? ""
    : cond.periodS >= 13 ? " on long-period ground swell, so expect real push and well-spaced sets"
    : cond.periodS >= 10 ? " with decent spacing between sets"
    : " on short-period windswell — close together and gutless";

  const wind = score.windDir === "offshore"
    ? (score.windLight ? "Light offshore, so faces should be clean and glassy"
       : "Offshore wind holding the faces open")
    : score.windLight ? "Almost no wind, so it'll be glassy whatever the direction"
    : score.windDir === "cross" ? "Cross-shore wind putting a wobble on the face"
    : "Onshore wind — bumpy, crumbly and disorganised";

  const shape = !score.rideable
    ? (score.inWindow ? "not enough swell getting in to work" : "the swell is out of this beach's window, so it'll be near flat")
    : spot.kind === "reef" ? "breaking over reef, so it'll have more shape than the beachies"
    : "shifting beach-break peaks — worth walking to find the bank";

  const tide = tideInfo && tideInfo.next
    ? ` Tide is ${tideInfo.next.type === "high" ? "pushing in" : "running out"} toward ${tideInfo.next.time_display}${
        spot.tide_pref === "mid-high" && cond.tideState === "low"
          ? ", and this one wants water on it — worth waiting" : ""}.`
    : "";

  const verdict = {
    epic: " Drop everything.",
    pumping: " Go now.",
    ok: " Worth a look.",
    flat: " Probably one for the coffee instead.",
  }[score.tier];

  return `${size}${period}. ${wind}, ${shape}.${tide}${verdict}`;
}

function renderVerdict(row, cond, ms, isMeasured, tideModel) {
  const { spot, score } = row;
  const sw = readSwell(spot, cond.swellFromDeg);
  const wd = readWind(spot, cond.windFromDeg, cond.windKmh);
  const t = tideAt(tideModel, ms);

  const why = [
    cond.swellFromDeg != null
      ? `Swell from ${fmtDeg(cond.swellFromDeg, degToCompass(cond.swellFromDeg))} coming in <strong>${sw.text}</strong>${sw.inc != null ? ` (${Math.round(sw.inc)}° off the beach)` : ""}.`
      : "No swell reading.",
    cond.windFromDeg != null
      ? `Wind from the ${degToCompass(cond.windFromDeg)} at ${Math.round(cond.windKmh)} km/h, <strong>${wd.text}</strong>.`
      : "No wind reading.",
    t && t.next ? `Tide heading to ${t.next.type === "high" ? "high" : "low"} ${t.next.time_display}.` : "",
  ].join(" ");

  // The heading names the moment being looked at, so scrubbing the slider
  // never leaves the reader guessing whether this is now or a forecast.
  const when = isMeasured ? "right now" : `at ${FORECAST.fmtWhen(ms, STATE.baseMs)}`;

  document.getElementById("verdict").innerHTML = `
    <article class="verdict">
      <div class="verdict-top">
        <div>
          <span class="label">Best bet ${when} ${isMeasured ? "" : '<span class="src-tag">forecast</span>'}</span>
          <h2>${spot.name}</h2>
        </div>
        ${badge(score)}
      </div>
      <p class="why">${why}</p>
      <p class="narrative">${surfNarrative(spot, score, cond, t)}</p>
      <div class="verdict-metrics">
        ${meter("Swell", score.swell)}
        ${meter("Wind", score.wind)}
        ${meter("Tide", score.tide)}
      </div>
    </article>`;
}

function renderSheet(rows, cond, slots, tideModel) {
  const sheet = document.getElementById("sheet");
  // Derived from the data rather than written into the markup, so removing or
  // adding a spot can never leave the heading claiming the wrong count.
  const heading = document.getElementById("sheet-heading");
  if (heading) heading.textContent = `All ${rows.length} spots, south to north`;
  sheet.querySelectorAll(".spot").forEach((n) => n.remove());

  sheet.insertAdjacentHTML("beforeend", rows.map(({ spot, score }) => {
    const sw = readSwell(spot, cond.swellFromDeg);
    const wd = readWind(spot, cond.windFromDeg, cond.windKmh);
    return `<li class="spot" id="spot-${spot.id}" data-spot="${spot.id}">
      <button class="spot-row" type="button" aria-expanded="false">
        <span class="spot-id">
          ${dial(spot, cond.swellFromDeg, cond.windFromDeg)}
          <span>
            <h3>${spot.name}</h3>
            <span class="kind label">${spot.kind === "reef" ? "Reef" : "Beach"}</span>
          </span>
        </span>
        <span class="readout readout-swell">
          <span class="v">${sw.text}</span>
          <span class="d">window ${spot.swell_window[0]}–${spot.swell_window[1]}°</span>
        </span>
        <span class="readout readout-wind">
          <span class="v">${wd.text}</span>
          <span class="d">${wd.rel != null ? `${Math.round(wd.rel)}° off offshore` : "n/a"}</span>
        </span>
        ${badge(score)}
      </button>
      ${forecastBar(spot, slots, tideModel)}
      <div class="spot-detail" hidden>
        <p>${spot.note}</p>
        <div class="metrics">
          ${meter("Swell", score.swell)}
          ${meter("Wind", score.wind)}
          ${meter("Tide", score.tide)}
        </div>
        <div class="links">
          ${spot.surfline_url
            ? `<a href="${spot.surfline_url}" target="_blank" rel="noopener">View on Surfline ↗</a>`
            : `<span style="color:var(--ink-muted)">No dedicated Surfline page</span>`}
          <button class="btn" type="button" data-wg="${spot.id}">Detailed wind (Windguru)</button>
        </div>
        <div class="windguru" id="wg-${spot.id}" hidden>
          <p class="note">Windguru free tier: forecast lags, not real-time. Not used in the ranking.</p>
          <iframe loading="lazy" src="about:blank" data-src="https://www.windguru.cz/${spot.windguru_id}" title="Windguru ${spot.name}"></iframe>
        </div>
      </div>
    </li>`;
  }).join(""));

  sheet.querySelectorAll(".spot-row").forEach((btn) => {
    const li = btn.closest(".spot");
    btn.addEventListener("click", () => {
      const detail = li.querySelector(".spot-detail");
      const open = !detail.hidden;
      detail.hidden = open;
      btn.setAttribute("aria-expanded", String(!open));
      selectSpot(li.dataset.spot, false);
    });
    btn.addEventListener("mouseenter", () => selectSpot(li.dataset.spot, false));
  });

  sheet.querySelectorAll("[data-week]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const box = document.getElementById(`week-${btn.dataset.week}`);
      const open = !box.hidden;
      box.hidden = open;
      btn.setAttribute("aria-expanded", String(!open));
      btn.classList.toggle("is-open", !open);
    });
  });

  sheet.querySelectorAll("[data-wg]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const box = document.getElementById(`wg-${btn.dataset.wg}`);
      const wasHidden = box.hidden;
      box.hidden = !wasHidden;
      if (wasHidden) {
        const f = box.querySelector("iframe");
        if (f.src === "about:blank" || !f.src.includes("windguru")) f.src = f.dataset.src;
      }
    });
  });
}

// ===========================================================================
// State and the time axis
//
// `STATE.hourOffset` is the one variable that makes the slider mean anything:
// 0 is "right now" (measured), 1..48 is that many hours into the forecast.
// Everything downstream of it — the ranking, the map arrows, the per-spot
// readouts, which forecast-bar column is lit — is a pure function of it via
// condAt(), so moving the slider and the initial page load run the exact same
// code path rather than two versions that can drift apart.
// ===========================================================================

// baseMs anchors offsets 1..48 to the top of the hour, not to the exact load
// instant. The forecast series and the forecast-bar tiles both live on the
// hour (…:00 exactly); anchoring to e.g. 19:34 would make every later offset
// land 34 minutes off that grid, silently mismatching the tile the slider
// claims to be on and printing a ":00" label that was never quite true.
// Offset 0 stays exact — it always reads Date.now() directly, live.
let STATE = { rows: [], swell: {}, wind: {}, tideModel: null, hours: null, slots: null,
  activeId: null, hourOffset: 0, baseMs: Math.floor(Date.now() / FORECAST.HOUR_MS) * FORECAST.HOUR_MS };

function selectSpot(id, scroll) {
  if (STATE.activeId === id && !scroll) return;
  STATE.activeId = id;
  const { cond } = condAt(STATE.hourOffset);
  renderChart(STATE.rows, cond, id);
  document.querySelectorAll(".spot").forEach((li) =>
    li.classList.toggle("is-active", li.dataset.spot === id));
  if (scroll) document.getElementById(`spot-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

/**
 * Move the whole page to a given hour offset (0 = now, 1..48 = forecast) and
 * repaint everything that depends on time. Called on load and on every slider
 * step, which is also why it stays cheap: the forecast bars themselves are
 * NOT rebuilt here (their 200+ tiles are static — only which column is "now"
 * changes), and the ranked list keeps its geographic order rather than
 * reshuffling under the reader's cursor on every tick; only the verdict card
 * — the actual answer to "where's best right now" — reorders.
 */
function retime(offset) {
  STATE.hourOffset = offset;
  const { cond, ms, isMeasured } = condAt(offset);

  STATE.ms = ms;
  STATE.cond = cond;
  const rows = SPOTS.map((spot) => ({ spot, score: SCORE.scoreSpot(spot, cond) }));
  const best = rows.slice().sort(SCORE.compareScored)[0];
  const byOrder = rows.slice().sort((a, b) => a.spot.order - b.spot.order);
  STATE.rows = byOrder;

  renderVerdict(best, cond, ms, isMeasured, STATE.tideModel);
  updateSheetForTime(byOrder, cond);
  updateForecastHighlight(ms);
  renderChart(byOrder, cond, STATE.activeId ?? best.spot.id);
  renderTimeControl(offset, ms, isMeasured);
  document.querySelector(`.spot[data-spot="${STATE.activeId ?? best.spot.id}"]`)?.classList.add("is-active");
}

/** Patch the already-rendered rows in place: dial, readouts, badge, meters. */
function updateSheetForTime(rows, cond) {
  for (const { spot, score } of rows) {
    const li = document.querySelector(`.spot[data-spot="${spot.id}"]`);
    if (!li) continue;
    const sw = readSwell(spot, cond.swellFromDeg);
    const wd = readWind(spot, cond.windFromDeg, cond.windKmh);

    const dialEl = li.querySelector(".dial");
    if (dialEl) dialEl.outerHTML = dial(spot, cond.swellFromDeg, cond.windFromDeg);

    const rs = li.querySelector(".readout-swell");
    if (rs) rs.innerHTML = `<span class="v">${sw.text}</span>
      <span class="d">window ${spot.swell_window[0]}–${spot.swell_window[1]}°</span>`;
    const rw = li.querySelector(".readout-wind");
    if (rw) rw.innerHTML = `<span class="v">${wd.text}</span>
      <span class="d">${wd.rel != null ? `${Math.round(wd.rel)}° off offshore` : "n/a"}</span>`;

    const badgeEl = li.querySelector(".spot-row .badge");
    if (badgeEl) badgeEl.outerHTML = badge(score);

    const metricsEl = li.querySelector(".spot-detail .metrics");
    if (metricsEl) metricsEl.innerHTML =
      meter("Swell", score.swell) +
      meter("Wind", score.wind) +
      meter("Tide", score.tide);
  }
}

/** Lights up the forecast-bar column matching the slider's hour, if one exists
 *  at that exact hour — the bars are curated slices of the week, the slider
 *  covers every hour, so most positions between tiles simply light nothing. */
function updateForecastHighlight(ms) {
  const snapped = Math.round(ms / FORECAST.HOUR_MS) * FORECAST.HOUR_MS;
  document.querySelectorAll(".fc-tile.is-now").forEach((el) => el.classList.remove("is-now"));
  document.querySelectorAll(`.fc-tile[data-ts="${snapped}"]`).forEach((el) => el.classList.add("is-now"));
}

/** The always-visible time readout and control state. */
function renderTimeControl(offset, ms, isMeasured) {
  const label = document.getElementById("time-label");
  if (label) {
    label.textContent = isMeasured ? "Now — measured" : FORECAST.fmtWhen(ms, STATE.baseMs);
    label.classList.toggle("is-forecast", !isMeasured);
  }
  const slider = document.getElementById("time-slider");
  if (slider && Number(slider.value) !== offset) slider.value = offset;
  const back = document.getElementById("time-back"), fwd = document.getElementById("time-fwd");
  if (back) back.disabled = offset <= 0;
  if (fwd) fwd.disabled = offset >= 48;
}

function wireTimeControl() {
  const slider = document.getElementById("time-slider");
  const back = document.getElementById("time-back"), fwd = document.getElementById("time-fwd");
  // retime() only touches 11 rows and rebuilds one small SVG, so there is no
  // real cost in calling it straight from the event — an rAF-coalesced
  // version was tried here first, but on a backgrounded or occluded tab a
  // rAF callback can be deferred indefinitely, which made the slider
  // silently stop updating. Direct and synchronous is both simpler and more
  // reliable, and it's not slow enough to need the indirection anyway.
  slider?.addEventListener("input", (e) => retime(Number(e.target.value)));
  back?.addEventListener("click", () => retime(clamp(STATE.hourOffset - 1, 0, 48)));
  fwd?.addEventListener("click", () => retime(clamp(STATE.hourOffset + 1, 0, 48)));
}

/** The one-time page skeleton: conditions band, legend, and the static (per
 *  load, not per hour) forecast bars. `retime(0)` then does the first paint of
 *  everything time-dependent, exactly as every later slider move will. */
function renderShell(swell, wind, tide, forecast, errors, tidePending) {
  STATE.swell = swell;
  STATE.wind = wind;
  STATE.tideModel = FORECAST.buildTide(tide);
  STATE.hours = FORECAST.buildHours(forecast);
  // The true instant, not the floored baseMs: "has this tile already passed"
  // has to be judged against the actual current time, or a tile can hang
  // around after its hour has gone (baseMs floors down, so a tile up to 59
  // minutes stale would still read as "upcoming"). baseMs stays reserved for
  // the slider's own hour arithmetic in condAt(), a separate concern.
  STATE.slots = FORECAST.buildSlots(STATE.hours, Date.now());

  renderConditions(swell, wind, STATE.tideModel, errors, tidePending);
  renderLegend();

  const seedCond = condAt(0).cond;
  const seedRows = SPOTS.map((spot) => ({ spot, score: SCORE.scoreSpot(spot, seedCond) }))
    .sort((a, b) => a.spot.order - b.spot.order);
  renderSheet(seedRows, seedCond, STATE.slots, STATE.tideModel);
  STATE.activeId = STATE.activeId
    ?? seedRows.slice().sort(SCORE.compareScored)[0].spot.id;

  retime(STATE.hourOffset);
}

async function main() {
  for (const spot of SPOTS) spot.xy = snapToShore(project(spot.lat, spot.lng));
  // Drawn once and never touched again — it does not depend on any data, so
  // no repaint, no slider tick and no fetch can cost anything here.
  document.getElementById("ground").innerHTML = CHROME.pageGround(1600, 1000);
  wireTimeControl();

  const swellP = fetchJson("/api/mhl");
  const windP = fetchJson("/api/wind");
  const tideP = fetchJson("/api/tide");
  const forecastP = fetchJson("/api/forecast");

  const take = (r, msg, errors) => {
    if (r.status === "fulfilled" && !r.value.error) return r.value;
    errors.push(msg);
    return {};
  };

  // Swell and wind are what the headline turns on, and both are fast. The BOM
  // tide table is an HTML scrape and the forecast is two upstream calls, either
  // of which can take seconds — waiting on them held the whole page blank, so
  // paint without them and fold each in as it lands.
  const [swellR, windR] = await Promise.allSettled([swellP, windP]);
  const errors = [];
  const swell = take(swellR, "Couldn't read the MHL buoy", errors);
  const wind = take(windR, "Couldn't read BOM wind", errors);
  renderShell(swell, wind, {}, {}, errors, true);

  const [tideR, forecastR] = await Promise.allSettled([tideP, forecastP]);
  const later = errors.slice();
  const tide = take(tideR, "Couldn't read BOM tide", later);
  const forecast = take(forecastR, "Couldn't read the forecast", later);
  renderShell(swell, wind, tide, forecast, later, false);
}

main();
