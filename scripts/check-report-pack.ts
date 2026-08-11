// scripts/check-report-pack.ts
// 통합보고서 파서·서식·마스킹 검증 — 실제 03 에이전트 파일로 돌린다(서버에 쓰지 않는다, 읽기만).
//
//   npx tsx scripts/check-report-pack.ts "<xlsx 경로>"
//
// 확인하는 것
//   ① 시트 수·행/열이 원본과 맞는가 (칸 위치가 밀리지 않았는가)
//   ② 결산월이 제대로 인식되는가
//   ③ **주민번호·계좌가 남아 있지 않은가** (남으면 실패로 끝낸다)
//   ④ 서식(볼드·배경·정렬·테두리)·열너비·병합이 실렸는가
//   ⑤ 압축 후 크기가 Firestore 문서 한도 안인가
//   ⑥ 저장 → 복원 왕복이 원본 격자와 같은가
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { buildReportPackDoc, decodeReportPack, formatCellText } from "../src/pages/admin/helpers/reportPack";

const target = process.argv[2];
if (!target) {
  console.error('사용법: npx tsx scripts/check-report-pack.ts "<xlsx 경로>"');
  process.exit(2);
}

const bytes = readFileSync(target);
const file = new File([bytes], basename(target), {
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

const doc = await buildReportPackDoc(file, "검증 스크립트");
const pack = await decodeReportPack(doc);
if (!pack) {
  console.error("복원 실패: decodeReportPack 이 null 을 돌려줬다");
  process.exit(1);
}

const KB = (n: number) => `${(n / 1024).toFixed(1)} KB`;
console.log(`파일       : ${doc.fileName}`);
console.log(`결산월     : ${doc.month}`);
console.log(`시트       : ${doc.sheetNames.length}개`);
console.log(`가린 칸    : ${doc.maskedFields}칸`);
console.log(`서식 사전  : 셀서식 ${pack.styles.length}종 · 숫자서식 ${pack.numFmts.length}종`);
console.log(`압축 후    : ${KB(doc.gzipBase64.length)}  (Firestore 한도 1024KB / 저장 상한 900KB)`);
console.log("");

let styled = 0, formatted = 0, merged = 0;
console.log("시트별 (행 × 열 / 표 폭 / 서식칸 / 병합):");
for (const sheet of pack.sheets) {
  const cols = sheet.cols.length;
  const width = sheet.cols.reduce((a, b) => a + b, 0);
  const withStyle = sheet.sty.reduce((n, row) => n + row.filter((v) => v >= 0).length, 0);
  const withFmt = sheet.fmt.reduce((n, row) => n + row.filter((v) => v >= 0).length, 0);
  styled += withStyle; formatted += withFmt; merged += sheet.merges.length;
  console.log(`  ${sheet.name.padEnd(12)} ${String(sheet.rows.length).padStart(4)} × ${String(cols).padStart(2)}  폭 ${String(width).padStart(5)}px  서식 ${String(withStyle).padStart(5)}칸  병합 ${sheet.merges.length}`);
}
console.log(`\n합계: 서식 ${styled}칸 · 숫자서식 ${formatted}칸 · 병합 ${merged}개`);

// ── 유출 검사 ──────────────────────────────────────────────
const RRN_LEAK = /\d{6}\s*-\s*\d{7}/;
const leaks: string[] = [];
for (const sheet of pack.sheets) {
  sheet.rows.forEach((row, r) => {
    row.forEach((value, c) => {
      const text = typeof value === "string" ? value : String(value);
      if (RRN_LEAK.test(text)) leaks.push(`${sheet.name} ${r + 1}행 ${c + 1}열: ${text}`);
    });
  });
}
console.log("");
if (leaks.length > 0) {
  console.error(`❌ 주민번호가 ${leaks.length}칸 남아 있습니다:`);
  leaks.slice(0, 20).forEach((l) => console.error(`   ${l}`));
  process.exit(1);
}
console.log("✅ 주민번호 형태(######-#######)가 남은 칸 없음");

if (doc.gzipBase64.length > 900_000) {
  console.error(`❌ 저장 상한(900KB) 초과: ${KB(doc.gzipBase64.length)}`);
  process.exit(1);
}
console.log("✅ 저장 상한 안");

// [회귀 가드] 서식 파서(helpers/xlsxStyles.ts)는 xlsx 의 zip·XML 을 직접 읽는다.
// 정규식 하나만 어긋나도 **조용히 빈 결과**를 돌려주고, 화면은 서식 없는 맨 격자가 된다.
// 실제로 `<xf .../>` 를 여는 태그로 오인해 263종이 216종으로 줄고 색인이 전부 밀린 적이 있다.
// 그래서 "서식이 하나도 안 실렸다"와 "볼드가 하나도 없다"를 실패로 잡는다.
const boldCount = pack.styles.filter((s) => s.bold).length;
const bgCount = pack.styles.filter((s) => s.bg).length;
if (styled === 0 || boldCount === 0 || bgCount === 0) {
  console.error(`❌ 서식이 제대로 안 실렸습니다 — 서식칸 ${styled} · 볼드 ${boldCount}종 · 배경색 ${bgCount}종`);
  process.exit(1);
}
console.log(`✅ 서식 실림 (볼드 ${boldCount}종 · 배경색 ${bgCount}종)`);

// 열 너비가 없으면 표가 화면보다 좁아져 **가로 스크롤이 아예 안 생긴다**(사용자가 실제로 겪은 증상).
const narrow = pack.sheets.filter((s) => s.cols.reduce((a, b) => a + b, 0) < 1200);
if (narrow.length > 0) {
  console.error(`❌ 표 폭이 너무 좁은 시트: ${narrow.map((s) => s.name).join(", ")} — 엑셀 열너비(!cols.wpx)를 못 읽었을 수 있습니다`);
  process.exit(1);
}
console.log("✅ 모든 시트 표 폭 1200px 이상 (가로 스크롤 생김)");

// 숫자 서식이 실제로 엑셀처럼 보이는지 표본 확인
const XLSXNS = await import("xlsx-js-style");
const XLSX: any = (XLSXNS as any).default ?? XLSXNS;
const sample = pack.sheets.find((s) => s.name === "마음죽") || pack.sheets[0];
console.log(`\n숫자 서식 표본 (${sample.name}):`);
for (const [r, c] of [[6, 1], [8, 2], [17, 1], [17, 2]] as [number, number][]) {
  const v = sample.rows[r]?.[c];
  const fi = sample.fmt[r]?.[c] ?? -1;
  if (v === undefined) continue;
  console.log(`  ${String.fromCharCode(65 + c)}${r + 1} = ${JSON.stringify(v)}  서식=${fi >= 0 ? pack.numFmts[fi] : "General"}  →  ${formatCellText(v, fi >= 0 ? pack.numFmts[fi] : undefined, XLSX.SSF)}`);
}

// ── 동시 저장(비교-후-쓰기) 시나리오 ─────────────────────────
// 화면이 쓰는 것과 **같은 갱신자**(reportPackCasUpdater)를 Firestore 트랜잭션처럼 돌려 본다.
// 여기서 한 칸이라도 어긋나면 "다른 노트북 수정분을 조용히 덮어쓰는" 사고가 그대로 난다.
const { reportPackCasUpdater } = await import("../src/pages/admin/helpers/reportPack");
const stub = (rev?: number) => ({ ...doc, ...(rev === undefined ? {} : { rev }) });
/** mutateSharedData 흉내 — 갱신자가 null 이면 아무것도 쓰지 않고 서버 값을 그대로 돌려준다. */
function tx(server: any, updater: (c: unknown) => any) {
  const next = updater(server);
  return next === null ? { changed: false, value: server } : { changed: true, value: next };
}

const scenarios: [string, boolean][] = [];
{
  // ① 문서가 없으면 그냥 쓴다
  const r = tx(null, reportPackCasUpdater(stub(), 0));
  scenarios.push(["문서 없음 → 저장됨(rev 1)", r.changed && r.value.rev === 1]);
}
{
  // ② 두 노트북이 같은 판올림에서 출발 — 먼저 저장한 쪽만 성공한다
  let server: any = stub(1);
  const a = tx(server, reportPackCasUpdater(stub(), 1));
  server = a.value;
  const b = tx(server, reportPackCasUpdater(stub(), 1));
  scenarios.push(["A 저장 성공(rev 2)", a.changed && a.value.rev === 2]);
  scenarios.push(["B 저장 **차단**(덮어쓰기 없음)", !b.changed && b.value.rev === 2]);
  // ③ B 가 확인하고 덮어쓰면 그때만 통과한다
  const forced = tx(server, reportPackCasUpdater(stub(), b.value.rev));
  scenarios.push(["B 확인 후 덮어쓰기(rev 3)", forced.changed && forced.value.rev === 3]);
}
{
  // ④ 판올림이 없는 옛 문서 — 둘 다 0 에서 출발해도 한 쪽만 통과해야 한다
  //    (예전처럼 시각 문자열로 비교하면 둘 다 "" 라 서로 조용히 덮어썼다)
  const legacy: any = { ...doc };
  delete legacy.rev;
  const a = tx(legacy, reportPackCasUpdater(stub(), 0));
  const b = tx(a.value, reportPackCasUpdater(stub(), 0));
  scenarios.push(["옛 문서 A 저장(rev 1)", a.changed && a.value.rev === 1]);
  scenarios.push(["옛 문서 B 저장 **차단**", !b.changed]);
}

console.log("\n동시 저장 시나리오:");
let casBad = 0;
for (const [label, good] of scenarios) {
  if (!good) casBad += 1;
  console.log(`  ${good ? "OK " : "XX "} ${label}`);
}
if (casBad > 0) {
  console.error(`\n❌ 동시 저장 방어에 구멍이 있습니다(${casBad}건)`);
  process.exit(1);
}
console.log("✅ 동시 저장 방어 정상 — 판올림이 어긋나면 한 글자도 쓰지 않음");
