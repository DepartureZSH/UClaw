import { join } from 'node:path';

export interface UpdateSupportState {
  supported: boolean;
  reason?: string;
}

export function resolveUpdateSupportState(params: {
  isPackaged: boolean;
  resourcesPath: string;
  appUpdateYmlExists: (path: string) => boolean;
}): UpdateSupportState {
  if (!params.isPackaged) {
    return {
      supported: false,
      reason: '开发模式不支持应用内自动更新。',
    };
  }

  const appUpdateYmlPath = join(params.resourcesPath, 'app-update.yml');
  if (!params.appUpdateYmlExists(appUpdateYmlPath)) {
    return {
      supported: false,
      reason: '当前 ZIP 便携版不支持应用内自动安装更新。请从 GitHub Releases 下载新版 ZIP，退出 UClaw 后替换程序文件；随包 OpenClaw 运行时会一并更新。',
    };
  }

  return { supported: true };
}
