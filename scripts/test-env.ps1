[CmdletBinding()]
param(
  [ValidateSet("up", "down", "reset", "status", "logs")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"
$projectName = "order-show-e2e"
$composeFile = Join-Path $PSScriptRoot "..\docker-compose.test.yml"
$composeFile = (Resolve-Path -LiteralPath $composeFile).Path
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path

if ((Split-Path -Leaf $workspace) -ne "order_show") {
  throw "Unexpected workspace path; refusing to manage the test stack: $workspace"
}

$declaredName = Select-String -LiteralPath $composeFile -Pattern '^name:\s+order-show-e2e\s*$'
if (-not $declaredName) {
  throw "The test compose file is missing the fixed order-show-e2e project name."
}

$composeArgs = @("compose", "--project-name", $projectName, "--file", $composeFile)

switch ($Action) {
  "up" {
    & docker @composeArgs up --detach --build
    if ($LASTEXITCODE -ne 0) { throw "Failed to start the isolated test stack." }
    & docker @composeArgs ps
  }
  "down" {
    & docker @composeArgs down --remove-orphans
    if ($LASTEXITCODE -ne 0) { throw "Failed to stop the isolated test stack." }
  }
  "reset" {
    # The fixed project name and compose file are validated above. This command
    # can only target the disposable automated-test stack.
    & docker @composeArgs down --volumes --remove-orphans
    if ($LASTEXITCODE -ne 0) { throw "Failed to reset the isolated test stack." }
  }
  "logs" {
    & docker @composeArgs logs --tail 200
    if ($LASTEXITCODE -ne 0) { throw "Failed to read test stack logs." }
  }
  default {
    & docker @composeArgs ps --all
    if ($LASTEXITCODE -ne 0) { throw "Failed to read the isolated test stack status." }
  }
}

