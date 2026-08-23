# 구성원·지점·회사 관리 구현 계획 (계획 4/N)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 합류한 사람과 지점을 관리한다 — 권한 변경, 구성원 제거, 초대 취소, 지점 추가·비활성, 회사 정지. 이 계획이 끝나면 회사 하나의 **전체 생애주기**(생성→초대→합류→권한변경→제거→정지)가 서버 함수로 완결되고 자동 테스트로 증명된다.

**Architecture:** 계획 1~3의 패턴 그대로 — 클라이언트가 쓸 수 없는 문서는 서버 함수만 쓴다. 이 계획은 추가로 **`public_branches`의 클라이언트 쓰기를 완전히 닫는다**(지금은 회사 관리자가 규칙 게이트를 거쳐 직접 쓸 수 있는데, 그 게이트가 서버 검증보다 약하다). 전부 에뮬레이터, 클라우드 자원 0, `erp_ugd` 영향 0.

**Tech Stack:** 계획 2~3과 동일.

**Spec:** `../specs/2026-08-17-multi-tenant-erp-design.md` — §3.3·§3.4·§3.5(`updateMember`·`setTenantStatus`)·§4.5

**시작 지점**: 브랜치 `plan-4-member-mgmt`, `plan-3-invites`(`8fe4488`)에서 분기. 현재 201 테스트.

---

## 계획 3 최종 리뷰가 이 계획에 넘긴 제약 (전부 반영됨)

| # | 제약 | 반영 위치 |
|---|---|---|
| 1 | 구성원 제거는 `users`+`members`+**그 이메일의 미소비 초대**를 한 트랜잭션으로 | Task 3 |
| 2 | 지점 삭제는 frozen 범위키 스윕 문제를 만든다 | **v1은 삭제 불가, 비활성만** (아래 Ruling) |
| 3 | `revokeInvite` 필요 (7일짜리 admin 초대를 취소할 방법이 없음) | Task 1 |
| 4 | `updateMember`는 `toBranchPair` 경유 + `[...names]` 복사 + 두 배열 동시 기록 | Task 2 |
| 5 | `isActive:false` 지점의 초대 가능 여부 결정 | **불가로 결정** — Task 4 |
| 6 | 거부 테스트는 코드가 겹치면 메시지까지 단언 / 모든 allow 절에 양성 케이스 | 전 Task 적용 |

**Ruling — 지점 삭제는 v1에 없다.** 삭제하면 그 지점 범위키를 담은 `members`·`invites`·기존 데이터 문서를 전부 원자적으로 스윕해야 하고, 같은 이름의 지점이 재생성되면 옛 보유자가 접근을 되찾는 문제까지 있다. **비활성(`isActive:false`)**은 이 문제가 없다 — 데이터는 남고, 새 초대·권한 부여만 막는다. 삭제가 정말 필요해지면 별도 계획으로 다룬다.

**Ruling — `_admin` 급여 권한 부여는 v1 범위 밖.** `updateMember`의 급여 목록은 실재하는 지점명만 받는다. `_admin--salary--` 문서는 당분간 아무도 못 읽는 상태로 남는다(fail-closed). 필요해지면 명시적 기능으로 추가한다.

---

## Global Constraints

- 불변식 1~3 (교차회사 금지 / 소속·권한은 서버만 / 정지 회사 전면 차단)
- **마지막 관리자 보호**: 회사의 활성 관리자가 1명뿐일 때 그를 강등·정지·제거할 수 없다 (회사가 영구 잠긴다)
- `allowedBranches`/`allowedBranchesEncoded`는 **`toBranchPair`로만** 함께 기록. 급여 목록도 인코딩본으로 저장
- 지점명 검증은 **서버의 `assertValidBranchNames`가 유일한 관문** — `public_branches` 클라이언트 쓰기는 전면 닫는다
- 거부 코드가 겹치는 테스트는 **메시지까지** 단언한다
- 새로 만드는 **모든 allow/성공 경로에 양성 케이스** 1개 이상
- `revokeInvite`는 기존 `consumedAt` 단일사용 메커니즘을 재사용한다(redeemInvite 무변경)

