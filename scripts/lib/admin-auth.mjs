/**
 * 스크립트용 관리자 로그인. PIN 을 소스에 박지 않는다.
 *
 * PIN 조회 순서
 *   1) 환경변수 UGD_ADMIN_PIN   ← PIN 을 바꿨거나 저장소 밖에서 돌릴 때
 *   2) ERP_ACCESS.md 의 "Admin PIN: ####"
 *
 * 주의: ERP_ACCESS.md 는 이미 저장소에 커밋돼 있어 PIN 이 git 히스토리에 남아 있다.
 *       PIN 을 저장소에서 완전히 지우려면 히스토리 정리 + PIN 교체가 필요하며, 별도 작업이다.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ADMIN_EMAIL = "admin@ugd-erp.example";

export function readAdminPin() {
  const fromEnv = String(process.env.UGD_ADMIN_PIN || "").trim();
  if (fromEnv) return fromEnv;

  try {
    const doc = readFileSync(resolve(REPO_ROOT, "ERP_ACCESS.md"), "utf-8");
    const match = doc.match(/Admin PIN:\s*(\S+)/);
    if (match) return match[1];
  } catch {}

  throw new Error("관리자 PIN을 찾지 못했습니다. 환경변수 UGD_ADMIN_PIN 을 설정하거나 ERP_ACCESS.md 에 'Admin PIN: ####' 을 두세요.");
}

export async function signInAsAdmin(app) {
  const { getAuth, signInWithEmailAndPassword } = await import("firebase/auth");
  return signInWithEmailAndPassword(getAuth(app), ADMIN_EMAIL, `ugd-${readAdminPin()}`);
}

/**
 * 급여대장(part_time_salaries / monthly_fulltime_salary …) 전용 로그인.
 *
 * 위의 PIN 관리자(admin@ugd-erp.example)는 2026-07-28 규칙에서 급여 키 접근이 의도적으로 막혀 있다
 * (firestore.rules: "PIN 관리자는 여기서 의도적으로 배제 — isAdmin() 쓰지 말 것").
 * 그래서 급여를 다루는 스크립트는 개인 관리자 계정(users 문서 role='admin')으로 로그인해야 한다.
 *
 * 자격증명은 환경변수로만 받는다 — 저장소에 남기지 않는다.
 *   UGD_PERSONAL_ADMIN_EMAIL / UGD_PERSONAL_ADMIN_PASSWORD
 */
export async function signInAsPersonalAdmin(app) {
  const email = String(process.env.UGD_PERSONAL_ADMIN_EMAIL || "").trim();
  const password = String(process.env.UGD_PERSONAL_ADMIN_PASSWORD || "");
  if (!email || !password) {
    throw new Error(
      "급여대장은 개인 관리자 계정이 필요합니다.\n" +
      "  환경변수 UGD_PERSONAL_ADMIN_EMAIL / UGD_PERSONAL_ADMIN_PASSWORD 를 설정하고 다시 실행하세요.\n" +
      "  (구글 로그인 전용 계정이면 비밀번호가 없으므로, 이메일+비밀번호 관리자 계정이 따로 있어야 합니다.)"
    );
  }
  const { getAuth, signInWithEmailAndPassword } = await import("firebase/auth");
  return signInWithEmailAndPassword(getAuth(app), email, password);
}
