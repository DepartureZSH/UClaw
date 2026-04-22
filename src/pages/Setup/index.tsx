/**
 * Setup Wizard Page
 * First-time setup experience for new users
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ExternalLink,
  FolderOpen,
} from 'lucide-react';
import { TitleBar } from '@/components/layout/TitleBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import { toast } from 'sonner';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';

interface SetupStep {
  id: string;
  title: string;
  description: string;
}

const STEP = {
  WELCOME: 0,
  WORKSPACE: 1,
  RUNTIME: 2,
  AI_CONFIG: 3,
  INSTALLING: 4,
  COMPLETE: 5,
} as const;

const getSteps = (t: TFunction): SetupStep[] => [
  { id: 'welcome',    title: t('steps.welcome.title'),    description: t('steps.welcome.description') },
  { id: 'workspace',  title: '工作目录',                    description: '选择 AI 数据的存储位置' },
  { id: 'runtime',    title: t('steps.runtime.title'),    description: t('steps.runtime.description') },
  { id: 'ai-config',  title: 'AI 配置',                    description: '配置 New API 接口和模型' },
  { id: 'installing', title: t('steps.installing.title'), description: t('steps.installing.description') },
  { id: 'complete',   title: t('steps.complete.title'),   description: t('steps.complete.description') },
];

// Default skills to auto-install (no additional API keys required)
interface DefaultSkill {
  id: string;
  name: string;
  description: string;
}

const getDefaultSkills = (t: TFunction): DefaultSkill[] => [
  { id: 'opencode', name: t('defaultSkills.opencode.name'), description: t('defaultSkills.opencode.description') },
  { id: 'python-env', name: t('defaultSkills.python-env.name'), description: t('defaultSkills.python-env.description') },
  { id: 'code-assist', name: t('defaultSkills.code-assist.name'), description: t('defaultSkills.code-assist.description') },
  { id: 'file-tools', name: t('defaultSkills.file-tools.name'), description: t('defaultSkills.file-tools.description') },
  { id: 'terminal', name: t('defaultSkills.terminal.name'), description: t('defaultSkills.terminal.description') },
];

import uclawIcon from '@/assets/logo.svg';

// NOTE: Channel types moved to Settings > Channels page
// NOTE: Skill bundles moved to Settings > Skills page - auto-install essential skills during setup

export function Setup() {
  const { t } = useTranslation(['setup', 'channels']);
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<number>(STEP.WELCOME);

  const [installedSkills, setInstalledSkills] = useState<string[]>([]);
  const [runtimeChecksPassed, setRuntimeChecksPassed] = useState(false);
  const [aiConfigSaved, setAiConfigSaved] = useState(false);
  const [workspaceDir, setWorkspaceDir] = useState('');

  const markSetupComplete = useSettingsStore((state) => state.markSetupComplete);

  const steps = getSteps(t);
  const safeStepIndex = Math.min(Math.max(currentStep, 0), steps.length - 1);
  const step = steps[safeStepIndex];
  const isFirstStep = safeStepIndex === 0;
  const isLastStep = safeStepIndex === steps.length - 1;

  const canProceed = useMemo(() => {
    switch (safeStepIndex) {
      case STEP.WELCOME:    return true;
      case STEP.WORKSPACE:  return true;      // optional
      case STEP.RUNTIME:    return runtimeChecksPassed;
      case STEP.AI_CONFIG:  return true;      // skippable
      case STEP.INSTALLING: return false;
      case STEP.COMPLETE:   return true;
      default: return true;
    }
  }, [safeStepIndex, runtimeChecksPassed]);

  const handleNext = async () => {
    if (safeStepIndex === STEP.WORKSPACE) {
      await invokeIpc('app:applyWorkspaceDir', workspaceDir);
    }
    if (isLastStep) {
      markSetupComplete();
      if (workspaceDir) {
        // Kick off gateway restart (OPENCLAW_HOME now points to new workspace).
        // Don't await — navigate immediately; main page handles reconnect state.
        invokeIpc('gateway:restart').catch(() => {});
        toast.success(t('complete.title'));
        navigate('/');
      } else {
        toast.success(t('complete.title'));
        navigate('/');
      }
    } else {
      setCurrentStep((i) => i + 1);
    }
  };

  const handleBack = () => setCurrentStep((i) => Math.max(i - 1, 0));

  const handleSkip = () => { markSetupComplete(); navigate('/'); };

  const handleInstallationComplete = useCallback((skills: string[]) => {
    setInstalledSkills(skills);
    setTimeout(() => { setCurrentStep((i) => i + 1); }, 1000);
  }, []);

  const isInstallingStep = safeStepIndex === STEP.INSTALLING;

  return (
    <div data-testid="setup-page" className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <div className="flex-1 overflow-auto">
        {/* Progress Indicator */}
        <div className="flex justify-center pt-8">
          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <div key={s.id} className="flex items-center">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors',
                    i < safeStepIndex
                      ? 'border-primary bg-primary text-primary-foreground'
                      : i === safeStepIndex
                        ? 'border-primary text-primary'
                        : 'border-slate-600 text-slate-600'
                  )}
                >
                  {i < safeStepIndex ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <span className="text-sm">{i + 1}</span>
                  )}
                </div>
                {i < steps.length - 1 && (
                  <div
                    className={cn(
                      'h-0.5 w-8 transition-colors',
                      i < safeStepIndex ? 'bg-primary' : 'bg-slate-600'
                    )}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="mx-auto max-w-2xl p-8"
          >
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold mb-2">{step.title}</h1>
              <p className="text-slate-400">{step.description}</p>
            </div>

            {/* Step-specific content */}
            <div className="rounded-xl bg-card text-card-foreground border shadow-sm p-8 mb-8">
              {safeStepIndex === STEP.WELCOME    && <WelcomeContent />}
              {safeStepIndex === STEP.WORKSPACE  && <WorkspaceContent value={workspaceDir} onChange={setWorkspaceDir} />}
              {safeStepIndex === STEP.RUNTIME    && <RuntimeContent onStatusChange={setRuntimeChecksPassed} />}
              {safeStepIndex === STEP.AI_CONFIG  && <PortableConfigContent onSaved={() => setAiConfigSaved(true)} />}
              {safeStepIndex === STEP.INSTALLING && <InstallingContent skills={getDefaultSkills(t)} onComplete={handleInstallationComplete} onSkip={() => setCurrentStep((i) => i + 1)} />}
              {safeStepIndex === STEP.COMPLETE   && <CompleteContent installedSkills={installedSkills} />}
            </div>

            {/* Navigation - hidden during installation step */}
            {!isInstallingStep && (
              <div className="flex justify-between">
                <div>
                  {!isFirstStep && (
                    <Button variant="ghost" onClick={handleBack}>
                      <ChevronLeft className="h-4 w-4 mr-2" />
                      {t('nav.back')}
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  {/* 跳过整个 setup（不在 Runtime/AI config 步骤时可见） */}
                  {!isLastStep && safeStepIndex !== STEP.RUNTIME && safeStepIndex !== STEP.AI_CONFIG && (
                    <Button data-testid="setup-skip-button" variant="ghost" onClick={handleSkip}>
                      {t('nav.skipSetup')}
                    </Button>
                  )}
                  {/* Workspace：已选目录时提供"清除"快捷键 */}
                  {safeStepIndex === STEP.WORKSPACE && workspaceDir && (
                    <Button variant="ghost" onClick={() => setWorkspaceDir('')}>
                      使用默认目录
                    </Button>
                  )}
                  {/* AI config：可跳过 */}
                  {safeStepIndex === STEP.AI_CONFIG && !aiConfigSaved && (
                    <Button variant="ghost" onClick={() => setCurrentStep((i) => i + 1)}>
                      跳过
                    </Button>
                  )}
                  <Button data-testid="setup-next-button" onClick={handleNext} disabled={!canProceed}>
                    {isLastStep ? (
                      t('nav.getStarted')
                    ) : (
                      <>
                        {t('nav.next')}
                        <ChevronRight className="h-4 w-4 ml-2" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ==================== Step Content Components ====================

function WelcomeContent() {
  const { t } = useTranslation(['setup', 'settings']);
  const { language, setLanguage } = useSettingsStore();

  return (
    <div data-testid="setup-welcome-step" className="text-center space-y-4">
      <div className="mb-4 flex justify-center">
        <img src={uclawIcon} alt="UClaw" className="h-16 w-16" />
      </div>
      <h2 className="text-xl font-semibold">{t('welcome.title')}</h2>
      <p className="text-muted-foreground">
        {t('welcome.description')}
      </p>

      {/* Language Selector */}
      <div className="flex justify-center gap-2 py-2">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <Button
            key={lang.code}
            variant={language === lang.code ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setLanguage(lang.code)}
            className="h-7 text-xs"
          >
            {lang.label}
          </Button>
        ))}
      </div>

      <ul className="text-left space-y-2 text-muted-foreground pt-2">
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          {t('welcome.features.noCommand')}
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          {t('welcome.features.modernUI')}
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          {t('welcome.features.bundles')}
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          {t('welcome.features.crossPlatform')}
        </li>
      </ul>
    </div>
  );
}

// ==================== Workspace Step ====================

interface WorkspaceContentProps {
  value: string;
  onChange: (dir: string) => void;
}

function WorkspaceContent({ value, onChange }: WorkspaceContentProps) {
  const [selecting, setSelecting] = useState(false);

  const handleSelect = async () => {
    setSelecting(true);
    try {
      const dir = await invokeIpc<string | null>('app:selectWorkspaceDir');
      if (dir) onChange(dir);
    } finally {
      setSelecting(false);
    }
  };

  // Use the same separator already present in the selected path (handles Windows \ vs Unix /)
  const sep = value.includes('\\') ? '\\' : '/';
  const previewPath = value ? `${value}${sep}.openclaw${sep}` : '';

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        选择一个目录用于存储 AI 会话、技能、插件等数据，与本机
        <code className="text-xs bg-muted px-1 py-0.5 rounded mx-1">~/.openclaw</code>
        完全隔离。不选择则使用系统默认位置。
      </p>

      <div className="space-y-2">
        <Label className="text-sm font-medium">工作目录</Label>
        <div className="flex gap-2">
          <div className="flex-1 flex items-center h-10 rounded-md border border-input bg-muted/50 px-3 text-sm font-mono text-muted-foreground truncate">
            {value || '未选择（使用默认 ~/.openclaw）'}
          </div>
          <Button variant="outline" onClick={handleSelect} disabled={selecting}>
            {selecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
          </Button>
        </div>
        {value && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground underline"
            onClick={() => onChange('')}
          >
            清除，使用默认目录
          </button>
        )}
      </div>

      {value && (
        <div className="p-3 rounded-lg bg-muted border border-border text-sm text-foreground flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0 text-green-500" />
          <span>数据将存储在 <span className="font-mono text-xs break-all text-muted-foreground">{previewPath}</span></span>
        </div>
      )}
    </div>
  );
}

interface RuntimeContentProps {
  onStatusChange: (canProceed: boolean) => void;
}

function RuntimeContent({ onStatusChange }: RuntimeContentProps) {
  const { t } = useTranslation('setup');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const startGateway = useGatewayStore((state) => state.start);

  const [checks, setChecks] = useState({
    nodejs: { status: 'checking' as 'checking' | 'success' | 'error', message: '' },
    openclaw: { status: 'checking' as 'checking' | 'success' | 'error', message: '' },
    gateway: { status: 'checking' as 'checking' | 'success' | 'error', message: '' },
  });
  const [showLogs, setShowLogs] = useState(false);
  const [logContent, setLogContent] = useState('');
  const [openclawDir, setOpenclawDir] = useState('');
  const gatewayTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const runChecks = useCallback(async () => {
    // Reset checks
    setChecks({
      nodejs: { status: 'checking', message: '' },
      openclaw: { status: 'checking', message: '' },
      gateway: { status: 'checking', message: '' },
    });

    // Check Node.js — always available in Electron
    setChecks((prev) => ({
      ...prev,
      nodejs: { status: 'success', message: t('runtime.status.success') },
    }));

    // Check OpenClaw package status
    try {
      const openclawStatus = await invokeIpc('openclaw:status') as {
        packageExists: boolean;
        isBuilt: boolean;
        dir: string;
        version?: string;
      };

      setOpenclawDir(openclawStatus.dir);

      if (!openclawStatus.packageExists) {
        setChecks((prev) => ({
          ...prev,
          openclaw: {
            status: 'error',
            message: `OpenClaw package not found at: ${openclawStatus.dir}`
          },
        }));
      } else if (!openclawStatus.isBuilt) {
        setChecks((prev) => ({
          ...prev,
          openclaw: {
            status: 'error',
            message: 'OpenClaw package found but dist is missing'
          },
        }));
      } else {
        const versionLabel = openclawStatus.version ? ` v${openclawStatus.version}` : '';
        setChecks((prev) => ({
          ...prev,
          openclaw: {
            status: 'success',
            message: `OpenClaw package ready${versionLabel}`
          },
        }));
      }
    } catch (error) {
      setChecks((prev) => ({
        ...prev,
        openclaw: { status: 'error', message: `Check failed: ${error}` },
      }));
    }

    // Check Gateway — read directly from store to avoid stale closure
    // Don't immediately report error; gateway may still be initializing
    const currentGateway = useGatewayStore.getState().status;
    if (currentGateway.state === 'running') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'success', message: `Running on port ${currentGateway.port}` },
      }));
    } else if (currentGateway.state === 'error') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'error', message: currentGateway.error || t('runtime.status.error') },
      }));
    } else {
      // Gateway is 'stopped', 'starting', or 'reconnecting'
      // Keep as 'checking' — the dedicated useEffect will update when status changes
      setChecks((prev) => ({
        ...prev,
        gateway: {
          status: 'checking',
          message: currentGateway.state === 'starting' ? t('runtime.status.checking') : 'Waiting for gateway...'
        },
      }));
    }
  }, [t]);

  useEffect(() => {
    runChecks();
  }, [runChecks]);

  // Update canProceed when gateway status changes
  useEffect(() => {
    const allPassed = checks.nodejs.status === 'success'
      && checks.openclaw.status === 'success'
      && (checks.gateway.status === 'success' || gatewayStatus.state === 'running');
    onStatusChange(allPassed);
  }, [checks, gatewayStatus, onStatusChange]);

  // Update gateway check when gateway status changes
  useEffect(() => {
    if (gatewayStatus.state === 'running') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'success', message: t('runtime.status.gatewayRunning', { port: gatewayStatus.port }) },
      }));
    } else if (gatewayStatus.state === 'error') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'error', message: gatewayStatus.error || 'Failed to start' },
      }));
    } else if (gatewayStatus.state === 'starting' || gatewayStatus.state === 'reconnecting') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'checking', message: 'Starting...' },
      }));
    }
    // 'stopped' state: keep current check status (likely 'checking') to allow startup time
  }, [gatewayStatus, t]);

  // Gateway startup timeout — show error only after giving enough time to initialize
  useEffect(() => {
    if (gatewayTimeoutRef.current) {
      clearTimeout(gatewayTimeoutRef.current);
      gatewayTimeoutRef.current = null;
    }

    // If gateway is already in a terminal state, no timeout needed
    if (gatewayStatus.state === 'running' || gatewayStatus.state === 'error') {
      return;
    }

    // Set timeout for non-terminal states (stopped, starting, reconnecting)
    gatewayTimeoutRef.current = setTimeout(() => {
      setChecks((prev) => {
        if (prev.gateway.status === 'checking') {
          return {
            ...prev,
            gateway: { status: 'error', message: 'Gateway startup timed out' },
          };
        }
        return prev;
      });
    }, 600 * 1000); // 600 seconds — enough for gateway to fully initialize

    return () => {
      if (gatewayTimeoutRef.current) {
        clearTimeout(gatewayTimeoutRef.current);
        gatewayTimeoutRef.current = null;
      }
    };
  }, [gatewayStatus.state]);

  const handleStartGateway = async () => {
    setChecks((prev) => ({
      ...prev,
      gateway: { status: 'checking', message: 'Starting...' },
    }));
    await startGateway();
  };

  const handleShowLogs = async () => {
    try {
      const logs = await hostApiFetch<{ content: string }>('/api/logs?tailLines=100');
      setLogContent(logs.content);
      setShowLogs(true);
    } catch {
      setLogContent('(Failed to load logs)');
      setShowLogs(true);
    }
  };

  const handleOpenLogDir = async () => {
    try {
      const { dir: logDir } = await hostApiFetch<{ dir: string | null }>('/api/logs/dir');
      if (logDir) {
        await invokeIpc('shell:showItemInFolder', logDir);
      }
    } catch {
      // ignore
    }
  };

  const ERROR_TRUNCATE_LEN = 30;

  const renderStatus = (status: 'checking' | 'success' | 'error', message: string) => {
    if (status === 'checking') {
      return (
        <span className="flex items-center gap-2 text-yellow-400 whitespace-nowrap">
          <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin" />
          {message || 'Checking...'}
        </span>
      );
    }
    if (status === 'success') {
      return (
        <span className="flex items-center gap-2 text-green-400 whitespace-nowrap">
          <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
          {message}
        </span>
      );
    }

    const isLong = message.length > ERROR_TRUNCATE_LEN;
    const displayMsg = isLong ? message.slice(0, ERROR_TRUNCATE_LEN) : message;

    return (
      <span className="flex items-center gap-2 text-red-400 whitespace-nowrap">
        <XCircle className="h-5 w-5 flex-shrink-0" />
        <span>{displayMsg}</span>
        {isLong && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-pointer text-red-300 hover:text-red-200 font-medium">...</span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-sm whitespace-normal break-words text-xs">
              {message}
            </TooltipContent>
          </Tooltip>
        )}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t('runtime.title')}</h2>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleShowLogs}>
            {t('runtime.viewLogs')}
          </Button>
          <Button variant="ghost" size="sm" onClick={runChecks}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('runtime.recheck')}
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 p-3 rounded-lg bg-muted/50">
          <span className="text-left">{t('runtime.nodejs')}</span>
          <div className="flex justify-end">
            {renderStatus(checks.nodejs.status, checks.nodejs.message)}
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 p-3 rounded-lg bg-muted/50">
          <div className="text-left min-w-0">
            <span>{t('runtime.openclaw')}</span>
            {openclawDir && (
              <p className="text-xs text-muted-foreground mt-0.5 font-mono break-all">
                {openclawDir}
              </p>
            )}
          </div>
          <div className="flex justify-end self-start mt-0.5">
            {renderStatus(checks.openclaw.status, checks.openclaw.message)}
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 p-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-2 text-left">
            <span>{t('runtime.gateway')}</span>
            {checks.gateway.status === 'error' && (
              <Button variant="outline" size="sm" onClick={handleStartGateway}>
                {t('runtime.startGateway')}
              </Button>
            )}
          </div>
          <div className="flex justify-end">
            {renderStatus(checks.gateway.status, checks.gateway.message)}
          </div>
        </div>
      </div>

      {(checks.nodejs.status === 'error' || checks.openclaw.status === 'error') && (
        <div className="mt-4 p-4 rounded-lg bg-red-900/20 border border-red-500/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-red-400 mt-0.5" />
            <div>
              <p className="font-medium text-red-400">{t('runtime.issue.title')}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {t('runtime.issue.desc')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Log viewer panel */}
      {showLogs && (
        <div className="mt-4 p-4 rounded-lg bg-black/40 border border-border">
          <div className="flex items-center justify-between mb-2">
            <p className="font-medium text-foreground text-sm">{t('runtime.logs.title')}</p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleOpenLogDir}>
                <ExternalLink className="h-3 w-3 mr-1" />
                {t('runtime.logs.openFolder')}
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowLogs(false)}>
                {t('runtime.logs.close')}
              </Button>
            </div>
          </div>
          <pre className="text-xs text-slate-300 bg-black/50 p-3 rounded max-h-60 overflow-auto whitespace-pre-wrap font-mono">
            {logContent || t('runtime.logs.noLogs')}
          </pre>
        </div>
      )}
    </div>
  );
}

