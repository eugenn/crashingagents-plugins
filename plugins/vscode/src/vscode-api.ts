/**
 * Minimal structural subset of the VS Code Extension API used by the thin host adapter.
 * Keeps the reference plugin self-contained without requiring @types/vscode at workspace level.
 */
export interface Disposable {
  dispose(): void;
}

export interface Memento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export interface Webview {
  options: { enableScripts?: boolean };
  html: string;
  postMessage(message: unknown): PromiseLike<boolean>;
  onDidReceiveMessage(listener: (message: unknown) => void): Disposable;
}

export interface WebviewView {
  readonly webview: Webview;
  onDidDispose(listener: () => void): Disposable;
}

export interface WebviewViewProvider {
  resolveWebviewView(webviewView: WebviewView): void;
}

export interface ExtensionContext {
  readonly workspaceState: Memento;
  readonly subscriptions: Disposable[];
}

export interface VsCodeApi {
  readonly window: {
    readonly activeColorTheme: { readonly kind: number };
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
    openExternal(target: unknown): PromiseLike<boolean>;
  };
  readonly Uri: {
    parse(value: string): unknown;
  };
}
