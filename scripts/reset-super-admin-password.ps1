[CmdletBinding()]
param(
  [string]$ComposeFile = (Join-Path $PSScriptRoot '..\docker-compose.yml'),
  [string]$Service = 'backend'
)
$ErrorActionPreference = 'Stop'
$resolvedCompose = (Resolve-Path -LiteralPath $ComposeFile).Path
Write-Host "Compose: $resolvedCompose; service: $Service"
# Docker allocates the TTY; Java Console.readLine displays both password inputs as requested.
& docker compose --file $resolvedCompose exec $Service java `
  '-Dloader.main=com.fengyi.ordershow.maintenance.ResetSuperAdminPassword' `
  -cp /app/app.jar org.springframework.boot.loader.launch.PropertiesLauncher
exit $LASTEXITCODE
