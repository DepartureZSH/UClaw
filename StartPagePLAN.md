# UClaw 启动加载页实现计划

## Summary
在 `E:\Desktop\u-claw-usb\UClaw` 的 `codex/dual-partition-portable` 分支上实现主窗口内启动加载页，覆盖启动阶段 1-7：应用初始化、读取本机设置、解析工作区、Setup 判断、配置同步、Provider 密钥注入、OpenClaw Gateway 启动。用户选择的策略为：不做独立 Splash；Gateway 未 ready 前完全阻塞主界面；Setup 未完成时进入 Setup，不进入对话页。

## Key Changes
- 执行前准备：
  - 切到 `origin/codex/dual-partition-portable` 并创建/更新本地 `codex/dual-partition-portable`。
  - 确认工作区干净后再实现；不要混入无关文件。
- Main 进程新增启动编排服务：
  - 新增 `startupProgressService`，接管 `electron/main/index.ts` 中现有“读取设置、解析工作区、setup gate、provider sync、gateway auto-start”的启动顺序。
  - 将 `gatewayManager.start()` 从裸 auto-start 调用改为第 7 阶段任务，由 startup service 统一发进度、超时和错误。
  - 主窗口创建前完成的早期状态要缓存，窗口 ready 后立即补发给 Renderer。
- 新增启动状态接口：
  - `StartupStepId = app-init | settings-load | workspace-resolve | setup-check | config-sync | provider-key-sync | gateway-start`
  - `StartupStepStatus = pending | running | success | warning | error | timeout | skipped`
  - 快照包含：整体状态、当前 step、7 个 step 列表、用户可点击 actions、可折叠 technical detail。
  - 新增 API：`startup:getSnapshot`、`startup:action`、`startup:progress` 事件；Renderer 通过 `api-client`/统一请求封装访问，不在页面中散落直接 IPC。
- Renderer 新增启动页：
  - `App.tsx` 首屏先显示 `StartupLoadingPage`。
  - `startup.status === ready` 后才渲染主路由和 `MainLayout`。
  - `startup.status === blockedBySetup` 时进入 Setup。
  - `error/timeout` 时停留在加载页，显示中文说明、进度、按钮、日志入口和复制错误。
- Provider/key 一致性检查纳入第 6 阶段：
  - 读取 `openclaw.json` 默认模型 provider。
  - 检查 provider store、auth-profiles、可注入环境变量是否有对应 key。
  - 对 cc switch 场景：若默认 provider 被改为 `openai` 但无 key，且存在 `new-api` 等已配置 provider，显示“一键切回已配置 provider”。
  - 不静默复制 API Key；需要复制/复用密钥时必须用户确认。
- Gateway 第 7 阶段细分进度：
  - 检查现有 Gateway。
  - 等待端口释放或复用现有 Gateway。
  - 启动 Gateway 进程。
  - 等待端口 ready。
  - WebSocket handshake。
  - RPC ready。
  - 将 `Unauthorized`、`pairing required`、端口占用、RPC timeout、plugin not found 映射为中文错误和处理按钮。

## Timeout And Actions
- 默认超时：
  - `app-init`: 8s
  - `settings-load`: 5s
  - `workspace-resolve`: 15s
  - `setup-check`: 5s
  - `config-sync`: 20s
  - `provider-key-sync`: 10s
  - `gateway-start`: 45s
- 必备按钮：
  - 通用：`重试当前步骤`、`查看日志`、`复制错误信息`、`退出应用`
  - 工作区：`重新选择工作区`、`打开工作区文件夹`、`进入 Setup`
  - 配置：`一键修复配置`、`从备份恢复`、`打开 openclaw.json`
  - Provider：`打开 AI 配置`、`配置当前 provider 密钥`、`一键切回已配置 provider`、`重新扫描配置`
  - Gateway：`重启 Gateway`、`停止旧 Gateway 并重试`、`重新同步 token`、`重置配对信息`、`换端口重试`、`清理异常插件配置`
- Gateway 未 ready 前完全阻塞主界面；允许用户在加载页处理错误，但不允许进入对话页。

## Test Plan
- Unit tests：
  - startup service 按 1-7 顺序推进；某步失败后不继续后续步骤。
  - 每个 step timeout 产生正确状态和 actions。
  - setup 未完成产生 `blockedBySetup`，不启动 Gateway。
  - provider/key 检查能识别 `openai` 无 key、`new-api` 有 key，并生成 `switch-provider` action。
  - Gateway 错误文本映射为 `unauthorized`、`pairing-required`、`port-in-use`、`rpc-timeout`、`plugin-not-found`。
- Renderer tests：
  - 启动页显示 7 个阶段、整体进度、当前状态。
  - `ready` 前主路由不渲染。
  - error/timeout 显示中文说明、按钮、折叠详情。
  - `blockedBySetup` 进入 Setup。
- E2E：
  - 全新 profile：加载页后进入 Setup。
  - 已完成 Setup：加载页完成后进入主界面。
  - 工作区路径不存在：提示重新选择工作区。
  - cc switch 改成 `openai` 且无 key：提示配置 key 或切回 `new-api`。
  - Gateway Unauthorized / pairing required / 启动超时：显示对应修复按钮。
- 回归：
  - `pnpm run typecheck`
  - 相关 unit tests
  - Setup E2E
  - app smoke E2E
  - 通讯路径变更后运行 `pnpm run comms:replay` 和 `pnpm run comms:compare`

## Assumptions
- 当前实现目标分支为 `codex/dual-partition-portable`，远端已存在 `origin/codex/dual-partition-portable`。
- 加载页使用主窗口内页面，不做独立 Splash。
- Gateway 未 ready 前完全阻塞主界面。
- Setup 未完成是正常阻塞，不算错误。
- 第 8 阶段“进入对话后加载历史/会话”不纳入全屏启动页，只在对话页做局部 loading。
