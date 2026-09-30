const $ = (id) => document.getElementById(id);

const els = {
  wsState: $('ws-state'),
  agentSelect: $('agent-select'),
  connect: $('connect'),
  settings: $('settings'),
  settingsToggle: $('settings-toggle'),
  settingsOptions: $('settings-options'),
  newSession: $('new-session'),
  terminalToggle: $('terminal-toggle'),
  chat: $('chat'),
  composer: $('composer'),
  input: $('input'),
  send: $('send'),
  stop: $('stop'),
  authPanel: $('auth-panel'),
  authHint: $('auth-hint'),
  authActions: $('auth-actions'),
  terminal: $('terminal'),
  terminalOut: $('terminal-out'),
  terminalLine: $('terminal-line'),
  terminalSend: $('terminal-send'),
  terminalClose: $('terminal-close'),
  toast: $('toast'),
};

let agents = [];
let ws = null;
let connectedAgentId = null;
let streamingEl = null;
let activeTurn = false;
let termWs = null;
let authMethods = [];
let intentionalClose = false;
let everConnected = false;
const HISTORY_PREFIX = 'acp.history.';

function historyKey(agentId) {
  return `${HISTORY_PREFIX}${agentId}`;
}

function restoreHistory(agentId) {
  clearChat();
  try {
    const saved = JSON.parse(localStorage.getItem(historyKey(agentId)) || 'null');
    if (!saved || typeof saved.html !== 'string') return null;
    // Stored markup is parsed detached and rebuilt from a small allowlist before
    // it is placed in the live document. Pending buttons are deliberately not restored.
    const template = document.createElement('template');
    template.innerHTML = saved.html;
    const allowed = new Set(['DIV', 'DETAILS', 'SUMMARY', 'SPAN', 'PRE', 'H4']);
    const clean = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      if (!allowed.has(node.tagName) || node.matches('.perm, button, script, style')) return null;
      const copy = document.createElement(node.tagName.toLowerCase());
      if (node.className) copy.className = node.className;
      if (node.tagName === 'DETAILS' && node.open) copy.open = true;
      if (node.dataset.toolId) copy.dataset.toolId = node.dataset.toolId;
      for (const child of node.childNodes) {
        const safe = clean(child);
        if (safe) copy.appendChild(safe);
      }
      return copy;
    };
    for (const child of template.content.childNodes) {
      const safe = clean(child);
      if (safe) els.chat.appendChild(safe);
    }
    scrollDown();
    return saved;
  } catch {
    localStorage.removeItem(historyKey(agentId));
    return null;
  }
}

function saveHistory(agentId = connectedAgentId) {
  if (!agentId) return;
  try {
    const old = JSON.parse(localStorage.getItem(historyKey(agentId)) || '{}');
    localStorage.setItem(historyKey(agentId), JSON.stringify({
      sessionId: old.sessionId || null,
      html: els.chat.innerHTML.slice(-500_000),
    }));
  } catch { /* Storage may be unavailable or full; chat remains usable. */ }
}

// Die WebSocket-URL wird relativ zur aktuellen Seiten-URL gebildet, damit in
// GitHub Codespaces nie eine URL eingetragen werden muss.
function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}

function toast(message, ms = 4000) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.add('hidden'), ms);
}

function showReconnectNotice(message) {
  toast(message, 12000);
  const reconnect = document.createElement('button');
  reconnect.className = 'toast-action';
  reconnect.textContent = 'Erneut verbinden';
  reconnect.onclick = () => {
    els.settings.classList.remove('hidden');
    els.settingsToggle.setAttribute('aria-expanded', 'true');
    connect();
    els.toast.classList.add('hidden');
  };
  els.toast.appendChild(reconnect);
}

function setState(text, cls = 'muted') {
  els.wsState.textContent = text;
  els.wsState.className = cls;
}

function clearChat() {
  els.chat.innerHTML = '';
  streamingEl = null;
}

const chatObserver = new MutationObserver(() => saveHistory());
chatObserver.observe(els.chat, { childList: true, characterData: true, subtree: true });

function addMessage(role, text) {
  const follow = isNearBottom();
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  els.chat.appendChild(el);
  if (follow) scrollDown();
  return el;
}

function scrollDown() {
  els.chat.scrollTop = els.chat.scrollHeight;
}

