# -*- coding: utf-8 -*-
"""build-parttime-salary-seed.py 의 엑셀 읽기 검증 — 칸 순서가 달라도 머리글 글자로 바로 읽는가. (읽기 전용, 서버 접속 없음)

  python -I scripts/check-parttime-seed-reader.py [ERP가 만든 44칸 샘플.xlsx]

  샘플은 PART_TIME_SHEET_OUT=<폴더> npx tsx scripts/check-parttime-sheet-format.ts 가 만든다(없어도 된다 —
  여기서 같은 모양을 직접 만들어 검사하고, 경로를 주면 그 파일도 한 번 더 읽는다).

왜 이 검증이 있나 (2026-11-05)
  ERP 월말마감 엑셀의 파트타이머급여 시트가 출근날짜 31칸·머리글 2줄로 바뀌었다. 시드 스크립트는 그동안
  고정 칸 번호(급여 8·팁 10·기타내용 13 — 본사가 손본 파일의 순서)로 읽어서, 새 파일을 넣으면
  팁/기타를 급여로, 1일 출근 표시를 팁으로 읽어 급여가 0원이 되는데도 **아무 경고가 없었다**(Codex 지적).
  이제 머리글 글자로 칸을 찾는다. 네 가지 모양을 모두 넣어 본다 — 새 44칸 / ERP 옛 14칸 / 본사 손본 순서 / 머리글 없음.

픽스처는 전부 **합성 데이터**다. 이 저장소는 공개돼 있어 실제 주민등록번호·계좌번호를 넣으면 안 된다.
"""
import importlib.util, io, os, sys, tempfile, contextlib
import openpyxl

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("seed", os.path.join(HERE, "build-parttime-salary-seed.py"))
seed = importlib.util.module_from_spec(spec); spec.loader.exec_module(seed)

failures = 0
def check(label, actual, expected):
    global failures
    if actual == expected:
        print(f"  OK   {label}"); return
    failures += 1
    print(f"  FAIL {label}\n         기대: {expected!r}\n         실제: {actual!r}")

TMP = tempfile.mkdtemp(prefix="pt-seed-reader-")
def write(name, rows):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "파트타이머급여"
    for r in rows: ws.append(r)
    p = os.path.join(TMP, name); wb.save(p); return p

# 기대값 — 어느 모양으로 넣든 같은 사람은 같은 값으로 읽혀야 한다.
HONG = {"name": "홍길동", "residentNumber": "900101-1234567", "entryDate": "2026-03-02", "contractType": "미작성",
        "bank": "가나", "accountNumber": "1111", "hourlyRate": "15000", "hours": 15.5, "payRaw": 232500, "tips": "0", "memo": ""}
KIM = {"name": "김민지", "residentNumber": "", "entryDate": "", "contractType": "미작성", "bank": "", "accountNumber": "2222",
       "hourlyRate": "15000", "hours": 8.0, "payRaw": 150000, "tips": "30000", "memo": "비고 / 출근일 확인: 10~14"}
FRONT = ["성명(입사일)", "주민등록번호", "입사일", "근로계약", "은행", "입금계좌", "시급", "누적시간"]

print("\n[1] ERP 새 내보내기 — 출근날짜 31칸, 머리글 2줄, 뒤 칸이 AP~AR로 밀림")
days = [""] * 31
hong_days = list(days); hong_days[2] = hong_days[4] = hong_days[11] = 1
kim_days = list(days); kim_days[1] = kim_days[30] = 1
new = write("new44.xlsx", [
    ["테스트지점", "", "", 10, "월"],
    FRONT + ["팁/기타", "급여", "출근날짜"] + [""] * 30 + ["실수령액(송금액)", "실제 송금지점", "기타내용(퇴사일 및 퇴직금등)"],
    [""] * 10 + [f"{i + 1}일" for i in range(31)] + ["", "", ""],
    ["홍길동", "900101-1234567", "2026-03-02", "미작성", "가나", "1111", 15000, 15.5, 0, 232500] + hong_days + ["", "테스트지점", ""],
    ["김민지", "", "", "미작성", "", "2222", 15000, 8, 30000, 150000] + kim_days + ["", "테스트지점", "비고 / 출근일 확인: 10~14"],
    ["합계", "", "", "", "", "", "", 23.5, 30000, 382500] + days + ["", "", ""],
])
rows = seed.read_excel(new)
check("두 사람(합계 줄 제외)", [r["name"] for r in rows], ["홍길동", "김민지"])
check("홍길동 = 급여 232,500·팁 0·시간 15.5(팁/기타를 급여로 읽지 않는다)", rows[0], HONG)
check("김민지 = 기타내용은 AR열에서(4일 칸이 아니라)", rows[1], KIM)

