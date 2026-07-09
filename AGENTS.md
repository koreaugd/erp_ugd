# ERP_UGD release rules

- All business data must be shared across devices. When adding or changing ERP features, store branch-entered business data in the shared backend (`gasClient.saveSharedData`, Firestore, or GAS/Sheets), not only in `localStorage`. Use `localStorage` only as a cache/draft/session fallback, and always load/merge shared data so the same branch sees the same values on every computer.

- 모든 업무 데이터는 Google Sheets/GAS 공통 저장소를 기준으로 한다. 브라우저 `localStorage`는 세션·캐시·개인 편의 설정에만 사용한다.
- 코드 수정 후에는 `npm run lint`와 `npm run build`를 통과시킨다.
- **[상시 지침] 코드 수정 시 Codex 지독한 리뷰 필수.** ERP 코드를 변경하면 배포 전 반드시 Codex 리뷰(codex 플러그인의 `adversarial-review`, `--scope working-tree`)로 오류·충돌·회귀를 검증하고, 지적사항을 모두 반영해 `approve`를 받은 뒤 사용자 확인을 거쳐 배포한다. 이 규칙은 앞으로 모든 세션에 상시 적용한다.
- 프론트엔드 변경은 `main` 브랜치에 푸시해 GitHub Pages 배포 성공을 확인한다.
- `gas/Code.gs`를 변경한 경우에는 Apps Script 프로젝트에도 푸시하고, 기존 웹앱 배포를 새 버전으로 갱신한다. 새 배포를 만들지 않아 `/exec` URL을 유지한다.
- 배포 후에는 실제 웹앱 URL과 GAS 응답을 확인한다.
- 배포된 `VITE_GAS_URL`만 사용한다. 기기별 `custom_gas_url` 값으로 공통 백엔드를 덮어쓰지 않는다.
