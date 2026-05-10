import { describe, expect, it } from 'vitest';
import { classifyRendererError } from '@/lib/error-repair';

describe('classifyRendererError', () => {
  it('maps chunk loading failures to a reloadable startup blocker', () => {
    const result = classifyRendererError(new Error('ChunkLoadError: Loading chunk 42 failed'));

    expect(result.issue).toMatchObject({
      type: 'internal',
      severity: 'S1',
      code: 'RENDER_CHUNK_LOAD_FAILED',
    });
    expect(result.actions.map((action) => action.id)).toContain('reload-page');
  });

  it('maps IPC handler failures to relaunch repair actions', () => {
    const result = classifyRendererError(new Error('Invalid IPC channel: hostapi:fetch'));

    expect(result.issue).toMatchObject({
      type: 'internal',
      severity: 'S1',
      code: 'IPC_CHANNEL_UNAVAILABLE',
    });
    expect(result.actions[0]?.id).toBe('relaunch-app');
  });

  it('maps renderer cache quota failures to temporary cache repair', () => {
    const result = classifyRendererError(new DOMException('quota exceeded', 'QuotaExceededError'));

    expect(result.issue).toMatchObject({
      type: 'external',
      severity: 'S2',
      code: 'RENDER_CACHE_QUOTA_EXCEEDED',
    });
    expect(result.actions[0]?.id).toBe('clear-render-cache-and-reload');
  });

  it('keeps unknown renderer failures as S1 internal blockers', () => {
    const result = classifyRendererError(new Error('boom'));

    expect(result.issue).toMatchObject({
      type: 'internal',
      severity: 'S1',
      code: 'RENDER_UNKNOWN_ERROR',
    });
  });
});
