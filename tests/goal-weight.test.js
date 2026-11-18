const {JSDOM}=require('jsdom');
const html=require('./helper').html();
const mk=(pre)=>{const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost/',pretendToBeVisual:true});
 const w=dom.window;w.HTMLElement.prototype.scrollIntoView=()=>{};w.confirm=()=>true;if(pre)pre(w);w.dispatchEvent(new w.Event('load'));return w;};
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1};
const w=mk(),d=w.document;
const T='2026-06-30';
const wt=o=>JSON.stringify(o);
const calc=(weights,goal,end=T)=>w.eval(`calcWeightGoal(${wt(weights)},${wt(goal)},"${end}")`);
ok(calc({[T]:80},'')===null&&calc({}, 70)===null,'no goal / no data -> null');
// cut: 80 -> 78 over 14 days (−1 kg/week), goal 70
let r=calc({'2026-06-16':80,'2026-06-23':79,'2026-06-30':78},70);
ok(r.start===80&&r.current===78&&r.remaining===-8&&Math.round(r.progress*100)===20,'cut progress 20%: '+wt(r));
ok(r.rateWeek===-1&&r.eta.status==='ok'&&r.eta.days===56&&r.eta.date==='2026-08-25','ETA 56 days -> 2026-08-25: '+wt(r.eta));
// moving away from goal
r=calc({'2026-06-16':80,'2026-06-23':81,'2026-06-30':82},70);
ok(r.eta.status==='noprogress','gaining while goal is lower -> noprogress');
// bulk toward higher goal
r=calc({'2026-06-16':60,'2026-06-23':60.5,'2026-06-30':61},65);
ok(r.remaining===4&&r.eta.status==='ok'&&r.eta.days===56,'bulk ETA: '+wt(r.eta));
// insufficient
ok(calc({'2026-06-29':80,'2026-06-30':79.5},70).eta.status==='insufficient','2 points -> insufficient');
ok(calc({'2026-06-01':80,'2026-06-02':79,'2026-06-03':78},70).eta.status==='insufficient','old points outside 30d window -> insufficient');
ok(calc({'2026-06-24':80,'2026-06-27':79.9,'2026-06-30':79.8},70).eta.status==='insufficient','span < 7 days -> insufficient');
// reached
r=calc({'2026-06-16':80,'2026-06-30':69.5},70);ok(r.reached&&r.progress===1,'reached when below cut goal');
r=calc({'2026-06-16':60,'2026-06-30':65.2},65);ok(r.reached,'reached for bulk');
// flat trend / far
r=calc({'2026-06-01':80,'2026-06-15':80,'2026-06-30':80},70);ok(r.eta.status==='noprogress','flat -> noprogress');
r=calc({'2026-06-01':80,'2026-06-15':79.99,'2026-06-30':79.9},40);ok(r.eta.status==='noprogress'||r.eta.status==='far','tiny slope not absurd ETA: '+r.eta.status);
r=calc({'2026-06-16':80,'2026-06-23':79.9,'2026-06-30':79.8},40);ok(r.eta.status==='far','>2 years -> far');
// future-dated weights ignored for a past view
r=calc({'2026-06-16':80,'2026-06-30':70,'2026-07-10':60},50,'2026-06-20');ok(r.current===80,'ignores later records');
// settings sanitize
const s=x=>w.eval(`sanitizeSettings(${wt(x)},state.settings).goalWeight`);
ok(s({goalWeight:'68.26'})===68.3&&s({goalWeight:''})===''&&s({goalWeight:5})===''&&s({goalWeight:'abc'})===''&&s({goalWeight:9999})==='','sanitize goalWeight');
// UI
w.eval(`state.weights=${wt({'2026-06-16':80,'2026-06-23':79,'2026-06-30':78})}`);w.eval(`state.currentDate="${T}"`);
w.renderBody();ok(/設定填入/.test(d.getElementById('weight-goal').textContent),'hint when goal unset');
w.openSettingsModal();d.getElementById('setting-goal-weight').value='70';w.saveSettings();
ok(w.eval('state.settings.goalWeight')===70&&/還要減/.test(d.getElementById('weight-goal').textContent)&&/8 週/.test(d.getElementById('weight-goal').textContent),'UI shows remaining + weeks: '+d.getElementById('weight-goal').textContent.slice(0,90));
ok(d.querySelector('#weight-goal [role=progressbar]').getAttribute('aria-valuenow')==='20','progressbar 20');
w.openSettingsModal();d.getElementById('setting-goal-weight').value='';w.saveSettings();
ok(w.eval('state.settings.goalWeight')==='','clearing goal works');
// persists through reload + backup
w.eval('state.settings.goalWeight=72');w.eval('saveData()');
const w2=mk(x=>x.localStorage.setItem('cal_tracker_settings_v2',w.localStorage.getItem('cal_tracker_settings_v2')));
ok(w2.eval('state.settings.goalWeight')===72,'persisted');
const w3=mk(x=>x.localStorage.setItem('cal_tracker_settings_v2',JSON.stringify({goalWeight:'<img src=x onerror=alert(1)>'})));
ok(w3.eval('state.settings.goalWeight')==='','malicious goalWeight rejected');
