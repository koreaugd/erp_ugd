# 데이터 접근 계층 이관 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `erp_ugd` 의 Firestore 데이터 접근 계층을 `erp_saas` 로 옮기면서, 모든 경로에 회사ID를 붙이고 문서ID를 새 규약(`범위키--등급--키`)으로 바꾸고 규칙에 막히는 쿼리를 문서ID 열거로 대체한다. 화면은 건드리지 않는다.

**Architecture:** 화면은 `gasClient` 계약만 보므로(조사 실측: Firestore SDK import 가 `src/api/` 3개 파일뿐), 그 계약을 유지한 채 데이터 계층만 먼저 옮긴다. Firestore 인스턴스와 회사ID는 **주입**받는다 — 그래서 앱 빌드 도구 없이 에뮬레이터 + 실제 보안규칙으로 계층 전체를 검증할 수 있다. 빌드 도구(vite)와 화면은 다음 계획.

**Tech Stack:** TypeScript, `firebase` v12 웹 SDK (client), `@firebase/rules-unit-testing` v5, Vitest 4, Firestore 에뮬레이터

**Spec:** `docs/superpowers/specs/2026-08-17-multi-tenant-erp-design.md` — 특히 **§2.5 읽기 전략 확정**(이 계획의 근거), §3.2 데이터 구조, §3.4 접근 판정, §2.2 별도 취급 5건

**작업 저장소:** `c:\Users\yulte\OneDrive\바탕 화면\UGD\erp_saas`
**포팅 원본:** `c:\Users\yulte\OneDrive\바탕 화면\UGD\erp_ugd` — **읽기 전용. 단 한 줄도 수정하지 말 것** (14개 지점이 매일 쓰는 운영 시스템이다)

---

## Global Constraints

- **`erp_ugd` 는 0줄 변경.** 원본을 읽어 `erp_saas` 에 새로 쓴다. 계획 1~4에서 이 제약을 지켰다.
- **클라이언트는 회사·소속·권한 문서를 쓸 수 없다.** `users`·`members`·`invites`·`tenants`·`public_branches` 는 전부 `allow write: if false`. 이 계층은 그 문서들을 **읽기만** 한다.
- **쿼리·목록 조회 금지.** 업무 컬렉션 전부 `allow list: if false`. 허용된 `list` 는 **`public_branches`(구성원)** 와 **`members`(관리자)** 두 곳뿐. 그 외에 `query()`·`where()`·`getDocs(collection(...))` 를 쓰면 규칙에 막힌다.
- **범위키는 문서ID 안에 있다.** `범위키--…` 형식. `_all`(회사 전체)·`_admin`(관리자 전용)은 예약어. 규칙은 `id.split('--')[0]` 을 범위키로, `[1]` 을 등급으로 본다.
- **등급은 `gen` 또는 `salary`.** `shared_data`·`shared_data_backups` 는 **3칸 이상** 필수(`범위키--등급--키`). 급여는 별개 축이라 관리자도 등급을 우회하지 못한다.
- **지점명 인코딩 결과는 서버가 저장한 값과 한 글자도 달라선 안 된다.** 다르면 규칙은 인코딩본만 보므로 **조용히 빈 결과**가 난다.

  **★ 서버 파이프라인의 정확한 모양 (실측 — 초판이 틀리게 적었다):**
  `functions/src/lib/branchKey.ts` 의 `encodeBranch` 는 **순수 `encodeURIComponent(name)`** 이고 정규화를 하지 **않는다**(`:39`). 다듬기·NFC 는 `assertValidBranchNames` 안에 있다(`:71` `raw.trim().normalize("NFC")`). `toBranchPair` 는 **이미 정규화된** 이름에 `encodeBranch` 를 매핑한다(`:145`).

  ```
  저장되는 allowedBranchesEncoded = encodeURIComponent( NFC( trim(원문) ) )
                                    └ encodeBranch ┘   └ assertValidBranchNames ┘
  ```

  따라서 **클라이언트 함수는 서버의 `encodeBranch` 와 같아선 안 되고, 위 파이프라인 전체와 같아야 한다.** 이름이 같으면 그 차이를 놓치므로 클라이언트 쪽은 **`branchScopeKey`** 라고 부른다.

  이 계획 초판은 서버 `encodeBranch` 가 정규화까지 한다고 적었고, 그 전제로 "두 `encodeBranch` 를 직접 비교" 하는 테스트를 지시했다. **그 테스트는 어떤 올바른 구현으로도 통과할 수 없다** — 이 프로젝트에서 같은 유형(통과 불가한 테스트를 계획서가 지시)이 13번째다. 대조는 **저장되는 값을 만드는 파이프라인**과 해야 한다(Task 2 Step 5).
- **fail-closed.** 조용한 광역 읽기·조용한 빈 결과·조용한 폴백 금지. 막히면 한국어 오류를 던진다.
- **읽기 경로에 캐시 폴백을 새로 만들지 않는다.** 원본의 `getDoc`(캐시 허용) / `getDocFromServer`(서버 전용) 이중 변형 중, 돈이 걸린 출력은 서버 전용이다(원본 주석이 명시). 이 규칙을 그대로 옮긴다.
- 테스트는 **실제 `firestore.rules` 를 통과**해야 한다. Admin SDK 우회로 상태를 만들 수는 있지만(seed), 검증하는 호출은 규칙이 적용된 클라이언트로 한다.
- 거부 테스트는 **어느 조항이 거부했는가**까지 단언한다. 오류 코드가 겹치면 **메시지까지** 단언한다. (이 프로젝트에서 "다른 이유로 통과"가 12회 이상 발생했다.)

---

## 조사 실측 — 이 계획이 의존하는 사실

계획 착수 전 `erp_ugd` 전수 조사로 확인했다. 구현자는 이 사실을 다시 조사하지 말고 신뢰할 것.

| 사실 | 근거 |
|---|---|
| Firestore SDK import 가 `src/api/firebaseDirect.ts`·`userProfile.ts`·`firebaseAuth.ts` **3개 파일뿐** | `src/` 전체 grep. 화면·헬퍼는 컬렉션 이름 문자열을 **하나도** 갖고 있지 않다 |
| 실시간 리스너·페이지네이션·`orderBy`·`limit` 가 저장소 전체에 **없다** | grep. `getCountFromServer` 2회·`documentId()` 1회뿐이고 둘 다 죽은 코드거나 접두사 조회 |
| `daily_settles` 문서ID = `encodeURIComponent(지점)--YYYY-MM-DD` **보장** | `firebaseDirect.ts:24` `firebaseRecordId`, `scripts/normalize-daily-doc-ids.mjs` 가 성립시킨 규약 |
| 근태 집계 로직은 `gasClient` 에 있다(`firebaseDirect` 아님) | `gasClient.ts:499-616` `getAttendanceLog` |
| `shared_data` 봉투는 `{ value, updatedAt }` 두 칸. 페이로드 문자열화·gzip **없음** | `firebaseDirect.ts:567, 631` |
| 급여 축은 키 접두사 **4개**뿐 | `firestore.rules`(구) `isSalaryKey`: `monthly_fulltime_salary`·`part_time_salaries`·`part_time_salary_exclusions`·`part_time_profiles` |
| `monthly_closings` 는 **회사 전체 문서인데 지점이 쓴다** | `src/pages/branch/helpers/monthlyCheckSections.ts:62`(키) `:111`(읽기) `:138`(쓰기) |
| `labor_contracts_{지점}`(밑줄) 레거시 철자가 아직 읽기 폴백 + 최선노력 쓰기로 살아있다 | `LaborContractTab.tsx:105, 161, 262`, `BranchDashboardTab.tsx:80`, `AdminPage.tsx:4502` |

---

## 이 계획이 내리는 설계 결정 (그리고 왜)

### 결정 1 — `monthly_closings` 를 **지점별로 쪼갠다**

현행은 회사 전체 문서 하나에 **모든 지점이 쓴다.** 새 모델에서 이건 두 가지로 불가능하다:

1. `_all` 범위는 **쓰기가 관리자 전용**이다(규칙 `scopeAllowed`). 지점이 못 쓴다.
2. 한 문서에 14지점이 쓰면 Firestore 문서당 지속 쓰기 한도(~1회/초)에 걸린다.

→ `{enc(지점)}--gen--monthly_closings` 로 쪼갠다. 지점은 자기 문서만 쓰고, 관리자는 지점 목록만큼 읽는다. 현행 문서가 이미 **지점을 키로 하는 맵**이라(관리자 화면이 지점별 카운트를 뽑는다) 쪼개는 것이 자연스럽다.

**대가:** 관리자 마감현황 화면이 1 get → N get 이 된다. 관리자 화면은 이미 모든 것을 지점 루프로 읽으므로 새로운 비용이 아니다.

### 결정 2 — 레거시 `labor_contracts_{지점}`(밑줄) 철자를 **폐기한다**

새 규약에서 이 키는 `:` 가 없어 **회사 전체 문서로 오분류된다**(지점 격리가 조용히 사라진다). 새 제품에는 레거시 데이터가 없으므로 읽기 폴백도 쓰기 사본도 만들지 않는다. `sharedDocId` 는 이 철자를 **명시적 오류로 거부**한다 — 조용히 잘못된 범위에 쓰는 것보다 낫다.

### 결정 3 — `waitForFirebaseUser` 를 옮기지 않는다

원본은 데이터 함수마다 7초 `onAuthStateChanged` 대기를 넣었다(`firebaseDirect.ts:26-47`). 새 계층은 **회사 컨텍스트가 설정되기 전엔 아무것도 못 읽는다**(`getTenantContext()` 가 던진다). 컨텍스트는 인증이 해결된 뒤에만 설정되므로 그 대기를 포함한다. 함수마다 반복하던 대기는 사라지고, 테스트에서 Auth 를 띄우지 않아도 계층을 검증할 수 있다.

### 결정 4 — 이력 조회는 **월이 필수**가 된다

`getBranchHistory(지점, 월?)` 의 `월` 은 현행에서 **서버 필터가 아니라 클라이언트 필터**다(원본 주석이 명시). 새 계층에서 월 없는 전체 이력은 열거가 불가능하므로 **월을 필수**로 만들고 이름을 `getBranchMonth(지점, 월)` 로 바꾼다. 월 없이 부르던 3곳은 §2.5 표에 따라 월을 넘기거나(대부분) fail-closed 스텁으로 간다(2곳).

### 결정 5 — 등급 배정표는 **현행 규칙과 같게 유지**한다

급여 등급은 키 접두사 4개뿐이다. 연차·매입매출 등은 급여에 영향을 주지만 현행 급여 축에 **없다.** 이 계획은 권한 범위를 바꾸지 않는다 — 옮기기만 한다. 등급 재배정은 별도 결정이고, 하려면 사용자 승인이 필요하다.

---

## File Structure

전부 `erp_saas` 에 **신규 생성**. `erp_ugd` 는 원본으로 읽기만.

| 파일 | 책임 |
|---|---|
| `src/api/tenantContext.ts` | 회사ID + Firestore 인스턴스 보관, 경로 생성기. **모든 경로가 이 파일을 지난다** |
| `src/api/docId.ts` | 레거시 키 → `범위키--등급--키` 변환, 지점명 인코딩, 정산 문서ID |
| `src/api/sharedData.ts` | `shared_data` 읽기/쓰기 + 요일 슬롯 백업 |
| `src/api/sharedDataTx.ts` | `shared_data` 트랜잭션 연산 4개 |
| `src/api/dailySettles.ts` | 정산 문서 단위 연산(제출·상세·수정·원자수정·삭제) + `edit_logs` 쓰기 |
| `src/api/dailyQueries.ts` | **막힌 쿼리의 열거 대체** — 월 이력·날짜별 목록·날짜배열·부트스트랩 |
| `src/api/rosters.ts` | `branch_own_rosters` 5개 연산 |
| `src/api/directory.ts` | `public_branches` 목록, `members` 목록(구 `listUserProfiles`), 본인 프로필 |
| `src/api/unavailable.ts` | 계획 7(롤업)이 닫을 읽기 2개의 fail-closed 스텁 |
| `src/api/index.ts` | 계층의 공개 표면. 화면이 이것만 본다 |
| `tests/api/helpers.ts` | 규칙 적용 클라이언트 + 회사 컨텍스트 주입 + seed |
| `tests/api/*.test.ts` | 태스크별 테스트 |

