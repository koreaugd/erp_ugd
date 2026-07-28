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
  // 가입 시 고른 근무지점. 계정 관리 '선택지점' 컬럼의 원본이며, 총괄이 허용 지점을 넓혀도 이 값은 바뀌지 않는다.
  workBranch: string;
  // 2026-07-28: 역할 3단계. 화면 표시는 지점 / 지점관리자 / 총괄(설계서 §15.1).
  // 내부 값 "admin"은 절대 바꾸지 말 것 — 규칙(isPersonalAdmin)·세션·기존 문서가 전부 이 값을 쓴다.
  role: "admin" | "branchAdmin" | "branch";
  allowedTabs: string[] | "all";
  allowedBranches: string[] | "all";
  // 관리자 화면 탭 권한(2026-07-25 신설). 옵셔널 — 필드가 없으면 "all"로 취급한다(기존 관리자 문서 하위호환).
  // NEW_PROFILE_DEFAULTS에는 절대 넣지 말 것: firestore.rules create hasOnly 목록과 어긋나면 가입이 죽는다.
  allowedAdminTabs?: string[] | "all";
  // 정직원 급여대장 열람 허용 지점(2026-07-27). 개인정보(급여·주민번호·계좌)라 별도 권한으로 격리한다.
  // "all"=총관리자(전 지점), string[]=해당 지점만, 없음/[]=열람 불가(기본).
  // 옵셔널 — 기존 문서에는 없다(없으면 열람 불가로 취급). firestore.rules의 canReadSalary와 짝.
  salaryBranches?: string[] | "all";
  // 위 목록의 encodeURIComponent 형태. shared_data 문서 ID가 인코딩되어 저장되는데
  // Firestore 규칙에는 URL 디코딩이 없어 한글 지점명을 원문과 비교할 수 없다 —
  // 그래서 규칙이 그대로 비교할 수 있도록 인코딩본을 함께 저장한다(saveSalaryBranches가 항상 같이 갱신).
  salaryBranchesEncoded?: string[] | "all";
  // allowedBranches의 인코딩본. 급여대장 규칙이 "급여 허용 지점이 일반 허용 지점 안에 있는가"를
  // 서버에서 확인하는 데 쓴다(화면만 막으면 개발자도구로 뚫린다). 저장은 withEncodedBranchLists가 전담.
  allowedBranchesEncoded?: string[] | "all";
  status: "active" | "suspended";
  createdAt: string;
  reviewedByAdmin: boolean;
}

// 신규 가입 기본값 — firestore.rules의 create 조건과 글자 단위로 일치해야 한다.
// 2026-07-25 사용자 지시: 신규 가입은 지점 화면 전 탭 허용("all"). PIN 게이트가 외부인을 막으므로
// 게이트를 통과한 계정은 기존 PIN 로그인과 같은 범위로 시작하고, 제한이 필요할 때만 관리자가 좁힌다.
// allowedBranches는 가입자마다 다르므로(선택한 근무지점 한 곳) 여기 두지 않고 createUserProfile에서 채운다.
const NEW_PROFILE_DEFAULTS = {
  role: "branch" as const,
  allowedTabs: "all" as const,
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
  // 지점 전환 편의: 2026-07-29 00:00 KST(=1785250800000ms) 전 가입은 자동 승인한다.
  // 이후 가입은 다시 관리자 승인 필요(미승인). 이 값은 firestore.rules의 시간 조건과 반드시 일치시킬 것.
  // role은 항상 NEW_PROFILE_DEFAULTS의 "branch" 유지 — 자동승인은 reviewedByAdmin만 바꾼다(관리자 자동생성 금지).
  const AUTO_APPROVE_UNTIL_MS = 1785250800000;
  const workBranch = input.workBranch.trim();
  if (!workBranch) throw new Error("근무지점을 선택해 주세요.");
  const profile: Omit<UserProfile, "uid"> = {
    name: input.name.trim(),
    email: user.email || "",
    phone: input.phone.trim(),
    workBranch,
    createdAt: new Date().toISOString(),
    ...NEW_PROFILE_DEFAULTS,
    // 2026-07-28 사용자 지시: 가입자는 자기가 고른 지점 한 곳만 볼 수 있다("전체" 기본값 폐지).
    // firestore.rules의 create 조건(allowedBranches == [workBranch])과 반드시 같은 값이어야 가입이 통과한다.
    allowedBranches: [workBranch],
    reviewedByAdmin: Date.now() < AUTO_APPROVE_UNTIL_MS
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
  await updateDoc(doc(db, "users", uid), withEncodedBranchLists(patch));
}

const encodeBranchList = (value: string[] | "all") =>
  value === "all" ? "all" : value.map((b) => encodeURIComponent(String(b || "").trim()));

/**
 * 지점 목록을 쓸 때 규칙이 비교할 인코딩본을 항상 함께 채운다.
 *   salaryBranches  → salaryBranchesEncoded
 *   allowedBranches → allowedBranchesEncoded
 * shared_data 문서 ID가 encodeURIComponent 되어 저장되는데 Firestore 규칙에는 URL 디코딩이 없어
 * 한글 지점명을 원문과 비교할 수 없다. 그래서 규칙이 그대로 비교할 수 있는 인코딩본을 같이 둔다.
 * 둘이 어긋나면 화면과 규칙의 판정이 달라지므로(권한이 있는데 데이터가 막히는 사고) 반드시 이 경로로만 저장할 것.
 */
export function withEncodedBranchLists<
  T extends { salaryBranches?: string[] | "all"; allowedBranches?: string[] | "all" }
>(patch: T): T & { salaryBranchesEncoded?: string[] | "all"; allowedBranchesEncoded?: string[] | "all" } {
  const next: Record<string, unknown> = { ...patch };
  if (patch.salaryBranches !== undefined) next.salaryBranchesEncoded = encodeBranchList(patch.salaryBranches);
  if (patch.allowedBranches !== undefined) next.allowedBranchesEncoded = encodeBranchList(patch.allowedBranches);
  return next as T & { salaryBranchesEncoded?: string[] | "all"; allowedBranchesEncoded?: string[] | "all" };
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
