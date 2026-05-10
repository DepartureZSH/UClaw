import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  Copy,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { TitleBar } from '@/components/layout/TitleBar';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useStartupStore } from '@/stores/startup';
import type { StartupAction, StartupSnapshot, StartupStepStatus } from '@/lib/startup';
import uclawIcon from '@/assets/logo.svg';

function statusIcon(status: StartupStepStatus) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case 'warning':
      return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    case 'error':
    case 'timeout':
      return <XCircle className="h-4 w-4 text-red-500" />;
    case 'skipped':
      return <Clock className="h-4 w-4 text-muted-foreground" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground/60" />;
  }
}

function buttonVariant(action: StartupAction): 'default' | 'outline' | 'destructive' | 'secondary' {
  if (action.variant === 'danger') return 'destructive';
  if (action.variant === 'primary') return 'default';
  if (action.variant === 'secondary') return 'secondary';
  return 'outline';
}

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

function issueTone(severity?: string): string {
  if (severity === 'S0' || severity === 'S1') return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-200';
  if (severity === 'S2') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200';
  return 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-200';
}

export function StartupLoadingPage({ snapshot }: { snapshot: StartupSnapshot | null }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const runAction = useStartupStore((state) => state.runAction);
  const lastError = useStartupStore((state) => state.lastError);

  const copyText = useMemo(() => {
    if (!snapshot) return '';
    return [
      snapshot.message,
      snapshot.issue
        ? `${snapshot.issue.severity} ${ISSUE_TYPE_LABEL[snapshot.issue.type] ?? snapshot.issue.type} ${snapshot.issue.code}\n${snapshot.issue.title}\n${snapshot.issue.suggestion}`
        : '',
      snapshot.detail,
      ...snapshot.steps.map((step) => `${step.label}: ${step.status} ${step.message}${step.detail ? `\n${step.detail}` : ''}`),
    ].filter(Boolean).join('\n\n');
  }, [snapshot]);

  const handleCopy = async () => {
    if (!copyText) return;
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const handleAction = async (action: StartupAction) => {
    const result = await runAction({ id: action.id, payload: action.payload });
    if (result?.copyText) {
      await navigator.clipboard.writeText(result.copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  const isProblem = snapshot?.status === 'error' || snapshot?.status === 'timeout' || snapshot?.status === 'warning';

  return (
    <div data-testid="startup-loading-page" className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <main className="flex flex-1 items-center justify-center overflow-auto px-6 py-10">
        <section className="w-full max-w-3xl">
          <div className="mb-8 flex items-center gap-4">
            <img src={uclawIcon} alt="UClaw" className="h-12 w-12" />
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">正在启动 UClaw</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {snapshot?.message ?? '正在连接主进程启动状态'}
              </p>
            </div>
          </div>

          <div className="space-y-5 rounded-lg border bg-card p-5 shadow-sm">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className={cn('font-medium', isProblem && 'text-foreground')}>
                  {snapshot?.status === 'ready' ? '启动完成' : '启动进度'}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{snapshot?.progress ?? 0}%</span>
              </div>
              <Progress value={snapshot?.progress ?? 0} />
            </div>

            <div className="space-y-2">
              {(snapshot?.steps ?? []).map((step) => (
                <div
                  key={step.id}
                  className="grid grid-cols-[20px_minmax(120px,180px)_1fr] items-start gap-3 rounded-md px-2 py-2 text-sm"
                >
                  <div className="pt-0.5">{statusIcon(step.status)}</div>
                  <div className="font-medium">{step.label}</div>
                  <div className="min-w-0 text-muted-foreground">
                    <p className="truncate">{step.message}</p>
                    {step.detail && (
                      <p className="mt-1 break-all font-mono text-xs opacity-80">{step.detail}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {lastError && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
                {lastError}
              </div>
            )}

            {snapshot?.issue && (
              <div data-testid="startup-issue-panel" className={cn('rounded-md border p-3 text-sm', issueTone(snapshot.issue.severity))}>
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  <span>{SEVERITY_LABEL[snapshot.issue.severity] ?? snapshot.issue.severity}</span>
                  <span className="rounded bg-background/50 px-2 py-0.5 text-xs">
                    {ISSUE_TYPE_LABEL[snapshot.issue.type] ?? snapshot.issue.type}
                  </span>
                  <span className="font-mono text-xs opacity-80">{snapshot.issue.code}</span>
                </div>
                <p className="mt-2 font-medium">{snapshot.issue.title}</p>
                <p className="mt-1 opacity-90">{snapshot.issue.suggestion}</p>
              </div>
            )}

            {(snapshot?.actions.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {snapshot?.actions.map((action) => (
                  <Button
                    key={`${action.id}-${JSON.stringify(action.payload ?? {})}`}
                    type="button"
                    variant={buttonVariant(action)}
                    onClick={() => void handleAction(action)}
                  >
                    {action.id.includes('retry') || action.id.includes('restart') ? (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    ) : null}
                    {action.id.includes('copy') ? (
                      <Copy className="mr-2 h-4 w-4" />
                    ) : null}
                    {action.label}
                  </Button>
                ))}
                <Button type="button" variant="outline" onClick={handleCopy}>
                  <Copy className="mr-2 h-4 w-4" />
                  {copied ? '已复制' : '复制错误信息'}
                </Button>
              </div>
            )}

            {(snapshot?.detail || copyText) && (
              <div className="border-t pt-3">
                <button
                  type="button"
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  onClick={() => setDetailsOpen((open) => !open)}
                >
                  {detailsOpen ? '收起技术详情' : '查看技术详情'}
                </button>
                {detailsOpen && (
                  <pre className="mt-3 max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-words">
                    {copyText}
                  </pre>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
