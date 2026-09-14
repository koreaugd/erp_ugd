// src/utils/idleLogoutExempt.ts
// 유휴 자동 로그아웃(30분)에서 빼 줄 계정 — 총괄 구글 계정(사용자 지시 2026-09-14).
//
// 왜 이메일 상수인가
//   이 저장소는 public 이지만, 이 주소는 커밋 작성자로 이미 전부 드러나 있어 새로 노출되는 정보가 없다.
//   Firestore 프로필 플래그로 만들면 관리 화면·규칙·백필까지 손대야 해서 지금은 상수가 가장 작다.
//   계정을 더 빼 줘야 하면 이 목록에 추가한다.
//
// PIN 로그인 세션(email 없음)은 절대 면제하지 않는다 — 유휴 로그아웃의 목적이 매장 공용 노트북이기 때문이다.
const IDLE_LOGOUT_EXEMPT_EMAILS = ["happyyup2@gmail.com"];

export function isIdleLogoutExempt(user: { loginType?: string; email?: string | null } | null | undefined): boolean {
  if (!user || user.loginType !== "personal") return false;
  const email = String(user.email || "").trim().toLowerCase();
  return !!email && IDLE_LOGOUT_EXEMPT_EMAILS.includes(email);
}