function isNearBottom() {
  return els.chat.scrollHeight - els.chat.scrollTop - els.chat.clientHeight < 100;
}

function renderAgents(list) {
  agents = list;
  els.agentSelect.innerHTML = '';
  for (const agent of list) {
    const opt = document.createElement('option');
    opt.value = agent.id;
    opt.textContent = agent.available ? agent.name : `${agent.name} (nicht installiert)`;
    els.agentSelect.appendChild(opt);
  }
  const stored = localStorage.getItem('acp.agent');
  if (stored && list.some((a) => a.id === stored)) els.agentSelect.value = stored;
}

function currentAgent() {
  return agents.find((a) => a.id === els.agentSelect.value) || null;
}

function connect() {
  const agent = currentAgent();
  if (!agent) return;
  localStorage.setItem('acp.agent', agent.id);

  if (ws) {
    intentionalClose = true;
    ws.close();
    ws = null;
  }
  const saved = restoreHistory(agent.id);
  els.authPanel.classList.add('hidden');
  connectedAgentId = agent.id;
  setState(`verbinde mit ${agent.name} …`);

  ws = new WebSocket(wsUrl('/acp-ws'));
  const thisWs = ws;
  intentionalClose = false;
  ws.onopen = () => {
    if (ws === thisWs) thisWs.send(JSON.stringify({ type: 'connect', agentId: agent.id, sessionId: saved?.sessionId || null }));
  };
  ws.onclose = () => {
    if (ws !== thisWs) return;
    setState('getrennt', 'muted');
    activeTurn = false;
    setTurnUi(false);
    if (!intentionalClose && everConnected) showReconnectNotice('Verbindung abgebrochen.');
  };
  ws.onerror = () => { if (ws === thisWs) setState('Verbindungsfehler', 'muted'); };
  ws.onmessage = (ev) => { if (ws === thisWs) handleMessage(JSON.parse(ev.data)); };
}

function sendWs(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function setTurnUi(running) {
  activeTurn = running;
  els.stop.classList.toggle('hidden', !running);
  els.send.disabled = running;
}

function handleMessage(msg) {
  const follow = isNearBottom();
  switch (msg.type) {
    case 'hello':
      renderAgents(msg.agents);
      break;
    case 'ready':
      everConnected = true;
      setState(`${msg.agent.name} verbunden`, '');
      authMethods = msg.authMethods || [];
      addMessage('system', `${msg.agent.name} · ${msg.agentInfo?.version || ''}`.trim());
      if (msg.capabilities) {
        const caps = Object.entries(msg.capabilities)
          .filter(([, v]) => v === true)
          .map(([k]) => k);
        if (caps.length) addMessage('system', `Fähigkeiten: ${caps.join(', ')}`);
      }
      els.authPanel.classList.add('hidden');
      break;
    case 'session':
      try {
        const old = JSON.parse(localStorage.getItem(historyKey(connectedAgentId)) || '{}');
        old.sessionId = msg.sessionId;
        localStorage.setItem(historyKey(connectedAgentId), JSON.stringify({ ...old, html: els.chat.innerHTML }));
      } catch { /* Storage is optional. */ }
      els.settingsOptions.replaceChildren();
      addMessage('system', `Session ${msg.sessionId}${msg.loaded ? ' geladen' : ''}`);
      if (msg.modes?.availableModes?.length) renderModes(msg.modes);
      if (msg.configOptions?.length) renderConfigOptions(msg.configOptions);
      break;
    case 'authRequired':
      authMethods = msg.authMethods || authMethods;
      setState(`${connectedAgentId} · Anmeldung nötig`);
      showAuth();
      break;
    case 'authUrl':
      showAuthUrl(msg.url, msg.port);
      break;
    case 'elicitation':
      showElicitation(msg.elicitationId, msg.params);
      break;
    case 'authenticated':
      addMessage('system', 'Anmeldung erfolgreich.');
      els.authPanel.classList.add('hidden');
      break;
    case 'update':
      renderUpdate(msg.params);
      break;
    case 'permission':
      renderPermission(msg);
      break;
    case 'turnEnd':
      setTurnUi(false);
      streamingEl = null;
      break;
    case 'log':
      addMessage('system', msg.text);
      break;
    case 'exit':
      setState(`Agent beendet (${msg.code ?? msg.signal ?? '?'})`);
      setTurnUi(false);
      showReconnectNotice('Der Agent-Prozess wurde beendet.');
      break;
    case 'error':
      setTurnUi(false);
      addMessage('error', msg.message);
      if (msg.install) {
        const btn = document.createElement('button');
        btn.textContent = 'Jetzt installieren';
        btn.className = 'primary';
        btn.onclick = () => installAgent(connectedAgentId, btn);
        els.chat.appendChild(btn);
      }
      if (/auth|anmeldung/i.test(msg.message)) showAuth();
      break;
    case 'stopped':
      setState('gestoppt');
      break;
    default:
      break;
  }
  if (follow) scrollDown();
}

function renderUpdate(params) {
  const update = params.update || {};
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      if (update.content?.type === 'text') {
        if (!streamingEl) streamingEl = addMessage('agent', '');
        streamingEl.textContent += update.content.text;
      }
      break;
    case 'agent_thought_chunk':
      if (update.content?.type === 'text') addMessage('thought', update.content.text);
      break;
    case 'user_message_chunk':
      break;
    case 'tool_call':
      addToolCall(update);
      break;
    case 'tool_call_update':
      updateToolCall(update);
      break;
    case 'plan':
      renderPlan(update);
      break;
    case 'available_commands_update':
      renderCommands(update);
      break;
    case 'current_mode_update':
      if (update.currentModeId) {
        for (const btn of els.settingsOptions.querySelectorAll('[data-mode-id]')) {
          btn.classList.toggle('warn', btn.dataset.modeId === update.currentModeId);
        }
      }
      break;
    case 'config_option_update':
      if (update.configId) {
        const select = [...els.settingsOptions.querySelectorAll('select')].find((item) => item.dataset.configId === update.configId);
        if (select) select.value = update.value;
      }
      break;
    default:
      break;
  }
}

