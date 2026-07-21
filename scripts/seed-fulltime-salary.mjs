/**
 * 정직원 급여대장 엑셀 파싱 결과(JSON) → Firestore shared_data 쓰기.
 *
 *   python scripts/parse-fulltime-salary-xlsx.py -o /tmp/salary.json
 *   node scripts/seed-fulltime-salary.mjs /tmp/salary.json                 # dry-run (기본, 아무것도 안 씀)
 *   node scripts/seed-fulltime-salary.mjs /tmp/salary.json --commit        # 실제 쓰기 + 백업 + 재조회 검증
 *   node scripts/seed-fulltime-salary.mjs /tmp/salary.json --branch 남산광어  # 한 지점만
 *
 * 되돌리기: node scripts/revert-backup.mjs <backup.json> --commit
 *
 * 쓰기 대상: monthly_fulltime_salary:{지점}:{월}  (setDoc, 문서 전체 덮어쓰기)
 *
 * 안전장치
 *   - 급여(salary) 섹션이 확정/수정중인 지점은 중단 (--allow-editing 으로 '수정중'만 허용)
 *   - 쓰기 전 기존 값을 scripts/backups/ 에 스냅샷 (revert-backup.mjs 호환 형식)
 *   - 직원명부와 이름이 맞으면 employeeId 를 붙인다 → ERP 가 명부 행과 합쳐서 보여준다.
 *     못 붙이면 수기행(isManual)으로 들어가 명단 아래에 따로 뜬다(값이 사라지지는 않는다).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDocFromServer, runTransaction } from "firebase/firestore";

import config from "../firebase-applet-config.json" with { type: "json" };
import { signInAsAdmin } from "./lib/admin-auth.mjs";
import { sectionStatus } from "./lib/close-guard.mjs";
import { isUnchangedSincePlan } from "./lib/shared-doc-guard.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const allowEditing = argv.includes("--allow-editing");
const onlyBranch = (() => {
  const i = argv.indexOf("--branch");
  return i === -1 ? null : argv[i + 1];
})();
const [inputPath] = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--branch");
if (!inputPath) {
  console.error("사용법: node scripts/seed-fulltime-salary.mjs <parsed.json> [--commit] [--branch 지점명] [--allow-editing]");
  process.exit(1);
}

const payload = JSON.parse(readFileSync(resolve(inputPath), "utf-8"));
const MONTH = payload.month;
if (!/^\d{4}-\d{2}$/.test(String(MONTH))) {
  console.error(`JSON 의 month 가 이상합니다: ${MONTH}`);
  process.exit(1);
}

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);
await signInAsAdmin(app);

const sharedRef = (dataKey) => doc(db, "shared_data", encodeURIComponent(dataKey));
async function readShared(dataKey) {
  const snap = await getDocFromServer(sharedRef(dataKey));
  return snap.exists() ? { value: snap.data().value ?? null, updatedAt: snap.data().updatedAt ?? null } : undefined;
}

const money = (v) => Number(String(v ?? "").replace(/[^0-9.-]/g, "")) || 0;
// ERP rowOvertimePay / rowTotal 과 같은 산식이어야 화면 합계와 여기 검산이 어긋나지 않는다.
const otPay = (r) => {
  const h = Number(String(r.overtimeHours ?? "").replace(/[^0-9.]/g, "")) || 0;
  const rate = money(r.overtimeRate);
  return h > 0 && rate > 0 ? Math.round(h * rate) : money(r.overtimePay);
};
const rowTotal = (r) => money(r.thisSalary) + money(r.taxiEtc) + money(r.bonusTip) + otPay(r);
const sumRows = (rows) => (Array.isArray(rows) ? rows.reduce((a, r) => a + rowTotal(r), 0) : 0);
const slug = (s) => String(s).replace(/[^0-9A-Za-z가-힣]/g, "").slice(0, 20);

// ---------------------------------------------------------------- 마감 상태 확인
const closingsDoc = await readShared("monthly_closings");
const closings = Array.isArray(closingsDoc?.value) ? closingsDoc.value : [];
// 상태 판정은 close-guard 의 sectionStatus 를 그대로 쓴다(MonthlySettleTab getSectionStatus 와 같은 규칙).
// 여기서 따로 구현하면 두 판정이 갈라져, 화면에선 확정인데 스크립트는 아니라고 보는 사고가 난다.
const salaryStatusOf = (rows, branchName) => sectionStatus(rows, branchName, MONTH, "salary");
/** 이 상태에 써도 되는가. 계획 단계와 트랜잭션 안에서 '같은 함수'로 판정해야 한다. */
const isWritable = (status) => status !== "confirmed" && (status !== "editing" || allowEditing);

// ---------------------------------------------------------------- 계획 세우기
const branches = Object.keys(payload.branches).filter((b) => !onlyBranch || b === onlyBranch);
if (onlyBranch && branches.length === 0) {
  console.error(`--branch ${onlyBranch} 는 JSON 에 없습니다. 있는 지점: ${Object.keys(payload.branches).join(", ")}`);
  process.exit(1);
}

const plan = [];
const blocked = [];
const warnings = [];

