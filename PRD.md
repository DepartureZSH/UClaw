# UClaw — 产品需求文档 (PRD)

> **版本**: 0.1.5  
> **状态**: 活跃开发中  
> **许可证**: MIT  
> **仓库**: `codex/dual-partition-portable`

---

## 1. 产品概述

**UClaw** 是一款跨平台桌面应用（Electron），为 **OpenClaw AI Agent 运行时** 提供图形化操作界面。它将命令行驱动的 AI Agent 编排能力转化为直观的桌面体验，让非技术用户也能轻松使用 AI Agent 进行多模型协作、多渠道通信和定时自动化任务。

### 1.1 核心价值主张

- **零门槛 AI Agent 使用**：无需命令行知识，图形化配置即可启动多 Agent 对话
- **全渠道覆盖**：一次配置，Discord / Telegram / 微信 / 飞书 / 钉钉 / WhatsApp 多端同服
- **便携即用**：支持 U 盘便携模式，数据随身携带，不留痕迹
- **安全可控**：API 密钥存储于操作系统原生密钥链，不落盘明文

---

## 2. 问题陈述

| 痛点 | 现状 | UClaw 解决方案 |
|------|------|---------------|
| AI Agent 使用门槛高 | OpenClaw 仅提供命令行接口 | 全功能 GUI，引导式设置向导 |
| 多渠道管理碎片化 | 各平台 Bot 需分别部署配置 | 统一面板管理所有渠道与 Agent 绑定 |
| 定时任务配置复杂 | 需手动编写 cron 表达式 + 配置文件 | 可视化 cron 编辑器，自动发现投递目标 |
| 数据可移植性差 | 配置与数据绑定于特定机器 | USB 便携模式，即插即用 |
| 密钥安全风险 | 配置文件明文存储 API Key | OS 原生密钥链加密存储 |

---

## 3. 目标用户

| 角色 | 描述 | 使用场景 |
|------|------|----------|
| **AI 爱好者** | 希望使用多模型 Agent，但不熟悉命令行 | 桌面聊天交互、技能安装、模型切换 |
| **社区运营者** | 管理多个 IM 平台的 Bot | 统一配置 Discord/Telegram/微信 Bot |
| **效率工作者** | 需要定时自动化任务 | 设置 cron 定时触发 AI 任务并推送到指定渠道 |
| **移动办公者** | 需要在多台设备间切换工作 | USB 便携模式，即插即用 |
| **开发者** | 需要调试 AI Agent 行为 | Settings 内置 OpenClaw Doctor 诊断工具 |

---

## 4. 功能需求

### 4.1 智能聊天 (Chat) — `P0`

- 多 Agent 对话：通过 `@agent` 语法路由消息到指定 Agent
- 流式响应：实时渲染 AI 回复，支持 Markdown（含 GFM 表格/代码块）
- 消息历史：分会话保存、搜索、删除
- 执行图可视化：展示 Agent 工具调用链路（ExecutionGraphCard）
- 模型切换：对话中随时切换使用的 AI 模型

### 4.2 AI 提供商管理 (Providers) — `P0`

- 支持提供商类型：OpenAI、Anthropic、Google、Moonshot/Kimi、new-api（国产兼容网关）、自定义
- API Key 安全存储：使用操作系统原生密钥链（macOS Keychain / Windows Credential Vault）
- 多账号支持：同类型提供商可添加多组凭据
- 模型自动发现：通过 API 探测获取可用模型列表
- 便携模式下隐藏非 new-api 提供商（仅展示国产网关）

### 4.3 Agent 配置 (Agents) — `P0`

- Agent 创建 / 编辑 / 删除
- 绑定提供商和模型
- 运行时参数配置（temperature、max_tokens、system prompt）
- 技能绑定：为 Agent 启用/禁用特定技能

### 4.4 通信渠道管理 (Channels) — `P1`

- 支持渠道：Discord、Telegram、微信 (WeChat)、飞书 (Feishu/Lark)、钉钉 (DingTalk)、WhatsApp
- 多账号支持：同渠道可配置多个账号
- 每账号 Agent 绑定：不同账号可路由到不同 Agent
- 渠道状态监控：在线/离线/错误状态实时展示
- OAuth / QR 码登录流程

### 4.5 技能市场 (Skills) — `P1`

- 浏览与搜索：从 ClawHub 市场获取可用技能列表
- 一键安装 / 卸载
- 预装技能包：PDF 处理、Excel 处理、Word 处理、PPT 处理、网页搜索 (Tavily/Brave)
- 技能版本管理
- 多市场源支持

### 4.6 定时任务 (Cron) — `P1`

