# Pearl FileSpace — Conversational File Browser Plan

**Status:** Draft Plan — Ready for Review
**Author:** Pearl (multi-model synthesis: Codex CLI, Kimi, DeepSeek v4 Pro, GLM5.1 perspectives)
**Date:** 2026-05-04

---

## Vision

A file browser that feels like talking to a librarian who memorized your entire hard drive. You never navigate — you describe what you want. Pearl finds it, shows it, and acts on it. Works equally well for a 7-year-old uploading drawings and an engineer managing 10,000 config files. Voice-first, text-capable, visually stunning.

> "Hey Pearl, load my account spreadsheet from August last year."
> Pearl pulls it up. Shows it. You say "share it with Jamie." Done.

---

## 1. Core Architecture

### 1.1 The Three Layers

```
┌─────────────────────────────────────────────────────────┐
│                    CONVERSATION LAYER                     │
│  Voice (Pipecat/Daily) ←→ Text (ChatMode) ←→ LLM Router │
│  "Find my tax docs" → intent + entities → file action    │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                    INTELLIGENCE LAYER                     │
│  Semantic Index · Recency Model · Permission Graph       │
│  Fuzzy Matching · Temporal Reasoning · Auto-Tagging      │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                    PRESENTATION LAYER                     │
│  Spatial Canvas · Rich Previews · Live Edit · Animations │
│  Adaptive Layout (grid/list/constellation/timeline)      │
└─────────────────────────────────────────────────────────┘
```

### 1.2 Integration with PearlOS

- **Window system:** New `viewType: 'fileSpace'` registered in `browser-window.tsx`
- **Voice path:** Pipecat tool call → `NIA_EVENT_FILESPACE_*` events → FileSpace component
- **Text path:** ChatMode file intents → same event bridge
- **File backend:** Extends existing `/api/files` routes + new semantic index API
- **State:** New `FileSpaceContext` provider, integrates with existing `UIContext`

---

## 2. The Conversational Engine

### 2.1 Intent Recognition

Pearl understands file requests in natural language. The LLM parses every file-related utterance into a structured intent:

| Intent | Example | Action |
|--------|---------|--------|
| `find` | "Where's that PDF Jamie sent me?" | Semantic search → show results |
| `open` | "Open my August spreadsheet" | Locate → preview in-place |
| `edit` | "Rename that to Q3 Report" | Modify metadata → animate change |
| `share` | "Send this to the team" | Share via existing ResourceSharing |
| `organize` | "Put all tax docs in one folder" | Batch move with confirmation |
| `create` | "Make a new folder for the project" | Create → navigate |
| `delete` | "Trash everything in Downloads older than 6 months" | Soft delete with undo |
| `compare` | "Show me both versions side by side" | Split preview |
| `convert` | "Turn this into a PDF" | Convert → show result |
| `summarize` | "What's in this spreadsheet?" | Parse + LLM summary |

### 2.2 Temporal Reasoning

The killer feature: time-aware file search.

- "The spreadsheet from **August last year**" → filters by date range Aug 2025
- "That thing I uploaded **yesterday**" → last 24h, sorted by recency
- "The **latest** version of the logo" → most recent match by name similarity
- "Files I worked on **this week**" → activity-based, not just modified-date

**Implementation:** Store `created_at`, `modified_at`, `accessed_at`, `uploaded_at` in the semantic index. LLM converts natural time references to date ranges before querying.

### 2.3 Conversational Memory

Pearl remembers file context within a session:

```
User: "Find my tax documents"
Pearl: [shows 4 tax PDFs]
User: "Open the one from 2025"
Pearl: [understands "the one" = from the 4 results, filters to 2025]
User: "Share it with my accountant"
Pearl: [knows "it" = the 2025 tax PDF just opened]
```

Pronouns, relative references ("the first one," "that folder," "the big one") all resolve via conversation context stored in `FileSpaceContext`.

---

## 3. The Semantic File Index

### 3.1 What Gets Indexed

Every file in the user's space gets a rich metadata record:

