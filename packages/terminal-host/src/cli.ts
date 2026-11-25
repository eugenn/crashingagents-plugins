import {
  AGENT_TOOL_NAMES,
  AGENT_TOOL_SET,
  DEFAULT_ORIGIN,
  LIST_ARGUMENTS,
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
    'Usage: crashing-agents --seat SEAT COMMAND [--name value ...]',
    '',
    'Plays the agent seat of a Crashing Agents room. The invitation names your seat.',
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

/** The game CLI an IDE terminal agent runs. Stateless: the seat travels with every call. */
export async function runAgentCli(
  argv: string[],
  options: { env?: Record<string, string | undefined>; clientOptions?: CrashingClientOptions } = {},
): Promise<CliResult> {
  try {
    const { seat, origin, command, args } = parseCliArguments(argv);
    if (!command || command === 'help') return { code: command ? 0 : 1, stdout: usage() };
    const tool = fromCliCommandName(command);
    if (!AGENT_TOOL_SET.has(tool)) throw new Error(`Unknown command: ${command}\n\n${usage()}`);
    if (!seat || !SEAT.test(seat)) throw new Error('Pass the --seat value from your invitation.');
    const client = createCrashingClient(
      origin || options.env?.CRASHING_AGENTS_ORIGIN || DEFAULT_ORIGIN,
      options.clientOptions,
    );
    const result = (await client.agent(seat, tool, args)) as Record<string, unknown>;
    if (finished(result)) {
      result.instructions = 'The game is finished. Report the result in one line and stop.';
    }
    return { code: 0, stdout: JSON.stringify(result) };
  } catch (error) {
    return { code: 1, stderr: error instanceof Error ? error.message : String(error) };
  }
}
