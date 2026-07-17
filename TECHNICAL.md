# Technical Documentation

This document describes how Linux Mentor is built: architecture, data flow, API contracts, and the reasoning behind the main design decisions. It's aimed at anyone maintaining or extending the codebase.

For installation and day-to-day usage, see [README.md](../README.md) and [docs/USER_GUIDE.md](USER_GUIDE.md).

---

## 1. Architecture overview

```
 ┌─────────────────────┐          ┌──────────────────────┐          ┌──────────────┐
 │   Browser (frontend)│  HTTP    │  Node.js / Express    │  HTTP   │    Ollama    │
 │  vanilla HTML/CSS/JS│ ◄──────► │      server.js        │◄──────► │ (llama3.2:3b)│
 └─────────────────────┘          └──────────────────────┘          └──────────────┘
                                            │
                                            ▼
                                  ┌──────────────────┐
                                  │  chats/ (.txt)   │
                                  │  settings.json   │
                                  └──────────────────┘
```

- **Frontend**: a single static page (`frontend/index.html` + `styles.css` + `script.js`), no build step, no framework. Markdown rendering (`marked`) and syntax highlighting (`highlight.js`) are loaded from a CDN.
- **Backend**: Express, organized as one router per concern (`routes/`), with all Ollama HTTP calls isolated in `api/ollama.js`.
- **State**: the browser holds the full conversation in memory (`state.messages` in `script.js`) and sends it with every request - the server and Ollama are both stateless between calls. This is what makes "load an old chat" trivial: it's just restoring an array.
- **Persistence**: plain files. Conversations are `.txt`/`.md`/`.json` files under `chats/`; settings are a single `settings.json`. No database.

This was chosen over Electron for simplicity and reliability: zero native dependencies, starts instantly, and every layer can be inspected/curled independently.

---

## 2. Tech stack

| Layer               | Choice                    | Why                                                 |
|---------------------|---------------------------|-----------------------------------------------------|
| Server              | Express 4                 | Minimal, well understood, no magic                  |
| LLM runtime         | Ollama (`llama3.2:3b`)    | Local, offline, OpenAI-compatible-ish `/api/chat`   |
| Frontend            | Vanilla JS                | No build step; easy to read and extend              |
| Markdown            | `marked` (CDN)            | Small, fast, no bundler needed                      |
| Syntax highlighting | `highlight.js` (CDN)      | Auto-detects language, ships themes                 |
| PDF text extraction | `pdf-parse`               | Pure JS, no native deps                             |
| Spreadsheet parsing | `xlsx` (SheetJS)          | Reads `.xlsx`/`.xls`, no native deps                |
| File uploads        | `multer` (memory storage) | Files never touch disk                              |
| Containerization    | Podman (Containerfile)    | Daemonless, rootless-by-default, native to Fedora   |

---

## 3. Directory structure

```
project/
├── server.js                # Express entry point
├── package.json
├── settings.json             # persisted user settings
├── Containerfile              # podman/OCI image build
├── .containerignore
├── podman-compose.yml
├── scripts/
│   └── podman-run.sh         # build/run/stop helper for podman
├── prompts/
│   └── system-prompt.js      # fixed "Linux mentor" persona, prepended server-side
├── api/
│   └── ollama.js             # all HTTP communication with Ollama
├── routes/
│   ├── chat.js               # /stream, /stop, /health, /document
│   ├── chats.js               # save/list/load/search/delete/export
│   └── settings.js            # GET/POST /api/settings
├── frontend/
│   ├── index.html
│   ├── styles.css             # CRT/phosphor terminal theme
│   └── script.js              # all client-side logic
├── docs/
│   ├── TECHNICAL.md           # this file
│   └── USER_GUIDE.md
└── chats/                     # saved conversations (.txt / .md / .json)
```

Each layer has one job: `api/` only knows how to talk to Ollama, `routes/` only knows HTTP, `frontend/` only knows the UI. `prompts/` is the single source of truth for the assistant's persona.

---

## 4. Backend design

### 4.1 `server.js`

Wires everything together:
- Serves `frontend/` as static assets.
- Mounts `routes/chat.js` at `/api/chat`, `routes/chats.js` at `/api/chats`, `routes/settings.js` at `/api/settings`.
- Ensures `chats/` exists on boot.
- Global error handler + `unhandledRejection`/`uncaughtException` listeners so a bad response from Ollama (or a bug) never crashes the process - this is meant to sit quietly in the background indefinitely.

