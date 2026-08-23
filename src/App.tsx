// src/App.tsx
import React, { Suspense, lazy } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { AppSessionGuard } from "./components/AppSessionGuard";
import { installChunkReloadGuard } from "./utils/chunkReload";
// @ts-ignore — 이 프로젝트에는 @types/react가 없어 클래스 컴포넌트를 .tsx로 쓸 수 없다(ChunkErrorBoundary.jsx 주석 참고).
import { ChunkErrorBoundary } from "./components/ChunkErrorBoundary.jsx";
import { IS_DEMO } from "./demo";

const LoginPage = lazy(() => import("./pages/LoginPage"));
const BranchConfirmPage = lazy(() => import("./pages/BranchConfirmPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));

function PageFallback() {
  return (
    <div className="min-h-screen bg-[#F6F5FA] flex items-center justify-center px-6">
      <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-4 text-sm font-black text-zinc-800 shadow-sm">
        화면을 불러오는 중입니다.
      </div>
    </div>
  );
}

// 배포하면 옛 화면 파일이 서버에서 지워진다. 어제 열어둔 화면이 아직 안 받은 탭을 누르면
// 없는 파일을 요청하게 되고, 지금까지는 그대로 흰 화면이 됐다.
// 파일을 못 받았다는 건 곧 "내가 옛 버전"이라는 뜻이라, 그 순간 최신을 받아오면 된다.
installChunkReloadGuard();

export default function App() {
  // 시연용 빌드 표식 — index.css 의 `html.is-demo` 규칙(사이드바를 상단 띠 아래에서 시작시키는 것)이 이걸 본다.
  // IS_DEMO 가 빌드 시점 리터럴이라 운영 빌드에서는 이 useEffect 자체가 죽은코드로 사라진다.
  //
  // 띠 높이(--demo-banner-h)는 **실측해서 넣는다.** CSS 에 숫자를 적어 두면 글꼴·여백이 바뀌거나
  // 좁은 화면에서 문구가 두 줄이 될 때 값이 어긋나 사이드바가 그만큼 가린다
  // (실제로 26px 로 적어 뒀는데 실측은 28px 이었다, 2026-08-24).
  React.useEffect(() => {
    if (!IS_DEMO) return;
    const root = document.documentElement;
    root.classList.add("is-demo");
    const banner = document.getElementById("demo-banner");
    if (!banner) return;
    const apply = () => root.style.setProperty("--demo-banner-h", `${Math.round(banner.getBoundingClientRect().height)}px`);
    apply();
    const observer = new ResizeObserver(apply); // 화면 폭이 바뀌어 문구가 접히면 높이도 따라간다
    observer.observe(banner);
    return () => observer.disconnect();
  }, []);

  return (
    <AuthProvider>
      {/* 시연용 빌드에서만 나타나는 상단 띠. 운영 빌드에서는 IS_DEMO가 리터럴 false로 치환되어 통째로 제거된다.
          [2026-08-24 사용자 지시] 스크롤해도 항상 위에 붙어 있어야 한다.
          fixed 가 아니라 **sticky** 를 쓴다 — fixed 는 흐름에서 빠져 나가 첫 화면 맨 윗줄이 띠에 가리므로
          모든 화면에 위쪽 여백을 따로 넣어 줘야 한다. sticky 는 제자리를 차지한 채로 붙어 있어 그럴 일이 없다.
          z-[60] 인 이유: 관리자 모바일 드로어가 z-50 이라 그보다 위여야 띠가 가려지지 않는다.
          사이드바(지점 sticky·관리자 드로어)가 띠 아래에서 시작하도록 index.css 의 `html.is-demo` 규칙이 짝을 이룬다. */}
      {IS_DEMO && (
        <div
          className="sticky top-0 z-[60] w-full bg-amber-400 text-black text-center text-xs font-black py-1.5 px-3"
          id="demo-banner"
        >
          시연용 인스턴스 — 화면의 모든 데이터는 가상입니다
        </div>
      )}
      {/* 새 배포 갈아끼우기 + 유휴 자동 로그아웃. 화면을 그리지 않고 뒤에서 지킨다. */}
      <AppSessionGuard />
      <HashRouter>
        {/* 화면 파일을 못 받으면 흰 화면이 됐다. 옛 버전이면 조용히 최신을 받아오고,
            인터넷 문제라면 뭘 해야 할지 알려준다. */}
        <ChunkErrorBoundary>
        <Suspense fallback={<PageFallback />}>
        <Routes>
          {/* 로그인 화면 */}
          <Route path="/" element={<LoginPage />} />
          
          {/* 지점 확인 포털 */}
          <Route path="/branch-confirm" element={<BranchConfirmPage />} />

          {/* 본사 관리자 대시보드 */}
          <Route path="/admin" element={<AdminPage />} />
          
          {/* 존재하지 않는 모든 경로 홈으로 리다이렉션 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </ChunkErrorBoundary>
      </HashRouter>
    </AuthProvider>
  );
}
