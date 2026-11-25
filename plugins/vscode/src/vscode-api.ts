/**
 * Minimal structural subset of the VS Code Extension API this extension uses.
 * Keeps the plugin self-contained without requiring @types/vscode at workspace level.
 */
export interface Disposable {
  dispose(): void;
}

export interface Memento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export interface Uri {
  readonly fsPath: string;
  toString(): string;
}

export interface Webview {
  options: { enableScripts?: boolean; localResourceRoots?: readonly Uri[] };
  html: string;
  readonly cspSource: string;
  asWebviewUri(uri: Uri): Uri;
  postMessage(message: unknown): PromiseLike<boolean>;
  onDidReceiveMessage(listener: (message: unknown) => void): Disposable;
}

export interface WebviewView {
  readonly webview: Webview;
  onDidDispose(listener: () => void): Disposable;
}

export interface WebviewViewProvider {
  resolveWebviewView(webviewView: WebviewView): void | PromiseLike<void>;
}

export interface Terminal {
  readonly name: string;
  readonly exitStatus: { code: number | undefined } | undefined;
  sendText(text: string, shouldExecute?: boolean): void;
  show(preserveFocus?: boolean): void;
}

export interface ExtensionContext {
  readonly workspaceState: Memento;
  readonly subscriptions: Disposable[];
  readonly extensionUri: Uri;
  readonly extensionPath: string;
}

export interface VsCodeApi {
  readonly window: {
    readonly activeColorTheme: { readonly kind: number };
    readonly terminals: readonly Terminal[];
    createTerminal(options: { name: string }): Terminal;
    registerWebviewViewProvider(
      viewId: string,
      provider: WebviewViewProvider,
      options?: { webviewOptions?: { retainContextWhenHidden?: boolean } },
    ): Disposable;
  };
  readonly workspace: {
    getConfiguration(section: string): { get<T>(key: string, fallback: T): T };
  };
  readonly commands: {
    registerCommand(command: string, callback: () => unknown): Disposable;
    executeCommand(command: string, ...args: unknown[]): PromiseLike<unknown>;
  };
  readonly env: {
    readonly clipboard: { writeText(value: string): PromiseLike<void> };
    openExternal(target: Uri): PromiseLike<boolean>;
  };
  readonly Uri: {
    parse(value: string): Uri;
    joinPath(base: Uri, ...segments: string[]): Uri;
  };
}
