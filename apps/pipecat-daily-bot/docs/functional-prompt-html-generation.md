# Functional Prompt: HTML Generation

**Feature key**: `bot_create_app_from_description`

**Context**: This is the comprehensive functional prompt used for HTML app/game/tool generation in the Nia Universal platform. This prompt is currently embedded in the interface's HTML generation actions but should be seeded into Prism as a `FunctionalPrompt` record for runtime access by the bot.

**Intended use**: Seed this exact text into the `promptContent` field for the `FunctionalPrompt` record with `featureKey = "bot_create_app_from_description"`.

---

Create a complete, self-contained HTML file based on the following requirements.

Description: {description}
{featuresText}
Original user request: "{userRequest}"

CRITICAL REQUIREMENTS:
1. Create a SINGLE HTML file with embedded CSS and JavaScript
2. DO NOT include any title, heading, or heading element (no h1, h2, h3, etc.) in the HTML content
3. Do NOT include any contentType labels or badges in the HTML
4. Start the content directly with the functional elements (game board, app interface, etc.)
5. Make it visually appealing with modern styling (gradients, shadows, animations)
6. Ensure it's fully functional and interactive
7. Use a beautiful color scheme and responsive design
8. Include proper logic, event handling, and user feedback
9. Add inline SVG icons and visual polish (NO EMOJI - use WonderIcons library)
10. Make it mobile-friendly
11. All code must be in ONE file - no external dependencies
12. DO NOT use any external resources (no external images, fonts, APIs, or placeholder services)
13. All visual assets must be created with CSS, SVG, or Canvas - no external URLs

WONDER ICONS - INLINE SVG ICON LIBRARY:
DO NOT use emoji characters (🌲 ✨ 🏃 etc.) - they render as boxes in headless browsers and inconsistently on mobile.
Instead, use {{icon:name}} placeholders — the canvas runtime auto-resolves them to inline SVGs.

Example: <button class="wonder-choice">{{icon:tree}} Enter Forest</button>
With classes: {{icon:star:w-icon--lg w-icon--glow}}

Available icons: tree, cave, tower, mountain, castle, sparkle, run, sword, shield, bow, wand,
crystal, gem, potion, scroll, key, chest, heart, star, zap, flame, trophy, coin,
dragon, wolf, sun, moon, cloud, arrowUp, arrowDown, arrowLeft, arrowRight, check, x, plus, minus.

Size classes: w-icon--sm, w-icon--md, w-icon--lg, w-icon--xl
Effect classes: w-icon--glow, w-icon--spin, w-icon--pulse

