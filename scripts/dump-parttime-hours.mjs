/**
 * 파트타이머 '실시간 누적시간'을 화면과 같은 방법으로 다시 집계한다. (읽기 전용)
 *
 *   node scripts/dump-parttime-hours.mjs 2026-07 <출력.json>
 *
 * 급여대장 화면(MonthlyPartTimeSalarySubTab)은 저장된 accumulatedHours 를 쓰지 않고
 * 매번 일일마감(daily_settles) 의 memo METADATA staffRows 에서 다시 더한다.
 * 그래서 shared_data 에 저장된 값만 보면 '대장을 마지막으로 연 시점'의 낡은 스냅샷을 보게 된다.
 * 이 스크립트는 화면과 같은 규칙으로 집계해, 엑셀과 견줄 수 있는 값을 만든다.
 *   - staffRows 중 division === "파트타이머" 이고 workHours > 0 인 것만
 *   - manual_parttime:{지점} 의 수기 근무도 같은 규칙으로 합산
 */
import { writeFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, getDocsFromServer, getDocFromServer } from "firebase/firestore";
import config from "../firebase-applet-config.json" with { type: "json" };
import { signInAsPersonalAdmin } from "./lib/admin-auth.mjs";

const [month, outPath] = process.argv.slice(2);
if (!month || !outPath) { console.error("사용법: node scripts/dump-parttime-hours.mjs <YYYY-MM> <출력.json>"); process.exit(1); }

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);
await signInAsPersonalAdmin(app);

const settles = await getDocsFromServer(collection(db, "daily_settles"));
const byBranch = {};   // 지점 → 이름 → { hours, dates:Set }

let scanned = 0;
for (const d of settles.docs) {
  const rec = d.data();
  const settleDate = String(rec?.settleDate || rec?.master?.settleDate || "");
  if (!settleDate.startsWith(month)) continue;
  const branchName = String(rec?.branchName || rec?.master?.branchName || "").trim();
  if (!branchName) continue;
  scanned++;

  const memo = String(rec?.memo ?? rec?.master?.memo ?? "");
  const parts = memo.split("\n---\nMETADATA:");
  if (!parts[1]) continue;
  let meta;
  try { meta = JSON.parse(parts[1].trim()); } catch { continue; }
  if (!meta?.staffRows) continue;

  const day = String(Number(settleDate.split("-")[2]));
  const bucket = (byBranch[branchName] ||= {});
  for (const s of meta.staffRows) {
    if (s?.division !== "파트타이머") continue;
    const hours = Number(s?.workHours || 0);
    if (!(hours > 0)) continue;
    const name = String(s?.name || "").trim();
    if (!name) continue;
    const item = (bucket[name] ||= { hours: 0, dates: [], manual: 0 });
    item.hours += hours;
    if (!item.dates.includes(day)) item.dates.push(day);
  }
}

// 수기 근무 합산 — 지점 목록을 읽어 각 지점의 manual_parttime 문서를 본다.
const branchSnap = await getDocsFromServer(collection(db, "public_branches"));
for (const b of branchSnap.docs.map((x) => x.data()).filter((x) => x?.branchName)) {
  const snap = await getDocFromServer(doc(db, "shared_data", encodeURIComponent(`manual_parttime:${b.branchName}`)));
  const rows = snap.exists() ? snap.data().value : null;
  if (!Array.isArray(rows)) continue;
  const bucket = (byBranch[b.branchName] ||= {});
  for (const row of rows) {
    const name = String(row?.staffName || "").trim();
    const hours = Number(row?.workHours || 0);
    const settleDate = String(row?.settleDate || "");
    if (!name || !(hours > 0) || settleDate.slice(0, 7) !== month) continue;
    const item = (bucket[name] ||= { hours: 0, dates: [], manual: 0 });
    item.hours += hours; item.manual += hours;
    const day = String(Number(settleDate.split("-")[2]));
    if (!item.dates.includes(day)) item.dates.push(day);
  }
}

console.log(`${month} 일일마감 ${scanned}건 스캔\n`);
console.log(`${"지점".padEnd(18)}${"인원".padStart(5)}${"시간합계".padStart(10)}${"수기분".padStart(9)}`);
console.log("-".repeat(43));
for (const branchName of Object.keys(byBranch).sort()) {
  const people = Object.values(byBranch[branchName]);
  console.log(`${branchName.padEnd(18)}${String(people.length).padStart(5)}${people.reduce((a, p) => a + p.hours, 0).toFixed(1).padStart(10)}${people.reduce((a, p) => a + p.manual, 0).toFixed(1).padStart(9)}`);
}

writeFileSync(outPath, JSON.stringify({ month, byBranch }, null, 2), "utf-8");
console.log(`\n저장: ${outPath}`);
process.exit(0);
