# -*- coding: utf-8 -*-
"""지점별 월말정산 엑셀(매입매출 시트) → ERP monthly_purchases 시드 JSON.

2026-07 부터 쓰는 형식. 지점이 각자 보낸 월말정산 파일(xlsx/ods)을 읽어
ERP 의 PurchaseSalesRow 로 바꾼다. 기존 ERP 행을 base 로 두고 금액만 채우는
'병합' 방식이라, 지점이 정리해 둔 거래처 목록·계좌·이체필요 플래그가 보존된다.

사용법:
  python scripts/build-monthly-settle-seed.py <엑셀폴더> <대상월> <ERP덤프.json> <출력.json> [지점명 ...]
                                              [--exclude-vendor "지점명:업체명" ...]

  --exclude-vendor 는 그 지점의 그 엑셀 행을 아예 반영하지 않는다(행 추가도, 금액 채우기도 안 함).
  본사가 "이 거래처는 이번 달 대장에 넣지 말라"고 판단한 건을 스크립트에 남겨 두기 위한 것.

엑셀 → ERP 필드 규칙
  C열(이체 필요금액) → transferAmount
  G열(이달사용금액)  → monthlyUsageAmount (없으면 C열과 동일하게 미러링)
  F열(기타내용)에 선입금 금액이 있으면 → isPrepaid=true, prepaidChargeAmount
  transferNeeded 는 C열 머리글에 따라 다르게 판정한다:
    "이체 필요금액" → 엑셀이 권위. C>0 이면 이체 필요, C가 비고 G만 있으면 결제완료(false)
    "지출"          → 이체 여부를 뜻하지 않으므로 기존 ERP 플래그를 그대로 둔다 (예: 카라멘야)
"""
import json
import os
import re
import sys
import difflib

import openpyxl

CATEGORY_MAP = {"식재료비": "식재료비", "주류비": "주류비", "식음료외기타": "식음료외 기타", "식음료외 기타": "식음료외 기타"}

FILE_BRANCH = {
    "7월_종로대물섬_월말정산.xlsx": "대물섬 종로점",
    "7월달 월말정산_연하동 연남점.xlsx": "연하동 연남본점",
    "남산광어 월말정산 7월.xlsx": "남산광어",
    "월말정산_ 대골뼈국 7월 .xlsx": "강남대골뼈국",
    "월말정산_26년_7월_마음죽.xlsx": "마음죽",
    "월말정산_대물섬 한남점7월.ods": "대물섬 한남점",
    "월말정산_대학로고래 (7).xlsx": "대학로고래",
    "월말정산_연하동 대학로 7월.xlsx": "연하동 대학로점",
    "월말정산_오키스테이크 7월.xlsx": "오키스테이크하우스",
    "월말정산_카라멘야2026년07월.xlsx": "카라멘야",
    "월말정산_카츠스위스 7월.xlsx": "카츠스위스",
    "월말정산_금샤빠_7월.xlsx": "금샤빠",
}

# 선입금 금액: "선입금 : 15,000,000", "7월선입금: 11,000,000", "30,000,000원 선입금", "선입급 : 5,000,000"
PREPAID_PATTERNS = [
    re.compile(r"선입[금급]\s*[:：]?\s*([\d,]+)"),
    re.compile(r"([\d,]+)\s*원?\s*선입[금급]"),
]


def num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(round(v))
    s = str(v).strip().replace(",", "")
    if s in ("", "-", "—"):
        return None
    s = re.sub(r"[^\d]", "", s)
    return int(s) if s else None


def is_text(v):
    """숫자가 아닌 '글'인가. num() 은 '6월 236,593원…' 에서도 숫자를 뽑아내므로 판정에 쓰면 안 된다."""
    if v is None or isinstance(v, (int, float)):
        return False
    s = str(v).strip()
    if s == "":
        return False
    return not re.fullmatch(r"[\d,.\s-]+", s)


def norm_vendor(name):
    s = str(name or "").strip()
    s = re.sub(r"[\s/()\[\]·.]", "", s)
    s = s.replace("식자재", "식재료").replace("부식비", "부식").replace("식용류", "식용유")
    s = s.replace("은행", "").replace("주식회사", "").replace("(주)", "").replace("㈜", "")
    return s


