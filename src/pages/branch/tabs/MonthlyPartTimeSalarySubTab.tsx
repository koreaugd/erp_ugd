// src/pages/branch/tabs/MonthlyPartTimeSalarySubTab.tsx  (BranchConfirmPage에서 분리 — 동작 변경 없음)
import { useState, useEffect, useCallback, useRef } from "react";
import { Check, Trash2 } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import { SheetKeyHint } from "../../../components/SheetKeyHint";
import { formatNumber } from "../../../utils/formatNumber";
import { cleanNumeric, formatWithCommas, toDateInputValue } from "../helpers/formatters";
import { pendingLocalSaveStorageKey } from "../helpers/staffHelpers";
import { useSheetKeyboardNav } from "../helpers/useSheetKeyboardNav";

// 표에 보이는 순서 그대로의 셀 좌표. 성명(0)·기본급여(8)·제외버튼(11)은 입력 칸이 아니라 커서가 서지 않는다.
const COL_RESIDENT = 1;
const COL_ENTRY_DATE = 2;
const COL_BANK = 3;
const COL_ACCOUNT = 4;
const COL_HOURLY_RATE = 5;
const COL_HOURS = 6;
const COL_TIPS = 7;
const COL_ATTENDANCE = 9;
const COL_MEMO = 10;
const PARTTIME_COL_COUNT = 12;

interface PartTimeSalaryRow {
  employeeId: string;
  name: string;
  residentNumber: string;
  entryDate: string;
  contractStatus: "완료" | "미작성";
  bank: string;
  accountNumber: string;
  hourlyRate: string;
  accumulatedHours: string;
  tipsEtcAmount: string;
  calculatedSalary: string;
  attendanceDates: string;
  actualPaidAmount: string;
  payoutBranch: string;
  memo: string;
}

