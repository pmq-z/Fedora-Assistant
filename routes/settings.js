/**
 * Persists user-configurable settings (model name, Ollama endpoint,
 * temperature, top_p, max tokens, theme) to settings.json on disk so they
 * survive restarts. Kept intentionally simple - a single JSON file is more
 * than enough for a single-user local desktop tool.
 */

const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const router = express.Router();
const SETTINGS_PATH = path.join(__dirname, '..', 'settings.json');

// When running inside a container (podman/docker), "localhost" no longer
// points at the host running Ollama. Rather than hardcode a container-only
// value, we let these env vars seed settings.json the *first* time it's
// created - after that, whatever's in settings.json (or whatever the user
// sets via the Settings UI) wins. See README's "Running with Podman"
// section for the values to use (typically host.containers.internal).
const DEFAULT_SETTINGS = {
  model: process.env.OLLAMA_MODEL || 'llama3.2:3b',
  endpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
  temperature: 0.7,
  top_p: 0.9,
  max_tokens: 2048,
  theme: 'dark',
};

async function readSettings() {
  try {
    const raw = await fs.readFile(SETTINGS_PATH, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // File missing or corrupt - fall back to defaults and recreate the file.
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2));
    return { ...DEFAULT_SETTINGS };
  }
}

async function writeSettings(settings) {
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// GET /api/settings - return current settings
router.get('/', async (req, res) => {
  try {
    const settings = await readSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Could not read settings.', details: err.message });
  }
});

// POST /api/settings - merge & persist new settings
router.post('/', async (req, res) => {
  try {
    const current = await readSettings();
    const incoming = req.body || {};

    // Basic validation - reject obviously bad values rather than silently
    // corrupting settings.json.
    const next = { ...current };

    if (typeof incoming.model === 'string' && incoming.model.trim()) {
      next.model = incoming.model.trim();
    }
    if (typeof incoming.endpoint === 'string' && incoming.endpoint.trim()) {
      next.endpoint = incoming.endpoint.trim();
    }
    if (typeof incoming.temperature === 'number' && incoming.temperature >= 0 && incoming.temperature <= 2) {
      next.temperature = incoming.temperature;
    }
    if (typeof incoming.top_p === 'number' && incoming.top_p >= 0 && incoming.top_p <= 1) {
      next.top_p = incoming.top_p;
    }
    if (typeof incoming.max_tokens === 'number' && incoming.max_tokens > 0) {
      next.max_tokens = Math.floor(incoming.max_tokens);
    }
    if (['dark', 'light', 'system'].includes(incoming.theme)) {
      next.theme = incoming.theme;
    }

    await writeSettings(next);
    res.json(next);
  } catch (err) {
    res.status(500).json({ error: 'Could not save settings.', details: err.message });
  }
});

module.exports = { router, readSettings };
