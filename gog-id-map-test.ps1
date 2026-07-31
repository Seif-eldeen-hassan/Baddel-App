$ErrorActionPreference = 'Stop'

$Title = '9 Years of Shadows'
$GalaxyId = '56258463881831590'
$AuthPath = 'C:\Users\seife\AppData\Roaming\baddel-launcher-beta\gog\accounts\53218653531616002\auth.json'

$AuthJson = Get-Content $AuthPath -Raw | ConvertFrom-Json
$ClientId = @($AuthJson.PSObject.Properties.Name)[0]
$Credential = $AuthJson.PSObject.Properties[$ClientId].Value

if (-not $Credential.access_token) {
    throw 'GOG access token was not found.'
}

function Invoke-GogJson {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,

        [Parameter(Mandatory = $true)]
        [string]$Tag,

        [switch]$Authenticated
    )

    $SafeTag = $Tag -replace '[^a-zA-Z0-9_-]', '-'
    $OutFile = Join-Path $env:TEMP "baddel-gog-$SafeTag-$([guid]::NewGuid().ToString('N')).json"
    $CurlPath = $OutFile -replace '\\', '/'

    $ConfigLines = @(
        "url = `"$Url`""
        'request = "GET"'
        'header = "Accept: application/json"'
        'header = "User-Agent: Baddel-GOG-Diagnostic/1.0"'
        'http1.1'
        'tlsv1.2'
        'location'
        'silent'
        'show-error'
        'connect-timeout = 20'
        'max-time = 90'
        'retry = 2'
        'retry-delay = 2'
        'retry-all-errors'
        "output = `"$CurlPath`""
        'write-out = "HTTP_STATUS=%{http_code}\n"'
    )

    if ($Authenticated) {
        $ConfigLines += "header = `"Authorization: Bearer $($Credential.access_token)`""
    }

    $CurlConfig = $ConfigLines -join "`r`n"
    $CurlOutput = @($CurlConfig | & curl.exe --config - 2>&1)
    $CurlExitCode = $LASTEXITCODE
    $CurlText = $CurlOutput -join "`n"

    $StatusMatch = [regex]::Match($CurlText, 'HTTP_STATUS=(\d{3})')
    $HttpStatus = 0

    if ($StatusMatch.Success) {
        $HttpStatus = [int]$StatusMatch.Groups[1].Value
    }

    if ($CurlExitCode -ne 0) {
        Remove-Item $OutFile -Force -ErrorAction SilentlyContinue
        throw "curl failed for $Tag with exit code $CurlExitCode"
    }

    $ParsedJson = $null

    if ($HttpStatus -eq 200 -and (Test-Path $OutFile)) {
        $RawBody = Get-Content $OutFile -Raw

        if (-not [string]::IsNullOrWhiteSpace($RawBody)) {
            $ParsedJson = $RawBody | ConvertFrom-Json -ErrorAction Stop
        }
    }

    Remove-Item $OutFile -Force -ErrorAction SilentlyContinue

    return [pscustomobject]@{
        Status = $HttpStatus
        Json   = $ParsedJson
    }
}

function Get-SafeTitle {
    param($Value)

    if ($Value -is [string]) {
        return $Value
    }

    if ($null -ne $Value) {
        foreach ($Key in @('*', 'en-US', 'en', 'default')) {
            $Property = $Value.PSObject.Properties[$Key]

            if ($Property -and $Property.Value) {
                return [string]$Property.Value
            }
        }
    }

    return ''
}

Write-Host ''
Write-Host '===================================='
Write-Host '1. GamesDB mapping'
Write-Host '===================================='

