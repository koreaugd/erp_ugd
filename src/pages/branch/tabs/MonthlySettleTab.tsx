// src/pages/branch/tabs/MonthlySettleTab.tsx  (BranchConfirmPage에서 분리 — 동작 변경 없음)
import { useState, useEffect, useRef, useCallback } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, Pencil, Trash2, X } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import LoadingSpinner from "../../../components/LoadingSpinner";
import { GuideCallouts } from "../../../components/GuideCallouts";
import { fullTimeSalaryGuideSteps, purchaseSalesGuideSteps } from "../helpers/guideSteps";
import { addMonthsToMonthInputValue } from "../helpers/formatters";
import { MonthlyFullTimeSalarySubTab, flushFullTimeSalaryForClose } from "./MonthlyFullTimeSalarySubTab";
import { MonthlyPurchaseSalesSubTab, flushMonthlyPurchasesForClose } from "./MonthlyPurchaseSalesSubTab";
import { MonthlyPartTimeSalarySubTab } from "./MonthlyPartTimeSalarySubTab";
import { MonthlyCashExpensesSubTab } from "./MonthlyCashExpensesSubTab";
import { MonthlyCashManagementSubTab } from "./MonthlyCashManagementSubTab";
import { MonthlyCardExpensesSubTab } from "./MonthlyCardExpensesSubTab";
import { SalesSummarySection, isSalesSummaryDataInvalid, loadSalesSummaryForClose } from "./SalesSummarySection";

// 섹션별 독립 마감: 정직원 급여대장 / 매입매출(거래처) / 매출집계
type CloseSection = "purchase" | "salary" | "salesSummary";

interface MonthlySettleTabProps {
  branchName: string;
  activeSubTab: "fullTimeSalary" | "purchaseSales" | "partTimeSalary" | "cashExpenses" | "cashManagement" | "cardExpenses";
  isAdmin?: boolean;
}

