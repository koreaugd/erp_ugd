/**
 * 매입매출 시드가 지점 기기의 옛 캐시에 덮어써졌는지 감지한다. (읽기 전용, 아무것도 쓰지 않음)
 *
 *   node scripts/check-purchase-seed.mjs 2026-06 2026-07                 # 상시 점검
 *   node scripts/check-purchase-seed.mjs 2026-06 2026-07 --expect-blank  # 시드 직후 점검
 *
 * 왜 필요한가:
 *   MonthlyPurchaseSalesSubTab 은 지점 기기에 '미저장 편집(pending)' 플래그가 남아 있으면
 *   서버 값을 무시하고 localStorage 를 서버로 밀어올린다(같은 파일 134-140행, 176-180행).
 *   이는 지점의 미저장 편집을 지키기 위한 의도된 동작이라 서버 쪽에서는 막을 수 없다.
 *   따라서 "덮어써졌는지"를 사후에 감지하는 수단이 필요하다.
 *
 * 점검 대상은 하드코딩하지 않고 public_branches 의 활성 지점을 읽어 정한다.
 *   - SEEDED_BRANCHES        : 엑셀로 시드한 지점 → 전체 검사
 *   - KNOWN_UNSEEDED_BRANCHES: 거래처 데이터가 없는 지점 → 샘플 부활 여부만 검사
 *   - 둘 다 아닌 활성 지점    : '문제'로 보고한다. 지점이 새로 생겼는데 점검에서 조용히 빠지는 것을 막는다.
 *
 * 항상 '문제'로 보는 것 (exit 1)
 *   - 점검 목록에 없는 활성 지점이 있다
 *   - 시드 지점의 두 달 중 한쪽 문서가 없거나 비었다
 *   - 어느 지점에서든 옛 샘플 거래처명이 되살아났다
 *   - 시드 지점의 다음 달 거래처·계좌 목록이 이번 달과 다르다
 *
 * 다음 달 금액이 비어 있지 않은 경우
 *   - --expect-blank 를 주면 '문제'로 본다. 시드 직후엔 반드시 공란이어야 하기 때문이다.
 *   - 플래그가 없으면 '알림'으로만 보고한다. 지점이 이번 달 금액을 채우기 시작하면 정상이다.
 *     (조용히 통과시키지 않고, 마지막 줄에 몇 개 지점이 입력 중인지 반드시 출력한다.)
 */
import { pathToFileURL } from "node:url";

/** 2026-06 엑셀로 시드한 지점. 이름은 public_branches 의 branchName 과 정확히 일치해야 한다. */
export const SEEDED_BRANCHES = [
  "대물섬 종로점", "연하동 연남본점", "사카바단단", "강남대골뼈국", "마음죽", "남산광어",
  "대학로고래", "연하동 대학로점", "오키스테이크하우스", "카츠스위스", "카라멘야", "대물섬 한남점",
];

/** 거래처 이체리스트에 없어 시드하지 않은 활성 지점. 새 지점을 여기 넣으려면 의식적으로 판단할 것. */
export const KNOWN_UNSEEDED_BRANCHES = ["8번대물집", "금샤빠", "본사"];

// 과거 테스트 잔재. 다시 나타나면 지점 기기 캐시가 서버를 덮은 것이다.
export const SAMPLE_VENDORS = ["주식회사 식자재창고", "드림 물류 (선입금 업체)", "드림 물류"];

const AMOUNT_FIELDS = ["transferAmount", "prepaidChargeAmount", "monthlyUsageAmount"];

export const identity = (rows) => rows.map((r) => `${r.category}|${r.vendorName}|${r.accountNumber}`).join("\n");
export const sumTransfer = (rows) => (Array.isArray(rows) ? rows.reduce((acc, r) => acc + (Number(r.transferAmount) || 0), 0) : 0);
export const revivedSamples = (rows) => rows.filter((r) => SAMPLE_VENDORS.includes(String(r.vendorName || "").trim()));
export const rowsWithAmount = (rows) => rows.filter((r) => AMOUNT_FIELDS.some((f) => String(r[f] ?? "").trim() !== ""));

