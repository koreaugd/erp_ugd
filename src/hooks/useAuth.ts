// src/hooks/useAuth.ts
import { useState, useEffect, useCallback } from "react";
import { BranchSetting } from "../api/gasClient";
import { hashPin } from "../utils/hashPin";
import { LoginBranch, loginWithAdminPin, loginWithBranchPin, logoutFirebase } from "../api/firebaseAuth";

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
        const parsedSession = JSON.parse(savedSession);
        if (parsedSession && parsedSession.branchName) {
          setUser(parsedSession);
        } else {
          sessionStorage.removeItem(SESSION_KEY);
        }
      }

      const savedBranch = sessionStorage.getItem(SELECTED_BRANCH_KEY);
      if (savedBranch) {
        const parsedBranch = JSON.parse(savedBranch);
        if (parsedBranch && parsedBranch.branchName) {
          setSelectedBranchState(parsedBranch);
        } else {
          sessionStorage.removeItem(SELECTED_BRANCH_KEY);
        }
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

  const login = useCallback(async (branch: LoginBranch | null, pin: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const pinHash = await hashPin(pin);
      const branchSetting = branch ? await loginWithBranchPin(branch, pin) : await loginWithAdminPin(pin);

      const session: UserSession = {
        pinHash,
        branchName: branchSetting.branchName || "직원",
        brand: branchSetting.brand || "",
        role: branchSetting.role || "branch"
      };

      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      if (branch) {
        // 로그인 직후에도 React 상태를 즉시 맞춰야 지점 선택 화면이 한 번 더
        // 표시되지 않습니다. (새로고침 시에는 위의 sessionStorage 복구가 담당)
        sessionStorage.setItem(SELECTED_BRANCH_KEY, JSON.stringify(branchSetting));
        setSelectedBranchState(branchSetting);
      } else {
        sessionStorage.removeItem(SELECTED_BRANCH_KEY);
        setSelectedBranchState(null);
      }
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
    if (branch && branch.branchName) {
      sessionStorage.setItem(SELECTED_BRANCH_KEY, JSON.stringify(branch));
    } else {
      sessionStorage.removeItem(SELECTED_BRANCH_KEY);
      branch = null;
    }
    setSelectedBranchState(branch);
  }, []);

  const logout = useCallback(() => {
    void logoutFirebase();
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