print("\n[2] ERP 옛 내보내기 — 14칸, 팁(8)·급여(9)·출근날짜(10)·기타내용(13)")
old_erp = write("old14.xlsx", [
    ["테스트지점", "", "", 9, "월"],
    FRONT + ["팁/기타", "급여", "출근날짜", "실수령액(송금액)", "실제 송금지점", "기타내용(퇴사일 및 퇴직금등)"],
    ["홍길동", "900101-1234567", "2026-03-02", "미작성", "가나", "1111", 15000, 15.5, 0, 232500, "3,5,12", "", "테스트지점", ""],
    ["김민지", "", "", "미작성", "", "2222", 15000, 8, 30000, 150000, "2,31", "", "테스트지점", "비고 / 출근일 확인: 10~14"],
])
rows = seed.read_excel(old_erp)
check("옛 ERP 순서도 같은 값", rows, [HONG, KIM])

print("\n[3] 본사가 손본 순서 — 급여(8)·출근날짜(9)·상여금(팁)(10): 예전 고정 번호가 맞춰져 있던 모양")
hq = write("hq.xlsx", [
    ["테스트지점", "", "", 9, "월"],
    FRONT + ["급여", "출근날짜", "상여금(팁)", "실수령액(송금액)", "실제 송금지점", "기타내용(퇴사일 및 퇴직금등)"],
    ["홍길동", "900101-1234567", "2026-03-02", "미작성", "가나", "1111", 15000, 15.5, 232500, "3,5,12", 0, "", "테스트지점", ""],
    ["김민지", "", "", "미작성", "", "2222", 15000, 8, 150000, "2,31", 30000, "", "테스트지점", "비고 / 출근일 확인: 10~14"],
])
rows = seed.read_excel(hq)
check("본사 순서도 같은 값(상여금(팁) → tips)", rows, [HONG, KIM])

print("\n[4] 머리글이 없는 옛 파일 — 예전 고정 번호로 읽되 경고를 낸다")
bare = write("bare.xlsx", [
    ["테스트지점", "", "", 9, "월"],
    [""] * 14,
    ["홍길동", "900101-1234567", "2026-03-02", "미작성", "가나", "1111", 15000, 15.5, 232500, "3,5,12", 0, "", "테스트지점", ""],
])
err = io.StringIO()
with contextlib.redirect_stderr(err):
    rows = seed.read_excel(bare)
check("고정 번호(급여 8·팁 10)로 읽힌다", rows, [HONG])
check("경고가 찍힌다", "머리글이 없어" in err.getvalue(), True)

print("\n[5] 필수 칸이 없는 머리글 — 조용히 넘어가지 않고 멈춘다")
broken = write("broken.xlsx", [
    ["테스트지점", "", "", 9, "월"],
    ["성명(입사일)", "주민등록번호", "입사일", "근로계약", "은행", "입금계좌", "시급", "급여"],
    ["홍길동", "", "", "", "", "", 15000, 232500],
])
try:
    seed.read_excel(broken); check("누적시간 없는 머리글은 SystemExit", "안 멈춤", "SystemExit")
except SystemExit as e:
    check("누적시간 없는 머리글은 SystemExit", "hours" in str(e), True)

print("\n[6] 머리글 바로 아래가 사람이면(2줄 아님) 그 줄부터 읽는다 — 1줄 머리글에서 첫 사람을 건너뛰지 않는다")
check("옛 ERP 파일 첫 사람 = 홍길동", seed.read_excel(old_erp)[0]["name"], "홍길동")

sample = sys.argv[1] if len(sys.argv) > 1 else ""
if sample and os.path.exists(sample):
    print(f"\n[7] ERP가 실제로 만든 샘플 파일: {sample}")
    rows = {r["name"]: r for r in seed.read_excel(sample)}
    check("홍길동 시급·시간·급여·팁", [rows["홍길동"][k] for k in ("hourlyRate", "hours", "payRaw", "tips")], ["15000", 15.5, 232500, "0"])
    check("김민지 기타내용", rows["김민지"]["memo"], "비고 / 출근일 확인: 10~14")
    check("박철수 급여", rows["박철수"]["payRaw"], 600000)

print("\n모두 통과" if failures == 0 else f"\n실패 {failures}건")
sys.exit(0 if failures == 0 else 1)
