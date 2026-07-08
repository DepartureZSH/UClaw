import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { recordMainRepairAction } from './diagnostics-context';

export type MainRepairActionId =
  | 'copy-diagnostics'
  | 'export-diagnostics'
  | 'open-log-folder'
  | 'open-data-root'
  | 'restart-gateway'
  | 'relaunch-app'
  | 'quit-app';

export interface MainRepairActionRequest {
  id: string;
  payload?: Record<string, unknown>;
}

export interface MainRepairActionResult {
  success: true;
  copyText?: string;
  filePath?: string;
}

export interface MainRepairActionContext {
  gatewayManager: {
    restart: () => Promise<void> | void;
  };
  getDataRoot: () => string;
  getLogDir: () => string | null;
  openPath: (path: string) => Promise<unknown>;
  relaunch: () => void;
  quit: () => void;
  collectDiagnosticsText: () => Promise<string>;
}

export async function executeRepairAction(
  request: MainRepairActionRequest,
  context: MainRepairActionContext,
): Promise<MainRepairActionResult> {
  recordMainRepairAction({ id: request.id, status: 'started' });
  try {
    let result: MainRepairActionResult;
    switch (request.id as MainRepairActionId) {
      case 'restart-gateway':
        await context.gatewayManager.restart();
        result = { success: true };
        break;
      case 'open-log-folder': {
        const logDir = context.getLogDir();
        if (logDir) await context.openPath(logDir);
        result = { success: true };
        break;
      }
      case 'open-data-root': {
        const dataRoot = context.getDataRoot();
        if (dataRoot) await context.openPath(dataRoot);
        result = { success: true };
        break;
      }
      case 'copy-diagnostics':
        result = { success: true, copyText: await context.collectDiagnosticsText() };
        break;
      case 'export-diagnostics': {
        const dir = join(context.getDataRoot(), 'uclaw', 'diagnostics');
        await mkdir(dir, { recursive: true });
        const stamp = new Date().toISOString()
          .replace(/[-:]/g, '')
          .replace('T', '-')
          .slice(0, 15);
        const filePath = join(dir, `uclaw-diagnostics-${stamp}.txt`);
        await writeFile(filePath, await context.collectDiagnosticsText(), 'utf8');
        await context.openPath(dir);
        result = { success: true, filePath };
        break;
      }
      case 'relaunch-app':
        context.relaunch();
        result = { success: true };
        break;
      case 'quit-app':
        context.quit();
        result = { success: true };
        break;
      default:
        throw new Error(`Unsupported repair action: ${request.id}`);
    }
    recordMainRepairAction({ id: request.id, status: 'success' });
    return result;
  } catch (error) {
    recordMainRepairAction({
      id: request.id,
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
