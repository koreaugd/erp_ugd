/**
 * tsx 로 src 코드를 직접 돌리는 검증 스크립트용 — Vite define 상수의 대체값.
 * vite.config.ts 의 define(__IS_DEMO__)은 빌드 때만 리터럴로 치환되므로, 스크립트에서
 * src/demo.ts 를 불러오면 ReferenceError 로 죽는다. 스크립트의 **첫 import** 로 둘 것
 * (ESM 은 import 순서대로 평가하므로 뒤에 둔 src 모듈보다 먼저 실행된다).
 */
(globalThis as { __IS_DEMO__?: boolean }).__IS_DEMO__ ??= false;
