// src/api/gasClient.ts

export interface BranchSetting {
  branchName: string;
  brand: string;
  role: string | "branch" | "admin";
  branches?: Array<{
    branchName: string;
    brand: string;
    role: string | "branch" | "admin";
  }>;
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
  division?: string;
}

export interface RosterEmployee {
  id: string;
  name: string;
  division: string;
  rank?: string;
  customRank?: string;
  residentNumber?: string;
  contractType?: "4대보험" | "3.3%";
  entryDate?: string;
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
    // 모든 기기가 동일한 백엔드를 사용하도록 배포 시 주입된 URL만 사용합니다.
    // 이전 기기에 남아 있는 custom_gas_url은 구버전 웹앱을 호출할 수 있어 무시합니다.
    const directGasUrl = (import.meta as any).env?.VITE_GAS_URL;

    let url = "/api/gas";
    const headers: Record<string, string> = {};

    // Determine current environment
    const isServerEnvironment = typeof window !== "undefined" && (
      window.location.hostname.includes("localhost") ||
      window.location.hostname.includes("127.0.0.1") ||
      window.location.hostname.includes("run.app")
    );

    if (directGasUrl && directGasUrl.trim() !== "" && directGasUrl.includes("script.google.com")) {
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

    // Apps Script는 콜드 스타트·시트 잠금 상황에서 수 초 더 걸릴 수 있습니다.
    // 7초에 요청을 취소하면 정상 저장 처리 중에도 브라우저가 "signal is aborted"를
    // 표시하므로, 마감 데이터를 안전하게 처리할 수 있는 시간으로 여유를 둡니다.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ action, ...params }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
    
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
    if (error?.name === "AbortError" || /aborted/i.test(String(error?.message || ""))) {
      throw new Error("서버 응답이 지연되고 있습니다. 잠시 후 마감 내역을 확인한 뒤 다시 시도해 주세요.");
    }
    throw error;
  }
}

export interface DailyFormBootstrap {
  exists: boolean;
  recordId: string | null;
  record: MasterDaily | null;
  previousCash: string;
}

// 같은 화면에서 동일한 읽기 요청이 반복되는 것을 막습니다. 탭 이동 시에는
// 이미 받은 데이터를 즉시 보여 주되, 짧은 시간 뒤에는 다시 서버에서 최신값을 받습니다.
const READ_CACHE_TTL_MS = 15000;
const readCache = new Map<string, { expiresAt: number; value: unknown }>();
const pendingReadRequests = new Map<string, Promise<unknown>>();

async function callCachedReadApi<T>(action: string, params: Record<string, any> = {}): Promise<T> {
  const cacheKey = `${action}:${JSON.stringify(params)}`;
  const cached = readCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;

  const pending = pendingReadRequests.get(cacheKey);
  if (pending) return pending as Promise<T>;

  const request = callApi(action, params)
    .then((value) => {
      readCache.set(cacheKey, { value, expiresAt: Date.now() + READ_CACHE_TTL_MS });
      return value;
    })
    .finally(() => pendingReadRequests.delete(cacheKey));

  pendingReadRequests.set(cacheKey, request);
  return request as Promise<T>;
}

function clearReadCache() {
  readCache.clear();
}

