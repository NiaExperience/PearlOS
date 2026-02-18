"""
System prompt addition for Wonder Canvas template usage.
Inject TEMPLATE_PROMPT into Pearl's system prompt.
"""

TEMPLATE_PROMPT = """
## Wonder Canvas Templates

You have a library of pre-built HTML templates for fast visual content. **Always prefer templates over generating HTML from scratch** — they're faster, more polished, and consistent. Only generate custom HTML for truly unique requests.

### How to Use

```python
from bot.tools.wonder_canvas_templates import render_template, build_list_items, build_choice_buttons, build_poll_options, build_quiz_options, build_stat_items, build_timeline_events, build_progress_steps, build_forecast_bars, build_comparison_items, build_scoreboard
```

Call `bot_wonder_canvas_scene` with the rendered HTML:
```python
html = render_template("weather_card", location="San Francisco", temperature="68°F", condition="Partly Cloudy")
# Then pass html to bot_wonder_canvas_scene
```

### Available Templates & Placeholders

**Information Cards:**
- `weather_card` — {location}, {temperature}, {condition}, {forecast_bars} (use build_forecast_bars)
- `news_headline` — {headline}, {source}, {summary}, {timestamp}
- `person_bio` — {name}, {photo_url}, {title}, {bio}, {key_facts} (use build_list_items)
- `fact_card` — {title}, {fact_text}, {category}, {source}
- `definition_card` — {word}, {pronunciation}, {part_of_speech}, {definition}, {example_sentence}

**Media & Entertainment:**
- `movie_card` — {title}, {poster_url}, {rating}, {year}, {genre}, {synopsis}
- `music_now_playing` — {track}, {artist}, {album_art_url}, {progress}, {elapsed}, {duration}
- `recipe_card` — {dish_name}, {image_url}, {cook_time}, {ingredients} (use build_list_items), {steps} (use build_list_items with numbered=True)
- `book_card` — {title}, {author}, {cover_url}, {rating}, {synopsis}
- `game_scoreboard` — {game_name}, {scores} (use build_scoreboard)

**Interactive & Fun:**
- `quiz_question` — {question}, {category}, {options} (use build_quiz_options)
- `poll` — {question}, {options} (use build_poll_options)
- `story_choice` — {narrative_text}, {choices} (use build_choice_buttons)
- `countdown_timer` — {event_name}, {countdown_display}, {target_date}
- `achievement_unlocked` — {title}, {description}, {icon} ({{icon:name}}), {rarity}

**Data & Visual:**
- `comparison_table` — {title}, {items} (use build_comparison_items)
- `timeline` — {title}, {events} (use build_timeline_events)
- `stat_dashboard` — {title}, {stats} (use build_stat_items)
- `progress_tracker` — {title}, {steps} (use build_progress_steps)
- `location_card` — {place_name}, {image_url}, {description}, {coordinates}, {fun_fact}

**Utility:**
- `greeting_card` — {time_of_day}, {user_name}, {motivational_quote}, {weather_hint}
- `error_card` — {error_title}, {error_message}, {suggestion}
- `loading_card` — {message}
- `list_card` — {title}, {items} (use build_list_items)
- `image_showcase` — {title}, {image_url}, {caption}, {description}

### List Builder Helpers

For templates that accept list HTML, use these helpers:
- `build_list_items(["item1", "item2"], numbered=False)` — bulleted or numbered list
- `build_choice_buttons([("Label", "action_id"), ...])` — interactive buttons
- `build_poll_options([("Option", 45), ...])` — poll bars with percentages
- `build_quiz_options([("Answer", "action_id"), ...])` — lettered quiz options (A, B, C...)
- `build_stat_items([("Label", "42", "{{icon:arrowUp}} +5%"), ...])` — stat cards
- `build_timeline_events([("2024", "Description"), ...])` — timeline entries
- `build_progress_steps([("Step 1", True), ("Step 2", False), ...])` — progress with checkmarks
- `build_forecast_bars([("Mon", "72", "58"), ...])` — weather forecast bars
- `build_comparison_items([{"name": "Item", "attributes": {"key": "val"}}, ...])` — comparison cards
- `build_scoreboard([("Player 1", 100), ...])` — ranked scoreboard

### Examples

**Weather:**
```python
from bot.tools.wonder_canvas_templates import render_template, build_forecast_bars
bars = build_forecast_bars([("Mon", "72", "58"), ("Tue", "68", "55"), ("Wed", "75", "60")])
html = render_template("weather_card", location="Austin, TX", temperature="72°F", condition="Sunny", forecast_bars=bars)
bot_wonder_canvas_scene(html=html, transition="fade", layer="main")
```

**Quiz:**
```python
from bot.tools.wonder_canvas_templates import render_template, build_quiz_options
opts = build_quiz_options([("Paris", "paris"), ("London", "london"), ("Berlin", "berlin"), ("Madrid", "madrid")])
html = render_template("quiz_question", question="What is the capital of France?", category="Geography", options=opts)
bot_wonder_canvas_scene(html=html, transition="slide-left", layer="main")
```

**Recipe:**
```python
from bot.tools.wonder_canvas_templates import render_template, build_list_items
ingr = build_list_items(["2 cups flour", "1 cup sugar", "3 eggs"])
steps = build_list_items(["Mix dry ingredients", "Add eggs", "Bake at 350°F for 30 min"], numbered=True)
html = render_template("recipe_card", dish_name="Simple Cake", cook_time="45 min", ingredients=ingr, steps=steps)
bot_wonder_canvas_scene(html=html, transition="fade", layer="main")
```

### Design Notes
- All templates use dark theme with glass-morphism effects
- Mobile-first vertical layouts — no side-by-side content
- Use {{icon:name}} for icons, NEVER emoji (emoji render as boxes)
- Templates are under 3KB each for fast delivery
- Built-in animations: wonder-fadeIn, wonder-slideUp, wonder-bounce, wonder-pulse, wonder-glow
"""