```typescript
interface FileRecord {
  id: string;
  path: string;
  name: string;
  extension: string;
  size: number;
  
  // Temporal
  createdAt: Date;
  modifiedAt: Date;
  accessedAt: Date;
  uploadedAt: Date;
  
  // Semantic
  embedding: number[];          // Vector from file name + content snippet
  autoTags: string[];           // LLM-generated: ["tax", "2025", "spreadsheet"]
  userTags: string[];           // Manual tags
  contentSummary: string;       // First-paragraph or LLM summary
  
  // Relational
  source: 'upload' | 'created' | 'shared' | 'downloaded';
  sharedWith: string[];
  relatedFiles: string[];       // Detected by name/content similarity
  
  // Display
  thumbnailUrl: string | null;
  previewType: 'image' | 'pdf' | 'spreadsheet' | 'text' | 'code' | 'video' | 'audio' | 'archive' | 'unknown';
  color: string;                // Auto-assigned category color
}
```

### 3.2 Indexing Pipeline

```
File arrives (upload/create/sync)
  → Extract metadata (fs.stat, mime type)
  → Generate thumbnail (sharp for images, pdf-thumbnail for PDFs)
  → Extract text snippet (first 500 chars or PDF first page)
  → Generate embedding (local model or API)
  → Auto-tag via LLM (name + snippet → tags)
  → Store in SQLite FTS5 + vector index
  → Push to FileSpace UI via WebSocket
```

### 3.3 Search Strategy

Queries hit three indexes simultaneously, results merged by weighted score:

1. **Full-text search (FTS5):** File names, content snippets, tags — fast exact/prefix match
2. **Vector similarity:** Embedding cosine similarity — handles "that chart about revenue" even if no file is named "revenue"
3. **Temporal filter:** Date range narrowing from natural language time expressions

Weights: FTS5 (0.4) + Vector (0.35) + Recency (0.15) + Frequency (0.10)

---

## 4. Visual Design — "FileSpace"

### 4.1 Design Philosophy

**Anti-filing-cabinet.** No nested folder trees. No path bars. No breadcrumbs by default. Files appear as living objects in a spatial canvas — grouped by meaning, colored by type, sized by importance.

Think: if Apple Notes and Figma had a baby, raised by a search engine.

### 4.2 Layout Modes

Users (or Pearl) can switch between four views:

#### Constellation View (Default)
Files float as cards in a 2D spatial canvas, clustered by semantic similarity. Tax docs drift together. Photos cluster by date. Code files group by project. Clusters have soft glowing halos with category labels.

- Drag to rearrange, pinch to zoom
- Clusters breathe gently (subtle scale animation)
- New files arrive with a soft "landing" animation
- Related files have faint connecting lines when hovered

#### Grid View
Traditional grid of rich preview cards. But smarter:
- Cards show live thumbnails (image preview, PDF first page, spreadsheet header row, code syntax-highlighted snippet)
- Adaptive card sizes: images get bigger cards, text files get smaller ones
- Infinite scroll with virtualization (handles 10,000+ files)

#### Timeline View
Horizontal timeline. Files placed chronologically. Zoom in for day-level, zoom out for year-level. Perfect for "find that thing from last August."

- Swim lanes by file type (docs on top, images in middle, code on bottom)
- Activity heat map shows dense periods
- Scrubbing with temporal labels ("3 months ago", "Last summer")

#### List View
For power users. Dense, sortable, filterable table. But with inline previews — hover any row to see a thumbnail popup. Keyboard navigable.

### 4.3 Card Design

Each file is a card with:

```
┌──────────────────────────┐
│  ┌────────────────────┐  │
│  │                    │  │  ← Rich thumbnail
│  │    PREVIEW         │  │     (image, PDF page, code snippet,
│  │                    │  │      spreadsheet header, waveform)
│  └────────────────────┘  │
│  📊 Q3-Revenue.xlsx      │  ← Icon + name (truncated smart)
│  Tax · Spreadsheet · Aug │  ← Auto-tags as pills
│  ────────────────────────│
│  Shared with Jamie  · 2d │  ← Context line + relative time
└──────────────────────────┘
```

**Styling (matches PearlOS design system):**
- Background: `rgba(20, 12, 40, 0.6)` with `backdrop-filter: blur(12px)`
- Border: `1px solid rgba(123, 63, 142, 0.3)`
- Border on hover: `rgba(217, 79, 142, 0.6)` (magenta glow)
- Tag pills: semi-transparent purple/blue/green by category
- Thumbnails: rounded corners, subtle inner shadow
- Selection: pulsing purple border ring

### 4.4 The Conversational Bar

A persistent input at the bottom of FileSpace (reuses ChatMode glass styling):

