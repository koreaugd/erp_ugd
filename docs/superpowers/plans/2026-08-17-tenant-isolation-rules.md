# 회사 격리 보안규칙 + 자동 테스트 구현 계획 (계획 1/N)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회사(테넌트) 간 데이터 격리를 강제하는 Firestore 보안규칙을 작성하고, 그것이 실제로 막는다는 것을 증명하는 자동 테스트 36종을 통과시킨다.

**Architecture:** 앱 코드는 **한 줄도 건드리지 않는다.** Firestore 에뮬레이터 위에서 규칙과 테스트만 만든다. 클라우드 자원(Firebase 프로젝트·GitHub 저장소)도 필요 없다 — 전부 로컬 에뮬레이터에서 돈다. 따라서 이 계획을 실행하는 동안 **UGD 운영에 미치는 영향은 0**이다. 설계서의 "안전망을 먼저 만들고 그다음 위험한 변경을 한다" 순서를 그대로 따른다.

**Tech Stack:** Firestore Security Rules v2 / Firebase Emulator Suite / `@firebase/rules-unit-testing` / Vitest / Node.js

**Spec:** `docs/superpowers/specs/2026-08-17-multi-tenant-erp-design.md`

---

## 사전 준비 (사람이 해야 하는 일)

이 계획은 아래 두 가지가 갖춰져야 시작할 수 있다. **Task 1의 Step 1에서 확인한다.**

### 1. Java (JDK 11 이상) 설치 — 필수

Firestore 에뮬레이터는 Java 프로그램이다. **없으면 이 계획의 모든 테스트를 실행할 수 없다.**
현재 이 PC에는 설치돼 있지 않은 것을 확인했다(2026-08-17).

```powershell
winget install --id EclipseAdoptium.Temurin.21.JDK -e
```

설치 후 **새 터미널**에서 `java -version` 이 버전을 출력해야 한다.

### 2. 작업 폴더 결정

이 계획의 산출물은 **새 제품 저장소**에 들어간다. `erp_ugd`에 넣지 않는다.

- 기본값: `c:\Users\yulte\OneDrive\바탕 화면\UGD\erp_saas`
- 다른 위치를 원하면 아래 모든 경로에서 `erp_saas`를 바꿔 읽는다
- 이 폴더는 Claude Code의 작업 디렉터리로 추가돼 있어야 한다

---

## Global Constraints

설계서의 전 구간 제약. **모든 Task의 요구사항에 암묵적으로 포함된다.**

- **불변식 1** — A사 계정으로 B사 데이터를 읽거나 쓸 수 없다
- **불변식 2** — 소속·권한·본인확인 상태는 **클라이언트가 쓸 수 없다.** 서버만 쓴다
- **불변식 3** — 정지된 회사(`status != 'active'`)는 **어떤 데이터도** 읽거나 쓸 수 없다 (최고관리자의 회사 메타 읽기만 예외)
- **포괄 규칙 금지** — `match /tenants/{t}/{document=**}` 같은 규칙을 쓰지 않는다. 컬렉션별 명시 규칙만 쓴다
- **collection group 쿼리 금지** — 규칙에 허용을 넣지 않는다
- **규칙은 URL 디코딩을 하지 않는다** — 지점명은 `encodeURIComponent`된 값끼리 비교한다
- **급여는 지점 권한과 별개 축** — `branchIsolation` 스위치와 무관하게 항상 적용된다
- **`_all--salary--`는 존재 자체를 인정하지 않는다** — 읽기·쓰기·수정·삭제 전부 거부
- 문서ID 규약: 범위키로 시작, 뒤에 더 있으면 `--`로 연결. `shared_data`와 그 백업은 **`<범위키>--<등급>--<키>` 3칸 필수**
- 예약어: `_all`, `_admin`은 지점명으로 쓸 수 없다

---

## File Structure

| 파일 | 책임 |
|---|---|
| `firestore.rules` | 보안규칙 전문. 이 계획의 주 산출물 |
| `firebase.json` | 에뮬레이터 설정 (포트·규칙 파일 위치) |
| `package.json` | 테스트 스크립트·개발 의존성 |
| `vitest.config.ts` | Vitest 설정 (테스트 대상 경로·타임아웃) |
| `tests/rules/helpers.ts` | 테스트 공용 도구 — 테넌트/구성원 시드, 인증 컨텍스트 생성 |
| `tests/rules/accounts.test.ts` | 계정·소속 규칙 테스트 (#2,3,4,5,6,7,13,14,15,16,17,18,19) |
| `tests/rules/shared-data.test.ts` | 범위키·등급 판정 테스트 (#23~24c, 28~31, 32,33,34,34a,34b,34c,35,36) |
| `tests/rules/collections.test.ts` | 나머지 컬렉션·격리 전반 테스트 (#1,8,9,10,11,12,20,21,22,25,26,27) |

**분리 기준**: 테스트를 규칙 조항의 성격별로 나눈다. 한 파일이 한 종류의 규칙을 검증하므로, 규칙을 고칠 때 어느 테스트 파일을 봐야 하는지가 자명하다.

---

### Task 1: 테스트 환경 구축 및 하네스 검증

**목표**: 에뮬레이터 위에서 보안규칙 테스트가 실제로 돌아간다는 것을 **현행 규칙으로 먼저 증명**한다. 새 규칙을 쓰기 전에 하네스가 믿을 만한지부터 확인한다.

**Files:**
- Create: `c:\Users\yulte\OneDrive\바탕 화면\UGD\erp_saas\` (전체 폴더)
- Create: `firebase.json`
- Create: `vitest.config.ts`
- Create: `tests/rules/helpers.ts`
- Create: `tests/rules/smoke.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: 없음 (첫 과제)
- Produces:
  - `tests/rules/helpers.ts` 에서 내보내는 것:
    - `getTestEnv(): Promise<RulesTestEnvironment>` — 에뮬레이터 환경 (모듈 내 싱글턴)
    - `authed(uid: string, opts?: { email?: string; emailVerified?: boolean }): Firestore` — 로그인 상태 컨텍스트
    - `unauthed(): Firestore` — 비로그인 컨텍스트
    - `seed(fn: (db: Firestore) => Promise<void>): Promise<void>` — 규칙을 우회해 사전 데이터를 심는다
    - `clear(): Promise<void>` — 모든 문서 삭제

- [ ] **Step 1: 사전 준비 확인**

Run:
```bash
java -version
node --version
```

Expected:
- `java -version` 이 `openjdk version "21..."` 처럼 버전을 출력한다
- **`command not found` 가 나오면 여기서 중단한다.** 위 "사전 준비" 절의 winget 명령으로 JDK를 설치하고 **새 터미널**에서 다시 시작한다. Java 없이는 이후 모든 Step이 실패한다.
- `node --version` 이 v20 이상

- [ ] **Step 2: 새 작업 폴더 생성 및 현행 규칙 복사**

```bash
mkdir -p "c:/Users/yulte/OneDrive/바탕 화면/UGD/erp_saas"
cd "c:/Users/yulte/OneDrive/바탕 화면/UGD/erp_saas"
git init
cp "c:/Users/yulte/OneDrive/바탕 화면/UGD/erp_ugd/firestore.rules" ./firestore.rules
mkdir -p tests/rules
```

`firestore.rules`만 가져온다. 앱 소스는 이 계획에서 쓰지 않는다.

- [ ] **Step 3: package.json 생성**

Create `package.json`:

```json
{
  "name": "erp-saas-rules",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "test:rules": "firebase emulators:exec --only firestore --project demo-erp-saas \"vitest run\"",
    "test:rules:watch": "firebase emulators:exec --only firestore --project demo-erp-saas \"vitest\""
  }
}
```

`--project demo-erp-saas` 의 `demo-` 접두사가 중요하다. Firebase는 이 접두사가 붙은 프로젝트 ID를 **가짜(에뮬레이터 전용)** 로 취급해서, 실수로 실제 클라우드에 붙는 일이 없다.

- [ ] **Step 4: 의존성 설치**

```bash
npm install --save-dev firebase-tools vitest @firebase/rules-unit-testing firebase
```

버전은 고정하지 않는다 — 설치 결과가 `package.json`에 기록된다.

- [ ] **Step 5: firebase.json 생성**

Create `firebase.json`:

```json
{
  "firestore": {
    "rules": "firestore.rules"
  },
  "emulators": {
    "firestore": {
      "port": 8080
    },
    "ui": {
      "enabled": false
    },
    "singleProjectMode": true
  }
}
```

`erp_ugd`의 `firebase.json`은 `firestore`가 **배열**이고 named DB(`ai-studio-...`)를 가리킨다.
설계서 §3.1대로 **새 제품은 `(default)` DB 하나만** 쓰므로 여기서는 객체 형태로 쓴다.
(이 차이가 메모리 `erp_firestore_rules_deploy_trap`의 "규칙이 조용히 안 올라가는" 함정을 구조적으로 없앤다.)

- [ ] **Step 6: vitest.config.ts 생성**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/rules/**/*.test.ts'],
    // 에뮬레이터 기동 직후 첫 요청이 느릴 수 있다.
    testTimeout: 20000,
    hookTimeout: 30000,
    // 같은 에뮬레이터 인스턴스를 여러 파일이 동시에 쓰면 서로의 시드 데이터를 지운다.
    // 파일을 순차 실행해 격리한다.
    fileParallelism: false,
  },
});
```

- [ ] **Step 7: 테스트 공용 도구 작성**

Create `tests/rules/helpers.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';

