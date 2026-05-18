$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$PackedExe = Join-Path $Root "dist\win-unpacked\resources\steam-runtime\baddel_bridge.exe"

Write-Host "=== Verifying packaged Steam runtime ==="

if (!(Test-Path $PackedExe)) {
  throw "Missing packaged Steam bridge exe: $PackedExe"
}

$SizeMB = [Math]::Round((Get-Item $PackedExe).Length / 1MB, 2)

if ($SizeMB -lt 5) {
  throw "Packaged Steam bridge exe looks too small: $SizeMB MB"
}

Write-Host "PASS: PACKAGED_STEAM_RUNTIME_OK"
Write-Host "Packaged bridge: $PackedExe"
Write-Host "Size: $SizeMB MB"