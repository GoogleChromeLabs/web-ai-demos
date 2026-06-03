// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Google LLC

const chatEl = document.getElementById('chat');
const statusEl = document.getElementById('status');
const dlProgress = document.getElementById('dl-progress');
const tokenLabel = document.getElementById('token-label');
const tokenFill = document.getElementById('token-fill');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const compactBtn = document.getElementById('compact-btn');
const compactLog = document.getElementById('compact-log');
const preRegular = document.getElementById('pre-regular');
const preCompacted = document.getElementById('pre-compacted');

// history: current session's view (replaced with compacted entries on each compaction).
// fullHistory: every message in its original, unsummarized form — never replaced.
// lastCompacted: the compacted snapshot from the most recent compaction.
const history = [];
const fullHistory = [];
let lastCompacted = null;

let session = null;
const summarizers = {}; // keyed by `${format}:${lang}`
let languageDetector = null;
let busy = false;

// ─── UI helpers ──────────────────────────────────────────────────────────────

function setStatus(text) {
  statusEl.textContent = text;
}

function setDownloadProgress(loaded, total) {
  dlProgress.style.display = 'block';
  dlProgress.value = loaded;
  dlProgress.max = total;
}

function hideDownloadProgress() {
  dlProgress.style.display = 'none';
}

function updateTokenDisplay() {
  if (!session) return;
  const usage = session.contextUsage;
  const window = session.contextWindow;
  const pct = window > 0 ? usage / window : 0;
  tokenLabel.textContent = `Context: ${Math.round(usage)} / ${Math.round(window)} tokens (${Math.round(pct * 100)}%)`;
  tokenFill.style.width = `${pct * 100}%`;
  tokenFill.className = pct >= 0.85 ? 'danger' : pct >= 0.65 ? 'warn' : '';
}

function appendChatMessage(role, content) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = role === 'user' ? 'You: ' : 'AI:  ';
  const text = document.createElement('span');
  text.textContent = content;
  div.appendChild(label);
  div.appendChild(text);
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
  return text; // return the text node so streaming can update it
}

function appendSystemMessage(content) {
  const div = document.createElement('div');
  div.className = 'msg system';
  div.textContent = content;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function refreshDebugView() {
  preRegular.textContent = JSON.stringify(fullHistory, null, 2);
  preCompacted.textContent = lastCompacted
    ? JSON.stringify(lastCompacted, null, 2)
    : '(not yet compacted)';
}

function looksLikeMarkdown(text) {
  return /(?:^#{1,6} |^[-*+] |\d+\. |\*\*|__|\[.+?\]\(|^> |^```)/m.test(text);
}

// Splits text into alternating prose and code-fence segments.
// Returns [{ type: 'prose'|'code', content: string }, …]
function splitByCodeFences(text) {
  const parts = [];
  const re = /^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm;
  let lastIndex = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: 'prose',
        content: text.slice(lastIndex, match.index),
      });
    }
    parts.push({ type: 'code', content: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'prose', content: text.slice(lastIndex) });
  }
  return parts;
}

async function summarizeText(text, role, summarizer) {
  const summary = await summarizer.summarize(
    text.trim().replace(/\n{3,}/g, '\n\n'),
    {
      context:
        `This is a ${role} turn from a chat conversation. ` +
        `Preserve its key meaning as concisely as possible.`,
    }
  );
  const trimmed = summary.trim();
  return trimmed.length < text.length ? trimmed : text;
}

// Summarizes prose segments, passes code fences through verbatim.
async function summarizeWithCodeFences(content, role, summarizer) {
  const parts = splitByCodeFences(content);

  // Fast path: no code fences present.
  if (parts.length === 1) {
    return summarizeText(parts[0].content, role, summarizer);
  }

  const out = [];
  for (const part of parts) {
    if (part.type === 'code') {
      out.push(part.content.trim());
    } else {
      const prose = part.content.trim();
      if (prose) out.push(await summarizeText(prose, role, summarizer));
    }
  }
  return out.join('\n\n');
}

async function getSummarizer(format, lang) {
  const key = `${format}:${lang}`;
  if (summarizers[key]) return summarizers[key];

  setStatus('Checking Summarizer API availability…');
  const sumOptions = {
    type: 'tldr',
    format,
    length: 'short',
    preference: 'speed',
    expectedInputLanguages: [lang],
    outputLanguage: lang,
  };
  const sumAvail = await Summarizer.availability(sumOptions);

  if (sumAvail === 'unavailable') {
    throw new Error('Summarizer API is unavailable on this device.');
  }

  setStatus(
    sumAvail !== 'available'
      ? `Summarizer is ${sumAvail}. Downloading…`
      : `Creating ${format} summarizer…`
  );

  summarizers[key] = await Summarizer.create({
    ...sumOptions,
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        setDownloadProgress(e.loaded, e.total);
        setStatus(
          `Downloading summarizer: ${Math.round((e.loaded / e.total) * 100)}%`
        );
      });
    },
  });

  hideDownloadProgress();
  return summarizers[key];
}

