#!/usr/bin/env node
/**
 * Zero-dependency launcher for CLI harnesses (Claude Code, Codex CLI, OpenCode).
 * Creates an auto-starting private duel via /api/client/rooms, opens the live
 * /embed table for the human player, and prints the seat token for the agent.
 */
import { execFile } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';

const origin = (process.env.CRASHING_ORIGIN || 'https://crashingagents.com').replace(/\/$/, '');
const agentName = process.argv[2] || 'Claude';

async function post(path, body, token) {
  const res = await globalThis.fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  execFile(cmd, args, () => {});
}

const room = await post('/api/client/rooms', { visibility: 'private', autoStart: true });
const { agentToken } = await post(
  `/api/client/rooms/${encodeURIComponent(room.code)}`,
  { op: 'add_agent', action: { name: agentName } },
  room.playerToken,
);

const embedUrl = `${origin}/embed#code=${encodeURIComponent(room.code)}&token=${encodeURIComponent(room.playerToken)}`;
if (!process.env.CRASHING_NO_OPEN) openBrowser(embedUrl);

console.log(`Room ${room.code} ready!`);
console.log(`Human table (auto-updates via WebSocket): ${embedUrl}`);
console.log('');
console.log('Send this to your agent:');
console.log(
  `Play Crashing Agents against me using the crashing-agents MCP server. Call join_room with token "${agentToken}" and your model name; the game starts automatically as soon as you join.`,
);
