"""Weather tool for fetching live weather data via Open-Meteo API.

Provides current conditions and 5-day forecast for any location.
Uses Open-Meteo geocoding + forecast APIs (free, no API key needed).
"""

try:
    import aiohttp
except ImportError:
    aiohttp = None  # type: ignore

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools import events
from tools.logging_utils import bind_tool_logger


# WMO Weather Code to description + emoji mapping
WMO_CODES = {
    0: ("Clear sky", "☀️", "sun"),
    1: ("Mainly clear", "🌤", "sun"),
    2: ("Partly cloudy", "⛅", "cloud"),
    3: ("Overcast", "☁️", "cloud"),
    45: ("Fog", "🌫", "cloud"),
    48: ("Rime fog", "🌫", "cloud"),
    51: ("Light drizzle", "🌦", "cloud"),
    53: ("Moderate drizzle", "🌦", "cloud"),
    55: ("Dense drizzle", "🌧", "cloud"),
    56: ("Light freezing drizzle", "🌧", "cloud"),
    57: ("Dense freezing drizzle", "🌧", "cloud"),
    61: ("Slight rain", "🌦", "cloud"),
    63: ("Moderate rain", "🌧", "cloud"),
    65: ("Heavy rain", "🌧", "cloud"),
    66: ("Light freezing rain", "🌧", "cloud"),
    67: ("Heavy freezing rain", "🌧", "cloud"),
    71: ("Slight snow", "🌨", "cloud"),
    73: ("Moderate snow", "🌨", "cloud"),
    75: ("Heavy snow", "❄️", "cloud"),
    77: ("Snow grains", "❄️", "cloud"),
    80: ("Slight showers", "🌦", "cloud"),
    81: ("Moderate showers", "🌧", "cloud"),
    82: ("Violent showers", "🌧", "cloud"),
    85: ("Slight snow showers", "🌨", "cloud"),
    86: ("Heavy snow showers", "❄️", "cloud"),
    95: ("Thunderstorm", "⛈", "zap"),
    96: ("Thunderstorm w/ slight hail", "⛈", "zap"),
    99: ("Thunderstorm w/ heavy hail", "⛈", "zap"),
}


def _decode_wmo(code: int) -> tuple[str, str, str]:
    """Return (description, emoji, icon_name) for a WMO weather code."""
    return WMO_CODES.get(code, ("Unknown", "❓", "cloud"))


GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# In-memory cache for geocoding results to avoid repeated API calls for the same location
_geocode_cache: dict[str, dict] = {}


async def _geocode(session: aiohttp.ClientSession, location: str) -> dict | None:
    cache_key = location.lower().strip()
    if cache_key in _geocode_cache:
        return _geocode_cache[cache_key]
    result = await _geocode_impl(session, location)
    if result:
        _geocode_cache[cache_key] = result
    return result


