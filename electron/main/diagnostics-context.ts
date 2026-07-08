import type { StartupSnapshot } from '../../shared/startup';
import type { RepairActionRecord } from './diagnostics-package';

export interface StartupDiagnosticsProvider {
  getSnapshot: () => Pick<StartupSnapshot, 'status' | 'currentStep' | 'message' | 'issue' | 'steps'>;
  getRepairActionRecords: () => RepairActionRecord[];
}

let startupDiagnosticsProvider: StartupDiagnosticsProvider | null = null;

export function setStartupDiagnosticsProvider(provider: StartupDiagnosticsProvider): void {
  startupDiagnosticsProvider = provider;
}

export function clearStartupDiagnosticsProvider(): void {
  startupDiagnosticsProvider = null;
}

export function getStartupDiagnosticsProvider(): StartupDiagnosticsProvider | null {
  return startupDiagnosticsProvider;
}
