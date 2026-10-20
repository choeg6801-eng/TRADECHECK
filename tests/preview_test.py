# 미리보기 단일 HTML을 file:// 로 직접 열어 전체 흐름을 테스트합니다.
import sys, re
from playwright.sync_api import sync_playwright, expect

FILE = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp'
URL = 'file://' + FILE
passed = []
def ok(m): passed.append(m); print('  ✓', m)

with sync_playwright() as p:
    b = p.chromium.launch()
    errors, failed = [], []
    for w in (1440, 390):
        mobile = w < 800
        ctx = b.new_context(viewport={'width': w, 'height': 880}, is_mobile=mobile, has_touch=mobile)
        ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(f'{w}: {e}'))
        pg.on('requestfailed', lambda r: failed.append(r.url[:90]) if not r.url.startswith(('https://fonts.', 'data:')) else None)
        pg.goto(URL); pg.wait_for_timeout(800)
        tag = f'[{w}px]'

        assert pg.locator('#landing').is_visible() and not pg.locator('#appShell').is_visible()
        n_img = pg.evaluate("[...document.querySelectorAll('#landing img')].length")
        pg.evaluate("window.scrollTo(0, document.body.scrollHeight)"); pg.wait_for_timeout(800); pg.evaluate("window.scrollTo(0,0)")
        loaded = pg.evaluate("[...document.querySelectorAll('#landing img')].filter(i => i.complete && i.naturalWidth > 0).length")
        assert loaded == n_img, (loaded, n_img)
        assert pg.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        ok(f'{tag} 랜딩 표시, 사진 {loaded}/{n_img}장, 가로 넘침 없음')

        # 체험 섹션
        pg.locator('#try').scroll_into_view_if_needed()
        expect(pg.locator('#tryOut')).to_contain_text('Northwind')
        pg.click('[data-b="helvetia-ch"]'); expect(pg.locator('#tryOut .tt-grade')).to_contain_text('A')
        pg.click('[data-b="brightline"]'); expect(pg.locator('#tryOut')).to_contain_text('거래 보류')
        pg.click('[data-b="nw-global-ae"]'); pg.click('[data-t="lc"]'); expect(pg.locator('#tryOut')).to_contain_text('수락해도')
        pg.locator('#tryAmt').fill('300000'); expect(pg.locator('#tryAmtOut')).to_have_text('USD 300,000')
        pg.locator('#try').screenshot(path=f'{OUT}/pv-try-{w}.png')
        ok(f'{tag} 체험 섹션: 바이어·금액·조건 바꾸면 결과 즉시 변경')

        # 모바일 메뉴 / 고정 버튼
        if mobile:
            pg.evaluate("window.scrollTo(0, 0)"); pg.wait_for_timeout(300)
            pg.click('summary[aria-label="메뉴 열기"]'); pg.click('.tc-menu a[href="#pricing"]'); pg.wait_for_timeout(600)
            assert not pg.evaluate("document.querySelector('.tc-menu').open")
            expect(pg.locator('#stickyCta')).to_have_class(re.compile('show'))
            ok(f'{tag} 햄버거 메뉴 이동 후 닫힘, 하단 고정 버튼 노출')

        # 전체 리포트 보기 → 앱
        pg.locator('#try').scroll_into_view_if_needed()
        pg.click('#tryOut .tt-go')
        pg.wait_for_selector('.candidate, #dealAmt', timeout=8000)  # 정확한 이름이면 바로 리포트
        assert pg.locator('#appShell').is_visible() and not pg.locator('#landing').is_visible()
        if pg.locator('.candidate').count(): pg.locator('.candidate').first.click()
        pg.wait_for_url(re.compile(r'#/report/'), timeout=10000)
        expect(pg.locator('.report-id h1')).to_have_text('Northwind Global Trading LLC')
        ok(f'{tag} 체험 → 앱 전환 → 후보 선택 → 리포트')

        pg.fill('#dealAmt', '250000'); pg.select_option('#dealTerm', 'tt90')
        expect(pg.locator('#dealOut')).to_contain_text('USD 250,000')
        pg.click('#actMemo')
        memo = pg.evaluate('navigator.clipboard.readText()')
        assert '해외 바이어 신용 검증 결과 보고' in memo and 'USD 250,000' in memo and 'T/T 후불 90일' in memo, memo
        pg.click('#actCopy'); assert 'irrevocable L/C' in pg.evaluate('navigator.clipboard.readText()')
        pg.click('#actCmp'); pg.click('#actWatch')
        pg.screenshot(path=f'{OUT}/pv-report-{w}.png', full_page=True)
        ok(f'{tag} 계산기(USD 250,000·후불 90일) → 품의서 문구에 반영, 영문 문구 복사, 비교함·관심 추가')

        # 랜딩 히어로 검색
        pg.goto(URL + '#top'); pg.wait_for_timeout(400)
        assert pg.locator('#landing').is_visible()
        pg.fill('#fc-q', 'Sahara Polymer'); pg.press('#fc-q', 'Enter')
        pg.wait_for_url(re.compile(r'#/report/'), timeout=10000)
        expect(pg.locator('.report-id .grade')).to_contain_text('D')
        pg.click('#actCmp')
        ok(f'{tag} 랜딩 검색창 → D등급 리포트')

        # 비교
        pg.goto(URL + '#/history'); pg.wait_for_timeout(500)
        pg.click('#compareGo'); pg.wait_for_url(re.compile(r'#/compare'), timeout=5000)
        expect(pg.locator('.cmp tbody tr')).to_have_count(9)
        expect(pg.locator('.cmp')).to_contain_text('가장 안전')
        assert pg.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        pg.screenshot(path=f'{OUT}/pv-compare-{w}.png', full_page=True)
        ok(f'{tag} 바이어 비교표 (가로 넘침 없음)')

        pg.goto(URL + '#/watchlist'); pg.wait_for_selector('[data-recheck]')
        pg.goto(URL + '#/billing?product=team_year'); expect(pg.locator('#sum')).to_contain_text('₩2,098,800')
        assert pg.locator('#payBtn').is_disabled()
        pg.click('.demo-banner a'); pg.wait_for_timeout(400)
        assert pg.locator('#landing').is_visible()
        ok(f'{tag} 관심 거래처·요금제 화면, 소개 페이지로 돌아가기')

        pdf = pg.goto(URL + '#/history') and None
        ctx.close()
    b.close()
    print('\n페이지 JS 오류:', errors or '없음')
    print('불러오기 실패:', failed or '없음')
    print(f'{len(passed)}개 미리보기 시나리오 통과')
    if errors or failed: sys.exit(1)