async def _geocode_impl(session: aiohttp.ClientSession, location: str) -> dict | None:
    """Geocode a location name to lat/lon via Open-Meteo.

    The Open-Meteo geocoding API doesn't handle composite queries like
    "London, England" well — it needs just the city name. When a query
    returns no results, we retry with only the first part (before the comma).
    We also match the user's country/region hint against results to pick
    the best candidate instead of always preferring US locations.

    For US state names (e.g. "Florida"), we detect the state and pick
    the largest city in that state to represent it.
    """
    # Parse qualifier from comma-separated input
    qualifier = ""
    if "," in location:
        parts = [p.strip() for p in location.split(",")]
        base_query = parts[0]
        qualifier = " ".join(parts[1:]).lower()
    else:
        base_query = location

    # Check if the query is a bare US state name — if so, search for the
    # state's largest city instead (geocoding APIs return cities, not states)
    _STATE_CAPITALS = {
        "alabama": "Birmingham, Alabama",
        "alaska": "Anchorage, Alaska",
        "arizona": "Phoenix, Arizona",
        "arkansas": "Little Rock, Arkansas",
        "california": "Los Angeles, California",
        "colorado": "Denver, Colorado",
        "connecticut": "Hartford, Connecticut",
        "delaware": "Wilmington, Delaware",
        "florida": "Miami, Florida",
        "georgia": "Atlanta, Georgia",
        "hawaii": "Honolulu, Hawaii",
        "idaho": "Boise, Idaho",
        "illinois": "Chicago, Illinois",
        "indiana": "Indianapolis, Indiana",
        "iowa": "Des Moines, Iowa",
        "kansas": "Wichita, Kansas",
        "kentucky": "Louisville, Kentucky",
        "louisiana": "New Orleans, Louisiana",
        "maine": "Portland, Maine",
        "maryland": "Baltimore, Maryland",
        "massachusetts": "Boston, Massachusetts",
        "michigan": "Detroit, Michigan",
        "minnesota": "Minneapolis, Minnesota",
        "mississippi": "Jackson, Mississippi",
        "missouri": "Kansas City, Missouri",
        "montana": "Billings, Montana",
        "nebraska": "Omaha, Nebraska",
        "nevada": "Las Vegas, Nevada",
        "new hampshire": "Manchester, New Hampshire",
        "new jersey": "Newark, New Jersey",
        "new mexico": "Albuquerque, New Mexico",
        "new york": "New York City",
        "north carolina": "Charlotte, North Carolina",
        "north dakota": "Fargo, North Dakota",
        "ohio": "Columbus, Ohio",
        "oklahoma": "Oklahoma City, Oklahoma",
        "oregon": "Portland, Oregon",
        "pennsylvania": "Philadelphia, Pennsylvania",
        "rhode island": "Providence, Rhode Island",
        "south carolina": "Charleston, South Carolina",
        "south dakota": "Sioux Falls, South Dakota",
        "tennessee": "Nashville, Tennessee",
        "texas": "Houston, Texas",
        "utah": "Salt Lake City, Utah",
        "vermont": "Burlington, Vermont",
        "virginia": "Virginia Beach, Virginia",
        "washington": "Seattle, Washington",
        "west virginia": "Charleston, West Virginia",
        "wisconsin": "Milwaukee, Wisconsin",
        "wyoming": "Cheyenne, Wyoming",
    }

    is_state_query = False
    state_name = base_query.lower().strip()
    if state_name in US_STATES and not qualifier:
        # Bare US state name — search for its largest city
        is_state_query = True
        search_query = _STATE_CAPITALS[state_name]
        qualifier = state_name
    elif qualifier and base_query.lower().strip() in US_STATES:
        # e.g. "Florida, USA" — the base IS the state
        is_state_query = True
        search_query = _STATE_CAPITALS.get(base_query.lower().strip(), location)
    else:
        search_query = location

    results = await _geocode_query(session, search_query)

    # If no results and query has a comma, retry with just the first part
    if not results and "," in search_query:
        parts = [p.strip() for p in search_query.split(",")]
        city_only = parts[0]
        if not qualifier:
            qualifier = " ".join(parts[1:]).lower()
        results = await _geocode_query(session, city_only)

    if not results:
        return None

    # Pick the best result considering the user's qualifier hint
    r = _pick_best_result(results, qualifier)

    # For state-level queries, display as "Florida, United States" not "Miami, Florida, ..."
    if is_state_query:
        display_name = r.get("admin1", r.get("name", location))
    else:
        display_name = r.get("name", location)

    return {
        "name": display_name,
        "country": r.get("country", ""),
        "admin1": r.get("admin1", "") if not is_state_query else "",
        "latitude": r["latitude"],
        "longitude": r["longitude"],
        "timezone": r.get("timezone", "auto"),
    }


async def _geocode_query(session: aiohttp.ClientSession, query: str) -> list | None:
    """Run a single geocoding query, return results list or None."""
    async with session.get(GEOCODE_URL, params={"name": query, "count": 10, "language": "en"}) as resp:
        if resp.status != 200:
            return None
        data = await resp.json()
        results = data.get("results")
        return results if results else None


US_STATES = {
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
    "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
    "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana",
    "maine", "maryland", "massachusetts", "michigan", "minnesota",
    "mississippi", "missouri", "montana", "nebraska", "nevada",
    "new hampshire", "new jersey", "new mexico", "new york",
    "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
    "pennsylvania", "rhode island", "south carolina", "south dakota",
    "tennessee", "texas", "utah", "vermont", "virginia", "washington",
    "west virginia", "wisconsin", "wyoming",
}


