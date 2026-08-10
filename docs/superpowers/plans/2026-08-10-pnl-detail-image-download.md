# 지점 손익계산서 이미지 저장 버튼 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 또는 superpowers:executing-plans 로 태스크 단위 실행. 체크박스(`- [ ]`)로 추적한다.

**Goal:** 관리자 `분석 > 지점 손익계산서` 탭에서 버튼 한 번으로 05 AGENT 의 `_detail.png` 와 같은 모양의 손익계산서 PNG 를 내려받는다.

**Architecture:** 새 파일 `pnlDetailImage.ts` 가 데이터를 받아 `<canvas>` 에 직접 그리고 PNG Blob 을 돌려준다. 캔버스를 1080×H 로 만들고 `ctx.scale(3,3)` 을 걸어 **05 의 CSS px 수치를 그대로 좌표로 쓴다**. 화면 컴포넌트는 버튼과 다운로드만 담당한다.

**Tech Stack:** React 19 + TypeScript, Canvas 2D API. **새 의존성 없음.** 글꼴은 앱이 이미 자체 호스팅하는 Noto Sans KR(`src/fonts.css`)을 그대로 쓴다.

**설계서:** `docs/superpowers/specs/2026-08-10-pnl-detail-image-download-design.md`

## Global Constraints

- **새 npm 패키지를 추가하지 않는다.** 캔버스 2D API 만 쓴다.
- 이 저장소에는 **테스트 러너가 없다**(`package.json` 스크립트는 `dev`/`build`/`start`/`clean`/`lint` 뿐). 각 태스크의 검증은 `npm run lint`(= `tsc --noEmit`) + 기준 PNG 픽셀 대조로 한다.
- **커밋·푸시는 하지 않는다.** 사용자가 "커밋해"/"배포해" 라고 직접 말하기 전까지 작업 트리에만 둔다 (`CLAUDE.md` 배포·푸시 승인 원칙).
- 배포 전 반드시 `npm run dev`(localhost:3000)로 화면을 사용자에게 보여준다 (메모리 `erp_local_preview_before_deploy`).
- 색은 관리자 화면 토큰만 쓴다. `--branch-*` 토큰은 관리자 화면에서 안 먹는다 (메모리 `erp_salary_change_history_tab`).
- 파이썬 스크립트로 소스를 일괄 수정하지 않는다 (CRLF 함정, 메모리 `feedback_python_script_crlf`).
- 코드 한 줄이라도 고쳤으면 마지막에 Codex 지독한 리뷰를 돌린다 (메모리 `erp_codex_review_standing_rule`, P0).

## 기준 좌표 — `2026-06_남산광어_detail.png` 실측값

**이 표가 이 계획의 핵심이다.** CSS 를 읽고 추정한 값이 아니라 1080×2892 기준 PNG 를 PIL 로 스캔해 얻은 값을 3으로 나눈 CSS px 다. 구현은 이 숫자를 상수로 박는다.

### 세로 (전체 964px, 폭 360px)

| y (CSS px) | 내용 |
|---|---|
| 0 ~ 71 | 헤더 블록. `UGD · 브랜드` 잉크 20.7~29, 지점명 잉크 41~57.7 |
| 74 ~ 86 | `▍손익계산서` 제목 (앰버 바 74~85.7, 3×12px, x=10) |
| ~95 ~ 121 | thead (`항목/금액/비율/전월대비`) |
| 121 ~ 123 | thead 아래 2px 선 `#DDD8D2` |
| 123 ~ 144 | group-hd `매출` (bg `#EDEAE5`, 21px) + 144~145 1px 선 |
| 145 ~ 244 | 일반 행 3개 (`메뉴`/`주류`/`기타`) — **행 32px + 아래 1px 선 `#E8E4DF`** |
| 244 ~ 281 | sub-row `총매출` (bg `#E8E0D5`, **37px**) |
| 281 ~ 283 | 2px 선 `#C0B8AE` |
| 283 ~ 304 | group-hd `지출` (21px) + 304~305 1px 선 |
| 305 ~ 602 | 일반 행 9개 (33px씩) |
| 602 ~ 639 | sub-row `총지출` (37px) + 639~641 2px 선 |
| 641 ~ 680 | profit-row `이익금` (bg `#1B2A4A`, **39px**) |
| 680 ~ 690 | 여백 10px |
| 690 ~ 691 | 구분선 `#DDD8D2` 1px |
| 691 ~ 701 | 여백 10px |
| 701 ~ 801 | PRIME COST 흰 카드 (100px, radius 10). 게이지 y **761~776**(15px) |
| 801 ~ 812 | 여백 10 + 구분선 1px |
| 825 ~ 837 | `▍객단가 & 영수건수` 제목 (앰버 바) |
| 845 ~ 944 | 흰 카드 2칸 (**05 는 99px — 우리는 AI 코멘트를 빼므로 ~62px**) |
| 944 ~ 964 | 아래 여백 20px |