def clean_memo(v):
    if v is None:
        return ""
    return re.sub(r"\s{2,}", " ", re.sub(r"[\r\n]+", " / ", str(v).strip()))


def parse_prepaid(memo):
    """메모에서 선입금 충전액을 뽑는다. 없으면 None."""
    if not memo:
        return None
    for pattern in PREPAID_PATTERNS:
        m = pattern.search(memo)
        if m:
            return num(m.group(1))
    return None


def read_sheet(path):
    if path.lower().endswith(".ods"):
        import pandas as pd
        df = pd.read_excel(path, sheet_name="매입매출", engine="odf", header=None)
        grid = [[None if pd.isna(v) else v for v in df.iloc[i, :8]] for i in range(len(df))]
    else:
        ws = openpyxl.load_workbook(path, data_only=True)["매입매출"]
        grid = [list(r) for r in ws.iter_rows(min_row=1, max_col=8, values_only=True)]

    header_c = str(grid[1][2]).strip() if len(grid) > 1 and grid[1][2] else ""
    rows = []
    for r in grid[2:]:
        r = list(r) + [None] * (8 - len(r))
        cat = str(r[0]).strip() if r[0] else ""
        vendor = str(r[1]).strip() if r[1] else ""
        if not vendor or cat.startswith("[매출]"):
            continue
        # 기타내용은 F열이지만, H열('오류' 검증칸)에 비고를 적어 보내는 지점이 있다(금샤빠 7월).
        # F가 비었고 H에 숫자가 아닌 글이 있으면 그것도 비고로 줍는다 — 안 주우면 통째로 사라진다.
        memo = clean_memo(r[5])
        if not memo and is_text(r[7]):
            memo = clean_memo(r[7])
        rows.append({
            "category": CATEGORY_MAP.get(cat, cat),
            "vendor": vendor,
            "transfer": num(r[2]),
            "bank": str(r[3]).strip() if r[3] else "",
            "account": str(r[4]).strip() if r[4] else "",
            "memo": memo,
            "usage": num(r[6]),
            "prepaid": parse_prepaid(memo),
        })
    return header_c, rows


def build_branch(branch, path, erp_rows, month, notes, excluded=frozenset()):
    header_c, xrows = read_sheet(path)
    excel_authoritative = "이체" in header_c   # "이체 필요금액" 이면 엑셀이 이체 여부의 권위

    out = [dict(r) for r in erp_rows]          # 기존 행 보존 (계좌·플래그·순서)
    idx = {}
    for i, r in enumerate(out):
        v = norm_vendor(r.get("vendorName"))
        if v:
            idx.setdefault(v, []).append(i)

    used = set()
    for xr in xrows:
        # 금액이 없거나 전부 0인 행(= 이번 달 거래 없음)은 건드리지 않는다.
        # 0을 굳이 써 넣으면 플래그만 뒤집히고 export 결과는 그대로라 잡음만 남는다.
        if not any(v for v in (xr["transfer"], xr["usage"], xr["prepaid"])):
            continue

        if norm_vendor(xr["vendor"]) in excluded:
            notes.append(f"{branch} · {xr['vendor']}: --exclude-vendor 지정으로 반영하지 않음 "
                         f"(엑셀 이체 {xr['transfer'] or 0:,} / 사용 {xr['usage'] if xr['usage'] is not None else '-'})")
            continue

        key = norm_vendor(xr["vendor"])
        hit = idx.get(key)
        if not hit:
            near = difflib.get_close_matches(key, [k for k in idx if k], n=1, cutoff=0.75)
            hit = idx.get(near[0]) if near else None

        transfer = xr["transfer"]
        usage = xr["usage"]
        prepaid = xr["prepaid"]
        is_prepaid = prepaid is not None

        if hit:
            i = next((j for j in hit if j not in used), hit[0])
            used.add(i)
            row = out[i]
            prev_needed = row.get("transferNeeded", True)
            prev_prepaid_amt = num(row.get("prepaidChargeAmount"))
            # 엑셀에 선입금 언급이 없어도 ERP에 이미 충전액이 있으면 선입금 업체로 유지한다.
            if not is_prepaid and (row.get("isPrepaid") or prev_prepaid_amt):
                is_prepaid = True
                prepaid = prev_prepaid_amt
                if xr["prepaid"] is None and prev_prepaid_amt:
                    notes.append(f"{branch} · {xr['vendor']}: 엑셀엔 선입금 표기가 없으나 ERP 기존 충전액 {prev_prepaid_amt:,}원을 유지")
        else:
            row = {
                "id": f"p_{month}_new_{len(out) + 1}",
                "category": xr["category"], "vendorName": xr["vendor"],
                "bank": xr["bank"], "accountNumber": xr["account"],
                "transferAmount": "", "prepaidChargeAmount": "", "monthlyUsageAmount": "",
                "isPrepaid": False, "transferNeeded": True, "memo": "",
            }
            out.append(row)
            used.add(len(out) - 1)
            prev_needed = True
            notes.append(f"{branch} · {xr['vendor']}: ERP에 없던 거래처 — 행 신규 추가")

        # ---- 금액 채우기
        row["isPrepaid"] = bool(is_prepaid)
        row["prepaidChargeAmount"] = str(prepaid) if is_prepaid and prepaid is not None else ""
        row["transferAmount"] = str(transfer) if transfer else ""
        if is_prepaid:
            row["monthlyUsageAmount"] = str(usage) if usage is not None else (str(transfer) if transfer else "")
        else:
            row["monthlyUsageAmount"] = str(usage) if usage is not None else (str(transfer) if transfer else "")

        # ---- 이체 필요 여부
        if excel_authoritative:
            new_needed = bool(transfer and transfer > 0)
            if new_needed != bool(prev_needed):
                notes.append(
                    f"{branch} · {xr['vendor']}: 이체필요 {'해제→필요' if new_needed else '필요→해제'} "
                    f"(엑셀 이체금액 {transfer or 0:,} / 사용액 {usage if usage is not None else '-'})"
                )
            row["transferNeeded"] = new_needed
        else:
            row["transferNeeded"] = bool(prev_needed)

        if xr["memo"] and not row.get("memo"):
            row["memo"] = xr["memo"]
        if xr["bank"] and not row.get("bank"):
            row["bank"] = xr["bank"]
        if xr["account"] and not row.get("accountNumber"):
            row["accountNumber"] = xr["account"]

    return out, xrows


