/**
 * 지점 직원명부(branch_own_rosters / staff_rosters) 덤프. (읽기 전용)
 * 급여대장과 달리 이 컬렉션은 canAccessWork() 만 통과하면 읽힌다.
 *
 *   node scripts/dump-branch-rosters.mjs <출력.json>
 */
import { writeFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocsFromServer } from "firebase/firestore";
import config from "../firebase-applet-config.json" with { type: "json" };
import { signInAsAdmin } from "./lib/admin-auth.mjs";

const [outPath] = process.argv.slice(2);
if (!outPath) { console.error("사용법: node scripts/dump-branch-rosters.mjs <출력.json>"); process.exit(1); }

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);
await signInAsAdmin(app);

const out = { own: {}, staff: {} };
for (const [key, col] of [["own", "branch_own_rosters"], ["staff", "staff_rosters"]]) {
  const snap = await getDocsFromServer(collection(db, col));
  for (const d of snap.docs) {
    const data = d.data();
    const branchName = data.branchName || decodeURIComponent(d.id);
    out[key][branchName] = Array.isArray(data.employees) ? data.employees : [];
  }
}

console.log(`${"지점".padEnd(18)}${"own전체".padStart(8)}${"own파트".padStart(8)}${"staff전체".padStart(10)}`);
console.log("-".repeat(46));
for (const branchName of Object.keys(out.own).sort()) {
  const own = out.own[branchName] || [];
  const pt = own.filter((e) => e?.division === "파트타이머");
  console.log(`${branchName.padEnd(18)}${String(own.length).padStart(8)}${String(pt.length).padStart(8)}${String((out.staff[branchName] || []).length).padStart(10)}`);
}

writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
console.log(`\n저장: ${outPath}`);
process.exit(0);
