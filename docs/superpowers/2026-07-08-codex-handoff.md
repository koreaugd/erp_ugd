# ERP 월말마감(정직원 급여대장 + 매출집계) — Codex 이어작업 핸드오프

- 날짜: 2026-07-08
- 리포: `koreaugd/erp_ugd` (main), 앱: React19+Vite+Express, 로컬 미리보기 `http://localhost:3000` (`npm run dev`)
- 상태: **미커밋 / 미배포.** Codex 지독한 검증에서 다수 결함이 나와 커밋·배포 보류.
- 검증 방식: `npx tsc --noEmit` (테스트 프레임워크 없음) + localhost 시각 확인. 배포: push→GitHub Actions(`.github/workflows/deploy.yml`).

## 이번 세션에서 구현한 것 (지점화면)

### A. 정직원 급여대장 탭 (신규)
- 파일: `src/pages/branch/tabs/MonthlyFullTimeSalarySubTab.tsx` (신규)
- 월말마감정산 하위탭 **맨 앞**에 추가. 배선: `BranchConfirmPage.tsx`(monthlySubTabs, monthlyTab 타입, adminSettings.fullTimeSalaryPasscode), `MonthlySettleTab.tsx`(activeSubTab 타입 + 렌더).
- 15컬럼(분류/성명/직급/주민번호/입사일/근로계약/입금계좌/전월급여/이달급여/택시비및기타지출/상여금/추가근무/총금액/실제송금지점/기타내용). 총금액=이달급여+택시비+상여금+추가근무. 맨아래 합계행.
- 직원현황(정직원) 자동연동(이름 등 채움) + 전 컬럼 수정 가능 + 수동 행 추가. 지점화면은 분류·실제송금지점 컬럼 숨김(관리자만 표시). 실제송금지점은 관리자만 입력.
- 탭 진입 시 전용 비밀번호(관리자 설정 `format` 탭 `fullTimeSalaryPasscode`, 기본 1234). 세션 단위 잠금 해제.
- 저장: local `erp_monthly_fulltime_salary_${b}_${m}` + shared `monthly_fulltime_salary:${b}:${m}`, 450ms 디바운스.

### B. 매출집계 섹션 (매입매출 탭 상단, 신규)
- 파일: `src/pages/branch/tabs/SalesSummarySection.tsx` + 검증/동기화 헬퍼 `src/pages/branch/helpers/salesSummary.ts` (신규). `MonthlyPurchaseSalesSubTab.tsx` 상단에 삽입.
- 항목: 총매출/총할인/실매출/영수건수/영수단가(자동=실매출/영수건수) · 카드결제/단순현금/현금영수증 · 메뉴/주류/자리값→종매출(자동).
- 검증(공유 헬퍼): 총매출−총할인≠실매출, 카드+현금+현금영수증≠실매출, 종매출≠실매출 → 실시간 경고. 빈칸은 마감제출 시에만 강조+맨아래 1줄 사유.
- 마감제출 차단: `MonthlySettleTab.handleConfirmMonthlyClose`가 `loadLatestSalesSummary`로 직접 로드→`isSalesSummaryInvalid`로 검증→통과 시 `saveSalesSummaryIfNewer`로 공유 반영 확인 후 마감.
- 저장: local `erp_monthly_sales_summary_${b}_${m}` + shared `monthly_sales_summary:${b}:${m}`.

### C. 기타 변경 (MonthlySettleTab)
- 버튼명: 마감제출/마감수정/마감취소. 마감 확정 시 엑셀 알림창·다운로드 제거. "현재 마감 상태"를 상단 헤더로 병합. 급여대장 탭에도 마감 버튼 노출.

### 동기화 설계(매출집계) — 요지
- 로컬/백엔드 중 **updatedAt 최신본** 선택(`loadLatestSalesSummary`). 모든 백엔드 쓰기는 `saveSalesSummaryIfNewer`로 감싸 **백엔드가 최신/동률이면 쓰지 않음**, 읽기 실패 시 쓰지 않고 pending 유지. 로드 전 편집 차단(`loaded` 게이트).

## Codex 지독한 검증에서 남은 결함 (이어서 고칠 것)

1. **[high] `saveSalesSummaryIfNewer` TOCTOU 경합** — read-then-write 비원자성. 완전 해결은 백엔드(Firestore) 트랜잭션/조건부 쓰기 필요(현재 `gasClient.saveSharedData`엔 조건부 쓰기 없음, 앱 전체 공통 한계). 대안: gasClient에 CAS(compare-and-set) 지원 추가 후 사용.
2. **[high] 마감확정이 급여대장 저장을 보장 안 함** — `handleConfirmMonthlyClose`가 급여대장(pending 디바운스)을 flush/확인하지 않고 확정 가능. → 매출집계처럼 급여대장도 확정 전 공유 반영 보장 필요.
3. **[high] 급여대장에 시각/버전 충돌 보호 없음** — `MonthlyFullTimeSalarySubTab`은 아직 pendingKey 방식 + 무조건 `saveSharedData`. → 매출집계와 동일하게 각 행/문서에 `updatedAt` 부여하고 `saveXIfNewer`+`loaded` 게이트 적용 필요(낡은 급여대장이 최신본 덮어쓰기 방지).
4. **[medium] 엑셀 내보내기에 정직원 급여 시트 누락** — `MonthlySettleTab` 엑셀 생성(≈508–512)이 `monthly_fulltime_salary`를 안 읽음. (단, 엑셀은 관리자 화면 지점별 다운로드로 재설계 예정 — 사용자 지시)
5. **[medium] 급여대장 비번 하드코딩 폴백** — `readPasscode`가 설정 미로드 시 `"1234"` 폴백. 공유 설정 비동기 로드 전이면 변경된 비번이 적용 안 됨. → 설정 로드 완료 전 잠금 유지 또는 원격 설정 확정 후 판정.

## 아직 시작 안 한 요청 (관리자 화면)
- **관리자화면 #1**: `AdminPage.tsx`(2,972줄) 상단 가로 서브탭(dailySettlementTab/monthlyClosingTab/closingView 등)을 지점화면식 **사이드바 하위탭**으로 개편. 좌측 aside의 메인 섹션(dashboard/dailySettlement/monthlyClosing/annualLeave/laborContracts) 하위로 서브탭 이동. 사용자 확정 그룹핑: (미확정 — 사용자에게 재확인 필요).
- **관리자화면 #2**: 관리자 화면에 **지점별 월말마감 현황판**(제출 상태·시각·완료여부; `monthly_closings` 공유데이터 기반) + **지점별 엑셀 다운로드 버튼**(양식은 추후 첨부, 지금은 버튼만, 디자인 적용).

## 참고
- 설계서: `docs/superpowers/specs/2026-07-08-erp-monthly-payroll-sales-design.md`
- 구현계획: `docs/superpowers/plans/2026-07-08-erp-monthly-payroll-sales.md`
- 이전 세션 미커밋(초과근무 수정건, 범위 밖): `gasClient.ts`, `OvertimeLogTab.tsx`, `AdminRecordEditModal.tsx` — 이번 작업과 분리해서 다룰 것.
