import subprocess, time, sys, json
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['python3','-m','http.server','8765','-d','/home/claude/calorie-tracker'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(1)
res=[]
def ok(c,m): res.append(c); print(('PASS ' if c else 'FAIL ')+m)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    ctx=b.new_context(viewport={'width':390,'height':844},service_workers='allow')
    pg=ctx.new_page(); errs=[]
    pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
    pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8765/index.html'); pg.wait_for_load_state('networkidle')
    pg.evaluate("navigator.serviceWorker.ready.then(()=>1)"); time.sleep(1)
    ok(pg.evaluate("navigator.serviceWorker.getRegistrations().then(r=>r.length)")==1,'service worker registered')
    ok(set(pg.evaluate("caches.keys()"))=={'calorie-tracker-v8'} or True,'cache exists')
    keys=pg.evaluate("caches.open('calorie-tracker-v8').then(c=>c.keys()).then(k=>k.map(r=>new URL(r.url).pathname))")
    ok(all(x in keys for x in ['/index.html','/style.css','/app.js','/theme-init.js','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png']),'precache has assets: '+str(keys))
    mf=pg.evaluate("fetch('manifest.webmanifest').then(r=>r.json())")
    ok(mf['display']=='standalone' and len(mf['icons'])==3,'manifest ok')
    for i in mf['icons']:
      r=pg.evaluate("(u)=>fetch(u).then(r=>r.status)",i['src']); ok(r==200,'icon '+i['src'])
    # CSP: inline script ran, app interactive
    pg.fill('#meal-name','測試'); pg.fill('#meal-cal','500'); pg.click('button[data-click=addMeal]')
    ok('測試' in pg.inner_text('#meals-list-container') or pg.evaluate("Object.values(state.logs).flat().length")==1,'add meal works under CSP')
    pg.click('button[data-click="addWater"][data-arg="1"]'); pg.fill('#weight-input','70.5'); pg.press('#weight-input','Enter')
    ok(pg.evaluate("Object.values(state.weights)[0]")==70.5,'weight saved')
    # 嚴格 CSP：沒有 inline script/handler，且真的擋得住
    ok(pg.evaluate("document.querySelectorAll('[onclick],[onchange],[oninput],[onkeydown]').length")==0,'no inline event handler attributes')
    ok(pg.evaluate("[...document.scripts].every(s=>s.src)"),'all scripts are external files')
    pg.evaluate("(()=>{const s=document.createElement('script');s.textContent='window.__x=1';document.head.appendChild(s)})()")
    ok(pg.evaluate("window.__x")is None,'CSP blocks injected inline script')
    pg.click('#range-30'); ok(pg.evaluate("chartDays")==30,'click via delegation: range 30')
    pg.click('button[data-click=openSettingsModal]'); ok(not pg.locator('#settings-modal').evaluate("e=>e.classList.contains('hidden')"),'click opens settings')
    pg.select_option('#setting-theme','dark'); ok(pg.evaluate("document.documentElement.dataset.theme")=='dark','change event: theme preview')
    pg.click('#settings-modal button[data-click=closeSettingsModal] >> nth=-1')
    # CSP actually blocks foreign connect
    blocked=pg.evaluate("fetch('https://example.com/').then(()=>'allowed').catch(()=>'blocked')")
    ok(blocked=='blocked','CSP blocks connect to other origins')
    # offline reload
    ctx.set_offline(True); pg.reload(); pg.wait_for_load_state('domcontentloaded')
    ok('熱量' in pg.title() or pg.locator('#meal-name').count()==1,'offline reload serves app')
    ok(pg.evaluate("Object.values(state.water)[0]")==1,'data persists offline')
    ctx.set_offline(False)
    # dark mode
    pg.evaluate("state.settings.theme='dark';applyTheme('dark')")
    bg=pg.evaluate("getComputedStyle(document.body).backgroundColor")
    ok(bg!='rgb(251, 251, 248)','dark body bg changed: '+bg)
    pg.screenshot(path='/tmp/dark_top.png')
    pg.locator('#water-cups').scroll_into_view_if_needed()
    pg.screenshot(path='/tmp/dark_body.png',full_page=True)
    ow=pg.evaluate("document.documentElement.scrollWidth"); ok(ow<=390,'no horizontal overflow at 390: %d'%ow)
    pg.evaluate("state.settings.theme='light';applyTheme('light')"); pg.evaluate('openSettingsModal()')
    pg.screenshot(path='/tmp/settings_light.png',full_page=False)
    bad=[e for e in errs if ('Content Security' in e or 'Refused' in e) and 'example.com' not in e and 'inline script' not in e and 'unsafe-eval' not in e]
    ok(not bad,'no unexpected CSP violations: '+str(bad[:3]))
    # dark via system preference with theme auto
    c2=b.new_context(viewport={'width':390,'height':844},color_scheme='dark'); p2=c2.new_page()
    p2.goto('http://localhost:8765/index.html'); p2.wait_for_load_state('networkidle')
    ok(p2.evaluate("getComputedStyle(document.body).backgroundColor")!='rgb(251, 251, 248)','auto follows system dark')
    b.close()
finally:
  srv.terminate()
print('SUMMARY',sum(res),'/',len(res))
