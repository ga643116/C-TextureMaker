/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace CTextureMaker
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            bool smokeTest = HasArgument(args, "--smoke-test");
            bool enableDevTools = HasArgument(args, "--devtools");

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm(smokeTest, enableDevTools));
        }

        private static bool HasArgument(string[] args, string expected)
        {
            foreach (string arg in args)
            {
                if (String.Equals(arg, expected, StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }
    }

    internal sealed class MainForm : Form
    {
        private const string HostName = "c-texturemaker.local";
        private const string StartUrl = "https://c-texturemaker.local/index.html";
        private const int MaxSaveBytes = 96 * 1024 * 1024;
        private const int MaxIdLength = 128;
        private const int MaxMimeLength = 256;
        private const int WindowStyleCaption = 0x00C00000;
        private const int WindowStyleThickFrame = 0x00040000;
        private const int WindowStyleSystemMenu = 0x00080000;
        private const int WindowStyleMinimizeBox = 0x00020000;
        private const int WindowStyleMaximizeBox = 0x00010000;
        private const int DwmWindowAttributeBorderColor = 34;
        private const int WmGetMinMaxInfo = 0x0024;
        private const int WmNcCalcSize = 0x0083;
        private const int WmNcHitTest = 0x0084;
        private const int MonitorDefaultToNearest = 2;
        private const int SystemMetricXSizeFrame = 32;
        private const int SystemMetricYSizeFrame = 33;
        private const int HitTestLeft = 10;
        private const int HitTestRight = 11;
        private const int HitTestTop = 12;
        private const int HitTestTopLeft = 13;
        private const int HitTestTopRight = 14;
        private const int HitTestBottom = 15;
        private const int HitTestBottomLeft = 16;
        private const int HitTestBottomRight = 17;

        private readonly bool _smokeTest;
        private readonly bool _enableDevTools;
        private bool _closeGuardReady;
        private bool _closeRequestPending;
        private bool _allowNextUserClose;
        private volatile bool _startupFailed;
        private readonly WebView2 _webView;
        private readonly JavaScriptSerializer _serializer;
        private readonly List<MemoryStream> _blockedResponseBodies;
        private readonly Dictionary<string, string> _projectDestinations = new Dictionary<string, string>();
        private CoreWebView2Environment _environment;
        private string _appDirectory;
        private System.Threading.Timer _smokeWatchdog;
        private string _smokeStage = "starting";
        private int _smokeCompleted;
        private Color _hostBackgroundColor;

        [StructLayout(LayoutKind.Sequential)]
        private struct NativeRect
        {
            internal int Left;
            internal int Top;
            internal int Right;
            internal int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct NativePoint
        {
            internal int X;
            internal int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MinMaxInfo
        {
            internal NativePoint Reserved;
            internal NativePoint MaxSize;
            internal NativePoint MaxPosition;
            internal NativePoint MinTrackSize;
            internal NativePoint MaxTrackSize;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MonitorInfo
        {
            internal int Size;
            internal NativeRect Monitor;
            internal NativeRect Work;
            internal int Flags;
        }

        internal MainForm(bool smokeTest, bool enableDevTools)
        {
            _smokeTest = smokeTest;
            _enableDevTools = enableDevTools;
            _serializer = new JavaScriptSerializer();
            _serializer.MaxJsonLength = ((MaxSaveBytes + 2) / 3 * 4) + (64 * 1024);
            _serializer.RecursionLimit = 8;
            _blockedResponseBodies = new List<MemoryStream>();

            Text = "C-TextureMaker";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.Sizable;
            ControlBox = true;
            MinimizeBox = true;
            MaximizeBox = true;
            ShowInTaskbar = true;
            Size = new Size(1440, 960);
            MinimumSize = new Size(1080, 720);
            _hostBackgroundColor = Color.FromArgb(0xF5, 0xF5, 0xF5);
            BackColor = _hostBackgroundColor;
            try
            {
                System.Drawing.Icon appIcon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (appIcon != null)
                    Icon = appIcon;
            }
            catch
            {
            }

            _webView = new WebView2();
            _webView.Dock = DockStyle.Fill;
            _webView.BackColor = _hostBackgroundColor;
            Controls.Add(_webView);

            Shown += OnShown;
            FormClosing += OnFormClosing;
            FormClosed += OnFormClosed;
            Resize += OnWindowResize;
            if (_smokeTest)
                _smokeWatchdog = new System.Threading.Timer(OnSmokeTimeout, null, 20000, System.Threading.Timeout.Infinite);
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams parameters = base.CreateParams;
                parameters.Style &= ~WindowStyleCaption;
                parameters.Style |= WindowStyleThickFrame | WindowStyleSystemMenu | WindowStyleMinimizeBox | WindowStyleMaximizeBox;
                return parameters;
            }
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WmNcCalcSize)
            {
                NativeRect proposedWindowBounds = (NativeRect)Marshal.PtrToStructure(m.LParam, typeof(NativeRect));
                bool isMaximized = IsZoomed(m.HWnd);
                base.WndProc(ref m);
                NativeRect clientBounds = (NativeRect)Marshal.PtrToStructure(m.LParam, typeof(NativeRect));
                if (isMaximized)
                {
                    clientBounds = proposedWindowBounds;
                    m.Result = IntPtr.Zero;
                }
                else
                {
                    clientBounds.Top = proposedWindowBounds.Top;
                }
                Marshal.StructureToPtr(clientBounds, m.LParam, false);
                return;
            }

            if (m.Msg == WmGetMinMaxInfo)
            {
                base.WndProc(ref m);
                ApplyMonitorWorkingArea(m.HWnd, m.LParam);
                m.Result = IntPtr.Zero;
                return;
            }

            if (m.Msg == WmNcHitTest)
            {
                base.WndProc(ref m);
                if (WindowState == FormWindowState.Normal)
                {
                    int hitTest = GetResizeHitTest(m.HWnd, m.LParam);
                    if (hitTest != 0)
                        m.Result = new IntPtr(hitTest);
                }
                return;
            }

            base.WndProc(ref m);
        }

        private static void ApplyMonitorWorkingArea(IntPtr hwnd, IntPtr minMaxInfoPointer)
        {
            if (minMaxInfoPointer == IntPtr.Zero)
                return;

            IntPtr monitor = MonitorFromWindow(hwnd, MonitorDefaultToNearest);
            if (monitor == IntPtr.Zero)
                return;

            MonitorInfo monitorInfo = new MonitorInfo();
            monitorInfo.Size = Marshal.SizeOf(typeof(MonitorInfo));
            if (!GetMonitorInfo(monitor, ref monitorInfo))
                return;

            MinMaxInfo minMaxInfo = (MinMaxInfo)Marshal.PtrToStructure(minMaxInfoPointer, typeof(MinMaxInfo));
            minMaxInfo.MaxPosition.X = monitorInfo.Work.Left - monitorInfo.Monitor.Left;
            minMaxInfo.MaxPosition.Y = monitorInfo.Work.Top - monitorInfo.Monitor.Top;
            minMaxInfo.MaxSize.X = monitorInfo.Work.Right - monitorInfo.Work.Left;
            minMaxInfo.MaxSize.Y = monitorInfo.Work.Bottom - monitorInfo.Work.Top;
            Marshal.StructureToPtr(minMaxInfo, minMaxInfoPointer, false);
        }

        private static int GetResizeHitTest(IntPtr hwnd, IntPtr lParam)
        {
            NativeRect windowBounds;
            if (!GetWindowRect(hwnd, out windowBounds))
                return 0;

            int dpi = GetWindowDpi(hwnd);
            int borderX = GetSystemMetricForDpi(SystemMetricXSizeFrame, dpi);
            int borderY = GetSystemMetricForDpi(SystemMetricYSizeFrame, dpi);
            if (borderX <= 0 || borderY <= 0)
                return 0;

            long packedCoordinates = lParam.ToInt64();
            int cursorX = unchecked((short)(packedCoordinates & 0xFFFF));
            int cursorY = unchecked((short)((packedCoordinates >> 16) & 0xFFFF));
            bool onLeft = cursorX < windowBounds.Left + borderX;
            bool onRight = cursorX >= windowBounds.Right - borderX;
            bool onTop = cursorY < windowBounds.Top + borderY;
            bool onBottom = cursorY >= windowBounds.Bottom - borderY;

            if (onTop && onLeft)
                return HitTestTopLeft;
            if (onTop && onRight)
                return HitTestTopRight;
            if (onBottom && onLeft)
                return HitTestBottomLeft;
            if (onBottom && onRight)
                return HitTestBottomRight;
            if (onLeft)
                return HitTestLeft;
            if (onRight)
                return HitTestRight;
            if (onTop)
                return HitTestTop;
            if (onBottom)
                return HitTestBottom;
            return 0;
        }

        private static int GetWindowDpi(IntPtr hwnd)
        {
            try
            {
                uint dpi = GetDpiForWindow(hwnd);
                if (dpi != 0)
                    return (int)dpi;
            }
            catch (EntryPointNotFoundException)
            {
            }

            return 96;
        }

        private static int GetSystemMetricForDpi(int metric, int dpi)
        {
            try
            {
                return GetSystemMetricsForDpi(metric, (uint)dpi);
            }
            catch (EntryPointNotFoundException)
            {
                return GetSystemMetrics(metric);
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            ApplyNativeBorderColor(_hostBackgroundColor);
        }

        private void OnShown(object sender, EventArgs e)
        {
            WriteSmokeProgress("checking-app");
            string executableDirectory = AppDomain.CurrentDomain.BaseDirectory;
            _appDirectory = Path.Combine(executableDirectory, "app");
            string indexPath = Path.Combine(_appDirectory, "index.html");

            if (!File.Exists(indexPath))
            {
                FailStartup("找不到應用程式頁面：" + indexPath);
                return;
            }

            string dataDirectory = Path.Combine(executableDirectory, "data");
            try
            {
                EnsureWritableDirectory(dataDirectory);
                WriteSmokeProgress("creating-environment");
            }
            catch (Exception ex)
            {
                FailStartup("無法寫入程式旁的 data 資料目錄：" + ex.Message);
                return;
            }

            try
            {
                Task<CoreWebView2Environment> environmentTask = CoreWebView2Environment.CreateAsync(null, dataDirectory, null);
                environmentTask.ContinueWith(delegate(Task<CoreWebView2Environment> task)
                {
                    if (task.IsFaulted)
                    {
                        FailStartup(GetTaskError(task.Exception));
                        return;
                    }
                    if (task.IsCanceled)
                    {
                        FailStartup("WebView2 初始化已取消。");
                        return;
                    }

                    _environment = task.Result;
                    WriteSmokeProgress("creating-controller");
                    RunOnUiThread(BeginControlInitialization);
                }, TaskScheduler.Default);
            }
            catch (Exception ex)
            {
                FailStartup(ex.Message);
            }
        }

        private void BeginControlInitialization()
        {
            if (IsDisposed)
                return;

            WriteSmokeProgress("ensuring-webview-controller");

            Task controllerTask;
            try
            {
                controllerTask = _webView.EnsureCoreWebView2Async(_environment);
            }
            catch (Exception ex)
            {
                FailStartup(ex.Message);
                return;
            }

            controllerTask.ContinueWith(delegate(Task initialized)
            {
                if (initialized.IsFaulted)
                {
                    FailStartup(GetTaskError(initialized.Exception));
                    return;
                }
                if (initialized.IsCanceled)
                {
                    FailStartup("WebView2 控制項初始化已取消。");
                    return;
                }

                WriteSmokeProgress("configuring-webview");
                RunOnUiThread(ConfigureAndNavigate);
            }, TaskScheduler.Default);
        }

        private void ConfigureAndNavigate()
        {
            if (IsDisposed)
                return;
            if (_webView.CoreWebView2 == null)
            {
                FailStartup("WebView2 控制項尚未完成初始化。");
                return;
            }

            try
            {
                CoreWebView2 core = _webView.CoreWebView2;
                CoreWebView2Settings settings = core.Settings;
                settings.IsNonClientRegionSupportEnabled = true;
                settings.AreDefaultContextMenusEnabled = false;
                settings.AreDefaultScriptDialogsEnabled = false;
                settings.IsStatusBarEnabled = false;
                settings.IsZoomControlEnabled = false;
                settings.IsWebMessageEnabled = true;
                _webView.AllowExternalDrop = true;
                settings.AreDevToolsEnabled = _enableDevTools;
                _webView.DefaultBackgroundColor = _hostBackgroundColor;

                core.SetVirtualHostNameToFolderMapping(
                    HostName,
                    _appDirectory,
                    CoreWebView2HostResourceAccessKind.DenyCors);

                core.NavigationStarting += OnNavigationStarting;
                core.NewWindowRequested += OnNewWindowRequested;
                core.PermissionRequested += OnPermissionRequested;
                core.WebMessageReceived += OnWebMessageReceived;
                core.NavigationCompleted += OnNavigationCompleted;
                core.DownloadStarting += OnDownloadStarting;

                core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
                core.WebResourceRequested += OnWebResourceRequested;

                WriteSmokeProgress("navigating");
                core.Navigate(StartUrl);
            }
            catch (Exception ex)
            {
                FailStartup(ex.Message);
            }
        }

        private void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (!IsAppOrigin(e.Uri))
                e.Cancel = true;
        }

        private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
        }

        private void OnPermissionRequested(object sender, CoreWebView2PermissionRequestedEventArgs e)
        {
            e.State = CoreWebView2PermissionState.Deny;
        }

        private void OnDownloadStarting(object sender, CoreWebView2DownloadStartingEventArgs e)
        {
            e.Cancel = true;
        }

        private void OnWebResourceRequested(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            if (IsAllowedResourceRequest(e.Request.Uri, e.Request.Method))
                return;

            MemoryStream emptyBody = new MemoryStream(new byte[0]);
            _blockedResponseBodies.Add(emptyBody);
            e.Response = _environment.CreateWebResourceResponse(emptyBody, 403, "Blocked", "Content-Length: 0\r\n");
        }

        private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (!e.IsSuccess)
            {
                FailStartup("WebView2 無法載入應用程式頁面：" + e.WebErrorStatus.ToString());
                return;
            }

            if (!IsAppOrigin(Convert.ToString(_webView.Source)))
            {
                FailStartup("載入完成的頁面不是 C-TextureMaker 本機應用程式。");
                return;
            }

            if (_smokeTest)
            {
                WriteSmokeProgress("checking-bridge");
                Task<string> bridgeProbe;
                try
                {
                    bridgeProbe = _webView.CoreWebView2.ExecuteScriptAsync(
                        "document.documentElement.dataset.appReady === 'true' && Boolean(window.chrome && window.chrome.webview)");
                }
                catch (Exception ex)
                {
                    FailStartup("無法檢查 WebView2 bridge：" + ex.Message);
                    return;
                }

                bridgeProbe.ContinueWith(delegate(Task<string> task)
                {
                    if (task.IsFaulted)
                    {
                        CompleteSmokeTest(false, "無法檢查 appReady 與 WebView2 bridge：" + GetTaskError(task.Exception));
                    }
                    else if (!task.IsCanceled && String.Equals(task.Result.Trim(), "true", StringComparison.OrdinalIgnoreCase))
                    {
                        CompleteSmokeTest(true, null);
                    }
                    else
                    {
                        CompleteSmokeTest(false, "document.documentElement.dataset.appReady 或 window.chrome.webview 不可用。");
                    }
                }, TaskScheduler.Default);
            }
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (!IsAppOrigin(e.Source))
                return;

            string requestId = null;
            string messageType = null;
            try
            {
                if (String.IsNullOrEmpty(e.WebMessageAsJson) || e.WebMessageAsJson.Length > _serializer.MaxJsonLength)
                    throw new InvalidDataException("訊息超過允許大小。");

                Dictionary<string, object> message = _serializer.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
                if (message == null || !message.ContainsKey("type"))
                    return;

                messageType = ReadString(message, "type");
                if (String.Equals(messageType, "window", StringComparison.Ordinal))
                {
                    HandleWindowMessage(message);
                    return;
                }
                if (!String.Equals(messageType, "save", StringComparison.Ordinal) &&
                    !String.Equals(messageType, "open", StringComparison.Ordinal) &&
                    !String.Equals(messageType, "external", StringComparison.Ordinal))
                    return;

                requestId = ReadString(message, "id");
                ValidateRequestId(requestId);

                if (String.Equals(messageType, "save", StringComparison.Ordinal))
                    HandleSaveMessage(message, requestId);
                else if (String.Equals(messageType, "open", StringComparison.Ordinal))
                    HandleOpenRequest(message, requestId);
                else
                    HandleExternalRequest(message, requestId);
            }
            catch (Exception ex)
            {
                if (!IsValidRequestId(requestId))
                    return;

                string error = LimitErrorMessage(ex.Message);
                if (String.Equals(messageType, "open", StringComparison.Ordinal))
                    PostOpenResult(requestId, false, false, error, null, null, null);
                else if (String.Equals(messageType, "external", StringComparison.Ordinal))
                    PostExternalResult(requestId, false, error);
                else
                    PostSaveResult(requestId, false, false, error);
            }
        }

        private void HandleSaveMessage(IDictionary<string, object> message, string requestId)
        {
            string name = ReadString(message, "name");
            string mime = ReadString(message, "mime");
            string base64 = ReadString(message, "base64");
            string language = ReadOptionalString(message, "lang");
            string intent = ReadOptionalString(message, "intent");
            string projectToken = ReadOptionalString(message, "projectToken");
            bool saveAs = ReadOptionalBoolean(message, "saveAs");
            ValidateMime(mime);

            if (!String.IsNullOrEmpty(intent) && !String.Equals(intent, "project", StringComparison.Ordinal))
                throw new InvalidDataException("儲存要求類型無效。");

            string extension;
            string safeName = SanitizeFileName(name, out extension);
            int maxEncodedLength = ((MaxSaveBytes + 2) / 3) * 4;
            if (base64.Length > maxEncodedLength)
                throw new InvalidDataException("檔案超過 96 MiB 上限。");

            byte[] bytes;
            try
            {
                bytes = Convert.FromBase64String(base64);
            }
            catch (FormatException)
            {
                throw new InvalidDataException("檔案資料不是有效的 Base64。");
            }
            if (bytes.Length > MaxSaveBytes)
                throw new InvalidDataException("檔案超過 96 MiB 上限。");

            bool isProject = String.Equals(intent, "project", StringComparison.Ordinal);
            if (isProject)
            {
                if (extension != ".ctm" || !String.Equals(mime, "application/json", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("專案只能以 application/json 格式儲存為 .ctm 檔案。");

                HandleProjectSave(requestId, safeName, bytes, language, projectToken, saveAs);
                return;
            }

            SaveFileDialog dialog = new SaveFileDialog();
            dialog.Title = SaveDialogTitle(language);
            dialog.FileName = safeName;
            dialog.Filter = SaveDialogFilter(language, extension);
            dialog.FilterIndex = 1;
            dialog.DefaultExt = extension.TrimStart('.');
            dialog.AddExtension = true;
            dialog.OverwritePrompt = true;
            dialog.CheckPathExists = true;

            using (dialog)
            {
                if (dialog.ShowDialog(this) != DialogResult.OK)
                {
                    PostSaveResult(requestId, false, true, null);
                    return;
                }

                string selectedExtension = Path.GetExtension(dialog.FileName).ToLowerInvariant();
                if (!String.Equals(selectedExtension, extension, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("所選副檔名必須與原始檔案格式相同。");

                using (FileStream output = new FileStream(dialog.FileName, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    output.Write(bytes, 0, bytes.Length);
                    output.Flush();
                }
            }

            PostSaveResult(requestId, true, false, null);
        }

        private void HandleProjectSave(string requestId, string safeName, byte[] bytes, string language, string projectToken, bool saveAs)
        {
            string destinationPath = null;
            bool reuseToken = !saveAs &&
                !String.IsNullOrEmpty(projectToken) &&
                _projectDestinations.TryGetValue(projectToken, out destinationPath);

            if (!reuseToken)
            {
                SaveFileDialog dialog = new SaveFileDialog();
                dialog.Title = SaveDialogTitle(language);
                dialog.FileName = safeName;
                dialog.Filter = SaveDialogFilter(language, ".ctm");
                dialog.FilterIndex = 1;
                dialog.DefaultExt = "ctm";
                dialog.AddExtension = true;
                dialog.OverwritePrompt = true;
                dialog.CheckPathExists = true;

                using (dialog)
                {
                    if (dialog.ShowDialog(this) != DialogResult.OK)
                    {
                        PostSaveResult(requestId, false, true, null);
                        return;
                    }

                    string selectedExtension = Path.GetExtension(dialog.FileName).ToLowerInvariant();
                    if (!String.Equals(selectedExtension, ".ctm", StringComparison.Ordinal))
                        throw new InvalidDataException("專案必須儲存為 .ctm 檔案。");
                    destinationPath = dialog.FileName;
                }
            }

            AtomicProjectWriter.Write(destinationPath, bytes);

            string resultingToken = projectToken;
            if (!reuseToken)
            {
                do
                {
                    resultingToken = Guid.NewGuid().ToString("N");
                }
                while (_projectDestinations.ContainsKey(resultingToken));
                _projectDestinations.Add(resultingToken, Path.GetFullPath(destinationPath));
            }

            PostSaveResult(requestId, true, false, null, resultingToken);
        }

        private void HandleOpenRequest(IDictionary<string, object> message, string requestId)
        {
            string language = ReadOptionalString(message, "lang");
            OpenFileDialog dialog = new OpenFileDialog();
            dialog.Title = OpenDialogTitle(language);
            dialog.Filter = OpenDialogFilter(language);
            dialog.FilterIndex = 1;
            dialog.DefaultExt = "ctm";
            dialog.CheckFileExists = true;
            dialog.CheckPathExists = true;
            dialog.Multiselect = false;

            string selectedPath;
            using (dialog)
            {
                if (dialog.ShowDialog(this) != DialogResult.OK)
                {
                    PostOpenResult(requestId, false, true, null, null, null, null);
                    return;
                }
                selectedPath = dialog.FileName;
            }

            if (!String.Equals(Path.GetExtension(selectedPath), ".ctm", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("只能開啟 .ctm 專案檔。");

            FileInfo info = new FileInfo(selectedPath);
            if (info.Length > MaxSaveBytes)
                throw new InvalidDataException("檔案超過 96 MiB 上限。");

            byte[] bytes = File.ReadAllBytes(selectedPath);
            if (bytes.Length > MaxSaveBytes)
                throw new InvalidDataException("檔案超過 96 MiB 上限。");

            string token;
            do
            {
                token = Guid.NewGuid().ToString("N");
            }
            while (_projectDestinations.ContainsKey(token));
            _projectDestinations.Add(token, Path.GetFullPath(selectedPath));

            PostOpenResult(requestId, true, false, null, Path.GetFileName(selectedPath), token, Convert.ToBase64String(bytes));
        }

        private void HandleExternalRequest(IDictionary<string, object> message, string requestId)
        {
            string target = ReadString(message, "target");
            string url;
            if (String.Equals(target, "repository", StringComparison.Ordinal))
                url = "https://github.com/ga643116/C-TextureMaker";
            else if (String.Equals(target, "author", StringComparison.Ordinal))
                url = "https://github.com/ga643116";
            else
                throw new InvalidDataException("外部連結目標無效。");

            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            PostExternalResult(requestId, true, null);
        }

        private void HandleWindowMessage(IDictionary<string, object> message)
        {
            string action = ReadString(message, "action");
            if (String.Equals(action, "close-guard-ready", StringComparison.Ordinal))
            {
                _closeGuardReady = true;
            }
            else if (String.Equals(action, "close-confirmed", StringComparison.Ordinal))
            {
                if (_closeGuardReady && _closeRequestPending)
                {
                    _allowNextUserClose = true;
                    Close();
                }
            }
            else if (String.Equals(action, "close-cancelled", StringComparison.Ordinal))
            {
                if (_closeRequestPending)
                    _closeRequestPending = false;
            }
            else if (String.Equals(action, "minimize", StringComparison.Ordinal))
            {
                WindowState = FormWindowState.Minimized;
            }
            else if (String.Equals(action, "maximize", StringComparison.Ordinal))
            {
                WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
            }
            else if (String.Equals(action, "close", StringComparison.Ordinal))
            {
                Close();
            }
            else if (String.Equals(action, "state", StringComparison.Ordinal))
            {
                PostWindowState();
            }
            else if (String.Equals(action, "theme", StringComparison.Ordinal))
            {
                string theme = ReadString(message, "theme");
                if (String.Equals(theme, "light", StringComparison.Ordinal))
                    ApplyHostTheme(false);
                else if (String.Equals(theme, "dark", StringComparison.Ordinal))
                    ApplyHostTheme(true);
                else
                    throw new InvalidDataException("視窗主題無效。");
            }
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (_smokeTest || _startupFailed || !_closeGuardReady || e.CloseReason != CloseReason.UserClosing)
                return;

            if (_allowNextUserClose)
            {
                _allowNextUserClose = false;
                _closeRequestPending = false;
                return;
            }

            e.Cancel = true;
            if (_closeRequestPending)
                return;

            _closeRequestPending = true;
            PostCloseRequest();
        }

        private void PostCloseRequest()
        {
            try
            {
                CoreWebView2 core = _webView.CoreWebView2;
                if (core == null)
                {
                    _closeRequestPending = false;
                    return;
                }

                Dictionary<string, object> request = new Dictionary<string, object>();
                request["type"] = "window-close-request";
                core.PostWebMessageAsJson(_serializer.Serialize(request));
            }
            catch (ObjectDisposedException)
            {
                _closeRequestPending = false;
            }
            catch (InvalidOperationException)
            {
                _closeRequestPending = false;
            }
            catch (COMException)
            {
                _closeRequestPending = false;
            }
        }

        private void OnWindowResize(object sender, EventArgs e)
        {
            PostWindowState();
        }

        private void PostWindowState()
        {
            if (IsDisposed || Disposing || _webView == null)
                return;

            try
            {
                CoreWebView2 core = _webView.CoreWebView2;
                if (core == null)
                    return;

                Dictionary<string, object> state = new Dictionary<string, object>();
                state["type"] = "window-state";
                state["maximized"] = WindowState == FormWindowState.Maximized;
                core.PostWebMessageAsJson(_serializer.Serialize(state));
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
            catch (COMException)
            {
            }
        }

        private void ApplyHostTheme(bool dark)
        {
            _hostBackgroundColor = dark ? Color.FromArgb(0x18, 0x18, 0x18) : Color.FromArgb(0xF5, 0xF5, 0xF5);
            BackColor = _hostBackgroundColor;
            if (_webView != null)
            {
                _webView.BackColor = _hostBackgroundColor;
                if (_webView.CoreWebView2 != null)
                    _webView.DefaultBackgroundColor = _hostBackgroundColor;
            }
            ApplyNativeBorderColor(_hostBackgroundColor);
        }

        private void ApplyNativeBorderColor(Color color)
        {
            if (!IsHandleCreated)
                return;

            int colorRef = color.R | (color.G << 8) | (color.B << 16);
            try
            {
                DwmSetWindowAttribute(Handle, DwmWindowAttributeBorderColor, ref colorRef, sizeof(int));
            }
            catch (DllNotFoundException)
            {
            }
            catch (EntryPointNotFoundException)
            {
            }
        }

        [DllImport("dwmapi.dll", PreserveSig = true)]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int attributeValue, int attributeSize);

        [DllImport("user32.dll", ExactSpelling = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsZoomed(IntPtr hwnd);

        [DllImport("user32.dll", ExactSpelling = true)]
        private static extern IntPtr MonitorFromWindow(IntPtr hwnd, int flags);

        [DllImport("user32.dll", EntryPoint = "GetMonitorInfoW", ExactSpelling = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo monitorInfo);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetWindowRect(IntPtr hwnd, out NativeRect rect);

        [DllImport("user32.dll", ExactSpelling = true)]
        private static extern uint GetDpiForWindow(IntPtr hwnd);

        [DllImport("user32.dll", ExactSpelling = true)]
        private static extern int GetSystemMetricsForDpi(int metric, uint dpi);

        [DllImport("user32.dll", ExactSpelling = true)]
        private static extern int GetSystemMetrics(int metric);

        private void PostSaveResult(string requestId, bool ok, bool cancelled, string error, string projectToken = null)
        {
            if (IsDisposed || _webView.CoreWebView2 == null)
                return;

            Dictionary<string, object> result = new Dictionary<string, object>();
            result["type"] = "save-result";
            result["id"] = requestId;
            result["ok"] = ok;
            if (cancelled)
                result["cancelled"] = true;
            if (!String.IsNullOrEmpty(error))
                result["error"] = error;
            if (!String.IsNullOrEmpty(projectToken))
                result["projectToken"] = projectToken;

            _webView.CoreWebView2.PostWebMessageAsJson(_serializer.Serialize(result));
        }

        private void PostOpenResult(string requestId, bool ok, bool cancelled, string error, string name, string projectToken, string base64)
        {
            if (IsDisposed || _webView.CoreWebView2 == null)
                return;

            Dictionary<string, object> result = new Dictionary<string, object>();
            result["type"] = "open-result";
            result["id"] = requestId;
            result["ok"] = ok;
            if (cancelled)
                result["cancelled"] = true;
            if (!String.IsNullOrEmpty(error))
                result["error"] = error;
            if (!String.IsNullOrEmpty(name))
                result["name"] = name;
            if (!String.IsNullOrEmpty(projectToken))
                result["projectToken"] = projectToken;
            if (base64 != null)
                result["base64"] = base64;

            _webView.CoreWebView2.PostWebMessageAsJson(_serializer.Serialize(result));
        }

        private void PostExternalResult(string requestId, bool ok, string error)
        {
            if (IsDisposed || _webView.CoreWebView2 == null)
                return;

            Dictionary<string, object> result = new Dictionary<string, object>();
            result["type"] = "external-result";
            result["id"] = requestId;
            result["ok"] = ok;
            if (!String.IsNullOrEmpty(error))
                result["error"] = error;

            _webView.CoreWebView2.PostWebMessageAsJson(_serializer.Serialize(result));
        }

        private static string ReadString(IDictionary<string, object> message, string key)
        {
            object value;
            if (!message.TryGetValue(key, out value) || !(value is string))
                throw new InvalidDataException("訊息缺少有效的 " + key + " 欄位。");
            return (string)value;
        }

        private static string ReadOptionalString(IDictionary<string, object> message, string key)
        {
            object value;
            return message.TryGetValue(key, out value) && value is string ? (string)value : String.Empty;
        }

        private static bool ReadOptionalBoolean(IDictionary<string, object> message, string key)
        {
            object value;
            if (!message.TryGetValue(key, out value))
                return false;
            if (!(value is bool))
                throw new InvalidDataException("訊息中的 " + key + " 欄位無效。");
            return (bool)value;
        }

        private static string OpenDialogTitle(string language)
        {
            if (!String.IsNullOrEmpty(language) && language.StartsWith("zh", StringComparison.OrdinalIgnoreCase))
                return "開啟 C-TextureMaker 專案";
            if (!String.IsNullOrEmpty(language) && language.StartsWith("ja", StringComparison.OrdinalIgnoreCase))
                return "C-TextureMaker プロジェクトを開く";
            return "Open C-TextureMaker Project";
        }

        private static string OpenDialogFilter(string language)
        {
            string description;
            if (!String.IsNullOrEmpty(language) && language.StartsWith("zh", StringComparison.OrdinalIgnoreCase))
                description = "CTM 專案檔";
            else if (!String.IsNullOrEmpty(language) && language.StartsWith("ja", StringComparison.OrdinalIgnoreCase))
                description = "CTM プロジェクトファイル";
            else
                description = "CTM project files";
            return description + " (*.ctm)|*.ctm";
        }

        private static string SaveDialogTitle(string language)
        {
            if (!String.IsNullOrEmpty(language) && language.StartsWith("zh", StringComparison.OrdinalIgnoreCase))
                return "儲存 C-TextureMaker 檔案";
            if (!String.IsNullOrEmpty(language) && language.StartsWith("ja", StringComparison.OrdinalIgnoreCase))
                return "C-TextureMaker ファイルを保存";
            return "Save C-TextureMaker File";
        }

        private static string SaveDialogFilter(string language, string extension)
        {
            string format = extension.TrimStart('.').ToUpperInvariant();
            string description;
            if (!String.IsNullOrEmpty(language) && language.StartsWith("zh", StringComparison.OrdinalIgnoreCase))
                description = format + " 檔案";
            else if (!String.IsNullOrEmpty(language) && language.StartsWith("ja", StringComparison.OrdinalIgnoreCase))
                description = format + " ファイル";
            else
                description = format + " file";
            return description + " (*" + extension + ")|*" + extension;
        }

        private static void ValidateRequestId(string requestId)
        {
            if (!IsValidRequestId(requestId))
                throw new InvalidDataException("儲存要求 ID 無效。");
        }

        private static bool IsValidRequestId(string requestId)
        {
            if (String.IsNullOrEmpty(requestId) || requestId.Length > MaxIdLength)
                return false;
            foreach (char c in requestId)
            {
                if (Char.IsControl(c))
                    return false;
            }
            return true;
        }

        private static void ValidateMime(string mime)
        {
            if (String.IsNullOrEmpty(mime) || mime.Length > MaxMimeLength)
                throw new InvalidDataException("MIME 欄位無效。");
            foreach (char c in mime)
            {
                if (Char.IsControl(c))
                    throw new InvalidDataException("MIME 欄位無效。");
            }
        }

        private static string SanitizeFileName(string requestedName, out string extension)
        {
            if (String.IsNullOrEmpty(requestedName) || requestedName.Length > 1024)
                throw new InvalidDataException("檔名無效。");

            string leafName = Path.GetFileName(requestedName.Replace('/', '\\'));
            StringBuilder safe = new StringBuilder();
            char[] invalid = Path.GetInvalidFileNameChars();
            foreach (char c in leafName)
            {
                if (!Char.IsControl(c) && Array.IndexOf(invalid, c) < 0)
                    safe.Append(c);
            }

            string cleanName = safe.ToString().Trim().TrimEnd('.', ' ');
            extension = Path.GetExtension(cleanName).ToLowerInvariant();
            if (!IsAllowedExtension(extension))
                throw new InvalidDataException("只能儲存 SVG、PNG、CTM 或 JSON 檔案。");

            string stem = Path.GetFileNameWithoutExtension(cleanName).Trim().TrimEnd('.', ' ');
            if (String.IsNullOrEmpty(stem))
                stem = "texture";
            if (stem.Length > 180)
                stem = stem.Substring(0, 180);
            return stem + extension;
        }

        private static bool IsAllowedExtension(string extension)
        {
            return extension == ".svg" || extension == ".png" || extension == ".ctm" || extension == ".json";
        }

        private static bool IsAllowedResourceRequest(string value, string method)
        {
            if (String.IsNullOrEmpty(value))
                return false;

            bool readOnlyMethod = String.Equals(method, "GET", StringComparison.OrdinalIgnoreCase) ||
                String.Equals(method, "HEAD", StringComparison.OrdinalIgnoreCase);
            if (!readOnlyMethod)
                return false;

            if (value.StartsWith("data:", StringComparison.OrdinalIgnoreCase) || value.StartsWith("blob:", StringComparison.OrdinalIgnoreCase))
                return true;
            return IsAppOrigin(value);
        }

        private static bool IsAppOrigin(string value)
        {
            Uri uri;
            return Uri.TryCreate(value, UriKind.Absolute, out uri) &&
                uri.Scheme == Uri.UriSchemeHttps &&
                String.Equals(uri.Host, HostName, StringComparison.OrdinalIgnoreCase) &&
                uri.Port == 443 &&
                String.IsNullOrEmpty(uri.UserInfo);
        }

        private static void EnsureWritableDirectory(string directory)
        {
            Directory.CreateDirectory(directory);
            string probe = Path.Combine(directory, ".c-texturemaker-write-check-" + Guid.NewGuid().ToString("N") + ".tmp");
            using (FileStream stream = new FileStream(probe, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                stream.WriteByte(0);
                stream.Flush();
            }
            File.Delete(probe);
        }

        private void FailStartup(string message)
        {
            _startupFailed = true;
            string error = LimitErrorMessage(message);
            if (_smokeTest)
            {
                CompleteSmokeTest(false, error);
                return;
            }

            RunOnUiThread(delegate
            {
                if (IsDisposed)
                    return;
                MessageBox.Show(this, error, "C-TextureMaker", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            });
        }

        private void CompleteSmokeTest(bool success, string error)
        {
            if (System.Threading.Interlocked.Exchange(ref _smokeCompleted, 1) != 0)
                return;

            if (_smokeWatchdog != null)
                _smokeWatchdog.Dispose();

            Dictionary<string, object> result = new Dictionary<string, object>();
            result["status"] = success ? "PASS" : "FAIL";
            result["pageLoaded"] = success;
            result["url"] = success ? StartUrl : null;
            result["testPage"] = "application";
            result["stage"] = _smokeStage;
            result["error"] = error;
            result["timestampUtc"] = DateTime.UtcNow.ToString("o");
            Environment.ExitCode = success ? 0 : 1;

            WriteSmokeResult(result);

            RunOnUiThread(delegate
            {
                if (!IsDisposed)
                    Close();
            });
        }

        private void OnSmokeTimeout(object state)
        {
            if (System.Threading.Interlocked.Exchange(ref _smokeCompleted, 1) != 0)
                return;

            Dictionary<string, object> result = new Dictionary<string, object>();
            result["status"] = "FAIL";
            result["pageLoaded"] = false;
            result["testPage"] = "application";
            result["stage"] = _smokeStage;
            result["error"] = "Smoke test timed out after 20 seconds.";
            result["timestampUtc"] = DateTime.UtcNow.ToString("o");
            Environment.ExitCode = 1;
            WriteSmokeResult(result);
            Environment.Exit(1);
        }

        private void WriteSmokeProgress(string stage)
        {
            if (!_smokeTest || System.Threading.Interlocked.CompareExchange(ref _smokeCompleted, 0, 0) != 0)
                return;

            _smokeStage = stage;
            Dictionary<string, object> result = new Dictionary<string, object>();
            result["status"] = "RUNNING";
            result["pageLoaded"] = false;
            result["stage"] = stage;
            result["testPage"] = "application";
            result["timestampUtc"] = DateTime.UtcNow.ToString("o");
            WriteSmokeResult(result);
        }

        private void WriteSmokeResult(Dictionary<string, object> result)
        {
            try
            {
                string executableDirectory = AppDomain.CurrentDomain.BaseDirectory;
                string resultPath = Path.GetFullPath(Path.Combine(executableDirectory, "..", "..", "desktop", "smoke-result.json"));
                File.WriteAllText(resultPath, _serializer.Serialize(result), new UTF8Encoding(false));
            }
            catch
            {
                // A smoke result is best-effort when its requested output location is unavailable.
            }
        }

        private void RunOnUiThread(MethodInvoker action)
        {
            if (IsDisposed)
                return;
            if (InvokeRequired)
            {
                try
                {
                    BeginInvoke(action);
                }
                catch (InvalidOperationException)
                {
                }
            }
            else
            {
                action();
            }
        }

        private static string GetTaskError(Exception error)
        {
            while (error is AggregateException && error.InnerException != null)
                error = error.InnerException;
            return error == null ? "未知的初始化錯誤。" : error.Message;
        }

        private static string LimitErrorMessage(string message)
        {
            if (String.IsNullOrEmpty(message))
                return "發生未知錯誤。";
            return message.Length > 800 ? message.Substring(0, 800) : message;
        }

        private void OnFormClosed(object sender, FormClosedEventArgs e)
        {
            if (_smokeWatchdog != null)
                _smokeWatchdog.Dispose();
            foreach (MemoryStream body in _blockedResponseBodies)
                body.Dispose();
            _blockedResponseBodies.Clear();
            _webView.Dispose();
        }
    }

    internal static class AtomicProjectWriter
    {
        internal static void Write(string targetPath, byte[] bytes)
        {
            if (String.IsNullOrEmpty(targetPath))
                throw new InvalidDataException("專案儲存路徑無效。");
            if (bytes == null)
                throw new ArgumentNullException("bytes");

            string fullPath = Path.GetFullPath(targetPath);
            string directory = Path.GetDirectoryName(fullPath);
            string temporaryPath = Path.Combine(directory, "." + Path.GetFileName(fullPath) + "." + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                using (FileStream output = new FileStream(temporaryPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    output.Write(bytes, 0, bytes.Length);
                    output.Flush(true);
                }

                if (File.Exists(fullPath))
                    File.Replace(temporaryPath, fullPath, null);
                else
                    File.Move(temporaryPath, fullPath);
            }
            finally
            {
                if (File.Exists(temporaryPath))
                {
                    try
                    {
                        File.Delete(temporaryPath);
                    }
                    catch
                    {
                    }
                }
            }
        }
    }
}
