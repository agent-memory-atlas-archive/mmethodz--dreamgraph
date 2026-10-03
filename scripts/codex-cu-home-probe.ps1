# DreamGraph v14.0.1 - Codex Computer Use home probe (open item #1).
# Runs `codex exec` three ways and asks Codex to list its callable tools,
# so we can see which CODEX_HOME layout exposes native Computer Use:
#   A = real ~\.codex home with -c overrides
#   B = isolated home exactly like DreamGraph builds today (auth files + config.toml)
#   C = isolated home + junctions to the Computer Use / browser / plugin state
#   D = C + the Computer Use sections copied from the real config.toml
#       (marketplaces, CU/browser/chrome plugins, mcp_servers.node_repl, notify,
#        [windows], [shell_environment_policy]) - the proposed DreamGraph fix
#   E = B + [mcp_servers.cua_repl] written directly from the newest
#       unified-computer-use plugin .mcp.json (bypasses Codex's plugin loader)
#   F = B + Computer Use sections from the real config.toml + a REAL COPY (not a
#       junction) of the unified-computer-use plugin folder - tests whether Codex
#       loads the plugin (and so runs its turn-end hooks) from an isolated home
# Run a subset with: -Variants D   (or -Variants A,D)
# Output: one log per variant in $env:TEMP\dg-cu-probe\, plus a summary at the end.
# Nothing in ~\.codex is modified; B and C only read from it.

param([string[]]$Variants = @("A","B","C","D","E","F"))
$ErrorActionPreference = "Stop"
$real = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
$root = Join-Path $env:TEMP "dg-cu-probe"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$work = Join-Path $root $stamp
New-Item -ItemType Directory -Force -Path $work | Out-Null

$prompt = "List the exact names of every tool you can call in this session, grouped by namespace/server. Then say in one line whether you have any computer-use or browser-control tool. Do not call any tools."

$features = @(
  "-c", "features.computer_use=true",
  "-c", "features.browser_use=true",
  "-c", "features.browser_use_external=true",
  "-c", "features.in_app_browser=true",
  "-c", "computer_use.default_app_access=allow"
)
$common = @("exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "--cd", $work)

$configToml = @"
[computer_use]
default_app_access = "allow"

[features]
computer_use = true
browser_use = true
browser_use_external = true
browser_use_full_cdp_access = false
in_app_browser = true
"@

function New-IsolatedHome([string]$path) {
  New-Item -ItemType Directory -Force -Path $path | Out-Null
  foreach ($f in "auth.json", "version.json", "installation_id") {
    $src = Join-Path $real $f
    if (Test-Path $src) { Copy-Item $src (Join-Path $path $f) }
  }
  Set-Content -Path (Join-Path $path "config.toml") -Value $configToml -Encoding UTF8
}

$codexCmd = Get-Command codex -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $codexCmd) { throw "codex executable not found on PATH" }
$codexExe = $codexCmd.Source
Write-Host "Using codex: $codexExe"
$timeoutSec = 240

function Invoke-Variant([string]$name, [string]$codexHome, [string[]]$extra) {
  $log = Join-Path $work "$name.log"
  Write-Host "`n=== Variant $name === (waiting up to $timeoutSec s)" -ForegroundColor Cyan
  # Run in a job so a hang cannot block the probe; prompt goes in on stdin
  # (same as DreamGraph's "-" prompt), so stdin is closed and Codex never waits on it.
  $job = Start-Job -ScriptBlock {
    param($exe, [string[]]$argv, $prompt, $codexHome, $log)
    if ($codexHome) { $env:CODEX_HOME = $codexHome } else { Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue }
    $prompt | & $exe @argv "-" *>&1 | Out-File -FilePath $log -Encoding utf8
    "exit code: $LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding utf8
  } -ArgumentList $codexExe, (@($common) + @($extra)), $prompt, $codexHome, $log
  if (-not (Wait-Job $job -Timeout $timeoutSec)) {
    Stop-Job $job
    "TIMED OUT after $timeoutSec s" | Out-File -FilePath $log -Append -Encoding utf8
    Write-Host "TIMED OUT - check Task Manager for a leftover codex.exe" -ForegroundColor Yellow
  }
  Remove-Job $job -Force
  if (Test-Path $log) { Get-Content $log | Out-Host }
  return $log
}

function Add-CuJunctions([string]$homeDir) {
  foreach ($d in "computer-use", "browser", "plugins", "skills", "app-server-daemon", "vendor_imports", "node_repl") {
    $src = Join-Path $real $d
    if (Test-Path $src) { New-Item -ItemType Junction -Path (Join-Path $homeDir $d) -Target $src | Out-Null }
  }
  $cacheCu = Join-Path $real "cache\computer-use"
  if (Test-Path $cacheCu) {
    New-Item -ItemType Directory -Force -Path (Join-Path $homeDir "cache") | Out-Null
    New-Item -ItemType Junction -Path (Join-Path $homeDir "cache\computer-use") -Target $cacheCu | Out-Null
  }
  $src = Join-Path $real "chrome-native-hosts-v2.json"
  if (Test-Path $src) { Copy-Item $src (Join-Path $homeDir "chrome-native-hosts-v2.json") }
}

function Get-CuConfigSections {
  $keepHeader = '^(marketplaces\.|plugins\."(computer-use|unified-computer-use|browser|chrome)@|mcp_servers\.node_repl(\.|$)|windows$|shell_environment_policy(\.|$))'
  $out = New-Object System.Collections.Generic.List[string]
  $top = $true; $take = $false
  foreach ($line in Get-Content (Join-Path $real "config.toml")) {
    if ($line -match '^\s*\[\[?([^\]]+)\]\]?\s*$') {
      $top = $false
      $take = $Matches[1].Trim() -match $keepHeader
      if ($take) { $out.Add(""); $out.Add($line) }
      continue
    }
    if ($top) { if ($line -match '^\s*notify\s*=') { $out.Add($line) }; continue }
    if ($take) { $out.Add($line) }
  }
  return $out
}

