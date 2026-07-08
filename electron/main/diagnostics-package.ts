import { app } from 'electron';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfiguredDataRoot } from '../utils/data-root';
import { logger } from '../utils/logger';
import { getOpenClawConfigDir, getOpenClawStatus } from '../utils/paths';
import { redactDiagnosticsValue } from '../utils/diagnostics-redaction';
import { getStartupDiagnosticsProvider } from './diagnostics-context';

const DEFAULT_TAIL_LINES = 200;

export interface RepairActionRecord {
  id: string;
  label?: string;
  status: 'started' | 'success' | 'error';
  message?: string;
  at: string;
}

export interface SupportDiagnosticsPackage {
  schema: 'uclaw-support-diagnostics';
  version: 1;
  capturedAt: string;
  app: {
    version: string;
    platform: NodeJS.Platform;
    arch: string;
    packaged: boolean;
  };
  storage: {
    dataRoot: string;
    uclawDir?: string;
    openclawDir?: string;
    workspaceDir?: string | null;
    settingsPath?: string;
    providerStorePath?: string;
    logDir?: string | null;
  };
  startup?: {
    status: string;
    currentStep: string | null;
    message: string;
    issue?: unknown;
    steps: Array<{ id: string; status: string; message: string; detail?: string }>;
  };
  gateway?: unknown;
  channels?: unknown;
  runtime?: {
    openclawDir?: string;
    openclawConfigDir?: string;
    openclawStatus?: unknown;
  };
  logs: {
    uclawTail: string;
    gatewayTail: string;
    gatewayErrTail: string;
  };
  repairActions: RepairActionRecord[];
}

async function readTail(filePath: string, tailLines = DEFAULT_TAIL_LINES): Promise<string> {
  const safeTailLines = Math.max(1, Math.floor(tailLines));
  try {
    const file = await open(filePath, 'r');
    try {
      const stat = await file.stat();
      if (stat.size === 0) return '';

      const chunkSize = 64 * 1024;
      let position = stat.size;
      let content = '';
      let lineCount = 0;

      while (position > 0 && lineCount <= safeTailLines) {
        const bytesToRead = Math.min(chunkSize, position);
        position -= bytesToRead;
        const buffer = Buffer.allocUnsafe(bytesToRead);
        const { bytesRead } = await file.read(buffer, 0, bytesToRead, position);
        content = `${buffer.subarray(0, bytesRead).toString('utf-8')}${content}`;
        lineCount = content.split('\n').length - 1;
      }

      const lines = content.split('\n');
      return lines.length <= safeTailLines ? content : lines.slice(-safeTailLines).join('\n');
    } finally {
      await file.close();
    }
  } catch {
    return '';
  }
}

export async function buildSupportDiagnosticsPackage(input: {
  storageDiagnostics: {
    dataRoot?: string;
    uclawDir?: string;
    openclawDir?: string;
    workspaceDir?: string | null;
    settingsPath?: string;
    providerStorePath?: string;
  };
  startupSnapshot?: {
    status: string;
    currentStep: string | null;
    message: string;
    issue?: unknown;
    steps: Array<{ id: string; status: string; message: string; detail?: string }>;
  };
  gatewayManager?: {
    getStatus?: () => unknown;
    getDiagnostics?: () => unknown;
  };
  repairActions?: RepairActionRecord[];
}): Promise<SupportDiagnosticsPackage> {
  const dataRoot = input.storageDiagnostics.dataRoot || getConfiguredDataRoot();
  const openclawConfigDir = input.storageDiagnostics.openclawDir || getOpenClawConfigDir();
  const uclawDir = input.storageDiagnostics.uclawDir || join(dataRoot, 'uclaw');
  const startupProvider = getStartupDiagnosticsProvider();
  const startupSnapshot = input.startupSnapshot ?? startupProvider?.getSnapshot();
  const repairActions = input.repairActions ?? startupProvider?.getRepairActionRecords() ?? [];
  const pkg: SupportDiagnosticsPackage = {
    schema: 'uclaw-support-diagnostics',
    version: 1,
    capturedAt: new Date().toISOString(),
    app: {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
    },
    storage: {
      dataRoot,
      uclawDir,
      openclawDir: openclawConfigDir,
      workspaceDir: input.storageDiagnostics.workspaceDir ?? null,
      settingsPath: input.storageDiagnostics.settingsPath,
      providerStorePath: input.storageDiagnostics.providerStorePath,
      logDir: logger.getLogDir(),
    },
    startup: startupSnapshot
      ? {
        status: startupSnapshot.status,
        currentStep: startupSnapshot.currentStep,
        message: startupSnapshot.message,
        issue: startupSnapshot.issue,
        steps: startupSnapshot.steps.map((step) => ({
          id: step.id,
          status: step.status,
          message: step.message,
          detail: step.detail,
        })),
      }
      : undefined,
    gateway: input.gatewayManager
      ? {
        status: input.gatewayManager.getStatus?.(),
        diagnostics: input.gatewayManager.getDiagnostics?.(),
      }
      : undefined,
    runtime: {
      openclawConfigDir,
      openclawStatus: getOpenClawStatus(),
    },
    logs: {
      uclawTail: await logger.readLogFile(DEFAULT_TAIL_LINES),
      gatewayTail: await readTail(join(openclawConfigDir, 'logs', 'gateway.log')),
      gatewayErrTail: await readTail(join(openclawConfigDir, 'logs', 'gateway.err.log')),
    },
    repairActions,
  };

  return redactDiagnosticsValue(pkg);
}

export function formatSupportDiagnosticsText(pkg: SupportDiagnosticsPackage): string {
  return JSON.stringify(redactDiagnosticsValue(pkg), null, 2);
}
