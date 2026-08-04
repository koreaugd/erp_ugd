// src/pages/branch/tabs/AnnualLeaveTab.tsx
// 연차관리 탭. BranchConfirmPage에서 분리 — 동작 변경 없음(코드 이동만).
import { useState, useCallback, useEffect } from "react";
import { gasClient } from "../../../api/gasClient";
import type { Employee } from "../types";
import { toLocalDateInputValue } from "../helpers/formatters";

export function AnnualLeaveTab({ branchName, isAdmin = false }: { branchName: string; isAdmin?: boolean }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  // loadedBranch = 지금 화면에 든 데이터가 어느 지점 것인가. isLoaded = 그게 현재 지점과 일치하는가.
  // 지점이 바뀌면(예전에 불러왔던 지점으로 되돌아온 경우까지 포함) 아래 렌더-단계 리셋이 loadedBranch를
  // 즉시 null로 만든다 → 새 지점 값을 다시 받기 전까지 isLoaded=false로 저장이 막힌다.
  // (async load 안에서 리셋하면 지점 전환~이펙트 실행 사이 한 프레임의 창이 남아 stale 저장이 가능하므로,
  //  React "prop 바뀔 때 state 조정" 패턴으로 렌더 중 동기적으로 무효화한다.)
  const [loadedBranch, setLoadedBranch] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [trackedBranch, setTrackedBranch] = useState(branchName);
  if (trackedBranch !== branchName) { setTrackedBranch(branchName); setLoadedBranch(null); setLoadFailed(false); }
  const isLoaded = loadedBranch === branchName;
  const [employeeId, setEmployeeId] = useState(""); const [startDate, setStartDate] = useState(toLocalDateInputValue()); const [endDate, setEndDate] = useState(toLocalDateInputValue()); const [reason, setReason] = useState("");
  const load = useCallback(async () => { setLoadFailed(false); try { const [roster, saved] = await Promise.all([gasClient.getBranchOwnRoster(branchName), gasClient.getSharedData<any[]>(`annual_leave:${branchName}`)]); setEmployees((roster as Employee[]).map((employee) => ({ ...employee, entryDate: employee.entryDate ? employee.entryDate.slice(2).replace(/-/g, ".") : "" }))); setEntries(saved || []); setLoadedBranch(branchName); } catch (err) { console.warn("연차관리 데이터를 불러오지 못했습니다(로그인 복원 대기 실패 등).", err); setLoadFailed(true); } }, [branchName]);
  useEffect(() => { void load(); }, [load]);
  if (!isAdmin) return (
    <div className="space-y-5" id="annual-leave-maintenance">
      {/* 제목 밴드 = 지점 표준(DESIGN.md §6-3) */}
      <section className="branch-sheet-card">
        <div className="branch-band">
          <h3 className="branch-band-title">연차관리</h3>
          <p className="branch-band-meta">준비 중인 화면입니다</p>
        </div>
        <p className="p-4 text-xs font-bold text-gray-600">현재 코드 수정중이므로 작성이 불가능합니다.</p>
      </section>
    </div>
  );
  const save = async () => { if (!isLoaded) { window.alert("연차 데이터를 아직 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요. (그대로 저장하면 기존 연차 기록이 지워질 수 있습니다.)"); return; } const days = Math.floor((new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86400000) + 1; if (!employeeId || days < 1 || !reason.trim()) return; const next = [{ id: `leave-${Date.now()}`, employeeId, days, startDate, endDate, date: startDate, reason: reason.trim() }, ...entries]; try { await gasClient.saveSharedData(`annual_leave:${branchName}`, next); setEntries(next); setReason(""); } catch (err) { console.error("연차 저장 실패", err); window.alert("연차 저장에 실패했습니다. 로그인 상태를 확인한 뒤 다시 시도해 주세요."); } };
  return <div className="space-y-5"><section className="branch-sheet-card"><p className="p-4 text-xs font-bold text-gray-600">현재 코드 수정중이므로 작성이 불가능합니다.</p></section>{/* 실패색은 hex 로 못 박는다 — `bg-rose-*`/`text-rose-*` 는 지점 스코프에서 바닐라·검정으로 치환돼
    "저장이 잠겼다"는 경고가 평범한 안내로 보인다(DESIGN.md §11·§12). 파트타이머 급여대장의 실패 배너와 같은 조합. */}
{loadFailed && <div className="bg-[#FDE2E2] border border-[#C93A3A] text-[#B91C1C] text-xs font-bold rounded-xl p-3 flex items-center justify-between gap-3"><span>연차 데이터를 불러오지 못했습니다. 저장이 잠겼습니다(기존 기록 덮어쓰기 방지).</span><button onClick={()=>void load()} className="shrink-0 rounded-full bg-[#212121] text-[#F6F5FA] px-4 py-1.5 text-[11px] font-black">다시 시도</button></div>}<div className="branch-sheet-card"><div className="branch-band"><h3 className="branch-band-title">연차 사용 등록</h3><p className="branch-band-meta">시작일과 종료일을 선택하면 사용 일수가 자동 계산됩니다.</p></div><div className="flex flex-wrap gap-2 p-4"><select value={employeeId} onChange={e=>setEmployeeId(e.target.value)} className="border rounded px-3 py-2 text-xs font-bold"><option value="">직원 선택</option>{employees.filter(e=>e.division === "정직원").map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select><label className="text-xs">시작일<input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="block border rounded px-2 py-1"/></label><label className="text-xs">종료일<input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="block border rounded px-2 py-1"/></label><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="사용 사유" className="border rounded px-3"/><button onClick={()=>void save()} disabled={!isLoaded} title={!isLoaded ? "연차 데이터를 불러오는 중입니다." : undefined} className="bg-[#2E6DB4] text-white rounded px-4 text-[11px] font-black disabled:opacity-40 disabled:cursor-not-allowed">연차 사용 등록</button></div></div><div className="branch-sheet-card"><div className="branch-band"><h3 className="branch-band-title">직원별 연차 현황</h3></div><div className="branch-sheet-scroll"><table className="branch-sheet"><thead><tr><th>직원</th><th>입사일</th><th>부여</th><th>사용</th><th>잔여</th><th>사용 날짜 기록</th></tr></thead><tbody>{employees.filter(e=>e.division === "정직원").map(e=>{const logs=entries.filter(x=>x.employeeId===e.id);const used=logs.reduce((s,x)=>s+Number(x.days||0),0);return <tr key={e.id} className="border-t"><td className="font-bold">{e.name}</td><td>{e.entryDate||"-"}</td><td>15일</td><td>{used}일</td><td className="font-bold text-[#2E6DB4]">{15-used}일</td><td className="text-xs text-gray-500">{logs.map(x=>`${x.startDate || x.date}${x.endDate && x.endDate !== (x.startDate || x.date) ? ` ~ ${x.endDate}` : ""}`).join(", ") || "-"}</td></tr>})}</tbody></table></div></div></div>;
}
