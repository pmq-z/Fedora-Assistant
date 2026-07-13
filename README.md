# Linux Mentor — a local KDE Plasma / Fedora AI assistant

A small, private, local-first desktop assistant that behaves like a patient
Linux mentor and KDE Plasma ricing expert. It runs entirely on your machine:
your prompts and Ollama's replies never leave `localhost`.

Built for **Fedora Linux + KDE Plasma 6**, powered by a locally running
**Ollama** server and the **llama3.2:3b** model.

---

## What it looks like

- A dark, KDE Breeze-inspired chat UI with a sidebar for saved chats,
  prompt templates, and settings.
- A terminal-styled prompt box (`❯`) for typing your questions.
- Markdown rendering with syntax-highlighted code blocks and per-block
  "Copy" buttons.
- Streaming responses, a Stop button, and a Regenerate button on the last
  reply.

---

## Architecture

This is a **Node.js + Express** app that serves a plain HTML/CSS/JS frontend
(no framework, no build step) and talks to Ollama's REST API on the server
side. This was chosen over Electron for simplicity and reliability — it has
zero native/GUI dependencies, starts instantly, and is trivial to run,
inspect, or extend. You open it in any browser (or add it as a KDE web
shortcut / "web app" for a more app-like feel).

```
project/
├── server.js              # Express entry point - wires everything together
├── package.json
├── settings.json           # persisted user settings (model, endpoint, etc.)
├── Containerfile            # podman/OCI image build (see "Running with Podman")
├── .containerignore
├── podman-compose.yml       # optional Compose-syntax alternative
├── scripts/
│   └── podman-run.sh       # build/run/stop helper for podman
├── prompts/
│   └── system-prompt.js    # the fixed "Linux mentor" system prompt
├── api/
│   └── ollama.js           # all HTTP communication with the Ollama server
├── routes/
│   ├── chat.js             # POST /api/chat/stream, /stop, GET /health
│   ├── chats.js            # save/list/load/search/delete/export chats
│   └── settings.js         # GET/POST /api/settings
├── frontend/
│   ├── index.html          # sidebar + chat area + modals
│   ├── styles.css          # dark KDE-Breeze-inspired theme
│   └── script.js           # all client-side logic (vanilla JS)
└── chats/                  # saved conversations (.txt / .md / .json)
```

Each layer has one job: `api/` only knows how to talk to Ollama, `routes/`
only knows HTTP, `frontend/` only knows the UI. This makes it easy to, say,
swap Ollama for another local runtime, or add a new export format, without
touching unrelated code.

---

## Requirements

- **Fedora Linux** with **KDE Plasma 6** (the assistant's knowledge is
  tuned for this, though the app itself runs on any Linux/desktop with
  Node.js)
- **Node.js 18+** and npm
- **Ollama** installed and reachable at `http://localhost:11434`
- The **`llama3.2:3b`** model pulled locally

---

## Installation

### 1. Install Node.js (if you don't have it)

```bash
sudo dnf install nodejs npm
```

### 2. Install Ollama (if you don't have it)

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### 3. Start the Ollama server

```bash
ollama serve
```

Leave this running in a terminal (or let systemd manage it — the official
installer sets up a `ollama.service` unit on most systems, so
`systemctl --user status ollama` or `sudo systemctl status ollama` may
already show it running).

### 4. Pull the model

In another terminal:

```bash
ollama pull llama3.2:3b
```

This downloads a ~2 GB model file — it only needs to be done once.

### 5. Install project dependencies

From this project's folder:

```bash
npm install
```

This installs the only runtime dependency, **Express**. Markdown rendering
(`marked`) and syntax highlighting (`highlight.js`) are loaded from a CDN in
`frontend/index.html`, so no bundler or extra npm packages are needed for
the frontend.

### 6. Start the app

```bash
npm start
```

You should see:

```
  KDE Linux Mentor is running
  ➜  http://localhost:3000
```

Open **http://localhost:3000** in your browser (or add it as a KDE
"Web Shortcut" / install it as a PWA from Chromium/Firefox for an app-like
window).

---

## Running with Podman (optional)

You don't need a container to run this app - `npm start` on bare metal is
simpler and is what the Installation steps above cover. But if you'd
rather keep it isolated (or run it as a managed background service), this
project ships with a `Containerfile` built for **podman** - Fedora's
native, daemonless, rootless-by-default container engine (`sudo dnf install
podman`). Docker works too since the file has no podman-specific syntax,
but podman is what's tested and recommended here.

**Ollama itself still runs natively on the host**, not in a container - only
this Node/Express app is containerized. That means the container needs a
way to reach `127.0.0.1:11434` on the host, which "localhost" no longer
refers to once you're inside a container's own network namespace.

### Quickest path: the helper script

```bash
./scripts/podman-run.sh build
./scripts/podman-run.sh run          # foreground
# or: ./scripts/podman-run.sh run -d   # detached
```

This builds the image, runs it rootless, maps port 3000, and bind-mounts
`chats/` and `settings.json` from the project folder so your saved
conversations and settings persist on the host even if the container is
removed and recreated.

It sets `OLLAMA_ENDPOINT=http://host.containers.internal:11434` -
`host.containers.internal` is podman's built-in DNS name for "the host
machine," so the containerized app can reach the Ollama server running
natively on Fedora.

Stop and remove it with:

```bash
./scripts/podman-run.sh stop
```

### Or: manually with podman

```bash
podman build -t linux-mentor -f Containerfile .

podman run \
  --name linux-mentor \
  --network=slirp4netns:allow_host_loopback=true \
  -e OLLAMA_ENDPOINT=http://host.containers.internal:11434 \
  -p 3000:3000 \
  -v "$(pwd)/chats:/app/chats:Z" \
  -v "$(pwd)/settings.json:/app/settings.json:Z" \
  linux-mentor
```