let env: RulesTestEnvironment | null = null;

export async function getTestEnv(): Promise<RulesTestEnvironment> {
  if (env) return env;
  env = await initializeTestEnvironment({
    projectId: 'demo-erp-saas',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'),
    },
  });
  return env;
}

/** 로그인한 사용자의 Firestore. 규칙이 그대로 적용된다. */
export async function authed(
  uid: string,
  opts: { email?: string; emailVerified?: boolean } = {},
): Promise<Firestore> {
  const e = await getTestEnv();
  return e
    .authenticatedContext(uid, {
      email: opts.email,
      email_verified: opts.emailVerified ?? false,
    })
    .firestore() as unknown as Firestore;
}

/** 로그인하지 않은 Firestore. */
export async function unauthed(): Promise<Firestore> {
  const e = await getTestEnv();
  return e.unauthenticatedContext().firestore() as unknown as Firestore;
}

/**
 * 규칙을 무시하고 사전 데이터를 심는다.
 * 서버(Admin SDK)가 쓰는 문서(users·members·tenants 등)를 준비할 때 쓴다 —
 * 이 문서들은 클라이언트가 쓸 수 없는 것이 정상이므로(불변식 2),
 * 규칙을 거치는 경로로는 애초에 심을 수 없다.
 */
export async function seed(
  fn: (db: Firestore) => Promise<void>,
): Promise<void> {
  const e = await getTestEnv();
  await e.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore() as unknown as Firestore);
  });
}

/** 테스트 간 데이터 격리. 각 테스트 시작 전에 부른다. */
export async function clear(): Promise<void> {
  const e = await getTestEnv();
  await e.clearFirestore();
}
```

- [ ] **Step 8: 하네스 검증용 스모크 테스트 작성**

Create `tests/rules/smoke.test.ts`:

```typescript
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { authed, unauthed, seed, clear, getTestEnv } from './helpers';

describe('하네스 검증 (현행 규칙 기준)', () => {
  beforeEach(async () => {
    await clear();
  });

  afterAll(async () => {
    const e = await getTestEnv();
    await e.cleanup();
  });

  it('비로그인은 업무 데이터를 읽지 못한다', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'daily_settles', 'seed-doc'), { master: {} });
    });

    const db = await unauthed();
    await assertFails(getDoc(doc(db, 'daily_settles', 'seed-doc')));
  });

  it('seed()는 규칙을 우회해 문서를 만든다', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users', 'u1'), { role: 'branch' });
    });

    const db = await authed('u1');
    await assertSucceeds(getDoc(doc(db, 'users', 'u1')));
  });

  it('규칙에 없는 컬렉션은 거부된다', async () => {
    const db = await authed('u1');
    await assertFails(
      setDoc(doc(db, 'no_such_collection', 'x'), { a: 1 }),
    );
  });
});
```

이 세 개가 통과하면 **하네스가 신뢰할 만하다**는 뜻이다: 거부도 잡히고, 허용도 잡히고, 시드도 된다.
거부 테스트만 통과하고 허용 테스트가 실패하면 하네스가 전부 막고 있는 것이므로 뒤 과제가 전부 무의미해진다.

- [ ] **Step 9: 테스트 실행 — 통과 확인**

Run:
```bash
npm run test:rules
```

Expected: 3 passed.

실패 시 진단 순서:
1. `java: command not found` → JDK 미설치 (Step 1)
2. `Error: Could not start Firestore Emulator` + 포트 메시지 → 8080 포트 사용 중. `firebase.json`의 포트를 8081로 바꾸고 `helpers.ts`의 `port`도 함께 바꾼다
3. `FIREBASE_EMULATOR_HUB` 관련 오류 → `emulators:exec` 없이 `vitest`만 돌린 경우. 반드시 `npm run test:rules`로 실행한다

- [ ] **Step 10: .gitignore 작성 및 커밋**

Create `.gitignore`:

```
node_modules/
*.log
firebase-debug.log
firestore-debug.log
.firebase/
```

```bash
git add .gitignore package.json package-lock.json firebase.json vitest.config.ts firestore.rules tests/
git commit -F - <<'EOF'
test: Firestore 규칙 테스트 환경 구축

에뮬레이터 + Vitest + rules-unit-testing 하네스를 세우고,
현행 규칙으로 허용/거부/시드 세 경로가 모두 동작함을 확인했다.

앱 코드는 포함하지 않는다. 이 저장소는 아직 보안규칙만 다룬다.
EOF
```

---

### Task 2: 계정·소속 규칙

**목표**: 불변식 2(클라이언트는 소속·권한을 쓸 수 없다)를 규칙으로 못 박고, 그것을 증명하는 테스트를 통과시킨다. 설계서 §3.2·§3.3.

**Files:**
- Modify: `firestore.rules` (전면 재작성 시작)
- Create: `tests/rules/accounts.test.ts`
- Delete: `tests/rules/smoke.test.ts` (Task 1의 하네스 검증용. 역할을 다했고, 현행 규칙 전제라 새 규칙에서는 의미가 달라진다)

**Interfaces:**
- Consumes: `helpers.ts`의 `authed` / `unauthed` / `seed` / `clear` / `getTestEnv`
- Produces: `firestore.rules` 안의 공용 함수 — 이후 Task가 그대로 쓴다
  - `signedIn(): bool`
  - `hasUserDoc(): bool`
  - `myTenant(): string`
  - `tenantActive(t: string): bool`
  - `hasMember(t: string): bool`
  - `memberDoc(t: string): map`
  - `isPlatformAdmin(): bool`
  - `inTenant(t: string): bool`
  - `isTenantAdmin(t: string): bool`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/rules/accounts.test.ts`:

