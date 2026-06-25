// src/pages/BranchConfirmPage.tsx
import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../contexts/AuthContext";
import { gasClient, DailySettleDetail, AdminBranchSetting } from "../api/gasClient";
import * as XLSX from "xlsx";
import { 
  Calendar, Store, CheckCircle, ArrowRight, ArrowLeft, RefreshCw, LogOut,
  CircleDollarSign, Plus, Trash2, Clock, User, UserPlus, FileText, 
  ShoppingCart, Landmark, Info, CheckCircle2, AlertTriangle, ShieldAlert, Lock,
  Users, ClipboardList, Coins, Briefcase, Pencil, Check, TrendingUp, Settings, X,
  Cloud, Database, UploadCloud, AlertCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import LoadingSpinner from "../components/LoadingSpinner";
import { formatNumber } from "../utils/formatNumber";
import { hashPin } from "../utils/hashPin";
import { changeFirebaseLoginPins, loginWithAdminPin } from "../api/firebaseAuth";

const formatWithCommas = (val: string | number | undefined | null) => {
  if (val === undefined || val === null || val === "") return "";
  const str = String(val).replace(/[^0-9]/g, "");
  if (!str) return "";
  return Number(str).toLocaleString("ko-KR");
};

const cleanNumeric = (val: string) => {
  return val.replace(/[^0-9]/g, "");
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

const residentBirthKey = (value?: string) => String(value || "").replace(/\D/g, "").slice(0, 6);

const getSameNameWarning = (name: string, residentNumber: string | undefined, employees: Array<{ name: string; residentNumber?: string }>) => {
  const cleanName = name.trim();
  if (!cleanName) return "";
  const incomingBirth = residentBirthKey(residentNumber);
  const sameName = employees.filter((employee) => employee.name?.trim() === cleanName);
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

// ----------------------------------------------------
// Constants & Types
// ----------------------------------------------------
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2).toString().padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
});

interface StaffRow {
  division: "정직원" | "파트타이머";
  name: string;
  residentNumber?: string;
  rank?: string;
  entryDate?: string;
  standardHours: number; // 0, 9, 10, 10.5
  clockIn: string; // e.g. "09:00"
  clockOut: string; // e.g. "18:00"
  workHours: number; // calculated
  overtime: number; // calculated
  overtimeReason: string;
}

interface ExpenseRow {
  classification: "식재료" | "소모품등 기타" | "부식비" | "음료" | "현금입금";
  usage: "쿠팡" | "네이버" | "인근매장" | "그외기타" | "현금입금";
  detail: string;
  amount: string;
}

