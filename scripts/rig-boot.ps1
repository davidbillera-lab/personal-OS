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

# 4. Report what actually came back, so the log answers "is the dispatcher working?".
# Parsed in node, NOT PowerShell: 5.1's ConvertFrom-Json is case-insensitive about keys and
# throws on pm2's env dump, which carries both `username` and `USERNAME`. node also tolerates
# the "[PM2] Spawning PM2 daemon…" banner that can precede the JSON.
$parser = @'
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const i=d.indexOf('[');
  if(i<0){console.log('WARNING: pm2 jlist produced no JSON');return}
  try{
    const p=JSON.parse(d.slice(i)).find(x=>x.name==='mc-dispatcher');
    console.log(p?`mc-dispatcher status=${p.pm2_env.status} restarts=${p.pm2_env.restart_time}`
                 :'ERROR: mc-dispatcher NOT present after resurrect');
  }catch(e){console.log('WARNING: could not parse pm2 jlist: '+e.message)}
});
'@
$parserFile = Join-Path $env:TEMP 'mc-rig-boot-parse.js'
Set-Content -Path $parserFile -Value $parser -Encoding utf8
cmd /c "npx pm2 jlist 2>NUL | node `"$parserFile`"" 2>&1 | ForEach-Object { Say "[rig-boot] $_" }
Remove-Item $parserFile -ErrorAction SilentlyContinue

Say '[rig-boot] done'
