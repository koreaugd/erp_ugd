/**
 * 비상 지점목록 ↔ 운영 대조 (읽기 전용). 지점을 추가·삭제·개명했으면 반드시 돌릴 것.
 *
 *   UGD_ADMIN_PIN=#### node scripts/verify-login-fallback.mjs
 *
 * 저장소에는 지점 목록을 못 읽을 때 쓰는 비상 목록이 두 개 있다.
 *   ① src/api/firebaseAuth.ts  LOGIN_BRANCH_FALLBACK   — 지점명 + 지점번호(로그인 계정)
 *   ② src/pages/BranchConfirmPage.tsx LOCAL_BRANCH_FALLBACK — 지점명만(선택지·캐시에 저장됨)
 *
 * 이 둘이 운영과 어긋나면 조용히 사고가 난다.
 *   · ①에서 번호가 틀리면 그 지점이 **남의 로그인 계정**을 쓴다.
 *   · ①에 지점이 빠지면 공통 PIN 변경이 그 지점의 Firebase 비밀번호를 안 바꿔,
 *     시트 해시만 새 PIN이 되고 그 지점만 로그인이 깨진다(시트↔Firebase split-brain).
 *   · ②에 없는 지점명이 있으면 장애 중에 **존재하지 않는 지점으로 작업**하게 되고,
 *     그 잘못된 목록이 세션 캐시에 저장된다.
 */
import { readFileSync } from "node:fs";

const EMAIL_OF = (branchId) => `branch-${branchId}@ugd-erp.example`;

function parseLoginFallback(src) {
  const block = src.split("const LOGIN_BRANCH_FALLBACK")[1].split("] as const)")[0];
  return [...block.matchAll(/\["([^"]+)",\s*"(\d+)"\]/g)].map((m) => ({ branchName: m[1], branchId: m[2] }));
}

function parseScreenFallback(src) {
  const block = src.split("const LOCAL_BRANCH_FALLBACK = [")[1].split("];")[0];
  return [...block.matchAll(/branchName:\s*"([^"]+)"/g)].map((m) => m[1]);
}

async function main() {
  const { initializeApp } = await import("firebase/app");
  const { getFirestore, collection, getDocsFromServer } = await import("firebase/firestore");
  const { signInAsAdmin } = await import("./lib/admin-auth.mjs");

  const loginFallback = parseLoginFallback(readFileSync(new URL("../src/api/firebaseAuth.ts", import.meta.url), "utf-8"));
  const screenFallback = parseScreenFallback(readFileSync(new URL("../src/pages/BranchConfirmPage.tsx", import.meta.url), "utf-8"));

  const config = JSON.parse(readFileSync(new URL("../firebase-applet-config.json", import.meta.url), "utf-8"));
  const app = initializeApp(config);
  const db = getFirestore(app, config.firestoreDatabaseId);
  await signInAsAdmin(app);

  const snap = await getDocsFromServer(collection(db, "public_branches"));
  const prod = snap.docs.map((d) => d.data()).filter((b) => b.isActive !== false);
  console.log(`운영 활성 지점 ${prod.length}개\n`);

  let fail = 0;
  const say = (ok, msg) => { if (!ok) fail++; console.log(`${ok ? "  ok  " : "  FAIL"} ${msg}`); };

  console.log("① 로그인 비상목록 (지점명·번호·로그인계정)");
  for (const f of loginFallback) {
    const hit = prod.find((p) => String(p.branchName).trim() === f.branchName);
    if (!hit) { say(false, `${f.branchName}: 운영에 없는 지점명`); continue; }
    say(String(hit.branchId) === f.branchId && hit.loginEmail === EMAIL_OF(f.branchId),
      `${f.branchName} → ${f.branchId} / ${EMAIL_OF(f.branchId)}`);
  }
  const missingLogin = prod.filter((p) => !loginFallback.some((f) => f.branchName === String(p.branchName).trim()));
  say(missingLogin.length === 0, `빠진 지점(공통 PIN 변경이 건너뜀): ${missingLogin.map((m) => m.branchName).join(", ") || "없음"}`);

  console.log("\n② 화면 비상목록 (지점명)");
  for (const name of screenFallback) {
    say(prod.some((p) => String(p.branchName).trim() === name), `${name}`);
  }
  const missingScreen = prod.filter((p) => !screenFallback.includes(String(p.branchName).trim()));
  say(missingScreen.length === 0, `빠진 지점: ${missingScreen.map((m) => m.branchName).join(", ") || "없음"}`);

  console.log("\n③ 두 목록의 맨 위(표시순서 확인)");
  const topProd = [...prod].sort((a, b) => {
    const ov = (x) => (x?.sortOrder === undefined || x?.sortOrder === null || x?.sortOrder === "" || !Number.isFinite(Number(x.sortOrder)) ? Number.MAX_SAFE_INTEGER : Number(x.sortOrder));
    return (ov(a) - ov(b)) || String(a.branchId ?? "").localeCompare(String(b.branchId ?? ""));
  })[0]?.branchName;
  say(loginFallback[0]?.branchName === topProd, `로그인 비상목록 맨 위 ${loginFallback[0]?.branchName} = 운영 ${topProd}`);
  say(screenFallback[0] === topProd, `화면 비상목록 맨 위 ${screenFallback[0]} = 운영 ${topProd}`);

  console.log(fail === 0 ? "\n전체 통과" : `\n실패 ${fail}건 — 비상목록을 운영에 맞춰 고칠 것`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
