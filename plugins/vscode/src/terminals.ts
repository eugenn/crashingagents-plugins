import { TERMINAL_AGENTS, agentLaunchCommand, type TerminalAdapter } from '@crashing/terminal-host';
import type { Terminal, VsCodeApi } from './vscode-api';

const AGENT_NAME = new RegExp(`\\b(${TERMINAL_AGENTS.map((a) => a.bin).join('|')})\\b`, 'i');

/** VS Code terminals as agent seats. Ids last for the window's lifetime. */
export function createVsCodeTerminals(
  vscode: VsCodeApi,
  cliCommand: () => Promise<string>,
  delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
): TerminalAdapter {
  const ids = new WeakMap<Terminal, string>();
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
      const terminal = vscode.window.createTerminal({ name: title });
      terminal.show(false);
      terminal.sendText(agentLaunchCommand(kind, model, prompt, await cliCommand()), true);
      return idOf(terminal);
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
    focus(id) {
      find(id)?.show(false);
    },
    async running() {
      return vscode.window.terminals
        .filter((t) => t.exitStatus === undefined)
        .map((t) => ({ id: idOf(t), label: t.name, agent: AGENT_NAME.test(t.name) }))
        .sort((a, b) => Number(b.agent) - Number(a.agent))
        .map(({ id, label }) => ({ id, label }));
    },
  };
}
