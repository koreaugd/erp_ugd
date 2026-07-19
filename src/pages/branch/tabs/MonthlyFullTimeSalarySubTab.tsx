// src/pages/branch/tabs/MonthlyFullTimeSalarySubTab.tsx
// 월말마감정산 - 정직원 급여대장 탭 (비밀번호 잠금 + 직원현황 자동연동, 전 컬럼 수정 가능)
import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Lock, Check, ShieldCheck, X } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import { SheetKeyHint } from "../../../components/SheetKeyHint";
import { formatNumber } from "../../../utils/formatNumber";
import { addMonthsToMonthInputValue, cleanNumeric, formatResidentNumber, formatWithCommas } from "../helpers/formatters";
import { pendingLocalSaveStorageKey, readLocalStaffList } from "../helpers/staffHelpers";
import { useSheetKeyboardNav } from "../helpers/useSheetKeyboardNav";

interface FullTimeSalaryRow {
  id: string;
  employeeId?: string;
  name: string;
  rank: string;
  residentNumber: string;
  entryDate: string;
  contractType: string;
  bank: string;           // 은행명(국민은행 등)
  accountNumber: string;  // 계좌번호(숫자만 저장)
  prevSalary: string;
  thisSalary: string;
  taxiEtc: string;
  bonusTip: string;
  overtimePay: string;   // 옛 '추가근무' 금액(레거시). 신규는 시간×시급으로 계산하며 이 필드에 저장하지 않는다.
  overtimeHours: string; // 연장 근무시간(소수 허용)
  overtimeRate: string;  // 연장 시급(원)
  remitBranch: string;
  memo: string;
  isManual?: boolean;
}

// 잠금 해제 상태(모듈 전역). 급여대장 탭을 떠나면(언마운트) / 화면이 오래 숨겨졌다 열리면 아래 effect가 false로 되돌려 재잠금한다.
let fullTimeSalaryUnlocked = false;


const num = (v: string) => Number(cleanNumeric(String(v || ""))) || 0;
// 연장근무 '시간'은 소수(예: 2.5)를 허용하므로 cleanNumeric(정수화) 대신 소수점 하나만 남긴다.
const otNum = (v: string) => Number(String(v ?? "").replace(/[^0-9.]/g, "")) || 0;
const cleanHours = (v: string) => {
  const s = String(v ?? "").replace(/[^0-9.]/g, "");
  const i = s.indexOf(".");
  return i === -1 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "");
};
// 드롭다운 표준 목록. 목록에 없는 레거시 값은 각 행에서 옵션으로 함께 넣어(정규화하지 않음) 값이 사라지지 않게 한다.
// 근로계약도 같은 규칙 — 옛 자유입력값("프리랜서" 등)을 강제로 4대보험으로 바꾸면 실제와 다른 값이 급여 엑셀에 나간다.
const RANK_OPTIONS = ["사원", "대리", "과장", "차장", "실장", "부장", "이사"];
const CONTRACT_OPTIONS = ["4대보험", "3.3%"];

// 레거시 '입금계좌' 한 칸에 은행명+계좌가 함께 적힌 값("국민 123-456")을 은행/계좌 두 칸으로 분리한다.
// 로드·병합 시 한 번 실행돼 화면·저장·엑셀이 같은 값을 본다. 은행 칸에 이미 값이 있으면 건드리지 않는다.
// 분리하지 않고 두면, 계좌번호 칸을 한 글자만 수정해도 입력 필터(숫자·하이픈만)가 은행명을 지워 영구 소실된다.
const splitLegacyAccount = (r: FullTimeSalaryRow): FullTimeSalaryRow => {
  const acc = String(r.accountNumber || "");
  if (r.bank || !/[^\d\- ]/.test(acc)) return r; // 은행이 이미 있거나, 계좌에 문자가 없으면 그대로
  const bank = acc.replace(/[0-9\-./() ]/g, "").trim();
  const number = acc.replace(/[^0-9-]/g, "");
  return bank ? { ...r, bank, accountNumber: number } : r;
};
// 연장근무 계 = 근무시간 × 시급(원, 반올림). 이 값이 총금액에 합산된다.
// 반드시 시간·시급이 '둘 다' 있을 때만 계산값을 쓴다. 한쪽만 입력됐을 땐 옛 '추가근무' 금액(overtimePay)을 보존한다
//   → 개편 전에 적어둔 초과근무수당이, 시간/시급 한쪽만 건드리는 순간 0으로 덮여 사라지는 사고를 막는다.
// 계는 어디서도 overtimePay에 동기화 저장하지 않는다(화면·합계·엑셀 모두 이 함수로 그때그때 계산).
const rowOvertimePay = (r: FullTimeSalaryRow) =>
  (otNum(r.overtimeHours) > 0 && num(r.overtimeRate) > 0)
    ? Math.round(otNum(r.overtimeHours) * num(r.overtimeRate))
    : num(r.overtimePay);