interface OrderItem {
  id: string;
  category: "식자재" | "소모품" | "기타";
  itemName: string;
  quantity: string;
  supplier: "쿠팡" | "네이버" | "인근매장" | "그외기타";
  price: string;
  orderDate: string;
  status: "신청완료" | "배송중" | "검수완료";
  notes: string;
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
}

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
  const [activeTab, setActiveTab] = useState<"dashboard" | "settle" | "orders" | "roster" | "overtimeLog" | "annualLeave" | "partTimeLog">("dashboard");

  // ----------------------------------------------------
  // Branch Selector State
  // ----------------------------------------------------
  const [branches, setBranches] = useState<any[]>([]);
  const [loadingBranches, setLoadingBranches] = useState<boolean>(false);

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
            if (parsed.length > 0) {
              setBranches(parsed);
              return;
            }
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
          sessionStorage.setItem(BRANCH_LIST_CACHE_KEY, JSON.stringify(filtered));
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
  const handleSelectBranch = (branch: any) => {
    if (!branch || !branch.branchName) {
      return;
    }
    selectBranch(branch);
    setActiveTab("dashboard");
  };

  if (!user) return null;

  // Render branch selector if none selected
  if (!selectedBranch || !selectedBranch.branchName) {
    return (
      <div className="min-h-screen bg-white flex flex-col justify-between py-12 px-6">
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

          {loadingBranches ? (
            <div className="py-20 flex flex-col items-center justify-center space-y-4 bg-white rounded-3xl border border-gray-100 shadow-md">
              <LoadingSpinner size="lg" />
              <p className="text-xs text-gray-400 font-semibold font-mono">스프레드시트 원격 지점 목록 호출 중...</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5" id="branch-card-grid">
              {branches.filter((b) => b && b.branchName).map((b) => (
                <motion.div
                  key={b.branchName}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSelectBranch(b)}
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
  activeTab: "dashboard" | "settle" | "orders" | "roster" | "overtimeLog" | "annualLeave" | "partTimeLog";
  setActiveTab: (tab: "dashboard" | "settle" | "orders" | "roster" | "overtimeLog" | "annualLeave" | "partTimeLog") => void;
  isAdmin: boolean;
}

function ActiveWorkspace({ branch, logout, selectBranch, activeTab, setActiveTab, isAdmin }: WorkspaceProps) {
  const navigate = useNavigate();
  const activeBranchName = branch?.branchName || "";
  const activeBranchBrand = branch?.brand || "";

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const triggerToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const [mainCategory, setMainCategory] = useState<"dashboard" | "daily" | "monthly" | "annualLeave">("dashboard");
  const [monthlyTab, setMonthlyTab] = useState<"purchaseSales" | "partTimeSalary" | "cashExpenses" | "cashManagement" | "cardExpenses">("purchaseSales");

  const mainTabs = [
    { id: "dashboard", label: "대시보드", icon: ClipboardList },
    { id: "daily", label: "일일마감정산", icon: Calendar },
    { id: "monthly", label: "월말마감정산", icon: Coins },
    { id: "annualLeave", label: "연차관리", icon: Calendar }
  ];

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
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col md:flex-row">
      {/* Sidebar Layout */}
      <aside 
        className={`w-full md:w-64 shrink-0 md:sticky md:top-0 md:h-screen flex flex-col border-b md:border-b-0 transition-all duration-300 z-40 text-zinc-150 border-zinc-850`}
        style={{
          backgroundColor: mainCategory === "monthly" ? adminSettings.sidebarBgMonthly : adminSettings.sidebarBgDaily
        }}
      >
        {/* Brand/Branch Info Top */}
        <div 
          className={`p-5 border-b flex md:flex-col items-center md:items-start justify-between md:justify-start gap-4 transition-colors duration-300`}
          style={{
            backgroundColor: mainCategory === "monthly" ? adminSettings.sidebarBgMonthly : adminSettings.sidebarBgDaily,
            borderBottomColor: "#ffffff11"
          }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden bg-white/10 shrink-0 shadow-inner col-span-3">
              {adminSettings.logoUrl ? (
                <img src={adminSettings.logoUrl} alt="Logo" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
              ) : (
                <Store className={`w-5 h-5 ${mainCategory === "monthly" ? "text-indigo-200" : "text-gray-300"}`} />
              )}
            </div>
            <div>
              <span className={`text-[9px] font-extrabold uppercase tracking-widest font-mono block transition-colors ${
                mainCategory === "monthly" ? "text-indigo-400" : "text-[#2E6DB4]"
              }`}>
                {activeBranchBrand}
              </span>
              <h1 className="text-base font-black tracking-tight text-white flex items-center gap-1.5 mt-0.5">
                {activeBranchName} 
                <span className={`text-[9px] font-black font-mono tracking-tight transition-colors ${
                  mainCategory === "monthly" ? "text-indigo-400" : "text-[#2E6DB4]"
                }`}>
                  {mainCategory === "monthly" ? "● 월말결산" : "● LIVE"}
                </span>
              </h1>
            </div>
          </div>

          <div className="hidden md:block mt-2.5 px-3 py-1.5 border rounded-lg text-[10px] font-bold w-full text-center transition-all bg-white/5 border-white/10 text-white/70">
            {mainCategory === "monthly" ? adminSettings.monthlyReportText : adminSettings.dailyPortalText}
          </div>
        </div>

        {/* Categories Navigation */}
        <nav className="p-3 md:p-4 flex md:flex-col gap-1.5 grow overflow-x-auto no-scrollbar md:overflow-y-auto">
          {mainTabs.map((mt) => {
            const IconComp = mt.icon;
            const active = mainCategory === mt.id;
            return (
              <button
                key={mt.id}
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
                className={`flex items-center gap-2.5 py-2.5 px-4 font-black text-xs rounded-xl transition-all cursor-pointer whitespace-nowrap w-full text-left justify-center md:justify-start ${
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
        {/* Sub Navigation Bar according to selected Main Category */}
        {mainCategory === "daily" && (
          <div className="bg-white border-b border-gray-100 sticky top-0 md:top-0 z-30 shadow-xs">
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
              <div className="flex space-x-6 overflow-x-auto no-scrollbar scroll-smooth">
                {[
                  { id: "settle", label: "일일마감정산", icon: CircleDollarSign },
                  { id: "orders", label: "발주관리", icon: ShoppingCart },
                  { id: "roster", label: "직원현황", icon: User },
                  { id: "overtimeLog", label: "초과근무일지", icon: Clock },
                  { id: "partTimeLog", label: "파트타이머일지", icon: ClipboardList }
                ].map((t) => {
                  const IconComp = t.icon;
                  const active = activeTab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setActiveTab(t.id as any)}
                      className={`flex items-center gap-1.5 py-4 px-1 border-b-2 font-black text-xs sm:text-sm transition-all relative cursor-pointer whitespace-nowrap ${
                        active
                          ? "border-[#2E6DB4] text-[#2E6DB4]"
                          : "border-transparent text-gray-400 hover:text-gray-650"
                      }`}
                      id={`tab-btn-${t.id}`}
                    >
                      <IconComp className={`w-4 h-4 ${active ? "text-[#2E6DB4]" : "text-gray-400"}`} />
                      {t.label}
                      {active && (
                        <motion.div
                          layoutId="tabUnderlineDaily"
                          className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2E6DB4]"
                          transition={{ type: "spring", stiffness: 350, damping: 30 }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {mainCategory === "monthly" && (
          <div className="bg-white border-b border-gray-100 sticky top-0 md:top-0 z-30 shadow-xs">
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
              <div className="flex space-x-6 overflow-x-auto no-scrollbar scroll-smooth">
                {[
                  { id: "purchaseSales", label: "매입매출 대장", icon: FileText },
                  { id: "partTimeSalary", label: "파트타이머 급여대장", icon: Users },
                  { id: "cashExpenses", label: "현금지출 일람", icon: Coins },
                  { id: "cashManagement", label: "현금관리 집계", icon: CircleDollarSign },
                  { id: "cardExpenses", label: "카드지출 일람", icon: ShoppingCart }
                ].map((t) => {
                  const IconComp = t.icon;
                  const active = monthlyTab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setMonthlyTab(t.id as any)}
                      className={`flex items-center gap-1.5 py-4 px-1 border-b-2 font-black text-xs sm:text-sm transition-all relative cursor-pointer whitespace-nowrap ${
                        active
                          ? "border-[#2E6DB4] text-[#2E6DB4]"
                          : "border-transparent text-gray-400 hover:text-gray-650"
                      }`}
                    >
                      <IconComp className={`w-4 h-4 ${active ? "text-[#2E6DB4]" : "text-gray-400"}`} />
                      {t.label}
                      {active && (
                        <motion.div
                          layoutId="tabUnderlineMonthly"
                          className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2E6DB4]"
                          transition={{ type: "spring", stiffness: 350, damping: 30 }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

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
                {activeTab === "orders" && <OrderManagementTab branchName={activeBranchName} />}
                {activeTab === "roster" && <RosterTab branchName={activeBranchName} />}
                {activeTab === "overtimeLog" && <OvertimeLogTab branchName={activeBranchName} isAdmin={isAdmin} />}
                {activeTab === "annualLeave" && <AnnualLeaveTab branchName={activeBranchName} />}
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

          {mainCategory === "annualLeave" && <AnnualLeaveTab branchName={activeBranchName} />}
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
                              { key: "purchaseSales", label: "매입매출 대장" },
                              { key: "partTimeSalary", label: "파트타이머 급여대장" },
                              { key: "cashExpenses", label: "현금지출 일람" },
                              { key: "cashManagement", label: "현금관리 집계" },
                              { key: "cardExpenses", label: "카드지출 일람" },
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
                                  const res = await gasClient.addBranch(trimName, phash, trimBrand, newBranchRole);
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
  const [issues, setIssues] = useState<Array<{ type: string; message: string; level: "warn" | "danger" | "info" }>>([]);

  const getTodayDateStr = () => {
    const local = new Date();
    return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [savedNotices, roster, today] = await Promise.all([
        gasClient.getSharedData<any[]>("admin_notices").catch(() => []),
        gasClient.getBranchOwnRoster(branchName).catch(() => []),
        gasClient.getDailyFormBootstrap(branchName, getTodayDateStr()).catch(() => null)
      ]);
      setNotices(Array.isArray(savedNotices) ? savedNotices : []);

      const nextIssues: Array<{ type: string; message: string; level: "warn" | "danger" | "info" }> = [];
      if (!today?.exists) {
        nextIssues.push({ type: "일일마감", message: "오늘 일일마감정산이 아직 제출되지 않았습니다.", level: "info" });
      }

      const missingResident = (roster || []).filter((employee: any) => !residentBirthKey(employee.residentNumber)).map((employee: any) => employee.name).filter(Boolean);
      const missingEntryDate = (roster || []).filter((employee: any) => !employee.entryDate).map((employee: any) => employee.name).filter(Boolean);
      const missingRank = (roster || []).filter((employee: any) => employee.division === "정직원" && !employee.rank).map((employee: any) => employee.name).filter(Boolean);
      if (missingResident.length > 0) {
        nextIssues.push({ type: "직원현황", message: `주민등록번호 입력 필요 인원: ${missingResident.join(", ")}`, level: "warn" });
      }
      if (missingEntryDate.length > 0) {
        nextIssues.push({ type: "직원현황", message: `입사일 입력 필요 인원: ${missingEntryDate.join(", ")}`, level: "warn" });
      }
      if (missingRank.length > 0) {
        nextIssues.push({ type: "직원현황", message: `직급 선택 필요 인원: ${missingRank.join(", ")}`, level: "warn" });
      }

      const byName = new Map<string, any[]>();
      (roster || []).forEach((employee: any) => {
        const name = String(employee.name || "").trim();
        if (!name) return;
        byName.set(name, [...(byName.get(name) || []), employee]);
      });
      byName.forEach((group, name) => {
        if (group.length < 2) return;
        const birthKeys = group.map((employee) => residentBirthKey(employee.residentNumber));
        const hasMissing = birthKeys.some((key) => !key);
        const distinct = new Set(birthKeys.filter(Boolean));
        nextIssues.push({
          type: "동명이인 확인",
          message: hasMissing
            ? `동명이인/동일인 확인 필요: ${name} (주민등록번호 미입력 인원 포함)`
            : `동명이인 확인 필요: ${name} (${Array.from(distinct).join(", ")})`,
          level: "danger"
        });
      });

      setIssues(nextIssues);
    } finally {
      setLoading(false);
    }
  }, [branchName]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-gray-900">{branchName} 대시보드</h2>
            <p className="text-xs text-gray-400 mt-1">공지사항과 지점에서 아직 확인해야 할 미결사항을 모아 보여줍니다.</p>
          </div>
          <button onClick={() => void load()} className="px-4 py-2 rounded-xl bg-[#2E6DB4] text-white text-xs font-black">새로고침</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-gray-800 flex items-center gap-2"><AlertCircle className="w-4 h-4 text-amber-500" /> 미결 확인사항</h3>
            <span className="text-xs font-black text-gray-400">{issues.length}건</span>
          </div>
          {loading ? (
            <div className="py-16 flex justify-center"><LoadingSpinner size="md" /></div>
          ) : issues.length === 0 ? (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-5 text-sm font-bold text-emerald-800">현재 확인 필요한 미결사항이 없습니다.</div>
          ) : (
            <div className="space-y-2">
              {issues.map((issue, index) => (
                <div key={index} className={`rounded-2xl border p-4 text-sm ${issue.level === "danger" ? "bg-rose-50 border-rose-100 text-rose-800" : issue.level === "warn" ? "bg-amber-50 border-amber-100 text-amber-800" : "bg-sky-50 border-sky-100 text-sky-800"}`}>
                  <p className="text-[11px] font-black opacity-70">{issue.type}</p>
                  <p className="font-bold mt-1">{issue.message}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
          <h3 className="text-sm font-black text-gray-800 flex items-center gap-2"><Info className="w-4 h-4 text-[#2E6DB4]" /> 관리자 공지사항</h3>
          {notices.length === 0 ? (
            <p className="text-xs text-gray-400 py-8 text-center">등록된 공지사항이 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {notices.slice(0, 5).map((notice, index) => (
                <div key={notice.id || index} className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                  <p className="text-sm font-black text-gray-800">{notice.title || "공지사항"}</p>
                  <p className="text-xs text-gray-500 mt-2 whitespace-pre-wrap leading-relaxed">{notice.body || notice.content || ""}</p>
                  <p className="text-[10px] text-gray-400 mt-3 font-mono">{notice.createdAt ? new Date(notice.createdAt).toLocaleString("ko-KR") : ""}</p>
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
        return [...parsed].sort((a, b) => {
          if (a.division === "정직원" && b.division !== "정직원") return -1;
          if (a.division !== "정직원" && b.division === "정직원") return 1;
          return a.name.localeCompare(b.name, "ko");
        });
      }
    } catch (e) {
      console.error("Failed to parse employee roster", e);
    }
    // Default fallback roster if none set up
    const defaults: Employee[] = [
      { id: "e1", name: "김철수", division: "정직원" },
      { id: "e2", name: "이영희", division: "정직원" },
      { id: "e3", name: "박민수", division: "파트타이머" },
      { id: "e4", name: "최정우", division: "파트타이머" },
    ];
    const sortedDefaults = [...defaults].sort((a, b) => {
      if (a.division === "정직원" && b.division !== "정직원") return -1;
      if (a.division !== "정직원" && b.division === "정직원") return 1;
      return a.name.localeCompare(b.name, "ko");
    });
    localStorage.setItem(`erp_staff_list_${branchName}`, JSON.stringify(sortedDefaults));
    return sortedDefaults;
  }, [branchName]);

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

  const defaultStandardHours = isExtraHoursBranch ? 10.5 : 10;

  const [settleDate, setSettleDate] = useState<string>(getTodayDateStr());
  // 마감 작성자는 매일 확인 후 직접 입력합니다. 이전 기기/날짜의 이름을 자동으로 채우지 않습니다.
  const [writer, setWriter] = useState<string>("");

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
  const [newStaffInputRank, setNewStaffInputRank] = useState("사원");
  const [newStaffInputEntryDate, setNewStaffInputEntryDate] = useState("");

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

  // Toast trigger helper
  const triggerToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

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
  const initRosterInForm = useCallback(() => {
    const list = getRoster();
    const mappedRows: StaffRow[] = list.map((emp) => ({
      division: emp.division,
      name: emp.name,
      standardHours: emp.division === "정직원" ? defaultStandardHours : 0,
      clockIn: "",
      clockOut: "",
      workHours: 0,
      overtime: 0,
      overtimeReason: ""
    }));
    setStaffRows(mappedRows);
  }, [getRoster, defaultStandardHours]);

  // ----------------------------------------------------
  // Dynamic Load & Duplicate check on Date Change
  // ----------------------------------------------------
  useEffect(() => {
    const checkDuplicateAndLoad = async () => {
      try {
        setChecking(true);
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
            setStaffRows(metadataParsed.staffRows || []);
            setCashExpenses(metadataParsed.cashExpenses || []);
            setCardExpenses(metadataParsed.cardExpenses || []);
            setCashBalance(metadataParsed.cashBalance !== undefined ? String(metadataParsed.cashBalance) : "");
            setPrevDayCash(metadataParsed.prevDayCash !== undefined ? String(metadataParsed.prevDayCash) : prevCashVal);
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
                 standardHours: emp.division === "정직원" ? defaultStandardHours : 0,
                 clockIn: matchedS && matchedS.workHours > 0 ? "09:00" : "00:00",
                 clockOut: matchedS && matchedS.workHours > 0 ? (matchedS.workHours === 9 ? "18:00" : "19:00") : "00:00",
                 workHours: matchedS ? matchedS.workHours : 0,
                 overtime: matchedS && emp.division === "정직원" ? (matchedS.workHours - defaultStandardHours) : 0,
                 overtimeReason: ""
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
          initRosterInForm();
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
        initRosterInForm();
      } finally {
        setChecking(false);
      }
    };
    
    checkDuplicateAndLoad();
  }, [settleDate, branchName, getRoster, initRosterInForm]);

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

  // Core Math - Decimal Time Parsing
  const parseTimeToDecimal = (timeStr: string): number => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(":").map(Number);
    return h + (m === 30 ? 0.5 : 0);
  };

  const normalizeTimeInput = (index: number, field: "clockIn" | "clockOut", value: string) => {
    const match = value.trim().match(/^(?:([01]?\d|2[0-3]):([0-5]\d)|([01]?\d|2[0-3])([0-5]\d))$/);
    const key = `${index}-${field}`;
    if (!match) { setTimeErrors((current) => ({ ...current, [key]: "24시간제 예: 09:00 또는 1530" })); return; }
    const hour = (match[1] || match[3]).padStart(2, "0");
    setTimeErrors((current) => { const next = { ...current }; delete next[key]; return next; });
    executeStaffCalculation(index, { [field]: `${hour}:${match[2] || match[4]}` });
  };

  // Interactive Staff updates with calculation triggers
  const executeStaffCalculation = (index: number, updatedFields: Partial<StaffRow>) => {
    setStaffRows((prev) => {
      const copy = [...prev];
      const row = { ...copy[index], ...updatedFields };

      const inDec = parseTimeToDecimal(row.clockIn);
      const outDec = parseTimeToDecimal(row.clockOut);

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

  // Submit flow
  const handleSettleSubmit = async () => {
    if (submitting) return;
    const writerName = String(writer ?? "").trim();

    if (!writerName && !hasExistingRecord) {
      setValidationErrors(true);
      triggerToast("마감 작성자 이름을 꼭 입력해 주세요.", "error");
      return;
    }
    if (!cashSales || !cardSales || (!hasExistingRecord && !cashBalance)) {
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

    if (cashBalance !== "" && diff !== 0 && !cashDiffReason.trim()) {
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

    const missingOvertimeReason = staffRows.filter((staff) => staff.overtime !== 0 && !staff.overtimeReason.trim());
    if (missingOvertimeReason.length > 0) {
      setValidationErrors(true);
      triggerToast(`${missingOvertimeReason.map((staff) => staff.name).join(", ")} 님의 초과근무 또는 조기퇴근 사유를 입력해 주세요.`, "error");
      return;
    }

    const longShift = staffRows.filter((staff) => staff.workHours > 13);
    if (longShift.length > 0 && !window.confirm(`${longShift.map((staff) => `${staff.name} ${staff.workHours}시간`).join(", ")} 근무가 13시간을 초과합니다. 출퇴근 시간 입력이 맞습니까?`)) return;

    setSubmitting(true);
    setValidationErrors(false);

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
          (s) =>
            `- ${s.name} (${s.division}): 출근 ${s.clockIn}, 퇴근 ${s.clockOut} [기준 ${s.standardHours}h, 근무 ${s.workHours}h, 초과 ${s.overtime > 0 ? "+" : ""}${s.overtime}h] ${
              s.overtimeReason ? `(사유: ${s.overtimeReason})` : ""
            }`
        )
        .join("\n");

      const visibleMemo = `[직원 특이사항]\n${staffMemo.trim()}\n\n[리뷰 특이사항]\n${reviewMemo.trim()}\n\n[기타 특이사항]\n${otherMemo.trim()}`;
      const combinedMemo = `${visibleMemo}\n\n[근무 일지 요약]\n${formattedStaffSummaryStr}\n---\nMETADATA:\n${serializeMetaData}`;

      // Automatically register any newly added staff in the roster checklist to Roster master list
      try {
        const currentRoster = getRoster();
        const currentRosterNames = new Set(currentRoster.map(r => r.name));
        let rosterUpdated = false;
        const updatedRoster = [...currentRoster];

        staffRows.forEach((s) => {
          if (!currentRosterNames.has(s.name)) {
            const newEmp = {
              id: `e_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              name: s.name,
              division: s.division,
              residentNumber: formatResidentNumber(s.residentNumber || ""),
              contractType: "4대보험" as const,
              entryDate: s.entryDate || "",
              ...(s.division === "정직원" ? { rank: s.rank || "사원" } : {})
            };
            updatedRoster.push(newEmp);
            rosterUpdated = true;
          }
        });

        if (rosterUpdated) {
          localStorage.setItem(`erp_staff_list_${branchName}`, JSON.stringify(updatedRoster));
          await gasClient.saveBranchOwnRoster(branchName, updatedRoster);
        }
      } catch (e) {
        console.error("Local roster automatic registration failed:", e);
      }

      // 2. Format Expenses matching legacy GAS DB row model properties
      const formattedExpenses = [
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
    initRosterInForm();
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

      const cardText = cardExpensesSum > 0 
        ? `${formatNumber(cardExpensesSum)}(${cardExpenses.filter(e => e.amount).map(e => {
            const detailStr = e.detail ? ` ${e.detail}` : "";
            return `${e.classification}/${e.usage}${detailStr}`;
          }).join(', ')})`
        : "";
        
      const cashText = cashExpensesSum > 0 
        ? `${formatNumber(cashExpensesSum)}(${cashExpenses.filter(e => e.amount).map(e => {
            const detailStr = e.detail ? ` ${e.detail}` : "";
            return `${e.classification}/${e.usage}${detailStr}`;
          }).join(', ')})`
        : "";
        
      const workersText = staffRows.map(s => s.name).join(", ");

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
- 오늘현금지출: ${formatNumber(cashExpensesSum)}
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
- 리뷰 특이사항: ${reviewMemo.trim() || "없음"}
- 기타 특이사항: ${otherMemo.trim() || "없음"}`;
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
          <div className="flex flex-col space-y-1.5">
            <label className="text-xs font-extrabold text-[#1C3C6E] flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-[#2E6DB4]" /> 마감 대상 날짜
            </label>
            <input
              type="date"
              value={settleDate}
              onChange={(e) => setSettleDate(e.target.value)}
              onClick={(e) => e.currentTarget.showPicker?.()}
              onFocus={(e) => e.currentTarget.showPicker?.()}
              className="px-4 py-2.5 border border-gray-200 rounded-xl font-mono text-sm text-gray-700 bg-gray-50/50 focus:bg-white focus:outline-hidden focus:border-[#2E6DB4] transition-all cursor-pointer"
              id="settle-date-picker"
            />
          </div>

          <div className="flex flex-col space-y-1.5">
            <label className="text-xs font-extrabold text-[#1C3C6E] flex items-center gap-1">
              <User className="w-3.5 h-3.5 text-[#2E6DB4]" /> 마감 작성자
            </label>
            <input
              type="text"
              value={writer}
              onChange={(e) => setWriter(e.target.value)}
              placeholder="작성자 성명 기입"
              className={`px-4 py-2.5 border rounded-xl text-sm bg-gray-50/50 focus:bg-white focus:outline-hidden focus:border-[#2E6DB4] transition-all ${
                validationErrors && !writer ? "border-rose-400 ring-1 ring-rose-400" : "border-gray-200"
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
                  setHasExistingRecord(false); setExistingRecordId(null); setTimeErrors({}); setWriter("");
                  setCashSales(""); setCardSales(""); setTransferSales(""); setDeliverySales(""); setCashBalance(""); setCashDiffReason(""); setStaffMemo(""); setReviewMemo(""); setOtherMemo(""); setCashExpenses([{ classification: "식재료", usage: "쿠팡", detail: "", amount: "" }]); setCardExpenses([{ classification: "식재료", usage: "쿠팡", detail: "", amount: "" }]); initRosterInForm(); setIsEditApproved(true);
                  triggerToast("선택한 날짜의 저장된 마감기록을 삭제하고 새 입력 상태로 초기화했습니다.", "success");
                }}
                className="px-3.5 py-2 bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-200 rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1"
              >
                ↺ 정산 리셋
              </button>}
              <button
                type="button"
                onClick={() => {
                  triggerToast("마감 정산 날짜를 달력에서 다시 선택해 주십시오.", "error");
                  const picker = document.getElementById("settle-date-picker");
                  if (picker) {
                    picker.focus();
                    (picker as any).showPicker?.();
                  }
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
              const picker = document.getElementById("settle-date-picker");
              if (picker) {
                picker.focus();
                (picker as any).showPicker?.();
              }
            }}
            className="px-3.5 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-600 text-xs font-extrabold rounded-lg shadow-2xs transition-colors cursor-pointer"
          >
            달력 다시 열어 날짜 조정하기
          </button>
        </div>
      ) : (
        <>
          {/* COMPACT SALES ROW (1 Line) */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4" id="sales-section">
        <h3 className="text-sm font-black text-gray-800 flex items-center gap-2">
          <CircleDollarSign className="w-4 h-4 text-[#2E6DB4]" />
          매출
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4" id="compact-sales-grid">
          {[
            { label: "카드매출 (필수)", value: cardSales, setter: setCardSales, req: true, placeholder: "" },
            { label: "현금매출 (필수)", value: cashSales, setter: setCashSales, req: true, placeholder: "" },
            { label: "계좌이체매출", value: transferSales, setter: setTransferSales, req: false, placeholder: "" },
            { label: "배달매출", value: deliverySales, setter: setDeliverySales, req: false, placeholder: "" },
            { label: "금고 현금 잔액(필수)", value: cashBalance, setter: setCashBalance, req: true, placeholder: "" }
          ].map((field, idx) => (
            <div key={idx} className="flex flex-col space-y-1.5">
              <span className="text-xs font-semibold text-gray-500">{field.label}</span>
              <input
                type="text"
                value={formatWithCommas(field.value)}
                onChange={(e) => {
                  field.setter(cleanNumeric(e.target.value));
                }}
                placeholder={field.placeholder}
                className={`w-full px-3 py-2 border text-sm text-right font-mono font-bold rounded-xl bg-gray-50/30 focus:bg-white focus:outline-hidden focus:border-[#2E6DB4] transition-all ${
                  validationErrors && field.req && !field.value ? "border-rose-400 ring-1 ring-rose-300" : "border-gray-200"
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
      <table className="w-full border-collapse" style={{ display: "none" }} /> {/* Hidden spacer constraint */}

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
                  onChange={(e) => setCashDiffReason(e.target.value)}
                  className={`w-full p-2.5 bg-white border rounded-xl text-xs font-semibold focus:outline-hidden leading-relaxed resize-none h-16 transition-all ${
                    validationErrors && !cashDiffReason.trim()
                      ? "border-rose-400 ring-4 ring-rose-200 bg-rose-50/20"
                      : "border-gray-200 focus:border-amber-400"
                  }`}
                />
              </div>
            );
          }
          return null;
        })()}
      </div>

      {/* STAFF HOURS TABLE SECTION */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4" id="staff-attendance-section">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
          <div>
            <h3 className="text-sm font-black text-gray-800 flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#2E6DB4]" />
              근무자
            </h3>
            <p className="text-[11px] text-gray-400 mt-1 leading-normal">
              이 Roster 목록은 <strong>'직원현황'</strong> 메뉴에서 관리되며, 매 마무리기록 시 마다 자동배치됩니다. (30분 간격 입출 근무 자동연산)
            </p>
          </div>
        </div>

        {/* Inline Employee Field Addition Block */}
        <div className="flex flex-wrap items-center gap-2.5 bg-zinc-50 p-3 rounded-xl border border-gray-150 text-xs">
          <span className="font-extrabold text-zinc-800">🆕 신규 근무자 추가:</span>
          <input
            type="text"
            placeholder="근무자 이름 입력"
            value={newStaffInputName}
            onChange={(e) => setNewStaffInputName(e.target.value)}
            className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:border-zinc-800 focus:outline-hidden font-bold max-w-[155px]"
          />
          <select
            value={newStaffInputDivision}
            onChange={(e) => setNewStaffInputDivision(e.target.value as "정직원" | "파트타이머")}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white font-extrabold cursor-pointer"
          >
            <option value="정직원">정직원</option>
            <option value="파트타이머">파트타이머</option>
          </select>
          <input
            type="text"
            placeholder="주민등록번호"
            value={newStaffInputResidentNumber}
            onChange={(e) => setNewStaffInputResidentNumber(formatResidentNumber(e.target.value))}
            className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:border-zinc-800 focus:outline-hidden font-mono w-36"
          />
          {newStaffInputDivision === "정직원" && (
            <select
              value={newStaffInputRank}
              onChange={(e) => setNewStaffInputRank(e.target.value)}
              className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white font-extrabold cursor-pointer"
            >
              {["사원", "대리", "과장", "차장", "실장", "부장", "이사", "대표", "부대표"].map((rank) => (
                <option key={rank} value={rank}>{rank}</option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-2 px-2 py-1.5 border border-gray-200 rounded-lg text-xs font-extrabold text-gray-600 bg-white cursor-pointer">
            <span>입사일자</span>
          <input
            type="date"
            value={newStaffInputEntryDate}
            onChange={(e) => setNewStaffInputEntryDate(e.target.value)}
            onClick={(e) => e.currentTarget.showPicker?.()}
            aria-label="입사일자"
            className="min-w-0 bg-transparent focus:outline-hidden font-mono cursor-pointer"
          />
          </label>
          <button
            type="button"
            onClick={() => {
              const name = newStaffInputName.trim();
              if (!name) {
                triggerToast("근무자 성명을 입력해주세요.", "error");
                return;
              }
              if (staffRows.some(s => s.name === name)) {
                triggerToast("이미 정산 표에 등록된 이름입니다.", "error");
                return;
              }
              const formattedResident = formatResidentNumber(newStaffInputResidentNumber);
              const warning = getSameNameWarning(name, formattedResident, getRoster());
              if (warning) {
                alert(warning);
                return;
              }
              const newRow: StaffRow = {
                division: newStaffInputDivision,
                name,
                residentNumber: formattedResident,
                rank: newStaffInputDivision === "정직원" ? newStaffInputRank : undefined,
                entryDate: newStaffInputEntryDate,
                standardHours: newStaffInputDivision === "정직원" ? defaultStandardHours : 0,
                clockIn: "",
                clockOut: "",
                workHours: 0,
                overtime: 0,
                overtimeReason: ""
              };
              setStaffRows(prev => [...prev, newRow]);
              setNewStaffInputName("");
              setNewStaffInputResidentNumber("");
              setNewStaffInputRank("사원");
              setNewStaffInputEntryDate("");
              triggerToast(`${name} 님이 추가되었습니다 (마감 제출 시 직원현황 자동 등록)`);
            }}
            className="px-3.5 py-1.5 bg-zinc-800 hover:bg-black text-white font-black rounded-lg cursor-pointer transition-colors"
          >
            추가하기
          </button>
        </div>

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
                    등록된 지점 직원이 없습니다. 신규 근무자 추가 입력을 통해 인원을 생성해주세요.
                  </td>
                </tr>
              ) : (
                staffRows.map((s, idx) => {
                  const hasOvertimeDelta = s.division !== "파트타이머" && s.overtime !== 0;

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
                          className={`px-2 py-1.5 rounded-lg font-bold text-[11px] border ${s.division === "정직원" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-blue-50 text-blue-700 border-blue-200"}`}
                        >
                          <option value="정직원">정직원</option>
                          <option value="파트타이머">파트타이머</option>
                        </select>
                      </td>

                      {/* Standard Criterion Hours Dropdown */}
                      <td className="py-3.5 px-2">
                        {s.division === "파트타이머" ? (
                          <span className="inline-block py-1.5 px-3 bg-gray-100 text-gray-400 font-mono text-center font-bold rounded-lg min-w-[75px]">
                            0h
                          </span>
                        ) : (
                          <select
                            value={String(s.standardHours)}
                            onChange={(e) => {
                              executeStaffCalculation(idx, { standardHours: Number(e.target.value) });
                            }}
                            className="px-2 py-1.5 border border-[#2E6DB4]/30 rounded-lg bg-white font-mono font-bold text-[11px] min-w-[75px] text-[#2E6DB4]"
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
                          className={`w-16 px-1.5 py-1.5 border rounded-lg font-mono bg-white text-[11px] ${timeErrors[`${idx}-clockIn`] ? "border-rose-500 ring-1 ring-rose-300" : "border-gray-200"}`}
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
                          className={`w-16 px-1.5 py-1.5 border rounded-lg font-mono bg-white text-[11px] ${timeErrors[`${idx}-clockOut`] ? "border-rose-500 ring-1 ring-rose-300" : "border-gray-200"}`}
                        />
                        {timeErrors[`${idx}-clockOut`] && <span className="absolute z-10 left-2 top-10 whitespace-nowrap rounded bg-rose-600 px-2 py-1 text-[10px] font-bold text-white shadow">{timeErrors[`${idx}-clockOut`]}</span>}
                      </td>

                      {/* Work Hours calculated */}
                      <td className="py-3.5 px-2 font-mono font-bold text-gray-600">
                        <span className={`py-1 px-2.5 rounded-md ${s.workHours > 0 ? "bg-sky-100 text-sky-700" : "bg-gray-100 text-gray-600"}`}>
                          {s.workHours} h
                        </span>
                      </td>

                      {/* Overtime (over / deficit) */}
                      <td className="py-3.5 px-2">
                        {s.overtime > 0 ? (
                          <span className="py-1 px-2 bg-emerald-50 text-emerald-600 font-mono font-black rounded-md">
                            +{s.overtime} h
                          </span>
                        ) : s.overtime < 0 ? (
                          <span className="py-1 px-2 bg-rose-50 text-rose-500 font-mono font-black rounded-md">
                            {s.overtime} h
                          </span>
                        ) : (
                          <span className="py-1 px-2 bg-gray-100 text-gray-400 font-mono font-bold rounded-md">
                            0 h
                          </span>
                        )}
                      </td>

                      {/* Overtime Reason */}
                      <td className="py-3.5 px-2 max-w-[200px]">
                        <input
                          type="text"
                          value={s.overtimeReason}
                          onChange={(e) => executeStaffCalculation(idx, { overtimeReason: e.target.value })}
                          disabled={!hasOvertimeDelta}
                          placeholder={hasOvertimeDelta ? "상세 사유 필수 입력" : "사유 불필요"}
                          className={`w-full px-2 py-1.5 border rounded-lg text-xs transition-all ${
                            hasOvertimeDelta
                              ? validationErrors && !s.overtimeReason.trim() ? "bg-rose-50 border-rose-500 ring-1 ring-rose-300 focus:border-rose-500" : "bg-white border-amber-300 focus:border-amber-500"
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
      </div>

      {/* ADDITIONAL FREE NOTES */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4" id="memo-section">
        <label className="text-xs font-extrabold text-[#1C3C6E] flex items-center gap-1.5 border-b border-gray-100 pb-2">
          <FileText className="w-4 h-4 text-[#2E6DB4]" />
          특이사항 기록 (본부 보고 및 카톡보고 자동 연동)
        </label>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-600 block">
              👤 직원 특이사항
            </label>
            <textarea
              value={staffMemo}
              onChange={(e) => setStaffMemo(e.target.value)}
              placeholder="예: [이름] 파트타이머 30분 지각 응대 지침 교육함"
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
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-gray-600 block">
            📝 기타 전달 메모
          </label>
          <textarea
            value={otherMemo}
            onChange={(e) => setOtherMemo(e.target.value)}
            placeholder="그 외 단체 예약 소품 교체 요청 등 자유롭게 전하고 싶은 내용을 적어주세요."
            rows={2}
            className="w-full p-3 border border-gray-200 rounded-xl text-xs focus:outline-hidden focus:border-zinc-800 transition-all bg-gray-50/20"
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

// ----------------------------------------------------
// TAB 2: Order Management (발주관리)
// ----------------------------------------------------
function OrderManagementTab({ branchName }: { branchName: string }) {
  const [orders, setOrders] = useState<OrderItem[]>(() => {
    try {
      const saved = localStorage.getItem(`erp_orders_${branchName}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // New Order State
  const [category, setCategory] = useState<"식자재" | "소모품" | "기타">("식자재");
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [supplier, setSupplier] = useState<"쿠팡" | "네이버" | "인근매장" | "그외기타">("쿠팡");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");

  const [filterStatus, setFilterStatus] = useState<string>("ALL");

  const saveOrders = (updated: OrderItem[]) => {
    setOrders(updated);
    localStorage.setItem(`erp_orders_${branchName}`, JSON.stringify(updated));
  };

  const handlePlaceOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName.trim() || !quantity.trim()) return;

    const newOrder: OrderItem = {
      id: `ord-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      category,
      itemName: itemName.trim(),
      quantity: quantity.trim(),
      supplier,
      price: price.trim(),
      orderDate: new Date().toISOString().split("T")[0],
      status: "신청완료",
      notes: notes.trim()
    };

    const next = [newOrder, ...orders];
    saveOrders(next);

    // Reset Inputs
    setItemName("");
    setQuantity("");
    setPrice("");
    setNotes("");
  };

  const handleUpdateStatus = (id: string, nextStatus: "신청완료" | "배송중" | "검수완료") => {
    const updated = orders.map((o) => (o.id === id ? { ...o, status: nextStatus } : o));
    saveOrders(updated);
  };

  const handleDeleteOrder = (id: string) => {
    if (confirm("정말로 이 발주 내역을 삭제하시겠습니까? (로컬 이관)")) {
      const next = orders.filter((o) => o.id !== id);
      saveOrders(next);
    }
  };

  const filteredOrders = useMemo(() => {
    if (filterStatus === "ALL") return orders;
    return orders.filter((o) => o.status === filterStatus);
  }, [orders, filterStatus]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="orders-tab-view">
      {/* Placement Left Form */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm h-fit space-y-4">
        <h3 className="text-sm font-black text-gray-800 flex items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-[#2E6DB4]" />
          신규 품목 발주 신청
        </h3>

        <form onSubmit={handlePlaceOrder} className="space-y-3 text-xs">
          <div className="flex flex-col space-y-1">
            <span className="font-bold text-gray-500">대분류</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as any)}
              className="px-3 py-2 border border-gray-200 rounded-xl font-semibold bg-gray-50/50"
            >
              <option value="식자재">식자재류 (고기, 채소, 드레싱)</option>
              <option value="소모품">소모품 등 기타 (냅킨, 물티슈, 세제)</option>
              <option value="기타">기타 부식비 및 주류 음료</option>
            </select>
          </div>

          <div className="flex flex-col space-y-1">
            <span className="font-bold text-gray-500">품목명 (자세히)</span>
            <input
              type="text"
              required
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="예: 양파 20kg 2망 / 테라 병맥주 3짝"
              className="px-3 py-2 border border-gray-200 rounded-xl"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col space-y-1">
              <span className="font-bold text-gray-500">수량 (단위 표기 가능)</span>
              <input
                type="text"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="예: 2망 / 5box"
                className="px-3 py-2 border border-gray-200 rounded-xl"
              />
            </div>
            <div className="flex flex-col space-y-1">
              <span className="font-bold text-gray-500">소요 예상액 (원)</span>
              <input
                type="text"
                value={formatWithCommas(price)}
                onChange={(e) => setPrice(cleanNumeric(e.target.value))}
                placeholder="예: 45,000"
                className="px-3 py-2 border border-gray-200 rounded-xl text-right font-mono"
              />
            </div>
          </div>

          <div className="flex flex-col space-y-1">
            <span className="font-bold text-gray-500">거래 공급처 (지불처)</span>
            <select
              value={supplier}
              onChange={(e) => setSupplier(e.target.value as any)}
              className="px-3 py-2 border border-gray-200 rounded-xl bg-white"
            >
              {["쿠팡", "네이버", "인근매장", "그외기타"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col space-y-1">
            <span className="font-bold text-gray-500">발주 특이 요청 메모</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="납기일 요청 등 필요 사항 기입"
              className="px-3 py-2 border border-gray-200 rounded-xl"
            />
          </div>

          <button
            type="submit"
            className="w-full py-3.5 bg-[#2E6DB4] hover:bg-[#1A3C6E] text-white font-extrabold text-xs rounded-xl cursor-pointer shadow-sm transition-colors pt-4 mt-3 flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> 발주 요청 등록하기
          </button>
        </form>
      </div>

      {/* Roster Right list */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm lg:col-span-2 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-3">
          <div>
            <h3 className="text-sm font-black text-gray-800">지점 발주 내역 리포트</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">요청 상황 및 배송, 검수 상황을 실시간 제어하세요.</p>
          </div>

          {/* Status filter tabs */}
          <div className="flex bg-gray-100 p-1 rounded-xl text-[10px] font-bold">
            {["ALL", "신청완료", "배송중", "검수완료"].map((tab) => (
              <button
                key={tab}
                onClick={() => setFilterStatus(tab)}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                  filterStatus === tab ? "bg-white text-[#2E6DB4] shadow-xs" : "text-gray-400 hover:text-gray-600"
                }`}
              >
                {tab === "ALL" ? "전체" : tab}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400 font-bold">
                <th className="py-2.5 px-2">일자</th>
                <th className="py-2.5 px-2">분류</th>
                <th className="py-2.5 px-2">품목명</th>
                <th className="py-2.5 px-2">수량</th>
                <th className="py-2.5 px-2">공급처</th>
                <th className="py-2.5 px-2">추정가</th>
                <th className="py-2.5 px-2">상태 제어</th>
                <th className="py-2.5 px-2">활동</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-medium">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-400">
                    발주 내역 리스트가 깔끔하게 비어 있습니다.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-gray-50/50">
                    <td className="py-3 px-2 font-mono text-[11px] text-gray-400">{ord.orderDate}</td>
                    <td className="py-3 px-2">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold ${
                        ord.category === "식자재" ? "bg-amber-55 bg-amber-50 text-amber-700" : "bg-teal-50 text-teal-700"
                      }`}>
                        {ord.category}
                      </span>
                    </td>
                    <td className="py-3 px-2 font-bold text-gray-800 leading-normal">
                      <div>{ord.itemName}</div>
                      {ord.notes && <p className="text-[10px] text-gray-400 font-normal mt-0.5">{ord.notes}</p>}
                    </td>
                    <td className="py-3 px-2 font-semibold text-gray-600">{ord.quantity}</td>
                    <td className="py-3 px-2 text-gray-500 font-bold">{ord.supplier}</td>
                    <td className="py-3 px-2 font-mono font-bold text-gray-600">
                      {ord.price ? `${formatNumber(Number(ord.price))} 원` : "-"}
                    </td>
                    <td className="py-3 px-2">
                      <select
                        value={ord.status}
                        onChange={(e) => handleUpdateStatus(ord.id, e.target.value as any)}
                        className={`text-[10px] font-black px-1.5 py-1 rounded-lg border focus:outline-hidden ${
                          ord.status === "신청완료" 
                            ? "bg-amber-50 text-amber-700 border-amber-200" 
                            : ord.status === "배송중" 
                            ? "bg-[#D6E4F0]/50 text-[#2E6DB4] border-blue-200" 
                            : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}
                      >
                        <option value="신청완료">신청완료</option>
                        <option value="배송중">배송중</option>
                        <option value="검수완료">검수완료</option>
                      </select>
                    </td>
                    <td className="py-3 px-2">
                      <button
                        onClick={() => handleDeleteOrder(ord.id)}
                        className="text-gray-400 hover:text-rose-600 p-1 rounded-md transition-colors cursor-pointer"
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
    </div>
  );
}

// ----------------------------------------------------
// TAB 3: Roster Tab (직원현황)
// ----------------------------------------------------
function RosterTab({ branchName }: { branchName: string }) {
  const [employees, setEmployees] = useState<Employee[]>(() => {
    try {
      const saved = localStorage.getItem(`erp_staff_list_${branchName}`);
      if (saved) return JSON.parse(saved);
    } catch {}
    
    // Default fallback roster
    const defaults: Employee[] = [
      { id: "e1", name: "김철수", division: "정직원" },
      { id: "e2", name: "이영희", division: "정직원" },
      { id: "e3", name: "박민수", division: "파트타이머" },
      { id: "e4", name: "최정우", division: "파트타이머" },
    ];
    localStorage.setItem(`erp_staff_list_${branchName}`, JSON.stringify(defaults));
    return defaults;
  });

  const [newName, setNewName] = useState("");
  const [division, setDivision] = useState<"정직원" | "파트타이머" >("정직원");
  const [selectedRank, setSelectedRank] = useState<string>("사원");
  const [customRankInput, setCustomRankInput] = useState<string>("");
  const [newResidentNumber, setNewResidentNumber] = useState("");
  const [newContractType, setNewContractType] = useState<"4대보험" | "3.3%">("4대보험");
  const [newEntryDate, setNewEntryDate] = useState("");

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
  const [editRank, setEditRank] = useState("사원");
  const [editCustomRank, setEditCustomRank] = useState("");
  const [editResidentNumber, setEditResidentNumber] = useState("");
  const [editContractType, setEditContractType] = useState<"4대보험" | "3.3%">("4대보험");
  const [editEntryDate, setEditEntryDate] = useState("");

  // 지점 전용 branch_own_rosters 컬렉션을 사용합니다.
  // staff_rosters에서 이 지점 소속이 아닌 인원(다른 지점코드 또는 외부 등록 인원)을 자동으로 걸러냅니다.
  useEffect(() => {
    let cancelled = false;
    const syncRoster = async () => {
      try {
        // 지점 소속 직원 판별: employeeId가 UGD-{지점코드}- 형식이거나 설정되지 않은 경우
        // 지점코드 = 지점명에서 공백/괄호/점 제거 (예: "대물섬 한남점" → "대물섬한남")
        const branchCode = branchName.replace(/[\s()점]/g, "");
        const isBranchEmployee = (emp: any) => {
          const eid = String(emp.employeeId || "");
          return !eid || eid.startsWith(`UGD-${branchCode}-`);
        };

        // staff_rosters에서 이 지점 소속 직원만 추출
        const staffRoster = await gasClient.getStaffRoster(branchName);
        if (cancelled) return;
        const staffFiltered = staffRoster.filter(isBranchEmployee);

        // branch_own_rosters를 우선 사용 (사용자 편집 내용 보존)
        // staff_rosters는 branch_own_rosters에 없는 신규 인원만 추가
        const ownRoster = await gasClient.getBranchOwnRoster(branchName);
        if (cancelled) return;
        const ownFiltered = ownRoster.filter(isBranchEmployee);
        const ownIds = new Set(ownFiltered.map((e: any) => e.id));
        const staffOnlyNew = staffFiltered.filter((e: any) => !ownIds.has(e.id));
        const merged = [...ownFiltered, ...staffOnlyNew];

        setEmployees(merged as Employee[]);
        localStorage.setItem(`erp_staff_list_${branchName}`, JSON.stringify(merged));

        // 오염이 있거나 결과가 달라진 경우 branch_own_rosters 정리
        const needsUpdate = ownRoster.some((e: any) => !isBranchEmployee(e))
          || ownRoster.length !== merged.length;
        if (needsUpdate) {
          await gasClient.saveBranchOwnRoster(branchName, merged);
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
    setEditRank(emp.rank || "사원");
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

  const saveEmployees = (updated: Employee[]) => {
    const normalized = updated.map((employee) => ({ ...employee, residentNumber: formatResidentNumber(employee.residentNumber || "") }));
    setEmployees(normalized);
    localStorage.setItem(`erp_staff_list_${branchName}`, JSON.stringify(normalized));
    gasClient.saveBranchOwnRoster(branchName, normalized).catch((error) => {
      console.error("직원 명단 저장에 실패했습니다.", error);
    });
  };

  const updateEmployeeField = (id: string, field: "residentNumber" | "contractType" | "entryDate" | "rank" | "division", value: string) => {
    setEmployees((current) => current.map((employee) => {
      if (employee.id !== id) return employee;
      const updated = { ...employee, [field]: field === "residentNumber" ? formatResidentNumber(value) : value };
      if (field === "division" && value === "파트타이머") updated.rank = "사원";
      return updated;
    }));
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
    const matchedDup = getSameNameWarning(newName, formattedResident, employees);
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
      entryDate: newEntryDate,
      ...(division === "정직원" ? {
        rank: selectedRank,
        ...(selectedRank === "기타" ? { customRank: customRankInput.trim() } : {})
      } : {})
    };

    const updated = [...employees, nextEmp];
    saveEmployees(updated);
    setNewName("");
    setSelectedRank("사원");
    setCustomRankInput("");
    setNewResidentNumber("");
    setNewContractType("4대보험");
    setNewEntryDate("");
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
                        setEditRank("사원");
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

        <form onSubmit={handleAddEmployee} className="flex flex-wrap items-end gap-3 text-xs">
          <div className="flex w-44 flex-col space-y-1.5">
            <span className="font-bold text-gray-500">성명 (이름)</span>
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="직원 성명 기입"
              className="px-3.5 py-2.5 border border-gray-200 rounded-xl font-bold bg-gray-50/50 focus:bg-white text-sm focus:outline-hidden focus:border-[#2E6DB4]"
            />
          </div>

          <div className="flex flex-col space-y-1.5">
            <span className="font-bold text-gray-500">고용/계약 상태 구분</span>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "정직원", val: "정직원" },
                { label: "파트타이머", val: "파트타이머" }
              ].map((btn) => {
                const checked = division === btn.val;
                return (
                  <button
                    key={btn.val}
                    type="button"
                    onClick={() => setDivision(btn.val as any)}
                    className={`py-3 rounded-xl border font-extrabold text-xs transition-all cursor-pointer ${
                      checked
                        ? "bg-[#2E6DB4] border-[#2E6DB4] text-white shadow-xs"
                        : "bg-white border-gray-200 text-gray-400 hover:text-gray-600"
                    }`}
                  >
                    {btn.label}
                  </button>
                );
              })}
            </div>
          </div>

          {division === "정직원" && (
            <div className="flex flex-col space-y-1.5 animate-in fade-in duration-200">
              <span className="font-bold text-gray-500">직급 선택</span>
              <select
                value={selectedRank}
                onChange={(e) => {
                  setSelectedRank(e.target.value);
                  if (e.target.value !== "기타") {
                    setCustomRankInput("");
                  }
                }}
                className="px-3.5 py-2.5 border border-gray-200 rounded-xl font-bold bg-gray-50/50 text-sm focus:bg-white focus:outline-hidden focus:border-[#2E6DB4]"
              >
                {["사원", "대리", "과장", "차장", "실장", "부장", "이사", "대표", "부대표", "기타"].map((rk) => (
                  <option key={rk} value={rk}>{rk}</option>
                ))}
              </select>

              {selectedRank === "기타" && (
                <div className="flex flex-col space-y-1 pt-1.5">
                  <span className="text-[10px] text-gray-400 font-bold">기타 직급 입력</span>
                  <input
                    type="text"
                    required
                    value={customRankInput}
                    onChange={(e) => setCustomRankInput(e.target.value)}
                    placeholder="예: 지점장, 실장 등"
                    className="px-3 py-1.5 border border-gray-200 rounded-lg font-bold text-xs bg-white focus:outline-hidden focus:border-[#2E6DB4]"
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col space-y-1.5">
            <label className="font-bold text-gray-500">주민등록번호</label>
            <input
              type="text"
              value={newResidentNumber}
              onChange={(e) => setNewResidentNumber(formatResidentNumber(e.target.value))}
              placeholder=""
              className="px-3.5 py-2.5 border border-gray-200 rounded-xl font-mono bg-gray-50/50 focus:bg-white text-sm focus:outline-hidden focus:border-[#2E6DB4]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col space-y-1.5">
              <label className="font-bold text-gray-500">계약형태</label>
              <select
                value={newContractType}
                onChange={(e) => setNewContractType(e.target.value as "4대보험" | "3.3%")}
                className="px-3.5 py-2.5 border border-gray-200 rounded-xl bg-white font-bold text-sm focus:outline-hidden focus:border-[#2E6DB4]"
              >
                <option value="4대보험">4대보험</option>
                <option value="3.3%">3.3%</option>
              </select>
            </div>
            <div className="flex flex-col space-y-1.5">
              <label className="font-bold text-gray-500">입사일</label>
              <input
                type="date"
                value={newEntryDate}
                onChange={(e) => setNewEntryDate(e.target.value)}
                onClick={(e) => e.currentTarget.showPicker?.()}
                className="px-3.5 py-2.5 border border-gray-200 rounded-xl font-mono bg-gray-50/50 focus:bg-white text-sm focus:outline-hidden focus:border-[#2E6DB4] cursor-pointer"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-4 bg-[#2E6DB4] hover:bg-[#1A3C6E] text-white font-black text-xs rounded-xl cursor-pointer shadow-sm transition-colors flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> 근무자 최종 등록
          </button>
        </form>
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
            <thead>
              <tr className="border-b border-gray-100 text-gray-400 font-bold">
                <th className="py-2.5 px-3 w-16 whitespace-nowrap">근무자 번호</th>
                <th className="py-2.5 px-3 w-24 whitespace-nowrap">성명 (이름)</th>
                <th className="py-2.5 px-3 w-40 whitespace-nowrap">주민등록번호</th>
                <th className="py-2.5 px-3 w-28 whitespace-nowrap">계약형태</th>
                <th className="py-2.5 px-3 w-40 whitespace-nowrap">입사일</th>
                <th className="py-2.5 px-3 w-24 whitespace-nowrap">계약종류 구분</th>
                <th className="py-2.5 px-3 w-24 whitespace-nowrap">직급</th>
                <th className="py-2.5 px-3 w-20 text-right whitespace-nowrap">활동</th>
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
                sortedEmployees.map((emp, idx) => (
                  <tr key={emp.id} className="hover:bg-gray-50/50 font-semibold">
                    <td className="py-3 px-3 text-gray-400 font-mono whitespace-nowrap">#{idx + 1}</td>
                    <td className="py-3 px-3 text-gray-800 font-extrabold text-sm whitespace-nowrap">{emp.name}</td>
                    <td className="py-3 px-3">
                      <input
                        type="text"
                        value={emp.residentNumber || ""}
                        onChange={(e) => updateEmployeeField(emp.id, "residentNumber", e.target.value)}
                        onBlur={() => saveEmployees(employees)}
                        placeholder=""
                        className="w-36 px-2 py-1 border border-gray-200 rounded-md font-mono text-xs text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden"
                      />
                    </td>
                    <td className="py-3 px-3">
                      <select
                        value={emp.contractType || "4대보험"}
                        onChange={(e) => updateEmployeeField(emp.id, "contractType", e.target.value)}
                        onBlur={() => saveEmployees(employees)}
                        className="px-2 py-1 border border-violet-100 rounded-md text-[10px] font-black bg-violet-50 text-violet-700 focus:outline-hidden focus:border-violet-400"
                      >
                        <option value="4대보험">4대보험</option>
                        <option value="3.3%">3.3%</option>
                      </select>
                    </td>
                    <td className="py-3 px-3">
                      <input
                        type="date"
                        value={emp.entryDate || ""}
                        onChange={(e) => updateEmployeeField(emp.id, "entryDate", e.target.value)}
                        onBlur={() => saveEmployees(employees)}
                        onClick={(e) => e.currentTarget.showPicker?.()}
                        className="px-2 py-1 border border-gray-200 rounded-md font-mono text-xs text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden cursor-pointer"
                      />
                    </td>
                    <td className="py-3 px-3">
                      <select
                        value={emp.division}
                        onChange={(e) => updateEmployeeField(emp.id, "division", e.target.value)}
                        onBlur={() => saveEmployees(employees)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-black border focus:outline-hidden cursor-pointer ${
                          emp.division === "정직원"
                            ? "bg-amber-50 text-amber-700 border-amber-200 focus:border-amber-400"
                            : "bg-blue-50 text-[#2E6DB4] border-blue-200 focus:border-blue-400"
                        }`}
                      >
                        <option value="정직원">정직원</option>
                        <option value="파트타이머">파트타이머</option>
                      </select>
                    </td>
                    <td className="py-3 px-3 font-bold text-gray-750">
                      {emp.division === "정직원" ? (
                        <select
                          value={emp.rank || "사원"}
                          onChange={(e) => updateEmployeeField(emp.id, "rank", e.target.value)}
                          onBlur={() => saveEmployees(employees)}
                          className="px-2 py-1 border border-gray-200 rounded-md bg-white text-xs font-bold text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden"
                        >
                          {["사원", "대리", "과장", "차장", "실장", "부장", "이사", "대표", "부대표"].map((rank) => (
                            <option key={rank} value={rank}>{rank}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-gray-300 font-normal">-</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenEditModal(emp)}
                          className="text-gray-400 hover:text-[#2E6DB4] p-1.5 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                          title="정보 수정"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setEmployeeToDelete(emp);
                            setDeleteReason("퇴사");
                            setShowDeleteModal(true);
                          }}
                          className="text-gray-400 hover:text-rose-600 p-1.5 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                          title="명부 삭제"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AnnualLeaveTab({ branchName }: { branchName: string }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [employeeId, setEmployeeId] = useState(""); const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10)); const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10)); const [reason, setReason] = useState("");
  const load = useCallback(async () => { const [roster, saved] = await Promise.all([gasClient.getBranchOwnRoster(branchName), gasClient.getSharedData<any[]>(`annual_leave:${branchName}`)]); setEmployees((roster as Employee[]).map((employee) => ({ ...employee, entryDate: employee.entryDate ? employee.entryDate.slice(2).replace(/-/g, ".") : "" }))); setEntries(saved || []); }, [branchName]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => { const days = Math.floor((new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86400000) + 1; if (!employeeId || days < 1 || !reason.trim()) return; const next = [{ id: `leave-${Date.now()}`, employeeId, days, startDate, endDate, date: startDate, reason: reason.trim() }, ...entries]; await gasClient.saveSharedData(`annual_leave:${branchName}`, next); setEntries(next); setReason(""); };
  return <div className="space-y-5"><div className="bg-white p-6 rounded-2xl border shadow-sm"><h3 className="font-black text-gray-800">연차관리</h3><p className="text-xs text-gray-400 mt-1">시작일과 종료일을 선택하면 사용 일수가 자동 계산됩니다.</p><div className="flex flex-wrap gap-2 mt-4"><select value={employeeId} onChange={e=>setEmployeeId(e.target.value)} className="border rounded px-3 py-2 text-sm"><option value="">직원 선택</option>{employees.filter(e=>e.division === "정직원").map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select><label className="text-xs">시작일<input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="block border rounded px-2 py-1"/></label><label className="text-xs">종료일<input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="block border rounded px-2 py-1"/></label><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="사용 사유" className="border rounded px-3"/><button onClick={()=>void save()} className="bg-[#2E6DB4] text-white rounded px-4 text-sm font-bold">연차 사용 등록</button></div></div><div className="bg-white rounded-2xl border overflow-hidden"><table className="w-full text-sm"><thead><tr className="bg-gray-50 text-left"><th className="p-3">직원</th><th>입사일</th><th>부여</th><th>사용</th><th>잔여</th><th>사용 날짜 기록</th></tr></thead><tbody>{employees.filter(e=>e.division === "정직원").map(e=>{const logs=entries.filter(x=>x.employeeId===e.id);const used=logs.reduce((s,x)=>s+Number(x.days||0),0);return <tr key={e.id} className="border-t"><td className="p-3 font-bold">{e.name}</td><td>{e.entryDate||"-"}</td><td>15일</td><td>{used}일</td><td className="font-bold text-[#2E6DB4]">{15-used}일</td><td className="text-xs text-gray-500">{logs.map(x=>`${x.startDate || x.date}${x.endDate && x.endDate !== (x.startDate || x.date) ? ` ~ ${x.endDate}` : ""}`).join(", ") || "-"}</td></tr>})}</tbody></table></div></div>;
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
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10));
  const [editOvertime, setEditOvertime] = useState<{ row: any; fields: Record<string, string> } | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [log, manual] = await Promise.all([gasClient.getAttendanceLog(branchName, "overtime"), gasClient.getSharedData<any[]>(`manual_overtime:${branchName}`)]);
      const manualRows = (manual || []).map((item) => ({ ...item, clockIn: "수기", clockOut: "수기", workHours: "-", standardHours: "-", overtimeReason: item.reason, manual: true }));
      const all = [...(log.records || []), ...manualRows].sort((a, b) => String(b.settleDate).localeCompare(String(a.settleDate)));
      setRecords(all);
      const month = new Date().toISOString().slice(0, 7);
      const totals = new Map<string, { previous: number; current: number }>();
      all.forEach((item) => { const current = totals.get(item.staffName) || { previous: 0, current: 0 }; if (String(item.settleDate).slice(0, 7) < month) current.previous += Number(item.overtime) || 0; else if (String(item.settleDate).slice(0, 7) === month) current.current += Number(item.overtime) || 0; totals.set(item.staffName, current); });
      setSummaryList(Array.from(totals, ([name, value]) => ({ name, ...value, totalOvertime: value.previous + value.current })));

    } catch (e) {
      console.error("Overtime database read error:", e);
    } finally {
      setLoading(false);
    }
  }, [branchName]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const saveManualOvertime = async () => {
    const hours = Number(manualHours);
    if (!manualName.trim() || !hours || !manualReason.trim()) return;
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
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div>
            <h3 className="text-sm font-black text-gray-800 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-[#2E6DB4]" />
              초과 근무 내역
            </h3>
            <p className="text-[10px] text-gray-400 mt-0.5">정직원 초과근무 기록만 표시됩니다.</p>
          </div>
          <button
            onClick={loadData}
            className="p-1 px-2.5 bg-gray-50 hover:bg-gray-150 border border-gray-200 text-gray-500 rounded-lg text-[10px] font-extrabold flex items-center gap-1 cursor-pointer transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> 새로고침
          </button>
        </div>
        <div className="flex flex-wrap gap-2 rounded-xl bg-gray-50 p-3 border border-gray-100">
          <span className="w-full text-xs font-black text-gray-600">초과근무 수기 입력</span>
          <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="직원명" className="w-24 px-2 py-1 border rounded text-xs" />
          <input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} className="px-2 py-1 border rounded text-xs" />
          <input value={manualHours} onChange={(e) => setManualHours(e.target.value)} placeholder="시간" className="w-16 px-2 py-1 border rounded text-xs" />
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
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 9 : 8} className="py-16 text-center text-gray-400">
                      기록된 임직원 초과근무가 전혀 없습니다.
                    </td>
                  </tr>
                ) : (
                  records.map((r, idx) => (
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
          {summaryList.length === 0 ? (
            <p className="py-8 text-center text-gray-400">집계 가능한 초과근무 대상자가 없습니다.</p>
          ) : (
            summaryList.map((item, idx) => (
              <div key={idx} className="py-3 flex items-center justify-between">
                <span className="text-gray-700 font-extrabold">{item.name}</span>
                <span className={`text-[11px] font-mono p-1 px-2.5 rounded-xl ${
                  item.totalOvertime < 0 
                    ? "bg-amber-55 bg-amber-50 text-amber-700 font-extrabold" 
                    : item.totalOvertime === 0 
                    ? "bg-gray-105 bg-gray-100 text-gray-500" 
                    : "bg-emerald-50 text-emerald-800 font-extrabold"
                }`}>
                  {`전월누적 ${item.previous || 0}h · 이번달 ${item.current || 0}h · 총 ${item.totalOvertime}h`}
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

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const log = await gasClient.getAttendanceLog(branchName, "partTime");
      setRecords(log.records || []);
      setSummaryList(log.summaryList || []);

    } catch (e) {
      console.error("Part timer database read error:", e);
    } finally {
      setLoading(false);
    }
  }, [branchName]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleEditPartTimeRow = (row: any) => {
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
        return name === row.staffName ? { ...staff, clockIn: fields.clockIn.trim(), clockOut: fields.clockOut.trim(), workHours } : staff;
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
    if (!row.recordId || !window.confirm(`${row.staffName}님의 ${row.settleDate} 파트타이머 근무기록을 삭제할까요?`)) return;
    await updateDailyMetadata(row.recordId, (metadata, detail) => {
      const staffRows = Array.isArray(metadata.staffRows) ? metadata.staffRows : [];
      const nextRows = staffRows.filter((staff: any) => (staff.staffName || staff.name) !== row.staffName);
      const nextStaff = (detail.staff || []).filter((staff: any) => (staff.staffName || staff.name) !== row.staffName);
      return { metadata: { ...metadata, staffRows: nextRows }, staff: nextStaff };
    });
    await loadData();
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
          <button
            onClick={loadData}
            className="p-1 px-2.5 bg-gray-50 hover:bg-gray-150 border border-gray-200 text-gray-500 rounded-lg text-[10px] font-extrabold flex items-center gap-1 cursor-pointer transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> 새로고침
          </button>
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
                    <td colSpan={isAdmin ? 7 : 6} className="py-16 text-center text-gray-400">
                      해당 지점에 기록된 파트타이머 출근 기록이 없습니다.
                    </td>
                  </tr>
                ) : (
                  records.map((r, idx) => (
                    <tr key={idx} className="hover:bg-gray-50/50">
                      <td className="py-3.5 px-3 font-mono text-[11px] text-gray-400">{r.settleDate}</td>
                      <td className="py-3.5 px-3 font-extrabold text-gray-800 text-sm">{r.staffName}</td>
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

  const handleDownloadExcel = useCallback(() => {
    try {
      const wb = XLSX.utils.book_new();

      // 1. 매입매출 대장
      let psRows: any[] = [];
      try {
        const saved = localStorage.getItem(`erp_monthly_purchases_${branchName}_${selectedMonth}`);
        if (saved) {
          psRows = JSON.parse(saved);
        } else {
          psRows = [
            { category: "식재료비", vendorName: "주식회사 식자재창고", transferAmount: "1250000", bank: "국민은행", accountNumber: "123-456-789012", isPrepaid: false, monthlyUsageAmount: "1250000", memo: "일반 후불 외상 결제" },
            { category: "식음료외 기타", vendorName: "드림 물류 (선입금 업체)", transferAmount: "0", bank: "신한은행", accountNumber: "987-654-321098", isPrepaid: true, monthlyUsageAmount: "450000", memo: "매월 선충전 후 발주금액 차감 방식" }
          ];
        }
      } catch {}
      const psData = psRows.map(r => ({
        "분류항목": r.category,
        "송금/사용 대상업체명": r.vendorName,
        "선입금 충전방식?": r.isPrepaid ? "선입금" : "후불이체",
        "이체필요 금액 (원)": Number(r.transferAmount) || 0,
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
          rosterPartTimers = JSON.parse(savedRoster).filter((emp: any) => emp.division === "파트타이머");
        }
      } catch {}

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

      const getStoredProfile = (empId: string): any => {
        try {
          const stored = localStorage.getItem(`erp_pt_profile_${branchName}_${empId}`);
          if (stored) return JSON.parse(stored);
        } catch {}
        return {};
      };

      const ptData = rosterPartTimers.map((pt) => {
        const tel = ptTelemetry[pt.name] || { hours: 0, dates: [] };
        const saved = savedSalaryMap[pt.id] || {};
        const profile = getStoredProfile(pt.id);

        const hourlyRate = saved.hourlyRate || profile.hourlyRate || "15000";
        const accumulatedHours = saved.accumulatedHours !== undefined ? saved.accumulatedHours : String(tel.hours);
        const calcSalary = String(Number(hourlyRate) * Number(accumulatedHours));
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
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { patternType: "solid", fgColor: { rgb: "1F4E78" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: { top: { style: "thin", color: { rgb: "B7C9D6" } }, bottom: { style: "thin", color: { rgb: "B7C9D6" } }, left: { style: "thin", color: { rgb: "B7C9D6" } }, right: { style: "thin", color: { rgb: "B7C9D6" } } }
      };
      const titleStyle = { font: { bold: true, sz: 14, color: { rgb: "17365D" } }, alignment: { vertical: "center" } };
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
            cell.s = { border: bodyBorder, alignment: { vertical: "center", wrapText: col === headers.length - 1 } };
            if (numericColumns.includes(col)) cell.z = "#,##0";
            if (textColumns.includes(col)) cell.z = "@";
          }
        }
        sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: Math.max(headerRow, source.length - 1), c: headers.length - 1 } }) };
        return sheet;
      };

      // 기준 파일의 시트명, 제목행, 헤더 순서와 열 폭을 그대로 사용합니다.
      const purchaseHeaders = ["매출항목", "업체명", "이체 필요금액", "은행", "계좌번호", "기타내용", "이달사용금액", "오류"];
      const purchaseRows = psData.map((row) => [row["분류항목"], row["송금/사용 대상업체명"], row["이체필요 금액 (원)"], row["은행"], row["계좌번호"], row["거래 비고 고지"], row["실제 이달사용액 (원)"], ""]);
      const psWS = makeSheet(purchaseHeaders, purchaseRows, [17.17, 14, 12.17, 13.33, 40.83, 60.17, 14.83, 10.33], true, [2, 6], [4]);

      const partTimeHeaders = ["성명(입사일)", "주민등록번호", "입사일", "근로계약", "은행", "입금계좌", "시급", "누적시간", "급여", "출근날짜", "실수령액(송금액)", "실제 송금지점", "기타내용(퇴사일 및 퇴직금등)"];
      const partTimeRows = ptData.map((row) => [row["성명 (사원)"], row["주민등록번호"], row["입사일자"], row["근로계약"], row["은행"], row["입금 계좌번호"], row["시급 (원)"], row["누적시간"], row["기본급여"], row["근무일정 (출근일)"], row["실수령액 (송금)"], row["실제 송금지점"], row["기타 비고 내용 (퇴사일 등)"]]);
      const ptWS = makeSheet(partTimeHeaders, partTimeRows, [11.57, 15.86, 10.21, 8.21, 5.14, 19.64, 10.71, 8.64, 9.29, 24.14, 10.21, 10.21, 41.43], true, [6, 7, 8, 10], [1, 5]);

      const expenseHeaders = ["마감일자", "결제수단", "금액", "사용처(거래처)", "항목", "지출내용(세부)", "비고", "작성자", "입력시각", "마감키"];
      const cashRows = cashList.map((row) => {
        const date = String(row["_마감원본"] || row["마감 일자"] || "");
        const writer = String(row["작성자"] || "");
        return [formatDate(date), "현금", row["지출 금액"], row["거래처 (사용처)"], row["분류 항목"], row["지출내용 (세부)"], row["비고"] === "확인완료" ? "" : row["비고"], writer, formatInputDate(row["입력 시각"], date), `${date}|${writer}`];
      });
      const cashWS = makeSheet(expenseHeaders, cashRows, [11.3, 6.8, 16.4, 11.3, 24.8, 11.9, 6.8, 10.2, 11, 28.8], false, [2]);

      const cashManagementHeaders = ["마감일자", "전일현금", "현금매출", "현금지출", "현금잔액", "실사현금", "차이", "계좌이체", "거래처", "항목", "품목명", "비고", "작성자", "입력시각", "마감키"];
      const mgmtRows = cashMgmt.map((row) => {
        const date = String(row["_마감원본"] || row["마감 일자"] || "");
        const writer = String(row["점검 작성자"] || "");
        return [formatDate(date), row["전일 금고현금"], row["금일 현금매출"], row["현금지출 합계"], row["이론상 잔액 (원)"], row["금고 실사 현금 (원)"], row["차액 (불일치)"], 0, "", "", "", row["대조 불일치 사유 소명"], writer, formatInputDate(row["_입력원본"], date), `${date}|${writer}`];
      });
      const mgmtWS = makeSheet(cashManagementHeaders, mgmtRows, [10.08, 10.08, 10.08, 10.08, 10.08, 10.08, 10.08, 10.08, 10.08, 10.08, 10.08, 23.23, 10.08, 10.08, 10.08], false, [1, 2, 3, 4, 5, 6, 7]);

      const cardRows = cardList.map((row) => {
        const date = String(row["_마감원본"] || row["마감 일자"] || "");
        const writer = String(row["작성자"] || "");
        return [formatCardDate(date), "카드", row["지출 금액"], row["사용처 (가맹점)"], row["항목 (분류)"], row["지출내용 (세부)"], row["비고"] === "확인증빙필" ? "" : row["비고"], writer, formatInputDate(row["_입력원본"], date), `${date}|${writer}`];
      });
      const cardWS = makeSheet(expenseHeaders, cardRows, [11.3, 6.8, 16.4, 18.8, 24.8, 13.3, 6.8, 6.8, 9.9, 23.5], false, [2]);

      XLSX.utils.book_append_sheet(wb, psWS, "매입매출");
      XLSX.utils.book_append_sheet(wb, ptWS, "파트타이머급여");
      XLSX.utils.book_append_sheet(wb, cashWS, "현금지출");
      XLSX.utils.book_append_sheet(wb, mgmtWS, "현금관리");
      XLSX.utils.book_append_sheet(wb, cardWS, "카드지출");

      const fileName = `월말정산_${branchName}${monthNumber}월.xlsx`;

      XLSX.writeFile(wb, fileName);
      triggerToast("엑셀 파일 다운로드 성공!", "success");
    } catch (err: any) {
      console.error(err);
      triggerToast("엑셀 생성 오류: " + err.message, "error");
    }
  }, [branchName, selectedMonth, history, triggerToast, adminSettings]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

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

        <div className="flex items-center gap-3 w-full md:w-auto self-end md:self-auto justify-end">
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
            className="p-2 px-3.5 bg-zinc-900 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all hover:bg-zinc-850 cursor-pointer shadow-subtle"
          >
            <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
            이력 갱신
          </button>
          <button
            onClick={handleDownloadExcel}
            className="p-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-subtle"
          >
            <FileText className="w-4 h-4 text-emerald-200" />
            결산자료 엑셀 다운로드
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center bg-white rounded-3xl border border-gray-100 shadow-sm space-y-3">
          <LoadingSpinner size="lg" />
          <span className="text-xs text-gray-400 font-bold font-mono">가맹점 무인 원격 일지에서 일일 정산자료 조합 파싱 중...</span>
        </div>
      ) : (
        <div className="space-y-6">
          {activeSubTab === "purchaseSales" && (
            <MonthlyPurchaseSalesSubTab branchName={branchName} selectedMonth={selectedMonth} triggerToast={triggerToast} />
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
// 2-1. SUB TAB: 매입매출 대장
// ----------------------------------------------------------------------------
interface PurchaseSalesRow {
  id: string;
  category: "식재료비" | "주류비" | "식음료외 기타";
  vendorName: string;
  transferAmount: string;
  bank: string;
  accountNumber: string;
  isPrepaid: boolean;
  monthlyUsageAmount: string;
  memo: string;
}

function MonthlyPurchaseSalesSubTab({ 
  branchName, 
  selectedMonth,
  triggerToast 
}: { 
  branchName: string; 
  selectedMonth: string; 
  triggerToast: (msg: string, type?: "success" | "error") => void;
}) {
  const [rows, setRows] = useState<PurchaseSalesRow[]>([]);

  // Load local saved purchases
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`erp_monthly_purchases_${branchName}_${selectedMonth}`);
      if (saved) {
        setRows(JSON.parse(saved));
      } else {
        // Defaults to help user start
        setRows([
          {
            id: "p1",
            category: "식재료비",
            vendorName: "주식회사 식자재창고",
            transferAmount: "1250000",
            bank: "국민은행",
            accountNumber: "123-456-789012",
            isPrepaid: false,
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
            monthlyUsageAmount: "450000",
            memo: "매월 선충전 후 발주금액 차감 방식"
          }
        ]);
      }
    } catch {
      setRows([]);
    }
  }, [branchName, selectedMonth]);

  useEffect(() => {
    const loadSharedPurchases = async () => {
      try {
        const remote = await gasClient.getSharedData<PurchaseSalesRow[]>(`monthly_purchases:${branchName}:${selectedMonth}`);
        if (Array.isArray(remote)) setRows(remote);
      } catch (error) {
        console.warn("월 매입 공통 데이터를 불러오지 못했습니다.", error);
      }
    };
    loadSharedPurchases();
  }, [branchName, selectedMonth]);

  const handleSave = async () => {
    try {
      localStorage.setItem(`erp_monthly_purchases_${branchName}_${selectedMonth}`, JSON.stringify(rows));
      await gasClient.saveSharedData(`monthly_purchases:${branchName}:${selectedMonth}`, rows);
      triggerToast("매입매출 대장 내용이 로컬 오프라인 데이터베이스에 성공적으로 안전 보존되었습니다!", "success");
    } catch {
      triggerToast("저장 중 부득이한 에러발생", "error");
    }
  };

  const handleUpdateRow = (id: string, field: keyof PurchaseSalesRow, val: any) => {
    setRows(prev =>
      prev.map(r => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: val };
        // If it's regular vendor and transferAmount changes, sync usageAmount
        if (field === "transferAmount" && !updated.isPrepaid) {
          updated.monthlyUsageAmount = val;
        }
        // If isPrepaid toggles from false to true, usually reset transfer to 0
        if (field === "isPrepaid") {
          if (val === true) {
            updated.transferAmount = "0";
          } else {
            updated.transferAmount = updated.monthlyUsageAmount;
          }
        }
        return updated;
      })
    );
  };

  const handleAddRow = () => {
    const nextRow: PurchaseSalesRow = {
      id: `p_${Date.now()}`,
      category: "식재료비",
      vendorName: "",
      transferAmount: "",
      bank: "",
      accountNumber: "",
      isPrepaid: false,
      monthlyUsageAmount: "",
      memo: ""
    };
    setRows(prev => [...prev, nextRow]);
  };

  const handleDeleteRow = (id: string) => {
    setRows(prev => prev.filter(r => r.id !== id));
  };

  // Calculations
  const totalTransfer = rows.reduce((acc, r) => acc + (Number(r.transferAmount) || 0), 0);
  const totalUsage = rows.reduce((acc, r) => acc + (Number(r.monthlyUsageAmount) || 0), 0);

  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5 animate-fade-in" id="purchase-sales-subtab">
      <div className="flex justify-between items-center pb-3 border-b border-gray-50">
        <div>
          <h3 className="text-sm font-black text-zinc-900 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-[#2E6DB4]" />
            지점 월간 매입매출 및 송금 내역서
          </h3>
          <p className="text-[10px] text-gray-400 font-semibold mt-0.5">
            이번 달 지출 청구 업체 목록에 이체할 은행 송금액 또는 선입금 방식 충전 계약 업체의 실제 사용금액을 기산합니다.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleAddRow}
            className="p-1 px-3 bg-blue-50 hover:bg-blue-100 text-[#2E6DB4] rounded-lg text-xs font-black flex items-center gap-1 cursor-pointer transition-colors shadow-none"
          >
            <Plus className="w-3.5 h-3.5" /> 매입 업체 추가
          </button>
          <button
            onClick={handleSave}
            className="p-1 px-3.5 bg-[#2E6DB4] hover:bg-[#255D9D] text-white rounded-lg text-xs font-black flex items-center gap-1 cursor-pointer transition-colors shadow-subtle"
          >
            <Check className="w-3.5 h-3.5" /> 대장 실시간저장
          </button>
        </div>
      </div>

      {/* Aggregate Banner cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <td colSpan={9} className="py-16 text-center text-gray-400">
                  매입매출 대장에 등록된 매입처가 없습니다. 상단의 '매입 업체 추가'를 클릭해 작성해주세요.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-50/30">
                  <td className="py-2 px-2.5">
                    <select
                      value={row.category}
                      onChange={(e) => handleUpdateRow(row.id, "category", e.target.value)}
                      className="w-full p-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-800 focus:outline-none"
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
                      onChange={(e) => handleUpdateRow(row.id, "vendorName", e.target.value)}
                      placeholder="자재상호 혹은 업체명"
                      className="w-full p-1.5 border border-gray-200 rounded-lg text-xs font-bold placeholder-gray-300 focus:outline-none focus:border-[#2E6DB4]"
                    />
                  </td>
                  <td className="py-2 px-2.5 text-center">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={row.isPrepaid}
                        onChange={(e) => handleUpdateRow(row.id, "isPrepaid", e.target.checked)}
                        className="w-4 h-4 text-[#2E6DB4] border-gray-300 rounded focus:ring-1 focus:ring-[#2E6DB4]"
                      />
                      <span className="text-[9px] font-black text-gray-600">선입금</span>
                    </label>
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="number"
                      disabled={row.isPrepaid}
                      value={row.transferAmount}
                      onChange={(e) => handleUpdateRow(row.id, "transferAmount", e.target.value)}
                      placeholder={row.isPrepaid ? "실 송금 없음" : "송금 필요 잔고"}
                      className={`w-full p-1.5 border rounded-lg text-xs font-mono font-black text-right focus:outline-none ${
                        row.isPrepaid 
                          ? "bg-zinc-100 text-gray-400 border-gray-200" 
                          : "border-gray-200 focus:border-[#2E6DB4] text-red-650"
                      }`}
                    />
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="number"
                      value={row.monthlyUsageAmount}
                      onChange={(e) => handleUpdateRow(row.id, "monthlyUsageAmount", e.target.value)}
                      placeholder="발주액 합계"
                      className="w-full p-1.5 border border-gray-200 rounded-lg text-xs font-mono font-black text-right text-gray-800 focus:outline-none focus:border-[#2E6DB4]"
                    />
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="text"
                      value={row.bank}
                      onChange={(e) => handleUpdateRow(row.id, "bank", e.target.value)}
                      placeholder="은행"
                      className="w-full p-1.5 border border-gray-200 rounded-lg text-xs font-bold placeholder-gray-300 focus:outline-none focus:border-[#2E6DB4]"
                    />
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="text"
                      value={row.accountNumber}
                      onChange={(e) => handleUpdateRow(row.id, "accountNumber", e.target.value)}
                      placeholder="계좌 번호 입력"
                      className="w-full p-1.5 border border-gray-200 rounded-lg text-xs font-mono font-medium placeholder-gray-300 focus:outline-none focus:border-[#2E6DB4]"
                    />
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="text"
                      value={row.memo}
                      onChange={(e) => handleUpdateRow(row.id, "memo", e.target.value)}
                      placeholder="예시: 매월 자동 이체"
                      className="w-full p-1.5 border border-gray-200 rounded-lg text-xs font-semibold placeholder-gray-350 focus:outline-none focus:border-[#2E6DB4]"
                    />
                  </td>
                  <td className="py-2 px-2.5 text-center">
                    <button
                      onClick={() => handleDeleteRow(row.id)}
                      className="text-gray-400 hover:text-rose-600 p-1.5 rounded-lg transition-colors cursor-pointer"
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

  const exclusionStorageKey = `erp_monthly_part_time_exclusions_${branchName}_${selectedMonth}`;
  const exclusionDataKey = `part_time_salary_exclusions:${branchName}:${selectedMonth}`;

  useEffect(() => {
    let active = true;
    const loadExclusions = async () => {
      try {
        const local = localStorage.getItem(exclusionStorageKey);
        if (local && active) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed)) setExcludedEmployeeIds(parsed);
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
  }, [exclusionDataKey, exclusionStorageKey]);

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
      const savedConfig = localStorage.getItem(`erp_monthly_part_time_salary_${branchName}_${selectedMonth}`);
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
      // Cumulative hours synced dynamically unless edited
      const accumulatedHours = saved.accumulatedHours !== undefined 
        ? saved.accumulatedHours 
        : String(tel.hours);
      
      const calcSalary = String(Number(hourlyRate) * Number(accumulatedHours));
      // Forced empty string per "본사에서 입력해야 하는 칸이라 일단 공란으로 해두고"
      const calcActualPaid = saved.actualPaidAmount || "";

      // Sorted days text - limited to maximum of 7 elements as requested
      const attendanceDates = saved.attendanceDates !== undefined
        ? String(saved.attendanceDates).split(",").map((day) => day.trim()).filter(Boolean).slice(0, 7).join(",")
        : tel.dates.sort((a,b) => Number(a) - Number(b)).slice(0, 7).join(",");

      return {
        employeeId: pt.id,
        name: pt.name,
        residentNumber: saved.residentNumber || profile.residentNumber || "",
        entryDate: saved.entryDate || profile.entryDate || "",
        contractStatus: saved.contractStatus || profile.contractStatus || "미작성",
        bank: saved.bank || profile.bank || "",
        accountNumber: saved.accountNumber || profile.accountNumber || "",
        hourlyRate,
        accumulatedHours,
        calculatedSalary: calcSalary,
        attendanceDates,
        actualPaidAmount: calcActualPaid,
        payoutBranch: saved.payoutBranch || branchName,
        memo: saved.memo || ""
      };
      });

    setSalaries(assembledRows);
  }, [branchName, selectedMonth, history, excludedEmployeeIds]);

  useEffect(() => {
    const loadSharedSalaries = async () => {
      try {
        const remote = await gasClient.getSharedData<PartTimeSalaryRow[]>(`part_time_salaries:${branchName}:${selectedMonth}`);
        // 빈 배열은 아직 저장된 급여대장이 없다는 뜻이므로, 일일마감에서 계산한 행을 유지합니다.
        if (Array.isArray(remote) && remote.length > 0) {
          const excluded = new Set(excludedEmployeeIds);
          setSalaries(remote.filter((salary) => !excluded.has(salary.employeeId)));
        }
      } catch (error) {
        console.warn("파트타이머 급여 공통 데이터를 불러오지 못했습니다.", error);
      }
    };
    loadSharedSalaries();
  }, [branchName, selectedMonth, excludedEmployeeIds]);

  useEffect(() => {
    const loadSharedProfiles = async () => {
      try {
        const profiles = await gasClient.getSharedData<Record<string, any>>(`part_time_profiles:${branchName}`);
        if (!profiles) return;
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
  }, [branchName, selectedMonth]);

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
              const calculatedSalary = String((Number(existing.hourlyRate) || 0) * work.hours);
              return {
                ...existing,
                accumulatedHours: String(work.hours),
                attendanceDates,
                calculatedSalary
              };
            }
            const hourlyRate = "15000";
            return {
              employeeId: employee.id,
              name: employee.name,
              residentNumber: "",
              entryDate: "",
              contractStatus: "미작성",
              bank: "",
              accountNumber: "",
              hourlyRate,
              accumulatedHours: String(work.hours),
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
    setSalaries(prev =>
      prev.map(item => {
        if (item.employeeId !== empId) return item;
        const updated = { ...item, [field]: value };
        // Recalculate salary if wage or code changes
        if (field === "hourlyRate" || field === "accumulatedHours") {
          const wage = Number(updated.hourlyRate) || 0;
          const hrs = Number(updated.accumulatedHours) || 0;
          updated.calculatedSalary = String(wage * hrs);
          updated.actualPaidAmount = String(wage * hrs); // Pre-fill with normal calculation
        }
        return updated;
      })
    );
  };

  const handleExcludeEmployee = (employee: PartTimeSalaryRow) => {
    if (!window.confirm(`${employee.name} 님을 이번 달 파트타이머 급여대장에서 제외할까요?\n직원현황과 일일마감 근무기록은 삭제되지 않습니다.`)) return;

    setSalaries((current) => current.filter((salary) => salary.employeeId !== employee.employeeId));
    setExcludedEmployeeIds((current) => current.includes(employee.employeeId)
      ? current
      : [...current, employee.employeeId]);
    triggerToast(`${employee.name} 님을 이번 달 급여대장에서 제외했습니다. 저장하기를 누르면 모든 기기에 반영됩니다.`);
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
      localStorage.setItem(`erp_monthly_part_time_salary_${branchName}_${selectedMonth}`, JSON.stringify(salaries));
      localStorage.setItem(exclusionStorageKey, JSON.stringify(excludedEmployeeIds));
      await Promise.all([
        gasClient.saveSharedData(`part_time_salaries:${branchName}:${selectedMonth}`, salaries),
        gasClient.saveSharedData(`part_time_profiles:${branchName}`, profiles),
        gasClient.saveSharedData(exclusionDataKey, excludedEmployeeIds)
      ]);
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

        <button
          onClick={handleSave}
          className="w-full sm:w-auto px-5 py-3 bg-[#2E6DB4] hover:bg-[#255D9D] text-white rounded-xl text-sm font-black flex items-center justify-center gap-2 cursor-pointer shadow-md transition-all"
        >
          <Check className="w-4 h-4" />
          저장하기
        </button>
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
        <table className="w-full text-left text-xs border-collapse font-medium min-w-[1320px]">
          <thead>
            <tr className="bg-zinc-50 border-b border-gray-100 text-zinc-550 font-black text-[9px] tracking-wider uppercase">
              <th className="py-3 px-3 w-20 whitespace-nowrap">성명 (사원)</th>
              <th className="py-3 px-3 w-32 whitespace-nowrap">주민등록번호</th>
              <th className="py-3 px-3 w-36 whitespace-nowrap">입사일자</th>
              <th className="py-3 px-3 w-20 whitespace-nowrap">은행</th>
              <th className="py-3 px-3 w-32 whitespace-nowrap">입금 계좌번호</th>
              <th className="py-3 px-3 w-20 text-right whitespace-nowrap">시급 (원)</th>
              <th className="py-3 px-3 w-20 text-right whitespace-nowrap">누적시간</th>
              <th className="py-3 px-3 w-24 text-right whitespace-nowrap">기본급여</th>
              <th className="py-3 px-3 w-28 whitespace-nowrap">근무일정 (출근일)</th>
              <th className="py-3 px-3 w-[260px] whitespace-nowrap">기타 비고 내용 (퇴사일 등)</th>
              <th className="py-3 px-3 w-20 text-center whitespace-nowrap">제외</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-[10px] font-sans">
            {visibleSalaries.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-16 text-center text-gray-400 font-bold">
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
                  <td className="py-2.5 px-1.5">
                    <input
                      type="date"
                      value={toDateInputValue(sal.entryDate)}
                      onChange={(e) => handleUpdate(sal.employeeId, "entryDate", e.target.value)}
                      className="w-full p-1 bg-white border border-gray-200 rounded text-xs text-gray-800 text-center"
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
                  <td className="py-2.5 px-1.5 text-right">
                    <input
                      type="number"
                      value={sal.accumulatedHours}
                      onChange={(e) => handleUpdate(sal.employeeId, "accumulatedHours", e.target.value)}
                      className="w-full p-1 bg-white border border-gray-200 rounded text-xs font-mono font-black text-right text-blue-600"
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

  const totalSum = items.reduce((acc, i) => acc + i.amount, 0);

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
            {items.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 10 : 9} className="py-20 text-center text-gray-400 font-bold">
                  선택한 월에 일일마감 시 접수된 현금지출 전표가 한 건도 존재하지 않습니다.
                </td>
              </tr>
            ) : (
              items.map((it, idx) => (
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
                  <td className="py-3.5 px-4 font-bold text-zinc-800">{it.usage}</td>
                  <td className="py-3.5 px-4 font-bold text-blue-650">{it.classification}</td>
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

  const totalSum = items.reduce((acc, i) => acc + i.amount, 0);

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
            {items.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 9 : 8} className="py-20 text-center text-gray-400 font-bold">
                  이번 달에 일일보고에 기록된 카드 지출 영수증이 존재하지 않습니다.
                </td>
              </tr>
            ) : (
              items.map((it, idx) => (
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
                  <td className="py-3.5 px-4 font-bold text-zinc-800">{it.usage}</td>
                  <td className="py-3.5 px-4 font-bold text-indigo-600">{it.classification}</td>
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

