/**
 * 매출집계(salesSummary) 섹션을 본사에서 일괄 마감확정한다.
 *
 *   node scripts/confirm-sales-summary-close.mjs <YYYY-MM> [--commit] [--allow-editing] [--branch <지점명>]
 *
 * 되돌리기: node scripts/revert-backup.mjs <backup.json> --commit
 *
 * 게이트 — 지점이 [마감제출]을 누를 때 앱이 막는 것과 같은 조건을 여기서도 건다.
 * 스크립트가 앱보다 느슨하면 지점 화면에서는 제출조차 안 되는 값이 '확정'으로 기록된다.
 *   1) 필수 7칸이 모두 채워져 있을 것(0은 채워진 값)
 *   2) 총매출 − 총할인 = 실매출
 *   3) 메뉴 + 주류 + 커버차지·배달매출 = 실매출
 */
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDocFromServer, getDocsFromServer, collection, runTransaction } from "firebase/firestore";
import config from "../firebase-applet-config.json" with { type: "json" };
import { signInAsAdmin } from "./lib/admin-auth.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const allowEditing = argv.includes("--allow-editing");
const onlyBranch = argv.includes("--branch") ? argv[argv.indexOf("--branch") + 1] : null;
const MONTH = argv.find((a) => /^\d{4}-\d{2}$/.test(a));
if (!MONTH) {
  console.error("사용법: node scripts/confirm-sales-summary-close.mjs <YYYY-MM> [--commit] [--allow-editing] [--branch <지점명>]");
  process.exit(1);
}
const SECTION = "salesSummary";
const CLOSINGS_KEY = "monthly_closings";
// 재확정(확정 후 수정중 → 확정)일 때 관리자 화면에 남는 사유. 지점이 적는 자리를 본사가 대신 채우는 것이므로 출처를 밝힌다.
const BULK_REASON = "본사 일괄 확정 (POS 매출 데이터 기입 후)";

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);
await signInAsAdmin(app);

const sharedRef = (k) => doc(db, "shared_data", encodeURIComponent(k));
const summaryKey = (b) => `monthly_sales_summary:${b}:${MONTH}`;
const num = (v) => Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0;
const filled = (v) => String(v ?? "").trim() !== "";
const REQUIRED = ["totalSales", "totalDiscount", "netSales", "menuSales", "liquorSales", "coverCharge", "seatCharge"];

const latestRec = (list, branchName) => (Array.isArray(list) ? list : [])
  .filter((r) => r.branchName === branchName && r.month === MONTH && (r.section || "purchase") === SECTION)
  .sort((a, b) => String(b.updatedAt || b.confirmedAt || "").localeCompare(String(a.updatedAt || a.confirmedAt || "")))[0];

/** 앱의 마감제출 가드와 동일한 판정. 통과하지 못하면 확정하지 않는다. */
function gate(v) {
  if (!v || typeof v !== "object") return "매출집계 데이터 없음";
  const blank = REQUIRED.filter((f) => !filled(v[f]));
  if (blank.length) return `빈칸: ${blank.join(",")}`;
  if (num(v.totalSales) - num(v.totalDiscount) !== num(v.netSales)) {
    return `총매출−총할인 ≠ 실매출 (${(num(v.totalSales) - num(v.totalDiscount) - num(v.netSales)).toLocaleString()})`;
  }
  const comp = num(v.menuSales) + num(v.liquorSales) + num(v.coverCharge);
  if (comp !== num(v.netSales)) return `매출구성 합계 ≠ 실매출 (${(comp - num(v.netSales)).toLocaleString()})`;
  return null;
}

const branchSnap = await getDocsFromServer(collection(db, "public_branches"));
const allBranches = branchSnap.docs.map((d) => d.data())
  .filter((b) => b?.branchName && b.isActive !== false).map((b) => b.branchName).sort();
const branches = onlyBranch ? allBranches.filter((b) => b === onlyBranch) : allBranches;

const closingsSnap = await getDocFromServer(sharedRef(CLOSINGS_KEY));
const closings = closingsSnap.exists() && Array.isArray(closingsSnap.data().value) ? closingsSnap.data().value : [];

const targets = [];
const skips = [];
for (const branchName of branches) {
  const snap = await getDocFromServer(sharedRef(summaryKey(branchName)));
  const v = snap.exists() ? snap.data().value : undefined;
  const prev = latestRec(closings, branchName);
  const status = prev?.status || "pending";

  const why = gate(v);
  if (why) { skips.push({ branchName, why }); continue; }
  if (status === "confirmed") { skips.push({ branchName, why: "이미 확정됨" }); continue; }
  // '수정중'은 지점이 확정본을 열어 고치는 중이다. 여기서 확정하면 지점이 적어야 할 수정 사유를 본사가 대신 채우게 된다.
  if (status === "editing" && !allowEditing) {
    skips.push({ branchName, why: "지점이 마감수정 중 — 지점이 사유와 함께 제출해야 함 (강행하려면 --allow-editing)" });
    continue;
  }
  targets.push({ branchName, status, net: num(v.netSales), cover: num(v.coverCharge), seat: num(v.seatCharge) });
}

