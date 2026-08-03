/**
 * 파트타이머 급여대장 시드 JSON → Firestore shared_data 쓰기.
 *
 *   node scripts/apply-parttime-salary-seed.mjs <seed.json>            # dry-run (기본)
 *   node scripts/apply-parttime-salary-seed.mjs <seed.json> --commit
 *
 * 급여 키라서 개인 관리자 계정이 필요하다(UGD_PERSONAL_ADMIN_EMAIL / _PASSWORD).
 * 되돌리기: node scripts/revert-backup.mjs <backup.json> --commit
 *
 * 안전장치
 *   - 급여대장은 마감 상태 가드(close-guard)가 매입매출 키만 보므로, 여기서는 salary 섹션 상태를 직접 확인해
 *     확정/수정중인 지점을 기본으로 막는다(--allow-confirmed 로만 강행).
 *   - 쓰기 전 기존 값을 backups/ 에 스냅샷.
 *   - 쓰기 후 서버에서 다시 읽어 행수·급여합계를 대조.
 */
import { writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDocFromServer, runTransaction } from "firebase/firestore";

import config from "../firebase-applet-config.json" with { type: "json" };
import { signInAsPersonalAdmin } from "./lib/admin-auth.mjs";
import { sectionStatus } from "./lib/close-guard.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const allowConfirmed = argv.includes("--allow-confirmed");
const [inputPath] = argv.filter((a) => !a.startsWith("--"));
if (!inputPath) {
  console.error("사용법: node scripts/apply-parttime-salary-seed.mjs <seed.json> [--commit] [--allow-confirmed]");
  process.exit(1);
}

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);
await signInAsPersonalAdmin(app);

const sharedRef = (k) => doc(db, "shared_data", encodeURIComponent(k));
const readShared = async (k) => {
  const s = await getDocFromServer(sharedRef(k));
  return s.exists() ? s.data().value ?? undefined : undefined;
};
const num = (v) => Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0;
const sumPay = (rows) => (Array.isArray(rows) ? rows.reduce((a, r) => a + num(r?.calculatedSalary), 0) : 0);

const seed = JSON.parse(readFileSync(inputPath, "utf-8"));
const { month, documents } = seed;
const closings = (await readShared("monthly_closings")) || [];

// ---------------------------------------------------------------- 마감 상태 확인
// 두 섹션을 모두 본다. 하나라도 확정/수정중이면 덮어쓰지 않는다.
//   partTimeSalary — 파트타이머 급여대장 자체의 마감 섹션(2026-08-02 신설). 이게 1차 관문이다.
//     예전엔 이 섹션이 없어서 purchase만 봤는데, 지금은 partTimeSalary만 확정되고 purchase는 미제출인
//     상태가 정상적으로 존재한다 — purchase만 보면 그 지점이 제출을 마친 급여를 그대로 덮어쓴다.
//   purchase      — 월말마감 엑셀이 파트타이머급여를 5시트 중 하나로 내보내므로, 확정됐다면
//     이미 배포된 엑셀 내용이 달라진다.
const GATE_SECTIONS = ["partTimeSalary", "purchase"];
const blocked = [];
for (const d of documents) {
  for (const section of GATE_SECTIONS) {
    const st = sectionStatus(closings, d.branchName, month, section);
    if ((st === "confirmed" || st === "editing") && !allowConfirmed) {
      blocked.push({ branchName: d.branchName, section, status: st });
    }
  }
}
if (blocked.length) {
  console.error(`\n중단: 마감이 확정된 지점·섹션이 ${blocked.length}건 있습니다.\n`);
  for (const b of blocked) {
    const why = b.section === "partTimeSalary"
      ? "지점이 파트타이머 급여대장을 마감제출한 상태입니다 — 덮어쓰면 제출한 값이 바뀝니다."
      : "파트타이머는 월말마감 엑셀 5시트 중 하나라 다운로드 내용이 바뀝니다.";
    console.error(`  ${b.branchName}  [${b.section}: ${b.status}]  — ${why} 강행하려면 --allow-confirmed`);
  }
  process.exit(1);
}

// ---------------------------------------------------------------- 미리보기
const plan = [];
for (const d of documents) plan.push({ ...d, previous: await readShared(d.dataKey) });

