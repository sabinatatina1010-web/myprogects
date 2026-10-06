$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root

$data = if ($env:SABINA_DATA_DIR) { $env:SABINA_DATA_DIR } else { Join-Path $Root 'data' }
New-Item -ItemType Directory -Force -Path $data | Out-Null

$destDb = Join-Path $data 'crm.sqlite'
$seedDb = '/seed/crm.sqlite'
if (-not (Test-Path -LiteralPath $seedDb)) { $seedDb = Join-Path $Root 'crm.sqlite' }

if (-not (Test-Path -LiteralPath $destDb) -and (Test-Path -LiteralPath $seedDb)) {
  $tmp = Join-Path $data ('.seed-' + [guid]::NewGuid().ToString('n'))
  try {
    Copy-Item -LiteralPath $seedDb -Destination $tmp -Force
    Move-Item -LiteralPath $tmp -Destination $destDb
  } catch {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    throw
  }
}

& (Join-Path $Root 'server.ps1')
