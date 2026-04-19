# UClaw 分发指南

本文档说明如何构建、组装和分发 UClaw 便携版 U 盘，以及二开时如何配置自动更新服务。

---

## 目录结构

### 单平台便携版（推荐 Windows 用户）

```
UClaw-USB/
├── UClaw.exe
├── resources/
├── locales/
└── data/              ← 手动创建，触发便携模式
```

### 多平台共用 U 盘

```
UClaw-USB/
├── windows/           ← Windows zip 解压到此
│   ├── UClaw.exe
│   ├── resources/
│   └── locales/
├── macos-arm64/       ← macOS arm64 zip 解压到此
│   └── UClaw.app/
├── macos-x64/         ← macOS x64 zip 解压到此
│   └── UClaw.app/
├── linux/             ← Linux zip 解压到此
│   ├── uclaw
│   ├── resources/
│   └── locales/
└── data/              ← 所有平台共用，手动创建
```

> **注意**：`resources/` 和 `locales/` 包含平台专用二进制，无法跨平台共用。只有 `data/`（用户配置）是共用的。

---

## 构建步骤

### 前提条件

```bash
# 安装依赖
pnpm run init

# Windows 打包需额外下载运行时二进制
pnpm run prep:win-binaries
```

### 单平台构建

```bash
pnpm run package:win:portable      # → release/UClaw-<version>-win-x64.zip
pnpm run package:mac:portable      # → release/UClaw-<version>-mac-arm64.zip 等
pnpm run package:linux:portable    # → release/UClaw-<version>-linux-x64.zip
```

### 全平台一键构建 + 组装

```bash
pnpm run package:portable:all
# 输出：release/UClaw-USB/
```

脚本自动完成：① 三平台 zip 构建；② 解压到各平台子目录；③ 创建共用 `data/`。

---

## 手动组装 U 盘（单平台 Windows 示例）

```bash
# 1. 构建 Windows 便携 zip
pnpm run package:win:portable

# 2. 解压到 U 盘
#    例：将 release/UClaw-x.x.x-win-x64.zip 解压到 E:\UClaw-USB\windows\

# 3. 在 U 盘根目录创建 data\ 文件夹
mkdir E:\UClaw-USB\windows\data

# 4. 直接双击 E:\UClaw-USB\windows\UClaw.exe 启动
```

---

## 便携模式工作原理

UClaw 启动时从可执行文件所在目录向上最多查找 4 层父目录，找到 `data/` 即进入便携模式：

| 平台 | 可执行文件位置 | `data/` 检测路径 |
|------|--------------|----------------|
| Windows（平铺） | `UClaw.exe` | `./data/` |
| Windows（子目录） | `windows/UClaw.exe` | `../data/` |
| Linux | `linux/uclaw` | `../data/` |
| macOS | `macos/UClaw.app/Contents/MacOS/UClaw` | `../../../../data/` |

便携模式激活后：
- `data/uclaw/` 替代 `%APPDATA%\UClaw` 作为 userData 目录
- `data/openclaw/` 替代 `~/.openclaw` 作为 OpenClaw 配置目录
- 自动禁用自动更新、遥测、开机自启

---

## 首次启动配置

便携模式首次启动时，Setup 向导显示简化 3 步流程：

```
欢迎 → AI 配置 → 完成
```

**AI 配置步骤**：
1. 填写接口地址（默认已预填）
2. 输入 API Key
3. 点击「获取模型列表」选择默认模型
4. 点击「保存配置」

保存后 UClaw 自动创建 new-api Provider 账号并设为默认，点击「下一步」即可开始使用。

---

## 预配置 API Key（可选）

如需分发时内置 API Key，可在打包完成后直接编辑便携数据文件：

> **不推荐**：API Key 以明文存储在文件中，仅适用于内部分发场景。

1. 启动一次 UClaw 并完成 AI 配置
2. 将 `data/` 目录整体复制到 U 盘（含已保存的配置和 Keychain 条目）

> 注意：OS Keychain 中存储的 API Key 与当前用户账号绑定，无法跨机器迁移。在其他机器上仍需重新输入 API Key。

---

## 版本更新

更新 U 盘上的 UClaw 版本：

1. 构建新版本 zip：`pnpm run package:win:portable`
2. 解压新版本覆盖旧的平台目录（例如 `windows/`）
3. **保留 `data/` 目录不动**（其中存储用户配置）

