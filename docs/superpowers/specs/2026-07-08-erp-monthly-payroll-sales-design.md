# ERP 월말마감 — 정직원 급여대장 & 매출집계 설계서

- 날짜: 2026-07-08
- 대상 앱: `erp_ugd` (React 19 + Vite + Express, 로컬 미리보기 `http://localhost:3000`)
- 작성 배경: 월말마감정산에 (A) 정직원 급여대장 탭 신설, (B) 매입매출 탭에 매출집계 섹션 추가
- 배포 정책: **자동 배포 금지.** 모든 수정은 로컬 미리보기로 확인 후, 사용자가 직접 배포한다.

---

## 0. 확정된 설계 결정 (사용자 승인)

1. **정직원 명단 출처** → 직원현황(직원명부) 정직원 자동연동 + 수동 행 추가/삭제 보완
2. **총 금액 계산식** → 이달급여 + 택시비 및 기타지출 + 상여금(팁) + 추가근무 (전월급여 제외)
3. **탭 잠금 비밀번호** → 급여대장 전용 비밀번호 신설 (관리자 설정에서 관리)
4. **매출집계 실매출** → 직접 입력, 총매출−총할인과 일치하는지 검증만

---

## 기능 A — 정직원 급여대장 탭

### A-1. 위치
- 월말마감정산 하위탭(`monthlySubTabs`)의 **맨 첫 번째**에 신설.
- 최종 순서: `정직원 급여대장` → `매입매출` → `파트타이머 급여대장` → `현금관리` → `현금지출` → `카드지출`
- 탭 id: `fullTimeSalary`

### A-2. 컬럼 정의 (좌→우 15개)
| # | 컬럼명 | 입력 방식 | 비고 |
|---|---|---|---|
| 1 | 분류 | 자동 고정값 "정직원" | 수정 불가 |
| 2 | 성명 | 직원현황 자동 (`name`) | |
| 3 | 직급 | 직원현황 자동 (`rank`/`customRank`) | |
| 4 | 주민등록번호 | 직원현황 자동 (`residentNumber`) | |
| 5 | 입사일 | 직원현황 자동 (`entryDate`/`hireDate`) | |
| 6 | 근로계약 | 직원현황 자동 (`contractType`, 4대보험/3.3%) | |
| 7 | 입금계좌 | 급여대장에서 직접 입력 | 직원현황에 필드 없음, 입력값은 월/직원별로 유지 |
| 8 | 전월급여 | 지난달 "이달급여" 자동 로드 후 수정 가능 | 지난달 데이터 없으면 빈칸 |
| 9 | 이달급여 | 직접 입력 (숫자) | |
| 10 | 택시비 및 기타지출 | 직접 입력 (숫자) | |
| 11 | 상여금(팁) | 직접 입력 (숫자) | |
| 12 | 추가근무 | 직접 입력 (숫자, 금액) | |
| 13 | **총 금액** | **자동 = 이달급여 + 택시비및기타지출 + 상여금(팁) + 추가근무** | 읽기전용 |
| 14 | 실제 송금지점 | **본사 관리자만 입력**, 지점은 읽기전용(회색 잠김) | `isAdmin` 기준 |
| 15 | 기타내용 | 직접 입력 (텍스트) | |

### A-3. 명단 자동연동 + 수동 보완
- 로드 시 직원현황(`gasClient.getStaffRoster` 또는 로컬 `erp_staff_list_${branchName}`)에서 `division === "정직원"`인 직원을 행으로 생성.
- 자동 채움 컬럼: 성명·직급·주민번호·입사일·근로계약.
- 이미 저장된 급여대장 데이터가 있으면, 직원 매칭(employeeId/성명+주민번호 기준) 후 입력값 병합.
- **수동 행 추가/삭제 버튼** 제공 (명단에 없는 사람 처리). 수동 행은 성명·직급 등도 직접 입력.

### A-4. 합계 행
- 표 맨 아래에 합계 행 1개 고정.
- **총 금액 열 = 전 직원 총금액 합계** (필수 요구사항).
- 이달급여·택시비·상여금·추가근무 등 금액 열도 각 열 합계를 함께 표시(가독성).

### A-5. 탭 잠금 (비밀번호)
- 탭 클릭(진입) 시 **비밀번호 입력 모달** 표시 → 일치해야 표 렌더링, 불일치 시 접근 차단.
- 한 번 인증되면 **로그아웃/새로고침 전까지** 유지(세션 단위). 다른 탭 갔다 돌아와도 재입력 없음.
- 비밀번호 출처: `adminSettings.fullTimeSalaryPasscode` (신설). 기본값 `"1234"`.
- 관리자 설정 화면(`AdminPage.tsx`의 보안 탭)에 **급여대장 전용 비밀번호 설정 입력란 신설** → 변경 가능.

### A-6. 저장 / 동기화
- 매입매출 탭과 동일 패턴 사용:
  - localStorage: `erp_monthly_fulltime_salary_${branchName}_${selectedMonth}`
  - 공유(크로스-컴퓨터): `saveSharedData("monthly_fulltime_salary:${branchName}:${selectedMonth}", rows)` / `getSharedData(...)`
  - pending 키 + 450ms 디바운스 자동저장, 탭 언마운트 시 pending flush.
- 탭 나갔다 와도 유지, 모든 컴퓨터에서 동일 표시.

### A-7. 확정 잠금
- 기존 `isLocked`(월말마감 확정 시) 로직을 동일 적용 → 확정 후 입력 잠금, 수정 버튼으로 해제.

---

## 기능 B — 매입매출 탭 상단 "매출집계" 섹션

