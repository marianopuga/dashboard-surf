// ---- helpers -------------------------------------------------------------

function angleDiff(a, b) {
  if (a == null || b == null) return 90; // unknown -> neutral
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function triangularScore(v, [lo, hi]) {
  if (v == null) return 0.5;
  const mid = (lo + hi) / 2;
  if (v >= lo && v <= hi) return 1 - (0.3 * Math.abs(v - mid)) / ((hi - lo) / 2 || 1);
  const dist = v < lo ? lo - v : v - hi;
  return Math.max(0, 1 - dist / (hi - lo || 1));
}

function windScoreFor(facingDeg, windDeg, speedKmh) {
  if (windDeg == null) return 0.5;
  const offshoreDeg = (facingDeg + 180) % 360;
  const diff = angleDiff(windDeg, offshoreDeg); // 0 = offshore, 180 = onshore
  let base = 1 - diff / 180;
  if (speedKmh != null && speedKmh < 8) base = Math.max(base, 0.7); // light wind forgives a lot
  if (speedKmh != null && speedKmh > 20 && diff > 120) base = Math.min(base, 0.15); // strong onshore
  return Math.max(0, Math.min(1, base));
}

function scoreSpot(spot, swell, wind, tide) {
  const [dmin, dmax] = spot.swell_window;
  const center = (dmin + dmax) / 2;
  const halfWidth = (dmax - dmin) / 2;
  const dirDiff = angleDiff(swell.wave_direction_deg, center);
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

  const total = (dirScore * 0.30 + sizeScore * 0.25 + windScore * 0.30 + tideScore * 0.15) * periodOK;
  return { total, dirScore, sizeScore, windScore, tideScore, periodOK };
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
  const span = next.dt - prev.dt;
  const elapsed = now - prev.dt;
  const frac = span > 0 ? elapsed / span : 0;
  let state;
  if (prev.type === "low" && frac < 0.3) state = "low";
  else if (prev.type === "high" && frac < 0.3) state = "high";
  else state = "mid";
  return { state, prev, next, frac };
}

function scoreLabel(total) {
  if (total >= 0.72) return { text: "Muy bueno", cls: "good" };
  if (total >= 0.5) return { text: "Aceptable", cls: "ok" };
  return { text: "Flojo", cls: "poor" };
}

function fmtDeg(deg, compass) {
  if (deg == null) return "s/d";
  return `${compass || ""} (${Math.round(deg)}°)`;
}

// ---- rendering -------------------------------------------------------------

function arrowSvg(deg, cls) {
  // Arrow points in the direction the swell/wind is travelling TOWARD
  // (i.e. rotated 180° from the "coming from" compass reading).
  const travelDeg = deg == null ? 0 : (deg + 180) % 360;
  return `<svg class="arrow ${cls}" viewBox="0 0 24 24" style="transform:rotate(${travelDeg}deg)">
    <path d="M12 2 L18 14 L12 10.5 L6 14 Z"/>
  </svg>`;
}

function renderStatusBar(swell, wind, tide, errors) {
  const el = document.getElementById("status-bar");
  const tideNow = tideStateNow(tide);
  const tideTxt = tideNow && tideNow.next
    ? `Marea ${tideNow.state === "unknown" ? "" : tideNow.state} → próxima ${tideNow.next.type === "high" ? "pleamar" : "bajamar"} ${tideNow.next.time_display} (${tideNow.next.height_m} m)`
    : "Marea: sin datos";

  el.innerHTML = `
    <div class="status-item">
      <span class="status-label">Oleaje (MHL, boya real, ${swell.observed_at || "s/d"})</span>
      <span class="status-value">${swell.wave_height_hs_m ?? "?"} m · ${swell.wave_period_tp1_s ?? "?"} s · ${fmtDeg(swell.wave_direction_deg, swell.wave_direction_compass)}</span>
    </div>
    <div class="status-item">
      <span class="status-label">Viento (BOM North Head, en vivo, ${wind.observed_at_display || "s/d"})</span>
      <span class="status-value">${fmtDeg(wind.wind_dir_deg, wind.wind_dir_compass)} · ${wind.wind_speed_kmh ?? "?"} km/h (ráf. ${wind.gust_kmh ?? "?"})</span>
    </div>
    <div class="status-item">
      <span class="status-label">Marea (BOM, Fort Denison)</span>
      <span class="status-value">${tideTxt}</span>
    </div>
  `;
  if (errors.length) {
    el.innerHTML += `<div class="status-item status-error">⚠ ${errors.join(" · ")}</div>`;
  }
}

function renderMap(ranked) {
  const svg = document.getElementById("map-svg");
  const lats = SPOTS.map((s) => s.lat), lngs = SPOTS.map((s) => s.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const W = 260, H = 560, PAD = 40;

  const xy = (spot) => {
    const x = PAD + ((spot.lng - minLng) / (maxLng - minLng || 1)) * (W - 2 * PAD);
    // north (higher lat, less negative) at top -> invert
    const y = H - PAD - ((spot.lat - minLat) / (maxLat - minLat || 1)) * (H - 2 * PAD);
    return [x, y];
  };

  const points = SPOTS.slice().sort((a, b) => a.order - b.order).map(xy);
  const path = points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");

  const dots = SPOTS.map((spot) => {
    const [x, y] = xy(spot);
    const r = ranked.find((r) => r.spot.id === spot.id);
    const cls = r ? scoreLabel(r.score.total).cls : "";
    const best = r && r.isBest ? "best" : "";
    return `<g class="map-dot ${cls} ${best}" data-spot="${spot.id}" transform="translate(${x},${y})">
      <circle r="7"></circle>
      <text x="12" y="4">${spot.name}</text>
    </g>`;
  }).join("");

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <path class="coast-line" d="${path}"></path>
    ${dots}
  `;

  svg.querySelectorAll(".map-dot").forEach((g) => {
    g.addEventListener("click", () => {
      const id = g.getAttribute("data-spot");
      document.getElementById(`spot-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}

function renderSpotList(ranked) {
  const el = document.getElementById("spot-list");
  el.innerHTML = ranked.map(({ spot, score, isBest }, i) => {
    const label = scoreLabel(score.total);
    return `
      <article class="spot-card ${label.cls} ${isBest ? "best" : ""}" id="spot-${spot.id}">
        <header>
          <h3>${isBest ? "⭐ " : ""}${spot.name}</h3>
          <span class="badge ${label.cls}">${label.text}</span>
        </header>
        <div class="spot-arrows">
          ${arrowSvg(spot.swell_dir_used, "swell")} <span>swell hacia la costa</span>
          ${arrowSvg(spot.wind_dir_used, "wind")} <span>viento hacia la costa</span>
        </div>
        <p class="spot-note">${spot.note}</p>
        <div class="spot-links">
          ${spot.surfline_url
            ? `<a href="${spot.surfline_url}" target="_blank" rel="noopener">Ver en Surfline ↗</a>`
            : `<span class="muted">Sin página propia en Surfline</span>`}
          <button class="toggle-windguru" data-spot="${spot.id}">Ver viento detallado (Windguru)</button>
        </div>
        <div class="windguru-embed" id="windguru-${spot.id}" hidden>
          <div class="windguru-disclaimer">
            ⚠ Windguru gratis: pronóstico con atraso (no es en tiempo real). No se usa para calcular el ranking.
          </div>
          <iframe loading="lazy" src="about:blank" data-src="https://www.windguru.cz/${spot.windguru_id}" title="Windguru ${spot.name}"></iframe>
        </div>
      </article>
    `;
  }).join("");

  el.querySelectorAll(".toggle-windguru").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-spot");
      const box = document.getElementById(`windguru-${id}`);
      const wasHidden = box.hidden;
      box.hidden = !wasHidden;
      if (wasHidden) {
        const iframe = box.querySelector("iframe");
        if (iframe.src === "about:blank") iframe.src = iframe.dataset.src;
      }
    });
  });
}

