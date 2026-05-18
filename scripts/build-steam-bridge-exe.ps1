$ErrorActionPreference = "Stop"

Write-Host "=== Baddel Steam Bridge PyInstaller Build - ONEFILE ==="

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$SteamSrc = Join-Path $Root "baddel-steam-integration"
$SteamSrcCode = Join-Path $SteamSrc "src"
$MessagesPath = Join-Path $SteamSrcCode "steam_network\protocol\messages"
$Requirements = Join-Path $SteamSrc "requirements\app.txt"

$Venv = Join-Path $Root "build-venv"
$WorkPath = Join-Path $Root "build-tmp"
$DistPath = Join-Path $Root "steam-runtime"

$BridgePy = Join-Path $SteamSrcCode "baddel_bridge.py"
$BridgeExe = Join-Path $DistPath "baddel_bridge.exe"

Write-Host "[1/6] Checking paths..."

if (!(Test-Path $BridgePy)) {
  throw "Missing bridge entry file: $BridgePy"
}

if (!(Test-Path $Requirements)) {
  throw "Missing requirements file: $Requirements"
}

Write-Host "[2/6] Locating Python 3.11..."

$PythonCmd = "py -3.11"
try {
  & py -3.11 --version
} catch {
  throw "Python 3.11 not found. Install Python 3.11 or make sure py -3.11 works."
}

Write-Host "[3/6] Cleaning old build output..."

Remove-Item -Recurse -Force $Venv -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $WorkPath -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $DistPath -ErrorAction SilentlyContinue
Remove-Item -Force (Join-Path $Root "baddel_bridge.spec") -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force $DistPath | Out-Null

Write-Host "[4/6] Creating build venv and installing dependencies..."

& py -3.11 -m venv $Venv

$VenvPython = Join-Path $Venv "Scripts\python.exe"

& $VenvPython -m pip install --upgrade pip
& $VenvPython -m pip install -r $Requirements pyinstaller

& $VenvPython -c "import aiohttp, certifi, cryptography, websockets, rsa, google.protobuf, dataclasses_json, vdf; print('packages OK')"

Write-Host "[5/6] Running PyInstaller ONEFILE..."

$PyInstallerArgs = @(
  "-m", "PyInstaller",
  "--noconfirm",
  "--clean",
  "--onefile",
  "--name", "baddel_bridge",
  "--distpath", $DistPath,
  "--workpath", $WorkPath,
  "--paths", $SteamSrcCode,
  "--paths", $MessagesPath,
  "--add-data", "$SteamSrcCode\steam_network;steam_network",
  "--add-data", "$SteamSrcCode\commonWeb;commonWeb",

  "--hidden-import", "aiohttp",
  "--hidden-import", "websockets",
  "--hidden-import", "rsa",
  "--hidden-import", "certifi",
  "--hidden-import", "cryptography",
  "--hidden-import", "dataclasses_json",
  "--hidden-import", "vdf",
  "--hidden-import", "google.protobuf",
  "--hidden-import", "steam_network",
  "--hidden-import", "steam_network.protocol",
  "--hidden-import", "steam_network.protocol.messages",
  "--hidden-import", "encrypted_app_ticket_pb2",
  "--hidden-import", "enums_pb2",
  "--hidden-import", "service_cloudconfigstore_pb2",
  "--hidden-import", "steammessages_auth_pb2",
  "--hidden-import", "steammessages_base_pb2",
  "--hidden-import", "steammessages_chat_pb2",
  "--hidden-import", "steammessages_client_objects_pb2",
  "--hidden-import", "steammessages_clientserver_2_pb2",
  "--hidden-import", "steammessages_clientserver_appinfo_pb2",
  "--hidden-import", "steammessages_clientserver_friends_pb2",
  "--hidden-import", "steammessages_clientserver_login_pb2",
  "--hidden-import", "steammessages_clientserver_pb2",
  "--hidden-import", "steammessages_clientserver_userstats_pb2",
  "--hidden-import", "steammessages_player_pb2",
  "--hidden-import", "steammessages_unified_base_pb2",
  "--hidden-import", "steammessages_webui_friends_pb2",
  $BridgePy
)

& $VenvPython @PyInstallerArgs

Write-Host "[6/6] Verifying exe..."

if (!(Test-Path $BridgeExe)) {
  throw "Bridge exe was not created: $BridgeExe"
}

$SizeMB = [Math]::Round((Get-Item $BridgeExe).Length / 1MB, 2)
Write-Host "PASS: BRIDGE_OK"
Write-Host "Bridge exe: $BridgeExe"
Write-Host "Bridge size: $SizeMB MB"
Write-Host "=== Build complete ==="