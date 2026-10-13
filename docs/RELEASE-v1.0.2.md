C-TextureMaker 1.0.2 — Public Preview
公開プレビュー / 公開預覽

ダウンロード / Download / 下載:
https://github.com/ga643116/C-TextureMaker/releases/download/v1.0.2/C-TextureMaker-1.0.2-win-x64.zip

公開ソース / Public source / 原始碼:
https://github.com/ga643116/C-TextureMaker

ENGLISH
--------
C-TextureMaker 1.0.2 is a public preview of the offline Windows x64 pattern studio. It includes 15 procedural pattern families, SVG/PNG export, seamless tiling with a 3 × 3 preview, up to 16 layers, local autosave, and Traditional Chinese, English, and Japanese interfaces with dark and light themes.

Requirements: Windows x64, .NET Framework 4.7.2 or later, and the Microsoft Edge WebView2 Runtime installed on the system. The portable package does not install or update these components.

Verified for this preview: the automated suite passed 38/38 tests; the frontend build, JavaScript syntax checks, and Windows x64 C# compilation passed. A separate isolated headless Edge run verified the shared frontend and PNG export without page errors. This is frontend/background evidence, not native Windows window or file-dialog evidence; the user-reported native checks are listed separately below.

The user reported on 2026-10-13 that Windows maximize behavior, border operations, and native save dialogs passed manual testing. This user-reported result is separate from the headless Edge frontend evidence above.

Known test-renderer limitation: Resvg 2.6.2 fails on the specific triangle case with a 1024 × 1024 canvas, cellSize 56, shapeScale 0.85, and showGrid=true. There is no native PNG evidence for this exact v1.0.2 case. The failure is not counted as a pass and does not by itself establish a failure in the product renderer.

繁體中文
--------
C-TextureMaker 1.0.2 為離線 Windows x64 圖樣工作室的公開預覽版，包含 15 種程序式圖樣、SVG／PNG 匯出、無縫排列與 3 × 3 預覽、最多 16 個圖層、本機自動儲存，以及繁體中文、English、日本語介面與深色／淺色主題。

需求：Windows x64、.NET Framework 4.7.2 或更新版本，以及系統已安裝的 Microsoft Edge WebView2 Runtime。便攜包不會安裝或更新這些元件。

本版已確認：自動測試 38/38 通過；前端建置、JavaScript 語法檢查與 Windows x64 C# 編譯通過。另一次隔離 headless Edge 執行確認共用前端與 PNG 匯出正常，未發生 pageerror。這是前端背景證據，不是原生 Windows 視窗或儲存對話框驗證；原生操作回報另列於下。

使用者於 2026-10-13 回報 Windows 最大化、邊框操作及原生儲存視窗已實測通過。這項使用者回報與上方 headless Edge 前端驗證分開列示。

已知測試 renderer 限制：Resvg 2.6.2 在特定 triangle 案例失敗：畫布 1024 × 1024、cellSize 56、shapeScale 0.85、showGrid=true。1.0.2 尚無此精確案例的原生 PNG 證據；此失敗不計為通過，也不能單獨證明產品 renderer 失敗。

日本語
--------
C-TextureMaker 1.0.2 は、オフライン対応 Windows x64 パターンスタジオの公開プレビューです。15 種類のプロシージャルパターン、SVG／PNG 書き出し、3 × 3 プレビュー付きシームレス配置、最大 16 レイヤー、ローカル自動保存、繁体字中国語・英語・日本語の UI、ダーク／ライトテーマを含みます。

必要環境：Windows x64、.NET Framework 4.7.2 以降、システムにインストール済みの Microsoft Edge WebView2 Runtime。ポータブル版はこれらをインストールまたは更新しません。

本版で確認済み：自動テスト 38/38 件に合格し、フロントエンドのビルド、JavaScript の構文確認、Windows x64 向け C# コンパイルも通過しました。別途、隔離した headless Edge で共通フロントエンドと PNG 書き出しを確認し、ページエラーはありませんでした。これはフロントエンドの背景証拠であり、Windows ネイティブウィンドウやファイルダイアログの証拠ではありません。ユーザー報告によるネイティブ操作確認は下記に分けて記載します。

ユーザーから、2026-10-13 に Windows の最大化操作、ウィンドウ枠の操作、ネイティブ保存ダイアログを実機で確認し、合格したとの報告がありました。このユーザー報告は、上記の headless Edge フロントエンド検証とは分けて記載しています。

既知のテスト renderer の制限：Resvg 2.6.2 は canvas 1024 × 1024、cellSize 56、shapeScale 0.85、showGrid=true の特定の triangle ケースで失敗します。この v1.0.2 条件に対するネイティブ PNG の証拠はありません。この失敗は合格に数えず、それだけで製品 renderer の不具合を示すものではありません。
