// Entry bundled into each IDE plugin as crashing-agents.mjs.
import process from 'node:process';
import { runAgentCli } from './cli';

const script = process.argv[1] ?? 'crashing-agents.mjs';
const quote = (word: string) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `"${word}"`);
const result = await runAgentCli(process.argv.slice(2), {
  env: process.env,
  command: `node ${quote(script)}`,
});
if (result.stdout) process.stdout.write(result.stdout + '\n');
if (result.stderr) process.stderr.write(result.stderr + '\n');
process.exitCode = result.code;