def main():
    if len(sys.argv) < 5:
        print(__doc__)
        sys.exit(1)
    args = sys.argv[1:]
    exclusions = {}   # 지점명 → {정규화된 업체명}
    rest = []
    i = 0
    while i < len(args):
        if args[i] == "--exclude-vendor":
            branch, _, vendor = args[i + 1].partition(":")
            exclusions.setdefault(branch.strip(), set()).add(norm_vendor(vendor))
            i += 2
            continue
        rest.append(args[i])
        i += 1

    src_dir, month, erp_dump, out_path = rest[:4]
    targets = rest[4:]

    erp = json.load(open(erp_dump, encoding="utf-8"))
    notes = []
    documents = []

    for base, branch in sorted(FILE_BRANCH.items(), key=lambda kv: kv[1]):
        if targets and branch not in targets:
            continue
        path = os.path.join(src_dir, base)
        if not os.path.exists(path):
            print(f"!! 파일 없음: {base}")
            continue
        erp_rows = erp["docs"].get(branch) or []
        rows, xrows = build_branch(branch, path, erp_rows, month, notes, exclusions.get(branch, frozenset()))

        transfer_export = sum(0 if r.get("transferNeeded") is False else (num(r.get("transferAmount")) or 0) for r in rows)
        documents.append({
            "branchName": branch,
            "dataKey": f"monthly_purchases:{branch}:{month}",
            "rows": rows,
            "excelRowCount": len(xrows),
            "erpRowCountBefore": len(erp_rows),
            "transferExportTotal": transfer_export,
        })

    print(f"{'지점':<16}{'엑셀행':>7}{'ERP전':>7}{'ERP후':>7}{'이체 export 합계':>18}")
    print("-" * 56)
    for d in documents:
        print(f"{d['branchName']:<16}{d['excelRowCount']:>7}{d['erpRowCountBefore']:>7}{len(d['rows']):>7}{d['transferExportTotal']:>18,}")

    if notes:
        print(f"\n[검토할 것 {len(notes)}건]")
        for n in notes:
            print(f"  · {n}")

    json.dump({"month": month, "documents": documents}, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\n시드 저장: {out_path}")


main()
