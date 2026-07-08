import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '@/components/layout/Sidebar';

const settingsState = {
  sidebarCollapsed: false,
  setSidebarCollapsed: vi.fn(),
};

const chatState = {
  sessions: [
    { key: 'agent:main:session-1', displayName: 'agent:main:session-1' },
  ],
  currentSessionKey: 'agent:main:session-1',
  sessionLabels: { 'agent:main:session-1': '原会话' },
  sessionLastActivity: { 'agent:main:session-1': Date.now() },
  switchSession: vi.fn(),
  newSession: vi.fn(),
  deleteSession: vi.fn(),
  renameSession: vi.fn(),
  loadSessions: vi.fn(),
  loadHistory: vi.fn(),
  messages: [{ role: 'user', content: 'hi' }],
};

const gatewayState = {
  status: { state: 'running', port: 18789, gatewayReady: true } as Record<string, unknown>,
};

const agentsState = {
  agents: [{ id: 'main', name: 'Main Agent' }],
  fetchAgents: vi.fn(),
};

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('@/stores/chat', () => {
  const useChatStore = (selector: (state: typeof chatState) => unknown) => selector(chatState);
  useChatStore.getState = () => chatState;
  return { useChatStore };
});

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/extensions/registry', () => ({
  rendererExtensionRegistry: {
    getHiddenRoutes: () => new Set<string>(),
    getExtraNavItems: () => [],
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'sidebar.models': '模型',
        'sidebar.agents': 'Agents',
        'sidebar.channels': '频道',
        'sidebar.skills': '技能',
        'sidebar.cronTasks': '定时任务',
        'sidebar.newChat': '新对话',
        'sidebar.settings': '设置',
        'common:sidebar.openClawPage': 'OpenClaw 页面',
        'common:actions.confirm': '确认',
        'common:actions.delete': '删除',
        'common:actions.cancel': '取消',
        'common:sidebar.deleteSessionConfirm': `删除 ${String(vars?.label ?? '')}`,
        'chat:historyBuckets.today': '今天',
      };
      return map[key] ?? key;
    },
  }),
}));

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsState.sidebarCollapsed = false;
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: true };
    chatState.sessionLabels = { 'agent:main:session-1': '原会话' };
  });

  it('pins the gateway status at the lower side of the sidebar on every main page', () => {
    gatewayState.status = { state: 'starting', port: 18789, gatewayReady: false };

    render(
      <MemoryRouter initialEntries={['/models']}>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('sidebar-gateway-status')).toHaveTextContent('网关状态');
    expect(screen.getByTestId('sidebar-gateway-status')).toHaveTextContent('重启中');
    expect(screen.queryByRole('button', { name: 'OpenClaw 页面' })).not.toBeInTheDocument();
  });

  it('renames a session from the sidebar', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '重命名会话' }));
    const input = screen.getByLabelText('会话名称');
    fireEvent.change(input, { target: { value: '项目周报' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(chatState.renameSession).toHaveBeenCalledWith('agent:main:session-1', '项目周报');
  });
});