## 환경 (계획 1~3과 동일)

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
```
`java: command not found`= PATH 문제. 재설치 금지. functions 수정 후 `npm run build:functions` 필수(단일 파일 실행은 자동 빌드 안 함). 전체: `npm run test:all`. **테스트 파일당 teardown 성 afterAll은 파일 끝 1회만**(계획 3 하네스 규칙).

## File Structure

| 파일 | 책임 |
|---|---|
| `functions/src/lib/memberGuards.ts` | 마지막 관리자 계산 등 구성원 변경 공용 판정 |
| `functions/src/revokeInvite.ts` | 초대 취소 |
| `functions/src/updateMember.ts` | 권한·표시명 변경 |
| `functions/src/removeMember.ts` | 구성원 제거 (3문서+초대 트랜잭션) |
| `functions/src/createBranch.ts` | 지점 추가 (서버 전용 경로) |
| `functions/src/setBranchActive.ts` | 지점 활성/비활성 |
| `functions/src/setTenantStatus.ts` | 최고관리자의 회사 정지·해제 |
| `firestore.rules` | `public_branches` 쓰기 전면 폐쇄 (수정) |
| `functions/src/createInvite.ts` | 비활성 지점 초대 불가 (수정) |
| `tests/functions/memberMgmt.test.ts` | Task 1~3 함수 검증 |
| `tests/functions/branchMgmt.test.ts` | Task 4 검증 |
| `tests/functions/lifecycle.test.ts` | Task 5 통합 — 전체 생애주기 |

---

## Task 1: `revokeInvite`

**Interfaces** — Consumes: `requireAuth`·`db`·`requireTenantAdmin`. Produces: `revokeInvite({ inviteId })` → `{}`.

- [ ] **Step 1: 실패하는 테스트** — Create `tests/functions/memberMgmt.test.ts`. 공용 헬퍼는 `invites.test.ts`의 `makeCompany` 패턴을 복제한다(파일 간 import 는 하네스 규칙상 피한다). describe `revokeInvite`:

```typescript
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { callFn, seed, clearAll, teardown, adminDb } from './helpers';

const OWNER = 'owner';

async function makeCompany(uid = OWNER, branches = ['가게', '나가게']) {
  await seed(async (db) => {
    await db.doc(`signup_verifications/${uid}`).set({
      phone: '01012345678', phoneVerifiedAt: new Date().toISOString(),
    });
  });
  return await callFn<{ tenantId: string }>(
    'createTenant', { companyName: '관리사', branchNames: branches }, uid,
  );
}

async function makeInvite(email = 'x@example.com', branches = ['가게'], role = 'branch') {
  const { tenantId } = await makeCompany();
  const inv = await callFn<{ inviteId: string; token: string }>(
    'createInvite', { email, role, branchNames: branches }, OWNER,
  );
  return { tenantId, ...inv };
}

describe('revokeInvite', () => {
  beforeEach(async () => { await clearAll(); });

  it('관리자가 미소비 초대를 취소한다 — 이후 소비 불가', async () => {
    const { tenantId, inviteId, token } = await makeInvite('a@example.com');
    await callFn('revokeInvite', { inviteId }, OWNER);

    const doc = await adminDb().doc(`tenants/${tenantId}/invites/${inviteId}`).get();
    expect(doc.get('consumedAt')).toBeTruthy();
    expect(doc.get('consumedBy')).toBe(`revoked:${OWNER}`);

    // redeemInvite 는 무변경 — 기존 consumedAt 검사가 그대로 막는다
    await expect(
      callFn('redeemInvite', { tenantId, inviteId, token }, 'newcomer',
        { email: 'a@example.com', email_verified: true }),
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
  });

  it('이미 소비된 초대는 취소할 수 없다', async () => {
    const { tenantId, inviteId, token } = await makeInvite('b@example.com');
    await callFn('redeemInvite', { tenantId, inviteId, token }, 'joiner',
      { email: 'b@example.com', email_verified: true });
    await expect(callFn('revokeInvite', { inviteId }, OWNER))
      .rejects.toMatchObject({ code: 'functions/failed-precondition',
        message: expect.stringContaining('이미 사용') });
  });

  it('없는 초대는 취소할 수 없다 — 불투명 메시지', async () => {
    await makeCompany();
    await expect(callFn('revokeInvite', { inviteId: 'f'.repeat(32) }, OWNER))
      .rejects.toMatchObject({ code: 'functions/not-found' });
  });

  it('관리자가 아니면 취소할 수 없다', async () => {
    const { tenantId, inviteId } = await makeInvite('c@example.com');
    await seed(async (db) => {
      await db.doc(`tenants/${tenantId}/members/${OWNER}`).update({ role: 'branch' });
    });
    await expect(callFn('revokeInvite', { inviteId }, OWNER))
      .rejects.toMatchObject({ code: 'functions/permission-denied',
        message: '관리자만 할 수 있습니다.' });
  });
});
```

- [ ] **Step 2: RED 확인** (`functions/not-found`)
- [ ] **Step 3: 구현** — Create `functions/src/revokeInvite.ts`:

```typescript
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireAuth, db } from "./lib/context";
import { requireTenantAdmin } from "./lib/tenantAdmin";

