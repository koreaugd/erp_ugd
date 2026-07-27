// src/contexts/AuthContext.tsx
import React, { createContext, useContext, ReactNode } from "react";
import { useAuth, UserSession, PendingGate, PendingOnboarding } from "../hooks/useAuth";
import { BranchSetting } from "../api/gasClient";
import type { LoginBranch } from "../api/firebaseAuth";
import type { GateTarget } from "../api/gateAuth";
import type { UserProfile } from "../api/userProfile";

interface AuthContextType {
  user: UserSession | null;
  selectedBranch: BranchSetting | null;
  selectBranch: (branch: BranchSetting | null) => void;
  loading: boolean;
  error: string | null;
  login: (branch: LoginBranch | null, pin: string) => Promise<boolean>;
  logout: (opts?: { forgetGoogle?: boolean }) => void;
  failedAttempts: number;
  setError: (msg: string | null) => void;
  loginWithGoogle: () => Promise<boolean>;
  loginWithEmail: (email: string, password: string) => Promise<boolean>;
  signUpWithEmail: (name: string, email: string, password: string) => Promise<boolean>;
  sendPasswordReset: (email: string) => Promise<void>;
  pendingGate: PendingGate | null;
  completeGate: (target: GateTarget, pin: string) => Promise<boolean>;
  pendingOnboarding: PendingOnboarding | null;
  completeOnboarding: (input: { name: string; phone: string; workBranch: string }) => Promise<boolean>;
  pendingApproval: UserProfile | null;
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