$GamesDbUrl = "https://gamesdb.gog.com/platforms/gog/external_releases/$GalaxyId"
$GamesDbResult = Invoke-GogJson `
    -Url $GamesDbUrl `
    -Tag 'gamesdb' `
    -Authenticated

Write-Host 'GamesDB HTTP status:' $GamesDbResult.Status

$GamesDbGogIds = @()

if ($GamesDbResult.Status -eq 200 -and $null -ne $GamesDbResult.Json) {
    $GamesDb = $GamesDbResult.Json

    Write-Host 'GamesDB release ID:' $GamesDb.id
    Write-Host 'GamesDB game ID:' $GamesDb.game_id
    Write-Host 'Input platform:' $GamesDb.platform_id
    Write-Host 'Input external ID:' $GamesDb.external_id
    Write-Host 'Title:' (Get-SafeTitle $GamesDb.title)

    $GogReleases = @(
        $GamesDb.game.releases |
            Where-Object {
                "$($_.platform_id)" -ieq 'gog'
            }
    )

    Write-Host ''
    Write-Host 'GOG releases found in GamesDB:' $GogReleases.Count

    $GogReleases |
        ForEach-Object {
            [pscustomobject]@{
                GamesDbReleaseId = $_.id
                Platform         = $_.platform_id
                ExternalId       = $_.external_id
                ReleaseKey       = $_.release_per_platform_id
            }
        } |
        Format-Table -AutoSize

    $GamesDbGogIds = @(
        $GogReleases |
            ForEach-Object { "$($_.external_id)".Trim() } |
            Where-Object { $_ -match '^\d+$' }
    )
}

Write-Host ''
Write-Host '===================================='
Write-Host '2. GOG Catalog search'
Write-Host '===================================='

$EncodedTitle = [uri]::EscapeDataString($Title)
$CatalogUrl = "https://catalog.gog.com/v1/catalog?limit=20&query=$EncodedTitle"

$CatalogResult = Invoke-GogJson `
    -Url $CatalogUrl `
    -Tag 'catalog'

Write-Host 'Catalog HTTP status:' $CatalogResult.Status

$CatalogProducts = @()

if ($CatalogResult.Status -eq 200 -and $null -ne $CatalogResult.Json.products) {
    $CatalogProducts = @($CatalogResult.Json.products)
}

if (
    $CatalogProducts.Count -eq 0 -and
    $CatalogResult.Status -eq 200 -and
    $null -ne $CatalogResult.Json.items
) {
    $CatalogProducts = @($CatalogResult.Json.items)
}

Write-Host 'Catalog products returned:' $CatalogProducts.Count

$CatalogRows = @(
    $CatalogProducts |
        ForEach-Object {
            [pscustomobject]@{
                Id    = "$($_.id)"
                Title = Get-SafeTitle $_.title
                Slug  = "$($_.slug)"
            }
        }
)

$MatchingCatalogRows = @(
    $CatalogRows |
        Where-Object {
            $_.Title -match [regex]::Escape($Title)
        }
)

Write-Host 'Matching catalog products:' $MatchingCatalogRows.Count

$MatchingCatalogRows |
    Format-Table -AutoSize

$CatalogIds = @(
    $MatchingCatalogRows |
        ForEach-Object { "$($_.Id)".Trim() } |
        Where-Object { $_ -match '^\d+$' }
)

Write-Host ''
Write-Host '===================================='
Write-Host '3. Candidate ID tests'
Write-Host '===================================='

$CandidateIds = @(
    $GalaxyId
    $GamesDbGogIds
    $CatalogIds
) |
    ForEach-Object { "$_".Trim() } |
    Where-Object { $_ -match '^\d+$' } |
    Select-Object -Unique

Write-Host 'Candidate IDs:'
$CandidateIds

$Summary = @()

foreach ($CandidateId in $CandidateIds) {
    Write-Host ''
    Write-Host '------------------------------------'
    Write-Host 'Testing ID:' $CandidateId
    Write-Host '------------------------------------'

    $ProductUrl = "https://api.gog.com/products/$CandidateId?locale=en-US&expand=downloads"

    $ProductResult = Invoke-GogJson `
        -Url $ProductUrl `
        -Tag "product-$CandidateId" `
        -Authenticated

    $ProductTitle = ''
    $ProductSlug = ''
    $InstallerCount = 0
    $WindowsInstallerCount = 0

    if ($ProductResult.Status -eq 200 -and $null -ne $ProductResult.Json) {
        $ProductTitle = Get-SafeTitle $ProductResult.Json.title
        $ProductSlug = "$($ProductResult.Json.slug)"

        $Installers = @()

        if (
            $null -ne $ProductResult.Json.downloads -and
            $null -ne $ProductResult.Json.downloads.installers
        ) {
            $Installers = @($ProductResult.Json.downloads.installers)
        }

        $WindowsInstallers = @(
            $Installers |
                Where-Object {
                    "$($_.os)" -ieq 'windows'
                }
        )

        $InstallerCount = $Installers.Count
        $WindowsInstallerCount = $WindowsInstallers.Count

        Write-Host 'Product API title:' $ProductTitle
        Write-Host 'Product API slug:' $ProductSlug
        Write-Host 'Total installers:' $InstallerCount
        Write-Host 'Windows installers:' $WindowsInstallerCount

        $WindowsInstallers |
            ForEach-Object {
                [pscustomobject]@{
                    Id        = $_.id
                    Name      = $_.name
                    Language  = $_.language
                    Version   = $_.version
                    TotalSize = $_.total_size
                    FileCount = @($_.files).Count
                }
            } |
            Format-Table -AutoSize
    }

    Write-Host 'Product API status:' $ProductResult.Status

    $Generation2Count = $null
    $Generation1Count = $null

    foreach ($Generation in @(2, 1)) {
        $BuildUrl = "https://content-system.gog.com/products/$CandidateId/os/windows/builds?generation=$Generation&_version=2"

        $BuildResult = Invoke-GogJson `
            -Url $BuildUrl `
            -Tag "build-$CandidateId-gen$Generation" `
            -Authenticated

        $BuildCount = $null

        if ($BuildResult.Status -eq 200 -and $null -ne $BuildResult.Json) {
            $BuildItems = @()

            if ($null -ne $BuildResult.Json.items) {
                $BuildItems = @($BuildResult.Json.items)
            }

            $BuildCount = $BuildItems.Count
        }

        Write-Host "Generation $Generation status:" $BuildResult.Status
        Write-Host "Generation $Generation build count:" $BuildCount

        if ($Generation -eq 2) {
            $Generation2Count = $BuildCount
        }

        if ($Generation -eq 1) {
            $Generation1Count = $BuildCount
        }
    }

    $Summary += [pscustomobject]@{
        CandidateId       = $CandidateId
        ProductStatus     = $ProductResult.Status
        ProductTitle      = $ProductTitle
        WindowsInstallers = $WindowsInstallerCount
        Gen2Builds        = $Generation2Count
        Gen1Builds        = $Generation1Count
    }
}

Write-Host ''
Write-Host '===================================='
Write-Host 'FINAL SAFE SUMMARY'
Write-Host '===================================='

$Summary |
    Format-Table -AutoSize
