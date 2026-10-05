/**
 * 관리자 월말마감 엑셀 — 매입매출 시트가 지점 화면과 같은 모양으로 나오는지 검증.
 * (읽기 전용, 서버 접속 없음)
 *
 *   npx tsx scripts/check-purchase-sheet-format.ts
 *   PURCHASE_PARITY_OUT=<폴더> npx tsx scripts/check-purchase-sheet-format.ts   # 01 AGENT 대조용 파일도 저장
 *
 * 왜 이 검증이 있나 (2026-10-05)
 *   내려받은 매입매출 시트가 지점 화면과 달랐다(순서·칸·이체필요 행 사용액 공란·결제완료 행 이체금액 0·합계 없음).
 *   화면과 같은 모양으로 바꾸면서, 이 파일을 읽는 01 월말정산 AGENT가 **옛 형식과 똑같은 정산 결과**를 내야 한다.
 *   PURCHASE_PARITY_OUT 을 주면 같은 행으로 옛 형식(바꾸기 전 코드 그대로)과 새 형식 파일을 둘 다 만들어 둔다 —
 *   01 AGENT 쪽 `_개발자료/소스코드/tests/check_sales_format_parity.py` 가 두 파일을 읽어 결과를 대조한다.
 *
 * 픽스처는 전부 **합성 데이터**다. 이 저장소는 공개돼 있어 실제 계좌번호를 넣으면 안 된다.
 */
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx-js-style";
import {
  assembleMonthlyCloseWorkbook,
  buildMonthlyCloseSheetSpecs,
  normalizePurchaseRows,
  purchaseRowMissingTransferAmount,
  purchaseTransferExportValue,
  purchaseUsageExportValue,
  type MonthlyCloseData
} from "../src/pages/branch/helpers/monthlyCloseWorkbook";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { console.log(`  OK   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}\n         기대: ${e}\n         실제: ${a}`);
}

const BRANCH = "테스트지점";
const MONTH = "2026-09";

// 저장 순서는 일부러 분류가 섞이게 둔다(화면은 분류순으로 정렬해 보여 준다).
const purchases: any[] = [
  // 1) 이체필요 — 화면이 이체금액을 사용액으로 미러링한 일반 행
  { id: "a", category: "주류비", vendorName: "가나주류", transferNeeded: true, transferAmount: "1200000", monthlyUsageAmount: "1200000", bank: "국민", accountNumber: "000-00-000001", memo: "" },
  // 2) 결제완료 — 이체금액이 남아 있지만(화면엔 회색) 사용액이 따로 적힘
  { id: "b", category: "식재료비", vendorName: "다라수산", transferNeeded: false, transferAmount: "500000", monthlyUsageAmount: "480000", bank: "신한", accountNumber: "000-00-000002", memo: "매달 후불결제" },
  // 3) 결제완료 — 사용액 공란(옛 export는 이체금액으로 폴백)
  { id: "c", category: "식음료외 기타", vendorName: "마바소모품", transferNeeded: false, transferAmount: "70000", monthlyUsageAmount: "", bank: "", accountNumber: "", memo: "" },
  // 4) transferNeeded 없음(옛 데이터) → 이체필요로 본다
  { id: "d", category: "식재료비", vendorName: "사아청과", transferAmount: "330000", monthlyUsageAmount: "330000", bank: "농협", accountNumber: "000-00-000004", memo: "" },
  // 5) 옛 선입금 — 이체금액·사용액이 둘 다 있고 서로 다름(잔액부족 추가이체)
  { id: "e", category: "식재료비", vendorName: "자차정육", isPrepaid: true, transferNeeded: true, transferAmount: "1000000", monthlyUsageAmount: "1350000", bank: "우리", accountNumber: "000-00-000005", memo: "" },
  // 6) 옛 선입금 — 사용액만 있음(보정 단계에서 결제완료로 옮겨진다)
  { id: "f", category: "주류비", vendorName: "카타양조", isPrepaid: true, transferAmount: "", monthlyUsageAmount: "640000", bank: "하나", accountNumber: "000-00-000006", memo: "" },
  // 7) 결제완료 + 카드결제 메모(01 AGENT가 선입금조정에서 빼야 함)
  { id: "g", category: "식재료비", vendorName: "파하마트", transferNeeded: false, transferAmount: "", monthlyUsageAmount: "210000", bank: "", accountNumber: "", memo: "카드결제" },
  // 8) 이월만 되고 금액이 빈 행
  { id: "h", category: "식음료외 기타", vendorName: "거너세탁", transferNeeded: true, transferAmount: "", monthlyUsageAmount: "", bank: "기업", accountNumber: "000-00-000008", memo: "" },
  // 9) 옛 선입금 — 이체금액과 사용액이 같은 값
  { id: "i", category: "주류비", vendorName: "더러와인", isPrepaid: true, transferNeeded: true, transferAmount: "400000", monthlyUsageAmount: "400000", bank: "국민", accountNumber: "000-00-000009", memo: "" },
  // 10) 선입금 초과분 추가이체(2026-10-05~) — 이체필요 체크 + 사용액=선입금+이체금액을 따로 적음(isPrepaid 없음)
  { id: "j", category: "식음료외 기타", vendorName: "러머포장", transferNeeded: true, transferAmount: "800000", monthlyUsageAmount: "1100000", bank: "신한", accountNumber: "000-00-000010", memo: "" },
];

