# 서버 함수 기반 + 회사 생성 구현 계획 (계획 2/N)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Firebase Functions 기반을 세우고, **회사를 만드는 경로**를 서버 전용으로 완성한다. 이 계획이 끝나면 "가입한 사람이 회사를 하나 만들고, 그 회사의 관리자가 되어, 규칙이 허용하는 데이터를 실제로 읽고 쓸 수 있다"가 자동 테스트로 증명된다.

**Architecture:** 계획 1이 만든 `firestore.rules`는 소속·권한 문서를 **클라이언트가 쓰지 못하게** 막았다(불변식 2). 그래서 그 문서들을 쓸 유일한 통로가 필요하다 — 그것이 서버 함수다. 계획 1이 "막는 쪽"이었다면 이 계획은 **"정당한 사용자가 통과하는 쪽"**이다. 여전히 클라우드 자원은 쓰지 않는다. Functions·Firestore·Auth 에뮬레이터 위에서만 돈다.

**Tech Stack:** Firebase Functions v2 (`onCall`) / TypeScript / Firebase Admin SDK / Firebase Emulator Suite (functions + firestore + auth) / Vitest

**Spec:** `../specs/2026-08-17-multi-tenant-erp-design.md` — §3.2(데이터 구조) · §3.3(클라이언트 쓰기 금지) · §3.5(서버 함수 목록) · §4.3~4.5(가입 경로와 남용 방어)

---

## 이 계획의 범위

설계서 §3.5의 서버 함수 9종 중 **2종**을 만든다.

| 함수 | 이 계획 | 이유 |
|---|---|---|
| `getAccountState` | ✅ | 외부 의존 없음. 가장 단순해 하네스 검증에 적합 |
| `createTenant` | ✅ | 외부 의존 없음. 이 계획의 본체 |
| `createInvite` / `redeemInvite` / `listInvites` / `updateMember` / `setTenantStatus` | 계획 3 | "직원이 합류한다"는 별개의 완결된 능력 |
| `authExchange` | 계획 5 | **카카오·네이버 개발자 앱 등록과 검수 승인**이 있어야 만들 수 있다 |
| `sendPhoneCode` / `verifyPhoneCode` | 계획 5 | **국내 문자 업체 계약**이 있어야 만들 수 있다 |

**`createTenant`는 전화 본인확인을 요구하지만, 그걸 기록하는 함수는 계획 5에 있다.**
그래서 이 계획에서는 `createTenant`가 `signup_verifications/{uid}.phoneVerifiedAt`을 **확인만** 하고,
테스트는 그 문서를 직접 심어 검증한다. 계획 5는 그 문서를 **쓰는 쪽**만 붙이면 된다 —
확인 로직을 나중에 고칠 필요가 없다.

---

## Global Constraints

설계서의 전 구간 제약. **모든 Task에 암묵적으로 포함된다.**

- **불변식 1** — A사 계정으로 B사 데이터를 읽거나 쓸 수 없다
- **불변식 2** — 소속·권한·본인확인 상태는 **클라이언트가 쓸 수 없다.** 서버만 쓴다
- **불변식 3** — 정지된 회사(`status != 'active'`)는 **어떤 데이터도** 읽거나 쓸 수 없다 (최고관리자의 회사 메타 읽기만 예외)
- **한 계정은 한 회사에만 속한다** — `createTenant`와 `redeemInvite` **둘 다** `users/{uid}` 부재를 트랜잭션으로 확인한다
- **회사ID는 예측 불가능한 무작위 값** — 회사명 기반 금지 (§4.5)
- **한 계정은 회사 하나만 생성** — 두 탭 동시 제출도 막아야 하므로 트랜잭션 (§4.5)
- **전화 본인확인 전 회사 생성 불가** — `phoneVerifiedAt`은 서버만 기록 (§4.2)
- **`allowedBranches`(원문)와 `allowedBranchesEncoded`(인코딩본)는 항상 함께 쓴다** — 규칙은 인코딩본만 본다 (§3.4)
- **예약어**: `_all`, `_admin`은 지점명으로 쓸 수 없다. 지점명에 `--`도 쓸 수 없다 (§3.4)
- `getAccountState`는 **이유만** 반환한다. 회사 데이터는 한 글자도 반환하지 않는다 (§3.3)

---

## 사전 준비

**없다.** 계획 1의 환경(JDK 21, Node, firebase-tools)이 그대로 쓰인다. 클라우드 자원도, 외부 계정도 필요 없다.

**환경 주의사항** (계획 1에서 확인된 것):

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
```

`java: command not found`는 **미설치가 아니라 PATH 문제**다. 설치돼 있다. 절대 다시 설치하지 말 것.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `functions/package.json` | Functions 런타임 의존성 (루트와 **별개**) |
| `functions/tsconfig.json` | Functions TypeScript 설정 |
| `functions/src/index.ts` | 함수 등록 지점. 각 함수를 re-export만 한다 |
| `functions/src/lib/context.ts` | 호출자 인증 확인, Admin SDK 초기화 등 공용 도구 |
| `functions/src/lib/branchKey.ts` | 지점명 → 인코딩본 변환과 예약어·`--` 검증. **한 곳에서만 변환한다** |
| `functions/src/getAccountState.ts` | 로그인했는데 화면을 못 쓰는 이유만 반환 |
| `functions/src/createTenant.ts` | 회사 생성 트랜잭션 |
| `firebase.json` | 에뮬레이터에 functions·auth 추가 |
| `tests/functions/helpers.ts` | Functions 테스트 공용 도구 (에뮬레이터 접속, 시드, 초기화) |
| `tests/functions/getAccountState.test.ts` | |
| `tests/functions/createTenant.test.ts` | |
| `tests/functions/integration.test.ts` | 서버가 만든 회사를 클라이언트가 규칙을 통과해 실제로 쓸 수 있는가 |

**분리 기준**: 함수 하나에 파일 하나. 공용 로직만 `lib/`에 둔다. `branchKey.ts`를 따로 두는 이유는 설계서 §11.4의 교훈 때문이다 — **변환 지점이 여러 곳이면 원문과 인코딩본이 어긋난다.**

**루트 `package.json`과 `functions/package.json`을 분리하는 이유**: 루트는 `"type": "module"`에 Vitest 기반이고, Functions는 자체 런타임·빌드 산출물(`lib/`)을 갖는다. Firebase의 표준 배치이기도 하다.

---

## Task 1: Functions 뼈대와 테스트 하네스

**목표**: 함수가 에뮬레이터에서 돌고, 테스트에서 **로그인한 사용자로 호출**할 수 있음을 최소 함수로 증명한다. 계획 1의 Task 1과 같은 취지 — 하네스를 먼저 믿을 수 있게 만든다.

**Files:**
- Create: `functions/package.json`, `functions/tsconfig.json`, `functions/src/index.ts`, `functions/src/lib/context.ts`
- Create: `tests/functions/helpers.ts`, `tests/functions/harness.test.ts`
- Modify: `firebase.json`, `package.json`(루트), `vitest.config.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `functions/src/lib/context.ts`: `requireAuth(request): { uid: string; email: string | null; emailVerified: boolean }` — 미인증이면 `HttpsError('unauthenticated')`
  - `functions/src/lib/context.ts`: `db(): Firestore` — Admin SDK Firestore (지연 초기화)
  - `tests/functions/helpers.ts`:
    - `callFn<T>(name: string, data: unknown, uid?: string, claims?: { email?: string; email_verified?: boolean }): Promise<T>` — 지정한 사용자로 함수 호출. `uid` 생략 시 미인증 호출
    - `seed(fn: (db: Firestore) => Promise<void>): Promise<void>` — Admin 권한으로 사전 데이터 심기
    - `clearAll(): Promise<void>` — Firestore + Auth 초기화

- [ ] **Step 1: Functions 패키지 생성**

Create `functions/package.json`:

