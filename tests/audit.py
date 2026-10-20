# 화면 점검: 여러 너비에서 가로 넘침, 작은 터치 영역, 잘린 글자, JS 오류를 찾고 스크린샷을 남깁니다.
# 사용: python3 tests/audit.py <base_url> <out_dir> [tag]
import sys, json
from playwright.sync_api import sync_playwright

BASE, OUT = sys.argv[1], sys.argv[2]
TAG = sys.argv[3] if len(sys.argv) > 3 else 'a'
WIDTHS = [360, 390, 768, 1024, 1440]
PAGES = [
    ('landing', '/', None),
    ('search', '/app/#/search', None),
    ('report', '/app/#/search', 'report'),
    ('history', '/app/#/history', None),
    ('watch', '/app/#/watchlist', None),
    ('billing', '/app/#/billing?product=team_month', None),
    ('compare', '/app/#/history', 'compare'),
]
CHECK = """
() => {
  const vw = document.documentElement.clientWidth;
  const over = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || getComputedStyle(el).visibility === 'hidden') continue;
    if (r.right > vw + 1 || r.left < -1) {
      let p = el.parentElement, clipped = false;
      while (p && p !== document.body) {
        const cs = getComputedStyle(p);
        if (cs.overflowX !== 'visible' || cs.overflow === 'hidden') { const pr = p.getBoundingClientRect(); if (pr.right <= vw + 1 && pr.left >= -1) { clipped = true; break; } }
        p = p.parentElement;
      }
      if (!clipped) over.push((el.tagName + ' ' + (el.textContent || '').trim().slice(0, 30)));
    }
  }
  const small = [];
  for (const el of document.querySelectorAll('a, button, input, select, summary, [role=tab]')) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.closest('p, li') && cs.display === 'inline') continue;   // 문장 속 링크는 제외
    if (r.height < 36 || r.width < 36) small.push(el.tagName + ' "' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 18) + '" ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  const ellipsized = [...document.querySelectorAll('.name')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim().slice(0, 30));
  return { sw: document.documentElement.scrollWidth, vw, over: over.slice(0, 8), small: [...new Set(small)].slice(0, 12), ellipsized };
}
"""
report = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    for w in WIDTHS:
        ctx = b.new_context(viewport={'width': w, 'height': 860}, is_mobile=w < 800, has_touch=w < 800)
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        # 샘플 조회 기록 만들기
        pg.goto(BASE + '/app/#/search'); pg.wait_for_timeout(600)
        for q in ['Helvetia Industrial Supply AG', 'Sahara Polymer Trading', 'Brightline Import Co.']:
            pg.goto(BASE + '/app/#/search?q=' + q); pg.wait_for_url('**/#/report/**', timeout=10000)
        for name, path, special in PAGES:
            pg.goto(BASE + path); pg.wait_for_timeout(900)
            if special == 'report':
                pg.fill('#q', 'Northwind Global Trading LLC'); pg.keyboard.press('Enter')
                pg.wait_for_selector('.candidate', timeout=8000); pg.locator('.candidate').first.click()
                pg.wait_for_url('**/#/report/**', timeout=10000); pg.wait_for_timeout(500)
            if special == 'compare':
                boxes = pg.locator('input[data-pick]')
                if boxes.count() >= 2:
                    boxes.nth(0).check(); boxes.nth(1).check(); boxes.nth(2).check() if boxes.count() > 2 else None
                    pg.click('#compareGo'); pg.wait_for_timeout(800)
                else:
                    report.setdefault(name, {})[w] = 'compare UI missing'; continue
            r = pg.evaluate(CHECK)
            r['errors'] = errs[:]
            report.setdefault(name, {})[w] = r
            pg.screenshot(path=f'{OUT}/{TAG}-{name}-{w}.png', full_page=True)
        ctx.close()
    b.close()

for name, by_w in report.items():
    for w, r in by_w.items():
        if isinstance(r, str):
            print(f'{name:8} {w:5} {r}'); continue
        flags = []
        if r['sw'] > r['vw']: flags.append(f"가로넘침 {r['sw']}>{r['vw']}")
        if r['over']: flags.append('넘친요소 ' + ' | '.join(r['over'][:3]))
        if r['small']: flags.append('작은터치 ' + ' | '.join(r['small'][:6]))
        if r['ellipsized']: flags.append('잘림 ' + ' | '.join(r['ellipsized'][:3]))
        if r['errors']: flags.append('JS오류 ' + ' | '.join(r['errors'][:2]))
        print(f'{name:8} {w:5} ' + ('OK' if not flags else ' / '.join(flags)))