def _normalize_country_qualifier(qualifier: str) -> tuple[str, str | None]:
    """Normalize a country qualifier to a canonical form.

    Returns (normalized_qualifier, country_code_hint).
    The country_code_hint is an ISO 3166-1 alpha-2 code if we can resolve it,
    or None otherwise.
    """
    # Common country aliases → ISO 3166-1 alpha-2 codes
    _COUNTRY_ALIASES: dict[str, str] = {
        # United Kingdom
        "uk": "GB", "u.k.": "GB", "britain": "GB", "great britain": "GB",
        "united kingdom": "GB", "england": "GB", "scotland": "GB",
        "wales": "GB", "northern ireland": "GB",
        # United States
        "us": "US", "usa": "US", "u.s.": "US", "u.s.a.": "US",
        "united states": "US", "united states of america": "US", "america": "US",
        # Common countries with non-obvious codes
        "uae": "AE", "south korea": "KR", "north korea": "KP",
        "czech republic": "CZ", "czechia": "CZ",
        "the netherlands": "NL", "holland": "NL", "netherlands": "NL",
        "new zealand": "NZ", "nz": "NZ",
        "south africa": "ZA",
        "saudi arabia": "SA",
        "ivory coast": "CI",
        "vatican": "VA",
        "republic of ireland": "IE", "eire": "IE",
    }
    ql = qualifier.lower().strip()
    code = _COUNTRY_ALIASES.get(ql)
    if code:
        return ql, code
    # If qualifier is already a 2-letter code, use it directly
    if len(ql) == 2 and ql.isalpha():
        return ql, ql.upper()
    return ql, None


def _pick_best_result(results: list, qualifier: str = "") -> dict:
    """Pick the best geocoding result.

    If the user provided a qualifier (country/region), match against it.
    If the query matches a US state name, prefer results in that US state.
    Otherwise, prefer US results as a tiebreaker (most users are US-based).
    """
    if qualifier:
        ql, country_code_hint = _normalize_country_qualifier(qualifier)

        # If we resolved to a country code, filter by it and pick highest population
        if country_code_hint:
            matching = [r for r in results if r.get("country_code", "").upper() == country_code_hint]
            if matching:
                return max(matching, key=lambda r: r.get("population", 0))

        # Fallback: fuzzy match against country, admin1, country_code fields
        for r in results:
            fields = [
                r.get("country", "").lower(),
                r.get("admin1", "").lower(),
                r.get("country_code", "").lower(),
            ]
            if any(ql in f or f in ql for f in fields if f):
                return r

    # Check if the search term matches a US state name — if so, prefer the
    # result whose admin1 matches that state within the US
    # We check admin1 from the first result to infer the original query
    for r in results:
        admin1 = r.get("admin1", "").lower()
        if (admin1 in US_STATES
                and r.get("country_code", "").upper() == "US"):
            # Found a US result in the matching state — prefer highest population in that state
            state_results = [
                x for x in results
                if x.get("admin1", "").lower() == admin1
                and x.get("country_code", "").upper() == "US"
            ]
            if state_results:
                return max(state_results, key=lambda x: x.get("population", 0))

    # Fallback: prefer US results as most users are US-based
    us_results = [r for r in results if r.get("country_code", "").upper() == "US"]
    if us_results:
        return max(us_results, key=lambda r: r.get("population", 0))

    # No US results — return the top result
    return results[0]


