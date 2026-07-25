// src/pages/login/GateStep.tsx
// 개인 로그인 성공 후 회사 게이트: 지점 선택(지점 role) → PIN 검증.
// 검증은 gateAuth(보조 인스턴스)로만 — 주 세션을 건드리지 않는다.
import React, { useEffect, useMemo, useState } from "react";
import { Lock, MailCheck } from "lucide-react";
import { useAuthContext } from "../../contexts/AuthContext";
import LoadingSpinner from "../../components/LoadingSpinner";
import type { LoginBranch } from "../../api/firebaseAuth";
import type { UserProfile } from "../../api/userProfile";
import { ensureLatestAppVersion } from "../../utils/appVersion";

export default function GateStep({ profile }: { profile: UserProfile }) {
  const { completeGate, loading, failedAttempts, logout, setError } = useAuthContext();
  const [pin, setPin] = useState("");
  const [branches, setBranches] = useState<LoginBranch[]>([]);
  const [selected, setSelected] = useState<LoginBranch | null>(null);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [checkingVersion, setCheckingVersion] = useState(false);
  // 이메일 가입 계정의 인증 링크 미확인 상태 — 게이트 통과 조건(completeGate가 강제, 여기선 안내+재발송).
  const [needsEmailVerify, setNeedsEmailVerify] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "cooldown">("idle");
  const isAdmin = profile.role === "admin";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { getAuth } = await import("firebase/auth");
      const current = getAuth().currentUser;
      if (!cancelled && current && current.providerData.some((p) => p.providerId === "password") && !current.emailVerified) {
        setNeedsEmailVerify(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const resendVerification = async () => {
    if (resendState !== "idle") return;
    setResendState("sending");
    try {
      const { getAuth, sendEmailVerification } = await import("firebase/auth");
      const current = getAuth().currentUser;
      if (current) await sendEmailVerification(current);
      setResendState("sent");
      // 성공해도 영구 잠금하지 않는다 — 메일이 또 안 오면 재발송할 수 있어야 한다(30초 뒤 재활성화).
      setTimeout(() => setResendState("idle"), 30_000);
    } catch {
      // 실패(특히 too-many-requests) 시 즉시 재활성화하면 연타로 차단이 길어진다 — 30초 쿨다운.
      setResendState("cooldown");
      setError("인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setTimeout(() => setResendState("idle"), 30_000);
    }
  };

  useEffect(() => {
    if (isAdmin) return;
    let cancelled = false;
    setLoadingBranches(true);
    import("../../api/firebaseAuth")
      .then(({ getFirebaseLoginBranches }) => getFirebaseLoginBranches())
      .then((list) => {
        if (cancelled) return;
        const allowed = profile.allowedBranches === "all"
          ? list
          : list.filter((b) => (profile.allowedBranches as string[]).includes(b.branchName));
        setBranches(allowed);
        if (allowed.length === 1) setSelected(allowed[0]);   // 허용 1개면 자동 선택(설계서 §4)
      })
      .catch(() => {
        if (cancelled) return;
        setBranches([]);
        setError("지점 목록을 불러오지 못했습니다. 네트워크 확인 후 다시 시도해 주세요.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingBranches(false);
      });
    return () => { cancelled = true; };
  }, [isAdmin, profile.allowedBranches]);

  const canSubmit = useMemo(
    () => !!pin && (isAdmin || !!selected) && !loading && !checkingVersion,
    [pin, isAdmin, selected, loading, checkingVersion]
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    // 개인 로그인도 PIN 플로우와 동일하게 앱 버전 게이트를 통과해야 한다 —
    // 배포 직후 옛 청크를 든 브라우저가 그대로 진입하는 것을 막는다(PIN 제출부와 같은 검사).
    setCheckingVersion(true);
    const latest = await ensureLatestAppVersion();
    setCheckingVersion(false);
    if (!latest) return;
    const ok = await completeGate(isAdmin ? { kind: "admin" } : { kind: "branch", branch: selected! }, pin);
    if (ok) setPin("");
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit} id="gate-step-form">
      <p className="text-center text-sm font-bold text-zinc-700">
        {profile.name}님, {isAdmin ? "관리자 PIN을 입력해 주세요." : "지점을 선택하고 PIN을 입력해 주세요."}
      </p>
      {needsEmailVerify && (
        <div
          // 바탕 = 관리자 연한 바닐라(#F4F2CC, DESIGN_ADMIN.md 오버라이드 표). 로그인 화면은 토큰 스코프 밖이라 hex로 못 박는다.
          className="rounded-xl border border-black bg-[#F4F2CC] p-4 space-y-2">
          <p className="flex items-center gap-2 text-sm font-black text-black">
            <MailCheck className="h-5 w-5 shrink-0" />
            이메일 인증을 완료해 주세요
          </p>
          <p className="text-xs font-bold text-zinc-600">
            받은 메일의 인증 링크를 누른 뒤 입장할 수 있습니다.
            <br />
            스팸함도 확인해 주세요.
          </p>
          <button type="button" onClick={() => void resendVerification()} disabled={resendState !== "idle"}
            className="text-xs font-bold text-zinc-600 underline underline-offset-4 disabled:no-underline disabled:text-zinc-400">
            {resendState === "sent" ? "인증 메일을 다시 보냈습니다" : resendState === "sending" ? "보내는 중..." : resendState === "cooldown" ? "잠시 후 다시 시도할 수 있습니다" : "인증 메일 다시 보내기"}
          </button>
        </div>
      )}
      {!isAdmin && (loadingBranches ? (
        <div className="flex justify-center py-5"><LoadingSpinner size="sm" /></div>
      ) : branches.length === 1 ? (
        <p className="w-full rounded-xl border border-black bg-zinc-50 px-4 py-4 text-center text-sm font-bold">{branches[0].branchName}</p>
      ) : (
        <select value={selected?.branchName || ""} required
          onChange={(e) => setSelected(branches.find((b) => b.branchName === e.target.value) || null)}
          className="w-full rounded-xl border border-black bg-white px-4 py-4 text-center text-sm font-bold outline-hidden">
          <option value="">지점을 선택하세요</option>
          {branches.map((b) => <option key={b.branchName} value={b.branchName}>{b.branchName}</option>)}
        </select>
      ))}
      <div className="relative">
        <input type="password" inputMode="text" autoComplete="off" required value={pin}
          onChange={(e) => { const v = e.target.value; if (/^[a-zA-Z0-9]*$/.test(v) && v.length <= 12) setPin(v); }}
          placeholder="PIN" aria-label="PIN" disabled={loading}
          className="w-full rounded-xl border border-black px-4 py-4 pl-11 text-center font-mono text-xl font-bold tracking-widest outline-hidden focus:ring-1 focus:ring-black disabled:bg-zinc-100" />
        <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" />
      </div>
      {failedAttempts > 0 && <p className="text-center text-xs font-bold text-rose-600">실패 횟수: {failedAttempts}</p>}
      <button type="submit" disabled={!canSubmit}
        className="w-full rounded-xl bg-black px-4 py-4 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-50">
        {loading || checkingVersion ? <LoadingSpinner size="sm" light /> : "입장하기"}
      </button>
      <button type="button" onClick={logout} className="w-full text-xs font-bold text-zinc-400 underline underline-offset-4">
        로그아웃 (다른 계정으로 로그인)
      </button>
    </form>
  );
}