function addToolCall(update) {
  const el = document.createElement('details');
  el.className = 'tool';
  el.dataset.toolId = update.toolCallId;
  el.innerHTML = `<summary>${escapeHtml(update.title || update.kind || 'Tool')}<span class="tool-status">${
    update.status || 'pending'
  }</span></summary>`;
  els.chat.appendChild(el);
  streamingEl = null;
}

function updateToolCall(update) {
  const el = els.chat.querySelector(`.tool[data-tool-id="${cssEscape(update.toolCallId)}"]`);
  if (!el) return;
  const status = el.querySelector('.tool-status');
  if (status && update.status) status.textContent = update.status;
  if (update.content) {
    let pre = el.querySelector('pre');
    if (!pre) {
      pre = document.createElement('pre');
      el.appendChild(pre);
    }
    pre.textContent = extractContent(update.content);
  }
}

function extractContent(content) {
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (item.type === 'content' && item.content?.type === 'text') return item.content.text;
      if (item.type === 'diff') return `--- ${item.path}\n${item.newText ?? ''}`;
      if (item.type === 'terminal') return `[Terminal ${item.terminalId}]`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function renderPlan(update) {
  const el = document.createElement('div');
  el.className = 'tool';
  const entries = (update.entries || [])
    .map((e) => `• [${e.status}] ${e.content}`)
    .join('\n');
  el.innerHTML = `<summary>Plan</summary><pre>${escapeHtml(entries)}</pre>`;
  els.chat.appendChild(el);
}

function renderCommands(update) {
  const names = (update.availableCommands || []).map((c) => `/${c.name}`).join(' ');
  if (names) addMessage('system', `Befehle: ${names}`);
}

function renderPermission(msg) {
  const el = document.createElement('div');
  el.className = 'perm';
  el.innerHTML = `<h4>Freigabe: ${escapeHtml(msg.toolCall?.title || 'Tool-Aufruf')}</h4>`;
  const options = document.createElement('div');
  options.className = 'perm-options';
  for (const option of msg.options) {
    const btn = document.createElement('button');
    btn.textContent = option.name || option.optionId;
    if (/allow/i.test(option.kind)) btn.classList.add('allow');
    if (/reject|deny/i.test(option.kind)) btn.classList.add('reject');
    btn.onclick = () => {
      sendWs({ type: 'permission', requestId: msg.requestId, optionId: option.optionId });
      el.replaceWith(addMessage('system', `Freigabe: ${option.name}`));
    };
    options.appendChild(btn);
  }
  el.appendChild(options);
  els.chat.appendChild(el);
}

function renderModes(modes) {
  const el = document.createElement('div');
  el.className = 'option-group';
  const label = document.createElement('strong');
  label.textContent = 'Modus';
  el.appendChild(label);
  for (const mode of modes.availableModes) {
    const btn = document.createElement('button');
    btn.className = 'option-chip';
    btn.dataset.modeId = mode.id;
    btn.textContent = mode.name || mode.id;
    if (mode.id === modes.currentModeId) btn.classList.add('warn');
    btn.onclick = () => sendWs({ type: 'setMode', modeId: mode.id });
    el.appendChild(btn);
  }
  els.settingsOptions.replaceChildren(el);
}

function renderConfigOptions(configOptions) {
  const groups = [...els.settingsOptions.querySelectorAll('.option-group')];
  for (const option of configOptions) {
    const group = document.createElement('label');
    group.className = 'config-option';
    const title = document.createElement('strong');
    title.textContent = option.name || option.id;
    group.appendChild(title);
    const select = document.createElement('select');
    select.setAttribute('aria-label', option.name || option.id);
    select.dataset.configId = option.configId || option.id;
    for (const choice of option.options || []) {
      const item = document.createElement('option');
      item.value = choice.value;
      item.textContent = choice.name || choice.value;
      select.appendChild(item);
    }
    select.value = option.currentValue ?? '';
    select.disabled = !option.options?.length;
    select.onchange = () => sendWs({ type: 'setConfigOption', configId: option.configId || option.id, value: select.value });
    group.appendChild(select);
    groups.push(group);
  }
  els.settingsOptions.replaceChildren(...groups);
}

function showAuth() {
  els.authPanel.classList.remove('hidden');
  const agent = agents.find((a) => a.id === connectedAgentId);
  els.authHint.textContent = agent?.loginHint || '';
  els.authActions.innerHTML = '';

  // Vom Agenten angebotene Login-Wege (z. B. Google-Login bei Antigravity)
  // direkt als Schaltfläche anbieten – ohne separate URL-Eingabe.
  for (const method of authMethods) {
    if (/api[-_]?key/i.test(method.id)) continue; // API-Key ist hier bewusst nicht vorgesehen
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = method.name || method.id;
    btn.onclick = () => {
      addMessage('system', `Starte Login: ${method.name || method.id} …`);
      sendWs({ type: 'authenticate', methodId: method.id });
    };
    els.authActions.appendChild(btn);
  }

  if (agent?.loginCommand) {
    const btn = document.createElement('button');
    btn.textContent = `Login starten: ${agent.loginCommand}`;
    btn.onclick = () => openTerminal(agent.loginCommand);
    els.authActions.appendChild(btn);
  }
  if (agent?.install) {
    const btn = document.createElement('button');
    btn.textContent = 'Agent installieren';
    btn.onclick = () => installAgent(agent.id, btn);
    els.authActions.appendChild(btn);
  }
}

// Geräte-Code-Login: Code und Verifizierungs-URL anzeigen, danach bestätigen.
function showElicitation(elicitationId, params) {
  showAuth();
  const box = document.createElement('div');
  box.className = 'auth-url';

  const msg = document.createElement('p');
  msg.textContent = params.message || 'Bestätigung erforderlich';
  box.appendChild(msg);

  if (params.url) {
    const link = document.createElement('a');
    link.href = params.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = params.url;
    box.appendChild(link);
  }

  const btn = document.createElement('button');
  btn.className = 'primary';
  btn.textContent = 'Fertig – Anmeldung bestätigen';
  btn.onclick = () => {
    send({ type: 'elicitation', elicitationId, action: 'accept' });
    btn.disabled = true;
    btn.textContent = 'Warte auf Anmeldung …';
  };
  box.appendChild(btn);

  els.authActions.appendChild(box);
}

// Zeigt die Login-URL des Agenten und erlaubt es, die nach dem Login
// aufgerufene Loopback-Rückruf-URL einzufügen und weiterzureichen.
function showAuthUrl(url, port) {
  showAuth();
  const box = document.createElement('div');
  box.className = 'auth-url';
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Login im Google-Konto öffnen';
  box.appendChild(link);

  if (port) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = `Der Login leitet auf http://127.0.0.1:${port}/ zurück. Falls diese Seite nicht erreichbar ist, die Adresszeile des Browsers kopieren und hier einfügen.`;
    box.appendChild(note);

    const row = document.createElement('div');
    row.className = 'auth-url-row';
    const input = document.createElement('input');
    input.placeholder = 'http://127.0.0.1:' + port + '/?code=…';
    const btn = document.createElement('button');
    btn.textContent = 'Rückruf senden';
    btn.onclick = async () => {
      try {
        const res = await fetch('/api/oauth/forward', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: input.value.trim() }),
        });
        const data = await res.json();
        if (data.ok) {
          addMessage('system', 'Login bestätigt.');
          els.authPanel.classList.add('hidden');
        } else {
          toast(`Rückruf abgelehnt: ${data.error || data.status}`);
        }
      } catch (err) {
        toast(`Rückruf fehlgeschlagen: ${err.message}`);
      }
    };
    row.appendChild(input);
    row.appendChild(btn);
    box.appendChild(row);
  }
  els.authActions.appendChild(box);
}

