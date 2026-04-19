# 二开计划：UClaw USB 便携版（接入 new-api）

## 目标

将 UClaw 改造为可直接从 U 盘运行的便携桌面 AI 客户端，沿用现有 UI，默认接入 [new-api](https://github.com/Calcium-Ion/new-api)（OpenAI 兼容聚合接口），无需安装、无需联网更新、开箱即用。

---

## ✅ 阶段一：便携路径重定向（已完成）

**问题**：当前所有数据写入用户主目录（`~/.uclaw/`、`~/.openclaw/`），插拔 U 盘后换一台电脑数据消失。

**实现**：

- `electron/main/index.ts`：`detectPortableDataDir()` 向上最多走 4 层查找 `data/` 目录（兼容多平台 USB 布局），调用 `app.setPath('userData', ...)` 并设置 `UCLAW_PORTABLE_ROOT` 环境变量。
- `electron/utils/paths.ts`：`getOpenClawConfigDir()` 和 `getUClawConfigDir()` 读取 `UCLAW_PORTABLE_ROOT`，存在时返回便携路径。
- `electron/utils/store.ts`：便携模式下 `autoCheckUpdate: false`、`telemetryEnabled: false`、`launchAtStartup: false`。

---

## ✅ 阶段二：new-api Provider 集成（已完成）

**实现**：

- `electron/shared/providers/types.ts`：新增 `'new-api'` 类型。
- `electron/shared/providers/registry.ts`：注册 new-api Provider 定义（`apiProtocol: openai-completions`，`defaultBaseUrl`，`showModelId: true`）。
- `src/lib/providers.ts`：所有其他 Provider 设置 `hidden: true`，只展示 new-api。
- `src/assets/providers/new-api.svg`：图标已添加。
- `electron/api/routes/providers.ts`：新增 `GET /api/provider-accounts/:id/models` 端点，使用已存储的 API Key 代理请求 `/v1/models`。
- `src/components/settings/ProvidersSettings.tsx`：
  - 添加 / 编辑 Provider 时支持动态获取模型列表。
  - 模型 ID 和回退模型均从列表选择（未获取前 disable 输入框）。
  - 保存 / 取消按钮固定在卡片底部（不随内容滚动）。

---

## ✅ 阶段三：开箱即用——首次启动预配置（已完成）

**实现**：

- `src/pages/Setup/index.tsx`：便携模式下显示 3 步简化向导（欢迎 → AI 配置 → 完成）。
  - 跳过 Runtime 检测和 OpenClaw 安装步骤。
  - AI 配置步骤：填写 BaseURL + API Key，可动态获取模型列表，保存后自动创建 new-api 账号并设为默认。
  - 通过 `app:isPortable` IPC 通道感知便携模式。

---

## ✅ 阶段四：Windows 便携打包（已完成）

**实现**：

- `package.json` 新增脚本：
  - `package:win:portable` — Windows zip
  - `package:mac:portable` — macOS zip
  - `package:linux:portable` — Linux zip
  - `package:portable:all` — 全平台 + 自动组装 USB 目录
- `scripts/assemble-portable-usb.mjs`：将各平台 zip 解压到 `release/UClaw-USB/` 的平台子目录，创建共用 `data/`。

---

## ✅ 阶段五：IPC 通道扩展（已完成）

**实现**：

- `electron/main/ipc-handlers.ts`：注册 `app:isPortable` 和 `app:portableRoot` 通道。
- `src/lib/api-client.ts`：两个通道加入 `UNIFIED_CHANNELS`，渲染层可通过 `invokeIpc('app:isPortable')` 查询。

---

## ✅ 全局重命名：ClawX → UClaw（已完成）

所有源文件、配置文件、脚本、资源文件中的品牌名已统一替换：

| 规则 | 示例 |
|------|------|
| `ClawX` → `UClaw` | productName、UI 文案、注释 |
| `clawx` → `uclaw` | `~/.uclaw/`、`uclaw.desktop`、锁文件名 |
| `CLAWX` → `UCLAW` | `UCLAW_PORTABLE_ROOT`、`UCLAW_E2E` |

---

## 不改动的部分

- 所有现有 UI 组件和页面（Chat、Channels、Cron、Skills、Agents、Models、Settings）保持不变
- OpenClaw gateway 管理逻辑、技能系统、频道集成保持不变
- 现有 Provider 类型（Anthropic、OpenAI、Google 等）完整保留（仅 UI 中隐藏）
- 构建系统（Vite + electron-builder）保持不变，仅新增打包目标
