import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Environment variables that name the terminal an agent runs in. A host binds the agent's seat
 * to that name, the way BB binds a seat to its thread, so the agent never handles its credential.
 * Orca sets ORCA_TERMINAL_HANDLE in every terminal; the VS Code extension sets
 * CRASHING_AGENTS_TERMINAL in the terminals it opens.
 */
export const TERMINAL_KEY_ENV = ['CRASHING_AGENTS_TERMINAL', 'ORCA_TERMINAL_HANDLE'] as const;

export interface Seat {
  token: string;
  origin: string;
}

const seatsDir = (home = homedir()) => join(home, '.crashing-agents', 'seats');
const seatPath = (key: string, home?: string) =>
  join(seatsDir(home), createHash('sha256').update(key).digest('hex').slice(0, 32) + '.json');

/** Saves the seat for the terminal named `key`, readable by the user only. */
export async function writeSeat(key: string, seat: Seat, home?: string): Promise<void> {
  const dir = seatsDir(home);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});
  await writeFile(seatPath(key, home), JSON.stringify(seat), { mode: 0o600 });
}

export async function deleteSeat(key: string, home?: string): Promise<void> {
  await rm(seatPath(key, home), { force: true });
}

/** The terminal's own name from its environment, if a host set one. */
export function terminalKey(env: Record<string, string | undefined>): string | undefined {
  for (const name of TERMINAL_KEY_ENV) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export async function readSeat(key: string, home?: string): Promise<Seat | undefined> {
  try {
    const seat = JSON.parse(await readFile(seatPath(key, home), 'utf8')) as Partial<Seat>;
    return typeof seat.token === 'string' && typeof seat.origin === 'string'
      ? { token: seat.token, origin: seat.origin }
      : undefined;
  } catch {
    return undefined;
  }
}
