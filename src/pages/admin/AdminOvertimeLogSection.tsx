// src/pages/admin/AdminOvertimeLogSection.tsx
// 관리자 > 일일업무 > 초과근무일지 — 전 지점의 초과근무(자동 + 수기)를 한 표로 모아 보는 **조회 전용** 화면
// (사용자 지시 2026-10-11). 고치는 것은 지금처럼 지점 화면의 초과근무일지에서 한다 — 여기엔 수정·삭제 버튼이 없다.
//
// [같은 자료] 지점 화면 OvertimeLogTab 과 같은 두 출처를 같은 방식으로 합친다.
//   - 자동분: gasClient.getAttendanceLog(지점, "overtime", 월) — 일일마감 METADATA 의 정직원 초과/조기퇴근
//   - 수기분: manual_overtime:<지점> — 여기서는 getAllManualOvertimes() 한 번으로 전 지점을 읽는다
// 합계 규칙(선택 월 이하 누적, 총합 0 인 인원 제외)도 지점 화면과 같게 둔다 — 두 화면 숫자가 어긋나면 안 된다.
//
// [조회량] 지점마다 전체 마감 이력을 읽는 무거운 조회라, **월과 무관하게 한 번만** 읽고(month 없이 = 전체 기간)
// 월 선택은 화면에서 거른다 — 월을 바꿀 때마다 전 지점을 다시 읽지 않는다(Codex 지적). 동시 조회도
// BRANCH_CONCURRENCY 개로 묶는다. 다시 읽는 것은 화면에 들어올 때와 '새로고침'을 눌렀을 때뿐이다.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gasClient } from "../../api/gasClient";
import LoadingSpinner from "../../components/LoadingSpinner";
import { getAdminBranchList } from "./helpers/closedBranches";
import { toLocalMonthInputValue } from "../branch/helpers/formatters";
import { useAuthContext } from "../../contexts/AuthContext";

interface OvertimeRow {
  branchName: string;
  settleDate: string;
  staffName: string;
  clockIn: string;
  clockOut: string;
  workHours: string | number;
  standardHours: string | number;
  overtime: number;
  overtimeReason: string;
  manual: boolean;
}

interface SummaryRow {
  key: string;
  branchName: string;
  name: string;
  previous: number;
  current: number;
  total: number;
}

// 지점 화면과 같은 필드 폴백 — 옛 수기 기록은 overtime 대신 다른 이름으로 저장돼 있다.
const overtimeHoursOf = (item: any): number =>
  Number(item?.overtime ?? item?.overtimeHours ?? item?.hours ?? item?.totalOvertime ?? 0) || 0;

// 0.1 단위 합산의 부동소수 꼬리(2.3000000004h)를 지운다.
const roundHours = (value: number): number => Math.round(value * 100) / 100;

// 동시에 읽는 지점 수 — 전 지점을 한꺼번에 쏘면 지점마다 상세 문서까지 읽어 브라우저가 버거워진다.
// 4개로는 지점 17곳이 5번에 나눠 돌아 느렸다(사용자 지적 2026-10-11) — 8개로 2~3번에 끝낸다.
const BRANCH_CONCURRENCY = 8;

/** 최대 limit 개씩만 동시에 돌린다. 결과는 각 호출부가 직접 처리한다(끝나는 대로 화면에 반영하려고). */
async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await fn(items[index]);
    }
  });
  await Promise.all(workers);
}

const formatHours = (value: number): string => `${value > 0 ? "+" : ""}${roundHours(value)}h`;

const sortRows = (rows: OvertimeRow[]): OvertimeRow[] => rows.sort((a, b) =>
  b.settleDate.localeCompare(a.settleDate) || a.branchName.localeCompare(b.branchName, "ko") || a.staffName.localeCompare(b.staffName, "ko"));