async def _fetch_weather(session: aiohttp.ClientSession, lat: float, lon: float, tz: str = "auto") -> dict | None:
    """Fetch current weather + 5-day forecast from Open-Meteo."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min",
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "mph",
        "timezone": tz,
        "forecast_days": 5,
    }
    async with session.get(FORECAST_URL, params=params) as resp:
        if resp.status != 200:
            return None
        return await resp.json()


def _build_weather_card_html(location_name: str, current: dict, daily: dict, current_units: dict) -> str:
    """Build a self-contained HTML weather card for Wonder Canvas.

    Uses the same design language as the Wonder Canvas template system:
    glass effects, Space Grotesk for data, atmospheric styling.
    Returns complete HTML+CSS (no separate CSS needed).
    """
    wmo = current.get("weather_code", 0)
    desc, emoji, icon = _decode_wmo(wmo)
    temp = current.get("temperature_2m", "?")
    feels = current.get("apparent_temperature", "?")
    humidity = current.get("relative_humidity_2m", "?")
    wind = current.get("wind_speed_10m", "?")

    # Build forecast days
    forecast_html = ""
    days = daily.get("time", [])
    codes = daily.get("weather_code", [])
    highs = daily.get("temperature_2m_max", [])
    lows = daily.get("temperature_2m_min", [])

    day_names = []
    for d in days:
        try:
            from datetime import datetime
            dt = datetime.strptime(d, "%Y-%m-%d")
            day_names.append(dt.strftime("%a"))
        except Exception:
            day_names.append(d)

    for i in range(len(days)):
        fd, fe, fi = _decode_wmo(codes[i] if i < len(codes) else 0)
        hi = highs[i] if i < len(highs) else "?"
        lo = lows[i] if i < len(lows) else "?"
        delay = 0.5 + i * 0.08
        forecast_html += (
            f'<div class="fc-day" style="animation-delay:{delay}s">'
            f'<div class="fc-name">{day_names[i]}</div>'
            f'<div class="fc-icon">{fe}</div>'
            f'<div class="fc-hi">{hi:.0f}°</div>'
            f'<div class="fc-lo">{lo:.0f}°</div>'
            f'</div>'
        )

    return f"""
<style>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500&display=swap');
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:'Inter',sans-serif;background:transparent;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
overflow:hidden}}
@keyframes fu{{from{{opacity:0;transform:translateY(18px)}}to{{opacity:1;transform:translateY(0)}}}}
@keyframes fl{{0%,100%{{transform:translateY(0)}}50%{{transform:translateY(-8px)}}}}
@keyframes orb-drift{{0%,100%{{transform:translate(0,0) scale(1)}}50%{{transform:translate(20px,-15px) scale(1.05)}}}}

.weather-wrap{{position:relative;width:100%;min-height:100vh;display:flex;flex-direction:column;
align-items:center;justify-content:center;text-align:center;overflow:hidden;
background:transparent}}

/* Atmospheric orbs */
.weather-wrap::before,.weather-wrap::after{{content:'';position:absolute;border-radius:50%;
pointer-events:none;animation:orb-drift 12s ease-in-out infinite}}
.weather-wrap::before{{width:340px;height:340px;top:-80px;right:-60px;
background:radial-gradient(circle,rgba(139,92,246,0.15),transparent 70%)}}
.weather-wrap::after{{width:280px;height:280px;bottom:-40px;left:-60px;
background:radial-gradient(circle,rgba(56,189,248,0.12),transparent 70%);animation-delay:-6s}}

.w-icon{{font-size:clamp(44px,12vw,64px);margin-bottom:4px;animation:fl 5s ease-in-out infinite;
filter:drop-shadow(0 4px 16px rgba(0,0,0,.4));position:relative;z-index:2}}
.w-temp{{font-family:'Space Grotesk',sans-serif;font-size:clamp(72px,22vw,110px);
font-weight:700;line-height:1;letter-spacing:-.04em;color:#fff;position:relative;z-index:2;
text-shadow:0 4px 32px rgba(0,0,0,.5);animation:fu .6s .15s both}}
.w-cond{{font-family:'Playfair Display',serif;font-size:clamp(18px,5vw,26px);
color:#e8c547;font-style:italic;font-weight:400;margin:2px 0 6px;position:relative;z-index:2;
text-shadow:0 2px 12px rgba(0,0,0,.5);animation:fu .6s .3s both}}
.w-loc{{font-family:'Space Grotesk',sans-serif;font-size:clamp(11px,3vw,14px);
color:rgba(240,236,228,.9);letter-spacing:.14em;text-transform:uppercase;
position:relative;z-index:2;animation:fu .6s .35s both}}

