import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Copy,
  Database,
  FolderOpen,
  Power,
  RefreshCw,
  RotateCcw,
  Wrench,
} from 'lucide-react';
import { TitleBar } from '@/components/layout/TitleBar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { invokeIpc } from '@/lib/api-client';
import { collectDiagnosticsText } from '@/lib/diagnostics';
import { runStartupAction } from '@/lib/startup';
import type { StartupIssue } from '@/lib/startup';
import type { ErrorRepairAction } from '@/lib/error-repair';

const ISSUE_TYPE_LABEL: Record<string, string> = {
  external: '外部异常',
  internal: '内部异常',
  'normal-blocking': '正常阻塞',
};

const SEVERITY_LABEL: Record<string, string> = {
  S0: 'S0 数据风险',
  S1: 'S1 启动阻断',
  S2: 'S2 功能降级',
  S3: 'S3 可恢复提示',
};

function severityTone(severity: StartupIssue['severity']): string {
  if (severity === 'S0' || severity === 'S1') return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-200';
  if (severity === 'S2') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200';
  return 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-200';
}

function buttonVariant(action: ErrorRepairAction): 'default' | 'outline' | 'destructive' | 'secondary' {
  if (action.variant === 'danger') return 'destructive';
  if (action.variant === 'primary') return 'default';
  if (action.variant === 'secondary') return 'secondary';
  return 'outline';
}

function actionIcon(id: ErrorRepairAction['id']) {
  if (id.includes('reload') || id.includes('retry') || id.includes('restart')) {
    return <RefreshCw className="mr-2 h-4 w-4" />;
  }
  if (id.includes('relaunch')) return <RotateCcw className="mr-2 h-4 w-4" />;
  if (id.includes('copy')) return <Copy className="mr-2 h-4 w-4" />;
  if (id.includes('data')) return <Database className="mr-2 h-4 w-4" />;
  if (id.includes('log')) return <FolderOpen className="mr-2 h-4 w-4" />;
  if (id.includes('quit')) return <Power className="mr-2 h-4 w-4" />;
  return <Wrench className="mr-2 h-4 w-4" />;
}

async function openPath(path: string): Promise<void> {
  if (path) {
    await invokeIpc('shell:openPath', path);
  }
}

async function clearRendererTemporaryCache(): Promise<void> {
  sessionStorage.clear();
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
}

export interface ErrorRepairPageProps {
  title?: string;
  message: string;
  issue: StartupIssue;
  detail?: string;
  actions: ErrorRepairAction[];
  onRetry?: () => void;
  onActionComplete?: (action: ErrorRepairAction) => void;
}

export function ErrorRepairPage({
  title = 'UClaw 遇到问题',
  message,
  issue,
  detail,
  actions,
  onRetry,
  onActionComplete,
}: ErrorRepairPageProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const diagnosticsText = useMemo(() => [
    title,
    message,
    `${issue.severity} ${ISSUE_TYPE_LABEL[issue.type] ?? issue.type} ${issue.code}`,
    issue.title,
    issue.suggestion,
    detail ? `detail:\n${detail}` : '',
    `url: ${window.location.href}`,
    `userAgent: ${navigator.userAgent}`,
    `time: ${new Date().toISOString()}`,
  ].filter(Boolean).join('\n\n'), [detail, issue, message, title]);

  const copyDiagnostics = async () => {
    const text = await collectDiagnosticsText().catch(() => diagnosticsText);
    await navigator.clipboard.writeText(text || diagnosticsText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const handleAction = async (action: ErrorRepairAction) => {
    setActionError(null);
    try {
      switch (action.id) {
        case 'retry-render':
          onRetry?.();
          break;
        case 'reload-page':
          window.location.reload();
          break;
        case 'relaunch-app':
          await invokeIpc('app:relaunch');
          break;
        case 'restart-gateway':
          await invokeIpc('gateway:restart');
          break;
        case 'open-log-folder': {
          try {
            await openPath(await invokeIpc<string>('log:getDir'));
          } catch {
            await runStartupAction({ id: 'open-log-folder' });
          }
          break;
        }
        case 'open-data-root': {
          try {
            await openPath(await invokeIpc<string>('app:getDataRoot'));
          } catch {
            await runStartupAction({ id: 'open-data-root' });
          }
          break;
        }
        case 'copy-diagnostics':
          await copyDiagnostics();
          break;
        case 'clear-render-cache-and-reload':
          await clearRendererTemporaryCache();
          window.location.reload();
          break;
        case 'quit-app':
          await invokeIpc('app:quit');
          break;
        default:
          break;
      }
      onActionComplete?.(action);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div data-testid="error-repair-page" className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <main className="flex flex-1 items-center justify-center overflow-auto px-6 py-10">
        <section className="w-full max-w-3xl">
          <div className="mb-6 flex items-start gap-4">
            <div className={cn('rounded-lg border p-3', severityTone(issue.severity))}>
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{message}</p>
            </div>
          </div>

          <div className="space-y-5 rounded-lg border bg-card p-5 shadow-sm">
            <div data-testid="error-repair-issue" className={cn('rounded-md border p-4 text-sm', severityTone(issue.severity))}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={issue.severity === 'S2' ? 'warning' : issue.severity === 'S3' ? 'secondary' : 'destructive'}>
                  {SEVERITY_LABEL[issue.severity] ?? issue.severity}
                </Badge>
                <Badge variant="outline">{ISSUE_TYPE_LABEL[issue.type] ?? issue.type}</Badge>
                <span className="font-mono text-xs opacity-80">{issue.code}</span>
              </div>
              <p className="mt-3 font-medium">{issue.title}</p>
              <p className="mt-1 opacity-90">{issue.suggestion}</p>
            </div>

            {actionError && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
                修复动作执行失败：{actionError}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {actions.map((action) => (
                <Button
                  key={action.id}
                  type="button"
                  variant={buttonVariant(action)}
                  onClick={() => void handleAction(action)}
                >
                  {actionIcon(action.id)}
                  {action.id === 'copy-diagnostics' && copied ? '已复制' : action.label}
                </Button>
              ))}
            </div>

            <div className="border-t pt-3">
              <button
                type="button"
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => setDetailsOpen((open) => !open)}
              >
                {detailsOpen ? '收起技术详情' : '查看技术详情'}
              </button>
              {detailsOpen && (
                <pre data-testid="error-repair-details" className="mt-3 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-words">
                  {diagnosticsText}
                </pre>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
