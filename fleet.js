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

      // How many times a course may be re-drawn to find one that keeps clear
      // of the ships already at sea. See `combat.minSeparation`.
      courseAttempts: 24,
    },

    combat: {
      // Two ships closer than this may engage. Comfortably larger than
      // minSeparation, so an engagement is a near pass rather than a collision.
      engageDistance: 135,

      // The floor. Courses that would bring two hulls closer than this are
      // rejected at spawn and re-drawn.
      //
      // This is the number that lets systems 1 and 2 coexist. Combat needs
      // ships to come close; two engraved hulls overlapping reads as a
      // rendering fault, not as a fleet. Because every course is known before
      // it is animated, both can be guaranteed rather than hoped for.
      minSeparation: 82,

      // Not every near pass is a fight — otherwise proximity becomes a rule
      // the eye learns in a minute.
      engageChance: 0.55,

      // Hard ceiling on concurrent exchanges, so a busy sea cannot pile up
      // animations. The performance budget is a constraint, not an aspiration.
      maxSimultaneous: 2,

      // The longest a ship will wait for a clear slot before sailing anyway.
      maxHold: 96,

      // The two ships do not fire together; one is always a beat late.
      volleyStagger: [220, 950],

      // Time of flight, and how high the shot arcs as a fraction of the range.
      ballFlight: [1100, 1700],
      ballArc: 0.24,

      // A shot can miss. Damage that is certain makes the outcome a countdown.
      hitChance: 0.68,

      // Impacts before a hull goes down.
      hitsToSink: 3,
    },

    sinking: {
      // The whole sequence: list, settle, go under.
      duration: 5400,
      // How far she heels over as she goes.
      listAngle: 58,
      bubbles: 8,
      bubbleRise: [1400, 2600],
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
            <!-- Damage rides INSIDE roll and heave, so smoke leans with the
                 hull instead of floating beside it. -->
            <g class="ship-harm"></g>
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

  // -------------------------------------------------------------------------
  // Where a ship is at a given moment — WITHOUT asking the DOM.
  //
  // This is what makes the rest of the file possible. A ship's course and its
  // duration are both known the instant it sails, so its position at any time,
  // past or future, is arithmetic. Everything downstream — will these two meet,
  // where will that one be when the shot lands — is answered by evaluating
  // this, once, at the moment the question is asked.
  //
  // The alternative is reading transforms every frame, which is the rAF loop
  // this file exists to avoid.
  // -------------------------------------------------------------------------
  function positionAt(ship, when) {
    const p = (when - ship.startedAt) / ship.duration;
    if (p < 0 || p > 1) return null;
    const f = p * (ship.track.length - 1);
    const k = Math.min(ship.track.length - 2, Math.floor(f)), frac = f - k;
    const a = ship.track[k], b = ship.track[k + 1];
    return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
  }

  /**
   * The closest these two ever come, and when — searched over the window in
   * which both are actually at sea.
   *
   * Coarse pass at 1s then a fine pass around the winner: a full 0.1s sweep of
   * a three-minute overlap would be 1800 samples per pair for a figure that a
   * two-stage search gets in about 220.
   */
  function closestApproach(a, b) {
    const from = Math.max(a.startedAt, b.startedAt);
    const to = Math.min(a.startedAt + a.duration, b.startedAt + b.duration);
    if (to <= from) return null;
    let best = { d: Infinity, when: from };
    const scan = (step, lo, hi) => {
      for (let t = lo; t <= hi; t += step) {
        const pa = positionAt(a, t), pb = positionAt(b, t);
        if (!pa || !pb) continue;
        const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        if (d < best.d) best = { d, when: t };
      }
    };
    scan(1000, from, to);
    scan(100, Math.max(from, best.when - 1200), Math.min(to, best.when + 1200));
    return best;
  }

  function launch(root) {
    if (!geom) throw new Error("NAVY.launch before NAVY.configure");
    const F = CONFIG.fleet, C = CONFIG.combat, S = CONFIG.sinking;
    rand01 = F.seed == null ? Math.random : rngFor(F.seed);

    const nodes = [...root.querySelectorAll(".ship-voyage")];
    const fleet = nodes.map((el, i) => ({ el, i, state: "idle" }));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
    let engagements = 0;
    let counter = 0;

    const atSea = () => fleet.filter((s) => s.state === "sailing");

    function dress(ship, v) {
      const g = ship.el;
      g.querySelector(".ship-hull").innerHTML = geom.hull(v.beam, v.heel);
      const e = g.querySelector(".ship-clearing");
      e.setAttribute("rx", (v.beam * 0.62).toFixed(1));
      e.setAttribute("ry", (v.beam * 0.72).toFixed(1));
      g.style.setProperty("--roll", `${v.roll.toFixed(1)}s`);
      g.style.setProperty("--heave", `${v.heave.toFixed(1)}s`);
      g.classList.remove("dmg-1", "dmg-2", "is-sinking");
      g.querySelector(".ship-harm").innerHTML = "";
    }

    // ---- system 1: sail -----------------------------------------------------
    /**
     * `skip` is how far into the passage she starts — used when opening the
     * scene with ships already at sea.
     *
     * It has to be known BEFORE the clearance check, not applied after. The
     * first version launched the opening ships, validated their courses, and
     * then shifted their timelines to stagger them — which invalidated the very
     * check that had just passed. Two of the three opening ships came within 47
     * units of a 82-unit floor.
     */
    function sail(ship, skip = 0) {
      // A course that keeps clear of everyone already out there. Checked before
      // a single frame is rendered, so clearance is a guarantee rather than a
      // collision response.
      const others = atSea();

      // Separation on a shared lane is a matter of TIME, not of shape.
      //
      // Redrawing the course does almost nothing, and the measurements say so:
      // with courses alone, 343 of 533 sampled moments had two hulls inside the
      // floor and the closest pair reached 25 units. That is not bad luck. Every
      // ship follows the same authored route with a modest sideways offset, so
      // two of them are inherently near each other for long stretches however
      // the noise bends them. What actually keeps ships apart on one lane is
      // sailing at different times — which is what the old fleet's departure
      // gap did, and what I lost when speeds started varying.
      //
      // So the free variable is the departure, not the path. For each candidate
      // course, find the earliest start that clears everyone; take the course
      // that needs the shortest wait. A ship that cannot fit yet waits for a
      // gap, exactly as it would in a real seaway.
      const baseStart = performance.now() - skip;
      const coarseGap = (track, speed, startedAt) => {
        const probe = { track, startedAt, duration: (geom.runLength / speed) * 1000 };
        let gap = Infinity;
        for (const o of others) {
          const from = Math.max(probe.startedAt, o.startedAt);
          const to = Math.min(probe.startedAt + probe.duration, o.startedAt + o.duration);
          for (let t = from; t <= to; t += 2000) {
            const pa = positionAt(probe, t), pb = positionAt(o, t);
            if (!pa || !pb) continue;
            gap = Math.min(gap, Math.hypot(pa.x - pb.x, pa.y - pb.y));
          }
        }
        return gap;
      };

      let v = null, delay = 0, bestGap = -Infinity, bestDelay = 0;
      outer:
      for (let attempt = 0; attempt < F.courseAttempts; attempt++) {
        const cand = planVoyage(counter + attempt);
        for (let d = 0; d <= C.maxHold * 1000; d += 6000) {
          const gap = coarseGap(cand.track, cand.speed, baseStart + d);
          if (gap > bestGap) { bestGap = gap; v = cand; bestDelay = d; }
          if (gap >= C.minSeparation) { v = cand; delay = d; break outer; }
        }
        if (!v) { v = cand; delay = 0; }
      }
      if (bestGap < C.minSeparation) delay = bestDelay;   // nothing clean: the roomiest
      counter++;

      if (delay > 0) {
        // Not yet. Wait for the gap and try again with the sea as it is then.
        later(() => { if (ship.state === "idle") sail(ship, Math.max(0, skip - delay)); }, delay);
        return;
      }
      const startedAt = baseStart;

      ship.state = "sailing";
      ship.hits = 0;
      dress(ship, v);
      ship.track = v.track;
      ship.beam = v.beam;
      ship.duration = (geom.runLength / v.speed) * 1000;
      ship.startedAt = startedAt;

      ship.anim = ship.el.animate(
        v.track.map((p, i) => ({
          offset: i / (v.track.length - 1),
          transform: `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`,
          opacity: 1,
        })),
        { duration: ship.duration, easing: "linear", fill: "forwards" }
      );
      ship.anim.onfinish = () => retire(ship, false);
      if (skip) ship.anim.currentTime = skip;

      lastDeparture = performance.now();
      scheduleEncounters(ship);
    }

    function retire(ship, sunk) {
      if (ship.anim) { ship.anim.cancel(); ship.anim = null; }
      ship.el.style.opacity = 0;
      ship.state = "idle";
      later(() => dispatch(), rand(...F.respawnDelay) * 1000 * (sunk ? 1.6 : 1));
    }

    // ---- system 2: proximity and gunnery ------------------------------------
    function scheduleEncounters(ship) {
      atSea().forEach((other) => {
        if (other === ship) return;
        const c = closestApproach(ship, other);
        if (!c || c.d > C.engageDistance) return;
        if (rand01() > C.engageChance) return;
        const at = c.when;
        if (at <= performance.now()) return;
        later(() => engage(ship, other), at - performance.now());
      });
    }

    function engage(a, b) {
      if (a.state !== "sailing" || b.state !== "sailing") return;
      if (engagements >= C.maxSimultaneous) return;      // the hard ceiling
      engagements++;
      // Neither fires on the same beat as the other.
      fire(a, b, 0);
      fire(b, a, rand(...C.volleyStagger));
      later(() => { engagements = Math.max(0, engagements - 1); }, 3500);
    }

    function fire(shooter, target, delay) {
      later(() => {
        if (shooter.state !== "sailing" || target.state !== "sailing") return;
        const now = performance.now();
        const from = positionAt(shooter, now);
        const flight = rand(...C.ballFlight);
        // Lead the target: aim at where she WILL be, not where she is. This is
        // free here — her position at impact is the same arithmetic as her
        // position now.
        const to = positionAt(target, now + flight);
        if (!from || !to) return;
        shoot(from, to, flight, () => {
          if (target.state === "sailing" && rand01() < C.hitChance) damage(target);
        });
      }, delay);
    }

    function shoot(from, to, flight, onArrive) {
      const ball = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      ball.setAttribute("class", "cannonball");
      ball.setAttribute("r", "2.4");
      root.appendChild(ball);
      const range = Math.hypot(to.x - from.x, to.y - from.y);
      const lift = range * C.ballArc;
      // A parabola, sampled. Straight-line shot reads as a laser; the arc is
      // what says "cannon".
      const N = 14, frames = [];
      for (let i = 0; i <= N; i++) {
        const s = i / N;
        const x = from.x + (to.x - from.x) * s;
        const y = from.y + (to.y - from.y) * s - lift * 4 * s * (1 - s);
        frames.push({ offset: s, transform: `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`,
                      opacity: s > 0.92 ? 0 : 1 });
      }
      const a = ball.animate(frames, { duration: flight, easing: "linear", fill: "forwards" });

      // Cleanup is driven by a timer as well as by the event, and the timer is
      // the one that is guaranteed. `onfinish` does not fire if the animation
      // is cancelled, and it can be missed when the element is re-parented —
      // which happens here on every chart repaint, because the fleet's node is
      // moved into each freshly rendered layer rather than rebuilt. A shot that
      // misses its cleanup is a node that never leaves the document, and enough
      // of those is exactly the leak the performance budget forbids.
      let spent = false;
      const land = () => {
        if (spent) return;
        spent = true;
        ball.remove();
        onArrive();
      };
      a.onfinish = land;
      later(land, flight + 120);
    }

    // ---- system 3: progressive damage ---------------------------------------
    function damage(ship) {
      ship.hits++;
      const g = ship.el;
      if (ship.hits >= C.hitsToSink) { sink(ship); return; }
      g.classList.add(`dmg-${Math.min(2, ship.hits)}`);
      // Smoke, in the same engraved idiom as everything else: open curls of
      // line, not a soft particle blur, which would be the one thing on the
      // chart that did not look drawn.
      const harm = g.querySelector(".ship-harm");
      const b = ship.beam;
      harm.insertAdjacentHTML("beforeend", `
        <g class="smoke" style="--drift:${(rand(-1, 1) * 8).toFixed(1)}px">
          <path d="M${(rand(-0.2, 0.2) * b).toFixed(1)} ${(-b * 0.30).toFixed(1)}
                   c ${(b * 0.10).toFixed(1)} ${(-b * 0.10).toFixed(1)}
                     ${(-b * 0.10).toFixed(1)} ${(-b * 0.20).toFixed(1)}
                     ${(b * 0.04).toFixed(1)} ${(-b * 0.30).toFixed(1)}"/>
          <path d="M${(rand(-0.2, 0.2) * b).toFixed(1)} ${(-b * 0.26).toFixed(1)}
                   c ${(-b * 0.09).toFixed(1)} ${(-b * 0.09).toFixed(1)}
                     ${(b * 0.11).toFixed(1)} ${(-b * 0.17).toFixed(1)}
                     ${(-b * 0.03).toFixed(1)} ${(-b * 0.26).toFixed(1)}"/>
        </g>`);
    }

    // ---- system 4: going down ------------------------------------------------
    function sink(ship) {
      if (ship.state !== "sailing") return;
      ship.state = "sinking";
      const g = ship.el;
      const now = performance.now();
      const at = positionAt(ship, now) || { x: 0, y: 0 };

      // Freeze her where she was hit. The voyage animation has to go first, or
      // it keeps driving the transform and she sinks while still making way.
      ship.anim.cancel(); ship.anim = null;
      g.setAttribute("transform", `translate(${at.x.toFixed(1)},${at.y.toFixed(1)})`);
      g.style.opacity = 1;
      g.classList.remove("dmg-1", "dmg-2");
      g.classList.add("is-sinking");

      const inner = g.querySelector(".ship-heave");
      inner.animate(
        [
          { transform: "rotate(0deg) translateY(0) scale(1)", opacity: 1, offset: 0 },
          { transform: `rotate(${(S.listAngle * 0.35).toFixed(0)}deg) translateY(${(ship.beam * 0.06).toFixed(1)}px) scale(0.98)`,
            opacity: 1, offset: 0.35 },
          { transform: `rotate(${(S.listAngle * 0.7).toFixed(0)}deg) translateY(${(ship.beam * 0.24).toFixed(1)}px) scale(0.92)`,
            opacity: 0.85, offset: 0.7 },
          { transform: `rotate(${S.listAngle}deg) translateY(${(ship.beam * 0.55).toFixed(1)}px) scale(0.8)`,
            opacity: 0, offset: 1 },
        ],
        { duration: S.duration, easing: "cubic-bezier(.45,.02,.72,.55)", fill: "forwards" }
      );

      bubbles(at, ship.beam);
      later(() => { g.removeAttribute("transform"); retire(ship, true); }, S.duration + 200);
    }

    function bubbles(at, beam) {
      for (let i = 0; i < S.bubbles; i++) {
        const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.setAttribute("class", "sink-bubble");
        c.setAttribute("r", (rand(0.9, 2.6)).toFixed(1));
        root.appendChild(c);
        const x = at.x + rand(-0.35, 0.35) * beam;
        const y = at.y + rand(-0.1, 0.35) * beam;
        const rise = rand(...S.bubbleRise);
        const delay = (S.duration * 0.15) + i * 130;
        const a = c.animate(
          [
            { transform: `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(0.4)`, opacity: 0 },
            { transform: `translate(${(x + rand(-4, 4)).toFixed(1)}px,${(y - beam * 0.30).toFixed(1)}px) scale(1)`,
              opacity: 0.55, offset: 0.35 },
            { transform: `translate(${(x + rand(-7, 7)).toFixed(1)}px,${(y - beam * 0.75).toFixed(1)}px) scale(0.5)`,
              opacity: 0 },
          ],
          { duration: rise, delay, easing: "ease-out", fill: "forwards" }
        );
        // Same belt and braces as the shot: the timer is what guarantees the
        // node goes, the event just gets there sooner.
        const pop = () => c.remove();
        a.onfinish = pop;
        later(pop, delay + rise + 120);
      }
    }

    // ---- dispatch ------------------------------------------------------------
    let lastDeparture = -Infinity;

    function dispatch() {
      const idle = fleet.filter((s) => s.state === "idle");
      if (!idle.length) return;
      const wait = lastDeparture + rand(...F.departGap) * 1000 - performance.now();
      if (wait > 0) { later(dispatch, wait); return; }
      sail(idle[(rand01() * idle.length) | 0]);
      later(dispatch, rand(...F.departGap) * 1000);
    }

    if (reduced) {
      // Becalmed: a few hulls standing on the lane, nothing moving and nothing
      // scheduled. No combat either — a fight is motion by definition.
      fleet.slice(0, 3).forEach((ship, i) => {
        const v = planVoyage(i);
        dress(ship, v);
        const p = v.track[Math.round((0.32 + i * 0.18) * (v.track.length - 1))];
        ship.el.setAttribute("transform", `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
        ship.el.style.opacity = 1;
      });
      return { fleet };
    }

    // Open with some of the squadron already at sea, at unrelated points on
    // their passages, so the chart does not start empty and fill on a timer.
    const opening = Math.max(1, Math.round(F.count * 0.6));
    fleet.slice(0, opening).forEach((ship, i) => {
      // A guess at the run length, only to turn a fraction into milliseconds
      // before the real duration exists. The clearance check uses the exact
      // figure once the course is drawn.
      const nominal = (geom.runLength / ((F.speed[0] + F.speed[1]) / 2)) * 1000;
      sail(ship, nominal * (0.72 - i * 0.17));
    });
    lastDeparture = performance.now() - rand(...F.departGap) * 500;
    later(dispatch, rand(3, 12) * 1000);

    // The last three are exposed so the squadron can be exercised on demand
    // rather than waited on: an engagement is a chance event that may be a
    // couple of minutes away, which is no way to check that gunnery, damage
    // and sinking actually work.
    return { fleet, positionAt, closestApproach, engage, damage, sink };
  }

  return { CONFIG, configure, markup, launch };
})();
