# ERP 월말마감 정직원 급여대장 & 매출집계 Implementation Plan

> **For agentic workers:** 이 계획은 이 세션에서 인라인으로 실행한다(executing-plans). 각 Task는 `- [ ]` 체크박스로 추적. 서브에이전트 병렬 실행은 사용자가 요청하지 않는 한 사용하지 않는다.

**Goal:** 월말마감정산에 (A) 비밀번호로 잠긴 정직원 급여대장 탭과, (B) 매입매출 탭 상단 매출집계 섹션(검증·경고·마감차단)을 추가한다.

**Architecture:** 기존 월말 서브탭 패턴(localStorage + `gasClient.saveSharedData`/`getSharedData` + 450ms 디바운스 자동저장 + `isLocked` 확정잠금)을 그대로 재사용한다. 급여대장은 신규 서브탭 파일, 매출집계는 매입매출 탭 상단 섹션으로 삽입한다.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, lucide-react. 테스트 프레임워크 없음.

## Global Constraints

- **테스트 없음** → 각 Task 검증 = `npm run lint`(tsc --noEmit) 통과 + `http://localhost:3000` 시각 확인.
- **자동 배포/커밋 금지.** 커밋은 사용자가 요청할 때만. 배포는 최종 승인 후 사용자가 직접.
- 기존 서브탭 코드 패턴을 따를 것(참고: `MonthlyPurchaseSalesSubTab.tsx`).
- 금액 입력은 `formatWithCommas`/`cleanNumeric`(helpers/formatters) 관례 사용.
- 정직원 급여대장 탭 id: `fullTimeSalary`. 매출집계는 별도 탭 아님(매입매출 상단 섹션).
- 저장 키:
  - 급여대장: local `erp_monthly_fulltime_salary_${branch}_${month}`, shared `monthly_fulltime_salary:${branch}:${month}`
  - 매출집계: local `erp_monthly_sales_summary_${branch}_${month}`, shared `monthly_sales_summary:${branch}:${month}`
- 총 금액 = 이달급여 + 택시비및기타지출 + 상여금(팁) + 추가근무.
- 매출집계 실매출 = 직접 입력. 영수단가 = 실매출 ÷ 영수건수(자동). 종매출 = 메뉴+주류+자리값(자동).

---

## Phase 1 — 정직원 급여대장 탭 (기능 A)

### Task A1: 탭 등록 + 빈 컴포넌트 셸

**Files:**
- Create: `src/pages/branch/tabs/MonthlyFullTimeSalarySubTab.tsx`
- Modify: `src/pages/BranchConfirmPage.tsx` (monthlySubTabs, monthlyTab 타입)
- Modify: `src/pages/branch/tabs/MonthlySettleTab.tsx` (activeSubTab 타입 + 라우팅)

**Interfaces:**
- Produces: `MonthlyFullTimeSalarySubTab({ branchName, selectedMonth, triggerToast, isAdmin, isLocked, resetToken })` — 시그니처는 `MonthlyPurchaseSalesSubTab`에 `isAdmin` 추가한 형태.

- [ ] **Step 1:** `MonthlyFullTimeSalarySubTab.tsx` 생성 — 우선 제목/자동저장 배지만 있는 셸 반환(빈 div). props 시그니처 위와 동일.
- [ ] **Step 2:** `BranchConfirmPage.tsx` `monthlyTab` 유니온 타입 맨 앞에 `"fullTimeSalary"` 추가, `monthlySubTabs` 배열 맨 앞에 `{ id: "fullTimeSalary", label: "정직원 급여대장", icon: Users }` 추가(아이콘 import 정리). 기본 선택 탭은 `purchaseSales` 유지.
- [ ] **Step 3:** `MonthlySettleTab.tsx` `MonthlySettleTabProps.activeSubTab` 유니온에 `"fullTimeSalary"` 추가, 렌더 분기에 `activeSubTab === "fullTimeSalary" && <MonthlyFullTimeSalarySubTab .../>` 추가(기존 서브탭들이 렌더되는 위치와 동일 패턴). `isAdmin`, `selectedMonth`, `triggerToast`, `isLocked` 전달.
- [ ] **Step 4:** `npm run lint` → 타입 통과 확인.
- [ ] **Step 5:** localhost 확인 — 월말마감정산에 "정직원 급여대장" 탭이 **맨 앞**에 보이고 클릭 시 셸이 뜬다.