async function getLanguageDetector() {
  if (languageDetector) return languageDetector;

  setStatus('Checking Language Detector API availability…');
  const avail = await LanguageDetector.availability();

  if (avail === 'unavailable') {
    throw new Error('Language Detector API is unavailable on this device.');
  }

  setStatus(
    avail !== 'available'
      ? `Language Detector is ${avail}. Downloading…`
      : 'Creating language detector…'
  );

  languageDetector = await LanguageDetector.create({
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        setDownloadProgress(e.loaded, e.total);
        setStatus(
          `Downloading language detector: ${Math.round((e.loaded / e.total) * 100)}%`
        );
      });
    },
  });

  hideDownloadProgress();
  return languageDetector;
}

// Returns the top detected language tag if confidence ≥ threshold, else null.
async function detectLanguage(text, threshold = 0.7) {
  const detector = await getLanguageDetector();
  const results = await detector.detect(text);
  if (results.length > 0 && results[0].confidence >= threshold) {
    return results[0].detectedLanguage;
  }
  return null;
}

function setControls(enabled) {
  userInput.disabled = !enabled;
  sendBtn.disabled = !enabled;
  compactBtn.disabled = !enabled;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  setStatus('Checking Prompt API availability…');

  if (typeof LanguageModel === 'undefined') {
    setStatus(
      'LanguageModel API not found. Enable it in Chrome flags or use a supported build.'
    );
    return;
  }

  const navLang = navigator.language;
  const langOptions = {
    expectedInputs: [{ type: 'text', languages: [navLang] }],
    expectedOutputs: [{ type: 'text', languages: [navLang] }],
  };

  const avail = await LanguageModel.availability(langOptions);

  if (avail === 'unavailable') {
    setStatus('LanguageModel is unavailable on this device.');
    return;
  }

  if (avail !== 'available') {
    setStatus(`Model is ${avail}. Downloading…`);
  }

  session = await LanguageModel.create({
    ...langOptions,
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        setDownloadProgress(e.loaded, e.total);
        setStatus(
          `Downloading model: ${Math.round((e.loaded / e.total) * 100)}%`
        );
      });
    },
  });

  hideDownloadProgress();
  updateTokenDisplay();
  setStatus('Ready.');
  setControls(true);
  userInput.focus();

  session.oncontextoverflow = () => {
    appendSystemMessage(
      '⚠ Context window nearly full. Consider compacting the session.'
    );
  };
}

// ─── Send message ─────────────────────────────────────────────────────────────

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || busy) return;

  busy = true;
  userInput.value = '';
  setControls(false);

  appendChatMessage('user', text);
  history.push({ role: 'user', content: text });
  fullHistory.push({ role: 'user', content: text });
  refreshDebugView();

  const aiTextNode = appendChatMessage('assistant', '…');

  try {
    const stream = session.promptStreaming(text);
    let full = '';
    for await (const chunk of stream) {
      full += chunk;
      aiTextNode.textContent = full;
      chatEl.scrollTop = chatEl.scrollHeight;
      updateTokenDisplay();
    }
    history.push({ role: 'assistant', content: full });
    fullHistory.push({ role: 'assistant', content: full });
    updateTokenDisplay();
    refreshDebugView();
  } catch (err) {
    aiTextNode.textContent = `[error: ${err.message}]`;
  }

  busy = false;
  setControls(true);
  userInput.focus();
}

// ─── Compact session ──────────────────────────────────────────────────────────

