// src/pages/login/OnboardingStep.tsx
// 신규 개인계정 가입 온보딩 — 이름·연락처·근무지점을 받아 프로필을 생성한다.
// 구글 가입도 이 폼을 거친다(이메일은 계정에서 오지만 연락처·근무지점은 직접 입력).
// 제출 후에는 회사 게이트(지점 선택·PIN)로 이어지고, 관리자 승인 전까지는 데이터에 접근할 수 없다.
import React, { useEffect, useState } from "react";
import { UserRound, Phone, Store } from "lucide-react";
import { useAuthContext } from "../../contexts/AuthContext";
import LoadingSpinner from "../../components/LoadingSpinner";
import type { PendingOnboarding } from "../../hooks/useAuth";

// 근무지점이 목록에 없을 때 직접 입력하도록 하는 특수 선택값.
const CUSTOM_BRANCH = "__custom__";

export default function OnboardingStep({ pending }: { pending: PendingOnboarding }) {
  const { completeOnboarding, loading, logout, setError } = useAuthContext();
  const [name, setName] = useState(pending.suggestedName || "");
  const [phone, setPhone] = useState("");
  const [branchChoice, setBranchChoice] = useState("");
  const [customBranch, setCustomBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingBranches(true);
    import("../../api/firebaseAuth")
      .then(({ getFirebaseLoginBranches }) => getFirebaseLoginBranches())
      .then((list) => { if (!cancelled) setBranches(list.map((b) => b.branchName)); })
      .catch(() => { if (!cancelled) setBranches([]); })
      .finally(() => { if (!cancelled) setLoadingBranches(false); });
    return () => { cancelled = true; };
  }, []);

  const workBranch = branchChoice === CUSTOM_BRANCH ? customBranch.trim() : branchChoice;
  const canSubmit = !!name.trim() && !!phone.trim() && !!workBranch && !loading;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    await completeOnboarding({ name: name.trim(), phone: phone.trim(), workBranch });
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit} id="onboarding-step-form">
      <div className="space-y-1 text-center">
        <p className="text-sm font-black text-black">가입 정보를 입력해 주세요</p>
        <p className="text-xs font-bold text-zinc-500">{pending.email || "구글 계정"}으로 가입합니다</p>
      </div>

      <div className="relative">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="이름"
          className="w-full rounded-xl border border-black px-4 py-3 pl-11 text-sm font-bold"
        />
        <UserRound className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" />
      </div>

      <div className="relative">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          type="tel"
          inputMode="tel"
          placeholder="연락처 (예: 010-1234-5678)"
          className="w-full rounded-xl border border-black px-4 py-3 pl-11 text-sm font-bold"
        />
        <Phone className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" />
      </div>

      <div className="space-y-2">
        {loadingBranches ? (
          <div className="flex justify-center py-3"><LoadingSpinner size="sm" /></div>
        ) : (
          <div className="relative">
            <select
              value={branchChoice}
              onChange={(e) => setBranchChoice(e.target.value)}
              required
              className="w-full rounded-xl border border-black bg-white px-4 py-3 pl-11 text-sm font-bold outline-hidden"
            >
              <option value="">근무지점 선택</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
              <option value={CUSTOM_BRANCH}>목록에 없어요 (직접 입력)</option>
            </select>
            <Store className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" />
          </div>
        )}
        {branchChoice === CUSTOM_BRANCH && (
          <input
            value={customBranch}
            onChange={(e) => setCustomBranch(e.target.value)}
            required
            placeholder="근무지점을 입력해 주세요"
            className="w-full rounded-xl border border-black px-4 py-3 text-sm font-bold"
          />
        )}
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-xl bg-black px-4 py-4 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-50"
        id="btn-onboarding-submit"
      >
        {loading ? <LoadingSpinner size="sm" light /> : "가입 완료"}
      </button>
      <button
        type="button"
        onClick={() => logout({ forgetGoogle: true })}
        className="w-full text-xs font-bold text-zinc-400 underline underline-offset-4"
      >
        취소 (다른 계정으로 로그인)
      </button>
    </form>
  );
}
