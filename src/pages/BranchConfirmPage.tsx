// src/pages/BranchConfirmPage.tsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../contexts/AuthContext";
import { gasClient } from "../api/gasClient";
import { Calendar, Store, ArrowRight, RefreshCw, LogOut, CircleDollarSign, Plus, Trash2, Clock, User, FileText, ShoppingCart, Lock, Users, ClipboardList, Coins, Briefcase, Settings, X, Cloud, Database, UploadCloud, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import LoadingSpinner from "../components/LoadingSpinner";
import { hashPin } from "../utils/hashPin";
import { ensureLatestAppVersion } from "../utils/appVersion";
import { cleanNumeric } from "./branch/helpers/formatters";
import type { BranchDailyTab } from "./branch/types";
import { AnnualLeaveTab } from "./branch/tabs/AnnualLeaveTab";
import { LaborContractTab } from "./branch/tabs/LaborContractTab";
import { BranchDashboardTab } from "./branch/tabs/BranchDashboardTab";
import { OvertimeLogTab } from "./branch/tabs/OvertimeLogTab";
import { PartTimeLogTab } from "./branch/tabs/PartTimeLogTab";
import { OrderManagementTabV2 } from "./branch/tabs/OrderManagementTabV2";
import { LiquorInventoryTabV2 } from "./branch/tabs/LiquorInventoryTabV2";
import { MonthlySettleTab } from "./branch/tabs/MonthlySettleTab";
import { DailySettleTab } from "./branch/tabs/DailySettleTab";
import { OfficeWorkLogTab } from "./branch/tabs/OfficeWorkLogTab";
import { RosterTab } from "./branch/tabs/RosterTab";



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
  const [monthlyTab, setMonthlyTab] = useState<"fullTimeSalary" | "purchaseSales" | "partTimeSalary" | "cashExpenses" | "cashManagement" | "cardExpenses">("purchaseSales");

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
    { id: "fullTimeSalary", label: "정직원 급여대장", icon: Users },
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
      fullTimeSalaryPasscode: "",
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
  const [formFullTimeSalaryPasscode, setFormFullTimeSalaryPasscode] = useState(adminSettings.fullTimeSalaryPasscode || "");
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
      setFormFullTimeSalaryPasscode(adminSettings.fullTimeSalaryPasscode || "");
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
      fullTimeSalaryPasscode: formFullTimeSalaryPasscode.trim() === "1234" ? "" : formFullTimeSalaryPasscode.trim(),
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

                          <div>
                            <label className="text-xs font-bold text-gray-700 block mb-1">정직원 급여대장 열람 비밀번호</label>
                            <input
                              type="text"
                              value={formFullTimeSalaryPasscode}
                              onChange={(e) => setFormFullTimeSalaryPasscode(e.target.value)}
                              placeholder="비밀번호를 설정하세요"
                              className="w-full px-3 py-2 border border-gray-200 rounded-xl font-bold text-xs focus:outline-hidden focus:border-zinc-900"
                            />
                            <p className="text-[10px] text-gray-400 mt-1 font-semibold">* 월말마감 &gt; 정직원 급여대장 탭 진입 시 요구되는 비밀번호. 설정하지 않으면 급여대장을 열 수 없습니다(기본값 없음).</p>
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
