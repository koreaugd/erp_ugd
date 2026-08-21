/**
 * 가상 데이터 검증기 — generate_fake_data.mjs 산출물을 시드 전에 검사한다.
 *
 *   node scripts/demo/validate_fake_data.mjs [--data <폴더>]
 *
 * 검사 항목 (스키마 지도 함정 목록 기반):
 *  1. 실지점명·실브랜드명 금지어 0건 (UGD 실데이터 유입 차단)
 *  2. daily_settles: ID 규약(enc(지점)--날짜) / master·expenses·staff 필수 / METADATA 파싱 가능
 *  3. shared_data: { value } 래퍼 / monthly_closings 는 배열 / 급여 payload 존재
 *  4. 매출집계 검증식: 총매출−총할인==실매출, 메뉴+주류+커버차지==실매출 (원 단위 오차 0)
 *  5. 매출집계 총매출 == 그 달 daily_settles totalSales 합 (3원천 정합)
 *  6. users 프로필: salaryBranches/allowedBranches 와 *Encoded 짝 일치
 *  7. admin_settings.fullTimeSalaryPasscode ≠ ""/"1234"
 *  8. edit_logs.modifiedAt 존재 / 지점명 "--" 미포함 / 파트 실수령액 0원 금지
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const dataArg = (() => { const i = argv.indexOf("--data"); return i >= 0 ? argv[i + 1] : null; })();
const DATA_DIR = path.resolve(ROOT, dataArg ?? path.join("..", "02. 재무 회계", "output", "demo_data"));

const read = (name) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));
const errors = [];
const fail = (msg) => errors.push(msg);

// UGD 실지점명·실브랜드 금지어 (하나라도 나오면 실데이터 오염 의심)
const FORBIDDEN = [
  "대물섬", "남산광어", "사카바단단", "8번대물집", "카츠스위스", "오키스테이크하우스",
  "대학로고래", "연하동", "강남대골뼈국", "마음죽", "카라멘야", "금샤빠", "을샤빠", "UGD",
];

const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
for (const f of files) {
  const text = fs.readFileSync(path.join(DATA_DIR, f), "utf8");
  for (const word of FORBIDDEN) {
    if (text.includes(word)) fail(`${f}: 금지어 "${word}" 발견 — 실데이터 유입 의심`);
  }
}

const daily = read("daily_settles.json");
const shared = read("shared_data.json");
const branches = read("public_branches.json");
const accounts = read("_auth_accounts.json");
const editLogs = read("edit_logs.json");

// 문서 id 중복 — 시드는 id 로 덮어쓰므로 중복이 있으면 쓴 건수가 배열보다 적어 "누락"으로 보인다.
// 실제로 2026-08-21 에 kakao_taxi_requests 가 빈 기본값과 표본으로 두 번 들어가 시드가 실패했다.
for (const [name, docs] of [["shared_data", shared], ["daily_settles", daily], ["public_branches", branches], ["edit_logs", editLogs]]) {
  const seen = new Map();
  for (const d of docs) seen.set(d.id, (seen.get(d.id) || 0) + 1);
  for (const [id, n] of seen) {
    if (n > 1) fail(`${name}: 중복 문서 id (${n}회) — ${decodeURIComponent(id)}`);
  }
}

const branchNames = branches.map((b) => b.data.branchName);
for (const name of branchNames) {
  if (name.includes("--")) fail(`지점명 "${name}"에 "--" 포함 — 문서 ID 규약과 충돌`);
  if (name === "본사") fail(`지점명 "본사" 금지 — 본사 전용 모드로 빠진다`);
}
for (const b of branches) {
  for (const field of ["branchId", "branchName", "brand", "role", "loginEmail"]) {
    if (!b.data[field]) fail(`public_branches/${b.id}: ${field} 누락`);
  }
  if (b.data.role !== "branch") fail(`public_branches/${b.id}: role은 "branch"여야 함`);
  if (b.data.isActive !== true) fail(`public_branches/${b.id}: isActive true 아님`);
}

// daily_settles
const dailyTotalsByBranchMonth = new Map();
for (const d of daily) {
  const { master, expenses, staff } = d.data ?? {};
  if (!master || !Array.isArray(expenses) || !Array.isArray(staff)) {
    fail(`daily_settles/${d.id}: master/expenses/staff 필수 (규칙 검증에서 거부됨)`);
    continue;
  }
  const expectedId = `${encodeURIComponent(master.branchName)}--${master.settleDate}`;
  if (d.id !== expectedId) fail(`daily_settles/${d.id}: ID가 규약(${expectedId})과 다름 — 미제출로 보인다`);
  if (d.data.recordId !== d.id || master.recordId !== d.id) fail(`daily_settles/${d.id}: recordId 불일치`);
  if (!branchNames.includes(master.branchName)) fail(`daily_settles/${d.id}: 미등록 지점 "${master.branchName}"`);
  const sum = master.cashSales + master.cardSales + master.transferSales + master.deliverySales;
  if (sum !== master.totalSales) fail(`daily_settles/${d.id}: 4종 합(${sum}) != totalSales(${master.totalSales})`);
  const parts = String(master.memo || "").split("\n---\nMETADATA:");
  if (parts.length !== 2) { fail(`daily_settles/${d.id}: memo에 METADATA 구획 없음 — 월말 현금/지출 화면이 빈다`); continue; }
  let meta;
  try { meta = JSON.parse(parts[1]); } catch { fail(`daily_settles/${d.id}: METADATA JSON 파싱 실패`); continue; }
  // 화면 코드는 이 필드들을 검사 없이 배열/문자열로 실행한다(cashExpenses.forEach 등) —
  // 키 존재만 보면 잘못된 타입이 통과해 월말 현금 화면이 깨진다(Codex 2R P1).
  for (const key of ["staffRows", "cashExpenses", "cardExpenses"]) {
    if (!Array.isArray(meta[key])) fail(`daily_settles/${d.id}: METADATA.${key}가 배열이 아님`);
  }
  for (const key of ["cashBalance", "prevDayCash"]) {
    if (typeof meta[key] !== "string" || meta[key] === "" || Number.isNaN(Number(meta[key]))) {
      fail(`daily_settles/${d.id}: METADATA.${key}는 숫자 문자열이어야 함`);
    }
  }
  for (const list of ["cashExpenses", "cardExpenses"]) {
    for (const row of Array.isArray(meta[list]) ? meta[list] : []) {
      if (typeof row?.classification !== "string" || typeof row?.usage !== "string" ||
          typeof row?.detail !== "string" || typeof row?.amount !== "string" || Number.isNaN(Number(row.amount))) {
        fail(`daily_settles/${d.id}: METADATA.${list} 행 형태 불량(${JSON.stringify(row)})`);
      }
    }
  }
  for (const row of Array.isArray(meta.staffRows) ? meta.staffRows : []) {
    if (!["정직원", "파트타이머"].includes(row?.division) || typeof row?.name !== "string" ||
        typeof row?.workHours !== "number" || typeof row?.overtime !== "number") {
      fail(`daily_settles/${d.id}: METADATA.staffRows 행 형태 불량(${row?.name})`);
    }
  }
  const key = `${master.branchName}|${master.settleDate.slice(0, 7)}`;
  dailyTotalsByBranchMonth.set(key, (dailyTotalsByBranchMonth.get(key) ?? 0) + master.totalSales);
}

// shared_data
const sharedById = new Map(shared.map((s) => [decodeURIComponent(s.id), s.data]));
for (const s of shared) {
  if (!s.data || !("value" in s.data)) fail(`shared_data/${s.id}: { value } 래퍼 없음 — 앱이 null로 읽는다`);
  else if (typeof s.data.updatedAt !== "string" || !s.data.updatedAt) fail(`shared_data/${s.id}: updatedAt 누락 — 운영 기록 형태({value, updatedAt})와 다름`);
}
const closingsDoc = sharedById.get("monthly_closings");
if (!closingsDoc || !Array.isArray(closingsDoc.value)) {
  fail("shared_data/monthly_closings: 배열이 아님 — 마감 화면 전체가 fail-closed로 잠긴다");
} else {
  // 화면은 레코드를 branchName·month·section으로 거르고 updatedAt/confirmedAt로 최신을 고른 뒤
  // status를 읽는다 — 필드가 빠진 레코드는 검증을 통과해도 화면에선 '미마감'으로 보인다(Codex 2R P1).
  const CLOSE_SECTIONS = ["purchase", "salary", "salesSummary", "partTimeSalary"];
  const CHECK_SECTIONS = ["businessTaxi", "annualLeave"];
  const seenSections = new Set();
  for (const rec of closingsDoc.value) {
    const where = `monthly_closings[${rec?.branchName}-${rec?.month}-${rec?.section}]`;
    if (!branchNames.includes(rec?.branchName)) fail(`${where}: 미등록 지점`);
    if (!/^\d{4}-\d{2}$/.test(rec?.month ?? "")) fail(`${where}: month 형식 불량`);
    if (![...CLOSE_SECTIONS, ...CHECK_SECTIONS].includes(rec?.section)) fail(`${where}: section 값 불량`);
    if (!["confirmed", "editing", "pending"].includes(rec?.status)) fail(`${where}: status 값 불량`);
    if (typeof rec?.updatedAt !== "string" || !rec.updatedAt) fail(`${where}: updatedAt 누락 — 최신 레코드 선별이 깨진다`);
    if (rec?.status === "confirmed" && !rec?.confirmedAt) fail(`${where}: confirmed인데 confirmedAt 없음`);
    if (CLOSE_SECTIONS.includes(rec?.section) && rec?.id !== `${rec?.branchName}-${rec?.month}-${rec?.section}`) {
      fail(`${where}: id가 규약(지점-월-섹션)과 다름`);
    }
    seenSections.add(`${rec?.branchName}|${rec?.month}|${rec?.section}`);
  }
  // 마감완료로 시드한 달은 6개 섹션(마감 4 + 확인 2)이 전부 있어야 게이트가 열린다
  const closedMonths = [...new Set(closingsDoc.value.map((r) => r?.month).filter(Boolean))];
  for (const branch of branchNames) {
    for (const month of closedMonths) {
      for (const section of [...CLOSE_SECTIONS, ...CHECK_SECTIONS]) {
        if (!seenSections.has(`${branch}|${month}|${section}`)) fail(`monthly_closings: ${branch} ${month} ${section} 레코드 누락 — 마감 게이트가 잠긴다`);
      }
    }
  }
}
const adminSettings = sharedById.get("admin_settings")?.value;
if (!adminSettings) fail("shared_data/admin_settings 없음");
else if (!adminSettings.fullTimeSalaryPasscode) {
  // "1234"는 운영 앱에선 '미설정' 취급이지만 데모 빌드는 IS_DEMO 예외로 허용한다(2026-08-20 지시).
  fail("admin_settings.fullTimeSalaryPasscode 미설정 — 급여대장이 영구 잠김");
}

// 매출집계 검증식 + 3원천 정합
let checkedSummaries = 0;
for (const [key, doc] of sharedById) {
  const m = key.match(/^monthly_sales_summary:(.+):(\d{4}-\d{2})$/);
  if (!m) continue;
  checkedSummaries++;
  const [, branch, month] = m;
  const v = doc.value;
  const n = (x) => Number(v[x]);
  if (n("totalSales") - n("totalDiscount") !== n("netSales")) fail(`${key}: 총매출-총할인 != 실매출`);
  if (n("menuSales") + n("liquorSales") + n("coverCharge") !== n("netSales")) fail(`${key}: 메뉴+주류+커버차지 != 실매출`);
  const dailySum = dailyTotalsByBranchMonth.get(`${branch}|${month}`);
  if (dailySum !== n("totalSales")) fail(`${key}: 월 총매출(${n("totalSales")}) != 일일마감 합(${dailySum})`);
  // 급여 payload 짝 존재 확인
  for (const paired of ["monthly_purchases", "monthly_fulltime_salary", "part_time_salaries"]) {
    if (!sharedById.has(`${paired}:${branch}:${month}`)) fail(`${paired}:${branch}:${month} 누락`);
  }
}
if (checkedSummaries === 0) fail("monthly_sales_summary 문서가 하나도 없음");

// 파트 급여 실수령 0원 금지
for (const [key, doc] of sharedById) {
  if (!key.startsWith("part_time_salaries:")) continue;
  for (const row of doc.value) {
    if (!Number(row.actualPaidAmount)) fail(`${key}: ${row.name} 실수령액 0원 — 마감 차단 사유가 된다`);
  }
}

// users 프로필 Encoded 짝
for (const acc of accounts) {
  const p = acc.profile;
  if (!p) continue;
  for (const [plain, encoded] of [["salaryBranches", "salaryBranchesEncoded"], ["allowedBranches", "allowedBranchesEncoded"]]) {
    const a = p[plain], b = p[encoded];
    if (a === undefined) continue;
    if (a === "all") { if (b !== "all") fail(`${acc.email}: ${plain}="all"인데 ${encoded}!="all"`); continue; }
    const expect = a.map((s) => encodeURIComponent(s));
    if (JSON.stringify(expect) !== JSON.stringify(b)) fail(`${acc.email}: ${encoded}가 ${plain}의 인코딩본과 다름 — 급여/지점 권한이 서버에서 거부된다`);
  }
  if (p.reviewedByAdmin !== true) fail(`${acc.email}: reviewedByAdmin true 아님 — 로그인 후 대기 화면에 갇힌다`);
}
const gateEmails = branches.map((b) => b.data.loginEmail).concat(["admin@ugd-erp.example"]);
for (const email of gateEmails) {
  if (!accounts.some((a) => a.email === email)) fail(`게이트 계정 ${email} 누락 — PIN 검증 불가`);
}

// edit_logs
for (const log of editLogs) {
  if (!log.data.modifiedAt) fail(`edit_logs/${log.id}: modifiedAt 누락 — 정렬에서 런타임 오류`);
}

// 결과
if (errors.length) {
  console.error(`[실패] ${errors.length}건:`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`[통과] daily ${daily.length}건 / shared ${shared.length}건 / 지점 ${branches.length} / 계정 ${accounts.length} — 결함 0건`);
