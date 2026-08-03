"""02 AGENT_포스매출연동 산출물(YYMM_포스매출.xlsx) -> 매출집계 seed.json

  python scripts/build-sales-summary-seed.py <포스매출.xlsx> <YYYY-MM> <출력.json>

핵심 규칙 — POS 파일의 '자리값' 한 칸에 두 개념이 섞여 있어 나눠 담는다.
  커버차지(coverCharge) : POS 실매출에 포함된 자릿값. 메뉴+주류가 실매출보다 자리값만큼 모자란 지점.
  예약정산금(seatCharge): 캐치테이블 정산금. POS 실매출 밖의 돈이라 메뉴+주류가 이미 실매출과 같다.
파일에 '자리값내역'(예: "POS 8,140,000 + 캐치테이블 40,000")이 있으면 그 분해를 그대로 쓰고,
없으면 위 검산으로 판정한다.

검산(메뉴+주류+커버 == 실매출)이 맞지 않는 지점은 seed 에서 제외한다 — 넣어봐야 화면에서
붉은 경고가 뜨고 마감제출이 막히므로, 사람이 원인을 확인해야 한다.
"""
import json
import re
import sys

import openpyxl

# POS 지점명 -> ERP 지점명(public_branches). 표기가 다른 곳만 적는다.
BRANCH_ALIAS = {
    "연하동 연남점": "연하동 연남본점",
    "연하동 대학로": "연하동 대학로점",
    "강남 대골뼈국": "강남대골뼈국",
}

COL = {"code": 2, "name": 3, "total": 5, "discount": 6, "net": 7, "receipt": 8,
       "payCash": 11, "payCashReceipt": 12, "payCard": 13, "menu": 16, "liquor": 17, "seat": 18, "seatMemo": 19}


def n(v):
    return int(v) if isinstance(v, (int, float)) else 0


def split_seat(menu, liquor, net, seat, memo):
    """자리값을 (커버차지, 예약정산금)으로 나눈다."""
    m = re.search(r"POS\s*([\d,]+)\s*\+\s*캐치테이블\s*([\d,]+)", str(memo or ""))
    if m:
        return int(m.group(1).replace(",", "")), int(m.group(2).replace(",", ""))
    # 내역이 없으면 검산으로 판정: 메뉴+주류가 실매출보다 자리값만큼 모자라면 자리값이 실매출 안(=커버차지).
    if seat and menu + liquor + seat == net:
        return seat, 0
    # 그 밖에는 실매출 밖의 돈 = 예약정산금.
    return 0, seat


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    opts = [a for a in sys.argv[1:] if a.startswith("--")]
    if len(args) < 3:
        print("사용법: python scripts/build-sales-summary-seed.py <포스매출.xlsx> <YYYY-MM> <출력.json>"
              " [--include-mismatched] [--exclude=지점명,지점명]")
        sys.exit(1)
    xlsx, month, out_path = args[0], args[1], args[2]
    # 검산이 안 맞는 지점도 담는다. 화면엔 붉은 경고가 뜨고 마감제출이 막히므로, 사람이 알고 쓸 때만.
    include_mismatched = "--include-mismatched" in opts
    excluded = set()
    for o in opts:
        if o.startswith("--exclude="):
            excluded |= {s.strip() for s in o[len("--exclude="):].split(",") if s.strip()}

    ws = openpyxl.load_workbook(xlsx, data_only=True).worksheets[0]
    documents, skipped = [], []
    for r in list(ws.iter_rows(values_only=True))[1:]:
        if not r[COL["code"]]:
            continue
        pos_name = str(r[COL["name"]]).strip()
        branch = BRANCH_ALIAS.get(pos_name, pos_name)
        menu, liquor, net = n(r[COL["menu"]]), n(r[COL["liquor"]]), n(r[COL["net"]])
        cover, reserve = split_seat(menu, liquor, net, n(r[COL["seat"]]), r[COL["seatMemo"]])

        if branch in excluded:
            skipped.append({"branchName": branch, "gap": 0, "why": "명시적 제외"})
            continue
        gap = menu + liquor + cover - net
        if gap != 0 and not include_mismatched:
            skipped.append({"branchName": branch, "gap": gap, "why": "검산 불일치"})
            continue

        values = {
            "totalSales": str(n(r[COL["total"]])),
            "totalDiscount": str(n(r[COL["discount"]])),
            "netSales": str(net),
            "menuSales": str(menu),
            "liquorSales": str(liquor),
            "coverCharge": str(cover),
            "seatCharge": str(reserve),
        }
        # 결제구성·영수건수는 화면에서 없앤 레거시다. 새로 만들어 넣지는 않되,
        # 이 지점에 이미 값이 있으면 실매출과 어긋나 안내가 뜨므로 같은 출처(POS)로 함께 갱신한다.
        legacy = {
            "receiptCount": str(n(r[COL["receipt"]])),
            "cardPay": str(n(r[COL["payCard"]])),
            "cashPlain": str(n(r[COL["payCash"]])),
            "cashReceipt": str(n(r[COL["payCashReceipt"]])),
        }
        documents.append({"branchName": branch, "values": values, "legacyValues": legacy})

    json.dump({"month": month, "documents": documents, "skipped": skipped},
              open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"대상 {len(documents)}개 지점, 제외 {len(skipped)}개")
    for s in skipped:
        print(f"  제외: {s['branchName']}  검산차이 {s['gap']:+,}")
    print(f"저장: {out_path}")


if __name__ == "__main__":
    main()
