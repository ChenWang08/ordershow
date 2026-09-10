[CmdletBinding()]
param(
  [ValidateSet('read','write','first','mixed','multi','dashboard','verify')][string]$Mode='read',
  [ValidateRange(1,2000)][int]$Vus=5,
  [ValidatePattern('^\d+[smh]$')][string]$Duration='3m'
)
$ErrorActionPreference='Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
  node tests/load/run.mjs $Mode $Vus $Duration
  if ($LASTEXITCODE -ne 0) { throw 'Load test failed; inspect outputs/load. Do not increase load until reviewed.' }
} finally { Pop-Location }
