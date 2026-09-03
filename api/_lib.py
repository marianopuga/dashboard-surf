"""Shared fetch/parse helpers for the surf dashboard's serverless functions.

All three sources are fetched server-side because none of them send
CORS headers, so the browser can't call them directly.
"""
import datetime
import json
import re
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (personal surf dashboard; single user, low frequency)"

MHL_URL = "https://www.mhl.nsw.gov.au/s3/www/stations/wave/SYDDOW.json"
BOM_OBS_URL = "https://www.bom.gov.au/fwo/IDN60901/IDN60901.95768.json"
BOM_TIDE_URL = (
    "https://www.bom.gov.au/australia/tides/print.php"
    "?aac=NSW_TP007&type=tide&date=%3F&region=NSW"
    "&tz=Australia%2FSydney&tz_js=AEST&days=7"
)

# --- forecast ------------------------------------------------------------
# MHL and BOM only publish current conditions, so the hourly outlook comes from
# Open-Meteo (free, no key). One representative point serves the whole strip:
# Shelly and Long Reef, 8 km apart, resolve to the same wave-model grid cell and
# return identical values, so per-spot requests would be 11x the calls for
# identical numbers. Per-spot differences come from each spot's own aspect and
# shelter, exactly as they already do for the single buoy reading.
OM_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
OM_WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
FORECAST_LAT, FORECAST_LNG = -33.78, 151.30
FORECAST_DAYS = 7

# The model and the buoy do not measure the same thing on the same scale, and
# the per-spot thresholds in spots.js are calibrated in *buoy* units. Left
# uncorrected the forecast reads ~1.5x small and would essentially never reach
# "head high", so the tiers would be wrong for the entire outlook.
#
# Measured over 167 matched hours (a full week of buoy history against the
# model's own past_days):
#   height    buoy Hs / model wave_height      median 1.55, stdev 0.18
#   period    buoy Tp - model swell_period     mean +3.3 s, stdev 1.13
#   direction model wave_direction             median 10 deg, p90 23 deg -> used raw
#
# wave_height (total) is used rather than swell_wave_height because buoy Hs is
# also a total significant height, which is what good_size_m was authored
# against. wave_peak_period is accepted by the API but returns null here.
HS_MODEL_TO_BUOY = 1.55
PERIOD_MODEL_TO_BUOY_S = 3.3

COMPASS_DEG = {
    "N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5, "E": 90, "ESE": 112.5,
    "SE": 135, "SSE": 157.5, "S": 180, "SSW": 202.5, "SW": 225, "WSW": 247.5,
    "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5,
}

TIDE_ROW_RE = re.compile(
    r'class="instance ([a-z-]+)">[^<]*</th>\s*'
    r'<td data-time-utc="[^"]*" data-time-local="([^"]+)" '
    r'class="localtime [a-z-]+">([^<]+)</td>\s*</tr>\s*<tr>\s*'
    r'<td class="height [a-z-]+">([\d.]+)\s*m</td>',
    re.S,
)


