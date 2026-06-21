// src/api/gasClient.ts

export interface BranchSetting {
  branchName: string;
  brand: string;
  role: string | "branch" | "admin";
}

export interface MasterDaily {
  recordId?: string;
  branchName: string;
  settleDate: string; // YYYY-MM-DD
  cashSales: number;
  cardSales: number;
  transferSales: number;
  deliverySales: number;
  totalSales?: number;
  memo: string;
  submittedAt?: string;
  submittedBy?: string;
  modifiedAt?: string;
  modifiedBy?: string;
}

export interface ExpenseDetail {
  expenseType: "현금지출" | "카드지출";
  itemName: string;
  amount: number;
}

export interface StaffRecord {
  staffName: string;
  workHours: number;
}

export interface DailySettleDetail {
  master: MasterDaily;
  expenses: ExpenseDetail[];
  staff: StaffRecord[];
}

export interface DailyListRow {
  branchName: string;
  brand: string;
  role: string;
  submitted: boolean;
  record: MasterDaily | null;
}

// REST actions helper
async function callApi(action: string, params: Record<string, any> = {}): Promise<any> {
  try {
    // 1. Check localStorage first, then env variable, then fallback to proxy
    const localGasUrl = typeof window !== "undefined" ? window.localStorage.getItem("custom_gas_url") : null;
    const directGasUrl = (import.meta as any).env?.VITE_GAS_URL;

    let url = "/api/gas";
    const headers: Record<string, string> = {};

    // Determine current environment
    const isServerEnvironment = typeof window !== "undefined" && (
      window.location.hostname.includes("localhost") ||
      window.location.hostname.includes("127.0.0.1") ||
      window.location.hostname.includes("run.app")
    );

    if (localGasUrl && localGasUrl.trim() !== "" && localGasUrl.includes("script.google.com")) {
      if (isServerEnvironment) {
        // Node proxy environment: Route through /api/gas with the Custom GAS URL in x-custom-gas-url header.
        // This solves all browser CORS/preflight (OPTIONS) limitations.
        url = "/api/gas";
        headers["Content-Type"] = "application/json";
        headers["x-custom-gas-url"] = localGasUrl;
      } else {
        // Static production environments (Netlify, etc.) without Node proxy backend:
        // Request directly from browser but use "text/plain" content-type to bypass OPTIONS preflight block.
        url = localGasUrl;
        headers["Content-Type"] = "text/plain";
      }
    } else if (directGasUrl && directGasUrl.trim() !== "" && directGasUrl.includes("script.google.com")) {
      if (isServerEnvironment) {
        url = "/api/gas";
        headers["Content-Type"] = "application/json";
      } else {
        url = directGasUrl;
        headers["Content-Type"] = "text/plain";
      }
    } else {
      // Local simulation mode or default case
      url = "/api/gas";
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ action, ...params })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}`);
    }
    
    const result = await response.json();
    if (result.success) {
      return result.data;
    } else {
      throw new Error(result.error || "알 수 없는 API 에러 발생");
    }
  } catch (error: any) {
    console.error("API Call failed:", error);
    throw error;
  }
}

export const gasClient = {
  /**
   * PIN 검증 및 지점 정보 반환
   */
  async verifyPin(pinHash: string): Promise<BranchSetting> {
    return await callApi("verifyPin", { pinHash });
  },

  /**
   * 특정 날짜 특정 지점의 중복 제출 여부 확인
   */
  async checkDuplicate(branchName: string, settleDate: string): Promise<{ exists: boolean; recordId?: string; record: MasterDaily | null }> {
    return await callApi("checkDuplicate", { branchName, settleDate });
  },

  /**
   * 마감 정산 데이터 신규 저장
   */
  async submitDaily(master: MasterDaily, expenses: ExpenseDetail[], staff: StaffRecord[]): Promise<{ recordId: string }> {
    return await callApi("submitDaily", { master, expenses, staff });
  },

  /**
   * 관리자 기제출 자료 인라인 수정 (및 수정 이력 남김)
   */
  async updateDaily(
    recordId: string,
    masterData: Partial<MasterDaily>,
    expenses?: ExpenseDetail[],
    staff?: StaffRecord[],
    modifiedBy?: string
  ): Promise<{ success: boolean }> {
    return await callApi("updateDaily", { recordId, masterData, expenses, staff, modifiedBy });
  },

  /**
   * 특정 일자의 전체 지점 마감 리스트 조회
   */
  async getDailyList(settleDate: string, adminPinHash?: string): Promise<DailyListRow[]> {
    return await callApi("getDailyList", { settleDate, adminPinHash });
  },

  /**
   * 특정 레코드 상세 조회 (마스터 + 지출 + 인원)
   */
  async getDailyDetail(recordId: string): Promise<DailySettleDetail> {
    return await callApi("getDailyDetail", { recordId });
  },

  /**
   * 특정 지점의 모든 마감 기록 조회 (히스토리)
   */
  async getBranchHistory(branchName: string): Promise<MasterDaily[]> {
    try {
      return await callApi("getBranchHistory", { branchName });
    } catch (err) {
      console.warn("getBranchHistory Action Failed. Returning empty fallback array.", err);
      return [];
    }
  },

  /**
   * 전체 지점 설정 목록 반환
   */
  async getBranchList(): Promise<BranchSetting[]> {
    return await callApi("getBranchList");
  },

  /**
   * 관리자용: 활성/비활성 포함 전체 지점 목록 조회
   */
  async getBranchListAll(): Promise<AdminBranchSetting[]> {
    return await callApi("getBranchListAll");
  },

  /**
   * 관리자용: 신규 지점 등록
   */
  async addBranch(branchName: string, pinHash: string, brand: string, role?: string): Promise<{ success: boolean }> {
    return await callApi("addBranch", { branchName, pinHash, brand, role });
  },

  /**
   * 관리자용: 지점 활성화/비활성화 상태 변경
   */
  async toggleBranchActive(branchName: string, isActive: boolean): Promise<{ success: boolean }> {
    return await callApi("toggleBranchActive", { branchName, isActive });
  },

  /**
   * 관리자용: 지점 PIN 비밀번호 해시 교체
   */
  async updateBranchPin(branchName: string, pinHash: string): Promise<{ success: boolean }> {
    return await callApi("updateBranchPin", { branchName, pinHash });
  },

  /**
   * 관리자용: 지점 삭제 (데이터행 완전히 제거)
   */
  async deleteBranch(branchName: string): Promise<{ success: boolean }> {
    return await callApi("deleteBranch", { branchName });
  },

  /**
   * 관리자용: Firebase 연동 상태 모니터링
   */
  async getFirebaseStatus(): Promise<{ success: boolean; connected: boolean; projectId: string; totalSettles: number; totalSettings: number; error?: string }> {
    const response = await fetch("/api/firebase/status");
    return await response.json();
  },

  /**
   * 관리자용: 로컬 전체 데이터를 Firebase Firestore로 동기화 업로드
   */
  async syncToFirebase(): Promise<{ success: boolean; message: string; error?: string }> {
    const response = await fetch("/api/firebase/sync-to-cloud", { method: "POST" });
    return await response.json();
  },

  /**
   * 관리자용: Firebase Firestore 클라우드 수집본 기준으로 로컬 환경 강제 복조(Restore)
   */
  async restoreFromFirebase(): Promise<{ success: boolean; message: string; error?: string }> {
    const response = await fetch("/api/firebase/restore-from-cloud", { method: "POST" });
    return await response.json();
  }
};

export interface AdminBranchSetting extends BranchSetting {
  isActive: boolean;
}

