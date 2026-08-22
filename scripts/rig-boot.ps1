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
# mid-build would kill the work). Decision + parsing live in scripts/lib/rig-wake.mjs so the
# contract is unit-tested (tests/rig-wake.test.ts).
$action = (cmd /c "npx pm2 jlist 2>NUL | node scripts\lib\rig-wake.mjs action" | Select-Object -Last 1)
$action = if ($action) { "$action".Trim() } else { 'start' }
switch ($action) {
  'none' {
    Say '[rig-boot] mc-dispatcher already online; leaving it alone'
  }
  'restart' {
    Say '[rig-boot] mc-dispatcher present but not online; restarting'
    cmd /c "npx pm2 restart mc-dispatcher --update-env" 2>&1 | Select-Object -First 5 | ForEach-Object { Say "  $_" }
  }
  default {
    # No saved entry, or pm2 state unreadable. Start from the config, never from the bare
    # script: ecosystem.config.cjs is what carries autorestart:false and the idle-sleep env.
    Say "[rig-boot] mc-dispatcher not in pm2 (action=$action); starting from ecosystem.config.cjs"
    cmd /c "npx pm2 start ecosystem.config.cjs --only mc-dispatcher" 2>&1 | Select-Object -First 8 | ForEach-Object { Say "  $_" }
    cmd /c "npx pm2 save" 2>&1 | Select-Object -First 3 | ForEach-Object { Say "  $_" }
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
