/**
 * 월말마감(매입매출, purchase) 섹션 마감제출 일괄 확정.
 *
 *   node scripts/confirm-purchase-close.mjs 2026-07                 # dry-run (기본)
 *   node scripts/confirm-purchase-close.mjs 2026-07 --commit        # 실제 확정
 *   node scripts/confirm-purchase-close.mjs 2026-07 --branch 남산광어 --commit
 *
 * 되돌리기: node scripts/revert-backup.mjs <backup.json> --commit
 *
 * confirm-fulltime-salary-close.mjs 의 매입매출판. 판정 규칙만 다르고 구조는 같다.
 * 지점 화면의 '마감제출'(MonthlySettleTab handleConfirm → saveSectionClose)과 같은 결과를 만든다.
 *   - 확정 전, export(매입매출 대장)에 0 초과 금액으로 나가는 행이 실제로 있는지 검사
 *     (flushMonthlyPurchasesForClose 의 hasMeaningful = purchaseRowHasExportableAmount 와 같은 규칙)
 *   - monthly_closings 에 status:"confirmed" 레코드를 남긴다(writer=지점명 — 지점 화면과 같은 모양)
 *
 * 트랜잭션으로 묶는 이유는 급여판과 같다: monthly_closings 는 전 지점이 공유하는 문서 한 개라
 * 따로 저장하면 서로의 레코드를 덮어쓴다.
 */
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, getDocFromServer, getDocsFromServer, runTransaction } from "firebase/firestore";

import config from "../firebase-applet-config.json" with { type: "json" };
import { signInAsAdmin } from "./lib/admin-auth.mjs";
import { sectionStatus } from "./lib/close-guard.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SECTION = "purchase";
const CLOSINGS_KEY = "monthly_closings";

const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
// '수정중'(editing)인 지점까지 확정한다. 기본은 건너뛴다 — 지점이 남겨야 할 '수정 사유'를 건너뛰기 때문이다.
// 본사가 그 지점 데이터를 직접 확인하고 대신 확정할 때만 쓴다(확정후수정 표식·이력은 그대로 이어받는다).
const allowEditing = argv.includes("--allow-editing");
const onlyBranch = (() => { const i = argv.indexOf("--branch"); return i === -1 ? null : argv[i + 1]; })();
const MONTH = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--branch")[0];
if (!/^\d{4}-\d{2}$/.test(String(MONTH))) {
  console.error("사용법: node scripts/confirm-purchase-close.mjs <YYYY-MM> [--commit] [--branch 지점명]");
  process.exit(1);
}

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);
await signInAsAdmin(app);

const sharedRef = (dataKey) => doc(db, "shared_data", encodeURIComponent(dataKey));
const purchaseKey = (b) => `monthly_purchases:${b}:${MONTH}`;

// ---- monthlyCloseWorkbook.ts 의 export 규칙 그대로 (확정 게이트와 관리자 다운로드 게이트가 쓰는 판정)
const num = (v) => Number(String(v ?? "").replace(/[^\d]/g, "")) || 0;
const transferExport = (r) => (r?.transferNeeded === false ? 0 : num(r?.transferAmount));
const usageExport = (r) => {
  // 선입금 개념은 폐지됐다(2026-08-02). 옛 선입금 행만 옛 규칙 그대로 사용액을 내보낸다
  // (monthlyCloseWorkbook.ts purchaseUsageExportValue와 동일 — 여기가 어긋나면 스크립트가 확정한 달과
  //  관리자 엑셀 내용이 달라진다).
  if (r?.isPrepaid === true) return num(r?.monthlyUsageAmount);
  if (r?.transferNeeded !== false) return "";
  return String(r?.monthlyUsageAmount ?? "").trim() === "" ? num(r?.transferAmount) : num(r?.monthlyUsageAmount);
};
const rowHasExportableAmount = (r) => {
  if (String(r?.vendorName || "").trim() === "") return false;
  const u = usageExport(r);
  return transferExport(r) + (u === "" ? 0 : u) > 0;
};
const hasMeaningful = (rows) => Array.isArray(rows) && rows.some(rowHasExportableAmount);
const sumT = (rows) => (Array.isArray(rows) ? rows.reduce((a, r) => a + transferExport(r), 0) : 0);

