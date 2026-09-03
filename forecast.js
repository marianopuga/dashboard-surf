// ===========================================================================
// Forecast data shaping
//
// Turns the two wire payloads (/api/forecast, /api/tide) into things the UI can
// index by time, and computes tide on the client.
//
// Tide is predicted, not observed: the BOM table for the next week does not
// change, so it is fetched once, cached, and interpolated locally rather than
// re-requested. That is also what makes tide available at *every* forecast
// hour — scoring 11 spots across 168 hours needs a tide state per hour, and no
// API is going to be asked 1,848 times.
// ===========================================================================

const FORECAST = (() => {
  /** The five parts of today, and the two shown per day across the week. */
  const DAY_PARTS = [
    { key: "dawn", label: "dawn", hour: 6 },
    { key: "morning", label: "morn", hour: 9 },
    { key: "midday", label: "midday", hour: 12 },
    { key: "afternoon", label: "aft", hour: 15 },
    { key: "dusk", label: "dusk", hour: 18 },
  ];
  const WEEK_PARTS = [
    { key: "morning", label: "AM", hour: 9 },
    { key: "afternoon", label: "PM", hour: 15 },
  ];

  const TZ = "Australia/Sydney";
  const HOUR_MS = 3600000;

  // Constructing an Intl formatter is expensive, and this runs for every hour of
  // a 168-hour series. One instance, reused.
  const TZ_FMT = new Intl.DateTimeFormat("en-AU", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });

  /** Sydney wall-clock parts for an absolute instant, whatever the viewer's zone. */
  function partsInTz(ms) {
    const out = {};
    for (const p of TZ_FMT.formatToParts(new Date(ms))) out[p.type] = p.value;
    return {
      y: +out.year, m: +out.month, d: +out.day,
      hour: +out.hour % 24, minute: +out.minute,
      weekday: out.weekday,
      dayKey: `${out.year}-${out.month}-${out.day}`,
    };
  }

  /**
   * Tide height and state at any instant, interpolated between the published
   * highs and lows with a cosine — the shape a semidiurnal tide actually takes,
   * and far closer than a straight line between extremes.
   */
  function buildTide(tide) {
    const evs = ((tide && tide.events) || [])
      .map((e) => ({ ...e, ms: Date.parse(e.time_local) }))
      .filter((e) => Number.isFinite(e.ms))
      .sort((a, b) => a.ms - b.ms);

    function bracket(ms) {
      if (evs.length < 2 || ms < evs[0].ms || ms > evs[evs.length - 1].ms) return null;
      let prev = null, next = null;
      for (const e of evs) {
        if (e.ms <= ms) prev = e;
        else { next = e; break; }
      }
      if (!prev || !next || next.ms === prev.ms) return null;
      return { prev, next, frac: (ms - prev.ms) / (next.ms - prev.ms) };
    }

    return {
      ok: evs.length >= 2,
      events: evs,
      heightAt(ms) {
        const b = bracket(ms);
        if (!b) return null;
        const shape = (1 - Math.cos(Math.PI * b.frac)) / 2;
        return b.prev.height_m + (b.next.height_m - b.prev.height_m) * shape;
      },
      /** Near an extreme it reads as that extreme; the middle of the swing is "mid". */
      stateAt(ms) {
        const b = bracket(ms);
        if (!b) return null;
        if (b.frac < 0.25) return b.prev.type;
        if (b.frac > 0.75) return b.next.type;
        return "mid";
      },
      nextAfter(ms) {
        const b = bracket(ms);
        return b ? b.next : null;
      },
    };
  }

  /** Hour lookup by absolute time, tolerant of a missing hour in the series. */
  function buildHours(forecast) {
    const list = ((forecast && forecast.hours) || [])
      .filter((h) => Number.isFinite(h.ts))
      .sort((a, b) => a.ts - b.ts);
    const byTs = new Map(list.map((h) => [h.ts, h]));

    // Each hour's Sydney date/hour is resolved once here, so slot lookup is a
    // map hit rather than a scan-plus-reformat per slot.
    const byDayHour = new Map();
    for (const h of list) {
      h.tzParts = partsInTz(h.ts);
      byDayHour.set(`${h.tzParts.dayKey}|${h.tzParts.hour}`, h);
    }

    return {
      ok: list.length > 0,
      list,
      byDayHour,
      first: list.length ? list[0].ts : null,
      last: list.length ? list[list.length - 1].ts : null,
      at(ms) {
        if (!list.length) return null;
        const snapped = Math.round(ms / HOUR_MS) * HOUR_MS;
        const hit = byTs.get(snapped);
        if (hit) return hit;
        // fall back to nearest, but refuse to pretend across a big gap
        let best = null, bestD = Infinity;
        for (const h of list) {
          const d = Math.abs(h.ts - ms);
          if (d < bestD) { bestD = d; best = h; }
        }
        return bestD <= 90 * 60000 ? best : null;
      },
    };
  }

  /**
   * The tile timeline: five slots for today, then morning/afternoon for the
   * following days. Slots already in the past are dropped from today so the bar
   * always starts at the next thing that matters.
   */
  function buildSlots(hours, nowMs, weekDays = 7) {
    if (!hours.ok) return { today: [], tomorrow: [], week: [] };
    const today = [];

    const todayKey = partsInTz(nowMs).dayKey;
    const tomorrowKey = partsInTz(nowMs + 24 * HOUR_MS).dayKey;

    const slotFor = (dayOffset, part) => {
      const dayParts = partsInTz(nowMs + dayOffset * 24 * HOUR_MS);
      const h = hours.byDayHour.get(`${dayParts.dayKey}|${part.hour}`);
      if (!h) return null;
      const dayLabel = h.tzParts.dayKey === todayKey ? "Today"
        : h.tzParts.dayKey === tomorrowKey ? "Tomorrow"
        : h.tzParts.weekday;
      return { ...part, ts: h.ts, hour: h, day: h.tzParts, dayLabel };
    };

    // Today keeps all five parts even once they have passed — the ones behind
    // us are marked `past` and dimmed rather than dropped, so the day always
    // reads as a whole day and "Today" never silently turns into tomorrow.
    for (const part of DAY_PARTS) {
      const s = slotFor(0, part);
      if (s) today.push({ ...s, past: s.ts + HOUR_MS < nowMs });
    }
    const tomorrow = [];
    for (const part of DAY_PARTS) {
      const s = slotFor(1, part);
      if (s) tomorrow.push({ ...s, past: false });
    }

    // The week strip starts the day after tomorrow: today and tomorrow already
    // have their own full five-part strips, so repeating them here would be
    // showing the same hours twice at coarser resolution.
    const week = [];
    for (let d = 2; d < weekDays; d++) {
      for (const part of WEEK_PARTS) {
        const s = slotFor(d, part);
        if (s && s.ts + HOUR_MS >= nowMs) week.push(s);
      }
    }
    return { today, tomorrow, week };
  }

  const fmtHour = (ms) => {
    const p = partsInTz(ms);
    return `${String(p.hour).padStart(2, "0")}:${p.minute}`;
  };

  /** "Today 14:00" / "Thu 06:00" — the slider's always-visible label. */
  function fmtWhen(ms, nowMs) {
    const p = partsInTz(ms), n = partsInTz(nowMs);
    const tomorrow = partsInTz(nowMs + 24 * HOUR_MS);
    const day = p.dayKey === n.dayKey ? "Today"
      : p.dayKey === tomorrow.dayKey ? "Tomorrow"
      : p.weekday;
    return `${day} ${String(p.hour).padStart(2, "0")}:00`;
  }

  return { DAY_PARTS, WEEK_PARTS, HOUR_MS, TZ, partsInTz, buildTide, buildHours, buildSlots, fmtHour, fmtWhen };
})();

if (typeof module !== "undefined" && module.exports) module.exports = FORECAST;
