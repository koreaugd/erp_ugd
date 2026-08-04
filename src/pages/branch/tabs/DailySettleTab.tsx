// src/pages/branch/tabs/DailySettleTab.tsx  (BranchConfirmPage에서 분리 — 동작 변경 없음)
import { useState, useEffect, useMemo, useCallback, useRef, type KeyboardEvent } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Calendar, CheckCircle, CheckCircle2, ClipboardList, Info, Lock, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import "./staffSheet.css";
import { gasClient } from "../../../api/gasClient";
import { useAuthContext } from "../../../contexts/AuthContext";
import LoadingSpinner from "../../../components/LoadingSpinner";
import { GuideCallouts } from "../../../components/GuideCallouts";
import { SheetKeyHint } from "../../../components/SheetKeyHint";
import { dailySettleGuideSteps } from "../helpers/guideSteps";
import { formatNumber } from "../../../utils/formatNumber";
import type { DailySettleValidationField, DailySettleValidationTargets, Employee, ExpenseRow, StaffAddDraft, StaffAddReason, StaffRow } from "../types";
import { cleanNumeric, formatWithCommas } from "../helpers/formatters";
import { ExpenseGrid } from "../components/ExpenseGrid";
import { CASH_DEFAULT_CLASSIFICATION, CASH_DEFAULT_USAGE, getExpenseRowProblem, isExpenseRowFilled, isExpenseRowIncomplete, padExpenseRows } from "../helpers/expenseRows";
import { useSheetKeyboardNav } from "../helpers/useSheetKeyboardNav";
import { createDailySettleValidationTargets, createEmployeeFromStaffRow, createStaffAddDraft, employeeNameKey, getAddReasonChoiceClass, getDailyStaffValidationKey, isSampleEmployee, needsOvertimeReason, normalizeRosterEmployee, parseStaffAddReasonChoice, shouldSkipDailyRosterRegistration, staffListPendingStorageKey, staffListStorageKey } from "../helpers/staffHelpers";

