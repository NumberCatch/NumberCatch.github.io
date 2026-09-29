import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { AgentBridge, isAuthError } from './acp-bridge.js';
import { config, getAgent, ROOT } from './config.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function commandExists(command) {
  if (command.includes('/')) {
    return spawnSync('test', ['-x', command]).status === 0;
  }
  return spawnSync('sh', ['-c', `command -v ${JSON.stringify(command)}`]).status === 0;
}

function agentList() {
  return config.agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    icon: agent.icon,
    command: agent.command,
    available: commandExists(agent.command),
    install: agent.install,
    loginCommand: agent.loginCommand,
    loginHint: agent.loginHint,
  }));
}

async function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(ROOT, 'public', safe);
  if (!filePath.startsWith(join(ROOT, 'public'))) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
  }
}

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (pathname === '/api/agents' && req.method === 'GET') {
    return json(res, 200, { agents: agentList(), workspace: config.workspace });
  }

  // Reicht die nach dem Google-Login aufgerufene Loopback-Rückruf-URL an den
  // wartenden OAuth-Server des Agenten weiter.
  if (pathname === '/api/oauth/forward' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const { url } = JSON.parse(body || '{}');
      if (!url) return json(res, 400, { error: 'url fehlt' });
      const result = await forwardOauthCallback(url);
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  const installMatch = pathname.match(/^\/api\/agents\/([\w-]+)\/install$/);
  if (installMatch && req.method === 'POST') {
    const agent = getAgent(installMatch[1]);
    if (!agent) return json(res, 404, { error: 'Unbekannter Agent' });
    if (!agent.install) return json(res, 400, { error: 'Kein Installationsbefehl hinterlegt' });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'x-accel-buffering': 'no' });
    const child = spawn('bash', ['-lc', agent.install], {
      cwd: ROOT,
      env: { ...process.env, ACP_HOME: config.home, UID: String(process.getuid?.() ?? '') },
    });
    child.stdout.on('data', (d) => res.write(d));
    child.stderr.on('data', (d) => res.write(d));
    child.on('close', (code) => {
      res.write(`\n[Installation beendet mit Code ${code}]\n`);
      res.end();
    });
    return;
  }

  return serveStatic(req, res, pathname);
});

// ---- ACP chat bridge (ein Bridge-Objekt pro WebSocket-Verbindung) ----
const acpWss = new WebSocketServer({ noServer: true });
const activeBridges = new Set();

function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

// ACP-Agenten melden fehlende Anmeldung als Fehler beim Session-Aufbau.
// In diesem Fall wird kein harter Fehler gemeldet, sondern der Login angeboten;
// nach erfolgreicher Anmeldung wird die Session erneut angelegt.
async function startSession(ws, bridge) {
  try {
    const session = await bridge.newSession();
    send(ws, {
      type: 'session',
      sessionId: session.sessionId,
      modes: session.modes || null,
      configOptions: session.configOptions || null,
    });
    return true;
  } catch (err) {
    if (isAuthError(err)) {
      send(ws, { type: 'authRequired', authMethods: bridge.authMethods });
      return false;
    }
    throw err;
  }
}

// Manche Agenten (z. B. Antigravity) starten einen OAuth-Loopback-Login und
// drucken die Autorisierungs-URL nach stderr. Der Rückruf zeigt auf
// http://127.0.0.1:<port> und ist vom Handy aus nicht erreichbar. Deshalb wird
// die URL in der Oberfläche angezeigt; die nach dem Login aufgerufene
// Rückruf-URL kann dort eingefügt und vom Server an den Loopback-Port
// weitergereicht werden (/api/oauth/forward).
function extractAuthUrl(text) {
  const match = text.match(/https:\/\/accounts\.google\.com\/\S+/);
  if (!match) return null;
  const url = match[0].replace(/[),.;]+$/, '');
  const portMatch = url.match(/redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A(\d+)/);
  return { url, port: portMatch ? Number(portMatch[1]) : null };
}

const LOOPBACK_URL = /^http:\/\/127\.0\.0\.1:(\d+)\//;

async function forwardOauthCallback(rawUrl) {
  const target = new URL(rawUrl);
  const local = `http://127.0.0.1:${target.port}${target.pathname}${target.search}`;
  if (!LOOPBACK_URL.test(local)) throw new Error('Nur Loopback-Rückrufe erlaubt');
  const res = await fetch(local);
  return { ok: res.ok, status: res.status };
}

