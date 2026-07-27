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
  // 정직원 급여대장 열람 허용 지점. "all"=전 지점, string[]=해당 지점만, []=열람 불가.
  // PIN 로그인은 전환기 호환을 위해 "all"(기존 동작 유지 — 비밀번호 잠금이 1차 방어).
  salaryBranches: string[] | "all";
  pinHash: string;
}

export interface PendingGate {
  profile: UserProfile;
}

// 신규 개인계정(users 문서 없음) — 온보딩 폼에서 이름·연락처·근무지점을 받아
// 프로필을 만들 때까지 대기하는 상태. 폼 제출(completeOnboarding) 시 프로필 생성 후 게이트로.
export interface PendingOnboarding {
  uid: string;
  email: string | null;
  suggestedName: string;   // 구글 displayName 또는 이메일 앞부분 — 폼 이름칸 초기값
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
  const [pendingOnboarding, setPendingOnboarding] = useState<PendingOnboarding | null>(null);
  // PIN(회사 게이트)까지 통과했으나 관리자 승인(reviewedByAdmin) 전인 개인계정 — 앱에 진입시키지 않고 대기 화면으로.
  const [pendingApproval, setPendingApproval] = useState<UserProfile | null>(null);

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
              const { loadUserProfile } = await import("../api/userProfile");
              const profile = await loadUserProfile(firebaseUser.uid);
              // 세션 복원 대상은 게이트까지 통과한 사용자다 — 프로필이 없거나(신규 미완료·삭제),
              // 정지됐거나, 관리자 승인(reviewedByAdmin) 전이면 유효하지 않은 세션이므로 폐기한다.
              // 승인 후 취소된 계정도 새로고침 시 여기서 걸러진다(Codex 지적 2026-07-27, no-ship).
              if (!profile || profile.status !== "active" || !profile.reviewedByAdmin) {
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
                allowedAdminTabs: profile.role === "admin" ? (profile.allowedAdminTabs ?? "all") : "all",
                // 급여대장 권한도 매번 fresh 프로필에서 다시 읽는다 — 관리자가 회수하면 새로고침 시 반영된다.
                salaryBranches: profile.salaryBranches ?? []
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
              // fail-closed: 프로필 재확인 실패 시 옛 세션을 신뢰하지 않는다 —
              // 미승인/취소 계정의 재진입을 막는다(Codex 지적 2026-07-27). 재로그인 시 정상 게이트를 다시 탄다.
              try { const { signOut } = await import("firebase/auth"); await signOut(auth); } catch {}
              sessionStorage.removeItem(SESSION_KEY);
              sessionStorage.removeItem(SELECTED_BRANCH_KEY);
              setUser(null);
              setSelectedBranchState(null);
            }
            resolve();
          });
        });
      } catch (e) {
        console.error("개인 세션 복구 실패:", e);
        // fail-closed: 승인 상태를 검증하지 못하면 옛 세션을 폐기하고 재로그인을 유도한다(Codex 지적 2026-07-27).
        try { const { getAuth, signOut } = await import("firebase/auth"); await signOut(getAuth()); } catch {}
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SELECTED_BRANCH_KEY);
        setUser(null);
        setSelectedBranchState(null);
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
            // 구버전 v2 세션(salaryBranches 신설 이전) 보정 — 배포 직후 열려 있던 세션이 급여대장에서 튕기는 것을 막는다.
            // PIN 로그인은 전환기 호환으로 "all"(규칙의 isPinAccount와 같은 취급), 개인 계정은
            // 아래 recoverPersonalSession이 fresh 프로필 값으로 다시 채우므로 임시로 빈 목록을 둔다.
            if (parsedSession.salaryBranches === undefined) {
              parsedSession.salaryBranches = parsedSession.loginType === "pin" ? "all" : [];
            }
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
      } catch (firebaseError: any) {
        // 자격증명 오류(틀린 PIN = invalid-credential/wrong-password)는 GAS 폴백 금지 —
        // 시트에 남은 옛 pin_hash로 옛 PIN이 계속 통과하는 구멍이었다(2026-07-27 실제 발생).
        // 폴백 허용은 두 경우뿐: ①네트워크 장애(gateAuth §4와 동일) ②Auth 계정 자체가 없는
        // 레거시 지점(user-not-found — 시트에만 등록되고 Auth 프로비저닝이 안 된 경우.
        // 단, 이메일 열거 보호가 켜진 프로젝트에서는 invalid-credential로 뭉개져 이 폴백이
        // 안 탈 수 있다 — 그 지점은 관리자 화면에서 PIN 재설정/재등록으로 복구).
        const fbCode = String(firebaseError?.code || "");
        if (fbCode !== "auth/network-request-failed" && fbCode !== "auth/user-not-found") {
          throw firebaseError;
        }
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
        // PIN 로그인은 전환기 동안 기존 동작 유지 — 급여대장은 탭의 비밀번호 잠금이 1차 방어.
        salaryBranches: "all",
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
      // Firebase 오류(code 있음)는 영어 원문이라 한국어 안내로 바꾼다. 일반 Error는 메시지 유지.
      setError(
        err?.code === "auth/too-many-requests" ? "시도가 너무 많습니다. 잠시 후 다시 시도해 주세요."
          : err?.code ? "PIN이 올바르지 않습니다. 다시 확인해 주세요."
          : (err.message || "PIN 입력 오류입니다. 올바른 PIN 번호를 한 번 더 확인하세요.")
      );
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
        if (hintUsed) {
          provider.setCustomParameters({ login_hint: lastGoogleEmail! });
        } else {
          // 힌트가 없으면(최초 로그인 또는 "다른 계정으로 로그인" 후) 계정 선택창을 강제한다 —
          // 안 그러면 브라우저에 구글 계정이 하나뿐일 때 그 계정으로 자동 로그인돼 선택창이 안 뜬다(Codex 지적 2026-07-27).
          provider.setCustomParameters({ prompt: "select_account" });
        }
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
      let profile: UserProfile | null;
      try {
        const { loadUserProfile } = await import("../api/userProfile");
        profile = await loadUserProfile(firebaseUser.uid);
      } catch {
        await signOut(auth);   // 유령 세션 금지: 프로필 조회 실패 시 앱 진입 불가(설계서 §4)
        throw new Error("가입 처리에 실패했습니다. 다시 로그인해 주세요.");
      }
      if (!profile) {
        // 신규 사용자 — 프로필을 자동 생성하지 않고 온보딩 폼으로 보낸다.
        // 이름·연락처·근무지점을 받아 completeOnboarding에서 생성한다.
        setPendingOnboarding({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          suggestedName: firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split("@")[0] : "")
        });
        return true;
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
      // 관리자 승인 전 개인계정 — 회사 PIN은 통과했지만 데이터 접근은 불가(firestore.rules canAccessWork와 짝).
      // role admin도 예외 없이 승인(reviewedByAdmin)을 요구한다 — 미승인 admin 우회 차단(Codex 지적 2026-07-27).
      if (!profile.reviewedByAdmin) {
        localStorage.setItem(ATTEMPTS_KEY, "0");
        setFailedAttempts(0);
        setPendingGate(null);
        setPendingApproval(profile);
        return true;
      }
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
        // 급여대장 열람 권한 — 미지정(기존 문서)은 열람 불가로 취급한다(fail-closed).
        salaryBranches: profile.salaryBranches ?? [],
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

  // 온보딩 폼 제출 — 신규 개인계정의 이름·연락처·근무지점을 받아 프로필을 생성하고,
  // 이어서 회사 게이트(지점 선택·PIN)로 넘긴다. 실패 시 유령 세션을 남기지 않는다.
  const completeOnboarding = useCallback(async (input: { name: string; phone: string; workBranch: string }): Promise<boolean> => {
    if (!pendingOnboarding) return false;
    setLoading(true);
    setError(null);
    try {
      const { getAuth, signOut } = await import("firebase/auth");
      const auth = getAuth();
      const current = auth.currentUser;
      // 폼 제출 시점의 세션이 온보딩을 시작한 그 사용자여야 한다 — 아니면 fail-closed.
      if (!current || current.uid !== pendingOnboarding.uid) {
        setPendingOnboarding(null);
        throw new Error("로그인 상태가 만료되었습니다. 처음부터 다시 로그인해 주세요.");
      }
      let profile;
      try {
        const { createUserProfile } = await import("../api/userProfile");
        profile = await createUserProfile({ uid: current.uid, email: current.email }, input);
      } catch {
        await signOut(auth);   // 유령 세션 금지: 프로필 생성 실패 시 세션도 폐기(설계서 §4)
        setPendingOnboarding(null);
        throw new Error("가입 정보 저장에 실패했습니다. 다시 시도해 주세요.");
      }
      setPendingOnboarding(null);
      setPendingGate({ profile });   // 이어서 회사 게이트(지점 선택·PIN)로
      return true;
    } catch (err: any) {
      setError(translateAuthError(err));
      return false;
    } finally {
      setLoading(false);
    }
  }, [pendingOnboarding]);

  const selectBranch = useCallback((branch: BranchSetting | null) => {
    if (branch && branch.branchName) {
      sessionStorage.setItem(SELECTED_BRANCH_KEY, JSON.stringify(branch));
    } else {
      sessionStorage.removeItem(SELECTED_BRANCH_KEY);
      branch = null;
    }
    setSelectedBranchState(branch);
  }, []);

  const logout = useCallback((opts?: { forgetGoogle?: boolean }) => {
    // 연속 로그아웃 시 먼저 끝난 쪽의 finally가 나중 것을 지우지 않도록, 자기 자신일 때만 비운다.
    const tracked: Promise<void> = import("../api/firebaseAuth")
      .then(({ logoutFirebase }) => logoutFirebase())
      .catch(() => {})
      .finally(() => { if (logoutInFlight === tracked) logoutInFlight = null; });
    logoutInFlight = tracked;
    // "다른 계정으로 로그인" — 마지막 구글 계정 힌트를 지워, 다음 구글 로그인에서 계정 선택창이 뜨게 한다.
    if (opts?.forgetGoogle) localStorage.removeItem(LAST_GOOGLE_EMAIL_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SELECTED_BRANCH_KEY);
    sessionStorage.removeItem("erp_branch_list_cache");
    setUser(null);
    setSelectedBranchState(null);
    setPendingGate(null);
    setPendingOnboarding(null);
    setPendingApproval(null);
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
    completeGate,
    pendingOnboarding,
    completeOnboarding,
    pendingApproval
  };
}
