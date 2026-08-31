// 시연용 인스턴스 플래그.
// `npm run build:demo`(vite --mode demo)로 빌드했을 때만 true가 된다.
// __IS_DEMO__는 vite.config.ts의 define으로 빌드 시점에 리터럴 true/false로 치환되므로,
// 운영 빌드에서는 데모 분기가 죽은코드 제거로 통째로 사라진다.
// 제거 여부는 scripts/demo/check_prod_bundle.mjs가 기계 검사한다 — 이 파일을 고치면 반드시 재실행할 것.
export const IS_DEMO: boolean = __IS_DEMO__;

// 데모가 지원하지 않는 외부 연동을 호출했을 때 보여줄 한 줄(demoGas 의 마지막 분기).
export const DEMO_NOT_SUPPORTED_MESSAGE = "시연용 인스턴스에서는 외부 연동 기능이 꺼져 있습니다.";

/**
 * 시연용 빌드에서 쓰는 **가상 회사 표기**(사용자 지시 2026-08-24 — 실제 회사명이 화면에 나오면 안 된다).
 *
 * 데모 지점이 온담식당·화로연이라 그 둘을 아우르는 가상 지주사 이름을 하나 둔다.
 * 화면에 회사명이 박힌 자리는 전부 이 상수를 거치게 해서, 한 곳만 고치면 전부 따라오게 한다
 * (예전에는 로고·부제·워터마크·엑셀 파일명·브라우저 탭 제목에 "UGD" 가 따로따로 박혀 있었다).
 *
 * 운영 빌드에서는 IS_DEMO 가 리터럴 false 라 아래 값들이 죽은코드로 사라지고 원래 표기가 남는다.
 */
export const BRAND = {
  /** 사이드바·모바일 헤더 로고 */
  app: IS_DEMO ? "ERP_DAON" : "ERP_UGD",
  /** 로고 아래 한 줄 */
  tagline: IS_DEMO ? "다온F&B 마감 총괄 시스템" : "UGD 주식회사 마감 총괄 시스템",
  /** 대시보드 상단 작은 머리말 */
  kicker: IS_DEMO ? "DAON Finance Control" : "UGD Finance Control",
  /** 로그인 화면 큰 글자 · 손익 이미지 워터마크 · 엑셀 파일명 앞머리 */
  short: IS_DEMO ? "DAON" : "UGD",
};
