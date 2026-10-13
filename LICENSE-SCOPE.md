# 授權範圍

C-TextureMaker 1.0.2 本倉庫中由本專案創作或有權授權的內容依 Mozilla Public License 2.0（MPL-2.0）授權，完整授權原文見同目錄的 LICENSE。範圍包含自有程式原始碼、建置與專案設定、README 與 docs 內自有文件、介面圖示與圖稿，以及自有的範例和測試素材。

程式原始碼的 MPL 聲明標在 app 內自有的 MJS、CSS 與 HTML、desktop/Program.cs、scripts 內自有腳本、根目錄 build-desktop.ps1，以及 tests 內自有程式。靜態圖示、XML 設定與文件素材由本範圍說明納入，不另改檔案格式插入註解。

app/bundle.js 是建置產物；其中由自有 MPL 原始碼產生的部分維持 MPL 範圍，第三方部分仍依其原授權。app/vendor/ 的全部內容不在本專案 MPL 授權範圍內，包括內含轉場效果的 ui-generation.css，以及該檔在執行期套件中的副本。

## 第三方元件

- Transitions.dev 的程式碼與轉場效果依 app/vendor/LICENSE.txt 的獨立條款使用，並非由本專案的 MPL 授權重新授權。其禁止將該素材集合或實質部分重新包裝、轉售或發布為競爭的轉場函式庫、動效素材包或動畫套件等限制仍然適用。
- Microsoft WebView2 SDK 與便攜套件中的 Microsoft WebView2 元件依原有條款使用；套件附有 LICENSE-WebView2.txt。系統安裝的 WebView2 Runtime 是獨立元件。
- 僅供開發與測試使用的 npm 套件保留各自上游授權，且不包含在便攜執行套件中。

由第三方創作或依第三方授權取得的元件皆排除於本專案 MPL 授權之外，不會因與本程式一同散布而改變其授權。SOURCE.txt 列出 1.0.2 的原始碼標籤與 source archive。