$logs = @()

if ($Variants -contains "A") {
  $logs += Invoke-Variant "A-real-home" $null $features
}

if ($Variants -contains "B") {
  $homeB = Join-Path $work "home-B"
  New-IsolatedHome $homeB
  $logs += Invoke-Variant "B-isolated" $homeB @()
}

if ($Variants -contains "C") {
  $homeC = Join-Path $work "home-C"
  New-IsolatedHome $homeC
  Add-CuJunctions $homeC
  $logs += Invoke-Variant "C-isolated-junctions" $homeC @()
}

if ($Variants -contains "D") {
  $homeD = Join-Path $work "home-D"
  New-IsolatedHome $homeD
  Add-CuJunctions $homeD
  $cu = Get-CuConfigSections
  # notify must be a top-level key, so it goes before the first [table].
  $notify = @($cu | Where-Object { $_ -match '^\s*notify\s*=' })
  $rest = @($cu | Where-Object { $_ -notmatch '^\s*notify\s*=' })
  $cfg = (@($notify) + @("") + @($configToml) + @($rest)) -join "`r`n"
  Set-Content -Path (Join-Path $homeD "config.toml") -Value $cfg -Encoding UTF8
  Write-Host "D config.toml written: $(Join-Path $homeD 'config.toml')"
  $logs += Invoke-Variant "D-isolated-cu-config" $homeD @()
}

function ConvertTo-TomlString([string]$v) { return (ConvertTo-Json -InputObject $v -Compress) }

function Get-CuaReplToml {
  $pluginRoot = Join-Path $real "plugins\cache\openai-bundled\unified-computer-use"
  $ver = Get-ChildItem $pluginRoot -Directory | Where-Object { Test-Path (Join-Path $_.FullName ".mcp.json") } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $ver) { throw "unified-computer-use plugin .mcp.json not found under $pluginRoot" }
  Write-Host "cua_repl source: $(Join-Path $ver.FullName '.mcp.json')"
  $srv = (Get-Content (Join-Path $ver.FullName ".mcp.json") -Raw | ConvertFrom-Json).mcpServers.cua_repl
  $l = New-Object System.Collections.Generic.List[string]
  $l.Add("[mcp_servers.cua_repl]")
  $l.Add("command = " + (ConvertTo-TomlString $srv.command))
  $l.Add("args = [" + ((@($srv.args) | ForEach-Object { ConvertTo-TomlString $_ }) -join ", ") + "]")
  if ($srv.env_vars) { $l.Add("env_vars = [" + ((@($srv.env_vars) | ForEach-Object { ConvertTo-TomlString $_ }) -join ", ") + "]") }
  if ($srv.startup_timeout_sec) { $l.Add("startup_timeout_sec = $($srv.startup_timeout_sec)") }
  if ($srv.enabled_tools) { $l.Add("enabled_tools = [" + ((@($srv.enabled_tools) | ForEach-Object { ConvertTo-TomlString $_ }) -join ", ") + "]") }
  $l.Add('default_tools_approval_mode = "approve"')
  $l.Add("")
  $l.Add("[mcp_servers.cua_repl.env]")
  foreach ($p in $srv.env.PSObject.Properties) { $l.Add("$($p.Name) = " + (ConvertTo-TomlString ([string]$p.Value))) }
  return ($l -join "`r`n")
}

if ($Variants -contains "E") {
  $homeE = Join-Path $work "home-E"
  New-IsolatedHome $homeE
  $cfg = $configToml + "`r`n" + (Get-CuaReplToml)
  Set-Content -Path (Join-Path $homeE "config.toml") -Value $cfg -Encoding UTF8
  Write-Host "E config.toml written: $(Join-Path $homeE 'config.toml')"
  $logs += Invoke-Variant "E-isolated-cua-repl" $homeE @()
}

if ($Variants -contains "F") {
  $homeF = Join-Path $work "home-F"
  New-IsolatedHome $homeF
  $cu = Get-CuConfigSections
  $notify = @($cu | Where-Object { $_ -match '^\s*notify\s*=' })
  $rest = @($cu | Where-Object { $_ -notmatch '^\s*notify\s*=' })
  $cfg = (@($notify) + @("") + @($configToml) + @($rest)) -join "`r`n"
  Set-Content -Path (Join-Path $homeF "config.toml") -Value $cfg -Encoding UTF8
  foreach ($market in Get-ChildItem (Join-Path $real "plugins\cache") -Directory) {
    foreach ($name in "unified-computer-use", "computer-use", "browser", "chrome") {
      $src = Join-Path $market.FullName $name
      if (Test-Path $src) {
        $dst = Join-Path $homeF ("plugins\cache\" + $market.Name + "\" + $name)
        New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
        Copy-Item $src $dst -Recurse -Force
      }
    }
  }
  Write-Host "F config.toml written: $(Join-Path $homeF 'config.toml')"
  $logs += Invoke-Variant "F-isolated-plugin-copy" $homeF @()
}

Write-Host "`n=== Summary (last 15 lines of each variant) ===" -ForegroundColor Cyan
foreach ($l in $logs) {
  Write-Host "`n--- $(Split-Path $l -Leaf) ---" -ForegroundColor Cyan
  if (Test-Path $l) { Get-Content $l -Tail 15 | Out-Host } else { Write-Host "(no log)" }
}
Write-Host "`nLogs: $work"
