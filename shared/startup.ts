export type StartupStepId =
  | 'app-init'
  | 'settings-load'
  | 'workspace-resolve'
  | 'workspace-repair'
  | 'setup-check'
  | 'config-sync'
  | 'remote-config-sync'
  | 'provider-key-sync'
  | 'gateway-start';

export type StartupStepStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'warning'
  | 'error'
  | 'timeout'
  | 'skipped';

export type StartupOverallStatus =
  | 'booting'
  | 'blockedBySetup'
  | 'ready'
  | 'warning'
  | 'error'
  | 'timeout';

export type StartupIssueType =
  | 'external'
  | 'internal'
  | 'normal-blocking';

export type StartupSeverity =
  | 'S0'
  | 'S1'
  | 'S2'
  | 'S3';

export type StartupActionId =
  | 'retry-current-step'
  | 'restart-gateway'
  | 'stop-old-gateway-and-retry'
  | 'resync-token'
  | 'switch-provider'
  | 'rescan-provider-config'
  | 'enter-company-key'
  | 'select-workspace'
  | 'open-workspace-folder'
  | 'open-data-root'
  | 'open-log-folder'
  | 'copy-diagnostics'
  | 'export-diagnostics'
  | 'quit-app';

export interface StartupAction {
  id: StartupActionId;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  payload?: Record<string, unknown>;
}

export interface StartupStepSnapshot {
  id: StartupStepId;
  label: string;
  status: StartupStepStatus;
  message: string;
  detail?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface StartupIssue {
  type: StartupIssueType;
  severity: StartupSeverity;
  code: string;
  title: string;
  suggestion: string;
}

export interface StartupSnapshot {
  status: StartupOverallStatus;
  currentStep: StartupStepId | null;
  steps: StartupStepSnapshot[];
  progress: number;
  message: string;
  detail?: string;
  issue?: StartupIssue;
  actions: StartupAction[];
  updatedAt: number;
}

export interface StartupActionRequest {
  id: StartupActionId;
  payload?: Record<string, unknown>;
}

export interface StartupActionResult {
  snapshot: StartupSnapshot;
  copyText?: string;
  filePath?: string;
}

export const STARTUP_STEP_ORDER: StartupStepId[] = [
  'app-init',
  'settings-load',
  'workspace-resolve',
  'workspace-repair',
  'setup-check',
  'config-sync',
  'remote-config-sync',
  'provider-key-sync',
  'gateway-start',
];

export const STARTUP_STEP_LABELS: Record<StartupStepId, string> = {
  'app-init': '应用初始化',
  'settings-load': '读取本机设置',
  'workspace-resolve': '解析工作区',
  'workspace-repair': '修复随盘工作区',
  'setup-check': '检查用户配置状态',
  'config-sync': '同步配置',
  'remote-config-sync': '同步远程配置',
  'provider-key-sync': '检查 Provider 密钥',
  'gateway-start': '启动 OpenClaw Gateway',
};