export function DailySettleTab({ branchName }: { branchName: string }) {
  const { user } = useAuthContext();
  const isPersonalSession = user?.loginType === "personal";
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

  // 일일마감 '작성방법 보기' 토글(여러 섹션 안내를 한 번에). 탭 진입 시 기본으로 켜 둔다(사용자가 닫을 수 있음).
  // 작성방법 말풍선은 기본 닫힘 — 자동으로 열리면 매일 닫는 일이 생긴다(사용자 지시 2026-08-04).
  const [dailyGuideOpen, setDailyGuideOpen] = useState(false);
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
  // 당일 신규 네이버 리뷰 갯수 — 매출과 함께 매일 필수 입력. GAS 마스터 컬럼이 아니라 메모 METADATA에 저장된다.
  const [naverReviewCount, setNaverReviewCount] = useState<string>("");
  // 이 필드가 없던 시절(레거시) 기록만 필수 검증에서 면제한다. 필드를 갖고 저장된 기록은
  // 수정 모드에서도 필수 유지 — 안 그러면 수정 제출로 필수값이 조용히 지워진다(Codex P1).
  const [existingRecordHadNaverReview, setExistingRecordHadNaverReview] = useState<boolean>(false);

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

  // Expenses — 시트처럼 빈 행을 미리 깔아두고, 마지막 행을 채우면 아래로 자동 증식한다.
  // 현금지출 새 행 기본 분류 = "소모품등 기타"(사용자 지시 2026-08-04). 카드는 기본값("식재료") 그대로.
  const [cashExpenses, setCashExpenses] = useState<ExpenseRow[]>(() => padExpenseRows([], CASH_DEFAULT_CLASSIFICATION, CASH_DEFAULT_USAGE));
  const [cardExpenses, setCardExpenses] = useState<ExpenseRow[]>(() => padExpenseRows([]));

  // Personnel List states
  const [staffRows, setStaffRows] = useState<StaffRow[]>([]);

  const [memo, setMemo] = useState<string>("");

  // App states
  const [checking, setChecking] = useState<boolean>(false);
  const [hasExistingRecord, setHasExistingRecord] = useState<boolean>(false);
  const [existingRecordId, setExistingRecordId] = useState<string | null>(null);
  // 기존 기록 로드 시점의 원작성자를 보관한다. 수정 저장 시 submittedBy를 현재 화면의
  // writer(작성자란은 수정자일 뿐 원작성자가 아니다)로 덮어쓰지 않기 위한 보존용 참조.
  const originalSubmittedByRef = useRef<{ name: string; uid: string }>({ name: "", uid: "" });

  // 마감 작성자는 매일 실제 마감한 사람이 직접 적는다(사용자 지시 2026-08-04).
  // 신규 폼을 열어도 계정 이름을 기본값으로 깔지 않는다 — 공용 계정으로 여러 사람이 쓰는 지점에서
  // 자동 입력된 이름이 그대로 제출되는 것을 막기 위함이다(필수 검증은 제출 시점에서 잡는다).
  // 실제 로그인 계정은 submittedByUid/modifiedByUid 로 별도 기록되어 감사 추적은 그대로 유지된다.
  // personalDefaultWriter 는 제출 버튼 옆 "로그인 계정" 안내 표시에만 쓴다.
  const personalDefaultWriter = isPersonalSession ? String(user?.name ?? "").trim() : "";
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
      setNaverReviewCount(draft.naverReviewCount || "");
      setCashBalance(draft.cashBalance || "");
      setPrevDayCash(options?.preservePrevDayCash ?? draft.prevDayCash ?? "0");
      setCashDiffReason(draft.cashDiffReason || "");
      setStaffMemo(draft.staffMemo || "");
      setReviewMemo(draft.reviewMemo || "");
      setOtherMemo(draft.otherMemo || "");
      setCashExpenses(padExpenseRows(draft.cashExpenses, CASH_DEFAULT_CLASSIFICATION, CASH_DEFAULT_USAGE));
      setCardExpenses(padExpenseRows(draft.cardExpenses));
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

    // 이름 없이 사유만 골라둔 줄은 예전엔 말없이 버려졌다. 지웠는지 잊었는지 알 수 없으니 짚어준다.
    const namelessWithReason = staffAddDrafts.filter((draft) => !draft.name.trim() && draft.addReason);
    if (namelessWithReason.length > 0) {
      triggerToast("이름을 적지 않은 줄이 있습니다. 이름을 넣거나 그 줄을 삭제해 주세요.", "error");
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
    // 날짜·지점을 빠르게 연달아 바꾸면 앞선 요청이 뒤늦게 끝나 '지금 보고 있는 날짜'의 입력칸을 덮어쓴다.
    // 그 뒤 자동저장이 그 값을 현재 draftKey로 저장하므로 다른 날짜의 초안까지 오염된다.
    // 그래서 await 마다 취소 여부를 확인하고, 예약해 둔 초안 복원 타이머도 정리한다(Codex 지적 2026-07-28).
    let cancelled = false;
    let draftRestoreTimer: number | null = null;
    const scheduleDraftRestore = (preservePrevDayCash: string) => {
      draftRestoreTimer = window.setTimeout(() => {
        draftRestoreTimer = null;
        if (cancelled) return;
        if (restoreDraftIfAvailable({ preservePrevDayCash })) {
          setStaffRows((current) => reconcileDraftStaffRows(current));
        }
      }, 0);
    };

    const checkDuplicateAndLoad = async () => {
      try {
        setChecking(true);
        setDraftReady(false);
        const res = await gasClient.getDailyFormBootstrap(branchName, settleDate);
        if (cancelled) return;
        const prevCashVal = res.previousCash || "0";

        if (res.exists && res.recordId) {
          setHasExistingRecord(true);
          setExistingRecordId(res.recordId);
          setIsEditApproved(false); // Reset to false and require approval warning
          // Load details
          const detail = await gasClient.getDailyDetail(res.recordId);
          if (cancelled) return;

          setCashSales(String(detail.master.cashSales || "0"));
          setCardSales(String(detail.master.cardSales || "0"));
          setTransferSales(String(detail.master.transferSales || "0"));
          setDeliverySales(String(detail.master.deliverySales || "0"));
          // 새 마감에서는 작성자를 비워 두되, 기존 마감을 수정할 때는
          // 당시 작성자를 반드시 되살립니다.
          // 과거 마감에는 작성자가 숫자로 저장된 경우가 있습니다.
          // 입력값과 제출 검증에서 trim()을 안전하게 사용할 수 있도록 항상 문자열로 정규화합니다.
          const restoredWriter = String(detail.master.submittedBy ?? "");
          setWriter(restoredWriter);
          // 수정 저장 시 submittedBy를 덮어쓰지 않도록 원작성자(이름·uid)를 보존해 둔다.
          originalSubmittedByRef.current = { name: restoredWriter, uid: String((detail.master as any).submittedByUid ?? "") };

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
            setCashExpenses(padExpenseRows(metadataParsed.cashExpenses, CASH_DEFAULT_CLASSIFICATION, CASH_DEFAULT_USAGE));
            setCardExpenses(padExpenseRows(metadataParsed.cardExpenses));
            setCashBalance(metadataParsed.cashBalance !== undefined ? String(metadataParsed.cashBalance) : "");
            setNaverReviewCount(metadataParsed.naverReviewCount !== undefined ? String(metadataParsed.naverReviewCount) : "");
            setExistingRecordHadNaverReview(metadataParsed.naverReviewCount !== undefined);
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

            setCashExpenses(padExpenseRows(savedCashExps, CASH_DEFAULT_CLASSIFICATION, CASH_DEFAULT_USAGE));
            setCardExpenses(padExpenseRows(savedCardExps));

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
            setNaverReviewCount("");
            setExistingRecordHadNaverReview(false);
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
          originalSubmittedByRef.current = { name: "", uid: "" };
          setIsEditApproved(true); // Automatically approved since it is fresh!
          setCashSales("");
          setCardSales("");
          setTransferSales("");
          setDeliverySales("");
          setNaverReviewCount("");
          setExistingRecordHadNaverReview(false);
          setCashExpenses(padExpenseRows([], CASH_DEFAULT_CLASSIFICATION, CASH_DEFAULT_USAGE));
          setCardExpenses(padExpenseRows([]));
          setMemo("");
          setCashBalance("");
          setPrevDayCash(prevCashVal);
          setCashDiffReason("");
          // 신규 작성 폼 — 작성자는 빈칸으로 두어 직접 입력받는다(2026-08-04).
          // 임시저장 초안이 있으면 바로 아래 restoreDraftIfAvailable가 사용자가 마지막에 둔 값으로 덮어쓴다.
          setWriter("");
          setStaffMemo("");
          setReviewMemo("");
          setOtherMemo("");
          const freshRoster = await refreshRosterCache();
          if (cancelled) return;
          initRosterInForm(freshRoster);
          scheduleDraftRestore(prevCashVal);
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error("Duplicate checking error:", err);
        triggerToast("이전 데이터를 검사하는 도중 문제가 생겼습니다.", "error");
        // Fresh start on fail
        setHasExistingRecord(false);
        setExistingRecordId(null);
        originalSubmittedByRef.current = { name: "", uid: "" };
        setIsEditApproved(true);
        setCashBalance("");
        setNaverReviewCount("");
        setExistingRecordHadNaverReview(false);
        setPrevDayCash("0");
        setCashDiffReason("");
        // 이 경로도 '신규 작성 폼을 연 상태'다 — 정상 경로와 같이 작성자는 빈칸으로 둔다.
        setWriter("");
        setStaffMemo("");
        setReviewMemo("");
        setOtherMemo("");
        const freshRoster = await refreshRosterCache();
        if (cancelled) return;
        initRosterInForm(freshRoster);
        scheduleDraftRestore("0");
      } finally {
        if (!cancelled) {
          setChecking(false);
          setDraftReady(true);
        }
      }
    };

    checkDuplicateAndLoad();
    return () => {
      cancelled = true;
      if (draftRestoreTimer !== null) window.clearTimeout(draftRestoreTimer);
    };
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

  // 근무자 표를 엑셀처럼 방향키로 오간다. 지점(9칸)과 본사(11칸) 표는 한 번에 하나만 뜨므로 훅도 하나면 된다.
  // 계산 결과 칸(근무/초과)과 삭제 버튼에는 cellProps를 달지 않는다 — 훅이 알아서 건너뛴다.
  const { cellProps: staffCellProps } = useSheetKeyboardNav({
    rowCount: staffRows.length,
    colCount: isHeadOffice ? 11 : 8
  });

  // 마감정보+매출 엑셀 셀을 방향키·Enter로 오간다(§9 엑셀 형식 필수). 한 줄, 7칸:
  // 작성자(0)·카드(1)·현금(2)·계좌이체(3)·배달(4)·금고(5)·네이버리뷰(6). 날짜 칸은 커스텀 달력 버튼이라 이 그리드 밖이고,
  // 버튼에서 →로 작성자(0)로 넘어오게 별도 배선한다(아래 date 버튼 onKeyDown).
  const SETTLE_SHEET_COLS = 7;
  const { cellProps: settleSheetCellProps, focusCell: settleSheetFocusCell } = useSheetKeyboardNav({
    rowCount: 1,
    colCount: SETTLE_SHEET_COLS
  });
  // 날짜 칸은 커스텀 달력 버튼이라 훅에 등록되지 않는다(input/select/textarea만 등록 가능). 그래서 버튼 ref를 잡아
  // 작성자(col 0)에서 ←로 날짜로, 날짜 버튼에서 →로 작성자로 서로 오가게 손수 잇는다 — 날짜 칸도 화살표 그리드의 일원.
  const settleDateBtnRef = useRef<HTMLButtonElement>(null);
  // Enter는 이 한 줄 폼에선 '오른쪽 다음 칸'으로 보낸다(엑셀 Enter=아래지만 아래 행이 없다). 나머지 키는 훅에 위임.
  const settleSheetNav = (col: number) => {
    const base = settleSheetCellProps(0, col);
    return {
      ...base,
      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
        const mod = e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing;
        // 맨 왼쪽 입력칸(작성자)에서 ←로 커서가 맨 앞이면 날짜 칸(달력 버튼)으로 넘어간다(글자 중간에선 평범한 커서 이동).
        if (!mod && col === 0 && e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0) {
          e.preventDefault();
          settleDateBtnRef.current?.focus();
          return;
        }
        if (!mod && e.key === "Enter") {
          e.preventDefault();
          if (col + 1 < SETTLE_SHEET_COLS) settleSheetFocusCell(0, col + 1);
          return;
        }
        base.onKeyDown(e);
      }
    };
  };

  // 상세 내용은 적었는데 금액이 비어 있는 행. 그냥 두면 저장 시 조용히 사라지므로 제출을 막는다.
  const incompleteCashExpenseRows = useMemo(
    () => cashExpenses.map((row, index) => (isExpenseRowIncomplete(row) ? index : -1)).filter((index) => index >= 0),
    [cashExpenses]
  );
  const incompleteCardExpenseRows = useMemo(
    () => cardExpenses.map((row, index) => (isExpenseRowIncomplete(row) ? index : -1)).filter((index) => index >= 0),
    [cardExpenses]
  );

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
          naverReviewCount,
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
  }, [draftReady, checking, submittedResult, draftKey, writer, cashSales, cardSales, transferSales, deliverySales, naverReviewCount, cashBalance, prevDayCash, cashDiffReason, staffMemo, reviewMemo, otherMemo, cashExpenses, cardExpenses, staffRows]);

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
      const workedIndexes = activeIndexes.filter((index) => Number(next[index].workHours || 0) > 0);
      const totalWorkHours = workedIndexes.reduce((sum, index) => sum + Number(next[index].workHours || 0), 0);
      const totalDelta = parseFloat((totalWorkHours - standard).toFixed(1));
      if (workedIndexes.length === 0) return;
      if (totalDelta <= 0) {
        const lastIndex = workedIndexes[workedIndexes.length - 1];
        if (lastIndex !== undefined) next[lastIndex].overtime = totalDelta;
        return;
      }
      let cumulativeHours = 0;
      let allocatedOvertime = 0;
      workedIndexes.forEach((index) => {
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

  // 지출 행의 추가/삭제/수정은 ExpenseGrid가 내부에서 처리한다.

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
      // 이 필드가 없던 시절(레거시) 기록 수정만 면제. 필드를 갖고 저장된 기록은 수정 시에도 필수
      // — 아니면 수정 제출로 필수값이 조용히 지워진다.
      if ((!hasExistingRecord || existingRecordHadNaverReview) && !naverReviewCount) {
        nextValidationTargets.fields.naverReviewCount = true;
        validationMessages.push("네이버 신규 리뷰 갯수를 입력해 주세요.");
        rememberFirstInvalid("settle-naverReviewCount-input");
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

    // 쓰다 만 지출 행(금액 누락 / 상세 누락)은 그대로 두면 저장이 어긋나므로, 제출 전에 해당 칸으로 커서를 보낸다.
    const findIncompleteExpense = () => {
      for (const [variant, label, rows] of [
        ["cash", "현금", cashExpenses],
        ["card", "카드", cardExpenses]
      ] as const) {
        const index = rows.findIndex((row) => getExpenseRowProblem(row) !== null);
        if (index >= 0) return { variant, label, index, problem: getExpenseRowProblem(rows[index])! };
      }
      return null;
    };
    const incompleteExpense = findIncompleteExpense();
    if (incompleteExpense) {
      const { variant, label, index, problem } = incompleteExpense;
      setValidationErrors(true);
      triggerToast(
        problem === "missing-amount"
          ? `${label} 지출 ${index + 1}번 행의 금액을 입력해 주세요. 금액이 비었거나 0원이면 저장되지 않습니다. (내용이 잘못 들어간 행이면 휴지통으로 지워 주세요.)`
          : `${label} 지출 ${index + 1}번 행의 지출 상세 내용을 입력해 주세요. 무엇에 쓴 돈인지 적어야 합니다.`,
        "error"
      );
      window.requestAnimationFrame(() => {
        const field = problem === "missing-amount" ? "amount" : "detail";
        // 지출 입력은 넓은 화면이면 시트, 좁은 화면이면 카드형으로 갈린다.
        // 숨겨진 쪽은 offsetParent가 없으므로, 지금 화면에 떠 있는 칸을 골라 커서를 보낸다.
        const candidates = [
          document.getElementById(`daily-${variant}-expense-${field}-${index}`),
          document.getElementById(`daily-${variant}-expense-${field}-${index}-card`)
        ].filter((el): el is HTMLElement => el instanceof HTMLElement);
        const target = candidates.find((el) => el.offsetParent !== null) ?? candidates[0];
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.focus({ preventScroll: true });
      });
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
    if (!isHeadOffice && (!hasExistingRecord || existingRecordHadNaverReview) && !naverReviewCount) {
      setValidationErrors(true);
      triggerToast("네이버 신규 리뷰 갯수를 입력해 주세요.", "error");
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

    // 지점 표는 이름을 그 자리에서 고칠 수 있다 — 이름을 지운 채 제출하면 주인 없는 근무 기록이 남으므로,
    // 이름을 채우거나 × 로 행을 지우게 막는다. (본사 표의 '추가 구간' 행은 이름이 비어도 정상이라 지점에만 적용)
    if (!isHeadOffice) {
      const blankNameStaff = staffRows.filter((staff) => !String(staff.name || "").trim());
      if (blankNameStaff.length > 0) {
        setValidationErrors(true);
        triggerToast("이름이 비어 있는 근무자 행이 있습니다. 이름을 입력하거나 × 로 행을 삭제해 주세요.", "error");
        return;
      }
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
      // 시트는 빈 행을 늘 깔아두므로, 메타데이터에는 실제 지출 행만 담는다(빈 행은 복원 시 다시 채워진다).
      const serializeMetaData = JSON.stringify({
        staffRows,
        cashExpenses: cashExpenses.filter(isExpenseRowFilled),
        cardExpenses: cardExpenses.filter(isExpenseRowFilled),
        cashBalance,
        naverReviewCount,
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
        // 정산 표에서 이름을 고쳐도 기존 직원이 새 이름으로 명부에 중복 등록되지 않게, 주민번호로도 매칭한다.
        // (영구 이름 변경은 직원현황 탭에서 한다.)
        const rosterResidentNumbers = new Set<string>();

        [...remoteRoster, ...localRoster].forEach((employee) => {
          if (isSampleEmployee(employee)) return;
          const normalized = normalizeRosterEmployee(employee);
          if (!normalized) return;
          const name = normalized.name;
          if (!name || rosterNames.has(name)) return;
          mergedRoster.push(normalized);
          rosterNames.add(name);
          const rrn = (normalized.residentNumber || "").trim();
          if (rrn) rosterResidentNumbers.add(rrn);
        });

        staffRows.forEach((s) => {
          const name = employeeNameKey(s.name);
          const rrn = (s.residentNumber || "").trim();
          // 주민번호가 이미 명부에 있으면(=기존 직원의 이름만 정산 표에서 수정한 경우) 신규 등록하지 않는다.
          if (!name || rosterNames.has(name) || (rrn && rosterResidentNumbers.has(rrn)) || shouldSkipDailyRosterRegistration(s)) return;
          const newEmp = createEmployeeFromStaffRow({ ...s, name });
          mergedRoster.push(newEmp);
          rosterNames.add(name);
          if (rrn) rosterResidentNumbers.add(rrn);
        });

        const remoteNames = new Set(remoteRoster.filter((employee) => !isSampleEmployee(employee)).map((employee) => employeeNameKey(employee.name)).filter(Boolean));
        const needsRemoteSave =
          remoteRoster.some((employee) => isSampleEmployee(employee)) ||
          mergedRoster.length !== remoteNames.size ||
          mergedRoster.some((employee) => !remoteNames.has(employee.name));

        if (needsRemoteSave) {
          localStorage.setItem(staffListPendingStorageKey(branchName), "1");
        }
        localStorage.setItem(staffListStorageKey(branchName), JSON.stringify(mergedRoster));
        if (needsRemoteSave) {
          const result = await gasClient.saveBranchOwnRoster(branchName, mergedRoster);
          localStorage.removeItem(staffListPendingStorageKey(branchName));
          // 다른 지점으로 옮겨진 사람이 근무자 목록에 이름으로 남아 자동 등록되려다 서버에서 제외된 경우,
          // 로컬 저장본을 서버 결과로 맞춘다 — 안 그러면 이 기기에만 남는 유령이 된다(Codex 지적 2026-08-04).
          if (result.rejected?.length) {
            localStorage.setItem(staffListStorageKey(branchName), JSON.stringify(result.employees || []));
            console.warn("[일일마감] 이동·삭제된 직원이 명부 자동 등록에서 제외되었습니다.", result.rejected.map((item: any) => item?.name));
          }
        }
      } catch (e) {
        console.error("Local roster automatic registration failed:", e);
      }

      // 2. Format Expenses matching legacy GAS DB row model properties
      const formattedExpenses = isHeadOffice ? [] : [
        ...cashExpenses
          .filter(isExpenseRowFilled)
          .map((e) => ({
            expenseType: "현금지출" as const,
            itemName: `${e.classification} | ${e.usage} | ${e.detail.trim()}`,
            amount: Number(e.amount) || 0
          })),
        ...cardExpenses
          .filter(isExpenseRowFilled)
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
      // 기존 기록 수정 저장 시에는 submittedBy/submittedByUid를 원작성자 값으로 보존한다.
      // 화면의 writer는 수정 중인 사람의 이름일 수 있고(작성자란이 원작성자로 채워지지 않은 레거시
      // 기록 등), modifiedBy/modifiedByUid가 이미 수정자를 별도로 기록하므로 여기서 덮어쓰지 않는다.
      const isEditingExisting = hasExistingRecord && !!existingRecordId;
      // 원작성자 보존은 개인 세션에만 적용 — PIN 세션은 작성자란을 수기로 고칠 수 있어(입력칸 활성) 그 값을 그대로 저장한다(기존 동작 유지).
      const preserveOriginal = isEditingExisting && isPersonalSession;
      const persistedSubmittedBy = preserveOriginal ? (originalSubmittedByRef.current.name || writerName) : writerName;
      const persistedSubmittedByUid = preserveOriginal ? (originalSubmittedByRef.current.uid || user?.uid || "") : (isPersonalSession ? (user?.uid || "") : "");
      const masterPayload = {
        branchName,
        settleDate,
        cashSales: Number(cashSales) || 0,
        cardSales: Number(cardSales) || 0,
        transferSales: Number(transferSales) || 0,
        deliverySales: Number(deliverySales) || 0,
        memo: combinedMemo,
        submittedBy: persistedSubmittedBy,
        submittedByUid: persistedSubmittedByUid
      };

      let response;
      if (hasExistingRecord && existingRecordId) {
        // Edit mode (GAS Spreadsheet updates row & logs modification)
        response = await gasClient.updateDaily(existingRecordId, masterPayload, formattedExpenses, formattedStaff, writerName, user?.uid || "");
        triggerToast("해당 날짜의 마감 정산 정보가 업데이트에 성공했습니다!");
        // 본문 저장은 이미 끝났다 — 수정이력(edit_logs) 기록만 실패한 경우, 저장 성공 토스트를 덮어써서 알린다.
        if ((response as any)?.editLogFailed) {
          triggerToast("수정이력 기록에 실패했습니다. 저장은 완료됐습니다.", "error");
        }
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
    originalSubmittedByRef.current = { name: "", uid: "" };
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
    setNaverReviewCount("");
    setExistingRecordHadNaverReview(false);
    setCashExpenses(padExpenseRows([], CASH_DEFAULT_CLASSIFICATION, CASH_DEFAULT_USAGE));
    setCardExpenses(padExpenseRows([]));
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

4. 특이사항
- 직원 특이사항: ${staffMemo.trim() || "없음"}
- 리뷰 특이사항: ${reviewMemo.trim() || "없음"}${isHeadOffice ? "" : `
- 네이버 신규 리뷰: ${naverReviewCount === "" ? "미입력" : `${formatNumber(Number(naverReviewCount) || 0)}개`}`}`;
    };

    return (
      <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6" id="success-receipt-box">
        {/* Left Card: Submission Statistics */}
        <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-xl space-y-6 flex flex-col justify-between">
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
        <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-xl space-y-4 flex flex-col justify-between">
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

      {/* 작성방법 안내: 탭 최상단 가운데. 버튼을 다시 누르면 사라진다. 몸통은 클릭이 통과해 켜둔 채 작성 가능.
          GuideCallouts는 포털이라 여기 두어도 각 섹션의 data-guide 위치에 그려진다(없는 앵커는 건너뜀). */}
      <div className="flex justify-center">
        <button
          onClick={() => setDailyGuideOpen((prev) => !prev)}
          aria-pressed={dailyGuideOpen}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-zinc-900 text-[12px] font-black leading-none transition cursor-pointer ${
            dailyGuideOpen ? "bg-zinc-900 text-[#F4F2CC]" : "bg-[#F4F2CC] text-zinc-900 hover:brightness-95"
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" /> {dailyGuideOpen ? "작성방법 닫기" : "작성방법 보기"}
        </button>
      </div>
      <GuideCallouts open={dailyGuideOpen} steps={dailySettleGuideSteps} onClose={() => setDailyGuideOpen(false)} />

      {/* 마감정보 + 매출 — 표준 제목 밴드 카드(DESIGN.md §6-3) + 엑셀형 가로 1자형 표(§9-1).
          두 구획(마감정보·매출)을 하나의 표로 잇고, 사이에 빈 간격 컬럼(settle-spacer) 하나로 '약간의 간격'만 준다.
          구획별 알약 제목 줄(마감정보/매출/당일 신규 리뷰)은 밴드 제목 하나로 합쳤다(밴드 이관 2026-08-04) —
          컬럼 라벨(마감 대상 날짜·카드매출·네이버 신규 리뷰 갯수)이 구획을 스스로 설명한다.
          라벨줄=엘리스+검정 격자(밴드 탭 헤더 색, §9-1), 입력줄=투명 셀+옅은 격자. 검증 오류는 §9대로 셀(td) 배경을 붉게.
          매출 컬럼은 지점 && 잠금해제일 때만(기존 동작 보존), 마감정보는 항상.
          미니달력이 absolute 드롭다운으로 카드 밖까지 열리므로, 이 카드만 overflow:hidden을 풀어 둔다(index.css #sales-section). */}
      <div className="relative">
        {/* 키 이동 칩은 제목 밴드 상단선에 걸친다 — 카드 밖 relative 래퍼 기준(DESIGN.md §6-3). */}
        <SheetKeyHint />
        <section className="branch-sheet-card" id="sales-section">
        {(() => {
          // 매출 컬럼은 지점(본사 아님) && 잠금 해제일 때만. 마감정보 컬럼은 항상.
          const salesShown = !isHeadOffice && !(hasExistingRecord && !isEditApproved);
          const salesFields = [
            { key: "cardSales" as const, label: "카드매출", value: cardSales, setter: setCardSales, req: true, groupStart: true },
            { key: "cashSales" as const, label: "현금매출", value: cashSales, setter: setCashSales, req: true, groupStart: false },
            { key: undefined, label: "계좌이체매출", value: transferSales, setter: setTransferSales, req: false, groupStart: false },
            { key: undefined, label: "배달매출", value: deliverySales, setter: setDeliverySales, req: false, groupStart: false },
            { key: "cashBalance" as const, label: "금고 현금잔액", value: cashBalance, setter: setCashBalance, req: true, groupStart: false },
          ];
          return (
            <>
              <div className="branch-band">
                <h3 className="branch-band-title">{salesShown ? "마감정보 · 매출" : "마감정보"}</h3>
                {salesShown && (
                  <div className="branch-band-actions">
                    <span className="daily-total-chip">
                      당일 총매출 <b className="ml-1 font-mono text-base">{formatNumber(totalSales)}</b> 원
                    </span>
                  </div>
                )}
              </div>
              <div className="relative">
              {/* 좁은 화면에서 표가 페이지를 밀지 않도록 표만 가로 스크롤(overflow-x).
                  미니달력은 absolute 드롭다운이라 이 스크롤 래퍼 '밖'(형제)에 두어 잘리지 않게 한다. */}
              <div className="overflow-x-auto">
                <table className="settle-sheet-table">
              <colgroup>
                <col style={{ width: 132 }} />
                <col style={{ width: 118 }} />
                {salesShown && <col style={{ width: 22 }} />}
                {salesShown && salesFields.map((_, i) => <col key={i} style={{ width: 108 }} />)}
                {salesShown && <col style={{ width: 22 }} />}
                {salesShown && <col style={{ width: 132 }} />}
              </colgroup>
              <thead>
                {/* 컬럼 라벨 줄 — 엘리스 헤더셀 + 검정 격자(구획 제목은 위 밴드로 합침) */}
                <tr>
                  <th className="settle-col-th is-groupstart">마감 대상 날짜<span className="settle-req">필수</span></th>
                  <th className="settle-col-th">마감 작성자<span className="settle-req">필수</span></th>
                  {salesShown && <th className="settle-spacer" aria-hidden="true" />}
                  {salesShown && salesFields.map((f, i) => (
                    <th key={i} className={`settle-col-th${f.groupStart ? " is-groupstart" : ""}`}>
                      {f.label}{f.req && <span className="settle-req">필수</span>}
                    </th>
                  ))}
                  {salesShown && <th className="settle-spacer" aria-hidden="true" />}
                  {salesShown && (
                    <th className="settle-col-th is-groupstart">
                      네이버 신규 리뷰 갯수<span className="settle-req">필수</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {/* 입력 줄 — 투명 셀 입력칸, 옅은 격자 */}
                <tr>
                  <td className="settle-cell is-groupstart relative" data-guide="daily-settle-date">
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
                      ref={settleDateBtnRef}
                      onClick={() => setShowStatusCalendar(prev => !prev)}
                      onKeyDown={(e) => {
                        // →로 작성자 칸으로 넘어간다(엑셀 이동). Enter/Space는 달력 토글(버튼 기본 동작) 유지.
                        if (e.key === "ArrowRight") {
                          e.preventDefault();
                          settleSheetFocusCell(0, 0);
                        }
                      }}
                      className="settle-date-cell-btn"
                    >
                      <span>{settleDate || "날짜 선택"}</span>
                      <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
                    </button>
                  </td>
                  <td className={`settle-cell${validationErrors && hasValidationField("writer") ? " settle-cell-error" : ""}`}>
                    <input
                      {...settleSheetNav(0)}
                      type="text"
                      value={writer}
                      onChange={(e) => {
                        setWriter(e.target.value);
                        clearValidationField("writer");
                      }}
                      placeholder="작성자 성명"
                      className="sheet-cell-input"
                      id="settle-writer-input"
                      title="마감 작성자를 직접 입력하세요."
                    />
                  </td>
                  {salesShown && <td className="settle-spacer" aria-hidden="true" />}
                  {salesShown && salesFields.map((field, idx) => {
                    const hasError = Boolean(validationErrors && field.key && hasValidationField(field.key));
                    return (
                      <td
                        key={idx}
                        className={`settle-cell${field.groupStart ? " is-groupstart" : ""}${hasError ? " settle-cell-error" : ""}`}
                        data-guide={field.key === "cashBalance" ? "daily-cash-balance" : undefined}
                      >
                        <input
                          {...settleSheetNav(idx + 1)}
                          type="text"
                          value={formatWithCommas(field.value)}
                          onChange={(e) => {
                            field.setter(cleanNumeric(e.target.value));
                            if (field.key) clearValidationField(field.key);
                          }}
                          id={field.key ? `settle-${field.key}-input` : undefined}
                          className="sheet-cell-input text-right font-mono font-bold"
                        />
                      </td>
                    );
                  })}
                  {salesShown && <td className="settle-spacer" aria-hidden="true" />}
                  {salesShown && (
                    <td
                      className={`settle-cell is-groupstart${validationErrors && hasValidationField("naverReviewCount") ? " settle-cell-error" : ""}`}
                      data-guide="daily-naver-review"
                    >
                      <input
                        {...settleSheetNav(salesFields.length + 1)}
                        type="text"
                        value={formatWithCommas(naverReviewCount)}
                        onChange={(e) => {
                          setNaverReviewCount(cleanNumeric(e.target.value));
                          clearValidationField("naverReviewCount");
                        }}
                        placeholder="갯수"
                        id="settle-naverReviewCount-input"
                        className="sheet-cell-input text-right font-mono font-bold"
                      />
                    </td>
                  )}
                </tr>
              </tbody>
                </table>
              </div>
              {/* 미니달력: 스크롤 래퍼 '밖'에 두어 잘리지 않게(표 바로 아래에 열린다) */}
              {showStatusCalendar && renderMiniCalendar()}
              </div>
            </>
          );
        })()}

        {/* 표 아닌 안내 블록만 자기 여백을 갖는다(DESIGN.md §6-3). */}
        <div className="mx-4 my-2.5">
        {!hasExistingRecord ? (
          // 큰 회색 박스로 감쌀 만한 내용이 아니다 — 한 줄 안내다.
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400">
            <Info className="w-3.5 h-3.5 shrink-0" />
            {settleDate} 마감을 새로 작성합니다.
          </span>
        ) : isEditApproved ? (
          // 이미 승인해 수정 모드에 들어왔으면 '승인 필요'라고 하지 않는다 — 다음 할 일을 안내한다.
          <div className="px-3 py-2 bg-rose-50 border border-rose-200 rounded-xl inline-flex items-center gap-2 text-xs text-rose-800 leading-normal">
            <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
            <span>
              <strong>수정 모드:</strong> 값을 고친 뒤 마감을 다시 제출하세요.
            </span>
          </div>
        ) : (
          <div className="px-3 py-2 bg-rose-50 border border-rose-200 rounded-xl inline-flex items-center gap-2 text-xs text-rose-800 leading-normal">
            <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
            <span>
              <strong>기저장 정보 존재:</strong> 수정하시려면 승인이 필요합니다.
            </span>
          </div>
        )}
        </div>
        </section>
      </div>

      {/* Prominent Red warning for duplicate records */}
      {hasExistingRecord && (
        <div className={`p-5 rounded-2xl border ${
          isEditApproved
            ? "bg-rose-50 border-rose-200 text-rose-900 shadow-xs"
            : "bg-red-600 border-red-700 text-white shadow-md"
        } transition-all space-y-4`} id="existing-record-warning-box">
          {/* 승인 전에만 안내한다 — 승인 후에는 아래 본문이 '승인되었습니다'로 바뀌므로 이 배너는 감춘다. */}
          {!isEditApproved && (
            <div className="rounded-2xl border border-zinc-900 bg-[#F4F2CC] p-4 text-sm font-black text-zinc-950">
              기존 마감 기록이 있는 날짜입니다. 수정하려면 아래의 [수정모드로 진행할 것을 승인함] 버튼을 눌러 주세요.
            </div>
          )}
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
              {!isEditApproved && (
                <button
                  type="button"
                  onClick={() => {
                    setIsEditApproved(true);
                    triggerToast("수정 모드로 진입했습니다. 값을 고친 뒤 마감을 다시 제출하세요.", "success");
                  }}
                  className="px-3.5 py-2 bg-white hover:bg-gray-100 text-red-600 rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1"
                >
                  ✏️ 수정모드로 진행할 것을 승인함
                </button>
              )}
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
                  originalSubmittedByRef.current = { name: "", uid: "" };
                  setCashSales(""); setCardSales(""); setTransferSales(""); setDeliverySales(""); setNaverReviewCount(""); setExistingRecordHadNaverReview(false); setCashBalance(""); setCashDiffReason(""); setStaffMemo(""); setReviewMemo(""); setOtherMemo(""); setCashExpenses(padExpenseRows([], CASH_DEFAULT_CLASSIFICATION, CASH_DEFAULT_USAGE)); setCardExpenses(padExpenseRows([])); localStorage.removeItem(draftKey); initRosterInForm(); setIsEditApproved(true);
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
          <div className="w-12 h-12 bg-gray-100/80 text-gray-400 rounded-full flex items-center justify-center border border-gray-100">
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
      {/* EXPENSE TABLES SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" id="expenses-section">
        <ExpenseGrid
          variant="cash"
          title="현금 지출 내역"
          sum={cashExpensesSum}
          rows={cashExpenses}
          onRowsChange={setCashExpenses}
          errorRowIndexes={incompleteCashExpenseRows}
          guideKey="daily-cash-expense"
        />
        <ExpenseGrid
          variant="card"
          title="카드 지출 내역"
          sum={cardExpensesSum}
          rows={cardExpenses}
          onRowsChange={setCardExpenses}
          errorRowIndexes={incompleteCardExpenseRows}
          guideKey="daily-card-expense"
        />
      </div>

      {/* CASH SETTLE/CLOSING SECTION (현금마감) — 표준 제목 밴드 카드(DESIGN.md §6-3) */}
      <section className="branch-sheet-card" id="cash-closing-section">
        <div className="branch-band">
          <h3 className="branch-band-title">현금마감 정산 (시재 일치 점검)</h3>
        </div>
        <div className="p-4 space-y-3">

        {/* 입력 칸이 하나도 없는 순수 계산 표시다. 카드 7장으로 쪼개 두니 300px를 쓰면서도
            정작 "전일 + 매출 − 지출 = 이론값, 실사와 얼마나 다른가" 라는 흐름이 안 보였다.
            식을 그대로 한 줄로 편다. 숫자와 계산은 그대로다.
            차이는 마감을 막는 사건이라 색으로 크게 짚어준다(Tailwind 색은 디자인 CSS가 덮어써서 전용 클래스를 쓴다). */}
        {(() => {
          const theory = (Number(prevDayCash) || 0) + (Number(cashSales) || 0) - cashExpensesSum;
          const diffVal = (Number(cashBalance) || 0) - theory;
          return (
            <div className="cash-flow-row">
              <span>전일현금 <b className="ml-1 font-mono text-sm">{formatNumber(Number(prevDayCash) || 0)}</b></span>
              <span className="cash-flow-op">+</span>
              <span>현금매출 <b className="ml-1 font-mono text-sm">{formatNumber(Number(cashSales) || 0)}</b></span>
              <span className="cash-flow-op">−</span>
              <span>현금지출 <b className="ml-1 font-mono text-sm">{formatNumber(cashExpensesSum)}</b></span>
              <span className="cash-flow-op">=</span>
              <span className="cash-flow-box">이론상 잔액 <b className="ml-1 font-mono text-sm">{formatNumber(theory)}</b> 원</span>
              <span className="cash-flow-box">금고 실사 <b className="ml-1 font-mono text-sm">{formatNumber(Number(cashBalance) || 0)}</b> 원</span>
              {diffVal === 0 ? (
                <span className="cash-flow-box cash-flow-diff-ok inline-flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" /> 차이 0원 · 일치
                </span>
              ) : (
                <span className="cash-flow-box cash-flow-diff-bad">
                  차이 <b className="ml-1 font-mono text-sm">{diffVal > 0 ? "+" : ""}{formatNumber(diffVal)}</b> 원 · {diffVal > 0 ? "과잉" : "부족"}
                </span>
              )}
              <span className="ml-auto text-[11px] font-bold text-gray-400">계좌이체 {formatNumber(Number(transferSales) || 0)}원</span>
            </div>
          );
        })()}

        {/* 차이 사유 기입 피드백 */}
        {(() => {
          const theory = (Number(prevDayCash) || 0) + (Number(cashSales) || 0) - cashExpensesSum;
          const actual = Number(cashBalance) || 0;
          const diffVal = actual - theory;
          if (diffVal !== 0) {
            return (
              // 위 계산식이 이미 차이를 빨갛게 짚어준다 — 같은 말을 문단으로 또 하지 않는다. 사유 칸만 남긴다.
              <div className="space-y-1.5">
                <span className="text-xs font-extrabold text-gray-500">불일치 사유 (필수)</span>
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
      </section>
            </>
          )}

      {/* STAFF HOURS TABLE SECTION — 표준 제목 밴드 카드(DESIGN.md §6-3).
          키 이동 칩은 밴드 상단선에 걸친다(카드 밖 relative 래퍼 기준). */}
      <div className="relative">
      <SheetKeyHint />
      <section className="branch-sheet-card" id="staff-attendance-section">
        <div className="branch-band">
          <h3 className="branch-band-title" data-guide="daily-staff-limit">근무자</h3>
          {isHeadOffice && (
            <p className="branch-band-meta">
              본사 직원별 오늘 업무시간과 업무내용을 기록하고, 쉬는 날은 휴무로 체크합니다.
            </p>
          )}
        </div>

        {/* 근무자 추가 — 밴드의 연장 줄(.branch-band-toolbar). 발주관리 '거래처 추가'와 같은 한 줄 즉시 추가.
            이름을 적고 추가를 누르면 아래 표에 바로 한 명이 붙는다(여러 명은 반복 입력). */}
        <div className="branch-band-toolbar">
          <span className="text-[11px] font-black text-gray-500 mr-0.5">근무자 추가</span>
          <input
            type="text"
            placeholder="이름"
            value={staffAddDrafts[0]?.name ?? ""}
            onChange={(e) => updateStaffAddDraft(staffAddDrafts[0].id, { name: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); registerStaffAddDrafts(); } }}
            className="h-8 w-28 px-2 rounded-lg border border-gray-200 bg-white text-[11px] font-bold focus:border-zinc-800 focus:outline-hidden"
          />
          <select
            value={staffAddDrafts[0]?.division ?? "정직원"}
            onChange={(e) => updateStaffAddDraft(staffAddDrafts[0].id, { division: e.target.value as "정직원" | "파트타이머" })}
            aria-label="계약 구분"
            className="h-8 px-2 rounded-lg border border-gray-200 bg-white text-[11px] font-extrabold cursor-pointer"
          >
            <option value="정직원">정직원</option>
            <option value="파트타이머">파트타이머</option>
          </select>
          {/* 이름을 적었는데 사유가 비어 있으면 등록이 막힌다 — 추가를 눌러봐야 알 게 아니라 지금 바로 짚어준다. */}
          <select
            value={staffAddDrafts[0]?.addReason ?? ""}
            onChange={(e) => updateStaffAddDraft(staffAddDrafts[0].id, { addReason: parseStaffAddReasonChoice(e.target.value) })}
            aria-label="추가사유"
            title={staffAddDrafts[0]?.name.trim() && !staffAddDrafts[0]?.addReason ? "추가사유를 골라야 등록됩니다." : undefined}
            className={`h-8 w-32 px-2 text-[11px] ${getAddReasonChoiceClass(staffAddDrafts[0]?.addReason)} ${
              staffAddDrafts[0]?.name.trim() && !staffAddDrafts[0]?.addReason ? "ring-2 ring-rose-400 ring-offset-0" : ""
            }`}
          >
            <option value="">선택</option>
            <option value="신규입사">신규입사</option>
            <option value="지점이동">지점이동</option>
            <option value="기존직원">기존직원</option>
            <option value="기타">기타</option>
          </select>
          <button
            type="button"
            onClick={registerStaffAddDrafts}
            className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-slate-800 px-3 text-[11px] font-black text-white hover:bg-black transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" /> 추가
          </button>
        </div>

        {/* 글자 크기는 등재값 본문 12px(text-xs) — text-sm(14px)은 밴드 제목 외 금지(DESIGN.md §6-0-1). */}
        <div className="mx-4 my-3 rounded-2xl border border-amber-200 bg-[#F8F6A8] px-5 py-4 text-xs leading-relaxed text-zinc-900 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-lg" aria-hidden="true">⚠️</span>
            <div className="space-y-1">
              <p className="font-black">전체 직원 목록이 보여도 실제로 일한 직원만 출근/퇴근 시간을 작성하면 됩니다.</p>
              <p className="text-xs font-bold text-zinc-700">근무하지 않은 직원은 비워두거나 삭제하지 않아도 됩니다. <span className="font-black text-zinc-950">시간은 숫자만 입력해도 자동 변환됩니다.</span> 예: <span className="font-black text-zinc-950">13</span> 입력 시 <span className="font-black text-zinc-950">13:00</span>으로 인식</p>
            </div>
          </div>
        </div>

        {isHeadOffice && (
          <>
          {/* 키 이동 칩은 카드 밖 래퍼가 밴드 상단선에 걸쳐 그린다 — 표 위 중복 칩은 제거(밴드 이관 2026-08-04). */}
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[1160px] whitespace-nowrap">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-gray-100 text-gray-400 font-bold">
                  <th className="py-2 px-2 w-20">이름</th>
                  <th className="py-2 px-2 w-36">근무지점</th>
                  <th className="py-2 px-2 w-24 text-center">휴무</th>
                  <th className="py-2 px-1 w-16">기준</th>
                  <th className="py-2 px-2 w-24">업무시작</th>
                  <th className="py-2 px-2 w-24">업무마감</th>
                  <th className="py-2 px-1 w-14 text-right">근무</th>
                  <th className="py-2 px-1 w-14 text-right">초과</th>
                  <th className="py-2 px-2 min-w-[280px]">업무내용</th>
                  <th className="py-2 px-2 w-44">초과 사유</th>
                  <th className="py-2 px-2 w-10 text-center">삭제</th>
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
                          <td className="py-1.5 px-2 bg-slate-50/60 border-r border-slate-100 text-[10px] font-black text-slate-400 whitespace-nowrap">
                            추가 구간
                          </td>
                        ) : (
                          <td className="py-1.5 px-2 font-bold text-gray-800 whitespace-nowrap">
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
                        )}
                        <td className="py-1.5 px-2">
                          <select
                            {...staffCellProps(idx, 1)}
                            aria-label={`${s.name} 근무지점`}
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
                        {isExtraSegment ? (
                          <>
                            <td className="py-1.5 px-2 bg-slate-50/60 text-center text-[10px] font-black text-slate-300">-</td>
                            <td className="py-1.5 px-1 bg-slate-50/60 text-center font-mono text-[10px] font-black text-slate-300">0h</td>
                          </>
                        ) : (
                          <>
                            <td className="py-1.5 px-2 text-center">
                              <label className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-black text-gray-600 cursor-pointer">
                                <input
                                  {...staffCellProps(idx, 2)}
                                  aria-label={`${s.name} 휴무`}
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
                            <td className="py-1.5 px-1">
                              <select
                                {...staffCellProps(idx, 3)}
                                aria-label={`${s.name} 기준 시간`}
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
                        <td className="py-1.5 px-2">
                          <input
                            {...staffCellProps(idx, 4)}
                            aria-label={`${s.name} 업무시작`}
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
                        <td className="py-1.5 px-2">
                          <input
                            {...staffCellProps(idx, 5)}
                            aria-label={`${s.name} 업무마감`}
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
                        <td className="py-1.5 px-1 text-right font-mono font-black text-sky-700 relative">
                          {s.workHours || 0}h
                          {s.workHours > 13 && <span className="absolute z-10 right-0 top-10 whitespace-nowrap rounded bg-rose-600 px-2 py-1 text-[10px] font-bold text-white shadow">근무시간이 맞는지 확인해 주세요.</span>}
                        </td>
                        <td className="py-1.5 px-1 text-right font-mono font-black">
                          <span className={s.overtime > 0 ? "text-emerald-600" : s.overtime < 0 ? "text-rose-500" : "text-gray-400"}>
                            {s.overtime > 0 ? "+" : ""}{s.overtime || 0}h
                          </span>
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            {...staffCellProps(idx, 8)}
                            aria-label={`${s.name} 업무내용`}
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
                        <td className="py-1.5 px-2">
                          <input
                            {...staffCellProps(idx, 9)}
                            aria-label={`${s.name} 초과 사유`}
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
                        <td className="py-1.5 px-2 text-center">
                          <button
                            type="button"
                            tabIndex={-1}
                            title={`${s.name} 행 삭제`}
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
          <div className="m-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
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
        // 키 이동 칩은 카드 밖 래퍼가 밴드 상단선에 걸쳐 그린다 — 표 위 중복 칩은 제거(밴드 이관 2026-08-04).
        <div className="max-h-[60vh] overflow-auto">
          <table className="staff-sheet w-full text-left border-separate text-xs min-w-[980px] whitespace-nowrap [&_td]:border-r [&_td]:border-b [&_td]:border-black/10 [&_td:first-child]:border-l" style={{ borderSpacing: 0 }}>
            <thead className="sticky top-0 z-10">
              {/* 데이터 칸은 고정폭, 긴 '초과 사유' 칸만 폭 없이 두어 남는 가로폭을 흡수시킨다
                  (그래야 이름·출퇴근 칸이 과도하게 넓어지지 않는다 — DESIGN §9-1 컬럼 폭). */}
              <tr>
                <th className="py-2 px-2 text-center font-black w-44">이름 (성명)</th>
                <th className="py-2 px-2 text-center font-black w-24">계약 구분</th>
                <th className="py-2 px-2 text-center font-black w-28">기준 한도시간</th>
                <th className="py-2 px-2 text-center font-black w-20">출근 시간</th>
                <th className="py-2 px-2 text-center font-black w-20">퇴근 시간</th>
                <th className="py-2 px-2 text-center font-black w-24">실 근무 시간</th>
                <th className="py-2 px-2 text-center font-black w-24">초과 시간</th>
                <th className="py-2 px-2 text-center font-black">초과 상세 사유 (오버타임 필요기입)</th>
              </tr>
            </thead>
            <tbody className="font-medium">
              {staffRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-gray-400">
                    등록된 지점 직원이 없습니다. 추가 입력을 통해 인원을 생성해주세요.
                  </td>
                </tr>
              ) : (
                staffRows.map((s, idx) => {
                  const hasOvertimeDelta = needsOvertimeReason(s);
                  // 출근·퇴근 시간이 '모두' 적힌 행 = 오늘 근무 완료 — 행을 연한 바닐라로 물들여 한눈에 보이게.
                  const hasWorked = Boolean(String(s.clockIn || "").trim() && String(s.clockOut || "").trim());

                  return (
                    <tr key={idx} className={`hover:bg-gray-50/50 ${hasWorked ? "staff-row-worked" : ""}`}>
                      {/* 성명 + 행 삭제(×) — 엑셀 셀. ×는 이름 오른쪽 검정 사각 버튼(사용자 지정 스타일). */}
                      <td className="p-0">
                        <div className="flex items-center gap-1 pl-1.5 pr-1">
                          <input
                            {...staffCellProps(idx, 0)}
                            type="text"
                            value={s.name}
                            onChange={(e) => setStaffRows(prev => prev.map((row, i) => (i === idx ? { ...row, name: e.target.value } : row)))}
                            aria-label={`${s.name} 성명 수정`}
                            placeholder="이름"
                            className="sheet-cell-input w-full min-w-0 h-9 px-1 text-xs font-bold text-gray-800 focus:outline-none"
                          />
                          <button
                            type="button"
                            tabIndex={-1}
                            title={`${s.name || "이 행"} 삭제`}
                            aria-label={`${s.name || "이 행"} 삭제`}
                            onClick={() => setStaffRows(prev => prev.filter((_, i) => i !== idx))}
                            className="shrink-0 flex items-center justify-center w-5 h-5 rounded-md bg-zinc-800 text-white hover:bg-black transition-colors cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </td>

                      {/* 계약 구분 */}
                      <td className="p-0">
                        <select
                          {...staffCellProps(idx, 1)}
                          aria-label={`${s.name} 계약 구분`}
                          value={s.division}
                          onChange={(e) => {
                            const div = e.target.value as "정직원" | "파트타이머";
                            // For Part timer, default standardHours is 0
                            const std = div === "파트타이머" ? 0 : defaultStandardHours;
                            executeStaffCalculation(idx, { division: div, standardHours: std });
                          }}
                          className="sheet-cell-input w-full h-9 px-2 text-[11px] font-bold cursor-pointer focus:outline-none"
                        >
                          <option value="정직원">정직원</option>
                          <option value="파트타이머">파트타이머</option>
                        </select>
                      </td>

                      {/* 기준 한도시간 */}
                      <td className="p-0">
                        {s.division === "파트타이머" ? (
                          <span className="flex items-center justify-center h-9 px-2 text-[11px] font-mono font-bold text-gray-400">0h</span>
                        ) : (
                          <select
                            {...staffCellProps(idx, 2)}
                            aria-label={`${s.name} 기준 한도시간`}
                            value={String(s.standardHours)}
                            onChange={(e) => {
                              executeStaffCalculation(idx, { standardHours: Number(e.target.value) });
                            }}
                            className="sheet-cell-input w-full h-9 px-2 text-[11px] font-mono font-bold cursor-pointer focus:outline-none"
                          >
                            <option value="0">0 (휴무)</option>
                            <option value="9">9 시간</option>
                            <option value="10">10 시간</option>
                            <option value="10.5">10.5 시간</option>
                          </select>
                        )}
                      </td>

                      {/* 출근 시간 — 엑셀 셀. inputMode 를 넣지 않는다(윈도우 IME 영문전환 누수 방지, DESIGN §9). */}
                      <td className={`p-0 relative ${timeErrors[`${idx}-clockIn`] ? "bg-[#FDE2E2]" : ""}`}>
                        <input
                          {...staffCellProps(idx, 3)}
                          aria-label={`${s.name} 출근 시간`}
                          type="text"
                          value={s.clockIn}
                          onChange={(e) => executeStaffCalculation(idx, { clockIn: e.target.value })}
                          onBlur={(e) => normalizeTimeInput(idx, "clockIn", e.target.value)}
                          placeholder="00:00"
                          id={`staff-time-${idx}-clockIn`}
                          className="sheet-cell-input w-full h-9 px-2 text-[11px] font-mono text-center focus:outline-none"
                        />
                        {timeErrors[`${idx}-clockIn`] && <span className="absolute z-10 left-2 top-9 whitespace-nowrap rounded bg-rose-600 px-2 py-1 text-[10px] font-bold text-white shadow">{timeErrors[`${idx}-clockIn`]}</span>}
                      </td>

                      {/* 퇴근 시간 */}
                      <td className={`p-0 relative ${timeErrors[`${idx}-clockOut`] ? "bg-[#FDE2E2]" : ""}`}>
                        <input
                          {...staffCellProps(idx, 4)}
                          aria-label={`${s.name} 퇴근 시간`}
                          type="text"
                          value={s.clockOut}
                          onChange={(e) => executeStaffCalculation(idx, { clockOut: e.target.value })}
                          onBlur={(e) => normalizeTimeInput(idx, "clockOut", e.target.value)}
                          placeholder="00:00"
                          id={`staff-time-${idx}-clockOut`}
                          className="sheet-cell-input w-full h-9 px-2 text-[11px] font-mono text-center focus:outline-none"
                        />
                        {timeErrors[`${idx}-clockOut`] && <span className="absolute z-10 left-2 top-9 whitespace-nowrap rounded bg-rose-600 px-2 py-1 text-[10px] font-bold text-white shadow">{timeErrors[`${idx}-clockOut`]}</span>}
                      </td>

                      {/* 실 근무 시간 (계산) */}
                      <td className="p-0 relative">
                        <span className={`flex items-center justify-center h-9 px-2 text-[11px] font-mono font-bold ${s.workHours > 0 ? "text-sky-700" : "text-gray-400"}`}>{s.workHours} h</span>
                        {s.workHours > 13 && <span className="absolute z-10 left-0 top-9 whitespace-nowrap rounded bg-rose-600 px-2 py-1 text-[10px] font-bold text-white shadow">근무시간이 맞는지 확인해 주세요.</span>}
                      </td>

                      {/* 초과 시간 (계산) */}
                      <td className="p-0">
                        <span className={`flex items-center justify-center h-9 px-2 text-[11px] font-mono font-black ${s.overtime > 0 ? "text-emerald-600" : s.overtime < 0 ? "text-rose-500" : "text-gray-400"}`}>
                          {s.overtime > 0 ? "+" : ""}{s.overtime} h
                        </span>
                      </td>

                      {/* 초과 상세 사유 */}
                      <td className={`p-0 max-w-[200px] ${hasOvertimeDelta && hasOvertimeReasonTarget(s, idx) ? "bg-[#FDE2E2]" : ""}`}>
                        <input
                          {...staffCellProps(idx, 7)}
                          aria-label={`${s.name} 초과 상세 사유`}
                          type="text"
                          value={s.overtimeReason}
                          onChange={(e) => {
                            clearStaffValidationTarget("overtimeReasonRows", s, idx);
                            executeStaffCalculation(idx, { overtimeReason: e.target.value });
                          }}
                          disabled={!hasOvertimeDelta}
                          placeholder={hasOvertimeDelta ? "상세 사유 필수 입력" : "사유 불필요"}
                          id={`staff-overtime-reason-${idx}`}
                          className="sheet-cell-input w-full h-9 px-2 text-xs focus:outline-none"
                        />
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        )}
      </section>
      </div>

      {/* ADDITIONAL FREE NOTES — 표준 제목 밴드 카드(DESIGN.md §6-3) */}
      <section className="branch-sheet-card" id="memo-section">
        <div className="branch-band">
          <h3 className="branch-band-title">
            {isHeadOffice ? "본사 특이사항 기록" : "특이사항 기록 (본부 보고 및 카톡보고 자동 연동)"}
          </h3>
        </div>
        <div className="p-4 space-y-4">

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

        <div className="space-y-1.5" data-guide="daily-other-memo">
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
      </section>

      {/* FINAL SUBMIT ACTION ROW */}
      <div className="flex gap-4 items-center justify-end pt-4">
        {/* 공용기기에서 남의 이름으로 제출되는 것을 막기 위해, 실제로 기록될 작성자를 항상 눈에 보이게 둔다(설계서 §7).
            작성자란을 직접 입력하게 된 뒤로는(2026-07-26) 입력칸 값이 곧 저장될 값이므로, 계정 이름이 아니라
            입력칸 값을 그대로 비춘다. 입력한 이름이 로그인 계정과 다를 때만 실제 계정을 함께 알려 준다. */}
        <div className="flex flex-col items-end leading-tight">
          <span className="text-sm font-bold text-zinc-700">작성자: {writer.trim() || "-"}</span>
          {isPersonalSession && personalDefaultWriter && writer.trim() !== personalDefaultWriter && (
            <span className="text-xs text-zinc-500">로그인 계정: {personalDefaultWriter}</span>
          )}
        </div>
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