```json
{
  "name": "erp-saas-functions",
  "private": true,
  "main": "lib/index.js",
  "engines": {
    "node": "22"
  },
  "scripts": {
    "build": "tsc",
    "build:watch": "tsc --watch"
  },
  "dependencies": {
    "firebase-admin": "^13.0.0",
    "firebase-functions": "^6.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

`"type": "module"`을 **넣지 않는다.** Functions 런타임은 CommonJS가 기본이고, 루트(`"type": "module"`)와 섞이면 빌드 산출물이 로드되지 않는다.

- [ ] **Step 2: TypeScript 설정**

Create `functions/tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "es2022",
    "lib": ["es2022"],
    "outDir": "lib",
    "rootDir": "src",
    "strict": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 공용 도구 작성**

Create `functions/src/lib/context.ts`:

```typescript
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

/**
 * Admin SDK 는 프로세스당 한 번만 초기화한다.
 * 에뮬레이터에서는 FIRESTORE_EMULATOR_HOST 등이 자동으로 주입되므로 설정이 필요 없다.
 */
export function db(): Firestore {
  if (getApps().length === 0) {
    initializeApp();
  }
  return getFirestore();
}

export interface Caller {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

/**
 * 로그인하지 않은 호출을 막는다.
 *
 * 이메일 검증 여부까지 함께 넘기는 이유: 초대 소비(계획 3)가 "검증된 이메일"을 요구하는데,
 * 그 판단에 쓸 값을 각 함수가 request 에서 직접 꺼내면 꺼내는 방식이 제각각이 된다.
 */
export function requireAuth(request: CallableRequest): Caller {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const token = auth.token as { email?: string; email_verified?: boolean };
  return {
    uid: auth.uid,
    email: token.email ?? null,
    emailVerified: token.email_verified === true,
  };
}
```

- [ ] **Step 4: 하네스 검증용 최소 함수 작성**

Create `functions/src/index.ts`:

```typescript
import { onCall } from "firebase-functions/v2/https";
import { requireAuth } from "./lib/context";

/**
 * 하네스 검증 전용. 인증 컨텍스트가 테스트에서 실제로 전달되는지만 확인한다.
 * Task 2 에서 삭제한다 — 제품 기능이 아니다.
 */
export const harnessPing = onCall((request) => {
  const caller = requireAuth(request);
  return { uid: caller.uid, email: caller.email, emailVerified: caller.emailVerified };
});
```

- [ ] **Step 5: 에뮬레이터 설정 확장**

Replace `firebase.json`:

```json
{
  "firestore": {
    "rules": "firestore.rules"
  },
  "functions": {
    "source": "functions",
    "codebase": "default"
  },
  "emulators": {
    "auth": {
      "port": 9099
    },
    "firestore": {
      "port": 8080
    },
    "functions": {
      "port": 5001
    },
    "ui": {
      "enabled": false
    },
    "singleProjectMode": true
  }
}
```

Auth 에뮬레이터가 필요한 이유: `onCall` 함수는 **Firebase Auth 토큰**에서 호출자를 읽는다. 가짜 토큰을 만들려면 Auth 에뮬레이터가 있어야 한다.

- [ ] **Step 6: 루트 스크립트 확장**

`package.json`(루트)의 `scripts`를 아래로 교체한다. 기존 두 줄은 그대로 두고 세 줄을 추가한다:

```json
  "scripts": {
    "test:rules": "firebase emulators:exec --only firestore --project demo-erp-saas \"vitest run tests/rules\"",
    "test:rules:watch": "firebase emulators:exec --only firestore --project demo-erp-saas \"vitest tests/rules\"",
    "build:functions": "npm --prefix functions run build",
    "test:functions": "npm run build:functions && firebase emulators:exec --only auth,firestore,functions --project demo-erp-saas \"vitest run tests/functions\"",
    "test:all": "npm run test:rules && npm run test:functions"
  },
```

`test:rules`에 `tests/rules` 경로를 붙인 것에 주의한다. 안 붙이면 규칙 테스트 실행 시 Functions 테스트까지 끌려 들어가 Functions 에뮬레이터가 없어 실패한다.

- [ ] **Step 7: Vitest 설정 확장**

Replace `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // 에뮬레이터 기동 직후 첫 요청이 느릴 수 있다.
    // Functions 는 콜드 스타트가 있어 규칙 테스트보다 더 여유가 필요하다.
    testTimeout: 30000,
    hookTimeout: 40000,
    // 같은 에뮬레이터 인스턴스를 여러 파일이 동시에 쓰면 서로의 시드 데이터를 지운다.
    // 파일을 순차 실행해 격리한다. tests/functions/helpers.ts 의 싱글턴도 이 설정에 안전을 의존한다.
    fileParallelism: false,
  },
});
```

- [ ] **Step 8: Functions 테스트 도구 작성**

Create `tests/functions/helpers.ts`:

```typescript
import { initializeApp, getApps, getApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCustomToken, signOut } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { initializeApp as initAdmin, getApps as getAdminApps, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore, type Firestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-erp-saas';

// 에뮬레이터 접속 정보. Admin SDK 는 환경변수로 찾아간다.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

let adminReady = false;
function admin() {
  if (!adminReady) {
    if (getAdminApps().length === 0) {
      initAdmin({ projectId: PROJECT_ID });
    }
    adminReady = true;
  }
  return {
    auth: getAdminAuth(),
    db: getAdminFirestore(),
  };
}

/**
 * 클라이언트 SDK 앱. 에뮬레이터에 연결한다.
 * 싱글턴인 이유와 그 안전성의 근거: vitest.config.ts 의 fileParallelism:false.
 * 병렬 실행을 켜면 이 싱글턴이 파일 간에 공유되어 로그인 상태가 섞인다.
 */
function client() {
  const app = getApps().length ? getApp() : initializeApp({
    projectId: PROJECT_ID,
    apiKey: 'fake-api-key-for-emulator',
  });
  const auth = getAuth(app);
  const functions = getFunctions(app);
  if (!(auth as unknown as { _emulatorConfigured?: boolean })._emulatorConfigured) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    (auth as unknown as { _emulatorConfigured?: boolean })._emulatorConfigured = true;
  }
  return { app, auth, functions };
}

/**
 * 지정한 사용자로 함수를 호출한다.
 * uid 를 생략하면 로그아웃 상태(미인증)로 호출한다.
 *
 * claims 로 email / email_verified 를 지정할 수 있다 — 초대 소비처럼
 * 이메일 검증 여부에 따라 동작이 갈리는 함수를 테스트하기 위함이다.
 */
export async function callFn<T = unknown>(
  name: string,
  data: unknown = {},
  uid?: string,
  claims: { email?: string; email_verified?: boolean } = {},
): Promise<T> {
  const { auth, functions } = client();

  if (uid) {
    const { auth: adminAuth } = admin();
    // 사용자가 없으면 만든다. 이메일 검증 상태는 Auth 사용자 속성으로 반영한다.
    try {
      await adminAuth.getUser(uid);
      await adminAuth.updateUser(uid, {
        email: claims.email,
        emailVerified: claims.email_verified === true,
      });
    } catch {
      await adminAuth.createUser({
        uid,
        email: claims.email,
        emailVerified: claims.email_verified === true,
      });
    }
    const token = await adminAuth.createCustomToken(uid);
    await signInWithCustomToken(auth, token);
  } else {
    await signOut(auth);
  }

  const fn = httpsCallable(functions, name);
  const result = await fn(data);
  return result.data as T;
}

/** Admin 권한으로 사전 데이터를 심는다. 규칙을 우회한다. */
export async function seed(fn: (db: Firestore) => Promise<void>): Promise<void> {
  await fn(admin().db);
}

/** Firestore 와 Auth 를 모두 비운다. 각 테스트 시작 전에 부른다. */
export async function clearAll(): Promise<void> {
  const { auth, db } = admin();
  await db.recursiveDelete(db.collection('users'));
  await db.recursiveDelete(db.collection('tenants'));
  await db.recursiveDelete(db.collection('signup_verifications'));
  await db.recursiveDelete(db.collection('platform_admins'));
  const users = await auth.listUsers(1000);
  if (users.users.length > 0) {
    await auth.deleteUsers(users.users.map((u) => u.uid));
  }
  await signOut(getAuth(getApps().length ? getApp() : initializeApp({ projectId: PROJECT_ID, apiKey: 'fake-api-key-for-emulator' })));
}

/** 테스트 종료 시 클라이언트 앱을 정리한다. */
export async function teardown(): Promise<void> {
  if (getApps().length) {
    await deleteApp(getApp());
  }
}
```