### 4.2 `api/ollama.js`

The only module that calls Ollama's REST API (`POST /api/chat`,
`GET /api/tags` for health checks). Exposes:

- `streamChat({ endpoint, model, messages, options }, onToken, signal)` - streams a completion. Ollama returns newline-delimited JSON objects over the response body; this function parses each line, calls `onToken` with the incremental text, and resolves with the full assembled string. `signal` (an `AbortSignal`) lets a caller cancel generation mid-stream.
- `checkOllamaHealth(endpoint)` - hits `/api/tags` with a 5s timeout, returns `{ online, models }` or `{ online: false, error }`.
- `OllamaError` - a typed error with a `.code` (`CONNECTION_REFUSED`, `TIMEOUT`, `INVALID_MODEL`, `INVALID_ENDPOINT`, `ABORTED`, `UNKNOWN`) so callers can show the right friendly message instead of a stack trace.

`REQUEST_TIMEOUT_MS` (currently 600,000 ms / 10 minutes) bounds how long a single generation can run before it's treated as a timeout - tune this down if you want faster failure on a hung Ollama process, or up if you're running a larger model on slower hardware.

### 4.3 `prompts/system-prompt.js`

Exports one constant, `SYSTEM_PROMPT`. It's prepended to every request in`routes/chat.js`'s `/stream` handler **server-side**, regardless of what the client sends - the persona can't be dropped or overridden by a client bug or a crafted request.

### 4.4 `routes/settings.js`

`GET /api/settings` / `POST /api/settings`, backed by `settings.json`.

- Defaults (`DEFAULT_SETTINGS`) can be seeded from environment variables `OLLAMA_ENDPOINT` and `OLLAMA_MODEL` **the first time** `settings.json` is created - useful when running in a container where `localhost` doesn't reach the host's Ollama. After that file exists, it always wins; env vars never silently override a user's saved settings.
- `POST` does basic range/type validation per field before merging and  persisting, so a bad request can't corrupt the file.

### 4.5 `routes/chats.js`

File-based conversation storage, all under `chats/`.

| Route                         | Purpose                                                       |
|-------------------------------|---------------------------------------------------------------|
| `GET /api/chats`              | List saved `.txt` chats, newest first, with a preview snippet |
| `GET /api/chats/search?q=`    | Full-text search across saved `.txt` chats                    |
| `GET /api/chats/:filename`    | Load and parse one chat back into a messages array            |
| `DELETE /api/chats/:filename` | Delete a saved chat                                           |
| `POST /api/chats/save`        | Save/overwrite as `.txt` (see format below)                   |
| `POST /api/chats/export/md`   | Save as `.md` and return the rendered content                 |
| `POST /api/chats/export/json` | Save as `.json` and return the content                        |

All filenames are sanitized (`sanitizeBaseName`) to strip `/`, `\`, `..`, and anything outside a safe character set, so a crafted filename can never escape `chats/`.

**`.txt` transcript format** (the canonical, parseable format):

```
User:

How do I install Fish?

Assistant:

You can install Fish using...

------------------------
```

`toTxtTranscript` / `parseTxtTranscript` are the inverse of each other; the same parser logic is duplicated (deliberately, not imported) on the client in `script.js` so drag-and-drop import works without a round trip to the server.

### 4.6 `routes/chat.js`

The most involved router. Three concerns:

**a) `POST /api/chat/document`** - multi-format document ingestion.

```
multer (memoryStorage) → fileFilter checks extension → buffer in memory
  → extraction strategy picked by extension:
      .pdf          → pdf-parse
      .xlsx / .xls  → xlsx (SheetJS): every sheet → CSV-style text,
                       joined with "### Sheet: <name>" headers
      .csv          → decoded as-is (already tabular text)
      .txt/.md/.log → decoded as-is
  → normalizeText() collapses stray whitespace/null bytes
  → truncated to MAX_DOC_TEXT_LENGTH (100,000 chars)
  → { filename, kind, meta, text, truncated } returned to the client