```
┌──────────────────────────────────────────────────────────────┐
│ 🎙️  "Find my account spreadsheet from August..."    [⏎] [📎] │
└──────────────────────────────────────────────────────────────┘
```

- Voice button toggles listen mode (uses existing VoiceInput)
- Typing shows autocomplete suggestions from file index
- Results animate into view as Pearl "finds" them
- Pearl responds inline: "Found 3 spreadsheets from August. Here's the most recent one."
- Attach button for quick uploads

### 4.5 Preview Panel

When a file is selected, a preview panel slides in from the right (or opens as a ManeuverableWindow):

| File Type | Preview |
|-----------|---------|
| Images | Full render with zoom, pan, basic editing tools |
| PDFs | Page-by-page viewer with text selection |
| Spreadsheets | Interactive table with sorting, filtering (first 100 rows) |
| JSON | Syntax-highlighted, collapsible tree view |
| Markdown/Text | Rendered markdown or syntax-highlighted code |
| Video/Audio | Inline player with waveform (audio) or thumbnail scrubber (video) |
| Code | Syntax-highlighted with language detection, line numbers |
| Archives | Contents list with individual file previews |

Preview supports conversational actions:
- "Zoom into the chart on page 3" → PDF navigates to page 3
- "What does this spreadsheet say about Q3?" → LLM reads and summarizes
- "Make the image brighter" → Invokes PhotoMagic pipeline

### 4.6 Animations & Micro-interactions

- **File upload:** Card "falls" into canvas from top with soft bounce
- **Search results:** Cards ripple outward from center as results load
- **Delete:** Card crumbles and fades with particle effect
- **Move to folder:** Card slides to target cluster with trail
- **Sharing:** Card briefly glows, then a copy "flies off" to the right
- **Selection:** Soft pulsing purple ring
- **Hover:** Card lifts slightly (translateY -2px, shadow deepens)
- **Cluster formation:** Cards drift together over 600ms ease-out

All animations use `framer-motion` (already in PearlOS) and respect `prefers-reduced-motion`.

---

## 5. Voice Integration

### 5.1 Voice-First Queries

FileSpace is a first-class Pipecat tool. During any voice session, the user can say file-related things and Pearl handles them:

**New Pipecat Tool Definition:**
```python
{
    "type": "function",
    "function": {
        "name": "file_browser",
        "description": "Search, open, preview, organize, share, or act on the user's files",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["search", "open", "preview", "rename", "move", "share", 
                             "delete", "create_folder", "summarize", "list_recent"]
                },
                "query": {
                    "type": "string",
                    "description": "Natural language description of the file(s)"
                },
                "time_context": {
                    "type": "string", 
                    "description": "Temporal reference like 'last August', 'yesterday', 'this week'"
                },
                "target": {
                    "type": "string",
                    "description": "Target for action (folder path, user name for sharing, etc.)"
                }
            },
            "required": ["action", "query"]
        }
    }
}
```

### 5.2 Voice → Visual Flow

```
User says: "Hey Pearl, find my tax documents"
  → Pipecat STT → "find my tax documents"
  → LLM → file_browser tool call {action: "search", query: "tax documents"}
  → Frontend receives NIA_EVENT_FILESPACE_SEARCH
  → FileSpace opens (if not already), runs search
  → Results animate in
  → Pearl says: "I found 6 tax documents. The most recent is your 2025 W-2, 
                 uploaded in March. Want me to open it?"
  → User: "Yeah, open it"
  → Pearl opens preview, says: "Here you go. It's a 2-page PDF from your accountant."
```

### 5.3 Confirmation for Destructive Actions

Voice commands that modify files always confirm:

```
User: "Delete all the old screenshots"
Pearl: "I found 47 screenshots older than 6 months, taking up 340 MB. 
        Want me to move them to trash? You can undo within 30 days."
User: "Yeah do it"
Pearl: [deletes, shows undo toast] "Done. Freed up 340 MB."
```

---

## 6. Making Thousands of Files Manageable

### 6.1 Smart Clusters

Instead of folders, files auto-organize into semantic clusters:

- **By project:** Files with similar names/content group together
- **By type:** Photos, documents, code, music naturally separate
- **By time:** Recent items stay prominent, old items recede
- **By source:** Uploads, downloads, created, shared — each has a visual lane

