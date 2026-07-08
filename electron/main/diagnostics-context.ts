import type { StartupSnapshot } from '../../shared/startup';
import type { RepairActionRecord } from './diagnostics-package';

export interface StartupDiagnosticsProvider {
  getSnapshot: () => Pick<StartupSnapshot, 'status' | 'currentStep' | 'message' | 'issue' | 'steps'>;
  getRepairActionRecords: () => RepairActionRecord[];
}

let startupDiagnosticsProvider: StartupDiagnosticsProvider | null = null;
let mainRepairActionRecords: RepairActionRecord[] = [];

export function setStartupDiagnosticsProvider(provider: StartupDiagnosticsProvider): void {
  startupDiagnosticsProvider = provider;
}

export function clearStartupDiagnosticsProvider(): void {
  startupDiagnosticsProvider = null;
}

export function getStartupDiagnosticsProvider(): StartupDiagnosticsProvider | null {
  return startupDiagnosticsProvider;
}

export function recordMainRepairAction(record: Omit<RepairActionRecord, 'at'>): void {
  mainRepairActionRecords.push({ ...record, at: new Date().toISOString() });
  if (mainRepairActionRecords.length > 50) {
    mainRepairActionRecords = mainRepairActionRecords.slice(-50);
  }
}

export function getMainRepairActionRecords(): RepairActionRecord[] {
  return mainRepairActionRecords.map((record) => ({ ...record }));
}

export function clearMainRepairActionRecords(): void {
  mainRepairActionRecords = [];
}
