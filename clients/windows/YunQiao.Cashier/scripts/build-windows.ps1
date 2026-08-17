param(
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Solution = Join-Path $ProjectRoot "YunQiao.Cashier.sln"
$ApplicationProject = Join-Path $ProjectRoot "src\YunQiao.Cashier\YunQiao.Cashier.csproj"
$Artifacts = Join-Path $ProjectRoot "artifacts"
$PublishDirectory = Join-Path $Artifacts "publish\win-x64"
$TestResults = Join-Path $Artifacts "test-results"
$InstallerStaging = Join-Path $Artifacts "installer-staging"
$InstallerOutput = Join-Path $Artifacts "installer"

New-Item -ItemType Directory -Force -Path $Artifacts, $TestResults, $InstallerStaging, $InstallerOutput | Out-Null

dotnet restore $Solution
dotnet restore $ApplicationProject --runtime win-x64
dotnet test $Solution --configuration Release --no-restore --logger "trx" --results-directory $TestResults
dotnet publish $ApplicationProject `
    --configuration Release `
    --runtime win-x64 `
    --self-contained true `
    --no-restore `
    -p:PublishSingleFile=false `
    -p:DebugType=None `
    -p:DebugSymbols=false `
    --output $PublishDirectory

$ZipPath = Join-Path $Artifacts "YunQiao.Cashier-win-x64.zip"
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path (Join-Path $PublishDirectory "*") -DestinationPath $ZipPath -CompressionLevel Optimal

if ($SkipInstaller) {
    Write-Host "Windows publish created at $PublishDirectory"
    exit 0
}

$Bootstrapper = Join-Path $InstallerStaging "MicrosoftEdgeWebView2Setup.exe"
Invoke-WebRequest -Uri "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile $Bootstrapper

$InnoCandidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
)
$Iscc = $InnoCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $Iscc) {
    throw "Inno Setup 6 was not found. Install it or run with -SkipInstaller."
}

& $Iscc `
    "/DSourceDir=$PublishDirectory" `
    "/DWebViewBootstrapper=$Bootstrapper" `
    "/DOutputDir=$InstallerOutput" `
    (Join-Path $ProjectRoot "installer\YunQiao.Cashier.iss")

Write-Host "Windows publish: $ZipPath"
Write-Host "Installer: $(Join-Path $InstallerOutput 'YunQiao_Cashier_Setup.exe')"