console.log(`\n■ ${month} 파트타이머 급여대장 쓰기 (${plan.length}개 지점)\n`);
console.log(`${"지점".padEnd(16)}${"월말마감".padEnd(10)}${"기존행".padStart(7)}${"→새행".padStart(7)}${"기존 급여".padStart(14)}${"→새 급여".padStart(14)}`);
console.log("-".repeat(68));
for (const p of plan) {
  const st = sectionStatus(closings, p.branchName, month, "purchase") ?? "-";
  const before = p.previous === undefined ? "없음" : `${p.previous.length}행`;
  console.log(
    `${p.branchName.padEnd(16)}${st.padEnd(10)}${before.padStart(7)}${`${p.rows.length}행`.padStart(7)}` +
      `${sumPay(p.previous).toLocaleString().padStart(14)}${sumPay(p.rows).toLocaleString().padStart(14)}`
  );
}
console.log("-".repeat(68));
console.log(`${"합계".padEnd(40)}${plan.reduce((a, p) => a + sumPay(p.previous), 0).toLocaleString().padStart(14)}${plan.reduce((a, p) => a + sumPay(p.rows), 0).toLocaleString().padStart(14)}`);

if (!commit) {
  console.log("\n[dry-run] 아무것도 쓰지 않았습니다. 반영하려면 --commit 을 붙이세요.");
  process.exit(0);
}

// ---------------------------------------------------------------- 백업 후 쓰기
mkdirSync(resolve(SCRIPT_DIR, "backups"), { recursive: true });
const backupPath = resolve(SCRIPT_DIR, "backups", `parttime-backup-${month}-${Date.now()}.json`);
// 예비 백업은 '.pending' 으로 따로 남기고 unsafe 표식을 붙인다.
// 커밋 후 재기록 전에 죽으면 미리보기 시점 값의 무조건 복구형 파일이 정식 백업 자리에 남고,
// 그걸로 되돌리면 급여를 엉뚱한 시점 값으로 복구하거나 이후 수정분을 지운다(Codex 지적).
const pendingBackupPath = `${backupPath}.pending`;
writeFileSync(pendingBackupPath, JSON.stringify({
  month, unsafe: true,
  note: "트랜잭션 커밋 전 예비 스냅샷 — 이 파일로는 되돌릴 수 없다(실제 덮어쓴 값이 아님).",
  entries: plan.map(({ dataKey, previous }) => ({ dataKey, previous: previous ?? null })),
}, null, 2), "utf-8");
console.log(`\n예비 백업: ${pendingBackupPath}`);

const now = new Date().toISOString();
// 미리보기 시점의 마감상태만 믿고 순차 setDoc 하면, 그 사이 지점이 마감제출해도 그대로 덮어쓴다 —
// 관리자 화면은 '확정'인데 급여 내용만 바뀐 상태가 된다. 백업의 '이전 값'도 실제 덮어쓴 값이 아니게 된다.
// 트랜잭션 안에서 마감상태와 현재 문서를 다시 읽고, 어긋난 지점만 건너뛴다(Codex 지적, sales-summary와 동일 패턴).
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
    const hit = GATE_SECTIONS
      .map((section) => ({ section, st: sectionStatus(liveClosings, p.branchName, month, section) }))
      .find(({ st }) => st === "confirmed" || st === "editing");
    if (hit && !allowConfirmed) {
      raced.push({ branchName: p.branchName, why: `미리보기 이후 ${hit.section}=${hit.st} 로 바뀜` });
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
console.log("\n■ 재조회 검증");
let failures = 0;
const writtenPlan = plan.filter((p) => p._written);
for (const p of writtenPlan) {
  const actual = await readShared(p.dataKey);
  const ok = Array.isArray(actual) && actual.length === p.rows.length && sumPay(actual) === sumPay(p.rows);
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "실패"} ${p.branchName.padEnd(16)} ${Array.isArray(actual) ? actual.length : "?"}행  급여 ${sumPay(actual).toLocaleString()}`);
}
// 성공 판정은 '실제로 쓴 건수' 기준. 전부 경쟁으로 밀려 0건이어도 "통과"로 찍히면 안 된다.
console.log(`\n■ 결과  쓰기 ${writtenPlan.length}건 / 경쟁 건너뜀 ${raced.length}건 / 대상이던 지점 ${plan.length}곳`);
if (failures > 0) console.log(`검증 실패 ${failures}건 — 되돌리기: node scripts/revert-backup.mjs "${backupPath}" --commit`);
else if (writtenPlan.length === 0) console.log("쓴 지점이 없습니다 — 미리보기 이후 전부 상태가 바뀌었습니다.");
else if (raced.length) console.log("일부 지점이 경쟁으로 빠졌습니다 — 위 목록을 확인하세요.");
else console.log("전체 검증 통과.");
process.exit(failures === 0 && writtenPlan.length > 0 && raced.length === 0 ? 0 : 1);