### 가로 (표 영역 x = 10 ~ 350)

| 요소 | x (CSS px) |
|---|---|
| `항목` thead 글자 왼쪽 | 14 |
| 일반 행 이름 왼쪽 | **24** (들여쓰기) |
| sub-row / profit-row 이름 왼쪽 | **16** |
| group-hd 글자 왼쪽 | 16 |
| **금액 우측 정렬 기준선** | **222.5** |
| **비율 우측 정렬 기준선** | **275.5** |
| **전월대비 뱃지 오른쪽 끝** | **345.5** (뱃지 안쪽 좌우 패딩 4px → 글자 우측 341.3) |
| 이익금 행 전월대비 글자 우측 | 346 |

### 색

| 이름 | 값 | 용도 |
|---|---|---|
| `BG` | `#F5F0EB` | 배경 |
| `NAVY` | `#1B2A4A` | 본문 글자, 이익금 행 배경, 연월 알약 |
| `AMBER` | `#E8A838` | 제목 앞 바, 이익금 행 글자, 인건비 게이지 |
| `MUTED` | `#8C96A8` | 헤더 윗줄·thead·비율 |
| `MUTED2` | `#6B7589` | 게이지 범례 |
| `LINE` | `#DDD8D2` | 구분선·thead 아래 선 |
| `ROW_LINE` | `#E8E4DF` | 행 아래 선, 게이지 트랙 |
| `GROUP_BG` | `#EDEAE5` | group-hd 배경 |
| `SUB_BG` / `SUB_LINE` | `#E8E0D5` / `#C0B8AE` | sub-row 배경/선 |
| `WARN_BG` | `rgba(220,53,69,0.04)` | 전월대비 +25% 초과 지출 행 |
| `RED` / `GREEN` / `GRAY` | `#DC3545` / `#2E8B57` / `#999` | 뱃지 글자 (배경은 같은 색 8% 알파) |
| `FOOD` | `#2D4A7A` | 게이지 식재료 구간 |
| `WHITE` | `#FFFFFF` | PRIME·객단가 카드 |

### 글꼴 (전부 `"Noto Sans KR"`)

| 요소 | 굵기/크기 |
|---|---|
| 헤더 윗줄 | 700 11px |
| 지점명 | 900 18px |
| 연월 알약 | 600 10px, 흰 글자, radius 20, 패딩 3×10 |
| 섹션 제목 | 700 12px |
| thead | 600 11px |
| group-hd | 700 10px (자간 `.06em`) |
| 일반 행 이름/금액 | 500 14px |
| 일반 행 비율/전월대비 | 400 12px |
| sub-row 이름/금액 | 700 15px |
| profit-row | 900 15px |
| 뱃지 | 700 10px |
| PRIME 값 | 900 20px |
| 게이지 구간 글자 | 700 9px 흰색 |
| 통계 값 | 900 17px |

---

## File Structure

| 파일 | 책임 |
|---|---|
| **신규** `src/pages/admin/helpers/pnlDetailImage.ts` | 05 형태 PNG 를 그려 Blob 으로 돌려주는 순수 모듈. 화면을 모른다. 위 상수 표가 이 파일 안에 산다 |
| **수정** `src/pages/admin/AdminAnalysisSection.tsx` | 손익계산서 카드에 버튼 1개 + 클릭 핸들러(다운로드·진행 표시·오류 표시) |
| **수정** `src/index.css` | 버튼 스타일 1개 (기존 관리자 버튼 클래스를 재사용할 수 있으면 추가하지 않는다) |

