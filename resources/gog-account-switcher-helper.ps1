param(
    [Parameter(Mandatory = $true)][ValidateSet('BeginAdd', 'CaptureProfile', 'CancelAdd', 'SwitchProfile')][string]$Operation,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{32}$')][string]$OperationId,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9+/=]+$')][string]$DataRootB64
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$MaxBrowserFileBytes = 104857600
$ProfileIdPattern = '^[0-9a-f]{32}$'

function Decode-DataRoot {
    try { return [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($DataRootB64)) }
    catch { throw 'Invalid switcher data root.' }
}

$DataRoot = [IO.Path]::GetFullPath((Decode-DataRoot))
$normalizedRoot = $DataRoot.TrimEnd('\').ToLowerInvariant()
$allowedParents = @($env:APPDATA, $env:LOCALAPPDATA) | Where-Object { $_ } | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\').ToLowerInvariant() }
if (-not $normalizedRoot.EndsWith('\accounts\gog') -or -not ($allowedParents | Where-Object { $normalizedRoot.StartsWith($_ + '\') })) {
    throw 'Switcher data root is outside the allowed Baddel location.'
}

$ProfilesRoot = Join-Path $DataRoot 'profiles'
$RollbacksRoot = Join-Path $DataRoot 'rollbacks'
$OperationsRoot = Join-Path $DataRoot 'operations'
$ResultsRoot = Join-Path $DataRoot 'results'
$TempRoot = Join-Path $DataRoot 'temp'
$PendingFile = Join-Path $DataRoot 'pending.json'
foreach ($directory in @($DataRoot, $ProfilesRoot, $RollbacksRoot, $OperationsRoot, $ResultsRoot, $TempRoot)) {
    [IO.Directory]::CreateDirectory($directory) | Out-Null
}
$RequestPath = Join-Path $OperationsRoot ($OperationId + '.json')
$ResultPath = Join-Path $ResultsRoot ($OperationId + '.json')

function Write-AtomicJson([string]$Path, $Value) {
    $temporary = $Path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporary -Destination $Path -Force
    } finally {
        Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    }
}

function Write-Result([bool]$Success, [string]$Code, [string]$Message, $Extra = $null) {
    $value = [ordered]@{ success = $Success; code = $Code; message = $Message }
    if ($null -ne $Extra) {
        foreach ($property in $Extra.PSObject.Properties) { $value[$property.Name] = $property.Value }
    }
    Write-AtomicJson $ResultPath ([pscustomobject]$value)
}

if (-not (Test-Path -LiteralPath $RequestPath -PathType Leaf)) {
    Write-Result $false 'GOG_HELPER_REQUEST_INVALID' 'The GOG operation request is missing.'
    exit 2
}

$Request = Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json
if ([string]$Request.operation -ne $Operation -or [string]$Request.operationId -ne $OperationId) {
    Write-Result $false 'GOG_HELPER_REQUEST_INVALID' 'The GOG operation request did not match the authorized operation.'
    exit 2
}

function Assert-ProfileId([string]$Value, [string]$Field) {
    if ($Value -notmatch $ProfileIdPattern) { throw "Invalid $Field." }
    return $Value
}

$FailureCategory = 'transaction'

function Set-FailureCategory([string]$Category) {
    $script:FailureCategory = $Category
}

function Set-PathFailureCategory([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    if ($full.StartsWith($DataRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        Set-FailureCategory 'switcher-storage'
    } elseif ($full.StartsWith(([IO.Path]::GetFullPath($env:PROGRAMDATA).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) {
        Set-FailureCategory 'programdata-session'
    } else {
        Set-FailureCategory 'local-session'
    }
}

function Get-SafeFailure([System.Management.Automation.ErrorRecord]$ErrorRecord) {
    $exception = $ErrorRecord.Exception
    $isAccessDenied = $exception -is [UnauthorizedAccessException] -or
        ($exception -is [ComponentModel.Win32Exception] -and $exception.NativeErrorCode -eq 5)
    $isLocked = $exception -is [IO.IOException] -and
        ([string]$exception.Message -match 'used by another process|cannot access the file')
    if ($isLocked) {
        return [pscustomobject]@{ code = 'GOG_SESSION_FILES_LOCKED'; message = 'GOG Galaxy session files are still in use. Close Galaxy and try again.' }
    }
    if ($isAccessDenied) {
        switch ($script:FailureCategory) {
            'switcher-storage' { return [pscustomobject]@{ code = 'GOG_SWITCHER_STORAGE_ACCESS_DENIED'; message = 'Baddel cannot write its saved GOG account data for the current Windows user.' } }
            'programdata-session' { return [pscustomobject]@{ code = 'GOG_PROGRAMDATA_ACCESS_DENIED'; message = 'The current Windows user cannot update the required GOG Galaxy shared session data.' } }
            'registry' { return [pscustomobject]@{ code = 'GOG_REGISTRY_ACCESS_DENIED'; message = 'The current Windows user cannot update the GOG Galaxy account registry state.' } }
            default { return [pscustomobject]@{ code = 'GOG_LOCAL_SESSION_ACCESS_DENIED'; message = 'The current Windows user cannot update the GOG Galaxy account session.' } }
        }
    }
    return [pscustomobject]@{
        code = 'GOG_TRANSACTION_FAILED'
        message = if ($exception -and $exception.Message) { [string]$exception.Message } else { 'The GOG session transaction failed.' }
    }
}

function Protect-Bytes([byte[]]$Bytes) {
    Add-Type -AssemblyName System.Security
    [byte[]]$result = [Security.Cryptography.ProtectedData]::Protect($Bytes, [byte[]]$null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    return ,$result
}

function Unprotect-Bytes([byte[]]$Bytes) {
    Add-Type -AssemblyName System.Security
    [byte[]]$result = [Security.Cryptography.ProtectedData]::Unprotect($Bytes, [byte[]]$null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    return ,$result
}

function Get-StablePaths {
    return @(
        (Join-Path $env:LOCALAPPDATA 'GOG.com\Galaxy\Configuration\config.json'),
        (Join-Path $env:PROGRAMDATA 'GOG.com\Galaxy\storage\etags-updater.db'),
        (Join-Path $env:PROGRAMDATA 'GOG.com\Galaxy\storage\etags.db'),
        (Join-Path $env:PROGRAMDATA 'GOG.com\Galaxy\storage\galaxy-2.0.db')
    )
}

function Get-SessionRoots {
    return @(
        (Join-Path $env:PROGRAMDATA 'GOG.com\Galaxy\webcache'),
        (Join-Path $env:LOCALAPPDATA 'GOG.com\Galaxy\webcache'),
        (Join-Path $env:LOCALAPPDATA 'GOG.com\Galaxy\WebStorage'),
        (Join-Path $env:LOCALAPPDATA 'GOG.com\Galaxy\Local Storage'),
        (Join-Path $env:LOCALAPPDATA 'GOG.com\Galaxy\Session Storage'),
        (Join-Path $env:LOCALAPPDATA 'GOG.com\Galaxy\IndexedDB'),
        (Join-Path $env:LOCALAPPDATA 'GOG.com\Galaxy\Network')
    )
}

function Test-IsDisposableCachePath([string]$Path) {
    $normalized = ('\' + $Path.Replace('/', '\').Trim('\') + '\').ToLowerInvariant()
    foreach ($part in @('\cache\', '\code cache\', '\gpucache\', '\dawncache\', '\shadercache\', '\grshadercache\', '\crashpad\', '\logs\', '\log\', '\temp\', '\tmp\')) {
        if ($normalized.Contains($part)) { return $true }
    }
    return $false
}

function Get-RemoteConfigPaths {
    $appsRoot = Join-Path $env:LOCALAPPDATA 'GOG.com\Galaxy\Applications'
    if (-not (Test-Path -LiteralPath $appsRoot -PathType Container)) { return @() }
    return @(Get-ChildItem -LiteralPath $appsRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        Join-Path $_.FullName 'RemoteConfigCache\remote_config_cache_production_worldwide.json'
    })
}

# Read only the canonical GOG `userId` field from Galaxy-owned state.  The
# helper never returns the surrounding configuration/registry values because
# those may contain session credentials.  Multiple different IDs are treated
# as ambiguous and therefore unverified.
function Get-CanonicalGogIdentity {
    $ids = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    function Add-IdentityValue($Value) {
        $candidate = ([string]$Value).Trim()
        if ($candidate -match '^[0-9]{1,128}$') { [void]$ids.Add($candidate) }
    }
    function Visit-JsonValue($Value, [int]$Depth = 0) {
        if ($null -eq $Value -or $Depth -gt 20) { return }
        if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
            foreach ($item in $Value) { Visit-JsonValue $item ($Depth + 1) }
        }
        foreach ($property in @($Value.PSObject.Properties)) {
            if ($property.Name -ceq 'userId' -or $property.Name -ceq 'user_id') { Add-IdentityValue $property.Value }
            elseif ($property.Value -is [pscustomobject] -or ($property.Value -is [System.Collections.IEnumerable] -and -not ($property.Value -is [string]))) {
                Visit-JsonValue $property.Value ($Depth + 1)
            }
        }
    }
    $configPath = Join-Path $env:LOCALAPPDATA 'GOG.com\Galaxy\Configuration\config.json'
    if (Test-Path -LiteralPath $configPath -PathType Leaf) {
        try { Visit-JsonValue (Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json) }
        catch { }
    }
    $registryRoot = 'Registry::HKEY_CURRENT_USER\Software\GOG.com\Galaxy'
    if (Test-Path -LiteralPath $registryRoot) {
        foreach ($key in @((Get-Item -LiteralPath $registryRoot -ErrorAction SilentlyContinue)) + @(Get-ChildItem -LiteralPath $registryRoot -Recurse -ErrorAction SilentlyContinue)) {
            if ($null -eq $key) { continue }
            try {
                $values = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction Stop
                foreach ($name in @('userId', 'user_id')) {
                    if ($null -ne $values.PSObject.Properties[$name]) { Add-IdentityValue $values.$name }
                }
            } catch { }
        }
    }
    if ($ids.Count -ne 1) { return $null }
    return [pscustomobject]@{ platformAccountId = [string]($ids | Select-Object -First 1); identityNamespace = 'gog-user-id' }
}

function Get-CaptureEntries {
    $entries = @()
    foreach ($stable in @(Get-StablePaths)) { $entries += [pscustomobject]@{ sourcePath = [IO.Path]::GetFullPath($stable); category = 'stable' } }
    foreach ($root in @(Get-SessionRoots)) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        foreach ($file in @(Get-ChildItem -LiteralPath $root -File -Recurse -Force -ErrorAction SilentlyContinue)) {
            if (-not (Test-IsDisposableCachePath $file.FullName) -and $file.Length -le $MaxBrowserFileBytes) {
                $entries += [pscustomobject]@{ sourcePath = [IO.Path]::GetFullPath($file.FullName); category = 'browser' }
            }
        }
    }
    foreach ($remote in @(Get-RemoteConfigPaths)) { $entries += [pscustomobject]@{ sourcePath = [IO.Path]::GetFullPath($remote); category = 'remote-config' } }
    return @($entries | Sort-Object sourcePath -Unique)
}

function Test-IsAllowedRestorePath([string]$Candidate) {
    try { $full = [IO.Path]::GetFullPath($Candidate).TrimEnd('\') } catch { return $false }
    foreach ($stable in @(Get-StablePaths)) {
        if ($full.Equals([IO.Path]::GetFullPath($stable).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    foreach ($root in @(Get-SessionRoots)) {
        $allowed = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
        if ($full.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase) -and -not (Test-IsDisposableCachePath $full)) { return $true }
    }
    $appsRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'GOG.com\Galaxy\Applications')).TrimEnd('\') + '\'
    if ($full.StartsWith($appsRoot, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($full) -ieq 'remote_config_cache_production_worldwide.json') {
        $relative = $full.Substring($appsRoot.Length).Split('\')
        return $relative.Length -eq 3 -and $relative[1] -ieq 'RemoteConfigCache'
    }
    return $false
}

function Close-GalaxyProcesses {
    Set-FailureCategory 'galaxy-processes'
    foreach ($name in @('GalaxyClient', 'GalaxyCommunication', 'GOG Galaxy Notifications Renderer', 'QtWebEngineProcess')) {
        Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        $running = @('GalaxyClient', 'GalaxyCommunication', 'GOG Galaxy Notifications Renderer', 'QtWebEngineProcess') | Where-Object { Get-Process -Name $_ -ErrorAction SilentlyContinue }
        if (@($running).Count -eq 0) { return }
        Start-Sleep -Milliseconds 150
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'GOG Galaxy did not close in time.'
}

function Export-GogRegistry([string]$Destination) {
    Set-FailureCategory 'registry'
    $process = Start-Process -FilePath 'reg.exe' -ArgumentList @('export', 'HKCU\Software\GOG.com', ('"' + $Destination + '"'), '/y') -Wait -PassThru -WindowStyle Hidden
    return $process.ExitCode -eq 0 -and (Test-Path -LiteralPath $Destination -PathType Leaf)
}

function Clear-GogRegistry {
    Set-FailureCategory 'registry'
    $process = Start-Process -FilePath 'reg.exe' -ArgumentList @('delete', 'HKCU\Software\GOG.com', '/f') -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -notin @(0, 1)) { throw 'Could not clear the GOG registry state.' }
}

function Import-GogRegistry([string]$Source) {
    Set-FailureCategory 'registry'
    Clear-GogRegistry
    $process = Start-Process -FilePath 'reg.exe' -ArgumentList @('import', ('"' + $Source + '"')) -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw 'Could not restore the GOG registry state.' }
}

if (-not ('BaddelGogNativeMethods' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class BaddelGogNativeMethods {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool MoveFileEx(string existingFile, string newFile, int flags);
}
'@
}

function Move-AtomicReplace([string]$Temporary, [string]$Destination) {
    if (-not [BaddelGogNativeMethods]::MoveFileEx($Temporary, $Destination, 0x1 -bor 0x8)) {
        throw (New-Object ComponentModel.Win32Exception([Runtime.InteropServices.Marshal]::GetLastWin32Error()))
    }
}

function Capture-State([string]$Destination, [string]$Type) {
    Set-PathFailureCategory $Destination
    $parent = Split-Path -Parent $Destination
    $working = Join-Path $parent ('.capture-' + [guid]::NewGuid().ToString('N'))
    $filesDirectory = Join-Path $working 'files'
    [IO.Directory]::CreateDirectory($filesDirectory) | Out-Null
    $manifestEntries = @()
    $index = 0
    try {
        foreach ($entry in @(Get-CaptureEntries)) {
            $index++
            $storedName = '{0:D6}.bin' -f $index
            $exists = Test-Path -LiteralPath $entry.sourcePath -PathType Leaf
            if ($exists) {
                Set-PathFailureCategory $entry.sourcePath
                [byte[]]$plain = [IO.File]::ReadAllBytes($entry.sourcePath)
                [byte[]]$encrypted = Protect-Bytes $plain
                Set-PathFailureCategory $Destination
                [IO.File]::WriteAllBytes((Join-Path $filesDirectory $storedName), $encrypted)
                [Array]::Clear($plain, 0, $plain.Length)
            }
            $manifestEntries += [pscustomobject]@{ sourcePath = $entry.sourcePath; storedName = $storedName; exists = [bool]$exists; category = $entry.category }
        }
        $registryTemporary = Join-Path $TempRoot ('registry-' + [guid]::NewGuid().ToString('N') + '.reg')
        $registryExists = $false
        try {
            $registryExists = Export-GogRegistry $registryTemporary
            if ($registryExists) {
                [byte[]]$plainRegistry = [IO.File]::ReadAllBytes($registryTemporary)
                [IO.File]::WriteAllBytes((Join-Path $working 'registry.bin'), (Protect-Bytes $plainRegistry))
                [Array]::Clear($plainRegistry, 0, $plainRegistry.Length)
            }
        } finally { Remove-Item -LiteralPath $registryTemporary -Force -ErrorAction SilentlyContinue }
        Write-AtomicJson (Join-Path $working 'manifest.json') ([pscustomobject]@{ version = 3; type = $Type; createdAt = [DateTime]::UtcNow.ToString('o'); registryExists = [bool]$registryExists; files = [object[]]$manifestEntries })
        if (Test-Path -LiteralPath $Destination) { throw 'The destination GOG snapshot already exists.' }
        Move-Item -LiteralPath $working -Destination $Destination
    } catch {
        Remove-Item -LiteralPath $working -Recurse -Force -ErrorAction SilentlyContinue
        throw
    }
}

function Clear-CurrentSession {
    foreach ($stable in @(Get-StablePaths)) {
        Set-PathFailureCategory $stable
        if (Test-Path -LiteralPath $stable -PathType Leaf) { Remove-Item -LiteralPath $stable -Force -ErrorAction Stop }
    }
    foreach ($root in @(Get-SessionRoots)) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        Get-ChildItem -LiteralPath $root -File -Recurse -Force -ErrorAction SilentlyContinue | Where-Object {
            -not (Test-IsDisposableCachePath $_.FullName) -and $_.Length -le $MaxBrowserFileBytes
        } | ForEach-Object {
            Set-PathFailureCategory $_.FullName
            Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop
        }
    }
    foreach ($remote in @(Get-RemoteConfigPaths)) {
        Set-PathFailureCategory $remote
        if (Test-Path -LiteralPath $remote -PathType Leaf) { Remove-Item -LiteralPath $remote -Force -ErrorAction Stop }
    }
    Clear-GogRegistry

    $remaining = @()
    foreach ($stable in @(Get-StablePaths)) {
        if (Test-Path -LiteralPath $stable -PathType Leaf) { $remaining += $stable }
    }
    foreach ($root in @(Get-SessionRoots)) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        $remaining += @(Get-ChildItem -LiteralPath $root -File -Recurse -Force -ErrorAction SilentlyContinue | Where-Object {
            -not (Test-IsDisposableCachePath $_.FullName) -and $_.Length -le $MaxBrowserFileBytes
        } | Select-Object -ExpandProperty FullName)
    }
    foreach ($remote in @(Get-RemoteConfigPaths)) {
        if (Test-Path -LiteralPath $remote -PathType Leaf) { $remaining += $remote }
    }
    if (Test-Path -LiteralPath 'Registry::HKEY_CURRENT_USER\Software\GOG.com') {
        $remaining += 'HKCU\Software\GOG.com'
    }
    if (@($remaining).Count -gt 0) {
        throw ('GOG session cleanup left {0} persistent item(s); first: {1}' -f @($remaining).Count, [string]$remaining[0])
    }
}

function Restore-State([string]$Source) {
    $manifestPath = Join-Path $Source 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'The selected saved GOG account is incomplete.' }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ([int]$manifest.version -ne 3 -or -not ($manifest.files -is [Array])) { throw 'The saved GOG profile manifest is invalid.' }
    Clear-CurrentSession
    foreach ($entry in @($manifest.files)) {
        $destination = [string]$entry.sourcePath
        if (-not (Test-IsAllowedRestorePath $destination)) { throw 'A saved GOG profile contains a disallowed restore path.' }
        if ([string]$entry.storedName -notmatch '^\d{6}\.bin$') { throw 'A saved GOG profile contains an invalid payload name.' }
        Set-PathFailureCategory $destination
        if (-not [bool]$entry.exists) {
            if (Test-Path -LiteralPath $destination -PathType Leaf) { Remove-Item -LiteralPath $destination -Force -ErrorAction Stop }
            continue
        }
        $storedPath = Join-Path (Join-Path $Source 'files') ([string]$entry.storedName)
        if (-not (Test-Path -LiteralPath $storedPath -PathType Leaf)) { throw 'An encrypted GOG session payload is missing.' }
        [byte[]]$encrypted = [IO.File]::ReadAllBytes($storedPath)
        [byte[]]$plain = Unprotect-Bytes $encrypted
        $parent = Split-Path -Parent $destination
        [IO.Directory]::CreateDirectory($parent) | Out-Null
        $temporary = $destination + '.baddel-' + [guid]::NewGuid().ToString('N') + '.tmp'
        try {
            [IO.File]::WriteAllBytes($temporary, $plain)
            Move-AtomicReplace $temporary $destination
        } finally {
            [Array]::Clear($plain, 0, $plain.Length)
            Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
        }
    }
    Clear-GogRegistry
    if ([bool]$manifest.registryExists) {
        $registryPayload = Join-Path $Source 'registry.bin'
        if (-not (Test-Path -LiteralPath $registryPayload -PathType Leaf)) { throw 'The encrypted GOG registry payload is missing.' }
        [byte[]]$encryptedRegistry = [IO.File]::ReadAllBytes($registryPayload)
        [byte[]]$plainRegistry = Unprotect-Bytes $encryptedRegistry
        $registryTemporary = Join-Path $TempRoot ('restore-' + [guid]::NewGuid().ToString('N') + '.reg')
        try {
            [IO.File]::WriteAllBytes($registryTemporary, $plainRegistry)
            Import-GogRegistry $registryTemporary
        } finally {
            [Array]::Clear($plainRegistry, 0, $plainRegistry.Length)
            Remove-Item -LiteralPath $registryTemporary -Force -ErrorAction SilentlyContinue
        }
    }
}

function Prune-Rollbacks([string[]]$ProtectedIds = @()) {
    $keep = 8
    $items = @(Get-ChildItem -LiteralPath $RollbacksRoot -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending)
    foreach ($item in @($items | Select-Object -Skip $keep)) {
        if ($ProtectedIds -notcontains $item.Name) { Remove-Item -LiteralPath $item.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

$rollbackSucceeded = $null
$operationSucceeded = $false
$resultCode = 'GOG_TRANSACTION_FAILED'
$resultMessage = 'The GOG session transaction failed.'
$verifiedIdentity = $null
try {
    Close-GalaxyProcesses
    switch ($Operation) {
        'BeginAdd' {
            $rollbackId = Assert-ProfileId ([string]$Request.rollbackId) 'rollback ID'
            $previous = if ([string]$Request.previousActiveProfileId -match $ProfileIdPattern) { [string]$Request.previousActiveProfileId } else { $null }
            Capture-State (Join-Path $RollbacksRoot $rollbackId) 'rollback'
            $expected = if ([string]$Request.expectedPlatformAccountId -match '^[A-Za-z0-9_-]{1,128}$') { [string]$Request.expectedPlatformAccountId } else { $null }
            Write-AtomicJson $PendingFile ([pscustomobject]@{ version = 1; rollbackId = $rollbackId; startedAt = [string]$Request.startedAt; previousActiveProfileId = $previous; expectedPlatformAccountId = $expected })
            Clear-CurrentSession
            Prune-Rollbacks @($rollbackId)
        }
        'CaptureProfile' {
            $profileId = Assert-ProfileId ([string]$Request.profileId) 'profile ID'
            $verifiedIdentity = Get-CanonicalGogIdentity
            Capture-State (Join-Path $ProfilesRoot $profileId) 'account-profile'
        }
        'CancelAdd' {
            $rollbackId = Assert-ProfileId ([string]$Request.rollbackId) 'rollback ID'
            Restore-State (Join-Path $RollbacksRoot $rollbackId)
        }
        'SwitchProfile' {
            $profileId = Assert-ProfileId ([string]$Request.profileId) 'profile ID'
            $rollbackId = Assert-ProfileId ([string]$Request.rollbackId) 'rollback ID'
            Capture-State (Join-Path $RollbacksRoot $rollbackId) 'rollback'
            try {
                Clear-CurrentSession
                Restore-State (Join-Path $ProfilesRoot $profileId)
                $verifiedIdentity = Get-CanonicalGogIdentity
            } catch {
                try { Restore-State (Join-Path $RollbacksRoot $rollbackId); $rollbackSucceeded = $true }
                catch { $rollbackSucceeded = $false }
                throw
            }
            Prune-Rollbacks @($rollbackId)
        }
    }
    $operationSucceeded = $true
    $resultCode = 'OK'
    $resultMessage = 'GOG account operation completed.'
} catch {
    $operationSucceeded = $false
    $safeFailure = Get-SafeFailure $_
    $resultCode = [string]$safeFailure.code
    $resultMessage = [string]$safeFailure.message
}
$resultExtra = [ordered]@{ rollbackSucceeded = $rollbackSucceeded }
if ($null -ne $verifiedIdentity) {
    $resultExtra.platformAccountId = [string]$verifiedIdentity.platformAccountId
    $resultExtra.identityNamespace = [string]$verifiedIdentity.identityNamespace
}
Write-Result $operationSucceeded $resultCode $resultMessage ([pscustomobject]$resultExtra)
if (-not $operationSucceeded) { exit 2 }
