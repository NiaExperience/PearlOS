"""
Wonder Canvas Template Library
==============================
Pre-built HTML templates for fast visual content delivery.
Use render_template(name, **kwargs) to populate templates with data.
"""

TEMPLATE_DEFAULTS = {}
TEMPLATE_DESCRIPTIONS = {}

# ---------------------------------------------------------------------------
# Helper: register a template with defaults and description
# ---------------------------------------------------------------------------
TEMPLATES = {}


def _reg(name, desc, html, defaults=None):
    TEMPLATES[name] = html
    TEMPLATE_DESCRIPTIONS[name] = desc
    TEMPLATE_DEFAULTS[name] = defaults or {}


# ---------------------------------------------------------------------------
# COMMON STYLES (injected into every template)
# ---------------------------------------------------------------------------
_BASE_CSS = """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
background:#1a1a2e;color:#e0e0e0;min-height:100vh;padding:clamp(12px,4vw,24px);
display:flex;flex-direction:column;align-items:center;justify-content:flex-start}
.card{width:100%;max-width:420px;background:linear-gradient(135deg,rgba(30,30,60,0.95),rgba(22,33,62,0.95));
border-radius:16px;padding:clamp(16px,5vw,28px);backdrop-filter:blur(10px);
border:1px solid rgba(255,255,255,0.08);animation:wonder-fadeIn 0.6s ease}
.card-title{font-size:clamp(18px,5vw,26px);font-weight:700;margin-bottom:8px;color:#fff}
.card-subtitle{font-size:clamp(12px,3vw,14px);color:rgba(255,255,255,0.5);margin-bottom:12px}
.accent{color:#7c5cfc}.accent2{color:#00d2ff}.accent3{color:#ff6b6b}.accent4{color:#ffd93d}
.tag{display:inline-block;padding:3px 10px;border-radius:20px;font-size:clamp(10px,2.5vw,12px);
background:rgba(124,92,252,0.2);color:#a78bfa;margin:2px}
.glass{background:rgba(255,255,255,0.05);border-radius:12px;padding:12px;border:1px solid rgba(255,255,255,0.06)}
.mt{margin-top:12px}.mb{margin-bottom:12px}
.text-sm{font-size:clamp(11px,2.8vw,13px)}.text-lg{font-size:clamp(16px,4.5vw,22px)}
.text-muted{color:rgba(255,255,255,0.45)}
.bar-track{height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;width:100%}
.bar-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#7c5cfc,#00d2ff)}
img.cover{width:100%;border-radius:12px;object-fit:cover;margin-bottom:12px}
.list-item{padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:clamp(13px,3.2vw,15px)}
.list-item:last-child{border-bottom:none}
.choice-btn{display:block;width:100%;padding:12px 16px;margin-top:8px;border-radius:12px;
background:rgba(124,92,252,0.15);border:1px solid rgba(124,92,252,0.3);color:#e0e0e0;
font-size:clamp(13px,3.2vw,15px);text-align:left;cursor:pointer;transition:all 0.2s}
.star{color:#ffd93d}
</style>
"""

# ===========================
# INFORMATION CARDS (5)
# ===========================

_reg("weather_card", "Weather display with temperature, condition, and forecast bars", _BASE_CSS + """
<div class="card">
  <div style="display:flex;flex-direction:column;align-items:center;text-align:center">
    <div class="text-muted mb">{location}</div>
    <div style="font-size:clamp(48px,14vw,72px);font-weight:200;color:#fff">{temperature}</div>
    <div class="text-lg mb" style="color:#a78bfa">{condition}</div>
  </div>
  <div class="glass mt" style="display:flex;flex-direction:column;gap:8px">
    {forecast_bars}
  </div>
</div>
""", {"location": "Current Location", "temperature": "--°", "condition": "Unknown",
      "forecast_bars": '<div class="list-item text-sm">No forecast data</div>'})

_reg("news_headline", "News headline card with source and summary", _BASE_CSS + """
<div class="card">
  <div class="tag mb">{source}</div>
  <div class="card-title">{headline}</div>
  <div class="text-sm text-muted mb">{timestamp}</div>
  <div style="font-size:clamp(13px,3.2vw,15px);line-height:1.6;color:rgba(255,255,255,0.75)">{summary}</div>
</div>
""", {"headline": "Breaking News", "source": "News", "summary": "", "timestamp": ""})

