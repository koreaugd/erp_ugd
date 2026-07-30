// src/pages/BranchConfirmPage.tsx
import React, { Suspense, lazy, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../contexts/AuthContext";
import { gasClient } from "../api/gasClient";
import { ArrowRight, RefreshCw, LogOut, CircleDollarSign, Plus, Trash2, Clock, User, FileText, ShoppingCart, Lock, Users, ClipboardList, Coins, Settings, X, Database } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import LoadingSpinner from "../components/LoadingSpinner";
import MyAccountModal from "../components/MyAccountModal";
import { hashPin } from "../utils/hashPin";
import { ensureLatestAppVersion } from "../utils/appVersion";
import { cleanNumeric } from "./branch/helpers/formatters";
import type { BranchDailyTab } from "./branch/types";
import { BRANCH_TAB_REGISTRY, isTabAllowed, firstAllowedKey, permKeyForState, type PermKey } from "./branch/tabRegistry";
// **탭은 열 때 받는다.**
// 예전에는 12개 탭을 전부 정적으로 들여와, 대시보드 하나를 보려고 모든 탭 코드를
// 내려받아야 화면이 떴다(지점 화면 묶음 444KB / 압축 115KB). 매장 태블릿·약한 회선에서
// 이 대기가 그대로 체감된다. 각 탭을 따로 떼어 두면 처음 받는 양이 크게 줄고,
// 실제로 누른 탭만 그때 받는다. 받는 사이에는 아래 Suspense 안내가 잠깐 보인다.
// (배포로 옛 묶음이 지워져 못 받는 경우는 ChunkErrorBoundary·installChunkReloadGuard 가 이미 처리한다.)
const AnnualLeaveTab = lazy(() => import("./branch/tabs/AnnualLeaveTab").then((m) => ({ default: m.AnnualLeaveTab })));
const LaborContractTab = lazy(() => import("./branch/tabs/LaborContractTab").then((m) => ({ default: m.LaborContractTab })));
const BusinessTaxiTab = lazy(() => import("./branch/tabs/BusinessTaxiTab").then((m) => ({ default: m.BusinessTaxiTab })));
const BranchDashboardTab = lazy(() => import("./branch/tabs/BranchDashboardTab").then((m) => ({ default: m.BranchDashboardTab })));
const OvertimeLogTab = lazy(() => import("./branch/tabs/OvertimeLogTab").then((m) => ({ default: m.OvertimeLogTab })));
const PartTimeLogTab = lazy(() => import("./branch/tabs/PartTimeLogTab").then((m) => ({ default: m.PartTimeLogTab })));
const OrderManagementTabV2 = lazy(() => import("./branch/tabs/OrderManagementTabV2").then((m) => ({ default: m.OrderManagementTabV2 })));
const LiquorInventoryTabV2 = lazy(() => import("./branch/tabs/LiquorInventoryTabV2").then((m) => ({ default: m.LiquorInventoryTabV2 })));
const MonthlySettleTab = lazy(() => import("./branch/tabs/MonthlySettleTab").then((m) => ({ default: m.MonthlySettleTab })));
const DailySettleTab = lazy(() => import("./branch/tabs/DailySettleTab").then((m) => ({ default: m.DailySettleTab })));
const OfficeWorkLogTab = lazy(() => import("./branch/tabs/OfficeWorkLogTab").then((m) => ({ default: m.OfficeWorkLogTab })));
const RosterTab = lazy(() => import("./branch/tabs/RosterTab").then((m) => ({ default: m.RosterTab })));



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

  // 캐시/네트워크/로컬 fallback 어느 경로로 얻은 목록이든 반드시 이 필터를 거쳐야
  // 권한 밖 지점이 화면에 노출되는 일이 없다.
  const filterByAllowedBranches = (list: any[]): any[] => {
    if (!user || user.allowedBranches === "all") return list;
    const allowed = user.allowedBranches as string[];
    return list.filter((b: any) => allowed.includes(b.branchName));
  };

  useEffect(() => {
    if (user && !selectedBranch) {
      const fetchBranches = async () => {
        try {
          const cached = sessionStorage.getItem(BRANCH_LIST_CACHE_KEY);
          if (cached) {
            const parsed = JSON.parse(cached);
            const cachedBranches = Array.isArray(parsed) ? parsed : parsed?.branches;
            if (Array.isArray(cachedBranches) && cachedBranches.length > 0) setBranches(filterByAllowedBranches(cachedBranches));
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
          filtered = filterByAllowedBranches(filtered);
          sessionStorage.setItem(BRANCH_LIST_CACHE_KEY, JSON.stringify({ branches: filtered, savedAt: Date.now() }));
          setBranches(filtered);
        } catch (e) {
          console.error("지점 목록 로드 실패:", e);
          setBranches(filterByAllowedBranches(LOCAL_BRANCH_FALLBACK));
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
    if (!user) return;
    if (user.allowedBranches !== "all" && !(user.allowedBranches as string[]).includes(branch.branchName)) {
      // 캐시/오류 경로로 잘못 노출된 권한 밖 지점 선택 시도 — 무시.
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
    <ActiveWorkspace branch={selectedBranch} logout={logout} selectBranch={selectBranch} activeTab={activeTab} setActiveTab={setActiveTab} isAdmin={user.role === "admin"} allowedTabs={user.allowedTabs} loginType={user.loginType} />
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
  allowedTabs: string[] | "all";
  loginType: "personal" | "pin";
}

function ActiveWorkspace({ branch, logout, selectBranch, activeTab, setActiveTab, isAdmin, allowedTabs, loginType }: WorkspaceProps) {
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

  const [mainCategory, setMainCategory] = useState<"dashboard" | "daily" | "monthly" | "annualLeave" | "laborContract" | "businessTaxi">(
    () => (allowedTabs === "all" ? "dashboard" : (BRANCH_TAB_REGISTRY[firstAllowedKey(allowedTabs)].mainCategory as any))
  );
  const [monthlyTab, setMonthlyTab] = useState<"fullTimeSalary" | "purchaseSales" | "partTimeSalary" | "cashExpenses" | "cashManagement" | "cardExpenses">(
    () => {
      if (allowedTabs === "all") return "purchaseSales";
      const target = BRANCH_TAB_REGISTRY[firstAllowedKey(allowedTabs)];
      return (target.monthlyTab as any) || "purchaseSales";
    }
  );

  const dailySubTabs = [
    { id: "settle", label: "일일마감정산", icon: CircleDollarSign },
    ...(!isHeadOfficeBranch ? [
      { id: "orders", label: "발주관리", icon: ShoppingCart },
      { id: "liquorInventory", label: "주류 재고", icon: Database }
    ] : []),
    ...(isHeadOfficeBranch
      ? [
          { id: "officeWorkLog", label: "근무내역", icon: ClipboardList },
          { id: "overtimeLog", label: "초과근무일지", icon: Clock }
        ]
      : [{ id: "overtimeLog", label: "초과근무일지", icon: Clock }]),
    { id: "partTimeLog", label: "파트타이머일지", icon: ClipboardList },
    // 직원현황은 자주 안 보는 참고 화면이라 맨 밑으로 내린다(사용자 요청 2026-07-18).
    { id: "roster", label: "직원현황", icon: User }
  ] as Array<{ id: BranchDailyTab; label: string; icon: typeof CircleDollarSign }>;

  const monthlySubTabs = [
    { id: "fullTimeSalary", label: "정직원 급여대장", icon: Users },
    { id: "purchaseSales", label: "매입매출", icon: FileText },
    { id: "partTimeSalary", label: "파트타이머 급여대장", icon: Users },
    { id: "cashManagement", label: "현금관리", icon: CircleDollarSign },
    { id: "cashExpenses", label: "현금지출", icon: Coins },
    { id: "cardExpenses", label: "카드지출", icon: ShoppingCart }
  ] as Array<{ id: typeof monthlyTab; label: string; icon: typeof FileText }>;

  const navigateTo = (key: PermKey) => {
    const target = BRANCH_TAB_REGISTRY[key];
    // 주류재고 이탈 확인(기존 openDailySubTab 로직 흡수)
    if (activeTab === "liquorInventory" && target.activeTab !== "liquorInventory" && (window as any).__ugdLiquorInventoryDirty) {
      if (!window.confirm("저장하지 않은 주류 재고 입력값이 있습니다. 저장하지 않고 이동할까요?")) return;
      (window as any).__ugdLiquorInventoryDirty = false;
    }
    setMainCategory(target.mainCategory as any);
    if (target.activeTab) setActiveTab(target.activeTab as BranchDailyTab);
    if (target.monthlyTab) setMonthlyTab(target.monthlyTab as any);
  };

  // 초기 라우팅: 개인 계정은 허용된 첫 화면으로 1회 이동. PIN 로그인("all")은 현행 대시보드 초기화면 유지(회귀 방지).
  useEffect(() => {
    if (allowedTabs === "all") return;
    navigateTo(firstAllowedKey(allowedTabs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // 내 정보 모달(2026-07-29) — 개인 계정만. 이름·연락처·비밀번호 자가 수정.
  const [myAccountOpen, setMyAccountOpen] = useState(false);

  // 2. Admin Settings Editor Modal states
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [isPasscodeVerified, setIsPasscodeVerified] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState("");
  // 2026-07-27 컴팩트화: 화면에 영향 없는 설정 탭(로고·색상·문구·엑셀 서식·Firebase 연동)을 없애고
  // 실사용 2탭(지점 관리·보안)만 남겼다. 기존 저장값은 handleSaveAdminSettings 의 spread 로 보존된다.
  const [adminActiveTab, setAdminActiveTab] = useState<"branches" | "security">("branches");

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

  // Form states — 남은 편집 항목은 정직원 급여대장 열람 비밀번호뿐이다.
  const [formFullTimeSalaryPasscode, setFormFullTimeSalaryPasscode] = useState(adminSettings.fullTimeSalaryPasscode || "");

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
    if (isAdminModalOpen && isPasscodeVerified && adminActiveTab === "branches") {
      fetchAdminBranches();
    }
  }, [isAdminModalOpen, isPasscodeVerified, adminActiveTab]);

  // Sync form when settings loads or modal triggers
  useEffect(() => {
    if (isAdminModalOpen) {
      setFormFullTimeSalaryPasscode(adminSettings.fullTimeSalaryPasscode || "");
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
      if (loginType === "personal") {
        // 개인 세션에서는 loginWithAdminPin(주 Auth)을 쓰면 세션이 PIN 계정으로 오염된다 —
        // gate 보조 인스턴스로만 검증한다.
        const { verifyGatePin } = await import("../api/gateAuth");
        await verifyGatePin({ kind: "admin" }, passcode);
      } else {
        // 별도 로컬 비밀번호 대신 실제 Firebase 관리자 PIN으로 재인증합니다.
        const { loginWithAdminPin } = await import("../api/firebaseAuth");
        await loginWithAdminPin(passcode);
      }
      setIsPasscodeVerified(true);
      setPasscodeError("");
    } catch (error: any) {
      // verifyGatePin은 원인별 한국어 안내문(시도초과 등)을 담은 일반 Error를 던진다(코드 없음) — 그대로 보여준다.
      // 반면 loginWithAdminPin의 Firebase 오류(error.code 있음)는 영어 원문이라 기존 안내문으로 대체한다.
      setPasscodeError(!error?.code && error?.message ? error.message : "관리자 PIN이 일치하지 않습니다. 다시 시도해 주세요.");
    }
  };

  const handleSaveAdminSettings = async () => {
    // 편집 UI 를 없앤 항목(색상·문구·엑셀 서식 등)은 기존 저장값을 그대로 보존한다 —
    // MonthlySettleTab 등이 여전히 읽는 값이므로 여기서 지우면 화면 문구가 초기화된다.
    const updated = {
      ...adminSettings,
      fullTimeSalaryPasscode: formFullTimeSalaryPasscode.trim() === "1234" ? "" : formFullTimeSalaryPasscode.trim(),
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
    if (loginType === "personal") {
      // changeFirebaseLoginPins는 구조적으로 주 Auth로 각 계정에 로그인한다 —
      // 개인 계정 세션에서 실행하면 로그인 상태가 PIN 계정으로 바뀌어 버리므로 차단한다.
      triggerToast("PIN 변경은 기존 PIN 관리자 로그인에서만 가능합니다. (개인 계정 세션에서는 로그인 상태가 바뀌어 지원하지 않습니다)", "error");
      return;
    }
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
      // 성공 반환 = 시트·Firebase 모두 새 PIN으로 동기화 완료(실패는 전부 throw로 떨어진다).
      // 현재 관리자 세션의 pinHash도 새 값으로 갱신 — 카카오택시 등 서버 게이트는 시트의
      // 새 해시와 비교하므로, 갱신하지 않으면 이 세션에서 해당 기능이 즉시 막힌다.
      if (result.changedAdmin) {
        try {
          const { hashPin } = await import("../utils/hashPin");
          const newHash = await hashPin(newAdminLoginPin.trim());
          const raw = sessionStorage.getItem("erp_ugd_session_v2");
          if (raw) {
            const session = JSON.parse(raw);
            session.pinHash = newHash;
            sessionStorage.setItem("erp_ugd_session_v2", JSON.stringify(session));
          }
        } catch { /* 세션 갱신 실패는 재로그인으로 해결 가능 — 무시 */ }
      }
      setCurrentAdminLoginPin(""); setCurrentBranchLoginPin(""); setNewAdminLoginPin("");
      setNewBranchLoginPin(""); setConfirmAdminLoginPin(""); setConfirmBranchLoginPin("");
      triggerToast(`로그인 PIN 변경 완료: 지점 ${result.changedBranches}개${result.changedAdmin ? ", 관리자 1개" : ""}. 다음 로그인부터 새 PIN을 사용합니다.`);
    } catch (error: any) {
      triggerToast(error?.message || "Firebase 로그인 PIN 변경에 실패했습니다. 기존 PIN은 유지됩니다.", "error");
    } finally {
      setChangingFirebaseLoginPins(false);
    }
  };

  // 현재 화면이 권한 밖이면 본문 콘텐츠를 마운트하지 않는다(첫 프레임 API 호출 차단 + 허용 0개 방어).
  const currentKey = permKeyForState(mainCategory, activeTab, monthlyTab);
  const contentAllowed = currentKey !== null && isTabAllowed(allowedTabs, currentKey);

  return (
    <div className="branch-redesign min-h-screen bg-[#F8FAFC] flex flex-col md:flex-row">
      {/* Sidebar Layout */}
      <aside
        className="w-full md:w-[236px] shrink-0 md:sticky md:top-0 md:h-screen flex flex-col border-b md:border-b-0 transition-all duration-300 z-40"
      >
        {/* Branch Info Top */}
        <div className="p-5 border-b flex md:flex-col items-center md:items-start justify-between md:justify-start gap-4">
          <div className="min-w-0 w-full">
            <h1 className="branch-sidebar-branch-name text-base font-black tracking-tight">
              {activeBranchName}
            </h1>
            <p className="branch-sidebar-brand-sub">지점 마감 포탈</p>
          </div>
        </div>

        {/* Categories Navigation */}
        <nav className="py-2 flex md:flex-col gap-0 grow overflow-x-auto no-scrollbar md:overflow-y-auto">
          {/* 메인 */}
          <p className="ugd-nav-group">메인</p>
          <button
            type="button"
            onClick={() => navigateTo("dashboard")}
            aria-current={mainCategory === "dashboard" ? "page" : undefined}
            className={`ugd-nav-item shrink-0${mainCategory === "dashboard" ? " is-active" : ""}${!isTabAllowed(allowedTabs, "dashboard") ? " opacity-50" : ""}`}
          >
            <span>대시보드</span>
          </button>

          {/* 일일 업무 */}
          <p className="ugd-nav-group">일일 업무</p>
          {dailySubTabs.map((tab) => {
            const subActive = mainCategory === "daily" && activeTab === tab.id;
            const allowed = isTabAllowed(allowedTabs, ("daily." + tab.id) as PermKey);
            return (
              <button
                key={`daily-${tab.id}`}
                type="button"
                onClick={() => navigateTo(("daily." + tab.id) as PermKey)}
                aria-current={subActive ? "page" : undefined}
                className={`ugd-nav-item shrink-0${subActive ? " is-active" : ""}${!allowed ? " opacity-50" : ""}`}
              >
                <span>{tab.label}</span>
              </button>
            );
          })}

          {/* 월말 업무 */}
          <p className="ugd-nav-group">월말 업무</p>
          {monthlySubTabs.map((tab) => {
            const subActive = mainCategory === "monthly" && monthlyTab === tab.id;
            const allowed = isTabAllowed(allowedTabs, ("monthly." + tab.id) as PermKey);
            return (
              <button
                key={`monthly-${tab.id}`}
                type="button"
                onClick={() => navigateTo(("monthly." + tab.id) as PermKey)}
                aria-current={subActive ? "page" : undefined}
                className={`ugd-nav-item shrink-0${subActive ? " is-active" : ""}${!allowed ? " opacity-50" : ""}`}
              >
                <span>{tab.label}</span>
              </button>
            );
          })}

          {/* 인사 · 기타 */}
          <p className="ugd-nav-group">인사 · 기타</p>
          <button
            type="button"
            onClick={() => navigateTo("laborContract")}
            aria-current={mainCategory === "laborContract" ? "page" : undefined}
            className={`ugd-nav-item shrink-0${mainCategory === "laborContract" ? " is-active" : ""}${!isTabAllowed(allowedTabs, "laborContract") ? " opacity-50" : ""}`}
          >
            <span>근로계약서</span>
          </button>
          {/* 순서: 근로계약서 → 비즈니스택시 → 연차관리 (사용자 지시 2026-07-24) */}
          <button
            type="button"
            onClick={() => navigateTo("businessTaxi")}
            aria-current={mainCategory === "businessTaxi" ? "page" : undefined}
            className={`ugd-nav-item shrink-0${mainCategory === "businessTaxi" ? " is-active" : ""}${!isTabAllowed(allowedTabs, "businessTaxi") ? " opacity-50" : ""}`}
          >
            <span>비즈니스택시</span>
          </button>
          <button
            type="button"
            onClick={() => navigateTo("annualLeave")}
            aria-current={mainCategory === "annualLeave" ? "page" : undefined}
            className={`ugd-nav-item shrink-0${mainCategory === "annualLeave" ? " is-active" : ""}${!isTabAllowed(allowedTabs, "annualLeave") ? " opacity-50" : ""}`}
          >
            <span>연차관리</span>
          </button>
        </nav>


        {/* Change Branch / Signout Section Bottom */}
        <div className="p-4 border-t border-[rgba(33,33,33,0.1)] hidden md:block space-y-2">
          {/* 어드민 설정 버튼 */}
          <button
            onClick={handleOpenAdmin}
            className={`w-full ${isAdmin ? "flex" : "hidden"} items-center justify-center gap-2 py-2 rounded-xl border border-[rgba(33,33,33,0.16)] text-[#212121] hover:bg-[rgba(33,33,33,0.05)] transition-all text-xs font-bold cursor-pointer`}
          >
            어드민 설정
          </button>

          <button onClick={() => navigate("/admin")} className={`w-full ${isAdmin ? "flex" : "hidden"} items-center justify-center gap-2 py-2 rounded-xl border border-[rgba(33,33,33,0.16)] text-[#212121] hover:bg-[rgba(33,33,33,0.05)] transition-all text-xs font-bold cursor-pointer`}>
            관리자페이지
          </button>

          <button
            onClick={() => selectBranch(null)}
            className={`w-full ${isAdmin ? "flex" : "hidden"} items-center justify-center gap-2 py-2 rounded-xl border border-[rgba(33,33,33,0.16)] text-[#212121] hover:bg-[rgba(33,33,33,0.05)] transition-all text-xs font-bold cursor-pointer`}
          >
            지점 변경하기
          </button>
          {/* 내 정보 — 개인 계정만(이름·연락처·비밀번호 자가 수정, 2026-07-29). PIN 세션은 개인 문서가 없다. */}
          {loginType === "personal" && (
            <button
              id="btn-branch-my-account"
              onClick={() => setMyAccountOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-[rgba(33,33,33,0.16)] text-[#212121] hover:bg-[rgba(33,33,33,0.05)] transition-all text-xs font-bold cursor-pointer"
            >
              내 정보
            </button>
          )}
          <button
            id="btn-branch-logout-desktop"
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#212121] hover:bg-black text-[#F6F5FA] rounded-xl transition-all text-xs font-black cursor-pointer border border-transparent"
          >
            마감 보안 로그아웃
          </button>
        </div>

        {/* Mobile quick header bar right align for logout */}
        <div className="md:hidden flex px-4 pb-3 justify-between items-center border-t border-[rgba(33,33,33,0.1)] pt-2 gap-2">
          <button
            onClick={handleOpenAdmin}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-[rgba(33,33,33,0.16)] text-[#212121]"
          >
            어드민
          </button>
          <button
            onClick={() => selectBranch(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-[rgba(33,33,33,0.16)] text-[#212121]"
          >
            지점변경
          </button>
          {loginType === "personal" && (
            <button
              id="btn-branch-my-account-mobile"
              onClick={() => setMyAccountOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-[rgba(33,33,33,0.16)] text-[#212121]"
            >
              내정보
            </button>
          )}
          <button
            id="btn-branch-logout-mobile"
            onClick={logout}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#212121] text-xs font-black text-[#F6F5FA] rounded-lg border border-transparent"
          >
            로그아웃
          </button>
        </div>
        <MyAccountModal isOpen={myAccountOpen} onClose={() => setMyAccountOpen(false)} />
      </aside>

      {/* Main Page Area Right */}
      <div className="grow flex flex-col min-h-screen overflow-x-hidden">
        {/* Content Panel Frame */}
        <main className="grow p-4 sm:p-6 pb-20 max-w-7xl w-full mx-auto">
          {!contentAllowed && (
            <div className="flex flex-col items-center justify-center py-24 gap-2">
              <p className="text-sm font-bold text-zinc-600">이 탭에 접근 권한이 없습니다.</p>
              <p className="text-xs text-zinc-400">관리자에게 권한을 요청해 주세요.</p>
            </div>
          )}

          {/* 탭 코드를 받는 잠깐 동안 빈 화면 대신 이 안내가 보인다. 탭 하나만 받으면 되므로 짧다. */}
          <Suspense
            fallback={
              <div className="py-24 flex flex-col items-center justify-center gap-3">
                <LoadingSpinner size="lg" />
                <p className="text-xs font-bold text-zinc-400">화면을 불러오는 중입니다.</p>
              </div>
            }
          >
          {contentAllowed && mainCategory === "dashboard" && <BranchDashboardTab branchName={activeBranchName} />}

          {contentAllowed && mainCategory === "daily" && (
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

          {contentAllowed && mainCategory === "monthly" && (
            <MonthlySettleTab
              branchName={activeBranchName}
              activeSubTab={monthlyTab}
              isAdmin={isAdmin}
            />
          )}

          {contentAllowed && mainCategory === "annualLeave" && <AnnualLeaveTab branchName={activeBranchName} isAdmin={isAdmin} />}

          {contentAllowed && mainCategory === "laborContract" && <LaborContractTab branchName={activeBranchName} isAdmin={isAdmin} />}

          {contentAllowed && mainCategory === "businessTaxi" && <BusinessTaxiTab branchName={activeBranchName} />}
          </Suspense>
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
                    <p className="text-[10px] text-gray-400 font-bold">지점 등록·관리와 로그인 PIN 등 보안 설정을 변경합니다</p>
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
                      { id: "branches", label: "지점 등록 & 관리" },
                      { id: "security", label: "보안" },
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

                        {/* 기타 정산 서식 탭에서 옮겨옴(2026-07-27 컴팩트화) — 성격상 보안 항목이라 여기로. 저장은 아래 '저장 및 즉시 연동' 버튼. */}
                        <div className="rounded-2xl border border-gray-150 p-4">
                          <label className="text-xs font-bold text-gray-700 block mb-1">정직원 급여대장 열람 비밀번호</label>
                          <input
                            type="text"
                            value={formFullTimeSalaryPasscode}
                            onChange={(e) => setFormFullTimeSalaryPasscode(e.target.value)}
                            placeholder="비밀번호를 설정하세요"
                            className="w-full px-3 py-2 border border-gray-200 rounded-xl font-bold text-xs focus:outline-hidden focus:border-zinc-900"
                          />
                          <p className="text-[10px] text-gray-400 mt-1 font-semibold">* 월말마감 &gt; 정직원 급여대장 탭 진입 시 요구되는 비밀번호. 설정하지 않으면 급여대장을 열 수 없습니다(기본값 없음). 아래 '저장 및 즉시 연동'을 눌러야 반영됩니다.</p>
                        </div>
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
                                  const res = await gasClient.addBranch(trimName, phash, trimBrand, newBranchRole, trimPin, isAdmin);
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
                                            const res = await gasClient.toggleBranchActive(b.branchName, !b.isActive, isAdmin);
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

                  </div>
                </div>
              )}

              {/* Modal Footer actions (Only when authenticated) */}
              {isPasscodeVerified && (
                <div className="p-4 border-t border-gray-150 flex justify-end bg-zinc-50 shrink-0">
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
