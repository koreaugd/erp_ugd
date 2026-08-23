# 초대와 합류 구현 계획 (계획 3/N)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회사 관리자가 직원을 초대하고, 초대받은 사람이 합류해 **자기 담당 지점만** 쓸 수 있게 한다. 이 계획이 끝나면 "관리자가 아닌 지점 담당자"가 시스템에 처음 존재하게 된다.

**Architecture:** 계획 2까지 만들어진 사용자는 전부 회사 생성자, 즉 `role: 'admin'`이었다. 그래서 보안규칙의 지점 격리 판정이 **한 번도 실제로 쓰이지 않았다** — 관리자는 그 검사를 건너뛰기 때문이다. 이 계획이 만드는 사용자는 관리자가 아니므로, 지점 격리가 처음으로 진짜 방어선이 된다.

**Tech Stack:** Firebase Functions v2 (`onCall`) / TypeScript / Firebase Admin SDK / Firebase Emulator Suite / Vitest

**Spec:** `../specs/2026-08-17-multi-tenant-erp-design.md` — §3.2(데이터 구조) · §3.3(클라이언트 쓰기 금지) · §3.4(접근 판정) · §3.5(서버 함수) · §4.3~4.4(초대 경로와 초대장 설계)

---

## 이 계획의 범위

| 함수 | 이 계획 | 이유 |
|---|---|---|
| `createInvite` | ✅ | |
| `redeemInvite` | ✅ | |
| `listInvites` | ✅ | |
| `updateMember` / `setTenantStatus` / `createBranch` | 계획 4 | "이미 합류한 사람을 관리한다"는 별개 능력 |
| `authExchange` / `sendPhoneCode` / `verifyPhoneCode` | 계획 6 | 카카오·네이버 검수, 문자 업체 계약 필요 |

**시작 지점**: 브랜치 `plan-3-invites`, `plan-2-server-functions`(`c3d4836`)에서 분기.
계획 2가 아직 `main`에 병합되지 않았으므로 그 브랜치 위에 쌓는다.

---

## Global Constraints

- **불변식 1** — A사 계정으로 B사 데이터를 읽거나 쓸 수 없다
- **불변식 2** — 소속·권한·본인확인 상태는 **클라이언트가 쓸 수 없다.** 서버만 쓴다
- **불변식 3** — 정지된 회사(`status != 'active'`)는 **어떤 데이터도** 읽거나 쓸 수 없다
- **한 계정은 한 회사에만 속한다** — `redeemInvite`도 `createTenant`와 **똑같이** `users/{uid}` 부재를 트랜잭션으로 확인한다
- **초대장은 추측 불가능한 토큰**, **저장은 해시만**, **만료 필수**, **단일 사용은 트랜잭션으로**
- **초대 소비는 검증된 이메일을 요구한다** — 이메일+비밀번호 가입은 아무 주소나 적을 수 있다
- **`allowedBranches`(원문)와 `allowedBranchesEncoded`(인코딩본)는 항상 함께 쓴다** — 규칙은 인코딩본만 본다
- **예약어**: `_all`, `_admin`은 지점명으로 쓸 수 없다. 지점명에 `--`, 앞뒤 `-`도 쓸 수 없다
- `listInvites`는 **`tokenHash`를 반환하지 않는다**

---

## 계획 2 최종 리뷰가 이 계획에 넘긴 것

이 계획이 반드시 지켜야 할, 앞선 리뷰에서 도출된 항목들이다.

| # | 내용 |
|---|---|
| 1 | **`allowedBranchesEncoded`가 여기서 처음 진짜로 쓰인다.** 계획 2까지는 관리자 단락으로 규칙에 닿은 적이 없다 |
| 2 | **원문·인코딩본 변환 지점을 쪼개지 말 것.** 세 함수가 각자 `.map(encodeBranch)` 하면 어긋난다 |
| 3 | `redeemInvite`는 `createTenant`와 같은 트랜잭션 형태 + `tx.create` + `signup_verifications` 정리 |
| 4 | 초대 흐름은 **두 인물**(관리자·피초대자)이 필요한데 `callFn`은 전역 auth 하나를 쓴다 |
| 5 | 리전 문자열이 `index.ts`·`helpers.ts` 두 곳에 중복 (park됨 → 여기서 정리) |

---

## 사전 준비

**없다.** 계획 1~2의 환경 그대로. 클라우드 자원도 외부 계정도 필요 없다.

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
```

`java: command not found`는 **PATH 문제이지 미설치가 아니다.** 절대 다시 설치하지 말 것.

- `npm run test:rules` / `npm run test:functions` / `npm run test:all`
- 단일 파일: `npx firebase emulators:exec --only auth,firestore,functions --project demo-erp-saas "vitest run tests/functions/<파일>"`

---

## File Structure

| 파일 | 책임 |
|---|---|
| `functions/src/lib/region.ts` | 리전 상수 하나. `index.ts`와 테스트가 **같은 값을 import** |
| `functions/src/lib/branchKey.ts` | `toBranchPair` 추가 — 원문·인코딩본을 **쌍으로만** 만든다 |
| `functions/src/lib/inviteToken.ts` | 토큰 생성·해시. 대조도 여기서만 |
| `functions/src/lib/tenantAdmin.ts` | `requireTenantAdmin` — 관리자 판정. onCall 모듈이 아닌 lib 에 두어 함수 모듈끼리 import 하지 않게 한다 |
| `functions/src/createInvite.ts` | 초대 생성 |
| `functions/src/redeemInvite.ts` | 초대 소비 (트랜잭션) |
| `functions/src/listInvites.ts` | 관리자용 목록 (`tokenHash` 제외) |
| `tests/functions/ruledClient.ts` | 규칙이 적용되는 클라이언트. **인물별로 따로** 만들 수 있어야 한다 |
| `tests/functions/invites.test.ts` | 세 함수의 단위 검증 |
| `tests/functions/joining.test.ts` | 초대 → 합류 → 지점 격리 통합 검증 |

**`inviteToken.ts`를 따로 두는 이유**: 토큰을 만드는 곳과 대조하는 곳이 갈리면 해시 방식이 어긋난다. `branchKey.ts`와 같은 이유다.

---

## Task 1: 사전 정비 — 변환·리전·인물 분리

**목표**: 계획 2의 리뷰가 남긴 구조적 부채를 먼저 갚는다. 초대 함수 세 개가 이 위에 올라가므로 순서가 중요하다.

**Files:**
- Create: `functions/src/lib/region.ts`, `tests/functions/ruledClient.ts`
- Modify: `functions/src/lib/branchKey.ts`, `functions/src/index.ts`, `functions/src/createTenant.ts`, `tests/functions/helpers.ts`, `tests/functions/integration.test.ts`

**Interfaces:**
- Produces:
  - `functions/src/lib/region.ts`: `export const FUNCTIONS_REGION = "asia-northeast3";`
  - `functions/src/lib/branchKey.ts`: `toBranchPair(names: string[]): { allowedBranches: string[]; allowedBranchesEncoded: string[] }` — 검증된 이름 목록을 받아 **쌍으로** 반환. 둘을 따로 만들 방법을 남기지 않는다
  - `tests/functions/ruledClient.ts`: `ruledClientFor(uid: string): Promise<Firestore>` — 그 사람으로 로그인된, **규칙이 적용되는** Firestore. 인물마다 별도 앱을 쓰므로 두 인물을 동시에 다룰 수 있다. `teardownRuledClients(): Promise<void>`

- [ ] **Step 1: 리전 상수 분리**

Create `functions/src/lib/region.ts`:

```typescript
/**
 * Functions 리전. 실제 Firebase 프로젝트를 만들 때 **Firestore 위치와 반드시 일치**해야 한다.
 * 어긋나면 호출마다 리전 간 왕복 지연과 이그레스 비용이 붙는다.
 *
 * 이 값을 상수로 뽑는 이유: 서버(index.ts)와 테스트 클라이언트가 같은 리전을 써야 하는데,
 * 문자열을 양쪽에 따로 적어두면 한쪽만 고쳤을 때 함수가 "없는 함수"로 보인다(not-found).
 * import 로 묶어두면 그 실수가 컴파일 시점에 드러난다.
 */
