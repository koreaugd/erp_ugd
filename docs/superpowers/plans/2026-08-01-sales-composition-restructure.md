# 매출구성 섹션 구조 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지점 화면 > 월말마감 > 매입매출 탭의 매출구성 카드를 `메뉴매출 / 주류매출 / 커버차지(자릿값) / 합계 / 예약정산금 / 총 합계` 6줄 구조로 바꾸고, 커버차지를 전 지점 공통 필수 입력으로 연다.

**Architecture:** 저장 필드명(`menuSales`/`liquorSales`/`coverCharge`/`seatCharge`)은 그대로 두고 라벨·배치·검산 규칙만 바꾼다. 금샤빠 전용 분기(`salesSummaryUsesCover`)를 없애 화면과 검산 양쪽에서 지점 분기를 제거한다. 검산 등식은 `메뉴+주류+커버차지 = 실매출`을 유지하고, 예약정산금은 검산 밖에 두어 `총 합계`에만 더한다.

**Tech Stack:** React 19 + TypeScript + Tailwind v4, Vite. 테스트 러너 없음 — 검증은 `npm run lint`(tsc --noEmit) + `npm run build` + `npm run dev` 육안 확인.

**설계서:** [docs/superpowers/specs/2026-08-01-sales-composition-restructure-design.md](../specs/2026-08-01-sales-composition-restructure-design.md)

## Global Constraints

- 저장 필드명 변경 금지. `seatCharge`(=예약정산금), `coverCharge`(=커버차지(자릿값))를 그대로 쓴다. 이미 저장된 마감 데이터와의 호환을 깨지 않기 위함.
- 검산 등식: `menuSales + liquorSales + coverCharge === netSales`. 예약정산금(`seatCharge`)은 검산에 포함하지 않는다.
- 지점 이름으로 분기하지 않는다. 전 지점 동일 화면·동일 규칙.
- 커밋·푸시·배포는 사용자가 직접 지시했을 때만 한다(상시 지침). 각 Task는 커밋 없이 끝내고, 마지막에 일괄 처리 여부를 사용자에게 묻는다.
- UI 수정이므로 `DESIGN.md` 규칙을 따른다. 새 스타일을 만들지 말고 이 파일에 이미 있는 `autoRow`/`rowField`/`cardCls`/`pillTitleCls`를 재사용한다.
- 모든 수정 완료 후 Codex 지독한 리뷰를 돌린다(상시 지침, P0).

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/pages/branch/tabs/SalesSummarySection.tsx` | 매출집계 카드 3종의 상태·검산·렌더 | 필드 정의, 검산 함수 3개, 매출구성 카드 렌더 |
| `src/pages/branch/tabs/MonthlySettleTab.tsx:285` | 마감제출 가드 | 검산 함수 호출 시그니처 변경 반영 |
| `src/pages/branch/helpers/guideSteps.tsx:73-88` | 매입매출 탭 안내 말풍선 | 자릿값 스텝 제목·본문 문구 |
| `src/pages/AdminPage.tsx:3017-3029` | 지점 단건 매출집계 엑셀 | 항목명 변경 + 커버차지 행 추가 |
| `src/pages/AdminPage.tsx:3213-3233` | 전지점 통합 매출집계 엑셀 | 컬럼명 변경 + 커버차지 컬럼 추가 |

`SalesSummarySection.tsx`는 현재 약 470줄로 한 화면 섹션치고 크지 않다. 분리하지 않는다.

---

### Task 1: 검산 규칙에서 지점 분기 제거 + 커버차지 필수화

**Files:**
- Modify: `src/pages/branch/tabs/SalesSummarySection.tsx:33-87`
- Modify: `src/pages/branch/tabs/MonthlySettleTab.tsx:285`

**Interfaces:**
- Consumes: 없음 (첫 Task)
- Produces: `computeSalesSummaryWarnings(input: Partial<SalesSummary> | null): string[]`, `salesSummaryBlankBlocking(input: Partial<SalesSummary> | null): boolean`, `isSalesSummaryDataInvalid(input: Partial<SalesSummary> | null): boolean` — 세 함수 모두 `branchName` 인자가 사라진다. Task 2가 이 시그니처로 호출한다.

- [ ] **Step 1: `REQUIRED_FIELDS`에 커버차지 추가**

`SalesSummarySection.tsx:34-45`의 배열 마지막 `{ key: "seatCharge", label: "자릿값(예약정산금)" }` 항목을 아래 두 줄로 교체한다. 순서는 화면 배치와 맞춘다.

```tsx
  { key: "coverCharge", label: "커버차지(자릿값)" },
  { key: "seatCharge", label: "예약정산금" },
