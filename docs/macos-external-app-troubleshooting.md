# macOS External App Troubleshooting

Use an APFS partition for `UClaw.app`. ExFAT is suitable for shared files and
portable data, but not for running macOS app bundles.

## Detect App Translocation

If UClaw reports a path containing:

```text
/private/var/folders/.../AppTranslocation/...
```

macOS is running the app from a temporary translocation sandbox.

## Cleanup

Run these commands from macOS, replacing the app path if needed:

```bash
sudo xattr -dr com.apple.quarantine "/Volumes/MAC_APPS_APFS/UClaw.app"
sudo xattr -d com.apple.quarantine "/Volumes/MAC_APPS_APFS" 2>/dev/null || true

/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "/Volumes/MAC_APPS_APFS/UClaw.app"

killall Finder
open "/Volumes/MAC_APPS_APFS/UClaw.app"
```

If Finder still translocates the app, add a local trust label:

```bash
sudo spctl --add --label "Local UClaw" "/Volumes/MAC_APPS_APFS/UClaw.app"
sudo spctl --enable --label "Local UClaw"
spctl --assess --type execute -vv "/Volumes/MAC_APPS_APFS/UClaw.app"
```

## Stable workaround

Prefer the generated APFS launcher:

```bash
/Volumes/MAC_APPS_APFS/Launch\ UClaw.command
```

It launches the app from its real APFS path and passes the ExFAT shared
portable data/workspace paths explicitly.