- [ ] **Step 9: 하네스 검증 테스트 작성**

Create `tests/functions/harness.test.ts`:

```typescript
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { getAuth } from 'firebase/auth';
import { getApp } from 'firebase/app';
import { callFn, clearAll, teardown } from './helpers';

describe('Functions 하네스 검증', () => {
  beforeEach(async () => {
    await clearAll();
  });

  afterAll(async () => {
    await teardown();
  });

  it('로그인한 사용자로 호출하면 그 uid 가 함수에 전달된다', async () => {
    const result = await callFn<{ uid: string }>('harnessPing', {}, 'u1');
    expect(result.uid).toBe('u1');
  });

  /**
   * ★ 이 테스트가 하네스 전체의 전제를 검증한다.
   *
   * 우리 방식은 Admin SDK 로 Auth 사용자의 email/emailVerified 를 설정한 뒤
   * createCustomToken 으로 로그인한다. 커스텀 토큰에 email 을 직접 넣을 수는 없다 —
   * email/email_verified 는 Firebase 예약 클레임이라 거부된다.
   *
   * 그래서 "사용자 레코드에 설정한 값이 ID 토큰에 실려 오는가"가 전제인데,
   * 공식 문서에서 이 조합을 명시한 문장을 찾지 못했다. 가정하지 않고 직접 확인한다.
   * 먼저 ID 토큰의 클레임을 보고, 그 다음 함수까지 전달되는지 본다.
   */
  it('ID 토큰에 email / email_verified 클레임이 실린다', async () => {
    await callFn('harnessPing', {}, 'u2', { email: 'a@a.com', email_verified: true });

    const user = getAuth(getApp()).currentUser;
    expect(user).not.toBeNull();
    const token = await user!.getIdTokenResult(true);
    expect(token.claims.email).toBe('a@a.com');
    expect(token.claims.email_verified).toBe(true);
  });

  it('이메일 검증 여부가 함수까지 전달된다', async () => {
    const verified = await callFn<{ emailVerified: boolean; email: string | null }>(
      'harnessPing', {}, 'u3', { email: 'a@a.com', email_verified: true },
    );
    expect(verified.emailVerified).toBe(true);
    expect(verified.email).toBe('a@a.com');

    const unverified = await callFn<{ emailVerified: boolean }>(
      'harnessPing', {}, 'u4', { email: 'b@b.com', email_verified: false },
    );
    expect(unverified.emailVerified).toBe(false);
  });

  it('로그인하지 않은 호출은 거부된다', async () => {
    await expect(callFn('harnessPing', {})).rejects.toThrow(/unauthenticated|로그인/);
  });
});
```

이 네 개가 통과하면 하네스를 믿을 수 있다: **인증이 전달되고, 클레임이 토큰에 실리고, 함수까지 도달하고, 미인증이 막힌다.**
앞의 셋이 통과 케이스라는 점이 중요하다 — 거부만 확인하는 하네스는 "전부 막는 함수"도 만점을 준다.

> **`ID 토큰에 email / email_verified 클레임이 실린다`가 실패하면 여기서 멈추고 보고하라.**
> 그건 이 하네스 방식이 성립하지 않는다는 뜻이고, 계획 3의 초대 소비(검증된 이메일 요구)를
> 통째로 테스트할 수 없게 된다. 임시로 넘기지 말 것.
>
> 대안이 있다: Auth 에뮬레이터의 REST API 로 이메일+비밀번호 사용자를 만들어
> `signInWithEmailAndPassword` 로 로그인하면 `email` 클레임은 확실히 실린다.
> `email_verified` 는 Admin SDK 로 사용자를 갱신한 뒤 **토큰을 강제 갱신**(`getIdToken(true)`)해야
> 반영될 수 있다. 실패 시 이 경로로 바꾸고, 바꿨다는 사실을 보고서에 남길 것.

- [ ] **Step 10: 실행 — 통과 확인**

Run:
```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
npm install --prefix functions
npm run test:functions
```

Expected: 3 passed.

실패 시 진단 순서:
1. `Cannot find module lib/index.js` → 빌드가 안 됐다. `npm run build:functions`를 단독 실행해 TypeScript 오류를 본다
2. `ECONNREFUSED 127.0.0.1:5001` → Functions 에뮬레이터가 안 떴다. `firebase.json`의 `functions.source`가 `functions`인지 확인
3. `auth/invalid-custom-token` → Auth 에뮬레이터 포트 불일치. `helpers.ts`의 9099와 `firebase.json`이 같은지 확인
4. 포트 충돌 → `firebase.json`과 `helpers.ts`의 해당 포트를 **함께** 바꾼다

- [ ] **Step 11: 규칙 테스트가 여전히 통과하는지 확인**

Run:
```bash
npm run test:rules
```

Expected: 119 passed. `vitest.config.ts`의 `include`를 넓혔으므로 규칙 테스트가 영향받지 않았는지 확인한다.

- [ ] **Step 12: .gitignore 확장 및 커밋**

`.gitignore`에 추가:

```
functions/lib/
functions/node_modules/
```

```bash
git add .gitignore firebase.json package.json package-lock.json vitest.config.ts functions/ tests/functions/
git commit -F - <<'EOF'
feat: Firebase Functions 기반과 테스트 하네스

Functions·Auth 에뮬레이터를 붙이고, 로그인한 사용자로 함수를 호출하는
테스트 도구를 만들었다. 인증 전달·클레임 전달·미인증 거부 세 경로를
최소 함수로 확인한다.

harnessPing 은 하네스 검증 전용이며 Task 2 에서 삭제한다.
EOF
```

---

## Task 2: `getAccountState`

**목표**: 로그인은 됐는데 화면을 못 쓰는 사람에게 **이유만** 알려주는 함수를 만든다. 계획 1에서 회사 메타 읽기를 "활성 회사의 소속 구성원"으로 좁히면서, 정지된 회사의 직원은 아무것도 못 읽게 됐다 — 그들에게 이유를 알려줄 통로가 이 함수다.

**Files:**
- Create: `functions/src/getAccountState.ts`
- Create: `tests/functions/getAccountState.test.ts`
- Modify: `functions/src/index.ts`
- Delete: `tests/functions/harness.test.ts` (하네스 검증 역할을 다했다)

**Interfaces:**
- Consumes: `requireAuth`, `db` (Task 1)
- Produces: `getAccountState` 호출 결과 형태 — 계획 3의 화면과 이후 계획이 그대로 쓴다

```typescript
type AccountState =
  | { state: 'no_tenant' }          // 소속 없음 — 회사를 만들거나 초대를 받아야 함
  | { state: 'tenant_suspended' }   // 회사가 정지됨 — 이유 코드만
  | { state: 'member_suspended' }   // 본인이 정지됨 — 이유 코드만
  | { state: 'active'; tenantId: string; companyName: string; role: 'admin' | 'branch' };
```

**막힌 상태에서는 회사명조차 반환하지 않는다.** 설계서 §3.3은 이 함수가 "회사 데이터는 한 글자도
주지 않고 상태와 안내 문구만 반환"한다고 못 박는다. 회사명은 회사 문서의 필드이고, 규칙은
정지된 회사의 회사 문서 읽기를 막는다 — 서버 함수가 그걸 우회해 내보내면 **"정지 안내 통로"가
"데이터 조회 통로"로 변한다.**

화면은 이름 없이도 안내할 수 있다: "회사가 정지되었습니다. 관리자에게 문의하세요."
`active`일 때만 `tenantId`·`companyName`·`role`을 준다 — 그건 앱이 동작하는 데 필요하다.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/functions/getAccountState.test.ts`:

```typescript
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { callFn, seed, clearAll, teardown } from './helpers';

type AccountState =
  | { state: 'no_tenant' }
  | { state: 'tenant_suspended' }
  | { state: 'member_suspended' }
  | { state: 'active'; tenantId: string; companyName: string; role: string };

