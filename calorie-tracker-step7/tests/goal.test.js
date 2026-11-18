const {JSDOM}=require('jsdom');const fs=require('fs');
const html=fs.readFileSync('/home/claude/calorie-tracker/index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost/',pretendToBeVisual:true});
const w=dom.window,d=w.document;
// legacy saved settings with old goal 2000
w.localStorage.setItem('cal_tracker_settings_v2',JSON.stringify({calGoal:2000,highLimit:1850,lowLimit:1750}));
w.dispatchEvent(new w.Event('load'));
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1};
ok(w.eval('state.settings.calGoal')===1800,'legacy 2000 migrates to 1800');
ok(d.getElementById('display-goal').textContent==='1800','display shows 1800');
w.openSettingsModal();
const hi=d.getElementById('setting-high-limit'),lo=d.getElementById('setting-low-limit');
hi.value='2100';lo.value='1900';w.updateLiveRangePreview();
ok(d.getElementById('setting-cal-goal').value==='2000','live preview goal = 2000');
w.saveSettings();
ok(w.eval('state.settings.calGoal')===2000&&d.getElementById('display-goal').textContent==='2000','save updates goal');
d.getElementById('meal-name').value='x';d.getElementById('meal-cal').value='2000';w.addMeal();
ok(d.getElementById('cal-progress-bar').style.width==='100%','2000 kcal = 100% bar');
ok(d.getElementById('setting-cal-goal').hasAttribute('readonly'),'goal input readonly');
