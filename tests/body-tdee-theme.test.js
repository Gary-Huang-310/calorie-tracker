const {JSDOM}=require('jsdom');const fs=require('fs');
const html=fs.readFileSync('/home/claude/calorie-tracker/index.html','utf8');
const mk=(pre)=>{const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost/',pretendToBeVisual:true});
 const w=dom.window;w.HTMLElement.prototype.scrollIntoView=()=>{};w.confirm=()=>true;
 if(pre)pre(w);w.dispatchEvent(new w.Event('load'));return w;};
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1};
const sh=(w,n)=>w.eval(`(()=>{const x=new Date();x.setDate(x.getDate()+(${n}));return new Date(x-x.getTimezoneOffset()*60000).toISOString().split('T')[0]})()`);
let w=mk(),d=w.document;const today=sh(w,0);
// TDEE
const p=w.eval('calcPlan({sex:"male",age:30,height:175,weight:70,activity:"moderate",goal:"maintain"})');
ok(p&&p.bmr===1649&&p.tdee===2556&&p.target===2560,'male BMR 1649, TDEE 2556, target 2560: '+JSON.stringify(p));
ok(p.protein===112,'maintain protein 1.6g/kg = 112');
const f=w.eval('calcPlan({sex:"female",age:30,height:160,weight:50,activity:"sedentary",goal:"cut"})');
ok(f.bmr===1189&&f.clamped===true&&f.target===1190,'female cut clamped to BMR: '+JSON.stringify(f));
ok(w.eval('calcPlan({sex:"male",age:"",height:175,weight:70,activity:"light",goal:"cut"})')===null,'missing age -> null');
ok(w.eval('calcPlan({sex:"male",age:5,height:175,weight:70,activity:"light",goal:"cut"})')===null,'age out of range -> null');
// apply plan through UI
w.openSettingsModal();
d.getElementById('prof-age').value='30';d.getElementById('prof-height').value='175';d.getElementById('prof-weight').value='70';
d.getElementById('prof-activity').value='moderate';d.getElementById('prof-goal').value='maintain';w.renderPlan();
ok(!d.getElementById('plan-apply-btn').disabled&&/2560/.test(d.getElementById('plan-result').textContent),'plan shown');
w.applyPlan();
ok(d.getElementById('setting-high-limit').value==='2610'&&d.getElementById('setting-low-limit').value==='2510','band = target ±50');
w.saveSettings();
ok(w.eval('state.settings.calGoal')===2560&&w.eval('state.settings.profile.age')===30,'saved goal 2560 + profile');
// water
w.addWater(1);w.addWater(1);w.addWater(1);
ok(w.eval('state.water["'+today+'"]')===3&&d.querySelectorAll('#water-cups .cup.on').length===3&&d.querySelectorAll('#water-cups .cup').length===8,'water 3/8');
ok(/3 \/ 8/.test(d.getElementById('water-text').textContent)&&/750 ml/.test(d.getElementById('water-text').textContent),'water text');
w.addWater(-5);ok(w.eval('state.water["'+today+'"]')===undefined&&d.getElementById('water-minus').disabled,'water floors at 0 & removed');
for(let i=0;i<12;i++)w.addWater(1);
ok(d.querySelectorAll('#water-cups .cup').length===12,'cups grow past goal');
// weight
d.getElementById('weight-input').value='70.26';w.saveWeight();
ok(w.eval('state.weights["'+today+'"]')===70.3,'weight rounded 70.3');
d.getElementById('weight-input').value='5';w.saveWeight();
ok(w.eval('state.weights["'+today+'"]')===70.3&&/20/.test(d.getElementById('toast').textContent),'invalid weight rejected');
for(const [n,v] of [[-1,71.5],[-2,71.0],[-3,70.8]]){w.eval(`state.weights["${sh(w,n)}"]=${v}`);}
w.renderAll();
ok(/<polyline/.test(d.getElementById('weight-chart').innerHTML),'sparkline rendered');
ok(/−0\.5/.test(d.getElementById('weight-stats').textContent),'change −0.5 kg: '+d.getElementById('weight-stats').textContent);
w.clearWeight();ok(w.eval('state.weights["'+today+'"]')===undefined,'clear weight');
// persistence + export/import
w.eval('saveData()');
const w2=mk(x=>{for(const k of ['cal_tracker_body_v1','cal_tracker_settings_v2'])x.localStorage.setItem(k,w.localStorage.getItem(k));});
ok(w2.eval('Object.keys(state.weights).length')===3&&w2.eval('state.water["'+today+'"]')===12,'reload restores body data');
// sanitize
const s=w.eval('sanitizeBody({weights:{"2026-01-01":70,"<x>":1,"2026-01-02":9999,"2026-01-03":"abc"},water:{"2026-01-01":3.4,"2026-01-02":-1,"2026-01-03":999,"__proto__":5}})');
ok(JSON.stringify(s)==='{"weights":{"2026-01-01":70},"water":{"2026-01-01":3}}','sanitizeBody: '+JSON.stringify(s));
ok(w.eval('sanitizeBody(null).weights && sanitizeBody([]).water')!==undefined,'sanitizeBody tolerates junk');
const pr=w.eval('sanitizeProfile({sex:"x",age:"500",height:"abc",weight:70,activity:"hack",goal:"cut"},{sex:"male",age:"",height:"",weight:"",activity:"light",goal:"maintain"})');
ok(pr.sex==='male'&&pr.age===''&&pr.height===''&&pr.weight===70&&pr.activity==='light'&&pr.goal==='cut','sanitizeProfile');
let blob=null;w.URL.createObjectURL=b=>{blob=b;return 'blob:x'};w.URL.revokeObjectURL=()=>{};
w.HTMLAnchorElement.prototype.click=()=>{};
w.eval('state.settings.apiKey="SECRET"');w.exportBackup();
ok(!!w.localStorage.getItem('cal_tracker_last_backup'),'export records last backup time');
// theme
w.applyTheme('dark');ok(w.document.documentElement.getAttribute('data-theme')==='dark'&&d.getElementById('theme-color-meta').getAttribute('content')==='#1B2030','dark theme + meta');
w.applyTheme('light');ok(d.getElementById('theme-color-meta').getAttribute('content')==='#FBFBF8','light meta');
w.applyTheme('auto');ok(!w.document.documentElement.hasAttribute('data-theme'),'auto removes attr');
w.eval('state.settings.theme="dark"');w.openSettingsModal();d.getElementById('setting-theme').value='light';w.applyTheme('light');w.closeSettingsModal();
ok(w.document.documentElement.getAttribute('data-theme')==='dark','cancel settings reverts preview theme');
const w3=mk(x=>x.localStorage.setItem('cal_tracker_settings_v2',JSON.stringify({theme:'evil"><script>',calGoal:1800})));
ok(w3.eval('state.settings.theme')==='auto','bad theme -> auto');
// backup banner
const mkLogs=n=>{const o={};for(let i=1;i<=n;i++)o[sh(w,-i)]=[{type:'早餐',name:'a',cal:100,pro:1,carb:1,fat:1}];return JSON.stringify(o)};
let w4=mk(x=>x.localStorage.setItem('cal_tracker_logs_v2',mkLogs(2)));
ok(w4.document.getElementById('backup-banner').classList.contains('hidden'),'banner hidden with <3 days of data');
w4=mk(x=>x.localStorage.setItem('cal_tracker_logs_v2',mkLogs(3)));
ok(!w4.document.getElementById('backup-banner').classList.contains('hidden')&&/還沒有備份/.test(w4.document.getElementById('backup-banner-text').textContent),'banner shown, never backed up');
w4.dismissBackupReminder();ok(w4.document.getElementById('backup-banner').classList.contains('hidden'),'snooze hides');
w4=mk(x=>{x.localStorage.setItem('cal_tracker_logs_v2',mkLogs(3));x.localStorage.setItem('cal_tracker_backup_snooze',String(Date.now()+86400000))});
ok(w4.document.getElementById('backup-banner').classList.contains('hidden'),'snoozed stays hidden');
w4=mk(x=>{x.localStorage.setItem('cal_tracker_logs_v2',mkLogs(3));x.localStorage.setItem('cal_tracker_backup_snooze',String(Date.now()-1000))});
ok(!w4.document.getElementById('backup-banner').classList.contains('hidden'),'snooze expired shows again');
w4=mk(x=>{x.localStorage.setItem('cal_tracker_logs_v2',mkLogs(3));x.localStorage.setItem('cal_tracker_last_backup',String(Date.now()-3*86400000))});
ok(w4.document.getElementById('backup-banner').classList.contains('hidden'),'recent backup -> hidden');
w4=mk(x=>{x.localStorage.setItem('cal_tracker_logs_v2',mkLogs(3));x.localStorage.setItem('cal_tracker_last_backup',String(Date.now()-9*86400000))});
ok(/9 天/.test(w4.document.getElementById('backup-banner-text').textContent),'old backup -> shows days');
// install fallback
w.eval('deferredInstall=null');w.installApp();
ok(!d.getElementById('pwa-modal').classList.contains('hidden'),'installApp falls back to manual modal');
