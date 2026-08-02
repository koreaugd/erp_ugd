/**
 * 다음 달 매입매출 문서를 '이월 상태'(거래처 그대로, 금액 공란)로 미리 써 넣는다. (일회성)
 *
 * 왜 필요한가:
 *   MonthlyPurchaseSalesSubTab 의 loadPurchases 는 서버 문서가 없을 때
 *   전월 이월(159행)보다 localStorage 캐시(153행)를 먼저 읽는다.
 *   따라서 서버의 잔재 문서를 지우는 것만으로는 지점 기기에 남은 옛 행이 계속 보인다.
 *   서버에 문서가 존재하면 remoteLoaded=true 가 되어 캐시를 덮어쓰므로, 직접 써 넣어야 한다.
 *
 * 행 변환 규칙은 MonthlySettleTab 의 carryMonthlyPurchasesToNextMonth 와 동일하게 맞춘다.
 *
 *   node scripts/seed-next-month-carry.mjs <월> <다음달> <지점1> [지점2 ...]            # dry-run
 *   node scripts/seed-next-month-carry.mjs <월> <다음달> <지점1> [지점2 ...] --commit
 *
 * 되돌리기: node scripts/revert-backup.mjs <이 스크립트가 남긴 backup.json> --commit
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDocFromServer, setDoc } from "firebase/firestore";

import config from "../firebase-applet-config.json" with { type: "json" };
import { blockedTargets, reportBlocked } from "./lib/close-guard.mjs";
import { signInAsAdmin } from "./lib/admin-auth.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const commit = args.includes("--commit");
const allowEditing = args.includes("--allow-editing");
const [month, nextMonth, ...branches] = args.filter((a) => !a.startsWith("--"));
if (!month || !nextMonth || branches.length === 0) {
  console.error("사용법: node scripts/seed-next-month-carry.mjs <월> <다음달> <지점...> [--commit] [--allow-editing]");
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

// carryMonthlyPurchasesToNextMonth 와 동일: 금액 3종 비우고 '이체 필요'로 초기화.
// 폐지된 선입금 표식(isPrepaid)도 함께 끊는다 — 남겨서 넘기면 금액이 빈 새 행이 레거시 취급을 받아
// 이체금액→이달사용액 미러링이 꺼지고 export 사용액이 0으로 나간다(앱 이월 경로와 같은 규칙, Codex 8R).
const carryRow = (row) => ({
  ...row,
  id: `p_${nextMonth}_${row.id}`,
  transferAmount: "",
  isPrepaid: false,
  prepaidChargeAmount: "",
  monthlyUsageAmount: "",
  transferNeeded: true,
});

// 이미 지점이 다음 달 금액을 입력했다면 덮어쓰면 안 된다.
const hasTypedAmount = (row) =>
  [row.transferAmount, row.prepaidChargeAmount, row.monthlyUsageAmount].some((v) => String(v || "").trim() !== "");

const plan = [];
for (const branchName of branches) {
  const sourceRows = await readShared(`monthly_purchases:${branchName}:${month}`);
  if (!Array.isArray(sourceRows) || sourceRows.length === 0) {
    console.error(`중단: ${branchName} 의 ${month} 문서가 비어 있습니다.`);
    process.exit(1);
  }
  const dataKey = `monthly_purchases:${branchName}:${nextMonth}`;
  const previous = await readShared(dataKey);
  if (Array.isArray(previous) && previous.some(hasTypedAmount)) {
    console.error(`중단: ${branchName} 의 ${nextMonth} 에 이미 입력된 금액이 있습니다. 덮어쓰지 않습니다.`);
    process.exit(1);
  }
  plan.push({ branchName, dataKey, rows: sourceRows.map(carryRow), previous });
}

// 확정/수정중인 다음 달을 덮어쓰지 않는다. 금액 공란 가드만으로는 부족하다 —
// 지점이 마감을 되돌려 '수정중'인 상태의 행을 날릴 수 있기 때문이다.
const closings = (await readShared("monthly_closings")) || [];
if (reportBlocked(blockedTargets(closings, plan.map((p) => p.dataKey), { allowEditing }))) process.exit(1);

console.log(`\n■ ${nextMonth} 이월 문서 쓰기 (${plan.length}개 지점)\n`);
for (const item of plan) {
  const before = item.previous === undefined ? "문서없음" : `${item.previous.length}행`;
  console.log(`  ${item.branchName.padEnd(16)} ${before.padStart(8)} → ${item.rows.length}행 (금액 공란)`);
}

if (!commit) {
  console.log("\n[dry-run] 아무것도 쓰지 않았습니다. --commit 을 붙여 실행하세요.");
  process.exit(0);
}

mkdirSync(resolve(SCRIPT_DIR, "backups"), { recursive: true });
const backupPath = resolve(SCRIPT_DIR, "backups", `carry-backup-${nextMonth}-${Date.now()}.json`);
writeFileSync(backupPath, JSON.stringify({ month: nextMonth, entries: plan.map(({ dataKey, previous }) => ({ dataKey, previous: previous ?? null })) }, null, 2), "utf-8");
console.log(`\n백업 저장: ${backupPath}`);

const now = new Date().toISOString();
for (const item of plan) {
  await setDoc(sharedRef(item.dataKey), { value: item.rows, updatedAt: now });
  console.log(`  쓰기 완료  ${item.branchName} (${item.rows.length}행)`);
}

console.log("\n■ 재조회 검증");
let failures = 0;
for (const item of plan) {
  const actual = await readShared(item.dataKey);
  const ok =
    Array.isArray(actual) &&
    actual.length === item.rows.length &&
    actual.every((r) => r.transferAmount === "" && r.monthlyUsageAmount === "" && r.prepaidChargeAmount === "" && r.transferNeeded === true && r.isPrepaid === false) &&
    actual.every((r, i) => r.vendorName === item.rows[i].vendorName && r.category === item.rows[i].category && r.accountNumber === item.rows[i].accountNumber);
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "실패"} ${item.branchName.padEnd(16)} ${Array.isArray(actual) ? actual.length : "?"}행, 금액 전부 공란`);
}
console.log(failures === 0 ? "\n전체 검증 통과." : `\n검증 실패 ${failures}건 — 되돌리려면: node scripts/revert-backup.mjs "${backupPath}" --commit`);
process.exit(failures === 0 ? 0 : 1);
