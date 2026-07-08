// src/pages/branch/tabs/MonthlyFullTimeSalarySubTab.tsx
// 월말마감정산 - 정직원 급여대장 탭 (비밀번호 잠금 + 직원현황 자동연동, 전 컬럼 수정 가능)
import { useState, useEffect, useCallback, useRef } from "react";
import { Users, Plus, Trash2, Lock, Check, ShieldCheck } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import { formatNumber } from "../../../utils/formatNumber";
import { addMonthsToMonthInputValue, cleanNumeric, formatResidentNumber, formatWithCommas } from "../helpers/formatters";
import { pendingLocalSaveStorageKey, readLocalStaffList } from "../helpers/staffHelpers";

interface FullTimeSalaryRow {
  id: string;
  employeeId?: string;
  name: string;
  rank: string;
  residentNumber: string;
  entryDate: string;
  contractType: string;
  accountNumber: string;
  prevSalary: string;
  thisSalary: string;
  taxiEtc: string;
  bonusTip: string;
  overtimePay: string;
  remitBranch: string;
  memo: string;
  isManual?: boolean;
}

// 세션(페이지 로드) 단위 잠금 해제 상태 — 탭을 나갔다 와도 유지, 새로고침 시 재입력.
let fullTimeSalaryUnlocked = false;


const num = (v: string) => Number(cleanNumeric(String(v || ""))) || 0;
const rowTotal = (r: FullTimeSalaryRow) => num(r.thisSalary) + num(r.taxiEtc) + num(r.bonusTip) + num(r.overtimePay);

const rosterToRow = (emp: any): FullTimeSalaryRow => ({
  id: `ft_${emp.id || emp.name}`,
  employeeId: emp.id || undefined,
  name: emp.name || "",
  rank: emp.rank || emp.customRank || "",
  residentNumber: emp.residentNumber || "",
  entryDate: emp.entryDate || emp.hireDate || "",
  contractType: emp.contractType || "4대보험",
  accountNumber: "",
  prevSalary: "",
  thisSalary: "",
  taxiEtc: "",
  bonusTip: "",
  overtimePay: "",
  remitBranch: "",
  memo: "",
});

// 마감제출 전, 급여 행이 서버(공유)에 반드시 존재하도록 보장한다. 실패하면 blocked=true로 마감을 막는다.
// (0) 미저장 편집(pending) → 실 데이터 여부와 무관하게 로컬 최신본(행 삭제·0원 편집 포함)을 서버로 반영
//     → 방금 지우거나 0으로 바꾼 급여가 옛 서버값에 밀려 무시된 채 확정되는 것을 차단
// (1) pending 없으면 서버 최신값 신뢰  (2) 서버 비었지만 로컬에 실 데이터면 복구 저장  (3) 둘 다 없으면 중단
export async function flushFullTimeSalaryForClose(branchName: string, selectedMonth: string): Promise<{ blocked: boolean }> {
  const storageKey = `erp_monthly_fulltime_salary_${branchName}_${selectedMonth}`;
  const sharedKey = `monthly_fulltime_salary:${branchName}:${selectedMonth}`;
  const pendingKey = pendingLocalSaveStorageKey(storageKey);
  const readLocal = (): FullTimeSalaryRow[] | null => {
    try { const raw = localStorage.getItem(storageKey); return raw ? JSON.parse(raw) : null; } catch { return null; }
  };
  const money = (v: unknown) => Number(String(v ?? "").replace(/[^0-9.-]/g, "")) || 0;
  // 실 데이터 판정: 실제 급여 금액이 입력된 행이 하나라도 있어야 한다.
  // (로스터 자동생성 행은 이름만 있고 금액이 0이므로 제외된다)
  const hasMeaningful = (rows: FullTimeSalaryRow[] | null) =>
    Array.isArray(rows) && rows.some((r) => money(r.thisSalary) + money(r.taxiEtc) + money(r.bonusTip) + money(r.overtimePay) > 0);
  const local = readLocal();

  // 0) 미저장 편집(pending)이 있으면 실 데이터 여부와 무관하게 로컬 최신본(추가·수정·삭제·0원 편집 모두)을 서버로 반영한다.
  //    → 지점이 방금 지우거나 0으로 바꾼 급여가 옛 서버값에 밀려 무시된 채 확정되는 것을 차단. 저장 실패 시 확정 차단(fail-safe).
  //    반영 후엔 서버=로컬이므로 로컬 기준으로 판정한다(실 데이터가 없으면 — 예: 전부 비움/0원 — 확정 불가).
  if (localStorage.getItem(pendingKey) === "1" && Array.isArray(local)) {
    try { await gasClient.saveSharedData(sharedKey, local as FullTimeSalaryRow[]); localStorage.removeItem(pendingKey); }
    catch { return { blocked: true }; }
    return hasMeaningful(local) ? { blocked: false } : { blocked: true };
  }

  // 1) 미저장 편집이 없으면 서버(공유) 최신값을 신뢰한다. 실 데이터가 있으면 그대로 확정.
  let remote: FullTimeSalaryRow[] | null = null;
  try { remote = await gasClient.getSharedDataFromServer<FullTimeSalaryRow[]>(sharedKey); }
  catch { return { blocked: true }; }
  if (hasMeaningful(remote)) return { blocked: false };

  // 2) 서버가 비었지만 로컬에 실 데이터가 있으면 복구 저장 후 확정(레거시 상태 만회).
  if (hasMeaningful(local)) {
    try { await gasClient.saveSharedData(sharedKey, local as FullTimeSalaryRow[]); localStorage.removeItem(pendingKey); return { blocked: false }; }
    catch { return { blocked: true }; }
  }

  // 3) 서버·로컬 모두 실 데이터 없음 → 확정 불가.
  return { blocked: true };
}

