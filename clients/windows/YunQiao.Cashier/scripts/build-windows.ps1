param(
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
$CurrentStage = "Initialize build"

function Assert-NativeCommandSucceeded {
    param(
        [string]$Stage,
        [int]$ExitCode
    )

    if ($ExitCode -ne 0) {
        throw "$Stage failed with exit code $ExitCode."
    }
}

try {
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Solution = Join-Path $ProjectRoot "YunQiao.Cashier.sln"
$ApplicationProject = Join-Path $ProjectRoot "src\YunQiao.Cashier\YunQiao.Cashier.csproj"
$Artifacts = Join-Path $ProjectRoot "artifacts"
$PublishDirectory = Join-Path $Artifacts "publish\win-x64"
$TestResults = Join-Path $Artifacts "test-results"
$InstallerStaging = Join-Path $Artifacts "installer-staging"
$InstallerOutput = Join-Path $Artifacts "installer"

New-Item -ItemType Directory -Force -Path $Artifacts, $TestResults, $InstallerStaging, $InstallerOutput | Out-Null

$CurrentStage = "Restore solution"
dotnet restore $Solution
Assert-NativeCommandSucceeded $CurrentStage $LASTEXITCODE
$CurrentStage = "Restore win-x64 application"
dotnet restore $ApplicationProject --runtime win-x64
Assert-NativeCommandSucceeded $CurrentStage $LASTEXITCODE
$CurrentStage = "Run Windows test suite"
dotnet test $Solution --configuration Release --no-restore --logger "trx" --results-directory $TestResults
Assert-NativeCommandSucceeded $CurrentStage $LASTEXITCODE
$CurrentStage = "Publish win-x64 application"
dotnet publish $ApplicationProject `
    --configuration Release `
    --runtime win-x64 `
    --self-contained true `
    --no-restore `
    -p:PublishSingleFile=false `
    -p:DebugType=None `
    -p:DebugSymbols=false `
    --output $PublishDirectory
Assert-NativeCommandSucceeded $CurrentStage $LASTEXITCODE

$CurrentStage = "Create win-x64 ZIP"
$ZipPath = Join-Path $Artifacts "YunQiao.Cashier-win-x64.zip"
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path (Join-Path $PublishDirectory "*") -DestinationPath $ZipPath -CompressionLevel Optimal

if ($SkipInstaller) {
    Write-Host "Windows publish created at $PublishDirectory"
    exit 0
}

$CurrentStage = "Download WebView2 bootstrapper"
$Bootstrapper = Join-Path $InstallerStaging "MicrosoftEdgeWebView2Setup.exe"
Invoke-WebRequest -Uri "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile $Bootstrapper

$CurrentStage = "Locate Inno Setup"
$InnoCandidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
)
$Iscc = $InnoCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $Iscc) {
    throw "Inno Setup 6 was not found. Install it or run with -SkipInstaller."
}

$CurrentStage = "Compile Setup.exe"
& $Iscc `
    "/DSourceDir=$PublishDirectory" `
    "/DWebViewBootstrapper=$Bootstrapper" `
    "/DOutputDir=$InstallerOutput" `
    (Join-Path $ProjectRoot "installer\YunQiao.Cashier.iss")
Assert-NativeCommandSucceeded $CurrentStage $LASTEXITCODE

Write-Host "Windows publish: $ZipPath"
Write-Host "Installer: $(Join-Path $InstallerOutput 'YunQiao_Cashier_Setup.exe')"
}
catch {
    $AnnotationMessage = $_.Exception.Message.Replace("%", "%25").Replace("`r", "%0D").Replace("`n", "%0A")
    Write-Host ("::error title=Windows Cashier - {0}::{1}" -f $CurrentStage, $AnnotationMessage)
    throw
}
