// src/pages/admin/AdminTaxiWorkCheckSection.tsx
// 관리자 > 일일업무 > 이상점검 — 지점 일일마감 근무시간 ↔ 법인택시 이용시각 대조(사용자 지시 2026-10-12). 조회 전용.
// 판정 규칙은 전부 helpers/taxiWorkCheck.ts(검증: scripts/verify-taxi-work-check.mts)에 있고 여기는 자료를 모아 그리기만 한다.
//
// [자료]
//   - 택시: getKakaoTaxiOrdersShared(월) — 법인택시 탭·대시보드와 같은 공유 캐시라 그쪽을 먼저 봤으면 바로 뜬다.
//     퀵·택배와 점검 제외 직원(본사 운영진)은 법인택시 이상 점검과 같은 기준으로 뺀다.
//   - 마감: 지점마다 그 달 날짜(+전날 1일, 1일 새벽 택시용)를 문서 ID 로 콕 집어 서버에서 읽는다
//     (getDailyMastersByDates — 캐시 폴백 없음, 실패는 던진다). 못 읽은 지점의 택시 건은 '근무 없음'이 아니라
//     '확인 불가'로 간다 — 읽기 실패가 억울한 표식으로 둔갑하면 안 된다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gasClient } from "../../api/gasClient";
import LoadingSpinner from "../../components/LoadingSpinner";
import { useAuthContext } from "../../contexts/AuthContext";
import { getAdminBranchList } from "./helpers/closedBranches";
import { toLocalDateInputValue, toLocalMonthInputValue } from "../branch/helpers/formatters";
import { getKakaoTaxiOrdersShared } from "./helpers/kakaoTaxiOrdersCache";
import { normalizeKakaoTaxiOrders, shortTimeText, taxiOrderKey } from "./helpers/kakaoTaxi";
import { excludeLogisticsOrders, isAnomalyExempt } from "./helpers/kakaoTaxiAnomaly";
import { KAKAO_TAXI_BRANCH_HISTORY_KEY, buildBranchHistoryMap, type KakaoTaxiBranchHistoryEntry } from "./helpers/kakaoTaxiBranchHistory";
import {
  BEFORE_CLOCK_OUT_EXEMPT_BRANCHES, WORK_CHECK_LABEL, checkTaxiAgainstWork, dateFromIndex, dayIndex, groupWorkCheckByReason,
  type SettleDay, type WorkCheckReason, type WorkCheckResult,
} from "./helpers/taxiWorkCheck";
import { isDateWithin, recentWindow, useNowMinute } from "./helpers/recentDays";

const ERROR_BANNER = "border rounded-xl px-4 py-3 text-xs font-bold bg-[#FDE2E2] border-[#C93A3A] text-[#B91C1C]";
const BRANCH_CONCURRENCY = 8;

// 카드 순서 — 사적 이용 의심이 큰 것부터, 확인 불가는 맨 아래(데이터 정비용).
// [출근길 카드 삭제](사용자 지시 2026-10-12) 화면에서만 뺀다. 판정(commute)은 helpers 에 그대로 둔다 —
// 규칙까지 지우면 출근 전에 탄 건이 '퇴근 전 탑승'으로 잘못 넘어온다(출근 전 시각 < 퇴근 시각이므로).
// scrollClass: 퇴근 전 탑승은 표 높이를 절반으로(사용자 지시 2026-10-12).
const CARD_ORDER: { reason: WorkCheckReason; note?: string; scrollClass?: string }[] = [
  { reason: "beforeClockOut", note: "마감 퇴근시각보다 10분 넘게 먼저 탑승 — 퇴근시각을 부풀렸거나 일찍 나간 경우", scrollClass: "max-h-[14rem]" },
  { reason: "noWork", note: "그날 마감에 근무가 없거나 휴무인데 이용" },
  { reason: "multiple", note: "같은 근무일에 2번 이상 이용 — 다른 카드와 겹칠 수 있음" },
  { reason: "unverifiable", note: "마감 미제출·이름 표기 불일치 등으로 비교하지 못한 건" },
];