// ---- main -------------------------------------------------------------

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const errors = [];
  let swell = null, wind = null, tide = null;

  const [swellR, windR, tideR] = await Promise.allSettled([
    fetchJson("/api/mhl"),
    fetchJson("/api/wind"),
    fetchJson("/api/tide"),
  ]);

  if (swellR.status === "fulfilled") swell = swellR.value;
  else { errors.push("No se pudo leer la boya MHL"); swell = {}; }

  if (windR.status === "fulfilled") wind = windR.value;
  else { errors.push("No se pudo leer viento BOM"); wind = {}; }

  if (tideR.status === "fulfilled") tide = tideR.value;
  else { errors.push("No se pudo leer marea BOM"); tide = {}; }

  renderStatusBar(swell, wind, tide, errors);

  const tideNow = tideStateNow(tide);
  const ranked = SPOTS.map((spot) => {
    spot.swell_dir_used = swell.wave_direction_deg;
    spot.wind_dir_used = wind.wind_dir_deg;
    const score = scoreSpot(spot, swell, wind, tideNow);
    return { spot, score };
  }).sort((a, b) => b.score.total - a.score.total);

  ranked.forEach((r, i) => (r.isBest = i === 0));
  // keep original south->north order for the list, but flag the winner
  const byOrder = ranked.slice().sort((a, b) => a.spot.order - b.spot.order);

  renderMap(ranked);
  renderSpotList(byOrder);

  document.getElementById("best-banner").textContent =
    `Hoy pinta mejor en ${ranked[0].spot.name}`;
}

main();