describe('getAccountState', () => {
  beforeEach(async () => {
    await clearAll();
  });

  afterAll(async () => {
    await teardown();
  });

  it('로그인하지 않으면 거부된다', async () => {
    await expect(callFn('getAccountState', {})).rejects.toThrow(/unauthenticated|로그인/);
  });

  it('소속이 없으면 no_tenant', async () => {
    const r = await callFn<AccountState>('getAccountState', {}, 'nobody');
    expect(r.state).toBe('no_tenant');
  });

  it('정상 소속이면 active 와 회사명·역할을 준다', async () => {
    await seed(async (db) => {
      await db.doc('tenants/T_A').set({ companyName: 'A사', status: 'active' });
      await db.doc('users/u1').set({ tenantId: 'T_A' });
      await db.doc('tenants/T_A/members/u1').set({ role: 'admin', status: 'active' });
    });

    const r = await callFn<AccountState>('getAccountState', {}, 'u1');
    expect(r).toMatchObject({
      state: 'active',
      tenantId: 'T_A',
      companyName: 'A사',
      role: 'admin',
    });
  });

  it('회사가 정지되면 이유 코드만 준다 — 회사명도 주지 않는다', async () => {
    await seed(async (db) => {
      await db.doc('tenants/T_S').set({ companyName: '정지사', status: 'suspended' });
      await db.doc('users/u2').set({ tenantId: 'T_S' });
      await db.doc('tenants/T_S/members/u2').set({ role: 'branch', status: 'active' });
    });

    const r = await callFn<Record<string, unknown>>('getAccountState', {}, 'u2');
    expect(Object.keys(r)).toEqual(['state']);
    expect(r.state).toBe('tenant_suspended');
  });

  it('본인이 정지되면 이유 코드만 준다 — 회사명도 주지 않는다', async () => {
    await seed(async (db) => {
      await db.doc('tenants/T_B').set({ companyName: 'B사', status: 'active' });
      await db.doc('users/u3').set({ tenantId: 'T_B' });
      await db.doc('tenants/T_B/members/u3').set({ role: 'branch', status: 'suspended' });
    });

    const r = await callFn<Record<string, unknown>>('getAccountState', {}, 'u3');
    expect(Object.keys(r)).toEqual(['state']);
    expect(r.state).toBe('member_suspended');
  });

  it('users 문서는 있는데 members 문서가 없으면 no_tenant 로 떨어진다', async () => {
    await seed(async (db) => {
      await db.doc('tenants/T_C').set({ companyName: 'C사', status: 'active' });
      await db.doc('users/u4').set({ tenantId: 'T_C' });
      // members 문서 없음 — 서버 함수가 중간에 죽은 상황을 흉내낸다
    });

    const r = await callFn<AccountState>('getAccountState', {}, 'u4');
    expect(r.state).toBe('no_tenant');
  });

  it('active 일 때 앱에 필요한 최소 필드만 준다 — 회사 설정·다른 구성원 정보는 없다', async () => {
    await seed(async (db) => {
      await db.doc('tenants/T_D').set({
        companyName: 'D사',
        status: 'active',
        branchIsolation: true,
        features: { kakaoTaxi: true },
        ownerUid: 'someone-else',
      });
      await db.doc('users/u5').set({ tenantId: 'T_D' });
      await db.doc('tenants/T_D/members/u5').set({
        role: 'branch',
        status: 'active',
        allowedBranchesEncoded: ['%EA%B0%80%EA%B2%8C'],
        salaryBranchesEncoded: ['%EA%B0%80%EA%B2%8C'],
      });
    });

    const r = await callFn<Record<string, unknown>>('getAccountState', {}, 'u5');
    expect(Object.keys(r).sort()).toEqual(['companyName', 'role', 'state', 'tenantId']);
  });
});
```

마지막 테스트가 이 함수의 존재 이유를 지킨다. **"이유만 알려준다"는 계약을 어기면 여기서 빨개진다.**

- [ ] **Step 2: 실행 — 실패 확인**

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
npm run test:functions
```

Expected: `getAccountState` 관련 전부 FAIL — 함수가 아직 없어 `functions/not-found`가 난다.

- [ ] **Step 3: 함수 구현**

Create `functions/src/getAccountState.ts`:

```typescript
import { onCall } from "firebase-functions/v2/https";
import { requireAuth, db } from "./lib/context";

/**
 * 로그인은 했는데 화면을 쓸 수 없는 사람에게 "왜"만 알려준다.
 *
 * 이 함수가 필요한 이유: 보안규칙이 회사 메타 읽기를 "활성 회사의 소속 구성원"으로
 * 제한하기 때문에(설계서 §3.3), 정지된 회사의 직원은 자기 회사 문서조차 읽을 수 없다.
 * 통로가 없으면 그들은 이유 없는 빈 화면을 보게 된다.
 *
 * 반환하는 것은 상태·회사명·역할뿐이다. 회사의 업무 데이터도, 설정도, 다른 구성원 정보도
 * 반환하지 않는다 — 정지된 회사의 사람이 이 함수로 데이터를 빼갈 수 있으면 정지가 무의미해진다.
 */
export const getAccountState = onCall(async (request) => {
  const caller = requireAuth(request);
  const firestore = db();

  const userSnap = await firestore.doc(`users/${caller.uid}`).get();
  if (!userSnap.exists) {
    return { state: "no_tenant" as const };
  }

  const tenantId = userSnap.get("tenantId") as string | undefined;
  if (!tenantId) {
    return { state: "no_tenant" as const };
  }

  const [tenantSnap, memberSnap] = await Promise.all([
    firestore.doc(`tenants/${tenantId}`).get(),
    firestore.doc(`tenants/${tenantId}/members/${caller.uid}`).get(),
  ]);

  // 소속은 있다고 하는데 회사나 구성원 문서가 없다 — 생성이 중간에 끊긴 상태다.
  // 회사가 있다고 알려주면 화면이 없는 데이터를 읽으려 하므로, 소속 없음으로 처리한다.
  if (!tenantSnap.exists || !memberSnap.exists) {
    return { state: "no_tenant" as const };
  }

  // 막힌 상태에서는 이유 코드만 반환한다. 회사명조차 주지 않는다.
  // 회사명은 회사 문서의 필드이고, 규칙은 정지된 회사의 회사 문서 읽기를 막는다.
  // 여기서 내보내면 "정지 안내 통로"가 "데이터 조회 통로"로 변한다(설계서 §3.3).
  if (tenantSnap.get("status") !== "active") {
    return { state: "tenant_suspended" as const };
  }
  if (memberSnap.get("status") !== "active") {
    return { state: "member_suspended" as const };
  }

  return {
    state: "active" as const,
    tenantId,
    companyName: (tenantSnap.get("companyName") as string | undefined) ?? "",
    role: (memberSnap.get("role") as string | undefined) ?? "branch",
  };
});
```

- [ ] **Step 4: 함수 등록 및 하네스 함수 제거**

Replace `functions/src/index.ts`:

```typescript
export { getAccountState } from "./getAccountState";
```

`harnessPing`을 삭제한다. 제품 기능이 아니고, 인증 컨텍스트를 그대로 되돌려주는 함수를 남겨둘 이유가 없다.

- [ ] **Step 5: 하네스 테스트 제거**

```bash
git rm tests/functions/harness.test.ts
```

역할을 다했다. 인증 전달은 이제 `getAccountState` 테스트가 확인한다.

- [ ] **Step 6: 실행 — 통과 확인**

```bash
npm run test:functions
```

Expected: 7 passed.

- [ ] **Step 7: 커밋**

```bash
git add functions/src tests/functions
git commit -F - <<'EOF'
feat: getAccountState — 화면을 못 쓰는 이유만 알려주는 통로

보안규칙이 정지된 회사의 회사 문서 읽기까지 막기 때문에, 그 직원들에게
이유를 전할 경로가 없었다. 이 함수가 그 경로다.

상태·회사명·역할만 반환한다. 회사 업무 데이터를 반환하지 않는지
테스트가 반환 키 목록으로 고정한다.
EOF
```

---

## Task 3: `createTenant`

**목표**: 회사를 만드는 유일한 통로. 이 계획의 본체이며, 클라이언트가 절대 쓸 수 없는 문서 3개(`users`, `tenants`, `members`)를 한 트랜잭션으로 만든다.

