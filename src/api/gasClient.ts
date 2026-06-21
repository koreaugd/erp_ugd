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
    const url = (localGasUrl && localGasUrl.trim() !== "")
      ? localGasUrl
      : (directGasUrl && directGasUrl.trim() !== "" ? directGasUrl : "/api/gas");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
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
    return await callApi("getBranchHistory", { branchName });
  },

  /**
   * 전체 지점 설정 목록 반환
   */
  async getBranchList(): Promise<BranchSetting[]> {
    return await callApi("getBranchList");
  }
};