---

### Task 1: 그리기 모듈 뼈대 — 상수 · 캔버스 · 헤더

**Files:**
- Create: `src/pages/admin/helpers/pnlDetailImage.ts`

**Interfaces:**
- Consumes: `PnlDbRow` (`./pnlDb`)
- Produces:
  ```ts
  export interface PnlDetailImageInput {
    branch: string;            // "남산광어"
    month: string;             // "2026-07"
    current: PnlDbRow;
    previous: PnlDbRow | null;
  }
  export async function renderPnlDetailPng(input: PnlDetailImageInput): Promise<Blob>
  export function brandOf(branch: string): string    // "대물섬 종로점" → "대물섬"
  ```

- [ ] **Step 1: 파일을 만들고 상수·타입·유틸을 넣는다**

위 "기준 좌표" 표의 색·글꼴·치수를 `TOKENS` / `FONTS` / `GEO` 상수 객체로 옮긴다. 함께 넣을 유틸:

```ts
const SCALE = 3, PAGE_W = 360, PAD = 10;
const font = (weight: number, size: number) => `${weight} ${size}px "Noto Sans KR", sans-serif`;
/** 브랜드 = 지점명의 첫 공백 앞부분 (05 산출물 16개 지점 헤더 실측) */
export function brandOf(branch: string): string {
  const i = branch.indexOf(" ");
  return i > 0 ? branch.slice(0, i) : branch;
}
const won = (v: number) => Math.round(v).toLocaleString("ko-KR");
const pct1 = (v: number | null) => (v === null ? "" : `${(v * 100).toFixed(1)}%`);
/** 우측 정렬 텍스트 */
function textR(ctx: CanvasRenderingContext2D, s: string, right: number, baseline: number) {
  ctx.textAlign = "right"; ctx.fillText(s, right, baseline);
}
/** 둥근 사각형 채우기 (뱃지·카드·알약 공용) */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
}
```

- [ ] **Step 2: 캔버스 생성과 글꼴 대기를 넣는다**

```ts
export async function renderPnlDetailPng(input: PnlDetailImageInput): Promise<Blob> {
  // 글꼴을 기다리지 않으면 첫 클릭에서 대체 글꼴로 깨져 나온다.
  await document.fonts.ready;
  const layout = planLayout(input);            // Task 2 에서 채운다
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W * SCALE;
  canvas.height = Math.ceil(layout.height) * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들지 못했습니다");
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = TOKENS.BG;
  ctx.fillRect(0, 0, PAGE_W, layout.height);
  drawHeader(ctx, input);
  // … Task 2·3 에서 표·카드 그리기 호출을 추가
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 변환에 실패했습니다"))), "image/png"));
}
```

- [ ] **Step 3: `drawHeader` 를 구현한다**

실측 기준: 윗줄 `UGD`(NAVY, 700 11px) + ` · {브랜드}`(MUTED) 베이스라인 **y=29**, x=16.
지점명(NAVY, 900 18px) 베이스라인 **y=57.5**, x=16.
연월 알약: 오른쪽 끝 x=344, 세로 중앙 y≈27, 높이 17, radius 20, 배경 NAVY, 글자 흰색 600 10px, 좌우 패딩 10 → 폭 = `측정폭 + 20`.

- [ ] **Step 4: `npm run lint` 로 타입 통과 확인**

Run: `npm run lint`
Expected: 오류 없음. (`planLayout` 미구현이면 이 단계에서는 `{ height: 964 }` 고정값으로 두고 Task 2 에서 대체한다)

---

### Task 2: 손익계산서 표

**Files:**
- Modify: `src/pages/admin/helpers/pnlDetailImage.ts`

**Interfaces:**
- Consumes: `buildStatement`(참고만 — 이 모듈은 05 표기·행 구성이 달라 자체 행 목록을 만든다), `PnlDbRow`
- Produces: 모듈 내부 `planLayout()`, `drawStatement()`

- [ ] **Step 1: 표 행 목록을 만드는 순수 함수를 쓴다**

