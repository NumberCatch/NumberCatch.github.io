import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const stub = join(here, 'stub-agent.mjs');
const PORT = 12199;

function makeAgentsConfig(extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'acp-test-'));
  const file = join(dir, 'agents.json');
  writeFileSync(
    file,
    JSON.stringify({
      agents: [
        {
          id: 'stub',
          name: 'Stub',
          description: 'Test-Agent',
          command: process.execPath,
          args: [stub],
          env: extraEnv,
        },
      ],
    }),
  );
  return file;
}

function startServer(agentsConfig) {
  const proc = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      ACP_AGENTS_CONFIG: agentsConfig,
      ACP_WORKSPACE: root,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return proc;
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/agents`);
      if (res.ok) return res.json();
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server nicht erreichbar');
}

test('Agentenliste und HTTP-Auslieferung', async () => {
  const agentsConfig = makeAgentsConfig();
  const server = startServer(agentsConfig);
  try {
    const data = await waitForServer();
    assert.equal(data.agents.length, 1);
    assert.equal(data.agents[0].id, 'stub');
    assert.equal(data.agents[0].available, true);

    const page = await fetch(`http://127.0.0.1:${PORT}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /ACP Control/);

    const traversal = await fetch(`http://127.0.0.1:${PORT}/../package.json`);
    assert.equal(traversal.status, 404);
  } finally {
    server.kill('SIGTERM');
  }
});

test('Kompletter Prompt-Durchlauf inklusive Freigabe', async () => {
  const agentsConfig = makeAgentsConfig();
  const server = startServer(agentsConfig);
  try {
    await waitForServer();
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/acp-ws`);
    const events = [];
    const waiters = [];

    const waitFor = (type) =>
      new Promise((resolve) => {
        const found = events.find((e) => e.type === type);
        if (found) return resolve(found);
        waiters.push({ type, resolve });
      });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      events.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].type === msg.type) {
          waiters[i].resolve(msg);
          waiters.splice(i, 1);
        }
      }
    });

    await new Promise((r) => ws.on('open', r));
    await waitFor('hello');

    ws.send(JSON.stringify({ type: 'connect', agentId: 'stub' }));
    const ready = await waitFor('ready');
    assert.equal(ready.agent.name, 'Stub');
    const session = await waitFor('session');
    assert.equal(session.sessionId, 'stub-session-1');

    ws.send(JSON.stringify({ type: 'prompt', text: 'Hallo' }));
    const update = await waitFor('update');
    assert.equal(update.params.update.sessionUpdate, 'agent_message_chunk');
    assert.match(update.params.update.content.text, /Echo: Hallo/);

    const permission = await waitFor('permission');
    assert.equal(permission.options.length, 2);
    ws.send(
      JSON.stringify({ type: 'permission', requestId: permission.requestId, optionId: 'allow' }),
    );

    const turnEnd = await waitFor('turnEnd');
    assert.equal(turnEnd.stopReason, 'end_turn');
    const selected = events.find(
      (e) =>
        e.type === 'update' &&
        e.params.update.sessionUpdate === 'agent_message_chunk' &&
        /"outcome":"selected"/.test(e.params.update.content.text),
    );
    assert.ok(selected, 'Freigabe-Ergebnis "selected" sollte gestreamt werden');

    ws.close();
  } finally {
    server.kill('SIGTERM');
  }
});

test('Anmeldung wird angefordert und danach die Session aufgebaut', async () => {
  const agentsConfig = makeAgentsConfig({ AUTH_REQUIRED: '1' });
  const server = startServer(agentsConfig);
  try {
    await waitForServer();
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/acp-ws`);
    const events = [];
    const waiters = [];

    const waitFor = (type) =>
      new Promise((resolve) => {
        const found = events.find((e) => e.type === type);
        if (found) return resolve(found);
        waiters.push({ type, resolve });
      });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      events.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].type === msg.type) {
          waiters[i].resolve(msg);
          waiters.splice(i, 1);
        }
      }
    });

    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'connect', agentId: 'stub' }));

    const authRequired = await waitFor('authRequired');
    assert.equal(authRequired.authMethods[0].id, 'oauth-stub');
    assert.equal(events.find((e) => e.type === 'session'), undefined);

    ws.send(JSON.stringify({ type: 'authenticate', methodId: 'oauth-stub' }));
    await waitFor('authenticated');
    const session = await waitFor('session');
    assert.equal(session.sessionId, 'stub-session-1');

    ws.close();
  } finally {
    server.kill('SIGTERM');
  }
});

test('Geräte-Code-Login wird per Elicitation an die Oberfläche gereicht', async () => {
  const agentsConfig = makeAgentsConfig({ AUTH_REQUIRED: '1', ELICIT_AUTH: '1' });
  const server = startServer(agentsConfig);
  try {
    await waitForServer();
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/acp-ws`);
    const events = [];
    const waiters = [];

    const waitFor = (type) =>
      new Promise((resolve) => {
        const found = events.find((e) => e.type === type);
        if (found) return resolve(found);
        waiters.push({ type, resolve });
      });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      events.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].type === msg.type) {
          waiters[i].resolve(msg);
          waiters.splice(i, 1);
        }
      }
    });

    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'connect', agentId: 'stub' }));

    const authRequired = await waitFor('authRequired');
    assert.equal(authRequired.authMethods[0].id, 'device-stub');

    ws.send(JSON.stringify({ type: 'authenticate', methodId: 'device-stub' }));
    const elicitation = await waitFor('elicitation');
    assert.equal(elicitation.params.mode, 'url');
    assert.equal(elicitation.params.url, 'https://example.com/device');
    assert.match(elicitation.params.message, /TEST-CODE/);
    assert.equal(events.find((e) => e.type === 'session'), undefined);

    ws.send(
      JSON.stringify({ type: 'elicitation', elicitationId: elicitation.elicitationId, action: 'accept' }),
    );
    const session = await waitFor('session');
    assert.equal(session.sessionId, 'stub-session-1');

    ws.close();
  } finally {
    server.kill('SIGTERM');
  }
});

test('OAuth-Rückruf akzeptiert nur Loopback-Adressen', async () => {
  const agentsConfig = makeAgentsConfig();
  const server = startServer(agentsConfig);
  try {
    await waitForServer();
    const external = await fetch(`http://127.0.0.1:${PORT}/api/oauth/forward`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://example.com/callback?code=x' }),
    });
    assert.equal(external.status, 400);

    const missing = await fetch(`http://127.0.0.1:${PORT}/api/oauth/forward`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(missing.status, 400);
  } finally {
    server.kill('SIGTERM');
  }
});
