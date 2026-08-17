using System.Windows;
using System.Windows.Threading;
using YunQiao.Cashier.Logging;

namespace YunQiao.Cashier;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        AppLog.Initialize();
        DispatcherUnhandledException += OnDispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += (_, args) => AppLog.Error("APP_UNHANDLED", args.ExceptionObject as Exception);
        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            AppLog.Error("TASK_UNOBSERVED", args.Exception);
            args.SetObserved();
        };
        AppLog.Info("APP_START", $"os={Environment.OSVersion.VersionString}");
    }

    private static void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        AppLog.Error("UI_UNHANDLED", e.Exception);
        MessageBox.Show("云桥收银发生异常，请查看本地日志后重启应用。", "云桥收银", MessageBoxButton.OK, MessageBoxImage.Error);
        e.Handled = true;
    }
}
