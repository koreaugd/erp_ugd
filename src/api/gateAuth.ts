// src/api/gateAuth.ts
// 로그인 후 PIN 게이트 검증 — 보조 Firebase Auth("gate" named app) 사용.
// 절대 주 Auth 인스턴스로 검증하지 말 것: loginWithBranchPin/loginWithAdminPin을 재사용하면
// 개인 계정 세션이 지점/관리자 가짜 계정으로 바뀐다(설계서 §4 gateAuth 규격).
import { getApps, initializeApp } from "firebase/app";
import { initializeAuth, inMemoryPersistence, signInWithEmailAndPassword, signOut, type Auth } from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";
import { hashPin } from "../utils/hashPin";
import { gasClient } from "./gasClient";
import type { LoginBranch } from "./firebaseAuth";

const ADMIN_EMAIL = "admin@ugd-erp.example";
const firebasePassword = (pin: string) => `ugd-${pin.trim()}`;

// initializeAuth는 같은 앱에 두 번 호출하면 오류 — 모듈 스코프 싱글턴으로 1회만.
let gateAuthSingleton: Auth | null = null;
function getGateAuth(): Auth {
  if (gateAuthSingleton) return gateAuthSingleton;
  const gateApp = getApps().find((a) => a.name === "gate") ?? initializeApp(firebaseConfig, "gate");
  gateAuthSingleton = initializeAuth(gateApp, { persistence: inMemoryPersistence });
  return gateAuthSingleton;
}

export type GateTarget = { kind: "admin" } | { kind: "branch"; branch: LoginBranch };

/**
 * PIN 게이트 검증. 통과 시 세션에 보관할 pinHash를 반환한다.
 * 오류 정책(설계서 §4 — 브루트포스 우회 차단):
 *  - 자격증명 오류/시도초과 → 즉시 실패, GAS 폴백 금지
 *  - 네트워크 오류만 GAS verifyPin 폴백(+지점 branchName/관리자 role 필수 비교)
 */
export async function verifyGatePin(target: GateTarget, pin: string): Promise<string> {
  const pinHash = await hashPin(pin);
  const email = target.kind === "admin" ? ADMIN_EMAIL : target.branch.loginEmail;
  const gateAuth = getGateAuth();
  try {
    await signInWithEmailAndPassword(gateAuth, email, firebasePassword(pin));
    return pinHash;
  } catch (error: any) {
    const code = String(error?.code || "");
    if (code === "auth/too-many-requests") {
      throw new Error("시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.");
    }
    if (code === "auth/network-request-failed") {
      // 네트워크 장애만 GAS 폴백 — 현행 useAuth 폴백과 동일한 비교를 강제한다.
      const setting = await gasClient.verifyPin(pinHash);
      if (target.kind === "admin" && setting.role !== "admin") throw new Error("관리자 PIN이 올바르지 않습니다.");
      if (target.kind === "branch" && setting.branchName !== target.branch.branchName) throw new Error("PIN이 올바르지 않습니다.");
      return pinHash;
    }
    // wrong-password / invalid-credential / user-not-found 등 자격증명 오류: 폴백 없이 실패.
    throw new Error("PIN이 올바르지 않습니다. 다시 확인해 주세요.");
  } finally {
    // 반환 전에 gate 인스턴스의 인증 상태를 반드시 비운다(연속 호출 경합 방지).
    await signOut(gateAuth).catch(() => {});
  }
}
