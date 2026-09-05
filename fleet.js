// ===========================================================================
// The fleet
//
// A small squadron working the shipping lane off the coast. Every ship sails
// its own course at its own speed, and the courses are bent by gradient noise
// so they wander the way real navigation does rather than tracing one line.
//
// THE PERFORMANCE RULE THIS FILE EXISTS TO OBEY
//
// The chart's animation budget is: zero requestAnimationFrame loops, zero
// JavaScript per frame, everything on the compositor. That is what keeps the
// page cheap, and it is not negotiable just because the fleet got ambitious.
//
// Organic motion normally costs a rAF loop — evaluate noise, write a
// transform, repeat sixty times a second, per ship. This file does not. The
// noise is evaluated ONCE per voyage, at spawn, and baked into the keyframes
// of a single Web Animations transform. The browser then interpolates it on
// the compositor with no main-thread involvement at all. Visually it is the
// same wandering course; the cost is a few hundred microseconds when a ship
// departs and nothing whatsoever while it sails.
//
// The same principle governs everything added here later: if a behaviour can
// be computed at spawn and expressed as keyframes, it is free. If it needs to
// watch the world every frame, it needs a different design.
// ===========================================================================

const NAVY = (() => {
  // -------------------------------------------------------------------------
  // Everything tunable. No behaviour numbers live outside this object.
  // -------------------------------------------------------------------------
  const CONFIG = {
    fleet: {
      // How many hulls exist. They are a pool: a ship is either at sea or
      // waiting to sail. Each one is a filtered raster image, which is the
      // most expensive thing the chart draws, so this is the number to lower
      // first if the page ever feels heavy.
      count: 5,

      // Chart units per second. The spread is what breaks the old lockstep —
      // the previous fleet shared ONE duration, which is why it read as a
      // mechanism.
      speed: [2.6, 4.3],

      // Beam in chart units, drawn per voyage rather than fixed per hull, so
      // the same ship is not always the big one.
      beam: [34, 56],

      // Heel. Always negative: ships on one course in one wind lean together,
      // and one leaning against the others reads as a mistake, not variety.
      heel: [-6, -2],

      // A fixed sideways offset for the whole voyage — which side of the lane
      // this ship favours, before any wander is added.
      lateral: [-22, 22],

      // The noise that bends the course. `amplitude` is how far off the base
      // route a ship strays at most; `octaves` adds finer detail on top of the
      // broad swing; `frequency` is how many full meanders fit in one passage.
      wander: {
        amplitude: [16, 40],
        frequency: [0.8, 2.2],
        octaves: 3,
      },

      // One ship in this many holds the base route exactly, with no wander at
      // all. It is the anchor: without something sailing true, the eye has
      // nothing to read the others' wandering against.
      orderlyEveryN: 8,

      // Seconds between one departure and the next.
      departGap: [24, 68],

      // Seconds a hull waits before sailing again after finishing a passage.
      respawnDelay: [5, 22],

      // How many points each course is sampled into. This is the only real
      // cost knob: keyframes are interpolated on the compositor, but they are
      // still memory, and a course does not get visibly smoother past ~64.
      samples: 64,

      // Fixed value = the same fleet on every load, which is useful when
      // tuning. null = a different squadron each time.
      seed: null,
    },
  };

  // -------------------------------------------------------------------------
  // Gradient noise
  //
  // Not Math.random(). Random per sample gives a tremor — every point
  // independent of its neighbours. Gradient noise interpolates between
  // gradients at integer lattice points, so nearby inputs give nearby outputs
  // and the result is a smooth meander.
  //
  // The interpolant is Perlin's smootherstep, 6t^5-15t^4+10t^3, whose first
  // AND second derivatives vanish at the lattice points. That second
  // derivative is the whole point: with plain smoothstep the curvature jumps
  // at every integer and a ship following the curve visibly flinches as it
  // crosses one.
  // -------------------------------------------------------------------------
  function makeNoise(seed) {
    let s = (seed >>> 0) || 1;
    const rnd = () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
    const perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {          // Fisher-Yates
      const j = (rnd() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

    // Slopes vary as well as sign, so the meanders differ in steepness rather
    // than all being the same wave at different offsets.
    const grad = (h, x) => (h & 1 ? -1 : 1) * (0.4 + (h & 7) / 12) * x;
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

    return function noise1(x) {
      const i = Math.floor(x), f = x - i, idx = i & 255;
      const a = grad(perm[idx], f);
      const b = grad(perm[idx + 1], f - 1);
      const u = fade(f);
      return a + u * (b - a);
    };
  }

  /**
   * Several octaves of it: a broad swing with finer detail riding on top.
   *
   * Returns a function already NORMALISED to roughly +/-1. Dividing by the sum
   * of the octave amplitudes, which is the textbook move, does not do that:
   * gradient noise only reaches its theoretical extremes where a lattice
   * gradient happens to be maximal and the sample lands mid-cell, so in
   * practice the octaves sum to well under the bound and then get divided by
   * it again. Measured, the raw output here peaked around 0.2 — which is why
   * the first fleet's courses were bending a fifth of what CONFIG asked for
   * and still looked like one lane. So the peak is sampled once at
   * construction and divided out, and `amplitude` in CONFIG then means what it
   * says: chart units.
   */
  function makeFbm(noise, octaves) {
    const raw = (x) => {
      let sum = 0, amp = 1, freq = 1;
      for (let o = 0; o < octaves; o++) {
        sum += noise(x * freq) * amp;
        amp *= 0.5;
        freq *= 2.07;        // not exactly 2, so octaves never re-align
      }
      return sum;
    };
    let peak = 0;
    for (let i = 0; i < 1024; i++) peak = Math.max(peak, Math.abs(raw(i * 0.37)));
    const k = peak > 1e-6 ? 1 / peak : 1;
    return (x) => raw(x) * k;
  }

  // -------------------------------------------------------------------------
  // Wiring. app.js owns the chart's geometry — the route, the shoreline, the
  // closed water — so it hands those in rather than this file reaching for
  // them. Keeps the fleet a self-contained system that can be lifted out.
  // -------------------------------------------------------------------------
  let geom = null;
  function configure(g) { geom = g; }

  const rngFor = (seed) => {
    let s = (seed >>> 0) || 0x9e3779b9;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  };

  let rand01 = Math.random;
  const rand = (lo, hi) => lo + rand01() * (hi - lo);

  /** The markup for the whole pool. Positions come later, from the animation. */
  function markup() {
    const n = CONFIG.fleet.count;
    return Array.from({ length: n }, (_, i) => `
      <g class="ship-voyage" data-ship="${i}" style="opacity:0">
        <!-- The water the hull has pushed aside: a patch of sea colour laid
             OVER the crests rather than a hole cut in them, which is the whole
             reason it can move. A mask would have to be re-cut every frame to
             follow a ship; a sibling inside the moving group follows for free.
             Sized per voyage, since the beam changes. -->
        <ellipse class="ship-clearing" cx="0" cy="0" rx="1" ry="1"
                 fill="url(#ship-clearing)"/>
        <g class="ship-heave">
          <g class="ship-roll">
            <g class="ship-hull"></g>
          </g>
        </g>
      </g>`).join("");
  }

  /**
   * One voyage: a course, a speed, a hull.
   *
   * The wander envelope is a sine that peaks mid-passage and falls to zero at
   * both ends. That is not decoration — the authored route's two ends are
   * carefully placed (it enters below the plate and leaves through the
   * right-hand edge, both off-frame), and letting noise move them would put
   * ships through the closed water off Long Reef or leave them visibly
   * popping into existence. The middle is free to wander; the entrance and
   * the exit are not.
   */
  function planVoyage(index) {
    const F = CONFIG.fleet;
    const orderly = index % F.orderlyEveryN === 0;
    const beam = rand(...F.beam);
    const speed = rand(...F.speed);
    const amp = orderly ? 0 : rand(...F.wander.amplitude);
    const freq = rand(...F.wander.frequency);
    const noise = makeFbm(makeNoise((rand01() * 0xffffffff) >>> 0), F.wander.octaves);
    const phase = rand(0, 100);

    const wander = (t) =>
      amp * Math.sin(Math.PI * t) * noise(phase + t * freq * 6);

    const track = geom.buildTrack({
      lateral: rand(...F.lateral),
      beam: beam * 0.42,
      halfH: geom.hullUp(beam),
      samples: F.samples,
      wander,
    });

    return { track, beam, speed, orderly, heel: rand(...F.heel), amp,
             roll: rand(6.5, 12), heave: rand(4.4, 8.1) };
  }

  function launch(root) {
    if (!geom) throw new Error("NAVY.launch before NAVY.configure");
    const F = CONFIG.fleet;
    rand01 = F.seed == null ? Math.random : rngFor(F.seed);

    const ships = [...root.querySelectorAll(".ship-voyage")];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      // Becalmed: a few hulls standing on the lane, no animation at all.
      ships.forEach((g, i) => {
        if (i >= 3) { g.style.opacity = 0; return; }
        const v = planVoyage(i);
        dress(g, v);
        const p = v.track[Math.round((0.32 + i * 0.18) * (v.track.length - 1))];
        g.setAttribute("transform", `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
        g.style.opacity = 1;
      });
      return;
    }

    let lastDeparture = -Infinity;
    const idle = new Set(ships);
    let counter = 0;

    function dress(g, v) {
      g.querySelector(".ship-hull").innerHTML = geom.hull(v.beam, v.heel);
      const e = g.querySelector(".ship-clearing");
      e.setAttribute("rx", (v.beam * 0.62).toFixed(1));
      e.setAttribute("ry", (v.beam * 0.72).toFixed(1));
      g.style.setProperty("--roll", `${v.roll.toFixed(1)}s`);
      g.style.setProperty("--heave", `${v.heave.toFixed(1)}s`);
    }

    function sail(g) {
      idle.delete(g);
      const v = planVoyage(counter++);
      dress(g, v);

      // The whole course, baked. One animation, interpolated on the
      // compositor, nothing to compute while it runs.
      const anim = g.animate(
        v.track.map((p, i) => ({
          offset: i / (v.track.length - 1),
          transform: `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`,
          opacity: 1,
        })),
        { duration: (geom.runLength / v.speed) * 1000, easing: "linear", fill: "forwards" }
      );
      lastDeparture = performance.now();
      g.__voyage = v;
      g.__anim = anim;

      anim.onfinish = () => {
        anim.cancel();               // else it fills for ever and they pile up
        g.style.opacity = 0;
        idle.add(g);
        setTimeout(dispatch, rand(...F.respawnDelay) * 1000);
      };
    }

    function dispatch() {
      if (!idle.size) return;
      const wait = lastDeparture + rand(...F.departGap) * 1000 - performance.now();
      if (wait > 0) { setTimeout(dispatch, wait); return; }
      sail([...idle][(rand01() * idle.size) | 0]);
      setTimeout(dispatch, rand(...F.departGap) * 1000);
    }

    // Open with some of the squadron already at sea, at unrelated points on
    // their passages, so the chart does not start empty and fill up on a timer.
    const opening = Math.max(1, Math.round(F.count * 0.6));
    ships.slice(0, opening).forEach((g, i) => {
      sail(g);
      g.__anim.currentTime = g.__anim.effect.getTiming().duration * (0.72 - i * 0.17);
    });
    lastDeparture = performance.now() - rand(...F.departGap) * 500;
    setTimeout(dispatch, rand(3, 12) * 1000);
  }

  return { CONFIG, configure, markup, launch };
})();
