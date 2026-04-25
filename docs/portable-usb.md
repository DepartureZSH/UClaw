# UClaw Portable USB Layout

UClaw supports a dual-partition portable layout for drives that must work on
Windows, macOS, and Linux.

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

The launcher sets:

```bash
UCLAW_PORTABLE_ROOT=/Volumes/SHARE_EXFAT/data
UCLAW_WORKSPACE_DIR=/Volumes/SHARE_EXFAT/workspace
```

If your ExFAT volume uses a different name, edit `Launch UClaw.command` or run:

```bash
node scripts/assemble-dual-partition-portable.mjs --share-volume YOUR_VOLUME_NAME
```

## Development mode

Use the portable development wrapper:

```bash
pnpm run dev:portable
```

To point at a real shared directory:

```bash
pnpm run dev:portable -- --portable-root E:\UClaw\data --workspace-dir E:\UClaw\workspace
```

On macOS/Linux, use absolute paths for the mounted volumes.

## App Translocation

If macOS launches UClaw from an `AppTranslocation` path, UClaw shows a blocking
repair page. See `docs/macos-external-app-troubleshooting.md` for cleanup steps.
