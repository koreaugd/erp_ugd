/**
 * 04 에이전트 db파일.xlsx(손익DB) + 05 branches.xlsx(지점운영) → Firestore shared_data `analysis_pnl_db` 쓰기.
 *
 *   node scripts/seed-analysis-pnl.mjs             # dry-run (기본, 아무것도 안 씀)
 *   node scripts/seed-analysis-pnl.mjs --commit    # 실제 쓰기 + 기존값 백업 + 재조회 검증
 *
 * 관리자 > 분석 > 월간 손익 분석 탭의 데이터 원천을 만든다. 이후 매월 갱신은 화면의
 * 'db파일 업로드' 버튼(브라우저에서 같은 형식으로 파싱해 같은 키에 저장)이 담당하고,
 * 이 스크립트는 초기 적재/복구용이다.
 *
 * 원본 폴더(04·05 에이전트)는 읽기 전용으로만 접근한다 — 절대 수정 금지(사용자 지시).
 * 되돌리기: scripts/revert-backup.mjs <backup.json> --commit
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDocFromServer, setDoc } from "firebase/firestore";
import * as XLSX from "xlsx";

import config from "../firebase-applet-config.json" with { type: "json" };
import { signInAsAdmin } from "./lib/admin-auth.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const UGD_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DB_XLSX = resolve(UGD_ROOT, "02. 재무 회계", "04. AGENT_DB업데이트", "db파일.xlsx");
const BRANCHES_XLSX = resolve(UGD_ROOT, "02. 재무 회계", "05. AGENT_대시보드 생성", "branches.xlsx");
const DATA_KEY = "analysis_pnl_db";

const commit = process.argv.includes("--commit");

// ── 1. 손익DB 읽기 ──────────────────────────────────────────
const dbWb = XLSX.read(readFileSync(DB_XLSX));
const dbSheet = dbWb.Sheets["손익DB"];
if (!dbSheet) { console.error("손익DB 시트가 없습니다:", dbWb.SheetNames); process.exit(1); }
const rawRows = XLSX.utils.sheet_to_json(dbSheet, { defval: null });

// 컬럼명이 바뀌면 조용히 0으로 채워지는 사고를 막기 위해 필수 컬럼을 못 박는다.
const REQUIRED_COLUMNS = ["년도", "월", "지점", "메뉴매출", "주류매출", "배달/기타매출", "총매출", "임대료", "식재료", "주류원가", "인건비", "공과금", "기타비용", "광고비", "세금예비", "수수료", "특별지출", "특별지출비고", "총지출", "이익금", "영수건수", "객단가"];
const firstRow = rawRows[0] || {};
const missingColumns = REQUIRED_COLUMNS.filter((c) => !(c in firstRow));
if (missingColumns.length) { console.error("손익DB에 필수 컬럼이 없습니다:", missingColumns); process.exit(1); }

const num = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
// 화면(pnlDb.ts)이 그대로 쓰는 정규화 행. 키를 영문으로 바꾸지 않고 원본 한글 컬럼명을 유지한다 —
// 사용자가 매월 업로드하는 파일과 1:1 대응이 눈으로 확인돼야 한다.
const rows = rawRows
  .filter((r) => r["지점"] && r["년도"] && r["월"])
  .map((r) => ({
    month: `${r["년도"]}-${String(r["월"]).padStart(2, "0")}`,
    지점: String(r["지점"]).trim(),
    메뉴매출: num(r["메뉴매출"]), 주류매출: num(r["주류매출"]), "배달/기타매출": num(r["배달/기타매출"]),
    총매출: num(r["총매출"]),
    임대료: num(r["임대료"]), 식재료: num(r["식재료"]), 주류원가: num(r["주류원가"]), 인건비: num(r["인건비"]),
    공과금: num(r["공과금"]), 기타비용: num(r["기타비용"]), 광고비: num(r["광고비"]),
    세금예비: num(r["세금예비"]), 수수료: num(r["수수료"]), 특별지출: num(r["특별지출"]),
    특별지출비고: String(r["특별지출비고"] || ""),
    총지출: num(r["총지출"]), 이익금: num(r["이익금"]),
    영수건수: num(r["영수건수"]), 객단가: num(r["객단가"]),
  }));

// ── 2. 지점운영(테이블수·월휴무일수) 읽기 — 회전율 계산용 ──────────
const brWb = XLSX.read(readFileSync(BRANCHES_XLSX));
const opsSheet = brWb.Sheets["지점운영"];
const branchOps = {};
if (opsSheet) {
  XLSX.utils.sheet_to_json(opsSheet, { defval: null }).forEach((r) => {
    const name = String(r["지점명"] || "").trim();
    if (name) branchOps[name] = { tables: num(r["테이블수"]), restDays: num(r["월휴무일수"]) };
  });
}

// ── 3. 요약 출력 + 대사 ─────────────────────────────────────
const monthsSet = [...new Set(rows.map((r) => r.month))].sort();
const branchSet = [...new Set(rows.map((r) => r.지점))];
const latest = monthsSet[monthsSet.length - 1];
const latestRows = rows.filter((r) => r.month === latest);
console.log(`손익DB: ${rows.length}행 · ${monthsSet[0]} ~ ${latest} · 지점 ${branchSet.length}곳`);
console.log(`최신월(${latest}) ${latestRows.length}곳 총매출 합: ${latestRows.reduce((s, r) => s + r.총매출, 0).toLocaleString("ko-KR")}원`);
console.log(`지점운영: ${Object.keys(branchOps).length}곳 (테이블수·휴무일)`);
const noOps = branchSet.filter((b) => b !== "본사" && !branchOps[b]);
if (noOps.length) console.log(`[주의] 지점운영에 없는 지점(회전율 계산 불가로 '—' 표시됨): ${noOps.join(", ")}`);

const payload = {
  rows,
  branchOps,
  uploadedAt: new Date().toISOString(),
  uploadedBy: "seed-analysis-pnl.mjs (04 db파일.xlsx 직접 적재)",
};
const payloadKb = Math.round(JSON.stringify(payload).length / 1024);
console.log(`문서 크기: ${payloadKb}KB (Firestore 한도 1024KB)`);
if (payloadKb > 900) { console.error("문서가 한도에 근접합니다. 분할이 필요합니다."); process.exit(1); }

if (!commit) {
  console.log("\n[dry-run] 아무것도 쓰지 않았습니다. 실제 쓰기: node scripts/seed-analysis-pnl.mjs --commit");
  process.exit(0);
}

// ── 4. 쓰기 (백업 → setDoc → 재조회 검증) ─────────────────────
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);
await signInAsAdmin(app);
const ref = doc(db, "shared_data", encodeURIComponent(DATA_KEY));

const before = await getDocFromServer(ref);
const backupPath = resolve(SCRIPT_DIR, "backups", `analysis_pnl_db-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
mkdirSync(dirname(backupPath), { recursive: true });
writeFileSync(backupPath, JSON.stringify({ dataKey: DATA_KEY, existed: before.exists(), value: before.exists() ? before.data().value ?? null : null }, null, 2));
console.log(`기존값 백업: ${backupPath} (기존 문서 ${before.exists() ? "있음" : "없음"})`);

await setDoc(ref, { value: payload, updatedAt: new Date().toISOString(), updatedBy: "seed-analysis-pnl" });

const after = await getDocFromServer(ref);
const savedRows = after.data()?.value?.rows;
if (!Array.isArray(savedRows) || savedRows.length !== rows.length) {
  console.error(`재조회 검증 실패: 저장 ${savedRows?.length}행 ≠ 원본 ${rows.length}행`);
  process.exit(1);
}
console.log(`\n완료: shared_data/${DATA_KEY} 에 ${savedRows.length}행 저장·재조회 일치.`);
process.exit(0);
