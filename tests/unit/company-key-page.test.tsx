import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanyKeyPage } from '@/pages/CompanyKeyPage';

const invokeIpcMock = vi.fn();
const runActionMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

vi.mock('@/stores/startup', () => ({
  useStartupStore: (selector: (state: unknown) => unknown) => selector({
    runAction: runActionMock,
  }),
}));

describe('CompanyKeyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeIpcMock.mockImplementation(async (channel: string) => {
      if (channel === 'app:getCompanyKey') return '';
      if (channel === 'app:getCompanySupportLink') {
        return {
          success: true,
          url: 'https://uclaw.example.com/support',
          title: 'UClaw 客服支持',
          message: '请打开官网联系运维支持。',
        };
      }
      return null;
    });
  });

  it('replaces the back button with a Laf-powered support link', async () => {
    render(
      <MemoryRouter>
        <CompanyKeyPage />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: '返回启动页' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '联系客服' }));

    await waitFor(() => {
      expect(invokeIpcMock).toHaveBeenCalledWith('app:getCompanySupportLink');
    });
    expect(await screen.findByText('UClaw 客服支持')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '打开官网链接' })).toHaveAttribute('href', 'https://uclaw.example.com/support');
  });
});
