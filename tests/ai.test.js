const {JSDOM}=require('jsdom');const fs=require('fs');
const html=require('./helper').html();
const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost/',pretendToBeVisual:true});
const w=dom.window;const d=w.document;
w.HTMLElement.prototype.scrollIntoView=()=>{};
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1};
w.dispatchEvent(new w.Event('load'));
const set=(id,v)=>d.getElementById(id).value=v;
const list=()=>w.eval('state.logs[state.currentDate]||[]');
set('meal-name','雞腿');set('meal-cal','500');set('meal-pro','30');w.addMeal();
ok(list().length===1,'add');
w.startEditMeal(0);
ok(d.getElementById('meal-name').value==='雞腿'&&d.getElementById('meal-submit-btn').textContent==='儲存修改','edit loads form');
set('meal-name','雞腿便當');set('meal-cal','700');w.addMeal();
ok(list().length===1&&list()[0].name==='雞腿便當'&&list()[0].cal===700,'edit saves in place');
ok(d.getElementById('meal-cancel-btn').classList.contains('hidden'),'edit mode reset');
w.deleteMeal(0);ok(list().length===0,'delete');
const undo=d.querySelector('#toast button');ok(!!undo,'undo button shown');
undo.click();ok(list().length===1&&list()[0].name==='雞腿便當','undo restores');
w.startEditMeal(0);w.changeDate(-1);
ok(d.getElementById('meal-name').value===''&&w.eval('editingIdx')===null,'date change cancels edit');
// AI mocks
async function run(mock){w.fetch=mock;w.eval("state.settings.apiKey='k'");set('ai-input','x');
 await w.smartEstimateFood();return d.getElementById('ai-result-box').textContent.replace(/\s+/g,' ');}
const calls=[];
let r=await0();
async function await0(){return ''}
(async()=>{
 let n=0;
 r=await run(async(u,o)=>{n++;return{ok:false,status:403,json:async()=>({error:{message:'API key not valid'}})}});
 ok(n===1&&/API Key 無效/.test(r),'403 stops after 1 call: '+n);
 n=0;r=await run(async()=>{n++;return{ok:false,status:429,json:async()=>({error:{message:'quota'}})}});
 ok(n===3&&/頻繁|額度/.test(r),'429 tries all models, friendly msg');
 n=0;r=await run(async(u,o)=>{n++;const b=JSON.parse(o.body);ok(!!b.generationConfig.responseSchema&&o.headers['x-goog-api-key']==='k'&&!u.includes('key='),'schema+header');return{ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({name:'<b>x</b>',calories:500,protein:10,carbs:10,fat:5,note:'n'})}]}}]})}});
 ok(/x/.test(r)&&/差異較大/.test(r)&&!d.querySelector('#ai-result-box b'),'success + mismatch warn + escaped');
 r=await run(async()=>({ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text:'{"name":"a","calories":0,"protein":0,"carbs":0,"fat":0,"note":""}'}]}}]})}));
 ok(/無法從輸入內容估算/.test(r),'zero calories rejected');
 r=await run(async()=>({ok:true,status:200,json:async()=>({promptFeedback:{blockReason:'SAFETY'}})}));
 ok(/阻擋/.test(r),'blocked content msg');
 r=await run(async()=>{throw new TypeError('x')});
 ok(/網路/.test(r),'network error msg');
 ok(!!d.getElementById('gallery-input')&&!d.getElementById('gallery-input').hasAttribute('capture'),'gallery input has no capture');
})();