const data: MonthlyCloseData = {
  branchName: BRANCH,
  month: MONTH,
  purchases,
  roster: [],
  salaries: [],
  exclusions: [],
  profiles: {},
  history: [],
  manualWork: []
};

const sheet = buildMonthlyCloseSheetSpecs(data).find((s) => s.name === "매입매출")!;

console.log("\n[1] 칸 구성 — 지점 화면 표 머리글과 같은 글자");
check("헤더", sheet.headers, ["분류항목", "업체명", "이체 필요?", "이체필요 금액 (원)", "실제 이달사용액 (원)", "은행", "계좌번호", "거래 비고 고지"]);

console.log("\n[2] 순서 — 식재료비 → 주류비 → 식음료외 기타, 같은 분류 안은 저장 순서");
check("업체 순서", sheet.rows.map((r) => r[1]), ["다라수산", "사아청과", "자차정육", "파하마트", "가나주류", "카타양조", "더러와인", "마바소모품", "거너세탁", "러머포장", ""]);

console.log("\n[3] 값 — 화면에 보이는 그대로");
const byVendor = (v: string) => sheet.rows.find((r) => r[1] === v)!;
check("이체필요 행: 사용액도 화면처럼 보임", byVendor("가나주류").slice(2, 5), ["이체필요", 1200000, 1200000]);
check("결제완료 행: 이체금액 그대로(회색)", byVendor("다라수산").slice(2, 5), ["결제완료", 500000, 480000]);
check("결제완료·사용액 공란: 화면처럼 빈칸", byVendor("마바소모품").slice(2, 5), ["결제완료", 70000, ""]);
check("옛 데이터(transferNeeded 없음) → 이체필요", byVendor("사아청과")[2], "이체필요");
check("옛 선입금(둘 다 있음)", byVendor("자차정육").slice(2, 5), ["이체필요(선입금)", 1000000, 1350000]);
check("옛 선입금(사용액만) → 보정돼 결제완료", byVendor("카타양조").slice(2, 5), ["결제완료(선입금)", "", 640000]);
check("선입금 초과분 추가이체: 이체금액·사용액 둘 다", byVendor("러머포장").slice(2, 5), ["이체필요", 800000, 1100000]);
check("빈 금액 행", byVendor("거너세탁").slice(2, 5), ["이체필요", "", ""]);
check("계좌·은행·비고", byVendor("다라수산").slice(5), ["신한", "000-00-000002", "매달 후불결제"]);

console.log("\n[4] 합계 줄 — 화면 맨 아래 줄과 같은 규칙");
// 이체 합계: 결제완료 제외 = 1,200,000 + 330,000 + 1,000,000 + 400,000 + 800,000 = 3,730,000
// 사용액 합계: 모든 행 = 1,200,000 + 480,000 + 330,000 + 1,350,000 + 640,000 + 210,000 + 400,000 + 1,100,000 = 5,710,000
check("합계 줄", sheet.rows[sheet.rows.length - 1], ["합계", "", "", 3730000, 5710000, "", "", ""]);
check("합계 줄 굵게", sheet.boldRows, [sheet.rows.length - 1]);

console.log("\n[4-1] 정산 export 값 — 이체필요 행은 사용액이 이체금액과 다를 때만 나간다");
check("일반 이체필요(같은 값) → 공란", purchaseUsageExportValue(purchases.find((r) => r.id === "a")), "");
check("선입금 초과분(다른 값) → 사용액", purchaseUsageExportValue(purchases.find((r) => r.id === "j")), 1100000);
check("선입금 초과분 이체금액", purchaseTransferExportValue(purchases.find((r) => r.id === "j")), 800000);
check("이체필요·사용액 공란 → 공란", purchaseUsageExportValue({ transferNeeded: true, transferAmount: "5000", monthlyUsageAmount: "" }), "");

