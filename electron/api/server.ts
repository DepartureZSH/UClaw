import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { getPort } from '../utils/config';
import { logger } from '../utils/logger';
import { extensionRegistry } from '../extensions/registry';
import type { HostApiContext } from './context';
import { handleAppRoutes } from './routes/app';
import { handleGatewayRoutes } from './routes/gateway';
import { handleSettingsRoutes } from './routes/settings';
import { handleProviderRoutes } from './routes/providers';
import { handleAgentRoutes } from './routes/agents';
import { handleChannelRoutes } from './routes/channels';
import { handleLogRoutes } from './routes/logs';
import { handleUsageRoutes } from './routes/usage';
import { handleSkillRoutes } from './routes/skills';
import { handleFileRoutes } from './routes/files';
import { handleSessionRoutes } from './routes/sessions';
import { handleCronRoutes } from './routes/cron';
import { handleDiagnosticsRoutes } from './routes/diagnostics';
import { sendJson, setCorsHeaders, requireJsonContentType } from './route-utils';

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
) => Promise<boolean>;

const coreRouteHandlers: RouteHandler[] = [
  handleAppRoutes,
  handleGatewayRoutes,
  handleSettingsRoutes,
  handleProviderRoutes,
  handleAgentRoutes,
  handleChannelRoutes,
  handleSkillRoutes,
  handleFileRoutes,
  handleSessionRoutes,
  handleCronRoutes,
  handleDiagnosticsRoutes,
  handleLogRoutes,
  handleUsageRoutes,
];

function buildRouteHandlers(): RouteHandler[] {
  const extensionHandlers = extensionRegistry.getRouteHandlers();
  return [...coreRouteHandlers, ...extensionHandlers];
}

/**
 * Per-session secret token used to authenticate Host API requests.
 * Generated once at server start and shared with the renderer via IPC.
 * This prevents cross-origin attackers from reading sensitive data even
 * if they can reach 127.0.0.1:13210 (the CORS wildcard alone is not
 * sufficient because browsers attach the Origin header but not a secret).
 */
let hostApiToken: string = '';
let hostApiPort: number = getPort('UCLAW_HOST_API');

/** Retrieve the current Host API auth token (for use by IPC proxy). */
export function getHostApiToken(): string {
  return hostApiToken;
}

/** Retrieve the actual Host API port, including fallback ports after EADDRINUSE. */
export function getHostApiPort(): number {
  return hostApiPort;
}

export function startHostApiServer(ctx: HostApiContext, port = getPort('UCLAW_HOST_API')): Server {
  // Generate a cryptographically random token for this session.
  hostApiToken = randomBytes(32).toString('hex');
  hostApiPort = port;

  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      // ── CORS headers ─────────────────────────────────────────
      // Set origin-aware CORS headers early so every response
      // (including error responses) carries them consistently.
      const origin = req.headers.origin;
      setCorsHeaders(res, origin);

      // CORS preflight — respond before auth so browsers can negotiate.
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      // ── Auth gate ──────────────────────────────────────────────
      // Every non-preflight request must carry a valid Bearer token.
      // Accept via Authorization header (preferred) or ?token= query
      // parameter (for EventSource which cannot set custom headers).
      const authHeader = req.headers.authorization || '';
      const bearerToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : (requestUrl.searchParams.get('token') || '');
      if (bearerToken !== hostApiToken) {
        sendJson(res, 401, { success: false, error: 'Unauthorized' });
        return;
      }

      // ── Content-Type gate (anti-CSRF) ──────────────────────────
      // Mutation requests must use application/json to force a CORS
      // preflight, preventing "simple request" CSRF attacks.
      if (!requireJsonContentType(req)) {
        sendJson(res, 415, { success: false, error: 'Content-Type must be application/json' });
        return;
      }

      const routeHandlers = buildRouteHandlers();
      for (const handler of routeHandlers) {
        if (await handler(req, res, requestUrl, ctx)) {
          return;
        }
      }
      sendJson(res, 404, { success: false, error: `No route for ${req.method} ${requestUrl.pathname}` });
    } catch (error) {
      logger.error('Host API request failed:', error);
      sendJson(res, 500, { success: false, error: String(error) });
    }
  });

  const envPortOverride = Boolean(process.env.UCLAW_PORT_UCLAW_HOST_API?.trim());
  let listenAttempt = 0;
  const maxFallbackAttempts = envPortOverride ? 0 : 20;
  const listen = (nextPort: number): void => {
    hostApiPort = nextPort;
    server.listen(nextPort, '127.0.0.1');
  };

  server.on('error', (error: NodeJS.ErrnoException) => {
    if ((error.code === 'EACCES' || error.code === 'EADDRINUSE') && listenAttempt < maxFallbackAttempts) {
      listenAttempt += 1;
      const nextPort = port + listenAttempt;
      logger.warn(
        `Host API port ${hostApiPort} is unavailable (${error.code}); retrying on ${nextPort}.`,
      );
      setTimeout(() => listen(nextPort), 0);
      return;
    }

    if (error.code === 'EACCES' || error.code === 'EADDRINUSE') {
      logger.error(
        `Host API server failed to bind port ${hostApiPort}: ${error.message}. ` +
        'On Windows this is often caused by Hyper-V reserving the port range. ' +
        `Set UCLAW_PORT_UCLAW_HOST_API env var to override the default port.`,
      );
    } else {
      logger.error('Host API server error:', error);
    }
  });

  server.on('listening', () => {
    const address = server.address();
    if (address && typeof address === 'object') {
      hostApiPort = address.port;
    }
    logger.info(`Host API server listening on http://127.0.0.1:${hostApiPort}`);
  });

  listen(port);

  return server;
}
