[CmdletBinding()]
param(
  [switch]$KeepEnvironment
)

$ErrorActionPreference = "Stop"
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$testEnvScript = Join-Path $PSScriptRoot "test-env.ps1"
$projectName = "order-show-e2e"
$composeFile = Join-Path $workspace "docker-compose.test.yml"

if ((Split-Path -Leaf $workspace) -ne "order_show") {
  throw "Unexpected workspace path; refusing to run automated tests: $workspace"
}
if (-not (Select-String -LiteralPath $composeFile -Pattern '^name:\s+order-show-e2e\s*$')) {
  throw "The isolated test Compose project name is missing or changed."
}

$businessDatabaseUrl = [Environment]::GetEnvironmentVariable("DB_URL")
if ($businessDatabaseUrl -and $businessDatabaseUrl -notmatch 'order_show_(e2e|test)') {
  throw "DB_URL is set to a non-test database; refusing to run."
}

$testSucceeded = $false
try {
  & $testEnvScript reset
  & $testEnvScript up

  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:8180/api/v1/actuator/health" -TimeoutSec 2
      if ($health.status -eq "UP") { $ready = $true; break }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $ready) { throw "The isolated backend did not become healthy on port 8180." }

  Push-Location $workspace
  try {
    & npm test
    if ($LASTEXITCODE -ne 0) { throw "Frontend tests failed." }

    & npm run typecheck
    if ($LASTEXITCODE -ne 0) { throw "Frontend type checking failed." }

    & npm run lint
    if ($LASTEXITCODE -ne 0) { throw "Frontend lint failed." }

    & docker run --rm `
      -e ORDER_SHOW_E2E=order-show-e2e `
      -e ORDER_SHOW_E2E_BASE_URL=http://host.docker.internal:8180/api/v1 `
      -v order-show-m2:/root/.m2 `
      -v "${workspace}:/workspace" `
      -w /workspace `
      maven:3.9.11-eclipse-temurin-21 `
      mvn -f backend/pom.xml test
    if ($LASTEXITCODE -ne 0) { throw "Backend unit/contract/E2E tests failed." }

    & node scripts/test-department-members.mjs
    if ($LASTEXITCODE -ne 0) { throw "Department member permission tests failed." }

    & node scripts/test-manual-additions.mjs
    if ($LASTEXITCODE -ne 0) { throw "Manual customer/product/attendance creation tests failed." }
  } finally {
    Pop-Location
  }

  $testSucceeded = $true
  Write-Output "All currently implemented automated tests passed in the isolated environment."
} finally {
  if (-not $KeepEnvironment) {
    & $testEnvScript reset
    if ($LASTEXITCODE -ne 0 -and $testSucceeded) { throw "Tests passed, but isolated environment cleanup failed." }
  } else {
    Write-Warning "The disposable order-show-e2e environment was intentionally kept running."
  }
}
