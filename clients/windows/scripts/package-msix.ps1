<#
.SYNOPSIS
  Publish the Windows app and pack it into an MSIX signed with Azure Artifact Signing.

.DESCRIPTION
  Runs on Windows with the .NET 10 SDK, the Windows SDK tools (makepri.exe, makeappx.exe
  and signtool.exe) and the Artifact Signing Client Tools. Steps:
    1. dotnet publish (self-contained, win-x64 or win-arm64)
    2. copy the publish output and Package.appxmanifest into a staging folder
    3. makepri: index the scaled and target-size icons into resources.pri
    4. makeappx pack
    5. signtool sign through Artifact Signing, with the account and certificate profile
       in signing-metadata.json and the signer's Azure CLI sign-in, then verify

  Nothing here embeds credentials: signing uses the Azure CLI sign-in of whoever runs it.

.EXAMPLE
  .\scripts\package-msix.ps1 -Architecture x64

.EXAMPLE
  .\scripts\package-msix.ps1 -SdkBin C:\tools\sdk-buildtools\bin\10.0.28000.0\x64
#>
param(
  [ValidateSet("x64", "arm64")] [string] $Architecture = "x64",
  [string] $Configuration = "Release",
  # A folder holding makeappx.exe, makepri.exe and signtool.exe, such as the x64 folder of
  # the Microsoft.Windows.SDK.BuildTools NuGet package. Defaults to the newest installed
  # Windows SDK.
  [string] $SdkBin,
  [string] $SigningMetadata = (Join-Path $PSScriptRoot "signing-metadata.json"),
  [string] $Dlib = (Join-Path $env:LOCALAPPDATA "Microsoft\MicrosoftArtifactSigningClientTools\Azure.CodeSigning.Dlib.dll"),
  # Artifact Signing certificates last three days, so signatures need a timestamp to stay
  # valid after that. This is the timestamp authority Microsoft recommends for them.
  [string] $TimestampUrl = "http://timestamp.acs.microsoft.com",
  [switch] $Unsigned
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root "Umbrel\Umbrel.csproj"
$dist = Join-Path $root "dist"
$publishDir = Join-Path $dist "publish-$Architecture"
$stageDir = Join-Path $dist "stage-$Architecture"

if (-not $SdkBin) {
  $sdkVersion = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^10\.' } | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $sdkVersion) { throw "No Windows SDK found. Install it or pass -SdkBin." }
  $SdkBin = Join-Path $sdkVersion.FullName "x64"
}
$makeappx = Join-Path $SdkBin "makeappx.exe"
$makepri = Join-Path $SdkBin "makepri.exe"
$signtool = Join-Path $SdkBin "signtool.exe"
if (-not $Unsigned) {
  if (-not (Test-Path $Dlib)) { throw "Artifact Signing Client Tools not found at $Dlib. Install them (winget install Microsoft.Azure.ArtifactSigningClientTools) or pass -Dlib." }
  if (-not (Test-Path $SigningMetadata)) { throw "Signing metadata not found at $SigningMetadata." }
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null
Remove-Item -Recurse -Force $publishDir, $stageDir -ErrorAction SilentlyContinue

# Self-contained: Windows doesn't include .NET 10 and an MSIX can't install it, so the
# package carries its own runtime.
dotnet publish $project -c $Configuration -r "win-$Architecture" --self-contained true -o $publishDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $publishDir "*") $stageDir
Copy-Item -Force (Join-Path $root "Umbrel\Package.appxmanifest") (Join-Path $stageDir "AppxManifest.xml")

# Keep the manifest's ProcessorArchitecture in step with the build.
$manifestPath = Join-Path $stageDir "AppxManifest.xml"
(Get-Content $manifestPath -Raw) -replace 'ProcessorArchitecture="[a-z0-9]+"', "ProcessorArchitecture=`"$Architecture`"" |
  Set-Content $manifestPath -Encoding utf8

[xml] $manifest = Get-Content $manifestPath
$version = $manifest.Package.Identity.Version
$msix = Join-Path $dist "Umbrel-$version-$Architecture.msix"
Remove-Item -Force $msix -ErrorAction SilentlyContinue

# The scale- and targetsize- qualified icons in Assets are only used through a package
# resource index (MSIX "Generate a PRI file using MakePri"). The config stays outside the package.
$priConfig = Join-Path $dist "priconfig.xml"
& $makepri createconfig /cf $priConfig /dq en-US /o
if ($LASTEXITCODE -ne 0) { throw "makepri createconfig failed" }
# The default config splits the scale variants into resources.scale-*.pri files, which only
# take effect as resource packages in a bundle. Without <packaging>, this single package's
# resources.pri indexes every scale.
$config = [xml](Get-Content $priConfig -Raw)
$packaging = $config.SelectSingleNode("/resources/packaging")
if ($packaging) { [void]$config.DocumentElement.RemoveChild($packaging) }
$config.Save($priConfig)
& $makepri new /pr $stageDir /cf $priConfig /of (Join-Path $stageDir "resources.pri") /o
if ($LASTEXITCODE -ne 0) { throw "makepri new failed" }

& $makeappx pack /d $stageDir /p $msix /o
if ($LASTEXITCODE -ne 0) { throw "makeappx failed" }

if ($Unsigned) {
  Write-Warning "Unsigned package: Windows refuses to install it."
} else {
  & $signtool sign /v /fd SHA256 /tr $TimestampUrl /td SHA256 /dlib $Dlib /dmdf $SigningMetadata $msix
  if ($LASTEXITCODE -ne 0) { throw "signtool sign failed" }
  & $signtool verify /pa $msix
  if ($LASTEXITCODE -ne 0) { throw "signtool verify failed" }
}

Write-Host "Packaged $msix"
