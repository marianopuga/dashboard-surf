// ===========================================================================
// Chart chrome — the antique-cartography furniture
//
// Original SVG linework drawn in the idiom of 16th–18th century sea charts
// (compass roses, galleons, sea serpents are a centuries-old public-domain
// genre) rather than traced from any particular image. Everything is built
// from the same six palette colours as the rest of the page.
//
// Kept in its own file because it is decoration, not instrumentation: app.js
// stays about data, and none of this needs to re-render when the time slider
// moves.
// ===========================================================================

const CHROME = (() => {
  const n = (v) => Number(v).toFixed(1);

  /**
   * Drop a scanned engraving onto the chart, centred on (cx,cy) and `w` units
   * wide. These are real public-domain plates (see assets/CREDITS.md), not
   * drawings — a 1747 Bowen compass, a 1617 Blaeu ship, 16th-century sea
   * monsters.
   *
   * Each scan carries its own paper background. Rather than cut alpha masks,
   * they are composited with `mix-blend-mode: multiply`: on a light parchment
   * the white-ish paper multiplies away to nothing and only the ink survives,
   * which is both closer to how the originals sat on a real chart and far
   * cheaper than masking four raster files.
   */
  function plate(href, cx, cy, w, cls, aspect = 1) {
    const h = w * aspect;
    return `<image class="plate plate-${cls}" href="${href}"
      x="${n(cx - w / 2)}" y="${n(cy - h / 2)}" width="${n(w)}" height="${n(h)}"
      preserveAspectRatio="xMidYMid meet"/>`;
  }

  let cropSeq = 0;
  /**
   * Draw one region of a larger plate, centred on (cx,cy) at `destW` wide.
   *
   * The compass rose and the galleon both live inside a single treasure-map
   * image, so rather than saving cropped copies the source is scaled up and
   * clipped to the wanted rectangle — one file stays the source of truth, and
   * a crop is retuned by changing four numbers instead of re-exporting.
   *
   * `crop` is in fractions of the source (0-1): {x, y, w, h}.
   */
  function plateCrop(href, srcW, srcH, crop, cx, cy, destW, cls) {
    const id = `crop-${cls}-${cropSeq++}`;
    const destH = destW * ((crop.h * srcH) / (crop.w * srcW));
    // Scale the whole source so the crop region fills the destination box,
    // then offset it so the region's top-left lands on the box's top-left.
    const scale = destW / (crop.w * srcW);
    const fullW = srcW * scale, fullH = srcH * scale;
    const x0 = cx - destW / 2, y0 = cy - destH / 2;
    return `<clipPath id="${id}">
        <rect x="${n(x0)}" y="${n(y0)}" width="${n(destW)}" height="${n(destH)}"/>
      </clipPath>
      <image class="plate plate-${cls}" href="${href}" clip-path="url(#${id})"
        x="${n(x0 - crop.x * fullW)}" y="${n(y0 - crop.y * fullH)}"
        width="${n(fullW)}" height="${n(fullH)}"
        preserveAspectRatio="none"/>`;
  }

  /**
   * A 16-point wind rose. The eight ordinal points sit under the four cardinal
   * ones, each point split into a light and a dark half down its spine so it
   * reads as engraved relief the way a real rose does — that shading is what
   * makes it look drawn rather than diagrammatic.
   */
  function compassRose(cx, cy, r) {
    const pt = (bearing, len, halfWidth) => {
      const tip = vec(bearing);
      const l = vec(bearing - 90), rr = vec(bearing + 90);
      return {
        tipX: cx + tip.x * len, tipY: cy + tip.y * len,
        lX: cx + l.x * halfWidth, lY: cy + l.y * halfWidth,
        rX: cx + rr.x * halfWidth, rY: cy + rr.y * halfWidth,
      };
    };

    let points = "";
    // Secondary (inter-ordinal) points first, so the majors overlay them.
    for (let i = 0; i < 16; i++) {
      if (i % 4 === 0) continue;
      const b = i * 22.5;
      const len = i % 2 === 0 ? r * 0.62 : r * 0.4;
      const p = pt(b, len, r * 0.055);
      points += `<path class="rose-pt rose-pt-minor" d="M${n(p.tipX)} ${n(p.tipY)} L${n(p.lX)} ${n(p.lY)}
        L${n(cx)} ${n(cy)} L${n(p.rX)} ${n(p.rY)} Z"/>`;
    }
    // Four cardinal points, each as two halves for the light/shade split.
    for (let i = 0; i < 4; i++) {
      const b = i * 90;
      const p = pt(b, r, r * 0.1);
      points += `<path class="rose-pt rose-pt-light" d="M${n(p.tipX)} ${n(p.tipY)} L${n(p.lX)} ${n(p.lY)} L${n(cx)} ${n(cy)} Z"/>`;
      points += `<path class="rose-pt rose-pt-dark"  d="M${n(p.tipX)} ${n(p.tipY)} L${n(p.rX)} ${n(p.rY)} L${n(cx)} ${n(cy)} Z"/>`;
    }

    // Degree ticks around the outer ring.
    let ticks = "";
    for (let d = 0; d < 360; d += 15) {
      const v = vec(d);
      const inner = d % 45 === 0 ? r * 1.12 : r * 1.19;
      ticks += `<line class="rose-tick" x1="${n(cx + v.x * inner)}" y1="${n(cy + v.y * inner)}"
        x2="${n(cx + v.x * r * 1.28)}" y2="${n(cy + v.y * r * 1.28)}"/>`;
    }

    const lbl = (b, t) => {
      const v = vec(b);
      return `<text class="rose-label" x="${n(cx + v.x * r * 1.45)}" y="${n(cy + v.y * r * 1.45 + 2.6)}"
        text-anchor="middle">${t}</text>`;
    };

    return `<g class="compass-rose">
      <circle class="rose-ring" cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 1.28)}"/>
      <circle class="rose-ring rose-ring-inner" cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 1.12)}"/>
      ${ticks}
      ${points}
      <circle class="rose-hub" cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.1)}"/>
      ${lbl(0, "N")}${lbl(90, "E")}${lbl(180, "S")}${lbl(270, "W")}
    </g>`;
  }

  /** Rhumb lines, the bearing web radiating off the rose across the whole sea. */
  function rhumbLines(cx, cy, reach) {
    let out = "";
    for (let i = 0; i < 16; i++) {
      const v = vec(i * 22.5);
      out += `<line class="rhumb ${i % 4 === 0 ? "rhumb-main" : ""}"
        x1="${n(cx)}" y1="${n(cy)}" x2="${n(cx + v.x * reach)}" y2="${n(cy + v.y * reach)}"/>`;
    }
    return out;
  }

  /**
   * A three-masted galleon, side on: raked hull with a raised stern castle,
   * square courses and topsails on fore and main, a lateen on the mizzen, and
   * pennants. Drawn at roughly 74 units wide and scaled by the caller.
   */
  function galleon(cx, cy, scale) {
    // Sails are trapezoids with a bellied foot — the curve is what reads as
    // canvas under load rather than a flat panel. Each is drawn wider at the
    // bottom and offset to leeward of its mast so the rig looks driven.
    const sail = (mx, top, bot, halfTop, halfBot, belly) =>
      `<path class="ship-sail" d="M${n(mx - halfTop)} ${n(top)}
         L${n(mx + halfTop)} ${n(top)}
         L${n(mx + halfBot)} ${n(bot)}
         Q${n(mx)} ${n(bot + belly)} ${n(mx - halfBot)} ${n(bot)} Z"/>`;

    return `<g class="galleon" transform="translate(${n(cx)},${n(cy)}) scale(${scale})">
      <!-- hull: a crescent with a raised stern castle at the right -->
      <path class="ship-hull" d="M-36 -2 C-30 12 24 14 34 0 L34 -4
        C20 2 -26 1 -36 -6 Z"/>
      <path class="ship-hull-dark" d="M-36 -2 C-30 12 24 14 34 0 L33 3
        C22 16 -30 13 -36 0 Z"/>
      <path class="ship-hull" d="M22 -6 L36 -4 L35 -18 L25 -19 Z"/>
      <path class="ship-line" d="M-34 -5 C-22 0 20 1 34 -4 M24 -12 L35 -11"/>
      <!-- gun ports along the sheer -->
      <path class="ship-line" d="M-24 2 v3 M-16 3 v3 M-8 3.5 v3 M0 4 v3 M8 3.5 v3 M16 3 v3"/>
      <!-- bowsprit and spritsail -->
      <line class="ship-spar" x1="-34" y1="-5" x2="-56" y2="-16"/>
      ${sail(-45, -15, -6, 4, 6, 2)}
      <!-- three masts -->
      <line class="ship-spar" x1="-16" y1="-2" x2="-16" y2="-50"/>
      <line class="ship-spar" x1="2"   y1="-1" x2="2"   y2="-62"/>
      <line class="ship-spar" x1="20"  y1="-4" x2="20"  y2="-44"/>
      <!-- yards -->
      <line class="ship-spar" x1="-27" y1="-42" x2="-5" y2="-42"/>
      <line class="ship-spar" x1="-26" y1="-22" x2="-6" y2="-22"/>
      <line class="ship-spar" x1="-11" y1="-54" x2="15" y2="-54"/>
      <line class="ship-spar" x1="-12" y1="-30" x2="16" y2="-30"/>
      <!-- fore mast: topsail + course -->
      ${sail(-16, -42, -24, 10, 12, 3)}
      ${sail(-16, -22, -4, 9, 11, 3)}
      <!-- main mast: the big canvas -->
      ${sail(2, -54, -32, 12, 15, 4)}
      ${sail(2, -30, -6, 11, 14, 4)}
      <!-- mizzen lateen, angled aft -->
      <path class="ship-sail" d="M20 -40 L34 -10 L20 -7 Z"/>
      <!-- shrouds and stays -->
      <path class="ship-line" d="M-16 -50 L-30 -4 M-16 -50 L-4 -3
        M2 -62 L-16 -50 M2 -62 L20 -44 M2 -62 L-34 -5
        M20 -44 L34 -5 M20 -44 L10 -3"/>
      <!-- pennants streaming off the mastheads -->
      <path class="ship-flag" d="M2 -62 L16 -65 L2 -68 Z"/>
      <path class="ship-flag" d="M-16 -50 L-6 -52 L-16 -55 Z"/>
      <path class="ship-flag" d="M20 -44 L28 -46 L20 -49 Z"/>
      <!-- water breaking at the bow and along the run -->
      <path class="ship-wake" d="M-46 8 C-34 13 -16 15 -2 13 M4 14 C18 14 30 11 42 5"/>
    </g>`;
  }

  /**
   * Sea serpent in the old chart manner: a coiled body breaking the surface in
   * humps, a maned head, and a barbed tail. Hatching on the coils is what sells
   * the engraved look at this scale.
   */
  function seaSerpent(cx, cy, scale, flip) {
    // Ribbing across each coil — the hatching is what makes engraved linework
    // read as a body rather than as a bare squiggle.
    const humps = [
      { x: -46, y: 4 }, { x: -30, y: -6 }, { x: -14, y: 4 },
      { x: 2, y: -6 }, { x: 18, y: 4 },
    ];
    let ribs = "";
    for (const h of humps) {
      for (let k = -2; k <= 2; k++) {
        ribs += `<path class="creature-hatch" d="M${n(h.x + k * 3)} ${n(h.y + Math.abs(k) * 1.6)}
          q1.5 5 0 9"/>`;
      }
    }

    return `<g class="sea-serpent" transform="translate(${n(cx)},${n(cy)}) scale(${flip ? -scale : scale},${scale})">
      <!-- coils breaking the surface, then rising into the neck -->
      <path class="creature-body" d="M-58 8
        q6 -16 14 -2 q8 14 16 -2 q8 -16 16 -2 q8 14 16 -4 q7 -14 14 -10"/>
      ${ribs}
      <!-- neck sweeping up and over -->
      <path class="creature-body" d="M18 -10 q10 -14 12 -28 q2 -14 14 -16"/>
      <path class="creature-body creature-body-thin" d="M24 -12 q9 -13 11 -26"/>
      <!-- head: blunt skull, open jaw, barbels -->
      <path class="creature-fill" d="M42 -56 q13 -3 18 6 q4 8 -4 13 q-9 5 -16 -1 q-6 -6 2 -18 Z"/>
      <path class="creature-line" d="M56 -50 q9 -2 13 3 q-6 5 -13 4"/>
      <path class="creature-body creature-body-thin" d="M58 -44 q8 2 12 -1"/>
      <circle class="creature-eye" cx="54" cy="-50" r="2.1"/>
      <circle class="creature-fill" cx="54" cy="-50" r="0.9"/>
      <!-- mane / spines along the neck -->
      <path class="creature-line" d="M40 -60 l2 -9 M46 -62 l4 -8 M52 -62 l6 -7 M34 -52 l-3 -8 M30 -42 l-5 -7"/>
      <!-- pectoral fin -->
      <path class="creature-fill" d="M6 -4 q10 -8 18 -4 q-6 8 -16 9 Z"/>
      <!-- barbed tail flicking clear of the water -->
      <path class="creature-body" d="M-58 8 q-12 -3 -17 -12"/>
      <path class="creature-fill" d="M-75 -4 q-9 -8 -14 -4 q6 3 6 8 q-7 1 -9 6 q10 1 17 -4 Z"/>
    </g>`;
  }

  /**
   * An ouroboros — the serpent taking its own tail — as a background watermark.
   * Deliberately drawn as one continuous coil with scale hatching, no stars.
   */
  function ouroboros(cx, cy, r) {
    let scales = "";
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * 360;
      const v = vec(a);
      const x1 = cx + v.x * (r - 5), y1 = cy + v.y * (r - 5);
      const x2 = cx + v.x * (r + 5), y2 = cy + v.y * (r + 5);
      scales += `<line class="creature-hatch" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"/>`;
    }
    return `<g class="ouroboros">
      <circle class="creature-body" cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"/>
      <circle class="creature-body creature-body-thin" cx="${n(cx)}" cy="${n(cy)}" r="${n(r - 5)}"/>
      <circle class="creature-body creature-body-thin" cx="${n(cx)}" cy="${n(cy)}" r="${n(r + 5)}"/>
      ${scales}
      <!-- head meeting the tail at the bottom of the ring -->
      <path class="creature-fill" d="M${n(cx - 12)} ${n(cy + r + 2)}
        q10 -9 22 -2 q6 4 2 10 q-6 8 -16 5 q-9 -3 -8 -13 Z"/>
      <circle class="creature-eye" cx="${n(cx + 2)}" cy="${n(cy + r + 3)}" r="2"/>
      <path class="creature-line" d="M${n(cx - 14)} ${n(cy + r + 10)} q10 6 24 1"/>
    </g>`;
  }

  // =========================================================================
  // The page ground
  //
  // Drawn, not photographed. A photograph of a real map was tried as the page
  // background and did not work: it arrives with its own coastlines, its own
  // graticule at its own angle and its own lettering, none of which line up
  // with the chart sitting on top of it, so the two read as two maps fighting
  // rather than as one surface. What actually says "old map" is not any
  // particular map — it is a handful of marks: a graticule, rhumb lines
  // radiating from bearing nodes, and the fact that every one of them was
  // ruled by a human hand and is therefore slightly wrong.
  //
  // So the ground is those marks, generated, faint, and — crucially — drawn
  // freehand: every line wobbles off true by a few units, most at its middle
  // and not at all at its ends, which is how a line drawn against a straight
  // edge by hand actually fails.
  // =========================================================================

  /** Deterministic PRNG (mulberry32) — the same page ground on every load. */
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * A straight line as a hand would draw it: sampled into segments and pushed
   * off the true line perpendicularly, by an amount that peaks in the middle
   * and falls to zero at both ends — a hand is accurate where it starts and
   * where it aims, and drifts in between.
   */
  function freehandPts(x1, y1, x2, y2, rnd, wobble = 4, seg = 10) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len, py = dx / len;
    const bias = (rnd() * 2 - 1) * wobble;   // the whole line's lean
    const pts = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const off = Math.sin(t * Math.PI) * (bias + (rnd() * 2 - 1) * wobble * 0.5);
      pts.push({ x: x1 + dx * t + px * off, y: y1 + dy * t + py * off, nx: px, ny: py });
    }
    return pts;
  }
  const pathOf = (pts) =>
    pts.map((p, i) => `${i ? "L" : "M"}${n(p.x)} ${n(p.y)}`).join("");
  function freehand(x1, y1, x2, y2, rnd, wobble = 4, seg = 10) {
    return pathOf(freehandPts(x1, y1, x2, y2, rnd, wobble, seg));
  }
  /** Point on a sampled polyline at parameter t in [0,1], with its normal. */
  function along(pts, t) {
    const f = t * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(f)), k = f - i;
    const a = pts[i], b = pts[i + 1];
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, nx: a.nx, ny: a.ny };
  }

  /** A ring drawn by hand: radius breathes a little as it goes round. */
  function freehandRing(cx, cy, r, rnd, wobble = 1.6, seg = 48) {
    let d = "";
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const rr = r + (rnd() * 2 - 1) * wobble;
      d += `${i ? "L" : "M"}${n(cx + Math.cos(a) * rr)} ${n(cy + Math.sin(a) * rr)}`;
    }
    return d + "Z";
  }

  /**
   * The full page ground, as markup for a fixed background SVG.
   * `w`/`h` are the viewBox, not pixels — it is sliced to cover the viewport.
   */
  function pageGround(w, h, seed = 20260904) {
    const rnd = rng(seed);
    let out = "";

    // Graticule — the meridians and parallels every map has — with graduations
    // along each one. Both are generated from the *same* sampled polyline: the
    // ticks are hung off the line's own normal at a fixed clearance, so they
    // follow wherever the hand-drawn line actually wandered.
    //
    // That coupling is the point. The first attempt placed ticks at a fixed
    // offset from the line's *nominal* position, which ignored the 5-unit
    // wobble the freehand pass applies — so the line meandered across them and
    // five ticks ended up crossing it. Where a tick crosses a line the ink
    // doubles (0.30 over 0.26 composites to ~0.48), and the masthead and
    // colophon type sits directly on this ground: over one line that type holds
    // 4.9:1, over a crossing it drops to about 4.1:1. Hanging the ticks off the
    // real path means there is no crossing to fall into.
    const STEP = 190;
    const GAP = 1.6;      // clear of the graticule's own 1.1-unit stroke
    const DIV = 4;        // graduations per interval

    const rules = [];
    for (let x = STEP; x < w; x += STEP) rules.push(freehandPts(x, -20, x, h + 20, rnd, 5));
    for (let y = STEP; y < h; y += STEP) rules.push(freehandPts(-20, y, w + 20, y, rnd, 5));

    for (const pts of rules) {
      out += `<path class="gnd-grat" d="${pathOf(pts)}"/>`;
      const spans = Math.round(Math.hypot(
        pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) / (STEP / DIV));
      for (let k = 1; k < spans; k++) {
        const p = along(pts, k / spans);
        const t = k % DIV === 0 ? 8 : 4;         // longer mark on the whole degree
        out += `<path class="gnd-tick" d="M${n(p.x + p.nx * GAP)} ${n(p.y + p.ny * GAP)}
          L${n(p.x + p.nx * (GAP + t))} ${n(p.y + p.ny * (GAP + t))}"/>`;
      }
    }

    // Bearing nodes with rhumb lines fanning out — the single most recognisable
    // mark on a portolan chart, and the reason those charts look like charts.
    const nodes = [
      { x: w * 0.22, y: h * 0.30, r: 46 },
      { x: w * 0.74, y: h * 0.72, r: 38 },
    ];
    for (const nd of nodes) {
      const reach = Math.hypot(w, h);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        out += `<path class="gnd-rhumb ${i % 4 === 0 ? "gnd-rhumb-main" : ""}"
          d="${freehand(nd.x, nd.y, nd.x + Math.cos(a) * reach, nd.y + Math.sin(a) * reach, rnd, 7, 14)}"/>`;
      }
      // A plain double ring at the node. No lettering and no star points: at
      // this opacity they would only turn to mud, and the fan already reads.
      out += `<path class="gnd-ring" d="${freehandRing(nd.x, nd.y, nd.r, rnd)}"/>`;
      out += `<path class="gnd-ring" d="${freehandRing(nd.x, nd.y, nd.r * 0.62, rnd)}"/>`;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const r0 = nd.r * 0.62, r1 = nd.r;
        out += `<path class="gnd-ring" d="${freehand(
          nd.x + Math.cos(a) * r0, nd.y + Math.sin(a) * r0,
          nd.x + Math.cos(a) * r1, nd.y + Math.sin(a) * r1, rnd, 0.8, 2)}"/>`;
      }
    }

    return out;
  }

  return { plate, plateCrop, compassRose, rhumbLines, galleon, seaSerpent, ouroboros,
    pageGround };
})();
