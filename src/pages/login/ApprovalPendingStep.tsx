// src/pages/login/ApprovalPendingStep.tsx
// 회사 PIN까지 통과했으나 관리자 승인 전인 개인계정에게 보여주는 대기 화면.
// 이 화면에서는 어떤 업무 데이터에도 접근하지 않는다(세션 자체를 만들지 않음 — firestore.rules canAccessWork와 짝).
import React from "react";
import { Clock } from "lucide-react";
import { useAuthContext } from "../../contexts/AuthContext";
import type { UserProfile } from "../../api/userProfile";

export default function ApprovalPendingStep({ profile }: { profile: UserProfile }) {
  const { logout } = useAuthContext();
  return (
    <div className="space-y-4 text-center" id="approval-pending-step">
      {/* 바탕 = 관리자 연한 바닐라(#F4F2CC). 로그인 화면은 디자인 토큰 스코프 밖이라 hex로 둔다. */}
      <div className="rounded-xl border border-black bg-[#F4F2CC] p-5 space-y-2">
        <p className="flex items-center justify-center gap-2 text-sm font-black text-black">
          <Clock className="h-5 w-5 shrink-0" /> 관리자 승인 대기중
        </p>
        <p className="text-xs font-bold text-zinc-600">
          {profile.name}님, 가입이 접수되었습니다.
          <br />
          관리자가 승인하면 이용할 수 있습니다.
        </p>
        <p className="text-[11px] font-bold text-zinc-500">
          근무지점: {profile.workBranch || "-"} · 연락처: {profile.phone || "-"}
        </p>
      </div>
      <button
        type="button"
        onClick={logout}
        className="w-full text-xs font-bold text-zinc-400 underline underline-offset-4"
      >
        로그아웃
      </button>
    </div>
  );
}