/**
 * 미소비 초대를 취소한다. redeemInvite 의 단일사용 메커니즘(consumedAt)을 재사용하므로
 * redeemInvite 는 한 줄도 바뀌지 않는다 — 취소된 초대는 "이미 사용된 초대"로 거부된다.
 * consumedBy 의 "revoked:" 접두사가 감사 기록을 남긴다.
 */
export const revokeInvite = onCall(async (request) => {
  const caller = requireAuth(request);
  const tenantId = await requireTenantAdmin(caller.uid);
  const firestore = db();

  const inviteId = typeof (request.data ?? {}).inviteId === "string"
    ? (request.data as { inviteId: string }).inviteId : "";
  if (inviteId === "") {
    throw new HttpsError("invalid-argument", "초대 정보가 올바르지 않습니다.");
  }

  const inviteRef = firestore.doc(`tenants/${tenantId}/invites/${inviteId}`);
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(inviteRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "초대를 찾을 수 없습니다.");
    }
    if (snap.get("consumedAt")) {
      throw new HttpsError("failed-precondition", "이미 사용되었거나 취소된 초대입니다.");
    }
    tx.update(inviteRef, {
      consumedAt: new Date().toISOString(),
      consumedBy: `revoked:${caller.uid}`,
    });
  });
  return {};
});
```

`index.ts`에 등록.

- [ ] **Step 4: GREEN + `npm run test:all` (201 유지 + 신규) → 커밋** `feat: revokeInvite — 초대 취소`

---

## Task 2: `updateMember`

**Interfaces** — Produces: `updateMember({ memberUid, role?, displayName?, branchNames?, salaryBranchNames? })` → `{}`. 지정한 필드만 갱신.

- [ ] **Step 1: 실패하는 테스트** — 같은 파일에 describe `updateMember` 추가. 헬퍼:

```typescript
async function companyWithStaff(staffBranches = ['가게']) {
  const { tenantId } = await makeCompany();
  const inv = await callFn<{ inviteId: string; token: string }>(
    'createInvite', { email: 'staff@example.com', role: 'branch', branchNames: staffBranches }, OWNER,
  );
  await callFn('redeemInvite', { tenantId, inviteId: inv.inviteId, token: inv.token },
    'staff', { email: 'staff@example.com', email_verified: true });
  return tenantId;
}
```

테스트(각 거부는 코드+메시지):
1. **지점 목록 변경** — `updateMember({ memberUid:'staff', branchNames:['가게','나가게'] })` 후 members 문서의 `allowedBranches`·`allowedBranchesEncoded` **둘 다** 갱신 확인
2. **급여 권한 부여** — `salaryBranchNames:['가게']` → `salaryBranchesEncoded:[enc(가게)]`. **원문 필드는 만들지 않는다**(기존 스키마에 없음)
3. **역할 승격** — `role:'admin'` 후 그 사람이 `createInvite` 를 실제로 호출 성공(양성 케이스)
4. **마지막 관리자 강등 불가** — OWNER(유일 관리자)를 `role:'branch'`로 → `failed-precondition`, 메시지 "마지막 관리자는 강등하거나 제거할 수 없습니다."
5. **관리자 2명이면 강등 가능** — staff 승격 후 OWNER 강등 성공
6. **없는 지점 부여 불가** — `branchNames:['유령']` → `invalid-argument`, "회사에 없는 지점입니다: 유령"
7. **비관리자 호출 불가** / **없는 구성원** → `not-found` / **다른 필드 보존** — `role`만 바꿔도 `allowedBranchesEncoded` 불변
8. **`_all`/`_admin`/`--` 지점명 거부** — 메시지 단언 (`assertValidBranchNames` 경유 증명)

- [ ] **Step 2: RED 확인**
- [ ] **Step 3: 공용 가드** — Create `functions/src/lib/memberGuards.ts`:

```typescript
import { HttpsError } from "firebase-functions/v2/https";
import type { Transaction, Firestore } from "firebase-admin/firestore";