- 可视化 cron 表达式编辑器
- 绑定 Agent：指定由哪个 Agent 执行任务
- 绑定 Prompt：配置任务触发时的初始提示词
- 外部投递：执行结果可推送到指定渠道
- 自动发现投递目标（渠道/用户/DM）
- 启用/禁用开关

### 4.7 设置与系统 (Settings) — `P0`

- **通用**：语言切换（中/英/日/俄）、主题切换（亮/暗/跟随系统）、开机自启
- **网关**：OpenClaw Gateway 进程管理与状态监控
- **代理**：HTTP/HTTPS/SOCKS 代理配置
- **AI 提供商**：凭据管理
- **高级**：工作区路径、日志查看
- **开发者**：OpenClaw Doctor 诊断（`doctor --json` / `doctor --fix`）

### 4.8 便携 USB 模式 (Portable Mode) — `P1`

- 自动检测：从 exe 路径向上 4 级目录查找 `data/` 文件夹
- 数据隔离：所有配置与数据存储在 U 盘 `data/uclaw/` 和 `data/.openclaw/`
- 功能限制：禁用自动更新、遥测、开机自启
- 双分区支持：macOS `.app` 在 APFS 分区，共享数据在 ExFAT 分区
- 引导式设置向导：3 步完成（欢迎 → AI 配置 → 完成）
- macOS AppTranslocation 检测与拦截页面

### 4.9 启动流程 (Startup) — `P0`

- 7 阶段启动序列：app-init → settings-load → workspace-resolve → setup-check → config-sync → provider-key-sync → gateway-start
- 每阶段可配置超时时间（环境变量控制）
- 启动进度展示页面（StartupLoadingPage）：状态图标、重试按钮、超时倒计时
- Gateway 健康检查与自动重连

---

## 5. 非功能需求

### 5.1 性能

| 指标 | 目标 |
|------|------|
| 应用冷启动时间 | < 5 秒 (SSD) |
| Gateway 启动时间 | < 30 秒 |
| 消息发送到首字渲染 | < 500ms |
| 内存占用（空闲） | < 200MB |
| CPU 占用（空闲） | < 5% |

### 5.2 安全性

- API Key 必须通过 OS 原生密钥链存储，禁止明文落盘
- 渲染进程禁止直接访问 Gateway HTTP 端点，必须通过 Main 进程代理
- IPC 通道白名单校验（preload 中注册约 160 个通道）
- 不收集用户对话内容（遥测仅限匿名使用统计）

### 5.3 可靠性

- Gateway 进程崩溃自动重启（supervisor 守护）
- WebSocket 断线自动重连（指数退避）
- Host API 不可用时 HTTP → IPC 回退
- 单实例锁：防止多开导致端口冲突

### 5.4 兼容性

| 平台 | 最低版本 | 架构 |
|------|----------|------|
| Windows | 10+ | x64, arm64 |
| macOS | 12+ | x64, arm64 |
| Linux | Ubuntu 20.04+ / Debian 11+ | x64, arm64 |
| Node.js | 22+ | — |

### 5.5 可维护性

- 任何 UI 变更必须包含 E2E 测试（Playwright）
- 通信路径变更必须运行 `comms:replay` + `comms:compare` 回归测试
- 功能/架构变更后必须同步更新 README（中/英/日/俄）
- ESLint + TypeScript 严格模式检查

---

## 6. 技术架构

### 6.1 架构概览

```
┌──────────────────────────────────────────────────┐
│                  Electron Main                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ App 生命  │ │ Host API │ │ OpenClaw Gateway │  │
│  │ 周期管理  │ │ Server   │ │ 进程管理器       │  │
│  │          │ │ :13210   │ │ :18789           │  │
│  └──────────┘ └──────────┘ └──────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ 系统托盘  │ │ 自动更新  │ │ 扩展系统         │  │
│  └──────────┘ └──────────┘ └──────────────────┘  │
└──────────────┬───────────────────────────────────┘
               │ IPC (控制面)
┌──────────────▼───────────────────────────────────┐
│                React Renderer                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ Chat     │ │ Models   │ │ Agents           │  │
│  │ Channels │ │ Skills   │ │ Cron             │  │
│  │ Settings │ │ Setup    │ │ StartupLoading   │  │
│  └──────────┘ └──────────┘ └──────────────────┘  │
│  ┌──────────────────────────────────────────────┐ │
│  │ Zustand Stores (11 stores, Chat 含 14 子模块) │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### 6.2 技术栈

| 层次 | 技术 | 版本 |
|------|------|------|
| 桌面运行时 | Electron | 40.6.0 |
| UI 框架 | React | 19.2.4 |
| 语言 | TypeScript | 5.9.3 |
| 样式方案 | Tailwind CSS 3.4 + shadcn/ui (Radix) | — |
| 状态管理 | Zustand | 5.0.11 |
| 构建工具 | Vite | 7.3.1 |
| 打包工具 | electron-builder | 26.8.1 |
| 国际化 | i18next + react-i18next | — |
| 路由 | React Router | 7.13.0 |
| 动画 | Framer Motion | 12.34.2 |
| 测试 | Vitest + Playwright | — |
| 包管理器 | pnpm | 10.31.0 (pinned) |

### 6.3 通信架构

```
Renderer  ←→  host-api.ts / api-client.ts  ←→  Main
                                                    ↕