```typescript
import { beforeEach, afterAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { authed, seed, clear, getTestEnv } from './helpers';

/** A사 소속 활성 구성원 1명, B사 소속 활성 구성원 1명, 최고관리자 1명을 심는다. */
async function seedTwoTenants() {
  await seed(async (db) => {
    await setDoc(doc(db, 'tenants', 'T_A'), {
      companyName: 'A사', ownerUid: 'a_admin', status: 'active', branchIsolation: true,
    });
    await setDoc(doc(db, 'tenants', 'T_B'), {
      companyName: 'B사', ownerUid: 'b_admin', status: 'active', branchIsolation: true,
    });

    await setDoc(doc(db, 'users', 'a_user'), { tenantId: 'T_A' });
    await setDoc(doc(db, 'users', 'b_user'), { tenantId: 'T_B' });
    await setDoc(doc(db, 'users', 'root'), { tenantId: '' });

    await setDoc(doc(db, 'tenants', 'T_A', 'members', 'a_user'), {
      role: 'branch', status: 'active',
      allowedBranchesEncoded: ['%EA%B0%80%EA%B2%8C'], salaryBranchesEncoded: [],
    });
    await setDoc(doc(db, 'tenants', 'T_B', 'members', 'b_user'), {
      role: 'branch', status: 'active',
      allowedBranchesEncoded: ['%EB%82%98%EA%B0%80%EA%B2%8C'], salaryBranchesEncoded: [],
    });

    await setDoc(doc(db, 'platform_admins', 'root'), { grantedAt: '2026-08-17' });
  });
}

describe('계정·소속 규칙', () => {
  beforeEach(async () => {
    await clear();
    await seedTwoTenants();
  });

  afterAll(async () => {
    const e = await getTestEnv();
    await e.cleanup();
  });

  // #2 — 클라이언트가 users 문서를 생성할 수 없다 (남의 회사ID 지정 포함)
  it('#2 users 문서를 클라이언트가 생성할 수 없다', async () => {
    const db = await authed('intruder', { email: 'x@x.com', emailVerified: true });
    await assertFails(setDoc(doc(db, 'users', 'intruder'), { tenantId: 'T_A' }));
  });

  // #3 — tenantId / role 변경 불가
  it('#3 자기 users 문서의 tenantId를 바꿀 수 없다', async () => {
    const db = await authed('a_user');
    await assertFails(updateDoc(doc(db, 'users', 'a_user'), { tenantId: 'T_B' }));
  });

  it('#3 자기 members 문서의 role을 바꿀 수 없다', async () => {
    const db = await authed('a_user');
    await assertFails(
      updateDoc(doc(db, 'tenants', 'T_A', 'members', 'a_user'), { role: 'admin' }),
    );
  });

  // #4 — users 컬렉션 목록 조회 불가
  it('#4 users 컬렉션을 목록 조회할 수 없다', async () => {
    const db = await authed('a_user');
    await assertFails(getDocs(collection(db, 'users')));
  });

  it('#4 자기 users 문서는 읽을 수 있다', async () => {
    const db = await authed('a_user');
    await assertSucceeds(getDoc(doc(db, 'users', 'a_user')));
  });

  it('#4 남의 users 문서는 읽을 수 없다', async () => {
    const db = await authed('a_user');
    await assertFails(getDoc(doc(db, 'users', 'b_user')));
  });

  // #5 — 다른 회사 관리자가 members 조회 불가
  it('#5 B사 사람이 A사 members를 조회할 수 없다', async () => {
    const db = await authed('b_user');
    await assertFails(getDocs(collection(db, 'tenants', 'T_A', 'members')));
  });

  // #6 — phoneVerifiedAt 클라이언트 기록 불가
  it('#6 members의 phoneVerifiedAt을 클라이언트가 쓸 수 없다', async () => {
    const db = await authed('a_user');
    await assertFails(
      updateDoc(doc(db, 'tenants', 'T_A', 'members', 'a_user'), {
        phoneVerifiedAt: '2026-08-17T00:00:00Z',
      }),
    );
  });

  // #7 — platform_admins 자칭 불가
  it('#7 자기 platform_admins 문서를 만들 수 없다', async () => {
    const db = await authed('a_user');
    await assertFails(setDoc(doc(db, 'platform_admins', 'a_user'), { grantedAt: 'x' }));
  });

  it('#7 platform_admins 문서를 클라이언트가 읽을 수 없다', async () => {
    const db = await authed('root');
    await assertFails(getDoc(doc(db, 'platform_admins', 'root')));
  });

  // #13 — 초대 없이 소속 주장 불가 (users 문서가 없으면 아무것도 안 됨)
  it('#13 users 문서가 없는 계정은 회사 메타를 읽을 수 없다', async () => {
    const db = await authed('nobody', { email: 'n@n.com', emailVerified: true });
    await assertFails(getDoc(doc(db, 'tenants', 'T_A')));
  });

  // #14,15,16 — 초대 문서는 클라이언트가 읽지도 쓰지도 못한다
  //   (만료·단일사용·이메일검증은 서버 함수 redeemInvite의 책임이므로
  //    규칙 층위에서는 "클라이언트가 초대에 손댈 수 없다"만 보장한다)
  it('#14-16 초대 문서를 클라이언트가 읽을 수 없다', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'tenants', 'T_A', 'invites', 'inv1'), {
        emailLower: 'x@x.com', tokenHash: 'h', role: 'branch',
      });
    });
    const db = await authed('a_user');
    await assertFails(getDoc(doc(db, 'tenants', 'T_A', 'invites', 'inv1')));
  });

  it('#14-16 초대 문서를 클라이언트가 만들 수 없다', async () => {
    const db = await authed('a_user');
    await assertFails(
      setDoc(doc(db, 'tenants', 'T_A', 'invites', 'inv2'), { emailLower: 'y@y.com' }),
    );
  });

  it('#14-16 초대 문서를 클라이언트가 소비 표시할 수 없다', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'tenants', 'T_A', 'invites', 'inv3'), { emailLower: 'z@z.com' });
    });
    const db = await authed('a_user');
    await assertFails(
      updateDoc(doc(db, 'tenants', 'T_A', 'invites', 'inv3'), { consumedBy: 'a_user' }),
    );
  });

  // #17 — 이미 A사 소속인 사람이 B사 소속을 주장할 수 없다
  it('#17 이미 소속된 사람이 자기 users 문서로 다른 회사를 주장할 수 없다', async () => {
    const db = await authed('a_user');
    await assertFails(setDoc(doc(db, 'users', 'a_user'), { tenantId: 'T_B' }));
  });

  // #18 — signup_verifications 클라이언트 접근 불가
  it('#18 signup_verifications를 본인도 읽을 수 없다', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'signup_verifications', 'a_user'), {
        phone: '01000000000', phoneVerifiedAt: '2026-08-17T00:00:00Z',
      });
    });
    const db = await authed('a_user');
    await assertFails(getDoc(doc(db, 'signup_verifications', 'a_user')));
  });

  it('#18 signup_verifications를 본인도 쓸 수 없다', async () => {
    const db = await authed('a_user');
    await assertFails(
      setDoc(doc(db, 'signup_verifications', 'a_user'), {
        phoneVerifiedAt: '2026-08-17T00:00:00Z',
      }),
    );
  });

  // #19 — allowedBranchesEncoded 클라이언트 변경 불가
  it('#19 allowedBranchesEncoded를 클라이언트가 바꿀 수 없다', async () => {
    const db = await authed('a_user');
    await assertFails(
      updateDoc(doc(db, 'tenants', 'T_A', 'members', 'a_user'), {
        allowedBranchesEncoded: ['%EB%82%98%EA%B0%80%EA%B2%8C'],
      }),
    );
  });

  it('#19 salaryBranchesEncoded를 클라이언트가 바꿀 수 없다', async () => {
    const db = await authed('a_user');
    await assertFails(
      updateDoc(doc(db, 'tenants', 'T_A', 'members', 'a_user'), {
        salaryBranchesEncoded: ['%EA%B0%80%EA%B2%8C'],
      }),
    );
  });

  it('#19 members 문서를 클라이언트가 삭제할 수 없다', async () => {
    const db = await authed('a_user');
    await assertFails(deleteDoc(doc(db, 'tenants', 'T_A', 'members', 'a_user')));
  });

  // 본인 members 읽기는 되어야 한다 (통과 케이스)
  it('본인 members 문서는 읽을 수 있다', async () => {
    const db = await authed('a_user');
    await assertSucceeds(getDoc(doc(db, 'tenants', 'T_A', 'members', 'a_user')));
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npm run test:rules -- tests/rules/accounts.test.ts
```

Expected: 다수 FAIL. 현행 규칙에는 `tenants` / `members` / `signup_verifications` / `platform_admins` 컬렉션 자체가 없어서 `assertSucceeds`를 기대한 케이스가 깨진다.

- [ ] **Step 3: 규칙 재작성**

Replace `firestore.rules` entirely:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ========== 공용 판정 ==========

    function signedIn() {
      return request.auth != null;
    }

    function hasUserDoc() {
      return signedIn()
        && exists(/databases/$(database)/documents/users/$(request.auth.uid));
    }

    function myTenant() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.tenantId;
    }

    function tenantActive(t) {
      return exists(/databases/$(database)/documents/tenants/$(t))
        && get(/databases/$(database)/documents/tenants/$(t)).data.status == 'active';
    }

    function hasMember(t) {
      return signedIn()
        && exists(/databases/$(database)/documents/tenants/$(t)/members/$(request.auth.uid));
    }

    function memberDoc(t) {
      return get(/databases/$(database)/documents/tenants/$(t)/members/$(request.auth.uid)).data;
    }

    function isPlatformAdmin() {
      return signedIn()
        && exists(/databases/$(database)/documents/platform_admins/$(request.auth.uid));
    }

    // 업무 데이터 접근 자격.
    // 불변식 3: tenantActive 가 빠지면 정지된 회사가 계속 일할 수 있다.
    function inTenant(t) {
      return hasUserDoc()
        && myTenant() == t
        && tenantActive(t)
        && hasMember(t)
        && memberDoc(t).status == 'active';
    }

    function isTenantAdmin(t) {
      return inTenant(t) && memberDoc(t).role == 'admin';
    }

    // ========== 클라이언트 쓰기 금지 구역 (불변식 2) ==========
    //
    // 아래 컬렉션은 전부 서버(Admin SDK)만 쓴다.
    // 특히 users 는 "생성"까지 막아야 한다 — 수정만 막으면 가입 직후
    // 남의 회사ID로 처음 만들어 버리는 우회로가 열린다.

    match /users/{uid} {
      // 본인 문서만. 목록 조회는 규칙상 불가능하다
      // (list 는 모든 대상 문서가 조건을 만족해야 통과하는데, 남의 문서가 섞이면 실패한다).
      allow get: if signedIn() && request.auth.uid == uid;
      allow list: if false;
      allow write: if false;
    }

    match /signup_verifications/{uid} {
      // 본인조차 읽지 못한다. 서버만 쓰고 서버만 확인한다.
      allow read, write: if false;
    }

    match /platform_admins/{uid} {
      allow read, write: if false;
    }

    match /tenants/{t} {
      // 활성 회사의 소속 구성원, 또는 최고관리자(정지된 회사도 봐야 하므로 활성 조건 없음).
      allow get: if inTenant(t) || isPlatformAdmin();
      allow list: if false;
      allow write: if false;
    }

    match /tenants/{t}/members/{uid} {
      allow get: if inTenant(t) && (request.auth.uid == uid || isTenantAdmin(t));
      allow list: if isTenantAdmin(t);
      allow write: if false;
    }

    match /tenants/{t}/invites/{inviteId} {
      allow read, write: if false;
    }

    // ========== 그 밖의 모든 경로는 거부 ==========
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npm run test:rules -- tests/rules/accounts.test.ts
```

Expected: 전부 PASS.

`#5`(B사 사람이 A사 members 목록 조회)가 통과하지 않으면 `list` 규칙을 확인한다 — `isTenantAdmin('T_A')`는 B사 사람에게 거짓이므로 거부되어야 한다.

