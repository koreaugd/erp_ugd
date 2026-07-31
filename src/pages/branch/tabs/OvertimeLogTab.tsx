// src/pages/branch/tabs/OvertimeLogTab.tsx
// 초과근무일지 탭. BranchConfirmPage에서 분리 — 동작 변경 없음(코드 이동만).
import { useState, useEffect, useMemo, useCallback } from "react";
import { RefreshCw, Search, X } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import LoadingSpinner from "../../../components/LoadingSpinner";
import { AdminRecordEditModal } from "./AdminRecordEditModal";
import { toLocalDateInputValue, toLocalMonthInputValue, toNumberPromptValue } from "../helpers/formatters";
import { updateDailyMetadata } from "../helpers/dailyOps";
import { useAuthContext } from "../../../contexts/AuthContext";

// 초과근무 행 식별: 동명이인·다중 근무 세그먼트에서 다른 행을 잘못 건드리지 않도록
// segmentId(둘 다 있으면) → 출퇴근 시각(둘 다 있으면) → 이름 순으로 매칭합니다.
// 식별 정보가 없는 구형 데이터는 기존과 동일하게 이름으로만 매칭합니다.
function isSameOvertimeRow(staff: any, row: any): boolean {
  const name = staff.staffName || staff.name;
  if (name !== row.staffName) return false;
  if (row.segmentId && staff.segmentId) return String(staff.segmentId) === String(row.segmentId);
  if (row.clockIn && staff.clockIn && row.clockOut && staff.clockOut) {
    return staff.clockIn === row.clockIn && staff.clockOut === row.clockOut;
  }
  return true;
}