### Task A2: 탭 잠금 비밀번호 + 관리자 설정

**Files:**
- Modify: `src/pages/BranchConfirmPage.tsx` (adminSettings 기본값에 `fullTimeSalaryPasscode: "1234"`)
- Modify: `src/pages/branch/tabs/MonthlySettleTab.tsx` (adminSettings 기본값 동일 추가; 급여대장 탭 진입 시 잠금 게이트)
- Modify: `src/pages/AdminPage.tsx` (보안 설정에 입력란)
- Modify: `src/pages/branch/tabs/MonthlyFullTimeSalarySubTab.tsx` (잠금 모달 UI)

**Interfaces:**
- Consumes: `adminSettings.fullTimeSalaryPasscode: string`.
- Produces: 세션 인증 상태(모듈 스코프 또는 상위 state) — 한 번 인증 시 재입력 없음.

- [ ] **Step 1:** `BranchConfirmPage.tsx`와 `MonthlySettleTab.tsx`의 adminSettings 기본 객체에 `fullTimeSalaryPasscode: "1234"` 추가.
- [ ] **Step 2:** `MonthlyFullTimeSalarySubTab.tsx`에 잠금 게이트 구현: `const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem("erp_fulltime_salary_unlocked") === "1")`. `unlocked`가 false면 비밀번호 입력 모달만 렌더(성명/급여 등 데이터는 렌더 안 함). 입력값이 `adminSettings.fullTimeSalaryPasscode`와 일치하면 `setUnlocked(true)` + `sessionStorage.setItem("erp_fulltime_salary_unlocked","1")`. 불일치 시 에러 문구.
  - adminSettings는 `localStorage.getItem("erp_admin_settings")`에서 로드(기존 서브탭과 동일하게 `admin_settings_updated` 이벤트 구독).
- [ ] **Step 3:** `AdminPage.tsx` 보안 탭에 "정직원 급여대장 비밀번호" 텍스트 입력 추가 → `fullTimeSalaryPasscode` 저장(기존 `adminSecurityPasscode` 입력 UI/저장 로직과 동일 패턴 복제).
- [ ] **Step 4:** `npm run lint` 통과.
- [ ] **Step 5:** localhost 확인 — 탭 클릭 시 비밀번호 요구, 1234 입력 시 열림, 다른 탭 갔다 와도 재입력 없음. 관리자 설정에서 비밀번호 변경 반영.

### Task A3: 급여대장 표 (자동연동 + 수동행 + 계산 + 합계)

**Files:**
- Modify: `src/pages/branch/tabs/MonthlyFullTimeSalarySubTab.tsx`

**Interfaces:**
- Produces: `FullTimeSalaryRow` 타입:
  ```ts
  interface FullTimeSalaryRow {
    id: string; employeeId?: string; name: string; rank: string;
    residentNumber: string; entryDate: string; contractType: string;
    accountNumber: string; prevSalary: string; thisSalary: string;
    taxiEtc: string; bonusTip: string; overtimePay: string;
    remitBranch: string; memo: string; isManual?: boolean;
  }
  ```
- Consumes: `gasClient.getStaffRoster(branchName)` 또는 localStorage `erp_staff_list_${branchName}`(RosterEmployee[]).