**주의:** `src/api/gasClient.ts` 는 이 계획에서 만들지 **않는다.** 근태 집계 등 화면용 조립 로직이 들어있어 화면 계획과 함께 간다. 이 계획은 그 아래 계층까지다.

---

## Task 1: 회사 컨텍스트와 경로 생성기

**Files:**
- Create: `erp_saas/src/api/tenantContext.ts`
- Create: `erp_saas/tests/api/helpers.ts`
- Create: `erp_saas/tests/api/tenantContext.test.ts`
- Modify: `erp_saas/package.json` (스크립트 `test:api` 추가), `erp_saas/vitest.config.ts` (해당하면 include 확장)

**Interfaces:**
- Produces:
  - `type TenantContext = { db: Firestore; tenantId: string }`
  - `setTenantContext(ctx: TenantContext): void`
  - `getTenantContext(): TenantContext` — 미설정 시 **throw**
  - `clearTenantContext(): void`
  - `tenantColl(name: string): CollectionReference`
  - `tenantDoc(name: string, id: string): DocumentReference`
  - `TENANT_CONTEXT_MISSING = "회사 정보가 아직 준비되지 않았습니다. 다시 로그인해 주세요."`
- Consumes: 없음 (첫 태스크)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`erp_saas/tests/api/tenantContext.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  setTenantContext, getTenantContext, clearTenantContext,
  tenantColl, tenantDoc, TENANT_CONTEXT_MISSING,
} from "../../src/api/tenantContext";
import { ruledDb, teardownApiClients } from "./helpers";

describe("tenantContext", () => {
  beforeEach(() => clearTenantContext());
  afterAll(async () => { await teardownApiClients(); });

  it("설정 전에 컨텍스트를 요구하면 던진다 — 최상위 경로로 조용히 떨어지지 않는다", () => {
    expect(() => getTenantContext()).toThrow(TENANT_CONTEXT_MISSING);
    expect(() => tenantColl("shared_data")).toThrow(TENANT_CONTEXT_MISSING);
    expect(() => tenantDoc("shared_data", "x--gen--y")).toThrow(TENANT_CONTEXT_MISSING);
  });

  it("경로가 tenants/{id}/ 아래로 생성된다", async () => {
    setTenantContext({ db: await ruledDb("u1"), tenantId: "t-abc" });
    expect(tenantColl("shared_data").path).toBe("tenants/t-abc/shared_data");
    expect(tenantDoc("daily_settles", "A--2026-08-01").path)
      .toBe("tenants/t-abc/daily_settles/A--2026-08-01");
  });

  it("빈 회사ID·슬래시 포함 회사ID를 거부한다 — 경로 탈출 방지", async () => {
    const db = await ruledDb("u1");
    expect(() => setTenantContext({ db, tenantId: "" })).toThrow(/회사 정보/);
    expect(() => setTenantContext({ db, tenantId: "a/b" })).toThrow(/회사 정보/);
  });

  it("clearTenantContext 후에는 다시 던진다 — 로그아웃이 데이터 접근을 끊는다", async () => {
    setTenantContext({ db: await ruledDb("u1"), tenantId: "t-abc" });
    expect(getTenantContext().tenantId).toBe("t-abc");
    clearTenantContext();
    expect(() => getTenantContext()).toThrow(TENANT_CONTEXT_MISSING);
  });
});
```

`erp_saas/tests/api/helpers.ts` — 규칙 적용 클라이언트를 만들어 주입한다. `tests/rules/helpers.ts` 의 방식을 따르되, **`Firestore` 인스턴스를 반환**하는 것이 다르다:

```ts
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import type { Firestore } from "firebase/firestore";

let env: RulesTestEnvironment | null = null;

async function getEnv(): Promise<RulesTestEnvironment> {
  if (!env) {
    env = await initializeTestEnvironment({
      projectId: "demo-erp-saas",
      firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
    });
  }
  return env;
}

/** 규칙이 적용된 Firestore 인스턴스. uid 없이 부르면 비로그인. */
export async function ruledDb(uid?: string): Promise<Firestore> {
  const e = await getEnv();
  const ctx = uid ? e.authenticatedContext(uid) : e.unauthenticatedContext();
  return ctx.firestore() as unknown as Firestore;
}

/** 규칙을 우회해 상태를 심는다. 검증에는 절대 쓰지 말 것 — seed 전용. */
export async function seed(fn: (db: Firestore) => Promise<void>): Promise<void> {
  const e = await getEnv();
  await e.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore() as unknown as Firestore);
  });
}

export async function clearAll(): Promise<void> {
  const e = await getEnv();
  await e.clearFirestore();
}

/** 파일당 한 번, 맨 끝에서만 호출할 것 (계획 3 하네스 교훈). */
export async function teardownApiClients(): Promise<void> {
  if (env) { await env.cleanup(); env = null; }
}
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd erp_saas
npx firebase emulators:exec --only firestore --project demo-erp-saas "npx vitest run tests/api/tenantContext.test.ts"
```
Expected: FAIL — `Cannot find module '../../src/api/tenantContext'`

- [ ] **Step 3: 최소 구현**

`erp_saas/src/api/tenantContext.ts`:

```ts
import { collection, doc, type CollectionReference, type DocumentReference, type Firestore } from "firebase/firestore";

export const TENANT_CONTEXT_MISSING = "회사 정보가 아직 준비되지 않았습니다. 다시 로그인해 주세요.";

export type TenantContext = { db: Firestore; tenantId: string };

let current: TenantContext | null = null;

/**
 * 회사 컨텍스트를 설정한다. 인증이 해결되고 users/{uid}.tenantId 를 읽은 **뒤에만**
 * 부른다. 원본(erp_ugd)은 데이터 함수마다 7초 onAuthStateChanged 대기를 넣었지만,
 * 이 계층은 컨텍스트가 없으면 아무것도 읽지 못하므로 그 대기가 여기로 흡수된다.
 */
export function setTenantContext(ctx: TenantContext): void {
  const id = String(ctx?.tenantId || "").trim();
  // 슬래시가 들어오면 경로가 컬렉션 경계를 넘는다(tenants/a/b/shared_data). 원천 차단.
  if (!id || id.includes("/")) throw new Error(TENANT_CONTEXT_MISSING);
  if (!ctx.db) throw new Error(TENANT_CONTEXT_MISSING);
  current = { db: ctx.db, tenantId: id };
}

export function getTenantContext(): TenantContext {
  if (!current) throw new Error(TENANT_CONTEXT_MISSING);
  return current;
}

export function clearTenantContext(): void {
  current = null;
}

export function tenantColl(name: string): CollectionReference {
  const { db, tenantId } = getTenantContext();
  return collection(db, "tenants", tenantId, name);
}

export function tenantDoc(name: string, id: string): DocumentReference {
  const { db, tenantId } = getTenantContext();
  return doc(db, "tenants", tenantId, name, id);
}
```

`erp_saas/package.json` 의 `scripts` 에 추가(기존 항목은 건드리지 않는다):

```json
"test:api": "firebase emulators:exec --only firestore --project demo-erp-saas \"vitest run tests/api\"",
```

그리고 `test:all` 을 `"npm run test:rules && npm run test:api && npm run test:functions"` 로 바꾼다.

- [ ] **Step 4: 통과를 확인한다**

```bash
cd erp_saas && npm run test:api
```
Expected: PASS 4건. 그리고 `npm run test:all` 로 기존 256건이 그대로임을 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add src/api/tenantContext.ts tests/api/helpers.ts tests/api/tenantContext.test.ts package.json
git commit -F - <<'EOF'
feat(api): 회사 컨텍스트와 경로 생성기

모든 Firestore 경로가 tenants/{tenantId}/ 아래로 생성되도록 단일 통로를 만든다.
컨텍스트 미설정 시 던져서, 최상위 경로로 조용히 떨어지는 일을 원천 차단한다.
회사ID에 슬래시가 들어오면 경로가 컬렉션 경계를 넘으므로 거부한다.

erp_ugd 의 함수별 waitForFirebaseUser 대기는 옮기지 않는다 — 컨텍스트 설정
자체가 인증 해결 이후이므로 그 대기를 흡수한다(설계 결정 3).
EOF
```

---

## Task 2: 문서ID 규약 — 레거시 키 35개의 범위·등급 배정

이 태스크가 계획의 심장이다. 여기서 틀리면 **지점 격리가 조용히 사라지거나 급여가 새어나간다.**

**Files:**
- Create: `erp_saas/src/api/docId.ts`
- Create: `erp_saas/tests/api/docId.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces:
  - `type Grade = "gen" | "salary"`
  - `ALL_SCOPE = "_all"`, `ADMIN_SCOPE = "_admin"`
  - `branchScopeKey(name: string): string`
  - `sharedDocId(dataKey: string): string` — 레거시 키 → `범위키--등급--키`
  - `sharedBackupDocId(dataKey: string, slot: number): string` — `범위키--등급--키--slot{n}`
  - `dailyRecordId(branchName: string, settleDate: string): string` — `enc(지점)--YYYY-MM-DD`
  - `editLogDocId(recordId: string, stamp: number): string`
  - `parseDailyRecordId(id: string): { branchEncoded: string; settleDate: string }`

**배정표 (구현자는 이 표를 그대로 코드에 옮긴다).**
`{b}` = 지점명, `{m}` = `YYYY-MM`. 새 키는 `:` 를 `_` 로 바꾸고 지점 칸을 뺀 것이다.

| 레거시 키 | 범위 | 등급 | 새 키 칸 |
|---|---|---|---|
| `monthly_fulltime_salary:{b}:{m}` | `enc(b)` | **salary** | `monthly_fulltime_salary_{m}` |
| `part_time_salaries:{b}:{m}` | `enc(b)` | **salary** | `part_time_salaries_{m}` |
| `part_time_salary_exclusions:{b}:{m}` | `enc(b)` | **salary** | `part_time_salary_exclusions_{m}` |
| `part_time_profiles:{b}` | `enc(b)` | **salary** | `part_time_profiles` |
| `monthly_purchases:{b}:{m}` | `enc(b)` | gen | `monthly_purchases_{m}` |
| `monthly_sales_summary:{b}:{m}` | `enc(b)` | gen | `monthly_sales_summary_{m}` |
| `monthly_closings:{b}` | `enc(b)` | gen | `monthly_closings` |
| `annual_leave:{b}` | `enc(b)` | gen | `annual_leave` |
| `annual_leave_grant_overrides:{b}` | `enc(b)` | gen | `annual_leave_grant_overrides` |
| `annual_leave_used_adjust:{b}` | `enc(b)` | gen | `annual_leave_used_adjust` |
| `manual_overtime:{b}` | `enc(b)` | gen | `manual_overtime` |
| `manual_parttime:{b}` | `enc(b)` | gen | `manual_parttime` |
| `staff_movements:{b}` | `enc(b)` | gen | `staff_movements` |
| `labor_contracts:{b}` | `enc(b)` | gen | `labor_contracts` |
| `liquor_products:{b}` | `enc(b)` | gen | `liquor_products` |
| `liquor_movements:{b}` | `enc(b)` | gen | `liquor_movements` |
| `orders:{b}` | `enc(b)` | gen | `orders` |
| `order_vendors:{b}` | `enc(b)` | gen | `order_vendors` |
| `branch_notice_checks:{b}` | `enc(b)` | gen | `branch_notice_checks` |
| `kakao_taxi_requests:{b}` | `enc(b)` | gen | `kakao_taxi_requests` |
| `admin_settings` | `_all` | gen | `admin_settings` |
| `admin_notices` | `_all` | gen | `admin_notices` |
| `admin_dashboard_notices` | `_all` | gen | `admin_dashboard_notices` |
| `labor_contract_template_parttime_meta` | `_all` | gen | 그대로 |
| `labor_contract_template_parttime_file_{id}` | `_all` | gen | 그대로 |
| `admin_reviewed_edit_logs` | `_admin` | gen | 그대로 |
| `admin_reviewed_manual_overtimes` | `_admin` | gen | 그대로 |
| `admin_taxi_anomaly_ack` | `_admin` | gen | 그대로 |
| `analysis_pnl_db` | `_admin` | gen | 그대로 |
| `pnl_report_pack:{m}` | `_admin` | gen | `pnl_report_pack_{m}` |
| `pnl_report_pack_index` | `_admin` | gen | 그대로 |

