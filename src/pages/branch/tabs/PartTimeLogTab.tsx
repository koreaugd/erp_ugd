// src/pages/branch/tabs/PartTimeLogTab.tsx
// 파트타이머일지 탭. BranchConfirmPage에서 분리 — 동작 변경 없음(코드 이동만).
import { useState, useEffect, useMemo, useCallback } from "react";
import { ClipboardList, RefreshCw, Search, X } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import LoadingSpinner from "../../../components/LoadingSpinner";
import { AdminRecordEditModal } from "./AdminRecordEditModal";
import { toLocalDateInputValue, toLocalMonthInputValue, toNumberPromptValue } from "../helpers/formatters";
import { updateDailyMetadata } from "../helpers/dailyOps";

/** 00:00부터 30분 간격. 출퇴근은 대개 정시·30분이라 직접 치는 것보다 고르는 편이 빠르고 오타가 없다. */
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) =>
  `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * 파트타이머 행 식별.
 *
 * 같은 사람이 하루에 두 번 일하거나(오픈·마감) 동명이인이 있으면 이름만으로는 행을 가릴 수 없다.
 * 이름만 보고 고치면 옆 근무기록까지 같이 바뀐다 — 그 사람 급여가 통째로 틀어진다.
 * segmentId(둘 다 있으면) → 출퇴근 시각(둘 다 있으면) → 이름 순으로 좁힌다.
 * 식별 정보가 없는 구형 데이터는 예전처럼 이름으로만 찾는다(그 시절엔 한 사람당 한 줄이었다).
 *
 * 초과근무일지의 isSameOvertimeRow와 같은 규칙이다.
 */
function isSamePartTimeRow(staff: any, row: any): boolean {
  const name = staff.staffName || staff.name;
  if (name !== row.staffName) return false;
  if (row.segmentId && staff.segmentId) return String(staff.segmentId) === String(row.segmentId);
  if (row.clockIn && staff.clockIn && row.clockOut && staff.clockOut) {
    return staff.clockIn === row.clockIn && staff.clockOut === row.clockOut;
  }
  return true;
}

/**
 * 고칠(지울) 행 하나의 자리.
 *
 * 끝까지 가려지지 않는 경우가 있다 — segmentId가 없던 시절 데이터에 **동명이인이 같은 시각에 일한 날**이면
 * 두 행이 똑같아 보인다. 그때 조건에 맞는 행을 전부 건드리면 한 건을 고치려다 두 사람 급여가 함께 틀어진다.
 * 구분할 수 없을 때는 **한 행만** 건드린다. 두 행이 어차피 똑같으므로 결과는 같고, 피해 범위는 하나로 묶인다.
 */
const findPartTimeRowIndex = (staffRows: any[], row: any) =>
  staffRows.findIndex((staff) => isSamePartTimeRow(staff, row));

/**
 * 출근~퇴근 사이의 시간. 자정을 넘기면 하루를 더한다(야간 근무).
 * 시각을 못 읽으면 null — 그때는 원래 값을 그대로 둔다(멋대로 0으로 만들지 않는다).
 */
const computeWorkHours = (clockIn: string, clockOut: string): number | null => {
  const inMatch = clockIn.trim().match(TIME_PATTERN);
  const outMatch = clockOut.trim().match(TIME_PATTERN);
  if (!inMatch || !outMatch) return null;
  const start = Number(inMatch[1]) + Number(inMatch[2]) / 60;
  const end = Number(outMatch[1]) + Number(outMatch[2]) / 60;
  const hours = end - start + (end < start ? 24 : 0);
  return Number(hours.toFixed(1));
};

/**
 * 드롭다운에 보여줄 시각 목록.
 *
 * 이미 적혀 있는 값이 30분 단위가 아니면(예: 18:20) 목록에 넣어 준다.
 * 안 넣으면 그 값이 목록에 없어 빈 칸으로 보이고, 저장하는 순간 엉뚱한 시각으로 바뀐다 —
 * 고치려던 적도 없는 값이 말없이 달라진다.
 */
const timeOptionsWith = (current: string) => {
  const value = String(current || "").trim();
  // 값이 비어 있으면 "고르지 않음"(빈 항목)을 앞에 둔다.
  // 빈 항목이 없으면 select가 첫 항목(00:00)을 보여주는데 실제 값은 여전히 비어 있다 —
  // 화면은 00:00이라 하고 저장되는 값은 빈 값이라, 본 것과 다른 게 저장된다.
  if (!value) return ["", ...TIME_OPTIONS];
  if (TIME_OPTIONS.includes(value)) return TIME_OPTIONS;
  return [value, ...TIME_OPTIONS];
};

/**
 * 성명 드롭다운 목록. 지금 적힌 이름이 명부에 없으면 맨 앞에 넣는다.
 *
 * 퇴사해서 명부에서 빠졌거나, 명부를 못 읽었거나(오프라인), 구형 기록이라 이름이 다를 수 있다.
 * 그때 목록에 없으면 빈 칸으로 보이고, 저장하는 순간 엉뚱한 사람으로 바뀐다.
 */
const namesWith = (names: string[], current: string) => {
  const value = String(current || "").trim();
  // 시각 드롭다운과 같은 이유 — 비어 있으면 빈 항목을 두어 "아직 안 골랐다"를 그대로 보여준다.
  if (!value) return ["", ...names];
  return names.includes(value) ? names : [value, ...names];
};

export function PartTimeLogTab({ branchName, isAdmin = false }: { branchName: string; isAdmin?: boolean }) {
  const [loading, setLoading] = useState(true);
  // 저장이 도는 중임을 알리는 작은 배지. 화면은 이미 바뀌어 있으므로 표를 막지 않는다.
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState<any[]>([]);
  /** 직원현황에 등록된 파트타이머 이름. 수정창 성명 드롭다운의 목록이 된다. */
  const [rosterPartTimerNames, setRosterPartTimerNames] = useState<string[]>([]);
  const [summaryList, setSummaryList] = useState<any[]>([]);
  const [nameFilter, setNameFilter] = useState("");
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

  // opts.silent: 표 전체를 스피너로 덮지 않고 조용히 다시 읽는다.
  // 수정·삭제 직후에 쓴다 — 화면에는 이미 결과가 반영돼 있으므로, 여기서 스피너를 띄우면
  // 다 끝난 일을 두고 한참 기다리는 것처럼 보인다(초과근무일지와 같은 규칙).
  const loadData = useCallback(async (forceRefresh = false, opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setLoading(true);
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
      return true;
    } catch (e) {
      console.error("Part timer database read error:", e);
      // 못 읽었다는 사실을 부르는 쪽에 알린다. 조용히 삼키면, 저장에 실패한 뒤 서버에서 다시 읽어
      // 화면을 맞추려던 쪽이 "맞춘 줄" 알고 넘어간다 — 저장 안 된 상태가 화면에 그대로 남는다.
      return false;
    } finally {
      setLoading(false);
    }
  }, [branchName, selectedMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 직원현황(파트타이머) 이름. 수정창에서 직접 타이핑하는 대신 여기서 고르게 한다 —
  // 급여대장 누적시간이 이름으로 매칭되므로 오타 하나에 그 사람 집계가 통째로 어긋난다.
  // 어느 노트북에서든 같은 목록이어야 하므로 클라우드 명부(getBranchOwnRoster)를 쓴다.
  useEffect(() => {
    let cancelled = false;
    void gasClient.getBranchOwnRoster(branchName)
      .then((roster) => {
        if (cancelled) return;
        setRosterPartTimerNames(
          Array.from(new Set((roster || [])
            .filter((employee: any) => employee?.division === "파트타이머")
            .map((employee: any) => String(employee?.name || "").trim())
            .filter(Boolean)))
        );
      })
      .catch((e) => {
        // 명부를 못 읽어도 수정 자체는 막지 않는다 — 지금 적힌 이름은 목록에 남으므로 그대로 저장할 수 있다.
        console.warn("직원현황 파트타이머 명단을 불러오지 못했습니다.", e);
      });
    return () => { cancelled = true; };
  }, [branchName]);

  const normalizedNameFilter = nameFilter.trim().toLowerCase();
  const filteredRecords = useMemo(() => {
    if (!normalizedNameFilter) return records;
    return records.filter((record) => String(record.staffName || "").toLowerCase().includes(normalizedNameFilter));
  }, [normalizedNameFilter, records]);
  const filteredSummaryList = useMemo(() => {
    if (!normalizedNameFilter) return summaryList;
    return summaryList.filter((item) => String(item.name || "").toLowerCase().includes(normalizedNameFilter));
  }, [normalizedNameFilter, summaryList]);

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

    // 수기 등록·삭제는 같은 문서(manual_parttime:<지점>)의 목록 전체를 덮어쓴다.
    // 그래서 둘이 동시에 날아가면 늦게 끝난 쪽이 상대의 결과를 지운다 —
    // 방금 등록한 기록이 사라지거나, 지운 기록이 되살아난다. saving으로 한 번에 하나씩만 보낸다.
    setSaving(true);
    try {
      const previous = (await gasClient.getSharedData<any[]>(key)) || [];
      await gasClient.saveSharedData(key, [newRecord, ...previous]);
      setManualName("");
      setManualHours("9");
      setManualClockIn("09:00");
      setManualClockOut("18:00");
      setManualClockInError("");
      setManualClockOutError("");
      setManualReason("");
      // 등록은 이미 클라우드에 들어갔다. 목록을 다시 못 읽었다고 "실패"라고 하면 안 된다 —
      // 그 말을 믿고 다시 등록하면 같은 기록이 두 번 들어간다. 저장됐다는 사실을 분명히 알린다.
      const reloaded = await loadData(true, { silent: true });
      if (!reloaded) {
        alert("등록은 저장되었습니다. 다만 목록을 새로 읽지 못해 화면에 아직 안 보입니다.\n인터넷 연결을 확인한 뒤 새로고침해 주세요.\n\n다시 등록하면 같은 기록이 두 번 들어갑니다.");
      }
    } catch (e) {
      console.error("수기 파트타이머 등록 실패:", e);
      // 실패했으면 입력값을 그대로 둔다 — 지우면 다시 처음부터 쳐야 한다.
      alert("등록에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.\n\n입력하신 내용은 그대로 두었습니다.");
    } finally {
      setSaving(false);
    }
  };

  // 수정이력에 남길 소속. 지점이 고친 것을 "관리자"로 남기면 이력이 거짓이 된다.
  // 실제 사람 이름은 수정창에서 받아 이 앞에 붙인다(누가 고쳤는지가 남아야 추적이 된다).
  const editorScope = isAdmin ? "관리자" : branchName;
  /** 삭제는 수정창이 없어 이름을 물을 곳이 없다 — 소속만 남긴다. */
  const editActor = editorScope;
  /** 지난번에 적은 수정자 이름. 같은 사람이 여러 건을 고칠 때 매번 다시 치지 않게 한다. */
  const editorNameKey = `erp_last_editor_${branchName}`;

  const handleEditPartTimeRow = (row: any) => {
    if (row.manual) {
      alert("수기로 작성된 파트타이머 근무 기록은 삭제 후 재등록해 주시기 바랍니다.");
      return;
    }
    if (!row.recordId) return;
    setEditPartTime({
      row,
      fields: {
        staffName: String(row.staffName || ""),
        editorName: localStorage.getItem(editorNameKey) || "",
        clockIn: String(row.clockIn || ""),
        clockOut: String(row.clockOut || ""),
        workHours: toNumberPromptValue(row.workHours)
      }
    });
  };

  /**
   * 수정창의 값이 바뀔 때. 출·퇴근을 고르면 실근무시간을 그 자리에서 다시 계산한다.
   * 시각을 못 읽으면(옛 데이터의 이상한 값 등) 계산하지 않고 원래 시간을 남긴다.
   */
  const changeEditPartTimeField = (key: string, value: string) => {
    setEditPartTime((current) => {
      if (!current) return current;
      const fields = { ...current.fields, [key]: value };
      if (key === "clockIn" || key === "clockOut") {
        const hours = computeWorkHours(fields.clockIn, fields.clockOut);
        if (hours !== null) fields.workHours = String(hours);
      }
      return { ...current, fields };
    });
  };

  const saveEditPartTimeRow = async () => {
    if (!editPartTime) return;
    const { row, fields } = editPartTime;
    const staffName = fields.staffName.trim();
    const editorName = fields.editorName.trim();
    const clockIn = fields.clockIn.trim();
    const clockOut = fields.clockOut.trim();
    const workHours = Number(fields.workHours);
    if (!staffName) {
      alert("성명을 입력해 주세요.");
      return;
    }
    // 누가 고쳤는지 모르면 수정이력이 무의미해진다. 돈이 걸린 기록이라 반드시 받는다.
    if (!editorName) {
      alert("수정자 이름을 입력해 주세요.\n근무기록은 급여로 이어지므로 누가 고쳤는지 남겨야 합니다.");
      return;
    }
    // 시각이 비어 있으면 실근무시간이 계산되지 않아 옛 값이 그대로 남는다 —
    // 그대로 저장하면 시각은 비었는데 시간만 남는 앞뒤 안 맞는 기록이 된다.
    if (!clockIn || !clockOut) {
      alert("출근·퇴근 시간을 골라 주세요.");
      return;
    }
    if (!Number.isFinite(workHours) || workHours <= 0) {
      alert("출근·퇴근 시간을 확인해 주세요. 실근무시간이 0보다 커야 합니다.");
      return;
    }
    localStorage.setItem(editorNameKey, editorName);
    const actor = `${editorName} (${editorScope})`;

    // 낙관적 반영: 모달을 즉시 닫고 표의 값을 바로 갱신 → 저장이 끝날 때까지 기다리지 않아도 화면이 반응한다.
    // 저장도 재조회도 실패하면 이 스냅샷으로 되돌린다(아래 catch 참고).
    const snapshot = records;
    setEditPartTime(null);
    setRecords((prev) => prev.map((item) => item === row
      ? { ...item, staffName, clockIn, clockOut, workHours }
      : item));
    setSaving(true);
    try {
      await updateDailyMetadata(row.recordId, (metadata, detail) => {
        const staffRows = Array.isArray(metadata.staffRows) ? metadata.staffRows : [];
        // 이름은 **고치기 전 이름(row.staffName)** 으로 찾는다. 새 이름으로 찾으면 아무것도 못 찾는다.
        // 이름 칸은 저장할 때 name·staffName 중 원래 있던 것만 바꾼다 — 없던 칸을 새로 만들면
        // 이 기록을 읽는 다른 화면(급여대장 등)이 기대하는 모양이 달라진다.
        const renamed = (staff: any) => ({
          ...staff,
          ...(staff.name !== undefined ? { name: staffName } : {}),
          ...(staff.staffName !== undefined ? { staffName } : {})
        });
        // 메타데이터가 없는 구형 기록은 요약 배열(detail.staff)만으로 화면에 뜬다(gasClient가 그렇게 보완한다).
        // 그런 기록은 staffRows에서 찾을 수 없으니, 예전처럼 요약 배열을 이름으로 고친다.
        // 이 분기가 없으면 구형 행은 수정 버튼이 보이는데 누를 때마다 "찾지 못했습니다"만 뜬다.
        if (staffRows.length === 0) {
          const legacyIndex = (detail.staff || []).findIndex((staff: any) => (staff.staffName || staff.name) === row.staffName);
          // 신형 경로와 같은 규칙 — 못 찾으면 조용히 넘어가지 않는다.
          // 그냥 두면 아무것도 안 바뀐 채 "수정됨"으로 보인다.
          if (legacyIndex < 0) throw new Error("고치려는 근무기록을 찾지 못했습니다. 다른 기기에서 이미 바뀐 것 같습니다.");
          const nextStaff = (detail.staff || []).map((staff: any, index: number) =>
            index === legacyIndex ? { ...renamed(staff), workHours } : staff);
          return { metadata, staff: nextStaff };
        }
        const targetIndex = findPartTimeRowIndex(staffRows, row);
        // 못 찾으면 조용히 지나가면 안 된다 — 아무것도 안 바뀐 채 "수정됨"으로 보인다.
        // (그 사이 다른 기기에서 이 기록이 바뀌었을 때 일어난다.)
        if (targetIndex < 0) throw new Error("고치려는 근무기록을 찾지 못했습니다. 다른 기기에서 이미 바뀐 것 같습니다.");
        const nextRows = staffRows.map((staff: any, index: number) =>
          index === targetIndex ? { ...renamed(staff), clockIn, clockOut, workHours } : staff);
        // 요약 배열(detail.staff)에는 segmentId도 출퇴근 시각도 없다(StaffRecord = 이름·시간·구분뿐).
        // 그래서 같은 사람의 두 근무를 여기서는 구분할 방법이 아예 없다.
        // 세그먼트가 있는 데이터면 손대지 않는다 — 이름으로 고치면 옆 근무까지 함께 바뀐다.
        // (삭제도 같은 이유로 같은 규칙을 쓴다. 읽는 쪽은 metadata.staffRows를 먼저 보므로 이 배열이 뒤처져도 무해하다.)
        const nextStaff = row.segmentId
          ? (detail.staff || [])
          : (detail.staff || []).map((staff: any) =>
            (staff.staffName || staff.name) === row.staffName ? { ...renamed(staff), workHours } : staff);
        return { metadata: { ...metadata, staffRows: nextRows }, staff: nextStaff };
      }, actor);
      // 저장은 끝났는데 다시 읽지 못하면, 표는 낙관적으로 고쳐져 있지만 오른쪽 집계는 옛 값 그대로다.
      // 조용히 두면 맞는 집계인 줄 안다.
      const reloaded = await loadData(true, { silent: true });
      if (!reloaded) {
        alert("수정은 저장되었습니다. 다만 목록을 새로 읽지 못해 오른쪽 집계가 최신이 아닐 수 있습니다.\n인터넷 연결을 확인한 뒤 새로고침해 주세요.");
      }
    } catch (e) {
      console.error("파트타이머 근무기록 수정 실패:", e);
      // 서버에서 다시 읽어 화면을 진짜 값으로 맞춘다. 그것마저 실패하면(인터넷 끊김 등)
      // 맞출 근거가 없으므로 고치기 전 화면으로 되돌린다 —
      // 저장되지도 않은 수정이 화면에만 남으면 고쳐진 줄 알고 넘어간다.
      const reloaded = await loadData(true, { silent: true });
      if (!reloaded) setRecords(snapshot);
      // 무엇이 잘못됐는지 아는 경우엔 그대로 알린다("오류가 발생했습니다"만으로는 뭘 해야 할지 알 수 없다).
      alert(`${(e as Error)?.message || "수정 중 오류가 발생했습니다."}\n\n수정되지 않았습니다. 화면을 원래대로 되돌렸습니다.`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePartTimeRow = async (row: any) => {
    if (row.manual) {
      if (!window.confirm(`${row.staffName}님의 ${row.settleDate} 수기 파트타이머 근무기록을 삭제할까요?`)) return;
    } else {
      if (!row.recordId || !window.confirm(`${row.staffName}님의 ${row.settleDate} 파트타이머 근무기록을 삭제할까요?`)) return;
    }
    // 낙관적 반영: 저장을 기다리지 않고 화면에서 즉시 제거한다.
    // 실패하면 서버에서 다시 불러 정합성을 맞춘다(요청이 겹칠 때 잘못 롤백해 남의 수정을 되살리는
    // 사고를 막는다 — 초과근무일지와 같은 규칙). 다시 읽는 것마저 실패했을 때만 이 스냅샷으로 되돌린다.
    const snapshot = records;
    setRecords((prev) => prev.filter((item) => item !== row));
    setSaving(true);
    try {
      if (row.manual) {
        const key = `manual_parttime:${branchName}`;
        const previous = (await gasClient.getSharedData<any[]>(key)) || [];
        await gasClient.saveSharedData(key, previous.filter((item) => item.id !== row.id));
      } else {
        await updateDailyMetadata(row.recordId, (metadata, detail) => {
          const staffRows = Array.isArray(metadata.staffRows) ? metadata.staffRows : [];
          // 수정과 같은 이유 — 메타데이터가 없는 구형 기록은 요약 배열만으로 화면에 뜬다.
          if (staffRows.length === 0) {
            const legacyIndex = (detail.staff || []).findIndex((staff: any) => (staff.staffName || staff.name) === row.staffName);
            if (legacyIndex < 0) throw new Error("지우려는 근무기록을 찾지 못했습니다. 다른 기기에서 이미 바뀐 것 같습니다.");
            // 한 건만 지운다. 이름으로 전부 지우면 같은 이름의 다른 근무까지 사라진다.
            const nextStaff = (detail.staff || []).filter((_: any, index: number) => index !== legacyIndex);
            return { metadata, staff: nextStaff };
          }
          // 지울 행도 수정과 같은 규칙으로 찾고, 한 건만 지운다. 예전에는 segmentId가 없으면
          // 이름만 보고 지워서, 같은 사람이 하루에 두 번 일한 날엔 한 건만 지우려다 두 건이 다 사라졌다.
          const targetIndex = findPartTimeRowIndex(staffRows, row);
          if (targetIndex < 0) throw new Error("지우려는 근무기록을 찾지 못했습니다. 다른 기기에서 이미 바뀐 것 같습니다.");
          const nextRows = staffRows.filter((_: any, index: number) => index !== targetIndex);
          const nextStaff = row.segmentId ? (detail.staff || []) : (detail.staff || []).filter((staff: any) => (staff.staffName || staff.name) !== row.staffName);
          return { metadata: { ...metadata, staffRows: nextRows }, staff: nextStaff };
        }, editActor);
      }
      // 수정과 같은 이유 — 지워졌는데 다시 못 읽으면 오른쪽 집계가 옛 값으로 남는다.
      const reloaded = await loadData(true, { silent: true });
      if (!reloaded) {
        alert("삭제는 저장되었습니다. 다만 목록을 새로 읽지 못해 오른쪽 집계가 최신이 아닐 수 있습니다.\n인터넷 연결을 확인한 뒤 새로고침해 주세요.");
      }
    } catch (e) {
      console.error("파트타이머 근무기록 삭제 실패:", e);
      // 수정과 같은 규칙 — 서버로 맞추고, 그것마저 실패하면 지우기 전 화면으로 되돌린다.
      // 안 되돌리면 지워지지도 않은 기록이 화면에서만 사라져 지운 줄 알게 된다.
      const reloaded = await loadData(true, { silent: true });
      if (!reloaded) setRecords(snapshot);
      alert(`${(e as Error)?.message || "삭제 중 오류가 발생했습니다."}\n\n삭제되지 않았습니다. 화면을 원래대로 되돌렸습니다.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {editPartTime && (
        <AdminRecordEditModal
          title={`${editPartTime.row.settleDate} 파트타이머 근무 수정`}
          fields={[
            {
              key: "staffName",
              label: "성명",
              value: editPartTime.fields.staffName,
              // 직원현황의 파트타이머 중에서 고른다. 직접 치면 오타 하나로 급여대장 누적시간이 어긋난다.
              // 지금 적힌 이름이 명부에 없으면(퇴사자·구형 기록) 목록에 넣어 그대로 둘 수 있게 한다.
              options: namesWith(rosterPartTimerNames, editPartTime.fields.staffName),
              hint: "직원현황의 파트타이머 목록입니다."
            },
            { key: "editorName", label: "수정자", value: editPartTime.fields.editorName, hint: "수정이력에 남습니다." },
            {
              key: "clockIn",
              label: "출근시간",
              value: editPartTime.fields.clockIn,
              options: timeOptionsWith(editPartTime.fields.clockIn)
            },
            {
              key: "clockOut",
              label: "퇴근시간",
              value: editPartTime.fields.clockOut,
              options: timeOptionsWith(editPartTime.fields.clockOut)
            },
            {
              key: "workHours",
              label: "실근무시간 (자동)",
              value: editPartTime.fields.workHours,
              readOnly: true,
              hint: "출·퇴근 시간에서 자동 계산됩니다. 자정을 넘기면 다음 날로 칩니다."
            }
          ]}
          onChange={changeEditPartTimeField}
          onCancel={() => setEditPartTime(null)}
          onSave={() => void saveEditPartTimeRow()}
        />
      )}
      {/* List Table Left */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm lg:col-span-2 space-y-4">
        <div className="flex flex-col gap-3 border-b border-gray-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-black text-gray-800 flex items-center gap-1.5">
              <ClipboardList className="w-4 h-4 text-[#2E6DB4]" />
              파트타이머 근무 일지
              {saving && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">
                  <RefreshCw className="w-3 h-3 animate-spin" /> 저장 중…
                </span>
              )}
            </h3>
            <p className="text-[10px] text-gray-400 mt-0.5 font-bold">지점에 출근하여 실근무한 아르바이트 직원 출퇴근 로그입니다.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-40">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                placeholder="이름 검색"
                aria-label="파트타이머 직원명 검색"
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
            {/* 저장이 도는 동안은 달을 바꾸지 못하게 한다. 저장에 실패하면 "고치기 전 화면"으로 되돌리는데,
                그 사이 달이 바뀌어 있으면 지난달 목록을 이번 달 자리에 되돌려 놓게 된다. */}
            <input type="month" value={selectedMonth} disabled={saving} onChange={(e) => setSelectedMonth(e.target.value)} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-extrabold bg-white disabled:opacity-50 disabled:cursor-not-allowed" />
            <button
              onClick={() => void loadData(true)}
              disabled={saving}
              className="p-1 px-2.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-500 rounded-lg text-[10px] font-extrabold flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className="w-3 h-3" /> 새로고침
            </button>
          </div>
        </div>

        {/* Manual Part-Timer Registration Form */}
        {/* 저장이 도는 동안은 입력칸도 함께 잠근다.
            등록이 끝나면 성공 표시로 입력칸을 비우는데, 그 사이 다음 건을 치고 있었다면
            방금 친 내용이 그때 지워진다 — 사용자는 자기가 쓴 글이 왜 사라졌는지 알 수 없다. */}
        <div className="flex flex-wrap gap-2.5 rounded-xl bg-gray-50 p-3 border border-gray-100 items-center">
          <span className="w-full text-xs font-black text-gray-600">파트타이머 근무 수기 입력</span>
          <input value={manualName} disabled={saving} onChange={(e) => setManualName(e.target.value)} placeholder="직원명" className="w-24 px-2 py-1 border rounded text-xs bg-white focus:outline-none focus:border-[#2E6DB4] disabled:opacity-50 disabled:cursor-not-allowed" />
          <input type="date" value={manualDate} disabled={saving} onChange={(e) => setManualDate(e.target.value)} className="px-2 py-1 border rounded text-xs bg-white focus:outline-none focus:border-[#2E6DB4] disabled:opacity-50 disabled:cursor-not-allowed" />

          <div className="relative">
            <input
              value={manualClockIn}
              disabled={saving}
              onChange={(e) => handleClockInChange(e.target.value)}
              onBlur={() => handleClockBlur("in")}
              placeholder="출근 (09:00)"
              className={`w-20 px-2 py-1 border rounded text-xs bg-white font-mono focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
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
              disabled={saving}
              onChange={(e) => handleClockOutChange(e.target.value)}
              onBlur={() => handleClockBlur("out")}
              placeholder="퇴근 (18:00)"
              className={`w-20 px-2 py-1 border rounded text-xs bg-white font-mono focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
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

          <input value={manualReason} disabled={saving} onChange={(e) => setManualReason(e.target.value)} placeholder="수기 입력 사유 (필수)" className="grow min-w-36 px-2 py-1 border rounded text-xs bg-white focus:outline-none focus:border-[#2E6DB4] disabled:opacity-50 disabled:cursor-not-allowed" />
          {/* 등록도 수정·삭제와 같은 목록을 덮어쓴다 — 저장이 도는 동안은 함께 잠근다. */}
          <button disabled={saving} onClick={() => void saveManualPartTime()} className="px-3 py-1 bg-[#2E6DB4] hover:bg-[#20528B] text-white rounded text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">등록</button>
        </div>

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-2">
            <LoadingSpinner size="md" />
            <span className="text-xs text-gray-400 font-bold">마감 기록실에서 아르바이트 대장을 불러오는 중...</span>
          </div>
        ) : (
          // 한 달치 기록이 통째로 세로로 늘어나 헤더가 스크롤 위로 사라졌다. 표 안에서만 스크롤하고 헤더는 붙여 둔다.
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-left text-xs border-collapse font-medium animate-fade-in">
              <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgb(243_244_246)]">
                <tr className="text-gray-400 font-bold">
                  <th className="py-2 px-2">마감일자</th>
                  <th className="py-2 px-2">직원명</th>
                  {branchName === "본사" && <th className="py-2 px-2">근무지점</th>}
                  <th className="py-2 px-2">출근</th>
                  <th className="py-2 px-2">퇴근</th>
                  <th className="py-2 px-2 text-center">근무시간</th>
                  <th className="py-2 px-2">작성자 (결재)</th>
                  {/* 지점도 자기 지점 근무기록을 고치고 지울 수 있다. 잘못 올라간 기록을 고치려고
                      매번 본사에 연락해야 했다. 누가 고쳤는지는 수정이력에 남는다(editActor). */}
                  <th className="py-2 px-2 text-center">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRecords.length === 0 ? (
                  <tr>
                    {/* 기본 6열 + 관리 1열(이제 항상 보인다) + 본사면 근무지점 1열 */}
                    <td colSpan={7 + (branchName === "본사" ? 1 : 0)} className="py-16 text-center text-gray-400">
                      {normalizedNameFilter ? "검색된 파트타이머 근무 기록이 없습니다." : "해당 지점에 기록된 파트타이머 출근 기록이 없습니다."}
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((r, idx) => {
                    // 같은 날짜가 이어지면 날짜를 한 번만 적고, 날짜가 바뀌는 자리에만 굵은 선을 긋는다.
                    // 날짜가 매 행 반복되면 눈이 그걸 다 읽느라 정작 사람·시간을 못 훑는다.
                    const newDate = idx === 0 || filteredRecords[idx - 1].settleDate !== r.settleDate;
                    return (
                      <tr key={idx} className={`hover:bg-gray-50/50 ${newDate && idx > 0 ? "border-t-2 border-t-gray-200" : ""}`}>
                        <td className="py-2 px-2 font-mono text-[11px] text-gray-400">{newDate ? r.settleDate : ""}</td>
                        <td className="py-2 px-2 font-extrabold text-gray-800">{r.staffName}</td>
                        {branchName === "본사" && <td className="py-2 px-2 font-bold text-gray-600">{r.officeWorkplace || "본사"}</td>}
                        <td className="py-2 px-2 font-mono text-gray-650">{r.clockIn}</td>
                        <td className="py-2 px-2 font-mono text-gray-650">{r.clockOut}</td>
                        <td className="py-2 px-2 text-center">
                          <span className="bg-blue-50 text-[#2E6DB4] font-black font-mono text-xs px-2 py-0.5 rounded-lg">
                            {r.workHours} 시간
                          </span>
                        </td>
                        <td className="py-2 px-2 text-gray-400 font-bold">{r.writer}</td>
                        <td className="py-2 px-2">
                          <div className="flex justify-center gap-1">
                            <button disabled={saving} onClick={() => void handleEditPartTimeRow(r)} className="px-2 py-0.5 rounded-lg border border-blue-100 bg-blue-50 text-blue-700 text-[10px] font-black disabled:opacity-40 disabled:cursor-not-allowed">수정</button>
                            <button disabled={saving} onClick={() => void handleDeletePartTimeRow(r)} className="px-2 py-0.5 rounded-lg border border-rose-100 bg-rose-50 text-rose-700 text-[10px] font-black disabled:opacity-40 disabled:cursor-not-allowed">삭제</button>
                          </div>
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

      {/* Summary Aggregate Right */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm h-fit space-y-4">
        <div>
          <h3 className="text-sm font-black text-gray-800">파트타이머 보상 집계</h3>
          <p className="text-[10px] text-gray-400 mt-0.5 font-medium">아르바이트 인원들의 총 근무시간과 총 출근날수를 집계합니다.</p>
        </div>

        <div className="divide-y divide-gray-50 font-bold text-xs">
          {filteredSummaryList.length === 0 ? (
            <p className="py-8 text-center text-gray-400">
              {normalizedNameFilter ? "검색된 집계 대상자가 없습니다." : "집계 정보가 존재하지 않습니다."}
            </p>
          ) : (
            filteredSummaryList.map((item, idx) => (
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
