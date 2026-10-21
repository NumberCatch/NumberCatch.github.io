import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { config } from './config.js';

const AUTH_REQUIRED = -32000;

function isInsideWorkspace(path) {
  const root = resolve(config.workspace);
  const target = resolve(root, path);
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Verbindet einen ACP-Agenten (stdio/JSON-RPC) mit einem WebSocket-Client.
 * Ein Bridge-Objekt entspricht genau einer Agent-Verbindung; Sessions werden
 * darüber mehrfach erzeugt und gewechselt.
 */
export class AgentBridge extends EventEmitter {
  constructor(agent) {
    super();
    this.agent = agent;
    this.proc = null;
    this.conn = null;
    this.sessionId = null;
    this.authMethods = [];
    this.agentInfo = null;
    this.agentCapabilities = null;
    this.pendingPermissions = new Map();
    this.pendingElicitations = new Map();
    this.permissionSeq = 0;
    this.stopped = false;
  }

  async start() {
    this.proc = spawn(this.agent.command, this.agent.args, {
      cwd: config.workspace,
      env: { ...process.env, ...this.agent.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.on('error', (err) => {
      this.emit('error', { message: `Agent konnte nicht gestartet werden: ${err.message}` });
    });
    this.proc.on('exit', (code, signal) => {
      this.stopped = true;
      this.emit('exit', { code, signal });
    });
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk) => {
      const text = String(chunk).trimEnd();
      if (text) this.emit('log', { stream: 'stderr', text });
    });

    const stream = acp.ndJsonStream(
      Writable.toWeb(this.proc.stdin),
      Readable.toWeb(this.proc.stdout),
    );
    this.conn = new acp.ClientSideConnection(() => this.client, stream);

    const init = await this.conn.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: false,
        // Manche Agenten (z. B. Codex) bieten erst dann einen Geräte-Code-Login
        // an, wenn der Client URL-Elicitation unterstützt.
        elicitation: { url: {} },
      },
      clientInfo: { name: 'acp-control', title: 'ACP Control', version: '0.1.0' },
    });

    this.agentInfo = init.agentInfo || null;
    this.agentCapabilities = init.agentCapabilities || {};
    this.authMethods = init.authMethods || [];
    return init;
  }

  get client() {
    return {
      requestPermission: (params) => this.#requestPermission(params),
      sessionUpdate: (params) => {
        this.emit('update', params);
      },
      readTextFile: async (params) => {
        if (!isInsideWorkspace(params.path)) {
          throw new Error('Pfad außerhalb des Workspace abgelehnt');
        }
        const text = await readFile(params.path, 'utf8');
        return { content: text };
      },
      writeTextFile: async (params) => {
        if (!isInsideWorkspace(params.path)) {
          throw new Error('Pfad außerhalb des Workspace abgelehnt');
        }
        await writeFile(params.path, params.content, 'utf8');
        return {};
      },
      extMethod: async () => ({}),
      extNotification: async () => {},
      // Geräte-Code-Login: Der Agent liefert Verifizierungs-URL und Code, der
      // Nutzer bestätigt im Web-Interface. Bis dahin wartet der Agent.
      createElicitation: (params) => this.#createElicitation(params),
    };
  }

  #createElicitation(params) {
    const elicitationId = `elicit-${++this.permissionSeq}`;
    this.emit('elicitation', { elicitationId, params });
    return new Promise((resolve) => {
      this.pendingElicitations.set(elicitationId, resolve);
    });
  }

  resolveElicitation(elicitationId, action = 'accept') {
    const resolve = this.pendingElicitations.get(elicitationId);
    if (!resolve) return false;
    this.pendingElicitations.delete(elicitationId);
    resolve(action === 'accept' ? { action: 'accept' } : { action });
    return true;
  }

  cancelPendingElicitations() {
    for (const [, resolve] of this.pendingElicitations) {
      resolve({ action: 'cancel' });
    }
    this.pendingElicitations.clear();
  }

  #requestPermission(params) {
    const requestId = `perm-${++this.permissionSeq}`;
    this.emit('permission', {
      requestId,
      sessionId: params.sessionId,
      toolCall: params.toolCall,
      options: params.options || [],
    });
    return new Promise((resolve) => {
      this.pendingPermissions.set(requestId, resolve);
    });
  }

  resolvePermission(requestId, optionId) {
    const resolve = this.pendingPermissions.get(requestId);
    if (!resolve) return false;
    this.pendingPermissions.delete(requestId);
    resolve(optionId
      ? { outcome: { outcome: 'selected', optionId } }
      : { outcome: { outcome: 'cancelled' } });
    return true;
  }

  cancelPendingPermissions() {
    for (const [, resolve] of this.pendingPermissions) {
      resolve({ outcome: { outcome: 'cancelled' } });
    }
    this.pendingPermissions.clear();
  }

  async newSession(cwd) {
    const result = await this.conn.newSession({
      cwd: cwd || config.workspace,
      mcpServers: [],
    });
    this.sessionId = result.sessionId;
    return result;
  }

  async loadSession(sessionId) {
    const result = await this.conn.loadSession({
      sessionId,
      cwd: config.workspace,
      mcpServers: [],
    });
    this.sessionId = sessionId;
    return result || {};
  }

  async prompt(text) {
    if (!this.sessionId) throw new Error('Keine aktive Session');
    return this.conn.prompt({
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text }],
    });
  }

  async cancel() {
    if (this.sessionId) await this.conn.cancel({ sessionId: this.sessionId });
  }

  async setMode(modeId) {
    if (!this.sessionId) throw new Error('Keine aktive Session');
    return this.conn.setSessionMode({ sessionId: this.sessionId, modeId });
  }

  async setConfigOption(configId, value) {
    if (!this.sessionId) throw new Error('Keine aktive Session');
    return this.conn.setSessionConfigOption({ sessionId: this.sessionId, configId, value });
  }

  async authenticate(methodId) {
    return this.conn.authenticate({ methodId });
  }

  stop() {
    this.stopped = true;
    this.cancelPendingPermissions();
    this.cancelPendingElicitations();
    try {
      this.proc?.stdin?.end();
    } catch {
      /* ignore */
    }
    try {
      this.proc?.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
}

export function isAuthError(err) {
  return err?.code === AUTH_REQUIRED || /auth/i.test(err?.message || '');
}