_reg("person_bio", "Biography card with name, title, and key facts", _BASE_CSS + """
<div class="card" style="text-align:center">
  <div style="width:80px;height:80px;border-radius:50%;margin:0 auto 12px;overflow:hidden;border:2px solid rgba(124,92,252,0.4)">
    <img src="{photo_url}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'">
  </div>
  <div class="card-title">{name}</div>
  <div class="card-subtitle">{title}</div>
  <div class="text-sm mb" style="line-height:1.6;color:rgba(255,255,255,0.7)">{bio}</div>
  <div class="glass mt">{key_facts}</div>
</div>
""", {"name": "Unknown", "photo_url": "", "title": "", "bio": "", "key_facts": ""})

_reg("fact_card", "Fun fact display with category badge", _BASE_CSS + """
<div class="card" style="text-align:center">
  <div class="tag mb">{category}</div>
  <div style="margin:16px 0"><span class="w-icon--lg w-icon--glow">{{icon:sparkle}}</span></div>
  <div class="card-title">{title}</div>
  <div class="mt" style="font-size:clamp(14px,3.5vw,16px);line-height:1.7;color:rgba(255,255,255,0.8)">{fact_text}</div>
  <div class="text-sm text-muted mt">{source}</div>
</div>
""", {"title": "Did You Know?", "fact_text": "", "category": "Fun Fact", "source": ""})

_reg("definition_card", "Dictionary-style word definition", _BASE_CSS + """
<div class="card">
  <div class="card-title" style="font-size:clamp(24px,7vw,36px)">{word}</div>
  <div class="text-sm text-muted mb">{pronunciation} &middot; {part_of_speech}</div>
  <div class="glass">
    <div style="font-size:clamp(14px,3.5vw,16px);line-height:1.7">{definition}</div>
  </div>
  <div class="mt text-sm" style="color:rgba(255,255,255,0.5);font-style:italic">"{example_sentence}"</div>
</div>
""", {"word": "word", "pronunciation": "", "part_of_speech": "noun", "definition": "", "example_sentence": ""})

# ===========================
# MEDIA & ENTERTAINMENT (5)
# ===========================

_reg("movie_card", "Movie info card with rating and synopsis", _BASE_CSS + """
<div class="card">
  <img class="cover" src="{poster_url}" style="max-height:200px" onerror="this.style.display='none'">
  <div class="card-title">{title}</div>
  <div class="card-subtitle">{year} &middot; {genre}</div>
  <div style="margin:8px 0"><span class="star">{{icon:star}}</span> <span style="color:#ffd93d;font-weight:600">{rating}</span></div>
  <div class="text-sm" style="line-height:1.6;color:rgba(255,255,255,0.7)">{synopsis}</div>
</div>
""", {"title": "Movie", "poster_url": "", "rating": "N/A", "year": "", "genre": "", "synopsis": ""})

_reg("music_now_playing", "Now playing music card with progress bar", _BASE_CSS + """
<div class="card" style="text-align:center">
  <div style="width:160px;height:160px;border-radius:12px;margin:0 auto 16px;overflow:hidden;border:2px solid rgba(124,92,252,0.3)">
    <img src="{album_art_url}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'">
  </div>
  <div class="card-title">{track}</div>
  <div class="card-subtitle">{artist}</div>
  <div class="mt" style="width:100%">
    <div class="bar-track"><div class="bar-fill" style="width:{progress}%"></div></div>
    <div style="display:flex;justify-content:space-between;margin-top:4px" class="text-sm text-muted">
      <span>{elapsed}</span><span>{duration}</span>
    </div>
  </div>
</div>
""", {"track": "Unknown Track", "artist": "Unknown Artist", "album_art_url": "", "progress": "0", "elapsed": "0:00", "duration": "0:00"})

_reg("recipe_card", "Recipe with cook time, ingredients, and steps", _BASE_CSS + """
<div class="card">
  <img class="cover" src="{image_url}" style="max-height:180px" onerror="this.style.display='none'">
  <div class="card-title">{dish_name}</div>
  <div class="card-subtitle">{{icon:flame}} {cook_time}</div>
  <div class="glass mt mb">
    <div class="text-sm" style="color:#a78bfa;font-weight:600;margin-bottom:6px">Ingredients</div>
    {ingredients}
  </div>
  <div class="glass">
    <div class="text-sm" style="color:#00d2ff;font-weight:600;margin-bottom:6px">Steps</div>
    {steps}
  </div>
</div>
""", {"dish_name": "Recipe", "image_url": "", "cook_time": "-- min", "ingredients": "", "steps": ""})

