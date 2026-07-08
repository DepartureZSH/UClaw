import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StartupLoadingPage } from '@/pages/StartupLoadingPage';
import type { StartupSnapshot } from '@/lib/startup';
import { STARTUP_STEP_LABELS, STARTUP_STEP_ORDER } from '../../shared/startup';

const collectDiagnosticsTextMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/diagnostics', () => ({
  collectDiagnosticsText: (...args: unknown[]) => collectDiagnosticsTextMock(...args),
}));

function createSnapshot(overrides: Partial<StartupSnapshot> = {}): StartupSnapshot {
  return {
    status: 'error',
    currentStep: 'gateway-start',
    progress: 72,
    message: 'Gateway 响应超时，请重启 Gateway 后重试。',
    detail: 'RPC timeout: initialize',
    issue: {
      type: 'internal',
      severity: 'S1',
      code: 'GATEWAY_RPC_READY_TIMEOUT',
      title: 'Gateway 响应超时',
      suggestion: '请重启 Gateway 后重试。如果持续超时，请查看日志确认 Gateway 是否正常启动。',
    },
    updatedAt: Date.now(),
    actions: [
      { id: 'restart-gateway', label: '重启 Gateway', variant: 'primary' },
      { id: 'open-log-folder', label: '查看日志' },
      { id: 'copy-diagnostics', label: '复制诊断信息' },
    ],
    steps: STARTUP_STEP_ORDER.map((id) => ({
      id,
      label: STARTUP_STEP_LABELS[id],
      status: id === 'gateway-start' ? 'error' : 'success',
      message: id === 'gateway-start' ? 'Gateway 响应超时' : `${STARTUP_STEP_LABELS[id]}完成`,
    })),
    ...overrides,
  };
}

describe('StartupLoadingPage', () => {
  beforeEach(() => {
    collectDiagnosticsTextMock.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    vi.mocked(navigator.clipboard.writeText).mockResolvedValue(undefined);
  });

  it('renders startup stages, progress, and repair actions', () => {
    render(
      <MemoryRouter>
        <StartupLoadingPage snapshot={createSnapshot()} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('startup-loading-page')).toBeVisible();
    expect(screen.getByText('正在启动 UClaw')).toBeVisible();
    expect(screen.getByText('72%')).toBeVisible();
    for (const label of Object.values(STARTUP_STEP_LABELS)) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(screen.getByTestId('startup-issue-panel')).toBeVisible();
    expect(screen.getByText('S1 启动阻断')).toBeVisible();
    expect(screen.getByText('内部异常')).toBeVisible();
    expect(screen.getByText('GATEWAY_RPC_READY_TIMEOUT')).toBeVisible();
    expect(screen.getByRole('button', { name: /重启 Gateway/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /查看日志/ })).toBeVisible();
    expect(screen.getAllByRole('button', { name: /复制诊断信息/ })[0]).toBeVisible();
  });

  it('copies diagnostics from the shared support package', async () => {
    collectDiagnosticsTextMock.mockResolvedValue('uclaw-support-diagnostics\nGATEWAY_RPC_READY_TIMEOUT');

    render(
      <MemoryRouter>
        <StartupLoadingPage snapshot={createSnapshot()} />
      </MemoryRouter>,
    );

    const buttons = screen.getAllByRole('button', { name: /复制诊断信息|复制错误信息/ });
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('uclaw-support-diagnostics\nGATEWAY_RPC_READY_TIMEOUT');
    });
  });
});
