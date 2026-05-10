import type { StartupIssue } from '@/lib/startup';

export type ErrorRepairActionId =
  | 'retry-render'
  | 'reload-page'
  | 'relaunch-app'
  | 'restart-gateway'
  | 'open-log-folder'
  | 'open-data-root'
  | 'copy-diagnostics'
  | 'clear-render-cache-and-reload'
  | 'quit-app';

export interface ErrorRepairAction {
  id: ErrorRepairActionId;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

export interface ErrorRepairModel {
  issue: StartupIssue;
  message: string;
  actions: ErrorRepairAction[];
}

function createIssue(
  type: StartupIssue['type'],
  severity: StartupIssue['severity'],
  code: string,
  title: string,
  suggestion: string,
): StartupIssue {
  return { type, severity, code, title, suggestion };
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ''}`.trim();
  }
  if (error && typeof error === 'object') {
    const record = error as { name?: unknown; message?: unknown; stack?: unknown };
    if (typeof record.name === 'string' || typeof record.message === 'string') {
      return [
        `${typeof record.name === 'string' ? record.name : 'Error'}: ${typeof record.message === 'string' ? record.message : ''}`.trim(),
        typeof record.stack === 'string' ? record.stack : '',
      ].filter(Boolean).join('\n');
    }
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function stringifyRepairError(error: unknown, componentStack?: string): string {
  return [
    errorText(error),
    componentStack ? `componentStack:\n${componentStack}` : '',
  ].filter(Boolean).join('\n\n');
}

export function classifyRendererError(error: unknown): ErrorRepairModel {
  const raw = errorText(error);
  const normalized = raw.toLowerCase();

  if (
    normalized.includes('chunkloaderror')
    || normalized.includes('loading chunk')
    || normalized.includes('failed to fetch dynamically imported module')
    || normalized.includes('importing a module script failed')
  ) {
    return {
      message: '页面资源加载失败，通常是应用更新、缓存或文件读取异常导致。',
      issue: createIssue(
        'internal',
        'S1',
        'RENDER_CHUNK_LOAD_FAILED',
        '页面资源加载失败',
        '请先重新加载页面；如果仍失败，请重启 UClaw。移动盘使用时请确认文件同步已经完成。',
      ),
      actions: [
        { id: 'reload-page', label: '重新加载页面', variant: 'primary' },
        { id: 'relaunch-app', label: '重启 UClaw' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
      ],
    };
  }

  if (
    normalized.includes('invalid ipc channel')
    || normalized.includes('no handler registered')
    || normalized.includes('ipc')
  ) {
    return {
      message: '页面与主进程通信失败，当前功能无法继续安全执行。',
      issue: createIssue(
        'internal',
        'S1',
        'IPC_CHANNEL_UNAVAILABLE',
        '主进程通信不可用',
        '请重启 UClaw 让主进程和页面版本重新对齐；如果刚更新过应用，请确认只打开了一个 UClaw 实例。',
      ),
      actions: [
        { id: 'relaunch-app', label: '重启 UClaw', variant: 'primary' },
        { id: 'open-log-folder', label: '查看日志' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
      ],
    };
  }

  if (
    normalized.includes('quotaexceedederror')
    || normalized.includes('quota exceeded')
    || normalized.includes('database is full')
  ) {
    return {
      message: '页面临时缓存空间不足，部分界面状态无法继续写入。',
      issue: createIssue(
        'external',
        'S2',
        'RENDER_CACHE_QUOTA_EXCEEDED',
        '页面临时缓存已满',
        '可以一键清理页面临时缓存并重新加载。该操作不会删除 UClaw 数据目录中的配置文件。',
      ),
      actions: [
        { id: 'clear-render-cache-and-reload', label: '清理临时缓存并重载', variant: 'primary' },
        { id: 'open-data-root', label: '打开数据目录' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
      ],
    };
  }

  if (
    normalized.includes('failed to fetch')
    || normalized.includes('networkerror')
    || normalized.includes('err_connection_refused')
    || normalized.includes('err_internet_disconnected')
  ) {
    return {
      message: '本机服务或网络请求不可达，相关功能可能暂时不可用。',
      issue: createIssue(
        'external',
        'S2',
        'NETWORK_OR_LOCAL_SERVICE_UNAVAILABLE',
        '网络或本机服务不可达',
        '请检查网络、代理或 Gateway 状态；如果是本机 Gateway 连接失败，可以尝试重启 Gateway。',
      ),
      actions: [
        { id: 'restart-gateway', label: '重启 Gateway', variant: 'primary' },
        { id: 'reload-page', label: '重新加载页面' },
        { id: 'open-log-folder', label: '查看日志' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
      ],
    };
  }

  if (
    normalized.includes('permission denied')
    || normalized.includes('eacces')
    || normalized.includes('eperm')
    || normalized.includes('access denied')
  ) {
    return {
      message: '系统权限阻止了当前操作。',
      issue: createIssue(
        'external',
        'S1',
        'SYSTEM_PERMISSION_DENIED',
        '系统权限不足',
        '请检查数据目录、工作区或安全软件权限；确认权限后重新加载或重启 UClaw。',
      ),
      actions: [
        { id: 'open-data-root', label: '打开数据目录', variant: 'primary' },
        { id: 'open-log-folder', label: '查看日志' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
      ],
    };
  }

  if (normalized.includes('resizeobserver loop')) {
    return {
      message: '界面布局临时异常，可以直接重试当前页面。',
      issue: createIssue(
        'internal',
        'S3',
        'RENDER_LAYOUT_RECOVERABLE',
        '界面布局可恢复异常',
        '请重试当前页面；如果反复出现，再复制诊断信息排查具体页面。',
      ),
      actions: [
        { id: 'retry-render', label: '重试页面', variant: 'primary' },
        { id: 'copy-diagnostics', label: '复制诊断信息' },
      ],
    };
  }

  return {
    message: '界面遇到未预期错误，已进入修复页以避免继续连锁失败。',
    issue: createIssue(
      'internal',
      'S1',
      'RENDER_UNKNOWN_ERROR',
      '未知界面错误',
      '请先重试页面；如果仍失败，请复制诊断信息并查看日志。',
    ),
    actions: [
      { id: 'retry-render', label: '重试页面', variant: 'primary' },
      { id: 'reload-page', label: '重新加载页面' },
      { id: 'open-log-folder', label: '查看日志' },
      { id: 'copy-diagnostics', label: '复制诊断信息' },
    ],
  };
}
