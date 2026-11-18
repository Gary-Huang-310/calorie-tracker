const TAIWAN_FOOD_DB = [
  { name: '中冰鮮奶茶 1分糖 (約350ml)', cal: 155, pro: 3.5, carb: 21, fat: 6 },
  { name: '中冰無糖鮮奶茶 (約350ml)', cal: 135, pro: 3.5, carb: 16, fat: 6 },
  { name: '台式炸排骨便當 (白飯全吃)', cal: 860, pro: 34, carb: 105, fat: 33 },
  { name: '台式炸排骨便當 (白飯一半)', cal: 710, pro: 31, carb: 70, fat: 32 },
  { name: '滷雞腿便當 (去皮/飯一半)', cal: 620, pro: 35, carb: 68, fat: 21 },
  { name: '超商茶葉蛋 (1顆)', cal: 75, pro: 7, carb: 1, fat: 5 },
  { name: '超商無糖豆漿 (400ml)', cal: 140, pro: 14, carb: 6, fat: 6.5 },
  { name: '原味蛋餅 (早餐店)', cal: 265, pro: 9, carb: 32, fat: 11 },
  { name: '鮪魚蛋餅 (早餐店)', cal: 345, pro: 16, carb: 32, fat: 17 },
  { name: '火腿蛋吐司 (抹美乃滋)', cal: 360, pro: 14, carb: 38, fat: 16 },
  { name: '雞胸肉沙拉 (和風醬)', cal: 280, pro: 32, carb: 15, fat: 9 },
  { name: '大碗牛肉麵 (紅燒湯頭)', cal: 780, pro: 38, carb: 88, fat: 28 }
];

let state = {
  currentDate: getTodayStr(),
  logs: {},
  weights: {},   // { 'YYYY-MM-DD': 體重 kg }
  water: {},     // { 'YYYY-MM-DD': 杯數 }
  settings: {
    apiKey: '',
    calGoal: 1800, // = (lowLimit + highLimit) / 2，由 calcCalGoal 維持一致
    highLimit: 1850,
    lowLimit: 1750,
    proGoal: 135,
    carbGoal: 202,
    fatGoal: 50,
    waterGoal: 8,
    goalWeight: '', // 目標體重 kg，空字串代表未設定
    theme: 'auto',
    profile: { sex: 'male', age: '', height: '', weight: '', activity: 'light', goal: 'maintain' }
  }
};

let selectedTags = [];
let uploadedBase64 = null;
let lastAiEstimate = null;
let chartDays = 7;     // 趨勢圖範圍：7 或 30 日
let baseFood = null;   // 從食物清單 / AI 帶入的原始份量，用來計算份量倍數
let portion = 1;
let nameTouched = false; // 使用者手動改過名稱後，不再自動加上 ×倍數
let recentList = [];
let editingIdx = null; // 目前正在編輯的餐點索引 (null 表示新增模式)
let toastTimer = null;

function getTodayStr() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now - offset).toISOString().split('T')[0];
}

const MEAL_TYPES = ['早餐', '午餐', '晚餐', '點心'];
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// 將任意輸入轉為安全的有限數值 (非數字 / NaN / Infinity / 負數 → 0)
function safeNum(v, max = 100000) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
}

// 驗證並清理 logs 結構，丟棄不合法欄位 (用於 localStorage 讀取與備份匯入)
function sanitizeLogs(raw) {
  const clean = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
  for (const [date, meals] of Object.entries(raw)) {
    if (!DATE_KEY_RE.test(date) || !Array.isArray(meals)) continue;
    clean[date] = meals
      .filter(m => m && typeof m === 'object')
      .map(m => ({
        type: MEAL_TYPES.includes(m.type) ? m.type : '點心',
        name: String(m.name ?? '').slice(0, 100),
        cal: safeNum(m.cal),
        pro: safeNum(m.pro),
        carb: safeNum(m.carb),
        fat: safeNum(m.fat)
      }));
  }
  return clean;
}

// 驗證並清理 settings；apiKey 僅接受字串 (匯入時另行排除)
function sanitizeSettings(raw, base) {
  const s = { ...base };
  if (!raw || typeof raw !== 'object') return s;
  if (typeof raw.apiKey === 'string') s.apiKey = raw.apiKey.slice(0, 200);
  for (const k of ['calGoal', 'highLimit', 'lowLimit', 'proGoal', 'carbGoal', 'fatGoal']) {
    if (raw[k] !== undefined) {
      const n = safeNum(raw[k], 20000);
      if (n > 0) s[k] = n;
    }
  }
  if (raw.waterGoal !== undefined) {
    const g = Math.round(Number(raw.waterGoal));
    if (Number.isFinite(g) && g >= 1 && g <= 30) s.waterGoal = g;
  }
  if (raw.goalWeight === '' || raw.goalWeight === null) s.goalWeight = '';
  else if (raw.goalWeight !== undefined) {
    const gw = Number(raw.goalWeight);
    s.goalWeight = Number.isFinite(gw) && gw >= 20 && gw <= 400 ? Math.round(gw * 10) / 10 : base.goalWeight;
  }
  if (['auto', 'light', 'dark'].includes(raw.theme)) s.theme = raw.theme;
  if (raw.profile) s.profile = sanitizeProfile(raw.profile, base.profile);
  if (s.lowLimit > s.highLimit) { s.lowLimit = base.lowLimit; s.highLimit = base.highLimit; }
  s.calGoal = calcCalGoal(s.lowLimit, s.highLimit);
  return s;
}

// 每日熱量目標 = 達標區間的中間值，讓進度條 100% 與「達標」判定一致
function calcCalGoal(low, high) {
  return Math.round((Number(low) + Number(high)) / 2);
}

function loadData() {
  try {
    const savedLogs = localStorage.getItem('cal_tracker_logs_v2');
    if (savedLogs) state.logs = sanitizeLogs(JSON.parse(savedLogs));
  } catch (err) {
    console.error('讀取飲食紀錄失敗，資料可能已損毀', err);
    // 保留損毀的原始資料，避免之後 saveData 把它覆寫掉
    try { localStorage.setItem('cal_tracker_logs_v2_corrupt', localStorage.getItem('cal_tracker_logs_v2')); } catch (_) {}
    showToast('本機飲食紀錄損毀，已改用空白紀錄 (原始資料已另存備份)');
  }
  try {
    const savedBody = localStorage.getItem(BODY_KEY);
    if (savedBody) {
      const body = sanitizeBody(JSON.parse(savedBody));
      state.weights = body.weights;
      state.water = body.water;
    }
  } catch (err) {
    console.error('讀取體重與飲水紀錄失敗', err);
  }
  try {
    const savedSettings = localStorage.getItem('cal_tracker_settings_v2');
    if (savedSettings) state.settings = sanitizeSettings(JSON.parse(savedSettings), state.settings);
  } catch (err) {
    console.error('讀取設定失敗', err);
  }
}

function saveData() {
  localStorage.setItem('cal_tracker_logs_v2', JSON.stringify(state.logs));
  localStorage.setItem('cal_tracker_settings_v2', JSON.stringify(state.settings));
  localStorage.setItem(BODY_KEY, JSON.stringify({ weights: state.weights, water: state.water }));
}

function getCalorieColorInfo(kcal) {
  const high = Number(state.settings.highLimit);
  const low = Number(state.settings.lowLimit);
  if (kcal > high) {
    return { barClass: 'bar-over', badgeClass: 'st-over', label: '超標', isGoalMet: false };
  } else if (kcal >= low) {
    return { barClass: 'bar-ok', badgeClass: 'st-ok', label: '達標', isGoalMet: true };
  }
  return { barClass: 'bar-low', badgeClass: 'st-low', label: '偏低', isGoalMet: false };
}

