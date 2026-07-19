# UGD ERP 디자인 기준

이 문서는 UGD ERP **지점 화면**의 디자인 규칙을 값 단위로 못 박은 기준서입니다.
새 화면을 만들거나 기존 화면을 고칠 때는 **작업 전에 이 문서를 먼저 읽고, 여기 적힌 토큰·수치·규칙을 그대로 적용**합니다.
직접 눈으로 뜯어 분석한 세 탭 — **일일마감정산 · 발주관리 · 주류재고** — 이 이 규칙들의 기준 예시입니다.

읽는 순서: 먼저 2번(렌더링 원리)을 이해해야 나머지 수치가 왜 그런지 이해됩니다.

---

## 1. 디자인 방향

지점 운영자가 매일 반복해서 쓰는 업무 콘솔입니다. 마케팅 페이지가 아니라, 좁은 시간 안에 입력하고 확인하는 화면입니다.
인상은 **부드러운 회보라 배경 + 선명한 검정 섹션 테두리(1px) + 바닐라색 알약 제목 + 작고 밀도 있는 표 + 의미가 있을 때만 쓰는 상태색**으로 정리합니다.

---

## 2. 렌더링 원리 — 이걸 모르면 색이 안 먹는다

지점 화면의 최종 외형은 **두 겹**으로 결정됩니다.

1. **탭 컴포넌트(.tsx)** — 인라인 Tailwind 클래스로 **구조와 초안 색**을 만든다. 예: `bg-white p-4 rounded-2xl border border-gray-100 shadow-sm`.
2. **`src/index.css`의 `.branch-redesign` 스코프** — 그 위에 **실제 배포 외형을 !important로 덮어쓴다.** 지점 화면은 최상위에 `.branch-redesign` 클래스가 붙어 있어, 여기 규칙이 항상 마지막 승자다.

그래서 **탭에 무슨 색을 적든, 최종 색은 `.branch-redesign`가 정한다.** 규칙:

- 탭에서 `bg-blue-50`, `bg-emerald-50`, `bg-amber-50`, `bg-white` 같은 **Tailwind 표준 색**을 쓰면 → `.branch-redesign`가 자동으로 **디자인 토큰**으로 치환한다(아래 매핑 표). 그러니 **새 화면도 표준 Tailwind 색으로 칠하면 자동으로 팔레트에 맞는다.**
- **커스텀 hex(`bg-[#202A5A]` 등)나 전용 클래스(`order-cat-food` 등)는 치환을 타지 않는다.** 특정 색을 꼭 유지해야 할 때만 이 방식을 쓴다.
- 색을 새로 만들지 말 것. 아래 토큰 6개 안에서 해결한다.

Tailwind → 토큰 자동 치환(지점 화면 기준):