// [탭 재진입 즉시 표시] 직전 조회 결과를 이 창(탭)이 살아 있는 동안 기억한다 — 다른 탭을 갔다 와도
// 다시 기다리지 않는다. 메모리에만 두므로 새로고침(F5)·다른 기기와는 공유되지 않는다.
// SESSION_FRESH_MS 가 지나면 기억한 값을 먼저 보여주고 뒤에서 새로 읽는다('갱신 중' 표시).
// **완전히 끝난 조회만** 기억한다 — 중간에 탭을 떠난 반쪽 결과가 다음 진입 때 완전한 것처럼 보이면 안 된다.
// [계정 격리] 기억값은 조회한 계정(owner)에 묶는다. 로그아웃 후 다른 계정으로 들어오면 owner 가 달라
// 기억값을 쓰지 않고 새로 읽는다 — 앞 계정이 본 자료가 다음 계정에 그대로 뜨면 안 된다(Codex 지적).
const SESSION_FRESH_MS = 5 * 60 * 1000;
interface LoadedSnapshot {
  owner: string;
  autoByBranch: Map<string, OvertimeRow[]>;
  manualRows: OvertimeRow[];
  branchNames: string[];
  failed: string[];
  at: number;
}
let sessionSnapshot: LoadedSnapshot | null = null;

/** 이 계정이 쓸 수 있는 기억값만 돌려준다. fresh=true 면 5분 이내 것만. */
const snapshotFor = (owner: string, fresh = false): LoadedSnapshot | null => {
  if (!owner || !sessionSnapshot || sessionSnapshot.owner !== owner) return null;
  if (fresh && Date.now() - sessionSnapshot.at >= SESSION_FRESH_MS) return null;
  return sessionSnapshot;
};

const mergeSnapshotRows = (autoByBranch: Map<string, OvertimeRow[]>, manualRows: OvertimeRow[]): OvertimeRow[] =>
  sortRows([...Array.from(autoByBranch.values()).flat(), ...manualRows]);

const toAutoRow = (branchName: string, record: any): OvertimeRow => ({
  branchName,
  settleDate: String(record.settleDate || ""),
  staffName: String(record.staffName || ""),
  clockIn: record.clockIn || "",
  clockOut: record.clockOut || "",
  workHours: record.workHours ?? "-",
  standardHours: record.standardHours ?? "-",
  overtime: overtimeHoursOf(record),
  overtimeReason: String(record.overtimeReason || "-"),
  manual: false,
});

const toManualRow = (item: any): OvertimeRow => ({
  branchName: String(item.branchName),
  settleDate: String(item.settleDate || ""),
  staffName: String(item.staffName || ""),
  clockIn: "수기",
  clockOut: "수기",
  workHours: "-",
  standardHours: "-",
  overtime: overtimeHoursOf(item),
  overtimeReason: String(item.reason || "-"),
  manual: true,
});

export function AdminOvertimeLogSection() {
  const { user } = useAuthContext();
  // 계정 식별 — 개인계정의 uid 로만 묶는다. uid 가 없는 PIN 세션은 계정을 가를 방법이 없어 owner 를
  // 비워 두고, 빈 owner 는 기억값을 아예 쓰지 않는다(snapshotFor) — 매번 새로 읽는다(Codex 지적).
  const owner = user && user.loginType === "personal" && user.uid ? `uid:${user.uid}` : "";
  // key=owner — 계정이 바뀌면 화면을 통째로 새로 만든다. 상태 초기값이 새 계정 기준으로 다시 계산돼
  // 앞 계정의 표가 한 프레임도 렌더되지 않는다(effect 에서 비우면 그 전에 한 번 그려진다, Codex 지적).
  // (이 프로젝트 타입 설정은 함수 컴포넌트에 key 를 바로 못 붙여 Fragment 에 단다 — 효과는 같다)
  return <Fragment key={owner}><OvertimeLogView owner={owner} /></Fragment>;
}