Gateway (:18789)  ←→  Main (WS/HTTP 代理)
```

- **Renderer → Main**: 单一入口 `src/lib/host-api.ts` + `src/lib/api-client.ts`
- **Main → Renderer**: SSE / IPC 推送事件
- **Renderer → Gateway**: 禁止直连，全部经 Main 进程代理（防 CORS + 环境漂移）
- **传输优先级**: WS → HTTP → IPC（由 Main 进程统一决策）

---

## 7. 发行与部署

### 7.1 打包格式

| 平台 | 格式 |
|------|------|
| Windows | NSIS 安装器 (.exe)、便携版 (.zip) |
| macOS | DMG、便携版 (.zip) |
| Linux | AppImage、deb、rpm、便携版 (.zip) |

### 7.2 自动更新

- 基于 electron-updater
- 主通道：GitHub Releases
- 便携模式下禁用自动更新

### 7.3 便携 USB 部署

- 单分区模式：所有文件在 ExFAT 分区
- 双分区模式：macOS `.app` 在 APFS，数据在 ExFAT
- 通过 `scripts/assemble-portable-usb.mjs` 和 `scripts/assemble-dual-partition-portable.mjs` 组装

---

## 8. 里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| M1 - 基础架构 | Electron + React + Gateway 通信框架搭建 | ✅ 完成 |
| M2 - 核心功能 | Chat、Providers、Agents、Settings | ✅ 完成 |
| M3 - 渠道集成 | Discord、Telegram、WeChat、Feishu、DingTalk、WhatsApp | ✅ 完成 |
| M4 - 扩展能力 | 技能市场、Cron 定时任务 | ✅ 完成 |
| M5 - 便携模式 | USB 单分区 / 双分区便携版 | ✅ 完成 |
| M6 - 国际化 | 中/英/日/俄 四语支持 | ✅ 完成 |
| M7 - 测试覆盖 | E2E + 通信回归测试体系 | ✅ 完成 |
| M8 - 稳定发布 | 首个正式发行版 (v1.0.0) | 🔲 待完成 |
| M9 - 更多渠道 | 企业微信、Line、Slack | 🔲 规划中 |
| M10 - 高级功能 | 工作流编排、Agent 间对话链 | 🔲 规划中 |

---

## 9. 成功指标

| 指标 | 目标值 |
|------|--------|
| 首次使用至发送首条消息的完成率 | > 80% |
| 应用崩溃率 | < 0.5% (per session) |
| Gateway 启动成功率 | > 99% |
| 用户留存 (7 日) | > 60% |
| 技能市场月活安装量 | > 1000 |
| 便携模式用户占比 | > 15% |

---

## 10. 附录

### 10.1 术语表

| 术语 | 说明 |
|------|------|
| OpenClaw | AI Agent 运行时，负责 Agent 编排、消息路由、工具执行 |
| Gateway | OpenClaw 服务进程，监听 18789 端口 |
| Host API | Electron Main 进程内的 HTTP 服务，监听 13210 端口 |
| ClawHub | 技能与扩展的在线市场 |
| new-api | 国产 OpenAI 兼容 API 网关提供商类型 |
| 便携模式 | 从 USB 驱动器运行，数据存储在随身设备上 |

### 10.2 环境变量

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `UCLAW_E2E` | E2E 测试模式 | — |
| `UCLAW_PORTABLE_ROOT` | 便携模式根目录 | 自动检测 |
| `UCLAW_STARTUP_TIMEOUT_*` | 各启动阶段超时 (ms) | 见 `shared/startup.ts` |

### 10.3 参考文档

- [OpenClaw 官方文档](https://opencode.ai)
- [项目 README](README.md)
- [便携 USB 布局文档](docs/portable-usb.md)
- [用户手册](docs/user-manual.html)
- [开发指南](AGENTS.md)
- [分发指南](DISTRIBUTION.md)