export function MonthlySettleTab({ branchName, activeSubTab, isAdmin = false }: MonthlySettleTabProps) {
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
  const [monthlyCloseRecords, setMonthlyCloseRecords] = useState<any[]>([]);
  const [purchaseResetToken, setPurchaseResetToken] = useState(0);
  // 매입매출 탭 "작성방법 보기" 투어. 수동으로만 열린다(자동 노출 없음).
  const [guideOpen, setGuideOpen] = useState(false);

  const triggerToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // silent=true면 전체 로딩 스피너(setLoading)를 켜지 않는다 — 지출 수정 후 조용히 재조회할 때 쓴다.
  // 스피너를 켜면 서브탭이 통째로 언마운트돼 낙관적 갱신이 버려지고, 재조회 실패 시 옛 값으로 되돌아간다.
  const fetchHistory = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      if (!silent) setLoading(true);
      // silent 재조회는 실패를 []로 삼키면 안 된다 — 그러면 setHistory([])로 화면이 통째로 비워져
      // 방금 저장한 수정이 사라진다. 실패 시 throw하는 fail-closed 조회를 써서 catch로 흘려 옛 history를 유지한다.
      const h = silent
        ? await gasClient.getBranchHistoryFromServer(branchName, selectedMonth)
        : await gasClient.getBranchHistory(branchName, selectedMonth);
      setHistory(h || []);
    } catch (e) {
      console.error("월말 정산용 이력 가져오기 실패:", e);
      // silent 실패면 history를 건드리지 않는다 → 화면(낙관적 patch 포함)이 그대로 유지된다.
    } finally {
      if (!silent) setLoading(false);
    }
  }, [branchName, selectedMonth]);

  const fetchMonthlyCloseStatus = useCallback(async () => {
    try {
      const records = await gasClient.getSharedData<any[]>("monthly_closings");
      setMonthlyCloseRecords(Array.isArray(records) ? records : []);
    } catch (error) {
      console.warn("월말마감 상태를 불러오지 못했습니다.", error);
    }
  }, []);

  // 섹션별 마감 상태 조회 (section 없는 과거 레코드는 purchase로 간주하여 하위호환)
  const getSectionStatus = useCallback((section: CloseSection): "confirmed" | "editing" | "pending" | null => {
    const rec = monthlyCloseRecords
      .filter((r) => r.branchName === branchName && r.month === selectedMonth && (r.section || "purchase") === section)
      .sort((a, b) => String(b.updatedAt || b.confirmedAt || "").localeCompare(String(a.updatedAt || a.confirmedAt || "")))[0];
    return rec?.status || null;
  }, [monthlyCloseRecords, branchName, selectedMonth]);

  // monthly_closings 저장 직렬화 큐: 연속 마감의 read-modify-write가 겹치지 않도록 한다.
  const closeWriteChainRef = useRef<Promise<void>>(Promise.resolve());

  const saveSectionClose = useCallback(async (section: CloseSection, status: "confirmed" | "editing" | "pending", reason = "", opts: { restore?: boolean } = {}) => {
    const now = new Date().toISOString();
    const matches = (r: any) => r.branchName === branchName && r.month === selectedMonth && (r.section || "purchase") === section;
    // 중복 매칭 레코드가 있어도 항상 '최신'을 기준으로 판정한다(handleEdit·run() 모두 동일 기준) —
    // 오래된 레코드를 보고 confirmedAt을 놓쳐 사유가 버려지는 비대칭을 막는다.
    const latest = (arr: any[]) => arr.filter(matches).sort((a, b) => String(b.updatedAt || b.confirmedAt || "").localeCompare(String(a.updatedAt || a.confirmedAt || "")))[0];
    const prevRec = latest(monthlyCloseRecords);
    const prevConfirmedAt = prevRec?.confirmedAt || "";
    const prevEvents = Array.isArray(prevRec?.editEvents) ? prevRec.editEvents : [];
    // 시스템 롤백(reset 복구 등)은 사용자의 '확정 후 수정'이 아니다 — 새 이벤트를 남기지도, 사유를 요구하지도 않는다.
    const restore = opts.restore === true;
    // 확정된 섹션을 '수정'으로 다시 여는 것(status==="editing" & 이전에 확정됨)이 곧 '확정 후 수정'이다.
    const isReopen = status === "editing" && !!prevConfirmedAt && !restore;
    // 표식: 한 번 true가 되면 재확정해도 유지(깨끗한 최초 확정엔 절대 안 붙음 — 오탐 없음).
    const editedAfterConfirm = !!(prevRec?.editedAfterConfirm || isReopen);
    // 재수정 이벤트: 시각 + 지점이 입력한 사유(무엇을 바꿨는지)를 함께 남긴다(관리자 팝업 표시용).
    const reopenEvent = { at: now, reason: (reason || "").slice(0, 200) };
    const nextRecord = {
      id: `${branchName}-${selectedMonth}-${section}`,
      branchName, month: selectedMonth, section, status, writer: branchName,
      confirmedAt: status === "confirmed" ? now : prevConfirmedAt,
      editedAfterConfirm,
      // 수정 이력 — 확정 후 다시 열 때마다 시각+사유를 남긴다(최근 20건).
      editEvents: isReopen ? [...prevEvents, reopenEvent].slice(-20) : prevEvents,
      updatedAt: now
    };
    // 낙관적 UI: 클릭 즉시 상태칩을 반영(로컬 상태 먼저 갱신) → 사용자는 지연 없이 바로 확인.
    setMonthlyCloseRecords((prev) => [nextRecord, ...prev.filter((r) => !matches(r))]);
    // 서버 반영(read-modify-write)을 직렬화한다: 같은 기기에서 여러 섹션을 연속 마감할 때
    // 각 저장이 직전 저장의 결과를 읽은 뒤 병합하도록 하여 서로의 섹션 레코드를 덮어쓰지 않게 한다.
    const run = async () => {
      // '최종 쓰기 시점'의 서버 진실을 읽는다(캐시 아님) — handleEdit 판단 이후 다른 기기가 확정했을 수 있어(경쟁),
      // 여기서 확정 여부를 다시 판정해야 사유 없는 재수정 이벤트가 남지 않는다. 실패 시 throw → 저장은 fail-closed로 중단.
      const previous = await gasClient.getSharedDataFromServer<any[]>("monthly_closings");
      // null = 문서 없음(기록이 아직 없음, 정상) → []. 값이 있는데 배열이 아니면(형식 손상) 재수정 여부를 단정할 수 없어 중단(fail-closed).
      if (previous != null && !Array.isArray(previous)) {
        throw new Error("마감 상태 형식이 올바르지 않습니다. 다시 시도해주세요.");
      }
      const list = Array.isArray(previous) ? previous : [];
      // 표식·이력은 서버 값을 최우선으로 유지한다 — 로컬이 스테일이어도 '확정 후 수정' 사실/이력을 잃지 않는다.
      const prevServer = latest(list);
      const serverReopen = status === "editing" && !!prevServer?.confirmedAt && !restore;
      // 최종 판정상 '확정 후 수정'인데 사유가 없으면(경쟁으로 handleEdit 프롬프트를 지나침) 사유 없는 재수정 이벤트를
      // 남기지 않는다 — 저장을 중단하고 재시도를 요구한다. 재시도 시 handleEdit이 확정을 보고 사유를 받는다.
      if (serverReopen && !(reason || "").trim()) {
        throw new Error("확정된 마감입니다. 수정 사유를 입력해야 수정할 수 있습니다. 다시 '마감수정'을 눌러주세요.");
      }
      const serverEvents = Array.isArray(prevServer?.editEvents) ? prevServer.editEvents : [];
      const merged = {
        ...nextRecord,
        editedAfterConfirm: !!(prevServer?.editedAfterConfirm || serverReopen),
        editEvents: serverReopen ? [...serverEvents, reopenEvent].slice(-20) : serverEvents,
      };
      const next = [merged, ...list.filter((r) => !matches(r))];
      await gasClient.saveSharedData("monthly_closings", next);
      setMonthlyCloseRecords(next);
    };
    const chained = closeWriteChainRef.current.then(run, run);
    closeWriteChainRef.current = chained.catch(() => {}); // 체인이 에러로 끊기지 않도록 흡수
    try {
      await chained;
    } catch (error) {
      void fetchMonthlyCloseStatus();
      throw error;
    }
    return nextRecord;
  }, [branchName, selectedMonth, monthlyCloseRecords, fetchMonthlyCloseStatus]);

  const carryMonthlyPurchasesToNextMonth = useCallback(async () => {
    const nextMonth = addMonthsToMonthInputValue(selectedMonth, 1);
    const nextKey = `monthly_purchases:${branchName}:${nextMonth}`;
    const nextLocalKey = `erp_monthly_purchases_${branchName}_${nextMonth}`;
    // 다음 달 기존 데이터 확인 + 이월 원본을 서버 최신값으로 읽는다(독립적이므로 병렬 처리로 왕복 단축).
    // - 다음 달에 이미 데이터가 있으면 덮어쓰지 않는다(오래된 로컬 캐시는 확인하지 않음).
    // - 이월 원본은 서버 최신값 사용(직전 flush로 미저장 편집은 이미 반영됨). 서버 읽기 실패 시 throw → 마감 중단.
    const [existingRemote, remote] = await Promise.all([
      gasClient.getSharedDataFromServer<any[]>(nextKey),
      gasClient.getSharedDataFromServer<any[]>(`monthly_purchases:${branchName}:${selectedMonth}`),
    ]);
    if (Array.isArray(existingRemote) && existingRemote.length > 0) return;
    const currentRows: any[] = Array.isArray(remote) ? remote : [];
    if (currentRows.length === 0) return;

    const carriedRows = currentRows.map((row) => ({
      ...row,
      id: `p_${nextMonth}_${row.id || Date.now()}`,
      transferAmount: "",
      prepaidChargeAmount: "",
      monthlyUsageAmount: "",
      // 이월 시 '결제완료' 상태는 초기화 — 다음 달은 '이체 필요'로 시작(월 단위 결제 상태).
      transferNeeded: true
    }));
    localStorage.setItem(nextLocalKey, JSON.stringify(carriedRows));
    await gasClient.saveSharedData(nextKey, carriedRows);
  }, [branchName, selectedMonth]);

  const sectionLabel = (section: CloseSection) => section === "purchase" ? "매입매출" : section === "salary" ? "정직원 급여대장" : "매출집계";

  const handleConfirm = useCallback(async (section: CloseSection) => {
    // 매출집계 제출 시에만 매출집계 정합성/영속화를 검증한다(다른 섹션 마감과 무관).
    if (section === "salesSummary") {
      const summaryCheck = await loadSalesSummaryForClose(branchName, selectedMonth);
      if (summaryCheck.blocked) {
        triggerToast("매출집계를 서버에 반영/확인하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.", "error");
        return;
      }
      if ((window as any).__ugdSalesSummaryInvalid === true || isSalesSummaryDataInvalid(summaryCheck.data, branchName)) {
        window.dispatchEvent(new Event("ugd_show_monthly_errors"));
        triggerToast("매출집계에 확인이 필요합니다(금액 불일치 또는 빈칸).", "error");
        return;
      }
    }
    // 급여대장/매입매출은 마감 확정 전에 이 기기의 입력을 서버에 반영 보장(실패 시 중단).
    if (section === "salary") {
      const flush = await flushFullTimeSalaryForClose(branchName, selectedMonth);
      if (flush.blocked) {
        triggerToast("정직원 급여대장에 저장된 데이터가 없거나 서버 반영에 실패했습니다. 급여대장 탭에서 데이터를 확인·입력한 뒤 다시 시도해주세요.", "error");
        return;
      }
    }
    if (section === "purchase") {
      const flush = await flushMonthlyPurchasesForClose(branchName, selectedMonth);
      if (flush.blocked) {
        triggerToast("매입매출(거래처)에 금액이 0보다 큰 행이 하나도 없거나 서버 반영에 실패했습니다. 거래처 금액을 입력한 뒤 다시 시도해주세요.", "error");
        return;
      }
    }
    try {
      if (section === "purchase") await carryMonthlyPurchasesToNextMonth();
      await saveSectionClose(section, "confirmed");
      triggerToast(`${selectedMonth} ${sectionLabel(section)} 마감제출이 완료되었습니다.`, "success");
    } catch (error: any) {
      console.error(error);
      triggerToast(error?.message || "마감 저장에 실패했습니다.", "error");
    }
  }, [branchName, carryMonthlyPurchasesToNextMonth, saveSectionClose, selectedMonth, triggerToast]);

  const handleEdit = useCallback(async (section: CloseSection) => {
    // 확정된 섹션을 다시 여는 것(=확정 후 수정)이면, 무엇을 바꾸는지 사유를 한 줄 입력받아 관리자에게 남긴다.
    // 확정 여부는 '서버 최신값'으로만 판단한다 — '마감수정' 버튼은 미제출/확정 어느 상태에서도 뜨므로
    // 로컬 캐시(getSectionStatus)에 의존하면, 다른 기기가 방금 확정한 섹션을 사유 없이 열 수 있다.
    // 서버 확인 자체가 실패하면 '열지 않는다'(fail-closed): 확인 못 한 채 열면 확정본을 사유 없이 수정하게 된다.
    let wasConfirmed = false;
    try {
      const server = await gasClient.getSharedDataFromServer<any[]>("monthly_closings");
      // null = 문서 없음(마감 기록이 아직 없음) → 확정된 적 없음(wasConfirmed=false). 값이 있는데 배열이 아니면(형식 손상)만 실패로 본다.
      if (server != null && !Array.isArray(server)) throw new Error("invalid monthly_closings");
      if (Array.isArray(server)) {
        const rec = server
          .filter((r) => r.branchName === branchName && r.month === selectedMonth && (r.section || "purchase") === section)
          .sort((a, b) => String(b.updatedAt || b.confirmedAt || "").localeCompare(String(a.updatedAt || a.confirmedAt || "")))[0];
        // confirmedAt이 있으면 '한 번이라도 확정됐던' 섹션이다(확정취소로 지금 pending이어도 유지된다).
        // saveSectionClose의 serverReopen 판정(status==="editing" && confirmedAt)과 정확히 일치시킨다 —
        // 안 그러면 pending-후-확정 섹션이 프롬프트를 건너뛰어 run() guard에서 막히는 데드락이 생긴다.
        wasConfirmed = !!rec?.confirmedAt;
      }
    } catch {
      triggerToast("마감 상태를 서버에서 확인하지 못했습니다. 네트워크 확인 후 다시 시도해주세요.", "error");
      return;
    }
    let reason = "";
    if (wasConfirmed) {
      const input = window.prompt(
        "확정 후 수정하는 이유를 한 줄로 입력해주세요.\n관리자에게 그대로 표시됩니다. (예: 김OO 상여금 반영, 계좌번호 정정)",
        ""
      );
      if (input === null) return; // 취소하면 수정을 열지 않는다.
      reason = input.trim();
      if (!reason) { triggerToast("수정 사유를 입력해야 확정된 마감을 수정할 수 있습니다.", "error"); return; }
    }
    try {
      await saveSectionClose(section, "editing", reason);
      triggerToast(`${selectedMonth} ${sectionLabel(section)} 마감이 수정중으로 변경되었습니다.`, "success");
    } catch (error: any) {
      console.error(error);
      triggerToast(error?.message || "마감 수정 상태 저장에 실패했습니다.", "error");
    }
  }, [branchName, saveSectionClose, selectedMonth, triggerToast]);

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
      monthlyUsageAmount: "",
      // 금액 초기화 시 '결제완료' 상태도 초기화 — 이후 재입력한 이체가 결제완료로 오인돼 누락되는 것을 방지.
      transferNeeded: true
    }));
    localStorage.setItem(`erp_monthly_purchases_${branchName}_${selectedMonth}`, JSON.stringify(resetRows));
    await gasClient.saveSharedData(`monthly_purchases:${branchName}:${selectedMonth}`, resetRows);
  }, [branchName, selectedMonth]);

  const handleCancel = useCallback(async (section: CloseSection) => {
    if (section === "purchase") {
      if (!window.confirm("매입매출 마감을 취소하고 거래처 금액 입력값만 초기화할까요?\n거래처명, 은행, 계좌, 기타내용은 유지됩니다.")) return;
      // 초기화 실패 시 되돌릴 '취소 직전 상태'를 미리 캡처한다(하드코딩 confirmed 금지 — 실제 이전 상태로 복원).
      const prevStatus = getSectionStatus("purchase");
      try {
        await saveSectionClose("purchase", "pending");
        try {
          await resetMonthlyPurchaseAmounts();
        } catch (resetError) {
          // 보상(rollback): 금액 초기화가 실패하면 마감 상태를 '취소 직전 상태'로 되돌린다.
          // → '마감은 pending인데 금액·결제완료는 옛값 그대로' 어긋남을 막고, 없던 확정을 만들지 않는다.
          //   (두 문서 write가 원자적이지 않아 실패 시 이전 상태로 복원; 이전이 미제출(null)이면 복원 대상이 없어 그대로 둔다.)
          if (prevStatus === "confirmed" || prevStatus === "editing" || prevStatus === "pending") {
            // 시스템 롤백이므로 restore로 사유 guard/이벤트 append를 건너뛴다(사용자 재수정이 아님).
            await saveSectionClose("purchase", prevStatus, "", { restore: true }).catch(() => {});
          }
          throw resetError;
        }
        setPurchaseResetToken((value) => value + 1);
        triggerToast(`${selectedMonth} 매입매출 마감이 취소되고 거래처 금액이 초기화되었습니다.`, "success");
      } catch (error: any) {
        console.error(error);
        triggerToast(error?.message || "마감 취소에 실패했습니다.", "error");
      }
      return;
    }
    if (!window.confirm(`${sectionLabel(section)} 마감을 취소할까요?`)) return;
    try {
      await saveSectionClose(section, "pending");
      triggerToast(`${selectedMonth} ${sectionLabel(section)} 마감이 취소되었습니다.`, "success");
    } catch (error: any) {
      console.error(error);
      triggerToast(error?.message || "마감 취소에 실패했습니다.", "error");
    }
  }, [getSectionStatus, resetMonthlyPurchaseAmounts, saveSectionClose, selectedMonth, triggerToast]);

  const handleCancelEdit = useCallback(async (section: CloseSection) => {
    try {
      await saveSectionClose(section, "confirmed");
      triggerToast(`${selectedMonth} ${sectionLabel(section)} 수정이 취소되고 확정으로 돌아갔습니다.`, "success");
    } catch (error: any) {
      console.error(error);
      triggerToast(error?.message || "마감 수정 취소에 실패했습니다.", "error");
    }
  }, [saveSectionClose, selectedMonth, triggerToast]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    void fetchMonthlyCloseStatus();
  }, [fetchMonthlyCloseStatus]);

  // 선택한 월/섹션의 제출상태 칩
  const statusPill = (section: CloseSection) => {
    const status = getSectionStatus(section);
    return (
      <span className={`monthly-close-status-pill rounded-lg px-2.5 py-1 text-xs font-black ${
        status === "confirmed" ? "monthly-close-status-confirmed"
        : status === "editing" ? "monthly-close-status-editing"
        : "monthly-close-status-missing"
      }`}>
        {status === "confirmed" ? "확정" : status === "editing" ? "수정중" : "미제출"}
      </span>
    );
  };

  // 섹션별 마감 컨트롤 (마감제출/수정/취소)
  const renderCloseControls = (section: CloseSection) => {
    const status = getSectionStatus(section);
    return (
      <>
        <button onClick={() => handleConfirm(section)} className="monthly-action-confirm p-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-subtle">
          <CheckCircle2 className="w-4 h-4 text-emerald-200" /> 마감제출
        </button>
        {status === "editing" ? (
          <button onClick={() => handleCancelEdit(section)} className="monthly-action-edit-cancel p-2 px-4 bg-slate-600 hover:bg-slate-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-subtle">
            <X className="w-4 h-4 text-slate-200" /> 마감수정 취소
          </button>
        ) : (
          <button onClick={() => handleEdit(section)} className="monthly-action-edit p-2 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-subtle">
            <Pencil className="w-4 h-4 text-amber-100" /> 마감수정
          </button>
        )}
        <button onClick={() => handleCancel(section)} className="monthly-action-cancel p-2 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-subtle">
          <Trash2 className="w-4 h-4 text-rose-200" /> 마감취소
        </button>
      </>
    );
  };

  // 월말마감 헤더(제목 pill + 결산월 선택 + 마감버튼 + 제출상태). 카드 안/밖 어디서든 재사용.
  const renderPortalHeader = () => (
    // 위쪽 기준선 정렬(items-start) — md:items-center로 두면 왼쪽 설명문이 짧거나 비었을 때
    // 제목 필이 오른쪽 2줄(결산월+제출상태)의 세로 중앙으로 내려앉아 결산월 선택과 어긋나 보인다.
    <div className="flex flex-col md:flex-row justify-between items-start gap-4">
      <div className="space-y-2">
        {/* 매입매출 탭에서는 위쪽 '매출집계'와 짝이 되도록 '매입집계'로, 정직원급여 탭에서는 탭 이름 그대로 부른다. */}
        <div className="inline-flex items-center px-3.5 py-1.5 rounded-full border border-zinc-900 bg-[#EFF0A3] text-zinc-900 text-[13px] font-black leading-none">
          {activeSubTab === "purchaseSales" ? "매입집계" : "정직원 급여대장"}
        </div>
        <p className="text-[10px] text-gray-400 font-bold max-w-md">
          {adminSettings.monthlyReportDesc}
        </p>
      </div>

      {(activeSubTab === "purchaseSales" || activeSubTab === "fullTimeSalary") && (
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
            {/* '이력 갱신' 버튼은 없앴다 — 탭을 열 때와 결산월을 바꿀 때 자동으로 다시 불러오고,
                지출·현금관리 탭에서 수정·삭제하면 그쪽에서 refreshHistory를 부른다. 손으로 누를 일이 없다. */}
            {activeSubTab === "fullTimeSalary" && renderCloseControls("salary")}
            {activeSubTab === "purchaseSales" && renderCloseControls("purchase")}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-400">{selectedMonth} 제출상태</span>
            {statusPill(activeSubTab === "fullTimeSalary" ? "salary" : "purchase")}
          </div>
        </div>
      )}
    </div>
  );

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

      {/* 작성방법 안내: 매입매출 탭에서만. 버튼을 다시 누르면 사라진다.
          켜둔 채로 작성할 수 있게 배경을 어둡게 하지 않고, 말풍선 바깥 클릭은 화면으로 통과시킨다.
          마감 확정으로 화면이 잠겨도 버튼은 살아있다(잠긴 뒤 규칙을 찾아보는 경우가 많다).
          단, 로딩 중에는 거래처 표가 아직 없어 그 말풍선이 통째로 빠지므로 버튼을 잠근다. */}
      {(activeSubTab === "purchaseSales" || activeSubTab === "fullTimeSalary") && (
        <>
          {/* 일일마감 탭과 같은 자리 — 탭 최상단 가운데. 매입매출·정직원급여 둘 다 여기서 연다(하위 컴포넌트가 아니라
              탭 레벨이어야 다른 탭들과 버튼 위치가 같다). */}
          <div className="flex justify-center">
            <button
              onClick={() => setGuideOpen((prev) => !prev)}
              disabled={loading}
              aria-pressed={guideOpen}
              title={loading ? "화면을 불러오는 중입니다" : undefined}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-zinc-900 text-[12px] font-black leading-none transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                guideOpen ? "bg-zinc-900 text-[#EFF0A3]" : "bg-[#EFF0A3] text-zinc-900 hover:brightness-95"
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" /> {guideOpen ? "작성방법 닫기" : "작성방법 보기"}
            </button>
          </div>
          <GuideCallouts
            open={guideOpen}
            steps={activeSubTab === "purchaseSales" ? purchaseSalesGuideSteps : fullTimeSalaryGuideSteps}
            onClose={() => setGuideOpen(false)}
          />
        </>
      )}

      {/* 매출집계: 매입매출 탭에서 결산포털 위에 (자체 제출/수정/취소, 매월 1일 작성 가능) */}
      {activeSubTab === "purchaseSales" && (
        <SalesSummarySection
          branchName={branchName}
          selectedMonth={selectedMonth}
          triggerToast={triggerToast}
          isLocked={getSectionStatus("salesSummary") === "confirmed"}
          closeStatus={getSectionStatus("salesSummary")}
          onConfirm={() => handleConfirm("salesSummary")}
          onEdit={() => handleEdit("salesSummary")}
          onCancel={() => handleCancel("salesSummary")}
          onCancelEdit={() => handleCancelEdit("salesSummary")}
          onMonthChange={setSelectedMonth}
        />
      )}

      {(activeSubTab === "purchaseSales" || activeSubTab === "fullTimeSalary") ? (
        /* 월말마감: 헤더 + 내용(거래처/급여대장)을 한 카드로 묶음 (구분선 없음) */
        /* 여백은 위쪽 매출집계 카드(p-6)와 같아야 두 카드의 제목 pill이 같은 세로선에 선다. */
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-5">
          {renderPortalHeader()}
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center space-y-3">
              <LoadingSpinner size="lg" />
              <span className="text-xs text-gray-400 font-bold font-mono">가맹점 무인 원격 일지에서 일일 정산자료 조합 파싱 중...</span>
            </div>
          ) : activeSubTab === "fullTimeSalary" ? (
            <MonthlyFullTimeSalarySubTab branchName={branchName} selectedMonth={selectedMonth} triggerToast={triggerToast} isLocked={getSectionStatus("salary") === "confirmed"} />
          ) : (
            <MonthlyPurchaseSalesSubTab branchName={branchName} selectedMonth={selectedMonth} triggerToast={triggerToast} resetToken={purchaseResetToken} isLocked={getSectionStatus("purchase") === "confirmed"} />
          )}
        </div>
      ) : (
        <>
          {/* 파트타이머 급여대장·현금관리·현금지출·카드지출에는 '월말마감' 헤더 카드를 두지 않는다.
              이 탭들에서 그 카드는 제목과 설명만 담고 있었다 — 결산월 선택·마감 버튼은
              매입매출/정직원급여 탭에서만 렌더되므로 지워도 잃는 기능이 없다. */}
          {loading ? (
            <div className="py-24 flex flex-col items-center justify-center bg-white rounded-3xl border border-gray-100 shadow-sm space-y-3">
              <LoadingSpinner size="lg" />
              <span className="text-xs text-gray-400 font-bold font-mono">가맹점 무인 원격 일지에서 일일 정산자료 조합 파싱 중...</span>
            </div>
          ) : (
            <div className="space-y-6">
              {activeSubTab === "partTimeSalary" && (
                <MonthlyPartTimeSalarySubTab branchName={branchName} selectedMonth={selectedMonth} history={history} triggerToast={triggerToast} />
              )}
              {activeSubTab === "cashExpenses" && (
                <MonthlyCashExpensesSubTab branchName={branchName} selectedMonth={selectedMonth} history={history} isAdmin={isAdmin} refreshHistory={() => fetchHistory({ silent: true })} />
              )}
              {activeSubTab === "cashManagement" && (
                <MonthlyCashManagementSubTab branchName={branchName} selectedMonth={selectedMonth} history={history} isAdmin={isAdmin} refreshHistory={fetchHistory} />
              )}
              {activeSubTab === "cardExpenses" && (
                <MonthlyCardExpensesSubTab branchName={branchName} selectedMonth={selectedMonth} history={history} isAdmin={isAdmin} refreshHistory={() => fetchHistory({ silent: true })} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
