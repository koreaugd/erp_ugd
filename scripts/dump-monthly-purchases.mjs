/**
 * 매입매출(monthly_purchases) 현재 서버 값을 통째로 JSON 으로 내린다. (읽기 전용)
 *
 *   node scripts/dump-monthly-purchases.mjs 2026-07 <출력.json>
 */
import { writeFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDocFromServer, collection, getDocs } from "firebase/firestore";
import config from "../firebase-applet-config.json" with { type: "json" };
import { signInAsAdmin } from "./lib/admin-auth.mjs";

const [month, outPath] = process.argv.slice(2);
if (!month || !outPath) {
  console.error("사용법: node scripts/dump-monthly-purchases.mjs <YYYY-MM> <출력.json>");
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
const out = { month, branches, closings, docs: {} };

for (const branchName of branches) {
  const rows = await read(`monthly_purchases:${branchName}:${month}`);
  out.docs[branchName] = rows === undefined ? null : rows;
  const n = Array.isArray(rows) ? rows.length : 0;
  const filled = Array.isArray(rows)
    ? rows.filter((r) => ["transferAmount", "prepaidChargeAmount", "monthlyUsageAmount"].some((f) => String(r[f] ?? "").trim() !== "" && String(r[f]).trim() !== "0")).length
    : 0;
  console.log(`${branchName.padEnd(18)} ${rows === undefined ? "문서없음" : `${n}행`.padStart(6)}  금액입력 ${String(filled).padStart(3)}행`);
}

writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
console.log(`\n저장: ${outPath}`);
process.exit(0);
