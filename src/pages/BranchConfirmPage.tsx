// src/pages/BranchConfirmPage.tsx
import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../contexts/AuthContext";
import { gasClient } from "../api/gasClient";
import type { AdminBranchSetting, DailySettleDetail, RosterEmployee } from "../api/gasClient";
import {
  Calendar, Store, CheckCircle, ArrowRight, ArrowLeft, RefreshCw, LogOut,
  CircleDollarSign, Plus, Trash2, Clock, User, UserPlus, FileText,
  ShoppingCart, Landmark, Info, CheckCircle2, AlertTriangle, ShieldAlert, Lock,
  Users, ClipboardList, Coins, Briefcase, Pencil, Check, TrendingUp, Settings, X,
  Cloud, Database, UploadCloud, AlertCircle, Search
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import LoadingSpinner from "../components/LoadingSpinner";
import { formatNumber } from "../utils/formatNumber";
import { hashPin } from "../utils/hashPin";
import { ensureLatestAppVersion } from "../utils/appVersion";

const formatWithCommas = (val: string | number | undefined | null) => {
  if (val === undefined || val === null || val === "") return "";
  const str = String(val).replace(/[^0-9]/g, "");
  if (!str) return "";
  return Number(str).toLocaleString("ko-KR");
};

const cleanNumeric = (val: string) => {
  return val.replace(/[^0-9]/g, "");
};

const toLocalDateInputValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const toLocalMonthInputValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const addDaysToDateInputValue = (dateValue: string, days: number) => {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toLocalDateInputValue(date);
};

const addMonthsToMonthInputValue = (monthValue: string, months: number) => {
  const [year, month] = monthValue.split("-").map(Number);
  const date = new Date(year, month - 1 + months, 1);
  return toLocalMonthInputValue(date);
};

const toDateInputValue = (value: string) => {
  const match = String(value || "").match(/^(\d{4})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
};

const formatResidentNumber = (value: string) => {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 13);
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
};

const maskResidentNumber = (value?: string) => {
  const formatted = formatResidentNumber(value || "");
  const digits = formatted.replace(/\D/g, "");
  if (digits.length <= 6) return formatted || "-";
  return `${digits.slice(0, 6)}-${"*".repeat(Math.min(7, digits.length - 6))}`;
};

const toPhoneTail8 = (value: string) => {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("010-") || (digits.length >= 11 && digits.startsWith("010"))) {
    return digits.slice(3, 11);
  }
  return digits.slice(0, 8);
};
const formatMobilePhone = (tail8: string) => {
  const digits = toPhoneTail8(tail8);
  if (digits.length !== 8) return digits;
  return `010-${digits.slice(0, 4)}-${digits.slice(4)}`;
};

const residentBirthKey = (value?: string) => String(value || "").replace(/\D/g, "").slice(0, 6);

const getSameNameWarning = (name: string, residentNumber: string | undefined, employees: Array<{ name: string; residentNumber?: string; division?: string }>, division?: string) => {
  const cleanName = name.trim();
  if (!cleanName) return "";
  const incomingBirth = residentBirthKey(residentNumber);
  const sameName = employees.filter((employee) => employee.name?.trim() === cleanName && (!division || employee.division === division));
  if (sameName.length === 0) return "";
  const hasMissingResident = sameName.some((employee) => !residentBirthKey(employee.residentNumber));
  if (hasMissingResident || !incomingBirth) {
    return `${cleanName} 이름의 직원이 이미 있고 주민등록번호 앞 6자리 확인이 필요합니다. 동명이인 또는 동일인 여부를 직원현황에서 먼저 확인해주세요.`;
  }
  const hasDifferentBirth = sameName.some((employee) => residentBirthKey(employee.residentNumber) !== incomingBirth);
  if (hasDifferentBirth) {
    return `${cleanName} 이름의 동명이인이 있습니다. 주민등록번호 앞 6자리로 구분해서 확인해주세요.`;
  }
  return `${cleanName} 이름과 주민등록번호 앞 6자리가 같은 직원이 이미 등록되어 있습니다.`;
};

const splitDailyMemoMetadata = (memo?: string | null) => {
  const raw = String(memo || "");
  const parts = raw.split("\n---\nMETADATA:");
  let metadata: any = {};
  if (parts[1]) {
    try {
      metadata = JSON.parse(parts.slice(1).join("\n---\nMETADATA:").trim()) || {};
    } catch {
      metadata = {};
    }
  }
  return { visibleMemo: parts[0] || "", metadata };
};

const joinDailyMemoMetadata = (visibleMemo: string, metadata: any) => `${visibleMemo || ""}\n---\nMETADATA:\n${JSON.stringify(metadata || {})}`;

const updateDailyMetadata = async (
  recordId: string,
  updater: (metadata: any, detail: DailySettleDetail) => { metadata: any; staff?: any[]; expenses?: any[]; masterPatch?: any } | void
) => {
  const detail = await gasClient.getDailyDetail(recordId);
  const { visibleMemo, metadata } = splitDailyMemoMetadata(detail.master?.memo);
  const result = updater(metadata, detail) || { metadata };
  const nextMetadata = result.metadata || metadata;
  const masterPatch = {
    ...detail.master,
    ...(result.masterPatch || {}),
    memo: joinDailyMemoMetadata(visibleMemo, nextMetadata)
  };
  await gasClient.updateDaily(
    recordId,
    masterPatch,
    result.expenses || detail.expenses,
    result.staff || detail.staff,
    "관리자"
  );
};

const toNumberPromptValue = (value: any) => String(value ?? "").replace(/,/g, "");

const getMonthlyExpenseCategoryChipClass = (value: string) => {
  const text = String(value || "");
  if (text.includes("식재료")) return "monthly-chip-vanilla";
  if (text.includes("음료")) return "monthly-chip-alice";
  return "monthly-chip-honey";
};

const getMonthlyExpenseUsageChipClass = (value: string) => {
  const text = String(value || "");
  if (text.includes("쿠팡")) return "monthly-chip-vanilla";
  if (text.includes("네이버")) return "monthly-chip-honey";
  return "monthly-chip-alice";
};

// ----------------------------------------------------
// Constants & Types
// ----------------------------------------------------
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2).toString().padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
});

type StaffAddReason = "신규입사" | "지점이동" | "기존직원" | "기타";
type StaffAddReasonChoice = StaffAddReason | "";
type SalaryChangeStatus = "있음" | "없음";
type SalaryChangeChoice = SalaryChangeStatus | "";

interface StaffAddDraft {
  id: string;
  name: string;
  division: "정직원" | "파트타이머";
  residentNumber: string;
  rank: string;
  contractType: "4대보험" | "3.3%";
  entryDate: string;
  phoneDigits: string;
  addReason: StaffAddReasonChoice;
  fromBranch: string;
  transferDate: string;
  salaryChanged: SalaryChangeChoice;
  addReasonMemo: string;
}

const createStaffAddDraft = (): StaffAddDraft => ({
  id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  name: "",
  division: "정직원",
  residentNumber: "",
  rank: "",
  contractType: "4대보험",
  entryDate: "",
  phoneDigits: "",
  addReason: "",
  fromBranch: "",
  transferDate: "",
  salaryChanged: "",
  addReasonMemo: ""
});

const staffListStorageKey = (branchName: string) => `erp_staff_list_${branchName}`;
const staffListPendingStorageKey = (branchName: string) => `erp_staff_list_pending_${branchName}`;
const staffAddDraftStorageKey = (branchName: string) => `erp_staff_add_drafts_${branchName}`;
const pendingLocalSaveStorageKey = (storageKey: string) => `erp_pending_local_save_${storageKey}`;

const readLocalStaffList = (branchName: string): Employee[] => {
  try {
    const saved = localStorage.getItem(staffListStorageKey(branchName));
    if (!saved) return [];
    return JSON.parse(saved).filter((employee: any) => !isSampleEmployee(employee));
  } catch {
    return [];
  }
};

const readLocalStaffAddDrafts = (branchName: string): StaffAddDraft[] => {
  try {
    const saved = localStorage.getItem(staffAddDraftStorageKey(branchName));
    if (!saved) return [createStaffAddDraft()];
    const drafts = JSON.parse(saved);
    return Array.isArray(drafts) && drafts.length > 0
      ? drafts.map((draft: Partial<StaffAddDraft>) => ({
        ...createStaffAddDraft(),
        ...draft,
        addReason:
          draft.addReason === "신규입사" ||
          draft.addReason === "지점이동" ||
          draft.addReason === "기존직원" ||
          draft.addReason === "기타"
            ? draft.addReason
            : "",
        salaryChanged: draft.salaryChanged === "있음" || draft.salaryChanged === "없음" ? draft.salaryChanged : ""
      }))
      : [createStaffAddDraft()];
  } catch {
    return [createStaffAddDraft()];
  }
};

const SAMPLE_EMPLOYEE_IDS = new Set(["e1", "e2", "e3", "e4"]);
const SAMPLE_EMPLOYEE_NAMES = new Set(["김철수", "이영희", "박민수", "최정우"]);
const isSampleEmployee = (employee: any) =>
  SAMPLE_EMPLOYEE_IDS.has(String(employee?.id || "")) &&
  SAMPLE_EMPLOYEE_NAMES.has(String(employee?.name || "")) &&
  !employee?.residentNumber &&
  !employee?.entryDate;

interface StaffRow {
  division: "정직원" | "파트타이머";
  name: string;
  residentNumber?: string;
  rank?: string;
  entryDate?: string;
  phone?: string;
  addReason?: StaffAddReason;
  fromBranch?: string;
  transferDate?: string;
  salaryChanged?: SalaryChangeStatus;
  hireDate?: string;
  addReasonMemo?: string;
  standardHours: number; // 0, 9, 10, 10.5
  clockIn: string; // e.g. "09:00"
  clockOut: string; // e.g. "18:00"
  workHours: number; // calculated
  overtime: number; // calculated
  overtimeReason: string;
  officeWorkType?: "근무" | "휴무";
  officeTaskMemo?: string;
  officeWorkplace?: string;
  segmentId?: string;
}

type DailySettleValidationField =
  | "writer"
  | "cashSales"
  | "cardSales"
  | "cashBalance"
  | "cashDiffReason";

interface DailySettleValidationTargets {
  fields: Partial<Record<DailySettleValidationField, boolean>>;
  overtimeReasonRows: Record<string, boolean>;
  officeWorkRows: Record<string, boolean>;
}

const createDailySettleValidationTargets = (): DailySettleValidationTargets => ({
  fields: {},
  overtimeReasonRows: {},
  officeWorkRows: {}
});

const getDailyStaffValidationKey = (staff: StaffRow, index: number) =>
  `${staff.segmentId || ""}|${staff.residentNumber || ""}|${staff.name || ""}|${index}`;

const needsOvertimeReason = (staff: StaffRow) =>
  staff.division !== "파트타이머" && Number(staff.overtime || 0) !== 0;

interface ExpenseRow {
  classification: "식재료" | "소모품등 기타" | "부식비" | "음료" | "현금입금";
  usage: "쿠팡" | "네이버" | "인근매장" | "그외기타" | "현금입금";
  detail: string;
  amount: string;
}

type OrderCategory = "식자재" | "부식비" | "주류" | "식음료외 기타";
type OrderReportCategory = OrderCategory | "전체";
type BranchDailyTab = "dashboard" | "settle" | "orders" | "liquorInventory" | "roster" | "overtimeLog" | "annualLeave" | "partTimeLog" | "officeWorkLog";

interface OrderItem {
  id: string;
  category: OrderCategory;
  vendorName: string;
  amount: string;
  memo: string;
  orderDate: string;
}

interface InventoryProduct {
  id: string;
  classification: string;
  importer: string;
  itemName: string;
  salePrice: string;
  costPrice: string;
}

interface InventoryMovement {
  id: string;
  productId: string;
  movementDate: string;
  inbound: string;
  sold: string;
  memo: string;
}

interface Employee {
  id: string;
  name: string;
  division: "정직원" | "파트타이머";
  rank?: string;       // 사원, 대리, 과장, 차장, 실장, 부장, 이사, 대표, 부대표, 기타
  customRank?: string; // 기타 선택 시 직접 입력한 직급
  residentNumber?: string;
  contractType?: "4대보험" | "3.3%";
  entryDate?: string;
  phone?: string;
  addReason?: StaffAddReason;
  fromBranch?: string;
  transferDate?: string;
  salaryChanged?: SalaryChangeStatus;
  hireDate?: string;
  addReasonMemo?: string;
}

type EmployeeEditableField =
  | "name"
  | "residentNumber"
  | "contractType"
  | "entryDate"
  | "rank"
  | "division"
  | "addReason"
  | "phone"
  | "hireDate"
  | "transferDate"
  | "salaryChanged"
  | "addReasonMemo";

const applyEmployeeEditableField = (employee: Employee, field: EmployeeEditableField, value: string): Employee => {
  const updated: Employee = { ...employee };

  if (field === "name") updated.name = value;
  if (field === "residentNumber") updated.residentNumber = formatResidentNumber(value);
  if (field === "contractType" && (value === "4대보험" || value === "3.3%")) updated.contractType = value;
  if (field === "rank") updated.rank = value;
  if (field === "entryDate") {
    updated.entryDate = value;
    if (updated.addReason === "지점이동") updated.transferDate = value;
    if (updated.addReason === "신규입사") updated.hireDate = value;
  }
  if (field === "division" && value === "파트타이머") {
    updated.division = value;
    updated.rank = "";
    updated.contractType = "3.3%";
  }
  if (field === "division" && value === "정직원") {
    updated.division = value;
    updated.contractType = "4대보험";
  }
  if (field === "addReason") {
    const nextReason = parseStaffAddReason(value);
    updated.addReason = nextReason || undefined;
    if (!nextReason) {
      updated.hireDate = "";
      updated.transferDate = "";
      updated.phone = "";
      updated.salaryChanged = undefined;
      updated.addReasonMemo = "";
    } else if (nextReason === "신규입사") {
      updated.hireDate = updated.hireDate || updated.entryDate || "";
      updated.transferDate = "";
      updated.salaryChanged = undefined;
      updated.addReasonMemo = "";
    } else if (nextReason === "지점이동") {
      updated.transferDate = updated.transferDate || updated.entryDate || "";
      updated.hireDate = "";
      updated.phone = "";
      updated.addReasonMemo = "";
    } else if (nextReason === "기타") {
      updated.hireDate = "";
      updated.transferDate = "";
      updated.phone = "";
      updated.salaryChanged = undefined;
    } else {
      updated.hireDate = "";
      updated.transferDate = "";
      updated.phone = "";
      updated.salaryChanged = undefined;
      updated.addReasonMemo = "";
    }
  }
  if (field === "phone") updated.phone = toPhoneTail8(value);
  if (field === "hireDate") {
    updated.hireDate = value;
    updated.entryDate = value;
  }
  if (field === "transferDate") {
    updated.transferDate = value;
    updated.entryDate = value;
  }
  if (field === "salaryChanged") {
    const status = parseSalaryChangeStatus(value);
    updated.salaryChanged = status || undefined;
  }
  if (field === "addReasonMemo") updated.addReasonMemo = value;

  return updated;
};

const parseStaffAddReason = (value: string): StaffAddReason | null => {
  if (value === "신규입사" || value === "지점이동" || value === "기존직원" || value === "기타") return value;
  return null;
};

const parseStaffAddReasonChoice = (value: string): StaffAddReasonChoice => parseStaffAddReason(value) || "";

const parseSalaryChangeStatus = (value: string): SalaryChangeStatus | null => {
  if (value === "있음" || value === "없음") return value;
  return null;
};

const parseSalaryChangeChoice = (value: string): SalaryChangeChoice => parseSalaryChangeStatus(value) || "";

const getAddReasonChoiceClass = (reason?: StaffAddReasonChoice) => {
  const base = "branch-choice-select";
  if (!reason) return `${base} branch-choice-placeholder`;
  if (reason === "신규입사") return `${base} branch-choice-hire`;
  if (reason === "지점이동") return `${base} branch-choice-transfer`;
  if (reason === "기존직원") return `${base} branch-choice-existing`;
  return `${base} branch-choice-other`;
};

const getSalaryChoiceClass = (status?: SalaryChangeChoice) => {
  const base = "branch-choice-select";
  if (!status) return `${base} branch-choice-placeholder`;
  return status === "있음" ? `${base} branch-choice-salary-yes` : `${base} branch-choice-salary-no`;
};

const employeeNameKey = (value?: string) => String(value || "").trim();

const normalizeRosterEmployee = (employee: Employee | RosterEmployee): Employee | null => {
  const name = employeeNameKey(employee.name);
  if (!name || (employee.division !== "정직원" && employee.division !== "파트타이머")) return null;
  const addReason = parseStaffAddReason(String(employee.addReason || ""));
  const salaryChanged = parseSalaryChangeStatus(String(employee.salaryChanged || ""));
  return {
    ...employee,
    name,
    division: employee.division,
    addReason: addReason || undefined,
    salaryChanged: salaryChanged || undefined
  };
};

const shouldSkipDailyRosterRegistration = (staff: StaffRow) =>
  SAMPLE_EMPLOYEE_NAMES.has(employeeNameKey(staff.name)) &&
  !staff.residentNumber &&
  !staff.entryDate &&
  !staff.phone &&
  !staff.rank;

const createEmployeeFromStaffRow = (staff: StaffRow): Employee => ({
  id: `e_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
  name: employeeNameKey(staff.name),
  division: staff.division,
  residentNumber: formatResidentNumber(staff.residentNumber || ""),
  contractType: staff.division === "정직원" ? "4대보험" : "3.3%",
  entryDate: staff.entryDate || "",
  phone: staff.phone || "",
  addReason: staff.addReason,
  fromBranch: staff.fromBranch || "",
  transferDate: staff.transferDate || "",
  salaryChanged: staff.salaryChanged,
  hireDate: staff.hireDate || "",
  addReasonMemo: staff.addReasonMemo || "",
  ...(staff.division === "정직원" ? { rank: staff.rank || "" } : {})
});

export default function BranchConfirmPage() {
  const { user, selectedBranch, selectBranch, logout } = useAuthContext();
  const navigate = useNavigate();

  // ----------------------------------------------------
  // Navigation & Access Control Guard
  // ----------------------------------------------------
  useEffect(() => {
    if (!user) {
      navigate("/");
      return;
    }
  }, [user, navigate]);

  // ----------------------------------------------------
  // Tabs State
  // ----------------------------------------------------
  const [activeTab, setActiveTab] = useState<BranchDailyTab>("dashboard");

  // ----------------------------------------------------
  // Branch Selector State
  // ----------------------------------------------------
  const [branches, setBranches] = useState<any[]>([]);
  const [loadingBranches, setLoadingBranches] = useState<boolean>(false);
  const [checkingAppVersion, setCheckingAppVersion] = useState(false);

  // GAS 연결 불가 또는 시트 데이터 오류 시 사용할 로컬 지점 목록
  const LOCAL_BRANCH_FALLBACK = [
    { branchName: "대물섬 한남점", role: "branch", brand: "대물섬" },
    { branchName: "대물섬 종로점", role: "branch", brand: "대물섬" },
    { branchName: "대물섬 강남점", role: "branch", brand: "대물섬" },
    { branchName: "8번대물집", role: "branch", brand: "대물섬" },
    { branchName: "남산광어", role: "branch", brand: "남산광어" },
    { branchName: "카라멘야 신촌점", role: "branch", brand: "카라멘야" },
    { branchName: "사카바단단", role: "branch", brand: "사카바단단" },
    { branchName: "카츠스위스", role: "branch", brand: "카츠스위스" },
    { branchName: "금샤빠", role: "branch", brand: "금샤빠" },
    { branchName: "대학로고래", role: "branch", brand: "대학로고래" },
    { branchName: "마음죽", role: "branch", brand: "마음죽" },
    { branchName: "연하동", role: "branch", brand: "연하동" },
    { branchName: "헴프리스", role: "branch", brand: "헴프리스" },
    { branchName: "강남대골뼈국", role: "branch", brand: "강남대골뼈국" },
  ];

  // 1. Fetch available branches (세션 캐시 → GAS → 로컬 fallback 순서)
  const BRANCH_LIST_CACHE_KEY = "erp_branch_list_cache";

  useEffect(() => {
    if (user && !selectedBranch) {
      const fetchBranches = async () => {
        try {
          const cached = sessionStorage.getItem(BRANCH_LIST_CACHE_KEY);
          if (cached) {
            const parsed = JSON.parse(cached);
            const cachedBranches = Array.isArray(parsed) ? parsed : parsed?.branches;
            if (Array.isArray(cachedBranches) && cachedBranches.length > 0) setBranches(cachedBranches);
          }
          setLoadingBranches(true);
          let filtered: any[] = [];
          try {
            const list = await gasClient.getBranchList();
            filtered = list.filter((b: any) => b.role === "branch");
          } catch {
            // GAS 호출 실패 시 로컬 fallback 사용
          }
          if (filtered.length === 0) {
            filtered = LOCAL_BRANCH_FALLBACK;
          }
          sessionStorage.setItem(BRANCH_LIST_CACHE_KEY, JSON.stringify({ branches: filtered, savedAt: Date.now() }));
          setBranches(filtered);
        } catch (e) {
          console.error("지점 목록 로드 실패:", e);
          setBranches(LOCAL_BRANCH_FALLBACK);
        } finally {
          setLoadingBranches(false);
        }
      };
      fetchBranches();
    }
  }, [user, selectedBranch]);

  // Handle branch select action
  const handleSelectBranch = async (branch: any) => {
    if (!branch || !branch.branchName) {
      return;
    }
    setCheckingAppVersion(true);
    const latest = await ensureLatestAppVersion();
    setCheckingAppVersion(false);
    if (!latest) return;
    selectBranch(branch);
    setActiveTab("dashboard");
  };

  if (!user) return null;

  // Render branch selector if none selected
  if (!selectedBranch || !selectedBranch.branchName) {
    return (
      <div className="branch-redesign branch-select-redesign min-h-screen bg-white flex flex-col justify-between py-12 px-6">
        <div className="max-w-md mx-auto w-full space-y-6" id="branch-select-container">
          <div className="text-center space-y-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-zinc-100 text-zinc-800 text-xs font-bold rounded-full border border-zinc-200">
              인증 완료 | 회사 보안 채널
            </span>
            <h1 className="text-4xl font-extrabold text-zinc-950 tracking-tight">지점 무인 확인 포털</h1>
            <p className="text-sm text-gray-400">마감업무를 수행할 담당 지점을 목록에서 선택하여 주십시오.</p>
          </div>

          <div className="flex justify-end">
            <button
              onClick={logout}
              className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-500 rounded-xl transition-all text-xs font-bold cursor-pointer shadow-sm"
              id="btn-branch-logout-selector"
            >
              <LogOut className="w-4 h-4 text-gray-400" />
              로그아웃 (돌아가기)
            </button>
          </div>

          {loadingBranches || checkingAppVersion ? (
            <div className="py-20 flex flex-col items-center justify-center space-y-4 bg-white rounded-3xl border border-gray-100 shadow-md">
              <LoadingSpinner size="lg" />
              <p className="text-xs text-gray-400 font-semibold font-mono">{checkingAppVersion ? "최신 버전 확인 중..." : "스프레드시트 원격 지점 목록 호출 중..."}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5" id="branch-card-grid">
              {branches.filter((b) => b && b.branchName).map((b) => (
                <motion.div
                  key={b.branchName}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => void handleSelectBranch(b)}
                  className="bg-white px-5 py-4 rounded-xl border border-black cursor-pointer hover:bg-black hover:text-white transition-colors flex items-center justify-between min-h-16 group relative overflow-hidden"
                >
                  <div className="hidden" />
                  <div>
                    <span className="hidden">
                      {b.brand}
                    </span>
                    <h3 className="text-base font-bold text-black group-hover:text-white transition-colors">
                      {b.branchName}
                    </h3>
                  </div>
                  <div className="flex items-center text-[0px] font-bold text-gray-400 group-hover:text-white transition-colors">
                    정산 채널 진입 <ArrowRight className="w-3.5 h-3.5 ml-1 transition-transform group-hover:translate-x-1" />
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
        <div className="text-center text-xs text-gray-400 font-mono">
          ERP_UGD &copy; 2026. All rights reserved.
        </div>
      </div>
    );
  }

  // Loaded if selectedBranch is present
  return (
    <ActiveWorkspace branch={selectedBranch} logout={logout} selectBranch={selectBranch} activeTab={activeTab} setActiveTab={setActiveTab} isAdmin={user.role === "admin"} />
  );
}

// ----------------------------------------------------
// Active Branch Workspace Layout Component
// ----------------------------------------------------
interface WorkspaceProps {
  branch: { branchName: string; brand: string; role: string };
  logout: () => void;
  selectBranch: (branch: any) => void;
  activeTab: BranchDailyTab;
  setActiveTab: (tab: BranchDailyTab) => void;
  isAdmin: boolean;
}

function ActiveWorkspace({ branch, logout, selectBranch, activeTab, setActiveTab, isAdmin }: WorkspaceProps) {
  const navigate = useNavigate();
  const activeBranchName = branch?.branchName || "";
  const isHeadOfficeBranch = activeBranchName === "본사";

  useEffect(() => {
    if (isHeadOfficeBranch && ["orders", "liquorInventory"].includes(activeTab)) {
      setActiveTab("settle");
    }
    if (!isHeadOfficeBranch && activeTab === "officeWorkLog") {
      setActiveTab("settle");
    }
  }, [activeTab, isHeadOfficeBranch, setActiveTab]);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const triggerToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const [mainCategory, setMainCategory] = useState<"dashboard" | "daily" | "monthly" | "annualLeave" | "laborContract">("dashboard");
  const [monthlyTab, setMonthlyTab] = useState<"purchaseSales" | "partTimeSalary" | "cashExpenses" | "cashManagement" | "cardExpenses">("purchaseSales");

  const mainTabs = [
    { id: "dashboard", label: "대시보드", icon: ClipboardList },
    { id: "daily", label: "일일마감정산", icon: Calendar },
    { id: "monthly", label: "월말마감정산", icon: Coins },
    { id: "annualLeave", label: "연차관리", icon: Calendar },
    { id: "laborContract", label: "근로계약서", icon: Briefcase }
  ];

  const dailySubTabs = [
    { id: "settle", label: "일일마감정산", icon: CircleDollarSign },
    ...(!isHeadOfficeBranch ? [
      { id: "orders", label: "발주관리", icon: ShoppingCart },
      { id: "liquorInventory", label: "주류 재고", icon: Database }
    ] : []),
    { id: "roster", label: "직원현황", icon: User },
    ...(isHeadOfficeBranch
      ? [
          { id: "officeWorkLog", label: "근무내역", icon: ClipboardList },
          { id: "overtimeLog", label: "초과근무일지", icon: Clock }
        ]
      : [{ id: "overtimeLog", label: "초과근무일지", icon: Clock }]),
    { id: "partTimeLog", label: "파트타이머일지", icon: ClipboardList }
  ] as Array<{ id: BranchDailyTab; label: string; icon: typeof CircleDollarSign }>;

  const monthlySubTabs = [
    { id: "purchaseSales", label: "매입매출", icon: FileText },
    { id: "partTimeSalary", label: "파트타이머 급여대장", icon: Users },
    { id: "cashManagement", label: "현금관리", icon: CircleDollarSign },
    { id: "cashExpenses", label: "현금지출", icon: Coins },
    { id: "cardExpenses", label: "카드지출", icon: ShoppingCart }
  ] as Array<{ id: typeof monthlyTab; label: string; icon: typeof FileText }>;

  const openDailySubTab = (tabId: BranchDailyTab) => {
    if (activeTab === "liquorInventory" && tabId !== "liquorInventory" && (window as any).__ugdLiquorInventoryDirty) {
      if (!window.confirm("저장하지 않은 주류 재고 입력값이 있습니다. 저장하지 않고 이동할까요?")) return;
      (window as any).__ugdLiquorInventoryDirty = false;
    }
    setMainCategory("daily");
    setActiveTab(tabId);
  };

  // 1. Admin Settings State and Sync listening
  const [adminSettings, setAdminSettings] = useState(() => {
    const saved = localStorage.getItem("erp_admin_settings");
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return {
      logoUrl: "",
      dailyAccentColor: "#2E6DB4",
      monthlyAccentColor: "#4F46E5",
      sidebarBgDaily: "#09090b",
      sidebarBgMonthly: "#1E1B4B",
      dailyPortalText: "실시간 마감 포탈 업무중",
      monthlyReportText: "월말 마감 결산 포탈",
      monthlyReportDesc: "가맹점의 월간 매입매출 상황, 근무일지 기반 아르바이트 급여 정산, 그리고 일일 시재 및 현금·카드 지출을 한눈에 결합 정산합니다.",
      excelFilenamePattern: "yymm_지점명_월말마감_m월",
      excelHeaderColorFill: "#E2E8F0",
      moneyFormatSuffix: "원",
      salaryTaxRate: "3.3%",
      adminSecurityPasscode: "1234",
      excelIncludeSheets: {
        purchaseSales: true,
        partTimeSalary: true,
        cashExpenses: true,
        cashManagement: true,
        cardExpenses: true,
      }
    };
  });

  useEffect(() => {
    const handleUpdate = () => {
      const saved = localStorage.getItem("erp_admin_settings");
      if (saved) {
        try { setAdminSettings(JSON.parse(saved)); } catch {}
      }
    };
    window.addEventListener("admin_settings_updated", handleUpdate);
    return () => window.removeEventListener("admin_settings_updated", handleUpdate);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const syncAdminSettings = async () => {
      try {
        const remote = await gasClient.getSharedData<any>("admin_settings");
        if (cancelled) return;
        if (remote) {
          setAdminSettings(remote);
          localStorage.setItem("erp_admin_settings", JSON.stringify(remote));
          return;
        }
        const saved = localStorage.getItem("erp_admin_settings");
        if (saved) await gasClient.saveSharedData("admin_settings", JSON.parse(saved));
      } catch (error) {
        console.warn("관리자 설정 원격 동기화에 실패했습니다.", error);
      }
    };
    syncAdminSettings();
    return () => { cancelled = true; };
  }, []);

  // 2. Admin Settings Editor Modal states
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [isPasscodeVerified, setIsPasscodeVerified] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState("");
  const [adminActiveTab, setAdminActiveTab] = useState<"image" | "color" | "text" | "excel" | "format" | "security" | "branches" | "firebase">("image");

  // Branch management specific form states inside admin modal
  const [adminBranches, setAdminBranches] = useState<any[]>([]);
  const [loadingAdminBranches, setLoadingAdminBranches] = useState<boolean>(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchBrand, setNewBranchBrand] = useState("");
  const [newBranchPin, setNewBranchPin] = useState("");
  const [newBranchRole, setNewBranchRole] = useState("branch");
  const [newBranchSubmitting, setNewBranchSubmitting] = useState(false);
  const [deletingBranchName, setDeletingBranchName] = useState<string | null>(null);

  // Firebase 로그인 PIN 변경 상태 (Google Sheet PIN과 별도)
  const [currentAdminLoginPin, setCurrentAdminLoginPin] = useState("");
  const [currentBranchLoginPin, setCurrentBranchLoginPin] = useState("");
  const [newAdminLoginPin, setNewAdminLoginPin] = useState("");
  const [newBranchLoginPin, setNewBranchLoginPin] = useState("");
  const [confirmAdminLoginPin, setConfirmAdminLoginPin] = useState("");
  const [confirmBranchLoginPin, setConfirmBranchLoginPin] = useState("");
  const [changingFirebaseLoginPins, setChangingFirebaseLoginPins] = useState(false);

  // Firebase monitoring / syncing states
  const [firebaseStatus, setFirebaseStatus] = useState<{ connected: boolean; projectId: string; totalSettles: number; totalSettings: number; error?: string } | null>(null);
  const [loadingFirebase, setLoadingFirebase] = useState(false);
  const [firebaseSyncing, setFirebaseSyncing] = useState(false);
  const [firebaseRestoring, setFirebaseRestoring] = useState(false);

  const fetchFirebaseStatus = async () => {
    try {
      setLoadingFirebase(true);
      const res = await gasClient.getFirebaseStatus();
      if (res) {
        setFirebaseStatus(res);
      }
    } catch (e: any) {
      console.error("Firebase 상태 수집 장치 장애:", e);
    } finally {
      setLoadingFirebase(false);
    }
  };

  // Form states
  const [formLogoUrl, setFormLogoUrl] = useState(adminSettings.logoUrl);
  const [formDailyAccentColor, setFormDailyAccentColor] = useState(adminSettings.dailyAccentColor);
  const [formMonthlyAccentColor, setFormMonthlyAccentColor] = useState(adminSettings.monthlyAccentColor);
  const [formSidebarBgDaily, setFormSidebarBgDaily] = useState(adminSettings.sidebarBgDaily);
  const [formSidebarBgMonthly, setFormSidebarBgMonthly] = useState(adminSettings.sidebarBgMonthly);
  const [formDailyPortalText, setFormDailyPortalText] = useState(adminSettings.dailyPortalText);
  const [formMonthlyReportText, setFormMonthlyReportText] = useState(adminSettings.monthlyReportText);
  const [formMonthlyReportDesc, setFormMonthlyReportDesc] = useState(adminSettings.monthlyReportDesc);
  const [formExcelFilenamePattern, setFormExcelFilenamePattern] = useState(adminSettings.excelFilenamePattern);
  const [formMoneyFormatSuffix, setFormMoneyFormatSuffix] = useState(adminSettings.moneyFormatSuffix);
  const [formSalaryTaxRate, setFormSalaryTaxRate] = useState(adminSettings.salaryTaxRate);
  const [formAdminSecurityPasscode, setFormAdminSecurityPasscode] = useState(adminSettings.adminSecurityPasscode || "1234");
  const [formExcelSheets, setFormExcelSheets] = useState(adminSettings.excelIncludeSheets || {
    purchaseSales: true,
    partTimeSalary: true,
    cashExpenses: true,
    cashManagement: true,
    cardExpenses: true
  });

  const fetchAdminBranches = async () => {
    try {
      setLoadingAdminBranches(true);
      const list = await gasClient.getBranchListAll();
      setAdminBranches(list);
    } catch (e: any) {
      console.error("전체 지점 목록 로드 실패:", e);
      triggerToast("전체 지점 목록을 불러오지 못했습니다. 스프레드시트 업데이트 상태를 체크해보세요.", "error");
    } finally {
      setLoadingAdminBranches(false);
    }
  };

  useEffect(() => {
    if (isAdminModalOpen && isPasscodeVerified) {
      if (adminActiveTab === "branches") {
        fetchAdminBranches();
      } else if (adminActiveTab === "firebase") {
        fetchFirebaseStatus();
      }
    }
  }, [isAdminModalOpen, isPasscodeVerified, adminActiveTab]);

  // Sync form when settings loads or modal triggers
  useEffect(() => {
    if (isAdminModalOpen) {
      setFormLogoUrl(adminSettings.logoUrl);
      setFormDailyAccentColor(adminSettings.dailyAccentColor);
      setFormMonthlyAccentColor(adminSettings.monthlyAccentColor);
      setFormSidebarBgDaily(adminSettings.sidebarBgDaily);
      setFormSidebarBgMonthly(adminSettings.sidebarBgMonthly);
      setFormDailyPortalText(adminSettings.dailyPortalText);
      setFormMonthlyReportText(adminSettings.monthlyReportText);
      setFormMonthlyReportDesc(adminSettings.monthlyReportDesc);
      setFormExcelFilenamePattern(adminSettings.excelFilenamePattern);
      setFormMoneyFormatSuffix(adminSettings.moneyFormatSuffix);
      setFormSalaryTaxRate(adminSettings.salaryTaxRate);
      setFormAdminSecurityPasscode(adminSettings.adminSecurityPasscode || "1234");
      setFormExcelSheets(adminSettings.excelIncludeSheets || {
        purchaseSales: true,
        partTimeSalary: true,
        cashExpenses: true,
        cashManagement: true,
        cardExpenses: true
      });
    }
  }, [isAdminModalOpen, adminSettings]);

  const handleOpenAdmin = () => {
    setPasscode("");
    setPasscodeError("");
    setIsAdminModalOpen(true);
  };

  const handleVerifyPasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // 별도 로컬 비밀번호 대신 실제 Firebase 관리자 PIN으로 재인증합니다.
      const { loginWithAdminPin } = await import("../api/firebaseAuth");
      await loginWithAdminPin(passcode);
      setIsPasscodeVerified(true);
      setPasscodeError("");
    } catch {
      setPasscodeError("관리자 PIN이 일치하지 않습니다. 다시 시도해 주세요.");
    }
  };

  const handleSaveAdminSettings = async () => {
    const updated = {
      logoUrl: formLogoUrl,
      dailyAccentColor: formDailyAccentColor,
      monthlyAccentColor: formMonthlyAccentColor,
      sidebarBgDaily: formSidebarBgDaily,
      sidebarBgMonthly: formSidebarBgMonthly,
      dailyPortalText: formDailyPortalText,
      monthlyReportText: formMonthlyReportText,
      monthlyReportDesc: formMonthlyReportDesc,
      excelFilenamePattern: formExcelFilenamePattern,
      excelHeaderColorFill: adminSettings.excelHeaderColorFill, // preserve
      moneyFormatSuffix: formMoneyFormatSuffix,
      salaryTaxRate: formSalaryTaxRate,
      adminSecurityPasscode: formAdminSecurityPasscode,
      excelIncludeSheets: formExcelSheets,
    };
    localStorage.setItem("erp_admin_settings", JSON.stringify(updated));
    setAdminSettings(updated);
    await gasClient.saveSharedData("admin_settings", updated);

    // Dispatch custom event to trigger update in sibling subtabs
    window.dispatchEvent(new Event("admin_settings_updated"));
    setIsAdminModalOpen(false);
  };

  const isValidLoginPin = (value: string) => /^\d{4,12}$/.test(value.trim());

  const handleChangeFirebaseLoginPins = async () => {
    const wantsBranchChange = Boolean(newBranchLoginPin.trim() || confirmBranchLoginPin.trim());
    const wantsAdminChange = Boolean(newAdminLoginPin.trim() || confirmAdminLoginPin.trim());
    if (!wantsBranchChange && !wantsAdminChange) {
      triggerToast("변경할 지점 또는 관리자 PIN을 입력해 주세요.", "error");
      return;
    }
    if (!isValidLoginPin(currentAdminLoginPin)) {
      triggerToast("현재 관리자 PIN은 숫자 4~12자리여야 합니다.", "error");
      return;
    }
    if (wantsBranchChange && (!isValidLoginPin(currentBranchLoginPin) || !isValidLoginPin(newBranchLoginPin) || newBranchLoginPin !== confirmBranchLoginPin)) {
      triggerToast("지점 공통 PIN의 현재값·새 값·확인값을 숫자 4~12자리로 정확히 입력해 주세요.", "error");
      return;
    }
    if (wantsAdminChange && (!isValidLoginPin(newAdminLoginPin) || newAdminLoginPin !== confirmAdminLoginPin)) {
      triggerToast("새 관리자 PIN과 확인값을 숫자 4~12자리로 동일하게 입력해 주세요.", "error");
      return;
    }
    try {
      setChangingFirebaseLoginPins(true);
      const { changeFirebaseLoginPins } = await import("../api/firebaseAuth");
      const result = await changeFirebaseLoginPins({
        currentAdminPin: currentAdminLoginPin,
        currentBranchPin: wantsBranchChange ? currentBranchLoginPin : undefined,
        newBranchPin: wantsBranchChange ? newBranchLoginPin : undefined,
        newAdminPin: wantsAdminChange ? newAdminLoginPin : undefined
      });
      setCurrentAdminLoginPin(""); setCurrentBranchLoginPin(""); setNewAdminLoginPin("");
      setNewBranchLoginPin(""); setConfirmAdminLoginPin(""); setConfirmBranchLoginPin("");
      triggerToast(`로그인 PIN 변경 완료: 지점 ${result.changedBranches}개${result.changedAdmin ? ", 관리자 1개" : ""}. 다음 로그인부터 새 PIN을 사용합니다.`);
    } catch (error: any) {
      triggerToast(error?.message || "Firebase 로그인 PIN 변경에 실패했습니다. 기존 PIN은 유지됩니다.", "error");
    } finally {
      setChangingFirebaseLoginPins(false);
    }
  };

  return (
    <div className="branch-redesign min-h-screen bg-[#F8FAFC] flex flex-col md:flex-row">
      {/* Sidebar Layout */}
      <aside
        className={`w-full md:w-[220px] shrink-0 md:sticky md:top-0 md:h-screen flex flex-col border-b md:border-b-0 transition-all duration-300 z-40 text-zinc-150 border-zinc-850`}
        style={{
          backgroundColor: mainCategory === "monthly" ? adminSettings.sidebarBgMonthly : adminSettings.sidebarBgDaily
        }}
      >
        {/* Branch Info Top */}
        <div
          className={`p-5 border-b flex md:flex-col items-center md:items-start justify-between md:justify-start gap-4 transition-colors duration-300`}
          style={{
            backgroundColor: mainCategory === "monthly" ? adminSettings.sidebarBgMonthly : adminSettings.sidebarBgDaily,
            borderBottomColor: "#ffffff11"
          }}
        >
          <div className="min-w-0 w-full">
            <div className="min-w-0">
              <h1 className="branch-sidebar-branch-name text-base font-black tracking-tight text-white">
                {activeBranchName}
              </h1>
            </div>
          </div>

        </div>

        {/* Categories Navigation */}
        <nav className="p-3 md:p-4 flex md:flex-col gap-1.5 grow overflow-x-auto no-scrollbar md:overflow-y-auto">
          {mainTabs.map((mt) => {
            const IconComp = mt.icon;
            const active = mainCategory === mt.id;
            return (
              <div key={mt.id} className="w-full">
              <button
                onClick={() => {
                  setMainCategory(mt.id as any);
                  if (mt.id === "dashboard") {
                    setActiveTab("dashboard");
                  } else if (mt.id === "daily") {
                    setActiveTab("settle");
                  } else if (mt.id === "annualLeave") {
                    setActiveTab("annualLeave");
                  }
                }}
                className={`branch-main-nav-button ${active ? "branch-main-nav-active" : "branch-main-nav-idle"} flex items-center gap-2.5 py-2.5 px-4 font-black text-xs rounded-xl transition-all cursor-pointer whitespace-nowrap w-full text-left justify-center md:justify-start ${
                  active
                    ? "text-white"
                    : mainCategory === "monthly"
                      ? "text-indigo-300 hover:text-white hover:bg-white/5"
                      : "text-zinc-400 hover:text-white hover:bg-zinc-900/50"
                }`}
                style={active ? {
                  backgroundColor: mainCategory === "monthly" ? adminSettings.monthlyAccentColor : adminSettings.dailyAccentColor,
                  boxShadow: `0 4px 6px -1px ${mainCategory === "monthly" ? adminSettings.monthlyAccentColor : adminSettings.dailyAccentColor}33`
                } : {}}
              >
                <IconComp className="w-4 h-4" />
                <span>{mt.label}</span>
              </button>
              {active && mt.id === "daily" && (
                <div className="mt-1.5 mb-2 ml-0 md:ml-5 border-l border-white/10 pl-2 flex md:flex-col gap-2 overflow-x-auto md:overflow-visible">
                  {dailySubTabs.map((tab) => {
                    const IconSub = tab.icon;
                    const subActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => openDailySubTab(tab.id)}
                        className={`branch-sidebar-subtab ${subActive ? "branch-sidebar-subtab-active" : "branch-sidebar-subtab-idle"} flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[9px] font-black transition-all ${
                          subActive ? "bg-white/95 text-[#1A3C6E] shadow-sm" : "text-white/45 hover:bg-white/8 hover:text-white/80"
                        }`}
                      >
                        <IconSub className="w-3.5 h-3.5" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {active && mt.id === "monthly" && (
                <div className="mt-1.5 mb-2 ml-0 md:ml-5 border-l border-white/10 pl-2 flex md:flex-col gap-2 overflow-x-auto md:overflow-visible">
                  {monthlySubTabs.map((tab) => {
                    const IconSub = tab.icon;
                    const subActive = monthlyTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setMainCategory("monthly");
                          setMonthlyTab(tab.id);
                        }}
                        className={`branch-sidebar-subtab ${subActive ? "branch-sidebar-subtab-active" : "branch-sidebar-subtab-idle"} flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[9px] font-black transition-all ${
                          subActive ? "bg-white/95 text-indigo-900 shadow-sm" : "text-white/45 hover:bg-white/8 hover:text-white/80"
                        }`}
                      >
                        <IconSub className="w-3.5 h-3.5" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              </div>
            );
          })}
        </nav>


        {/* Change Branch / Signout Section Bottom */}
        <div className={`p-4 border-t hidden md:block space-y-2 transition-colors duration-300`}
          style={{
            backgroundColor: mainCategory === "monthly" ? `${adminSettings.sidebarBgMonthly}cc` : `${adminSettings.sidebarBgDaily}cc`,
            borderTopColor: "#ffffff11"
          }}
        >
          {/* 어드민 설정 버튼 */}
          <button
            onClick={handleOpenAdmin}
            className={`w-full ${isAdmin ? "flex" : "hidden"} items-center justify-center gap-2 py-2 rounded-xl border transition-all text-xs font-bold cursor-pointer bg-white/5 hover:bg-white/10 text-white/80 border-white/10`}
          >
            <Settings className="w-3.5 h-3.5" />
            어드민 설정
          </button>

          <button onClick={() => navigate("/admin")} className={`w-full ${isAdmin ? "flex" : "hidden"} items-center justify-center gap-2 py-2 rounded-xl border transition-all text-xs font-bold cursor-pointer bg-white/5 hover:bg-white/10 text-white/80 border-white/10`}>
            <Settings className="w-3.5 h-3.5" /> 관리자페이지
          </button>

          <button
            onClick={() => selectBranch(null)}
            className={`w-full ${isAdmin ? "flex" : "hidden"} items-center justify-center gap-2 py-2 rounded-xl border transition-all text-xs font-bold cursor-pointer bg-white/5 hover:bg-white/10 text-white/80 border-white/10`}
          >
            <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
            지점 변경하기
          </button>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-rose-650 hover:bg-rose-600 text-white rounded-xl transition-all text-xs font-black cursor-pointer shadow-sm border border-transparent"
          >
            <LogOut className="w-3.5 h-3.5" />
            마감 보안 로그아웃
          </button>
        </div>

        {/* Mobile quick header bar right align for logout */}
        <div className={`md:hidden flex px-4 pb-3 justify-between items-center border-t pt-2 gap-2 transition-colors duration-300 border-white/5`}
          style={{
            backgroundColor: mainCategory === "monthly" ? adminSettings.sidebarBgMonthly : adminSettings.sidebarBgDaily
          }}
        >
          <button
            onClick={handleOpenAdmin}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border bg-white/5 text-white/80 border-white/10 transition-all`}
          >
            <Settings className="w-3 h-3" /> 어드민
          </button>
          <button
            onClick={() => selectBranch(null)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border bg-white/5 text-white/80 border-white/10 transition-all`}
          >
            <RefreshCw className="w-3 h-3" /> 지점변경
          </button>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-650 text-xs font-black text-white rounded-lg border border-transparent"
          >
            <LogOut className="w-3 h-3" /> 로그아웃
          </button>
        </div>
      </aside>

      {/* Main Page Area Right */}
      <div className="grow flex flex-col min-h-screen overflow-x-hidden">
        {/* Content Panel Frame */}
        <main className="grow p-4 sm:p-6 pb-20 max-w-7xl w-full mx-auto">
          {mainCategory === "dashboard" && <BranchDashboardTab branchName={activeBranchName} />}

          {mainCategory === "daily" && (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.15 }}
                className="space-y-6"
                id={`tab-view-${activeTab}`}
              >
                {activeTab === "settle" && <DailySettleTab branchName={activeBranchName} />}
                {activeTab === "orders" && <OrderManagementTabV2 branchName={activeBranchName} />}
                {activeTab === "liquorInventory" && <LiquorInventoryTabV2 branchName={activeBranchName} />}
                {activeTab === "roster" && <RosterTab branchName={activeBranchName} />}
                {activeTab === "officeWorkLog" && <OfficeWorkLogTab branchName={activeBranchName} />}
                {activeTab === "overtimeLog" && <OvertimeLogTab branchName={activeBranchName} isAdmin={isAdmin} />}
                {activeTab === "annualLeave" && <AnnualLeaveTab branchName={activeBranchName} isAdmin={isAdmin} />}
                {activeTab === "partTimeLog" && <PartTimeLogTab branchName={activeBranchName} isAdmin={isAdmin} />}
              </motion.div>
            </AnimatePresence>
          )}

          {mainCategory === "monthly" && (
            <MonthlySettleTab
              branchName={activeBranchName}
              activeSubTab={monthlyTab}
              isAdmin={isAdmin}
            />
          )}

          {mainCategory === "annualLeave" && <AnnualLeaveTab branchName={activeBranchName} isAdmin={isAdmin} />}

          {mainCategory === "laborContract" && <LaborContractTab branchName={activeBranchName} isAdmin={isAdmin} />}
        </main>
      </div>

      {/* Admin Settings Modal Overlay */}
      <AnimatePresence>
        {isAdminModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", duration: 0.3 }}
              className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl border border-gray-100 flex flex-col max-h-[90vh]"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-zinc-50">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center text-white">
                    <Settings className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-zinc-900">ERP 관리 통합 어드민 설정</h2>
                    <p className="text-[10px] text-gray-400 font-bold">이미지, 색상, 메뉴 문구, 엑셀 및 기타 서식을 자유롭게 변경합니다</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setIsAdminModalOpen(false);
                    setIsPasscodeVerified(false);
                  }}
                  className="p-1.5 hover:bg-gray-200/60 rounded-lg text-gray-400 hover:text-gray-700 transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Passcode Protection Stage */}
              {!isPasscodeVerified ? (
                <form onSubmit={handleVerifyPasscode} className="p-8 flex flex-col items-center justify-center">
                  <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-500 mb-4 shadow-sm border border-rose-100">
                    <Lock className="w-5 h-5" />
                  </div>
                  <h3 className="text-sm font-black text-gray-800 mb-1">어드민 보안 비밀번호 인증</h3>
                  <p className="text-xs text-gray-400 font-semibold mb-6">
                    이 설정 영역은 관리자 전용입니다. 관리자 로그인 PIN을 한 번 더 입력해 주세요.
                  </p>

                  <div className="w-full max-w-xs space-y-3">
                    <input
                      type="password"
                      value={passcode}
                      onChange={(e) => {
                        setPasscode(e.target.value);
                        setPasscodeError("");
                      }}
                      placeholder="관리자 PIN 입력"
                      autoFocus
                      className="w-full px-4 py-3 border border-gray-200 focus:border-zinc-900 rounded-xl font-mono font-bold text-center tracking-widest text-lg bg-gray-50 focus:bg-white focus:outline-hidden transition"
                    />
                    {passcodeError && (
                      <p className="text-xs font-bold text-red-600 text-center">{passcodeError}</p>
                    )}
                    <button
                      type="submit"
                      className="w-full py-3 bg-zinc-950 hover:bg-zinc-800 text-white font-black text-xs rounded-xl transition cursor-pointer shadow-md"
                    >
                      어드민 접속 승인
                    </button>
                  </div>
                </form>
              ) : (
                /* Authenticated Settings Layout */
                <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-gray-100 overflow-hidden shrink grow">
                  {/* Left Sidebar Sub-tabs */}
                  <div className="w-full md:w-44 bg-gray-50/50 p-2.5 flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible">
                    {[
                      { id: "image", label: "로고 이미지 변경" },
                      { id: "color", label: "색상 테마 커스텀" },
                      { id: "text", label: "포탈 문구 수정" },
                      { id: "excel", label: "다운로드 엑셀 서식" },
                      { id: "format", label: "기타 정산 서식" },
                      { id: "branches", label: "지점 등록 & 관리" },
                      { id: "firebase", label: "Firebase 클라우드 연동" },
                      { id: "security", label: "보안 비밀번호 변경" },
                    ].map((tab) => {
                      const active = adminActiveTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setAdminActiveTab(tab.id as any)}
                          className={`text-left py-2 px-3 text-xs font-black rounded-lg transition-all shrink-0 cursor-pointer ${
                            active
                              ? "bg-zinc-900 text-white shadow-xs"
                              : "text-gray-500 hover:text-gray-800 hover:bg-gray-100"
                          }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Settings Main Board */}
                  <div className="flex-1 p-5 overflow-y-auto max-h-[50vh] md:max-h-full space-y-5">
                    {adminActiveTab === "image" && (
                      <div className="space-y-4">
                        <div>
                          <label className="text-xs font-bold text-gray-700 block mb-1">앱 메인/사이드바 브랜드 로고 이미지 URL</label>
                          <input
                            type="text"
                            value={formLogoUrl}
                            onChange={(e) => setFormLogoUrl(e.target.value)}
                            placeholder="https://example.com/logo.png"
                            className="w-full px-3 py-2 border border-gray-200 rounded-xl font-medium text-xs focus:outline-hidden focus:border-zinc-900"
                          />
                          <p className="text-[10px] text-gray-450 mt-1 leading-normal font-medium">
                            * 웹 서버 상에 이미 빌드된 이미지나 이미지 호스팅 서비스 등의 절대 경로 URL을 입력해주세요. 미지정 시 기본 가맹점 아이콘이 노출됩니다.
                          </p>
                        </div>

                        <div className="border border-gray-100 rounded-2xl p-4 bg-gray-50/50 flex flex-col items-center justify-center">
                          <span className="text-[10px] text-gray-400 font-bold mb-2">변경 사항 실시간 미리보기</span>
                          <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center overflow-hidden border border-gray-200/50 shadow-inner">
                            {formLogoUrl ? (
                              <img src={formLogoUrl} alt="Logo Preview" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                            ) : (
                              <Store className="w-6 h-6 text-gray-300" />
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {adminActiveTab === "color" && (
                      <div className="space-y-4">
                        {/* Accent colors */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs font-bold text-gray-700 block mb-1">일일 정산 핵심 테마칼라 (Accent)</label>
                            <div className="flex gap-2">
                              <input
                                type="color"
                                value={formDailyAccentColor}
                                onChange={(e) => setFormDailyAccentColor(e.target.value)}
                                className="w-10 h-8 border border-gray-200 rounded-lg outline-none cursor-pointer shrink-0"
                              />
                              <input
                                type="text"
                                value={formDailyAccentColor}
                                onChange={(e) => setFormDailyAccentColor(e.target.value)}
                                className="flex-1 px-3 py-1.5 border border-gray-200 rounded-xl font-mono text-xs text-gray-700 focus:outline-hidden focus:border-zinc-900"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="text-xs font-bold text-gray-700 block mb-1">월말 결산 핵심 테마칼라 (Accent)</label>
                            <div className="flex gap-2">
                              <input
                                type="color"
                                value={formMonthlyAccentColor}
                                onChange={(e) => setFormMonthlyAccentColor(e.target.value)}
                                className="w-10 h-8 border border-gray-200 rounded-lg outline-none cursor-pointer shrink-0"
                              />
                              <input
                                type="text"
                                value={formMonthlyAccentColor}
                                onChange={(e) => setFormMonthlyAccentColor(e.target.value)}
                                className="flex-1 px-3 py-1.5 border border-gray-200 rounded-xl font-mono text-xs text-gray-700 focus:outline-hidden focus:border-zinc-900"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Sidebar bg */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-gray-50 pt-4">
                          <div>
                            <label className="text-xs font-bold text-gray-700 block mb-1">일일 정산 사이드바 배경색</label>
                            <div className="flex gap-2">
                              <input
                                type="color"
                                value={formSidebarBgDaily}
                                onChange={(e) => setFormSidebarBgDaily(e.target.value)}
                                className="w-10 h-8 border border-gray-200 rounded-lg outline-none cursor-pointer shrink-0"
                              />
                              <input
                                type="text"
                                value={formSidebarBgDaily}
                                onChange={(e) => setFormSidebarBgDaily(e.target.value)}
                                className="flex-1 px-3 py-1.5 border border-gray-200 rounded-xl font-mono text-xs text-gray-700 focus:outline-hidden focus:border-zinc-900"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="text-xs font-bold text-gray-700 block mb-1">월말 결산 사이드바 배경색</label>
                            <div className="flex gap-2">
                              <input
                                type="color"
                                value={formSidebarBgMonthly}
                                onChange={(e) => setFormSidebarBgMonthly(e.target.value)}
                                className="w-10 h-8 border border-gray-200 rounded-lg outline-none cursor-pointer shrink-0"
                              />
                              <input
                                type="text"
                                value={formSidebarBgMonthly}
                                onChange={(e) => setFormSidebarBgMonthly(e.target.value)}
                                className="flex-1 px-3 py-1.5 border border-gray-200 rounded-xl font-mono text-xs text-gray-700 focus:outline-hidden focus:border-zinc-900"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {adminActiveTab === "text" && (
                      <div className="space-y-4">
                        <div>
                          <label className="text-xs font-bold text-gray-700 block mb-1">일일마감정산 현황표시 주 메인 문구</label>
                          <input
                            type="text"
                            value={formDailyPortalText}
                            onChange={(e) => setFormDailyPortalText(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 rounded-xl font-bold text-xs focus:outline-hidden focus:border-zinc-900"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-bold text-gray-700 block mb-1">월말결산 메인 종합 보고서 제목</label>
                          <input
                            type="text"
                            value={formMonthlyReportText}
                            onChange={(e) => setFormMonthlyReportText(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 rounded-xl font-bold text-xs focus:outline-hidden focus:border-zinc-900"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-bold text-gray-700 block mb-1">월말결산 메인 종합 보고서 세부 안내/설명 문구</label>
                          <textarea
                            value={formMonthlyReportDesc}
                            onChange={(e) => setFormMonthlyReportDesc(e.target.value)}
                            rows={3}
                            className="w-full px-3 py-2 border border-gray-200 rounded-xl font-medium text-xs focus:outline-hidden focus:border-zinc-900 resize-none leading-relaxed"
                          />
                        </div>
                      </div>
                    )}

                    {adminActiveTab === "excel" && (
                      <div className="space-y-4">
                        <div>
                          <label className="text-xs font-bold text-gray-750 block mb-2">월말마감정산 마감 다운로드 파일명 형식</label>
                          <div className="space-y-2">
                            <label className="flex items-center gap-2.5 p-2 px-3 border border-gray-150 rounded-xl bg-gray-50/50 hover:bg-gray-100/50 cursor-pointer text-xs font-semibold">
                              <input
                                type="radio"
                                name="filenamePattern"
                                checked={formExcelFilenamePattern === "yymm_지점명_월말마감_m월"}
                                onChange={() => setFormExcelFilenamePattern("yymm_지점명_월말마감_m월")}
                                className="text-zinc-900 focus:ring-zinc-900"
                              />
                              <div>
                                <span className="font-bold text-gray-800">지정 파일명 서식</span>
                                <p className="text-[10px] text-gray-400 font-bold mt-0.5">예시: 2406_강남점_월말마감_6월.xlsx</p>
                              </div>
                            </label>

                            <label className="flex items-center gap-2.5 p-2 px-3 border border-gray-150 rounded-xl bg-gray-50/50 hover:bg-gray-100/50 cursor-pointer text-xs font-semibold">
                              <input
                                type="radio"
                                name="filenamePattern"
                                checked={formExcelFilenamePattern === "original"}
                                onChange={() => setFormExcelFilenamePattern("original")}
                                className="text-zinc-900 focus:ring-zinc-900"
                              />
                              <div>
                                <span className="font-bold text-gray-800">기본 파일명 서식</span>
                                <p className="text-[10px] text-gray-400 font-bold mt-0.5">예시: 강남점_월말마감결산_2024-06.xlsx</p>
                              </div>
                            </label>
                          </div>
                        </div>

                        {/* Sheets toggles */}
                        <div className="border-t border-gray-50 pt-4">
                          <label className="text-xs font-bold text-gray-750 block mb-2">엑셀에 저장할 시트 범위 지정 (체크한 시트만 다운로드)</label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                            {[
                              { key: "purchaseSales", label: "매입매출" },
                              { key: "partTimeSalary", label: "파트타이머 급여대장" },
                              { key: "cashManagement", label: "현금관리" },
                              { key: "cashExpenses", label: "현금지출" },
                              { key: "cardExpenses", label: "카드지출" },
                            ].map((sh) => (
                              <label key={sh.key} className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg hover:bg-gray-50 text-[11px] font-bold text-gray-700 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={formExcelSheets[sh.key as keyof typeof formExcelSheets] !== false}
                                  onChange={(e) => {
                                    setFormExcelSheets({
                                      ...formExcelSheets,
                                      [sh.key]: e.target.checked
                                    });
                                  }}
                                  className="w-3.5 h-3.5 rounded text-zinc-900 focus:ring-zinc-900 border-gray-300"
                                />
                                <span>{sh.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {adminActiveTab === "format" && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs font-bold text-gray-700 block mb-1">금액 포맷팅 후순위 단위</label>
                            <input
                              type="text"
                              value={formMoneyFormatSuffix}
                              onChange={(e) => setFormMoneyFormatSuffix(e.target.value)}
                              placeholder="원"
                              className="w-full px-3 py-2 border border-gray-200 rounded-xl font-bold text-xs focus:outline-hidden focus:border-zinc-900"
                            />
                            <p className="text-[10px] text-gray-400 mt-1 font-semibold">* 통화 기호 접미사 (기본: 원)</p>
                          </div>

                          <div>
                            <label className="text-xs font-bold text-gray-700 block mb-1">파트타이머 소득세율 공제 기준</label>
                            <input
                              type="text"
                              value={formSalaryTaxRate}
                              onChange={(e) => setFormSalaryTaxRate(e.target.value)}
                              placeholder="3.3%"
                              className="w-full px-3 py-2 border border-gray-200 rounded-xl font-bold text-xs focus:outline-hidden focus:border-zinc-900"
                            />
                            <p className="text-[10px] text-gray-400 mt-1 font-semibold">* 급여정산 소득세 공제 문구 (기본: 3.3%)</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {adminActiveTab === "security" && (
                      <div className="space-y-5">
                        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                          <h4 className="text-xs font-black text-blue-950">Firebase 로그인 PIN 관리</h4>
                          <p className="mt-1 text-[10px] leading-relaxed font-semibold text-blue-800">
                            이 PIN은 모든 기기의 로그인에 즉시 적용됩니다. 지점 공통 PIN을 변경하면 등록된 모든 지점 계정이 함께 변경됩니다. 현재 로그인된 기기는 계속 사용할 수 있지만, 다음 로그인부터 새 PIN이 필요합니다.
                          </p>
                        </div>

                        <div>
                          <label className="text-xs font-bold text-gray-700 block mb-1">현재 관리자 PIN <span className="text-rose-500">*</span></label>
                          <input type="password" inputMode="numeric" value={currentAdminLoginPin} onChange={(e) => setCurrentAdminLoginPin(cleanNumeric(e.target.value))} placeholder="현재 관리자 PIN" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl font-mono text-sm focus:outline-hidden focus:border-zinc-900" />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-2xl border border-gray-150 p-4">
                          <div className="sm:col-span-2"><h5 className="text-xs font-black text-zinc-800">지점 공통 PIN 변경 <span className="text-[10px] font-semibold text-gray-400">(선택)</span></h5></div>
                          <input type="password" inputMode="numeric" value={currentBranchLoginPin} onChange={(e) => setCurrentBranchLoginPin(cleanNumeric(e.target.value))} placeholder="현재 지점 공통 PIN" className="px-3 py-2 border border-gray-200 rounded-xl font-mono text-xs focus:outline-hidden focus:border-zinc-900" />
                          <input type="password" inputMode="numeric" value={newBranchLoginPin} onChange={(e) => setNewBranchLoginPin(cleanNumeric(e.target.value))} placeholder="새 지점 공통 PIN" className="px-3 py-2 border border-gray-200 rounded-xl font-mono text-xs focus:outline-hidden focus:border-zinc-900" />
                          <input type="password" inputMode="numeric" value={confirmBranchLoginPin} onChange={(e) => setConfirmBranchLoginPin(cleanNumeric(e.target.value))} placeholder="새 지점 PIN 다시 입력" className="sm:col-start-2 px-3 py-2 border border-gray-200 rounded-xl font-mono text-xs focus:outline-hidden focus:border-zinc-900" />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-2xl border border-gray-150 p-4">
                          <div className="sm:col-span-2"><h5 className="text-xs font-black text-zinc-800">관리자 PIN 변경 <span className="text-[10px] font-semibold text-gray-400">(선택)</span></h5></div>
                          <input type="password" inputMode="numeric" value={newAdminLoginPin} onChange={(e) => setNewAdminLoginPin(cleanNumeric(e.target.value))} placeholder="새 관리자 PIN" className="px-3 py-2 border border-gray-200 rounded-xl font-mono text-xs focus:outline-hidden focus:border-zinc-900" />
                          <input type="password" inputMode="numeric" value={confirmAdminLoginPin} onChange={(e) => setConfirmAdminLoginPin(cleanNumeric(e.target.value))} placeholder="새 관리자 PIN 다시 입력" className="px-3 py-2 border border-gray-200 rounded-xl font-mono text-xs focus:outline-hidden focus:border-zinc-900" />
                        </div>

                        <button type="button" disabled={changingFirebaseLoginPins} onClick={handleChangeFirebaseLoginPins} className="w-full py-3 rounded-xl bg-zinc-950 hover:bg-zinc-800 disabled:bg-zinc-400 text-white text-xs font-black transition cursor-pointer flex items-center justify-center gap-2">
                          {changingFirebaseLoginPins && <RefreshCw className="w-4 h-4 animate-spin" />}
                          {changingFirebaseLoginPins ? "Firebase 로그인 PIN 변경 중…" : "로그인 PIN 변경 저장"}
                        </button>
                      </div>
                    )}

                    {adminActiveTab === "branches" && (
                      <div className="space-y-6" id="admin-branches-tab">
                        {/* 1. Add Branch Section */}
                        <div className="bg-gray-50 border border-gray-150 p-4 rounded-2xl space-y-3">
                          <h4 className="text-xs font-black text-zinc-800 flex items-center gap-1.5">
                            <Plus className="w-3.5 h-3.5 text-zinc-900" />
                            신규 지점 추가 등록
                          </h4>
                          <p className="text-[10px] text-gray-400 font-bold leading-normal">
                            지점명을 기입하고, 로그인 시 사용할 PIN(비밀번호) 및 브랜드 핵심 구성을 추가할 수 있습니다.
                          </p>

                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1.5">
                            <div>
                              <label className="text-[10px] font-bold text-gray-500 block mb-0.5">지점 성명 (예: 대물섬 마포점)</label>
                              <input
                                type="text"
                                placeholder="지점명 입력"
                                value={newBranchName}
                                onChange={(e) => setNewBranchName(e.target.value)}
                                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-bold focus:border-zinc-900 bg-white"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-gray-500 block mb-0.5">브랜드 키워드 (예: 대물섬)</label>
                              <input
                                type="text"
                                placeholder="브랜드명 입력"
                                value={newBranchBrand}
                                onChange={(e) => setNewBranchBrand(e.target.value)}
                                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-bold focus:border-zinc-900 bg-white"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-gray-500 block mb-0.5">지점 핀번호 (예: 1234)</label>
                              <input
                                type="text"
                                placeholder="PIN 번호 숫자"
                                value={newBranchPin}
                                onChange={(e) => setNewBranchPin(e.target.value)}
                                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-bold focus:border-zinc-900 font-mono bg-white"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-gray-500 block mb-0.5">역할 권한 등급</label>
                              <select
                                value={newBranchRole}
                                onChange={(e) => setNewBranchRole(e.target.value)}
                                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-bold focus:border-zinc-900 bg-white"
                              >
                                <option value="branch">일반 지점 (branch)</option>
                                <option value="admin">본사 관리자 (admin)</option>
                              </select>
                            </div>
                          </div>

                          <div className="flex justify-end pt-1.5">
                            <button
                              disabled={newBranchSubmitting}
                              onClick={async () => {
                                const trimName = newBranchName.trim();
                                const trimBrand = newBranchBrand.trim();
                                const trimPin = newBranchPin.trim();
                                if (!trimName || !trimBrand || !trimPin) {
                                  triggerToast("지점명, 브랜드, PIN 번호 모두를 채워넣으세요.", "error");
                                  return;
                                }
                                try {
                                  setNewBranchSubmitting(true);
                                  const phash = await hashPin(trimPin);
                                  const res = await gasClient.addBranch(trimName, phash, trimBrand, newBranchRole, trimPin);
                                  if (res && res.success !== false) {
                                    triggerToast("신규 점포가 데이터베이스에 원활히 등록되었습니다!", "success");
                                    setNewBranchName("");
                                    setNewBranchBrand("");
                                    setNewBranchPin("");
                                    fetchAdminBranches();
                                  } else {
                                    triggerToast("지점 추가에 실패했습니다. 이미 존재하거나 에러가 발생했습니다.", "error");
                                  }
                                } catch (err: any) {
                                  triggerToast(err.message || "지점 추가를 완료하지 못했습니다.", "error");
                                } finally {
                                  setNewBranchSubmitting(false);
                                }
                              }}
                              className="px-4 py-1.5 bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-400 text-white font-black text-[10px] rounded-lg transition cursor-pointer flex items-center gap-1"
                            >
                              {newBranchSubmitting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                              신규 지점 추가 실행
                            </button>
                          </div>
                        </div>

                        {/* 2. Branches List Section */}
                        <div className="space-y-4">
                          <h4 className="text-xs font-black text-zinc-800 flex items-center justify-between">
                            <span>등록 지점 데이터베이스 총람 ({adminBranches.length}개 점포)</span>
                            <button
                              onClick={fetchAdminBranches}
                              className="p-1 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-gray-800 transition"
                              title="새로고침"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${loadingAdminBranches ? "animate-spin" : ""}`} />
                            </button>
                          </h4>

                          {loadingAdminBranches ? (
                            <div className="py-12 flex flex-col justify-center items-center gap-2">
                              <LoadingSpinner size="sm" />
                              <span className="text-[10px] font-bold text-gray-400">지점 정보를 시트로부터 기인해오는 중...</span>
                            </div>
                          ) : adminBranches.length === 0 ? (
                            <div className="py-8 text-center text-xs font-bold text-gray-400 border border-dashed border-gray-200 rounded-xl">
                              등록된 지점이 존재하지 않습니다. 첫 지점을 등록해주세요.
                            </div>
                          ) : (
                            <div className="border border-gray-150 rounded-2xl overflow-hidden divide-y divide-gray-100 bg-white">
                              {adminBranches.map((b: any, index: number) => {
                                const isConfirmingDelete = deletingBranchName === b.branchName;

                                return (
                                  <div key={index} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-zinc-50/55 transition bg-white text-zinc-900">
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2">
                                        <span className="font-extrabold text-sm text-zinc-900">{b.branchName}</span>
                                        <span className="px-2 py-0.5 bg-zinc-100 rounded-md text-[9px] font-black text-zinc-500 border border-zinc-200">
                                          {b.brand}
                                        </span>
                                        {b.role === "admin" && (
                                          <span className="px-1.5 py-0.5 bg-rose-50 text-rose-500 text-[9px] font-black rounded-sm border border-rose-100">
                                            어드민 계정
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2 text-[10px] text-gray-400 font-bold">
                                        <span>등급/권한: {b.role}</span>
                                        <span>•</span>
                                        <span className={`inline-flex items-center gap-1 ${b.isActive ? "text-emerald-600" : "text-gray-450"}`}>
                                          <span className={`w-1.5 h-1.5 rounded-full ${b.isActive ? "bg-emerald-500" : "bg-neutral-300 animate-pulse"}`}></span>
                                          {b.isActive ? "가동 활성" : "폐점 / 비활성화"}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-2 self-end sm:self-center">
                                      <button
                                        onClick={() => setAdminActiveTab("security")}
                                        className="text-[10px] font-black text-gray-650 hover:text-gray-950 border border-gray-300 py-1.5 px-2.5 rounded-lg hover:bg-gray-50 bg-white transition cursor-pointer"
                                      >
                                        공통 PIN 설정
                                      </button>

                                      {/* Active/Inactive toggle */}
                                      <button
                                        onClick={async () => {
                                          try {
                                            const res = await gasClient.toggleBranchActive(b.branchName, !b.isActive);
                                            if (res && res.success !== false) {
                                              triggerToast(`${b.branchName} 지점의 영업 활성화 상태를 ${!b.isActive ? "가동 활성" : "폐점 / 비활성화"} 상태로 온전하게 제어 처리 완료하였습니다.`);
                                              fetchAdminBranches();
                                            } else {
                                              triggerToast("상태 변경 오류가 발생했습니다.", "error");
                                            }
                                          } catch (err: any) {
                                            triggerToast(err.message, "error");
                                          }
                                        }}
                                        className={`text-[10px] font-extrabold border py-1.5 px-2.5 rounded-lg transition cursor-pointer ${
                                          b.isActive
                                            ? "text-rose-600 border-rose-200 hover:bg-rose-50"
                                            : "text-emerald-650 border-emerald-250 hover:bg-emerald-50"
                                        }`}
                                      >
                                        {b.isActive ? "폐점(비활성) 처리" : "영업 복구(활성화)"}
                                      </button>

                                      {/* Absolute Delete */}
                                      {isConfirmingDelete ? (
                                        <div className="flex items-center gap-1">
                                          <button
                                            onClick={async () => {
                                              try {
                                                const res = await gasClient.deleteBranch(b.branchName);
                                                if (res && res.success !== false) {
                                                  triggerToast("해당 지점이 완벽하게 영구 삭제되었습니다.", "success");
                                                  fetchAdminBranches();
                                                } else {
                                                  triggerToast("삭제 중 오류 발생", "error");
                                                }
                                              } catch (err: any) {
                                                triggerToast(err.message, "error");
                                              } finally {
                                                setDeletingBranchName(null);
                                              }
                                            }}
                                            className="bg-rose-650 hover:bg-rose-750 text-white border-0 text-[10px] font-black py-1.5 px-2 rounded-lg cursor-pointer"
                                          >
                                            확인(영구삭제)
                                          </button>
                                          <button
                                            onClick={() => setDeletingBranchName(null)}
                                            className="bg-gray-200 hover:bg-gray-300 text-gray-650 text-[10px] font-bold py-1.5 px-2 rounded-lg cursor-pointer"
                                          >
                                            취소
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => setDeletingBranchName(b.branchName)}
                                          className="text-gray-400 hover:text-rose-600 p-1.5 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                                          title="지점 완전삭제"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Firebase Cloud Tab Content */}
                    {adminActiveTab === "firebase" && (
                      <div className="flex-1 p-6 flex flex-col min-h-0 overflow-y-auto">
                        <div className="mb-6">
                          <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
                            <Cloud className="w-5 h-5 text-blue-600" />
                            Firebase 클라우드 연동 상태 및 원격 제어
                          </h2>
                          <p className="text-xs text-gray-400 font-semibold mt-1">
                            보안 구글 클라우드 인프라 기반의 실시간 Firestore NoSQL DB를 가동하여, 실시간 마감 정정 내역 및 지점 설정을 클라우드 다중화 백업으로 보호합니다.
                          </p>
                        </div>

                        {/* Connection status banner & stats */}
                        {loadingFirebase ? (
                          <div className="py-12 flex flex-col items-center justify-center border border-dashed border-gray-200 rounded-2xl bg-gray-50/40">
                            <RefreshCw className="w-6 h-6 animate-spin text-gray-400 mb-2" />
                            <span className="text-xs font-bold text-gray-400">클라우드 상태 조회 중...</span>
                          </div>
                        ) : !firebaseStatus ? (
                          <div className="p-5 border border-amber-100 rounded-2xl bg-amber-50/20 text-center mb-6">
                            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                            <h4 className="text-xs font-black text-amber-800">클라우드 구성을 읽을 수 없습니다</h4>
                            <p className="text-[11px] text-amber-600 font-bold mt-1 max-w-md mx-auto">
                              현재 프로젝트 루트에 <code className="bg-amber-100 px-1 py-0.5 rounded text-rose-700">firebase-applet-config.json</code>이 온전히 설정되어 가동될 때까지 마감 레코드 백업은 보류 중 상태입니다.
                            </p>
                            <button
                              onClick={fetchFirebaseStatus}
                              className="mt-3 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-black rounded-lg transition"
                            >
                              다시 불러오기
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-6">
                            {/* Status Card and details */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className={`p-4 border rounded-2xl ${
                                firebaseStatus.connected
                                  ? "bg-emerald-50/10 border-emerald-100"
                                  : "bg-rose-50/10 border-rose-100"
                              } flex items-start gap-3`}>
                                <div className={`p-2 rounded-xl mt-0.5 ${
                                  firebaseStatus.connected ? "bg-emerald-50 text-emerald-500" : "bg-rose-50 text-rose-500"
                                }`}>
                                  <Cloud className="w-5 h-5" />
                                </div>
                                <div>
                                  <h4 className="text-xs font-black text-gray-900 flex items-center gap-1.5">
                                    연동 상태:
                                    {firebaseStatus.connected ? (
                                      <span className="text-emerald-600 font-extrabold flex items-center gap-1">
                                        ● 정상 가동 중
                                      </span>
                                    ) : (
                                      <span className="text-rose-600 font-extrabold flex items-center gap-1">
                                        ● 연결 안 됨
                                      </span>
                                    )}
                                  </h4>
                                  <p className="text-[10px] text-gray-400 font-semibold mt-1">
                                    {firebaseStatus.connected
                                      ? `Firestore 백업 엔진 활성화: ${firebaseStatus.projectId}`
                                      : "로컬 JSON 파일 대체 상태이며 실시간 백업이 대기 중입니다."}
                                  </p>
                                </div>
                              </div>

                              <div className="p-4 border border-gray-150 rounded-2xl bg-gray-50/40 flex items-start gap-3">
                                <div className="p-2 bg-blue-50 text-blue-500 rounded-xl mt-0.5">
                                  <Database className="w-5 h-5" />
                                </div>
                                <div className="flex-1 font-sans">
                                  <div className="flex items-center justify-between">
                                    <h4 className="text-xs font-black text-gray-900">클라우드 수집 통계</h4>
                                    <button
                                      onClick={fetchFirebaseStatus}
                                      className="p-1 hover:bg-gray-200/50 rounded text-gray-400 hover:text-gray-600 transition cursor-pointer"
                                      title="통계 새로고침"
                                    >
                                      <RefreshCw className="w-3 h-3" />
                                    </button>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2 mt-2">
                                    <div className="bg-white p-1.5 rounded-lg border border-gray-100 text-center">
                                      <div className="text-[9px] text-gray-400 font-black">백업 마감 대장</div>
                                      <div className="text-sm font-black text-gray-800">{firebaseStatus.totalSettles || 0}건</div>
                                    </div>
                                    <div className="bg-white p-1.5 rounded-lg border border-gray-100 text-center">
                                      <div className="text-[9px] text-gray-400 font-black">등록된 영업 지점</div>
                                      <div className="text-sm font-black text-gray-800">{firebaseStatus.totalSettings || 0}개</div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Connection Details List */}
                            {firebaseStatus.connected && (
                              <div className="p-4 rounded-xl border border-gray-150 bg-white/50 space-y-2 font-sans">
                                <div className="text-[10px] font-black text-gray-400 mb-1 tracking-wide uppercase">커넥션 세부 명세</div>
                                <div className="flex justify-between items-center text-[10px] border-b border-gray-100 pb-1.5">
                                  <span className="text-gray-400 font-bold">서비스 플랫폼</span>
                                  <span className="font-extrabold text-blue-600 font-mono">Google Cloud Run & Cloud Firestore</span>
                                </div>
                                <div className="flex justify-between items-center text-[10px] border-b border-gray-100 pb-1.5">
                                  <span className="text-gray-400 font-bold">프로젝트 식별자 (Project ID)</span>
                                  <span className="font-extrabold text-gray-700 font-mono">{firebaseStatus.projectId}</span>
                                </div>
                                <div className="flex justify-between items-center text-[10px]">
                                  <span className="text-gray-400 font-bold">실시간 보존 규칙</span>
                                  <span className="font-extrabold text-teal-600">제출/정정 시 실시간 Firestore 쓰기</span>
                                </div>
                              </div>
                            )}

                            {/* Control Actions Section */}
                            <div className="border border-zinc-100 rounded-2xl p-5 bg-zinc-50/50 space-y-4 font-sans">
                              <div>
                                <h3 className="text-xs font-black text-zinc-900">클라우드 싱크 및 원격 구호 통제</h3>
                                <p className="text-[10px] text-gray-400 font-semibold mt-0.5">
                                  스프레드시트 원격 관리 혹은 로컬 가상 파일에 존재하는 마감 정보를 Firestore와 정합하거나 원격으로부터 되돌릴 수 있습니다.
                                </p>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                {/* Upload Backup Tool */}
                                <div className="bg-white border border-gray-150 p-4 rounded-xl shadow-xs hover:border-blue-200 transition">
                                  <h4 className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                                    <UploadCloud className="w-4 h-4 text-blue-500" />
                                    클라우드 전체 수동 백업
                                  </h4>
                                  <p className="text-[10px] text-gray-400 leading-normal font-semibold mt-1">
                                    현재 로컬 데이터베이스의 모든 지점 및 마감 결과를 Google Firestore 클라우드로 즉각 덮어쓰기 백업합니다.
                                  </p>
                                  <button
                                    onClick={async () => {
                                      if (firebaseSyncing) return;
                                      try {
                                        setFirebaseSyncing(true);
                                        const res = await gasClient.syncToFirebase();
                                        if (res && res.success !== false) {
                                          triggerToast(res.message || "성공적으로 클라우드와 수시 백업 동조화를 이룩했습니다!", "success");
                                          fetchFirebaseStatus();
                                        } else {
                                          triggerToast(res.error || "백업 실패", "error");
                                        }
                                      } catch (err: any) {
                                        triggerToast(err.message || "연동 전송 중 치명적인 장애 발생", "error");
                                      } finally {
                                        setFirebaseSyncing(false);
                                      }
                                    }}
                                    disabled={firebaseSyncing || !firebaseStatus?.connected}
                                    className={`w-full mt-4 py-2 border rounded-lg font-black text-xs transition flex items-center justify-center gap-1.5 cursor-pointer select-none ${
                                      firebaseSyncing || !firebaseStatus?.connected
                                        ? "bg-gray-100 text-gray-400 border-gray-100 cursor-not-allowed"
                                        : "bg-blue-50 hover:bg-blue-100 text-blue-600 border-blue-200 hover:border-blue-300 shadow-xs"
                                    }`}
                                  >
                                    {firebaseSyncing ? (
                                      <>
                                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                        동기화 데이터 전송 중...
                                      </>
                                    ) : (
                                      <>
                                        <UploadCloud className="w-3.5 h-3.5" />
                                        Firestore 백업 동기화
                                      </>
                                    )}
                                  </button>
                                </div>

                                {/* Restore Tool */}
                                <div className="bg-white border border-gray-150 p-4 rounded-xl shadow-xs hover:border-rose-200 transition">
                                  <h4 className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                                    <Database className="w-4 h-4 text-rose-500" />
                                    클라우드로부터 환경 복구
                                  </h4>
                                  <p className="text-[10px] text-gray-400 leading-normal font-semibold mt-1">
                                    로컬 캐시 삭제 등으로 마감기록이 소실된 경우, Firestore 클러스터에 누적 수집된 자료 전체를 내려받아 즉시 정상화 복구합니다.
                                  </p>
                                  <button
                                    onClick={async () => {
                                      if (firebaseRestoring) return;
                                      const confirmRestore = window.confirm(
                                        "⚠️ 경고: 정말로 Firestore 버전으로 로컬 마감 대장을 완전 오버라이트 덮어쓰기 복구하시겠습니까?\n현재 로컬에서만 기록된 최근 내역이 덮어쓰기 처리될 수 있습니다."
                                      );
                                      if (!confirmRestore) return;

                                      try {
                                        setFirebaseRestoring(true);
                                        const res = await gasClient.restoreFromFirebase();
                                        if (res && res.success !== false) {
                                          triggerToast(res.message || "성공적으로 클라우드 구호 보존 완료!", "success");
                                          fetchFirebaseStatus();
                                          // 전체 지점 및 마감 리로딩
                                          fetchAdminBranches();
                                        } else {
                                          triggerToast(res.error || "복원 실패", "error");
                                        }
                                      } catch (err: any) {
                                        triggerToast(err.message || "클라우드 수하 전송 중 치명적인 장애 복원 실패", "error");
                                      } finally {
                                        setFirebaseRestoring(false);
                                      }
                                    }}
                                    disabled={firebaseRestoring || !firebaseStatus?.connected}
                                    className={`w-full mt-4 py-2 border rounded-lg font-black text-xs transition flex items-center justify-center gap-1.5 cursor-pointer select-none ${
                                      firebaseRestoring || !firebaseStatus?.connected
                                        ? "bg-gray-100 text-gray-400 border-gray-100 cursor-not-allowed"
                                        : "bg-rose-50 hover:bg-rose-100 text-rose-600 border-rose-200 hover:border-rose-300 shadow-xs"
                                    }`}
                                  >
                                    {firebaseRestoring ? (
                                      <>
                                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                        클라우드 복원 가동 중...
                                      </>
                                    ) : (
                                      <>
                                        <Database className="w-3.5 h-3.5" />
                                        원격 복토 복구 가동
                                      </>
                                    )}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Modal Footer actions (Only when authenticated) */}
              {isPasscodeVerified && (
                <div className="p-4 border-t border-gray-150 flex justify-between bg-zinc-50 shrink-0">
                  <button
                    onClick={() => {
                      // Reset to default settings
                      setFormLogoUrl("");
                      setFormDailyAccentColor("#2E6DB4");
                      setFormMonthlyAccentColor("#4F46E5");
                      setFormSidebarBgDaily("#09090b");
                      setFormSidebarBgMonthly("#1E1B4B");
                      setFormDailyPortalText("실시간 마감 포탈 업무중");
                      setFormMonthlyReportText("월말 마감 결산 포탈");
                      setFormMonthlyReportDesc("가맹점의 월간 매입매출 상황, 근무일지 기반 아르바이트 급여 정산, 그리고 일일 시재 및 현금·카드 지출을 한눈에 결합 정산합니다.");
                      setFormExcelFilenamePattern("yymm_지점명_월말마감_m월");
                      setFormMoneyFormatSuffix("원");
                      setFormSalaryTaxRate("3.3%");
                      setFormExcelSheets({
                        purchaseSales: true,
                        partTimeSalary: true,
                        cashExpenses: true,
                        cashManagement: true,
                        cardExpenses: true,
                      });
                    }}
                    className="text-[10px] font-black text-rose-600 hover:text-rose-700 hover:underline px-2 transition cursor-pointer"
                  >
                    설정 초기화
                  </button>

                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setIsAdminModalOpen(false);
                        setIsPasscodeVerified(false);
                      }}
                      className="px-4 py-2 text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition cursor-pointer"
                    >
                      취소
                    </button>
                    <button
                      onClick={handleSaveAdminSettings}
                      className="px-5 py-2 text-xs font-black text-white bg-zinc-950 hover:bg-zinc-800 rounded-xl transition cursor-pointer shadow-md"
                    >
                      저장 및 즉시 연동
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BranchDashboardTab({ branchName }: { branchName: string }) {
  const [loading, setLoading] = useState(true);
  const [notices, setNotices] = useState<any[]>([]);
  const [issues, setIssues] = useState<Array<{ type: string; message: string; level: "warn" | "danger" | "info"; names?: string[] }>>([]);
  const [expandedIssueIndexes, setExpandedIssueIndexes] = useState<Record<number, boolean>>({});
  const [noticeChecks, setNoticeChecks] = useState<Record<string, { name: string; checkedAt: string }>>({});
  const [noticeCheckNames, setNoticeCheckNames] = useState<Record<string, string>>({});
  const [pendingNoticeCheckId, setPendingNoticeCheckId] = useState<string | null>(null);
  const noticeCheckKey = `branch_notice_checks:${branchName}`;

  const getDateStr = (offsetDays = 0) => {
    const local = new Date();
    local.setDate(local.getDate() + offsetDays);
    return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [savedNotices, roster, today, savedNoticeChecks] = await Promise.all([
        gasClient.getSharedData<any[]>("admin_notices").catch(() => []),
        gasClient.getBranchOwnRoster(branchName).catch(() => []),
        gasClient.getDailyFormBootstrap(branchName, getDateStr(-1)).catch(() => null),
        gasClient.getSharedData<Record<string, { name: string; checkedAt: string }>>(noticeCheckKey).catch(() => ({}))
      ]);
      setNotices((Array.isArray(savedNotices) ? savedNotices : []).filter((notice) => !notice.targetBranch || notice.targetBranch === "전체" || notice.targetBranch === branchName));

      setNoticeChecks(savedNoticeChecks && typeof savedNoticeChecks === "object" ? savedNoticeChecks : {});

      const nextIssues: Array<{ type: string; message: string; level: "warn" | "danger" | "info"; names?: string[] }> = [];
      if (!today?.exists) {
        nextIssues.push({ type: "전일마감", message: `${getDateStr(-1)} 일일마감 미제출`, level: "info" });
      }

      const missingAddReason: string[] = [];
      const incompleteNewHires: string[] = [];
      const incompleteTransfers: string[] = [];
      const incompleteOtherReasons: string[] = [];
      (roster || []).forEach((employee: any) => {
        const name = String(employee.name || "").trim();
        if (!name) return;
        const addReason = parseStaffAddReason(String(employee.addReason || ""));
        if (!addReason) {
          missingAddReason.push(name);
          return;
        }
        const residentBirth = residentBirthKey(employee.residentNumber);
        if (addReason === "신규입사") {
          const effectiveDate = String(employee.hireDate || employee.entryDate || "");
          if (!residentBirth || !effectiveDate || toPhoneTail8(String(employee.phone || "")).length !== 8) incompleteNewHires.push(name);
        }
        if (addReason === "지점이동") {
          const effectiveDate = String(employee.transferDate || employee.entryDate || "");
          const salaryChanged = parseSalaryChangeStatus(String(employee.salaryChanged || ""));
          if (!residentBirth || !effectiveDate || !salaryChanged) incompleteTransfers.push(name);
        }
        if (addReason === "기타" && !String(employee.addReasonMemo || "").trim()) {
          incompleteOtherReasons.push(name);
        }
      });
      if (missingAddReason.length > 0) {
        nextIssues.push({ type: "직원현황", message: "추가사유 선택 필요", names: missingAddReason, level: "warn" });
      }
      if (incompleteNewHires.length > 0) {
        nextIssues.push({ type: "근로계약 후보", message: "신규입사 필수정보 확인 필요", names: incompleteNewHires, level: "warn" });
      }
      if (incompleteTransfers.length > 0) {
        nextIssues.push({ type: "근로계약 후보", message: "지점이동 필수정보 확인 필요", names: incompleteTransfers, level: "warn" });
      }
      if (incompleteOtherReasons.length > 0) {
        nextIssues.push({ type: "근로계약 후보", message: "기타 사유 내용 입력 필요", names: incompleteOtherReasons, level: "warn" });
      }

      const byName = new Map<string, any[]>();
      (roster || []).forEach((employee: any) => {
        const name = String(employee.name || "").trim();
        if (!name) return;
        byName.set(name, [...(byName.get(name) || []), employee]);
      });
      const duplicateNames: string[] = [];
      let hasMissingResidentDuplicate = false;
      byName.forEach((group, name) => {
        if (group.length < 2) return;
        const birthKeys = group.map((employee) => residentBirthKey(employee.residentNumber));
        if (birthKeys.some((key) => !key)) hasMissingResidentDuplicate = true;
        duplicateNames.push(name);
      });
      if (duplicateNames.length > 0) {
        nextIssues.push({
          type: "동명이인 확인",
          message: hasMissingResidentDuplicate
            ? "동명이인/동일인 확인 필요 (주민등록번호 미입력 포함)"
            : "동명이인/동일인 확인 필요",
          names: duplicateNames,
          level: "danger"
        });
      }

      setIssues(nextIssues);
    } finally {
      setLoading(false);
    }
  }, [branchName, noticeCheckKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const getNoticeId = (notice: any, index: number) => String(notice.id || `${notice.createdAt || "notice"}-${index}`);

  const handleConfirmNotice = async (noticeId: string) => {
    const name = String(noticeCheckNames[noticeId] || "").trim();
    if (!name) {
      window.alert("확인자 이름을 입력해주세요.");
      return;
    }
    const next = {
      ...noticeChecks,
      [noticeId]: { name, checkedAt: new Date().toISOString() }
    };
    setNoticeChecks(next);
    setPendingNoticeCheckId(null);
    setNoticeCheckNames((current) => ({ ...current, [noticeId]: "" }));
    await gasClient.saveSharedData(noticeCheckKey, next);
  };

  const handleCancelNotice = async (noticeId: string) => {
    const next = { ...noticeChecks };
    delete next[noticeId];
    setNoticeChecks(next);
    await gasClient.saveSharedData(noticeCheckKey, next);
  };

  return (
    <div className="branch-dashboard-tab space-y-6">
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-gray-900">{branchName} 대시보드</h2>
            <p className="text-xs text-gray-400 mt-1">공지사항과 지점에서 아직 확인해야 할 미결사항을 모아 보여줍니다.</p>
          </div>
          <button onClick={() => void load()} className="px-4 py-2 rounded-xl bg-[#2E6DB4] text-white text-xs font-black">새로고침</button>
        </div>
      </div>

      <section className="rounded-3xl border-2 border-rose-500 bg-gradient-to-br from-rose-50 via-white to-amber-50 shadow-sm p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#2E6DB4] px-3 py-1 text-[11px] font-black text-white shadow-sm">
              <Info className="w-3.5 h-3.5" />
              관리자 공지
            </div>
          </div>
          <span className="rounded-full bg-white/85 px-3 py-1 text-xs font-black text-rose-600 border border-rose-200">{notices.length}건</span>
        </div>
        {loading ? (
          <div className="py-10 flex justify-center"><LoadingSpinner size="md" /></div>
        ) : notices.length === 0 ? (
          <div className="rounded-2xl bg-white/75 border border-rose-100 p-5 text-sm font-bold text-gray-500 text-center">등록된 공지사항이 없습니다.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {notices.slice(0, 6).map((notice, index) => {
              const noticeId = getNoticeId(notice, index);
              const checked = noticeChecks[noticeId];
              return (
              <div key={noticeId} className={`branch-notice-card rounded-2xl border p-4 shadow-xs ${checked ? "branch-notice-checked" : "branch-notice-unchecked"}`}>
                <p className="text-sm font-black text-gray-900">{notice.title || "공지사항"}</p>
                <p className="branch-notice-body text-sm mt-2 whitespace-pre-wrap leading-relaxed font-black">{notice.body || notice.content || ""}</p>
                <p className="text-[10px] text-gray-400 mt-3 font-mono">{notice.createdAt ? new Date(notice.createdAt).toLocaleString("ko-KR") : ""}</p>
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2">
                  {checked ? (
                    <>
                      <span className="text-xs font-black text-gray-800">확인자: {checked.name}</span>
                      <button type="button" onClick={() => void handleCancelNotice(noticeId)} className="branch-notice-cancel-button rounded-xl px-3 py-2 text-xs font-black">확인취소</button>
                    </>
                  ) : pendingNoticeCheckId === noticeId ? (
                    <>
                      <input
                        value={noticeCheckNames[noticeId] || ""}
                        onChange={(event) => setNoticeCheckNames((current) => ({ ...current, [noticeId]: event.target.value }))}
                        placeholder="확인자 이름"
                        className="branch-notice-check-name rounded-xl px-3 py-2 text-xs font-bold outline-none"
                      />
                      <button type="button" onClick={() => void handleConfirmNotice(noticeId)} className="branch-notice-check-button rounded-xl px-3 py-2 text-xs font-black">확인완료</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setPendingNoticeCheckId(noticeId)} className="branch-notice-check-button rounded-xl px-3 py-2 text-xs font-black">확인</button>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6">
        <section className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-gray-800 flex items-center gap-2"><AlertCircle className="w-4 h-4 text-amber-500" /> 미결 확인사항</h3>
            <span className="text-xs font-black text-gray-400">{issues.length}건</span>
          </div>
          {loading ? (
            <div className="py-16 flex justify-center"><LoadingSpinner size="md" /></div>
          ) : issues.length === 0 ? (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-5 text-sm font-bold text-emerald-800">현재 확인 필요한 미결사항이 없습니다.</div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {issues.map((issue, index) => (
                <div key={index} className={`rounded-2xl border p-4 text-sm ${issue.level === "danger" ? "bg-rose-50 border-rose-100 text-rose-800" : issue.level === "warn" ? "bg-amber-50 border-amber-100 text-amber-800" : "bg-sky-50 border-sky-100 text-sky-800"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-black opacity-70">{issue.type}</p>
                    {issue.names && <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-black">{issue.names.length}명</span>}
                  </div>
                  <p className="font-black mt-1">{issue.message}</p>
                  {issue.names && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(expandedIssueIndexes[index] ? issue.names : issue.names.slice(0, 12)).map((name) => (
                        <span key={name} className="rounded-full bg-white/75 border border-current/10 px-2 py-1 text-[11px] font-bold">{name}</span>
                      ))}
                      {issue.names.length > 12 && !expandedIssueIndexes[index] && (
                        <button
                          type="button"
                          onClick={() => setExpandedIssueIndexes((current) => ({ ...current, [index]: true }))}
                          className="rounded-full bg-white/90 px-2 py-1 text-[11px] font-black underline"
                        >
                          +{issue.names.length - 12}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

type AdminEditField = { key: string; label: string; value: string; type?: "text" | "number" };

function AdminRecordEditModal({
  title,
  fields,
  onChange,
  onCancel,
  onSave
}: {
  title: string;
  fields: AdminEditField[];
  onChange: (key: string, value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-sm font-black text-gray-900">{title}</h3>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {fields.map((field) => (
            <label key={field.key} className="block space-y-1.5">
              <span className="text-xs font-black text-gray-500">{field.label}</span>
              <input
                type={field.type || "text"}
                value={field.value}
                onChange={(e) => onChange(field.key, e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold focus:outline-hidden focus:border-[#2E6DB4]"
              />
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 bg-gray-50 px-5 py-4">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl bg-white border border-gray-200 text-xs font-bold text-gray-600">취소</button>
          <button onClick={onSave} className="px-5 py-2 rounded-xl bg-[#2E6DB4] text-white text-xs font-black">저장</button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// TAB 1: Daily Settle Tab (일일마감정산)
// ----------------------------------------------------
function DailySettleTab({ branchName }: { branchName: string }) {
  // Helper to retrieve live employees inside "settle" tab
  const getRoster = useCallback((): Employee[] => {
    try {
      const saved = localStorage.getItem(`erp_staff_list_${branchName}`);
      if (saved) {
        const parsed: Employee[] = JSON.parse(saved);
        const cleaned = parsed.filter((employee) => !isSampleEmployee(employee));
        if (cleaned.length !== parsed.length) {
          localStorage.setItem(`erp_staff_list_${branchName}`, JSON.stringify(cleaned));
        }
        return [...cleaned].sort((a, b) => {
          if (a.division === "정직원" && b.division !== "정직원") return -1;
          if (a.division !== "정직원" && b.division === "정직원") return 1;
          return a.name.localeCompare(b.name, "ko");
        });
      }
    } catch (e) {
      console.error("Failed to parse employee roster", e);
    }
    return [];
  }, [branchName]);

  const refreshRosterCache = useCallback(async (): Promise<Employee[]> => {
    const hasPendingLocalSave = localStorage.getItem(staffListPendingStorageKey(branchName)) === "1";
    if (hasPendingLocalSave) return getRoster();

    try {
      const remoteRoster = await gasClient.getBranchOwnRoster(branchName);
      const cleaned = remoteRoster
        .filter((employee: any) => !isSampleEmployee(employee))
        .map((employee) => normalizeRosterEmployee(employee))
        .filter((employee): employee is Employee => Boolean(employee));
      localStorage.setItem(staffListStorageKey(branchName), JSON.stringify(cleaned));
      return [...cleaned].sort((a, b) => {
        if (a.division === "정직원" && b.division !== "정직원") return -1;
        if (a.division !== "정직원" && b.division === "정직원") return 1;
        return a.name.localeCompare(b.name, "ko");
      });
    } catch (error) {
      console.warn("직원현황 원격 동기화 실패, 로컬 캐시를 사용합니다.", error);
      return getRoster();
    }
  }, [branchName, getRoster]);

  const getTodayDateStr = () => {
    const local = new Date();
    const year = local.getFullYear();
    const month = String(local.getMonth() + 1).padStart(2, "0");
    const day = String(local.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const getKoreanDateWithDay = (dateStr: string) => {
    try {
      const parts = dateStr.split("-");
      if (parts.length === 3) {
        const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        const weekDays = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
        const dayName = weekDays[d.getDay()];
        return `${Number(parts[1])}월 ${Number(parts[2])}일 ${dayName}`;
      }
    } catch (e) {
      console.error(e);
    }
    return dateStr;
  };

  // State
  const isExtraHoursBranch =
    branchName.includes("연하동") ||
    branchName === "대학로고래" ||
    branchName === "카츠스위스" ||
    branchName === "오키스테이크하우스" ||
    branchName === "대골뼈국";

  const isHeadOffice = branchName === "본사";
  const defaultStandardHours = isExtraHoursBranch ? 10.5 : 10;

  const [settleDate, setSettleDate] = useState<string>(getTodayDateStr());
  // 마감 작성자는 매일 확인 후 직접 입력합니다. 이전 기기/날짜의 이름을 자동으로 채우지 않습니다.
  const [writer, setWriter] = useState<string>("");

  // Completed Dates & Mini Calendar States
  const [completedDates, setCompletedDates] = useState<string[]>([]);
  const [showStatusCalendar, setShowStatusCalendar] = useState<boolean>(false);
  const [calYear, setCalYear] = useState<number>(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState<number>(new Date().getMonth());

  // Sales
  const [cashSales, setCashSales] = useState<string>("");
  const [cardSales, setCardSales] = useState<string>("");
  const [transferSales, setTransferSales] = useState<string>("");
  const [deliverySales, setDeliverySales] = useState<string>("");

  // Cash Balance & Split Memo States
  const [cashBalance, setCashBalance] = useState<string>("");
  const [prevDayCash, setPrevDayCash] = useState<string>("0");
  const [cashDiffReason, setCashDiffReason] = useState<string>("");
  const [staffMemo, setStaffMemo] = useState<string>("");
  const [reviewMemo, setReviewMemo] = useState<string>("");
  const [otherMemo, setOtherMemo] = useState<string>("");

  // Personnel inline form inputs
  const [newStaffInputName, setNewStaffInputName] = useState<string>("");
  const [newStaffInputDivision, setNewStaffInputDivision] = useState<"정직원" | "파트타이머">("정직원");
  const [newStaffInputResidentNumber, setNewStaffInputResidentNumber] = useState("");
  const [newStaffInputRank, setNewStaffInputRank] = useState("");
  const [newStaffInputEntryDate, setNewStaffInputEntryDate] = useState("");
  const [newStaffInputPhoneDigits, setNewStaffInputPhoneDigits] = useState("");
  const [newStaffInputAddReason, setNewStaffInputAddReason] = useState<StaffAddReason>("신규입사");
  const [newStaffInputFromBranch, setNewStaffInputFromBranch] = useState("");
  const [newStaffInputTransferDate, setNewStaffInputTransferDate] = useState("");
  const [newStaffInputAddReasonMemo, setNewStaffInputAddReasonMemo] = useState("");
  const [staffAddDrafts, setStaffAddDrafts] = useState<StaffAddDraft[]>(() => [createStaffAddDraft()]);
  const [transferBranchList, setTransferBranchList] = useState<any[]>([]);
  const [loadingTransferBranches, setLoadingTransferBranches] = useState(false);

  // Expenses
  const [cashExpenses, setCashExpenses] = useState<ExpenseRow[]>([
    { classification: "식재료", usage: "쿠팡", detail: "", amount: "" }
  ]);
  const [cardExpenses, setCardExpenses] = useState<ExpenseRow[]>([
    { classification: "식재료", usage: "쿠팡", detail: "", amount: "" }
  ]);

  // Personnel List states
  const [staffRows, setStaffRows] = useState<StaffRow[]>([]);

  const [memo, setMemo] = useState<string>("");

  // App states
  const [checking, setChecking] = useState<boolean>(false);
  const [hasExistingRecord, setHasExistingRecord] = useState<boolean>(false);
  const [existingRecordId, setExistingRecordId] = useState<string | null>(null);
  const [isEditApproved, setIsEditApproved] = useState<boolean>(false);
  const [timeErrors, setTimeErrors] = useState<Record<string, string>>({});

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submissionDelayNotice, setSubmissionDelayNotice] = useState<boolean>(false);
  const [submittedResult, setSubmittedResult] = useState<any | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [validationErrors, setValidationErrors] = useState<boolean>(false);
  const [validationTargets, setValidationTargets] = useState<DailySettleValidationTargets>(() => createDailySettleValidationTargets());
  const [draftReady, setDraftReady] = useState<boolean>(false);

  const draftKey = `erp_daily_draft_${branchName}_${settleDate}`;

  // Toast trigger helper
  const triggerToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const clearValidationField = (field: DailySettleValidationField) => {
    setValidationTargets((current) => {
      if (!current.fields[field]) return current;
      return { ...current, fields: { ...current.fields, [field]: false } };
    });
  };

  const clearStaffValidationTarget = (
    bucket: "overtimeReasonRows" | "officeWorkRows",
    staff: StaffRow,
    index: number
  ) => {
    const key = getDailyStaffValidationKey(staff, index);
    setValidationTargets((current) => {
      if (!current[bucket][key]) return current;
      const nextBucket = { ...current[bucket] };
      delete nextBucket[key];
      return { ...current, [bucket]: nextBucket };
    });
  };

  const hasValidationField = (field: DailySettleValidationField) => Boolean(validationTargets.fields[field]);
  const hasOvertimeReasonTarget = (staff: StaffRow, index: number) =>
    Boolean(validationTargets.overtimeReasonRows[getDailyStaffValidationKey(staff, index)]);
  const hasOfficeWorkTarget = (staff: StaffRow, index: number) =>
    Boolean(validationTargets.officeWorkRows[getDailyStaffValidationKey(staff, index)]);

  const restoreDraftIfAvailable = useCallback((options?: { preservePrevDayCash?: string }) => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (!saved) return false;
      const draft = JSON.parse(saved);
      setWriter(draft.writer || "");
      setCashSales(draft.cashSales || "");
      setCardSales(draft.cardSales || "");
      setTransferSales(draft.transferSales || "");
      setDeliverySales(draft.deliverySales || "");
      setCashBalance(draft.cashBalance || "");
      setPrevDayCash(options?.preservePrevDayCash ?? draft.prevDayCash ?? "0");
      setCashDiffReason(draft.cashDiffReason || "");
      setStaffMemo(draft.staffMemo || "");
      setReviewMemo(draft.reviewMemo || "");
      setOtherMemo(draft.otherMemo || "");
      setCashExpenses(Array.isArray(draft.cashExpenses) ? draft.cashExpenses : [{ classification: "식재료", usage: "쿠팡", detail: "", amount: "" }]);
      setCardExpenses(Array.isArray(draft.cardExpenses) ? draft.cardExpenses : [{ classification: "식재료", usage: "쿠팡", detail: "", amount: "" }]);
      setStaffRows(Array.isArray(draft.staffRows) ? draft.staffRows : []);
      return true;
    } catch (error) {
      console.warn("일일마감 임시저장 복원 실패:", error);
      return false;
    }
  }, [draftKey]);

  useEffect(() => {
    let cancelled = false;
    const loadTransferBranches = async () => {
      try {
        setLoadingTransferBranches(true);
        let list = await gasClient.getBranchList();
        if (!Array.isArray(list) || list.length === 0) {
          const cached = sessionStorage.getItem("erp_branch_list_cache");
          const parsed = cached ? JSON.parse(cached) : null;
          list = Array.isArray(parsed) ? parsed : parsed?.branches || [];
        }
        if (cancelled) return;
        const filtered = list.filter((b: any) => b.role === "branch" && b.branchName !== branchName);
        setTransferBranchList(filtered);
        setNewStaffInputFromBranch((current) => current || filtered[0]?.branchName || "");
      } catch (error) {
        console.warn("이동 전 지점 목록 로드 실패:", error);
        if (!cancelled) {
          try {
            const cached = sessionStorage.getItem("erp_branch_list_cache");
            const parsed = cached ? JSON.parse(cached) : null;
            const cachedBranches = (Array.isArray(parsed) ? parsed : parsed?.branches || [])
              .filter((b: any) => b.role === "branch" && b.branchName !== branchName);
            setTransferBranchList(cachedBranches);
            setNewStaffInputFromBranch((current) => current || cachedBranches[0]?.branchName || "");
          } catch {
            setTransferBranchList([]);
          }
        }
      } finally {
        if (!cancelled) setLoadingTransferBranches(false);
      }
    };
    loadTransferBranches();
    return () => { cancelled = true; };
  }, [branchName]);

  // Google Sheets/GAS가 시트 잠금 또는 콜드 스타트로 지연될 수 있습니다.
  // 제출은 계속 한 번만 유지하고, 30초 뒤에는 오류가 아닌 진행 상태를 안내합니다.
  useEffect(() => {
    if (!submitting) {
      setSubmissionDelayNotice(false);
      return;
    }

    const delayTimer = window.setTimeout(() => setSubmissionDelayNotice(true), 30000);
    return () => window.clearTimeout(delayTimer);
  }, [submitting]);

  // Prepopulate standard worker checklist
  const mapEmployeeToStaffRow = useCallback((emp: Employee): StaffRow => ({
    division: emp.division,
    name: emp.name,
    residentNumber: emp.residentNumber || "",
    rank: emp.rank || "",
    entryDate: emp.entryDate || "",
    phone: emp.phone || "",
    addReason: emp.addReason,
    fromBranch: emp.fromBranch || "",
    transferDate: emp.transferDate || "",
    salaryChanged: emp.salaryChanged,
    hireDate: emp.hireDate || "",
    addReasonMemo: emp.addReasonMemo || "",
    standardHours: emp.division === "정직원" ? defaultStandardHours : 0,
    clockIn: "",
    clockOut: "",
    workHours: 0,
    overtime: 0,
    overtimeReason: "",
    officeWorkType: "근무",
    officeTaskMemo: "",
    officeWorkplace: branchName
  }), [branchName, defaultStandardHours]);

  const hasMeaningfulTimeInput = (value?: string) => Boolean(value && value !== "00:00");

  const hasStaffWorkInput = (row: StaffRow) =>
    Boolean(
      hasMeaningfulTimeInput(row.clockIn) ||
      hasMeaningfulTimeInput(row.clockOut) ||
      Number(row.workHours || 0) > 0 ||
      Number(row.overtime || 0) > 0 ||
      String(row.overtimeReason || "").trim() ||
      String(row.officeTaskMemo || "").trim()
    );

  const reconcileDraftStaffRows = useCallback((rows: StaffRow[]) => {
    const roster = getRoster();
    const rosterByName = new Map<string, Employee>();
    roster.forEach((emp) => rosterByName.set(emp.name, emp));
    const rosterKeys = new Set(roster.map((emp) => `${emp.name}|${emp.residentNumber || ""}`));
    const rosterNames = new Set(roster.map((emp) => emp.name));
    const usedKeys = new Set<string>();

    const keptRows = rows
      .filter((row) => {
        const key = `${row.name}|${row.residentNumber || ""}`;
        const inRoster = rosterKeys.has(key) || rosterNames.has(row.name);
        if (inRoster) {
          usedKeys.add(key);
          usedKeys.add(`${row.name}|`);
          return true;
        }
        return hasStaffWorkInput(row);
      })
      .map((row) => {
        // 직원현황에서 수정된 최신 정보(주민번호·직급·입사일·구분 등)를 반영합니다.
        // 근무 입력값(출퇴근시간·초과근무·메모)은 그대로 보존합니다.
        const emp = rosterByName.get(row.name);
        if (!emp) return row;
        return {
          ...row,
          division: emp.division,
          residentNumber: emp.residentNumber || "",
          rank: emp.rank || "",
          entryDate: emp.entryDate || "",
          phone: emp.phone || "",
          addReason: emp.addReason,
          fromBranch: emp.fromBranch || "",
          transferDate: emp.transferDate || "",
          salaryChanged: emp.salaryChanged,
          hireDate: emp.hireDate || "",
          addReasonMemo: emp.addReasonMemo || "",
          standardHours: emp.division === "정직원" ? defaultStandardHours : 0
        };
      });

    const nextRows = [...keptRows];
    roster.forEach((emp) => {
      const key = `${emp.name}|${emp.residentNumber || ""}`;
      const exists = nextRows.some((row) =>
        `${row.name}|${row.residentNumber || ""}` === key ||
        (!emp.residentNumber && row.name === emp.name) ||
        (emp.residentNumber && row.name === emp.name && !row.residentNumber)
      );
      if (!exists && !usedKeys.has(key)) {
        nextRows.push(mapEmployeeToStaffRow(emp));
      }
    });

    return isHeadOffice ? distributeHeadOfficeOvertime(nextRows) : nextRows;
  }, [getRoster, isHeadOffice, mapEmployeeToStaffRow, defaultStandardHours]);

  const initRosterInForm = useCallback((freshRoster?: Employee[]) => {
    const list = freshRoster || getRoster();
    const mappedRows: StaffRow[] = list.map(mapEmployeeToStaffRow);
    setStaffRows(mappedRows);
  }, [getRoster, mapEmployeeToStaffRow]);

  const updateStaffAddDraft = (id: string, patch: Partial<StaffAddDraft>) => {
    setStaffAddDrafts((current) => current.map((draft) => {
      if (draft.id !== id) return draft;
      const next = { ...draft, ...patch };
      if (patch.division === "정직원") next.contractType = "4대보험";
      if (patch.division === "파트타이머") {
        next.contractType = "3.3%";
        next.rank = "";
      }
      if (patch.addReason === "") {
        next.entryDate = "";
        next.phoneDigits = "";
        next.fromBranch = "";
        next.transferDate = "";
        next.salaryChanged = "";
        next.addReasonMemo = "";
      }
      if (patch.addReason === "신규입사") {
        next.transferDate = "";
        next.salaryChanged = "";
        next.addReasonMemo = "";
      }
      if (patch.addReason === "지점이동") {
        next.entryDate = "";
        next.phoneDigits = "";
        next.addReasonMemo = "";
        next.salaryChanged = next.salaryChanged || "";
      }
      if (patch.addReason === "기존직원") {
        next.entryDate = "";
        next.phoneDigits = "";
        next.fromBranch = "";
        next.transferDate = "";
        next.salaryChanged = "";
        next.addReasonMemo = "";
      }
      if (patch.addReason === "기타") {
        next.entryDate = "";
        next.phoneDigits = "";
        next.fromBranch = "";
        next.transferDate = "";
        next.salaryChanged = "";
      }
      return next;
    }));
  };

  const registerStaffAddDrafts = () => {
    const filledDrafts = staffAddDrafts.filter((draft) => draft.name.trim());
    if (filledDrafts.length === 0) {
      triggerToast("추가할 근무자 이름을 입력해주세요.", "error");
      return;
    }

    const nextRows: StaffRow[] = [];

    for (const draft of filledDrafts) {
      const name = draft.name.trim();
      if (!draft.addReason) {
        triggerToast(`${name} 님의 추가사유를 선택해 주세요.`, "error");
        return;
      }

      if (
        staffRows.some((staff) => staff.name === name && staff.division === draft.division) ||
        nextRows.some((row) => row.name === name && row.division === draft.division)
      ) {
        triggerToast(`${name} 님은 이미 ${draft.division} 정산 표에 등록된 이름입니다.`, "error");
        return;
      }

      nextRows.push({
        division: draft.division,
        name,
        residentNumber: "",
        rank: "",
        entryDate: "",
        phone: "",
        addReason: draft.addReason,
        standardHours: draft.division === "정직원" ? defaultStandardHours : 0,
        clockIn: "",
        clockOut: "",
        workHours: 0,
        overtime: 0,
        overtimeReason: "",
        officeWorkType: "근무",
        officeTaskMemo: "",
        officeWorkplace: branchName
      });
    }

    setStaffRows((prev) => [...prev, ...nextRows]);
    setStaffAddDrafts([createStaffAddDraft()]);
    triggerToast(`${nextRows.length}명 추가되었습니다 (마감 제출 시 직원현황 자동 등록)`);
  };

  // Refresh completed dates from branch history
  const refreshCompletedDates = useCallback(async () => {
    try {
      const history = await gasClient.getBranchHistory(branchName);
      const dates = history.map(item => item.settleDate);
      setCompletedDates(dates);
    } catch (err) {
      console.error("Failed to load completed dates", err);
    }
  }, [branchName]);

  // Load completed dates on mount & branchName change
  useEffect(() => {
    refreshCompletedDates();
  }, [branchName, refreshCompletedDates]);

  // Sync calendar view to selected date changes
  useEffect(() => {
    if (settleDate) {
      const parts = settleDate.split("-");
      if (parts.length === 3) {
        setCalYear(Number(parts[0]));
        setCalMonth(Number(parts[1]) - 1);
      }
    }
  }, [settleDate]);

  // ----------------------------------------------------
  // Dynamic Load & Duplicate check on Date Change
  // ----------------------------------------------------
  useEffect(() => {
    const checkDuplicateAndLoad = async () => {
      try {
        setChecking(true);
        setDraftReady(false);
        const res = await gasClient.getDailyFormBootstrap(branchName, settleDate);
        const prevCashVal = res.previousCash || "0";

        if (res.exists && res.recordId) {
          setHasExistingRecord(true);
          setExistingRecordId(res.recordId);
          setIsEditApproved(false); // Reset to false and require approval warning
          // Load details
          const detail = await gasClient.getDailyDetail(res.recordId);

          setCashSales(String(detail.master.cashSales || "0"));
          setCardSales(String(detail.master.cardSales || "0"));
          setTransferSales(String(detail.master.transferSales || "0"));
          setDeliverySales(String(detail.master.deliverySales || "0"));
          // 새 마감에서는 작성자를 비워 두되, 기존 마감을 수정할 때는
          // 당시 작성자를 반드시 되살립니다.
          // 과거 마감에는 작성자가 숫자로 저장된 경우가 있습니다.
          // 입력값과 제출 검증에서 trim()을 안전하게 사용할 수 있도록 항상 문자열로 정규화합니다.
          setWriter(String(detail.master.submittedBy ?? ""));

          // Metadata extraction from memo
          const divider = "\n---\nMETADATA:";
          const memoRaw = detail.master.memo || "";
          const parts = memoRaw.split(divider);
          const visibleMemo = parts[0]?.trim() || "";
          setMemo(visibleMemo);

          let metadataParsed: any = null;
          if (parts[1]) {
            try {
              metadataParsed = JSON.parse(parts[1].trim());
            } catch (e) {
              console.error("Memo metadata json parse error", e);
            }
          }

          if (metadataParsed) {
            // Restore from perfect JSON metadata
            setStaffRows(isHeadOffice ? distributeHeadOfficeOvertime(metadataParsed.staffRows || []) : metadataParsed.staffRows || []);
            setCashExpenses(metadataParsed.cashExpenses || []);
            setCardExpenses(metadataParsed.cardExpenses || []);
            setCashBalance(metadataParsed.cashBalance !== undefined ? String(metadataParsed.cashBalance) : "");
            setPrevDayCash(prevCashVal);
            setCashDiffReason(metadataParsed.cashDiffReason || "");
            setStaffMemo(metadataParsed.staffMemo || "");
            setReviewMemo(metadataParsed.reviewMemo || "");
            setOtherMemo(metadataParsed.otherMemo || "");
          } else {
            setPrevDayCash(prevCashVal);
            setCashDiffReason("");
            // Safe fallback parsing if metadata wasn't available
            const savedCashExps = detail.expenses
              .filter(e => e.expenseType === "현금지출")
              .map(e => {
                const itemParts = e.itemName.split(" | ");
                return {
                  classification: (itemParts[0] || "식재료") as any,
                  usage: (itemParts[1] || "쿠팡") as any,
                  detail: itemParts[2] || itemParts[0] || "",
                  amount: String(e.amount)
                };
              });
            const savedCardExps = detail.expenses
              .filter(e => e.expenseType === "카드지출")
              .map(e => {
                const itemParts = e.itemName.split(" | ");
                return {
                   classification: (itemParts[0] || "식재료") as any,
                   usage: (itemParts[1] || "쿠팡") as any,
                   detail: itemParts[2] || itemParts[0] || "",
                   amount: String(e.amount)
                };
              });

            setCashExpenses(savedCashExps.length > 0 ? savedCashExps : [{ classification: "식재료", usage: "쿠팡", detail: "", amount: "" }]);
            setCardExpenses(savedCardExps.length > 0 ? savedCardExps : [{ classification: "식재료", usage: "쿠팡", detail: "", amount: "" }]);

             // Map staff from fallback
             const roster = getRoster();
             const mapStaff: StaffRow[] = roster.map((emp) => {
               const matchedS = detail.staff.find((s: any) => s.staffName === emp.name);
               return {
                 division: emp.division,
                 name: emp.name,
                 residentNumber: emp.residentNumber || "",
                 rank: emp.rank || "",
                 entryDate: emp.entryDate || "",
                 phone: emp.phone || "",
                 addReason: emp.addReason,
                 fromBranch: emp.fromBranch || "",
                 transferDate: emp.transferDate || "",
                 salaryChanged: emp.salaryChanged,
                 hireDate: emp.hireDate || "",
                 addReasonMemo: emp.addReasonMemo || "",
                 standardHours: emp.division === "정직원" ? defaultStandardHours : 0,
                 clockIn: matchedS && matchedS.workHours > 0 ? "09:00" : "00:00",
                 clockOut: matchedS && matchedS.workHours > 0 ? (matchedS.workHours === 9 ? "18:00" : "19:00") : "00:00",
                 workHours: matchedS ? matchedS.workHours : 0,
                 overtime: matchedS && emp.division === "정직원" ? (matchedS.workHours - defaultStandardHours) : 0,
                 overtimeReason: "",
                 officeWorkType: matchedS && matchedS.workHours > 0 ? "근무" : "휴무",
                 officeTaskMemo: "",
                 officeWorkplace: branchName
               };
             });
             setStaffRows(mapStaff);

            // Legacy raw memo parser
            setCashBalance("");
            const extractSection = (text: string, title: string): string => {
              const regex = new RegExp(`\\[${title}\\]\\s*([\\s\\S]*?)(?=\\s*\\[|$)`);
              const match = text.match(regex);
              return match ? match[1].trim() : "";
            };
            const extractedStaffMemo = extractSection(visibleMemo, "직원 특이사항");
            const extractedReviewMemo = extractSection(visibleMemo, "리뷰 특이사항");
            if (extractedStaffMemo || extractedReviewMemo) {
              setStaffMemo(extractedStaffMemo);
              setReviewMemo(extractedReviewMemo);
              setOtherMemo(extractSection(visibleMemo, "기타 특이사항"));
            } else {
              setStaffMemo("");
              setReviewMemo("");
              setOtherMemo(visibleMemo);
            }
          }
        } else {
          // Fresh form setup for no existing record
          setHasExistingRecord(false);
          setExistingRecordId(null);
          setIsEditApproved(true); // Automatically approved since it is fresh!
          setCashSales("");
          setCardSales("");
          setTransferSales("");
          setDeliverySales("");
          setCashExpenses([{ classification: "식재료", usage: "쿠팡", detail: "", amount: "" }]);
          setCardExpenses([{ classification: "식재료", usage: "쿠팡", detail: "", amount: "" }]);
          setMemo("");
          setCashBalance("");
          setPrevDayCash(prevCashVal);
          setCashDiffReason("");
          setWriter("");
          setStaffMemo("");
          setReviewMemo("");
          setOtherMemo("");
          const freshRoster = await refreshRosterCache();
          initRosterInForm(freshRoster);
          setTimeout(() => {
            if (restoreDraftIfAvailable({ preservePrevDayCash: prevCashVal })) {
              setStaffRows((current) => reconcileDraftStaffRows(current));
            }
          }, 0);
        }
      } catch (err: any) {
        console.error("Duplicate checking error:", err);
        triggerToast("이전 데이터를 검사하는 도중 문제가 생겼습니다.", "error");
        // Fresh start on fail
        setHasExistingRecord(false);
        setExistingRecordId(null);
        setIsEditApproved(true);
        setCashBalance("");
        setPrevDayCash("0");
        setCashDiffReason("");
        setStaffMemo("");
        setReviewMemo("");
        setOtherMemo("");
        const freshRoster = await refreshRosterCache();
        initRosterInForm(freshRoster);
        setTimeout(() => {
          if (restoreDraftIfAvailable({ preservePrevDayCash: "0" })) {
            setStaffRows((current) => reconcileDraftStaffRows(current));
          }
        }, 0);
      } finally {
        setChecking(false);
        setDraftReady(true);
      }
    };

    checkDuplicateAndLoad();
  }, [settleDate, branchName, getRoster, initRosterInForm, reconcileDraftStaffRows, restoreDraftIfAvailable, refreshRosterCache]);

  // Real-time Sum calculations
  const totalSales = useMemo(() => {
    return (Number(cashSales) || 0) + (Number(cardSales) || 0) + (Number(transferSales) || 0) + (Number(deliverySales) || 0);
  }, [cashSales, cardSales, transferSales, deliverySales]);

  const cashExpensesSum = useMemo(() => {
    return cashExpenses.reduce((acc, exp) => acc + (Number(exp.amount) || 0), 0);
  }, [cashExpenses]);

  const cardExpensesSum = useMemo(() => {
    return cardExpenses.reduce((acc, exp) => acc + (Number(exp.amount) || 0), 0);
  }, [cardExpenses]);

  useEffect(() => {
    if (!draftReady || checking || submittedResult) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({
          writer,
          cashSales,
          cardSales,
          transferSales,
          deliverySales,
          cashBalance,
          prevDayCash,
          cashDiffReason,
          staffMemo,
          reviewMemo,
          otherMemo,
          cashExpenses,
          cardExpenses,
          staffRows,
          savedAt: new Date().toISOString()
        }));
      } catch (error) {
        console.warn("일일마감 임시저장 실패:", error);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draftReady, checking, submittedResult, draftKey, writer, cashSales, cardSales, transferSales, deliverySales, cashBalance, prevDayCash, cashDiffReason, staffMemo, reviewMemo, otherMemo, cashExpenses, cardExpenses, staffRows]);

  // Core Math - Decimal Time Parsing
  const parseTimeToDecimal = (timeStr: string): number => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(":").map(Number);
    return h + ((m || 0) / 60);
  };

  const normalizeTimeInput = (index: number, field: "clockIn" | "clockOut", value: string) => {
    const key = `${index}-${field}`;
    const trimmed = value.trim().replace(/[;；]/g, ":");
    if (!trimmed) {
      setTimeErrors((current) => { const next = { ...current }; delete next[key]; return next; });
      executeStaffCalculation(index, { [field]: "" });
      return;
    }
    let hourText = "";
    let minuteText = "00";
    if (/^\d{1,2}$/.test(trimmed)) {
      hourText = trimmed;
    } else if (/^\d{3,4}$/.test(trimmed)) {
      hourText = trimmed.slice(0, -2);
      minuteText = trimmed.slice(-2);
    } else {
      const colonMatch = trimmed.match(/^(\d{1,2}):(\d{0,2})$/);
      if (!colonMatch) {
        setTimeErrors((current) => ({ ...current, [key]: "시간 형식을 확인해 주세요. 예: 13 또는 13:30" }));
        return;
      }
      hourText = colonMatch[1];
      minuteText = colonMatch[2] ? (colonMatch[2].length === 1 ? colonMatch[2].padEnd(2, "0") : colonMatch[2]) : "00";
    }
    const hourNumber = Number(hourText);
    const minuteNumber = Number(minuteText);
    if (!Number.isInteger(hourNumber) || !Number.isInteger(minuteNumber) || hourNumber < 0 || hourNumber > 23 || minuteNumber < 0 || minuteNumber > 59) {
      setTimeErrors((current) => ({ ...current, [key]: "시간 형식을 확인해 주세요. 예: 13 또는 13:30" }));
      return;
    }
    const hour = String(hourNumber).padStart(2, "0");
    const minute = String(minuteNumber).padStart(2, "0");
    setTimeErrors((current) => { const next = { ...current }; delete next[key]; return next; });
    executeStaffCalculation(index, { [field]: `${hour}:${minute}` });
  };

  const distributeHeadOfficeOvertime = (rows: StaffRow[]) => {
    const groups = new Map<string, number[]>();
    rows.forEach((row, index) => {
      const key = row.residentNumber || row.name || `row-${index}`;
      groups.set(key, [...(groups.get(key) || []), index]);
    });

    const next = rows.map((row) => ({ ...row, overtime: 0 }));
    groups.forEach((indexes) => {
      const activeIndexes = indexes.filter((index) => next[index].officeWorkType !== "휴무");
      const standard = activeIndexes.reduce((value, index) => value || Number(next[index].standardHours || 0), 0) || defaultStandardHours;
      const totalWorkHours = activeIndexes.reduce((sum, index) => sum + Number(next[index].workHours || 0), 0);
      const totalDelta = parseFloat((totalWorkHours - standard).toFixed(1));
      if (totalDelta <= 0) {
        const lastIndex = activeIndexes[activeIndexes.length - 1];
        if (lastIndex !== undefined) next[lastIndex].overtime = totalDelta;
        return;
      }
      let cumulativeHours = 0;
      let allocatedOvertime = 0;
      activeIndexes.forEach((index) => {
        cumulativeHours += Number(next[index].workHours || 0);
        const totalOvertime = Math.max(0, cumulativeHours - standard);
        const rowOvertime = parseFloat((totalOvertime - allocatedOvertime).toFixed(1));
        allocatedOvertime = totalOvertime;
        next[index].overtime = rowOvertime;
        if (rowOvertime <= 0) next[index].overtimeReason = "";
      });
    });
    return next;
  };

  // Interactive Staff updates with calculation triggers
  const executeStaffCalculation = (index: number, updatedFields: Partial<StaffRow>) => {
    setStaffRows((prev) => {
      const copy = [...prev];
      const row = { ...copy[index], ...updatedFields };

      if (isHeadOffice) {
        if (row.officeWorkType === "휴무") {
          row.workHours = 0;
          row.clockIn = "";
          row.clockOut = "";
          row.standardHours = 0;
          row.overtime = 0;
          row.overtimeReason = "";
        } else {
          if (!row.standardHours) row.standardHours = defaultStandardHours;
          row.officeWorkplace = row.officeWorkplace || branchName;
          const inDec = parseTimeToDecimal(row.clockIn);
          const outDec = parseTimeToDecimal(row.clockOut);
          let calculatedWorkHours = 0;
          if (row.clockIn && row.clockOut && (row.clockIn !== "00:00" || row.clockOut !== "00:00")) {
            calculatedWorkHours = outDec - inDec;
            if (calculatedWorkHours < 0) calculatedWorkHours += 24;
          }
          row.workHours = parseFloat(calculatedWorkHours.toFixed(1));
          row.overtime = parseFloat((row.workHours - (Number(row.standardHours) || 0)).toFixed(1));
          if (row.overtime === 0) row.overtimeReason = "";
        }
        copy[index] = row;
        return distributeHeadOfficeOvertime(copy);
      }

      const inDec = parseTimeToDecimal(row.clockIn);
      const outDec = parseTimeToDecimal(row.clockOut);

      if (!row.clockIn || !row.clockOut) {
        row.workHours = 0;
        row.overtime = 0;
        row.overtimeReason = "";
        copy[index] = row;
        return copy;
      }

      // Reset hours if clocked out same as clocked in ("00:00" to "00:00")
      let calculatedWorkHours = 0;
      if (row.clockIn !== "00:00" || row.clockOut !== "00:00") {
        calculatedWorkHours = outDec - inDec;
        if (calculatedWorkHours < 0) {
          calculatedWorkHours += 24; // Overnight shift support
        }
      }

      const standard = row.division === "파트타이머" ? 0 : Number(row.standardHours) || 0;
      // 파트타이머는 시급제이므로 실제 근무시간만 기록하고 초과근무로 계산하지 않습니다.
      let calculatedOvertime = row.division === "파트타이머" ? 0 : calculatedWorkHours - standard;

      // Handle precision
      calculatedWorkHours = parseFloat(calculatedWorkHours.toFixed(1));
      calculatedOvertime = parseFloat(calculatedOvertime.toFixed(1));

      row.workHours = calculatedWorkHours;
      row.overtime = calculatedOvertime;

      // Clean overtime reason if overtime returns to 0
      if (calculatedOvertime === 0) {
        row.overtimeReason = "";
      }

      copy[index] = row;
      return copy;
    });
  };

  // Dynamic Expenses Controls
  const addExpenseRow = (type: "cash" | "card") => {
    const list = type === "cash" ? cashExpenses : cardExpenses;
    const setList = type === "cash" ? setCashExpenses : setCardExpenses;
    setList([...list, { classification: "식재료", usage: "쿠팡", detail: "", amount: "" }]);
  };

  const removeExpenseRow = (type: "cash" | "card", index: number) => {
    const list = type === "cash" ? cashExpenses : cardExpenses;
    const setList = type === "cash" ? setCashExpenses : setCardExpenses;
    if (list.length === 1) {
      setList([{ classification: "식재료", usage: "쿠팡", detail: "", amount: "" }]);
    } else {
      setList(list.filter((_, i) => i !== index));
    }
  };

  const updateExpenseField = (type: "cash" | "card", index: number, field: keyof ExpenseRow, value: string) => {
    const list = type === "cash" ? cashExpenses : cardExpenses;
    const setList = type === "cash" ? setCashExpenses : setCardExpenses;
    const copy = [...list];
    copy[index] = { ...copy[index], [field]: value };
    setList(copy);
  };

  const addOfficeWorkSegment = (index: number) => {
    setStaffRows((prev) => {
      const source = prev[index];
      if (!source) return prev;
      const nextRow: StaffRow = {
        ...source,
        segmentId: `segment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        officeWorkType: "근무",
        officeWorkplace: source.officeWorkplace || branchName,
        standardHours: 0,
        clockIn: "",
        clockOut: "",
        workHours: 0,
        overtime: 0,
        overtimeReason: "",
        officeTaskMemo: ""
      };
      return [...prev.slice(0, index + 1), nextRow, ...prev.slice(index + 1)];
    });
  };

  const headOfficeDailyOvertimeRows = useMemo(() => {
    if (!isHeadOffice) return [];
    const byName = new Map<string, { name: string; workHours: number; standardHours: number; overtime: number }>();
    staffRows.forEach((row, index) => {
      if (row.officeWorkType === "휴무") return;
      const key = row.residentNumber || row.name || `row-${index}`;
      const current = byName.get(key) || { name: row.name || "-", workHours: 0, standardHours: 0, overtime: 0 };
      current.workHours += Number(row.workHours || 0);
      current.standardHours = current.standardHours || Number(row.standardHours || 0) || defaultStandardHours;
      current.overtime += Number(row.overtime || 0);
      byName.set(key, current);
    });
    return Array.from(byName.values()).filter((row) => row.workHours > 0 || row.overtime !== 0);
  }, [defaultStandardHours, isHeadOffice, staffRows]);

  // Submit flow
  const handleSettleSubmit = async () => {
    if (submitting) return;
    const writerName = String(writer ?? "").trim();
    const nextValidationTargets = createDailySettleValidationTargets();
    const validationMessages: string[] = [];
    let firstInvalidElementId = "";
    const rememberFirstInvalid = (elementId: string) => {
      if (!firstInvalidElementId) firstInvalidElementId = elementId;
    };

    if (!writerName && !hasExistingRecord) {
      nextValidationTargets.fields.writer = true;
      validationMessages.push("마감 작성자 이름을 입력해 주세요.");
      rememberFirstInvalid("settle-writer-input");
    }

    let hasSalesRequiredError = false;
    if (!isHeadOffice) {
      if (!cardSales) {
        nextValidationTargets.fields.cardSales = true;
        hasSalesRequiredError = true;
        rememberFirstInvalid("settle-cardSales-input");
      }
      if (!cashSales) {
        nextValidationTargets.fields.cashSales = true;
        hasSalesRequiredError = true;
        rememberFirstInvalid("settle-cashSales-input");
      }
      if (!hasExistingRecord && !cashBalance) {
        nextValidationTargets.fields.cashBalance = true;
        hasSalesRequiredError = true;
        rememberFirstInvalid("settle-cashBalance-input");
      }
      if (hasSalesRequiredError) {
        validationMessages.push("필수 매출 항목을 모두 작성해 주세요.");
      }
    }

    const settlePrevDayCashNum = Number(prevDayCash) || 0;
    const settleCashSalesNum = Number(cashSales) || 0;
    const settleCashExpensesSumValue = cashExpenses.reduce((acc, row) => acc + (Number(row.amount) || 0), 0);
    const settleTheoreticalBalance = settlePrevDayCashNum + settleCashSalesNum - settleCashExpensesSumValue;
    const settleActualCashInVault = Number(cashBalance) || 0;
    const settleDiff = settleActualCashInVault - settleTheoreticalBalance;

    if (!isHeadOffice && cashBalance !== "" && settleDiff !== 0 && !cashDiffReason.trim()) {
      nextValidationTargets.fields.cashDiffReason = true;
      validationMessages.push("금고 현금 불일치 사유를 작성해 주세요.");
      rememberFirstInvalid("settle-cash-diff-reason");
    }

    const firstTimeErrorKey = Object.keys(timeErrors)[0];
    if (firstTimeErrorKey) {
      validationMessages.push("출퇴근 시간 입력 오류를 수정해 주세요.");
      rememberFirstInvalid(`staff-time-${firstTimeErrorKey}`);
    }

    const missingOfficeWorkRows = isHeadOffice
      ? staffRows
        .map((staff, index) => ({ staff, index }))
        .filter(({ staff }) => staff.officeWorkType !== "휴무" && (!(Number(staff.workHours) > 0) || !staff.clockIn || !staff.clockOut || !String(staff.officeTaskMemo || "").trim() || !String(staff.officeWorkplace || "").trim()))
      : [];
    if (missingOfficeWorkRows.length > 0) {
      missingOfficeWorkRows.forEach(({ staff, index }) => {
        nextValidationTargets.officeWorkRows[getDailyStaffValidationKey(staff, index)] = true;
      });
      validationMessages.push(`${missingOfficeWorkRows.map(({ staff }) => staff.name).join(", ")} 님의 근무 시간과 업무 내용을 작성하거나 휴무로 체크해 주세요.`);
      rememberFirstInvalid(`office-work-row-${missingOfficeWorkRows[0].index}`);
    }

    const missingOvertimeReasonRows = staffRows
      .map((staff, index) => ({ staff, index }))
      .filter(({ staff }) => needsOvertimeReason(staff) && !staff.overtimeReason.trim());
    if (missingOvertimeReasonRows.length > 0) {
      missingOvertimeReasonRows.forEach(({ staff, index }) => {
        nextValidationTargets.overtimeReasonRows[getDailyStaffValidationKey(staff, index)] = true;
      });
      validationMessages.push(`${missingOvertimeReasonRows.map(({ staff }) => staff.name).join(", ")} 님의 초과근무 또는 조기출근/조기퇴근 사유를 입력해 주세요.`);
      rememberFirstInvalid(`staff-overtime-reason-${missingOvertimeReasonRows[0].index}`);
    }

    const hasTargetedValidationError =
      Object.values(nextValidationTargets.fields).some(Boolean) ||
      Object.keys(nextValidationTargets.officeWorkRows).length > 0 ||
      Object.keys(nextValidationTargets.overtimeReasonRows).length > 0 ||
      Object.keys(timeErrors).length > 0;
    if (hasTargetedValidationError) {
      setValidationTargets(nextValidationTargets);
      setValidationErrors(true);
      triggerToast(validationMessages.slice(0, 3).join(" / "), "error");
      if (firstInvalidElementId) {
        window.requestAnimationFrame(() => {
          const target = document.getElementById(firstInvalidElementId);
          target?.scrollIntoView({ behavior: "smooth", block: "center" });
          if (target instanceof HTMLElement) target.focus({ preventScroll: true });
        });
      }
      return;
    }

    if (!writerName && !hasExistingRecord) {
      setValidationErrors(true);
      triggerToast("마감 작성자 이름을 꼭 입력해 주세요.", "error");
      return;
    }
    if (!isHeadOffice && (!cashSales || !cardSales || (!hasExistingRecord && !cashBalance))) {
      setValidationErrors(true);
      triggerToast("일일 매출 필수 요건(현금, 카드 매출액 및 금고 현금 잔액)을 모두 채워주십시오.", "error");
      return;
    }

    const prevDayCashNum = Number(prevDayCash) || 0;
    const cashSalesNum = Number(cashSales) || 0;
    const cashExpensesSumValue = cashExpenses.reduce((acc, row) => acc + (Number(row.amount) || 0), 0);
    const theoreticalBalance = prevDayCashNum + cashSalesNum - cashExpensesSumValue;
    const actualCashInVault = Number(cashBalance) || 0;
    const diff = actualCashInVault - theoreticalBalance;

    if (!isHeadOffice && cashBalance !== "" && diff !== 0 && !cashDiffReason.trim()) {
      setValidationErrors(true);
      triggerToast("이론상 잔액과 금고 실사 현금이 일치하지 않습니다. 불일치 사유를 반드시 작성해 주셔야 제출 가능합니다.", "error");
      return;
    }

    if (!branchName) {
      triggerToast("지점 정보를 불러올 수 없습니다. 로그아웃 후 다시 로그인해 주세요.", "error");
      return;
    }

    if (Object.keys(timeErrors).length > 0) {
      triggerToast("출퇴근 시간 입력 오류를 수정한 뒤 마감 제출해 주세요.", "error");
      return;
    }

    const missingOfficeWork = isHeadOffice
      ? staffRows.filter((staff) => staff.officeWorkType !== "휴무" && (!(Number(staff.workHours) > 0) || !staff.clockIn || !staff.clockOut || !String(staff.officeTaskMemo || "").trim() || !String(staff.officeWorkplace || "").trim()))
      : [];
    if (missingOfficeWork.length > 0) {
      setValidationErrors(true);
      triggerToast(`${missingOfficeWork.map((staff) => staff.name).join(", ")} 님의 업무시간과 업무내용을 입력하거나 휴무로 체크해 주세요.`, "error");
      return;
    }

    const missingOvertimeReason = staffRows.filter((staff) => needsOvertimeReason(staff) && !staff.overtimeReason.trim());
    if (missingOvertimeReason.length > 0) {
      setValidationErrors(true);
      triggerToast(`${missingOvertimeReason.map((staff) => staff.name).join(", ")} 님의 초과근무 또는 조기출근/조기퇴근 사유를 입력해 주세요.`, "error");
      return;
    }

    const longShift = staffRows.filter((staff) => staff.workHours > 13);
    if (longShift.length > 0 && !window.confirm(`${longShift.map((staff) => `${staff.name} ${staff.workHours}시간`).join(", ")} 근무가 13시간을 초과합니다. 출퇴근 시간 입력이 맞습니까?`)) return;

    setSubmitting(true);
    setValidationErrors(false);
    setValidationTargets(createDailySettleValidationTargets());

    try {
      // 1. Pack full high-fidelity JSON metadata for complete state restorability
      const serializeMetaData = JSON.stringify({
        staffRows,
        cashExpenses,
        cardExpenses,
        cashBalance,
        prevDayCash,
        cashDiffReason,
        staffMemo,
        reviewMemo,
        otherMemo
      });

      // Human-readable textual schedule summary to append into spreadsheet cell
      const formattedStaffSummaryStr = staffRows
        .map(
          (s) => isHeadOffice
            ? `- ${s.name}: ${s.officeWorkType === "휴무" ? "휴무" : `${s.clockIn}~${s.clockOut} ${s.workHours}h 근무 / 근무지점 ${s.officeWorkplace || branchName} / 초과 ${s.overtime > 0 ? "+" : ""}${s.overtime}h`} ${s.officeTaskMemo ? `(${s.officeTaskMemo})` : ""}${s.overtimeReason ? ` (초과사유: ${s.overtimeReason})` : ""}`
            : `- ${s.name} (${s.division}): 출근 ${s.clockIn}, 퇴근 ${s.clockOut} [기준 ${s.standardHours}h, 근무 ${s.workHours}h, 초과 ${s.overtime > 0 ? "+" : ""}${s.overtime}h] ${
                s.overtimeReason ? `(사유: ${s.overtimeReason})` : ""
              }`
        )
        .join("\n");

      const visibleMemo = isHeadOffice
        ? `[본사 업무 특이사항]\n${otherMemo.trim()}`
        : `[직원 특이사항]\n${staffMemo.trim()}\n\n[리뷰 특이사항]\n${reviewMemo.trim()}\n\n[기타 특이사항]\n${otherMemo.trim()}`;
      const combinedMemo = `${visibleMemo}\n\n[근무 일지 요약]\n${formattedStaffSummaryStr}\n---\nMETADATA:\n${serializeMetaData}`;

      // Automatically register any newly added staff in the roster checklist to Roster master list
      try {
        const [localRoster, remoteRoster] = await Promise.all([
          Promise.resolve(getRoster()),
          gasClient.getBranchOwnRoster(branchName).catch(() => [])
        ]);
        const mergedRoster: Employee[] = [];
        const rosterNames = new Set<string>();

        [...remoteRoster, ...localRoster].forEach((employee) => {
          if (isSampleEmployee(employee)) return;
          const normalized = normalizeRosterEmployee(employee);
          if (!normalized) return;
          const name = normalized.name;
          if (!name || rosterNames.has(name)) return;
          mergedRoster.push(normalized);
          rosterNames.add(name);
        });

        staffRows.forEach((s) => {
          const name = employeeNameKey(s.name);
          if (!name || rosterNames.has(name) || shouldSkipDailyRosterRegistration(s)) return;
          const newEmp = createEmployeeFromStaffRow({ ...s, name });
          mergedRoster.push(newEmp);
          rosterNames.add(name);
        });

        const remoteNames = new Set(remoteRoster.filter((employee) => !isSampleEmployee(employee)).map((employee) => employeeNameKey(employee.name)).filter(Boolean));
        const needsRemoteSave =
          remoteRoster.some((employee) => isSampleEmployee(employee)) ||
          mergedRoster.length !== remoteNames.size ||
          mergedRoster.some((employee) => !remoteNames.has(employee.name));

        localStorage.setItem(staffListStorageKey(branchName), JSON.stringify(mergedRoster));
        if (needsRemoteSave) {
          await gasClient.saveBranchOwnRoster(branchName, mergedRoster);
        }
      } catch (e) {
        console.error("Local roster automatic registration failed:", e);
      }

      // 2. Format Expenses matching legacy GAS DB row model properties
      const formattedExpenses = isHeadOffice ? [] : [
        ...cashExpenses
          .filter((e) => e.amount.trim() !== "")
          .map((e) => ({
            expenseType: "현금지출" as const,
            itemName: `${e.classification} | ${e.usage} | ${e.detail.trim()}`,
            amount: Number(e.amount) || 0
          })),
        ...cardExpenses
          .filter((e) => e.amount.trim() !== "")
          .map((e) => ({
            expenseType: "카드지출" as const,
            itemName: `${e.classification} | ${e.usage} | ${e.detail.trim()}`,
            amount: Number(e.amount) || 0
          }))
      ];

      // 3. Format Staff matching legacy GAS DB row model properties (Total calculated hours per person)
      const formattedStaff = staffRows.map((s) => ({
        staffName: s.name,
        workHours: s.workHours,
        division: s.division
      }));

      // 4. Primary Master Object payload
      const masterPayload = {
        branchName,
        settleDate,
        cashSales: Number(cashSales) || 0,
        cardSales: Number(cardSales) || 0,
        transferSales: Number(transferSales) || 0,
        deliverySales: Number(deliverySales) || 0,
        memo: combinedMemo,
        submittedBy: writerName
      };

      let response;
      if (hasExistingRecord && existingRecordId) {
        // Edit mode (GAS Spreadsheet updates row & logs modification)
        response = await gasClient.updateDaily(existingRecordId, masterPayload, formattedExpenses, formattedStaff, writerName);
        triggerToast("해당 날짜의 마감 정산 정보가 업데이트에 성공했습니다!");
      } else {
        // Save mode
        response = await gasClient.submitDaily(masterPayload, formattedExpenses, formattedStaff);
        triggerToast("당일 마감 정산 문서가 무사히 스프레드시트에 기입 완료되었습니다!");
      }

      setSubmittedResult({
        date: settleDate,
        writer: writerName,
        total: totalSales,
        recordId: existingRecordId || (response as any)?.recordId || `uid-${Date.now()}`
      });
      localStorage.removeItem(draftKey);

      // Refresh completed dates list
      void refreshCompletedDates();
    } catch (e: any) {
      console.error("Submission failed", e);
      triggerToast(e.message || "원격 데이터베이스 연동 네트워크 에러가 발생했습니다.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateNewSettle = () => {
    setHasExistingRecord(false);
    setExistingRecordId(null);
    setIsEditApproved(true);
    setWriter("");
    setTimeErrors({});
    setValidationErrors(false);
    setValidationTargets(createDailySettleValidationTargets());
    setSubmittedResult(null);
    setCashSales("");
    setCardSales("");
    setTransferSales("");
    setDeliverySales("");
    setCashExpenses([{ classification: "식재료", usage: "쿠팡", detail: "", amount: "" }]);
    setCardExpenses([{ classification: "식재료", usage: "쿠팡", detail: "", amount: "" }]);
    setMemo("");
    setCashBalance("");
    setPrevDayCash("0");
    setCashDiffReason("");
    setStaffMemo("");
    setReviewMemo("");
    setOtherMemo("");
    localStorage.removeItem(draftKey);
    initRosterInForm();
  };

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay(); // 0 = Sunday, ..., 6 = Saturday
  };

  const renderMiniCalendar = () => {
    const daysInMonth = getDaysInMonth(calYear, calMonth);
    const firstDay = getFirstDayOfMonth(calYear, calMonth);

    // Create days array
    const days: Array<{ day: number; dateStr: string; isCurrentMonth: boolean } | null> = [];

    // Empty slots for previous month padding
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }

    // Days of current month
    for (let day = 1; day <= daysInMonth; day++) {
      const mStr = String(calMonth + 1).padStart(2, "0");
      const dStr = String(day).padStart(2, "0");
      const dateStr = `${calYear}-${mStr}-${dStr}`;
      days.push({ day, dateStr, isCurrentMonth: true });
    }

    const prevMonth = () => {
      if (calMonth === 0) {
        setCalYear(prev => prev - 1);
        setCalMonth(11);
      } else {
        setCalMonth(prev => prev - 1);
      }
    };

    const nextMonth = () => {
      if (calMonth === 11) {
        setCalYear(prev => prev + 1);
        setCalMonth(0);
      } else {
        setCalMonth(prev => prev + 1);
      }
    };

    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];

    return (
      <div className="absolute top-full left-0 z-50 mt-1.5 p-4 bg-white border border-zinc-200 rounded-2xl shadow-xl w-[320px] max-w-[calc(100vw-2rem)]" id="mini-status-calendar">
        <div className="flex justify-between items-center mb-3">
          <button
            type="button"
            onClick={prevMonth}
            className="p-1 hover:bg-zinc-100 rounded-lg text-zinc-600 transition-colors focus:outline-none cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-black text-zinc-800">
            {calYear}년 {calMonth + 1}월 마감 현황
          </span>
          <button
            type="button"
            onClick={nextMonth}
            className="p-1 hover:bg-zinc-100 rounded-lg text-zinc-600 transition-colors focus:outline-none cursor-pointer"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Weekday names */}
        <div className="grid grid-cols-7 gap-1 text-center mb-1.5">
          {weekdays.map((w, idx) => (
            <span
              key={w}
              className={`text-[10px] font-extrabold ${
                idx === 0 ? "text-rose-500" : idx === 6 ? "text-[#2E6DB4]" : "text-zinc-400"
              }`}
            >
              {w}
            </span>
          ))}
        </div>

        {/* Days grid */}
        <div className="grid grid-cols-7 gap-1">
          {days.map((item, idx) => {
            if (!item) {
              return <div key={`empty-${idx}`} className="aspect-square" />;
            }

            const isSelected = item.dateStr === settleDate;
            const isCompleted = completedDates.includes(item.dateStr);

            return (
              <button
                key={item.dateStr}
                type="button"
                onClick={() => {
                  setSettleDate(item.dateStr);
                  setShowStatusCalendar(false);
                }}
                className={`relative aspect-square rounded-xl text-xs font-bold flex flex-col items-center justify-center transition-all focus:outline-none cursor-pointer ${
                  isSelected
                    ? "bg-[#2E6DB4] text-white shadow-sm font-black scale-105 z-10"
                    : isCompleted
                    ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100/70 border border-emerald-100"
                    : "bg-white text-zinc-700 hover:bg-zinc-100 border border-zinc-100"
                }`}
              >
                <span>{item.day}</span>
                {isCompleted && (
                  <span
                    className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ring-2 ${
                      isSelected ? "bg-white ring-[#2E6DB4]" : "bg-emerald-500 ring-emerald-50"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-2.5 flex items-center justify-end gap-3 text-[10px] text-zinc-500 font-bold px-1">
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-md bg-white border border-zinc-150" />
            <span>미마감</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-md bg-emerald-50 border border-emerald-100 relative flex items-center justify-center">
              <span className="w-1 h-1 rounded-full bg-emerald-500" />
            </span>
            <span className="text-emerald-700">마감 완료</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-md bg-[#2E6DB4]" />
            <span className="text-[#2E6DB4]">선택됨</span>
          </div>
        </div>
      </div>
    );
  };

  if (checking) {
    return (
      <div className="bg-white rounded-3xl p-12 text-center border border-gray-100 shadow-sm flex flex-col items-center justify-center space-y-4 min-h-[400px]">
        <LoadingSpinner size="lg" />
        <p className="text-sm text-gray-400 font-semibold font-mono">가정 날짜 정산 레코드 검사 및 로드 중...</p>
      </div>
    );
  }

  // Submission Completed Card with KakaoTalk Report copying interface
  if (submittedResult) {
    const getKakaoReportText = () => {
      const koreanDate = getKoreanDateWithDay(submittedResult.date);
      const writerName = submittedResult.writer;

      const cardExpensesSum = cardExpenses.reduce((acc, row) => acc + (Number(row.amount) || 0), 0);
      const cashExpensesSum = cashExpenses.reduce((acc, row) => acc + (Number(row.amount) || 0), 0);

      const summarizeExpenses = (rows: ExpenseRow[], total: number) => {
        if (total <= 0) return "없음";
        const categoryTotals = rows.reduce((acc, row) => {
          const amount = Number(row.amount) || 0;
          if (amount <= 0) return acc;
          const category = row.classification || "기타";
          acc.set(category, (acc.get(category) || 0) + amount);
          return acc;
        }, new Map<string, number>());
        const categoryText = Array.from(categoryTotals.entries())
          .map(([category, amount]) => `${category} ${formatNumber(amount)}원`)
          .join(", ");
        return categoryText ? `${formatNumber(total)}원 (${categoryText})` : `${formatNumber(total)}원`;
      };

      const cardText = summarizeExpenses(cardExpenses, cardExpensesSum);
      const cashText = summarizeExpenses(cashExpenses, cashExpensesSum);

      const workersText = Array.from(new Set(
        staffRows
          .filter((s) => s.officeWorkType !== "휴무" && Number(s.workHours || 0) > 0)
          .map((s) => s.name)
          .filter(Boolean)
      )).join(", ") || "없음";

      const prevDayCashNum = Number(prevDayCash) || 0;
      const cashSalesNum = Number(cashSales) || 0;
      const transferSalesNum = Number(transferSales) || 0;
      const theoreticalBalance = prevDayCashNum + cashSalesNum - cashExpensesSum;
      const actualCashInVault = Number(cashBalance) || 0;
      const diff = actualCashInVault - theoreticalBalance;

      return `[${koreanDate} - 작성자:${writerName}]

1. 현금 마감
- 전일현금: ${formatNumber(prevDayCashNum)}원
- 오늘현금매출: ${formatNumber(cashSalesNum)}원
- 오늘현금지출: ${formatNumber(cashExpensesSum)}원
- 오늘계좌이체: ${formatNumber(transferSalesNum)}원
- 이론상잔액: ${formatNumber(theoreticalBalance)}원
- 금고실사현금: ${formatNumber(actualCashInVault)}원
- 차이: ${diff > 0 ? "+" : ""}${formatNumber(diff)}원${diff !== 0 ? ` (사유: ${cashDiffReason.trim()})` : ""}

2. 지출
- 카드지출 : ${cardText || "없음"}
- 현금지출 : ${cashText || "없음"}

3. 근무자
- ${workersText}
- 홀:
- 주방:

4. 특이사항
- 직원 특이사항: ${staffMemo.trim() || "없음"}
- 리뷰 특이사항: ${reviewMemo.trim() || "없음"}`;
    };

    return (
      <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6" id="success-receipt-box">
        {/* Left Card: Submission Statistics */}
        <div className="bg-white rounded-3xl p-6 border border-gray-150 shadow-xl space-y-6 flex flex-col justify-between">
          <div className="text-center space-y-4">
            <div className="inline-flex w-14 h-14 rounded-full bg-emerald-50 items-center justify-center text-emerald-600">
              <CheckCircle2 className="w-8 h-8 animate-bounce" />
            </div>

            <div>
              <h2 className="text-xl font-black text-gray-800 tracking-tight">마감 정산 전송 성공!</h2>
              <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                {branchName}의 일일 정산 마무리가 실시간 구글 시트 연동 원격 및 로컬 저장소 백업에 안전하게 입력되었습니다.
              </p>
            </div>

            <div className="bg-zinc-50 border border-gray-200 rounded-2xl p-4 text-left divide-y divide-gray-200 text-xs">
              <div className="py-2 flex justify-between">
                <span className="text-gray-400 font-bold">작성 일지 날짜</span>
                <span className="text-gray-800 font-mono font-black">{submittedResult.date}</span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-gray-400 font-bold">작성 완료 보고자</span>
                <span className="text-gray-800 font-bold">{submittedResult.writer}</span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-gray-400 font-bold">당일 총 매출 합계</span>
                <span className="text-zinc-950 font-mono font-black">{formatNumber(submittedResult.total)} 원</span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-gray-400 font-bold">정산 레코드 키</span>
                <span className="text-gray-400 font-mono text-[9px] break-all select-all">{submittedResult.recordId}</span>
              </div>
            </div>
          </div>

          <button
            onClick={handleCreateNewSettle}
            className="w-full py-3 bg-zinc-800 hover:bg-black text-white font-black text-xs tracking-wide rounded-xl transition-colors cursor-pointer shadow-md mt-4"
            id="btn-receipt-finish"
          >
            새 일지 기재 혹은 다른 날짜 선택
          </button>
        </div>

        {/* Right Card: KakaoTalk Report Body with Instant Copy Button */}
        <div className="bg-white rounded-3xl p-6 border border-gray-150 shadow-xl space-y-4 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-zinc-800">
              <span className="text-lg">💬</span>
              <h3 className="text-sm font-black text-gray-800">카카오톡 보고 양식</h3>
            </div>
            <p className="text-[11px] text-gray-400 leading-normal">
              아래 텍스트 상자의 요약을 복사하여 보고하실 수 있습니다.
            </p>
          </div>

          <div className="relative grow mt-2">
            <textarea
              readOnly
              value={getKakaoReportText()}
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              className="w-full h-[280px] p-4 bg-zinc-50 border border-gray-200 rounded-2xl font-sans text-xs text-zinc-800 focus:outline-hidden leading-relaxed resize-none select-all font-semibold"
            />
          </div>

          <button
            onClick={() => {
              const text = getKakaoReportText();
              const doFallbackCopy = (txt: string) => {
                try {
                  const textArea = document.createElement("textarea");
                  textArea.value = txt;
                  textArea.style.top = "0";
                  textArea.style.left = "0";
                  textArea.style.position = "fixed";
                  document.body.appendChild(textArea);
                  textArea.focus();
                  textArea.select();
                  const successful = document.execCommand('copy');
                  document.body.removeChild(textArea);
                  if (successful) {
                    triggerToast("카카오톡 보고 내용이 무사히 클립보드에 복사 완료되었습니다!");
                  } else {
                    triggerToast("복사에 실패했습니다. 우측 텍스트상자를 길게 눌러 직접 복사해주세요.", "error");
                  }
                } catch (err) {
                  triggerToast("직접 드래그앤드롭하여 텍스트 복사를 시도해보세요.", "error");
                }
              };

              try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(text)
                    .then(() => {
                      triggerToast("카카오톡 보고 내용이 무사히 클립보드에 복사 완료되었습니다!");
                    })
                    .catch(() => {
                      doFallbackCopy(text);
                    });
                } else {
                  doFallbackCopy(text);
                }
              } catch (err) {
                doFallbackCopy(text);
              }
            }}
            className="w-full py-3 bg-[#FEE500] hover:bg-[#F3DB00] text-[#191919] font-black text-xs rounded-xl tracking-wide transition-colors cursor-pointer shadow-sm flex items-center justify-center gap-2"
          >
            <ClipboardList className="w-4 h-4" />
            카톡 보고 복사하기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" id="settle-tab-form">
      {/* Toast Alert overlay */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50">
          <div className={`px-5 py-3.5 rounded-2xl border text-xs font-bold shadow-xl flex items-center gap-2.5 ${
            toast.type === "success"
              ? "bg-emerald-50 border-emerald-100 text-emerald-800"
              : "bg-rose-50 border-rose-100 text-rose-800"
          }`}>
            {toast.type === "success" ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <AlertTriangle className="w-4 h-4 text-rose-500" />}
            {toast.message}
          </div>
        </div>
      )}

      {/* Date & Writer Row */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6" id="settle-header-controls">
        <div className="grid grid-cols-2 gap-4 grow">
          <div className="flex flex-col space-y-1.5 relative">
            <div className="flex items-center justify-between">
              <label className="text-xs font-extrabold text-[#1C3C6E] flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-[#2E6DB4]" /> 마감 대상 날짜
              </label>
            </div>
            <div className="relative">
              {/* Hidden native input for compatibility */}
              <input
                type="date"
                value={settleDate}
                onChange={(e) => setSettleDate(e.target.value)}
                onFocus={() => setShowStatusCalendar(true)}
                className="absolute inset-0 opacity-0 pointer-events-none w-0 h-0"
                id="settle-date-picker"
              />
              <button
                type="button"
                onClick={() => setShowStatusCalendar(prev => !prev)}
                className="px-4 py-2.5 border border-gray-200 rounded-xl font-mono text-sm text-gray-700 bg-gray-50/50 hover:bg-zinc-100/50 hover:border-gray-300 focus:bg-white focus:outline-hidden focus:border-[#2E6DB4] transition-all cursor-pointer w-full text-left flex justify-between items-center"
              >
                <span>{settleDate || "날짜를 선택해 주세요"}</span>
                <Calendar className="w-4 h-4 text-gray-400" />
              </button>
              {showStatusCalendar && renderMiniCalendar()}
            </div>
          </div>

          <div className="flex flex-col space-y-1.5">
            <label className="text-xs font-extrabold text-[#1C3C6E] flex items-center gap-1">
              <User className="w-3.5 h-3.5 text-[#2E6DB4]" /> 마감 작성자
            </label>
            <input
              type="text"
              value={writer}
              onChange={(e) => {
                setWriter(e.target.value);
                clearValidationField("writer");
              }}
              placeholder="작성자 성명 기입"
              className={`px-4 py-2.5 border rounded-xl text-sm bg-gray-50/50 focus:bg-white focus:outline-hidden focus:border-[#2E6DB4] transition-all ${
                validationErrors && hasValidationField("writer") ? "branch-validation-error" : "border-gray-200"
              }`}
              id="settle-writer-input"
            />
          </div>
        </div>

        {hasExistingRecord ? (
          <div className="px-4 py-3 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-2 text-xs text-rose-800 leading-normal max-w-sm md:ml-auto">
            <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
            <span>
              <strong>기저장 정보 존재:</strong> 수정하시려면 승인이 필요합니다.
            </span>
          </div>
        ) : (
          <div className="px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl flex items-center gap-2 text-xs text-zinc-700 leading-normal max-w-sm md:ml-auto">
            <Info className="w-4 h-4 text-zinc-500 shrink-0" />
            <span>선택하신 날짜({settleDate})로 오늘 마감 작성을 새롭게 수행하십시오.</span>
          </div>
        )}
      </div>

      {/* Prominent Red warning for duplicate records */}
      {hasExistingRecord && (
        <div className={`p-5 rounded-2xl border ${
          isEditApproved
            ? "bg-rose-50 border-rose-200 text-rose-900 shadow-xs"
            : "bg-red-600 border-red-700 text-white shadow-md"
        } transition-all space-y-4`} id="existing-record-warning-box">
          <div className="rounded-2xl border border-zinc-900 bg-[#EFF0A3] p-4 text-sm font-black text-zinc-950">
            기존 마감 기록이 있는 날짜입니다. 수정하려면 아래의 [수정모드로 진행할 것을 승인함] 버튼을 눌러 주세요.
          </div>
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-xs font-black tracking-tight uppercase">
                🚨 이미 마감 기록이 완료된 정산일입니다 ({settleDate})
              </h4>
              <p className="text-[11px] opacity-90 leading-relaxed font-bold">
                {isEditApproved
                  ? "지점 마감 기록 수정 모드 진입이 최종 승인되었습니다. 아래 양식에서 값을 수정한 다음 [마감 제출]을 클릭하시면 이중 등록 없이 기존 내용이 완전히 교체 수정됩니다."
                  : "선택하신 날짜에 이미 다른 마감 결재가 완료되었습니다. 본 마감 정산 내역을 정말로 수정하여 덮어쓰시겠습니까? 수정을 원치 않으시면 날짜를 다시 지정해 주십시오."
                }
              </p>
            </div>
          </div>

          {(
            <div className="flex flex-wrap gap-2 pt-1 font-extrabold text-[11px]">
              <button
                type="button"
                onClick={() => {
                  setIsEditApproved(true);
                  triggerToast("기존 결재 수정 모드가 승인 해제되었습니다.", "success");
                }}
                className="px-3.5 py-2 bg-white hover:bg-gray-100 text-red-600 rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1"
              >
                ✏️ 수정모드로 진행할 것을 승인함
              </button>
              {isEditApproved && <button
                type="button"
                onClick={async () => {
                  if (!existingRecordId) return;
                  if (!window.confirm(`${settleDate} 마감정산 내역을 완전히 초기화할까요?\n확인을 누르면 저장된 마감기록이 삭제되어 다시 들어와도 처음 입력 상태로 표시됩니다.`)) return;
                  try {
                    await gasClient.deleteDaily(existingRecordId);
                  } catch (error: any) {
                    triggerToast(error?.message || "정산 기록 삭제에 실패했습니다.", "error");
                    return;
                  }
                  setHasExistingRecord(false); setExistingRecordId(null); setTimeErrors({}); setValidationErrors(false); setValidationTargets(createDailySettleValidationTargets()); setWriter("");
                  setCashSales(""); setCardSales(""); setTransferSales(""); setDeliverySales(""); setCashBalance(""); setCashDiffReason(""); setStaffMemo(""); setReviewMemo(""); setOtherMemo(""); setCashExpenses([{ classification: "식재료", usage: "쿠팡", detail: "", amount: "" }]); setCardExpenses([{ classification: "식재료", usage: "쿠팡", detail: "", amount: "" }]); localStorage.removeItem(draftKey); initRosterInForm(); setIsEditApproved(true);
                  triggerToast("선택한 날짜의 저장된 마감기록을 삭제하고 새 입력 상태로 초기화했습니다.", "success");
                }}
                id="daily-settle-reset-button"
                className="px-3.5 py-2 bg-amber-100 hover:bg-amber-200 text-black border border-amber-200 rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1"
              >
                ↺ 정산 리셋
              </button>}
              <button
                type="button"
                onClick={() => {
                  triggerToast("마감 정산 날짜를 달력에서 다시 선택해 주십시오.", "error");
                  setShowStatusCalendar(true);
                }}
                className="px-3.5 py-2 bg-red-800 hover:bg-red-900 text-white border border-red-700 rounded-xl transition-colors cursor-pointer flex items-center gap-1"
              >
                📅 날짜 다시 선택하기
              </button>
            </div>
          )}
        </div>
      )}

      {/* Conditional form guard */}
      {hasExistingRecord && !isEditApproved ? (
        <div className="bg-gray-50 border border-dashed border-gray-200 rounded-2xl p-10 text-center flex flex-col items-center justify-center space-y-3 min-h-[250px]" id="edit-mode-locked-placeholder">
          <div className="w-12 h-12 bg-gray-100/80 text-gray-400 rounded-full flex items-center justify-center border border-gray-150">
            <Lock className="w-5 h-5 text-gray-400" />
          </div>
          <div className="space-y-1">
            <h4 className="text-xs font-black text-gray-700">작성 및 편집이 불가능합니다</h4>
            <p className="text-[11px] text-gray-400 max-w-md mx-auto leading-relaxed">
              기록 보호조치를 해제하신 뒤에만 양식 기록이 허용됩니다.<br />
              상단의 빨간색 경고 영역 내 <strong>[✏️ 수정모드로 진행할 것을 승인함]</strong> 단추를 클릭해 주세요.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowStatusCalendar(true);
            }}
            className="px-3.5 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-600 text-xs font-extrabold rounded-lg shadow-2xs transition-colors cursor-pointer"
          >
            달력 다시 열어 날짜 조정하기
          </button>
        </div>
      ) : (
        <>
          {!isHeadOffice && (
            <>
          {/* COMPACT SALES ROW (1 Line) */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4" id="sales-section">
        <h3 className="text-sm font-black text-gray-800 flex items-center gap-2">
          <CircleDollarSign className="w-4 h-4 text-[#2E6DB4]" />
          매출
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4" id="compact-sales-grid">
          {[
            { key: "cardSales" as const, label: "카드매출 (필수)", value: cardSales, setter: setCardSales, req: true, placeholder: "" },
            { key: "cashSales" as const, label: "현금매출 (필수)", value: cashSales, setter: setCashSales, req: true, placeholder: "" },
            { key: undefined, label: "계좌이체매출", value: transferSales, setter: setTransferSales, req: false, placeholder: "" },
            { key: undefined, label: "배달매출", value: deliverySales, setter: setDeliverySales, req: false, placeholder: "" },
            { key: "cashBalance" as const, label: "금고 현금 잔액(필수)", value: cashBalance, setter: setCashBalance, req: true, placeholder: "" }
          ].map((field, idx) => (
            <div key={idx} className="flex flex-col space-y-1.5">
              <span className="text-xs font-semibold text-gray-500">{field.label}</span>
              <input
                type="text"
                value={formatWithCommas(field.value)}
                onChange={(e) => {
                  field.setter(cleanNumeric(e.target.value));
                  if (field.key) clearValidationField(field.key);
                }}
                id={field.key ? `settle-${field.key}-input` : undefined}
                placeholder={field.placeholder}
                className={`w-full px-3 py-2 border text-sm text-right font-mono font-bold rounded-xl bg-gray-50/30 focus:bg-white focus:outline-hidden focus:border-[#2E6DB4] transition-all ${
                  validationErrors && field.key && hasValidationField(field.key) ? "branch-validation-error" : "border-gray-200"
                }`}
              />
            </div>
          ))}
        </div>

        {/* Dynamic Total Sum Card */}
        <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs font-extrabold text-gray-400">네 가지 항목 합계</span>
          <div className="text-right">
            <span className="text-sm font-semibold text-gray-400 mr-2">당일 총매출:</span>
            <span className="text-lg font-black font-mono text-[#2E6DB4] bg-[#D6E4F0]/40 px-3 py-1 rounded-xl">
              {formatNumber(totalSales)}
            </span>
            <span className="text-xs font-bold text-[#2E6DB4] ml-1">원</span>
          </div>
        </div>
      </div>

      {/* EXPENSE TABLES SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" id="expenses-section">
        {/* Cash Expense table */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-gray-800 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" /> 현금 지출 내역
            </h3>
            <span className="text-xs font-extrabold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg">
              합계: {formatNumber(cashExpensesSum)} 원
            </span>
          </div>

          <div className="space-y-3 max-h-[290px] overflow-y-auto pr-1">
            {cashExpenses.map((exp, idx) => (
              <div key={idx} className="p-3 bg-gray-50 border border-gray-100 rounded-xl space-y-2 relative">
                <button
                  onClick={() => removeExpenseRow("cash", idx)}
                  className="absolute top-2 right-2 text-gray-400 hover:text-rose-500 p-1 rounded-lg transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                <div className="grid grid-cols-2 gap-2 mt-1">
                  <div className="flex flex-col space-y-1">
                    <span className="text-[10px] font-bold text-gray-400">지출 분류</span>
                    <select
                      value={exp.classification}
                      onChange={(e) => updateExpenseField("cash", idx, "classification", e.target.value as any)}
                      className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold bg-white"
                    >
                      {["식재료", "소모품등 기타", "부식비", "음료", "현금입금"].map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                  {exp.classification !== "현금입금" && <div className="flex flex-col space-y-1">
                    <span className="text-[10px] font-bold text-gray-400">사용처</span>
                    <select
                      value={exp.usage}
                      onChange={(e) => updateExpenseField("cash", idx, "usage", e.target.value as any)}
                      className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold bg-white"
                    >
                      {["쿠팡", "네이버", "인근매장", "그외기타", "현금입금"].map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </div>}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2 flex flex-col space-y-1">
                    <span className="text-[10px] font-bold text-gray-400">지출 상세 내용</span>
                    <input
                      type="text"
                      placeholder="구체적 명세 기록"
                      value={exp.detail}
                      onChange={(e) => updateExpenseField("cash", idx, "detail", e.target.value)}
                      className="px-2.5 py-1 border border-gray-200 rounded-lg text-xs bg-white"
                    />
                  </div>
                  <div className="flex flex-col space-y-1">
                    <span className="text-[10px] font-bold text-gray-400">금액</span>
                    <input
                      type="text"
                      placeholder="금액(원)"
                      value={formatWithCommas(exp.amount)}
                      onChange={(e) => {
                        updateExpenseField("cash", idx, "amount", cleanNumeric(e.target.value));
                      }}
                      className="px-2.5 py-1 border border-gray-200 rounded-lg text-xs text-right font-mono bg-white"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => addExpenseRow("cash")}
            className="w-full py-2 bg-gray-50 hover:bg-gray-100 border border-dashed border-gray-200 font-bold text-xs text-gray-500 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> 개별 현금지출 행 추가
          </button>
        </div>

        {/* Card Expense table */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-gray-800 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500" /> 카드 지출 내역
            </h3>
            <span className="text-xs font-extrabold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-lg">
              합계: {formatNumber(cardExpensesSum)} 원
            </span>
          </div>

          <div className="space-y-3 max-h-[290px] overflow-y-auto pr-1">
            {cardExpenses.map((exp, idx) => (
              <div key={idx} className="p-3 bg-gray-50 border border-gray-100 rounded-xl space-y-2 relative">
                <button
                  onClick={() => removeExpenseRow("card", idx)}
                  className="absolute top-2 right-2 text-gray-400 hover:text-rose-500 p-1 rounded-lg transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                <div className="grid grid-cols-2 gap-2 mt-1">
                  <div className="flex flex-col space-y-1">
                    <span className="text-[10px] font-bold text-gray-400">지출 분류</span>
                    <select
                      value={exp.classification}
                      onChange={(e) => updateExpenseField("card", idx, "classification", e.target.value as any)}
                      className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold bg-white"
                    >
                      {["식재료", "소모품등 기타", "부식비", "음료", "현금입금"].map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col space-y-1">
                    <span className="text-[10px] font-bold text-gray-400">사용처</span>
                    <select
                      value={exp.usage}
                      onChange={(e) => updateExpenseField("card", idx, "usage", e.target.value as any)}
                      className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold bg-white"
                    >
                      {["쿠팡", "네이버", "인근매장", "그외기타", "현금입금"].map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2 flex flex-col space-y-1">
                    <span className="text-[10px] font-bold text-gray-400">지출 상세 내용</span>
                    <input
                      type="text"
                      placeholder="구체적 명세 기록"
                      value={exp.detail}
                      onChange={(e) => updateExpenseField("card", idx, "detail", e.target.value)}
                      className="px-2.5 py-1 border border-gray-200 rounded-lg text-xs bg-white"
                    />
                  </div>
                  <div className="flex flex-col space-y-1">
                    <span className="text-[10px] font-bold text-gray-400">금액</span>
                    <input
                      type="text"
                      placeholder="금액(원)"
                      value={formatWithCommas(exp.amount)}
                      onChange={(e) => {
                        updateExpenseField("card", idx, "amount", cleanNumeric(e.target.value));
                      }}
                      className="px-2.5 py-1 border border-gray-200 rounded-lg text-xs text-right font-mono bg-white"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => addExpenseRow("card")}
            className="w-full py-2 bg-gray-50 hover:bg-gray-100 border border-dashed border-gray-200 font-bold text-xs text-gray-500 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> 개별 카드지출 행 추가
          </button>
        </div>
      </div>

      {/* CASH SETTLE/CLOSING SECTION (현금마감) */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4" id="cash-closing-section">
        <h3 className="text-sm font-black text-gray-800 flex items-center gap-2">
          <Coins className="w-4 h-4 text-[#2E6DB4]" />
          현금마감 정산 (시재 일치 점검)
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-zinc-50/50 p-5 rounded-2xl border border-gray-150">
          {/* 전일현금 */}
          <div className="flex flex-col space-y-1.5 bg-white p-3 rounded-xl border border-gray-100">
            <span className="text-[11px] font-bold text-gray-400">전일현금 (이월현금) [자동조회]</span>
            <div className="py-1.5 text-right font-mono font-black text-xs text-gray-700">
              {formatNumber(Number(prevDayCash) || 0)} 원
            </div>
          </div>

          {/* 오늘현금매출 */}
          <div className="flex flex-col space-y-1.5 bg-white p-3 rounded-xl border border-gray-100">
            <span className="text-[11px] font-bold text-gray-400">오늘 현금매출 (+)</span>
            <div className="py-1.5 text-right font-mono font-black text-xs text-gray-700">
              {formatNumber(Number(cashSales) || 0)} 원
            </div>
          </div>

          {/* 오늘현금지출 */}
          <div className="flex flex-col space-y-1.5 bg-white p-3 rounded-xl border border-gray-100">
            <span className="text-[11px] font-bold text-gray-400">오늘 현금지출 (-)</span>
            <div className="py-1.5 text-right font-mono font-black text-xs text-rose-500">
              {formatNumber(cashExpensesSum)} 원
            </div>
          </div>

          {/* 오늘계좌이체 */}
          <div className="flex flex-col space-y-1.5 bg-white p-3 rounded-xl border border-gray-100">
            <span className="text-[11px] font-bold text-gray-400">오늘 계좌이체</span>
            <div className="py-1.5 text-right font-mono font-black text-xs text-gray-600">
              {formatNumber(Number(transferSales) || 0)} 원
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-[#F8FAFC] p-4 rounded-xl border border-dotted border-gray-200">
          {/* 이론상잔액 */}
          <div className="flex items-center justify-between px-3 py-2 bg-white rounded-lg border border-gray-100 font-bold">
            <span className="text-xs font-bold text-gray-500">이론상 잔액</span>
            <span className="text-sm font-extrabold font-mono text-gray-800">
              {formatNumber((Number(prevDayCash) || 0) + (Number(cashSales) || 0) - cashExpensesSum)} 원
            </span>
          </div>

          {/* 금고실사현금 (실제) */}
          <div className="flex items-center justify-between px-3 py-2 bg-white rounded-lg border border-gray-100 font-bold">
            <span className="text-xs font-bold text-[#2E6DB4]">금고실사현금 (매출 입력란 기준)</span>
            <span className="text-sm font-extrabold font-mono text-[#2E6DB4]">
              {formatNumber(Number(cashBalance) || 0)} 원
            </span>
          </div>

          {/* 차이 */}
          <div className="flex items-center justify-between px-3 py-2 bg-white rounded-lg border border-gray-100 font-bold">
            <span className="text-xs font-bold text-gray-500">차이 (실사 - 이론)</span>
            {(() => {
              const theory = (Number(prevDayCash) || 0) + (Number(cashSales) || 0) - cashExpensesSum;
              const actual = Number(cashBalance) || 0;
              const diffVal = actual - theory;
              if (diffVal === 0) {
                return (
                  <span className="text-xs font-black text-emerald-600 flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5 animate-pulse" /> 0원 (일치)
                  </span>
                );
              } else if (diffVal > 0) {
                return (
                  <span className="text-xs font-black text-indigo-600">
                    +{formatNumber(diffVal)} 원 (과잉)
                  </span>
                );
              } else {
                return (
                  <span className="text-xs font-black text-rose-600">
                    {formatNumber(diffVal)} 원 (부족)
                  </span>
                );
              }
            })()}
          </div>
        </div>

        {/* 차이 사유 기입 피드백 */}
        {(() => {
          const theory = (Number(prevDayCash) || 0) + (Number(cashSales) || 0) - cashExpensesSum;
          const actual = Number(cashBalance) || 0;
          const diffVal = actual - theory;
          if (diffVal !== 0) {
            return (
              <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200/60 space-y-2">
                <div className="flex items-center gap-1.5 text-xs text-amber-800 font-extrabold">
                  <span className="text-base">⚠️</span>
                  <span>이론상 잔액과 금고 실사 현금이 일치하지 않습니다. 불일치 사유를 아래에 아주 자세히 기재해주십시오.</span>
                </div>
                <textarea
                  placeholder="예: 카드 단말기 오취소 후 현금 재결제 처리, 혹은 거스름돈 착오로 인한 시재 부족 발생 등 사유 기록"
                  value={cashDiffReason}
                  onChange={(e) => {
                    setCashDiffReason(e.target.value);
                    clearValidationField("cashDiffReason");
                  }}
                  id="settle-cash-diff-reason"
                  className={`w-full p-2.5 bg-white border rounded-xl text-xs font-semibold focus:outline-hidden leading-relaxed resize-none h-16 transition-all ${
                    validationErrors && hasValidationField("cashDiffReason")
                      ? "branch-validation-error"
                      : "border-gray-200 focus:border-amber-400"
                  }`}
                />
              </div>
            );
          }
          return null;
        })()}
      </div>
            </>
          )}

      {/* STAFF HOURS TABLE SECTION */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4" id="staff-attendance-section">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
          <div>
            <h3 className="text-sm font-black text-gray-800 flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#2E6DB4]" />
              근무자
            </h3>
            {isHeadOffice && (
              <p className="text-[11px] text-gray-400 mt-1 leading-normal">
                본사 직원별 오늘 업무시간과 업무내용을 기록하고, 쉬는 날은 휴무로 체크합니다.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-[#F8F6A8] px-5 py-4 text-sm leading-relaxed text-zinc-900 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-lg" aria-hidden="true">⚠️</span>
            <div className="space-y-1">
              <p className="font-black">전체 직원 목록이 보여도 실제로 일한 직원만 출근/퇴근 시간을 작성하면 됩니다.</p>
              <p className="text-xs font-bold text-zinc-700">근무하지 않은 직원은 비워두거나 삭제하지 않아도 됩니다. <span className="font-black text-zinc-950">시간은 숫자만 입력해도 자동 변환됩니다.</span> 예: <span className="font-black text-zinc-950">13</span> 입력 시 <span className="font-black text-zinc-950">13:00</span>으로 인식</p>
            </div>
          </div>
        </div>

        {/* Inline Employee Field Addition Block */}
        <div className="space-y-2 bg-zinc-50 p-3 rounded-xl border border-gray-150 text-xs">
          {staffAddDrafts.map((draft, draftIndex) => (
            <div key={draft.id} className="flex flex-wrap items-center gap-2">
              <span className="font-extrabold text-zinc-800 w-8">추가</span>
              <input type="text" placeholder="이름" value={draft.name} onChange={(e) => updateStaffAddDraft(draft.id, { name: e.target.value })} className="w-24 px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:border-zinc-800 focus:outline-hidden font-bold" />
              <select value={draft.division} onChange={(e) => updateStaffAddDraft(draft.id, { division: e.target.value as "정직원" | "파트타이머" })} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white font-extrabold cursor-pointer">
                <option value="정직원">정직원</option>
                <option value="파트타이머">파트타이머</option>
              </select>
              <select value={draft.addReason} onChange={(e) => updateStaffAddDraft(draft.id, { addReason: parseStaffAddReasonChoice(e.target.value) })} className={`w-32 px-2 py-1.5 text-xs ${getAddReasonChoiceClass(draft.addReason)}`}>
                <option value="">선택</option>
                <option value="신규입사">신규입사</option>
                <option value="지점이동">지점이동</option>
                <option value="기존직원">기존직원</option>
                <option value="기타">기타</option>
              </select>
              {staffAddDrafts.length > 1 && (
                <button type="button" onClick={() => setStaffAddDrafts((current) => current.filter((item) => item.id !== draft.id))} className="px-2 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-rose-600 font-black">삭제</button>
              )}
              {draftIndex === staffAddDrafts.length - 1 && (
                <button type="button" onClick={() => setStaffAddDrafts((current) => [...current, createStaffAddDraft()])} className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-zinc-700 font-black hover:bg-gray-100">행 추가</button>
              )}
            </div>
          ))}
          <div className="flex justify-end">
            <button type="button" onClick={registerStaffAddDrafts} className="px-4 py-1.5 bg-zinc-800 hover:bg-black text-white font-black rounded-lg cursor-pointer transition-colors">입력한 행 등록</button>
          </div>
        </div>

        {isHeadOffice && (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[1160px]">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400 font-bold">
                  <th className="py-3 px-2 w-20">이름</th>
                  <th className="py-3 px-2 w-36">근무지점</th>
                  <th className="py-3 px-2 w-24 text-center">휴무</th>
                  <th className="py-3 px-1 w-16">기준</th>
                  <th className="py-3 px-2 w-24">업무시작</th>
                  <th className="py-3 px-2 w-24">업무마감</th>
                  <th className="py-3 px-1 w-14 text-right">근무</th>
                  <th className="py-3 px-1 w-14 text-right">초과</th>
                  <th className="py-3 px-2 min-w-[280px]">업무내용</th>
                  <th className="py-3 px-2 w-44">초과 사유</th>
                  <th className="py-3 px-2 w-10 text-center">삭제</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium">
                {staffRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-10 text-center text-gray-400">
                      등록된 본사 직원이 없습니다. 추가 입력을 통해 인원을 생성해주세요.
                    </td>
                  </tr>
                ) : (
                  staffRows.map((s, idx) => {
                    const isDayOff = s.officeWorkType === "휴무";
                    const segmentKey = s.residentNumber || s.name;
                    const firstSegmentIndex = staffRows.findIndex((row) => (row.residentNumber || row.name) === segmentKey);
                    const isExtraSegment = firstSegmentIndex !== -1 && firstSegmentIndex !== idx;
                    const needsWork = hasOfficeWorkTarget(s, idx) && !isDayOff && (!(Number(s.workHours) > 0) || !s.clockIn || !s.clockOut || !String(s.officeTaskMemo || "").trim() || !String(s.officeWorkplace || "").trim());
                    return (
                      <tr key={idx} id={`office-work-row-${idx}`} className="hover:bg-gray-50/50">
                        {isExtraSegment ? (
                          <td colSpan={4} className="py-3.5 px-2 bg-slate-50/60 border-r border-slate-100" aria-label={`${s.name} 추가 근무구간`} />
                        ) : (
                        <>
                        <td className="py-3.5 px-2 font-bold text-gray-800 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span>{s.name}</span>
                            <button
                              type="button"
                              onClick={() => addOfficeWorkSegment(idx)}
                              className="whitespace-nowrap rounded-lg border border-blue-100 bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-100"
                            >
                              행 추가
                            </button>
                          </div>
                        </td>
                        <td className="py-3.5 px-2">
                          <select
                            disabled={isDayOff}
                            value={s.officeWorkplace || branchName}
                            onChange={(e) => {
                              clearStaffValidationTarget("officeWorkRows", s, idx);
                              executeStaffCalculation(idx, { officeWorkplace: e.target.value, officeWorkType: "근무" });
                            }}
                            className={`w-32 px-2 py-1.5 border rounded-lg bg-white text-xs font-bold disabled:bg-gray-100 ${
                              needsWork && !String(s.officeWorkplace || "").trim() ? "branch-validation-error" : "border-gray-200"
                            }`}
                          >
                            <option value="본사">본사</option>
                            {transferBranchList.map((branch: any) => <option key={branch.branchName} value={branch.branchName}>{branch.branchName}</option>)}
                          </select>
                        </td>
                        <td className="py-3.5 px-2 text-center">
                          <label className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-black text-gray-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isDayOff}
                              onChange={(e) => {
                                clearStaffValidationTarget("officeWorkRows", s, idx);
                                executeStaffCalculation(idx, { officeWorkType: e.target.checked ? "휴무" : "근무" });
                              }}
                              className="h-3.5 w-3.5 accent-[#2E6DB4]"
                            />
                            휴무
                          </label>
                        </td>
                        <td className="py-3.5 px-1">
                          <select
                            disabled={isDayOff}
                            value={String(s.standardHours)}
                            onChange={(e) => {
                              clearStaffValidationTarget("officeWorkRows", s, idx);
                              executeStaffCalculation(idx, { standardHours: Number(e.target.value), officeWorkType: "근무" });
                            }}
                            className="w-14 px-1 py-1.5 border border-gray-200 rounded-lg bg-white font-mono text-xs font-bold disabled:bg-gray-100"
                          >
                            <option value="0">0h</option>
                            <option value="8">8h</option>
                            <option value="9">9h</option>
                            <option value="10">10h</option>
                            <option value="10.5">10.5h</option>
                          </select>
                        </td>
                        </>
                        )}
                        <td className="py-3.5 px-2">
                          <input
                            type="text"
                            disabled={isDayOff}
                            value={s.clockIn}
                            onChange={(e) => {
                              clearStaffValidationTarget("officeWorkRows", s, idx);
                              executeStaffCalculation(idx, { clockIn: e.target.value, officeWorkType: "근무" });
                            }}
                            onBlur={(e) => normalizeTimeInput(idx, "clockIn", e.target.value)}
                            placeholder="09:00"
                            id={`staff-time-${idx}-clockIn`}
                            className={`w-20 px-2 py-1.5 border rounded-lg font-mono text-xs disabled:bg-gray-100 ${timeErrors[`${idx}-clockIn`] ? "branch-validation-error" : "border-gray-200"}`}
                          />
                        </td>
                        <td className="py-3.5 px-2">
                          <input
                            type="text"
                            disabled={isDayOff}
                            value={s.clockOut}
                            onChange={(e) => {
                              clearStaffValidationTarget("officeWorkRows", s, idx);
                              executeStaffCalculation(idx, { clockOut: e.target.value, officeWorkType: "근무" });
                            }}
                            onBlur={(e) => normalizeTimeInput(idx, "clockOut", e.target.value)}
                            placeholder="18:00"
                            id={`staff-time-${idx}-clockOut`}
                            className={`w-20 px-2 py-1.5 border rounded-lg font-mono text-xs disabled:bg-gray-100 ${timeErrors[`${idx}-clockOut`] ? "branch-validation-error" : "border-gray-200"}`}
                          />
                        </td>
                        <td className="py-3.5 px-1 text-right font-mono font-black text-sky-700 relative">
                          {s.workHours || 0}h
                          {s.workHours > 13 && <span className="absolute z-10 right-0 top-10 whitespace-nowrap rounded bg-rose-600 px-2 py-1 text-[10px] font-bold text-white shadow">근무시간이 맞는지 확인해 주세요.</span>}
                        </td>
                        <td className="py-3.5 px-1 text-right font-mono font-black">
                          <span className={s.overtime > 0 ? "text-emerald-600" : s.overtime < 0 ? "text-rose-500" : "text-gray-400"}>
                            {s.overtime > 0 ? "+" : ""}{s.overtime || 0}h
                          </span>
                        </td>
                        <td className="py-3.5 px-2">
                          <input
                            type="text"
                            disabled={isDayOff}
                            value={s.officeTaskMemo || ""}
                            onChange={(e) => {
                              clearStaffValidationTarget("officeWorkRows", s, idx);
                              executeStaffCalculation(idx, { officeTaskMemo: e.target.value, officeWorkType: "근무" });
                            }}
                            placeholder={isDayOff ? "휴무" : "오늘 진행한 업무내용"}
                            className={`w-full px-3 py-1.5 border rounded-lg text-xs disabled:bg-gray-100 disabled:text-gray-400 ${
                              needsWork && !String(s.officeTaskMemo || "").trim() ? "branch-validation-error" : "border-gray-200"
                            }`}
                          />
                        </td>
                        <td className="py-3.5 px-2">
                          <input
                            type="text"
                            disabled={isDayOff || !needsOvertimeReason(s)}
                            value={s.overtimeReason}
                            onChange={(e) => {
                              clearStaffValidationTarget("overtimeReasonRows", s, idx);
                              executeStaffCalculation(idx, { overtimeReason: e.target.value });
                            }}
                            placeholder={needsOvertimeReason(s) ? "초과/조기 사유" : "사유 불필요"}
                            id={`staff-overtime-reason-${idx}`}
                            className={`w-full px-2 py-1.5 border rounded-lg text-xs disabled:bg-gray-100 disabled:text-gray-400 ${
                              hasOvertimeReasonTarget(s, idx) ? "branch-validation-error" : "border-gray-200"
                            }`}
                          />
                        </td>
                        <td className="py-3.5 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => setStaffRows(prev => prev.filter((_, i) => i !== idx))}
                            className="text-gray-400 hover:text-rose-500 p-1.5 hover:bg-rose-50 rounded-lg transition-all cursor-pointer inline-flex items-center justify-center"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-xs font-black text-slate-800">하루 합산 초과/조기퇴근 내역</h4>
              <span className="text-[10px] font-bold text-slate-400">동일 직원의 추가 근무구간을 합산합니다.</span>
            </div>
            {headOfficeDailyOvertimeRows.length === 0 ? (
              <p className="text-xs font-bold text-slate-400">근무시간 입력 후 합산 내역이 표시됩니다.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {headOfficeDailyOvertimeRows.map((row) => (
                  <span key={row.name} className={`rounded-xl border px-3 py-2 text-xs font-black ${
                    row.overtime > 0
                      ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                      : row.overtime < 0
                        ? "border-rose-100 bg-rose-50 text-rose-700"
                        : "border-slate-200 bg-white text-slate-500"
                  }`}>
                    {row.name} 근무 {Number(row.workHours.toFixed(1))}h / 기준 {row.standardHours}h / {row.overtime > 0 ? "+" : ""}{Number(row.overtime.toFixed(1))}h{row.overtime < 0 ? " 조기퇴근" : row.overtime > 0 ? " 초과" : ""}
              </span>
            ))}
            </div>
          )}
        </div>
          </>
        )}

        {!isHeadOffice && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400 font-bold">
                <th className="py-3 px-2">이름 (성명)</th>
                <th className="py-3 px-2">계약 구분</th>
                <th className="py-3 px-2">기준 한도시간</th>
                <th className="py-3 px-2">출근 시간</th>
                <th className="py-3 px-2">퇴근 시간</th>
                <th className="py-3 px-2">실 근무 시간</th>
                <th className="py-3 px-2">초과 시간</th>
                <th className="py-3 px-2 max-w-[200px]">초과 상세 사유 (오버타임 필요기입)</th>
                <th className="py-3 px-2 w-10 text-center">삭제</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-medium">
              {staffRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-gray-400">
                    등록된 지점 직원이 없습니다. 추가 입력을 통해 인원을 생성해주세요.
                  </td>
                </tr>
              ) : (
                staffRows.map((s, idx) => {
                  const hasOvertimeDelta = needsOvertimeReason(s);
                  const hasWorkTime = Boolean(s.clockIn && s.clockOut && (s.clockIn !== "00:00" || s.clockOut !== "00:00"));

                  return (
                    <tr key={idx} className="hover:bg-gray-50/50">
                      {/* Name */}
                      <td className="py-3.5 px-2 font-bold text-gray-800">{s.name}</td>

                      {/* Division Dropdown */}
                      <td className="py-3.5 px-2 relative">
                        <select
                          value={s.division}
                          onChange={(e) => {
                            const div = e.target.value as "정직원" | "파트타이머";
                            // For Part timer, default standardHours is 0
                            const std = div === "파트타이머" ? 0 : defaultStandardHours;
                            executeStaffCalculation(idx, { division: div, standardHours: std });
                          }}
                          className={`branch-division-select px-2 py-1.5 rounded-lg font-bold text-[11px] border ${hasWorkTime ? s.division === "정직원" ? "branch-division-active-fulltime bg-amber-50 text-amber-700 border-amber-200" : "branch-division-active-parttime bg-blue-50 text-blue-700 border-blue-200" : "branch-division-idle bg-white text-gray-600 border-gray-200"}`}
                        >
                          <option value="정직원">정직원</option>
                          <option value="파트타이머">파트타이머</option>
                        </select>
                      </td>

                      {/* Standard Criterion Hours Dropdown */}
                      <td className="py-3.5 px-2">
                        {s.division === "파트타이머" ? (
                          <span className="branch-parttime-standard-hours inline-block py-1.5 px-3 bg-gray-100 text-gray-400 font-mono text-center font-bold rounded-lg min-w-[75px]">
                            0h
                          </span>
                        ) : (
                          <select
                            value={String(s.standardHours)}
                            onChange={(e) => {
                              executeStaffCalculation(idx, { standardHours: Number(e.target.value) });
                            }}
                            className="branch-standard-hours-select px-2 py-1.5 border border-[#2E6DB4]/30 rounded-lg bg-white font-mono font-bold text-[11px] min-w-[75px] text-[#2E6DB4]"
                          >
                            <option value="0">0 (휴무)</option>
                            <option value="9">9 시간</option>
                            <option value="10">10 시간</option>
                            <option value="10.5">10.5 시간</option>
                          </select>
                        )}
                      </td>

                      {/* Clock In */}
                      <td className="py-3.5 px-2">
                        <input
                          type="text"
                          value={s.clockIn}
                          onChange={(e) => executeStaffCalculation(idx, { clockIn: e.target.value })}
                          onBlur={(e) => normalizeTimeInput(idx, "clockIn", e.target.value)}
                          placeholder="00:00"
                          id={`staff-time-${idx}-clockIn`}
                          className={`branch-time-input w-16 px-1.5 py-1.5 border rounded-lg font-mono bg-white text-[11px] ${hasWorkTime ? "branch-time-filled" : ""} ${timeErrors[`${idx}-clockIn`] ? "branch-validation-error" : "border-gray-200"}`}
                        />
                        {timeErrors[`${idx}-clockIn`] && <span className="absolute z-10 left-2 top-10 whitespace-nowrap rounded bg-rose-600 px-2 py-1 text-[10px] font-bold text-white shadow">{timeErrors[`${idx}-clockIn`]}</span>}
                      </td>

                      {/* Clock Out */}
                      <td className="py-3.5 px-2 relative">
                        <input
                          type="text"
                          value={s.clockOut}
                          onChange={(e) => executeStaffCalculation(idx, { clockOut: e.target.value })}
                          onBlur={(e) => normalizeTimeInput(idx, "clockOut", e.target.value)}
                          placeholder="00:00"
                          id={`staff-time-${idx}-clockOut`}
                          className={`branch-time-input w-16 px-1.5 py-1.5 border rounded-lg font-mono bg-white text-[11px] ${hasWorkTime ? "branch-time-filled" : ""} ${timeErrors[`${idx}-clockOut`] ? "branch-validation-error" : "border-gray-200"}`}
                        />
                        {timeErrors[`${idx}-clockOut`] && <span className="absolute z-10 left-2 top-10 whitespace-nowrap rounded bg-rose-600 px-2 py-1 text-[10px] font-bold text-white shadow">{timeErrors[`${idx}-clockOut`]}</span>}
                      </td>

                      {/* Work Hours calculated */}
                        <td className="py-3.5 px-2 font-mono font-bold text-gray-600 relative">
                        <span className={`py-1 px-2.5 rounded-md ${s.workHours > 0 ? "bg-sky-100 text-sky-700" : "bg-gray-100 text-gray-600"}`}>
                          {s.workHours} h
                        </span>
                        {s.workHours > 13 && <span className="absolute z-10 left-0 top-10 whitespace-nowrap rounded bg-rose-600 px-2 py-1 text-[10px] font-bold text-white shadow">근무시간이 맞는지 확인해 주세요.</span>}
                      </td>

                      {/* Overtime (over / deficit) */}
                      <td className="py-3.5 px-2">
                        {s.overtime > 0 ? (
                          <span className="branch-overtime-chip branch-overtime-positive py-1 px-2 bg-emerald-50 text-emerald-600 font-mono font-black rounded-md">
                            +{s.overtime} h
                          </span>
                        ) : s.overtime < 0 ? (
                          <span className="branch-overtime-chip branch-overtime-negative py-1 px-2 bg-rose-50 text-rose-500 font-mono font-black rounded-md">
                            {s.overtime} h
                          </span>
                        ) : (
                          <span className="branch-overtime-chip branch-overtime-zero py-1 px-2 bg-gray-100 text-gray-400 font-mono font-bold rounded-md">
                            0 h
                          </span>
                        )}
                      </td>

                      {/* Overtime Reason */}
                      <td className="py-3.5 px-2 max-w-[200px]">
                        <input
                          type="text"
                          value={s.overtimeReason}
                          onChange={(e) => {
                            clearStaffValidationTarget("overtimeReasonRows", s, idx);
                            executeStaffCalculation(idx, { overtimeReason: e.target.value });
                          }}
                          disabled={!hasOvertimeDelta}
                          placeholder={hasOvertimeDelta ? "상세 사유 필수 입력" : "사유 불필요"}
                          id={`staff-overtime-reason-${idx}`}
                          className={`w-full px-2 py-1.5 border rounded-lg text-xs transition-all ${
                            hasOvertimeDelta
                              ? hasOvertimeReasonTarget(s, idx) ? "branch-validation-error" : "bg-white border-amber-300 focus:border-amber-500"
                              : "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed"
                          }`}
                        />
                      </td>

                      {/* Deletion control */}
                      <td className="py-3.5 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            setStaffRows(prev => prev.filter((_, i) => i !== idx));
                          }}
                          className="text-gray-400 hover:text-rose-500 p-1.5 hover:bg-rose-50 rounded-lg transition-all cursor-pointer inline-flex items-center justify-center"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* ADDITIONAL FREE NOTES */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4" id="memo-section">
        <label className="text-xs font-extrabold text-[#1C3C6E] flex items-center gap-1.5 border-b border-gray-100 pb-2">
          <FileText className="w-4 h-4 text-[#2E6DB4]" />
          {isHeadOffice ? "본사 특이사항 기록" : "특이사항 기록 (본부 보고 및 카톡보고 자동 연동)"}
        </label>

        {!isHeadOffice && <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-600 block">
              👤 직원 특이사항
            </label>
            <textarea
              value={staffMemo}
              onChange={(e) => setStaffMemo(e.target.value)}
              placeholder="예: 임성훈 파트타이머 30분 지각 응대 지침 교육함"
              rows={3}
              className="w-full p-3 border border-gray-200 rounded-xl text-xs focus:outline-hidden focus:border-zinc-800 transition-all bg-gray-50/20"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-600 block">
              ⭐ 리뷰 특이사항
            </label>
            <textarea
              value={reviewMemo}
              onChange={(e) => setReviewMemo(e.target.value)}
              placeholder="예: 네이버 예약 리뷰 5개 작성 완료, 기계 소음 피드백 조치 바람"
              rows={3}
              className="w-full p-3 border border-gray-200 rounded-xl text-xs focus:outline-hidden focus:border-zinc-800 transition-all bg-gray-50/20"
            />
          </div>
        </div>}

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-gray-600 flex flex-wrap items-center gap-2">
            <span>{isHeadOffice ? "기타 전달 메모" : "📝 기타 전달 메모"}</span>
            {!isHeadOffice && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700 ring-1 ring-amber-100">
                ERP 오류·개선 제안은 여기에 남겨주세요
              </span>
            )}
          </label>
          <textarea
            value={otherMemo}
            onChange={(e) => setOtherMemo(e.target.value)}
            placeholder={isHeadOffice ? "그 외 전달할 내용을 적어주세요." : "예: 일일마감 저장 오류, 화면 사용 중 불편한 점, 추가되면 좋을 기능 등을 적어주세요. 카톡 보고에는 포함되지 않습니다."}
            rows={2}
            className="w-full p-3 border border-amber-200 rounded-xl text-xs focus:outline-hidden focus:border-amber-500 transition-all bg-amber-50/20"
          />
        </div>
      </div>

      {/* FINAL SUBMIT ACTION ROW */}
      <div className="flex gap-4 items-center justify-end pt-4">
        <button
          onClick={handleSettleSubmit}
          disabled={submitting}
          className="px-8 py-4 bg-[#2E6DB4] hover:bg-[#1A3C6E] disabled:bg-gray-300 text-white font-extrabold text-sm rounded-2xl cursor-pointer shadow-md select-none transition-colors duration-150 flex items-center gap-2"
          id="btn-settle-final-submit"
        >
          {submitting ? (
            <>
              <LoadingSpinner size="sm" light={true} />
              <span>저장 중...</span>
            </>
          ) : (
            <>
              마감 제출 <CheckCircle className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
      {submitting && (
        <p className="mt-3 text-right text-xs font-semibold text-slate-500" role="status" aria-live="polite">
          {submissionDelayNotice
            ? "저장 처리가 길어지고 있습니다. 화면을 닫거나 새로고침하지 말고 잠시만 기다려 주세요."
            : "마감 내역을 저장하고 있습니다. 화면을 닫거나 새로고침하지 말아 주세요."}
        </p>
      )}
    </>
    )}
  </div>
);
}

function OfficeWorkLogTab({ branchName }: { branchName: string }) {
  const [month, setMonth] = useState(() => toLocalMonthInputValue());
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  const compactTimeRange = (clockIn: string, clockOut: string) => {
    const compact = (value: string) => {
      const text = String(value || "").trim();
      if (!text || text === "00:00") return "";
      return text.endsWith(":00") ? text.slice(0, 2).replace(/^0/, "") : text.replace(/^0/, "");
    };
    const start = compact(clockIn);
    const end = compact(clockOut);
    return start && end ? `${start}-${end}` : "";
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const history = await gasClient.getBranchHistory(branchName, month);
      const nextRows: any[] = [];
      history.forEach((record: any) => {
        const metadataText = String(record.memo || "").split("\n---\nMETADATA:")[1];
        if (!metadataText) return;
        try {
          const metadata = JSON.parse(metadataText.trim());
          const sourceStaff = Array.isArray(metadata.staffRows) ? metadata.staffRows : [];
          const calculatedOvertimeByIndex = new Map<number, number>();
          const staffGroups = new Map<string, number[]>();
          sourceStaff.forEach((staff: any, staffIndex: number) => {
            const staffKey = staff.residentNumber || staff.name || `row-${staffIndex}`;
            staffGroups.set(staffKey, [...(staffGroups.get(staffKey) || []), staffIndex]);
          });
          staffGroups.forEach((indexes) => {
            const activeIndexes = indexes.filter((staffIndex) => sourceStaff[staffIndex]?.officeWorkType !== "휴무" && Number(sourceStaff[staffIndex]?.workHours || 0) > 0);
            if (activeIndexes.length === 0) return;
            const standardHours = activeIndexes.reduce((value, staffIndex) => value || Number(sourceStaff[staffIndex]?.standardHours || 0), 0) || 10;
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
          sourceStaff.forEach((staff: any, staffIndex: number) => {
            const storedOvertime = Number(staff.overtime || 0);
            const effectiveOvertime = storedOvertime !== 0 ? storedOvertime : (calculatedOvertimeByIndex.get(staffIndex) || 0);
            nextRows.push({
              id: `${record.recordId || record.settleDate}-${staff.segmentId || staff.name}-${nextRows.length}`,
              date: record.settleDate,
              writer: record.submittedBy || "",
              name: staff.name,
              workplace: staff.officeWorkplace || branchName,
              workType: staff.officeWorkType || (Number(staff.workHours || 0) > 0 ? "근무" : "휴무"),
              clockIn: staff.clockIn || "",
              clockOut: staff.clockOut || "",
              workHours: Number(staff.workHours || 0),
              standardHours: Number(staff.standardHours || 0),
              overtime: effectiveOvertime,
              overtimeReason: staff.overtimeReason || "",
              taskMemo: staff.officeTaskMemo || ""
            });
          });
        } catch (error) {
          console.warn("본사 근무내역 메타데이터 파싱 실패:", error);
        }
      });
      setRows(nextRows.sort((a, b) => String(b.date).localeCompare(String(a.date))));
    } catch (error) {
      console.error("본사 근무내역 로드 실패:", error);
    } finally {
      setLoading(false);
    }
  }, [branchName, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const calendarSummary = useMemo(() => {
    const byDate = new Map<string, any[]>();
    rows.forEach((row) => {
      const current = byDate.get(row.date) || [];
      current.push(row);
      byDate.set(row.date, current);
    });
    const workDates = new Set<string>();
    const offDates = new Set<string>();
    const dispatchDates = new Set<string>();
    byDate.forEach((items, date) => {
      const hasDispatch = items.some((item) => item.workType !== "휴무" && item.workplace && item.workplace !== branchName);
      const hasWork = items.some((item) => item.workType !== "휴무" && Number(item.workHours || 0) > 0);
      const allOff = items.length > 0 && items.every((item) => item.workType === "휴무");
      if (hasDispatch) dispatchDates.add(date);
      if (hasWork) workDates.add(date);
      if (allOff) offDates.add(date);
    });
    return { byDate, workDates, offDates, dispatchDates };
  }, [branchName, rows]);

  const renderWorkCalendar = () => {
    const [year, monthNumber] = month.split("-").map(Number);
    const firstDay = new Date(year, monthNumber - 1, 1).getDay();
    const dayCount = new Date(year, monthNumber, 0).getDate();
    const cells: Array<number | null> = [
      ...Array.from({ length: firstDay }, () => null),
      ...Array.from({ length: dayCount }, (_, index) => index + 1)
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    return (
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-lg bg-sky-50 px-2.5 py-1 text-sky-700">근무 {calendarSummary.workDates.size}일</span>
            <span className="rounded-lg bg-gray-100 px-2.5 py-1 text-gray-600">휴무 {calendarSummary.offDates.size}일</span>
            <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-amber-700">지점파견 {calendarSummary.dispatchDates.size}일</span>
          </div>
          <div className="flex gap-2 text-[11px] font-bold text-gray-500">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" />근무</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gray-400" />휴무</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />지점파견</span>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
            <div key={day} className={`py-2 font-black ${day === "일" ? "text-rose-500" : day === "토" ? "text-blue-500" : "text-gray-400"}`}>{day}</div>
          ))}
          {cells.map((day, index) => {
            if (!day) return <div key={`empty-${index}`} className="min-h-20 rounded-xl bg-gray-50/40" />;
            const date = `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const items = calendarSummary.byDate.get(date) || [];
            const hasDispatch = calendarSummary.dispatchDates.has(date);
            const hasWork = calendarSummary.workDates.has(date);
            const isOff = calendarSummary.offDates.has(date);
            const bg = hasDispatch ? "border-amber-200 bg-amber-50" : hasWork ? "border-sky-200 bg-sky-50" : isOff ? "border-gray-200 bg-gray-100" : "border-gray-100 bg-white";
            return (
              <div key={date} className={`min-h-20 rounded-xl border p-2 text-left ${bg}`}>
                <div className="flex items-center justify-between">
                  <span className="font-black text-gray-800">{day}</span>
                  <div className="flex gap-1">
                    {hasWork && <span className="h-2 w-2 rounded-full bg-sky-500" />}
                    {isOff && <span className="h-2 w-2 rounded-full bg-gray-400" />}
                    {hasDispatch && <span className="h-2 w-2 rounded-full bg-amber-500" />}
                  </div>
                </div>
                {items.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {items.slice(0, 3).map((item, itemIndex) => (
                      <div key={`${date}-${item.name}-${itemIndex}`} className="truncate text-[10px] font-bold text-gray-600">
                        {item.name} {item.workType === "휴무" ? "휴무" : `${item.workplace} ${compactTimeRange(item.clockIn, item.clockOut)}`}
                      </div>
                    ))}
                    {items.length > 3 && <div className="text-[10px] font-black text-gray-400">+{items.length - 3}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-5 animate-fade-in" id="office-work-log-tab">
      <section className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-[#2E6DB4]" /> 본사 근무내역
          </h3>
          <p className="text-xs text-gray-400 mt-1">월별로 본사 직원의 근무시간, 근무지점, 업무내용을 확인합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs font-black" />
          <button type="button" onClick={() => setShowCalendar((value) => !value)} className="px-3 py-2 rounded-xl bg-white border border-gray-200 text-xs font-black text-[#2E6DB4]">
            달력 {showCalendar ? "닫기" : "보기"}
          </button>
          <button type="button" onClick={() => void load()} className="px-3 py-2 rounded-xl bg-zinc-900 text-white text-xs font-black">새로고침</button>
        </div>
      </section>

      {showCalendar && renderWorkCalendar()}

      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500 font-black border-b">
              <tr>
                <th className="p-3 w-28">날짜</th>
                <th className="p-3 w-24">직원</th>
                <th className="p-3 w-32">근무지점</th>
                <th className="p-3 w-20">상태</th>
                <th className="p-3 w-28">시간</th>
                <th className="p-3 w-24 text-right">근무</th>
                <th className="p-3 w-24 text-right">초과</th>
                <th className="p-3">업무내용</th>
                <th className="p-3 w-40">초과 사유</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="p-12 text-center"><LoadingSpinner size="sm" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="p-12 text-center text-gray-400 font-bold">선택한 월의 본사 근무내역이 없습니다.</td></tr>
              ) : rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/60">
                  <td className="p-3 font-mono text-xs text-gray-500">{row.date}</td>
                  <td className="p-3 font-black text-gray-800">{row.name}</td>
                  <td className="p-3 text-xs font-bold text-gray-600">{row.workplace}</td>
                  <td className="p-3">
                    <span className={`rounded-lg px-2 py-1 text-xs font-black ${row.workType === "휴무" ? "bg-gray-100 text-gray-500" : "bg-sky-50 text-sky-700"}`}>{row.workType}</span>
                  </td>
                  <td className="p-3 font-mono text-xs">{row.workType === "휴무" ? "-" : `${row.clockIn}~${row.clockOut}`}</td>
                  <td className="p-3 text-right font-mono font-black text-sky-700">{row.workHours}h</td>
                  <td className={`p-3 text-right font-mono font-black ${row.overtime > 0 ? "text-emerald-600" : row.overtime < 0 ? "text-rose-500" : "text-gray-400"}`}>{row.overtime > 0 ? "+" : ""}{row.overtime}h</td>
                  <td className="p-3 text-gray-700">{row.taskMemo || "-"}</td>
                  <td className="p-3 text-xs text-gray-500">{row.overtimeReason || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ----------------------------------------------------
// TAB 2: Order Management (발주관리)
// ----------------------------------------------------
const ORDER_CATEGORIES: OrderCategory[] = ["식자재", "부식비", "주류", "식음료외 기타"];
const ORDER_DEFAULT_VENDORS: Record<OrderCategory, string[]> = {
  식자재: ["비알(식자재)", "쿠팡(식자재)", "네이버(식자재)"],
  부식비: [],
  주류: [],
  "식음료외 기타": []
};
const LIQUOR_CATEGORIES = ["샴페인", "스파클링", "화이트", "레드", "위스키", "소주", "맥주", "대표님술", "기타"];
const VENDOR_HINT = "줄바꿈 또는 쉼표로 여러 개를 한꺼번에 추가할 수 있습니다.";
const ALL_ORDER_CATEGORIES = "전체";

const getLiquorCategoryClass = (category: string) => {
  const classes: Record<string, string> = {
    샴페인: "bg-amber-50 text-amber-800 border-amber-200",
    스파클링: "bg-cyan-50 text-cyan-800 border-cyan-200",
    화이트: "bg-lime-50 text-lime-800 border-lime-200",
    레드: "bg-rose-50 text-rose-800 border-rose-200",
    위스키: "bg-orange-50 text-orange-800 border-orange-200",
    소주: "bg-blue-50 text-blue-800 border-blue-200",
    맥주: "bg-yellow-50 text-yellow-800 border-yellow-200",
    대표님술: "bg-violet-50 text-violet-800 border-violet-200",
    기타: "bg-slate-100 text-slate-700 border-slate-200"
  };
  return classes[category] || classes.기타;
};

const getOrderCategoryHeaderClass = (category: string) => {
  const classes: Record<string, string> = {
    식자재: "bg-amber-100 text-amber-900 border-amber-300",
    부식비: "bg-teal-100 text-teal-900 border-teal-300",
    주류: "bg-indigo-100 text-indigo-900 border-indigo-300",
    "식음료외 기타": "bg-slate-200 text-slate-800 border-slate-300"
  };
  return classes[category] || "bg-gray-100 text-gray-700 border-gray-300";
};

const monthDays = (monthValue: string) => {
  const [year, month] = monthValue.split("-").map(Number);
  const count = new Date(year, month, 0).getDate();
  return Array.from({ length: count }, (_, index) => String(index + 1).padStart(2, "0"));
};

function OrderManagementTabV2({ branchName }: { branchName: string }) {
  const storageKey = "erp_orders_" + branchName;
  const vendorKey = "erp_order_vendors_" + branchName;
  const sharedOrderKey = "orders:" + branchName;
  const sharedVendorKey = "order_vendors:" + branchName;
  const orderPendingKey = pendingLocalSaveStorageKey(storageKey);
  const vendorPendingKey = pendingLocalSaveStorageKey(vendorKey);
  const orderSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vendorSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [vendorsByCategory, setVendorsByCategory] = useState<Record<OrderCategory, string[]>>(ORDER_DEFAULT_VENDORS);
  const [vendorCategory, setVendorCategory] = useState<OrderCategory>("식자재");
  const [vendorText, setVendorText] = useState("");
  const [reportMonth, setReportMonth] = useState(() => toLocalMonthInputValue());
  const [reportCategory, setReportCategory] = useState<OrderReportCategory>(ALL_ORDER_CATEGORIES);
  const [reportVendor, setReportVendor] = useState("전체");
  const [orderDraftCells, setOrderDraftCells] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const savedOrders = localStorage.getItem(storageKey);
      const savedVendors = localStorage.getItem(vendorKey);
      if (savedOrders) setOrders(JSON.parse(savedOrders));
      if (savedVendors) {
        const parsed = JSON.parse(savedVendors);
        if (Array.isArray(parsed)) {
          setVendorsByCategory({ ...ORDER_DEFAULT_VENDORS, 식자재: Array.from(new Set([...ORDER_DEFAULT_VENDORS.식자재, ...parsed])) });
        } else if (parsed && typeof parsed === "object") {
          setVendorsByCategory({
            식자재: Array.isArray(parsed.식자재) ? parsed.식자재 : ORDER_DEFAULT_VENDORS.식자재,
            부식비: Array.isArray(parsed.부식비) ? parsed.부식비 : [],
            주류: Array.isArray(parsed.주류) ? parsed.주류 : [],
            "식음료외 기타": Array.isArray(parsed["식음료외 기타"]) ? parsed["식음료외 기타"] : []
          });
        }
      }
    } catch (err) {
      console.error("Failed to load order data", err);
    }
  }, [storageKey, vendorKey]);

  const normalizeRemoteOrderVendors = useCallback((value: unknown): Record<OrderCategory, string[]> | null => {
    if (Array.isArray(value)) {
      const firstCategory = ORDER_CATEGORIES[0];
      return {
        ...ORDER_DEFAULT_VENDORS,
        [firstCategory]: Array.from(new Set([...(ORDER_DEFAULT_VENDORS[firstCategory] || []), ...value.filter((item): item is string => typeof item === "string")]))
      };
    }
    if (!value || typeof value !== "object") return null;
    const source = value as Partial<Record<OrderCategory, unknown>>;
    return ORDER_CATEGORIES.reduce((acc, category) => {
      acc[category] = Array.isArray(source[category])
        ? (source[category] as string[]).filter((item) => typeof item === "string")
        : (ORDER_DEFAULT_VENDORS[category] || []);
      return acc;
    }, {} as Record<OrderCategory, string[]>);
  }, []);

  const saveSharedDebounced = useCallback((key: string, value: unknown, timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>, pendingKey: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    localStorage.setItem(pendingKey, "1");
    void gasClient.saveSharedData(key, value)
      .then(() => localStorage.removeItem(pendingKey))
      .catch((error) => {
        console.error("Failed to save shared order data", error);
      });
  }, []);

  const parseJsonArray = useCallback(<T,>(json: string | null): T[] => {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, []);

  const parseVendorJson = useCallback((json: string | null) => {
    if (!json) return null;
    try {
      return normalizeRemoteOrderVendors(JSON.parse(json));
    } catch {
      return null;
    }
  }, [normalizeRemoteOrderVendors]);

  const mergeOrders = useCallback((remoteItems: OrderItem[], localItems: OrderItem[]) => {
    const byCell = new Map<string, OrderItem>();
    [...remoteItems, ...localItems].forEach((item) => {
      if (!item || !item.vendorName || !item.orderDate) return;
      byCell.set(`${item.category}|${item.vendorName}|${item.orderDate}`, item);
    });
    return Array.from(byCell.values());
  }, []);

  const mergeVendorMaps = useCallback((remoteMap: Record<OrderCategory, string[]> | null, localMap: Record<OrderCategory, string[]> | null) => {
    if (!remoteMap && !localMap) return null;
    return ORDER_CATEGORIES.reduce((acc, category) => {
      acc[category] = Array.from(new Set([
        ...(ORDER_DEFAULT_VENDORS[category] || []),
        ...(remoteMap?.[category] || []),
        ...(localMap?.[category] || [])
      ]));
      return acc;
    }, {} as Record<OrderCategory, string[]>);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const localOrdersJson = localStorage.getItem(storageKey);
    const localVendorsJson = localStorage.getItem(vendorKey);

    void Promise.all([
      gasClient.getSharedData<OrderItem[]>(sharedOrderKey),
      gasClient.getSharedData<Record<OrderCategory, string[]>>(sharedVendorKey)
    ]).then(([remoteOrders, remoteVendors]) => {
      if (cancelled) return;
      const localOrders = parseJsonArray<OrderItem>(localOrdersJson);
      const hasPendingOrders = localStorage.getItem(orderPendingKey) === "1" && localOrdersJson !== null;
      const remoteOrderItems = Array.isArray(remoteOrders) ? remoteOrders : null;
      const nextOrders = hasPendingOrders ? localOrders : remoteOrderItems ?? localOrders;
      if (hasPendingOrders || remoteOrderItems !== null || localOrdersJson !== null) {
        setOrders(nextOrders);
        localStorage.setItem(storageKey, JSON.stringify(nextOrders));
        if (hasPendingOrders) {
          void gasClient.saveSharedData(sharedOrderKey, nextOrders)
            .then(() => localStorage.removeItem(orderPendingKey))
            .catch((error) => console.error("Failed to resave pending order data", error));
        }
      }

      const localVendors = parseVendorJson(localVendorsJson);
      const hasPendingVendors = localStorage.getItem(vendorPendingKey) === "1" && localVendors !== null;
      const remoteVendorMap = normalizeRemoteOrderVendors(remoteVendors);
      const normalizedVendors = hasPendingVendors ? localVendors : remoteVendorMap ?? localVendors;
      if (normalizedVendors) {
        setVendorsByCategory(normalizedVendors);
        localStorage.setItem(vendorKey, JSON.stringify(normalizedVendors));
        if (hasPendingVendors || (remoteVendorMap === null && localVendors !== null)) {
          void gasClient.saveSharedData(sharedVendorKey, normalizedVendors)
            .then(() => localStorage.removeItem(vendorPendingKey))
            .catch((error) => console.error("Failed to resave pending order vendors", error));
        }
      }
    }).catch((error) => {
      console.error("Failed to load shared order data", error);
    });

    return () => {
      cancelled = true;
      if (orderSaveTimerRef.current) clearTimeout(orderSaveTimerRef.current);
      if (vendorSaveTimerRef.current) clearTimeout(vendorSaveTimerRef.current);
    };
  }, [mergeOrders, mergeVendorMaps, normalizeRemoteOrderVendors, orderPendingKey, parseJsonArray, parseVendorJson, sharedOrderKey, sharedVendorKey, storageKey, vendorKey, vendorPendingKey]);

  const reportVendors = useMemo(() => {
    const targetCategories = reportCategory === ALL_ORDER_CATEGORIES ? ORDER_CATEGORIES : [reportCategory];
    const names = [
      ...targetCategories.flatMap((category) => vendorsByCategory[category] || []),
      ...orders.filter((order) => targetCategories.includes(order.category)).map((order) => order.vendorName)
    ];
    return Array.from(new Set(names));
  }, [orders, reportCategory, vendorsByCategory]);

  useEffect(() => {
    if (reportVendor !== "전체" && !reportVendors.includes(reportVendor)) setReportVendor("전체");
  }, [reportVendor, reportVendors]);

  const saveVendors = (next: Record<OrderCategory, string[]>) => {
    setVendorsByCategory(next);
    localStorage.setItem(vendorKey, JSON.stringify(next));
    saveSharedDebounced(sharedVendorKey, next, vendorSaveTimerRef, vendorPendingKey);
  };

  const saveOrders = (next: OrderItem[]) => {
    setOrders(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
    saveSharedDebounced(sharedOrderKey, next, orderSaveTimerRef, orderPendingKey);
  };

  const resolveOrderCategory = (vendor: string): OrderCategory => {
    if (reportCategory !== ALL_ORDER_CATEGORIES) return reportCategory;
    const registeredCategory = ORDER_CATEGORIES.find((category) => (vendorsByCategory[category] || []).includes(vendor));
    const existingCategory = orders.find((order) => order.vendorName === vendor)?.category;
    return registeredCategory || existingCategory || "식자재";
  };

  const addVendors = () => {
    const names = vendorText.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    if (names.length === 0) return;
    const next = {
      ...vendorsByCategory,
      [vendorCategory]: Array.from(new Set([...(vendorsByCategory[vendorCategory] || []), ...names]))
    };
    saveVendors(next);
    setVendorText("");
  };

  const deleteVendor = (targetCategory: OrderCategory, targetVendor: string) => {
    if (!window.confirm(targetVendor + " 거래처를 목록에서 삭제할까요? 기존 발주내역은 유지됩니다.")) return;
    const next = {
      ...vendorsByCategory,
      [targetCategory]: (vendorsByCategory[targetCategory] || []).filter((vendor) => vendor !== targetVendor)
    };
    saveVendors(next);
  };

  const cellAmount = (dateKey: string, vendor: string) => {
    const targetCategories = reportCategory === ALL_ORDER_CATEGORIES ? ORDER_CATEGORIES : [reportCategory];
    return orders
      .filter((order) => targetCategories.includes(order.category) && order.orderDate === dateKey && order.vendorName === vendor)
      .reduce((sum, order) => sum + Number(order.amount || 0), 0);
  };

  const updateOrderDraft = (dateKey: string, vendor: string, value: string) => {
    const nextValue = cleanNumeric(value).slice(0, 7);
    const draftKey = dateKey + "|" + vendor;
    setOrderDraftCells((prev) => ({ ...prev, [draftKey]: nextValue }));
    const categoryForCell = resolveOrderCategory(vendor);
    setOrders((currentOrders) => {
      const replaceCategories = reportCategory === ALL_ORDER_CATEGORIES ? ORDER_CATEGORIES : [categoryForCell];
      const kept = currentOrders.filter((order) => !(replaceCategories.includes(order.category) && order.orderDate === dateKey && order.vendorName === vendor));
      const nextOrders = Number(nextValue) > 0
        ? [{
          id: "ord-cell-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
          category: categoryForCell,
          vendorName: vendor,
          amount: nextValue,
          memo: "",
          orderDate: dateKey
        }, ...kept]
        : kept;
      localStorage.setItem(storageKey, JSON.stringify(nextOrders));
      saveSharedDebounced(sharedOrderKey, nextOrders, orderSaveTimerRef, orderPendingKey);
      return nextOrders;
    });
  };

  const filteredOrders = useMemo(() => {
    const targetCategories = reportCategory === ALL_ORDER_CATEGORIES ? ORDER_CATEGORIES : [reportCategory];
    return orders.filter((order) => {
      const sameMonth = String(order.orderDate || "").startsWith(reportMonth);
      const sameCategory = targetCategories.includes(order.category);
      const sameVendor = reportVendor === "전체" || order.vendorName === reportVendor;
      return sameMonth && sameCategory && sameVendor;
    });
  }, [orders, reportCategory, reportMonth, reportVendor]);

  const matrixVendors = reportVendor === "전체" ? reportVendors : [reportVendor];
  const vendorCategoryOf = (vendor: string): OrderCategory => {
    return ORDER_CATEGORIES.find((category) => (vendorsByCategory[category] || []).includes(vendor))
      || orders.find((order) => order.vendorName === vendor)?.category
      || "식자재";
  };
  const categoryHeaderGroups = matrixVendors.reduce<Array<{ category: OrderCategory; span: number }>>((groups, vendor) => {
    const category = vendorCategoryOf(vendor);
    const last = groups[groups.length - 1];
    if (last && last.category === category) {
      last.span += 1;
    } else {
      groups.push({ category, span: 1 });
    }
    return groups;
  }, []);
  const totals = matrixVendors.map((vendor) => filteredOrders.filter((order) => order.vendorName === vendor).reduce((sum, order) => sum + Number(order.amount || 0), 0));
  const monthTotal = totals.reduce((sum, item) => sum + item, 0);

  return (
    <div className="space-y-5" id="orders-tab-view">
      <section className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
        <div>
          <h3 className="text-base font-black text-gray-900 flex items-center gap-2"><ShoppingCart className="w-5 h-5 text-[#2E6DB4]" /> 거래처 추가</h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr_auto] gap-3 items-end">
          <label className="space-y-1 text-xs font-bold text-gray-500">
            <span>대분류</span>
            <select value={vendorCategory} onChange={(e) => setVendorCategory(e.target.value as OrderCategory)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl bg-gray-50 font-extrabold text-gray-800">
              {ORDER_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs font-bold text-gray-500 relative group">
            <span>거래처명</span>
            <textarea value={vendorText} onChange={(e) => setVendorText(e.target.value)} title={VENDOR_HINT} rows={1} placeholder="예: 대정, 크리스탈, 카나와인" className="w-full h-[42px] px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-bold resize-none overflow-y-auto" />
            <span className="pointer-events-none absolute left-0 top-full mt-2 z-20 hidden rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-bold text-white shadow-lg group-focus-within:block">{VENDOR_HINT}</span>
          </label>
          <button type="button" onClick={addVendors} className="h-[42px] px-5 bg-slate-800 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5"><Plus className="w-4 h-4" /> 업체 추가</button>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {(vendorsByCategory[vendorCategory] || []).length === 0 ? (
            <span className="text-xs text-gray-400 font-bold">등록된 거래처가 없습니다.</span>
          ) : (vendorsByCategory[vendorCategory] || []).map((vendor) => (
            <span key={vendor} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-700">
              {vendor}
              <button type="button" onClick={() => deleteVendor(vendorCategory, vendor)} className="text-slate-400 hover:text-rose-600" aria-label={vendor + " 삭제"}><X className="w-3.5 h-3.5" /></button>
            </span>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-gray-100 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-gray-900">발주내역 리포트</h3>
              <p className="text-xs text-gray-400 mt-1">날짜별 칸에 금액을 입력하면 자동 저장됩니다.</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="px-3 py-2 rounded-xl bg-[#2E6DB4]/10 text-[#1A3C6E] text-xs font-black">월 합계 {formatNumber(monthTotal)}원</div>
              <div className="h-[38px] px-4 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-black flex items-center">자동저장</div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-bold" />
            <select value={reportCategory} onChange={(e) => { setReportCategory(e.target.value as OrderReportCategory); setOrderDraftCells({}); }} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-bold bg-white">
              <option value={ALL_ORDER_CATEGORIES}>전체보기</option>
              {ORDER_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select value={reportVendor} onChange={(e) => setReportVendor(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-bold bg-white">
              <option value="전체">전체 거래처</option>
              {reportVendors.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}
            </select>
          </div>
        </div>
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="sticky top-0 z-20 bg-gray-50 text-gray-600 font-black border-b shadow-sm">
              <tr>
                <th rowSpan={2} className="sticky left-0 z-30 bg-gray-50 p-3 w-20 border-r align-middle">일</th>
                {categoryHeaderGroups.map((group, index) => (
                  <th key={`${group.category}-${index}`} colSpan={group.span} className={`p-2 text-center border-r border-b ${getOrderCategoryHeaderClass(group.category)}`}>
                    {group.category}
                  </th>
                ))}
                <th rowSpan={2} className="p-3 min-w-[130px] text-right bg-slate-100 align-middle">일 합계</th>
              </tr>
              <tr>
                {matrixVendors.map((vendor) => {
                  const category = vendorCategoryOf(vendor);
                  return (
                    <th key={vendor} className={`p-2 min-w-[92px] text-center border-r border-b ${getOrderCategoryHeaderClass(category)}`}>
                      {vendor}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {monthDays(reportMonth).map((day) => {
                const dateKey = reportMonth + "-" + day;
                const rowValues = matrixVendors.map((vendor) => {
                  const draftValue = orderDraftCells[dateKey + "|" + vendor];
                  return draftValue !== undefined ? Number(draftValue || 0) : cellAmount(dateKey, vendor);
                });
                const rowTotal = rowValues.reduce((sum, item) => sum + item, 0);
                return (
                  <tr key={dateKey} className="hover:bg-slate-50/70">
                    <td className="sticky left-0 bg-white p-3 text-center font-mono font-black text-gray-600 border-r">{Number(day)}</td>
                    {rowValues.map((value, index) => {
                      const vendor = matrixVendors[index];
                      const draftKey = dateKey + "|" + vendor;
                      const draftValue = orderDraftCells[draftKey];
                      return (
                        <td key={vendor} className="p-1.5 text-right font-mono border-r">
                          <input value={draftValue !== undefined ? formatWithCommas(draftValue) : (value ? formatWithCommas(value) : "")} onChange={(e) => updateOrderDraft(dateKey, vendor, e.target.value)} inputMode="numeric" maxLength={9} className="w-[74px] rounded-lg border border-gray-200 px-1.5 py-1.5 text-right font-mono font-black focus:border-[#2E6DB4] focus:outline-none" />
                        </td>
                      );
                    })}
                    <td className="p-3 text-right font-mono font-black bg-slate-50">{rowTotal ? formatNumber(rowTotal) : ""}</td>
                  </tr>
                );
              })}
              <tr className="bg-gray-100 font-black">
                <td className="sticky left-0 bg-gray-100 p-3 text-center border-r">합계</td>
                {totals.map((value, index) => <td key={matrixVendors[index]} className="p-3 text-right font-mono border-r">{value ? formatNumber(value) : ""}</td>)}
                <td className="p-3 text-right font-mono text-[#2E6DB4]">{formatNumber(monthTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function LiquorInventoryTabV2({ branchName }: { branchName: string }) {
  const productKey = "erp_liquor_products_" + branchName;
  const movementKey = "erp_liquor_movements_" + branchName;
  const sharedProductKey = "liquor_products:" + branchName;
  const sharedMovementKey = "liquor_movements:" + branchName;
  const productPendingKey = pendingLocalSaveStorageKey(productKey);
  const movementPendingKey = pendingLocalSaveStorageKey(movementKey);
  const productSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const movementSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [classification, setClassification] = useState("샴페인");
  const [itemName, setItemName] = useState("");
  const [draftDate, setDraftDate] = useState(() => toLocalDateInputValue());
  const [inventoryView, setInventoryView] = useState<"daily" | "weekly">("daily");
  const [categoryFilter, setCategoryFilter] = useState("전체");
  const [weeklyViewDate, setWeeklyViewDate] = useState(() => toLocalDateInputValue());
  const [draftCells, setDraftCells] = useState<Record<string, { inbound: string; sold: string }>>({});

  useEffect(() => {
    try {
      const savedProducts = localStorage.getItem(productKey);
      const savedMovements = localStorage.getItem(movementKey);
      if (savedProducts) setProducts(JSON.parse(savedProducts));
      if (savedMovements) setMovements(JSON.parse(savedMovements));
    } catch (err) {
      console.error("Failed to load liquor inventory", err);
    }
  }, [productKey, movementKey]);

  const saveLiquorSharedDebounced = useCallback((key: string, value: unknown, timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>, pendingKey: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    localStorage.setItem(pendingKey, "1");
    void gasClient.saveSharedData(key, value)
      .then(() => localStorage.removeItem(pendingKey))
      .catch((error) => {
        console.error("Failed to save shared liquor inventory", error);
      });
  }, []);

  const parseLiquorJsonArray = useCallback(<T,>(json: string | null): T[] => {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, []);

  const mergeById = useCallback(<T extends { id: string }>(remoteItems: T[], localItems: T[]) => {
    const byId = new Map<string, T>();
    [...remoteItems, ...localItems].forEach((item) => {
      if (!item?.id) return;
      byId.set(item.id, item);
    });
    return Array.from(byId.values());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const localProductsJson = localStorage.getItem(productKey);
    const localMovementsJson = localStorage.getItem(movementKey);

    void Promise.all([
      gasClient.getSharedData<InventoryProduct[]>(sharedProductKey),
      gasClient.getSharedData<InventoryMovement[]>(sharedMovementKey)
    ]).then(([remoteProducts, remoteMovements]) => {
      if (cancelled) return;
      const localProducts = parseLiquorJsonArray<InventoryProduct>(localProductsJson);
      const hasPendingProducts = localStorage.getItem(productPendingKey) === "1" && localProductsJson !== null;
      const remoteProductItems = Array.isArray(remoteProducts) ? remoteProducts : null;
      const nextProducts = hasPendingProducts ? localProducts : remoteProductItems ?? localProducts;
      if (hasPendingProducts || remoteProductItems !== null || localProductsJson !== null) {
        setProducts(nextProducts);
        localStorage.setItem(productKey, JSON.stringify(nextProducts));
        if (hasPendingProducts) {
          void gasClient.saveSharedData(sharedProductKey, nextProducts)
            .then(() => localStorage.removeItem(productPendingKey))
            .catch((error) => console.error("Failed to resave pending liquor products", error));
        }
      }

      const localMovements = parseLiquorJsonArray<InventoryMovement>(localMovementsJson);
      const hasPendingMovements = localStorage.getItem(movementPendingKey) === "1" && localMovementsJson !== null;
      const remoteMovementItems = Array.isArray(remoteMovements) ? remoteMovements : null;
      const nextMovements = hasPendingMovements ? localMovements : remoteMovementItems ?? localMovements;
      if (hasPendingMovements || remoteMovementItems !== null || localMovementsJson !== null) {
        setMovements(nextMovements);
        localStorage.setItem(movementKey, JSON.stringify(nextMovements));
        if (hasPendingMovements) {
          void gasClient.saveSharedData(sharedMovementKey, nextMovements)
            .then(() => localStorage.removeItem(movementPendingKey))
            .catch((error) => console.error("Failed to resave pending liquor movements", error));
        }
      }
    }).catch((error) => {
      console.error("Failed to load shared liquor inventory", error);
    });

    return () => {
      cancelled = true;
      if (productSaveTimerRef.current) clearTimeout(productSaveTimerRef.current);
      if (movementSaveTimerRef.current) clearTimeout(movementSaveTimerRef.current);
    };
  }, [mergeById, movementKey, movementPendingKey, parseLiquorJsonArray, productKey, productPendingKey, sharedMovementKey, sharedProductKey]);

  useEffect(() => {
    (window as any).__ugdLiquorInventoryDirty = false;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!(window as any).__ugdLiquorInventoryDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    return () => {
      (window as any).__ugdLiquorInventoryDirty = false;
    };
  }, []);

  const saveProducts = (next: InventoryProduct[]) => {
    setProducts(next);
    localStorage.setItem(productKey, JSON.stringify(next));
    saveLiquorSharedDebounced(sharedProductKey, next, productSaveTimerRef, productPendingKey);
  };

  const saveMovements = (next: InventoryMovement[]) => {
    setMovements(next);
    localStorage.setItem(movementKey, JSON.stringify(next));
    saveLiquorSharedDebounced(sharedMovementKey, next, movementSaveTimerRef, movementPendingKey);
  };

  const addProduct = (event: React.FormEvent) => {
    event.preventDefault();
    const names = itemName.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    if (names.length === 0) return;
    const nextProducts = names.map((name, index) => ({
      id: "liq-product-" + Date.now() + "-" + index,
      classification,
      importer: "",
      itemName: name,
      salePrice: "",
      costPrice: ""
    }));
    saveProducts([...products, ...nextProducts]);
    setItemName("");
  };

  const deleteProduct = (product: InventoryProduct) => {
    if (!window.confirm(product.itemName + " 상품을 삭제할까요? 해당 상품의 입고/판매 기록도 함께 삭제됩니다.")) return;
    saveProducts(products.filter((item) => item.id !== product.id));
    saveMovements(movements.filter((movement) => movement.productId !== product.id));
    setDraftCells((prev) => {
      const next: Record<string, { inbound: string; sold: string }> = {};
      (Object.entries(prev) as Array<[string, { inbound: string; sold: string }]>).forEach(([key, value]) => {
        if (!key.startsWith(product.id + "|")) next[key] = value;
      });
      return next;
    });
  };

  const updateDraft = (productId: string, date: string, field: "inbound" | "sold", value: string) => {
    const key = productId + "|" + date;
    const nextValue = cleanNumeric(value);
    const currentDraft = draftCells[key];
    const nextInbound = field === "inbound" ? nextValue : (currentDraft?.inbound ?? String(savedAmount(productId, date, "inbound") || ""));
    const nextSold = field === "sold" ? nextValue : (currentDraft?.sold ?? String(savedAmount(productId, date, "sold") || ""));

    setDraftCells((prev) => ({
      ...prev,
      [key]: {
        inbound: prev[key]?.inbound || "",
        sold: prev[key]?.sold || "",
        [field]: nextValue
      }
    }));
    setMovements((currentMovements) => {
      const kept = currentMovements.filter((movement) => !(movement.productId === productId && movement.movementDate === date));
      const nextMovements = Number(nextInbound || 0) > 0 || Number(nextSold || 0) > 0
        ? [{
          id: "liq-move-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
          productId,
          movementDate: date,
          inbound: nextInbound,
          sold: nextSold,
          memo: ""
        }, ...kept]
        : kept;
      localStorage.setItem(movementKey, JSON.stringify(nextMovements));
      saveLiquorSharedDebounced(sharedMovementKey, nextMovements, movementSaveTimerRef, movementPendingKey);
      return nextMovements;
    });
  };

  const stockOf = (productId: string, untilDate?: string) => {
    return movements
      .filter((movement) => movement.productId === productId && (!untilDate || movement.movementDate <= untilDate))
      .reduce((sum, movement) => sum + Number(movement.inbound || 0) - Number(movement.sold || 0), 0);
  };

  const savedAmount = (productId: string, date: string, field: "inbound" | "sold") => {
    return movements
      .filter((movement) => movement.productId === productId && movement.movementDate === date)
      .reduce((sum, movement) => sum + Number(movement[field] || 0), 0);
  };

  const filteredProducts = useMemo(() => {
    return products.filter((product) => categoryFilter === "전체" || product.classification === categoryFilter);
  }, [categoryFilter, products]);

  const weekDates = useMemo(() => {
    const base = new Date(`${weeklyViewDate}T00:00:00`);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(base);
      date.setDate(base.getDate() - 6 + index);
      return toLocalDateInputValue(date);
    });
  }, [weeklyViewDate]);

  const getDraftOrSavedAmount = (productId: string, date: string, field: "inbound" | "sold") => {
    const draft = draftCells[productId + "|" + date]?.[field];
    return draft !== undefined && draft !== "" ? Number(draft || 0) : savedAmount(productId, date, field);
  };

  const stockBeforeDate = (productId: string, date: string) => {
    return movements
      .filter((movement) => movement.productId === productId && movement.movementDate < date)
      .reduce((sum, movement) => sum + Number(movement.inbound || 0) - Number(movement.sold || 0), 0);
  };

  const stockOnDate = (productId: string, date: string) => {
    return stockBeforeDate(productId, date) + getDraftOrSavedAmount(productId, date, "inbound") - getDraftOrSavedAmount(productId, date, "sold");
  };

  return (
    <div className="space-y-5" id="liquor-inventory-tab">
      <section className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
        <div>
          <h3 className="text-base font-black text-gray-900 flex items-center gap-2"><Database className="w-5 h-5 text-[#2E6DB4]" /> 주류 재고 관리표</h3>
          <p className="text-xs text-gray-400 mt-1">지점 입력은 당일 입고/판매만 빠르게 작성하고, 7일 보기에서 최근 흐름을 확인합니다.</p>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
          <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setInventoryView("daily")} className={`px-4 py-2 rounded-xl text-xs font-black ${inventoryView === "daily" ? "bg-[#2E6DB4] text-white" : "bg-white text-slate-500 border border-slate-200"}`}>당일 입력</button>
              <button type="button" onClick={() => setInventoryView("weekly")} className={`px-4 py-2 rounded-xl text-xs font-black ${inventoryView === "weekly" ? "bg-[#2E6DB4] text-white" : "bg-white text-slate-500 border border-slate-200"}`}>7일 보기</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {["전체", ...LIQUOR_CATEGORIES].map((item) => (
                <button key={item} type="button" onClick={() => setCategoryFilter(item)} className={`rounded-full border px-3 py-1.5 text-xs font-black ${categoryFilter === item ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"}`}>
                  {item}
                </button>
              ))}
            </div>
          </div>
          <form onSubmit={addProduct} className="rounded-2xl border border-slate-100 bg-white p-4 space-y-3">
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <select value={classification} onChange={(e) => setClassification(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-bold bg-white">
                {LIQUOR_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <label className="relative group">
                <textarea value={itemName} onChange={(e) => setItemName(e.target.value)} title={VENDOR_HINT} rows={1} placeholder="상품명 대량등록" className="w-full h-[42px] px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-bold resize-none overflow-y-auto" />
                <span className="pointer-events-none absolute right-0 top-full mt-2 z-20 hidden rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-bold text-white shadow-lg group-focus-within:block">{VENDOR_HINT}</span>
              </label>
            </div>
            <button className="h-[40px] w-full px-5 bg-slate-800 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5"><Plus className="w-4 h-4" /> 상품 추가</button>
          </form>
        </div>
      </section>

      {inventoryView === "daily" ? (
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setDraftDate((current) => addDaysToDateInputValue(current, -1))} className="h-[38px] px-3 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-600 hover:bg-gray-50">이전날</button>
            <button type="button" onClick={() => setDraftDate(toLocalDateInputValue())} className="h-[38px] px-3 rounded-xl border border-[#2E6DB4]/20 bg-[#2E6DB4]/10 text-xs font-black text-[#1A3C6E] hover:bg-[#2E6DB4]/15">오늘</button>
            <button type="button" onClick={() => setDraftDate((current) => addDaysToDateInputValue(current, 1))} className="h-[38px] px-3 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-600 hover:bg-gray-50">다음날</button>
            <input type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono font-bold" />
            <span className="text-xs text-gray-400 font-bold">선택한 하루의 입고/판매만 입력합니다.</span>
          </div>
          <div className="h-[42px] px-5 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-black flex items-center">자동저장</div>
        </div>
        <div className="max-h-[68vh] overflow-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 z-20 bg-[#202A5A] text-white font-black">
              <tr>
                <th className="p-3 text-left w-24">분류</th>
                <th className="p-3 text-left w-48">상품명</th>
                <th className="p-3 text-center bg-slate-700 w-20">전일재고</th>
                <th className="p-3 text-center bg-blue-100 text-blue-900 w-28">오늘 입고</th>
                <th className="p-3 text-center bg-rose-100 text-rose-900 w-28">오늘 판매</th>
                <th className="liquor-stock-alice-green p-3 text-center text-green-900 w-20">오늘 재고</th>
                <th className="p-3 text-center w-12">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredProducts.length === 0 ? (
                <tr><td colSpan={7} className="p-10 text-center text-gray-400 font-bold">등록된 주류 상품이 없습니다.</td></tr>
              ) : filteredProducts.map((product) => {
                const key = product.id + "|" + draftDate;
                const inSum = savedAmount(product.id, draftDate, "inbound");
                const soldSum = savedAmount(product.id, draftDate, "sold");
                const draft = draftCells[key] || { inbound: "", sold: "" };
                return (
                  <tr key={product.id} className="hover:bg-slate-50/70">
                    <td className="p-3 whitespace-nowrap">
                      <span className={`inline-flex min-w-[58px] justify-center rounded-lg border px-2 py-1 text-[11px] font-black ${getLiquorCategoryClass(product.classification)}`}>
                        {product.classification}
                      </span>
                    </td>
                    <td className="p-3 font-black text-gray-900">
                      <span className="truncate" title={product.itemName}>{product.itemName}</span>
                    </td>
                    <td className="p-3 text-center font-mono font-black bg-slate-50">{stockBeforeDate(product.id, draftDate)}</td>
                    <td className="p-2 bg-blue-50"><input value={draft.inbound} onChange={(e) => updateDraft(product.id, draftDate, "inbound", e.target.value)} inputMode="numeric" placeholder={inSum ? String(inSum) : "0"} className="w-full rounded-xl border border-blue-100 bg-white px-2 py-2 text-center font-mono font-black text-blue-800" /></td>
                    <td className="p-2 bg-rose-50"><input value={draft.sold} onChange={(e) => updateDraft(product.id, draftDate, "sold", e.target.value)} inputMode="numeric" placeholder={soldSum ? String(soldSum) : "0"} className="w-full rounded-xl border border-rose-100 bg-white px-2 py-2 text-center font-mono font-black text-rose-800" /></td>
                    <td className={`p-3 text-center font-mono font-black ${stockOnDate(product.id, draftDate) < 0 ? "bg-rose-100 text-rose-700" : "liquor-stock-alice-green text-slate-800"}`}>{stockOnDate(product.id, draftDate)}</td>
                    <td className="p-3 text-center">
                      <button type="button" onClick={() => deleteProduct(product)} className="text-gray-300 hover:text-rose-600" aria-label={product.itemName + " 삭제"}><X className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      ) : (
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setWeeklyViewDate((current) => addDaysToDateInputValue(current, -7))} className="h-[38px] px-3 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-600 hover:bg-gray-50">이전 7일</button>
            <button type="button" onClick={() => setWeeklyViewDate(toLocalDateInputValue())} className="h-[38px] px-3 rounded-xl border border-[#2E6DB4]/20 bg-[#2E6DB4]/10 text-xs font-black text-[#1A3C6E] hover:bg-[#2E6DB4]/15">이번 7일</button>
            <button type="button" onClick={() => setWeeklyViewDate((current) => addDaysToDateInputValue(current, 7))} className="h-[38px] px-3 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-600 hover:bg-gray-50">다음 7일</button>
            <input type="date" value={weeklyViewDate} onChange={(e) => setWeeklyViewDate(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono font-bold" />
            <span className="text-xs text-gray-400 font-bold">선택한 날짜 기준 최근 7일 흐름을 확인합니다.</span>
          </div>
        </div>
        <div className="max-h-[68vh] overflow-auto">
          <table className="w-full min-w-[980px] text-xs">
            <thead className="bg-[#202A5A] text-white font-black">
              <tr>
                <th rowSpan={2} className="sticky left-0 top-0 z-30 bg-[#202A5A] p-2 text-left w-20">분류</th>
                <th rowSpan={2} className="sticky left-20 top-0 z-30 bg-[#202A5A] p-2 text-left w-44">상품명</th>
                <th rowSpan={2} className="liquor-stock-alice-green sticky top-0 z-20 p-2 text-center w-16">현재</th>
                {weekDates.map((date) => <th key={date} colSpan={3} className="sticky top-0 z-20 bg-[#202A5A] p-1.5 text-center border-l border-white/20">{date.slice(5)}</th>)}
              </tr>
              <tr>
                {weekDates.map((date) => (
                  <React.Fragment key={date}>
                    <th className="sticky top-[29px] z-20 p-1 bg-blue-100 text-blue-900 w-10">입</th>
                    <th className="sticky top-[29px] z-20 p-1 bg-rose-100 text-rose-900 w-10">판</th>
                    <th className="liquor-stock-alice-green sticky top-[29px] z-20 p-1 text-green-900 w-10">재</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredProducts.length === 0 ? (
                <tr><td colSpan={3 + weekDates.length * 3} className="p-10 text-center text-gray-400 font-bold">등록된 주류 상품이 없습니다.</td></tr>
              ) : filteredProducts.map((product) => (
                <tr key={product.id} className="hover:bg-slate-50/70">
                  <td className="sticky left-0 z-10 bg-white p-2 whitespace-nowrap">
                    <span className={`inline-flex min-w-[58px] justify-center rounded-lg border px-2 py-1 text-[11px] font-black ${getLiquorCategoryClass(product.classification)}`}>{product.classification}</span>
                  </td>
                  <td className="sticky left-20 z-10 bg-white p-2 font-black text-gray-900">
                    <span className="truncate" title={product.itemName}>{product.itemName}</span>
                  </td>
                  <td className="liquor-stock-alice-green p-2 text-center font-mono font-black">{stockOf(product.id)}</td>
                  {weekDates.map((date) => {
                    const inbound = getDraftOrSavedAmount(product.id, date, "inbound");
                    const sold = getDraftOrSavedAmount(product.id, date, "sold");
                    const stock = stockOnDate(product.id, date);
                    return (
                      <React.Fragment key={date}>
                        <td className="p-1 text-center font-mono bg-blue-50 text-blue-800">{inbound || ""}</td>
                        <td className="p-1 text-center font-mono bg-rose-50 text-rose-800">{sold || ""}</td>
                        <td className={`p-1 text-center font-mono font-black ${stock < 0 ? "bg-rose-100 text-rose-700" : "liquor-stock-alice-green text-slate-800"}`}>{stock}</td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}
    </div>
  );
}

// ----------------------------------------------------
// TAB 3: Roster Tab (직원현황)
// ----------------------------------------------------
function RosterTab({ branchName }: { branchName: string }) {
  const initialEmployees = useMemo(() => readLocalStaffList(branchName), [branchName]);
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const employeesRef = useRef<Employee[]>(initialEmployees);
  const rosterSaveTimerRef = useRef<number | null>(null);
  const rosterSaveSeqRef = useRef(0);

  const [newName, setNewName] = useState("");
  const [division, setDivision] = useState<"정직원" | "파트타이머" >("정직원");
  const [selectedRank, setSelectedRank] = useState<string>("");
  const [customRankInput, setCustomRankInput] = useState<string>("");
  const [newResidentNumber, setNewResidentNumber] = useState("");
  const [newContractType, setNewContractType] = useState<"4대보험" | "3.3%">("4대보험");
  const [newEntryDate, setNewEntryDate] = useState("");
  const [newPhoneDigits, setNewPhoneDigits] = useState("");
  const [newAddReason, setNewAddReason] = useState<StaffAddReasonChoice>("");
  const [newFromBranch, setNewFromBranch] = useState("");
  const [newTransferDate, setNewTransferDate] = useState("");
  const [newSalaryChanged, setNewSalaryChanged] = useState<SalaryChangeChoice>("");
  const [newAddReasonMemo, setNewAddReasonMemo] = useState("");
  const [rosterAddDrafts, setRosterAddDrafts] = useState<StaffAddDraft[]>(() => readLocalStaffAddDrafts(branchName));
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [editingEmployeeDraft, setEditingEmployeeDraft] = useState<Employee | null>(null);
  const [editingSensitiveFields, setEditingSensitiveFields] = useState({ phone: false, salaryChanged: false });

  // Deletion Modal States
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
  const [deleteReason, setDeleteReason] = useState<"퇴사" | "지점이동">("퇴사");
  const [effectiveDate, setEffectiveDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [targetBranch, setTargetBranch] = useState<string>("");
  const [branchList, setBranchList] = useState<any[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  // Edit Modal States
  const [showEditModal, setShowEditModal] = useState(false);
  const [employeeToEdit, setEmployeeToEdit] = useState<Employee | null>(null);
  const [editName, setEditName] = useState("");
  const [editDivision, setEditDivision] = useState<"정직원" | "파트타이머">("정직원");
  const [editRank, setEditRank] = useState("");
  const [editCustomRank, setEditCustomRank] = useState("");
  const [editResidentNumber, setEditResidentNumber] = useState("");
  const [editContractType, setEditContractType] = useState<"4대보험" | "3.3%">("4대보험");
  const [editEntryDate, setEditEntryDate] = useState("");

  useEffect(() => {
    localStorage.setItem(staffAddDraftStorageKey(branchName), JSON.stringify(rosterAddDrafts));
  }, [branchName, rosterAddDrafts]);

  useEffect(() => {
    return () => {
      if (rosterSaveTimerRef.current) window.clearTimeout(rosterSaveTimerRef.current);
      if (localStorage.getItem(staffListPendingStorageKey(branchName)) === "1") {
        const pendingEmployees = readLocalStaffList(branchName);
        const saveSeq = ++rosterSaveSeqRef.current;
        gasClient.saveBranchOwnRoster(branchName, pendingEmployees)
          .then(() => {
            if (rosterSaveSeqRef.current === saveSeq) localStorage.removeItem(staffListPendingStorageKey(branchName));
          })
          .catch((error) => {
            console.error("직원 명단 탭 이동 전 저장에 실패했습니다.", error);
          });
      }
    };
  }, [branchName]);

  // 지점 직원현황은 지점 전용 branch_own_rosters만 기준으로 사용합니다.
  // 관리자 직원명부(staff_rosters)는 재설계 전까지 지점 직원현황에 병합하지 않습니다.
  useEffect(() => {
    let cancelled = false;
    const syncRoster = async () => {
      try {
        const ownRoster = await gasClient.getBranchOwnRoster(branchName);
        if (cancelled) return;
        const ownFiltered = ownRoster.filter((employee: any) => !isSampleEmployee(employee));
        const localRoster = readLocalStaffList(branchName);
        const hasPendingLocalSave = localStorage.getItem(staffListPendingStorageKey(branchName)) === "1";
        const shouldPreserveLocal = hasPendingLocalSave;
        const merged: any[] = [...(shouldPreserveLocal ? localRoster : ownFiltered)];

        employeesRef.current = merged as Employee[];
        setEmployees(merged as Employee[]);
        localStorage.setItem(staffListStorageKey(branchName), JSON.stringify(merged));

        // 샘플 제거 또는 로컬 미반영 저장분이 있는 경우 branch_own_rosters 정리
        const needsUpdate = shouldPreserveLocal || ownRoster.some((e: any) => isSampleEmployee(e)) || ownRoster.length !== merged.length;
        if (needsUpdate) {
          await gasClient.saveBranchOwnRoster(branchName, merged);
          localStorage.removeItem(staffListPendingStorageKey(branchName));
        }
      } catch (error) {
        console.warn("직원 명단 원격 동기화에 실패했습니다.", error);
      }
    };
    syncRoster();
    return () => { cancelled = true; };
  }, [branchName]);

  const handleOpenEditModal = (emp: Employee) => {
    setEmployeeToEdit(emp);
    setEditName(emp.name);
    setEditDivision(emp.division);
    setEditRank(emp.rank || "");
    setEditCustomRank(emp.customRank || "");
    setEditResidentNumber(formatResidentNumber(emp.residentNumber || ""));
    setEditContractType(emp.contractType || "4대보험");
    setEditEntryDate(emp.entryDate || "");
    setShowEditModal(true);
  };

  const handleSaveEdit = () => {
    if (!employeeToEdit) return;
    if (!editName.trim()) {
      alert("이름을 꼭 기입해 주십시오.");
      return;
    }

    const updated = employees.map((emp) => {
      if (emp.id === employeeToEdit.id) {
        return {
          ...emp,
          name: editName.trim(),
          division: editDivision,
          residentNumber: formatResidentNumber(editResidentNumber),
          contractType: editContractType,
          entryDate: editEntryDate,
          ...(editDivision === "정직원" ? {
            rank: editRank,
            ...(editRank === "기타" ? { customRank: editCustomRank.trim() } : {})
          } : {
            rank: undefined,
            customRank: undefined
          })
        };
      }
      return emp;
    });

    saveEmployees(updated);
    setShowEditModal(false);
    setEmployeeToEdit(null);
  };

  // Fetch branches inside RosterTab to populate target branch selection
  useEffect(() => {
    const loadList = async () => {
      try {
        setLoadingBranches(true);
        const list = await gasClient.getBranchList();
        // filter: role is branch, and name is not current branchName
        const filtered = list.filter((b: any) => b.role === "branch" && b.branchName !== branchName);
        setBranchList(filtered);
        if (filtered.length > 0) {
          setTargetBranch(filtered[0].branchName);
        }
      } catch (e) {
        console.error("지점 로드 오류:", e);
      } finally {
        setLoadingBranches(false);
      }
    };
    loadList();
  }, [branchName]);

  const persistEmployees = (updated: Employee[], delayMs = 0) => {
    const normalized = updated.map((employee) => ({
      ...employee,
      residentNumber: formatResidentNumber(employee.residentNumber || ""),
      contractType: employee.contractType || (employee.division === "정직원" ? "4대보험" : "3.3%"),
      phone: employee.addReason === "신규입사" && toPhoneTail8(employee.phone || "").length === 8
        ? formatMobilePhone(employee.phone || "")
        : employee.phone || ""
    }));
    employeesRef.current = normalized;
    localStorage.setItem(staffListStorageKey(branchName), JSON.stringify(normalized));
    localStorage.setItem(staffListPendingStorageKey(branchName), "1");
    const saveSeq = ++rosterSaveSeqRef.current;
    if (rosterSaveTimerRef.current) window.clearTimeout(rosterSaveTimerRef.current);
    rosterSaveTimerRef.current = null;
    const saveNow = () => {
      gasClient.saveBranchOwnRoster(branchName, normalized)
        .then(() => {
          if (rosterSaveSeqRef.current === saveSeq) localStorage.removeItem(staffListPendingStorageKey(branchName));
        })
        .catch((error) => {
          console.error("직원 명단 저장에 실패했습니다.", error);
        });
    };
    if (delayMs > 0) {
      rosterSaveTimerRef.current = window.setTimeout(saveNow, delayMs);
    } else {
      saveNow();
    }
    return normalized;
  };

  const saveEmployees = (updated: Employee[]) => {
    setEmployees(persistEmployees(updated, 0));
  };

  const startEmployeeEdit = (employee: Employee) => {
    if (editingEmployeeDraft && editingEmployeeId !== employee.id) {
      const canDiscard = window.confirm("저장하지 않은 수정 내용이 있습니다. 취소하고 다른 직원을 수정할까요?");
      if (!canDiscard) return;
    }
    setEditingEmployeeId(employee.id);
    setEditingEmployeeDraft({ ...employee, phone: "", salaryChanged: undefined });
    setEditingSensitiveFields({ phone: false, salaryChanged: false });
  };

  const cancelEmployeeEdit = () => {
    setEditingEmployeeId(null);
    setEditingEmployeeDraft(null);
    setEditingSensitiveFields({ phone: false, salaryChanged: false });
  };

  const updateEmployeeEditDraft = (field: EmployeeEditableField, value: string) => {
    if (field === "phone") setEditingSensitiveFields((current) => ({ ...current, phone: true }));
    if (field === "salaryChanged") setEditingSensitiveFields((current) => ({ ...current, salaryChanged: true }));
    setEditingEmployeeDraft((current) => current ? applyEmployeeEditableField(current, field, value) : current);
  };

  const saveEmployeeEdit = () => {
    if (!editingEmployeeDraft) return;
    const originalEmployee = employees.find((employee) => employee.id === editingEmployeeDraft.id);
    const normalizedDraft: Employee = {
      ...editingEmployeeDraft,
      name: editingEmployeeDraft.name.trim(),
      residentNumber: formatResidentNumber(editingEmployeeDraft.residentNumber || "")
    };
    if (originalEmployee?.addReason === normalizedDraft.addReason && normalizedDraft.addReason === "신규입사" && !editingSensitiveFields.phone) {
      normalizedDraft.phone = originalEmployee.phone || "";
    }
    if (originalEmployee?.addReason === normalizedDraft.addReason && normalizedDraft.addReason === "지점이동" && !editingSensitiveFields.salaryChanged) {
      normalizedDraft.salaryChanged = originalEmployee.salaryChanged;
    }
    if (normalizedDraft.addReason === "신규입사") {
      const phoneTail = toPhoneTail8(normalizedDraft.phone || "");
      if (phoneTail.length !== 8) {
        alert("핸드폰번호 뒤 8자리를 입력해 주세요. 010은 제외합니다.");
        return;
      }
      normalizedDraft.phone = formatMobilePhone(phoneTail);
    }
    if (!normalizedDraft.name) {
      alert("이름을 꼭 기입해 주세요.");
      return;
    }
    saveEmployees(employees.map((employee) => employee.id === normalizedDraft.id ? normalizedDraft : employee));
    cancelEmployeeEdit();
  };

  const recordStaffMovement = async (employee: Employee, reason: "퇴사" | "지점이동", date: string, destination?: string) => {
    const key = `staff_movements:${branchName}`;
    const previous = (await gasClient.getSharedData<any[]>(key)) || [];
    await gasClient.saveSharedData(key, [{
      id: `movement-${Date.now()}`,
      type: reason,
      employeeName: employee.name,
      fromBranch: branchName,
      toBranch: reason === "지점이동" ? destination || "-" : "-",
      effectiveDate: date,
      createdAt: new Date().toISOString()
    }, ...previous]);
  };

  const handleAddEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const formattedResident = formatResidentNumber(newResidentNumber);
    if (formattedResident.replace(/\D/g, "").length !== 13) {
      alert("주민등록번호 13자리를 모두 입력해 주세요.");
      return;
    }
    if (!newAddReason) {
      alert("추가사유를 선택해 주세요.");
      return;
    }
    if (newAddReason === "신규입사" && !newEntryDate) {
      alert("신규입사일을 선택해 주세요.");
      return;
    }
    if (newAddReason === "신규입사" && toPhoneTail8(newPhoneDigits).length !== 8) {
      alert("핸드폰번호 8자리를 입력해 주세요. 010은 제외합니다.");
      return;
    }
    if (newAddReason === "지점이동" && (!newFromBranch.trim() || !newTransferDate)) {
      alert("이동 전 지점과 이동일을 입력해 주세요.");
      return;
    }
    if (newAddReason === "기타" && !newAddReasonMemo.trim()) {
      alert("기타 추가 사유를 입력해 주세요.");
      return;
    }
    const matchedDup = getSameNameWarning(newName, formattedResident, employees, division);
    if (matchedDup) {
      alert(matchedDup);
      return;
    }

    const nextEmp: Employee = {
      id: `emp-${Date.now()}`,
      name: newName.trim(),
      division,
      residentNumber: formattedResident,
      contractType: newContractType,
      entryDate: newAddReason === "지점이동" ? newTransferDate : newEntryDate,
      phone: newAddReason === "신규입사" ? formatMobilePhone(newPhoneDigits) : "",
      addReason: newAddReason,
      fromBranch: newAddReason === "지점이동" ? newFromBranch.trim() : "",
      transferDate: newAddReason === "지점이동" ? newTransferDate : "",
      salaryChanged: newAddReason === "지점이동" ? parseSalaryChangeStatus(newSalaryChanged) || undefined : undefined,
      hireDate: newAddReason === "신규입사" ? newEntryDate : "",
      addReasonMemo: newAddReason === "기타" ? newAddReasonMemo.trim() : "",
      ...(division === "정직원" ? {
        rank: selectedRank,
        ...(selectedRank === "기타" ? { customRank: customRankInput.trim() } : {})
      } : {})
    };

    const updated = [...employees, nextEmp];
    saveEmployees(updated);
    setNewName("");
    setSelectedRank("");
    setCustomRankInput("");
    setNewResidentNumber("");
    setNewContractType("4대보험");
    setNewEntryDate("");
    setNewPhoneDigits("");
    setNewAddReason("");
    setNewFromBranch("");
    setNewTransferDate("");
    setNewSalaryChanged("");
    setNewAddReasonMemo("");
  };

  const updateRosterAddDraft = (id: string, patch: Partial<StaffAddDraft>) => {
    setRosterAddDrafts((current) => current.map((draft) => {
      if (draft.id !== id) return draft;
      const next = { ...draft, ...patch };
      if (patch.division === "정직원") next.contractType = "4대보험";
      if (patch.division === "파트타이머") {
        next.contractType = "3.3%";
        next.rank = "";
      }
      if (patch.addReason === "") {
        next.entryDate = "";
        next.phoneDigits = "";
        next.fromBranch = "";
        next.transferDate = "";
        next.salaryChanged = "";
        next.addReasonMemo = "";
      }
      if (patch.addReason === "신규입사") {
        next.transferDate = "";
        next.salaryChanged = "";
        next.addReasonMemo = "";
      }
      if (patch.addReason === "지점이동") {
        next.entryDate = "";
        next.phoneDigits = "";
        next.fromBranch = "";
        next.addReasonMemo = "";
        next.salaryChanged = next.salaryChanged || "";
      }
      if (patch.addReason === "기존직원") {
        next.entryDate = "";
        next.phoneDigits = "";
        next.fromBranch = "";
        next.transferDate = "";
        next.salaryChanged = "";
        next.addReasonMemo = "";
      }
      if (patch.addReason === "기타") {
        next.entryDate = "";
        next.phoneDigits = "";
        next.fromBranch = "";
        next.transferDate = "";
        next.salaryChanged = "";
      }
      return next;
    }));
  };

  const registerRosterAddDrafts = () => {
    const filledDrafts = rosterAddDrafts.filter((draft) => draft.name.trim());
    if (filledDrafts.length === 0) {
      alert("추가할 근무자 이름을 입력해주세요.");
      return;
    }

    const nextEmployees: Employee[] = [];
    for (const draft of filledDrafts) {
      const name = draft.name.trim();
      const residentBirth = residentBirthKey(draft.residentNumber);
      if (residentBirth.length !== 6) {
        alert(`${name} 님의 주민등록번호 앞 6자리를 입력해 주세요.`);
        return;
      }
      if (!draft.addReason) {
        alert(`${name} 님의 추가사유를 선택해 주세요.`);
        return;
      }
      const matchedDup = getSameNameWarning(name, residentBirth, [...employees, ...nextEmployees], draft.division);
      if (matchedDup) {
        alert(matchedDup);
        return;
      }

      nextEmployees.push({
        id: `emp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        division: draft.division,
        residentNumber: residentBirth,
        contractType: draft.contractType,
        entryDate: draft.addReason === "지점이동" ? draft.transferDate : draft.entryDate,
        phone: draft.addReason === "신규입사" ? formatMobilePhone(draft.phoneDigits) : "",
        addReason: draft.addReason,
        fromBranch: "",
        transferDate: draft.addReason === "지점이동" ? draft.transferDate : "",
        salaryChanged: draft.addReason === "지점이동" ? parseSalaryChangeStatus(draft.salaryChanged) || undefined : undefined,
        hireDate: draft.addReason === "신규입사" ? draft.entryDate : "",
        addReasonMemo: draft.addReason === "기타" ? draft.addReasonMemo.trim() : ""
      });
    }

    saveEmployees([...employees, ...nextEmployees]);
    setRosterAddDrafts([createStaffAddDraft()]);
    localStorage.removeItem(staffAddDraftStorageKey(branchName));
  };

  // Staff category counters
  const sortedEmployees = useMemo(() => {
    return [...employees].sort((a, b) => {
      if (a.division === "정직원" && b.division !== "정직원") return -1;
      if (a.division !== "정직원" && b.division === "정직원") return 1;
      return a.name.localeCompare(b.name, "ko");
    });
  }, [employees]);

  const regularCount = employees.filter((e) => e.division === "정직원").length;
  const partTimeCount = employees.filter((e) => e.division === "파트타이머").length;

  return (
    <div className="space-y-6" id="roster-tab-view">
      {/* Deletion Modal */}
      <AnimatePresence>
        {showDeleteModal && employeeToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl p-6 max-w-sm w-full border border-gray-100 shadow-2xl space-y-4"
            >
              <div className="flex items-center gap-2.5 pb-2 border-b border-gray-100 text-rose-600">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3 className="text-base font-black text-gray-850">지점 근무 인원 삭제 처리</h3>
              </div>

              <p className="text-xs text-gray-500 leading-normal">
                <strong>{employeeToDelete.name}</strong> 님을 명부에서 제외시킵니다. 삭제 사유 및 처리 기준일을 아래 입력하여 주십시오.
              </p>

              <div className="space-y-3.5 text-xs">
                <div className="flex flex-col space-y-1">
                  <span className="font-bold text-gray-400">삭제 구분 (사유)</span>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "퇴사", val: "퇴사" },
                      { label: "지점이동", val: "지점이동" }
                    ].map((btn) => {
                      const checked = deleteReason === btn.val;
                      return (
                        <button
                          key={btn.val}
                          type="button"
                          onClick={() => setDeleteReason(btn.val as any)}
                          className={`py-2 rounded-xl border font-black text-xs transition-colors cursor-pointer ${
                            checked
                              ? "bg-rose-500 border-rose-500 text-white shadow-xs"
                              : "bg-white border-gray-200 text-gray-500 hover:text-gray-700"
                          }`}
                        >
                          {btn.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {deleteReason === "지점이동" && (
                  <div className="flex flex-col space-y-1">
                    <span className="font-bold text-gray-400">이동한 지점</span>
                    {loadingBranches ? (
                      <span className="text-xs text-gray-400 font-mono">불러오는 중...</span>
                    ) : (
                      <select
                        value={targetBranch}
                        onChange={(e) => setTargetBranch(e.target.value)}
                        className="px-3.5 py-2 border border-gray-200 rounded-xl bg-white font-semibold text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden"
                      >
                        {branchList.length === 0 ? (
                          <option value="">(이동 가능한 타 지점이 없음)</option>
                        ) : (
                          branchList.map((b) => (
                            <option key={b.branchName} value={b.branchName}>{b.branchName}</option>
                          ))
                        )}
                      </select>
                    )}
                  </div>
                )}

                <div className="flex flex-col space-y-1">
                  <span className="font-bold text-gray-400">{deleteReason === "퇴사" ? "퇴사 날짜" : "지점이동 날짜"}</span>
                  <input
                    type="date"
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                    onClick={(e) => e.currentTarget.showPicker?.()}
                    onFocus={(e) => e.currentTarget.showPicker?.()}
                    className="px-3.5 py-2 border border-gray-200 rounded-xl font-mono text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden cursor-pointer w-full text-xs"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-3 border-t border-gray-100 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setEmployeeToDelete(null);
                  }}
                  className="px-4 py-2 bg-gray-100 text-gray-500 font-extrabold cursor-pointer rounded-xl text-xs hover:bg-gray-200 transition-colors"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const updated = employees.filter((emp) => emp.id !== employeeToDelete.id);
                    saveEmployees(updated);
                    try {
                      await recordStaffMovement(employeeToDelete, deleteReason, effectiveDate, targetBranch);
                    } catch (error) {
                      console.error("Staff movement history save failed:", error);
                    }

                    const detailMsg = deleteReason === "지점이동"
                      ? `[${employeeToDelete.name}] 님이 ${effectiveDate} 일자로 [${targetBranch}] (으)로 지점이동 삭제 완료되었습니다.`
                      : `[${employeeToDelete.name}] 님이 ${effectiveDate} 일자로 퇴사 처리 삭제 완료되었습니다.`;

                    alert(detailMsg);

                    setShowDeleteModal(false);
                    setEmployeeToDelete(null);
                  }}
                  className="px-4 py-2 bg-rose-500 text-white hover:bg-rose-600 font-extrabold cursor-pointer rounded-xl text-xs transition-colors"
                >
                  삭제 확정
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showEditModal && employeeToEdit && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl p-6 max-w-sm w-full border border-gray-100 shadow-2xl space-y-4"
            >
              <div className="flex items-center gap-2.5 pb-2 border-b border-gray-100 text-[#2E6DB4]">
                <Pencil className="w-5 h-5 shrink-0" />
                <h3 className="text-base font-black text-gray-850">지점 근무 인원 정보 수정</h3>
              </div>

              <div className="space-y-3.5 text-xs">
                {/* 이름수정 */}
                <div className="flex flex-col space-y-1">
                  <span className="font-bold text-gray-400">성명 (이름)</span>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="근무자 실명 입력"
                    className="px-3.5 py-2 border border-gray-200 rounded-xl font-bold text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden text-xs w-full bg-white"
                  />
                </div>

                {/* 계약 구분 수정 */}
                <div className="flex flex-col space-y-1">
                  <span className="font-bold text-gray-400">구분</span>
                  <select
                    value={editDivision}
                    onChange={(e) => {
                      const div = e.target.value as "정직원" | "파트타이머";
                      setEditDivision(div);
                      if (div === "파트타이머") {
                        setEditRank("");
                        setEditCustomRank("");
                      }
                    }}
                    className="px-3.5 py-2 border border-gray-200 rounded-xl bg-white font-bold text-gray-750 focus:border-[#2E6DB4] focus:outline-hidden text-xs w-full"
                  >
                    <option value="정직원">정직원</option>
                    <option value="파트타이머">파트타이머</option>
                  </select>
                </div>

                {/* 직급 수정 */}
                {editDivision === "정직원" && (
                  <div className="flex flex-col space-y-1">
                    <span className="font-bold text-gray-400">직급 선택</span>
                    <select
                      value={editRank}
                      onChange={(e) => {
                        setEditRank(e.target.value);
                        if (e.target.value !== "기타") {
                          setEditCustomRank("");
                        }
                      }}
                      className="px-3.5 py-2 border border-gray-200 rounded-xl bg-white font-bold text-gray-750 focus:border-[#2E6DB4] focus:outline-hidden text-xs w-full"
                    >
                      <option value="">직급 선택</option>
                      {["사원", "대리", "과장", "차장", "실장", "부장", "이사", "대표", "부대표", "기타"].map((rk) => (
                        <option key={rk} value={rk}>{rk}</option>
                      ))}
                    </select>

                    {editRank === "기타" && (
                      <div className="flex flex-col space-y-1 pt-1">
                        <span className="text-[10px] text-gray-400 font-bold">기타 직급 입력</span>
                        <input
                          type="text"
                          value={editCustomRank}
                          onChange={(e) => setEditCustomRank(e.target.value)}
                          placeholder="예: 지점장 등"
                          className="px-3 py-1.5 border border-gray-200 rounded-lg font-bold text-xs bg-white focus:outline-hidden focus:border-[#2E6DB4]"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col space-y-1">
                    <label className="font-bold text-gray-400">주민등록번호</label>
                    <input
                      type="text"
                      value={editResidentNumber}
                      onChange={(e) => setEditResidentNumber(formatResidentNumber(e.target.value))}
                      placeholder="000000-0000000"
                      className="px-3.5 py-2 border border-gray-200 rounded-xl font-mono text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden text-xs w-full"
                    />
                  </div>
                  <div className="flex flex-col space-y-1">
                    <label className="font-bold text-gray-400">계약형태</label>
                    <select
                      value={editContractType}
                      onChange={(e) => setEditContractType(e.target.value as "4대보험" | "3.3%")}
                      className="px-3.5 py-2 border border-gray-200 rounded-xl bg-white font-bold text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden text-xs w-full"
                    >
                      <option value="4대보험">4대보험</option>
                      <option value="3.3%">3.3%</option>
                    </select>
                  </div>
                </div>
                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-gray-400">입사일</label>
                  <input
                    type="date"
                    value={editEntryDate}
                    onChange={(e) => setEditEntryDate(e.target.value)}
                    onClick={(e) => e.currentTarget.showPicker?.()}
                    className="px-3.5 py-2 border border-gray-200 rounded-xl font-mono text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden text-xs w-full cursor-pointer"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-3 border-t border-gray-100 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    setEmployeeToEdit(null);
                  }}
                  className="px-4 py-2 bg-gray-100 text-gray-500 font-extrabold cursor-pointer rounded-xl text-xs hover:bg-gray-200 transition-colors"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="px-4 py-2 bg-[#2E6DB4] text-white hover:bg-[#1A3C6E] font-extrabold cursor-pointer rounded-xl text-xs transition-colors"
                >
                  저장 완료
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Addition Left Form */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm space-y-3">
        <h3 className="text-sm font-black text-gray-800 flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-[#2E6DB4]" />
          신규 등록
        </h3>

        <div className="space-y-2 bg-zinc-50 p-3 rounded-xl border border-gray-150 text-xs">
          {rosterAddDrafts.map((draft, draftIndex) => (
            <div key={draft.id} className="flex flex-wrap items-center gap-2">
              <span className="font-extrabold text-zinc-800 w-8">추가</span>
              <input type="text" placeholder="이름" value={draft.name} onChange={(e) => updateRosterAddDraft(draft.id, { name: e.target.value })} className="w-24 px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:border-zinc-800 focus:outline-hidden font-bold" />
              <select value={draft.division} onChange={(e) => updateRosterAddDraft(draft.id, { division: e.target.value as "정직원" | "파트타이머" })} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white font-extrabold cursor-pointer">
                <option value="정직원">정직원</option>
                <option value="파트타이머">파트타이머</option>
              </select>
              <input type="text" inputMode="numeric" maxLength={6} placeholder="주민 앞6" value={residentBirthKey(draft.residentNumber)} onChange={(e) => updateRosterAddDraft(draft.id, { residentNumber: e.target.value.replace(/\D/g, "").slice(0, 6) })} className="w-24 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:border-zinc-800 focus:outline-hidden font-mono" />
              <select value={draft.addReason} onChange={(e) => updateRosterAddDraft(draft.id, { addReason: parseStaffAddReasonChoice(e.target.value) })} className={`w-32 px-2 py-1.5 text-xs ${getAddReasonChoiceClass(draft.addReason)}`}>
                <option value="">선택</option>
                <option value="신규입사">신규입사</option>
                <option value="지점이동">지점이동</option>
                <option value="기존직원">기존직원</option>
                <option value="기타">기타</option>
              </select>
              {draft.addReason === "신규입사" && (
                <>
                  <label className="flex items-center gap-2 px-2 py-1.5 border border-gray-200 rounded-lg text-xs font-extrabold text-gray-600 bg-white cursor-pointer">
                    <span>입사일</span>
                    <input type="date" value={draft.entryDate} onChange={(e) => updateRosterAddDraft(draft.id, { entryDate: e.target.value })} onClick={(e) => e.currentTarget.showPicker?.()} aria-label="신규입사일" className="w-28 bg-transparent focus:outline-hidden font-mono cursor-pointer" />
                  </label>
                  <label className="flex items-center border border-gray-200 rounded-lg bg-white overflow-hidden text-xs">
                    <span className="px-2 py-1.5 bg-gray-100 text-gray-500 font-extrabold border-r border-gray-200">010</span>
                    <input type="text" inputMode="numeric" placeholder="12345678" value={draft.phoneDigits} onChange={(e) => updateRosterAddDraft(draft.id, { phoneDigits: toPhoneTail8(e.target.value) })} className="w-24 px-2 py-1.5 bg-white focus:outline-hidden font-mono font-bold" aria-label="핸드폰번호 뒤 8자리" />
                  </label>
                </>
              )}
              {draft.addReason === "지점이동" && (
                <>
                  <label className="flex items-center gap-2 px-2 py-1.5 border border-gray-200 rounded-lg text-xs font-extrabold text-gray-600 bg-white cursor-pointer">
                    <span>이동일</span>
                    <input type="date" value={draft.transferDate} onChange={(e) => updateRosterAddDraft(draft.id, { transferDate: e.target.value })} onClick={(e) => e.currentTarget.showPicker?.()} aria-label="이동일" className="w-28 bg-transparent focus:outline-hidden font-mono cursor-pointer" />
                  </label>
                  <select value={draft.salaryChanged} onChange={(e) => updateRosterAddDraft(draft.id, { salaryChanged: parseSalaryChangeChoice(e.target.value) })} className={`w-32 px-2 py-1.5 text-xs ${getSalaryChoiceClass(draft.salaryChanged)}`}>
                    <option value="">선택</option>
                    <option value="없음">급여변동 없음</option>
                    <option value="있음">급여변동 있음</option>
                  </select>
                </>
              )}
              {draft.addReason === "기타" && <input type="text" placeholder="추가 사유" value={draft.addReasonMemo} onChange={(e) => updateRosterAddDraft(draft.id, { addReasonMemo: e.target.value })} className="w-40 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:border-zinc-800 focus:outline-hidden" />}
              {rosterAddDrafts.length > 1 && <button type="button" onClick={() => setRosterAddDrafts((current) => current.filter((item) => item.id !== draft.id))} className="px-2 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-rose-600 font-black">삭제</button>}
              {draftIndex === rosterAddDrafts.length - 1 && <button type="button" onClick={() => setRosterAddDrafts((current) => [...current, createStaffAddDraft()])} className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-zinc-700 font-black hover:bg-gray-100">행 추가</button>}
            </div>
          ))}
          <div className="flex justify-end">
            <button type="button" onClick={registerRosterAddDrafts} className="px-4 py-1.5 bg-[#2E6DB4] hover:bg-[#1A3C6E] text-white font-black rounded-lg cursor-pointer transition-colors">입력한 행 등록</button>
          </div>
        </div>
      </div>

      {/* Roster Right list */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-3">
          <div>
            <h3 className="text-sm font-black text-gray-800">지점 등록 근무 인원</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">명부에 등록된 리스트가 매 정산 기록에 자동 출현합니다.</p>
          </div>

          <div className="flex gap-2 text-[10px] font-black">
            <span className="px-3 py-1 bg-amber-50 text-amber-700 rounded-lg">정직원: {regularCount}명</span>
            <span className="px-3 py-1 bg-blue-50 text-[#2E6DB4] rounded-lg">파트타이머: {partTimeCount}명</span>
          </div>
        </div>

        <div className="overflow-hidden">
          <table className="w-full table-fixed text-left text-xs border-collapse">
            <colgroup>
              <col className="w-[8%]" />
              <col className="w-[13%]" />
              <col className="w-[13%]" />
              <col className="w-[11%]" />
              <col className="w-[14%]" />
              <col className="w-[17%]" />
              <col className="w-[15%]" />
              <col className="w-[9%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-gray-100 text-gray-400 font-bold">
                <th className="py-2.5 px-2 leading-tight">근무자번호</th>
                <th className="py-2.5 px-2 leading-tight">성명</th>
                <th className="py-2.5 px-2 leading-tight">
                  <span className="block">주민등록번호</span>
                  <span className="block">앞6자리</span>
                </th>
                <th className="py-2.5 px-2 leading-tight">분류</th>
                <th className="py-2.5 px-2 leading-tight">추가 사유</th>
                <th className="py-2.5 px-2 leading-tight">
                  <span className="block">입사일자</span>
                  <span className="block">지점이동 날짜</span>
                </th>
                <th className="py-2.5 px-2 leading-tight">
                  <span className="block">핸드폰번호</span>
                  <span className="block">급여변동</span>
                </th>
                <th className="py-2.5 px-2 text-right leading-tight">활동</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-medium">
              {sortedEmployees.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-400">
                    등록된 조원이 아무도 없습니다. 새로운 근무 인원을 명부에 먼저 기입해 보십시오.
                  </td>
                </tr>
              ) : (
                sortedEmployees.map((emp, idx) => {
                  const isEditing = editingEmployeeId === emp.id;
                  const row = isEditing && editingEmployeeDraft?.id === emp.id ? editingEmployeeDraft : emp;
                  const staffReason = row.addReason || "";
                  const hireDate = row.hireDate || (staffReason === "신규입사" ? row.entryDate : "");
                  const transferDate = row.transferDate || (staffReason === "지점이동" ? row.entryDate : "");
                  const phoneTail = toPhoneTail8(row.phone || "");
                  const savedPhoneTail = toPhoneTail8(emp.phone || "");
                  return (
                  <tr key={emp.id} className="hover:bg-gray-50/50 font-semibold text-[11px] sm:text-xs">
                    <td className="py-3 px-2 text-gray-400 font-mono whitespace-nowrap">#{idx + 1}</td>
                    <td className="py-3 px-2 text-gray-800 font-extrabold">
                      {isEditing ? (
                        <input
                          type="text"
                          value={row.name}
                          onChange={(e) => updateEmployeeEditDraft("name", e.target.value)}
                          className="w-full min-w-0 px-2 py-1 border border-gray-200 rounded-md text-xs font-bold focus:border-[#2E6DB4] focus:outline-hidden"
                        />
                      ) : <span className="block truncate" title={emp.name}>{emp.name}</span>}
                    </td>
                    <td className="py-3 px-2">
                      {isEditing ? (
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={residentBirthKey(row.residentNumber)}
                          onChange={(e) => updateEmployeeEditDraft("residentNumber", e.target.value.replace(/\D/g, "").slice(0, 6))}
                          placeholder="앞6자리"
                          className="w-full min-w-0 px-2 py-1 border border-gray-200 rounded-md font-mono text-xs text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden"
                        />
                      ) : <span className="font-mono text-xs text-gray-600">{residentBirthKey(emp.residentNumber) || "-"}</span>}
                    </td>
                    <td className="py-3 px-2">
                      {isEditing ? (
                        <select
                          value={row.division}
                          onChange={(e) => updateEmployeeEditDraft("division", e.target.value)}
                          className={`w-full max-w-full px-1.5 py-1 rounded-lg text-[10px] font-black border focus:outline-hidden cursor-pointer ${
                            row.division === "정직원"
                              ? "bg-amber-50 text-amber-700 border-amber-200 focus:border-amber-400"
                              : "bg-blue-50 text-[#2E6DB4] border-blue-200 focus:border-blue-400"
                          }`}
                        >
                          <option value="정직원">정직원</option>
                          <option value="파트타이머">파트타이머</option>
                        </select>
                      ) : <span className={`inline-flex max-w-full px-1.5 py-1 rounded-lg text-[10px] font-black ${emp.division === "정직원" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-[#2E6DB4]"}`} title={emp.division}><span className="truncate">{emp.division}</span></span>}
                    </td>
                    <td className="py-3 px-2">
                      {isEditing ? (
                        <select
                          value={staffReason}
                          onChange={(e) => updateEmployeeEditDraft("addReason", e.target.value)}
                          className={`w-full min-w-0 px-1.5 py-1 text-[11px] ${getAddReasonChoiceClass(staffReason)} ${!staffReason ? "branch-choice-required" : ""}`}
                        >
                          <option value="">선택</option>
                          <option value="신규입사">신규입사</option>
                          <option value="지점이동">지점이동</option>
                          <option value="기존직원">기존직원</option>
                          <option value="기타">기타</option>
                        </select>
                      ) : (
                        <span className={`inline-flex w-full min-w-0 justify-center rounded-lg px-1.5 py-1 text-[11px] font-black ${getAddReasonChoiceClass(staffReason)} ${!staffReason ? "branch-choice-required" : ""} branch-choice-badge`}>
                          {staffReason || "선택"}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-2">
                      {isEditing && staffReason === "신규입사" && (
                        <input
                          type="date"
                          value={hireDate || ""}
                          onChange={(e) => updateEmployeeEditDraft("hireDate", e.target.value)}
                          onClick={(e) => e.currentTarget.showPicker?.()}
                          className="w-full min-w-0 px-1.5 py-1 border border-gray-200 rounded-md font-mono text-[11px] text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden cursor-pointer"
                          aria-label={`${emp.name} 입사일자`}
                        />
                      )}
                      {isEditing && staffReason === "지점이동" && (
                        <input
                          type="date"
                          value={transferDate || ""}
                          onChange={(e) => updateEmployeeEditDraft("transferDate", e.target.value)}
                          onClick={(e) => e.currentTarget.showPicker?.()}
                          className="w-full min-w-0 px-1.5 py-1 border border-gray-200 rounded-md font-mono text-[11px] text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden cursor-pointer"
                          aria-label={`${emp.name} 지점이동 날짜`}
                        />
                      )}
                      {isEditing && staffReason === "기타" && (
                        <input
                          type="text"
                          value={row.addReasonMemo || ""}
                          onChange={(e) => updateEmployeeEditDraft("addReasonMemo", e.target.value)}
                          placeholder="사유"
                          className="w-full min-w-0 px-1.5 py-1 border border-gray-200 rounded-md text-[11px] font-bold text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden"
                        />
                      )}
                      {!isEditing && staffReason === "신규입사" && <span className="font-mono text-[11px] text-gray-600">{hireDate || "-"}</span>}
                      {!isEditing && staffReason === "지점이동" && <span className="font-mono text-[11px] text-gray-600">{transferDate || "-"}</span>}
                      {!isEditing && staffReason === "기타" && <span className="block truncate text-[11px] text-gray-600" title={row.addReasonMemo || ""}>{row.addReasonMemo || "-"}</span>}
                      {!staffReason && <span className="inline-flex rounded-md border border-dashed border-gray-200 bg-white px-2 py-1 text-[11px] font-black text-gray-400">선택</span>}
                      {staffReason === "기존직원" && <span className="text-xs text-gray-400">-</span>}
                    </td>
                    <td className="py-3 px-2">
                      {isEditing && staffReason === "신규입사" && (
                        <label className="flex w-full min-w-0 items-center overflow-hidden rounded-md border border-gray-200 bg-white focus-within:border-[#2E6DB4]">
                          <span className="shrink-0 border-r border-gray-200 bg-gray-50 px-1.5 py-1 text-[10px] font-black text-gray-400">010</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={8}
                            value={phoneTail}
                            onChange={(e) => updateEmployeeEditDraft("phone", e.target.value.replace(/\D/g, "").slice(0, 8))}
                            placeholder="새 번호 입력"
                            className="min-w-0 flex-1 bg-transparent px-1.5 py-1 font-mono text-[11px] font-bold text-gray-700 focus:outline-hidden"
                            aria-label={`${emp.name} 핸드폰번호 뒤 8자리`}
                          />
                        </label>
                      )}
                      {isEditing && staffReason === "지점이동" && (
                        <select
                          value={row.salaryChanged || ""}
                          onChange={(e) => updateEmployeeEditDraft("salaryChanged", e.target.value)}
                          className={`w-full min-w-0 px-1.5 py-1 text-[11px] ${getSalaryChoiceClass(row.salaryChanged || "")}`}
                        >
                          <option value="">선택</option>
                          <option value="없음">급여변동 없음</option>
                          <option value="있음">급여변동 있음</option>
                        </select>
                      )}
                      {!isEditing && staffReason === "신규입사" && <span className={`branch-sensitive-hidden ${savedPhoneTail ? "" : "branch-sensitive-missing"}`}>{savedPhoneTail ? "본사 전송" : "미입력"}</span>}
                      {!isEditing && staffReason === "지점이동" && <span className={`branch-sensitive-hidden ${emp.salaryChanged ? "" : "branch-sensitive-missing"}`}>{emp.salaryChanged ? "본사 전송" : "미입력"}</span>}
                      {!staffReason && <span className="inline-flex rounded-md border border-dashed border-gray-200 bg-white px-2 py-1 text-[11px] font-black text-gray-400">선택</span>}
                      {(staffReason === "기존직원" || staffReason === "기타") && <span className="text-xs text-gray-400">-</span>}
                    </td>
                    <td className="py-3 px-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={saveEmployeeEdit}
                              className="p-1.5 rounded-lg bg-[#2E6DB4] text-white"
                              title="저장"
                              aria-label="저장"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={cancelEmployeeEdit}
                              className="p-1.5 rounded-lg bg-gray-100 text-gray-500 hover:text-gray-800"
                              title="취소"
                              aria-label="취소"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEmployeeEdit(emp)}
                            className="text-gray-400 hover:text-[#2E6DB4] p-1.5 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                            title="정보 수정"
                            aria-label="정보 수정"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setEmployeeToDelete(emp);
                            setDeleteReason("퇴사");
                            setShowDeleteModal(true);
                          }}
                          className="text-gray-400 hover:text-rose-600 p-1.5 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                          title="명부 삭제"
                          aria-label="명부 삭제"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AnnualLeaveTab({ branchName, isAdmin = false }: { branchName: string; isAdmin?: boolean }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [employeeId, setEmployeeId] = useState(""); const [startDate, setStartDate] = useState(toLocalDateInputValue()); const [endDate, setEndDate] = useState(toLocalDateInputValue()); const [reason, setReason] = useState("");
  const load = useCallback(async () => { const [roster, saved] = await Promise.all([gasClient.getBranchOwnRoster(branchName), gasClient.getSharedData<any[]>(`annual_leave:${branchName}`)]); setEmployees((roster as Employee[]).map((employee) => ({ ...employee, entryDate: employee.entryDate ? employee.entryDate.slice(2).replace(/-/g, ".") : "" }))); setEntries(saved || []); }, [branchName]);
  useEffect(() => { void load(); }, [load]);
  if (!isAdmin) return (
    <div className="space-y-5" id="annual-leave-maintenance">
      <section className="bg-white p-6 rounded-2xl border shadow-sm">
        <h3 className="font-black text-gray-800">연차관리</h3>
        <p className="text-sm font-bold text-gray-600 mt-2">현재 코드 수정중이므로 작성이 불가능합니다.</p>
      </section>
    </div>
  );
  const save = async () => { const days = Math.floor((new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86400000) + 1; if (!employeeId || days < 1 || !reason.trim()) return; const next = [{ id: `leave-${Date.now()}`, employeeId, days, startDate, endDate, date: startDate, reason: reason.trim() }, ...entries]; await gasClient.saveSharedData(`annual_leave:${branchName}`, next); setEntries(next); setReason(""); };
  return <div className="space-y-5"><section className="bg-white p-4 rounded-2xl border shadow-sm text-sm font-bold text-gray-600">현재 코드 수정중이므로 작성이 불가능합니다.</section><div className="bg-white p-6 rounded-2xl border shadow-sm"><h3 className="font-black text-gray-800">연차관리</h3><p className="text-xs text-gray-400 mt-1">시작일과 종료일을 선택하면 사용 일수가 자동 계산됩니다.</p><div className="flex flex-wrap gap-2 mt-4"><select value={employeeId} onChange={e=>setEmployeeId(e.target.value)} className="border rounded px-3 py-2 text-sm"><option value="">직원 선택</option>{employees.filter(e=>e.division === "정직원").map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select><label className="text-xs">시작일<input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="block border rounded px-2 py-1"/></label><label className="text-xs">종료일<input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="block border rounded px-2 py-1"/></label><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="사용 사유" className="border rounded px-3"/><button onClick={()=>void save()} className="bg-[#2E6DB4] text-white rounded px-4 text-sm font-bold">연차 사용 등록</button></div></div><div className="bg-white rounded-2xl border overflow-hidden"><table className="w-full text-sm"><thead><tr className="bg-gray-50 text-left"><th className="p-3">직원</th><th>입사일</th><th>부여</th><th>사용</th><th>잔여</th><th>사용 날짜 기록</th></tr></thead><tbody>{employees.filter(e=>e.division === "정직원").map(e=>{const logs=entries.filter(x=>x.employeeId===e.id);const used=logs.reduce((s,x)=>s+Number(x.days||0),0);return <tr key={e.id} className="border-t"><td className="p-3 font-bold">{e.name}</td><td>{e.entryDate||"-"}</td><td>15일</td><td>{used}일</td><td className="font-bold text-[#2E6DB4]">{15-used}일</td><td className="text-xs text-gray-500">{logs.map(x=>`${x.startDate || x.date}${x.endDate && x.endDate !== (x.startDate || x.date) ? ` ~ ${x.endDate}` : ""}`).join(", ") || "-"}</td></tr>})}</tbody></table></div></div>;
}

function LaborContractTab({ branchName, isAdmin = false }: { branchName: string; isAdmin?: boolean }) {
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [salary, setSalary] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhoneDigits, setEditPhoneDigits] = useState("");
  const loadData = async () => { try { setLoading(true); const data = await gasClient.getSharedData<any[]>("labor_contracts_" + branchName); const legacy = data || await gasClient.getSharedData<any[]>("labor_contracts:" + branchName); setContracts(legacy || []); } catch (err) { console.error("Failed to load labor contracts:", err); } finally { setLoading(false); } };
  useEffect(() => { void loadData(); }, [branchName]);
  if (!isAdmin) return (
    <div className="space-y-5 animate-fade-in" id="labor-contract-tab">
      <section className="bg-white p-6 rounded-2xl border shadow-sm">
        <h3 className="font-black text-gray-800">근로계약서</h3>
        <p className="text-sm font-bold text-gray-600 mt-2">현재 코드 수정중이므로 작성이 불가능합니다.</p>
      </section>
    </div>
  );
  const formatPhone = (digits: string) => "010-" + digits.slice(0, 4) + "-" + digits.slice(4);
  const parseSalaryInput = (rawVal: string): number => { const raw = rawVal.trim(); if (!raw) return 0; if (raw.includes("만")) return Math.round((parseFloat(raw.replace(/[^0-9.]/g, "")) || 0) * 10000); const numeric = raw.replace(/[,원\s]/g, ""); let parsed = parseFloat(numeric) || 0; if (parsed > 0 && parsed < 1000) parsed *= 10000; else if (parsed >= 1000 && parsed < 10000) parsed *= 1000; return Math.round(parsed); };
  const saveContracts = async (next: any[]) => { await gasClient.saveSharedData("labor_contracts_" + branchName, next); await gasClient.saveSharedData("labor_contracts:" + branchName, next); setContracts(next); };
  const saveContract = async () => { const digits = phoneDigits.replace(/[^0-9]/g, "").slice(0, 8); if (!name.trim() || digits.length !== 8 || !salary.trim()) { alert("이름, 연락처 8자리, 급여를 모두 입력해 주세요."); return; } const numericSalary = parseSalaryInput(salary); if (!numericSalary) { alert("급여를 올바르게 입력해 주세요."); return; } const next = [{ id: "contract-" + Date.now(), name: name.trim(), phone: formatPhone(digits), salary: numericSalary, status: "발송 대기", createdAt: new Date().toISOString() }, ...contracts]; await saveContracts(next); setName(""); setPhoneDigits(""); setSalary(""); };
  const startEdit = (contract: any) => { setEditingId(contract.id); setEditName(contract.name || ""); setEditPhoneDigits(String(contract.phone || "").replace(/^010-?/, "").replace(/[^0-9]/g, "").slice(0, 8)); };
  const saveEdit = async (id: string) => { const digits = editPhoneDigits.replace(/[^0-9]/g, "").slice(0, 8); if (!editName.trim() || digits.length !== 8) { alert("이름과 연락처 8자리를 확인해 주세요."); return; } const next = contracts.map((item) => item.id === id ? { ...item, name: editName.trim(), phone: formatPhone(digits), editRequestedAt: new Date().toISOString() } : item); await saveContracts(next); setEditingId(null); };
  const requestDelete = async (id: string) => { if (!window.confirm("삭제요청을 관리자에게 전달할까요? 급여가 다른 경우에는 삭제요청 후 새로 등록해 주세요.")) return; const next = contracts.map((item) => item.id === id ? { ...item, deleteRequested: true, deleteRequestedAt: new Date().toISOString() } : item); await saveContracts(next); };
  return <div className="space-y-5 animate-fade-in" id="labor-contract-tab"><section className="bg-white p-4 rounded-2xl border shadow-sm text-sm font-bold text-gray-600">현재 코드 수정중이므로 작성이 불가능합니다.</section><div className="bg-white p-6 rounded-2xl border shadow-sm"><h3 className="font-black text-gray-800 text-lg flex items-center gap-2"><Briefcase className="w-5 h-5 text-[#2E6DB4]" /> 근로계약서 발송 인적사항 등록</h3><p className="text-xs text-gray-400 mt-1">급여가 잘못된 경우에는 기존 내역 삭제요청 후 새로 등록해 주세요.</p><div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-5 items-end"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold bg-gray-50" /><div className="flex items-center border border-gray-200 rounded-xl bg-gray-50 overflow-hidden"><span className="bg-gray-100 px-3 py-2 text-sm font-extrabold text-gray-400 border-r">010</span><input value={phoneDigits} onChange={(e) => setPhoneDigits(e.target.value.replace(/[^0-9]/g, "").slice(0, 8))} placeholder="12345678" className="w-full px-3 py-2 text-sm font-bold bg-transparent outline-none" /></div><input value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="급여 예: 250만" className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold bg-gray-50" /><button onClick={() => void saveContract()} className="bg-[#2E6DB4] hover:bg-[#20528B] text-white py-2 px-4 rounded-xl text-xs font-black h-10">등록</button></div></div><div className="bg-white rounded-2xl border overflow-hidden shadow-2xs"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="bg-gray-50 text-left border-b text-gray-500 font-extrabold text-xs"><th className="p-4 w-36">등록일</th><th className="py-4 px-3 w-40">이름</th><th className="py-4 px-3 w-44">연락처</th><th className="py-4 px-3">안내</th><th className="py-4 px-3 text-center w-44">요청</th></tr></thead><tbody>{loading ? <tr><td colSpan={5} className="p-12 text-center"><LoadingSpinner size="sm" /></td></tr> : contracts.length === 0 ? <tr><td colSpan={5} className="p-12 text-center text-gray-400 font-bold">등록된 인적사항이 없습니다.</td></tr> : contracts.map((c) => <tr key={c.id} className="border-b hover:bg-slate-50/50"><td className="p-4 font-mono text-xs text-gray-500">{c.createdAt ? c.createdAt.slice(0, 10) : "-"}</td><td className="py-4 px-3 font-black text-gray-800">{editingId === c.id ? <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full border rounded-lg px-2 py-1" /> : c.name}</td><td className="py-4 px-3 font-mono text-xs text-blue-700 font-black">{editingId === c.id ? <div className="flex items-center"><span className="text-gray-400 mr-1">010</span><input value={editPhoneDigits} onChange={(e) => setEditPhoneDigits(e.target.value.replace(/[^0-9]/g, "").slice(0, 8))} className="w-28 border rounded-lg px-2 py-1" /></div> : c.phone}</td><td className="py-4 px-3 text-xs text-gray-500">{c.deleteRequested ? <span className="font-black text-rose-600">삭제요청됨</span> : "급여 변경은 삭제요청 후 새로 등록"}</td><td className="py-4 px-3 text-center space-x-2">{editingId === c.id ? <button onClick={() => void saveEdit(c.id)} className="px-3 py-1.5 bg-[#2E6DB4] text-white rounded-lg text-xs font-black">저장</button> : <button onClick={() => startEdit(c)} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-black">수정</button>}<button onClick={() => void requestDelete(c.id)} className="px-3 py-1.5 bg-rose-50 text-rose-700 rounded-lg text-xs font-black">삭제요청</button></td></tr>)}</tbody></table></div></div></div>;
}

// ----------------------------------------------------
// TAB 4: Overtime Log Tab (초과근무일지)
// ----------------------------------------------------
function OvertimeLogTab({ branchName, isAdmin = false }: { branchName: string; isAdmin?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<any[]>([]);
  const [summaryList, setSummaryList] = useState<any[]>([]);
  const [manualName, setManualName] = useState("");
  const [manualHours, setManualHours] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [manualDate, setManualDate] = useState(toLocalDateInputValue());
  const [selectedMonth, setSelectedMonth] = useState(() => toLocalMonthInputValue());
  const [nameFilter, setNameFilter] = useState("");
  const [editOvertime, setEditOvertime] = useState<{ row: any; fields: Record<string, string> } | null>(null);

  const loadData = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(true);
      const [log, manual] = await Promise.all([gasClient.getAttendanceLog(branchName, "overtime", selectedMonth, forceRefresh), gasClient.getSharedData<any[]>(`manual_overtime:${branchName}`)]);
      const manualRows = (manual || []).map((item) => ({
        ...item,
        clockIn: "수기",
        clockOut: "수기",
        workHours: "-",
        standardHours: "-",
        overtime: Number(item.overtime ?? item.overtimeHours ?? item.hours ?? item.totalOvertime ?? 0),
        overtimeReason: item.reason,
        manual: true
      }));
      const all = [...(log.records || []), ...manualRows].sort((a, b) => String(b.settleDate).localeCompare(String(a.settleDate)));
      const selectedRecords = all.filter((item) => String(item.settleDate || "").slice(0, 7) === selectedMonth);
      setRecords(selectedRecords);
      const totals = new Map<string, { previous: number; current: number; previousManual: number; currentManual: number; previousAuto: number; currentAuto: number }>();
      all.forEach((item) => {
        const settleMonth = String(item.settleDate || "").slice(0, 7);
        if (!item.staffName || settleMonth > selectedMonth) return;
        const current = totals.get(item.staffName) || { previous: 0, current: 0, previousManual: 0, currentManual: 0, previousAuto: 0, currentAuto: 0 };
        const overtimeHours = Number(item.overtime ?? item.overtimeHours ?? item.hours ?? item.totalOvertime ?? 0) || 0;
        if (settleMonth < selectedMonth) {
          current.previous += overtimeHours;
          if (item.manual) current.previousManual += overtimeHours;
          else current.previousAuto += overtimeHours;
        } else if (settleMonth === selectedMonth) {
          current.current += overtimeHours;
          if (item.manual) current.currentManual += overtimeHours;
          else current.currentAuto += overtimeHours;
        }
        totals.set(item.staffName, current);
      });
      setSummaryList(Array.from(totals, ([name, value]) => ({
        name,
        ...value,
        totalOvertime: value.previous + value.current,
        manualOvertime: value.previousManual + value.currentManual,
        autoOvertime: value.previousAuto + value.currentAuto
      })).filter((item) =>
        item.current !== 0 ||
        item.previous !== 0 ||
        item.manualOvertime !== 0 ||
        item.autoOvertime !== 0
      ));

    } catch (e) {
      console.error("Overtime database read error:", e);
    } finally {
      setLoading(false);
    }
  }, [branchName, selectedMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const normalizedNameFilter = nameFilter.trim().toLowerCase();
  const filteredRecords = useMemo(() => {
    if (!normalizedNameFilter) return records;
    return records.filter((record) => String(record.staffName || "").toLowerCase().includes(normalizedNameFilter));
  }, [normalizedNameFilter, records]);
  const filteredSummaryList = useMemo(() => {
    if (!normalizedNameFilter) return summaryList;
    return summaryList.filter((item) => String(item.name || "").toLowerCase().includes(normalizedNameFilter));
  }, [normalizedNameFilter, summaryList]);

  const saveManualOvertime = async () => {
    if (!manualName.trim() || !manualHours.trim() || !manualReason.trim()) {
      alert("직원명, 시간, 수기 입력 사유를 모두 채워주세요.");
      return;
    }
    if (!/^\d+(\.\d+)?$/.test(manualHours)) {
      alert("시간은 숫자 형식으로만 입력해 주세요. (예: 2시간 30분 ➔ 2.5)");
      return;
    }
    const hours = Number(manualHours);
    if (hours <= 0) {
      alert("초과 근무 시간은 0보다 커야 합니다.");
      return;
    }
    if (hours >= 5) {
      const ok = window.confirm(`초과 근무 시간이 5시간 이상(${hours}시간)으로 기재되었습니다. 오타(예: 25 등)가 아닌 것이 확실한가요?\n정말 등록하시겠습니까?`);
      if (!ok) return;
    }
    const key = `manual_overtime:${branchName}`;
    const previous = (await gasClient.getSharedData<any[]>(key)) || [];
    await gasClient.saveSharedData(key, [{ id: `manual-${Date.now()}`, staffName: manualName.trim(), settleDate: manualDate, overtime: hours, reason: manualReason.trim(), createdAt: new Date().toISOString() }, ...previous]);
    setManualName(""); setManualHours(""); setManualReason(""); await loadData();
  };

  const handleEditOvertimeRow = (row: any) => {
    setEditOvertime({
      row,
      fields: {
        overtime: toNumberPromptValue(row.overtime),
        reason: row.overtimeReason === "-" ? "" : String(row.overtimeReason || "")
      }
    });
  };

  const saveEditOvertimeRow = async () => {
    if (!editOvertime) return;
    const { row, fields } = editOvertime;
    const hours = Number(fields.overtime);
    if (!Number.isFinite(hours)) {
      alert("숫자 형식으로 입력해주세요.");
      return;
    }
    if (!fields.reason.trim()) {
      alert("초과근무 시간이 0이 아니면 사유가 필요합니다.");
      return;
    }
    if (row.manual) {
      const key = `manual_overtime:${branchName}`;
      const saved = (await gasClient.getSharedData<any[]>(key)) || [];
      await gasClient.saveSharedData(key, saved.map((item) => item.id === row.id ? { ...item, overtime: hours, reason: fields.reason.trim() } : item));
    } else if (row.recordId) {
      await updateDailyMetadata(row.recordId, (metadata, detail) => {
        const staffRows = Array.isArray(metadata.staffRows) ? metadata.staffRows : [];
        const nextRows = staffRows.map((staff: any) => {
          const name = staff.staffName || staff.name;
          return name === row.staffName ? { ...staff, overtime: hours, overtimeReason: fields.reason.trim() } : staff;
        });
        const nextStaff = (detail.staff || []).map((staff: any) => {
          const name = staff.staffName || staff.name;
          return name === row.staffName ? { ...staff, overtimeHours: hours, memo: fields.reason.trim() } : staff;
        });
        return { metadata: { ...metadata, staffRows: nextRows }, staff: nextStaff };
      });
    }
    setEditOvertime(null);
    await loadData();
  };

  const handleDeleteOvertimeRow = async (row: any) => {
    if (!window.confirm(`${row.staffName}님의 ${row.settleDate} 초과근무 기록을 삭제할까요?`)) return;
    if (row.manual) {
      const key = `manual_overtime:${branchName}`;
      const saved = (await gasClient.getSharedData<any[]>(key)) || [];
      await gasClient.saveSharedData(key, saved.filter((item) => item.id !== row.id));
    } else if (row.recordId) {
      await updateDailyMetadata(row.recordId, (metadata, detail) => {
        const staffRows = Array.isArray(metadata.staffRows) ? metadata.staffRows : [];
        const nextRows = staffRows.map((staff: any) => {
          const name = staff.staffName || staff.name;
          return name === row.staffName ? { ...staff, overtime: 0, overtimeReason: "" } : staff;
        });
        const nextStaff = (detail.staff || []).map((staff: any) => {
          const name = staff.staffName || staff.name;
          return name === row.staffName ? { ...staff, overtimeHours: 0, memo: "" } : staff;
        });
        return { metadata: { ...metadata, staffRows: nextRows }, staff: nextStaff };
      });
    }
    await loadData();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {editOvertime && (
        <AdminRecordEditModal
          title={`${editOvertime.row.staffName} 초과근무 수정`}
          fields={[
            { key: "overtime", label: "초과근무 시간", value: editOvertime.fields.overtime, type: "number" },
            { key: "reason", label: "초과/조기퇴근 사유", value: editOvertime.fields.reason }
          ]}
          onChange={(key, value) => setEditOvertime((current) => current ? { ...current, fields: { ...current.fields, [key]: value } } : current)}
          onCancel={() => setEditOvertime(null)}
          onSave={() => void saveEditOvertimeRow()}
        />
      )}
      {/* List Table Left */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm lg:col-span-2 space-y-4">
        <div className="flex flex-col gap-3 border-b border-gray-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-black text-gray-800 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-[#2E6DB4]" />
              초과 근무 내역
            </h3>
            <p className="text-[10px] text-gray-400 mt-0.5">정직원 초과근무 기록만 표시됩니다.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-40">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                placeholder="이름 검색"
                aria-label="초과근무 직원명 검색"
                className="h-8 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-7 text-xs font-bold text-gray-700 outline-none transition focus:border-[#2E6DB4]"
              />
              {nameFilter && (
                <button
                  type="button"
                  onClick={() => setNameFilter("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  title="검색어 지우기"
                  aria-label="검색어 지우기"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-extrabold bg-white" />
            <button
              onClick={() => void loadData(true)}
              className="p-1 px-2.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-500 rounded-lg text-[10px] font-extrabold flex items-center gap-1 cursor-pointer transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> 새로고침
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 rounded-xl bg-gray-50 p-3 border border-gray-100">
          <span className="w-full text-xs font-black text-gray-600">초과근무 수기 입력</span>
          <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="직원명" className="w-24 px-2 py-1 border rounded text-xs" />
          <input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} className="px-2 py-1 border rounded text-xs" />
          <div className="relative">
            <input value={manualHours} onChange={(e) => setManualHours(e.target.value)} placeholder="시간" className="w-16 px-2 py-1 border rounded text-xs" />
            {manualHours.length > 0 && !/^\d+(\.\d+)?$/.test(manualHours) && (
              <div className="absolute z-10 bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-black p-2 rounded-xl shadow-md -bottom-12 left-0 whitespace-nowrap animate-bounce">
                숫자만 기입해 주세요! (예: 2시간 30분 ➔ 2.5)
              </div>
            )}
            {manualHours.length > 0 && /^\d+(\.\d+)?$/.test(manualHours) && Number(manualHours) >= 5 && (
              <div className="absolute z-10 bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-black p-2 rounded-xl shadow-md -bottom-12 left-0 whitespace-nowrap animate-bounce">
                ⚠️ 5시간 이상 입력됨. 오타(예: 25)가 아닌가요?
              </div>
            )}
          </div>
          <input value={manualReason} onChange={(e) => setManualReason(e.target.value)} placeholder="수기 입력 사유 (필수)" className="grow min-w-36 px-2 py-1 border rounded text-xs" />
          <button onClick={() => void saveManualOvertime()} className="px-3 py-1 bg-[#2E6DB4] text-white rounded text-xs font-bold">등록</button>
        </div>

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-2">
            <LoadingSpinner size="md" />
            <span className="text-xs text-gray-400 font-bold">마감 기록실에서 초과근무 장부를 이첩 중...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400 font-bold">
                  <th className="py-2.5 px-2">마감일자</th>
                  <th className="py-2.5 px-2">직원명</th>
                  <th className="py-2.5 px-2">출근</th>
                  <th className="py-2.5 px-2">퇴근</th>
                  <th className="py-2.5 px-2 text-center">근무시간</th>
                  <th className="py-2.5 px-2 text-center">기준근무</th>
                  <th className="py-2.5 px-2 text-center">초과시간</th>
                  <th className="py-2.5 px-2 max-w-[150px]">초과사유 및 경위</th>
                  {isAdmin && <th className="py-2.5 px-2 text-center">관리</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium">
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 9 : 8} className="py-16 text-center text-gray-400">
                      {normalizedNameFilter ? "검색된 초과근무 기록이 없습니다." : "기록된 임직원 초과근무가 전혀 없습니다."}
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((r, idx) => (
                    <tr key={idx} className="hover:bg-gray-50/50">
                      <td className="py-3 px-2 font-mono text-[11px] text-gray-400">{r.settleDate}</td>
                      <td className="py-3 px-2 font-extrabold text-gray-800">{r.staffName}</td>
                      <td className="py-3 px-2 font-mono text-gray-500">{r.clockIn}</td>
                      <td className="py-3 px-2 font-mono text-gray-500">{r.clockOut}</td>
                      <td className="py-3 px-2 text-center font-bold text-gray-650">{r.workHours}h</td>
                      <td className="py-3 px-2 text-center text-gray-400">{r.standardHours}h</td>
                      <td className="py-3 px-2 text-center">
                        {r.overtime < 0 ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-black bg-amber-50 text-amber-700 font-bold">
                            {r.overtime}h (조기퇴근)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-black bg-emerald-50 text-emerald-800 font-bold">
                            +{r.overtime}h
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-2 max-w-[150px] truncate scrollbar-none font-bold text-gray-500" title={r.overtimeReason}>
                        {r.overtimeReason}
                      </td>
                      {isAdmin && (
                        <td className="py-3 px-2">
                          <div className="flex justify-center gap-1">
                            <button onClick={() => void handleEditOvertimeRow(r)} className="px-2 py-1 rounded-lg border border-blue-100 bg-blue-50 text-blue-700 text-[10px] font-black">수정</button>
                            <button onClick={() => void handleDeleteOvertimeRow(r)} className="px-2 py-1 rounded-lg border border-rose-100 bg-rose-50 text-rose-700 text-[10px] font-black">삭제</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Aggregate Widget Right */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm h-fit space-y-4">
        <div>
          <h3 className="text-sm font-black text-gray-800">초과 근무 인원 집계</h3>
          <p className="text-[10px] text-gray-400 mt-0.5">누적된 초과 및 음수 근태 보정 시간을집계 대조합니다.</p>
        </div>

        <div className="divide-y divide-gray-50 font-bold text-xs">
          {filteredSummaryList.length === 0 ? (
            <p className="py-8 text-center text-gray-400">
              {normalizedNameFilter ? "검색된 집계 대상자가 없습니다." : "집계 가능한 초과근무 대상자가 없습니다."}
            </p>
          ) : (
            filteredSummaryList.map((item, idx) => (
              <div key={idx} className="py-3 flex items-center justify-between">
                <span className="text-gray-700 font-extrabold">{item.name}</span>
                <span className={`text-[11px] font-mono p-1 px-2.5 rounded-xl ${
                  item.totalOvertime < 0
                    ? "bg-amber-50 text-amber-700 font-extrabold"
                    : item.totalOvertime === 0
                    ? "bg-gray-100 text-gray-500"
                    : "bg-emerald-50 text-emerald-800 font-extrabold"
                }`}>
                  <span>{`전월누적 ${item.previous || 0}h · 이번달 ${item.current || 0}h · `}</span>
                  <span className={Number(item.totalOvertime || 0) > 24 ? "text-[#C93A3A] font-black" : ""}>
                    {`총 ${item.totalOvertime}h`}
                  </span>
                  {(item.manualOvertime !== 0 || item.autoOvertime !== 0) && (
                    <span className="block mt-0.5 text-[10px] text-gray-400">
                      {`수기 ${item.manualOvertime || 0}h · 자동/차감 ${item.autoOvertime || 0}h`}
                    </span>
                  )}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// TAB 5: Part-Timer Log Tab (파트타이머일지)
// ----------------------------------------------------
function PartTimeLogTab({ branchName, isAdmin = false }: { branchName: string; isAdmin?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<any[]>([]);
  const [summaryList, setSummaryList] = useState<any[]>([]);
  const [editPartTime, setEditPartTime] = useState<{ row: any; fields: Record<string, string> } | null>(null);

  // States for manual part-timer entry
  const [manualName, setManualName] = useState("");
  const [manualHours, setManualHours] = useState("9");
  const [manualDate, setManualDate] = useState(toLocalDateInputValue());
  const [manualReason, setManualReason] = useState("");
  const [manualClockIn, setManualClockIn] = useState("09:00");
  const [manualClockOut, setManualClockOut] = useState("18:00");
  const [manualClockInError, setManualClockInError] = useState("");
  const [manualClockOutError, setManualClockOutError] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(() => toLocalMonthInputValue());

  const recalculateHours = (clockIn: string, clockOut: string) => {
    const trimmedIn = clockIn.trim();
    const trimmedOut = clockOut.trim();

    if (!trimmedIn || !trimmedOut) {
      setManualHours("");
      return;
    }

    const matchIn = trimmedIn.match(/^(?:([01]?\d|2[0-3]):([0-5]\d)|([01]?\d|2[0-3])([0-5]\d))$/);
    const matchOut = trimmedOut.match(/^(?:([01]?\d|2[0-3]):([0-5]\d)|([01]?\d|2[0-3])([0-5]\d))$/);

    const errIn = trimmedIn && !matchIn ? "24시간제 예: 09:00 또는 1530" : "";
    const errOut = trimmedOut && !matchOut ? "24시간제 예: 09:00 또는 1530" : "";

    setManualClockInError(errIn);
    setManualClockOutError(errOut);

    if (matchIn && matchOut) {
      const hIn = (matchIn[1] || matchIn[3]).padStart(2, "0");
      const mIn = matchIn[2] || matchIn[4];
      const hOut = (matchOut[1] || matchOut[3]).padStart(2, "0");
      const mOut = matchOut[2] || matchOut[4];

      const inDecimal = Number(hIn) + Number(mIn) / 60;
      const outDecimal = Number(hOut) + Number(mOut) / 60;

      let calculated = outDecimal - inDecimal;
      if (calculated < 0) {
        calculated += 24; // Overnight shift support
      }
      setManualHours(String(parseFloat(calculated.toFixed(1))));
    } else {
      setManualHours("");
    }
  };

  const handleClockInChange = (val: string) => {
    setManualClockIn(val);
    recalculateHours(val, manualClockOut);
  };

  const handleClockOutChange = (val: string) => {
    setManualClockOut(val);
    recalculateHours(manualClockIn, val);
  };

  const handleClockBlur = (field: "in" | "out") => {
    const val = field === "in" ? manualClockIn : manualClockOut;
    const match = val.trim().match(/^(?:([01]?\d|2[0-3]):([0-5]\d)|([01]?\d|2[0-3])([0-5]\d))$/);
    if (match) {
      const h = (match[1] || match[3]).padStart(2, "0");
      const m = match[2] || match[4];
      const formatted = `${h}:${m}`;
      if (field === "in") {
        setManualClockIn(formatted);
        recalculateHours(formatted, manualClockOut);
      } else {
        setManualClockOut(formatted);
        recalculateHours(manualClockIn, formatted);
      }
    }
  };

  const loadData = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(true);
      const [log, manual] = await Promise.all([
        gasClient.getAttendanceLog(branchName, "partTime", selectedMonth, forceRefresh),
        gasClient.getSharedData<any[]>(`manual_parttime:${branchName}`)
      ]);

      const manualRows = (manual || []).map((item) => ({
        ...item,
        writer: item.writer || "수기",
        manual: true
      }));

      const all = [...(log.records || []), ...manualRows].sort((a, b) => String(b.settleDate).localeCompare(String(a.settleDate)));
      const selectedRecords = all.filter((item) => String(item.settleDate || "").slice(0, 7) === selectedMonth);
      setRecords(selectedRecords);

      // Re-calculate the part-time summary aggregate including manual records
      const totals = new Map<string, { daysCount: number; workedDates: string[]; totalHours: number }>();
      selectedRecords.forEach((item) => {
        const name = item.staffName;
        if (!name) return;
        const current = totals.get(name) || { daysCount: 0, workedDates: [], totalHours: 0 };
        current.daysCount += 1;

        // formats date to MM.DD
        let formattedDate = String(item.settleDate);
        if (formattedDate.includes("-")) {
          const parts = formattedDate.split("-");
          formattedDate = parts.length >= 3 ? `${parts[1]}.${parts[2]}` : formattedDate;
        } else if (formattedDate.includes(".")) {
          const parts = formattedDate.split(".");
          formattedDate = parts.length >= 2 ? `${parts[parts.length - 2]}.${parts[parts.length - 1]}` : formattedDate;
        }

        if (!current.workedDates.includes(formattedDate)) {
          current.workedDates.push(formattedDate);
        }
        current.totalHours += Number(item.workHours) || 0;
        totals.set(name, current);
      });

      const calcSummary = Array.from(totals, ([name, val]) => ({
        name,
        daysCount: val.daysCount,
        workedDaysList: val.workedDates.slice(0, 5).map((date: string) => String(date).split(/[.-]/).pop()?.padStart(2, "0") || String(date)).join(", ") + (val.workedDates.length > 5 ? "..." : ""),
        totalHours: Number(val.totalHours.toFixed(1))
      }));
      setSummaryList(calcSummary);

    } catch (e) {
      console.error("Part timer database read error:", e);
    } finally {
      setLoading(false);
    }
  }, [branchName, selectedMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const saveManualPartTime = async () => {
    if (manualClockInError || manualClockOutError) {
      alert("출퇴근 시간 형식을 올바르게 입력해주세요 (예: 09:00).");
      return;
    }
    if (!manualName.trim() || !manualHours.trim() || !manualReason.trim()) {
      alert("직원명, 출퇴근 시간, 수기 입력 사유를 모두 채워주세요.");
      return;
    }
    if (!/^\d+(\.\d+)?$/.test(manualHours)) {
      alert("근무시간은 숫자 형식으로만 입력해 주세요. (예: 8시간 ➔ 8)");
      return;
    }
    const hours = Number(manualHours);
    if (hours <= 0) {
      alert("근무 시간은 0보다 커야 합니다.");
      return;
    }

    if (hours >= 15) {
      const ok = window.confirm(`근무 시간이 15시간 이상(${hours}시간)으로 기재되었습니다. 오타(예: 1.5를 15로 잘못 적음)가 아닌 것이 확실한가요?\n정말 등록하시겠습니까?`);
      if (!ok) return;
    }

    const key = `manual_parttime:${branchName}`;
    const previous = (await gasClient.getSharedData<any[]>(key)) || [];
    const newRecord = {
      id: `manual-pt-${Date.now()}`,
      staffName: manualName.trim(),
      settleDate: manualDate,
      clockIn: manualClockIn.trim() || "수기",
      clockOut: manualClockOut.trim() || "수기",
      workHours: hours,
      reason: manualReason.trim(),
      writer: `수기 (${manualReason.trim()})`,
      createdAt: new Date().toISOString()
    };

    await gasClient.saveSharedData(key, [newRecord, ...previous]);
    setManualName("");
    setManualHours("9");
    setManualClockIn("09:00");
    setManualClockOut("18:00");
    setManualClockInError("");
    setManualClockOutError("");
    setManualReason("");
    await loadData();
  };

  const handleEditPartTimeRow = (row: any) => {
    if (row.manual) {
      alert("수기로 작성된 파트타이머 근무 기록은 삭제 후 재등록해 주시기 바랍니다.");
      return;
    }
    if (!row.recordId) return;
    setEditPartTime({ row, fields: { clockIn: String(row.clockIn || ""), clockOut: String(row.clockOut || ""), workHours: toNumberPromptValue(row.workHours) } });
  };

  const saveEditPartTimeRow = async () => {
    if (!editPartTime) return;
    const { row, fields } = editPartTime;
    const workHours = Number(fields.workHours);
    if (!Number.isFinite(workHours)) {
      alert("근무시간은 숫자로 입력해주세요.");
      return;
    }
    await updateDailyMetadata(row.recordId, (metadata, detail) => {
      const staffRows = Array.isArray(metadata.staffRows) ? metadata.staffRows : [];
      const nextRows = staffRows.map((staff: any) => {
        const name = staff.staffName || staff.name;
        const sameRow = row.segmentId ? staff.segmentId === row.segmentId : name === row.staffName;
        return sameRow ? { ...staff, clockIn: fields.clockIn.trim(), clockOut: fields.clockOut.trim(), workHours } : staff;
      });
      const nextStaff = (detail.staff || []).map((staff: any) => {
        const name = staff.staffName || staff.name;
        return name === row.staffName ? { ...staff, workHours } : staff;
      });
      return { metadata: { ...metadata, staffRows: nextRows }, staff: nextStaff };
    });
    setEditPartTime(null);
    await loadData();
  };

  const handleDeletePartTimeRow = async (row: any) => {
    if (row.manual) {
      if (!window.confirm(`${row.staffName}님의 ${row.settleDate} 수기 파트타이머 근무기록을 삭제할까요?`)) return;
      const key = `manual_parttime:${branchName}`;
      const previous = (await gasClient.getSharedData<any[]>(key)) || [];
      const next = previous.filter((item) => item.id !== row.id);
      await gasClient.saveSharedData(key, next);
      await loadData();
    } else {
      if (!row.recordId || !window.confirm(`${row.staffName}님의 ${row.settleDate} 파트타이머 근무기록을 삭제할까요?`)) return;
      await updateDailyMetadata(row.recordId, (metadata, detail) => {
        const staffRows = Array.isArray(metadata.staffRows) ? metadata.staffRows : [];
        const nextRows = staffRows.filter((staff: any) => row.segmentId ? staff.segmentId !== row.segmentId : (staff.staffName || staff.name) !== row.staffName);
        const nextStaff = row.segmentId ? (detail.staff || []) : (detail.staff || []).filter((staff: any) => (staff.staffName || staff.name) !== row.staffName);
        return { metadata: { ...metadata, staffRows: nextRows }, staff: nextStaff };
      });
      await loadData();
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {editPartTime && (
        <AdminRecordEditModal
          title={`${editPartTime.row.staffName} 파트타이머 근무 수정`}
          fields={[
            { key: "clockIn", label: "출근시간", value: editPartTime.fields.clockIn },
            { key: "clockOut", label: "퇴근시간", value: editPartTime.fields.clockOut },
            { key: "workHours", label: "실근무시간", value: editPartTime.fields.workHours, type: "number" }
          ]}
          onChange={(key, value) => setEditPartTime((current) => current ? { ...current, fields: { ...current.fields, [key]: value } } : current)}
          onCancel={() => setEditPartTime(null)}
          onSave={() => void saveEditPartTimeRow()}
        />
      )}
      {/* List Table Left */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm lg:col-span-2 space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div>
            <h3 className="text-sm font-black text-gray-800 flex items-center gap-1.5">
              <ClipboardList className="w-4 h-4 text-[#2E6DB4]" />
              파트타이머 근무 일지
            </h3>
            <p className="text-[10px] text-gray-400 mt-0.5 font-bold">지점에 출근하여 실근무한 아르바이트 직원 출퇴근 로그입니다.</p>
          </div>
          <div className="flex items-center gap-2">
            <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-extrabold bg-white" />
            <button
              onClick={() => void loadData(true)}
              className="p-1 px-2.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-500 rounded-lg text-[10px] font-extrabold flex items-center gap-1 cursor-pointer transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> 새로고침
            </button>
          </div>
        </div>

        {/* Manual Part-Timer Registration Form */}
        <div className="flex flex-wrap gap-2.5 rounded-xl bg-gray-50 p-3 border border-gray-100 items-center">
          <span className="w-full text-xs font-black text-gray-600">파트타이머 근무 수기 입력</span>
          <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="직원명" className="w-24 px-2 py-1 border rounded text-xs bg-white focus:outline-none focus:border-[#2E6DB4]" />
          <input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} className="px-2 py-1 border rounded text-xs bg-white focus:outline-none focus:border-[#2E6DB4]" />

          <div className="relative">
            <input
              value={manualClockIn}
              onChange={(e) => handleClockInChange(e.target.value)}
              onBlur={() => handleClockBlur("in")}
              placeholder="출근 (09:00)"
              className={`w-20 px-2 py-1 border rounded text-xs bg-white font-mono focus:outline-none ${
                manualClockInError ? "border-rose-500 ring-1 ring-rose-300" : "focus:border-[#2E6DB4]"
              }`}
            />
            {manualClockInError && (
              <div className="absolute z-10 left-0 -top-8 whitespace-nowrap rounded bg-rose-600 px-2 py-1 text-[10px] font-bold text-white shadow animate-fade-in">
                {manualClockInError}
              </div>
            )}
          </div>

          <div className="relative">
            <input
              value={manualClockOut}
              onChange={(e) => handleClockOutChange(e.target.value)}
              onBlur={() => handleClockBlur("out")}
              placeholder="퇴근 (18:00)"
              className={`w-20 px-2 py-1 border rounded text-xs bg-white font-mono focus:outline-none ${
                manualClockOutError ? "border-rose-500 ring-1 ring-rose-300" : "focus:border-[#2E6DB4]"
              }`}
            />
            {manualClockOutError && (
              <div className="absolute z-10 left-0 -top-8 whitespace-nowrap rounded bg-rose-600 px-2 py-1 text-[10px] font-bold text-white shadow animate-fade-in">
                {manualClockOutError}
              </div>
            )}
          </div>

          <div className="relative">
            <input
              value={manualHours}
              readOnly
              placeholder="근무시간"
              className="w-20 px-2 py-1 border rounded text-xs bg-gray-100 text-center font-black text-blue-700 cursor-not-allowed select-none"
              title="출퇴근 시간에 의해 자동 계산됩니다"
            />
            {manualHours.length > 0 && /^\d+(\.\d+)?$/.test(manualHours) && Number(manualHours) >= 15 && (
              <div className="absolute z-10 bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-black p-2 rounded-xl shadow-md -bottom-12 left-0 whitespace-nowrap animate-bounce">
                ⚠️ 15시간 이상 입력됨. 오타가 아닌가요?
              </div>
            )}
          </div>

          <input value={manualReason} onChange={(e) => setManualReason(e.target.value)} placeholder="수기 입력 사유 (필수)" className="grow min-w-36 px-2 py-1 border rounded text-xs bg-white focus:outline-none focus:border-[#2E6DB4]" />
          <button onClick={() => void saveManualPartTime()} className="px-3 py-1 bg-[#2E6DB4] hover:bg-[#20528B] text-white rounded text-xs font-bold transition-colors">등록</button>
        </div>

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-2">
            <LoadingSpinner size="md" />
            <span className="text-xs text-gray-400 font-bold">마감 기록실에서 아르바이트 대장을 불러오는 중...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse font-medium animate-fade-in">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400 font-bold">
                  <th className="py-2.5 px-3">마감일자</th>
                  <th className="py-2.5 px-3">직원명</th>
                  {branchName === "본사" && <th className="py-2.5 px-3">근무지점</th>}
                  <th className="py-2.5 px-3">출근</th>
                  <th className="py-2.5 px-3">퇴근</th>
                  <th className="py-2.5 px-3 text-center">근무시간</th>
                  <th className="py-2.5 px-3">작성자 (결재)</th>
                  {isAdmin && <th className="py-2.5 px-3 text-center">관리</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={(isAdmin ? 7 : 6) + (branchName === "본사" ? 1 : 0)} className="py-16 text-center text-gray-400">
                      해당 지점에 기록된 파트타이머 출근 기록이 없습니다.
                    </td>
                  </tr>
                ) : (
                  records.map((r, idx) => (
                    <tr key={idx} className="hover:bg-gray-50/50">
                      <td className="py-3.5 px-3 font-mono text-[11px] text-gray-400">{r.settleDate}</td>
                      <td className="py-3.5 px-3 font-extrabold text-gray-800 text-sm">{r.staffName}</td>
                      {branchName === "본사" && <td className="py-3.5 px-3 text-xs font-bold text-gray-600">{r.officeWorkplace || "본사"}</td>}
                      <td className="py-3.5 px-3 font-mono text-gray-650">{r.clockIn}</td>
                      <td className="py-3.5 px-3 font-mono text-gray-650">{r.clockOut}</td>
                      <td className="py-3.5 px-3 text-center">
                        <span className="bg-blue-50 text-[#2E6DB4] font-black font-mono text-xs px-2.5 py-1 rounded-lg">
                          {r.workHours} 시간
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-gray-400 font-bold">{r.writer}</td>
                      {isAdmin && (
                        <td className="py-3.5 px-3">
                          <div className="flex justify-center gap-1">
                            <button onClick={() => void handleEditPartTimeRow(r)} className="px-2 py-1 rounded-lg border border-blue-100 bg-blue-50 text-blue-700 text-[10px] font-black">수정</button>
                            <button onClick={() => void handleDeletePartTimeRow(r)} className="px-2 py-1 rounded-lg border border-rose-100 bg-rose-50 text-rose-700 text-[10px] font-black">삭제</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Summary Aggregate Right */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm h-fit space-y-4">
        <div>
          <h3 className="text-sm font-black text-gray-800">파트타이머 보상 집계</h3>
          <p className="text-[10px] text-gray-400 mt-0.5 font-medium">아르바이트 인원들의 총 근무시간과 총 출근날수를 집계합니다.</p>
        </div>

        <div className="divide-y divide-gray-50 font-bold text-xs">
          {summaryList.length === 0 ? (
            <p className="py-8 text-center text-gray-400">집계 정보가 존재하지 않습니다.</p>
          ) : (
            summaryList.map((item, idx) => (
              <div key={idx} className="py-2.5 flex justify-between items-center">
                <span className="text-gray-800 font-extrabold">{item.name}</span>
                <div className="flex gap-3 text-right">
                  <span className="text-gray-400 font-medium" title={item.workedDaysList}>
                    ({item.daysCount}일 출근 · {item.workedDaysList})
                  </span>
                  <span className="text-[#2E6DB4] font-black font-mono">{item.totalHours} hr</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Monthly Settlement Component Block (월말 마감정산 대장)
// ============================================================================

interface MonthlySettleTabProps {
  branchName: string;
  activeSubTab: "purchaseSales" | "partTimeSalary" | "cashExpenses" | "cashManagement" | "cardExpenses";
  isAdmin?: boolean;
}

function MonthlySettleTab({ branchName, activeSubTab, isAdmin = false }: MonthlySettleTabProps) {
  const [adminSettings, setAdminSettings] = useState(() => {
    const saved = localStorage.getItem("erp_admin_settings");
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return {
      logoUrl: "",
      dailyAccentColor: "#2E6DB4",
      monthlyAccentColor: "#4F46E5",
      sidebarBgDaily: "#09090b",
      sidebarBgMonthly: "#1E1B4B",
      dailyPortalText: "실시간 마감 포탈 업무중",
      monthlyReportText: "월말 마감 결산 포탈",
      monthlyReportDesc: "가맹점의 월간 매입매출 상황, 근무일지 기반 아르바이트 급여 정산, 그리고 일일 시재 및 현금·카드 지출을 한눈에 결합 정산합니다.",
      excelFilenamePattern: "yymm_지점명_월말마감_m월",
      excelHeaderColorFill: "#E2E8F0",
      moneyFormatSuffix: "원",
      salaryTaxRate: "3.3%",
    };
  });

  useEffect(() => {
    const handleUpdate = () => {
      const saved = localStorage.getItem("erp_admin_settings");
      if (saved) {
        try { setAdminSettings(JSON.parse(saved)); } catch {}
      }
    };
    window.addEventListener("admin_settings_updated", handleUpdate);
    return () => window.removeEventListener("admin_settings_updated", handleUpdate);
  }, []);

  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  });

  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [monthlyCloseStatus, setMonthlyCloseStatus] = useState<any | null>(null);
  const [monthlyCloseRecords, setMonthlyCloseRecords] = useState<any[]>([]);
  const [purchaseResetToken, setPurchaseResetToken] = useState(0);

  const triggerToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      const h = await gasClient.getBranchHistory(branchName, selectedMonth);
      setHistory(h || []);
    } catch (e) {
      console.error("월말 정산용 이력 가져오기 실패:", e);
    } finally {
      setLoading(false);
    }
  }, [branchName, selectedMonth]);

  const fetchMonthlyCloseStatus = useCallback(async () => {
    try {
      const records = await gasClient.getSharedData<any[]>("monthly_closings");
      setMonthlyCloseRecords(Array.isArray(records) ? records : []);
      const current = Array.isArray(records)
        ? records
            .filter((record) => record.branchName === branchName && record.month === selectedMonth)
            .sort((a, b) => String(b.updatedAt || b.confirmedAt || "").localeCompare(String(a.updatedAt || a.confirmedAt || "")))[0]
        : null;
      setMonthlyCloseStatus(current || null);
    } catch (error) {
      console.warn("월말마감 상태를 불러오지 못했습니다.", error);
    }
  }, [branchName, selectedMonth]);

  const saveMonthlyCloseStatus = useCallback(async (status: "confirmed" | "editing" | "pending") => {
    const previous = await gasClient.getSharedData<any[]>("monthly_closings");
    const list = Array.isArray(previous) ? previous : [];
    const now = new Date().toISOString();
    const current = list.find((record) => record.branchName === branchName && record.month === selectedMonth);
    const nextRecord = {
      id: `${branchName}-${selectedMonth}`,
      branchName,
      month: selectedMonth,
      status,
      writer: branchName,
      confirmedAt: status === "confirmed" ? now : current?.confirmedAt || "",
      updatedAt: now
    };
    const next = [nextRecord, ...list.filter((record) => !(record.branchName === branchName && record.month === selectedMonth))];
    await gasClient.saveSharedData("monthly_closings", next);
    setMonthlyCloseRecords(next);
    setMonthlyCloseStatus(nextRecord);
    return nextRecord;
  }, [branchName, selectedMonth]);

  const confirmedCloseMonths = useMemo(() => {
    return Array.from(new Set<string>(
      monthlyCloseRecords
        .filter((record) => record.branchName === branchName && record.status === "confirmed" && record.month)
        .map((record) => String(record.month))
    )).sort((a, b) => b.localeCompare(a));
  }, [branchName, monthlyCloseRecords]);

  const handleDownloadExcel = useCallback(async () => {
    try {
      const XLSX = await import("xlsx-js-style");
      const wb = XLSX.utils.book_new();

      // 1. 매입매출 대장
      let psRows: any[] = [];
      try {
        const saved = localStorage.getItem(`erp_monthly_purchases_${branchName}_${selectedMonth}`);
        if (saved) {
          psRows = JSON.parse(saved);
        } else {
          psRows = [
            { category: "식재료비", vendorName: "주식회사 식자재창고", transferAmount: "1250000", bank: "국민은행", accountNumber: "123-456-789012", isPrepaid: false, prepaidChargeAmount: "", monthlyUsageAmount: "1250000", memo: "일반 후불 외상 결제" },
            { category: "식음료외 기타", vendorName: "드림 물류 (선입금 업체)", transferAmount: "0", bank: "신한은행", accountNumber: "987-654-321098", isPrepaid: true, prepaidChargeAmount: "0", monthlyUsageAmount: "450000", memo: "매월 선충전 후 발주금액 차감 방식" }
          ];
        }
      } catch {}
      try {
        const remotePurchases = await gasClient.getSharedData<any[]>(`monthly_purchases:${branchName}:${selectedMonth}`);
        if (Array.isArray(remotePurchases) && remotePurchases.length > 0) {
          psRows = remotePurchases;
          localStorage.setItem(`erp_monthly_purchases_${branchName}_${selectedMonth}`, JSON.stringify(remotePurchases));
        }
      } catch (error) {
        console.warn("월 매입매출 공통 데이터를 엑셀 다운로드에 반영하지 못했습니다.", error);
      }
      const psData = psRows.map(r => ({
        "분류항목": r.category,
        "송금/사용 대상업체명": r.vendorName,
        "선입금 충전방식?": r.isPrepaid ? "선입금" : "후불이체",
        "_선입금여부": Boolean(r.isPrepaid),
        "이체필요 금액 (원)": Number(r.transferAmount) || 0,
        "충전금액 (원)": Number(r.prepaidChargeAmount) || 0,
        "실제 이달사용액 (원)": Number(r.monthlyUsageAmount) || 0,
        "은행": r.bank,
        "계좌번호": r.accountNumber,
        "거래 비고 고지": r.memo
      }));

      // 2. 파트타이머 급여대장
      let rosterPartTimers: any[] = [];
      try {
        const savedRoster = localStorage.getItem(`erp_staff_list_${branchName}`);
        if (savedRoster) {
          rosterPartTimers = JSON.parse(savedRoster).filter((emp: any) => emp.division === "파트타이머" && !isSampleEmployee(emp));
        }
      } catch {}
      try {
        const remoteRoster = await gasClient.getBranchOwnRoster(branchName);
        const remotePartTimers = remoteRoster.filter((emp: any) => emp.division === "파트타이머" && !isSampleEmployee(emp));
        if (remotePartTimers.length > 0) {
          rosterPartTimers = remotePartTimers;
          localStorage.setItem(`erp_staff_list_${branchName}`, JSON.stringify(remoteRoster.filter((emp: any) => !isSampleEmployee(emp))));
        }
      } catch (error) {
        console.warn("공통 직원현황을 엑셀 다운로드에 반영하지 못했습니다.", error);
      }

      const ptTelemetry: { [name: string]: { hours: number; dates: string[] } } = {};
      history.forEach((m) => {
        if (m.settleDate && m.settleDate.startsWith(selectedMonth)) {
          const parts = (m.memo || "").split("\n---\nMETADATA:");
          if (parts[1]) {
            try {
              const meta = JSON.parse(parts[1].trim());
              if (meta && meta.staffRows) {
                meta.staffRows.forEach((s: any) => {
                  if (s.division === "파트타이머" && Number(s.workHours || 0) > 0) {
                    if (!ptTelemetry[s.name]) {
                      ptTelemetry[s.name] = { hours: 0, dates: [] };
                    }
                    ptTelemetry[s.name].hours += Number(s.workHours || 0);
                    const dateParts = m.settleDate.split("-");
                    const daySuffix = dateParts[2] ? `${Number(dateParts[2])}` : m.settleDate;
                    if (!ptTelemetry[s.name].dates.includes(daySuffix)) {
                      ptTelemetry[s.name].dates.push(daySuffix);
                    }
                  }
                });
              }
            } catch {}
          }
        }
      });

      let savedSalaryMap: { [empId: string]: any } = {};
      try {
        const savedConfig = localStorage.getItem(`erp_monthly_part_time_salary_${branchName}_${selectedMonth}`);
        if (savedConfig) {
          JSON.parse(savedConfig).forEach((item: any) => {
            savedSalaryMap[item.employeeId] = item;
          });
        }
      } catch {}
      try {
        const remoteSalaries = await gasClient.getSharedData<any[]>(`part_time_salaries:${branchName}:${selectedMonth}`);
        if (Array.isArray(remoteSalaries) && remoteSalaries.length > 0) {
          savedSalaryMap = {};
          remoteSalaries.forEach((item: any) => {
            savedSalaryMap[item.employeeId] = item;
          });
          localStorage.setItem(`erp_monthly_part_time_salary_${branchName}_${selectedMonth}`, JSON.stringify(remoteSalaries));
        }
      } catch (error) {
        console.warn("파트타이머 급여 공통 데이터를 엑셀 다운로드에 반영하지 못했습니다.", error);
      }

      let excludedEmployeeIdsForExcel: string[] = [];
      try {
        const localExcluded = localStorage.getItem(`erp_part_time_salary_exclusions_${branchName}_${selectedMonth}`);
        if (localExcluded) excludedEmployeeIdsForExcel = JSON.parse(localExcluded);
        const remoteExcluded = await gasClient.getSharedData<string[]>(`part_time_salary_exclusions:${branchName}:${selectedMonth}`);
        if (Array.isArray(remoteExcluded)) excludedEmployeeIdsForExcel = remoteExcluded;
      } catch {}

      let sharedProfiles: Record<string, any> = {};
      try {
        const remoteProfiles = await gasClient.getSharedData<Record<string, any>>(`part_time_profiles:${branchName}`);
        if (remoteProfiles) sharedProfiles = remoteProfiles;
      } catch (error) {
        console.warn("파트타이머 프로필 공통 데이터를 엑셀 다운로드에 반영하지 못했습니다.", error);
      }

      const knownPartTimerIds = new Set(rosterPartTimers.map((pt) => pt.id));
      Object.values(savedSalaryMap).forEach((salary: any) => {
        if (salary?.employeeId && !knownPartTimerIds.has(salary.employeeId)) {
          rosterPartTimers.push({
            id: salary.employeeId,
            name: salary.name || salary.staffName || salary.employeeName || salary.employeeId,
            division: "파트타이머"
          });
          knownPartTimerIds.add(salary.employeeId);
        }
      });
      Object.keys(ptTelemetry).forEach((name) => {
        if (!rosterPartTimers.some((pt) => pt.name === name)) {
          rosterPartTimers.push({ id: `legacy-${branchName}-${name}`, name, division: "파트타이머" });
        }
      });
      const excludedSetForExcel = new Set(excludedEmployeeIdsForExcel);

      const getStoredProfile = (empId: string): any => {
        if (sharedProfiles[empId]) return sharedProfiles[empId];
        try {
          const stored = localStorage.getItem(`erp_pt_profile_${branchName}_${empId}`);
          if (stored) return JSON.parse(stored);
        } catch {}
        return {};
      };

      const ptData = rosterPartTimers.filter((pt) => !excludedSetForExcel.has(pt.id)).map((pt) => {
        const tel = ptTelemetry[pt.name] || { hours: 0, dates: [] };
        const saved = savedSalaryMap[pt.id] || {};
        const profile = getStoredProfile(pt.id);

        const hourlyRate = saved.hourlyRate || profile.hourlyRate || "15000";
        const accumulatedHours = saved.accumulatedHours !== undefined ? saved.accumulatedHours : String(tel.hours);
        const tipsEtcAmount = saved.tipsEtcAmount || "0";
        const calcSalary = saved.calculatedSalary !== undefined && saved.calculatedSalary !== ""
          ? saved.calculatedSalary
          : String((Number(hourlyRate) * Number(accumulatedHours)) + (Number(tipsEtcAmount) || 0));
        const calcActualPaid = saved.actualPaidAmount || "";
        const attendanceDates = saved.attendanceDates !== undefined
          ? saved.attendanceDates
          : tel.dates.sort((a,b) => Number(a) - Number(b)).slice(0, 7).join(",");

        return {
          "성명 (사원)": pt.name,
          "주민등록번호": saved.residentNumber || profile.residentNumber || "",
          "입사일자": saved.entryDate || profile.entryDate || "",
          "근로계약": saved.contractStatus || profile.contractStatus || "미작성",
          "은행": saved.bank || profile.bank || "",
          "입금 계좌번호": saved.accountNumber || profile.accountNumber || "",
          "시급 (원)": Number(hourlyRate) || 0,
          "누적시간": Number(accumulatedHours) || 0,
          "팁/기타": Number(tipsEtcAmount) || 0,
          "기본급여": Number(calcSalary) || 0,
          "근무일정 (출근일)": attendanceDates,
          "실수령액 (송금)": calcActualPaid ? (Number(calcActualPaid) || "") : "",
          "실제 송금지점": saved.payoutBranch || branchName,
          "기타 비고 내용 (퇴사일 등)": saved.memo || ""
        };
      });

      // 3. 현금지출 일람 (cashExpenses)
      const cashList: any[] = [];
      history.forEach((m) => {
        if (m.settleDate && m.settleDate.startsWith(selectedMonth)) {
          const parts = (m.memo || "").split("\n---\nMETADATA:");
          if (parts[1]) {
            try {
              const meta = JSON.parse(parts[1].trim());
              if (meta && meta.cashExpenses) {
                meta.cashExpenses.forEach((exp: any) => {
                  const itemAmount = Number(exp.amount) || 0;
                  if (itemAmount > 0) {
                    cashList.push({
                      "마감 일자": m.settleDate,
                      "결제 수단": "현금",
                      "지출 금액": itemAmount,
                      "거래처 (사용처)": exp.usage || "공란",
                      "분류 항목": exp.classification || "미분류",
                      "지출내용 (세부)": exp.detail || "",
                      "비고": "확인완료",
                      "작성자": m.submittedBy || m.submitted_by || (m as any).writer || "미상",
                      "입력 시각": m.submittedAt ? new Date(m.submittedAt).toISOString() : "",
                      "_마감원본": m.settleDate
                    });
                  }
                });
              }
            } catch {}
          }
        }
      });
      cashList.sort((a,b) => a["마감 일자"].localeCompare(b["마감 일자"]));

      // 4. 현금관리 집계 (cashManagement)
      const cashMgmt: any[] = [];
      history.forEach((m) => {
        if (m.settleDate && m.settleDate.startsWith(selectedMonth)) {
          const parts = (m.memo || "").split("\n---\nMETADATA:");
          let metaParsed: any = {};
          if (parts[1]) {
            try {
              metaParsed = JSON.parse(parts[1].trim());
            } catch {}
          }
          const prevVal = Number(metaParsed.prevDayCash) || 0;
          const salesVal = Number(m.cashSales) || 0;
          const expensesVal = metaParsed.cashExpenses
            ? metaParsed.cashExpenses.reduce((sum: number, x: any) => sum + (Number(x.amount) || 0), 0)
            : 0;
          const theoryVal = prevVal + salesVal - expensesVal;
          const vaultVal = Number(metaParsed.cashBalance) || 0;
          const difference = vaultVal - theoryVal;

          cashMgmt.push({
            "마감 일자": m.settleDate,
            "전일 금고현금": prevVal,
            "금일 현금매출": salesVal,
            "현금지출 합계": expensesVal,
            "이론상 잔액 (원)": theoryVal,
            "금고 실사 현금 (원)": vaultVal,
            "차액 (불일치)": difference,
            "계좌이체": Number(m.transferSales) || 0,
            "대조 불일치 사유 소명": metaParsed.cashDiffReason || "",
            "점검 작성자": m.submittedBy || m.submitted_by || (m as any).writer || "매니저",
            "_입력원본": m.submittedAt || "",
            "_마감원본": m.settleDate
          });
        }
      });
      cashMgmt.sort((a,b) => a["마감 일자"].localeCompare(b["마감 일자"]));

      // 5. 카드지출 일람 (cardExpenses)
      const cardList: any[] = [];
      history.forEach((m) => {
        if (m.settleDate && m.settleDate.startsWith(selectedMonth)) {
          const parts = (m.memo || "").split("\n---\nMETADATA:");
          if (parts[1]) {
            try {
              const meta = JSON.parse(parts[1].trim());
              if (meta && meta.cardExpenses) {
                meta.cardExpenses.forEach((exp: any) => {
                  const itemAmount = Number(exp.amount) || 0;
                  if (itemAmount > 0) {
                    cardList.push({
                      "마감 일자": m.settleDate,
                      "결제 수단": "카드",
                      "지출 금액": itemAmount,
                      "사용처 (가맹점)": exp.usage || "공란",
                      "항목 (분류)": exp.classification || "미분류",
                      "지출내용 (세부)": exp.detail || "",
                      "비고": "확인증빙필",
                      "작성자": m.submittedBy || m.submitted_by || (m as any).writer || "매니저",
                      "_입력원본": m.submittedAt || "",
                      "_마감원본": m.settleDate
                    });
                  }
                });
              }
            } catch {}
          }
        }
      });
      cardList.sort((a,b) => a["마감 일자"].localeCompare(b["마감 일자"]));

      const [year, month] = selectedMonth.split("-");
      const monthNumber = Number(month);
      const formatDate = (value: string) => {
        const match = String(value || "").match(/(\d{4})-(\d{2})-(\d{2})/);
        return match ? `${match[1]}. ${Number(match[2])}. ${Number(match[3])}` : "";
      };
      const formatCardDate = (value: string) => {
        const match = String(value || "").match(/\d{4}-(\d{2})-(\d{2})/);
        return match ? `${Number(match[1])} . ${Number(match[2])}` : "";
      };
      const formatInputDate = (value: string, fallback: string) => {
        const parsed = value ? new Date(value) : null;
        return parsed && !Number.isNaN(parsed.getTime())
          ? `${parsed.getFullYear()}. ${parsed.getMonth() + 1}. ${parsed.getDate()}`
          : formatDate(fallback);
      };

      const headerStyle = {
        font: { bold: true, sz: 10, color: { rgb: "1F2937" } },
        fill: { patternType: "solid", fgColor: { rgb: "F1C232" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: false },
        border: { top: { style: "thin", color: { rgb: "B08A00" } }, bottom: { style: "thin", color: { rgb: "B08A00" } }, left: { style: "thin", color: { rgb: "B08A00" } }, right: { style: "thin", color: { rgb: "B08A00" } } }
      };
      const titleStyle = { font: { bold: true, sz: 10, color: { rgb: "17365D" } }, alignment: { vertical: "center" } };
      const bodyBorder = { top: { style: "thin", color: { rgb: "D9E2F3" } }, bottom: { style: "thin", color: { rgb: "D9E2F3" } }, left: { style: "thin", color: { rgb: "D9E2F3" } }, right: { style: "thin", color: { rgb: "D9E2F3" } } };

      const makeSheet = (headers: string[], rows: any[][], widths: number[], includeTitle: boolean, numericColumns: number[] = [], textColumns: number[] = []) => {
        const source = includeTitle
          ? [[branchName, "", "", monthNumber, "월"], headers, ...rows]
          : [headers, ...rows];
        const sheet = XLSX.utils.aoa_to_sheet(source);
        const headerRow = includeTitle ? 1 : 0;
        sheet["!cols"] = widths.map((wch) => ({ wch }));
        sheet["!rows"] = source.map((_, index) => ({ hpt: includeTitle && index === 0 ? 24 : index === headerRow ? 20 : 17 }));
        for (let col = 0; col < headers.length; col++) {
          const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c: col })];
          if (cell) cell.s = headerStyle;
        }
        if (includeTitle) {
          [0, 3, 4].forEach((col) => {
            const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: col })];
            if (cell) cell.s = titleStyle;
          });
        }
        for (let row = headerRow + 1; row < source.length; row++) {
          for (let col = 0; col < headers.length; col++) {
            const address = XLSX.utils.encode_cell({ r: row, c: col });
            const cell = sheet[address];
            if (!cell) continue;
            cell.s = { font: { sz: 10 }, border: bodyBorder, alignment: { vertical: "center", wrapText: col === headers.length - 1 } };
            if (numericColumns.includes(col)) cell.z = "#,##0";
            if (textColumns.includes(col)) cell.z = "@";
          }
        }
        return sheet;
      };

      // 기준 파일의 시트명, 제목행, 헤더 순서와 열 폭을 그대로 사용합니다.
      const purchaseHeaders = ["매출항목", "업체명", "이체 필요금액", "은행", "계좌번호", "기타내용", "이달사용금액", "오류"];
      const purchaseRows = psData.map((row) => [row["분류항목"], row["송금/사용 대상업체명"], row["이체필요 금액 (원)"], row["은행"], row["계좌번호"], row["거래 비고 고지"], row["_선입금여부"] ? row["실제 이달사용액 (원)"] : "", ""]);
      const psWS = makeSheet(purchaseHeaders, purchaseRows, [17.17, 14, 12.17, 13.33, 40.83, 60.17, 14.83, 10.33], true, [2, 6], [4]);

      const partTimeHeaders = ["성명(입사일)", "주민등록번호", "입사일", "근로계약", "은행", "입금계좌", "시급", "누적시간", "팁/기타", "급여", "출근날짜", "실수령액(송금액)", "실제 송금지점", "기타내용(퇴사일 및 퇴직금등)"];
      const partTimeRows = ptData.map((row) => [row["성명 (사원)"], row["주민등록번호"], row["입사일자"], row["근로계약"], row["은행"], row["입금 계좌번호"], row["시급 (원)"], row["누적시간"], row["팁/기타"], row["기본급여"], row["근무일정 (출근일)"], row["실수령액 (송금)"], row["실제 송금지점"], row["기타 비고 내용 (퇴사일 등)"]]);
      const ptWS = makeSheet(partTimeHeaders, partTimeRows, [11.57, 15.86, 9.2, 8.21, 5.14, 19.64, 10.71, 7.2, 9.29, 9.29, 24.14, 10.21, 10.21, 41.43], true, [6, 7, 8, 9, 11], [1, 5]);

      const expenseHeaders = ["마감일자", "결제수단", "금액", "사용처(거래처)", "항목", "지출내용(세부)", "비고", "작성자", "입력시각", "마감키"];
      const cashRows = cashList.map((row) => {
        const date = String(row["_마감원본"] || row["마감 일자"] || "");
        const writer = String(row["작성자"] || "");
        return [formatDate(date), "현금", row["지출 금액"], row["거래처 (사용처)"], row["분류 항목"], row["지출내용 (세부)"], row["비고"] === "확인완료" ? "" : row["비고"], writer, formatInputDate(row["입력 시각"], date), `${date}|${writer}`];
      });
      const cashWS = makeSheet(expenseHeaders, cashRows, [11.3, 6.8, 16.4, 11.3, 24.8, 11.9, 6.8, 10.2, 11, 28.8], false, [2]);

      const cashManagementHeaders = ["마감일자", "전일현금", "현금매출", "현금지출", "현금잔액", "실사현금", "차이", "계좌이체", "비고", "작성자", "입력시각"];
      const mgmtRows = cashMgmt.map((row) => {
        const date = String(row["_마감원본"] || row["마감 일자"] || "");
        const writer = String(row["점검 작성자"] || "");
        return [formatDate(date), row["전일 금고현금"], row["금일 현금매출"], row["현금지출 합계"], row["이론상 잔액 (원)"], row["금고 실사 현금 (원)"], row["차액 (불일치)"], row["계좌이체"], row["대조 불일치 사유 소명"], writer, formatInputDate(row["_입력원본"], date)];
      });
      const mgmtWS = makeSheet(cashManagementHeaders, mgmtRows, [10.08, 10.08, 10.08, 10.08, 10.08, 10.08, 10.08, 10.08, 23.23, 10.08, 10.08], false, [1, 2, 3, 4, 5, 6, 7]);

      const cardRows = cardList.map((row) => {
        const date = String(row["_마감원본"] || row["마감 일자"] || "");
        const writer = String(row["작성자"] || "");
        return [formatCardDate(date), "카드", row["지출 금액"], row["사용처 (가맹점)"], row["항목 (분류)"], row["지출내용 (세부)"], row["비고"] === "확인증빙필" ? "" : row["비고"], writer, formatInputDate(row["_입력원본"], date), `${date}|${writer}`];
      });
      const cardWS = makeSheet(expenseHeaders, cardRows, [11.3, 6.8, 16.4, 18.8, 24.8, 13.3, 6.8, 6.8, 9.9, 23.5], false, [2]);

      XLSX.utils.book_append_sheet(wb, psWS, "매입매출");
      XLSX.utils.book_append_sheet(wb, ptWS, "파트타이머급여");
      XLSX.utils.book_append_sheet(wb, cashWS, "현금지출");
      XLSX.utils.book_append_sheet(wb, cardWS, "카드지출");
      XLSX.utils.book_append_sheet(wb, mgmtWS, "현금관리");

      const fileName = `월말정산_${branchName}${monthNumber}월_결산자료.xlsx`;

      XLSX.writeFile(wb, fileName);
      triggerToast("엑셀 파일 다운로드 성공!", "success");
    } catch (err: any) {
      console.error(err);
      triggerToast("엑셀 생성 오류: " + err.message, "error");
    }
  }, [branchName, selectedMonth, history, triggerToast, adminSettings]);

  const carryMonthlyPurchasesToNextMonth = useCallback(async () => {
    const nextMonth = addMonthsToMonthInputValue(selectedMonth, 1);
    const nextKey = `monthly_purchases:${branchName}:${nextMonth}`;
    const nextLocalKey = `erp_monthly_purchases_${branchName}_${nextMonth}`;
    try {
      const existingRemote = await gasClient.getSharedData<any[]>(nextKey);
      if (Array.isArray(existingRemote) && existingRemote.length > 0) return;
    } catch {}
    try {
      const existingLocal = localStorage.getItem(nextLocalKey);
      if (existingLocal && JSON.parse(existingLocal).length > 0) return;
    } catch {}

    let currentRows: any[] = [];
    try {
      const currentLocal = localStorage.getItem(`erp_monthly_purchases_${branchName}_${selectedMonth}`);
      if (currentLocal) currentRows = JSON.parse(currentLocal);
    } catch {}
    if (currentRows.length === 0) {
      try {
        const remote = await gasClient.getSharedData<any[]>(`monthly_purchases:${branchName}:${selectedMonth}`);
        if (Array.isArray(remote)) currentRows = remote;
      } catch {}
    }
    if (currentRows.length === 0) return;

    const carriedRows = currentRows.map((row) => ({
      ...row,
      id: `p_${nextMonth}_${row.id || Date.now()}`,
      transferAmount: "",
      prepaidChargeAmount: "",
      monthlyUsageAmount: ""
    }));
    localStorage.setItem(nextLocalKey, JSON.stringify(carriedRows));
    await gasClient.saveSharedData(nextKey, carriedRows);
  }, [branchName, selectedMonth]);

  const handleConfirmMonthlyClose = useCallback(async () => {
    try {
      await carryMonthlyPurchasesToNextMonth();
      await saveMonthlyCloseStatus("confirmed");
      triggerToast(`${selectedMonth} 월말마감이 확정되었습니다.`, "success");
      if (window.confirm("월말마감이 확정되었습니다. 결산자료 엑셀을 다운로드할까요?")) {
        await handleDownloadExcel();
      }
    } catch (error: any) {
      console.error(error);
      triggerToast(error?.message || "월말마감 확정 저장에 실패했습니다.", "error");
    }
  }, [carryMonthlyPurchasesToNextMonth, handleDownloadExcel, saveMonthlyCloseStatus, selectedMonth, triggerToast]);

  const handleEditMonthlyClose = useCallback(async () => {
    try {
      await saveMonthlyCloseStatus("editing");
      triggerToast(`${selectedMonth} 월말마감이 수정중 상태로 변경되었습니다.`, "success");
    } catch (error: any) {
      console.error(error);
      triggerToast(error?.message || "월말마감 수정 상태 저장에 실패했습니다.", "error");
    }
  }, [saveMonthlyCloseStatus, selectedMonth, triggerToast]);

  const resetMonthlyPurchaseAmounts = useCallback(async () => {
    let purchaseRows: any[] = [];
    try {
      const remote = await gasClient.getSharedData<any[]>(`monthly_purchases:${branchName}:${selectedMonth}`);
      if (Array.isArray(remote)) purchaseRows = remote;
    } catch {}
    if (purchaseRows.length === 0) {
      try {
        const saved = localStorage.getItem(`erp_monthly_purchases_${branchName}_${selectedMonth}`);
        if (saved) purchaseRows = JSON.parse(saved);
      } catch {}
    }
    if (purchaseRows.length === 0) return;
    const resetRows = purchaseRows.map((row) => ({
      ...row,
      transferAmount: "",
      prepaidChargeAmount: "",
      monthlyUsageAmount: ""
    }));
    localStorage.setItem(`erp_monthly_purchases_${branchName}_${selectedMonth}`, JSON.stringify(resetRows));
    await gasClient.saveSharedData(`monthly_purchases:${branchName}:${selectedMonth}`, resetRows);
  }, [branchName, selectedMonth]);

  const handleCancelMonthlyClose = useCallback(async () => {
    if (!window.confirm("월말마감을 취소하고 거래처 금액 입력값만 초기화할까요?\n거래처명, 은행, 계좌, 기타내용은 유지됩니다.")) return;
    try {
      await saveMonthlyCloseStatus("pending");
      await resetMonthlyPurchaseAmounts();
      setPurchaseResetToken((value) => value + 1);
      triggerToast(`${selectedMonth} 월말마감이 취소되었고 거래처 금액이 초기화되었습니다.`, "success");
    } catch (error: any) {
      console.error(error);
      triggerToast(error?.message || "월말마감 취소에 실패했습니다.", "error");
    }
  }, [resetMonthlyPurchaseAmounts, saveMonthlyCloseStatus, selectedMonth, triggerToast]);

  const handleCancelMonthlyEdit = useCallback(async () => {
    try {
      await saveMonthlyCloseStatus("confirmed");
      triggerToast(`${selectedMonth} 월말마감 수정이 취소되고 확정 상태로 돌아갔습니다.`, "success");
    } catch (error: any) {
      console.error(error);
      triggerToast(error?.message || "월말마감 수정 취소에 실패했습니다.", "error");
    }
  }, [saveMonthlyCloseStatus, selectedMonth, triggerToast]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    void fetchMonthlyCloseStatus();
  }, [fetchMonthlyCloseStatus]);

  return (
    <div className="space-y-6 animate-fade-in" id="monthly-settle-tab-root">
      {/* Toast Alert overlay */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-fade-in">
          <div className={`px-5 py-3.5 rounded-2xl border text-xs font-bold shadow-xl flex items-center gap-2.5 ${
            toast.type === "success"
              ? "bg-emerald-50 border-emerald-100 text-emerald-800"
              : "bg-rose-50 border-rose-100 text-rose-800"
          }`}>
            {toast.type === "success" ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <AlertTriangle className="w-4 h-4 text-rose-500" />}
            {toast.message}
          </div>
        </div>
      )}

      {/* Month Selector Header */}
      <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-black text-zinc-900 flex items-center gap-2">
            <Coins className="w-5 h-5" style={{ color: adminSettings.monthlyAccentColor }} />
            {adminSettings.monthlyReportText}
          </h2>
          <p className="text-[10px] text-gray-400 font-bold">
            {adminSettings.monthlyReportDesc}
          </p>
        </div>

        {activeSubTab === "purchaseSales" && (
          <div className="flex flex-col items-end gap-2 w-full md:w-auto self-end md:self-auto">
            <div className="flex flex-wrap items-center gap-3 justify-end">
              <span className="text-xs font-black text-gray-500 whitespace-nowrap">결산월 선택:</span>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                style={{ color: adminSettings.monthlyAccentColor }}
                className="p-2 bg-zinc-50 hover:bg-zinc-100/50 border border-gray-200 text-xs font-extrabold rounded-xl shadow-inner focus:outline-none cursor-pointer"
              />
              <button
                onClick={fetchHistory}
                className="monthly-action-refresh p-2 px-3.5 bg-zinc-900 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all hover:bg-zinc-850 cursor-pointer shadow-subtle"
              >
                <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
                이력 갱신
              </button>
              <button
                onClick={handleConfirmMonthlyClose}
                className="monthly-action-confirm p-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-subtle"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-200" />
                월말마감 확정
              </button>
              {monthlyCloseStatus?.status === "editing" ? (
              <button
                onClick={handleCancelMonthlyEdit}
                className="monthly-action-edit-cancel p-2 px-4 bg-slate-600 hover:bg-slate-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-subtle"
              >
                <X className="w-4 h-4 text-slate-200" />
                월말마감 수정 취소
              </button>
            ) : (
              <button
                onClick={handleEditMonthlyClose}
                className="monthly-action-edit p-2 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-subtle"
              >
                <Pencil className="w-4 h-4 text-amber-100" />
                월말마감 수정
              </button>
            )}
              <button
                onClick={handleCancelMonthlyClose}
                className="monthly-action-cancel p-2 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-subtle"
              >
                <Trash2 className="w-4 h-4 text-rose-200" />
                월말마감 취소
              </button>
            </div>
            {confirmedCloseMonths.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1.5 max-w-xl">
                <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1">마감 완료 월</span>
                {confirmedCloseMonths.slice(0, 12).map((month) => (
                  <button
                    key={month}
                    type="button"
                    onClick={() => setSelectedMonth(month)}
                    className={`rounded-lg border px-2 py-1 text-[10px] font-black transition-colors ${
                      selectedMonth === month
                        ? "border-emerald-500 bg-emerald-600 text-white"
                        : "border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    }`}
                  >
                    {month}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white px-5 py-3 text-xs font-bold text-slate-600 flex flex-wrap items-center gap-2">
        <span className="text-slate-400">현재 월말마감 상태</span>
        <span className={`monthly-close-status-pill rounded-lg px-2.5 py-1 font-black ${
          monthlyCloseStatus?.status === "confirmed"
            ? "monthly-close-status-confirmed bg-emerald-50 text-emerald-700"
            : monthlyCloseStatus?.status === "editing"
            ? "monthly-close-status-editing bg-amber-50 text-amber-700"
            : "monthly-close-status-missing bg-rose-50 text-rose-700"
        }`}>
          {monthlyCloseStatus?.status === "confirmed" ? "확정" : monthlyCloseStatus?.status === "editing" ? "수정중" : "미제출"}
        </span>
        <span className="font-mono text-slate-400">{selectedMonth}</span>
      </div>

      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center bg-white rounded-3xl border border-gray-100 shadow-sm space-y-3">
          <LoadingSpinner size="lg" />
          <span className="text-xs text-gray-400 font-bold font-mono">가맹점 무인 원격 일지에서 일일 정산자료 조합 파싱 중...</span>
        </div>
      ) : (
        <div className="space-y-6">
          {activeSubTab === "purchaseSales" && (
            <MonthlyPurchaseSalesSubTab branchName={branchName} selectedMonth={selectedMonth} triggerToast={triggerToast} resetToken={purchaseResetToken} isLocked={monthlyCloseStatus?.status === "confirmed"} />
          )}
          {activeSubTab === "partTimeSalary" && (
            <MonthlyPartTimeSalarySubTab branchName={branchName} selectedMonth={selectedMonth} history={history} triggerToast={triggerToast} />
          )}
          {activeSubTab === "cashExpenses" && (
            <MonthlyCashExpensesSubTab branchName={branchName} selectedMonth={selectedMonth} history={history} isAdmin={isAdmin} refreshHistory={fetchHistory} />
          )}
          {activeSubTab === "cashManagement" && (
            <MonthlyCashManagementSubTab branchName={branchName} selectedMonth={selectedMonth} history={history} isAdmin={isAdmin} refreshHistory={fetchHistory} />
          )}
          {activeSubTab === "cardExpenses" && (
            <MonthlyCardExpensesSubTab branchName={branchName} selectedMonth={selectedMonth} history={history} isAdmin={isAdmin} refreshHistory={fetchHistory} />
          )}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// 2-1. SUB TAB: 매입매출
// ----------------------------------------------------------------------------
interface PurchaseSalesRow {
  id: string;
  category: "식재료비" | "주류비" | "식음료외 기타";
  vendorName: string;
  transferAmount: string;
  bank: string;
  accountNumber: string;
  isPrepaid: boolean;
  prepaidChargeAmount?: string;
  monthlyUsageAmount: string;
  memo: string;
}

function MonthlyPurchaseSalesSubTab({
  branchName,
  selectedMonth,
  triggerToast,
  resetToken = 0,
  isLocked = false
}: {
  branchName: string;
  selectedMonth: string;
  triggerToast: (msg: string, type?: "success" | "error") => void;
  resetToken?: number;
  isLocked?: boolean;
}) {
  const [rows, setRows] = useState<PurchaseSalesRow[]>([]);
  const autoSaveTimerRef = useRef<number | null>(null);
  const storageKey = `erp_monthly_purchases_${branchName}_${selectedMonth}`;
  const sharedKey = `monthly_purchases:${branchName}:${selectedMonth}`;
  const pendingKey = pendingLocalSaveStorageKey(storageKey);

  const normalizePurchaseRows = useCallback((sourceRows: PurchaseSalesRow[]) => {
    return sourceRows.map((row) => ({ ...row, prepaidChargeAmount: row.prepaidChargeAmount || "" }));
  }, []);

  const emptyAmounts = useCallback((sourceRows: PurchaseSalesRow[]) => {
    return normalizePurchaseRows(sourceRows).map((row) => ({
      ...row,
      id: `p_${selectedMonth}_${row.id || Date.now()}`,
      transferAmount: "",
      prepaidChargeAmount: "",
      monthlyUsageAmount: ""
    }));
  }, [normalizePurchaseRows, selectedMonth]);

  const defaultRows = useCallback((): PurchaseSalesRow[] => ([
    {
      id: "p1",
      category: "식재료비",
      vendorName: "주식회사 식자재창고",
      transferAmount: "1250000",
      bank: "국민은행",
      accountNumber: "123-456-789012",
      isPrepaid: false,
      prepaidChargeAmount: "",
      monthlyUsageAmount: "1250000",
      memo: "일반 후불 외상 결제"
    },
    {
      id: "p2",
      category: "식음료외 기타",
      vendorName: "드림 물류 (선입금 업체)",
      transferAmount: "0",
      bank: "신한은행",
      accountNumber: "987-654-321098",
      isPrepaid: true,
      prepaidChargeAmount: "0",
      monthlyUsageAmount: "450000",
      memo: "매월 선충전 후 발주금액 차감 방식"
    }
  ]), []);

  useEffect(() => {
    let cancelled = false;
    const loadPurchases = async () => {
      let nextRows: PurchaseSalesRow[] = [];
      let remoteLoaded = false;
      const hasPendingLocal = localStorage.getItem(pendingKey) === "1";
      if (hasPendingLocal) {
        try {
          const saved = localStorage.getItem(storageKey);
          if (saved) {
            nextRows = normalizePurchaseRows(JSON.parse(saved));
            remoteLoaded = true;
          }
        } catch {}
      }
      try {
        const remote = await gasClient.getSharedData<PurchaseSalesRow[]>(sharedKey);
        if (!hasPendingLocal && Array.isArray(remote)) {
          nextRows = normalizePurchaseRows(remote);
          remoteLoaded = true;
        }
      } catch (error) {
        console.warn("월 매입 공통 데이터를 불러오지 못했습니다.", error);
      }
      if (!remoteLoaded && nextRows.length === 0) {
        try {
          const saved = localStorage.getItem(storageKey);
          if (saved) nextRows = normalizePurchaseRows(JSON.parse(saved));
        } catch {}
      }
      if (!remoteLoaded && nextRows.length === 0) {
        const previousMonth = addMonthsToMonthInputValue(selectedMonth, -1);
        try {
          const previous = await gasClient.getSharedData<PurchaseSalesRow[]>(`monthly_purchases:${branchName}:${previousMonth}`);
          if (Array.isArray(previous) && previous.length > 0) nextRows = emptyAmounts(previous);
        } catch {}
      }
      if (!remoteLoaded && nextRows.length === 0) {
        try {
          const previousLocal = localStorage.getItem(`erp_monthly_purchases_${branchName}_${addMonthsToMonthInputValue(selectedMonth, -1)}`);
          if (previousLocal) nextRows = emptyAmounts(JSON.parse(previousLocal));
        } catch {}
      }
      if (!remoteLoaded && nextRows.length === 0) nextRows = defaultRows();
      if (!cancelled) {
        setRows(nextRows);
        localStorage.setItem(storageKey, JSON.stringify(nextRows));
        if (hasPendingLocal && remoteLoaded) {
          gasClient.saveSharedData(sharedKey, nextRows)
            .then(() => localStorage.removeItem(pendingKey))
            .catch((error) => console.warn("월 매입 공통 데이터 재저장 실패", error));
        }
      }
    };
    loadPurchases();
    return () => {
      cancelled = true;
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      if (localStorage.getItem(pendingKey) === "1") {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          try {
            const pendingRows = normalizePurchaseRows(JSON.parse(saved));
            void gasClient.saveSharedData(sharedKey, pendingRows)
              .then(() => localStorage.removeItem(pendingKey))
              .catch((error) => console.warn("Pending monthly purchases save failed during tab change.", error));
          } catch (error) {
            console.warn("Pending monthly purchases could not be parsed during tab change.", error);
          }
        }
      }
    };
  }, [branchName, defaultRows, emptyAmounts, normalizePurchaseRows, pendingKey, selectedMonth, sharedKey, storageKey]);

  const persistRows = useCallback((nextRows: PurchaseSalesRow[], showToast = false) => {
    setRows(nextRows);
    localStorage.setItem(storageKey, JSON.stringify(nextRows));
    localStorage.setItem(pendingKey, "1");
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      gasClient.saveSharedData(sharedKey, nextRows)
        .then(() => {
          localStorage.removeItem(pendingKey);
          if (showToast) triggerToast("매입매출 내용이 저장되었습니다!", "success");
        })
        .catch(() => triggerToast("저장 중 부득이한 에러발생", "error"));
    }, 450);
  }, [pendingKey, sharedKey, storageKey, triggerToast]);

  const handleSave = async () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(rows));
      localStorage.setItem(pendingKey, "1");
      await gasClient.saveSharedData(sharedKey, rows);
      localStorage.removeItem(pendingKey);
      triggerToast("매입매출 내용이 저장되었습니다!", "success");
    } catch {
      triggerToast("저장 중 부득이한 에러발생", "error");
    }
  };

  const handleUpdateRow = (id: string, field: keyof PurchaseSalesRow, val: any) => {
    if (isLocked) return;
    const nextValue = ["transferAmount", "prepaidChargeAmount", "monthlyUsageAmount"].includes(String(field))
      ? cleanNumeric(String(val || ""))
      : val;
    setRows(prev => {
      const nextRows = prev.map(r => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: nextValue };
        // If it's regular vendor and transferAmount changes, sync usageAmount
        if (field === "transferAmount" && !updated.isPrepaid) {
          updated.monthlyUsageAmount = nextValue;
        }
        if (field === "isPrepaid" && val === true && !updated.prepaidChargeAmount) {
          updated.prepaidChargeAmount = updated.transferAmount || "";
        }
        if (field === "isPrepaid" && val === false) {
          updated.prepaidChargeAmount = "";
          updated.monthlyUsageAmount = updated.transferAmount || "";
        }
        return updated;
      });
      localStorage.setItem(storageKey, JSON.stringify(nextRows));
      localStorage.setItem(pendingKey, "1");
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = window.setTimeout(() => {
        gasClient.saveSharedData(sharedKey, nextRows)
          .then(() => localStorage.removeItem(pendingKey))
          .catch(() => triggerToast("저장 중 부득이한 에러발생", "error"));
      }, 450);
      return nextRows;
    });
  };

  const handleAddRow = () => {
    if (isLocked) return;
    const nextRow: PurchaseSalesRow = {
      id: `p_${Date.now()}`,
      category: "식재료비",
      vendorName: "",
      transferAmount: "",
      bank: "",
      accountNumber: "",
      isPrepaid: false,
      prepaidChargeAmount: "",
      monthlyUsageAmount: "",
      memo: ""
    };
    persistRows([...rows, nextRow]);
  };

  const handleDeleteRow = (id: string) => {
    if (isLocked) return;
    persistRows(rows.filter(r => r.id !== id));
  };

  useEffect(() => {
    if (!resetToken) return;
    setRows((currentRows) => {
      const resetRows = currentRows.map((row) => ({
        ...row,
        transferAmount: "",
        prepaidChargeAmount: "",
        monthlyUsageAmount: ""
      }));
      localStorage.setItem(storageKey, JSON.stringify(resetRows));
      localStorage.setItem(pendingKey, "1");
      gasClient.saveSharedData(sharedKey, resetRows)
        .then(() => localStorage.removeItem(pendingKey))
        .catch((error) => {
          console.warn("월말마감 취소 금액 초기화 저장 실패:", error);
        });
      return resetRows;
    });
  }, [pendingKey, resetToken, sharedKey, storageKey]);

  // Calculations
  const totalTransfer = rows.reduce((acc, r) => acc + (Number(r.transferAmount) || 0), 0);
  const totalPrepaidCharge = rows.reduce((acc, r) => acc + (Number(r.prepaidChargeAmount) || 0), 0);
  const totalUsage = rows.reduce((acc, r) => acc + (Number(r.monthlyUsageAmount) || 0), 0);

  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5 animate-fade-in" id="purchase-sales-subtab">
      <div className="flex justify-between items-center pb-3 border-b border-gray-50">
        <div>
          <h3 className="text-sm font-black text-zinc-900 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-[#2E6DB4]" />
            월말 이체 필요한 거래처 등록
          </h3>
          <p className="text-[10px] text-gray-400 font-semibold mt-0.5">
            이체 필요한 업체만 기입을 하세요. 쿠팡,네이버는 등록x
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleAddRow}
            disabled={isLocked}
            className="p-1 px-3 bg-blue-50 hover:bg-blue-100 text-[#2E6DB4] rounded-lg text-xs font-black flex items-center gap-1 cursor-pointer transition-colors shadow-none disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" /> 매입 업체 추가
          </button>
          <div className={`p-1 px-3.5 rounded-lg text-xs font-black flex items-center gap-1 shadow-subtle ${isLocked ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"}`}>
            <Check className="w-3.5 h-3.5" /> {isLocked ? "확정 잠금" : "자동저장"}
          </div>
        </div>
      </div>
      {isLocked && (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
          월말마감이 확정되어 입력값이 잠겨 있습니다. 수정하려면 상단의 월말마감 수정 버튼을 눌러주세요.
        </div>
      )}

      {/* Aggregate Banner cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-zinc-50/50 p-4 rounded-2xl border border-zinc-100/80 flex justify-between items-center">
          <div>
            <span className="text-[10px] text-gray-400 font-black font-sans">선입금 충전금액 합계</span>
            <p className="text-xl font-black text-blue-700 font-mono mt-0.5">{formatNumber(totalPrepaidCharge)} 원</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-700">
            <Landmark className="w-5 h-5" />
          </div>
        </div>
        <div className="bg-zinc-50/50 p-4 rounded-2xl border border-zinc-100/80 flex justify-between items-center">
          <div>
            <span className="text-[10px] text-gray-400 font-black font-sans">이번 달 실제 현금이체 합계</span>
            <p className="text-xl font-black text-gray-900 font-mono mt-0.5">{formatNumber(totalTransfer)} 원</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-orange-600">
            <Coins className="w-5 h-5" />
          </div>
        </div>
        <div className="bg-zinc-50/50 p-4 rounded-2xl border border-zinc-100/80 flex justify-between items-center">
          <div>
            <span className="text-[10px] text-gray-400 font-black font-sans">이달 실제 총 사용금액 합계 (선입금 포함)</span>
            <p className="text-xl font-black text-[#2E6DB4] font-mono mt-0.5">{formatNumber(totalUsage)} 원</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-[#2E6DB4]">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Sheet Table */}
      <div className="overflow-x-auto rounded-2xl border border-gray-100">
        <table className="w-full text-left text-xs border-collapse font-medium">
          <thead>
            <tr className="bg-zinc-50 border-b border-gray-100 text-zinc-500 font-black text-[10px] tracking-wider">
              <th className="py-3 px-3">분류항목</th>
              <th className="py-3 px-3">송금/사용 대상업체명</th>
              <th className="py-3 px-3 w-32">선입금 충전방식?</th>
              <th className="py-3 px-3 w-32">충전금액 (원)</th>
              <th className="py-3 px-3 w-36">이체필요 금액 (원)</th>
              <th className="py-3 px-3 w-32">실제 이달사용액 (원)</th>
              <th className="py-3 px-3 w-28">은행</th>
              <th className="py-3 px-3">계좌번호</th>
              <th className="py-3 px-3">거래 비고 고지</th>
              <th className="py-3 px-3 text-center w-12">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-[11px]">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-16 text-center text-gray-400">
                  매입매출에 등록된 거래처가 없습니다. 상단의 '매입 업체 추가'를 클릭해 작성해주세요.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-50/30">
                  <td className="py-2 px-2.5">
                    <select
                      value={row.category}
                      disabled={isLocked}
                      onChange={(e) => handleUpdateRow(row.id, "category", e.target.value)}
                      className="w-full p-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-800 focus:outline-none disabled:bg-zinc-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                    >
                      <option value="식재료비">식재료비</option>
                      <option value="주류비">주류비</option>
                      <option value="식음료외 기타">식음료외 기타</option>
                    </select>
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="text"
                      value={row.vendorName}
                      disabled={isLocked}
                      onChange={(e) => handleUpdateRow(row.id, "vendorName", e.target.value)}
                      placeholder="자재상호 혹은 업체명"
                      className="w-full p-1.5 border border-gray-200 rounded-lg text-xs font-bold placeholder-gray-300 focus:outline-none focus:border-[#2E6DB4] disabled:bg-zinc-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="py-2 px-2.5 text-center">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={row.isPrepaid}
                        disabled={isLocked}
                        onChange={(e) => handleUpdateRow(row.id, "isPrepaid", e.target.checked)}
                        className="w-4 h-4 text-[#2E6DB4] border-gray-300 rounded focus:ring-1 focus:ring-[#2E6DB4] disabled:cursor-not-allowed"
                      />
                      <span className="text-[9px] font-black text-gray-600">선입금</span>
                    </label>
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatWithCommas(row.prepaidChargeAmount || "")}
                      disabled={isLocked || !row.isPrepaid}
                      onChange={(e) => handleUpdateRow(row.id, "prepaidChargeAmount", e.target.value)}
                      placeholder={row.isPrepaid ? "충전 금액" : "-"}
                      className={`w-full p-1.5 border rounded-lg text-xs font-mono font-black text-right focus:outline-none ${
                        row.isPrepaid ? "border-gray-200 focus:border-[#2E6DB4] text-blue-700" : "bg-zinc-100 text-gray-400 border-gray-200 cursor-not-allowed"
                      }`}
                    />
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatWithCommas(row.transferAmount)}
                      disabled={isLocked}
                      onChange={(e) => handleUpdateRow(row.id, "transferAmount", e.target.value)}
                      placeholder="송금 필요 금액"
                      className="w-full p-1.5 border border-gray-200 rounded-lg text-xs font-mono font-black text-right focus:outline-none focus:border-[#2E6DB4] text-red-650 disabled:bg-zinc-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatWithCommas(row.monthlyUsageAmount)}
                      disabled={isLocked || !row.isPrepaid}
                      onChange={(e) => handleUpdateRow(row.id, "monthlyUsageAmount", e.target.value)}
                      placeholder={row.isPrepaid ? "발주액 합계" : "-"}
                      className={`w-full p-1.5 border rounded-lg text-xs font-mono font-black text-right focus:outline-none ${
                        row.isPrepaid ? "border-gray-200 focus:border-[#2E6DB4] text-gray-800" : "bg-zinc-100 text-gray-400 border-gray-200 cursor-not-allowed"
                      }`}
                    />
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="text"
                      value={row.bank}
                      disabled={isLocked}
                      onChange={(e) => handleUpdateRow(row.id, "bank", e.target.value)}
                      placeholder="은행"
                      className="w-full p-1.5 border border-gray-200 rounded-lg text-xs font-bold placeholder-gray-300 focus:outline-none focus:border-[#2E6DB4] disabled:bg-zinc-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="text"
                      value={row.accountNumber}
                      disabled={isLocked}
                      onChange={(e) => handleUpdateRow(row.id, "accountNumber", e.target.value)}
                      placeholder="계좌 번호 입력"
                      className="w-full p-1.5 border border-gray-200 rounded-lg text-xs font-mono font-medium placeholder-gray-300 focus:outline-none focus:border-[#2E6DB4] disabled:bg-zinc-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="text"
                      value={row.memo}
                      disabled={isLocked}
                      onChange={(e) => handleUpdateRow(row.id, "memo", e.target.value)}
                      placeholder="예시: 매월 자동 이체"
                      className="w-full p-1.5 border border-gray-200 rounded-lg text-xs font-semibold placeholder-gray-350 focus:outline-none focus:border-[#2E6DB4] disabled:bg-zinc-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="py-2 px-2.5 text-center">
                    <button
                      onClick={() => handleDeleteRow(row.id)}
                      disabled={isLocked}
                      className="text-gray-400 hover:text-rose-600 p-1.5 rounded-lg transition-colors cursor-pointer disabled:text-gray-200 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// 2-2. SUB TAB: 파트타이머 급여대장
// ----------------------------------------------------------------------------
interface PartTimeSalaryRow {
  employeeId: string;
  name: string;
  residentNumber: string;
  entryDate: string;
  contractStatus: "완료" | "미작성";
  bank: string;
  accountNumber: string;
  hourlyRate: string;
  accumulatedHours: string;
  tipsEtcAmount: string;
  calculatedSalary: string;
  attendanceDates: string;
  actualPaidAmount: string;
  payoutBranch: string;
  memo: string;
}

function MonthlyPartTimeSalarySubTab({
  branchName,
  selectedMonth,
  history,
  triggerToast
}: {
  branchName: string;
  selectedMonth: string;
  history: any[];
  triggerToast: (msg: string, type?: "success" | "error") => void;
}) {
  const [salaries, setSalaries] = useState<PartTimeSalaryRow[]>([]);
  const [excludedEmployeeIds, setExcludedEmployeeIds] = useState<string[]>([]);
  const salaryAutoSaveTimerRef = useRef<number | null>(null);

  const salaryStorageKey = `erp_monthly_part_time_salary_${branchName}_${selectedMonth}`;
  const salaryDataKey = `part_time_salaries:${branchName}:${selectedMonth}`;
  const exclusionStorageKey = `erp_monthly_part_time_exclusions_${branchName}_${selectedMonth}`;
  const exclusionDataKey = `part_time_salary_exclusions:${branchName}:${selectedMonth}`;
  const salaryPendingKey = pendingLocalSaveStorageKey(salaryStorageKey);
  const exclusionPendingKey = pendingLocalSaveStorageKey(exclusionStorageKey);

  const buildPartTimeProfiles = useCallback((sourceSalaries: PartTimeSalaryRow[]) => {
    return sourceSalaries.reduce((result: Record<string, any>, sal) => {
      result[sal.employeeId] = {
        residentNumber: sal.residentNumber,
        entryDate: sal.entryDate,
        contractStatus: sal.contractStatus,
        bank: sal.bank,
        accountNumber: sal.accountNumber,
        hourlyRate: sal.hourlyRate
      };
      return result;
    }, {});
  }, []);

  const persistPartTimeSalaries = useCallback((nextSalaries: PartTimeSalaryRow[], nextExcluded = excludedEmployeeIds, showToast = false) => {
    setSalaries(nextSalaries);
    nextSalaries.forEach((sal) => {
      localStorage.setItem(`erp_pt_profile_${branchName}_${sal.employeeId}`, JSON.stringify({
        residentNumber: sal.residentNumber,
        entryDate: sal.entryDate,
        contractStatus: sal.contractStatus,
        bank: sal.bank,
        accountNumber: sal.accountNumber,
        hourlyRate: sal.hourlyRate
      }));
    });
    localStorage.setItem(salaryStorageKey, JSON.stringify(nextSalaries));
    localStorage.setItem(exclusionStorageKey, JSON.stringify(nextExcluded));
    localStorage.setItem(salaryPendingKey, "1");
    localStorage.setItem(exclusionPendingKey, "1");
    if (salaryAutoSaveTimerRef.current) window.clearTimeout(salaryAutoSaveTimerRef.current);
    salaryAutoSaveTimerRef.current = window.setTimeout(() => {
      Promise.all([
        gasClient.saveSharedData(salaryDataKey, nextSalaries),
        gasClient.saveSharedData(`part_time_profiles:${branchName}`, buildPartTimeProfiles(nextSalaries)),
        gasClient.saveSharedData(exclusionDataKey, nextExcluded)
      ])
        .then(() => {
          localStorage.removeItem(salaryPendingKey);
          localStorage.removeItem(exclusionPendingKey);
          if (showToast) triggerToast("파트타이머 급여대장이 저장되었습니다.", "success");
        })
        .catch(() => triggerToast("급여지급 대장 자동저장 실패", "error"));
    }, 500);
  }, [branchName, buildPartTimeProfiles, excludedEmployeeIds, exclusionDataKey, exclusionPendingKey, exclusionStorageKey, salaryDataKey, salaryPendingKey, salaryStorageKey, triggerToast]);

  useEffect(() => {
    return () => {
      if (salaryAutoSaveTimerRef.current) {
        window.clearTimeout(salaryAutoSaveTimerRef.current);
        salaryAutoSaveTimerRef.current = null;
      }
      const salaryPending = localStorage.getItem(salaryPendingKey) === "1";
      const exclusionPending = localStorage.getItem(exclusionPendingKey) === "1";
      if (!salaryPending && !exclusionPending) return;

      const savedSalaries = localStorage.getItem(salaryStorageKey);
      const savedExclusions = localStorage.getItem(exclusionStorageKey);
      try {
        const pendingSalaries = savedSalaries ? JSON.parse(savedSalaries) : [];
        const pendingExclusions = savedExclusions ? JSON.parse(savedExclusions) : [];
        const saveTasks: Promise<{ success: boolean }>[] = [];
        if (salaryPending && Array.isArray(pendingSalaries)) {
          saveTasks.push(gasClient.saveSharedData(salaryDataKey, pendingSalaries));
          saveTasks.push(gasClient.saveSharedData(`part_time_profiles:${branchName}`, buildPartTimeProfiles(pendingSalaries)));
        }
        if (exclusionPending && Array.isArray(pendingExclusions)) {
          saveTasks.push(gasClient.saveSharedData(exclusionDataKey, pendingExclusions));
        }
        void Promise.all(saveTasks)
          .then(() => {
            if (salaryPending) localStorage.removeItem(salaryPendingKey);
            if (exclusionPending) localStorage.removeItem(exclusionPendingKey);
          })
          .catch((error) => {
            console.warn("Pending part-time salary save failed during tab change.", error);
          });
      } catch (error) {
        console.warn("Pending part-time salary data could not be parsed during tab change.", error);
      }
    };
  }, [branchName, buildPartTimeProfiles, exclusionDataKey, exclusionPendingKey, exclusionStorageKey, salaryDataKey, salaryPendingKey, salaryStorageKey]);

  useEffect(() => {
    let active = true;
    const loadExclusions = async () => {
      try {
        const local = localStorage.getItem(exclusionStorageKey);
        const hasPendingExclusions = localStorage.getItem(exclusionPendingKey) === "1";
        if (local && active) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed)) setExcludedEmployeeIds(parsed);
          if (hasPendingExclusions) {
            await gasClient.saveSharedData(exclusionDataKey, parsed);
            localStorage.removeItem(exclusionPendingKey);
            return;
          }
        }

        const remote = await gasClient.getSharedData<string[]>(exclusionDataKey);
        if (active && Array.isArray(remote)) {
          setExcludedEmployeeIds(remote);
          localStorage.setItem(exclusionStorageKey, JSON.stringify(remote));
        }
      } catch (error) {
        console.warn("파트타이머 급여대장 제외 목록을 불러오지 못했습니다.", error);
      }
    };
    loadExclusions();
    return () => { active = false; };
  }, [exclusionDataKey, exclusionPendingKey, exclusionStorageKey]);

  // 1. Fetch current live Roster for PTs and merge with previously saved info + auto computed work logs from history!
  useEffect(() => {
    // A. Retrieve general roster
    let rosterPartTimers: any[] = [];
    try {
      const savedRoster = localStorage.getItem(`erp_staff_list_${branchName}`);
      if (savedRoster) {
        const parsed = JSON.parse(savedRoster);
        rosterPartTimers = parsed.filter((emp: any) => emp.division === "파트타이머");
      }
    } catch (e) {
      console.error("Roster 파악 에러:", e);
    }

    // B. Calculate PT hours & attendance dates from DAILY HISTORY of the selected month
    const ptTelemetry: { [name: string]: { hours: number; dates: string[] } } = {};
    history.forEach((m) => {
      // Check if day belongs toselected month (YYYY-MM-DD startsWith YYYY-MM)
      if (m.settleDate && m.settleDate.startsWith(selectedMonth)) {
        const parts = (m.memo || "").split("\n---\nMETADATA:");
        if (parts[1]) {
          try {
            const meta = JSON.parse(parts[1].trim());
            if (meta && meta.staffRows) {
              meta.staffRows.forEach((s: any) => {
                if (s.division === "파트타이머" && Number(s.workHours || 0) > 0) {
                  if (!ptTelemetry[s.name]) {
                    ptTelemetry[s.name] = { hours: 0, dates: [] };
                  }
                  ptTelemetry[s.name].hours += Number(s.workHours || 0);

                  // Keep only date day integer like "28" or "28"
                  const dateParts = m.settleDate.split("-");
                  const daySuffix = dateParts[2] ? `${Number(dateParts[2])}` : m.settleDate;
                  if (!ptTelemetry[s.name].dates.includes(daySuffix)) {
                    ptTelemetry[s.name].dates.push(daySuffix);
                  }
                }
              });
            }
          } catch {}
        }
      }
    });

    // C. Combine with stored monthly salary configurations for the selected branch/month
    let savedSalaryMap: { [empId: string]: Partial<PartTimeSalaryRow> } = {};
    try {
        const savedConfig = localStorage.getItem(salaryStorageKey);
      if (savedConfig) {
        const list: PartTimeSalaryRow[] = JSON.parse(savedConfig);
        list.forEach((item) => {
          savedSalaryMap[item.employeeId] = item;
        });
      }
    } catch {}

    // D. Fetch profile memory (은행, 주민번호, 입사일 등 매월 반복되는 기초 사원 데이터) to auto-fill across months
    const getStoredProfile = (empId: string): any => {
      try {
        const stored = localStorage.getItem(`erp_pt_profile_${branchName}_${empId}`);
        if (stored) return JSON.parse(stored);
      } catch {}
      return {};
    };

    // E. Assemble all pieces
    const excluded = new Set(excludedEmployeeIds);
    const assembledRows: PartTimeSalaryRow[] = rosterPartTimers
      .filter((pt) => !excluded.has(pt.id))
      .map((pt) => {
      const tel = ptTelemetry[pt.name] || { hours: 0, dates: [] };
      const saved = savedSalaryMap[pt.id] || {};
      const profile = getStoredProfile(pt.id);

      // Default values
      const hourlyRate = saved.hourlyRate || profile.hourlyRate || "15000";
      const tipsEtcAmount = saved.tipsEtcAmount || "0";
      // Cumulative hours synced dynamically unless edited
      const accumulatedHours = saved.accumulatedHours !== undefined
        ? saved.accumulatedHours
        : String(tel.hours);

      const calcSalary = String((Number(hourlyRate) * Number(accumulatedHours)) + (Number(tipsEtcAmount) || 0));
      // Forced empty string per "본사에서 입력해야 하는 칸이라 일단 공란으로 해두고"
      const calcActualPaid = saved.actualPaidAmount || "";

      // Sorted days text - limited to maximum of 7 elements as requested
      const attendanceDates = saved.attendanceDates !== undefined
        ? String(saved.attendanceDates).split(",").map((day) => day.trim()).filter(Boolean).slice(0, 7).join(",")
        : tel.dates.sort((a,b) => Number(a) - Number(b)).slice(0, 7).join(",");

      return {
        employeeId: pt.id,
        name: pt.name,
        residentNumber: saved.residentNumber || profile.residentNumber || pt.residentNumber || "",
        entryDate: saved.entryDate || profile.entryDate || pt.entryDate || "",
        contractStatus: saved.contractStatus || profile.contractStatus || "미작성",
        bank: saved.bank || profile.bank || "",
        accountNumber: saved.accountNumber || profile.accountNumber || "",
        hourlyRate,
        accumulatedHours,
        tipsEtcAmount,
        calculatedSalary: calcSalary,
        attendanceDates,
        actualPaidAmount: calcActualPaid,
        payoutBranch: saved.payoutBranch || branchName,
        memo: saved.memo || ""
      };
      });

    setSalaries(assembledRows);
  }, [branchName, selectedMonth, history, excludedEmployeeIds, salaryStorageKey]);

  useEffect(() => {
    const loadSharedSalaries = async () => {
      try {
        const local = localStorage.getItem(salaryStorageKey);
        if (localStorage.getItem(salaryPendingKey) === "1" && local) {
          const localRows = JSON.parse(local);
          if (Array.isArray(localRows)) {
            const excluded = new Set(excludedEmployeeIds);
            const restoredRows = localRows.filter((salary) => !excluded.has(salary.employeeId)).map((salary) => ({
              ...salary,
              tipsEtcAmount: salary.tipsEtcAmount || "0"
            }));
            setSalaries(restoredRows);
            await gasClient.saveSharedData(salaryDataKey, localRows);
            localStorage.removeItem(salaryPendingKey);
            return;
          }
        }
        const remote = await gasClient.getSharedData<PartTimeSalaryRow[]>(salaryDataKey);
        // 빈 배열은 아직 저장된 급여대장이 없다는 뜻이므로, 일일마감에서 계산한 행을 유지합니다.
        if (Array.isArray(remote) && remote.length > 0) {
          const excluded = new Set(excludedEmployeeIds);
          setSalaries(remote.filter((salary) => !excluded.has(salary.employeeId)).map((salary) => ({
            ...salary,
            tipsEtcAmount: salary.tipsEtcAmount || "0"
          })));
        }
      } catch (error) {
        console.warn("파트타이머 급여 공통 데이터를 불러오지 못했습니다.", error);
      }
    };
    loadSharedSalaries();
  }, [excludedEmployeeIds, salaryDataKey, salaryPendingKey, salaryStorageKey]);

  useEffect(() => {
    const loadSharedProfiles = async () => {
      try {
        const profiles = await gasClient.getSharedData<Record<string, any>>(`part_time_profiles:${branchName}`);
      if (!profiles || localStorage.getItem(salaryPendingKey) === "1") return;
        Object.entries(profiles).forEach(([employeeId, profile]) => {
          localStorage.setItem(`erp_pt_profile_${branchName}_${employeeId}`, JSON.stringify(profile));
        });
        setSalaries((current) => current.map((salary) => {
          const profile = profiles[salary.employeeId];
          return profile ? {
            ...salary,
            residentNumber: salary.residentNumber || profile.residentNumber || "",
            entryDate: salary.entryDate || profile.entryDate || "",
            contractStatus: salary.contractStatus || profile.contractStatus || salary.contractStatus,
            bank: salary.bank || profile.bank || "",
            accountNumber: salary.accountNumber || profile.accountNumber || "",
            hourlyRate: salary.hourlyRate || profile.hourlyRate || salary.hourlyRate
          } : salary;
        }));
      } catch (error) {
        console.warn("파트타이머 프로필 공통 데이터를 불러오지 못했습니다.", error);
      }
    };
    loadSharedProfiles();
  }, [branchName, salaryPendingKey]);

  // 다른 기기에서도 공통 직원현황을 기준으로 파트타이머 행을 생성합니다.
  useEffect(() => {
    const mergeRemotePartTimers = async () => {
      try {
        const roster = await gasClient.getBranchOwnRoster(branchName);
        const partTimers = roster.filter((employee) => employee.division === "파트타이머");
        if (partTimers.length === 0) return;

        const telemetry: Record<string, { hours: number; dates: string[] }> = {};
        history.filter((record) => record.settleDate?.startsWith(selectedMonth)).forEach((record) => {
          const metadata = String(record.memo || "").split("\n---\nMETADATA:")[1];
          if (!metadata) return;
          try {
            JSON.parse(metadata).staffRows?.forEach((staff: any) => {
              if (staff.division !== "파트타이머" || !staff.name || Number(staff.workHours || 0) <= 0) return;
              const item = telemetry[staff.name] || { hours: 0, dates: [] };
              item.hours += Number(staff.workHours || 0);
              const day = String(record.settleDate).split("-")[2];
              if (day && !item.dates.includes(day)) item.dates.push(day);
              telemetry[staff.name] = item;
            });
          } catch {}
        });

        // 기존 파트타이머 일지에만 있는 직원도 급여대장에 포함합니다.
        // 직원현황에 등록되지 않은 과거 기록은 이름 기반 임시 ID를 사용합니다.
        const allPartTimers = [...partTimers];
        const rosterNames = new Set(allPartTimers.map((employee) => employee.name));
        Object.keys(telemetry).forEach((name) => {
          if (!rosterNames.has(name)) {
            allPartTimers.push({
              id: `legacy-${branchName}-${name}`,
              name,
              division: "파트타이머"
            });
          }
        });

        setSalaries((current) => {
          const byEmployeeId = new Map<string, PartTimeSalaryRow>(current.map((salary) => [salary.employeeId, salary]));
          const excluded = new Set(excludedEmployeeIds);
          return allPartTimers.filter((employee) => !excluded.has(employee.id)).map((employee) => {
            const existing = byEmployeeId.get(employee.id);
            const work = telemetry[employee.name] || { hours: 0, dates: [] };
            const attendanceDates = work.dates.sort((a, b) => Number(a) - Number(b)).slice(0, 7).map((day) => String(Number(day))).join(",");
            if (existing) {
              const accumulatedHours = existing.accumulatedHours !== undefined && existing.accumulatedHours !== ""
                ? existing.accumulatedHours
                : String(work.hours);
              const calculatedSalary = existing.calculatedSalary !== undefined && existing.calculatedSalary !== ""
                ? existing.calculatedSalary
                : String(((Number(existing.hourlyRate) || 0) * Number(accumulatedHours || 0)) + (Number(existing.tipsEtcAmount) || 0));
              return {
                ...existing,
                residentNumber: existing.residentNumber || employee.residentNumber || "",
                entryDate: existing.entryDate || employee.entryDate || "",
                contractStatus: existing.contractStatus || (employee as any).contractStatus || existing.contractStatus,
                accumulatedHours,
                tipsEtcAmount: existing.tipsEtcAmount || "0",
                attendanceDates: existing.attendanceDates || attendanceDates,
                calculatedSalary
              };
            }
            const hourlyRate = "15000";
            return {
              employeeId: employee.id,
              name: employee.name,
              residentNumber: employee.residentNumber || "",
              entryDate: employee.entryDate || "",
              contractStatus: "미작성",
              bank: "",
              accountNumber: "",
              hourlyRate,
              accumulatedHours: String(work.hours),
              tipsEtcAmount: "0",
              calculatedSalary: String(Number(hourlyRate) * work.hours),
              attendanceDates,
              actualPaidAmount: "",
              payoutBranch: branchName,
              memo: ""
            } as PartTimeSalaryRow;
          });
        });
      } catch (error) {
        console.warn("공통 파트타이머 명단을 불러오지 못했습니다.", error);
      }
    };
    mergeRemotePartTimers();
  }, [branchName, selectedMonth, history, excludedEmployeeIds]);

  const handleUpdate = (empId: string, field: keyof PartTimeSalaryRow, value: any) => {
    const nextSalaries = salaries.map(item => {
      if (item.employeeId !== empId) return item;
      const nextValue = field === "tipsEtcAmount" ? cleanNumeric(String(value || "")) : value;
      const updated = { ...item, [field]: nextValue };
      // Recalculate salary if wage or code changes
      if (field === "hourlyRate" || field === "accumulatedHours" || field === "tipsEtcAmount") {
        const wage = Number(updated.hourlyRate) || 0;
        const hrs = Number(updated.accumulatedHours) || 0;
        const tips = Number(updated.tipsEtcAmount) || 0;
        updated.calculatedSalary = String((wage * hrs) + tips);
        updated.actualPaidAmount = String((wage * hrs) + tips); // Pre-fill with normal calculation
      }
      return updated;
    });
    persistPartTimeSalaries(nextSalaries);
  };

  const handleExcludeEmployee = (employee: PartTimeSalaryRow) => {
    if (!window.confirm(`${employee.name} 님을 이번 달 파트타이머 급여대장에서 제외할까요?\n직원현황과 일일마감 근무기록은 삭제되지 않습니다.`)) return;

    const nextSalaries = salaries.filter((salary) => salary.employeeId !== employee.employeeId);
    const nextExcluded = excludedEmployeeIds.includes(employee.employeeId)
      ? excludedEmployeeIds
      : [...excludedEmployeeIds, employee.employeeId];
    setExcludedEmployeeIds(nextExcluded);
    persistPartTimeSalaries(nextSalaries, nextExcluded, true);
    triggerToast(`${employee.name} 님을 이번 달 급여대장에서 제외했습니다.`);
  };

  const handleSave = async () => {
    try {
      // 1. Maintain profiles in local database for long-term memoization
      salaries.forEach((sal) => {
        const profile = {
          residentNumber: sal.residentNumber,
          entryDate: sal.entryDate,
          contractStatus: sal.contractStatus,
          bank: sal.bank,
          accountNumber: sal.accountNumber,
          hourlyRate: sal.hourlyRate
        };
        localStorage.setItem(`erp_pt_profile_${branchName}_${sal.employeeId}`, JSON.stringify(profile));
      });

      const profiles = salaries.reduce((result: Record<string, any>, sal) => {
        result[sal.employeeId] = {
          residentNumber: sal.residentNumber,
          entryDate: sal.entryDate,
          contractStatus: sal.contractStatus,
          bank: sal.bank,
          accountNumber: sal.accountNumber,
          hourlyRate: sal.hourlyRate
        };
        return result;
      }, {});

      // 2. Save current month's specific transactions
      localStorage.setItem(salaryStorageKey, JSON.stringify(salaries));
      localStorage.setItem(exclusionStorageKey, JSON.stringify(excludedEmployeeIds));
      localStorage.setItem(salaryPendingKey, "1");
      localStorage.setItem(exclusionPendingKey, "1");
      await Promise.all([
        gasClient.saveSharedData(salaryDataKey, salaries),
        gasClient.saveSharedData(`part_time_profiles:${branchName}`, profiles),
        gasClient.saveSharedData(exclusionDataKey, excludedEmployeeIds)
      ]);
      localStorage.removeItem(salaryPendingKey);
      localStorage.removeItem(exclusionPendingKey);
      triggerToast("파트타이머 급여대장이 직원현황 연동 및 시각화 저장 성공하였습니다!", "success");
    } catch {
      triggerToast("급여지급 대장 등록 안됨", "error");
    }
  };

  // Grand totals
  // 실제 근무시간이 없는 인원은 이번 달 급여대장에 표시하지 않습니다.
  const visibleSalaries = salaries.filter((salary) => Number(salary.accumulatedHours) > 0);
  const totalHours = visibleSalaries.reduce((acc, s) => acc + (Number(s.accumulatedHours) || 0), 0);
  const totalSalary = visibleSalaries.reduce((acc, s) => acc + (Number(s.calculatedSalary) || 0), 0);

  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5 animate-fade-in" id="parttime-salaries-subtab">
      <div className="flex justify-between items-center pb-3 border-b border-gray-50 flex-col sm:flex-row gap-3">
        <div>
          <h3 className="text-sm font-black text-zinc-900 flex items-center gap-1.5 leading-snug">
            <Users className="w-5 h-5 text-[#2E6DB4]" />
            아르바이트(파트타이머) 월 종합 급여 기산표
          </h3>
          <p className="text-[10px] text-gray-400 font-extrabold mt-1">
             직원현황의 파트타이머 리스트가 자동으로 연동되고, 이번 달 일일 일지에서 실시간 근무시간과 출근일이 집계되어 프리필링됩니다.
          </p>
        </div>

        <div className="w-full sm:w-auto px-5 py-3 bg-emerald-50 text-emerald-700 rounded-xl text-sm font-black flex items-center justify-center gap-2 shadow-sm">
          <Check className="w-4 h-4" />
          자동저장
        </div>
      </div>

      {/* Stats cards block */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100 flex justify-between items-center">
          <div>
            <span className="text-[9px] text-zinc-450 font-black">총합 누적근무 (시간)</span>
            <p className="text-lg font-black text-zinc-850 font-mono mt-0.5">{totalHours} hr</p>
          </div>
          <span className="text-xs bg-zinc-200/50 p-2 rounded-xl text-zinc-650 font-bold font-mono">
            {visibleSalaries.length} 명
          </span>
        </div>
        <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100 flex justify-between items-center">
          <div>
            <span className="text-[9px] text-zinc-450 font-black">총액 원시급여 합계 (세전)</span>
            <p className="text-lg font-black text-[#2E6DB4] font-mono mt-0.5">{formatNumber(totalSalary)} 원</p>
          </div>
          <span className="text-[10px] text-zinc-400 font-bold">100% 자동 산정</span>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="overflow-x-auto rounded-2xl border border-gray-100 shadow-xs">
        <table className="w-full text-left text-xs border-collapse font-medium min-w-[1330px]">
          <thead>
            <tr className="bg-zinc-50 border-b border-gray-100 text-zinc-550 font-black text-[9px] tracking-wider uppercase">
              <th className="py-3 px-3 w-20 whitespace-nowrap">성명 (사원)</th>
              <th className="py-3 px-3 w-32 whitespace-nowrap">주민등록번호</th>
              <th className="py-3 px-2 w-28 whitespace-nowrap">입사일자</th>
              <th className="py-3 px-3 w-20 whitespace-nowrap">은행</th>
              <th className="py-3 px-3 w-32 whitespace-nowrap">입금 계좌번호</th>
              <th className="py-3 px-3 w-20 text-right whitespace-nowrap">시급 (원)</th>
              <th className="py-3 px-2 w-16 text-right whitespace-nowrap">누적시간</th>
              <th className="py-3 px-2 w-20 text-right whitespace-nowrap">팁/기타</th>
              <th className="py-3 px-3 w-24 text-right whitespace-nowrap">기본급여</th>
              <th className="py-3 px-3 w-28 whitespace-nowrap">근무일정 (출근일)</th>
              <th className="py-3 px-3 w-[260px] whitespace-nowrap">기타 비고 내용 (퇴사일 등)</th>
              <th className="py-3 px-3 w-20 text-center whitespace-nowrap">제외</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-[10px] font-sans">
            {visibleSalaries.length === 0 ? (
              <tr>
                <td colSpan={12} className="py-16 text-center text-gray-400 font-bold">
                  이번 달 근무시간이 기록된 파트타이머가 없습니다.
                </td>
              </tr>
            ) : (
              visibleSalaries.map((sal) => (
                <tr key={sal.employeeId} className="hover:bg-zinc-50/40">
                  <td className="py-3 px-3 font-extrabold text-zinc-900 text-xs whitespace-nowrap">
                    {sal.name}
                  </td>
                  <td className="py-2.5 px-1.5">
                    <input
                      type="text"
                      value={sal.residentNumber}
                      onChange={(e) => handleUpdate(sal.employeeId, "residentNumber", e.target.value)}
                      className="w-full p-1 bg-white border border-gray-200 rounded text-xs font-mono font-bold text-gray-800 tracking-tighter text-center"
                    />
                  </td>
                  <td className="py-2.5 px-1">
                    <input
                      type="date"
                      value={toDateInputValue(sal.entryDate)}
                      onChange={(e) => handleUpdate(sal.employeeId, "entryDate", e.target.value)}
                      className="w-[108px] p-1 bg-white border border-gray-200 rounded text-xs text-gray-800 text-center"
                    />
                  </td>
                  <td className="py-2.5 px-1.5">
                    <input
                      type="text"
                      value={sal.bank}
                      onChange={(e) => handleUpdate(sal.employeeId, "bank", e.target.value)}
                      className="w-full p-1 bg-white border border-gray-200 rounded text-xs font-bold text-gray-800 text-center"
                    />
                  </td>
                  <td className="py-2.5 px-1.5">
                    <input
                      type="text"
                      value={sal.accountNumber}
                      onChange={(e) => handleUpdate(sal.employeeId, "accountNumber", e.target.value)}
                      className="w-full p-1 bg-white border border-gray-200 rounded text-xs font-mono font-medium text-gray-850"
                    />
                  </td>
                  <td className="py-2.5 px-1.5 text-right">
                    <input
                      type="number"
                      value={sal.hourlyRate}
                      onChange={(e) => handleUpdate(sal.employeeId, "hourlyRate", e.target.value)}
                      className="w-full p-1 bg-white border border-gray-200 rounded text-xs font-mono font-black text-right text-gray-800"
                    />
                  </td>
                  <td className="py-2.5 px-1 text-right">
                    <input
                      type="number"
                      value={sal.accumulatedHours}
                      onChange={(e) => handleUpdate(sal.employeeId, "accumulatedHours", e.target.value)}
                      className="w-[58px] p-1 bg-white border border-gray-200 rounded text-xs font-mono font-black text-right text-blue-600"
                    />
                  </td>
                  <td className="py-2.5 px-1 text-right">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatWithCommas(sal.tipsEtcAmount || "")}
                      onChange={(e) => handleUpdate(sal.employeeId, "tipsEtcAmount", e.target.value)}
                      placeholder="0"
                      className="w-[74px] p-1 bg-white border border-gray-200 rounded text-xs font-mono font-black text-right text-emerald-700"
                    />
                  </td>
                  <td className="py-2.5 px-1.5 text-right font-mono font-black text-gray-700">
                    {formatNumber(Number(sal.calculatedSalary) || 0)}원
                  </td>
                  <td className="py-2.5 px-1.5">
                    <input
                      type="text"
                      value={sal.attendanceDates}
                      onChange={(e) => handleUpdate(sal.employeeId, "attendanceDates", e.target.value)}
                      className="w-full p-1 bg-zinc-50 border border-gray-200 rounded text-[10px] font-mono text-zinc-600 truncate focus:outline-none focus:bg-white"
                      title={sal.attendanceDates}
                    />
                  </td>
                  <td className="py-2.5 px-1.5 min-w-[260px]">
                    <input
                      type="text"
                      value={sal.memo}
                      onChange={(e) => handleUpdate(sal.employeeId, "memo", e.target.value)}
                      className="w-full p-2 bg-white border border-gray-200 rounded text-xs font-medium placeholder-gray-300"
                    />
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <button
                      type="button"
                      onClick={() => handleExcludeEmployee(sal)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] font-bold text-rose-600 transition-colors hover:bg-rose-100"
                      title="이번 달 파트타이머 급여대장에서만 제외"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      제외
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// 2-3. SUB TAB: 현금지출 일람
// ----------------------------------------------------------------------------
function MonthlyCashExpensesSubTab({
  branchName,
  selectedMonth,
  history,
  isAdmin = false,
  refreshHistory
}: {
  branchName: string;
  selectedMonth: string;
  history: any[];
  isAdmin?: boolean;
  refreshHistory?: () => Promise<void>;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [editExpense, setEditExpense] = useState<{ item: any; fields: Record<string, string> } | null>(null);
  const [usageFilter, setUsageFilter] = useState("전체");
  const [classificationFilter, setClassificationFilter] = useState("전체");

  useEffect(() => {
    const cashList: any[] = [];

    history.forEach((m) => {
      if (m.settleDate && m.settleDate.startsWith(selectedMonth)) {
        const parts = (m.memo || "").split("\n---\nMETADATA:");
        if (parts[1]) {
          try {
            const meta = JSON.parse(parts[1].trim());
            if (meta && meta.cashExpenses) {
              meta.cashExpenses.forEach((exp: any, index: number) => {
                const itemAmount = Number(exp.amount) || 0;
                if (itemAmount > 0) {
                  cashList.push({
                    recordId: m.recordId,
                    metaIndex: index,
                    date: m.settleDate,
                    paymentType: "현금",
                    amount: itemAmount,
                    usage: exp.usage || "공란",
                    classification: exp.classification || "미분류",
                    detail: exp.detail || "",
                    author: m.submittedBy || m.submitted_by || (m as any).writer || "매니저" ,
                    timestamp: m.submittedAt ? new Date(m.submittedAt).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" }) : "-"
                  });
                }
              });
            }
          } catch {}
        }
      }
    });

    // Sort by Date ascending
    cashList.sort((a,b) => a.date.localeCompare(b.date));
    setItems(cashList);
  }, [selectedMonth, history]);

  const usageOptions = useMemo(
    () => ["전체", ...Array.from(new Set(items.map((item) => String(item.usage || "").trim()).filter(Boolean)))],
    [items]
  );
  const classificationOptions = useMemo(
    () => ["전체", ...Array.from(new Set(items.map((item) => String(item.classification || "").trim()).filter(Boolean)))],
    [items]
  );
  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        const matchesUsage = usageFilter === "전체" || item.usage === usageFilter;
        const matchesClassification = classificationFilter === "전체" || item.classification === classificationFilter;
        return matchesUsage && matchesClassification;
      }),
    [items, usageFilter, classificationFilter]
  );
  const totalSum = filteredItems.reduce((acc, i) => acc + i.amount, 0);

  const handleEditExpense = (item: any) => {
    if (!item.recordId) return;
    setEditExpense({ item, fields: { amount: toNumberPromptValue(item.amount), usage: item.usage || "", classification: item.classification || "", detail: item.detail || "" } });
  };

  const saveEditExpense = async () => {
    if (!editExpense) return;
    const { item, fields } = editExpense;
    const amount = Number(fields.amount);
    if (!Number.isFinite(amount)) {
      alert("금액은 숫자로 입력해주세요.");
      return;
    }
    await updateDailyMetadata(item.recordId, (metadata) => {
      const cashExpenses = Array.isArray(metadata.cashExpenses) ? [...metadata.cashExpenses] : [];
      cashExpenses[item.metaIndex] = { ...(cashExpenses[item.metaIndex] || {}), amount: String(amount), usage: fields.usage.trim(), classification: fields.classification.trim(), detail: fields.detail.trim() };
      return { metadata: { ...metadata, cashExpenses } };
    });
    setEditExpense(null);
    await refreshHistory?.();
  };

  const handleDeleteExpense = async (item: any) => {
    if (!item.recordId || !window.confirm(`${item.date} 현금지출 ${formatNumber(item.amount)}원을 삭제할까요?`)) return;
    await updateDailyMetadata(item.recordId, (metadata) => {
      const cashExpenses = Array.isArray(metadata.cashExpenses) ? [...metadata.cashExpenses] : [];
      cashExpenses.splice(item.metaIndex, 1);
      return { metadata: { ...metadata, cashExpenses } };
    });
    await refreshHistory?.();
  };

  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5 animate-fade-in" id="cash-expenses-subtab">
      {editExpense && (
        <AdminRecordEditModal
          title="현금지출 수정"
          fields={[
            { key: "amount", label: "지출 금액", value: editExpense.fields.amount, type: "number" },
            { key: "usage", label: "거래처/사용처", value: editExpense.fields.usage },
            { key: "classification", label: "분류 항목", value: editExpense.fields.classification },
            { key: "detail", label: "지출내용", value: editExpense.fields.detail }
          ]}
          onChange={(key, value) => setEditExpense((current) => current ? { ...current, fields: { ...current.fields, [key]: value } } : current)}
          onCancel={() => setEditExpense(null)}
          onSave={() => void saveEditExpense()}
        />
      )}
      <div className="flex justify-between items-center pb-3 border-b border-gray-50">
        <div>
          <h3 className="text-sm font-black text-zinc-900 flex items-center gap-1.5 font-sans">
            <Coins className="w-5 h-5 text-orange-500" />
            월 현금 지출 내역부 (일일보고 연동)
          </h3>
          <p className="text-[10px] text-gray-400 font-bold mt-0.5">
             매일 마감 일지 작성 시 각 가맹 지점에서 현금 금고에서 차감하고 신고한 실시간 개별 지출 전표의 자동 집계 장부입니다.
          </p>
        </div>

        <div className="bg-orange-50/50 p-2.5 px-4 rounded-xl border border-orange-100 text-right">
          <span className="text-[9px] text-orange-600 font-black block leading-none">월 현금지출 총계</span>
          <span className="text-sm font-black text-zinc-850 font-mono mt-1 block">{formatNumber(totalSum)} 원</span>
        </div>
      </div>

      <div className="monthly-expense-filter-bar flex flex-wrap items-center gap-3">
        <select
          value={usageFilter}
          onChange={(e) => setUsageFilter(e.target.value)}
          className="monthly-expense-filter-select"
        >
          {usageOptions.map((option) => (
            <option key={option} value={option}>
              사용처: {option}
            </option>
          ))}
        </select>
        <select
          value={classificationFilter}
          onChange={(e) => setClassificationFilter(e.target.value)}
          className="monthly-expense-filter-select"
        >
          {classificationOptions.map((option) => (
            <option key={option} value={option}>
              분류항목: {option}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-100">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-zinc-50 border-b border-gray-100 text-zinc-500 font-black text-[10px] uppercase">
              <th className="py-3 px-4">마감 일자</th>
              <th className="py-3 px-4">결제 수단</th>
              <th className="py-3 px-4 text-right">지출 금액</th>
              <th className="py-3 px-4">거래처 (사용처)</th>
              <th className="py-3 px-4">분류 항목</th>
              <th className="py-3 px-4">지출내용 (세부)</th>
              <th className="py-3 px-4">비고</th>
              <th className="py-3 px-4">작성자</th>
              <th className="py-3 px-4">입력 시각</th>
              {isAdmin && <th className="py-3 px-4 text-center">관리</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-150 text-[11px] font-sans">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 10 : 9} className="py-20 text-center text-gray-400 font-bold">
                  선택한 월에 일일마감 시 접수된 현금지출 전표가 한 건도 존재하지 않습니다.
                </td>
              </tr>
            ) : (
              filteredItems.map((it, idx) => (
                <tr key={idx} className="hover:bg-zinc-50/40">
                  <td className="py-3.5 px-4 font-mono font-bold text-gray-500">{it.date}</td>
                  <td className="py-3.5 px-4">
                    <span className="bg-orange-50 border border-orange-100 text-orange-600 text-[10px] font-bold px-2 py-0.5 rounded-md">
                      {it.paymentType}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono font-black text-gray-800 text-xs">
                    {formatNumber(it.amount)} 원
                  </td>
                  <td className="py-3.5 px-4 font-bold text-zinc-800">
                    <span className={`monthly-expense-chip ${getMonthlyExpenseUsageChipClass(it.usage)}`}>{it.usage}</span>
                  </td>
                  <td className="py-3.5 px-4 font-bold text-blue-650">
                    <span className={`monthly-expense-chip ${getMonthlyExpenseCategoryChipClass(it.classification)}`}>{it.classification}</span>
                  </td>
                  <td className="py-3.5 px-4 text-gray-550 font-semibold">{it.detail || "공란"}</td>
                  <td className="py-3.5 px-4 text-gray-400 font-bold">확인완료</td>
                  <td className="py-3.5 px-4 text-zinc-600 font-bold">{it.author}</td>
                  <td className="py-3.5 px-4 font-mono text-gray-400">{it.timestamp}</td>
                  {isAdmin && (
                    <td className="py-3.5 px-4">
                      <div className="flex justify-center gap-1">
                        <button onClick={() => void handleEditExpense(it)} className="px-2 py-1 rounded-lg border border-blue-100 bg-blue-50 text-blue-700 text-[10px] font-black">수정</button>
                        <button onClick={() => void handleDeleteExpense(it)} className="px-2 py-1 rounded-lg border border-rose-100 bg-rose-50 text-rose-700 text-[10px] font-black">삭제</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// 2-4. SUB TAB: 현금관리 집계 (금고 실사 대조)
// ----------------------------------------------------------------------------
function MonthlyCashManagementSubTab({
  branchName,
  selectedMonth,
  history,
  isAdmin = false,
  refreshHistory
}: {
  branchName: string;
  selectedMonth: string;
  history: any[];
  isAdmin?: boolean;
  refreshHistory?: () => Promise<void>;
}) {
  const [logs, setLogs] = useState<any[]>([]);
  const [editCashManagement, setEditCashManagement] = useState<{ row: any; fields: Record<string, string> } | null>(null);

  useEffect(() => {
    const cashMgmt: any[] = [];

    history.forEach((m) => {
      if (m.settleDate && m.settleDate.startsWith(selectedMonth)) {
        const parts = (m.memo || "").split("\n---\nMETADATA:");

        let metaParsed: any = {};
        if (parts[1]) {
          try {
            metaParsed = JSON.parse(parts[1].trim());
          } catch {}
        }

        const prevVal = Number(metaParsed.prevDayCash) || 0;
        const salesVal = Number(m.cashSales) || 0;

        const expensesVal = metaParsed.cashExpenses
          ? metaParsed.cashExpenses.reduce((sum: number, x: any) => sum + (Number(x.amount) || 0), 0)
          : 0;

        const theoryVal = prevVal + salesVal - expensesVal;
        const vaultVal = Number(metaParsed.cashBalance) || 0;
        const difference = vaultVal - theoryVal;

        cashMgmt.push({
          recordId: m.recordId,
          date: m.settleDate,
          prevDayCash: prevVal,
          cashSales: salesVal,
          cashExpensesSum: expensesVal,
          theoreticalBalance: theoryVal,
          actualCashBalance: vaultVal,
          diff: difference,
          reason: metaParsed.cashDiffReason || "",
          writer: m.submittedBy || "매니저"
        });
      }
    });

    // Sort by Date ascending
    cashMgmt.sort((a,b) => a.date.localeCompare(b.date));
    setLogs(cashMgmt);
  }, [selectedMonth, history]);

  const handleEditCashManagement = (row: any) => {
    if (!row.recordId) return;
    setEditCashManagement({ row, fields: { prevDayCash: toNumberPromptValue(row.prevDayCash), cashSales: toNumberPromptValue(row.cashSales), actualCashBalance: toNumberPromptValue(row.actualCashBalance), reason: row.reason || "" } });
  };

  const saveEditCashManagement = async () => {
    if (!editCashManagement) return;
    const { row, fields } = editCashManagement;
    await updateDailyMetadata(row.recordId, (metadata) => ({
      metadata: {
        ...metadata,
        prevDayCash: String(Number(fields.prevDayCash) || 0),
        cashBalance: String(Number(fields.actualCashBalance) || 0),
        cashDiffReason: fields.reason.trim()
      },
      masterPatch: { cashSales: Number(fields.cashSales) || 0 }
    }));
    setEditCashManagement(null);
    await refreshHistory?.();
  };

  const handleClearCashManagement = async (row: any) => {
    if (!row.recordId || !window.confirm(`${row.date} 현금관리 값을 비울까요?`)) return;
    await updateDailyMetadata(row.recordId, (metadata) => ({
      metadata: { ...metadata, prevDayCash: "", cashBalance: "", cashDiffReason: "" },
      masterPatch: { cashSales: 0 }
    }));
    await refreshHistory?.();
  };

  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5 animate-fade-in" id="cash-management-subtab">
      {editCashManagement && (
        <AdminRecordEditModal
          title={`${editCashManagement.row.date} 현금관리 수정`}
          fields={[
            { key: "prevDayCash", label: "전일 금고현금", value: editCashManagement.fields.prevDayCash, type: "number" },
            { key: "cashSales", label: "금일 현금매출", value: editCashManagement.fields.cashSales, type: "number" },
            { key: "actualCashBalance", label: "금고 실사 현금", value: editCashManagement.fields.actualCashBalance, type: "number" },
            { key: "reason", label: "차액 사유", value: editCashManagement.fields.reason }
          ]}
          onChange={(key, value) => setEditCashManagement((current) => current ? { ...current, fields: { ...current.fields, [key]: value } } : current)}
          onCancel={() => setEditCashManagement(null)}
          onSave={() => void saveEditCashManagement()}
        />
      )}
      <div>
        <h3 className="text-sm font-black text-zinc-900 flex items-center gap-1.5">
          <CircleDollarSign className="w-5 h-5 text-emerald-600" />
          가맹점 일일 시사 금고 실재고 관리 대장
        </h3>
        <p className="text-[10px] text-gray-400 font-bold mt-0.5">
          일일마감 정보와 완벽 싱크로나이즈되어 매일 전일 시재이월액 + 매출현금유입 - 소액현금지출 = 이론상 현금보유고와 금고 실상액 간 차액 분석 흐름을 보고합니다.
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-100 shadow-xs">
        <table className="w-full text-left text-xs border-collapse font-medium">
          <thead>
            <tr className="bg-zinc-50 border-b border-gray-100 text-zinc-500 font-black text-[9px] tracking-wider uppercase">
              <th className="py-3.5 px-4">마감 일자</th>
              <th className="py-3.5 px-3 text-right">전일 금고현금</th>
              <th className="py-3.5 px-3 text-right text-indigo-600">+ 금일 현금매출</th>
              <th className="py-3.5 px-3 text-right text-orange-600">- 현금지출 합계</th>
              <th className="py-3.5 px-4 text-right bg-zinc-100/40">이론상 잔액 (원)</th>
              <th className="py-3.5 px-4 text-right bg-emerald-50/30">금고 실사 현금 (원)</th>
              <th className="py-3.5 px-4 text-right">차액 (불일치)</th>
              <th className="py-3.5 px-4">대조 불일치 사유 소명</th>
              <th className="py-3.5 px-4 text-center">점검 작성자</th>
              {isAdmin && <th className="py-3.5 px-4 text-center">관리</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-[11px] font-sans">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 10 : 9} className="py-20 text-center text-gray-400 font-bold">
                  선택한 월에 대조할 수 있는 일일 금고 보고데이터가 없습니다.
                </td>
              </tr>
            ) : (
              logs.map((row, idx) => {
                const hasDiff = row.diff !== 0;
                return (
                  <tr key={idx} className={`hover:bg-zinc-50/30 ${hasDiff ? "bg-rose-50/20" : ""}`}>
                    <td className="py-3.5 px-4 font-mono font-bold text-gray-500">{row.date}</td>
                    <td className="py-3.5 px-3 text-right font-mono text-gray-600">{formatNumber(row.prevDayCash)}</td>
                    <td className="py-3.5 px-3 text-right font-mono font-bold text-indigo-600">{formatNumber(row.cashSales)}</td>
                    <td className="py-3.5 px-3 text-right font-mono font-bold text-orange-600">{formatNumber(row.cashExpensesSum)}</td>
                    <td className="py-3.5 px-4 text-right font-mono font-black text-gray-800 bg-zinc-100/30">{formatNumber(row.theoreticalBalance)}</td>
                    <td className="py-3.5 px-4 text-right font-mono font-black text-emerald-800 bg-emerald-50/10">{formatNumber(row.actualCashBalance)}</td>
                    <td className="py-3.5 px-4 text-right">
                      {hasDiff ? (
                        <span className="text-rose-650 font-black font-mono">
                          {row.diff > 0 ? "+" : ""}
                          {formatNumber(row.diff)} 원
                        </span>
                      ) : (
                        <span className="text-emerald-600 font-extrabold font-mono">0 (정확)</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      {hasDiff ? (
                        <span className="text-rose-600 font-bold text-[10px] break-all">{row.reason || "사유 미입력 누락!"}</span>
                      ) : (
                        <span className="text-gray-400 font-medium text-[10px]">시재 무결성 일치</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-center font-bold text-gray-650">{row.writer}</td>
                    {isAdmin && (
                      <td className="py-3.5 px-4">
                        <div className="flex justify-center gap-1">
                          <button onClick={() => void handleEditCashManagement(row)} className="px-2 py-1 rounded-lg border border-blue-100 bg-blue-50 text-blue-700 text-[10px] font-black">수정</button>
                          <button onClick={() => void handleClearCashManagement(row)} className="px-2 py-1 rounded-lg border border-rose-100 bg-rose-50 text-rose-700 text-[10px] font-black">삭제</button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// 2-5. SUB TAB: 카드지출 일람
// ----------------------------------------------------------------------------
function MonthlyCardExpensesSubTab({
  branchName,
  selectedMonth,
  history,
  isAdmin = false,
  refreshHistory
}: {
  branchName: string;
  selectedMonth: string;
  history: any[];
  isAdmin?: boolean;
  refreshHistory?: () => Promise<void>;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [editCardExpense, setEditCardExpense] = useState<{ item: any; fields: Record<string, string> } | null>(null);
  const [usageFilter, setUsageFilter] = useState("전체");
  const [classificationFilter, setClassificationFilter] = useState("전체");

  useEffect(() => {
    const cardList: any[] = [];

    history.forEach((m) => {
      if (m.settleDate && m.settleDate.startsWith(selectedMonth)) {
        const parts = (m.memo || "").split("\n---\nMETADATA:");
        if (parts[1]) {
          try {
            const meta = JSON.parse(parts[1].trim());
            if (meta && meta.cardExpenses) {
              meta.cardExpenses.forEach((exp: any, index: number) => {
                const itemAmount = Number(exp.amount) || 0;
                if (itemAmount > 0) {
                  cardList.push({
                    recordId: m.recordId,
                    metaIndex: index,
                    date: m.settleDate,
                    paymentType: "카드",
                    amount: itemAmount,
                    usage: exp.usage || "공란",
                    classification: exp.classification || "미분류",
                    detail: exp.detail || "",
                    author: m.submittedBy || m.submitted_by || (m as any).writer || "매니저"
                  });
                }
              });
            }
          } catch {}
        }
      }
    });

    // Sort by Date ascending
    cardList.sort((a,b) => a.date.localeCompare(b.date));
    setItems(cardList);
  }, [selectedMonth, history]);

  const usageOptions = useMemo(
    () => ["전체", ...Array.from(new Set(items.map((item) => String(item.usage || "").trim()).filter(Boolean)))],
    [items]
  );
  const classificationOptions = useMemo(
    () => ["전체", ...Array.from(new Set(items.map((item) => String(item.classification || "").trim()).filter(Boolean)))],
    [items]
  );
  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        const matchesUsage = usageFilter === "전체" || item.usage === usageFilter;
        const matchesClassification = classificationFilter === "전체" || item.classification === classificationFilter;
        return matchesUsage && matchesClassification;
      }),
    [items, usageFilter, classificationFilter]
  );
  const totalSum = filteredItems.reduce((acc, i) => acc + i.amount, 0);

  const handleEditCardExpense = (item: any) => {
    if (!item.recordId) return;
    setEditCardExpense({ item, fields: { amount: toNumberPromptValue(item.amount), usage: item.usage || "", classification: item.classification || "", detail: item.detail || "" } });
  };

  const saveEditCardExpense = async () => {
    if (!editCardExpense) return;
    const { item, fields } = editCardExpense;
    const amount = Number(fields.amount);
    if (!Number.isFinite(amount)) {
      alert("금액은 숫자로 입력해주세요.");
      return;
    }
    await updateDailyMetadata(item.recordId, (metadata) => {
      const cardExpenses = Array.isArray(metadata.cardExpenses) ? [...metadata.cardExpenses] : [];
      cardExpenses[item.metaIndex] = { ...(cardExpenses[item.metaIndex] || {}), amount: String(amount), usage: fields.usage.trim(), classification: fields.classification.trim(), detail: fields.detail.trim() };
      return { metadata: { ...metadata, cardExpenses } };
    });
    setEditCardExpense(null);
    await refreshHistory?.();
  };

  const handleDeleteCardExpense = async (item: any) => {
    if (!item.recordId || !window.confirm(`${item.date} 카드지출 ${formatNumber(item.amount)}원을 삭제할까요?`)) return;
    await updateDailyMetadata(item.recordId, (metadata) => {
      const cardExpenses = Array.isArray(metadata.cardExpenses) ? [...metadata.cardExpenses] : [];
      cardExpenses.splice(item.metaIndex, 1);
      return { metadata: { ...metadata, cardExpenses } };
    });
    await refreshHistory?.();
  };

  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5 animate-fade-in" id="card-expenses-subtab">
      {editCardExpense && (
        <AdminRecordEditModal
          title="카드지출 수정"
          fields={[
            { key: "amount", label: "지출 금액", value: editCardExpense.fields.amount, type: "number" },
            { key: "usage", label: "사용처", value: editCardExpense.fields.usage },
            { key: "classification", label: "분류 항목", value: editCardExpense.fields.classification },
            { key: "detail", label: "지출내용", value: editCardExpense.fields.detail }
          ]}
          onChange={(key, value) => setEditCardExpense((current) => current ? { ...current, fields: { ...current.fields, [key]: value } } : current)}
          onCancel={() => setEditCardExpense(null)}
          onSave={() => void saveEditCardExpense()}
        />
      )}
      <div className="flex justify-between items-center pb-3 border-b border-gray-50 font-sans">
        <div>
          <h3 className="text-sm font-black text-zinc-900 flex items-center gap-1.5">
            <ShoppingCart className="w-5 h-5 text-blue-500" />
            월 카드 (법인카드/외식카드 등) 지출 일람표
          </h3>
          <p className="text-[10px] text-gray-400 font-bold mt-0.5">
             일일 지점 마감 영수증 보고 시 기입하여 제출된 카드 사용 영수 금액 전표 일치 내역서입니다.
          </p>
        </div>

        <div className="bg-blue-50/50 p-2.5 px-4 rounded-xl border border-blue-100 text-right">
          <span className="text-[9px] text-[#2E6DB4] font-black block leading-none">월 카드지출 총계</span>
          <span className="text-sm font-black text-zinc-850 font-mono mt-1 block">{formatNumber(totalSum)} 원</span>
        </div>
      </div>

      <div className="monthly-expense-filter-bar flex flex-wrap items-center gap-3">
        <select
          value={usageFilter}
          onChange={(e) => setUsageFilter(e.target.value)}
          className="monthly-expense-filter-select"
        >
          {usageOptions.map((option) => (
            <option key={option} value={option}>
              사용처: {option}
            </option>
          ))}
        </select>
        <select
          value={classificationFilter}
          onChange={(e) => setClassificationFilter(e.target.value)}
          className="monthly-expense-filter-select"
        >
          {classificationOptions.map((option) => (
            <option key={option} value={option}>
              분류항목: {option}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-100">
        <table className="w-full text-left text-xs border-collapse font-sans">
          <thead>
            <tr className="bg-zinc-50 border-b border-gray-100 text-zinc-500 font-black text-[10px] uppercase">
              <th className="py-3 px-4">마감 일자</th>
              <th className="py-3 px-4">결제 수단</th>
              <th className="py-3 px-4 text-right">지출 금액</th>
              <th className="py-3 px-4">사용처 (가맹점)</th>
              <th className="py-3 px-4">항목 (분류)</th>
              <th className="py-3 px-4">지출내용 (세부)</th>
              <th className="py-3 px-4">비고</th>
              <th className="py-3 px-4">작성자</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-150 text-[11px]">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 9 : 8} className="py-20 text-center text-gray-400 font-bold">
                  이번 달에 일일보고에 기록된 카드 지출 영수증이 존재하지 않습니다.
                </td>
              </tr>
            ) : (
              filteredItems.map((it, idx) => (
                <tr key={idx} className="hover:bg-zinc-50/40">
                  <td className="py-3.5 px-4 font-mono font-bold text-gray-500">{it.date}</td>
                  <td className="py-3.5 px-4">
                    <span className="bg-blue-50 border border-blue-100 text-blue-600 text-[10px] font-bold px-2 py-0.5 rounded-md">
                      {it.paymentType}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono font-black text-gray-800 text-xs">
                    {formatNumber(it.amount)} 원
                  </td>
                  <td className="py-3.5 px-4 font-bold text-zinc-800">
                    <span className={`monthly-expense-chip ${getMonthlyExpenseUsageChipClass(it.usage)}`}>{it.usage}</span>
                  </td>
                  <td className="py-3.5 px-4 font-bold text-indigo-600">
                    <span className={`monthly-expense-chip ${getMonthlyExpenseCategoryChipClass(it.classification)}`}>{it.classification}</span>
                  </td>
                  <td className="py-3.5 px-4 text-gray-550 font-semibold">{it.detail || "공란"}</td>
                  <td className="py-3.5 px-4 text-gray-450 font-bold">확인증빙필</td>
                  <td className="py-3.5 px-4 text-zinc-650 font-bold">{it.author}</td>
                  {isAdmin && (
                    <td className="py-3.5 px-4">
                      <div className="flex justify-center gap-1">
                        <button onClick={() => void handleEditCardExpense(it)} className="px-2 py-1 rounded-lg border border-blue-100 bg-blue-50 text-blue-700 text-[10px] font-black">수정</button>
                        <button onClick={() => void handleDeleteCardExpense(it)} className="px-2 py-1 rounded-lg border border-rose-100 bg-rose-50 text-rose-700 text-[10px] font-black">삭제</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