for (const branchName of branches) {
  const status = salaryStatusOf(closings, branchName);
  if (!isWritable(status)) {
    blocked.push({ branchName, status });
    continue;
  }

  // 직원명부에서 employeeId 를 찾아 붙인다. 이름이 같은 사람이 명부에 둘 이상이면 누구인지 알 수 없으므로
  // 붙이지 않고 경고한다(엉뚱한 사람의 급여로 합쳐지는 것보다 수기행으로 남는 편이 안전하다).
  const rosterSnap = await getDocFromServer(doc(db, "branch_own_rosters", encodeURIComponent(branchName)));
  const employees = rosterSnap.exists() && Array.isArray(rosterSnap.data().employees) ? rosterSnap.data().employees : [];
  const fullTime = employees.filter((e) => e && e.division === "정직원" && String(e.name || "").trim());
  const byName = new Map();
  const dupNames = new Set();
  for (const e of fullTime) {
    const nm = String(e.name).trim();
    if (byName.has(nm)) dupNames.add(nm);
    byName.set(nm, e);
  }

  const parsed = payload.branches[branchName];
  const rows = parsed.map((src, idx) => {
    const name = String(src.name || "").trim();
    const emp = src.forceNewRow || dupNames.has(name) ? null : byName.get(name);
    if (dupNames.has(name)) warnings.push(`${branchName}/${name}: 직원명부에 같은 이름이 2명 이상 → 수기행으로 넣음`);

    // ERP FullTimeSalaryRow 그대로. Firestore 는 undefined 가 하나라도 있으면 문서 전체 저장을 거부하므로
    // employeeId 는 '있을 때만' 넣는다(빈 문자열로 채우면 명부 매칭이 깨진다).
    const row = {
      id: emp?.id ? `ft_${emp.id}` : `ft_manual_${slug(branchName)}_${slug(name) || idx}`,
      name,
      rank: src.rank || "",
      residentNumber: src.residentNumber || "",
      entryDate: src.entryDate || "",
      contractType: src.contractType || "4대보험",
      bank: src.bank || "",
      accountNumber: src.accountNumber || "",
      prevSalary: src.prevSalary || "",
      thisSalary: src.thisSalary || "",
      taxiEtc: src.taxiEtc || "",
      bonusTip: src.bonusTip || "",
      overtimePay: "",
      overtimeHours: src.overtimeHours || "",
      overtimeRate: src.overtimeRate || "",
      remitBranch: src.remitBranch || "",
      memo: src.memo || "",
    };
    if (emp?.id) row.employeeId = emp.id;
    else row.isManual = true;
    return row;
  });

  const dataKey = `monthly_fulltime_salary:${branchName}:${MONTH}`;
  const existing = await readShared(dataKey);
  plan.push({
    branchName,
    dataKey,
    rows,
    total: sumRows(rows),
    status,
    matched: rows.filter((r) => r.employeeId).length,
    rosterCount: fullTime.length,
    previous: existing?.value ?? null,
    previousExists: existing !== undefined,
    previousUpdatedAt: existing?.updatedAt ?? null,
    previousTotal: sumRows(existing?.value),
  });
}

// ---------------------------------------------------------------- 계획 출력
console.log(`\n■ 정직원 급여대장 ${MONTH} 시드 (${commit ? "COMMIT" : "DRY-RUN"})\n`);
console.log(
  `${"지점".padEnd(20)}${"인원".padStart(5)}${"명부매칭".padStart(9)}${"수기행".padStart(7)}` +
  `${"쓸 총액".padStart(15)}${"기존 총액".padStart(15)}  기존 상태`
);
let grand = 0;
for (const p of plan) {
  grand += p.total;
  const prev = p.previousExists ? `문서있음(${Array.isArray(p.previous) ? p.previous.length : "?"}행)` : "문서없음";
  console.log(
    `${p.branchName.padEnd(20)}${String(p.rows.length).padStart(5)}${String(p.matched).padStart(9)}` +
    `${String(p.rows.length - p.matched).padStart(7)}${p.total.toLocaleString().padStart(15)}` +
    `${p.previousTotal.toLocaleString().padStart(15)}  ${prev}${p.status ? ` / 마감 ${p.status}` : ""}`
  );
}
console.log(`\n합계: ${plan.reduce((a, p) => a + p.rows.length, 0)}명 / ${grand.toLocaleString()}원`);

if (warnings.length) {
  console.log("\n■ 경고");
  warnings.forEach((w) => console.log("  -", w));
}

if (blocked.length) {
  console.error(`\n중단: 급여 마감 때문에 쓸 수 없는 지점이 ${blocked.length}곳 있습니다.`);
  blocked.forEach((b) => console.error(`  - ${b.branchName}: ${b.status}${b.status === "editing" ? " (강행하려면 --allow-editing)" : " — 관리자 화면에서 마감을 취소해야 합니다"}`));
  process.exit(1);
}

if (!commit) {
  console.log("\ndry-run 입니다. 아무것도 쓰지 않았습니다. 실제로 쓰려면 --commit 을 붙이세요.");
  process.exit(0);
}

