# 실서비스 모드 화면 점검: 팀 초대·수락, 팀 조회 기록, 공유 링크, CSV, 추가 조회 묶음
# run-live-tests.sh 와 같은 가짜 서버(54400·54401) + dev-server(3100)가 떠 있어야 합니다.
import sys, json, time, urllib.request
from playwright.sync_api import sync_playwright
APP, SB = 'http://127.0.0.1:3100', 'http://127.0.0.1:54400'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
RUN = str(int(time.time()))
passed = 0
def ok(n):
    global passed; passed += 1; print('  ✓', n)
def req(url, method='GET', body=None, headers=None):
    r = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        with urllib.request.urlopen(r) as res: return json.loads(res.read() or b'{}')
    except urllib.error.HTTPError as e: return json.loads(e.read() or b'{}')
def signup(email):
    return req(f'{SB}/auth/v1/signup', 'POST', {'email': email, 'password': 'secret123'}, {'apikey': 'test-anon-key'})
def api(path, tok, method='GET', body=None):
    return req(f'{APP}/api/{path}', method, body, {'Authorization': 'Bearer ' + tok})

owner, member = signup(f'owner-{RUN}@test.com'), signup(f'member-{RUN}@test.com')
ot, mt = owner['access_token'], member['access_token']
api('trial', ot, 'POST')
rep = api('search', ot, 'POST', {'query': 'Sahara Polymer', 'autoPick': True})['report']
api('team', ot, 'POST', {'action': 'invite', 'email': f'member-{RUN}@test.com'})

def session_page(b, sess, w=1280):
    ctx = b.new_context(viewport={'width': w, 'height': 900}, accept_downloads=True)
    s = {'access_token': sess['access_token'], 'refresh_token': sess['refresh_token'], 'expires_at': int(time.time()) + 3600, 'user': sess['user']}
    ctx.add_init_script(f"localStorage.setItem('tc.session', {json.dumps(json.dumps(s))})")
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    return pg, errs

with sync_playwright() as p:
    b = p.chromium.launch()
    pg, errs = session_page(b, member)
    pg.goto(APP + '/app/#/search'); pg.wait_for_selector('#inviteAccept')
    ok('멤버: 조회 화면에 초대 배너')
    pg.click('#inviteAccept'); pg.wait_for_function("!document.getElementById('inviteAccept')")
    pg.goto(APP + '/app/#/billing'); pg.wait_for_selector('#teamLeave')
    assert '함께 쓰고 있습니다' in pg.inner_text('#view')
    pg.screenshot(path=f'{OUT}/team-member-billing.png', full_page=True)
    ok('멤버: 수락 후 요금제 화면에 팀 소속 표시, 요금제 결제 잠금')
    pg.goto(APP + '/app/#/search'); pg.fill('#q', 'Kestrel Imports'); pg.click('#searchForm button[type=submit]'); pg.wait_for_selector('#dealAmt', timeout=8000)
    assert not errs, errs

    pg, errs = session_page(b, owner)
    pg.goto(APP + '/app/#/billing'); pg.wait_for_selector('#teamInvite')
    t = pg.inner_text('#teamBox'); assert f'member-{RUN}@test.com' in t and '2 / 5석' in t, t
    assert pg.locator('[data-product=addon10_team]').count() == 0 and '체험 중에는 추가 조회 묶음을 살 수 없습니다' in pg.inner_text('#view')
    pg.screenshot(path=f'{OUT}/team-owner-billing.png', full_page=True)
    ok('소유자(체험): 팀원 목록·좌석 수, 체험 중 추가 묶음 숨김')
    pg.fill('#inviteEmail', f'third-{RUN}@test.com'); pg.click('#teamInvite button'); pg.wait_for_selector('[data-rm-invite]')
    ok('소유자: 화면에서 초대 → 대기 목록에 추가')
    pg.goto(APP + '/app/#/history?scope=team'); pg.wait_for_selector('[data-scope=team][aria-pressed=true]')
    assert f'member-{RUN}@test.com' in pg.inner_text('#hist')
    ok('소유자: 조회 기록 "팀 전체"에 팀원 조회 표시')
    with pg.expect_download() as d: pg.click('#csvGo')
    csv = open(d.value.path(), encoding='utf-8-sig').read(); assert '회사명' in csv and 'Kestrel' in csv
    ok('CSV 내보내기 (팀원 조회 포함, 엑셀 호환 BOM)')
    pg.goto(APP + '/app/#/report/' + rep['id']); pg.wait_for_selector('#actShare')
    pg.context.grant_permissions(['clipboard-read', 'clipboard-write'])
    pg.click('#actShare'); pg.wait_for_selector('#shareNote')
    link = pg.inner_text('#shareNote').split('\n')[1].split(' ')[0].strip()
    assert '/share.html?t=' in link, link
    ok('리포트: 공유 링크 만들기·복사')
    sp = b.new_page(viewport={'width': 390, 'height': 844}); sp.goto(link); sp.wait_for_selector('.grade')
    assert 'Sahara Polymer' in sp.inner_text('#view') and '읽기 전용' in sp.inner_text('#view')
    assert sp.evaluate('document.documentElement.scrollWidth') <= 390
    sp.screenshot(path=f'{OUT}/share-mobile.png', full_page=True)
    ok('공유 페이지: 로그인 없이 열람, 모바일 넘침 없음')
    pg.click('#shareOff'); pg.wait_for_selector('#shareNote', state='detached')
    sp.reload(); sp.wait_for_selector('text=리포트를 열 수 없습니다')
    ok('링크 끄기 → 공유 페이지 즉시 차단')
    assert not errs, errs
    b.close()
print(f'\n{passed}개 통과')
