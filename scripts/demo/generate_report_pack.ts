// scripts/demo/generate_report_pack.ts
// 시연용 "분석 > 통합보고서" 데이터 생성기.
//
//   npx tsx scripts/demo/generate_report_pack.ts [--data <폴더>]
//
// [왜 별도 스크립트인가]
// 통합보고서는 03 에이전트의 엑셀을 **격자·서식 그대로** 담는 화면이라, 항목별 JSON 이 아니라
// `buildReportPackDoc()` 이 만든 gzip 문서만 읽는다. 그 함수는 src/ 의 TypeScript 라
// generate_fake_data.mjs(순수 .mjs)에서 부를 수 없어 tsx 로 도는 이 스크립트를 따로 둔다.
//
// [왜 엑셀을 실제로 만들어 통과시키는가]
// 저장 문서를 손으로 지어낼 수도 있지만, 그러면 **화면이 쓰는 경로와 다른 경로**로 만든 데이터가 된다.
// 여기서는 진짜 xlsx 를 메모리에 만들어 화면과 똑같은 `buildReportPackDoc()` 에 넣는다 —
// 서식·열너비·병합·마스킹·압축한도 검사가 전부 실제와 같은 코드로 걸린다.
//
// [개인정보] 급여명단에 **가짜 주민번호·계좌를 일부러 원본 형태로** 넣는다. 저장 직전
// maskSheetRows() 가 지우므로 파일에 남는 값은 마스킹된 형태이고, 그 과정 자체가 시연거리가 된다.
// (가상 인물의 가짜 번호라 지워지지 않더라도 실제 개인정보 위험은 없다 — 그래도 검증에서 확인한다.)
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSXNS from "xlsx-js-style";
import {
  buildReportPackDoc, decodeReportPack, reportPackKey, REPORT_PACK_INDEX_KEY,
} from "../../src/pages/admin/helpers/reportPack";

const XLSX: any = (XLSXNS as any).default ?? XLSXNS;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const dataArg = (() => { const i = argv.indexOf("--data"); return i >= 0 ? argv[i + 1] : null; })();
const DATA_DIR = path.resolve(ROOT, dataArg ?? path.join("..", "02. 재무 회계", "output", "demo_data"));
const SHARED_PATH = path.join(DATA_DIR, "shared_data.json");

type SharedDoc = { id: string; data: { value: unknown; updatedAt: string } };
const shared: SharedDoc[] = JSON.parse(readFileSync(SHARED_PATH, "utf8"));
const keyOf = (doc: SharedDoc) => decodeURIComponent(doc.id);
const valueOf = <T,>(key: string): T | null => {
  const hit = shared.find((d) => keyOf(d) === key);
  return hit ? (hit.data.value as T) : null;
};

// ── 원천: 손익DB(analysis_pnl_db) ─────────────────────────────────────────
// 통합보고서와 손익 화면이 **같은 숫자**를 보여야 시연 중 "왜 다르냐"는 질문이 안 나온다.
type PnlRow = Record<string, any>;
const pnl = valueOf<{ rows: PnlRow[] }>("analysis_pnl_db");
if (!pnl?.rows?.length) throw new Error("analysis_pnl_db 가 없다 — generate_fake_data.mjs 를 먼저 돌릴 것");
const MONTHS = [...new Set(pnl.rows.map((r) => String(r.month)))].sort();
const BRANCHES = [...new Set(pnl.rows.map((r) => String(r.지점)).filter((n) => n !== "본사"))];

/** "2026-07" → "2607" (통합보고서 문서 키·시트 제목이 쓰는 표기) */
const yymm = (month: string) => month.slice(2, 4) + month.slice(5, 7);

// ── 시드 고정 난수 (재실행해도 같은 보고서) ────────────────────────────────
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260821);
const randint = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const won = (n: number) => Math.round(n / 100) * 100;

/** 마스킹된 주민번호("931103-2******")를 원본 형태로 되돌린다 — 저장 직전 다시 지워진다. */
const unmaskRrn = (masked: string): string => {
  const m = String(masked).match(/^(\d{6})-(\d)\*{6}$/);
  if (!m) return String(masked);
  return `${m[1]}-${m[2]}${String(randint(100000, 999999))}`;
};

