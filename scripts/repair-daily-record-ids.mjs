/**
 * 일일마감 문서 안의 recordId 를 문서 ID와 맞춘다. (일회성 스크립트)
 *
 *   node scripts/repair-daily-record-ids.mjs            # dry-run (기본)
 *   node scripts/repair-daily-record-ids.mjs --commit   # 백업 후 반영 + 재조회 검증
 *
 * 왜 필요한가
 *   normalize-daily-doc-ids.mjs 가 문서를 새 ID로 옮기면서 **내용을 그대로 복사**했다.
 *   그 바람에 문서 안의 recordId / master.recordId / master.record_id 는 옛 UUID로 남았다.
 *   firebaseGetDailyFormBootstrap 은 `recordId || id` 순서로 돌려주므로(firebaseDirect.ts),
 *   일일마감 화면이 옛 UUID로 상세를 찾아가 "해당 마감 데이터를 찾을 수 없습니다"로 실패한다.
 *   → 그 날짜의 마감을 열지도 수정하지도 못한다. 내부 값을 문서 ID로 맞춰야 한다.
 *
 * 무엇을 바꾸나
 *   recordId · master.recordId · master.record_id, 그리고 expenses[]/staff[] 의 record_id 중
 *   **문서 ID와 다른 값만** 문서 ID로 바꾼다. 금액·날짜·작성자 등 나머지 필드는 건드리지 않는다.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, getDocsFromServer, getDocFromServer, setDoc } from "firebase/firestore";

import config from "../firebase-applet-config.json" with { type: "json" };
import { signInAsAdmin } from "./lib/admin-auth.mjs";
import { deepEqual } from "./lib/deep-equal.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const commit = process.argv.includes("--commit");

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);
await signInAsAdmin(app);

/** 문서 ID와 다른 recordId 계열 값만 문서 ID로 바꾼 사본을 만든다. 바꿀 게 없으면 null. */
function repaired(docId, data) {
  const next = JSON.parse(JSON.stringify(data ?? {}));
  const changes = [];
  const fix = (holder, key, label) => {
    if (holder && holder[key] !== undefined && String(holder[key]) !== docId) {
      changes.push(`${label}: ${holder[key]} → ${docId}`);
      holder[key] = docId;
    }
  };
  fix(next, "recordId", "recordId");
  if (next.master) {
    fix(next.master, "recordId", "master.recordId");
    fix(next.master, "record_id", "master.record_id");
  }
  for (const listKey of ["expenses", "staff"]) {
    if (!Array.isArray(next[listKey])) continue;
    next[listKey].forEach((row, index) => {
      if (!row || typeof row !== "object") return;
      fix(row, "record_id", `${listKey}[${index}].record_id`);
      fix(row, "recordId", `${listKey}[${index}].recordId`);
    });
  }
  return changes.length > 0 ? { next, changes } : null;
}

const snapshot = await getDocsFromServer(collection(db, "daily_settles"));
const plan = [];
for (const item of snapshot.docs) {
  const data = item.data() || {};
  const result = repaired(item.id, data);
  if (result) plan.push({ id: item.id, before: data, after: result.next, changes: result.changes });
}

console.log(`\n전체 ${snapshot.size}건 중 고칠 문서 ${plan.length}건\n`);
for (const entry of plan) {
  console.log(`  ${decodeURIComponent(entry.id)}`);
  for (const change of entry.changes) console.log(`      ${change}`);
}

if (!commit) {
  console.log("\n[dry-run] 아무것도 쓰지 않았습니다. 반영하려면 --commit 을 붙여 실행하세요.");
  process.exit(0);
}
if (plan.length === 0) process.exit(0);

mkdirSync(resolve(SCRIPT_DIR, "backups"), { recursive: true });
const backupPath = resolve(SCRIPT_DIR, "backups", `daily-record-ids-${Date.now()}.json`);
writeFileSync(backupPath, JSON.stringify({ entries: plan.map(({ id, before }) => ({ id, before })) }, null, 2), "utf-8");
console.log(`\n백업 저장: ${backupPath}`);

let failures = 0;
for (const entry of plan) {
  try {
    await setDoc(doc(db, "daily_settles", entry.id), entry.after);
    const check = await getDocFromServer(doc(db, "daily_settles", entry.id));
    if (!check.exists() || !deepEqual(check.data(), entry.after)) {
      console.log(`  실패 ${entry.id} — 재조회 값이 기대와 다릅니다`);
      failures++;
      continue;
    }
    console.log(`  완료 ${decodeURIComponent(entry.id)}`);
  } catch (error) {
    console.log(`  실패 ${entry.id} — ${error?.message || error}`);
    failures++;
  }
}

// ---------------------------------------------------------------- 재조회 검증
const after = await getDocsFromServer(collection(db, "daily_settles"));
const remaining = after.docs.filter((item) => repaired(item.id, item.data() || {}) !== null);
console.log(`\n■ 재조회 검증 — 전체 ${after.size}건, 아직 어긋난 문서 ${remaining.length}건`);
for (const item of remaining) console.log(`  남음: ${decodeURIComponent(item.id)}`);
console.log(failures === 0 && remaining.length === 0 ? "\n전체 반영 완료." : `\n확인 필요 — 백업: ${backupPath}`);
process.exit(failures === 0 && remaining.length === 0 ? 0 : 1);
