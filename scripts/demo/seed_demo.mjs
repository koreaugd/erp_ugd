/**
 * 시연용 인스턴스 시드/리셋 스크립트 (firebase-admin, 데모 프로젝트 전용)
 *
 *   node scripts/demo/seed_demo.mjs                    # 시드만 (기존 문서 위에 덮어쓰기)
 *   node scripts/demo/seed_demo.mjs --reset            # 전체 삭제 후 기준선 재시드 (시연 전 권장)
 *   node scripts/demo/seed_demo.mjs --data <폴더>       # 데이터 폴더 지정 (기본: ../02. 재무 회계/output/demo_data)
 *   node scripts/demo/seed_demo.mjs --key <키파일>      # 서비스계정 키 지정 (기본: %USERPROFILE%\secrets\ 아래 데모 키)
 *
 * 데이터 폴더 규약 (generate_fake_data.mjs 가 생성):
 *   - _auth_accounts.json : [{ email, password, emailVerified, displayName, profile }]
 *       profile 이 있으면 해당 uid 로 users/{uid} 문서를 기록한다.
 *   - 그 외 *.json         : 파일명 = 컬렉션명. [{ id, data }] 배열.
 *
 * 안전장치 (전부 fail-closed):
 *   1) firebase-applet-config.demo.json 에 PLACEHOLDER 가 남아 있으면 거부
 *   2) 서비스계정 키의 project_id 가 데모 설정의 projectId 와 다르면 거부
 *   3) 운영 프로젝트(crypto-song-428612-p7)로는 어떤 경우에도 거부
 *   4) --reset 은 Firestore 전체 컬렉션 재귀 삭제 + Auth 전체 사용자 삭제 후 재생성
 *      (시연 중 방문자가 만든 계정·문서까지 지워 기준선으로 되돌린다)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const PROD_PROJECT_ID = "crypto-song-428612-p7";

const argv = process.argv.slice(2);
const reset = argv.includes("--reset");
const argValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};
const dataDir = path.resolve(ROOT, argValue("--data") ?? path.join("..", "02. 재무 회계", "output", "demo_data"));
const home = process.env.USERPROFILE || process.env.HOME || "";
const keyPath = path.resolve(argValue("--key") ?? path.join(home, "secrets", "ugd-erp-showcase-sa.json"));

// ── 안전장치 ──────────────────────────────────────────────────────────────
const demoConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "firebase-applet-config.demo.json"), "utf8"));
if (JSON.stringify(demoConfig).includes("PLACEHOLDER")) {
  console.error("[거부] firebase-applet-config.demo.json 이 아직 PLACEHOLDER 상태입니다. 데모 프로젝트 설정값을 먼저 채우세요.");
  process.exit(1);
}
if (!fs.existsSync(keyPath)) {
  console.error(`[거부] 서비스계정 키가 없습니다: ${keyPath}\n  (--key 로 경로를 지정하거나 데모프로젝트_준비절차.md 5단계를 진행하세요)`);
  process.exit(1);
}
const saKey = JSON.parse(fs.readFileSync(keyPath, "utf8"));
if (saKey.project_id === PROD_PROJECT_ID || demoConfig.projectId === PROD_PROJECT_ID) {
  console.error("[거부] 운영 프로젝트를 가리키고 있습니다. 이 스크립트는 데모 프로젝트에서만 동작합니다.");
  process.exit(1);
}
if (saKey.project_id !== demoConfig.projectId) {
  console.error(`[거부] 키의 프로젝트(${saKey.project_id})와 데모 설정(${demoConfig.projectId})이 다릅니다.`);
  process.exit(1);
}
if (!fs.existsSync(dataDir)) {
  console.error(`[거부] 데이터 폴더가 없습니다: ${dataDir}\n  (generate_fake_data.mjs 를 먼저 실행하세요)`);
  process.exit(1);
}

const app = initializeApp({ credential: cert(saKey), projectId: saKey.project_id });
const db = getFirestore(app, demoConfig.firestoreDatabaseId === "(default)" ? undefined : demoConfig.firestoreDatabaseId);
const auth = getAuth(app);

// ── 리셋 ──────────────────────────────────────────────────────────────────
async function resetAll() {
  console.log("[리셋] Firestore 전체 컬렉션 삭제 중…");
  const collections = await db.listCollections();
  for (const col of collections) {
    await db.recursiveDelete(col);
    console.log(`  - ${col.id} 삭제`);
  }
  console.log("[리셋] Auth 사용자 전체 삭제 중… (방문자가 만든 계정 포함)");
  let deleted = 0;
  // listUsers 는 페이지당 최대 1000명 — 데모 규모에서는 1~2페이지면 끝난다.
  let pageToken = undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    if (page.users.length > 0) {
      const result = await auth.deleteUsers(page.users.map((u) => u.uid));
      deleted += result.successCount;
      if (result.failureCount > 0) {
        console.error(`[실패] Auth 사용자 ${result.failureCount}명 삭제 실패 — 다시 실행해 주세요.`);
        process.exit(1);
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);
  console.log(`  - ${deleted}명 삭제`);
}

// ── Auth 계정 + users 프로필 ──────────────────────────────────────────────
async function ensureAccounts(accounts) {
  const summary = [];
  for (const acc of accounts) {
    let user;
    try {
      user = await auth.getUserByEmail(acc.email);
      await auth.updateUser(user.uid, {
        password: acc.password,
        emailVerified: acc.emailVerified !== false,
        displayName: acc.displayName || undefined,
      });
    } catch (e) {
      if (e?.code !== "auth/user-not-found") throw e;
      user = await auth.createUser({
        email: acc.email,
        password: acc.password,
        emailVerified: acc.emailVerified !== false,
        displayName: acc.displayName || undefined,
      });
    }
    if (acc.profile) {
      await db.collection("users").doc(user.uid).set(acc.profile, { merge: false });
    }
    summary.push({ email: acc.email, uid: user.uid, hasProfile: !!acc.profile });
    console.log(`  - ${acc.email} (${acc.profile ? "프로필 기록" : "게이트 전용"})`);
  }
  return summary;
}

// ── 데이터 기록 ───────────────────────────────────────────────────────────
async function writeCollection(name, docs) {
  const CHUNK = 400; // 배치 한도 500 미만으로 여유
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = db.batch();
    for (const { id, data } of docs.slice(i, i + CHUNK)) {
      batch.set(db.collection(name).doc(id), data, { merge: false });
    }
    await batch.commit();
  }
  // 기록 후 재조회 대사 — 누락이 있으면 실패로 처리
  const snap = await db.collection(name).count().get();
  return snap.data().count;
}

// ── 실행 ──────────────────────────────────────────────────────────────────
console.log(`[대상] 프로젝트 ${saKey.project_id} / DB ${demoConfig.firestoreDatabaseId}`);
if (reset) await resetAll();

const files = fs.readdirSync(dataDir).filter((f) => f.endsWith(".json"));
const authFile = files.find((f) => f === "_auth_accounts.json");
if (!authFile) {
  console.error("[거부] _auth_accounts.json 이 없습니다 — 데모 계정 없이 시드하면 아무도 로그인할 수 없습니다.");
  process.exit(1);
}

console.log("[계정] 데모 계정 생성/갱신…");
const accounts = JSON.parse(fs.readFileSync(path.join(dataDir, authFile), "utf8"));
const accountSummary = await ensureAccounts(accounts);

const counts = {};
let failed = false;
for (const file of files.filter((f) => f !== "_auth_accounts.json")) {
  const name = path.basename(file, ".json");
  const docs = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
  if (!Array.isArray(docs)) {
    console.error(`[실패] ${file} 은 [{id, data}] 배열이어야 합니다.`);
    failed = true;
    continue;
  }
  const written = await writeCollection(name, docs);
  const ok = written >= docs.length;
  counts[name] = { expected: docs.length, actual: written, ok };
  console.log(`[시드] ${name}: ${written}/${docs.length}건 ${ok ? "OK" : "누락!"}`);
  if (!ok) failed = true;
}

const summaryPath = path.resolve(ROOT, "..", "02. 재무 회계", "output", "demo_seed_summary.json");
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(summaryPath, JSON.stringify({
  seededAt: new Date().toISOString(),
  projectId: saKey.project_id,
  reset,
  accounts: accountSummary,
  collections: counts,
}, null, 2), "utf8");
console.log(`\n[대사 결과] ${summaryPath}`);

if (failed) {
  console.error("[실패] 일부 컬렉션에 누락이 있습니다. --reset 으로 다시 실행해 주세요.");
  process.exit(1);
}
console.log(reset ? "[완료] 기준선으로 리셋되었습니다. 시연 준비 완료." : "[완료] 시드 완료.");
process.exit(0);
