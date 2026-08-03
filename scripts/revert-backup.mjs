/**
 * seed-*.mjs / rename-*.mjs 가 남긴 백업 파일로 shared_data 문서를 원상복구한다.
 *
 *   node scripts/revert-backup.mjs <backup.json>            # dry-run (기본)
 *   node scripts/revert-backup.mjs <backup.json> --commit
 *
 * 백업 형식: { entries: [{ dataKey, previous, expectedAfter?, expectedUpdatedAt? }] }
 *   previous === null  → 당시 문서가 없었음 → 복구 시 삭제
 *   previous === [...] → 당시 값 → 복구 시 그 값으로 복구
 *
 *   expectedAfter 가 있으면 '조건부 복구'다. 현재 문서가 마이그레이션이 써 넣은 그 상태일 때만 되돌린다.
 *   세 가지를 동시에 막는다:
 *     1) 마이그레이션이 실제로 쓰지 못한 문서를 낡은 값으로 덮어쓰는 것
 *        (기록은 쓰기 전에 남기므로, 못 쓴 문서도 백업 파일에는 들어 있다)
 *     2) 마이그레이션 뒤 지점이 직접 고친 문서를 되돌려 그 편집을 날리는 것
 *     3) 마이그레이션이 못 썼는데 지점이 우연히 똑같은 값을 손으로 입력한 문서를 되돌리는 것
 *        → 값만 봐서는 1)과 구분할 수 없다. 그래서 expectedUpdatedAt(마이그레이션이 찍은 updatedAt)까지 대조한다.
 *          지점이 저장하면 자기 시각이 찍히므로 우연의 일치가 성립하지 않는다.
 *   expectedAfter 가 없는 옛 백업(seed/carry)은 종전대로 무조건 복구한다.
 *   expectedAfter 만 있고 expectedUpdatedAt 이 없는 백업은 값 대조만 한다(구버전 호환).
 *
 * 순서 주의: 같은 dataKey 를 건드린 백업이 여러 개면 "나중 것부터" 되돌려야 한다.
 * (예: 6월 시드 백업에는 7월 잔재 문서 복원 항목이 섞여 있어, 7월 이월 백업보다 먼저 되돌리면
 *  방금 만든 7월 이월 문서가 옛 샘플 행으로 덮인다.)
 * 이 스크립트는 파일명 타임스탬프를 비교해 더 나중 백업이 같은 키를 갖고 있으면 중단한다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { deepEqual } from "./lib/deep-equal.mjs";

export const SKIP = "건너뜀";
export const DELETE = "삭제";
export const RESTORE = "값복구";

/**
 * 이 항목을 어떻게 할지 정한다. Firestore 를 모르는 순수 함수라 단위 검증이 가능하다.
 *   current === undefined 는 '문서 없음'. currentUpdatedAt 은 그 문서의 updatedAt 필드.
 */
export function revertAction(entry, current, currentUpdatedAt) {
  if (entry.expectedAfter !== undefined) {
    // 시각 대조가 먼저다. 값이 우연히 같아도 내가 쓴 문서가 아니면 되돌리면 안 된다.
    if (entry.expectedUpdatedAt !== undefined && currentUpdatedAt !== entry.expectedUpdatedAt) return SKIP;
    if (!deepEqual(current, entry.expectedAfter)) return SKIP;
  }
  return entry.previous === null ? DELETE : RESTORE;
}

/** 왜 건너뛰는지 사람이 읽을 이유. 진단용이라 판단 로직에는 쓰지 않는다. */
export function skipReason(entry, current, currentUpdatedAt) {
  if (current === undefined) return "문서가 없음";
  if (deepEqual(current, entry.previous)) return "마이그레이션이 이 문서를 쓰지 않았음 (되돌릴 것 없음)";
  if (deepEqual(current, entry.expectedAfter) && entry.expectedUpdatedAt !== undefined && currentUpdatedAt !== entry.expectedUpdatedAt) {
    return "값은 같지만 마이그레이션이 쓴 문서가 아님 (지점이 같은 값을 직접 입력) — 되돌리면 그 입력이 사라짐";
  }
  return "마이그레이션 뒤 값이 또 바뀌었음 (지점 편집으로 보임) — 되돌리면 그 편집이 사라짐";
}