_reg("book_card", "Book info card with rating and synopsis", _BASE_CSS + """
<div class="card">
  <div style="text-align:center;margin-bottom:12px">
    <img src="{cover_url}" style="height:180px;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.4)" onerror="this.style.display='none'">
  </div>
  <div class="card-title">{title}</div>
  <div class="card-subtitle">by {author}</div>
  <div style="margin:8px 0"><span class="star">{{icon:star}}</span> <span style="color:#ffd93d">{rating}</span></div>
  <div class="text-sm" style="line-height:1.6;color:rgba(255,255,255,0.7)">{synopsis}</div>
</div>
""", {"title": "Book", "author": "Unknown", "cover_url": "", "rating": "N/A", "synopsis": ""})

_reg("game_scoreboard", "Game scoreboard with teams and scores", _BASE_CSS + """
<div class="card" style="text-align:center">
  <div class="card-subtitle">{game_name}</div>
  <div class="mt mb" style="font-size:clamp(11px,2.8vw,13px);color:rgba(255,255,255,0.4)">SCOREBOARD</div>
  <div class="glass">{scores}</div>
</div>
""", {"game_name": "Game", "scores": '<div class="list-item">No scores yet</div>'})

# ===========================
# INTERACTIVE & FUN (5)
# ===========================

_reg("quiz_question", "Quiz question with selectable options", _BASE_CSS + """
<div class="card">
  <div class="tag mb">{category}</div>
  <div class="card-title" style="line-height:1.4">{question}</div>
  <div class="mt">{options}</div>
</div>
""", {"question": "Question?", "category": "Trivia", "options": ""})

_reg("poll", "Poll with vote bars", _BASE_CSS + """
<div class="card">
  <div class="card-title" style="line-height:1.4">{question}</div>
  <div class="mt">{options}</div>
</div>
""", {"question": "What do you think?", "options": ""})

_reg("story_choice", "Interactive story with narrative and choice buttons", _BASE_CSS + """
<div class="card">
  <div style="font-size:clamp(14px,3.5vw,16px);line-height:1.8;color:rgba(255,255,255,0.85);margin-bottom:16px">{narrative_text}</div>
  <div>{choices}</div>
</div>
""", {"narrative_text": "The story unfolds...", "choices": ""})

_reg("countdown_timer", "Countdown timer with animated display", _BASE_CSS + """
<div class="card" style="text-align:center">
  <div class="card-subtitle mb">{event_name}</div>
  <div style="font-size:clamp(36px,10vw,56px);font-weight:200;color:#fff;letter-spacing:4px;animation:wonder-pulse 2s infinite">{countdown_display}</div>
  <div class="text-sm text-muted mt">{target_date}</div>
</div>
""", {"event_name": "Countdown", "countdown_display": "00:00:00", "target_date": ""})

_reg("achievement_unlocked", "Achievement/badge unlocked notification", _BASE_CSS + """
<div class="card" style="text-align:center;border:1px solid rgba(255,217,61,0.3)">
  <div style="animation:wonder-bounce 0.8s ease">
    <div style="margin:8px 0"><span class="w-icon--xl w-icon--glow">{icon}</span></div>
  </div>
  <div class="text-sm" style="color:#ffd93d;font-weight:600;letter-spacing:2px;margin:8px 0">ACHIEVEMENT UNLOCKED</div>
  <div class="card-title">{title}</div>
  <div class="text-sm text-muted">{description}</div>
  <div class="tag mt" style="background:rgba(255,217,61,0.15);color:#ffd93d">{rarity}</div>
</div>
""", {"title": "Achievement", "description": "", "icon": "{{icon:trophy}}", "rarity": "Common"})

# ===========================
# MATH & CALCULATION (1)
# ===========================

_reg("calculator", "Show math work with expression, step-by-step breakdown, and final result", _BASE_CSS + """
<div class="card">
  <div class="card-subtitle mb" style="letter-spacing:2px">CALCULATION</div>
  <div class="glass mb" style="text-align:right;padding:16px">
    <div class="text-sm text-muted mb">{expression}</div>
    <div style="font-size:clamp(32px,9vw,48px);font-weight:200;color:#fff">{result}</div>
  </div>
  <div class="glass">
    <div class="text-sm" style="color:#a78bfa;font-weight:600;margin-bottom:8px">Work</div>
    {steps}
  </div>
</div>
""", {"expression": "", "result": "0", "steps": ""})

# ===========================
# DATA & VISUAL (5)
# ===========================

_reg("comparison_table", "Comparison of items with attributes", _BASE_CSS + """
<div class="card">
  <div class="card-title mb">{title}</div>
  {items}
</div>
""", {"title": "Comparison", "items": ""})

_reg("timeline", "Vertical timeline of events", _BASE_CSS + """
<div class="card">
  <div class="card-title mb">{title}</div>
  <div style="border-left:2px solid rgba(124,92,252,0.4);padding-left:16px;margin-left:8px">{events}</div>
</div>
""", {"title": "Timeline", "events": ""})

