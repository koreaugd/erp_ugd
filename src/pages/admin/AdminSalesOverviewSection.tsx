// src/pages/admin/AdminSalesOverviewSection.tsx
// 관리자 > 메인 > 대시보드 — 전지점 매출 종합.
//
// 대시보드에 있던 '전일' 성격 내용(미제출·현금차이·기타메모·마감 이상치)은 전일 정산현황 탭으로 옮겼고,
// 그 자리를 이 화면이 대신한다(2026-07-22 합의).
//
// 구성: [기간 버튼] [지점 드롭다운] → 카드 3개 → 선그래프(선택기간 + 직전 동기) → 지점별 순위표.
//
// [데이터 한계] ERP 일일마감에는 하루 총액만 있다. 시간대별 매출·주문 건수·객단가는 저장되지 않아
// 그런 지표는 만들 수 없다(참고 화면의 '주문 건'·'객단가'가 빠진 이유). '어제/오늘'은 하루라
// 선그래프가 점 하나가 되므로 차트만 최근 14일 추이로 대체한다.
//
// AdminPage.tsx 가 3,600줄이라 여기에 더 넣지 않고 별도 파일로 뺐다.
// 계산은 helpers/salesRollup.ts(순수 함수, 단위 검증됨)가 맡고 이 파일은 조회·표시만 한다.
//
// [P0-2] 조회 실패를 0원으로 채우지 않는다. getBranchHistory 는 실패를 []로 삼켜(gasClient) "매출 0원"과
// "못 읽음"이 구분되지 않으므로, 반드시 서버 전용 조회(getBranchHistoryFromServer)를 쓰고 실패는 null
// 센티넬로 받는다. 실패 지점이 하나라도 있으면 합계 카드에 '실제보다 적음'을 반드시 함께 띄운다
// (Codex 리뷰 지적 2026-07-22: 부분합을 정상 숫자처럼 보여주면 매출이 줄어든 것으로 오해한다).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { gasClient } from "../../api/gasClient";
import LoadingSpinner from "../../components/LoadingSpinner";
import { formatNumber } from "../../utils/formatNumber";
import { SalesLineChart } from "./SalesLineChart";
import { mapWithConcurrency } from "./helpers/mapWithConcurrency";
import {
  PERIOD_OPTIONS, buildBranchRow, buildPeriodPlan, deltaDirection, formatDelta, formatRangeLabel,
  seriesByDay, seriesByMonth, sortBranchRows, summarizeRange, totalsOf,
  type BranchSalesRow, type PeriodKey, type PeriodPlan, type SalesDailyRecord, type SalesTotals,
} from "./helpers/salesRollup";

const ALL_BRANCHES = "전체";

// 매출 순위에서 제외할 지점 — 매출을 올리지 않는 곳. 두면 항상 0원으로 꼴찌에 붙어 표만 길어진다.
// (월말마감 면제 목록과 값은 같지만 성격이 다른 정책이라 따로 둔다.)
const SALES_EXEMPT_BRANCHES = ["본사"];

// 동시 요청 상한(지점 단위 조회).
const FETCH_CONCURRENCY = 8;
// 지점 이력 캐시 유효시간 — 이 안에서는 기간을 바꿔도 다시 읽지 않고, 지나면 서버에서 새로 읽는다.
const CACHE_TTL_MS = 5 * 60 * 1000;

/** 증감 표시 — 관리자 스코프에서는 text-rose/emerald 가 전부 검정으로 치환되므로(index.css)
 *  색을 전용 클래스로 못 박고, 색이 죽어도 읽히도록 ▲/▼ 기호를 함께 붙인다(DESIGN.md §12). */
function DeltaText({ ratio }: { ratio: number | null }) {
  const direction = deltaDirection(ratio);
  const mark = direction === "up" ? "▲" : direction === "down" ? "▼" : "";
  return <span className={`admin-delta admin-delta-${direction} font-mono font-black`}>{mark}{formatDelta(ratio)}</span>;
}

