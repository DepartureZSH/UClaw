import { app, ipcMain, shell, type BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import type { GatewayManager, GatewayStatus } from '../gateway/manager';
import { syncAllProviderAuthToRuntime, syncDefaultProviderToRuntime } from '../services/providers/provider-runtime-sync';
import { getProviderService } from '../services/providers/provider-service';
import { getProviderSecret } from '../services/secrets/secret-store';
import { getDefaultProviderAccountId, getProviderAccount, listProviderAccounts } from '../services/providers/provider-store';
import { getOpenClawProviderKeyForType } from '../utils/provider-keys';
import { getOpenClawConfigDir } from '../utils/paths';
import { getConfiguredDataRoot } from '../utils/data-root';
import {
  getOpenClawProvidersConfig,
  getOpenClawRuntimeApiKey,
  getOpenClawRuntimeCredentialProviders,
} from '../utils/openclaw-auth';
import { getAllSettings, getSetting, setSetting, type AppSettings } from '../utils/store';
import { logger } from '../utils/logger';
import { resolveStartupRuntimeConfig, type StartupRuntimeConfig } from '../utils/startup-config';
import { resolvePortableWorkspaceDir, resolveStartupWorkspaceState } from './workspace-startup';
import { syncRemoteConfig } from './remote-config-sync';
import type {
  StartupAction,
  StartupActionRequest,
  StartupActionResult,
  StartupIssue,
  StartupOverallStatus,
  StartupSeverity,
  StartupSnapshot,
  StartupStepId,
  StartupStepSnapshot,
  StartupStepStatus,
} from '../../shared/startup';
import {
  STARTUP_STEP_LABELS,
  STARTUP_STEP_ORDER,
} from '../../shared/startup';

type StorageDiagnosticsLike = {
  isAppTranslocated: boolean;
  dataRoot?: string;
  uclawDir?: string;
  openclawDir?: string;
  workspaceDir?: string | null;
  settingsPath?: string;
  providerStorePath?: string;
  exePath?: string;
  appPath?: string;
};

type StartupContext = {
  isE2EMode: boolean;
  storageDiagnostics: StorageDiagnosticsLike;
  startupError?: unknown;
};

type StepRunResult = {
  status?: StartupStepStatus;
  message?: string;
  detail?: string;
  actions?: StartupAction[];
  issue?: StartupIssue;
};

type ProviderWarning = {
  message: string;
  detail: string;
  actions: StartupAction[];
  issue: StartupIssue;
};

function createInitialSteps(): StartupStepSnapshot[] {
  return STARTUP_STEP_ORDER.map((id) => ({
    id,
    label: STARTUP_STEP_LABELS[id],
    status: 'pending',
    message: '等待开始',
  }));
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  }
  return String(error);
}

function getProviderFromModelRef(modelRef: string | undefined): string | null {
  if (!modelRef || !modelRef.includes('/')) return null;
  const provider = modelRef.split('/')[0]?.trim();
  return provider || null;
}

function buildProgress(steps: StartupStepSnapshot[]): number {
  const weighted = steps.reduce((sum, step) => {
    if (step.status === 'success' || step.status === 'warning' || step.status === 'skipped') {
      return sum + 1;
    }
    if (step.status === 'running') {
      return sum + 0.45;
    }
    return sum;
  }, 0);
  return Math.min(100, Math.round((weighted / steps.length) * 100));
}

function createIssue(
  type: StartupIssue['type'],
  severity: StartupSeverity,
  code: string,
  title: string,
  suggestion: string,
): StartupIssue {
  return { type, severity, code, title, suggestion };
}

