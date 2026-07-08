export type MainRepairActionId =
  | 'copy-diagnostics'
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
  switch (request.id as MainRepairActionId) {
    case 'restart-gateway':
      await context.gatewayManager.restart();
      return { success: true };
    case 'open-log-folder': {
      const logDir = context.getLogDir();
      if (logDir) await context.openPath(logDir);
      return { success: true };
    }
    case 'open-data-root': {
      const dataRoot = context.getDataRoot();
      if (dataRoot) await context.openPath(dataRoot);
      return { success: true };
    }
    case 'copy-diagnostics':
      return { success: true, copyText: await context.collectDiagnosticsText() };
    case 'relaunch-app':
      context.relaunch();
      return { success: true };
    case 'quit-app':
      context.quit();
      return { success: true };
    default:
      throw new Error(`Unsupported repair action: ${request.id}`);
  }
}
