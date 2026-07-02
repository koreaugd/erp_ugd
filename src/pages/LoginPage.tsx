import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertOctagon, Lock, LogIn } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useAuthContext } from "../contexts/AuthContext";
import LoadingSpinner from "../components/LoadingSpinner";
import type { LoginBranch } from "../api/firebaseAuth";
import { ensureLatestAppVersion } from "../utils/appVersion";

export default function LoginPage() {
  const { user, login, loading, error, failedAttempts, setError } = useAuthContext();
  const [pin, setPin] = useState("");
  const [branches, setBranches] = useState<LoginBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<LoginBranch | null>(null);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [showBranchSelect, setShowBranchSelect] = useState(false);
  const [checkingVersion, setCheckingVersion] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    navigate(user.role === "admin" ? "/admin" : "/branch-confirm");
  }, [user, navigate]);

  useEffect(() => {
    if (!showBranchSelect || adminMode) return;
    setLoadingBranches(true);
    import("../api/firebaseAuth")
      .then(({ getFirebaseLoginBranches }) => getFirebaseLoginBranches())
      .then((list) => setBranches(list))
      .catch(() => setBranches([]))
      .finally(() => setLoadingBranches(false));
  }, [showBranchSelect, adminMode]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading || !pin) return;

    if (!adminMode && !showBranchSelect) {
      setError(null);
      setShowBranchSelect(true);
      return;
    }

    setCheckingVersion(true);
    const latest = await ensureLatestAppVersion();
    setCheckingVersion(false);
    if (!latest) return;

    const success = await login(adminMode ? null : selectedBranch, pin);
    if (success) setPin("");
  };

  const handlePinChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    if (/^[a-zA-Z0-9]*$/.test(value) && value.length <= 12) setPin(value);
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

        <form className="space-y-4" onSubmit={handleSubmit} id="login-form">
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
              disabled={loading || checkingVersion}
              placeholder="PIN"
              aria-label="PIN"
              className="w-full rounded-xl border border-black px-4 py-4 pl-11 text-center font-mono text-xl font-bold tracking-widest outline-hidden transition focus:ring-1 focus:ring-black disabled:bg-zinc-100"
            />
            <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" />
          </div>

          {!adminMode && showBranchSelect && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-zinc-600">지점 선택</p>
              {loadingBranches ? (
                <div className="flex justify-center py-5"><LoadingSpinner size="sm" /></div>
              ) : (
                <select
                  value={selectedBranch?.branchName || ""}
                  onChange={(event) => setSelectedBranch(branches.find((branch) => branch.branchName === event.target.value) || null)}
                  required
                  className="w-full rounded-xl border border-black bg-white px-4 py-4 text-center text-sm font-bold outline-hidden"
                >
                  <option value="">지점을 선택하세요</option>
                  {branches.map((branch) => <option key={branch.branchName} value={branch.branchName}>{branch.branchName}</option>)}
                </select>
              )}
            </div>
          )}
          <div className="relative hidden">
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
              hidden
              placeholder="PIN 번호"
              aria-label="PIN 번호"
              className="w-full rounded-xl border border-black px-4 py-4 pl-11 text-center font-mono text-xl font-bold tracking-widest outline-hidden transition focus:ring-1 focus:ring-black disabled:bg-zinc-100"
            />
            <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500 hidden" />
          </div>

          <button
            type="submit"
            disabled={loading || checkingVersion || !pin || (!adminMode && showBranchSelect && !selectedBranch)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-black px-4 py-4 text-sm font-bold text-white transition hover:bg-zinc-800 focus:outline-hidden focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            id="btn-login-submit"
          >
            {loading || checkingVersion ? <LoadingSpinner size="sm" light /> : <>입력 완료 <LogIn className="h-4 w-4" /></>}
          </button>
          <button
            type="button"
            onClick={() => { setAdminMode((current) => !current); setPin(""); setShowBranchSelect(false); setSelectedBranch(null); setError(null); }}
            className="w-full text-xs font-bold text-zinc-500 underline underline-offset-4"
          >
            {adminMode ? "지점 로그인으로 돌아가기" : "관리자 로그인"}
          </button>
        </form>
      </motion.div>
    </main>
  );
}
