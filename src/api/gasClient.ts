// src/api/gasClient.ts

import { isMissingChunkError, reloadForMissingChunk } from "../utils/chunkReload";

/**
 * 파이어베이스 통신 코드는 미리 받아두지 않고, 저장·조회·제출하는 순간에 받아온다.
 * 그 파일 이름에는 빌드마다 바뀌는 번호가 붙고(firebaseDirect-a1b2c3.js), 배포하면 옛 파일은
 * 서버에서 사라진다. 그래서 배포 전에 열어둔 화면이 제출을 누르면 "없는 파일"을 달라고 하게 된다.
 *
 * 부르는 쪽은 이 실패를 자기 try/catch 로 붙잡아 토스트로 띄우고 끝낸다 — 전역 감시망
 * (installChunkReloadGuard)에 걸리지 않아 자동 새로고침이 발동하지 않고, 지점은 제출이 안 되는
 * 상태에 갇힌다. 그러니 삼켜지기 전에 여기서 알아채고 최신 파일을 받아온다.
 */
async function loadFirebaseDirect() {
  try {
    return await import("./firebaseDirect");
  } catch (err) {
    if (isMissingChunkError(err) && (await reloadForMissingChunk("firebaseDirect"))) {
      throw new Error("새 버전이 배포되어 화면을 다시 불러옵니다. 잠시만 기다려 주세요.");
    }
    throw err;
  }
}

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
  submittedByUid?: string;   // personal 로그인 계정의 uid. GAS 시트엔 이 컬럼이 없다 — Firebase 문서에만 저장.
  modifiedAt?: string;
  modifiedBy?: string;
  modifiedByUid?: string;    // personal 로그인 계정의 uid. GAS 시트엔 이 컬럼이 없다 — Firebase 문서에만 저장.
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
  phone?: string;
  addReason?: string;
  fromBranch?: string;
  transferDate?: string;
  salaryChanged?: "있음" | "없음";
  hireDate?: string;
  addReasonMemo?: string;
  employeeId?: string;
  birthDate?: string;
  salary?: number;
}

// 지점이 등록하고 관리자가 확인하는 근로계약서 발송 대상 레코드.
// 지점·관리자가 labor_contracts_<지점> / labor_contracts:<지점> 두 키를 공유한다.
export interface LaborContract {
  id: string;
  name: string;
  phone: string;
  salary: number;
  // 신규입사/지점이동 구분과 입사·이동일. 지점이동일 때만 previousBranch(이전 지점명)가 채워진다.
  // 옛 레코드에는 없을 수 있어 전부 선택 필드로 둔다(표시 시 없으면 "-").
  contractType?: "신규입사" | "지점이동";
  // 계약 기간 유형(2026-07-29): 신입은 기간을 정해 계약서를 따로 보내야 해서 구분이 필요하다.
  // 옛 레코드에는 없다(표시 "-"). 값은 짧게 저장하고 라벨은 LABOR_CONTRACT_PERIOD_LABEL 로 그린다.
  //
  // "1주"·"2주"는 **옛 값**이다(2026-07-31에 신청 폼에서 뺐다). 기간이 그 둘로만 고정돼
  // 실제 계약과 맞지 않는 경우가 있어, 시작·종료일을 직접 고르는 "기간작성"으로 바꿨다.
  // 타입에 남겨 둬야 이미 등록된 기록을 그대로 읽고 보여줄 수 있다.
  periodType?: "기간작성" | "정규" | "1주" | "2주";
  effectiveDate?: string;
  /** periodType === "기간작성" 일 때의 종료일(YYYY-MM-DD). 시작일은 effectiveDate 다. */
  periodEndDate?: string;
  previousBranch?: string;
  status?: string;
  createdAt?: string;
  editRequestedAt?: string;
  deleteRequested?: boolean;
  deleteRequestedAt?: string;
  statusUpdatedAt?: string;
}

// 계약유형 표시 라벨 — 지점 등록 폼·지점 표·관리자 표가 같은 문구를 쓴다.
/**
 * 입사·이동일 칸에 적을 말 — 기간이 있는 계약은 **언제부터 언제까지인지** 한 칸에 적는다
 * (사용자 지시 2026-07-31). 컬럼을 늘리지 않고 `yy.mm.dd~yy.mm.dd` 형태로 보여준다.
 *
 *  · "기간작성"  — 지점이 달력에서 고른 종료일(periodEndDate)을 그대로 쓴다.
 *  · "1주"·"2주" — **옛 기록**이라 종료일이 저장돼 있지 않다. 시작일에서 계산한다
 *                  (시작일을 포함해 세는 기준이라 1주=+6일, 2주=+13일).
 *  · 정규·그 밖  — 날짜 하나만 적는다.
 */
