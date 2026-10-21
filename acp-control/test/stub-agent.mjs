#!/usr/bin/env node
// Minimaler ACP-Agent für Tests: streamt Text, fragt eine Freigabe an.
// Mit AUTH_REQUIRED=1 verlangt newSession zuerst eine Anmeldung.
// Mit ELICIT_AUTH=1 läuft die Anmeldung über einen Geräte-Code (URL-Elicitation).
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';

const output = Writable.toWeb(process.stdout);
const input = Readable.toWeb(process.stdin);
const requireAuth = process.env.AUTH_REQUIRED === '1';
const elicitAuth = process.env.ELICIT_AUTH === '1';
let authenticated = !requireAuth;

new AgentSideConnection(
  (conn) => ({
    async initialize() {
      return {
        protocolVersion: PROTOCOL_VERSION,
        agentInfo: { name: 'stub-agent', title: 'Stub Agent', version: '0.0.1' },
        agentCapabilities: { loadSession: true },
        authMethods: requireAuth
          ? [{ id: elicitAuth ? 'device-stub' : 'oauth-stub', name: 'Anmelden (Stub)' }]
          : [],
      };
    },
    async authenticate(params) {
      if (params.methodId === 'oauth-stub') authenticated = true;
      if (params.methodId === 'device-stub') {
        const response = await conn.createElicitation({
          mode: 'url',
          requestId: 1,
          message: 'Code eingeben: TEST-CODE',
          url: 'https://example.com/device',
          elicitationId: 'elicit-stub-1',
        });
        if (response.action !== 'accept') return {};
        authenticated = true;
      }
      return {};
    },
    async newSession() {
      if (!authenticated) throw RequestError.authRequired();
      return { sessionId: 'stub-session-1' };
    },
    async prompt(params) {
      const text = params.prompt?.[0]?.text || '';
      await conn.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `Echo: ${text}` },
        },
      });
      const outcome = await conn.requestPermission({
        sessionId: params.sessionId,
        toolCall: { toolCallId: 'tool-1', title: 'Beispiel-Tool' },
        options: [
          { optionId: 'allow', name: 'Erlauben', kind: 'allow_once' },
          { optionId: 'reject', name: 'Ablehnen', kind: 'reject_once' },
        ],
      });
      await conn.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: ` | Freigabe: ${JSON.stringify(outcome.outcome)}` },
        },
      });
      return { stopReason: 'end_turn' };
    },
    async cancel() {},
  }),
  ndJsonStream(output, input),
);
