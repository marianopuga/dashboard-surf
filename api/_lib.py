"""Shared fetch/parse helpers for the surf dashboard's serverless functions.

All three sources are fetched server-side because none of them send
CORS headers, so the browser can't call them directly.
"""
import json
import re
import urllib.request

UA = "Mozilla/5.0 (personal surf dashboard; single user, low frequency)"

MHL_URL = "https://www.mhl.nsw.gov.au/s3/www/stations/wave/SYDDOW.json"
BOM_OBS_URL = "https://www.bom.gov.au/fwo/IDN60901/IDN60901.95768.json"
BOM_TIDE_URL = (
    "https://www.bom.gov.au/australia/tides/print.php"
    "?aac=NSW_TP007&type=tide&date=%3F&region=NSW"
    "&tz=Australia%2FSydney&tz_js=AEST&days=2"
)

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
            "Fort Denison es la referencia oficial de mareas de Sydney. "
            "El horario de pleamar/bajamar es prácticamente el mismo en "
            "las playas oceánicas cercanas; la altura puede variar levemente."
        ),
    }


def json_response(handler, payload, status=200):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "public, max-age=300")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def error_response(handler, message, status=502):
    json_response(handler, {"error": message}, status=status)