- [ ] **Step 5: 스모크 테스트 제거**

```bash
git rm tests/rules/smoke.test.ts
```

Task 1의 하네스 검증용이었고 현행 규칙을 전제하므로, 새 규칙에서는 의미가 달라진다. 역할을 다했다.

- [ ] **Step 6: 커밋**

```bash
git add firestore.rules tests/rules/accounts.test.ts
git commit -F - <<'EOF'
feat: 계정·소속 보안규칙 + 테스트

불변식 2를 규칙으로 못 박았다 — users/members/invites/
signup_verifications/platform_admins 는 클라이언트가 쓸 수 없다.

users 는 "생성"까지 막는다. 수정만 막으면 가입 직후 남의 회사ID로
처음 만들어 버리는 우회로가 남는다(설계서 §3.3).
EOF
```

---

### Task 3: 업무 데이터 규칙 — 범위키와 등급

**목표**: 설계서 §3.4의 통합 판정식(범위 × 등급)을 규칙으로 구현하고, 교차 6칸이 전부 정의됐음을 테스트로 증명한다.

**Files:**
- Modify: `firestore.rules`
- Create: `tests/rules/shared-data.test.ts`

**Interfaces:**
- Consumes: Task 2의 `inTenant(t)` / `isTenantAdmin(t)` / `memberDoc(t)`
- Produces: `firestore.rules` 안의 범위·등급 함수 — Task 4가 그대로 쓴다
  - `scopeOf(id: string): string` — 문서ID의 첫 칸
  - `gradeOf(id: string): string` — 문서ID의 둘째 칸
  - `sharedIdValid(id: string): bool` — 3칸 이상인지
  - `scopeAllowed(t: string, id: string, isWrite: bool): bool`
  - `gradeAllowed(t: string, id: string): bool`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/rules/shared-data.test.ts`:

```typescript
import { beforeEach, afterAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { authed, seed, clear, getTestEnv } from './helpers';

// 지점명 "가게" 를 encodeURIComponent 한 값
const GAGE = '%EA%B0%80%EA%B2%8C';
// 지점명 "나가게"
const NAGAGE = '%EB%82%98%EA%B0%80%EA%B2%8C';

/**
 * T_A(격리 켬) 에 네 사람:
 *   staff      — 가게 담당, 급여 권한 없음
 *   payroll    — 가게 담당, 가게 급여 권한 있음
 *   admin      — 관리자, 급여 권한 없음
 *   adminPay   — 관리자, _admin 급여 권한 있음
 * T_OFF(격리 끔) 에 한 사람:
 *   loose      — 담당 지점 목록 비어 있음, 급여 권한 없음
 */
async function seedTenant() {
  await seed(async (db) => {
    await setDoc(doc(db, 'tenants', 'T_A'), {
      companyName: 'A사', ownerUid: 'admin', status: 'active', branchIsolation: true,
    });
    await setDoc(doc(db, 'tenants', 'T_OFF'), {
      companyName: '격리끔사', ownerUid: 'loose', status: 'active', branchIsolation: false,
    });

    const members: Array<[string, string, Record<string, unknown>]> = [
      ['T_A', 'staff', { role: 'branch', status: 'active', allowedBranchesEncoded: [GAGE], salaryBranchesEncoded: [] }],
      ['T_A', 'payroll', { role: 'branch', status: 'active', allowedBranchesEncoded: [GAGE], salaryBranchesEncoded: [GAGE] }],
      ['T_A', 'admin', { role: 'admin', status: 'active', allowedBranchesEncoded: [], salaryBranchesEncoded: [] }],
      ['T_A', 'adminPay', { role: 'admin', status: 'active', allowedBranchesEncoded: [], salaryBranchesEncoded: ['_admin'] }],
      ['T_OFF', 'loose', { role: 'branch', status: 'active', allowedBranchesEncoded: [], salaryBranchesEncoded: [] }],
    ];

    for (const [tenant, uid, data] of members) {
      await setDoc(doc(db, 'users', uid), { tenantId: tenant });
      await setDoc(doc(db, 'tenants', tenant, 'members', uid), data);
    }

    // 미리 존재하는 문서들 (읽기 테스트용)
    await setDoc(doc(db, 'tenants', 'T_A', 'shared_data', `${GAGE}--gen--memo`), { v: 1 });
    await setDoc(doc(db, 'tenants', 'T_A', 'shared_data', `${GAGE}--salary--2026-08`), { v: 1 });
    await setDoc(doc(db, 'tenants', 'T_A', 'shared_data', `${NAGAGE}--salary--2026-08`), { v: 1 });
    await setDoc(doc(db, 'tenants', 'T_A', 'shared_data', '_all--gen--notice'), { v: 1 });
    await setDoc(doc(db, 'tenants', 'T_A', 'shared_data', '_admin--gen--config'), { v: 1 });
    await setDoc(doc(db, 'tenants', 'T_A', 'shared_data', '_admin--salary--total'), { v: 1 });
    // 있어서는 안 되는 조합 — 이주 사고를 흉내낸다
    await setDoc(doc(db, 'tenants', 'T_A', 'shared_data', '_all--salary--leak'), { v: 1 });
    // 옛 형식 (등급 칸 없음)
    await setDoc(doc(db, 'tenants', 'T_A', 'shared_data', 'legacykey'), { v: 1 });
    await setDoc(doc(db, 'tenants', 'T_A', 'shared_data', `${GAGE}--twoonly`), { v: 1 });

    await setDoc(doc(db, 'tenants', 'T_OFF', 'shared_data', `${GAGE}--gen--memo`), { v: 1 });
    await setDoc(doc(db, 'tenants', 'T_OFF', 'shared_data', `${GAGE}--salary--2026-08`), { v: 1 });
  });
}

const sd = (db: any, t: string, id: string) => doc(db, 'tenants', t, 'shared_data', id);

describe('shared_data 범위키 × 등급 판정', () => {
  beforeEach(async () => {
    await clear();
    await seedTenant();
  });

  afterAll(async () => {
    const e = await getTestEnv();
    await e.cleanup();
  });

  // ---------- _all ----------
  it('#23 지점 구성원이 _all--gen-- 을 쓸 수 없다', async () => {
    const db = await authed('staff');
    await assertFails(setDoc(sd(db, 'T_A', '_all--gen--notice2'), { v: 1 }));
  });

  it('#23a 지점 구성원이 _all--gen-- 을 읽을 수 있다', async () => {
    const db = await authed('staff');
    await assertSucceeds(getDoc(sd(db, 'T_A', '_all--gen--notice')));
  });

  it('#23b 관리자가 _all--gen-- 을 쓸 수 있다', async () => {
    const db = await authed('admin');
    await assertSucceeds(setDoc(sd(db, 'T_A', '_all--gen--notice2'), { v: 1 }));
  });

  // ---------- _admin ----------
  it('#24 지점 구성원이 _admin--gen-- 을 읽을 수 없다', async () => {
    const db = await authed('staff');
    await assertFails(getDoc(sd(db, 'T_A', '_admin--gen--config')));
  });

  it('#24a 관리자가 _admin--gen-- 을 읽고 쓸 수 있다', async () => {
    const db = await authed('admin');
    await assertSucceeds(getDoc(sd(db, 'T_A', '_admin--gen--config')));
    await assertSucceeds(setDoc(sd(db, 'T_A', '_admin--gen--config2'), { v: 1 }));
  });

  it('#24b 급여 권한 없는 관리자는 _admin--salary-- 를 읽을 수 없다', async () => {
    const db = await authed('admin');
    await assertFails(getDoc(sd(db, 'T_A', '_admin--salary--total')));
  });

  it('#24c salaryBranchesEncoded에 _admin이 있는 관리자는 읽을 수 있다', async () => {
    const db = await authed('adminPay');
    await assertSucceeds(getDoc(sd(db, 'T_A', '_admin--salary--total')));
  });

  // ---------- 지점 × 급여 ----------
  it('#28 담당 지점이지만 급여 권한이 없으면 salary 를 못 읽는다', async () => {
    const db = await authed('staff');
    await assertFails(getDoc(sd(db, 'T_A', `${GAGE}--salary--2026-08`)));
  });

  it('#29 급여 권한자가 담당 외 지점의 salary 를 못 읽는다', async () => {
    const db = await authed('payroll');
    await assertFails(getDoc(sd(db, 'T_A', `${NAGAGE}--salary--2026-08`)));
  });

  it('#30 급여 권한 없는 관리자는 _admin--salary-- 를 못 읽는다', async () => {
    const db = await authed('admin');
    await assertFails(getDoc(sd(db, 'T_A', '_admin--salary--total')));
  });

  it('#31 담당 지점 + 급여 권한이면 읽을 수 있다', async () => {
    const db = await authed('payroll');
    await assertSucceeds(getDoc(sd(db, 'T_A', `${GAGE}--salary--2026-08`)));
  });

  // ---------- 형식 ----------
  it('#32 등급 칸이 없는 옛 형식은 거부된다', async () => {
    const db = await authed('admin');
    await assertFails(getDoc(sd(db, 'T_A', 'legacykey')));
  });

  it('#33 2칸 형식(등급 칸 없음)은 거부된다', async () => {
    const db = await authed('staff');
    await assertFails(getDoc(sd(db, 'T_A', `${GAGE}--twoonly`)));
  });

  // ---------- _all × salary : 존재 자체를 인정하지 않는다 ----------
  it('#34 _all--salary-- 를 생성할 수 없다', async () => {
    const db = await authed('admin');
    await assertFails(setDoc(sd(db, 'T_A', '_all--salary--new'), { v: 1 }));
  });

  it('#34a 이미 존재하는 _all--salary-- 를 구성원이 읽을 수 없다', async () => {
    const db = await authed('staff');
    await assertFails(getDoc(sd(db, 'T_A', '_all--salary--leak')));
  });

  it('#34a 이미 존재하는 _all--salary-- 를 관리자도 읽을 수 없다', async () => {
    const db = await authed('adminPay');
    await assertFails(getDoc(sd(db, 'T_A', '_all--salary--leak')));
  });

  it('#34b 이미 존재하는 _all--salary-- 를 수정할 수 없다', async () => {
    const db = await authed('admin');
    await assertFails(updateDoc(sd(db, 'T_A', '_all--salary--leak'), { v: 2 }));
  });

  it('#34b 이미 존재하는 _all--salary-- 를 삭제할 수 없다', async () => {
    const db = await authed('admin');
    await assertFails(deleteDoc(sd(db, 'T_A', '_all--salary--leak')));
  });

  it('#34c salaryBranchesEncoded 에 _all 이 있어도 거부된다', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'tenants', 'T_A', 'members', 'sneaky'), {
        role: 'branch', status: 'active',
        allowedBranchesEncoded: [GAGE], salaryBranchesEncoded: ['_all'],
      });
      await setDoc(doc(db, 'users', 'sneaky'), { tenantId: 'T_A' });
    });
    const db = await authed('sneaky');
    await assertFails(getDoc(sd(db, 'T_A', '_all--salary--leak')));
  });

  // ---------- branchIsolation = false ----------
  it('#35 격리가 꺼져 있어도 급여 권한 없으면 salary 를 못 읽는다', async () => {
    const db = await authed('loose');
    await assertFails(getDoc(sd(db, 'T_OFF', `${GAGE}--salary--2026-08`)));
  });

  it('#35 격리가 꺼져 있으면 담당 목록이 비어도 gen 은 읽는다', async () => {
    const db = await authed('loose');
    await assertSucceeds(getDoc(sd(db, 'T_OFF', `${GAGE}--gen--memo`)));
  });

  // ---------- 관리자 범위 통과 ----------
  it('#36 관리자는 담당 지점 목록이 비어도 지점 gen 을 읽는다', async () => {
    const db = await authed('admin');
    await assertSucceeds(getDoc(sd(db, 'T_A', `${GAGE}--gen--memo`)));
  });

  // ---------- 지점 격리 ----------
  it('담당 외 지점의 gen 은 못 읽는다 (격리 켬)', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'tenants', 'T_A', 'shared_data', `${NAGAGE}--gen--memo`), { v: 1 });
    });
    const db = await authed('staff');
    await assertFails(getDoc(sd(db, 'T_A', `${NAGAGE}--gen--memo`)));
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx firebase emulators:exec --only firestore --project demo-erp-saas "vitest run tests/rules/shared-data.test.ts"
```

Expected: 전부 FAIL. `shared_data` 규칙이 아직 없어서 마지막 `match /{document=**}`의 거부에 걸린다 — `assertSucceeds`를 기대한 케이스들이 실패한다.

- [ ] **Step 3: 범위·등급 함수와 shared_data 규칙 추가**

`firestore.rules`의 `isTenantAdmin(t)` 함수 **바로 아래**에 추가:

```
    // ========== 범위키 / 등급 (설계서 §3.4) ==========
    //
    // 문서ID = <범위키>--<등급>--<키>
    // 규칙에는 URL 디코딩 기능이 없다. 인코딩된 값끼리 비교한다.

    function idParts(id) {
      return id.split('--');
    }

    function scopeOf(id) {
      return idParts(id)[0];
    }

    function gradeOf(id) {
      return idParts(id)[1];
    }

    // shared_data 는 등급 칸이 필수라 최소 3칸이어야 한다.
    // 옛 2칸/1칸 형식은 여기서 걸러진다(이주 누락 탐지).
    function sharedIdValid(id) {
      return idParts(id).size() >= 3;
    }

    // ① 범위 통과
    function scopeAllowed(t, id, isWrite) {
      return scopeOf(id) == '_admin'
        ? isTenantAdmin(t)
        : (scopeOf(id) == '_all'
            ? (isWrite ? isTenantAdmin(t) : inTenant(t))
            : (isTenantAdmin(t)
                || !get(/databases/$(database)/documents/tenants/$(t)).data.branchIsolation
                || scopeOf(id) in memberDoc(t).get('allowedBranchesEncoded', [])));
    }

    // ② 등급 통과
    // _all--salary-- 는 동작 종류와 무관하게 거부한다.
    // "생성 금지"만으로는 이미 만들어진 문서를 읽는 것을 못 막는다.
    function gradeAllowed(t, id) {
      return gradeOf(id) == 'salary'
        ? (scopeOf(id) != '_all'
            && scopeOf(id) in memberDoc(t).get('salaryBranchesEncoded', []))
        : true;
    }