export function classifyStartupError(error: unknown): { message: string; actions: StartupAction[]; issue: StartupIssue } {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const normalized = raw.toLowerCase();

  if (
    normalized.includes('data root already locked') ||
    normalized.includes('data root lock acquisition failed')
  ) {
    return {
      message: '数据目录正在被另一个 UClaw 实例使用，已阻止启动以避免配置损坏。',
      issue: createIssue(
        'external',
        'S0',
        'DATA_ROOT_LOCKED',
        '数据目录已被占用',
        '请确认没有在另一台电脑、另一个系统或另一个 UClaw 窗口中同时打开同一个移动盘数据目录。关闭另一端后再重试。不要手动删除锁文件，除非已经确认没有其他实例在运行。',
      ),
      actions: [
        { id: 'open-data-root', label: '打开数据目录', variant: 'secondary' },
        { id: 'open-log-folder', label: '查看日志' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
        { id: 'quit-app', label: '退出应用', variant: 'danger' },
      ],
    };
  }

  if (
    normalized.includes('data root writable check failed') ||
    normalized.includes('eacces') ||
    normalized.includes('eperm') ||
    normalized.includes('permission denied') ||
    normalized.includes('read-only') ||
    normalized.includes('readonly') ||
    normalized.includes('access denied')
  ) {
    return {
      message: '数据目录不可写，已阻止启动以避免配置丢失。',
      issue: createIssue(
        'external',
        'S0',
        'DATA_ROOT_NOT_WRITABLE',
        '数据目录不可写',
        '请检查移动盘或数据目录权限，不要把数据目录放在只读位置。确认权限后重试，必要时退出应用后更换数据目录。',
      ),
      actions: [
        { id: 'open-data-root', label: '打开数据目录', variant: 'secondary' },
        { id: 'open-log-folder', label: '查看日志' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
        { id: 'quit-app', label: '退出应用', variant: 'danger' },
      ],
    };
  }

  if (
    normalized.includes('json') && (
      normalized.includes('unexpected') ||
      normalized.includes('parse') ||
      normalized.includes('unterminated') ||
      normalized.includes('invalid')
    )
  ) {
    return {
      message: '启动配置文件可能已损坏，已阻止继续以保护数据。',
      issue: createIssue(
        'external',
        'S0',
        'CONFIG_JSON_CORRUPTED',
        '配置文件损坏',
        '请先备份 dataRoot 和工作区中的 JSON 配置，再根据日志定位损坏文件。不要在同步未完成或应用运行时拔出移动盘。',
      ),
      actions: [
        { id: 'open-data-root', label: '打开数据目录', variant: 'primary' },
        { id: 'open-log-folder', label: '查看日志' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
        { id: 'quit-app', label: '退出应用', variant: 'danger' },
      ],
    };
  }

  if (normalized.includes('remote config') && (normalized.includes('unauthorized') || normalized.includes('403') || normalized.includes('401'))) {
    return {
      message: '远程配置鉴权失败，已阻止启动。',
      issue: createIssue(
        'external',
        'S1',
        'REMOTE_CONFIG_UNAUTHORIZED',
        '远程配置鉴权失败',
        '请填写或更换公司密钥；如果仍失败，请联系运维确认该密钥是否仍有效。',
      ),
      actions: [
        { id: 'enter-company-key', label: '填写公司密钥', variant: 'primary' },
        { id: 'retry-current-step', label: '重试配置同步' },
        { id: 'open-log-folder', label: '查看日志' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
        { id: 'quit-app', label: '退出应用', variant: 'danger' },
      ],
    };
  }

  if (normalized.includes('unauthorized') || normalized.includes('token mismatch')) {
    return {
      message: 'Gateway 认证失败，请重新同步 token 后重试。',
      issue: createIssue(
        'internal',
        'S2',
        'GATEWAY_TOKEN_MISMATCH',
        'Gateway 认证不一致',
        '请重新同步 token 后重试；如果仍失败，再重启 Gateway。',
      ),
      actions: [
        { id: 'resync-token', label: '重新同步 token', variant: 'primary' },
        { id: 'restart-gateway', label: '重启 Gateway' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
      ],
    };
  }

  if (normalized.includes('pairing required') || normalized.includes('pairing-required')) {
    return {
      message: 'Gateway 需要重新配对，请重启 Gateway 后再次连接。',
      issue: createIssue(
        'internal',
        'S1',
        'GATEWAY_PAIRING_REQUIRED',
        'Gateway 需要重新配对',
        '请重启 Gateway 后再次连接。如多次失败，请打开日志定位认证状态。',
      ),
      actions: [
        { id: 'restart-gateway', label: '重启 Gateway', variant: 'primary' },
        { id: 'open-log-folder', label: '查看日志' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
      ],
    };
  }

  if (
    normalized.includes('eaddrinuse') ||
    normalized.includes('port') && normalized.includes('occupied') ||
    normalized.includes('address already in use')
  ) {
    return {
      message: 'Gateway 端口被占用，请停止旧 Gateway 后重试。',
      issue: createIssue(
        'external',
        'S2',
        'GATEWAY_PORT_OCCUPIED',
        'Gateway 端口被占用',
        '请停止旧 Gateway 或占用端口的进程，然后重试启动。',
      ),
      actions: [
        { id: 'stop-old-gateway-and-retry', label: '停止旧 Gateway 并重试', variant: 'primary' },
        { id: 'open-log-folder', label: '查看日志' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
      ],
    };
  }

  if (normalized.includes('start process') || normalized.includes('process start') || normalized.includes('start failed')) {
    return {
      message: 'Gateway 进程启动失败，请重启 Gateway 后重试。',
      issue: createIssue(
        'internal',
        'S1',
        'GATEWAY_PROCESS_START_FAILED',
        'Gateway 进程启动失败',
        '请重启 Gateway 后重试。如果持续失败，请查看日志确认运行时文件是否完整、是否被系统安全软件拦截。',
      ),
      actions: [
        { id: 'restart-gateway', label: '重启 Gateway', variant: 'primary' },
        { id: 'open-log-folder', label: '查看日志' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
      ],
    };
  }

  if (normalized.includes('wait port') || normalized.includes('port release timeout')) {
    return {
      message: 'Gateway 端口等待超时，可能仍被旧进程占用。',
      issue: createIssue(
        'external',
        'S2',
        'GATEWAY_PORT_WAIT_TIMEOUT',
        'Gateway 端口等待超时',
        '请停止旧 Gateway 或占用端口的进程，然后重试启动。',
      ),
      actions: [
        { id: 'stop-old-gateway-and-retry', label: '停止旧 Gateway 并重试', variant: 'primary' },
        { id: 'open-log-folder', label: '查看日志' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
      ],
    };
  }

  if (normalized.includes('connect handshake timeout') || normalized.includes('websocket') && normalized.includes('timeout')) {
    return {
      message: 'Gateway WebSocket 握手超时，请重启 Gateway 后重试。',
      issue: createIssue(
        'internal',
        'S1',
        'GATEWAY_WS_HANDSHAKE_TIMEOUT',
        'Gateway WebSocket 握手超时',
        '请重启 Gateway 后重试。如果持续超时，请查看日志确认 Gateway 是否已监听本机端口。',
      ),
      actions: [
        { id: 'restart-gateway', label: '重启 Gateway', variant: 'primary' },
        { id: 'open-log-folder', label: '查看日志' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
      ],
    };
  }

  if (normalized.includes('rpc timeout') || normalized.includes('ready timeout') || normalized.includes('rpc ready timeout') || normalized.includes('超时')) {
    return {
      message: 'Gateway 响应超时，请重启 Gateway 后重试。',
      issue: createIssue(
        'internal',
        'S1',
        'GATEWAY_RPC_READY_TIMEOUT',
        'Gateway 响应超时',
        '请重启 Gateway 后重试。如果持续超时，请查看日志确认 Gateway 是否正常启动。',
      ),
      actions: [
        { id: 'restart-gateway', label: '重启 Gateway', variant: 'primary' },
        { id: 'open-log-folder', label: '查看日志' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
      ],
    };
  }

  if (normalized.includes('remote config')) {
    return {
      message: '远程配置暂不可用，且本地没有可用缓存，已阻止启动。',
      issue: createIssue(
        'external',
        'S1',
        normalized.includes('missing provider') ? 'REMOTE_CONFIG_INVALID' : 'REMOTE_CONFIG_UNAVAILABLE',
        '远程配置不可用',
        '请检查网络连接，确认公司密钥已填写；如果仍失败，请联系运维确认 Laf 配置下发服务是否正常。',
      ),
      actions: [
        { id: 'retry-current-step', label: '重试配置同步', variant: 'primary' },
        { id: 'enter-company-key', label: '填写公司密钥' },
        { id: 'open-log-folder', label: '查看日志' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
        { id: 'quit-app', label: '退出应用', variant: 'danger' },
      ],
    };
  }

  if (normalized.includes('portable workspace repair failed')) {
    return {
      message: '随盘工作区无法创建或修复，已阻止启动。',
      issue: createIssue(
        'external',
        'S1',
        'PORTABLE_WORKSPACE_REPAIR_FAILED',
        '随盘工作区修复失败',
        '请确认移动盘可写、空间充足且未被安全软件拦截，然后重试启动。',
      ),
      actions: [
        { id: 'open-data-root', label: '打开数据目录', variant: 'secondary' },
        { id: 'open-log-folder', label: '查看日志' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
        { id: 'quit-app', label: '退出应用', variant: 'danger' },
      ],
    };
  }

  if (normalized.includes('plugin not found') || normalized.includes('cannot find plugin')) {
    return {
      message: 'Gateway 插件配置异常，请查看日志并清理异常插件配置。',
      issue: createIssue(
        'internal',
        'S2',
        'GATEWAY_PLUGIN_CONFIG_ERROR',
        '插件配置异常',
        '请查看日志定位缺失或异常插件，清理异常插件配置后重试。',
      ),
      actions: [
        { id: 'open-log-folder', label: '查看日志', variant: 'primary' },
        { id: 'retry-current-step', label: '重试当前步骤' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
      ],
    };
  }

  return {
    message: '启动过程中遇到错误，请查看详情或重试当前步骤。',
    issue: createIssue(
      'internal',
      'S1',
      'STARTUP_UNKNOWN_ERROR',
      '未知启动错误',
      '请复制诊断信息并查看日志；确认问题处理后重试当前步骤。',
    ),
    actions: [
      { id: 'retry-current-step', label: '重试当前步骤', variant: 'primary' },
      { id: 'open-log-folder', label: '查看日志' },
      { id: 'copy-diagnostics', label: '复制诊断信息' },
      { id: 'quit-app', label: '退出应用', variant: 'danger' },
    ],
  };
}

export class StartupProgressService {
  private snapshot: StartupSnapshot = {
    status: 'booting',
    currentStep: null,
    steps: createInitialSteps(),
    progress: 0,
    message: '正在准备启动 UClaw',
    actions: [],
    updatedAt: Date.now(),
  };
  private runPromise: Promise<StartupSnapshot> | null = null;
  private lastContext: StartupContext | null = null;
  private lastSettings: AppSettings | null = null;
  private lastProviderWarning: ProviderWarning | null = null;
  private startupConfig: StartupRuntimeConfig = resolveStartupRuntimeConfig();

  constructor(
    private readonly options: {
      gatewayManager: GatewayManager;
      getMainWindow: () => BrowserWindow | null;
    },
  ) {}

  registerIpcHandlers(): void {
    ipcMain.handle('startup:getSnapshot', () => this.getSnapshot());
    ipcMain.handle('startup:action', async (_, request: StartupActionRequest): Promise<StartupActionResult> => {
      return await this.handleAction(request);
    });
  }

  getSnapshot(): StartupSnapshot {
    return {
      ...this.snapshot,
      steps: this.snapshot.steps.map((step) => ({ ...step })),
      actions: this.snapshot.actions.map((action) => ({ ...action })),
    };
  }

  async runInitialStartup(context: StartupContext): Promise<StartupSnapshot> {
    this.lastContext = context;
    if (this.runPromise) return this.runPromise;
    this.runPromise = this.runStartup(context).finally(() => {
      this.runPromise = null;
    });
    return this.runPromise;
  }

  private async rerunStartup(): Promise<StartupSnapshot> {
    if (!this.lastContext) return this.getSnapshot();
    this.reset();
    return await this.runInitialStartup(this.lastContext);
  }

  private reset(): void {
    this.lastProviderWarning = null;
    this.startupConfig = resolveStartupRuntimeConfig(this.lastSettings);
    this.snapshot = {
      status: 'booting',
      currentStep: null,
      steps: createInitialSteps(),
      progress: 0,
      message: '正在重新启动 UClaw',
      actions: [],
      updatedAt: Date.now(),
    };
    this.emit();
  }

  private emit(): void {
    this.snapshot = {
      ...this.snapshot,
      progress: buildProgress(this.snapshot.steps),
      updatedAt: Date.now(),
    };
    const win = this.options.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('startup:progress', this.getSnapshot());
    }
  }

  private setOverall(
    status: StartupOverallStatus,
    message: string,
    options?: { detail?: string; issue?: StartupIssue; actions?: StartupAction[]; currentStep?: StartupStepId | null },
  ): void {
    this.snapshot = {
      ...this.snapshot,
      status,
      currentStep: options?.currentStep ?? this.snapshot.currentStep,
      message,
      detail: options?.detail,
      issue: options?.issue,
      actions: options?.actions ?? [],
    };
    this.emit();
  }

  private updateStep(
    id: StartupStepId,
    status: StartupStepStatus,
    message: string,
    options?: { detail?: string },
  ): void {
    const now = Date.now();
    this.snapshot = {
      ...this.snapshot,
      currentStep: status === 'running' ? id : this.snapshot.currentStep,
      steps: this.snapshot.steps.map((step) => (
        step.id === id
          ? {
            ...step,
            status,
            message,
            detail: options?.detail,
            startedAt: status === 'running' ? now : step.startedAt,
            completedAt: status !== 'running' && status !== 'pending' ? now : step.completedAt,
          }
          : step
      )),
      message,
      detail: options?.detail,
    };
    this.emit();
  }

  private skipRemaining(from: StartupStepId, message: string): void {
    let shouldSkip = false;
    this.snapshot = {
      ...this.snapshot,
      steps: this.snapshot.steps.map((step) => {
        if (step.id === from) shouldSkip = true;
        if (!shouldSkip || step.status !== 'pending') return step;
        return {
          ...step,
          status: 'skipped',
          message,
          completedAt: Date.now(),
        };
      }),
    };
    this.emit();
  }

  private async runStep(
    id: StartupStepId,
    message: string,
    fn: () => Promise<StepRunResult | void>,
  ): Promise<StepRunResult | void> {
    this.updateStep(id, 'running', message);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`${STARTUP_STEP_LABELS[id]} 超时`)),
            this.startupConfig.stepTimeouts[id],
          );
        }),
      ]);
      if (timeout) clearTimeout(timeout);
      const status = result?.status ?? 'success';
      this.updateStep(id, status, result?.message ?? `${STARTUP_STEP_LABELS[id]}完成`, {
        detail: result?.detail,
      });
      return result;
    } catch (error) {
      if (timeout) clearTimeout(timeout);
      const classified = classifyStartupError(error);
      const isTimeout = classified.issue.code.includes('TIMEOUT') || String(error).includes('超时');
      this.updateStep(id, isTimeout ? 'timeout' : 'error', classified.message, {
        detail: stringifyError(error),
      });
      this.setOverall(isTimeout ? 'timeout' : 'error', classified.message, {
        detail: stringifyError(error),
        issue: classified.issue,
        actions: classified.actions,
        currentStep: id,
      });
      throw error;
    }
  }

  private async runStartup(context: StartupContext): Promise<StartupSnapshot> {
    try {
      await this.runStep('app-init', '正在初始化应用', async () => ({
        message: (() => {
          if (context.startupError) {
            throw context.startupError;
          }
          return context.storageDiagnostics.isAppTranslocated
            ? '检测到 macOS App Translocation'
            : '应用初始化完成';
        })(),
      }));

      await this.runStep('settings-load', '正在读取本机设置', async () => {
        this.lastSettings = await getAllSettings();
        this.startupConfig = resolveStartupRuntimeConfig(this.lastSettings);
        return { message: '本机设置读取完成' };
      });

      await this.runStep('workspace-resolve', '正在解析工作区', async () => await this.resolveWorkspace(context));

      if (context.storageDiagnostics.isAppTranslocated) {
        this.skipRemaining('setup-check', '已阻塞：macOS App Translocation');
        this.setOverall('error', '检测到 macOS App Translocation，已阻止启动以避免写入错误位置。', {
          issue: createIssue(
            'external',
            'S0',
            'MACOS_APP_TRANSLOCATION',
            'macOS App Translocation',
            '请把 UClaw 移到固定位置后重新打开，必要时清理 quarantine 属性。数据目录可以放在移动盘，但 macOS app 不建议直接放在 ExFAT 上运行。',
          ),
          actions: [
            { id: 'copy-diagnostics', label: '复制诊断信息' },
            { id: 'quit-app', label: '退出应用', variant: 'danger' },
          ],
        });
        return this.getSnapshot();
      }

      const setupResult = await this.runStep('setup-check', '正在检查 Setup 状态', async () => {
        const setupComplete = context.isE2EMode && process.env.UCLAW_E2E_SKIP_SETUP === '1'
          ? true
          : await getSetting('setupComplete');
        if (!setupComplete) {
          await setSetting('setupComplete', true);
          return {
            status: 'success',
            message: '已跳过旧 Setup 向导',
            issue: createIssue(
              'normal-blocking',
              'S3',
              'LEGACY_SETUP_SKIPPED',
              '旧 Setup 状态已自动兼容',
              'UClaw 现在使用随盘工作台和公司密钥下发配置，不再要求普通用户选择工作区或手动配置 AI。',
            ),
            actions: [],
          };
        }
        return { message: 'Setup 已完成' };
      });

      if (setupResult?.status === 'skipped') {
        this.skipRemaining('config-sync', '等待 Setup 完成');
        this.setOverall('blockedBySetup', '需要先完成 Setup，然后再启动 Gateway。', {
          issue: setupResult.issue,
          actions: setupResult.actions,
          currentStep: 'setup-check',
        });
        return this.getSnapshot();
      }

      await this.runStep('config-sync', '正在同步启动配置', async () => ({
        message: '启动配置准备完成',
      }));

      const remoteConfigResult = await this.runStep('remote-config-sync', '正在同步远程配置', async () => {
        const result = await syncRemoteConfig({ appVersion: app.getVersion() });
        return {
          status: result.status === 'skipped' ? 'skipped' : result.status,
          message: result.message,
          detail: result.detail,
        };
      });

      if (remoteConfigResult?.status === 'skipped') {
        this.skipRemaining('provider-key-sync', '等待公司密钥');
        this.setOverall('blockedBySetup', '请先填写公司密钥，以同步 AI 和联网搜索配置。', {
          issue: createIssue(
            'normal-blocking',
            'S3',
            'COMPANY_KEY_REQUIRED',
            '需要公司密钥',
            '公开发布包不会内置公司配置凭证。请由运维输入公司密钥完成随盘工作台初始化，之后普通用户即可免配置使用。',
          ),
          actions: [
            { id: 'enter-company-key', label: '填写公司密钥', variant: 'primary' },
            { id: 'copy-diagnostics', label: '复制诊断信息' },
            { id: 'quit-app', label: '退出应用', variant: 'danger' },
          ],
          currentStep: 'remote-config-sync',
        });
        return this.getSnapshot();
      }

      const gatewayAutoStart = context.isE2EMode ? false : await getSetting('gatewayAutoStart');

      await this.runStep('provider-key-sync', '正在检查 Provider 密钥', async () => {
        if (!gatewayAutoStart) {
          return {
            status: 'skipped',
            message: context.isE2EMode
              ? 'E2E 模式跳过 Provider 密钥阻塞检查'
              : 'Gateway 自动启动已关闭，跳过 Provider 密钥阻塞检查',
          };
        }
        const warning = await this.checkProviderKeys();
        await syncAllProviderAuthToRuntime();
        if (warning) {
          this.lastProviderWarning = warning;
          return {
            status: 'warning',
            message: warning.message,
            detail: warning.detail,
            issue: warning.issue,
            actions: warning.actions,
          };
        }
        return { message: 'Provider 密钥检查完成' };
      });

      await this.runStep('gateway-start', '正在启动 OpenClaw Gateway', async () => {
        if (!gatewayAutoStart) {
          return {
            status: 'skipped',
            message: 'Gateway 自动启动已关闭',
          };
        }
        await this.startGatewayWithProgress();
        return { message: 'Gateway 已就绪' };
      });

      const hasWarning = this.snapshot.steps.some((step) => step.status === 'warning');
      this.setOverall(
        hasWarning ? 'warning' : 'ready',
        hasWarning ? '启动完成，但 Provider 配置需要处理。' : '启动完成',
        { issue: hasWarning ? this.lastProviderWarning?.issue : undefined, actions: hasWarning ? this.lastProviderWarning?.actions : [] },
      );
      return this.getSnapshot();
    } catch {
      return this.getSnapshot();
    }
  }

  private async resolveWorkspace(context: StartupContext): Promise<StepRunResult> {
    if (context.isE2EMode || context.storageDiagnostics.isAppTranslocated) {
      return { message: context.isE2EMode ? 'E2E 模式跳过工作区副作用' : 'App Translocation 阻止工作区解析' };
    }

    const { setupComplete, workspaceDir, resetReason, resetWorkspaceDir } = await resolveStartupWorkspaceState();
    if (resetReason) {
      logger.warn(
        resetReason === 'missing-workspace'
          ? `[workspace] Persisted workspace no longer exists; resetting setup state: ${resetWorkspaceDir ?? '(unknown)'}`
          : '[workspace] Setup was marked complete without a workspace; resetting setup state',
      );
      delete process.env.UCLAW_WORKSPACE_DIR;
      return {
        status: 'warning',
        message: '已忽略不可用的旧工作区路径',
        detail: resetWorkspaceDir,
        issue: createIssue(
          'external',
          'S3',
          resetReason === 'missing-workspace' ? 'WORKSPACE_NOT_FOUND' : 'WORKSPACE_REQUIRED',
          resetReason === 'missing-workspace' ? '工作区路径不存在' : '工作区需要重新确认',
          'UClaw 会优先使用随盘工作台或默认工作区继续启动。请确认数据目录可写；如果问题持续，请打开数据目录检查配置。',
        ),
        actions: [
          { id: 'retry-current-step', label: '重试启动检查', variant: 'primary' },
          { id: 'open-data-root', label: '打开数据目录' },
        ],
      };
    }

    if (workspaceDir) {
      process.env.UCLAW_WORKSPACE_DIR = workspaceDir;
      logger.info(`[workspace] Using custom workspace: ${workspaceDir}`);
      return { message: `使用工作区：${workspaceDir}` };
    }

    if (!setupComplete) {
      delete process.env.UCLAW_WORKSPACE_DIR;
      return { message: 'Setup 未完成，暂不使用持久化工作区' };
    }

    return { message: '使用默认 OpenClaw 工作区' };
  }

  private async checkProviderKeys(): Promise<ProviderWarning | null> {
    const { defaultModel } = await getOpenClawProvidersConfig();
    const defaultRuntimeProvider = getProviderFromModelRef(defaultModel);
    if (!defaultRuntimeProvider) {
      return null;
    }

    const runtimeCredentialProviders = await getOpenClawRuntimeCredentialProviders();
    const runtimeKey = await getOpenClawRuntimeApiKey([defaultRuntimeProvider]);
    if (runtimeKey || runtimeCredentialProviders.has(defaultRuntimeProvider)) {
      return null;
    }

    const accounts = await listProviderAccounts();
    const keyedAccounts: Array<{ id: string; label: string; runtimeProvider: string }> = [];
    for (const account of accounts) {
      if (account.enabled === false) continue;
      const accountRuntimeProvider = getOpenClawProviderKeyForType(account.vendorId, account.id);
      const secret = await getProviderSecret(account.id);
      const hasUsableSecret = secret?.type === 'api_key'
        || (secret?.type === 'local' && Boolean(secret.apiKey))
        || secret?.type === 'oauth'
        || Boolean(await getOpenClawRuntimeApiKey([accountRuntimeProvider, account.id, account.vendorId]));
      if (hasUsableSecret) {
        keyedAccounts.push({
          id: account.id,
          label: account.label || account.id,
          runtimeProvider: accountRuntimeProvider,
        });
      }
    }

    const defaultAccountId = await getDefaultProviderAccountId();
    const defaultAccount = defaultAccountId ? await getProviderAccount(defaultAccountId) : null;
    if (defaultAccount) {
      const defaultAccountRuntimeProvider = getOpenClawProviderKeyForType(defaultAccount.vendorId, defaultAccount.id);
      if (defaultAccountRuntimeProvider === defaultRuntimeProvider) {
        return null;
      }
    }

    const switchTarget = keyedAccounts.find((account) => account.runtimeProvider === 'new-api')
      ?? keyedAccounts[0];

    const actions: StartupAction[] = [
      { id: 'rescan-provider-config', label: '重新扫描配置', variant: 'secondary' },
    ];
    if (switchTarget) {
      actions.unshift({
        id: 'switch-provider',
        label: `切回 ${switchTarget.label}`,
        variant: 'primary',
        payload: { providerId: switchTarget.id },
      });
    }

    return {
      message: `默认 Provider「${defaultRuntimeProvider}」没有可用密钥`,
      detail: switchTarget
        ? `检测到已配置密钥的 Provider：${keyedAccounts.map((item) => item.label).join(', ')}`
        : '未检测到可切换的已配置 Provider。可在 Setup 或设置中补充 API Key。',
      issue: createIssue(
        'internal',
        'S2',
        'PROVIDER_KEY_MISSING',
        '默认 Provider 缺少可用密钥',
        '请切换到已有密钥的 Provider，或重新扫描配置后补充 API Key。',
      ),
      actions,
    };
  }

  private async startGatewayWithProgress(): Promise<void> {
    await this.options.gatewayManager.start({
      startupConfig: this.startupConfig.gateway,
      onStartupProgress: (progress) => {
        const messageByPhase: Record<string, string> = {
          'find-existing': '正在检查已有 Gateway',
          'wait-port': '正在等待端口释放',
          'start-process': '正在启动 Gateway 进程',
          'wait-ready': '正在等待 Gateway 端口就绪',
          connect: '正在建立 WebSocket 握手',
          'rpc-ready': '正在确认 RPC 可用',
        };
        this.updateStep('gateway-start', 'running', messageByPhase[progress.phase] ?? '正在启动 Gateway', {
          detail: progress.message,
        });
      },
    });
    await this.waitForGatewayReady();
  }

  private async waitForGatewayReady(timeoutMs = this.startupConfig.stepTimeouts['gateway-start']): Promise<void> {
    const status = this.options.gatewayManager.getStatus();
    if (this.isGatewayReady(status)) return;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Gateway RPC ready timeout'));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        this.options.gatewayManager.off('status', onStatus);
      };

      const onStatus = (nextStatus: GatewayStatus) => {
        if (this.isGatewayReady(nextStatus)) {
          cleanup();
          resolve();
        }
        if (nextStatus.state === 'error') {
          cleanup();
          reject(new Error(nextStatus.error || 'Gateway start failed'));
        }
      };

      this.options.gatewayManager.on('status', onStatus);
      onStatus(this.options.gatewayManager.getStatus());
    });
  }

  private isGatewayReady(status: GatewayStatus): boolean {
    return status.state === 'running' && status.gatewayReady !== false;
  }

  private buildDiagnosticsText(): string {
    const snapshot = this.getSnapshot();
    const diagnostics = this.lastContext?.storageDiagnostics;
    return [
      'UClaw startup diagnostics',
      `status: ${snapshot.status}`,
      `currentStep: ${snapshot.currentStep ?? '-'}`,
      `message: ${snapshot.message}`,
      `dataRoot: ${diagnostics?.dataRoot ?? getConfiguredDataRoot()}`,
      `uclawDir: ${diagnostics?.uclawDir ?? '-'}`,
      `openclawDir: ${diagnostics?.openclawDir ?? getOpenClawConfigDir()}`,
      `workspaceDir: ${diagnostics?.workspaceDir ?? process.env.UCLAW_WORKSPACE_DIR ?? '-'}`,
      `settingsPath: ${diagnostics?.settingsPath ?? '-'}`,
      `providerStorePath: ${diagnostics?.providerStorePath ?? '-'}`,
      `logDir: ${logger.getLogDir()}`,
      `exePath: ${diagnostics?.exePath ?? '-'}`,
      `appPath: ${diagnostics?.appPath ?? '-'}`,
      snapshot.issue
        ? `issue: ${snapshot.issue.severity} ${snapshot.issue.type} ${snapshot.issue.code}\n${snapshot.issue.title}\n${snapshot.issue.suggestion}`
        : '',
      snapshot.detail ? `detail:\n${snapshot.detail}` : '',
      'steps:',
      ...snapshot.steps.map((step) => `- ${step.id}: ${step.status} ${step.message}${step.detail ? `\n  ${step.detail}` : ''}`),
    ].filter(Boolean).join('\n');
  }

  private async handleAction(request: StartupActionRequest): Promise<StartupActionResult> {
    switch (request.id) {
      case 'retry-current-step':
      case 'rescan-provider-config':
        return { snapshot: await this.rerunStartup() };
      case 'restart-gateway':
        await this.options.gatewayManager.restart();
        return { snapshot: await this.rerunStartup() };
      case 'stop-old-gateway-and-retry':
        await this.options.gatewayManager.stop();
        return { snapshot: await this.rerunStartup() };
      case 'resync-token':
        await syncAllProviderAuthToRuntime();
        return { snapshot: await this.rerunStartup() };
      case 'switch-provider': {
        const providerId = typeof request.payload?.providerId === 'string'
          ? request.payload.providerId
          : undefined;
        if (providerId) {
          await getProviderService().setDefaultAccount(providerId);
          await syncDefaultProviderToRuntime(providerId, this.options.gatewayManager);
        }
        return { snapshot: await this.rerunStartup() };
      }
      case 'select-workspace': {
        const portableWorkspace = resolvePortableWorkspaceDir();
        if (portableWorkspace?.resolved) {
          await setSetting('workspaceDir', portableWorkspace.stored);
          process.env.UCLAW_WORKSPACE_DIR = portableWorkspace.resolved;
        }
        await setSetting('setupComplete', true);
        return { snapshot: await this.rerunStartup() };
      }
      case 'open-workspace-folder': {
        const workspaceDir = await getSetting('workspaceDir');
        const dir = resolvePortableWorkspaceDir()?.resolved
          ?? process.env.UCLAW_WORKSPACE_DIR
          ?? workspaceDir
          ?? getOpenClawConfigDir();
        if (existsSync(dir)) {
          await shell.openPath(dir);
        }
        return { snapshot: this.getSnapshot() };
      }
      case 'open-data-root': {
        const dir = this.lastContext?.storageDiagnostics.dataRoot ?? getConfiguredDataRoot();
        if (existsSync(dir)) {
          await shell.openPath(dir);
        }
        return { snapshot: this.getSnapshot() };
      }
      case 'open-log-folder': {
        await shell.openPath(logger.getLogDir());
        return { snapshot: this.getSnapshot() };
      }
      case 'copy-diagnostics': {
        return { snapshot: this.getSnapshot(), copyText: this.buildDiagnosticsText() };
      }
      case 'quit-app':
        app.quit();
        return { snapshot: this.getSnapshot() };
      default:
        return { snapshot: this.getSnapshot() };
    }
  }
}