```ts
type RowKind = "group" | "normal" | "sub" | "profit";
interface StmtRow {
  kind: RowKind;
  label: string;
  amount: number;
  share: number | null;      // 총매출 대비
  delta: { text: string; tone: "good" | "bad" | "flat" } | null;  // null = 칸 비움
  warn: boolean;             // 전월대비 +25% 초과 지출 행
  badge: boolean;            // false 면 뱃지 없이 글자만 (이익금 행)
}
```

행 구성 규칙 (설계서 §4.2, 05 산출물 실측):
1. `group` `매출`
2. `normal` `메뉴`(`메뉴매출`) / `주류`(`주류매출`) / `기타`(`배달/기타매출`) — **delta 는 항상 `null`**
3. `sub` `총매출` — share 는 `1`(100.0%), delta = 금액 증감률
4. `group` `지출`
5. `normal` 9행 고정, 금액 0이어도 표시:
   `임대료 · 식재료 · 주류원가 · 인건비 · 공과금 · 기타비용 · 광고비 · 세금예비 · 수수료`
6. `normal` `특별지출` — **`current.특별지출 !== 0` 일 때만** 추가. 라벨은 `특별지출비고` 를 05 규칙으로 해석:
   ```ts
   function specialLabel(note: string | undefined): string {
     if (!note) return "특별지출";
     if (note.includes("특별지출+=")) {
       const names = note.split("특별지출+=").slice(1)
         .map((part) => part.split("(")[0].trim()).filter(Boolean);
       if (names.length) return names.join("+");
     }
     const inner = note.trim();
     return inner ? inner.split(", ").join("+") : "특별지출";
   }
   ```
7. `sub` `총지출` — delta 는 **비율 증감(%p)**: `share(당월) - share(전월)`
8. `profit` `이익금` — delta 는 **이익률 증감(%p)**, `badge: false`

증감 판정 (05 임계값 그대로):
```ts
// 금액 증감률용. up = 값이 오르는 게 좋은 항목인가(매출 true / 지출 false)
function momCell(cur: number, prev: number | null | undefined, up: boolean) {
  if (prev === null || prev === undefined || prev <= 0) return null;   // 칸 비움
  const r = ((cur - prev) / prev) * 100;
  if (r > 0.5) return { text: `+${r.toFixed(1)}%`, tone: up ? "good" : "bad" } as const;
  if (r < -0.5) return { text: `${r.toFixed(1)}%`, tone: up ? "bad" : "good" } as const;
  return { text: "0.0%", tone: "flat" } as const;
}
// 비율 증감(%p)용. 총지출은 오르면 나쁨
function momPointCell(curP: number | null, prevP: number | null, up: boolean) {
  if (curP === null || prevP === null) return null;
  const d = (curP - prevP) * 100;
  if (d > 0.1) return { text: `+${d.toFixed(1)}%p`, tone: up ? "good" : "bad" } as const;
  if (d < -0.1) return { text: `${d.toFixed(1)}%p`, tone: up ? "bad" : "good" } as const;
  return { text: "0.0%p", tone: "flat" } as const;
}
```
`warn` 은 지출 `normal` 행에서 금액 증감률이 **+25% 초과**일 때 `true`.

- [ ] **Step 2: 행 높이로 전체 높이를 계산하는 `planLayout` 을 쓴다**

```ts
const H = { group: 21, groupTop: 2, groupBottom: 1, normal: 32, normalLine: 1,
            sub: 37, subLine: 2, profit: 39 };
```
표 시작 y = **95**(thead 상단), thead 높이 26 + 아래 선 2 → 첫 group 이 y=123 에서 시작.
행들을 순서대로 누적해 표 끝 y 를 얻고, 그 뒤에 `여백10 + 선1 + 여백10 + PRIME 100 + 여백10 + 선1 + 여백11 + 제목12 + 여백6 + 통계카드 62 + 아래여백 20` 을 더해 전체 높이를 낸다.
**검증 기준:** 남산광어 2026-06(지출 9행, 특별지출 없음) 입력으로 표 끝(이익금 행 바닥)이 **680**, 전체 높이가 05 의 964 에서 통계 카드 축소분(99−62=37)을 뺀 **927** 이어야 한다.