Users can pin clusters, rename them, merge them, or break them apart. But they never *have to* organize — Pearl does it automatically.

### 6.2 Importance Ranking

Not all files are equal. FileSpace ranks by:

1. **Recency of access** — files you touched today are front and center
2. **Frequency of access** — your go-to spreadsheet stays prominent
3. **Sharing activity** — files shared with others rank higher
4. **Size significance** — large files get attention for storage management
5. **User pins** — manually pinned files always stay visible

Low-importance files fade to smaller cards or collapse into cluster summaries: "47 more screenshots from 2024."

### 6.3 Progressive Disclosure

- **Zero state:** Just the conversational bar. "What are you looking for?"
- **Light use (< 50 files):** All files visible as cards
- **Medium use (50-500):** Clustered view, top clusters expanded, others collapsed
- **Heavy use (500-5000):** Clusters with counts, only top-3 recent expanded
- **Power use (5000+):** Search-first interface, clusters as navigation pills, timeline scrubber

The UI scales gracefully. Nobody sees 10,000 cards at once.

### 6.4 "Where Did I Put That?" Solving

The #1 frustration with file systems: forgetting where you saved something.

FileSpace solves this by never requiring you to know the path:

- **Semantic search:** "that revenue chart" finds `Q3-2025-rev-analysis.xlsx`
- **Temporal search:** "the thing I downloaded Friday" narrows to 1-2 files
- **Source search:** "the PDF Jamie shared" uses sharing metadata
- **Content search:** "the document that mentions Acme Corp" searches inside files
- **Visual search:** Timeline view lets you scrub to "around that time" and visually recognize the file

---

## 7. For Kids and Engineers Alike

### 7.1 Simplicity Mode (Default)

- Big, colorful cards with clear thumbnails
- Conversational bar is the only control
- Actions are all voice/text: "open," "share," "move," "delete"
- No visible file paths, no extensions shown, no permission dialogs
- Undo for everything (30-day trash)
- Friendly confirmations: "I'll put this in your Photos collection"

### 7.2 Power Mode (Toggle)

For engineers who want the control:

- Path bar appears at top (click-navigable breadcrumbs)
- Terminal-in-FileSpace: type `ls`, `mv`, `grep` commands inline
- Metadata panel: full stat output, permissions, symlinks
- Batch operations: regex rename, bulk tag, bulk move
- File watcher: real-time updates when external processes modify files
- Git-aware: shows git status indicators on tracked files
- JSON/YAML inline editing with validation

### 7.3 Keyboard Shortcuts (Power Mode)

| Shortcut | Action |
|----------|--------|
| `/` | Focus search bar |
| `⌘K` | Quick file finder (fuzzy search popup) |
| `Space` | Quick preview selected file |
| `Enter` | Open selected file |
| `⌘⇧N` | New folder |
| `⌘D` | Duplicate |
| `⌘⌫` | Move to trash |
| `Tab` | Cycle between clusters |
| `⌘1-4` | Switch layout modes |
| `⌘I` | File info panel |

---

## 8. Implementation Plan

### Phase 1: Foundation (Week 1-2)

**Goal:** Conversational file search that actually works.

1. **Semantic File Index Service** (`/apps/interface/src/features/FileSpace/services/file-index.ts`)
   - SQLite database with FTS5 for full-text search
   - File metadata extraction on upload/scan
   - Auto-tagging via LLM (batch process on index build)
   - API routes: `/api/filespace/search`, `/api/filespace/index`, `/api/filespace/scan`

2. **FileSpace Context** (`/apps/interface/src/features/FileSpace/contexts/FileSpaceContext.tsx`)
   - Active files, search results, selected file, conversation history
   - Layout mode state
   - Integration with UIContext

3. **Basic Conversational Bar**
   - Text input with file search
   - Results as simple card grid
   - Natural language → search query via LLM

4. **Window Registration**
   - Add `fileSpace` viewType to browser-window.tsx
   - Open via window lifecycle controller

### Phase 2: Rich Previews (Week 3-4)

**Goal:** Every file type looks great when opened.

1. **Preview Components**
   - `ImagePreview` — zoom, pan, basic info
   - `PdfPreview` — page navigation, text selection (extend existing pdf-processor)
   - `SpreadsheetPreview` — tabular view with SheetJS
   - `JsonPreview` — collapsible syntax-highlighted tree
   - `CodePreview` — highlight.js with language detection
   - `AudioPreview` — waveform player (WaveSurfer.js)
   - `VideoPreview` — HTML5 player with thumbnail scrubber
   - `MarkdownPreview` — rendered markdown (reuse Notes renderer)
   - `TextPreview` — plain text with line numbers

