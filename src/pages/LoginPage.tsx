// src/pages/LoginPage.tsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../contexts/AuthContext";
import { Lock, LogIn, AlertOctagon, KeyRound, Settings, Check, Clipboard } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import LoadingSpinner from "../components/LoadingSpinner";
import { hashPin } from "../utils/hashPin";

export default function LoginPage() {
  const { user, login, loading, error, failedAttempts, setError } = useAuthContext();
  const [pin, setPin] = useState<string>("");
  const navigate = useNavigate();

  const [showSettings, setShowSettings] = useState(false);
  const [gasUrlInput, setGasUrlInput] = useState("");
  const [pinToHash, setPinToHash] = useState("");
  const [generatedHash, setGeneratedHash] = useState("");
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("custom_gas_url") || "";
    setGasUrlInput(saved);
  }, []);

  const handleGenerateHash = async () => {
    if (pinToHash.trim() !== "") {
      const hash = await hashPin(pinToHash);
      setGeneratedHash(hash);
    }
  };

  const handleSaveSettings = () => {
    localStorage.setItem("custom_gas_url", gasUrlInput.trim());
    setShowSettings(false);
    if (setError) {
      setError(null);
    }
    window.location.reload();
  };

  const handleCopyHash = () => {
    navigator.clipboard.writeText(generatedHash);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // 이미 로그인된 세션이 있는 경우 역할에 따라 이동 처리
  useEffect(() => {
    if (user) {
      if (user.role === "admin") {
        navigate("/admin");
      } else {
        navigate("/branch-confirm");
      }
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !pin) return;

    const success = await login(pin);
    if (success) {
      setPin("");
    }
  };

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (/^[a-zA-Z0-9]*$/.test(value) && value.length <= 12) {
      setPin(value);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-[#F5F7FA] px-4 py-12 sm:px-6 lg:px-8 relative"
      id="login-page-wrapper"
    >
      {/* Settings trigger */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800 bg-white hover:bg-gray-100 border border-gray-200 shadow-xs px-3.5 py-2.5 rounded-xl transition-all cursor-pointer"
          id="btn-open-settings"
        >
          <Settings className="w-4 h-4 transition-transform duration-300 hover:rotate-90" />
          구글시트 연동 설정
        </button>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md space-y-8 bg-white p-8 sm:p-10 rounded-3xl shadow-xl border border-gray-100"
        id="login-card"
      >
        {/* 상단 헤더 / ERP 로고 */}
        <div className="text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: "spring" }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#D6E4F0] text-[#1A3C6E] mb-4"
          >
            <KeyRound className="w-8 h-8" />
          </motion.div>

          <h1 className="text-4xl font-extrabold text-[#1A3C6E] tracking-tight" id="login-brand-title">
            ERP_UGD
          </h1>
          <p className="mt-2 text-sm text-[#2C3E50] font-semibold tracking-wide" id="login-brand-subtitle">
            UGD주식회사 일일마감정산
          </p>
          <p className="mt-1 text-xs text-gray-400 font-normal">
            매장별 마감 정산 등록 및 본사 대시보드 관리
          </p>
        </div>

        {/* 로그인 실패 에러 알림 */}
        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-800 text-xs font-semibold flex items-start gap-2.5"
              id="login-error-alert"
            >
              <AlertOctagon className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <div className="grow">
                <span>{error}</span>
                {failedAttempts > 0 && (
                  <p className="mt-0.5 text-rose-600/70 font-normal">
                    (현재 실패 횟수: {failedAttempts}회)
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 로그인 폼 */}
        <form className="mt-8 space-y-6" onSubmit={handleSubmit} id="login-form">
          <div className="space-y-2">
            <label htmlFor="pin-input" className="block text-sm font-semibold text-gray-500">
              인증 PIN 번호
            </label>
            <div className="relative">
              <input
                id="pin-input"
                name="pin"
                type="password"
                inputMode="text"
                autoComplete="current-password"
                required
                value={pin}
                onChange={handlePinChange}
                disabled={loading}
                placeholder="PIN번호 입력"
                className="w-full px-4 py-3.5 pl-11 text-center font-mono text-xl font-bold border border-gray-200 rounded-2xl tracking-widest focus:outline-hidden focus:border-[#2E6DB4] focus:ring-1 focus:ring-[#2E6DB4] transition-all bg-gray-50/50 hover:bg-gray-50/10"
              />
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                <Lock className="w-5 h-5" />
              </div>
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading || !pin}
              className="group relative w-full flex justify-center py-3.5 px-4 border border-transparent text-sm font-extrabold rounded-2xl text-white bg-[#2E6DB4] hover:bg-[#1A3C6E] focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
              id="btn-login-submit"
            >
              {loading ? (
                <LoadingSpinner size="sm" light={true} />
              ) : (
                <span className="flex items-center gap-2">
                  입력 완료 <LogIn className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </span>
              )}
            </button>
          </div>
        </form>

        {/* 헬프 힌트 */}
        <div className="text-center !mt-8">
          <p className="text-xs text-gray-400 leading-normal bg-gray-50 p-3.5 rounded-2xl">
            💡 본사 관리자인 경우, 부여받은 관리자 계정 PIN을 입력하면 관리 대시보드로 즉시 자동 안내됩니다.
          </p>
        </div>
      </motion.div>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-lg rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto border border-gray-100"
              id="settings-modal"
            >
              <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                <h3 className="text-lg font-bold text-gray-950 flex items-center gap-2">
                  <Settings className="w-5 h-5 text-[#2E6DB4]" />
                  구글시트 웹앱(GAS) 수동 설정
                </h3>
              </div>

              <div className="space-y-4">
                <p className="text-xs text-slate-500 leading-relaxed bg-blue-50/50 p-3.5 rounded-2xl border border-blue-100">
                  <strong>💡 정적 배포 상태에서 404 에러가 나는 경우:</strong><br />
                  배포된 환경에 Node.js 백엔드 프록시 서버가 없기 때문입니다. 아래에 <strong>구글 앱스 스크립트(GAS) 웹 앱 URL</strong>을 직접 붙여넣으시면 브라우저에서 직접 통신합니다.
                </p>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-gray-700">
                    구글 앱스 스크립트 웹앱 URL (GAS_URL)
                  </label>
                  <input
                    type="text"
                    placeholder="https://script.google.com/macros/s/.../exec"
                    value={gasUrlInput}
                    onChange={(e) => setGasUrlInput(e.target.value)}
                    className="w-full text-xs font-mono px-3.5 py-3 border border-gray-200 rounded-xl focus:border-[#2E6DB4] focus:ring-1 focus:ring-[#2E6DB4] outline-hidden"
                  />
                  <p className="text-[10px] text-gray-400">
                    ※ 미입력 시, 현재 배포 서버의 <code>/api/gas</code> 프록시 경로를 사용합니다.
                  </p>
                </div>

                <div className="border-t border-gray-100 pt-4 space-y-3">
                  <div className="flex items-center gap-1">
                    <h4 className="text-xs font-bold text-gray-950">🔑 PIN 암호화 해시 생성기</h4>
                    <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-gray-500 font-semibold">보안 권장</span>
                  </div>
                  <p className="text-[11px] text-gray-500">
                    구글 시트의 <code>pin_hash</code> 컬럼에는 보안을 위해 숫자 PIN이 아닌 SHA-256 해시값만 저장됩니다. 원하는 PIN을 입력해 해시를 생성하세요.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-1 flex gap-2">
                      <input
                        type="text"
                        placeholder="PIN (예: 2895)"
                        value={pinToHash}
                        onChange={(e) => setPinToHash(e.target.value)}
                        className="flex-1 text-xs text-center font-bold px-3 py-3 border border-gray-200 rounded-xl outline-hidden"
                      />
                      <button
                        type="button"
                        onClick={handleGenerateHash}
                        className="px-3 py-2 text-xs font-bold text-white bg-[#2E6DB4] hover:bg-[#1A3C6E] rounded-xl transition-colors cursor-pointer"
                      >
                        생성
                      </button>
                    </div>
                    <div className="sm:col-span-2 relative flex items-center col-span-2">
                      <input
                        type="text"
                        readOnly
                        value={generatedHash || "PIN을 입력하고 생성 버튼을 누르세요."}
                        className="w-full text-[10px] font-mono bg-gray-50 border border-gray-200 px-3 py-3 rounded-xl pr-10 outline-hidden text-gray-500 select-all"
                      />
                      {generatedHash && (
                        <button
                          type="button"
                          onClick={handleCopyHash}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-blue-600 rounded-lg bg-white shadow-xs border border-gray-100 cursor-pointer"
                          title="해시 복사"
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Clipboard className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>
                  {generatedHash && (
                    <p className="text-[10px] text-amber-600 font-medium">
                      👉 복사한 해시값을 구글 시트 <code>지점_설정</code> 탭의 <code>pin_hash</code> 칸에 붙여넣어 해당 행의 PIN을 교체하세요!
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-2 justify-end border-t border-gray-100 pt-4">
                <button
                  type="button"
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 text-xs font-bold text-gray-500 hover:bg-gray-50 rounded-xl cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  className="px-4.5 py-2.5 text-xs font-bold text-white bg-[#2E6DB4] hover:bg-[#1A3C6E] rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  저장하고 새로고침
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
