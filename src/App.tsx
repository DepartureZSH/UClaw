/**
 * Root Application Component
 * Handles routing and global providers
 */
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Component, useEffect, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Toaster } from 'sonner';
import { AlertTriangle, Copy } from 'lucide-react';
import i18n from './i18n';
import { MainLayout } from './components/layout/MainLayout';
import { TitleBar } from './components/layout/TitleBar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Models } from './pages/Models';
import { Chat } from './pages/Chat';
import { Agents } from './pages/Agents';
import { Channels } from './pages/Channels';
import { Skills } from './pages/Skills';
import { Cron } from './pages/Cron';
import { Settings } from './pages/Settings';
import { Setup } from './pages/Setup';
import { useSettingsStore } from './stores/settings';
import { useGatewayStore } from './stores/gateway';
import { useProviderStore } from './stores/providers';
import { applyGatewayTransportPreference, invokeIpc } from './lib/api-client';
import { rendererExtensionRegistry } from './extensions/registry';
import { loadExternalRendererExtensions } from './extensions/_ext-bridge.generated';

type PortableDiagnostics = {
  platform: string;
  isPortable: boolean;
  portableRoot: string | null;
  workspaceDir: string | null;
  exePath: string;
  appPath: string;
  userDataDir: string;
  isAppTranslocated: boolean;
  appBundlePath: string | null;
  recommendedLaunchCommand: string | null;
  translocationFixCommands: string[];
};


/**
 * Error Boundary to catch and display React rendering errors
 */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('React Error Boundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px',
          color: '#f87171',
          background: '#0f172a',
          minHeight: '100vh',
          fontFamily: 'monospace'
        }}>
          <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Something went wrong</h1>
          <pre style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            background: '#1e293b',
            padding: '16px',
            borderRadius: '8px',
            fontSize: '14px'
          }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [portableDiagnostics, setPortableDiagnostics] = useState<PortableDiagnostics | null>(null);
  const [portableDiagnosticsLoaded, setPortableDiagnosticsLoaded] = useState(false);
  const skipSetupForE2E = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('e2eSkipSetup') === '1';
  const initSettings = useSettingsStore((state) => state.init);
  const theme = useSettingsStore((state) => state.theme);
  const language = useSettingsStore((state) => state.language);
  const setupComplete = useSettingsStore((state) => state.setupComplete);
  const initGateway = useGatewayStore((state) => state.init);
  const initProviders = useProviderStore((state) => state.init);

  useEffect(() => {
    initSettings();
  }, [initSettings]);

  useEffect(() => {
    let cancelled = false;
    invokeIpc<PortableDiagnostics>('app:getPortableDiagnostics')
      .then((diagnostics) => {
        if (!cancelled) setPortableDiagnostics(diagnostics);
      })
      .catch(() => {
        if (!cancelled) setPortableDiagnostics(null);
      })
      .finally(() => {
        if (!cancelled) setPortableDiagnosticsLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  // Sync i18n language with persisted settings on mount
  useEffect(() => {
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  // Initialize Gateway connection on mount
  useEffect(() => {
    if (!portableDiagnosticsLoaded || portableDiagnostics?.isAppTranslocated) return;
    initGateway();
  }, [initGateway, portableDiagnosticsLoaded, portableDiagnostics?.isAppTranslocated]);

  // Initialize provider snapshot on mount
  useEffect(() => {
    if (!portableDiagnosticsLoaded || portableDiagnostics?.isAppTranslocated) return;
    initProviders();
  }, [initProviders, portableDiagnosticsLoaded, portableDiagnostics?.isAppTranslocated]);

  // Redirect to setup wizard if not complete
  useEffect(() => {
    if (portableDiagnostics?.isAppTranslocated) return;
    if (!setupComplete && !skipSetupForE2E && !location.pathname.startsWith('/setup')) {
      navigate('/setup');
    }
  }, [setupComplete, skipSetupForE2E, location.pathname, navigate, portableDiagnostics?.isAppTranslocated]);

  // Listen for navigation events from main process
  useEffect(() => {
    const handleNavigate = (...args: unknown[]) => {
      const path = args[0];
      if (typeof path === 'string') {
        navigate(path);
      }
    };

    const unsubscribe = window.electron.ipcRenderer.on('navigate', handleNavigate);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [navigate]);

  // Apply theme
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  useEffect(() => {
    applyGatewayTransportPreference();
  }, []);

  // Load external renderer extensions (generated by scripts/generate-ext-bridge.mjs)
  // and initialize all registered extensions.
  useEffect(() => {
    loadExternalRendererExtensions();
    void rendererExtensionRegistry.initializeAll();
    return () => rendererExtensionRegistry.teardownAll();
  }, []);

  const extraRoutes = rendererExtensionRegistry.getExtraRoutes();

  if (portableDiagnostics?.isAppTranslocated) {
    return (
      <ErrorBoundary>
        <TooltipProvider delayDuration={300}>
          <PortableTranslocationBlocker diagnostics={portableDiagnostics} />
          <Toaster position="bottom-right" richColors closeButton style={{ zIndex: 99999 }} />
        </TooltipProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={300}>
        <Routes>
          {/* Setup wizard (shown on first launch) */}
          <Route path="/setup/*" element={<Setup />} />

          {/* Main application routes */}
          <Route element={<MainLayout />}>
            <Route path="/" element={<Chat />} />
            <Route path="/models" element={<Models />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/channels" element={<Channels />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/cron" element={<Cron />} />
            <Route path="/settings/*" element={<Settings />} />
            {extraRoutes.map((r) => (
              <Route key={r.path} path={r.path} element={<r.component />} />
            ))}
          </Route>
        </Routes>

        {/* Global toast notifications */}
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          style={{ zIndex: 99999 }}
        />
      </TooltipProvider>
    </ErrorBoundary>
  );
}

function PortableTranslocationBlocker({ diagnostics }: { diagnostics: PortableDiagnostics }) {
  const commands = diagnostics.translocationFixCommands.join('\n');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(commands);
  };

  return (
    <div data-testid="portable-translocation-blocker" className="flex h-screen flex-col bg-background text-foreground">
      <TitleBar />
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-8 py-12">
          <div className="flex items-start gap-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-6">
            <AlertTriangle className="h-6 w-6 flex-shrink-0 text-red-500" />
            <div className="space-y-4">
              <div>
                <h1 className="text-2xl font-semibold">macOS App Translocation detected</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  UClaw is running from a temporary macOS translocation path. Startup has been blocked to avoid writing portable data or OpenClaw resources to the wrong location.
                </p>
              </div>

              <div className="space-y-2 text-sm">
                <p className="font-medium">Current executable path</p>
                <p className="break-all rounded-lg bg-background/70 p-3 font-mono text-xs text-muted-foreground">
                  {diagnostics.exePath}
                </p>
              </div>

              <div className="space-y-2 text-sm">
                <p className="font-medium">Run these commands from Terminal, then launch UClaw from the APFS launcher.</p>
                <pre className="max-h-72 overflow-auto rounded-lg bg-background/70 p-3 text-xs font-mono whitespace-pre-wrap break-words">
                  {commands}
                </pre>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={handleCopy}>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy commands
                </Button>
                {diagnostics.recommendedLaunchCommand && (
                  <div className="flex items-center rounded-lg bg-background/70 px-3 py-2 font-mono text-xs text-muted-foreground">
                    {diagnostics.recommendedLaunchCommand}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