// ── 서식 ──────────────────────────────────────────────────────────────────
// [2026-08-24 사용자 지시] 색은 **실제 03 에이전트 통합보고서와 같은 값**을 쓴다.
// 아래 색상표는 지어낸 값이 아니라 `2604_손익계산서_통합.xlsx` 를 화면과 같은 파서
// (buildReportPackDoc → decodeReportPack)로 읽어 실측한 것이다. 바꾸려면 다시 실측할 것.
//
//   D9D9D9(굵게) 머리글 전부(손익계산서·매출상세·급여명단·거래내역)
//   FFF2CC       매출 구성(메뉴·주류·자리값)의 금액 칸
//                └ [주의] 원본이 **시트마다 다르다**(2604 기준 칠한 시트 7 / 안 칠한 시트 6).
//                  손으로 넣은 서식이라 그렇다. 다수인 FFF2CC 를 따르며, 이건 실측 후 고른 값이지
//                  빠뜨린 게 아니다 — "원본엔 색이 없던데" 하고 지우지 말 것.
//   FFFF00(굵게) 총매출·총지출 행 전체 — 이 파일에서 노랑은 '합계'라는 뜻이다
//   (이익금 행은 실제 파일에 색이 없다 — 눈에 띄게 하고 싶어도 임의로 칠하지 않는다)
//
// 거래내역은 **항목별로 색이 다르다.** 그래서 색만 흉내 낼 수 없고 항목 구성도 같아야 한다.
const CAT_BG: Record<string, string | null> = {
  "인건비": "FFE8D5",
  "식재료": "D5F5D5",
  "주류": "D5E8FF",
  "임대료": "E8D5FF",
  "전기·가스·수도": "D5F5F5",
  "광고": "FFD5E8",        // 금샤빠 시트는 광고비가 0이라 색이 안 보인다 — 다른 지점 시트에서 실측
  "(미분류)": "FFB3B3",
  "기타": null,           // 실제 파일에도 색이 없다
};

const BORDER = { style: "thin", color: { rgb: "BFBFBF" } };
const box = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const fill = (rgb: string | null) => (rgb ? { fill: { fgColor: { rgb } } } : {});
const S = {
  title: { font: { bold: true, sz: 13 } },
  section: { font: { bold: true, sz: 11 } },
  head: { font: { bold: true, sz: 10 }, fill: { fgColor: { rgb: "D9D9D9" } }, alignment: { horizontal: "center" }, border: box },
  cell: { font: { sz: 10 }, border: box },
  cellR: { font: { sz: 10 }, alignment: { horizontal: "right" }, border: box },
  amount: { font: { sz: 10 }, fill: { fgColor: { rgb: "FFF2CC" } }, border: box },
  total: { font: { bold: true, sz: 10 }, fill: { fgColor: { rgb: "FFFF00" } }, border: box },
  /** 소계 — 실제 파일에서 급여명단 합계 행과 거래내역 블록 머리글은 노랑이 아니라 **회색 굵게**다.
      노랑(FFFF00)은 오직 손익계산서의 총매출·총지출 두 줄에만 쓴다. */
  /** 이익금 행 — 실제 파일은 **색 없이 굵게만** 쓴다(합계 노랑과 구분되는 자리다) */
  boldPlain: { font: { bold: true, sz: 10 }, border: box },
  boldPlainR: { font: { bold: true, sz: 10 }, alignment: { horizontal: "right" }, border: box },
  sub: { font: { bold: true, sz: 10 }, fill: { fgColor: { rgb: "D9D9D9" } }, border: box },
  subR: { font: { bold: true, sz: 10 }, fill: { fgColor: { rgb: "D9D9D9" } }, alignment: { horizontal: "right" }, border: box },
} as const;
/** 거래내역 데이터 칸 — 항목 색을 입힌다(없는 항목은 흰 칸) */
const catCell = (cat: string, right = false) => ({
  font: { sz: 10 },
  ...(right ? { alignment: { horizontal: "right" } } : {}),
  border: box,
  ...fill(CAT_BG[cat] ?? null),
});

const NUM = "#,##0";
const PCT = "0.00%";

type Cell = { v: string | number; s?: any; z?: string };
type Grid = Record<string, Cell>;