The WonderIcons JS library is also available globally in the iframe for advanced use.
Include this script at the top of your HTML (after opening <body> tag):
```html
<script>
// WonderIcons library - inline SVG icons (no external dependencies)
const WonderIcons = {
  tree: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L8 8h8l-4-6zm0 6L7 14h10l-5-6zm0 6v6m-2 0h4"/></svg>',
  cave: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20h18v-4c0-2-1-4-3-5 1-2 0-4-2-5-1-1-3-1-4 0-1-1-3-1-4 0-2 1-3 3-2 5-2 1-3 3-3 5v4z"/></svg>',
  tower: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="2" width="12" height="20" rx="1"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/><rect x="10" y="18" width="4" height="4"/></svg>',
  sparkle: '<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5z"/><path d="M19 15l.5 2.5L22 18l-2.5.5L19 21l-.5-2.5L16 18l2.5-.5z"/><path d="M5 3l.5 1.5L7 5l-1.5.5L5 7l-.5-1.5L3 5l1.5-.5z"/></svg>',
  run: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="5" r="2"/><path d="M13 8l-4 4m0 0l-3 3m3-3l2 6m-6-4l2-2"/><path d="M20 12l-3-3"/></svg>',
  sword: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 3L5 17m0 0l-2 2 2 2 2-2m-2-2l2-2"/><path d="M17.5 6.5L19 5"/></svg>',
  shield: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L4 6v6c0 5 3 9 8 10 5-1 8-5 8-10V6l-8-4z"/></svg>',
  crystal: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L6 8h12l-6-6zm0 0v6m-6 0L4 22h16l-2-14H6z"/><line x1="12" y1="8" x2="12" y2="22"/></svg>',
  heart: '<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
  star: '<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  zap: '<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z"/></svg>',
  flame: '<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c-1 3-2 4-4 6-2 2-3 5-3 7 0 4.42 3.58 8 8 8s8-3.58 8-8c0-2-1-5-3-7-2-2-3-3-4-6h-2z"/></svg>',
  check: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
  x: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  arrowRight: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
  get: function(name, cls) { 
    const icon = this[name]; 
    if (!icon) return ''; 
    return cls ? icon.replace('w-icon', 'w-icon ' + cls) : icon; 
  }
};
</script>
<style>
.w-icon { display:inline-block; width:1.25em; height:1.25em; vertical-align:-0.25em; stroke-linecap:round; stroke-linejoin:round; }
.w-icon--sm { width:1em; height:1em; }
.w-icon--lg { width:2em; height:2em; }
.w-icon--xl { width:3em; height:3em; }
.w-icon--glow { filter:drop-shadow(0 0 8px currentColor); }
.w-icon--spin { animation:wIconSpin 2s linear infinite; }
@keyframes wIconSpin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
</style>
```

Usage in HTML:
- Buttons: `<button>${WonderIcons.get('tree')} Enter Forest</button>`
- Headings: `<h1>${WonderIcons.get('sparkle', 'w-icon--lg w-icon--glow')} You Win!</h1>`
- Stats: `<div>${WonderIcons.get('heart')} HP: 100 ${WonderIcons.get('zap')} XP: 420</div>`

Available icons: tree, cave, tower, mountain, castle, sparkle, run, sword, shield, bow, wand, crystal, gem, potion, scroll, key, chest, heart, star, zap, flame, trophy, coin, dragon, wolf, sun, moon, cloud, check, x, plus, minus, arrowUp, arrowDown, arrowLeft, arrowRight

Size classes: w-icon--sm, w-icon--lg, w-icon--xl
Effect classes: w-icon--glow, w-icon--spin

DATA PERSISTENCE - APPLET API:
Use the built-in Applet API (see STORAGE LIBRARY APPENDIX below) whenever the experience benefits from persisted state. The appendix includes the NiaAPI helper and button/validation rules; embed the NiaAPI helper snippet (attach it to window.api) near the top of the HTML so storage calls always work, and then use that helper for persistence (only skip if truly no state needs saving).

CRITICAL JAVASCRIPT REQUIREMENTS:
- ALL JavaScript functions MUST be defined in the global scope (window object)
- Use window.functionName = function() { ... } for ALL functions
- EVERY button MUST have a working click handler - no decorative buttons allowed
- EVERY form input MUST have proper event handling and validation
- EVERY interactive element MUST actually perform its intended function
- Use addEventListener('click', ...) or onclick with global functions
- Ensure DOMContentLoaded is used for initialization: document.addEventListener('DOMContentLoaded', function() { ... });
- ALL buttons must have meaningful functionality that matches their text/purpose
- Include proper error handling and structured logging for debugging
- Ensure all functions are accessible and properly bound to DOM elements
- NO PLACEHOLDER or non-functional buttons - everything must work

CRITICAL FORM VALIDATION REQUIREMENTS:
- Always show generic error messages like "Please match the requested format"
- ALWAYS provide specific, helpful format examples for each input field
- For phone numbers: Show format like "Format: (555) 123-4567 or 555-123-4567"
- For dates: Show format like "Format: MM/DD/YYYY or YYYY-MM-DD"
- For emails: Show format like "Format: user@example.com"
- For credit cards: Show format like "Format: 1234 5678 9012 3456"
- For postal codes: Show format like "Format: 12345 or 12345-6789"
- Include placeholder text that demonstrates the expected format
- Use HTML5 input types (tel, email, date, etc.) with appropriate patterns
- Provide real-time validation feedback as users type
- Show format examples in tooltips, help text, or placeholder attributes
- Make error messages specific and actionable
- Use visual indicators (colors, icons) to show validation status

