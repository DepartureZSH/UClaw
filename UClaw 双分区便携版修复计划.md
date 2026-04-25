# UClaw 双分区便携版修复计划

## Summary

目标是把官方便携方案改成：macOS `.app` 放 APFS 分区运行，Windows/Linux 包、共享 `data/` 和 workspace 放 ExFAT 分区；macOS 通过启动器传入 `UCLAW_PORTABLE_ROOT`/`UCLAW_WORKSPACE_DIR`，避免 Finder、AppTranslocation 和跨分区自动探测导致路径错乱。同时保留 `pnpm dev` 的便携调试入口。

## Key Changes

- 新增双分区便携打包脚本：生成 `SHARE_EXFAT/` 与 `MAC_APPS_APFS/` 两套目录，而不是只生成单一 `UClaw-USB/`。
- 将提供的分区脚本纳入 `scripts/portable/`，并修正为项目标准命名、英文/中文提示、危险操作确认。
- macOS APFS 分区生成 `Launch UClaw.command`：
  - 设置 `UCLAW_PORTABLE_ROOT=/Volumes/SHARE_EXFAT/.../data`
  - 设置 `UCLAW_WORKSPACE_DIR=/Volumes/SHARE_EXFAT/.../workspace`
  - 使用真实 APFS 路径启动 `UClaw.app`
- Electron 启动早期增加 macOS AppTranslocation 检测：
  - 若 `app.getPath('exe')` 含 `AppTranslocation`，显示阻断式修复页
  - 提供 `xattr`、`lsregister`、`spctl`、`open` 等命令，不继续进入主界面
- 新增便携诊断 UI：
  - 显示 portable root、workspace dir、app 路径、是否 AppTranslocation、是否 ExFAT/APFS 风险
  - 放在 Settings > Advanced > Developer 或独立 Portable Diagnostics 页面
- 新增开发态脚本/文档：
  - `pnpm dev:portable` 或等价 PowerShell/bash 示例
  - 明确通过环境变量模拟 ExFAT shared data/workspace，不依赖 exe-relative `data/` 自动探测

## Public Interfaces

- 新增 IPC/API：
  - `app:getPortableDiagnostics`：返回 platform、isPortable、portableRoot、workspaceDir、exePath、appPath、isAppTranslocated、recommendedLaunchCommand。
- 保留现有 `UCLAW_PORTABLE_ROOT` 和 `UCLAW_WORKSPACE_DIR` 语义。
- `detectPortableDataDir()` 继续服务单目录便携包；双分区 macOS 以启动器环境变量优先。

## Test Plan

- Unit tests:
  - portable root 环境变量优先于 exe-relative `data/`
  - AppTranslocation 路径检测正确
  - diagnostics 返回字段稳定
- Script tests:
  - `node --check` / dry-run 参数校验覆盖双分区 assemble 脚本
  - macOS shell 脚本用 `bash -n`
- E2E tests:
  - Windows/dev 环境用 `UCLAW_PORTABLE_ROOT` + `UCLAW_WORKSPACE_DIR` 启动，确认 app 进入 portable mode
  - 模拟 AppTranslocation exe path，确认显示阻断修复页
  - setup workspace 步骤可识别共享 workspace 下已有 `.openclaw/openclaw.json`
- Manual macOS acceptance:
  - `.app` 放 APFS，`data/workspace` 放 ExFAT
  - 双击/运行 `Launch UClaw.command` 后路径稳定
  - Finder 触发 AppTranslocation 时应用阻断并显示修复指引

## Assumptions

- 官方推荐布局采用双分区：macOS app 在 APFS，Windows/Linux/shared data/workspace 在 ExFAT。
- macOS 不做按卷名自动搜索；由启动器显式传入环境变量。
- AppTranslocation 检测到后阻止继续运行，避免写入错误位置。
- 当前 Windows 环境无法完整验证 APFS/Finder/Gatekeeper 行为，macOS 部分需要手动验收。