// Helper to safely write to direct Firebase in the background (used for Netlify / local offline static modes)
async function tryDirectBackup(type: "settle" | "setting" | "delete_setting", id: string, payload?: any) {
  try {
    const isServerEnv = typeof window !== "undefined" && (
      window.location.hostname.includes("localhost") ||
      window.location.hostname.includes("127.0.0.1") ||
      window.location.hostname.includes("run.app")
    );
    
    // In Netlify/static environments (where server.ts is non-existent), we mirror directly from the browser.
    if (!isServerEnv) {
      const { isFirebaseConfigValid, getDirectDb, backupSettleDirect, backupSettingDirect, deleteSettingDirect } = await import("./firebaseDirect");
      if (isFirebaseConfigValid()) {
        const db = getDirectDb();
        if (db) {
          if (type === "settle") {
            await backupSettleDirect(id, payload);
          } else if (type === "setting") {
            await backupSettingDirect(id, payload);
          } else if (type === "delete_setting") {
            await deleteSettingDirect(id);
          }
        }
      }
    }
  } catch (err) {
    console.warn("[Firebase Direct Mirror Error] Failed during live direct browser backup:", err);
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
    if (!branchName) {
      return { exists: false, record: null };
    }
    const { firebaseGetDailyFormBootstrap } = await import("./firebaseDirect");
    return await firebaseGetDailyFormBootstrap(branchName, settleDate);
  },

  async getDailyFormBootstrap(branchName: string, settleDate: string): Promise<DailyFormBootstrap> {
    const { firebaseGetDailyFormBootstrap } = await import("./firebaseDirect");
    return await firebaseGetDailyFormBootstrap(branchName, settleDate);
  },

  /**
   * 마감 정산 데이터 신규 저장
   */
  async submitDaily(master: MasterDaily, expenses: ExpenseDetail[], staff: StaffRecord[]): Promise<{ recordId: string }> {
    if (!master || !(master.branchName || (master as any).branch_name)) {
      throw new Error("지점 정보가 없습니다. 로그아웃 후 다시 로그인하고 지점을 선택해 주세요.");
    }
    // masterData는 구버전 GAS 호환용 별칭 (신버전은 master 우선, 구버전은 masterData 사용)
    const { firebaseSubmitDaily } = await import("./firebaseDirect");
    const result = await firebaseSubmitDaily(master, expenses || [], staff || []);
    clearReadCache();
    if (result && result.recordId) {
      // Netlify 환경인 경우, 마감 정산 보존을 Firestore 클라우드 수집본에 직접 저장
      // 보조 백업은 저장 완료 화면을 늦추지 않도록 뒤에서 실행합니다.
    }
    return result;
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
    const { firebaseUpdateDaily } = await import("./firebaseDirect");
    const result = await firebaseUpdateDaily(recordId, masterData, expenses, staff, modifiedBy);
    clearReadCache();
    if (result && result.success !== false) {
      // 상세 데이터 조회를 거쳐 최신 전체본 획득 후 실시간 백업 거동 동정화
      try {
        const freshDetail = await this.getDailyDetail(recordId);
        await tryDirectBackup("settle", recordId, freshDetail);
      } catch (err) {
        console.warn("[Firebase Mirror Update Warn] Failed to fetch updated detail to backup:", err);
      }
    }
    return result;
  },

  /**
   * 특정 일자의 전체 지점 마감 리스트 조회
   */
  async getDailyList(settleDate: string, adminPinHash?: string): Promise<DailyListRow[]> {
    const { firebaseGetDailyList } = await import("./firebaseDirect");
    return await firebaseGetDailyList(settleDate);
  },

  /**
   * 특정 레코드 상세 조회 (마스터 + 지출 + 인원)
   */
  async getDailyDetail(recordId: string): Promise<DailySettleDetail> {
    const { firebaseGetDailyDetail } = await import("./firebaseDirect");
    return await firebaseGetDailyDetail(recordId);
  },

  /**
   * 특정 지점의 모든 마감 기록 조회 (히스토리)
   */
  async getBranchHistory(branchName: string, month?: string): Promise<MasterDaily[]> {
    try {
      const { firebaseGetBranchHistory } = await import("./firebaseDirect");
      return await firebaseGetBranchHistory(branchName, month);
    } catch (err) {
      console.warn("getBranchHistory Action Failed. Returning empty fallback array.", err);
      return [];
    }
  },

  /**
   * 전체 지점 설정 목록 반환
   */
  async getBranchList(): Promise<BranchSetting[]> {
    const { firebaseGetBranchList } = await import("./firebaseDirect");
    return await firebaseGetBranchList();
  },

  /**
   * 관리자용: 활성/비활성 포함 전체 지점 목록 조회
   */
  async getBranchListAll(): Promise<AdminBranchSetting[]> {
    return await callApi("getBranchListAll");
  },

  async getAttendanceLog(branchName: string, logType: "overtime" | "partTime"): Promise<{ records: any[]; summaryList: any[] }> {
    const { firebaseGetBranchHistory, firebaseGetDailyDetail } = await import("./firebaseDirect");
    const history = await firebaseGetBranchHistory(branchName);
    const records: any[] = [];
    const summary = new Map<string, { hours: number; overtime: number; dates: Set<string> }>();
    for (const item of history) {
      const detail = await firebaseGetDailyDetail(item.recordId!);
      // 일일마감 화면의 출·퇴근 시각과 초과시간은 상세 METADATA에 보존됩니다.
      // 요약 staff 배열에는 근무시간만 있으므로, 수정 후에도 일지에 정확히
      // 표시되도록 METADATA를 우선 사용하고 구형 데이터만 요약 배열로 보완합니다.
      let detailedStaff: any[] = [];
      try {
        const metadataText = String(item.memo || "").split("\n---\nMETADATA:")[1];
        const metadata = metadataText ? JSON.parse(metadataText.trim()) : null;
        detailedStaff = Array.isArray(metadata?.staffRows) ? metadata.staffRows.map((row: any) => ({
          ...row,
          staffName: row.staffName || row.name
        })) : [];
      } catch (error) {
        console.warn("근무 일지 메타데이터를 읽지 못해 요약 데이터로 대체합니다.", error);
      }
      const sourceStaff = detailedStaff.length > 0 ? detailedStaff : (detail.staff as any[]);
      for (const staff of sourceStaff) {
        const isPartTime = staff.division === "파트타이머" && Number(staff.workHours || 0) > 0;
        const isOvertime = staff.division === "정직원" && Number(staff.overtime || 0) !== 0;
        if ((logType === "partTime" && !isPartTime) || (logType === "overtime" && !isOvertime)) continue;
        const staffName = staff.staffName || staff.name;
        records.push({ settleDate: item.settleDate, staffName, clockIn: staff.clockIn || "00:00", clockOut: staff.clockOut || "00:00", workHours: Number(staff.workHours || 0), standardHours: Number(staff.standardHours || 0), overtime: Number(staff.overtime || 0), overtimeReason: staff.overtimeReason || "-", writer: item.submittedBy || "점장" });
        const aggregate = summary.get(staffName) || { hours: 0, overtime: 0, dates: new Set<string>() };
        aggregate.hours += Number(staff.workHours || 0); aggregate.overtime += Number(staff.overtime || 0); aggregate.dates.add(item.settleDate); summary.set(staffName, aggregate);
      }
    }
    records.sort((a, b) => b.settleDate.localeCompare(a.settleDate));
    const summaryList = Array.from(summary.entries()).map(([name, value]) => logType === "partTime" ? ({ name, totalHours: value.hours, daysCount: value.dates.size, workedDaysList: Array.from(value.dates).sort().map((date) => `${Number(date.split("-")[2])}일`).join(", ") }) : ({ name, totalOvertime: value.overtime }));
    return { records, summaryList };
  },

  async getStaffRoster(branchName: string): Promise<RosterEmployee[]> {
    const { firebaseGetStaffRoster } = await import("./firebaseDirect");
    return await firebaseGetStaffRoster(branchName);
  },

  async saveStaffRoster(branchName: string, employees: RosterEmployee[]): Promise<{ success: boolean; employees: RosterEmployee[] }> {
    const { firebaseSaveStaffRoster } = await import("./firebaseDirect");
    const result = await firebaseSaveStaffRoster(branchName, employees);
    clearReadCache();
    return result;
  },

  async getSharedData<T = unknown>(dataKey: string): Promise<T | null> {
    const { firebaseGetSharedData } = await import("./firebaseDirect");
    return await firebaseGetSharedData(dataKey);
  },

  async saveSharedData(dataKey: string, value: unknown): Promise<{ success: boolean }> {
    const { firebaseSaveSharedData } = await import("./firebaseDirect");
    const result = await firebaseSaveSharedData(dataKey, value);
    clearReadCache();
    return result;
  },

  /**
   * 관리자용: 신규 지점 등록
   */
  async addBranch(branchName: string, pinHash: string, brand: string, role?: string): Promise<{ success: boolean }> {
    const result = await callApi("addBranch", { branchName, pinHash, brand, role });
    if (result && result.success !== false) {
      await tryDirectBackup("setting", branchName, { branch_name: branchName, pin_hash: pinHash, brand, role, is_active: true });
    }
    return result;
  },

  /**
   * 관리자용: 지점 활성화/비활성화 상태 변경
   */
  async toggleBranchActive(branchName: string, isActive: boolean): Promise<{ success: boolean }> {
    const result = await callApi("toggleBranchActive", { branchName, isActive });
    if (result && result.success !== false) {
      await tryDirectBackup("setting", branchName, { branch_name: branchName, is_active: isActive });
    }
    return result;
  },

  /**
   * 관리자용: 지점 PIN 비밀번호 해시 교체
   */
  async updateBranchPin(branchName: string, pinHash: string): Promise<{ success: boolean }> {
    const result = await callApi("updateBranchPin", { branchName, pinHash });
    if (result && result.success !== false) {
      await tryDirectBackup("setting", branchName, { branch_name: branchName, pin_hash: pinHash });
    }
    return result;
  },

  /**
   * 관리자용: 지점 삭제 (데이터행 완전히 제거)
   */
  async deleteBranch(branchName: string): Promise<{ success: boolean }> {
    const result = await callApi("deleteBranch", { branchName });
    if (result && result.success !== false) {
      await tryDirectBackup("delete_setting", branchName);
    }
    return result;
  },

  /**
   * 관리자용: Firebase 연동 상태 모니터링 (서버 헬스체크 우선, 실패 시 혹은 정적 Netlify 호스팅 시 다이렉트 Firestore 헬스 측정)
   */
  async getFirebaseStatus(): Promise<{ success: boolean; connected: boolean; projectId: string; totalSettles: number; totalSettings: number; error?: string }> {
    const isServerEnvironment = typeof window !== "undefined" && (
      window.location.hostname.includes("localhost") ||
      window.location.hostname.includes("127.0.0.1") ||
      window.location.hostname.includes("run.app")
    );

    if (!isServerEnvironment) {
      const { getDirectFirebaseStatus } = await import("./firebaseDirect");
      return await getDirectFirebaseStatus();
    }

    try {
      const response = await fetch("/api/firebase/status");
      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      return await response.json();
    } catch (err) {
      console.warn("[Firebase API] Server status route failed. Utilizing direct browser connector.", err);
      const { getDirectFirebaseStatus } = await import("./firebaseDirect");
      return await getDirectFirebaseStatus();
    }
  },

  /**
   * 관리자용: 로컬 또는 구글시트 전체 데이터를 Firebase Firestore로 수점 백업
   */
  async syncToFirebase(): Promise<{ success: boolean; message?: string; error?: string }> {
    const isServerEnvironment = typeof window !== "undefined" && (
      window.location.hostname.includes("localhost") ||
      window.location.hostname.includes("127.0.0.1") ||
      window.location.hostname.includes("run.app")
    );

    if (!isServerEnvironment) {
      const { syncDirectToFirebase } = await import("./firebaseDirect");
      return await syncDirectToFirebase();
    }

    try {
      const response = await fetch("/api/firebase/sync-to-cloud", { method: "POST" });
      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      return await response.json();
    } catch (err) {
      console.warn("[Firebase API] Server sync route failed. Utilizing direct browser syncer.", err);
      const { syncDirectToFirebase } = await import("./firebaseDirect");
      return await syncDirectToFirebase();
    }
  },

  /**
   * 관리자용: Firebase Firestore 클라우드 보존재를 기반으로 현업 및 로컬 데이터 강제 복조(Restore)
   */
  async restoreFromFirebase(): Promise<{ success: boolean; message?: string; error?: string }> {
    const isServerEnvironment = typeof window !== "undefined" && (
      window.location.hostname.includes("localhost") ||
      window.location.hostname.includes("127.0.0.1") ||
      window.location.hostname.includes("run.app")
    );

    if (!isServerEnvironment) {
      const { restoreDirectFromFirebase } = await import("./firebaseDirect");
      return await restoreDirectFromFirebase();
    }

    try {
      const response = await fetch("/api/firebase/restore-from-cloud", { method: "POST" });
      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      return await response.json();
    } catch (err) {
      console.warn("[Firebase API] Server restore route failed. Utilizing direct browser restorer.", err);
      const { restoreDirectFromFirebase } = await import("./firebaseDirect");
      return await restoreDirectFromFirebase();
    }
  }
};

export interface AdminBranchSetting extends BranchSetting {
  isActive: boolean;
}

