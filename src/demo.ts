// 시연용 인스턴스 플래그.
// `npm run build:demo`(vite --mode demo)로 빌드했을 때만 true가 된다.
// __IS_DEMO__는 vite.config.ts의 define으로 빌드 시점에 리터럴 true/false로 치환되므로,
// 운영 빌드에서는 데모 분기가 죽은코드 제거로 통째로 사라진다.
// 제거 여부는 scripts/demo/check_prod_bundle.mjs가 기계 검사한다 — 이 파일을 고치면 반드시 재실행할 것.
export const IS_DEMO: boolean = __IS_DEMO__;

// 데모가 지원하지 않는 외부 연동을 호출했을 때 보여줄 한 줄(demoGas 의 마지막 분기).
export const DEMO_NOT_SUPPORTED_MESSAGE = "시연용 인스턴스에서는 외부 연동 기능이 꺼져 있습니다.";