- [ ] **Step 3: `drawStatement` 로 표를 그린다**

- thead: MUTED 600 11px. `항목` 왼쪽 x=14, `금액` 우측 222.5, `비율` 우측 275.5, `전월대비` 우측 346. 아래 2px `LINE` 선.
- `group`: `GROUP_BG` 배경 21px, 위 2px `LINE`·아래 1px `LINE` 선, 글자 700 10px `MUTED`, x=16, 자간 `.06em` 는 글자 사이 0.6px 씩 수동 배치(`letterSpacing` 미지원 브라우저 대비).
- `normal`: `warn` 이면 `WARN_BG` 로 행을 먼저 칠한다. 이름 500 14px `NAVY` x=24 / 금액 500 14px 우측 222.5 / 비율 400 12px `MUTED` 우측 275.5 / 아래 1px `ROW_LINE` 선.
- `sub`: `SUB_BG` 배경 37px, 아래 2px `SUB_LINE` 선. 이름·금액 700 15px x=16 / 우측 222.5. 비율 400 12px.
- `profit`: `NAVY` 배경 39px, **좌우 radius 6**(`roundRect(10, y, 340, 39, 6)`). 글자 전부 900 15px `AMBER`. 이름 x=16, 금액 우측 222.5, 비율 우측 275.5, delta 우측 346 — **뱃지 없이 글자만**.
- 뱃지: 700 10px, 글자색 = tone별 `RED`/`GREEN`/`GRAY`, 배경 = 같은 색 알파 0.08, radius 3, 안쪽 패딩 세로 2·가로 4, **오른쪽 끝 345.5**. `delta === null` 이면 아무것도 안 그린다.

- [ ] **Step 4: `npm run lint`**

Run: `npm run lint` → 오류 없음

---

### Task 3: PRIME COST 게이지 · 객단가/영수건수 카드

**Files:**
- Modify: `src/pages/admin/helpers/pnlDetailImage.ts`

**Interfaces:**
- Consumes: `foodRateOf`, `laborRateOf`, `primeOf`, `PRIME_TARGET` (`./pnlDb`)

- [ ] **Step 1: 구분선과 PRIME 카드를 그린다**

- 구분선: `LINE` 1px, x=0~360 전폭.
- 카드: `WHITE`, `roundRect(10, y, 340, 100, 10)`.
- 안쪽(패딩 좌 12·우 12·위 9):
  - `PRIME COST` 700 10px `MUTED`
  - 값 900 20px `NAVY` + 그 옆 10px `MUTED` `식재료 39.1% + 인건비 26.0%`(숫자만 `NAVY` 700)
  - 게이지: 트랙 폭 316(=340−24), 높이 15, radius 9, 배경 `ROW_LINE`.
    채움 폭 = `min(prime, 1) × 316`, 그 안에서 식재료 구간 = `식재료율 ÷ prime`.
    식재료 `FOOD`, 인건비 `AMBER`. 각 구간에 700 9px 흰 글자로 비율을 중앙 배치(구간 폭이 글자보다 좁으면 생략).
    목표선: x = 트랙시작 + 0.60×316, 폭 2px `RED`, 게이지 위아래로 3px씩 튀어나오게. 위쪽에 700 9px `RED` `목표 60%` 를 중앙 기준 배치.
  - 범례 3개: 지름 6 원 + 9px `MUTED2` 글자, 간격 8.
- `식재료율 = 식재료 ÷ 메뉴매출`, `인건비율 = 인건비 ÷ 총매출` — `pnlDb` 의 헬퍼를 그대로 쓴다(직접 계산 금지).
  **검증값:** 남산광어 2026-06 → 39.1% + 26.0% = 65.1%.

- [ ] **Step 2: 통계 카드 2칸을 그린다**

- 제목 `▍객단가 & 영수건수`: 앰버 바 3×12 (x=10) + 700 12px `NAVY` 글자 x=19.
- 카드: `WHITE` `roundRect(10, y, 340, 62, 10)`, 가운데 x=180 에 1px `ROW_LINE` 세로 구분선.
- 각 칸(패딩 좌우 10·위 9):
  - 윗줄: 라벨 500 10px `MUTED` 왼쪽 / 뱃지 오른쪽 — 700 9px, radius 4, 패딩 1×4.
    전월비 > 0 → `▲+x.x%` `GREEN`, < 0 → `▼x.x%` `RED`, 0 → `0.0%` `GRAY`. 전월 없으면 뱃지 생략.
  - 값: 900 17px `NAVY` + 단위 500 10px (`원` / `건`). 값이 0 이면 `—` 만 찍고 뱃지 생략.