console.log("\n[4-2] 마감 제출 차단 — 이체필요 체크 + 사용액만 있고 이체금액이 빈 행");
check("사용액만 있고 이체금액 빈칸 → 차단", purchaseRowMissingTransferAmount({ vendorName: "가", transferNeeded: true, transferAmount: "", monthlyUsageAmount: "50000" }), true);
check("이체금액 0 + 사용액 → 차단", purchaseRowMissingTransferAmount({ vendorName: "가", transferNeeded: true, transferAmount: "0", monthlyUsageAmount: "50000" }), true);
check("transferNeeded 없음(옛 데이터=이체필요) → 차단", purchaseRowMissingTransferAmount({ vendorName: "가", transferAmount: "", monthlyUsageAmount: "1,000" }), true);
check("둘 다 빈칸(이번 달 거래 없음) → 통과", purchaseRowMissingTransferAmount({ vendorName: "가", transferNeeded: true, transferAmount: "", monthlyUsageAmount: "" }), false);
check("이체금액 있음 → 통과", purchaseRowMissingTransferAmount({ vendorName: "가", transferNeeded: true, transferAmount: "1000", monthlyUsageAmount: "" }), false);
check("결제완료 → 통과", purchaseRowMissingTransferAmount({ vendorName: "가", transferNeeded: false, transferAmount: "", monthlyUsageAmount: "50000" }), false);
check("업체명 없음 → 통과", purchaseRowMissingTransferAmount({ vendorName: " ", transferNeeded: true, transferAmount: "", monthlyUsageAmount: "50000" }), false);
check("옛 선입금 사용액만(이체필요로 남아 있어도) → 보정돼 통과", purchaseRowMissingTransferAmount({ vendorName: "가", isPrepaid: true, transferNeeded: true, transferAmount: "", monthlyUsageAmount: "50000" }), false);
check("픽스처 원본 그대로 넣어도 해당 없음", purchases.filter(purchaseRowMissingTransferAmount).length, 0);
check("합성 픽스처 전체(보정 후)엔 해당 없음", normalizePurchaseRows(purchases).filter(purchaseRowMissingTransferAmount).length, 0);

console.log("\n[5] 빈 시트엔 합계 줄을 붙이지 않는다");
const empty = buildMonthlyCloseSheetSpecs({ ...data, purchases: [] }).find((s) => s.name === "매입매출")!;
check("행 수", empty.rows.length, 0);

console.log("\n[6] 실제 워크북 — 제목줄(A1 지점·D1 월) 유지, 서식");
const wb = assembleMonthlyCloseWorkbook(XLSX, data);
const ws = wb.Sheets["매입매출"];
check("A1 지점명", ws["A1"]?.v, BRANCH);
check("D1 월", ws["D1"]?.v, 9);
check("A2 헤더", ws["A2"]?.v, "분류항목");
check("D3 숫자 서식", ws["D3"]?.z, "#,##0");
check("G3 계좌 텍스트 서식", ws["G3"]?.z, "@");
check("결제완료 이체금액 회색", ws["D3"]?.s?.font?.color?.rgb, "9CA3AF");
check("식재료비 행 배경", ws["A3"]?.s?.fill?.fgColor?.rgb, "F8F7DE");
check("주류비 행 배경", ws["A7"]?.s?.fill?.fgColor?.rgb, "EBF2E8");
check("다른 시트 이름 그대로", wb.SheetNames, ["매입매출", "파트타이머급여", "현금지출", "카드지출", "현금관리"]);

// ── 01 AGENT 대조용 파일 ─────────────────────────────────────────
const outDir = process.env.PURCHASE_PARITY_OUT;
if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  // 옛 형식 — 바꾸기 전 코드(저장 순서·옛 헤더·export 값) 그대로 재현한다.
  const oldWb = XLSX.utils.book_new();
  const oldAoa: any[][] = [
    [BRANCH, "", "", 9, "월"],
    ["매출항목", "업체명", "이체 필요금액", "은행", "계좌번호", "기타내용", "이달사용금액", "오류"],
    ...purchases.map((r) => [r.category, r.vendorName, purchaseTransferExportValue(r), r.bank, r.accountNumber, r.memo, purchaseUsageExportValue(r), ""]),
  ];
  XLSX.utils.book_append_sheet(oldWb, XLSX.utils.aoa_to_sheet(oldAoa), "매입매출");
  XLSX.writeFile(oldWb, path.join(outDir, "old_format.xlsx"));
  XLSX.writeFile(wb, path.join(outDir, "new_format.xlsx"));
  console.log(`\n대조용 파일 저장: ${outDir}`);
}

console.log(failures ? `\n실패 ${failures}건` : "\n전부 통과");
process.exit(failures ? 1 : 0);