- [ ] **Step 1:** 로스터 로드 → `division === "정직원"`인 직원을 행으로 매핑(성명·직급(`rank||customRank`)·주민번호·입사일(`entryDate||hireDate`)·근로계약(`contractType`) 자동 채움, 급여/계좌 칸은 빈값). employeeId로 식별.
- [ ] **Step 2:** 표 렌더 — 15개 컬럼(설계서 A-2 순서). 분류는 "정직원" 고정 텍스트. 자동연동 컬럼은 읽기전용 표시, 급여/계좌/기타내용은 input. 금액 칸은 `formatWithCommas`/`cleanNumeric` 사용.
- [ ] **Step 3:** 총 금액 파생 계산: `Number(cleanNumeric(thisSalary)) + taxiEtc + bonusTip + overtimePay` — 읽기전용 표시.
- [ ] **Step 4:** 실제 송금지점 칸: `disabled={!isAdmin}` (지점은 회색 잠김·읽기전용), 본사 관리자만 입력.
- [ ] **Step 5:** 수동 행 추가/삭제 버튼(`isManual: true`). 수동 행은 성명·직급·주민번호 등도 입력 가능.
- [ ] **Step 6:** 맨 아래 합계 행: 총 금액 열 = 전 행 총금액 합계(필수). 이달급여·택시비·상여금·추가근무 열도 각 합계 표시.
- [ ] **Step 7:** `npm run lint` 통과.
- [ ] **Step 8:** localhost 확인 — 정직원 자동 표시, 급여 입력 시 총금액/합계 자동계산, 지점 로그인 시 실제송금지점 잠김, 수동행 추가/삭제 동작.

### Task A4: 급여대장 저장/동기화 + 전월급여 자동로드 + 확정잠금

**Files:**
- Modify: `src/pages/branch/tabs/MonthlyFullTimeSalarySubTab.tsx`

- [ ] **Step 1:** `MonthlyPurchaseSalesSubTab`의 저장 패턴 복제 — storageKey/sharedKey/pendingKey, load 순서(pending local → remote shared → local → 이전달 → roster 기본), `persistRows`(450ms 디바운스 + pending flush), 언마운트 flush.
- [ ] **Step 2:** 전월급여 자동로드 — 현재 월 저장값 없을 때, 이전달 shared(`monthly_fulltime_salary:${branch}:${prevMonth}`)에서 각 직원의 `thisSalary`를 이번달 `prevSalary`로 복사(수정 가능).
- [ ] **Step 3:** `isLocked`일 때 모든 input `disabled`, 추가/삭제 버튼 비활성(기존 패턴 동일). 잠금 안내 배너.
- [ ] **Step 4:** `npm run lint` 통과.
- [ ] **Step 5:** localhost 확인 — 값 입력 후 다른 탭 갔다 와도 유지, (동일 브라우저 새로고침 후에도 유지), 전월급여 자동 표시.

---

## Phase 2 — 매입매출 매출집계 섹션 (기능 B)

### Task B1: 매출집계 섹션 UI + 자동계산

**Files:**
- Modify: `src/pages/branch/tabs/MonthlyPurchaseSalesSubTab.tsx` (상단에 섹션 삽입 + 상태)

**Interfaces:**
- Produces: `SalesSummary` 상태:
  ```ts
  interface SalesSummary {
    totalSales: string; totalDiscount: string; netSales: string; receiptCount: string;
    cardPay: string; cashPlain: string; cashReceipt: string;
    menuSales: string; liquorSales: string; seatCharge: string;
    blankReasons: Record<string, string>;
  }
  ```

- [ ] **Step 1:** `SalesSummary` 상태 추가(기본 빈 문자열). 매입 표 위에 카드형 섹션 렌더: 3그룹(매출요약/결제구성/매출구성) 입력.
- [ ] **Step 2:** 영수단가 파생 = `receiptCount>0 ? round(netSales/receiptCount) : ""` 읽기전용 표시. 종매출 파생 = `menuSales+liquorSales+seatCharge` 표시.
- [ ] **Step 3:** 금액 입력은 `formatWithCommas`/`cleanNumeric` 사용, `isLocked` 시 disabled.
- [ ] **Step 4:** `npm run lint` 통과.
- [ ] **Step 5:** localhost 확인 — 매입매출 상단에 매출집계 섹션 표시, 영수단가·종매출 자동계산.

### Task B2: 검증 · 경고말풍선 · 빈칸 사유

**Files:**
- Modify: `src/pages/branch/tabs/MonthlyPurchaseSalesSubTab.tsx`

