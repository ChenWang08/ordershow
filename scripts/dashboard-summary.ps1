[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('check','rebuild','repair')][string]$Action,
  [Parameter(Mandatory=$true)][ValidateRange(1,[long]::MaxValue)][long]$ActivityId,
  [ValidateRange(0,[long]::MaxValue)][long]$AfterOrderId=0,
  [Parameter(Mandatory=$true)][string]$ComposeFile,
  [Parameter(Mandatory=$true)][string]$Project,
  [string]$Service='backend'
)
$ErrorActionPreference='Stop'
$resolvedCompose=(Resolve-Path -LiteralPath $ComposeFile).Path
Write-Host "Project: $Project; compose: $resolvedCompose; activity: $ActivityId; action: $Action"
& docker compose --project-name $Project --file $resolvedCompose exec -T $Service java `
  '-Dloader.main=com.fengyi.ordershow.maintenance.DashboardSummaryCommand' `
  -cp /app/app.jar org.springframework.boot.loader.launch.PropertiesLauncher $Action $ActivityId $AfterOrderId
exit $LASTEXITCODE
