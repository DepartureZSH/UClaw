import { invokeIpc } from '@/lib/api-client';
import type {
  StartupActionRequest,
  StartupActionResult,
  StartupSnapshot,
} from '../../shared/startup';

export type {
  StartupAction,
  StartupActionId,
  StartupActionRequest,
  StartupActionResult,
  StartupIssue,
  StartupIssueType,
  StartupOverallStatus,
  StartupSeverity,
  StartupSnapshot,
  StartupStepId,
  StartupStepSnapshot,
  StartupStepStatus,
} from '../../shared/startup';

export async function getStartupSnapshot(): Promise<StartupSnapshot> {
  return await invokeIpc<StartupSnapshot>('startup:getSnapshot');
}

export async function runStartupAction(request: StartupActionRequest): Promise<StartupActionResult> {
  return await invokeIpc<StartupActionResult>('startup:action', request);
}

export function subscribeStartupProgress(handler: (snapshot: StartupSnapshot) => void): () => void {
  const unsubscribe = window.electron.ipcRenderer.on('startup:progress', (payload) => {
    handler(payload as StartupSnapshot);
  });
  return typeof unsubscribe === 'function' ? unsubscribe : () => {};
}