export function MonthlyPartTimeSalarySubTab({
  branchName,
  selectedMonth,
  history,
  triggerToast
}: {
  branchName: string;
  selectedMonth: string;
  history: any[];
  triggerToast: (msg: string, type?: "success" | "error") => void;
}) {
  const [salaries, setSalaries] = useState<PartTimeSalaryRow[]>([]);
  const [excludedEmployeeIds, setExcludedEmployeeIds] = useState<string[]>([]);
  const salaryAutoSaveTimerRef = useRef<number | null>(null);

  const salaryStorageKey = `erp_monthly_part_time_salary_${branchName}_${selectedMonth}`;
  const salaryDataKey = `part_time_salaries:${branchName}:${selectedMonth}`;
  const exclusionStorageKey = `erp_monthly_part_time_exclusions_${branchName}_${selectedMonth}`;
  const exclusionDataKey = `part_time_salary_exclusions:${branchName}:${selectedMonth}`;
  const salaryPendingKey = pendingLocalSaveStorageKey(salaryStorageKey);
  const exclusionPendingKey = pendingLocalSaveStorageKey(exclusionStorageKey);

  const buildPartTimeProfiles = useCallback((sourceSalaries: PartTimeSalaryRow[]) => {
    return sourceSalaries.reduce((result: Record<string, any>, sal) => {
      result[sal.employeeId] = {
        residentNumber: sal.residentNumber,
        entryDate: sal.entryDate,
        contractStatus: sal.contractStatus,
        bank: sal.bank,
        accountNumber: sal.accountNumber,
        hourlyRate: sal.hourlyRate
      };
      return result;
    }, {});
  }, []);

  const persistPartTimeSalaries = useCallback((nextSalaries: PartTimeSalaryRow[], nextExcluded = excludedEmployeeIds, showToast = false) => {
    setSalaries(nextSalaries);
    nextSalaries.forEach((sal) => {
      localStorage.setItem(`erp_pt_profile_${branchName}_${sal.employeeId}`, JSON.stringify({
        residentNumber: sal.residentNumber,
        entryDate: sal.entryDate,
        contractStatus: sal.contractStatus,
        bank: sal.bank,
        accountNumber: sal.accountNumber,
        hourlyRate: sal.hourlyRate
      }));
    });
    localStorage.setItem(salaryStorageKey, JSON.stringify(nextSalaries));
    localStorage.setItem(exclusionStorageKey, JSON.stringify(nextExcluded));
    localStorage.setItem(salaryPendingKey, "1");
    localStorage.setItem(exclusionPendingKey, "1");
    if (salaryAutoSaveTimerRef.current) window.clearTimeout(salaryAutoSaveTimerRef.current);
    salaryAutoSaveTimerRef.current = window.setTimeout(() => {
      Promise.all([
        gasClient.saveSharedData(salaryDataKey, nextSalaries),
        gasClient.saveSharedData(`part_time_profiles:${branchName}`, buildPartTimeProfiles(nextSalaries)),
        gasClient.saveSharedData(exclusionDataKey, nextExcluded)
      ])
        .then(() => {
          localStorage.removeItem(salaryPendingKey);
          localStorage.removeItem(exclusionPendingKey);
          if (showToast) triggerToast("파트타이머 급여대장이 저장되었습니다.", "success");
        })
        .catch(() => triggerToast("급여지급 대장 자동저장 실패", "error"));
    }, 500);
  }, [branchName, buildPartTimeProfiles, excludedEmployeeIds, exclusionDataKey, exclusionPendingKey, exclusionStorageKey, salaryDataKey, salaryPendingKey, salaryStorageKey, triggerToast]);

  useEffect(() => {
    return () => {
      if (salaryAutoSaveTimerRef.current) {
        window.clearTimeout(salaryAutoSaveTimerRef.current);
        salaryAutoSaveTimerRef.current = null;
      }
      const salaryPending = localStorage.getItem(salaryPendingKey) === "1";
      const exclusionPending = localStorage.getItem(exclusionPendingKey) === "1";
      if (!salaryPending && !exclusionPending) return;

      const savedSalaries = localStorage.getItem(salaryStorageKey);
      const savedExclusions = localStorage.getItem(exclusionStorageKey);
      try {
        const pendingSalaries = savedSalaries ? JSON.parse(savedSalaries) : [];
        const pendingExclusions = savedExclusions ? JSON.parse(savedExclusions) : [];
        const saveTasks: Promise<{ success: boolean }>[] = [];
        if (salaryPending && Array.isArray(pendingSalaries)) {
          saveTasks.push(gasClient.saveSharedData(salaryDataKey, pendingSalaries));
          saveTasks.push(gasClient.saveSharedData(`part_time_profiles:${branchName}`, buildPartTimeProfiles(pendingSalaries)));
        }
        if (exclusionPending && Array.isArray(pendingExclusions)) {
          saveTasks.push(gasClient.saveSharedData(exclusionDataKey, pendingExclusions));
        }
        void Promise.all(saveTasks)
          .then(() => {
            if (salaryPending) localStorage.removeItem(salaryPendingKey);
            if (exclusionPending) localStorage.removeItem(exclusionPendingKey);
          })
          .catch((error) => {
            console.warn("Pending part-time salary save failed during tab change.", error);
          });
      } catch (error) {
        console.warn("Pending part-time salary data could not be parsed during tab change.", error);
      }
    };
  }, [branchName, buildPartTimeProfiles, exclusionDataKey, exclusionPendingKey, exclusionStorageKey, salaryDataKey, salaryPendingKey, salaryStorageKey]);

  useEffect(() => {
    let active = true;
    const loadExclusions = async () => {
      try {
        const local = localStorage.getItem(exclusionStorageKey);
        const hasPendingExclusions = localStorage.getItem(exclusionPendingKey) === "1";
        if (local && active) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed)) setExcludedEmployeeIds(parsed);
          if (hasPendingExclusions) {
            await gasClient.saveSharedData(exclusionDataKey, parsed);
            localStorage.removeItem(exclusionPendingKey);
            return;
          }
        }

        const remote = await gasClient.getSharedData<string[]>(exclusionDataKey);
        if (active && Array.isArray(remote)) {
          setExcludedEmployeeIds(remote);
          localStorage.setItem(exclusionStorageKey, JSON.stringify(remote));
        }
      } catch (error) {
        console.warn("파트타이머 급여대장 제외 목록을 불러오지 못했습니다.", error);
      }
    };
    loadExclusions();
    return () => { active = false; };
  }, [exclusionDataKey, exclusionPendingKey, exclusionStorageKey]);

  // 1. Fetch current live Roster for PTs and merge with previously saved info + auto computed work logs from history!
  useEffect(() => {
    // A. Retrieve general roster
    let rosterPartTimers: any[] = [];
    try {
      const savedRoster = localStorage.getItem(`erp_staff_list_${branchName}`);
      if (savedRoster) {
        const parsed = JSON.parse(savedRoster);
        rosterPartTimers = parsed.filter((emp: any) => emp.division === "파트타이머");
      }
    } catch (e) {
      console.error("Roster 파악 에러:", e);
    }

    // B. Calculate PT hours & attendance dates from DAILY HISTORY of the selected month
    const ptTelemetry: { [name: string]: { hours: number; dates: string[] } } = {};
    history.forEach((m) => {
      // Check if day belongs toselected month (YYYY-MM-DD startsWith YYYY-MM)
      if (m.settleDate && m.settleDate.startsWith(selectedMonth)) {
        const parts = (m.memo || "").split("\n---\nMETADATA:");
        if (parts[1]) {
          try {
            const meta = JSON.parse(parts[1].trim());
            if (meta && meta.staffRows) {
              meta.staffRows.forEach((s: any) => {
                if (s.division === "파트타이머" && Number(s.workHours || 0) > 0) {
                  if (!ptTelemetry[s.name]) {
                    ptTelemetry[s.name] = { hours: 0, dates: [] };
                  }
                  ptTelemetry[s.name].hours += Number(s.workHours || 0);

                  // Keep only date day integer like "28" or "28"
                  const dateParts = m.settleDate.split("-");
                  const daySuffix = dateParts[2] ? `${Number(dateParts[2])}` : m.settleDate;
                  if (!ptTelemetry[s.name].dates.includes(daySuffix)) {
                    ptTelemetry[s.name].dates.push(daySuffix);
                  }
                }
              });
            }
          } catch {}
        }
      }
    });

    // C. Combine with stored monthly salary configurations for the selected branch/month
    let savedSalaryMap: { [empId: string]: Partial<PartTimeSalaryRow> } = {};
    try {
        const savedConfig = localStorage.getItem(salaryStorageKey);
      if (savedConfig) {
        const list: PartTimeSalaryRow[] = JSON.parse(savedConfig);
        list.forEach((item) => {
          savedSalaryMap[item.employeeId] = item;
        });
      }
    } catch {}

    // D. Fetch profile memory (은행, 주민번호, 입사일 등 매월 반복되는 기초 사원 데이터) to auto-fill across months
    const getStoredProfile = (empId: string): any => {
      try {
        const stored = localStorage.getItem(`erp_pt_profile_${branchName}_${empId}`);
        if (stored) return JSON.parse(stored);
      } catch {}
      return {};
    };

    // E. Assemble all pieces
    const excluded = new Set(excludedEmployeeIds);
    const assembledRows: PartTimeSalaryRow[] = rosterPartTimers
      .filter((pt) => !excluded.has(pt.id))
      .map((pt) => {
      const tel = ptTelemetry[pt.name] || { hours: 0, dates: [] };
      const saved = savedSalaryMap[pt.id] || {};
      const profile = getStoredProfile(pt.id);

      // Default values
      const hourlyRate = saved.hourlyRate || profile.hourlyRate || "15000";
      const tipsEtcAmount = saved.tipsEtcAmount || "0";
      // Cumulative hours synced dynamically unless edited
      const accumulatedHours = saved.accumulatedHours !== undefined
        ? saved.accumulatedHours
        : String(tel.hours);

      const calcSalary = String((Number(hourlyRate) * Number(accumulatedHours)) + (Number(tipsEtcAmount) || 0));
      // Forced empty string per "본사에서 입력해야 하는 칸이라 일단 공란으로 해두고"
      const calcActualPaid = saved.actualPaidAmount || "";

      // Sorted days text - limited to maximum of 7 elements as requested
      const attendanceDates = saved.attendanceDates !== undefined
        ? String(saved.attendanceDates).split(",").map((day) => day.trim()).filter(Boolean).slice(0, 7).join(",")
        : tel.dates.sort((a,b) => Number(a) - Number(b)).slice(0, 7).join(",");

      return {
        employeeId: pt.id,
        name: pt.name,
        residentNumber: saved.residentNumber || profile.residentNumber || pt.residentNumber || "",
        entryDate: saved.entryDate || profile.entryDate || pt.entryDate || "",
        contractStatus: saved.contractStatus || profile.contractStatus || "미작성",
        bank: saved.bank || profile.bank || "",
        accountNumber: saved.accountNumber || profile.accountNumber || "",
        hourlyRate,
        accumulatedHours,
        tipsEtcAmount,
        calculatedSalary: calcSalary,
        attendanceDates,
        actualPaidAmount: calcActualPaid,
        payoutBranch: saved.payoutBranch || branchName,
        memo: saved.memo || ""
      };
      });

    setSalaries(assembledRows);
  }, [branchName, selectedMonth, history, excludedEmployeeIds, salaryStorageKey]);

  useEffect(() => {
    const loadSharedSalaries = async () => {
      try {
        const local = localStorage.getItem(salaryStorageKey);
        if (localStorage.getItem(salaryPendingKey) === "1" && local) {
          const localRows = JSON.parse(local);
          if (Array.isArray(localRows)) {
            const excluded = new Set(excludedEmployeeIds);
            const restoredRows = localRows.filter((salary) => !excluded.has(salary.employeeId)).map((salary) => ({
              ...salary,
              tipsEtcAmount: salary.tipsEtcAmount || "0"
            }));
            setSalaries(restoredRows);
            await gasClient.saveSharedData(salaryDataKey, localRows);
            localStorage.removeItem(salaryPendingKey);
            return;
          }
        }
        const remote = await gasClient.getSharedData<PartTimeSalaryRow[]>(salaryDataKey);
        // 빈 배열은 아직 저장된 급여대장이 없다는 뜻이므로, 일일마감에서 계산한 행을 유지합니다.
        if (Array.isArray(remote) && remote.length > 0) {
          const excluded = new Set(excludedEmployeeIds);
          setSalaries(remote.filter((salary) => !excluded.has(salary.employeeId)).map((salary) => ({
            ...salary,
            tipsEtcAmount: salary.tipsEtcAmount || "0"
          })));
        }
      } catch (error) {
        console.warn("파트타이머 급여 공통 데이터를 불러오지 못했습니다.", error);
      }
    };
    loadSharedSalaries();
  }, [excludedEmployeeIds, salaryDataKey, salaryPendingKey, salaryStorageKey]);

  useEffect(() => {
    const loadSharedProfiles = async () => {
      try {
        const profiles = await gasClient.getSharedData<Record<string, any>>(`part_time_profiles:${branchName}`);
      if (!profiles || localStorage.getItem(salaryPendingKey) === "1") return;
        Object.entries(profiles).forEach(([employeeId, profile]) => {
          localStorage.setItem(`erp_pt_profile_${branchName}_${employeeId}`, JSON.stringify(profile));
        });
        setSalaries((current) => current.map((salary) => {
          const profile = profiles[salary.employeeId];
          return profile ? {
            ...salary,
            residentNumber: salary.residentNumber || profile.residentNumber || "",
            entryDate: salary.entryDate || profile.entryDate || "",
            contractStatus: salary.contractStatus || profile.contractStatus || salary.contractStatus,
            bank: salary.bank || profile.bank || "",
            accountNumber: salary.accountNumber || profile.accountNumber || "",
            hourlyRate: salary.hourlyRate || profile.hourlyRate || salary.hourlyRate
          } : salary;
        }));
      } catch (error) {
        console.warn("파트타이머 프로필 공통 데이터를 불러오지 못했습니다.", error);
      }
    };
    loadSharedProfiles();
  }, [branchName, salaryPendingKey]);

  // 다른 기기에서도 공통 직원현황을 기준으로 파트타이머 행을 생성합니다.
  useEffect(() => {
    const mergeRemotePartTimers = async () => {
      try {
        const roster = await gasClient.getBranchOwnRoster(branchName);
        const partTimers = roster.filter((employee) => employee.division === "파트타이머");
        if (partTimers.length === 0) return;

        const telemetry: Record<string, { hours: number; dates: string[] }> = {};
        history.filter((record) => record.settleDate?.startsWith(selectedMonth)).forEach((record) => {
          const metadata = String(record.memo || "").split("\n---\nMETADATA:")[1];
          if (!metadata) return;
          try {
            JSON.parse(metadata).staffRows?.forEach((staff: any) => {
              if (staff.division !== "파트타이머" || !staff.name || Number(staff.workHours || 0) <= 0) return;
              const item = telemetry[staff.name] || { hours: 0, dates: [] };
              item.hours += Number(staff.workHours || 0);
              const day = String(record.settleDate).split("-")[2];
              if (day && !item.dates.includes(day)) item.dates.push(day);
              telemetry[staff.name] = item;
            });
          } catch {}
        });

        // 기존 파트타이머 일지에만 있는 직원도 급여대장에 포함합니다.
        // 직원현황에 등록되지 않은 과거 기록은 이름 기반 임시 ID를 사용합니다.
        const allPartTimers = [...partTimers];
        const rosterNames = new Set(allPartTimers.map((employee) => employee.name));
        Object.keys(telemetry).forEach((name) => {
          if (!rosterNames.has(name)) {
            allPartTimers.push({
              id: `legacy-${branchName}-${name}`,
              name,
              division: "파트타이머"
            });
          }
        });

        setSalaries((current) => {
          const byEmployeeId = new Map<string, PartTimeSalaryRow>(current.map((salary) => [salary.employeeId, salary]));
          const excluded = new Set(excludedEmployeeIds);
          return allPartTimers.filter((employee) => !excluded.has(employee.id)).map((employee) => {
            const existing = byEmployeeId.get(employee.id);
            const work = telemetry[employee.name] || { hours: 0, dates: [] };
            const attendanceDates = work.dates.sort((a, b) => Number(a) - Number(b)).slice(0, 7).map((day) => String(Number(day))).join(",");
            if (existing) {
              const accumulatedHours = existing.accumulatedHours !== undefined && existing.accumulatedHours !== ""
                ? existing.accumulatedHours
                : String(work.hours);
              const calculatedSalary = existing.calculatedSalary !== undefined && existing.calculatedSalary !== ""
                ? existing.calculatedSalary
                : String(((Number(existing.hourlyRate) || 0) * Number(accumulatedHours || 0)) + (Number(existing.tipsEtcAmount) || 0));
              return {
                ...existing,
                residentNumber: existing.residentNumber || employee.residentNumber || "",
                entryDate: existing.entryDate || employee.entryDate || "",
                contractStatus: existing.contractStatus || (employee as any).contractStatus || existing.contractStatus,
                accumulatedHours,
                tipsEtcAmount: existing.tipsEtcAmount || "0",
                attendanceDates: existing.attendanceDates || attendanceDates,
                calculatedSalary
              };
            }
            const hourlyRate = "15000";
            return {
              employeeId: employee.id,
              name: employee.name,
              residentNumber: employee.residentNumber || "",
              entryDate: employee.entryDate || "",
              contractStatus: "미작성",
              bank: "",
              accountNumber: "",
              hourlyRate,
              accumulatedHours: String(work.hours),
              tipsEtcAmount: "0",
              calculatedSalary: String(Number(hourlyRate) * work.hours),
              attendanceDates,
              actualPaidAmount: "",
              payoutBranch: branchName,
              memo: ""
            } as PartTimeSalaryRow;
          });
        });
      } catch (error) {
        console.warn("공통 파트타이머 명단을 불러오지 못했습니다.", error);
      }
    };
    mergeRemotePartTimers();
  }, [branchName, selectedMonth, history, excludedEmployeeIds]);

  const handleUpdate = (empId: string, field: keyof PartTimeSalaryRow, value: any) => {
    const nextSalaries = salaries.map(item => {
      if (item.employeeId !== empId) return item;
      const nextValue = field === "tipsEtcAmount" ? cleanNumeric(String(value || "")) : value;
      const updated = { ...item, [field]: nextValue };
      // Recalculate salary if wage or code changes
      if (field === "hourlyRate" || field === "accumulatedHours" || field === "tipsEtcAmount") {
        const wage = Number(updated.hourlyRate) || 0;
        const hrs = Number(updated.accumulatedHours) || 0;
        const tips = Number(updated.tipsEtcAmount) || 0;
        updated.calculatedSalary = String((wage * hrs) + tips);
        updated.actualPaidAmount = String((wage * hrs) + tips); // Pre-fill with normal calculation
      }
      return updated;
    });
    persistPartTimeSalaries(nextSalaries);
  };

  const handleExcludeEmployee = (employee: PartTimeSalaryRow) => {
    if (!window.confirm(`${employee.name} 님을 이번 달 파트타이머 급여대장에서 제외할까요?\n직원현황과 일일마감 근무기록은 삭제되지 않습니다.`)) return;

    const nextSalaries = salaries.filter((salary) => salary.employeeId !== employee.employeeId);
    const nextExcluded = excludedEmployeeIds.includes(employee.employeeId)
      ? excludedEmployeeIds
      : [...excludedEmployeeIds, employee.employeeId];
    setExcludedEmployeeIds(nextExcluded);
    persistPartTimeSalaries(nextSalaries, nextExcluded, true);
    triggerToast(`${employee.name} 님을 이번 달 급여대장에서 제외했습니다.`);
  };

  // Grand totals
  // 실제 근무시간이 없는 인원은 이번 달 급여대장에 표시하지 않습니다.
  const visibleSalaries = salaries.filter((salary) => Number(salary.accumulatedHours) > 0);
  const totalHours = visibleSalaries.reduce((acc, s) => acc + (Number(s.accumulatedHours) || 0), 0);
  const totalSalary = visibleSalaries.reduce((acc, s) => acc + (Number(s.calculatedSalary) || 0), 0);

  // 엑셀처럼 키보드로 칸을 옮긴다. 행은 명부에서 오므로 행 추가는 없다(onAppendRow 없음).
  const { cellProps, isActive } = useSheetKeyboardNav({
    rowCount: visibleSalaries.length,
    colCount: PARTTIME_COL_COUNT
  });

  // 엑셀 셀: 격자선은 td가 긋고, 현재 칸은 굵은 테두리로 짚어준다.
  const cellTd = (rowIndex: number, col: number, extra = "") =>
    [
      "border-r border-b border-black/10 p-0 relative",
      isActive(rowIndex, col) ? "outline outline-2 -outline-offset-2 outline-[#2E6DB4] z-10" : "",
      extra
    ].join(" ");
  // sheet-cell-input: index.css에서 전역 input 배경/테두리 !important를 ID 특이성으로 되돌리는 클래스.
  const cellInput = "sheet-cell-input w-full h-9 px-2 text-xs focus:outline-none";

  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5 animate-fade-in" id="parttime-salaries-subtab">
      <div className="flex justify-between items-center pb-3 border-b border-gray-50 flex-col sm:flex-row gap-3">
        <div>
          <h3 className="text-sm font-black text-zinc-900 leading-snug w-fit">
            파트타이머 급여대장
          </h3>
          <p className="text-[10px] text-gray-400 font-extrabold mt-1">
             직원현황의 파트타이머 리스트가 자동으로 연동되고, 이번 달 일일 일지에서 실시간 근무시간과 출근일이 집계되어 프리필링됩니다.
          </p>
        </div>

        <div className="w-full sm:w-auto px-5 py-3 bg-emerald-50 text-emerald-700 rounded-xl text-sm font-black flex items-center justify-center gap-2 shadow-sm">
          <Check className="w-4 h-4" />
          자동저장
        </div>
      </div>

      {/* 요약 — 숫자 세 개뿐이다. 카드 두 장으로 나눠 키우면 표를 밀어낼 뿐이라 한 줄로 붙인다. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2">
        <span className="text-[11px] font-black text-zinc-500">
          누적근무 <b className="ml-1 font-mono text-sm text-zinc-800">{totalHours} hr</b>
        </span>
        <span className="text-[11px] font-black text-zinc-500">
          급여합계(세전) <b className="ml-1 font-mono text-sm text-[#2E6DB4]">{formatNumber(totalSalary)} 원</b>
        </span>
        <span className="text-[11px] font-black text-zinc-500">
          인원 <b className="ml-1 font-mono text-sm text-zinc-800">{visibleSalaries.length} 명</b>
        </span>
        <span className="ml-auto text-[10px] font-bold text-zinc-400">100% 자동 산정</span>
      </div>

      {/* Ledger Table */}
      {/* 표가 가로 스크롤(overflow)이라 칩은 바깥 relative 층에 얹는다. */}
      <div className="relative">
      <SheetKeyHint />
      <div className="overflow-x-auto rounded-2xl border border-gray-100 shadow-xs">
        <table className="w-full text-left text-xs border-collapse font-medium min-w-[1330px]">
          <thead>
            <tr className="bg-zinc-50 border-b border-gray-100 text-zinc-550 font-black text-[9px] tracking-wider uppercase">
              <th className="py-3 px-3 w-20 whitespace-nowrap">성명 (사원)</th>
              <th className="py-3 px-3 w-32 whitespace-nowrap">주민등록번호</th>
              <th className="py-3 px-2 w-28 whitespace-nowrap">입사일자</th>
              <th className="py-3 px-3 w-20 whitespace-nowrap">은행</th>
              <th className="py-3 px-3 w-32 whitespace-nowrap">입금 계좌번호</th>
              <th className="py-3 px-3 w-20 text-right whitespace-nowrap">시급 (원)</th>
              <th className="py-3 px-2 w-16 text-right whitespace-nowrap">누적시간</th>
              <th className="py-3 px-2 w-20 text-right whitespace-nowrap">팁/기타</th>
              <th className="py-3 px-3 w-24 text-right whitespace-nowrap">기본급여</th>
              <th className="py-3 px-3 w-28 whitespace-nowrap">근무일정 (출근일)</th>
              <th className="py-3 px-3 w-[260px] whitespace-nowrap">기타 비고 내용 (퇴사일 등)</th>
              <th className="py-3 px-3 w-20 text-center whitespace-nowrap">제외</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-[10px] font-sans">
            {visibleSalaries.length === 0 ? (
              <tr>
                <td colSpan={12} className="py-16 text-center text-gray-400 font-bold">
                  이번 달 근무시간이 기록된 파트타이머가 없습니다.
                </td>
              </tr>
            ) : (
              visibleSalaries.map((sal, rowIndex) => (
                <tr key={sal.employeeId} className="hover:bg-zinc-50/40">
                  <td className="border-r border-b border-black/10 py-3 px-3 font-extrabold text-zinc-900 text-xs whitespace-nowrap">
                    {sal.name}
                  </td>
                  <td className={cellTd(rowIndex, COL_RESIDENT)}>
                    <input
                      {...cellProps(rowIndex, COL_RESIDENT)}
                      aria-label={`${sal.name} 주민등록번호`}
                      type="text"
                      value={sal.residentNumber}
                      onChange={(e) => handleUpdate(sal.employeeId, "residentNumber", e.target.value)}
                      className={`${cellInput} font-mono font-bold text-gray-800 tracking-tighter text-center`}
                    />
                  </td>
                  <td className={cellTd(rowIndex, COL_ENTRY_DATE)}>
                    <input
                      {...cellProps(rowIndex, COL_ENTRY_DATE)}
                      aria-label={`${sal.name} 입사일자`}
                      type="date"
                      value={toDateInputValue(sal.entryDate)}
                      onChange={(e) => handleUpdate(sal.employeeId, "entryDate", e.target.value)}
                      className={`${cellInput} text-gray-800 text-center`}
                    />
                  </td>
                  <td className={cellTd(rowIndex, COL_BANK)}>
                    <input
                      {...cellProps(rowIndex, COL_BANK)}
                      aria-label={`${sal.name} 은행`}
                      type="text"
                      value={sal.bank}
                      onChange={(e) => handleUpdate(sal.employeeId, "bank", e.target.value)}
                      className={`${cellInput} font-bold text-gray-800 text-center`}
                    />
                  </td>
                  <td className={cellTd(rowIndex, COL_ACCOUNT)}>
                    <input
                      {...cellProps(rowIndex, COL_ACCOUNT)}
                      aria-label={`${sal.name} 입금 계좌번호`}
                      type="text"
                      value={sal.accountNumber}
                      onChange={(e) => handleUpdate(sal.employeeId, "accountNumber", e.target.value)}
                      className={`${cellInput} font-mono font-medium text-gray-850`}
                    />
                  </td>
                  <td className={cellTd(rowIndex, COL_HOURLY_RATE)}>
                    <input
                      {...cellProps(rowIndex, COL_HOURLY_RATE)}
                      aria-label={`${sal.name} 시급`}
                      type="number"
                      value={sal.hourlyRate}
                      onChange={(e) => handleUpdate(sal.employeeId, "hourlyRate", e.target.value)}
                      className={`${cellInput} font-mono font-black text-right text-gray-800`}
                    />
                  </td>
                  <td className={cellTd(rowIndex, COL_HOURS)}>
                    <input
                      {...cellProps(rowIndex, COL_HOURS)}
                      aria-label={`${sal.name} 누적시간`}
                      type="number"
                      value={sal.accumulatedHours}
                      onChange={(e) => handleUpdate(sal.employeeId, "accumulatedHours", e.target.value)}
                      className={`${cellInput} font-mono font-black text-right text-blue-600`}
                    />
                  </td>
                  <td className={cellTd(rowIndex, COL_TIPS)}>
                    <input
                      {...cellProps(rowIndex, COL_TIPS)}
                      aria-label={`${sal.name} 팁/기타`}
                      type="text"
                      inputMode="numeric"
                      value={formatWithCommas(sal.tipsEtcAmount || "")}
                      onChange={(e) => handleUpdate(sal.employeeId, "tipsEtcAmount", e.target.value)}
                      placeholder="0"
                      className={`${cellInput} font-mono font-black text-right text-emerald-700`}
                    />
                  </td>
                  <td className="border-r border-b border-black/10 py-2.5 px-1.5 text-right font-mono font-black text-gray-700">
                    {formatNumber(Number(sal.calculatedSalary) || 0)}원
                  </td>
                  <td className={cellTd(rowIndex, COL_ATTENDANCE)}>
                    <input
                      {...cellProps(rowIndex, COL_ATTENDANCE)}
                      aria-label={`${sal.name} 근무일정`}
                      type="text"
                      value={sal.attendanceDates}
                      onChange={(e) => handleUpdate(sal.employeeId, "attendanceDates", e.target.value)}
                      className={`${cellInput} text-[10px] font-mono text-zinc-600 truncate`}
                      title={sal.attendanceDates}
                    />
                  </td>
                  <td className={cellTd(rowIndex, COL_MEMO, "min-w-[260px]")}>
                    <input
                      {...cellProps(rowIndex, COL_MEMO)}
                      aria-label={`${sal.name} 기타 비고`}
                      type="text"
                      value={sal.memo}
                      onChange={(e) => handleUpdate(sal.employeeId, "memo", e.target.value)}
                      className={`${cellInput} font-medium placeholder-gray-300`}
                    />
                  </td>
                  <td className="border-b border-black/10 py-2.5 px-2 text-center">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => handleExcludeEmployee(sal)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] font-bold text-rose-600 transition-colors hover:bg-rose-100"
                      title="이번 달 파트타이머 급여대장에서만 제외"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      제외
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
}