Guidelines:
- For games: Include scoring, game over conditions, restart functionality, controls
- For apps: Include full CRUD operations and use the NiaAPI storage library for persistence; reserve localStorage for tiny, non-critical caches only
- For tools: Include multiple features, export/import if relevant
- For interactive: Include engaging animations, feedback, progress tracking

APPENDICES:
- APPENDIX A - STORAGE LIBRARY: NiaAPI helper plus button/validation rules (reference only; do not include in final HTML)

UNIVERSAL BUTTON FUNCTIONALITY REQUIREMENTS:
- If a button says "Start Game" - it must actually start a game
- If a button says "Add Item" - it must actually add an item
- If a button says "Calculate" - it must actually perform calculations
- If a button says "Save" - it must actually save data via the NiaAPI storage library or equivalent persisted state (localStorage only for trivial UI hints)
- If a button says "Reset" - it must actually reset the application
- If a button says "Submit" - it must actually process the form
- Use proper event delegation for dynamically created buttons
- Store application state via the NiaAPI storage library; use localStorage only for lightweight session UI hints
- Provide user feedback for all button actions (visual/text changes)

MANDATORY BUTTON PATTERNS - CHOOSE APPROPRIATE:
Pattern 1 (Direct onclick):
<button onclick="performAction()" id="actionBtn">Action</button>

Pattern 2 (Event listener):
<button id="actionBtn">Action</button>
<script>
document.getElementById('actionBtn').addEventListener('click', performAction);
</script>

Pattern 3 (Event delegation for dynamic buttons):
<script>
document.addEventListener('click', function(e) {
  if (e.target.matches('.dynamic-btn')) {
    performAction(e.target);
  }
});
</script>

FORM VALIDATION EXAMPLES - USE THESE PATTERNS:
For Phone Number Input:
<input type="tel" placeholder="(555) 123-4567" pattern="[0-9 ()-]+" title="Format: (555) 123-4567 or 555-123-4567">
<div class="format-hint">Format: (555) 123-4567 or 555-123-4567</div>

For Date Input:
<input type="date" placeholder="YYYY-MM-DD" title="Format: YYYY-MM-DD">
<div class="format-hint">Format: YYYY-MM-DD</div>

For Email Input:
<input type="email" placeholder="user@example.com" title="Format: user@example.com">
<div class="format-hint">Format: user@example.com</div>

For Credit Card Input:
<input type="text" placeholder="1234 5678 9012 3456" pattern="[0-9\\s]+" maxlength="19" title="Format: 1234 5678 9012 3456">
<div class="format-hint">Format: 1234 5678 9012 3456</div>

For Postal Code Input:
<input type="text" placeholder="12345" pattern="[0-9\\-]+" title="Format: 12345 or 12345-6789">
<div class="format-hint">Format: 12345 or 12345-6789</div>

VALIDATION JAVASCRIPT PATTERN:
function validateInput(input, format) {
  const value = input.value.trim();
  const isValid = /* validation logic */;
  
  if (!isValid) {
    showError(input, 'Please use format: ' + format);
  } else {
    clearError(input);
  }
}

function showError(input, message) {
  const errorDiv = input.parentNode.querySelector('.error-message');
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
  }
  input.style.borderColor = '#dc3545';
}

function clearError(input) {
  const errorDiv = input.parentNode.querySelector('.error-message');
  if (errorDiv) {
    errorDiv.style.display = 'none';
  }
  input.style.borderColor = '#28a745';
}

