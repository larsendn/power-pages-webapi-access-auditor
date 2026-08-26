param(
    [string]$Version = "1.6.0.14"
)

$ErrorActionPreference = "Stop"

$solutionDirectory = Join-Path $PSScriptRoot "..\solution"
$solutionSource = Join-Path $solutionDirectory "PowerPagesWebApiFieldsAuditor\src"
$versionToken = $Version.Replace(".", "_")
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$distDirectory = Join-Path $projectRoot "dist"
$canvasAppsDirectory = Join-Path $solutionSource "CanvasApps"
$canvasAppName = "ppwfa_powerpageswebapifieldsauditor_7b9ba"
$codeAppPackageDirectory = Join-Path $canvasAppsDirectory "${canvasAppName}_CodeAppPackages"
$canvasAppMetadataPath = Join-Path $canvasAppsDirectory "${canvasAppName}.meta.xml"

Push-Location $projectRoot
try {
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "The code app production build failed."
    }
} finally {
    Pop-Location
}

if (-not (Test-Path (Join-Path $distDirectory "index.html"))) {
    throw "The code app build did not produce dist\index.html."
}

Remove-Item $codeAppPackageDirectory -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $codeAppPackageDirectory -Force | Out-Null
Copy-Item (Join-Path $distDirectory "*") $codeAppPackageDirectory -Recurse -Force

[xml]$canvasAppMetadata = Get-Content $canvasAppMetadataPath -Raw
$canvasAppMetadata.CanvasApp.AppVersion = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
$packageUris = $canvasAppMetadata.CanvasApp.CodeAppPackageUris
while ($packageUris.HasChildNodes) {
    [void]$packageUris.RemoveChild($packageUris.FirstChild)
}
$contentTypes = @{
    ".html" = "text/html"
    ".js" = "application/javascript"
    ".css" = "text/css"
    ".png" = "image/png"
    ".svg" = "image/svg+xml"
}
Get-ChildItem $codeAppPackageDirectory -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relativePath = [IO.Path]::GetRelativePath($codeAppPackageDirectory, $_.FullName).Replace("\", "/")
    $contentType = $contentTypes[$_.Extension.ToLowerInvariant()]
    if (-not $contentType) { $contentType = "application/octet-stream" }
    $uri = $canvasAppMetadata.CreateElement("CodeAppPackageUri")
    $uri.InnerText = "/CanvasApps/${canvasAppName}_CodeAppPackages/${relativePath}_ContentType_${contentType}"
    [void]$packageUris.AppendChild($uri)
}
$canvasAppMetadata.Save($canvasAppMetadataPath)

& (Join-Path $PSScriptRoot "build-solution-flows.ps1") -SolutionSource $solutionSource -Version $Version

$staticBindings = Get-ChildItem (Join-Path $solutionSource "Workflows") -Filter "*.json" |
    Select-String -Pattern '"entityName"\s*:\s*"(?!@concat\()' -CaseSensitive:$false
if ($staticBindings) {
    $details = $staticBindings | ForEach-Object { "$($_.Path):$($_.LineNumber) $($_.Line.Trim())" }
    throw "Universal workflows contain static Dataverse table bindings:`n$($details -join "`n")"
}

$manifestPath = Join-Path $solutionSource "Other\Solution.xml"
try {
    foreach ($packageType in @("Managed", "Unmanaged")) {
        [xml]$manifestXml = Get-Content $manifestPath -Raw
        $manifestXml.ImportExportXml.SolutionManifest.Managed = if ($packageType -eq "Managed") { "1" } else { "0" }
        $manifestXml.Save($manifestPath)

        $suffix = $packageType.ToLowerInvariant()
        $zipPath = Join-Path $solutionDirectory "PowerPagesWebApiFieldsAuditor_${versionToken}_$suffix.zip"
        pac solution pack --zipfile $zipPath --folder $solutionSource --packagetype $packageType --allowDelete true --allowWrite true --clobber
        if ($LASTEXITCODE -ne 0) {
            throw "PAC failed to pack the universal solution as $packageType."
        }
    }
} finally {
    [xml]$manifestXml = Get-Content $manifestPath -Raw
    $manifestXml.ImportExportXml.SolutionManifest.Managed = "0"
    $manifestXml.Save($manifestPath)
}

Get-ChildItem $solutionDirectory -Filter "PowerPagesWebApiFieldsAuditor_${versionToken}_*.zip" |
    Sort-Object Name |
    Select-Object Name, Length, @{ Name = "SHA256"; Expression = { (Get-FileHash $_.FullName -Algorithm SHA256).Hash } }