async function installAgent(agentId, btn) {
  if (!agentId) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Installiere …';
  }
  try {
    const res = await fetch(`/api/agents/${agentId}/install`, { method: 'POST' });
    const text = await res.text();
    addMessage('system', text);
  } catch (err) {
    toast(`Installation fehlgeschlagen: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Erneut installieren';
    }
  }
}

// ---- Terminal ----
function openTerminal(prefill) {
  els.terminal.classList.remove('hidden');
  if (!termWs || termWs.readyState !== WebSocket.OPEN) {
    els.terminalOut.textContent = '';
    termWs = new WebSocket(wsUrl('/terminal-ws'));
    termWs.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'data') {
        els.terminalOut.textContent += msg.data;
        els.terminalOut.scrollTop = els.terminalOut.scrollHeight;
      } else if (msg.type === 'error') {
        els.terminalOut.textContent += `\n${msg.message}\n`;
      }
    };
  }
  if (prefill) setTimeout(() => sendTerminalLine(prefill), 600);
}

function sendTerminalLine(text) {
  if (termWs?.readyState === WebSocket.OPEN) {
    termWs.send(JSON.stringify({ type: 'input', data: `${text}\n` }));
  }
}

els.connect.onclick = connect;
els.agentSelect.onchange = () => connect();
els.settingsToggle.onclick = () => {
  const open = els.settings.classList.toggle('hidden') === false;
  els.settingsToggle.setAttribute('aria-expanded', String(open));
};
els.newSession.onclick = () => {
  clearChat();
  if (connectedAgentId) localStorage.removeItem(historyKey(connectedAgentId));
  sendWs({ type: 'newSession' });
};
els.stop.onclick = () => sendWs({ type: 'cancel' });

els.composer.onsubmit = (ev) => {
  ev.preventDefault();
  const text = els.input.value.trim();
  if (!text || activeTurn) return;
  addMessage('user', text);
  scrollDown();
  els.input.value = '';
  els.input.style.height = 'auto';
  setTurnUi(true);
  sendWs({ type: 'prompt', text });
};

els.input.addEventListener('input', () => {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, window.innerHeight * 0.4)}px`;
});
els.input.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault();
    els.composer.requestSubmit();
  }
});

els.terminalToggle.onclick = () => openTerminal();
els.terminalClose.onclick = () => els.terminal.classList.add('hidden');
els.terminalSend.onclick = () => {
  sendTerminalLine(els.terminalLine.value);
  els.terminalLine.value = '';
};
els.terminalLine.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    sendTerminalLine(els.terminalLine.value);
    els.terminalLine.value = '';
  }
});
document.querySelectorAll('.terminal-keys [data-key]').forEach((btn) => {
  btn.onclick = () => {
    const key = JSON.parse(`"${btn.dataset.key}"`);
    if (termWs?.readyState === WebSocket.OPEN) termWs.send(JSON.stringify({ type: 'input', data: key }));
  };
});

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function cssEscape(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}

// Initialverbindung, sobald die Agentenliste geladen ist.
const hello = new WebSocket(wsUrl('/acp-ws'));
hello.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'hello') {
    renderAgents(msg.agents);
    hello.close();
    if (currentAgent()?.available) connect();
    else setState('Agent auswählen');
  }
};
hello.onclose = () => {
  if (!ws) setState('Agent auswählen');
};
