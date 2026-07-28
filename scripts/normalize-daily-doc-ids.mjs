/**
 * 일일마감 문서 ID를 현행 규칙(`encodeURIComponent(지점)--YYYY-MM-DD`)으로 정리한다. (일회성 스크립트)
 *
 *   node scripts/normalize-daily-doc-ids.mjs            # dry-run (기본, 아무것도 안 씀)
 *   node scripts/normalize-daily-doc-ids.mjs --commit   # 백업 후 이동 + 재조회 검증
 *
 * 왜 필요한가
 *   규칙이 생기기 전에 만들어진 문서는 ID가 무작위 UUID다. 그런 문서는 "지점+날짜로 콕 집어 읽기"로
 *   찾을 수 없어, 대시보드가 그날을 '미제출'로 잘못 보여준다(마감한 날을 안 했다고 보여주는 셈).
 *   ID를 정리해 두면 그 빠른 조회를 안전하게 쓸 수 있다.
 *
 * 무엇을 하나
 *   ID가 규칙에서 벗어난 문서만 대상으로 삼는다.
 *   - master.branchName / master.settleDate 가 둘 다 있으면 → 규칙 ID로 복사한 뒤 옛 문서 삭제.
 *   - 둘 중 하나라도 없으면(빈 문서) → **건드리지 않는다.** 무엇인지 모르는 문서를 지우지 않는다.
 *   - 규칙 ID 자리에 이미 다른 문서가 있으면 → 값이 같을 때만 옛 문서를 지우고, 다르면 건너뛰고 보고한다.
 *
 * 안전장치
 *   - 쓰기 전 대상 문서 전체를 scripts/backups/ 에 스냅샷(되돌리기용 원본 그대로).
 *   - 옮긴 뒤 재조회로 새 ID 문서가 실제로 존재하는지 확인한 뒤에만 옛 문서를 지운다.
 *   - 확정/수정중 여부와 무관하다 — ID만 바꾸고 내용은 한 글자도 바꾸지 않는다.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, getDocsFromServer, getDocFromServer, setDoc, deleteDoc } from "firebase/firestore";

import config from "../firebase-applet-config.json" with { type: "json" };
import { signInAsAdmin } from "./lib/admin-auth.mjs";
import { deepEqual } from "./lib/deep-equal.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const commit = process.argv.includes("--commit");

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);
await signInAsAdmin(app);

// 규칙 판정은 반드시 '실제 규칙'으로 한다.
// 정규식(`.+--YYYY-MM-DD`)으로 보면 인코딩하지 않은 ID(`대물섬 한남점--2026-06-23`)가 정상으로 통과하는데,
// 화면은 인코딩본(`%EB%8C%80...--2026-06-23`)으로만 찾으므로 그 문서는 '미제출'로 보인다(Codex 지적 2026-07-28).
const targetId = (branchName, settleDate) => `${encodeURIComponent(branchName)}--${settleDate}`;
const isCanonical = (item) => {
  const master = item.data()?.master || {};
  const branchName = String(master.branchName || master.branch_name || "").trim();
  const settleDate = String(master.settleDate || master.settle_date || "").trim();
  // 지점명·날짜를 모르면 규칙 ID를 만들 수 없다 → 규칙 밖으로 보고 사람이 확인하게 남긴다.
  if (!branchName || !settleDate) return false;
  return item.id === targetId(branchName, settleDate);
};

const snapshot = await getDocsFromServer(collection(db, "daily_settles"));
const strays = snapshot.docs.filter((item) => !isCanonical(item));

console.log(`\n전체 ${snapshot.size}건 중 ID 규칙에서 벗어난 문서 ${strays.length}건\n`);

const plan = [];
for (const item of strays) {
  const data = item.data();
  const master = data?.master || {};
  const branchName = String(master.branchName || master.branch_name || "").trim();
  const settleDate = String(master.settleDate || master.settle_date || "").trim();

  if (!branchName || !settleDate) {
    plan.push({ id: item.id, action: "건너뜀", reason: "지점명 또는 날짜가 비어 있음(내용을 알 수 없는 문서)", data });
    continue;
  }
  const next = targetId(branchName, settleDate);
  const existing = await getDocFromServer(doc(db, "daily_settles", next));
  if (existing.exists()) {
    const same = deepEqual(existing.data(), data);
    plan.push({
      id: item.id, next, branchName, settleDate, data,
      action: same ? "옛문서 삭제" : "건너뜀",
      reason: same ? "규칙 ID에 같은 내용이 이미 있음(중복)" : "규칙 ID에 다른 내용이 이미 있음 — 사람이 확인 필요"
    });
    continue;
  }
  plan.push({ id: item.id, next, branchName, settleDate, data, action: "이동", reason: "" });
}

for (const entry of plan) {
  const where = entry.branchName ? `${entry.branchName} ${entry.settleDate}` : "(내용 없음)";
  console.log(`  [${entry.action}] ${entry.id}`);
  console.log(`      ${where}${entry.next ? ` → ${decodeURIComponent(entry.next)}` : ""}`);
  if (entry.reason) console.log(`      사유: ${entry.reason}`);
}

const moves = plan.filter((entry) => entry.action === "이동");
const drops = plan.filter((entry) => entry.action === "옛문서 삭제");
console.log(`\n이동 ${moves.length}건 / 중복삭제 ${drops.length}건 / 건너뜀 ${plan.length - moves.length - drops.length}건`);

if (!commit) {
  console.log("\n[dry-run] 아무것도 쓰지 않았습니다. 반영하려면 --commit 을 붙여 실행하세요.");
  process.exit(0);
}

mkdirSync(resolve(SCRIPT_DIR, "backups"), { recursive: true });
const backupPath = resolve(SCRIPT_DIR, "backups", `daily-doc-ids-${Date.now()}.json`);
writeFileSync(backupPath, JSON.stringify({ entries: plan.map(({ id, next, action, data }) => ({ id, next, action, data })) }, null, 2), "utf-8");
console.log(`\n백업 저장: ${backupPath}`);

let failures = 0;
for (const entry of [...moves, ...drops]) {
  try {
    if (entry.action === "이동") {
      await setDoc(doc(db, "daily_settles", entry.next), entry.data);
      // 새 문서가 실제로 있는지 확인한 뒤에만 옛 문서를 지운다 — 확인 전에 지우면 기록이 사라진다.
      const check = await getDocFromServer(doc(db, "daily_settles", entry.next));
      if (!check.exists() || !deepEqual(check.data(), entry.data)) {
        console.log(`  실패 ${entry.id} — 새 문서 확인 실패, 옛 문서를 그대로 둡니다`);
        failures++;
        continue;
      }
    }
    await deleteDoc(doc(db, "daily_settles", entry.id));
    console.log(`  완료 ${entry.action} ${entry.id}${entry.next ? ` → ${decodeURIComponent(entry.next)}` : ""}`);
  } catch (error) {
    console.log(`  실패 ${entry.id} — ${error?.message || error}`);
    failures++;
  }
}

// ---------------------------------------------------------------- 재조회 검증
const after = await getDocsFromServer(collection(db, "daily_settles"));
const remaining = after.docs.filter((item) => !isCanonical(item));
console.log(`\n■ 재조회 검증 — 전체 ${after.size}건, 규칙 밖 ${remaining.length}건`);
for (const item of remaining) {
  const master = item.data()?.master || {};
  console.log(`  남음: ${item.id} (${master.branchName || "내용 없음"} ${master.settleDate || ""})`);
}
console.log(failures === 0 ? "\n전체 반영 완료." : `\n실패 ${failures}건 — 백업: ${backupPath}`);
process.exit(failures === 0 ? 0 : 1);
