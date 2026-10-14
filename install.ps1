# install.ps1 - one-command installer for the chatgpt-coop WorkBuddy skill
#
# Usage (public repo):
#   iex (irm "https://raw.githubusercontent.com/<USER>/chatgpt-coop/main/install.ps1")
#
# Usage (private repo):
#   $env:GITHUB_TOKEN = 'ghp_xxxxxxxxxxxxxxxxxxxx'
#   iex (irm "https://raw.githubusercontent.com/<USER>/chatgpt-coop/main/install.ps1")
#
# Notes:
#   - Set $Repo below to your own repo before publishing, or pass -Repo "<user>/<repo>"
#   - Requires Windows PowerShell 5.1 (or PowerShell 7+) and internet access
#   - If you are behind a proxy, pass -Proxy "http://127.0.0.1:10809"
#
# ASCII-only on purpose: PowerShell 5.1 reads .ps1 as ANSI unless it has a UTF-8 BOM,
# so non-ASCII literals get mangled and can break syntax.

param(
    [string]$Repo   = 'wuhliang/chatgpt-coop',
    [string]$Branch = 'main',
    [string]$Token  = $env:GITHUB_TOKEN,
    [string]$Proxy,
    [switch]$SkipSetup
)

$ErrorActionPreference = 'Stop'

function Say($m) { Write-Host "[install] $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "[install] FAILED: $m" -ForegroundColor Red; exit 1 }

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

if ($Repo -eq 'CHANGEME/chatgpt-coop') {
    Fail "Repo is not configured. Pass -Repo '<user>/<repo>' or edit the default inside install.ps1."
}

$skillsRoot = Join-Path $env:USERPROFILE '.workbuddy\skills'
$dest       = Join-Path $skillsRoot 'chatgpt-coop'
if (-not (Test-Path $skillsRoot)) { New-Item -ItemType Directory -Path $skillsRoot -Force | Out-Null }

$apiUrl = "https://api.github.com/repos/$Repo/zipball/$Branch"
$tmpRoot = Join-Path $env:TEMP ("chatgpt-coop-install-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
$zipPath = Join-Path $tmpRoot 'repo.zip'

Say "Downloading $apiUrl"
$headers = @{ 'Accept' = 'application/vnd.github+json'; 'User-Agent' = 'chatgpt-coop-installer' }
if ($Token) { $headers['Authorization'] = "Bearer $Token" }

try {
    $iwParams = @{ Uri = $apiUrl; OutFile = $zipPath; Headers = $headers; UseBasicParsing = $true }
    if ($Proxy) { $iwParams['Proxy'] = $Proxy }
    Invoke-WebRequest @iwParams
} catch {
    Fail "Download failed: $($_.Exception.Message)`n  Private repo? Set `$env:GITHUB_TOKEN first.  Behind a proxy? Use -Proxy 'http://host:port'."
}

Say 'Extracting'
Expand-Archive -Path $zipPath -DestinationPath $tmpRoot -Force
Remove-Item $zipPath -Force

$source = Get-ChildItem $tmpRoot -Directory | Select-Object -First 1
if (-not $source) { Fail 'Unexpected archive layout: no root folder found.' }
if (-not (Test-Path (Join-Path $source.FullName 'SKILL.md'))) {
    Fail 'Archive does not contain SKILL.md at its root - wrong repo or branch.'
}

if (Test-Path $dest) {
    $bak = $dest + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Say "Existing install found - backing up to $bak"
    Move-Item $dest $bak -Force
}

Say "Installing to $dest"
New-Item -ItemType Directory -Path (Join-Path $dest 'scripts') -Force | Out-Null
Copy-Item (Join-Path $source.FullName 'SKILL.md') $dest -Force
foreach ($f in @('README.md', 'RESTORE.md')) {
    $p = Join-Path $source.FullName $f
    if (Test-Path $p) { Copy-Item $p $dest -Force }
}
Get-ChildItem (Join-Path $source.FullName 'scripts') -File | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $dest 'scripts') -Force
}

Remove-Item $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
Say "Skill files installed."

if (-not $SkipSetup) {
    $setup = Join-Path $dest 'scripts\setup.ps1'
    if (Test-Path $setup) {
        Say 'Running environment setup (Edge / proxy detection, desktop shortcut)'
        try { & powershell.exe -ExecutionPolicy Bypass -File $setup }
        catch { Write-Host "[install] setup.ps1 reported: $($_.Exception.Message)" -ForegroundColor Yellow }
    }
}

Say 'Done. Trigger it by saying: ChatGPT collaboration'
Say 'If this was a fresh machine, log in to ChatGPT once in the Edge window.'