acpWss.on('connection', (ws) => {
  let bridge = null;

  const detach = () => {
    if (!bridge) return;
    activeBridges.delete(bridge);
    bridge.removeAllListeners();
    bridge.stop();
    bridge = null;
  };

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: 'error', message: 'Ungültige Nachricht' });
    }

    try {
      switch (msg.type) {
        case 'connect': {
          detach();
          const agent = getAgent(msg.agentId);
          if (!agent) return send(ws, { type: 'error', message: `Unbekannter Agent: ${msg.agentId}` });
          if (!commandExists(agent.command)) {
            return send(ws, {
              type: 'error',
              message: `${agent.name} ist nicht installiert. Bitte zuerst installieren.`,
              install: agent.install,
            });
          }
          bridge = new AgentBridge(agent);
          activeBridges.add(bridge);
          bridge.on('update', (params) => send(ws, { type: 'update', params }));
          bridge.on('permission', (params) => send(ws, { type: 'permission', ...params }));
          bridge.on('log', (params) => {
            const auth = extractAuthUrl(params.text || '');
            if (auth) {
              send(ws, { type: 'authUrl', url: auth.url, port: auth.port });
            } else {
              send(ws, { type: 'log', ...params });
            }
          });
          bridge.on('exit', (params) => send(ws, { type: 'exit', ...params }));
          bridge.on('error', (params) => send(ws, { type: 'error', ...params }));
          bridge.on('elicitation', ({ elicitationId, params }) =>
            send(ws, { type: 'elicitation', elicitationId, params }),
          );

          await bridge.start();
          send(ws, {
            type: 'ready',
            agent: { id: agent.id, name: agent.name },
            agentInfo: bridge.agentInfo,
            authMethods: bridge.authMethods,
            capabilities: bridge.agentCapabilities,
          });
          await startSession(ws, bridge);
          break;
        }
        case 'prompt': {
          if (!bridge) return send(ws, { type: 'error', message: 'Nicht verbunden' });
          const result = await bridge.prompt(msg.text);
          send(ws, { type: 'turnEnd', stopReason: result.stopReason });
          break;
        }
        case 'cancel':
          await bridge?.cancel();
          break;
        case 'newSession': {
          if (!bridge) return send(ws, { type: 'error', message: 'Nicht verbunden' });
          await startSession(ws, bridge);
          break;
        }
        case 'loadSession': {
          if (!bridge) return send(ws, { type: 'error', message: 'Nicht verbunden' });
          const session = await bridge.loadSession(msg.sessionId);
          send(ws, {
            type: 'session',
            sessionId: bridge.sessionId,
            modes: session.modes || null,
            configOptions: session.configOptions || null,
            loaded: true,
          });
          break;
        }
        case 'setMode':
          await bridge?.setMode(msg.modeId);
          break;
        case 'setConfigOption':
          await bridge?.setConfigOption(msg.configId, msg.value);
          break;
        case 'authenticate': {
          if (!bridge) return send(ws, { type: 'error', message: 'Nicht verbunden' });
          try {
            await bridge.authenticate(msg.methodId);
            send(ws, { type: 'authenticated' });
            await startSession(ws, bridge);
          } catch (err) {
            send(ws, {
              type: 'error',
              message: `Anmeldung fehlgeschlagen: ${err?.message || err}`,
              code: err?.code ?? null,
            });
          }
          break;
        }
        case 'permission':
          bridge?.resolvePermission(msg.requestId, msg.optionId || null);
          break;
        case 'elicitation':
          bridge?.resolveElicitation(msg.elicitationId, msg.action || 'accept');
          break;
        case 'disconnect':
          detach();
          send(ws, { type: 'stopped' });
          break;
        default:
          send(ws, { type: 'error', message: `Unbekannter Nachrichtentyp: ${msg.type}` });
      }
    } catch (err) {
      send(ws, {
        type: 'error',
        message: err?.message || String(err),
        code: err?.code ?? null,
      });
    }
  });

  ws.on('close', detach);
  send(ws, { type: 'hello', agents: agentList(), workspace: config.workspace });
});

// ---- Terminal (PTY) für Login-/Installationsabläufe ----
const termWss = new WebSocketServer({ noServer: true });

termWss.on('connection', async (ws) => {
  let pty = null;
  try {
    const { spawn: spawnPty } = await import('node-pty');
    pty = spawnPty(config.shell, ['-l'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: config.workspace,
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    pty.onData((data) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'data', data }));
    });
    pty.onExit(({ exitCode }) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'exit', exitCode }));
    });
    ws.send(JSON.stringify({ type: 'ready' }));
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', message: `PTY nicht verfügbar: ${err.message}` }));
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!pty) return;
    if (msg.type === 'input') pty.write(msg.data);
    else if (msg.type === 'resize') pty.resize(msg.cols, msg.rows);
  });

  ws.on('close', () => {
    try {
      pty?.kill();
    } catch {
      /* ignore */
    }
  });
});

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (pathname === '/acp-ws') {
    acpWss.handleUpgrade(req, socket, head, (ws) => acpWss.emit('connection', ws, req));
  } else if (pathname === '/terminal-ws') {
    termWss.handleUpgrade(req, socket, head, (ws) => termWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

server.listen(config.port, config.host, () => {
  console.log(`ACP Control läuft auf http://${config.host}:${config.port}`);
  console.log(`Workspace: ${config.workspace}`);
});

function shutdown(signal) {
  console.log(`\n${signal}: beende ACP Control …`);
  for (const bridge of activeBridges) bridge.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