**폐기(명시적 오류로 거부):**
- `labor_contracts_{b}` (밑줄 레거시 철자) — 설계 결정 2
- `annual_leave_grants:{b}` (읽기 전용 승계 키) — 새 제품에 승계할 데이터가 없다
- `migration_status` — 구 이관 스크립트 전용
- **`kakao_taxi_branch_history`** — **초판이 `_admin` 으로 잘못 배정했다**(리뷰 P0). 헬퍼가 `pages/admin/helpers/` 에 있을 뿐 **지점 화면 `BusinessTaxiTab.tsx:270,283` 이 호출**한다. 현재 범위 어휘에 맞는 값이 없어(`_admin`·`_all` 둘 다 지점 쓰기 거부, 지점 범위는 전사 단일 로그라 불가) **서버 함수 도입 후 계획 7에서 연다**

**백업 문서ID 4칸이 규칙에 안전한 이유 (착수 전 실측 확인 — 구현자는 다시 조사하지 말 것)**

`sharedBackupDocId` 는 `--slot{n}` 을 덧붙여 **4칸**을 만든다. 구 규칙은 이걸 위해
`stripBackupSuffix` 헬퍼가 필요했는데, **새 규칙에는 필요 없다.** 이유:

| | 구 규칙 | 새 규칙 |
|---|---|---|
| 지점을 얻는 법 | 키를 `:`(=`%3A`)로 쪼갠 **1번째 칸** | 문서ID 를 `--` 로 쪼갠 **0번째 칸** |
| 급여 판별 | 키 접두사 정규식 매칭 | 문서ID 의 **1번째 칸** |
| 슬롯 접미사의 영향 | 지점 칸이 **마지막 칸일 때 오염**됨(`part_time_profiles:{지점}` 처럼 월 칸이 없는 키) → 그래서 벗겨내야 했다 | **없음** — 범위·등급이 **맨 앞 고정 위치**라 뒤에 무엇이 붙어도 안 밀린다 |

실측: `firestore.rules` 의 `sharedIdValid` 는 `idParts(id).size() >= 3`(4칸 통과)과
`gradeOf(id) = idParts(id)[1]` 을 본다. `enc(B)--salary--part_time_salaries_2026-08--slot3`
은 `scopeOf`=`enc(B)`, `gradeOf`=`salary` 로 **원본 문서와 동일하게** 판정된다.
이것이 새 규약이 구 규약보다 나은 지점이므로, 구 규칙의 `stripBackupSuffix` 를
옮기려 하지 말 것.

**`_all` 쓰기 검증 (착수 전 전수 확인 — 구현자는 다시 조사하지 말 것)**

`_all` 범위는 규칙상 **읽기=구성원, 쓰기=관리자**다. 그래서 **지점 화면이 쓰는 키는 `_all` 이 될 수 없다.** `monthly_closings` 가 그 경우여서 지점 범위로 쪼갰다(설계 결정 1). 같은 실수가 더 있는지 `_all`·`_admin` 배정 키 **전부의 쓰기 지점**을 추적했다:

| 키 | 쓰기 지점 | 판정 |
|---|---|---|
| `admin_notices` · `admin_dashboard_notices` | `AdminPage.tsx:1602, 1650`(가변 키 공용 저장 함수) | 관리자 ✓ |
| `labor_contract_template_parttime_meta` / `_file_{id}` | `AdminPage.tsx:4472` (`saveLaborContractTemplate`) | 관리자 ✓ |
| `kakao_taxi_branch_history` | `pages/admin/helpers/kakaoTaxiBranchHistory.ts` | 관리자 ✓ |
| `analysis_pnl_db` · `pnl_report_pack*` | `pages/admin/AdminAnalysisSection.tsx` · `AdminReportPackTab.tsx` | 관리자 ✓ |
| `admin_reviewed_*` · `admin_taxi_anomaly_ack` | `AdminPage.tsx` | 관리자 ✓ |
| **`admin_settings`** | `BranchConfirmPage.tsx:469` (관리자 PIN 게이트 뒤) ✓ **그리고 `:363`** ← **문제** | 아래 참조 |

**★ `admin_settings` 의 heal 경로(`BranchConfirmPage.tsx:350-370`)를 옮기지 않는다.**

그 `useEffect` 는 **마운트 시 무조건** 돌고, 원격 문서가 비어 있으면 `localStorage` 값을 올린다. 지점 사용자도 이 코드를 실행하므로 `_all` 쓰기 규칙에 **거부된다**(그리고 `catch` 가 `console.warn` 으로 삼켜서 조용히 실패한다).

옮기지 않는 이유: 이 경로는 **localStorage → 원격 이관용 레거시 코드**다. 새 제품에는 이관할 localStorage 데이터가 없다. `admin_settings` 문서는 관리자가 저장할 때 처음 생기고, 그때까지 지점은 `null` 을 받는다(화면이 이미 그 경우를 다룬다).

**옮겼다면 생기는 일:** 지점 사용자의 매 페이지 로드마다 권한 오류 경고가 뜨고, 그 경로에 의지해 문서가 생기길 기대하면 **신규 회사에서 `admin_settings` 가 영원히 만들어지지 않는다.**

**저장 경로(`:469`)는 관리자 전용이 맞다 — 실측 확인.** 그 버튼은 `isPasscodeVerified && (` 안에서만 렌더된다(`:1158`). 즉 `_all` 배정이 성립한다.

**화면 계획이 반드시 해야 할 일 (이 계획의 `_all` 배정이 여기에 의존한다):** 현행 게이트는 **관리자 PIN** 인데 새 제품은 **PIN 방식을 폐기**했다. 그러므로 그 편집 UI 는 `members/{uid}.role === "admin"` 으로 다시 게이트해야 한다. 역할 게이트 없이 옮기면, 규칙이 쓰기를 거부하므로 **관리자 설정 저장이 통째로 실패**한다. 이 계층의 Task 3 테스트 #6·#7 이 그 규칙 의미(지점=거부, 관리자=허용)를 이미 고정해 둔다.

**화면 계획에 넘기는 관찰(이 계획에서 바꾸지 않음):** `admin_settings` 에는 `fullTimeSalaryPasscode` 가 들어 있고 `_all` 은 **모든 구성원이 읽는다**(`SalaryAccessGate.tsx:160` 이 그렇게 쓴다). 즉 급여 게이트 비밀번호가 전 구성원에게 읽힌다. 새 제품의 급여 축은 `salaryBranchesEncoded` 이므로 이 비밀번호 게이트 자체가 불필요해질 수 있다. 권한 재배정은 사용자 승인이 필요한 별개 사안이라 이 계획은 현행 범위를 그대로 옮기고 기록만 남긴다(설계 결정 5).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`erp_saas/tests/api/docId.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  branchScopeKey, sharedDocId, sharedBackupDocId, dailyRecordId,
  parseDailyRecordId, editLogDocId, ALL_SCOPE, ADMIN_SCOPE,
} from "../../src/api/docId";

describe("branchScopeKey — 저장 파이프라인과 한 글자도 달라선 안 된다", () => {
  it("공백을 다듬고 NFC 로 정규화한 뒤 encodeURIComponent 한다", () => {
    expect(branchScopeKey(" 남산광어 ")).toBe(encodeURIComponent("남산광어"));
    // NFD(분해형) 입력이 NFC 와 같은 결과여야 한다 — 다르면 같은 지점의 문서가 둘로 갈린다
    expect(branchScopeKey("남산광어".normalize("NFD"))).toBe(branchScopeKey("남산광어"));
  });
  it("빈 지점명을 거부한다", () => {
    expect(() => branchScopeKey("   ")).toThrow(/지점명/);
  });
});

describe("sharedDocId — 범위·등급 배정", () => {
  const B = "남산광어";
  const e = encodeURIComponent(B);

  it.each([
    [`monthly_fulltime_salary:${B}:2026-08`, `${e}--salary--monthly_fulltime_salary_2026-08`],
    [`part_time_salaries:${B}:2026-08`,       `${e}--salary--part_time_salaries_2026-08`],
    [`part_time_salary_exclusions:${B}:2026-08`, `${e}--salary--part_time_salary_exclusions_2026-08`],
    [`part_time_profiles:${B}`,               `${e}--salary--part_time_profiles`],
    [`monthly_purchases:${B}:2026-08`,        `${e}--gen--monthly_purchases_2026-08`],
    [`monthly_sales_summary:${B}:2026-08`,    `${e}--gen--monthly_sales_summary_2026-08`],
    [`monthly_closings:${B}`,                 `${e}--gen--monthly_closings`],
    [`annual_leave:${B}`,                     `${e}--gen--annual_leave`],
    [`labor_contracts:${B}`,                  `${e}--gen--labor_contracts`],
    [`kakao_taxi_requests:${B}`,              `${e}--gen--kakao_taxi_requests`],
    ["admin_settings",                        `${ALL_SCOPE}--gen--admin_settings`],
    ["admin_notices",                         `${ALL_SCOPE}--gen--admin_notices`],
    ["labor_contract_template_parttime_meta", `${ALL_SCOPE}--gen--labor_contract_template_parttime_meta`],
    ["labor_contract_template_parttime_file_abc", `${ALL_SCOPE}--gen--labor_contract_template_parttime_file_abc`],
    ["analysis_pnl_db",                       `${ADMIN_SCOPE}--gen--analysis_pnl_db`],
    ["admin_taxi_anomaly_ack",                `${ADMIN_SCOPE}--gen--admin_taxi_anomaly_ack`],
    ["pnl_report_pack:2026-08",               `${ADMIN_SCOPE}--gen--pnl_report_pack_2026-08`],
    ["pnl_report_pack_index",                 `${ADMIN_SCOPE}--gen--pnl_report_pack_index`],
  ])("%s → %s", (legacy, expected) => {
    expect(sharedDocId(legacy)).toBe(expected);
  });

  it("모든 결과가 규칙이 요구하는 3칸 이상이고 등급 칸이 gen|salary 다", () => {
    const keys = [`annual_leave:${B}`, "admin_settings", `part_time_profiles:${B}`, "pnl_report_pack_index"];
    for (const k of keys) {
      const parts = sharedDocId(k).split("--");
      expect(parts.length).toBeGreaterThanOrEqual(3);
      expect(["gen", "salary"]).toContain(parts[1]);
      expect(parts[0]).not.toBe("");
    }
  });

  it.each([
    [`labor_contracts_${B}`, /레거시/],
    [`annual_leave_grants:${B}`, /레거시/],
    ["migration_status", /레거시/],
  ])("폐기된 키 %s 를 거부한다 — 조용히 잘못된 범위에 쓰지 않는다", (key, re) => {
    expect(() => sharedDocId(key)).toThrow(re);
  });

  it("알 수 없는 키를 거부한다 — 새 키를 추가하면 이 표에 등록해야 한다", () => {
    expect(() => sharedDocId("something_new:남산광어")).toThrow(/등록되지 않은/);
  });

  it("지점명에 -- 나 예약어가 들어오면 거부한다 — 범위 칸이 밀린다", () => {
    expect(() => sharedDocId("annual_leave:강남--역삼")).toThrow();
    expect(() => sharedDocId("annual_leave:_all")).toThrow();
    expect(() => sharedDocId("annual_leave:_admin")).toThrow();
    // 끝 하이픈: enc(강남-) + '--' 를 split('--')[0] 하면 enc(강남) 으로 밀린다 (계획 4 교훈)
    expect(() => sharedDocId("annual_leave:강남-")).toThrow();
  });
});

describe("sharedBackupDocId — 백업도 3칸 규약을 지키고 등급이 앞에 남는다", () => {
  it("슬롯 접미사가 맨 뒤에 붙는다", () => {
    const B = "남산광어", e = encodeURIComponent(B);
    expect(sharedBackupDocId(`monthly_fulltime_salary:${B}:2026-08`, 3))
      .toBe(`${e}--salary--monthly_fulltime_salary_2026-08--slot3`);
  });
  it("슬롯 범위를 벗어나면 거부한다", () => {
    expect(() => sharedBackupDocId("admin_settings", 7)).toThrow(/슬롯/);
    expect(() => sharedBackupDocId("admin_settings", -1)).toThrow(/슬롯/);
  });
  it("백업ID의 범위·등급 칸이 원본과 같다 — 규칙 판정이 동일해야 한다", () => {
    const legacy = "part_time_salaries:남산광어:2026-08";
    const a = sharedDocId(legacy).split("--"), b = sharedBackupDocId(legacy, 0).split("--");
    expect(b[0]).toBe(a[0]);
    expect(b[1]).toBe(a[1]);
  });
});

describe("dailyRecordId", () => {
  it("enc(지점)--YYYY-MM-DD", () => {
    expect(dailyRecordId("남산광어", "2026-08-01")).toBe(`${encodeURIComponent("남산광어")}--2026-08-01`);
  });
  it("날짜 형식을 검사한다 — 어긋난 ID 는 조용히 안 읽힌다", () => {
    expect(() => dailyRecordId("남산광어", "2026-8-1")).toThrow(/날짜/);
    expect(() => dailyRecordId("남산광어", "")).toThrow(/날짜/);
  });
  it("왕복한다", () => {
    const id = dailyRecordId("남산광어", "2026-08-01");
    expect(parseDailyRecordId(id)).toEqual({
      branchEncoded: encodeURIComponent("남산광어"), settleDate: "2026-08-01",
    });
  });
});

describe("editLogDocId", () => {
  it("정산 문서ID 의 범위 칸을 물려받는다 — 규칙이 같은 범위로 판정한다", () => {
    const rec = dailyRecordId("남산광어", "2026-08-01");
    const id = editLogDocId(rec, 1755400000000);
    expect(id.split("--")[0]).toBe(encodeURIComponent("남산광어"));
    expect(id).toBe(`${rec}--1755400000000`);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd erp_saas && npx vitest run tests/api/docId.test.ts
```
Expected: FAIL — 모듈 없음. (에뮬레이터 불필요 — 순수 함수)

