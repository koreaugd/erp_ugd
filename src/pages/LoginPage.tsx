import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertOctagon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useAuthContext } from "../contexts/AuthContext";
import { warmPersonalAuth } from "../hooks/useAuth";
import LoadingSpinner from "../components/LoadingSpinner";
import GateStep from "./login/GateStep";
import OnboardingStep from "./login/OnboardingStep";
import ApprovalPendingStep from "./login/ApprovalPendingStep";
import { IS_DEMO } from "../demo";

// PIN 단독 로그인은 2026-07-29 사용자 지시로 폐지 — 개인 계정(구글/이메일)으로만 로그인한다.
// PIN 은 로그인 후의 게이트(GateStep)에서만 쓰인다. 백엔드의 PIN 검증 로직은 게이트가 계속 쓰므로 유지.
type EmailFormMode = "signin" | "signup" | "reset";

export default function LoginPage() {
  const {
    user, loading, error, failedAttempts, setError,
    loginWithGoogle, loginWithEmail, signUpWithEmail, sendPasswordReset, pendingGate,
    pendingOnboarding, pendingApproval
  } = useAuthContext();
  const navigate = useNavigate();

  // 개인 로그인(이메일) 상태
  const [emailForm, setEmailForm] = useState<EmailFormMode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");   // 가입 폼 전용 — 오타 가입 방지
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [sendingReset, setSendingReset] = useState(false);

  const busy = loading || sendingReset;

  // 로그인 화면이 뜨자마자 Firebase 로그인 준비를 미리 끝내둔다 —
  // "Google로 시작하기" 클릭 시 팝업이 지연 없이 바로 열리게(실패해도 클릭 시 재시도되므로 무시).
  useEffect(() => {
    void warmPersonalAuth().catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    navigate(user.role === "admin" ? "/admin" : "/branch-confirm");
  }, [user, navigate]);

  const switchEmailForm = (next: EmailFormMode) => {
    setEmailForm(next);
    setError(null);
    setResetMessage(null);
    setPassword("");
    setPasswordConfirm("");
  };

  const handleEmailSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setResetMessage(null);

    if (emailForm === "reset") {
      setSendingReset(true);
      try {
        await sendPasswordReset(email);
        setResetMessage("메일을 보냈습니다. 스팸함도 확인해 주세요.");
        setEmailForm("signin");
        setPassword("");
      } catch (err: any) {
        setError(err?.message || "재설정 메일 전송에 실패했습니다.");
      } finally {
        setSendingReset(false);
      }
      return;
    }

    if (emailForm === "signup" && password !== passwordConfirm) {
      // 두 비밀번호가 일치해야만 가입 진행(사용자 요청 2026-07-25) — 오타 가입 방지.
      setError("비밀번호가 서로 일치하지 않습니다. 두 칸에 같은 비밀번호를 입력해 주세요.");
      return;
    }

    const success = emailForm === "signup"
      ? await signUpWithEmail(name, email, password)
      : await loginWithEmail(email, password);
    if (success) { setPassword(""); setPasswordConfirm(""); }
  };

  return (
    <main className="min-h-screen bg-white flex items-center justify-center px-6" id="login-page-wrapper">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm space-y-8"
        id="login-card"
      >
        <h1 className="text-center text-5xl font-black tracking-tight text-black" id="login-brand-title">
          UGD
        </h1>

        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700"
              id="login-error-alert"
            >
              <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                {error}
                {failedAttempts > 0 && <p className="mt-1">실패 횟수: {failedAttempts}</p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!error && resetMessage && (
          <div
            className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-700"
            id="login-reset-alert"
          >
            {resetMessage}
          </div>
        )}

        {pendingOnboarding ? (
          <OnboardingStep pending={pendingOnboarding} />
        ) : pendingApproval ? (
          <ApprovalPendingStep profile={pendingApproval} />
        ) : pendingGate ? (
          <GateStep profile={pendingGate.profile} />
        ) : (
          <div className="space-y-4" id="personal-login-section">
            {/* 시연용 빌드에서만: 방문자가 계정을 몰라 막히지 않도록 데모 계정을 화면에 안내한다.
                (가상 데이터 전용 계정 — 비밀 아님. 운영 빌드에서는 IS_DEMO 리터럴 치환으로 제거된다.) */}
            {IS_DEMO && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-bold text-zinc-800 space-y-2">
                <p className="font-black">체험용 계정으로 로그인하세요</p>
                {/* [2026-08-21] 값마다 이름을 붙여 세로로 쌓는다.
                    원래는 "관리자: 메일 / 비번 / PIN" 한 줄이었는데(사용자 지시 2026-08-20 — 줄바꿈되면
                    어디까지가 비밀번호인지 읽기 어렵다), **폭 390px 휴대폰에서 337px 짜리 줄이 316px 만
                    보여 PIN 끝자리가 잘렸다**(가로 스크롤은 되지만 잘린 줄 모른다). 값마다 이름이 붙어 있으면
                    줄이 나뉘어도 무엇이 비밀번호인지 헷갈리지 않으므로, 한 줄 규칙의 목적은 그대로 지켜진다. */}
                {[
                  { role: "관리자", email: "demo-admin@ugd-erp.example" },
                  { role: "지점", email: "demo-branch@ugd-erp.example" },
                ].map((acct) => (
                  <div key={acct.role} className="rounded-lg bg-white/70 px-2.5 py-2 space-y-0.5">
                    <p className="font-black">{acct.role}</p>
                    <p className="break-all">이메일 {acct.email}</p>
                    <p>비밀번호 12341234 · PIN 1234</p>
                  </div>
                ))}
              </div>
            )}
            {/* [2026-08-21 사용자 지시] 시연용 빌드에서는 이 버튼을 **보이되 눌러도 아무 일이 없게** 둔다.
                방문자가 자기 구글 계정으로 들어오면 가입 승인 대기 화면에 갇혀 시연이 거기서 끝난다.
                버튼을 없애지 않는 이유는 화면 구성을 운영과 같게 보여주기 위해서다. 모양은 그대로 두고
                동작만 뗀다(disabled 로 흐리게 만들면 "고장난 화면"으로 보인다). */}
            <button
              type="button"
              onClick={IS_DEMO ? undefined : () => void loginWithGoogle()}
              disabled={busy}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-300 bg-white px-4 py-4 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
              id="btn-google-login"
            >
              {/* 구글 공식 브랜드 가이드의 "G" 로고 — 색·비율 변형 금지 자산이라 SVG 원본 그대로 사용 */}
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
              Google로 시작하기
            </button>
            <div className="text-center text-xs font-bold text-zinc-400">또는 이메일로</div>
            <form className="space-y-3" onSubmit={handleEmailSubmit} id="email-login-form">
              {emailForm === "signup" && (
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="이름"
                  className="w-full rounded-xl border border-black px-4 py-3 text-sm font-bold"
                />
              )}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="이메일"
                className="w-full rounded-xl border border-black px-4 py-3 text-sm font-bold"
              />
              {emailForm !== "reset" && (
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="비밀번호"
                  autoComplete={emailForm === "signup" ? "new-password" : "current-password"}
                  className="w-full rounded-xl border border-black px-4 py-3 text-sm font-bold"
                />
              )}
              {emailForm === "signup" && (
                <div className="space-y-1">
                  <input
                    type="password"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    required
                    placeholder="비밀번호 확인"
                    autoComplete="new-password"
                    className={`w-full rounded-xl border px-4 py-3 text-sm font-bold ${passwordConfirm && password !== passwordConfirm ? "border-rose-500" : "border-black"}`}
                  />
                  {/* 입력 즉시 일치 여부를 보여준다 — 가입하기를 눌러야만 아는 구조는 불편(사용자 지적 2026-07-25) */}
                  {passwordConfirm && (
                    password === passwordConfirm
                      ? <p className="text-[11px] font-bold text-emerald-600">비밀번호가 일치합니다</p>
                      : <p className="text-[11px] font-bold text-rose-600">비밀번호가 일치하지 않습니다</p>
                  )}
                </div>
              )}
              <button
                type="submit"
                disabled={busy || (emailForm === "signup" && (!passwordConfirm || password !== passwordConfirm))}
                className="w-full rounded-xl bg-black px-4 py-4 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-50"
                id="btn-email-submit"
              >
                {busy
                  ? <LoadingSpinner size="sm" light />
                  : emailForm === "signin" ? "로그인" : emailForm === "signup" ? "가입하기" : "재설정 메일 보내기"}
              </button>
            </form>
            <div className="flex justify-between text-xs font-bold text-zinc-500">
              {/* [2026-08-21] 구글 버튼과 같은 이유로 시연용 빌드에서는 눌러도 아무 일이 없다.
                  방문자가 자기 이메일로 가입하면 구글과 똑같이 **승인 대기 화면에 갇혀** 시연이 끝난다
                  (Codex 정지게이트 지적 — 구글만 막고 이 링크를 열어 두면 막다른 길이 그대로 남는다).
                  모양은 운영과 같게 두고 동작만 뗀다. */}
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={IS_DEMO ? undefined : () => switchEmailForm(emailForm === "signup" ? "signin" : "signup")}
              >
                {emailForm === "signup" ? "로그인으로 돌아가기" : "이메일로 가입하기"}
              </button>
              {/* [2026-08-21] 이것도 시연용에서는 동작을 뗀다. 두 가지 이유가 있다.
                  ① 체험 계정의 비밀번호는 위 안내상자에 그대로 적혀 있어 쓸 일이 없다.
                  ② **여기를 열어 두면 방문자가 갇힌다** — 재설정 화면에서 로그인으로 돌아가는 버튼이
                     바로 위의 '이메일로 가입하기' 버튼인데, 그 버튼을 막았기 때문에 새로고침 말고는
                     빠져나올 길이 없다. 셋을 함께 막아야 앞뒤가 맞는다. */}
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={IS_DEMO ? undefined : () => switchEmailForm("reset")}
              >
                비밀번호 찾기
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </main>
  );
}
