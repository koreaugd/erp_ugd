# BranchConfirmPage.tsx 안전 분리 — 설계 및 실행 계획

작성일: 2026-07-04
대상: `src/pages/BranchConfirmPage.tsx` (10,533줄)
브랜치: `refactor/split-branchconfirmpage` / 백업 태그: `backup-before-branchsplit-20260704`

## 목표

10,533줄 한 파일에 몰려 있는 15개 업무 화면(탭)을 파일 단위로 분리해, 향후 수정 시
"한 군데 고치다 다른 기능을 깨뜨리는" 위험을 줄인다. **동작은 한 줄도 바꾸지 않는다.**

## 핵심 원칙: 코드를 고치지 않고 옮기기만 한다

- 로직/계산식/저장방식/화면 렌더링을 **새로 쓰지 않는다.** 기존 코드를 그대로 잘라 다른
  파일로 옮기고, import/export 연결선만 추가한다.
- 이렇게 하면 동작이 바뀔 여지가 원천적으로 거의 없다.

## 안전장치 (자동 테스트가 없으므로 이걸로 대체)

1. **타입검사** `npm run lint`(`tsc --noEmit`): 연결선 오류를 즉시 잡는 1차 그물. 기준선 통과 확인함(2026-07-04, exit 0).
2. **실제 앱 확인**: 옮긴 탭을 앱에서 직접 열어 화면·버튼·저장 정상 여부 눈으로 확인.
3. **한 번에 하나 + 개별 되돌리기**: 탭 1개 = 커밋 1개. 문제 시 그 하나만 revert.
4. **작업 격리**: `main`이 아닌 `refactor/split-branchconfirmpage` 브랜치에서 진행. 시작 전 `main` 상태를 태그로 백업.
5. **각 단계 코덱스 adversarial review**: 매 단계 완료 시 `codex-companion.mjs adversarial-review`로 지독하게 검증. review gate도 활성화되어 stop 시 자동 검토.

## 현재 파일 구조 (시작 라인)

| 라인 | 요소 | 대략 크기 |
|---|---|---|
| 20~514 | 공통 헬퍼 함수 ~50개 + 타입 | 495 |
| 515~691 | `BranchConfirmPage` (메인 export) | 176 |
| 692~2132 | `ActiveWorkspace` (탭 라우팅 래퍼) | 1440 |
| 2133 | `BranchDashboardTab` | 243 |
| 2376 | `AdminRecordEditModal` (공유 모달) | 47 |
| 2423 | `DailySettleTab` | 2618 (최대) |
| 5041 | `OfficeWorkLogTab` (+중간 헬퍼 5292/5307/5317) | 1071 |
| 6112 | `RosterTab` | 1023 |
| 7135 | `AnnualLeaveTab` | 18 |
| 7153 | `LaborContractTab` | 32 |
| 7185 | `OvertimeLogTab` | 361 |
| 7546 | `PartTimeLogTab` | 438 |
| 7984 | `MonthlySettleTab` | 776 |
| 8760 | `MonthlyPurchaseSalesSubTab` | 476 |
| 9236 | `MonthlyPartTimeSalarySubTab` | 653 |
| 9889 | `MonthlyCashExpensesSubTab` | 231 |
| 10120 | `MonthlyCashManagementSubTab` | 191 |
| 10311 | `MonthlyCardExpensesSubTab` | 223 |

핵심 관찰: **탭들은 이미 모듈 최상위 함수이며 `{ branchName }` 같은 props만 받는다**(부모 상태를
클로저로 붙잡지 않음). 따라서 잘라내기가 비교적 안전하다.

## 목표 폴더 구조

```
src/pages/branch/
├─ BranchConfirmPage.tsx     (메인 + ActiveWorkspace 라우팅, 슬림)
├─ types.ts                  (공통 타입)
├─ helpers/
│   ├─ formatters.ts         (숫자/날짜/전화/주민번호 포맷)
│   ├─ staffHelpers.ts       (직원명부·검증)
│   └─ memoMetadata.ts       (메모 저장 형식)
└─ tabs/
    ├─ BranchDashboardTab.tsx
    ├─ DailySettleTab.tsx
    ├─ OfficeWorkLogTab.tsx
    ├─ RosterTab.tsx
    ├─ AnnualLeaveTab.tsx
    ├─ LaborContractTab.tsx
    ├─ OvertimeLogTab.tsx
    ├─ PartTimeLogTab.tsx
    ├─ MonthlySettleTab.tsx (+ 서브탭 5개 각각 파일)
    └─ AdminRecordEditModal.tsx
```

헬퍼 처리 규칙: **2개 이상 탭이 쓰는 헬퍼만** `helpers/`로 이동. 특정 탭 전용 헬퍼(예:
`getLiquorCategoryClass`)는 해당 탭 파일로 함께 이동.

## 실행 순서 (작고 단순한 것 → 크고 복잡한 것)

큰 탭에서 처음 시도하면 실수 시 확인 범위가 너무 넓다. 작은 탭으로 방식을 먼저 증명한다.

- **Phase 0 (완료)**: 브랜치 생성, 백업 태그, 기준선 타입검사 통과, 설계문서 커밋.
- **Phase 1 — 공통 부품**: 공유 헬퍼·타입을 `helpers/`·`types.ts`로 작은 묶음씩 이동.
  각 묶음 후 타입검사, 완료 시 코덱스 adversarial review.
- **Phase 2 — 작은 탭**: `AnnualLeaveTab`(18) → `LaborContractTab`(32) → `AdminRecordEditModal`(47).
  방식 검증 단계.
- **Phase 3 — 중간 탭**: `MonthlyCashManagementSubTab`(191) → `MonthlyCardExpensesSubTab`(223)
  → `MonthlyCashExpensesSubTab`(231) → `BranchDashboardTab`(243) → `OvertimeLogTab`(361)
  → `PartTimeLogTab`(438) → `MonthlyPurchaseSalesSubTab`(476) → `MonthlyPartTimeSalarySubTab`(653)
  → `MonthlySettleTab`(776).
- **Phase 4 — 큰 탭**: `RosterTab`(1023) → `OfficeWorkLogTab`(1071) → `DailySettleTab`(2618).
- **Phase 5 — 마무리**: 메인 파일 슬림 확인, 전체 최종 코덱스 adversarial review, `main` 병합 여부 사용자 확인.

각 탭 이동 = 커밋 1개 + 타입검사 + 앱 확인 + 코덱스 adversarial review.

## 이번 작업 범위 밖 (별도 작업)

`src/index.css`(!important 1003회), `AdminPage.tsx`(2,971줄), 데이터 3중 경로
(`gasClient`/`firebaseDirect`/`server.ts`)는 **건드리지 않는다.** 오직 `BranchConfirmPage.tsx`
나누기만 한다.

## 롤백 전략

- 특정 탭 이동이 문제: 해당 커밋만 `git revert`.
- 전체 되돌리기: `git checkout main` 후 브랜치 폐기 (main은 백업 태그로도 보존).
