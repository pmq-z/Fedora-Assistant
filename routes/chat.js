/**
 * routes/chat.js
 *
 * HTTP surface for talking to the model. The frontend keeps the full
 * conversation history client-side and sends it with every request (Ollama
 * itself is stateless between calls), which keeps the server simple and
 * makes "load an old chat" trivial - it's just an array of messages.
 *
 * Streaming protocol:
 *   The response is `application/x-ndjson` (newline-delimited JSON), one
 *   small object per line:
 *     {"type":"token","content":"..."}   - a chunk of assistant text
 *     {"type":"done"}                    - generation finished normally
 *     {"type":"error","message":"..."}   - something went wrong
 *   This is simpler than SSE to produce/consume for a POST body stream and
 *   plays nicely with the fetch() + ReadableStream reader used client-side.
 */

const express = require('express');

// Document ingestion: everything is parsed to plain text locally, in
// memory, and never written to disk - all of it happens fully offline.
const multer = require('multer');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');

const { streamChat, checkOllamaHealth, OllamaError } = require('../api/ollama');

const { readSettings } = require('./settings');
const { SYSTEM_PROMPT } = require('../prompts/system-prompt');

const router = express.Router();

// Documents are held in memory only (never written to disk) and capped so
// a huge file can't stall the process or blow past the model's context.
const MAX_DOC_SIZE = 15 * 1024 * 1024; // 15 MB upload cap
const MAX_DOC_TEXT_LENGTH = 100000; // ~100k chars injected into the prompt

// Extension -> "kind" used to pick an extraction strategy and to render a
// friendly icon/label client-side. Mimetypes are unreliable across
// browsers/OSes for these formats, so extension is the source of truth.
const EXTENSION_KIND = {
  '.pdf': 'pdf',
  '.txt': 'text',
  '.log': 'text',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.csv': 'csv',
  '.xlsx': 'spreadsheet',
  '.xls': 'spreadsheet',
};

function getExtension(filename) {
  const idx = filename.lastIndexOf('.');
  return idx === -1 ? '' : filename.slice(idx).toLowerCase();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOC_SIZE },
  fileFilter: (req, file, callback) => {
    const ext = getExtension(file.originalname);
    if (!EXTENSION_KIND[ext]) {
      return callback(
        new Error('Supported formats: .txt, .md, .pdf, .csv, .xlsx, .xls')
      );
    }
    callback(null, true);
  },
});

// Tracks in-flight generations so the "Stop" button can cancel them.
// Keyed by a client-generated requestId.
const activeRequests = new Map();

/** Collapses excess whitespace without mangling meaningful line breaks. */
function normalizeText(raw) {
  return raw
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Renders every sheet of a workbook as readable, delimited plain text. */
function spreadsheetToText(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const parts = [];
  let totalRows = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (!csv.trim()) continue;
    totalRows += csv.split('\n').filter(Boolean).length;
    parts.push(`### Sheet: ${sheetName}\n\n${csv.trim()}`);
  }

  return { text: parts.join('\n\n'), meta: `${workbook.SheetNames.length} sheet(s), ~${totalRows} rows` };
}

/**
 * POST /api/chat/document
 *
 * Accepts a single file (.txt, .md, .pdf, .csv, .xlsx, .xls) and extracts
 * its text entirely offline - nothing is sent anywhere. The extracted text
 * is returned to the client, which holds onto it and sends it back with
 * the next /stream request so the model can answer questions grounded in
 * the document's actual contents.
 */