---

## 自动更新服务（安装版二开）

> 便携版默认关闭自动更新（`autoCheckUpdate: false`），本节仅适用于发布**安装版**（NSIS/DMG）的场景。

### 更新机制概述

UClaw 使用 `electron-updater`，启动后 10 秒自动拉取更新清单 yml，判断是否有新版本：

```
App 启动 10s 后
    → 拉取 {OSS}/{channel}/latest-win.yml（主）
    → 失败时 fallback 到 GitHub Releases（备）
    → 有新版本 → 通知用户 → 用户确认下载 → 下载完成 5s 倒计时 → quitAndInstall
```

版本通道由 `package.json` 的 `version` 字段自动判断：
- `1.0.0` → channel `latest` → 拉取 `.../latest/latest-win.yml`
- `1.0.0-beta.1` → channel `beta` → 拉取 `.../beta/beta-win.yml`

### 需要上传的文件

每次发版，`pnpm run release` 会自动生成并上传两类文件：

**① 更新清单 yml**（electron-updater 启动时只拉这个）

| 平台 | 文件名 |
|------|--------|
| Windows | `latest-win.yml` |
| macOS | `latest-mac.yml` |
| Linux | `latest-linux.yml` |

内容示例：
```yaml
version: 1.0.0
files:
  - url: UClaw-1.0.0-win-x64.exe
    sha512: abc123...
    size: 98765432
path: UClaw-1.0.0-win-x64.exe
sha512: abc123...
releaseDate: '2026-04-19T00:00:00.000Z'
```

**② 安装包本体**（yml 中 `url` 所指向的文件）
- Windows：`UClaw-1.0.0-win-x64.exe`
- macOS：`UClaw-1.0.0-mac-arm64.zip`
- Linux：`UClaw-1.0.0-linux-x64.AppImage`

### 二开时修改更新地址

需将 OSS 地址和 GitHub repo 改为自己的：

**`electron-builder.yml`**
```yaml
publish:
  - provider: generic
    url: https://你的OSS地址/latest      # ← 改为自己的 OSS bucket
    useMultipleRangeRequest: false
  - provider: github
    owner: 你的GitHub用户名              # ← 改为自己的 repo
    repo: UClaw
```

**`electron/main/updater.ts`**
```ts
const OSS_BASE_URL = 'https://你的OSS地址';  // ← 与上方保持一致（去掉 /latest）
```

### 最简方案：只用 GitHub Releases

不想维护 OSS 时，删掉 `generic` provider，只保留 GitHub：

**`electron-builder.yml`**
```yaml
publish:
  - provider: github
    owner: 你的用户名
    repo: UClaw
```

**`electron/main/updater.ts`** — 删除 `setFeedURL` 调用，让 electron-updater 直接使用 electron-builder.yml 中的 github provider：

```ts
// 删除这段：
autoUpdater.setFeedURL({
  provider: 'generic',
  url: feedUrl,
  useMultipleRangeRequest: false,
});
```

发版命令：
```bash
# 需要设置 GH_TOKEN 环境变量（GitHub Personal Access Token）
GH_TOKEN=your_token pnpm run release
# electron-builder 自动创建 GitHub Release 并上传安装包 + yml
```

### 便携版不需要更新服务

便携版用户手动下载新 zip 覆盖平台目录即可（保留 `data/` 不动）。若确认只发布便携版，可彻底关闭更新机制：

**`electron/main/updater.ts`** — 将 `checkForUpdates()` 改为直接返回：
```ts
async checkForUpdates(): Promise<UpdateInfo | null> {
  // 便携版不使用自动更新
  return null;
}
```

---

## 常见问题

**Q：启动后没有进入便携模式**
- 检查 `data/` 目录是否存在于正确位置（可执行文件同级或父级目录）
- 确认目录名为 `data`（区分大小写，Linux/macOS）

**Q：RPC timeout: chat.history**
- 这是 OpenClaw 网关未运行时的预期提示，不影响 Provider 设置
- 进入 Settings → Runtime 检查网关状态并启动

**Q：API Key 在新电脑上失效**
- OS Keychain 绑定用户账号，换机后需重新在 Settings → AI 提供商中输入 API Key

**Q：macOS 提示"无法验证开发者"**
- 右键点击 `UClaw.app` → 打开，或在系统偏好设置 → 安全性中允许
