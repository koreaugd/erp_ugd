import { getApps, getApp, initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut, updatePassword } from "firebase/auth";
import { collection, getDocs, getFirestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import { gasClient, type BranchSetting } from "./gasClient";
import { hashPin } from "../utils/hashPin";

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
 * 각 내부 로그인 계정에 재인증해 비밀번호를 변경합니다.
 *
 * 순서(2026-07-27 Codex P0 재설계 — split-brain 방지):
 *  1) 관리자 PIN 검증 → 2) 구글시트(지점_설정) pin_hash 먼저 갱신(실패 시 시트 롤백 후 중단
 *     — Firebase는 아직 옛 PIN 그대로라 일관 상태 유지) → 3) Firebase 비밀번호 변경
 *     (실패 시 Firebase·시트 모두 옛 PIN으로 롤백 시도).
 * 시트를 앞에 두는 이유: GAS 폴백 로그인·카카오택시 게이트(verifyPin)가 시트 해시를 보므로,
 * 둘 중 하나만 바뀐 채 끝나는 창을 최소화하고, 실패 시 "아무것도 안 바뀐 상태"로 수렴시키기 위함.
 */
export async function changeFirebaseLoginPins(input: ChangeLoginPinsInput) {
  const currentAdminPin = input.currentAdminPin.trim();
  const currentBranchPin = input.currentBranchPin?.trim();
  const newAdminPin = input.newAdminPin?.trim();
  const newBranchPin = input.newBranchPin?.trim();

  if (!currentAdminPin) throw new Error("현재 관리자 PIN을 입력해 주세요.");
  if (!newAdminPin && !newBranchPin) throw new Error("변경할 PIN을 하나 이상 입력해 주세요.");
  if (newBranchPin && !currentBranchPin) throw new Error("현재 지점 공통 PIN을 입력해 주세요.");

  // 1) 관리자 PIN부터 확인해 관리자 화면에서의 오입력을 막습니다.
  await signInWithEmailAndPassword(auth, "admin@ugd-erp.example", firebasePassword(currentAdminPin));

  // 2) 구글시트 pin_hash 갱신 — 대상 행과 새/옛 해시를 먼저 준비한다.
  //    목록 조회부터 실패하면 아무것도 바꾸지 않고 중단(완전 일관).
  let allRows: Awaited<ReturnType<typeof gasClient.getBranchListAll>>;
  try {
    allRows = await gasClient.getBranchListAll();
  } catch {
    throw new Error("지점 목록(시트) 조회에 실패해 중단했습니다. 아무것도 변경되지 않았습니다. 잠시 후 다시 시도해 주세요.");
  }
  const newAdminHash = newAdminPin ? await hashPin(newAdminPin) : null;
  const newBranchHash = newBranchPin ? await hashPin(newBranchPin) : null;
  // 롤백용 '옛 해시'는 시트의 원본 pin_hash 가 아니라 현재 PIN의 재계산 해시다 —
  // getBranchListAll 은 보안상 pin_hash 를 반환하지 않는다. 시트에 평문 등 레거시 형식이
  // 남아 있던 행은 롤백 후 SHA-256 형식으로 바뀔 수 있지만, currentPin 은 방금 Firebase
  // 인증을 통과한 값이므로 verifyPin 검증은 동일하게 통과한다(형식 정규화로 수용 — Codex P1 2026-07-27).
  const oldAdminHash = await hashPin(currentAdminPin);
  const oldBranchHash = currentBranchPin ? await hashPin(currentBranchPin) : null;
  const rowMeta = (row: { brand?: string; role?: string; isActive?: boolean }) =>
    ({ brand: row.brand, role: row.role, isActive: row.isActive });
  const targetRows = allRows
    .map((row) => {
      const isAdminRow = row.role === "admin";
      const nextHash = isAdminRow ? newAdminHash : (row.isActive ? newBranchHash : null);
      const prevHash = isAdminRow ? oldAdminHash : oldBranchHash;
      return nextHash && prevHash ? { row, nextHash, prevHash } : null;
    })
    .filter((t): t is { row: (typeof allRows)[number]; nextHash: string; prevHash: string } => t !== null);

  const sheetSynced: typeof targetRows = [];
  // skipNames: Firebase 쪽 롤백에 실패해 '새 PIN이 적용된 채 남은' 지점 — 그 지점의 시트는
  // 새 해시를 유지해야 지점 단위로나마 Firebase↔시트가 일치한다(split-brain 방지, Codex P0 2026-07-27).
  const rollbackSheet = async (skipNames?: Set<string>) => {
    const failed: string[] = [];
    for (const t of sheetSynced) {
      if (skipNames?.has(t.row.branchName)) continue;
      try {
        await gasClient.updateBranchPin(t.row.branchName, t.prevHash, true, rowMeta(t.row));
      } catch {
        failed.push(t.row.branchName);
      }
    }
    return failed;
  };

  try {
    for (const t of targetRows) {
      await gasClient.updateBranchPin(t.row.branchName, t.nextHash, true, rowMeta(t.row));
      sheetSynced.push(t);
    }
  } catch (sheetError: any) {
    const rollbackFailed = await rollbackSheet();
    if (rollbackFailed.length > 0) {
      throw new Error(`시트 반영에 실패해 중단했습니다. 되돌리기까지 실패한 지점: ${rollbackFailed.join(", ")} — '지점 등록 & 관리'에서 해당 지점 PIN 상태를 확인해 주세요. (Firebase 로그인 PIN은 변경되지 않았습니다)`);
    }
    throw new Error("시트 반영에 실패해 중단했습니다. 아무것도 변경되지 않았습니다. 잠시 후 다시 시도해 주세요.");
  }

  // 3) Firebase 비밀번호 변경 — 실패 시 Firebase·시트를 모두 옛 PIN으로 되돌린다.
  const changedBranchEmails: string[] = [];
  let branchesForChange: LoginBranch[] = [];
  try {
    if (newBranchPin && currentBranchPin) {
      branchesForChange = await getFirebaseLoginBranches();
      for (const branch of branchesForChange) {
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
    // 되돌리기에 실패한 지점은 'Firebase=새 PIN'인 채 남으므로, 그 지점의 시트는 새 해시를
    // 유지시켜 지점 단위 일관성을 지키고 이름을 안내한다(삼키지 않음 — Codex P0 2026-07-27).
    const fbRollbackFailedEmails: string[] = [];
    if (newBranchPin && currentBranchPin) {
      for (const email of changedBranchEmails) {
        try {
          await signInWithEmailAndPassword(auth, email, firebasePassword(newBranchPin));
          if (!auth.currentUser) throw new Error("재인증 실패");
          await updatePassword(auth.currentUser, firebasePassword(currentBranchPin));
        } catch (rollbackError) {
          console.error("지점 PIN 롤백 실패:", email, rollbackError);
          fbRollbackFailedEmails.push(email);
        }
      }
    }
    try {
      await signInWithEmailAndPassword(auth, "admin@ugd-erp.example", firebasePassword(currentAdminPin));
    } catch {
      // 원래 오류를 그대로 안내합니다.
    }
    // 시트는 이미 새 해시로 바뀐 상태 — Firebase 롤백에 성공한(=옛 PIN으로 돌아간) 지점만
    // 옛 해시로 되돌리고, 롤백 실패 지점은 새 해시 유지(위 주석 참조).
    const keepNewHashNames = new Set(
      branchesForChange.filter((b) => fbRollbackFailedEmails.includes(b.loginEmail)).map((b) => b.branchName)
    );
    const sheetRollbackFailed = await rollbackSheet(keepNewHashNames);
    const problems: string[] = [];
    if (keepNewHashNames.size > 0) {
      problems.push(`다음 지점은 되돌리지 못해 '새 지점 PIN'이 적용된 채 남았습니다: ${[...keepNewHashNames].join(", ")}`);
    }
    if (sheetRollbackFailed.length > 0) {
      problems.push(`다음 지점은 시트 되돌리기에 실패했습니다: ${sheetRollbackFailed.join(", ")} — '지점 등록 & 관리'에서 확인해 주세요`);
    }
    if (problems.length > 0) {
      throw new Error(`PIN 변경이 실패해 되돌렸지만 일부가 남았습니다. ${problems.join(" / ")}. 나머지 지점·관리자는 기존 PIN 그대로입니다.`);
    }
    throw error;
  }
}
