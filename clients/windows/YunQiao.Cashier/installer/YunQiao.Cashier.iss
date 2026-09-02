#ifndef SourceDir
  #define SourceDir "..\artifacts\publish\win-x64"
#endif
#ifndef WebViewBootstrapper
  #define WebViewBootstrapper "..\artifacts\installer-staging\MicrosoftEdgeWebView2Setup.exe"
#endif
#ifndef OutputDir
  #define OutputDir "..\artifacts\installer"
#endif

#define AppName "YunQiao Cashier"
#ifndef AppVersion
  #define AppVersion "1.2.2"
#endif
#define AppPublisher "YunQiao"
#define AppExeName "YunQiao.Cashier.exe"
#define BrandingDir "..\assets"

[Setup]
AppId={{8C718C1E-759A-49CE-A92B-AF40C735E462}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL=https://cashier.huayueyouxuan.com/
AppSupportURL=https://cashier.huayueyouxuan.com/
AppComments=YunQiao Windows 收银与打印终端
DefaultDirName={localappdata}\Programs\YunQiao Cashier
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableWelcomePage=no
OutputDir={#OutputDir}
OutputBaseFilename=YunQiao_Cashier_Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#BrandingDir}\YunQiao.Cashier.ico
WizardImageFile={#BrandingDir}\installer-wizard.png
WizardSmallImageFile={#BrandingDir}\installer-small.png
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}
CloseApplications=yes
RestartApplications=no
SetupLogging=yes
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} Installer
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}
VersionInfoVersion={#AppVersion}.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#WebViewBootstrapper}"; DestDir: "{tmp}"; DestName: "MicrosoftEdgeWebView2Setup.exe"; Flags: deleteafterinstall

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; Comment: "{#AppName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; Comment: "{#AppName}"

[InstallDelete]
Type: files; Name: "{autodesktop}\云桥收银.lnk"
Type: filesandordirs; Name: "{autoprograms}\云桥收银"

[Run]
Filename: "{tmp}\MicrosoftEdgeWebView2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "正在安装或更新 Microsoft Edge WebView2 Runtime…"; Flags: waituntilterminated
Filename: "{app}\{#AppExeName}"; Description: "启动 {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
