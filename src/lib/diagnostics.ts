import { invokeIpc } from '@/lib/api-client';

export async function collectDiagnosticsText(): Promise<string> {
  return await invokeIpc<string>('diagnostics:copyText');
}