**Files:**
- Create: `functions/src/lib/branchKey.ts`, `functions/src/createTenant.ts`
- Create: `tests/functions/createTenant.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `requireAuth`, `db` (Task 1)
- Produces:
  - `functions/src/lib/branchKey.ts`:
    - `encodeBranch(name: string): string` — `encodeURIComponent`
    - `assertValidBranchNames(names: string[]): void` — 비어있음·중복·예약어(`_all`/`_admin`)·`--` 포함을 검사하고 위반 시 `HttpsError('invalid-argument')`
  - `createTenant({ companyName, branchNames })` → `{ tenantId: string }`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/functions/createTenant.test.ts`:

```typescript
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { callFn, seed, clearAll, teardown } from './helpers';
import { getApps as getAdminApps, initializeApp as initAdmin } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function adminDb() {
  if (getAdminApps().length === 0) initAdmin({ projectId: 'demo-erp-saas' });
  return getFirestore();
}

/** 전화 본인확인을 마친 상태를 만든다. 실제로는 계획 5의 verifyPhoneCode 가 쓴다. */
async function markPhoneVerified(uid: string) {
  await seed(async (db) => {
    await db.doc(`signup_verifications/${uid}`).set({
      phone: '01012345678',
      phoneVerifiedAt: new Date().toISOString(),
    });
  });
}

const OK = { companyName: '새회사', branchNames: ['가게', '나가게'] };

describe('createTenant', () => {
  beforeEach(async () => {
    await clearAll();
  });

  afterAll(async () => {
    await teardown();
  });

  it('로그인하지 않으면 거부된다', async () => {
    await expect(callFn('createTenant', OK)).rejects.toThrow(/unauthenticated|로그인/);
  });

  it('전화 본인확인을 안 했으면 거부된다', async () => {
    await expect(callFn('createTenant', OK, 'u1')).rejects.toThrow(/failed-precondition|본인확인/);
  });

  it('본인확인을 마치면 회사가 만들어진다', async () => {
    await markPhoneVerified('u1');
    const r = await callFn<{ tenantId: string }>('createTenant', OK, 'u1');
    expect(r.tenantId).toBeTruthy();

    const db = adminDb();
    const tenant = await db.doc(`tenants/${r.tenantId}`).get();
    expect(tenant.get('companyName')).toBe('새회사');
    expect(tenant.get('status')).toBe('active');
    expect(tenant.get('ownerUid')).toBe('u1');
    // 새로 가입하는 회사는 지점 격리를 켠 상태로 시작한다(설계서 §3.4)
    expect(tenant.get('branchIsolation')).toBe(true);

    const user = await db.doc('users/u1').get();
    expect(user.get('tenantId')).toBe(r.tenantId);

    const member = await db.doc(`tenants/${r.tenantId}/members/u1`).get();
    expect(member.get('role')).toBe('admin');
    expect(member.get('status')).toBe('active');
  });

  it('회사ID는 회사명에서 유추할 수 없는 무작위 값이다', async () => {
    await markPhoneVerified('u1');
    const a = await callFn<{ tenantId: string }>('createTenant', OK, 'u1');

    await markPhoneVerified('u2');
    const b = await callFn<{ tenantId: string }>('createTenant', OK, 'u2');

    expect(a.tenantId).not.toBe(b.tenantId);
    expect(a.tenantId).not.toContain('새회사');
    expect(a.tenantId.length).toBeGreaterThanOrEqual(16);
  });

  it('지점 목록이 public_branches 와 members 권한에 모두 반영된다', async () => {
    await markPhoneVerified('u1');
    const r = await callFn<{ tenantId: string }>('createTenant', OK, 'u1');
    const db = adminDb();

    const branches = await db.collection(`tenants/${r.tenantId}/public_branches`).get();
    expect(branches.docs.map((d) => d.id).sort()).toEqual(
      ['가게', '나가게'].map(encodeURIComponent).sort(),
    );

    const member = await db.doc(`tenants/${r.tenantId}/members/u1`).get();
    expect(member.get('allowedBranches')).toEqual(['가게', '나가게']);
    expect(member.get('allowedBranchesEncoded')).toEqual(
      ['가게', '나가게'].map(encodeURIComponent),
    );
    expect(member.get('salaryBranchesEncoded')).toEqual(
      ['가게', '나가게'].map(encodeURIComponent),
    );
  });

  it('이미 회사에 속한 사람은 또 만들 수 없다', async () => {
    await markPhoneVerified('u1');
    await callFn('createTenant', OK, 'u1');
    await markPhoneVerified('u1');
    await expect(callFn('createTenant', OK, 'u1')).rejects.toThrow(/already-exists|이미/);
  });

  it('두 번 동시에 제출해도 회사는 하나만 만들어진다', async () => {
    await markPhoneVerified('u1');
    const results = await Promise.allSettled([
      callFn<{ tenantId: string }>('createTenant', OK, 'u1'),
      callFn<{ tenantId: string }>('createTenant', OK, 'u1'),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);

    const db = adminDb();
    const tenants = await db.collection('tenants').get();
    expect(tenants.size).toBe(1);
  });

  // ---------- 입력 검증 ----------

  it.each([
    ['회사명 없음', { companyName: '', branchNames: ['가게'] }],
    ['지점 없음', { companyName: '새회사', branchNames: [] }],
    ['지점명 중복', { companyName: '새회사', branchNames: ['가게', '가게'] }],
    ['지점명 빈 문자열', { companyName: '새회사', branchNames: [''] }],
    ['지점명에 -- 포함', { companyName: '새회사', branchNames: ['강남--본점'] }],
    ['지점명이 _all', { companyName: '새회사', branchNames: ['_all'] }],
    ['지점명이 _admin', { companyName: '새회사', branchNames: ['_admin'] }],
    ['지점 101개(상한 초과)', {
      companyName: '새회사',
      branchNames: Array.from({ length: 101 }, (_, i) => `지점${i}`),
    }],
  ])('입력 검증: %s → 거부', async (_label, payload) => {
    await markPhoneVerified('u1');
    await expect(callFn('createTenant', payload, 'u1')).rejects.toThrow(/invalid-argument/);
  });

  it('지점 100개(상한)는 통과한다', async () => {
    await markPhoneVerified('u1');
    const names = Array.from({ length: 100 }, (_, i) => `지점${i}`);
    const r = await callFn<{ tenantId: string }>(
      'createTenant', { companyName: '큰회사', branchNames: names }, 'u1',
    );

    const db = adminDb();
    const branches = await db.collection(`tenants/${r.tenantId}/public_branches`).get();
    expect(branches.size).toBe(100);
  });

  it('입력이 거부되면 아무 문서도 남지 않는다', async () => {
    await markPhoneVerified('u1');
    await expect(
      callFn('createTenant', { companyName: '새회사', branchNames: ['_all'] }, 'u1'),
    ).rejects.toThrow();

    const db = adminDb();
    expect((await db.collection('tenants').get()).size).toBe(0);
    expect((await db.doc('users/u1').get()).exists).toBe(false);
  });
});
```

`지점명에 -- 포함` 케이스가 왜 중요한지: 설계서 §3.4에 따르면 `--`가 든 지점명은 범위키 분리를 깨뜨려 **다른 지점 담당자가 그 지점 데이터를 읽게 된다.** 계획 1이 보안규칙에서 `public_branches` 생성을 막아뒀지만, 서버 함수도 같은 검증을 해야 한다 — 규칙은 문서ID만 보고, 여기는 원문 지점명을 본다.

- [ ] **Step 2: 실행 — 실패 확인**

```bash
npm run test:functions
```

Expected: `createTenant` 전부 FAIL (`functions/not-found`).

- [ ] **Step 3: 지점명 도구 작성**

Create `functions/src/lib/branchKey.ts`:

