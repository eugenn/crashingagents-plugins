import { randomUUID } from 'node:crypto';
import { TERMINAL_AGENTS, agentLaunchCommand, type TerminalAdapter } from '@crashing/terminal-host';
import type { Terminal, VsCodeApi } from './vscode-api';

const AGENT_NAME = new RegExp(`\\b(${TERMINAL_AGENTS.map((a) => a.bin).join('|')})\\b`, 'i');

/**
 * VS Code terminals as agent seats. Ids last for the window's lifetime. Terminals this extension
 * opens carry CRASHING_AGENTS_TERMINAL, so their agents find their seat without a credential.
 */
export function createVsCodeTerminals(
  vscode: VsCodeApi,
  cliCommand: () => Promise<string>,
  delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
): TerminalAdapter {
  const ids = new WeakMap<Terminal, string>();
  const own = new Set<string>();
  let next = 0;
  const idOf = (terminal: Terminal) => {
    let id = ids.get(terminal);
    if (!id) ids.set(terminal, (id = 't' + ++next));
    return id;
  };
  const find = (id: string) =>
    vscode.window.terminals.find((t) => ids.get(t) === id && t.exitStatus === undefined);

  return {
    async launch({ kind, model, prompt, title }) {
      const id = 'ca-' + randomUUID();
      const terminal = vscode.window.createTerminal({
        name: title,
        env: { CRASHING_AGENTS_TERMINAL: id },
      });
      ids.set(terminal, id);
      own.add(id);
      terminal.show(false);
      terminal.sendText(agentLaunchCommand(kind, model, prompt, await cliCommand()), true);
      return id;
    },
    async send(id, text) {
      const terminal = find(id);
      if (!terminal) return false;
      // Agent TUIs treat a newline inside one write as pasted text. Submit separately.
      terminal.sendText(text, false);
      await delay(200);
      terminal.sendText('\r', false);
      return true;
    },
    seatKey: (id) => (own.has(id) ? id : undefined),
    bindsLaunches: true,
    focus(id) {
      find(id)?.show(false);
    },
    async running() {
      return vscode.window.terminals
        .filter((t) => t.exitStatus === undefined)
        .map((t) => {
          const id = idOf(t);
          // Terminals this extension opened run an agent whatever their title says.
          return { id, label: t.name, agent: own.has(id) || AGENT_NAME.test(t.name) };
        })
        .sort((a, b) => Number(b.agent) - Number(a.agent));
    },
  };
}