export const FUNCTIONS_REGION = "asia-northeast3";
```

`functions/src/index.ts`에서 리터럴을 이 상수로 교체한다:

```typescript
import { FUNCTIONS_REGION } from "./lib/region";
...
setGlobalOptions({ region: FUNCTIONS_REGION, maxInstances: 10 });
```

`tests/functions/helpers.ts`의 `REGION` 상수도 이 파일을 import 하도록 바꾼다. (테스트는 이미 `functions/src/lib/*`를 import 하고 있으므로 경로 문제는 없다.)

- [ ] **Step 2: 변환 쌍 헬퍼 추가**

`functions/src/lib/branchKey.ts`에 추가한다. **기존 `encodeBranch`·`assertValidBranchNames`는 그대로 둔다.**

```typescript
/** 원문과 인코딩본을 쌍으로만 만든다. 둘이 어긋날 수 없게 하는 것이 이 함수의 존재 이유다. */
export interface BranchPair {
  allowedBranches: string[];
  allowedBranchesEncoded: string[];
}

/**
 * 검증을 마친 지점명 목록을 규칙이 읽는 형태로 바꾼다.
 *
 * 왜 쌍으로 반환하는가: 규칙은 인코딩본만 본다(설계서 §3.4). 원문과 인코딩본을 각자 다른
 * 곳에서 만들면 어긋날 수 있고, 어긋나도 오류가 나지 않는다 — 규칙이 `.get(field, [])` 로
 * 읽어 **빈 목록**이 되기 때문이다. 화면에는 담당 지점이 보이는데 데이터는 안 열린다.
 *
 * 그래서 `createInvite`·`redeemInvite`·`updateMember` 는 각자 map 을 돌리지 않고
 * 반드시 이 함수를 통과시킨다.
 */