```

- [ ] **Step 2: `salesSummaryUsesCover` 헬퍼 삭제**

`SalesSummarySection.tsx:50-52`의 주석 2줄과 `export const salesSummaryUsesCover = ...` 한 줄을 통째로 지운다. 전 지점 공통이 되어 판정할 것이 없다.

- [ ] **Step 3: `computeSalesSummaryWarnings` 수정**

`SalesSummarySection.tsx:55-73`을 아래로 교체한다. 시그니처에서 `branchName`이 빠지고, `gross`가 지점 분기 없이 세 항목을 더하며, 세 번째 경고의 채움 조건에 `coverCharge`가 들어간다.

```tsx
export function computeSalesSummaryWarnings(input: Partial<SalesSummary> | null): string[] {
  const data = { ...EMPTY, ...(input || {}) };
  // 매출구성 합계 = 메뉴+주류+커버차지. 예약정산금(캐치테이블)은 POS 밖 금액이라 실매출 대조에서 제외한다.
  const gross = num(data.menuSales) + num(data.liquorSales) + num(data.coverCharge || "");
  const list: string[] = [];
  if (filled(data.totalSales) && filled(data.totalDiscount) && filled(data.netSales)
    && num(data.totalSales) - num(data.totalDiscount) !== num(data.netSales)) {
    list.push(`총매출 − 총할인(${formatNumber(num(data.totalSales) - num(data.totalDiscount))}) 이 실매출(${formatNumber(num(data.netSales))})과 일치하지 않습니다.`);
  }
  if (filled(data.cardPay) && filled(data.cashPlain) && filled(data.cashReceipt) && filled(data.netSales)
    && num(data.cardPay) + num(data.cashPlain) + num(data.cashReceipt) !== num(data.netSales)) {
    list.push(`카드+단순현금+현금영수증(${formatNumber(num(data.cardPay) + num(data.cashPlain) + num(data.cashReceipt))}) 합이 실매출(${formatNumber(num(data.netSales))})과 맞지 않습니다.`);
  }
  if (filled(data.menuSales) && filled(data.liquorSales) && filled(String(data.coverCharge || "")) && filled(data.netSales)
    && gross !== num(data.netSales)) {
    list.push(`매출구성 합계(${formatNumber(gross)})가 실매출(${formatNumber(num(data.netSales))})과 맞지 않습니다.`);
  }
  return list;
}
```

- [ ] **Step 4: `salesSummaryBlankBlocking`에서 금샤빠 분기 제거**

`SalesSummarySection.tsx:75-82`를 아래로 교체한다. `coverCharge`가 `REQUIRED_FIELDS`에 들어갔으므로 별도 `coverBlank` 분기가 필요 없다.

```tsx
export function salesSummaryBlankBlocking(input: Partial<SalesSummary> | null): boolean {
  const data = { ...EMPTY, ...(input || {}) };
  // 모든 필수 칸이 채워져야 한다(값이 0이어도 "0"이면 채워진 것). 빈칸이 하나라도 있으면 차단.
  return REQUIRED_FIELDS.some((f) => !filled(String((data as any)[f.key] || "")));
}
```

- [ ] **Step 5: `isSalesSummaryDataInvalid` 시그니처 정리**

`SalesSummarySection.tsx:84-87`을 아래로 교체한다.

```tsx
// 마감제출 차단 여부: 금액 불일치 경고가 있거나, 사유 없는 빈칸이 있으면 true.
export function isSalesSummaryDataInvalid(input: Partial<SalesSummary> | null): boolean {
  return computeSalesSummaryWarnings(input).length > 0 || salesSummaryBlankBlocking(input);
}
```

- [ ] **Step 6: 마감제출 가드 호출부 수정**

`MonthlySettleTab.tsx:285`에서 두 번째 인자를 뺀다.

```tsx
      if ((window as any).__ugdSalesSummaryInvalid === true || isSalesSummaryDataInvalid(summaryCheck.data)) {
```

- [ ] **Step 7: 타입 검사로 호출부 누락 확인**

Run: `npm run lint`
Expected: 이 Task 시점에는 `SalesSummarySection.tsx` 내부(244·249·253·254·402·404행 부근)에서 `salesSummaryUsesCover`/`isGeumshabba` 미정의 및 인자 개수 오류가 뜬다. **그 오류만 남아야 정상**이다. `MonthlySettleTab.tsx`나 다른 파일에서 오류가 뜨면 놓친 호출부가 있다는 뜻이니 함께 고친다. 남은 오류는 Task 2에서 해소된다.

---

### Task 2: 매출구성 카드 6줄 구조로 재배치

**Files:**
- Modify: `src/pages/branch/tabs/SalesSummarySection.tsx:244-255` (파생값·검증 호출)
- Modify: `src/pages/branch/tabs/SalesSummarySection.tsx:397-405` (매출구성 카드 렌더)

**Interfaces:**
- Consumes: Task 1의 `computeSalesSummaryWarnings(input)`, `salesSummaryBlankBlocking(input)` — 인자 1개
- Produces: 없음 (화면 렌더가 끝단)

- [ ] **Step 1: 파생값 계산 교체**

`SalesSummarySection.tsx:244-255`를 아래로 교체한다. `isGeumshabba`가 사라지고, `compositionDiff`(차이) 대신 `compositionSum`(합계)과 `compositionTotal`(총 합계)을 쓴다.

```tsx
  const paymentSum = num(data.cardPay) + num(data.cashPlain) + num(data.cashReceipt);
  const paymentDiff = num(data.netSales) - paymentSum;
  // 합계 = 메뉴+주류+커버차지 (실매출과 대조하는 묶음). 총 합계 = 합계 + 예약정산금(POS 밖 금액).
  const compositionSum = num(data.menuSales) + num(data.liquorSales) + num(data.coverCharge || "");
  const compositionTotal = compositionSum + num(data.seatCharge);

  // ---- 검증 (마감제출 가드와 동일 규칙 공유) ----
  const warnings = useMemo(() => computeSalesSummaryWarnings(data), [data]);
  const blankBlocking = salesSummaryBlankBlocking(data);
  const invalid = warnings.length > 0 || blankBlocking;
```

- [ ] **Step 2: `autoRow`에 강조 옵션 추가**

`SalesSummarySection.tsx:316-321`의 `autoRow`를 아래로 교체한다. `총 합계`를 최종값으로 도드라지게 하되 새 스타일 체계를 만들지 않고 기존 클래스만 조합한다. `strong=true`면 라벨이 진해지고 구분선이 사라져(바로 위 `합계` 줄과 한 덩어리로 보이게) 값 테두리가 검게 된다.

```tsx
  const autoRow = (label: string, value: string, warn = false, strong = false) => (
    <div className={`flex items-center justify-between gap-2 ${strong ? "pt-1.5" : "pt-2 mt-1 border-t border-zinc-200"}`}>
      <span className={`text-[11px] font-black shrink-0 ${strong ? "text-zinc-900" : "text-zinc-500"}`}>{label} <span className="text-[9px] font-bold text-zinc-400">자동</span></span>
      <span className={`w-28 p-1.5 rounded-lg text-xs font-mono font-black text-right border-2 ${warn ? "bg-rose-50 text-rose-600 border-rose-400" : strong ? "bg-zinc-50 text-blue-700 border-zinc-900" : "bg-zinc-50 text-blue-700 border-zinc-200"}`}>{value}</span>
    </div>
  );
```

- [ ] **Step 3: 매출구성 카드 렌더 교체**

`SalesSummarySection.tsx:397-405`(`<div className={cardCls}>`부터 그 카드의 닫는 `</div>`까지)를 아래로 교체한다. 입력 4줄 → 합계 → 예약정산금 → 안내문 → 총 합계 순서다. 키보드 격자 좌표(col 0, row 0~3)는 입력칸에만 붙고 개수가 4개로 그대로라 `useSheetKeyboardNav({ rowCount: 4, colCount: 3 })`는 손대지 않는다.

```tsx
        <div className={cardCls}>
          <div className={pillTitleCls}><Utensils className="w-3.5 h-3.5" /> 매출구성</div>
          {rowField("menuSales", "메뉴매출", { row: 0, col: 0 })}
          {rowField("liquorSales", "주류매출", { row: 1, col: 0 })}
          {rowField("coverCharge", "커버차지(자릿값)", { row: 2, col: 0 })}
          {autoRow("합계", formatNumber(compositionSum), filled(data.netSales) && compositionSum !== num(data.netSales))}
          {rowField("seatCharge", "예약정산금", { row: 3, col: 0 }, "sales-summary-seat-charge")}
          <p className="text-[9px] text-zinc-900 leading-snug pt-0.5">※ 예약정산금: 캐치테이블 예약 이용 매장은 <span className="text-rose-600 font-black">캐치테이블 관리자페이지 → 정산 → 부가세 참고자료</span> → 해당 월 선택 후 나오는 금액을 입력하세요. 해당 없으면 0을 입력하세요.</p>
          {autoRow("총 합계", formatNumber(compositionTotal), false, true)}
        </div>
```

- [ ] **Step 4: 타입 검사**

Run: `npm run lint`
Expected: 오류 0건. Task 1에서 남았던 `salesSummaryUsesCover`/`isGeumshabba` 관련 오류가 모두 사라져야 한다.

- [ ] **Step 5: 빌드**

Run: `npm run build`
Expected: 성공

---

### Task 3: 안내 말풍선 문구 정리

**Files:**
- Modify: `src/pages/branch/helpers/guideSteps.tsx:73-88`

**Interfaces:**
- Consumes: Task 2가 `sales-summary-seat-charge` 앵커를 예약정산금 칸에 그대로 유지함
- Produces: 없음

- [ ] **Step 1: 스텝 제목·주석 교체**

`guideSteps.tsx:74-88`의 첫 스텝을 아래로 교체한다. 앵커 이름(`sales-summary-seat-charge`)은 화면 쪽 `data-guide` 값과 짝이라 **바꾸지 않는다** — 이름만 옛 라벨을 따르지만 가리키는 칸은 동일하다.

```tsx
  {
    // 예약정산금 입력칸에 붙인다(앵커 이름은 옛 라벨 '자릿값' 시절 것을 유지 — 화면의 data-guide와 짝).
    // below로 두면 아래 매입매출 표의 말풍선과 같은 자리로 떨어져 가려지므로 above(상단)로 띄운다(사용자 요청 2026-07-18).
    anchor: "sales-summary-seat-charge",
    title: "예약정산금",
    placement: "above",
    width: 400,
    body: (
      <Bullets
        items={[
          <>캐치테이블 이용 매장은 <b className="font-black text-rose-700">캐치테이블 관리자페이지 → 정산 →<br />부가세 참고자료 → 해당 월 선택</b> 후 나오는 금액을 입력하세요.</>,
          <>예약 매출은 POS 실매출에 잡히지 않으므로 <b className="font-black">위 합계와는 별개</b>입니다. 해당 없으면 0을 입력하세요.</>,
        ]}
      />
    ),
  },
```

- [ ] **Step 2: 타입 검사**

Run: `npm run lint`
Expected: 오류 0건

---

### Task 4: 관리자 엑셀 항목 반영

**Files:**
- Modify: `src/pages/AdminPage.tsx:3025-3028`
- Modify: `src/pages/AdminPage.tsx:3229-3232`

**Interfaces:**
- Consumes: `SalesSummary`의 `coverCharge`/`seatCharge` 필드 (Task 1~2에서 이름 그대로 유지됨)
- Produces: 없음

- [ ] **Step 1: 지점 단건 매출집계 엑셀 행 수정**

`AdminPage.tsx:3025-3028`의 네 줄을 아래로 교체한다. 화면 순서(메뉴 → 주류 → 커버차지 → 예약정산금)와 맞춘다.

```tsx
          { 항목: "메뉴매출", 값: num(s.menuSales) },
          { 항목: "주류매출", 값: num(s.liquorSales) },
          { 항목: "커버차지(자릿값)", 값: num(s.coverCharge) },
          { 항목: "예약정산금", 값: num(s.seatCharge) },
          { 항목: "빈칸 사유", 값: s.blankReason || "" },
```

- [ ] **Step 2: 전지점 통합 매출집계 엑셀 컬럼 수정**

`AdminPage.tsx:3229-3232`의 네 줄을 아래로 교체한다. `"자리값내역"`은 원래 빈 문자열 자리표시 컬럼이라 이름만 맞춰 남긴다.

```tsx
          "메뉴매출": num(d.menuSales),
          "주류매출": num(d.liquorSales),
          "커버차지(자릿값)": num(d.coverCharge),
          "예약정산금": num(d.seatCharge),
          "예약정산금내역": "",
```

- [ ] **Step 3: 타입 검사 + 빌드**

Run: `npm run lint` 이후 `npm run build`
Expected: 둘 다 오류 0건. `num()`이 `undefined`를 받으면 0을 돌려주는지 확인한다 — `coverCharge`가 저장돼 있지 않은 과거 월 데이터에서 `undefined`가 들어올 수 있다. 0이 아닌 `NaN`이 나오면 `num(d.coverCharge || "")`로 감싼다.

---

### Task 5: 로컬 육안 확인

**Files:** 없음 (검증 전용)

**Interfaces:**
- Consumes: Task 1~4 전체
- Produces: 사용자에게 보여줄 화면

- [ ] **Step 1: 개발 서버 실행**

Run: `npm run dev`
Expected: localhost:3000 기동

- [ ] **Step 2: 지점 화면 > 월말마감 > 매입매출 탭에서 아래를 하나씩 확인**

| 확인 항목 | 기대 |
|---|---|
| 일반 지점(예: 대학로고래) 매출구성 카드 | 입력 4줄(메뉴/주류/커버차지(자릿값)/예약정산금) + 자동 2줄(합계/총 합계) = 6줄 |
| 금샤빠 지점 | 위와 **완전히 동일**. 라벨에 "커버" 분기 문구가 남아있지 않음 |
| 메뉴 100 + 주류 50 + 커버 0, 실매출 150 | 합계 150, 흰 배경(경고 없음) |
| 위 상태에서 실매출만 200으로 | 합계 150이 붉게, 상단에 "매출구성 합계(150)가 실매출(200)과 맞지 않습니다." 경고 배너 |
| 예약정산금 30 입력 | 합계는 150 그대로, **총 합계만** 180으로 증가. 경고 상태는 변하지 않음 |
| 커버차지 칸을 비우고 마감제출 | 제출 차단 + 빈칸 붉게 + "해당 없으면 0을 입력하세요" 안내 |
| 예약정산금 칸 위 안내 말풍선 | 제목이 "예약정산금"으로 뜨고 캐치테이블 경로 안내가 보임 |
| 방향키 ↑↓ | 메뉴 → 주류 → 커버차지 → 예약정산금 4칸을 오르내림. ←→로 옆 카드 이동 |

- [ ] **Step 3: 사용자에게 화면 확인 요청**

수정 화면을 사용자에게 보여주고 확인을 받는다. **커밋·푸시·배포는 여기서 멈추고 사용자 지시를 기다린다.**

- [ ] **Step 4: Codex 지독한 리뷰**

`/codex:rescue`로 변경분 리뷰를 돌린다(상시 지침). 백그라운드로 돌릴 경우 Monitor 하트비트를 함께 걸고 ~180초마다 진행 상황을 보고한다. 지적 사항을 반영한 뒤 다시 `npm run lint` + `npm run build`.

---

## 되돌리기

이 작업은 파일 4개의 순수 프론트엔드 변경이라 `git checkout -- <파일>`로 되돌릴 수 있다. 저장된 마감 데이터는 건드리지 않으므로 데이터 복구 절차가 필요 없다.
