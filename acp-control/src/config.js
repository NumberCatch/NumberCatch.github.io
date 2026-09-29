import { readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '..');

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Konfiguration konnte nicht gelesen werden (${path}): ${err.message}`);
  }
}

const env = process.env;

const defaults = readJson(env.ACP_AGENTS_CONFIG || join(ROOT, 'agents.json'));

export const config = {
  port: Number(env.PORT || 12000),
  host: env.HOST || '0.0.0.0',
  workspace: env.ACP_WORKSPACE || resolve(ROOT, '..'),
  shell: env.SHELL || '/bin/bash',
  home: env.ACP_HOME || ROOT,
  // Ein Agent gilt nur dann als auswählbar, wenn sein Kommando existiert.
  // Fehlt eine Binary, liefert der Server eine klare Installationsanweisung.
  agents: [],
};

config.agents = (defaults.agents || []).map((agent) => normalizeAgent(agent, config));

function normalizeAgent(agent, ctx) {
  const rawCommand = interpolate(agent.command, ctx);
  const args = (agent.args || []).map((arg) => interpolate(arg, ctx));
  return {
    ...agent,
    command: rawCommand,
    args,
    env: { ...(agent.env || {}) },
    install: agent.install ? interpolate(agent.install, ctx) : null,
  };
}

export function interpolate(value, ctx = config) {
  return String(value).replace(/\$\{(\w+)\}/g, (_, key) => {
    if (key === 'ACP_HOME') return ctx.home;
    if (key === 'ACP_ROOT') return ROOT;
    if (key === 'UID') return String(process.getuid?.() ?? '');
    // agy verweigert den Start, wenn der Benutzername nicht in /etc/passwd steht,
    // und erwartet dort einen Eintrag für die übergebene Kennung.
    if (key === 'USER') {
      try {
        return userInfo().username;
      } catch {
        return env.USER ?? env.LOGNAME ?? '';
      }
    }
    return env[key] ?? '';
  });
}

export function getAgent(id) {
  return config.agents.find((agent) => agent.id === id) || null;
}