// ---------------------------------------------------------------- 대상 추리기
const branchSnap = await getDocsFromServer(collection(db, "public_branches"));
const allBranches = branchSnap.docs.map((d) => d.data()).filter((b) => b?.branchName && b.isActive !== false).map((b) => b.branchName).sort();
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
  const snap = await getDocFromServer(sharedRef(purchaseKey(branchName)));
  const rows = snap.exists() ? snap.data().value : undefined;
  const status = sectionStatus(closings, branchName, MONTH, SECTION);

  if (!hasMeaningful(rows)) { skips.push({ branchName, why: "매입매출 데이터 없음(대장에 나갈 금액이 있는 행이 없음)" }); continue; }
  if (status === "confirmed") { skips.push({ branchName, why: "이미 확정됨" }); continue; }
  // '수정중'은 지점이 확정본을 열어 고치는 중이다. 여기서 확정하면 지점이 입력해야 할 '수정 사유'를 건너뛰게 되고,
  // 앱의 재확정 게이트(serverReconfirm && !reason → 거부)와도 어긋난다. 사람이 판단하도록 남긴다.
  if (status === "editing" && !allowEditing) { skips.push({ branchName, why: "지점이 마감수정 중 — 지점이 사유와 함께 직접 제출해야 함 (강행하려면 --allow-editing)" }); continue; }
  targets.push({ branchName, rowCount: rows.length, total: sumT(rows), status: status || "기록없음" });
}

console.log(`\n■ 월말마감(매입매출) ${MONTH} 마감제출 (${commit ? "COMMIT" : "DRY-RUN"})\n`);
console.log(`${"지점".padEnd(20)}${"행".padStart(5)}${"이체합계".padStart(15)}   현재상태`);
targets.forEach((t) => console.log(`${t.branchName.padEnd(20)}${String(t.rowCount).padStart(5)}${t.total.toLocaleString().padStart(15)}   ${t.status}`));
console.log(`\n확정 대상 ${targets.length}곳 / 합계 ${targets.reduce((a, t) => a + t.total, 0).toLocaleString()}원`);
if (skips.length) {
  console.log(`\n건너뜀 ${skips.length}곳`);
  skips.forEach((s) => console.log(`  - ${s.branchName}: ${s.why}`));
}
if (targets.length === 0) {
  // --commit 으로 불렀는데 한 곳도 확정하지 못했다면 실패로 끝낸다. 종료코드만 보는 자동화는
  // '전부 이미 확정됨'과 '게이트에 걸려 하나도 자격이 없음'을 구분할 수 없다 — 위 건너뜀 목록을 읽게 해야 한다.
  // dry-run 은 정보 조회이므로 0 으로 끝낸다.
  console.log(`\n확정할 지점이 없습니다.${commit ? " (--commit 이었으나 쓴 것이 없어 실패로 끝냅니다 — 위 건너뜀 사유를 확인하세요)" : ""}`);
  process.exit(commit ? 1 : 0);
}
if (!commit) { console.log("\ndry-run 입니다. 아무것도 쓰지 않았습니다. 실제로 확정하려면 --commit 을 붙이세요."); process.exit(0); }

// ---------------------------------------------------------------- 백업 후 확정
mkdirSync(resolve(SCRIPT_DIR, "backups"), { recursive: true });
const backupPath = resolve(SCRIPT_DIR, "backups", `purchase-close-backup-${MONTH}-${Date.now()}.json`);
// monthly_closings 는 전 지점·전 섹션이 한 배열에 든 공유 문서다. 무조건 복구형 백업을 남기면,
// 이 스크립트 실행 뒤 다른 지점이 제출한 마감기록까지 옛 배열로 되돌려 지운다(Codex 지적).
// 예비본은 '.pending' 에 unsafe 표식과 함께 두고, 커밋 뒤 조건부 복구형 정식 백업을 쓴다.
const pendingBackupPath = `${backupPath}.pending`;
writeFileSync(pendingBackupPath, JSON.stringify({
  month: MONTH, unsafe: true,
  note: "트랜잭션 커밋 전 예비 스냅샷 — 이 파일로는 되돌릴 수 없다(실제 덮어쓴 값이 아님).",
  entries: [{ dataKey: CLOSINGS_KEY, previous: closingsSnap.exists() ? closingsSnap.data().value ?? null : null }],
}, null, 2), "utf-8");
console.log(`\n예비 백업: ${pendingBackupPath}`);

