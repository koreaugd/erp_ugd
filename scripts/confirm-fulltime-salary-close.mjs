/**
 * 정직원 급여대장(salary) 섹션 마감제출 일괄 확정.
 *
 *   node scripts/confirm-fulltime-salary-close.mjs 2026-07                # dry-run (기본)
 *   node scripts/confirm-fulltime-salary-close.mjs 2026-07 --commit       # 실제 확정
 *   node scripts/confirm-fulltime-salary-close.mjs 2026-07 --branch 남산광어 --commit
 *
 * 되돌리기: node scripts/revert-backup.mjs <backup.json> --commit
 *
 * 지점 화면의 '마감제출'(MonthlySettleTab handleConfirm → saveSectionClose)과 같은 결과를 만든다.
 *   - 확정 전 급여 데이터가 서버에 실제로 있는지 검사(flushFullTimeSalaryForClose 의 hasMeaningful 과 같은 규칙)
 *   - monthly_closings 에 status:"confirmed" 레코드를 남긴다(writer=지점명 — 지점 화면과 같은 모양)
 *
 * 왜 트랜잭션 하나로 묶는가:
 *   monthly_closings 는 전 지점·전 섹션이 공유하는 '문서 한 개'다. 13건을 따로 저장하면 각자
 *   read-modify-write 를 해서 서로의 레코드를 덮어쓴다. 그래서 읽기→13건 병합→쓰기를 한 트랜잭션에 담는다.
 *   급여 문서도 같은 트랜잭션 안에서 읽어, 검사한 그 데이터가 확정되는 것을 보장한다.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, getDocFromServer, getDocsFromServer, runTransaction } from "firebase/firestore";

import config from "../firebase-applet-config.json" with { type: "json" };
import { signInAsAdmin } from "./lib/admin-auth.mjs";
import { sectionStatus } from "./lib/close-guard.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SECTION = "salary";
const CLOSINGS_KEY = "monthly_closings";

const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const onlyBranch = (() => { const i = argv.indexOf("--branch"); return i === -1 ? null : argv[i + 1]; })();
const MONTH = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--branch")[0];
if (!/^\d{4}-\d{2}$/.test(String(MONTH))) {
  console.error("사용법: node scripts/confirm-fulltime-salary-close.mjs <YYYY-MM> [--commit] [--branch 지점명]");
  process.exit(1);
}

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);
await signInAsAdmin(app);

const sharedRef = (dataKey) => doc(db, "shared_data", encodeURIComponent(dataKey));
const salaryKey = (b) => `monthly_fulltime_salary:${b}:${MONTH}`;

const money = (v) => Number(String(v ?? "").replace(/[^0-9.-]/g, "")) || 0;
// 급여대장 탭 rowOvertimePay 와 같은 규칙(시간·시급 둘 다 있을 때만 계산, 아니면 옛 금액).
const otPay = (r) => {
  const h = Number(String(r.overtimeHours ?? "").replace(/[^0-9.]/g, "")) || 0;
  const rate = money(r.overtimeRate);
  return h > 0 && rate > 0 ? Math.round(h * rate) : money(r.overtimePay);
};
const rowTotal = (r) => money(r.thisSalary) + money(r.taxiEtc) + money(r.bonusTip) + otPay(r);
// flushFullTimeSalaryForClose 의 hasMeaningful 과 같은 판정 — 금액이 있는 행이 하나라도 있어야 확정 가능.
const hasMeaningful = (rows) => Array.isArray(rows) && rows.some((r) => rowTotal(r) > 0);

// ---------------------------------------------------------------- 대상 추리기
const branchSnap = await getDocsFromServer(collection(db, "public_branches"));
const allBranches = branchSnap.docs.map((d) => d.data().branchName).filter(Boolean).sort();
const branches = onlyBranch ? allBranches.filter((b) => b === onlyBranch) : allBranches;
if (onlyBranch && branches.length === 0) {
  console.error(`--branch ${onlyBranch} 를 지점 목록에서 찾지 못했습니다: ${allBranches.join(", ")}`);
  process.exit(1);
}

const closingsSnap = await getDocFromServer(sharedRef(CLOSINGS_KEY));
const closings = closingsSnap.exists() && Array.isArray(closingsSnap.data().value) ? closingsSnap.data().value : [];

const targets = [];
const skips = [];
for (const branchName of branches) {
  const snap = await getDocFromServer(sharedRef(salaryKey(branchName)));
  const rows = snap.exists() ? snap.data().value : undefined;
  const status = sectionStatus(closings, branchName, MONTH, SECTION);
  const total = Array.isArray(rows) ? rows.reduce((a, r) => a + rowTotal(r), 0) : 0;

  if (!hasMeaningful(rows)) { skips.push({ branchName, why: "급여 데이터 없음(금액이 있는 행이 없음)" }); continue; }
  if (status === "confirmed") { skips.push({ branchName, why: "이미 확정됨" }); continue; }
  // '수정중'은 지점이 확정본을 열어 고치는 중이다. 여기서 확정하면 지점이 입력해야 할 '수정 사유'를 건너뛰게 되고,
  // 앱의 재확정 게이트(serverReconfirm && !reason → 거부)와도 어긋난다. 사람이 판단하도록 남긴다.
  if (status === "editing") { skips.push({ branchName, why: "지점이 마감수정 중 — 지점이 사유와 함께 직접 제출해야 함" }); continue; }
  targets.push({ branchName, rowCount: rows.length, total, status: status || "기록없음" });
}

console.log(`\n■ 정직원 급여대장 ${MONTH} 마감제출 (${commit ? "COMMIT" : "DRY-RUN"})\n`);
console.log(`${"지점".padEnd(20)}${"인원".padStart(5)}${"총액".padStart(15)}   현재상태`);
targets.forEach((t) => console.log(`${t.branchName.padEnd(20)}${String(t.rowCount).padStart(5)}${t.total.toLocaleString().padStart(15)}   ${t.status}`));
console.log(`\n확정 대상 ${targets.length}곳 / 합계 ${targets.reduce((a, t) => a + t.total, 0).toLocaleString()}원`);
if (skips.length) {
  console.log(`\n건너뜀 ${skips.length}곳`);
  skips.forEach((s) => console.log(`  - ${s.branchName}: ${s.why}`));
}
if (targets.length === 0) { console.log("\n확정할 지점이 없습니다."); process.exit(0); }
if (!commit) { console.log("\ndry-run 입니다. 아무것도 쓰지 않았습니다. 실제로 확정하려면 --commit 을 붙이세요."); process.exit(0); }

// ---------------------------------------------------------------- 백업 후 확정
mkdirSync(resolve(SCRIPT_DIR, "backups"), { recursive: true });
const backupPath = resolve(SCRIPT_DIR, "backups", `salary-close-backup-${MONTH}-${Date.now()}.json`);
writeFileSync(backupPath, JSON.stringify({
  month: MONTH,
  entries: [{ dataKey: CLOSINGS_KEY, previous: closingsSnap.exists() ? closingsSnap.data().value ?? null : null }],
}, null, 2), "utf-8");
console.log(`\n백업 저장: ${backupPath}`);

const now = new Date().toISOString();
const applied = [];
const aborted = [];

await runTransaction(db, async (tx) => {
  applied.length = 0; aborted.length = 0; // 트랜잭션은 재시도될 수 있다 — 매번 처음부터 다시 판정한다.

  // 쓰기 전에 필요한 문서를 모두 읽는다(Firestore 규칙).
  const closeSnap = await tx.get(sharedRef(CLOSINGS_KEY));
  const liveRows = new Map();
  for (const t of targets) {
    const s = await tx.get(sharedRef(salaryKey(t.branchName)));
    liveRows.set(t.branchName, s.exists() ? s.data().value : undefined);
  }

  let list = closeSnap.exists() && Array.isArray(closeSnap.data().value) ? [...closeSnap.data().value] : [];

  for (const t of targets) {
    const branchName = t.branchName;
    // 계획을 세운 뒤 지점이 급여를 비웠거나 이미 확정/수정중으로 바꿨을 수 있다 — 여기서 다시 판정한다.
    if (!hasMeaningful(liveRows.get(branchName))) { aborted.push({ branchName, why: "확정 직전 급여 데이터가 비어 있음" }); continue; }
    const liveStatus = sectionStatus(list, branchName, MONTH, SECTION);
    if (liveStatus === "confirmed") { aborted.push({ branchName, why: "그 사이 지점이 확정함" }); continue; }
    if (liveStatus === "editing") { aborted.push({ branchName, why: "그 사이 지점이 마감수정으로 열었음" }); continue; }

    const matches = (r) => r.branchName === branchName && r.month === MONTH && (r.section || "purchase") === SECTION;
    const prev = list.filter(matches)
      .sort((a, b) => String(b.updatedAt || b.confirmedAt || "").localeCompare(String(a.updatedAt || a.confirmedAt || "")))[0];
    // 표식·이력은 '확정 계보(confirmed↔editing)' 안에서만 이어받는다 — 지점 화면 saveSectionClose 와 같은 규칙.
    // 여기 오는 건은 직전이 pending 이거나 기록 없음이라 계보 밖 → 표식 false, 이력 [] 인 '깨끗한 최초 제출'이 된다.
    const inLineage = prev?.status === "confirmed" || prev?.status === "editing";
    const record = {
      id: `${branchName}-${MONTH}-${SECTION}`,
      branchName, month: MONTH, section: SECTION, status: "confirmed", writer: branchName,
      confirmedAt: now,
      editedAfterConfirm: !!(inLineage && prev?.editedAfterConfirm),
      editEvents: inLineage && Array.isArray(prev?.editEvents) ? prev.editEvents : [],
      updatedAt: now,
    };
    list = [record, ...list.filter((r) => !matches(r))];
    applied.push(branchName);
  }

  if (applied.length === 0) throw new Error("확정할 대상이 남지 않았습니다(전부 상태가 바뀜). 아무것도 쓰지 않았습니다.");
  tx.set(sharedRef(CLOSINGS_KEY), { value: list, updatedAt: now });
});

console.log(`\n확정 완료 ${applied.length}곳: ${applied.join(", ")}`);
if (aborted.length) {
  console.log(`\n확정 직전에 제외된 ${aborted.length}곳:`);
  aborted.forEach((a) => console.log(`  - ${a.branchName}: ${a.why}`));
}

// ---------------------------------------------------------------- 재조회 검증
const after = await getDocFromServer(sharedRef(CLOSINGS_KEY));
const list = after.exists() && Array.isArray(after.data().value) ? after.data().value : [];
let failures = 0;
console.log("\n■ 재조회 검증");
for (const branchName of applied) {
  const st = sectionStatus(list, branchName, MONTH, SECTION);
  const ok = st === "confirmed";
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "실패"} ${branchName.padEnd(20)} ${st}`);
}
console.log(failures === 0
  ? "\n전체 검증 통과."
  : `\n검증 실패 ${failures}건 — 되돌리려면: node scripts/revert-backup.mjs "${backupPath}" --commit`);
process.exit(failures === 0 ? 0 : 1);
