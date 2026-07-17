# User Guide

A plain-language walkthrough of using Linux Mentor day-to-day. 

For installation steps, see the main [README.md](../README.md). 
For how it's built internally, see [TECHNICAL.md](TECHNICAL.md).

---

## What this is

Linux Mentor is a chat assistant that runs entirely on your own computer - nothing you type, and nothing it replies with, ever leaves your machine. It's built to act like a patient mentor for:

- Fedora Linux and everyday terminal use
- KDE Plasma customization ("ricing") - themes, icons, Kvantum, panels, transparency, fonts, and more - Shell scripting, Git, Python, Node.js, Docker, and general Fedora administration

It always explains *what* a command does and *why* before showing it, and it will warn you before suggesting anything destructive - it never runs commands for you, only suggests them.

---

## Starting the app

1. Make sure Ollama is running (`ollama serve` in a terminal, or check `systemctl status ollama` if it's set up as a service).
2. From the project folder, run `npm start`.
3. Open **http://localhost:3000** in your browser.

You'll see a green (or amber, depending on theme) connection indicator in the bottom-left of the sidebar telling you whether Ollama is reachable.

---

## Having a conversation

- Type in the box at the bottom and press **Enter** to send.
- Press **Shift+Enter** to add a new line without sending.
- While the assistant is replying, a **■ Stop** button appears if you want to cut it off early.
- Every assistant reply has a **copy** button, and a **regenerate** button on the most recent one if you'd like a different answer to the same question.
- Code blocks in replies get their own **copy** button in the top-right corner.

### Suggested prompts

The welcome screen shows a few example questions you can click to get started immediately, and the sidebar has a **Templates** section with reusable prompt starters (explain a command, help rice KDE, bash script help, Python help, Git help, Fedora troubleshooting) - click one to drop it into the input box, then fill in the specifics.

---

## Attaching a document

Click the **⎗** button next to the message box to attach a file. Supported formats:

| Format          | What happens                                                                          |
|-----------------|---------------------------------------------------------------------------------------|
| `.txt`, `.md`   | Read as plain text                                                                    |
| `.pdf`          | Text is extracted automatically (scanned/image-only PDFs won't work - there's no OCR) |
| `.csv`          | Read as plain tabular text                                                            |
| `.xlsx`, `.xls` | Every sheet is converted to readable text, sheet by sheet                             | 

Once attached, you'll see a small chip above the message box showing the filename and a short summary (page count, row count, etc). You can now ask questions like *"summarize this document"* or *"what's the average in column C?"* and the assistant will answer based on the file's actual contents - it's told explicitly not to make things up if the answer isn't in the document.

Click the **✕** on the chip to remove the attachment, or start a **New Chat** to clear it automatically. All of this happens locally - the file never leaves your computer.

---

## Saving and revisiting conversations

- **Save** (or `Ctrl+S`) writes the current conversation to the `chats/` folder as a timestamped `.txt` file. Saving again on the same chat  overwrites that file rather than creating a new one. 
- The app **auto-saves every 60 seconds** while you have an active
  conversation, so you generally don't need to think about this.
- Saved chats appear in the sidebar - click one to reopen it, or use the
  **✕** that appears on hover to delete it.
- Press `Ctrl+O` to open a search-and-select modal for finding an older chat quickly.
- The sidebar search box and the `Ctrl+O` modal both search the *contents* of your saved chats, not just filenames.

### Exporting

The chat header has **.md** and **.json** buttons that save a copy of thecu rrent conversation in that format inside `chats/` *and* trigger a browser download, in case you want a copy outside the app.

### Importing

Drag and drop a previously exported `.txt` chat file anywhere onto the message area to load it back in as the current conversation.

---

## Starting fresh

Click **New Session** (or `Ctrl+N`) to clear the conversation and any attached document, and start over.

---

## Settings

Click **⚙ Settings** in the sidebar (or `Ctrl+,`) to adjust:

| Setting             | What it does                                                                        |
|---------------------|-------------------------------------------------------------------------------------|
| **Model name**      | Which Ollama model to use (must already be pulled, e.g. `ollama pull llama3.2:3b`)  |
| **Ollama endpoint** | Where Ollama is listening (default `http://localhost:11434`)                        |
| **Temperature**     | Higher = more varied/creative answers, lower = more focused/deterministic           |
| **Top P**           | An alternate way to control response variety - most people can leave this alone     |
| **Max tokens**      | Roughly, how long a single reply is allowed to be                                   |
| **Theme**           | Dark (green phosphor), Light (amber phosphor), or System                            |

Changes are saved immediately and take effect on your next message.

---

## Keyboard shortcuts

| Shortcut      | Action                            |
|---------------|-----------------------------------|
| `Enter`       | Send message                      | 
| `Shift+Enter` | New line without sending          |
| `Ctrl+N`      | New chat                          |
| `Ctrl+S`      | Save chat                         |
| `Ctrl+O`      | Open a saved chat (search modal)  |
| `Ctrl+,`      | Open Settings                     |

(On macOS, `Cmd` works the same as `Ctrl` for these.)

---

## Troubleshooting

**The sidebar says "ollama unreachable"**
Ollama isn't running or isn't reachable at the endpoint in Settings. Start it with `ollama serve` in a terminal, or check `systemctl status ollama`. If you changed the port or run Ollama elsewhere, update the endpoint in Settings.

**"The model isn't available locally"**
Pull it first: `ollama pull llama3.2:3b` (or whatever model name is set in Settings - it needs to match exactly, including any `:tag`).

**A PDF says "no text could be extracted"**
The PDF is likely scanned pages (images), not real text - this app doesn't do OCR. Try a text-based PDF, or convert the scanned pages to text first with a separate OCR tool.

**Replies are slow or seem to hang**
The first reply after starting Ollama is often slower while it loads the model into memory - later replies are faster. If it's consistently slow, try lowering **Max tokens** in Settings, or confirm you're using the small `llama3.2:3b` model rather than something larger for your hardware.

**I want to start over completely**
Delete `settings.json` (a fresh default one is created automatically), and/or delete files inside `chats/` to remove saved conversations.

---

## Privacy

Everything - your messages, the model's replies, and any document you attach - stays on your machine. The app only talks to the Ollama server running locally; there's no cloud service, telemetry, or external API call involved anywhere in this workflow.