function put(grid: Grid, r: number, c: number, v: string | number, s?: any, z?: string) {
  if (v === "" || v === null || v === undefined) return;
  grid[XLSX.utils.encode_cell({ r, c })] = { v, s, z };
}

function sheetFrom(grid: Grid, colPx: number[], lastRow: number, lastCol: number) {
  const sheet: any = {};
  for (const [addr, cell] of Object.entries(grid)) {
    sheet[addr] = { t: typeof cell.v === "number" ? "n" : "s", v: cell.v, s: cell.s, z: cell.z };
  }
  sheet["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastCol } });
  sheet["!cols"] = colPx.map((wpx) => ({ wpx }));
  return sheet;
}
/** 달 안의 그럴듯한 날짜/시각 문자열. 시드 고정이라 다시 돌려도 같은 값이 나온다. */
const dayOf = (month: string, i: number) =>
  `${month}-${String(((i * 7) % 27) + 1).padStart(2, "0")} ${String(9 + (i % 9)).padStart(2, "0")}:${String((i * 13) % 60).padStart(2, "0")}`;

// ── 지점 시트 ─────────────────────────────────────────────────────────────
// 실제 03 파일(`2604_손익계산서_통합.xlsx`)의 배치를 그대로 따른다. 아래 배치는 눈대중이 아니라
// 그 파일을 화면과 같은 파서로 읽어 **실측한 좌표**다(Codex 정지게이트 지적 2026-08-24 —
// 그 전에는 급여명단이 한 블록뿐이고, 거래내역 둘째 줄을 옆으로 늘어놓고, 총 거래내역 표의
// 칸 구성이 아예 달랐다). 바꾸려면 원본을 다시 열어 확인할 것.
//
//   행1   A: {지점}_{YYMM}                    M: {지점}_{YYMM}
//   행2                                        M: "1. 실무자 기준 급여"
//   행3   A~D 손익계산서 머리글  F~K 매출상세 머리글  M~U 급여명단 머리글
//   행4~  손익계산서 항목        행4 매출상세 값      급여명단(정직원→합계→파트→합계)
//   (급여 블록 아래) M: "2. 실무자 외 급여 (참고)" + 같은 머리글 한 벌 더
//   그 아래  ■ 인건비(A) · ■ 식재료(G) · ■ 기타(M)  ← 이 줄만 3개가 나란히
//            ■ 주류 · ■ 임대료 · ■ 전기·가스·수도 · ■ 광고 · ■ (미분류)  ← 이후는 A열에 세로로
//   맨 아래  [총 거래내역]  번호|날짜/시간|거래처|출금액(원)|입금액(원)|잔액(원)|내통장표시|메모/요약
//
// 열너비도 실측값이다. M열 이후가 52px 로 좁아 급여명단 글자가 칸을 넘치는데, 원본이 그렇다.
const BRANCH_COLS = [88, 128, 80, 80, 52, 112, 96, 112, 112, 80, 96, 52,
  52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52];

const TX_HEADERS = ["날짜", "받는분/보내는분", "금액(원)", "내통장표시", "카테고리분류"];
const SALARY_HEADERS = ["분류", "성명", "직급", "주민등록번호", "입사일", "근로계약", "입금계좌", "전월급여", "이달 급여"];
const LEDGER_HEADERS = ["번호", "날짜/시간", "거래처", "출금액(원)", "입금액(원)", "잔액(원)", "내통장표시", "메모/요약"];
/** 입금(매출 입금) 줄 색 — 실제 파일에서 이 줄들만 회색이다 */
const DEPOSIT_BG = "CCCCCC";

type Tx = { date: string; to: string; amount: number; memo: string; cat: string };

function branchSheet(branch: string, month: string) {
  const row = pnl!.rows.find((r) => r.month === month && r.지점 === branch)!;
  const g: Grid = {};
  const tag = `${branch}_${yymm(month)}`;
  put(g, 0, 0, tag, S.title);
  put(g, 0, 12, tag, S.title);
  put(g, 1, 12, "1. 실무자 기준 급여", S.section);

  // ① 손익계산서 (A~D)
  ["구분", "금액(원)", "비율", "비고"].forEach((h, i) => put(g, 2, i, h, S.head));
  const total = Number(row.총매출) || 1;
  // 실제 파일과 같은 규칙: 매출 구성 3줄은 금액 칸만 연노랑(FFF2CC), 총매출·총지출 행은 통째로 노랑(FFFF00),
  // 이익금은 색 없이 굵게만.
  const items: Array<[string, number, string, any, any]> = [
    ["메뉴", row.메뉴매출, "", S.cell, S.amount],
    ["주류", row.주류매출, "", S.cell, S.amount],
    ["자리값", row["배달/기타매출"], "", S.cell, S.amount],
    ["총매출", row.총매출, "", S.total, S.total],
    ["임대료", row.임대료, "", S.cell, S.cellR],
    ["식재료", row.식재료, "메뉴매출 대비", S.cell, S.cellR],
    ["주류", row.주류원가, "주류매출 대비", S.cell, S.cellR],
    ["인건비", row.인건비, "", S.cell, S.cellR],
    ["전기,가스,수도", row.공과금, "", S.cell, S.cellR],
    ["기타", row.기타비용, "", S.cell, S.cellR],
    ["광고", row.광고비, "", S.cell, S.cellR],
    ["세금예비(10%)", row.세금예비, "", S.cell, S.cellR],
    ["수수료(2.2%)", row.수수료, "", S.cell, S.cellR],
    ["특별지출", row.특별지출, row.특별지출비고 || "", S.cell, S.cellR],
    ["총지출", row.총지출, "", S.total, S.total],
    ["이익금", row.이익금, "", S.boldPlain, S.boldPlainR],
  ];
  items.forEach(([label, amount, note, style, amountStyle], i) => {
    const r = 3 + i;
    put(g, r, 0, label, style);
    put(g, r, 1, Number(amount) || 0, amountStyle, NUM);
    put(g, r, 2, (Number(amount) || 0) / total, style, PCT);
    if (label === "식재료") put(g, r, 3, (Number(amount) || 0) / (Number(row.메뉴매출) || 1), S.cellR, PCT);
    else if (label === "주류" && i > 3) put(g, r, 3, (Number(amount) || 0) / (Number(row.주류매출) || 1), S.cellR, PCT);
    else if (note) put(g, r, 3, note, S.cell);
  });
  const pnlBottom = 3 + items.length - 1;

  // ② 매출상세 (F~K) — 월 매출집계(monthly_sales_summary)와 같은 값
  const sum = valueOf<Record<string, string>>(`monthly_sales_summary:${branch}:${month}`);
  const n = (k: string) => Number(sum?.[k] ?? 0);
  ["총매출", "단순현금", "현금영수증", "신용카드", "영수건수", "영수단가"].forEach((h, i) => put(g, 2, 5 + i, h, S.head));
  const 영수건수 = Number(row.영수건수) || 1;
  const 총매출 = sum ? n("totalSales") : Number(row.총매출);
  const 단순현금 = won(총매출 * 0.031);
  const 현금영수증 = won(총매출 * 0.018);
  [총매출, 단순현금, 현금영수증, 총매출 - 단순현금 - 현금영수증, 영수건수, Math.round(총매출 / 영수건수)]
    .forEach((v, i) => put(g, 3, 5 + i, v, S.cellR, NUM));

  // ③ 급여명단 (M~U) — 실제 파일처럼 **두 블록**이다.
  //    1. 실무자 기준 급여 : 이 지점에서 실제로 일한 사람
  //    2. 실무자 외 급여(참고) : 이 지점 통장에서 나갔지만 실무자가 아닌 건(본사 파견·타지점 지원 등)
  const full = valueOf<any[]>(`monthly_fulltime_salary:${branch}:${month}`) ?? [];
  const part = valueOf<any[]>(`part_time_salaries:${branch}:${month}`) ?? [];
  let sr = 2;
  const salaryHeaderRow = (r: number) => SALARY_HEADERS.forEach((h, i) => put(g, r, 12 + i, h, S.head));
  const salaryRow = (r: number, kind: string, e: any, prev: number, now: number) => {
    put(g, r, 12, kind, S.cell);
    put(g, r, 13, e.name, S.cell);
    put(g, r, 14, e.rank || "", S.cell);
    put(g, r, 15, unmaskRrn(e.residentNumber), S.cell);
    put(g, r, 16, String(e.entryDate || ""), S.cell);
    put(g, r, 17, e.contractType || e.contractStatus || "", S.cell);
    put(g, r, 18, `${e.bank || ""} ${e.accountNumber || ""}`.trim(), S.cell);
    put(g, r, 19, prev, S.cellR, NUM);
    put(g, r, 20, now, S.cellR, NUM);
  };
  salaryHeaderRow(sr); sr += 1;
  for (const e of full) { salaryRow(sr, "정직원", e, Number(e.prevSalary) || 0, Number(e.thisSalary) || 0); sr += 1; }
  put(g, sr, 12, "합계", S.sub);
  put(g, sr, 19, full.reduce((s, e) => s + (Number(e.prevSalary) || 0), 0), S.subR, NUM);
  put(g, sr, 20, full.reduce((s, e) => s + (Number(e.thisSalary) || 0), 0), S.subR, NUM);
  sr += 1;
  for (const e of part) { salaryRow(sr, "파트타이머", e, 0, Number(e.actualPaidAmount) || 0); sr += 1; }
  put(g, sr, 12, "합계", S.sub);
  put(g, sr, 20, part.reduce((s, e) => s + (Number(e.actualPaidAmount) || 0), 0), S.subR, NUM);
  sr += 2; // 원본도 두 블록 사이를 한 줄 비운다

  put(g, sr, 12, "2. 실무자 외 급여 (참고)", S.section); sr += 1;
  salaryHeaderRow(sr); sr += 1;
  // 참고 인원 — 실무자가 아니라 이 지점 통장에서 나간 건. 데모는 두 줄이면 뜻이 전달된다.
  const refStaff = full.slice(0, 2).map((e, i) => ({
    ...e, name: e.name, rank: e.rank,
    thisSalary: won((Number(e.thisSalary) || 0) * (i === 0 ? 0.1 : 0.05)),
  }));
  const refTx: Tx[] = [];
  refStaff.forEach((e, i) => {
    salaryRow(sr, "정직원", e, 0, Number(e.thisSalary) || 0);
    refTx.push({ date: dayOf(month, 12 + i * 3), to: e.name, amount: Number(e.thisSalary) || 0, memo: "", cat: "인건비" });
    sr += 1;
  });
  put(g, sr, 12, "합계", S.sub);
  put(g, sr, 20, refStaff.reduce((s, e) => s + (Number(e.thisSalary) || 0), 0), S.subR, NUM);

  // ④ 카테고리별 거래내역
  const purchases = valueOf<any[]>(`monthly_purchases:${branch}:${month}`) ?? [];
  /** 금액을 여러 줄로 나눈다. 합계는 항상 원래 금액과 정확히 맞춘다. */
  const split = (totalAmount: number, names: string[], seedOffset: number): Tx[] => {
    const raw = names.map(() => 0.6 + rand() * 0.8);
    const s = raw.reduce((a, b) => a + b, 0);
    const parts = raw.map((w) => won((Number(totalAmount) || 0) * (w / s)));
    parts[parts.length - 1] += (Number(totalAmount) || 0) - parts.reduce((a, b) => a + b, 0);
    return names.map((to, i) => ({ date: dayOf(month, i + seedOffset), to, amount: parts[i], memo: "", cat: "" }));
  };
  const withCat = (list: Tx[], cat: string) => list.map((t) => ({ ...t, cat }));

  const laborTx: Tx[] = [
    ...full.map((e, i) => ({ date: dayOf(month, i + 2), to: e.name, amount: Number(e.thisSalary) || 0, memo: "", cat: "인건비" })),
    ...part.map((e, i) => ({ date: dayOf(month, i + 9), to: e.name, amount: Number(e.actualPaidAmount) || 0, memo: "", cat: "인건비" })),
    ...refTx,
  ];
  const foodTx = purchases.filter((p) => p.category === "식재료비")
    .map((p, i) => ({ date: dayOf(month, i + 3), to: p.vendorName, amount: Number(p.transferAmount) || 0, memo: p.category, cat: "식재료" }));
  const liquorTx = purchases.filter((p) => p.category === "주류비")
    .map((p, i) => ({ date: dayOf(month, i + 4), to: p.vendorName, amount: Number(p.transferAmount) || 0, memo: p.category, cat: "주류" }));
  const etcTx = withCat(split(row.기타비용, ["케이티 통신요금", "정수기 렌탈", "위생용품", "세무 기장료", "카드단말기 수수료"], 5), "기타");
  const rentTx = withCat(split(row.임대료, ["건물 임대료", "관리비"], 6), "임대료");
  const utilTx = withCat(split(row.공과금, ["한국전력공사", "도시가스", "상수도사업본부"], 8), "전기·가스·수도");
  const adTx = Number(row.광고비) > 0 ? withCat(split(row.광고비, ["네이버 검색광고", "배달앱 광고"], 11), "광고") : [];
  const unknownTx = withCat(split(won(Number(row.기타비용) * 0.35), ["미확인 출금", "이체(내용없음)"], 14), "(미분류)");

  // 실제 배치: **첫 줄만** 세 블록이 나란히(A·G·M), 그 다음부터는 A열에 세로로 이어진다.
  const acrossBlocks: Array<[string, number, Tx[]]> = [
    ["■ 인건비", 0, laborTx], ["■ 식재료", 6, foodTx], ["■ 기타", 12, etcTx],
  ];
  const stackedBlocks: Array<[string, Tx[]]> = [
    ["■ 주류", liquorTx], ["■ 임대료", rentTx], ["■ 전기·가스·수도", utilTx],
    ["■ 광고", adTx], ["■ (미분류)", unknownTx],
  ];

  const writeBlock = (top: number, c0: number, label: string, txs: Tx[]) => {
    const cat = label.replace("■ ", "");
    put(g, top, c0, label, S.sub);
    put(g, top, c0 + 2, txs.reduce((s, t) => s + t.amount, 0), S.subR, NUM);
    TX_HEADERS.forEach((h, i) => put(g, top + 1, c0 + i, h, S.head));
    txs.forEach((t, i) => {
      const r = top + 2 + i;
      put(g, r, c0, t.date, catCell(cat));
      put(g, r, c0 + 1, t.to, catCell(cat));
      put(g, r, c0 + 2, t.amount, catCell(cat, true), NUM);
      put(g, r, c0 + 3, t.memo, catCell(cat));
      put(g, r, c0 + 4, t.cat, catCell(cat));
    });
    return top + 1 + Math.max(1, txs.length); // 마지막으로 쓴 행
  };

  // [주의] 거래내역은 A열에서 시작한다 — 급여명단(M열) 아래로만 내리면 A열 손익계산서를 덮어쓴다.
  // 실제로 세금예비~이익금 5행이 지워진 적이 있다(2026-08-21). 두 표 중 더 아래를 기준으로 잡는다.
  let cursor = Math.max(sr, pnlBottom) + 2;
  let bottom = cursor;
  for (const [label, c0, txs] of acrossBlocks) bottom = Math.max(bottom, writeBlock(cursor, c0, label, txs));
  cursor = bottom + 2;
  for (const [label, txs] of stackedBlocks) {
    if (!txs.length) continue;
    cursor = writeBlock(cursor, 0, label, txs) + 2;
  }

  // ⑤ [총 거래내역] — 원본은 통장 원문을 번호·잔액과 함께 세운 표다(■ 가 아니라 대괄호 제목).
  //    출금 줄은 그 줄의 항목 색, 매출 입금 줄은 회색(CCCCCC).
  const withdrawals = [...laborTx, ...foodTx, ...liquorTx, ...etcTx, ...rentTx, ...utilTx, ...adTx, ...unknownTx]
    .map((t) => ({ ...t, out: t.amount, in: 0 }));
  const deposits = Array.from({ length: 10 }, (_, i) => ({
    date: dayOf(month, i * 3 + 1), to: ["카드매출 입금", "배달앱 정산", "현금 입금"][i % 3],
    amount: 0, memo: "", cat: "입금", out: 0, in: won((Number(row.총매출) || 0) / 10),
  }));
  const ledger = [...withdrawals, ...deposits].sort((a, b) => a.date.localeCompare(b.date));
  const ledgerTop = cursor;
  put(g, ledgerTop, 0, "[총 거래내역]", S.section);
  LEDGER_HEADERS.forEach((h, i) => put(g, ledgerTop + 1, i, h, S.head));
  let balance = won((Number(row.총매출) || 0) * 0.4); // 기초 잔액
  ledger.forEach((t, i) => {
    const r = ledgerTop + 2 + i;
    balance = balance + t.in - t.out;
    const st = t.cat === "입금"
      ? { font: { sz: 10 }, border: box, fill: { fgColor: { rgb: DEPOSIT_BG } } }
      : catCell(t.cat);
    const stR = t.cat === "입금"
      ? { font: { sz: 10 }, alignment: { horizontal: "right" }, border: box, fill: { fgColor: { rgb: DEPOSIT_BG } } }
      : catCell(t.cat, true);
    put(g, r, 0, i + 1, stR, NUM);
    put(g, r, 1, t.date, st);
    put(g, r, 2, t.to, st);
    put(g, r, 3, t.out, stR, NUM);
    put(g, r, 4, t.in, stR, NUM);
    put(g, r, 5, balance, stR, NUM);
    put(g, r, 6, "", st);
    put(g, r, 7, t.cat === "입금" ? "정산" : "모바일", st);
  });

  return sheetFrom(g, BRANCH_COLS, ledgerTop + 2 + ledger.length, BRANCH_COLS.length - 1);
}


// ── 본사 시트 ─────────────────────────────────────────────────────────────
// 본사 행 규약(pnlDb.ts): 총매출 = 전지점 합산 · 공과금 칸 = 배당/인센 ·
// 총지출 = 본사지출 + 배당/인센 · 이익금 = 본사 자체 손익(음수). 계산식 열을 붙여 읽는 사람이 따라올 수 있게 한다.
const HQ_COLS = [116, 124, 78, 220, 26, 116, 124, 96];

function hqSheet(month: string) {
  const hq = pnl!.rows.find((r) => r.month === month && r.지점 === "본사")!;
  const branchRows = pnl!.rows.filter((r) => r.month === month && r.지점 !== "본사");
  const g: Grid = {};
  put(g, 0, 0, `본사_${yymm(month)}`, S.title);
  ["구분", "금액(원)", "비율", "계산식"].forEach((h, i) => put(g, 2, i, h, S.head));

  const 지점이익합 = branchRows.reduce((s, r) => s + (Number(r.이익금) || 0), 0);
  const 배당인센 = Number(hq.공과금) || 0;
  const 본사지출 = (Number(hq.총지출) || 0) - 배당인센;
  const total = Number(hq.총매출) || 1;
  const rows: Array<[string, number, string, any]> = [
    ["전지점 총매출", hq.총매출, "지점 4곳 합산", S.total],
    ["지점 이익 소계", 지점이익합, "각 지점 이익금의 합", S.cell],
    ["본사 임대료", hq.임대료, "", S.cell],
    ["본사 인건비", hq.인건비, "", S.cell],
    ["본사 기타비용", hq.기타비용, "", S.cell],
    ["본사 광고비", hq.광고비, "", S.cell],
    ["본사지출 소계", 본사지출, "임대료+인건비+기타+광고", S.sub],
    ["배당/인센", 배당인센, "본사 행 공과금 칸에 담긴다", S.cell],
    ["본사 총지출", hq.총지출, "본사지출 + 배당/인센", S.total],
    ["이익잉여금", 지점이익합 - (Number(hq.총지출) || 0), "지점 이익 소계 − 본사 총지출", S.total],
  ];
  rows.forEach(([label, amount, note, style], i) => {
    const r = 3 + i;
    put(g, r, 0, label, style);
    put(g, r, 1, Number(amount) || 0, style, NUM);
    put(g, r, 2, (Number(amount) || 0) / total, style, PCT);
    put(g, r, 3, note, S.cell);
  });

  // 지점별 요약(F~H)
  put(g, 2, 5, "지점", S.head); put(g, 2, 6, "총매출", S.head); put(g, 2, 7, "이익금", S.head);
  branchRows.forEach((r, i) => {
    put(g, 3 + i, 5, String(r.지점), S.cell);
    put(g, 3 + i, 6, Number(r.총매출) || 0, S.cellR, NUM);
    put(g, 3 + i, 7, Number(r.이익금) || 0, S.cellR, NUM);
  });
  return sheetFrom(g, HQ_COLS, 3 + rows.length, HQ_COLS.length - 1);
}

// ── 월별 문서 만들기 ──────────────────────────────────────────────────────
const indexEntries: Array<{ month: string; fileName: string; uploadedAt: string; uploadedBy: string }> = [];
let totalMasked = 0;

for (const month of MONTHS) {
  const wb = XLSX.utils.book_new();
  for (const b of BRANCHES) XLSX.utils.book_append_sheet(wb, branchSheet(b, month), b.replace(/\s/g, ""));
  XLSX.utils.book_append_sheet(wb, hqSheet(month), "본사");

  const buffer: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
  const fileName = `${yymm(month)}_손익계산서_통합.xlsx`;
  const file = new File([buffer], fileName, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  // 화면 업로드 버튼과 **완전히 같은 함수**를 통과시킨다.
  const doc = await buildReportPackDoc(file, "데모 시드");
  if (doc.month !== yymm(month)) throw new Error(`결산월 인식 어긋남: ${doc.month} ≠ ${yymm(month)}`);

  // 왕복 확인 — 저장한 문서가 실제로 열리는지 여기서 못 박는다(화면에서 처음 알면 늦다).
  const back = await decodeReportPack(doc);
  if (!back || back.sheets.length !== BRANCHES.length + 1) throw new Error(`${month}: 복원 실패`);
  // 블록끼리 겹쳐 행을 덮어쓰는 사고가 실제로 났었다(거래내역이 손익계산서 아래 5행을 지움).
  // 눈으로 봐야 알 수 있는 종류라, 반드시 남아 있어야 할 항목을 여기서 기계로 못 박는다.
  for (const sheet of back.sheets.slice(0, BRANCHES.length)) {
    const colA = sheet.rows.map((r) => String(r[0] ?? ""));
    for (const label of ["총매출", "인건비", "세금예비(10%)", "수수료(2.2%)", "총지출", "이익금"]) {
      if (!colA.includes(label)) throw new Error(`${month}/${sheet.name}: 손익계산서 "${label}" 행이 사라졌다 — 블록이 겹쳤는지 확인할 것`);
    }
  }
  for (const sheet of back.sheets) {
    for (const row of sheet.rows) {
      for (const cell of row) {
        if (typeof cell === "string" && /\d{6}\s*-\s*\d{7}/.test(cell)) {
          throw new Error(`${month}/${sheet.name}: 주민번호가 마스킹되지 않았다 — "${cell}"`);
        }
      }
    }
  }
  totalMasked += doc.maskedFields;

  const uploadedAt = `${month}-28T02:00:00.000Z`;
  const stored = { ...doc, uploadedAt, rev: 1 };
  putShared(reportPackKey(doc.month), stored, uploadedAt);
  indexEntries.push({ month: doc.month, fileName, uploadedAt, uploadedBy: "데모 시드" });

  const kb = Math.round(doc.gzipBase64.length / 1024);
  console.log(`  - ${doc.month}: 시트 ${doc.sheetNames.length}장 / 마스킹 ${doc.maskedFields}건 / ${kb}KB`);
}

// 목록 문서 — 화면의 월 드롭다운이 이것을 읽는다. 최신월이 위로 오게 내림차순.
putShared(REPORT_PACK_INDEX_KEY, { months: [...indexEntries].reverse() }, `${MONTHS[MONTHS.length - 1]}-28T02:00:00.000Z`);

function putShared(key: string, value: unknown, updatedAt: string) {
  const id = encodeURIComponent(key);
  const next: SharedDoc = { id, data: { value, updatedAt } };
  const at = shared.findIndex((d) => d.id === id);
  if (at >= 0) shared[at] = next; else shared.push(next);
}

writeFileSync(SHARED_PATH, JSON.stringify(shared, null, 2) + "\n", "utf8");
console.log(`[통합보고서] ${MONTHS.length}개월 / 시트 ${BRANCHES.length + 1}장씩 / 마스킹 합계 ${totalMasked}건`);
console.log(`  → ${SHARED_PATH} (shared_data ${shared.length}건)`);
