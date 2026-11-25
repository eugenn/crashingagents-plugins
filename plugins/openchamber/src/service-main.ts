import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServiceHost } from '@openchamber/sdk';
import { createOpenCodeReader } from './models';
import { createServiceHandler } from './service';

const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
const token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? '';
const dataDir =
  process.env.OPENCHAMBER_SERVICE_DATA_DIR || join(tmpdir(), 'openchamber-crashing-agents');

if (!Number.isInteger(port) || port <= 0 || !token) {
  console.error('OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required.');
  process.exit(1);
}

const callback = process.env.OPENCHAMBER_HOST_CALLBACK_URL;
const opencodeUrl = process.env.OPENCHAMBER_OPENCODE_URL;
const sessions = callback ? createServiceHost({ env: process.env }).sessions : undefined;

const { handle } = createServiceHandler({
  dataDir,
  token,
  ...(sessions ? { sessions } : {}),
  ...(opencodeUrl ? { opencode: createOpenCodeReader(opencodeUrl, token) } : {}),
});

const server = http.createServer((req, res) => {
  void handle(req, res);
});

server.listen(port, '127.0.0.1');

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
