/**
 * 매입매출 거래처명 표기 통일 — 비알 계열 (일회성 스크립트).
 *
 *   node scripts/rename-purchase-vendors.mjs 2026-06 2026-07              # dry-run (기본, 아무것도 안 씀)
 *   node scripts/rename-purchase-vendors.mjs 2026-06 2026-07 --commit     # 실제 쓰기 + 백업 + 재조회 검증
 *
 * 되돌리기: node scripts/revert-backup.mjs <이 스크립트가 남긴 backup.json> --commit
 *
 * 무엇을 바꾸나
 *   vendorName 만 바꾼다. category·금액·은행·계좌·메모·id 는 그대로 둔다.
 *   지점이 "비알(식재료)", "비알 /부식비", "비알/식자재" 처럼 제각각 적은 이름을
 *   비알/식재료 · 비알/부식 · 비알/음료 · 비알/소모품 네 가지로 통일한다.
 *
 * 왜 여러 달을 한 번에 받나
 *   6월(시드)과 7월(이월) 문서는 거래처·계좌 목록이 같아야 한다. check-purchase-seed.mjs 의
 *   identity() 가 두 달을 대조하므로, 한 달만 고치면 그 점검이 실패한다.
 *   같은 이유로 한 지점의 달이 하나라도 막히면 그 지점은 통째로 건너뛴다(지점 단위 원자성).
 *
 * 안전장치
 *   - 공백을 지운 이름이 "비알"로 시작하는데 아래 표에 없으면 전체 중단 (fail-closed).
 *     새로운 오타 표기를 조용히 지나치지 않기 위해서다.
 *   - 확정(confirmed)·수정중(editing) 인 달은 예외 없이 건너뛴다. 강행 플래그를 두지 않는다.
 *     이름만 바꿔도 지점이 보고 있는 마감 자료와 어긋나기 때문이다.
 *   - 쓰기는 문서별 트랜잭션이다. 계획을 세운 뒤 쓰기까지의 사이에 지점이 금액을 입력하면
 *     그 문서는 건너뛴다. 계획 시점의 값을 그대로 덮어써 지점 입력을 날리는 사고를 막는다.
 *   - setDoc(전체 교체) 대신 updateDoc(value·updatedAt 만) 을 쓴다. 문서의 다른 필드를 건드리지 않는다.
 *   - 쓰기 전 대상 문서의 기존 값 전체를 scripts/backups/ 에 스냅샷.
 *   - 쓰기 직전(트랜잭션 안)과 쓰기 뒤(재조회) 두 번, vendorName 외 모든 필드가 그대로인지 대조한다.
 *
 * 이 스크립트가 막지 못하는 것
 *   지점 기기에 '미저장 편집(pending)' 플래그가 남아 있으면, 그 기기가 다음 접속 때
 *   localStorage 의 옛 거래처명을 서버로 다시 밀어올린다(MonthlyPurchaseSalesSubTab 134-140, 176-180행).
 *   서버 쪽에서는 막을 수 없다. 반영 뒤 check-purchase-seed.mjs 로 되살아났는지 확인할 것.
 */