const now = new Date().toISOString();
// 트랜잭션이 실제로 읽은 직전 값과 실제로 쓴 값 — 정식 백업은 이 값으로 만든다.
let livePreimage = null;
let finalList = null;
const applied = [];
const aborted = [];

await runTransaction(db, async (tx) => {
  applied.length = 0; aborted.length = 0; // 트랜잭션은 재시도될 수 있다 — 매번 처음부터 다시 판정한다.

  const closeSnap = await tx.get(sharedRef(CLOSINGS_KEY));
  const liveRows = new Map();
  for (const t of targets) {
    const s = await tx.get(sharedRef(purchaseKey(t.branchName)));
    liveRows.set(t.branchName, s.exists() ? s.data().value : undefined);
  }

  let list = closeSnap.exists() && Array.isArray(closeSnap.data().value) ? [...closeSnap.data().value] : [];
  // 트랜잭션이 실제로 읽은 직전 값(= 되돌릴 대상). 미리보기 시점 값과 다를 수 있다.
  livePreimage = closeSnap.exists() ? closeSnap.data().value ?? null : null;

  for (const t of targets) {
    const branchName = t.branchName;
    // 계획을 세운 뒤 지점이 데이터를 비웠거나 이미 확정/수정중으로 바꿨을 수 있다 — 여기서 다시 판정한다.
    if (!hasMeaningful(liveRows.get(branchName))) { aborted.push({ branchName, why: "확정 직전 매입매출 데이터가 비어 있음" }); continue; }
    const liveStatus = sectionStatus(list, branchName, MONTH, SECTION);
    if (liveStatus === "confirmed") { aborted.push({ branchName, why: "그 사이 지점이 확정함" }); continue; }
    if (liveStatus === "editing" && !allowEditing) { aborted.push({ branchName, why: "그 사이 지점이 마감수정으로 열었음" }); continue; }

    const matches = (r) => r.branchName === branchName && r.month === MONTH && (r.section || "purchase") === SECTION;
    const prev = list.filter(matches)
      .sort((a, b) => String(b.updatedAt || b.confirmedAt || "").localeCompare(String(a.updatedAt || a.confirmedAt || "")))[0];
    // 표식·이력은 '확정 계보(confirmed↔editing)' 안에서만 이어받는다 — 지점 화면 saveSectionClose 와 같은 규칙.
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
  finalList = list.map((r) => ({ ...r }));
  tx.set(sharedRef(CLOSINGS_KEY), { value: list, updatedAt: now });
});

// 정식 백업 — 실제로 덮어쓴 값 기준의 조건부 복구형. 이걸 쓴 뒤에야 예비본을 치운다.
writeFileSync(backupPath, JSON.stringify({
  month: MONTH,
  entries: [{ dataKey: CLOSINGS_KEY, previous: livePreimage, expectedAfter: finalList, expectedUpdatedAt: now }],
}, null, 2), "utf-8");
rmSync(pendingBackupPath, { force: true });
console.log(`백업 저장: ${backupPath}`);

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
// 성공 판정에 aborted 를 넣는다. 일부만 확정하고도 "통과"로 끝나면, 자동화나 사람이 그 달 마감을
// 다 된 것으로 여긴다 — 시더들과 같은 게이트를 쓴다(Codex 지적).
console.log(`\n■ 결과  확정 ${applied.length}건 / 확정 직전 제외 ${aborted.length}건 / 대상이던 지점 ${targets.length}곳`);
if (failures > 0) console.log(`검증 실패 ${failures}건 — 되돌리려면: node scripts/revert-backup.mjs "${backupPath}" --commit`);
else if (applied.length === 0) console.log("확정된 지점이 없습니다 — 미리보기 이후 전부 상태가 바뀌었습니다.");
else if (aborted.length) console.log("일부 지점이 제외됐습니다 — 위 목록을 확인하고 필요하면 다시 실행하세요.");
else console.log("전체 검증 통과.");
process.exit(failures === 0 && applied.length > 0 && aborted.length === 0 ? 0 : 1);
