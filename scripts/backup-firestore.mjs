/**
 * Firestore 전체 백업(읽기 전용 내보내기). 데이터를 절대 유실하지 않기 위한 안전망.
 *
 *   node scripts/backup-firestore.mjs                 # 지금 즉시 1회 백업
 *   node scripts/backup-firestore.mjs --wait-for-quota # 무료 읽기 한도가 풀릴 때까지 3분마다 재시도 후 백업
 *   node scripts/backup-firestore.mjs --keep 30        # 최근 30개 스냅샷만 보관(기본 21)
 *
 * 무엇을 하나:
 *   - 핵심 컬렉션(daily_settles = 일일마감이 가장 중요)을 서버에서 통째로 읽어
 *     firestore-backups/<타임스탬프>/<컬렉션>.json 으로 저장한다.
 *   - manifest.json 에 컬렉션별 문서 수, daily_settles 지점별 건수, 스키마 샘플을 남긴다.
 *   - 오래된 스냅샷은 보관 개수만 남기고 지운다.
 *
 * 왜 --wait-for-quota:
 *   무료 등급 DB는 하루 읽기 한도(5만)를 넘기면 모든 읽기가 resource-exhausted 로 거부된다.
 *   한도는 태평양 자정(=KST 16:00)에 초기화된다. 이 플래그를 주면 한도가 풀리는 즉시
 *   가장 먼저 백업을 떠서, "화면이 비어 보이던" 데이터가 온전한지 증명하고 안전본을 확보한다.
 *
 * 안전: 이 스크립트는 어떤 문서도 쓰거나 지우지 않는다(로컬 백업 파일 정리만 함).
 */
import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BACKUP_ROOT = resolve(REPO_ROOT, "firestore-backups");

// 백업 대상 컬렉션. daily_settles 가 최우선(일일마감·초과근무·파트타이머 일지의 원천).
const COLLECTIONS = [
  "daily_settles",
  "shared_data",
  "staff_rosters",
  "branch_own_rosters",
  "public_branches",
  "settings",
  "edit_logs",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const hb = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function main() {
  const { initializeApp } = await import("firebase/app");
  const { getFirestore, collection, getDocsFromServer, doc, getDocFromServer } = await import("firebase/firestore");
  const { default: config } = await import("../firebase-applet-config.json", { with: { type: "json" } });
  const { signInAsAdmin } = await import("./lib/admin-auth.mjs");

  const args = process.argv.slice(2);
  const waitForQuota = args.includes("--wait-for-quota");
  const keepIdx = args.indexOf("--keep");
  const keep = keepIdx >= 0 ? Number(args[keepIdx + 1]) || 21 : 21;

  const app = initializeApp(config);
  const db = getFirestore(app, config.firestoreDatabaseId);
  await signInAsAdmin(app);
  hb("관리자 로그인 완료.");

  // 1) 한도가 풀렸는지 값싼 1건 읽기로 확인(필요 시 대기)
  const probe = async () => {
    // migration_status 는 이관 때 생성된 단일 문서 — 1 read 로 한도 상태를 본다.
    await getDocFromServer(doc(db, "shared_data", encodeURIComponent("migration_status")));
  };
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      await probe();
      hb(`읽기 가능(한도 풀림). 백업을 시작합니다. (재확인 ${attempt}회 만에)`);
      break;
    } catch (e) {
      const exhausted = e?.code === "resource-exhausted" || /quota|resource-exhausted/i.test(String(e?.message || e));
      if (exhausted && waitForQuota) {
        // 60초마다 조용히 재확인해 초기화 순간을 놓치지 않되, 하트비트(화면 보고용)는 ~10분 간격으로만 찍는다.
        if (attempt === 1 || attempt % 10 === 0) hb(`대기중… 아직 읽기 한도 초과. 60초마다 재확인 중 (누적 ${attempt}회). 태평양 자정=KST 16:00 초기화 예상.`);
        await sleep(60000);
        continue;
      }
      if (exhausted) {
        hb("읽기 한도 초과 상태입니다. --wait-for-quota 로 실행하면 초기화까지 기다립니다.");
        process.exit(2);
      }
      throw e;
    }
  }

  // 2) 컬렉션별 전체 내보내기
  const dir = resolve(BACKUP_ROOT, stamp());
  mkdirSync(dir, { recursive: true });
  const manifest = { backedUpAt: new Date().toISOString(), databaseId: config.firestoreDatabaseId, collections: {} };

  for (const name of COLLECTIONS) {
    try {
      const snap = await getDocsFromServer(collection(db, name));
      const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
      writeFileSync(resolve(dir, `${name}.json`), JSON.stringify(docs, null, 2), "utf-8");
      manifest.collections[name] = { count: docs.length };
      hb(`  ${name.padEnd(20)} ${String(docs.length).padStart(5)}건 저장`);

      // daily_settles 는 지점별 건수 + 스키마 샘플을 추가로 남긴다(복구·쿼리설계 판단용).
      if (name === "daily_settles") {
        const byBranch = {};
        let camel = 0, snake = 0, other = 0;
        const idSamples = [];
        for (const d of docs) {
          const m = d.data.master || {};
          const bn = m.branchName || m.branch_name || "(없음)";
          byBranch[bn] = (byBranch[bn] || 0) + 1;
          if (m.branchName) camel++; else if (m.branch_name) snake++; else other++;
          if (idSamples.length < 5) idSamples.push({ id: d.id, recordId: m.recordId || m.record_id || null, branchName: bn, settleDate: m.settleDate || m.settle_date });
        }
        manifest.collections[name].byBranch = byBranch;
        manifest.collections[name].fieldFormat = { camelCase_branchName: camel, snakeCase_branch_name: snake, neither: other };
        manifest.collections[name].idSamples = idSamples;
      }
    } catch (e) {
      manifest.collections[name] = { error: String(e?.message || e) };
      hb(`  ${name.padEnd(20)} 실패: ${String(e?.message || e).slice(0, 80)}`);
    }
  }

  writeFileSync(resolve(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  // 3) 보관 정책: 최근 keep 개 스냅샷만 남긴다
  if (existsSync(BACKUP_ROOT)) {
    const snaps = readdirSync(BACKUP_ROOT).filter((n) => /\d{4}-\d{2}-\d{2}T/.test(n)).sort();
    const drop = snaps.slice(0, Math.max(0, snaps.length - keep));
    for (const old of drop) rmSync(resolve(BACKUP_ROOT, old), { recursive: true, force: true });
    if (drop.length) hb(`오래된 스냅샷 ${drop.length}개 정리(보관 ${keep}개).`);
  }

  // 4) 요약 출력(데이터 온전성 증명)
  const ds = manifest.collections.daily_settles || {};
  console.log("\n=== 백업 완료 ===");
  console.log(`저장 위치: ${dir}`);
  console.log(`daily_settles(일일마감) 총 ${ds.count ?? "?"}건`);
  if (ds.byBranch) {
    console.log("지점별 마감 건수:");
    Object.entries(ds.byBranch).sort((a, b) => b[1] - a[1]).forEach(([b, c]) => console.log(`  ${String(b).padEnd(20)} ${c}건`));
    console.log("필드 형식:", JSON.stringify(ds.fieldFormat));
    console.log("문서ID 샘플:");
    (ds.idSamples || []).forEach((s) => console.log(`  ${s.id}  (branch=${s.branchName}, date=${s.settleDate})`));
  }
  console.log("\nBACKUP-DONE");
  process.exit(0);
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryPoint && import.meta.url === entryPoint) await main();
