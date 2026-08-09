// src/pages/branch/tabs/BranchDashboardTab.tsx
// 지점 대시보드 탭 — 미결 확인사항 · 관리자 공지 · 최근 일주일 매출 · 월간 매출 달력.
//
// 2026-07-28 개편(사용자 지시):
//   - 미결 확인사항과 관리자 공지를 컴팩트하게 줄여 상단 2열로, 그 아래 일주일 매출 막대그래프와 매출 달력.
//   - '신규입사 필수정보 확인 필요'를 없애고, 신규입사자 중 **근로계약서 신청이 아직 안 된 인원**을 보여준다.
//     (필수정보가 비었는지보다, 실제로 해야 할 일이 무엇인지가 지점에 필요한 정보다.)
//
// 2026-08-09 개편(사용자 지시): 미결 확인사항을 딱 두 가지로 줄인다.
//   - 인사 쪽은 '근로계약서 신청 필요' 하나만 남긴다. 추가사유 미선택·지점이동 필수정보·기타 사유 내용·동명이인
//     네 항목은 지웠다. 지점이 매일 보는 칸이라 실제로 손을 움직여야 하는 일만 남긴다는 뜻이다.
//   - 마감은 '어제 하루'가 아니라 **이번 달 1일부터 어제까지** 훑어 빠진 날짜를 모두 보여준다.
//     어제만 보면 그 전에 빠뜨린 날이 영영 안 보였다.
import { useState, useCallback, useEffect, useMemo } from "react";
import { gasClient } from "../../../api/gasClient";
import type { LaborContract, MasterDaily } from "../../../api/gasClient";
import LoadingSpinner from "../../../components/LoadingSpinner";
import { formatNumber } from "../../../utils/formatNumber";
import { toPhoneTail8 } from "../helpers/formatters";
import { parseStaffAddReason } from "../helpers/staffHelpers";

// names 는 사람 이름일 수도 날짜일 수도 있어 세는 단위를 항목이 정한다(기본 "명").
type Issue = { type: string; message: string; level: "warn" | "danger" | "info"; names?: string[]; unit?: string };

/** 하루 총매출. totalSales가 비어 있는 옛 기록은 항목 합으로 계산한다. */
const masterTotal = (row: MasterDaily) =>
  Number(row.totalSales) ||
  (Number(row.cashSales) || 0) + (Number(row.cardSales) || 0) + (Number(row.transferSales) || 0) + (Number(row.deliverySales) || 0);

/** 최근 일주일: 어제부터 거꾸로 7일. 오늘은 아직 마감 전이라 늘 비어 있어 뺀다. */
const CHART_DAYS = 7;

