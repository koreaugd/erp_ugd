// src/pages/branch/tabs/MonthlySettleTab.tsx  (BranchConfirmPage에서 분리 — 동작 변경 없음)
import { useState, useEffect, useRef, useCallback } from "react";
import { AlertTriangle, BookOpen, Check, CheckCircle2, Pencil, Plus, Trash2, X } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import { useAuthContext } from "../../../contexts/AuthContext";
import { canReadSalaryBranch } from "../../../utils/salaryAccess";
import LoadingSpinner from "../../../components/LoadingSpinner";
import { GuideCallouts } from "../../../components/GuideCallouts";
import { fullTimeSalaryGuideSteps, purchaseSalesGuideSteps } from "../helpers/guideSteps";
import { addMonthsToMonthInputValue } from "../helpers/formatters";
import { MonthlyFullTimeSalarySubTab, flushFullTimeSalaryForClose } from "./MonthlyFullTimeSalarySubTab";
import { MonthlyPurchaseSalesSubTab, flushMonthlyPurchasesForClose } from "./MonthlyPurchaseSalesSubTab";
import { MonthlyPartTimeSalarySubTab, flushPartTimeSalaryForClose } from "./MonthlyPartTimeSalarySubTab";
import { SalaryAccessGate, isSalaryUnlockedNow, useSalaryUnlocked } from "../components/SalaryAccessGate";
import { MonthlyCashExpensesSubTab } from "./MonthlyCashExpensesSubTab";
import { MonthlyCashManagementSubTab } from "./MonthlyCashManagementSubTab";
import { MonthlyCardExpensesSubTab } from "./MonthlyCardExpensesSubTab";
import { SalesSummarySection, isSalesSummaryDataInvalid, loadSalesSummaryForClose } from "./SalesSummarySection";
// 비즈니스택시·연차관리 '확인 마감'이 이 화면의 선행조건이다. 섹션 이름은 저 헬퍼가 단일 출처 —
// 여기에 문자열을 따로 적으면 한쪽만 고쳤을 때 게이트가 조용히 빠진다.
import { GATED_CLOSE_SECTIONS, assertCloseRecordList, findMissingCheckSections, missingCheckMessage, type CheckSection } from "../helpers/monthlyCheckSections";
import { SheetKeyHint } from "../../../components/SheetKeyHint";

// 섹션별 독립 마감: 정직원 급여대장 / 매입매출(거래처) / 매출집계 / 파트타이머 급여대장
type CloseSection = "purchase" | "salary" | "salesSummary" | "partTimeSalary";

// 급여 데이터(정직원·파트타이머)를 다루는 섹션 — 열람 권한 + 비밀번호 해제 가드를 함께 받는다.
const isSalaryCloseSection = (section: CloseSection) => section === "salary" || section === "partTimeSalary";

interface MonthlySettleTabProps {
  branchName: string;
  activeSubTab: "fullTimeSalary" | "purchaseSales" | "partTimeSalary" | "cashExpenses" | "cashManagement" | "cardExpenses";
  isAdmin?: boolean;
}