export function OvertimeLogTab({ branchName, isAdmin = false }: { branchName: string; isAdmin?: boolean }) {
  const { user } = useAuthContext();
  // 개인 로그인 계정이면 이력에 실제 이름을 남긴다. PIN 세션은 예전과 같은 소속 표기를 유지한다.
  const actor = {
    name: isAdmin
      ? (user?.loginType === "personal" ? user.name : "관리자")
      : (user?.loginType === "personal" ? user.name : branchName),
    uid: user?.uid
  };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState<any[]>([]);
  const [summaryList, setSummaryList] = useState<any[]>([]);
  const [manualName, setManualName] = useState("");
  const [manualHours, setManualHours] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [manualDate, setManualDate] = useState(toLocalDateInputValue());
  const [selectedMonth, setSelectedMonth] = useState(() => toLocalMonthInputValue());
  const [nameFilter, setNameFilter] = useState("");
  const [editOvertime, setEditOvertime] = useState<{ row: any; fields: Record<string, string> } | null>(null);

  const loadData = useCallback(async (forceRefresh = false, opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setLoading(true);
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
    // 총합계가 0인 인원(초과·조기퇴근이 서로 상쇄된 경우 포함)은 집계에서 볼 필요가 없어 검색어와 무관하게 항상 제외합니다.
    const nonZero = summaryList.filter((item) => Number(item.totalOvertime || 0) !== 0);
    if (!normalizedNameFilter) return nonZero;
    return nonZero.filter((item) => String(item.name || "").toLowerCase().includes(normalizedNameFilter));
  }, [normalizedNameFilter, summaryList]);

  const saveManualOvertime = async () => {
    if (!manualName.trim() || !manualHours.trim() || !manualReason.trim()) {
      alert("직원명, 시간, 수기 입력 사유를 모두 채워주세요.");
      return;
    }
    // **음수도 받는다**(사용자 지시 2026-07-31). 잘못 올라간 초과근무를 되돌릴 방법이 이것뿐이다 —
    // 이미 제출된 일일마감의 초과시간은 여기서 고칠 수 없으므로, 같은 크기의 음수를 적어
    // 합계를 0으로 만든다(집계는 총합이 0인 인원을 아예 빼고 보여준다).
    if (!/^-?\d+(\.\d+)?$/.test(manualHours)) {
      alert("시간은 숫자 형식으로만 입력해 주세요. (예: 2시간 30분 ➔ 2.5 / 되돌리기 ➔ -2.5)");
      return;
    }
    const hours = Number(manualHours);
    if (hours === 0) {
      alert("0시간은 적을 수 없습니다. 되돌리려면 되돌릴 만큼 음수로 적어주세요. (예: -2.5)");
      return;
    }
    // 오타 확인은 부호와 무관하게 '크기'로 본다 — -25 도 -2.5 의 오타일 수 있다.
    if (Math.abs(hours) >= 5) {
      const ok = window.confirm(
        `초과 근무 시간이 5시간 이상(${hours}시간)으로 기재되었습니다. 오타(예: 25 등)가 아닌 것이 확실한가요?\n정말 등록하시겠습니까?`
      );
      if (!ok) return;
    }
    if (hours < 0) {
      const ok = window.confirm(
        `${manualName.trim()} 님의 초과근무를 ${hours}시간(차감)으로 적습니다.\n\n` +
        `잘못 올라간 초과근무를 되돌릴 때 쓰는 방법입니다. 기존 기록은 지워지지 않고, 이 차감이 더해져 합계가 줄어듭니다.\n` +
        `계속할까요?`
      );
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
    const reason = fields.reason.trim();
    if (!reason) {
      alert("초과근무 시간이 0이 아니면 사유가 필요합니다.");
      return;
    }
    // 낙관적 반영: 모달을 즉시 닫고 표의 값을 바로 갱신 → 저장 완료까지 기다리지 않아도 화면이 반응합니다.
    setEditOvertime(null);
    setRecords((prev) => prev.map((item) => item === row ? { ...item, overtime: hours, overtimeReason: reason } : item));
    setSaving(true);
    try {
      if (row.manual) {
        const key = `manual_overtime:${branchName}`;
        const saved = (await gasClient.getSharedData<any[]>(key)) || [];
        await gasClient.saveSharedData(key, saved.map((item) => item.id === row.id ? { ...item, overtime: hours, reason } : item));
      } else if (row.recordId) {
        await updateDailyMetadata(row.recordId, (metadata, detail) => {
          const staffRows = Array.isArray(metadata.staffRows) ? metadata.staffRows : [];
          // overtimeCleared: null → 이전에 삭제(숨김)된 기록이라도 수정하면 다시 정상 노출되도록 마커를 해제합니다.
          const nextRows = staffRows.map((staff: any) =>
            isSameOvertimeRow(staff, row) ? { ...staff, overtime: hours, overtimeReason: reason, overtimeCleared: null } : staff);
          const nextStaff = (detail.staff || []).map((staff: any) =>
            isSameOvertimeRow(staff, row) ? { ...staff, overtimeHours: hours, memo: reason, overtimeCleared: null } : staff);
          return { metadata: { ...metadata, staffRows: nextRows }, staff: nextStaff };
        }, actor);
      }
      await loadData(true, { silent: true });
    } catch (e) {
      console.error("초과근무 수정 실패:", e);
      alert("수정 중 오류가 발생했습니다. 새로고침 후 다시 시도해 주세요.");
      await loadData(true, { silent: true });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteOvertimeRow = async (row: any) => {
    if (!window.confirm(`${row.staffName}님의 ${row.settleDate} 초과근무 기록을 삭제할까요?`)) return;
    // 낙관적 반영: 저장을 기다리지 않고 화면에서 즉시 제거 → 반응 속도 개선.
    // 실패 시엔 로컬 스냅샷을 되돌리지 않고 서버에서 다시 불러와 정합성을 맞춥니다(요청 겹침 롤백 사고 방지).
    setRecords((prev) => prev.filter((item) => item !== row));
    setSaving(true);
    try {
      if (row.manual) {
        const key = `manual_overtime:${branchName}`;
        const saved = (await gasClient.getSharedData<any[]>(key)) || [];
        await gasClient.saveSharedData(key, saved.filter((item) => item.id !== row.id));
      } else if (row.recordId) {
        // 조기퇴근/초과시간은 출퇴근 시각에서 다시 계산되므로 0으로 덮는 것만으로는 되살아납니다.
        // 삭제 당시 값을 overtimeCleared에 남기고 사유를 비워, 같은 값이 재계산되고 사유가 없으면 계속 숨기도록 표시합니다.
        const clearedValue = Number(row.overtime) || 0;
        await updateDailyMetadata(row.recordId, (metadata, detail) => {
          const staffRows = Array.isArray(metadata.staffRows) ? metadata.staffRows : [];
          const nextRows = staffRows.map((staff: any) =>
            isSameOvertimeRow(staff, row) ? { ...staff, overtime: 0, overtimeReason: "", overtimeCleared: clearedValue } : staff);
          const nextStaff = (detail.staff || []).map((staff: any) =>
            isSameOvertimeRow(staff, row) ? { ...staff, overtimeHours: 0, memo: "", overtimeCleared: clearedValue } : staff);
          return { metadata: { ...metadata, staffRows: nextRows }, staff: nextStaff };
        }, actor);
      }
      await loadData(true, { silent: true });
    } catch (e) {
      console.error("초과근무 삭제 실패:", e);
      alert("삭제 중 오류가 발생했습니다. 목록을 다시 불러옵니다.");
      await loadData(true, { silent: true });
    } finally {
      setSaving(false);
    }
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
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-black text-gray-800 w-fit">초과 근무 내역</h3>
              {saving && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">
                  <RefreshCw className="w-3 h-3 animate-spin" /> 저장 중…
                </span>
              )}
            </div>
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
            <input value={manualHours} onChange={(e) => setManualHours(e.target.value)} placeholder="시간" className="w-16 px-2 py-1 border rounded text-xs" title="되돌리려면 음수로 적습니다 (예: -2.5)" />
            {manualHours.length > 0 && !/^-?\d+(\.\d+)?$/.test(manualHours) && (
              <div className="absolute z-10 bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-black p-2 rounded-xl shadow-md -bottom-12 left-0 whitespace-nowrap animate-bounce">
                숫자만 기입해 주세요! (예: 2시간 30분 ➔ 2.5 / 되돌리기 ➔ -2.5)
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
          // 한 달치가 통째로 늘어나 헤더가 스크롤 위로 사라졌다. 표 안에서만 스크롤하고 헤더는 붙여 둔다.
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgb(243_244_246)]">
                <tr className="text-gray-400 font-bold">
                  <th className="py-2 px-2">마감일자</th>
                  <th className="py-2 px-2">직원명</th>
                  <th className="py-2 px-2">출근</th>
                  <th className="py-2 px-2">퇴근</th>
                  <th className="py-2 px-2 text-center">근무시간</th>
                  <th className="py-2 px-2 text-center">기준근무</th>
                  <th className="py-2 px-2 text-center">초과시간</th>
                  <th className="py-2 px-2 max-w-[150px]">초과사유 및 경위</th>
                  {isAdmin && <th className="py-2 px-2 text-center">관리</th>}
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
                  filteredRecords.map((r, idx) => {
                    // 같은 날짜가 이어지면 날짜는 한 번만 적고, 날짜가 바뀌는 자리에만 굵은 선을 긋는다.
                    const newDate = idx === 0 || filteredRecords[idx - 1].settleDate !== r.settleDate;
                    return (
                    <tr key={idx} className={`hover:bg-gray-50/50 ${newDate && idx > 0 ? "border-t-2 border-t-gray-200" : ""}`}>
                      <td className="py-2 px-2 font-mono text-[11px] text-gray-400">{newDate ? r.settleDate : ""}</td>
                      <td className="py-2 px-2 font-extrabold text-gray-800">{r.staffName}</td>
                      <td className="py-2 px-2 font-mono text-gray-500">{r.clockIn}</td>
                      <td className="py-2 px-2 font-mono text-gray-500">{r.clockOut}</td>
                      <td className="py-2 px-2 text-center font-bold text-gray-600">{r.workHours}h</td>
                      <td className="py-2 px-2 text-center text-gray-400">{r.standardHours}h</td>
                      <td className="py-2 px-2 text-center">
                        {/* 음수라도 **수기로 적은 것은 조기퇴근이 아니라 차감**이다(2026-07-31).
                            잘못 올라간 초과근무를 되돌리려고 적은 값인데 '조기퇴근'이라고 하면
                            그날 실제로 일찍 퇴근한 것으로 읽혀 근태를 오해하게 된다.
                            출퇴근 시각에서 계산된 음수만 조기퇴근이다. */}
                        {r.overtime < 0 ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-black bg-amber-50 text-amber-700 font-bold">
                            {r.overtime}h {r.manual ? "(차감)" : "(조기퇴근)"}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-black bg-emerald-50 text-emerald-800 font-bold">
                            +{r.overtime}h
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2 max-w-[150px] truncate scrollbar-none font-bold text-gray-500" title={r.overtimeReason}>
                        {r.overtimeReason}
                      </td>
                      {isAdmin && (
                        <td className="py-2 px-2">
                          <div className="flex justify-center gap-1">
                            <button disabled={saving} onClick={() => void handleEditOvertimeRow(r)} className="px-2 py-0.5 rounded-lg border border-blue-100 bg-blue-50 text-blue-700 text-[10px] font-black disabled:opacity-40 disabled:cursor-not-allowed">수정</button>
                            <button disabled={saving} onClick={() => void handleDeleteOvertimeRow(r)} className="px-2 py-0.5 rounded-lg border border-rose-100 bg-rose-50 text-rose-700 text-[10px] font-black disabled:opacity-40 disabled:cursor-not-allowed">삭제</button>
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
                      {/* '자동/차감'이라고 적으면 수기 차감과 자동 조기퇴근이 한 말에 섞인다 —
                          수기 쪽에도 차감(음수)이 들어오게 됐으므로 출처로만 가른다(Codex 2026-07-31). */}
                      {`수기 ${item.manualOvertime || 0}h · 자동 ${item.autoOvertime || 0}h`}
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
