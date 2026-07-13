// src/components/AppSessionGuard.tsx
// 로그인한 화면 위에서 두 가지를 지킨다.
//
//  1) 새로 배포된 버전 갈아끼우기 — 매장은 로그아웃하지 않고 노트북을 덮었다 여는 식으로 쓴다.
//     그러면 로그인 때만 돌던 버전 검사가 한 번도 실행되지 않아 며칠 전 버전을 계속 쓴다.
//  2) 유휴 자동 로그아웃 — 노트북이 24시간 로그인 상태로 방치된다. 급여대장에는 주민번호가 있다.
//
// 화면을 그리지 않는다. 새 버전은 입력이 멈추면 조용히 갈아끼운다 —
// 배너를 띄워봐야 지점이 누르지 않고, 마감 중에 뜨면 방해만 된다.
import { useAuthContext } from "../contexts/AuthContext";
import { useAppUpdateWatcher } from "../hooks/useAppUpdateWatcher";
import { useIdleLogout } from "../hooks/useIdleLogout";

const IDLE_LOGOUT_MS = 30 * 60 * 1000; // 마지막 조작 후 30분

export function AppSessionGuard() {
  const { user, logout } = useAuthContext();
  useAppUpdateWatcher();
  useIdleLogout(() => { if (user) logout(); }, IDLE_LOGOUT_MS);
  return null;
}