function renderAll() {
  document.getElementById('date-picker').value = state.currentDate;
  const today = getTodayStr();
  const badge = document.getElementById('date-badge');
  if (state.currentDate === today) {
    badge.textContent = '今天';
    badge.className = 'tag tag-today';
  } else {
    badge.textContent = '歷史紀錄';
    badge.className = 'tag';
  }

  const high = Number(state.settings.highLimit);
  const low = Number(state.settings.lowLimit);
  document.getElementById('legend-high').textContent = high;
  document.getElementById('legend-low').textContent = low;
  document.getElementById('range-hint').textContent = `達標區間 ${low} ~ ${high}`;
  document.getElementById('display-goal').textContent = state.settings.calGoal;
  document.getElementById('goal-pro').textContent = state.settings.proGoal;
  document.getElementById('goal-carb').textContent = state.settings.carbGoal;
  document.getElementById('goal-fat').textContent = state.settings.fatGoal;

  const dayMeals = state.logs[state.currentDate] || [];
  let sumCal = 0, sumPro = 0, sumCarb = 0, sumFat = 0;
  dayMeals.forEach(m => {
    sumCal += Number(m.cal) || 0;
    sumPro += Number(m.pro) || 0;
    sumCarb += Number(m.carb) || 0;
    sumFat += Number(m.fat) || 0;
  });

  document.getElementById('total-cal').textContent = Math.round(sumCal);
  document.getElementById('total-pro').textContent = sumPro.toFixed(1) + 'g';
  document.getElementById('total-carb').textContent = sumCarb.toFixed(1) + 'g';
  document.getElementById('total-fat').textContent = sumFat.toFixed(1) + 'g';

  const calPct = Math.min(100, (sumCal / (state.settings.calGoal || 2000)) * 100);
  const calBar = document.getElementById('cal-progress-bar');
  const statusBadge = document.getElementById('status-badge');

  if (sumCal === 0) {
    calBar.className = 'bar-fill bar-none';
    statusBadge.className = 'stamp st-none';
    statusBadge.textContent = '未記錄';
  } else {
    const info = getCalorieColorInfo(sumCal);
    calBar.className = `bar-fill ${info.barClass}`;
    statusBadge.className = `stamp ${info.badgeClass}`;
    statusBadge.textContent = info.label;
  }
  calBar.style.width = calPct + '%';

  document.getElementById('bar-pro').style.width = Math.min(100, (sumPro / state.settings.proGoal) * 100) + '%';
  document.getElementById('bar-carb').style.width = Math.min(100, (sumCarb / state.settings.carbGoal) * 100) + '%';
  document.getElementById('bar-fat').style.width = Math.min(100, (sumFat / state.settings.fatGoal) * 100) + '%';

  renderChart();
  renderMeals(dayMeals);
  renderRecent(document.getElementById('db-search').value);
  renderBody();
}

function renderChart() {
  const container = document.getElementById('chart-container');
  container.innerHTML = '';
  const days = chartDays;
  const wide = days > 7;
  const baseDate = new Date(state.currentDate + 'T00:00:00');
  let totalCal = 0, recordedDays = 0, goalMetDays = 0;
  const high = Number(state.settings.highLimit);
  const low = Number(state.settings.lowLimit);
  const maxScale = Math.max(Number(state.settings.calGoal) || 2000, high * 1.15);
  const TRACK = 96;           // 對應 CSS .chart-track 高度
  const BELOW = 18 + 18 + 6;  // 日期列 + 數值列 + 間距

  container.classList.toggle('is-wide', wide);
  container.style.gridTemplateColumns = wide ? `repeat(${days}, minmax(34px, 1fr))` : '';

  // 達標區間底色帶
  const band = document.getElementById('chart-band');
  band.style.bottom = (BELOW + (low / maxScale) * TRACK) + 'px';
  band.style.height = Math.max(2, ((high - low) / maxScale) * TRACK) + 'px';

  let selectedCol = null;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(baseDate);
    d.setDate(baseDate.getDate() - i);
    const offset = d.getTimezoneOffset() * 60000;
    const dStr = new Date(d - offset).toISOString().split('T')[0];
    // 30 日檢視只顯示「日」，月初與第一欄補上月份
    const label = (!wide || i === days - 1 || d.getDate() === 1)
      ? `${d.getMonth() + 1}/${d.getDate()}`
      : `${d.getDate()}`;

    const meals = state.logs[dStr] || [];
    const daySum = meals.reduce((acc, m) => acc + (Number(m.cal) || 0), 0);

    if (daySum > 0) {
      totalCal += daySum;
      recordedDays++;
      if (getCalorieColorInfo(daySum).isGoalMet) goalMetDays++;
    }

    const heightPct = daySum > 0 ? Math.max(3, Math.min(100, (daySum / maxScale) * 100)) : 0;
    const colorClass = daySum > 0 ? getCalorieColorInfo(daySum).barClass : '';
    const isSelected = dStr === state.currentDate;

    const col = document.createElement('button');
    col.type = 'button';
    col.onclick = () => { cancelEdit(); state.currentDate = dStr; renderAll(); };
    col.className = `chart-col${isSelected ? ' is-sel' : ''}`;
    col.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    col.setAttribute('aria-label', `${d.getMonth() + 1}/${d.getDate()}，${daySum > 0 ? Math.round(daySum) + ' kcal' : '沒有紀錄'}`);
    col.innerHTML = `
      <span class="chart-track"><span class="chart-bar ${colorClass}" style="height: ${heightPct}%"></span></span>
      <span class="chart-date">${label}</span>
      <span class="chart-val num">${daySum > 0 ? Math.round(daySum) : '–'}</span>
    `;
    container.appendChild(col);
    if (isSelected) selectedCol = col;
  }

  document.getElementById('chart-title').textContent = `近 ${days} 日攝取`;
  document.getElementById('stat-range').textContent = days;
  document.getElementById('stat-avg').textContent = recordedDays > 0 ? Math.round(totalCal / recordedDays) : 0;
  document.getElementById('stat-recorded').textContent = recordedDays;
  document.getElementById('stat-goal-met').textContent = goalMetDays;
  [7, 30].forEach(n => {
    const btn = document.getElementById(`range-${n}`);
    btn.classList.toggle('is-on', n === days);
    btn.setAttribute('aria-pressed', n === days ? 'true' : 'false');
  });

  // 30 日檢視可橫向捲動：預設捲到選取的日期 (通常是最右邊的今天)
  const scroller = document.getElementById('chart-scroll');
  if (wide && selectedCol) {
    scroller.scrollLeft = Math.max(0, selectedCol.offsetLeft - scroller.clientWidth + selectedCol.offsetWidth + 8);
  } else {
    scroller.scrollLeft = 0;
  }
}

function setChartRange(n) {
  chartDays = n === 30 ? 30 : 7;
  try { localStorage.setItem('cal_tracker_chart_days', String(chartDays)); } catch (_) {}
  renderChart();
}