2. **Thumbnail Generation Pipeline**
   - Sharp for images (resize to 300px)
   - pdf-image for PDF first pages
   - Code screenshots via syntax highlight + canvas
   - Spreadsheet: render header row as mini-table

3. **Preview Panel UI**
   - Slide-in panel or ManeuverableWindow
   - Action bar: share, download, rename, delete, edit

### Phase 3: Visual Polish & Layouts (Week 5-6)

**Goal:** Looks so good people screenshot it.

1. **Constellation View**
   - Canvas-based layout with d3-force clustering
   - Semantic proximity determines position
   - Smooth animations with framer-motion

2. **Grid View**
   - Virtualized grid (react-window) for 10K+ files
   - Adaptive card sizing by content type
   - Masonry layout option

3. **Timeline View**
   - Horizontal scrollable timeline
   - Zoom levels: day / week / month / year
   - Swim lanes by file type

4. **Card Component**
   - Glass-morphism styling matching PearlOS
   - Rich thumbnails with lazy loading
   - Tag pills, context lines, relative timestamps
   - Hover/selection animations

5. **Upload Animations**
   - Extend FileDropZone with FileSpace-aware animations
   - Files land in appropriate clusters

### Phase 4: Voice Integration (Week 7-8)

**Goal:** Full voice control of files.

1. **Pipecat Tool**
   - `file_browser` function tool in bot system prompt
   - Routes to FileSpace via NIA event bridge

2. **Voice-to-Visual Pipeline**
   - Tool call → NIA_EVENT_FILESPACE_* → FileSpace component
   - Visual feedback synchronized with Pearl's voice response
   - Confirmation dialogs for destructive actions

3. **Temporal Reasoning**
   - LLM date parser for natural time expressions
   - "Last August" → `2025-08-01 to 2025-08-31`
   - "A few weeks ago" → last 21 days
   - "Recently" → last 7 days

4. **Conversational Context**
   - Pronoun resolution ("open it," "share that one," "the first one")
   - Session file context maintained in FileSpaceContext
   - Multi-turn file operations

### Phase 5: Intelligence (Week 9-10)

**Goal:** Files organize themselves.

1. **Auto-Clustering**
   - Embedding-based similarity clustering
   - Cluster naming via LLM
   - Cluster merging/splitting by user or auto-adjustment

2. **Importance Ranking**
   - Access frequency tracking
   - Recency weighting
   - Progressive disclosure based on file count thresholds

3. **Smart Suggestions**
   - "You have 47 screenshots you haven't opened in 6 months. Clean up?"
   - "This looks like a duplicate of [other file]."
   - "Jamie shared a new version of this document."

4. **Content Indexing**
   - Extract text from PDFs, DOCX, spreadsheets
   - Index content for deep search
   - Generate summaries for each file

### Phase 6: Power Features (Week 11-12)

**Goal:** Engineers love it too.

1. **Power Mode Toggle**
   - Path bar, metadata panel, terminal integration
   - Keyboard shortcuts
   - Batch operations UI

2. **Git Integration**
   - Status indicators on tracked files
   - Diff preview for modified files

3. **Sharing & Collaboration**
   - Integrate with existing ResourceSharing feature
   - Share links, permissions management
   - Shared-with-me view

4. **External Storage**
   - Google Drive bridge (extend existing GoogleDrive feature)
   - Dropbox, S3 connectors (future)
   - Unified search across all sources

---

## 9. Technical Decisions

### Database: SQLite + FTS5

**Why:** Already available on Linux, zero setup, FTS5 handles full-text search natively, fast enough for 100K files per user. No need for a separate search service.

