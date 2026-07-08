import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorRepairPage } from '@/pages/ErrorRepairPage';
import type { StartupIssue } from '@/lib/startup';

const invokeIpcMock = vi.hoisted(() => vi.fn());
const collectDiagnosticsTextMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

vi.mock('@/lib/startup', () => ({
  runStartupAction: vi.fn(),
}));

vi.mock('@/lib/diagnostics', () => ({
  collectDiagnosticsText: (...args: unknown[]) => collectDiagnosticsTextMock(...args),
}));

const issue: StartupIssue = {
  type: 'internal',
  severity: 'S1',
  code: 'IPC_CHANNEL_UNAVAILABLE',
  title: '主进程通信不可用',
  suggestion: '请重启 UClaw 让主进程和页面版本重新对齐。',
};

describe('ErrorRepairPage', () => {
  beforeEach(() => {
    invokeIpcMock.mockReset();
    collectDiagnosticsTextMock.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    vi.mocked(navigator.clipboard.writeText).mockResolvedValue(undefined);
  });

  it('renders issue classification and repair actions', () => {
    render(
      <ErrorRepairPage
        message="页面与主进程通信失败"
        issue={issue}
        detail="Invalid IPC channel"
        actions={[
          { id: 'relaunch-app', label: '重启 UClaw', variant: 'primary' },
          { id: 'open-log-folder', label: '查看日志' },
          { id: 'copy-diagnostics', label: '复制诊断信息' },
        ]}
      />,
    );

    expect(screen.getByTestId('error-repair-page')).toBeVisible();
    expect(screen.getByText('S1 启动阻断')).toBeVisible();
    expect(screen.getByText('内部异常')).toBeVisible();
    expect(screen.getByText('IPC_CHANNEL_UNAVAILABLE')).toBeVisible();
    expect(screen.getByRole('button', { name: /重启 UClaw/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /查看日志/ })).toBeVisible();
  });

  it('copies diagnostics from the shared support package', async () => {
    collectDiagnosticsTextMock.mockResolvedValue('uclaw-support-diagnostics\nIPC_CHANNEL_UNAVAILABLE');

    render(
      <ErrorRepairPage
        message="页面与主进程通信失败"
        issue={issue}
        detail="Invalid IPC channel"
        actions={[{ id: 'copy-diagnostics', label: '复制诊断信息' }]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /复制诊断信息/ }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('uclaw-support-diagnostics\nIPC_CHANNEL_UNAVAILABLE');
    });
  });

  it('opens the log folder through main-process IPC', async () => {
    invokeIpcMock.mockImplementation(async (channel: string) => {
      if (channel === 'log:getDir') return 'E:/logs';
      return undefined;
    });

    render(
      <ErrorRepairPage
        message="页面与主进程通信失败"
        issue={issue}
        actions={[{ id: 'open-log-folder', label: '查看日志' }]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /查看日志/ }));

    await waitFor(() => {
      expect(invokeIpcMock).toHaveBeenCalledWith('log:getDir');
      expect(invokeIpcMock).toHaveBeenCalledWith('shell:openPath', 'E:/logs');
    });
  });
});
