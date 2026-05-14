# TODO

## Release 更新包

- [ ] 确认 GitHub Release 包含 Windows `.exe.blockmap` 文件。缺少 blockmap 时，`electron-updater` 只能全量下载 NSIS `.exe`，无法使用差分更新。
- [ ] 确认 GitHub Release 包含 Linux `.zip` 包。Linux zip 用于便携/手动解压场景，不能只发布 AppImage、deb、rpm。
- [ ] 后续评估便携版独立更新流程：普通安装版继续使用 `electron-updater`，便携版应使用 zip 下载、校验、staging 解压和退出后替换程序目录的流程。
