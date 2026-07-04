// src/pages/branch/tabs/AnnualLeaveTab.tsx
// 연차관리 탭. BranchConfirmPage에서 분리 — 동작 변경 없음(코드 이동만).
import { useState, useCallback, useEffect } from "react";
import { gasClient } from "../../../api/gasClient";
import type { Employee } from "../types";
import { toLocalDateInputValue } from "../helpers/formatters";

export function AnnualLeaveTab({ branchName, isAdmin = false }: { branchName: string; isAdmin?: boolean }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [employeeId, setEmployeeId] = useState(""); const [startDate, setStartDate] = useState(toLocalDateInputValue()); const [endDate, setEndDate] = useState(toLocalDateInputValue()); const [reason, setReason] = useState("");
  const load = useCallback(async () => { const [roster, saved] = await Promise.all([gasClient.getBranchOwnRoster(branchName), gasClient.getSharedData<any[]>(`annual_leave:${branchName}`)]); setEmployees((roster as Employee[]).map((employee) => ({ ...employee, entryDate: employee.entryDate ? employee.entryDate.slice(2).replace(/-/g, ".") : "" }))); setEntries(saved || []); }, [branchName]);
  useEffect(() => { void load(); }, [load]);
  if (!isAdmin) return (
    <div className="space-y-5" id="annual-leave-maintenance">
      <section className="bg-white p-6 rounded-2xl border shadow-sm">
        <h3 className="font-black text-gray-800">연차관리</h3>
        <p className="text-sm font-bold text-gray-600 mt-2">현재 코드 수정중이므로 작성이 불가능합니다.</p>
      </section>
    </div>
  );
  const save = async () => { const days = Math.floor((new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86400000) + 1; if (!employeeId || days < 1 || !reason.trim()) return; const next = [{ id: `leave-${Date.now()}`, employeeId, days, startDate, endDate, date: startDate, reason: reason.trim() }, ...entries]; await gasClient.saveSharedData(`annual_leave:${branchName}`, next); setEntries(next); setReason(""); };
  return <div className="space-y-5"><section className="bg-white p-4 rounded-2xl border shadow-sm text-sm font-bold text-gray-600">현재 코드 수정중이므로 작성이 불가능합니다.</section><div className="bg-white p-6 rounded-2xl border shadow-sm"><h3 className="font-black text-gray-800">연차관리</h3><p className="text-xs text-gray-400 mt-1">시작일과 종료일을 선택하면 사용 일수가 자동 계산됩니다.</p><div className="flex flex-wrap gap-2 mt-4"><select value={employeeId} onChange={e=>setEmployeeId(e.target.value)} className="border rounded px-3 py-2 text-sm"><option value="">직원 선택</option>{employees.filter(e=>e.division === "정직원").map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select><label className="text-xs">시작일<input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="block border rounded px-2 py-1"/></label><label className="text-xs">종료일<input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="block border rounded px-2 py-1"/></label><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="사용 사유" className="border rounded px-3"/><button onClick={()=>void save()} className="bg-[#2E6DB4] text-white rounded px-4 text-sm font-bold">연차 사용 등록</button></div></div><div className="bg-white rounded-2xl border overflow-hidden"><table className="w-full text-sm"><thead><tr className="bg-gray-50 text-left"><th className="p-3">직원</th><th>입사일</th><th>부여</th><th>사용</th><th>잔여</th><th>사용 날짜 기록</th></tr></thead><tbody>{employees.filter(e=>e.division === "정직원").map(e=>{const logs=entries.filter(x=>x.employeeId===e.id);const used=logs.reduce((s,x)=>s+Number(x.days||0),0);return <tr key={e.id} className="border-t"><td className="p-3 font-bold">{e.name}</td><td>{e.entryDate||"-"}</td><td>15일</td><td>{used}일</td><td className="font-bold text-[#2E6DB4]">{15-used}일</td><td className="text-xs text-gray-500">{logs.map(x=>`${x.startDate || x.date}${x.endDate && x.endDate !== (x.startDate || x.date) ? ` ~ ${x.endDate}` : ""}`).join(", ") || "-"}</td></tr>})}</tbody></table></div></div>;
}
