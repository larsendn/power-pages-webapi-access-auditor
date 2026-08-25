param(
    [string]$Version = "1.6.0.4"
)

$ErrorActionPreference = "Stop"

$solutionDirectory = Join-Path $PSScriptRoot "..\solution"
$solutionSource = Join-Path $solutionDirectory "PowerPagesWebApiFieldsAuditor\src"
$versionToken = $Version.Replace(".", "_")

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