**Schema:**
```sql
CREATE VIRTUAL TABLE files_fts USING fts5(
  name, tags, content_snippet, path,
  content='files', content_rowid='id'
);

CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  extension TEXT,
  size INTEGER,
  mime_type TEXT,
  created_at DATETIME,
  modified_at DATETIME,
  accessed_at DATETIME,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  auto_tags TEXT,  -- JSON array
  user_tags TEXT,  -- JSON array
  content_summary TEXT,
  thumbnail_path TEXT,
  preview_type TEXT,
  source TEXT DEFAULT 'upload',
  embedding BLOB,  -- float32 array
  importance_score REAL DEFAULT 0.5,
  cluster_id INTEGER,
  FOREIGN KEY (cluster_id) REFERENCES clusters(id)
);

CREATE TABLE clusters (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT,
  auto_generated BOOLEAN DEFAULT TRUE,
  center_x REAL,
  center_y REAL,
  color TEXT
);

CREATE TABLE file_access_log (
  id INTEGER PRIMARY KEY,
  file_id INTEGER,
  accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  action TEXT, -- 'open', 'preview', 'edit', 'share', 'download'
  FOREIGN KEY (file_id) REFERENCES files(id)
);
```

### Embedding Model

**Option A (Recommended):** `all-MiniLM-L6-v2` via ONNX runtime — runs locally, 384-dim embeddings, fast enough for real-time indexing.

**Option B:** OpenAI `text-embedding-3-small` — better quality, but adds API dependency and cost.

Start with Option A for privacy and speed. Upgrade to B if search quality needs improvement.

### Thumbnail Generation

- **Images:** Sharp (already common in Node.js)
- **PDFs:** `pdf-thumbnail` or `pdftoppm` (poppler-utils, already on Linux)
- **Video:** `ffmpeg -ss 00:00:01 -vframes 1` (ffmpeg likely available)
- **Spreadsheets:** Render first 5 rows as HTML → screenshot via Puppeteer
- **Code:** Syntax-highlight snippet → render as SVG

### File Watching

Use `chokidar` (Node.js) or `inotify` (Linux native) to watch the user's file directory. Real-time index updates when files are added/modified/deleted outside of FileSpace.

---

## 10. What Makes This Different

### vs. Traditional File Managers (Nautilus, Finder, Files)
- **No folder drilling.** Ever. You describe, Pearl finds.
- **Voice-first.** "Open my resume" is faster than click-click-click-click.
- **Semantic organization.** Files cluster by meaning, not arbitrary folder hierarchy.
- **Rich previews.** See what's in a file without opening an app.

### vs. Everything/Spotlight/Alfred
- **Conversational.** Not just search — full multi-turn file operations.
- **Visual.** Results aren't a text list — they're rich cards with previews.
- **Actionable.** "Share this with Jamie" works. Search tools stop at "here's the path."

### vs. Google Drive / Notion
- **Local-first.** Your files stay on your machine. No cloud dependency.
- **Universal.** Works with any file type, not just docs/sheets.
- **Voice-native.** Not bolted-on voice search — built from the ground up.

### vs. CLI (ls, find, fd, fzf)
- **Zero learning curve.** "Find my photos" is the command.
- **Visual results.** See thumbnails, not text paths.
- **But still powerful.** Power mode gives you a terminal right there.
- **Cross-referencing.** "Files related to the Acme project" uses semantic understanding, not just `grep`.

---

## 11. Wow Moments (Demo Script)

These are the moments that make people's eyes go wide:

1. **"Hey Pearl, show me everything related to taxes."**
   → Cards fly in, organized by year, with thumbnails of each document visible. Pearl narrates: "You have 12 tax documents spanning 2023 to 2025. Your most recent W-2 was uploaded in March."

2. **"What's in that spreadsheet?"**
   → Pearl opens it inline, reads the header row and data summary: "It's a revenue breakdown by quarter. Q3 was your strongest at $847K. Want me to create a chart?"

3. **"Organize my Downloads folder."**
   → Pearl scans it, proposes clusters: "I see 234 files. I'd group them into Photos (89), Documents (67), Installers (34), Music (22), and Misc (22). Should I move them?" User says yes. Files animate into clusters in real-time.

4. **[Drag-and-drop 50 photos]**
   → Cards cascade onto the canvas like cards being dealt. Each gets a thumbnail in under a second. Pearl: "Got it — 50 photos from your camera. Looks like they're from your trip to Portland. Want me to create a Portland collection?"

5. **"Find that contract I was looking at a couple weeks ago."**
   → Pearl: "I see two contracts you opened recently — the lease agreement from April 18th and the vendor contract from April 22nd. Which one?" User: "The vendor one." Pearl opens it.

