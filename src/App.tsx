// src/App.tsx
import React, { Suspense, lazy } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { AppSessionGuard } from "./components/AppSessionGuard";
import { installChunkReloadGuard } from "./utils/chunkReload";
// @ts-ignore — 이 프로젝트에는 @types/react가 없어 클래스 컴포넌트를 .tsx로 쓸 수 없다(ChunkErrorBoundary.jsx 주석 참고).
import { ChunkErrorBoundary } from "./components/ChunkErrorBoundary.jsx";

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
  return (
    <AuthProvider>
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
