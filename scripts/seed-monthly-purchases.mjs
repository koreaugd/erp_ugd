/**
 * 거래처 시드 JSON → Firestore shared_data 쓰기 (일회성 스크립트).
 *
 *   node scripts/seed-monthly-purchases.mjs <seed.json>            # dry-run (기본, 아무것도 안 씀)
 *   node scripts/seed-monthly-purchases.mjs <seed.json> --commit   # 실제 쓰기 + 백업 + 재조회 검증
 *
 * 되돌리기는 scripts/revert-backup.mjs 하나로 통일한다(백업 간 순서 가드가 거기에만 있다).
 *
 * 쓰기 대상
 *   1) monthly_purchases:{지점}:{월}          ← 엑셀 거래처 행 (setDoc, 덮어쓰기)
 *   2) monthly_purchases:{지점}:{다음달}       ← 이월을 막는 잔재 문서 삭제 (deleteDoc)
 *
 * 안전장치
 *   - 건드릴 문서(이번 달 쓰기 + 다음 달 삭제) 중 확정/수정중인 달이 하나라도 있으면 전체 중단
 *   - 쓰기 전 기존 값 전체를 scripts/backups/ 에 스냅샷 (revert-backup.mjs 로 복구)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDocFromServer, setDoc, deleteDoc } from "firebase/firestore";

import config from "../firebase-applet-config.json" with { type: "json" };
import { blockedTargets, reportBlocked } from "./lib/close-guard.mjs";
import { signInAsAdmin } from "./lib/admin-auth.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
if (argv.includes("--revert")) {
  console.error("되돌리기는 여기서 하지 않습니다: node scripts/revert-backup.mjs <backup.json> [--commit]");
  process.exit(1);
}
const commit = argv.includes("--commit");
const allowEditing = argv.includes("--allow-editing");
const [inputPath] = argv.filter((a) => !a.startsWith("--"));
if (!inputPath) {
  console.error("사용법: node scripts/seed-monthly-purchases.mjs <seed.json> [--commit] [--allow-editing]");
  process.exit(1);
}
const mode = commit ? "commit" : "dry-run";

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);
await signInAsAdmin(app);

const sharedRef = (dataKey) => doc(db, "shared_data", encodeURIComponent(dataKey));

async function readShared(dataKey) {
  const snapshot = await getDocFromServer(sharedRef(dataKey));
  return snapshot.exists() ? snapshot.data().value ?? null : undefined; // undefined = 문서 없음
}

const sumRows = (rows) => (Array.isArray(rows) ? rows.reduce((acc, r) => acc + (Number(r.transferAmount) || 0), 0) : 0);
const nextMonthOf = (month) => {
  const [year, mon] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, mon, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

const seed = JSON.parse(readFileSync(inputPath, "utf-8"));
const { month, documents } = seed;
const nextMonth = nextMonthOf(month);

// ---------------------------------------------------------------- 현황 조사
const plan = [];
for (const entry of documents) {
  const existing = await readShared(entry.dataKey);
  plan.push({ action: "write", dataKey: entry.dataKey, branchName: entry.branchName, rows: entry.rows, total: entry.total, previous: existing });
}
for (const entry of documents) {
  const dataKey = `monthly_purchases:${entry.branchName}:${nextMonth}`;
  const existing = await readShared(dataKey);
  if (existing !== undefined) {
    plan.push({ action: "delete", dataKey, branchName: entry.branchName, previous: existing });
  }
}

// ---------------------------------------------------------------- 안전장치: 실제로 건드릴 문서 전부를 검사
// 이번 달 쓰기뿐 아니라 '다음 달 삭제' 대상도 포함해야 한다 — 확정된 다음 달을 지우면 마감 자료가 사라진다.
const closings = (await readShared("monthly_closings")) || [];
if (reportBlocked(blockedTargets(closings, plan.map((p) => p.dataKey), { allowEditing }))) process.exit(1);

// ---------------------------------------------------------------- 미리보기 출력
console.log(`\n■ ${month} 매입매출 쓰기 (${documents.length}개 지점)\n`);
console.log(`${"지점".padEnd(16)} ${"기존".padStart(10)}  ${"→ 새로".padStart(10)} ${"합계".padStart(14)}`);
console.log("-".repeat(56));
for (const item of plan.filter((p) => p.action === "write")) {
  const before = item.previous === undefined ? "문서없음" : `${item.previous.length}행`;
  console.log(`${item.branchName.padEnd(16)} ${before.padStart(10)}  ${`${item.rows.length}행`.padStart(10)} ${item.total.toLocaleString().padStart(14)}`);
}
const deletions = plan.filter((p) => p.action === "delete");
console.log(`\n■ ${nextMonth} 잔재 문서 삭제 (${deletions.length}개)\n`);
for (const item of deletions) {
  console.log(`  ${item.branchName.padEnd(16)} ${Array.isArray(item.previous) ? `${item.previous.length}행` : "빈값"} → 삭제`);
}
console.log(
  `\n합계: ${plan.filter((p) => p.action === "write").reduce((a, p) => a + p.rows.length, 0)}행 / ` +
    `${plan.filter((p) => p.action === "write").reduce((a, p) => a + p.total, 0).toLocaleString()}원`
);

if (mode === "dry-run") {
  console.log("\n[dry-run] 아무것도 쓰지 않았습니다. 실제로 반영하려면 --commit 을 붙여 실행하세요.");
  process.exit(0);
}

// ---------------------------------------------------------------- 백업 후 쓰기
mkdirSync(resolve(SCRIPT_DIR, "backups"), { recursive: true });
const backupPath = resolve(SCRIPT_DIR, "backups", `seed-backup-${month}-${Date.now()}.json`);
writeFileSync(backupPath, JSON.stringify({ month, entries: plan.map(({ dataKey, previous }) => ({ dataKey, previous: previous ?? null })) }, null, 2), "utf-8");
console.log(`\n백업 저장: ${backupPath}`);

const now = new Date().toISOString();
for (const item of plan) {
  if (item.action === "write") {
    await setDoc(sharedRef(item.dataKey), { value: item.rows, updatedAt: now });
    console.log(`  쓰기 완료  ${item.branchName} (${item.rows.length}행)`);
  } else {
    await deleteDoc(sharedRef(item.dataKey));
    console.log(`  삭제 완료  ${item.dataKey}`);
  }
}

// ---------------------------------------------------------------- 재조회 검증
console.log("\n■ 재조회 검증");
let failures = 0;
for (const item of plan) {
  const actual = await readShared(item.dataKey);
  if (item.action === "write") {
    const ok = Array.isArray(actual) && actual.length === item.rows.length && sumRows(actual) === item.total;
    if (!ok) failures++;
    console.log(`  ${ok ? "OK  " : "실패"} ${item.branchName.padEnd(16)} ${Array.isArray(actual) ? actual.length : "?"}행 / ${sumRows(actual).toLocaleString()}원`);
  } else {
    const ok = actual === undefined;
    if (!ok) failures++;
    console.log(`  ${ok ? "OK  " : "실패"} ${item.dataKey} 삭제됨`);
  }
}
console.log(failures === 0 ? "\n전체 검증 통과." : `\n검증 실패 ${failures}건 — 되돌리려면: node scripts/revert-backup.mjs "${backupPath}" --commit`);
process.exit(failures === 0 ? 0 : 1);