function renderMeals(meals) {
  const container = document.getElementById('meals-list-container');
  if (!meals || meals.length === 0) {
    container.innerHTML = `<div class="empty">這天還沒有紀錄。用上方的估算，或填寫表單加入第一筆。</div>`;
    return;
  }
  let total = 0;
  const rows = meals.map((m, idx) => {
    const cal = Math.round(safeNum(m.cal));
    total += safeNum(m.cal);
    return `
    <li class="slip-row">
      <div class="slip-body">
        <div class="slip-main">
          <span class="meal-tag">${escapeHtml(m.type)}</span>
          <span class="meal-name">${escapeHtml(m.name)}</span>
          <span class="leader" aria-hidden="true"></span>
          <span class="meal-cal num">${cal}<small>kcal</small></span>
        </div>
        <div class="slip-sub num">蛋白質 ${safeNum(m.pro)}g　碳水 ${safeNum(m.carb)}g　脂肪 ${safeNum(m.fat)}g</div>
      </div>
      <div class="slip-actions">
        <button type="button" data-click="startEditMeal" data-arg="${idx}" class="iconbtn" title="編輯" aria-label="編輯 ${escapeHtml(m.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/></svg></button>
        <button type="button" data-click="copyMealToToday" data-arg="${idx}" class="iconbtn" title="複製到今天" aria-label="複製 ${escapeHtml(m.name)} 到今天"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11"/><path d="M5 15V5h10"/></svg></button>
        <button type="button" data-click="deleteMeal" data-arg="${idx}" class="iconbtn danger" title="刪除" aria-label="刪除 ${escapeHtml(m.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg></button>
      </div>
    </li>`;
  }).join('');
  container.innerHTML = `
    <ul class="slip">${rows}</ul>
    <div class="slip-total"><span>合計</span><span class="num">${Math.round(total)}<small>kcal</small></span></div>
  `;
}

function addMeal() {
  const type = document.getElementById('meal-type').value;
  const name = document.getElementById('meal-name').value.trim();
  const cal = safeNum(document.getElementById('meal-cal').value);
  const pro = safeNum(document.getElementById('meal-pro').value);
  const carb = safeNum(document.getElementById('meal-carb').value);
  const fat = safeNum(document.getElementById('meal-fat').value);

  if (!name) return showToast('請輸入食物名稱');
  const meal = { type, name: name.slice(0, 100), cal, pro, carb, fat };
  if (!state.logs[state.currentDate]) state.logs[state.currentDate] = [];
  const list = state.logs[state.currentDate];

  const isEdit = editingIdx !== null && list[editingIdx];
  if (isEdit) list[editingIdx] = meal;
  else list.push(meal);

  resetMealForm();
  saveData();
  renderAll();
  showToast(isEdit ? '已更新該筆餐點' : '已新增至飲食日記');
}

function resetMealForm() {
  editingIdx = null;
  detachBase();
  nameTouched = false;
  ['meal-name', 'meal-cal', 'meal-pro', 'meal-carb', 'meal-fat'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('meal-form-title').textContent = '記錄餐點';
  document.getElementById('meal-submit-btn').textContent = '加入日記';
  document.getElementById('meal-cancel-btn').classList.add('hidden');
}

function startEditMeal(idx) {
  const m = (state.logs[state.currentDate] || [])[idx];
  if (!m) return;
  detachBase();
  nameTouched = true;
  editingIdx = idx;
  document.getElementById('meal-type').value = m.type;
  document.getElementById('meal-name').value = m.name;
  document.getElementById('meal-cal').value = m.cal;
  document.getElementById('meal-pro').value = m.pro;
  document.getElementById('meal-carb').value = m.carb;
  document.getElementById('meal-fat').value = m.fat;
  document.getElementById('meal-form-title').textContent = '編輯餐點';
  document.getElementById('meal-submit-btn').textContent = '儲存修改';
  document.getElementById('meal-cancel-btn').classList.remove('hidden');
  document.getElementById('meal-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('meal-name').focus({ preventScroll: true });
}

function cancelEdit() {
  if (editingIdx !== null) resetMealForm();
}

// 以物件參照移除，避免復原時誤刪其他後來新增的餐點
function removeMealsByRef(date, refs) {
  const list = state.logs[date];
  if (!list) return;
  refs.forEach(ref => {
    const i = list.indexOf(ref);
    if (i !== -1) list.splice(i, 1);
  });
  if (list.length === 0) delete state.logs[date];
  cancelEdit();
  saveData();
  renderAll();
}

function copyPrevDay() {
  const d = new Date(state.currentDate + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  const prev = new Date(d - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
  const source = state.logs[prev] || [];
  if (source.length === 0) return showToast('前一天沒有紀錄可複製');

  const date = state.currentDate;
  if (!state.logs[date]) state.logs[date] = [];
  const copies = source.map(m => ({ ...m }));
  state.logs[date].push(...copies);
  saveData();
  renderAll();
  showToast(`已複製前一天的 ${copies.length} 筆餐點`, {
    label: '復原',
    fn: () => { removeMealsByRef(date, copies); showToast('已復原'); }
  });
}

// 再吃一次：把這筆複製到「今天」(在今天這頁就是多加一份)
function copyMealToToday(idx) {
  const m = (state.logs[state.currentDate] || [])[idx];
  if (!m) return;
  const today = getTodayStr();
  if (!state.logs[today]) state.logs[today] = [];
  const copy = { ...m };
  state.logs[today].push(copy);
  saveData();
  renderAll();
  showToast(today === state.currentDate ? '已再加一份' : '已複製到今天', {
    label: '復原',
    fn: () => { removeMealsByRef(today, [copy]); showToast('已復原'); }
  });
}

function deleteMeal(idx) {
  const list = state.logs[state.currentDate];
  if (!list || !list[idx]) return;
  const [removed] = list.splice(idx, 1);
  const date = state.currentDate;
  // 刪除後編輯索引可能失效，直接結束編輯狀態
  if (editingIdx !== null) resetMealForm();
  saveData();
  renderAll();
  showToast('已刪除該筆紀錄', {
    label: '復原',
    fn: () => {
      if (!state.logs[date]) state.logs[date] = [];
      state.logs[date].splice(Math.min(idx, state.logs[date].length), 0, removed);
      saveData();
      renderAll();
      showToast('已復原該筆紀錄');
    }
  });
}

function changeDate(delta) {
  cancelEdit();
  const d = new Date(state.currentDate + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  const offset = d.getTimezoneOffset() * 60000;
  state.currentDate = new Date(d - offset).toISOString().split('T')[0];
  renderAll();
}

function onDateSelect(val) {
  if (val) { cancelEdit(); state.currentDate = val; renderAll(); }
}

function goToday() {
  cancelEdit();
  state.currentDate = getTodayStr();
  renderAll();
}

function renderFoodDatabase(q = '') {
  const container = document.getElementById('food-db-list');
  const needle = String(q).trim().toLowerCase();
  const items = TAIWAN_FOOD_DB
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => item.name.toLowerCase().includes(needle));
  if (items.length === 0) {
    container.innerHTML = `<div class="db-empty">找不到符合的食物，可以直接在下方手動輸入，或用上方的 AI 估算。</div>`;
    return;
  }
  container.innerHTML = items.map(({ item, idx }) => `
    <button type="button" data-click="selectFoodFromDb" data-arg="${idx}" class="db-item">
      <span class="db-name">${escapeHtml(item.name)}</span>
      <span class="db-cal num">${item.cal} kcal</span>
    </button>
  `).join('');
}

// 從所有日記中取出最近吃過的不重複餐點 (新的在前)，不需要另外儲存
function getRecentFoods(limit = 30) {
  const seen = new Set();
  const result = [];
  const dates = Object.keys(state.logs).sort().reverse();
  for (const date of dates) {
    const meals = state.logs[date] || [];
    for (let i = meals.length - 1; i >= 0; i--) {
      const m = meals[i];
      if (!m.name || seen.has(m.name)) continue;
      seen.add(m.name);
      result.push({ name: m.name, cal: m.cal, pro: m.pro, carb: m.carb, fat: m.fat });
      if (result.length >= limit) return result;
    }
  }
  return result;
}

function renderRecent(q = '') {
  const block = document.getElementById('recent-block');
  const container = document.getElementById('recent-list');
  const needle = String(q).trim().toLowerCase();
  recentList = getRecentFoods().filter(f => f.name.toLowerCase().includes(needle)).slice(0, 6);
  if (recentList.length === 0) {
    block.classList.add('hidden');
    container.innerHTML = '';
    return;
  }
  block.classList.remove('hidden');
  container.innerHTML = recentList.map((item, idx) => `
    <button type="button" data-click="selectRecent" data-arg="${idx}" class="db-item">
      <span class="db-name">${escapeHtml(item.name)}</span>
      <span class="db-cal num">${Math.round(safeNum(item.cal))} kcal</span>
    </button>
  `).join('');
}

function filterFoodDatabase(q) {
  renderFoodDatabase(q);
  renderRecent(q);
}

function selectFoodFromDb(idx) {
  fillMealForm(TAIWAN_FOOD_DB[idx]);
}

function selectRecent(idx) {
  if (recentList[idx]) fillMealForm(recentList[idx]);
}

// 由 baseFood × 份量倍數 算出表單內容
function applyPortion() {
  if (!baseFood) return;
  const p = portion;
  document.getElementById('meal-cal').value = Math.round(baseFood.cal * p);
  document.getElementById('meal-pro').value = round1(baseFood.pro * p);
  document.getElementById('meal-carb').value = round1(baseFood.carb * p);
  document.getElementById('meal-fat').value = round1(baseFood.fat * p);
  if (!nameTouched) {
    document.getElementById('meal-name').value = baseFood.name + (p !== 1 ? ` ×${p}` : '');
  }
  document.querySelectorAll('#portion-row .chip').forEach(btn => {
    const on = Number(btn.dataset.portion) === p;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function setPortion(p) {
  portion = p;
  applyPortion();
}

// 使用者手動改熱量或營養素後，不再套用份量倍數
function detachBase() {
  baseFood = null;
  portion = 1;
  document.getElementById('portion-row').classList.add('hidden');
}

function fillMealForm(item) {
  baseFood = {
    name: String(item.name ?? ''),
    cal: safeNum(item.cal),
    pro: safeNum(item.pro),
    carb: safeNum(item.carb),
    fat: safeNum(item.fat)
  };
  portion = 1;
  nameTouched = false;
  document.getElementById('portion-row').classList.remove('hidden');
  applyPortion();
  showToast('已帶入表單，確認餐別與份量後按「加入日記」');
}

function toggleTag(btn, tagText) {
  const on = !selectedTags.includes(tagText);
  selectedTags = on ? [...selectedTags, tagText] : selectedTags.filter(t => t !== tagText);
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => showToast('無法讀取圖片');
  reader.onload = function(e) {
    const img = new Image();
    img.onerror = () => showToast('圖片格式不支援，請改選其他圖片');
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const MAX_SIZE = 1024;
      let width = img.width, height = img.height;
      if (width > height && width > MAX_SIZE) {
        height *= MAX_SIZE / width; width = MAX_SIZE;
      } else if (height > MAX_SIZE) {
        width *= MAX_SIZE / height; height = MAX_SIZE;
      }
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      uploadedBase64 = dataUrl.split(',')[1];
      document.getElementById('image-preview').src = dataUrl;
      document.getElementById('image-preview-box').classList.remove('hidden');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  uploadedBase64 = null;
  document.getElementById('camera-input').value = '';
  document.getElementById('gallery-input').value = '';
  document.getElementById('image-preview-box').classList.add('hidden');
}

// 要求 Gemini 依固定結構回傳，減少格式錯誤
const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    calories: { type: 'NUMBER' },
    protein: { type: 'NUMBER' },
    carbs: { type: 'NUMBER' },
    fat: { type: 'NUMBER' },
    note: { type: 'STRING' }
  },
  required: ['name', 'calories', 'protein', 'carbs', 'fat', 'note']
};

class GeminiError extends Error {
  constructor(message, status = 0, fatal = false) {
    super(message);
    this.status = status;
    this.fatal = fatal; // true 代表換模型也沒用 (例如金鑰錯誤)
  }
}

async function callGeminiWithModel(modelName, apiKey, parts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    // API Key 放在 header 而非網址參數，避免被記錄在瀏覽器歷史 / 代理伺服器 log
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: ctrl.signal,
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA }
      })
    });
  } catch (err) {
    throw new GeminiError(err.name === 'AbortError' ? '請求逾時 (30 秒)，請稍後再試' : '網路連線失敗，請檢查網路後再試');
  } finally {
    clearTimeout(timer);
  }

  let data = {};
  try { data = await res.json(); } catch (_) {}

  if (!res.ok || data.error) {
    const status = res.status || (data.error && data.error.code) || 0;
    const msg = (data.error && data.error.message) || `HTTP ${status}`;
    // 金鑰無效 / 無權限：換其他模型也不會成功，直接中止
    const isAuth = status === 401 || status === 403 || (status === 400 && /api key/i.test(msg));
    throw new GeminiError(msg, status, isAuth);
  }

  const text = data.candidates && data.candidates[0] && data.candidates[0].content
    && data.candidates[0].content.parts && data.candidates[0].content.parts[0]
    && data.candidates[0].content.parts[0].text;
  if (!text) {
    const block = data.promptFeedback && data.promptFeedback.blockReason;
    throw new GeminiError(block ? `內容被 Gemini 安全機制阻擋 (${block})` : 'Gemini 沒有回傳內容');
  }
  return text;
}

