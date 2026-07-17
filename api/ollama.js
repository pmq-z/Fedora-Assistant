/**
 * All direct communication with the local Ollama server lives here.
 * Ollama's chat endpoint: POST {endpoint}/api/chat
 * Body: { model, messages: [{role, content}], stream, options: {...} }
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// A generous but finite timeout so a hung Ollama process doesn't hang the
// whole app forever. The user gets a friendly error instead.
const REQUEST_TIMEOUT_MS = 600_000;

/**
 * Custom error type so routes can distinguish "Ollama isn't running" /
 * "model not found" / "timeout" from generic bugs and show the right
 * friendly message.
 */
class OllamaError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'OllamaError';
    this.code = code; // 'CONNECTION_REFUSED' | 'TIMEOUT' | 'NOT_FOUND' | 'INVALID_MODEL' | 'UNKNOWN'
  }
}

/**
 * Quick health check used by the frontend to show a banner if Ollama is down
 * before the user even tries to send a message.
 */
function checkOllamaHealth(endpoint) {
  return new Promise((resolve) => {
    const url = new URL('/api/tags', endpoint);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.get(url, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(body);
            const models = (parsed.models || []).map((m) => m.name || m.model);
            resolve({ online: true, models });
          } catch {
            resolve({ online: true, models: [] });
          }
        } else {
          resolve({ online: false, error: `Ollama responded with status ${res.statusCode}` });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ online: false, error: 'Timed out waiting for Ollama.' });
    });

    req.on('error', (err) => {
      resolve({ online: false, error: err.message });
    });
  });
}

/**
 * Streams a chat completion from Ollama.
 *
 * @param {object} params
 * @param {string} params.endpoint      e.g. http://localhost:11434
 * @param {string} params.model         e.g. llama3.2:3b
 * @param {Array}  params.messages      [{role: 'system'|'user'|'assistant', content}]
 * @param {object} params.options       { temperature, top_p, num_predict }
 * @param {function} onToken            called with each partial text chunk
 * @param {AbortSignal} signal          lets the caller cancel generation (Stop button)
 * @returns {Promise<string>}           resolves with the full assembled response text
 */
function streamChat({ endpoint, model, messages, options }, onToken, signal) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL('/api/chat', endpoint);
    } catch {
      return reject(new OllamaError('The Ollama endpoint URL is invalid.', 'INVALID_ENDPOINT'));
    }

    const client = url.protocol === 'https:' ? https : http;
    const payload = JSON.stringify({
      model,
      messages,
      stream: true,
      options,
    });

    const req = client.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        // Ollama returns a JSON error body with a non-200 status when the
        // model doesn't exist locally, etc.
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let errBody = '';
          res.on('data', (c) => (errBody += c));
          res.on('end', () => {
            let message = `Ollama returned status ${res.statusCode}.`;
            try {
              const parsed = JSON.parse(errBody);
              if (parsed.error) message = parsed.error;
            } catch {
              /* ignore parse errors, use default message */
            }
            const isModelIssue = /model|not found/i.test(message);
            reject(new OllamaError(message, isModelIssue ? 'INVALID_MODEL' : 'UNKNOWN'));
          });
          return;
        }

        let fullText = '';
        let buffer = '';

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
          // Ollama streams newline-delimited JSON objects.
          const lines = buffer.split('\n');
          buffer = lines.pop(); // last line may be incomplete, keep for next chunk

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const obj = JSON.parse(trimmed);
              if (obj.message && typeof obj.message.content === 'string') {
                fullText += obj.message.content;
                onToken(obj.message.content);
              }
              if (obj.done) {
                // Nothing extra to do - 'end' event below resolves the promise.
              }
            } catch {
              // Ignore malformed partial JSON lines (shouldn't normally happen).
            }
          }
        });

        res.on('end', () => resolve(fullText));
        res.on('error', (err) => reject(new OllamaError(err.message, 'UNKNOWN')));
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new OllamaError('The request to Ollama timed out.', 'TIMEOUT'));
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        reject(
          new OllamaError(
            'Could not connect to Ollama. Is it running? Try: ollama serve',
            'CONNECTION_REFUSED'
          )
        );
      } else {
        reject(new OllamaError(err.message, 'UNKNOWN'));
      }
    });

    // Allow the caller (Stop button) to abort generation mid-stream.
    if (signal) {
      if (signal.aborted) {
        req.destroy();
        return reject(new OllamaError('Generation stopped by user.', 'ABORTED'));
      }
      signal.addEventListener('abort', () => {
        req.destroy();
        reject(new OllamaError('Generation stopped by user.', 'ABORTED'));
      });
    }

    req.write(payload);
    req.end();
  });
}

module.exports = { streamChat, checkOllamaHealth, OllamaError };
