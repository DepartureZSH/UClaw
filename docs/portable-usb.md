# UClaw USB Data Root Layout

UClaw supports a dual-partition USB/external-drive layout for drives that must
work on Windows, macOS, and Linux.

UClaw no longer has a separate auto-detected portable mode. All launch paths use
the same storage model: a launcher or command can pass `--uclaw-data-root` to
choose where UClaw stores app settings and the default OpenClaw runtime files.

## Recommended layout

```text
External Drive
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

Use ExFAT for shared files, Windows/Linux builds, and shared UClaw data. Use
APFS for macOS `.app` bundles.

Do not run macOS `.app` bundles directly from ExFAT. macOS apps rely on Unix
permissions, extended attributes, symlinks, and code-signing metadata that ExFAT
does not preserve reliably.

## Data root rules

The shared data directory should look like this:

```text
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

Startup priority is:

1. `--uclaw-data-root <path>` or `--uclaw-data-root=<path>`
2. `UCLAW_DATA_ROOT`
3. a packaged `uclaw-portable.json` marker next to the executable
4. the normal Electron app data location

The app does not import the user's standalone `~/.openclaw` directory into this
data root. In the fixed USB workbench layout, OpenClaw runtime files live under
`<dataRoot>/workspace/.openclaw`; UClaw stores the workspace as the relative
path `workspace`, so moving the drive between Windows machines with different
drive letters does not reset the portable workbench or send users back to the legacy Setup flow.

UClaw also does not auto-import old `Roaming\UClaw` or legacy Electron app data
into a new data root. A new USB/zip data root starts clean, so it cannot
silently inherit a workspace path from a previous installation on the computer.

Bundled `uv` follows the application package. Windows release builds also bundle
managed CPython 3.12 under the application resources, so first launch should
not download CPython when using the official Windows `.zip` artifact. Runtime
caches, tools, and fallback Python installs still live under
`<dataRoot>/uclaw/runtime/uv`; they should not be installed into the computer's
user-level `%APPDATA%\uv` or `~/.local` directories during UClaw startup.

## Build the layout

```bash
pnpm run package:portable:dual
```

The script writes:

```text
release/UClaw-USB-SHARE_EXFAT
release/UClaw-USB-MAC_APPS_APFS
```

Copy the first directory contents to the ExFAT partition. Copy the second
directory contents to the APFS partition.

## macOS launch

Start macOS with:

```bash
/Volumes/MAC_APPS_APFS/Launch\ UClaw.command
```

The launcher keeps the workspace on the shared partition and passes the data
root explicitly:

```bash
UCLAW_WORKSPACE_DIR=/Volumes/SHARE_EXFAT/workspace
open "$APP" --args --uclaw-data-root /Volumes/SHARE_EXFAT/data
```

If your ExFAT volume uses a different name, edit `Launch UClaw.command` or run:

```bash
node scripts/assemble-dual-partition-portable.mjs --share-volume YOUR_VOLUME_NAME
```

## Windows launch

Use the launcher generated next to the assembled USB package:

```cmd
"Launch UClaw Windows.cmd"
```

The launcher starts the Windows executable and passes the shared data root:

```cmd
windows\UClaw.exe --uclaw-data-root "%SCRIPT_DIR%data"
```

The GitHub Windows `.zip` artifact also contains `uclaw-portable.json`. If a
user extracts that zip and double-clicks `UClaw.exe` directly, UClaw uses
`.\data` beside the executable as its data root and keeps the OpenClaw workspace
at `.\data\workspace`.

The packaged marker is v2. Public GitHub zip artifacts include only portable
layout metadata and the public provisioning endpoint. They must not include a
package credential. Private USB packages may add `packageId` during operator
initialization or private packaging.

```json
{
  "schema": "uclaw-portable-data-root",
  "version": 2,
  "dataRoot": "data",
  "workspaceMode": "portable-workbench",
  "workspaceDir": "workspace",
  "provisioning": {
    "endpoint": "https://<laf-app-domain>/uclaw/provision",
    "publicKeyId": "<server-key-id>"
  }
}
```

At startup, if a company key or private package id is available, UClaw calls
the provisioning endpoint before Gateway starts and syncs the New API base URL,
API key, default model, and web-search model into the local UClaw/OpenClaw
runtime stores. The API key is stored in Laf environment variables, not in
`uclaw-portable.json`. If no credential is present and no cached config exists,
startup stays on the company key page for operator initialization.

Build-time overrides are available when producing private packages:

```bash
UCLAW_PORTABLE_PROVISIONING_ENDPOINT=https://example.com/uclaw/provision \
UCLAW_PORTABLE_PACKAGE_ID=customer-a-usb \
UCLAW_PORTABLE_PUBLIC_KEY_ID=customer-a-v1 \
pnpm run package:win:portable
```

The NSIS installer removes this marker after installation, so installed builds
keep using the normal system data location.

## Linux launch

Use the generated shell launcher:

```bash
./launch-uclaw-linux.sh
```

If the file is not executable after copying, run:

```bash
chmod +x launch-uclaw-linux.sh
```

## Development mode

Use the data-root development wrapper:

```bash
pnpm run dev:portable
```

To point at a real shared directory:

```bash
pnpm run dev:portable -- --data-root E:\UClaw\data --workspace-dir E:\UClaw\workspace
```

On macOS/Linux, use absolute paths for the mounted volumes.

## App Translocation

If macOS launches UClaw from an `AppTranslocation` path, UClaw shows a blocking
repair page. See `docs/macos-external-app-troubleshooting.md` for cleanup steps.
