const {JSDOM}=require('jsdom');const fs=require('fs');
const html=fs.readFileSync('/home/claude/calorie-tracker/index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost/',pretendToBeVisual:true});
const w=dom.window,d=w.document;w.HTMLElement.prototype.scrollIntoView=()=>{};
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1};
const sh=(n)=>w.eval(`(()=>{const x=new Date();x.setDate(x.getDate()+(${n}));return new Date(x-x.getTimezoneOffset()*60000).toISOString().split('T')[0]})()`);
const today=sh(0),yest=sh(-1),d20=sh(-20),d40=sh(-40);
w.localStorage.setItem('cal_tracker_logs_v2',JSON.stringify({
 [yest]:[{type:'早餐',name:'蛋餅',cal:265,pro:9,carb:32,fat:11},{type:'午餐',name:'便當',cal:800,pro:30,carb:90,fat:30}],
 [d20]:[{type:'晚餐',name:'牛肉麵',cal:1800,pro:38,carb:88,fat:28}],
 [d40]:[{type:'晚餐',name:'太久以前',cal:2500,pro:1,carb:1,fat:1}]}));
w.dispatchEvent(new w.Event('load'));
const logs=()=>w.eval('state.logs');
const cols=()=>d.querySelectorAll('#chart-container .chart-col').length;
// chart range
ok(cols()===7&&d.getElementById('chart-title').textContent==='近 7 日攝取','default 7 days');
w.setChartRange(30);
ok(cols()===30&&d.getElementById('chart-title').textContent==='近 30 日攝取'&&d.getElementById('stat-range').textContent==='30','30 days columns + title');
ok(d.getElementById('stat-recorded').textContent==='2','30d recorded days = 2 (yest + d20), excludes d40: '+d.getElementById('stat-recorded').textContent);
ok(d.getElementById('stat-avg').textContent===String(Math.round((1065+1800)/2)),'30d avg');
ok(d.getElementById('range-30').getAttribute('aria-pressed')==='true'&&d.getElementById('range-7').getAttribute('aria-pressed')==='false','toggle state');
ok(w.localStorage.getItem('cal_tracker_chart_days')==='30','range persisted');
ok(d.getElementById('chart-container').classList.contains('is-wide'),'wide class');
const labels=[...d.querySelectorAll('.chart-date')].map(e=>e.textContent);
ok(/\//.test(labels[0])&&labels.filter(l=>!/\//.test(l)).length>=20,'compact day labels');
w.setChartRange(7);ok(cols()===7&&!d.getElementById('chart-container').classList.contains('is-wide'),'back to 7');
// clicking a bar selects the date
d.querySelectorAll('#chart-container .chart-col')[5].click();
ok(w.eval('state.currentDate')===yest,'bar click selects date');
w.goToday();
// copy previous day
w.copyPrevDay();
ok((logs()[today]||[]).length===2&&logs()[today][1].name==='便當','copy prev day into today');
ok(logs()[yest].length===2&&logs()[today][0]!==logs()[yest][0],'copies are independent objects');
const undo=d.querySelector('#toast button');ok(!!undo&&/2 筆/.test(d.getElementById('toast').textContent),'toast with count + undo');
// add another meal before undo, then undo should only remove the copies
d.getElementById('meal-name').value='新增';d.getElementById('meal-cal').value='100';w.addMeal();
undo.click();
ok((logs()[today]||[]).length===1&&logs()[today][0].name==='新增','undo removes only the copied meals');
// copy prev day when nothing yesterday
w.changeDate(-5);w.copyPrevDay();
ok(/沒有紀錄/.test(d.getElementById('toast').textContent),'no source message');
// copy meal to today from another day
w.onDateSelect(yest);w.copyMealToToday(1);
ok(logs()[today].some(m=>m.name==='便當')&&/複製到今天/.test(d.getElementById('toast').textContent),'copy meal to today');
ok(w.eval('state.currentDate')===yest,'stays on viewed date');
d.querySelector('#toast button').click();
ok(!logs()[today].some(m=>m.name==='便當'),'undo copy meal');
// same-day duplicate
w.goToday();w.copyMealToToday(0);
ok(logs()[today].filter(m=>m.name==='新增').length===2&&/再加一份/.test(d.getElementById('toast').textContent),'same-day duplicate');
ok(d.querySelectorAll('.slip-row').length===2&&d.querySelectorAll('.slip-row')[0].querySelectorAll('button').length===3,'row has edit/copy/delete');