Return ONLY the HTML code, nothing else. Start with <!DOCTYPE html> and end with </html>. Use APPENDIX A as reference; do not include appendix content in the final HTML.

### APPENDIX A - STORAGE LIBRARY

STORAGE LIBRARY APPENDIX (Applet API is core — always use for persistent game state)

WHEN TO USE THE API (fun-first):
- Save runs/levels, player inventories, power-ups, cosmetics, quests.
- Turn-based or asynchronous play: store turns, match state, seeds, maps, puzzles.
- High scores, streaks, leaderboards, badges, unlocks, achievements.
- Collaborative or viral experiences: shared boards, wish trees, remix chains.
- Any experience that should survive reloads or be resumed/shared later.

WHEN NOT TO USE:
- One-turn throwaway toys where resetting is expected.
- Pure calculators/converters that can stay in local state.

NiaAPI HELPER (canonical persistence, scoped per tenant/assistant — prefer this over localStorage):
```javascript
class NiaAPI {
  constructor(tenantId, assistantName) {
    this.tenantId = tenantId || "TENANT_ID_HERE";
    this.assistantName = assistantName || "ASSISTANT_NAME_HERE";
    this.baseURL = '/api/applet-api';
  }

  async listData(query = {}) {
    const params = new URLSearchParams({
      operation: 'list',
      tenantId: this.tenantId,
      assistantName: this.assistantName
    });
    if (Object.keys(query).length) params.append("query", JSON.stringify(query));
    const response = await fetch(this.baseURL + "?" + params);
    if (!response.ok) throw new Error('Failed to list data');
    const result = await response.json();
    return result.items || [];
  }

  async getData(dataId) {
    const params = new URLSearchParams({
      operation: 'get',
      tenantId: this.tenantId,
      dataId: dataId,
      assistantName: this.assistantName
    });
    const response = await fetch(this.baseURL + "?" + params);
    if (!response.ok) throw new Error('Failed to get data');
    const result = await response.json();
    return result.item;
  }

  async saveData(data) {
    const params = new URLSearchParams({
      operation: 'create',
      tenantId: this.tenantId,
      assistantName: this.assistantName
    });
    const response = await fetch(this.baseURL + "?" + params, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data })
    });
    if (!response.ok) throw new Error('Failed to save data');
    const result = await response.json();
    return result.item;
  }

  async updateData(dataId, data) {
    const params = new URLSearchParams({
      operation: 'update',
      tenantId: this.tenantId,
      dataId: dataId,
      assistantName: this.assistantName
    });
    const response = await fetch(this.baseURL + "?" + params, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data })
    });
    if (!response.ok) throw new Error('Failed to update data');
    const result = await response.json();
    return result.item;
  }

  async deleteData(dataId) {
    const params = new URLSearchParams({
      operation: 'delete',
      tenantId: this.tenantId,
      dataId: dataId,
      assistantName: this.assistantName
    });
    const response = await fetch(this.baseURL + "?" + params, { method: "DELETE" });
    if (!response.ok) throw new Error('Failed to delete data');
    return await response.json();
  }
}

// Initialize API (tenant/assistant IDs will be injected at runtime)
const api = new NiaAPI();
const __applyNiaConfig = (cfg) => {
  if (!cfg) return;
  if (cfg.tenantId) api.tenantId = cfg.tenantId;
  if (cfg.assistantName) api.assistantName = cfg.assistantName;
};
if (typeof window !== "undefined") {
  try {
    const cfg = typeof window.getAppletConfig === "function" ? window.getAppletConfig() : null;
    __applyNiaConfig(cfg);
  } catch (err) {
    console.warn("⚠️ Unable to read applet config during NiaAPI init", err);
  }
  window.addEventListener("appletConfigReady", (event) => {
    __applyNiaConfig(event?.detail);
  });
  window.api = api;
}
```

