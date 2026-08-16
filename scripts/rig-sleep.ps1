# Put the Mission Control rig to sleep: stop the dispatcher, drop the executor egress
# network, and quit Docker Desktop.
#
# WHY THIS EXISTS
# The relay is on-demand. An idle dispatcher is not free: while Docker is down every health
# probe pokes Docker Desktop into showing its "cannot connect / starting" UI, which is what
# made the operator kill Docker on 2026-08-13 and took the relay down for three days. When
# there is no work, the correct amount of running software is none.
#
# Normally invoked by the dispatcher itself on idle (DISPATCHER_IDLE_SLEEP_MS). Safe to run
# by hand any time — every step is idempotent and none of them touch build artifacts,
# Mission Control rows, or anything on disk under builds/.
#
#   npm run rig:sleep
#   powershell -ExecutionPolicy Bypass -File scripts\rig-sleep.ps1

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$log  = Join-Path $repo 'rig-boot.log'   # same log as the wake path; one timeline to read
function Say($m) {
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  Write-Host $line
  Add-Content -Path $log -Value $line -Encoding utf8
}

Say '[rig-sleep] starting'
Set-Location $repo

# The dispatcher usually spawned us and is exiting on its own. Stop the pm2 entry anyway so
# it stays stopped and nothing resurrects it behind our back.
Say '[rig-sleep] stopping mc-dispatcher'
cmd /c "npx pm2 stop mc-dispatcher" 2>&1 | Select-Object -First 3 | ForEach-Object { Say "  $_" }

# Egress proxy + --internal network. Removing them is what makes preflight() fail closed if
# anything tries to build while asleep.
Say '[rig-sleep] taking down executor network + proxy'
cmd /c "npm run executor:net:down --silent" 2>&1 | Select-Object -First 5 | ForEach-Object { Say "  $_" }

# Docker Desktop last — the two steps above need it alive.
Say '[rig-sleep] quitting Docker Desktop'
$dd = Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue
if ($dd) {
  # CloseMainWindow is the graceful path; Docker persists its own state on exit.
  $dd | ForEach-Object { $_.CloseMainWindow() | Out-Null }
  Start-Sleep -Seconds 8
  $still = Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue
  if ($still) { Say '[rig-sleep] Docker Desktop still up after graceful close; leaving it (not force-killing)' }
  else { Say '[rig-sleep] Docker Desktop closed' }
} else {
  Say '[rig-sleep] Docker Desktop not running'
}

Say '[rig-sleep] asleep. Wake with: npm run rig:wake'
