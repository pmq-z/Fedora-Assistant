/**
 * Persists conversations to disk as plain files inside /chats. Everything is
 * file-based on purpose - there is no database, which keeps the project easy
 * to read, back up, and version-control.
 *
 * File formats:
 *   .txt  - the human-readable transcript format required by the spec:
 *
 *           User:
 *
 *           How do I install Fish?
 *
 *           Assistant:
 *
 *           You can install Fish using...
 *
 *           ------------------------
 *
 *   .md   - the same conversation, rendered as Markdown (bonus export)
 *   .json - the same conversation, as a raw messages array (bonus export)
 */

const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const router = express.Router();
const CHATS_DIR = path.join(__dirname, '..', 'chats');

// --- helpers ---------------------------------------------------------------

/** Prevents path traversal - a saved chat filename can never escape /chats. */
function sanitizeBaseName(name) {
  return String(name)
    .replace(/[/\\]/g, '')
    .replace(/\.\./g, '')
    .replace(/[^a-zA-Z0-9_\-:. ]/g, '')
    .trim();
}

/** Builds a timestamp-based filename like 2026-07-06_18-24-11 (no extension). */
function timestampName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

async function ensureChatsDir() {
  await fs.mkdir(CHATS_DIR, { recursive: true });
}

/** Renders a messages array into the required plain-text transcript format. */
function toTxtTranscript(messages) {
  return (
    messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        const label = m.role === 'user' ? 'User:' : 'Assistant:';
        return `${label}\n\n${m.content}\n\n------------------------`;
      })
      .join('\n\n') + '\n'
  );
}

/** Renders a messages array into a readable Markdown document. */
function toMarkdown(messages) {
  return (
    messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        const heading = m.role === 'user' ? '### 🧑 User' : '### 🤖 Assistant';
        return `${heading}\n\n${m.content}\n`;
      })
      .join('\n---\n\n')
  );
}

/** Parses the .txt transcript format back into a messages array. */
function parseTxtTranscript(text) {
  const blocks = text.split('------------------------').map((b) => b.trim()).filter(Boolean);
  const messages = [];
  for (const block of blocks) {
    const userMatch = block.match(/^User:\s*\n\n([\s\S]*)/);
    const assistantMatch = block.match(/^Assistant:\s*\n\n([\s\S]*)/);
    if (userMatch) {
      messages.push({ role: 'user', content: userMatch[1].trim() });
    } else if (assistantMatch) {
      messages.push({ role: 'assistant', content: assistantMatch[1].trim() });
    }
  }
  return messages;
}

// --- routes ------------------------------------------------------------

// GET /api/chats - list saved .txt conversations, newest first
router.get('/', async (req, res) => {
  try {
    await ensureChatsDir();
    const files = await fs.readdir(CHATS_DIR);
    const txtFiles = files.filter((f) => f.endsWith('.txt'));

    const withStats = await Promise.all(
      txtFiles.map(async (filename) => {
        const stat = await fs.stat(path.join(CHATS_DIR, filename));
        let preview = '';
        try {
          const content = await fs.readFile(path.join(CHATS_DIR, filename), 'utf8');
          const parsed = parseTxtTranscript(content);
          const firstUser = parsed.find((m) => m.role === 'user');
          preview = firstUser ? firstUser.content.slice(0, 80) : '';
        } catch {
          /* ignore preview failures */
        }
        return { filename, mtime: stat.mtime, preview };
      })
    );

    withStats.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    res.json(withStats);
  } catch (err) {
    res.status(500).json({ error: 'Could not list saved chats.', details: err.message });
  }
});

// GET /api/chats/search?q=... - full-text search across saved chats
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);

  try {
    await ensureChatsDir();
    const files = (await fs.readdir(CHATS_DIR)).filter((f) => f.endsWith('.txt'));
    const matches = [];

    for (const filename of files) {
      const content = await fs.readFile(path.join(CHATS_DIR, filename), 'utf8');
      const idx = content.toLowerCase().indexOf(q);
      if (idx !== -1) {
        const start = Math.max(0, idx - 40);
        const snippet = content.slice(start, idx + 80).replace(/\n+/g, ' ');
        matches.push({ filename, snippet: `...${snippet}...` });
      }
    }
    res.json(matches);
  } catch (err) {
    res.status(500).json({ error: 'Search failed.', details: err.message });
  }
});

// GET /api/chats/:filename - load and parse one saved chat
router.get('/:filename', async (req, res) => {
  const filename = sanitizeBaseName(req.params.filename);
  if (!filename.endsWith('.txt')) {
    return res.status(400).json({ error: 'Only .txt chat files can be loaded.' });
  }
  try {
    const content = await fs.readFile(path.join(CHATS_DIR, filename), 'utf8');
    res.json({ filename, messages: parseTxtTranscript(content) });
  } catch (err) {
    res.status(404).json({ error: 'Chat not found.', details: err.message });
  }
});

// DELETE /api/chats/:filename - remove a saved chat
router.delete('/:filename', async (req, res) => {
  const filename = sanitizeBaseName(req.params.filename);
  try {
    await fs.unlink(path.join(CHATS_DIR, filename));
    res.json({ deleted: true });
  } catch (err) {
    res.status(404).json({ error: 'Chat not found.', details: err.message });
  }
});

// POST /api/chats/save - save (or overwrite) a conversation as .txt
router.post('/save', async (req, res) => {
  const { messages, filename } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Nothing to save yet - send some messages first.' });
  }
  try {
    await ensureChatsDir();
    const base = filename ? sanitizeBaseName(filename).replace(/\.txt$/, '') : timestampName();
    const finalName = `${base}.txt`;
    await fs.writeFile(path.join(CHATS_DIR, finalName), toTxtTranscript(messages), 'utf8');
    res.json({ filename: finalName });
  } catch (err) {
    res.status(500).json({ error: 'Could not save chat.', details: err.message });
  }
});

// POST /api/chats/export/md - save conversation as Markdown
router.post('/export/md', async (req, res) => {
  const { messages, filename } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Nothing to export yet.' });
  }
  try {
    await ensureChatsDir();
    const base = filename ? sanitizeBaseName(filename).replace(/\.md$/, '') : timestampName();
    const finalName = `${base}.md`;
    const content = toMarkdown(messages);
    await fs.writeFile(path.join(CHATS_DIR, finalName), content, 'utf8');
    res.json({ filename: finalName, content });
  } catch (err) {
    res.status(500).json({ error: 'Could not export Markdown.', details: err.message });
  }
});

// POST /api/chats/export/json - save conversation as JSON
router.post('/export/json', async (req, res) => {
  const { messages, filename } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Nothing to export yet.' });
  }
  try {
    await ensureChatsDir();
    const base = filename ? sanitizeBaseName(filename).replace(/\.json$/, '') : timestampName();
    const finalName = `${base}.json`;
    const content = JSON.stringify({ exportedAt: new Date().toISOString(), messages }, null, 2);
    await fs.writeFile(path.join(CHATS_DIR, finalName), content, 'utf8');
    res.json({ filename: finalName, content });
  } catch (err) {
    res.status(500).json({ error: 'Could not export JSON.', details: err.message });
  }
});

module.exports = router;