### B-1. 위치
- `MonthlyPurchaseSalesSubTab` **맨 위**(기존 "월말 이체 필요한 거래처 등록" 표 위)에 새 섹션 삽입.

### B-2. 입력 항목
- **매출 요약**: 총매출 · 총할인 · 실매출(직접입력) · 영수건수 · 영수단가(자동)
- **결제 구성**: 카드결제 · 단순현금결제 · 현금영수증
- **매출 구성**: 메뉴매출 · 주류매출 · 자리값 · (종매출: 자동합계 표시)

### B-3. 자동 계산
- **영수단가 = 실매출 ÷ 영수건수** (영수건수 0 또는 빈칸이면 계산 안 함). 읽기전용.
- **종매출 = 메뉴매출 + 주류매출 + 자리값** (자동 표시).

### B-4. 검증 & 경고말풍선
경고는 해당 위치에 빨간 말풍선(툴팁/배너)으로 표시.
1. `총매출 − 총할인 ≠ 실매출` → 경고
2. `카드결제 + 단순현금결제 + 현금영수증 ≠ 실매출` → 경고
3. `메뉴매출 + 주류매출 + 자리값(종매출) ≠ 실매출` → 경고
4. **빈칸 사유**: 위 항목 중 빈칸이 하나라도 있으면 그 칸에 대한 **사유 입력란**이 나타남. 사유 미입력 상태의 빈칸이 있으면 경고.
   - (금액이 실제 0원이면 0을 입력하면 되고, 비워둔 경우에만 사유를 받는다.)

### B-5. 마감제출 차단
- 위 경고(1~4) 중 하나라도 활성 상태면 **월말마감 확정(`handleConfirmMonthlyClose`) 비활성화/차단**.
- 구현(확정): 매출집계 섹션이 유효성 결과를 전역 플래그 `window.__ugdSalesSummaryInvalid`(기존 `window.__ugdLiquorInventoryDirty` 패턴과 동일)로 노출하고, `handleConfirmMonthlyClose` 실행 초입에서 이 플래그가 true면 토스트 경고 후 중단한다. 확정 버튼도 동일 상태로 비활성화한다.

### B-6. 저장 / 동기화
- 별도 공유 키로 저장:
  - localStorage: `erp_monthly_sales_summary_${branchName}_${selectedMonth}`
  - 공유: `monthly_sales_summary:${branchName}:${selectedMonth}`
  - 자동저장(450ms 디바운스) + pending flush, 크로스-컴퓨터 동기화.
- 필드: 총매출·총할인·실매출·영수건수·카드결제·단순현금결제·현금영수증·메뉴매출·주류매출·자리값 + 각 빈칸 사유 맵.
- 확정 잠금(`isLocked`) 시 입력 잠금.

---

## 데이터 모델 요약

```
FullTimeSalaryRow {
  id, employeeId?, name, rank, residentNumber, entryDate, contractType,
  accountNumber, prevSalary, thisSalary, taxiEtc, bonusTip, overtimePay,
  // 총금액 = thisSalary + taxiEtc + bonusTip + overtimePay (파생, 저장 안 해도 됨)
  remitBranch,   // 본사 전용
  memo,
  isManual?      // 수동 추가 행 여부
}

SalesSummary {
  totalSales, totalDiscount, netSales, receiptCount,   // 영수단가 파생
  cardPay, cashPlain, cashReceipt,
  menuSales, liquorSales, seatCharge,                  // 종매출 파생
  blankReasons: { [fieldName]: string }
}
```

---

## 변경 파일 목록 (예정)

| 파일 | 변경 내용 |
|---|---|
| `src/pages/branch/tabs/MonthlyFullTimeSalarySubTab.tsx` | **신설** — 정직원 급여대장 탭 |
| `src/pages/branch/tabs/SalesSummarySection.tsx` (또는 매입매출 탭 내부) | **신설** — 매출집계 섹션 |
| `src/pages/branch/tabs/MonthlyPurchaseSalesSubTab.tsx` | 상단에 매출집계 섹션 삽입, 검증 신호 노출 |
| `src/pages/branch/tabs/MonthlySettleTab.tsx` | `fullTimeSalary` 서브탭 라우팅, 확정 차단 연동 |
| `src/pages/BranchConfirmPage.tsx` | `monthlySubTabs` 맨 앞에 급여대장 탭 추가, 탭 잠금 모달 배선, `adminSettings` 기본값에 `fullTimeSalaryPasscode` 추가 |
| `src/pages/AdminPage.tsx` | 보안 설정에 급여대장 전용 비밀번호 입력란 신설 |
| `src/pages/branch/types.ts` | `BranchDailyTab`/서브탭 타입에 `fullTimeSalary` 등 추가 |

---

## 범위 밖 (Non-goals)
- 급여 세금(3.3%/4대보험) 자동 계산은 이번 범위 아님(입력값 그대로 사용).
- 직원현황에 입금계좌 필드를 추가하지는 않음(급여대장에서만 입력).
- POS/구글시트 연동 스키마 변경 없음(기존 `saveSharedData` 그대로 활용).

## 검증 방법
- 로컬 `http://localhost:3000` 미리보기(로컬 모의 데이터 모드)에서:
  - 급여대장 탭: 비밀번호 잠금, 자동연동/수동행, 총금액·합계 자동계산, 실제송금지점 지점 잠금 확인.
  - 매출집계: 영수단가/종매출 자동계산, 3종 불일치 경고, 빈칸 사유, 경고 시 마감확정 차단 확인.
  - 탭 이동 후 값 유지(자동저장) 확인.