function OvertimeLogView({ owner }: { owner: string }) {
  // 빈 값 = 전체 기간(기본값, 사용자 지시 2026-10-12).
  const [selectedMonth, setSelectedMonth] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  // 집계에서 직원 이름을 누르면 왼쪽 내역을 그 사람(지점+이름이 정확히 같은 행)으로 좁힌다(사용자 지시 2026-10-12).
  // 이름 검색은 '포함' 검색이라 홍길동을 고르면 홍길동2 까지 섞인다 — 그래서 따로 정확히 일치로 거른다.
  const [staffFocus, setStaffFocus] = useState<{ branchName: string; name: string } | null>(null);
  const detailCardRef = useRef<HTMLDivElement | null>(null);
  const detailScrollRef = useRef<HTMLDivElement | null>(null);
  // 오른쪽 집계 전용 지점 선택·이름 검색(사용자 지시 2026-10-12) — 왼쪽 표의 필터와 따로 논다.
  const [summaryBranchFilter, setSummaryBranchFilter] = useState("");
  const [summaryNameFilter, setSummaryNameFilter] = useState("");
  // 전체 기간 기록. 표에는 선택 월(전체 기간이면 전부)만, 집계에는 기준 월 이하만 쓴다.
  const [allRows, setAllRows] = useState<OvertimeRow[]>(() => {
    const snap = snapshotFor(owner);
    return snap ? mergeSnapshotRows(snap.autoByBranch, snap.manualRows) : [];
  });
  const [branchNames, setBranchNames] = useState<string[]>(() => snapshotFor(owner)?.branchNames || []);
  // 못 읽은 지점 — '초과근무 없음'과 '못 읽음'을 구분해 보여준다(전일 정산현황과 같은 규칙).
  const [failedSources, setFailedSources] = useState<string[]>(() => snapshotFor(owner)?.failed || []);
  // 조회 진행 — null 이면 조회 중이 아니다. 표는 이걸 기다리지 않고 도착한 지점부터 보여준다.
  // 첫 진입(기억값 없음)이면 처음부터 조회 중으로 시작해 '기록 없음'이 한 프레임 깜빡이지 않게 한다.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(() =>
    snapshotFor(owner, true) ? null : { done: 0, total: 0 });
  // 새로고침을 연달아 누르면 앞 요청이 늦게 끝나 뒤 결과를 덮을 수 있다 — 최신 요청만 반영한다.
  // 탭을 떠나면(언마운트) 요청 번호를 올려 진행 중 조회가 화면·기억값에 쓰지 못하게 한다.
  const requestRef = useRef(0);
  useEffect(() => () => { requestRef.current += 1; }, []);

  const loadData = useCallback(async () => {
    const requestId = ++requestRef.current;
    const isCurrent = () => requestRef.current === requestId;
    // 갱신 중에는 지점별로 '직전 값 → 새 값'으로 하나씩 갈아 끼운다. 한 지점 안에서 옛것과 새것이
    // 섞이는 일은 없다(지점 단위로 통째 교체).
    const seed = snapshotFor(owner);
    const autoByBranch = new Map<string, OvertimeRow[]>(seed?.autoByBranch || []);
    let manualRows: OvertimeRow[] = seed?.manualRows || [];
    const failed: string[] = [];
    const publish = () => { if (isCurrent()) setAllRows(mergeSnapshotRows(autoByBranch, manualRows)); };
    setProgress({ done: 0, total: 0 });
    try {
      const branches = await getAdminBranchList();
      if (!isCurrent()) return;
      const targets: string[] = (Array.isArray(branches) ? branches : [])
        .filter((branch: any) => branch?.role === "branch" && branch.branchName)
        .map((branch: any) => String(branch.branchName));
      const targetSet = new Set(targets);
      // 대상에서 빠진 지점(휴업 등)의 기억값은 버린다.
      for (const name of Array.from(autoByBranch.keys())) if (!targetSet.has(name)) autoByBranch.delete(name);
      const sortedNames = [...targets].sort((a, b) => a.localeCompare(b, "ko"));
      setBranchNames(sortedNames);
      let done = 0;
      setProgress({ done, total: targets.length });
      const tick = () => { done += 1; if (isCurrent()) setProgress({ done, total: targets.length }); };

      await Promise.all([
        runWithConcurrency(targets, BRANCH_CONCURRENCY, async (branchName) => {
          try {
            // serverOnly — 서버를 못 읽으면 기기 캐시로 조용히 폴백하지 않고 실패로 던진다. 옛 캐시가
            // '정상·완전한 집계'로 둔갑하지 않고 위 실패 배너에 지점이 남는다(Codex 지적, 급여대장과 같은 규칙).
            const log = await gasClient.getAttendanceLog(branchName, "overtime", undefined, true, true);
            autoByBranch.set(branchName, (log.records || []).map((record: any) => toAutoRow(branchName, record)));
          } catch (error) {
            console.error(`초과근무 자동 기록 조회 실패(${branchName}):`, error);
            failed.push(branchName);
            // 못 읽은 지점의 직전 값은 내린다 — 실패 배너가 떴는데 옛 숫자가 정상처럼 남아 있으면 안 된다.
            autoByBranch.delete(branchName);
          }
          tick();
          publish();   // 끝난 지점부터 바로 표에 보인다
        }),
        // 수기분은 문서 몇 개짜리 가벼운 조회라 먼저 끝난다 — 끝나는 대로 표에 올린다.
        gasClient.getAllManualOvertimes().then((manualAll) => {
          manualRows = (Array.isArray(manualAll) ? manualAll : [])
            // 휴업 지점 등 조회 대상이 아닌 지점의 수기분은 자동분과 같은 기준으로 뺀다.
            .filter((item: any) => targetSet.has(String(item?.branchName || "")))
            .map(toManualRow);
          publish();
        }).catch((error) => {
          console.error("수기 초과근무 조회 실패:", error);
          failed.push("수기 입력분(전 지점)");
          manualRows = [];
          publish();
        }),
      ]);
      if (!isCurrent()) return;
      const at = Date.now();
      // owner 가 빈 세션(PIN)은 기억하지 않는다 — 다음 PIN 세션이 다른 사람일 수 있다.
      sessionSnapshot = owner ? { owner, autoByBranch, manualRows, branchNames: sortedNames, failed: [...failed], at } : null;
      setFailedSources([...failed]);
    } catch (error) {
      console.error("초과근무일지 조회 실패:", error);
      if (!isCurrent()) return;
      setAllRows([]);
      setFailedSources(["지점 목록"]);
      sessionSnapshot = null;
    } finally {
      if (isCurrent()) setProgress(null);
    }
  }, [owner]);

  useEffect(() => {
    // 기억한 값이 충분히 새것이면 다시 읽지 않는다 — 탭을 다시 열 때 기다림이 없다.
    if (snapshotFor(owner, true)) return;
    void loadData();
  }, [loadData, owner]);

  const loading = progress !== null;
  // 표 자리에 스피너를 띄우는 것은 '그 표에 보여줄 행이 아직 하나도 없을 때'뿐이다. 조회 중에 '기록 없음'을
  // 띄우면 아직 안 온 지점이 있는데 없다고 읽힌다 — 비어 있으면 끝날 때까지 스피너를 둔다.


  const normalizedName = nameFilter.trim().toLowerCase();
  const normalizedSummaryName = summaryNameFilter.trim().toLowerCase();
  const matchesFilters = useCallback((branchName: string, staffName: string) => {
    // 집계에서 고른 직원이 있으면 그 사람만 — 지점·이름 검색칸은 고를 때 비운다(아래 focusStaff).
    if (staffFocus) return branchName === staffFocus.branchName && staffName === staffFocus.name;
    return (!branchFilter || branchName === branchFilter) &&
      (!normalizedName || staffName.toLowerCase().includes(normalizedName));
  }, [branchFilter, normalizedName, staffFocus]);

  const monthRows = useMemo(() =>
    allRows.filter((row) => (!selectedMonth || row.settleDate.slice(0, 7) === selectedMonth) && matchesFilters(row.branchName, row.staffName)),
  [allRows, selectedMonth, matchesFilters]);
  // 월 선택지 — 실제 기록이 있는 달만, 최근 달이 위로.
  // [조회 중 예외] 새로고침 중에는 지점이 차례로 채워져 고른 달의 기록이 잠깐 없을 수 있다. 그때 목록에서
  // 빼면 선택칸이 빈 칸으로 보이므로 조회가 끝날 때까지만 남겨 둔다. 끝났는데도 기록이 없으면 아래 effect 가
  // '전체 기간'으로 되돌린다 — 그래서 조회가 끝난 화면의 목록에는 기록 있는 달만 남는다.
  const recordMonths = useMemo(
    () => new Set<string>(allRows.map((row) => row.settleDate.slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m))),
    [allRows]);
  const monthOptions = useMemo(() => {
    const months = new Set<string>(recordMonths);
    if (loading && selectedMonth) months.add(selectedMonth);
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [recordMonths, loading, selectedMonth]);
  useEffect(() => {
    if (!loading && selectedMonth && !recordMonths.has(selectedMonth)) setSelectedMonth("");
  }, [loading, selectedMonth, recordMonths]);

  // 집계의 기준 월 — 전체 기간이면 이번 달을 기준으로 '전월까지 / 이번달'을 나눈다.
  const summaryBaseMonth = selectedMonth || toLocalMonthInputValue();

  const focusStaff = (branchName: string, name: string) => {
    const same = staffFocus && staffFocus.branchName === branchName && staffFocus.name === name;
    setStaffFocus(same ? null : { branchName, name });   // 같은 이름을 다시 누르면 해제
    setBranchFilter("");
    setNameFilter("");
    // 고른 사람의 최근 기록부터 보이게 표 스크롤을 맨 위로, 좁은 화면(표가 위아래로 쌓임)이면 내역 표로 이동.
    if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0;
    detailCardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  // 지점·직원별 합계 — 같은 이름이라도 지점이 다르면 다른 사람으로 센다.
  const summaryRows = useMemo(() => {
    const totals = new Map<string, SummaryRow>();
    for (const row of allRows) {
      if (!row.staffName) continue;
      if (summaryBranchFilter && row.branchName !== summaryBranchFilter) continue;
      if (normalizedSummaryName && !row.staffName.toLowerCase().includes(normalizedSummaryName)) continue;
      const month = row.settleDate.slice(0, 7);
      if (month > summaryBaseMonth) continue;
      const key = `${row.branchName}|${row.staffName}`;
      const entry = totals.get(key) || { key, branchName: row.branchName, name: row.staffName, previous: 0, current: 0, total: 0 };
      if (month < summaryBaseMonth) entry.previous += row.overtime;
      else entry.current += row.overtime;
      entry.total = entry.previous + entry.current;
      totals.set(key, entry);
    }
    // 총합 0 인 인원(초과·조기퇴근이 상쇄된 경우 포함)은 뺀다. 판정은 지점 화면과 똑같이 반올림 없는
    // 원래 합계로 한다 — 여기서만 반올림하면 두 화면에 보이는 인원이 달라진다(Codex 지적).
    return Array.from(totals.values())
      .filter((entry) => entry.total !== 0)
      .sort((a, b) => b.total - a.total || a.branchName.localeCompare(b.branchName, "ko"));
  }, [allRows, summaryBaseMonth, summaryBranchFilter, normalizedSummaryName]);

  return (
    <div className="space-y-5">
      {failedSources.length > 0 && !loading && (
        <div className="border rounded-xl px-4 py-3 text-xs font-bold bg-[#FDE2E2] border-[#C93A3A] text-[#B91C1C]">
          다음 자료를 불러오지 못했습니다: {failedSources.join(", ")} — 이 지점의 초과근무가 아래 표에서 빠져 있을 수 있습니다. '새로고침'을 눌러주세요.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div ref={detailCardRef} className="admin-sheet-card xl:col-span-2">
          <div className="admin-band">
            <h2 className="admin-band-title">초과근무 내역</h2>
            <div className="admin-band-filters">
              <select value={branchFilter} onChange={(e) => { setBranchFilter(e.target.value); setStaffFocus(null); }} aria-label="지점 필터" className="w-32">
                <option value="">전체 지점</option>
                {branchNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <input type="search" value={nameFilter} onChange={(e) => { setNameFilter(e.target.value); setStaffFocus(null); }} placeholder="이름 검색" aria-label="직원명 검색" className="w-28" />
              <button type="button" onClick={() => void loadData()} disabled={loading}>새로고침</button>
              {/* 집계에서 고른 직원 — 누르면 해제(검정 채움 = 켜진 필터, .admin-band-filters button.is-active) */}
              {staffFocus && (
                <button type="button" className="is-active" onClick={() => setStaffFocus(null)} title="선택 해제">
                  {staffFocus.name} · {staffFocus.branchName} ✕
                </button>
              )}
            </div>
            {/* 날짜 필터는 밴드 맨 오른쪽(사용자 지시 2026-10-12). 기본값은 전체 기간.
                모양은 다른 필터와 같은 흰 알약이라야 해서 `.admin-band-filters` 안에 두고(그 CSS 가 28px 알약을 입힌다),
                오른쪽 끝으로 미는 것만 따로 한다. 밴드 CSS 의 order(필터=1)가 Tailwind order 를 이기므로
                맨 뒤 순서는 인라인 style 로 준다 — 조회 중 진행 문구(order 2)보다도 뒤에 와야 한다. */}
            <div className="admin-band-filters ml-auto" style={{ order: 9 }}>
              <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} aria-label="조회 월" className="w-28">
                <option value="">전체 기간</option>
                {monthOptions.map((m) => <option key={m} value={m}>{`${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`}</option>)}
              </select>
            </div>
            {/* 조회 수·합계·조회시각 설명줄은 지웠다(사용자 지시 2026-10-12). 조회 중에만 진행 상황을 보인다 —
                지점별로 차례로 채워지므로, 이게 없으면 반쯤 찬 표를 다 된 것으로 읽는다. */}
            {loading && (
              <p className="admin-band-meta">
                불러오는 중 {progress && progress.total ? `${progress.done}/${progress.total} 지점` : "…"}
              </p>
            )}
          </div>
          <div ref={detailScrollRef} className="admin-sheet-scroll max-h-[65vh]">
            <table className="admin-sheet min-w-[860px]">
              <thead>
                <tr>
                  <th className="w-24">마감일자</th>
                  <th className="w-28">지점</th>
                  <th className="w-20">직원명</th>
                  <th className="w-14">출근</th>
                  <th className="w-14">퇴근</th>
                  <th className="w-16 text-right">근무</th>
                  <th className="w-16 text-right">기준</th>
                  <th className="w-28 text-right">초과시간</th>
                  <th>초과사유 및 경위</th>
                </tr>
              </thead>
              <tbody>
                {loading && monthRows.length === 0 ? (
                  <tr><td colSpan={9} className="py-10 text-center"><LoadingSpinner size="sm" /></td></tr>
                ) : monthRows.length === 0 ? (
                  <tr><td colSpan={9} className="py-10 text-center text-[11px] font-bold text-gray-400">
                    {branchFilter || normalizedName || staffFocus ? "조건에 맞는 초과근무 기록이 없습니다." : selectedMonth ? "이 달의 초과근무 기록이 없습니다." : "초과근무 기록이 없습니다."}
                  </td></tr>
                ) : monthRows.map((row, idx) => {
                  // 같은 날짜가 이어지면 날짜는 한 번만 적는다(지점 화면과 같은 읽기 방식).
                  const newDate = idx === 0 || monthRows[idx - 1].settleDate !== row.settleDate;
                  return (
                    <tr key={`${row.branchName}|${row.settleDate}|${row.staffName}|${row.manual ? "m" : "a"}|${idx}`}>
                      <td className="font-mono text-[11px] text-gray-500 whitespace-nowrap">{newDate ? row.settleDate : ""}</td>
                      <td className="font-black text-gray-800 whitespace-nowrap">{row.branchName}</td>
                      <td className="font-black text-gray-800 whitespace-nowrap">{row.staffName}</td>
                      <td className="font-mono text-gray-500">{row.clockIn}</td>
                      <td className="font-mono text-gray-500">{row.clockOut}</td>
                      <td className="text-right font-mono">{row.manual ? "-" : `${row.workHours}h`}</td>
                      <td className="text-right font-mono text-gray-500">{row.manual ? "-" : `${row.standardHours}h`}</td>
                      {/* 관리자 스코프는 Tailwind 표준색을 치환하므로 음수는 오류 hex 로 못 박는다(DESIGN_ADMIN, 지점 화면과 같은 #C93A3A).
                          수기로 적은 음수는 조기퇴근이 아니라 '차감'이다 — 지점 화면과 같은 구분. */}
                      <td className={`text-right font-mono font-black whitespace-nowrap ${row.overtime < 0 ? "text-[#C93A3A]" : "text-gray-800"}`}>
                        {formatHours(row.overtime)}{row.overtime < 0 ? (row.manual ? " (차감)" : " (조기퇴근)") : ""}
                      </td>
                      <td className="text-[11px] font-bold text-gray-700 max-w-[280px] truncate" title={row.overtimeReason}>
                        {row.manual && <span className="mr-1 text-gray-400">[수기]</span>}{row.overtimeReason}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* h-fit 을 뺐다 — 격자 기본(stretch)으로 두 카드가 같은 높이가 된다(사용자 지시 2026-10-12). 표가 짧으면 아래가 빈 채로 남는다. */}
        <div className="admin-sheet-card">
          <div className="admin-band">
            <h2 className="admin-band-title">지점·직원별 집계</h2>
            {/* 기준 설명줄은 지웠다(사용자 지시 2026-10-12). 집계 전용 지점·이름 필터 — 왼쪽 표의 필터와 따로 논다.
                카드가 화면 1/3 폭이라 칸을 줄여(지점 w-24·이름 w-20) 제목과 한 줄에 둔다(사용자 지시 2026-10-12). */}
            <div className="admin-band-filters">
              <select value={summaryBranchFilter} onChange={(e) => { setSummaryBranchFilter(e.target.value); setStaffFocus(null); }} aria-label="집계 지점 필터" className="w-24">
                <option value="">전체 지점</option>
                {branchNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <input type="search" value={summaryNameFilter} onChange={(e) => { setSummaryNameFilter(e.target.value); setStaffFocus(null); }} placeholder="이름 검색" aria-label="집계 직원명 검색" className="w-20" />
            </div>
          </div>
          <div className="admin-sheet-scroll max-h-[65vh]">
            <table className="admin-sheet">
              <thead>
                <tr>
                  <th>지점</th>
                  <th>직원</th>
                  <th className="text-right">전월까지</th>
                  <th className="text-right">이번달</th>
                  <th className="text-right">총</th>
                </tr>
              </thead>
              <tbody>
                {loading && summaryRows.length === 0 ? (
                  <tr><td colSpan={5} className="py-10 text-center"><LoadingSpinner size="sm" /></td></tr>
                ) : summaryRows.length === 0 ? (
                  <tr><td colSpan={5} className="py-10 text-center text-[11px] font-bold text-gray-400">{normalizedSummaryName || summaryBranchFilter ? "조건에 맞는 인원이 없습니다." : "집계할 인원이 없습니다."}</td></tr>
                ) : summaryRows.map((row) => (
                  <tr key={row.key} className={staffFocus && staffFocus.branchName === row.branchName && staffFocus.name === row.name ? "admin-row-highlight" : ""}>
                    <td className="whitespace-nowrap">{row.branchName}</td>
                    <td className="font-black text-gray-800 whitespace-nowrap">
                      {/* 이름을 누르면 왼쪽 내역이 이 사람으로 좁혀진다. 다시 누르면 해제. */}
                      <button type="button" onClick={() => focusStaff(row.branchName, row.name)}
                        className="underline decoration-dotted underline-offset-2 cursor-pointer hover:text-[#2E6DB4]" title="이 직원의 초과근무 내역 보기">
                        {row.name}
                      </button>
                    </td>
                    <td className="text-right font-mono">{formatHours(row.previous)}</td>
                    <td className="text-right font-mono">{formatHours(row.current)}</td>
                    {/* 지점 화면과 같은 경고 기준 — 누적 24시간 초과면 붉게 */}
                    <td className={`text-right font-mono font-black ${row.total > 24 ? "text-[#C93A3A]" : row.total < 0 ? "text-[#C93A3A]" : "text-gray-800"}`}>{formatHours(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
