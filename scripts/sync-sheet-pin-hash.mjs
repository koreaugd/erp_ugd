/**
 * 지점_설정 시트 + Firestore 미러 pin_hash 재지정(동기화) 도구.
 *
 * 배경: 로그인은 Firebase Auth(비밀번호=ugd-<PIN>)로 검증되지만, 지점 비즈니스택시 탭과
 * GAS 폴백 로그인은 구글시트(지점_설정)의 pin_hash 를 본다. 시트에 해시가 비어 있으면
 * "지점 인증에 실패했습니다"로 거부된다(2026-07-28 실측: 13행 중 정상 해시는 금샤빠·본사뿐).
 *
 * 시트만 고치면 안 되는 이유(Codex stop-time 지적, 2026-07-28):
 *   - restoreDirectFromFirebase 는 Firestore settings 문서의 pin_hash||"" 를 시트로 되밀고,
 *   - syncDirectToFirebase 는 시트 해시를 못 읽어(getBranchListAll 이 해시 미반환) 이름 키
 *     미러 문서가 없으면 pin_hash:"" 로 만든다.
 *   → 복원/동기화 한 번이면 시트 수리가 빈값으로 되돌아간다. 그래서 앱의 updateBranchPin 과
 *     동일하게 Firestore `settings/<지점명>` 미러에도 해시+전체 메타를 함께 기록한다.
 *
 * 동작(지점당):
 *   1) Firebase Auth 로그인으로 입력 PIN 이 현재 PIN 인지 검증  ← 틀린 PIN 은 아무것도 안 쓴다
 *   2) 프론트 hashPin 과 동일한 SHA-256(hex) 계산
 *   3) GAS updateBranchPin 액션으로 시트 pin_hash 갱신
 *   4) 관리자 계정으로 Firestore settings/<지점명> 미러 upsert(merge, 전체 메타 포함
 *      — merge 없는 setDoc 이 메타를 지우는 함정은 Codex P0 2026-07-27 참고)
 *
 * 사용:
 *   UGD_ADMIN_PIN=#### node scripts/sync-sheet-pin-hash.mjs "대물섬 종로점=1234" ...
 *   (UGD_ADMIN_PIN 없으면 ERP_ACCESS.md 폴백 — scripts/lib/admin-auth.mjs 규약)
 *   --dry-run : 검증만 하고 아무것도 기입하지 않음
 *   지점명 "관리자" 는 admin@ugd-erp.example 계정으로 검증한다(role=admin, brand=본사).
 */
import { createHash } from "node:crypto";

const ADMIN_EMAIL = "admin@ugd-erp.example";
const PAGES_ORIGIN = "https://koreaugd.github.io/erp_ugd/";

/**
 * GAS 웹앱 URL 확보 — 저장소에 URL을 두지 않는 규약(GitHub secrets VITE_GAS_URL) 유지.
 *   1) 환경변수 UGD_GAS_URL
 *   2) 배포된 프론트 번들에서 추출 — 빌드 시 주입된 현재 운영 URL이라, 웹앱을
 *      새 deployment 로 바꿔도 이 스크립트는 자동으로 따라간다(하드코딩 드리프트 방지).
 */
async function resolveGasUrl() {
  const fromEnv = String(process.env.UGD_GAS_URL || "").trim();
  if (fromEnv.includes("script.google.com")) return fromEnv;

  const indexHtml = await (await fetch(PAGES_ORIGIN)).text();
  const asset = indexHtml.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
  if (!asset) throw new Error("배포 프론트 index.html 에서 번들 경로를 찾지 못했습니다.");
  const bundle = await (await fetch(PAGES_ORIGIN + asset)).text();
  const url = bundle.match(/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/)?.[0];
  if (!url) throw new Error("배포 번들에서 GAS 웹앱 URL을 찾지 못했습니다. UGD_GAS_URL 환경변수로 지정하세요.");
  return url;
}

let GAS_URL = "";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const pairs = args.filter((a) => a !== "--dry-run").map((raw) => {
  const idx = raw.indexOf("=");
  if (idx <= 0) throw new Error(`형식 오류: "${raw}" — "지점명=PIN" 형태로 주세요.`);
  return { branchName: raw.slice(0, idx).trim(), pin: raw.slice(idx + 1).trim() };
});
if (!pairs.length) {
  console.log('사용법: node scripts/sync-sheet-pin-hash.mjs [--dry-run] "지점명=PIN" ...');
  process.exit(1);
}

