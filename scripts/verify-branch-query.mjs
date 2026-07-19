/**
 * 읽기 최적화 안전성 검증(읽기 전용). 배포 전 필수.
 *
 * "지점 타깃 or() 쿼리" 결과가 "전체 스캔 후 필터" 결과와 **문서 집합이 완전히 동일**한지 확인한다.
 * 하나라도 다르면(레거시 문서 누락 등) 배포하면 안 된다 — 그게 곧 유실 재발이다.
 *
 *   node scripts/verify-branch-query.mjs                 # 전 지점 대조
 *   node scripts/verify-branch-query.mjs 8번대물집        # 특정 지점만
 *
 * 주의: 전체 스캔을 1회 하므로 읽기 한도를 약간 쓴다(백업 직후, 한도가 막 초기화된 창에서 실행).
 */
import { pathToFileURL } from "node:url";

const norm = (m) => (m?.branchName || m?.branch_name || "");

async function main() {
  const { initializeApp } = await import("firebase/app");
  const { getFirestore, collection, getDocsFromServer, query, where, or } = await import("firebase/firestore");
  const { default: config } = await import("../firebase-applet-config.json", { with: { type: "json" } });
  const { signInAsAdmin } = await import("./lib/admin-auth.mjs");

  const only = process.argv.slice(2).find((a) => !a.startsWith("--"));

  const app = initializeApp(config);
  const db = getFirestore(app, config.firestoreDatabaseId);
  await signInAsAdmin(app);

  // 1) 전체 스캔(현재 동작의 기준값)
  const allSnap = await getDocsFromServer(collection(db, "daily_settles"));
  const fullByBranch = new Map();
  for (const d of allSnap.docs) {
    const bn = norm(d.data().master || {});
    if (!fullByBranch.has(bn)) fullByBranch.set(bn, new Set());
    fullByBranch.get(bn).add(d.id);
  }
  console.log(`전체 스캔: ${allSnap.docs.length}건, 지점 ${fullByBranch.size}곳`);

  // 2) 지점별 or() 타깃 쿼리와 대조
  const branches = only ? [only] : [...fullByBranch.keys()].filter(Boolean);
  let ok = 0, bad = 0, totalTargetReads = 0;
  for (const bn of branches) {
    let targetIds;
    try {
      const q = query(collection(db, "daily_settles"),
        or(where("master.branchName", "==", bn), where("master.branch_name", "==", bn)));
      const snap = await getDocsFromServer(q);
      targetIds = new Set(snap.docs.map((d) => d.id));
      totalTargetReads += snap.docs.length;
    } catch (e) {
      console.log(`  [${bn}] 쿼리 실패 → ${String(e?.code || e?.message)}`);
      if (String(e?.code) === "failed-precondition") console.log("    ↳ 복합 인덱스 필요할 수 있음. 링크 확인 후 firestore.indexes.json 추가 또는 documentId 범위쿼리로 대체.");
      bad++;
      continue;
    }
    const full = fullByBranch.get(bn) || new Set();
    const missing = [...full].filter((id) => !targetIds.has(id));   // 타깃이 놓친 것(치명적)
    const extra = [...targetIds].filter((id) => !full.has(id));     // 타깃이 더 잡은 것(무해, filter로 정리됨)
    if (missing.length === 0) {
      ok++;
      console.log(`  ✓ ${String(bn).padEnd(18)} 전체 ${full.size}건 = 타깃 ${targetIds.size}건 (누락 0)${extra.length ? `, 여분 ${extra.length}` : ""}`);
    } else {
      bad++;
      console.log(`  ✗ ${String(bn).padEnd(18)} 전체 ${full.size}건, 타깃이 ${missing.length}건 누락! → 배포 금지`);
      console.log(`     누락 샘플: ${missing.slice(0, 3).join(", ")}`);
    }
  }

  console.log(`\n대조 결과: 일치 ${ok}곳 / 불일치 ${bad}곳`);
  console.log(`읽기 절감 추정: 관리자 전지점 조회 시 ${allSnap.docs.length * branches.length}건(현재) → ${totalTargetReads}건(타깃 합계)`);
  if (bad === 0) console.log("✅ 타깃 쿼리가 전체 스캔과 동일 — 읽기 최적화 안전.");
  else console.log("⛔ 불일치 있음 — 이대로 배포하면 유실 재발. 쿼리 설계 재검토 필요.");
  process.exit(bad === 0 ? 0 : 1);
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryPoint && import.meta.url === entryPoint) await main();