.w-hero-glass{{position:relative;z-index:2;backdrop-filter:blur(24px) saturate(180%);
-webkit-backdrop-filter:blur(24px) saturate(180%);background:rgba(15,8,32,0.85);
border:1px solid rgba(255,255,255,0.15);border-radius:28px;
box-shadow:0 8px 32px rgba(0,0,0,0.25);padding:clamp(28px,6vw,44px) clamp(24px,5vw,40px);
margin-bottom:8px;animation:fu .5s .05s both}}

/* Detail pills */
.w-details{{display:flex;gap:clamp(8px,3vw,16px);margin-top:28px;position:relative;z-index:2;
animation:fu .6s .45s both;flex-wrap:wrap;justify-content:center}}
.w-pill{{text-align:center;background:rgba(40,40,60,.45);border-radius:12px;
padding:clamp(10px,3vw,14px) clamp(14px,4vw,20px);border:1px solid rgba(255,255,255,.15);
backdrop-filter:blur(12px)}}
.w-pill-val{{font-family:'Space Grotesk',sans-serif;font-size:clamp(15px,3.8vw,18px);
font-weight:600;color:#fff}}
.w-pill-lbl{{font-size:clamp(10px,2.5vw,11px);color:rgba(240,236,228,.7);
text-transform:uppercase;letter-spacing:.06em;margin-top:3px}}

/* Forecast strip */
.w-forecast{{display:flex;justify-content:center;gap:clamp(4px,2vw,12px);
margin-top:28px;position:relative;z-index:2;flex-wrap:wrap}}
.fc-day{{text-align:center;background:rgba(40,40,60,.45);border-radius:10px;
padding:clamp(8px,2vw,12px) clamp(10px,2.5vw,16px);border:1px solid rgba(255,255,255,.15);
backdrop-filter:blur(8px);animation:fu .5s both;min-width:56px}}
.fc-name{{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,11px);
font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:rgba(240,236,228,.8);margin-bottom:4px}}
.fc-icon{{font-size:clamp(16px,4vw,22px);margin-bottom:2px}}
.fc-hi{{font-family:'Space Grotesk',sans-serif;font-size:clamp(13px,3vw,15px);font-weight:600;color:#fff}}
.fc-lo{{font-family:'Space Grotesk',sans-serif;font-size:clamp(11px,2.5vw,12px);color:rgba(240,236,228,.7)}}

@media(max-width:768px){{
  .weather-wrap{{padding-top:100px}}
}}
@media(min-width:769px){{
  .w-temp{{font-size:clamp(100px,14vw,140px)}}
  .w-cond{{font-size:clamp(24px,3.5vw,32px)}}
  .w-loc{{font-size:clamp(14px,1.8vw,16px)}}
  .w-icon{{font-size:clamp(60px,8vw,80px)}}
  .w-pill{{padding:clamp(14px,2vw,20px) clamp(20px,3vw,32px)}}
}}
</style>
<div class="weather-wrap">
  <div class="w-hero-glass">
    <div class="w-icon">{emoji}</div>
    <div class="w-temp">{temp:.0f}°F</div>
    <div class="w-cond">{desc}</div>
    <div class="w-loc">{location_name}</div>
  </div>
  <div class="w-details">
    <div class="w-pill"><div class="w-pill-val">{feels:.0f}°F</div><div class="w-pill-lbl">Feels Like</div></div>
    <div class="w-pill"><div class="w-pill-val">{humidity}%</div><div class="w-pill-lbl">Humidity</div></div>
    <div class="w-pill"><div class="w-pill-val">{wind:.0f} mph</div><div class="w-pill-lbl">Wind</div></div>
  </div>
  <div class="w-forecast">{forecast_html}</div>
</div>"""


# CSS is now inline in the HTML template
WEATHER_CARD_CSS = ""


@bot_tool(
    name="bot_get_weather",
    description=(
        "Get live weather data for any location. Returns current temperature, condition, "
        "humidity, wind speed, feels-like temperature, and a 5-day forecast. "
        "AUTOMATICALLY displays a polished weather card on the Wonder Canvas — "
        "do NOT also call bot_wonder_canvas_template with weather_card (it would overwrite this). "
        "Use when the user asks about weather, temperature, or forecast for any city or place."
    ),
    feature_flag="weather",
    parameters={
        "type": "object",
        "properties": {
            "location": {
                "type": "string",
                "description": "City or place name (e.g., 'Orlando', 'New York', 'Tokyo')",
            },
        },
        "required": ["location"],
    },
    passthrough=False,
)
async def bot_get_weather(params: FunctionCallParams):
    """Fetch weather data and optionally push a Wonder Canvas card."""
    log = bind_tool_logger(params, tag="[bot_get_weather]")
    arguments = params.arguments
    forwarder = params.forwarder

    location = (arguments.get("location") or "").strip()
    log.info("bot_get_weather invoked", location=location)

    if not location:
        await params.result_callback(
            {"success": False, "error": "Location is required."},
            properties=FunctionCallResultProperties(run_llm=True),
        )
        return

    if aiohttp is None:
        await params.result_callback(
            {"success": False, "error": "aiohttp not available"},
            properties=FunctionCallResultProperties(run_llm=True),
        )
        return

    try:
        async with aiohttp.ClientSession() as session:
            # Geocode
            geo = await _geocode(session, location)
            if not geo:
                await params.result_callback(
                    {"success": False, "error": f"Could not find location: {location}"},
                    properties=FunctionCallResultProperties(run_llm=True),
                )
                return

            loc_display = geo["name"]
            if geo.get("admin1"):
                loc_display += f", {geo['admin1']}"
            if geo.get("country"):
                loc_display += f", {geo['country']}"

            # Fetch weather
            weather = await _fetch_weather(session, geo["latitude"], geo["longitude"], geo["timezone"])
            if not weather:
                await params.result_callback(
                    {"success": False, "error": "Failed to fetch weather data."},
                    properties=FunctionCallResultProperties(run_llm=True),
                )
                return

        current = weather.get("current", {})
        daily = weather.get("daily", {})
        current_units = weather.get("current_units", {})

        wmo = current.get("weather_code", 0)
        desc, emoji, icon = _decode_wmo(wmo)

        # Build structured result for LLM
        forecast_list = []
        for i, d in enumerate(daily.get("time", [])):
            fc_desc, _, _ = _decode_wmo(daily["weather_code"][i] if i < len(daily.get("weather_code", [])) else 0)
            forecast_list.append({
                "date": d,
                "condition": fc_desc,
                "high_f": daily["temperature_2m_max"][i] if i < len(daily.get("temperature_2m_max", [])) else None,
                "low_f": daily["temperature_2m_min"][i] if i < len(daily.get("temperature_2m_min", [])) else None,
            })

        result = {
            "success": True,
            "location": loc_display,
            "current": {
                "temperature_f": current.get("temperature_2m"),
                "feels_like_f": current.get("apparent_temperature"),
                "condition": desc,
                "humidity_pct": current.get("relative_humidity_2m"),
                "wind_mph": current.get("wind_speed_10m"),
            },
            "forecast": forecast_list,
        }

        # Emit Wonder Canvas weather card
        if forwarder:
            try:
                html = _build_weather_card_html(loc_display, current, daily, current_units)
                await forwarder.emit_tool_event(
                    events.WONDER_CANVAS_SCENE,
                    {"html": html, "css": WEATHER_CARD_CSS, "transition": "fade"},
                )
                # Cross-tool dedup: mark weather_card template as pushed so a
                # redundant bot_wonder_canvas_template("weather_card") call
                # from the LLM won't overwrite our auto-generated card
                from tools.wonder_canvas import _mark_scene_pushed
                _mark_scene_pushed(tool="scene", template_name="weather_card")
                log.info("Weather canvas card emitted", location=loc_display)
            except Exception as e:
                log.warning("Failed to emit weather canvas", error=str(e))

        log.info("Weather data fetched", location=loc_display, temp=current.get("temperature_2m"))
        await params.result_callback(
            result,
            properties=FunctionCallResultProperties(run_llm=True),
        )

    except Exception as e:
        log.error("bot_get_weather error", error=str(e))
        await params.result_callback(
            {"success": False, "error": f"Weather fetch failed: {str(e)}"},
            properties=FunctionCallResultProperties(run_llm=True),
        )
