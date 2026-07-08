# 从 USB 驱动器或外置磁盘便携运行 UClaw

> 使用双分区布局在 USB 驱动器或外置 SSD 上配置 UClaw，以便在 Windows、macOS 和 Linux 机器间携带你的工作区。

便携模式让你可以将 UClaw——连同你的设置、智能体和工作区——携带在 USB 驱动器或外置 SSD 上。插入任何兼容的电脑即可从上次停止的地方继续，无需在宿主机上安装任何东西。由于 Windows、Linux 和 macOS 处理文件权限和应用包的方式不同，推荐的设置方式是在同一驱动器上使用两个独立的分区。

## 为什么使用便携设置

* 在多台电脑上工作，无需重新安装或重新配置 UClaw。
* 将你的 AI 工作区、对话历史和技能完全保存在外部存储上。
* 将 UClaw 数据与系统级安装分离。

> **提示：** 使用 USB 3.0 或更快的驱动器。存储速度慢会明显影响网关启动时间和工作区操作。驱动器仍在同步或被宿主操作系统索引时，请勿启动 UClaw。

## 推荐的双分区布局

在外置驱动器上使用两个分区：

| 分区            | 文件系统 | 内容                                            |
| --------------- | -------- | ----------------------------------------------- |
| `SHARE_EXFAT`   | ExFAT    | Windows 和 Linux 版本、共享 `data/` 和 `workspace/` |
| `MAC_APPS_APFS` | APFS     | macOS `.app` 包和 macOS 启动器                  |

```
外置驱动器
├── SHARE_EXFAT
│   ├── windows
│   ├── linux
│   ├── data
│   └── workspace
└── MAC_APPS_APFS
    ├── macos-arm64
    ├── macos-x64
    └── Launch UClaw.command
```

> **警告：** 请勿直接从 ExFAT 运行 macOS `.app` 包。macOS 应用依赖 ExFAT 无法可靠保留的 Unix 权限、扩展属性、符号链接和代码签名元数据。请始终将 `UClaw.app` 保存在 APFS 分区上。

## 数据目录布局

ExFAT 分区上的共享 `data/` 文件夹保存 UClaw 设置和 OpenClaw 运行时配置：

```
SHARE_EXFAT/data
├── uclaw
│   ├── settings.json
│   ├── uclaw-providers.json
│   └── logs
└── workspace
    └── .openclaw
        ├── openclaw.json
        └── agents
```

### UClaw 如何查找数据根目录

UClaw 按以下顺序解析数据位置，使用第一个匹配项：

1. `--uclaw-data-root` 命令行标志
2. `UCLAW_DATA_ROOT` 环境变量
3. 可执行文件旁的 `uclaw-portable.json` 标记文件
4. 当前用户的默认 Electron 应用数据位置

下面描述的启动器会自动为你处理这些。

固定随盘工作台布局下，OpenClaw 运行时文件固定存放在
`<dataRoot>/workspace/.openclaw`。UClaw 在设置中保存的是相对路径
`workspace`，因此同一个 U 盘在不同 Windows 电脑上即使盘符变化，也不会因为
旧绝对路径不存在而重新进入 Setup。

如果同一只移动盘在新电脑上重新要求选择工作区，这属于异常。请先确认
`data/uclaw/settings.json` 中保存的是相对路径 `workspace`，并将诊断信息发给售后；不要手动改成本机绝对路径。

## 在各平台上启动

### macOS

**步骤 1：打开终端**

在 Mac 上打开终端。

**步骤 2：运行启动器**

从 APFS 分区执行启动器脚本：

```bash
/Volumes/MAC_APPS_APFS/Launch\ UClaw.command
```

启动器将 `UCLAW_WORKSPACE_DIR` 设置为共享的 ExFAT 工作区，并传递指向 ExFAT `data/` 目录的 `--uclaw-data-root`：

```bash
UCLAW_WORKSPACE_DIR=/Volumes/SHARE_EXFAT/workspace
open "$APP" --args --uclaw-data-root /Volumes/SHARE_EXFAT/data
```

**步骤 3：如需要，调整卷名**