console.log(`\n■ 매출집계 ${MONTH} 마감확정 (${commit ? "COMMIT" : "DRY-RUN"})\n`);
console.log(`${"지점".padEnd(20)}${"실매출".padStart(15)}${"커버·배달".padStart(13)}${"예약정산금".padStart(13)}   현재상태`);
targets.forEach((t) => console.log(`${t.branchName.padEnd(20)}${t.net.toLocaleString().padStart(15)}${t.cover.toLocaleString().padStart(13)}${t.seat.toLocaleString().padStart(13)}   ${t.status}`));
console.log(`\n확정 대상 ${targets.length}곳 / 실매출 합계 ${targets.reduce((a, t) => a + t.net, 0).toLocaleString()}원`);
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
const backupPath = resolve(SCRIPT_DIR, "backups", `sales-summary-close-backup-${MONTH}-${Date.now()}.json`);
// 예비본은 '.pending' 에 unsafe 표식과 함께 남긴다. 커밋 후 정식 백업을 쓰기 전에 죽으면
// 미리보기 시점 값의 무조건 복구형 파일이 정식 자리에 남아, 그걸로 되돌리면 그 사이 다른 지점이 제출한
// 마감기록까지 옛 배열로 지운다(Codex 지적). revert-backup.mjs 는 unsafe:true 를 거부한다.
const pendingBackupPath = `${backupPath}.pending`;
const writePendingBackup = (previous) => {
  writeFileSync(pendingBackupPath, JSON.stringify({
    month: MONTH, unsafe: true,
    note: "트랜잭션 커밋 전 예비 스냅샷 — 이 파일로는 되돌릴 수 없다(실제 덮어쓴 값이 아님).",
    entries: [{ dataKey: CLOSINGS_KEY, previous }],
  }, null, 2), "utf-8");
};
const writeFinalBackup = (previous, expectedAfter) => {
  // 조건부 복구 — monthly_closings 는 전 지점·전 섹션이 한 배열에 든 공유 문서다.
  // 무조건 복구로 두면, 이 스크립트 실행 뒤 다른 지점이 제출한 마감기록까지 옛 배열로 되돌려 지운다(Codex 4R).
  writeFileSync(backupPath, JSON.stringify({
    month: MONTH,
    entries: [{ dataKey: CLOSINGS_KEY, previous, expectedAfter, expectedUpdatedAt: now }],
  }, null, 2), "utf-8");
  rmSync(pendingBackupPath, { force: true });
};

const now = new Date().toISOString();
writePendingBackup(closingsSnap.exists() ? closingsSnap.data().value ?? null : null);
console.log(`\n예비 백업: ${pendingBackupPath}`);

