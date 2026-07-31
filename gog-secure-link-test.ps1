$ErrorActionPreference = 'Stop'

$ProductId = '2099051765'
$AuthPath = 'C:\Users\seife\AppData\Roaming\baddel-launcher-beta\gog\accounts\53218653531616002\auth.json'

$AuthJson = Get-Content $AuthPath -Raw | ConvertFrom-Json
$ClientId = @($AuthJson.PSObject.Properties.Name)[0]
$Credential = $AuthJson.PSObject.Properties[$ClientId].Value

if (-not $Credential.access_token) {
    throw 'Access token was not found.'
}

$SecureLinkUrl = "https://content-system.gog.com/products/$ProductId/secure_link?_version=2&generation=2&path=/"

$OutputFile = Join-Path $env:TEMP "baddel-secure-link-$ProductId.json"
$CurlOutputPath = $OutputFile -replace '\\', '/'

Remove-Item $OutputFile -Force -ErrorAction SilentlyContinue

$CurlConfig = @(
    "url = `"$SecureLinkUrl`""
    'request = "GET"'
    'header = "Accept: application/json"'
    "header = `"Authorization: Bearer $($Credential.access_token)`""
    'header = "User-Agent: gogdl/1.2.2 (Heroic Games Launcher)"'
    'http1.1'
    'tlsv1.2'
    'location'
    'silent'
    'show-error'
    'connect-timeout = 20'
    'max-time = 60'
    'retry = 0'
    "output = `"$CurlOutputPath`""
    'write-out = "HTTP_STATUS=%{http_code}\nTIME=%{time_total}\nSIZE=%{size_download}\n"'
) -join "`r`n"

Write-Host ''
Write-Host '===================================='
Write-Host 'SECURE LINK TEST'
Write-Host '===================================='

$CurlResult = @(
    $CurlConfig |
        & curl.exe --config - 2>&1 |
        ForEach-Object { "$_" }
)

$CurlExitCode = $LASTEXITCODE
$CurlText = $CurlResult -join "`n"

Write-Host $CurlText
Write-Host "Curl exit code: $CurlExitCode"
Write-Host 'Response file exists:' (Test-Path $OutputFile)

$StatusMatch = [regex]::Match($CurlText, 'HTTP_STATUS=(\d{3})')
$HttpStatus = 0

if ($StatusMatch.Success) {
    $HttpStatus = [int]$StatusMatch.Groups[1].Value
}

if (-not (Test-Path $OutputFile)) {
    Write-Host 'Response parsed: False'
    exit
}

$RawBody = Get-Content $OutputFile -Raw

if ([string]::IsNullOrWhiteSpace($RawBody)) {
    Write-Host 'Response body empty: True'
    exit
}

try {
    $Response = $RawBody | ConvertFrom-Json -ErrorAction Stop
    Write-Host 'Response parsed: True'
    Write-Host 'Response fields:'
    $Response.PSObject.Properties.Name | Sort-Object

    if ($HttpStatus -eq 200) {
        $Urls = @($Response.urls)

        Write-Host ''
        Write-Host 'Secure URL count:' $Urls.Count

        $SafeRows = @(
            foreach ($Entry in $Urls) {
                $CandidateUrl = ''

                if ($Entry -is [string]) {
                    $CandidateUrl = $Entry
                }
                elseif ($Entry.url) {
                    $CandidateUrl = [string]$Entry.url
                }
                elseif ($Entry.url_format) {
                    $CandidateUrl = [string]$Entry.url_format
                }

                $HostName = ''

                if ($CandidateUrl -match '^https?://') {
                    try {
                        $HostName = ([uri]$CandidateUrl).Host
                    }
                    catch {
                        $HostName = '[INVALID URL]'
                    }
                }

                [pscustomobject]@{
                    EndpointName = $Entry.endpoint_name
                    Host         = $HostName
                    HasUrl       = [bool]$Entry.url
                    HasUrlFormat = [bool]$Entry.url_format
                    HasParams    = [bool]$Entry.parameters
                    Priority     = $Entry.priority
                }
            }
        )

        Write-Host ''
        Write-Host 'Safe endpoint summary:'
        $SafeRows | Format-Table -AutoSize
    }
    else {
        Write-Host ''
        Write-Host 'Safe error fields:'

        [pscustomobject]@{
            Status  = $HttpStatus
            Error   = $Response.error
            Code    = $Response.code
            Message = $Response.message
        } | Format-List
    }
}
catch {
    Write-Host 'Response parsed: False'
    Write-Host 'Body length:' $RawBody.Length
}

Remove-Item $OutputFile -Force -ErrorAction SilentlyContinue
