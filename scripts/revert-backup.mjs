/**
 * seed-*.mjs 가 남긴 백업 파일로 shared_data 문서를 원상복구한다.
 *
 *   node scripts/revert-backup.mjs <backup.json>            # dry-run (기본)
 *   node scripts/revert-backup.mjs <backup.json> --commit
 *
 * 백업 형식: { entries: [{ dataKey, previous }] }
 *   previous === null  → 당시 문서가 없었음 → 복구 시 삭제
 *   previous === [...] → 당시 값 → 복구 시 그 값으로 setDoc
 *
 * 순서 주의: 같은 dataKey 를 건드린 백업이 여러 개면 "나중 것부터" 되돌려야 한다.
 * (예: 6월 시드 백업에는 7월 잔재 문서 복원 항목이 섞여 있어, 7월 이월 백업보다 먼저 되돌리면
 *  방금 만든 7월 이월 문서가 옛 샘플 행으로 덮인다.)
 * 이 스크립트는 파일명 타임스탬프를 비교해 더 나중 백업이 같은 키를 갖고 있으면 중단한다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDocFromServer, setDoc, deleteDoc } from "firebase/firestore";

import config from "../firebase-applet-config.json" with { type: "json" };
import { blockedTargets, reportBlocked } from "./lib/close-guard.mjs";
import { signInAsAdmin } from "./lib/admin-auth.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = resolve(SCRIPT_DIR, "backups");

const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const allowEditing = argv.includes("--allow-editing");
const [backupPath] = argv.filter((a) => !a.startsWith("--"));
if (!backupPath) {
  console.error("사용법: node scripts/revert-backup.mjs <backup.json> [--commit] [--allow-editing]");
  process.exit(1);
}

const stampOf = (name) => Number(name.match(/-(\d{10,})\.json$/)?.[1] ?? 0);

const backup = JSON.parse(readFileSync(backupPath, "utf-8"));
if (!Array.isArray(backup.entries)) {
  console.error("중단: 백업 파일에 entries 배열이 없습니다.");
  process.exit(1);
}
const targetKeys = new Set(backup.entries.map((e) => e.dataKey));

// 순서 가드: 같은 키를 건드린 '더 나중' 백업이 남아 있으면 그것부터 되돌려야 한다.
const thisStamp = stampOf(basename(backupPath));
const laterConflicts = [];
for (const name of readdirSync(BACKUP_DIR)) {
  if (!name.endsWith(".json") || stampOf(name) <= thisStamp) continue;
  const other = JSON.parse(readFileSync(resolve(BACKUP_DIR, name), "utf-8"));
  const overlap = (other.entries || []).map((e) => e.dataKey).filter((k) => targetKeys.has(k));
  if (overlap.length > 0) laterConflicts.push({ name, overlap });
}
if (laterConflicts.length > 0) {
  console.error("중단: 같은 문서를 나중에 건드린 백업이 남아 있습니다. 나중 것부터 되돌리세요.\n");
  for (const c of laterConflicts) console.error(`  ${c.name}  (겹치는 문서 ${c.overlap.length}개: ${c.overlap.join(", ")})`);
  process.exit(1);
}

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);
await signInAsAdmin(app);

const sharedRef = (dataKey) => doc(db, "shared_data", encodeURIComponent(dataKey));
const readShared = async (dataKey) => {
  const snapshot = await getDocFromServer(sharedRef(dataKey));
  return snapshot.exists() ? snapshot.data().value ?? null : undefined;
};

const describe = (v) => (v === undefined ? "문서없음" : Array.isArray(v) ? `${v.length}행` : String(v));

// 복구도 파괴적이다: 그 사이에 지점이 마감을 확정했다면 되돌리는 순간 마감 자료가 사라진다.
const closings = (await readShared("monthly_closings")) || [];
if (reportBlocked(blockedTargets(closings, backup.entries.map((e) => e.dataKey), { allowEditing }))) process.exit(1);

console.log(`\n■ 복구 계획: ${basename(backupPath)} (${backup.entries.length}개 문서)\n`);
const plan = [];
for (const entry of backup.entries) {
  const current = await readShared(entry.dataKey);
  const action = entry.previous === null ? "삭제" : "값복구";
  plan.push({ ...entry, current, action });
  console.log(`  ${entry.dataKey.padEnd(46)} 현재 ${describe(current).padStart(8)} → ${action} ${entry.previous === null ? "" : `(${entry.previous.length}행)`}`);
}

if (!commit) {
  console.log("\n[dry-run] 아무것도 쓰지 않았습니다. --commit 을 붙여 실행하세요.");
  process.exit(0);
}

const now = new Date().toISOString();
for (const item of plan) {
  if (item.previous === null) await deleteDoc(sharedRef(item.dataKey));
  else await setDoc(sharedRef(item.dataKey), { value: item.previous, updatedAt: now });
  console.log(`  ${item.action} 완료  ${item.dataKey}`);
}

console.log("\n■ 재조회 검증");
let failures = 0;
for (const item of plan) {
  const actual = await readShared(item.dataKey);
  const ok = item.previous === null ? actual === undefined : Array.isArray(actual) && actual.length === item.previous.length;
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "실패"} ${item.dataKey.padEnd(46)} ${describe(actual)}`);
}
console.log(failures === 0 ? "\n복구 완료, 전체 검증 통과." : `\n검증 실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
