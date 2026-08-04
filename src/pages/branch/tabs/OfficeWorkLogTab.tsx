// src/pages/branch/tabs/OfficeWorkLogTab.tsx  (BranchConfirmPage에서 분리 — 동작 변경 없음)
import { useState, useEffect, useMemo, useCallback } from "react";
import { gasClient } from "../../../api/gasClient";
import LoadingSpinner from "../../../components/LoadingSpinner";
import { toLocalMonthInputValue } from "../helpers/formatters";

export function OfficeWorkLogTab({ branchName }: { branchName: string }) {
  const [month, setMonth] = useState(() => toLocalMonthInputValue());
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  const compactTimeRange = (clockIn: string, clockOut: string) => {
    const compact = (value: string) => {
      const text = String(value || "").trim();
      if (!text || text === "00:00") return "";
      return text.endsWith(":00") ? text.slice(0, 2).replace(/^0/, "") : text.replace(/^0/, "");
    };
    const start = compact(clockIn);
    const end = compact(clockOut);
    return start && end ? `${start}-${end}` : "";
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const history = await gasClient.getBranchHistory(branchName, month);
      const nextRows: any[] = [];
      history.forEach((record: any) => {
        const metadataText = String(record.memo || "").split("\n---\nMETADATA:")[1];
        if (!metadataText) return;
        try {
          const metadata = JSON.parse(metadataText.trim());
          const sourceStaff = Array.isArray(metadata.staffRows) ? metadata.staffRows : [];
          const calculatedOvertimeByIndex = new Map<number, number>();
          const staffGroups = new Map<string, number[]>();
          sourceStaff.forEach((staff: any, staffIndex: number) => {
            const staffKey = staff.residentNumber || staff.name || `row-${staffIndex}`;
            staffGroups.set(staffKey, [...(staffGroups.get(staffKey) || []), staffIndex]);
          });
          staffGroups.forEach((indexes) => {
            const activeIndexes = indexes.filter((staffIndex) => sourceStaff[staffIndex]?.officeWorkType !== "휴무" && Number(sourceStaff[staffIndex]?.workHours || 0) > 0);
            if (activeIndexes.length === 0) return;
            const standardHours = activeIndexes.reduce((value, staffIndex) => value || Number(sourceStaff[staffIndex]?.standardHours || 0), 0) || 10;
            const totalWorkHours = activeIndexes.reduce((sum, staffIndex) => sum + Number(sourceStaff[staffIndex]?.workHours || 0), 0);
            const totalDelta = Number((totalWorkHours - standardHours).toFixed(1));
            if (totalDelta <= 0) {
              calculatedOvertimeByIndex.set(activeIndexes[activeIndexes.length - 1], totalDelta);
              return;
            }
            let cumulativeHours = 0;
            let allocatedOvertime = 0;
            activeIndexes.forEach((staffIndex) => {
              cumulativeHours += Number(sourceStaff[staffIndex]?.workHours || 0);
              const totalOvertime = Math.max(0, cumulativeHours - standardHours);
              const rowOvertime = Number((totalOvertime - allocatedOvertime).toFixed(1));
              allocatedOvertime = totalOvertime;
              calculatedOvertimeByIndex.set(staffIndex, rowOvertime);
            });
          });
          sourceStaff.forEach((staff: any, staffIndex: number) => {
            const storedOvertime = Number(staff.overtime || 0);
            const effectiveOvertime = storedOvertime !== 0 ? storedOvertime : (calculatedOvertimeByIndex.get(staffIndex) || 0);
            nextRows.push({
              id: `${record.recordId || record.settleDate}-${staff.segmentId || staff.name}-${nextRows.length}`,
              date: record.settleDate,
              writer: record.submittedBy || "",
              name: staff.name,
              workplace: staff.officeWorkplace || branchName,
              workType: staff.officeWorkType || (Number(staff.workHours || 0) > 0 ? "근무" : "휴무"),
              clockIn: staff.clockIn || "",
              clockOut: staff.clockOut || "",
              workHours: Number(staff.workHours || 0),
              standardHours: Number(staff.standardHours || 0),
              overtime: effectiveOvertime,
              overtimeReason: staff.overtimeReason || "",
              taskMemo: staff.officeTaskMemo || ""
            });
          });
        } catch (error) {
          console.warn("본사 근무내역 메타데이터 파싱 실패:", error);
        }
      });
      setRows(nextRows.sort((a, b) => String(b.date).localeCompare(String(a.date))));
    } catch (error) {
      console.error("본사 근무내역 로드 실패:", error);
    } finally {
      setLoading(false);
    }
  }, [branchName, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const calendarSummary = useMemo(() => {
    const byDate = new Map<string, any[]>();
    rows.forEach((row) => {
      const current = byDate.get(row.date) || [];
      current.push(row);
      byDate.set(row.date, current);
    });
    const workDates = new Set<string>();
    const offDates = new Set<string>();
    const dispatchDates = new Set<string>();
    byDate.forEach((items, date) => {
      const hasDispatch = items.some((item) => item.workType !== "휴무" && item.workplace && item.workplace !== branchName);
      const hasWork = items.some((item) => item.workType !== "휴무" && Number(item.workHours || 0) > 0);
      const allOff = items.length > 0 && items.every((item) => item.workType === "휴무");
      if (hasDispatch) dispatchDates.add(date);
      if (hasWork) workDates.add(date);
      if (allOff) offDates.add(date);
    });
    return { byDate, workDates, offDates, dispatchDates };
  }, [branchName, rows]);

  const renderWorkCalendar = () => {
    const [year, monthNumber] = month.split("-").map(Number);
    const firstDay = new Date(year, monthNumber - 1, 1).getDay();
    const dayCount = new Date(year, monthNumber, 0).getDate();
    const cells: Array<number | null> = [
      ...Array.from({ length: firstDay }, () => null),
      ...Array.from({ length: dayCount }, (_, index) => index + 1)
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    return (
      <section className="branch-sheet-card">
        {/* 제목 밴드 = 지점 표준(DESIGN.md §6-3). 제목엔 글자만 — 아이콘 금지(§6-1). */}
        <div className="branch-band">
          <h3 className="branch-band-title">근무 달력</h3>
          <p className="branch-band-meta">
            근무 <b>{calendarSummary.workDates.size}일</b> · 휴무 <b>{calendarSummary.offDates.size}일</b> ·
            지점파견 <b>{calendarSummary.dispatchDates.size}일</b>
          </p>
        </div>
        <div className="p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2 text-[11px] font-bold text-gray-500">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" />근무</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gray-400" />휴무</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />지점파견</span>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
            <div key={day} className={`py-2 font-black ${day === "일" ? "text-rose-500" : day === "토" ? "text-blue-500" : "text-gray-400"}`}>{day}</div>
          ))}
          {cells.map((day, index) => {
            if (!day) return <div key={`empty-${index}`} className="min-h-20 rounded-xl bg-gray-50/40" />;
            const date = `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const items = calendarSummary.byDate.get(date) || [];
            const hasDispatch = calendarSummary.dispatchDates.has(date);
            const hasWork = calendarSummary.workDates.has(date);
            const isOff = calendarSummary.offDates.has(date);
            const bg = hasDispatch ? "border-amber-200 bg-amber-50" : hasWork ? "border-sky-200 bg-sky-50" : isOff ? "border-gray-200 bg-gray-100" : "border-gray-100 bg-white";
            return (
              <div key={date} className={`min-h-20 rounded-xl border p-2 text-left ${bg}`}>
                <div className="flex items-center justify-between">
                  <span className="font-black text-gray-800">{day}</span>
                  <div className="flex gap-1">
                    {hasWork && <span className="h-2 w-2 rounded-full bg-sky-500" />}
                    {isOff && <span className="h-2 w-2 rounded-full bg-gray-400" />}
                    {hasDispatch && <span className="h-2 w-2 rounded-full bg-amber-500" />}
                  </div>
                </div>
                {items.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {items.slice(0, 3).map((item, itemIndex) => (
                      <div key={`${date}-${item.name}-${itemIndex}`} className="truncate text-[10px] font-bold text-gray-600">
                        {item.name} {item.workType === "휴무" ? "휴무" : `${item.workplace} ${compactTimeRange(item.clockIn, item.clockOut)}`}
                      </div>
                    ))}
                    {items.length > 3 && <div className="text-[10px] font-black text-gray-400">+{items.length - 3}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-5 animate-fade-in" id="office-work-log-tab">
      <section className="branch-sheet-card">
        {/* 제목 밴드 = 지점 표준(DESIGN.md §6-3). 제목엔 글자만 — 아이콘 금지(§6-1). */}
        <div className="branch-band">
          <h3 className="branch-band-title">본사 근무내역</h3>
          {/* 모양(28px·11px·알약·흰 바탕)은 `.branch-band-filters` 가 !important 로 강제한다 — 여기 적지 않는다. */}
          <div className="branch-band-filters">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="조회월 선택" title="조회월 선택" />
            <button type="button" onClick={() => setShowCalendar((value) => !value)} aria-pressed={showCalendar}>
              달력 {showCalendar ? "닫기" : "보기"}
            </button>
            <button type="button" onClick={() => void load()}>새로고침</button>
          </div>
          <p className="branch-band-meta">월별로 본사 직원의 근무시간, 근무지점, 업무내용을 확인합니다.</p>
        </div>
      </section>

      {showCalendar && renderWorkCalendar()}

      <section className="branch-sheet-card">
        {/* 제목 밴드 = 지점 표준(DESIGN.md §6-3). 제목엔 글자만 — 아이콘 금지(§6-1). */}
        <div className="branch-band">
          <h3 className="branch-band-title">근무 상세 내역</h3>
        </div>
        <div className="overflow-x-auto">
          {/* 머리글 모양(엘리스·11px·900·스크롤 고정)은 `.branch-sheet-head` 가 준다 — 색·굵기를 여기 적지 않는다. */}
          {/* 본문 12px(§6-0-1) — `text-sm`(14px)은 표 본문 규격이 아니다. 머리글 11px 은 `.branch-sheet-head` 가 준다. */}
          <table className="branch-sheet-head w-full min-w-[980px] text-xs">
            <thead>
              <tr>
                <th className="w-28">날짜</th>
                <th className="w-24">직원</th>
                <th className="w-32">근무지점</th>
                <th className="w-20">상태</th>
                <th className="w-28">시간</th>
                <th className="w-24 text-right">근무</th>
                <th className="w-24 text-right">초과</th>
                <th>업무내용</th>
                <th className="w-40">초과 사유</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="p-12 text-center"><LoadingSpinner size="sm" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="p-12 text-center text-gray-400 font-bold">선택한 월의 본사 근무내역이 없습니다.</td></tr>
              ) : rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/60">
                  <td className="p-3 font-mono text-xs text-gray-500">{row.date}</td>
                  <td className="p-3 font-black text-gray-800">{row.name}</td>
                  <td className="p-3 text-xs font-bold text-gray-600">{row.workplace}</td>
                  <td className="p-3">
                    <span className={`rounded-lg px-2 py-1 text-xs font-black ${row.workType === "휴무" ? "bg-gray-100 text-gray-500" : "bg-sky-50 text-sky-700"}`}>{row.workType}</span>
                  </td>
                  <td className="p-3 font-mono text-xs">{row.workType === "휴무" ? "-" : `${row.clockIn}~${row.clockOut}`}</td>
                  <td className="p-3 text-right font-mono font-black text-sky-700">{row.workHours}h</td>
                  <td className={`p-3 text-right font-mono font-black ${row.overtime > 0 ? "text-emerald-600" : row.overtime < 0 ? "text-rose-500" : "text-gray-400"}`}>{row.overtime > 0 ? "+" : ""}{row.overtime}h</td>
                  <td className="p-3 text-gray-700">{row.taskMemo || "-"}</td>
                  <td className="p-3 text-xs text-gray-500">{row.overtimeReason || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