def fetch(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def fetch_json(url, timeout=10):
    return json.loads(fetch(url, timeout))


def deg_to_compass(deg):
    if deg is None:
        return None
    dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    return dirs[int((deg / 22.5) + 0.5) % 16]


def get_latest_swell():
    """Real measured swell from the MHL Sydney Waverider buoy (SYDDOW)."""
    data = fetch_json(MHL_URL)
    readings = data["readings"]
    latest_ts = max(readings.keys())
    r = readings[latest_ts]
    direction = r.get("993")
    return {
        "observed_at": latest_ts,
        "wave_height_hs_m": r.get("991"),
        "wave_height_max_m": r.get("992"),
        "wave_period_tp1_s": r.get("994"),
        "wave_period_tz_s": r.get("996"),
        "wave_direction_deg": direction,
        "wave_direction_compass": deg_to_compass(direction),
        "source": "Manly Hydraulics Laboratory – Sydney Waverider Buoy (SYDDOW)",
        "source_url": "https://www.mhl.nsw.gov.au/data/realtime/wave/Buoy-syddow",
        "is_measured": True,
    }


def get_latest_wind():
    """Live wind observation from BOM's North Head automatic weather station."""
    data = fetch_json(BOM_OBS_URL)
    obs = data["observations"]["data"][0]
    compass = obs.get("wind_dir")
    return {
        "observed_at": obs.get("local_date_time_full"),
        "observed_at_display": obs.get("local_date_time"),
        "station": obs.get("name"),
        "wind_dir_compass": compass,
        "wind_dir_deg": COMPASS_DEG.get(compass),
        "wind_speed_kmh": obs.get("wind_spd_kmh"),
        "gust_kmh": obs.get("gust_kmh"),
        "source": "Bureau of Meteorology – North Head AWS",
        "source_url": "http://www.bom.gov.au/products/IDN60901/IDN60901.95768.shtml",
        "is_measured": True,
    }


def get_tide_events():
    """Official BOM tide predictions for Fort Denison (Sydney Harbour)."""
    html = fetch(BOM_TIDE_URL)
    events = []
    for kind, time_local, time_display, height in TIDE_ROW_RE.findall(html):
        events.append({
            "type": "high" if "high" in kind else "low",
            "time_local": time_local,
            "time_display": time_display.strip(),
            "height_m": float(height),
        })
    return {
        "station": "Fort Denison, Sydney Harbour",
        "events": events,
        "source": "Bureau of Meteorology – National Tide Tables",
        "source_url": "https://www.bom.gov.au/australia/tides/",
        "note": (
            "Fort Denison is Sydney's official tide reference. "
            "High/low tide timing is virtually the same at nearby ocean "
            "beaches; the height can vary slightly."
        ),
    }


def _query(base, params):
    return base + "?" + urllib.parse.urlencode(params)


def get_forecast():
    """Hourly outlook for the whole strip: two upstream calls, merged.

    Heights and periods are converted into buoy units on the way out, so a
    forecast hour and a measured reading can be fed to the same scoring rubric
    without the per-spot size thresholds meaning two different things.
    """
    marine = fetch_json(_query(OM_MARINE_URL, {
        "latitude": FORECAST_LAT, "longitude": FORECAST_LNG,
        "hourly": "wave_height,wave_direction,swell_wave_period,sea_surface_temperature",
        "forecast_days": FORECAST_DAYS, "timezone": "Australia/Sydney",
    }), timeout=20)
    weather = fetch_json(_query(OM_WEATHER_URL, {
        "latitude": FORECAST_LAT, "longitude": FORECAST_LNG,
        "hourly": "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
        "forecast_days": FORECAST_DAYS, "timezone": "Australia/Sydney",
    }), timeout=20)

    mh, wh = marine["hourly"], weather["hourly"]
    wind_at = {t: i for i, t in enumerate(wh["time"])}

    # Open-Meteo returns naive local timestamps ("2026-09-03T14:00"). Parsed in a
    # browser outside Sydney those would silently shift by hours, so an absolute
    # epoch is emitted alongside and the client uses that for all arithmetic.
    offset_s = marine.get("utc_offset_seconds", 0)

    def scaled(v, factor):
        return round(v * factor, 2) if v is not None else None

    def shifted(v, offset):
        return round(v + offset, 1) if v is not None else None

    hours = []
    for i, t in enumerate(mh["time"]):
        j = wind_at.get(t)
        naive = datetime.datetime.fromisoformat(t)
        hours.append({
            "t": t,
            "ts": int((naive - datetime.timedelta(seconds=offset_s)).replace(
                tzinfo=datetime.timezone.utc).timestamp() * 1000),
            "hs": scaled(mh["wave_height"][i], HS_MODEL_TO_BUOY),
            "hsRaw": mh["wave_height"][i],
            "periodS": shifted(mh["swell_wave_period"][i], PERIOD_MODEL_TO_BUOY_S),
            "swellFromDeg": mh["wave_direction"][i],
            "sstC": mh["sea_surface_temperature"][i],
            "windKmh": wh["wind_speed_10m"][j] if j is not None else None,
            "windFromDeg": wh["wind_direction_10m"][j] if j is not None else None,
            "gustKmh": wh["wind_gusts_10m"][j] if j is not None else None,
        })

    return {
        "hours": hours,
        "timezone": marine.get("timezone"),
        "calibration": {
            "hs_model_to_buoy": HS_MODEL_TO_BUOY,
            "period_model_to_buoy_s": PERIOD_MODEL_TO_BUOY_S,
            "note": (
                "Heights and periods are rescaled into MHL buoy units so the "
                "per-spot size thresholds mean the same thing for measured and "
                "forecast conditions. Derived from 167 matched hours."
            ),
        },
        "source": "Open-Meteo Marine + Weather (ECMWF/GFS wave and wind models)",
        "source_url": "https://open-meteo.com/",
        "is_measured": False,
    }


def json_response(handler, payload, status=200, max_age=1800):
    # 30 minutes by default, matching how often the buoy and the AWS actually
    # publish. Vercel's Python functions are stateless, so this header (plus the
    # client's own localStorage copy) *is* the cache -- there is no process
    # memory that survives between invocations to hold one.
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", f"public, max-age={max_age}")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def error_response(handler, message, status=502):
    json_response(handler, {"error": message}, status=status)
