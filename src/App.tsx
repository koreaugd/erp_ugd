// src/App.tsx
import React from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import LoginPage from "./pages/LoginPage";
import BranchConfirmPage from "./pages/BranchConfirmPage";
import InputPage from "./pages/InputPage";
import AdminPage from "./pages/AdminPage";

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
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
      </HashRouter>
    </AuthProvider>
  );
}
