import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StartupSnapshot } from '@/lib/startup';

const startupState = vi.hoisted(() => ({
  snapshot: null as StartupSnapshot | null,
  init: vi.fn(),
  runAction: vi.fn(),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) => selector({
    init: vi.fn(),
    theme: 'light',
    language: 'zh',
  }),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: unknown) => unknown) => selector({ init: vi.fn() }),
}));

vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector: (state: unknown) => unknown) => selector({ init: vi.fn() }),
}));

vi.mock('@/stores/startup', () => ({
  useStartupStore: (selector: (state: unknown) => unknown) => selector({
    init: startupState.init,
    snapshot: startupState.snapshot,
    runAction: startupState.runAction,
  }),
}));

vi.mock('@/lib/api-client', () => ({
  applyGatewayTransportPreference: vi.fn(),
  invokeIpc: vi.fn(async () => ''),
}));

vi.mock('@/extensions/registry', () => ({
  rendererExtensionRegistry: {
    getExtraRoutes: () => [],
    initializeAll: vi.fn(async () => undefined),
    teardownAll: vi.fn(),
  },
}));

vi.mock('@/extensions/_ext-bridge.generated', () => ({
  loadExternalRendererExtensions: vi.fn(),
}));

vi.mock('@/components/layout/MainLayout', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    MainLayout: () => (
      <div data-testid="main-layout">
        <actual.Outlet />
      </div>
    ),
  };
});

vi.mock('@/components/layout/TitleBar', () => ({
  TitleBar: () => <div data-testid="title-bar" />,
}));

vi.mock('@/pages/Chat', () => ({ Chat: () => <div>Chat page</div> }));
vi.mock('@/pages/Models', () => ({ Models: () => <div>Models page</div> }));
vi.mock('@/pages/Agents', () => ({ Agents: () => <div>Agents page</div> }));
vi.mock('@/pages/Channels', () => ({ Channels: () => <div>Channels page</div> }));
vi.mock('@/pages/Skills', () => ({ Skills: () => <div>Skills page</div> }));
vi.mock('@/pages/Cron', () => ({ Cron: () => <div>Cron page</div> }));
vi.mock('@/pages/Settings', () => ({ Settings: () => <div>Settings page</div> }));

function makeStartupSnapshot(overrides: Partial<StartupSnapshot>): StartupSnapshot {
  return {
    status: 'booting',
    currentStep: null,
    steps: [],
    progress: 0,
    message: '',
    actions: [],
    updatedAt: Date.now(),
    ...overrides,
  };
}

async function renderApp(path: string, snapshot: StartupSnapshot | null) {
  startupState.snapshot = snapshot;
  startupState.runAction.mockResolvedValue({ snapshot });
  const { default: App } = await import('@/App');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App startup routing', () => {
  afterEach(() => {
    startupState.snapshot = null;
    startupState.init.mockClear();
    startupState.runAction.mockReset();
  });

  it('shows company key page for blocked startup even on /setup', async () => {
    await renderApp('/setup', makeStartupSnapshot({
      status: 'blockedBySetup',
      currentStep: 'remote-config-sync',
      progress: 50,
      message: '请先填写公司密钥',
    }));

    expect(screen.getByText('填写公司密钥')).toBeInTheDocument();
    expect(screen.getByText(/同步企业配置/)).toBeInTheDocument();
  });

  it('does not render legacy setup after startup is ready', async () => {
    await renderApp('/setup', makeStartupSnapshot({
      status: 'ready',
      progress: 100,
      message: '启动完成',
    }));

    expect(screen.getByText('填写公司密钥')).toBeInTheDocument();
    expect(screen.queryByText('选择工作区')).not.toBeInTheDocument();
  });

  it('renders the main app when startup completes with a warning', async () => {
    await renderApp('/', makeStartupSnapshot({
      status: 'warning',
      currentStep: 'gateway-start',
      progress: 100,
      message: '启动完成，但存在可恢复提示',
    }));

    expect(screen.getByTestId('main-layout')).toBeInTheDocument();
    expect(screen.getByText('Chat page')).toBeInTheDocument();
  });
});
