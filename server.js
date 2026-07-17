/**
 * Entry point. Responsibilities:
 *   1. Serve the static frontend (frontend/).
 *   2. Mount the API routers (chat, chats, settings).
 *   3. Ensure the /chats directory exists on boot.
 *   4. Provide a top-level error handler so a bad request can never crash
 *      the process - this app is meant to sit quietly in the background.
 *
 * Run with: npm start   (see package.json)
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const chatRoutes = require('./routes/chat');
const chatsRoutes = require('./routes/chats');
const { router: settingsRoutes } = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 3000;

// Make sure /chats exists before anything tries to read/write to it.
const CHATS_DIR = path.join(__dirname, 'chats');
if (!fs.existsSync(CHATS_DIR)) {
  fs.mkdirSync(CHATS_DIR, { recursive: true });
}

// Parse JSON bodies. A modest limit is plenty for chat text - it also
// guards against accidental giant payloads.
app.use(express.json({ limit: '5mb' }));

// Serve the frontend as static assets.
app.use(express.static(path.join(__dirname, 'frontend')));

// API routes, one router per concern.
app.use('/api/chat', chatRoutes);
app.use('/api/chats', chatsRoutes);
app.use('/api/settings', settingsRoutes);

// Fallback to index.html for the root route (single-page app).
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Centralized error handler - guarantees the server responds with JSON
// instead of crashing or hanging if something throws unexpectedly.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error.', details: err.message });
  }
});

// Keep the process alive even if something async throws unexpectedly -
// log it, don't die. This is a desktop convenience tool; it should never
// need a manual restart because of one bad response from Ollama.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

app.listen(PORT, () => {
  console.log('');
  console.log('  KDE Linux Mentor is running');
  console.log(`  ➜  http://localhost:${PORT}`);
  console.log('');
  console.log('  Make sure Ollama is running (ollama serve) with llama3.2:3b pulled.');
  console.log('');
});
