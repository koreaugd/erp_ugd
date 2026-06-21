// src/hooks/useAuth.ts
import { useState, useEffect, useCallback } from "react";
import { gasClient, BranchSetting } from "../api/gasClient";
import { hashPin } from "../utils/hashPin";

export interface UserSession extends BranchSetting {
  pinHash: string;
}

const SESSION_KEY = "erp_ugd_session";
const ATTEMPTS_KEY = "erp_ugd_failed_attempts";
const SELECTED_BRANCH_KEY = "erp_ugd_selected_branch";

export function useAuth() {
  const [user, setUser] = useState<UserSession | null>(null);
  const [selectedBranch, setSelectedBranchState] = useState<BranchSetting | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState<number>(0);

  // 세션 불러오기
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
    } catch (e) {
      console.error("Auth 복구 실패:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (pin: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const pinHash = await hashPin(pin);
      let branchSetting;

      try {
        branchSetting = await gasClient.verifyPin(pinHash);
        if (!branchSetting || !branchSetting.branchName) {
          throw new Error("PIN 번호 정보가 누락되었거나 찾을 수 없습니다.");
        }
      } catch (err: any) {
        // GAS 인증 실패 시 프론트엔드 폴백 (공통 PIN + 관리자 PIN)
        const trimmedPin = pin.trim();
        const fallbackMap: Record<string, { branchName: string; role: string; brand: string }> = {
          "[삭제]": { branchName: "관리자", role: "admin", brand: "본사" },
          "0000": { branchName: "직원", role: "branch", brand: "" }
        };

        if (fallbackMap[trimmedPin]) {
          branchSetting = fallbackMap[trimmedPin];
        } else {
          throw err;
        }
      }

      const session: UserSession = {
        pinHash,
        branchName: branchSetting?.branchName || "직원",
        brand: branchSetting?.brand || "",
        role: branchSetting?.role || "branch"
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

      setError(err.message || "PIN 입력 오류입니다. 올바른 PIN 번호를 한 번 더 확인하세요.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [failedAttempts]);

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
    failedAttempts,
    setError
  };
}