const sha256Hex = (s) => createHash("sha256").update(String(s).trim(), "utf8").digest("hex");

async function callGas(action, params) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action, ...params }),
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`GAS HTTP ${res.status}`);
  const body = await res.json();
  if (!body.success) throw new Error(body.error || "GAS 액션 실패");
  return body.data;
}

async function main() {
  const { initializeApp } = await import("firebase/app");
  const { getAuth, signInWithEmailAndPassword, signOut } = await import("firebase/auth");
  const { getFirestore, collection, getDocs, doc, setDoc } = await import("firebase/firestore");
  const { default: config } = await import("../firebase-applet-config.json", { with: { type: "json" } });
  const { signInAsAdmin } = await import("./lib/admin-auth.mjs");

  GAS_URL = await resolveGasUrl();

  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, config.firestoreDatabaseId);

  // 지점명 → 로그인 이메일/브랜드 (public_branches 는 로그인 화면용 공개 목록)
  const snapshot = await getDocs(collection(db, "public_branches"));
  const metaByName = new Map();
  for (const d of snapshot.docs) {
    const b = d.data();
    if (b?.branchName && b?.loginEmail) {
      metaByName.set(String(b.branchName).trim(), { loginEmail: String(b.loginEmail), brand: String(b.brand || b.branchName) });
    }
  }

  // 1단계: PIN 검증만 먼저 전부 수행 — 틀린 지점은 목록에서 제외.
  const verified = [];
  const results = [];
  for (const { branchName, pin } of pairs) {
    try {
      const isAdminRow = branchName === "관리자";
      const meta = isAdminRow
        ? { loginEmail: ADMIN_EMAIL, brand: "본사" }
        : metaByName.get(branchName);
      if (!meta) throw new Error("public_branches 에서 로그인 이메일을 찾지 못함(지점명 표기 확인)");
      await signInWithEmailAndPassword(auth, meta.loginEmail, `ugd-${pin}`);
      await signOut(auth);
      verified.push({ branchName, pin, brand: meta.brand, role: isAdminRow ? "admin" : "branch" });
    } catch (e) {
      const code = e?.code || "";
      const msg = /invalid-credential|wrong-password/.test(code)
        ? "PIN 이 현재 값과 다릅니다(로그인 거부) — 미기입"
        : String(e?.message || e);
      results.push({ label: branchName, ok: false, note: msg });
    }
  }

  if (dryRun) {
    for (const v of verified) results.push({ label: v.branchName, ok: true, note: `PIN 검증 통과 (dry-run, 미기입) hash=${sha256Hex(v.pin).slice(0, 12)}…` });
  } else if (verified.length) {
    // 2단계: 관리자로 로그인해 시트 + Firestore 미러를 함께 기입.
    await signInAsAdmin(app);
    for (const v of verified) {
      const pinHash = sha256Hex(v.pin);
      try {
        await callGas("updateBranchPin", { branchName: v.branchName, pinHash });
        // 이름 키 미러 — 앱 tryDirectBackup("setting") 과 동일 필드 구성(전체 메타 포함).
        // merge:true 라 기존 문서의 다른 필드를 지우지 않는다.
        await setDoc(doc(db, "settings", v.branchName), {
          branch_name: v.branchName,
          pin_hash: pinHash,
          role: v.role,
          is_active: true,
          brand: v.brand,
          _updatedAt: new Date().toISOString()
        }, { merge: true });
        results.push({ label: v.branchName, ok: true, note: `시트+미러 기입 완료 hash=${pinHash.slice(0, 12)}…` });
      } catch (e) {
        results.push({ label: v.branchName, ok: false, note: `기입 실패: ${String(e?.message || e)}` });
      }
    }
    await signOut(auth);
  }

  console.log("\n=== 결과 ===");
  for (const r of results) console.log(`${r.ok ? "OK " : "FAIL"}  ${r.label}: ${r.note}`);
  process.exit(results.every((r) => r.ok) ? 0 : 2);
}

main().catch((e) => { console.error("실행 실패:", e); process.exit(1); });
