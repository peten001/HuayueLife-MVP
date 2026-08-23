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
#define AppVersion "1.1.0"
#define AppPublisher "YunQiao"
#define AppExeName "YunQiao.Cashier.exe"

[Setup]
AppId={{8C718C1E-759A-49CE-A92B-AF40C735E462}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName=云桥收银 {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\YunQiao Cashier
DefaultGroupName=云桥收银
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=YunQiao_Cashier_Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#AppExeName}
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加快捷方式："; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#WebViewBootstrapper}"; DestDir: "{tmp}"; DestName: "MicrosoftEdgeWebView2Setup.exe"; Flags: deleteafterinstall

[Icons]
Name: "{group}\云桥收银"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\云桥收银"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{tmp}\MicrosoftEdgeWebView2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "正在安装或更新 Microsoft Edge WebView2 Runtime…"; Flags: waituntilterminated
Filename: "{app}\{#AppExeName}"; Description: "启动云桥收银"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
