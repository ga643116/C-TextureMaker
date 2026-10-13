# C-TextureMaker

離線 Windows 圖樣工作室：以 15 種可調程序式圖樣，製作透明、可無縫平鋪的素材，並匯出 SVG 或 PNG。

[繁體中文](README.md) · [English](README.en.md) · [日本語](README.ja.md)

**v1.0.2 公開預覽** · [下載 Windows x64 便攜包](https://github.com/ga643116/C-TextureMaker/releases/download/v1.0.2/C-TextureMaker-1.0.2-win-x64.zip) · [Release](https://github.com/ga643116/C-TextureMaker/releases/tag/v1.0.2) · [原始碼](https://github.com/ga643116/C-TextureMaker)

目前 main 原始碼為 **1.1.0**；上述公開下載仍為 **v1.0.2**。

![繁體中文深色主題工作區](docs/media/workspace-zh-dark.png)

<details>
<summary>更多工作區畫面</summary>

![English 淺色主題工作區](docs/media/workspace-en-light.png)

![日文介面匯出面板](docs/media/export-ja.png)

</details>

**等高線生成** — 觀察等高線由參數生成的過程。

![等高線生成動圖](docs/media/generation-contours.gif)

**無縫匯出** — 檢視單格圖樣與無縫平鋪結果。

![無縫匯出動圖](docs/media/seamless-export.gif)

## 功能

- 15 種圖樣：同心圓弧、半色調網點、HUD 量表、環形刻度、裝飾條碼、波形線、平行線、格點、多邊形格網、等高線、符號陣列、巢狀多邊形、經緯球體、工程格線與放射光束。
- 即時調整圖樣、色彩、旋轉、比例與位置；使用圖層、預設、復原／重做及 .ctm 專案。最多 16 個圖層；工作與偏好會自動保存在本機。
- 無縫模式配合畫布週期排列圖樣；3 × 3 平鋪預覽檢查接縫，匯出仍是單格。
- 一般游標與手形工具分工，空白鍵＋拖曳可暫時移動畫布；格點與多邊形單元支援可調直徑的繪製／擦除筆刷，每一筆可一次復原。
- 共用 PNG／SVG 形狀庫適用於半色調、格點、多邊形格網與符號陣列；工程格線的主格線與對角線可分別設定虛線。
- 繁體中文、English、日本語介面，以及深色／淺色主題。

## 下載與啟動

1. 下載 [C-TextureMaker-1.0.2-win-x64.zip](https://github.com/ga643116/C-TextureMaker/releases/download/v1.0.2/C-TextureMaker-1.0.2-win-x64.zip) 並完整解壓縮。
2. 開啟資料夾中的 C-TextureMaker.exe，保留旁邊的 app 資料夾與 DLL。
3. 建議將整個資料夾放在可寫入的位置；程式會在旁邊的 data 資料夾保存工作與偏好。

需要 Windows x64、.NET Framework 4.7.2 或更新版本，以及系統已安裝的 Microsoft Edge WebView2 Runtime。具備這些元件後，程式可離線使用，無需 Node.js、Python、帳號或開發伺服器。程式不會自動安裝或更新系統元件。關閉前請確認狀態列顯示「已自動儲存」；搬移或備份設計時，請另存 .ctm 專案。

## 圖樣與匯出

畫布每邊可設為 128–4096 px。PNG 支援透明或實色背景及 1×、2×、4×；輸出上限為最長邊 8192 px、總像素 32 MP，兩項限制都會套用。

程序式圖樣匯出為 SVG 向量；匯入的 PNG 會以嵌入點陣圖保留在 SVG 中，因此含 PNG 的 SVG 並非全向量。半色調、格點、多邊形格網與符號陣列可從共用形狀庫套用 PNG／SVG，保留素材原色與透明度。形狀庫最多 40 個素材、合計 32 MiB，單張輸入上限 4 MiB；套用後嵌入專案，從庫中移除不會破壞既有圖樣。半色調另支援透明遮罩。裝飾條碼不供掃描辨識。

## 從原始碼建置

需要 Node.js/npm 與 Python。以下命令依序安裝開發依賴、執行自動測試、建置前端與 Windows 桌面程式並打包便攜版：

    npm ci
    npm test
    npm run build
    powershell -NoProfile -ExecutionPolicy Bypass -File .\build-desktop.ps1
    python scripts/package.py

瀏覽器互動回歸測試：安裝 Playwright 與 Microsoft Edge 後，執行 `node tests/editor.browser.cjs`（先執行 `npm run build`）。

第一次桌面建置會從 NuGet 取得固定版本的 WebView2 SDK。執行成品不需要建置工具或開發伺服器。

## 授權與來源

本專案自有原始碼採 [MPL-2.0](https://www.mozilla.org/MPL/2.0/)，適用範圍見 [LICENSE-SCOPE.md](LICENSE-SCOPE.md)。可商業使用；散布修改過的 MPL 涵蓋檔案時，須以 MPL-2.0 提供該等修改檔案的原始碼。完整條款見 [LICENSE](LICENSE)。

Transitions.dev 動畫與 Microsoft WebView2 元件依各自條款使用；整個成品不應被描述為只受 MPL-2.0 管轄。詳見 [第三方聲明](THIRD-PARTY-NOTICES.txt)、[Transitions.dev 授權](app/vendor/LICENSE.txt) 及便攜包中的 LICENSE-WebView2.txt。

圖樣工作流程參考 [rahoo 素材生成](https://rahoo.online/)；本機實作未複製其程式碼或圖形素材。開場生成動畫來自 [Transitions.dev 官方來源](https://github.com/Jakubantalik/transitions.dev/tree/main/skills/transitions-ui-generation)。
