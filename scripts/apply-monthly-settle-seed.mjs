/**
 * 월말정산 시드 JSON → Firestore shared_data 쓰기.
 *
 *   node scripts/apply-monthly-settle-seed.mjs <seed.json>                        # dry-run (기본)
 *   node scripts/apply-monthly-settle-seed.mjs <seed.json> --commit
 *   node scripts/apply-monthly-settle-seed.mjs <seed.json> --commit --force-confirmed="카라멘야"
 *
 * seed-monthly-purchases.mjs 와 다른 점
 *   - 다음 달 문서를 건드리지 않는다 (이월 데이터를 지우지 않음)
 *   - 확정(confirmed) 지점은 --force-confirmed 에 이름을 명시해야만 덮어쓴다
 *     (확정인데 금액이 통째로 날아간 지점을 복구하는 용도. 실수로 덮어쓰는 것을 막기 위해 이름을 요구한다)
 *
 * 되돌리기: node scripts/revert-backup.mjs <backup.json> --commit
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDocFromServer, runTransaction } from "firebase/firestore";

import config from "../firebase-applet-config.json" with { type: "json" };
import { blockedTargets, reportBlocked, sectionStatus } from "./lib/close-guard.mjs";
import { signInAsAdmin } from "./lib/admin-auth.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const forceArg = argv.find((a) => a.startsWith("--force-confirmed="));
const forced = forceArg ? forceArg.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
const [inputPath] = argv.filter((a) => !a.startsWith("--"));
if (!inputPath) {
  console.error("사용법: node scripts/apply-monthly-settle-seed.mjs <seed.json> [--commit] [--force-confirmed=\"지점명,...\"]");
  process.exit(1);
}

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);
await signInAsAdmin(app);

const sharedRef = (dataKey) => doc(db, "shared_data", encodeURIComponent(dataKey));
const readShared = async (dataKey) => {
  const snap = await getDocFromServer(sharedRef(dataKey));
  return snap.exists() ? snap.data().value ?? null : undefined;
};

const num = (v) => Number(String(v ?? "").replace(/[^\d]/g, "")) || 0;
// monthlyCloseWorkbook.ts 의 export 규칙과 동일하게 계산한다.
const transferExport = (r) => (r?.transferNeeded === false ? 0 : num(r?.transferAmount));
const usageExport = (r) => {
  // 선입금 개념 폐지(2026-08-02) — 옛 선입금 행만 옛 규칙 그대로(monthlyCloseWorkbook.ts와 동일).
  if (r?.isPrepaid === true) return num(r?.monthlyUsageAmount);
  if (r?.transferNeeded !== false) return 0;
  return String(r?.monthlyUsageAmount ?? "").trim() === "" ? num(r?.transferAmount) : num(r?.monthlyUsageAmount);
};
const sumT = (rows) => (Array.isArray(rows) ? rows.reduce((a, r) => a + transferExport(r), 0) : 0);
const sumU = (rows) => (Array.isArray(rows) ? rows.reduce((a, r) => a + usageExport(r), 0) : 0);

const seed = JSON.parse(readFileSync(inputPath, "utf-8"));
const { month, documents } = seed;
const closings = (await readShared("monthly_closings")) || [];

// ---------------------------------------------------------------- 마감 상태 가드
const keys = documents.map((d) => d.dataKey);
const blocked = blockedTargets(closings, keys, { allowEditing: false }).filter(
  (b) => !(b.status === "confirmed" && forced.includes(b.branchName))
);
if (reportBlocked(blocked)) process.exit(1);

for (const branchName of forced) {
  const status = sectionStatus(closings, branchName, month);
  console.log(`※ 확정 덮어쓰기 허용: ${branchName} [${status ?? "상태없음"}]`);
}

// ---------------------------------------------------------------- 미리보기
const plan = [];
for (const entry of documents) {
  const previous = await readShared(entry.dataKey);
  plan.push({ ...entry, previous });
}

console.log(`\n■ ${month} 매입매출 쓰기 (${plan.length}개 지점)\n`);
console.log(`${"지점".padEnd(16)}${"마감".padEnd(11)}${"기존행".padStart(7)}${"→새행".padStart(7)}${"기존 이체".padStart(14)}${"→새 이체".padStart(14)}${"→새 사용".padStart(14)}`);
console.log("-".repeat(83));
for (const p of plan) {
  const status = sectionStatus(closings, p.branchName, month) ?? "-";
  const before = p.previous === undefined ? "없음" : `${p.previous.length}행`;
  console.log(
    `${p.branchName.padEnd(16)}${status.padEnd(11)}${before.padStart(7)}${`${p.rows.length}행`.padStart(7)}` +
      `${sumT(p.previous).toLocaleString().padStart(14)}${sumT(p.rows).toLocaleString().padStart(14)}${sumU(p.rows).toLocaleString().padStart(14)}`
  );
}
console.log("-".repeat(83));
console.log(`${"합계".padEnd(41)}${plan.reduce((a, p) => a + sumT(p.previous), 0).toLocaleString().padStart(14)}${plan.reduce((a, p) => a + sumT(p.rows), 0).toLocaleString().padStart(14)}${plan.reduce((a, p) => a + sumU(p.rows), 0).toLocaleString().padStart(14)}`);

if (!commit) {
  console.log("\n[dry-run] 아무것도 쓰지 않았습니다. 반영하려면 --commit 을 붙이세요.");
  process.exit(0);
}

// ---------------------------------------------------------------- 백업 후 쓰기
mkdirSync(resolve(SCRIPT_DIR, "backups"), { recursive: true });
const backupPath = resolve(SCRIPT_DIR, "backups", `settle-backup-${month}-${Date.now()}.json`);
// 예비 백업은 '.pending' 으로 따로 남기고 unsafe 표식을 붙인다.
// 커밋 후 재기록 전에 프로세스가 죽으면, 미리보기 시점 값을 담은 무조건 복구형 파일이 정식 백업 자리에 남는다 —
// 그걸로 되돌리면 실제 덮어쓴 값이 아닌 옛 값으로 복구되고, 건너뛴 문서까지 되돌린다(Codex 지적).
// revert-backup.mjs 는 unsafe:true 파일을 거부한다.
const pendingBackupPath = `${backupPath}.pending`;
writeFileSync(pendingBackupPath, JSON.stringify({
  month, unsafe: true,
  note: "트랜잭션 커밋 전 예비 스냅샷 — 이 파일로는 되돌릴 수 없다(실제 덮어쓴 값이 아님).",
  entries: plan.map(({ dataKey, previous }) => ({ dataKey, previous: previous ?? null })),
}, null, 2), "utf-8");
console.log(`\n예비 백업: ${pendingBackupPath}`);

const now = new Date().toISOString();
// 미리보기 시점의 마감상태만 믿고 순차 setDoc 하면, 그 사이 지점이 마감제출해도 그대로 덮어쓴다 —
// 관리자 화면은 '확정'인데 매입매출 내용만 바뀐 상태가 된다(Codex 지적, sales-summary와 동일 패턴).
const raced = [];
await runTransaction(db, async (tx) => {
  raced.length = 0; // 트랜잭션은 재시도될 수 있다 — 지난 시도의 판정 흔적을 지운다.
  for (const p of plan) p._written = false;
  const closeSnap = await tx.get(sharedRef("monthly_closings"));
  const liveClosings = closeSnap.exists() && Array.isArray(closeSnap.data().value) ? closeSnap.data().value : [];
  const liveDocs = new Map();
  for (const p of plan) {
    const s = await tx.get(sharedRef(p.dataKey));
    liveDocs.set(p.dataKey, s.exists() ? s.data().value : undefined);
  }
  for (const p of plan) {
    const st = sectionStatus(liveClosings, p.branchName, month);
    // forced(--force-confirmed)는 이름 그대로 '확정'만 뚫는다. editing 은 지점이 지금 고치는 중이라
    // 미리보기 가드도 통과시키지 않는다 — 여기서 함께 뚫으면 옵션 이름보다 넓은 권한이 된다(Codex 지적).
    const bypass = st === "confirmed" && forced.includes(p.branchName);
    if ((st === "confirmed" || st === "editing") && !bypass) {
      raced.push({ branchName: p.branchName, why: `미리보기 이후 ${st} 로 바뀜` });
      continue;
    }
    const live = liveDocs.get(p.dataKey);
    p.previous = live === undefined ? null : live; // 실제로 덮어쓰는 직전 값
    tx.set(sharedRef(p.dataKey), { value: p.rows, updatedAt: now });
    p._written = true;
  }
});
for (const p of plan) console.log(`  ${p._written ? "쓰기 완료" : "건너뜀  "}  ${p.branchName} (${p.rows.length}행)`);
if (raced.length) {
  console.log(`\n경쟁으로 건너뜀 ${raced.length}곳`);
  raced.forEach((r) => console.log(`  - ${r.branchName}: ${r.why}`));
}
// 백업을 실제 덮어쓴 값으로 다시 쓴다. 조건부 복구(expectedAfter)로 만들어, 이 뒤 지점이 고친 문서는 되돌리지 않는다.
writeFileSync(backupPath, JSON.stringify({
  month,
  entries: plan.filter((p) => p._written).map((p) => ({
    dataKey: p.dataKey, previous: p.previous ?? null, expectedAfter: p.rows, expectedUpdatedAt: now,
  })),
}, null, 2), "utf-8");
rmSync(pendingBackupPath, { force: true }); // 정식 백업이 생겼으니 예비본은 치운다.
console.log(`백업 저장: ${backupPath}`);

// ---------------------------------------------------------------- 재조회 검증
console.log("\n■ 재조회 검증 (서버에서 다시 읽어 대조)");
let failures = 0;
const writtenPlan = plan.filter((p) => p._written);
for (const p of writtenPlan) {
  const actual = await readShared(p.dataKey);
  const ok = Array.isArray(actual) && actual.length === p.rows.length && sumT(actual) === sumT(p.rows) && sumU(actual) === sumU(p.rows);
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "실패"} ${p.branchName.padEnd(16)} ${Array.isArray(actual) ? actual.length : "?"}행  이체 ${sumT(actual).toLocaleString()} / 사용 ${sumU(actual).toLocaleString()}`);
}
// 성공 판정은 '실제로 쓴 건수' 기준. 전부 경쟁으로 밀려 0건이어도 "통과"로 찍히면 안 된다.
console.log(`\n■ 결과  쓰기 ${writtenPlan.length}건 / 경쟁 건너뜀 ${raced.length}건 / 대상이던 지점 ${plan.length}곳`);
if (failures > 0) console.log(`검증 실패 ${failures}건 — 되돌리기: node scripts/revert-backup.mjs "${backupPath}" --commit`);
else if (writtenPlan.length === 0) console.log("쓴 지점이 없습니다 — 미리보기 이후 전부 상태가 바뀌었습니다.");
else if (raced.length) console.log("일부 지점이 경쟁으로 빠졌습니다 — 위 목록을 확인하세요.");
else console.log("전체 검증 통과.");
process.exit(failures === 0 && writtenPlan.length > 0 && raced.length === 0 ? 0 : 1);
