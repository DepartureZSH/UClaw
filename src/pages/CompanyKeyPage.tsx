import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react';
import { TitleBar } from '@/components/layout/TitleBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { invokeIpc } from '@/lib/api-client';
import { useStartupStore } from '@/stores/startup';

export function CompanyKeyPage() {
  const navigate = useNavigate();
  const runAction = useStartupStore((state) => state.runAction);
  const [companyKey, setCompanyKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invokeIpc<string>('app:getCompanyKey')
      .then((value) => {
        if (!cancelled && value) setCompanyKey(value);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const submit = async () => {
    const trimmed = companyKey.trim();
    if (!trimmed) {
      setError('请输入公司密钥。');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await invokeIpc('app:setCompanyKey', trimmed);
      const result = await runAction({ id: 'retry-current-step' });
      if (result?.snapshot.status === 'ready' || result?.snapshot.status === 'warning') {
        navigate('/', { replace: true });
        return;
      }
      const issue = result?.snapshot.issue;
      setError(issue
        ? `${issue.title}：${issue.suggestion}`
        : (result?.snapshot.message || '配置同步未完成，请确认发布包完整后重试。'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <main className="flex flex-1 items-center justify-center overflow-auto px-6 py-10">
        <section className="w-full max-w-xl space-y-7">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">填写公司密钥</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                UClaw 会使用公司密钥自动获取 AI 和联网搜索配置。
              </p>
            </div>
          </div>

          <form
            className="space-y-5 rounded-lg border bg-card p-5 shadow-sm"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="company-key">公司密钥</Label>
              <div className="flex gap-2">
                <Input
                  id="company-key"
                  value={companyKey}
                  type={showKey ? 'text' : 'password'}
                  autoFocus
                  autoComplete="off"
                  placeholder="请输入由公司提供的密钥"
                  onChange={(event) => setCompanyKey(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={showKey ? '隐藏公司密钥' : '显示公司密钥'}
                  onClick={() => setShowKey((value) => !value)}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                普通用户不需要选择工作目录，也不需要手动填写 API 地址或 API Key。
              </p>
            </div>

            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                保存并同步配置
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate('/', { replace: true })}>
                返回启动页
              </Button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