Notes on the flags:
- `-v ...:Z` applies the right SELinux label so Fedora's SELinux (enabled
  by default) allows the rootless container to read/write those host
  paths - without it you'll likely see "Permission denied" errors even
  though the file permissions look fine.
- `--network=slirp4netns:allow_host_loopback=true` keeps the container in
  its own network namespace (more isolated) while still allowing it to
  reach the host's loopback interface for Ollama.
- **Simpler alternative:** if you don't need network isolation, drop that
  flag and add `--network=host` instead, then just leave the endpoint as
  the default `http://localhost:11434` - since the container shares the
  host's network stack directly, `localhost` works exactly as it does
  outside a container. This is the easiest option for a single-user local
  dev machine.

### Or: podman-compose

```bash
podman-compose -f podman-compose.yml up --build
podman-compose -f podman-compose.yml down
```

(Works with the newer built-in `podman compose` too, if your podman
version bundles it: `podman compose -f podman-compose.yml up --build`.)

### Running it as a background service with systemd

Rather than leaving a terminal open, podman can generate a systemd **user**
unit so the container starts with your session and restarts on crash - no
root daemon involved, matching podman's rootless model:

```bash
./scripts/podman-run.sh run -d
podman generate systemd --new --name linux-mentor --files
mkdir -p ~/.config/systemd/user
mv container-linux-mentor.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now container-linux-mentor.service
```

Check on it with `systemctl --user status container-linux-mentor.service`
and view logs with `journalctl --user -u container-linux-mentor.service`.

### Why podman instead of Docker here

- Fedora ships podman in its default repos; Docker requires adding a
  third-party repo.
- Podman is daemonless and rootless by default - no long-lived root process
  brokering every container command, which is a meaningfully smaller attack
  surface for a tool that's just running a local chat UI.
- The `Containerfile` also runs the Node process as a non-root `mentor`
  user inside the container, which combined with podman's user-namespace
  remapping means "root" in the container still isn't root on your host.

---

## Using it

- **New Chat** (sidebar or `Ctrl+N`) — starts a fresh conversation.
- **Save** (`Ctrl+S`) — writes the current conversation to
  `chats/YYYY-MM-DD_HH-MM-SS.txt`. Saving again on the same chat overwrites
  that same file (auto-save does this every 60 seconds too).
- **Open a saved chat** — click one in the sidebar, or press `Ctrl+O` to
  search and open from a modal.
- **Export .md / .json** — saves a copy in `chats/` in that format *and*
  triggers a browser download.
- **Settings** (`Ctrl+,`) — change the model name, Ollama endpoint,
  temperature, top_p, max tokens, and theme (dark/light/system). Saved to
  `settings.json`.
- **Stop** — appears while a reply is streaming; cancels generation
  immediately.
- **Regenerate** — re-asks the model for a new answer to your last message.
- **Drag & drop** a previously exported `.txt` chat file onto the message
  area to import it.
- **Search** — the sidebar search box and the `Ctrl+O` modal both do a
  full-text search across everything you've saved in `chats/`.

---

## Changing the model or endpoint

Open **Settings** in the app, or edit `settings.json` directly:

```json
{
  "model": "llama3.2:3b",
  "endpoint": "http://localhost:11434",
  "temperature": 0.7,
  "top_p": 0.9,
  "max_tokens": 2048,
  "theme": "dark"
}
```

Any model you've pulled with `ollama pull <model>` can be used here — for
example `llama3.1:8b` if your hardware can handle it.

---

## Troubleshooting

**"Ollama unreachable" in the sidebar / errors when sending a message**
- Make sure Ollama is running: `ollama serve` (or check
  `systemctl status ollama`).
- Confirm it's listening on the expected port:
  `curl http://localhost:11434/api/tags`
- If you changed the port or run Ollama on another host, update the
  **endpoint** in Settings.

**"The model isn't available locally"**
- Pull it: `ollama pull llama3.2:3b` (or whatever model name you set in
  Settings — it must match exactly, including the `:3b` tag).

**The app won't start / "port already in use"**
- Something else is using port 3000. Either stop that process, or run on a
  different port: `PORT=3001 npm start`.

**Responses are slow or time out**
- `llama3.2:3b` is a small model and should be fast on most modern CPUs,
  but the first request after starting Ollama can be slow while it loads
  the model into memory. Subsequent requests are faster.
- If you're on very limited hardware, lower `max_tokens` in Settings so
  replies finish sooner.

**I want to reset everything**
- Delete `settings.json` (a fresh default one is recreated automatically).
- Delete files inside `chats/` to remove saved conversations.

---

## Security notes

- The assistant only ever **suggests** terminal commands in chat text — it
  never executes anything on your system. There is no code path in this
  project that runs shell commands from model output.
- `eval` is never used anywhere in the codebase.
- Saved/loaded chat filenames are sanitized server-side to prevent path
  traversal outside of `chats/`.

---

## Extending the project

- **New export format**: add a route in `routes/chats.js` following the
  existing `export/md` / `export/json` pattern, and a button in
  `frontend/index.html` + `frontend/script.js`.
- **New prompt templates**: edit the `PROMPT_TEMPLATES` array at the top of
  `frontend/script.js`.
- **Different persona/distro**: edit `prompts/system-prompt.js` — it's the
  single source of truth for the assistant's behavior and is always
  prepended server-side, so it can't be dropped by the client.
- **A different local LLM runtime**: everything Ollama-specific lives in
  `api/ollama.js`; swap its implementation and the rest of the app is
  unaffected.

---

## License

MIT — do whatever you like with it.