- [ ] **Step 3: 구현**

`erp_saas/src/api/docId.ts`:

```ts
/**
 * 문서ID 규약의 단일 변환 지점. 범위키가 문서ID 안에 있으므로(설계서 §3.4)
 * 이 파일이 틀리면 지점 격리가 조용히 사라지거나 급여가 새어나간다.
 *
 * 서버 저장 파이프라인은 assertValidBranchNames(trim+NFC) → encodeBranch 다.
 * **한 글자도** 달라선 안 된다 — 다르면 조용히 빈 결과가 난다.
 */

export type Grade = "gen" | "salary";

export const ALL_SCOPE = "_all";
export const ADMIN_SCOPE = "_admin";
const RESERVED_SCOPES = [ALL_SCOPE, ADMIN_SCOPE];

export function branchScopeKey(name: string): string {
  const trimmed = String(name ?? "").normalize("NFC").trim();
  if (!trimmed) throw new Error("지점명이 비어 있습니다.");
  if (trimmed.includes("--")) throw new Error(`지점명에 '--' 를 쓸 수 없습니다: ${trimmed}`);
  // 앞뒤 하이픈: enc(강남-) 뒤에 '--' 가 붙으면 split('--')[0] 이 enc(강남) 으로 밀린다
  if (trimmed.startsWith("-") || trimmed.endsWith("-")) {
    throw new Error(`지점명은 하이픈으로 시작하거나 끝날 수 없습니다: ${trimmed}`);
  }
  if (RESERVED_SCOPES.includes(trimmed)) throw new Error(`예약된 이름입니다: ${trimmed}`);
  const encoded = encodeURIComponent(trimmed);
  if (encoded.length > 100) throw new Error(`지점명이 너무 깁니다: ${trimmed}`);
  return encoded;
}

/** 범위를 지점에서 얻는 키: 접두사 → 등급. 지점 칸은 항상 ':' 로 나눈 1번째. */
const BRANCH_KEYS: Record<string, Grade> = {
  monthly_fulltime_salary: "salary",
  part_time_salaries: "salary",
  part_time_salary_exclusions: "salary",
  part_time_profiles: "salary",
  monthly_purchases: "gen",
  monthly_sales_summary: "gen",
  monthly_closings: "gen",   // 설계 결정 1 — 회사 전체 문서를 지점별로 쪼갰다
  annual_leave: "gen",
  annual_leave_grant_overrides: "gen",
  annual_leave_used_adjust: "gen",
  manual_overtime: "gen",
  manual_parttime: "gen",
  staff_movements: "gen",
  labor_contracts: "gen",
  liquor_products: "gen",
  liquor_movements: "gen",
  orders: "gen",
  order_vendors: "gen",
  branch_notice_checks: "gen",
  kakao_taxi_requests: "gen",
};

/** 회사 전체 문서: 관리자가 쓰고 구성원이 읽는다. */
const ALL_KEYS = new Set([
  "admin_settings",
  "admin_notices",
  "admin_dashboard_notices",
  "labor_contract_template_parttime_meta",
]);

/** 관리자 전용 문서. */
const ADMIN_KEYS = new Set([
  "admin_reviewed_edit_logs",
  "admin_reviewed_manual_overtimes",
  "admin_taxi_anomaly_ack",
  "kakao_taxi_branch_history",
  "analysis_pnl_db",
  "pnl_report_pack_index",
]);

/** 새 제품으로 옮기지 않는 키. 조용히 잘못된 범위에 쓰는 것보다 던지는 게 낫다. */
const RETIRED = [
  { test: (k: string) => /^labor_contracts_/.test(k), why: "레거시 밑줄 철자 (labor_contracts:{지점} 을 쓸 것)" },
  { test: (k: string) => /^annual_leave_grants(:|$)/.test(k), why: "레거시 승계 전용 키" },
  { test: (k: string) => k === "migration_status", why: "레거시 이관 스크립트 전용 키" },
];

function scopeGrade(dataKey: string): { scope: string; grade: Grade; key: string } {
  const key = String(dataKey ?? "");
  for (const r of RETIRED) {
    if (r.test(key)) throw new Error(`레거시 키는 지원하지 않습니다: ${key} — ${r.why}`);
  }

  // 접두사 매칭 (지점 범위)
  const colon = key.indexOf(":");
  if (colon > 0) {
    const prefix = key.slice(0, colon);
    const rest = key.slice(colon + 1).split(":");
    if (prefix in BRANCH_KEYS) {
      const branch = rest[0];
      const tail = rest.slice(1);
      if (tail.length > 1) throw new Error(`키 칸이 너무 많습니다: ${key}`);
      return {
        scope: branchScopeKey(branch),
        grade: BRANCH_KEYS[prefix],
        key: tail.length ? `${prefix}_${tail[0]}` : prefix,
      };
    }
    if (prefix === "pnl_report_pack") {
      return { scope: ADMIN_SCOPE, grade: "gen", key: `pnl_report_pack_${rest.join("_")}` };
    }
  }

  if (ALL_KEYS.has(key)) return { scope: ALL_SCOPE, grade: "gen", key };
  if (ADMIN_KEYS.has(key)) return { scope: ADMIN_SCOPE, grade: "gen", key };
  // 템플릿 파일은 fileId 가 붙어 열거할 수 없으므로 접두사로 판정한다
  if (key.startsWith("labor_contract_template_parttime_file_")) {
    return { scope: ALL_SCOPE, grade: "gen", key };
  }

  throw new Error(`등록되지 않은 공유데이터 키입니다: ${key} — src/api/docId.ts 의 배정표에 추가하세요.`);
}

export function sharedDocId(dataKey: string): string {
  const { scope, grade, key } = scopeGrade(dataKey);
  return `${scope}--${grade}--${key}`;
}

export function sharedBackupDocId(dataKey: string, slot: number): string {
  if (!Number.isInteger(slot) || slot < 0 || slot > 6) {
    throw new Error(`백업 슬롯은 0~6 이어야 합니다: ${slot}`);
  }
  return `${sharedDocId(dataKey)}--slot${slot}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function dailyRecordId(branchName: string, settleDate: string): string {
  const date = String(settleDate ?? "").trim();
  if (!DATE_RE.test(date)) throw new Error(`날짜 형식이 올바르지 않습니다(YYYY-MM-DD): ${settleDate}`);
  return `${branchScopeKey(branchName)}--${date}`;
}

export function parseDailyRecordId(id: string): { branchEncoded: string; settleDate: string } {
  const parts = String(id ?? "").split("--");
  if (parts.length !== 2 || !parts[0] || !DATE_RE.test(parts[1])) {
    throw new Error(`정산 문서ID 형식이 올바르지 않습니다: ${id}`);
  }
  return { branchEncoded: parts[0], settleDate: parts[1] };
}

/** 변경이력 ID. 정산 ID 를 접두사로 물려받아 규칙이 같은 범위로 판정하게 한다. */
export function editLogDocId(recordId: string, stamp: number): string {
  parseDailyRecordId(recordId);   // 형식 검증 — 범위 칸이 없는 ID 를 만들지 않는다
  if (!Number.isInteger(stamp) || stamp <= 0) throw new Error(`타임스탬프가 올바르지 않습니다: ${stamp}`);
  return `${recordId}--${stamp}`;
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
cd erp_saas && npx vitest run tests/api/docId.test.ts
```
Expected: PASS 전건.

- [ ] **Step 5: 서버와의 인코딩 일치를 실증한다 — 별칭(alias)으로**

두 구현이 갈라지면 **조용히 빈 결과**가 난다. 주석 약속으로는 부족하고, 기댓값 표를 양쪽에 복사하면 그 표가 갈라진다. 그래서 **서버 정본을 실제로 import 해서 대조**한다.

**착수 전에 확인된 제약 (구현자는 다시 조사하지 말 것):**
`functions/src/lib/branchKey.ts` 는 1행에서 `import { HttpsError } from "firebase-functions/v2/https"` 를 한다. 그리고 `firebase-functions` 는 **저장소 루트에서 해석되지 않는다** — `functions/` 가 자체 `package.json`·`node_modules` 를 가진 별도 npm 프로젝트이고, 루트에는 그 의존성이 없다(실측 확인). Vitest 는 루트에서 도므로 그냥 import 하면 **모듈 해석 실패**로 죽는다.

**해결: Vitest 별칭으로 `HttpsError` 만 스텁한다.** 서버 코드는 0줄 변경이고(계획 4 테스트가 덮는 파일이다), 실제 서버 `branchScopeKey` 가 클라이언트 단언 아래로 들어온다.

`erp_saas/tests/api/stubs/firebase-functions-https.ts` 를 만든다:

```ts
/**
 * Vitest 전용 스텁. functions/src/lib/branchKey.ts 를 클라이언트 테스트에서
 * import 하기 위한 것뿐이다 — firebase-functions 는 저장소 루트에서 해석되지
 * 않는다(functions/ 가 별도 npm 프로젝트).
 *
 * branchKey.ts 는 HttpsError 를 **던지는 데만** 쓰므로 형태만 맞으면 된다.
 * 우리가 대조하는 정상 경로는 이 클래스를 건드리지 않는다.
 */
export class HttpsError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "HttpsError";
  }
}
```

`erp_saas/vitest.config.ts` 에 별칭을 추가한다(기존 설정은 유지):

```ts
resolve: {
  alias: {
    // tests/api 가 서버 정본 branchKey.ts 를 import 해 인코딩 일치를 실증하기 위한
    // 것뿐이다. tests/functions 는 함수를 에뮬레이터 위로 호출하므로 서버 모듈을
    // import 하지 않아 영향받지 않는다.
    "firebase-functions/v2/https": new URL("./tests/api/stubs/firebase-functions-https.ts", import.meta.url).pathname,
  },
},
```

`tests/api/docId.test.ts` 에 describe 를 추가한다:

```ts
import { assertValidBranchNames, toBranchPair } from "../../functions/src/lib/branchKey";