export function MonthlyFullTimeSalarySubTab({
  branchName,
  selectedMonth,
  triggerToast,
  isLocked = false,
}: {
  branchName: string;
  selectedMonth: string;
  triggerToast: (msg: string, type?: "success" | "error") => void;
  isLocked?: boolean;
}) {
  // ---- 비밀번호 잠금 (기기 간 일관성을 위해 공유 백엔드의 비밀번호를 우선 사용, 실패 시 로컬/기본값) ----
  const [unlocked, setUnlocked] = useState(fullTimeSalaryUnlocked);
  const [passInput, setPassInput] = useState("");
  const [passError, setPassError] = useState("");
  const [passcode, setPasscode] = useState<string>("");
  const [passStatus, setPassStatus] = useState<"loading" | "ready" | "error" | "unconfigured">("loading");

  // 비밀번호는 캐시가 아닌 '서버 값'으로 검증한다. 서버에 실제로 비밀번호가 설정돼 있어야만(ready) 해제를 허용한다.
  // - 서버에 비밀번호 미설정 → unconfigured (하드코딩 기본값으로 뚫지 않고 관리자 설정 요구)
  // - 서버 도달 실패 → error (스테일 캐시로 해제 금지, 재시도 요구)
  const loadPasscode = useCallback(() => {
    setPassStatus("loading");
    gasClient.getSharedDataFromServer<any>("admin_settings")
      .then((remote) => {
        const pc = remote && typeof remote === "object" ? String(remote.fullTimeSalaryPasscode ?? "").trim() : "";
        // 빈값 또는 과거 하드코딩 기본값("1234")은 '설정 안 됨'으로 간주 → 레거시 서버 값이 유효하게 남지 않도록 거부.
        if (pc !== "" && pc !== "1234") {
          setPasscode(pc);
          setPassStatus("ready");
        } else {
          setPassStatus("unconfigured");
        }
      })
      .catch(() => setPassStatus("error"));
  }, []);

  useEffect(() => { loadPasscode(); }, [loadPasscode]);

  const tryUnlock = () => {
    if (passStatus !== "ready") {
      setPassError(
        passStatus === "loading" ? "보안 설정을 불러오는 중입니다. 잠시만 기다려주세요."
        : passStatus === "unconfigured" ? "급여대장 열람 비밀번호가 서버에 설정돼 있지 않습니다. 관리자 설정에서 먼저 비밀번호를 설정해주세요."
        : "보안 설정을 서버에서 확인하지 못했습니다. 네트워크 확인 후 '다시 시도'를 눌러주세요."
      );
      return;
    }
    if (passInput.trim() === passcode) {
      fullTimeSalaryUnlocked = true;
      setUnlocked(true);
      setPassError("");
    } else {
      setPassError("비밀번호가 올바르지 않습니다.");
    }
  };

  // ---- 데이터 상태 ----
  const [rows, setRows] = useState<FullTimeSalaryRow[]>([]);
  const autoSaveTimerRef = useRef<number | null>(null);
  // 저장 세대 카운터: 저장 요청 후 더 최신 편집이 있으면(gen 불일치) pending 플래그를 지우지 않는다.
  const autoSaveGenRef = useRef(0);
  const storageKey = `erp_monthly_fulltime_salary_${branchName}_${selectedMonth}`;
  const sharedKey = `monthly_fulltime_salary:${branchName}:${selectedMonth}`;
  const pendingKey = pendingLocalSaveStorageKey(storageKey);

  const loadRoster = useCallback(async (): Promise<any[]> => {
    let list: any[] = readLocalStaffList(branchName);
    try {
      const remote = await gasClient.getBranchOwnRoster(branchName);
      if (Array.isArray(remote) && remote.length > 0) list = remote;
    } catch {}
    return list.filter((e) => e && e.division === "정직원" && String(e.name || "").trim());
  }, [branchName]);

  // 저장된 급여 행은 절대 버리지 않는다. 로스터는 (1) 빈 항목의 기본값 채우기, (2) 명단에 없는 신규 정직원 추가에만 쓴다.
  const mergeRows = useCallback((roster: any[], saved: FullTimeSalaryRow[]): FullTimeSalaryRow[] => {
    const savedByEmp = new Map<string, FullTimeSalaryRow>();
    const savedByName = new Map<string, FullTimeSalaryRow>();
    saved.forEach((r) => {
      if (r.employeeId) savedByEmp.set(r.employeeId, r);
      if (r.name) savedByName.set(r.name.trim(), r);
    });
    const consumed = new Set<FullTimeSalaryRow>();
    const rosterRows = roster.map((emp) => {
      const base = rosterToRow(emp);
      const prior = (emp.id && savedByEmp.get(emp.id)) || savedByName.get(String(emp.name || "").trim());
      if (prior) {
        consumed.add(prior);
        // 저장값(사용자 수정)이 우선, 비어 있으면 로스터 기본값으로 채운다.
        return {
          ...base,
          name: prior.name || base.name,
          rank: prior.rank || base.rank,
          residentNumber: prior.residentNumber || base.residentNumber,
          entryDate: prior.entryDate || base.entryDate,
          contractType: prior.contractType || base.contractType,
          accountNumber: prior.accountNumber || "",
          prevSalary: prior.prevSalary || "",
          thisSalary: prior.thisSalary || "",
          taxiEtc: prior.taxiEtc || "",
          bonusTip: prior.bonusTip || "",
          overtimePay: prior.overtimePay || "",
          remitBranch: prior.remitBranch || "",
          memo: prior.memo || "",
        };
      }
      return base;
    });
    // 로스터가 비었거나 불완전해도 저장된 급여 행은 모두 보존한다.
    const leftover = saved.filter((r) => !consumed.has(r));
    return [...rosterRows, ...leftover];
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let saved: FullTimeSalaryRow[] = [];
      const hasPendingLocal = localStorage.getItem(pendingKey) === "1";
      try {
        if (hasPendingLocal) {
          const local = localStorage.getItem(storageKey);
          if (local) saved = JSON.parse(local);
        } else {
          const remote = await gasClient.getSharedData<FullTimeSalaryRow[]>(sharedKey);
          if (Array.isArray(remote)) saved = remote;
          else {
            const local = localStorage.getItem(storageKey);
            if (local) saved = JSON.parse(local);
          }
        }
      } catch {
        const local = localStorage.getItem(storageKey);
        if (local) { try { saved = JSON.parse(local); } catch {} }
      }

      const roster = await loadRoster();
      let merged = mergeRows(roster, saved);

      // 전월급여 자동 로드 (이번달 prevSalary가 비어있는 직원만)
      const needPrev = merged.some((r) => !r.prevSalary);
      if (needPrev) {
        try {
          const prevMonth = addMonthsToMonthInputValue(selectedMonth, -1);
          const prevRows = await gasClient.getSharedData<FullTimeSalaryRow[]>(`monthly_fulltime_salary:${branchName}:${prevMonth}`);
          if (Array.isArray(prevRows) && prevRows.length > 0) {
            const prevByEmp = new Map<string, string>();
            const prevByName = new Map<string, string>();
            prevRows.forEach((r) => {
              if (r.employeeId) prevByEmp.set(r.employeeId, r.thisSalary || "");
              if (r.name) prevByName.set(r.name.trim(), r.thisSalary || "");
            });
            merged = merged.map((r) => {
              if (r.prevSalary) return r;
              const p = (r.employeeId && prevByEmp.get(r.employeeId)) || prevByName.get(r.name.trim()) || "";
              return p ? { ...r, prevSalary: p } : r;
            });
          }
        } catch {}
      }

      if (!cancelled) {
        setRows(merged);
        localStorage.setItem(storageKey, JSON.stringify(merged));
      }
    };
    load();
    return () => {
      cancelled = true;
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      if (localStorage.getItem(pendingKey) === "1") {
        const local = localStorage.getItem(storageKey);
        if (local) {
          try {
            void gasClient.saveSharedData(sharedKey, JSON.parse(local))
              .then(() => localStorage.removeItem(pendingKey))
              .catch(() => {});
          } catch {}
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchName, selectedMonth]);

  const persist = useCallback((next: FullTimeSalaryRow[]) => {
    setRows(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
    localStorage.setItem(pendingKey, "1");
    const gen = ++autoSaveGenRef.current;
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      gasClient.saveSharedData(sharedKey, next)
        .then(() => { if (autoSaveGenRef.current === gen) localStorage.removeItem(pendingKey); })
        .catch(() => triggerToast("저장 중 부득이한 에러발생", "error"));
    }, 450);
  }, [pendingKey, sharedKey, storageKey, triggerToast]);

  const updateRow = (id: string, field: keyof FullTimeSalaryRow, value: string) => {
    if (isLocked) return;
    const moneyFields = ["prevSalary", "thisSalary", "taxiEtc", "bonusTip", "overtimePay"];
    let nextVal = value;
    if (moneyFields.includes(String(field))) nextVal = cleanNumeric(value);
    else if (field === "residentNumber") nextVal = formatResidentNumber(value); // 13자리 제한 + 하이픈 자동
    persist(rows.map((r) => (r.id === id ? { ...r, [field]: nextVal } : r)));
  };

  const addManualRow = () => {
    if (isLocked) return;
    persist([...rows, {
      id: `ft_manual_${Date.now()}`,
      name: "", rank: "", residentNumber: "", entryDate: "", contractType: "4대보험",
      accountNumber: "", prevSalary: "", thisSalary: "", taxiEtc: "", bonusTip: "", overtimePay: "",
      remitBranch: "", memo: "", isManual: true,
    }]);
  };

  const deleteRow = (id: string) => {
    if (isLocked) return;
    persist(rows.filter((r) => r.id !== id));
  };

  // ---- 합계 ----
  const sum = (f: (r: FullTimeSalaryRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const totThis = sum((r) => num(r.thisSalary));
  const totTaxi = sum((r) => num(r.taxiEtc));
  const totBonus = sum((r) => num(r.bonusTip));
  const totOt = sum((r) => num(r.overtimePay));
  const totAll = sum(rowTotal);

  // ---- 잠금 화면 ----
  if (!unlocked) {
    return (
      <div className="flex flex-col items-center justify-center animate-fade-in min-h-[320px] py-6">
        <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 mb-4">
          <Lock className="w-7 h-7" />
        </div>
        <h3 className="text-sm font-black text-zinc-900">정직원 급여대장 - 보안 잠금</h3>
        <div className="flex items-center gap-2 mt-5">
          <input
            type="password"
            value={passInput}
            onChange={(e) => { setPassInput(e.target.value); setPassError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") tryUnlock(); }}
            placeholder="비밀번호"
            className="p-2.5 px-4 border border-gray-200 rounded-xl text-sm font-bold text-center tracking-widest focus:outline-none focus:border-indigo-500"
            autoFocus
          />
          {passStatus === "error" ? (
            <button
              onClick={loadPasscode}
              className="p-2.5 px-5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-sm font-black flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <ShieldCheck className="w-4 h-4" /> 다시 시도
            </button>
          ) : (
            <button
              onClick={tryUnlock}
              disabled={passStatus !== "ready"}
              className="p-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-black flex items-center gap-1.5 cursor-pointer transition-colors disabled:bg-indigo-300 disabled:cursor-not-allowed"
            >
              <ShieldCheck className="w-4 h-4" /> {passStatus === "ready" ? "열람" : passStatus === "unconfigured" ? "설정 필요" : "불러오는 중"}
            </button>
          )}
        </div>
        {passError
          ? <p className="text-[11px] text-rose-600 font-bold mt-3">{passError}</p>
          : passStatus === "unconfigured"
          ? <p className="text-[11px] text-rose-600 font-bold mt-3">관리자 설정에서 급여대장 열람 비밀번호를 먼저 설정해주세요.</p>
          : passStatus === "error"
          ? <p className="text-[11px] text-rose-600 font-bold mt-3">보안 설정을 서버에서 확인하지 못했습니다. '다시 시도'를 눌러주세요.</p>
          : null}
        <p className="text-[10px] text-gray-300 font-semibold mt-4">비밀번호는 관리자 설정에서 변경할 수 있습니다.</p>
      </div>
    );
  }

  // ---- 급여대장 표 ----
  const cellNum = "w-full p-1.5 border border-gray-200 rounded-lg text-[11px] font-mono font-black text-right focus:outline-none focus:border-indigo-500 disabled:bg-zinc-100 disabled:text-gray-400 disabled:cursor-not-allowed";
  const cellText = "w-full p-1.5 border border-gray-200 rounded-lg text-[11px] font-bold placeholder-gray-300 focus:outline-none focus:border-indigo-500 disabled:bg-zinc-100 disabled:text-gray-400 disabled:cursor-not-allowed";
  const th = "py-3 px-2 text-center font-black";
  // 분류·근로계약·실제송금지점은 화면에서 항상 숨김(엑셀 다운로드에만 포함) — 관리자도 지점과 동일 화면.
  const labelColSpan = 6;
  const trailingColSpan = 2;
  const emptyColSpan = 13;

  return (
    <div className="space-y-5 animate-fade-in" id="fulltime-salary-subtab">
      <div className="flex justify-between items-center pb-3 border-b border-gray-50">
        <div>
          <h3 className="text-sm font-black text-zinc-900 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-indigo-600" />
            정직원 급여대장
          </h3>
          <p className="text-[10px] text-gray-400 font-semibold mt-0.5">
            직원현황의 정직원 이름이 자동으로 채워집니다. 모든 칸은 직접 수정할 수 있고, 명단에 없으면 '직원 추가'로 넣으세요.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={addManualRow}
            disabled={isLocked}
            className="p-1 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-xs font-black flex items-center gap-1 cursor-pointer transition-colors disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" /> 직원 추가
          </button>
          <div className={`p-1 px-3.5 rounded-lg text-xs font-black flex items-center gap-1 ${isLocked ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"}`}>
            <Check className="w-3.5 h-3.5" /> {isLocked ? "확정 잠금" : "자동저장"}
          </div>
        </div>
      </div>

      {isLocked && (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
          마감제출이 확정되어 입력값이 잠겨 있습니다. 수정하려면 마감수정 버튼을 눌러주세요.
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-gray-100">
        <table className="text-left text-[11px] border-collapse font-medium" style={{ minWidth: 1200 }}>
          <thead>
            <tr className="bg-zinc-50 border-b border-gray-100 text-zinc-500 text-[10px] tracking-wider">
              <th className={`${th} w-24`}>성명</th>
              <th className={`${th} w-20`}>직급</th>
              <th className={`${th} w-32`}>주민등록번호</th>
              <th className={`${th} w-28`}>입사일</th>
              <th className={`${th} w-44`}>입금계좌</th>
              <th className={`${th} w-28`}>전월급여</th>
              <th className={`${th} w-28`}>이달급여</th>
              <th className={`${th} w-20`}>택시비 및<br/>기타지출</th>
              <th className={`${th} w-24`}>상여금(팁)</th>
              <th className={`${th} w-24`}>추가근무</th>
              <th className={`${th} w-28 text-indigo-700`}>총 금액</th>
              <th className={`${th} w-40`}>기타내용</th>
              <th className={`${th} w-10`}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={emptyColSpan} className="py-16 text-center text-gray-400">
                  등록된 정직원이 없습니다. 직원현황에 정직원을 등록하거나 '직원 추가'를 눌러주세요.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-indigo-50/20">
                  <td className="px-2 py-1.5"><input type="text" value={row.name} disabled={isLocked} onChange={(e) => updateRow(row.id, "name", e.target.value)} placeholder="성명" className={cellText} /></td>
                  <td className="px-2 py-1.5"><input type="text" value={row.rank} disabled={isLocked} onChange={(e) => updateRow(row.id, "rank", e.target.value)} placeholder="직급" className={cellText} /></td>
                  <td className="px-2 py-1.5"><input type="text" value={row.residentNumber} disabled={isLocked} onChange={(e) => updateRow(row.id, "residentNumber", e.target.value)} placeholder="주민번호" className={`${cellText} font-mono`} /></td>
                  <td className="px-2 py-1.5"><input type="date" value={row.entryDate} disabled={isLocked} onChange={(e) => updateRow(row.id, "entryDate", e.target.value)} className={`${cellText} font-mono`} /></td>
                  <td className="px-2 py-1.5"><input type="text" value={row.accountNumber} disabled={isLocked} onChange={(e) => updateRow(row.id, "accountNumber", e.target.value)} placeholder="은행/계좌번호" className={`${cellText} font-mono`} /></td>
                  <td className="px-2 py-1.5"><input type="text" inputMode="numeric" value={formatWithCommas(row.prevSalary)} disabled={isLocked} onChange={(e) => updateRow(row.id, "prevSalary", e.target.value)} placeholder="0" className={`${cellNum} text-gray-500`} /></td>
                  <td className="px-2 py-1.5"><input type="text" inputMode="numeric" value={formatWithCommas(row.thisSalary)} disabled={isLocked} onChange={(e) => updateRow(row.id, "thisSalary", e.target.value)} placeholder="0" className={cellNum} /></td>
                  <td className="px-2 py-1.5"><input type="text" inputMode="numeric" value={formatWithCommas(row.taxiEtc)} disabled={isLocked} onChange={(e) => updateRow(row.id, "taxiEtc", e.target.value)} placeholder="0" className={cellNum} /></td>
                  <td className="px-2 py-1.5"><input type="text" inputMode="numeric" value={formatWithCommas(row.bonusTip)} disabled={isLocked} onChange={(e) => updateRow(row.id, "bonusTip", e.target.value)} placeholder="0" className={cellNum} /></td>
                  <td className="px-2 py-1.5"><input type="text" inputMode="numeric" value={formatWithCommas(row.overtimePay)} disabled={isLocked} onChange={(e) => updateRow(row.id, "overtimePay", e.target.value)} placeholder="0" className={cellNum} /></td>
                  <td className="px-2 py-1.5 text-right font-mono font-black text-indigo-700">{formatNumber(rowTotal(row))}</td>
                  <td className="px-2 py-1.5"><input type="text" value={row.memo} disabled={isLocked} onChange={(e) => updateRow(row.id, "memo", e.target.value)} placeholder="비고" className={cellText} /></td>
                  <td className="px-2 py-1.5 text-center">
                    <button onClick={() => deleteRow(row.id)} disabled={isLocked} className="text-gray-400 hover:text-rose-600 p-1.5 rounded-lg transition-colors cursor-pointer disabled:text-gray-200 disabled:cursor-not-allowed" title="행 삭제">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-indigo-50/60 border-t-2 border-indigo-100 font-black text-indigo-900">
                <td className="px-2 py-2.5 text-center" colSpan={labelColSpan}>합계</td>
                <td className="px-2 py-2.5 text-right font-mono">{formatNumber(totThis)}</td>
                <td className="px-2 py-2.5 text-right font-mono">{formatNumber(totTaxi)}</td>
                <td className="px-2 py-2.5 text-right font-mono">{formatNumber(totBonus)}</td>
                <td className="px-2 py-2.5 text-right font-mono">{formatNumber(totOt)}</td>
                <td className="px-2 py-2.5 text-right font-mono text-indigo-700">{formatNumber(totAll)}</td>
                <td className="px-2 py-2.5" colSpan={trailingColSpan}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