async function main() {
  const { initializeApp } = await import("firebase/app");
  const { getFirestore, doc, getDocFromServer, runTransaction } = await import("firebase/firestore");
  const { default: config } = await import("../firebase-applet-config.json", { with: { type: "json" } });
  const { blockedTargets, reportBlocked } = await import("./lib/close-guard.mjs");
  const { signInAsAdmin, signInAsPersonalAdmin } = await import("./lib/admin-auth.mjs");

  // 급여대장 키는 PIN 관리자가 접근할 수 없다(firestore.rules isSalaryKey → canReadSalary, PIN 계정 제외).
  // 백업에 급여 키가 하나라도 있으면 개인 관리자 계정으로 로그인해야 한다 —
  // 안 그러면 급여 시더가 남긴 백업을 이 도구로 되돌릴 수 없다(Codex 지적).
  const isSalaryKey = (dataKey) => /^(monthly_fulltime_salary|part_time_salaries|part_time_salary_exclusions|part_time_profiles)(:|%3A)/
    .test(decodeURIComponent(String(dataKey || "")));

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
  // 트랜잭션형 시더가 '커밋 전'에 남기는 예비 스냅샷(.pending, unsafe:true)은 복구에 쓸 수 없다.
  // 그 값은 미리보기 시점의 것이라, 실제로 덮어쓴 값과 다르고 건너뛴 문서까지 되돌린다.
  // (정식 백업은 커밋 뒤 조건부 복구 형식으로 다시 쓰이고, 그때 예비본은 지워진다.)
  if (backup.unsafe === true) {
    console.error("이 파일은 커밋 전 예비 스냅샷이라 되돌리기에 쓸 수 없습니다(unsafe: true).");
    console.error(`  ${backup.note || ""}`);
    console.error("  같은 이름의 정식 백업(.json, .pending 없는 것)을 쓰세요. 없다면 시더가 커밋 후 중단된 것이므로");
    console.error("  서버 현재 값을 직접 확인한 뒤 수동으로 판단해야 합니다.");
    process.exit(1);
  }
  if (!Array.isArray(backup.entries)) {
    console.error("중단: 백업 파일에 entries 배열이 없습니다.");
    process.exit(1);
  }
  const targetKeys = new Set(backup.entries.map((e) => e.dataKey));

  // 순서 가드: 같은 키를 건드린 '더 나중' 백업이 남아 있으면 그것부터 되돌려야 한다.
  //
  // '.json.pending' 도 함께 본다. 시더가 커밋한 뒤 정식 백업을 쓰기 전에 죽으면 그 파일만 남는데,
  // 그건 '이 뒤에 커밋됐을 수도 있는 작업'의 유일한 흔적이다. 이름이 .json 으로 끝나지 않는다고 빼면,
  // 그 알 수 없는 작업을 건너뛴 채 공유 문서를 옛 값으로 되돌려 나중 마감기록을 지운다(Codex 지적).
  // 예비본은 순서를 단정할 수 없으므로(정식 백업과 같은 시각 스탬프를 갖는다) 겹치기만 하면 무조건 막는다.
  const thisStamp = stampOf(basename(backupPath));
  const laterConflicts = [];
  const pendingConflicts = [];
  for (const name of readdirSync(BACKUP_DIR)) {
    const isPending = name.endsWith(".json.pending");
    if (!name.endsWith(".json") && !isPending) continue;
    if (resolve(BACKUP_DIR, name) === resolve(backupPath)) continue;
    if (!isPending && stampOf(name) <= thisStamp) continue;
    let other;
    try {
      other = JSON.parse(readFileSync(resolve(BACKUP_DIR, name), "utf-8"));
    } catch {
      // 쓰다 만 파일도 '작업이 있었다'는 신호다 — 조용히 넘기지 않는다.
      (isPending ? pendingConflicts : laterConflicts).push({ name, overlap: ["(파일을 읽을 수 없음)"] });
      continue;
    }
    const overlap = (other.entries || []).map((e) => e.dataKey).filter((k) => targetKeys.has(k));
    if (overlap.length === 0) continue;
    // 예비본은 스탬프가 이 백업보다 이르더라도 막는다(그 실행이 커밋 후 중단됐을 수 있다).
    if (isPending) pendingConflicts.push({ name, overlap });
    else laterConflicts.push({ name, overlap });
  }
  if (pendingConflicts.length > 0) {
    console.error("중단: 커밋 후 중단된 것으로 보이는 예비 백업(.pending)이 같은 문서를 갖고 있습니다.\n");
    for (const c of pendingConflicts) console.error(`  ${c.name}  (겹치는 문서 ${c.overlap.length}개: ${c.overlap.join(", ")})`);
    console.error("\n그 실행이 실제로 썼는지 서버 현재 값으로 확인한 뒤, 예비 파일을 치우고 다시 시도하세요.");
    console.error("(정식 백업이 없다는 것은 그 실행이 커밋 뒤 죽었을 수 있다는 뜻입니다 — 되돌리면 그 작업이 사라집니다.)");
    process.exit(1);
  }
  if (laterConflicts.length > 0) {
    console.error("중단: 같은 문서를 나중에 건드린 백업이 남아 있습니다. 나중 것부터 되돌리세요.\n");
    for (const c of laterConflicts) console.error(`  ${c.name}  (겹치는 문서 ${c.overlap.length}개: ${c.overlap.join(", ")})`);
    process.exit(1);
  }

  const app = initializeApp(config);
  const db = getFirestore(app, config.firestoreDatabaseId);
  // 급여 키가 섞여 있으면 개인 관리자로 로그인한다. 자격증명이 없으면 여기서 멈춘다 —
  // PIN 계정으로 진행하면 쓰기가 규칙에 막혀 '일부만 복구'된 채 끝난다.
  const needsPersonalAdmin = backup.entries.some((e) => isSalaryKey(e.dataKey));
  if (needsPersonalAdmin) {
    console.log("※ 급여대장 키가 포함된 백업 — 개인 관리자 계정으로 로그인합니다(UGD_PERSONAL_ADMIN_EMAIL/_PASSWORD).");
    await signInAsPersonalAdmin(app);
  } else {
    await signInAsAdmin(app);
  }

  const sharedRef = (dataKey) => doc(db, "shared_data", encodeURIComponent(dataKey));
  const readShared = async (dataKey) => {
    const snapshot = await getDocFromServer(sharedRef(dataKey));
    return snapshot.exists() ? snapshot.data().value ?? null : undefined;
  };
  /** 값과 updatedAt 을 함께 읽는다. 문서가 없으면 둘 다 undefined. */
  const readDoc = async (dataKey) => {
    const snapshot = await getDocFromServer(sharedRef(dataKey));
    if (!snapshot.exists()) return { value: undefined, updatedAt: undefined };
    return { value: snapshot.data().value ?? null, updatedAt: snapshot.data().updatedAt };
  };

  const describe = (v) => (v === undefined ? "문서없음" : Array.isArray(v) ? `${v.length}행` : String(v));

  console.log(`\n■ 복구 계획: ${basename(backupPath)} (${backup.entries.length}개 문서)\n`);
  const plan = [];
  for (const entry of backup.entries) {
    const { value: current, updatedAt: currentUpdatedAt } = await readDoc(entry.dataKey);
    const action = revertAction(entry, current, currentUpdatedAt);
    plan.push({ ...entry, current, action, reason: action === SKIP ? skipReason(entry, current, currentUpdatedAt) : "" });
    const detail = action === SKIP ? plan[plan.length - 1].reason : action === DELETE ? "" : `(${entry.previous.length}행)`;
    console.log(`  ${entry.dataKey.padEnd(46)} 현재 ${describe(current).padStart(8)} → ${action} ${detail}`);
  }

  const restorable = plan.filter((item) => item.action !== SKIP);
  const skipped = plan.filter((item) => item.action === SKIP);
  if (skipped.length > 0) {
    console.log(`\n건너뛰는 문서 ${skipped.length}개`);
    for (const item of skipped) console.log(`  ${item.dataKey} — ${item.reason}`);
  }
  if (restorable.length === 0) {
    console.log("\n되돌릴 문서가 없습니다.");
    process.exit(1);
  }

  // 복구도 파괴적이다: 그 사이에 지점이 마감을 확정했다면 되돌리는 순간 마감 자료가 사라진다.
  // 실제로 건드릴 문서에만 가드를 건다. 건너뛸 문서 때문에 전체가 막히면 안 된다.
  const closings = (await readShared("monthly_closings")) || [];
  if (reportBlocked(blockedTargets(closings, restorable.map((e) => e.dataKey), { allowEditing }))) process.exit(1);

  if (!commit) {
    console.log("\n[dry-run] 아무것도 쓰지 않았습니다. --commit 을 붙여 실행하세요.");
    process.exit(0);
  }

  // 계획 때 읽은 값으로 판단해 놓고 조건 없이 쓰면, 그 사이 지점이 편집한 내용을 덮어쓴다.
  // 트랜잭션 안에서 값을 다시 읽어 계획과 같은 판정이 나올 때만 쓴다.
  // expectedAfter 가 없는 옛 백업(seed/carry)은 revertAction 이 현재값과 무관하게 같은 판정을
  // 돌려주므로, 종전의 '무조건 복구' 동작이 그대로 유지된다.
  const now = new Date().toISOString();
  const failures = [];
  const done = [];
  for (const item of restorable) {
    try {
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(sharedRef(item.dataKey));
        const current = snapshot.exists() ? snapshot.data().value ?? null : undefined;
        const currentUpdatedAt = snapshot.exists() ? snapshot.data().updatedAt : undefined;
        if (revertAction(item, current, currentUpdatedAt) !== item.action) {
          throw new Error(`계획 이후 값이 바뀌었습니다 (${skipReason(item, current, currentUpdatedAt)}) — 다시 실행하세요`);
        }
        if (item.previous === null) transaction.delete(sharedRef(item.dataKey));
        else transaction.set(sharedRef(item.dataKey), { value: item.previous, updatedAt: now });
      });
      done.push(item);
      console.log(`  ${item.action} 완료  ${item.dataKey}`);
    } catch (error) {
      failures.push({ dataKey: item.dataKey, reason: error?.message ?? String(error) });
      console.error(`  ${item.action} 취소  ${item.dataKey} — ${error?.message ?? error}`);
    }
  }

  console.log("\n■ 재조회 검증");
  let bad = 0;
  for (const item of done) {
    const actual = await readShared(item.dataKey);
    // 행 개수만 보면 길이가 같은 다른 값을 놓친다. 값 전체를 대조한다.
    const ok = item.previous === null ? actual === undefined : deepEqual(actual, item.previous);
    if (!ok) bad++;
    console.log(`  ${ok ? "OK  " : "실패"} ${item.dataKey.padEnd(46)} ${describe(actual)}`);
  }
  if (skipped.length > 0) console.log(`\n건너뛴 문서 ${skipped.length}개는 그대로 두었습니다.`);
  if (failures.length > 0) {
    console.error(`\n되돌리지 못한 문서 ${failures.length}개`);
    for (const f of failures) console.error(`  ${f.dataKey} — ${f.reason}`);
  }
  const incomplete = bad > 0 || failures.length > 0;
  console.log(incomplete ? "\n일부만 복구됐습니다. 위 목록을 확인하세요." : "\n복구 완료, 전체 검증 통과.");
  process.exit(incomplete ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
