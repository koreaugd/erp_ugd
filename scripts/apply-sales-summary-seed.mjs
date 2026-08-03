/**
 * 02 AGENT_포스매출연동 산출물(YYMM_포스매출.xlsx)을 매출집계(monthly_sales_summary)에 기입한다.
 *
 *   node scripts/apply-sales-summary-seed.mjs <seed.json> [--commit] [--allow-confirmed]
 *
 * seed.json 은 build-sales-summary-seed.py 가 만든다(파싱·검산·지점명 매핑은 거기서 끝낸다).
 * 기본은 미리보기(쓰지 않음). --commit 이 있어야 실제로 저장한다.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDocFromServer, runTransaction } from "firebase/firestore";
import config from "../firebase-applet-config.json" with { type: "json" };
import { signInAsAdmin } from "./lib/admin-auth.mjs";

const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const allowConfirmed = argv.includes("--allow-confirmed");
const [inputPath] = argv.filter((a) => !a.startsWith("--"));
if (!inputPath) {
  console.error("사용법: node scripts/apply-sales-summary-seed.mjs <seed.json> [--commit] [--allow-confirmed]");
  process.exit(1);
}

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);
await signInAsAdmin(app);

const sharedRef = (k) => doc(db, "shared_data", encodeURIComponent(k));
const readShared = async (k) => {
  const s = await getDocFromServer(sharedRef(k));
  return s.exists() ? s.data().value ?? undefined : undefined;
};

const seed = JSON.parse(readFileSync(inputPath, "utf-8"));
const { month, documents } = seed;
const CLOSINGS_KEY = "monthly_closings";
const closings = (await readShared(CLOSINGS_KEY)) || [];

// ---------------------------------------------------------------- 마감 상태 확인
// 매출집계 섹션이 확정(confirmed)이거나 확정 후 수정중(editing)이면 덮어쓰지 않는다.
// 지점이 이미 제출한 값을 스크립트가 조용히 갈아끼우면, 관리자 화면은 '확정'인데 내용만 달라진다.
// 목록을 인자로 받는다 — 아래 쓰기 트랜잭션에서 '그 시점의 서버 값'으로 다시 판정해야 하기 때문.
const sectionStatusIn = (list, branchName) => {
  const rec = (Array.isArray(list) ? list : [])
    .filter((r) => r.branchName === branchName && r.month === month && (r.section || "purchase") === "salesSummary")
    .sort((a, b) => String(b.updatedAt || b.confirmedAt || "").localeCompare(String(a.updatedAt || a.confirmedAt || "")))[0];
  return rec?.status || "pending";
};
const sectionStatus = (branchName) => sectionStatusIn(closings, branchName);

const blocked = [];
for (const d of documents) {
  const st = sectionStatus(d.branchName);
  if ((st === "confirmed" || st === "editing") && !allowConfirmed) blocked.push({ branchName: d.branchName, status: st });
}
if (blocked.length) {
  console.error(`\n중단: 매출집계 마감이 확정/수정중인 지점이 ${blocked.length}곳 있습니다.\n`);
  for (const b of blocked) console.error(`  ${b.branchName}  [${b.status}]  — 덮어쓰려면 --allow-confirmed`);
  process.exit(1);
}

// ---------------------------------------------------------------- 미리보기
const FIELDS = ["totalSales", "totalDiscount", "netSales", "menuSales", "liquorSales", "coverCharge", "seatCharge",
  "receiptCount", "cardPay", "cashPlain", "cashReceipt"];
const fmt = (v) => (String(v ?? "").trim() === "" ? "(빈칸)" : Number(v).toLocaleString());

console.log(`\n■ ${month} 매출집계 기입 (${documents.length}개 지점)${commit ? "" : "  ※ 미리보기 — 쓰지 않음"}\n`);
let changed = 0;
for (const d of documents) {
  const key = `monthly_sales_summary:${d.branchName}:${month}`;
  const existing = await readShared(key); // undefined = 문서 없음(복구 시 삭제해야 하므로 {} 와 구분한다)
  const before = existing || {};
  // 결제구성·영수건수는 화면에서 없앤 레거시다. 비어 있는 지점에 새로 만들어 넣지는 않는다(폐지한 칸을 되살리는 셈).
  // 다만 이미 값이 있는 지점은, 실매출을 갱신하면 그 값과 어긋나 지점 화면에 안내가 뜬다 — 같은 출처(POS)로 함께 갱신한다.
  const legacy = {};
  for (const [f, v] of Object.entries(d.legacyValues || {})) {
    if (String(before[f] ?? "").trim() !== "") legacy[f] = v;
  }
  // 기존 문서의 다른 키(blankReasons 등)는 보존한다 — 이 스크립트가 모르는 값을 지우지 않는다.
  const after = { ...before, ...d.values, ...legacy };
  d._key = key;
  d._before = existing === undefined ? null : existing;
  d._after = after;
  // 레거시 갱신 여부 판정은 미리보기 값 기준으로 굳힌다 — 쓰기 트랜잭션에서 최신 문서와 다시 병합할 때 쓴다.
  d._legacy = legacy;
  const diffs = FIELDS.filter((f) => String(before[f] ?? "") !== String(after[f] ?? ""));
  console.log(`${d.branchName}  [${sectionStatus(d.branchName)}]`);
  if (diffs.length === 0) {
    console.log("   변경 없음");
  } else {
    changed++;
    for (const f of diffs) console.log(`   ${f.padEnd(14)} ${fmt(before[f]).padStart(14)}  ->  ${fmt(after[f]).padStart(14)}`);
  }
  const check = Number(after.menuSales || 0) + Number(after.liquorSales || 0) + Number(after.coverCharge || 0) - Number(after.netSales || 0);
  console.log(`   검산(메뉴+주류+커버-실매출) = ${check === 0 ? "0 ✅" : check.toLocaleString() + " ❌"}`);
}

if (!commit) {
  console.log(`\n미리보기 종료 — 실제로 쓰려면 --commit 을 붙이세요. (변경 대상 ${changed}개 지점)`);
  process.exit(0);
}

// ---------------------------------------------------------------- 백업 후 쓰기
// 되돌리기: node scripts/revert-backup.mjs <backup.json> --commit
// 백업은 반드시 쓰기 '전'에 남긴다 — 쓰다가 중간에 실패해도 그 시점까지의 원본이 남아 있어야 한다.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
mkdirSync(resolve(SCRIPT_DIR, "backups"), { recursive: true });
const backupPath = resolve(SCRIPT_DIR, "backups", `sales-summary-backup-${month}-${Date.now()}.json`);
const now = new Date().toISOString();
// 예비 백업은 '.pending' 으로 따로 남기고 unsafe 표식을 붙인다 — 이 값은 미리보기 시점의 것이라
// 커밋 후 재기록 전에 죽었을 때 그걸로 되돌리면 실제 덮어쓴 값이 아닌 것으로 복구된다(Codex 지적).
const pendingBackupPath = `${backupPath}.pending`;
writeFileSync(pendingBackupPath, JSON.stringify({
  month, unsafe: true,
  note: "트랜잭션 커밋 전 예비 스냅샷 — 이 파일로는 되돌릴 수 없다(실제 덮어쓴 값이 아님).",
  entries: documents.map((d) => ({ dataKey: d._key, previous: d._before ?? null })),
}, null, 2), "utf-8");
console.log(`\n예비 백업: ${pendingBackupPath}`);

// 미리보기 시점의 판정만 믿고 순차 setDoc 하면, 그 사이 지점이 마감제출하거나 값을 고쳐도 그대로 덮어쓴다
// (백업에 담긴 '이전 값'도 실제 덮어쓴 값이 아니게 된다). 트랜잭션 안에서 마감상태와 현재 문서를 다시 읽고
// 어긋나면 그 지점만 건너뛴다(Codex 지적).
const raced = [];
await runTransaction(db, async (tx) => {
  // 트랜잭션은 재시도될 수 있다 — 지난 시도의 판정 흔적을 지우고 매번 처음부터 다시 판정한다.
  raced.length = 0;
  for (const d of documents) d._written = false;
  const closeSnap = await tx.get(sharedRef(CLOSINGS_KEY));
  const liveClosings = closeSnap.exists() && Array.isArray(closeSnap.data().value) ? closeSnap.data().value : [];
  const liveDocs = new Map();
  for (const d of documents) {
    const s = await tx.get(sharedRef(d._key));
    liveDocs.set(d._key, s.exists() ? s.data().value : undefined);
  }
  for (const d of documents) {
    const st = sectionStatusIn(liveClosings, d.branchName);
    if ((st === "confirmed" || st === "editing") && !allowConfirmed) {
      raced.push({ branchName: d.branchName, why: `미리보기 이후 ${st} 로 바뀜` });
      continue;
    }
    // 실제로 덮어쓰는 직전 값을 백업 대상으로 삼는다.
    const live = liveDocs.get(d._key);
    d._before = live === undefined ? null : live;
    d._after = { ...(live || {}), ...d.values, ...d._legacy };
    tx.set(sharedRef(d._key), { value: d._after, updatedAt: now }, { merge: true });
    d._written = true;
  }
});
for (const d of documents) console.log(`  ${d._written ? "쓰기 완료" : "건너뜀  "}  ${d.branchName}`);
if (raced.length) {
  console.log(`\n경쟁으로 건너뜀 ${raced.length}곳`);
  raced.forEach((r) => console.log(`  - ${r.branchName}: ${r.why}`));
}
// 백업 파일은 트랜잭션이 실제로 덮어쓴 값으로 다시 쓴다(위 예비 백업은 미리보기 시점 값).
writeFileSync(backupPath, JSON.stringify({
  month,
  entries: documents.filter((d) => d._written).map((d) => ({
    dataKey: d._key, previous: d._before ?? null, expectedAfter: d._after, expectedUpdatedAt: now,
  })),
}, null, 2), "utf-8");
rmSync(pendingBackupPath, { force: true }); // 정식 백업이 생겼으니 예비본은 치운다.
console.log(`백업 저장: ${backupPath}`);

// ---------------------------------------------------------------- 재조회 검증
// 서버에서 다시 읽어 내가 쓴 값이 실제로 들어갔는지 확인한다. 쓰기 성공 응답만 믿지 않는다.
console.log("\n■ 재조회 검증");
let failures = 0;
const writtenDocs = documents.filter((d) => d._written);
for (const d of writtenDocs) {
  const actual = (await readShared(d._key)) || {};
  const bad = FIELDS.filter((f) => String(actual[f] ?? "") !== String(d._after[f] ?? ""));
  const check = Number(actual.menuSales || 0) + Number(actual.liquorSales || 0) + Number(actual.coverCharge || 0) - Number(actual.netSales || 0);
  if (bad.length) failures++;
  console.log(`  ${bad.length ? "실패" : "OK  "} ${d.branchName.padEnd(16)} 검산 ${check === 0 ? "0" : check.toLocaleString()}${bad.length ? `  불일치: ${bad.join(",")}` : ""}`);
}
// 성공 판정은 '실제로 쓴 건수' 기준. 전부 경쟁으로 밀려 0건이어도 "통과"로 찍히면,
// 자동화나 사람이 그 달을 기입 완료로 여긴다(Codex 지적, 형제 시더와 동일한 게이트).
console.log(`\n■ 결과  쓰기 ${writtenDocs.length}건 / 경쟁 건너뜀 ${raced.length}건 / 대상이던 지점 ${documents.length}곳`);
if (failures > 0) console.log(`검증 실패 ${failures}건 — 되돌리기: node scripts/revert-backup.mjs "${backupPath}" --commit`);
else if (writtenDocs.length === 0) console.log("쓴 지점이 없습니다 — 미리보기 이후 전부 상태가 바뀌었습니다.");
else if (raced.length) console.log("일부 지점이 경쟁으로 빠졌습니다 — 위 목록을 확인하세요.");
else console.log("전체 검증 통과.");
process.exit(failures === 0 && writtenDocs.length > 0 && raced.length === 0 ? 0 : 1);
