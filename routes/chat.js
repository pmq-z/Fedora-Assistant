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

//PDF
const multer = require('multer');
const pdfParse = require('pdf-parse');

const { streamChat, checkOllamaHealth, OllamaError } = require('../api/ollama');

const { readSettings } = require('./settings');
const { SYSTEM_PROMPT } = require('../prompts/system-prompt');

const router = express.Router();

// El PDF se guarda temporalmente en la memoria y no en el disco
const MAX_PDF_SIZE = 10 * 1024 * 1024;
const MAX_PDF_TEXT_LENGTH = 50000;

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: MAX_PDF_SIZE,
  },

  fileFilter: (req, file, callback) => {
    const isPdf =
      file.mimetype === 'application/pdf' ||
      file.originalname.toLowerCase().endsWith('.pdf');

    if (!isPdf) {
      return callback(new Error('Only PDF files are allowed.'));
    }

    callback(null, true);
  },
});

// Tracks in-flight generations so the "Stop" button can cancel them.
// Keyed by a client-generated requestId.
const activeRequests = new Map();

// Endpoint para leer el PDF
// POST /api/chat/pdf
// Receives a PDF and extracts its text locally.
router.post('/pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No PDF file was provided.',
      });
    }

    const result = await pdfParse(req.file.buffer);

    const extractedText = result.text
      .replace(/\u0000/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!extractedText) {
      return res.status(400).json({
        error:
          'No text could be extracted. The PDF may contain scanned images and require OCR.',
      });
    }

    const wasTruncated =
      extractedText.length > MAX_PDF_TEXT_LENGTH;

    const text = extractedText.slice(
      0,
      MAX_PDF_TEXT_LENGTH
    );

    res.json({
      filename: req.file.originalname,
      pages: result.numpages,
      text,
      truncated: wasTruncated,
    });
  } catch (error) {
    console.error('PDF extraction error:', error);

    res.status(500).json({
      error: 'The PDF could not be read.',
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

  if (
    typeof documentContext === 'string' &&
    documentContext.trim()
    ) {
      fullMessages.push({
        role: 'system',
        content: `
      The user attached a PDF named "${documentName || 'document.pdf'}".

    Use the following extracted PDF text as reference when answering.
    Do not invent information that is not present in the document.
    If the requested information is not present, say so clearly.

    --- BEGIN PDF CONTENT ---

${documentContext.slice(0, MAX_PDF_TEXT_LENGTH)}

--- END PDF CONTENT ---
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
