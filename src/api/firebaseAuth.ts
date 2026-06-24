import { getApps, getApp, initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut, updatePassword } from "firebase/auth";
import { collection, getDocs, getFirestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import type { BranchSetting } from "./gasClient";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const firebasePassword = (pin: string) => `ugd-${pin}`;

const LOGIN_BRANCH_FALLBACK: LoginBranch[] = [
  "대물섬 한남점", "대물섬 종로점", "남산광어", "사카바단단", "8번대물집", "카츠스위스", "오키스테이크하우스", "대학로고래", "연하동 연남본점", "연하동 대학로점", "강남대골뼈국", "마음죽", "카라멘야"
].map((branchName, index) => ({ branchId: String(index + 1).padStart(2, "0"), branchName, brand: branchName, role: "branch", loginEmail: `branch-${String(index + 1).padStart(2, "0")}@ugd-erp.example`, isActive: true }));

export interface LoginBranch extends BranchSetting {
  loginEmail: string;
  branchId: string;
  isActive: boolean;
}

export async function getFirebaseLoginBranches(): Promise<LoginBranch[]> {
  try {
    const snapshot = await getDocs(collection(db, "public_branches"));
    const branches = snapshot.docs
      .map((item) => item.data() as LoginBranch)
      .filter((branch) => branch?.branchName && branch?.loginEmail && branch?.isActive !== false)
      .sort((a, b) => String(a.branchId || "").localeCompare(String(b.branchId || "")));
    return branches.length > 0 ? branches : LOGIN_BRANCH_FALLBACK;
  } catch {
    return LOGIN_BRANCH_FALLBACK;
  }
}

export async function loginWithBranchPin(branch: LoginBranch, pin: string) {
  await signInWithEmailAndPassword(auth, branch.loginEmail, firebasePassword(pin.trim()));
  return { branchName: branch.branchName, brand: branch.brand || branch.branchName, role: "branch" as const };
}

export async function loginWithAdminPin(pin: string) {
  await signInWithEmailAndPassword(auth, "admin@ugd-erp.example", firebasePassword(pin.trim()));
  return { branchName: "관리자", brand: "본사", role: "admin" as const };
}

export async function logoutFirebase() {
  await signOut(auth);
}

export interface ChangeLoginPinsInput {
  currentAdminPin: string;
  currentBranchPin?: string;
  newAdminPin?: string;
  newBranchPin?: string;
}

/**
 * Spark 요금제에서는 서버용 Admin SDK/Cloud Function을 쓰지 않고, 관리자가
 * 각 내부 로그인 계정에 재인증해 비밀번호를 변경합니다. 어느 한 지점에서
 * 실패하면 이미 변경한 지점 계정은 가능한 범위에서 원래 PIN으로 되돌립니다.
 */
export async function changeFirebaseLoginPins(input: ChangeLoginPinsInput) {
  const currentAdminPin = input.currentAdminPin.trim();
  const currentBranchPin = input.currentBranchPin?.trim();
  const newAdminPin = input.newAdminPin?.trim();
  const newBranchPin = input.newBranchPin?.trim();

  if (!currentAdminPin) throw new Error("현재 관리자 PIN을 입력해 주세요.");
  if (!newAdminPin && !newBranchPin) throw new Error("변경할 PIN을 하나 이상 입력해 주세요.");
  if (newBranchPin && !currentBranchPin) throw new Error("현재 지점 공통 PIN을 입력해 주세요.");

  // 관리자 PIN부터 확인해 관리자 화면에서의 오입력을 막습니다.
  await signInWithEmailAndPassword(auth, "admin@ugd-erp.example", firebasePassword(currentAdminPin));
  const changedBranchEmails: string[] = [];

  try {
    if (newBranchPin && currentBranchPin) {
      const branches = await getFirebaseLoginBranches();
      for (const branch of branches) {
        await signInWithEmailAndPassword(auth, branch.loginEmail, firebasePassword(currentBranchPin));
        if (!auth.currentUser) throw new Error(`${branch.branchName} 계정 인증에 실패했습니다.`);
        await updatePassword(auth.currentUser, firebasePassword(newBranchPin));
        changedBranchEmails.push(branch.loginEmail);
      }
    }

    // 지점 계정들을 순회하며 바뀐 로그인 상태를 관리자 계정으로 복구합니다.
    await signInWithEmailAndPassword(auth, "admin@ugd-erp.example", firebasePassword(currentAdminPin));
    if (newAdminPin) {
      if (!auth.currentUser) throw new Error("관리자 계정을 확인하지 못했습니다.");
      await updatePassword(auth.currentUser, firebasePassword(newAdminPin));
    }

    return { changedBranches: changedBranchEmails.length, changedAdmin: Boolean(newAdminPin) };
  } catch (error) {
    // 공통 PIN 변경은 모두 적용되거나, 실패 시 가능한 한 기존 PIN으로 되돌립니다.
    if (newBranchPin && currentBranchPin) {
      for (const email of changedBranchEmails) {
        try {
          await signInWithEmailAndPassword(auth, email, firebasePassword(newBranchPin));
          if (auth.currentUser) await updatePassword(auth.currentUser, firebasePassword(currentBranchPin));
        } catch (rollbackError) {
          console.error("지점 PIN 롤백 실패:", email, rollbackError);
        }
      }
    }
    try {
      await signInWithEmailAndPassword(auth, "admin@ugd-erp.example", firebasePassword(currentAdminPin));
    } catch {
      // 원래 오류를 그대로 안내합니다.
    }
    throw error;
  }
}
