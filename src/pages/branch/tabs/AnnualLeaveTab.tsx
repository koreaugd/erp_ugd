// src/pages/branch/tabs/AnnualLeaveTab.tsx
// 연차관리 탭 — 직원별 연차 현황 + 연차 사용 등록.
//
// [권한] 작성(등록·지점변경·행삭제)은 **지점관리자(branchAdmin)·총괄(admin)만** 가능하다(사용자 지시 2026-08-04).
//   일반 지점 계정(branch)은 **읽기만** 한다 — canWrite=false 로 내려온다.
//   화면에서 감추는 것은 오조작 방지일 뿐 보안 경계가 아니다(Firestore 규칙은 별도 과제 — 아래 주의).
//
// 부여/사용/잔여 계산은 관리자페이지 연차관리와 같은 저장소·같은 함수(annualLeavePolicy)를 쓴다 —
// 어느 화면에서 보든 숫자가 같아야 한다.
import { useState, useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import type { Employee } from "../types";
import { toLocalDateInputValue } from "../helpers/formatters";
import { calcAutoGrantDays, mergeLegacyGrantOverrides, ANNUAL_LEAVE_GRANT_OVERRIDES_PREFIX, ANNUAL_LEAVE_USED_ADJUST_PREFIX, LEGACY_ANNUAL_LEAVE_GRANTS_PREFIX } from "../../../utils/annualLeavePolicy";
import { moveAnnualLeaveEmployee, deleteAnnualLeaveEmployee } from "../helpers/annualLeaveOps";
import { getAdminBranchList } from "../../admin/helpers/closedBranches";

// isAdmin 은 더 이상 이 탭의 갈림길이 아니다 — 작성 여부는 canWrite(지점관리자·총괄) 하나로만 정한다.
// prop 자체는 호출부 호환을 위해 받되 쓰지 않는다.
export function AnnualLeaveTab({ branchName, canWrite = false, moveTargets = [] }: { branchName: string; isAdmin?: boolean; canWrite?: boolean; moveTargets?: string[] | "all" }) {
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
  // 부여일수 수동값·사용일수 보정값 — 관리자 연차관리와 같은 키를 읽어 어느 화면에서 보든 숫자가 같아야 한다.
  const [grantOverrides, setGrantOverrides] = useState<Record<string, number>>({});
  const [usedAdjusts, setUsedAdjusts] = useState<Record<string, number>>({});
  // 지점 전환 직후 옛 지점의 늦은 응답이 새 지점 화면에 스며들지 않게 순번을 매긴다(저장은 loadedBranch가 이미 막지만
  // 표시 숫자도 섞이면 관리자 화면과 어긋나 보인다 — Codex 지적 2026-08-04).
  const loadSeqRef = useRef(0);
  const load = useCallback(async () => { const seq = ++loadSeqRef.current; setLoadFailed(false); try { const [roster, saved, grants, legacyGrants, adjust] = await Promise.all([gasClient.getBranchOwnRoster(branchName), gasClient.getSharedData<any[]>(`annual_leave:${branchName}`), gasClient.getSharedData<Record<string, number>>(`${ANNUAL_LEAVE_GRANT_OVERRIDES_PREFIX}${branchName}`), gasClient.getSharedData<Record<string, number>>(`${LEGACY_ANNUAL_LEAVE_GRANTS_PREFIX}${branchName}`), gasClient.getSharedData<Record<string, number>>(`${ANNUAL_LEAVE_USED_ADJUST_PREFIX}${branchName}`)]); if (seq !== loadSeqRef.current) return; /* 더 새 조회가 시작됨 — 옛 결과는 버린다 */ setEmployees(roster as Employee[]); /* entryDate 원본 유지 — 부여일수 자동계산에 쓴다. 표시용 축약은 렌더에서. */ setEntries(saved || []); setGrantOverrides(mergeLegacyGrantOverrides(legacyGrants, grants)); setUsedAdjusts(adjust || {}); setLoadedBranch(branchName); } catch (err) { if (seq !== loadSeqRef.current) return; console.warn("연차관리 데이터를 불러오지 못했습니다(로그인 복원 대기 실패 등).", err); setLoadFailed(true); } }, [branchName]);
  useEffect(() => { void load(); }, [load]);
  // 지점변경 드롭다운의 대상 목록. 휴업 지점으로는 이동할 수 없어야 하므로 지점 화면에서도 관리자 목록(휴업 제외)을 쓴다.
  // 보낼 수 있는 지점 = 운영 중인 지점 ∩ 이 계정이 다룰 수 있는 지점.
  // 총괄이 아니면 자기 권한 밖 지점으로 직원을 밀어 넣을 수 없어야 한다(Codex 지적 2026-08-04) —
  // 지점관리자는 담당 지점끼리만 옮긴다. 현재 지점은 드롭다운의 기준값이라 항상 포함한다.
  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  useEffect(() => {
    getAdminBranchList()
      .then((list) => {
        const running = list.map((b: any) => String(b.branchName || "")).filter(Boolean);
        const allowed = moveTargets === "all" ? running : running.filter((name) => moveTargets.includes(name) || name === branchName);
        setBranchOptions(allowed);
      })
      .catch(() => setBranchOptions([]));
  }, [moveTargets, branchName]);

  // 지점변경 — 명부·연차 데이터가 함께 이동한다(annualLeaveOps 공용 로직). 관리자페이지 연차관리와 같은 저장소를
  // 고치므로 여기서 바꾸면 관리자 화면에도 그대로 반영된다.
  const moveEmployee = async (employee: Employee, toBranch: string) => {
    if (!toBranch || toBranch === branchName) return;
    // 권한 검사는 moveAnnualLeaveEmployee 안에서도 한 번 더 한다(저장 레이어 방어) — 여기서는 확인창을 띄우기 전에 걸러낸다.
    if (moveTargets !== "all" && !moveTargets.includes(toBranch)) {
      window.alert(`[${toBranch}] 지점으로 옮길 권한이 없습니다. 담당 지점으로만 이동할 수 있습니다.`);
      return;
    }
    if (!isLoaded) { window.alert("연차 데이터를 아직 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요."); return; }
    if (!window.confirm(`[${employee.name}] 님을 ${branchName} → ${toBranch} 지점으로 이동할까요?\n연차 사용기록·부여/사용 수정값도 함께 이동합니다.`)) return;
    try {
      const result = await moveAnnualLeaveEmployee(branchName, toBranch, employee.id, moveTargets);
      window.alert(result.message);
    } catch (err) {
      console.error("지점이동 실패", err);
      window.alert("지점이동에 실패했습니다. 네트워크 상태 확인 후 다시 시도해주세요.");
    }
    // 등록 폼이 방금 옮긴 직원을 가리킨 채 남아 있으면, 그대로 등록했을 때 **옛 지점에** 아무 행에도
    // 안 보이는 고아 기록이 생긴다(Codex 지적 2026-08-04). 선택을 비운다.
    if (employeeId === employee.id) setEmployeeId("");
    void load();
  };
  const removeEmployee = async (employee: Employee) => {
    if (!isLoaded) { window.alert("연차 데이터를 아직 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요."); return; }
    if (!window.confirm(`[${employee.name}] 님을 ${branchName} 명부에서 삭제할까요?\n직원현황·급여대장 등 다른 화면에서도 함께 빠집니다. (연차 사용기록 데이터는 지우지 않습니다)`)) return;
    try {
      const result = await deleteAnnualLeaveEmployee(branchName, employee.id);
      window.alert(result.message);
    } catch (err) {
      console.error("행 삭제 실패", err);
      window.alert("삭제에 실패했습니다. 네트워크 상태 확인 후 다시 시도해주세요.");
    }
    if (employeeId === employee.id) setEmployeeId(""); // 위 이동과 같은 이유(고아 기록 방지)
    void load();
  };
  // 등록은 트랜잭션 prepend — 읽어둔 목록 위에 통째 저장하면 다른 기기(관리자페이지 포함)가 방금 등록한 기록이 지워진다.
  const save = async () => { if (!isLoaded) { window.alert("연차 데이터를 아직 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요. (그대로 저장하면 기존 연차 기록이 지워질 수 있습니다.)"); return; } const days = Math.floor((new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86400000) + 1; if (!employeeId || days < 1 || !reason.trim()) return; /* 고른 직원이 아직 이 지점 명부에 있는지 **서버 기준**으로 확인한다. 화면의 명부는 낡을 수 있어(다른 노트북이 방금 옮겼을 수 있다) 그것만 믿으면 아무 행에도 안 보이는 고아 기록이 남는다(Codex 지적 2026-08-04). 조회 실패도 저장 금지(fail-closed). */ try { const fresh = await gasClient.getBranchOwnRosterFromServer(branchName); if (!(fresh || []).some((item: any) => item.id === employeeId && item.division === "정직원")) { window.alert("선택한 직원이 이 지점 명부에 없습니다(다른 기기에서 이동·삭제되었을 수 있습니다). 목록을 새로 불러옵니다."); setEmployeeId(""); void load(); return; } } catch (err) { console.error("명부 확인 실패", err); window.alert("직원 명부를 확인하지 못해 등록을 멈췄습니다. 네트워크 상태 확인 후 다시 시도해 주세요."); return; } const nextEntry = { id: `leave-${Date.now()}`, employeeId, days, startDate, endDate, date: startDate, reason: reason.trim() }; try { await gasClient.mutateSharedData<any[]>(`annual_leave:${branchName}`, (current) => [nextEntry, ...(Array.isArray(current) ? current : [])]); setEntries((prev) => [nextEntry, ...prev]); setReason(""); } catch (err) { console.error("연차 저장 실패", err); window.alert("연차 저장에 실패했습니다. 로그인 상태를 확인한 뒤 다시 시도해 주세요."); } };

  // 실패색은 hex 로 못 박는다 — `bg-rose-*`/`text-rose-*` 는 지점 스코프에서 바닐라·검정으로 치환돼
  // "저장이 잠겼다"는 경고가 평범한 안내로 보인다(DESIGN.md §11·§12). 파트타이머 급여대장의 실패 배너와 같은 조합.
  const failBanner = loadFailed && <div className="bg-[#FDE2E2] border border-[#C93A3A] text-[#B91C1C] text-xs font-bold rounded-xl p-3 flex items-center justify-between gap-3"><span>연차 데이터를 불러오지 못했습니다. 저장이 잠겼습니다(기존 기록 덮어쓰기 방지).</span><button onClick={()=>void load()} className="shrink-0 rounded-full bg-[#212121] text-[#F6F5FA] px-4 py-1.5 text-[11px] font-black">다시 시도</button></div>;

  // 직원별 연차 현황 — 읽기는 모두, 고치기는 canWrite 계정만. 저장소가 관리자페이지와 같아 양쪽에 똑같이 반영된다.
  const statusCard = (
    <div className="branch-sheet-card"><div className="branch-band"><h3 className="branch-band-title">직원별 연차 현황</h3><p className="branch-band-meta">{canWrite ? "지점을 바꾸면 명부·연차 기록이 그 지점으로 이동하고, X를 누르면 명부에서 빠집니다(관리자페이지에 그대로 반영)" : "열람 전용입니다 — 연차 작성은 지점관리자·총괄 계정만 가능합니다"}</p></div><div className="branch-sheet-scroll"><table id="annual-leave-status-sheet" className="branch-sheet"><thead><tr><th>지점</th><th>직원</th><th>입사일</th><th>부여</th><th>사용</th><th>잔여</th><th>사용 날짜 기록</th></tr></thead><tbody>{employees.filter(e=>e.division === "정직원").map(e=>{const logs=entries.filter(x=>x.employeeId===e.id);const logsSum=logs.reduce((s,x)=>s+Number(x.days||0),0);const used=Math.max(0, logsSum + Number(usedAdjusts[e.id] ?? 0));const grant=grantOverrides[e.id] ?? calcAutoGrantDays(e.entryDate) ?? 0;return <tr key={e.id} className="border-t">{/* 지점 드롭다운 — 제어 컴포넌트라 확인 취소 시 원래 지점으로 되돌아온다. 읽기 전용 계정엔 글자만. */}<td>{canWrite ? <select value={branchName} onChange={ev=>void moveEmployee(e, ev.target.value)} className="text-[11px] font-bold text-gray-600 cursor-pointer">{!branchOptions.includes(branchName) && <option value={branchName}>{branchName}</option>}{branchOptions.map(name=><option key={name} value={name}>{name}</option>)}</select> : <span className="text-[11px] font-bold text-gray-600">{branchName}</span>}</td>{/* 이름 + 행삭제 X — 주류재고 시트와 같은 문법(늘 보이고 Tab으로도 닿는다) */}<td><div className="flex items-center gap-1"><span className="flex-1 truncate font-bold">{e.name}</span>{canWrite && <button type="button" onClick={()=>void removeEmployee(e)} aria-label={`${e.name} 명부에서 삭제`} title={`${e.name} 명부에서 삭제(퇴사 처리)`} className="shrink-0 rounded p-0.5 text-gray-300 transition hover:bg-[#FDE2E2] hover:text-[#B3261E] focus:text-[#B3261E] focus:outline-none cursor-pointer"><X className="h-3.5 w-3.5" /></button>}</div></td><td>{e.entryDate?String(e.entryDate).replace(/\./g,"-").slice(2).replace(/-/g,"."):"-"}</td><td>{grant}일</td><td>{used}일</td><td className="font-bold text-[#2E6DB4]">{grant-used}일</td><td className="text-xs text-gray-500">{logs.map(x=>`${x.startDate || x.date}${x.endDate && x.endDate !== (x.startDate || x.date) ? ` ~ ${x.endDate}` : ""}`).join(", ") || "-"}</td></tr>})}</tbody></table></div></div>
  );

  // 작성 권한이 없는 계정(일반 지점): 현황 열람만.
  if (!canWrite) return (
    <div className="space-y-5" id="annual-leave-maintenance">
      {failBanner}
      {statusCard}
    </div>
  );

  return <div className="space-y-5" id="annual-leave-maintenance">{failBanner}<div className="branch-sheet-card"><div className="branch-band"><h3 className="branch-band-title">연차 사용 등록</h3><p className="branch-band-meta">시작일과 종료일을 선택하면 사용 일수가 자동 계산됩니다.</p></div><div className="flex flex-wrap gap-2 p-4"><select value={employeeId} onChange={e=>setEmployeeId(e.target.value)} className="border rounded px-3 py-2 text-xs font-bold"><option value="">직원 선택</option>{employees.filter(e=>e.division === "정직원").map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select><label className="text-xs">시작일<input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="block border rounded px-2 py-1"/></label><label className="text-xs">종료일<input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="block border rounded px-2 py-1"/></label><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="사용 사유" className="border rounded px-3"/><button onClick={()=>void save()} disabled={!isLoaded} title={!isLoaded ? "연차 데이터를 불러오는 중입니다." : undefined} className="bg-[#2E6DB4] text-white rounded px-4 text-[11px] font-black disabled:opacity-40 disabled:cursor-not-allowed">연차 사용 등록</button></div></div>{statusCard}</div>;
}