interface BranchMeta { branchName: string; brand: string; }
/** 지점 1곳의 조회 결과. records === null 이면 서버에서 못 읽은 것(0원이 아니다). */
interface BranchBundle { meta: BranchMeta; records: SalesDailyRecord[] | null; }

export function AdminSalesOverviewSection() {
  const [periodKey, setPeriodKey] = useState<PeriodKey>("yesterday");
  const [branchFilter, setBranchFilter] = useState<string>(ALL_BRANCHES);
  const [bundles, setBundles] = useState<BranchBundle[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // 새로고침을 누르면 올려서 기간 플랜을 '지금' 기준으로 다시 계산한다.
  // 화면을 하루 넘게 켜 둔 노트북이 어제 기준을 붙잡고 있지 않게 하기 위함이다.
  const [freshness, setFreshness] = useState(0);

  // freshness 는 값을 쓰지 않고 '다시 계산하라'는 신호로만 쓴다(자정 경계 대응).
  const plan = useMemo<PeriodPlan>(() => buildPeriodPlan(periodKey, new Date()), [periodKey, freshness]);

  // 지점 단위 캐시(전체 이력 + 읽은 시각). 기간 버튼을 오가도 다시 읽지 않는다 — 서버 조회가 어차피
  // 지점 전체 이력을 내려주므로 월로 쪼개 캐시할 이유가 없다. 실패(null)는 캐시하지 않는다.
  // [P0-2] 단, 캐시는 CACHE_TTL_MS 가 지나면 버린다 — 세션 내내 재사용하면 다른 노트북에서 방금 확정한
  // 마감이 기간을 바꿔도 계속 안 보인다(Codex 지적). 수동 새로고침은 즉시 전체 무효화.
  const cacheRef = useRef(new Map<string, { records: SalesDailyRecord[]; at: number }>());
  // 늦게 도착한 옛 응답이 새 결과를 덮지 않게 하는 최신 요청 표식.
  const requestRef = useRef(0);

  const load = useCallback(async (activePlan: PeriodPlan) => {
    const requestId = ++requestRef.current;
    const isCurrent = () => requestRef.current === requestId;
    setLoading(true);
    setLoadError(false);
    try {
      const branchList = await gasClient.getBranchList();
      const targets: BranchMeta[] = (Array.isArray(branchList) ? branchList : [])
        .filter((branch: any) =>
          branch?.role === "branch" && branch.branchName &&
          !SALES_EXEMPT_BRANCHES.includes(String(branch.branchName).trim()))
        .map((branch: any) => ({ branchName: branch.branchName, brand: branch.brand || branch.branchName }));

      // [읽기 증폭 방지] 지점당 **한 번만** 전체 이력을 읽는다. getBranchHistoryFromServer 의 month 인자는
      // 서버 필터가 아니라 클라이언트 필터라(firebaseDirect L185-202), 월 단위로 나눠 부르면 같은 문서 전체를
      // 월 수만큼 중복 다운로드한다 — '올해'는 지점당 24회 = Firestore 일일 읽기 한도(5만)를 태우는 구조였다
      // (Codex stop 게이트 지적 2026-07-22). 월 구간 자르기는 어차피 summarizeRange/seriesBy* 가 로컬에서 한다.
      const fetched = await mapWithConcurrency(targets, FETCH_CONCURRENCY, async (branch) => {
        const cached = cacheRef.current.get(branch.branchName);
        if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
          return { branchName: branch.branchName, records: cached.records as SalesDailyRecord[] | null };
        }
        const records = await gasClient.getBranchHistoryFromServer(branch.branchName).catch(() => null);
        if (records !== null) cacheRef.current.set(branch.branchName, { records: records as SalesDailyRecord[], at: Date.now() });
        return { branchName: branch.branchName, records: records as SalesDailyRecord[] | null };
      }, isCurrent);
      if (!isCurrent()) return;

      const byBranch = new Map<string, SalesDailyRecord[] | null>();
      fetched.forEach((item) => { if (item) byBranch.set(item.branchName, item.records); });

      setBundles(targets.map((meta) => ({ meta, records: byBranch.get(meta.branchName) ?? null })));
    } catch (error) {
      // 지점 목록 자체를 못 읽은 경우 — 빈 표를 '매출 0원'으로 오해하지 않도록 에러를 명시한다.
      console.error("전지점 매출 집계 로드 실패:", error);
      if (!isCurrent()) return;
      setBundles([]); setLoadError(true);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(plan);
    // 언마운트 뒤 도착한 응답이 상태를 건드리지 않도록, 또 남은 조회가 더 시작되지 않도록 표식을 무효화한다.
    return () => { requestRef.current++; };
  }, [load, plan]);

  /** 수동 새로고침은 캐시를 버리고 서버에서 다시 읽는다 —
   *  다른 노트북에서 고친 매출이 캐시 때문에 안 보이면 P0-2 위반이다. */
  const refresh = () => {
    cacheRef.current.clear();
    setFreshness((value) => value + 1);
  };

  // 아래 파생값은 전부 '선택된 지점'만으로 다시 계산한다 — 표·카드·그래프가 같은 기준을 보게 하기 위함.
  // (지점을 골라도 그래프만 전 지점 합계로 남던 문제를 막는다.)
  const selected = useMemo(
    () => (branchFilter === ALL_BRANCHES ? bundles : bundles.filter((item) => item.meta.branchName === branchFilter)),
    [bundles, branchFilter]
  );
  const usableRecords = useMemo(
    () => selected.filter((item) => item.records !== null).map((item) => item.records as SalesDailyRecord[]),
    [selected]
  );
  const visibleRows = useMemo<BranchSalesRow[]>(
    () => sortBranchRows(selected.map((item) => buildBranchRow(item.meta.branchName, item.meta.brand, item.records, item.records, plan))),
    [selected, plan]
  );
  const visibleTotals = useMemo<SalesTotals | null>(() => {
    if (visibleRows.length === 0) return null;
    const delivery = usableRecords.reduce((sum, records) => sum + summarizeRange(records, plan.current).delivery, 0);
    return totalsOf(visibleRows, delivery, plan);
  }, [visibleRows, usableRecords, plan]);
  const chart = useMemo(() => {
    const series = plan.granularity === "month" ? seriesByMonth : seriesByDay;
    return { current: series(usableRecords, plan.chartCurrent), compare: series(usableRecords, plan.chartCompare) };
  }, [usableRecords, plan]);

  const money = (value: number) => `${formatNumber(value)}원`;
  const missing = visibleTotals?.errorBranches ?? 0;
  const showEmpty = plan.empty;
  // 고른 지점이 '전부' 실패면 합계는 0원이 아니라 아예 모르는 값이다.
  // 0원으로 보여 주면 매출이 없었던 날처럼 읽힌다(Codex 3R 지적).
  const noUsableData = visibleRows.length > 0 && missing === visibleRows.length;
  /** 카드에 금액을 적을 수 있는 상태인가 */
  const canShowMoney = !loading && !showEmpty && visibleTotals !== null && !noUsableData;

  /** 금액을 보여주는 카드는 실패 지점이 있으면 반드시 이 경고를 밑줄로 단다 —
   *  부분합을 정상 숫자처럼 보여주면 매출이 줄어든 것으로 오해한다(Codex 리뷰 2026-07-22).
   *  단 불러오는 중에는 직전 기간의 경고가 남지 않게 감춘다. */
  const cardNote = (fallback: ReactNode) =>
    !loading && missing > 0
      ? <small className="admin-kpi-warn">{missing}개 지점 확인 불가 — 실제보다 적은 금액입니다</small>
      : <small>{fallback}</small>;

  /** 카드 큰 숫자 자리 — 모르는 값을 0원으로 적지 않는다. */
  const cardValue = (render: () => string) =>
    loading ? "…" : showEmpty ? "—" : !canShowMoney ? "확인 불가" : render();

  return (
    <>
      <section className="admin-sales-filter-section bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setPeriodKey(option.key)}
                aria-pressed={periodKey === option.key}
                className={`admin-period-chip h-8 px-3.5 rounded-full text-[11px] font-black ${periodKey === option.key ? "is-active" : ""}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <select
            value={branchFilter}
            onChange={(event) => setBranchFilter(event.target.value)}
            className="h-8 rounded-lg border border-gray-200 px-2 text-[11px] font-bold"
            aria-label="지점 선택"
          >
            <option value={ALL_BRANCHES}>전체 지점</option>
            {bundles.map((item) => (
              <option key={item.meta.branchName} value={item.meta.branchName}>{item.meta.branchName}</option>
            ))}
          </select>
          <span className="text-[11px] font-bold text-gray-400">{formatRangeLabel(plan.current)}</span>
          <button onClick={refresh} disabled={loading} className="ml-auto h-8 px-3 rounded-xl bg-slate-100 text-slate-600 text-[11px] font-black disabled:opacity-50">
            {loading ? "불러오는 중…" : "새로고침"}
          </button>
        </div>
        {periodKey === "today" && (
          <p className="mt-2 text-[11px] font-bold text-gray-400">오늘은 아직 마감 전이라 대부분의 지점이 비어 있을 수 있습니다.</p>
        )}
        {periodKey === "thisYear" && (
          <p className="mt-2 text-[11px] font-bold text-gray-400">지점별 전체 이력을 한 번에 읽어 계산합니다. 한 번 읽은 지점은 새로고침 전까지 다시 읽지 않습니다.</p>
        )}
      </section>

      <section className="admin-kpi-grid admin-kpi-grid-3">
        <div className="admin-kpi-card admin-kpi-money admin-kpi-vanilla">
          <span>총매출</span>
          <strong>{cardValue(() => money(visibleTotals!.current))}</strong>
          {canShowMoney
            ? cardNote(<><DeltaText ratio={visibleTotals!.deltaRatio} /> {plan.compareLabel}</>)
            : <small>{showEmpty ? "아직 집계할 마감이 없습니다" : noUsableData && !loading ? "선택한 지점의 기록을 읽지 못했습니다" : formatRangeLabel(plan.current)}</small>}
        </div>
        <div className="admin-kpi-card admin-kpi-money admin-kpi-blue">
          <span>일평균</span>
          <strong>{cardValue(() => money(visibleTotals!.currentDailyAverage))}</strong>
          {canShowMoney
            ? cardNote(<><DeltaText ratio={visibleTotals!.dailyAverageDeltaRatio} /> {plan.compareLabel}</>)
            : <small>기간 전체 일수로 나눈 값</small>}
        </div>
        <div className="admin-kpi-card admin-kpi-money admin-kpi-white">
          <span>마감 제출률</span>
          <strong>{cardValue(() => `${visibleTotals!.closedDays}/${visibleTotals!.expectedDays}일`)}</strong>
          {canShowMoney
            ? cardNote(
                visibleTotals!.expectedDays > visibleTotals!.closedDays
                  ? `${visibleTotals!.expectedDays - visibleTotals!.closedDays}일 미제출 — 매출이 그만큼 적게 잡힙니다`
                  : "지점 × 날짜 기준 제출 현황"
              )
            : <small>지점 × 날짜 기준 제출 현황</small>}
        </div>
      </section>

      <section className="admin-sales-overview-section bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-[#2C3E50]">매출 추이</h2>
            <p className="text-xs text-gray-400 mt-1">
              {branchFilter === ALL_BRANCHES ? "전 지점 합계" : branchFilter} · {formatRangeLabel(plan.chartCurrent)}
              {plan.chartNote ? ` — ${plan.chartNote}` : ""}
            </p>
          </div>
        </div>
        {loadError ? (
          <p className="py-10 text-center text-xs font-black text-rose-600">
            지점 목록을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요. (매출을 집계하지 못했습니다.)
          </p>
        ) : loading ? (
          <div className="py-16 text-center"><LoadingSpinner size="sm" /></div>
        ) : (
          <SalesLineChart
            current={chart.current}
            compare={chart.compare}
            granularity={plan.granularity}
            compareLabel={plan.compareLabel.replace(" 대비", "")}
          />
        )}
      </section>

      <section className="admin-sales-overview-section bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-[#2C3E50]">지점별 매출 순위</h2>
            <p className="text-xs text-gray-400 mt-1">
              {formatRangeLabel(plan.current)} 매출을 {plan.compareLabel.replace(" 대비", "")}와 비교합니다.
            </p>
          </div>
        </div>

        {missing > 0 && !loading && (
          <p className="text-xs font-black text-rose-600">
            {missing}개 지점을 불러오지 못해 합계에서 빠졌습니다. 표 아래쪽 '확인 불가' 지점을 확인해주세요.
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="text-left">
              <tr>
                <th className="py-2 px-2 text-[11px] font-black text-[#212121] w-12">순위</th>
                <th className="py-2 px-2 text-[11px] font-black text-[#212121]">지점</th>
                <th className="py-2 px-2 text-[11px] font-black text-[#212121] text-right">매출</th>
                <th className="py-2 px-2 text-[11px] font-black text-[#212121] text-right">직전 동기</th>
                <th className="py-2 px-2 text-[11px] font-black text-[#212121] text-right">증감</th>
                <th className="py-2 px-2 text-[11px] font-black text-[#212121] text-right">일평균</th>
                <th className="py-2 px-2 text-[11px] font-black text-[#212121] text-right">마감일</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="py-10 text-center"><LoadingSpinner size="sm" /></td></tr>
              ) : visibleRows.length === 0 ? (
                <tr><td colSpan={7} className="py-10 text-center text-gray-400 text-xs">표시할 지점이 없습니다.</td></tr>
              ) : (
                visibleRows.map((row, index) => (
                  <tr key={row.branchName}>
                    <td className="py-1.5 px-2 font-mono font-bold text-gray-400">{row.error ? "-" : index + 1}</td>
                    <td className="py-1.5 px-2 font-bold text-[#2C3E50]">
                      {row.branchName}
                      <span className="ml-2 text-[11px] font-semibold text-gray-400">{row.brand}</span>
                    </td>
                    {row.error ? (
                      <td colSpan={5} className="py-1.5 px-2 text-right text-[11px] font-black text-rose-600">
                        확인 불가 — 서버에서 이 지점 기록을 읽지 못했습니다
                      </td>
                    ) : (
                      <>
                        <td className="py-1.5 px-2 text-right font-mono font-black text-[#1A3C6E]">{money(row.current)}</td>
                        <td className="py-1.5 px-2 text-right font-mono font-bold text-gray-500">{money(row.previous)}</td>
                        <td className="py-1.5 px-2 text-right"><DeltaText ratio={row.deltaRatio} /></td>
                        <td className="py-1.5 px-2 text-right font-mono font-bold text-gray-500">{money(row.dailyAverage)}</td>
                        <td className="py-1.5 px-2 text-right font-mono font-bold text-gray-500">{row.closedDays}일</td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
            {!loading && visibleTotals !== null && visibleRows.length > 0 && (
              <tfoot>
                <tr className="admin-sales-total-row">
                  <td className="py-2 px-2" />
                  <td className="py-2 px-2 text-[11px] font-black text-[#212121]">
                    합계{missing > 0 ? ` (확인 불가 ${missing}곳 제외)` : ""}
                  </td>
                  <td className="py-2 px-2 text-right font-mono font-black text-[#212121]">{money(visibleTotals.current)}</td>
                  <td className="py-2 px-2 text-right font-mono font-black text-[#212121]">{money(visibleTotals.previous)}</td>
                  <td className="py-2 px-2 text-right"><DeltaText ratio={visibleTotals.deltaRatio} /></td>
                  <td className="py-2 px-2" />
                  <td className="py-2 px-2" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </>
  );
}
