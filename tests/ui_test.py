# 브라우저 화면 테스트 (Playwright). 데모 모드: 3000번 포트, 실서비스 모드: 3100번 포트
import json, sys, re
from playwright.sync_api import sync_playwright, expect

SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
results = []
def ok(msg): results.append(msg); print('  ✓', msg)

def overflow(page):
    return page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")

with sync_playwright() as p:
    b = p.chromium.launch()
    errors = []

    # ================= 데모 모드 =================
    ctx = b.new_context(viewport={'width': 1366, 'height': 900})
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    D = 'http://127.0.0.1:3000'

    pg.goto(D + '/')
    pg.fill('#fc-q', 'Helvetia Industrial Supply AG')
    pg.click('.tc-hero-btn')
    pg.wait_for_url(re.compile(r'/app/#/report/'), timeout=10000)
    expect(pg.locator('.report-id h1')).to_have_text('Helvetia Industrial Supply AG')
    expect(pg.locator('.guide h2')).to_have_text('TT 후불 수락 가능')
    ok('데모: 랜딩 검색창 → 앱 조회 → A등급 리포트')

    pg.goto(D + '/app/#/search')
    pg.fill('#q', 'Northwind')
    pg.click('#searchForm button[type=submit]')
    pg.wait_for_selector('.candidate', timeout=8000)
    assert pg.locator('.candidate').count() == 2
    pg.screenshot(path=f'{SHOTS}/demo-candidates.png')
    pg.locator('.candidate').first.click()
    pg.wait_for_url(re.compile(r'#/report/'), timeout=10000)
    expect(pg.locator('.grade').first).to_contain_text('C')
    ok('데모: 동명 법인 후보 선택 → C등급')

    pg.click('#actCopy')
    clip = pg.evaluate('navigator.clipboard.readText()')
    assert 'irrevocable L/C at sight' in clip, clip
    pg.click('#actMemo')
    assert '해외 바이어 신용 검증 결과 보고' in pg.evaluate('navigator.clipboard.readText()')
    ok('데모: 영문 협상 문구·품의서 문구 복사')

    pg.click('#actWatch'); pg.wait_for_selector('.toast')
    pg.screenshot(path=f'{SHOTS}/demo-report.png', full_page=True)
    pg.emulate_media(media='print'); pg.screenshot(path=f'{SHOTS}/demo-report-print.png', full_page=True); pg.emulate_media(media='screen')
    pdf = pg.pdf(format='A4', print_background=True)
    assert len(pdf) > 20000
    open(f'{SHOTS}/demo-report.pdf', 'wb').write(pdf)
    ok('데모: 관심 거래처 추가, PDF 저장(인쇄 레이아웃)')

    pg.goto(D + '/app/#/history'); pg.wait_for_selector('.listrow')
    assert pg.locator('.listrow').count() == 2
    pg.goto(D + '/app/#/watchlist'); pg.wait_for_selector('[data-recheck]')
    pg.click('[data-recheck]'); pg.wait_for_selector('.toast')
    ok('데모: 조회 기록 2건, 관심 거래처 다시 확인')

    for q, g in [('Brightline Import', 'F'), ('Sahara Polymer', 'D'), ('Kestrel Imports', 'B')]:
        pg.goto(D + '/app/#/search'); pg.fill('#q', q); pg.click('#searchForm button[type=submit]')
        pg.wait_for_url(re.compile(r'#/report/'), timeout=10000)
        expect(pg.locator('.report-id .grade')).to_contain_text(g)
    pg.screenshot(path=f'{SHOTS}/demo-report-B.png', full_page=True)
    ok('데모: F·D·B 등급 샘플 정상')

    pg.goto(D + '/app/#/billing?product=team_year')
    expect(pg.locator('#sum')).to_contain_text('₩2,098,800')
    assert pg.locator('#payBtn').is_disabled()
    pg.click('[data-cycle=month]')
    expect(pg.locator('#sum')).to_contain_text('₩218,900')
    pg.screenshot(path=f'{SHOTS}/demo-billing.png', full_page=True)
    ok('데모: 요금제 화면 (연간 2,098,800원 / 월간 218,900원, 결제 버튼 비활성)')

    pg.goto(D + '/login.html')
    expect(pg.locator('#demo')).to_be_visible()
    ok('데모: 로그인 화면은 체험 안내')

    m = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    mp = m.new_page(); mp.on('pageerror', lambda e: errors.append(str(e)))
    for path in ['/app/#/search', '/app/#/billing', '/login.html']:
        mp.goto(D + path); mp.wait_for_timeout(700)
        assert not overflow(mp), 'overflow ' + path
    mp.goto(D + '/app/#/search'); mp.fill('#q', 'Northwind'); mp.click('#searchForm button[type=submit]')
    mp.wait_for_selector('.candidate', timeout=8000); mp.locator('.candidate').first.tap()
    mp.wait_for_url(re.compile(r'#/report/'), timeout=10000); mp.wait_for_timeout(300)
    assert not overflow(mp), 'overflow report mobile'
    mp.screenshot(path=f'{SHOTS}/mobile-report.png', full_page=True)
    mp.goto(D + '/app/#/search'); mp.wait_for_timeout(500); mp.screenshot(path=f'{SHOTS}/mobile-search.png', full_page=True)
    ok('데모: 모바일(390px) 조회·리포트·요금제·로그인 가로 넘침 없음')

    # ================= 실서비스 모드 =================
    L = 'http://127.0.0.1:3100'
    lc = b.new_context(viewport={'width': 1366, 'height': 900})
    lp = lc.new_page(); lp.on('pageerror', lambda e: errors.append(str(e)))
    lp.goto(L + '/app/#/history')
    lp.wait_for_url(re.compile(r'/login\.html\?next='), timeout=8000)
    ok('실서비스: 비로그인 → 로그인 화면으로 이동')

    lp.click('#tabUp'); lp.fill('#email', 'ui@test.com'); lp.fill('#pw', 'secret123'); lp.click('#submit')
    lp.wait_for_url(re.compile(r'/app/#/history'), timeout=8000)
    expect(lp.locator('#planchip')).to_contain_text('남은 조회')
    expect(lp.locator('#planchip')).to_contain_text('3')
    lp.screenshot(path=f'{SHOTS}/live-after-signup.png')
    ok('실서비스: 회원가입 → 원래 가려던 화면으로 복귀, 남은 조회 3건')

    lp.goto(L + '/app/#/search'); lp.fill('#q', 'Sahara Polymer'); lp.click('#searchForm button[type=submit]')
    lp.wait_for_url(re.compile(r'#/report/[0-9a-f-]{36}'), timeout=10000)
    expect(lp.locator('.report-id .grade')).to_contain_text('D')
    expect(lp.locator('#planchip')).to_contain_text('2')
    lp.click('#actWatch'); expect(lp.locator('.toast')).to_contain_text('추가')
    ok('실서비스: 조회 → D등급 리포트 DB 저장, 남은 조회 2건, 관심 거래처 추가')

    lp.goto(L + '/app/#/billing?product=single'); lp.wait_for_timeout(2500)
    msg = lp.locator('#payMsg')
    toss_blocked = msg.is_visible()
    lp.screenshot(path=f'{SHOTS}/live-billing.png', full_page=True)
    ok('실서비스: 결제 화면 ' + ('(테스트 환경에서 토스 결제 모듈 접속 차단 → 안내 메시지 표시)' if toss_blocked else '(결제 위젯 로드)'))

    # 토스 결제창을 거쳐 돌아온 상황 재현: 주문 준비 → success 페이지로 복귀 → 승인
    order = lp.evaluate("""async () => {
      const s = JSON.parse(localStorage.getItem('tc.session'));
      const r = await fetch('/api/payments/prepare', {method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+s.access_token}, body: JSON.stringify({productId:'single'})});
      return r.json();
    }""")
    lp.goto(f"{L}/app/pay-success.html?paymentKey=pk_ui_1&orderId={order['orderId']}&amount={order['amount']}&paymentType=NORMAL")
    lp.wait_for_url(re.compile(r'#/payment/result'), timeout=8000)
    expect(lp.locator('h1')).to_contain_text('적용되었습니다', timeout=8000)
    expect(lp.locator('#planchip')).to_contain_text('3')
    lp.screenshot(path=f'{SHOTS}/live-paid.png')
    ok('실서비스: 결제 성공 복귀 → 승인 → 단건 크레딧 반영 (남은 조회 3건)')

    lp.goto(f"{L}/app/pay-fail.html?code=PAY_PROCESS_CANCELED&message=%EC%82%AC%EC%9A%A9%EC%9E%90%EA%B0%80%20%EA%B2%B0%EC%A0%9C%EB%A5%BC%20%EC%B7%A8%EC%86%8C%ED%96%88%EC%8A%B5%EB%8B%88%EB%8B%A4")
    expect(lp.locator('h1')).to_contain_text('완료되지 않았습니다', timeout=8000)
    ok('실서비스: 결제 취소 복귀 화면')

    lp.goto(L + '/app/#/watchlist'); lp.wait_for_selector('[data-recheck]')
    lp.screenshot(path=f'{SHOTS}/live-watchlist.png')
    lp.click('#logout'); lp.wait_for_url(re.compile(r'/login\.html'), timeout=8000)
    lp.fill('#email', 'ui@test.com'); lp.fill('#pw', 'wrongpass'); lp.click('#submit')
    expect(lp.locator('#msg')).to_contain_text('올바르지 않습니다')
    lp.fill('#pw', 'secret123'); lp.click('#submit'); lp.wait_for_url(re.compile(r'/app/'), timeout=8000)
    ok('실서비스: 로그아웃 → 잘못된 비밀번호 안내 → 재로그인')

    b.close()
    real_errors = [e for e in errors if 'tosspayments' not in e.lower()]
    print('\n페이지 JS 오류:', real_errors or '없음')
    print(f'{len(results)}개 화면 시나리오 통과')
    if real_errors: sys.exit(1)