/**
 * 이 변경으로 회사의 활성 관리자가 0명이 되는지 트랜잭션 안에서 판정한다.
 * 마지막 관리자를 강등·정지·제거하면 소속·권한 문서를 쓸 수 있는 사람이
 * 아무도 없어져 회사가 영구 잠긴다(클라이언트는 쓸 수 없으므로).
 */
export async function assertNotLastAdmin(
  tx: Transaction, firestore: Firestore, tenantId: string, targetUid: string,
): Promise<void> {
  const admins = await tx.get(
    firestore.collection(`tenants/${tenantId}/members`)
      .where("role", "==", "admin").where("status", "==", "active"),
  );
  const others = admins.docs.filter((d) => d.id !== targetUid);
  if (others.length === 0) {
    throw new HttpsError("failed-precondition", "마지막 관리자는 강등하거나 제거할 수 없습니다.");
  }
}
```

- [ ] **Step 4: 구현** — Create `functions/src/updateMember.ts`. 골격:

```typescript
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireAuth, db } from "./lib/context";
import { requireTenantAdmin } from "./lib/tenantAdmin";
import { assertValidBranchNames, toBranchPair, encodeBranch } from "./lib/branchKey";
import { assertNotLastAdmin } from "./lib/memberGuards";

export const updateMember = onCall(async (request) => {
  const caller = requireAuth(request);
  const tenantId = await requireTenantAdmin(caller.uid);
  const firestore = db();
  const p = (request.data ?? {}) as {
    memberUid?: unknown; role?: unknown; displayName?: unknown;
    branchNames?: unknown; salaryBranchNames?: unknown;
  };
  const memberUid = typeof p.memberUid === "string" ? p.memberUid : "";
  if (memberUid === "") throw new HttpsError("invalid-argument", "대상 구성원이 올바르지 않습니다.");

  // 검증은 트랜잭션 밖에서 — 지점 존재 확인은 public_branches 대조 (createInvite 와 동일 패턴,
  // isActive === false 지점은 부여 불가: Task 4 에서 createInvite 와 함께 걸리는 검사를 재사용)
  const update: Record<string, unknown> = {};
  if (p.role !== undefined) {
    if (p.role !== "admin" && p.role !== "branch")
      throw new HttpsError("invalid-argument", "역할은 admin 또는 branch 여야 합니다.");
    update.role = p.role;
  }
  if (p.displayName !== undefined) {
    if (typeof p.displayName !== "string" || p.displayName.length > 100)
      throw new HttpsError("invalid-argument", "표시명이 올바르지 않습니다.");
    update.displayName = p.displayName;
  }

  // ★ 빈 배열([])은 "전부 회수"다 — assertValidBranchNames 는 빈 배열을 거부하므로
  //   (createTenant/createInvite 에는 그게 맞다) 여기서는 빈 배열을 별도 분기로 먼저 처리한다.
  //   이 분기가 없으면 관리자가 구성원을 제거하지 않고는 접근을 회수할 수 없다(Codex P0-2).
  const wantBranches = p.branchNames !== undefined
    ? (Array.isArray(p.branchNames) && p.branchNames.length === 0
        ? [] : assertValidBranchNames(p.branchNames))
    : undefined;
  const wantSalary = p.salaryBranchNames !== undefined
    ? (Array.isArray(p.salaryBranchNames) && p.salaryBranchNames.length === 0
        ? [] : assertValidBranchNames(p.salaryBranchNames))
    : undefined;
  if (wantBranches === undefined && wantSalary === undefined
      && Object.keys(update).length === 0)
    throw new HttpsError("invalid-argument", "변경할 내용이 없습니다.");

  const memberRef = firestore.doc(`tenants/${tenantId}/members/${memberUid}`);
  await firestore.runTransaction(async (tx) => {
    // ★ 지점 사용 가능성 확인은 트랜잭션 **안**에서 tx.get 으로 한다(Codex P0-3).
    //   밖에서 읽으면 다른 관리자가 그 사이 지점을 비활성화해도 재시도가 일어나지 않아
    //   비활성 지점 권한이 부여될 수 있다. 부여하려는 지점 문서를 개별 tx.get 하면
    //   setBranchActive 트랜잭션과 충돌 시 Firestore 가 재시도한다.
    const toCheck = [...new Set([...(wantBranches ?? []), ...(wantSalary ?? [])])];
    if (toCheck.length > 0) {
      const snaps = await Promise.all(toCheck.map((name) =>
        tx.get(firestore.doc(`tenants/${tenantId}/public_branches/${encodeBranch(name)}`))));
      snaps.forEach((s, i) => {
        if (!s.exists)
          throw new HttpsError("invalid-argument", `회사에 없는 지점입니다: ${toCheck[i]}`);
        if (s.get("isActive") === false)
          throw new HttpsError("invalid-argument", `비활성 지점입니다: ${toCheck[i]}`);
      });
    }

    const snap = await tx.get(memberRef);
    if (!snap.exists) throw new HttpsError("not-found", "구성원을 찾을 수 없습니다.");
    if (update.role === "branch" && snap.get("role") === "admin") {
      await assertNotLastAdmin(tx, firestore, tenantId, memberUid);
    }
    if (wantBranches !== undefined) Object.assign(update, toBranchPair([...wantBranches]));
    if (wantSalary !== undefined) update.salaryBranchesEncoded = wantSalary.map(encodeBranch);
    tx.update(memberRef, update);
  });
  return {};
});
```

주의: `branchNames:[]`·`salaryBranchNames:[]` 회수 케이스를 **양성 테스트로 포함**(빈 쌍이 기록되고, 이후 그 사람의 지점 접근이 규칙에서 거부됨). `isActive:false` 검사는 Task 4 이전에는 필드가 없어 통과한다(`=== false` 만 거부) — Task 4가 비활성 테스트를 붙인다.

- [ ] **Step 5: `index.ts` 등록 확인** — `export { updateMember } from "./updateMember";` (★ 모든 Task 의 새 함수는 만들 때마다 `index.ts` 에 등록한다. 등록 없이는 호출 불가 — Codex P0-1)
- [ ] **Step 6: GREEN + 전체 + 커밋** `feat: updateMember — 권한·표시명 변경`

---

## Task 3: `removeMember`

**Interfaces** — Produces: `removeMember({ memberUid })` → `{}`.

- [ ] **Step 1: 실패하는 테스트** — describe `removeMember`:
1. **제거하면 users·members 둘 다 사라진다** + `getAccountState`가 `no_tenant` (양성 흐름)
2. **그 이메일의 미소비 초대가 함께 취소된다** — staff@ 앞으로 미소비 초대 하나 더 만든 뒤 제거 → 그 초대의 `consumedBy` 가 `removed:{adminUid}` — **다른 초대로 재입장하는 경로 차단**(계획 3 리뷰 지적)
3. **제거된 사람은 규칙에서 즉시 차단** — `ruledClientFor('staff')` 로 이전 담당 지점 문서 읽기 → `permission-denied`
4. **마지막 관리자 제거 불가** — 메시지 동일("마지막 관리자는…")
5. **자기 자신 제거** — 관리자 2명일 때 자기 제거 허용(양성) / 유일 관리자는 4번에 걸림
6. 비관리자 호출·없는 구성원 거부 (코드+메시지)

- [ ] **Step 2: RED**
- [ ] **Step 3: 구현** — Create `functions/src/removeMember.ts`:

```typescript
export const removeMember = onCall(async (request) => {
  const caller = requireAuth(request);
  const tenantId = await requireTenantAdmin(caller.uid);
  const firestore = db();
  const memberUid = /* p.memberUid 검증, 위와 동일 */;

  const memberRef = firestore.doc(`tenants/${tenantId}/members/${memberUid}`);
  const userRef = firestore.doc(`users/${memberUid}`);

  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(memberRef);
    if (!snap.exists) throw new HttpsError("not-found", "구성원을 찾을 수 없습니다.");
    if (snap.get("role") === "admin") {
      await assertNotLastAdmin(tx, firestore, tenantId, memberUid);
    }
    // 같은 이메일의 미소비 초대를 함께 취소한다 — 제거된 사람이 남은 초대로 재입장하는 경로 차단.
    // Admin SDK 트랜잭션은 쿼리 read 를 지원한다. 읽기는 전부 쓰기 전에.
    const email = (snap.get("email") as string | null)?.toLowerCase();
    const pending = email
      ? await tx.get(firestore.collection(`tenants/${tenantId}/invites`)
          .where("emailLower", "==", email).where("consumedAt", "==", null))
      : null;

    const now = new Date().toISOString();
    if (pending) {
      for (const d of pending.docs) {
        tx.update(d.ref, { consumedAt: now, consumedBy: `removed:${caller.uid}` });
      }
    }
    tx.delete(memberRef);
    tx.delete(userRef);
  });
  return {};
});
```

users 문서 삭제로 `myTenant()` 판정이 즉시 무너져 규칙 차단이 성립한다(테스트 3). 제거 후 재초대→재합류는 **정상 경로**다(새 초대) — lifecycle 테스트에서 확인.

- [ ] **Step 4: `index.ts` 등록** — `export { removeMember } from "./removeMember";`
- [ ] **Step 5: GREEN + 전체 + 커밋** `feat: removeMember — 구성원 제거 트랜잭션`

---

## Task 4: 지점 관리 + `public_branches` 클라이언트 쓰기 폐쇄

**가장 조심할 Task.** 규칙 변경이 기존 테스트와 얽힌다.

- [ ] **Step 1: 실패하는 테스트** — Create `tests/functions/branchMgmt.test.ts`:
1. `createBranch({ branchName })` — 추가 후 `public_branches/{enc}` 존재, `isActive:true` (양성)
2. 중복 지점명 거부 / `_all`·`--`·끝하이픈 거부 (메시지 단언 — **서버 검증이 유일 관문이 됐음을 증명**)
3. NFC: NFD 로 같은 이름 추가 시도 → 중복 거부 (계획 3 리뷰의 규칙 게이트 약점이 서버로 닫힘)
4. `setBranchActive({ branchName, isActive:false })` → 문서의 `isActive:false` (양성)
5. **비활성 지점은 초대 불가** — `createInvite` 가 `invalid-argument` "비활성 지점입니다: …"
6. **비활성 지점은 권한 부여 불가** — `updateMember` 동일 거부
7. **기존 데이터는 계속 열린다** — 비활성 전 담당자가 그 지점 문서를 여전히 읽고 쓴다(비활성은 데이터 차단이 아님을 고정)
8. 비관리자 호출 거부

- [ ] **Step 2: 규칙 테스트 재작성** — `tests/rules/collections.test.ts`:
   - "관리자는 public_branches 에 쓸 수 있다"(양성) → **"관리자여도 public_branches 를 클라이언트에서 쓸 수 없다"**(create·update·delete 각각 거부)로 교체
   - 계획 2·3이 넣은 규칙 게이트 테스트들(`foo--bar`·`_all`·`_admin`·끝하이픈·개행) — 쓰기 전면 폐쇄 후에는 **전부 "다른 이유로 통과"가 되므로 삭제**하고, 교체 테스트의 주석에 "ID 검증은 서버 `assertValidBranchNames` 가 유일 관문(branchMgmt.test.ts 가 증명)" 명시
   - ★ **`I-2 관리자가 정상 인코딩 지점명으로 public_branches 를 생성할 수 있다 (대조군)` 양성 테스트도 삭제 대상이다**(Codex P0-4 — 계획 초판이 빠뜨린 항목). 쓰기 폐쇄 후 이 테스트는 실패한다. 그 대조군의 역할("전부 막는 규칙이 아님")은 `get`/`list` 양성 + `branchMgmt.test.ts` 의 createBranch 양성이 이어받는다
   - `get`/`list` 양성 케이스는 유지
   - 재작성 후 **파일 전체를 grep** 해 `public_branches` 에 쓰는 다른 테스트가 남지 않았는지 확인
- [ ] **Step 3: RED 확인** (functions 쪽 not-found + 규칙 쪽은 아직 구 규칙이라 교체 테스트 FAIL)
- [ ] **Step 4: 구현** —
   - `firestore.rules`: `public_branches` 블록을 `allow get, list: if inTenant(t); allow create, update, delete: if false;` 로 교체. 기존 ID 게이트 주석은 "서버 전용으로 이전(계획 4)" 로 갱신
   - Create `functions/src/createBranch.ts` — `requireTenantAdmin` → `assertValidBranchNames([branchName])` → 기존 지점 전체와 중복 확인(NFC 정규화는 validator 가 이미 수행) → `.create()` (`{ branchName, isActive: true, createdAt }`)
   - Create `functions/src/setBranchActive.ts` — 존재 확인 후 `isActive` 갱신
   - `createInvite.ts` 의 지점 존재 확인에 `isActive !== false` 검사를 추가 — "비활성 지점입니다: X" 메시지. (`updateMember` 는 Task 2에서 이미 트랜잭션 안 tx.get 으로 동일 검사를 한다 — 코드 공유보다 판정 위치가 다른 것이 우선: updateMember 는 즉시 권한이 생기므로 트랜잭션 안, createInvite 는 스냅샷 문서를 만들 뿐이라 트랜잭션 밖 확인을 유지한다. **알려진 잔여**: createInvite 확인과 문서 생성 사이에 지점이 비활성화되는 경쟁 창이 있다 — 결과물은 "비활성 지점이 든 초대"이고, 관리자만 유발 가능하며 revokeInvite 로 회수 가능하므로 수용. 주석으로 명시)
- [ ] **Step 5: `index.ts` 등록** — `createBranch`·`setBranchActive` 둘 다
- [ ] **Step 6: GREEN + 전체 + 커밋** `feat: 지점 관리 서버 전용화 — createBranch/setBranchActive + 규칙 쓰기 폐쇄`

---

## Task 5: `setTenantStatus` + 생애주기 통합

- [ ] **Step 1: 실패하는 테스트** — Create `tests/functions/lifecycle.test.ts`:

describe `setTenantStatus`:
1. `platform_admins/{uid}` 를 seed 로 심은 최고관리자가 `setTenantStatus({ tenantId, status:'suspended' })` → 회사 구성원의 `getAccountState` 가 `tenant_suspended`(이유만), `ruledClientFor` 데이터 접근 전면 거부
2. 해제(`'active'`) → 접근 복원 (양성)
3. **최고관리자가 아니면 거부** — 회사 관리자(OWNER)가 호출해도 `permission-denied`
4. status 값 검증 (`'active'|'suspended'` 외 거부)

describe `전체 생애주기` (이 계획의 마무리 — 함수 9개가 실제로 맞물리는지):
```
createTenant(2지점) → createInvite(staff) → redeemInvite → updateMember(승격)
→ 새 관리자가 createInvite(second) → revokeInvite → second 소비 실패
→ createBranch(3호점) → 신규 지점으로 updateMember(권한) → 지점 데이터 접근 성공
→ setBranchActive(false) → 그 지점 재부여 불가·기존 접근 유지
→ removeMember(staff, 관리자 2명 상태) → staff 접근 즉시 차단 → 같은 이메일 재초대·재합류 성공
```
각 단계에 assertion. 이것이 계획 4의 "열린다" 총검증이다.

- [ ] **Step 2: RED**
- [ ] **Step 3: 구현** — Create `functions/src/setTenantStatus.ts`:

```typescript
export const setTenantStatus = onCall(async (request) => {
  const caller = requireAuth(request);
  const firestore = db();
  // 최고관리자 판정 — platform_admins 는 클라이언트 접근 전면 금지 문서(서버만 읽는다)
  const isPlatform = (await firestore.doc(`platform_admins/${caller.uid}`).get()).exists;
  if (!isPlatform) throw new HttpsError("permission-denied", "최고관리자만 할 수 있습니다.");

  const p = (request.data ?? {}) as { tenantId?: unknown; status?: unknown };
  const tenantId = typeof p.tenantId === "string" ? p.tenantId : "";
  if (tenantId === "") throw new HttpsError("invalid-argument", "회사가 올바르지 않습니다.");
  if (p.status !== "active" && p.status !== "suspended")
    throw new HttpsError("invalid-argument", "상태는 active 또는 suspended 여야 합니다.");

  const ref = firestore.doc(`tenants/${tenantId}`);
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "회사를 찾을 수 없습니다.");
    tx.update(ref, { status: p.status });
  });
  return {};
});
```

- [ ] **Step 4: `index.ts` 등록** — `export { setTenantStatus } from "./setTenantStatus";`
- [ ] **Step 5: GREEN + `npm run test:all` + 커밋** `feat: setTenantStatus + 전체 생애주기 통합 검증`

---

## Codex 리뷰 반영 이력 (2026-08-17, P0 4건)

| # | 지적 | 반영 |
|---|---|---|
| P0-1 | Task 2~5 함수의 `index.ts` 등록 지시가 없음 — 구현해도 호출 불가 | 각 Task 에 등록 Step 명시 |
| P0-2 | `assertValidBranchNames` 가 빈 배열을 거부하므로 `[]` 회수가 불가능한데 계획은 "허용"이라 씀 — **구성원 제거 없이는 권한 회수 불가** | Task 2 — 빈 배열 별도 분기 + 회수 양성 테스트 |
| P0-3 | `updateMember` 의 지점 사용성 확인이 트랜잭션 밖 — 동시 비활성화와 경쟁 시 비활성 지점 권한 부여 | Task 2 — 부여 대상 지점을 **트랜잭션 안 tx.get** 으로 확인(충돌 시 재시도). createInvite 는 스냅샷 성격상 밖 유지 + 잔여 경쟁 창 수용 명시 |
| P0-4 | 규칙 쓰기 폐쇄가 깨뜨리는 기존 테스트 중 `I-2 대조군` 양성 테스트를 계획이 누락 | Task 4 Step 2 에 삭제 대상으로 명시 + 재작성 후 grep 전수 확인 |

Codex 가 함께 확증한 것: `consumedAt: null` 저장 전제 참 / removeMember 트랜잭션 읽기-쓰기 순서 정상 / **두 관리자가 서로를 동시에 강등하는 경쟁은 안전** — 두 트랜잭션 모두 두 관리자 문서를 읽으므로 한쪽이 반드시 충돌·재시도 후 마지막 관리자 보호에 걸린다.

---

## 자체 점검 결과

- §3.5 대조: `updateMember`·`setTenantStatus` 구현으로 **외부 의존 없는 서버 함수 전부 완료**. 남는 것은 계획 6의 인증 3종뿐
- `revokeInvite`·`removeMember`·`createBranch`·`setBranchActive` 는 §3.5 밖이지만 계획 2·3 리뷰가 도출한 필수 통로 — §3.3 "막은 것과 뚫어준 것이 짝이 맞는가" 원칙의 적용
- 타입 일관성: `updateMember` 의 `salaryBranchesEncoded` 는 규칙(`gradeAllowed`)이 읽는 그 이름. Task 5 생애주기가 실행으로 대조
- 계획 2 deferred(`no_tenant` 이중 의미): `removeMember` 가 3문서를 원자 삭제하므로 반쯤 만들어진 상태의 도달 가능성이 더 줄었다 — 상태코드 분리는 화면 계획으로 재이월
- 계획 3 deferred(고아 member ALREADY_EXISTS): 원자 삭제로 도달 불가 — 5번째 tx.get 불필요로 판정
