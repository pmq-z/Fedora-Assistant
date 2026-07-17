/**
 * script.js
 *
 * Vanilla JS, no framework - the whole app is a handful of clearly-scoped
 * functions operating on one `state` object.
 *
 * Sections:
 *   1. State & constants
 *   2. Init / bootstrapping
 *   3. Rendering (messages, markdown, code copy buttons)
 *   4. Sending messages & streaming
 *   5. Save / Load / Delete / Search chats
 *   6. Export (.md / .json)
 *   7. Settings modal
 *   8. Templates & welcome suggestions
 *   9. Keyboard shortcuts & composer UX
 *  10. Document attach (.txt/.md/.pdf/.csv/.xlsx)
 *  11. Drag & drop import, health check, misc helpers
 */

(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // 1. State & constants
  // ---------------------------------------------------------------------

  const state = {
    messages: [],           // [{role: 'user'|'assistant', content}]
    currentFilename: null,  // set once the chat has been saved at least once
    settings: null,
    isGenerating: false,
    requestId: null,
    savedChats: [],

    documentContext: null,  // extracted text from an attached file
    documentName: null,
    documentKind: null,     // 'text' | 'markdown' | 'pdf' | 'csv' | 'spreadsheet'
  };

  const PROMPT_TEMPLATES = [
    { label: 'Explain a command', prompt: 'Can you explain what this command does, step by step, before I run it: ' },
    { label: 'Help rice KDE', prompt: 'I want to customize (rice) my KDE Plasma desktop. Walk me through choosing a theme, icons, and Kvantum setup, explaining each step.' },
    { label: 'Bash script help', prompt: 'Help me write a Bash script that ' },
    { label: 'Python help', prompt: 'Help me with this Python problem: ' },
    { label: 'Git help', prompt: 'Explain how to ' },
    { label: 'Fedora troubleshooting', prompt: 'I am having this problem on Fedora: ' },
  ];

  // Icons shown in the attached-document indicator, keyed by server-reported kind.
  const DOC_ICONS = {
    pdf: '▤',
    text: '≡',
    markdown: '#',
    csv: '▦',
    spreadsheet: '▦',
  };

  // DOM references (grabbed once)
  const el = (id) => document.getElementById(id);
  const messagesEl = el('messages');
  const welcomeEl = el('welcome');
  const composerForm = el('composerForm');
  const messageInput = el('messageInput');
  const sendBtn = el('sendBtn');
  const stopBtn = el('stopBtn');
  const chatTitleEl = el('chatTitle');
  const chatListEl = el('chatList');
  const templateListEl = el('templateList');
  const welcomeSuggestionsEl = el('welcomeSuggestions');
  const statusDot = el('statusDot');
  const statusText = el('statusText');
  const tokenCounterEl = el('tokenCounter');
  const errorBanner = el('errorBanner');
  const errorBannerText = el('errorBannerText');
  const sidebar = el('sidebar');

  const documentInput = el('documentInput');
  const attachDocBtn = el('attachDocBtn');
  const docIndicator = el('docIndicator');
  const docIndicatorIcon = el('docIndicatorIcon');
  const docIndicatorName = el('docIndicatorName');
  const removeDocBtn = el('removeDocBtn');

  marked.setOptions({
    breaks: true,
    gfm: true,
  });

  // ---------------------------------------------------------------------
  // 2. Init
  // ---------------------------------------------------------------------

  async function init() {
    renderTemplates();
    renderWelcomeSuggestions();
    bindEvents();
    autosizeTextarea();

    await Promise.all([loadSettings(), refreshChatList(), checkHealth()]);

    setInterval(checkHealth, 15000);
    setInterval(autoSave, 60000);
  }

  // ---------------------------------------------------------------------
  // 3. Rendering
  // ---------------------------------------------------------------------

  function renderAll() {
    messagesEl.innerHTML = '';
    if (state.messages.length === 0) {
      messagesEl.appendChild(welcomeEl);
      welcomeEl.hidden = false;
    } else {
      welcomeEl.hidden = true;
    }
    state.messages.forEach((msg, idx) => messagesEl.appendChild(buildMessageRow(msg, idx)));
    updateTokenCounter();
    scrollToBottom();
  }

  function buildMessageRow(msg, idx) {
    const row = document.createElement('div');
    row.className = `msg-row ${msg.role}`;
    row.dataset.index = idx;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = msg.role === 'user' ? 'usr' : '>_';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = renderMarkdown(msg.content);
    enhanceCodeBlocks(bubble);

    const actions = document.createElement('div');
    actions.className = 'bubble-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'bubble-action-btn';
    copyBtn.textContent = 'copy';
    copyBtn.onclick = () => copyToClipboard(msg.content, copyBtn);
    actions.appendChild(copyBtn);

    if (msg.role === 'assistant' && idx === state.messages.length - 1) {
      const regenBtn = document.createElement('button');
      regenBtn.className = 'bubble-action-btn';
      regenBtn.textContent = 'regenerate';
      regenBtn.onclick = regenerateLast;
      actions.appendChild(regenBtn);
    }

    const stack = document.createElement('div');
    stack.style.display = 'flex';
    stack.style.flexDirection = 'column';
    stack.style.alignItems = msg.role === 'user' ? 'flex-end' : 'flex-start';
    stack.appendChild(bubble);
    stack.appendChild(actions);

    row.appendChild(avatar);
    row.appendChild(stack);
    return row;
  }

  function renderMarkdown(text) {
    try {
      return marked.parse(text ?? '');
    } catch {
      return escapeHtml(text ?? '');
    }
  }

  function enhanceCodeBlocks(container) {
    container.querySelectorAll('pre code').forEach((codeEl) => {
      try {
        hljs.highlightElement(codeEl);
      } catch {
        /* highlighting is best-effort */
      }
      const pre = codeEl.parentElement;
      if (pre.dataset.enhanced) return;
      pre.dataset.enhanced = '1';
      const btn = document.createElement('button');
      btn.className = 'copy-code-btn';
      btn.textContent = 'copy';
      btn.onclick = () => copyToClipboard(codeEl.textContent, btn);
      pre.style.position = 'relative';
      pre.appendChild(btn);
    });
  }

  function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      if (!btn) return;
      const original = btn.textContent;
      btn.textContent = 'copied';
      setTimeout(() => (btn.textContent = original), 1200);
    });
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function updateTokenCounter() {
    // Rough heuristic: ~4 characters per token, good enough for a UI estimate.
    const totalChars = state.messages.reduce((sum, m) => sum + m.content.length, 0);
    const estTokens = Math.round(totalChars / 4);
    tokenCounterEl.textContent = `~${estTokens.toLocaleString()} tok`;
  }

  function showError(message) {
    errorBannerText.textContent = message;
    errorBanner.hidden = false;
  }
  function hideError() {
    errorBanner.hidden = true;
  }

  // ---------------------------------------------------------------------
  // 4. Sending messages & streaming
  // ---------------------------------------------------------------------

  async function sendMessage(text) {
    if (!text.trim() || state.isGenerating) return;
    hideError();

    state.messages.push({ role: 'user', content: text.trim() });
    renderAll();
    messageInput.value = '';
    autosizeTextarea();

    await generateAssistantReply();
  }

  async function generateAssistantReply() {
    state.isGenerating = true;
    state.requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    toggleSendStop(true);

    // Placeholder assistant message that we fill in as tokens stream.
    const assistantMsg = { role: 'assistant', content: '' };
    state.messages.push(assistantMsg);
    renderAll();
    const lastRow = messagesEl.querySelector(`.msg-row[data-index="${state.messages.length - 1}"] .bubble`);
    showTypingIndicator(lastRow);

    const controller = new AbortController();
    state.abortController = controller;

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: state.messages.slice(0, -1).map(({ role, content }) => ({ role, content })),
          requestId: state.requestId,
          documentContext: state.documentContext,
          documentName: state.documentName,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const errJson = await safeJson(response);
        throw new Error(errJson?.error || `Server responded with ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let firstToken = true;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          if (evt.type === 'token') {
            if (firstToken) {
              firstToken = false;
              lastRow.innerHTML = '';
            }
            assistantMsg.content += evt.content;
            // Blinking block cursor at the end while text is still streaming in.
            lastRow.innerHTML = renderMarkdown(assistantMsg.content) + '<span class="stream-cursor"></span>';
            enhanceCodeBlocks(lastRow);
            scrollToBottom();
          } else if (evt.type === 'error') {
            showError(evt.message);
          } else if (evt.type === 'done') {
            // stream finished normally (or was stopped server-side)
          }
        }
      }

      if (!assistantMsg.content.trim()) {
        assistantMsg.content = '_(no response - the model returned nothing)_';
      }
      renderAll(); // final render drops the streaming cursor and adds action buttons
    } catch (err) {
      if (err.name === 'AbortError') {
        assistantMsg.content = assistantMsg.content || '_Generation stopped._';
        renderAll();
      } else {
        showError(err.message || 'Something went wrong talking to Ollama.');
        // Remove the empty placeholder so we don't leave a broken bubble.
        if (!assistantMsg.content.trim()) {
          state.messages.pop();
          renderAll();
        }
      }
    } finally {
      state.isGenerating = false;
      state.requestId = null;
      toggleSendStop(false);
    }
  }

  function showTypingIndicator(bubbleEl) {
    bubbleEl.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  }

  function toggleSendStop(generating) {
    sendBtn.hidden = generating;
    stopBtn.hidden = !generating;
  }

  async function stopGeneration() {
    if (state.abortController) state.abortController.abort();
    if (state.requestId) {
      try {
        await fetch('/api/chat/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: state.requestId }),
        });
      } catch {
        /* best effort */
      }
    }
  }

  async function regenerateLast() {
    if (state.isGenerating) return;
    const lastAssistantIdx = [...state.messages].reverse().findIndex((m) => m.role === 'assistant');
    if (lastAssistantIdx === -1) return;
    state.messages.pop(); // remove the last assistant message
    renderAll();
    await generateAssistantReply();
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------
  // 5. Save / Load / Delete / Search chats
  // ---------------------------------------------------------------------

  async function saveChat() {
    if (state.messages.length === 0) return;
    try {
      const res = await fetch('/api/chats/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: state.messages, filename: state.currentFilename }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      state.currentFilename = data.filename;
      chatTitleEl.textContent = data.filename.replace(/\.txt$/, '');
      await refreshChatList();
      flashSaved();
    } catch (err) {
      showError(`Could not save chat: ${err.message}`);
    }
  }

  async function autoSave() {
    if (state.messages.length > 0 && !state.isGenerating) {
      await saveChat();
    }
  }

  function flashSaved() {
    const original = el('saveChatBtn').textContent;
    el('saveChatBtn').textContent = 'saved ✓';
    setTimeout(() => (el('saveChatBtn').textContent = original), 1200);
  }

  async function refreshChatList(query) {
    try {
      const url = query ? `/api/chats/search?q=${encodeURIComponent(query)}` : '/api/chats';
      const res = await fetch(url);
      const data = await res.json();
      state.savedChats = data;
      renderChatList(data, Boolean(query));
    } catch {
      chatListEl.innerHTML = '<div class="chat-list-empty">could not load saved chats</div>';
    }
  }

  function renderChatList(items, isSearchResult) {
    chatListEl.innerHTML = '';
    if (!items.length) {
      chatListEl.innerHTML = `<div class="chat-list-empty">${isSearchResult ? 'no matches' : 'no saved sessions yet'}</div>`;
      return;
    }
    items.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'chat-item' + (item.filename === state.currentFilename ? ' active' : '');
      div.innerHTML = `
        <div class="chat-item-name">${escapeHtml(item.filename)}</div>
        <div class="chat-item-preview">${escapeHtml(item.snippet || item.preview || '')}</div>
      `;
      div.onclick = () => loadChat(item.filename);

      const delBtn = document.createElement('button');
      delBtn.className = 'chat-item-delete';
      delBtn.textContent = '✕';
      delBtn.title = 'Delete chat';
      delBtn.onclick = (e) => {
        e.stopPropagation();
        deleteChat(item.filename);
      };
      div.appendChild(delBtn);

      chatListEl.appendChild(div);
    });
  }

  async function loadChat(filename) {
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(filename)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      state.messages = data.messages;
      state.currentFilename = data.filename;
      chatTitleEl.textContent = data.filename.replace(/\.txt$/, '');
      renderAll();
      closeModal('openChatModal');
      refreshChatList();
    } catch (err) {
      showError(`Could not load chat: ${err.message}`);
    }
  }

  async function deleteChat(filename) {
    try {
      await fetch(`/api/chats/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      if (state.currentFilename === filename) {
        state.currentFilename = null;
      }
      refreshChatList();
    } catch (err) {
      showError(`Could not delete chat: ${err.message}`);
    }
  }

  function newChat() {
    state.messages = [];
    state.currentFilename = null;
    chatTitleEl.textContent = 'new_session';
    clearDocument();
    renderAll();
  }

  // ---------------------------------------------------------------------
  // 6. Export (.md / .json) - saves to /chats and triggers a browser download
  // ---------------------------------------------------------------------

  async function exportChat(format) {
    if (state.messages.length === 0) return;
    try {
      const res = await fetch(`/api/chats/export/${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: state.messages }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      downloadBlob(data.content, data.filename, format === 'md' ? 'text/markdown' : 'application/json');
    } catch (err) {
      showError(`Could not export as ${format}: ${err.message}`);
    }
  }

  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------
  // 7. Settings modal
  // ---------------------------------------------------------------------

  async function loadSettings() {
    const res = await fetch('/api/settings');
    state.settings = await res.json();
    applyTheme(state.settings.theme);
  }

  function openSettingsModal() {
    el('settingModel').value = state.settings.model;
    el('settingEndpoint').value = state.settings.endpoint;
    el('settingTemperature').value = state.settings.temperature;
    el('settingTopP').value = state.settings.top_p;
    el('settingMaxTokens').value = state.settings.max_tokens;
    el('settingTheme').value = state.settings.theme;
    el('tempVal').textContent = state.settings.temperature;
    el('topPVal').textContent = state.settings.top_p;
    openModal('settingsModal');
  }

  async function saveSettingsFromModal() {
    const payload = {
      model: el('settingModel').value,
      endpoint: el('settingEndpoint').value,
      temperature: parseFloat(el('settingTemperature').value),
      top_p: parseFloat(el('settingTopP').value),
      max_tokens: parseInt(el('settingMaxTokens').value, 10),
      theme: el('settingTheme').value,
    };
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    state.settings = await res.json();
    applyTheme(state.settings.theme);
    closeModal('settingsModal');
    checkHealth();
  }

  function applyTheme(theme) {
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : theme;
    document.body.dataset.theme = resolved;
  }

  // ---------------------------------------------------------------------
  // 8. Templates & welcome suggestions
  // ---------------------------------------------------------------------

  function renderTemplates() {
    templateListEl.innerHTML = '';
    PROMPT_TEMPLATES.forEach((tpl) => {
      const btn = document.createElement('button');
      btn.className = 'template-chip';
      btn.textContent = tpl.label;
      btn.onclick = () => {
        messageInput.value = tpl.prompt;
        messageInput.focus();
        autosizeTextarea();
        if (window.innerWidth <= 860) sidebar.classList.remove('open');
      };
      templateListEl.appendChild(btn);
    });
  }

  function renderWelcomeSuggestions() {
    welcomeSuggestionsEl.innerHTML = '';
    const picks = [
      'How do I install Fish shell on Fedora?',
      'Help me set up a Kvantum theme for KDE Plasma',
      'Explain what sudo dnf upgrade --refresh does',
      'How do I get transparency working in Konsole?',
    ];
    picks.forEach((text) => {
      const chip = document.createElement('button');
      chip.className = 'suggestion-chip';
      chip.textContent = text;
      chip.onclick = () => sendMessage(text);
      welcomeSuggestionsEl.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------------
  // 9. Keyboard shortcuts & composer UX
  // ---------------------------------------------------------------------

  function autosizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
  }

  function bindEvents() {
    attachDocBtn.addEventListener('click', () => {
      if (!state.isGenerating) documentInput.click();
    });
    documentInput.addEventListener('change', handleDocumentUpload);
    removeDocBtn.addEventListener('click', clearDocument);

    composerForm.addEventListener('submit', (e) => {
      e.preventDefault();
      sendMessage(messageInput.value);
    });

    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(messageInput.value);
      }
    });
    messageInput.addEventListener('input', autosizeTextarea);

    stopBtn.addEventListener('click', stopGeneration);
    el('newChatBtn').addEventListener('click', newChat);
    el('saveChatBtn').addEventListener('click', saveChat);
    el('exportMdBtn').addEventListener('click', () => exportChat('md'));
    el('exportJsonBtn').addEventListener('click', () => exportChat('json'));

    el('settingsBtn').addEventListener('click', openSettingsModal);
    el('settingsCloseBtn').addEventListener('click', () => closeModal('settingsModal'));
    el('settingsCancelBtn').addEventListener('click', () => closeModal('settingsModal'));
    el('settingsSaveBtn').addEventListener('click', saveSettingsFromModal);
    el('settingTemperature').addEventListener('input', (e) => (el('tempVal').textContent = e.target.value));
    el('settingTopP').addEventListener('input', (e) => (el('topPVal').textContent = e.target.value));

    el('chatSearchInput').addEventListener('input', debounce((e) => refreshChatList(e.target.value), 250));

    el('errorBannerClose').addEventListener('click', hideError);

    el('sidebarToggle').addEventListener('click', () => sidebar.classList.toggle('open'));

    // Open-chat modal (Ctrl+O)
    el('openChatCloseBtn').addEventListener('click', () => closeModal('openChatModal'));
    el('openChatSearch').addEventListener('input', debounce(async (e) => {
      const res = await fetch(`/api/chats/search?q=${encodeURIComponent(e.target.value)}`);
      const items = e.target.value ? await res.json() : state.savedChats;
      renderOpenChatModalList(items);
    }, 200));

    document.addEventListener('keydown', handleGlobalShortcuts);

    // Drag & drop .txt import anywhere over the messages pane.
    messagesEl.addEventListener('dragover', (e) => e.preventDefault());
    messagesEl.addEventListener('drop', handleFileDrop);

    window.addEventListener('beforeunload', () => {
      // Best-effort autosave on close; not guaranteed but harmless to try.
      if (state.messages.length > 0) navigator.sendBeacon?.('/api/chats/save', JSON.stringify({ messages: state.messages, filename: state.currentFilename }));
    });
  }

  function handleGlobalShortcuts(e) {
    const ctrlOrCmd = e.ctrlKey || e.metaKey;
    if (!ctrlOrCmd) return;

    if (e.key === 'n') {
      e.preventDefault();
      newChat();
    } else if (e.key === 's') {
      e.preventDefault();
      saveChat();
    } else if (e.key === 'o') {
      e.preventDefault();
      openOpenChatModal();
    } else if (e.key === ',') {
      e.preventDefault();
      openSettingsModal();
    }
  }

  function openOpenChatModal() {
    renderOpenChatModalList(state.savedChats);
    openModal('openChatModal');
    el('openChatSearch').value = '';
    el('openChatSearch').focus();
  }

  function renderOpenChatModalList(items) {
    const list = el('openChatList');
    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = '<div class="chat-list-empty">no saved sessions</div>';
      return;
    }
    items.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'chat-item';
      div.innerHTML = `
        <div class="chat-item-name">${escapeHtml(item.filename)}</div>
        <div class="chat-item-preview">${escapeHtml(item.snippet || item.preview || '')}</div>
      `;
      div.onclick = () => loadChat(item.filename);
      list.appendChild(div);
    });
  }

  // ---------------------------------------------------------------------
  // 10. Document attach (.txt / .md / .pdf / .csv / .xlsx) - fully offline,
  //     the file is parsed server-side by routes/chat.js's /document
  //     endpoint and never leaves the machine.
  // ---------------------------------------------------------------------

  const SUPPORTED_DOC_EXTENSIONS = ['.txt', '.md', '.markdown', '.pdf', '.csv', '.xlsx', '.xls'];

  async function handleDocumentUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!SUPPORTED_DOC_EXTENSIONS.includes(ext)) {
      showError('Supported formats: .txt, .md, .pdf, .csv, .xlsx, .xls');
      documentInput.value = '';
      return;
    }

    hideError();
    attachDocBtn.disabled = true;
    attachDocBtn.textContent = '…';

    const formData = new FormData();
    formData.append('document', file);

    try {
      const response = await fetch('/api/chat/document', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The file could not be read.');

      state.documentContext = data.text;
      state.documentName = data.filename;
      state.documentKind = data.kind;

      docIndicatorIcon.textContent = DOC_ICONS[data.kind] || '▤';
      docIndicatorName.textContent =
        `${data.filename} · ${data.meta}` + (data.truncated ? ' · truncated' : '');
      docIndicator.hidden = false;

      messageInput.placeholder = 'ask something about the attached file…';
      messageInput.focus();
    } catch (error) {
      clearDocument();
      showError(error.message);
    } finally {
      attachDocBtn.disabled = false;
      attachDocBtn.textContent = '⎗';
      documentInput.value = '';
    }
  }

  function clearDocument() {
    state.documentContext = null;
    state.documentName = null;
    state.documentKind = null;

    docIndicator.hidden = true;
    docIndicatorName.textContent = '';
    documentInput.value = '';

    messageInput.placeholder = 'ask about fedora, kde, ricing, scripting, or an attached file…';
  }

  // ---------------------------------------------------------------------
  // 11. Drag & drop import, health check, misc helpers
  // ---------------------------------------------------------------------

  function handleFileDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.name.endsWith('.txt')) {
      showError('Only .txt conversation exports can be imported by drag & drop.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseTxtTranscript(reader.result);
      if (parsed.length === 0) {
        showError('That file did not look like a saved conversation.');
        return;
      }
      state.messages = parsed;
      state.currentFilename = null; // treat as unsaved until the user saves it
      chatTitleEl.textContent = file.name.replace(/\.txt$/, '') + ' (imported)';
      renderAll();
    };
    reader.readAsText(file);
  }

  /** Mirrors the server-side parser in routes/chats.js so imports work client-side too. */
  function parseTxtTranscript(text) {
    const blocks = text.split('------------------------').map((b) => b.trim()).filter(Boolean);
    const messages = [];
    for (const block of blocks) {
      const userMatch = block.match(/^User:\s*\n\n([\s\S]*)/);
      const assistantMatch = block.match(/^Assistant:\s*\n\n([\s\S]*)/);
      if (userMatch) messages.push({ role: 'user', content: userMatch[1].trim() });
      else if (assistantMatch) messages.push({ role: 'assistant', content: assistantMatch[1].trim() });
    }
    return messages;
  }

  async function checkHealth() {
    try {
      const res = await fetch('/api/chat/health');
      const data = await res.json();
      if (data.online) {
        statusDot.className = 'status-dot online';
        statusText.textContent = 'ollama connected';
      } else {
        statusDot.className = 'status-dot offline';
        statusText.textContent = 'ollama unreachable';
      }
    } catch {
      statusDot.className = 'status-dot offline';
      statusText.textContent = 'ollama unreachable';
    }
  }

  function openModal(id) { el(id).hidden = false; }
  function closeModal(id) { el(id).hidden = true; }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  document.addEventListener('DOMContentLoaded', init);
})();