/**
 * 서버의 encodeBranch 하나와 비교하면 안 된다 — 그것은 정규화를 하지 않으므로
 * 다듬지 않은 입력에서 반드시 어긋난다(통과 불가한 테스트가 된다).
 * 대조 대상은 **실제로 저장되는 값**, 즉 assertValidBranchNames → toBranchPair
 * 파이프라인의 출력이다. 이것이 규칙이 읽는 allowedBranchesEncoded 다.
 */
function storedEncoded(name: string): string {
  return toBranchPair(assertValidBranchNames([name])).allowedBranchesEncoded[0];
}

describe("branchScopeKey 가 서버가 저장하는 인코딩본과 같다", () => {
  it.each(["남산광어", "대물섬 한남점", "8번대물집", "카츠 스위스", "A-B", "금샤빠"])("%s", (name) => {
    expect(branchScopeKey(name)).toBe(storedEncoded(name));
  });

  it("다듬지 않은 입력도 같다 — 저장 파이프라인이 trim 하므로 클라이언트도 해야 한다", () => {
    expect(branchScopeKey("  남산광어  ")).toBe(storedEncoded("  남산광어  "));
  });

  it("NFD 입력도 같다 — 정규화 시점이 어긋나면 같은 지점이 두 문서로 갈린다", () => {
    const n = "남산광어".normalize("NFD");
    expect(branchScopeKey(n)).toBe(storedEncoded(n));
  });

  it("서버 encodeBranch 단독과는 다르다 — 이 차이가 이 테스트의 존재 이유다", async () => {
    const { encodeBranch } = await import("../../functions/src/lib/branchKey");
    // 서버 encodeBranch 는 정규화를 하지 않으므로 다듬지 않은 입력에서 갈린다.
    expect(encodeBranch("  남산광어  ")).not.toBe(branchScopeKey("  남산광어  "));
  });

  it("별칭이 실제로 서버 파일을 불러왔음을 확인한다 — 스텁만 로드되고 조용히 통과하는 것을 막는다", () => {
    expect(typeof assertValidBranchNames).toBe("function");
    // 서버 정본은 '--' 를 HttpsError 로 거부한다. 별칭 스텁이 그 클래스를 제공한다.
    expect(() => assertValidBranchNames(["강남--역삼"])).toThrow(/--/);
  });
});
```

**마지막 두 테스트가 중요하다.** 하나는 별칭이 잘못 걸려 서버 모듈이 로드되지 않았는데도 통과하는 상황을 막고(이 프로젝트에서 "다른 이유로 통과"가 12회 이상 났다), 다른 하나는 **두 함수가 실제로 다름**을 고정해 나중에 누가 "이름이 다른데 같은 거 아닌가" 하며 한쪽을 지우는 것을 막는다.

Run: `npx vitest run tests/api/docId.test.ts` → PASS
그리고 **`npm run test:all` 로 기존 256건이 그대로임을 확인한다** — 별칭이 전역 설정이므로 다른 스위트에 영향이 없음을 실증해야 한다.

- [ ] **Step 6: 커밋**

```bash
git add src/api/docId.ts tests/api/docId.test.ts
git commit -F - <<'EOF'
feat(api): 문서ID 규약 — 레거시 키 35개의 범위·등급 배정표

범위키가 문서ID 안에 있으므로 이 변환이 지점 격리와 급여 격리를 결정한다.
배정표를 코드로 고정하고, 등록되지 않은 키는 거부한다(새 키를 조용히
회사 전체 범위로 떨어뜨리지 않는다).

설계 결정 2건을 반영:
- monthly_closings 를 지점별로 쪼갰다. 회사 전체 문서인데 지점이 쓰던
  문서라, _all 범위(쓰기=관리자)로는 지점이 저장할 수 없고 한 문서에
  14지점이 쓰면 문서당 쓰기 한도에 걸린다.
- labor_contracts_{지점}(밑줄 레거시) 을 폐기했다. ':' 가 없어 새 규약에서
  회사 전체 문서로 오분류되고, 지점 격리가 조용히 사라진다.

클라이언트 branchScopeKey 가 서버가 저장하는 인코딩본과 같은지
테스트로 실증한다 — 갈라지면 조용히 빈 결과가 난다.
EOF
```

---

## Task 3: `shared_data` 읽기·쓰기 + 요일 슬롯 백업

**Files:**
- Create: `erp_saas/src/api/sharedData.ts`
- Create: `erp_saas/tests/api/sharedData.test.ts`

**Interfaces:**
- Consumes: `tenantDoc`(Task 1), `sharedDocId`·`sharedBackupDocId`(Task 2)
- Produces:
  - `getSharedData<T>(dataKey: string): Promise<T | null>` — 캐시 허용
  - `getSharedDataFromServer<T>(dataKey: string): Promise<T | null>` — 서버 전용, 실패 시 throw
  - `saveSharedData(dataKey: string, value: unknown): Promise<{ success: true }>`
  - `SharedEnvelope = { value: unknown; updatedAt: string }`

**포팅 원본:** `erp_ugd/src/api/firebaseDirect.ts:555-641` (`firebaseGetSharedData`, `firebaseGetSharedDataFromServer`, `firebaseSaveSharedData`)

**바꾸는 것:** 문서 경로가 `tenantDoc("shared_data", sharedDocId(key))` 가 된다. 백업은 `tenantDoc("shared_data_backups", sharedBackupDocId(key, new Date().getDay()))`. 봉투 `{ value, updatedAt }` 와 요일 슬롯 회전(`slot = getDay()`)은 **그대로 유지**한다 — 원본 주석(`firebaseDirect.ts:612-618`)이 근거를 설명한다.

**유지해야 하는 불변식 (원본에서 확인된 것):**
1. 읽기는 "문서 없음"과 "`value: null`"을 **같은 `null`** 로 접는다. 그대로 유지 — 호출자 19곳이 이 동작에 의존한다.
2. `saveSharedData` 는 **last-write-wins**다. 부분 수정은 `mutateSharedData`(Task 4)를 쓰라는 원본 주석이 있다.
3. 백업 쓰기 실패는 **본 저장을 실패시키지 않는다**(로그만).
4. `updatedAt` 은 ISO 문자열이다. Firestore `Timestamp` 를 쓰지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`erp_saas/tests/api/sharedData.test.ts` — 최소 이 시나리오를 담는다:

```ts
// 하네스: seed 로 tenants/{t} + members/{uid} 를 심고(계획 1~4 규칙이 요구),
// setTenantContext({ db: await ruledDb(uid), tenantId: t }) 로 주입한다.
// seed 헬퍼를 tests/api/helpers.ts 에 추가한다:
//   seedMember(t, uid, { role, allowedBranches, salaryBranches })
//   — allowedBranchesEncoded / salaryBranchesEncoded 를 branchScopeKey 로 함께 채운다
//     (규칙은 인코딩본만 본다 — 원문만 심으면 조용히 거부된다)
```

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | 담당 지점의 `annual_leave:{내지점}` 저장 → 읽기 | 왕복 성공, `updatedAt` 이 ISO |
| 2 | 담당 아닌 지점의 `annual_leave:{남의지점}` 읽기 | **거부** (`permission-denied`), 결정 조항 = `scopeAllowed` |
| 3 | 급여권한 없이 `monthly_fulltime_salary:{내지점}:{월}` 읽기 | **거부** — 지점은 담당인데 등급에서 막힘을 확인 (범위 통과·등급 거부 귀속) |
| 4 | 급여권한 부여 후 같은 키 읽기 | 성공 |
| 5 | `admin_settings`(`_all`) 를 지점이 읽기 | 성공 |
| 6 | `admin_settings` 를 지점이 **쓰기** | **거부** — `_all` 쓰기는 관리자 |
| 7 | `admin_settings` 를 관리자가 쓰기 | 성공 |
| 8 | `analysis_pnl_db`(`_admin`) 를 지점이 읽기 | **거부** |
| 9 | 저장 후 `shared_data_backups` 에 `--slot{요일}` 문서가 생겼는지 (seed 클라이언트로 확인) | 존재, `dataKey`·`value`·`sourceUpdatedAt`·`backedUpAt` 4칸 |
| 10 | 같은 요일에 두 번 저장 | 슬롯 문서가 **덮어써짐**(2개가 아니라 1개) |
| 11 | 문서 없는 키 읽기 | `null` (throw 아님) |
| 12 | `getSharedDataFromServer` 를 권한 없는 키로 | **throw** (조용한 `null` 아님) |
| 13 | 등록되지 않은 키로 저장 시도 | Task 2 의 `등록되지 않은` 오류가 그대로 올라옴 |

- [ ] **Step 2: 실패를 확인한다** — `npm run test:api` → FAIL(모듈 없음)
- [ ] **Step 3: 구현한다** — 원본 `firebaseDirect.ts:555-641` 을 위 경로·ID 로 옮긴다. `waitForFirebaseUser` 호출은 넣지 않는다(설계 결정 3).
- [ ] **Step 4: 통과를 확인한다** — `npm run test:api` → PASS
- [ ] **Step 5: 커밋**

```bash
git add src/api/sharedData.ts tests/api/sharedData.test.ts tests/api/helpers.ts
git commit -F - <<'EOF'
feat(api): shared_data 읽기·쓰기 + 요일 슬롯 백업

경로를 tenants/{t}/shared_data 로, 문서ID 를 범위키--등급--키 로 옮긴다.
봉투 {value, updatedAt} 와 요일 슬롯 회전은 원본 그대로 유지한다.

