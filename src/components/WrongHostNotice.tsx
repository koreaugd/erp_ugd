// src/components/WrongHostNotice.tsx
// 허용되지 않은 주소로 들어왔을 때 앱 대신 뜨는 안내(2026-07-30).
// 로그인 화면과 같은 흰 바탕·검정 테두리 톤을 쓰되, 이 화면은 로그인 이전 단계라
// 디자인 토큰 스코프 밖이므로 색을 hex 로 직접 박는다(LoginPage 와 같은 규약).
import { CANONICAL_APP_URL } from "../utils/allowedHost";

export default function WrongHostNotice() {
  return (
    <main className="min-h-screen bg-white flex items-center justify-center px-6" id="wrong-host-page">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-5xl font-black tracking-tight text-black">UGD</h1>
        {/* 경고 배너 12px(text-xs) · 안내문 11px · 버튼 11px — DESIGN.md §6-0-1 폰트 기준표.
            본문·버튼에 text-sm(14px) 이상은 금지다.
            바탕 = 관리자 연한 바닐라 토큰값(--admin-vanilla #F4F2CC, DESIGN_ADMIN.md 오버라이드 표).
            새 색이 아니라 토큰과 같은 값이며, 로그인 단계 화면은 토큰 스코프(.branch-redesign/.admin-redesign)
            밖이라 hex 로 박는다 — GateStep·ApprovalPendingStep 과 같은 규약. */}
        <div className="rounded-xl border border-black bg-[#F4F2CC] p-5 space-y-2 text-left">
          <p className="text-xs font-black text-black">이 주소에서는 사용할 수 없습니다</p>
          <p className="text-[11px] font-bold text-zinc-700">
            지금 열려 있는 주소({window.location.hostname})는 더 이상 쓰지 않는 옛 주소입니다.
            여기서 작업하면 일부 기능이 동작하지 않거나 저장이 어긋날 수 있어 화면을 열지 않았습니다.
          </p>
          <p className="text-[11px] font-bold text-zinc-700">
            아래 정식 주소로 들어가 주시고, 즐겨찾기에 이 주소가 저장돼 있다면 지워 주세요.
          </p>
        </div>
        <a
          href={CANONICAL_APP_URL}
          className="block w-full rounded-xl bg-black px-4 py-3 text-[11px] font-black text-white hover:bg-zinc-800"
          id="btn-go-canonical"
        >
          정식 주소로 이동
        </a>
        <p className="text-[11px] font-bold text-zinc-400 break-all">{CANONICAL_APP_URL}</p>
      </div>
    </main>
  );
}