const rowTotal = (r: FullTimeSalaryRow) => num(r.thisSalary) + num(r.taxiEtc) + num(r.bonusTip) + rowOvertimePay(r);

const rosterToRow = (emp: any): FullTimeSalaryRow => ({
  id: `ft_${emp.id || emp.name}`,
  employeeId: emp.id || undefined,
  name: emp.name || "",
  rank: emp.rank || emp.customRank || "",
  residentNumber: emp.residentNumber || "",
  entryDate: emp.entryDate || emp.hireDate || "",
  contractType: emp.contractType || "4대보험",
  bank: emp.bank || "",
  accountNumber: "",
  prevSalary: "",
  thisSalary: "",
  taxiEtc: "",
  bonusTip: "",
  overtimePay: "",
  overtimeHours: "",
  overtimeRate: "",
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
  // 연장근무 계 = 시간×시급(둘 다 있을 때). 없으면 옛 '추가근무' 금액. 화면 rowOvertimePay와 같은 규칙.
  const otPay = (r: FullTimeSalaryRow) => {
    const h = Number(String(r.overtimeHours ?? "").replace(/[^0-9.]/g, "")) || 0;
    const rate = money(r.overtimeRate);
    return (h > 0 && rate > 0) ? Math.round(h * rate) : money(r.overtimePay);
  };
  // 실 데이터 판정: 실제 급여 금액이 입력된 행이 하나라도 있어야 한다.
  // (로스터 자동생성 행은 이름만 있고 금액이 0이므로 제외된다)
  const hasMeaningful = (rows: FullTimeSalaryRow[] | null) =>
    Array.isArray(rows) && rows.some((r) => money(r.thisSalary) + money(r.taxiEtc) + money(r.bonusTip) + otPay(r) > 0);
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

  // 보안 재잠금: (1) 급여대장 탭을 떠나면(언마운트) 다시 잠근다. (2) 화면이 1분 이상 숨겨졌다 다시 열리면
  //   (노트북을 닫았다 다른 사람이 여는 경우 등) 다시 잠근다. 잠깐 alt-tab에는 잠기지 않는다.
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > 60000) {
        fullTimeSalaryUnlocked = false;
        setUnlocked(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      fullTimeSalaryUnlocked = false; // 탭을 떠나면 재잠금
    };
  }, []);

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
  // 초과근무일지 집계(읽기 전용 참고용). null=불러오는 중.
  // (작성방법 버튼·말풍선은 MonthlySettleTab이 탭 최상단에서 연다 — 다른 탭들과 버튼 위치를 맞추기 위해서다)
  const [otSummary, setOtSummary] = useState<Array<{ name: string; hours: number }> | null>(null);
  const [otError, setOtError] = useState(false);
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
        return splitLegacyAccount({
          ...base,
          name: prior.name || base.name,
          rank: prior.rank || base.rank,
          residentNumber: prior.residentNumber || base.residentNumber,
          entryDate: prior.entryDate || base.entryDate,
          contractType: prior.contractType || base.contractType,
          bank: prior.bank || "",
          accountNumber: prior.accountNumber || "",
          prevSalary: prior.prevSalary || "",
          thisSalary: prior.thisSalary || "",
          taxiEtc: prior.taxiEtc || "",
          bonusTip: prior.bonusTip || "",
          overtimePay: prior.overtimePay || "",
          overtimeHours: prior.overtimeHours || "",
          overtimeRate: prior.overtimeRate || "",
          remitBranch: prior.remitBranch || "",
          memo: prior.memo || "",
        });
      }
      return base;
    });
    // 로스터가 비었거나 불완전해도 저장된 급여 행은 모두 보존한다.
    // 개편 전 저장분에는 연장근무 시간/시급 필드가 없으므로 기본값("")을 채워 controlled input을 보장한다.
    const leftover = saved.filter((r) => !consumed.has(r)).map((r) => splitLegacyAccount({
      ...r,
      bank: r.bank || "",
      overtimePay: r.overtimePay || "",
      overtimeHours: r.overtimeHours || "",
      overtimeRate: r.overtimeRate || "",
    }));
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

  // 초과근무일지(자동 기록 + 수기 대장)에서 이번 달 직원별 초과시간을 읽어와 참고용으로만 보여준다.
  // 급여 행에 자동으로 넣지 않는다 — 초과근무를 당월 급여 대신 휴무로 받는 직원이 있어,
  // 지급 대상만 지점이 직접 연장근무 '근무시간' 칸에 옮겨 적는다(읽기 전용이라 저장 경로도 오염되지 않는다).
  useEffect(() => {
    let cancelled = false;
    setOtSummary(null);
    setOtError(false);
    (async () => {
      try {
        // 급여 입력의 참고값이므로 캐시 폴백을 쓰지 않는다 — 서버 실패가 오래된 캐시로 둔갑해
        // '정상 집계'처럼 보이면 stale 숫자를 보고 급여를 적게 된다. 실패는 아래 catch에서 실패라고 말한다.
        const [otLog, otManual] = await Promise.all([
          gasClient.getAttendanceLog(branchName, "overtime", selectedMonth, true, true) as Promise<any>, // serverOnly — 캐시 폴백 금지
          gasClient.getSharedDataFromServer<any[]>(`manual_overtime:${branchName}`),
        ]);
        // sum과 별개로 '0이 아닌 기록이 있었는가'를 남긴다 — 전월 +5h·이번달 -5h처럼 누적이 0으로 상쇄된
        // 직원도 일지 탭 집계에는 '총 0h'로 보이므로, 칩에서도 숨기지 않아야 두 화면이 일치한다.
        const perName = new Map<string, { sum: number; hadNonzero: boolean }>();
        const add = (nm: unknown, h: unknown) => {
          const key = String(nm ?? "").trim();
          if (!key) return;
          const v = Number(h) || 0;
          const cur = perName.get(key) || { sum: 0, hadNonzero: false };
          cur.sum += v;
          if (v !== 0) cur.hadNonzero = true;
          perName.set(key, cur);
        };
        // 일지 탭 '초과 근무 인원 집계'의 굵은 숫자(총 = 전월누적 + 이번달)와 같은 값을 보여준다(사용자 선택).
        // 필드 우선순위도 일지 탭(OvertimeLogTab)과 글자까지 같아야 한다 — 다르면 두 화면의 숫자가 어긋난다.
        // 선택월 '이하' 전체를 합산한다(YYYY-MM 문자열 비교). records는 getAttendanceLog가 이미 선택월 이하만 주지만 명시적으로 한 번 더 거른다.
        (otLog?.records || []).forEach((r: any) => {
          if (String(r.settleDate || "").slice(0, 7) <= selectedMonth) add(r.staffName, r.overtime ?? r.overtimeHours ?? r.hours ?? r.totalOvertime ?? 0);
        });
        (Array.isArray(otManual) ? otManual : []).forEach((m: any) => {
          if (String(m.settleDate || "").slice(0, 7) <= selectedMonth) add(m.staffName, m.overtime ?? m.overtimeHours ?? m.hours ?? m.totalOvertime ?? 0);
        });
        if (!cancelled) {
          setOtSummary(
            Array.from(perName, ([name, v]) => ({ name, hours: Math.round(v.sum * 100) / 100, hadNonzero: v.hadNonzero }))
              .filter((x) => x.hadNonzero) // 누적 0이어도 기록이 있으면 표시(일지 탭과 동일 규칙)
              .map(({ name, hours }) => ({ name, hours }))
              .sort((a, b) => b.hours - a.hours)
          );
        }
      } catch {
        // 실패를 빈 목록으로 보여주면 "초과근무 없음"으로 오해한다 — 실패라고 말한다.
        if (!cancelled) { setOtSummary([]); setOtError(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [branchName, selectedMonth]);

  const persist = useCallback((next: FullTimeSalaryRow[]) => {
    setRows(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
    localStorage.setItem(pendingKey, "1");
    const gen = ++autoSaveGenRef.current;
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      // Firestore는 undefined 값이 든 필드가 하나라도 있으면 문서 전체 저장을 거부한다.
      // 명부에 id가 없는 직원은 employeeId가 undefined로 들어오므로(rosterToRow), JSON 왕복으로 걷어내고 보낸다.
      const safe = JSON.parse(JSON.stringify(next)) as FullTimeSalaryRow[];
      gasClient.saveSharedData(sharedKey, safe)
        .then(() => { if (autoSaveGenRef.current === gen) localStorage.removeItem(pendingKey); })
        .catch((e) => {
          console.error("정직원 급여대장 자동저장 실패:", e); // 개발자도구에서 실제 원인 확인용
          // 로그인 세션이 풀린 경우는 지점에서 실제로 겪는 상황(1시간 유휴 자동 로그아웃 등)이라
          // "부득이한 에러"가 아니라 해야 할 일을 알려준다. 입력값은 로컬(pending)에 보관돼 재로그인 후 재전송된다.
          const authIssue = String((e as any)?.message ?? e).includes("로그인");
          triggerToast(
            authIssue
              ? "로그인이 풀려 저장하지 못했습니다. 다시 로그인해 주세요. 입력값은 이 노트북에 보관됩니다."
              : "저장 중 부득이한 에러발생",
            "error"
          );
        });
    }, 450);
  }, [pendingKey, sharedKey, storageKey, triggerToast]);

  const updateRow = (id: string, field: keyof FullTimeSalaryRow, value: string) => {
    if (isLocked) return;
    const moneyFields = ["prevSalary", "thisSalary", "overtimeRate", "taxiEtc", "bonusTip"];
    let nextVal = value;
    if (moneyFields.includes(String(field))) nextVal = cleanNumeric(value);
    else if (field === "overtimeHours") nextVal = cleanHours(value); // 소수 허용(예: 2.5)
    else if (field === "accountNumber") nextVal = value.replace(/[^0-9-]/g, ""); // 계좌번호는 숫자와 하이픈만(엑셀 다운로드 땐 숫자만 — AdminPage)
    else if (field === "residentNumber") nextVal = formatResidentNumber(value); // 13자리 제한 + 하이픈 자동
    // '계'는 overtimePay에 동기화하지 않는다 — 옛 금액만 있는 행에서 시간/시급 한쪽만 입력하면
    // 계산값 0이 기존 금액을 덮어써 급여가 사라지는 사고가 난다(rowOvertimePay가 둘 다 있을 때만 계산).
    persist(rows.map((r) => (r.id === id ? { ...r, [field]: nextVal } : r)));
  };

  const addManualRow = () => {
    if (isLocked) return;
    persist([...rows, {
      id: `ft_manual_${Date.now()}`,
      name: "", rank: "", residentNumber: "", entryDate: "", contractType: "4대보험",
      bank: "", accountNumber: "", prevSalary: "", thisSalary: "", taxiEtc: "", bonusTip: "", overtimePay: "",
      overtimeHours: "", overtimeRate: "",
      remitBranch: "", memo: "", isManual: true,
    }]);
  };

  const deleteRow = (id: string) => {
    if (isLocked) return;
    // 급여(금전) 행이라 오클릭 삭제를 막기 위해 한 번 확인한다.
    const who = rows.find((r) => r.id === id)?.name?.trim() || "이름 없는 행";
    if (!window.confirm(`${who} 님을 이번 달 급여대장에서 삭제할까요?`)) return;
    persist(rows.filter((r) => r.id !== id));
  };

  // ---- 합계 ----
  const sum = (f: (r: FullTimeSalaryRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const totThis = sum((r) => num(r.thisSalary));
  const totTaxi = sum((r) => num(r.taxiEtc));
  const totBonus = sum((r) => num(r.bonusTip));
  const totHours = sum((r) => otNum(r.overtimeHours));
  const totOt = sum(rowOvertimePay);
  const totAll = sum(rowTotal);

  // 엑셀식 칸 이동. 행은 직원명부에서 오므로 행 추가는 없다(onAppendRow 없음).
  // 편집 가능한 칸만 센다 — '총 금액'은 자동계산이라 커서가 서지 않는다.
  //
  // 반드시 아래 잠금 화면 return보다 위에 있어야 한다.
  // 아래에 두면 잠겨 있을 때는 이 훅이 호출되지 않다가 잠금을 풀면 갑자기 호출되어
  // 훅 순서가 바뀌고 React가 터진다.
  const { cellProps, isActive } = useSheetKeyboardNav({ rowCount: rows.length, colCount: 14 });

  // ---- 잠금 화면 ----
  // 개발 서버(localhost:3000, npm run dev)에서는 비밀번호 없이 열람한다 — 테스트 편의.
  // import.meta.env.DEV는 vite build(배포본)에서 자동으로 false가 되므로, 배포하면 다시 비밀번호를 요구한다.
  // (hostname 판별을 쓰면 안 된다 — 이 프로젝트의 hostname 목록엔 운영(run.app)도 들어 있다.)
  const devUnlockBypass = Boolean((import.meta as any).env?.DEV);
  if (!unlocked && !devUnlockBypass) {
    return (
      // data-guide: 작성방법 말풍선(fulltime-salary-table)의 앵커는 잠금 해제 후의 표에 있다.
      // 잠금 화면에도 같은 앵커를 달아, 잠긴 상태에서 '작성방법 보기'를 눌러도 말풍선이 여기 위에 뜨게 한다
      // (앵커가 없으면 GuideCallouts가 조용히 건너뛰어 버튼이 무반응처럼 보인다).
      <div className="flex flex-col items-center justify-center animate-fade-in min-h-[320px] py-6" data-guide="fulltime-salary-table">
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

  // ---- 급여대장 표 (엑셀형 격자, 파트타이머 급여대장과 동일 규칙) ----
  // sheet-cell-input: index.css에서 전역 input 배경/테두리 !important를 ID 특이성(#fulltime-salary-subtab)으로
  // 되돌려 셀을 투명하게 만드는 클래스. 격자선·현재 칸 강조는 감싸는 td(cellTd)가 그린다.
  const cellNum = "sheet-cell-input w-full h-9 px-2 text-[11px] font-mono font-black text-right focus:outline-none";
  const cellText = "sheet-cell-input w-full h-9 px-2 text-[11px] font-bold placeholder-gray-300 focus:outline-none";
  // 엑셀 셀: 격자선은 td가 긋고, 현재 칸은 굵은 테두리로 짚어준다.
  const cellTd = (rowIndex: number, col: number, extra = "") =>
    [
      "border-r border-b border-black/10 p-0 relative",
      isActive(rowIndex, col) ? "outline outline-2 -outline-offset-2 outline-indigo-500 z-10" : "",
      extra,
    ].join(" ");
  const th = "py-3 px-2 text-center font-black";
  // 분류·실제송금지점은 화면에서 숨김(엑셀 다운로드에만 포함). 근로계약·은행은 화면에도 노출한다.
  const emptyColSpan = 16; // 전체 열 수(연장근무 3열 포함, 삭제는 이름칸 ×로 통합)

  return (
    <div className="space-y-5 animate-fade-in" id="fulltime-salary-subtab">
      {/* 초과근무일지 집계 — 월말마감 헤더 바로 아래, 급여대장 제목 위. 읽기 전용 참고.
          급여에 자동 반영하지 않는다(휴무로 대체하는 인원이 있어 지급 대상만 지점이 직접 연장근무 '근무시간' 칸에 옮겨 적는다).
          색은 이 탭의 디자인 토큰(--branch-vanilla/honey + 검정 테두리)을 따른다 — 옛 인디고 팔레트 금지. */}
      <div className="rounded-2xl border border-zinc-900 bg-white px-4 py-3 space-y-2" data-guide="fulltime-overtime-summary">
        <div className="text-xs font-black text-zinc-900 w-fit">
          초과근무 누적 <span className="font-bold text-zinc-400">(초과근무일지의 '총'과 동일 · 전월누적 포함 · 참고용)</span>
        </div>
        {otSummary === null ? (
          <p className="text-[11px] font-bold text-zinc-400">불러오는 중…</p>
        ) : otError ? (
          <p className="text-[11px] font-bold text-rose-600">초과근무일지를 불러오지 못했습니다. 초과근무일지 탭에서 직접 확인해 주세요.</p>
        ) : otSummary.length === 0 ? (
          <p className="text-[11px] font-bold text-zinc-400">집계된 초과근무가 없습니다.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {otSummary.map((x) => {
              // 초과근무 기록 원천(일일마감·수기대장)에는 직원 id가 없어 집계가 '이름' 기준이다.
              // 급여대장 명단에 같은 이름이 둘 이상이면 두 사람의 시간이 한 칩에 합산된 것일 수 있어 경고를 단다.
              const dup = rows.filter((r) => r.name.trim() === x.name).length > 1;
              return (
                <span
                  key={x.name}
                  title={dup ? "급여대장에 같은 이름이 2명 이상 있습니다. 이 시간은 동명이인의 합산일 수 있으니 초과근무일지에서 개별 확인해 주세요." : undefined}
                  className={`inline-flex items-center gap-1 rounded-full border border-zinc-900 px-2.5 py-1 text-[11px] font-black text-zinc-900 ${
                    dup ? "bg-rose-100 text-rose-700"
                    : x.hours < 0 ? "bg-[var(--branch-honey)]"
                    : "bg-[var(--branch-vanilla)]"
                  }`}
                >
                  {dup ? "⚠ " : ""}{x.name} <b className="font-mono">{x.hours > 0 ? `+${x.hours}h` : `${x.hours}h`}</b>
                </span>
              );
            })}
          </div>
        )}
        <p className="text-[10px] font-semibold text-zinc-400">
          당월 급여로 지급할 인원만 아래 연장근무 '근무시간' 칸에 직접 입력하세요. 휴무로 대체하는 인원은 입력하지 않습니다.
          동명이인은 한 이름으로 합산 표시되니(⚠) 해당 시 초과근무일지에서 개별 확인해 주세요.
        </p>
      </div>

      {/* 제목은 위 월말마감 헤더 필("정직원 급여대장")이 맡는다 — 여기 또 적으면 한 화면에 같은 이름이 두 번 보인다. */}
      <div className="flex justify-between items-center pb-3 border-b border-gray-50">
        <p className="text-[10px] text-gray-400 font-semibold">
          직원현황의 정직원 이름이 자동으로 채워집니다. 모든 칸은 직접 수정할 수 있고, 명단에 없으면 '직원 추가'로 넣으세요.
        </p>
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

      {/* 표가 가로 스크롤(overflow)이라 칩은 바깥 relative 층에 얹는다. */}
      <div className="relative">
      <SheetKeyHint />
      {/* 발주관리처럼 스크롤 래퍼엔 테두리·둥근 모서리를 두지 않는다 — rounded가 표의 직각 검정 모서리를 잘라내고
          border-gray-100 회색 선이 검정 격자 바깥에 겹쳐 보인다. 표 테두리는 표(헤더 CSS)가 직접 그린다. */}
      <div className="max-h-[70vh] overflow-auto" data-guide="fulltime-salary-table">
        {/* border-separate 필수 — collapse에서는 sticky 헤더/고정열의 테두리가 스크롤을 따라오지 않아 선이 깨진다(index.css 참고). */}
        <table className="text-left text-[11px] border-separate font-medium" style={{ minWidth: 1750, borderSpacing: 0 }}>
          <thead className="sticky top-0 z-20">
            <tr className="bg-zinc-50 border-b border-gray-100 text-zinc-500 text-[10px] tracking-wider">
              {/* 성명만 왼쪽 고정(발주관리 '일' 컬럼과 같은 패턴). 다른 열은 고정하지 않는다 — 여러 열 sticky는 오프셋이 어긋나 표가 깨졌다. */}
              <th rowSpan={2} className={`${th} w-24 sticky left-0 z-30`}>성명</th>
              <th rowSpan={2} className={`${th} w-20`}>직급</th>
              <th rowSpan={2} className={`${th} w-36 whitespace-nowrap`}>주민등록번호</th>
              <th rowSpan={2} className={`${th} w-32`}>입사일</th>
              <th rowSpan={2} className={`${th} w-28 whitespace-nowrap`}>근로계약</th>
              <th rowSpan={2} className={`${th} w-28`}>은행</th>
              <th rowSpan={2} className={`${th} w-40`}>계좌번호</th>
              <th rowSpan={2} className={`${th} w-28`}>전월급여</th>
              <th rowSpan={2} className={`${th} w-28 whitespace-nowrap`}>이달 급여</th>
              <th colSpan={3} className={`${th}`}>연장근무</th>
              <th rowSpan={2} className={`${th} w-28`}>택시비 및<br/>기타지출</th>
              <th rowSpan={2} className={`${th} w-24`}>상여금</th>
              <th rowSpan={2} className={`${th} w-28 text-indigo-700 whitespace-nowrap`}>총 금액</th>
              <th rowSpan={2} className={`${th} w-96 whitespace-nowrap`}>기타내용 (퇴사일 및 퇴직금 등)</th>
            </tr>
            <tr className="bg-zinc-50 text-zinc-500 text-[10px] tracking-wider">
              <th className={`${th} w-20 whitespace-nowrap`}>근무시간</th>
              <th className={`${th} w-24`}>시급</th>
              <th className={`${th} w-28`}>계</th>
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
              rows.map((row, rowIndex) => (
                <tr key={row.id} className="hover:bg-indigo-50/20">
                  {/* 성명 칸은 왼쪽 고정 — sticky와 relative(cellTd)는 함께 못 쓰므로 클래스를 직접 적는다. bg-white로 밑에 깔리는 칸을 가린다.
                      z는 활성 셀(z-10)과 헤더(z-20) '사이'여야 한다 — z-10이면 활성 셀이 가로 스크롤 때 이 칸을 덮고,
                      z-20이면 DOM 뒤쪽인 이 칸이 세로 스크롤 때 헤더를 덮는다. */}
                  <td className={`sticky left-0 z-[15] bg-white border-l border-r border-b border-black/10 p-0 ${isActive(rowIndex, 0) ? "outline outline-2 -outline-offset-2 outline-indigo-500" : ""}`}>
                    {/* 성명 + 행 삭제(×). 표가 가로로 길어 오른쪽 끝 삭제칸은 스크롤해야 닿으므로 이름 옆에 둔다(파트타이머 급여대장과 동일). */}
                    <div className="flex items-center gap-1 pl-1 pr-0.5">
                      <input {...cellProps(rowIndex, 0)} type="text" value={row.name} disabled={isLocked} onChange={(e) => updateRow(row.id, "name", e.target.value)} placeholder="성명" className="sheet-cell-input w-full min-w-0 h-9 px-1 text-[11px] font-bold placeholder-gray-300 focus:outline-none" />
                      <button type="button" tabIndex={-1} onClick={() => deleteRow(row.id)} disabled={isLocked} aria-label={`${row.name || "이름 없는 행"} 삭제`} title="이 행을 삭제합니다" className="shrink-0 rounded p-0.5 text-gray-300 transition hover:bg-rose-50 hover:text-rose-600 focus:text-rose-600 focus:outline-none disabled:text-gray-200 disabled:cursor-not-allowed">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className={cellTd(rowIndex, 1)}>
                    <select {...cellProps(rowIndex, 1)} value={row.rank} disabled={isLocked} onChange={(e) => updateRow(row.id, "rank", e.target.value)} className={`${cellText} cursor-pointer`}>
                      <option value="">직급</option>
                      {RANK_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      {row.rank && !RANK_OPTIONS.includes(row.rank) && <option value={row.rank}>{row.rank}</option>}
                    </select>
                  </td>
                  <td className={cellTd(rowIndex, 2)}><input {...cellProps(rowIndex, 2)} type="text" value={row.residentNumber} disabled={isLocked} onChange={(e) => updateRow(row.id, "residentNumber", e.target.value)} placeholder="주민번호" className={`${cellText} font-mono`} /></td>
                  {/* min/max로 연도를 4자리로 제한한다 — 없으면 크롬이 연도 칸을 6자리까지 받아 202600 같은 값이 들어가고, 그 값은 무효라 저장도 안 된다(달력 선택 없이 숫자 타이핑도 이 범위 안이면 그대로 입력·저장된다). */}
                  <td className={cellTd(rowIndex, 3)}><input {...cellProps(rowIndex, 3)} type="date" min="1970-01-01" max="2099-12-31" value={row.entryDate} disabled={isLocked} onChange={(e) => updateRow(row.id, "entryDate", e.target.value)} className={`${cellText} font-mono`} /></td>
                  <td className={cellTd(rowIndex, 4)}>
                    <select {...cellProps(rowIndex, 4)} value={row.contractType || "4대보험"} disabled={isLocked} onChange={(e) => updateRow(row.id, "contractType", e.target.value)} className={`${cellText} cursor-pointer`}>
                      {CONTRACT_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                      {/* 레거시 자유입력값은 그대로 보여준다 — 말없이 4대보험으로 둔갑시키면 급여 엑셀이 실제와 달라진다. */}
                      {row.contractType && !CONTRACT_OPTIONS.includes(row.contractType) && <option value={row.contractType}>{row.contractType}</option>}
                    </select>
                  </td>
                  <td className={cellTd(rowIndex, 5)}><input {...cellProps(rowIndex, 5)} type="text" value={row.bank} disabled={isLocked} onChange={(e) => updateRow(row.id, "bank", e.target.value)} placeholder="은행명" className={cellText} /></td>
                  <td className={cellTd(rowIndex, 6)}><input {...cellProps(rowIndex, 6)} type="text" value={row.accountNumber} disabled={isLocked} onChange={(e) => updateRow(row.id, "accountNumber", e.target.value)} placeholder="계좌번호" className={`${cellText} font-mono`} /></td>
                  <td className={cellTd(rowIndex, 7)}><input {...cellProps(rowIndex, 7)} type="text" value={formatWithCommas(row.prevSalary)} disabled={isLocked} onChange={(e) => updateRow(row.id, "prevSalary", e.target.value)} placeholder="0" className={`${cellNum} text-gray-500`} /></td>
                  <td className={cellTd(rowIndex, 8)}><input {...cellProps(rowIndex, 8)} type="text" value={formatWithCommas(row.thisSalary)} disabled={isLocked} onChange={(e) => updateRow(row.id, "thisSalary", e.target.value)} placeholder="0" className={cellNum} /></td>
                  {/* 연장근무: 근무시간(시간) · 시급(원) · 계(= 시간×시급, 총금액에 합산) */}
                  <td className={cellTd(rowIndex, 9, "border-l border-gray-200")}><input {...cellProps(rowIndex, 9)} type="text" value={row.overtimeHours} disabled={isLocked} onChange={(e) => updateRow(row.id, "overtimeHours", e.target.value)} placeholder="0" className={cellNum} /></td>
                  <td className={cellTd(rowIndex, 10)}><input {...cellProps(rowIndex, 10)} type="text" value={formatWithCommas(row.overtimeRate)} disabled={isLocked} onChange={(e) => updateRow(row.id, "overtimeRate", e.target.value)} placeholder="0" className={cellNum} /></td>
                  <td className="group/ot relative border-r border-b border-black/10 px-2 py-1.5 text-right font-mono font-black text-gray-600">
                    {formatNumber(rowOvertimePay(row))}
                    {/* 옛 '추가근무' 금액만 있는 행(시간·시급 없음)은 계가 그 금액이라 시간/시급으로 지울 수 없다.
                        → 명시적 지우기(×)를 제공. 시간·시급으로 새로 입력하려면 두 칸을 채우면 계산값이 우선한다. */}
                    {!isLocked && !(otNum(row.overtimeHours) > 0 && num(row.overtimeRate) > 0) && num(row.overtimePay) > 0 && (
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => updateRow(row.id, "overtimePay", "")}
                        title="옛 추가근무 금액을 지웁니다."
                        className="absolute left-0.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-300 opacity-0 transition hover:text-rose-600 group-hover/ot:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </td>
                  <td className={cellTd(rowIndex, 11)}><input {...cellProps(rowIndex, 11)} type="text" value={formatWithCommas(row.taxiEtc)} disabled={isLocked} onChange={(e) => updateRow(row.id, "taxiEtc", e.target.value)} placeholder="0" className={cellNum} /></td>
                  <td className={cellTd(rowIndex, 12)}><input {...cellProps(rowIndex, 12)} type="text" value={formatWithCommas(row.bonusTip)} disabled={isLocked} onChange={(e) => updateRow(row.id, "bonusTip", e.target.value)} placeholder="0" className={cellNum} /></td>
                  <td className="border-r border-b border-black/10 px-2 py-1.5 text-right font-mono font-black text-indigo-700">{formatNumber(rowTotal(row))}</td>
                  <td className={cellTd(rowIndex, 13)}><input {...cellProps(rowIndex, 13)} type="text" value={row.memo} disabled={isLocked} onChange={(e) => updateRow(row.id, "memo", e.target.value)} placeholder="비고" className={cellText} /></td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="sticky bottom-0 z-20 border-t-2 border-indigo-100 font-black text-indigo-900">
                <td className="bg-indigo-50 px-2 py-2.5 text-center" colSpan={8}>합계</td>
                <td className="bg-indigo-50 px-2 py-2.5 text-right font-mono">{formatNumber(totThis)}</td>
                <td className="bg-indigo-50 px-2 py-2.5 text-right font-mono border-l border-gray-200">{totHours ? `${totHours}h` : ""}</td>
                <td className="bg-indigo-50 px-2 py-2.5"></td>
                <td className="bg-indigo-50 px-2 py-2.5 text-right font-mono">{formatNumber(totOt)}</td>
                <td className="bg-indigo-50 px-2 py-2.5 text-right font-mono">{formatNumber(totTaxi)}</td>
                <td className="bg-indigo-50 px-2 py-2.5 text-right font-mono">{formatNumber(totBonus)}</td>
                <td className="bg-indigo-50 px-2 py-2.5 text-right font-mono text-indigo-700">{formatNumber(totAll)}</td>
                <td className="bg-indigo-50 px-2 py-2.5"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      </div>
    </div>
  );
}
