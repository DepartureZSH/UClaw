param(
  [ValidateSet("first-run", "plug-and-play")]
  [string]$Mode = "first-run",

  [string]$Endpoint = $env:UCLAW_REMOTE_CONFIG_ENDPOINT,
  [string]$CompanyKey = $env:UCLAW_REMOTE_CONFIG_PACKAGE_ID,
  [string]$Root = "E:\Desktop\u-claw-usb\.uclaw-dev\$Mode",

  [switch]$Clean,
  [switch]$NoSingleInstanceLock,
  [switch]$DebugEnv
)

$ErrorActionPreference = "Stop"

function Assert-CommandExists {
  param([string]$Command)

  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    throw "Missing command: $Command"
  }
}

if (-not $Endpoint) {
  throw "Missing remote config endpoint. Pass -Endpoint <url> or set UCLAW_REMOTE_CONFIG_ENDPOINT."
}

if ($Mode -eq "plug-and-play" -and -not $CompanyKey) {
  throw "plug-and-play mode requires -CompanyKey <key> or UCLAW_REMOTE_CONFIG_PACKAGE_ID."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$dataRoot = Join-Path $Root "data"
$workspaceDir = Join-Path $dataRoot "workspace"
$settingsPath = Join-Path $dataRoot "uclaw\settings.json"
$remoteCachePath = Join-Path $dataRoot "uclaw\remote-config-cache.json"
$providerStorePath = Join-Path $dataRoot "uclaw\uclaw-providers.json"

if ($Clean) {
  Remove-Item $Root -Recurse -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force $dataRoot | Out-Null
New-Item -ItemType Directory -Force $workspaceDir | Out-Null

if ($Mode -eq "first-run") {
  Remove-Item $settingsPath -Force -ErrorAction SilentlyContinue
  Remove-Item $remoteCachePath -Force -ErrorAction SilentlyContinue
  Remove-Item $providerStorePath -Force -ErrorAction SilentlyContinue
}

$env:UCLAW_DATA_ROOT = $dataRoot
$env:UCLAW_WORKSPACE_DIR = $workspaceDir
$env:UCLAW_REMOTE_CONFIG_ENDPOINT = $Endpoint

if ($Mode -eq "plug-and-play") {
  $env:UCLAW_REMOTE_CONFIG_PACKAGE_ID = $CompanyKey
} else {
  Remove-Item Env:\UCLAW_REMOTE_CONFIG_PACKAGE_ID -ErrorAction SilentlyContinue
}

if ($NoSingleInstanceLock) {
  $env:UCLAW_SKIP_ELECTRON_SINGLE_INSTANCE_LOCK = "1"
}

Write-Host ""
Write-Host "UClaw Windows portable dev simulation"
Write-Host "Mode:        $Mode"
Write-Host "Data root:   $dataRoot"
Write-Host "Workspace:   $workspaceDir"
Write-Host "Endpoint:    $Endpoint"
Write-Host "Company key: $(if ($Mode -eq "plug-and-play") { "provided" } else { "not provided; app should show company-key page" })"
Write-Host "Settings:    $settingsPath"
Write-Host "Cache:       $remoteCachePath"
Write-Host ""

if ($DebugEnv) {
  Write-Host "Environment passed to dev process:"
  Write-Host "  UCLAW_DATA_ROOT=$env:UCLAW_DATA_ROOT"
  Write-Host "  UCLAW_WORKSPACE_DIR=$env:UCLAW_WORKSPACE_DIR"
  Write-Host "  UCLAW_REMOTE_CONFIG_ENDPOINT=$env:UCLAW_REMOTE_CONFIG_ENDPOINT"
  Write-Host "  UCLAW_REMOTE_CONFIG_PACKAGE_ID=$(if ($env:UCLAW_REMOTE_CONFIG_PACKAGE_ID) { '<set>' } else { '<unset>' })"
  Write-Host "  UCLAW_SKIP_ELECTRON_SINGLE_INSTANCE_LOCK=$(if ($env:UCLAW_SKIP_ELECTRON_SINGLE_INSTANCE_LOCK) { $env:UCLAW_SKIP_ELECTRON_SINGLE_INSTANCE_LOCK } else { '<unset>' })"
  Write-Host ""
}

Assert-CommandExists "corepack"

corepack pnpm dev