// 將錯誤轉成使用者看得懂的訊息與建議
function describeAiError(err) {
  const status = err && err.status;
  if (err instanceof GeminiError && err.fatal) {
    return { message: 'API Key 無效或沒有權限', hint: '請確認右上角「設定」中的 Gemini API Key 是否正確複製、未過期，且已啟用 Generative Language API。' };
  }
  if (status === 429) {
    return { message: '請求過於頻繁或已超過免費額度', hint: '請稍候一分鐘再試，或到 Google AI Studio 確認額度。' };
  }
  if (status >= 500) {
    return { message: 'Gemini 服務暫時無法使用', hint: '這是 Google 端的問題，請稍後再試。' };
  }
  return { message: (err && err.message) || '無法連線至 Gemini 模型', hint: '' };
}

async function smartEstimateFood() {
  const apiKey = state.settings.apiKey.trim();
  if (!apiKey) {
    openSettingsModal();
    return showToast('請先輸入您的 Gemini API Key');
  }

  const textInput = document.getElementById('ai-input').value.trim();
  if (!textInput && !uploadedBase64) {
    return showToast('請輸入食物描述或拍攝食物照片');
  }

  const btn = document.getElementById('ai-btn');
  const resultBox = document.getElementById('ai-result-box');
  btn.disabled = true;
  btn.textContent = '估算中…';
  resultBox.classList.add('hidden');

  const promptText = `你是一位專業台灣營養師。請根據使用者提供的食物文字或照片，精準估算其熱量與三大營養素。
使用者輸入：「${textInput || '請辨識照片中的食物與份量'}」
額外條件：${selectedTags.length > 0 ? selectedTags.join('、') : '無'}
請務必只回傳純 JSON 格式，不要包含 markdown 標記，格式如下：
{"name":"食物簡稱","calories":數字,"protein":數字,"carbs":數字,"fat":數字,"note":"簡短估算說明"}`;

  const parts = [{ text: promptText }];
  if (uploadedBase64) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: uploadedBase64 } });
  }

  // 自動依序嘗試目前 Google 官方支援的模型，確保不會因單一模型下架而報錯
  const candidateModels = [
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-3-flash-preview'
  ];

  let rawText = null;
  let lastError = null;

  for (const model of candidateModels) {
    try {
      rawText = await callGeminiWithModel(model, apiKey, parts);
      if (rawText) break;
    } catch (err) {
      lastError = err;
      if (err.fatal) break; // 金鑰問題，不需再試其他模型
    }
  }

  try {
    if (!rawText) throw lastError || new Error('無法連線至 Gemini 模型');

    // 清除可能殘留的 markdown 區塊標記
    const cleanJson = rawText.replace(/```json|```/g, '').trim();
    let raw;
    try {
      raw = JSON.parse(cleanJson);
    } catch (_) {
      throw new Error('AI 回傳格式無法解析，請再試一次');
    }
    if (!raw || typeof raw !== 'object') throw new Error('AI 回傳格式無法解析，請再試一次');
    // AI 回傳內容視為不可信資料：數值強制轉型，文字於輸出時 escape
    const parsed = {
      name: String(raw.name ?? '').slice(0, 100),
      note: String(raw.note ?? '').slice(0, 300),
      calories: safeNum(raw.calories),
      protein: safeNum(raw.protein),
      carbs: safeNum(raw.carbs),
      fat: safeNum(raw.fat)
    };
    if (parsed.calories <= 0) {
      throw new Error('無法從輸入內容估算出熱量，請描述得更具體或換一張照片');
    }
    // 熱量與三大營養素換算 (4/4/9) 差異過大時提醒人工確認
    const macroKcal = parsed.protein * 4 + parsed.carbs * 4 + parsed.fat * 9;
    const mismatch = macroKcal > 0 && Math.abs(macroKcal - parsed.calories) / parsed.calories > 0.25;
    lastAiEstimate = parsed;

    resultBox.className = 'result';
    resultBox.innerHTML = `
      <div class="result-top">
        <div>
          <div class="result-name">${escapeHtml(parsed.name)}</div>
          <div class="result-note">${escapeHtml(parsed.note)}</div>
        </div>
        <span class="result-kcal num">${Math.round(parsed.calories)}<small style="font-family: var(--sans); font-size: 12px; font-weight: 500; margin-left: 2px;">kcal</small></span>
      </div>
      <div class="result-foot">
        <span class="num">蛋白質 ${parsed.protein}g　碳水 ${parsed.carbs}g　脂肪 ${parsed.fat}g</span>
        <button type="button" data-click="applyAiResult" class="btn btn-primary btn-small">填入表單</button>
      </div>
      ${mismatch ? `<div class="warn">熱量與三大營養素換算結果（約 ${Math.round(macroKcal)} kcal）差異較大，AI 估算可能不準，請人工確認。</div>` : ''}
    `;
    resultBox.classList.remove('hidden');
  } catch (err) {
    resultBox.className = 'result result-err';
    const info = describeAiError(err);
    resultBox.innerHTML = `
      <div><strong>估算失敗：</strong>${escapeHtml(info.message)}</div>
      ${info.hint ? `<div class="result-hint">${escapeHtml(info.hint)}</div>` : ''}
    `;
    resultBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = '估算熱量';
  }
}