如果你的 ExFAT 分区使用了不同的卷名，请直接编辑 `Launch UClaw.command`，或使用你的卷名重新生成启动器：

```bash
node scripts/assemble-dual-partition-portable.mjs --share-volume 你的卷名
```

### Windows

**步骤 1：使用启动器脚本**

双击 ExFAT 分区根目录中的 **Launch UClaw Windows.cmd**。这会自动将共享数据根目录传递给可执行文件：

```cmd
windows\UClaw.exe --uclaw-data-root "%SCRIPT_DIR%data"
```

**步骤 2（替代方案）：直接从 ZIP 启动**

如果你解压了官方 Windows `.zip` 版本并希望直接双击 `UClaw.exe`，包含的 `uclaw-portable.json` 标记文件会告知 UClaw 使用可执行文件旁的 `data\` 文件夹作为数据根目录。这种情况下不需要启动器脚本。

当前 Windows ZIP 使用 v2 标记文件，除固定 `data\workspace` 外，还可以携带商业 U 盘包的配置下发信息：

```json
{
  "schema": "uclaw-portable-data-root",
  "version": 2,
  "dataRoot": "data",
  "workspaceMode": "portable-workbench",
  "workspaceDir": "workspace",
  "provisioning": {
    "endpoint": "https://tbop954d65.sealosbja.site/uclaw/provision",
    "packageId": "uclaw-usb-default",
    "publicKeyId": "sealaf-bja-uclaw-v1"
  }
}
```

启动时，UClaw 会在 Gateway 启动前调用配置下发端点，将 New API 地址、API Key、默认模型和联网搜索模型同步到本地 UClaw/OpenClaw 运行时存储。API Key 保存在 Laf 环境变量中，不写入 `uclaw-portable.json`。

制作客户专属包时，可以用构建环境变量覆盖默认下发信息：

```bash
UCLAW_PORTABLE_PROVISIONING_ENDPOINT=https://example.com/uclaw/provision \
UCLAW_PORTABLE_PACKAGE_ID=customer-a-usb \
UCLAW_PORTABLE_PUBLIC_KEY_ID=customer-a-v1 \
pnpm run package:win:portable
```

> **说明：** NSIS 安装程序在安装后会删除 `uclaw-portable.json`，因此已安装的版本会继续使用正常的 Windows 应用数据位置。

### Linux

**步骤 1：运行启动器脚本**

从 ExFAT 分区执行启动器：

```bash
./launch-uclaw-linux.sh
```

**步骤 2：如需要，添加执行权限**

如果脚本在复制后失去了可执行位，请恢复权限：

```bash
chmod +x launch-uclaw-linux.sh
```

## macOS 应用转位（App Translocation）

如果 macOS 从包含 `/AppTranslocation/` 的路径运行 UClaw，说明它正在临时安全沙箱中启动应用。当应用或其父目录上设置了隔离标志时会发生这种情况。

UClaw 检测到此情况时会显示一个阻塞修复页面。要解决这个问题，在终端中运行以下命令（如果你的 APFS 卷使用了不同的名称，请调整路径）：

```bash
# 清除隔离并重新注册
sudo xattr -dr com.apple.quarantine "/Volumes/MAC_APPS_APFS/UClaw.app"
sudo xattr -d com.apple.quarantine "/Volumes/MAC_APPS_APFS" 2>/dev/null || true

/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "/Volumes/MAC_APPS_APFS/UClaw.app"

killall Finder
open "/Volumes/MAC_APPS_APFS/UClaw.app"
```

如果运行这些命令后 Finder 仍然转位应用，请添加本地信任标签：

```bash
# 添加本地信任标签
sudo spctl --add --label "Local UClaw" "/Volumes/MAC_APPS_APFS/UClaw.app"
sudo spctl --enable --label "Local UClaw"
spctl --assess --type execute -vv "/Volumes/MAC_APPS_APFS/UClaw.app"
```

> **提示：** 使用 `Launch UClaw.command` 而非在 Finder 中双击 `.app` 是避免转位最可靠的方式，因为启动器会从其已知的真实 APFS 路径打开应用。
