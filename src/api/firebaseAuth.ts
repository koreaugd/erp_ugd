import { getApps, getApp, initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
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