범위 거부와 등급 거부를 **각각** 귀속시켜 테스트했다 — 담당 지점인데
급여 등급에서 막히는 경우를 확인해야 두 축이 독립임이 증명된다.
EOF
```

---

## Task 4: `shared_data` 트랜잭션 연산 4개

**Files:**
- Create: `erp_saas/src/api/sharedDataTx.ts`
- Create: `erp_saas/tests/api/sharedDataTx.test.ts`

**Interfaces:**
- Consumes: `tenantDoc`(T1), `sharedDocId`·`sharedBackupDocId`(T2)
- Produces:
  - `mutateSharedData<T>(dataKey: string, mutate: (current: T | null) => T | null): Promise<{ changed: boolean; value: T | null }>`
  - `createSharedDataIfMissing(dataKey: string, value: unknown): Promise<{ created: boolean }>`
  - `updateSharedArrayItem(dataKey: string, itemId: string, expectStatus: string[], patch: Record<string, unknown>, expectMatch?: Record<string, unknown>): Promise<{ outcome: "updated" | "notFound" | "conflict"; list: any[] }>`
  - `appendSharedArrayItem(dataKey: string, item: Record<string, unknown>, dedupe?: { match: Record<string, unknown>; statuses: string[] }): Promise<{ outcome: "appended" | "duplicate"; list: any[] }>`

**포팅 원본:** `firebaseDirect.ts:643-777` 네 함수. 시그니처와 반환 `outcome` 문자열을 **한 글자도 바꾸지 말 것** — 화면이 문자열로 분기한다.

**유지해야 하는 불변식:**
1. `mutate` 는 **순수 함수**여야 한다(재시도 시 여러 번 호출). 원본 주석 `firebaseDirect.ts:322-323`, `gasClient.ts:694-699`.
2. `mutate` 가 `null` 을 반환하면 **아무것도 쓰지 않는다**. `changed: false`.
3. 반환 `value` 는 **트랜잭션이 실제로 본 값**이다(안 바꿨으면 현재 값).
4. `mutateSharedData` 는 백업 슬롯을 **트랜잭션 안에서** 함께 쓴다(`saveSharedData` 와 달리 원자적).
5. `createSharedDataIfMissing` 은 `null`/`undefined` 만 "없음"으로 본다 — **빈 배열은 있음**이다.
6. `updateSharedArrayItem`·`appendSharedArrayItem` 은 백업을 **쓰지 않는다**(원본과 동일).

- [ ] **Step 1: 실패하는 테스트를 쓴다** — 최소:

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | `mutateSharedData` 가 값을 바꾼다 | `{changed:true, value:새값}`, 문서 반영 |
| 2 | `mutate` 가 `null` 반환 | `{changed:false}`, 문서 **무변경**(`updatedAt` 도 그대로) |
| 3 | `mutateSharedData` 가 백업 슬롯을 같은 트랜잭션에 쓴다 | 슬롯 문서에 **이전** 값이 담김 |
| 4 | `createSharedDataIfMissing` 이 빈 배열을 "있음"으로 본다 | `{created:false}` |
| 5 | 없는 키에 create | `{created:true}` |
| 6 | `updateSharedArrayItem` 상태 불일치 | `{outcome:"conflict"}` |
| 7 | 없는 itemId | `{outcome:"notFound"}` |
| 8 | `expectMatch` 불일치 | `{outcome:"conflict"}` |
| 9 | `appendSharedArrayItem` dedupe 적중 | `{outcome:"duplicate"}`, 배열 길이 불변 |
| 10 | 담당 아닌 지점 키로 mutate | **거부**(`permission-denied`) |
| 11 | 급여 등급 키를 권한 없이 mutate | **거부**, 등급 조항 귀속 |
| 12 | 동시 mutate 2건이 순차 적용된다 | 둘 다 반영(마지막 값이 둘의 합성) — 트랜잭션 재시도 실증 |

- [ ] **Step 2: 실패 확인** — `npm run test:api` → FAIL
- [ ] **Step 3: 구현** — 원본 4함수 이식
- [ ] **Step 4: 통과 확인** — `npm run test:api` → PASS
- [ ] **Step 5: 커밋**

```bash
git add src/api/sharedDataTx.ts tests/api/sharedDataTx.test.ts
git commit -m "feat(api): shared_data 트랜잭션 연산 4개 (mutate/createIfMissing/updateArrayItem/appendArrayItem)"
```

---

## Task 5: 정산 문서 단위 연산 + `edit_logs`

**Files:**
- Create: `erp_saas/src/api/dailySettles.ts`
- Create: `erp_saas/tests/api/dailySettles.test.ts`

**Interfaces:**
- Consumes: `tenantDoc`(T1), `dailyRecordId`·`editLogDocId`·`parseDailyRecordId`(T2)
- Produces:
  - `type MasterDaily`, `ExpenseDetail`, `StaffRecord`, `DailySettleDetail` (아래 Step 3 에 전문)
  - `submitDaily(master, expenses, staff): Promise<{ recordId: string }>`
  - `getDailyDetail(recordId): Promise<DailySettleDetail>` — 캐시 허용
  - `getDailyDetailFromServer(recordId): Promise<DailySettleDetail>` — 서버 전용
  - `updateDaily(recordId, masterData, expenses?, staff?, modifiedBy?, modifiedByUid?, reason?): Promise<{ success: boolean; editLogFailed?: boolean }>`
  - `updateDailyAtomic(recordId, mutate, modifiedBy?, modifiedByUid?, reason?): Promise<{ success: boolean; editLogFailed?: boolean }>`
  - `deleteDaily(recordId): Promise<{ success: boolean }>`
  - `toMaster(data: any): MasterDaily`

**포팅 원본:** `firebaseDirect.ts:24, 49-68, 128-154, 156-179, 253-323, 325-395, 397-410` + `edit_logs` 쓰기 `:293-305, :376-388`

**바꾸는 것:**
1. 경로 → `tenantDoc("daily_settles", …)`, `tenantDoc("edit_logs", …)`
2. `edit_logs` 문서ID → `editLogDocId(recordId, Date.now())` = `enc(지점)--YYYY-MM-DD--{stamp}`.

   **★ 정정 (2026-08-18, 구현 중 변이 테스트로 반증됨).** 이 계획 초판은 "원본은 하이픈
   1개라 범위키가 **없었다**" 고 썼는데 **틀렸다.** `recordId` 자체가 이미 `enc(지점)--날짜`
   라서, 원본의 `{recordId}-{stamp}` 도 `split('--')[0]` 이 **정확히 `enc(지점)`** 을 준다.
   실측: `enc(남산광어)--2026-08-01-1755400000000`.split('--')[0] === `enc(남산광어)` → true.

   즉 **원본 방식도 범위 격리는 성립했다.** `--` 로 바꾸는 진짜 이유는 더 소박하다 —
   칸이 2개에서 3개가 되어 타임스탬프가 **분리 가능한 칸**이 되고, 규약(`범위키--…`)이
   눈으로 읽힌다. 격리 결함을 고치는 변경이 아니라 정돈이다.
3. **snake_case 별칭을 쓰지 않는다.** `toMaster` 의 `*_sales`·`branch_name` 등 레거시 별칭은 새 제품에 레거시 데이터가 없으므로 **제거**한다. camelCase 만 읽고 쓴다. 그래서 원본의 `or()` 쿼리 이유가 사라진다.
4. `backupSettleDirect`(GAS 미러 쓰기)는 **옮기지 않는다.** GAS 시트 미러는 제품 대상이 아니다.

**유지해야 하는 불변식:**
1. `setDoc` 봉투는 `{ recordId, master, expenses, staff, updatedAt }` 5칸. **merge 없이 전체 교체**(원본과 동일).
2. `submittedAt` 은 최초 제출 시각을 보존한다(기존 문서가 있으면 그 값을 유지).
3. `totalSales` 는 쓸 때마다 4개 매출의 합으로 **재계산**한다.
4. `edit_logs` 쓰기 실패는 정산 저장을 실패시키지 않는다 → `editLogFailed: true`.
5. `updateDailyAtomic` 의 `mutate` 는 순수 함수. `before`/`after` 는 **마지막 커밋 시도**의 값이다.
6. `getDailyDetail` 은 `expenses`/`staff` 배열을 **정규화하지 않고 그대로** 반환한다(원본과 동일).

- [ ] **Step 1: 실패하는 테스트를 쓴다** — 최소:

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | 담당 지점 제출 → 상세 읽기 왕복 | 5칸 봉투, `totalSales` 가 합 |
| 2 | 같은 날 재제출 | `submittedAt` **보존**, `modifiedAt` 갱신 |
| 3 | 담당 아닌 지점 제출 | **거부**, `scopeAllowed` 귀속 |
| 4 | 담당 아닌 지점 상세 읽기 | **거부** |
| 5 | `updateDaily` 가 정산 + `edit_logs` 두 문서를 쓴다 | 둘 다 존재, 변경이력 ID 의 범위 칸 = 지점 |
| 6 | `edit_logs` 문서ID 가 `--` 3칸 구조다 | `split('--')[0]` = `enc(지점)` |
| 7 | 담당 아닌 지점의 변경이력을 읽기 | **거부** — 범위 칸이 제대로 박혔음의 증명 |
| 8 | `updateDailyAtomic` 의 `mutate` 로 금액 변경 | 반영, `before`/`after` 가 변경 전후 |
| 9 | `mutate` 가 여러 번 호출돼도 결과가 같다(순수성) | 동시 2건에서 둘 다 반영 |
| 10 | `deleteDaily` | 문서 사라짐 |
| 11 | 관리자가 남의 지점 정산을 읽는다 | 성공 — 관리자는 범위 단락 |
| 12 | `getDailyDetailFromServer` 를 권한 없는 문서로 | **throw**(조용한 null 아님) |

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현.** 타입은 원본 `gasClient.ts:36-64` 를 그대로 옮긴다(단 snake_case 별칭 제거):

```ts
export interface MasterDaily {
  recordId?: string;
  branchName: string;
  settleDate: string;        // YYYY-MM-DD
  cashSales: number;
  cardSales: number;
  transferSales: number;
  deliverySales: number;
  totalSales?: number;
  memo: string;
  submittedAt?: string;
  submittedBy?: string;
  submittedByUid?: string;
  modifiedAt?: string;
  modifiedBy?: string;
  modifiedByUid?: string;
}
export interface ExpenseDetail { expenseType: "현금지출" | "카드지출"; itemName: string; amount: number; }
export interface StaffRecord { staffName: string; workHours: number; division?: string; }
export interface DailySettleDetail { master: MasterDaily; expenses: ExpenseDetail[]; staff: StaffRecord[]; }
```

- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋**

```bash
git add src/api/dailySettles.ts tests/api/dailySettles.test.ts
git commit -F - <<'EOF'
feat(api): 정산 문서 단위 연산 + 변경이력

edit_logs 문서ID 를 {정산ID}--{타임스탬프} 로 바꿨다. 칸이 3개가 되어
타임스탬프가 분리 가능해지고 규약이 눈으로 읽힌다. (격리 결함 수정이 아니다 —
recordId 가 이미 --를 포함해 원본의 하이픈 1개 방식도 범위키는 정상이었다.)
담당 아닌 지점이 변경이력을 못 읽음을 테스트로 고정한다.