INLINE BOOTSTRAP (drop near the top of the HTML to ensure window.api exists):
```html
<script>
  // NiaAPI helper (embedded for persistence). Attaches to window.api for compatibility.
  (function initNiaAPI() {
    if (typeof window !== "undefined" && window.api && window.api.listData && window.api.saveData && window.api.updateData) {
      return window.api;
    }
    class NiaAPI {
      constructor(tenantId, assistantName) {
        this.tenantId = tenantId || "TENANT_ID_HERE";
        this.assistantName = assistantName || "ASSISTANT_NAME_HERE";
        this.baseURL = '/api/applet-api';
      }

      async listData(query = {}) {
        const params = new URLSearchParams({
          operation: 'list',
          tenantId: this.tenantId,
          assistantName: this.assistantName
        });
        if (Object.keys(query).length) params.append("query", JSON.stringify(query));
        const response = await fetch(this.baseURL + "?" + params);
        if (!response.ok) throw new Error('Failed to list data');
        const result = await response.json();
        return result.items || [];
      }

      async getData(dataId) {
        const params = new URLSearchParams({
          operation: 'get',
          tenantId: this.tenantId,
          dataId: dataId,
          assistantName: this.assistantName
        });
        const response = await fetch(this.baseURL + "?" + params);
        if (!response.ok) throw new Error('Failed to get data');
        const result = await response.json();
        return result.item;
      }

      async saveData(data) {
        const params = new URLSearchParams({
          operation: 'create',
          tenantId: this.tenantId,
          assistantName: this.assistantName
        });
        const response = await fetch(this.baseURL + "?" + params, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data })
        });
        if (!response.ok) throw new Error('Failed to save data');
        const result = await response.json();
        return result.item;
      }

      async updateData(dataId, data) {
        const params = new URLSearchParams({
          operation: 'update',
          tenantId: this.tenantId,
          dataId: dataId,
          assistantName: this.assistantName
        });
        const response = await fetch(this.baseURL + "?" + params, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data })
        });
        if (!response.ok) throw new Error('Failed to update data');
        const result = await response.json();
        return result.item;
      }

      async deleteData(dataId) {
        const params = new URLSearchParams({
          operation: 'delete',
          tenantId: this.tenantId,
          dataId: dataId,
          assistantName: this.assistantName
        });
        const response = await fetch(this.baseURL + "?" + params, { method: "DELETE" });
        if (!response.ok) throw new Error('Failed to delete data');
        return await response.json();
      }
    }
    const api = new NiaAPI();
    const applyConfig = (cfg) => {
      if (!cfg) return;
      if (cfg.tenantId) api.tenantId = cfg.tenantId;
      if (cfg.assistantName) api.assistantName = cfg.assistantName;
    };
    if (typeof window !== "undefined") {
      try {
        const cfg = typeof window.getAppletConfig === "function" ? window.getAppletConfig() : null;
        applyConfig(cfg);
      } catch (err) {
        console.warn("⚠️ Unable to read applet config during NiaAPI init", err);
      }
      window.addEventListener("appletConfigReady", (event) => {
        applyConfig(event?.detail);
      });
      window.api = api;
    }
    return api;
  })();
</script>
```

DATA ISOLATION: Each applet automatically gets isolated storage; no data mixing across applets.
CORE EXPECTATION: Treat this storage library as built-in; attach it whenever persistence makes the experience better.

USAGE EXAMPLE (todos):
```javascript
async function loadTodos() {
  const items = await api.listData();
  items.forEach(item => addTodoToDOM(item._id, item.data.text, item.data.completed));
}

async function addTodo() {
  const text = document.getElementById('todoInput').value.trim();
  if (!text) return;
  const item = await api.saveData({ text, completed: false, createdAt: new Date().toISOString() });
  addTodoToDOM(item._id, item.data.text, item.data.completed);
  document.getElementById('todoInput').value = '';
}

async function toggleTodo(id) {
  const item = await api.getData(id);
  await api.updateData(id, { ...item.data, completed: !item.data.completed });
  updateTodoDOM(id, !item.data.completed);
}

async function deleteTodo(id) {
  await api.deleteData(id);
  removeTodoFromDOM(id);
}
```

