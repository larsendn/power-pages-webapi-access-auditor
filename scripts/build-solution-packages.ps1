param(
    [string]$Version = "1.6.0.19",
    [Parameter(Mandatory = $true)]
    [Guid]$SolutionId,
    [string]$SolutionUniqueName = "PowerPagesWebApiFieldsAuditor"
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$solutionDirectory = Join-Path $projectRoot "solution"
$versionToken = $Version.Replace(".", "_")
$forbiddenValues = @($env:PPWFA_PRIVACY_FORBIDDEN_VALUES -split ";" | Where-Object { $_.Trim() })
$powerConfigPath = Join-Path $projectRoot "power.config.json"

if (-not (Test-Path $powerConfigPath)) {
    throw "power.config.json is required to identify the Code App environment."
}

$environmentId = (Get-Content $powerConfigPath -Raw | ConvertFrom-Json).environmentId
$parsedEnvironmentId = [Guid]::Empty
if (-not [Guid]::TryParse($environmentId, [ref]$parsedEnvironmentId)) {
    throw "power.config.json must contain a valid environmentId."
}
$environmentId = $parsedEnvironmentId.ToString()

if ($forbiddenValues.Count -eq 0) {
    throw "Set PPWFA_PRIVACY_FORBIDDEN_VALUES to source-environment identifiers before exporting."
}

function Assert-LastCommandSucceeded {
    param([string]$Message)

    if ($LASTEXITCODE -ne 0) {
        throw $Message
    }
}

function Assert-PrivacySafeArchive {
    param([string]$ArchivePath)

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    $findingCategories = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $genericPatterns = @{
        "Dataverse organization URL" = '(?i)https?://[^\s"''<>]*\.crm\d*\.dynamics\.com'
        "Email address" = '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b'
        "JWT-like token" = '\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}'
        "GitHub token" = '\bgh[opusr]_[A-Za-z0-9]{20,}\b'
        "Assigned secret" = '(?i)\b(client[_-]?secret|access[_-]?token|password)\b\s*[=:]\s*(["''])[^"'']{8,}\2'
    }

    try {
        foreach ($entry in $archive.Entries) {
            $stream = $entry.Open()
            try {
                $memory = [IO.MemoryStream]::new()
                $stream.CopyTo($memory)
                $bytes = $memory.ToArray()
            } finally {
                $stream.Dispose()
            }

            $searchableContent = @(
                $entry.FullName,
                [Text.Encoding]::UTF8.GetString($bytes),
                [Text.Encoding]::Unicode.GetString($bytes)
            ) -join "`n"
            $genericSearchableContent = $searchableContent -replace '(?i)https://org\.crm\.dynamics\.com', ""

            foreach ($forbiddenValue in $forbiddenValues) {
                if ($searchableContent.IndexOf($forbiddenValue, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                    [void]$findingCategories.Add("Configured source-environment value")
                    break
                }
            }

            foreach ($pattern in $genericPatterns.GetEnumerator()) {
                if ($genericSearchableContent -match $pattern.Value) {
                    [void]$findingCategories.Add($pattern.Key)
                }
            }
        }
    } finally {
        $archive.Dispose()
    }

    if ($findingCategories.Count -gt 0) {
        $categories = [string]::Join(", ", $findingCategories)
        throw "Privacy audit rejected the export. Categories: $categories. No matched values were printed."
    }
}

function Assert-ReleaseArchive {
    param(
        [string]$ArchivePath,
        [string]$ExpectedVersion,
        [bool]$ExpectedManaged
    )

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $solutionEntry = $archive.GetEntry("solution.xml")
        $customizationsEntry = $archive.GetEntry("customizations.xml")
        if (-not $solutionEntry -or -not $customizationsEntry) {
            throw "Release archive is missing required solution metadata."
        }

        $solutionReader = [IO.StreamReader]::new($solutionEntry.Open())
        try {
            [xml]$solutionXml = $solutionReader.ReadToEnd()
        } finally {
            $solutionReader.Dispose()
        }

        $manifest = $solutionXml.ImportExportXml.SolutionManifest
        $expectedManagedValue = if ($ExpectedManaged) { "1" } else { "0" }
        if ($manifest.Version -ne $ExpectedVersion -or $manifest.Managed -ne $expectedManagedValue) {
            throw "Release archive version or managed state is incorrect."
        }

        $workflowCount = @($archive.Entries | Where-Object { $_.FullName -match '^Workflows/.+\.json$' }).Count
        if ($workflowCount -ne 7) {
            throw "Release archive must contain exactly seven workflow definitions."
        }

        $customizationsReader = [IO.StreamReader]::new($customizationsEntry.Open())
        try {
            $customizations = $customizationsReader.ReadToEnd()
        } finally {
            $customizationsReader.Dispose()
        }

        if ($customizations -match '<MissingDependency\b') {
            throw "Release archive contains missing dependencies."
        }

        $uriMatches = [regex]::Matches(
            $customizations,
            '<CodeAppPackageUri>(.*?)</CodeAppPackageUri>',
            [Text.RegularExpressions.RegexOptions]::Singleline
        )
        if ($uriMatches.Count -eq 0 -or $uriMatches[0].Groups[1].Value -notmatch '/index\.html_ContentType_text/html$') {
            throw "Code App index.html must be the first package URI."
        }

        foreach ($uriMatch in $uriMatches) {
            $packageUri = [Net.WebUtility]::HtmlDecode($uriMatch.Groups[1].Value)
            $entryPath = ($packageUri -replace '^/', '') -replace '_ContentType_.+$', ''
            if (-not $archive.GetEntry($entryPath)) {
                throw "A declared Code App package file is missing from the archive."
            }
        }
    } finally {
        $archive.Dispose()
    }
}

Push-Location $projectRoot
try {
    npm test
    Assert-LastCommandSucceeded "Tests failed."
    npm run lint
    Assert-LastCommandSucceeded "Lint failed."
    npm run build
    Assert-LastCommandSucceeded "The code app production build failed."

    pac solution online-version --environment $environmentId --solution-name $SolutionUniqueName --solution-version $Version
    Assert-LastCommandSucceeded "Updating the online solution version failed."

    npx pa app push --solution-id $SolutionId
    Assert-LastCommandSucceeded "The supported Code App publish failed."

    $temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ("PPWFA-release-" + [Guid]::NewGuid())
    New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

    try {
        $exports = @(
            @{ Type = "managed"; Managed = $true },
            @{ Type = "unmanaged"; Managed = $false }
        )

        foreach ($export in $exports) {
            $fileName = "PowerPagesWebApiFieldsAuditor_${versionToken}_$($export.Type).zip"
            $temporaryPath = Join-Path $temporaryDirectory $fileName
            $arguments = @("solution", "export", "--environment", $environmentId, "--name", $SolutionUniqueName, "--path", $temporaryPath, "--overwrite")
            if ($export.Managed) {
                $arguments += "--managed"
            }

            & pac @arguments
            Assert-LastCommandSucceeded "Official $($export.Type) solution export failed."
            if (-not (Test-Path $temporaryPath)) {
                throw "Official $($export.Type) solution export did not create an archive."
            }
            Assert-PrivacySafeArchive $temporaryPath
            Assert-ReleaseArchive $temporaryPath $Version $export.Managed
        }

        foreach ($export in $exports) {
            $fileName = "PowerPagesWebApiFieldsAuditor_${versionToken}_$($export.Type).zip"
            Move-Item (Join-Path $temporaryDirectory $fileName) (Join-Path $solutionDirectory $fileName) -Force
        }
    } finally {
        Remove-Item $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
} finally {
    Pop-Location
}

Get-ChildItem $solutionDirectory -Filter "PowerPagesWebApiFieldsAuditor_${versionToken}_*.zip" |
    Sort-Object Name |
    Select-Object Name, Length, @{ Name = "SHA256"; Expression = { (Get-FileHash $_.FullName -Algorithm SHA256).Hash } }