| 탭에서 쓴 클래스 | 실제 렌더 색 |
| --- | --- |
| `bg-blue-50/100`, `bg-sky-50`, `bg-indigo-50`, `bg-slate-50~100`, `bg-gray-50~100` | `--branch-alice` (#D8DFE9) |
| `bg-emerald-50/100`, `bg-green-50/100` | `--branch-honey` (#CFDECA) |
| `bg-amber-50`, `bg-orange-50`, `bg-yellow-50`, `bg-rose-50`, `bg-red-50` | `--branch-vanilla` (#EFF0A3) |
| `bg-[#2E6DB4]`, `bg-blue-*`, `bg-emerald-*`, `bg-rose-*`, `bg-slate-700`, `bg-zinc-900` (버튼) | `--branch-black` (#212121) + 밝은 글자 |
| `border-gray-100/200`, `border-slate-100/200`, `border-blue-100`, `border-*-200` | 검정 또는 연회색 테두리(문맥별) |
| `text-blue-700`, `text-emerald-700`, `text-amber-700` 등 진한 색 글자 | `--branch-black` |
| `text-gray-500~800`, `text-slate-*`, `text-zinc-*` | `rgba(33,33,33,0.66)` |

**따라서 버튼은 색으로 의미를 구분하지 않는다** — 파랑·초록·빨강 버튼 모두 검정으로 렌더된다. 의미 구분은 위치·라벨·아이콘으로 한다.

---

## 3. 색상 토큰

`.branch-redesign`에 정의된 6색이 전부입니다(`src/index.css`).

| 이름 | 값 | 용도 |
| --- | --- | --- |
| `--branch-ghost` | `#F6F5FA` | 화면 전체 배경, 섹션 카드 바탕 |
| `--branch-alice` | `#D8DFE9` | 사이드바, **표 헤더(thead)**, 부드러운 패널, 지점이동 상태 |
| `--branch-honey` | `#CFDECA` | 완료·확정·긍정, **주류 재고/월초 칸**, 기존직원 |
| `--branch-vanilla` | `#EFF0A3` | **섹션 제목 알약**, 공지·미확인·주의, 신규입사 |
| `--branch-black` | `#212121` | 본문 글자, **섹션 테두리(1px)**, 활성 버튼 배경 |

상태·경고 전용 색(토큰 밖, 그대로 hex로 씀):

| 값 | 용도 |
| --- | --- |
| `#C93A3A` 테두리 / `#FDE2E2` 배경 / `#8F1F1F`·`#b91c1c` 글자 | 검증 오류, 필수 미입력, 현금 차이 불일치 |
| `#2E6DB4` | 포커스 링·활성 셀 아웃라인 등 **잔존 액션 블루**(버튼 배경으로는 검정으로 치환됨) |
| `#202A5A` | 주류 재고 시트 헤더 전용 네이비(치환 안 됨) |
| `#18181B` | 월말마감 "미제출" 상태 칩 |

---

## 4. 섹션 카드

모든 주요 업무 섹션(매출·현금마감·근무자·메모·상품등록·재고시트·발주리포트 등)은 **같은 카드 껍데기**를 씁니다.

**최종 렌더 값(`.branch-redesign`가 강제):**
- 배경: `--branch-ghost` (#F6F5FA)
- 테두리: **`1px solid --branch-black` (#212121)** — 지점 카드의 서명 같은 특징
- 모서리: **`border-radius: 28px`**
- 그림자: `box-shadow: 0 16px 38px rgba(33,33,33,0.035)` (일부 섹션 `0 18px 42px rgba(33,33,33,0.045)`)
- 안쪽 여백: `p-4`(대부분), 메모처럼 글이 많은 섹션은 `p-6`

**탭에서 작성하는 표준 레시피(이대로 쓰면 위 값으로 렌더됨):**
```
<section className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3">
```
- `bg-white` → ghost, `rounded-2xl` → 28px, `border-gray-100` → 검정 1px, `shadow-sm` → 위 그림자. **반드시 `border-gray-100`(또는 `border-gray-200`)로 테두리를 준다** — slate/zinc/기타 색 테두리는 검정 치환에서 빠져 연회색으로 남는다(13번 참고).
- 표를 감싸는 스크롤 래퍼도 카드로 본다: `overflow-x-auto rounded-2xl border border-gray-100`.
- **카드 안에 카드를 모서리에 붙여 겹겹이 넣지 않는다.** 겹겹 구조가 꼭 필요하면 바깥 래퍼는 테두리 없는 투명 그룹으로 두고 안쪽 카드만 테두리를 갖는다(13번).

---

## 5. 섹션 사이 간격 · 섹션 내부 간격

- **탭 최상위(섹션과 섹션 사이): 세로 20~24px.** 발주·주류는 `space-y-5`(20px), 일일마감정산은 `space-y-6`(24px). 새 탭은 이 범위를 지킨다.
- **카드 내부 세로 리듬:** `space-y-3`(12px, 표 있는 섹션) 또는 `space-y-4`(16px, 글·폼 섹션).
- **카드 안쪽 여백:** `p-4`(16px) 기본, 글 많은 섹션 `p-6`(24px).
- **폼 그리드 간격:** 라벨+입력 그룹은 `gap-3`~`gap-4`, 칩·버튼 줄은 `gap-1.5`~`gap-2`.
- 표는 가로 스크롤 없이 한 화면에 읽히는 것을 우선한다. 폭이 부족하면 `table-fixed`·말줄임·짧은 라벨·`min-w-[…]`를 조합한다.

---

## 6. 섹션 제목 — 바닐라 알약 칩 (텍스트만)

지점 화면의 **모든 섹션 제목(`<h3>`, 메모 섹션은 `<label>`)은 바닐라색 알약 칩**으로 렌더됩니다. 이것이 이 화면의 가장 눈에 띄는 서명입니다.

**최종 렌더 값(`.branch-redesign`가 `<h3>`에 강제):**
- `display: inline-flex; width: fit-content` (글자 길이만큼만, 줄 전체를 채우지 않음)
- `align-items: center; gap: 8px`
- **`border-radius: 999px`** (완전 알약)
- **`border: 1px solid --branch-black`**
- **`background: --branch-vanilla` (#EFF0A3)** ← "제목을 채우는 색"
- `color: --branch-black`
- `padding: 6px 12px`
- `font-size: 11px; line-height: 1; font-weight: 900; letter-spacing: 0`

**탭에서 작성하는 표준 레시피:**
```
<h3 className="text-sm font-black text-gray-900 w-fit">매출</h3>
```
`text-sm/text-gray-900`는 알약 규칙이 덮어쓰므로 신경 쓰지 않아도 되고, **`w-fit`만 지켜 폭이 글자에 맞게 한다.**

### 6-1. [규칙] 제목에는 텍스트만 — 아이콘·이미지 금지

- **섹션 제목 안에는 글자만 넣는다.** `<svg>` 아이콘, 이미지, 장식 요소를 넣지 않는다.
- 이유: 알약 칩은 11px로 작아, 아이콘이 들어가면 칩이 커지고 제목마다 크기가 들쭉날쭉해진다. **발주·주류 탭은 이 규칙을 지켜 텍스트만** 넣는다(`거래처 추가`, `발주내역 리포트`, `주류 재고 관리표`, `재고 시트`).
- **현재 예외(고쳐야 할 위반):** 일일마감정산 탭의 제목들은 아이콘이 들어가 있다 — 매출(`CircleDollarSign`), 현금마감(`Coins`), 근무자(`Clock`), 메모(`FileText`). 규칙상 이 아이콘들은 제거 대상이다. (제거는 코드 수정이므로 별도 리뷰·로컬확인·배포 승인 절차를 따른다.)

### 6-2. [규칙] 제목 `<h3>`를 `<div>`로 감싸지 않는다

- 알약 스타일은 `#sales-section > h3`처럼 **직계 자식 선택자**로 붙는다. 제목을 `<div>`로 한 겹 감싸면 손자가 되어 알약이 사라진다.
- 제목 옆에 합계·버튼을 나란히 두고 싶으면, 그것들을 **제목의 형제**로 두고 **부모에 `flex`/`grid`**로 정렬한다(예: `sales-section-head` 클래스가 `grid-template-columns: 1fr auto`로 제목과 합계를 한 줄에 세운다). 제목 자체는 감싸지 않는다.

---

## 7. 헤더 바 · 구분선

제목 아래에 부제목·컨트롤이 붙는 큰 섹션(재고 시트, 발주내역 리포트, 근무자)은 **헤더 영역을 얇은 구분선으로 표 본문과 나눈다.**

- 헤더 영역: `p-4` 여백 + **아래 구분선 `border-b border-gray-100`**.
- 부제목: `text-[11px] text-gray-400`(약 11px, 연회색). 강조 단어만 `text-slate-600`.
- 헤더 안에서 제목과 오른쪽 컨트롤(월 이동·저장상태·필터)은 `flex ... justify-between gap-2~3`로 벌린다.
- 근무자 섹션처럼 제목 줄 자체에 구분선을 둘 때: `flex ... justify-between gap-2 border-b border-gray-100 pb-3`.

---

## 8. 표 (일반 표)

일일마감정산 근무자 표, 발주 매트릭스처럼 **입력/조회 표**의 공통 규칙.

**헤더(thead / th) — 최종 렌더:**
- 배경: `--branch-alice` (#D8DFE9), 글자 검정, `font-black`.
- 테두리: `rgba(33,33,33,0.12)`.
- 위에 고정: `sticky top-0 z-10`(이상). 좌측 고정열이 있으면 헤더 셀은 `z-30`, 본문 고정열은 `z-20`.
- 셀 여백: `py-2 px-2`(좁으면 `px-1`).

**본문(tbody / td):**
- **줄무늬(zebra)는 자동 적용:** `tbody tr:nth-child(even)` = ghost+alice 혼합, `odd` = 거의 흰색. 탭에서 `divide-y divide-gray-100`으로 작성해도, 최종엔 이 줄무늬가 얹힌다.
- hover: ghost+honey 혼합(연한 초록빛).
- 셀 여백: `py-1.5 px-2`. 숫자·날짜 칸은 `font-mono` + `font-bold`/`font-black`, 우측 정렬.
- 이름·사유·상품명처럼 길어질 수 있는 값은 말줄임 + `title`.
- 빈 상태: `py-10 text-center text-gray-400`.

**[규칙] 줄무늬(`nth-child`)를 이겨야 하는 색은 ID 특이성으로 이긴다.**
줄무늬 규칙이 `!important`라, 특정 행/셀에 분류색을 칠하려면 같은 `!important`로는 못 이긴다. `#purchase-sales-subtab tbody tr[data-cat="식재료비"]`처럼 **ID를 낀 선택자**로 특이성을 높여 이긴다(식재료비=바닐라, 주류비=허니, 식음료외기타=엘리스).

---

## 9. 엑셀형 시트 (주류 재고 · 매입매출 · 급여대장)

날짜별로 칸에 바로 숫자를 적는 **스프레드시트형 표**는 일반 표와 규칙이 다르다.

- **`border-collapse`가 아니라 `border-separate; border-spacing: 0`을 쓴다.** collapse에서는 sticky 헤더/고정열이 스크롤될 때 크롬이 테두리를 셀과 함께 그리지 못해 선이 깨진다. separate에서는 각 칸이 자기 테두리를 갖고 함께 움직인다.
- **셀 테두리·배경은 `<td>`가 그리고, 입력칸은 투명하게 비운다.** `.branch-redesign`가 input의 배경·테두리를 `!important`로 강제하므로, `.sheet-cell-input`/`.liquor-sheet-cell`을 ID 특이성으로 이겨 `background:transparent; border:0`으로 되돌린다.
- **쓸 수 없는 칸(disabled)은 회색으로 잠근다:** `rgba(33,33,33,0.06)` 배경, `rgba(33,33,33,0.35)` 글자, `cursor: not-allowed`.
- **좌측 고정열(분류·상품명·단가 등)** 은 `sticky left-0` + 흰 배경 + 우측 테두리. 마지막 고정열은 `border-r-2 border-r-slate-900`으로 고정 블록을 닫는다.

### 9-1. 주류 재고 시트 칸 색 (의미별 배경 분리)

세 종류의 숫자는 **배경색으로 구분**한다 — 이게 이 시트의 핵심.

| 칸 | 헤더 | 본문 | 글자 |
| --- | --- | --- | --- |
| **입고(입)** | `bg-blue-100` → 파랑 | `bg-blue-50` → 파랑 | `text-blue-800` |
| **판매(판)** | `bg-rose-100` → 분홍 | `bg-rose-50` → 분홍 | `text-rose-800` |
| **재고(재)·월초** | `liquor-stock-alice-green` | 〃 | `text-slate-800` |

- **주의(값 불일치 바로잡음):** `liquor-stock-alice-green` 클래스는 이름은 "alice"지만 실제로는 **`--branch-honey` (#CFDECA, 초록기)**로 렌더된다. 재고/월초 칸은 파랑(alice)이 아니라 **허니(초록기)**다. 클래스명이 오해를 부르니, 이 색을 다룰 땐 실제값 #CFDECA로 기억한다.
- 시트 헤더는 일반 표(alice)와 달리 **네이비 `#202A5A` + 흰 글자**를 쓴다(치환 안 됨). 헤더 칸 구분선은 `border-white/20`.
- **오늘 날짜 열 강조:** 헤더는 `bg-rose-600`, 열 전체는 위·아래 `border-rose-500`(2px)로 띠를 두른다. 오늘 아닌 열은 `border-black/10`.
- **음수 재고 강조:** 재고 칸에서 `stock < 0`이면 허니 대신 `bg-rose-100 text-rose-700`.
- **커서가 있는 행 강조(focus-within):** 배경을 갈아엎지 않고, 행 위·아래에 검정 선(`inset 0 ±1px --branch-black`) + 바닐라 35% 얇은 막을 얹어 **띠처럼** 보이게 한다. 입고/판매/재고 칸의 배경 구분은 그대로 살린다. 좌측 고정열은 `.sticky` 규칙이 box-shadow를 `!important`로 못 박아서, 그 그림자(`0 10px 28px`)를 다시 적어 줘야 왼쪽 절반 선이 안 끊긴다.

---

## 10. 입력 · 선택 · 버튼

**입력/선택(input·select·textarea) — 최종 렌더:**
- 배경: ghost에 흰색을 살짝 섞은 값, 테두리 `rgba(33,33,33,0.14)`, **모서리 `border-radius: 18px`**.
- 포커스: 테두리 `rgba(33,33,33,0.34)` + `box-shadow: 0 0 0 3px rgba(216,223,233,0.75)`(연한 alice 링).
- 표준 크기: 컴팩트 `h-8`(32px), 일반 `h-9`/`h-[38px]`. 폭은 내용에 맞춰 `w-[…]`.
- 탭 작성 예: `h-8 w-[124px] rounded-lg border border-gray-200 px-2 text-[11px] font-bold`.

**버튼:**
- **모든 강조/컬러 버튼은 검정 배경 + ghost 글자로 렌더된다**(`bg-[#2E6DB4]`·`bg-emerald-*`·`bg-rose-*`·`bg-slate-700`·`bg-zinc-900` 전부 → 검정). 색으로 의미를 나누지 말 것.
- 모서리 언어: `rounded-lg`(작은/표 버튼) → `rounded-xl`(중간) → `rounded-2xl`(주요 제출) → `rounded-full`(알약 토글).
- 아이콘이 도움이 되면 함께 쓰고, 삭제/저장 같은 행동엔 `aria-label`/`title`을 둔다. (제목 칩과 달리 버튼은 아이콘 허용.)
- 비활성: `disabled:opacity-40 disabled:cursor-not-allowed` 또는 `disabled:bg-gray-100`(→ alice).
- 가이드 토글 같은 알약 버튼: 켜짐 `bg-zinc-900 text-[#EFF0A3]`, 꺼짐 `bg-[#EFF0A3] text-zinc-900`(검정↔바닐라 반전).

---

## 11. 상태색 (의미가 있을 때만)

**자동저장 배지**(발주·주류 헤더 우측, `h-8`/`h-[38px]` `rounded-lg/xl` `font-black`):
- 불러오는 중 / 저장 중: `bg-amber-50 text-amber-700` (→ 바닐라)
- 저장됨: `bg-emerald-50 text-emerald-700` (→ 허니)
- **동기화 실패: `bg-rose-50 text-rose-700` — 반드시 눈에 띄게.** 저장 실패를 초록 "저장됨"으로 속이지 않는다(AGENTS.md P0-2).

**검증 오류**(제출 막는 필수 미입력): 해당 입력칸/셀에만 `branch-validation-error` → **테두리 `#C93A3A`, 배경 `#FDE2E2`, 링 `rgba(201,58,58,0.18)`**. 전체 섹션을 칠하지 않는다. 사용자가 값을 고치면 즉시 해제한다.

**현금마감 차이:** 일치 → `cash-flow-diff-ok`(허니 배경). 불일치 → `cash-flow-diff-bad`(배경 `#fee2e2`, 테두리 `#dc2626`, 글자 `#b91c1c`).

**월말마감 상태 칩**(테두리 1px 검정 공통): 제출완료 = 바닐라 `#EFF0A3`, 수정중 = 알리스 `#D8DFE9`, 미제출 = 검정 `#18181B` + 흰 글자.

**추가 사유 미선택**: 행 전체를 칠하지 않고, `추가 사유` 컨트롤/칩만 붉은 계열(`#FDE2E2`/`#C93A3A`)로 표시.

---

## 12. 전용 클래스로 못 박아야 하는 색들

아래 색들은 Tailwind 표준 색을 쓰면 2번 자동치환에 먹혀 사라지거나 뭉개진다. **전용 클래스로 index.css에 못 박는다.**

- **발주 대분류 칩:** `order-cat` + `order-cat-food`(바닐라)/`order-cat-side`(알리스)/`order-cat-liquor`(허니)/`order-cat-etc`(흰색). 칩이 촘촘한 자리에서는 `order-cat-soft`로 테두리만 연하게.
- **결제수단 칩:** `pay-chip` + `pay-chip-cash`(바닐라)/`pay-chip-card`(허니).
- **월말 지출 칩:** `monthly-expense-chip` + `monthly-chip-vanilla`/`monthly-chip-alice`/`monthly-chip-honey`.
- **매입매출 분류 행:** `tr[data-cat="…"]`(8번 ID 특이성 규칙).
- **조회표 행 구분선:** `sheet-rows-soft > tr`은 `rgba(33,33,33,0.07)`로 연하게, 날짜 바뀌는 행만 `row-group-start`로 `rgba(33,33,33,0.22)`. (그대로 두면 `divide-gray-*`가 검정으로 치환돼 행마다 굵은 검은 줄이 그어진다.)
- **합계/계산식 박스:** `daily-total-chip`, `cash-flow-box`는 배경을 **투명**하게 둔다. 카드 배경색을 값으로 복제하지 말 것 — 투명하면 카드 배경이 그대로 비쳐 언제나 정확히 같은 색이다.

---

## 13. 테두리 함정 — "왼쪽 위에 연회색 선이 남는" 문제와 그 방지 규칙

검정 섹션 테두리를 줬는데 **한쪽 모서리(특히 좌상단)에 연회색 1px 선이 살아남는** 일이 반복해서 있었다. 원인과 규칙:

1. **테두리는 색만 바꾸지 말고 통째로 지정한다.** CSS에서 `border-color`만 검정으로 바꾸면, 컴포넌트가 가진 `border-gray-*`의 폭/방향별 잔값이 한쪽에 남아 모서리에 연회색이 비친다. 항상 `border: 1px solid var(--branch-black)`처럼 **폭+스타일+색을 함께** 지정한다.

2. **카드 테두리는 반드시 `border-gray-100`(또는 `gray-200`)으로 작성한다.** `border-slate-200`·`border-zinc-200` 등으로 테두리를 주면 검정 치환 catch-all에서 빠져 **그 카드만 연회색으로 남는다.** (catch-all은 `bg-white`+`rounded-2xl/3xl`, 또는 `rounded-2xl`+`border-gray-100`을 검정으로 만든다.)

3. **탭 id별로 테두리를 따로 지정하지 않는다.** 예전에 `#parttime-salaries-subtab` 식으로 탭마다 개별 지정했더니 목록에서 빠진 탭은 테두리가 없었다. **후손 선택자 catch-all 하나로** 지점 화면의 흰 카드 전부에 같은 테두리를 준다.

4. **자식(`>`) 선택자 대신 후손 선택자를 쓴다.** 섹션에 조작법 칩을 얹으려 `relative` 래퍼로 한 겹 감싸는 순간, `> section`은 손자가 되어 규칙에서 빠지고 그 카드만 테두리가 사라진다. `#orders-tab-view section`처럼 깊이와 무관한 후손 선택자로 둔다.

5. **테두리 있는 카드 안에 테두리 있는 카드를 모서리에 붙이지 않는다.** 겹치면 안쪽의 연회색(또는 얇은 선)이 바깥 검정 모서리에 비친다. 겹겹이 필요하면 **바깥 래퍼는 `border:0; box-shadow:none`인 투명 그룹**으로 두고 안쪽 카드만 테두리를 갖게 한다(일일마감정산 `#settlement-finance-section`이 이 방식).

6. **그래도 한 모서리에 잔선이 남으면 outline으로 사각형을 한 번 더 덮는다:** `outline: 1px solid var(--branch-black); outline-offset: -1px;`. (관리자 디자인 프리뷰에서 검증된 방법 — border만으로 모서리가 안 잡힐 때 확실히 닫는다.)

7. **`!important`를 이겨야 하면 특이성으로 이긴다.** 지점 화면의 색·테두리 규칙 상당수가 `!important`다. 같은 `!important`로는 순서 싸움이 되니, **ID를 낀 선택자로 특이성을 높여** 이긴다(줄무늬·시트셀·분류행 모두 이 방식).

---

## 14. 사이드바(껍데기) 요약

세 탭이 들어앉는 지점 화면 껍데기의 기준(참고).

- 사이드바 배경 ghost, 우측 경계 `1px --branch-alice`.
- 상단엔 지점명만 크게(`branch-sidebar-branch-name`, 18px/900, 말줄임).
- 메뉴 버튼: 평상시 투명 + 연회색 글자, hover 시 연한 허니, **활성은 검정 배경 + ghost 글자**.
- 하위탭 버튼은 더 작게(`branch-sidebar-subtab`, 11px), 활성은 바닐라 배경.

---

## 15. 새 화면/수정 체크리스트

- [ ] 색은 토큰 6개 안에서만? 새 색을 만들지 않았나?
- [ ] 섹션 카드 = `bg-white p-4 rounded-2xl border border-gray-100 shadow-sm` (border는 gray 계열)?
- [ ] 섹션 제목 = `<h3 ... w-fit>텍스트</h3>`, **아이콘 없이 텍스트만**? `<div>`로 감싸지 않았나?
- [ ] 섹션 간격 20~24px, 내부 `p-4`·`space-y-3/4`?
- [ ] 표 헤더 alice, 셀 `py-1.5 px-2`, 숫자 `font-mono`? 엑셀형이면 `border-separate`?
- [ ] 버튼이 색으로 의미를 나누려 하지 않나(어차피 검정으로 렌더)?
- [ ] 저장 실패를 눈에 띄게 표시하나(초록으로 속이지 않기)?
- [ ] 검정 테두리에 연회색 잔선이 안 남게 13번 규칙을 지켰나?
- [ ] 특정 색을 유지해야 하면 전용 클래스로 못 박았나(Tailwind 표준색은 치환됨)?
- [ ] 코드를 고쳤으면 Codex 지독한 리뷰 → 로컬(`npm run dev`, :3000) 확인 → 사용자 "배포해" 대기(AGENTS.md P0-1·P1)?
