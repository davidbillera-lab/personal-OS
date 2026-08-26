# Rig boot recovery for the Mission Control dispatcher.
#
# WHY THIS EXISTS
# `pm2 save` writes a dump but nothing ever replays it. On 2026-08-13 the pm2 daemon was
# gone, the process list was empty, and the relay had been dead for hours while everything
# that reports health (MC status, the queue) looked fine — because the thing that reports
# is the thing that was down. Docker Desktop was also down, with AutoStart=false, so even a
# resurrected dispatcher would have sat in [sandbox] DOWN.
#
# Ordering matters and is deliberate: Docker first, then the egress network, then pm2. The
# dispatcher fails closed without the sandbox, so starting it last means it comes up into a
# working world instead of alerting and waiting.
#
# `pm2 resurrect` alone is not enough and never was: it restores the SAVED state, which after
# an idle sleep is `stopped`, and autorestart is false by design. This script therefore starts
# the dispatcher explicitly and exits non-zero if it is not online at the end.
#
# Safe to run any time, by hand or on a schedule. Every step is idempotent.
#   Manual:   powershell -ExecutionPolicy Bypass -File scripts\rig-boot.ps1
#   Register: see docs/runbooks/dispatcher-service.md

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$log  = Join-Path $repo 'rig-boot.log'
function Say($m) {
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  Write-Host $line
  Add-Content -Path $log -Value $line -Encoding utf8
}

# A reconcile/start step that "succeeds" over a nonzero pm2 exit code is the same failure
# shape this whole script exists to catch: success reported over a relay that never actually
# came back. Capture $LASTEXITCODE the instant the native call returns — before any other
# native command can overwrite it — log bounded output either way, and fail loudly and
# immediately (not "continue and hope verify catches it") so a broken `pm2 save` cannot leave
# a stale dump behind while the script still reports "done".
function Invoke-Pm2Step($desc, $cmdLine, $maxLines = 8) {
  Say "[rig-boot] $desc"
  $output = cmd /c $cmdLine 2>&1
  $exit = $LASTEXITCODE
  $output | Select-Object -First $maxLines | ForEach-Object { Say "  $_" }
  if ($exit -ne 0) {
    Say "[rig-boot] FAILED: $desc exited $exit; mc-dispatcher is not reconciled. Check: npx pm2 logs mc-dispatcher --err --lines 50"
    exit 1
  }
}

Say '[rig-boot] starting'
Set-Location $repo

# 1. Docker daemon — the sandbox, the egress proxy and every build depend on it.
docker info *>$null
if ($LASTEXITCODE -ne 0) {
  Say '[rig-boot] docker daemon unreachable; starting Docker Desktop'
  $dd = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
  if (Test-Path $dd) { Start-Process $dd } else { Say "[rig-boot] WARNING: not found at $dd" }

  $deadline = (Get-Date).AddMinutes(5)
  do {
    Start-Sleep -Seconds 5
    docker info *>$null
    $up = ($LASTEXITCODE -eq 0)
  } while (-not $up -and (Get-Date) -lt $deadline)

  if ($up) { Say '[rig-boot] docker daemon up' }
  else {
    # Not fatal: bring pm2 back anyway. The dispatcher's health gate will hold work and
    # alert, which beats leaving the relay entirely absent.
    Say '[rig-boot] ERROR: docker did not come up within 5 minutes; continuing to pm2'
  }
} else {
  Say '[rig-boot] docker daemon already up'
}

# 2. Egress network + allowlisting proxy (idempotent; no-ops when already present).
Say '[rig-boot] ensuring executor network + proxy'
cmd /c "npm run executor:net --silent" 2>&1 | ForEach-Object { Say "  $_" }

# 3. pm2 processes from the saved dump.
Say '[rig-boot] resurrecting pm2'
cmd /c "npx pm2 resurrect" 2>&1 | ForEach-Object { Say "  $_" }

# 4. Resurrect is NOT a start. It restores the saved state, and the saved state is stopped:
# rig-sleep stops the entry on idle and autorestart is false on purpose. So the normal wake
# came back stopped, stayed stopped, and this script logged 'done' over a relay that would
# never claim a row. Decide from the ACTUAL pm2 state, then act — idempotently, and without
# touching a dispatcher that is already up (a build runs in a blocking spawn; restarting it
# mid-build would kill the work). Anything that is NOT up is brought back from
# ecosystem.config.cjs, not from pm2's saved definition, which on this rig predates the
# on-demand relay. Decision + parsing live in scripts/lib/rig-wake.mjs so the contract is
# unit-tested (tests/rig-wake.test.ts).
$action = (cmd /c "npx pm2 jlist 2>NUL | node scripts\lib\rig-wake.mjs action" | Select-Object -Last 1)
$action = if ($action) { "$action".Trim() } else { 'start' }
switch ($action) {
  'none' {
    Say '[rig-boot] mc-dispatcher already online; leaving it alone'
  }
  'reconcile' {
    # A saved-stopped entry is a saved DEFINITION, and this rig's is pre-on-demand:
    # autorestart:true, no DISPATCHER_IDLE_SLEEP_MS. `pm2 restart --update-env` re-launches
    # that definition — --update-env re-reads the calling SHELL's env, never the config file
    # — so the woken dispatcher would never sleep and pm2 would restart it back out of every
    # rig-sleep. Delete the stale definition and start from ecosystem.config.cjs instead.
    # Safe: the entry is stopped, so nothing running is being deleted, and `pm2 save` then
    # persists the corrected dump so the next resurrect brings back the current definition.
    Say '[rig-boot] mc-dispatcher present but not online; reloading definition from ecosystem.config.cjs'
    Invoke-Pm2Step 'pm2 delete mc-dispatcher' 'npx pm2 delete mc-dispatcher' 3
    Invoke-Pm2Step 'pm2 start ecosystem.config.cjs --only mc-dispatcher' 'npx pm2 start ecosystem.config.cjs --only mc-dispatcher' 8
    Invoke-Pm2Step 'pm2 save' 'npx pm2 save' 3
  }
  default {
    # No saved entry, or pm2 state unreadable. Start from the config, never from the bare
    # script: ecosystem.config.cjs is what carries autorestart:false and the idle-sleep env.
    Say "[rig-boot] mc-dispatcher not in pm2 (action=$action); starting from ecosystem.config.cjs"
    Invoke-Pm2Step 'pm2 start ecosystem.config.cjs --only mc-dispatcher' 'npx pm2 start ecosystem.config.cjs --only mc-dispatcher' 8
    Invoke-Pm2Step 'pm2 save' 'npx pm2 save' 3
  }
}

# 5. Verify, and fail loudly if it is not up. A wake that reports success over a dead
# dispatcher is worse than no wake at all — it is what an operator stops checking.
# Brief poll: pm2 reports `launching` for a moment after a start.
$deadline = (Get-Date).AddSeconds(20)
do {
  $report = cmd /c "npx pm2 jlist 2>NUL | node scripts\lib\rig-wake.mjs verify"
  $online = ($LASTEXITCODE -eq 0)
  if (-not $online -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
} while (-not $online -and (Get-Date) -lt $deadline)
$report | ForEach-Object { Say "[rig-boot] $_" }

if (-not $online) {
  Say '[rig-boot] FAILED: mc-dispatcher is not online — nothing will be built. Check: npx pm2 logs mc-dispatcher --err --lines 50'
  exit 1
}
Say '[rig-boot] done — mc-dispatcher online'
