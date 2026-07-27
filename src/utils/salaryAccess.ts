// src/utils/salaryAccess.ts
// 정직원 급여대장 열람 권한 판정 — 화면(탭)과 firestore.rules(canReadSalary)가 같은 규칙을 쓰도록 한 곳에 둔다.
// 급여·주민번호·계좌가 담긴 자료라 계정별 허용 지점으로 격리한다(2026-07-27).
import type { UserSession } from "../hooks/useAuth";

/**
 * 이 세션이 해당 지점의 정직원 급여대장을 열람할 수 있는가.
 * - "all"  : 총관리자(전 지점) 또는 전환기 PIN 로그인
 * - string[]: 목록에 있는 지점만
 * - 미지정/[] : 열람 불가(fail-closed) — 기존 문서에 필드가 없으면 여기로 떨어진다.
 */
export function canReadSalaryBranch(
  user: Pick<UserSession, "salaryBranches" | "role"> & { loginType?: UserSession["loginType"] } | null,
  branchName: string
): boolean {
  if (!user) return false;
  // PIN 로그인은 전환기 동안 기존 동작 유지 — firestore.rules의 isPinAccount 예외와 짝.
  // (구버전 세션에 salaryBranches가 없어 급여대장에서 튕기는 회귀도 여기서 함께 막는다.)
  if (user.loginType === "pin") return true;
  // 관리자(총관리자)는 항상 전 지점 열람 — firestore.rules canReadSalary의 isPersonalAdmin 예외와 짝.
  // 첫 관리자가 스스로 권한을 줄 수 없는 부트스트랩 데드락을 막는다.
  if (user.role === "admin") return true;
  const allowed = user.salaryBranches;
  if (allowed === "all") return true;
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  const target = String(branchName || "").trim();
  if (!target) return false;
  return allowed.some((b) => String(b || "").trim() === target);
}