import { writeFileSync, mkdirSync, renameSync, openSync, fsyncSync, closeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { deepEqual } from "./lib/deep-equal.mjs";

/** 정식 표기 → 그 표기로 통일할 이름들. 비교는 공백을 모두 지운 뒤 한다. */
export const VENDOR_ALIASES = {
  "비알/식재료": ["비알/식재료", "비알/식자재", "비알(식재료)", "비알(식자재)"],
  "비알/부식": ["비알/부식", "비알/부식비", "비알(부식)", "비알(부식비)"],
  "비알/음료": ["비알/음료", "비알/음료수", "비알(음료)", "비알(음료수)"],
  "비알/소모품": ["비알/소모품", "비알(소모품)"],
};

const BIAL = "비알";
export const CANONICAL_VENDORS = Object.keys(VENDOR_ALIASES);

/** 공백(일반·전각 모두)을 지운다. "비알 /부식비" 와 "비알/부식비" 를 같게 보기 위함. */
export const normalizeVendor = (value) => String(value ?? "").replace(/[\s　]+/g, "");

const ALIAS_TO_CANONICAL = new Map(
  Object.entries(VENDOR_ALIASES).flatMap(([canonical, aliases]) =>
    aliases.map((alias) => [normalizeVendor(alias), canonical])
  )
);

/** 비알 계열 이름인가? (표에 없는 오타까지 잡아야 하므로 접두사로 본다) */
export const isBialVendor = (value) => normalizeVendor(value).startsWith(BIAL);

/**
 * 행 배열 → { rows, changes, unknown }
 *   changes: 실제로 이름이 바뀐 행. 이미 정식 표기면 여기 안 들어온다.
 *   unknown: 비알 계열인데 표에 없는 이름. 하나라도 있으면 호출부가 중단해야 한다.
 */
export function renameRows(rows) {
  const changes = [];
  const unknown = [];
  const next = rows.map((row, index) => {
    if (!isBialVendor(row.vendorName)) return row;
    const canonical = ALIAS_TO_CANONICAL.get(normalizeVendor(row.vendorName));
    if (!canonical) {
      unknown.push(String(row.vendorName));
      return row;
    }
    if (row.vendorName === canonical) return row;
    changes.push({ index, from: String(row.vendorName), to: canonical });
    return { ...row, vendorName: canonical };
  });
  return { rows: next, changes, unknown };
}

/** vendorName 을 뺀 나머지 필드가 전부 같은가? 쓰기 전/후 양쪽에서 쓴다. */
export function rowsMatchExceptVendor(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return false;
  return before.every((row, i) => {
    const other = after[i];
    if (!other || typeof other !== "object") return false;
    const keys = new Set([...Object.keys(row), ...Object.keys(other)]);
    keys.delete("vendorName");
    return [...keys].every((key) => deepEqual(row[key] ?? null, other[key] ?? null));
  });
}

/** 모든 비알 행이 정식 표기인가? 재조회 검증용. */
export const allVendorsCanonical = (rows) =>
  Array.isArray(rows) && rows.every((r) => !isBialVendor(r.vendorName) || CANONICAL_VENDORS.includes(r.vendorName));

/** 막힌 dataKey 들에서 지점명을 뽑는다. 한 달이라도 막히면 그 지점 전체를 건너뛰기 위함. */
export function blockedBranchNames(blocked) {
  return new Set(blocked.map((item) => item.branchName).filter(Boolean));
}

// ---------------------------------------------------------------- CLI
async function main() {
  const { initializeApp } = await import("firebase/app");
  const { getFirestore, doc, getDocFromServer, runTransaction, collection, getDocs } = await import("firebase/firestore");
  const { default: config } = await import("../firebase-applet-config.json", { with: { type: "json" } });
  const { blockedTargets, reportBlocked } = await import("./lib/close-guard.mjs");
  const { signInAsAdmin } = await import("./lib/admin-auth.mjs");

  const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
  const argv = process.argv.slice(2);
  const commit = argv.includes("--commit");
  const months = argv.filter((a) => !a.startsWith("--"));
  if (months.length === 0 || !months.every((m) => /^\d{4}-\d{2}$/.test(m))) {
    console.error("사용법: node scripts/rename-purchase-vendors.mjs <월...> [--commit]");
    console.error("  예:   node scripts/rename-purchase-vendors.mjs 2026-06 2026-07 --commit");
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

  // 대상 지점을 하드코딩하지 않는다. 미시드 지점이 직접 적어 넣은 비알 오타도 잡아야 한다.
  const snapshot = await getDocs(collection(db, "public_branches"));
  const branchNames = snapshot.docs.map((d) => d.data()).filter((b) => b?.branchName && b.isActive !== false).map((b) => b.branchName);

  // 존재하는 문서를 전부 읽는다. 바꿀 게 없는 달도 마감 가드에는 넣어야 한다 —
  // 같은 지점의 어느 한 달이라도 확정/수정중이면 그 지점은 통째로 손대지 않는다.
  const existing = [];
  const unknownVendors = [];
  for (const branchName of branchNames) {
    for (const month of months) {
      const dataKey = `monthly_purchases:${branchName}:${month}`;
      const previous = await readShared(dataKey);
      if (!Array.isArray(previous) || previous.length === 0) continue;
      const { rows, changes, unknown } = renameRows(previous);
      for (const name of unknown) unknownVendors.push({ dataKey, name });
      existing.push({ dataKey, branchName, month, previous, rows, changes });
    }
  }

  if (unknownVendors.length > 0) {
    console.error(`\n중단: 표에 없는 비알 거래처가 ${unknownVendors.length}건 있습니다. VENDOR_ALIASES 에 추가할지 판단하세요.\n`);
    for (const item of unknownVendors) console.error(`  ${item.dataKey}  →  ${JSON.stringify(item.name)}`);
    process.exit(1);
  }

  if (!existing.some((e) => e.changes.length > 0)) {
    console.log("\n바꿀 거래처명이 없습니다. 이미 전부 정식 표기입니다.");
    process.exit(0);
  }

  // 확정/수정중인 달은 예외 없이 막는다. 강행 플래그를 두지 않는다.
  const closings = (await readShared("monthly_closings")) || [];
  const blocked = blockedTargets(closings, existing.map((e) => e.dataKey), { allowEditing: false });
  if (blocked.length > 0) {
    reportBlocked(blocked);
    console.error("  (이 스크립트에는 --allow-editing 이 없습니다. 지점이 마감을 끝내거나 되돌린 뒤 다시 실행하세요.)");
  }

  // 지점명을 못 읽은 막힘(형식 깨진 키)은 어느 지점을 건너뛸지 판단할 수 없다 — 전체 중단.
  if (blocked.some((item) => !item.branchName)) {
    console.error("\n중단: 지점을 특정할 수 없는 막힌 문서가 있습니다.");
    process.exit(1);
  }
  const skippedBranches = blockedBranchNames(blocked);

  // 지점 하나 = 트랜잭션 하나. 한 지점의 여러 달은 전부 써지거나 전부 안 써진다.
  const byBranch = new Map();
  for (const entry of existing) {
    if (entry.changes.length === 0 || skippedBranches.has(entry.branchName)) continue;
    if (!byBranch.has(entry.branchName)) byBranch.set(entry.branchName, []);
    byBranch.get(entry.branchName).push(entry);
  }

  if (skippedBranches.size > 0) {
    console.error(`\n건너뛰는 지점 ${skippedBranches.size}곳 (마감 상태 해제 후 다시 실행): ${[...skippedBranches].join(", ")}`);
  }
  if (byBranch.size === 0) {
    console.error("\n중단: 손댈 수 있는 지점이 하나도 없습니다.");
    process.exit(1);
  }

  const plannedDocs = [...byBranch.values()].flat();
  console.log(`\n■ 거래처명 통일 (${byBranch.size}개 지점 / ${plannedDocs.length}개 문서 / ${plannedDocs.reduce((a, p) => a + p.changes.length, 0)}행)\n`);
  for (const [branchName, entries] of byBranch) {
    console.log(`  [${branchName}]`);
    for (const entry of entries) {
      console.log(`    ${entry.month}`);
      for (const change of entry.changes) console.log(`      ${JSON.stringify(change.from).padEnd(22)} → ${change.to}`);
    }
  }

  if (!commit) {
    console.log("\n[dry-run] 아무것도 쓰지 않았습니다. 실제로 반영하려면 --commit 을 붙여 실행하세요.");
    process.exit(skippedBranches.size > 0 ? 1 : 0);
  }

  // 되돌리기 기록은 '되돌릴 수 없는 쓰기'보다 먼저 디스크에 남긴다. 커밋 직후 프로세스가 죽어도
  // 기록이 남아 있도록. 대신 각 항목에 '변경 후 기대값(expectedAfter)'을 함께 적어,
  // revert-backup.mjs 가 현재 값이 그 기대값일 때만 복구하게 한다.
  //   - 트랜잭션이 건너뛴 문서  → 현재 값 ≠ 기대값 → 복구 대상에서 제외 (지점의 최신 편집을 덮지 않는다)
  //   - 커밋 뒤 지점이 또 고친 문서 → 현재 값 ≠ 기대값 → 복구 거부
  // 미리 다 써두면서도 낡은 값을 덮어쓰지 않는 유일한 방법이다.
  mkdirSync(resolve(SCRIPT_DIR, "backups"), { recursive: true });
  // pid 는 타임스탬프 '앞'에 넣는다. revert-backup 의 순서 가드가 파일명 끝의 -(숫자10자리+).json 을 읽기 때문이다.
  const backupPath = resolve(SCRIPT_DIR, "backups", `rename-backup-${months.join("_")}-p${process.pid}-${Date.now()}.json`);
  const backupEntries = [];
  // 같은 경로를 반복해서 통째로 다시 쓰면, 쓰기 도중 죽었을 때 이미 반영된 앞 지점의 백업까지 깨진다.
  // 임시 파일에 쓰고 fsync 한 뒤 원자적으로 이름을 바꾼다.
  const saveBackup = () => {
    // pid 를 섞어 동시에 두 번 실행돼도 임시파일이 겹치지 않게 한다. (.tmp 는 revert 의 .json 스캔에 안 걸린다)
    const tempPath = `${backupPath}.${process.pid}.tmp`;
    writeFileSync(tempPath, JSON.stringify({ months, entries: backupEntries }, null, 2), "utf-8");
    const handle = openSync(tempPath, "r+");
    try { fsyncSync(handle); } finally { closeSync(handle); }
    renameSync(tempPath, backupPath);
  };

  const now = new Date().toISOString();
  const failures = [];
  const written = [];
  for (const [branchName, entries] of byBranch) {
    // entry.rows 는 previous 로부터 결정적으로 계산된 값이고, 트랜잭션은 current === previous 를
    // 확인한 뒤에만 쓴다. 따라서 실제로 써지는 값과 expectedAfter 는 항상 같다.
    for (const entry of entries) backupEntries.push({ dataKey: entry.dataKey, previous: entry.previous, expectedAfter: entry.rows });
    saveBackup();

    try {
      await runTransaction(db, async (transaction) => {
        // 트랜잭션 규칙: 읽기를 모두 끝낸 뒤 쓴다. 본문은 재시도될 수 있으므로 부작용을 두지 않는다.
        const snaps = [];
        for (const entry of entries) snaps.push(await transaction.get(sharedRef(entry.dataKey)));

        const writes = [];
        for (const [index, entry] of entries.entries()) {
          const snap = snaps[index];
          if (!snap.exists()) throw new Error(`${entry.month}: 문서가 사라졌습니다`);
          const current = snap.data().value;

          // 계획 이후 지점이 값을 바꿨다면 이 지점 전체를 포기한다. 백업이 낡아 되돌리기도 부정확해진다.
          if (!deepEqual(current, entry.previous)) {
            throw new Error(`${entry.month}: 계획 이후 지점이 문서를 수정했습니다 — 다시 실행하세요`);
          }

          const { rows, changes, unknown } = renameRows(current);
          if (unknown.length > 0) throw new Error(`${entry.month}: 표에 없는 비알 거래처 ${unknown.join(", ")}`);
          if (changes.length === 0) throw new Error(`${entry.month}: 바꿀 행이 없습니다 (이미 통일됨)`);
          if (!rowsMatchExceptVendor(current, rows)) throw new Error(`${entry.month}: vendorName 외 필드가 변형됨 — 쓰기 취소`);
          writes.push({ entry, rows });
        }

        for (const { entry, rows } of writes) transaction.update(sharedRef(entry.dataKey), { value: rows, updatedAt: now });
      });

      written.push(...entries);
      console.log(`  쓰기 완료  ${branchName} (${entries.map((e) => `${e.month} ${e.changes.length}행`).join(", ")})`);
    } catch (error) {
      failures.push({ branchName, reason: error?.message ?? String(error) });
      console.error(`  쓰기 취소  ${branchName} — ${error?.message ?? error}`);
    }
  }

  console.log(`\n백업 파일: ${backupPath} (기록 ${backupEntries.length}개 / 실제 반영 ${written.length}개)`);

  console.log("\n■ 재조회 검증");
  let bad = 0;
  for (const entry of written) {
    const actual = await readShared(entry.dataKey);
    const named = allVendorsCanonical(actual);
    const intact = rowsMatchExceptVendor(entry.previous, actual);
    if (!(named && intact)) bad++;
    console.log(`  ${named && intact ? "OK  " : "실패"} ${`${entry.branchName} · ${entry.month}`.padEnd(28)} ${named ? "이름 통일됨" : "이름 이상"} / ${intact ? "나머지 필드 보존" : "필드 변형 감지"}`);
  }

  if (failures.length > 0) {
    console.error(`\n쓰지 못한 지점 ${failures.length}곳`);
    for (const f of failures) console.error(`  ${f.branchName} — ${f.reason}`);
  }
  if (skippedBranches.size > 0) console.error(`\n재실행 필요 지점: ${[...skippedBranches].join(", ")}`);
  if (written.length > 0) console.log(`\n되돌리려면: node scripts/revert-backup.mjs "${backupPath}" --commit`);

  const incomplete = bad > 0 || failures.length > 0 || skippedBranches.size > 0;
  console.log(incomplete ? "\n일부만 반영됐습니다. 위 목록을 확인하세요." : "\n전체 검증 통과.");
  process.exit(incomplete ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