_reg("stat_dashboard", "Stats dashboard with values and trends", _BASE_CSS + """
<div class="card">
  <div class="card-title mb">{title}</div>
  <div style="display:flex;flex-direction:column;gap:8px">{stats}</div>
</div>
""", {"title": "Dashboard", "stats": ""})

_reg("progress_tracker", "Step-by-step progress tracker", _BASE_CSS + """
<div class="card">
  <div class="card-title mb">{title}</div>
  <div>{steps}</div>
</div>
""", {"title": "Progress", "steps": ""})

_reg("location_card", "Location card with description and fun fact", _BASE_CSS + """
<div class="card">
  <img class="cover" src="{image_url}" style="max-height:180px" onerror="this.style.display='none'">
  <div class="card-title">{place_name}</div>
  <div class="card-subtitle">{coordinates}</div>
  <div class="text-sm mt" style="line-height:1.6;color:rgba(255,255,255,0.75)">{description}</div>
  <div class="glass mt">
    <div class="text-sm" style="color:#ffd93d">{{icon:sparkle}} {fun_fact}</div>
  </div>
</div>
""", {"place_name": "Location", "image_url": "", "description": "", "coordinates": "", "fun_fact": ""})

# ===========================
# UTILITY (5)
# ===========================

_reg("greeting_card", "Personalized greeting with quote and weather hint", _BASE_CSS + """
<div class="card" style="text-align:center">
  <div class="text-lg" style="color:rgba(255,255,255,0.5)">{time_of_day}</div>
  <div style="font-size:clamp(24px,7vw,36px);font-weight:700;color:#fff;margin:8px 0">{user_name}</div>
  <div class="glass mt" style="font-style:italic;line-height:1.6;color:rgba(255,255,255,0.7)">"{motivational_quote}"</div>
  <div class="text-sm text-muted mt">{weather_hint}</div>
</div>
""", {"time_of_day": "Hello", "user_name": "Friend", "motivational_quote": "Every day is a new beginning.", "weather_hint": ""})

_reg("error_card", "Error display with suggestion", _BASE_CSS + """
<div class="card" style="border:1px solid rgba(255,107,107,0.3)">
  <div style="margin-bottom:8px"><span class="w-icon--lg" style="color:#ff6b6b">{{icon:x}}</span></div>
  <div class="card-title" style="color:#ff6b6b">{error_title}</div>
  <div class="text-sm mt" style="line-height:1.6;color:rgba(255,255,255,0.7)">{error_message}</div>
  <div class="glass mt">
    <div class="text-sm" style="color:#a78bfa">{{icon:sparkle}} {suggestion}</div>
  </div>
</div>
""", {"error_title": "Something went wrong", "error_message": "", "suggestion": "Try again in a moment."})

_reg("loading_card", "Loading spinner with message", _BASE_CSS + """
<div class="card" style="text-align:center;padding:40px 20px">
  <div style="animation:wonder-pulse 1.5s infinite ease-in-out">
    <span class="w-icon--xl w-icon--glow w-icon--spin">{{icon:sparkle}}</span>
  </div>
  <div class="text-lg mt" style="color:rgba(255,255,255,0.7)">{message}</div>
</div>
""", {"message": "Loading..."})

_reg("list_card", "Simple list display with title", _BASE_CSS + """
<div class="card">
  <div class="card-title mb">{title}</div>
  <div>{items}</div>
</div>
""", {"title": "List", "items": ""})

_reg("image_showcase", "Full image showcase with caption", _BASE_CSS + """
<div class="card">
  <img class="cover" src="{image_url}" style="max-height:250px" onerror="this.style.display='none'">
  <div class="card-title">{title}</div>
  <div class="text-sm mt" style="color:rgba(255,255,255,0.5)">{caption}</div>
  <div class="text-sm mt" style="line-height:1.6;color:rgba(255,255,255,0.7)">{description}</div>
</div>
""", {"title": "", "image_url": "", "caption": "", "description": ""})


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_template_names():
    """Return list of available template names."""
    return list(TEMPLATES.keys())


def get_template_description(name):
    """Return one-line description for a template."""
    return TEMPLATE_DESCRIPTIONS.get(name, "Unknown template")


def render_template(name, **kwargs):
    """Render a template by name, filling placeholders with kwargs or defaults."""
    if name not in TEMPLATES:
        raise ValueError(f"Unknown template: {name}. Available: {', '.join(TEMPLATES.keys())}")
    template = TEMPLATES[name]
    defaults = TEMPLATE_DEFAULTS.get(name, {})
    merged = {**defaults, **kwargs}
    # Use safe formatting - replace known placeholders, leave {{icon:...}} alone
    # We do manual replacement to avoid issues with CSS braces
    result = template
    for key, value in merged.items():
        result = result.replace("{" + key + "}", str(value))
    return result


