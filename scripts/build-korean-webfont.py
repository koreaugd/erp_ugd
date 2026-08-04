#!/usr/bin/env python3
"""public/fonts 의 Noto Sans KR 웹폰트를 다시 만든다.

평소에는 돌릴 일이 없다. **무게를 늘리거나 글꼴을 바꿀 때만** 쓴다.
결과물(woff2)은 저장소에 함께 커밋되어 있으므로, 이 스크립트 없이도 빌드·배포는 된다.

  준비:  py -m pip install fonttools brotli
  실행:  py scripts/build-korean-webfont.py
  이후:  src/fonts.css 의 @font-face 목록과 index.html 의 preload 를 결과에 맞게 손본다.

받는 곳은 fontsource(구글 폰트를 그대로 재배포하는 공개 CDN)다. 구글 CSS2 API 를 쓰지 않는
이유는 src/fonts.css 맨 위 주석 참고 — 거기서 주는 건 한글을 124조각으로 자른 파일들이라
"화면에 그 글자가 나올 때 뒤늦게 한 조각씩" 받게 되고, 그게 글꼴이 늦게 바뀌는 원인이었다.

만드는 파일(무게 400·500·700·900 각각):
  noto-sans-kr-korean-<w>.woff2      한글 11,172자 전부 + 아스키 (fontsource 통짜 파일 그대로)
  noto-sans-kr-latin-<w>.woff2       영문·숫자·기본 문장부호      (그대로)
  noto-sans-kr-latin-ext-<w>.woff2   확장 라틴(₩ 등)              (그대로)
  noto-sans-kr-symbols-<w>.woff2     위 셋에 없는 기호만          (이 스크립트가 합쳐서 만든다)

symbols 를 따로 만드는 이유: fontsource 의 korean/latin 묶음에는 ▲ ▼ → ※ ① ─ Σ 같은 글자가
빠져 있다(구글은 그 글자들을 번호 서브셋 쪽에 넣어 둔다). 그대로 두면 **그 글자만** 시스템
글꼴로 떨어져 모양이 튄다. 그래서 그 글자를 담은 번호 서브셋들만 받아 하나로 합친다.
"""
import os
import re
import urllib.request

from fontTools.merge import Merger
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

CDN = "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-kr@5"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "fonts")
TMP = os.path.join(ROOT, "node_modules", ".cache", "korean-webfont")
WEIGHTS = [400, 500, 700, 900]
PLAIN = ["korean", "latin", "latin-ext"]

# symbols 파일이 담을 후보 구간. 지금 화면에 쓰는 기호(↗ ▲ ▼ → ※ ① ─ ≈ Σ)보다 넉넉히 잡아
# 나중에 기호 하나를 더 써도 이 스크립트를 다시 돌릴 필요가 없게 한다. 실제로는 이 중
# Noto Sans KR 이 가진 글자만 남는다(✓ ⚠ ⭐ 처럼 원래 없는 건 그대로 시스템 글꼴로 간다).
WANTED = set()
WANTED |= set(range(0x2010, 0x2070))   # 일반 문장부호 ‹ › • … ※
WANTED |= set(range(0x2190, 0x2200))   # 화살표 ← ↑ → ↓ ↔ ↗
WANTED |= set(range(0x2200, 0x2300))   # 수학 기호 ≈ ≒ ≥
WANTED |= set(range(0x2460, 0x2500))   # 원 숫자 ① ② ③
WANTED |= set(range(0x2500, 0x2580))   # 괘선 ─ │
WANTED |= set(range(0x25A0, 0x2600))   # 도형 ▲ ▼ ■ ●
WANTED |= set(range(0x2600, 0x27C0))   # 기타 기호·딩벳 ★ ♪
WANTED |= set(range(0x0391, 0x03CA))   # 그리스 Σ
WANTED |= set(range(0xFF01, 0xFF60))   # 전각 형태 ！ ～


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def cached(url, name):
    os.makedirs(TMP, exist_ok=True)
    p = os.path.join(TMP, name)
    if not os.path.exists(p):
        with open(p, "wb") as f:
            f.write(fetch(url))
    return p


def build_symbols(weight):
    """WANTED 를 담은 번호 서브셋만 받아 하나로 합친 뒤 필요한 글자만 남긴다."""
    css = fetch("%s/%d.css" % (CDN, weight)).decode("utf-8")
    blocks = re.findall(
        r"noto-sans-kr-\[(\d+)\]-%d-normal.*?unicode-range:\s*([^;]+);" % weight, css, re.S)
    paths = []
    for idx, rng in blocks:
        hit = False
        for part in rng.split(","):
            body = part.strip()[2:]
            lo, hi = (body.split("-") + [None])[:2] if "-" in body else (body, body)
            if any(int(lo, 16) <= c <= int(hi, 16) for c in WANTED):
                hit = True
                break
        if not hit:
            continue
        src = cached("%s/files/noto-sans-kr-%s-%d-normal.woff2" % (CDN, idx, weight),
                     "s%s-%d.woff2" % (idx, weight))
        # merge 는 woff2 로 압축된 파일을 받지 않는다 — 평범한 ttf 로 풀어 둔다.
        f = TTFont(src)
        f.flavor = None
        ttf = src[:-6] + ".ttf"
        f.save(ttf)
        paths.append(ttf)

    merged = TTFont(paths[0]) if len(paths) == 1 else Merger().merge(paths)
    opts = Options()
    opts.drop_tables += ["DSIG"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    ss = Subsetter(options=opts)
    ss.populate(unicodes=sorted(WANTED & set(merged.getBestCmap().keys())))
    ss.subset(merged)
    merged.flavor = "woff2"
    dst = os.path.join(OUT, "noto-sans-kr-symbols-%d.woff2" % weight)
    merged.save(dst)
    return dst, len(merged.getBestCmap())


def main():
    os.makedirs(OUT, exist_ok=True)
    for w in WEIGHTS:
        for subset in PLAIN:
            dst = os.path.join(OUT, "noto-sans-kr-%s-%d.woff2" % (subset, w))
            with open(dst, "wb") as f:
                f.write(fetch("%s/files/noto-sans-kr-%s-%d-normal.woff2" % (CDN, subset, w)))
            print("  %-36s %7d bytes" % (os.path.basename(dst), os.path.getsize(dst)))
        dst, n = build_symbols(w)
        print("  %-36s %7d bytes (%d글자)" % (os.path.basename(dst), os.path.getsize(dst), n))

    # 안전 확인 — 한 무게라도 한글이 빠지면 그 무게의 글자만 시스템 글꼴로 떨어진다.
    print("\n한글 커버리지 확인")
    for w in WEIGHTS:
        cm = set(TTFont(os.path.join(OUT, "noto-sans-kr-korean-%d.woff2" % w)).getBestCmap())
        got = sum(1 for c in range(0xAC00, 0xD7A4) if c in cm)
        print("  weight %d: 완성형 한글 %d/11172 %s" % (w, got, "OK" if got == 11172 else "부족!"))


if __name__ == "__main__":
    main()
