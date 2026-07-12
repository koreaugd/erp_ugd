// src/pages/branch/tabs/PartTimeLogTab.tsx
// 파트타이머일지 탭. BranchConfirmPage에서 분리 — 동작 변경 없음(코드 이동만).
import { useState, useEffect, useCallback } from "react";
import { ClipboardList, RefreshCw } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import LoadingSpinner from "../../../components/LoadingSpinner";
import { AdminRecordEditModal } from "./AdminRecordEditModal";
import { toLocalDateInputValue, toLocalMonthInputValue, toNumberPromptValue } from "../helpers/formatters";
import { updateDailyMetadata } from "../helpers/dailyOps";

export function PartTimeLogTab({ branchName, isAdmin = false }: { branchName: string; isAdmin?: boolean }) {
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
                  {isAdmin && <th className="py-2 px-2 text-center">관리</th>}
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
                  records.map((r, idx) => {
                    // 같은 날짜가 이어지면 날짜를 한 번만 적고, 날짜가 바뀌는 자리에만 굵은 선을 긋는다.
                    // 날짜가 매 행 반복되면 눈이 그걸 다 읽느라 정작 사람·시간을 못 훑는다.
                    const newDate = idx === 0 || records[idx - 1].settleDate !== r.settleDate;
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
                        {isAdmin && (
                          <td className="py-2 px-2">
                            <div className="flex justify-center gap-1">
                              <button onClick={() => void handleEditPartTimeRow(r)} className="px-2 py-0.5 rounded-lg border border-blue-100 bg-blue-50 text-blue-700 text-[10px] font-black">수정</button>
                              <button onClick={() => void handleDeletePartTimeRow(r)} className="px-2 py-0.5 rounded-lg border border-rose-100 bg-rose-50 text-rose-700 text-[10px] font-black">삭제</button>
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