- **AI 코멘트는 그리지 않는다** (설계서 §5).

- [ ] **Step 3: `npm run lint`**

Run: `npm run lint` → 오류 없음

---

### Task 4: 버튼 배선

**Files:**
- Modify: `src/pages/admin/AdminAnalysisSection.tsx` (손익계산서 카드, 현재 880~916행 부근)
- Modify: `src/index.css` (필요할 때만)

- [ ] **Step 1: 현재 손익계산서 카드의 제목 밴드 구조를 읽는다**

Read: `src/pages/admin/AdminAnalysisSection.tsx:880-916` 와 `DESIGN_ADMIN.md` 의 버튼 규칙.
`AGENTS.md:59` — 밴드 제목은 텍스트만. 버튼은 밴드 안 제목 옆이 아니라 **밴드 오른쪽 끝**에 붙이거나 카드 본문 상단 우측에 둔다. 기존 관리자 버튼 클래스가 있으면 그것을 쓰고, 없을 때만 `index.css` 에 클래스 하나를 추가한다.

- [ ] **Step 2: 상태와 핸들러를 추가한다**

```tsx
const [imgBusy, setImgBusy] = useState(false);
const [imgError, setImgError] = useState<string | null>(null);

const handleSaveImage = async () => {
  if (!branchRow || imgBusy) return;
  setImgBusy(true); setImgError(null);
  let url: string | null = null;
  try {
    const blob = await renderPnlDetailPng({ branch, month, current: branchRow, previous: branchPrevRow });
    url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${month}_${branch.replace(/\s+/g, "_")}_손익계산서.png`;
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) {
    setImgError(e instanceof Error ? e.message : "이미지를 만들지 못했습니다");
  } finally {
    // revoke 를 click 직후에 하면 다운로드가 취소되는 브라우저가 있다 — 한 틱 뒤에 푼다.
    if (url) setTimeout(() => URL.revokeObjectURL(url!), 10_000);
    setImgBusy(false);
  }
};
```

- [ ] **Step 3: 버튼을 렌더한다**

```tsx
<button type="button" onClick={handleSaveImage} disabled={imgBusy}>
  {imgBusy ? "저장 중…" : "이미지 저장"}
</button>
{imgError && <span className="admin-rate-hot font-bold">{imgError}</span>}
```
`branchRow === null` 인 분기에서는 버튼 자체가 렌더되지 않으므로 별도 가드는 필요 없다.

- [ ] **Step 4: `npm run lint`**

Run: `npm run lint` → 오류 없음

---

### Task 5: 기준 PNG 대조와 보정

**Files:**
- Modify: `src/pages/admin/helpers/pnlDetailImage.ts` (어긋난 좌표만)

- [ ] **Step 1: 로컬에서 앱을 띄운다**

Run: `npm run dev` → http://localhost:3000
관리자 → 분석 → 지점 손익계산서 → `2026-06` / `남산광어` 선택 → `이미지 저장`

- [ ] **Step 2: 받은 PNG 를 기준 PNG 와 나란히 놓고 눈으로 대조한다**

기준: `02. 재무 회계/05. AGENT_대시보드 생성/output/2026-06/1. 지점별 손익계산서/2026-06_남산광어_detail.png`

확인 항목 (모두 통과해야 함):
- 표 12행의 **숫자 12×3개가 전부 일치** — 총매출 192,910,301 / 총지출 170,804,154 / 이익금 22,106,147 / 11.5%
- 공과금·기타비용·광고비 3행만 배경이 연빨강
- 총매출 `-1.1%` 빨강, 임대료 `-5.8%` 초록, 총지출 `+5.4%p` 빨강, 이익금 `-5.4%p` 앰버 글자
- PRIME `65.1%`, 게이지 식재료 39.1% + 인건비 26.0%, 목표선 60%
- 객단가 `127,015원` `▼-0.2%`, 영수건수 `1,515건` `▼-1.4%`

- [ ] **Step 3: 세로 좌표를 픽셀로 검산한다**

받은 PNG 를 스크래치 폴더에 두고:
```bash
python -c "
from PIL import Image; from collections import Counter
im=Image.open(r'<받은파일>').convert('RGB'); W,H=im.size
prev=None
for y in range(H):
    c=Counter(im.getpixel((x,y)) for x in range(30,W-30,7)).most_common(1)[0][0]
    if c!=prev: print(round(y/3,1), c); prev=c