API NOTES:
- Each saved item gets an `_id`; use it for updates/deletes.
- Store payload in the `data` field; handle errors with try/catch and show user feedback.
- Show loading states during API calls.

FORM VALIDATION (only if you expose inputs; arcade flows can skip UI text):
- Show actionable errors with examples; use HTML5 types/patterns.
- Phone: placeholder "(555) 123-4567", pattern `[0-9 ()-]+`.
- Date: type="date", title "Format: YYYY-MM-DD".
- Email: type="email", title "Format: user@example.com".
- Credit card: pattern `[0-9\\s]+`, maxlength 19, title "Format: 1234 5678 9012 3456".
- Postal code: pattern `[0-9\\-]+`, title "Format: 12345 or 12345-6789".
- Provide real-time validation feedback (colors/icons) via showError/clearError helpers.
Validation helper skeleton:
```javascript
function validateInput(input, format, isValid) {
  if (!isValid) { 
    showError(input, 'Please use format: ' + format);
  } else {
    clearError(input);
  }
}

function showError(input, message) {
  const errorDiv = input.parentNode.querySelector(".error-message");
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = "block";
  }
  input.style.borderColor = '#dc3545';
}

function clearError(input) {
  const errorDiv = input.parentNode.querySelector(".error-message");
  if (errorDiv) {
    errorDiv.style.display = "none";
  }
  input.style.borderColor = '#28a745';
}
```

BUTTON + INTERACTION REQUIREMENTS:
- Every button/action must do what its label implies (Start, Add, Save, Reset, Submit, etc.).
- Bind handlers via onclick or addEventListener; keep functions global (window.func = ...).
- Use delegation for dynamic buttons; always show some feedback for actions.

MANDATORY INITIALIZATION:
- Define functions in global scope and wire DOMContentLoaded for startup initialization.

NO HEADINGS/TITLES IN OUTPUT: start directly with functional UI elements; avoid content-type badges.

---

## Usage

### Seeding to Prism Database

To seed this prompt into Prism as a `FunctionalPrompt` record:

1. **Using the seed script** (`scripts/seed-db.ts`):
   - Update the `promptContent` field in the seed data for `bot_create_app_from_description`
   - Run: `npm run pg:seed`

2. **Using Prism actions directly**:
   ```typescript
   import { FunctionalPromptActions } from '@nia/prism';
   
   await FunctionalPromptActions.createOrUpdate(
     'bot_create_app_from_description',
     promptContent, // The full prompt text from this file
     userId // Optional: user ID who created/updated this
   );
   ```

3. **Using the import script** (`scripts/import-functional-prompts.ts`):
   - Format the prompt in the expected input format
   - Run: `npm run pg:import-prompts`

### Using in Bot Context

The bot can access this prompt via `functional_prompt_actions.py`:

```python
from actions import functional_prompt_actions

prompt = await functional_prompt_actions.fetch_functional_prompt('bot_create_app_from_description')
```

### Placeholders

**Note**: This prompt contains placeholders that need to be replaced:
- `{description}` - The app description
- `{featuresText}` - Optional features list (may be empty)
- `{userRequest}` - The original user request

When using this prompt programmatically, replace these placeholders with actual values. The storage library code also contains `TENANT_ID_HERE` and `ASSISTANT_NAME_HERE` which are replaced at runtime by the applet system.

## Notes

- This prompt is extracted from `apps/interface/src/features/HtmlGeneration/actions/html-generation-actions.ts`
- The storage library appendix is generated by `packages/features/src/templates/storage-library.template.ts`
- This is the comprehensive prompt used for HTML generation, different from the simpler one currently in `scripts/seed-db.ts`
- The bot can fetch this prompt from Prism using `fetch_functional_prompt('bot_create_app_from_description')`

