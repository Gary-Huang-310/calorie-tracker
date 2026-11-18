const {JSDOM}=require('jsdom');const fs=require('fs');
const html=fs.readFileSync('/home/claude/calorie-tracker/index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost/',pretendToBeVisual:true});
const w=dom.window,d=w.document;w.HTMLElement.prototype.scrollIntoView=()=>{};
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1};
const v=id=>d.getElementById(id).value;const set=(id,x)=>d.getElementById(id).value=x;
const today=w.eval('getTodayStr()');
const yest=w.eval("(()=>{const x=new Date(state.currentDate+'T00:00:00');x.setDate(x.getDate()-1);return new Date(x-x.getTimezoneOffset()*60000).toISOString().split('T')[0]})()");
w.localStorage.setItem('cal_tracker_logs_v2',JSON.stringify({[yest]:[
 {type:'午餐',name:'自煮雞胸沙拉',cal:300,pro:30,carb:10,fat:12},
 {type:'晚餐',name:'水餃 10 顆',cal:520,pro:22,carb:60,fat:20}],
 '2026-01-01':[{type:'早餐',name:'舊的蛋餅',cal:265,pro:9,carb:32,fat:11}]}));
w.dispatchEvent(new w.Event('load'));
const portionRow=d.getElementById('portion-row');
ok(portionRow.classList.contains('hidden'),'portion row hidden initially');
let rec=[...d.querySelectorAll('#recent-list .db-name')].map(e=>e.textContent);
ok(rec[0]==='水餃 10 顆'&&rec[1]==='自煮雞胸沙拉'&&rec[2]==='舊的蛋餅'&&rec.length===3,'recent: newest first, from logs: '+rec.join('|'));
// search filters both lists
w.filterFoodDatabase('水餃');
ok(d.querySelectorAll('#recent-list .db-item').length===1&&!d.getElementById('recent-block').classList.contains('hidden'),'search filters recent');
w.filterFoodDatabase('zzz');
ok(d.getElementById('recent-block').classList.contains('hidden')&&/找不到/.test(d.getElementById('food-db-list').textContent),'no match: recent hidden, empty msg');
w.filterFoodDatabase('');
// pick DB item (index 7: 原味蛋餅 265/9/32/11)
w.selectFoodFromDb(7);
ok(!portionRow.classList.contains('hidden')&&v('meal-cal')==='265','pick shows portion row + values');
w.setPortion(0.5);
ok(v('meal-cal')==='133'&&v('meal-pro')==='4.5'&&v('meal-carb')==='16'&&v('meal-fat')==='5.5'&&v('meal-name')==='原味蛋餅 (早餐店) ×0.5','x0.5 values & name: '+[v('meal-cal'),v('meal-pro'),v('meal-name')]);
w.setPortion(1.5);ok(v('meal-cal')==='398'&&v('meal-name').endsWith('×1.5'),'x1.5');
w.setPortion(1);ok(v('meal-name')==='原味蛋餅 (早餐店)'&&v('meal-cal')==='265','x1 removes suffix');
ok(d.querySelector('#portion-row [data-portion="1"]').getAttribute('aria-pressed')==='true','chip pressed state');
// manual name edit locks name
set('meal-name','我的蛋餅');d.getElementById('meal-name').dispatchEvent(new w.Event('input'));
w.setPortion(2);ok(v('meal-name')==='我的蛋餅'&&v('meal-cal')==='530','manual name kept, values scale');
// manual macro edit detaches
set('meal-cal','999');d.getElementById('meal-cal').dispatchEvent(new w.Event('input'));
ok(portionRow.classList.contains('hidden'),'manual cal edit hides portion row');
w.addMeal();
const list=w.eval('state.logs[state.currentDate]');
ok(list.length===1&&list[0].cal===999&&list[0].name==='我的蛋餅','added with manual value');
ok(portionRow.classList.contains('hidden')&&v('meal-name')==='','form reset hides portion');
// recent now includes today's new item first
rec=[...d.querySelectorAll('#recent-list .db-name')].map(e=>e.textContent);
ok(rec[0]==='我的蛋餅','new log appears at top of recent');
// pick recent, portion, add
w.selectRecent(1);// 水餃
w.setPortion(0.5);w.addMeal();
const l2=w.eval('state.logs[state.currentDate]');
ok(l2[1].name==='水餃 10 顆 ×0.5'&&l2[1].cal===260,'recent x0.5 saved: '+JSON.stringify(l2[1]));
// edit mode detaches
w.selectFoodFromDb(0);w.startEditMeal(0);
ok(portionRow.classList.contains('hidden')&&v('meal-name')==='我的蛋餅','edit detaches portion');
// AI apply -> base set
w.eval("lastAiEstimate={name:'測試',calories:400,protein:20,carbs:40,fat:10,note:''}");w.applyAiResult();w.setPortion(2);
ok(v('meal-cal')==='800'&&v('meal-pro')==='40','AI result scales');
// XSS in recent names
w.localStorage.setItem('cal_tracker_logs_v2',JSON.stringify({[yest]:[{type:'午餐',name:'<img src=x onerror=1>',cal:1}]}));
w.eval('state.logs=sanitizeLogs(JSON.parse(localStorage.getItem("cal_tracker_logs_v2")));renderAll()');
ok(!d.querySelector('#recent-list img')&&/<img/.test(d.querySelector('#recent-list .db-name').textContent),'recent names escaped');
