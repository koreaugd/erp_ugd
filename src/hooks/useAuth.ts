// src/hooks/useAuth.ts
import { useState, useEffect, useCallback } from "react";
import { BranchSetting, gasClient } from "../api/gasClient";
import { hashPin } from "../utils/hashPin";
import type { LoginBranch } from "../api/firebaseAuth";
import type { UserProfile } from "../api/userProfile";
import type { GateTarget } from "../api/gateAuth";

export interface UserSession {
  loginType: "personal" | "pin";
  uid?: string;                       // personal만
  name: string;                       // personal=profile.name, pin=branchName("직원"/"관리자")
  email?: string;
  role: "admin" | "branch";
  branchName: string;
  brand: string;
  allowedTabs: string[] | "all";      // pin 로그인은 "all"
  allowedBranches: string[] | "all";  // pin 로그인은 "all"
  allowedAdminTabs: string[] | "all"; // 관리자 화면 탭 권한. pin 로그인/지점 role은 "all"
  pinHash: string;
}

export interface PendingGate {
  profile: UserProfile;
}

const SESSION_KEY = "erp_ugd_session_v2";   // v2: loginType 필수. 구 세션과 절대 혼용 금지(설계서 §4)
const LEGACY_SESSION_KEY = "erp_ugd_session";
const ATTEMPTS_KEY = "erp_ugd_failed_attempts";
const SELECTED_BRANCH_KEY = "erp_ugd_selected_branch";
// 구글 계정 선택창 생략용 힌트(이메일만 저장 — 자격증명 아님). localStorage라 브라우저를 닫아도 유지.
const LAST_GOOGLE_EMAIL_KEY = "erp_ugd_last_google_email";

// 진행 중인 Firebase signOut. 로그아웃 직후 곧바로 재로그인하면 늦게 도착한 signOut이
// 새 로그인 세션을 지워버리는 경합이 있다 — 새 로그인은 이 Promise를 먼저 기다린다.
let logoutInFlight: Promise<void> | null = null;

// 개인 로그인 사전 준비(warm-up) — 로그인 화면이 뜨는 순간 미리 실행해 두면
// "구글로 시작하기" 클릭 시 모듈 로드·앱 초기화·persistence 설정이 이미 끝나 있어
// 팝업이 즉시 열린다(클릭 후 딜레이의 대부분이 이 준비 작업이었음, 2026-07-25).
let personalAuthWarmup: Promise<void> | null = null;
export function warmPersonalAuth(): Promise<void> {
  if (!personalAuthWarmup) {
    personalAuthWarmup = (async () => {
      const { getAuth, setPersistence, browserSessionPersistence } = await import("firebase/auth");
      await import("../api/firebaseAuth");   // 기본 Firebase 앱 초기화(모듈 부수효과)
      const auth = getAuth();
      auth.languageCode = "ko";   // Firebase 발송 메일(비밀번호 재설정·인증)을 한국어 템플릿으로
      await setPersistence(auth, browserSessionPersistence);
    })().catch((e) => {
      personalAuthWarmup = null;   // 실패(오프라인 등) 시 다음 호출에서 재시도할 수 있게 리셋
      throw e;
    });
  }
  return personalAuthWarmup;
}

// Firebase Auth 오류 코드 → 사용자용 한국어 메시지.
function translateAuthError(err: any): string {
  const code = String(err?.code || "");
  switch (code) {
    case "auth/popup-closed-by-user":
      return "로그인 창이 닫혔습니다";
    case "auth/email-already-in-use":
      return "이미 가입된 이메일입니다";
    case "auth/weak-password":
      return "비밀번호는 6자 이상이어야 합니다";
    case "auth/invalid-credential":
    case "auth/wrong-password":
      return "이메일 또는 비밀번호가 올바르지 않습니다";
    default:
      return err?.message || "로그인 중 오류가 발생했습니다.";
  }
}