**Interfaces:**
- Produces: `salesSummaryWarnings: string[]`(활성 경고 목록), `hasBlankWithoutReason: boolean`.

- [ ] **Step 1:** 검증 로직(useMemo):
  - w1: `totalSales - totalDiscount !== netSales` (셋 다 값 있을 때)
  - w2: `cardPay + cashPlain + cashReceipt !== netSales`
  - w3: `menuSales + liquorSales + seatCharge !== netSales`
  - 빈칸: 위 필드 중 빈 문자열인 칸 목록 → 각 칸에 사유 입력란 표시. `blankReasons[field]`가 비어있는 빈칸이 있으면 경고.
- [ ] **Step 2:** 경고 UI — 불일치 항목 근처에 빨간 말풍선/배너(lucide `AlertTriangle`). 빈칸 옆에 작은 "사유" 입력란(값 채우면 사라짐).
- [ ] **Step 3:** `npm run lint` 통과.
- [ ] **Step 4:** localhost 확인 — 카드+현금+현금영수증≠실매출, 종매출≠실매출, 총매출−총할인≠실매출 각각 경고. 빈칸 사유 입력란 표시/해제.

### Task B3: 매출집계 저장/동기화 + 확정잠금

**Files:**
- Modify: `src/pages/branch/tabs/MonthlyPurchaseSalesSubTab.tsx`

- [ ] **Step 1:** 매출집계 전용 저장 키(local `erp_monthly_sales_summary_...`, shared `monthly_sales_summary:...`, pending). 로드 순서 기존 패턴 동일(이전달 자동복사 없이 remote→local).
- [ ] **Step 2:** 입력 변경 시 450ms 디바운스 자동저장 + 언마운트 flush. `SalesSummary` 저장 대상은 blankReasons 포함.
- [ ] **Step 3:** `isLocked` 시 매출집계 input disabled.
- [ ] **Step 4:** `npm run lint` 통과.
- [ ] **Step 5:** localhost 확인 — 매출집계 입력 후 탭 이동/새로고침해도 유지.

### Task B4: 마감제출 차단 연동

**Files:**
- Modify: `src/pages/branch/tabs/MonthlyPurchaseSalesSubTab.tsx` (플래그 노출)
- Modify: `src/pages/branch/tabs/MonthlySettleTab.tsx` (`handleConfirmMonthlyClose` 가드 + 버튼 비활성)

- [ ] **Step 1:** 매출집계 컴포넌트: 경고(w1||w2||w3||빈칸미사유)가 있으면 `(window as any).__ugdSalesSummaryInvalid = true` 아니면 `false`로 useEffect에서 동기화. 언마운트 시 false로 정리.
- [ ] **Step 2:** `MonthlySettleTab.handleConfirmMonthlyClose` 초입에서 `if ((window as any).__ugdSalesSummaryInvalid) { triggerToast("매출집계에 경고가 있어 마감 확정할 수 없습니다.", "error"); return; }`.
- [ ] **Step 3:** 확정 버튼에도 동일 조건으로 `disabled` 반영(가능하면 상태로, 아니면 최소 클릭 가드). 
- [ ] **Step 4:** `npm run lint` 통과.
- [ ] **Step 5:** localhost 확인 — 매출집계 경고가 있을 때 월말마감 확정 시도 → 차단 토스트, 경고 해소 후 정상 확정.

---

## Self-Review

- **Spec coverage:** 기능 A(위치/컬럼/자동연동/총금액/합계/실제송금지점 잠금/탭 비밀번호/저장동기화/확정잠금) → A1~A4. 기능 B(매출집계 위치/항목/영수단가/종매출/3종 검증/빈칸사유/마감차단/저장동기화) → B1~B4. 전 요구사항 매핑 확인됨.
- **Placeholder scan:** 각 Task에 파일·키·계산식·검증식 명시. TBD 없음.
- **Type consistency:** `FullTimeSalaryRow`, `SalesSummary` 필드명이 저장/계산/렌더에서 일관. 저장 키 문자열 Global Constraints와 각 Task 일치.