```

Nothing is written to disk (`multer.memoryStorage()`), and nothing leaves the machine - extraction is 100% local. `kind` is one of `pdf`, `text`, `markdown`, `csv`, `spreadsheet`; the frontend uses it to pick an icon.

The upload middleware is wrapped manually (rather than passed directly as route middleware) so `fileFilter` rejections and multer's own errors (e.g. file too large) return a clean `400` with a specific message instead of falling through to the generic `500` handler in `server.js`.

**b) `POST /api/chat/stream`** - the main chat completion endpoint.

Request body:
```json
{
  "messages": [{ "role": "user", "content": "..." }],
  "requestId": "req_...",
  "documentContext": "extracted text or null",
  "documentName": "report.pdf or null"
}
```

Server-side, in order:
1. Always prepends `{ role: 'system', content: SYSTEM_PROMPT }`.
2. If `documentContext` is present, injects a second system message wrapping it in `--- BEGIN/END DOCUMENT CONTENT ---` markers with an instruction not to invent information not present in the document.
3. Appends the client's `messages`.
4. Streams the result back as **newline-delimited JSON** (`application/x-ndjson`):

   ```
   {"type":"token","content":"Sure"}
   {"type":"token","content":", here's"}
   {"type":"done"}
   ```
   or, on failure:
   ```
   {"type":"error","message":"Can't reach Ollama...","code":"CONNECTION_REFUSED"}
   ```

   ndjson was chosen over SSE because it's simpler to produce from a plain
   POST response and simpler to consume with `fetch()` + a
   `ReadableStream` reader - no `EventSource`/GET-only constraint.

5. An `AbortController` per `requestId` is tracked in an in-memory `Map` (`activeRequests`), so `POST /api/chat/stop` can cancel a specific in-flight generation.

**c) `GET /api/chat/health`** - proxies `checkOllamaHealth()` for the frontend's connection-status indicator (polled every 15s).

**Error translation** (`friendlyMessage`): every `OllamaError.code` maps to a plain-language message suitable for someone who's never used Ollama before - e.g. `CONNECTION_REFUSED` → *"Can't reach Ollama. Make sure it's running (try 'ollama serve' in a terminal), then try again."*

---

## 5. Frontend design

`frontend/script.js` is a single IIFE with one `state` object and a set of clearly-scoped functions, grouped into numbered sections (see the file's header comment for the index). No framework, no build step, no bundler.

Key state:
```js
const state = {
  messages: [],            // full conversation, source of truth
  currentFilename: null,   // null until saved once
  settings: null,
  isGenerating: false,
  requestId: null,
  savedChats: [],
  documentContext: null,   // extracted text of an attached file
  documentName: null,
  documentKind: null,      // 'text' | 'markdown' | 'pdf' | 'csv' | 'spreadsheet'
};
```

Notable patterns:
- **Streaming render**: tokens are appended to `assistantMsg.content` and the bubble is re-rendered (`marked.parse` + `hljs.highlightElement`) on every chunk, with a blinking `<span class="stream-cursor">` appended while generation is in progress - removed on the final `renderAll()`.
- **Regenerate**: pops the last assistant message and re-runs `generateAssistantReply()` against the same history.
- **Auto-save**: `setInterval(autoSave, 60000)` calls the same `saveChat()` used by `Ctrl+S`, reusing `currentFilename` so it overwrites rather than creating a new file every minute.- **Drag-and-drop import**: reuses a client-side copy of the `.txt` parser so a previously exported chat can be reloaded without a server round trip.
- **Keyboard shortcuts**: `Ctrl+N` (new), `Ctrl+S` (save), `Ctrl+O` (open modal), `Ctrl+,` (settings) - bound on `document.keydown`, checked against `e.ctrlKey || e.metaKey` so they also work with ⌘ on macOS.

---

## 6. Theming / CSS architecture

`styles.css` implements a CRT/phosphor-terminal aesthetic via CSS custom properties (`:root` and `[data-theme="light"]` overrides):

- **Dark (default)**: green phosphor (`--phosphor: #46ff7a` and friends).
- **Light**: amber phosphor (`--phosphor: #ffb020`) - the background stays dark; only the phosphor hue changes, matching how real amber monochrome monitors looked (they were not light-background displays).
- **`system`**: resolved client-side in `applyTheme()` via `window.matchMedia('(prefers-color-scheme: light)')`.
- **Hard edges**: `--radius-sm/md/lg` are all `0`, and every literal `border-radius` (including what were circular avatars/status dot/send-stop buttons) is `0` too - no curves anywhere in the UI, matching genuine vintage terminal/BBS chrome, which was universally rectangular.