export function useAuth() {
  const [user, setUser] = useState<UserSession | null>(null);
  const [selectedBranch, setSelectedBranchState] = useState<BranchSetting | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState<number>(0);
  const [pendingGate, setPendingGate] = useState<PendingGate | null>(null);

  // 세션 불러오기
  useEffect(() => {
    let cancelled = false;

    async function recoverPersonalSession(parsedSession: UserSession) {
      try {
        const { getAuth, onAuthStateChanged } = await import("firebase/auth");
        await import("../api/firebaseAuth");   // 기본 앱 초기화 보장 — 없으면 새로고침 복구가 통째로 실패한다
        const auth = getAuth();
        await new Promise<void>((resolve) => {
          const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            unsubscribe();
            if (cancelled) return resolve();
            if (!firebaseUser) {
              // Auth 부재(브라우저 재시작 등) — 세션 폐기.
              sessionStorage.removeItem(SESSION_KEY);
              sessionStorage.removeItem(SELECTED_BRANCH_KEY);
              setUser(null);
              setSelectedBranchState(null);
              return resolve();
            }
            if (firebaseUser.uid !== parsedSession.uid) {
              // Auth 사용자가 저장된 세션의 uid와 다르다 — 다른 계정으로 로그인된 상태.
              // 옛 권한을 절대 신뢰하지 않고 세션·선택지점을 폐기 후 signOut.
              const { signOut } = await import("firebase/auth");
              await signOut(auth);
              sessionStorage.removeItem(SESSION_KEY);
              sessionStorage.removeItem(SELECTED_BRANCH_KEY);
              setUser(null);
              setSelectedBranchState(null);
              return resolve();
            }
            try {
              const { loadOrCreateUserProfile } = await import("../api/userProfile");
              const profile = await loadOrCreateUserProfile(firebaseUser);
              if (profile.status === "suspended") {
                const { signOut } = await import("firebase/auth");
                await signOut(auth);
                sessionStorage.removeItem(SESSION_KEY);
                sessionStorage.removeItem(SELECTED_BRANCH_KEY);
                setUser(null);
                setSelectedBranchState(null);
                return resolve();
              }
              // 프로필 재확인 성공 — fresh 프로필로 세션 필드를 재구성(옛 세션의 권한을 그대로 신뢰하지 않는다).
              const freshSession: UserSession = {
                ...parsedSession,
                name: profile.name,
                role: profile.role,
                allowedTabs: profile.role === "admin" ? "all" : profile.allowedTabs,
                allowedBranches: profile.allowedBranches,
                allowedAdminTabs: profile.role === "admin" ? (profile.allowedAdminTabs ?? "all") : "all"
              };
              sessionStorage.setItem(SESSION_KEY, JSON.stringify(freshSession));
              setUser(freshSession);

              // 재구성된 allowedBranches 기준으로 선택 지점을 재검증 — 목록에 없으면 재선택 강제.
              if (Array.isArray(freshSession.allowedBranches)) {
                const savedBranchRaw = sessionStorage.getItem(SELECTED_BRANCH_KEY);
                if (savedBranchRaw) {
                  try {
                    const savedBranch = JSON.parse(savedBranchRaw);
                    const allowed = freshSession.allowedBranches;
                    if (!savedBranch || !savedBranch.branchName || !allowed.includes(savedBranch.branchName)) {
                      sessionStorage.removeItem(SELECTED_BRANCH_KEY);
                      setSelectedBranchState(null);
                    }
                  } catch {
                    sessionStorage.removeItem(SELECTED_BRANCH_KEY);
                    setSelectedBranchState(null);
                  }
                }
              }
            } catch {
              // 프로필 재로드 실패(오프라인 등) — 이미 게이트 통과한 세션이므로 유지.
              setUser(parsedSession);
            }
            resolve();
          });
        });
      } catch (e) {
        console.error("개인 세션 복구 실패:", e);
        setUser(parsedSession);
      }
    }

    (async () => {
      try {
        // legacy v1 세션은 절대 혼용하지 않는다 — 항상 삭제만.
        sessionStorage.removeItem(LEGACY_SESSION_KEY);

        const savedBranch = sessionStorage.getItem(SELECTED_BRANCH_KEY);
        if (savedBranch) {
          const parsedBranch = JSON.parse(savedBranch);
          if (parsedBranch && parsedBranch.branchName) {
            setSelectedBranchState(parsedBranch);
          } else {
            sessionStorage.removeItem(SELECTED_BRANCH_KEY);
          }
        }

        const attempts = localStorage.getItem(ATTEMPTS_KEY);
        if (attempts) {
          setFailedAttempts(parseInt(attempts, 10));
        }

        const savedSession = sessionStorage.getItem(SESSION_KEY);
        let hasV2Session = false;
        if (savedSession) {
          const parsedSession = JSON.parse(savedSession);
          if (parsedSession && parsedSession.loginType && parsedSession.branchName) {
            // 구버전 v2 세션(allowedAdminTabs 필드 신설 이전) 복구 대비 — 없으면 "all"로 보정.
            if (parsedSession.allowedAdminTabs === undefined) parsedSession.allowedAdminTabs = "all";
            hasV2Session = true;
            if (parsedSession.loginType === "personal") {
              await recoverPersonalSession(parsedSession);
            } else {
              setUser(parsedSession);
            }
          } else {
            sessionStorage.removeItem(SESSION_KEY);
          }
        }

        if (!hasV2Session) {
          // v2 세션이 없는 초기 마운트 — 게이트를 통과하지 못한 유령 개인 Auth 상태를 정리한다.
          // 최초 onAuthStateChanged 콜백(초기 hydration)만 보고 즉시 구독 해제.
          // 계속 구독하면 이후 팝업 로그인 성공 순간까지 유령으로 오인해 끊어버리게 된다.
          try {
            const { getAuth, onAuthStateChanged, signOut } = await import("firebase/auth");
            await import("../api/firebaseAuth");   // 기본 앱 초기화 보장 — 없으면 getAuth()가 던져 유령 정리가 조용히 무력화된다
            const auth = getAuth();
            await new Promise<void>((resolve) => {
              const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
                unsubscribe();
                if (cancelled) return resolve();
                if (firebaseUser) {
                  await signOut(auth).catch(() => {});
                }
                resolve();
              });
            });
          } catch (e) {
            console.error("유령 Auth 상태 정리 실패:", e);
          }
        }
      } catch (e) {
        console.error("Auth 복구 실패:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (branch: LoginBranch | null, pin: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      if (logoutInFlight) await logoutInFlight;   // 직전 signOut과의 경합 방지(개인 로그인과 동일)
      const pinHash = await hashPin(pin);
      const { loginWithAdminPin, loginWithBranchPin } = await import("../api/firebaseAuth");
      let branchSetting: BranchSetting;
      try {
        branchSetting = branch ? await loginWithBranchPin(branch, pin) : await loginWithAdminPin(pin);
      } catch (firebaseError) {
        branchSetting = await gasClient.verifyPin(pinHash);
        if (branch && branchSetting.branchName !== branch.branchName) {
          throw firebaseError;
        }
        if (!branch && branchSetting.role !== "admin") {
          throw firebaseError;
        }
      }

      const session: UserSession = {
        loginType: "pin",
        name: branchSetting.branchName || "직원",
        role: (branchSetting.role as "admin" | "branch") || "branch",
        branchName: branchSetting.branchName || "직원",
        brand: branchSetting.brand || "",
        allowedTabs: "all",
        allowedBranches: "all",
        allowedAdminTabs: "all",
        pinHash
      };

      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      if (branch) {
        // 로그인 직후에도 React 상태를 즉시 맞춰야 지점 선택 화면이 한 번 더
        // 표시되지 않습니다. (새로고침 시에는 위의 sessionStorage 복구가 담당)
        sessionStorage.setItem(SELECTED_BRANCH_KEY, JSON.stringify(branchSetting));
        setSelectedBranchState(branchSetting);
      } else {
        sessionStorage.removeItem(SELECTED_BRANCH_KEY);
        setSelectedBranchState(null);
      }
      localStorage.setItem(ATTEMPTS_KEY, "0");
      setFailedAttempts(0);
      setUser(session);
      return true;

    } catch (err: any) {
      const nextAttempts = failedAttempts + 1;
      setFailedAttempts(nextAttempts);
      localStorage.setItem(ATTEMPTS_KEY, String(nextAttempts));
      setError(err.message || "PIN 입력 오류입니다. 올바른 PIN 번호를 한 번 더 확인하세요.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [failedAttempts]);

  const startPersonalLogin = useCallback(async (
    mode: "google" | "email-in" | "email-up",
    params?: { name?: string; email?: string; password?: string }
  ): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      // 직전 로그아웃의 signOut이 아직 진행 중이면 먼저 끝낸다 — 새 로그인 세션이 지워지는 경합 방지.
      if (logoutInFlight) await logoutInFlight;
      // 사전 준비(모듈 로드 + 기본 앱 초기화 + persistence) — LoginPage 마운트 때 이미
      // 실행돼 있어 보통은 즉시 통과한다. 미리 안 됐거나 실패했었으면 여기서 수행/재시도.
      // (기본 앱 초기화를 빼먹으면 getAuth()가 app/no-app으로 죽는다 — 스피너 영구 고정 사고, 2026-07-25)
      await warmPersonalAuth();
      const {
        getAuth, signInWithPopup, GoogleAuthProvider,
        signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut
      } = await import("firebase/auth");   // warm-up에서 이미 로드됨 — 캐시 히트라 즉시 반환
      const auth = getAuth();
      if (mode === "google") {
        const provider = new GoogleAuthProvider();
        // 마지막으로 성공한 구글 계정을 힌트로 넘기면, 브라우저에 계정이 여러 개여도
        // 계정 선택창을 건너뛰고 그 계정으로 바로 진행한다(사용자 요청 2026-07-25).
        // 이메일 모양이 아닌 값(오염된 localStorage)은 버린다 — OAuth 흐름 깨짐 방지.
        const lastGoogleEmail = localStorage.getItem(LAST_GOOGLE_EMAIL_KEY);
        const hintUsed = !!lastGoogleEmail && /^[^\s@]{1,64}@[^\s@]{1,255}$/.test(lastGoogleEmail);
        if (lastGoogleEmail && !hintUsed) localStorage.removeItem(LAST_GOOGLE_EMAIL_KEY);
        if (hintUsed) provider.setCustomParameters({ login_hint: lastGoogleEmail! });
        try {
          await signInWithPopup(auth, provider);
        } catch (popupError: any) {
          // 힌트로 자동 진행된 창을 사용자가 닫았다 = 다른 계정을 쓰고 싶다는 신호.
          // 힌트를 지워 다음 클릭에서는 계정 선택창이 뜨게 한다(탈출구).
          if (hintUsed && String(popupError?.code || "").includes("popup-closed")) {
            localStorage.removeItem(LAST_GOOGLE_EMAIL_KEY);
          }
          throw popupError;
        }
        if (auth.currentUser?.email) localStorage.setItem(LAST_GOOGLE_EMAIL_KEY, auth.currentUser.email);
      } else if (mode === "email-in") {
        await signInWithEmailAndPassword(auth, params!.email!, params!.password!);
      } else {
        const credential = await createUserWithEmailAndPassword(auth, params!.email!, params!.password!);
        await updateProfile(credential.user, { displayName: params!.name! });
        // 인증 메일 발송 — 이메일 가입은 게이트에서 인증 링크 확인이 통과 조건이다.
        const { sendEmailVerification } = await import("firebase/auth");
        void sendEmailVerification(credential.user).catch(() => {});
      }
      const firebaseUser = auth.currentUser!;
      let profile: UserProfile;
      try {
        const { loadOrCreateUserProfile } = await import("../api/userProfile");
        profile = await loadOrCreateUserProfile(firebaseUser);
      } catch {
        await signOut(auth);   // 유령 세션 금지: 프로필 없으면 앱 진입 불가(설계서 §4)
        throw new Error("가입 처리에 실패했습니다. 다시 로그인해 주세요.");
      }
      if (profile.status === "suspended") {
        await signOut(auth);
        throw new Error("정지된 계정입니다. 관리자에게 문의해 주세요.");
      }
      setPendingGate({ profile });   // 게이트 화면으로 — 아직 user 세션은 만들지 않는다
      return true;
    } catch (err: any) {
      setError(translateAuthError(err));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const loginWithGoogle = useCallback((): Promise<boolean> => {
    return startPersonalLogin("google");
  }, [startPersonalLogin]);

  const loginWithEmail = useCallback((email: string, password: string): Promise<boolean> => {
    return startPersonalLogin("email-in", { email, password });
  }, [startPersonalLogin]);

  const signUpWithEmail = useCallback((name: string, email: string, password: string): Promise<boolean> => {
    return startPersonalLogin("email-up", { name, email, password });
  }, [startPersonalLogin]);

  const sendPasswordReset = useCallback(async (email: string): Promise<void> => {
    const { getAuth, sendPasswordResetEmail } = await import("firebase/auth");
    await warmPersonalAuth();   // 기본 앱 초기화 + languageCode "ko"(한국어 메일) 보장
    await sendPasswordResetEmail(getAuth(), email);
  }, []);

  const completeGate = useCallback(async (target: GateTarget, pin: string): Promise<boolean> => {
    if (!pendingGate) return false;
    setLoading(true);
    setError(null);

    // 이메일 가입 계정은 인증 링크 확인이 게이트 통과 조건 — 가짜 이메일 차단(사용자 지시 2026-07-25).
    // 구글 로그인은 구글이 이메일을 보증(emailVerified=true)하므로 해당 없음.
    // PIN 실패 카운트와 별개 처리(인증 대기는 '틀린 시도'가 아니다) — 그래서 아래 본 try 밖에서 검사한다.
    {
      const { getAuth } = await import("firebase/auth");
      const currentUser = getAuth().currentUser;
      // 검사 대상은 반드시 pendingGate 프로필과 같은 사용자여야 한다 — 없거나 다르면 fail-closed.
      if (!currentUser || currentUser.uid !== pendingGate.profile.uid) {
        setError("로그인 상태가 만료되었습니다. 처음부터 다시 로그인해 주세요.");
        setLoading(false);
        return false;
      }
      if (currentUser.providerData.some((p) => p.providerId === "password") && !currentUser.emailVerified) {
        try {
          await currentUser.reload();   // 방금 메일의 링크를 눌렀을 수 있으니 최신 상태로 갱신 후 재확인
        } catch {
          // reload 실패(일시 네트워크)는 아래에서 기존 상태 기준으로 판정 — 미인증이면 어차피 차단.
        }
        if (!currentUser.emailVerified) {
          setError("이메일 인증이 필요합니다. 메일함(스팸함 포함)의 인증 링크를 누른 뒤 다시 '입장하기'를 눌러 주세요.");
          setLoading(false);
          return false;
        }
      }
    }

    try {
      // 지점 제한 계정 방어 — 게이트 UI 필터는 숨김일 뿐이므로 여기서도 강제한다.
      if (target.kind === "branch" && pendingGate.profile.allowedBranches !== "all"
        && !pendingGate.profile.allowedBranches.includes(target.branch.branchName)) {
        throw new Error("이 계정으로 접근할 수 없는 지점입니다. 관리자에게 문의해 주세요.");
      }
      const { verifyGatePin } = await import("../api/gateAuth");
      const pinHash = await verifyGatePin(target, pin);
      const profile = pendingGate.profile;
      const branchSetting = target.kind === "branch"
        ? { branchName: target.branch.branchName, brand: target.branch.brand || target.branch.branchName, role: "branch" as const }
        : { branchName: "관리자", brand: "본사", role: "admin" as const };
      const session: UserSession = {
        loginType: "personal",
        uid: profile.uid,
        name: profile.name,
        email: profile.email,
        role: profile.role,
        branchName: branchSetting.branchName,
        brand: branchSetting.brand,
        allowedTabs: profile.role === "admin" ? "all" : profile.allowedTabs,
        allowedBranches: profile.allowedBranches,
        allowedAdminTabs: profile.role === "admin" ? (profile.allowedAdminTabs ?? "all") : "all",
        pinHash
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      if (target.kind === "branch") {
        sessionStorage.setItem(SELECTED_BRANCH_KEY, JSON.stringify(branchSetting));
        setSelectedBranchState(branchSetting);
      }
      localStorage.setItem(ATTEMPTS_KEY, "0");
      setFailedAttempts(0);
      setPendingGate(null);
      setUser(session);
      return true;
    } catch (err: any) {
      const next = failedAttempts + 1;
      setFailedAttempts(next);
      localStorage.setItem(ATTEMPTS_KEY, String(next));
      setError(err.message || "PIN이 올바르지 않습니다.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [pendingGate, failedAttempts]);

  const selectBranch = useCallback((branch: BranchSetting | null) => {
    if (branch && branch.branchName) {
      sessionStorage.setItem(SELECTED_BRANCH_KEY, JSON.stringify(branch));
    } else {
      sessionStorage.removeItem(SELECTED_BRANCH_KEY);
      branch = null;
    }
    setSelectedBranchState(branch);
  }, []);

  const logout = useCallback(() => {
    // 연속 로그아웃 시 먼저 끝난 쪽의 finally가 나중 것을 지우지 않도록, 자기 자신일 때만 비운다.
    const tracked: Promise<void> = import("../api/firebaseAuth")
      .then(({ logoutFirebase }) => logoutFirebase())
      .catch(() => {})
      .finally(() => { if (logoutInFlight === tracked) logoutInFlight = null; });
    logoutInFlight = tracked;
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SELECTED_BRANCH_KEY);
    sessionStorage.removeItem("erp_branch_list_cache");
    setUser(null);
    setSelectedBranchState(null);
    setPendingGate(null);
    setError(null);
  }, []);

  return {
    user,
    selectedBranch,
    selectBranch,
    loading,
    error,
    login,
    logout,
    failedAttempts,
    setError,
    loginWithGoogle,
    loginWithEmail,
    signUpWithEmail,
    sendPasswordReset,
    pendingGate,
    completeGate
  };
}