```typescript
import { HttpsError } from "firebase-functions/v2/https";

/** 예약어. 범위키로 이미 쓰이고 있어 지점명이 될 수 없다(설계서 §3.4). */
const RESERVED = ["_all", "_admin"];

/**
 * 한 회사가 한 번에 만들 수 있는 지점 수 상한.
 *
 * 두 가지 이유로 필요하다:
 * 1) Firestore 트랜잭션은 쓰기 500건이 한도다. createTenant 는 tenant·member·user 3건에
 *    지점 수만큼을 더 쓰므로, 상한이 없으면 지점 498개에서 런타임 실패한다.
 * 2) 남용 방어 — 지점 목록은 가입 시 클라이언트가 그대로 보내는 값이다.
 *
 * 100 인 이유: UGD 가 14 지점이다. 실제 필요보다 넉넉하되 한도와는 멀찍이 떨어뜨린다.
 * 더 필요한 회사는 만든 뒤 관리자 화면에서 추가하면 된다(계획 3).
 */
const MAX_BRANCHES = 100;

/**
 * 지점명 → 규칙이 비교하는 인코딩본.
 *
 * 변환을 이 한 곳에서만 하는 이유(설계서 §11.4 교훈):
 * 원문과 인코딩본이 여러 곳에서 따로 만들어지면 어긋난다. 어긋나면 규칙은
 * 인코딩본만 보므로, 화면에는 담당 지점이 보이는데 데이터는 안 열리는 상태가 된다.
 */
export function encodeBranch(name: string): string {
  return encodeURIComponent(name);
}

/**
 * 지점명 목록을 검증한다. 위반이 하나라도 있으면 던진다.
 *
 * `--` 를 막는 이유가 가장 중요하다: 문서ID 는 `<범위키>--<나머지>` 규약을 쓰는데,
 * encodeURIComponent 는 `-` 를 이스케이프하지 않는다. 지점명에 `--` 가 들어가면
 * 범위키가 앞부분에서 잘려, 다른 지점 담당자가 그 지점 데이터를 읽게 된다.
 */
export function assertValidBranchNames(names: unknown): string[] {
  if (!Array.isArray(names) || names.length === 0) {
    throw new HttpsError("invalid-argument", "지점을 최소 하나 입력해야 합니다.");
  }
  if (names.length > MAX_BRANCHES) {
    throw new HttpsError(
      "invalid-argument",
      `지점은 한 번에 ${MAX_BRANCHES}개까지 만들 수 있습니다. 나머지는 만든 뒤 추가하세요.`,
    );
  }

  const cleaned: string[] = [];
  for (const raw of names) {
    if (typeof raw !== "string") {
      throw new HttpsError("invalid-argument", "지점명은 문자열이어야 합니다.");
    }
    const name = raw.trim();
    if (name === "") {
      throw new HttpsError("invalid-argument", "빈 지점명은 쓸 수 없습니다.");
    }
    if (name.includes("--")) {
      throw new HttpsError(
        "invalid-argument",
        `지점명에 '--' 를 쓸 수 없습니다: ${name}`,
      );
    }
    if (RESERVED.includes(name)) {
      throw new HttpsError(
        "invalid-argument",
        `'${name}' 은 예약된 이름이라 지점명으로 쓸 수 없습니다.`,
      );
    }
    cleaned.push(name);
  }

  if (new Set(cleaned).size !== cleaned.length) {
    throw new HttpsError("invalid-argument", "지점명이 중복됩니다.");
  }

  return cleaned;
}
```

- [ ] **Step 4: `createTenant` 구현**

Create `functions/src/createTenant.ts`:

```typescript
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomBytes } from "node:crypto";
import { requireAuth, db } from "./lib/context";
import { encodeBranch, assertValidBranchNames } from "./lib/branchKey";

/**
 * 회사ID. 회사명에서 유추할 수 없어야 한다(설계서 §4.5).
 * 이름 기반이면 남의 회사 문서 주소를 추측당한다.
 *
 * **예측 불가능과 유일함은 다른 성질이다.** 아래 트랜잭션이 `create` 를 쓰는 이유가 그것이다.
 */
function newTenantId(): string {
  return randomBytes(16).toString("hex");
}


/**
 * 회사를 만드는 유일한 통로.
 *
 * 보안규칙은 users·tenants·members 를 클라이언트가 못 쓰게 막는다(불변식 2).
 * 그래서 이 세 문서를 만들 수 있는 곳은 여기뿐이다.
 *
 * 트랜잭션인 이유(설계서 §4.5): 두 탭에서 동시에 제출하면 "한 계정은 회사 하나"가
 * 깨진다. users/{uid} 부재 확인과 생성이 한 트랜잭션 안에 있어야 한다.
 */
export const createTenant = onCall(async (request) => {
  const caller = requireAuth(request);
  const firestore = db();

  const payload = request.data as { companyName?: unknown; branchNames?: unknown };

  const companyName =
    typeof payload.companyName === "string" ? payload.companyName.trim() : "";
  if (companyName === "") {
    throw new HttpsError("invalid-argument", "회사명을 입력해야 합니다.");
  }

  // 입력 검증을 트랜잭션 밖에서 먼저 한다 — 잘못된 입력으로 트랜잭션을 열 이유가 없다.
  const branchNames = assertValidBranchNames(payload.branchNames);

  const tenantId = newTenantId();
  const userRef = firestore.doc(`users/${caller.uid}`);
  const verifyRef = firestore.doc(`signup_verifications/${caller.uid}`);

  await firestore.runTransaction(async (tx) => {
    const [userSnap, verifySnap] = await Promise.all([
      tx.get(userRef),
      tx.get(verifyRef),
    ]);

    if (userSnap.exists) {
      throw new HttpsError("already-exists", "이미 회사에 속해 있습니다.");
    }
    if (!verifySnap.exists || !verifySnap.get("phoneVerifiedAt")) {
      throw new HttpsError(
        "failed-precondition",
        "휴대폰 본인확인을 먼저 마쳐야 합니다.",
      );
    }

    const now = new Date().toISOString();
    const encoded = branchNames.map(encodeBranch);

    // set 이 아니라 create 다. 16바이트 난수가 충돌할 확률은 무시할 만하지만,
    // set 이면 충돌 시 **남의 회사 문서를 덮어쓴다.** create 는 이미 있으면 실패한다.
    // 예측 불가능(§4.5)과 유일함은 다른 성질이고, 여기서 필요한 건 후자다.
    tx.create(firestore.doc(`tenants/${tenantId}`), {
      companyName,
      ownerUid: caller.uid,
      status: "active",
      // 새로 가입하는 회사는 지점 격리를 켠 상태로 시작한다(설계서 §3.4).
      branchIsolation: true,
      features: {},
      createdAt: now,
    });

    tx.set(firestore.doc(`tenants/${tenantId}/members/${caller.uid}`), {
      displayName: "",
      email: caller.email,
      phone: verifySnap.get("phone") ?? null,
      phoneVerifiedAt: verifySnap.get("phoneVerifiedAt"),
      role: "admin",
      status: "active",
      provider: "",
      joinedAt: now,
      // 만든 사람은 전 지점 담당으로 시작한다. 원문과 인코딩본을 항상 함께 쓴다(§3.4).
      allowedBranches: branchNames,
      allowedBranchesEncoded: encoded,
      salaryBranchesEncoded: encoded,
    });

    for (let i = 0; i < branchNames.length; i++) {
      tx.set(
        firestore.doc(`tenants/${tenantId}/public_branches/${encoded[i]}`),
        { branchName: branchNames[i], isActive: true, createdAt: now },
      );
    }

    // users 문서는 마지막에 만든다 — 이 문서의 존재가 "소속 확정"의 신호이므로,
    // 앞의 문서들이 다 준비된 뒤에 세우는 편이 읽기 쪽에서 안전하다.
    // (트랜잭션이라 실제로는 동시에 반영되지만, 순서가 의도를 드러낸다.)
    tx.set(userRef, { tenantId, createdAt: now });
  });

  return { tenantId };
});
```

- [ ] **Step 5: 함수 등록**

Replace `functions/src/index.ts`:

```typescript
export { getAccountState } from "./getAccountState";
export { createTenant } from "./createTenant";
```

- [ ] **Step 6: 실행 — 통과 확인**

```bash
npm run test:functions
```

Expected: 전부 PASS (getAccountState 7 + createTenant 15).

`두 번 동시에 제출` 테스트가 실패하면 트랜잭션 밖에서 `users/{uid}`를 확인하고 있는 것이다. 확인과 생성이 **같은 트랜잭션 안**에 있어야 한다.

