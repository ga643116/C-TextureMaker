# C-TextureMaker

離線 Windows 圖樣工作室：以 17 種可調圖樣，製作透明、可無縫平鋪的素材，並匯出 SVG 或 PNG。

[繁體中文](README.md) · [English](README.en.md) · [日本語](README.ja.md)

**v1.5.0 公開預覽** · [下載 Windows x64 便攜包](https://github.com/ga643116/C-TextureMaker/releases/download/v1.5.0/C-TextureMaker-1.5.0-win-x64.zip) · [Release](https://github.com/ga643116/C-TextureMaker/releases/tag/v1.5.0) · [原始碼](https://github.com/ga643116/C-TextureMaker)

[查看 1.5.0 更新重點](docs/releases/v1.5.0.md#繁體中文)

**本次更新**：新增 Pixel 轉換、可編輯色板、實際像素尺寸輸出，以及圖層群組、複選與拖放管理。

**功能展示 · 30 秒**

https://github.com/user-attachments/assets/21d313f7-39f2-4a93-adfb-ed1bd84d94a5

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

- 17 種圖樣：同心圓弧、半色調網點、HUD 量表、環形刻度、裝飾條碼、波形線、平行線、格點、多邊形格網、等高線、Low Poly、符號陣列、巢狀多邊形、經緯球體、工程格線、放射光束與 Pixel。
- Pixel 支援 2–256 色、自動取色／內建／自訂色板、取樣與抖色；可輸出為目前畫布或實際像素格尺寸。Ctrl+G 建立群組，支援複選、拖放排序與群組內外移動。
- 即時調整圖樣、色彩、旋轉、比例與位置；使用圖層、預設、復原／重做及 .ctm 專案。最多 16 個內容圖層，另可建立 16 個群組；工作與偏好會自動保存在本機。
- 無縫模式配合畫布週期排列圖樣；3 × 3 平鋪預覽檢查接縫，匯出仍是單格。
- 一般游標與手形工具分工，空白鍵＋拖曳可暫時移動畫布；格點與多邊形單元支援可調直徑的繪製／擦除筆刷，每一筆可一次復原。
- 共用 PNG／SVG 形狀庫可重新命名，適用於半色調、格點、多邊形格網與符號陣列；各圖層可選擇原色或依主色染色，保留透明度。
- 格點與多邊形格網支援兩點連線，可調線寬並匯出。圖片遮罩以獨立圖層保存，左下方直接調整閾值；所有圖樣改變密度或旋轉時，遮罩範圍仍固定於畫布。
- 工程格線的主格線與對角線可分別設定虛線。
- 繁體中文、English、日本語介面，以及深色／淺色主題。

## 下載與啟動

1. 下載 [C-TextureMaker-1.5.0-win-x64.zip](https://github.com/ga643116/C-TextureMaker/releases/download/v1.5.0/C-TextureMaker-1.5.0-win-x64.zip) 並完整解壓縮。
2. 開啟資料夾中的 C-TextureMaker.exe，保留旁邊的 app 資料夾與 DLL。
3. 建議將整個資料夾放在可寫入的位置；程式會在旁邊的 data 資料夾保存工作與偏好。

需要 Windows x64、.NET Framework 4.7.2 或更新版本，以及系統已安裝的 Microsoft Edge WebView2 Runtime。具備這些元件後，程式可離線使用，無需 Node.js、Python、帳號或開發伺服器。程式不會自動安裝或更新系統元件。關閉前請確認狀態列顯示「已自動儲存」；搬移或備份設計時，請另存 .ctm 專案。

## 圖樣與匯出

畫布每邊可設為 128–4096 px。PNG 支援透明或實色背景及 1×、2×、4×；輸出上限為最長邊 8192 px、總像素 32 MP，兩項限制都會套用。

程序式圖樣匯出為 SVG 向量；匯入的 PNG 會以嵌入點陣圖保留在 SVG 中，因此含 PNG 的 SVG 並非全向量。半色調、格點、多邊形格網與符號陣列可從共用形狀庫套用 PNG／SVG，可保留素材原色或依圖層主色染色，透明度保持不變。形狀庫最多 40 個素材、合計 32 MiB，單張輸入上限 4 MiB；套用後嵌入專案，從庫中移除不會破壞既有圖樣。半色調另支援透明遮罩。裝飾條碼不供掃描辨識。

在左下「圖層」按圖片按鈕新增遮罩，接受 PNG／JPG／WebP（最多 16 MiB）或 SVG（最多 4 MiB），每邊上限 8192 px。預設保留深色區域，透明區域留空；閾值與反轉可隨時調整。單擊圖片圖層可獨立移動、縮放、旋轉及水平／垂直翻轉；單格預覽可直接拖曳邊框與控制點。「圖片」模式依下方圖片或群組套用遮罩；原有全域遮罩方式仍保留，多個遮罩取交集，原有單元編輯不會被取代。來源圖片隨 .ctm 保存，並嵌入 SVG 的遮罩；PNG 匯出保留相同效果。圖片本身的邊緣不會自動無縫化，請以 3 × 3 預覽檢查接縫。

兩點連線可再次點選相同的一對單元移除，Esc 取消起點。

圖片圖層可切換「黑白遮罩」、「圖片色彩」與「顯示原圖」，原有閾值會保留。各圖樣的圖片來源可選「全圖層／圖片／無圖片」；「圖片」使用下方最近的圖片或群組，多個效果可共用基底並依圖層順序疊加。Low Poly 每個三角面獨立取色，其他圖樣將圖片色彩套入形狀。調整密度、旋轉或圖片變形後，色彩即時更新。可在「外觀」按「匯入圖片上色」直接建立色彩圖層。

Low Poly 可調頂點密度、形狀變化、主／次色、漸層角度與色彩變化。等高線的「立體填色」提供內／外陰影、範圍、距離、角度、顏色與不透明度；關閉後回到原本的線條模式。

首次「儲存專案」會選擇位置，之後直接更新同一檔案；按鈕旁箭頭或 Ctrl+Shift+S 可另存新檔。開啟既有 .ctm 後也可直接儲存。各圖層會記住每種圖樣的參數與單元編輯，隨專案保存，只有重設目前圖樣才恢復預設。

1.5.0 可開啟舊專案並保留原有圖片來源；含 Pixel 或群組的專案請使用 1.5.0 或更新版本。

## 從原始碼建置

需要 Node.js/npm 與 Python。以下命令依序安裝開發依賴、執行自動測試、建置前端與 Windows 桌面程式並打包便攜版：

    npm ci
    npm test
    npm run build
    powershell -NoProfile -ExecutionPolicy Bypass -File .\build-desktop.ps1
    python scripts/package.py

瀏覽器互動回歸測試：安裝 Playwright 與 Microsoft Edge 後，執行 `node tests/editor.browser.cjs` / `node tests/features.browser.cjs`（先執行 `npm run build`）。

第一次桌面建置會從 NuGet 取得固定版本的 WebView2 SDK。執行成品不需要建置工具或開發伺服器。

## 授權與來源

本專案自有原始碼採 [MPL-2.0](https://www.mozilla.org/MPL/2.0/)，適用範圍見 [LICENSE-SCOPE.md](LICENSE-SCOPE.md)。可商業使用；散布修改過的 MPL 涵蓋檔案時，須以 MPL-2.0 提供該等修改檔案的原始碼。完整條款見 [LICENSE](LICENSE)。

Transitions.dev 動畫與 Microsoft WebView2 元件依各自條款使用；整個成品不應被描述為只受 MPL-2.0 管轄。詳見 [第三方聲明](THIRD-PARTY-NOTICES.txt)、[Transitions.dev 授權](app/vendor/LICENSE.txt) 及便攜包中的 LICENSE-WebView2.txt。

圖樣工作流程參考 [rahoo 素材生成](https://rahoo.online/)；本機實作未複製其程式碼或圖形素材。開場生成動畫來自 [Transitions.dev 官方來源](https://github.com/Jakubantalik/transitions.dev/tree/main/skills/transitions-ui-generation)。