// [재진입 즉시 표시] 결과를 이 창이 살아 있는 동안 계정·월별로 기억한다(초과근무일지와 같은 규칙).
// 택시(카카오 왕복 5~12초)와 전 지점 마감을 둘 다 받아야 비교할 수 있어 첫 조회는 기다려야 하지만,
// 다시 열면 바로 보인다. 5분이 지났으면 기억값을 먼저 보여주고 뒤에서 새로 읽는다.
// uid 없는 PIN 세션은 계정을 가를 수 없어 기억하지 않는다.
const SESSION_FRESH_MS = 5 * 60 * 1000;
const sessionResults = new Map<string, { results: WorkCheckResult[]; branchNames: string[]; errors: string[]; at: number }>();

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/** 그 달 날짜 + 전날 1일(1일 새벽 택시가 전월 말일 근무일 수 있다). 오늘 이후는 뺀다. */
function settleDatesForMonth(month: string): string[] {
  const first = dayIndex(`${month}-01`);
  const today = dayIndex(toLocalDateInputValue());
  if (first === null || today === null) return [];
  const dates: string[] = [];
  for (let d = first - 1; d <= today; d += 1) {
    const date = dateFromIndex(d);
    if (d >= first && date.slice(0, 7) !== month) break;
    dates.push(date);
  }
  return dates;
}

/** 마감 memo 의 METADATA.staffRows. 없거나 깨졌으면 null(구형 마감 — 근무 상세 없음). */
function staffRowsOf(memo: unknown): SettleDay["staffRows"] {
  const text = String(memo || "").split("\n---\nMETADATA:")[1];
  if (!text) return null;
  try {
    const meta = JSON.parse(text.trim());
    return Array.isArray(meta?.staffRows) ? meta.staffRows : null;
  } catch {
    return null;
  }
}