- [ ] **Step 7: 커밋**

```bash
git add functions/src tests/functions
git commit -F - <<'EOF'
feat: createTenant — 회사 생성 트랜잭션

클라이언트가 쓸 수 없는 users/tenants/members 를 만드는 유일한 통로.

한 계정 한 회사를 트랜잭션으로 보장한다(두 탭 동시 제출 테스트로 고정).
회사ID 는 무작위 — 회사명 기반이면 남의 회사 주소를 추측당한다.
지점명의 '--' 와 예약어를 서버에서도 검증한다. 규칙은 문서ID만 보고
여기는 원문을 보므로 둘 다 필요하다.
EOF
```

---

## Task 4: 규칙과 서버의 통합 검증

**목표**: 계획 1(막는 쪽)과 계획 2(뚫어주는 쪽)의 **아귀가 맞는지** 확인한다. 서버가 만든 회사를, 그 회사의 관리자가 **실제 보안규칙을 통과해** 쓸 수 있어야 한다.

이 Task가 없으면 두 계획은 각자 초록인 채로 서로 안 맞을 수 있다 — 서버가 `role: 'admin'`을 쓰는데 규칙은 `role: 'ADMIN'`을 본다든지.

**Files:**
- Create: `tests/functions/integration.test.ts`

**Interfaces:**
- Consumes: `createTenant`(Task 3), `getAccountState`(Task 2), 계획 1의 `firestore.rules`
- Produces: 없음 (검증 전용)

- [ ] **Step 1: 통합 테스트 작성**

Create `tests/functions/integration.test.ts`:

```typescript
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { callFn, seed, clearAll, teardown } from './helpers';
import { getApps, getApp, initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCustomToken } from 'firebase/auth';
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, collection, getDocs,
} from 'firebase/firestore';
import { getApps as getAdminApps, initializeApp as initAdmin } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

const PROJECT_ID = 'demo-erp-saas';

/**
 * 규칙이 적용되는 클라이언트 Firestore.
 * helpers.ts 의 callFn 과 같은 앱을 쓰면 Functions 용 설정과 섞이므로 별도 앱으로 만든다.
 */
function ruledClient() {
  const name = 'integration-client';
  const app = getApps().find((a) => a.name === name)
    ?? initializeApp({ projectId: PROJECT_ID, apiKey: 'fake-api-key-for-emulator' }, name);
  const auth = getAuth(app);
  const fs = getFirestore(app);
  const marker = app as unknown as { _wired?: boolean };
  if (!marker._wired) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(fs, '127.0.0.1', 8080);
    marker._wired = true;
  }
  return { auth, fs };
}

async function signInAs(uid: string) {
  if (getAdminApps().length === 0) initAdmin({ projectId: PROJECT_ID });
  const token = await getAdminAuth().createCustomToken(uid);
  const { auth, fs } = ruledClient();
  await signInWithCustomToken(auth, token);
  return fs;
}

const GAGE = encodeURIComponent('가게');

describe('서버 함수와 보안규칙의 통합', () => {
  beforeEach(async () => {
    await clearAll();
  });

  afterAll(async () => {
    await teardown();
  });

  it('서버가 만든 회사를 그 관리자가 규칙을 통과해 실제로 쓸 수 있다', async () => {
    await seed(async (db) => {
      await db.doc('signup_verifications/owner').set({
        phone: '01012345678',
        phoneVerifiedAt: new Date().toISOString(),
      });
    });
    const { tenantId } = await callFn<{ tenantId: string }>(
      'createTenant',
      { companyName: '통합사', branchNames: ['가게'] },
      'owner',
    );

    const fs = await signInAs('owner');

    // 회사 메타를 읽을 수 있다 (규칙: 활성 회사의 소속 구성원)
    const tenant = await getDoc(doc(fs, 'tenants', tenantId));
    expect(tenant.exists()).toBe(true);
    expect(tenant.get('companyName')).toBe('통합사');

    // 지점 목록을 조회할 수 있다 (규칙: public_branches 는 list 허용)
    const branches = await getDocs(collection(fs, 'tenants', tenantId, 'public_branches'));
    expect(branches.docs.map((d) => d.id)).toEqual([GAGE]);

    // 담당 지점의 일반 데이터를 쓸 수 있다
    await setDoc(doc(fs, 'tenants', tenantId, 'shared_data', `${GAGE}--gen--memo`), { v: 1 });

    // 담당 지점의 급여 데이터도 쓸 수 있다 (생성자는 salaryBranchesEncoded 를 갖는다)
    await setDoc(doc(fs, 'tenants', tenantId, 'shared_data', `${GAGE}--salary--2026-08`), { v: 1 });

    // 일일마감 문서도 쓸 수 있다
    await setDoc(doc(fs, 'tenants', tenantId, 'daily_settles', `${GAGE}--2026-08-01`), { master: {} });
  });

  it('생성자여도 등급 축은 뚫리지 않는다 — _all/_admin 급여는 거부된다', async () => {
    await seed(async (db) => {
      await db.doc('signup_verifications/owner').set({
        phone: '01012345678',
        phoneVerifiedAt: new Date().toISOString(),
      });
    });
    const { tenantId } = await callFn<{ tenantId: string }>(
      'createTenant', { companyName: '통합사', branchNames: ['가게'] }, 'owner',
    );

    const fs = await signInAs('owner');

    // _all--salary-- 는 존재 자체를 인정하지 않는다 (설계서 §3.4)
    await expect(
      setDoc(doc(fs, 'tenants', tenantId, 'shared_data', '_all--salary--leak'), { v: 1 }),
    ).rejects.toThrow(/permission/i);

    // _admin--salary-- 는 salaryBranchesEncoded 에 '_admin' 이 있어야 한다.
    // createTenant 는 지점만 넣으므로 생성자도 여기엔 접근하지 못한다.
    await expect(
      setDoc(doc(fs, 'tenants', tenantId, 'shared_data', '_admin--salary--total'), { v: 1 }),
    ).rejects.toThrow(/permission/i);

    // 반면 _admin--gen-- 은 관리자이므로 쓸 수 있다 — 막는 쪽만 맞고 여는 쪽이 깨진 상태를 배제한다
    await setDoc(doc(fs, 'tenants', tenantId, 'shared_data', '_admin--gen--config'), { v: 1 });
  });

  it('다른 회사 사람은 그 회사 데이터를 읽지 못한다', async () => {
    for (const uid of ['ownerA', 'ownerB']) {
      await seed(async (db) => {
        await db.doc(`signup_verifications/${uid}`).set({
          phone: '01000000000',
          phoneVerifiedAt: new Date().toISOString(),
        });
      });
    }
    const a = await callFn<{ tenantId: string }>(
      'createTenant', { companyName: 'A사', branchNames: ['가게'] }, 'ownerA',
    );
    await callFn<{ tenantId: string }>(
      'createTenant', { companyName: 'B사', branchNames: ['가게'] }, 'ownerB',
    );

    const fs = await signInAs('ownerB');
    await expect(getDoc(doc(fs, 'tenants', a.tenantId))).rejects.toThrow(/permission/i);
    await expect(
      getDoc(doc(fs, 'tenants', a.tenantId, 'shared_data', `${GAGE}--salary--2026-08`)),
    ).rejects.toThrow(/permission/i);
  });

  it('회사를 정지시키면 그 관리자도 데이터를 못 읽고, 이유는 getAccountState 로 알 수 있다', async () => {
    await seed(async (db) => {
      await db.doc('signup_verifications/owner').set({
        phone: '01012345678',
        phoneVerifiedAt: new Date().toISOString(),
      });
    });
    const { tenantId } = await callFn<{ tenantId: string }>(
      'createTenant', { companyName: '정지될사', branchNames: ['가게'] }, 'owner',
    );

    await seed(async (db) => {
      await db.doc(`tenants/${tenantId}`).update({ status: 'suspended' });
    });

    const fs = await signInAs('owner');
    await expect(getDoc(doc(fs, 'tenants', tenantId))).rejects.toThrow(/permission/i);

    const state = await callFn<Record<string, unknown>>('getAccountState', {}, 'owner');
    expect(state.state).toBe('tenant_suspended');
    // 이유 코드만. 회사명이 새어 나오면 "정지 안내 통로"가 "데이터 조회 통로"가 된다(설계서 §3.3)
    expect(Object.keys(state)).toEqual(['state']);
  });

  it('생성자는 소속·권한 문서를 직접 고칠 수 없다', async () => {
    await seed(async (db) => {
      await db.doc('signup_verifications/owner').set({
        phone: '01012345678',
        phoneVerifiedAt: new Date().toISOString(),
      });
    });
    const { tenantId } = await callFn<{ tenantId: string }>(
      'createTenant', { companyName: '통합사', branchNames: ['가게'] }, 'owner',
    );

    const fs = await signInAs('owner');
    await expect(setDoc(doc(fs, 'users', 'owner'), { tenantId: 'other' })).rejects.toThrow(/permission/i);
    await expect(
      setDoc(doc(fs, 'tenants', tenantId, 'members', 'owner'), { role: 'admin' }),
    ).rejects.toThrow(/permission/i);
    await expect(
      setDoc(doc(fs, 'tenants', tenantId), { status: 'active' }),
    ).rejects.toThrow(/permission/i);
  });
});
```

