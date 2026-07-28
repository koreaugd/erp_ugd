// src/pages/AdminPage.tsx
import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../contexts/AuthContext";
import { gasClient, DailyListRow, DailySettleDetail } from "../api/gasClient";
import type { LaborContractTemplateMeta } from "../api/gasClient";
import LoadingSpinner from "../components/LoadingSpinner";
import ToastMessage, { ToastType } from "../components/ToastMessage";
import ConfirmModal from "../components/ConfirmModal";
import NumberInput from "../components/NumberInput";
import { formatNumber } from "../utils/formatNumber";
import { assembleMonthlyCloseWorkbook, purchaseRowHasExportableAmount, unnamedPartTimeSalaryRows, type MonthlyCloseData } from "./branch/helpers/monthlyCloseWorkbook";
import { SalaryChangeHistoryTab } from "./admin/SalaryChangeHistoryTab";
import { AccountManagementSection } from "./admin/AccountManagementSection";
import { listUserProfiles } from "../api/userProfile";
import { KakaoTaxiSection, type KakaoTaxiView } from "./admin/KakaoTaxiSection";
import { kakaoTaxiRequestsKey, type KakaoTaxiRequest } from "./admin/helpers/kakaoTaxiRequests";
import { normalizeKakaoTaxiOrders } from "./admin/helpers/kakaoTaxi";
import { DEFAULT_TAXI_THRESHOLDS, flagTaxiOrders } from "./admin/helpers/kakaoTaxiAnomaly";
import { AdminSalesOverviewSection } from "./admin/AdminSalesOverviewSection";
import { AdminAnalysisSection } from "./admin/AdminAnalysisSection";
import { isAdminTabAllowed, firstAllowedAdminKey, effectivePermKey, type AdminPermKey } from "./admin/adminTabRegistry";
import {
  Users, CheckCircle2, AlertTriangle,
  Calendar, Filter,
  Download, FileSpreadsheet, Eye,
  X, Edit3, Save, LogOut, Briefcase, Trash2,
  ChevronRight, Menu
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function AdminPage() {
  const { user, logout } = useAuthContext();
  const navigate = useNavigate();
  // [Codex P0 / 2026-07-25] role !== "admin"일 때 806줄의 렌더 가드(return null)는 화면만 막는다 —
  // 그 위에 선언된 useEffect들은 훅 규칙상 조건 없이 실행되므로, 지점 세션이 /admin에 직접 들어오면
  // 관리자 전용 데이터 로드(전 지점 일일마감·마감 이상치·대시보드 알림 등)가 그대로 호출된다.
  // 데이터를 불러오는 모든 effect·로드 함수 첫 줄에서 이 값으로 한 번 더 막는다.
  const isAdminSession = !!user && user.role === "admin";

  const getTodayDateString = () => {
    const local = new Date();
    const year = local.getFullYear();
    const month = String(local.getMonth() + 1).padStart(2, "0");
    const day = String(local.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const getYesterdayDateString = () => {
    const local = new Date();
    local.setDate(local.getDate() - 1);
    const year = local.getFullYear();
    const month = String(local.getMonth() + 1).padStart(2, "0");
    const day = String(local.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // 1. 관리자 필터 관련 상태
  const [selectedDate, setSelectedDate] = useState<string>(getYesterdayDateString());
  const [selectedBrand, setSelectedBrand] = useState<string>("전체");
  
  // 2. 데이터 수집 상태
  const [loading, setLoading] = useState<boolean>(true);
  const [dailyList, setDailyList] = useState<DailyListRow[]>([]);
  
  // 3. 상세 세부 드로어/모달 상태
  const [selectedRow, setSelectedRow] = useState<DailyListRow | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailData, setDetailData] = useState<DailySettleDetail | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  // 모바일(<1024px)에서는 사이드바가 hidden lg:flex라 아예 없어서 섹션 이동이 불가능했다.
  // 모바일 헤더의 햄버거 버튼으로 같은 사이드바를 오버레이 드로어로 여닫는다.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  // 드로어 접근성: Esc로 닫기, 열릴 때 닫기 버튼으로 포커스 이동, 닫히면 햄버거 버튼으로 포커스 복귀.
  const mobileSidebarCloseBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mobileSidebarOpen) return;
    mobileSidebarCloseBtnRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setMobileSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.getElementById("mobile-btn-open-sidebar")?.focus();
    };
  }, [mobileSidebarOpen]);

  // 4. 인라인 수정 모드 상태
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editCashSales, setEditCashSales] = useState<string>("");
  const [editCardSales, setEditCardSales] = useState<string>("");
  const [editTransferSales, setEditTransferSales] = useState<string>("");
  const [editDeliverySales, setEditDeliverySales] = useState<string>("");
  const [editMemo, setEditMemo] = useState<string>("");

  // 5. 알림 및 저장 모달 상태
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [isSaveConfirmOpen, setIsSaveConfirmOpen] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  // 관리자 화면 탭 권한(2026-07-25 신설). user가 아직 없는 첫 렌더에서는 undefined→"all" 취급이라
  // 기존과 동일하게 "dashboard"로 시작한다. user가 늦게 채워지는 경우를 대비해 마운트 1회 보정 effect를
  // 아래에 두고, sectionAllowed 렌더 가드가 그 사이 첫 프레임의 무단 접근을 막는다.
  const allowedAdminTabs = user?.allowedAdminTabs ?? "all";
  const [adminSection, setAdminSection] = useState<AdminPermKey>(() => firstAllowedAdminKey(user?.allowedAdminTabs ?? "all"));
  const adminSectionCorrectedRef = useRef(false);
  useEffect(() => {
    if (adminSectionCorrectedRef.current) return;
    if (!user) return;
    adminSectionCorrectedRef.current = true;
    setAdminSection((current) => (isAdminTabAllowed(user.allowedAdminTabs, current) ? current : firstAllowedAdminKey(user.allowedAdminTabs)));
  }, [user]);
  const sectionAllowed = isAdminTabAllowed(allowedAdminTabs, effectivePermKey(adminSection));
  const [anomalyLoading, setAnomalyLoading] = useState(false);
  const [anomalyRecords, setAnomalyRecords] = useState<Array<any>>([]);
  // 이상치를 못 읽은 지점 — '이상 없음'과 '못 읽음'을 구분해 보여주기 위해 이름을 남긴다(P0-2).
  const [anomalyFailedBranches, setAnomalyFailedBranches] = useState<string[]>([]);
  const [anomalyLoadError, setAnomalyLoadError] = useState(false);
  // 마감 이상치 표의 분류. 예전엔 'dashboard' 탭이 하나 더 있었지만 필터가 'cash'와 완전히 같은 죽은 탭이라 없앴다
  // (대시보드 → 전일 정산현황으로 옮기면서 정리, 2026-07-22).
  const [closingView, setClosingView] = useState<"overtime" | "cash" | "remarks" | "otherMemo">("cash");
  const [dailySettlementTab, setDailySettlementTab] = useState<"status" | "logs">("status");
  // 마감 이력 점검 탭은 하위탭이 없어졌다. 대시보드 알림에서 넘어올 때 어느 섹션으로 스크롤할지만 가리킨다.
  // 기본값은 반드시 null이다 — 값이 있으면 사이드바로 그냥 들어와도 그 섹션까지 스크롤해 버려,
  // 맨 위 섹션(현금차이)을 건너뛰고 화면이 아래로 튄다.
  const [dailyLogsFocus, setDailyLogsFocus] = useState<"logs" | "manualOvertimes" | null>(null);
  const [monthlyClosingTab, setMonthlyClosingTab] = useState<"status" | "cashManagement" | "cashExpenses">("status");
  const [analysisTab, setAnalysisTab] = useState<"summary" | "charts" | "branch">("summary");
  const [kakaoTaxiTab, setKakaoTaxiTab] = useState<KakaoTaxiView>("orders");
  // taxiRequests/laborContractsPending/taxiAnomalies 의 null = "조회 실패"다. 0(없음)과 구분해 화면에 경고를 띄운다
  // — 실패를 0건으로 삼키면 '확인할 항목 없음'으로 오도된다(Codex P1 2026-07-27).
  const [dashboardAlerts, setDashboardAlerts] = useState<{ editLogs: number; manualOvertimes: number; newSignups: number; taxiRequests: number | null; laborContractsPending: number | null; taxiAnomalies: number | null; latestEditLogAt: string; latestManualOvertimeAt: string }>({ editLogs: 0, manualOvertimes: 0, newSignups: 0, taxiRequests: 0, laborContractsPending: 0, taxiAnomalies: 0, latestEditLogAt: "", latestManualOvertimeAt: "" });
  const [dashboardAlertsLoading, setDashboardAlertsLoading] = useState(false);
  // 비동기 응답이 뒤섞여 화면에 이전 요청 결과가 남는 것을 막기 위한 최신 요청 표식입니다.
  const dailyListRequestRef = useRef(0);
  const anomalyRequestRef = useRef(0);
  const dashboardAlertsRequestRef = useRef(0);
  // 지점별 일일마감 이력 캐시(이상치 표) — 날짜를 바꿔도 다시 읽지 않게. 실패는 캐시하지 않는다.
  const anomalyCacheRef = useRef(new Map<string, { records: any[]; at: number }>());
  const detailRequestRef = useRef(0);

  // 본인 권한 검수 및 마크업 라우팅 분기
  useEffect(() => {
    if (!user) {
      navigate("/");
      return;
    }
    if (user.role !== "admin") {
      navigate("/branch-confirm");
    }
  }, [user, navigate]);

  // 전 지점 정산 총람 불러오기
  const fetchDailyList = async () => {
    if (!isAdminSession) return;
    if (!user) return;
    const requestId = ++dailyListRequestRef.current;
    try {
      setLoading(true);
      const [list, branches] = await Promise.all([
        gasClient.getDailyList(selectedDate, user.pinHash),
        gasClient.getBranchList().catch(() => [])
      ]);
      // 이 응답을 기다리는 사이 더 최신 요청(예: 다른 날짜 선택)이 시작됐다면 무시합니다.
      if (dailyListRequestRef.current !== requestId) return;
      const byBranch = new Map<string, DailyListRow>();
      list.forEach((item) => byBranch.set(item.branchName, item));
      branches
        .filter((branch: any) => branch?.role === "branch" && branch.branchName)
        .forEach((branch: any) => {
          if (!byBranch.has(branch.branchName)) {
            byBranch.set(branch.branchName, {
              branchName: branch.branchName,
              brand: branch.brand || branch.branchName,
              role: "branch",
              submitted: false,
              record: null
            });
          }
        });
      setDailyList(Array.from(byBranch.values()));
    } catch (e: any) {
      if (dailyListRequestRef.current !== requestId) return;
      console.error(e);
      triggerToast(e.message || "정산 리스트를 불러오지 못했습니다.", "error");
    } finally {
      if (dailyListRequestRef.current === requestId) setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdminSession) return;
    fetchDailyList();
  }, [selectedDate, user, isAdminSession]);

  const triggerToast = (message: string, type: ToastType = "success") => {
    setToast({ message, type });
  };

  // [P0-2 / Codex 리뷰 2026-07-22] 예전에는 getBranchHistory(실패를 []로 삼킴)로 훑어서, 어느 지점 조회가
  // 실패하면 그 지점 이상치가 통째로 사라지고 화면은 "해당 항목이 없습니다"로 닫혔다 —
  // '이상 없음'과 '못 읽음'이 구분되지 않았다. 서버 전용 조회 + null 센티넬로 바꿔 실패 지점을 이름으로 알린다.
  //
  // [읽기 비용 — 2026-07-23 정정] getBranchHistoryFromServer 의 month 인자는 **서버 필터가 아니다**.
  // 쿼리는 지점으로만 좁히고(firebaseDirect: dailyDocsQuery) 월은 받은 뒤 클라이언트에서 거른다.
  // 그래서 월을 넘겨도 서버 읽기량은 그대로다 — 예전 주석은 "달만 읽는다"고 잘못 적혀 있었다.
  // 대신 **지점당 한 번만 읽고 TTL 캐시**를 둔다(매출 대시보드와 같은 방식). 날짜·월을 바꿔도 다시 읽지 않는다.
  // (진짜 월 범위 쿼리는 settleDate 복합 인덱스가 필요해 별도 작업으로 둔다.)
  const loadClosingAnomalies = async () => {
    if (!isAdminSession) return;
    const requestId = ++anomalyRequestRef.current;
    try {
      setAnomalyLoading(true);
      setAnomalyLoadError(false);
      const branches = await gasClient.getBranchList();
      const targets = (Array.isArray(branches) ? branches : []).filter((branch: any) => branch?.role === "branch" && branch.branchName);
      const collected = await Promise.all(targets.map(async (branch) => {
        const cached = anomalyCacheRef.current.get(branch.branchName);
        const fresh = cached && Date.now() - cached.at < ANOMALY_CACHE_TTL_MS;
        const history = fresh
          ? cached.records
          : await gasClient.getBranchHistoryFromServer(branch.branchName).catch(() => null);
        if (history === null) return { failedBranch: branch.branchName, records: [] as any[] };
        // 새로 읽었을 때만 시각을 갱신한다(캐시 적중이면 그대로 둬야 TTL 이 제때 만료된다).
        // 지난 요청이 늦게 끝나 캐시에 쓰면 '새로고침으로 캐시를 비웠는데 옛 값이 되살아나는' 일이 생기므로,
        // 최신 요청일 때만 캐시에 넣는다(Codex 지적).
        if (!fresh && anomalyRequestRef.current === requestId) {
          anomalyCacheRef.current.set(branch.branchName, { records: history, at: Date.now() });
        }
        return { failedBranch: null, records: history.flatMap((record: any) => {
          try {
            const memoText = String(record.memo || "");
            const meta = JSON.parse(memoText.split("\n---\nMETADATA:")[1] || "{}");
            const visibleMemo = memoText.split("\n---\nMETADATA:")[0] || "";
            const section = (title: string) => {
              const match = visibleMemo.match(new RegExp("\\[" + title + "\\]\\n([\\s\\S]*?)(?=\\n\\n\\[|$)"));
              return (match?.[1] || "").trim();
            };
            const remarks = {
              staffMemo: meta.staffMemo || section("등록 저장??"),
              reviewMemo: meta.reviewMemo || section("등록 저장??"),
              otherMemo: meta.otherMemo || section("등록 저장??")
            };
            const expenses = (meta.cashExpenses || []).reduce((sum: number, item: any) => sum + (Number(item.amount) || 0), 0);
            const cashDifference = (Number(meta.cashBalance) || 0) - ((Number(meta.prevDayCash) || 0) + (Number(record.cashSales) || 0) - expenses);
            const overtime = (meta.staffRows || []).filter((staff: any) => staff.division === "정직원" && Number(staff.overtime) > 0).map((staff: any) => `${staff.name} +${staff.overtime}h`).join(", ");
            const hasRemark = Boolean(remarks.staffMemo || remarks.reviewMemo);
            const hasOtherMemo = Boolean(remarks.otherMemo);
            if (!cashDifference && !overtime && !hasRemark && !hasOtherMemo) return [];
            return [{
              branchName: branch.branchName,
              date: record.settleDate,
              writer: record.submittedBy || record.modifiedBy || "-",
              issues: [cashDifference ? "현금 차이" : "", overtime ? "초과근무" : "", hasRemark ? "특이사항" : "", hasOtherMemo ? "기타메모" : ""].filter(Boolean),
              cashDifference,
              overtime,
              reason: meta.cashDiffReason || "",
              remarks
            }];
          } catch { return []; }
        }) };
      }));
      if (anomalyRequestRef.current !== requestId) return;
      setAnomalyRecords(collected.flatMap((item) => item.records).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.branchName).localeCompare(String(b.branchName), "ko")));
      setAnomalyFailedBranches(collected.map((item) => item.failedBranch).filter((name): name is string => Boolean(name)));
    } catch (error) {
      // 지점 목록 자체를 못 읽은 경우 — 빈 표를 '이상 없음'으로 오해하지 않도록 명시한다.
      console.error("마감 이상치 로드 실패:", error);
      if (anomalyRequestRef.current !== requestId) return;
      setAnomalyRecords([]);
      setAnomalyFailedBranches([]);
      setAnomalyLoadError(true);
    } finally {
      if (anomalyRequestRef.current === requestId) setAnomalyLoading(false);
    }
  };
  // 마감 이상치는 '전일 정산현황' 탭에서 쓴다(대시보드는 전지점 매출 종합으로 바뀜, 2026-07-22).
  // 그 탭을 실제로 열 때만 읽는다. 서버 조회가 지점 전체 이력을 주므로 **날짜를 바꿔도 다시 읽지 않는다**
  // (화면 표시는 selectedDateAnomalyRecords 가 고른 날짜로 거른다). 최신값이 필요하면 '새로고침'.
  useEffect(() => {
    if (!isAdminSession) return;
    if (adminSection === "dailySettlement" && dailySettlementTab === "status" && isAdminTabAllowed(allowedAdminTabs, effectivePermKey(adminSection))) void loadClosingAnomalies();
    // 언마운트·탭 이동 뒤 도착한 응답이 상태를 건드리지 않게 요청 표식을 무효화한다(매출 대시보드와 같은 방식).
    return () => { anomalyRequestRef.current++; };
  }, [adminSection, dailySettlementTab, allowedAdminTabs, isAdminSession]);

  const loadDashboardAlerts = useCallback(async () => {
    if (!isAdminSession) return;
    // 새로고침 연타 시 늦게 끝난 이전 요청이 최신 결과를 덮지 않도록 최신 요청 표식을 쓴다
    // (dailyList/anomaly 로더와 같은 패턴 — Codex P1 2026-07-27).
    const gen = ++dashboardAlertsRequestRef.current;
    try {
      setDashboardAlertsLoading(true);
      // admin_reviewed_* 는 '마감 이력 점검' 탭의 행별 확인 버튼이 쓰던 목록이다. 그 버튼은 제거했고
      // (강조가 최근 3일 기준으로 저절로 꺼지게 바뀜) 이제 아무도 이 목록에 쓰지 않는다. 다만 예전에 확인해 둔
      // 건이 알림에 다시 뜨지 않도록 읽기는 남겨 둔다 — 알림 자체는 어제분만 세고 localStorage로 닫힌다.
      // 신규 가입 알림은 개인 관리자 세션에서만 조회한다 — PIN 관리자는 users 컬렉션 읽기 권한이 없어
      // (firestore.rules: isPersonalAdmin()만 read 허용) 그대로 부르면 permission-denied로 거부된다.
      const [editLogs, manualOvertimes, reviewedEditLogs, reviewedManualOvertimes, userProfiles, taxiRequestCount, laborContractsPendingCount, taxiAnomalyCount] = await Promise.all([
        gasClient.getEditLogs().catch(() => []),
        gasClient.getAllManualOvertimes().catch(() => []),
        gasClient.getSharedData<string[]>("admin_reviewed_edit_logs").catch(() => []),
        gasClient.getSharedData<string[]>("admin_reviewed_manual_overtimes").catch(() => []),
        // accounts 탭 권한이 없는 관리자는 화면 접근이 막혀 있으므로 신규가입 카운트를 아예 불러오지 않는다
        // (권한 있는 배지가 뜨는데 눌러도 안내만 나오면 혼란 — 사용자 지시 2026-07-25).
        user?.loginType === "personal" && isAdminTabAllowed(user.allowedAdminTabs, "accounts")
          ? listUserProfiles().catch(() => [])
          : Promise.resolve([]),
        // 법인택시 대기 신청 수 — 신청 관리 탭과 같은 지점별 공유데이터를 센다(대기만; 처리중은 이미 다른 관리자가 선점).
        // 실패는 0이 아니라 null 로 돌려 화면에 '조회 실패'를 알린다 — 지점 한 곳이라도 못 읽으면 전체를 실패로 본다
        // (일부만 세면 실제보다 적은 수가 '정상'처럼 보인다).
        isAdminTabAllowed(allowedAdminTabs, "kakaoTaxi")
          ? (async () => {
              const branches = (await gasClient.getBranchList()).filter((b: any) => b?.role === "branch" && b.branchName);
              const lists = await Promise.all(branches.map((b: any) =>
                gasClient.getSharedDataFromServer<KakaoTaxiRequest[]>(kakaoTaxiRequestsKey(b.branchName))
              ));
              return lists.flat().filter((r: any) => r?.status === "pending").length;
            })().catch(() => null)
          : Promise.resolve(0),
        // 근로계약서 발송 대기 수 — 지점이 등록한 발송대상 중 아직 '발송 대기' 상태인 건. 실패는 null(조회 실패).
        isAdminTabAllowed(allowedAdminTabs, "laborContracts")
          ? gasClient.getAllLaborContracts()
              .then((rows) => (rows || []).filter((row: any) => (row?.status || "발송 대기") === "발송 대기").length)
              .catch(() => null)
          : Promise.resolve(0),
        // 법인택시 이상 점검 대상 수 — '법인택시 > 이상 점검' 탭과 완전히 같은 계산(정규화 → 규칙 판정)을
        // 이번 달 데이터로 여기서 재현한다. 두 곳(여기·KakaoTaxiSection)이 규칙을 따로 들고 있으면 언젠가
        // 어긋나므로, 항상 helpers/kakaoTaxi·kakaoTaxiAnomaly 의 같은 순수 함수를 그대로 불러 쓴다.
        // 당월 주문 조회와 지점 목록 조회를 병렬로 쏜다 — 지점 목록은 정규화(카카오 표기→ERP 지점명) 에만
        // 쓰이고 서로 의존하지 않으므로 직렬로 기다릴 이유가 없다(다른 알림 항목들과 같은 절약 패턴).
        isAdminTabAllowed(allowedAdminTabs, "kakaoTaxi")
          ? (async () => {
              // toISOString()은 UTC 라 KST 월초 오전에 전월로 열리는 함정이 있다 — 로컬 기준으로 만든다
              // (KakaoTaxiSection 의 month 초기값과 같은 방식).
              const now = new Date();
              const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
              const [ordersRes, branches] = await Promise.all([
                gasClient.getKakaoTaxiOrders(currentMonth, user?.pinHash || ""),
                gasClient.getBranchList()
              ]);
              // 계정 중 하나라도 조회 실패(accountErrors)면 그 계정 건이 통째로 빠진 채 계산한 것이다.
              // 실제보다 적게 나온 '점검 대상 0건'은 '이상 없음'으로 오인되어 진짜 점검 대상을 놓치는
              // 사고로 이어지므로, 부분 데이터로 낸 숫자보다 명시적 조회 실패(null)가 낫다.
              if ((ordersRes.accountErrors || []).length > 0) return null;
              const branchNames = Array.from(new Set([
                ...(branches || []).map((b: any) => b.branchName).filter(Boolean),
                "본사"
              ]));
              const rows = normalizeKakaoTaxiOrders(ordersRes.orders, branchNames);
              return flagTaxiOrders(rows, DEFAULT_TAXI_THRESHOLDS).length;
            })().catch(() => null)
          : Promise.resolve(0)
      ]);
      const reviewedEditSet = new Set(Array.isArray(reviewedEditLogs) ? reviewedEditLogs : []);
      const reviewedManualSet = new Set(Array.isArray(reviewedManualOvertimes) ? reviewedManualOvertimes : []);
      const getEditReviewId = (log: any) => String(log.id || `${log.branchName || ""}:${log.settleDate || ""}:${log.modifiedAt || log.createdAt || ""}`);
      const getManualReviewId = (record: any) => String(`${record.branchName || ""}:${record.id || ""}:${record.createdAt || record.updatedAt || record.settleDate || ""}`);
      const yesterday = getYesterdayDateString();
      const editDismissed = localStorage.getItem("admin_dashboard_dismissed_edit_logs_date") === yesterday;
      const manualDismissed = localStorage.getItem("admin_dashboard_dismissed_manual_overtimes_date") === yesterday;
      const editNew = editDismissed ? [] : (editLogs || []).filter((log: any) => log.settleDate === yesterday && !reviewedEditSet.has(getEditReviewId(log)));
      const manualNew = manualDismissed ? [] : (manualOvertimes || []).filter((record: any) => record.settleDate === yesterday && !reviewedManualSet.has(getManualReviewId(record)));
      const latest = (items: any[], fields: string[]) => items.reduce((max, item) => {
        const value = fields.map((field) => item?.[field]).find(Boolean) || "";
        return String(value) > max ? String(value) : max;
      }, "");
      if (gen !== dashboardAlertsRequestRef.current) return;   // 더 새 요청이 이미 시작됨 — 결과 폐기
      setDashboardAlerts({
        editLogs: editNew.length,
        manualOvertimes: manualNew.length,
        newSignups: (userProfiles || []).filter((p: any) => !p.reviewedByAdmin).length,
        taxiRequests: taxiRequestCount,
        laborContractsPending: laborContractsPendingCount,
        taxiAnomalies: taxiAnomalyCount,
        latestEditLogAt: latest(editLogs || [], ["modifiedAt", "createdAt"]),
        latestManualOvertimeAt: latest(manualOvertimes || [], ["createdAt", "updatedAt", "settleDate"])
      });
    } finally {
      if (gen === dashboardAlertsRequestRef.current) setDashboardAlertsLoading(false);
    }
  }, [user, isAdminSession, allowedAdminTabs]);

  useEffect(() => {
    if (!isAdminSession) return;
    if (adminSection === "dashboard" && isAdminTabAllowed(allowedAdminTabs, effectivePermKey(adminSection))) void loadDashboardAlerts();
  }, [adminSection, loadDashboardAlerts, allowedAdminTabs, isAdminSession]);

  const handleDashboardAlertClick = (target: "dailyPending" | "editLogs" | "manualOvertimes" | "accounts" | "taxiRequests" | "laborContracts" | "taxiAnomalies") => {
    if (target === "dailyPending") {
      setAdminSection("dailySettlement");
      setDailySettlementTab("status");
      return;
    }
    if (target === "accounts") {
      // 확인 처리는 계정 관리 화면에서 개별 '확인 처리' 버튼으로 한다(reviewedByAdmin) — 여기서는 이동만.
      setAdminSection("accounts");
      return;
    }
    if (target === "taxiRequests") {
      // 승인/반려는 신청 관리 화면에서 처리 — 여기서는 이동만(카운트는 상태가 바뀌면 저절로 빠진다).
      setAdminSection("kakaoTaxi");
      setKakaoTaxiTab("requests");
      return;
    }
    if (target === "taxiAnomalies") {
      // 점검 처리는 이상 점검 화면에서 직접 확인 — 여기서는 이동만(카운트는 새로고침해야 갱신됨, taxiRequests와 동일 규약).
      setAdminSection("kakaoTaxi");
      setKakaoTaxiTab("anomaly");
      return;
    }
    if (target === "laborContracts") {
      setAdminSection("laborContracts");
      return;
    }
    setAdminSection("dailySettlement");
    setDailySettlementTab("logs");
    if (target === "editLogs") {
      setDailyLogsFocus("logs");
      localStorage.setItem("admin_dashboard_dismissed_edit_logs_date", getYesterdayDateString());
      setDashboardAlerts((current) => ({ ...current, editLogs: 0 }));
    } else {
      setDailyLogsFocus("manualOvertimes");
      localStorage.setItem("admin_dashboard_dismissed_manual_overtimes_date", getYesterdayDateString());
      setDashboardAlerts((current) => ({ ...current, manualOvertimes: 0 }));
    }
  };

  const brandList = useMemo(() => {
    const brands = new Set<string>();
    brands.add("전체");
    dailyList.forEach(item => {
      if (item.brand) {
        brands.add(item.brand);
      }
    });
    return Array.from(brands);
  }, [dailyList]);

  // 필터 통과한 최종 데이터 목록
  const filteredList = useMemo(() => {
    return dailyList.filter(item => {
      if (selectedBrand === "전체") return true;
      return item.brand === selectedBrand;
    });
  }, [dailyList, selectedBrand]);

  // ----------------------------------------------------
  // 상단 핵심 요약 지표 산출
  // ----------------------------------------------------
  const stats = useMemo(() => {
    const totalBranches = filteredList.length;
    const submittedCount = filteredList.filter(i => i.submitted).length;
    const pendingCount = totalBranches - submittedCount;
    
    const sumRevenue = filteredList.reduce((acc, curr) => {
      if (curr.record) {
        return acc + (curr.record.totalSales || 0);
      }
      return acc;
    }, 0);

    return {
      total: totalBranches,
      submitted: submittedCount,
      pending: pendingCount,
      revenue: sumRevenue
    };
  }, [filteredList]);

  // 이상치는 '선택한 날짜' 기준으로 본다. 예전엔 어제로 못 박혀 있어, 전일 정산현황에서 날짜를 바꿔도
  // 현금차이·기타메모만 계속 어제 것이 나왔다(같은 화면 안에서 기준일이 둘로 갈리는 문제).
  // 누적·과거 조회는 '마감 이력 점검' 탭이 담당한다.
  const selectedDateAnomalyRecords = useMemo(
    () => anomalyRecords.filter((item) => String(item.date || "") === selectedDate),
    [anomalyRecords, selectedDate]
  );

  // ----------------------------------------------------
  // 특정 지점 클릭 시 우측 드로어 상세 오픈 및 서브테이블 로드
  // ----------------------------------------------------
  const handleOpenDetail = async (row: DailyListRow) => {
    if (!row.record || !row.record.recordId) {
      triggerToast("이 지점은 아직 마감을 등록하지 않았습니다.", "warning");
      return;
    }
    
    const requestId = ++detailRequestRef.current;
    setSelectedRow(row);
    setIsDrawerOpen(true);
    setIsEditing(false);

    try {
      setDetailLoading(true);
      const res = await gasClient.getDailyDetail(row.record.recordId);
      // 응답을 기다리는 사이 다른 지점을 클릭했다면, 이전 응답으로 화면을 덮어쓰지 않습니다.
      if (detailRequestRef.current !== requestId) return;
      setDetailData(res);

      // 인라인 수정용 원본 임시 바인딩
      setEditCashSales(String(res.master.cashSales || "0"));
      setEditCardSales(String(res.master.cardSales || "0"));
      setEditTransferSales(String(res.master.transferSales || "0"));
      setEditDeliverySales(String(res.master.deliverySales || "0"));
      setEditMemo(res.master.memo || "");

    } catch (e: any) {
      if (detailRequestRef.current !== requestId) return;
      console.error(e);
      triggerToast("지점 상세 데이터를 불러오지 못했습니다.", "error");
    } finally {
      if (detailRequestRef.current === requestId) setDetailLoading(false);
    }
  };

  const handleCloseDrawer = () => {
    // 진행 중인 상세 요청을 무효화해, 닫은 뒤 늦게 온 응답이 드로어를 다시 채우지 않게 합니다.
    detailRequestRef.current++;
    setIsDrawerOpen(false);
    setSelectedRow(null);
    setDetailData(null);
    setIsEditing(false);
  };

  // ----------------------------------------------------
  // 인라인 편집 개시 및 보존 트리거
  // ----------------------------------------------------
  const handleStartEdit = () => {
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    if (detailData) {
      setEditCashSales(String(detailData.master.cashSales || "0"));
      setEditCardSales(String(detailData.master.cardSales || "0"));
      setEditTransferSales(String(detailData.master.transferSales || "0"));
      setEditDeliverySales(String(detailData.master.deliverySales || "0"));
      setEditMemo(detailData.master.memo || "");
    }
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!selectedRow?.record?.recordId || !detailData) return;
    setIsSaveConfirmOpen(false);
    setSaving(true);

    try {
      const parsedCash = parseFloat(editCashSales) || 0;
      const parsedCard = parseFloat(editCardSales) || 0;
      const parsedTransfer = parseFloat(editTransferSales) || 0;
      const parsedDelivery = parseFloat(editDeliverySales) || 0;

      const masterPayload = {
        cashSales: parsedCash,
        cardSales: parsedCard,
        transferSales: parsedTransfer,
        deliverySales: parsedDelivery,
        memo: editMemo.substring(0, 500)
      };

      const result = await gasClient.updateDaily(
        selectedRow.record.recordId,
        masterPayload,
        undefined, // 지출 상세 및 직원은 관리자 인라인 수정에서 제외 (마스터 매출 수정 최우선 요구)
        undefined,
        // 개인 로그인 계정이면 실제 이름을 남긴다. PIN 관리자 세션은 예전과 같은 "관리자" 표기를 유지한다.
        user?.loginType === "personal" ? user.name : (user?.branchName || "관리자"),
        user?.uid
      );

      triggerToast("정산 수정 내역이 성공적으로 구글 시트에 업데이트 되었습니다.", "success");
      // 본문 저장은 이미 끝났다 — 수정이력(edit_logs) 기록만 실패한 경우, 성공 토스트에 이어 알린다.
      if ((result as any)?.editLogFailed) {
        triggerToast("수정이력 기록에 실패했습니다. 저장은 완료됐습니다.", "error");
      }

      // 메인 리스트 갱신 및 드로어 내용도 반영
      await fetchDailyList();
      
      // 드로어 캡처 업데이트
      const updatedDetail = await gasClient.getDailyDetail(selectedRow.record.recordId);
      setDetailData(updatedDetail);
      setIsEditing(false);

    } catch (e: any) {
      console.error(e);
      triggerToast(e.message || "원격 데이터 저장 실패", "error");
    } finally {
      setSaving(false);
    }
  };

  // ----------------------------------------------------
  // 현재 필터링 상태 기준 데이터 XLSX 양식 출력 (SheetJS)
  // ----------------------------------------------------
  const handleDownloadExcel = async () => {
    if (filteredList.length === 0) {
      triggerToast("다운로드할 데이터가 존재하지 않습니다.", "warning");
      return;
    }

    try {
      const dataToExport = filteredList.map(row => {
        return {
          "지점명": row.branchName,
          "브랜드": row.brand,
          "제출여부": row.submitted ? "제출 완료" : "미제출",
          "실시간 총 매출 (원)": row.record ? row.record.totalSales : 0,
          "현금 매출 (원)": row.record ? row.record.cashSales : 0,
          "카드 매출 (원)": row.record ? row.record.cardSales : 0,
          "계좌이체 매출 (원)": row.record ? row.record.transferSales : 0,
          "배달 매출 (원)": row.record ? row.record.deliverySales : 0,
          "제출 시각": row.record && row.record.submittedAt ? new Date(row.record.submittedAt).toLocaleString() : "-",
          "최종 정정 시간": row.record && row.record.modifiedAt ? new Date(row.record.modifiedAt).toLocaleString() : "-",
          "최종 정정인": row.record && row.record.modifiedBy ? row.record.modifiedBy : "-",
          "특이사항 및 메모": row.record ? row.record.memo : ""
        };
      });

      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "UGD_정산조회");

      // 브라우저 다운로드 바인딩
      XLSX.writeFile(workbook, `UGD_일일마감_${selectedDate}.xlsx`);
      triggerToast("엑셀 형태의 정산 현황 다운로드를 완료했습니다.", "success");
    } catch (err) {
      console.error("Excel download fail:", err);
      triggerToast("엑셀 파일 파싱 중 예기치 못한 에러가 발생했습니다.", "error");
    }
  };

  // 관리자 세션이 아니면 아무것도 렌더하지 않는다 — 첫 프레임에 대시보드가 마운트되어
  // 하위 섹션의 데이터 로드 effect가 실행되는 것을 차단(redirect effect가 곧 이동시킴).
  if (!user || user.role !== "admin") return null;
  const designPreview = new URLSearchParams(window.location.search).get("designPreview") !== "0";

  return (
    <div className={`admin-redesign ${designPreview ? "admin-design-preview" : ""} min-h-screen bg-[#F6F5FA] flex`} id="admin-layout-wrapper">
      
      {/* 모바일 드로어 배경 — 탭하면 닫힌다 */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* PC 전전 사이드바 레이아웃 — 모바일에서는 햄버거로 여는 오버레이 드로어로 동작 */}
      <aside
        className={`${mobileSidebarOpen ? "flex fixed inset-y-0 left-0 z-50 overflow-y-auto" : "hidden"} lg:flex lg:static lg:inset-auto lg:z-auto lg:overflow-visible flex-col w-64 bg-[#1A3C6E] text-white p-6 shrink-0`}
        id="sidebar"
        role={mobileSidebarOpen ? "dialog" : undefined}
        aria-modal={mobileSidebarOpen || undefined}
        aria-label="관리자 메뉴"
      >
        <div className="mb-10 text-center py-4 border-b border-white/10 relative">
          <h2 className="text-2xl font-black tracking-widest text-[#D6E4F0]">ERP_UGD</h2>
          <p className="text-[10px] text-white/60 mt-1 uppercase font-semibold">UGD 주식회사 마감 총괄 시스템</p>
          <button
            ref={mobileSidebarCloseBtnRef}
            onClick={() => setMobileSidebarOpen(false)}
            className="lg:hidden absolute top-0 right-0 p-2 cursor-pointer"
            aria-label="메뉴 닫기"
            id="mobile-sidebar-close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav
          className="space-y-0"
          onClick={(e) => {
            // 메뉴 항목을 누르면(어느 버튼이든) 모바일 드로어를 닫는다 — 데스크톱에는 영향 없음.
            if ((e.target as HTMLElement).closest("button")) setMobileSidebarOpen(false);
          }}
        >
          <p className="ugd-nav-group">메인</p>
          <button
            onClick={() => setAdminSection("dashboard")}
            aria-current={adminSection === "dashboard" ? "page" : undefined}
            className={`ugd-nav-item${adminSection === "dashboard" ? " is-active" : ""}${!isAdminTabAllowed(allowedAdminTabs, "dashboard") ? " opacity-50" : ""}`}
          >
            대시보드
          </button>

          <p className="ugd-nav-group">일일업무</p>
          {[{ id: "status", label: "전일 정산현황" }, { id: "logs", label: "마감 이력 점검" }].map((sub) => {
            const subActive = adminSection === "dailySettlement" && dailySettlementTab === sub.id;
            return (
              <button
                key={sub.id}
                onClick={() => { setAdminSection("dailySettlement"); setDailySettlementTab(sub.id as "status" | "logs"); setDailyLogsFocus(null); }}
                aria-current={subActive ? "page" : undefined}
                className={`ugd-nav-item${subActive ? " is-active" : ""}${!isAdminTabAllowed(allowedAdminTabs, "dailySettlement") ? " opacity-50" : ""}`}
              >
                {sub.label}
              </button>
            );
          })}

          <p className="ugd-nav-group">월말업무</p>
          {[{ id: "status", label: "제출현황" }, { id: "cashManagement", label: "현금관리" }, { id: "cashExpenses", label: "현금지출" }].map((sub) => {
            const subActive = adminSection === "monthlyClosing" && monthlyClosingTab === sub.id;
            return (
              <button
                key={sub.id}
                onClick={() => { setAdminSection("monthlyClosing"); setMonthlyClosingTab(sub.id as "status" | "cashManagement" | "cashExpenses"); }}
                aria-current={subActive ? "page" : undefined}
                className={`ugd-nav-item${subActive ? " is-active" : ""}${!isAdminTabAllowed(allowedAdminTabs, "monthlyClosing") ? " opacity-50" : ""}`}
              >
                {sub.label}
              </button>
            );
          })}

          <p className="ugd-nav-group">분석</p>
          {[{ id: "summary", label: "손익 종합" }, { id: "charts", label: "손익 차트" }, { id: "branch", label: "지점 손익계산서" }].map((sub) => {
            const subActive = adminSection === "analysis" && analysisTab === sub.id;
            return (
              <button
                key={sub.id}
                onClick={() => { setAdminSection("analysis"); setAnalysisTab(sub.id as "summary" | "charts" | "branch"); }}
                aria-current={subActive ? "page" : undefined}
                className={`ugd-nav-item${subActive ? " is-active" : ""}${!isAdminTabAllowed(allowedAdminTabs, "analysis") ? " opacity-50" : ""}`}
              >
                {sub.label}
              </button>
            );
          })}

          <p className="ugd-nav-group">인사</p>
          <button
            onClick={() => setAdminSection("laborContracts")}
            aria-current={adminSection === "laborContracts" ? "page" : undefined}
            className={`ugd-nav-item${adminSection === "laborContracts" ? " is-active" : ""}${!isAdminTabAllowed(allowedAdminTabs, "laborContracts") ? " opacity-50" : ""}`}
          >
            근로계약서 발송 현황
          </button>
          <button
            onClick={() => setAdminSection("annualLeave")}
            aria-current={adminSection === "annualLeave" ? "page" : undefined}
            className={`ugd-nav-item${adminSection === "annualLeave" ? " is-active" : ""}${!isAdminTabAllowed(allowedAdminTabs, "annualLeave") ? " opacity-50" : ""}`}
          >
            연차관리
          </button>
          <button
            onClick={() => setAdminSection("salaryChanges")}
            aria-current={adminSection === "salaryChanges" ? "page" : undefined}
            className={`ugd-nav-item${adminSection === "salaryChanges" ? " is-active" : ""}${!isAdminTabAllowed(allowedAdminTabs, "salaryChanges") ? " opacity-50" : ""}`}
          >
            급여 변동 이력
          </button>
          <button
            onClick={() => setAdminSection("accounts")}
            aria-current={adminSection === "accounts" ? "page" : undefined}
            className={`ugd-nav-item${adminSection === "accounts" ? " is-active" : ""}${!isAdminTabAllowed(allowedAdminTabs, "accounts") ? " opacity-50" : ""}`}
          >
            계정 관리
          </button>

          <p className="ugd-nav-group">법인택시</p>
          {[{ id: "orders", label: "이용내역" }, { id: "anomaly", label: "이상 점검" }, { id: "requests", label: "신청 관리" }, { id: "members", label: "직원 관리" }].map((sub) => {
            const subActive = adminSection === "kakaoTaxi" && kakaoTaxiTab === sub.id;
            return (
              <button
                key={sub.id}
                onClick={() => { setAdminSection("kakaoTaxi"); setKakaoTaxiTab(sub.id as KakaoTaxiView); }}
                aria-current={subActive ? "page" : undefined}
                className={`ugd-nav-item${subActive ? " is-active" : ""}${!isAdminTabAllowed(allowedAdminTabs, "kakaoTaxi") ? " opacity-50" : ""}`}
              >
                {sub.label}
              </button>
            );
          })}

          <p className="ugd-nav-group">이동</p>
          <button
            onClick={() => navigate("/branch-confirm")}
            className="ugd-nav-item"
          >
            지점 대시보드
          </button>
        </nav>

        {/* 보안 로그아웃 — 메뉴 바로 아래(지점 하단처럼 어두운 버튼) */}
        <div className="mt-6">
          <button onClick={logout} className="admin-sidebar-logout w-full">
            보안 로그아웃
          </button>
        </div>
      </aside>

      {/* 실시간 콘텐츠 영역 */}
      <div className="grow flex flex-col min-w-0" id="admin-main-container">
        
        {/* 모바일 대형 헤더 */}
        <header className="admin-mobile-header lg:hidden bg-[#1A3C6E] text-white px-4 py-4 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="p-1.5 -ml-1 cursor-pointer"
              aria-label="메뉴 열기"
              id="mobile-btn-open-sidebar"
            >
              <Menu className="w-6 h-6" />
            </button>
            <div className="flex flex-col">
              <span className="text-lg font-black tracking-wider text-white">ERP_UGD</span>
              <span className="text-[10px] text-white/75">본사 총괄 대시보드</span>
            </div>
          </div>

          <button
            onClick={logout}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            id="mobile-btn-logout"
          >
            <LogOut className="w-3.5 h-3.5" />
            로그아웃
          </button>
        </header>

        <main className="grow p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto w-full">
          {!sectionAllowed && (
            <div className="flex flex-col items-center justify-center py-24 gap-2">
              <p className="text-sm font-bold text-zinc-600">접근 권한이 없는 화면입니다.</p>
              <p className="text-xs text-zinc-400">다른 관리자에게 권한을 요청해 주세요.</p>
            </div>
          )}

          {sectionAllowed && adminSection === "dashboard" && (
            <>
              <section className="admin-hero-panel">
                <div>
                  <p className="admin-kicker">UGD Finance Control</p>
                  <AdminLatestNoticeHeadline />
                </div>
                <div className="admin-hero-actions">
                  <span><Calendar className="w-4 h-4" /> {getTodayDateString()}</span>
                </div>
              </section>

              {/* 새로 확인할 항목 + 공지 등록을 맨 위로, 매출 종합은 아래로(사용자 지시 2026-07-27) —
                  관리자가 접속하자마자 처리할 일(가입승인·법인택시·근로계약서 등)부터 보이게. */}
              <div className="admin-dashboard-compact-grid">
                <AdminDashboardAlertHub
                  pendingDailyCount={stats.pending}
                  alerts={dashboardAlerts}
                  loading={dashboardAlertsLoading}
                  onRefresh={() => void loadDashboardAlerts()}
                  onOpen={handleDashboardAlertClick}
                />
                <AdminNoticeManager />
              </div>

              {/* 전지점 매출 종합. 예전 KPI 4칸(미제출·현금차이·기타메모·월말마감)과
                  마감현황 표는 전부 '전일' 성격이라 전일 정산현황 탭으로 옮겼다(2026-07-22). */}
              <AdminSalesOverviewSection />

            </>
          )}

          {sectionAllowed && adminSection === "analysis" && (
            <section className="space-y-5 animate-fade-in">
              {/* 모바일은 사이드바가 없어 여기서 하위탭을 고른다(전일정산·월말 탭과 같은 패턴). */}
              <div className="flex gap-2 border-b border-gray-200 lg:hidden">
                {[{ id: "summary", label: "손익 종합" }, { id: "charts", label: "손익 차트" }, { id: "branch", label: "지점 손익계산서" }].map((sub) => (
                  <button key={sub.id} onClick={() => setAnalysisTab(sub.id as "summary" | "charts" | "branch")}
                    className={`px-4 py-3 text-sm font-bold border-b-2 ${analysisTab === sub.id ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>
                    {sub.label}
                  </button>
                ))}
              </div>
              <AdminAnalysisSection view={analysisTab} />
            </section>
          )}

          {sectionAllowed && adminSection === "annualLeave" && <AdminAnnualLeaveSection />}

          {sectionAllowed && adminSection === "salaryChanges" && <SalaryChangeHistoryTab />}

          {sectionAllowed && adminSection === "accounts" && (
            <AccountManagementSection currentUid={user?.loginType === "personal" ? user.uid : undefined} />
          )}

          {sectionAllowed && adminSection === "kakaoTaxi" && (
            <section className="space-y-5 animate-fade-in">
              {/* 모바일은 사이드바가 없어 여기서 하위탭을 고른다(분석 탭과 같은 패턴). */}
              <div className="flex gap-2 border-b border-gray-200 lg:hidden">
                {/* 다른 탭들의 모바일 하위탭은 text-sm 이지만, 신규 화면은 §6-0-1 폰트 기준표(버튼 11px/900)를 따른다.
                    기존 탭들은 다음에 손볼 때 함께 11px 로 맞춘다(§9 의 12px 레거시와 같은 취급). */}
                {[{ id: "orders", label: "이용내역" }, { id: "anomaly", label: "이상 점검" }, { id: "requests", label: "신청 관리" }, { id: "members", label: "직원 관리" }].map((sub) => (
                  <button key={sub.id} onClick={() => setKakaoTaxiTab(sub.id as KakaoTaxiView)}
                    className={`px-4 py-3 text-[11px] font-black border-b-2 ${kakaoTaxiTab === sub.id ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>
                    {sub.label}
                  </button>
                ))}
              </div>
              <KakaoTaxiSection view={kakaoTaxiTab} />
            </section>
          )}

          {sectionAllowed && adminSection === "dailySettlement" && (
            <section className="admin-daily-settlement-section space-y-5 animate-fade-in">
              <div className="flex gap-2 border-b border-gray-200 lg:hidden">
                <button onClick={() => setDailySettlementTab("status")} className={`px-4 py-3 text-sm font-bold border-b-2 ${dailySettlementTab === "status" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>전일 정산현황</button>
                <button onClick={() => { setDailySettlementTab("logs"); setDailyLogsFocus(null); }} className={`px-4 py-3 text-sm font-bold border-b-2 ${dailySettlementTab === "logs" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>마감 이력 점검</button>
              </div>
              {dailySettlementTab === "status" ? (
                <AdminDailySettlementStatusSection
                  selectedDate={selectedDate}
                  setSelectedDate={setSelectedDate}
                  selectedBrand={selectedBrand}
                  setSelectedBrand={setSelectedBrand}
                  brandList={brandList}
                  stats={stats}
                  loading={loading}
                  filteredList={filteredList}
                  handleDownloadExcel={handleDownloadExcel}
                  handleOpenDetail={handleOpenDetail}
                  anomalyRecords={selectedDateAnomalyRecords}
                  anomalyLoading={anomalyLoading}
                  anomalyFailedBranches={anomalyFailedBranches}
                  anomalyLoadError={anomalyLoadError}
                  closingView={closingView}
                  setClosingView={setClosingView}
                  reloadAnomalies={() => { anomalyCacheRef.current.clear(); void loadClosingAnomalies(); }}
                />
              ) : <AdminModificationLogsSection focusSection={dailyLogsFocus} />}
            </section>
          )}

          {sectionAllowed && adminSection === "monthlyClosing" && (
            <section className="space-y-5 animate-fade-in">
              <div className="flex gap-2 border-b border-gray-200 lg:hidden">
                <button onClick={() => setMonthlyClosingTab("status")} className={`px-4 py-3 text-sm font-bold border-b-2 ${monthlyClosingTab === "status" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>제출현황</button>
                <button onClick={() => setMonthlyClosingTab("cashManagement")} className={`px-4 py-3 text-sm font-bold border-b-2 ${monthlyClosingTab === "cashManagement" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>현금관리</button>
                <button onClick={() => setMonthlyClosingTab("cashExpenses")} className={`px-4 py-3 text-sm font-bold border-b-2 ${monthlyClosingTab === "cashExpenses" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>현금지출</button>
              </div>
              {monthlyClosingTab === "status" && <AdminMonthlyClosingStatusSection />}
              {monthlyClosingTab === "cashManagement" && <AdminCashManagementSection fixedTab="cashManagement" />}
              {monthlyClosingTab === "cashExpenses" && <AdminCashManagementSection fixedTab="cashExpenses" />}
            </section>
          )}

          {sectionAllowed && adminSection === "modificationLogs" && <AdminModificationLogsSection />}

          {sectionAllowed && adminSection === "laborContracts" && <AdminLaborContractsSection />}

        </main>
      </div>

      {/* ----------------------------------------------------
          [우측 슬라이드인 드로어 상세정보]
         ---------------------------------------------------- */}
      <AnimatePresence>
        {isDrawerOpen && selectedRow && (
          <div 
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end"
            id="drawer-backdrop"
          >
            {/* 백드롭 클릭 시 닫기 */}
            <div className="absolute inset-0 cursor-pointer" onClick={handleCloseDrawer} />

            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.3 }}
              className="relative w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col z-10 overflow-hidden"
              id="drawer-container"
            >
              {/* 드로어 헤더 */}
              <div className="p-6 bg-[#1A3C6E] text-white flex items-center justify-between shrink-0">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-[#D6E4F0]">정산 일자: {selectedRow.record?.settleDate}</span>
                  <h3 className="text-xl font-extrabold tracking-tight">{selectedRow.branchName} 상세 내역</h3>
                </div>
                <button
                  onClick={handleCloseDrawer}
                  className="p-2 hover:bg-white/10 rounded-full transition-all cursor-pointer text-white/80 hover:text-white"
                  title="닫기"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 드로어 스크롤 바디 */}
              <div className="grow overflow-y-auto p-6 space-y-6" id="drawer-scroll-body">
                {detailLoading ? (
                  <div className="h-64 flex flex-col items-center justify-center gap-3">
                    <LoadingSpinner />
                    <span className="text-xs text-gray-400 font-bold">영격 상세 데이터를 수집 중입니다...</span>
                  </div>
                ) : detailData ? (
                  <>
                    {/* [드로어 1] 매출 및 수정 로그 */}
                    <div className="bg-[#D6E4F0]/20 p-5 rounded-2xl border border-[#D6E4F0] space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-[#1A3C6E] tracking-wider uppercase">최종 정산 합계</span>
                        <div className="flex gap-2">
                          {!isEditing ? (
                            <button
                              onClick={handleStartEdit}
                              className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-gray-50 text-gray-600 border border-gray-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                              id="btn-drawer-edit"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-[#2E6DB4]" /> 편집
                            </button>
                          ) : (
                            <div className="flex gap-1.5">
                              <button
                                onClick={handleCancelEdit}
                                className="px-3 py-1 bg-white hover:bg-gray-100 text-gray-500 text-xs font-semibold border rounded-lg cursor-pointer"
                              >
                                취소
                              </button>
                              <button
                                onClick={() => setIsSaveConfirmOpen(true)}
                                className="flex items-center gap-1 px-3 py-1 bg-[#2E6DB4] hover:bg-[#1A3C6E] text-white text-xs font-semibold rounded-lg cursor-pointer"
                              >
                                <Save className="w-3.5 h-3.5" /> 저장
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 인라인 수정 분기 처리 */}
                      {isEditing ? (
                        <div className="space-y-3.5 bg-white p-4 rounded-xl border border-dashed border-[#2E6DB4]">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <span className="text-[11px] font-bold text-gray-400 block">현금 매출 *</span>
                              <NumberInput
                                value={editCashSales}
                                onChange={setEditCashSales}
                                id="edit-cash-sales"
                              />
                            </div>
                            <div className="space-y-1">
                              <span className="text-[11px] font-bold text-gray-400 block">카드 매출 *</span>
                              <NumberInput
                                value={editCardSales}
                                onChange={setEditCardSales}
                                id="edit-card-sales"
                              />
                            </div>
                            <div className="space-y-1">
                              <span className="text-[11px] font-bold text-gray-400 block">계좌이체 매출</span>
                              <NumberInput
                                value={editTransferSales}
                                onChange={setEditTransferSales}
                                id="edit-transfer-sales"
                              />
                            </div>
                            <div className="space-y-1">
                              <span className="text-[11px] font-bold text-gray-400 block">배달 매출</span>
                              <NumberInput
                                value={editDeliverySales}
                                onChange={setEditDeliverySales}
                                id="edit-delivery-sales"
                              />
                            </div>
                          </div>
                          
                          <div className="space-y-1 pt-1.5">
                            <span className="text-[11px] font-bold text-gray-400 block">특이사항 메모 수정</span>
                            <textarea
                              rows={3}
                              value={editMemo}
                              onChange={(e) => setEditMemo(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-200 text-sm text-gray-700 rounded-lg outline-hidden focus:border-[#2E6DB4] resize-none"
                            />
                          </div>
                        </div>
                      ) : (
                        /* 단순 정보 출력 화면 */
                        <div className="divide-y divide-[#D6E4F0] font-mono text-sm space-y-1">
                          <div className="flex justify-between py-2 items-center">
                            <span className="text-gray-500 font-sans font-semibold">현금 매출</span>
                            <span className="font-bold text-[#2C3E50]">{formatNumber(detailData.master.cashSales)} 원</span>
                          </div>
                          <div className="flex justify-between py-2 items-center">
                            <span className="text-gray-500 font-sans font-semibold">카드 매출</span>
                            <span className="font-bold text-[#2C3E50]">{formatNumber(detailData.master.cardSales)} 원</span>
                          </div>
                          <div className="flex justify-between py-2 items-center">
                            <span className="text-gray-500 font-sans font-semibold">계좌이체 매출</span>
                            <span className="font-bold text-gray-600">{formatNumber(detailData.master.transferSales || 0)} 원</span>
                          </div>
                          <div className="flex justify-between py-2 items-center">
                            <span className="text-gray-500 font-sans font-semibold">배달 주문 매출</span>
                            <span className="font-bold text-gray-600">{formatNumber(detailData.master.deliverySales || 0)} 원</span>
                          </div>
                          <div className="flex justify-between py-3 items-center text-base border-t border-[#D6E4F0]">
                            <span className="text-[#1A3C6E] font-sans font-extrabold text-sm">실시간 매출 합산</span>
                            <span className="font-black text-[#1A3C6E]">{formatNumber(detailData.master.totalSales)} 원</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* [드로어 2] 현금 및 카드 지출 배열 상세 */}
                    <div className="space-y-4">
                      <h4 className="text-sm font-extrabold text-gray-600 border-l-4 border-[#2E6DB4] pl-2">당일 기록 지출 목록</h4>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* 현금 지출 내역 목록 */}
                        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                          <span className="text-xs font-bold text-gray-400 block mb-3">금고 현금 지출</span>
                          {detailData.expenses.filter(e => e.expenseType === "현금지출").length === 0 ? (
                            <p className="text-xs text-gray-400 py-3 text-center">등록된 현금 지출 없음</p>
                          ) : (
                            <ul className="space-y-2 max-h-48 overflow-y-auto">
                              {detailData.expenses.filter(e => e.expenseType === "현금지출").map((e, idx) => (
                                <li key={idx} className="flex justify-between items-center text-xs text-gray-600 py-1 border-b border-gray-100 font-mono">
                                  <span className="font-sans font-medium text-gray-500 truncate max-w-[120px]" title={e.itemName}>{e.itemName}</span>
                                  <span className="font-bold text-red-500">-{formatNumber(e.amount)}원</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        {/* 카드 지출 내역 목록 */}
                        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                          <span className="text-xs font-bold text-gray-400 block mb-3">법인 카드 지출</span>
                          {detailData.expenses.filter(e => e.expenseType === "카드지출").length === 0 ? (
                            <p className="text-xs text-gray-400 py-3 text-center">등록된 카드 지출 없음</p>
                          ) : (
                            <ul className="space-y-2 max-h-48 overflow-y-auto">
                              {detailData.expenses.filter(e => e.expenseType === "카드지출").map((e, idx) => (
                                <li key={idx} className="flex justify-between items-center text-xs text-gray-600 py-1 border-b border-gray-100 font-mono">
                                  <span className="font-sans font-medium text-gray-500 truncate max-w-[120px]" title={e.itemName}>{e.itemName}</span>
                                  <span className="font-bold text-orange-500">-{formatNumber(e.amount)}원</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* [드로어 3] 투입 인력 및 총 시간 */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-extrabold text-gray-600 border-l-4 border-[#2E6DB4] pl-2">당일 업무 투입 정원</h4>
                      <div className="p-4 bg-gray-50 border border-gray-100 rounded-2xl">
                        {detailData.staff.length === 0 ? (
                          <p className="text-xs text-gray-400 py-3 text-center">외근 및 근무 투입 기록 없음</p>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {detailData.staff.map((st, idx) => (
                              <div key={idx} className="bg-white px-3.5 py-2.5 rounded-xl border border-gray-100 flex justify-between items-center text-xs font-mono">
                                <span className="font-sans text-gray-500 font-semibold">{st.staffName}</span>
                                <span className="text-[#2E6DB4] font-bold">{st.workHours}H</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* [드로어 4] 특이사항 메모 본문 */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-extrabold text-gray-600 border-l-4 border-[#2E6DB4] pl-2">전달된 특이사항 메모</h4>
                      <div className="p-4 bg-rose-50/30 border border-rose-100/50 rounded-2xl block text-sm text-gray-600 leading-relaxed min-h-[80px]">
                        {detailData.master.memo ? detailData.master.memo : <span className="text-gray-400 text-xs italic">추가 기재된 특이 상이 존재하지 않습니다.</span>}
                      </div>
                    </div>

                    {/* [드로어 5] 연동 제어 기록 및 메타 */}
                    <div className="pt-4 border-t border-gray-100 space-y-1.5 text-[11px] text-gray-400 font-medium">
                      <div className="flex justify-between">
                        <span>제출 시간</span>
                        <span>{new Date(detailData.master.submittedAt || "").toLocaleString()}</span>
                      </div>
                      {detailData.master.modifiedAt && (
                        <div className="flex justify-between text-yellow-600 font-bold">
                          <span>최종 수정 보고: {detailData.master.modifiedBy}</span>
                          <span>{new Date(detailData.master.modifiedAt).toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-center text-xs text-gray-400 py-12">데이터를 불러오지 못했습니다.</p>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 공통 알람 및 모달창 백그라운드 구동 */}
      <AnimatePresence>
        {toast && (
          <ToastMessage
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </AnimatePresence>

      <ConfirmModal
        isOpen={isSaveConfirmOpen}
        title="마감 데이터 직접 수정 승인"
        message="지점의 마감 정산액을 고의 정정하시겠습니까? 구글 시트에 업데이트되며, 정정 사항이 수정_로그 시트에 자동으로 추적 기록되어 저장됩니다."
        confirmText="정산 저장"
        cancelText="돌아가기"
        type="warning"
        onConfirm={handleSaveEdit}
        onCancel={() => setIsSaveConfirmOpen(false)}
      />

      {saving && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-xs flex items-center justify-center z-[60]">
          <div className="bg-white px-8 py-6 rounded-2xl shadow-xl flex flex-col items-center gap-3">
            <LoadingSpinner size="lg" />
            <span className="text-xs text-gray-500 font-bold">구글 스프레드시트 업데이트 및 정정 로그 기록 중...</span>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminLatestNoticeHeadline() {
  const [notices, setNotices] = useState<any[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const saved = await gasClient.getSharedData<any[]>("admin_dashboard_notices").catch(() => []);
    setNotices(Array.isArray(saved) ? saved.filter((notice) => notice?.title || notice?.body) : []);
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener("admin_dashboard_notices_updated", load);
    return () => window.removeEventListener("admin_dashboard_notices_updated", load);
  }, [load]);

  if (notices.length === 0) {
    return <h1>등록된 관리자 공지사항이 없습니다.</h1>;
  }

  const latest = notices[0];

  return (
    <div className="admin-latest-notice-headline">
      <button type="button" onClick={() => setOpen((current) => !current)}>
        <h1>{latest.title}</h1>
      </button>
      {open && (
        <div className="admin-registered-notices rounded-2xl border border-gray-100 p-4 space-y-2">
          {notices.slice(0, 3).map((notice) => (
            <div key={notice.id} className="admin-notice-item flex items-start justify-between gap-3 rounded-xl border border-slate-100 p-3">
              <div>
                <p className="text-sm font-black text-gray-800">{notice.title}</p>
                <p className="text-xs text-gray-500 mt-1">{notice.body}</p>
              </div>
              <span className="rounded-full px-2 py-1 text-[10px] font-black">관리자 공지</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminNoticeManager() {
  const [notices, setNotices] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [noticeTab, setNoticeTab] = useState<"admin" | "branch">("branch");
  const [targetBranch, setTargetBranch] = useState("전체");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingNoticeId, setEditingNoticeId] = useState<string | null>(null);
  const noticeStorageKey = noticeTab === "admin" ? "admin_dashboard_notices" : "admin_notices";
  // 지금 화면이 어느 공지함인지. 저장이 실패해 되돌릴 때, 그 사이 탭이 바뀌지 않았는지 확인하는 데 쓴다
  // (관리자 공지 화면에 지점 공지 목록을 되돌려 놓으면, 다음 저장 때 그 목록이 엉뚱한 키로 저장된다).
  //
  // **렌더 단계에서 갱신한다. useEffect로 미루면 안 된다** — effect는 그려진 뒤에 도는데,
  // 탭을 바꾼 직후 effect가 아직 돌지 않은 그 틈에 옛 탭의 저장이 실패하면 이 값이 아직 옛 키라
  // 가드를 그대로 통과해 새 탭 화면에 옛 목록을 덮어쓴다.
  // (연차관리도 같은 이유로 지점 전환 감지를 effect가 아닌 렌더 단계에서 한다 — 커밋 1246795)
  const noticeKeyRef = useRef(noticeStorageKey);
  noticeKeyRef.current = noticeStorageKey;

  const load = useCallback(async () => {
    const [saved, branchList] = await Promise.all([
      gasClient.getSharedData<any[]>(noticeStorageKey).catch(() => []),
      gasClient.getBranchList().catch(() => [])
    ]);
    setNotices(Array.isArray(saved) ? saved : []);
    setBranches(Array.isArray(branchList) ? branchList : []);
  }, [noticeStorageKey]);

  useEffect(() => {
    void load();
    setEditingNoticeId(null);
    setTitle("");
    setBody("");
  }, [load]);

  /**
   * 공지 저장.
   *
   * 저장 한 번은 클라우드를 세 번 오간다(기존 값 읽기 → 백업 쓰기 → 실제 쓰기).
   * 그걸 다 기다린 뒤에 화면을 바꾸면 등록 버튼이 한참 멈춘 것처럼 보인다.
   * 그래서 화면은 먼저 바꾸고 저장은 뒤에서 돌린다 — 백업 단계는 손대지 않는다.
   * (백업은 덮어쓰기 전의 옛 값을 읽어야 하므로 기다리지 않게 만들면 새 값이 백업될 수 있다.)
   *
   * 실패하면 목록을 되돌리고 **쓰던 글을 그대로 되살린다.** 예전에는 catch가 아예 없어서
   * 저장이 실패해도 아무 말이 없었다 — 등록된 줄 알고 지나가면 그 공지는 어디에도 없다.
   */
  const saveNotice = async () => {
    if (!title.trim() && !body.trim()) return;
    const now = new Date().toISOString();
    const next = editingNoticeId
      ? notices.map((notice) => notice.id === editingNoticeId ? { ...notice, targetBranch, title: title.trim() || "공지사항", body: body.trim(), updatedAt: now } : notice)
      : [{ id: `notice-${Date.now()}`, targetBranch, title: title.trim() || "공지사항", body: body.trim(), createdAt: now }, ...notices].slice(0, 20);
    // 실패했을 때 되살릴 것들
    const previousNotices = notices;
    const draft = { editingNoticeId, targetBranch, title, body };

    const keyAtStart = noticeStorageKey;

    setNotices(next);
    setEditingNoticeId(null);
    setTitle("");
    setBody("");
    setSaving(true);
    try {
      await gasClient.saveSharedData(keyAtStart, next);
      // 대시보드 갱신은 저장이 끝난 뒤에 알린다. 먼저 알리면 대시보드가 아직 옛 값이 든
      // 서버를 다시 읽어 새 공지가 없는 것처럼 보인다.
      if (keyAtStart === "admin_dashboard_notices") window.dispatchEvent(new Event("admin_dashboard_notices_updated"));
    } catch (error) {
      console.error("공지 저장 실패:", error);
      // 저장하는 사이 다른 공지함으로 옮겨갔다면 화면을 건드리지 않는다 —
      // 지금 보이는 목록은 다른 공지함의 것이라, 되돌리면 남의 목록을 덮어쓴다.
      // (탭을 옮기면 입력창은 이미 비워지므로 되살릴 초안도 없다.)
      const restored = noticeKeyRef.current === keyAtStart;
      if (restored) {
        setNotices(previousNotices);
        setEditingNoticeId(draft.editingNoticeId);
        setTargetBranch(draft.targetBranch);
        setTitle(draft.title);
        setBody(draft.body);
      }
      // 되살리지 못했으면 되살렸다고 말하지 않는다. 저장 중 탭 전환은 위에서 막았으므로
      // 여기 걸릴 일은 거의 없지만, 안내가 사실과 달라지는 쪽으로는 절대 두지 않는다.
      window.alert(restored
        ? "공지 저장에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 등록해 주세요.\n\n작성하신 내용은 그대로 두었습니다."
        : `공지 저장에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 등록해 주세요.\n\n[작성하신 내용]\n제목: ${draft.title}\n내용: ${draft.body}`);
    } finally {
      setSaving(false);
    }
  };

  const startEditNotice = (notice: any) => {
    setEditingNoticeId(notice.id);
    setTargetBranch(notice.targetBranch || "전체");
    setTitle(notice.title || "");
    setBody(notice.body || notice.content || "");
  };

  const cancelEditNotice = () => {
    setEditingNoticeId(null);
    setTitle("");
    setBody("");
    setTargetBranch("전체");
  };

  /** 저장과 같은 규칙 — 화면에서 먼저 지우고, 실패하면 되돌리고 알린다. */
  const deleteNotice = async (id: string) => {
    if (!window.confirm("공지사항을 삭제할까요?")) return;
    const previousNotices = notices;
    const next = notices.filter((notice) => notice.id !== id);
    const keyAtStart = noticeStorageKey;
    setNotices(next);
    setSaving(true);
    try {
      await gasClient.saveSharedData(keyAtStart, next);
      if (keyAtStart === "admin_dashboard_notices") window.dispatchEvent(new Event("admin_dashboard_notices_updated"));
    } catch (error) {
      console.error("공지 삭제 실패:", error);
      // 저장과 같은 이유 — 그 사이 공지함을 옮겼으면 지금 화면을 건드리지 않는다.
      if (noticeKeyRef.current === keyAtStart) setNotices(previousNotices);
      window.alert("공지 삭제에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-notice-manager bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
      <div>
        <h2 className="text-lg font-black text-[#2C3E50]">공지사항</h2>
        <p className="text-xs text-gray-400 mt-1">여기에 작성한 공지는 각 지점 대시보드 첫 화면에 표시됩니다.</p>
      </div>
      <div className="flex rounded-xl bg-slate-100 p-1 w-fit">
        {/* 저장하는 동안은 공지함을 옮기지 못하게 막는다.
            옮겨 버리면 탭 전환이 입력창을 비우는데, 그 사이 저장이 실패해도 되살릴 곳이 없어
            애써 쓴 글이 사라진다(그러면서 "그대로 두었다"고 알리게 된다 — 거짓말이 된다).
            저장은 1초 안쪽이라 잠깐 잠기는 것이 글을 잃는 것보다 낫다. */}
        <button onClick={() => setNoticeTab("admin")} disabled={saving} className={`admin-notice-tab admin-notice-tab-admin px-3 py-1.5 rounded-lg text-xs font-black disabled:opacity-50 disabled:cursor-not-allowed ${noticeTab === "admin" ? "is-active shadow-sm" : "text-gray-500"}`}>관리자 공지</button>
        <button onClick={() => setNoticeTab("branch")} disabled={saving} className={`admin-notice-tab admin-notice-tab-branch px-3 py-1.5 rounded-lg text-xs font-black disabled:opacity-50 disabled:cursor-not-allowed ${noticeTab === "branch" ? "is-active shadow-sm" : "text-gray-500"}`}>공지사항</button>
      </div>
      <div className="admin-notice-form space-y-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-3">
          <select value={targetBranch} onChange={(e) => setTargetBranch(e.target.value)} disabled={noticeTab === "admin"} className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold bg-white disabled:bg-gray-100 disabled:text-gray-400">
            <option value="전체">전체공지</option>
            {branches.map((branch) => <option key={branch.branchName} value={branch.branchName}>{branch.branchName}</option>)}
          </select>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="공지 제목" className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold bg-white" />
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="공지 내용" rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold resize-y min-h-[88px] bg-white leading-relaxed" />
        <div className="flex justify-end">
          {editingNoticeId && (
            <button onClick={cancelEditNotice} disabled={saving} className="px-5 py-3 bg-white text-gray-600 border border-gray-200 rounded-xl text-xs font-black disabled:opacity-50">
              수정 취소
            </button>
          )}
          <button onClick={() => void saveNotice()} disabled={saving} className="min-w-[160px] px-5 py-3 bg-[#2E6DB4] text-white rounded-xl text-xs font-black disabled:opacity-50">{saving ? "저장 중…" : editingNoticeId ? "공지 수정" : "공지 등록"}</button>
        </div>
      </div>
      {notices.length > 0 ? (
        <div className="space-y-2">
          {notices.slice(0, 3).map((notice) => (
            <div key={notice.id} className="admin-notice-item flex items-start justify-between gap-3 rounded-xl bg-slate-50 border border-slate-100 p-3">
              <div>
                <p className="text-sm font-black text-gray-800">{notice.title} <span className="ml-2 rounded bg-blue-50 px-2 py-0.5 text-[10px] text-[#2E6DB4]">{notice.targetBranch || "전체"}</span></p>
                <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{notice.body}</p>
              </div>
              {/* 저장이 도는 동안은 잠근다.
                  공지 저장은 목록 "전체"를 한 덩어리로 덮어쓴다. 화면이 즉시 반응하니 연달아 누르기 쉬운데,
                  그러면 두 요청이 동시에 날아가고 늦게 도착한 쪽이 옛 목록으로 덮어써서
                  지운 공지가 다른 노트북에 되살아난다. 한 번에 하나씩만 보낸다. */}
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => startEditNotice(notice)} disabled={saving} className="text-xs font-black text-[#2E6DB4] disabled:opacity-40 disabled:cursor-not-allowed">수정</button>
                <button onClick={() => void deleteNotice(notice.id)} disabled={saving} className="text-xs font-black text-rose-600 disabled:opacity-40 disabled:cursor-not-allowed">삭제</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="admin-notice-empty rounded-xl border border-slate-100 p-3 text-xs font-bold text-gray-500">
          등록된 {noticeTab === "admin" ? "관리자 공지" : "공지사항"}이 없습니다.
        </div>
      )}
    </section>
  );
}

function AdminDashboardAlertHub({
  pendingDailyCount,
  alerts,
  loading,
  onRefresh,
  onOpen
}: {
  pendingDailyCount: number;
  alerts: { editLogs: number; manualOvertimes: number; newSignups: number; taxiRequests: number | null; laborContractsPending: number | null; taxiAnomalies: number | null };
  loading: boolean;
  onRefresh: () => void;
  onOpen: (target: "dailyPending" | "editLogs" | "manualOvertimes" | "accounts" | "taxiRequests" | "laborContracts" | "taxiAnomalies") => void;
}) {
  // null = 조회 실패 — 합계에선 빼되 아래에서 별도 경고를 띄운다(0건 '이상 없음'으로 오도 금지).
  const failedCounts = [
    ...(alerts.taxiRequests === null ? ["법인택시 신청"] : []),
    ...(alerts.laborContractsPending === null ? ["근로계약서 발송 요청"] : []),
    ...(alerts.taxiAnomalies === null ? ["법인택시 점검 대상"] : []),
  ];
  const totalAlerts = pendingDailyCount + alerts.editLogs + alerts.manualOvertimes + alerts.newSignups + (alerts.taxiRequests ?? 0) + (alerts.laborContractsPending ?? 0) + (alerts.taxiAnomalies ?? 0);

  return (
    <section className="admin-dashboard-alert-hub bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-[#2C3E50]">새로 확인할 항목</h2>
          <p className="text-xs text-gray-400 mt-1">버튼을 누르면 해당 사이드바 탭으로 이동하고, 신규 변경 항목은 확인 처리됩니다.</p>
        </div>
        <button onClick={onRefresh} className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black">
          {loading ? "확인 중..." : "새로고침"}
        </button>
      </div>

      {/* 초록 '이상 없음'은 모든 카운트가 정상 조회됐을 때만 — 조회 실패가 있으면 성공처럼 보이면 안 된다. */}
      {totalAlerts === 0 && failedCounts.length === 0 ? (
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4 text-[11px] font-black text-emerald-700">
          새로 확인할 항목이 없습니다.
        </div>
      ) : totalAlerts === 0 ? null : (
        /* 버튼 폰트는 관리자 디자인 기준(§6-0-1: 버튼 11px/900)을 따른다 — 기존 text-sm 레거시도 함께 정리(2026-07-27). */
        <div className="admin-dashboard-alert-actions flex flex-col gap-2">
          {pendingDailyCount > 0 && (
            <button onClick={() => onOpen("dailyPending")} className="px-4 py-2 rounded-xl bg-amber-50 text-amber-700 border border-amber-100 text-[11px] font-black hover:bg-amber-100 cursor-pointer">
              일일정산 미제출: {pendingDailyCount}건
            </button>
          )}
          {alerts.editLogs > 0 && (
            <button onClick={() => onOpen("editLogs")} className="px-4 py-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 text-[11px] font-black hover:bg-blue-100 cursor-pointer">
              정산 변경: {alerts.editLogs}건
            </button>
          )}
          {alerts.manualOvertimes > 0 && (
            <button onClick={() => onOpen("manualOvertimes")} className="px-4 py-2 rounded-xl bg-violet-50 text-violet-700 border border-violet-100 text-[11px] font-black hover:bg-violet-100 cursor-pointer">
              초과근무 수기작성: {alerts.manualOvertimes}건
            </button>
          )}
          {alerts.newSignups > 0 && (
            <button onClick={() => onOpen("accounts")} className="px-4 py-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 text-[11px] font-black hover:bg-emerald-100 cursor-pointer">
              계정 가입 승인 대기: {alerts.newSignups}건
            </button>
          )}
          {(alerts.taxiRequests ?? 0) > 0 && (
            <button onClick={() => onOpen("taxiRequests")} className="px-4 py-2 rounded-xl bg-sky-50 text-sky-700 border border-sky-100 text-[11px] font-black hover:bg-sky-100 cursor-pointer">
              법인택시 신청 대기: {alerts.taxiRequests}건
            </button>
          )}
          {/* [색 주의] 알림 버튼에 rose 를 쓰지 않는다 — 관리자 스코프 자동 치환 목록(amber·orange→
              바닐라 / blue·sky→엘리스 / emerald·green→허니, DESIGN_ADMIN §3)에 없어 혼자만 진짜
              빨강으로 남고, 아래 '조회 실패' 오류 배너(#FDE2E2/#B91C1C)와 헷갈린다. 빨강은 이 허브에서
              오류 전용이다. 버튼은 색으로 의미를 나누지 않으므로(DESIGN.md §10) 형제와 같은 계열을 쓴다. */}
          {(alerts.taxiAnomalies ?? 0) > 0 && (
            <button onClick={() => onOpen("taxiAnomalies")} className="px-4 py-2 rounded-xl bg-amber-50 text-amber-700 border border-amber-100 text-[11px] font-black hover:bg-amber-100 cursor-pointer">
              법인택시 점검 대상: {alerts.taxiAnomalies}건
            </button>
          )}
          {(alerts.laborContractsPending ?? 0) > 0 && (
            <button onClick={() => onOpen("laborContracts")} className="px-4 py-2 rounded-xl bg-orange-50 text-orange-700 border border-orange-100 text-[11px] font-black hover:bg-orange-100 cursor-pointer">
              근로계약서 발송 요청: {alerts.laborContractsPending}건
            </button>
          )}
        </div>
      )}

      {/* 조회 실패는 0건과 다르다 — 숨기지 말고 알린다(Codex P1 2026-07-27).
          [색] 관리자 스코프는 text-rose-*를 검정으로, bg-rose-50 을 연한 토큰으로 죽여서
          rose 로 칠하면 "오류"로 안 읽힌다 — 오류 색은 hex 로 못 박는다(DESIGN_ADMIN §2-1).
          같은 파일 '이번 달 미작성 지점' 오류 문구와 같은 색을 쓴다(Codex stop-time 2026-07-29). */}
      {failedCounts.length > 0 && (
        <div className="rounded-xl border border-[#C93A3A] bg-[#FDE2E2] p-3 text-[11px] font-black text-[#B91C1C]">
          {failedCounts.join(" · ")} 건수를 불러오지 못했습니다. '새로고침'을 누르거나 해당 탭에서 직접 확인해 주세요.
        </div>
      )}
    </section>
  );
}

// 이번 달에 일일마감을 빠뜨린(기록 없는) 날짜를 지점별로 보여준다.
// 기대 일수: 지난달이면 말일까지, 이번달이면 '어제'까지(오늘치는 아직 마감 전일 수 있어 제외).
function AdminMonthlyMissingDaysPanel({ month }: { month: string }) {
  const [rows, setRows] = useState<Array<{ branchName: string; missing: number[]; error?: boolean }> | null>(null);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setLoadError(false);
    (async () => {
      try {
        const branchList = (await gasClient.getBranchList()).filter((b: any) => b?.role === "branch" && b.branchName);
        const [y, m] = month.split("-").map(Number);
        if (!y || !m) { if (!cancelled) setRows([]); return; }
        const daysInMonth = new Date(y, m, 0).getDate();
        const today = new Date();
        const isCurrentMonth = today.getFullYear() === y && today.getMonth() + 1 === m;
        const cutoff = isCurrentMonth ? Math.max(0, today.getDate() - 1) : daysInMonth;
        const result = await Promise.all(branchList.map(async (b: any) => {
          // 읽기 실패를 '빈 이력=전부 빠짐'으로 오해하면 안 된다(fail-closed):
          // 반드시 서버 전용 조회를 쓴다 — getBranchHistory는 실패를 []로 삼켜(gasClient) 이 센티넬이 무력화된다.
          // 실패는 throw → null 센티넬로 잡아 '확인 불가'로 표시한다.
          const history = await gasClient.getBranchHistoryFromServer(b.branchName, month).catch(() => null);
          if (history === null) return { branchName: b.branchName, missing: [], error: true };
          const submitted = new Set<number>();
          (Array.isArray(history) ? history : []).forEach((r: any) => {
            const d = String(r.settleDate || "");
            if (d.slice(0, 7) === month) { const day = Number(d.split("-")[2]); if (day) submitted.add(day); }
          });
          const missing: number[] = [];
          for (let d = 1; d <= cutoff; d++) if (!submitted.has(d)) missing.push(d);
          return { branchName: b.branchName, missing };
        }));
        // 확인 불가(에러) 지점을 위로, 그다음 빠진 일수 많은 순.
        if (!cancelled) setRows(
          result
            .filter((r) => r.error || r.missing.length > 0)
            .sort((a, b) => Number(!!b.error) - Number(!!a.error) || b.missing.length - a.missing.length)
        );
      } catch {
        // 지점 목록 자체를 못 불러온 경우 — 초록 '이상 없음'으로 오도하지 않도록 별도 에러 표시.
        if (!cancelled) { setRows([]); setLoadError(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [month]);

  return (
    <div className="bg-white p-4 rounded-2xl border border-gray-100 space-y-2">
      {/* 제목엔 글자만 둔다(DESIGN.md §6-1) — 예전 경고 아이콘은 뺐다. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <h3 className="text-[13px] font-black text-[#2C3E50]">이번 달 미작성 지점</h3>
        <span className="text-[11px] font-bold text-gray-400">{month} · 기록 없는 날짜 · 어제까지 기준</span>
      </div>
      {rows === null ? (
        <p className="text-[11px] font-bold text-gray-400">불러오는 중…</p>
      ) : loadError ? (
        // 관리자 스코프는 text-rose-*를 검정으로 죽인다 — 오류 색은 hex로 못 박는다(DESIGN_ADMIN §2-1).
        <p className="rounded-lg border border-[#C93A3A] bg-[#FDE2E2] px-2.5 py-1.5 text-[11px] font-black text-[#B91C1C]">지점 목록을 서버에서 불러오지 못했습니다. 새로고침 후 다시 확인해주세요. (미작성 여부를 확인하지 못했습니다.)</p>
      ) : rows.length === 0 ? (
        <p className="text-[11px] font-bold text-emerald-600">모든 지점이 이번 달 일일마감을 빠짐없이 작성했습니다.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {rows.map((r) => (
            <div key={r.branchName} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 first:pt-0 last:pb-0">
              <span className="font-black text-[#2C3E50] text-[12px] w-24 shrink-0 truncate" title={r.branchName}>{r.branchName}</span>
              {r.error ? (
                <span className="inline-flex px-1.5 rounded-md bg-gray-200 text-gray-600 text-[10px] font-black shrink-0">확인 불가</span>
              ) : (
                <span className="inline-flex px-1.5 rounded-md border border-[#C93A3A] bg-[#FDE2E2] text-[#B91C1C] text-[10px] font-black shrink-0">{r.missing.length}일</span>
              )}
              <span className="text-[11px] font-bold text-gray-500 min-w-0">
                {r.error ? "서버 응답이 없어 작성 여부를 확인하지 못했습니다." : r.missing.map((d) => `${d}일`).join(", ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type ClosingView = "overtime" | "cash" | "remarks" | "otherMemo";

const CLOSING_VIEWS: Array<{ key: ClosingView; label: string }> = [
  { key: "cash", label: "현금차이" },
  { key: "overtime", label: "초과근무" },
  { key: "remarks", label: "특이사항" },
  { key: "otherMemo", label: "기타메모" },
];

/** 선택한 날짜의 마감 이상치 중 지금 보고 있는 분류에 해당하는 것만 */
const filterAnomalies = (records: any[], view: ClosingView): any[] =>
  records.filter((item) =>
    view === "remarks" ? Boolean(item.remarks?.staffMemo || item.remarks?.reviewMemo)
    : view === "otherMemo" ? Boolean(item.remarks?.otherMemo)
    : view === "cash" ? Boolean(item.cashDifference)
    : Boolean(item.overtime)
  );

function AdminDailySettlementStatusSection({
  selectedDate,
  setSelectedDate,
  selectedBrand,
  setSelectedBrand,
  brandList,
  stats,
  loading,
  filteredList,
  handleDownloadExcel,
  handleOpenDetail,
  anomalyRecords,
  anomalyLoading,
  anomalyFailedBranches,
  anomalyLoadError,
  closingView,
  setClosingView,
  reloadAnomalies
}: {
  selectedDate: string;
  setSelectedDate: (value: string) => void;
  selectedBrand: string;
  setSelectedBrand: (value: string) => void;
  brandList: string[];
  stats: { total: number; submitted: number; pending: number; revenue: number };
  loading: boolean;
  filteredList: DailyListRow[];
  handleDownloadExcel: () => void;
  handleOpenDetail: (row: DailyListRow) => void;
  /** 이미 selectedDate 로 걸러진 이상치 목록 */
  anomalyRecords: any[];
  anomalyLoading: boolean;
  /** 이상치를 못 읽은 지점 이름 — 이 지점들은 '이상 없음'이 아니라 '확인 못 함'이다 */
  anomalyFailedBranches: string[];
  anomalyLoadError: boolean;
  closingView: ClosingView;
  setClosingView: (view: ClosingView) => void;
  reloadAnomalies: () => void;
}) {
  const cashDiffCount = anomalyRecords.filter((item) => item.cashDifference).length;
  const otherMemoCount = anomalyRecords.filter((item) => item.remarks?.otherMemo).length;
  // 이상치 카드를 누르면 그 분류로 바꾸고 아래 표까지 짚어 준다.
  const focusAnomalies = (view: ClosingView) => {
    setClosingView(view);
    document.getElementById("admin-closing-anomaly-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // 통계 5칸은 카드 5장이 아니라 카드 1장을 세로선으로 나눈다(2026-07-23 컴팩트화).
  // 좁은 화면에선 세로로 쌓이므로 구분선도 가로선으로 바뀐다.
  const statCell = "px-4 py-2.5 border-t border-gray-100 first:border-t-0 sm:border-t-0 sm:border-l sm:first:border-l-0";
  const statLabel = "text-[11px] font-black text-gray-400";
  const statValue = "block mt-0.5 font-mono text-base font-black text-[#2C3E50] whitespace-nowrap";

  return (
    <section className="space-y-5">
      {/* 제목·날짜·다운로드·브랜드 필터를 카드 1장으로 합쳤다 — 브랜드 필터가 카드 한 장을 통째로 쓰고 있었다(2026-07-23). */}
      <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
            <h2 className="text-base font-black text-[#2C3E50] tracking-tight">전일 정산현황</h2>
            <p className="text-[11px] text-gray-400 font-medium">선택한 날짜의 지점별 제출·매출과 마감 이상치</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label className="flex items-center gap-1.5 h-8 border border-gray-200 bg-white px-2.5 rounded-lg">
              <Calendar className="w-3.5 h-3.5 text-[#2E6DB4] shrink-0" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="font-mono text-[11px] font-black text-[#2C3E50] border-0 outline-hidden bg-transparent focus:ring-0 p-0 w-[104px]"
              />
            </label>
            <button onClick={handleDownloadExcel} className="flex items-center gap-1.5 h-8 px-3 bg-emerald-600 text-white text-[11px] font-black rounded-lg cursor-pointer">
              <Download className="w-3.5 h-3.5" /> 엑셀 다운로드
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap border-t border-gray-100 pt-2.5">
          <Filter className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          {brandList.map((brand) => (
            <button key={brand} onClick={() => setSelectedBrand(brand)} className={`h-6 px-2.5 rounded-full text-[11px] font-bold cursor-pointer transition-colors whitespace-nowrap ${selectedBrand === brand ? "bg-[#2E6DB4] text-white" : "bg-gray-100 text-gray-500"}`}>
              {brand}
            </button>
          ))}
        </div>
      </div>

      {/* 현금차이·기타메모는 예전에 대시보드 KPI로 따로 있었다. 같은 날짜를 두 화면에서 나눠 보던 것을
          한 줄로 합쳤다(2026-07-22). 두 칸은 누르면 아래 마감 이상치 표의 해당 분류로 이동한다. */}
      <div className="bg-white rounded-2xl border border-gray-100 grid grid-cols-1 sm:grid-cols-5 overflow-hidden">
        <div className={statCell}>
          <span className={`block ${statLabel}`}>제출 지점</span>
          <span className={statValue}>{stats.submitted} <span className="text-[11px] font-bold text-gray-300 font-sans">/ {stats.total}</span></span>
        </div>
        <div className={statCell}>
          <span className={`block ${statLabel}`}>미제출 지점</span>
          <span className={statValue}>{stats.pending}</span>
        </div>
        <div className={statCell}>
          <span className={`block ${statLabel}`}>총 수집 매출</span>
          <span className={statValue}>{formatNumber(stats.revenue)}원</span>
        </div>
        <button type="button" onClick={() => focusAnomalies("cash")} title="마감 이상치의 현금차이 목록으로 이동" className={`${statCell} text-left cursor-pointer`}>
          <span className={`flex items-center gap-0.5 ${statLabel}`}>현금차이 <ChevronRight className="w-3 h-3" /></span>
          <span className={statValue}>{anomalyLoading ? "…" : cashDiffCount}</span>
        </button>
        <button type="button" onClick={() => focusAnomalies("otherMemo")} title="마감 이상치의 기타메모 목록으로 이동" className={`${statCell} text-left cursor-pointer`}>
          <span className={`flex items-center gap-0.5 ${statLabel}`}>ERP 기타메모 <ChevronRight className="w-3 h-3" /></span>
          <span className={statValue}>{anomalyLoading ? "…" : otherMemoCount}</span>
        </button>
      </div>

      {/* 선택한 날짜가 속한 '이번 달' 전체에서 일일마감을 빠뜨린 지점·날짜를 한눈에. */}
      <AdminMonthlyMissingDaysPanel month={selectedDate.slice(0, 7)} />

      {/* 행 여백을 DESIGN.md §8 기준값(thead py-2 px-2 / tbody py-1.5 px-2)에 맞춰 낮췄다 — 예전엔 px-6 py-4라
          14개 지점이 한 화면에 안 들어왔다(2026-07-23). */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead><tr className="bg-[#D6E4F0]/30 border-b border-gray-100 text-left"><th className="px-3 py-2 text-[11px] font-black text-[#212121]">지점명</th><th className="px-3 py-2 text-[11px] font-black text-[#212121]">브랜드</th><th className="px-3 py-2 text-[11px] font-black text-[#212121] text-right">총 매출</th><th className="px-3 py-2 text-[11px] font-black text-[#212121] text-right">현금</th><th className="px-3 py-2 text-[11px] font-black text-[#212121] text-right">카드</th><th className="px-3 py-2 text-[11px] font-black text-[#212121]">상태</th><th className="px-3 py-2 text-[11px] font-black text-[#212121] text-center">관리</th></tr></thead>
            <tbody className="divide-y divide-gray-100 text-xs">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-10"><LoadingSpinner size="md" /></td></tr>
              ) : filteredList.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-gray-400 text-xs">조건에 맞는 지점이 없습니다.</td></tr>
              ) : filteredList.map((item) => {
                const record = item.record;
                return (
                  <tr key={item.branchName} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-3 py-1.5 font-black text-[#2C3E50] text-[13px]">{item.branchName}</td>
                    <td className="px-3 py-1.5 text-gray-500 font-semibold">{item.brand}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-black text-[#1A3C6E] text-[13px]">{record ? `${formatNumber(record.totalSales)}원` : "-"}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-gray-500">{record ? formatNumber(record.cashSales) : "-"}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-gray-500">{record ? formatNumber(record.cardSales) : "-"}</td>
                    <td className="px-3 py-1.5">{item.submitted ? <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-black rounded-full"><CheckCircle2 className="w-3 h-3" /> 완료</span> : <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-[#F39C12] text-[10px] font-black rounded-full"><AlertTriangle className="w-3 h-3" /> 미제출</span>}</td>
                    <td className="px-3 py-1.5 text-center">{item.submitted ? <button onClick={() => handleOpenDetail(item)} className="inline-flex h-6 items-center gap-1 px-2 bg-gray-100 hover:bg-[#D6E4F0]/60 text-gray-600 hover:text-[#1A3C6E] text-[11px] font-black rounded-lg transition-all cursor-pointer"><Eye className="w-3 h-3" /> 상세</button> : <span className="text-[11px] text-gray-300 font-black">대기중</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 마감 이상치 — 대시보드 '마감현황'에서 옮겨왔다(2026-07-22).
          예전엔 '어제'로 못 박혀 있어 날짜를 바꿔도 따라오지 않았다. 이제 위 날짜 선택을 그대로 따른다.
          예전의 '대시보드' 탭은 '현금차이'와 필터가 완전히 같아 없앴다. */}
      <section id="admin-closing-anomaly-section" className="admin-dashboard-closing-section bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
            <h2 className="text-base font-black text-[#2C3E50]">마감 이상치</h2>
            <p className="text-[11px] text-gray-400">{selectedDate} 마감의 현금차이·초과근무·특이사항·기타메모</p>
          </div>
          <button onClick={reloadAnomalies} className="h-7 px-2.5 rounded-lg border border-gray-200 text-gray-600 text-[11px] font-black cursor-pointer">새로고침</button>
        </div>
        {/* 못 읽은 지점을 밝히지 않으면 '이상 없음'과 '확인 못 함'이 똑같아 보인다(P0-2).
            관리자 스코프는 text-rose-*를 검정으로 죽이므로 오류 색은 hex로 못 박는다(DESIGN_ADMIN §2-1). */}
        {anomalyLoadError && (
          <p className="rounded-lg border border-[#C93A3A] bg-[#FDE2E2] px-2.5 py-1.5 text-[11px] font-black text-[#B91C1C]">지점 목록을 불러오지 못해 이상치를 확인하지 못했습니다. 새로고침 후 다시 확인해주세요.</p>
        )}
        {!anomalyLoadError && anomalyFailedBranches.length > 0 && (
          <p className="rounded-lg border border-[#C93A3A] bg-[#FDE2E2] px-2.5 py-1.5 text-[11px] font-black text-[#B91C1C]">
            {anomalyFailedBranches.join(", ")} — 이 지점은 기록을 읽지 못해 이상치를 확인하지 못했습니다. (아래 개수에 빠져 있습니다)
          </p>
        )}
        <div className="admin-anomaly-tabs flex gap-1.5 flex-wrap border-b border-gray-100 pb-2">
          {CLOSING_VIEWS.map((view) => {
            const count = filterAnomalies(anomalyRecords, view.key).length;
            return (
              <button
                key={view.key}
                onClick={() => setClosingView(view.key)}
                aria-current={closingView === view.key ? "true" : undefined}
                className={`px-3 py-1.5 text-[11px] font-black border-b-2 cursor-pointer ${closingView === view.key ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}
              >
                {view.label}{anomalyLoading ? "" : ` ${count}`}
              </button>
            );
          })}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left">
              <tr>
                <th className="py-2 px-2 text-[11px] font-black text-[#212121]">지점</th>
                <th className="py-2 px-2 text-[11px] font-black text-[#212121]">마감자</th>
                <th className="py-2 px-2 text-[11px] font-black text-[#212121]">이상 항목</th>
                <th className="py-2 px-2 text-[11px] font-black text-[#212121]">내용</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {anomalyLoading ? (
                <tr><td colSpan={4} className="py-10 text-center"><LoadingSpinner size="sm" /></td></tr>
              ) : (() => {
                const visible = filterAnomalies(anomalyRecords, closingView);
                if (visible.length === 0) {
                  return <tr><td colSpan={4} className="py-10 text-center text-gray-400 text-xs">
                    {selectedDate} 마감에는 해당 항목이 없습니다.
                    {anomalyFailedBranches.length > 0 ? " (위에 적힌 확인 불가 지점은 제외한 결과입니다)" : ""}
                  </td></tr>;
                }
                return visible.map((item, index) => (
                  <tr key={`${item.branchName}-${item.date}-${index}`}>
                    <td className="py-1.5 px-2 font-bold text-[#2C3E50]">{item.branchName}</td>
                    <td className="py-1.5 px-2 text-gray-500">{item.writer || "-"}</td>
                    {/* text-rose-600 은 관리자 스코프에서 검정으로 죽는다 — 경고색은 hex 로 못 박는다(DESIGN_ADMIN §2-1). */}
                    <td className="py-1.5 px-2 font-black text-[#B91C1C]">
                      {CLOSING_VIEWS.find((view) => view.key === closingView)?.label}
                    </td>
                    <td className="py-1.5 px-2">
                      {closingView === "cash"
                        ? `${formatNumber(item.cashDifference)}원 ${item.reason || ""}`
                        : closingView === "remarks"
                        ? <div className="space-y-1 text-xs"><p><b>직원</b> {item.remarks?.staffMemo || "-"}</p><p><b>리뷰</b> {item.remarks?.reviewMemo || "-"}</p></div>
                        : closingView === "otherMemo"
                        ? <div className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{item.remarks?.otherMemo || "-"}</div>
                        : item.overtime || "-"}
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

// 본사는 월말업무를 하지 않는다(2026-07 방침) — 제출현황·현금관리·현금지출 세 탭 모두에서 뺀다.
// 표에서만 숨기면 '미제출' 카운트·법인별 배치 다운로드·지점 드롭다운·'전체' 합계에는 그대로 남으므로,
// 지점 목록을 읽어오는 지점마다 이 필터를 공통으로 건다. (일일마감정산 등 본사가 실제로 쓰는 화면은 제외 대상 아님)
const MONTHLY_WORK_EXEMPT_BRANCHES = ["본사"];
const isMonthlyWorkBranch = (b: any): boolean =>
  b?.role === "branch" && !MONTHLY_WORK_EXEMPT_BRANCHES.includes(String(b?.branchName || "").trim());

function AdminCashManagementSection({ fixedTab }: { fixedTab?: "cashManagement" | "cashExpenses" } = {}) {
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  });
  const [selectedBranch, setSelectedBranch] = useState("전체");
  const [activeTab, setActiveTab] = useState<"cashManagement" | "cashExpenses">(fixedTab || "cashManagement");
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [cashRows, setCashRows] = useState<any[]>([]);
  const [expenseRows, setExpenseRows] = useState<any[]>([]);

  const parseMetadata = (memo?: string | null) => {
    const parts = String(memo || "").split("\n---\nMETADATA:");
    if (!parts[1]) return {};
    try {
      return JSON.parse(parts[1].trim());
    } catch {
      return {};
    }
  };

  useEffect(() => {
    if (fixedTab) setActiveTab(fixedTab);
  }, [fixedTab]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const branchList = await gasClient.getBranchList();
      const activeBranches = (Array.isArray(branchList) ? branchList : []).filter((branch: any) => isMonthlyWorkBranch(branch) && branch.branchName);
      setBranches(activeBranches);
      const targets = selectedBranch === "전체"
        ? activeBranches
        : activeBranches.filter((branch: any) => branch.branchName === selectedBranch);

      const histories = await Promise.all(targets.map(async (branch: any) => ({
        branch,
        history: await gasClient.getBranchHistory(branch.branchName, selectedMonth).catch(() => [])
      })));

      const nextCashRows: any[] = [];
      const nextExpenseRows: any[] = [];

      histories.forEach(({ branch, history }) => {
        (history || []).forEach((record: any) => {
          if (!String(record.settleDate || "").startsWith(selectedMonth)) return;
          const meta = parseMetadata(record.memo);
          const cashExpenses = Array.isArray(meta.cashExpenses) ? meta.cashExpenses : [];
          const cashExpenseTotal = cashExpenses.reduce((sum: number, item: any) => sum + (Number(item.amount) || 0), 0);
          const prevDayCash = Number(meta.prevDayCash ?? record.prevDayCash ?? 0) || 0;
          const cashSales = Number(record.cashSales ?? meta.cashSales ?? 0) || 0;
          const actualCash = Number(meta.cashBalance ?? record.cashBalance ?? 0) || 0;
          const theoreticalCash = prevDayCash + cashSales - cashExpenseTotal;
          nextCashRows.push({
            branchName: branch.branchName,
            brand: branch.brand || branch.branchName,
            date: record.settleDate,
            prevDayCash,
            cashSales,
            cashExpenseTotal,
            theoreticalCash,
            actualCash,
            diff: actualCash - theoreticalCash,
            transfer: Number(meta.transferSales ?? record.transferSales ?? 0) || 0,
            reason: meta.cashDiffReason || ""
          });
          cashExpenses.forEach((expense: any, index: number) => {
            const amount = Number(expense.amount) || 0;
            if (amount <= 0) return;
            nextExpenseRows.push({
              id: `${branch.branchName}-${record.settleDate}-${index}`,
              branchName: branch.branchName,
              brand: branch.brand || branch.branchName,
              date: record.settleDate,
              classification: expense.classification || "-",
              usage: expense.usage || "-",
              detail: expense.detail || "",
              amount,
              writer: record.submittedBy || record.modifiedBy || ""
            });
          });
        });
      });

      setCashRows(nextCashRows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.branchName).localeCompare(String(b.branchName))));
      setExpenseRows(nextExpenseRows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.branchName).localeCompare(String(b.branchName))));
    } finally {
      setLoading(false);
    }
  }, [selectedBranch, selectedMonth]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => ({
    cashExpenseTotal: expenseRows.reduce((sum, row) => sum + row.amount, 0),
    diffTotal: cashRows.reduce((sum, row) => sum + row.diff, 0)
  }), [cashRows, expenseRows]);

  return (
    <section className="space-y-5 animate-fade-in">
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-[#2C3E50]">현금관리</h2>
            <p className="text-xs text-gray-400 mt-1">전 지점 월말마감의 현금관리 집계와 현금지출 일람을 모아 확인합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold" />
            <select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold min-w-40">
              <option value="전체">전체 지점</option>
              {branches.map((branch) => <option key={branch.branchName} value={branch.branchName}>{branch.branchName}</option>)}
            </select>
            <button onClick={() => void load()} className="px-4 py-2 rounded-xl bg-[#2E6DB4] text-white text-xs font-black">새로고침</button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">현금관리 집계</p><p className="text-2xl font-black">{cashRows.length}건</p></div>
          <div className="rounded-xl bg-orange-50 p-4"><p className="text-xs font-bold text-orange-600">현금지출 합계</p><p className="text-2xl font-black text-orange-700">{formatNumber(summary.cashExpenseTotal)}원</p></div>
          <div className="rounded-xl bg-rose-50 p-4"><p className="text-xs font-bold text-rose-600">현금 차이 합계</p><p className="text-2xl font-black text-rose-700">{formatNumber(summary.diffTotal)}원</p></div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {!fixedTab && (
          <div className="flex gap-2 border-b border-gray-100 px-5">
            <button onClick={() => setActiveTab("cashManagement")} className={`px-4 py-3 text-sm font-bold border-b-2 ${activeTab === "cashManagement" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>현금관리</button>
            <button onClick={() => setActiveTab("cashExpenses")} className={`px-4 py-3 text-sm font-bold border-b-2 ${activeTab === "cashExpenses" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>현금지출</button>
          </div>
        )}
        <div className="overflow-x-auto">
          {activeTab === "cashManagement" ? (
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 font-black"><tr><th className="p-3">마감일자</th><th className="p-3">지점</th><th className="p-3 text-right">전일현금</th><th className="p-3 text-right">현금매출</th><th className="p-3 text-right">현금지출</th><th className="p-3 text-right">현금잔액</th><th className="p-3 text-right">실사현금</th><th className="p-3 text-right">차이</th><th className="p-3">비고</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? <tr><td colSpan={9} className="p-12 text-center"><LoadingSpinner size="sm" /></td></tr> : cashRows.length === 0 ? <tr><td colSpan={9} className="p-12 text-center text-gray-400 font-bold">현금관리 내역이 없습니다.</td></tr> : cashRows.map((row) => (
                  <tr key={`${row.branchName}-${row.date}`}><td className="p-3 font-mono text-xs">{row.date}</td><td className="p-3 font-black">{row.branchName}</td><td className="p-3 text-right font-mono">{formatNumber(row.prevDayCash)}</td><td className="p-3 text-right font-mono">{formatNumber(row.cashSales)}</td><td className="p-3 text-right font-mono text-orange-600">{formatNumber(row.cashExpenseTotal)}</td><td className="p-3 text-right font-mono">{formatNumber(row.theoreticalCash)}</td><td className="p-3 text-right font-mono">{formatNumber(row.actualCash)}</td><td className={`p-3 text-right font-mono font-black ${row.diff ? "text-rose-600" : "text-emerald-600"}`}>{formatNumber(row.diff)}</td><td className="p-3 text-xs text-gray-500">{row.reason || "-"}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 font-black"><tr><th className="p-3">일자</th><th className="p-3">지점</th><th className="p-3">분류</th><th className="p-3">사용처</th><th className="p-3">상세</th><th className="p-3 text-right">금액</th><th className="p-3">작성자</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? <tr><td colSpan={7} className="p-12 text-center"><LoadingSpinner size="sm" /></td></tr> : expenseRows.length === 0 ? <tr><td colSpan={7} className="p-12 text-center text-gray-400 font-bold">현금지출 내역이 없습니다.</td></tr> : expenseRows.map((row) => (
                  <tr key={row.id}><td className="p-3 font-mono text-xs">{row.date}</td><td className="p-3 font-black">{row.branchName}</td><td className="p-3">{row.classification}</td><td className="p-3">{row.usage}</td><td className="p-3 text-gray-500">{row.detail || "-"}</td><td className="p-3 text-right font-mono font-black">{formatNumber(row.amount)}</td><td className="p-3 text-xs text-gray-500">{row.writer || "-"}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}

function AdminAnnualLeaveSection() {
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [entriesByBranch, setEntriesByBranch] = useState<Record<string, any[]>>({});
  const [grantsByBranch, setGrantsByBranch] = useState<Record<string, Record<string, number>>>({});
  const [selectedBranch, setSelectedBranch] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [editLeave, setEditLeave] = useState<{ branchName: string; entry: any; fields: { startDate: string; endDate: string; days: string; reason: string } } | null>(null);
  const [partialDeleteLeave, setPartialDeleteLeave] = useState<{ branchName: string; entry: any; startDate: string; endDate: string } | null>(null);

  const formatShortDate = (value: string) => {
    if (!value) return "-";
    const normalized = String(value).replace(/\./g, "-");
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return value;
    return `${String(date.getFullYear()).slice(2)}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
  };

  const formatTenureText = (value: string) => {
    if (!value) return "-";
    const normalized = String(value).replace(/\./g, "-");
    const start = new Date(normalized);
    if (Number.isNaN(start.getTime())) return "-";
    const today = new Date();
    let months = (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth());
    if (today.getDate() < start.getDate()) months -= 1;
    if (months < 0) months = 0;
    const years = Math.floor(months / 12);
    const remainMonths = months % 12;
    return years > 0 ? `${years}년 ${remainMonths}개월` : `${remainMonths}개월`;
  };

  const calcDays = (from: string, to: string) => {
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    return Number.isFinite(days) ? days : 0;
  };

  const addDays = (value: string, amount: number) => {
    const date = new Date(`${value}T00:00:00`);
    date.setDate(date.getDate() + amount);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };

  const toTime = (value: string) => new Date(`${value}T00:00:00`).getTime();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const branchList = await gasClient.getBranchList();
      setBranches(branchList || []);
      const packed = await Promise.all((branchList || []).map(async (branch: any) => {
        const branchName = branch.branchName;
        const [roster, entries, grants] = await Promise.all([
          gasClient.getBranchOwnRoster(branchName).catch(() => []),
          gasClient.getSharedData<any[]>(`annual_leave:${branchName}`).catch(() => []),
          gasClient.getSharedData<Record<string, number>>(`annual_leave_grants:${branchName}`).catch(() => ({}))
        ]);
        return {
          branchName,
          brand: branch.brand,
          employees: (roster || []).filter((employee: any) => employee.division === "정직원").map((employee: any) => ({ ...employee, branchName, brand: branch.brand })),
          entries: Array.isArray(entries) ? entries : [],
          grants: grants || {}
        };
      }));
      setEmployees(packed.flatMap((item) => item.employees));
      setEntriesByBranch(Object.fromEntries(packed.map((item) => [item.branchName, item.entries])));
      setGrantsByBranch(Object.fromEntries(packed.map((item) => [item.branchName, item.grants])));
      if (!selectedBranch && packed[0]) setSelectedBranch(packed[0].branchName);
    } finally {
      setLoading(false);
    }
  }, [selectedBranch]);

  useEffect(() => {
    void load();
  }, [load]);

  const availableEmployees = employees.filter((employee) => !selectedBranch || employee.branchName === selectedBranch);

  const saveGrant = async (branchName: string, employeeId: string, value: string) => {
    const nextValue = Math.max(0, Number(value) || 0);
    const branchGrants = { ...(grantsByBranch[branchName] || {}), [employeeId]: nextValue };
    const next = { ...grantsByBranch, [branchName]: branchGrants };
    setGrantsByBranch(next);
    await gasClient.saveSharedData(`annual_leave_grants:${branchName}`, branchGrants);
  };

  const saveLeaveUse = async () => {
    const employee = employees.find((item) => item.id === selectedEmployeeId && item.branchName === selectedBranch);
    const days = calcDays(startDate, endDate);
    if (!employee || days < 1 || !reason.trim()) {
      alert("직원, 기간, 사용 사유를 모두 확인해주세요.");
      return;
    }
    const key = `annual_leave:${selectedBranch}`;
    const previous = entriesByBranch[selectedBranch] || [];
    const nextEntry = {
      id: `admin-leave-${Date.now()}`,
      employeeId: employee.id,
      staffName: employee.name,
      branchName: selectedBranch,
      startDate,
      endDate,
      date: startDate,
      days,
      reason: reason.trim(),
      createdAt: new Date().toISOString(),
      createdBy: "관리자"
    };
    const nextEntries = [nextEntry, ...previous];
    await gasClient.saveSharedData(key, nextEntries);
    setEntriesByBranch((prev) => ({ ...prev, [selectedBranch]: nextEntries }));
    setReason("");
  };

  const saveEditedLeave = async () => {
    if (!editLeave) return;
    const key = `annual_leave:${editLeave.branchName}`;
    const previous = entriesByBranch[editLeave.branchName] || [];
    const nextEntries = previous.map((entry) => entry.id === editLeave.entry.id ? {
      ...entry,
      startDate: editLeave.fields.startDate,
      endDate: editLeave.fields.endDate,
      date: editLeave.fields.startDate,
      days: Number(editLeave.fields.days) || calcDays(editLeave.fields.startDate, editLeave.fields.endDate),
      reason: editLeave.fields.reason.trim()
    } : entry);
    await gasClient.saveSharedData(key, nextEntries);
    setEntriesByBranch((prev) => ({ ...prev, [editLeave.branchName]: nextEntries }));
    setEditLeave(null);
  };

  const deleteLeaveEntry = async (branchName: string, entryId: string) => {
    if (!window.confirm("선택한 연차 사용기록을 삭제할까요?")) return;
    const key = `annual_leave:${branchName}`;
    const nextEntries = (entriesByBranch[branchName] || []).filter((entry) => entry.id !== entryId);
    await gasClient.saveSharedData(key, nextEntries);
    setEntriesByBranch((prev) => ({ ...prev, [branchName]: nextEntries }));
  };

  const deleteLeavePartialRange = async () => {
    if (!partialDeleteLeave) return;
    const { branchName, entry, startDate: deleteStart, endDate: deleteEnd } = partialDeleteLeave;
    const entryStart = entry.startDate || entry.date;
    const entryEnd = entry.endDate || entryStart;
    if (toTime(deleteStart) > toTime(deleteEnd) || toTime(deleteStart) > toTime(entryEnd) || toTime(deleteEnd) < toTime(entryStart)) {
      alert("삭제할 기간이 기존 연차 사용기간과 겹치지 않습니다.");
      return;
    }
    const key = `annual_leave:${branchName}`;
    const previous = entriesByBranch[branchName] || [];
    const nextEntries = previous.flatMap((item) => {
      if (item.id !== entry.id) return [item];
      const pieces: any[] = [];
      if (toTime(deleteStart) > toTime(entryStart)) {
        const leftEnd = addDays(deleteStart, -1);
        pieces.push({ ...item, id: `${item.id}-left-${Date.now()}`, startDate: entryStart, endDate: leftEnd, date: entryStart, days: calcDays(entryStart, leftEnd) });
      }
      if (toTime(deleteEnd) < toTime(entryEnd)) {
        const rightStart = addDays(deleteEnd, 1);
        pieces.push({ ...item, id: `${item.id}-right-${Date.now()}`, startDate: rightStart, endDate: entryEnd, date: rightStart, days: calcDays(rightStart, entryEnd) });
      }
      return pieces;
    });
    await gasClient.saveSharedData(key, nextEntries);
    setEntriesByBranch((prev) => ({ ...prev, [branchName]: nextEntries }));
    setPartialDeleteLeave(null);
  };

  const rows = employees.filter((employee) => !selectedBranch || employee.branchName === selectedBranch).map((employee) => {
    const branchEntries = entriesByBranch[employee.branchName] || [];
    const logs = branchEntries.filter((entry) => entry.employeeId === employee.id);
    const used = logs.reduce((sum, entry) => sum + Number(entry.days || 0), 0);
    const grant = Number(grantsByBranch[employee.branchName]?.[employee.id] ?? 15);
    return { employee, logs, used, grant, remain: grant - used };
  });

  return (
    <section className="space-y-6">
      {editLeave && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-black text-gray-900">연차 사용기록 수정</h3>
              <button onClick={() => setEditLeave(null)} className="text-gray-400">×</button>
            </div>
            <div className="p-5 grid grid-cols-1 gap-3 text-sm">
              <label className="space-y-1"><span className="text-xs font-black text-gray-500">시작일</span><input type="date" value={editLeave.fields.startDate} onChange={(e) => setEditLeave((cur) => cur ? { ...cur, fields: { ...cur.fields, startDate: e.target.value, days: String(calcDays(e.target.value, cur.fields.endDate)) } } : cur)} className="w-full border rounded-xl px-3 py-2" /></label>
              <label className="space-y-1"><span className="text-xs font-black text-gray-500">종료일</span><input type="date" value={editLeave.fields.endDate} onChange={(e) => setEditLeave((cur) => cur ? { ...cur, fields: { ...cur.fields, endDate: e.target.value, days: String(calcDays(cur.fields.startDate, e.target.value)) } } : cur)} className="w-full border rounded-xl px-3 py-2" /></label>
              <label className="space-y-1"><span className="text-xs font-black text-gray-500">사용일수</span><input type="number" value={editLeave.fields.days} onChange={(e) => setEditLeave((cur) => cur ? { ...cur, fields: { ...cur.fields, days: e.target.value } } : cur)} className="w-full border rounded-xl px-3 py-2" /></label>
              <label className="space-y-1"><span className="text-xs font-black text-gray-500">사유</span><input value={editLeave.fields.reason} onChange={(e) => setEditLeave((cur) => cur ? { ...cur, fields: { ...cur.fields, reason: e.target.value } } : cur)} className="w-full border rounded-xl px-3 py-2" /></label>
            </div>
            <div className="px-5 py-4 bg-gray-50 flex justify-end gap-2">
              <button onClick={() => setEditLeave(null)} className="px-4 py-2 rounded-xl bg-white border text-xs font-bold">취소</button>
              <button onClick={() => void saveEditedLeave()} className="px-5 py-2 rounded-xl bg-[#2E6DB4] text-white text-xs font-black">저장</button>
            </div>
          </div>
        </div>
      )}
      {partialDeleteLeave && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-black text-gray-900">연차 기간 일부 삭제</h3>
              <button onClick={() => setPartialDeleteLeave(null)} className="text-gray-400">×</button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <p className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">
                기존 기록: {partialDeleteLeave.entry.startDate || partialDeleteLeave.entry.date}~{partialDeleteLeave.entry.endDate || partialDeleteLeave.entry.startDate || partialDeleteLeave.entry.date}
              </p>
              <label className="block space-y-1"><span className="text-xs font-black text-gray-500">삭제 시작일</span><input type="date" value={partialDeleteLeave.startDate} onChange={(e) => setPartialDeleteLeave((cur) => cur ? { ...cur, startDate: e.target.value } : cur)} className="w-full border rounded-xl px-3 py-2" /></label>
              <label className="block space-y-1"><span className="text-xs font-black text-gray-500">삭제 종료일</span><input type="date" value={partialDeleteLeave.endDate} onChange={(e) => setPartialDeleteLeave((cur) => cur ? { ...cur, endDate: e.target.value } : cur)} className="w-full border rounded-xl px-3 py-2" /></label>
              <p className="text-xs text-gray-400">예: 1~10일 기록에서 1~3일만 삭제하면 4~10일 기록만 남습니다.</p>
            </div>
            <div className="px-5 py-4 bg-gray-50 flex justify-end gap-2">
              <button onClick={() => setPartialDeleteLeave(null)} className="px-4 py-2 rounded-xl bg-white border text-xs font-bold">취소</button>
              <button onClick={() => void deleteLeavePartialRange()} className="px-5 py-2 rounded-xl bg-rose-600 text-white text-xs font-black">선택 기간 삭제</button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#2C3E50] tracking-tight">전 직원 연차 통합 관리</h2>
          <p className="text-xs text-gray-400 mt-1">각 지점 정직원의 연차 부여일수, 사용 기간, 사용기록, 잔여일수를 한 화면에서 관리합니다.</p>
        </div>
        <button onClick={() => void load()} className="px-4 py-2 bg-[#2E6DB4] text-white rounded-xl text-xs font-bold">새로고침</button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <h3 className="font-black text-gray-800">연차 사용 등록</h3>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <select value={selectedBranch} onChange={(e) => { setSelectedBranch(e.target.value); setSelectedEmployeeId(""); }} className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold">
            <option value="">지점 선택</option>
            {branches.map((branch) => <option key={branch.branchName} value={branch.branchName}>{branch.branchName}</option>)}
          </select>
          <select value={selectedEmployeeId} onChange={(e) => setSelectedEmployeeId(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold">
            <option value="">직원 선택</option>
            {availableEmployees.map((employee) => <option key={`${employee.branchName}-${employee.id}`} value={employee.id}>{employee.name}</option>)}
          </select>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold" />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold" />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사용 사유" className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold" />
          <button onClick={() => void saveLeaveUse()} className="bg-emerald-600 text-white rounded-xl text-sm font-black">등록</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1060px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3">지점</th>
                <th className="px-4 py-3">직원</th>
                <th className="px-4 py-3">입사일</th>
                <th className="px-4 py-3">근속년수</th>
                <th className="px-4 py-3 text-center">부여일수</th>
                <th className="px-4 py-3 text-center">사용일수</th>
                <th className="px-4 py-3 text-center">잔여일수</th>
                <th className="px-4 py-3">사용기록</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="py-16 text-center"><LoadingSpinner size="sm" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="py-16 text-center text-gray-400 font-bold">표시할 정직원 데이터가 없습니다.</td></tr>
              ) : rows.map(({ employee, logs, used, grant, remain }) => (
                <tr key={`${employee.branchName}-${employee.id}`} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-bold text-gray-500">{employee.branchName}</td>
                  <td className="px-4 py-3 font-black text-gray-800">{employee.name}</td>
                  <td className="px-4 py-3 font-mono text-gray-500">{formatShortDate(employee.entryDate)}</td>
                  <td className="px-4 py-3 font-bold text-gray-600">{formatTenureText(employee.entryDate)}</td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="number"
                      value={grant}
                      onChange={(e) => setGrantsByBranch((prev) => ({ ...prev, [employee.branchName]: { ...(prev[employee.branchName] || {}), [employee.id]: Number(e.target.value) || 0 } }))}
                      onBlur={(e) => void saveGrant(employee.branchName, employee.id, e.target.value)}
                      className="w-20 text-center border border-gray-200 rounded-lg px-2 py-1 font-bold"
                    />
                  </td>
                  <td className="px-4 py-3 text-center font-black text-rose-600">{used}</td>
                  <td className={`px-4 py-3 text-center font-black ${remain < 0 ? "text-rose-700" : "text-[#2E6DB4]"}`}>{remain}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {logs.length === 0 ? "-" : (
                      <div className="space-y-1">
                        {logs.map((entry) => (
                          <div key={entry.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2 py-1">
                            <span>{entry.startDate || entry.date}{entry.endDate && entry.endDate !== (entry.startDate || entry.date) ? `~${entry.endDate}` : ""} ({entry.days}일, {entry.reason || "-"})</span>
                            <span className="flex gap-1">
                              <button onClick={() => setEditLeave({ branchName: employee.branchName, entry, fields: { startDate: entry.startDate || entry.date || "", endDate: entry.endDate || entry.startDate || entry.date || "", days: String(entry.days || 0), reason: entry.reason || "" } })} className="text-[10px] font-black text-[#2E6DB4]">수정</button>
                              <button onClick={() => setPartialDeleteLeave({ branchName: employee.branchName, entry, startDate: entry.startDate || entry.date || "", endDate: entry.endDate || entry.startDate || entry.date || "" })} className="text-[10px] font-black text-amber-600">일부삭제</button>
                              <button onClick={() => void deleteLeaveEntry(employee.branchName, entry.id)} className="text-[10px] font-black text-rose-600">삭제</button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// 마감 이력 점검 탭 — 하위탭 없이 세 섹션(현금차이 이력 · 수기 초과근무 대장 · 정산 변경이력)을 세로로 쌓아
// 한 화면에서 바로 본다. 예전엔 하위탭을 눌러 하나씩 오갔으나 평탄화했다(2026-07-21).
// 순서는 '금액 이상 → 수기 입력 → 사후 수정' 순으로, 급한 것부터 위에 둔다.
function AdminModificationLogsSection({ focusSection }: { focusSection?: "logs" | "manualOvertimes" | null } = {}) {
  // 대시보드 알림에서 넘어왔을 때만 그 섹션으로 스크롤해 짚어 준다(예전 하위탭 전환의 대체).
  // 사이드바로 그냥 들어온 경우엔 focusSection이 null이라 스크롤하지 않고 맨 위부터 보인다.
  useEffect(() => {
    if (!focusSection) return;
    document
      .getElementById(focusSection === "manualOvertimes" ? "modlog-manual-overtimes" : "modlog-edit-logs")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusSection]);

  return (
    <div className="space-y-5 animate-fade-in" id="modification-logs-section">
      <AdminCashDiffHistorySection />
      <AdminManualOvertimesSection />
      <AdminEditLogsSection />
    </div>
  );
}

// 세 섹션 공통 규격 — 관리자 표준(제출현황 섹션)과 같은 값으로 못 박아 셋이 어긋나지 않게 한다.
// 카드 DESIGN.md §4 / 제목 알약 §6(텍스트만) / 컨트롤 h-8·11px §10 / 표 여백 §8.
const MODLOG_CARD = "bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3";
const MODLOG_TITLE = "inline-flex w-fit items-center rounded-full border border-[#212121] bg-amber-50 px-3 py-1.5 text-[11px] font-black text-gray-900";
const MODLOG_SUB = "text-[11px] text-gray-400";
const MODLOG_FIELD = "h-8 rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-bold";
const MODLOG_REFRESH = "h-8 rounded-lg bg-[#2E6DB4] text-white px-3 text-[11px] font-black cursor-pointer";
// 표는 카드 안에서 자체 스크롤한다 — 세 섹션을 쌓아도 제목이 한 화면에 들어오게. 헤더 고정은 index.css가 맡는다.
const MODLOG_SCROLL = "max-h-[320px] overflow-auto rounded-lg border border-gray-100";
const MODLOG_TH = "py-2 px-2 text-left text-[11px] font-black text-[#212121] whitespace-nowrap";
const MODLOG_TD = "py-1.5 px-2";
const MODLOG_EMPTY = "py-8 text-center text-[11px] font-bold text-gray-400";
// 삭제 버튼 — 행 높이를 키우지 않도록 h-6로 납작하게.
const MODLOG_DELETE = "inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 bg-white text-rose-600 hover:bg-rose-50 cursor-pointer";

// ── 최근 건 강조 ───────────────────────────────────────────────────────────
// 최근 3일(오늘·어제·그저께) 안에 올라온 행을 바닐라로 짚어 준다. 예전엔 관리자가 행마다 '확인'을 눌러
// 강조를 끄는 방식이었으나, 그 확인 목록을 통째로 덮어쓰는 구조라 다른 관리자의 확인이 지워졌다.
// 시간 기준으로 저절로 꺼지게 바꿔 그 저장 경로 자체를 없앴다(2026-07-21).
const MODLOG_RECENT_DAYS = 3;

// '최근 N일'의 시작 시각(로컬 자정). 행마다 new Date()를 만들지 않도록 렌더당 한 번만 계산해 넘긴다.
const modlogRecentCutoff = (): number => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (MODLOG_RECENT_DAYS - 1)); // 오늘을 포함해 3일
  return d.getTime();
};

const modlogIsRecent = (value: unknown, cutoff: number): boolean => {
  const raw = String(value || "");
  if (!raw) return false;
  // "2026-07-20"처럼 날짜만 있는 값은 Date가 UTC 자정으로 읽어 한국 시간 기준 하루가 밀린다 → 로컬 자정으로 만든다.
  const t = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(Number(raw.slice(0, 4)), Number(raw.slice(5, 7)) - 1, Number(raw.slice(8, 10))).getTime()
    : new Date(raw).getTime();
  return Number.isNaN(t) ? false : t >= cutoff;
};

// 바닐라 강조는 index.css(#modification-logs-section .admin-log-recent)가 준다
// — tbody 줄무늬가 !important라 인라인 클래스로는 못 이긴다(DESIGN.md §8).
const modlogRowClass = (recent: boolean) => `border-b ${recent ? "admin-log-recent" : "hover:bg-slate-50/50"}`;

// 세 섹션 공통 필터 줄 — 지점명(드롭다운) · 월 선택 · 새로고침. 한 컴포넌트로 두어 셋이 어긋나지 않게 한다.
// `monthRequired`(현금차이)는 월을 비울 수 없다 — 그 섹션의 월은 화면 필터가 아니라 서버 조회 조건이라,
// 비우면 전 지점 전 기간을 훑게 되어 조회 자체가 불가능해진다.
function ModlogFilters({ branches, branch, onBranchChange, month, onMonthChange, onRefresh, monthRequired = false }: {
  branches: string[];
  branch: string;
  onBranchChange: (value: string) => void;
  month: string;
  onMonthChange: (value: string) => void;
  onRefresh: () => void;
  monthRequired?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={branch}
        onChange={(e) => onBranchChange(e.target.value)}
        aria-label="지점명 필터"
        className={`${MODLOG_FIELD} w-32`}
      >
        <option value="">전체 지점</option>
        {branches.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <input
        type="month"
        value={month}
        onChange={(e) => onMonthChange(e.target.value)}
        aria-label="조회 월"
        title={monthRequired ? "조회할 월" : "비우면 전체 기간"}
        className={MODLOG_FIELD}
      />
      <button type="button" onClick={onRefresh} className={MODLOG_REFRESH}>새로고침</button>
    </div>
  );
}

// 표에 실제로 들어 있는 지점명으로 드롭다운을 채운다(별도 조회 없이). 현재 선택값은 목록에서 사라져도
// 남겨 둔다 — 새로고침 후 그 지점 기록이 0건이 되면 select가 빈 칸으로 보여 무엇으로 걸러진 건지 알 수 없다.
const modlogBranchOptions = (rows: Array<{ branchName?: string }>, selected: string): string[] => {
  const names = new Set(rows.map((row) => String(row?.branchName || "")).filter(Boolean));
  if (selected) names.add(selected);
  return Array.from(names).sort((a, b) => a.localeCompare(b, "ko"));
};

// 마감 대상일(settleDate, "2026-06-14")이 선택한 월에 속하는지. 월이 비었으면 전체 기간이다.
const modlogInMonth = (settleDate: unknown, month: string): boolean =>
  !month || String(settleDate || "").startsWith(month);

function AdminEditLogsSection() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchBranch, setSearchBranch] = useState("");
  // 월은 비워 두면 전체 기간이다. 기본을 이번 달로 두면 지난달 기록이 화면에서 사라져 놓치게 된다.
  const [searchMonth, setSearchMonth] = useState("");

  const loadLogs = async () => {
    try {
      setLoading(true);
      setLogs(await gasClient.getEditLogs());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const branchOptions = useMemo(() => modlogBranchOptions(logs, searchBranch), [logs, searchBranch]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchBranch = !searchBranch || log.branchName === searchBranch;
      return matchBranch && modlogInMonth(log.settleDate, searchMonth);
    });
  }, [logs, searchBranch, searchMonth]);

  const deleteLog = async (log: any) => {
    if (!log?.id) return;
    if (!window.confirm(`${log.branchName || ""} ${log.settleDate || ""} 변경이력 로그를 삭제할까요?`)) return;
    try {
      await gasClient.deleteEditLog(log.id);
      await loadLogs();
    } catch (error) {
      console.error("변경이력 삭제 실패:", error);
      alert("변경이력 삭제에 실패했습니다.");
    }
  };

  const formatShortDate = (isoString: string) => {
    if (!isoString) return "-";
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  };

  const getChangesSummary = (log: any) => {
    const changes: string[] = [];
    const before = log.before || {};
    const after = log.after || {};

    if (before.cashSales !== after.cashSales) {
      changes.push(`현금매출: ${formatNumber(before.cashSales)}원 ➔ ${formatNumber(after.cashSales)}원`);
    }
    if (before.cardSales !== after.cardSales) {
      changes.push(`카드매출: ${formatNumber(before.cardSales)}원 ➔ ${formatNumber(after.cardSales)}원`);
    }
    if (before.transferSales !== after.transferSales) {
      changes.push(`계좌매출: ${formatNumber(before.transferSales)}원 ➔ ${formatNumber(after.transferSales)}원`);
    }
    if (before.deliverySales !== after.deliverySales) {
      changes.push(`배달매출: ${formatNumber(before.deliverySales)}원 ➔ ${formatNumber(after.deliverySales)}원`);
    }
    const beforeExpLength = before.expenses?.length || 0;
    const afterExpLength = after.expenses?.length || 0;
    if (beforeExpLength !== afterExpLength) {
      changes.push(`지출 항목 수: ${beforeExpLength}개 ➔ ${afterExpLength}개`);
    } else if (before.expenses && after.expenses) {
      let diff = false;
      for (let i = 0; i < beforeExpLength; i++) {
        if (before.expenses[i]?.amount !== after.expenses[i]?.amount || before.expenses[i]?.itemName !== after.expenses[i]?.itemName) {
          diff = true;
          break;
        }
      }
      if (diff) changes.push(`지출 세부 내역 수정됨`);
    }

    const beforeStaffLength = before.staff?.length || 0;
    const afterStaffLength = after.staff?.length || 0;
    if (beforeStaffLength !== afterStaffLength) {
      changes.push(`근무 직원 수: ${beforeStaffLength}명 ➔ ${afterStaffLength}명`);
    } else if (before.staff && after.staff) {
      let diff = false;
      for (let i = 0; i < beforeStaffLength; i++) {
        if (before.staff[i]?.workHours !== after.staff[i]?.workHours) {
          diff = true;
          break;
        }
      }
      if (diff) changes.push(`근무 시간/직원 내역 수정됨`);
    }

    if (changes.length === 0) {
      return <span className="text-[11px] text-gray-400">변경 사항 없음 (또는 기타 설정 변경)</span>;
    }

    // 세로 불릿 목록 대신 한 줄로 이어 붙여 행 높이를 낮춘다(항목이 많으면 줄바꿈).
    const text = changes.join("  ·  ");
    return <span className="text-[11px] font-bold text-gray-700" title={text}>{text}</span>;
  };

  const recentCutoff = modlogRecentCutoff();
  const recentCount = filteredLogs.filter((log) => modlogIsRecent(log.modifiedAt, recentCutoff)).length;

  return (
    <div id="modlog-edit-logs" className={MODLOG_CARD}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="space-y-1.5">
          <h3 className={MODLOG_TITLE}>정산 변경이력</h3>
          <p className={MODLOG_SUB}>지점이 마감 제출 후 수정한 내역 · 총 {filteredLogs.length}건{recentCount > 0 ? ` (최근 3일 ${recentCount}건)` : ""}</p>
        </div>
        <ModlogFilters
          branches={branchOptions}
          branch={searchBranch}
          onBranchChange={setSearchBranch}
          month={searchMonth}
          onMonthChange={setSearchMonth}
          onRefresh={() => void loadLogs()}
        />
      </div>

      <div className={MODLOG_SCROLL}>
        <table className="w-full min-w-[720px] text-xs">
          <thead>
            <tr>
              <th className={`${MODLOG_TH} w-28`}>수정일시</th>
              <th className={`${MODLOG_TH} w-24`}>지점명</th>
              <th className={`${MODLOG_TH} w-24`}>대상일</th>
              <th className={`${MODLOG_TH} w-20`}>작업자</th>
              <th className={MODLOG_TH}>변경 내용</th>
              <th className={`${MODLOG_TH} w-12 text-center`}>관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="py-8 text-center"><LoadingSpinner size="sm" /></td></tr>
            ) : filteredLogs.length === 0 ? (
              <tr><td colSpan={6} className={MODLOG_EMPTY}>기록된 마감 수정 이력이 없습니다.</td></tr>
            ) : (
              filteredLogs.map((log) => (
                  <tr key={log.id} className={modlogRowClass(modlogIsRecent(log.modifiedAt, recentCutoff))}>
                    <td className={`${MODLOG_TD} font-mono text-[11px] text-gray-500 whitespace-nowrap`}>
                      {formatShortDate(log.modifiedAt)}
                    </td>
                    <td className={`${MODLOG_TD} font-black text-gray-800 whitespace-nowrap`}>
                      {log.branchName}
                    </td>
                    <td className={`${MODLOG_TD} font-mono text-[11px] font-black text-blue-700 whitespace-nowrap`}>
                      {log.settleDate}
                    </td>
                    <td className={`${MODLOG_TD} text-[11px] font-bold text-gray-700 whitespace-nowrap`}>
                      {log.modifiedBy || "지점담당"}
                    </td>
                    <td className={MODLOG_TD}>
                      {getChangesSummary(log)}
                    </td>
                    <td className={`${MODLOG_TD} text-center`}>
                      <button type="button" onClick={() => void deleteLog(log)} className={MODLOG_DELETE} title="변경이력 삭제">
                        <Trash2 className="w-3 h-3" />
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

// 현금차이 이력 — 선택한 달에 각 지점이 기록한 현금 차이(실사현금 − 장부)를 날짜별로 모아 보여준다.
// 대시보드 '전일 정산'은 어제치만 보이므로, 지난 기록을 지점·날짜별로 되짚어 볼 수 있게 한다.
function AdminCashDiffHistorySection() {
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const [rows, setRows] = useState<Array<{ date: string; branchName: string; cashDifference: number; reason: string }> | null>(null);
  const [partialError, setPartialError] = useState(false);
  const [branch, setBranch] = useState("");
  // 이 조회는 전 지점을 각각 훑어 느리다. 월을 빠르게 바꾸면 이전 달 응답이 늦게 도착해
  // 새 달 결과를 덮어써, 화면의 월 선택칸과 표 내용이 어긋난다. 최신 요청 번호를 남겨 뒤늦은 응답은 버린다.
  // 언마운트 때도 번호를 올려 사라진 컴포넌트에 setState하지 않는다.
  const loadSeq = useRef(0);
  useEffect(() => () => { loadSeq.current += 1; }, []);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setRows(null);
    setPartialError(false);
    try {
      const branchList = (await gasClient.getBranchList()).filter((b: any) => b?.role === "branch" && b.branchName);
      let anyFail = false;
      const perBranch = await Promise.all(branchList.map(async (b: any) => {
        // 읽기 실패는 '차이 없음'과 구분한다(fail-closed): null이면 배너로 '일부 누락'을 알린다.
        // 서버 전용 조회 필수 — getBranchHistory는 실패를 []로 삼켜(gasClient) 실패 지점이 조용히 사라진다.
        const history = await gasClient.getBranchHistoryFromServer(b.branchName, month).catch(() => null);
        if (history === null) { anyFail = true; return []; }
        return (Array.isArray(history) ? history : []).flatMap((record: any) => {
          try {
            const memoText = String(record.memo || "");
            const meta = JSON.parse(memoText.split("\n---\nMETADATA:")[1] || "{}");
            const expenses = (meta.cashExpenses || []).reduce((s: number, it: any) => s + (Number(it.amount) || 0), 0);
            // 대시보드 전일정산과 동일 산식: 실사현금 − (전일현금 + 현금매출 − 현금지출)
            const cashDifference = (Number(meta.cashBalance) || 0) - ((Number(meta.prevDayCash) || 0) + (Number(record.cashSales) || 0) - expenses);
            const d = String(record.settleDate || "");
            if (!cashDifference || d.slice(0, 7) !== month) return [];
            return [{ date: d, branchName: b.branchName, cashDifference, reason: meta.cashDiffReason || "" }];
          } catch { return []; }
        });
      }));
      if (seq !== loadSeq.current) return; // 더 새 요청이 시작됐거나 언마운트됨 — 이 결과는 버린다.
      setPartialError(anyFail);
      const flat = perBranch.flat();
      setRows(flat.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.branchName.localeCompare(b.branchName, "ko")));
    } catch {
      if (seq !== loadSeq.current) return;
      setPartialError(true);
      setRows([]);
    }
  }, [month]);

  useEffect(() => { void load(); }, [load]);

  // 지점 드롭다운은 화면 필터다(월과 달리 서버 재조회를 일으키지 않는다).
  const branchOptions = useMemo(() => modlogBranchOptions(rows || [], branch), [rows, branch]);
  const visibleRows = useMemo(() => (rows || []).filter((r) => !branch || r.branchName === branch), [rows, branch]);
  const totalDiff = visibleRows.reduce((s, r) => s + r.cashDifference, 0);
  const recentCutoff = modlogRecentCutoff();

  return (
    <div id="modlog-cash-diff" className={MODLOG_CARD}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="space-y-1.5">
          <h3 className={MODLOG_TITLE}>현금차이 이력</h3>
          {/* 요약(건수·합계)은 별도 KPI 박스 대신 부제 한 줄로 — 행 높이·세로 공간을 아낀다. */}
          <p className={MODLOG_SUB}>
            선택한 달의 현금 차이(실사현금 − 장부) · {rows === null ? "불러오는 중…" : `${visibleRows.length}건 · 합계 ${formatNumber(totalDiff)}원`}
          </p>
        </div>
        <ModlogFilters
          branches={branchOptions}
          branch={branch}
          onBranchChange={setBranch}
          month={month}
          onMonthChange={(value) => { if (value) setMonth(value); }}
          onRefresh={() => void load()}
          monthRequired
        />
      </div>

      {partialError && (
        <p className="text-[11px] font-bold text-rose-600">일부 지점의 이력을 서버에서 불러오지 못했습니다. 아래 목록이 일부 누락됐을 수 있습니다 — 새로고침 후 다시 확인해주세요.</p>
      )}

      <div className={MODLOG_SCROLL}>
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr>
              <th className={`${MODLOG_TH} w-24`}>마감일자</th>
              <th className={`${MODLOG_TH} w-28`}>지점</th>
              <th className={`${MODLOG_TH} w-28 text-right`}>현금차이</th>
              <th className={MODLOG_TH}>사유</th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr><td colSpan={4} className="py-8 text-center"><LoadingSpinner size="sm" /></td></tr>
            ) : visibleRows.length === 0 ? (
              <tr><td colSpan={4} className={MODLOG_EMPTY}>{month}{branch ? ` ${branch}에` : "에"} 기록된 현금차이가 없습니다.</td></tr>
            ) : (
              visibleRows.map((r, i) => (
                // 이 표에는 '등록 시각'이 없다(지점 마감 기록에서 그때그때 계산해 만든 행이라) → 마감일자로 최근 여부를 본다.
                <tr key={`${r.branchName}-${r.date}-${i}`} className={modlogRowClass(modlogIsRecent(r.date, recentCutoff))}>
                  <td className={`${MODLOG_TD} font-mono text-[11px] font-black text-blue-700 whitespace-nowrap`}>{r.date}</td>
                  <td className={`${MODLOG_TD} font-black text-gray-800 whitespace-nowrap`}>{r.branchName}</td>
                  <td className={`${MODLOG_TD} text-right font-mono font-black whitespace-nowrap ${r.cashDifference < 0 ? "text-rose-600" : "text-amber-600"}`}>
                    {r.cashDifference > 0 ? "+" : ""}{formatNumber(r.cashDifference)}원
                  </td>
                  <td className={`${MODLOG_TD} text-[11px] font-bold text-gray-600`}>{r.reason || <span className="text-gray-300">사유 미입력</span>}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 이상치 이력 캐시 유효시간 — 이 안에서는 날짜를 바꿔도 다시 읽지 않는다(수동 새로고침은 즉시 무효화).
const ANOMALY_CACHE_TTL_MS = 5 * 60 * 1000;

const MONTHLY_CLOSE_SECTIONS: Array<{ key: "salesSummary" | "purchase" | "salary"; label: string }> = [
  { key: "salesSummary", label: "매출집계" },
  { key: "purchase", label: "매입매출" },
  { key: "salary", label: "정직원 급여" },
];

// 법인 분류 — 지점명 키워드로 3개 법인으로 나눈다. 실제 지점명 표기가 다양해(연하동 대학로점/연하동 연남본점/
// 강남대골뼈국/카라멘야/마음죽) 정확 일치가 아닌 '키워드 포함'으로 매칭한다. 목록에 없는 나머지는 전부 UGD.
const CORP_GROUPS: Array<{ key: string; label: string }> = [
  { key: "ugd", label: "UGD" },
  { key: "karamenya", label: "카라멘야" },
  { key: "yeonhadong", label: "연하동" },
];
const corpOfBranch = (branchName: string): string => {
  const n = String(branchName || "");
  if (n.includes("카라멘야") || n.includes("마음죽")) return "karamenya";
  if (n.includes("연하동") || n.includes("대골뼈국")) return "yeonhadong";
  return "ugd";
};
const corpLabel = (key: string): string => CORP_GROUPS.find((c) => c.key === key)?.label || key;

const monthlyCloseBadge = (status: string | null) => {
  const label = status === "confirmed" ? "확정" : status === "editing" ? "수정중" : "미제출";
  const cls = status === "confirmed" ? "admin-monthly-status-confirmed" : status === "editing" ? "admin-monthly-status-editing" : "admin-monthly-status-pending";
  return <span className={`inline-flex px-2 py-1 rounded-lg text-[11px] font-black ${cls}`}>{label}</span>;
};

function AdminMonthlyClosingStatusSection() {
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [branches, setBranches] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  // '확정후수정' 버튼을 누르면 뜨는 말풍선. 표가 가로 스크롤 상자 안이라 화면(fixed) 좌표로 띄운다.
  const [modPopup, setModPopup] = useState<{ left: number; top?: number; bottom?: number; branch: string; section: "salary" | "purchase" | "salesSummary"; rec: any } | null>(null);
  // 말풍선을 띄운 버튼(앵커)을 기억해 스크롤 시 위치를 따라가게 한다(닫지 않는다).
  const modAnchorRef = useRef<HTMLElement | null>(null);
  // 버튼 좌표로부터 말풍선 위치를 계산한다: 아래 공간이 부족하면 위로 뒤집어 하단 잘림을 막는다.
  const computeModPos = useCallback((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const POPUP_W = 320, MARGIN = 8, EST_H = 240;
    const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - POPUP_W - MARGIN));
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < EST_H && r.top > spaceBelow;
    return openUp
      ? { left, top: undefined as number | undefined, bottom: Math.max(MARGIN, window.innerHeight - r.top + 6) }
      : { left, top: r.bottom + 6, bottom: undefined as number | undefined };
  }, []);
  const sectionLabel = (s: string) => (s === "salary" ? "정직원 급여대장" : s === "purchase" ? "매입매출" : "매출집계");
  // 관리자가 이 지점·섹션 엑셀을 마지막으로 다운로드한 시각(브라우저에 기록).
  const dlTimeKey = (branch: string, section: string) => `admin_section_dl_${branch}_${selectedMonth}_${section}`;
  const markDownloaded = (branch: string, section: string) => {
    try { localStorage.setItem(dlTimeKey(branch, section), new Date().toISOString()); } catch {}
  };

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [branchList, monthlyRecords] = await Promise.all([
        gasClient.getBranchList(),
        gasClient.getSharedData<any[]>("monthly_closings")
      ]);
      setBranches((branchList || []).filter(isMonthlyWorkBranch));
      setRecords(Array.isArray(monthlyRecords) ? monthlyRecords : []);
    } catch (error) {
      console.error("월말마감 현황 로드 실패:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const rows = useMemo(() => {
    return branches.map((branch) => {
      const bySection: Record<string, any> = {};
      MONTHLY_CLOSE_SECTIONS.forEach((s) => {
        bySection[s.key] = records
          .filter((r) => r.branchName === branch.branchName && r.month === selectedMonth && (r.section || "purchase") === s.key)
          .sort((a, b) => String(b.updatedAt || b.confirmedAt || "").localeCompare(String(a.updatedAt || a.confirmedAt || "")))[0] || null;
      });
      return { branch, bySection };
    });
  }, [branches, records, selectedMonth]);

  const sectionStats = useMemo(() => {
    const pendingCount = (key: string) => rows.filter((r) => r.bySection[key]?.status !== "confirmed").length;
    return {
      salary: pendingCount("salary"),
      purchase: pendingCount("purchase"),
      salesSummary: pendingCount("salesSummary"),
    };
  }, [rows]);

  // 지점·섹션별 마감 엑셀 내보내기 (기본 양식 — 최종 템플릿 확정 전 임시 데이터 덤프).
  // 서버 전용 읽기로 신선한 데이터를 받고, 실패 시 파일을 만들지 않고 중단한다.
  // 'purchase'는 5시트 통합 downloadBranchMonthlyClose가 담당하므로 타입에서 제외한다
  // (여기로 들어오면 else 분기를 타 정직원 급여 엑셀이 잘못 나간다).
  const downloadBranchSection = async (branchName: string, section: "salesSummary" | "salary") => {
    const num = (v: unknown) => Number(String(v ?? "").replace(/[^0-9.-]/g, "")) || 0;
    // '확정' 표시는 있으나 서버에 상세가 없을 때, 관리자에게 복구 방법을 안내한다.
    // (정산 산출물이므로 서버 전용 읽기를 유지한다 — 네트워크 실패는 아래 바깥 catch에서 다운로드 취소로 처리.)
    const emptyMsg = (label: string, tab: string) =>
      `${branchName} · ${selectedMonth} ${label} 상세 데이터가 서버에 없습니다.\n\n` +
      `'확정' 표시는 있으나 실제 내역이 서버에 저장돼 있지 않습니다.\n` +
      `해당 지점에서 [월말마감 → ${tab}] 탭을 연 뒤 저장하고 다시 '확정'하면 다운로드됩니다.`;
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      let filename = "";
      if (section === "salesSummary") {
        const s: any = await gasClient.getSharedDataFromServer<any>(`monthly_sales_summary:${branchName}:${selectedMonth}`);
        if (!s || typeof s !== "object") { window.alert(emptyMsg("매출집계", "매출집계")); return; }
        const summaryRows = [
          { 항목: "총매출", 값: num(s.totalSales) },
          { 항목: "총할인", 값: num(s.totalDiscount) },
          { 항목: "실매출", 값: num(s.netSales) },
          { 항목: "영수건수", 값: num(s.receiptCount) },
          { 항목: "카드결제", 값: num(s.cardPay) },
          { 항목: "단순현금결제", 값: num(s.cashPlain) },
          { 항목: "현금영수증", 값: num(s.cashReceipt) },
          { 항목: "메뉴매출", 값: num(s.menuSales) },
          { 항목: "주류매출", 값: num(s.liquorSales) },
          { 항목: "자리값", 값: num(s.seatCharge) },
          { 항목: "빈칸 사유", 값: s.blankReason || "" },
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "매출집계");
        filename = `${branchName}_${selectedMonth}_매출집계.xlsx`;
      } else {
        // 매입매출(purchase) 섹션은 downloadBranchMonthlyClose(5시트 통합)로 처리하므로 여기서는 정직원 급여만 담당한다.
        const salary: any = await gasClient.getSharedDataFromServer<any[]>(`monthly_fulltime_salary:${branchName}:${selectedMonth}`);
        if (!Array.isArray(salary) || !salary.length) { window.alert(emptyMsg("정직원 급여", "정직원 급여대장")); return; }
        // 본사 표준 양식(2026.06 대학로고래 급여내역)과 동일한 모양(색·테두리·병합·수식·열너비)으로 만든다.
        // 일반 xlsx 모듈은 셀 스타일을 버리므로, 조립부터 저장까지 xlsx-js-style로 해야 서식이 살아남는다.
        const XLSXSMod: any = await import("xlsx-js-style");
        // 동적 import 상호운용: 번들러/런타임에 따라 utils가 최상위 또는 default에 위치할 수 있어 정규화한다
        // (assembleMonthlyCloseWorkbook:485와 동일 규칙 — 정규화 없이 쓰면 런타임에서 utils undefined로 터질 수 있다).
        const XLSXS: any = XLSXSMod && XLSXSMod.utils ? XLSXSMod : (XLSXSMod && XLSXSMod.default) ? XLSXSMod.default : XLSXSMod;
        const { buildFullTimeSalarySheet, fullTimeSalarySheetName } = await import("./branch/helpers/fullTimeSalaryWorkbook");
        const wbStyled = XLSXS.utils.book_new();
        XLSXS.utils.book_append_sheet(wbStyled, buildFullTimeSalarySheet(XLSXS, branchName, selectedMonth, salary), fullTimeSalarySheetName(selectedMonth));
        XLSXS.writeFile(wbStyled, `${branchName}_${selectedMonth}_정직원급여.xlsx`);
        markDownloaded(branchName, "salary"); // 파일이 실제로 저장된 뒤에만 '내 다운로드 시각' 기록(빈데이터/실패 시 기록 안 함)
        return;
      }
      XLSX.writeFile(wb, filename);
      markDownloaded(branchName, section); // 저장 성공 뒤에만 기록(여기 도달하면 section === "salesSummary")
    } catch (error) {
      console.error("마감 엑셀 다운로드 실패:", error);
      window.alert("마감 데이터를 서버에서 불러오지 못해 엑셀 다운로드를 취소했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.");
    }
  };

  // 지점 '월말마감' 엑셀 — 옛 지점화면과 동일한 5개 시트(매입매출·파트타이머급여·현금지출·카드지출·현금관리)를
  // 한 파일로 생성한다. 개편(1b22d0e) 전 지점화면 handleDownloadExcel을 관리자용으로 이식(데이터는 서버에서 신선하게 조회).
  const downloadBranchMonthlyClose = async (branchName: string) => {
    try {
      // fail-closed + 서버 전용: 모든 소스를 캐시 폴백 없는 서버 전용 리더로 읽고, 하나라도 실패(throw)하면
      // Promise.all이 reject → 아래 catch에서 다운로드를 취소한다. 실패를 삼켜 빈/오래된 데이터로 채우면
      // 파트타이머급여·현금지출·카드지출·현금관리 시트가 '데이터 없음/구값'인 채 '정상 파일'처럼 다운로드돼
      // (중복이체·누락·stale) 눈에 띄지 않는 오류가 된다. (전지점 매출집계 다운로드와 동일한 fail-closed 원칙)
      const [purchases, roster, salaries, exclusions, profiles, history] = await Promise.all([
        gasClient.getSharedDataFromServer<any[]>(`monthly_purchases:${branchName}:${selectedMonth}`),
        gasClient.getBranchOwnRosterFromServer(branchName),
        gasClient.getSharedDataFromServer<any[]>(`part_time_salaries:${branchName}:${selectedMonth}`),
        gasClient.getSharedDataFromServer<string[]>(`part_time_salary_exclusions:${branchName}:${selectedMonth}`),
        gasClient.getSharedDataFromServer<Record<string, any>>(`part_time_profiles:${branchName}`),
        gasClient.getBranchHistoryFromServer(branchName, selectedMonth),
      ]);

      // 매입매출 확정건에는 매입 데이터가 있어야 정상. 서버가 정상 응답했으나 비어 있으면(레거시/미저장) 재확정을 안내하고 중단.
      if (!Array.isArray(purchases) || purchases.length === 0) {
        window.alert(
          `${branchName} · ${selectedMonth} 월말마감(매입매출) 상세 데이터가 서버에 없습니다.\n\n` +
          `'확정' 표시는 있으나 실제 내역이 서버에 저장돼 있지 않습니다.\n` +
          `해당 지점에서 [월말마감 → 매입매출] 탭을 연 뒤 저장하고 다시 '확정'하면 다운로드됩니다.`
        );
        return;
      }
      // 성명을 몰라 워크북에서 빠질 파트타이머 급여 행이 있으면 내려받지 않는다.
      // 조용히 빠지면 실제로 일한 사람의 급여가 누락된 채 '정상 파일'처럼 보인다.
      // 판단 기준은 워크북 빌더와 같은 함수를 쓴다 — 각자 판단하면 어긋나서 구멍이 생긴다.
      const unnamedSalaryRows = unnamedPartTimeSalaryRows({ salaries, roster, exclusions });
      if (unnamedSalaryRows.length > 0) {
        window.alert(
          `${branchName} · ${selectedMonth} 파트타이머 급여대장에 성명이 비어 있는 행이 ${unnamedSalaryRows.length}건 있습니다.\n\n` +
          `이름 없는 행은 급여 엑셀에 넣을 수 없어 다운로드를 중단했습니다.\n` +
          `해당 지점에서 [월말마감 → 파트타이머 급여대장] 탭을 열어 성명을 채우거나, 필요 없는 행이면 삭제(X)한 뒤 다시 받아주세요.`
        );
        return;
      }
      // 확정 게이트와 동일 기준: export에 0 초과 금액으로 나가는 행이 하나도 없으면(레거시/빈 확정) 빈 워크북을 만들지 않고 중단.
      if (!purchases.some(purchaseRowHasExportableAmount)) {
        window.alert(
          `${branchName} · ${selectedMonth} 월말마감(매입매출)에 실제 금액이 있는 내역이 없습니다.\n\n` +
          `모든 행의 이체필요/이달사용 금액이 비어 있어 다운로드할 내용이 없습니다.\n` +
          `해당 지점에서 [월말마감 → 매입매출] 탭에서 금액을 입력하고 다시 '확정'해주세요.`
        );
        return;
      }

      const data: MonthlyCloseData = {
        branchName,
        month: selectedMonth,
        purchases,
        roster: Array.isArray(roster) ? roster : [],
        salaries: Array.isArray(salaries) ? salaries : [],
        exclusions: Array.isArray(exclusions) ? exclusions : [],
        profiles: profiles && typeof profiles === "object" ? profiles : {},
        history: Array.isArray(history) ? history : [],
      };

      const XLSX = await import("xlsx-js-style");
      const wb = assembleMonthlyCloseWorkbook(XLSX, data);
      const monthNumber = Number(selectedMonth.split("-")[1]) || 0;
      XLSX.writeFile(wb, `월말정산_${branchName}${monthNumber}월_결산자료.xlsx`);
      markDownloaded(branchName, "purchase"); // 파일이 실제로 저장된 뒤에만 '내 다운로드 시각' 기록
    } catch (error) {
      console.error("월말마감 엑셀 다운로드 실패:", error);
      window.alert("월말마감 데이터를 서버에서 불러오지 못해 엑셀 다운로드를 취소했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.");
    }
  };

  // 매출집계 엑셀 (첨부 양식: POS 매출집계 컬럼 구성, 한 지점당 한 행).
  // branchFilter로 대상 지점을 좁히고 label로 파일명을 정한다(전지점/법인별 공용 — 정직원급여 통합과 같은 패턴).
  const downloadSalesSummary = async (branchFilter: (name: string) => boolean, label: string, confirmedOnly = false) => {
    const num = (v: unknown) => Number(String(v ?? "").replace(/[^0-9.-]/g, "")) || 0;
    try {
      const XLSX = await import("xlsx");
      const allBranches = branches.length ? branches : (await gasClient.getBranchList()).filter(isMonthlyWorkBranch);
      // 법인별 배치(confirmedOnly): 정직원급여 통합과 동일 기준 — '확정(제출)'한 지점만 내보낸다.
      // 확정 상태는 서버에서 '신선하게' 읽어 fail-closed로 거른다. 화면 캐시(records)로만 거르면 방금 다른 기기에서
      // '수정중/미제출'로 바뀐 지점을 못 걸러, 미확정 매출집계가 최종본처럼 섞여 나갈 수 있다.
      // (헤더의 '전지점 매출집계'는 수집현황 덤프라 confirmedOnly=false로 전체를 유지한다.)
      let confirmedSet: Set<string> | null = null;
      if (confirmedOnly) {
        let freshRecords: any[];
        try {
          const fr = await gasClient.getSharedDataFromServer<any[]>("monthly_closings");
          if (!Array.isArray(fr)) throw new Error("invalid monthly_closings");
          freshRecords = fr;
        } catch {
          window.alert("마감 확정 상태를 서버에서 확인하지 못해 다운로드를 취소했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.");
          return;
        }
        confirmedSet = new Set(
          freshRecords
            .filter((r) => r.month === selectedMonth && (r.section || "purchase") === "salesSummary" && r.status === "confirmed")
            .map((r) => r.branchName)
        );
      }
      const branchList = allBranches.filter((b: any) => branchFilter(b.branchName) && (!confirmedSet || confirmedSet.has(b.branchName)));
      if (branchList.length === 0) {
        window.alert(confirmedOnly ? `${label} 중 ${selectedMonth} 매출집계를 '확정(제출)'한 지점이 없습니다.` : `${label}에 해당하는 지점이 없습니다.`);
        return;
      }
      const summaries = await Promise.all(branchList.map(async (b: any) => {
        try {
          const s = await gasClient.getSharedDataFromServer<any>(`monthly_sales_summary:${b.branchName}:${selectedMonth}`);
          return { branch: b, s: s && typeof s === "object" ? s : null, failed: false };
        } catch { return { branch: b, s: null, failed: true }; }
      }));
      // 읽기 실패를 삼키면 그 지점이 "빈 데이터(0/미입력)"처럼 보여 불완전한 파일이 나간다 → 하나라도 실패하면 전체 취소.
      const failedBranches = summaries.filter((r) => r.failed).map((r) => r.branch.branchName);
      if (failedBranches.length > 0) {
        window.alert(`다음 지점의 매출집계를 서버에서 불러오지 못해 다운로드를 취소했습니다:\n${failedBranches.join(", ")}\n네트워크 상태를 확인한 뒤 다시 시도해주세요. (불완전한 파일은 생성하지 않았습니다.)`);
        return;
      }
      // 법인별 배치(confirmedOnly): '확정'인데 매출집계 상세가 서버에 비어 있는(문서 없음) 지점은
      // 0/미입력 행으로 최종본에 섞이지 않게 — 정직원급여 통합의 confirmedButEmpty와 동일하게 — 명시적으로 알리고
      // 빼고 받을지 관리자가 정한다. 전지점 수집덤프(confirmedOnly=false)는 미입력 지점을 '미입력'으로 담는 게 목적이라 제외.
      let rowsSource = summaries;
      if (confirmedOnly) {
        const confirmedButEmpty = summaries.filter((r) => !r.s).map((r) => r.branch.branchName);
        if (confirmedButEmpty.length > 0) {
          const proceed = window.confirm(
            `다음 지점은 '확정' 표시가 있으나 매출집계 내역이 서버에 비어 있습니다:\n${confirmedButEmpty.join(", ")}\n\n` +
            `이 지점들은 통합 파일에서 빠집니다. 빼고 나머지만 받으시겠습니까?\n` +
            `(취소하면 다운로드를 멈춥니다 — 해당 지점에서 [월말마감 → 매출집계]를 연 뒤 저장하고 다시 '확정'하면 포함됩니다.)`
          );
          if (!proceed) return;
        }
        rowsSource = summaries.filter((r) => r.s);
        if (rowsSource.length === 0) { window.alert(`${selectedMonth} 매출집계가 저장된 지점이 없습니다.`); return; }
      }
      const excelRows = rowsSource.map(({ branch, s }) => {
        const d: any = s || {};
        const net = num(d.netSales);
        const cnt = num(d.receiptCount);
        return {
          "수집일시": "",
          "연월": selectedMonth,
          "지점코드": "",
          "지점명": branch.branchName,
          "pos_type": "",
          "총매출": num(d.totalSales),
          "총할인": num(d.totalDiscount),
          "실매출": net,
          "영수건수": cnt,
          "영수단가": cnt > 0 ? Math.round(net / cnt) : 0,
          "결제합계": num(d.cardPay) + num(d.cashPlain) + num(d.cashReceipt),
          "단순현금": num(d.cashPlain),
          "현금영수증": num(d.cashReceipt),
          "신용카드": num(d.cardPay),
          "수집상태": s ? "입력완료" : "미입력",
          "비고": "",
          "메뉴매출": num(d.menuSales),
          "주류매출": num(d.liquorSales),
          "자리값": num(d.seatCharge),
          "자리값내역": "",
        };
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(excelRows), "매출집계");
      XLSX.writeFile(wb, `${label}_매출집계_${selectedMonth}.xlsx`);
    } catch (error) {
      console.error("매출집계 다운로드 실패:", error);
      window.alert("매출집계 데이터를 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.");
    }
  };
  // 매출집계는 전지점 통합(헤더 버튼, 수집현황 덤프 = 전체)과 법인별 통합(법인 밴드 버튼, 확정 지점만) 둘 다 제공한다.
  const downloadAllSalesSummary = () => downloadSalesSummary(() => true, "전지점");
  const downloadCorpSalesSummary = (corpKey: string) => downloadSalesSummary((name) => corpOfBranch(name) === corpKey, `${corpLabel(corpKey)}법인`, true);

  // 전지점 정직원 급여를 하나의 엑셀로 — 지점마다 시트를 나눈다(본사 표준 양식 그대로).
  // 정직원급여 통합 다운로드(법인/전지점 공용). branchFilter로 대상 지점을 좁히고, label로 파일명/안내문을 정한다.
  const downloadFullTimeSalary = async (branchFilter: (name: string) => boolean, label: string) => {
    try {
      const branchList = branches.length ? branches : (await gasClient.getBranchList()).filter(isMonthlyWorkBranch);
      // '확정(제출)'한 지점만 포함한다 — 지점별 다운로드 버튼과 같은 기준. 미제출·수정중 지점(예: 한남점)이 섞여 나가지 않게 한다.
      // 확정 판정은 화면 캐시(records)가 아니라 '서버에서 신선하게' 읽는다: 관리자가 새로고침 전이면
      // 방금 다른 기기에서 '수정중/미제출'로 바뀐 지점을 못 걸러 잘못된 통합본이 나갈 수 있다(fail-closed — 못 읽으면 취소).
      let freshRecords: any[];
      try {
        const fr = await gasClient.getSharedDataFromServer<any[]>("monthly_closings");
        if (!Array.isArray(fr)) throw new Error("invalid monthly_closings");
        freshRecords = fr;
      } catch {
        window.alert("마감 확정 상태를 서버에서 확인하지 못해 다운로드를 취소했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.");
        return;
      }
      const confirmedSalary = new Set(
        freshRecords.filter((r) => r.month === selectedMonth && (r.section || "purchase") === "salary" && r.status === "confirmed").map((r) => r.branchName)
      );
      const targets = branchList.filter((b: any) => confirmedSalary.has(b.branchName) && branchFilter(b.branchName));
      if (targets.length === 0) { window.alert(`${label} 중 ${selectedMonth} 정직원 급여를 '확정(제출)'한 지점이 없습니다.`); return; }
      const loaded = await Promise.all(targets.map(async (b: any) => {
        try {
          const s = await gasClient.getSharedDataFromServer<any[]>(`monthly_fulltime_salary:${b.branchName}:${selectedMonth}`);
          return { branch: b, salary: Array.isArray(s) ? s : [], failed: false };
        } catch { return { branch: b, salary: [] as any[], failed: true }; }
      }));
      // 읽기 실패를 삼키면 그 지점이 '데이터 없음'처럼 빠져 불완전한 통합 파일이 나간다 → 하나라도 실패하면 전체 취소.
      const failed = loaded.filter((r) => r.failed).map((r) => r.branch.branchName);
      if (failed.length > 0) {
        window.alert(`다음 지점의 정직원 급여를 서버에서 불러오지 못해 다운로드를 취소했습니다:\n${failed.join(", ")}\n네트워크 확인 후 다시 시도해주세요. (불완전한 파일은 만들지 않았습니다.)`);
        return;
      }
      // 확정했는데 급여 내역이 비어 있는 지점 — 뭔가 잘못된 상태다('확정'하려면 내역이 있어야 함).
      // 조용히 빼고 완성본처럼 저장하면 관리자가 누락을 모른 채 급여를 지급할 수 있어 위험하다 → 반드시 알리고 관리자가 결정한다.
      const confirmedButEmpty = loaded.filter((r) => !r.failed && r.salary.length === 0).map((r) => r.branch.branchName);
      const withData = loaded.filter((r) => r.salary.length > 0);
      if (confirmedButEmpty.length > 0) {
        const proceed = window.confirm(
          `다음 지점은 '확정' 표시가 있으나 급여 내역이 서버에 비어 있습니다:\n${confirmedButEmpty.join(", ")}\n\n` +
          `이 지점들은 통합 파일에서 빠집니다. 빼고 나머지만 받으시겠습니까?\n` +
          `(취소하면 다운로드를 멈춥니다 — 해당 지점에서 [월말마감 → 정직원 급여대장]을 연 뒤 저장하고 다시 '확정'하면 포함됩니다.)`
        );
        if (!proceed) return;
      }
      if (withData.length === 0) { window.alert(`${selectedMonth} 정직원 급여대장이 저장된 지점이 없습니다.`); return; }

      const XLSXSMod: any = await import("xlsx-js-style");
      const XLSXS: any = XLSXSMod && XLSXSMod.utils ? XLSXSMod : (XLSXSMod && XLSXSMod.default) ? XLSXSMod.default : XLSXSMod;
      const { buildFullTimeSalarySheet } = await import("./branch/helpers/fullTimeSalaryWorkbook");
      const wb = XLSXS.utils.book_new();
      const usedNames = new Set<string>();
      withData.forEach(({ branch, salary }) => {
        // 엑셀 시트명 제약: 31자 이하 + \/?*[]: 금지 + 중복 불가.
        let name = String(branch.branchName).replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "지점";
        let n = name, i = 2;
        while (usedNames.has(n)) { const suffix = `(${i++})`; n = `${name.slice(0, 31 - suffix.length)}${suffix}`; }
        usedNames.add(n);
        XLSXS.utils.book_append_sheet(wb, buildFullTimeSalarySheet(XLSXS, branch.branchName, selectedMonth, salary), n);
      });
      XLSXS.writeFile(wb, `${label}_정직원급여_${selectedMonth}.xlsx`);
      // 파일이 실제로 저장된 뒤에만 '내 다운로드 시각'을 기록한다(중간 취소/실패 시에는 기록하지 않음).
      withData.forEach(({ branch }) => markDownloaded(branch.branchName, "salary"));
    } catch (error) {
      console.error("정직원급여 통합 다운로드 실패:", error);
      window.alert("정직원 급여 데이터를 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.");
    }
  };
  // 정직원급여는 법인별로만 받는다(전지점 통합 버튼은 UI에서 삭제됨). 매출집계는 전지점 통합만 유지.
  const downloadCorpFullTimeSalary = (corpKey: string) => downloadFullTimeSalary((name) => corpOfBranch(name) === corpKey, `${corpLabel(corpKey)}법인`);

  // 확정 후 수정 여부: 지점이 확정된 섹션을 '수정'으로 다시 연 순간 기록되는 플래그(재확정해도 유지, 오탐 없음).
  // 버튼을 누르면 말풍선으로 (내 다운로드 시각 + 수정 이력)을 보여준다.
  // 취소되어 '미제출(pending)'인 섹션은 표시하지 않는다 — 초기화 정리 저장이 실패해 표식이 찌꺼기로 남아도 무해하게 한다.
  // 수정기록 버튼 — 엑셀 다운로드 버튼처럼 항상 자리에 있고, '확정 후 수정' 기록이 있을 때만 색이 켜져(검정) 클릭할 수 있다.
  // 기록이 없으면 회색 비활성. 클릭하면 말풍선으로 (내 다운로드 시각 + 수정 이력)을 보여준다. 스타일·크기는 엑셀 버튼과 통일.
  const modifiedButton = (rec: any, branchName: string, section: "salary" | "purchase" | "salesSummary") => {
    const has = !!rec?.editedAfterConfirm && rec?.status !== "pending";
    return (
      <button
        type="button"
        disabled={!has}
        onClick={has ? (e) => {
          modAnchorRef.current = e.currentTarget;
          const pos = computeModPos(e.currentTarget);
          setModPopup({ ...pos, branch: branchName, section, rec });
        } : undefined}
        title={has ? "확정 후 수정한 기록 보기" : "수정 기록 없음"}
        className={`inline-flex h-7 w-[76px] items-center justify-center gap-1 rounded-md text-[11px] font-black transition-colors ${has ? "bg-[#212121] text-white hover:bg-black cursor-pointer" : "bg-[#E5E7EB] text-[#6B7280] cursor-not-allowed"}`}
      >
        <Edit3 className="w-3 h-3" /> 수정기록
      </button>
    );
  };

  // 말풍선은 화면 좌표로 고정해 띄운다. 스크롤/리사이즈 때 '닫지 말고' 앵커 버튼을 따라 위치만 갱신한다
  // (예전엔 스크롤=닫기라 내용을 읽으려 스크롤하면 바로 꺼졌다). 버튼이 화면 밖으로 사라지면 그때만 닫는다.
  useEffect(() => {
    if (!modPopup) return;
    let raf = 0;
    const reposition = () => {
      const el = modAnchorRef.current;
      if (!el) { setModPopup(null); return; }
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) { setModPopup(null); return; }
      const pos = computeModPos(el);
      setModPopup((prev) => (prev ? { ...prev, ...pos } : prev));
    };
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(reposition); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setModPopup(null); };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onKey);
    };
    // 대상(지점·섹션)이 바뀔 때만 재장착 — 위치 갱신(setModPopup)마다 재장착되지 않게 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modPopup?.branch, modPopup?.section, computeModPos]);

  return (
    <section className="admin-monthly-closing-status-section bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
      {/* 헤더: 제목 + 전지점 매출집계 + 월 선택 + 새로고침 (컴팩트 h-8 컨트롤) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="space-y-1.5">
          {/* 섹션 제목 = 바닐라 알약(지점 DESIGN.md §6, 색만 연한 관리자 바닐라). bg-amber-50 → var(--admin-vanilla) */}
          <h2 className="inline-flex w-fit items-center rounded-full border border-[#212121] bg-amber-50 px-3 py-1.5 text-[11px] font-black text-gray-900">제출현황</h2>
          <p className="text-[11px] text-gray-400">선택한 월 기준 지점별 3개 마감(매출집계·매입매출·정직원 급여) 상태</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* 정직원급여·매출집계 '법인별' 배치 다운로드는 각 법인 밴드(제목 행)에 있다.
              여기 '전지점 매출집계'는 모든 법인을 한 번에 받는 전체용으로 유지한다. */}
          <button type="button" onClick={() => void downloadAllSalesSummary()} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#1A3C6E]/25 bg-white px-2.5 text-[11px] font-black text-[#1A3C6E] hover:bg-[#2E6DB4]/10 cursor-pointer">
            <Download className="w-3.5 h-3.5" /> 전지점 매출집계
          </button>
          <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-bold" />
          <button onClick={() => void loadData()} className="h-8 rounded-lg bg-[#2E6DB4] text-white px-3 text-[11px] font-black cursor-pointer">새로고침</button>
        </div>
      </div>

      {/* 미제출 요약 카드 3개 — 섹션과 구분되는 배경색 + 검정 테두리 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-[#212121] bg-[#FBF4E6] px-3 py-2.5 flex items-center justify-between gap-2"><span className="text-[11px] font-black text-gray-800 leading-tight">정직원 급여<br />미제출</span><span className="text-xl font-black text-gray-900">{sectionStats.salary}</span></div>
        <div className="rounded-xl border border-[#212121] bg-[#FBF4E6] px-3 py-2.5 flex items-center justify-between gap-2"><span className="text-[11px] font-black text-gray-800 leading-tight">매입매출<br />미제출</span><span className="text-xl font-black text-gray-900">{sectionStats.purchase}</span></div>
        <div className="rounded-xl border border-[#212121] bg-[#FBF4E6] px-3 py-2.5 flex items-center justify-between gap-2"><span className="text-[11px] font-black text-gray-800 leading-tight">매출집계<br />미제출</span><span className="text-xl font-black text-gray-900">{sectionStats.salesSummary}</span></div>
      </div>

      {/* 법인별 3개 섹션 — 각 법인을 제목 + 테두리로 묶고, 제목 옆에 그 법인 정직원급여 다운로드 버튼 */}
      {loading ? (
        <div className="py-10 text-center"><LoadingSpinner size="sm" /></div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-gray-400 font-bold text-xs">등록된 지점이 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {CORP_GROUPS.map((corp) => {
            const items = rows.filter(({ branch }) => corpOfBranch(branch.branchName) === corp.key);
            if (items.length === 0) return null;
            return (
              <div key={corp.key} className="rounded-2xl border border-[#212121] bg-white overflow-hidden">
                {/* 법인 제목 밴드 + 그 법인 배치 다운로드 버튼(정직원급여 받기 · 매출집계 전체).
                    bg-amber-50 → var(--admin-vanilla)(연한 바닐라). 버튼은 검정 알약(지점 DESIGN.md §10). */}
                <div className="flex items-center justify-between gap-2 flex-wrap px-4 py-2.5 border-b border-[#212121] bg-amber-50">
                  <h3 className="text-sm font-black text-gray-900">{corp.label} 법인 <span className="text-gray-500 font-bold text-[11px]">· {items.length}개 지점</span></h3>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button type="button" onClick={() => void downloadCorpFullTimeSalary(corp.key)} title={`${corp.label} 법인의 확정 지점 정직원급여를 한 파일로 받습니다`} className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#212121] text-white px-3 text-[11px] font-black hover:bg-black cursor-pointer whitespace-nowrap">
                      <Download className="w-3.5 h-3.5" /> 정직원급여 받기
                    </button>
                    <button type="button" onClick={() => void downloadCorpSalesSummary(corp.key)} title={`${corp.label} 법인 매출집계를 한 파일로 받습니다`} className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#212121] text-white px-3 text-[11px] font-black hover:bg-black cursor-pointer whitespace-nowrap">
                      <Download className="w-3.5 h-3.5" /> 매출집계 전체
                    </button>
                  </div>
                </div>
                {/* 그 법인 지점 표 */}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-xs table-fixed">
                    {/* 표 헤더 = 엘리스(admin-redesign thead tr, 연한 엘리스블루). 라벨은 text-[#212121]로 100% 검정
                        (text-gray-*는 68% 회색으로 치환돼 흐려짐 — DESIGN.md §9-1).
                        법인별 배치 다운로드 버튼은 위 법인 밴드에 있다. 여기 헤더는 라벨만.
                        table-fixed + 각 th 고정폭 → 법인 표가 여러 개라도 컬럼 x위치가 항상 같게 정렬된다
                        (auto 레이아웃이면 법인마다 지점명 길이로 '지점' 폭이 달라져 뒤 컬럼이 어긋난다). */}
                    <thead className="text-left text-[11px] font-black border-b bg-gray-50">
                      <tr>
                        <th className="w-[160px] py-2 px-3 text-[#212121]">지점</th>
                        <th className="w-[220px] py-2 px-3 text-center text-[#212121]">정직원급여</th>
                        <th className="w-[220px] py-2 px-3 text-center text-[#212121]">월말마감</th>
                        <th className="w-[160px] py-2 px-3 text-center text-[#212121]">매출집계</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {items.map(({ branch, bySection }) => {
                        const dlBtn = (section: "salesSummary" | "purchase" | "salary") => {
                          const ok = bySection[section]?.status === "confirmed";
                          return (
                            <button
                              type="button"
                              disabled={!ok}
                              onClick={() => { void (section === "purchase" ? downloadBranchMonthlyClose(branch.branchName) : downloadBranchSection(branch.branchName, section)); }}
                              title={ok ? "엑셀 다운로드 (기본 양식)" : "확정된 마감만 다운로드할 수 있습니다"}
                              // 확정/미확정 버튼 크기·모양을 동일하게: 두 상태 모두 같은 고정폭(w-[60px]) + 중앙정렬 + 솔리드 채움 박스.
                              // 확정=검정 솔리드/흰 글자, 미확정=회색 솔리드/옅은 글자 — 채움 '방식'이 같아 크기가 동일하게 읽힌다(꽉 찬 검정만 커 보이던 착시 제거).
                              className={`inline-flex h-7 w-[60px] items-center justify-center gap-1 rounded-md text-[11px] font-black transition-colors ${ok ? "bg-[#212121] text-white hover:bg-black cursor-pointer" : "bg-[#E5E7EB] text-[#6B7280] cursor-not-allowed"}`}
                            >
                              <Download className="w-3 h-3" /> 엑셀
                            </button>
                          );
                        };
                        return (
                          <tr key={`${branch.branchName}-${selectedMonth}`} className="hover:bg-slate-50/60">
                            <td className="py-2 px-3 font-black text-gray-800 truncate" title={branch.branchName}>{branch.branchName}</td>
                            {/* 상태 캡 바로 오른쪽에 다운로드 버튼 + (있으면) 확정후수정 표시를 붙인다 — 별도 '엑셀' 컬럼을 두지 않는다(사용자 지정). */}
                            <td className="py-2 px-3 text-center">
                              <span className="inline-flex items-center justify-center gap-1 flex-wrap">
                                {monthlyCloseBadge(bySection.salary?.status || null)}
                                {dlBtn("salary")}
                                {modifiedButton(bySection.salary, branch.branchName, "salary")}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-center">
                              <span className="inline-flex items-center justify-center gap-1 flex-wrap">
                                {monthlyCloseBadge(bySection.purchase?.status || null)}
                                {dlBtn("purchase")}
                                {modifiedButton(bySection.purchase, branch.branchName, "purchase")}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-center">
                              <span className="inline-flex items-center justify-center gap-1 flex-wrap">
                                {monthlyCloseBadge(bySection.salesSummary?.status || null)}
                                {modifiedButton(bySection.salesSummary, branch.branchName, "salesSummary")}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modPopup && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setModPopup(null)} />
          <div className="fixed z-50 w-[320px] rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl" style={{ top: modPopup.top, bottom: modPopup.bottom, left: modPopup.left }} role="dialog">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-black text-amber-800">확정한 뒤 수정한 기록이 있습니다</p>
              <button type="button" onClick={() => setModPopup(null)} className="text-gray-400 hover:text-gray-700"><X className="w-3.5 h-3.5" /></button>
            </div>
            {(() => {
              const dl = (() => { try { return localStorage.getItem(dlTimeKey(modPopup.branch, modPopup.section)); } catch { return null; } })();
              const events: any[] = Array.isArray(modPopup.rec?.editEvents) ? modPopup.rec.editEvents : [];
              return (
                <div className="mt-2 space-y-2 text-[11px] font-bold">
                  <p className="text-gray-600">{modPopup.branch} · {sectionLabel(modPopup.section)}</p>
                  <p className={dl ? "text-[#1A3C6E]" : "text-gray-400"}>
                    내가 엑셀을 다운로드한 시각: {dl ? new Date(dl).toLocaleString() : "이 브라우저에서 받은 기록 없음"}
                  </p>
                  <div className="border-t border-gray-100 pt-2 space-y-1.5 max-h-[40vh] overflow-y-auto">
                    <p className="text-gray-500">수정 이력 (시각 · 지점이 입력한 사유)</p>
                    {events.length === 0 ? (
                      <p className="text-gray-700">· 최종 수정 {modPopup.rec?.updatedAt ? new Date(modPopup.rec.updatedAt).toLocaleString() : "-"}</p>
                    ) : (
                      events.slice().reverse().map((ev, i) => (
                        <div key={i} className="text-gray-700">
                          <p>· 수정 {ev?.at ? new Date(ev.at).toLocaleString() : "-"}</p>
                          <p className={`pl-3 ${ev?.reason ? "text-gray-600" : "text-gray-400"}`}>사유: {ev?.reason || "미입력(옛 기록)"}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </>
      )}
    </section>
  );
}

function AdminManualOvertimesSection() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchBranch, setSearchBranch] = useState("");
  // 월은 비워 두면 전체 기간(정산 변경이력과 동일 규칙).
  const [searchMonth, setSearchMonth] = useState("");

  const loadData = async () => {
    try {
      setLoading(true);
      setRecords((await gasClient.getAllManualOvertimes()) || []);
    } catch (err) {
      console.error("Failed to load manual overtimes:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const branchOptions = useMemo(() => modlogBranchOptions(records, searchBranch), [records, searchBranch]);

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      const matchBranch = !searchBranch || r.branchName === searchBranch;
      return matchBranch && modlogInMonth(r.settleDate, searchMonth);
    }).sort((a, b) => {
      const dateA = a.createdAt || a.settleDate || "";
      const dateB = b.createdAt || b.settleDate || "";
      return dateB.localeCompare(dateA);
    });
  }, [records, searchBranch, searchMonth]);

  const deleteManualRecord = async (record: any) => {
    if (!record?.branchName || !record?.id) return;
    if (!window.confirm(`${record.branchName} ${record.staffName || ""} ${record.settleDate || ""} 수기 초과근무 내역을 삭제할까요?`)) return;
    try {
      const key = `manual_overtime:${record.branchName}`;
      const previous = await gasClient.getSharedData<any[]>(key);
      const next = (previous || []).filter((item: any) => item.id !== record.id);
      await gasClient.saveSharedData(key, next);
      await loadData();
    } catch (error) {
      console.error("수기 초과근무 삭제 실패:", error);
      alert("수기 초과근무 삭제에 실패했습니다.");
    }
  };

  const formatShortDate = (isoStr?: string) => {
    if (!isoStr) return "-";
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const date = String(d.getDate()).padStart(2, "0");
      const hour = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      return `${year}-${month}-${date} ${hour}:${min}`;
    } catch {
      return isoStr;
    }
  };

  const recentCutoff = modlogRecentCutoff();
  const recentCount = filteredRecords.filter((r) => modlogIsRecent(r.createdAt, recentCutoff)).length;

  return (
    <div id="modlog-manual-overtimes" className={MODLOG_CARD}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="space-y-1.5">
          <h3 className={MODLOG_TITLE}>수기 초과근무 대장</h3>
          <p className={MODLOG_SUB}>지점이 수기로 등록한 초과근무 · 총 {filteredRecords.length}건{recentCount > 0 ? ` (최근 3일 ${recentCount}건)` : ""}</p>
        </div>
        <ModlogFilters
          branches={branchOptions}
          branch={searchBranch}
          onBranchChange={setSearchBranch}
          month={searchMonth}
          onMonthChange={setSearchMonth}
          onRefresh={() => void loadData()}
        />
      </div>

      <div className={MODLOG_SCROLL}>
        <table className="w-full min-w-[700px] text-xs">
          <thead>
            <tr>
              <th className={`${MODLOG_TH} w-28`}>등록일시</th>
              <th className={`${MODLOG_TH} w-24`}>지점명</th>
              <th className={`${MODLOG_TH} w-24`}>대상일</th>
              <th className={`${MODLOG_TH} w-20`}>직원명</th>
              <th className={`${MODLOG_TH} w-16 text-right`}>초과시간</th>
              <th className={MODLOG_TH}>수기 입력 사유</th>
              <th className={`${MODLOG_TH} w-12 text-center`}>관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="py-8 text-center"><LoadingSpinner size="sm" /></td></tr>
            ) : filteredRecords.length === 0 ? (
              <tr><td colSpan={7} className={MODLOG_EMPTY}>수기로 등록된 초과근무 내역이 없습니다.</td></tr>
            ) : (
              filteredRecords.map((r, idx) => (
                  <tr key={r.id || idx} className={modlogRowClass(modlogIsRecent(r.createdAt, recentCutoff))}>
                    <td className={`${MODLOG_TD} font-mono text-[11px] text-gray-500 whitespace-nowrap`}>
                      {formatShortDate(r.createdAt)}
                    </td>
                    <td className={`${MODLOG_TD} font-black text-gray-800 whitespace-nowrap`}>
                      {r.branchName}
                    </td>
                    <td className={`${MODLOG_TD} font-mono text-[11px] font-black text-blue-700 whitespace-nowrap`}>
                      {r.settleDate}
                    </td>
                    <td className={`${MODLOG_TD} font-black text-gray-800 whitespace-nowrap`}>
                      {r.staffName}
                    </td>
                    <td className={`${MODLOG_TD} text-right font-mono font-black text-gray-800 whitespace-nowrap`}>
                      {r.overtime}h
                    </td>
                    <td className={`${MODLOG_TD} text-[11px] font-bold text-gray-700`} title={r.reason || ""}>
                      {r.reason || "-"}
                    </td>
                    <td className={`${MODLOG_TD} text-center`}>
                      <button
                        type="button"
                        onClick={() => void deleteManualRecord(r)}
                        className={MODLOG_DELETE}
                        title="수기 내역 삭제"
                      >
                        <Trash2 className="w-3 h-3" />
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

function AdminLaborContractsSection() {
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchBranch, setSearchBranch] = useState("");
  const [searchName, setSearchName] = useState("");
  const [templateMeta, setTemplateMeta] = useState<LaborContractTemplateMeta | null>(null);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [contractData, meta] = await Promise.all([
        gasClient.getAllLaborContracts().catch(() => []),
        gasClient.getLaborContractTemplateMeta().catch(() => null)
      ]);
      setContracts(contractData || []);
      setTemplateMeta(meta);
    } catch (err) {
      console.error("Failed to load labor contracts:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadData();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadData]);

  // Firestore 문서 1개는 약 1MB가 상한이고 base64는 원본보다 약 33% 커진다.
  // 700KB를 넘으면 저장 자체가 실패하므로 업로드 시점에 막고 이유를 알린다.
  const TEMPLATE_MAX_BYTES = 700 * 1024;

  const handleTemplateUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // 같은 파일을 다시 골라도 onChange가 뜨도록 초기화
    if (!file) return;
    if (file.size > TEMPLATE_MAX_BYTES) {
      window.alert(`파일이 너무 큽니다. 최대 700KB까지 등록할 수 있습니다.\n선택한 파일: ${Math.round(file.size / 1024)}KB`);
      return;
    }
    setUploadingTemplate(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          const comma = result.indexOf(",");
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const meta: LaborContractTemplateMeta = {
        fileId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        uploadedAt: new Date().toISOString()
      };
      await gasClient.saveLaborContractTemplate(meta, dataBase64);
      setTemplateMeta(meta);
      window.alert("파트타이머 근로계약서 양식을 등록했습니다.");
    } catch (err) {
      console.error("양식 등록 실패", err);
      window.alert("양식 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setUploadingTemplate(false);
    }
  };

  const saveBranchContracts = async (branchName: string, next: any[]) => {
    await gasClient.saveSharedData("labor_contracts:" + branchName, next);
    await gasClient.saveSharedData("labor_contracts_" + branchName, next);
    await loadData();
  };

  const updateStatus = async (row: any, status: string) => {
    const list = (await gasClient.getSharedData<any[]>("labor_contracts:" + row.branchName)) || [];
    const next = list.map((item) => item.id === row.id ? { ...item, status, statusUpdatedAt: new Date().toISOString() } : item);
    await saveBranchContracts(row.branchName, next);
  };

  const deleteContract = async (row: any) => {
    if (!window.confirm(row.branchName + " / " + row.name + " 내역을 삭제할까요?")) return;
    const list = (await gasClient.getSharedData<any[]>("labor_contracts:" + row.branchName)) || [];
    await saveBranchContracts(row.branchName, list.filter((item) => item.id !== row.id));
  };

  // 지점명 필터 드롭다운 옵션 — 등록된 발송 내역에 실제로 있는 지점만(가나다순).
  const branchOptions = useMemo(
    () => Array.from(new Set(contracts.map((c) => c.branchName).filter(Boolean)))
      .sort((a, b) => String(a).localeCompare(String(b), "ko")),
    [contracts]
  );

  const filteredContracts = useMemo(() => contracts.filter((contract) => {
    const matchBranch = !searchBranch || contract.branchName === searchBranch;
    const matchName = !searchName || contract.name?.toLowerCase().includes(searchName.toLowerCase());
    return matchBranch && matchName;
  }).sort((a, b) => {
    if (a.deleteRequested !== b.deleteRequested) return a.deleteRequested ? -1 : 1;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  }), [contracts, searchBranch, searchName]);

  return (
    <div className="space-y-5 animate-fade-in" id="admin-labor-contracts-section">
      <div className="bg-white p-6 rounded-2xl border shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="font-black text-gray-800 text-lg flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-[#2E6DB4]" />
              전 지점 근로계약서 관리
            </h3>
            <p className="text-xs text-gray-400 mt-1">지점이 근로계약서 발송을 요청한 인원 목록입니다.</p>
            <p className="text-xs font-bold text-gray-500 mt-1">
              파트타이머 양식: {templateMeta
                ? `${templateMeta.fileName} (${Math.round(templateMeta.size / 1024)}KB · ${templateMeta.uploadedAt.slice(0, 10)} 등록)`
                : "등록 전 — 지점에서 내려받을 수 없습니다."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className={`px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs font-bold ${uploadingTemplate ? "opacity-40" : "cursor-pointer"}`}>
              {uploadingTemplate ? "등록 중…" : templateMeta ? "파트타이머 양식 교체" : "파트타이머 양식 등록"}
              <input type="file" className="hidden" disabled={uploadingTemplate} onChange={handleTemplateUpload} />
            </label>
            <button onClick={() => void loadData()} className="px-4 py-2 bg-[#2E6DB4] hover:bg-[#20528B] text-white rounded-xl text-xs font-bold cursor-pointer transition-colors">새로고침</button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
          <select value={searchBranch} onChange={(e) => setSearchBranch(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold bg-gray-50">
            <option value="">지점 선택</option>
            {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <input value={searchName} onChange={(e) => setSearchName(e.target.value)} placeholder="직원명 검색" className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold bg-gray-50" />
        </div>
      </div>

      <div className="bg-white rounded-2xl border overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="bg-gray-50 text-left border-b text-gray-500 font-extrabold text-xs">
                  <th className="p-4">등록일</th>
                  <th className="py-4 px-3">지점명</th>
                  <th className="py-4 px-3">구분</th>
                  <th className="py-4 px-3">이름</th>
                  <th className="py-4 px-3">연락처</th>
                  <th className="py-4 px-3">입사·이동일</th>
                  <th className="py-4 px-3 text-right">급여</th>
                  <th className="py-4 px-3 text-center">요청</th>
                  <th className="py-4 px-3 text-center">진행 상태</th>
                  <th className="py-4 px-3 text-center">관리</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="p-12 text-center"><LoadingSpinner size="sm" /></td></tr>
                ) : filteredContracts.length === 0 ? (
                  <tr><td colSpan={10} className="p-12 text-center text-gray-400 font-bold">근로계약서 등록 내역이 없습니다.</td></tr>
                ) : filteredContracts.map((contract, idx) => (
                  <tr key={contract.id || idx} className="border-b hover:bg-slate-50/50">
                    <td className="p-4 font-mono text-xs text-gray-500 whitespace-nowrap">{contract.createdAt ? contract.createdAt.slice(0, 10) : "-"}</td>
                    <td className="py-4 px-3 font-black text-gray-800 whitespace-nowrap">{contract.branchName}</td>
                    <td className="py-4 px-3 whitespace-nowrap">
                      {contract.contractType === "지점이동" ? (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-black text-emerald-800">지점이동</span>
                          {contract.previousBranch && <span className="text-gray-400">← {contract.previousBranch}</span>}
                        </span>
                      ) : contract.contractType === "신규입사" ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-black text-amber-800">신규입사</span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="py-4 px-3 font-extrabold text-zinc-800 whitespace-nowrap">{contract.name}</td>
                    <td className="py-4 px-3 font-mono text-xs text-blue-700 font-black whitespace-nowrap">{contract.phone}</td>
                    <td className="py-4 px-3 font-mono text-xs text-gray-500 whitespace-nowrap">{contract.effectiveDate || "-"}</td>
                    <td className="py-4 px-3 text-right font-black text-zinc-700 whitespace-nowrap">{Number(contract.salary || 0).toLocaleString("ko-KR")}원</td>
                    <td className="py-4 px-3 text-center">{contract.deleteRequested ? <span className="px-2 py-1 rounded-full bg-rose-50 text-rose-700 text-xs font-black">삭제요청</span> : contract.editRequestedAt ? <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-black">수정됨</span> : "-"}</td>
                    <td className="py-4 px-3 text-center">
                      <select value={contract.status || "발송 대기"} onChange={(e) => void updateStatus(contract, e.target.value)} className="border rounded-lg px-2 py-1 text-xs font-black">
                        <option>발송 대기</option>
                        <option>발송 완료</option>
                        <option>서명 완료</option>
                        <option>보류</option>
                      </select>
                    </td>
                    <td className="py-4 px-3 text-center"><button onClick={() => void deleteContract(contract)} className="px-3 py-1.5 bg-rose-50 text-rose-700 rounded-lg text-xs font-black">삭제</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
    </div>
  );
}