# ---------------------------------------------------------------------------
# List builder helpers (for templates that accept list HTML)
# ---------------------------------------------------------------------------

def build_list_items(items, numbered=False):
    """Build HTML list items from a Python list."""
    html = ""
    for i, item in enumerate(items, 1):
        prefix = f'<span class="accent" style="margin-right:6px">{i}.</span>' if numbered else '<span class="accent" style="margin-right:6px">{{icon:arrowRight}}</span>'
        html += f'<div class="list-item">{prefix}{item}</div>'
    return html


def build_choice_buttons(choices):
    """Build choice button HTML from a list of (label, action) tuples."""
    html = ""
    for label, action in choices:
        html += f'<button class="choice-btn" data-action="{action}">{label}</button>'
    return html


def build_poll_options(options):
    """Build poll options with vote bars from list of (label, percent) tuples."""
    html = ""
    for label, pct in options:
        html += f'''<div style="margin-bottom:10px">
<div style="display:flex;justify-content:space-between;margin-bottom:4px" class="text-sm"><span>{label}</span><span class="text-muted">{pct}%</span></div>
<div class="bar-track"><div class="bar-fill" style="width:{pct}%"></div></div></div>'''
    return html


def build_quiz_options(options):
    """Build quiz option buttons from list of (label, action) tuples."""
    letters = "ABCDEFGH"
    html = ""
    for i, (label, action) in enumerate(options):
        letter = letters[i] if i < len(letters) else str(i+1)
        html += f'<button class="choice-btn" data-action="{action}"><span class="accent" style="margin-right:8px;font-weight:700">{letter}</span>{label}</button>'
    return html


def build_stat_items(stats):
    """Build stat items from list of (label, value, trend_icon) tuples."""
    html = ""
    for label, value, trend in stats:
        html += f'<div class="glass" style="display:flex;flex-direction:column;padding:10px"><div class="text-sm text-muted">{label}</div><div style="font-size:clamp(20px,6vw,28px);font-weight:700;color:#fff">{value}</div><div class="text-sm" style="color:#a78bfa">{trend}</div></div>'
    return html


def build_timeline_events(events):
    """Build timeline events from list of (date, description) tuples."""
    html = ""
    for date, desc in events:
        html += f'<div style="margin-bottom:16px"><div class="text-sm accent" style="font-weight:600">{date}</div><div class="text-sm" style="color:rgba(255,255,255,0.75);margin-top:2px">{desc}</div></div>'
    return html


def build_progress_steps(steps):
    """Build progress steps from list of (label, completed_bool) tuples."""
    html = ""
    for label, done in steps:
        icon = "{{icon:check}}" if done else "{{icon:minus}}"
        color = "color:#a78bfa" if done else "color:rgba(255,255,255,0.35)"
        html += f'<div class="list-item" style="{color}">{icon} <span style="margin-left:8px">{label}</span></div>'
    return html


def build_forecast_bars(forecasts):
    """Build forecast bars from list of (day, high, low) tuples."""
    html = ""
    for day, high, low in forecasts:
        html += f'<div style="display:flex;justify-content:space-between;align-items:center" class="list-item text-sm"><span>{day}</span><span class="text-muted">{low}°</span><div class="bar-track" style="width:40%;margin:0 8px"><div class="bar-fill" style="width:{min(100,max(0,(int(high)-int(low))*5))}%"></div></div><span>{high}°</span></div>'
    return html


def build_comparison_items(items):
    """Build comparison items from list of dicts with 'name' and 'attributes' keys."""
    html = ""
    for item in items:
        attrs = "".join(f'<div class="text-sm" style="color:rgba(255,255,255,0.6);margin-top:2px">{k}: <span style="color:#fff">{v}</span></div>' for k, v in item.get("attributes", {}).items())
        html += f'<div class="glass mb"><div style="font-weight:600;color:#a78bfa">{item.get("name","")}</div>{attrs}</div>'
    return html


def build_scoreboard(entries):
    """Build scoreboard from list of (name, score) tuples."""
    html = ""
    for i, (name, score) in enumerate(entries, 1):
        medal = "{{icon:trophy}}" if i == 1 else ""
        html += f'<div class="list-item" style="display:flex;justify-content:space-between"><span>{medal} {name}</span><span style="font-weight:700;color:#fff">{score}</span></div>'
    return html