export function AdminTaxiWorkCheckSection({ taxiAllowed }: { taxiAllowed: boolean }) {
  const { user } = useAuthContext();
  const owner = user && user.loginType === "personal" && user.uid ? `uid:${user.uid}` : "";
  const [month, setMonth] = useState(() => toLocalMonthInputValue());
  const cacheKey = owner ? `${owner}|${month}` : "";
  const [branchFilter, setBranchFilter] = useState("");
  const [results, setResults] = useState<WorkCheckResult[]>(() => (cacheKey && sessionResults.get(cacheKey)?.results) || []);
  const [branchNames, setBranchNames] = useState<string[]>(() => (cacheKey && sessionResults.get(cacheKey)?.branchNames) || []);
  const [errors, setErrors] = useState<string[]>(() => (cacheKey && sessionResults.get(cacheKey)?.errors) || []);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const requestRef = useRef(0);
  useEffect(() => () => { requestRef.current += 1; }, []);

  const load = useCallback(async (forceRefresh = false) => {
    if (!taxiAllowed) return;
    const requestId = ++requestRef.current;
    const isCurrent = () => requestRef.current === requestId;
    setProgress({ done: 0, total: 0 });
    // 이 계정·이 달의 기억값이 있으면 그대로 둔 채 뒤에서 새로 읽는다. 없으면(다른 달로 바꿈 등) 비운다 —
    // 앞 달 결과가 새 달 결과처럼 보이면 안 된다.
    const cached = cacheKey ? sessionResults.get(cacheKey) : undefined;
    setResults(cached?.results || []);
    setErrors(cached?.errors || []);
    if (cached) setBranchNames(cached.branchNames);
    const problems: string[] = [];
    try {
      const branches = await getAdminBranchList();
      const targets: string[] = (Array.isArray(branches) ? branches : [])
        .filter((b: any) => b?.role === "branch" && b.branchName).map((b: any) => String(b.branchName));
      if (!isCurrent()) return;
      setBranchNames([...targets].sort((a, b) => a.localeCompare(b, "ko")));

      // 택시와 지점 변경 이력을 마감 조회와 동시에 출발시킨다(택시가 가장 느리다 — 카카오 왕복).
      const taxiPromise = getKakaoTaxiOrdersShared(month, user?.pinHash || "", forceRefresh);
      const historyPromise = gasClient.getSharedDataFromServer<KakaoTaxiBranchHistoryEntry[]>(KAKAO_TAXI_BRANCH_HISTORY_KEY)
        .catch(() => { problems.push("법인택시 지점 변경 이력(현재 부서 기준으로 대신 판정)"); return null; });

      const dates = settleDatesForMonth(month);
      const settles: SettleDay[] = [];
      const failedBranches = new Set<string>();
      let done = 0;
      setProgress({ done, total: targets.length });
      await runWithConcurrency(targets, BRANCH_CONCURRENCY, async (branchName) => {
        try {
          const masters = dates.length ? await gasClient.getDailyMastersByDates(branchName, dates) : [];
          for (const master of masters) {
            settles.push({ branchName, settleDate: String(master.settleDate || ""), staffRows: staffRowsOf(master.memo) });
          }
        } catch (error) {
          console.error(`이상점검 마감 조회 실패(${branchName}):`, error);
          failedBranches.add(branchName);
        }
        done += 1;
        if (isCurrent()) setProgress({ done, total: targets.length });
      });

      const [taxi, history] = await Promise.all([taxiPromise, historyPromise]);
      if (!isCurrent()) return;
      if ((taxi.accountErrors || []).length) {
        problems.push(`카카오T 계정 조회 실패(${taxi.accountErrors.map((e) => e.label || e.key).join(", ")}) — 그 계정 이용 건이 빠져 있음`);
      }
      if (failedBranches.size) problems.push(`마감 조회 실패: ${Array.from(failedBranches).join(", ")} — 이 지점 건은 '확인 불가'로 분류`);
      const rows = excludeLogisticsOrders(normalizeKakaoTaxiOrders(
        taxi.orders,
        Array.from(new Set([...targets, "본사"])),
        buildBranchHistoryMap(Array.isArray(history) ? history : []),
      )).filter((row) => !isAnomalyExempt(row.accountKey, row.order.member_id));
      const checked = checkTaxiAgainstWork({ rows, settles, failedBranches, loadedBranches: new Set(targets) });
      setResults(checked);
      setErrors(problems);
      // 실패가 섞인 결과는 기억하지 않는다 — 다음 진입 때 다시 읽어 스스로 낫게 한다(택시 공유 캐시와 같은 규약).
      if (cacheKey && problems.length === 0) {
        sessionResults.set(cacheKey, { results: checked, branchNames: [...targets].sort((a, b) => a.localeCompare(b, "ko")), errors: [], at: Date.now() });
      } else if (cacheKey) {
        sessionResults.delete(cacheKey);
      }
    } catch (error) {
      console.error("이상점검 조회 실패:", error);
      if (isCurrent()) {
        // 기억값을 띄워 둔 채 실패하면 옛 결과가 최신처럼 남는다 — 비우고 실패를 알린다.
        setResults([]);
        setErrors([...problems, "택시 이용내역을 불러오지 못했습니다. '새로고침'을 눌러주세요."]);
        if (cacheKey) sessionResults.delete(cacheKey);
      }
    } finally {
      if (isCurrent()) setProgress(null);
    }
  }, [month, taxiAllowed, user?.pinHash, cacheKey]);

  useEffect(() => {
    const cached = cacheKey ? sessionResults.get(cacheKey) : undefined;
    if (cached && Date.now() - cached.at < SESSION_FRESH_MS) {
      // 충분히 새것 — 다시 읽지 않는다(월을 바꿨다 돌아온 경우도 화면 값을 기억값으로 맞춘다).
      setResults(cached.results);
      setErrors(cached.errors);
      setBranchNames(cached.branchNames);
      return;
    }
    void load();
  }, [load, cacheKey]);
  // '최근 3일' 알약과 '최근 1일(어제·오늘)' 행 강조 — 기준은 helpers/recentDays 한 곳(KST 날짜, 1분 갱신,
  // 미래 날짜 제외). 법인택시 이상 점검 표와 같은 기준이다.
  // [2026-10-12 수정] 처음엔 '지금부터 24시간'으로 쟀는데, 오후에 보면 어제 오후 건이 이미 24시간을 넘어
  // 빠져서 카드에 따라 강조가 있기도 없기도 했다(사용자 지적: 일부 섹션에만 적용됨) — 날짜로 자른다.
  const nowMinute = useNowMinute();
  const recent = recentWindow(nowMinute);
  const isWithinLastDay = (timeText: string) => isDateWithin(timeText, recent.since1, recent.today);
  const isWithinRecent3Days = (timeText: string) => isDateWithin(timeText, recent.since3, recent.today);

  const loading = progress !== null;
  const groups = useMemo(() => groupWorkCheckByReason(
    branchFilter ? results.filter((r) => r.row.branchName === branchFilter) : results,
  ), [results, branchFilter]);

  if (!taxiAllowed) {
    return <div className={ERROR_BANNER}>법인택시 권한이 있어야 이상점검을 볼 수 있습니다.</div>;
  }

  const renderCard = (reason: WorkCheckReason, note?: string, scrollClass = "max-h-[28rem]") => {
    const list = groups[reason];
    // 퇴근 전 탑승은 '왜 일찍 탔는지'가 핵심이라 택시 이용사유(카카오T 앱 자유 입력) 칸을 내용 오른쪽에 둔다(사용자 지시 2026-10-12).
    // 근무 없는 날·하루 2회 이상도 사유를 봐야 판단되므로 같은 칸을 붙인다(사용자 지시 2026-10-21).
    const showUseCode = reason === "beforeClockOut" || reason === "noWork" || reason === "multiple";
    const colCount = showUseCode ? 8 : 7;
    return (
      <div key={reason} className="admin-sheet-card">
        <div className="admin-band">
          <h2 className="admin-band-title">{WORK_CHECK_LABEL[reason]} — {list.length}건</h2>
          {note && <p className="admin-band-meta">{note}</p>}
          {/* 제외 지점 안내 — 밴드 오른쪽 끝(법인택시 이상 점검 카드와 같은 자리·문구). 목록은 helpers 상수 그대로. */}
          {reason === "beforeClockOut" && (
            <p className="admin-band-meta ml-auto">제외 지점: {BEFORE_CLOCK_OUT_EXEMPT_BRANCHES.join(", ")}</p>
          )}
        </div>
        <div className={`admin-sheet-scroll ${scrollClass}`}>
          <table className="admin-sheet min-w-[980px]">
            <thead>
              <tr>
                <th className="w-28">이용일시</th>
                <th className="w-20">직원</th>
                <th className="w-28">택시 지점</th>
                {/* 폭은 내용만큼(w-px + 줄바꿈 금지 = 가장 긴 값에 맞춰 줄어든다, 사용자 지시 2026-10-12) */}
                <th className="w-px whitespace-nowrap">마감 근무</th>
                <th>내용</th>
                {showUseCode && <th>택시 이용사유</th>}
                <th>출발지 → 도착지</th>
                <th className="w-20 text-right">금액</th>
              </tr>
            </thead>
            <tbody>
              {loading && list.length === 0 ? (
                <tr><td colSpan={colCount} className="py-8 text-center"><LoadingSpinner size="sm" /></td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={colCount} className="py-8 text-center text-[11px] font-bold text-gray-400">해당 건이 없습니다.</td></tr>
              ) : list.map((r) => (
                <tr key={taxiOrderKey(r.row)} className={isWithinLastDay(r.row.timeText) ? "admin-row-highlight" : ""}>
                  <td className="font-mono text-[11px] whitespace-nowrap" title={r.row.timeText}>
                    {shortTimeText(r.row.timeText)}
                    {isWithinRecent3Days(r.row.timeText) && <span className="admin-recent-badge">최근 3일</span>}
                  </td>
                  <td className="font-black text-gray-800 whitespace-nowrap">{r.row.order.member_name || "(이름 없음)"}</td>
                  <td className="whitespace-nowrap">{r.row.branchName}</td>
                  <td className="w-px text-[11px] whitespace-nowrap">
                    {r.shift
                      ? <>{r.shift.settleDate.slice(5)} {r.shift.clockIn}~{r.shift.clockOut}{r.shift.branchName !== r.row.branchName ? ` (${r.shift.branchName})` : ""}</>
                      : <span className="text-gray-400">없음</span>}
                  </td>
                  <td className="text-[11px] font-bold text-gray-800">{r.notes[reason] || ""}</td>
                  {/* 옛 캐시·미배포 GAS 에는 use_code 가 없어 `|| ""` 필수(법인택시 화면과 같은 규칙) */}
                  {showUseCode && (
                    <td className="text-[11px] max-w-[12rem] truncate" title={r.row.order.use_code || ""}>
                      {r.row.order.use_code || <span className="text-gray-400">-</span>}
                    </td>
                  )}
                  <td className="text-[11px] max-w-[18rem] truncate" title={`${r.row.order.departure_point} → ${r.row.order.arrival_point}`}>
                    {r.row.order.departure_point} → {r.row.order.arrival_point}
                  </td>
                  <td className="text-right font-mono whitespace-nowrap">{r.row.amount.toLocaleString()}원</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* 조회 중에도 보인다 — 숨기면 옛 결과를 보는 동안 실패를 모른다(Codex 지적). */}
      {errors.length > 0 && (
        <div className={ERROR_BANNER}>{errors.map((e) => <p key={e}>{e}</p>)}</div>
      )}
      <div className="admin-sheet-card">
        <div className="admin-band">
          <h2 className="admin-band-title">근무시간 ↔ 법인택시 대조</h2>
          <div className="admin-band-filters">
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} aria-label="지점 필터" className="w-32">
              <option value="">전체 지점</option>
              {branchNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <button type="button" onClick={() => void load(true)} disabled={loading}>새로고침</button>
          </div>
          {loading && (
            <p className="admin-band-meta">
              불러오는 중 {progress && progress.total ? `마감 ${progress.done}/${progress.total} 지점` : "…"} · 택시 이용내역
            </p>
          )}
          {/* 월은 밴드 맨 오른쪽 — 초과근무일지와 같은 자리·같은 알약(order 를 인라인으로 줘야 밴드 CSS 를 이긴다) */}
          <div className="admin-band-filters ml-auto" style={{ order: 9 }}>
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="조회 월" disabled={loading} />
          </div>
        </div>
      </div>
      {CARD_ORDER.map(({ reason, note, scrollClass }) => renderCard(reason, note, scrollClass))}
    </div>
  );
}