snake_case 별칭(*_sales, branch_name 등)을 제거했다. 새 제품에 레거시
데이터가 없으므로, 원본이 두 철자를 or() 쿼리로 맞춰야 했던 이유가 사라진다.
GAS 시트 미러(backupSettleDirect)는 옮기지 않는다.
EOF
```

---

## Task 6: 막힌 쿼리의 열거 대체 — 이 계획의 목적

**Files:**
- Create: `erp_saas/src/api/dailyQueries.ts`
- Create: `erp_saas/tests/api/dailyQueries.test.ts`

**Interfaces:**
- Consumes: `tenantDoc`(T1), `dailyRecordId`(T2), `toMaster`·`MasterDaily`(T5), `getBranchList`(T7 — **주의: T7 뒤에 구현되므로 이 태스크는 지점 목록을 인자로 받는다**)
- Produces:
  - `getDailyMastersByDates(branchName: string, dates: string[]): Promise<MasterDaily[]>`
  - `getBranchMonth(branchName: string, month: string): Promise<MasterDaily[]>` — 구 `getBranchHistory(지점, 월)`
  - `getDailyListForDate(settleDate: string, branchNames: string[]): Promise<{ branchName: string; recordId: string; record: MasterDaily | null }[]>`
  - `getDailyFormBootstrap(branchName: string, settleDate: string): Promise<DailyFormBootstrap>` where
    ```ts
    export interface DailyFormBootstrap {
      exists: boolean;
      recordId: string;
      record: MasterDaily | null;
      previousCash: string;
      /** 7일 역방향 탐색으로도 직전 기록을 못 찾았다는 뜻. previousCash 는 "0" 이지만
       *  그것이 **실제 0원인지 모르는 상태인지**를 화면이 구분해야 한다. */
      previousCashUnknown: boolean;
    }
    ```
    **`previousCashUnknown` 을 반환 타입에서 빼지 말 것** — 빼면 선언된 인터페이스를 만족시키면서 "실제 0"과 "모름"을 구분하는 유일한 신호를 버릴 수 있다.
  - `monthDates(month: string): string[]` — `"2026-08"` → `["2026-08-01", …, "2026-08-31"]` (실제 말일까지)

**포팅 원본:** `firebaseDirect.ts:197-212`(모범 사례 — 이미 열거형), `:70-126`(대체 대상 쿼리들), `:214-241`, `:584-598`

**핵심 변경:** 원본의 `or(where(...))` 쿼리 4개를 전부 **문서ID 열거**로 바꾼다.

| 원본 | 새 구현 |
|---|---|
| `dailyDocsQuery(지점)` — 그 지점 전체 이력 | `getBranchMonth(지점, 월)` = `monthDates(월).map(d => getDoc(dailyRecordId(지점,d)))` |
| `dailyDateQuery(날짜)` — 그 날짜 전 지점 | `getDailyListForDate(날짜, 지점목록)` = 지점마다 `getDoc(dailyRecordId(지점,날짜))` |
| `findDailyDocs` 전체 스캔 폴백 | **삭제.** 존재하지 않는다 |
| 인덱스 실패 시 전체 스캔 폴백 | **삭제.** 실패는 그대로 던진다 |

**`getDailyFormBootstrap` 의 "전일 현금"**: 원본은 그 지점 전체 이력을 읽어 직전 날짜를 찾았다. 새 구현은 **하루씩 최대 7일 뒤로** 문서ID 를 열거해 처음 발견된 문서에서 꺼낸다(원본과 같은 `memo` METADATA 파싱). 7일 안에 없으면 `previousCash: "0"`. 상한을 두는 이유: 상한이 없으면 신규 지점에서 무한히 뒤로 읽는다. **7일을 넘겨 못 찾은 경우는 `"0"` 을 조용히 주지 않고 `previousCashUnknown: true` 를 함께 반환**해 화면이 구분할 수 있게 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — 최소:

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | `monthDates("2026-08")` | 31개, `2026-08-01`~`2026-08-31` |
| 2 | `monthDates("2026-02")` | 28개 (2026년은 평년) |
| 3 | `monthDates("2024-02")` | 29개 (윤년) |
| 4 | 형식이 아닌 월 | **throw** |
| 5 | `getBranchMonth` 가 그 달 존재하는 문서만 반환 | 심은 3일치만, 날짜순 |
| 6 | `getBranchMonth` 가 **다른 달 문서를 섞지 않는다** | 전월 문서를 심어도 안 나옴 |
| 7 | `getBranchMonth` 가 담당 아닌 지점이면 거부 | **throw**(빈 배열 아님) |
| 8 | 문서가 있는데 `master` 가 없으면 던진다 | 원본과 동일 — 손상 감지 |
| 9 | `getDailyListForDate` 가 미제출 지점을 `record: null` 로 준다 | 지점 수만큼 행, null 구분 |
| 10 | `getDailyMastersByDates` 가 없는 날짜를 건너뛴다 | 존재하는 것만 |
| 11 | `getDailyFormBootstrap` 이 전일 현금을 METADATA 에서 꺼낸다 | 값 일치 |
| 12 | 전일이 비고 그 전날에 있으면 그것을 쓴다 | 값 일치 |
| 13 | 7일 안에 아무것도 없으면 `previousCashUnknown: true` | 조용한 `"0"` 아님 |
| 14 | `exists` 판정이 문서ID 직접 조회다 | 같은 지점·날짜 문서를 심으면 `exists: true` |
| 15 | **소스 전체에 `query`·`where`·`orderBy`·`getDocs(collection(` 이 없다** | grep 0건 (Task 8 에서 전역 확인, 여기선 이 파일만) |

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현.** `monthDates` 는 이렇게 쓴다(월말 계산 실수를 막는다):

```ts
const MONTH_RE = /^\d{4}-\d{2}$/;

export function monthDates(month: string): string[] {
  const m = String(month ?? "").trim();
  if (!MONTH_RE.test(m)) throw new Error(`월 형식이 올바르지 않습니다(YYYY-MM): ${month}`);
  const [y, mo] = m.split("-").map(Number);
  if (mo < 1 || mo > 12) throw new Error(`월 형식이 올바르지 않습니다(YYYY-MM): ${month}`);
  // Date(y, mo, 0) 은 mo 월의 말일. mo 는 1-based 이므로 그대로 넘긴다.
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d++) out.push(`${m}-${String(d).padStart(2, "0")}`);
  return out;
}
```

열거 읽기는 `Promise.all` 로 병렬화하되, **한 건이라도 권한 오류면 전체를 던진다**(조용한 부분 결과 금지):

```ts
export async function getBranchMonth(branchName: string, month: string): Promise<MasterDaily[]> {
  const ids = monthDates(month).map((d) => dailyRecordId(branchName, d));
  // Promise.all 은 첫 거부에서 즉시 던진다 — 부분 결과를 조용히 넘기지 않는다.
  const snaps = await Promise.all(ids.map((id) => getDocFromServer(tenantDoc("daily_settles", id))));
  const out: MasterDaily[] = [];
  for (const s of snaps) {
    if (!s.exists()) continue;
    const data = s.data() as any;
    if (!data?.master) throw new Error(`마감 기록이 손상되었습니다(${s.id}).`);
    out.push(toMaster(data.master));
  }
  return out;   // ids 가 날짜순이므로 결과도 날짜순
}
```

- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋**

```bash
git add src/api/dailyQueries.ts tests/api/dailyQueries.test.ts
git commit -F - <<'EOF'
feat(api): 막힌 쿼리를 문서ID 열거로 대체

or(where(...)) 쿼리 4개를 문서ID 열거로 바꿨다. 규칙이 업무 컬렉션의
list 를 전부 닫았기 때문이다(범위키가 문서ID 안에 있어 쿼리 안전성을
증명할 수 없다).

이력이 쌓인 지점에서는 읽기가 크게 줄어든다 — 2년치 이력 지점은 쿼리
1회가 730문서를 읽었고 월 열거는 31회다. 원본 주석에 기록된 무료 등급
하루 5만 읽기 소진 사고가 이 경우다.

다만 **모든 경우에 더 싸지는 않다.** 없는 문서를 읽어도 읽기 1회로 과금되므로,
그 달에 3일만 제출한 지점은 3회가 아니라 31회가 된다. 신규 지점이나 이력이
얇은 지점에서는 열거가 더 비싸다. 열거를 택한 이유는 평균 비용이 아니라
**규칙이 목록 조회를 닫았기 때문**이고, 비용 절감은 이력이 쌓인 지점에서
따라오는 부수 효과다.

전체 스캔 폴백과 인덱스 실패 폴백은 옮기지 않았다(설계서 §2.2).
Promise.all 이 첫 거부에서 던지므로 조용한 부분 결과가 생기지 않는다.
전일 현금은 7일 상한을 두고, 못 찾으면 previousCashUnknown 으로 알린다.
EOF
```

---

## Task 7: 직원명부·지점 목록·구성원 목록

**Files:**
- Create: `erp_saas/src/api/rosters.ts`
- Create: `erp_saas/src/api/directory.ts`
- Create: `erp_saas/tests/api/rosters.test.ts`
- Create: `erp_saas/tests/api/directory.test.ts`

**Interfaces:**
- Consumes: `tenantColl`·`tenantDoc`(T1), `branchScopeKey`(T2)
- Produces:
  - `rosters.ts`: `RosterEmployee` 타입, `getBranchOwnRoster(branchName)`, `getBranchOwnRosterFromServer(branchName)`, `saveBranchOwnRoster(branchName, employees)`, `removeFromBranchOwnRoster(branchName, employeeId)`, `addToBranchOwnRoster(branchName, employee)`, `mutateBranchOwnRoster(branchName, mutate)`
  - `directory.ts`: `getBranchList(): Promise<BranchInfo[]>`, `listMembers(): Promise<MemberInfo[]>`, `getMyMember(): Promise<MemberInfo>`

**포팅 원본:** `firebaseDirect.ts:439-553, 779-799`(명부), `:580-582`(지점 목록), `userProfile.ts`(구성원)

**바꾸는 것:**
1. `branch_own_rosters` 문서ID = `branchScopeKey(지점)` (원본은 `encodeURIComponent` — NFC 정규화가 없었다)
2. **전체 컬렉션 스캔 레거시 폴백 2개를 옮기지 않는다**(`:423, :434`). 문서가 없으면 빈 배열.
3. `staff_rosters` 는 **아예 옮기지 않는다** — 조사에서 React 앱이 읽지 않는 죽은 컬렉션으로 확인됐다(`RosterTab.tsx:88` 주석이 "재설계 전까지 병합하지 않는다"고 명시).
4. `getBranchList` 는 `public_branches` 의 `list` 를 쓴다 — **규칙이 허용하는 두 곳 중 하나**다. `isActive !== false` 필터 유지.
5. 구 `listUserProfiles`(`users` 전체 스캔)는 `tenants/{t}/members` 목록으로 대체한다 — **관리자만** 허용된다(규칙). 지점이 부르면 거부되어야 한다.
6. `movedOut` 전출 가드 맵과 `ROSTER_MOVED_OUT_GUARD_MS = 30일` 프루닝은 **그대로 유지**한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — 최소:

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | 명부 저장 → 읽기 왕복 | `employees` 일치 |
| 2 | 문서 없으면 빈 배열 (전체 스캔 폴백이 없음의 증명) | `[]`, 다른 지점 문서를 심어도 안 섞임 |
| 3 | 담당 아닌 지점 명부 읽기 | **거부** |
| 4 | `addToBranchOwnRoster` 가 전출 가드에 걸린 사람을 `rejected` 로 | `rejected` 에 포함, 명부 미변경 |
| 5 | 30일 지난 `movedOut` 항목이 쓰기 때 프루닝된다 | 맵에서 사라짐 |
| 6 | `mutateBranchOwnRoster` 가 `null` 반환 시 무변경 | `{changed:false}` |
| 7 | 동시 `addToBranchOwnRoster` 2건 | 둘 다 반영(트랜잭션 재시도) |
| 8 | `getBranchList` 가 비활성 지점을 뺀다 | 활성만 |
| 9 | 비구성원이 `getBranchList` | **거부** |
| 10 | 관리자가 `listMembers` | 전원 |
| 11 | **지점이 `listMembers`** | **거부** — 구 `users` 전체 스캔이 구조적으로 막혔음의 증명 |
| 12 | `getMyMember` 는 지점도 성공 | 본인 문서 |
| 13 | 명부 문서ID 가 NFD 지점명으로도 같은 문서를 가리킨다 | 같은 문서 |

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋**

```bash
git add src/api/rosters.ts src/api/directory.ts tests/api/rosters.test.ts tests/api/directory.test.ts
git commit -F - <<'EOF'
feat(api): 지점 직원명부 · 지점 목록 · 구성원 목록

전체 컬렉션 스캔 레거시 폴백 2개를 옮기지 않았다(설계서 §2.2). 문서가
없으면 빈 배열이고, 다른 지점 문서가 섞이지 않음을 테스트로 고정했다.

staff_rosters 컬렉션은 아예 옮기지 않았다 — 조사에서 React 앱이 읽지
않는 죽은 컬렉션으로 확인됐다.

구 users 전체 스캔(userProfile.listUserProfiles)은 members 목록으로
대체했다. 지점이 부르면 거부됨을 테스트로 고정 — 전 사용자 목록 노출
(보안감사 항목)이 구조적으로 막혔다.
EOF
```

---

## Task 8: fail-closed 스텁 · 공개 표면 · 잔존 쿼리 0 증명

**Files:**
- Create: `erp_saas/src/api/unavailable.ts`
- Create: `erp_saas/src/api/index.ts`
- Create: `erp_saas/tests/api/surface.test.ts`
- Create: `erp_saas/tests/api/integration.test.ts`

**Interfaces:**
- Consumes: 앞의 모든 태스크
- Produces: `src/api/index.ts` 의 공개 표면 — 화면 계획(계획 6)이 이것만 본다

**계획 7이 닫을 읽기 2개** (설계서 §2.5.3):

```ts
// src/api/unavailable.ts
const ROLLUP_PENDING =
  "이 화면은 아직 준비되지 않았습니다(집계 문서 도입 예정). 담당자에게 문의해 주세요.";

/**
 * 전 지점 전 기간 매출 집계. 문서ID 열거로는 14지점 × 수십 개월 × 31일이
 * 되어 불가능하다 — {지점}--sys--sales_{월} 롤업이 필요하다(설계서 §2.5.3).
 * 조용히 빈 배열이나 부분 결과를 주지 않는다.
 */
export async function getAllBranchesSalesSeries(): Promise<never> {
  throw new Error(ROLLUP_PENDING);
}

/**
 * 변경이력 전체 목록. edit_logs 문서ID 는 타임스탬프를 포함하므로 호출자가
 * 열거할 수 없다 — {지점}--sys--editlog_{월} 색인 문서가 필요하다.
 * (개별 변경이력 문서는 ID 를 알면 지금도 읽힌다.)
 */
export async function getEditLogs(): Promise<never> {
  throw new Error(ROLLUP_PENDING);
}
```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/api/surface.test.ts` — **잔존 쿼리 0 증명**이 핵심이다. 소스를 읽어서 검사한다:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const API_DIR = join(process.cwd(), "src", "api");
const files = readdirSync(API_DIR).filter((f) => f.endsWith(".ts"));

describe("데이터 계층에 규칙이 막는 조회가 남아 있지 않다", () => {
  it("파일이 하나 이상 있다 — 빈 디렉터리로 통과하는 것을 막는다", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files)("%s 에 query/where/orderBy/limit/documentId 가 없다", (f) => {
    const src = readFileSync(join(API_DIR, f), "utf8");
    // 주석을 지운 뒤 검사한다 — 설명에 단어가 등장하는 것은 허용
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const banned of ["where(", "orderBy(", "limitToLast(", "documentId(", "getCountFromServer", "collectionGroup(", "onSnapshot("]) {
      expect(code, `${f} 에 ${banned} 가 남아 있다`).not.toContain(banned);
    }
    // query( 는 허용된 list 두 곳에서도 쓰지 않는다(필터 없는 컬렉션 읽기만)
    expect(code, `${f} 에 query( 가 남아 있다`).not.toMatch(/\bquery\(/);
  });

  it("getDocs 는 허용된 두 컬렉션에서만 쓰인다", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = readFileSync(join(API_DIR, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (!/getDocs\(/.test(code)) continue;
      // public_branches 또는 members 를 읽는 파일만 허용
      if (!/tenantColl\("(public_branches|members)"\)/.test(code)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
```

`tests/api/integration.test.ts` — 한 지점의 한 달을 실제 파이프라인으로 통과시킨다:

| 단계 | 내용 |
|---|---|
| 1 | 회사·관리자·지점담당 seed → 컨텍스트 주입 |
| 2 | 지점담당이 3일치 정산 제출 |
| 3 | `getBranchMonth` 가 3건을 날짜순으로 준다 |
| 4 | `getDailyListForDate` 가 제출/미제출을 구분한다 |
| 5 | `saveSharedData` → `getSharedData` 왕복(`monthly_closings:{내지점}`) |
| 6 | 급여 키를 권한 없이 읽으면 거부, 부여 후 성공 |
| 7 | `updateDaily` 가 변경이력을 남기고, **다른 지점 담당자는 그 이력을 못 읽는다** |
| 8 | 관리자가 두 지점의 정산을 모두 읽는다 |
| 9 | `getAllBranchesSalesSeries`·`getEditLogs` 가 **던진다**(조용한 빈 결과 아님) |
| 10 | 컨텍스트를 지우면 모든 호출이 던진다 |

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — `unavailable.ts` + `index.ts`(재export만)
- [ ] **Step 4: 통과 확인**

```bash
cd erp_saas && npm run test:all
```
Expected: 규칙 117 + functions 139 + api 전건 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/api/unavailable.ts src/api/index.ts tests/api/surface.test.ts tests/api/integration.test.ts
git commit -F - <<'EOF'
feat(api): fail-closed 스텁 · 공개 표면 · 잔존 쿼리 0 증명

계획 7(롤업)이 닫을 읽기 2개를 조용한 빈 결과가 아니라 명시적 오류로
막았다 — 전 지점 전 기간 매출과 변경이력 전체 목록.

surface.test.ts 가 src/api 전체를 읽어 where/orderBy/documentId 등이
남아 있지 않음을 증명하고, getDocs 가 규칙이 허용하는 두 컬렉션
(public_branches, members)에서만 쓰이는지 확인한다. 파일 수 하한을 둬서
빈 디렉터리로 통과하는 것을 막았다.

integration.test.ts 가 한 지점의 한 달을 실제 파이프라인으로 통과시킨다.
EOF
```

---

## Self-Review

**1. 설계서 대조 (§2.5 확정 사항)**

| 설계서 요구 | 담당 태스크 |
|---|---|
| §2.5.1 지점 전체 이력 → 월 열거 | Task 6 (`getBranchMonth`) |
| §2.5.1 날짜별 전 지점 → 열거 | Task 6 (`getDailyListForDate`) |
| §2.5.1 `shared_data` 접두사 조회 → 지점 열거 | **Task 3·7 이 함께 제공.** 접두사 조회 자체를 없앴다 — `getAllManualOvertimes`/`getAllLaborContracts` 는 화면 계획에서 `getBranchList()` × `getSharedData(키:{지점})` 조합으로 만든다. 계층에는 접두사 조회 함수가 존재하지 않는다 |
| §2.5.1 `edit_logs` 전체 스캔 → 색인 | Task 8 (fail-closed, 계획 7이 닫음) |
| §2.5.1 로그인 지점 목록(인증 전) | **범위 밖** — 계획 8(인증). 이 계층은 `getBranchList` 를 구성원 전용으로만 제공 |
| §2.5.1 전체 스캔 폴백·죽은 코드 제거 | Task 5(GAS 미러)·6(폴백 2개)·7(레거시 스캔 2개·`staff_rosters`) |
| §2.2 경로에 회사ID | Task 1 (단일 통로) |
| §3.4 문서ID 규약 | Task 2 |
| §2.4 전 사용자 목록 노출 차단 | Task 7 (#11 테스트) |

**2. 자리표시자 검사** — `TBD`·"적절히"·"에러 처리 추가" 없음. Task 3·4·5·7 은 포팅 태스크라 원본 파일:줄을 지정하고 **바꿀 것·유지할 불변식·테스트 시나리오 표**를 명시했다. Task 1·2·6·8 은 신규 설계라 코드 전문을 넣었다.

**3. 타입·이름 일관성**
- `branchScopeKey` — T2 정의, T5·T7 사용. 서버 저장 파이프라인(assertValidBranchNames→encodeBranch)과 동일 결과. 서버 `encodeBranch` **단독과는 다르다**(T2 Step 5 가 양쪽을 실증)
- `toMaster`·`MasterDaily` — T5 정의, T6 사용
- `getBranchMonth` — T6 만 정의. 구 `getBranchHistory` 이름은 어디에도 남기지 않는다(월 필수화가 드러나야 한다)
- `tenantColl`/`tenantDoc` — T1 정의, T3~T8 전부 사용
- `sharedDocId`/`sharedBackupDocId` — T2 정의, T3·T4 사용

**4. 태스크 간 순서 의존** — T6 이 지점 목록을 필요로 하는데 `getBranchList` 는 T7 이다. **T6 은 지점 목록을 인자로 받게** 해서 순서 의존을 끊었다(`getDailyListForDate(날짜, 지점목록)`). 조합은 화면 계획이 한다.

**5. 알려진 미결 (구현 중 결정하지 말고 그대로 둘 것)**
- `loadClosingAnomalies`(`AdminPage.tsx:283`)가 월 없이 전체 이력을 읽는다. 화면이 실제로 어느 기간을 보여주는지는 화면 계획에서 확정한다. 이 계층은 `getBranchMonth(지점, 월)` 만 제공한다
- 등급 재배정(연차 등을 급여 축에 넣을지)은 **하지 않는다**(설계 결정 5). 사용자 승인이 필요한 별개 결정
- `gasClient` 조립 계층(근태 집계 등)은 화면 계획 소속

---

## 리뷰 이력

### 1차 — 자체 실측 (2026-08-18, 착수 전)

계획서를 쓴 직후 가장 의심스러운 두 곳을 직접 확인했다.

| 확인 | 결과 |
|---|---|
| `functions/src/lib/branchKey.ts` 를 클라 테스트에서 import 가능한가 | **불가.** 1행이 `firebase-functions/v2/https` 를 import 하고 그 패키지는 루트에서 해석되지 않는다(`functions/` 가 별도 npm 프로젝트). → Vitest `resolve.alias` 로 `HttpsError` 만 스텁하도록 Step 5 재작성 |
| 백업ID 4칸(`--slot{n}`)이 새 규칙에서 원본과 같게 판정되나 | **같다.** 범위·등급이 맨 앞 고정 위치라 접미사가 안 밀린다. 구 규칙의 `stripBackupSuffix` 는 옮기지 않는다(근거를 Task 2 에 기록) |
| `_all`·`_admin` 배정 키 **전부**의 쓰기 주체 | 11개 중 10개 관리자 확인. **`admin_settings` 의 heal 경로 1건 발견** → 미이관 결정 |

### 2차 — Codex (2026-08-18, 착수 전). 5건 중 3건 반영, 1건 중복, 1건 오탐

| # | 지적 | 판정 | 처리 |
|---|---|---|---|
| P0-1 | `admin_settings` 를 지점 화면이 쓴다 → `_all` 배정 위험 | **타당(1차와 중복)** | heal 경로 미이관(1차에서 이미 결정) + 저장 경로가 `isPasscodeVerified` 게이트 뒤임을 실측 확인 + **화면 계획에 역할 게이트 요구사항 명시**(PIN 폐기됨) |
| P0-2 | `annual_leave: "gen"` 이 앞 줄 `//` 주석에 먹혀 주석 처리된다 | **오탐** | `monthly_closings` 는 574행, `annual_leave` 는 **575행 별도 줄**이다. 코드 무변경 |
| P1-1 | 서버 `encodeBranch` 는 순수 `encodeURIComponent` 이고 정규화는 `assertValidBranchNames` 에 있다 → **대조 테스트가 통과 불가** | **타당, 가장 중요** | Global Constraints 의 잘못된 서술 정정. 클라 함수를 **`branchScopeKey`** 로 개명(동명이 차이를 감춘다). 대조를 `toBranchPair(assertValidBranchNames([n]))` = **실제 저장되는 값**과 하도록 재작성. **두 함수가 다름을 고정하는 테스트도 추가**(나중에 한쪽을 지우는 것 방지) |
| P1-2 | `getDailyFormBootstrap` 의 Produces 에 `previousCashUnknown` 이 빠져 있다 | **타당** | `DailyFormBootstrap` 인터페이스를 전문으로 명시 + 빼지 말라는 경고 |
| P2 | 열거가 읽기를 줄인다는 주장이 **희소한 달에는 틀리다** (없는 문서도 과금) | **타당** | 계획서·**설계서 §2.5.2 둘 다** 정정. "열거를 택한 이유는 비용이 아니라 규칙이 목록을 닫았기 때문"으로 근거 재정렬 |

**P1-1 은 이 프로젝트에서 13번째 "계획서가 통과 불가한 테스트를 지시한" 사례다.** 앞선 12건과 원인이 같다 — 전제를 실측하지 않고 테스트를 처방했다. 이번엔 착수 전에 잡혔다.


---

## 종료 시점 기록 (2026-08-18)

**결과:** 8/8 태스크 완료. 테스트 **256 → 420**(규칙 117 + api 164 + functions 139) + `npm run lint` 신설.
브랜치 `plan-5-data-access`, `c4284f6..966be36`. 전체 브랜치 리뷰 **P0 0건**.

### 계획서에 없었던 것 (이관 대상 조사에서 드러남)

- **`deleteEditLog` 누락** — 유예한 게 아니라 **아무도 못 봤다.** 프로덕션에 있고
  (`firebaseDirect.ts:249`) 실제 화면이 부르고(`AdminPage.tsx:3208`) **우리 규칙이 이미
  허용**(`firestore.rules:214`)하는데 계획·설계서 어디에도 없었다. 최종 수정에서 `getEditLog`
  와 함께 추가. **교훈: 규칙이 허용하는 연산 목록과 계층이 제공하는 함수 목록을 대조할 것.**
- **`settings` 컬렉션에 API 표면이 없다** — 규칙(`firestore.rules:195-201`)은 범위까지
  갖췄는데 이 계층은 아무것도 제공하지 않는다. `erp_ugd` 에서 이 컬렉션은 GAS 미러·PIN
  경로를 받치는데 **둘 다 제품이 버린 것**이므로 부재가 맞다. 다만 **결정이 아니라 침묵**
  이었으므로 여기 명시한다. 되살릴 일이 생기면 계획 6에서 판단.

### 계획 6 첫 작업으로 못 박은 것

ESLint `no-restricted-imports` 의 `patterns` 에 **`src/` → `tests/` 임포트 금지** 한 줄 추가.
`src/api/*.ts` 가 `tests/` 아래 헬퍼를 재수출하면 현재 두 게이트를 **모두** 통과한다
(최종 재리뷰가 실증). 지금은 소비자가 없어 이론적이지만, 계획 6이 소비자가 생기는 시점이다.
