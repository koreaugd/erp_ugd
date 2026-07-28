/**
 * 일일마감 문서의 ID 규칙과 '내부 recordId' 일치 여부를 점검한다. (읽기 전용, 아무것도 쓰지 않음)
 *
 *   node scripts/check-daily-doc-ids.mjs
 *
 * 두 가지를 본다.
 *   1) 문서 ID == encodeURIComponent(master.branchName) + "--" + master.settleDate 인가?
 *      정규식(`.+--날짜`)으로 보면 인코딩하지 않은 ID(`대물섬 한남점--2026-06-23`)를 정상으로 오판한다.
 *      화면은 인코딩본으로만 찾으므로 실제 규칙으로 비교해야 한다(Codex 지적 2026-07-28).
 *   2) 문서 안의 recordId / master.recordId / master.record_id 가 문서 ID와 같은가?
 *      getDailyFormBootstrap 이 `recordId || id` 순으로 돌려주므로, 내부 값이 옛 ID면
 *      일일마감 상세조회가 없는 문서를 찾아가 실패한다.
 */
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocsFromServer } from "firebase/firestore";

import config from "../firebase-applet-config.json" with { type: "json" };
import { signInAsAdmin } from "./lib/admin-auth.mjs";

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);
await signInAsAdmin(app);

const canonicalId = (branchName, settleDate) => `${encodeURIComponent(branchName)}--${settleDate}`;

const snapshot = await getDocsFromServer(collection(db, "daily_settles"));
const idMismatch = [];
const recordIdMismatch = [];
const noMaster = [];

for (const item of snapshot.docs) {
  const data = item.data() || {};
  const master = data.master || {};
  const branchName = String(master.branchName || master.branch_name || "").trim();
  const settleDate = String(master.settleDate || master.settle_date || "").trim();

  if (!branchName || !settleDate) { noMaster.push(item.id); continue; }

  const want = canonicalId(branchName, settleDate);
  if (item.id !== want) idMismatch.push({ id: item.id, want, branchName, settleDate });

  const inner = [
    ["recordId", data.recordId],
    ["master.recordId", master.recordId],
    ["master.record_id", master.record_id]
  ].filter(([, value]) => value !== undefined && String(value) !== item.id);
  if (inner.length > 0) {
    recordIdMismatch.push({ id: item.id, branchName, settleDate, fields: inner.map(([k, v]) => `${k}=${v}`) });
  }
}

console.log(`\n전체 ${snapshot.size}건 점검\n`);
console.log(`■ 문서 ID가 규칙과 다른 것: ${idMismatch.length}건`);
for (const row of idMismatch.slice(0, 20)) {
  console.log(`   ${row.id}\n     → 규칙: ${row.want}  (${row.branchName} ${row.settleDate})`);
}
console.log(`\n■ 내부 recordId 가 문서 ID와 다른 것: ${recordIdMismatch.length}건`);
for (const row of recordIdMismatch.slice(0, 20)) {
  console.log(`   ${decodeURIComponent(row.id)} (${row.branchName} ${row.settleDate})`);
  console.log(`     ${row.fields.join(" / ")}`);
}
console.log(`\n■ 지점명/날짜가 비어 내용을 알 수 없는 문서: ${noMaster.length}건`);
for (const id of noMaster.slice(0, 20)) console.log(`   ${id}`);

const bad = idMismatch.length + recordIdMismatch.length + noMaster.length;
console.log(bad === 0 ? "\n이상 없음." : `\n확인 필요 ${bad}건.`);
process.exit(bad === 0 ? 0 : 1);
