import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertOctagon, Lock, LogIn } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useAuthContext } from "../contexts/AuthContext";
import LoadingSpinner from "../components/LoadingSpinner";

export default function LoginPage() {
  const { user, login, loading, error, failedAttempts } = useAuthContext();
  const [pin, setPin] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    navigate(user.role === "admin" ? "/admin" : "/branch-confirm");
  }, [user, navigate]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading || !pin) return;

    const success = await login(pin);
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
              disabled={loading}
              placeholder="PIN 번호"
              aria-label="PIN 번호"
              className="w-full rounded-xl border border-black px-4 py-4 pl-11 text-center font-mono text-xl font-bold tracking-widest outline-hidden transition focus:ring-1 focus:ring-black disabled:bg-zinc-100"
            />
            <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" />
          </div>

          <button
            type="submit"
            disabled={loading || !pin}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-black px-4 py-4 text-sm font-bold text-white transition hover:bg-zinc-800 focus:outline-hidden focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            id="btn-login-submit"
          >
            {loading ? <LoadingSpinner size="sm" light /> : <>입력 완료 <LogIn className="h-4 w-4" /></>}
          </button>
        </form>
      </motion.div>
    </main>
  );
}
