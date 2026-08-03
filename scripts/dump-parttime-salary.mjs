/**
 * 파트타이머 급여대장 현재 서버 값 덤프. (읽기 전용)
 *
 *   node scripts/dump-parttime-salary.mjs 2026-07 <출력.json>
 */
import { writeFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDocFromServer, collection, getDocs } from "firebase/firestore";
import config from "../firebase-applet-config.json" with { type: "json" };
import { signInAsPersonalAdmin } from "./lib/admin-auth.mjs";

const [month, outPath] = process.argv.slice(2);
if (!month || !outPath) {
  console.error("사용법: node scripts/dump-parttime-salary.mjs <YYYY-MM> <출력.json>");
  process.exit(1);
}

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);
await signInAsPersonalAdmin(app);

const read = async (dataKey) => {
  const snap = await getDocFromServer(doc(db, "shared_data", encodeURIComponent(dataKey)));
  return snap.exists() ? snap.data().value ?? null : undefined;
};

const snapshot = await getDocs(collection(db, "public_branches"));
const branches = snapshot.docs.map((d) => d.data()).filter((b) => b?.branchName && b.isActive !== false).map((b) => b.branchName);

const out = { month, branches, salaries: {}, exclusions: {}, manual: {} };
const n = (v) => Number(String(v ?? "").replace(/[^\d.]/g, "")) || 0;

console.log(`${"지점".padEnd(18)}${"행".padStart(5)}${"이름있는행".padStart(10)}${"수기행".padStart(8)}${"급여합계".padStart(14)}${"제외".padStart(6)}`);
console.log("-".repeat(62));
for (const branchName of branches) {
  const rows = await read(`part_time_salaries:${branchName}:${month}`);
  const excl = await read(`part_time_salary_exclusions:${branchName}:${month}`);
  out.salaries[branchName] = rows === undefined ? null : rows;
  out.exclusions[branchName] = excl === undefined ? null : excl;

  const list = Array.isArray(rows) ? rows : [];
  const named = list.filter((r) => String(r?.name || "").trim() !== "");
  const manual = list.filter((r) => String(r?.employeeId || "").startsWith("manual-"));
  const total = named.reduce((a, r) => a + n(r.calculatedSalary), 0);
  console.log(
    `${branchName.padEnd(18)}${(rows === undefined ? "-" : String(list.length)).padStart(5)}${String(named.length).padStart(10)}` +
      `${String(manual.length).padStart(8)}${total.toLocaleString().padStart(14)}${String(Array.isArray(excl) ? excl.length : "-").padStart(6)}`
  );
}

for (const branchName of branches) {
  const m = await read(`manual_parttime:${branchName}`);
  out.manual[branchName] = m === undefined ? null : m;
}

writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
console.log(`\n저장: ${outPath}`);
process.exit(0);
