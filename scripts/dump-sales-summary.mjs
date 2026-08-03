/**
 * 매출집계(monthly_sales_summary) 현재 서버 값과 매출집계 마감상태를 내린다. (읽기 전용)
 *
 *   node scripts/dump-sales-summary.mjs 2026-07 <출력.json>
 */
import { writeFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDocFromServer, collection, getDocs } from "firebase/firestore";
import config from "../firebase-applet-config.json" with { type: "json" };
import { signInAsAdmin } from "./lib/admin-auth.mjs";

const [month, outPath] = process.argv.slice(2);
if (!month || !outPath) {
  console.error("사용법: node scripts/dump-sales-summary.mjs <YYYY-MM> <출력.json>");
  process.exit(1);
}

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);
await signInAsAdmin(app);

const read = async (dataKey) => {
  const snap = await getDocFromServer(doc(db, "shared_data", encodeURIComponent(dataKey)));
  return snap.exists() ? snap.data().value ?? null : undefined;
};

const snapshot = await getDocs(collection(db, "public_branches"));
const branches = snapshot.docs
  .map((d) => d.data())
  .filter((b) => b?.branchName && b.isActive !== false)
  .map((b) => b.branchName);

const closings = (await read("monthly_closings")) || [];
// 매출집계 섹션의 최신 마감 상태(없으면 미제출).
const sectionStatus = (branchName) => {
  const rec = (Array.isArray(closings) ? closings : [])
    .filter((r) => r.branchName === branchName && r.month === month && (r.section || "purchase") === "salesSummary")
    .sort((a, b) => String(b.updatedAt || b.confirmedAt || "").localeCompare(String(a.updatedAt || a.confirmedAt || "")))[0];
  return rec?.status || "pending";
};

const out = { month, branches, docs: {}, status: {} };
for (const branchName of branches) {
  const v = await read(`monthly_sales_summary:${branchName}:${month}`);
  out.docs[branchName] = v === undefined ? null : v;
  out.status[branchName] = sectionStatus(branchName);
  const filled = v && typeof v === "object"
    ? Object.entries(v).filter(([, x]) => String(x ?? "").trim() !== "").map(([k]) => k)
    : [];
  console.log(`${branchName.padEnd(20)} [${out.status[branchName].padEnd(9)}] ${v === undefined ? "문서없음" : `입력 ${filled.length}칸: ${filled.join(",")}`}`);
}

writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
console.log(`\n저장: ${outPath}`);
process.exit(0);