async function compactSession() {
  if (busy || history.length === 0) return;

  busy = true;
  setControls(false);

  const beforeUsage = session.contextUsage;
  const beforeWindow = session.contextWindow;

  appendSystemMessage(
    `Compacting… (before: ${Math.round(beforeUsage)} / ${Math.round(beforeWindow)} tokens)`
  );

  try {
    // ── 1. Detect languages, then summarize every message ───────────────────
    // getSummarizer() lazily creates and caches a summarizer per format+lang.
    // looksLikeMarkdown() picks the format so formatting is preserved.
    // detectLanguage() returns null when confidence < 0.7 — fall back to
    // navigator.language in that case but don't count it as "confident".
    setStatus(`Summarizing ${history.length} messages…`);
    const compacted = [];
    const confidentLangs = new Set();
    const fallbackLang = navigator.language;

    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      setStatus(`Detecting language of message ${i + 1} of ${history.length}…`);

      const detectedLang = await detectLanguage(msg.content);
      const lang = detectedLang ?? fallbackLang;
      if (detectedLang) confidentLangs.add(detectedLang);

      setStatus(`Summarizing message ${i + 1} of ${history.length}…`);

      const format = looksLikeMarkdown(msg.content) ? 'markdown' : 'plain-text';
      const summarizer = await getSummarizer(format, lang);

      const content = await summarizeWithCodeFences(
        msg.content,
        msg.role,
        summarizer
      );
      compacted.push({ role: msg.role, content });
    }

    // ── 2. Destroy old session and create a new one ─────────────────────────
    session.destroy();
    session = null;

    setStatus('Creating new session with compacted history…');

    // Seed the new session with the languages we were confident about;
    // fall back to navigator.language if detection yielded nothing.
    const sessionLangs =
      confidentLangs.size > 0 ? [...confidentLangs] : [fallbackLang];
    const sessionLangOptions = {
      expectedInputs: [{ type: 'text', languages: sessionLangs }],
      expectedOutputs: [{ type: 'text', languages: sessionLangs }],
    };

    session = await LanguageModel.create({
      ...sessionLangOptions,
      initialPrompts: compacted.map(({ role, content }) => ({ role, content })),
    });

    session.oncontextoverflow = () => {
      appendSystemMessage(
        '⚠ Context window nearly full. Consider compacting the session.'
      );
    };

    // ── 3. Update local history and debug snapshot ──────────────────────────
    history.length = 0;
    history.push(...compacted);
    lastCompacted = compacted.map((m) => ({ ...m }));
    refreshDebugView();

    // ── 4. Show stats ───────────────────────────────────────────────────────
    const afterUsage = session.contextUsage;
    const afterWindow = session.contextWindow;
    const saved = beforeUsage - afterUsage;
    const reductionPct =
      beforeUsage > 0 ? Math.round((saved / beforeUsage) * 100) : 0;

    updateTokenDisplay();

    const entry = document.createElement('div');
    entry.className = 'compact-entry';

    const title = document.createElement('div');
    title.className = 'entry-title';
    title.textContent = `Compaction #${compactLog.children.length + 1}`;

    const table = document.createElement('table');
    const rows = [
      [
        'Before',
        `${Math.round(beforeUsage)} / ${Math.round(beforeWindow)} tokens`,
      ],
      [
        'After',
        `${Math.round(afterUsage)} / ${Math.round(afterWindow)} tokens`,
      ],
      ['Saved', `${Math.round(saved)} tokens`],
      ['Reduction', `${reductionPct}%`],
      ['Messages', `${compacted.length}`],
      ['Languages', sessionLangs.join(', ')],
    ];

    for (const [label, value] of rows) {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.textContent = label;
      const td2 = document.createElement('td');
      td2.textContent = value;
      if (label === 'Reduction') {
        td2.className = reductionPct >= 0 ? 'reduction' : 'reduction bad';
      }
      tr.appendChild(td1);
      tr.appendChild(td2);
      table.appendChild(tr);
    }

    entry.appendChild(title);
    entry.appendChild(table);
    compactLog.appendChild(entry);

    appendSystemMessage(
      `Session compacted. After: ${Math.round(afterUsage)} / ${Math.round(afterWindow)} tokens` +
        ` (${reductionPct}% reduction).`
    );
    setStatus('Session compacted. Ready.');
  } catch (err) {
    appendSystemMessage(`[Compaction error] ${err.message}`);
    setStatus('Compaction failed.');
    // If session was destroyed but not recreated, we need to recover.
    if (!session) {
      try {
        setStatus('Recovering session from history…');
        session = await LanguageModel.create({
          initialPrompts: history.map(({ role, content }) => ({
            role,
            content,
          })),
        });
        session.oncontextoverflow = () => {
          appendSystemMessage(
            '⚠ Context window nearly full. Consider compacting the session.'
          );
        };
        updateTokenDisplay();
        setStatus('Session recovered. Ready.');
      } catch (recoverErr) {
        setStatus(`Recovery failed: ${recoverErr.message}`);
      }
    }
  }

  busy = false;
  setControls(true);
  userInput.focus();
}

// ─── Event listeners ──────────────────────────────────────────────────────────

sendBtn.addEventListener('click', sendMessage);

userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

compactBtn.addEventListener('click', compactSession);

// ─── Bootstrap ────────────────────────────────────────────────────────────────

init();
