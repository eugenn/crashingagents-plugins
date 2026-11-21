import { describe, expect, it, vi } from 'vitest';
import {
  applyThemeTokens,
  createJetBrainsBridge,
  type JetBrainsEventListener,
} from './bridge';

describe('createJetBrainsBridge', () => {
  it('sends authenticated RPC requests and unwraps results', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers['X-Crashing-Token']).toBe('secret-token');
      const body = JSON.parse(String(init?.body)) as { method: string; params?: unknown };
      if (body.method === 'getConfig') {
        return new Response(
          JSON.stringify({
            result: {
              assetsOrigin: 'https://crashingagents.com',
              capabilities: {
                canInviteLocalAgent: false,
                canOpenAgentChat: false,
                agentTransport: 'prompt',
              },
            },
          }),
          { status: 200 },
        );
      }
      if (body.method === 'copyToClipboard') {
        expect(body.params).toEqual({ text: 'INVITE123' });
        return new Response(JSON.stringify({ result: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ result: null }), { status: 200 });
    });

    const bridge = createJetBrainsBridge({
      baseUrl: 'http://127.0.0.1:45678',
      token: 'secret-token',
      theme: 'dark',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const config = await bridge.getConfig();
    expect(config.assetsOrigin).toBe('https://crashingagents.com');
    expect(await bridge.copyToClipboard?.('INVITE123')).toBe(true);
    await bridge.dispatch({ type: 'create', visibility: 'private' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('surfaces backend RPC errors cleanly', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'Room not found' }), { status: 400 });
    });

    const bridge = createJetBrainsBridge({
      token: 'secret-token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(bridge.getState()).rejects.toThrow('Room not found');
  });

  it('returns null (not undefined) when getState has no active room', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: null }), { status: 200 }));
    const bridge = createJetBrainsBridge({
      token: 'secret-token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(await bridge.getState()).toBeNull();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    expect(await bridge.getState()).toBeNull();
  });

  it('returns the exact same TableSnapshot reference when polling receives identical JSON', async () => {
    const payload = JSON.stringify({
      result: {
        room: { code: 'SAME01', phase: 'playing' },
        owner: true,
        player: true,
        agent: false,
        waitingForAgent: false,
      },
    });
    const fetchMock = vi.fn(async () => new Response(payload, { status: 200 }));
    const bridge = createJetBrainsBridge({
      token: 'secret-token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const first = await bridge.getState();
    const second = await bridge.getState();
    expect(first).toBe(second);
  });

  it('pushes refreshed state and theme updates from host events', async () => {
    let captured: JetBrainsEventListener | null = null;
    const disposeSpy = vi.fn();
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          result: { room: { code: 'ABC234' }, owner: true, player: true, agent: false, waitingForAgent: false },
        }),
        { status: 200 },
      );
    });

    const bridge = createJetBrainsBridge({
      token: 'secret-token',
      fetchImpl: fetchMock as unknown as typeof fetch,
      onEventSource: (listeners) => {
        captured = listeners;
        return disposeSpy;
      },
    });

    const onState = vi.fn();
    const onTheme = vi.fn();
    const unsubState = bridge.subscribe!(onState);
    const unsubTheme = bridge.onHostTheme(onTheme);

    captured!.onTheme?.({ mode: 'light', tokens: { '--jb-bg': '#ffffff' } });
    expect(onTheme).toHaveBeenCalledWith({ mode: 'light', tokens: { '--jb-bg': '#ffffff' } });

    captured!.onRefresh?.();
    await vi.waitFor(() => {
      expect(onState).toHaveBeenCalledTimes(1);
    });

    unsubState();
    expect(disposeSpy).not.toHaveBeenCalled();
    unsubTheme();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('applies only --jb-* CSS tokens to the root element', () => {
    const setProps = new Map<string, string>();
    const fakeRoot = {
      dataset: {} as DOMStringMap,
      style: {
        setProperty: (k: string, v: string) => setProps.set(k, v),
      },
    } as unknown as HTMLElement;

    applyThemeTokens(fakeRoot, {
      mode: 'dark',
      tokens: {
        '--jb-bg': '#1e1f22',
        '--jb-fg': '#bcbec4',
        'malicious-prop': 'red',
      },
    });

    expect(fakeRoot.dataset.theme).toBe('dark');
    expect(setProps.get('--jb-bg')).toBe('#1e1f22');
    expect(setProps.get('--jb-fg')).toBe('#bcbec4');
    expect(setProps.has('malicious-prop')).toBe(false);
  });
});