/** 지점 한 곳의 두 달 치 문서를 검사한다. Firestore 를 모르는 순수 함수라 단위 검증이 가능하다. */
export function inspectBranch({ branchName, month, nextMonth, current, next, expectBlank = false }) {
  const problems = [];
  const notices = [];

  if (!Array.isArray(current) || current.length === 0) problems.push(`${branchName}: ${month} 문서가 비었거나 없음`);
  if (!Array.isArray(next) || next.length === 0) problems.push(`${branchName}: ${nextMonth} 문서가 비었거나 없음`);

  for (const [label, rows] of [[month, current], [nextMonth, next]]) {
    if (!Array.isArray(rows)) continue;
    const revived = revivedSamples(rows);
    if (revived.length > 0) problems.push(`${branchName}: ${label} 에 옛 샘플 거래처 부활 → ${revived.map((r) => r.vendorName).join(", ")}`);
  }

  if (Array.isArray(current) && Array.isArray(next)) {
    if (identity(current) !== identity(next)) problems.push(`${branchName}: ${nextMonth} 거래처·계좌 목록이 ${month} 과 다름`);

    const typed = rowsWithAmount(next);
    if (typed.length > 0) {
      const detail = `${branchName}: ${nextMonth} 에 금액이 입력된 행 ${typed.length}건 (${typed.slice(0, 3).map((r) => r.vendorName).join(", ")}${typed.length > 3 ? " 외" : ""})`;
      if (expectBlank) problems.push(`${detail} — 시드 직후에는 전부 공란이어야 함`);
      else notices.push(detail);
    }
  }

  return { problems, notices };
}

/** 시드하지 않은 지점: 문서가 없는 게 정상이므로 샘플 부활만 본다. */
export function inspectUnseededBranch({ branchName, months }) {
  const problems = [];
  const notices = [];
  for (const [label, rows] of months) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const revived = revivedSamples(rows);
    if (revived.length > 0) problems.push(`${branchName}: ${label} 에 옛 샘플 거래처 부활 → ${revived.map((r) => r.vendorName).join(", ")}`);
    else notices.push(`${branchName}: ${label} 에 시드하지 않은 거래처 ${rows.length}행이 있음 (지점이 직접 입력한 것으로 보임)`);
  }
  return { problems, notices };
}

/** 활성 지점을 점검 카테고리로 나눈다. 어느 쪽에도 없으면 unknown — 조용히 넘어가면 안 된다. */
export function partitionBranches(activeBranchNames, seeded = SEEDED_BRANCHES, knownUnseeded = KNOWN_UNSEEDED_BRANCHES) {
  const active = new Set(activeBranchNames);
  return {
    seeded: seeded.filter((b) => active.has(b)),
    unseeded: knownUnseeded.filter((b) => active.has(b)),
    unknown: activeBranchNames.filter((b) => !seeded.includes(b) && !knownUnseeded.includes(b)),
    missing: seeded.filter((b) => !active.has(b)),
  };
}