Structural CRT elements (in `index.html`, styled in `styles.css`):
- `.crt-bezel` / `.crt-screen` - the outer plastic frame and inner "glass" (square corners, no `border-radius`).
- `.crt-scanlines` - a `repeating-linear-gradient` overlay, `pointer-events: none`.
- `.crt-vignette` - radial gradient darkening the corners.
- `.crt-flicker` - a very low-amplitude opacity keyframe animation, disabled under `prefers-reduced-motion: reduce`.

Typography: `VT323` (display font, for the brand/welcome heading - reads like an authentic low-res terminal ROM font at large sizes) paired with `JetBrains Mono` for everything else (body text, code, UI labels) since VT323 becomes hard to read at small sizes.

**`[hidden]` vs component `display` rules**: every element toggled with the `hidden` attribute (modals, the error banner, the attached-document chip, the stop/send buttons) also belongs to a class that sets its own `display` (`.modal-overlay { display: flex }`, `.btn { display: inline-flex }`, etc). By CSS cascade rules, an **author**-origin `display` declaration always wins over the browser's built-in `[hidden] { display: none }` rule - which is **user-agent** origin - regardless of selector specificity; origin/importance is resolved before specificity, so a lone class rule silently defeats `hidden` no matter how it's toggled from JS. This was the cause of the modal-won't-close bug. The fix is one global rule near the top of `styles.css`: `[hidden] { display: none !important; }`. It's intentional, not a hack - it guarantees `hidden` always wins, and any *future* element toggled via `.hidden = true/false` is automatically safe without a per-component override. If a new dismissible element doesn't visually disappear, this is the first thing to check.

---

## 7. Containerization (Podman)

`Containerfile` is a two-stage build (`node:20-alpine`):
1. **deps stage**: `npm ci --omit=dev` against just `package.json` +  `package-lock.json`, cached separately from source changes.
2. **runtime stage**: copies `node_modules` from the deps stage plus source, runs as a non-root `mentor` user, exposes port 3000, and defines a `HEALTHCHECK` against `/api/settings`.

Because Ollama runs **natively on the host**, not in a container, the containerized app needs a way to reach `127.0.0.1:11434` on the host -`localhost` inside the container's own network namespace no longer refers to the host. Two supported approaches (see `scripts/podman-run.sh` and `podman-compose.yml`):

- `--network=slirp4netns:allow_host_loopback=true` +  `OLLAMA_ENDPOINT=http://host.containers.internal:11434` - keeps network isolation, uses podman's built-in DNS name for the host.
- `--network=host` - simpler, shares the host network stack directly, so the default `http://localhost:11434` just works. Less isolated.

`-v ...:Z` on bind mounts (`chats/`, `settings.json`) applies the SELinux label Fedora's SELinux (enforcing by default) requires for a rootless container to read/write host paths.

---

## 8. Security model

- **No `eval`**, anywhere.
- **No shell execution**: the assistant only ever suggests commands in chat text. There is no code path that executes model output.
- **Path traversal protection**: chat filenames are sanitized before any filesystem operation (`sanitizeBaseName` in `routes/chats.js`).
- **Uploads never hit disk**: `multer.memoryStorage()` - files are parsed in a Buffer and discarded after the response.
- **Non-root container user**: the `Containerfile` drops to an unprivileged `mentor` user; combined with podman's rootless user- namespace remapping, "root" inside the container still isn't root on the host.
- **Upload size caps**: `MAX_DOC_SIZE` (15 MB) and `MAX_DOC_TEXT_LENGTH` (100k chars injected into the prompt) bound both the upload and the context sent to the model.

---

## 9. Extending the project

| Task                                        | Where                                                                                                                                   |
|---------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| Add a new export format                     | `routes/chats.js`, following the `export/md` / `export/json` pattern, plus a button in `index.html` + a handler in `script.js`          |
| Add a new document type (e.g. `.docx`)      | Add an entry to `EXTENSION_KIND` and a `case` in the `switch` in `routes/chat.js`'s `/document` handler                                 |
| Change the assistant's persona/distro focus | Edit `prompts/system-prompt.js` only - it's the single source of truth and always server-side                                           |
| Add new prompt templates                    | Edit the `PROMPT_TEMPLATES` array at the top of `script.js`                                                                             |
| Swap Ollama for another local runtime       | Everything Ollama-specific lives in `api/ollama.js`; the rest of the app is unaffected as long as the same function signatures are kept |
| Adjust CRT effect intensity                 | Tune `--phosphor-glow` opacity, `.crt-scanlines` opacity, or the `flicker` keyframes in `styles.css`                                    |