export function MonthlySettleTab({ branchName, activeSubTab, isAdmin = false }: MonthlySettleTabProps) {
  // 급여대장 열람 권한 판정용 세션 — 마감 컨트롤 노출/실행 가드에 쓴다(자식 탭과 같은 판정).
  const { user } = useAuthContext();
  // 급여대장 비밀번호가 지금 풀려 있는가 — 헤더의 급여 마감 컨트롤을 열고 닫는 데 쓴다.
  const salaryUnlocked = useSalaryUnlocked();
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
  // 마감 상태 문서를 못 읽었거나 형식이 손상됐을 때의 사유. 비어 있지 않으면 마감 조작을 잠근다.
  const [closeStatusError, setCloseStatusError] = useState("");
  const [purchaseResetToken, setPurchaseResetToken] = useState(0);
  // 파트타이머 마감제출이 진행 중인 동안 표를 잠그는 플래그(아래 isLocked에 합산).
  // flush가 검증을 마친 뒤 확정 저장이 끝나기 전에 들어온 편집은 '검증을 통과한 적 없는 값'인데,
  // 뒤따르는 자동저장에 실려 확정된 대장 위에 얹힌다 — 제출 중 입력을 막아 그 틈을 없앤다(Codex 2R P0 2026-08-01).
  const [partTimeSubmitting, setPartTimeSubmitting] = useState(false);
  // 매입매출 탭 "작성방법 보기" 투어. 수동으로만 열린다(자동 노출 없음).
  const [guideOpen, setGuideOpen] = useState(false);
  // '확정 후 수정'한 섹션을 다시 마감제출할 때 받는 수정 사유(섹션별 초안). 사유는 이제 편집 전이 아니라 '제출 시점'에 받는다.
  const [editReasonDrafts, setEditReasonDrafts] = useState<Record<CloseSection, string>>({ purchase: "", salary: "", salesSummary: "", partTimeSalary: "" });
  // 사유 미입력으로 제출을 막았을 때 사유칸을 붉게 강조하는 플래그(섹션별).
  const [reasonErrors, setReasonErrors] = useState<Record<CloseSection, boolean>>({ purchase: false, salary: false, salesSummary: false, partTimeSalary: false });
  // 자주 쓰는 수정 사유(칩) — 클릭하면 사유칸을 채운다. 그대로 두거나 뒤에 상세를 덧붙일 수 있다.
  const REASON_CHIPS = ["입력 오류 정정", "누락 항목 추가", "금액 정정", "지점 요청", "기타"];

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
      // 손상된 문서를 []로 삼키지 않는다 — 그러면 모든 섹션이 '미제출'처럼 보여서 지점이 제출·수정·취소를
      // 계속 시도하고, 실제 원인(문서 손상)은 아무 데도 안 뜬다. 제출은 게이트가 막지만 그 이유를 알 수 없다.
      const records = assertCloseRecordList(await gasClient.getSharedData<any[]>("monthly_closings"));
      setMonthlyCloseRecords(records);
      setCloseStatusError("");
    } catch (error) {
      console.warn("월말마감 상태를 불러오지 못했습니다.", error);
      // 상태를 모른다는 사실을 화면에 남기고 마감 조작을 잠근다(fail-closed).
      setCloseStatusError((error as any)?.message || "월말마감 상태를 불러오지 못했습니다. 새로고침 후에도 계속되면 본사 관리자에게 문의해주세요.");
    }
  }, []);

  // 마감 상태를 못 읽었으면 어떤 마감 조작도 시키지 않는다 — 무엇이 확정인지 모르는 채 누르면
  // 사유 없는 재확정·엉뚱한 초기화가 될 수 있다. 실제 쓰기는 트랜잭션이 다시 막지만,
  // 여기서 먼저 이유를 알려 주는 편이 "저장 실패"만 반복해서 보는 것보다 낫다.
  const blockedByCloseStatus = useCallback(() => {
    if (!closeStatusError) return false;
    window.alert(`${closeStatusError}\n\n마감 상태를 확인할 수 없어 작업을 중단했습니다.`);
    return true;
  }, [closeStatusError]);

  // 섹션별 마감 상태 조회 (section 없는 과거 레코드는 purchase로 간주하여 하위호환)
  const getSectionStatus = useCallback((section: CloseSection): "confirmed" | "editing" | "pending" | null => {
    const rec = monthlyCloseRecords
      .filter((r) => r.branchName === branchName && r.month === selectedMonth && (r.section || "purchase") === section)
      .sort((a, b) => String(b.updatedAt || b.confirmedAt || "").localeCompare(String(a.updatedAt || a.confirmedAt || "")))[0];
    return rec?.status || null;
  }, [monthlyCloseRecords, branchName, selectedMonth]);

  // 섹션별 최신 마감 레코드(상태뿐 아니라 editedAfterConfirm 등 메타까지 필요할 때). 사유칸 노출/제출 검증에 쓴다.
  const getSectionRecord = useCallback((section: CloseSection): any | null => {
    return monthlyCloseRecords
      .filter((r) => r.branchName === branchName && r.month === selectedMonth && (r.section || "purchase") === section)
      .sort((a, b) => String(b.updatedAt || b.confirmedAt || "").localeCompare(String(a.updatedAt || a.confirmedAt || "")))[0] || null;
  }, [monthlyCloseRecords, branchName, selectedMonth]);

  // monthly_closings 저장 직렬화 큐: 연속 마감의 read-modify-write가 겹치지 않도록 한다.
  const closeWriteChainRef = useRef<Promise<void>>(Promise.resolve());

  // 매입집계 '매입 업체 추가' — 버튼은 밴드(부모)에, 행 추가 동작은 자식 탭에 있어 ref 로 잇는다(2026-08-04).
  const purchaseAddRowRef = useRef<(() => void) | null>(null);
  // 정직원 급여대장 '직원 추가' — 같은 패턴(2026-08-04).
  const fulltimeAddRowRef = useRef<(() => void) | null>(null);
  // 초과근무 누적 참고 박스는 버튼을 눌렀을 때만 펼친다(2026-08-04).
  const [showOtSummary, setShowOtSummary] = useState(false);

  const saveSectionClose = useCallback(async (section: CloseSection, status: "confirmed" | "editing" | "pending", reason = "", opts: { restore?: boolean; resetConfirm?: boolean; cancelEdit?: boolean } = {}) => {
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
    // 마감취소(제출 철회)는 확정 사이클을 초기화한다 — confirmedAt·확정후수정 표식·수정이력을 비워
    // 깨끗한 '미제출'로 되돌린다(다음 확정은 새 제출, 관리자 '확정후수정' 버튼도 사라짐).
    const resetConfirm = opts.resetConfirm === true;
    // '마감수정 취소'(editing→confirmed로 되돌림)는 사용자가 실제로 수정을 제출하는 게 아니다 —
    // 사유를 요구하지도, 새 이벤트를 남기지도 않는다.
    const cancelEdit = opts.cancelEdit === true;
    // 확정된 섹션을 '수정'으로 다시 여는 것(직전 status==="confirmed" → editing)이 곧 '확정 후 수정 시작'이다.
    // 판정은 confirmedAt이 아니라 '직전 status'로 한다 — 마감취소(초기화) 정리 저장이 실패해 confirmedAt이 찌꺼기로
    // 남더라도, 취소된 '미제출' 섹션을 확정후수정으로 오인하지 않는다(찌꺼기에 무해). 사유는 여기서 받지 않는다(제출 때 받는다).
    const isReopen = status === "editing" && prevRec?.status === "confirmed" && !restore;
    // 확정본을 수정중이던 섹션을 다시 '마감제출'로 확정 = 재확정. 이때 사유 이벤트를 남긴다(관리자 표시용).
    const isReconfirm = status === "confirmed" && prevRec?.status === "editing" && !!prevRec?.editedAfterConfirm && !restore && !cancelEdit;
    // 표식은 '확정 계보(confirmed↔editing) 안에서만' 유지한다 — 직전이 pending(취소됨)이면 계보가 끊긴 것이므로
    // 옛 표식을 이어받지 않는다. 이렇게 하면 취소 정리 저장이 실패해 표식이 찌꺼기로 남아도, 그 섹션을 다시 열 때
    // 되살아나지 않고 자연히 false로 정리된다(초기화 시엔 항상 false).
    const prevInLineage = prevRec?.status === "confirmed" || prevRec?.status === "editing";
    // 롤백(restore)은 계보 규칙을 우회한다 — 취소 롤백은 '취소 직전' 값을 그대로 되살리는 것이고,
    // 그 값은 중간 pending 레코드에 보존돼 있다. 이걸 계보 밖이라고 지워 버리면 롤백이 원래 표식/이력을 잃는다.
    const carryPrev = restore || prevInLineage;
    const carriedEvents = (resetConfirm || !carryPrev) ? [] : prevEvents;
    // editedAfterConfirm: 초기화=false / 재오픈·재확정=true / 그 외(마감수정 취소 포함)=계보 값 유지.
    // 마감수정 취소는 표식을 '깨끗이' 지우지 않는다 — 편집 중 자동저장으로 데이터가 이미 바뀌었을 수 있고(되돌리지 않음),
    // 그걸 사유·흔적 없는 '깨끗한 확정'으로 만들면 관리자가 변경을 모른 채 지나친다. '확정 후 열림' 표식을 그대로 남긴다(원래 동작).
    const editedAfterConfirm = resetConfirm ? false
      : (isReopen || isReconfirm) ? true
      : !!(carryPrev && prevRec?.editedAfterConfirm);
    // 재수정 이벤트: 시각 + 지점이 입력한 사유(무엇을 왜 바꿨는지)를 함께 남긴다(관리자 팝업 표시용). 이제 '재확정' 시점에만 쌓는다.
    const reasonEvent = { at: now, reason: (reason || "").slice(0, 200) };
    const nextRecord = {
      id: `${branchName}-${selectedMonth}-${section}`,
      branchName, month: selectedMonth, section, status, writer: branchName,
      confirmedAt: resetConfirm ? "" : (status === "confirmed" ? now : prevConfirmedAt),
      editedAfterConfirm,
      // 수정 이력은 '확정 계보' 안에서만 이어받고(최근 20건), 재확정일 때만 사유 이벤트를 덧붙인다. 초기화/계보끊김이면 비운다.
      editEvents: isReconfirm ? [...carriedEvents, reasonEvent].slice(-20) : carriedEvents,
      updatedAt: now
    };
    // 낙관적 UI: 클릭 즉시 상태칩을 반영(로컬 상태 먼저 갱신) → 사용자는 지연 없이 바로 확인.
    // 단 'editing으로의 전환'(=잠금 해제)은 로컬 prevRec 상태와 무관하게 '항상' 서버 성공 후에만 반영한다.
    // (로컬 prevRec으로 isReopen을 판정하면 스테일 로컬일 때 가드가 빠져 확정 데이터가 서버 수락 전에 열릴 수 있다.
    //  서버 쓰기가 느리거나 실패하면 그 사이 사유·수락 없이 확정 데이터가 바뀔 위험 — 그래서 잠금 해제는 아래 run()이
    //  '서버 성공 후'에만 반영한다.) 확정/취소처럼 '잠그는' 방향은 낙관적으로 즉시 반영해도 안전하다.
    if (status !== "editing") {
      setMonthlyCloseRecords((prev) => [nextRecord, ...prev.filter((r) => !matches(r))]);
    }
    // 서버 반영(read-modify-write)을 직렬화한다: 같은 기기에서 여러 섹션을 연속 마감할 때
    // 각 저장이 직전 저장의 결과를 읽은 뒤 병합하도록 하여 서로의 섹션 레코드를 덮어쓰지 않게 한다.
    const run = async () => {
      // 판정과 쓰기를 **한 트랜잭션 안에서** 한다(2026-08-11). 두 가지를 동시에 해결한다.
      //
      // (1) 유실 방지: monthly_closings 는 전 지점·전 섹션이 함께 쓰는 문서 하나라, 미리 읽어둔 값 위에
      //     통째로 저장하면 그 사이 다른 기기가 올린 레코드가 사라진다. 특히 비즈니스택시·연차관리
      //     '확인' 레코드가 날아가면 그 지점은 다음 마감이 막히는데 확인 화면에는 '확정'으로 보여
      //     원인을 찾을 수 없다. 이 섹션 레코드만 갈아끼우고 나머지는 트랜잭션이 본 값을 그대로 보존한다.
      //
      // (2) 스테일 판정 방지: 재확정 여부·사유 요구·계보·표식을 트랜잭션 **밖** 스냅샷으로 정하면,
      //     읽은 뒤 커밋 전에 다른 기기가 이 섹션을 바꿨을 때 낡은 판정이 그대로 커밋된다.
      //     예) 이쪽이 '미제출→확정'으로 읽은 사이 다른 기기가 확정 후 수정을 시작하면,
      //     사유 없는 확정이 되고 쌓여 있던 수정 이력까지 지워진다 — 사유 게이트가 통째로 우회된다.
      //     트랜잭션은 커밋될 스냅샷으로 다시 실행되므로(경합 시 재시도), 판정이 항상 커밋될 값과 같다.
      //
      // updater 는 순수하다: current 말고는 바깥에서 이미 확정된 값(now·reason·status·opts·nextRecord)만 읽는다.
      // 커밋 결과는 **반환값**으로 받는다 — 바깥 변수에 담아 두면 재시도 때 값이 어긋난다(gasClient 주석).
      const { value: committed } = await gasClient.mutateSharedData<any[]>("monthly_closings", (current) => {
        // null = 문서 없음(기록이 아직 없음, 정상) → []. 값이 있는데 배열이 아니면(형식 손상)
        // 재수정 여부를 단정할 수 없어 중단(fail-closed). throw 는 트랜잭션을 취소시킨다.
        if (current != null && !Array.isArray(current)) {
          throw new Error("마감 상태 형식이 올바르지 않습니다. 다시 시도해주세요.");
        }
        const list = Array.isArray(current) ? current : [];
        // 표식·이력은 서버 값을 최우선으로 유지한다 — 로컬이 스테일이어도 '확정 후 수정' 사실/이력을 잃지 않는다.
        const prevServer = latest(list);
        // 서버 기준 판정도 직전 status로(confirmedAt 아님) — 취소된 미제출 섹션의 찌꺼기 confirmedAt에 무해.
        // 재오픈(확정→editing)은 사유를 받지 않는다(제출 때 받음). 재확정(editing→confirmed, 확정후수정)일 때만 사유 이벤트를 남긴다.
        const serverReopen = status === "editing" && prevServer?.status === "confirmed" && !restore;
        const serverReconfirm = status === "confirmed" && prevServer?.status === "editing" && !!prevServer?.editedAfterConfirm && !restore && !cancelEdit;
        // 최종 판정상 '확정본을 수정 후 재확정'인데 사유가 없으면(인라인 사유칸 우회/경쟁) 사유 없는 확정을 남기지 않는다 —
        // 저장을 중단하고 재입력을 요구한다(fail-closed). 정상 경로는 handleConfirm이 인라인 사유칸을 먼저 검증한다.
        if (serverReconfirm && !(reason || "").trim()) {
          throw new Error("확정된 마감을 수정했습니다. 수정 사유를 입력해야 마감제출할 수 있습니다.");
        }
        const serverEvents = Array.isArray(prevServer?.editEvents) ? prevServer.editEvents : [];
        // 서버 기준 '확정 계보'(confirmed↔editing) 여부 — 표식·이력을 이 안에서만 이어받는다. 롤백(restore)은 계보를 우회해 복원.
        const serverInLineage = restore || prevServer?.status === "confirmed" || prevServer?.status === "editing";
        const carryServerEvents = serverInLineage ? serverEvents : [];
        // 초기화(취소)면 비운 상태 그대로 기록한다 — 서버의 옛 확정후수정 표식/이력을 되살리지 않는다.
        const merged = resetConfirm ? { ...nextRecord } : {
          ...nextRecord,
          // confirmedAt도 '서버 기준'으로 맞춘다 — 다른 기기가 취소(초기화)해 서버에서 지워졌으면 로컬 stale 값으로 되살리지 않는다.
          // (표식/이력은 서버 기준인데 confirmedAt만 로컬이면 'editing + 옛 confirmedAt + 표식 없음' 불일치가 남는다.)
          confirmedAt: status === "confirmed" ? now : (prevServer?.confirmedAt || ""),
          // 표식은 서버 기준 계보 안에서만 유지: 재오픈·재확정=true / 그 외(마감수정 취소 포함)=계보 값 유지.
          // (마감수정 취소는 표식을 지우지 않는다 — 편집 중 자동저장 변경을 되돌리지 못하므로 '확정 후 열림'을 남겨 감사한다.)
          editedAfterConfirm: (serverReopen || serverReconfirm) ? true
            : !!(serverInLineage && prevServer?.editedAfterConfirm),
          editEvents: serverReconfirm ? [...carryServerEvents, reasonEvent].slice(-20) : carryServerEvents,
        };
        return [merged, ...list.filter((r: any) => !matches(r))];
      });
      // 커밋된 목록으로 화면을 맞춘다. 다른 섹션·지점의 최신 변경까지 함께 반영된다.
      if (Array.isArray(committed)) setMonthlyCloseRecords(committed);
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
      // 폐지된 선입금 표식은 다음 달로 넘기지 않는다(MonthlyPurchaseSalesSubTab emptyAmounts와 같은 규칙).
      // 넘기면 빈 새 행이 레거시 취급을 받아 미러링이 꺼지고 export 사용액이 0으로 나간다.
      isPrepaid: false,
      prepaidChargeAmount: "",
      monthlyUsageAmount: "",
      // 이월 시 '결제완료' 상태는 초기화 — 다음 달은 '이체 필요'로 시작(월 단위 결제 상태).
      transferNeeded: true
    }));
    localStorage.setItem(nextLocalKey, JSON.stringify(carriedRows));
    await gasClient.saveSharedData(nextKey, carriedRows);
  }, [branchName, selectedMonth]);

  const sectionLabel = (section: CloseSection) =>
    section === "purchase" ? "매입매출"
    : section === "salary" ? "정직원 급여대장"
    : section === "partTimeSalary" ? "파트타이머 급여대장"
    : "매출집계";

  const runConfirm = useCallback(async (section: CloseSection) => {
    if (blockedByCloseStatus()) return;
    // [선행조건 게이트] 비즈니스택시·연차관리를 지점이 눈으로 확인했는가.
    // 말일에 제출하는 3종(매입매출·매출집계·파트타이머)에만 건다 — 매입매출 하나에만 걸면
    // 매출집계를 먼저 눌러 우회할 수 있다. 정직원 급여대장(salary)은 25일 작성이라 제외.
    // 다른 검증(매출집계 정합성·급여대장 flush)보다 **먼저** 둔다: 어차피 막힐 제출이면
    // 서버 왕복과 급여 쓰기를 먼저 시킬 이유가 없다.
    if ((GATED_CLOSE_SECTIONS as readonly string[]).includes(section)) {
      // 안내는 하단 토스트가 아니라 **팝업**으로 띄운다(사용자 지시 2026-08-11) —
      // 토스트는 화면 아래에서 잠깐 떴다 사라져서, 마감 버튼만 보고 있던 지점은 못 보고
      // "왜 제출이 안 되지" 하며 다시 누른다. 여기는 눌러서 닫아야 하는 안내여야 한다.
      let missing: CheckSection[];
      try {
        missing = await findMissingCheckSections(branchName, selectedMonth);
      } catch (error) {
        // fail-closed — '확인했는지 알 수 없음'을 '확인함'으로 흘리면 게이트가 있으나 마나다.
        console.error("월말 확인 상태 조회 실패:", error);
        window.alert(
          `${sectionLabel(section)} 마감을 중단했습니다.\n\n` +
          `비즈니스택시·연차관리 확인 상태를 서버에서 읽지 못했습니다.\n` +
          `네트워크 상태를 확인한 뒤 다시 시도해주세요.`
        );
        return;
      }
      if (missing.length > 0) {
        window.alert(`${sectionLabel(section)} 마감을 제출할 수 없습니다.\n\n${missingCheckMessage(selectedMonth, missing)}`);
        return;
      }
    }
    // 매출집계 제출 시에만 매출집계 정합성/영속화를 검증한다(다른 섹션 마감과 무관).
    if (section === "salesSummary") {
      const summaryCheck = await loadSalesSummaryForClose(branchName, selectedMonth);
      if (summaryCheck.blocked) {
        triggerToast("매출집계를 서버에 반영/확인하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.", "error");
        return;
      }
      if ((window as any).__ugdSalesSummaryInvalid === true || isSalesSummaryDataInvalid(summaryCheck.data)) {
        window.dispatchEvent(new Event("ugd_show_monthly_errors"));
        triggerToast("매출집계에 확인이 필요합니다(금액 불일치 또는 빈칸).", "error");
        return;
      }
    }
    // 급여대장(정직원·파트타이머)/매입매출은 마감 확정 전에 이 기기의 입력을 서버에 반영 보장(실패 시 중단).
    if (isSalaryCloseSection(section)) {
      // 열람 권한이 없으면 급여 데이터를 읽거나 쓰지 않는다 — flush가 먼저 서버 조회/저장을 시도하므로
      // 그 앞에서 fail-closed로 막는다(권한 없는 계정이 마감 버튼으로 급여 요청을 보내는 우회 차단).
      if (!canReadSalaryBranch(user, branchName)) {
        triggerToast(`${sectionLabel(section)} 열람 권한이 없어 마감할 수 없습니다. 본사 관리자에게 문의해주세요.`, "error");
        return;
      }
      // 비밀번호 잠금이 풀리지 않았으면 급여 데이터를 건드리지 않는다 — 잠긴 채로 마감을 눌러
      // 급여대장을 읽고 쓰는 우회를 막는다(버튼 숨김과 이중 방어).
      if (!isSalaryUnlockedNow()) {
        triggerToast("급여대장 비밀번호를 먼저 입력해야 마감할 수 있습니다.", "error");
        return;
      }
    }
    if (section === "salary") {
      const flush = await flushFullTimeSalaryForClose(branchName, selectedMonth);
      if (flush.blocked) {
        triggerToast("정직원 급여대장에 저장된 데이터가 없거나 서버 반영에 실패했습니다. 급여대장 탭에서 데이터를 확인·입력한 뒤 다시 시도해주세요.", "error");
        return;
      }
    }
    if (section === "partTimeSalary") {
      const flush = await flushPartTimeSalaryForClose(branchName, selectedMonth);
      if (flush.blocked) {
        // 이유별로 고칠 방법을 짚어 준다 — 뭉뚱그리면 지점이 어디를 고쳐야 할지 모른 채 반복 제출한다.
        triggerToast(
          flush.reason === "unnamed" ? "성명이 비어 있는 행이 있어 마감할 수 없습니다. 이름을 적거나 필요 없는 행이면 삭제(X)해주세요."
          : flush.reason === "zeroPaid" ? "근무시간은 있는데 급여가 0원인 행이 있어 마감할 수 없습니다. 시급을 채운 뒤 다시 제출해주세요."
          : flush.reason === "empty" ? "파트타이머 급여대장에 저장된 행이 없어 마감할 수 없습니다. 급여대장을 확인한 뒤 다시 시도해주세요."
          : flush.reason === "manualWork" ? "근무일지의 수기 근무를 아직 불러오지 못해 마감할 수 없습니다. 표 위의 [다시 시도]를 누른 뒤 다시 제출해주세요."
          : "파트타이머 급여대장을 서버에 반영/확인하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.",
          "error"
        );
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
    // 확정본을 수정한 뒤 다시 제출하는 경우(재확정)에만 '무엇을 왜 바꿨는지' 사유를 받는다.
    // 최초 확정(미제출→확정)이나 미확정 상태 편집엔 사유가 필요 없다. 사유는 편집 전이 아니라 이 제출 순간에 인라인칸으로 받는다.
    const rec = getSectionRecord(section);
    const needsReason = rec?.status === "editing" && !!rec?.editedAfterConfirm;
    const reason = (editReasonDrafts[section] || "").trim();
    if (needsReason && !reason) {
      setReasonErrors((prev) => ({ ...prev, [section]: true }));
      triggerToast("수정 사유를 입력해야 마감제출할 수 있습니다.", "error");
      return;
    }
    try {
      // 확정을 먼저 저장한다 — 사유 게이트가 saveSectionClose 안에 있어(serverReconfirm && !reason → throw),
      // 사유 미입력/경쟁으로 재확정이 거부되면 여기서 throw되고 아래 '다음 달 이월'은 실행되지 않는다.
      // (이월을 앞에 두면, 거부된 확정에도 다음 달 이월 데이터가 먼저 써지는 부작용이 생긴다.)
      await saveSectionClose(section, "confirmed", reason);
      setEditReasonDrafts((prev) => ({ ...prev, [section]: "" }));
      setReasonErrors((prev) => ({ ...prev, [section]: false }));
      // 다음 달 이월은 확정 성공 뒤 부가작업 — 실패해도 이번 달 확정은 유효하다(별도 안내).
      if (section === "purchase") {
        try {
          await carryMonthlyPurchasesToNextMonth();
        } catch (carryError) {
          console.error(carryError);
          triggerToast(`${selectedMonth} 매입매출 마감은 완료됐지만 다음 달 이월에 실패했습니다. 다음 달 매입매출 탭에서 확인해주세요.`, "error");
          return;
        }
      }
      triggerToast(`${selectedMonth} ${sectionLabel(section)} 마감제출이 완료되었습니다.`, "success");
    } catch (error: any) {
      console.error(error);
      triggerToast(error?.message || "마감 저장에 실패했습니다.", "error");
    }
  }, [branchName, carryMonthlyPurchasesToNextMonth, saveSectionClose, selectedMonth, triggerToast, getSectionRecord, editReasonDrafts, user, blockedByCloseStatus]);

  // 파트타이머 제출은 진행 중 잠금(partTimeSubmitting)으로 감싼다 — 차단/실패/성공 어느 경로로 끝나도
  // finally 가 반드시 푼다. 다른 섹션은 종전과 동일하게 그대로 실행한다.
  const handleConfirm = useCallback(async (section: CloseSection) => {
    if (section !== "partTimeSalary") { await runConfirm(section); return; }
    setPartTimeSubmitting(true);
    try {
      await runConfirm(section);
    } finally {
      setPartTimeSubmitting(false);
    }
  }, [runConfirm]);

  const handleEdit = useCallback(async (section: CloseSection) => {
    if (blockedByCloseStatus()) return;
    // 급여 섹션(정직원·파트타이머)의 마감상태 변경도 열람 권한 + 비밀번호 해제가 있어야 한다 — 낡은 화면/세션으로 재개·취소하는 우회 차단(fail-closed).
    if (isSalaryCloseSection(section) && !canReadSalaryBranch(user, branchName)) {
      triggerToast(`${sectionLabel(section)} 열람 권한이 없습니다. 본사 관리자에게 문의해주세요.`, "error");
      return;
    }
    if (isSalaryCloseSection(section) && !isSalaryUnlockedNow()) {
      triggerToast("급여대장 비밀번호를 먼저 입력해주세요.", "error");
      return;
    }
    // '마감수정' = 편집을 연다. 사유는 이제 수정 전이 아니라, 수정을 마치고 '마감제출'(재확정)할 때 인라인 사유칸으로 받는다.
    // 확정본을 여는지(=사유 필요) 여부는 saveSectionClose가 '서버 최신값' 기준으로 판정해 editedAfterConfirm에 남기고,
    // 제출 시 그 값을 보고 인라인 사유칸이 뜬다. 확정 여부 서버 재조회는 saveSectionClose 내부(serverReopen)가 수행한다.
    try {
      await saveSectionClose(section, "editing", "");
      triggerToast(`${selectedMonth} ${sectionLabel(section)} 마감을 수정할 수 있습니다. 수정을 마친 뒤 사유를 적고 다시 마감제출해주세요.`, "success");
    } catch (error: any) {
      console.error(error);
      triggerToast(error?.message || "마감 수정 상태 저장에 실패했습니다.", "error");
    }
  }, [saveSectionClose, selectedMonth, triggerToast, user, branchName, blockedByCloseStatus]);

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
      // 금액을 다 비우면 지킬 레거시 값도 없다 — 표식까지 끊어 새 입력이 새 규칙을 따르게 한다.
      isPrepaid: false,
      prepaidChargeAmount: "",
      monthlyUsageAmount: "",
      // 금액 초기화 시 '결제완료' 상태도 초기화 — 이후 재입력한 이체가 결제완료로 오인돼 누락되는 것을 방지.
      transferNeeded: true
    }));
    localStorage.setItem(`erp_monthly_purchases_${branchName}_${selectedMonth}`, JSON.stringify(resetRows));
    await gasClient.saveSharedData(`monthly_purchases:${branchName}:${selectedMonth}`, resetRows);
  }, [branchName, selectedMonth]);

  const handleCancel = useCallback(async (section: CloseSection) => {
    if (blockedByCloseStatus()) return;
    // 급여 섹션(정직원·파트타이머) 마감취소도 열람 권한 + 비밀번호 해제 필요(handleEdit와 동일한 fail-closed 가드).
    if (isSalaryCloseSection(section) && !canReadSalaryBranch(user, branchName)) {
      triggerToast(`${sectionLabel(section)} 열람 권한이 없습니다. 본사 관리자에게 문의해주세요.`, "error");
      return;
    }
    if (isSalaryCloseSection(section) && !isSalaryUnlockedNow()) {
      triggerToast("급여대장 비밀번호를 먼저 입력해주세요.", "error");
      return;
    }
    if (section === "purchase") {
      if (!window.confirm("매입매출 마감을 취소하고 거래처 금액 입력값만 초기화할까요?\n거래처명, 은행, 계좌, 기타내용은 유지됩니다.")) return;
      // 초기화 실패 시 되돌릴 '취소 직전 상태'를 미리 캡처한다(하드코딩 confirmed 금지 — 실제 이전 상태로 복원).
      const prevStatus = getSectionStatus("purchase");
      try {
        // 1) 먼저 pending으로만 전환한다(확정이력은 아직 유지) — 금액초기화 실패 시 롤백이 원래 상태를 정확히 복원할 수 있게.
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
        // 2) 금액초기화 성공 → 즉시 화면을 갱신한다(리셋 토큰). 이 갱신이 빠지면 화면은 옛 금액을 계속 보여주고,
        //    그 상태에서 한 칸이라도 수정하면 방금 초기화한 서버 금액을 되덮을 수 있다 → 토큰은 반드시 먼저 실행한다.
        setPurchaseResetToken((value) => value + 1);
        // 3) 확정 사이클 초기화(관리자 '확정후수정' 버튼 제거)는 부가작업 — 실패해도 취소·금액초기화는 이미 완료다.
        //    조용히 넘어간다(다음 확정/취소 때 자연히 정리됨). 여기서 throw하면 성공한 취소가 '실패'로 잘못 보인다.
        await saveSectionClose("purchase", "pending", "", { resetConfirm: true }).catch(() => {});
        triggerToast(`${selectedMonth} 매입매출 마감이 취소되고 거래처 금액이 초기화되었습니다.`, "success");
      } catch (error: any) {
        console.error(error);
        triggerToast(error?.message || "마감 취소에 실패했습니다.", "error");
      }
      return;
    }
    if (!window.confirm(`${sectionLabel(section)} 마감을 취소할까요?`)) return;
    try {
      // 마감취소 = 제출 철회 → 확정 사이클 초기화(확정후수정 표식·이력 제거).
      await saveSectionClose(section, "pending", "", { resetConfirm: true });
      triggerToast(`${selectedMonth} ${sectionLabel(section)} 마감이 취소되었습니다.`, "success");
    } catch (error: any) {
      console.error(error);
      triggerToast(error?.message || "마감 취소에 실패했습니다.", "error");
    }
  }, [getSectionStatus, resetMonthlyPurchaseAmounts, saveSectionClose, selectedMonth, triggerToast, user, branchName, blockedByCloseStatus]);

  const handleCancelEdit = useCallback(async (section: CloseSection) => {
    if (blockedByCloseStatus()) return;
    // 급여 섹션(정직원·파트타이머) '수정취소'도 열람 권한 + 비밀번호 해제 필요(handleEdit/handleCancel와 동일한 fail-closed 가드).
    if (isSalaryCloseSection(section) && !canReadSalaryBranch(user, branchName)) {
      triggerToast(`${sectionLabel(section)} 열람 권한이 없습니다. 본사 관리자에게 문의해주세요.`, "error");
      return;
    }
    if (isSalaryCloseSection(section) && !isSalaryUnlockedNow()) {
      triggerToast("급여대장 비밀번호를 먼저 입력해주세요.", "error");
      return;
    }
    try {
      // 마감수정 취소 = 수정을 제출하지 않고 확정으로 되돌림 → 사유를 요구하지 않는다(cancelEdit). 입력하던 사유 초안도 비운다.
      await saveSectionClose(section, "confirmed", "", { cancelEdit: true });
      setEditReasonDrafts((prev) => ({ ...prev, [section]: "" }));
      setReasonErrors((prev) => ({ ...prev, [section]: false }));
      triggerToast(`${selectedMonth} ${sectionLabel(section)} 수정이 취소되고 확정으로 돌아갔습니다.`, "success");
    } catch (error: any) {
      console.error(error);
      triggerToast(error?.message || "마감 수정 취소에 실패했습니다.", "error");
    }
  }, [saveSectionClose, selectedMonth, triggerToast, user, branchName, blockedByCloseStatus]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    void fetchMonthlyCloseStatus();
  }, [fetchMonthlyCloseStatus]);

  // 선택한 월/섹션의 제출상태 칩
  const statusPill = (section: CloseSection) => {
    // 상태를 못 읽었으면 '미제출'이라고 단정하지 않는다 — 확정해 둔 섹션이 미제출로 보이면
    // 지점은 다시 제출하려 들고, 실제 원인(조회 실패·문서 손상)은 어디에도 안 뜬다.
    // 오류색은 hex 로 못 박는다 — rose-* 는 지점 스코프에서 치환돼 경고가 평범한 안내로 보인다.
    if (closeStatusError) {
      return (
        <span className="monthly-close-status-pill rounded-lg px-2.5 py-1 text-xs font-black bg-[#FDE2E2] text-[#B91C1C] border border-[#C93A3A]">
          상태 확인 불가
        </span>
      );
    }
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

  // '확정 후 수정' 중인 섹션을 다시 제출하기 전에, 무엇을 왜 바꿨는지 사유를 인라인으로 받는다(팝업 아님).
  // 확정본을 연 경우(editing + editedAfterConfirm)에만 뜬다. 자주 쓰는 사유 칩으로 빠르게 채울 수 있다.
  const renderReasonBox = (section: CloseSection) => {
    const rec = getSectionRecord(section);
    if (!(rec?.status === "editing" && rec?.editedAfterConfirm)) return null;
    const draft = editReasonDrafts[section] || "";
    const err = !!reasonErrors[section];
    return (
      <div className="w-full rounded-2xl border border-amber-200 bg-amber-50/70 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-black text-amber-800">
          <Pencil className="w-3 h-3" /> 수정 사유 — 확정본을 고쳤습니다. 무엇을 왜 바꿨는지 적어주세요(관리자에게 그대로 표시됩니다).
        </div>
        <div className="flex flex-wrap gap-1.5">
          {REASON_CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { setEditReasonDrafts((prev) => ({ ...prev, [section]: c })); setReasonErrors((prev) => ({ ...prev, [section]: false })); }}
              className="px-2 py-1 rounded-full border border-amber-300 bg-white text-[10px] font-black text-amber-800 hover:bg-amber-100 cursor-pointer"
            >
              {c}
            </button>
          ))}
        </div>
        <textarea
          value={draft}
          onChange={(e) => { const v = e.target.value; setEditReasonDrafts((prev) => ({ ...prev, [section]: v })); if (v.trim()) setReasonErrors((prev) => ({ ...prev, [section]: false })); }}
          rows={2}
          placeholder="예: 김OO 상여금 반영 / 계좌번호 정정 / 3월 누락분 추가"
          className={`w-full rounded-xl border px-3 py-2 text-[11px] font-bold resize-none focus:outline-none ${err ? "border-[#C93A3A] bg-[#FDE2E2] text-[#8F1F1F]" : "border-gray-200 bg-white"}`}
        />
        {err && <p className="text-[10px] font-black text-[#C93A3A]">수정 사유를 입력해야 마감제출할 수 있습니다.</p>}
      </div>
    );
  };

  // 결산월 선택기. 종전에는 현금관리·현금지출·카드지출 위에 "결산월 선택:" 한 줄이 따로 떠 있어
  // 표 카드와 따로 노는 덩어리가 됐다. 이제 각 탭의 제목 밴드 안 필터 자리에 넣는다(DESIGN.md §6-3).
  // 모양(28px·11px·알약·흰 바탕)은 `.branch-band-filters` 가 !important 로 강제하므로 여기서 적지 않는다.
  const renderMonthPicker = () => (
    <div className="branch-band-filters">
      <input
        type="month"
        value={selectedMonth}
        onChange={(e) => setSelectedMonth(e.target.value)}
        aria-label="결산월 선택"
        title="결산월 선택"
      />
    </div>
  );

  // 월말마감 헤더(제목 pill + 결산월 선택 + 마감버튼 + 제출상태). 카드 안/밖 어디서든 재사용.
  const renderPortalHeader = () => (
    <>
      {/* 제목 밴드 = 지점 표준(index.css `.branch-band*`, 관리자 §4-0 과 같은 문법 — 2026-08-03 사용자 지시).
          예전엔 왼쪽 알약 제목과 오른쪽 2줄(결산월·제출상태)이 서로 다른 세로선에 걸려 어긋나 보였다.
          이제 한 줄 안에서 제목 → 결산월(필터) → 설명 → 제출상태·마감버튼 순으로 자리가 고정된다. */}
      <div className="branch-band">
        {/* 매입매출 탭에서는 위쪽 '매출집계'와 짝이 되도록 '매입집계'로, 정직원급여 탭에서는 탭 이름 그대로 부른다. */}
        <h3 className="branch-band-title">
          {activeSubTab === "purchaseSales" ? "매입집계" : "정직원 급여대장"}
        </h3>
        {(activeSubTab === "purchaseSales" || activeSubTab === "fullTimeSalary") && (
          <div className="branch-band-filters">
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              aria-label="결산월 선택"
              title="결산월 선택"
            />
            {/* 업체/직원 추가·자동저장 — 월 필터 오른쪽(사용자 지시 2026-08-04).
                버튼 모양(월 필터와 같은 흰 알약)은 `.branch-band-filters` CSS 가 자동으로 입힌다.
                동작은 자식 탭 것이라 ref 로 건네받는다(밴드는 부모가, 표는 자식이 그리므로). */}
            {activeSubTab === "purchaseSales" && (
              <button
                type="button"
                onClick={() => purchaseAddRowRef.current?.()}
                disabled={getSectionStatus("purchase") === "confirmed"}
                className="flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-3.5 h-3.5" /> 매입 업체 추가
              </button>
            )}
            {/* 정직원용 버튼은 급여 잠금(역할 권한 + 비밀번호)이 풀린 동안만 그린다 — 밴드는 게이트
                **밖**이라, 잠긴 채 노출하면 게이트를 우회해 급여 행을 만드는 통로가 된다(Codex P0 2026-08-04).
                표 자체가 게이트 뒤라 잠기면 버튼이 가리키는 대상도 없다. */}
            {activeSubTab === "fullTimeSalary" && canReadSalaryBranch(user, branchName) && salaryUnlocked && (
              <>
                <button
                  type="button"
                  onClick={() => fulltimeAddRowRef.current?.()}
                  disabled={getSectionStatus("salary") === "confirmed"}
                  className="flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus className="w-3.5 h-3.5" /> 직원 추가
                </button>
                {/* 초과근무 참고는 상시 노출 대신 버튼 토글 — 눌린 상태 색은 aria-pressed CSS 가 준다.
                    바탕은 표 머리글과 같은 엘리스(band-filter-accent) — 입력 버튼이 아니라 '보기' 버튼임을 가른다. */}
                <button
                  type="button"
                  aria-pressed={showOtSummary}
                  onClick={() => setShowOtSummary((v) => !v)}
                  className="band-filter-accent"
                >
                  초과근무 확인
                </button>
              </>
            )}
            <span className={`p-1 px-3.5 rounded-lg text-[11px] font-black flex items-center gap-1 ${getSectionStatus(activeSubTab === "fullTimeSalary" ? "salary" : "purchase") === "confirmed" ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"}`}>
              <Check className="w-3.5 h-3.5" /> {getSectionStatus(activeSubTab === "fullTimeSalary" ? "salary" : "purchase") === "confirmed" ? "확정 잠금" : "자동저장"}
            </span>
          </div>
        )}
        <p className="branch-band-meta">{adminSettings.monthlyReportDesc}</p>
        {(activeSubTab === "purchaseSales" || activeSubTab === "fullTimeSalary") && (
          <div className="branch-band-actions">
            <span className="text-[11px] font-bold text-slate-400">{selectedMonth} 제출상태</span>
            {statusPill(activeSubTab === "fullTimeSalary" ? "salary" : "purchase")}
            {/* '이력 갱신' 버튼은 없앴다 — 탭을 열 때와 결산월을 바꿀 때 자동으로 다시 불러오고,
                지출·현금관리 탭에서 수정·삭제하면 그쪽에서 refreshHistory를 부른다. 손으로 누를 일이 없다. */}
            {/* 급여 마감 컨트롤은 급여대장 표와 달리 헤더에 있어 SalaryAccessGate로 감싸이지 않는다.
                그래서 역할·지점 권한(canReadSalaryBranch)과 비밀번호 해제(salaryUnlocked)를 여기서 함께 본다 —
                잠긴 채로 마감을 눌러 급여 데이터를 읽고 쓰는 우회를 막는다(각 핸들러의 가드와 이중 방어). */}
            {activeSubTab === "fullTimeSalary" && canReadSalaryBranch(user, branchName) && salaryUnlocked && renderCloseControls("salary")}
            {activeSubTab === "purchaseSales" && renderCloseControls("purchase")}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="space-y-6 animate-fade-in" id="monthly-settle-tab-root">
      {/* 마감 상태 문서를 못 읽었다 — 화면의 '미제출'을 믿으면 안 되는 상태라 맨 위에 못 박아 알린다.
          오류색은 hex 직접 지정(rose-* 는 지점 스코프에서 치환돼 경고가 평범한 안내로 보인다). */}
      {closeStatusError && (
        <div className="rounded-2xl border px-4 py-3 text-xs font-bold bg-[#FDE2E2] border-[#C93A3A] text-[#B91C1C] flex items-center justify-between gap-3">
          <span>{closeStatusError} — 마감 상태를 확인할 수 없어 제출·수정·취소가 잠겼습니다.</span>
          <button
            type="button" onClick={() => void fetchMonthlyCloseStatus()}
            className="shrink-0 rounded-full bg-[#212121] text-[#F6F5FA] px-4 py-1.5 text-[11px] font-black cursor-pointer"
          >
            다시 시도
          </button>
        </div>
      )}

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
                guideOpen ? "bg-zinc-900 text-[#F4F2CC]" : "bg-[#F4F2CC] text-zinc-900 hover:brightness-95"
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
          reasonBox={renderReasonBox("salesSummary")}
        />
      )}

      {(activeSubTab === "purchaseSales" || activeSubTab === "fullTimeSalary") ? (
        /* 월말마감: 제목 밴드 + 내용(거래처/급여대장)을 한 표준 카드로 묶음(DESIGN.md §6-3).
           카드에 padding 을 주지 않는다 — 표 머리글이 밴드(또는 밴드 연장 줄)에 **바로 붙어야**
           관리자 화면과 같은 모양이 된다(사용자 지시 2026-08-04). 예전 p-4 래퍼가 표를 카드 안
           떠 있는 상자로 보이게 한 원인이었다. 사유 상자·스피너 같은 표 아닌 내용만 자기 여백을 갖는다. */
        /* 키 이동 칩은 제목 밴드 상단선에 걸친다(사용자 지시 2026-08-04). 카드는 overflow:hidden 이라
           카드 안에서 위로 내밀면 잘린다 — 카드 **밖** relative 래퍼를 기준으로 띄워야 한다. */
        <div className="relative">
          <SheetKeyHint />
          <div className="branch-sheet-card">
          {renderPortalHeader()}
          {(() => {
            // reasonBox 가 없을 때 빈 여백 div 를 남기면 밴드-표 붙임이 깨진다 — 있을 때만 감싼다.
            const rb = renderReasonBox(activeSubTab === "fullTimeSalary" ? "salary" : "purchase");
            return rb ? <div className="px-4 pt-4">{rb}</div> : null;
          })()}
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center space-y-3">
              <LoadingSpinner size="lg" />
              <span className="text-xs text-gray-400 font-bold font-mono">가맹점 무인 원격 일지에서 일일 정산자료 조합 파싱 중...</span>
            </div>
          ) : activeSubTab === "fullTimeSalary" ? (
            // 역할 권한 → 비밀번호 두 관문을 통과해야 표가 마운트된다(설계서 §15.4).
            <SalaryAccessGate branchName={branchName} title="정직원 급여대장 - 보안 잠금" guideAnchor="fulltime-salary-table">
              <MonthlyFullTimeSalarySubTab branchName={branchName} selectedMonth={selectedMonth} triggerToast={triggerToast} isLocked={getSectionStatus("salary") === "confirmed"} registerAddRow={(fn) => { fulltimeAddRowRef.current = fn; }} showOtSummary={showOtSummary} />
            </SalaryAccessGate>
          ) : (
            <MonthlyPurchaseSalesSubTab branchName={branchName} selectedMonth={selectedMonth} triggerToast={triggerToast} resetToken={purchaseResetToken} isLocked={getSectionStatus("purchase") === "confirmed"} registerAddRow={(fn) => { purchaseAddRowRef.current = fn; }} />
          )}
          </div>
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
              {/* 현금관리·현금지출·카드지출에도 결산월 선택을 붙인다(사용자 지시 2026-07-31).
                  종전에는 매입매출·정직원급여 헤더에만 있어서, 이 세 탭은 지난달을 볼 방법이 없었다.
                  (그 헤더는 '매입집계/정직원 급여대장' 제목과 마감 버튼이 함께 있어 여기서는 못 쓴다 —
                  선택기만 같은 모양으로 따로 둔다. 값은 같은 selectedMonth 라 탭을 옮겨도 유지된다.) */}
              {activeSubTab === "partTimeSalary" && (
                <>
                  {renderReasonBox("partTimeSalary")}
                  {/* 파트타이머 급여대장도 정직원과 같은 권한·같은 비밀번호로 막는다(사용자 지시 2026-07-28). */}
                  <SalaryAccessGate branchName={branchName} title="파트타이머 급여대장 - 보안 잠금">
                    {/* 결산월 선택 + 제출상태 + 마감 컨트롤(제출/수정/취소)은 급여대장 카드의 **제목 밴드 안**에 넣는다.
                        종전에는 카드 위에 옛 회색 입력칸 한 줄이 따로 떠 있어, 밴드로 옮긴 다른 월말 탭들과 혼자 달라 보였다
                        (DESIGN.md §6-3 — 카드 밖에 뜬 필터 줄은 밴드 필터 자리로 넣는다).
                        마감 버튼은 정직원 헤더와 같은 이중 방어 — 역할·지점 권한 + 비밀번호 해제를 모두 통과해야 보인다
                        (각 핸들러의 fail-closed 가드와 별개로, 잠긴 채 마감을 눌러 급여를 읽고 쓰는 우회를 막는다).
                        [바뀐 점] 월 선택기와 제출상태가 이제 가드 **안**에 있어 잠금 해제 뒤에 보인다 —
                        어차피 이 탭에서 볼 것은 표뿐이고, 마감 여부는 월말업무 제출현황에서도 확인된다. */}
                    <MonthlyPartTimeSalarySubTab
                      branchName={branchName}
                      selectedMonth={selectedMonth}
                      history={history}
                      triggerToast={triggerToast}
                      isLocked={getSectionStatus("partTimeSalary") === "confirmed" || partTimeSubmitting}
                      monthPicker={renderMonthPicker()}
                      bandActions={
                        <>
                          <span className="text-[11px] font-bold text-slate-400">{selectedMonth} 제출상태</span>
                          {statusPill("partTimeSalary")}
                          {canReadSalaryBranch(user, branchName) && salaryUnlocked && renderCloseControls("partTimeSalary")}
                        </>
                      }
                    />
                  </SalaryAccessGate>
                </>
              )}
              {activeSubTab === "cashExpenses" && (
                <MonthlyCashExpensesSubTab branchName={branchName} selectedMonth={selectedMonth} history={history} isAdmin={isAdmin} refreshHistory={() => fetchHistory({ silent: true })} monthPicker={renderMonthPicker()} />
              )}
              {activeSubTab === "cashManagement" && (
                <MonthlyCashManagementSubTab branchName={branchName} selectedMonth={selectedMonth} history={history} isAdmin={isAdmin} refreshHistory={fetchHistory} monthPicker={renderMonthPicker()} />
              )}
              {activeSubTab === "cardExpenses" && (
                <MonthlyCardExpensesSubTab branchName={branchName} selectedMonth={selectedMonth} history={history} isAdmin={isAdmin} refreshHistory={() => fetchHistory({ silent: true })} monthPicker={renderMonthPicker()} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
