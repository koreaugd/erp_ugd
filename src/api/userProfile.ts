// src/api/userProfile.ts
// 개인 계정 프로필(users/{uid}) 로드·생성. PIN 로그인 세션은 이 모듈을 쓰지 않는다.
import { getApps, getApp, initializeApp } from "firebase/app";
import { doc, getDoc, setDoc, getFirestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  // 가입 시 필수 입력(2026-07-27). 구글 가입도 온보딩 폼에서 연락처·근무지점을 받아 채운다.
  // firestore.rules users create hasOnly 목록과 반드시 함께 유지할 것.
  phone: string;
  workBranch: string;
  role: "admin" | "branch";
  allowedTabs: string[] | "all";
  allowedBranches: string[] | "all";
  // 관리자 화면 탭 권한(2026-07-25 신설). 옵셔널 — 필드가 없으면 "all"로 취급한다(기존 관리자 문서 하위호환).
  // NEW_PROFILE_DEFAULTS에는 절대 넣지 말 것: firestore.rules create hasOnly 목록과 어긋나면 가입이 죽는다.
  allowedAdminTabs?: string[] | "all";
  status: "active" | "suspended";
  createdAt: string;
  reviewedByAdmin: boolean;
}

// 신규 가입 기본값 — firestore.rules의 create 조건과 글자 단위로 일치해야 한다.
// 2026-07-25 사용자 지시: 신규 가입은 지점 화면 전 탭 허용("all"). PIN 게이트가 외부인을 막으므로
// 게이트를 통과한 계정은 기존 PIN 로그인과 같은 범위로 시작하고, 제한이 필요할 때만 관리자가 좁힌다.
const NEW_PROFILE_DEFAULTS = {
  role: "branch" as const,
  allowedTabs: "all" as const,
  allowedBranches: "all" as const,
  status: "active" as const,
  reviewedByAdmin: false
};

/**
 * users/{uid} 로드. 없으면 null — 자동 생성하지 않는다(온보딩 폼에서만 생성).
 * 신규 사용자(null)는 호출부(useAuth)가 온보딩 단계로 보낸다.
 */
export async function loadUserProfile(uid: string): Promise<UserProfile | null> {
  const snapshot = await getDoc(doc(db, "users", uid));
  return snapshot.exists() ? { uid, ...(snapshot.data() as Omit<UserProfile, "uid">) } : null;
}

/**
 * 온보딩 폼 제출 시 호출 — 이름·연락처·근무지점을 받아 users 문서를 생성한다.
 * 권한 기본값(NEW_PROFILE_DEFAULTS)은 여기서만 부여하며, firestore.rules create 조건과
 * 글자 단위로 일치해야 한다(어긋나면 가입이 죽는다).
 * 생성 실패 시 throw — 호출부는 반드시 signOut 후 오류를 안내한다(설계서 §4: 유령 세션 금지).
 */
export async function createUserProfile(
  user: { uid: string; email: string | null },
  input: { name: string; phone: string; workBranch: string }
): Promise<UserProfile> {
  const ref = doc(db, "users", user.uid);
  const profile: Omit<UserProfile, "uid"> = {
    name: input.name.trim(),
    email: user.email || "",
    phone: input.phone.trim(),
    workBranch: input.workBranch.trim(),
    createdAt: new Date().toISOString(),
    ...NEW_PROFILE_DEFAULTS
  };
  await setDoc(ref, profile);
  return { uid: user.uid, ...profile };
}

/**
 * users 컬렉션 전체 목록. 개인 관리자만 읽을 수 있다(firestore.rules: isPersonalAdmin()).
 * PIN 관리자 세션에서 호출하면 permission-denied로 reject된다 — 호출부가 그 세션에서 부르지 말아야 한다.
 */
export async function listUserProfiles(): Promise<UserProfile[]> {
  const { collection, getDocs } = await import("firebase/firestore");
  const snapshot = await getDocs(collection(db, "users"));
  return snapshot.docs
    .map((d) => ({ uid: d.id, ...(d.data() as Omit<UserProfile, "uid">) }))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

/**
 * users/{uid} 부분 수정. firestore.rules: 개인 관리자만, 본인 문서는 관리자라도 불가.
 */
export async function updateUserProfile(uid: string, patch: Partial<Omit<UserProfile, "uid" | "createdAt" | "email">>): Promise<void> {
  const { updateDoc } = await import("firebase/firestore");
  await updateDoc(doc(db, "users", uid), patch);
}

/**
 * users/{uid} 삭제(기록 초기화). firestore.rules: 개인 관리자만, 본인 문서는 불가.
 * 주의: Firebase Auth 계정 자체는 남는다(Spark — Admin SDK 없음). 삭제된 사용자가 다시 로그인하면
 * 신규 기본값으로 재가입된다 — 접근 차단이 목적이면 삭제가 아니라 status "suspended"를 쓸 것.
 */
export async function deleteUserProfile(uid: string): Promise<void> {
  const { deleteDoc } = await import("firebase/firestore");
  await deleteDoc(doc(db, "users", uid));
}