"
```
기준 PNG 의 밴드 경계(위 "기준 좌표" 표)와 **±1px 안에서** 맞아야 한다. 통계 카드 아래(845 이후)는 AI 코멘트를 뺐으므로 다른 것이 정상이다. 어긋나면 상수만 고치고 다시 잰다.

- [ ] **Step 4: 특별지출이 있는 지점으로 10행 케이스를 본다**

`2026-07` / `카라멘야` → 지출 10번째 행에 `배달지출` 이 뜨고 전체 높이가 33px 늘어나야 한다.

- [ ] **Step 5: 전월 데이터가 없는 달을 본다**

업로드된 db 의 가장 이른 달을 골라 전월대비 칸이 **전부 비어 있는지**(뱃지 0개) 확인한다. 총지출·이익금 %p 칸도 비어야 한다.

- [ ] **Step 6: 사용자에게 로컬 화면과 받은 PNG 를 보여준다**

메모리 `erp_local_preview_before_deploy` — 배포 전 로컬 확인은 상시지침이다.

---

### Task 6: Codex 지독한 리뷰

- [ ] **Step 1: 변경분 리뷰를 돌린다**

메모리 `erp_codex_review_standing_rule` (P0): 한 줄만 고쳐도 직후 Codex 리뷰 필수.
백그라운드로 돌린다면 **Monitor 하트비트를 반드시 함께 건다**(`CLAUDE.md` Codex 원칙 1).
조회는 Git Bash 로만 한다(메모리 `codex_companion_powershell_trap`).

- [ ] **Step 2: 지적된 결함을 고치고 `npm run lint` 를 다시 돌린다**

- [ ] **Step 3: 커밋·배포는 사용자 지시를 기다린다**

"수정 완료, 배포할까요?" 까지만 말하고 멈춘다.

---

## Self-Review

**스펙 커버리지**
- §2 산출물(파일명·1080px) → Task 1 Step 2, Task 4 Step 2 ✅
- §4.1 헤더/브랜드 규칙 → Task 1 Step 3 (`brandOf`) ✅
- §4.2 표 전체(9행 고정·특별지출 조건부·뱃지 임계·경고행·%p) → Task 2 ✅
- §4.2 컬럼 폭 → 실측 기준선(222.5/275.5/345.5)으로 대체, 설계서의 계산값보다 정확 ✅
- §4.3 PRIME → Task 3 Step 1 ✅
- §4.4 객단가/영수건수, 코멘트 제외 → Task 3 Step 2 ✅
- §5 05 와의 차이 → 라벨 치환을 하지 않는 것이 Task 2 Step 1 의 행 구성에 반영됨 ✅
- §6 코드 배치·`document.fonts.ready`·중복 클릭 방지·오류 표시 → Task 1 Step 2, Task 4 ✅
- §7 디자인 규칙 → Task 4 Step 1 ✅
- §8 검증 6항목 → Task 5·6 ✅
- §9 하지 않는 것 → 계획 어디에도 본사 탭·05 수정·일괄 저장이 없음 ✅

**플레이스홀더** 없음. 모든 단계에 실제 값·코드·실행 명령이 있다.

**타입 일관성** `renderPnlDetailPng` / `PnlDetailImageInput` / `brandOf` / `StmtRow` / `momCell` / `momPointCell` / `specialLabel` / `planLayout` / `drawStatement` — Task 1~4 에서 이름과 시그니처가 같다. `branchPrevRow` 는 `AdminAnalysisSection.tsx` 에 이미 있는 이름을 그대로 쓴다.
