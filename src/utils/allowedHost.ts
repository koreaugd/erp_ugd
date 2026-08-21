// src/utils/allowedHost.ts
// 정해진 주소에서만 앱이 뜨게 한다(2026-07-30 사용자 지시).
//
// 왜 필요한가: 같은 저장소가 예전에 다른 호스팅(넷리파이 ugdugd.netlify.app)에도 연결돼 있어,
// 푸시할 때마다 **두 번째 복사본**이 같이 만들어지고 있었다. 그 복사본은 화면만 최신이고 백엔드는
// 옛 버전을 물고 있어서, 거기로 들어간 사람은 "어떤 기능은 되고 어떤 기능은 안 되는" 상태로
// 진짜 운영 데이터를 만지게 된다(로그인·Firestore 는 브라우저가 직접 연결하므로 그대로 동작한다).
// 그래서 주소부터 막는다 — 허용 목록 밖이면 앱을 아예 띄우지 않고 올바른 주소를 안내한다.
//
// 호스팅을 옮기거나 도메인을 붙이면 여기에 한 줄 추가해야 한다. 빠뜨리면 새 주소에서 안 뜬다.
//
// 시연용 빌드(IS_DEMO)는 목록이 통째로 다르다 — 데모 번들이 운영 주소에서 뜨거나 운영 번들이
// 데모 주소에서 뜨는 것 **둘 다** 막아야 한다(뒤섞이면 어느 백엔드를 보는지 알 수 없어진다).
// IS_DEMO 는 빌드 시점 리터럴이라 반대편 목록·주소는 죽은코드 제거로 사라진다
// (scripts/demo/check_prod_bundle.mjs 가 기계 검사 — 이 파일을 고치면 반드시 재실행할 것).
import { IS_DEMO } from "../demo";

/** 앱이 떠도 되는 주소(호스트명만 비교 — 포트·경로는 보지 않는다) */
export const ALLOWED_HOSTS = IS_DEMO
  ? [
      "ugd-erp-showcase.web.app",          // 시연용(Firebase Hosting 기본 주소)
      "ugd-erp-showcase.firebaseapp.com",  // 같은 사이트의 짝 주소 — 파이어베이스가 둘 다 서빙한다
      "localhost",
      "127.0.0.1",
    ]
  : [
      "koreaugd.github.io",   // 운영(GitHub Pages)
      "localhost",            // 로컬 미리보기(npm run dev / npm start)
      "127.0.0.1",
    ];

/** 지금 이 주소에서 앱을 띄워도 되는가. 개발 모드(vite dev)는 항상 허용한다. */
export function isAllowedHost(): boolean {
  if (typeof window === "undefined") return true;
  if ((import.meta as any).env?.DEV) return true;
  return ALLOWED_HOSTS.includes(window.location.hostname);
}

/** 안내에 쓸 정식 주소 */
export const CANONICAL_APP_URL = IS_DEMO
  ? "https://ugd-erp-showcase.web.app/"
  : "https://koreaugd.github.io/erp_ugd/";
