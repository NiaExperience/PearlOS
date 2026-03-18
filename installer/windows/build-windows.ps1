param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$PayloadRoot
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$distDir = Join-Path $repoRoot "installer\dist"

New-Item -ItemType Directory -Force -Path $distDir | Out-Null

# Placeholder artifact during development:
# - Produces a zip payload bundle that can be inspected.
# - The real Inno Setup .exe is implemented in the `windows-installer` task.
$outZip = Join-Path $distDir ("PearlOS_Payload_Windows_{0}.zip" -f $Version)
if (Test-Path $outZip) { Remove-Item $outZip -Force }

Write-Host "Creating placeholder payload zip:" $outZip
Compress-Archive -Path (Join-Path $PayloadRoot "*") -DestinationPath $outZip

Write-Host "OK. Placeholder artifact created."

