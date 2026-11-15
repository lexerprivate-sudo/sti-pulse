$ErrorActionPreference = 'Continue'
$log = Join-Path $PSScriptRoot 'data\poll-task.log'
Add-Content -Path $log -Value "---- $(Get-Date -Format 'u') ----"
cd $PSScriptRoot
gh workflow run pulse.yml 2>&1 | Tee-Object -Append -FilePath $log | Out-Null
Add-Content -Path $log -Value ''
# keep log small
$lines = Get-Content $log
if ($lines.Count -gt 400) { Set-Content -Path $log -Value ($lines | Select-Object -Last 200) }
