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
      count: 6,

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
      // this ship favours, before any wander is added. Wide enough that two
      // ships can pass abreast, which is what lets more than three be at sea.
      lateral: [-34, 34],

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
      // THE SEA IS NEVER ALLOWED TO EMPTY.
      //
      // Without this the chart went blank. Sinkings are quick and refills were
      // not: a hull went down, and its replacement then had to wait out the
      // respawn delay AND the global departure gap behind it, so deaths
      // outpaced departures and the water ended up bare — with shots still
      // crossing it, which is how the fault was spotted.
      //
      // Below this many hulls at sea, the departure gap is waived and the next
      // ship sails at once. The gap still governs a healthy sea; it just stops
      // being allowed to starve one.
      //
      // Four of six. Three was the first setting and it held the chart at
      // exactly three, because the floor is also where the sea settles: every
      // loss is replaced immediately and nothing else is, so whatever number
      // goes here is roughly what you will see.
      minAtSea: 4,

      orderlyEveryN: 8,

      // Seconds between one departure and the next. Shorter means more hulls
      // at sea at once, which is what actually drives how often anything
      // happens: engagements need PAIRS, and pairs grow with the square of how
      // many are out there.
      departGap: [12, 30],

      // Seconds a hull waits before sailing again after finishing a passage.
      respawnDelay: [4, 13],

      // How many points each course is sampled into. This is the only real
      // cost knob: keyframes are interpolated on the compositor, but they are
      // still memory, and a course does not get visibly smoother past ~64.
      samples: 64,

      // Fixed value = the same fleet on every load, which is useful when
      // tuning. null = a different squadron each time.
      seed: null,

      // How many times a course may be re-drawn to find one that keeps clear
      // of the ships already at sea. See `combat.clearMargin`.
      courseAttempts: 24,
    },

    combat: {
      // Two ships closer than this may engage.
      //
      // Read as a gunnery range, and the two ends of the argument are visible
      // on the chart. At 240 — nearly half the length of the lane — ships were
      // firing from clear across the sea, which reads as noise rather than as a
      // fight. At 120 they had to be practically rubbing gunwales, and a fight
      // you only get when two hulls nearly touch is a fight you rarely get.
      //
      // 170 is roughly three or four hull-widths: near enough that the two are
      // plainly each other's business, far enough that they open fire on the
      // approach instead of only at the pass.
      engageDistance: 170,

      // HOW CLOSE TWO HULLS MAY COME — as a multiple of their own size, not in
      // chart units.
      //
      // The old floor was a single distance, 58, and ships sailed straight
      // through each other anyway. The reason is that it measured them as if
      // they were round. A galleon plate is 1.25 times taller than she is
      // wide, and the lane runs north-south, so nearly every approach is one
      // ship overtaking another ALONG it — the one direction the ships are
      // biggest in and the one the check under-measured. Two 45-unit hulls at
      // 58 apart abreast leave 13 units of clear water; stacked bow to stern
      // they leave two, which is what "going over each other" looked like.
      //
      // So separation is now measured on an ellipse the shape of the ship: the
      // gap is divided by the hulls' combined half-width across and their
      // combined half-height along, and 1.0 means exactly touching.
      clearMargin: 1.12,

      // The size of that ellipse, as fractions of the plate box. The whole box:
      // it is mostly rigging and air up top, but rigging drawn across another
      // ship's hull reads as overlap just as plainly as timber would.
      footprint: { x: 0.5, y: 0.5 },

      // Not every near pass is a fight — otherwise proximity becomes a rule the
      // eye learns in a minute, and a ship that always fires when it can is a
      // machine rather than a crew.
      engageChance: 0.75,

      // Seconds between volleys while two ships remain within range of each
      // other, and the first number to turn if the sea needs to get louder or
      // quieter. It has come down a long way — [3,7], then [4,8], now this —
      // and the reason it keeps moving is that a volley is an EVENT: what makes
      // one land is the quiet either side of it. Constant fire reads as
      // weather, not as a fight.
      //
      // Note it is only half of how busy the sea feels: shortening
      // engageDistance cuts the seconds two ships are in range at all, so the
      // two knobs multiply.
      reengageEvery: [10, 18],

      // Hard ceiling on concurrent exchanges, so a busy sea cannot pile up
      // animations. The performance budget is a constraint, not an aspiration.
      // Each exchange is two <circle> nodes living about a second and a half,
      // so this is cheap next to a single hull.
      // Two, not five. This is a ceiling on animation cost, but it turns out
      // to be a ceiling on the casualty rate too: five concurrent exchanges
      // across a six-ship fleet meant nearly everyone was under fire at once.
      maxSimultaneous: 2,

      // The two ships do not fire together; one is always a beat late.
      volleyStagger: [220, 950],

      // Time of flight, and how high the shot arcs as a fraction of the range.
      ballFlight: [1100, 1700],
      ballArc: 0.24,

      // HOW ACCURATE A GUNNER IS, as the spread of his aim in chart units:
      // a fixed part, plus a part that grows with the range.
      //
      // There used to be a `hitChance` here — a die rolled when the ball
      // arrived, with nothing to do with where the ball had gone. So a shot
      // that visibly fell in the water could still register as a hit, and a
      // ball that landed on the deck could be declared a miss and throw up
      // spray on top of her. The die is gone. A shot is aimed at where she will
      // be, that aim is thrown off by this much, the ball flies to wherever
      // that lands it, and whether it HIT is then a question about the landing
      // point and the hull — asked, not decided in advance.
      //
      // Set from the two ends that matter. A hull is about a 17x10 target, so
      // the numbers below put roughly two shots in three on her at fifty units
      // and about one in four at the edge of the engagement range, which is
      // what "closer should be deadlier" means in figures rather than in
      // spirit.
      aimError: { base: 4, perUnit: 0.08 },

      // What the ball has to hit to count, as fractions of the plate box: the
      // TIMBER, not the box. A galleon plate is mostly rigging and air, and a
      // ball through the shrouds is a miss. Measured off the cutout's alpha —
      // the solid hull is the bottom third, centred about 0.30 of the box
      // below its middle.
      hullTarget: { x: 0.42, y: 0.20, drop: 0.30 },

      // Impacts before a hull goes down. Back to three now that hits are earned
      // geometrically rather than rolled: most shots miss, so four would have
      // made a sinking something you had to sit and wait for.
      hitsToSink: 3,

      // How long a shot's own scheduling stays valid, as a multiple of
      // engageDistance. Volleys are scheduled ahead of time from a predicted
      // encounter, and a prediction can be overtaken by events — the target
      // sinks, is replaced, and the replacement sails a different course. The
      // stale volley then fired anyway, at whatever the two ships' CURRENT
      // positions were, which put cannonballs across open water with no ship
      // at either end of the arc. Every shot now re-checks the range it was
      // scheduled on, at the moment it is taken.
      rangeSlack: 1.15,
    },

    sinking: {
      // The whole sequence, from the killing shot to the last splinter going
      // under. Long on purpose: a ship that vanishes in a second reads as a
      // node being removed, which is what it is, and the point of all this is
      // that it should not look like that.
      duration: 7400,

      // WHERE THE WATER IS.
      //
      // The plate is a galleon drawn in elevation — the old charts put their
      // ships side-on even on a plan view — so it genuinely has a waterline,
      // and everything below depends on knowing where. Measured off the
      // cutout's own alpha: ink runs to 0.996 of the box height, and the
      // widest, densest bands are the bottom quarter, which is the hull. So
      // the surface sits just above the lowest ink, as a fraction of the box
      // measured from its middle.
      //
      // This is what lets wreckage SINK rather than fade. Pieces are drawn
      // inside a clip that ends at this line, so a piece on its way down is
      // cut off by the surface a little more each frame, exactly as something
      // going under is. Nothing dims; it descends out of sight.
      //
      // Exactly at the keel, not above it. At 0.46 the surface cut 2.6 units
      // off the bottom of a 52-unit hull, so the instant she broke apart she
      // also lost a strip along her waterline — a visible pop, at the one
      // moment the eye is already on her.
      waterline: 0.5,

      // How far a piece drifts from where the hull was, in hull-beams, and how
      // far it tumbles on the way down.
      pieceDrift: [0.25, 1.15],
      pieceSpin: [25, 200],

      // Loose timber that floats a while before it too goes under. This is the
      // last thing left on the water, and the reason the sea does not simply
      // become empty the moment the hull is gone.
      splinters: 7,
      splinterLinger: [2600, 6200],

      bubbles: 10,
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
            <!-- Damage rides INSIDE roll and heave, so what is done to her
                 leans with the hull instead of floating beside it. -->
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
  function planVoyage(index, lateral) {
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
      lateral: lateral == null ? rand(...F.lateral) : lateral,
      beam: beam * 0.42,          // clearance width: what the ink actually spans
      halfH: geom.hullUp(beam),
      halfW: beam * 0.5,          // the plate's true half-width, for the exit
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
  /**
   * Every stretch of time these two spend within `range` of each other.
   *
   * This is what makes the sea aggressive rather than occasional. Finding the
   * single closest approach and firing once there — which is what this did at
   * first — means a pair that sails in company for a minute exchanges exactly
   * one shot, no matter how high the odds are set. The odds were never the
   * limit; the number of opportunities was.
   *
   * Returns [entry, exit] pairs, so gunnery can be scheduled right through each
   * pass and a long approach becomes a running fight.
   */
  function engagementWindows(a, b, range) {
    const from = Math.max(a.startedAt, b.startedAt);
    const to = Math.min(a.startedAt + a.duration, b.startedAt + b.duration);
    if (to <= from) return [];
    const out = [];
    let open = null;
    for (let t = from; t <= to; t += 500) {
      const pa = positionAt(a, t), pb = positionAt(b, t);
      const near = pa && pb && Math.hypot(pa.x - pb.x, pa.y - pb.y) <= range;
      if (near && open === null) open = t;
      if (!near && open !== null) { out.push([open, t]); open = null; }
    }
    if (open !== null) out.push([open, to]);
    return out;
  }

  /**
   * How far apart two hulls are, in their own units: the gap divided by the
   * ship-shaped ellipse that just contains both of them. 1.0 is touching,
   * below 1.0 is overlapping, and it is directly comparable between a pair
   * abreast and a pair in line astern — which plain distance is not.
   */
  function hullGap(a, b, pa, pb) {
    const F = CONFIG.combat.footprint;   // it sits with the separation floor
    const rx = (a.beam + b.beam) * F.x;
    const ry = (geom.hullUp(a.beam) + geom.hullUp(b.beam)) * 2 * F.y;
    return Math.hypot((pa.x - pb.x) / rx, (pa.y - pb.y) / ry);
  }

  function closestApproach(a, b) {
    const from = Math.max(a.startedAt, b.startedAt);
    const to = Math.min(a.startedAt + a.duration, b.startedAt + b.duration);
    if (to <= from) return null;
    let best = { d: Infinity, when: from };
    const scan = (step, lo, hi) => {
      for (let t = lo; t <= hi; t += step) {
        const pa = positionAt(a, t), pb = positionAt(b, t);
        if (!pa || !pb) continue;
        const d = hullGap(a, b, pa, pb);
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
    const cancel = (t) => { clearTimeout(t); timers.delete(t); };
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
      // A previous passage may have left her re-clipped where her topmasts came
      // off, and hidden while her wreck was on screen. Both have to go, or she
      // sails again as a silhouette with a bite out of it — or not at all.
      const hull = g.querySelector(".ship-hull");
      hull.removeAttribute("clip-path");
      hull.removeAttribute("visibility");
      g.querySelector(".ship-clearing").getAnimations().forEach((a) => a.cancel());
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
      const baseStart = performance.now() - skip;
      const others = atSea();

      // SEPARATION BY LANE, NOT BY WAITING.
      //
      // The previous version held a departure until the whole passage was
      // provably clear. It worked — hulls never came near each other — and it
      // was the wrong trade entirely: it kept the sea at two or three ships,
      // and with so few out there, pairs were rare and gunnery was rare with
      // them. Measured at its worst: two ships, 563 units apart, not a single
      // engagement window on the whole chart. Guaranteeing separation had
      // quietly become a guarantee of nothing happening.
      //
      // So the free variable goes back to being the course, and specifically
      // its SIDE of the lane. A new ship takes the offset furthest from
      // everyone already at sea. Separation then lives in the one dimension
      // that has room to spare, and along-track distance — which is what
      // actually brings two ships into range of each other — is left free.
      // Nobody waits, the sea fills, and the fighting follows.
      // Candidate offsets, furthest from everyone already at sea first — but
      // ALL of them, tried in that order, because the best side of the lane is
      // not always the one with a clear passage: a course is a course through
      // time, and the ship two lanes over may be the one you overtake.
      const taken = others.map((o) => o.lateral);
      const [lo, hi] = F.lateral;
      const lanes = [];
      for (let k = 0; k <= 8; k++) {
        const x = lo + ((hi - lo) * k) / 8;
        // Not Infinity for an empty sea: every entry would then be Infinity,
        // every comparison Infinity-Infinity = NaN, and the sort order
        // whatever the engine felt like. A big finite number sorts.
        lanes.push({ x, apart: taken.length ? Math.min(...taken.map((o) => Math.abs(x - o)))
                                            : 1e6 });
      }
      lanes.sort((p, q) => q.apart - p.apart);

      // THE CLEARANCE CHECK IS BINDING. It did not used to be: it re-rolled a
      // few courses and then sailed the last one whether or not it cleared,
      // which is how hulls ended up passing through each other. If nothing
      // clears, she does not sail — she waits a moment and asks again. That
      // cannot deadlock, because the ships she is waiting on are moving up the
      // lane and away from the entry the whole time.
      let v = null;
      for (let attempt = 0; attempt < F.courseAttempts; attempt++) {
        const lateral = lanes[attempt % lanes.length].x + rand(-3, 3);
        const cand = planVoyage(counter + attempt, lateral);
        const probe = { track: cand.track, beam: cand.beam, startedAt: baseStart,
                        duration: (geom.runLength / cand.speed) * 1000 };
        let gap = Infinity;
        for (const o of others) {
          const c = closestApproach(probe, o);
          if (c) gap = Math.min(gap, c.d);
        }
        if (gap >= C.clearMargin) { v = cand; v.lateral = lateral; break; }
      }
      if (!v) { ask(rand(1400, 3000)); return; }   // no clear water: not yet
      counter++;

      const startedAt = baseStart;

      ship.state = "sailing";
      ship.hits = 0;
      // Undo the hiding that retired her. It works without this line, because
      // the voyage animation carries opacity:1 and an animation outranks an
      // inline style — but that means her being visible at all depends on an
      // animation existing, and every bug in this file that made ships vanish
      // came from leaning on something incidental. Say it outright.
      ship.el.style.opacity = 1;
      // Which passage this is. Every volley scheduled ahead of time carries the
      // generation of both ships, so a schedule made for a ship that has since
      // gone down and been replaced is recognised as stale and dropped rather
      // than fired from her successor's new position.
      ship.voyage = (ship.voyage || 0) + 1;
      dress(ship, v);
      ship.track = v.track;
      ship.beam = v.beam;
      // Kept because the wreck needs it: her pieces have to be born wearing the
      // same heel the intact plate was drawn with, or she visibly snaps upright
      // at the moment she breaks apart.
      ship.heel = v.heel;
      ship.lateral = v.lateral ?? 0;
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
      ship.el.removeAttribute("transform");
      ship.state = "idle";
      // A sunk ship used to wait 1.6x as long to be replaced, on the reasoning
      // that a loss should be felt. What it actually did was empty the sea: the
      // fleet loses hulls faster than it loses them to the far end of the
      // chart, so the one case that most needed a quick replacement got the
      // slowest one. Same delay for both now, and the floor below catches the
      // rest.
      // A replacement waits her turn on a full sea and does not on a thin one.
      ask(atSea().length < F.minAtSea ? rand(300, 1100) : rand(...F.respawnDelay) * 1000);
    }

    // ---- system 2: proximity and gunnery ------------------------------------
    function scheduleEncounters(ship) {
      const now = performance.now();
      atSea().forEach((other) => {
        if (other === ship) return;
        // Every window they share, and a volley every few seconds THROUGH each
        // one, not a single shot at the closest point. A pass in company is a
        // running fight.
        const genA = ship.voyage, genB = other.voyage;
        for (const [entry, exit] of engagementWindows(ship, other, C.engageDistance)) {
          for (let t = entry; t < exit; t += rand(...C.reengageEvery) * 1000) {
            if (t <= now) continue;
            if (rand01() > C.engageChance) continue;
            later(() => engage(ship, genA, other, genB), t - now);
          }
        }
      });
    }

    /** Are these two, right now, actually the pair this volley was planned for
     *  and actually within reach of each other? */
    function still(a, genA, b, genB) {
      if (a.state !== "sailing" || b.state !== "sailing") return false;
      if (a.voyage !== genA || b.voyage !== genB) return false;   // stale schedule
      const now = performance.now();
      const pa = positionAt(a, now), pb = positionAt(b, now);
      if (!pa || !pb) return false;
      return Math.hypot(pa.x - pb.x, pa.y - pb.y) <= C.engageDistance * C.rangeSlack;
    }

    function engage(a, genA, b, genB) {
      if (!still(a, genA, b, genB)) return;
      if (engagements >= C.maxSimultaneous) return;      // the hard ceiling
      engagements++;
      // Neither fires on the same beat as the other.
      fire(a, genA, b, genB, 0);
      fire(b, genB, a, genA, rand(...C.volleyStagger));
      later(() => { engagements = Math.max(0, engagements - 1); }, 2600);
    }

    function fire(shooter, genS, target, genT, delay) {
      later(() => {
        // Checked again HERE, not only when the exchange opened: the stagger
        // means this shot is taken up to a second later, and a second is long
        // enough for the target to have been sunk by the other broadside.
        if (!still(shooter, genS, target, genT)) return;
        const now = performance.now();
        const from = positionAt(shooter, now);
        const flight = rand(...C.ballFlight);
        // Lead the target: aim at where she WILL be, not where she is. This is
        // free here — her position at impact is the same arithmetic as her
        // position now.
        // Where she will be when it gets there — and specifically where her
        // HULL will be, which is not where her plate's centre will be. The
        // plate's middle is up among the yards; the timber sits a third of a
        // box lower. Aimed at the middle, a shot with zero error still landed
        // clean above her and counted as a miss, which is why closing the range
        // made no difference at all: measured, a perfect shot at thirty units
        // hit 19% of the time, no better than a wild one at a hundred and
        // seventy. The gunner lays his gun on the hull.
        const seen = positionAt(target, now + flight);
        if (!from || !seen) return;
        const aim = { x: seen.x,
                      y: seen.y + geom.hullUp(target.beam) * 2 * C.hullTarget.drop };

        // ...and misses it by this much. The magnitude is Rayleigh-distributed
        // — the length of a two-dimensional Gaussian error — so most shots are
        // near and the wild ones are rare, rather than every shot being wrong
        // by some uniform amount.
        const range = Math.hypot(aim.x - from.x, aim.y - from.y);
        const sigma = C.aimError.base + C.aimError.perUnit * range;
        const off = sigma * Math.sqrt(-2 * Math.log(1 - rand01()));
        const dir = rand(0, Math.PI * 2);
        const to = { x: aim.x + Math.cos(dir) * off,
                     y: aim.y + Math.sin(dir) * off };

        muzzle(from, to, shooter.beam);
        shoot(from, to, flight, () => {
          // THE BALL DECIDES, NOT A DIE. Where it came down, against where she
          // actually is at that instant.
          const her = target.state === "sailing"
            ? positionAt(target, performance.now()) : null;
          if (her && onTarget(to, her, target.beam)) damage(target, from);
          else splash(to, target.beam);
        });
      }, delay);
    }

    /**
     * Did a ball landing here strike that hull?
     *
     * An ellipse over the ship's TIMBER, which is not the same as her plate:
     * the plate is a tall box that is mostly rigging and sky, and a ball
     * through the shrouds has not hit anything. The hull sits low in the box,
     * so the ellipse is dropped below its middle.
     */
    function onTarget(ball, her, beam) {
      const T = C.hullTarget;
      const h = geom.hullUp(beam) * 2;
      // Same ellipse the gunner laid his gun on: centred on her timber, which
      // is `drop` of a box below the middle of her plate.
      return Math.hypot((ball.x - her.x) / (beam * T.x),
                        (ball.y - (her.y + h * T.drop)) / (h * T.y)) <= 1;
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

    // ---- torn timber ---------------------------------------------------------
    const SVGNS = "http://www.w3.org/2000/svg";

    /** A node that is guaranteed to leave the document, event or no event. */
    function transient(host, life) {
      const g = document.createElementNS(SVGNS, "g");
      host.appendChild(g);
      later(() => g.remove(), life);
      return g;
    }

    /**
     * The plate, cut into five pieces along torn seams.
     *
     * The hull is one raster — a 1617 galleon drawn in elevation — so it cannot
     * be taken apart by moving sub-paths, because it has none. What it can be
     * is drawn five times, each copy clipped to a different piece of itself.
     * The pieces are then genuinely the ship's own timber rather than stand-in
     * shapes, and they cost five clips and five draws of an image already in
     * the texture cache.
     *
     * The seams are deliberately ragged. A straight cut reads as a shape being
     * masked, which is exactly what it is; a torn one reads as timber giving
     * way. And the cuts are placed on what the plate's own alpha says is there:
     * ink is a narrow spike above y=0.12 (the topmasts), spreads to nearly the
     * full width at 0.55-0.65 (the yards and the bowsprit), and is densest
     * below 0.65 (the hull). So one seam runs across at ~0.46, parting rigging
     * from hull, and the two halves are then split down their lengths.
     *
     * Returns polygons in fractions of the plate box, ordered: rig fore, rig
     * aft, hull bow, hull midships, hull stern.
     */
    function shatter() {
      const N = 8, yCut = 0.46;
      const deck = [];
      for (let i = 0; i <= N; i++) deck.push([i / N, yCut + rand(-0.05, 0.05)]);

      // A seam down the plate, meeting `deck` exactly at a grid column so the
      // pieces share an edge instead of leaving a sliver of daylight.
      const down = (col, yTo) => {
        const x = col / N, y0 = deck[col][1], out = [];
        for (let k = 1; k < 4; k++) {
          const t = k / 4;
          out.push([x + rand(-0.045, 0.045), y0 + (yTo - y0) * t]);
        }
        return out;
      };
      const up = (col) => {
        const x = col / N, y1 = deck[col][1], out = [];
        for (let k = 1; k < 4; k++) {
          const t = k / 4;
          out.push([x + rand(-0.045, 0.045), y1 * (1 - t)]);
        }
        return out;
      };
      const rev = (a) => a.slice().reverse();

      const mast = up(4);                 // top edge down to the deck seam
      const bow = down(3, 1);             // deck seam down to the keel
      const stern = down(6, 1);

      return [
        [[0, 0], [0.5, 0], ...rev(mast), deck[4], deck[3], deck[2], deck[1], deck[0]],
        [[0.5, 0], [1, 0], deck[8], deck[7], deck[6], deck[5], deck[4], ...mast],
        [deck[0], deck[1], deck[2], deck[3], ...bow, [0.375, 1], [0, 1]],
        [deck[3], deck[4], deck[5], deck[6], ...stern, [0.75, 1], [0.375, 1], ...rev(bow)],
        [deck[6], deck[7], deck[8], [1, 1], [0.75, 1], ...rev(stern)],
      ];
    }

    /** The plate with a ragged bite taken out of the topmasts, and the bite. */
    function topmast() {
      const l = rand(0.24, 0.31), r = rand(0.63, 0.72), y = rand(0.24, 0.33);
      const tear = [[l, y], [l + 0.09, y - rand(0.03, 0.07)], [(l + r) / 2, y + rand(0.01, 0.05)],
                    [r - 0.08, y - rand(0.02, 0.06)], [r, y]];
      return {
        // what the ship keeps: the whole box, minus the bite
        hull: [[0, 0], [l, 0], ...tear, [r, 0], [1, 0], [1, 1], [0, 1]],
        // what comes down: the bite itself
        spar: [[l, 0], [r, 0], ...tear.slice().reverse()],
      };
    }

    let wreckSeq = 0;

    /**
     * Pieces of a plate going down through the surface.
     *
     * NOTHING HERE FADES. A piece disappears because it has passed below the
     * waterline and the surface has closed over it — every piece is drawn
     * inside a clip whose lower edge IS the water, so descending is the only
     * way out of sight. That is the whole difference between a ship sinking and
     * a ship having its opacity animated, and it is why the waterline had to be
     * measured off the artwork rather than guessed.
     *
     * `at` is where in the host's own space the plate sits — {0,0} when the
     * host already rides the ship's transform, a world point when it does not.
     */
    function wreckage(host, at, w, heel, pieces, life) {
      const h = geom.hullUp(w) * 2;
      const waterY = S.waterline * h;
      const id = `wk${wreckSeq++}`;
      const fx = (f) => ((f - 0.5) * w).toFixed(1);
      const fy = (f) => ((f - 0.5) * h).toFixed(1);
      const plate = geom.hull(w, 0);      // heel is worn by the wreck as a whole

      const g = transient(host, life);
      g.innerHTML = `
        <defs>
          ${pieces.map((p, i) => `<clipPath id="${id}-${i}"><polygon points="${
            p.poly.map(([x, y]) => `${fx(x)},${fy(y)}`).join(" ")}"/></clipPath>`).join("")}
          <clipPath id="${id}-sea">
            <rect x="${(-3 * w).toFixed(0)}" y="${(-3 * h).toFixed(0)}"
                  width="${(6 * w).toFixed(0)}" height="${(3 * h + waterY).toFixed(1)}"/>
          </clipPath>
        </defs>
        <g transform="translate(${at.x.toFixed(1)},${at.y.toFixed(1)})">
          <g clip-path="url(#${id}-sea)">${pieces.map((p, i) => `
            <g class="wreck-piece">
              <g transform="rotate(${heel.toFixed(1)})">
                <g clip-path="url(#${id}-${i})">${plate}</g>
              </g>
            </g>`).join("")}
          </g>
        </g>`;

      [...g.querySelectorAll(".wreck-piece")].forEach((el, i) => {
        el.animate(pieces[i].frames, pieces[i].timing);
      });
      return g;
    }

    /** Where a piece goes: out, over, and down past the water. */
    function foundering(w, dir, floats) {
      const h = geom.hullUp(w) * 2;
      const dx = dir * rand(...S.pieceDrift) * w;
      const spin = dir * rand(...S.pieceSpin) * (floats ? 0.55 : 1);
      const deep = h * 1.3;               // far enough that no corner is left
      const t = (x, y, r) =>
        `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${r.toFixed(1)}deg)`;

      // Rigging topples, lies on the water a while, and only then goes under —
      // it is the lighter timber. The hull parts and drops.
      const frames = floats
        ? [{ offset: 0,    transform: t(0, 0, 0) },
           { offset: 0.13, transform: t(dx * 0.22, h * 0.07, spin * 0.42) },
           { offset: 0.40, transform: t(dx * 0.60, h * 0.27, spin * 0.80) },
           { offset: 0.70, transform: t(dx * 0.82, h * 0.34, spin * 0.90) },
           { offset: 1,    transform: t(dx, deep, spin) }]
        : [{ offset: 0,    transform: t(0, 0, 0) },
           { offset: 0.10, transform: t(dx * 0.26, -h * 0.05, spin * 0.14) },
           { offset: 0.48, transform: t(dx * 0.72, h * 0.34, spin * 0.55) },
           { offset: 1,    transform: t(dx, deep, spin) }];

      return {
        frames,
        timing: {
          duration: S.duration * (floats ? rand(0.72, 0.95) : rand(0.42, 0.66)),
          delay: floats ? rand(280, 700) : rand(60, 260),
          easing: floats ? "cubic-bezier(.3,.05,.6,.72)" : "cubic-bezier(.4,.03,.72,.6)",
          fill: "forwards",
        },
      };
    }

    // ---- system 3: progressive damage ---------------------------------------
    function damage(ship, shooter) {
      ship.hits++;
      const g = ship.el;
      const now = performance.now();
      const at = positionAt(ship, now);
      if (at) burst(at, ship.beam, shooter);
      if (ship.hits >= C.hitsToSink) { sink(ship); return; }
      g.classList.add(`dmg-${Math.min(2, ship.hits)}`);

      // The second hit takes her topmasts off. Not a state on a class — the
      // plate is actually re-clipped to the shape she is left with, and the
      // piece that came off falls into the sea beside her and goes under. She
      // then carries that silhouette for the rest of her passage.
      if (ship.hits === 2 && at) {
        const cut = topmast();
        const w = ship.beam, h = geom.hullUp(w) * 2;
        const id = `tear${wreckSeq++}`;
        const fx = (f) => (((f - 0.5) * w)).toFixed(1);
        const fy = (f) => (((f - 0.5) * h)).toFixed(1);
        const hull = g.querySelector(".ship-hull");
        hull.insertAdjacentHTML("afterbegin", `<defs><clipPath id="${id}">
          <polygon points="${cut.hull.map(([x, y]) => `${fx(x)},${fy(y)}`).join(" ")}"/>
        </clipPath></defs>`);
        hull.setAttribute("clip-path", `url(#${id})`);
        // The spar falls into the world, not into the ship's frame: she sails
        // on and leaves it behind, which is the whole point of losing it.
        wreckage(root, at, w, ship.heel,
                 [{ poly: cut.spar, ...foundering(w, rand01() < 0.5 ? -1 : 1, true) }],
                 S.duration + 400);
        splinters(at, w, 3);
      }

      // No smoke. It was drawn as open curls of line rising off her masts, on
      // the reasoning that a soft particle blur would be the one thing on the
      // chart that did not look drawn — and the reasoning was right about the
      // blur and wrong about the curls. At the size a ship actually renders,
      // two thin wavy strokes above her do not read as smoke; they read as
      // stray pen lines sitting on top of the boat, which is exactly what they
      // were reported as, twice. The damage she has taken is already visible in
      // the timber: she lists, and from the second hit she is missing her
      // topmasts.
    }

    // ---- system 4: going down ------------------------------------------------
    function sink(ship) {
      if (ship.state !== "sailing") return;
      ship.state = "sinking";
      const g = ship.el;
      const now = performance.now();
      const at = positionAt(ship, now) || { x: 0, y: 0 };
      const w = ship.beam, h = geom.hullUp(w) * 2;

      // Freeze her where she was hit. The voyage animation has to go first, or
      // it keeps driving the transform and she sinks while still making way.
      ship.anim.cancel(); ship.anim = null;
      g.setAttribute("transform", `translate(${at.x.toFixed(1)},${at.y.toFixed(1)})`);
      g.style.opacity = 1;
      g.classList.remove("dmg-1", "dmg-2");
      g.classList.add("is-sinking");
      // The intact plate goes the instant the pieces appear; the pieces ARE the
      // plate, so leaving both would draw her twice.
      const hull = g.querySelector(".ship-hull");
      hull.setAttribute("visibility", "hidden");

      // Bow and stern part outward, midships drops between them, the rigging
      // goes over the side. Direction per piece, not at random: pieces that
      // drifted the same way would read as one object sliding.
      const dirs = [-0.7, 0.8, -1, 0.25, 1];
      const pieces = shatter().map((poly, i) => ({
        poly, ...foundering(w, dirs[i], i < 2),
      }));
      wreckage(g.querySelector(".ship-harm"), { x: 0, y: 0 }, w, ship.heel,
               pieces, S.duration + 600);

      // Send for her replacement NOW, not when the wreck has finished going
      // down. She stops counting as a ship at sea the moment she is hit, and
      // the sequence runs seven seconds — long enough, with two or three losses
      // together, to leave the chart bare. A new sail should already be
      // standing in from off the plate while her masts are still going under.
      ask(rand(900, 2600));

      wash(at, w);
      bubbles(at, w, h);
      splinters(at, w, S.splinters);
      // The water she was standing in closes over the hole she made in it.
      const clearing = g.querySelector(".ship-clearing");
      clearing.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.25)", offset: 0.25 },
         { transform: "scale(0)" }],
        { duration: S.duration * 0.8, easing: "ease-in-out", fill: "forwards" }
      );

      later(() => {
        clearing.getAnimations().forEach((a) => a.cancel());
        hull.removeAttribute("visibility");
        retire(ship, true);
      }, S.duration + 300);
    }

    // ---- what the water does about it ----------------------------------------
    /** Loose timber, floating where she went down, going under one by one. */
    function splinters(at, w, n) {
      const h = geom.hullUp(w) * 2;
      const surface = at.y + S.waterline * h;
      const g = transient(root, S.duration + 1200);
      g.innerHTML = `<defs><clipPath id="sp${wreckSeq}">
          <rect x="${(at.x - 3 * w).toFixed(0)}" y="${(surface - 3 * h).toFixed(0)}"
                width="${(6 * w).toFixed(0)}" height="${(3 * h).toFixed(0)}"/>
        </clipPath></defs>
        <g clip-path="url(#sp${wreckSeq++})">${
          Array.from({ length: n }, () => {
            const len = rand(0.12, 0.30) * w;
            return `<path class="wreck-splinter"
                       d="M0 0 l${len.toFixed(1)} ${(rand(-0.25, 0.25) * len).toFixed(1)}"/>`;
          }).join("")}
        </g>`;

      [...g.querySelectorAll(".wreck-splinter")].forEach((el) => {
        const x0 = at.x + rand(-0.3, 0.3) * w;
        const y0 = surface - rand(1, 5);
        const dx = rand(-0.9, 0.9) * w;
        const spin = rand(-70, 70);
        const t = (x, y, r) =>
          `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${r.toFixed(1)}deg)`;
        el.animate(
          // It bobs, tips up, and slides under — the tip is what makes a flat
          // sliver readable as going down rather than simply being cut off.
          [{ offset: 0,    transform: t(x0, y0, 0) },
           { offset: 0.30, transform: t(x0 + dx * 0.4, y0 - 1.6, spin * 0.4) },
           { offset: 0.62, transform: t(x0 + dx * 0.7, y0 + 0.8, spin * 0.7) },
           { offset: 0.85, transform: t(x0 + dx * 0.9, y0 + rand(2, 5), spin * 1.4) },
           { offset: 1,    transform: t(x0 + dx, y0 + h * 0.5, spin * 1.8) }],
          { duration: rand(...S.splinterLinger), delay: rand(200, 1400),
            easing: "cubic-bezier(.35,.1,.6,.85)", fill: "forwards" }
        );
      });
    }

    /** The ring of disturbed water where a hull went down. */
    function wash(at, w) {
      const g = transient(root, 2600);
      g.innerHTML = `<ellipse class="wash-ring" cx="${at.x.toFixed(1)}"
        cy="${(at.y + S.waterline * geom.hullUp(w) * 2).toFixed(1)}" rx="${(w * 0.4).toFixed(1)}"
        ry="${(w * 0.16).toFixed(1)}"/>`;
      g.firstElementChild.animate(
        [{ transform: "scale(0.35)", opacity: 0.75 },
         { transform: "scale(1.9)", opacity: 0 }],
        { duration: 2200, easing: "cubic-bezier(.15,.7,.4,1)", fill: "forwards" }
      );
    }

    function bubbles(at, beam, h) {
      const surface = at.y + S.waterline * h;
      for (let i = 0; i < S.bubbles; i++) {
        const c = document.createElementNS(SVGNS, "circle");
        c.setAttribute("class", "sink-bubble");
        c.setAttribute("r", (rand(0.9, 2.6)).toFixed(1));
        root.appendChild(c);
        const x = at.x + rand(-0.35, 0.35) * beam;
        const y = surface + rand(-1, 3);
        const rise = rand(...S.bubbleRise);
        const delay = S.duration * 0.12 + i * 170;
        const a = c.animate(
          [{ transform: `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(0.3)`, opacity: 0 },
           { transform: `translate(${(x + rand(-4, 4)).toFixed(1)}px,${(y - beam * 0.14).toFixed(1)}px) scale(1)`,
             opacity: 0.6, offset: 0.4 },
           { transform: `translate(${(x + rand(-7, 7)).toFixed(1)}px,${(y - beam * 0.34).toFixed(1)}px) scale(0.45)`,
             opacity: 0 }],
          { duration: rise, delay, easing: "ease-out", fill: "forwards" }
        );
        // Same belt and braces as the shot: the timer is what guarantees the
        // node goes, the event just gets there sooner.
        const pop = () => c.remove();
        a.onfinish = pop;
        later(pop, delay + rise + 120);
      }
    }

    /**
     * Splinters thrown out of the side a ball went into.
     *
     * The first version drew seven equal spokes radiating from the ship's
     * centre, and it read as a symbol stamped ON TOP of her — a sparkle, not an
     * impact, and it covered the hull at the one moment you want to see the
     * hull. Two things fix that. The marks start at the point of impact, which
     * is on the flank facing the shooter, not at her middle; and they are
     * thrown in a CONE running on in the ball's own direction, so they fly off
     * the far side into open water instead of spreading over her deck.
     *
     * Uneven lengths, uneven angles. Equal spokes are what made it a symbol.
     */
    function burst(at, w, shooter) {
      const ang = shooter ? Math.atan2(at.y - shooter.y, at.x - shooter.x)
                          : rand(0, Math.PI * 2);
      // the struck flank: back along the shot, at the edge of the hull
      const ix = at.x - Math.cos(ang) * w * 0.40;
      const iy = at.y - Math.sin(ang) * w * 0.24;
      const g = transient(root, 900);
      const ticks = Array.from({ length: 5 }, () => {
        const a2 = ang + rand(-0.85, 0.85);
        const len = rand(0.08, 0.30) * w;
        const lead = rand(0.02, 0.12) * w;      // splinters do not all start together
        return `<path class="hit-tick"
                 d="M${(Math.cos(a2) * lead).toFixed(1)} ${(Math.sin(a2) * lead).toFixed(1)}
                    l${(Math.cos(a2) * len).toFixed(1)} ${(Math.sin(a2) * len).toFixed(1)}"/>`;
      }).join("");
      g.innerHTML = `<g>${ticks}</g>`;
      const T = (k) => `translate(${ix.toFixed(1)}px,${iy.toFixed(1)}px) scale(${k})`;
      g.firstElementChild.animate(
        [{ transform: T(0.25), opacity: 0.95 }, { transform: T(1.3), opacity: 0 }],
        { duration: 700, easing: "cubic-bezier(.1,.75,.3,1)", fill: "forwards" }
      );
    }

    /** Where a ball went into the water instead. */
    function splash(at, w) {
      const g = transient(root, 1200);
      g.innerHTML = `<g>
          <ellipse class="splash-ring" cx="0" cy="0" rx="${(w * 0.18).toFixed(1)}" ry="${(w * 0.07).toFixed(1)}"/>
          <path class="splash-lip" d="M${(-w * 0.12).toFixed(1)} 0 q ${(w * 0.12).toFixed(1)} ${(-w * 0.22).toFixed(1)} ${(w * 0.24).toFixed(1)} 0"/>
        </g>`;
      g.firstElementChild.animate(
        [{ transform: `translate(${at.x.toFixed(1)}px,${at.y.toFixed(1)}px) scale(0.35)`, opacity: 0.9 },
         { transform: `translate(${at.x.toFixed(1)}px,${at.y.toFixed(1)}px) scale(1.5)`, opacity: 0 }],
        { duration: 1000, easing: "cubic-bezier(.1,.7,.35,1)", fill: "forwards" }
      );
    }

    /** The powder smoke a broadside leaves hanging beside the ship. */
    function muzzle(at, toward, w) {
      const ang = Math.atan2(toward.y - at.y, toward.x - at.x);
      const g = transient(root, 2200);
      g.innerHTML = `<g class="muzzle">
          <path d="M0 0 q ${(w * 0.14).toFixed(1)} ${(-w * 0.12).toFixed(1)} ${(w * 0.30).toFixed(1)} ${(-w * 0.04).toFixed(1)}"/>
          <path d="M0 ${(w * 0.06).toFixed(1)} q ${(w * 0.16).toFixed(1)} ${(w * 0.04).toFixed(1)} ${(w * 0.26).toFixed(1)} ${(-w * 0.10).toFixed(1)}"/>
        </g>`;
      const x = at.x + Math.cos(ang) * w * 0.34, y = at.y + Math.sin(ang) * w * 0.34;
      g.firstElementChild.animate(
        [{ transform: `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(0.4) rotate(${(ang * 57.3).toFixed(0)}deg)`, opacity: 0.9 },
         { transform: `translate(${(x + Math.cos(ang) * w * 0.3).toFixed(1)}px,${(y - w * 0.22).toFixed(1)}px) scale(1.5) rotate(${(ang * 57.3 + 18).toFixed(0)}deg)`, opacity: 0 }],
        { duration: 1900, easing: "ease-out", fill: "forwards" }
      );
    }


    // ---- dispatch ------------------------------------------------------------
    let lastDeparture = -Infinity;
    let pending = null, pendingAt = Infinity;

    /**
     * One pending departure at a time — but always the SOONEST one asked for.
     *
     * Two bugs live here, and they pull in opposite directions.
     *
     * The first was every path that wanted a ship out — a retirement, a
     * sinking, the previous departure — scheduling its own call, and every call
     * that found itself too early rescheduling itself rather than standing
     * down. The chains multiplied instead of merging and the timers never went
     * away.
     *
     * The obvious fix, a single pending slot that ignores further requests,
     * caused the second and much worse one: an urgent request would be dropped
     * because a leisurely one was already queued. Sink the fleet at once and
     * the chart went EMPTY and stayed empty for eighteen seconds — three ships
     * asked for a replacement, two of the three asks were thrown away, and the
     * one that survived was the slow one. Measured, not deduced; that is the
     * fault the empty sea was reported as.
     *
     * So: still one timer, but an earlier request takes it over.
     */
    function ask(delay) {
      const when = performance.now() + Math.max(0, delay);
      if (pending !== null) {
        if (when >= pendingAt) return;            // something sooner is queued
        cancel(pending);                          // this is sooner: take over
      }
      pendingAt = when;
      pending = later(() => { pending = null; pendingAt = Infinity; dispatch(); },
                      Math.max(0, delay));
    }

    function dispatch() {
      const idle = fleet.filter((s) => s.state === "idle");
      if (!idle.length) return;    // retire() and sink() re-arm; nothing to do
      // Below the floor, the gap does not apply — see CONFIG.fleet.minAtSea.
      const starved = atSea().length < F.minAtSea;
      const wait = starved
        ? 0
        : lastDeparture + rand(...F.departGap) * 1000 - performance.now();
      if (wait > 0) { ask(wait); return; }
      sail(idle[(rand01() * idle.length) | 0]);
      // Keep going while anyone is still ashore, quickly if the sea is thin.
      if (fleet.some((s) => s.state === "idle")) {
        ask(atSea().length < F.minAtSea
              ? rand(0.7, 2.4) * 1000
              : rand(...F.departGap) * 1000);
      }
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
    ask(rand(3, 12) * 1000);

    // The last three are exposed so the squadron can be exercised on demand
    // rather than waited on: an engagement is a chance event that may be a
    // couple of minutes away, which is no way to check that gunnery, damage
    // and sinking actually work.
    return { fleet, positionAt, closestApproach, engage, damage, sink };
  }

  return { CONFIG, configure, markup, launch };
})();
