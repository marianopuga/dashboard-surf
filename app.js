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

/** Smallest angle between two bearings, 0–180. */
function angleDiff(a, b) {
  if (a == null || b == null) return null;
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Is `bearing` inside the arc that runs clockwise from `a0` to `a1`? */
function inArc(bearing, a0, a1) {
  if (bearing == null) return false;
  const span = (a1 - a0 + 360) % 360;
  const off = (bearing - a0 + 360) % 360;
  return off <= span;
}

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
 * Uncapped, Fairy Bower — tucked inside Cabbage Tree Bay, where "nearest point
 * on the coastline" is not a meaningful idea — jumped 119 m and swapped places
 * with Shelly, putting the map out of geographic order.
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
// a flat day at Shelly. What matters is the bearing *relative to the beach*, so
// everything below is expressed in that frame and given a plain-language name.
// ===========================================================================

/** Swell relative to the beach face. 0° incidence = straight in. */
function readSwell(spot, swellFrom) {
  if (swellFrom == null) return { text: "no data", inc: null, lit: false };
  const inc = angleDiff(swellFrom, spot.facing_deg);
  const lit = inArc(swellFrom, spot.swell_window[0], spot.swell_window[1]);
  if (!lit) return { text: "outside window", inc, lit };
  if (inc < 25) return { text: "straight in", inc, lit };
  if (inc < 55) return { text: "somewhat cross", inc, lit };
  return { text: "very cross", inc, lit };
}

/** Wind relative to the beach. 0° = straight offshore, 180° = straight onshore. */
function readWind(spot, windFrom, kmh) {
  if (windFrom == null) return { text: "no data", rel: null };
  const rel = angleDiff(windFrom, (spot.facing_deg + 180) % 360);
  if (kmh != null && kmh < 8) return { text: "calm", rel };
  let text;
  if (rel < 45) text = "offshore";
  else if (rel < 80) text = "cross-offshore";
  else if (rel < 100) text = "cross";
  else if (rel < 135) text = "cross-onshore";
  else text = "onshore";
  return { text, rel };
}

// ===========================================================================
// Scoring (unchanged model, sub-scores exposed so the meters can show them)
// ===========================================================================

function triangularScore(v, [lo, hi]) {
  if (v == null) return 0.5;
  const mid = (lo + hi) / 2;
  if (v >= lo && v <= hi) return 1 - (0.3 * Math.abs(v - mid)) / ((hi - lo) / 2 || 1);
  const dist = v < lo ? lo - v : v - hi;
  return Math.max(0, 1 - dist / (hi - lo || 1));
}

function windScoreFor(facingDeg, windDeg, speedKmh) {
  if (windDeg == null) return 0.5;
  const diff = angleDiff(windDeg, (facingDeg + 180) % 360);
  let base = 1 - diff / 180;
  if (speedKmh != null && speedKmh < 8) base = Math.max(base, 0.7);
  if (speedKmh != null && speedKmh > 20 && diff > 120) base = Math.min(base, 0.15);
  return Math.max(0, Math.min(1, base));
}

function scoreSpot(spot, swell, wind, tide) {
  const [dmin, dmax] = spot.swell_window;
  const center = (dmin + dmax) / 2;
  const halfWidth = (dmax - dmin) / 2;
  const dirDiff = angleDiff(swell.wave_direction_deg, center) ?? 90;
  const dirScore = Math.max(0, 1 - dirDiff / (halfWidth + 40));

  const sizeScore = triangularScore(swell.wave_height_hs_m, spot.good_size_m);
  const periodOK = spot.min_period_s
    ? (swell.wave_period_tp1_s >= spot.min_period_s ? 1 : 0.4)
    : 1;
  const windScore = windScoreFor(spot.facing_deg, wind.wind_dir_deg, wind.wind_speed_kmh);

  let tideScore = 1;
  if (spot.tide_pref === "mid-high" && tide && tide.state) {
    tideScore = tide.state === "low" ? 0.4 : tide.state === "rising-from-low" ? 0.7 : 1;
  }

  const total = (dirScore * 0.3 + sizeScore * 0.25 + windScore * 0.3 + tideScore * 0.15) * periodOK;
  return { total, dirScore, sizeScore, windScore, tideScore, periodOK };
}

/**
 * Quality is expressed as ink density on one hue, not as a traffic light:
 * solid Coffee = worth the drive, outlined Coffee = it'll do, neutral Antique =
 * ignore it. Red/amber/green borrows a hazard metaphor from a domain that does
 * not apply here, and it dies in greyscale.
 */
function quality(total) {
  if (total >= 0.72) return { text: "Very good", cls: "q-good" };
  if (total >= 0.5) return { text: "OK", cls: "q-ok" };
  return { text: "Poor", cls: "q-poor" };
}

function tideStateNow(tide) {
  if (!tide || !tide.events || !tide.events.length) return null;
  const now = new Date();
  const events = tide.events
    .map((e) => ({ ...e, dt: new Date(e.time_local) }))
    .sort((a, b) => a.dt - b.dt);
  let prev = null, next = null;
  for (const e of events) {
    if (e.dt <= now) prev = e;
    if (e.dt > now && !next) next = e;
  }
  if (!prev || !next) return { state: "unknown", prev, next };
  const frac = next.dt - prev.dt > 0 ? (now - prev.dt) / (next.dt - prev.dt) : 0;
  let state;
  if (prev.type === "low" && frac < 0.3) state = "low";
  else if (prev.type === "high" && frac < 0.3) state = "high";
  else state = "mid";
  return { state, prev, next, frac };
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
  const h = Math.min(9, L * 0.42);

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

/** Parallel swell crest lines — the wave train, marching at the coast. */
function crestField(from) {
  const t = (from + 180) % 360;
  const d = vec(t);
  const p = { x: -d.y, y: d.x };
  const cx = COAST.W / 2, cy = COAST.H / 2;
  const reach = Math.hypot(COAST.W, COAST.H);
  let out = "";
  for (let k = -Math.ceil(reach / 2 / 30); k <= Math.ceil(reach / 2 / 30); k++) {
    const ax = cx + d.x * k * 30, ay = cy + d.y * k * 30;
    out += `<line class="swell-crest" x1="${(ax - p.x * reach).toFixed(1)}" y1="${(ay - p.y * reach).toFixed(1)}"
      x2="${(ax + p.x * reach).toFixed(1)}" y2="${(ay + p.y * reach).toFixed(1)}"/>`;
  }
  return out;
}

function renderChart(rows, swell, wind, activeId) {
  const svg = document.getElementById("chart");
  svg.setAttribute("viewBox", `${VIEW.x} 0 ${VIEW.w} ${COAST.H}`);

  const swellFrom = swell.wave_direction_deg;
  const windFrom = wind.wind_dir_deg;

  // Swell arrows and wind arrows share one offshore band and alternate down the
  // coast, so you can compare them at the same stretch of beach.
  const offshore = (yFrac, dist) => {
    const y = COAST.H * yFrac;
    return { x: Math.min(COAST.W - 26, SHORE_X(y) + dist), y };
  };

  let field = "";
  if (swellFrom != null) {
    field += `<g clip-path="url(#sea-clip)">${crestField(swellFrom)}</g>`;
    for (const f of [0.20, 0.52, 0.84]) {
      const p = offshore(f, 66);
      field += swellArrow(p.x, p.y, swellFrom, 38);
    }
  }
  if (windFrom != null) {
    for (const f of [0.36, 0.68]) {
      const p = offshore(f, 66);
      field += windArrow(p.x, p.y, windFrom, 38);
    }
  }

  // Shelly through North Steyne sit within a few hundred metres of each other,
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

  // Split into two layers: the active spot's geometry sits under every pin, so
  // a wedge can never cover a neighbouring dot.
  const geometry = [];
  const pins = rows.map(({ spot, q }) => {
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
        // Held off the pin so it does not collide with the label. The field
        // arrows already carry the wind, so only the swell is repeated here.
        swellFrom != null
          ? swellArrow(p.x + vec(swellFrom).x * 62, p.y + vec(swellFrom).y * 62, swellFrom, 46)
          : ""
      );
    }
    return `<g class="pin ${q.cls} ${isActive ? "is-active" : ""}" data-spot="${spot.id}"
              transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
        <circle class="halo" r="9"/>
        <circle class="dot" r="4.5"/>
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

  svg.innerHTML = `
    <defs><clipPath id="sea-clip"><path d="${SEA_PATH}"/></clipPath></defs>
    <rect class="sea" x="${VIEW.x}" y="0" width="${VIEW.w}" height="${COAST.H}"/>
    <g clip-path="url(#sea-clip)">
      ${COAST.contours.map((d) => `<path class="depth" d="${d}"/>`).join("")}
    </g>
    ${field}
    <path class="land" d="${LAND_PATH}"/>
    <path class="shore" d="${COAST.coast}"/>
    ${COAST.rocks.map((d) => `<path class="rock" d="${d}"/>`).join("")}
    ${geometry.join("")}
    ${pins.join("")}
    ${labels.join("")}
  `;

  svg.querySelectorAll(".pin").forEach((g) => {
    const id = g.dataset.spot;
    g.addEventListener("click", () => selectSpot(id, true));
    g.addEventListener("mouseenter", () => selectSpot(id, false));
  });

  document.getElementById("chart-active").textContent =
    SPOTS.find((s) => s.id === activeId)?.name ?? "—";
}

const legendSvg = (inner) => `<svg viewBox="0 0 34 12" aria-hidden="true">${inner}</svg>`;

function renderLegend() {
  document.getElementById("chart-legend").innerHTML = `
    <div>${legendSvg(swellArrow(17, 6, 270, 26))} Swell — where it's heading</div>
    <div>${legendSvg(windArrow(17, 6, 270, 24))} Wind — where it's blowing</div>
    <div>${legendSvg(`<path class="window-wedge" d="M2 11 L2 1 A10 10 0 0 1 12 11 Z"/>
      <path class="window-edge" d="M2 11 L2 1 M2 11 L12 11"/>`)} Swell window of the active spot</div>`;
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

function meter(label, value, weak) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `<div class="meter ${weak ? "is-weak" : ""}">
    <span class="label">${label}</span>
    <span class="val num">${pct}</span>
    <div class="track"><div class="fill" style="width:${pct}%"></div></div>
  </div>`;
}

function renderConditions(swell, wind, tide, errors, tidePending) {
  const t = tideStateNow(tide);
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
      <div class="figure num">${swell.wave_height_hs_m ?? "—"}<span class="unit"> m</span><span class="sep">/</span>${swell.wave_period_tp1_s ?? "—"}<span class="unit"> s</span></div>
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

function renderVerdict(row, swell, wind, tide) {
  const { spot, score, q } = row;
  const sw = readSwell(spot, swell.wave_direction_deg);
  const wd = readWind(spot, wind.wind_dir_deg, wind.wind_speed_kmh);
  const t = tideStateNow(tide);

  const why = [
    swell.wave_direction_deg != null
      ? `Swell from ${fmtDeg(swell.wave_direction_deg, swell.wave_direction_compass)} coming in <strong>${sw.text}</strong>${sw.inc != null ? ` (${Math.round(sw.inc)}° off the beach)` : ""}.`
      : "No swell reading.",
    wind.wind_dir_deg != null
      ? `Wind from the ${wind.wind_dir_compass} at ${wind.wind_speed_kmh} km/h, <strong>${wd.text}</strong>.`
      : "No wind reading.",
    t && t.next ? `Tide heading to ${t.next.type === "high" ? "high" : "low"} ${t.next.time_display}.` : "",
  ].join(" ");

  document.getElementById("verdict").innerHTML = `
    <article class="verdict">
      <div class="verdict-top">
        <div>
          <span class="label">Best bet today</span>
          <h2>${spot.name}</h2>
        </div>
        <span class="badge ${q.cls}">${q.text}</span>
      </div>
      <p class="why">${why}</p>
      <div class="verdict-metrics">
        ${meter("Direction", score.dirScore, score.dirScore < 0.5)}
        ${meter("Size", score.sizeScore, score.sizeScore < 0.5)}
        ${meter("Wind", score.windScore, score.windScore < 0.5)}
      </div>
    </article>`;
}

function renderSheet(rows, swell, wind) {
  const sheet = document.getElementById("sheet");
  sheet.querySelectorAll(".spot").forEach((n) => n.remove());
  const swellFrom = swell.wave_direction_deg, windFrom = wind.wind_dir_deg;

  sheet.insertAdjacentHTML("beforeend", rows.map(({ spot, score, q }) => {
    const sw = readSwell(spot, swellFrom);
    const wd = readWind(spot, windFrom, wind.wind_speed_kmh);
    return `<li class="spot" id="spot-${spot.id}" data-spot="${spot.id}">
      <button class="spot-row" type="button" aria-expanded="false">
        <span class="spot-id">
          ${dial(spot, swellFrom, windFrom)}
          <span>
            <h3>${spot.name}</h3>
            <span class="kind label">${spot.kind === "reef" ? "Reef" : "Beach"}</span>
          </span>
        </span>
        <span class="readout">
          <span class="v">${sw.text}</span>
          <span class="d">window ${spot.swell_window[0]}–${spot.swell_window[1]}°</span>
        </span>
        <span class="readout">
          <span class="v">${wd.text}</span>
          <span class="d">${wd.rel != null ? `${Math.round(wd.rel)}° off offshore` : "n/a"}</span>
        </span>
        <span class="badge ${q.cls}">${q.text}</span>
      </button>
      <div class="spot-detail" hidden>
        <p>${spot.note}</p>
        <div class="metrics">
          ${meter("Direction", score.dirScore, score.dirScore < 0.5)}
          ${meter("Size", score.sizeScore, score.sizeScore < 0.5)}
          ${meter("Wind", score.windScore, score.windScore < 0.5)}
          ${meter("Tide", score.tideScore, score.tideScore < 0.5)}
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
// State
// ===========================================================================

let STATE = { rows: [], swell: {}, wind: {}, activeId: null };

function selectSpot(id, scroll) {
  if (STATE.activeId === id && !scroll) return;
  STATE.activeId = id;
  renderChart(STATE.rows, STATE.swell, STATE.wind, id);
  document.querySelectorAll(".spot").forEach((li) =>
    li.classList.toggle("is-active", li.dataset.spot === id));
  if (scroll) document.getElementById(`spot-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

/** One full pass over the data. Cheap enough to simply re-run when tide lands. */
function render(swell, wind, tide, errors, tidePending) {
  renderConditions(swell, wind, tide, errors, tidePending);

  const tideNow = tideStateNow(tide);
  const rows = SPOTS.map((spot) => {
    const score = scoreSpot(spot, swell, wind, tideNow);
    return { spot, score, q: quality(score.total) };
  });

  const best = rows.slice().sort((a, b) => b.score.total - a.score.total)[0];
  const byOrder = rows.slice().sort((a, b) => a.spot.order - b.spot.order);

  // Keep whatever the reader was looking at across the tide re-render.
  const active = STATE.activeId ?? best.spot.id;
  STATE = { rows: byOrder, swell, wind, activeId: active };

  renderVerdict(best, swell, wind, tide);
  renderSheet(byOrder, swell, wind);
  renderLegend();
  renderChart(byOrder, swell, wind, active);
  document.querySelector(`.spot[data-spot="${active}"]`)?.classList.add("is-active");
}

async function main() {
  for (const spot of SPOTS) spot.xy = snapToShore(project(spot.lat, spot.lng));

  const swellP = fetchJson("/api/mhl");
  const windP = fetchJson("/api/wind");
  const tideP = fetchJson("/api/tide");

  const take = (r, msg, errors) => {
    if (r.status === "fulfilled" && !r.value.error) return r.value;
    errors.push(msg);
    return {};
  };

  // Swell and wind are what the ranking turns on, and both are fast. The BOM
  // tide table is an HTML scrape and can take several seconds — waiting on it
  // held the whole page blank, so paint without it and fold it in when it lands.
  const [swellR, windR] = await Promise.allSettled([swellP, windP]);
  const errors = [];
  const swell = take(swellR, "Couldn't read the MHL buoy", errors);
  const wind = take(windR, "Couldn't read BOM wind", errors);
  render(swell, wind, {}, errors, true);

  const tideR = await Promise.allSettled([tideP]).then((r) => r[0]);
  const tideErrors = errors.slice();
  const tide = take(tideR, "Couldn't read BOM tide", tideErrors);
  render(swell, wind, tide, tideErrors);
}

main();