// ==================== Portable Config Step ====================

interface PortableConfigContentProps {
  onSaved: () => void;
}

function PortableConfigContent({ onSaved }: PortableConfigContentProps) {
  const DEFAULT_BASE_URL = 'https://chatbot.cn.unreachablecity.club/v1';
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('deepseek-chat');
  const [selectedWebSearchModel, setSelectedWebSearchModel] = useState('');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [modelPricing, setModelPricing] = useState<Record<string, { input: number; output: number }>>({});

  const handleFetchModels = async () => {
    const key = apiKey.trim();
    if (!key) { setFetchError('请先输入 API Key'); return; }
    setFetchingModels(true); setFetchError(null); setFetchedModels([]); setModelPricing({});
    try {
      const url = (baseUrl.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');
      const data = await hostApiFetch<{ success: boolean; models: string[]; pricing?: Record<string, { input: number; output: number }>; error?: string }>(
        '/api/fetch-models',
        { method: 'POST', body: JSON.stringify({ baseUrl: url, apiKey: key }) },
      );
      if (!data.success) throw new Error(data.error ?? '获取失败');
      const ids = data.models ?? [];
      if (ids.length === 0) throw new Error('未返回任何模型，请确认接口地址正确');
      setFetchedModels(ids);
      setModelPricing(data.pricing ?? {});
      if (!ids.includes(selectedModel)) setSelectedModel(ids[0]);
      // Auto-select web search model: prefer kimi-k2.5, else first kimi-* model
      const kimiModels = ids.filter((m) => m.startsWith('kimi-'));
      const defaultKimi = kimiModels.includes('kimi-k2.5') ? 'kimi-k2.5' : (kimiModels[0] ?? '');
      setSelectedWebSearchModel(defaultKimi);
    } catch (e) { setFetchError(String(e)); }
    finally { setFetchingModels(false); }
  };

  const handleSave = async () => {
    const key = apiKey.trim();
    if (!key) { setSaveError('请输入 API Key'); return; }
    if (fetchedModels.length === 0) { setSaveError('请先点击「获取模型列表」验证接口'); return; }
    setSaving(true); setSaveError(null);
    try {
      const resolvedBase = (baseUrl.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');
      const account = {
        vendorId: 'new-api',
        label: 'New API',
        authMode: 'api_key',
        baseUrl: resolvedBase,
        model: selectedModel,
      };
      const data = await hostApiFetch<{ success: boolean; account?: { id: string }; error?: string }>(
        '/api/provider-accounts',
        { method: 'POST', body: JSON.stringify({ account, apiKey: key }) },
      );
      if (!data.success) throw new Error(data.error ?? '保存失败');
      if (data.account?.id) {
        await hostApiFetch('/api/provider-accounts/default', {
          method: 'PUT',
          body: JSON.stringify({ accountId: data.account.id }),
        });
      }
      await invokeIpc('openclaw:applyInitialConfig', key, resolvedBase, selectedWebSearchModel || undefined);
      if (Object.keys(modelPricing).length > 0) {
        await invokeIpc('openclaw:syncModelPricing', 'new-api', modelPricing);
      }
      onSaved();
      toast.success('AI 提供商已配置');
    } catch (e) { setSaveError(String(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        配置 New API 接口地址和 API Key，UClaw 将使用此账号进行 AI 对话。
      </p>

      <div className="space-y-1.5">
        <Label className="text-sm font-medium">接口地址 (Base URL)</Label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={DEFAULT_BASE_URL}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">API Key</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={fetchingModels || !apiKey.trim()}
            onClick={handleFetchModels}
            className="h-7 px-2 text-[12px] text-blue-500 hover:text-blue-600 font-medium"
          >
            {fetchingModels ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            获取模型列表
          </Button>
        </div>
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
        />
        {fetchError && <p className="text-xs text-red-500">{fetchError}</p>}
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm font-medium">默认模型</Label>
        {fetchedModels.length > 0 ? (
          <div className="relative">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm appearance-none cursor-pointer pr-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {fetchedModels.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <ChevronRight className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 h-4 w-4 text-muted-foreground" />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground py-2">请先填写 API Key 并点击「获取模型列表」</p>
        )}
      </div>

      {fetchedModels.some((m) => m.startsWith('kimi-')) && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">网页搜索模型 (Kimi)</Label>
          <div className="relative">
            <select
              value={selectedWebSearchModel}
              onChange={(e) => setSelectedWebSearchModel(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm appearance-none cursor-pointer pr-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">不启用网页搜索</option>
              {fetchedModels.filter((m) => m.startsWith('kimi-')).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <ChevronRight className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground">通过 Kimi 模型的联网能力进行网页搜索</p>
        </div>
      )}

      {saveError && <p className="text-xs text-red-500">{saveError}</p>}

      <Button
        onClick={handleSave}
        disabled={saving || !apiKey.trim() || fetchedModels.length === 0}
        className="w-full bg-[#0a84ff] hover:bg-[#007aff] text-white font-medium"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        保存配置
      </Button>
    </div>
  );
}

// NOTE: ProviderContent component removed - configure providers via Settings > AI Providers


// Installation status for each skill
type InstallStatus = 'pending' | 'installing' | 'completed' | 'failed';

interface SkillInstallState {
  id: string;
  name: string;
  description: string;
  status: InstallStatus;
}

interface InstallingContentProps {
  skills: DefaultSkill[];
  onComplete: (installedSkills: string[]) => void;
  onSkip: () => void;
}

function InstallingContent({ skills, onComplete, onSkip }: InstallingContentProps) {
  const { t } = useTranslation('setup');
  const [skillStates, setSkillStates] = useState<SkillInstallState[]>(
    skills.map((s) => ({ ...s, status: 'pending' as InstallStatus }))
  );
  const [overallProgress, setOverallProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const installStarted = useRef(false);

  // Real installation process
  useEffect(() => {
    if (installStarted.current) return;
    installStarted.current = true;

    const runRealInstall = async () => {
      try {
        // Step 1: Initialize all skills to 'installing' state for UI
        setSkillStates(prev => prev.map(s => ({ ...s, status: 'installing' })));
        setOverallProgress(10);

        // Step 2: Call the backend to install uv and setup Python
        const result = await invokeIpc('uv:install-all') as {
          success: boolean;
          error?: string
        };

        if (result.success) {
          setSkillStates(prev => prev.map(s => ({ ...s, status: 'completed' })));
          setOverallProgress(100);

          await new Promise((resolve) => setTimeout(resolve, 800));
          onComplete(skills.map(s => s.id));
        } else {
          setSkillStates(prev => prev.map(s => ({ ...s, status: 'failed' })));
          setErrorMessage(result.error || 'Unknown error during installation');
          toast.error('Environment setup failed');
        }
      } catch (err) {
        setSkillStates(prev => prev.map(s => ({ ...s, status: 'failed' })));
        setErrorMessage(String(err));
        toast.error('Installation error');
      }
    };

    runRealInstall();
  }, [skills, onComplete]);

  const getStatusIcon = (status: InstallStatus) => {
    switch (status) {
      case 'pending':
        return <div className="h-5 w-5 rounded-full border-2 border-slate-500" />;
      case 'installing':
        return <Loader2 className="h-5 w-5 text-primary animate-spin" />;
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-400" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-400" />;
    }
  };

  const getStatusText = (skill: SkillInstallState) => {
    switch (skill.status) {
      case 'pending':
        return <span className="text-muted-foreground">{t('installing.status.pending')}</span>;
      case 'installing':
        return <span className="text-primary">{t('installing.status.installing')}</span>;
      case 'completed':
        return <span className="text-green-400">{t('installing.status.installed')}</span>;
      case 'failed':
        return <span className="text-red-400">{t('installing.status.failed')}</span>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="text-4xl mb-4">⚙️</div>
        <h2 className="text-xl font-semibold mb-2">{t('installing.title')}</h2>
        <p className="text-muted-foreground">
          {t('installing.subtitle')}
        </p>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t('installing.progress')}</span>
          <span className="text-primary">{overallProgress}%</span>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${overallProgress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* Skill list */}
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {skillStates.map((skill) => (
          <motion.div
            key={skill.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              'flex items-center justify-between p-3 rounded-lg',
              skill.status === 'installing' ? 'bg-muted' : 'bg-muted/50'
            )}
          >
            <div className="flex items-center gap-3">
              {getStatusIcon(skill.status)}
              <div>
                <p className="font-medium">{skill.name}</p>
                <p className="text-xs text-muted-foreground">{skill.description}</p>
              </div>
            </div>
            {getStatusText(skill)}
          </motion.div>
        ))}
      </div>

      {/* Error Message Display */}
      {errorMessage && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="p-4 rounded-lg bg-red-900/30 border border-red-500/50 text-red-200 text-sm"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">{t('installing.error')}</p>
              <pre className="text-xs bg-black/30 p-2 rounded overflow-x-auto whitespace-pre-wrap font-monospace">
                {errorMessage}
              </pre>
              <Button
                variant="link"
                className="text-red-400 p-0 h-auto text-xs underline"
                onClick={() => window.location.reload()}
              >
                {t('installing.restart')}
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      {!errorMessage && (
        <p className="text-sm text-slate-400 text-center">
          {t('installing.wait')}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          variant="ghost"
          className="text-muted-foreground"
          onClick={onSkip}
        >
          {t('installing.skip')}
        </Button>
      </div>
    </div>
  );
}
interface CompleteContentProps {
  installedSkills: string[];
}

function CompleteContent({ installedSkills }: CompleteContentProps) {
  const { t } = useTranslation(['setup', 'settings']);
  const gatewayStatus = useGatewayStore((state) => state.status);

  const installedSkillNames = getDefaultSkills(t)
    .filter((s: DefaultSkill) => installedSkills.includes(s.id))
    .map((s: DefaultSkill) => s.name)
    .join(', ');

  return (
    <div className="text-center space-y-6">
      <div className="text-6xl mb-4">🎉</div>
      <h2 className="text-xl font-semibold">{t('complete.title')}</h2>
      <p className="text-muted-foreground">
        {t('complete.subtitle')}
      </p>

      <div className="space-y-3 text-left max-w-md mx-auto">
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <span>{t('complete.components')}</span>
          <span className="text-green-400">
            {installedSkillNames || `${installedSkills.length} ${t('installing.status.installed')}`}
          </span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <span>{t('complete.gateway')}</span>
          <span className={gatewayStatus.state === 'running' ? 'text-green-400' : 'text-yellow-400'}>
            {gatewayStatus.state === 'running' ? `✓ ${t('complete.running')}` : gatewayStatus.state}
          </span>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {t('complete.footer')}
      </p>
    </div>
  );
}

export default Setup;
