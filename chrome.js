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

  return { compassRose, rhumbLines, galleon, seaSerpent, ouroboros };
})();
