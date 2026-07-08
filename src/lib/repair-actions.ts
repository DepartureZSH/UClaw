import { invokeIpc } from '@/lib/api-client';

export interface RepairActionRequest {
  id: string;
  payload?: Record<string, unknown>;
}

export interface RepairActionResult {
  success: true;
  copyText?: string;
}

export async function runRepairAction(request: RepairActionRequest): Promise<RepairActionResult> {
  return await invokeIpc<RepairActionResult>('repair:action', request);
}
