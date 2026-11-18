# 熱量與營養日記

單頁式的飲食紀錄網站：記錄每天吃的東西、熱量與三大營養素，可以用 Gemini 協助估算，也能記錄體重與飲水。
沒有後端，所有資料都存在你自己的瀏覽器裡。

## 功能

- **飲食紀錄**：熱量、蛋白質、碳水、脂肪；可編輯、刪除（含復原）、複製前一天或單一餐點到今天。
- **快速輸入**：最近吃過的食物、台灣常見食物清單，並可用份量倍數（×0.5、×1.5 等）調整。
- **AI 估算**：拍照、相簿選圖、掃描營養標示或文字描述，交給 Gemini 估算熱量與營養素。估算結果只是參考，送出前可以修改。
- **每日目標**：熱量達標區間（目標值為區間中間值）、三大營養素、飲水杯數；也可由身高、體重、活動量估算建議值（Mifflin-St Jeor 公式，非醫療建議）。
- **走勢**：近 7 / 30 日攝取圖表；體重走勢圖。
- **目標體重進度**：設定目標體重後，顯示還差多少、進度條，並依近 30 日走勢粗估達成時間（至少 3 筆、橫跨 7 天才會估算）。
- **PWA**：可安裝到手機主畫面，離線也能使用（AI 估算仍需網路）。
- **深色模式**：跟隨系統、淺色、深色。
- **備份**：匯出 / 匯入 JSON；超過 7 天沒備份會提醒。

## 使用方式

1. 開啟網站（建議用 GitHub Pages 的 https 網址）。
2. 要使用 AI 估算：右上角「設定」填入 [Gemini API Key](https://aistudio.google.com/apikey)。
3. 手機可從瀏覽器選單「安裝」或「加入主畫面」。

## 資料與隱私

- 飲食、體重、飲水與設定存在瀏覽器的 `localStorage`，不會上傳到任何伺服器；換瀏覽器或清除網站資料就會消失，請定期用「備份」匯出。
- **API Key 也存在這個瀏覽器的 `localStorage`**，只會送往 Google Gemini API，不會包含在匯出的備份檔中。任何能操作你瀏覽器的人或惡意外掛都有機會讀到它，建議在 Google AI Studio 為這把 Key 設定用量上限，且不要與其他服務共用。
- 使用 AI 估算時，照片與文字會送到 Google。免費方案的內容可能被 Google 用於改善產品，請避免上傳不想被看到的照片。

## 安全設計

- 所有輸出都跳脫；Gemini 回傳的內容視為不可信資料，並驗證數值範圍。
- 匯入檔案會驗證結構與數值、限制大小，覆蓋前需確認。
- Content-Security-Policy：`script-src 'self'`（不允許 inline script，HTML 也不使用 `onclick` 等屬性，改用 `data-click` 事件委派）、`connect-src` 只允許本站與 `generativelanguage.googleapis.com`。
  `style-src-attr 'unsafe-inline'` 仍保留，因為部分元素以 `style=""` 設定尺寸；這只影響樣式，不能執行程式。

## 檔案結構

| 檔案 | 用途 |
| --- | --- |
| `index.html` | 頁面結構 |
| `style.css` | 樣式與淺色 / 深色主題變數 |
| `app.js` | 所有邏輯 |
| `theme-init.js` | 在畫面繪製前套用主題，避免閃白 |
| `sw.js` | Service Worker（離線快取） |
| `manifest.webmanifest`, `icons/` | PWA 設定與圖示 |
| `tests/` | 測試 |

## 部署

純靜態網站，將上述檔案放在 repo 根目錄，用 GitHub Pages 發布即可。
Service Worker 對頁面與程式檔採「網路優先、離線時用快取」，更新後不會新舊檔混用；若新增了需要離線的檔案，請把它加入 `sw.js` 的 `ASSETS` 並調高 `CACHE` 版本號。

## 開發與測試

```
npm install
npm test            # jsdom 行為測試
npm run test:e2e    # Chrome 端對端測試（需 playwright 與 Chrome）
```

端對端測試會啟動本機伺服器，驗證 Service Worker、離線載入、CSP 與深色模式。
若 Chrome 不在預設位置，請修改 `tests/e2e_chrome.py` 中的 `executable_path`。

## 已知限制

- 熱量與營養素（尤其 AI 估算）是估計值，誤差可能不小。
- 資料只存在單一瀏覽器，沒有跨裝置同步。
- 目標達成時間只是依近期趨勢的直線外推。
