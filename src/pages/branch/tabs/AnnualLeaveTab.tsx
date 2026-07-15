// src/pages/branch/tabs/AnnualLeaveTab.tsx
// 연차관리 탭. BranchConfirmPage에서 분리 — 동작 변경 없음(코드 이동만).
import { useState, useCallback, useEffect } from "react";
import { gasClient } from "../../../api/gasClient";
import type { Employee } from "../types";
import { toLocalDateInputValue } from "../helpers/formatters";

export function AnnualLeaveTab({ branchName, isAdmin = false }: { branchName: string; isAdmin?: boolean }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  // loaded=false면 아직 서버 값을 못 받은 것. 이 상태에서 저장하면 빈 entries로 기존 연차를 덮어쓴다 —
  // 그래서 불러오기 전에는 저장을 막고, 실패는 화면에 드러낸다(조용히 빈 화면으로 두지 않는다).
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [employeeId, setEmployeeId] = useState(""); const [startDate, setStartDate] = useState(toLocalDateInputValue()); const [endDate, setEndDate] = useState(toLocalDateInputValue()); const [reason, setReason] = useState("");
  const load = useCallback(async () => { setLoadFailed(false); try { const [roster, saved] = await Promise.all([gasClient.getBranchOwnRoster(branchName), gasClient.getSharedData<any[]>(`annual_leave:${branchName}`)]); setEmployees((roster as Employee[]).map((employee) => ({ ...employee, entryDate: employee.entryDate ? employee.entryDate.slice(2).replace(/-/g, ".") : "" }))); setEntries(saved || []); setLoaded(true); } catch (err) { console.warn("연차관리 데이터를 불러오지 못했습니다(로그인 복원 대기 실패 등).", err); setLoadFailed(true); } }, [branchName]);
  useEffect(() => { void load(); }, [load]);
  if (!isAdmin) return (
    <div className="space-y-5" id="annual-leave-maintenance">
      <section className="bg-white p-6 rounded-2xl border shadow-sm">
        <h3 className="font-black text-gray-800">연차관리</h3>
        <p className="text-sm font-bold text-gray-600 mt-2">현재 코드 수정중이므로 작성이 불가능합니다.</p>
      </section>
    </div>
  );
  const save = async () => { if (!loaded) { window.alert("연차 데이터를 아직 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요. (그대로 저장하면 기존 연차 기록이 지워질 수 있습니다.)"); return; } const days = Math.floor((new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86400000) + 1; if (!employeeId || days < 1 || !reason.trim()) return; const next = [{ id: `leave-${Date.now()}`, employeeId, days, startDate, endDate, date: startDate, reason: reason.trim() }, ...entries]; try { await gasClient.saveSharedData(`annual_leave:${branchName}`, next); setEntries(next); setReason(""); } catch (err) { console.error("연차 저장 실패", err); window.alert("연차 저장에 실패했습니다. 로그인 상태를 확인한 뒤 다시 시도해 주세요."); } };
  return <div className="space-y-5"><section className="bg-white p-4 rounded-2xl border shadow-sm text-sm font-bold text-gray-600">현재 코드 수정중이므로 작성이 불가능합니다.</section>{loadFailed && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold rounded-xl p-3 flex items-center justify-between gap-3"><span>연차 데이터를 불러오지 못했습니다. 저장이 잠겼습니다(기존 기록 덮어쓰기 방지).</span><button onClick={()=>void load()} className="shrink-0 rounded bg-rose-600 text-white px-3 py-1 text-xs font-black">다시 시도</button></div>}<div className="bg-white p-6 rounded-2xl border shadow-sm"><h3 className="font-black text-gray-800">연차관리</h3><p className="text-xs text-gray-400 mt-1">시작일과 종료일을 선택하면 사용 일수가 자동 계산됩니다.</p><div className="flex flex-wrap gap-2 mt-4"><select value={employeeId} onChange={e=>setEmployeeId(e.target.value)} className="border rounded px-3 py-2 text-sm"><option value="">직원 선택</option>{employees.filter(e=>e.division === "정직원").map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select><label className="text-xs">시작일<input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="block border rounded px-2 py-1"/></label><label className="text-xs">종료일<input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="block border rounded px-2 py-1"/></label><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="사용 사유" className="border rounded px-3"/><button onClick={()=>void save()} disabled={!loaded} title={!loaded ? "연차 데이터를 불러오는 중입니다." : undefined} className="bg-[#2E6DB4] text-white rounded px-4 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed">연차 사용 등록</button></div></div><div className="bg-white rounded-2xl border overflow-hidden"><table className="w-full text-sm"><thead><tr className="bg-gray-50 text-left"><th className="p-3">직원</th><th>입사일</th><th>부여</th><th>사용</th><th>잔여</th><th>사용 날짜 기록</th></tr></thead><tbody>{employees.filter(e=>e.division === "정직원").map(e=>{const logs=entries.filter(x=>x.employeeId===e.id);const used=logs.reduce((s,x)=>s+Number(x.days||0),0);return <tr key={e.id} className="border-t"><td className="p-3 font-bold">{e.name}</td><td>{e.entryDate||"-"}</td><td>15일</td><td>{used}일</td><td className="font-bold text-[#2E6DB4]">{15-used}일</td><td className="text-xs text-gray-500">{logs.map(x=>`${x.startDate || x.date}${x.endDate && x.endDate !== (x.startDate || x.date) ? ` ~ ${x.endDate}` : ""}`).join(", ") || "-"}</td></tr>})}</tbody></table></div></div>;
}
