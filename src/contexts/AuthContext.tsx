// src/contexts/AuthContext.tsx
import React, { createContext, useContext, ReactNode } from "react";
import { useAuth, UserSession } from "../hooks/useAuth";
import { BranchSetting } from "../api/gasClient";
import type { LoginBranch } from "../api/firebaseAuth";

interface AuthContextType {
  user: UserSession | null;
  selectedBranch: BranchSetting | null;
  selectBranch: (branch: BranchSetting | null) => void;
  loading: boolean;
  error: string | null;
  login: (branch: LoginBranch | null, pin: string) => Promise<boolean>;
  logout: () => void;
  failedAttempts: number;
  setError: (msg: string | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();

  return (
    <AuthContext.Provider value={auth} id="auth-provider">
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return context;
}