첫 번째 테스트가 이 Task의 핵심이다. **계획 1의 테스트 119개는 전부 "막힌다"를 확인했고, 이건 "열린다"를 확인한다.** 둘 다 있어야 시스템이 동작한다고 말할 수 있다.

- [ ] **Step 2: 실행 — 통과 확인**

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
npm run test:functions
```

Expected: 전부 PASS.

**첫 번째 테스트가 실패하면 그것이 이 Task의 성과다.** 서버가 쓰는 필드와 규칙이 읽는 필드가 어긋난 것이다. 실패 메시지의 어느 줄에서 막혔는지 보고, `firestore.rules`의 해당 조항과 `createTenant.ts`가 쓰는 필드 이름·값을 대조한다. **규칙을 느슨하게 고쳐서 통과시키지 말 것** — 어느 쪽이 틀렸는지 판단해서 고친다.

- [ ] **Step 3: 전체 테스트 실행**

```bash
npm run test:all
```

Expected: 규칙 119 + Functions 전부 PASS.

- [ ] **Step 4: README 갱신**

`README.md`의 실행 절에 추가한다:

```markdown
## 실행

    npm install
    npm install --prefix functions

    npm run test:rules        # 보안규칙 (Firestore 에뮬레이터)
    npm run test:functions    # 서버 함수 (Auth + Firestore + Functions 에뮬레이터)
    npm run test:all          # 둘 다

**Java(JDK 11+, 21에서 검증)가 필요하다.** Firestore 에뮬레이터가 Java 프로그램이다.
설치돼 있어도 셸에 PATH 가 안 잡히는 경우가 있다 — 그때는 아래를 먼저 실행한다.

    export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot"
    export PATH="$JAVA_HOME/bin:$PATH"
```

- [ ] **Step 5: 커밋**

```bash
git add tests/functions/integration.test.ts README.md
git commit -F - <<'EOF'
test: 규칙과 서버 함수의 통합 검증

계획 1 의 테스트는 전부 "막힌다"를 확인했다. 이건 "열린다"를 확인한다.
서버가 만든 회사를 그 관리자가 실제 보안규칙을 통과해 읽고 쓸 수 있어야
시스템이 동작한다고 말할 수 있다.

정지된 회사에서 데이터는 막히고 이유만 getAccountState 로 나오는 경로,
생성자조차 소속·권한 문서를 직접 못 고치는 것도 함께 고정한다.
EOF
```

---

## 이 계획이 끝나면

**할 수 있게 되는 것**: 가입한 사람이 회사를 만들고, 그 회사의 관리자로서 규칙이 허용하는 데이터를 실제로 읽고 쓴다. 정지되면 이유를 안다.

**아직 못 하는 것**: 직원을 초대할 수 없다(계획 3). 카카오·네이버로 로그인할 수 없다(계획 5). 화면이 없다(계획 4).

**여전히 클라우드 자원 0** — 전부 에뮬레이터에서 돈다. `erp_ugd` 영향도 0.

| 계획 | 내용 |
|---|---|
| 3 | 초대 3종 + `updateMember` + `setTenantStatus` — "직원이 합류한다" |
| 4 | 앱 화면 이관 — **`list` 봉쇄 때문에 조회 방식 재설계 포함**(설계서 §2.2) |
| 5 | 카카오·네이버 로그인 + 휴대폰 본인확인 (외부 검수·계약 필요) |
| 6 | 기능 on/off + 최고관리자 화면 |
| 7 | 제품명·로고·약관 |

---

## 자체 점검 결과

**설계서 대조** — 이 계획이 덮는 범위는 §3.5의 `getAccountState`·`createTenant`, §4.3의 회사 생성 경로, §4.5의 남용 방어 중 3가지(본인확인 선행·한 계정 한 회사·무작위 회사ID)다.

**§4.5의 나머지 2가지를 다루지 않는 이유**:

| 방어 | 왜 여기 없나 |
|---|---|
| 문자 발송 속도 제한 | 문자 발송 함수 자체가 계획 5다 |
| 최고관리자 화면에서 회사 정지 | `setTenantStatus`는 계획 3 |

**타입 일관성 확인**: Task 2가 정의한 `AccountState`의 `tenantId`·`companyName`·`role` 필드명이 Task 3의 `createTenant`가 쓰는 필드명(`companyName`, `role`)과 일치한다. Task 4의 통합 테스트가 이 일치를 실행으로 확인한다.

**계획 1과의 필드 대조**: `createTenant`가 쓰는 `status: 'active'`, `role: 'admin'`, `branchIsolation: true`, `allowedBranchesEncoded`, `salaryBranchesEncoded`는 계획 1의 `firestore.rules`가 읽는 이름·값과 같다. 대조는 Task 4가 실행으로 한다 — 눈으로 맞춘 것을 믿지 않는다.
(코덱스가 실제 `erp_saas/firestore.rules`와 한 글자씩 대조해 일치를 확인했다.)

---

## Codex 리뷰 반영 이력 (2026-08-17, 5건)

| # | 지적 | 반영 |
|---|---|---|
| **P0** | `getAccountState`가 정지 상태에서 `companyName`을 반환 — 설계서 §3.3 "한 글자도 주지 않는다" 위반. **게다가 테스트가 그 위반을 통과 조건으로 고정** | Task 2 — 막힌 상태는 이유 코드만 반환. 테스트를 `Object.keys(r) === ['state']`로 바꿔 **반대 방향으로 고정**. Task 4 통합 테스트도 동일 |
| P1 | `branchNames` 상한이 없어 Firestore 트랜잭션 쓰기 500건 한도를 넘길 수 있음(지점 498개) | Task 3 — `MAX_BRANCHES = 100` + 경계 테스트 2건(100 통과 / 101 거부) |
| P1 | `tx.set`이라 회사ID 충돌 시 **남의 회사 문서를 덮어씀** | Task 3 — `tx.create`로 교체. "예측 불가능"과 "유일함"은 다른 성질 |
| P1 | 커스텀 토큰 로그인 후 `email`/`email_verified`가 실제로 실리는지 미검증 (공식 문서로도 확인 불가) | Task 1 — ID 토큰 클레임을 **직접 assert**하는 테스트 추가 + 실패 시 대안 경로 명시 |
| P1 | Task 4 통합 테스트가 급여 축의 정상 경로만 확인 | Task 4 — `_all--salary--`·`_admin--salary--` 거부 + `_admin--gen--` 허용 케이스 추가 |

**P0에서 배울 것**: 계획서의 Global Constraints에는 "회사 데이터는 한 글자도 반환하지 않는다"라고
적어놓고, 같은 문서의 타입·구현·테스트 세 곳에서 모두 어겼다. **제약을 적는 것과 지키는 것은
별개의 일이고, 테스트가 위반을 고정하면 그 위반은 영구화된다.** 설계서 §11.3이 같은 교훈을
이미 기록했는데(불변식을 세웠으면 그걸 건드리는 모든 조항을 대조해야 한다) 또 밟았다.