export const laborContractPeriodText = (effectiveDate?: string, periodType?: string, periodEndDate?: string): string => {
  const raw = String(effectiveDate || "").trim();
  if (!raw) return "-";
  const short = (d: Date) =>
    `${String(d.getFullYear()).slice(-2)}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  // 날짜로 못 읽으면(형식이 다른 옛 기록) 원문을 그대로 보여준다 — 임의로 고쳐 적지 않는다.
  const start = new Date(`${raw}T00:00:00`);
  if (isNaN(start.getTime())) return raw;
  if (periodType === "기간작성") {
    const endRaw = String(periodEndDate || "").trim();
    const end = endRaw ? new Date(`${endRaw}T00:00:00`) : null;
    // 종료일이 없거나 못 읽으면 시작일만 적는다 — 없는 날짜를 지어내지 않는다.
    if (!end || isNaN(end.getTime())) return short(start);
    return `${short(start)}~${short(end)}`;
  }
  const addDays = periodType === "1주" ? 6 : periodType === "2주" ? 13 : null;
  if (addDays === null) return short(start);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + addDays);
  return `${short(start)}~${short(end)}`;
};

export const LABOR_CONTRACT_PERIOD_LABEL: Record<NonNullable<LaborContract["periodType"]>, string> = {
  "기간작성": "기간작성(수습)",
  "정규": "정규(수습 후 계속)",
  // 아래 둘은 옛 기록 표시용 — 신청 폼 선택지에는 더 이상 없다.
  "1주": "1주",
  "2주": "2주",
};

// 파트타이머 근로계약서 양식(전 지점 공통 1개)의 파일 정보.
// 파일 본문(base64)은 별도 문서에 둔다 — 아래 getLaborContractTemplateFile 참고.
export interface LaborContractTemplateMeta {
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
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
const ATTENDANCE_CACHE_TTL_MS = 45000;
const attendanceLogCache = new Map<string, { expiresAt: number; value: { records: any[]; summaryList: any[] } }>();
const pendingAttendanceRequests = new Map<string, Promise<{ records: any[]; summaryList: any[] }>>();

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
  attendanceLogCache.clear();
}

// Helper to safely write to direct Firebase in the background (used for Netlify / local offline static modes)
async function tryDirectBackup(type: "settle" | "setting" | "delete_setting", id: string, payload?: any, isAdminSession = false) {
  try {
    const isServerEnv = typeof window !== "undefined" && (
      window.location.hostname.includes("localhost") ||
      window.location.hostname.includes("127.0.0.1") ||
      window.location.hostname.includes("run.app")
    );

    // In Netlify/static environments (where server.ts is non-existent), we mirror directly from the browser.
    if (!isServerEnv) {
      const { isFirebaseConfigValid, getDirectDb, backupSettleDirect, backupSettingDirect, deleteSettingDirect } = await loadFirebaseDirect();
      if (isFirebaseConfigValid()) {
        const db = getDirectDb();
        if (db) {
          if (type === "settle") {
            await backupSettleDirect(id, payload);
          } else if (type === "setting") {
            await backupSettingDirect(id, payload, isAdminSession);
          } else if (type === "delete_setting") {
            await deleteSettingDirect(id);
          }
        }
      }
    }
  } catch (err) {
    console.warn("[Firebase Direct Mirror Error] Failed during live direct browser backup:", err);
    if (type === "setting" || type === "delete_setting") {
      throw err;
    }
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
    const { firebaseGetDailyFormBootstrap } = await loadFirebaseDirect();
    return await firebaseGetDailyFormBootstrap(branchName, settleDate);
  },

  async getDailyFormBootstrap(branchName: string, settleDate: string): Promise<DailyFormBootstrap> {
    const { firebaseGetDailyFormBootstrap } = await loadFirebaseDirect();
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
    const { firebaseSubmitDaily } = await loadFirebaseDirect();
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
    modifiedBy?: string,
    modifiedByUid?: string
  ): Promise<{ success: boolean; editLogFailed?: boolean }> {
    const { firebaseUpdateDaily } = await loadFirebaseDirect();
    const result = await firebaseUpdateDaily(recordId, masterData, expenses, staff, modifiedBy, modifiedByUid);
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

  async deleteDaily(recordId: string): Promise<{ success: boolean }> {
    const { firebaseDeleteDaily } = await loadFirebaseDirect();
    const result = await firebaseDeleteDaily(recordId);
    clearReadCache();
    return result;
  },

  async getEditLogs(): Promise<any[]> {
    const { firebaseGetEditLogs } = await loadFirebaseDirect();
    return await firebaseGetEditLogs();
  },

  async deleteEditLog(logId: string): Promise<{ success: boolean }> {
    const { firebaseDeleteEditLog } = await loadFirebaseDirect();
    const result = await firebaseDeleteEditLog(logId);
    clearReadCache();
    return result;
  },

  /**
   * 특정 일자의 전체 지점 마감 리스트 조회
   */
  async getDailyList(settleDate: string, adminPinHash?: string): Promise<DailyListRow[]> {
    const { firebaseGetDailyList } = await loadFirebaseDirect();
    return await firebaseGetDailyList(settleDate);
  },

  /**
   * 특정 레코드 상세 조회 (마스터 + 지출 + 인원)
   */
  async getDailyDetail(recordId: string): Promise<DailySettleDetail> {
    const { firebaseGetDailyDetail } = await loadFirebaseDirect();
    return await firebaseGetDailyDetail(recordId);
  },

  /**
   * 특정 지점의 모든 마감 기록 조회 (히스토리)
   */
  async getBranchHistory(branchName: string, month?: string): Promise<MasterDaily[]> {
    try {
      const { firebaseGetBranchHistory } = await loadFirebaseDirect();
      return await firebaseGetBranchHistory(branchName, month);
    } catch (err) {
      console.warn("getBranchHistory Action Failed. Returning empty fallback array.", err);
      return [];
    }
  },

  /**
   * 지정한 날짜들의 마감 기록만 읽는다(대시보드 그래프·달력 전용).
   * 읽는 양이 '화면이 보여주는 날짜 수'로 고정된다 — 지점 전체 히스토리를 훑지 않는다.
   * 실패는 삼키지 않고 throw — 호출부가 '기록 없음'과 '못 불러옴'을 구분할 수 있어야 한다.
   * 모든 마감 문서가 ID 규칙(`지점--날짜`)을 따른다는 전제 위에 있다(firebaseGetDailyMastersByDates 주석 참고).
   */
  async getDailyMastersByDates(branchName: string, dates: string[]): Promise<MasterDaily[]> {
    const { firebaseGetDailyMastersByDates } = await loadFirebaseDirect();
    return await firebaseGetDailyMastersByDates(branchName, dates);
  },

  // 서버 전용·fail-closed 히스토리 조회: 실패를 []로 삼키지 않고 그대로 throw한다.
  // 월말마감 엑셀 등 "빈/오래된 데이터로 조용히 채우면 안 되는" 정산 산출물 전용.
  async getBranchHistoryFromServer(branchName: string, month?: string): Promise<MasterDaily[]> {
    const { firebaseGetBranchHistoryFromServer } = await loadFirebaseDirect();
    return await firebaseGetBranchHistoryFromServer(branchName, month);
  },

  /**
   * 전체 지점 설정 목록 반환
   */
  async getBranchList(): Promise<BranchSetting[]> {
    const { firebaseGetBranchList } = await loadFirebaseDirect();
    return await firebaseGetBranchList();
  },

  /**
   * 관리자용: 활성/비활성 포함 전체 지점 목록 조회
   */
  async getBranchListAll(): Promise<AdminBranchSetting[]> {
    return await callApi("getBranchListAll");
  },

  // serverOnly: 서버 문서만 읽는다(캐시 폴백 없음, 실패 시 throw). 급여대장 초과근무 집계처럼
  // 오래된 캐시가 '정상 집계'로 둔갑하면 위험한 참고값 화면 전용.
  async getAttendanceLog(branchName: string, logType: "overtime" | "partTime", month?: string, forceRefresh = false, serverOnly = false): Promise<{ records: any[]; summaryList: any[] }> {
    // serverOnly는 캐시/pending 키를 일반 요청과 분리한다 — 키를 공유하면 동시에 뜬 일반 호출이
    // server-only promise(상세 실패 시 reject)를 재사용해, '일부 실패는 건너뛰고 집계'하던 기존 동작이 깨진다.
    const cacheKey = `${branchName}:${logType}:${month || "all"}:${serverOnly ? "server" : "std"}`;
    const cached = attendanceLogCache.get(cacheKey);
    if (!forceRefresh && !serverOnly && cached && cached.expiresAt > Date.now()) return cached.value;
    const pending = pendingAttendanceRequests.get(cacheKey);
    if (!forceRefresh && !serverOnly && pending) return pending;

    const { firebaseGetBranchHistory, firebaseGetBranchHistoryFromServer, firebaseGetDailyDetail, firebaseGetDailyDetailFromServer } = await loadFirebaseDirect();
    const request = (async () => {
      const allHistory = serverOnly
        ? await firebaseGetBranchHistoryFromServer(branchName)
        : await firebaseGetBranchHistory(branchName);
      const history = allHistory.filter((item) => {
        const settleMonth = String(item.settleDate || "").slice(0, 7);
        if (!month) return true;
        return logType === "overtime" ? settleMonth <= month : settleMonth === month;
      });
      const records: any[] = [];
      const summary = new Map<string, { hours: number; overtime: number; dates: Set<string> }>();

      const fallbackDetails = await Promise.all(history.map(async (item) => {
        const metadataText = String(item.memo || "").split("\n---\nMETADATA:")[1];
        if (metadataText) return null;
        if (!item.recordId) return null;
        // serverOnly: 캐시 폴백 없는 서버 전용 읽기, 실패도 삼키지 않는다 —
        // 하루치가 빠진 '부분 집계'가 정상처럼 보이면 그 숫자로 급여를 적게 된다.
        if (serverOnly) return await firebaseGetDailyDetailFromServer(item.recordId);
        try {
          return await firebaseGetDailyDetail(item.recordId);
        } catch (error) {
          console.warn("근무 일지 상세 데이터를 읽지 못했습니다.", error);
          return null;
        }
      }));

      history.forEach((item, index) => {
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
      const detail = fallbackDetails[index];
      const sourceStaff = detailedStaff.length > 0 ? detailedStaff : ((detail?.staff || []) as any[]);
      const calculatedOvertimeByIndex = new Map<number, number>();
      const staffGroups = new Map<string, number[]>();
      sourceStaff.forEach((staff, staffIndex) => {
        const staffKey = staff.residentNumber || staff.staffName || staff.name || `row-${staffIndex}`;
        staffGroups.set(staffKey, [...(staffGroups.get(staffKey) || []), staffIndex]);
      });
      staffGroups.forEach((indexes) => {
        const activeIndexes = indexes.filter((staffIndex) => sourceStaff[staffIndex]?.officeWorkType !== "휴무" && Number(sourceStaff[staffIndex]?.workHours || 0) > 0);
        if (activeIndexes.length === 0) return;
        const standardHours = activeIndexes.reduce((value, staffIndex) => value || Number(sourceStaff[staffIndex]?.standardHours || 0), 0)
          || (branchName === "본사" ? 10 : 0);
        if (!standardHours) return;
        const totalWorkHours = activeIndexes.reduce((sum, staffIndex) => sum + Number(sourceStaff[staffIndex]?.workHours || 0), 0);
        const totalDelta = Number((totalWorkHours - standardHours).toFixed(1));
        if (totalDelta <= 0) {
          calculatedOvertimeByIndex.set(activeIndexes[activeIndexes.length - 1], totalDelta);
          return;
        }
        let cumulativeHours = 0;
        let allocatedOvertime = 0;
        activeIndexes.forEach((staffIndex) => {
          cumulativeHours += Number(sourceStaff[staffIndex]?.workHours || 0);
          const totalOvertime = Math.max(0, cumulativeHours - standardHours);
          const rowOvertime = Number((totalOvertime - allocatedOvertime).toFixed(1));
          allocatedOvertime = totalOvertime;
          calculatedOvertimeByIndex.set(staffIndex, rowOvertime);
        });
      });
      for (const [staffIndex, staff] of sourceStaff.entries()) {
        const workplace = staff.officeWorkplace || branchName;
        const workHours = Number(staff.workHours || 0);
        const rawStandardHours = Number(staff.standardHours || 0);
        const standardHours = rawStandardHours || (branchName === "본사" && staff.division === "정직원" && workHours > 0 ? 10 : 0);
        const storedOvertime = Number(staff.overtime || 0);
        let effectiveOvertime = storedOvertime !== 0 ? storedOvertime : (calculatedOvertimeByIndex.get(staffIndex) || 0);
        // 관리자가 초과근무/조기퇴근 기록을 "삭제"하면 그 당시 초과시간 값이 overtimeCleared에 기록되고 사유는 비워집니다.
        // 조기퇴근/초과시간은 출퇴근 시각에서 다시 계산되어 되살아나므로, 저장을 0으로 덮는 것만으로는 지워지지 않습니다.
        // 억제 조건: (1) 삭제 마커가 있고 (2) 사유가 비어 있으며 (3) 계산된 값이 삭제 당시 값과 같을 때만 숨깁니다.
        //  → 출퇴근이 바뀌어 값이 달라지거나, 마감화면에서 사유를 달아 정당하게 재입력하면 자동으로 다시 노출됩니다.
        const clearedOvertime = staff.overtimeCleared;
        const hasOvertimeReason = String(staff.overtimeReason || "").trim().length > 0;
        if (clearedOvertime !== undefined && clearedOvertime !== null && !hasOvertimeReason && Math.abs(Number(clearedOvertime) - effectiveOvertime) < 0.05) {
          effectiveOvertime = 0;
        }
        const isDispatchedFromHeadOffice = branchName === "본사" && workplace !== "본사" && Number(staff.workHours || 0) > 0;
        const isPartTime = (staff.division === "파트타이머" || isDispatchedFromHeadOffice) && workHours > 0;
        const isOvertime = staff.division === "정직원" && effectiveOvertime !== 0;
        if ((logType === "partTime" && !isPartTime) || (logType === "overtime" && !isOvertime)) continue;
        const staffName = staff.staffName || staff.name;
        records.push({ recordId: item.recordId, settleDate: item.settleDate, segmentId: staff.segmentId || "", staffName, clockIn: staff.clockIn || "00:00", clockOut: staff.clockOut || "00:00", workHours, standardHours, overtime: effectiveOvertime, overtimeReason: staff.overtimeReason || "-", officeWorkplace: workplace, officeTaskMemo: staff.officeTaskMemo || "", writer: item.submittedBy || "점장" });
        const aggregate = summary.get(staffName) || { hours: 0, overtime: 0, dates: new Set<string>() };
        aggregate.hours += workHours; aggregate.overtime += effectiveOvertime; aggregate.dates.add(item.settleDate); summary.set(staffName, aggregate);
      }
      });
      records.sort((a, b) => b.settleDate.localeCompare(a.settleDate));
      const summaryList = Array.from(summary.entries()).map(([name, value]) => logType === "partTime" ? ({ name, totalHours: value.hours, daysCount: value.dates.size, workedDaysList: Array.from(value.dates).sort().map((date) => `${Number(date.split("-")[2])}일`).join(", ") }) : ({ name, totalOvertime: value.overtime }));
      const result = { records, summaryList };
      attendanceLogCache.set(cacheKey, { value: result, expiresAt: Date.now() + ATTENDANCE_CACHE_TTL_MS });
      return result;
    })().finally(() => pendingAttendanceRequests.delete(cacheKey));

    pendingAttendanceRequests.set(cacheKey, request);
    return request;
  },

  async getStaffRoster(branchName: string): Promise<RosterEmployee[]> {
    const { firebaseGetStaffRoster } = await loadFirebaseDirect();
    return await firebaseGetStaffRoster(branchName);
  },

  async saveStaffRoster(branchName: string, employees: RosterEmployee[]): Promise<{ success: boolean; employees: RosterEmployee[] }> {
    const { firebaseSaveStaffRoster } = await loadFirebaseDirect();
    const result = await firebaseSaveStaffRoster(branchName, employees);
    clearReadCache();
    return result;
  },

  async getBranchOwnRoster(branchName: string): Promise<RosterEmployee[]> {
    const { firebaseGetBranchOwnRoster } = await loadFirebaseDirect();
    return await firebaseGetBranchOwnRoster(branchName);
  },

  // 서버 전용·fail-closed 명단 조회: 캐시 폴백 없이 서버 문서만 읽고 실패 시 throw. 월말마감 엑셀 등 전용.
  async getBranchOwnRosterFromServer(branchName: string): Promise<RosterEmployee[]> {
    const { firebaseGetBranchOwnRosterFromServer } = await loadFirebaseDirect();
    return await firebaseGetBranchOwnRosterFromServer(branchName);
  },

  async saveBranchOwnRoster(branchName: string, employees: RosterEmployee[]): Promise<{ success: boolean; employees: RosterEmployee[] }> {
    const { firebaseSaveBranchOwnRoster } = await loadFirebaseDirect();
    const result = await firebaseSaveBranchOwnRoster(branchName, employees);
    clearReadCache();
    return result;
  },

  async getSharedData<T = unknown>(dataKey: string): Promise<T | null> {
    const { firebaseGetSharedData } = await loadFirebaseDirect();
    return await firebaseGetSharedData(dataKey);
  },

  // 서버 문서만 읽는다(캐시 폴백 없음). 오프라인이면 throw → 마감 검증에서 캐시로 승인되는 것을 막는다.
  async getSharedDataFromServer<T = unknown>(dataKey: string): Promise<T | null> {
    const { firebaseGetSharedDataFromServer } = await loadFirebaseDirect();
    return await firebaseGetSharedDataFromServer(dataKey);
  },

  async saveSharedData(dataKey: string, value: unknown): Promise<{ success: boolean }> {
    const { firebaseSaveSharedData } = await loadFirebaseDirect();
    const result = await firebaseSaveSharedData(dataKey, value);
    clearReadCache();
    return result;
  },

  // 자가복구 전용: 서버에 문서가 없을 때만 원자적으로 만든다(트랜잭션 create-only).
  // 이미 값이 있으면 덮지 않고 { created: false } 반환. 다른 기기의 최신 값을 덮어쓰지 않는다.
  /**
   * 배열형 공유데이터의 한 항목을 원자적으로 조건부 갱신한다(compare-and-set).
   * 동시에 같은 항목을 처리하려 할 때 하나만 성공해야 하는 경로(비즈니스택시 승인 선점)에서 쓴다.
   */
  async updateSharedArrayItem(
    dataKey: string,
    itemId: string,
    expectStatus: string[],
    patch: Record<string, unknown>,
    /** 추가 조건(선택) — 이 필드들이 모두 일치할 때만 갱신. 자기가 잡은 선점만 풀 때 쓴다. */
    expectMatch?: Record<string, unknown>
  ): Promise<{ outcome: "updated" | "notFound" | "conflict"; list: any[] }> {
    const { firebaseUpdateSharedArrayItem } = await loadFirebaseDirect();
    return await firebaseUpdateSharedArrayItem(dataKey, itemId, expectStatus, patch, expectMatch);
  },

  /**
   * 배열형 공유데이터에 항목을 원자적으로 추가한다(중복 검사 포함).
   * 동시 제출로 신청이 유실되면 안 되는 경로(비즈니스택시 신청 등)에서 saveSharedData 대신 쓴다.
   */
  async appendSharedArrayItem(
    dataKey: string,
    item: Record<string, unknown>,
    dedupe?: { match: Record<string, unknown>; statuses: string[] }
  ): Promise<{ outcome: "appended" | "duplicate"; list: any[] }> {
    const { firebaseAppendSharedArrayItem } = await loadFirebaseDirect();
    return await firebaseAppendSharedArrayItem(dataKey, item, dedupe);
  },

  async createSharedDataIfMissing(dataKey: string, value: unknown): Promise<{ created: boolean }> {
    const { firebaseCreateSharedDataIfMissing } = await loadFirebaseDirect();
    const result = await firebaseCreateSharedDataIfMissing(dataKey, value);
    clearReadCache();
    return result;
  },

  async getAllManualOvertimes(): Promise<any[]> {
    const { firebaseGetAllManualOvertimes } = await loadFirebaseDirect();
    return await firebaseGetAllManualOvertimes();
  },

  async getAllLaborContracts(): Promise<any[]> {
    const { firebaseGetAllLaborContracts } = await loadFirebaseDirect();
    return await firebaseGetAllLaborContracts();
  },

  // 양식은 메타(가벼움)와 파일 본문(최대 ~930KB)이 따로 저장돼 있다.
  // 화면을 그릴 땐 메타만 읽고, 파일은 다운로드를 누른 순간에만 읽는다.
  async getLaborContractTemplateMeta(): Promise<LaborContractTemplateMeta | null> {
    const { firebaseGetLaborContractTemplateMeta } = await loadFirebaseDirect();
    return (await firebaseGetLaborContractTemplateMeta()) as LaborContractTemplateMeta | null;
  },

  async getLaborContractTemplateFile(fileId: string): Promise<string | null> {
    const { firebaseGetLaborContractTemplateFile } = await loadFirebaseDirect();
    return await firebaseGetLaborContractTemplateFile(fileId);
  },

  async saveLaborContractTemplate(meta: LaborContractTemplateMeta, dataBase64: string): Promise<{ success: boolean }> {
    const { firebaseSaveLaborContractTemplate } = await loadFirebaseDirect();
    const result = await firebaseSaveLaborContractTemplate(meta, dataBase64);
    clearReadCache();
    return result;
  },

  /**
   * 관리자용: 신규 지점 등록
   */
  async addBranch(branchName: string, pinHash: string, brand: string, role?: string, rawPin?: string, isAdminSession = false): Promise<{ success: boolean }> {
    const result = await callApi("addBranch", { branchName, pinHash, brand, role });
    if (result && result.success !== false) {
      await tryDirectBackup("setting", branchName, { branch_name: branchName, pin_hash: pinHash, brand, role, rawPin, is_active: true }, isAdminSession);
    }
    return result;
  },

  /**
   * 관리자용: 지점 활성화/비활성화 상태 변경
   */
  async toggleBranchActive(branchName: string, isActive: boolean, isAdminSession = false): Promise<{ success: boolean }> {
    const result = await callApi("toggleBranchActive", { branchName, isActive });
    if (result && result.success !== false) {
      await tryDirectBackup("setting", branchName, { branch_name: branchName, is_active: isActive }, isAdminSession);
    }
    return result;
  },

  /**
   * 관리자용: 지점 PIN 비밀번호 해시 교체
   * meta(brand/role/isActive)를 꼭 함께 넘겨라 — Firestore 미러(backupSettingDirect)는 merge 없는
   * setDoc이라 메타가 빠지면 기본값(brand "기타", role "branch", is_active true)으로 문서를
   * 덮어써 관리자 행까지 오염시킨다(Codex P0 2026-07-27).
   */
  async updateBranchPin(branchName: string, pinHash: string, isAdminSession = false, meta?: { brand?: string; role?: string; isActive?: boolean }): Promise<{ success: boolean }> {
    const result = await callApi("updateBranchPin", { branchName, pinHash });
    if (result && result.success !== false) {
      await tryDirectBackup("setting", branchName, {
        branch_name: branchName,
        pin_hash: pinHash,
        ...(meta ? { brand: meta.brand, role: meta.role, is_active: meta.isActive } : {})
      }, isAdminSession);
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
      const { getDirectFirebaseStatus } = await loadFirebaseDirect();
      return await getDirectFirebaseStatus();
    }

    try {
      const response = await fetch("/api/firebase/status");
      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      return await response.json();
    } catch (err) {
      console.warn("[Firebase API] Server status route failed. Utilizing direct browser connector.", err);
      const { getDirectFirebaseStatus } = await loadFirebaseDirect();
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
      const { syncDirectToFirebase } = await loadFirebaseDirect();
      return await syncDirectToFirebase();
    }

    try {
      const response = await fetch("/api/firebase/sync-to-cloud", { method: "POST" });
      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      return await response.json();
    } catch (err) {
      console.warn("[Firebase API] Server sync route failed. Utilizing direct browser syncer.", err);
      const { syncDirectToFirebase } = await loadFirebaseDirect();
      return await syncDirectToFirebase();
    }
  },

  /**
   * 관리자용: Firebase Firestore 클라우드 보존재를 기반으로 현업 및 로컬 데이터 강제 복조(Restore)
   */
  async restoreFromFirebase(isAdminSession = false): Promise<{ success: boolean; message?: string; error?: string }> {
    const isServerEnvironment = typeof window !== "undefined" && (
      window.location.hostname.includes("localhost") ||
      window.location.hostname.includes("127.0.0.1") ||
      window.location.hostname.includes("run.app")
    );

    if (!isServerEnvironment) {
      const { restoreDirectFromFirebase } = await loadFirebaseDirect();
      return await restoreDirectFromFirebase(isAdminSession);
    }

    try {
      const response = await fetch("/api/firebase/restore-from-cloud", { method: "POST" });
      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      return await response.json();
    } catch (err) {
      console.warn("[Firebase API] Server restore route failed. Utilizing direct browser restorer.", err);
      const { restoreDirectFromFirebase } = await loadFirebaseDirect();
      return await restoreDirectFromFirebase(isAdminSession);
    }
  },

  // ----------------------------------------------------
  // 카카오T 비즈니스(법인택시) — 백엔드(GAS/로컬 server.ts)가 시크릿으로 서명해 카카오를 대신 호출한다.
  // 브라우저는 시크릿을 모른다. 액션 스펙: gas/Code.gs "카카오T 비즈니스 API 프록시" 섹션.
  // GAS 웹앱 URL은 공개돼 있으므로 모든 카카오 액션은 adminPinHash(로그인 세션의 pinHash)를
  // 함께 보내야 하고, 백엔드가 관리자 여부를 검증한다.
  // ----------------------------------------------------
  // forceRefresh=true 면 백엔드 캐시(당월 3분·지나간 달 6시간)를 우회해 카카오에서 실시간 조회한다 — 화면 '새로고침'용.
  async getKakaoTaxiOrders(month: string, adminPinHash: string, forceRefresh?: boolean): Promise<KakaoTaxiOrdersResult> {
    return callApi("getKakaoTaxiOrders", { month, adminPinHash, forceRefresh });
  },

  async getKakaoTaxiGroups(adminPinHash: string, forceRefresh?: boolean): Promise<{ groups: KakaoTaxiGroup[]; accountErrors: KakaoTaxiAccountError[] }> {
    return callApi("getKakaoTaxiGroups", { adminPinHash, forceRefresh });
  },

  // forceRefresh=true 면 백엔드가 ScriptCache 를 우회해 카카오에서 실시간 조회한다(화면 '새로고침'용).
  // 직원이 방금 카카오T 앱에서 인증을 마친 경우처럼 우리가 무효화하지 못하는 외부 변경을 즉시 반영한다.
  async getKakaoTaxiMembers(adminPinHash: string, forceRefresh?: boolean): Promise<{ count: number; members: KakaoTaxiMember[]; accountErrors: KakaoTaxiAccountError[] }> {
    return callApi("getKakaoTaxiMembers", { adminPinHash, forceRefresh });
  },

  // 지점용 — 백엔드가 지점 PIN을 검증하고 그 지점에 매핑되는 인원만 돌려준다(타 지점 정보 비노출).
  async getKakaoTaxiBranchMembers(branchName: string, pinHash: string, forceRefresh?: boolean): Promise<KakaoTaxiMember[]> {
    return callApi("getKakaoTaxiBranchMembers", { branchName, pinHash, forceRefresh });
  },

  // 지점 자동 등록 — 지점 PIN 게이트로 관리자 승인 없이 카카오에 바로 등록하고 인증 알림톡을 발송한다.
  // 백엔드가 지점명→그룹 자동 매핑·전화 중복 차단을 처리한다(지점은 그룹을 고르지 않는다).
  async submitBranchKakaoRegister(branchName: string, pinHash: string, name: string, phone: string, memo?: string): Promise<{ member: KakaoTaxiMember; tmsSent: boolean }> {
    return callApi("submitBranchKakaoRegister", { branchName, pinHash, name, phone, memo });
  },

  // 지점용 사전 확인 — 이용신청 전에 "이 번호가 이미 카카오T에 있는가"를 묻는다.
  // 백엔드가 지점 PIN 을 검증하고 전 계정을 실시간(캐시 우회) 조회한다. 타 지점 인원이면
  // 전화번호는 마스킹돼 오고(이름·소속은 전입 판단에 필요해 그대로), 계정 조회 실패 시 던진다(fail-closed).
  async checkKakaoTaxiPhone(branchName: string, pinHash: string, phone: string): Promise<KakaoTaxiPhoneCheck> {
    return callApi("checkKakaoTaxiPhone", { branchName, pinHash, phone });
  },

  // 지점 전입 — 직원을 지우지 않고 소속(부서)만 이 지점으로 옮긴다. 그룹은 추가만 하고 알림톡은 보내지 않는다.
  // [필수] 호출 **전에** 지점 변경 이력(kakao_taxi_branch_history)을 먼저 남길 것 —
  // 이력이 없으면 과거 이용내역까지 새 지점으로 소급 집계된다.
  // expectedFromBranch = 이력에 남긴 '이전 지점'(카카오 부서 원문). 백엔드가 실제 소속과 대조해
  // 다르면 옮기지 않는다 — 확인창 사이에 다른 지점이 먼저 데려간 경우 이력의 이전 지점이 틀린 값으로
  // 굳어 전입일 이전 이용내역이 엉뚱한 지점으로 집계되는 것을 막는다.
  async transferKakaoTaxiMember(branchName: string, pinHash: string, memberId: string, expectedFromBranch: string): Promise<KakaoTaxiTransferResult> {
    return callApi("transferKakaoTaxiMember", { branchName, pinHash, memberId, expectedFromBranch });
  },

  // [주의] 쓰기는 계정을 반드시 지정한다. 기본값을 두면 엉뚱한 계정에 삭제·수정이 나갈 수 있다.
  async registerKakaoTaxiMember(member: KakaoTaxiMemberInput, adminPinHash: string, accountKey: string): Promise<KakaoTaxiMember> {
    return callApi("registerKakaoTaxiMember", { member, adminPinHash, accountKey });
  },

  // 주의: 카카오 수정 API 는 name/department 를 안 보내면 공백으로 지워버린다 — 호출부는 기존 값을 항상 채워 보낼 것.
  async updateKakaoTaxiMember(memberId: string, member: KakaoTaxiMemberUpdateInput, adminPinHash: string, accountKey: string): Promise<KakaoTaxiMember> {
    return callApi("updateKakaoTaxiMember", { memberId, member, adminPinHash, accountKey });
  },

  async blockKakaoTaxiMember(memberIds: string[], adminPinHash: string, accountKey: string): Promise<Array<{ id: string; status_code: number; status_msg: string }>> {
    return callApi("blockKakaoTaxiMember", { memberIds, adminPinHash, accountKey });
  },

  async unblockKakaoTaxiMember(memberIds: string[], adminPinHash: string, accountKey: string): Promise<Array<{ id: string; status_code: number; status_msg: string }>> {
    return callApi("unblockKakaoTaxiMember", { memberIds, adminPinHash, accountKey });
  },

  async deleteKakaoTaxiMember(memberId: string, adminPinHash: string, accountKey: string): Promise<{ success: boolean }> {
    return callApi("deleteKakaoTaxiMember", { memberId, adminPinHash, accountKey });
  },

  async sendKakaoTaxiMemberTms(memberId: string, adminPinHash: string, accountKey: string): Promise<{ success: boolean }> {
    return callApi("sendKakaoTaxiMemberTms", { memberId, adminPinHash, accountKey });
  }
};

// ----------------------------------------------------
// 카카오T 비즈니스(법인택시) 타입 — 카카오 응답 필드명(snake_case)을 그대로 쓴다.
// 임의로 camelCase 로 바꾸면 GAS·server.ts 두 백엔드와 화면이 서로 어긋난다.
// ----------------------------------------------------
// [성능][동기화] gas/Code.gs, server.ts 와 세 곳을 같게 유지할 것.
// 카카오 원본 응답은 이 19개 외에도 payment_items(전체 페이로드의 약 19%)·arrival_time·
// waypoints·platform_fee·group_id·car_model·total_distance 등을 더 보내지만, 백엔드가
// kakaoTaxiFetchAllPages 직후 슬림화해서 이 19개만 내려준다 — 330건 기준 307KB 로
// ScriptCache 100KB(계정당) 상한을 넘겨 cache.put 이 조용히 실패했었다(캐시가 죽어
// 화면 로드마다 카카오 재조회, 5~12초). 이 타입은 실제로 오는 응답 형태와 일치해야 한다.
// [2026-07-29] use_code(이용사유) 추가 — 18개 → 19개.
export interface KakaoTaxiOrder {
  id: string;
  service_fare: number;
  toll: number;
  call_time: string; // "YYYY-MM-DD HH:mm:ss"
  departure_time: string;
  departure_point: string;
  arrival_point: string;
  member_id: string;
  member_name: string;
  member_identifier: string;
  member_department: string;
  group_name: string;
  car_number: string;
  taxi_company_name: string;
  taxi_kind: string;
  vertical_code: string; // "taxi" | "logistics"(퀵·택배) | "driver"(대리) 등
  vertical_product_name: string;
  /**
   * 이용사유 — 카카오T 앱에서 직원이 자유 입력하는 텍스트(선택 항목, 코드가 아니다).
   * 2026-07-27쯤부터 실제로 입력되기 시작했고 대부분의 과거 건은 빈 문자열이다.
   * [결측 주의] 운영 GAS(v40 이하)와 그 시점의 ScriptCache 슬림본에는 이 필드가 아예 없다 —
   * 그래서 타입도 옵셔널이다(코덱스 리뷰 P2). 화면·엑셀은 `order.use_code || ""` 로 읽을 것.
   */
  use_code?: string;
  /** 어느 카카오T 계정에서 온 건인지 — 백엔드가 주입한다. 계정 2개를 합쳐 보여주므로 필수. */
  account_key: string;
}

/** 계정 하나가 실패했을 때 — 성공한 계정 데이터는 그대로 오고, 화면이 이 목록으로 경고 배너를 띄운다 */
export interface KakaoTaxiAccountError {
  key: string;
  label: string;
  message: string;
}

export interface KakaoTaxiOrdersResult {
  month: string;
  count: number; // 수집본 건수
  orders: KakaoTaxiOrder[];
  accountErrors: KakaoTaxiAccountError[];
}

export interface KakaoTaxiGroup {
  id: string;
  name: string;
  status: string; // "enabled" | "deactivated"
  description: string;
  account_key: string;
}

export interface KakaoTaxiMember {
  id: string;
  name: string;
  department: string;
  identifier: string;
  mobile_phone: string;
  status: string; // created | connected | refused | blocked
  confirmed_at: string | null;
  group_ids: string[];
  account_key: string;
}

export interface KakaoTaxiMemberInput {
  identifier: string;
  mobile_phone: string;
  group_ids: string[];
  name?: string;
  department?: string;
}

/**
 * 지점 이용신청 사전 확인 결과(checkKakaoTaxiPhone).
 * found=false 면 그냥 등록하면 되고, true 면 sameBranch/sameAccount 로 분기한다.
 * - sameBranch: 이미 우리 지점 소속(부서 원문 기준, 별칭 포함) → 안내만
 * - sameAccount=false: 다른 카카오T 계정 소속 → 지점에서 옮길 수 없다(관리자 문의)
 * - 나머지: 전입 가능(transferKakaoTaxiMember)
 */
export type KakaoTaxiPhoneCheck =
  | { found: false }
  | {
      found: true;
      memberId: string;
      name: string;
      /** 가운데 4자리를 가린 표시용 번호(예: 010-****-1234) — 타 지점 인원의 실번호는 내려오지 않는다 */
      phone: string;
      /** 현재 소속 표기(카카오 부서 원문, 없으면 그룹명으로 보완). 둘 다 없으면 빈 문자열.
       *  화면 문구와 지점 변경 이력의 fromBranch 에 쓴다(옛 집계가 그룹명으로 잡히던 것과 이어진다). */
      department: string;
      /** 카카오 '부서' 원문 그대로(빈 문자열 가능). **전입 시 소속 대조(CAS) 전용** —
       *  보완된 department 로 대조하면 부서가 빈 인원은 항상 불일치가 되어 정상 전입까지 막힌다. */
      departmentRaw: string;
      accountKey: string;
      accountLabel: string;
      sameBranch: boolean;
      sameAccount: boolean;
    };

export interface KakaoTaxiTransferResult {
  success: boolean;
  /** 옮기기 전 소속(카카오 부서 원문). 부서가 없던 직원이면 빈 문자열 */
  fromBranch: string;
  toBranch: string;
  memberId: string;
  name: string;
}

// 직원 수정용 — 등록과 달리 identifier 는 변경 불가라 없다. 전화번호가 바뀌면 카카오가 인증 알림톡을 자동 발송한다.
export interface KakaoTaxiMemberUpdateInput {
  mobile_phone: string;
  group_ids: string[];
  name?: string;
  department?: string;
}

export interface AdminBranchSetting extends BranchSetting {
  isActive: boolean;
}