router.post('/document', (req, res, next) => {
  upload.single('document')(req, res, (err) => {
    if (err) {
      // Covers both our fileFilter rejection and multer's own errors
      // (e.g. file too large) - either way, a clean 400 beats a 500.
      return res.status(400).json({ error: err.message || 'The file could not be uploaded.' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file was provided.' });
    }

    const ext = getExtension(req.file.originalname);
    const kind = EXTENSION_KIND[ext];
    let extractedText = '';
    let meta = '';

    switch (kind) {
      case 'pdf': {
        const result = await pdfParse(req.file.buffer);
        extractedText = normalizeText(result.text);
        meta = `${result.numpages} page${result.numpages === 1 ? '' : 's'}`;
        break;
      }
      case 'spreadsheet': {
        const parsed = spreadsheetToText(req.file.buffer);
        extractedText = normalizeText(parsed.text);
        meta = parsed.meta;
        break;
      }
      case 'csv': {
        // Already tabular plain text - decode as-is, no parsing needed.
        extractedText = normalizeText(req.file.buffer.toString('utf8'));
        meta = `${extractedText.split('\n').filter(Boolean).length} rows`;
        break;
      }
      case 'text':
      case 'markdown':
      default: {
        extractedText = normalizeText(req.file.buffer.toString('utf8'));
        meta = `${extractedText.length.toLocaleString()} characters`;
        break;
      }
    }

    if (!extractedText) {
      return res.status(400).json({
        error:
          kind === 'pdf'
            ? 'No text could be extracted. The PDF may contain scanned images and require OCR.'
            : 'The file appears to be empty.',
      });
    }

    const wasTruncated = extractedText.length > MAX_DOC_TEXT_LENGTH;
    const text = extractedText.slice(0, MAX_DOC_TEXT_LENGTH);

    res.json({
      filename: req.file.originalname,
      kind,
      meta,
      text,
      truncated: wasTruncated,
    });
  } catch (error) {
    console.error('Document extraction error:', error);
    res.status(500).json({
      error: 'The file could not be read.',
      details: error.message,
    });
  }
});

// GET /api/chat/health - is Ollama reachable, and which models does it have?
router.get('/health', async (req, res) => {
  const settings = await readSettings();
  const health = await checkOllamaHealth(settings.endpoint);
  res.json(health);
});

// POST /api/chat/stream - stream a completion for the given message history
router.post('/stream', async (req, res) => {
  const {
    messages,
    requestId,
    documentContext,
    documentName,
  } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'A non-empty "messages" array is required.' });
  }

  const settings = await readSettings();

  // Always prepend the fixed system prompt, regardless of what the client sent,
  // so the assistant's persona can never be dropped or overridden accidentally.
  const fullMessages = [
    {
      role: 'system',
      content: SYSTEM_PROMPT,
    },
  ];

  if (typeof documentContext === 'string' && documentContext.trim()) {
    fullMessages.push({
      role: 'system',
      content: `
The user attached a document named "${documentName || 'document'}".

Use the following extracted document text as reference when answering.
Do not invent information that is not present in the document.
If the requested information is not present, say so clearly.

--- BEGIN DOCUMENT CONTENT ---

${documentContext.slice(0, MAX_DOC_TEXT_LENGTH)}

--- END DOCUMENT CONTENT ---
      `.trim(),
    });
  }

  fullMessages.push(...messages);

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no', // disable proxy buffering if ever run behind nginx
  });

  const abortController = new AbortController();
  if (requestId) activeRequests.set(requestId, abortController);

  const send = (obj) => {
    // Guard against writing after the client disconnected.
    if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n');
  };

  try {
    await streamChat(
      {
        endpoint: settings.endpoint,
        model: settings.model,
        messages: fullMessages,
        options: {
          temperature: settings.temperature,
          top_p: settings.top_p,
          num_predict: settings.max_tokens,
        },
      },
      (tokenText) => send({ type: 'token', content: tokenText }),
      abortController.signal
    );
    send({ type: 'done' });
  } catch (err) {
    if (err instanceof OllamaError) {
      if (err.code === 'ABORTED') {
        send({ type: 'done', stopped: true });
      } else {
        send({ type: 'error', message: friendlyMessage(err), code: err.code });
      }
    } else {
      send({ type: 'error', message: 'An unexpected error occurred.', details: err.message });
    }
  } finally {
    if (requestId) activeRequests.delete(requestId);
    res.end();
  }
});

// POST /api/chat/stop - cancel an in-flight generation by requestId
router.post('/stop', (req, res) => {
  const { requestId } = req.body || {};
  const controller = activeRequests.get(requestId);
  if (controller) {
    controller.abort();
    activeRequests.delete(requestId);
    return res.json({ stopped: true });
  }
  res.json({ stopped: false, reason: 'No matching in-flight request.' });
});

/**
 * Translates internal error codes into messages a non-technical Linux
 * newcomer will actually understand, per the "never assume the user knows
 * Linux" spirit of the system prompt itself.
 */
function friendlyMessage(err) {
  switch (err.code) {
    case 'CONNECTION_REFUSED':
      return "Can't reach Ollama. Make sure it's running (try 'ollama serve' in a terminal), then try again.";
    case 'TIMEOUT':
      return 'Ollama took too long to respond. It may be overloaded or the model may be too large for your hardware.';
    case 'INVALID_MODEL':
      return `The model isn't available locally. Pull it first, e.g.: ollama pull llama3.2:3b`;
    case 'INVALID_ENDPOINT':
      return 'The Ollama endpoint URL in Settings looks invalid. Check it and try again.';
    default:
      return err.message || 'Something went wrong talking to Ollama.';
  }
}

module.exports = router;