6. **Timeline scrub** — user drags the timeline back to last summer, sees all files from that period. Sees a spike of activity in August. Zooms in. Finds the spreadsheet they forgot about.

---

## 12. File Structure

```
apps/interface/src/features/FileSpace/
├── components/
│   ├── FileSpaceView.tsx          # Main container, layout switcher
│   ├── ConversationalBar.tsx      # Text/voice input bar
│   ├── FileCard.tsx               # Individual file card
│   ├── ClusterGroup.tsx           # Cluster container with label
│   ├── ConstellationView.tsx      # Spatial canvas layout
│   ├── GridView.tsx               # Card grid layout
│   ├── TimelineView.tsx           # Chronological timeline
│   ├── ListView.tsx               # Dense table view
│   ├── PreviewPanel.tsx           # File preview slide-in
│   └── previews/
│       ├── ImagePreview.tsx
│       ├── PdfPreview.tsx
│       ├── SpreadsheetPreview.tsx
│       ├── JsonPreview.tsx
│       ├── CodePreview.tsx
│       ├── AudioPreview.tsx
│       ├── VideoPreview.tsx
│       └── MarkdownPreview.tsx
├── contexts/
│   └── FileSpaceContext.tsx        # State management
├── hooks/
│   ├── useFileSearch.ts           # Search with debounce
│   ├── useFileIndex.ts            # Index operations
│   ├── useFileClusters.ts         # Clustering logic
│   └── useFilePreview.ts          # Preview state
├── services/
│   ├── file-index.ts              # SQLite index operations
│   ├── file-search.ts             # Multi-strategy search
│   ├── thumbnail-generator.ts     # Thumbnail pipeline
│   ├── content-extractor.ts       # Text extraction from files
│   ├── auto-tagger.ts             # LLM-based tagging
│   └── temporal-parser.ts         # Natural language → date ranges
├── lib/
│   ├── constants.ts
│   ├── types.ts
│   └── animations.ts             # Framer-motion variants
└── styles/
    └── filespace.css              # Custom animations
```

API routes:
```
apps/interface/src/app/api/filespace/
├── search/route.ts                # Semantic + FTS search
├── index/route.ts                 # Index management
├── scan/route.ts                  # Trigger directory scan
├── thumbnail/[id]/route.ts       # Serve thumbnails
├── preview/[id]/route.ts         # File preview data
├── clusters/route.ts             # Cluster CRUD
├── tags/route.ts                 # Tag management
└── actions/route.ts              # File operations (move, rename, delete, share)
```

---

## 13. Dependencies (New)

```json
{
  "better-sqlite3": "^11.0.0",      // SQLite with FTS5
  "sharp": "^0.33.0",                // Image processing (may already exist)
  "chokidar": "^3.6.0",             // File watching
  "sheetjs": "^0.20.0",             // Spreadsheet parsing
  "wavesurfer.js": "^7.0.0",        // Audio waveform visualization
  "d3-force": "^3.0.0",             // Force-directed clustering layout
  "react-window": "^1.8.10",        // Virtualized lists for 10K+ files
  "onnxruntime-node": "^1.17.0"     // Local embedding model (optional)
}
```

---

## 14. Success Metrics

- **Time to file:** Under 5 seconds from voice/text query to file preview (for indexed files)
- **Search relevance:** Top-1 accuracy > 85% for natural language queries
- **Zero-organization usability:** Users with 1000+ unorganized files can find specific files by description
- **Voice completion rate:** > 90% of file operations completable without touching keyboard/mouse
- **Kid test:** A 10-year-old can upload, find, and share a file using only voice
- **Engineer test:** A developer can find a specific config file faster than `find` + `grep`

---

## 15. Open Questions

1. **Storage backend:** Stay with local filesystem or add S3/MinIO for scale?
2. **Embedding model:** Local ONNX vs. API — privacy vs. quality tradeoff
3. **Real-time collaboration:** Should multiple users see each other's cursors in shared folders?
4. **Mobile:** Touch-optimized constellation view, or different UX entirely?
5. **Encryption:** Should the semantic index be encrypted at rest?

---

*This plan synthesizes approaches from conversational AI (Codex CLI perspective), visual design innovation (Kimi perspective), large-scale search architecture (DeepSeek v4 Pro perspective), and multimodal interaction (GLM5.1 perspective). Each model's strengths informed a different layer: conversation, intelligence, presentation, and voice integration respectively.*