// ---------------------------------------------------------------- 백업 후 쓰기
mkdirSync(resolve(SCRIPT_DIR, "backups"), { recursive: true });
const now = new Date().toISOString();
const backupPath = resolve(SCRIPT_DIR, "backups", `fulltime-salary-backup-${MONTH}-${Date.now()}.json`);
writeFileSync(
  backupPath,
  JSON.stringify(
    {
      month: MONTH,
      entries: plan.map((p) => ({
        dataKey: p.dataKey,
        previous: p.previousExists ? p.previous : null,
        expectedAfter: p.rows,        // 내가 쓴 그 상태일 때만 되돌린다(지점이 그 뒤 고쳤으면 건너뜀)
        expectedUpdatedAt: now,
      })),
    },
    null,
    2
  ),
  "utf-8"
);
console.log(`\n백업 저장: ${backupPath}`);

// 조건부 쓰기(compare-and-set). 계획을 세울 때 읽은 그 문서일 때만 덮어쓴다.
//
// 왜 그냥 setDoc 하면 안 되나: 계획 읽기와 쓰기 사이(지점 12곳 조회에 수 초, 사람이 dry-run 을 검토하는
// 동안이면 수 분)에 지점이 급여대장을 저장하면, 그 편집이 조용히 사라진다. 게다가 백업에 담긴 previous 는
// '편집 전' 값이라 되돌려도 그 편집은 복구되지 않는다 — 즉 영구 유실이다.
// 그래서 트랜잭션 안에서 updatedAt 과 값을 다시 대조하고, 하나라도 다르면 그 지점만 건너뛴다.
class SkipWrite extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
const written = [];
const skipped = [];
for (const p of plan) {
  try {
    await runTransaction(db, async (tx) => {
      // Firestore 트랜잭션은 쓰기 전에 읽기를 끝내야 한다 — 두 문서를 먼저 읽는다.
      //
      // 마감 상태(monthly_closings)를 여기서 '다시' 읽는 게 핵심이다. 계획 단계에서 한 번 읽고 말면,
      // 그 뒤 지점이 급여를 확정해버려도 모른 채 확정된 달의 급여를 덮어쓴다.
      // 특히 확정은 급여 행 문서를 건드리지 않고 끝나는 경우가 많아(flushFullTimeSalaryForClose 는
      // 서버 값이 이미 멀쩡하면 아무것도 쓰지 않는다) 행 문서 대조만으로는 절대 잡히지 않는다.
      const closingSnap = await tx.get(sharedRef("monthly_closings"));
      const snap = await tx.get(sharedRef(p.dataKey));

      const liveClosings = closingSnap.exists() && Array.isArray(closingSnap.data().value) ? closingSnap.data().value : [];
      const liveStatus = salaryStatusOf(liveClosings, p.branchName);
      if (!isWritable(liveStatus)) throw new SkipWrite(`그 사이 급여 마감이 '${liveStatus}' 로 바뀜`);

      const current = snap.exists()
        ? { exists: true, updatedAt: snap.data().updatedAt ?? null, value: snap.data().value ?? null }
        : { exists: false, updatedAt: null, value: null };
      if (!isUnchangedSincePlan(p, current)) throw new SkipWrite("그 사이 다른 기기가 급여대장을 저장함");

      tx.set(sharedRef(p.dataKey), { value: p.rows, updatedAt: now });
    });
    written.push(p);
    console.log(`  쓰기 완료  ${p.branchName} (${p.rows.length}행 / ${p.total.toLocaleString()}원)`);
  } catch (error) {
    if (!(error instanceof SkipWrite)) throw error;
    skipped.push({ ...p, reason: error.reason });
    console.log(`  건너뜀    ${p.branchName} — ${error.reason}(덮어쓰지 않음)`);
  }
}

// ---------------------------------------------------------------- 재조회 검증
console.log("\n■ 재조회 검증");
let failures = 0;
for (const p of written) {
  const actual = await readShared(p.dataKey);
  const rows = actual?.value;
  const ok = Array.isArray(rows) && rows.length === p.rows.length && sumRows(rows) === p.total;
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "실패"} ${p.branchName.padEnd(20)} ${Array.isArray(rows) ? rows.length : "?"}행 / ${sumRows(rows).toLocaleString()}원`);
}
if (skipped.length) {
  console.log(`\n건너뛴 지점 ${skipped.length}곳 — 아래 사유를 확인하고 처리한 뒤 다시 실행하세요(그때 최신 상태로 다시 대조합니다):`);
  skipped.forEach((p) => {
    console.log(`  · ${p.branchName}: ${p.reason}`);
    console.log(`    node scripts/seed-fulltime-salary.mjs "${inputPath}" --branch ${p.branchName} --commit`);
  });
}
console.log(
  failures === 0
    ? `\n쓰기 ${written.length}곳 검증 통과.${skipped.length ? ` (건너뜀 ${skipped.length}곳)` : ""}`
    : `\n검증 실패 ${failures}건 — 되돌리려면: node scripts/revert-backup.mjs "${backupPath}" --commit`
);
process.exit(failures === 0 && skipped.length === 0 ? 0 : 1);