// ---------------------------------------------------------------- CLI
async function main() {
  const { initializeApp } = await import("firebase/app");
  const { getFirestore, doc, getDocFromServer, collection, getDocs } = await import("firebase/firestore");
  const { default: config } = await import("../firebase-applet-config.json", { with: { type: "json" } });
  const { signInAsAdmin } = await import("./lib/admin-auth.mjs");

  const args = process.argv.slice(2);
  const expectBlank = args.includes("--expect-blank");
  const [month, nextMonth] = args.filter((a) => !a.startsWith("--"));
  if (!month || !nextMonth) {
    console.error("사용법: node scripts/check-purchase-seed.mjs <이번달> <다음달> [--expect-blank]");
    process.exit(1);
  }

  const app = initializeApp(config);
  const db = getFirestore(app, config.firestoreDatabaseId);
  await signInAsAdmin(app);
  const read = async (dataKey) => {
    const snapshot = await getDocFromServer(doc(db, "shared_data", encodeURIComponent(dataKey)));
    return snapshot.exists() ? snapshot.data().value ?? null : undefined;
  };

  // 점검 대상을 하드코딩하지 않는다: 활성 지점을 실시간으로 읽어 분류한다.
  const snapshot = await getDocs(collection(db, "public_branches"));
  const activeBranchNames = snapshot.docs.map((d) => d.data()).filter((b) => b?.branchName && b.isActive !== false).map((b) => b.branchName);
  const groups = partitionBranches(activeBranchNames);

  const problems = [];
  const notices = [];
  for (const branchName of groups.unknown) {
    problems.push(`${branchName}: 점검 목록에 없는 활성 지점 — 시드 대상인지 판단한 뒤 SEEDED_BRANCHES 또는 KNOWN_UNSEEDED_BRANCHES 에 추가하세요`);
  }
  for (const branchName of groups.missing) {
    problems.push(`${branchName}: 시드한 지점인데 public_branches 에 활성 상태로 없음 (이름 변경 또는 비활성화?)`);
  }

  console.log(`${expectBlank ? "[시드 직후 점검: 다음 달 금액은 전부 공란이어야 함]\n" : ""}`);
  console.log(`활성 지점 ${activeBranchNames.length}곳 = 시드 ${groups.seeded.length} + 미시드 ${groups.unseeded.length} + 미분류 ${groups.unknown.length}\n`);
  console.log(`${"지점".padEnd(18)} ${month.padStart(20)}   ${nextMonth.padStart(12)}`);
  console.log("-".repeat(60));

  for (const branchName of groups.seeded) {
    const current = await read(`monthly_purchases:${branchName}:${month}`);
    const next = await read(`monthly_purchases:${branchName}:${nextMonth}`);
    const result = inspectBranch({ branchName, month, nextMonth, current, next, expectBlank });
    problems.push(...result.problems);
    notices.push(...result.notices);

    const fmt = (rows) => (Array.isArray(rows) ? `${rows.length}행` : "문서없음");
    console.log(`${branchName.padEnd(18)} ${`${fmt(current)} / ${sumTransfer(current).toLocaleString()}원`.padStart(20)}   ${fmt(next).padStart(12)}`);
  }

  // 시드하지 않은 활성 지점도 샘플 부활 여부는 본다.
  for (const branchName of [...groups.unseeded, ...groups.unknown]) {
    const current = await read(`monthly_purchases:${branchName}:${month}`);
    const next = await read(`monthly_purchases:${branchName}:${nextMonth}`);
    const result = inspectUnseededBranch({ branchName, months: [[month, current], [nextMonth, next]] });
    problems.push(...result.problems);
    notices.push(...result.notices);

    const fmt = (rows) => (Array.isArray(rows) ? `${rows.length}행` : "문서없음");
    console.log(`${`(미시드) ${branchName}`.padEnd(18)} ${fmt(current).padStart(20)}   ${fmt(next).padStart(12)}`);
  }

  if (notices.length > 0) {
    console.log(`\n알림 ${notices.length}건 (문제는 아니지만 알아둘 것)`);
    for (const n of notices) console.log(`  · ${n}`);
  }

  if (problems.length === 0) {
    console.log(`\n이상 없음: 활성 지점 전부 분류됨, 두 달 문서 정상, 샘플 거래처 부활 없음, 이월 거래처 일치.${notices.length > 0 ? ` (알림 ${notices.length}건)` : ""}`);
    process.exit(0);
  }
  console.log(`\n문제 ${problems.length}건`);
  for (const p of problems) console.log(`  - ${p}`);
  console.log("\n덮어써진 지점이 있으면 시드를 다시 실행하세요 (기존 백업은 그대로 두고 새 백업이 생깁니다).");
  process.exit(1);
}

// 직접 실행일 때만 CLI 를 돌린다. 순수 함수만 가져다 쓰는 import 는 Firestore 에 접속하지 않는다.
// process.argv[1] 은 `node -e` 나 REPL 에서 undefined 이므로 반드시 먼저 확인해야 한다.
const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryPoint && import.meta.url === entryPoint) await main();
