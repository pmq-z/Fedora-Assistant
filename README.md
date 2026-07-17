# Linux Mentor

A local, private AI mentor for **Fedora Linux + KDE Plasma 6**, powered bya locally running [Ollama](https://ollama.com) model (`llama3.2:3b` by default). It explains Linux concepts, helps troubleshoot problems, and guides you through KDE desktop customization ("ricing"), and it runs entirely offline. Nothing you type, and nothing it replies with, ever leaves your machine.

<!-- ============================================================= -->
```
⢸⠉⠉⠉⠉⢻⠀⠉⠉⢻⠉⠉⢹⢿⣿⣿⣍⡉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⢹⡉⠉⠉⠉⠉⠉⠉⡉⠉⠉⢹⢩⡏⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⢻
⢸⠀⠀⠀⠀⠈⣇⠀⠀⠸⡆⠁⢸⣎⠻⣿⣿⣿⣶⣔⡄⠀⠀⠀⠄⠐⠄⠀⣾⠇⠀⠀⠀⠀⠀⠠⠂⠀⠀⠜⣿⣠⠄⠀⣶⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸
⢸⠀⠀⠀⠀⠀⠸⡄⠀⠀⣇⠀⠀⡏⠻⢾⣽⣿⣿⣿⣿⡂⠀⠀⠀⠀⠀⢺⡎⢀⣠⣆⣆⣠⣄⠤⣲⣞⣭⡕⢖⠋⠠⣶⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸
⢸⠀⠀⠀⠀⠀⠀⢳⠀⠀⢹⠀⠀⡇⠘⠲⣽⣿⣿⣿⣿⣿⣷⠄⠐⠀⡠⣿⣵⣿⣿⣿⠿⠋⠁⠀⢗⣿⡿⠟⣛⢣⣀⣿⣿⠀⠀⢀⢀⣀⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸
⢸⠀⠀⠀⠀⠀⠀⠈⣇⠀⠘⡆⠀⢃⢿⣗⣺⣿⣿⡿⣿⣿⣿⣷⣥⢤⣼⣿⠟⠋⠛⠁⠀⠀⠀⠀⠀⠙⢠⢖⡂⠭⢹⣿⣿⣿⣿⣿⣿⡿⠋⣀⡤⣴⣶⣤⣀⠀⠀⠀⠀⠀⠀⠀⢸
⢸⠀⠀⠀⠀⠀⠀⠀⠸⡄⠀⢣⠀⢸⠈⠉⠛⠿⠟⠁⠀⠈⠉⠉⠙⠚⠛⠁⠀⠀⠀⠀⢠⣤⣤⡀⠀⠀⠘⢟⠗⠫⠥⣿⣿⡻⣿⣿⣟⣀⣀⣿⣮⣿⣻⣿⣿⠣⠀⠀⠀⠀⠀⠀⢸
⢸⠀⠀⠀⠀⠀⠀⠀⠀⢣⠀⠘⡄⢸⠀⠀⠀⠀⠀⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⠏⠀⠀⠀⠀⠀⠈⡜⢉⡩⣾⣿⣿⡟⢿⣿⣘⠋⣍⣿⣿⣼⣿⣯⡻⣷⠀⠀⠀  ⢸
⢸⣈⠢⡀⠀⠀⠀⠀⠀⠈⣆⢰⢳⢸⠀⠀⠀⠀⠀⣇⡀⠀⠀⠀⠀⠀⠀⠀⡄⠀⡴⠃⠀⣀⡤⣶⣢⡤⠀⠀⠸⠺⢜⢾⣻⣿⡏⠳⣸⣿⣠⡫⠷⣼⣿⣿⣿⡯⡮⢚⠠⠆⠀⠀⢸
⢸⣄⡉⠚⠦⣄⡀⠀⠀⠀⣼⣿⣄⣣⣄⠀⠀⠀⠀⢻⠋⠛⠷⠶⣦⣄⣐⣮⠃⡤⢂⡵⡎⢿⣿⣠⢽⠇⠀⠀⠀⠀⢿⡎⣹⣻⢷⠤⢵⣚⢷⣈⡹⢿⡿⢿⣟⣿⣚⢑⢀⢓⠀⡔⢺
⢸⣷⣿⣯⣰⣾⣿⣿⣿⡿⣿⣿⠛⠛⠉⠀⠀⠀⠀⠈⡇⢠⢿⣿⡯⡽⢟⢳⠀⠣⠀⠉⠉⠉⠀⠀⠀⠀⠀⠀⠀⠀⢸⣇⢵⢻⠿⠿⢿⣷⣿⣎⢻⣤⠸⣾⣽⣿⣷⡰⠚⡂⠤⣲⢼
⢸⣿⣧⣬⣙⠟⠛⠿⠶⠶⣿⣟⡛⠛⢛⣓⣓⢒⠀⠀⣳⠀⠀⠀⠀⠁⠀⢨⠀⠀⠰⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⠉⠋⣸⠒⠢⠤⣄⠉⠻⣦⣿⣏⣄⢈⣿⣿⣿⡮⡪⣾⣄⣾
⢸⣿⣿⣯⣙⣷⣀⣀⣀⣸⣿⣏⣿⠻⠟⢻⣭⣹⠀⣀⣼⠀⠀⠀⠀⠀⠀⢠⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢰⠀⢸⠒⠚⠁⠀⠀⠀⠀⠈⠓⡆⠈⣿⣿⣿⣿⣿⣿⣽⣧⠀⢸⣷
⢸⣿⢿⣟⠙⠉⠁⣼⣿⣿⣿⣿⣿⣷⣶⡯⠝⠋⠀⠈⣽⡄⠀⠀⠀⠀⠀⡜⠀⠀⠀⢀⡐⡄⠀⠀⠀⠀⠀⠀⡿⠀⢀⡇⠀⠀⠀⠀⢀⡴⠋⠁⣠⠞⠘⣿⣿⣿⣿⣿⣿⣷⣿⣿⣿
⢸⣿⠘⠀⢠⣴⣶⣿⣿⣿⣷⣿⣧⠶⠀⢀⣠⣶⣿⣿⠿⠳⡀⠀⠀⠀⠀⠷⣤⠤⠞⠙⠓⠁⠀⠀⠀⠀⠀⣸⠀⠀⢸⡇⠀⢀⠞⠁⠀⣠⠎⠀⠀⠀⢸⣏⢾⣿⣿⣿⣿⣿⣽⣿⣿
⢸⣇⠀⢸⣿⣿⣿⣿⣿⡟⠋⠁⣠⣴⣾⣿⣿⠟⠋⠁⠀⠀⠈⡶⣤⡀⠀⠀⠀⣄⡂⠀⠀⠀⠀⠀⠀⠀⠀⠊⠀⠀⡎⢣⢸⠀⠀⡴⠊⠀⠀⠀⠀⠀⠀⣯⣾⢺⣿⣿⣿⣿⣿⣿⣿
⢸⣷⠀⠌⣿⣿⡿⠟⠉⣠⣶⣿⣿⡿⠟⠉⠀⠀⠀⠀⠀⠀⠀⠀⠹⡄⠀⡠⠒⠖⠊⠉⣉⣉⠝⠺⠀⠀⠀⠀⠀⣘⠀⠸⡆⠀⢸⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣾⣿⣿⣿⣿⣿⣿⣿
⢸⣿⠀⢠⣿⣿⠀⠀⣼⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠐⢄⢵⡐⠒⠊⢉⣠⠴⠋⠀⠀⠀⠀⠀⢰⠏⠀⠀⡇⠀⢸⠉⠹⠀⠀⠀⠀⠀⠀⣟⠋⠉⠛⠛⠻⢿⣿⣿
⢸⣿⡁⣿⣿⣿⣦⡀⢻⣿⣿⣿⣧⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢎⠉⠉⠉⠀⠀⠀⠀⠀⠀⠀⠀⢠⣿⠀⠀⠀⢸⠀⠀⡇⠀⢡⠀⠀⠀⠀⠀⣿⠒⠧⡤⣤⠀⢽⡿⣿
⢸⣿⣿⣿⣿⣿⣿⣿⣶⡀⢤⣄⠉⠈⢢⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣤⠞⣡⠳⡀⠀⠀⠀⠀⠀⠀⠀⡰⠋⠀⢰⠀⠀⠀⢸⠀⠀⡇⠀⡇⠀⠀⡠⠊⠀⠀⠀⡇⡇⠅⠏⠲⣄⣿
⢸⣿⣿⣿⣿⣟⣉⣿⣿⣿⣦⣍⠳⣄⣄⡇⠀⠀⠀⠀⠀⠀⠀⠀⣰⠋⠀⢰⠁⠀⠙⠦⣀⣀⡀⠤⠞⠁⠀⡠⠁⠀⠀⠀⠀⡇⠀⢸⡞⠀⡠⠃⠀⠀⢀⠔⡡⠊⡨⡨⠀⠀⠀⠈⠻
⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣌⢻⣷⣄⣀⣀⣀⣀⣀⣰⣟⣀⣀⣀⣌⣀⣀⣀⣀⣀⣈⣙⣒⣘⣁⣠⣎⣀⣀⣀⣳⠀⣀⣧⠞⣀⣄⣀⣸⣰⣁⣀⣧⣇⣠⣠⣀⣀⣀⣩⣇⣸
```
<!-- ============================================================= -->

**USER_GUIDE.md** - how to use the app day-to-day
**Technical Documentation** - architecture, API reference, internals

---

## Features

- Streaming chat with markdown rendering, syntax-highlighted code blocks, and per-block copy buttons
- Attach a **`.txt`, `.md`, `.pdf`, `.csv`, or `.xlsx`** file and ask questions about it - extracted and processed entirely offline
- Save, search, reload, and export conversations (`.txt` / `.md` / `.json`) - auto-saved every 60 seconds
- Configurable model, endpoint, temperature, top_p, and max tokens
- Stop generation mid-stream, or regenerate the last reply
- Keyboard shortcuts (`Ctrl+N/S/O/,`), drag-and-drop chat import, prompt templates
- Retro CRT terminal UI - green (or amber) phosphor glow, scanlines, vignette - dark mode by design, not an afterthought
- Optional [Podman](https://podman.io) container support (Fedora's native, daemonless, rootless-by-default engine)

---

## Requirements

- Fedora Linux with KDE Plasma 6 (the assistant's expertise is tuned for this, though the app itself runs on any Linux desktop with Node.js)
- Node.js 18+
- [Ollama](https://ollama.com) running locally, with `llama3.2:3b` pulled

---

## Quick start

```bash
# 1. Install Ollama and pull the model (skip if already done)
curl -fsSL https://ollama.com/install.sh | sh
ollama serve &
ollama pull llama3.2:3b

# 2. Install and run the app
npm install
npm start
```

Open **http://localhost:3000**.

For full install/troubleshooting details, or running it in a Podman container, see USER_GUIDE.md and TECHNICAL.md

---

## Project structure

```
project/
├── server.js                 # Express entry point
├── prompts/system-prompt.js  # the assistant's fixed persona
├── api/ollama.js             # all Ollama HTTP communication
├── routes/                   # chat.js, chats.js, settings.js
├── frontend/                 # index.html, styles.css, script.js
├── docs/                     # TECHNICAL.md, USER_GUIDE.md
├── Containerfile / podman-compose.yml / scripts/podman-run.sh
└── chats/                    # saved conversations
```

See TECHNICAL.md for the full breakdown of each piece.

---

## Security

- No `eval`, anywhere.
- The assistant only ever **suggests** commands in chat text - there is no code path that executes model output.
- Uploaded documents are parsed in memory and never written to disk.
- Saved-chat filenames are sanitized server-side to prevent path traversal.

---

## Contributing

This is a small, single-purpose project meant to be easy to read and extend - see the "Extending the project" table in TECHNICAL.md for where to make common changes. Issues and pull requests welcome.

## License

MIT - do whatever you like with it.
