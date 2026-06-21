// src/hooks/useAuth.ts
import { useState, useEffect, useCallback } from "react";
import { gasClient, BranchSetting } from "../api/gasClient";
import { hashPin } from "../utils/hashPin";

export interface UserSession extends BranchSetting {
  pinHash: string;
}

const SESSION_KEY = "erp_ugd_session";
const LOCK_KEY = "erp_ugd_lockout_until";
const ATTEMPTS_KEY = "erp_ugd_failed_attempts";
const SELECTED_BRANCH_KEY = "erp_ugd_selected_branch";

export function useAuth() {
  const [user, setUser] = useState<UserSession | null>(null);
  const [selectedBranch, setSelectedBranchState] = useState<BranchSetting | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState<number>(0);
  const [lockoutTime, setLockoutTime] = useState<number>(0); // seconds left

  // 1. 세션 불러오기 + 잠금 상태 복구
  useEffect(() => {
    try {
      const savedSession = sessionStorage.getItem(SESSION_KEY);
      if (savedSession) {
        setUser(JSON.parse(savedSession));
      }

      const savedBranch = sessionStorage.getItem(SELECTED_BRANCH_KEY);
      if (savedBranch) {
        setSelectedBranchState(JSON.parse(savedBranch));
      }
      
      const attempts = localStorage.getItem(ATTEMPTS_KEY);
      if (attempts) {
        setFailedAttempts(parseInt(attempts, 10));
      }

      
      const lockedUntil = localStorage.getItem(LOCK_KEY);
      if (lockedUntil) {
        const remaining = Math.ceil((parseInt(lockedUntil, 10) - Date.now()) / 1000);
        if (remaining > 0) {
          setLockoutTime(remaining);
        } else {
          // 잠금 해제
          localStorage.removeItem(LOCK_KEY);
          localStorage.setItem(ATTEMPTS_KEY, "0");
          setFailedAttempts(0);
        }
      }
    } catch (e) {
      console.error("Auth 복구 실패:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // 2. 잠금 카운트다운 타이머
  useEffect(() => {
    if (lockoutTime <= 0) return;

    const timer = setInterval(() => {
      setLockoutTime((prev) => {
        if (prev <= 1) {
          localStorage.removeItem(LOCK_KEY);
          localStorage.setItem(ATTEMPTS_KEY, "0");
          setFailedAttempts(0);
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [lockoutTime]);

  const login = useCallback(async (pin: string): Promise<boolean> => {
    if (lockoutTime > 0) {
      setError(`로그인이 잠겼습니다. ${lockoutTime}초 후에 다시 시도해주세요.`);
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      const pinHash = await hashPin(pin);
      const branchSetting = await gasClient.verifyPin(pinHash);

      const session: UserSession = {
        pinHash,
        branchName: branchSetting.branchName,
        brand: branchSetting.brand,
        role: branchSetting.role
      };

      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      localStorage.setItem(ATTEMPTS_KEY, "0");
      setFailedAttempts(0);
      setUser(session);
      return true;

    } catch (err: any) {
      const nextAttempts = failedAttempts + 1;
      setFailedAttempts(nextAttempts);
      localStorage.setItem(ATTEMPTS_KEY, String(nextAttempts));

      if (nextAttempts >= 3) {
        const lockUntil = Date.now() + 30000; // 30초 잠금
        localStorage.setItem(LOCK_KEY, String(lockUntil));
        setLockoutTime(30);
        setError("PIN 번호 입력 실패 3회 누적으로 로그인이 30초 동안 잠깁니다.");
      } else {
        setError(err.message || "PIN 입력 오류입니다. 올바른 PIN 번호를 한 번 더 확인하세요.");
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, [failedAttempts, lockoutTime]);

  const selectBranch = useCallback((branch: BranchSetting | null) => {
    if (branch) {
      sessionStorage.setItem(SELECTED_BRANCH_KEY, JSON.stringify(branch));
    } else {
      sessionStorage.removeItem(SELECTED_BRANCH_KEY);
    }
    setSelectedBranchState(branch);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SELECTED_BRANCH_KEY);
    setUser(null);
    setSelectedBranchState(null);
    setError(null);
  }, []);

  return {
    user,
    selectedBranch,
    selectBranch,
    loading,
    error,
    login,
    logout,
    lockoutTime,
    failedAttempts,
    setError
  };
}