```

그리고 `match /tenants/{t}/invites/{inviteId}` **아래**, 포괄 거부 규칙 **위**에 추가:

```
    match /tenants/{t}/shared_data/{id} {
      allow get: if inTenant(t) && sharedIdValid(id)
        && scopeAllowed(t, id, false) && gradeAllowed(t, id);
      // 목록 조회는 대상 문서마다 판정이 갈리므로 규칙으로 안전하게 열 수 없다.
      // 필요한 화면은 문서ID를 알고 개별 조회한다.
      allow list: if false;
      allow create, update, delete: if inTenant(t) && sharedIdValid(id)
        && scopeAllowed(t, id, true) && gradeAllowed(t, id);
    }
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx firebase emulators:exec --only firestore --project demo-erp-saas "vitest run tests/rules/shared-data.test.ts"
```

Expected: 전부 PASS.

`#35`(격리 끔 + 급여)가 실패하면 `gradeAllowed`가 `branchIsolation` 분기 안에 들어간 것이다 — 등급은 격리와 **무관하게** 항상 적용돼야 한다. `scopeAllowed`와 `gradeAllowed`를 `&&`로 나란히 두었는지 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add firestore.rules tests/rules/shared-data.test.ts
git commit -F - <<'EOF'
feat: shared_data 범위키 × 등급 판정 규칙

범위(_all/_admin/지점)와 등급(gen/salary) 두 축을 하나의 판정으로
합쳤다. 교차 6칸을 전부 테스트로 덮는다.

_all--salary-- 는 생성뿐 아니라 읽기·수정·삭제까지 거부한다.
생성만 막으면 이주 사고로 한 번 생긴 문서를 못 막는다(설계서 §3.4).
EOF
```

---

### Task 4: 나머지 컬렉션 규칙과 회사 격리 전반

**목표**: `daily_settles` 등 남은 업무 컬렉션에 같은 판정을 적용하고, 회사 격리·정지·최고관리자 규칙을 테스트로 확정한다.

**Files:**
- Modify: `firestore.rules`
- Create: `tests/rules/collections.test.ts`

**Interfaces:**
- Consumes: Task 2의 `inTenant`/`isTenantAdmin`/`isPlatformAdmin`, Task 3의 `scopeOf`/`scopeAllowed`
- Produces: 완성된 `firestore.rules` (이후 계획에서 실제 프로젝트에 배포)

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/rules/collections.test.ts`:

```typescript
import { beforeEach, afterAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, getDocs, collectionGroup, query } from 'firebase/firestore';
import { authed, unauthed, seed, clear, getTestEnv } from './helpers';

const GAGE = '%EA%B0%80%EA%B2%8C';
const NAGAGE = '%EB%82%98%EA%B0%80%EA%B2%8C';

async function seedAll() {
  await seed(async (db) => {
    await setDoc(doc(db, 'tenants', 'T_A'), {
      companyName: 'A사', ownerUid: 'a_admin', status: 'active', branchIsolation: true,
    });
    await setDoc(doc(db, 'tenants', 'T_B'), {
      companyName: 'B사', ownerUid: 'b_admin', status: 'active', branchIsolation: true,
    });
    await setDoc(doc(db, 'tenants', 'T_SUS'), {
      companyName: '정지사', ownerUid: 's_user', status: 'suspended', branchIsolation: false,
    });

    const people: Array<[string, string, Record<string, unknown>]> = [
      ['T_A', 'a_user', { role: 'branch', status: 'active', allowedBranchesEncoded: [GAGE], salaryBranchesEncoded: [] }],
      ['T_A', 'a_admin', { role: 'admin', status: 'active', allowedBranchesEncoded: [], salaryBranchesEncoded: [] }],
      ['T_A', 'a_frozen', { role: 'branch', status: 'suspended', allowedBranchesEncoded: [GAGE], salaryBranchesEncoded: [] }],
      ['T_B', 'b_user', { role: 'branch', status: 'active', allowedBranchesEncoded: [NAGAGE], salaryBranchesEncoded: [] }],
      ['T_SUS', 's_user', { role: 'admin', status: 'active', allowedBranchesEncoded: [], salaryBranchesEncoded: [] }],
    ];
    for (const [t, uid, data] of people) {
      await setDoc(doc(db, 'users', uid), { tenantId: t });
      await setDoc(doc(db, 'tenants', t, 'members', uid), data);
    }

    await setDoc(doc(db, 'users', 'root'), { tenantId: '' });
    await setDoc(doc(db, 'platform_admins', 'root'), { grantedAt: '2026-08-17' });

    // 업무 문서
    for (const t of ['T_A', 'T_B', 'T_SUS']) {
      await setDoc(doc(db, 'tenants', t, 'daily_settles', `${GAGE}--2026-08-01`), { master: {} });
      await setDoc(doc(db, 'tenants', t, 'staff_rosters', GAGE), { employees: [] });
      await setDoc(doc(db, 'tenants', t, 'branch_own_rosters', GAGE), { employees: [] });
      await setDoc(doc(db, 'tenants', t, 'settings', GAGE), { brand: 'x' });
      await setDoc(doc(db, 'tenants', t, 'public_branches', GAGE), { isActive: true });
      await setDoc(doc(db, 'tenants', t, 'edit_logs', `${GAGE}--log1`), { note: 'x' });
      await setDoc(doc(db, 'tenants', t, 'shared_data_backups', `${GAGE}--gen--memo--slot0`), { v: 1 });
    }
    await setDoc(doc(db, 'tenants', 'T_A', 'daily_settles', `${NAGAGE}--2026-08-01`), { master: {} });
  });
}

describe('컬렉션별 규칙과 회사 격리', () => {
  beforeEach(async () => {
    await clear();
    await seedAll();
  });

  afterAll(async () => {
    const e = await getTestEnv();
    await e.cleanup();
  });

  // #1 — A사 계정으로 B사 모든 컬렉션 접근
  // public_branches 는 이 배열에 넣지 않는다.
  // 회사 안에서는 담당 지점이 아니어도 읽혀야 하는 공용 목록이라(설계서 §3.4),
  // 지점 격리(#12) 기대값이 다른 컬렉션과 반대다. 아래에서 따로 다룬다.
  const collections = [
    ['daily_settles', `${GAGE}--2026-08-01`],
    ['staff_rosters', GAGE],
    ['branch_own_rosters', GAGE],
    ['settings', GAGE],
    ['edit_logs', `${GAGE}--log1`],
    ['shared_data_backups', `${GAGE}--gen--memo--slot0`],
  ] as const;

  for (const [coll, id] of collections) {
    it(`#1 A사 계정이 B사 ${coll} 를 읽을 수 없다`, async () => {
      const db = await authed('a_user');
      await assertFails(getDoc(doc(db, 'tenants', 'T_B', coll, id)));
    });

    it(`#1 A사 계정이 B사 ${coll} 에 쓸 수 없다`, async () => {
      const db = await authed('a_user');
      await assertFails(setDoc(doc(db, 'tenants', 'T_B', coll, id), { x: 1 }));
    });

    // #12 — 담당 외 지점 (격리 켬)
    it(`#12 담당 외 지점의 ${coll} 를 읽을 수 없다`, async () => {
      await seed(async (db) => {
        const otherId = id.replace(GAGE, NAGAGE);
        await setDoc(doc(db, 'tenants', 'T_A', coll, otherId), { x: 1 });
      });
      const db = await authed('a_user');
      await assertFails(getDoc(doc(db, 'tenants', 'T_A', coll, id.replace(GAGE, NAGAGE))));
    });

    // 담당 지점은 읽혀야 한다 (통과 케이스)
    it(`담당 지점의 ${coll} 는 읽을 수 있다`, async () => {
      const db = await authed('a_user');
      await assertSucceeds(getDoc(doc(db, 'tenants', 'T_A', coll, id)));
    });
  }

  // #8 — 최고관리자는 회사 하위 컬렉션을 볼 수 없다
  it('#8 최고관리자가 회사 daily_settles 를 읽을 수 없다', async () => {
    const db = await authed('root');
    await assertFails(getDoc(doc(db, 'tenants', 'T_A', 'daily_settles', `${GAGE}--2026-08-01`)));
  });

  // #9 — 정지된 회사
  it('#9 정지된 회사 구성원은 업무 데이터를 읽을 수 없다', async () => {
    const db = await authed('s_user');
    await assertFails(getDoc(doc(db, 'tenants', 'T_SUS', 'daily_settles', `${GAGE}--2026-08-01`)));
  });

  it('#9 정지된 회사 구성원은 업무 데이터를 쓸 수 없다', async () => {
    const db = await authed('s_user');
    await assertFails(setDoc(doc(db, 'tenants', 'T_SUS', 'staff_rosters', GAGE), { employees: [] }));
  });

  // #10 — 정지된 구성원
  it('#10 정지된 구성원은 접근할 수 없다', async () => {
    const db = await authed('a_frozen');
    await assertFails(getDoc(doc(db, 'tenants', 'T_A', 'daily_settles', `${GAGE}--2026-08-01`)));
  });

  // #11 — collection group 쿼리
  it('#11 collection group 쿼리는 거부된다', async () => {
    const db = await authed('a_user');
    await assertFails(getDocs(query(collectionGroup(db, 'staff_rosters'))));
  });

  it('#11 shared_data collection group 쿼리도 거부된다', async () => {
    const db = await authed('a_user');
    await assertFails(getDocs(query(collectionGroup(db, 'shared_data'))));
  });

  // #20 — 최고관리자의 회사 메타 읽기 (허용)
  it('#20 최고관리자는 회사 메타를 읽을 수 있다', async () => {
    const db = await authed('root');
    await assertSucceeds(getDoc(doc(db, 'tenants', 'T_A')));
  });

  // #25 — 정지된 회사 구성원의 메타 읽기 (거부)
  it('#25 정지된 회사 구성원은 회사 메타도 읽을 수 없다', async () => {
    const db = await authed('s_user');
    await assertFails(getDoc(doc(db, 'tenants', 'T_SUS')));
  });

  // #26 — 최고관리자의 정지 회사 메타 읽기 (허용)
  it('#26 최고관리자는 정지된 회사 메타를 읽을 수 있다', async () => {
    const db = await authed('root');
    await assertSucceeds(getDoc(doc(db, 'tenants', 'T_SUS')));
  });

  // #22 — 담당 목록이 빈 사람
  it('#22 담당 목록이 빈 사람은 지점 데이터에 접근할 수 없다 (격리 켬)', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users', 'empty'), { tenantId: 'T_A' });
      await setDoc(doc(db, 'tenants', 'T_A', 'members', 'empty'), {
        role: 'branch', status: 'active', allowedBranchesEncoded: [], salaryBranchesEncoded: [],
      });
    });
    const db = await authed('empty');
    await assertFails(getDoc(doc(db, 'tenants', 'T_A', 'daily_settles', `${GAGE}--2026-08-01`)));
  });

  // ---------- public_branches: 회사 공용 목록 ----------
  // 담당 지점이 아니어도 읽혀야 한다(지점 선택 드롭다운). 회사 경계는 그대로 지킨다.

  it('public_branches 는 소속 구성원이면 담당 외 지점도 읽는다', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'tenants', 'T_A', 'public_branches', NAGAGE), { isActive: true });
    });
    const db = await authed('a_user');
    await assertSucceeds(getDoc(doc(db, 'tenants', 'T_A', 'public_branches', NAGAGE)));
  });

  it('#1 다른 회사 사람은 public_branches 를 읽을 수 없다', async () => {
    const db = await authed('b_user');
    await assertFails(getDoc(doc(db, 'tenants', 'T_A', 'public_branches', GAGE)));
  });

  it('비로그인은 public_branches 를 읽을 수 없다', async () => {
    const db = await unauthed();
    await assertFails(getDoc(doc(db, 'tenants', 'T_A', 'public_branches', GAGE)));
  });

  it('지점 구성원은 public_branches 에 쓸 수 없다 (관리자만)', async () => {
    const db = await authed('a_user');
    await assertFails(setDoc(doc(db, 'tenants', 'T_A', 'public_branches', GAGE), { isActive: false }));
  });

  it('관리자는 public_branches 에 쓸 수 있다', async () => {
    const db = await authed('a_admin');
    await assertSucceeds(setDoc(doc(db, 'tenants', 'T_A', 'public_branches', GAGE), { isActive: false }));
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx firebase emulators:exec --only firestore --project demo-erp-saas "vitest run tests/rules/collections.test.ts"
```

Expected: 다수 FAIL — 해당 컬렉션 규칙이 아직 없다.

- [ ] **Step 3: 나머지 컬렉션 규칙 추가**

`match /tenants/{t}/shared_data/{id}` **아래**, 포괄 거부 규칙 **위**에 추가:

```
    // 지점 범위키로 판정하는 컬렉션들.
    // 문서ID 규약: 범위키로 시작, 뒤에 더 있으면 -- 로 연결.
    // (shared_data 와 달리 등급 칸이 없으므로 sharedIdValid 를 쓰지 않는다)

    match /tenants/{t}/daily_settles/{id} {
      allow get: if inTenant(t) && scopeAllowed(t, id, false);
      allow list: if false;
      allow create, update, delete: if inTenant(t) && scopeAllowed(t, id, true);
    }

    match /tenants/{t}/staff_rosters/{id} {
      allow get: if inTenant(t) && scopeAllowed(t, id, false);
      allow list: if false;
      allow create, update, delete: if inTenant(t) && scopeAllowed(t, id, true);
    }

    match /tenants/{t}/branch_own_rosters/{id} {
      allow get: if inTenant(t) && scopeAllowed(t, id, false);
      allow list: if false;
      allow create, update, delete: if inTenant(t) && scopeAllowed(t, id, true);
    }

    match /tenants/{t}/settings/{id} {
      allow get: if inTenant(t) && scopeAllowed(t, id, false);
      allow list: if false;
      allow create, update, delete: if isTenantAdmin(t);
    }

    match /tenants/{t}/edit_logs/{id} {
      allow get: if inTenant(t) && scopeAllowed(t, id, false);
      allow list: if false;
      allow create: if inTenant(t) && scopeAllowed(t, id, true);
      allow update, delete: if isTenantAdmin(t);
    }

    match /tenants/{t}/shared_data_backups/{id} {
      allow get: if inTenant(t) && sharedIdValid(id)
        && scopeAllowed(t, id, false) && gradeAllowed(t, id);
      allow list: if false;
      allow create, update, delete: if inTenant(t) && sharedIdValid(id)
        && scopeAllowed(t, id, true) && gradeAllowed(t, id);
    }

    // 회사 안에서 공용으로 쓰는 지점 목록. 담당 지점이 아니어도 읽힌다.
    // (지점 선택 드롭다운 등에 필요) 쓰기는 관리자만.
    match /tenants/{t}/public_branches/{id} {
      allow get, list: if inTenant(t);
      allow create, update, delete: if isTenantAdmin(t);
    }
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx firebase emulators:exec --only firestore --project demo-erp-saas "vitest run tests/rules/collections.test.ts"
```

Expected: 전부 PASS.

`#11`(collection group)이 실패하면, 규칙에 `match /{path=**}/staff_rosters/{id}` 같은 재귀 와일드카드가 들어간 것이다. 컬렉션 그룹 쿼리는 그런 규칙이 있어야만 통과하므로, **없어야 정상**이다.

- [ ] **Step 5: 커밋**

```bash
git add firestore.rules tests/rules/collections.test.ts
git commit -F - <<'EOF'
feat: 업무 컬렉션 규칙과 회사 격리 전반

daily_settles·rosters·settings·edit_logs·backups·public_branches 에
범위키 판정을 적용했다. 회사 정지·구성원 정지·최고관리자 경계·
collection group 거부까지 테스트로 확정한다.

포괄 규칙(match /{document=**})을 쓰지 않는다 — 급여 등급 같은
세밀한 제한이 무력화되기 때문이다(설계서 §3.4).
EOF
```

---

### Task 5: get() 호출 한도 검증과 최종 정리

**목표**: 규칙이 **실제 운영에서 동작 가능한지** 확인한다. Firestore는 규칙 하나를 판정하는 동안 다른 문서를 읽는 횟수를 제한하는데, 이 설계는 `users` → `tenants` → `members`를 연달아 읽으므로 한도에 걸릴 수 있다. 에뮬레이터에서 미리 확인한다.

**Files:**
- Create: `tests/rules/limits.test.ts`
- Modify: `firestore.rules` (한도 초과 시에만)
- Create: `README.md`

**Interfaces:**
- Consumes: 앞의 모든 규칙
- Produces: 검증 완료된 `firestore.rules` — 다음 계획에서 실제 Firebase 프로젝트에 배포한다

- [ ] **Step 1: 한도 검증 테스트 작성**

Create `tests/rules/limits.test.ts`:

```typescript
import { beforeEach, afterAll, describe, it } from 'vitest';
import { assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { authed, seed, clear, getTestEnv } from './helpers';

const GAGE = '%EA%B0%80%EA%B2%8C';

/**
 * Firestore 규칙은 한 번의 문서 요청을 판정하는 동안
 * 다른 문서를 읽는 횟수가 제한된다(단일 문서 요청 기준 10회).
 *
 * 이 설계의 판정 경로는 users → tenants → members 를 연달아 읽고,
 * scopeAllowed/gradeAllowed 안에서 tenants·members 를 다시 참조한다.
 * 한도를 넘으면 규칙이 아니라 "요청 실패"로 떨어지므로,
 * 정상 사용자가 정상 문서를 읽는 경로가 성공하는지로 확인한다.
 *
 * 실패하면 오류 메시지에 한도 관련 문구가 나온다.
 */
describe('규칙 판정 중 문서 읽기 한도', () => {
  beforeEach(async () => {
    await clear();
    await seed(async (db) => {
      await setDoc(doc(db, 'tenants', 'T_A'), {
        companyName: 'A사', ownerUid: 'admin', status: 'active', branchIsolation: true,
      });
      await setDoc(doc(db, 'users', 'payroll'), { tenantId: 'T_A' });
      await setDoc(doc(db, 'tenants', 'T_A', 'members', 'payroll'), {
        role: 'branch', status: 'active',
        allowedBranchesEncoded: [GAGE], salaryBranchesEncoded: [GAGE],
      });
      await setDoc(doc(db, 'tenants', 'T_A', 'shared_data', `${GAGE}--salary--2026-08`), { v: 1 });
      await setDoc(doc(db, 'tenants', 'T_A', 'shared_data', `${GAGE}--gen--memo`), { v: 1 });
    });
  });

  afterAll(async () => {
    const e = await getTestEnv();
    await e.cleanup();
  });

  // 가장 무거운 경로: 범위 판정 + 등급 판정이 둘 다 도는 급여 문서 읽기
  it('급여 문서 읽기가 한도에 걸리지 않는다', async () => {
    const db = await authed('payroll');
    await assertSucceeds(
      getDoc(doc(db, 'tenants', 'T_A', 'shared_data', `${GAGE}--salary--2026-08`)),
    );
  });

  it('일반 문서 읽기가 한도에 걸리지 않는다', async () => {
    const db = await authed('payroll');
    await assertSucceeds(
      getDoc(doc(db, 'tenants', 'T_A', 'shared_data', `${GAGE}--gen--memo`)),
    );
  });

  it('쓰기 경로도 한도에 걸리지 않는다', async () => {
    const db = await authed('payroll');
    await assertSucceeds(
      setDoc(doc(db, 'tenants', 'T_A', 'shared_data', `${GAGE}--gen--memo2`), { v: 1 }),
    );
  });
});
```

- [ ] **Step 2: 테스트 실행**

```bash
npx firebase emulators:exec --only firestore --project demo-erp-saas "vitest run tests/rules/limits.test.ts"
```

Expected: 3 passed.

**만약 실패하고 오류에 한도(`too many`/`exceeded`/`resource`) 관련 문구가 있으면** Step 3을 수행한다. 통과하면 Step 3을 건너뛴다.

- [ ] **Step 3: (한도 초과 시에만) 판정 경로 축약**

한도에 걸렸다면 같은 문서를 여러 번 읽는 것이 원인이다. `scopeAllowed`가 `tenants/{t}`를 다시 읽고 `memberDoc(t)`를 다시 부른다.

`firestore.rules`의 `scopeAllowed`를 아래처럼 바꿔, 필요한 값을 인자로 받게 한다:

```
    function scopeAllowed(t, id, isWrite, member, isolation, admin) {
      return scopeOf(id) == '_admin'
        ? admin
        : (scopeOf(id) == '_all'
            ? (isWrite ? admin : true)
            : (admin || !isolation
                || scopeOf(id) in member.get('allowedBranchesEncoded', [])));
    }

    function gradeAllowed(id, member) {
      return gradeOf(id) == 'salary'
        ? (scopeOf(id) != '_all'
            && scopeOf(id) in member.get('salaryBranchesEncoded', []))
        : true;
    }
```

호출부는 `match` 블록에서 값을 한 번만 읽어 넘긴다:

```
    match /tenants/{t}/shared_data/{id} {
      allow get: if inTenant(t) && sharedIdValid(id)
        && scopeAllowed(t, id, false, memberDoc(t),
             get(/databases/$(database)/documents/tenants/$(t)).data.branchIsolation,
             isTenantAdmin(t))
        && gradeAllowed(id, memberDoc(t));
      allow list: if false;
      allow create, update, delete: if inTenant(t) && sharedIdValid(id)
        && scopeAllowed(t, id, true, memberDoc(t),
             get(/databases/$(database)/documents/tenants/$(t)).data.branchIsolation,
             isTenantAdmin(t))
        && gradeAllowed(id, memberDoc(t));
    }
```

**⚠ 함수 서명이 바뀌므로 호출부를 전부 고쳐야 한다.** 안 고치면 규칙 컴파일이 실패한다.
고쳐야 할 `match` 블록은 아래 6개다 — Task 4에서 만든 것들이 `scopeAllowed(t, id, false)`
3인자 형태로 남아 있다.

| 블록 | 현재 호출 | 바꿀 호출 |
|---|---|---|
| `shared_data` | `scopeAllowed(t, id, X)` + `gradeAllowed(t, id)` | 위 예시대로 |
| `shared_data_backups` | `scopeAllowed(t, id, X)` + `gradeAllowed(t, id)` | 위 예시대로 |
| `daily_settles` | `scopeAllowed(t, id, X)` | `scopeAllowed(t, id, X, memberDoc(t), get(/databases/$(database)/documents/tenants/$(t)).data.branchIsolation, isTenantAdmin(t))` |
| `staff_rosters` | 〃 | 〃 |
| `branch_own_rosters` | 〃 | 〃 |
| `edit_logs` | 〃 | 〃 |

(`settings`와 `public_branches`는 `scopeAllowed`를 쓰지 않으므로 그대로 둔다.)

바꾼 뒤 **Task 2·3·4의 테스트를 전부 다시 돌려** 회귀가 없는지 확인한다:

```bash
npm run test:rules
```

Expected: 전부 PASS. 하나라도 실패하면 호출부 중 하나를 빠뜨린 것이다.

- [ ] **Step 4: 전체 테스트 실행 — 최종 확인**

```bash
npm run test:rules
```

Expected: 4개 파일 전부 PASS, 실패 0.

출력에서 **통과 케이스(assertSucceeds)가 실제로 존재하는지** 눈으로 확인한다. 거부 테스트만 통과하고 있으면 "전부 막는 규칙"이 만점을 받고 있는 것이므로, 규칙이 아니라 테스트가 잘못된 것이다.

- [ ] **Step 5: README 작성**

Create `README.md`:

```markdown
# ERP SaaS — 보안규칙

여러 회사가 함께 쓰는 ERP의 Firestore 보안규칙과 그 자동 테스트.

설계서: `../erp_ugd/docs/superpowers/specs/2026-08-17-multi-tenant-erp-design.md`

## 실행

    npm install
    npm run test:rules

**Java(JDK 11+)가 필요하다.** Firestore 에뮬레이터가 Java 프로그램이다.

    winget install --id EclipseAdoptium.Temurin.21.JDK -e

## 이 저장소가 지키는 것

1. A사 계정으로 B사 데이터를 읽거나 쓸 수 없다
2. 소속·권한·본인확인 상태는 클라이언트가 쓸 수 없다 — 서버만 쓴다
3. 정지된 회사는 어떤 데이터도 읽거나 쓸 수 없다
4. 급여는 지점 권한과 별개 축이다 — 담당 지점이라고 급여를 보는 것이 아니다

## 규칙을 고칠 때

`firestore.rules`를 한 줄이라도 고치면 `npm run test:rules`를 돌린다.
거부 테스트만 늘리지 말고, **정당한 사용자가 통과하는 케이스를 짝으로** 둔다.
거부만 검사하면 "전부 막는 규칙"도 만점을 받는다.
```

- [ ] **Step 6: 커밋**

```bash
git add tests/rules/limits.test.ts README.md firestore.rules
git commit -F - <<'EOF'
test: 규칙 판정 중 문서 읽기 한도 검증 + README

Firestore 는 규칙 판정 중 다른 문서를 읽는 횟수를 제한한다.
users -> tenants -> members 를 연달아 읽는 이 설계가 한도 안에
들어가는지 에뮬레이터에서 확인한다.

한도를 넘으면 규칙 거부가 아니라 요청 실패로 떨어져,
운영에서 "이유 없이 안 되는" 증상으로 나타난다.
EOF
```

---

## 이 계획이 끝나면

**산출물**: 검증된 `firestore.rules` + 테스트 4개 파일. 새 저장소에 커밋 6개.

**아직 안 한 것** (다음 계획들):

| 계획 | 내용 |
|---|---|
| 2 | 서버 함수 9종 (`createTenant`·`redeemInvite` 등). 규칙이 막아둔 것을 뚫어주는 정당한 통로 |
| 3 | 앱 코드 경로 이관 (59곳) + §2.2 별도 취급 5건 |
| 4 | 카카오·네이버 로그인 + 휴대폰 본인확인 |
| 5 | 기능 on/off 스위치 + 최고관리자 화면 |
| 6 | 브랜딩·약관 |
| 7 | UGD 이주 |

**UGD 운영 영향**: 없음. 이 계획은 에뮬레이터에서만 돌고, `erp_ugd` 저장소를 수정하지 않는다.

---

## 자체 점검 결과

**설계서 대조** — 이 계획이 덮는 범위는 설계서 §3.2(데이터 구조) · §3.3(쓰기 금지 구역) · §3.4(접근 판정) · §8.1(테스트 36종)이다.

§8.1의 테스트 번호 중 이 계획에서 **다루지 않는 것과 그 이유**:

| 번호 | 내용 | 왜 여기 없나 |
|---|---|---|
| #14 만료된/소비된 초대 | 초대 소비는 서버 함수 `redeemInvite`의 트랜잭션 책임이다. 규칙 층위에서는 "클라이언트가 초대에 손댈 수 없다"까지만 보장하고 그건 Task 2에서 덮었다 | 계획 2 |
| #15 이메일 미검증 초대 소비 | 위와 동일 | 계획 2 |
| #16 초대 동시 소비 | 위와 동일 (트랜잭션 경쟁은 규칙으로 검증할 수 없다) | 계획 2 |
| #21 지점명 예약어 검증 | 지점 생성은 서버 함수의 입력 검증 책임이다 | 계획 2 |
| #27 `_all` 을 allowedBranchesEncoded 에 넣기 | 범위 판정이 `_all`을 목록으로 처리하지 않으므로 규칙상 무의미하다. 대신 **#34c**(`salaryBranchesEncoded`에 `_all`)를 Task 3에서 덮었다 — 이쪽이 실제 위험한 경우다 | 규칙상 해당 없음 |

나머지 #1~13, #17~20, #22~26, #28~36은 전부 Task 2~4에 들어 있다.
