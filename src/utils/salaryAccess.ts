// src/utils/salaryAccess.ts
// 급여대장(정직원·파트타이머) 접근 권한 판정 — 화면(탭)과 firestore.rules(canReadSalary)가 같은 규칙을 쓰도록 한 곳에 둔다.
// 급여·주민번호·계좌가 담긴 자료라 계정별 허용 지점으로 격리한다(2026-07-27).
//
// 2026-07-28 개편(설계서 §15): 열람 자격을 '역할'로 좁혔다.
//   총괄(admin)             → 전 지점
//   지점관리자(branchAdmin) → salaryBranches 에 있는 지점만
//   지점(branch)            → 불가
//   PIN 로그인              → 불가 (전환기 예외 삭제)
// 비밀번호를 아는 것만으로는 열리지 않는다 — 비밀번호 게이트보다 이 판정이 먼저다.
import type { UserSession } from "../hooks/useAuth";

type SalaryAccessUser =
  | (Pick<UserSession, "salaryBranches" | "role"> & {
      loginType?: UserSession["loginType"];
      allowedBranches?: UserSession["allowedBranches"];
    })
  | null;

const sameBranch = (a: unknown, b: string) => String(a ?? "").trim() === b;

/**
 * 이 세션이 해당 지점의 급여대장(정직원·파트타이머 공통)을 열람·작성할 수 있는가.
 * 열람과 작성을 나누지 않는다 — 볼 수 있으면 쓸 수 있다(설계서 §15.2).
 * - salaryBranches "all"  : 전 지점
 * - string[]              : 목록에 있는 지점만
 * - 미지정/[]             : 불가(fail-closed) — 기존 문서에 필드가 없으면 여기로 떨어진다.
 */
export function canReadSalaryBranch(user: SalaryAccessUser, branchName: string): boolean {
  if (!user) return false;
  // PIN 로그인 차단(2026-07-28 사용자 지시). 지점 공용 PIN만 알면 누구나 급여대장을 열 수 있던 구멍을 막는다.
  // firestore.rules canReadSalary의 isPinAccount 예외 삭제와 짝 — 한쪽만 고치면 개발자도구로 뚫린다.
  if (user.loginType === "pin") return false;
  // 총괄은 항상 전 지점 — 첫 총괄이 스스로 권한을 줄 수 없는 부트스트랩 데드락을 막는다.
  if (user.role === "admin") return true;
  // 지점 계정은 비밀번호를 알아도 불가.
  if (user.role !== "branchAdmin") return false;
  const target = String(branchName || "").trim();
  if (!target) return false;
  // 지점관리자에게 '전체 지점'은 없다 — "전체매장이 아니라 허용된 지점만"이 사용자 지시다(2026-07-28).
  // 옛 문서에 "all"이 남아 있어도 여기서 막는다(fail-closed). 총괄만 전 지점 예외를 갖는다.
  const salary = user.salaryBranches;
  if (!Array.isArray(salary) || !salary.some((b) => sameBranch(b, target))) return false;
  // 급여 범위는 일반 접근 범위를 넘지 못한다 — 화면에 들어가지도 못하는 지점의 급여를 볼 수는 없다.
  // (급여 목록만 넓게 주고 허용지점을 좁혀 두면 권한이 새는 것을 막는다. Codex 지적 2026-07-28)
  const general = user.allowedBranches;
  if (general === undefined || general === "all") return true;
  return Array.isArray(general) && general.some((b) => sameBranch(b, target));
}

/**
 * 막힌 이유를 화면 문구로 바꾼다. "권한이 없습니다"만 띄우면 지점이 무엇을 해야 할지 몰라
 * 본사에 같은 문의를 반복하므로, 이유별로 다음 행동까지 알려 준다.
 */
export function salaryAccessDenialMessage(user: SalaryAccessUser, branchName: string): string {
  if (!user) return "로그인이 필요합니다.";
  if (user.loginType === "pin") {
    return "급여대장은 개인 계정으로 로그인해야 이용할 수 있습니다. 구글 또는 이메일 계정으로 다시 로그인해 주세요.";
  }
  if (user.role !== "admin" && user.role !== "branchAdmin") {
    return "급여대장은 지점관리자 계정으로만 이용할 수 있습니다. 필요하면 본사에 지점관리자 지정을 요청해 주세요.";
  }
  return `${branchName} 지점의 급여대장을 볼 수 있는 권한이 없습니다. 본사에 이 지점의 급여대장 열람 권한을 요청해 주세요.`;
}