export function toBranchPair(names: string[]): BranchPair {
  return {
    allowedBranches: names,
    allowedBranchesEncoded: names.map(encodeBranch),
  };
}
```

`functions/src/createTenant.ts`가 지금 `branchNames`와 `encoded`를 각각 쓰는 부분을 `toBranchPair`로 바꾼다. 동작은 같아야 하고, 계획 2의 테스트가 그대로 통과해야 한다.

- [ ] **Step 3: 인물별 규칙 클라이언트 분리**

Create `tests/functions/ruledClient.ts`:

```typescript
import { initializeApp, getApps, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { getApps as getAdminApps, initializeApp as initAdmin } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

const PROJECT_ID = 'demo-erp-saas';

/**
 * 인물마다 **별도의 Firebase 앱**을 만든다.
 *
 * helpers.ts 의 callFn 은 프로세스 전역 auth 하나를 쓰기 때문에, 서로 다른 uid 를
 * 동시에 다룰 수 없다. 초대 흐름은 관리자와 피초대자 두 인물이 필요하므로
 * 그 방식으로는 검증할 수 없다.
 */
const clients = new Map<string, FirebaseApp>();

/** 그 사람으로 로그인된, 규칙이 적용되는 Firestore. 같은 uid 로 다시 부르면 같은 앱을 준다. */
export async function ruledClientFor(uid: string): Promise<Firestore> {
  if (getAdminApps().length === 0) initAdmin({ projectId: PROJECT_ID });

  const name = `ruled-${uid}`;
  let app = clients.get(name);
  if (!app) {
    app = initializeApp({ projectId: PROJECT_ID, apiKey: 'fake-api-key-for-emulator' }, name);
    connectAuthEmulator(getAuth(app), 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(getFirestore(app), '127.0.0.1', 8080);
    clients.set(name, app);
  }

  const token = await getAdminAuth().createCustomToken(uid);
  await signInWithCustomToken(getAuth(app), token);
  return getFirestore(app);
}

/** 만든 앱을 전부 정리한다. afterAll 에서 부른다. */
export async function teardownRuledClients(): Promise<void> {
  for (const app of clients.values()) {
    if (getApps().includes(app)) await deleteApp(app);
  }
  clients.clear();
}
```

`tests/functions/integration.test.ts`의 로컬 `ruledClient()`/`signInAs()`를 이 모듈로 교체한다. 기존 테스트는 전부 그대로 통과해야 한다.

- [ ] **Step 4: 전체 실행 — 무회귀 확인**

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
npm run test:all
```

Expected: 160 passed (규칙 121 + functions 39). **이 Task 는 기능을 더하지 않는다 — 숫자가 늘면 뭔가 잘못한 것이다.**

- [ ] **Step 5: 커밋**

```bash
git add functions/src tests/functions
git commit -F - <<'EOF'
refactor: 초대 기능 전 사전 정비 — 리전 상수·변환 쌍·인물별 클라이언트

계획 2 최종 리뷰가 남긴 구조 부채 셋을 초대 함수보다 먼저 갚는다.

- 리전 문자열이 서버·테스트 두 곳에 중복돼 한쪽만 고치면 not-found 가 났다
- 원문/인코딩본을 각자 만들면 어긋나도 오류가 안 난다(규칙이 빈 목록으로 읽음).
  쌍으로만 만드는 통로를 두어 갈라질 수 없게 한다
- 초대는 관리자와 피초대자 두 인물이 필요한데 기존 하네스는 전역 auth 하나를 쓴다

기능 변화 없음. 테스트 160개 그대로.
EOF
```

---

## Task 2: `createInvite` + `listInvites`

**목표**: 회사 관리자가 초대를 만들고 목록을 본다. 토큰 원문은 **한 번만** 반환되고, 저장은 해시만 한다.

**Files:**
- Create: `functions/src/lib/inviteToken.ts`, `functions/src/createInvite.ts`, `functions/src/listInvites.ts`
- Create: `tests/functions/invites.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `requireAuth`·`db`(계획 2), `assertValidBranchNames`·`toBranchPair`(Task 1)
- Produces:
  - `inviteToken.ts`: `newInviteToken(): string`, `hashInviteToken(token: string): string`
  - `createInvite({ email, role, branchNames })` → `{ inviteId: string, token: string }` — **token 은 이때만 반환된다**
  - `listInvites({})` → `{ invites: Array<{ inviteId, email, role, allowedBranches, createdAt, expiresAt, consumedAt|null }> }`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/functions/invites.test.ts`:

```typescript
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { callFn, seed, clearAll, teardown, adminDb } from './helpers';

const OWNER = 'owner';
const OTHER = 'outsider';

/** 회사 하나와 그 관리자를 만든다. 전화 본인확인은 서버가 요구하므로 미리 심는다. */
async function makeCompany(uid = OWNER, branches = ['가게', '나가게']) {
  await seed(async (db) => {
    await db.doc(`signup_verifications/${uid}`).set({
      phone: '01012345678',
      phoneVerifiedAt: new Date().toISOString(),
    });
  });
  return await callFn<{ tenantId: string }>(
    'createTenant', { companyName: '초대사', branchNames: branches }, uid,
  );
}

describe('createInvite / listInvites', () => {
  beforeEach(async () => {
    await clearAll();
  });

  afterAll(async () => {
    await teardown();
  });

  it('로그인하지 않으면 거부된다', async () => {
    await expect(callFn('createInvite', { email: 'a@a.com', role: 'branch', branchNames: ['가게'] }))
      .rejects.toMatchObject({ code: 'functions/unauthenticated' });
  });

  it('회사에 속하지 않은 사람은 초대를 만들 수 없다', async () => {
    await makeCompany();
    await expect(
      callFn('createInvite', { email: 'a@a.com', role: 'branch', branchNames: ['가게'] }, OTHER),
    ).rejects.toMatchObject({ code: 'functions/permission-denied' });
  });

  it('관리자가 아니면 초대를 만들 수 없다', async () => {
    const { tenantId } = await makeCompany();
    await seed(async (db) => {
      await db.doc(`tenants/${tenantId}/members/${OWNER}`).update({ role: 'branch' });
    });
    await expect(
      callFn('createInvite', { email: 'a@a.com', role: 'branch', branchNames: ['가게'] }, OWNER),
    ).rejects.toMatchObject({ code: 'functions/permission-denied' });
  });

  it('관리자는 초대를 만들 수 있고, 토큰은 이때만 반환된다', async () => {
    const { tenantId } = await makeCompany();
    const r = await callFn<{ inviteId: string; token: string }>(
      'createInvite', { email: 'A@Example.com', role: 'branch', branchNames: ['가게'] }, OWNER,
    );
    expect(r.inviteId).toMatch(/^[0-9a-f]{32}$/);
    expect(r.token).toMatch(/^[0-9a-f]{64}$/);

    const doc = await adminDb().doc(`tenants/${tenantId}/invites/${r.inviteId}`).get();
    // 저장은 해시만. 원문 토큰이 저장돼 있으면 문서를 읽을 수 있는 사람이 초대를 가로챈다.
    expect(doc.get('tokenHash')).toBeTruthy();
    expect(JSON.stringify(doc.data())).not.toContain(r.token);
    // 이메일은 소문자로 정규화해 저장한다 — 대소문자만 다른 주소로 우회할 수 없게
    expect(doc.get('emailLower')).toBe('a@example.com');
    expect(doc.get('consumedAt')).toBeNull();
  });

  it('초대에 원문·인코딩본 지점 목록이 함께 기록된다', async () => {
    const { tenantId } = await makeCompany();
    const r = await callFn<{ inviteId: string }>(
      'createInvite', { email: 'a@a.com', role: 'branch', branchNames: ['가게'] }, OWNER,
    );
    const doc = await adminDb().doc(`tenants/${tenantId}/invites/${r.inviteId}`).get();
    expect(doc.get('allowedBranches')).toEqual(['가게']);
    expect(doc.get('allowedBranchesEncoded')).toEqual([encodeURIComponent('가게')]);
  });

  it('만료 시각이 기록된다', async () => {
    const { tenantId } = await makeCompany();
    const r = await callFn<{ inviteId: string }>(
      'createInvite', { email: 'a@a.com', role: 'branch', branchNames: ['가게'] }, OWNER,
    );
    const doc = await adminDb().doc(`tenants/${tenantId}/invites/${r.inviteId}`).get();
    const expiresAt = new Date(doc.get('expiresAt') as string).getTime();
    const createdAt = new Date(doc.get('createdAt') as string).getTime();
    expect(expiresAt).toBeGreaterThan(createdAt);
  });

  it.each([
    ['이메일 없음', { email: '', role: 'branch', branchNames: ['가게'] }],
    ['이메일 형식 아님', { email: 'not-an-email', role: 'branch', branchNames: ['가게'] }],
    ['역할이 admin/branch 아님', { email: 'a@a.com', role: 'superuser', branchNames: ['가게'] }],
    ['지점 없음', { email: 'a@a.com', role: 'branch', branchNames: [] }],
    ['회사에 없는 지점', { email: 'a@a.com', role: 'branch', branchNames: ['없는지점'] }],
    ['지점명에 --', { email: 'a@a.com', role: 'branch', branchNames: ['강남--본점'] }],
    ['지점명이 _all', { email: 'a@a.com', role: 'branch', branchNames: ['_all'] }],
    ['지점명이 _admin', { email: 'a@a.com', role: 'branch', branchNames: ['_admin'] }],
    ['지점명이 - 로 끝남', { email: 'a@a.com', role: 'branch', branchNames: ['강남-'] }],
  ])('입력 검증: %s → 거부', async (_label, payload) => {
    await makeCompany();
    await expect(callFn('createInvite', payload, OWNER))
      .rejects.toMatchObject({ code: 'functions/invalid-argument' });
  });

  it('listInvites 는 tokenHash 를 반환하지 않는다', async () => {
    await makeCompany();
    await callFn('createInvite', { email: 'a@a.com', role: 'branch', branchNames: ['가게'] }, OWNER);

    const r = await callFn<{ invites: Array<Record<string, unknown>> }>('listInvites', {}, OWNER);
    expect(r.invites).toHaveLength(1);
    expect(JSON.stringify(r.invites)).not.toContain('tokenHash');
    expect(r.invites[0]).toMatchObject({ email: 'a@a.com', role: 'branch' });
  });

  it('관리자가 아니면 초대 목록을 볼 수 없다', async () => {
    const { tenantId } = await makeCompany();
    await seed(async (db) => {
      await db.doc(`tenants/${tenantId}/members/${OWNER}`).update({ role: 'branch' });
    });
    await expect(callFn('listInvites', {}, OWNER))
      .rejects.toMatchObject({ code: 'functions/permission-denied' });
  });
});
```

**`회사에 없는 지점` 케이스가 중요하다.** 초대에 회사에 존재하지 않는 지점을 넣을 수 있으면, 그 사람의 `allowedBranchesEncoded`에 아무 범위키나 넣을 수 있게 된다 — 다른 회사의 지점명과 같은 이름을 쓰면 곤란하다(회사 경계는 `inTenant`가 막지만, 회사 안에서 존재하지 않는 지점의 데이터를 미리 선점할 수 있다).

- [ ] **Step 2: 실행 — 실패 확인**

```bash
npm run test:functions
```

Expected: `createInvite`/`listInvites` 전부 FAIL (`functions/not-found`).

- [ ] **Step 3: 관리자 판정 lib 작성**

Create `functions/src/lib/tenantAdmin.ts` — **onCall 모듈이 아닌 lib 에 둔다.** `listInvites`가 `createInvite.ts`에서 import 하면 onCall export 가 붙은 모듈을 다른 함수 모듈이 로드하는 구조가 되는데, 이 코드베이스의 패턴은 함수 모듈은 lib 만 import 하는 것이다.

```typescript
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./context";

/** 이 회사의 활성 관리자인지 확인하고 tenantId 를 돌려준다. 아니면 던진다. */
export async function requireTenantAdmin(uid: string): Promise<string> {
  const firestore = db();
  const userSnap = await firestore.doc(`users/${uid}`).get();
  const tenantId = userSnap.exists ? (userSnap.get("tenantId") as string | undefined) : undefined;
  if (!tenantId) {
    throw new HttpsError("permission-denied", "회사에 속해 있지 않습니다.");
  }

  const [tenantSnap, memberSnap] = await Promise.all([
    firestore.doc(`tenants/${tenantId}`).get(),
    firestore.doc(`tenants/${tenantId}/members/${uid}`).get(),
  ]);
  if (!tenantSnap.exists || tenantSnap.get("status") !== "active") {
    throw new HttpsError("permission-denied", "정지된 회사입니다.");
  }
  if (!memberSnap.exists || memberSnap.get("status") !== "active") {
    throw new HttpsError("permission-denied", "정지된 계정입니다.");
  }
  if (memberSnap.get("role") !== "admin") {
    throw new HttpsError("permission-denied", "관리자만 할 수 있습니다.");
  }
  return tenantId;
}
```

- [ ] **Step 3b: 토큰 도구 작성**

Create `functions/src/lib/inviteToken.ts`:

```typescript
import { randomBytes, createHash } from "node:crypto";

/**
 * 초대 토큰. 추측 불가능해야 한다 — 추측되면 남의 초대를 가로채 그 회사에 들어간다.
 * 32바이트(=64 hex)면 무차별 대입이 불가능하다.
 */
export function newInviteToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * 저장·대조용 해시.
 *
 * 원문을 저장하지 않는 이유: 초대 문서를 읽을 수 있는 경로가 생기면(백업 유출, 권한 실수)
 * 그 순간 모든 미사용 초대가 사용 가능해진다. 해시만 있으면 문서를 봐도 쓸 수 없다.
 *
 * 솔트를 쓰지 않는 이유: 토큰이 32바이트 난수라 사전 공격 대상이 아니다.
 * 비밀번호와 달리 사람이 고른 값이 아니므로 레인보우 테이블이 성립하지 않는다.
 *
 * 만들기와 대조를 같은 파일에 두는 이유: 해시 방식이 갈리면 정상 토큰이 거부된다.
 */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

- [ ] **Step 4: `createInvite` 구현**

Create `functions/src/createInvite.ts`:

```typescript
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomBytes } from "node:crypto";
import { requireAuth, db } from "./lib/context";
import { requireTenantAdmin } from "./lib/tenantAdmin";
import { assertValidBranchNames, toBranchPair, encodeBranch } from "./lib/branchKey";
import { newInviteToken, hashInviteToken } from "./lib/inviteToken";

const INVITE_TTL_DAYS = 7;
const MAX_EMAIL_LENGTH = 254;

/**
 * 초대를 만든다. 관리자만 할 수 있다.
 *
 * 토큰 원문은 이 응답에서만 나온다. 저장은 해시뿐이라 나중에 다시 볼 수 없다 —
 * 잃어버리면 초대를 새로 만들어야 한다. 그것이 의도다.
 */
export const createInvite = onCall(async (request) => {
  const caller = requireAuth(request);
  const tenantId = await requireTenantAdmin(caller.uid);
  const firestore = db();

  const payload = (request.data ?? {}) as {
    email?: unknown; role?: unknown; branchNames?: unknown;
  };

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  // 이메일 형식은 엄밀히 검사하지 않는다 — RFC 를 정확히 따르는 정규식은 실용적이지 않고,
  // 진짜 검증은 "그 주소로 로그인한 사람만 소비할 수 있다"(redeemInvite)가 한다.
  // 여기서는 명백한 오입력만 거른다.
  if (email === "" || email.length > MAX_EMAIL_LENGTH || !email.includes("@") || email.includes(" ")) {
    throw new HttpsError("invalid-argument", "올바른 이메일 주소를 입력해야 합니다.");
  }

  const role = payload.role;
  if (role !== "admin" && role !== "branch") {
    throw new HttpsError("invalid-argument", "역할은 admin 또는 branch 여야 합니다.");
  }

  const branchNames = assertValidBranchNames(payload.branchNames);

  // 회사에 실제로 있는 지점만 초대할 수 있다.
  // 없는 지점을 넣을 수 있으면 아직 만들지 않은 범위키를 미리 선점할 수 있다.
  const existing = await firestore.collection(`tenants/${tenantId}/public_branches`).get();
  const known = new Set(existing.docs.map((d) => d.id));
  for (const name of branchNames) {
    if (!known.has(encodeBranch(name))) {
      throw new HttpsError("invalid-argument", `회사에 없는 지점입니다: ${name}`);
    }
  }

  const token = newInviteToken();
  const inviteId = randomBytes(16).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  await firestore.doc(`tenants/${tenantId}/invites/${inviteId}`).create({
    emailLower: email,
    tokenHash: hashInviteToken(token),
    role,
    ...toBranchPair(branchNames),
    invitedBy: caller.uid,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    consumedAt: null,
    consumedBy: null,
  });

  return { inviteId, token };
});
```

- [ ] **Step 5: `listInvites` 구현**

Create `functions/src/listInvites.ts`:

```typescript
import { onCall } from "firebase-functions/v2/https";
import { requireAuth, db } from "./lib/context";
import { requireTenantAdmin } from "./lib/tenantAdmin";

/**
 * 관리자용 초대 목록.
 *
 * `tokenHash` 를 반환하지 않는다. 해시만으로 토큰을 되돌릴 수는 없지만,
 * 화면에 흘러나올 이유가 전혀 없는 값이다. 안 주는 편이 실수할 여지가 없다.
 */
export const listInvites = onCall(async (request) => {
  const caller = requireAuth(request);
  const tenantId = await requireTenantAdmin(caller.uid);

  const snap = await db().collection(`tenants/${tenantId}/invites`).get();
  const invites = snap.docs.map((d) => ({
    inviteId: d.id,
    email: d.get("emailLower") as string,
    role: d.get("role") as string,
    allowedBranches: (d.get("allowedBranches") as string[]) ?? [],
    createdAt: d.get("createdAt") as string,
    expiresAt: d.get("expiresAt") as string,
    consumedAt: (d.get("consumedAt") as string | null) ?? null,
  }));

  return { invites };
});
```

(`requireTenantAdmin` 은 Step 3 에서 만든 `lib/tenantAdmin.ts` 의 것을 쓴다.)

- [ ] **Step 6: 함수 등록**

`functions/src/index.ts` 끝에 추가:

```typescript
export { createInvite } from "./createInvite";
export { listInvites } from "./listInvites";
```

- [ ] **Step 7: 실행 — 통과 확인 및 커밋**

```bash
npm run test:all
```

Expected: 전부 PASS.

```bash
git add functions/src tests/functions
git commit -F - <<'EOF'
feat: createInvite / listInvites — 초대 생성과 목록

토큰 원문은 생성 응답에서만 나오고 저장은 해시만 한다. 초대 문서를 읽을 수
있는 경로가 생겨도 그것만으로는 초대를 쓸 수 없다.

회사에 실제로 있는 지점만 초대할 수 있다 — 없는 지점을 넣을 수 있으면
아직 만들지 않은 범위키를 미리 선점할 수 있다.
EOF
```

---

## Task 3: `redeemInvite`

**목표**: 초대받은 사람이 합류한다. 이 계획에서 가장 위험한 함수다 — 잘못 만들면 남의 초대를 가로채거나, 한 초대로 여러 명이 들어온다.

**Files:**
- Create: `functions/src/redeemInvite.ts`
- Modify: `functions/src/index.ts`, `tests/functions/invites.test.ts`

**Interfaces:**
- Consumes: `requireAuth`·`db`, `hashInviteToken`, `SIGNUP_VERIFICATIONS_COLLECTION`
- Produces: `redeemInvite({ tenantId, inviteId, token })` → `{ tenantId: string }`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/functions/invites.test.ts`에 새 `describe` 블록을 추가한다:

```typescript
describe('redeemInvite', () => {
  const INVITEE = 'invitee';
  const INVITEE_EMAIL = 'invitee@example.com';

  beforeEach(async () => {
    await clearAll();
  });

  /** 회사와 초대를 준비하고 소비에 필요한 값을 돌려준다. */
  async function prepareInvite(email = INVITEE_EMAIL, branches = ['가게']) {
    const { tenantId } = await makeCompany();
    const inv = await callFn<{ inviteId: string; token: string }>(
      'createInvite', { email, role: 'branch', branchNames: branches }, OWNER,
    );
    return { tenantId, ...inv };
  }

  const verified = { email: INVITEE_EMAIL, email_verified: true };

  it('검증된 이메일로 초대를 소비하면 합류한다', async () => {
    const { tenantId, inviteId, token } = await prepareInvite();

    const r = await callFn<{ tenantId: string }>(
      'redeemInvite', { tenantId, inviteId, token }, INVITEE, verified,
    );
    expect(r.tenantId).toBe(tenantId);

    const db = adminDb();
    expect((await db.doc(`users/${INVITEE}`).get()).get('tenantId')).toBe(tenantId);

    const member = await db.doc(`tenants/${tenantId}/members/${INVITEE}`).get();
    expect(member.get('role')).toBe('branch');
    expect(member.get('status')).toBe('active');
    expect(member.get('allowedBranches')).toEqual(['가게']);
    expect(member.get('allowedBranchesEncoded')).toEqual([encodeURIComponent('가게')]);
    // 급여 권한은 초대에 없다 — 별도 부여여야 한다(설계서 §3.4 급여는 별개 축)
    expect(member.get('salaryBranchesEncoded')).toEqual([]);

    const invite = await db.doc(`tenants/${tenantId}/invites/${inviteId}`).get();
    expect(invite.get('consumedBy')).toBe(INVITEE);
    expect(invite.get('consumedAt')).toBeTruthy();
  });

  it('이메일이 검증되지 않았으면 거부된다', async () => {
    const { tenantId, inviteId, token } = await prepareInvite();
    await expect(
      callFn('redeemInvite', { tenantId, inviteId, token }, INVITEE,
        { email: INVITEE_EMAIL, email_verified: false }),
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
  });

  it('다른 사람의 초대는 소비할 수 없다', async () => {
    const { tenantId, inviteId, token } = await prepareInvite('someone-else@example.com');
    await expect(
      callFn('redeemInvite', { tenantId, inviteId, token }, INVITEE, verified),
    ).rejects.toMatchObject({ code: 'functions/permission-denied' });
  });

  it('토큰이 틀리면 거부된다', async () => {
    const { tenantId, inviteId } = await prepareInvite();
    await expect(
      callFn('redeemInvite', { tenantId, inviteId, token: 'f'.repeat(64) }, INVITEE, verified),
    ).rejects.toMatchObject({ code: 'functions/permission-denied' });
  });

  it('만료된 초대는 거부된다', async () => {
    const { tenantId, inviteId, token } = await prepareInvite();
    await seed(async (db) => {
      await db.doc(`tenants/${tenantId}/invites/${inviteId}`)
        .update({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    });
    await expect(
      callFn('redeemInvite', { tenantId, inviteId, token }, INVITEE, verified),
    ).rejects.toMatchObject({ code: 'functions/deadline-exceeded' });
  });

  it('소비된 초대는 재사용할 수 없다 — 구성원 제거 후 재소비 시나리오', async () => {
    // ⚠ "다른 사람이 소비된 초대를 다시 쓴다"는 테스트를 만들지 말 것:
    // Firebase Auth 는 이메일 중복을 막으므로(1 이메일 = 1 계정), 초대 이메일을 가진
    // 두 번째 계정을 하네스에서 만들 수 없다(auth/email-already-exists 로 하네스가 죽는다).
    // 현실의 재사용 위협은 "합류했던 본인이 회사에서 제거된 뒤 옛 초대로 다시 들어오는 것"이다.
    const { tenantId, inviteId, token } = await prepareInvite();
    await callFn('redeemInvite', { tenantId, inviteId, token }, INVITEE, verified);

    // 계획 4의 구성원 제거를 흉내낸다: users/{uid} 와 members 문서 삭제
    await seed(async (db) => {
      await db.doc(`users/${INVITEE}`).delete();
      await db.doc(`tenants/${tenantId}/members/${INVITEE}`).delete();
    });

    // consumedAt 확인이 없으면 여기서 다시 들어와진다
    await expect(
      callFn('redeemInvite', { tenantId, inviteId, token }, INVITEE, verified),
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
  });

  it('같은 초대를 동시에 10번 눌러도 한 번만 소비된다', async () => {
    const { tenantId, inviteId, token } = await prepareInvite();

    // 같은 uid 동시 호출이다(위 주석과 같은 이유로 서로 다른 계정은 만들 수 없다).
    // 같은 uid 경쟁에서는 users/{uid} tx.create 충돌만으로도 성공이 1건이 되므로,
    // 성공 개수만 보면 consumedAt 트랜잭션이 없어도 초록이 된다.
    // 그래서 **초대 문서 쪽**을 함께 고정한다: consumedAt/consumedBy 가 정확히 기록됐는지.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        callFn('redeemInvite', { tenantId, inviteId, token }, INVITEE, verified)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const members = await adminDb().collection(`tenants/${tenantId}/members`).get();
    expect(members.size).toBe(2); // 관리자 1 + 합류자 1

    const invite = await adminDb().doc(`tenants/${tenantId}/invites/${inviteId}`).get();
    expect(invite.get('consumedAt')).toBeTruthy();
    expect(invite.get('consumedBy')).toBe(INVITEE);
  });

  it('이미 다른 회사에 속한 사람은 소비할 수 없다', async () => {
    const { tenantId, inviteId, token } = await prepareInvite();
    await seed(async (db) => {
      await db.doc(`users/${INVITEE}`).set({ tenantId: 'somewhere-else', createdAt: 'x' });
    });
    await expect(
      callFn('redeemInvite', { tenantId, inviteId, token }, INVITEE, verified),
    ).rejects.toMatchObject({ code: 'functions/already-exists' });
  });

  it('정지된 회사의 초대는 소비할 수 없다', async () => {
    const { tenantId, inviteId, token } = await prepareInvite();
    await seed(async (db) => {
      await db.doc(`tenants/${tenantId}`).update({ status: 'suspended' });
    });
    await expect(
      callFn('redeemInvite', { tenantId, inviteId, token }, INVITEE, verified),
    ).rejects.toMatchObject({ code: 'functions/permission-denied' });
  });

  it('합류하면 signup_verifications 문서가 정리된다', async () => {
    const { tenantId, inviteId, token } = await prepareInvite();
    await seed(async (db) => {
      await db.doc(`signup_verifications/${INVITEE}`).set({
        phone: '01099998888', phoneVerifiedAt: new Date().toISOString(),
      });
    });

    await callFn('redeemInvite', { tenantId, inviteId, token }, INVITEE, verified);

    expect((await adminDb().doc(`signup_verifications/${INVITEE}`).get()).exists).toBe(false);
    // 번호는 members 로 옮겨진다
    const member = await adminDb().doc(`tenants/${tenantId}/members/${INVITEE}`).get();
    expect(member.get('phone')).toBe('01099998888');
  });
});
```

`import` 줄에 `encodeURIComponent` 는 전역이므로 추가 import 가 필요 없다.

- [ ] **Step 2: 실행 — 실패 확인**

```bash
npx firebase emulators:exec --only auth,firestore,functions --project demo-erp-saas "vitest run tests/functions/invites.test.ts"
```

Expected: `redeemInvite` 블록 전부 FAIL.

- [ ] **Step 3: 구현**

Create `functions/src/redeemInvite.ts`:

```typescript
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireAuth, db } from "./lib/context";
import { hashInviteToken } from "./lib/inviteToken";
import {
  SIGNUP_VERIFICATIONS_COLLECTION,
  PHONE_FIELD,
  PHONE_VERIFIED_AT_FIELD,
} from "./lib/signupVerification";

/**
 * 초대를 소비해 회사에 합류한다.
 *
 * 트랜잭션인 이유(설계서 §4.4): 초대는 **한 번만** 쓸 수 있어야 한다. 소비 여부 확인과
 * 소비 표시가 한 트랜잭션 안에 있지 않으면, 같은 초대로 여러 명이 들어온다.
 *
 * 이메일 검증을 요구하는 이유(설계서 §4.4): 이메일+비밀번호 가입은 아무 주소나 적을 수 있다.
 * 검증을 요구하지 않으면 공격자가 `cfo@피해회사.com` 으로 계정을 만들어 그 사람에게 간
 * 초대를 대신 삼킬 수 있다.
 */
export const redeemInvite = onCall(async (request) => {
  const caller = requireAuth(request);
  const firestore = db();

  const payload = (request.data ?? {}) as {
    tenantId?: unknown; inviteId?: unknown; token?: unknown;
  };
  const tenantId = typeof payload.tenantId === "string" ? payload.tenantId : "";
  const inviteId = typeof payload.inviteId === "string" ? payload.inviteId : "";
  const token = typeof payload.token === "string" ? payload.token : "";
  if (tenantId === "" || inviteId === "" || token === "") {
    throw new HttpsError("invalid-argument", "초대 정보가 올바르지 않습니다.");
  }

  if (!caller.emailVerified || !caller.email) {
    throw new HttpsError(
      "failed-precondition",
      "이메일 인증을 마친 계정만 초대를 받을 수 있습니다.",
    );
  }
  const callerEmail = caller.email.trim().toLowerCase();

  const userRef = firestore.doc(`users/${caller.uid}`);
  const tenantRef = firestore.doc(`tenants/${tenantId}`);
  const inviteRef = firestore.doc(`tenants/${tenantId}/invites/${inviteId}`);
  const verifyRef = firestore.doc(
    `${SIGNUP_VERIFICATIONS_COLLECTION}/${caller.uid}`,
  );

  await firestore.runTransaction(async (tx) => {
    const [userSnap, tenantSnap, inviteSnap, verifySnap] = await Promise.all([
      tx.get(userRef),
      tx.get(tenantRef),
      tx.get(inviteRef),
      tx.get(verifyRef),
    ]);

    // 한 계정은 한 회사에만 속한다(설계서 §3.5). createTenant 와 같은 확인이다 —
    // 여기 없으면 이미 A사 소속인 사람이 B사 초대를 삼켜 소속이 모호해진다.
    if (userSnap.exists) {
      throw new HttpsError("already-exists", "이미 회사에 속해 있습니다.");
    }
    if (!tenantSnap.exists || tenantSnap.get("status") !== "active") {
      throw new HttpsError("permission-denied", "초대를 사용할 수 없습니다.");
    }
    if (!inviteSnap.exists) {
      throw new HttpsError("permission-denied", "초대를 사용할 수 없습니다.");
    }

    // 토큰 대조. 존재 여부와 토큰 오류를 같은 메시지로 돌려준다 —
    // 구분해서 알려주면 초대 ID 를 훑어 유효한 것을 찾아낼 수 있다.
    if (inviteSnap.get("tokenHash") !== hashInviteToken(token)) {
      throw new HttpsError("permission-denied", "초대를 사용할 수 없습니다.");
    }
    if (inviteSnap.get("emailLower") !== callerEmail) {
      throw new HttpsError("permission-denied", "초대받은 이메일과 다릅니다.");
    }
    if (inviteSnap.get("consumedAt")) {
      throw new HttpsError("failed-precondition", "이미 사용된 초대입니다.");
    }
    const expiresAt = inviteSnap.get("expiresAt") as string | undefined;
    if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) {
      throw new HttpsError("deadline-exceeded", "만료된 초대입니다.");
    }

    const now = new Date().toISOString();

    // 초대의 두 목록을 그대로 복사한다. 여기서 다시 인코딩하지 않는다 —
    // 변환 지점이 늘면 어긋난다(설계서 §11.4).
    tx.create(firestore.doc(`tenants/${tenantId}/members/${caller.uid}`), {
      displayName: "",
      email: caller.email,
      phone: verifySnap.exists ? (verifySnap.get(PHONE_FIELD) ?? null) : null,
      phoneVerifiedAt: verifySnap.exists
        ? (verifySnap.get(PHONE_VERIFIED_AT_FIELD) ?? null)
        : null,
      role: inviteSnap.get("role"),
      status: "active",
      provider: "",
      joinedAt: now,
      allowedBranches: inviteSnap.get("allowedBranches") ?? [],
      allowedBranchesEncoded: inviteSnap.get("allowedBranchesEncoded") ?? [],
      // 급여는 지점 권한과 별개 축이다(설계서 §3.4). 초대만으로는 주지 않는다.
      salaryBranchesEncoded: [],
    });

    tx.update(inviteRef, { consumedAt: now, consumedBy: caller.uid });
    tx.create(userRef, { tenantId, createdAt: now });

    // 소속이 확정됐으므로 가입 중 보관소는 정리한다(설계서 §4.2).
    if (verifySnap.exists) {
      tx.delete(verifyRef);
    }
  });

  return { tenantId };
});
```

`functions/src/index.ts`에 `export { redeemInvite } from "./redeemInvite";` 추가.

- [ ] **Step 4: 실행 — 통과 확인 및 커밋**

```bash
npm run test:all
```

Expected: 전부 PASS.

동시 소비 테스트가 실패하면 소비 여부 확인이 트랜잭션 밖에 있는 것이다. **테스트를 직렬화해서 통과시키지 말 것.**

```bash
git add functions/src tests/functions
git commit -F - <<'EOF'
feat: redeemInvite — 초대 소비와 합류

한 번만 쓸 수 있는 것을 트랜잭션으로 보장한다(10명 동시 소비 테스트).
검증된 이메일만 소비할 수 있다 — 아니면 남의 주소로 계정을 만들어
그 사람의 초대를 가로챌 수 있다.

초대의 지점 목록을 그대로 복사한다. 여기서 다시 인코딩하지 않는다.
급여 권한은 주지 않는다 — 지점 권한과 별개 축이다.
EOF
```

---

## Task 4: 합류자가 실제로 자기 지점만 쓰는지 검증

**목표**: 이 계획의 존재 이유. **`allowedBranchesEncoded`가 보안규칙에서 처음으로 진짜 방어선이 되는 것**을 확인한다.

계획 2까지의 사용자는 전부 관리자라 이 필드가 규칙에 닿은 적이 없다. 여기서 만들어지는 사용자는 관리자가 아니므로, 이 테스트가 실패하면 **초대 기능 전체가 무의미하다.**

**Files:**
- Create: `tests/functions/joining.test.ts`

**Interfaces:**
- Consumes: `createTenant`·`createInvite`·`redeemInvite`, `ruledClientFor`(Task 1)

- [ ] **Step 1: 통합 테스트 작성**

Create `tests/functions/joining.test.ts`:

```typescript
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { callFn, seed, clearAll, teardown, adminDb } from './helpers';
import { ruledClientFor, teardownRuledClients } from './ruledClient';

const OWNER = 'owner';
const STAFF = 'staff';
const STAFF_EMAIL = 'staff@example.com';
const GAGE = encodeURIComponent('가게');
const NAGAGE = encodeURIComponent('나가게');

async function expectDenied(p: Promise<unknown>) {
  await expect(p).rejects.toMatchObject({ code: 'permission-denied' });
}

/** 회사를 만들고, 지점 하나만 담당하는 직원을 초대해 합류시킨다. */
async function companyWithStaff() {
  await seed(async (db) => {
    await db.doc(`signup_verifications/${OWNER}`).set({
      phone: '01012345678', phoneVerifiedAt: new Date().toISOString(),
    });
  });
  const { tenantId } = await callFn<{ tenantId: string }>(
    'createTenant', { companyName: '합류사', branchNames: ['가게', '나가게'] }, OWNER,
  );

  const inv = await callFn<{ inviteId: string; token: string }>(
    'createInvite', { email: STAFF_EMAIL, role: 'branch', branchNames: ['가게'] }, OWNER,
  );
  await callFn('redeemInvite', { tenantId, inviteId: inv.inviteId, token: inv.token },
    STAFF, { email: STAFF_EMAIL, email_verified: true });

  return tenantId;
}

describe('초대로 합류한 지점 담당자', () => {
  beforeEach(async () => {
    await clearAll();
  });

  afterAll(async () => {
    await teardownRuledClients();
    await teardown();
  });

  it('★ 담당 지점은 열리고 담당 아닌 지점은 막힌다 — 이 계획의 핵심', async () => {
    const tenantId = await companyWithStaff();
    const fs = await ruledClientFor(STAFF);

    // 담당 지점: 열린다
    await setDoc(doc(fs, 'tenants', tenantId, 'shared_data', `${GAGE}--gen--memo`), { v: 1 });
    await setDoc(doc(fs, 'tenants', tenantId, 'daily_settles', `${GAGE}--2026-08-01`), { master: {} });

    // 담당 아닌 지점: 막힌다.
    // 이 사람은 role:'branch' 이므로 scopeAllowed 의 관리자 단락을 타지 않고,
    // branchIsolation 도 켜져 있으므로 allowedBranchesEncoded 멤버십만이 판정한다.
    await expectDenied(setDoc(doc(fs, 'tenants', tenantId, 'shared_data', `${NAGAGE}--gen--memo`), { v: 1 }));
    await expectDenied(getDoc(doc(fs, 'tenants', tenantId, 'daily_settles', `${NAGAGE}--2026-08-01`)));
  });

  it('담당 아닌 지점 거부가 범위 판정 컬렉션 전부에서 성립한다 (설계서 §8.1 #12)', async () => {
    // match 블록은 각각 독립이다 — 한 컬렉션에서 증명해도 다른 컬렉션의 배선이
    // 깨졌는지는 알 수 없다. 그래서 컬렉션마다 개별 확인한다.
    const tenantId = await companyWithStaff();
    // 담당 아닌 지점(나가게)의 문서를 미리 심어 "읽기 거부"도 확인할 수 있게 한다
    await seed(async (db) => {
      await db.doc(`tenants/${tenantId}/staff_rosters/${NAGAGE}`).set({ employees: [] });
      await db.doc(`tenants/${tenantId}/branch_own_rosters/${NAGAGE}`).set({ employees: [] });
      await db.doc(`tenants/${tenantId}/settings/${NAGAGE}`).set({ brand: 'x' });
      await db.doc(`tenants/${tenantId}/edit_logs/${NAGAGE}--log1`).set({ note: 'x' });
      await db.doc(`tenants/${tenantId}/shared_data_backups/${NAGAGE}--gen--memo--slot0`).set({ v: 1 });
    });
    const fs = await ruledClientFor(STAFF);

    // 읽기 거부 — 컬렉션 5종 각각
    await expectDenied(getDoc(doc(fs, 'tenants', tenantId, 'staff_rosters', NAGAGE)));
    await expectDenied(getDoc(doc(fs, 'tenants', tenantId, 'branch_own_rosters', NAGAGE)));
    await expectDenied(getDoc(doc(fs, 'tenants', tenantId, 'settings', NAGAGE)));
    await expectDenied(getDoc(doc(fs, 'tenants', tenantId, 'edit_logs', `${NAGAGE}--log1`)));
    await expectDenied(getDoc(doc(fs, 'tenants', tenantId, 'shared_data_backups', `${NAGAGE}--gen--memo--slot0`)));

    // 쓰기 거부 — 구성원이 쓸 수 있는 형태의 컬렉션 각각
    await expectDenied(setDoc(doc(fs, 'tenants', tenantId, 'staff_rosters', NAGAGE), { employees: [] }));
    await expectDenied(setDoc(doc(fs, 'tenants', tenantId, 'branch_own_rosters', NAGAGE), { employees: [] }));
    await expectDenied(setDoc(doc(fs, 'tenants', tenantId, 'edit_logs', `${NAGAGE}--log2`), { note: 'y' }));
    await expectDenied(setDoc(doc(fs, 'tenants', tenantId, 'shared_data_backups', `${NAGAGE}--gen--memo--slot1`), { v: 1 }));

    // 대조군: 같은 컬렉션의 담당 지점 문서는 열린다 — "전부 막는 규칙"이 아님을 증명
    await setDoc(doc(fs, 'tenants', tenantId, 'staff_rosters', GAGE), { employees: [] });
    await setDoc(doc(fs, 'tenants', tenantId, 'edit_logs', `${GAGE}--log-own`), { note: 'mine' });
  });

  it('급여는 담당 지점이어도 막힌다 — 별개 축이다', async () => {
    const tenantId = await companyWithStaff();
    const fs = await ruledClientFor(STAFF);
    await expectDenied(
      setDoc(doc(fs, 'tenants', tenantId, 'shared_data', `${GAGE}--salary--2026-08`), { v: 1 }),
    );
  });

  it('관리자 전용 데이터는 막힌다', async () => {
    const tenantId = await companyWithStaff();
    const fs = await ruledClientFor(STAFF);
    await expectDenied(getDoc(doc(fs, 'tenants', tenantId, 'shared_data', '_admin--gen--config')));
  });

  it('회사 공용 지점 목록은 담당 아닌 지점도 보인다', async () => {
    const tenantId = await companyWithStaff();
    const fs = await ruledClientFor(STAFF);
    const branches = await getDocs(collection(fs, 'tenants', tenantId, 'public_branches'));
    expect(branches.docs.map((d) => d.id).sort()).toEqual([GAGE, NAGAGE].sort());
  });

  it('자기 소속·권한 문서를 고칠 수 없다', async () => {
    const tenantId = await companyWithStaff();
    const fs = await ruledClientFor(STAFF);
    await expectDenied(setDoc(doc(fs, 'users', STAFF), { tenantId: 'other' }));
    await expectDenied(setDoc(doc(fs, 'tenants', tenantId, 'members', STAFF), {
      role: 'admin', allowedBranchesEncoded: [GAGE, NAGAGE],
    }));
  });

  it('다른 구성원의 프로필을 볼 수 없다', async () => {
    const tenantId = await companyWithStaff();
    const fs = await ruledClientFor(STAFF);
    await expectDenied(getDoc(doc(fs, 'tenants', tenantId, 'members', OWNER)));
  });

  it('관리자와 직원이 동시에 각자 권한으로 동작한다', async () => {
    const tenantId = await companyWithStaff();
    const ownerFs = await ruledClientFor(OWNER);
    const staffFs = await ruledClientFor(STAFF);

    // 관리자는 두 지점 다 쓴다
    await setDoc(doc(ownerFs, 'tenants', tenantId, 'shared_data', `${NAGAGE}--gen--memo`), { v: 1 });
    // 직원은 자기 지점만
    await setDoc(doc(staffFs, 'tenants', tenantId, 'shared_data', `${GAGE}--gen--memo2`), { v: 1 });
    await expectDenied(
      setDoc(doc(staffFs, 'tenants', tenantId, 'shared_data', `${NAGAGE}--gen--memo3`), { v: 1 }),
    );
  });

  it('getAccountState 가 합류자에게 branch 역할을 알려준다', async () => {
    const tenantId = await companyWithStaff();
    const state = await callFn<Record<string, unknown>>('getAccountState', {}, STAFF,
      { email: STAFF_EMAIL, email_verified: true });
    expect(state).toEqual({
      state: 'active', tenantId, companyName: '합류사', role: 'branch',
    });
  });
});
```

마지막 테스트(`관리자와 직원이 동시에`)가 Task 1의 인물 분리가 실제로 필요했음을 증명한다.

- [ ] **Step 2: 실행 — 통과 확인**

```bash
npm run test:all
```

**첫 번째 테스트가 실패하면 그것이 이 계획의 성과다.** `redeemInvite`가 쓰는 필드명과 규칙이 읽는 이름이 어긋난 것이다. 어느 쪽이 틀렸는지 판단해 보고하고, **규칙을 느슨하게 고쳐 통과시키지 말 것.**

- [ ] **Step 3: 커밋**

```bash
git add tests/functions/joining.test.ts
git commit -F - <<'EOF'
test: 합류자가 자기 지점만 쓰는지 검증

계획 2까지의 사용자는 전부 관리자라 allowedBranchesEncoded 가 보안규칙에
닿아본 적이 없다. 초대로 합류한 지점 담당자는 오직 그 필드에만 의존한다.

관리자와 직원이 각자 권한으로 동시에 동작하는 것까지 확인한다.
EOF
```

---

## 이 계획이 끝나면

**할 수 있게 되는 것**: 관리자가 직원을 초대하고, 직원이 합류해 자기 담당 지점만 쓴다.

**아직 못 하는 것**: 합류한 사람의 권한 변경(`updateMember`), 회사 정지(`setTenantStatus`), 지점 추가(`createBranch`) — 전부 계획 4. 화면은 계획 5. 카카오·네이버·문자는 계획 6.

**여전히 클라우드 자원 0** — 전부 에뮬레이터. `erp_ugd` 영향 0.

---

## 자체 점검 결과

**설계서 대조** — 이 계획은 §3.5의 `createInvite`·`redeemInvite`·`listInvites`, §4.3의 합류 경로, §4.4의 초대장 설계 5요건(추측 불가·해시 저장·이메일 소유 확인·만료·단일 사용)을 전부 덮는다.

§8.1의 테스트 번호 중 이 계획이 닫는 것: **#14**(만료·소비된 초대) · **#15**(이메일 미검증 소비) · **#16**(동시 소비) · **#17**(이미 소속된 사람의 소비). 계획 1의 자체 점검이 "계획 2로 미룬다"고 적었던 항목들이며, 실제로는 이 계획이 닫는다.

**타입 일관성** — `createInvite`가 쓰는 `emailLower`·`tokenHash`·`role`·`allowedBranches`·`allowedBranchesEncoded`·`expiresAt`·`consumedAt` 필드명을 `redeemInvite`와 `listInvites`가 같은 이름으로 읽는다. Task 4가 이 일치를 실행으로 확인한다.

**계획 2와의 대조** — `redeemInvite`가 만드는 `members` 문서의 필드 구성은 `createTenant`가 만드는 것과 같다(`role`만 다르고, `salaryBranchesEncoded`는 빈 목록). 규칙이 읽는 이름은 동일하다.

---

## Codex 리뷰 반영 이력 (2026-08-17, P0 2 + P1 2 + controller 발견 1)

| # | 지적 | 반영 |
|---|---|---|
| **P0-1** | Task 4가 §8.1 #12(컬렉션별 격리)를 `shared_data`·`daily_settles` 2종만 검증. match 블록은 독립이라 나머지 5종의 배선이 깨져도 통과 | Task 4에 컬렉션 전수 테스트 추가 — 읽기 5종·쓰기 4종 거부 + 담당 지점 대조군 |
| **P0-2** | 동시 소비 테스트(같은 uid 10회)는 `users/{uid}` create 충돌만으로 성공 1건이 되므로, `consumedAt` 확인이 트랜잭션 밖이어도 초록 | 성공 개수에 더해 **초대 문서의 `consumedAt`/`consumedBy`를 고정**. 재사용 위협은 "구성원 제거 후 본인 재소비" 시나리오로 별도 테스트 |
| P1-1 | `requireTenantAdmin`이 코드 블록에선 비-export인데 `listInvites`가 import — 블록만 복사하면 빌드 실패. onCall 모듈 간 import 구조도 패턴 위반 | `lib/tenantAdmin.ts`로 분리. 함수 모듈은 lib만 import |
| P1-2 | `createInvite` 검증 표에 `_admin`(예약어) 케이스 부재 | `_admin` + `- 로 끝남` 케이스 추가 |
| **controller** | 계획서의 "이미 소비된 초대" 테스트가 두 번째 인물에게 **같은 이메일**을 부여 — Firebase Auth 는 이메일 중복을 막으므로 하네스가 `auth/email-already-exists` 로 죽는다. Codex 의 "다른 UID 두 명" 처방도 같은 제약(1 이메일 = 1 계정)에 걸려 실행 불가 | 두 테스트를 "같은 사람이 제거된 뒤 재소비" 형태로 재설계. 이메일 중복이 불가능하다는 사실 자체를 주석으로 기록 |

**교훈**: 초대의 단일 사용 보장에서 "서로 다른 두 사람이 같은 초대를 삼키는" 경쟁은 **이메일 유일성 때문에 성립하지 않는다** — 초대가 이메일에 묶이고, 이메일 하나에 계정 하나이기 때문. 실제 위협은 재사용(제거된 사람이 옛 초대로 재입장)이고, 그건 순차 테스트로 잡는다.