let written = 0;
// 트랜잭션이 실제로 본 직전 값과 실제로 쓴 값. 백업을 이 값으로 다시 써야 복구가 정확해진다.
let livePreimage = null;
let finalList = null;
// 마감기록은 문서 하나에 전 지점·전 섹션이 배열로 들어 있다 — 읽고-고쳐-쓰기 사이에 지점이 제출하면
// 그 제출이 사라진다. 트랜잭션으로 묶어 경쟁을 막는다.
const raced = [];
await runTransaction(db, async (tx) => {
  written = 0;
  raced.length = 0; // 트랜잭션은 재시도될 수 있다 — 매번 처음부터 다시 판정한다.
  // Firestore 트랜잭션은 쓰기 전에 읽기를 모두 끝내야 한다. 마감기록과 각 지점 매출집계를 먼저 읽는다.
  const snap = await tx.get(sharedRef(CLOSINGS_KEY));
  const liveSummary = new Map();
  for (const t of targets) {
    const s = await tx.get(sharedRef(summaryKey(t.branchName)));
    liveSummary.set(t.branchName, s.exists() ? s.data().value : undefined);
  }
  const list = snap.exists() && Array.isArray(snap.data().value) ? [...snap.data().value] : [];
  // 트랜잭션이 실제로 읽은 직전 값(= 되돌릴 대상). 미리보기 시점 값과 다를 수 있다.
  livePreimage = snap.exists() ? snap.data().value ?? null : null;
  for (const t of targets) {
    const prev = latestRec(list, t.branchName);
    // 트랜잭션 안에서 다시 판정한다 — 위 조회 이후 지점이 직접 제출했으면 건드리지 않는다.
    // 조용히 continue 하면 written 에도 raced 에도 안 잡혀, 이 실행이 처리하지 않은 지점이 집계에서 사라진다
    // (다른 지점이 하나라도 써지면 '전체 통과'로 끝난다). 처리하지 못한 것은 반드시 기록한다(Codex 지적).
    if (prev?.status === "confirmed") {
      raced.push({ branchName: t.branchName, why: "미리보기 이후 지점이 직접 확정함 (이 실행이 쓴 것은 아님)" });
      continue;
    }
    // '수정중'도 여기서 다시 막는다. 미리보기 때 pending 이던 지점이 그 뒤 확정본을 열어 고치는 중일 수 있는데,
    // confirmed 만 보고 통과시키면 --allow-editing 가드를 우회해 지점의 수정 중 상태를 일반 사유로 덮어쓴다(Codex 2R).
    if (prev?.status === "editing" && !allowEditing) {
      raced.push({ branchName: t.branchName, why: "미리보기 이후 지점이 마감수정 중으로 바뀜 (강행하려면 --allow-editing)" });
      continue;
    }
    // 게이트도 여기서 다시 건다. 미리보기 이후 지점이 값을 고치거나 비웠으면, 앱이라면 제출을 막았을 데이터를
    // '확정'으로 기록하게 된다 — 미리보기 시점의 판정만 믿으면 안 된다(Codex 지적).
    const why = gate(liveSummary.get(t.branchName));
    if (why) { raced.push({ branchName: t.branchName, why }); continue; }
    const isReconfirm = prev?.status === "editing" && !!prev?.editedAfterConfirm;
    const carried = Array.isArray(prev?.editEvents) ? prev.editEvents : [];
    const next = {
      id: `${t.branchName}-${MONTH}-${SECTION}`,
      branchName: t.branchName, month: MONTH, section: SECTION, status: "confirmed", writer: t.branchName,
      confirmedAt: now,
      editedAfterConfirm: isReconfirm ? true : !!(prev?.status === "confirmed" && prev?.editedAfterConfirm),
      editEvents: isReconfirm ? [...carried, { at: now, reason: BULK_REASON }].slice(-20) : carried,
      updatedAt: now,
    };
    const rest = list.filter((r) => !(r.branchName === t.branchName && r.month === MONTH && (r.section || "purchase") === SECTION));
    list.length = 0;
    list.push(next, ...rest);
    written++;
  }
  finalList = list.map((r) => ({ ...r }));
  tx.set(sharedRef(CLOSINGS_KEY), { value: list, updatedAt: now }, { merge: true });
});
// 백업을 '실제로 덮어쓴 값 + 내가 쓴 결과'로 다시 쓴다 — revert-backup 이 조건부로만 되돌리도록.
writeFinalBackup(livePreimage, finalList);
console.log(`백업 저장: ${backupPath}`);
console.log(`\n확정 기록 ${written}건 저장 (백업 갱신: 트랜잭션 실제 직전값 기준)`);
if (raced.length) {
  console.log(`\n경쟁으로 건너뜀 ${raced.length}곳 (미리보기 이후 값이 바뀜)`);
  raced.forEach((r) => console.log(`  - ${r.branchName}: ${r.why}`));
}

// ---------------------------------------------------------------- 재조회 검증
// 상태만 보지 않는다 — 확정된 데이터가 여전히 게이트를 통과하는지까지 확인해야
// '확정인데 지점 화면에선 경고가 뜨는' 상태를 잡아낼 수 있다.
const after = await getDocFromServer(sharedRef(CLOSINGS_KEY));
const afterList = after.exists() && Array.isArray(after.data().value) ? after.data().value : [];
const racedSet = new Set(raced.map((r) => r.branchName));
let failures = 0;
console.log("\n■ 재조회 검증");
for (const t of targets) {
  if (racedSet.has(t.branchName)) continue;
  const st = latestRec(afterList, t.branchName)?.status;
  const snap = await getDocFromServer(sharedRef(summaryKey(t.branchName)));
  const why = gate(snap.exists() ? snap.data().value : undefined);
  const ok = st === "confirmed" && !why;
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "실패"} ${t.branchName.padEnd(20)} ${st || "기록없음"}${why ? `  게이트: ${why}` : ""}`);
}
// 성공 판정은 '실제로 쓴 건수'로 한다. raced 를 검증에서 빼 놓고 failures===0 만 보면,
// 전부 경쟁으로 밀려 한 건도 확정하지 못한 실행이 "통과"로 찍힌다 — 로그만 믿는 사람은 마감이 된 줄 안다(Codex 3R).
console.log(`\n■ 결과  확정 ${written}건 / 경쟁으로 건너뜀 ${raced.length}건 / 대상이던 지점 ${targets.length}곳`);
if (failures > 0) {
  console.log(`검증 실패 ${failures}건 — 되돌리기: node scripts/revert-backup.mjs "${backupPath}" --commit`);
} else if (written === 0) {
  console.log("확정된 지점이 없습니다 — 미리보기 이후 전부 상태가 바뀌었습니다. 다시 실행해 확인하세요.");
} else if (raced.length) {
  console.log("일부 지점이 경쟁으로 빠졌습니다 — 위 목록을 확인하고 필요하면 다시 실행하세요.");
} else {
  console.log("전체 검증 통과.");
}
process.exit(failures === 0 && written > 0 && raced.length === 0 ? 0 : 1);