function applyAiResult() {
  if (!lastAiEstimate) return;
  fillMealForm({
    name: lastAiEstimate.name,
    cal: Math.round(lastAiEstimate.calories),
    pro: lastAiEstimate.protein,
    carb: lastAiEstimate.carbs,
    fat: lastAiEstimate.fat
  });
}

function updateLiveRangePreview() {
  const highVal = document.getElementById('setting-high-limit').value;
  const lowVal = document.getElementById('setting-low-limit').value;
  const h = highVal !== '' ? Number(highVal) : 0;
  const l = lowVal !== '' ? Number(lowVal) : 0;
  if (highVal !== '' && lowVal !== '' && l <= h) {
    document.getElementById('setting-cal-goal').value = calcCalGoal(l, h);
  }
  document.getElementById('live-range-preview').innerHTML =
    `高於 <strong class="c-red">${h}</strong> 標示「超標」（紅）；<strong class="c-green">${l} ~ ${h}</strong> 為「達標」（綠）；低於 <strong class="c-amber">${l}</strong> 標示「偏低」（黃）。`;
}

function openSettingsModal() {
  document.getElementById('setting-api-key').value = state.settings.apiKey || '';
  document.getElementById('setting-high-limit').value = state.settings.highLimit;
  document.getElementById('setting-low-limit').value = state.settings.lowLimit;
  document.getElementById('setting-cal-goal').value = state.settings.calGoal;
  document.getElementById('setting-pro-goal').value = state.settings.proGoal;
  document.getElementById('setting-carb-goal').value = state.settings.carbGoal;
  document.getElementById('setting-fat-goal').value = state.settings.fatGoal;
  document.getElementById('setting-water-goal').value = state.settings.waterGoal;
  document.getElementById('setting-goal-weight').value = state.settings.goalWeight;
  document.getElementById('setting-theme').value = state.settings.theme;
  const prof = state.settings.profile;
  document.getElementById('prof-sex').value = prof.sex;
  document.getElementById('prof-age').value = prof.age;
  document.getElementById('prof-height').value = prof.height;
  document.getElementById('prof-weight').value = prof.weight !== '' ? prof.weight : (latestWeight() ?? '');
  document.getElementById('prof-activity').value = prof.activity;
  document.getElementById('prof-goal').value = prof.goal;
  renderPlan();
  updateLiveRangePreview();
  openModal('settings-modal');
}

function closeSettingsModal() {
  applyTheme(state.settings.theme); // 取消時還原預覽中的主題
  closeModal('settings-modal');
}

function saveSettings() {
  const highInput = document.getElementById('setting-high-limit').value;
  const lowInput = document.getElementById('setting-low-limit').value;
  
  if (highInput === '' || lowInput === '') {
    return showToast('請完整填寫紅色警戒線與黃色下限值');
  }

  const high = Number(highInput);
  const low = Number(lowInput);

  if (low > high) {
    return showToast('黃色下限值不可大於紅色警戒線');
  }

  state.settings.apiKey = document.getElementById('setting-api-key').value.trim();
  state.settings.highLimit = high;
  state.settings.lowLimit = low;
  state.settings.calGoal = calcCalGoal(low, high);
  state.settings.proGoal = Number(document.getElementById('setting-pro-goal').value) || 135;
  state.settings.carbGoal = Number(document.getElementById('setting-carb-goal').value) || 202;
  state.settings.fatGoal = Number(document.getElementById('setting-fat-goal').value) || 50;
  const goalCups = Math.round(Number(document.getElementById('setting-water-goal').value));
  state.settings.waterGoal = goalCups >= 1 && goalCups <= 30 ? goalCups : 8;
  state.settings.goalWeight = sanitizeSettings({ goalWeight: document.getElementById('setting-goal-weight').value }, { ...state.settings, goalWeight: '' }).goalWeight;
  state.settings.theme = ['auto', 'light', 'dark'].includes(document.getElementById('setting-theme').value) ? document.getElementById('setting-theme').value : 'auto';
  state.settings.profile = sanitizeProfile(readProfileFields(), state.settings.profile);

  saveData();
  closeSettingsModal();
  renderAll();
  showToast(`已套用自訂區間 (${low} ~ ${high} kcal)`);
}

