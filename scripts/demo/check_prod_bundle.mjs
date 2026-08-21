// 운영/데모 번들 상호 오염 검사.
//
// 무엇을 지키나:
//  1) 운영 번들에 데모 흔적(데모 projectId, 시연 배너 문구, 데모 계정 이메일)이 없어야 한다
//     — 데모 분기가 죽은코드 제거로 정말 사라졌는지의 기계 증명.
//  2) 데모 번들에 운영 흔적(운영 projectId, 운영 named DB id)이 없어야 한다
//     — 데모가 운영 Firebase를 건드릴 수 없다는 기계 증명.
//
// 사용법: npm run check:demo-bundle   (erp_ugd 루트에서)
// 빌드는 깨끗한 자식 프로세스에서 수행한다 — 부모 프로세스의 환경(DEV=1 등)이
// vite define 결과를 오염시켜 거짓 통과하는 함정(erp_saas 계획 7에서 실측)을 피한다.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const prodConfig = JSON.parse(fs.readFileSync(path.join(root, "firebase-applet-config.json"), "utf8"));
const demoConfig = JSON.parse(fs.readFileSync(path.join(root, "firebase-applet-config.demo.json"), "utf8"));

const PROD_OUT = "dist-check-prod";
const DEMO_OUT = "dist-check-demo";

function build(label, args, outDir) {
  console.log(`[빌드] ${label} → ${outDir}`);
  execSync(`npx vite build ${args} --outDir ${outDir} --emptyOutDir`, {
    cwd: root,
    stdio: "inherit",
    // 부모 환경을 그대로 물려주되, vite mode 판정을 흔들 수 있는 값은 제거한다.
    env: { ...process.env, NODE_ENV: undefined, DEV: undefined, MODE: undefined },
  });
}

function scan(outDir, forbidden) {
  const dir = path.join(root, outDir);
  const hits = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(js|css|html|json)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, "utf8");
      for (const { needle, why } of forbidden) {
        if (needle && text.includes(needle)) {
          hits.push({ file: path.relative(root, full), needle, why });
        }
      }
    }
  };
  walk(dir);
  return hits;
}

build("운영(기본 모드)", "", PROD_OUT);
build("데모(--mode demo)", "--mode demo", DEMO_OUT);

// 운영 번들에 있으면 안 되는 것들 — 데모 설정이 PLACEHOLDER 상태여도 검사가 성립하도록
// projectId 문자열 자체를 금지어로 쓴다(운영 config의 projectId와 같아지는 사고는 아래에서 별도 차단).
if (demoConfig.projectId === prodConfig.projectId) {
  console.error("[실패] 데모 설정의 projectId가 운영과 같습니다. firebase-applet-config.demo.json을 확인하세요.");
  process.exit(1);
}
// 상대편 config의 **모든 식별 값**을 금지어로 삼는다 — projectId·DB id만 검사하면
// apiKey/appId/senderId 등이 남는 누출을 놓친다(Codex P1, 2026-08-20).
// 짧거나(구분력 없음) 양쪽에 공통인 값("(default)", 빈 문자열 등)은 제외한다.
function configNeedles(config, label) {
  const other = config === prodConfig ? demoConfig : prodConfig;
  const otherValues = new Set(Object.values(other).map(String));
  return Object.entries(config)
    .filter(([key]) => key !== "_comment")
    .map(([key, value]) => ({ needle: String(value), why: `${label} ${key}` }))
    .filter(({ needle }) => needle.length >= 8 && needle !== "(default)" && !otherValues.has(needle));
}
const prodForbidden = [
  ...configNeedles(demoConfig, "데모"),
  { needle: "시연용 인스턴스", why: "데모 배너 문구" },
  { needle: "demo-admin@ugd-erp.example", why: "데모 계정 안내" },
  { needle: "__IS_DEMO__", why: "define 미치환(리터럴 치환 실패)" },
];
const demoForbidden = [
  ...configNeedles(prodConfig, "운영"),
  // 운영 GAS URL은 config 파일이 아니라 VITE_GAS_URL 환경변수(.env 포함)로 주입된다 —
  // 데모 번들에 실제 배포 URL("https://script.google.com/macros/s/…/exec")이 박히는 것을 잡는다.
  // gasClient 소스의 리터럴은 "script.google.com"까지뿐이라("/macros" 없음) 오탐이 없다.
  { needle: "script.google.com/macros", why: "운영 GAS URL" },
  ...(process.env.VITE_GAS_URL ? [{ needle: process.env.VITE_GAS_URL, why: "운영 GAS URL(환경변수 주입값)" }] : []),
  { needle: "__IS_DEMO__", why: "define 미치환(리터럴 치환 실패)" },
];

const prodHits = scan(PROD_OUT, prodForbidden);
const demoHits = scan(DEMO_OUT, demoForbidden);

for (const outDir of [PROD_OUT, DEMO_OUT]) {
  fs.rmSync(path.join(root, outDir), { recursive: true, force: true });
}

let failed = false;
if (prodHits.length) {
  failed = true;
  console.error("\n[실패] 운영 번들에 데모 흔적이 남았습니다 (죽은코드 제거 실패):");
  for (const h of prodHits) console.error(`  - ${h.file}: "${h.needle}" (${h.why})`);
}
if (demoHits.length) {
  failed = true;
  console.error("\n[실패] 데모 번들에 운영 흔적이 남았습니다 (운영 접근 위험):");
  for (const h of demoHits) console.error(`  - ${h.file}: "${h.needle}" (${h.why})`);
}
if (failed) process.exit(1);
console.log("\n[통과] 운영 번들 데모 흔적 0건 / 데모 번들 운영 흔적 0건");
