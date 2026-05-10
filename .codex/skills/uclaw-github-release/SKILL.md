---
name: uclaw-github-release
description: UClaw project GitHub operations for separating the independent DepartureZSH/UClaw repository from the upstream ClawX fork, managing remotes, release tags, GitHub Actions packaging workflows, v0.x releases, and troubleshooting missing or failed release builds. Use when Codex is asked to push UClaw, publish a version, inspect packaging workflows, move tags, isolate upstream history/tags, or fix GitHub Actions release behavior for this project.
---

# UClaw GitHub Release

## Overview

Use this skill for UClaw GitHub repository, tag, workflow, and release-package work. The current product repository is `DepartureZSH/UClaw`, an independent empty repo populated from the local project, while historical upstream code came from `ValueCell-ai/ClawX`.

## Safety Rules

- Never push all local tags. Upstream ClawX tags may exist locally and must not be mirrored into UClaw.
- Before any push, run `git status --short --branch`, `git remote -v`, and inspect the exact branch/tag being pushed.
- Keep untracked planning files such as `StartPagePLAN.md` and `PRD.md` out of commits unless the user explicitly asks.
- Prefer GitHub connector tools for PR/repo inspection when available. Use public GitHub REST API from PowerShell for Actions status if no authenticated CLI is installed.
- Do not rewrite public tags casually. If a tag must move before release finalization, tell the user that the tag is being force-updated and verify the peeled commit after pushing.

## Repository Isolation

Use this sequence when separating UClaw from upstream ClawX or verifying the independent repo:

```powershell
git remote -v
git remote set-url origin https://github.com/DepartureZSH/UClaw.git
git branch -M main
git ls-remote --heads --tags origin
git tag --list
```

If upstream tags are present locally, delete unrelated local tags one by one or with a reviewed explicit list. Keep only UClaw tags such as `v0.2.0`.

```powershell
git tag --list
git tag -d <old-upstream-tag>
```

Push only the intended branch and tag:

```powershell
git push -u origin main
git push origin v0.2.0
```

## Release Workflow

The release workflow lives at `.github/workflows/release.yml`. For automatic packaging, confirm:

- `on.push.tags` includes `v*`.
- The tag commit contains `.github/workflows/release.yml`.
- Repository Actions are enabled in GitHub settings.
- The workflow has `contents: write` permission so it can publish GitHub Releases.
- The matrix includes Windows, macOS, and Linux packaging jobs.

Create or move a release tag only after committing the intended release content:

```powershell
git log --oneline -5
git tag -f -a v0.2.0 -m "UClaw v0.2.0" HEAD
git push --force origin v0.2.0
git ls-remote --tags origin v0.2.0
```

For annotated tags, verify both the tag object and peeled commit. The `v0.2.0^{}` line must point to the intended commit.

## Monitoring Actions

Use public REST when quick status is enough:

```powershell
$headers = @{ 'Accept' = 'application/vnd.github+json'; 'User-Agent' = 'Codex' }
$runs = Invoke-RestMethod -Uri 'https://api.github.com/repos/DepartureZSH/UClaw/actions/runs?per_page=10' -Headers $headers
$runs.workflow_runs | Select-Object id,name,event,head_branch,head_sha,status,conclusion,html_url | Format-List
```

If a workflow fails, inspect jobs:

```powershell
$runId = '<run-id>'
$jobs = Invoke-RestMethod -Uri "https://api.github.com/repos/DepartureZSH/UClaw/actions/runs/$runId/jobs" -Headers $headers
$jobs.jobs | Select-Object id,name,status,conclusion,html_url | Format-Table
```

When authenticated GitHub tools are available, prefer workflow job/log tools for private logs or detailed failure analysis.

## Missing Packaging Run

If GitHub does not automatically package a release:

- Confirm the release tag was pushed to `origin`, not only created locally.
- Confirm the workflow file exists in the commit pointed to by the tag.
- If the workflow was added after the tag was first pushed, move or re-push the tag after the workflow commit.
- Confirm `.github/workflows/release.yml` is valid YAML and visible in GitHub Actions.
- Check GitHub repository Actions settings and workflow permissions.
- If the repository was newly created, push `main` first, then push the release tag.

Useful verification:

```powershell
git rev-parse HEAD
git rev-parse v0.2.0^{}
git ls-remote --heads --tags origin
```

## Release Communication

When reporting back to the user, include:

- The commit SHA that `main` points to.
- The commit SHA that the release tag peels to.
- The Release workflow run URL.
- Whether the packaging run is queued, in progress, successful, or failed.
- Any local files intentionally left untracked.