function exportBackup() {
  // 備份檔不包含 API Key，避免分享或上傳備份時外洩金鑰
  const { apiKey, ...safeSettings } = state.settings;
  const backup = { version: 2, logs: state.logs, weights: state.weights, water: state.water, settings: safeSettings };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `calorie-backup-${getTodayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch (_) {}
  document.getElementById('backup-banner').classList.add('hidden');
  showToast('已匯出 JSON 備份檔');
}

function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    event.target.value = '';
    return showToast('備份檔過大 (上限 5MB)');
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (!imported || typeof imported !== 'object' || (!imported.logs && !imported.settings && !imported.weights && !imported.water)) {
        throw new Error('invalid backup');
      }
      if ((imported.logs || imported.weights || imported.water) && !confirm('匯入將覆蓋目前的飲食、體重與飲水紀錄，確定要繼續嗎？')) return;
      if (imported.logs) state.logs = sanitizeLogs(imported.logs);
      if (imported.weights || imported.water) {
        const body = sanitizeBody({ weights: imported.weights, water: imported.water });
        state.weights = body.weights;
        state.water = body.water;
      }
      if (imported.settings) {
        // 匯入檔不得覆蓋本機 API Key
        const { apiKey, ...rest } = imported.settings;
        state.settings = sanitizeSettings(rest, state.settings);
      }
      cancelEdit();
      saveData();
      renderAll();
      closeSettingsModal();
      showToast('備份資料已成功還原');
    } catch (err) {
      showToast('備份檔案格式錯誤');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

function copyDailySummary() {
  const meals = state.logs[state.currentDate] || [];
  if (meals.length === 0) return showToast('當日尚無紀錄可複製');
  let sum = 0;
  const lines = meals.map(m => { sum += safeNum(m.cal); return `- [${m.type}] ${m.name} (${safeNum(m.cal)} kcal)`; });
  const text = `${state.currentDate} 飲食日記\n${lines.join('\n')}\n合計：${Math.round(sum)} kcal`;
  navigator.clipboard.writeText(text)
    .then(() => showToast('已複製當日飲食摘要'))
    .catch(() => showToast('無法存取剪貼簿，請檢查瀏覽器權限'));
}

function confirmClearDay() { openModal('clear-modal'); }
function closeClearModal() { closeModal('clear-modal'); }
function executeClearDay() {
  delete state.logs[state.currentDate];
  cancelEdit();
  saveData();
  closeClearModal();
  renderAll();
  showToast('已清空當日紀錄');
}

function openPwaModal() { openModal('pwa-modal'); }
function closePwaModal() { closeModal('pwa-modal'); }

// ---------- 體重、飲水 ----------
const WATER_CUP_ML = 250;
const BODY_KEY = 'cal_tracker_body_v1';
const BACKUP_KEY = 'cal_tracker_last_backup';
const BACKUP_SNOOZE_KEY = 'cal_tracker_backup_snooze';
const DAY_MS = 24 * 60 * 60 * 1000;

function round1(n) { return Math.round(n * 10) / 10; }

function sanitizeBody(raw) {
  const weights = {}, water = {};
  if (raw && typeof raw === 'object') {
    if (raw.weights && typeof raw.weights === 'object' && !Array.isArray(raw.weights)) {
      for (const [date, v] of Object.entries(raw.weights)) {
        const n = Number(v);
        if (DATE_KEY_RE.test(date) && Number.isFinite(n) && n >= 20 && n <= 400) weights[date] = round1(n);
      }
    }
    if (raw.water && typeof raw.water === 'object' && !Array.isArray(raw.water)) {
      for (const [date, v] of Object.entries(raw.water)) {
        const n = Math.round(Number(v));
        if (DATE_KEY_RE.test(date) && Number.isFinite(n) && n >= 1 && n <= 50) water[date] = n;
      }
    }
  }
  return { weights, water };
}

function latestWeight() {
  const dates = Object.keys(state.weights).sort();
  return dates.length ? state.weights[dates[dates.length - 1]] : null;
}

function renderWater() {
  const date = state.currentDate;
  const goal = Number(state.settings.waterGoal) || 8;
  const cups = state.water[date] || 0;
  const total = Math.max(goal, cups);
  let html = '';
  for (let i = 0; i < total; i++) html += `<span class="cup${i < cups ? ' on' : ''}"></span>`;
  const el = document.getElementById('water-cups');
  el.innerHTML = html;
  el.setAttribute('aria-label', `已喝 ${cups} 杯，目標 ${goal} 杯`);
  document.getElementById('water-text').textContent = `${cups} / ${goal} 杯（${cups * WATER_CUP_ML} ml）`;
  document.getElementById('water-minus').disabled = cups === 0;
}

function addWater(delta) {
  const date = state.currentDate;
  const n = Math.max(0, Math.min(50, (state.water[date] || 0) + delta));
  if (n === 0) delete state.water[date]; else state.water[date] = n;
  saveData();
  renderWater();
}

function saveWeight() {
  const v = Number(document.getElementById('weight-input').value);
  if (!Number.isFinite(v) || v < 20 || v > 400) return showToast('請輸入 20～400 之間的體重 (kg)');
  state.weights[state.currentDate] = round1(v);
  saveData();
  renderBody();
  showToast('已記錄體重');
}

function clearWeight() {
  delete state.weights[state.currentDate];
  saveData();
  renderBody();
  showToast('已清除這天的體重');
}

function renderBody() {
  const date = state.currentDate;
  document.getElementById('body-date-label').textContent =
    date === getTodayStr() ? '今天的體重與飲水' : `${date} 的體重與飲水`;
  renderWater();
  const w = state.weights[date];
  document.getElementById('weight-input').value = w !== undefined ? w : '';
  document.getElementById('weight-clear').classList.toggle('hidden', w === undefined);
  renderWeightChart();
  renderWeightGoal();
}

// 體重走勢：範圍與熱量圖一致 (7 或 30 日)，以選取日期為終點
function renderWeightChart() {
  const days = chartDays;
  const end = new Date(state.currentDate + 'T00:00:00');
  const pts = [];
  for (let i = days - 1, idx = 0; i >= 0; i--, idx++) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const key = new Date(d - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
    if (state.weights[key] !== undefined) pts.push({ idx, v: state.weights[key], key });
  }
  const stats = document.getElementById('weight-stats');
  const box = document.getElementById('weight-chart');
  if (pts.length === 0) {
    stats.innerHTML = `<span>近 ${days} 日還沒有體重紀錄</span>`;
    box.innerHTML = '';
    return;
  }
  const first = pts[0], last = pts[pts.length - 1];
  let html = `<span>最新 <strong>${last.v}</strong> kg（${last.key.slice(5).replace('-', '/')}）</span>`;
  if (pts.length >= 2) {
    const diff = round1(last.v - first.v);
    const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
    html += `<span>近 ${days} 日變化 <strong>${sign}${Math.abs(diff)}</strong> kg</span>`;
  }
  stats.innerHTML = html;
  if (pts.length < 2) { box.innerHTML = ''; return; }

  const W = 300, H = 76, PAD_X = 26, PAD_Y = 10;
  const vals = pts.map(p => p.v);
  const mid = (Math.max(...vals) + Math.min(...vals)) / 2;
  const half = Math.max(Math.max(...vals) - Math.min(...vals), 1) / 2; // 至少顯示 1 kg 的範圍，避免小幅波動被放大
  const lo = mid - half, hi = mid + half;
  const x = idx => PAD_X + (days === 1 ? 0 : idx / (days - 1)) * (W - PAD_X - 6);
  const y = v => PAD_Y + (1 - (v - lo) / (hi - lo)) * (H - PAD_Y * 2);
  const line = pts.map(p => `${x(p.idx).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const dots = pts.map(p => `<circle class="dot" cx="${x(p.idx).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.5"/>`).join('');
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="近 ${days} 日體重走勢，最新 ${last.v} 公斤">
    <text x="0" y="${PAD_Y + 3}">${round1(hi)}</text>
    <text x="0" y="${H - PAD_Y + 3}">${round1(lo)}</text>
    <polyline class="line" points="${line}"/>${dots}</svg>`;
}

// ---------- 目標體重進度 ----------
const DAY_MS_W = 24 * 60 * 60 * 1000;
function dayNum(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS_W);
}
function dayKey(n) { return new Date(n * DAY_MS_W).toISOString().split('T')[0]; }

// weights: { 'YYYY-MM-DD': kg }；以 endDate (含) 之前的紀錄計算。
// 走勢用最近 30 天的紀錄做最小平方法直線；至少 3 筆且橫跨 7 天才估算，避免單日波動誤導。
function calcWeightGoal(weights, goal, endDate) {
  const g = Number(goal);
  if (!(g >= 20 && g <= 400)) return null;
  const end = dayNum(endDate);
  const dates = Object.keys(weights).filter(k => dayNum(k) <= end).sort();
  if (dates.length === 0) return null;
  const start = weights[dates[0]], current = weights[dates[dates.length - 1]];
  const remaining = Math.round((g - current) * 10) / 10;
  const reached = start === g ? Math.abs(remaining) < 0.05
    : (g > start ? current >= g : current <= g);
  const progress = start === g ? 1 : Math.min(1, Math.max(0, (current - start) / (g - start)));
  const recent = dates.filter(k => end - dayNum(k) <= 29).map(k => ({ x: dayNum(k), y: weights[k] }));
  let rateWeek = null, eta = { status: 'insufficient' };
  if (recent.length >= 3 && recent[recent.length - 1].x - recent[0].x >= 7) {
    const n = recent.length;
    const mx = recent.reduce((a, p) => a + p.x, 0) / n, my = recent.reduce((a, p) => a + p.y, 0) / n;
    const den = recent.reduce((a, p) => a + (p.x - mx) ** 2, 0);
    const slope = den === 0 ? 0 : recent.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / den;
    rateWeek = Math.round(slope * 7 * 100) / 100;
    if (!reached) {
      if (Math.sign(slope) === Math.sign(remaining) && Math.abs(slope * 7) >= 0.02) {
        const days = Math.ceil(Math.abs(remaining / slope));
        eta = days > 730 ? { status: 'far' } : { status: 'ok', days, date: dayKey(end + days) };
      } else {
        eta = { status: 'noprogress' };
      }
    }
  }
  return { start, current, goal: g, remaining, reached, progress, rateWeek, eta };
}

function renderWeightGoal() {
  const box = document.getElementById('weight-goal');
  const goal = state.settings.goalWeight;
  if (goal === '' || goal === undefined) {
    box.innerHTML = Object.keys(state.weights).length
      ? '<span class="muted">在設定填入「目標體重」，這裡會顯示進度與預估達成時間。</span>' : '';
    return;
  }
  const r = calcWeightGoal(state.weights, goal, state.currentDate);
  if (!r) { box.innerHTML = '<span class="muted">目標 ' + goal + ' kg。記錄體重後會顯示進度。</span>'; return; }
  const pct = Math.round(r.progress * 100);
  const bar = '<div class="goal-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-label="目標體重進度"><div class="goal-fill" style="width:' + pct + '%"></div></div>';
  if (r.reached) {
    box.innerHTML = '<div><strong>已達到目標 ' + r.goal + ' kg</strong>（目前 ' + r.current + ' kg）</div>' + bar;
    return;
  }
  const dir = r.remaining < 0 ? '還要減' : '還要增';
  let line = '<div>目標 <strong>' + r.goal + '</strong> kg，' + dir + ' <strong>' + Math.abs(r.remaining) + '</strong> kg（進度 ' + pct + '%，起點 ' + r.start + ' kg）</div>' + bar;
  if (r.eta.status === 'ok') {
    const d = r.eta.date.slice(0, 4) + '/' + r.eta.date.slice(5, 7) + '/' + r.eta.date.slice(8);
    line += '<div class="muted">近 30 日約每週 ' + (r.rateWeek > 0 ? '+' : r.rateWeek < 0 ? '−' : '±') + Math.abs(r.rateWeek) + ' kg；照這個速度約 ' + Math.ceil(r.eta.days / 7) + ' 週後（' + d + '）達成。</div>';
  } else if (r.eta.status === 'noprogress') {
    line += '<div class="muted">近 30 日的走勢沒有朝目標前進，暫時無法估算達成時間。</div>';
  } else if (r.eta.status === 'far') {
    line += '<div class="muted">照目前速度需要超過兩年才會達成。</div>';
  } else {
    line += '<div class="muted">再多記錄幾天（至少 3 筆、橫跨 7 天）就能估算達成時間。</div>';
  }
  line += '<div class="muted">估算只看近期趨勢，體重每天都會自然波動，僅供參考。</div>';
  box.innerHTML = line;
}

// ---------- 目標建議 (TDEE) ----------
const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, high: 1.725, extreme: 1.9 };
const GOALS = { cut: { delta: -500, protein: 2.0 }, maintain: { delta: 0, protein: 1.6 }, gain: { delta: 300, protein: 1.8 } };

function sanitizeProfile(raw, base) {
  const p = { ...base };
  if (!raw || typeof raw !== 'object') return p;
  if (raw.sex === 'male' || raw.sex === 'female') p.sex = raw.sex;
  if (Object.prototype.hasOwnProperty.call(ACTIVITY, raw.activity)) p.activity = raw.activity;
  if (Object.prototype.hasOwnProperty.call(GOALS, raw.goal)) p.goal = raw.goal;
  const num = (v, min, max) => {
    if (v === '' || v === null || v === undefined) return '';
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : '';
  };
  p.age = num(raw.age, 10, 100);
  p.height = num(raw.height, 100, 230);
  p.weight = num(raw.weight, 20, 400);
  return p;
}

// Mifflin-St Jeor 基礎代謝 × 活動係數；建議攝取量不低於基礎代謝
function calcPlan(p) {
  const age = Number(p.age), h = Number(p.height), w = Number(p.weight);
  if (!(age >= 10 && age <= 100 && h >= 100 && h <= 230 && w >= 20 && w <= 400)) return null;
  const bmr = 10 * w + 6.25 * h - 5 * age + (p.sex === 'female' ? -161 : 5);
  const tdee = bmr * (ACTIVITY[p.activity] || 1.375);
  const goal = GOALS[p.goal] || GOALS.maintain;
  let target = tdee + goal.delta;
  let clamped = false;
  if (target < bmr) { target = bmr; clamped = true; }
  target = Math.round(target / 10) * 10;
  const protein = Math.round(w * goal.protein);
  const fat = Math.round(target * 0.25 / 9);
  const carb = Math.max(0, Math.round((target - protein * 4 - fat * 9) / 4));
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), target, protein, fat, carb, clamped };
}

function readProfileFields() {
  return {
    sex: document.getElementById('prof-sex').value,
    age: document.getElementById('prof-age').value,
    height: document.getElementById('prof-height').value,
    weight: document.getElementById('prof-weight').value,
    activity: document.getElementById('prof-activity').value,
    goal: document.getElementById('prof-goal').value
  };
}

function renderPlan() {
  const plan = calcPlan(readProfileFields());
  const box = document.getElementById('plan-result');
  const btn = document.getElementById('plan-apply-btn');
  if (!plan) {
    box.textContent = '填入性別、年齡、身高、體重後，這裡會顯示建議值。';
    btn.disabled = true;
    return;
  }
  box.innerHTML = `基礎代謝約 <strong>${plan.bmr}</strong> kcal，每日消耗約 <strong>${plan.tdee}</strong> kcal。<br>
    建議攝取 <strong>${plan.target}</strong> kcal（達標區間 ${plan.target - 50} ~ ${plan.target + 50}）。<br>
    蛋白質 ${plan.protein}g、碳水 ${plan.carb}g、脂肪 ${plan.fat}g。${plan.clamped ? '<br>建議量不會低於基礎代謝。' : ''}`;
  btn.disabled = false;
}

function applyPlan() {
  const plan = calcPlan(readProfileFields());
  if (!plan) return;
  document.getElementById('setting-high-limit').value = plan.target + 50;
  document.getElementById('setting-low-limit').value = plan.target - 50;
  document.getElementById('setting-pro-goal').value = plan.protein;
  document.getElementById('setting-carb-goal').value = plan.carb;
  document.getElementById('setting-fat-goal').value = plan.fat;
  updateLiveRangePreview();
  showToast('已帶入建議值，按「儲存設定」後生效');
}

// ---------- 外觀 ----------
const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark' || theme === 'light') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  const dark = theme === 'dark' || (theme !== 'light' && !!darkQuery && darkQuery.matches);
  const meta = document.getElementById('theme-color-meta');
  if (meta) meta.setAttribute('content', dark ? '#1B2030' : '#FBFBF8');
}

// ---------- 備份提醒 ----------
function checkBackupReminder() {
  const banner = document.getElementById('backup-banner');
  const daysWithData = Object.values(state.logs).filter(list => list.length > 0).length;
  let last = 0, snooze = 0;
  try {
    last = Number(localStorage.getItem(BACKUP_KEY)) || 0;
    snooze = Number(localStorage.getItem(BACKUP_SNOOZE_KEY)) || 0;
  } catch (_) {}
  const now = Date.now();
  const due = daysWithData >= 3 && (!last || now - last > 7 * DAY_MS) && now > snooze;
  if (!due) { banner.classList.add('hidden'); return; }
  document.getElementById('backup-banner-text').textContent = last
    ? `距離上次備份已超過 ${Math.floor((now - last) / DAY_MS)} 天，資料只存在這個瀏覽器。`
    : '還沒有備份過。資料只存在這個瀏覽器，清除網站資料就會消失。';
  banner.classList.remove('hidden');
}

function dismissBackupReminder() {
  try { localStorage.setItem(BACKUP_SNOOZE_KEY, String(Date.now() + 3 * DAY_MS)); } catch (_) {}
  document.getElementById('backup-banner').classList.add('hidden');
}

// ---------- 安裝 / 離線 ----------
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });
window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  document.getElementById('install-btn').classList.add('hidden');
});

async function installApp() {
  if (deferredInstall) {
    deferredInstall.prompt();
    try { await deferredInstall.userChoice; } catch (_) {}
    deferredInstall = null;
  } else {
    openPwaModal(); // iPhone Safari 沒有安裝事件，顯示手動步驟
  }
}

function initPwa() {
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone;
  if (standalone) document.getElementById('install-btn').classList.add('hidden');
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service Worker 註冊失敗', err));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) showToast('已更新到新版本，重新整理後生效');
    });
  }
}

// 對話視窗：開啟時移動焦點、Esc 關閉、Tab 不跑出視窗、關閉後回到原按鈕
let lastFocused = null;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([readonly]), select, [href], [tabindex]:not([tabindex="-1"])';

function openModal(id) {
  const modal = document.getElementById(id);
  lastFocused = document.activeElement;
  modal.classList.remove('hidden');
  const first = modal.querySelector(FOCUSABLE);
  if (first) first.focus();
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
  lastFocused = null;
}

document.addEventListener('keydown', (e) => {
  const open = document.querySelector('.modal:not(.hidden)');
  if (!open) return;
  if (e.key === 'Escape') { closeModal(open.id); return; }
  if (e.key === 'Tab') {
    const items = [...open.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

// action: { label, fn } 可選，顯示可點擊的操作按鈕 (例如「復原」)，停留時間較長
function showToast(msg, action) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.className = 'toast-action';
    btn.onclick = () => {
      clearTimeout(toastTimer);
      toast.classList.add('opacity-0', 'pointer-events-none');
      action.fn();
    };
    toast.appendChild(btn);
    toast.classList.remove('pointer-events-none');
  } else {
    toast.classList.add('pointer-events-none');
  }
  toast.classList.remove('opacity-0');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('opacity-0', 'pointer-events-none');
  }, action ? 6000 : 2500);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// ---------- 事件委派 ----------
// HTML 不再使用 onclick 等 inline 屬性 (CSP 因此可以拒絕 inline script)。
// 元素以 data-click / data-change / data-input / data-enter 指名要執行的動作，
// 只有下表列出的動作能被觸發。
const ACTIONS = {
  addMeal: () => addMeal(),
  addWater: (el, a) => addWater(Number(a)),
  applyAiResult: () => applyAiResult(),
  applyPlan: () => applyPlan(),
  applyTheme: (el) => applyTheme(el.value),
  cancelEdit: () => cancelEdit(),
  changeDate: (el, a) => changeDate(Number(a)),
  clearImage: () => clearImage(),
  clearWeight: () => clearWeight(),
  closeClearModal: () => closeClearModal(),
  closePwaModal: () => closePwaModal(),
  closeSettingsModal: () => closeSettingsModal(),
  confirmClearDay: () => confirmClearDay(),
  copyDailySummary: () => copyDailySummary(),
  copyMealToToday: (el, a) => copyMealToToday(Number(a)),
  copyPrevDay: () => copyPrevDay(),
  deleteMeal: (el, a) => deleteMeal(Number(a)),
  dismissBackupReminder: () => dismissBackupReminder(),
  executeClearDay: () => executeClearDay(),
  exportBackup: () => exportBackup(),
  filterFoodDatabase: (el) => filterFoodDatabase(el.value),
  goToday: () => goToday(),
  handleImageUpload: (el, a, ev) => handleImageUpload(ev),
  importBackup: (el, a, ev) => importBackup(ev),
  installApp: () => installApp(),
  onDateSelect: (el) => onDateSelect(el.value),
  openSettingsModal: () => openSettingsModal(),
  renderPlan: () => renderPlan(),
  saveSettings: () => saveSettings(),
  saveWeight: () => saveWeight(),
  selectFoodFromDb: (el, a) => selectFoodFromDb(Number(a)),
  selectRecent: (el, a) => selectRecent(Number(a)),
  setChartRange: (el, a) => setChartRange(Number(a)),
  setPortion: (el, a) => setPortion(Number(a)),
  smartEstimateFood: () => smartEstimateFood(),
  startEditMeal: (el, a) => startEditMeal(Number(a)),
  toggleTag: (el, a) => toggleTag(el, a),
  updateLiveRangePreview: () => updateLiveRangePreview(),
};

function dispatchAction(attr, e) {
  const el = e.target.closest('[' + attr + ']');
  if (!el) return;
  const fn = ACTIONS[el.getAttribute(attr)];
  if (fn) fn(el, el.getAttribute('data-arg'), e);
}
document.addEventListener('click', (e) => dispatchAction('data-click', e));
document.addEventListener('change', (e) => dispatchAction('data-change', e));
document.addEventListener('input', (e) => dispatchAction('data-input', e));
document.addEventListener('keydown', (e) => { if (e.key === 'Enter') dispatchAction('data-enter', e); });

window.onload = function() {
  document.getElementById('meal-name').addEventListener('input', () => { nameTouched = true; });
  ['meal-cal', 'meal-pro', 'meal-carb', 'meal-fat'].forEach(id => {
    document.getElementById(id).addEventListener('input', detachBase);
  });
  try { if (localStorage.getItem('cal_tracker_chart_days') === '30') chartDays = 30; } catch (_) {}
  loadData();
  applyTheme(state.settings.theme);
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', () => applyTheme(state.settings.theme));
  renderFoodDatabase();
  renderAll();
  checkBackupReminder();
  initPwa();
};
