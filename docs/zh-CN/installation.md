# 如何在各平台下载并安装 UClaw

> 通过 GitHub Releases 下载适合你平台的安装包，在 macOS、Windows 或 Linux 上安装 UClaw。最低需要 4 GB 内存和 1 GB 可用磁盘空间。

从 [GitHub Releases 页面](https://github.com/DepartureZSH/UClaw/releases) 下载 UClaw，并按照以下对应操作系统的说明进行安装。UClaw 至少需要 4 GB 内存和 1 GB 可用磁盘空间。安装完成后启动 UClaw，设置向导将引导你完成后续配置。

## 系统要求

|                | 最低要求                        |
| -------------- | ------------------------------- |
| **macOS**      | 11 (Big Sur) 或更高版本         |
| **Windows**    | 10 或更高版本                   |
| **Linux**      | Ubuntu 20.04 或更高版本         |
| **内存**       | 4 GB RAM（推荐 8 GB）           |
| **磁盘空间**   | 1 GB 可用空间                   |

## 在 Windows 上安装

**步骤 1：下载安装程序**

前往 [UClaw Releases 页面](https://github.com/DepartureZSH/UClaw/releases)，下载最新版本的 `win-x64.exe` 安装程序。

如果你希望进行不写入 Windows 注册表的便携安装，请下载 `.zip` 压缩包。

**步骤 2：运行安装程序**

双击 `win-x64.exe`，按照安装向导完成安装。

> **注意：** Windows 可能显示"未知发布者"警告，因为该安装程序未使用商业证书进行代码签名。如果你是直接从[官方 Releases 页面](https://github.com/DepartureZSH/UClaw/releases)下载的文件，则可以安全继续。点击**更多信息**，然后点击**仍要运行**。

**步骤 3：启动 UClaw**

从开始菜单或桌面快捷方式打开 UClaw。首次启动时将出现设置向导。

### 便携 ZIP 选项（Windows）

如果你使用 `.zip` 压缩包而非安装程序，请将内容解压到你选择的位置——例如 USB 驱动器或桌面上的某个文件夹。ZIP 包含一个 v2 `uclaw-portable.json` 标记文件，告知 UClaw 将数据存储在 `UClaw.exe` 旁边的 `data/` 文件夹中，并将工作区固定为 `data/workspace`，因此不会向 `AppData` 写入任何文件，也不会因为不同电脑盘符变化而重新进入 Setup。商业 U 盘包还会在启动时从托管 Laf 端点同步 New API 和联网搜索配置。

> **提示：** 如需在多台电脑上通过 USB 驱动器运行 UClaw，请使用便携 ZIP，并始终直接通过 `UClaw.exe` 或内附的 `Launch UClaw Windows.cmd` 启动器来运行。详细的双分区设置指南请参阅[便携 USB 模式](./advanced/portable-usb.md)。

---

## 在 macOS 上安装

**步骤 1：下载 macOS 安装包**

前往 [UClaw Releases 页面](https://github.com/DepartureZSH/UClaw/releases)，下载与你 Mac 匹配的 macOS 安装包：

* **Apple Silicon（M1/M2/M3/M4）**：下载 `arm64` 版本
* **Intel**：下载 `x64` 版本

**步骤 2：将应用移至应用程序文件夹**

打开下载的文件，将 **UClaw.app** 拖入**应用程序**文件夹。

> **注意：** 请勿直接从下载文件夹或 ExFAT 格式的驱动器运行 UClaw。macOS 依赖 ExFAT 不支持的文件系统特性（Unix 权限、扩展属性、符号链接）。请始终将 `.app` 包放置在 APFS 或 HFS+ 卷上。

**步骤 3：允许 UClaw 运行**

首次打开 UClaw 时，macOS Gatekeeper 可能会因为应用是从互联网下载的而阻止它。

要允许运行，请打开**系统设置 → 隐私与安全性**，向下滚动到安全性部分，点击 UClaw 旁边的**仍要打开**，并在提示时确认。

**步骤 4：启动 UClaw**

从应用程序文件夹打开 UClaw。首次启动时将出现设置向导。

> **提示：** 如果 macOS 从 `AppTranslocation` 路径（临时隔离位置）打开 UClaw，UClaw 会显示一个包含修复说明的页面。当你未先将应用移至永久位置（如 `/Applications`）就直接运行时，会发生这种情况。

---

## 在 Linux 上安装

**步骤 1：下载 Linux 安装包**

前往 [UClaw Releases 页面](https://github.com/DepartureZSH/UClaw/releases)，下载适合你系统架构的 Linux 安装包。

**步骤 2：解压安装包**

打开终端，将下载的压缩包解压到你选择的位置：

```bash
tar -xf UClaw-linux-x64.tar.gz -C ~/Applications/
```

**步骤 3：如需要，添加执行权限**

如果解压后启动脚本没有可执行权限，请手动添加：

```bash
chmod +x ~/Applications/UClaw/uclaw
```

**步骤 4：启动 UClaw**

从解压目录运行启动器：

```bash
~/Applications/UClaw/uclaw
```

首次启动时将出现设置向导。

> **提示：** 如果你计划在 Linux 上通过 USB 驱动器使用 UClaw，请保持挂载路径在各次会话中稳定。更改挂载点会导致 UClaw 重新运行设置向导，因为存储的工作区路径已不存在。

---

## 安装完成后

UClaw 首次打开时，设置向导将引导你选择工作区、验证内置运行时并配置 AI 提供商。逐步指南请参阅[设置向导](./setup-wizard.md)。

- [设置向导](./setup-wizard.md) — 通过五个引导步骤完成首次启动配置。
- [便携 USB 模式](./advanced/portable-usb.md) — 在 Windows、macOS 和 Linux 上通过 USB 驱动器运行 UClaw。