/** YYYY-MM-DD 로 만든다(로컬 기준). new Date().toISOString()은 UTC라 한국 새벽에 하루가 밀린다. */
const toDateStr = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function BranchDashboardTab({ branchName }: { branchName: string }) {
  const [loading, setLoading] = useState(true);
  const [notices, setNotices] = useState<any[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [history, setHistory] = useState<MasterDaily[]>([]);
  // 매출 조회 실패를 '기록 없음'으로 접으면 안 된다 — 지점이 "매출이 없었나?"로 오해한다(Codex 지적 2026-07-28).
  const [historyFailed, setHistoryFailed] = useState(false);
  // 매출 달력 — 보고 있는 달과 그 달의 기록. 달을 넘길 때마다 그 달 날짜만 다시 읽는다.
  const [calendarMonth, setCalendarMonth] = useState<string>(() => toDateStr(new Date()).slice(0, 7));
  const [calendarRows, setCalendarRows] = useState<MasterDaily[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarFailed, setCalendarFailed] = useState(false);
  const [expandedIssueIndexes, setExpandedIssueIndexes] = useState<Record<number, boolean>>({});
  const [noticeChecks, setNoticeChecks] = useState<Record<string, { name: string; checkedAt: string }>>({});
  const [noticeCheckNames, setNoticeCheckNames] = useState<Record<string, string>>({});
  const [pendingNoticeCheckId, setPendingNoticeCheckId] = useState<string | null>(null);
  const noticeCheckKey = `branch_notice_checks:${branchName}`;

  const getDateStr = (offsetDays = 0) => {
    const local = new Date();
    local.setDate(local.getDate() + offsetDays);
    return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
  };

  // 그래프가 보여줄 날짜(어제부터 7일). 이 목록이 곧 서버에서 읽을 문서 수다.
  //
  // 상태로 두고 load() 때마다 다시 만든다 — 지점은 화면을 하루 종일 열어 두므로,
  // 마운트 시점에 고정하면 자정을 넘겨도 어제 기준 날짜가 그대로 남는다(Codex 지적 2026-07-28).
  const [chartDates, setChartDates] = useState<string[]>(
    () => Array.from({ length: CHART_DAYS }, (_, index) => getDateStr(-(CHART_DAYS - index)))
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      // 새로고침할 때마다 '어제까지 7일'을 다시 계산한다(자정을 넘겨 열어 둔 화면 대응).
      const dates = Array.from({ length: CHART_DAYS }, (_, index) => getDateStr(-(CHART_DAYS - index)));
      setChartDates(dates);
      // 근로계약서는 ":" 키가 기준이고 "_" 키는 옛 클라이언트용 사본이다(LaborContractTab과 같은 규칙).
      // 문서 자체가 없을 때(null)만 옛 키를 본다 — 빈 배열([])은 "전부 지웠다"는 유효한 값이라 되살리면 안 된다.
      const readContracts = async (): Promise<LaborContract[]> => {
        const canonical = await gasClient.getSharedData<LaborContract[]>(`labor_contracts:${branchName}`).catch(() => null);
        if (canonical) return canonical;
        return (await gasClient.getSharedData<LaborContract[]>(`labor_contracts_${branchName}`).catch(() => null)) || [];
      };

      // 마감 제출 여부를 확인할 날짜 — 이번 달 1일부터 **어제까지**.
      // 오늘은 아직 마감 전이라 늘 비어 있으므로 뺀다. 오늘이 1일이면 어제가 지난달이라 확인할 날이 없다.
      const monthPrefix = toDateStr(new Date()).slice(0, 7);
      const yesterdayStr = getDateStr(-1);
      const closeDates = yesterdayStr.startsWith(`${monthPrefix}-`)
        ? Array.from({ length: Number(yesterdayStr.slice(8)) }, (_, index) => `${monthPrefix}-${String(index + 1).padStart(2, "0")}`)
        : [];

      const [savedNotices, roster, closeStatus, savedNoticeChecks, contracts, salesHistory] = await Promise.all([
        gasClient.getSharedData<any[]>("admin_notices").catch(() => []),
        gasClient.getBranchOwnRoster(branchName).catch(() => []),
        // 조회 실패를 '전부 제출됨'으로 접으면 안 된다 — 밀린 마감이 있는데 화면이 조용해진다.
        // 매출 그래프와 같은 규칙으로 성공 여부를 함께 들고 온다.
        closeDates.length === 0
          ? Promise.resolve({ ok: true as const, rows: [] as MasterDaily[] })
          : gasClient.getDailyMastersByDates(branchName, closeDates).then(
              (rows) => ({ ok: true as const, rows }),
              (error) => {
                console.warn("마감 제출 현황 조회 실패:", error);
                return { ok: false as const, rows: [] as MasterDaily[] };
              }
            ),
        gasClient.getSharedData<Record<string, { name: string; checkedAt: string }>>(noticeCheckKey).catch(() => ({})),
        readContracts(),
        // 그래프에 쓸 7일치만 문서 ID로 콕 집어 읽는다 — 지점 전체 히스토리를 훑지 않는다.
        // (옛 문서 4건을 규칙 ID로 옮겨 규칙 밖 문서가 0건임을 확인한 뒤 이 방식으로 바꿨다. 2026-07-28)
        // 실패는 삼키지 않는다: []를 받으면 "매출 0"과 구분할 수 없어 조회 실패가 조용히 묻힌다.
        gasClient.getDailyMastersByDates(branchName, dates).then(
          (rows) => ({ ok: true as const, rows }),
          (error) => {
            console.warn("매출 조회 실패:", error);
            return { ok: false as const, rows: [] as MasterDaily[] };
          }
        )
      ]);
      setNotices((Array.isArray(savedNotices) ? savedNotices : []).filter((notice) => !notice.targetBranch || notice.targetBranch === "전체" || notice.targetBranch === branchName));
      setNoticeChecks(savedNoticeChecks && typeof savedNoticeChecks === "object" ? savedNoticeChecks : {});
      setHistory(Array.isArray(salesHistory.rows) ? salesHistory.rows : []);
      setHistoryFailed(!salesHistory.ok);

      const nextIssues: Issue[] = [];
      // 이번 달 1일~어제 중 마감 기록이 없는 날. 조회가 실패했으면 '빠진 날 없음'으로 접지 않고 그 사실을 띄운다.
      if (!closeStatus.ok) {
        nextIssues.push({ type: "일일마감", message: "제출 현황을 불러오지 못했습니다 (새로고침해 주세요)", level: "info" });
      } else if (closeDates.length > 0) {
        const submitted = new Set(
          (closeStatus.rows || []).map((row) => String(row?.settleDate || "")).filter(Boolean)
        );
        const missingCloseDates = closeDates.filter((date) => !submitted.has(date));
        if (missingCloseDates.length > 0) {
          nextIssues.push({
            type: "일일마감",
            message: `${Number(monthPrefix.slice(5))}월 미제출`,
            names: missingCloseDates.map((date) => date.slice(5)),
            unit: "일",
            level: "info"
          });
        }
      }

      // 근로계약서를 이미 신청한 사람 — 이름+전화 뒤 8자리로 맞춘다.
      //
      // 이름만으로 맞추는 느슨한 판정은 **같은 이름이 하나뿐일 때만** 허용한다.
      // 동명이인 둘 중 한 명만 신청했는데 이름으로 통과시키면, 신청 안 한 사람이 목록에서 사라져
      // 근로계약서가 영영 만들어지지 않는다(Codex 지적 2026-07-28). 애매하면 '신청 필요'로 남기는 쪽이 안전하다.
      const contractKeys = new Set<string>();
      const contractNames = new Set<string>();
      const contractNameCounts = new Map<string, number>();
      (contracts || []).forEach((contract) => {
        const name = String(contract.name || "").trim();
        if (!name) return;
        contractNames.add(name);
        contractNameCounts.set(name, (contractNameCounts.get(name) || 0) + 1);
        // 전화가 비면 `이름|` 이 되어 사실상 이름 매칭과 같아진다 — 동명이인이 한 키로 뭉쳐
        // 한 명만 신청해도 둘 다 통과해 버린다. 전화가 있을 때만 키로 쓴다(Codex 지적 2026-07-28).
        const contractTail = toPhoneTail8(String(contract.phone || ""));
        if (contractTail) contractKeys.add(`${name}|${contractTail}`);
      });
      const rosterNameCounts = new Map<string, number>();
      (roster || []).forEach((employee: any) => {
        const name = String(employee.name || "").trim();
        if (name) rosterNameCounts.set(name, (rosterNameCounts.get(name) || 0) + 1);
      });

      const contractNeeded: string[] = [];
      (roster || []).forEach((employee: any) => {
        const name = String(employee.name || "").trim();
        if (!name) return;
        // 추가사유가 '신규입사'인 사람만 신청 대상이다.
        // 추가사유가 비어 있으면 신규입사인지 알 수 없어 그냥 넘어간다 — 2026-08-09 이전에는 이 경우를
        // '추가사유 선택 필요'로 따로 띄웠지만, 사용자 지시로 그 항목을 없앴다(직원현황에서 직접 확인).
        if (parseStaffAddReason(String(employee.addReason || "")) !== "신규입사") return;
        // 근로계약서 신청은 정직원만 한다 — 파트타이머는 지점이 양식을 내려받아 직접 작성한다(사용자 지시 2026-08-08).
        // division이 빈 옛 데이터는 계속 띄운다: 정직원인데 안 뜨는 쪽이 더 위험하다.
        // Firestore 명부는 정규화 없이 그대로 오므로(firebaseGetBranchOwnRoster) 공백 섞인 표기도 걸러지게 trim 후 비교한다(Codex 지적).
        if (String(employee.division || "").trim() === "파트타이머") return;
        const tail = toPhoneTail8(String(employee.phone || ""));
        // 이름이 명부에도 신청목록에도 하나뿐일 때만 이름 매칭을 믿는다.
        // 전화가 없는 동명이인은 어느 쪽도 확정할 수 없으므로 '신청 필요'로 남긴다 —
        // 잘못 띄우는 쪽이, 근로계약서가 영영 안 만들어지는 쪽보다 낫다.
        const nameIsUnique = (rosterNameCounts.get(name) || 0) <= 1 && (contractNameCounts.get(name) || 0) <= 1;
        const registered = (tail !== "" && contractKeys.has(`${name}|${tail}`))
          || (nameIsUnique && contractNames.has(name));
        if (!registered) contractNeeded.push(name);
      });
      if (contractNeeded.length > 0) {
        nextIssues.push({ type: "근로계약서", message: "근로계약서 신청 필요", names: contractNeeded, level: "warn" });
      }

      setIssues(nextIssues);
    } finally {
      setLoading(false);
    }
  }, [branchName, noticeCheckKey]);

  useEffect(() => {
    void load();
  }, [load]);

  // 최근 10일 매출. 기록이 없는 날은 total=null(미제출)로 두어 0원과 구분한다.
  const salesDays = useMemo(() => {
    const byDate = new Map<string, MasterDaily>();
    (history || []).forEach((row) => {
      if (row?.settleDate) byDate.set(String(row.settleDate), row);
    });
    return chartDates.map((date) => {
      const row = byDate.get(date);
      return { date, total: row ? masterTotal(row) : null };
    });
  }, [history, chartDates]);

  // ---- 매출 달력 ----
  // 그 달의 날짜만 문서 ID로 읽는다(최대 31건). 달을 넘길 때만 다시 읽는다.
  const calendarDates = useMemo(() => {
    const [year, month] = calendarMonth.split("-").map(Number);
    if (!year || !month) return [];
    const lastDay = new Date(year, month, 0).getDate();   // 다음 달 0일 = 이번 달 마지막 날
    return Array.from({ length: lastDay }, (_, index) => `${calendarMonth}-${String(index + 1).padStart(2, "0")}`);
  }, [calendarMonth]);

  useEffect(() => {
    let cancelled = false;
    if (calendarDates.length === 0) return;
    setCalendarLoading(true);
    setCalendarFailed(false);
    // 달력은 그 달 날짜만 읽는다(최대 31건). 달을 넘길 때만 다시 읽는다.
    gasClient.getDailyMastersByDates(branchName, calendarDates)
      .then((rows) => { if (!cancelled) setCalendarRows(Array.isArray(rows) ? rows : []); })
      .catch((error) => {
        if (cancelled) return;
        console.warn("매출 달력 조회 실패:", error);
        setCalendarRows([]);
        setCalendarFailed(true);
      })
      .finally(() => { if (!cancelled) setCalendarLoading(false); });
    return () => { cancelled = true; };
  }, [branchName, calendarDates]);

  const calendar = useMemo(() => {
    const byDate = new Map<string, number>();
    calendarRows.forEach((row) => {
      if (row?.settleDate) byDate.set(String(row.settleDate), masterTotal(row));
    });
    const totals = calendarDates.map((date) => byDate.get(date) ?? null);
    const recorded = totals.filter((value): value is number => value !== null);
    const monthTotal = recorded.reduce((sum, value) => sum + value, 0);
    // 최고·최저는 기록이 두 날 이상일 때만 뜻이 있다(하루뿐이면 같은 날이 최고이자 최저다).
    const highest = recorded.length > 1 ? Math.max(...recorded) : null;
    const lowest = recorded.length > 1 ? Math.min(...recorded) : null;

    // 달력 격자: 1일이 무슨 요일인지에 따라 앞을 비운다. 일요일 시작.
    const [year, month] = calendarMonth.split("-").map(Number);
    const leading = new Date(year, month - 1, 1).getDay();
    const cells: Array<{ date: string; day: number; total: number | null } | null> = [
      ...Array.from({ length: leading }, () => null),
      ...calendarDates.map((date, index) => ({ date, day: index + 1, total: totals[index] }))
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks: Array<Array<{ date: string; day: number; total: number | null } | null>> = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return { weeks, monthTotal, highest, lowest, recordedCount: recorded.length };
  }, [calendarDates, calendarRows, calendarMonth]);

  const shiftCalendarMonth = (delta: number) => {
    const [year, month] = calendarMonth.split("-").map(Number);
    const moved = new Date(year, month - 1 + delta, 1);
    setCalendarMonth(`${moved.getFullYear()}-${String(moved.getMonth() + 1).padStart(2, "0")}`);
  };

  const getNoticeId = (notice: any, index: number) => String(notice.id || `${notice.createdAt || "notice"}-${index}`);

  const handleConfirmNotice = async (noticeId: string) => {
    const name = String(noticeCheckNames[noticeId] || "").trim();
    if (!name) {
      window.alert("확인자 이름을 입력해주세요.");
      return;
    }
    const next = {
      ...noticeChecks,
      [noticeId]: { name, checkedAt: new Date().toISOString() }
    };
    setNoticeChecks(next);
    setPendingNoticeCheckId(null);
    setNoticeCheckNames((current) => ({ ...current, [noticeId]: "" }));
    await gasClient.saveSharedData(noticeCheckKey, next);
  };

  const handleCancelNotice = async (noticeId: string) => {
    const next = { ...noticeChecks };
    delete next[noticeId];
    setNoticeChecks(next);
    await gasClient.saveSharedData(noticeCheckKey, next);
  };

  return (
    <div className="branch-dashboard-tab space-y-4">
      {/* 제목 줄 — 카드를 없애고 한 줄로 줄였다(세로 공간 확보). 제목은 DESIGN.md §6 바닐라 알약. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* 공용 알약 제목은 h3로 쓴다 — DESIGN.md §6-0-2가 정한 형태이고, 다른 지점 탭도 모두 h3다. */}
        <h3 className="branch-pill-title">{branchName} 대시보드</h3>
        <button
          onClick={() => void load()}
          className="h-8 px-3 rounded-lg bg-[#212121] text-[#F6F5FA] text-[11px] font-black cursor-pointer"
        >
          새로고침
        </button>
      </div>

      {/* 상단 2열 — 미결 확인사항 · 관리자 공지 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="branch-dash-card branch-dash-issues">
          <div className="flex items-center justify-between gap-2">
            {/* 제목에는 아이콘을 넣지 않는다 — DESIGN.md §6 "텍스트만, 아이콘 금지". */}
            <h3 className="branch-pill-title">미결 확인사항</h3>
            <span className="text-[11px] font-black">{issues.length}건</span>
          </div>
          {loading ? (
            <div className="py-6 flex justify-center"><LoadingSpinner size="sm" /></div>
          ) : issues.length === 0 ? (
            <p className="text-[11px] font-bold py-2">확인이 필요한 미결사항이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-[#212121]/10">
              {issues.map((issue, index) => {
                const names = issue.names || [];
                const shown = expandedIssueIndexes[index] ? names : names.slice(0, 8);
                return (
                  // 이름을 줄바꿈해 아래에 두면 종류 칩과 같은 모양·같은 바탕이 위아래로 붙어 구분이 안 된다.
                  // 한 줄에 [종류] 내용 N명 · 이름들 순서로 붙이고, 이름 칩은 채운 배경으로 눌러 구분한다(사용자 지시).
                  <li key={index} className="py-2 first:pt-1 last:pb-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="branch-dash-chip">{issue.type}</span>
                      <span className="text-[11px] font-black">{issue.message}</span>
                      {names.length > 0 && <span className="text-[11px] font-bold opacity-60">{names.length}{issue.unit || "명"}</span>}
                      {shown.map((name) => (
                        <span key={name} className="branch-dash-name">{name}</span>
                      ))}
                      {names.length > shown.length && (
                        <button
                          type="button"
                          onClick={() => setExpandedIssueIndexes((current) => ({ ...current, [index]: true }))}
                          className="branch-dash-name underline cursor-pointer"
                        >
                          +{names.length - shown.length}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="branch-dash-card branch-dash-notices">
          <div className="flex items-center justify-between gap-2">
            <h3 className="branch-pill-title">관리자 공지</h3>
            <span className="text-[11px] font-black">{notices.length}건</span>
          </div>
          {loading ? (
            <div className="py-6 flex justify-center"><LoadingSpinner size="sm" /></div>
          ) : notices.length === 0 ? (
            <p className="text-[11px] font-bold py-2">등록된 공지사항이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-[#212121]/10">
              {notices.slice(0, 6).map((notice, index) => {
                const noticeId = getNoticeId(notice, index);
                const checked = noticeChecks[noticeId];
                return (
                  <li key={noticeId} className="py-2 first:pt-1 last:pb-1 space-y-1">
                    <p className="text-[11px] font-black">{notice.title || "공지사항"}</p>
                    {/* 본문은 두 줄까지만 — 카드를 컴팩트하게 유지한다. 전문은 관리자 공지 화면에서 본다. */}
                    <p className="text-[11px] font-bold leading-relaxed whitespace-pre-wrap line-clamp-2 opacity-80">
                      {notice.body || notice.content || ""}
                    </p>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {checked ? (
                        <>
                          <span className="text-[11px] font-black">확인자: {checked.name}</span>
                          <button type="button" onClick={() => void handleCancelNotice(noticeId)} className="branch-dash-mini-button">확인취소</button>
                        </>
                      ) : pendingNoticeCheckId === noticeId ? (
                        <>
                          <input
                            value={noticeCheckNames[noticeId] || ""}
                            onChange={(event) => setNoticeCheckNames((current) => ({ ...current, [noticeId]: event.target.value }))}
                            placeholder="확인자 이름"
                            className="h-8 w-28 rounded-lg border border-[#212121]/20 px-2 text-[11px] font-bold outline-none"
                          />
                          <button type="button" onClick={() => void handleConfirmNotice(noticeId)} className="branch-dash-mini-button">확인완료</button>
                        </>
                      ) : (
                        <button type="button" onClick={() => setPendingNoticeCheckId(noticeId)} className="branch-dash-mini-button">확인</button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* 아래 두 카드는 넓은 화면에서 한 줄로 나란히 둔다(사용자 지시).
          달력이 8열이라 좁아지면 읽기 어려우므로, 화면이 좁으면 세로로 쌓는다. */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.5fr)] gap-4 items-start">
      {/* 최근 일주일 매출 추이 */}
      <section className="branch-dash-card branch-dash-chart h-full">
        <div className="flex items-center justify-between gap-2">
          <h3 className="branch-pill-title">최근 일주일 매출</h3>
          <span className="text-[11px] font-bold opacity-60">천원 단위</span>
        </div>
        {loading ? (
          <div className="py-10 flex justify-center"><LoadingSpinner size="sm" /></div>
        ) : historyFailed ? (
          <p className="text-xs font-bold py-6 text-center text-[#8F1F1F]">
            매출 기록을 불러오지 못했습니다. 네트워크 확인 후 새로고침해 주세요.
          </p>
        ) : (
          <SalesTrendChart days={salesDays} />
        )}
      </section>

      {/* 매출 달력 — 한 달을 한눈에. 주간 합계와 최고·최저 날짜를 함께 표시한다. */}
      <section className="branch-dash-card branch-dash-calendar h-full">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="branch-pill-title">매출 달력</h3>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => shiftCalendarMonth(-1)} aria-label="이전 달" className="branch-dash-mini-button">‹</button>
            <span className="text-[11px] font-black tabular-nums">
              {calendarMonth.split("-")[0]}년 {Number(calendarMonth.split("-")[1])}월
            </span>
            <button type="button" onClick={() => shiftCalendarMonth(1)} aria-label="다음 달" className="branch-dash-mini-button">›</button>
          </div>
        </div>

        {calendarLoading ? (
          <div className="py-10 flex justify-center"><LoadingSpinner size="sm" /></div>
        ) : calendarFailed ? (
          <p className="text-xs font-bold py-6 text-center text-[#8F1F1F]">
            매출 달력을 불러오지 못했습니다. 네트워크 확인 후 새로고침해 주세요.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[11px] font-bold opacity-60">총 매출</span>
              <span className="text-[13px] font-black tabular-nums">{formatNumber(calendar.monthTotal)}원</span>
              <span className="text-[11px] font-bold opacity-60">기록 {calendar.recordedCount}일</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[460px] border-collapse text-[11px]">
                <thead>
                  <tr>
                    {["일", "월", "화", "수", "목", "금", "토"].map((label) => (
                      <th key={label} className="branch-dash-cal-head">{label}</th>
                    ))}
                    <th className="branch-dash-cal-head">주간합계</th>
                  </tr>
                </thead>
                <tbody>
                  {calendar.weeks.map((week, weekIndex) => {
                    const weekTotal = week.reduce((sum, cell) => sum + (cell?.total ?? 0), 0);
                    return (
                      <tr key={weekIndex}>
                        {week.map((cell, cellIndex) => (
                          <td
                            key={cellIndex}
                            className="branch-dash-cal-cell"
                            // 칸이 좁아 금액을 10px로 줄였으므로, 정확한 값은 마우스를 올려 확인할 수 있게 한다.
                            title={cell ? `${cell.date} · ${cell.total === null ? "일일마감 미제출" : `${formatNumber(cell.total)}원`}` : undefined}
                          >
                            {cell && (
                              <>
                                <span className="branch-dash-cal-day">{cell.day}</span>
                                {cell.total === null ? (
                                  <span className="branch-dash-cal-empty">미제출</span>
                                ) : (
                                  <>
                                    <span className="branch-dash-cal-amount tabular-nums">{formatNumber(cell.total)}</span>
                                    {calendar.highest !== null && cell.total === calendar.highest && <em className="branch-dash-cal-tag">최고</em>}
                                    {calendar.lowest !== null && cell.total === calendar.lowest && <em className="branch-dash-cal-tag">최저</em>}
                                  </>
                                )}
                              </>
                            )}
                          </td>
                        ))}
                        <td className="branch-dash-cal-cell branch-dash-cal-weektotal tabular-nums">
                          {weekTotal > 0 ? formatNumber(weekTotal) : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      </div>
    </div>
  );
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 최근 일주일 일매출 막대그래프. POS '매출현황' 화면의 형태를 따랐다(사용자 지시 2026-07-28).
 *
 * 한 계열(총매출)뿐이라 범례를 두지 않는다 — 제목이 계열 이름을 대신한다.
 * 값은 천원 단위로 **모든 막대 위에** 적는다(참고 화면과 같은 방식). 막대가 7개뿐이라 겹치지 않는다.
 * 색은 한 계열의 농담만 쓴다: 지난 날은 옅게, 가장 최근 날만 검정으로 짚어 준다.
 * 미제출은 색이 아니라 '막대 없음 + 미제출 글자 + 툴팁'으로 알린다(색만으로 구분하지 않기).
 */
function SalesTrendChart({ days }: { days: Array<{ date: string; total: number | null }> }) {
  // 매출 달력과 한 줄에 놓이므로 좁은 칸(대략 400px)을 기준으로 그린다.
  // viewBox가 칸보다 훨씬 넓으면 meet 규칙 때문에 그림이 통째로 축소돼 글자가 읽히지 않는다.
  const width = 380;
  const height = 210;
  const padLeft = 6;
  const padRight = 6;
  const plotTop = 32;     // 막대 위 값 라벨 자리
  const baseline = 162;
  const labelY = 180;     // 날짜
  const subLabelY = 193;  // 요일 / 미제출

  // 매출이 음수로 들어오는 일은 없어야 하지만, 들어오더라도 기준선 위 작은 양수 막대처럼 보이면 안 된다.
  // 막대 길이는 0으로 눕히고 실제 값은 라벨·툴팁에 그대로 적어 이상한 값임이 드러나게 한다(Codex 지적 2026-07-28).
  const values = days.map((day) => Math.max(0, day.total ?? 0));
  const max = Math.max(...values, 1);
  const lastRecordedIndex = days.reduce((found, day, index) => (day.total !== null ? index : found), -1);
  const slot = (width - padLeft - padRight) / days.length;
  const barWidth = Math.min(28, slot - 14);
  const hasAny = days.some((day) => day.total !== null);

  const dayNumber = (date: string) => Number(date.split("-")[2]);
  const weekday = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()];
  };
  // 천원 단위 — 참고 화면과 같은 표기. 반올림이라 정확한 값은 툴팁으로 본다.
  const thousands = (value: number) => Math.round(value / 1000).toLocaleString("ko-KR");

  if (!hasAny) {
    return <p className="text-[11px] font-bold py-6 text-center opacity-60">최근 일주일 매출 기록이 없습니다.</p>;
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-[210px]"
      role="img"
      aria-label={`최근 일주일 매출 추이(천원 단위). ${days.filter((d) => d.total !== null).length}일 기록됨.`}
    >
      {/* 기준선만 둔다 — 격자는 값 읽기를 돕지 않으면서 시선을 뺏는다. */}
      <line x1={padLeft} y1={baseline} x2={width - padRight} y2={baseline} stroke="#212121" strokeWidth={1} opacity={0.25} />
      {days.map((day, index) => {
        const x = padLeft + slot * index + (slot - barWidth) / 2;
        const missing = day.total === null;
        const value = day.total ?? 0;
        const barHeight = missing ? 0 : Math.max(3, Math.round(((baseline - plotTop) * Math.max(0, value)) / max));
        const y = baseline - barHeight;
        const isLatest = index === lastRecordedIndex;
        return (
          <g key={day.date}>
            <title>{`${day.date}(${weekday(day.date)}) · ${missing ? "일일마감 미제출" : `${formatNumber(value)}원`}`}</title>
            {!missing && (
              <>
                <rect x={x} y={y} width={barWidth} height={barHeight} rx={4} fill={isLatest ? "#212121" : "#E6EBF3"} />
                <text
                  x={x + barWidth / 2}
                  y={y - 6}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={isLatest ? 900 : 700}
                  fill="#212121"
                  opacity={isLatest ? 1 : 0.7}
                >
                  {thousands(value)}
                </text>
              </>
            )}
            <text x={x + barWidth / 2} y={labelY} textAnchor="middle" fontSize={10} fontWeight={isLatest ? 900 : 700} fill="#212121" opacity={missing ? 0.4 : 0.8}>
              {dayNumber(day.date)}일
            </text>
            <text x={x + barWidth / 2} y={subLabelY} textAnchor="middle" fontSize={9} fontWeight={700} fill="#212121" opacity={missing ? 0.4 : 0.5}>
              {missing ? "미제출" : `(${weekday(day.date)})`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
