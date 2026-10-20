# 실데이터 모드 화면 점검 — mock-data-sources + DATA_PROVIDER=live 로 띄운 dev-server(3200)에서 실행
import sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3200'
OUT = sys.argv[2] if len(sys.argv) > 2 else '.'
passed = 0
def ok(name):
    global passed; passed += 1; print('  ✓', name)
with sync_playwright() as p:
    b = p.chromium.launch()
    for vp, tag in [((1280, 900), 'desktop'), ((390, 844), 'mobile')]:
        pg = b.new_page(viewport={'width': vp[0], 'height': vp[1]})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '/app/#/search')
        pg.wait_for_selector('#qc')
        assert pg.locator('.chip.static.on').count() >= 2
        ok(f'[{tag}] 국가 선택·연결된 데이터 표시')
        pg.fill('#q', 'acme global'); pg.select_option('#qc', 'AE'); pg.click('#searchForm button[type=submit]')
        pg.wait_for_selector('.candidate', timeout=8000)
        assert pg.locator('.candidate').count() == 3
        ok(f'[{tag}] 후보 3개 (등록부 2 + 등기 없이 조회)')
        pg.screenshot(path=f'{OUT}/live-{tag}-candidates.png', full_page=True)
        pg.locator('.candidate').first.click()
        pg.wait_for_selector('.cov', timeout=8000)
        txt = pg.inner_text('#view')
        assert '1/6' in txt and '보수적으로' in txt and 'K-SURE' in txt and 'GLEIF' in txt
        ok(f'[{tag}] 리포트: 충실도 1/6, 등급 상한 안내, 출처 목록')
        sw = pg.evaluate('document.documentElement.scrollWidth'); assert sw <= vp[0], sw
        ok(f'[{tag}] 가로 넘침 없음')
        pg.screenshot(path=f'{OUT}/live-{tag}-report.png', full_page=True)
        # 제재 일치 회사
        pg.goto(BASE + '/app/#/search?q=rogue%20arms')
        pg.wait_for_selector('.candidate', timeout=8000)
        pg.locator('.candidate').first.click()
        pg.wait_for_selector('.cov', timeout=8000)
        t2 = pg.inner_text('#view')
        assert '로그인 후 실서비스에서 확인합니다' in t2 and '근거 보기' not in t2
        ok(f'[{tag}] 로그인 없는 데모에서는 유료 출처(제재 명단)를 부르지 않음')
        if tag == 'desktop': pg.screenshot(path=f'{OUT}/live-{tag}-sanction.png', full_page=True)
        assert not errs, errs
        ok(f'[{tag}] 스크립트 오류 없음')
    b.close()
print(f'\n{passed}개 통과')
