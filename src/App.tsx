// src/App.tsx
import React, { Suspense, lazy } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";

const LoginPage = lazy(() => import("./pages/LoginPage"));
const BranchConfirmPage = lazy(() => import("./pages/BranchConfirmPage"));
const InputPage = lazy(() => import("./pages/InputPage"));
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

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Suspense fallback={<PageFallback />}>
        <Routes>
          {/* 로그인 화면 */}
          <Route path="/" element={<LoginPage />} />
          
          {/* 지점 확인 포털 */}
          <Route path="/branch-confirm" element={<BranchConfirmPage />} />
          
          {/* 일일 마감 상세 입력 */}
          <Route path="/input" element={<InputPage />} />
          
          {/* 본사 관리자 대시보드 */}
          <Route path="/admin" element={<AdminPage />} />
          
          {/* 존재하지 않는 모든 경로 홈으로 리다이렉션 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </HashRouter>
    </AuthProvider>
  );
}
