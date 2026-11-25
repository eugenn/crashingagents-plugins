import { readSeat, terminalKey } from './seats';
import {
  AGENT_TOOL_NAMES,
  AGENT_TOOL_SET,
  DEFAULT_ORIGIN,
  LIST_ARGUMENTS,
  buildTerminalPlayGuide,
  createCrashingClient,
  fromCliCommandName,
  toCliCommandName,
  type CrashingClientOptions,
} from '@crashing/plugin-core';

export interface CliResult {
  code: number;
  stdout?: string;
  stderr?: string;
}

const SEAT = /^[A-Za-z0-9_-]{43}$/;

function usage(): string {
  return [
    'Usage: crashing-agents COMMAND [--name value ...] [--seat SEAT]',
    '',
    'Plays the agent seat of a Crashing Agents room. The panel binds your seat to this terminal;',
    'pass --seat only when your invitation names one.',
    'Values are JSON when they parse as JSON (numbers, true, false), text otherwise.',
    'card_ids takes a comma list.',
    '',
    'Commands: ' + AGENT_TOOL_NAMES.map(toCliCommandName).join(', '),
  ].join('\n');
}

// Ids stay text even when they look like numbers.
const TEXT_ARGUMENTS = new Set(['decision_id', 'card_id', 'target_id', 'named_type', 'model']);

function parseValue(key: string, raw: string): unknown {
  if (TEXT_ARGUMENTS.has(key)) return raw;
  if (LIST_ARGUMENTS.has(key) && !raw.trim().startsWith('[')) {
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'string') return value;
  } catch {
    // Plain text.
  }
  return raw;
}

export function parseCliArguments(argv: string[]) {
  let seat: string | undefined;
  let origin: string | undefined;
  let command: string | undefined;
  const args: Record<string, unknown> = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i]!;
    if (!item.startsWith('--')) {
      if (command) throw new Error(`Unexpected argument: ${item}`);
      command = item;
      continue;
    }
    const eq = item.indexOf('=');
    const key = (eq > 0 ? item.slice(2, eq) : item.slice(2)).replaceAll('-', '_');
    let raw: string | undefined = eq > 0 ? item.slice(eq + 1) : undefined;
    if (raw === undefined) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        raw = next;
        i++;
      }
    }
    if (key === 'seat') seat = raw;
    else if (key === 'origin') origin = raw;
    else if (key === 'help') command = 'help';
    else args[key] = raw === undefined ? true : parseValue(key, raw);
  }
  return { seat, origin, command, args };
}

function finished(result: Record<string, unknown>): boolean {
  const room = (result.state ?? result) as {
    phase?: string;
    game?: { status?: string };
  };
  return (
    result.reason === 'finished' || room.phase === 'finished' || room.game?.status === 'finished'
  );
}

async function findSeat(key: string, home: string | undefined, waitMs: number) {
  // The host writes the seat right after the agent starts; a fast agent may run first.
  const until = Date.now() + waitMs;
  for (;;) {
    const seat = await readSeat(key, home);
    if (seat || Date.now() >= until) return seat;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * The game CLI an IDE terminal agent runs. The seat comes from the agent's terminal, which the
 * host bound when it invited the agent (like BB's thread), or from `--seat`.
 */
export async function runAgentCli(
  argv: string[],
  options: {
    env?: Record<string, string | undefined>;
    clientOptions?: CrashingClientOptions;
    /** Shell words that run this CLI, used in the play guide. */
    command?: string;
    home?: string;
    seatWaitMs?: number;
  } = {},
): Promise<CliResult> {
  try {
    const parsed = parseCliArguments(argv);
    const { command, args } = parsed;
    if (!command || command === 'help') return { code: command ? 0 : 1, stdout: usage() };
    const tool = fromCliCommandName(command);
    if (!AGENT_TOOL_SET.has(tool)) throw new Error(`Unknown command: ${command}\n\n${usage()}`);

    const key = options.env ? terminalKey(options.env) : undefined;
    const bound =
      !parsed.seat && key
        ? await findSeat(key, options.home, options.seatWaitMs ?? 3000)
        : undefined;
    const seat = parsed.seat ?? bound?.token;
    if (!seat || !SEAT.test(seat)) {
      throw new Error(
        key
          ? 'No game seat is bound to this terminal. Ask the player to invite you again from the Crashing Agents panel.'
          : 'Pass the --seat value from your invitation.',
      );
    }
    const client = createCrashingClient(
      parsed.origin || bound?.origin || options.env?.CRASHING_AGENTS_ORIGIN || DEFAULT_ORIGIN,
      options.clientOptions,
    );
    // Like BB: one game per invitation. A rematch comes as a new invitation.
    if (tool === 'wait_for_turn') delete args.wait_for_rematch;
    const result = (await client.agent(seat, tool, args)) as Record<string, unknown>;
    if (tool === 'join_room') {
      result.instructions = buildTerminalPlayGuide({
        command: options.command ?? 'crashing-agents',
        ...(parsed.seat ? { seat: parsed.seat } : {}),
      });
    }
    if (finished(result)) {
      result.instructions =
        'The game is finished. Report the result in one line and end your turn now.';
    }
    return { code: 0, stdout: JSON.stringify(result) };
  } catch (error) {
    return { code: 1, stderr: error instanceof Error ? error.message : String(error) };
  }
}
