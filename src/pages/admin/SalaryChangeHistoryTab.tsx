// src/pages/admin/SalaryChangeHistoryTab.tsx
// 관리자 > 인사 > 급여 변동 이력 — 선택한 달과 전월을 비교해 '금액이 달라진 사람만' 보여준다(읽기 전용).
//
// AdminPage.tsx 가 7,000줄을 넘어 여기에 더 넣지 않고 별도 파일로 뺐다. 계산은 helpers/salaryDiff.ts
// (순수 함수, 단위 검증됨)가 맡고 이 파일은 조회·표시만 한다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Download, AlertTriangle } from "lucide-react";
import { gasClient } from "../../api/gasClient";
import LoadingSpinner from "../../components/LoadingSpinner";
import { formatNumber } from "../../utils/formatNumber";
import { addMonthsToMonthInputValue } from "../branch/helpers/formatters";
import { diffSalaryMonths, sortChanges, summarize, type ChangeKind, type SalaryChange, type SalaryRow } from "./helpers/salaryDiff";

const KIND_LABEL: Record<ChangeKind, string> = {
  raise: "인상", cut: "인하", new: "신규", noPrevRecord: "지난달 기록 없음", left: "퇴사(추정)",
};
// 색은 DESIGN.md 토큰을 따른다 — 임의 팔레트 금지.
const KIND_CHIP: Record<ChangeKind, string> = {
  raise: "bg-[var(--branch-vanilla)] text-zinc-900",
  cut: "bg-[var(--branch-honey)] text-zinc-900",
  new: "bg-white text-zinc-900",
  noPrevRecord: "bg-zinc-100 text-zinc-500",
  left: "bg-zinc-100 text-zinc-500",
};
const FILTERS: Array<{ key: "all" | ChangeKind; label: string }> = [
  { key: "all", label: "전체" }, { key: "raise", label: "인상" }, { key: "cut", label: "인하" },
  { key: "new", label: "신규" }, { key: "left", label: "퇴사(추정)" }, { key: "noPrevRecord", label: "지난달 기록 없음" },
];

export function SalaryChangeHistoryTab() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  // 결과와 '그 결과가 어느 달 것인지'를 항상 함께 들고 다닌다. 따로 두면 월을 빠르게 바꿨을 때
  // 표·엑셀 파일명은 새 달인데 내용은 이전 달인 상태가 만들어진다(급여 화면에선 치명적).
  const [data, setData] = useState<{ month: string; changes: SalaryChange[]; failed: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | ChangeKind>("all");
  const [branchFilter, setBranchFilter] = useState("all");
  // 요청 세대 번호: 늦게 끝난 옛 요청이 최신 결과를 덮어쓰지 못하게 한다.
  const loadGenRef = useRef(0);

  const load = useCallback(async () => {
    const gen = ++loadGenRef.current;
    const target = month; // 이 요청이 조회하는 달을 고정 — 도중에 month가 바뀌어도 결과는 이 달의 것이다.
    setLoading(true);
    setError("");
    try {
      const prevMonth = addMonthsToMonthInputValue(target, -1);
      const branchList = await gasClient.getBranchList();
      const branches = (branchList || []).filter((b: any) => b.role === "branch").map((b: any) => b.branchName).filter(Boolean);

      const failed: string[] = [];
      const results = await Promise.all(branches.map(async (branchName: string) => {
        try {
          // getSharedData(캐시 폴백 있음)를 쓰면 서버 읽기 실패가 '오래된 캐시'로 둔갑해 정상 조회처럼 보인다.
          // 급여 감사 화면에서 stale 숫자를 사실로 보여주면 안 되므로, 서버만 읽고 실패는 실패로 드러낸다.
          const [prev, curr] = await Promise.all([
            gasClient.getSharedDataFromServer<SalaryRow[]>(`monthly_fulltime_salary:${branchName}:${prevMonth}`),
            gasClient.getSharedDataFromServer<SalaryRow[]>(`monthly_fulltime_salary:${branchName}:${target}`),
          ]);
          return diffSalaryMonths(branchName, prev, curr, target);
        } catch {
          // 실패를 빈 결과로 돌려주면 '이 지점은 변동 없음'처럼 보인다 — 실패라고 말한다.
          failed.push(branchName);
          return [] as SalaryChange[];
        }
      }));
      if (loadGenRef.current !== gen) return; // 더 최신 요청이 진행 중 — 이 결과는 버린다.
      setData({ month: target, changes: sortChanges(results.flat()), failed });
    } catch (e) {
      if (loadGenRef.current !== gen) return;
      console.error("급여 변동 이력 로드 실패:", e);
      setError("급여 변동 이력을 불러오지 못했습니다. 네트워크 확인 후 다시 시도해주세요.");
      setData(null);
    } finally {
      if (loadGenRef.current === gen) setLoading(false);
    }
  }, [month]);

  useEffect(() => { void load(); }, [load]);

  const changes = data?.changes ?? null;
  const failedBranches = data?.failed ?? [];
  // 화면에 적히는 달은 '지금 불러와 있는 데이터의 달'이다. 월 선택칸(month)을 그대로 쓰면
  // 조회가 끝나기 전/실패했을 때 표 내용과 제목의 달이 어긋난다.
  const shownMonth = data?.month ?? month;
  const prevMonthLabel = addMonthsToMonthInputValue(shownMonth, -1);
  const stale = data != null && data.month !== month;

  const branchNames = useMemo<string[]>(
    () => Array.from(new Set<string>((changes || []).map((c) => c.branchName))).sort((a, b) => a.localeCompare(b, "ko")),
    [changes]
  );
  const visible = useMemo(
    () => (changes || []).filter((c) => (kindFilter === "all" || c.kind === kindFilter) && (branchFilter === "all" || c.branchName === branchFilter)),
    [changes, kindFilter, branchFilter]
  );
  const stats = useMemo(() => summarize(changes || []), [changes]);

  const downloadExcel = async () => {
    // 조회에 실패한 지점이 있으면 내보내지 않는다. 그 지점을 통째로 뺀 파일은 '변동 없음'과 구분되지 않아
    // 완성본처럼 보이고, 관리자가 누락을 모른 채 급여를 검토하게 된다.
    // (정직원급여 통합 다운로드 AdminPage.tsx 와 같은 규약 — 불완전한 파일은 만들지 않는다.)
    if (failedBranches.length) {
      window.alert(
        `다음 지점의 급여 자료를 서버에서 불러오지 못해 다운로드를 취소했습니다:\n${failedBranches.join(", ")}\n\n` +
        `네트워크 확인 후 '새로고침'을 눌러 다시 시도해주세요. (불완전한 파일은 만들지 않았습니다.)`
      );
      return;
    }
    if (stale) { window.alert(`선택하신 ${month} 자료를 아직 불러오지 못했습니다. '새로고침'을 눌러주세요.`); return; }
    if (!visible.length) { window.alert("내려받을 변동 내역이 없습니다."); return; }
    // 파일명도 반드시 '불러와 있는 달'로 — 선택칸 기준으로 지으면 다른 달 내용에 이 달 이름이 붙는다.
    const XLSX = await import("xlsx");
    const rows = visible.map((c) => ({
      "지점": c.branchName, "성명": c.name, "직급": c.rank, "구분": KIND_LABEL[c.kind],
      "전월 기본급": c.prevSalary ?? "", "이번달 기본급": c.currSalary ?? "", "차액": c.delta ?? "",
      "전월액 근거": c.prevSource === "document" ? "지난달 확정액" : c.prevSource === "declared" ? "지점 기입(전월급여 칸)" : "",
      "전월 총액": c.prevTotal ?? "", "이번달 총액": c.currTotal ?? "",
      "입사일": c.entryDate, "지점이 적은 전월급여": c.declaredPrev ?? "",
      "전월급여 불일치": c.prevMismatch ? "Y" : "", "동명이인 주의": c.ambiguous ? "Y" : "",
      "비고(급여대장)": c.memo,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "급여변동");
    // 화면 필터가 걸려 있으면 파일에 담기는 것도 그만큼이다 — 파일명에 남겨 '전체본'으로 오해하지 않게 한다.
    const suffix = [
      branchFilter === "all" ? "" : branchFilter,
      kindFilter === "all" ? "" : KIND_LABEL[kindFilter],
    ].filter(Boolean).join("_");
    XLSX.writeFile(wb, `급여변동이력_${shownMonth}${suffix ? `_${suffix}` : ""}.xlsx`);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-zinc-900">급여 변동 이력</h2>
          <p className="text-[11px] font-semibold text-zinc-400 mt-1">
            {prevMonthLabel} 대비 {shownMonth} · 기본급(이달 급여)이 달라진 정직원만 표시합니다. 읽기 전용입니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month" value={month} min="2020-01" max="2099-12"
            onChange={(e) => { if (e.target.value) setMonth(e.target.value); }}
            className="p-2 px-3 border border-gray-200 rounded-xl text-xs font-bold"
          />
          <button onClick={() => void load()} disabled={loading}
            className="p-2 px-3 rounded-xl border border-gray-200 text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-40">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> 새로고침
          </button>
          {/* 내보내면 안 되는 상태는 버튼부터 막는다: 다른 달을 보고 있거나(stale), 못 불러온 지점이 있을 때(불완전). */}
          <button onClick={() => void downloadExcel()} disabled={loading || stale || failedBranches.length > 0 || !visible.length}
            title={
              stale ? "선택한 달의 자료를 아직 불러오지 못했습니다."
              : failedBranches.length ? "불러오지 못한 지점이 있어 완전한 파일을 만들 수 없습니다. 새로고침 후 다시 시도해주세요."
              : undefined
            }
            className="p-2 px-3 rounded-xl bg-[#212121] text-white text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-40">
            <Download className="w-3.5 h-3.5" /> 엑셀 받기
          </button>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">{error}</div>}

      {stale && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>아래 내용은 <b>{shownMonth}</b> 기준입니다. 선택하신 {month} 자료는 아직 불러오지 못했습니다 — ‘새로고침’을 눌러주세요.</span>
        </div>
      )}

      {failedBranches.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>다음 지점은 급여 자료를 불러오지 못했습니다(변동 없음이 아닙니다): {failedBranches.join(", ")}. 새로고침을 눌러 다시 시도해주세요.</span>
        </div>
      )}

      {loading ? <LoadingSpinner /> : changes === null ? null : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {([
              ["인상", stats.raise, stats.raiseAmount], ["인하", stats.cut, stats.cutAmount],
              ["신규", stats.new, null], ["퇴사(추정)", stats.left, null], ["지난달 기록 없음", stats.noPrevRecord, null],
            ] as Array<[string, number, number | null]>).map(([label, n, amount]) => (
              <div key={label} className="rounded-xl border border-[#212121] bg-white px-3 py-2.5">
                <div className="text-[11px] font-black text-gray-800 leading-tight">{label}</div>
                <div className="text-xl font-black text-gray-900">{n}<span className="text-xs font-bold text-zinc-400 ml-0.5">명</span></div>
                {amount != null && amount !== 0 && (
                  <div className="text-[10px] font-mono font-bold text-zinc-500">{amount > 0 ? "+" : ""}{formatNumber(amount)}원</div>
                )}
              </div>
            ))}
          </div>

          {stats.mismatch > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {stats.mismatch}건은 지점이 급여대장에 적은 ‘전월급여’가 지난달 실제 확정액과 다릅니다(표에 ⚠로 표시).
                이 화면의 비교 기준은 지난달 확정액이며, 지점 입력값은 참고로만 보여줍니다.
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setKindFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-black border cursor-pointer ${
                  kindFilter === f.key ? "bg-[var(--branch-vanilla)] border-[#212121] text-zinc-900" : "bg-white border-gray-200 text-zinc-500"}`}>
                {f.label}
              </button>
            ))}
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}
              className="ml-auto p-2 px-3 border border-gray-200 rounded-xl text-[11px] font-bold">
              <option value="all">전체 지점</option>
              {branchNames.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
            <table className="w-full min-w-[1100px] text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">지점</th>
                  <th className="px-4 py-3 text-left">성명</th>
                  <th className="px-4 py-3 text-left">직급</th>
                  <th className="px-4 py-3 text-left">구분</th>
                  <th className="px-4 py-3 text-right">{prevMonthLabel}</th>
                  <th className="px-4 py-3 text-right">{shownMonth}</th>
                  <th className="px-4 py-3 text-right">차액</th>
                  <th className="px-4 py-3 text-left">비고 (급여대장)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.length === 0 ? (
                  <tr><td colSpan={8} className="px-5 py-16 text-center text-gray-400">
                    {prevMonthLabel} 대비 급여가 달라진 정직원이 없습니다.
                  </td></tr>
                ) : visible.map((c, i) => (
                  <tr key={`${c.branchName}-${c.name}-${c.kind}-${i}`} className="hover:bg-gray-50/60">
                    <td className="px-4 py-3 font-bold text-[#1A3C6E] whitespace-nowrap">{c.branchName}</td>
                    <td className="px-4 py-3 font-bold whitespace-nowrap">
                      {c.name}
                      {c.ambiguous && <span title="이 지점에 같은 이름이 2명 이상 있어 짝짓기가 확실하지 않습니다. 급여대장에서 직접 확인해주세요." className="ml-1 text-rose-600">⚠</span>}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{c.rank || "-"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full border border-zinc-900 px-2 py-0.5 text-[10px] font-black ${KIND_CHIP[c.kind]}`}>
                        {KIND_LABEL[c.kind]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-500">
                      {c.prevSalary == null ? "-" : formatNumber(c.prevSalary)}
                      {/* 확정액이 아니라 지점 기입값으로 비교한 행은 반드시 밝힌다 — 근거를 숨기면 확정액으로 오해한다. */}
                      {c.prevSource === "declared" && (
                        <span title="지난달 급여대장 문서가 없어, 이번 달 급여대장의 '전월급여' 칸(지점 기입값)과 비교했습니다."
                          className="ml-1 text-[9px] font-black text-zinc-400 align-middle">지점기입</span>
                      )}
                      {c.prevMismatch && (
                        <span title={`지점이 급여대장에 적은 전월급여는 ${formatNumber(c.declaredPrev || 0)}원입니다. 지난달 실제 확정액과 다릅니다.`}
                          className="ml-1 text-amber-600">⚠</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-black">{c.currSalary == null ? "-" : formatNumber(c.currSalary)}</td>
                    <td className={`px-4 py-3 text-right font-mono font-black ${c.delta == null ? "text-zinc-300" : c.delta > 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {c.delta == null ? "-" : `${c.delta > 0 ? "+" : ""}${formatNumber(c.delta)}`}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 max-w-[420px]">{c.memo || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[10px] font-semibold text-zinc-400 leading-relaxed">
            · 비교 기준은 <b>기본급(이달 급여)</b>입니다. 연장근무·상여금·택시비는 매달 달라지므로 변동 판정에 넣지 않았고, 엑셀에는 총액도 함께 담깁니다.<br />
            · 중도 입사·퇴사·파견으로 <b>일할 지급</b>한 달은 기본급 칸에 그 달 지급액이 들어 있어 다음 달에 큰 폭 인상으로 보일 수 있습니다. 비고를 함께 확인해주세요.<br />
            · ‘신규’는 입사일이 {shownMonth}인 사람만입니다. 입사일이 그 전인데 지난달 기록이 없으면 ‘지난달 기록 없음’으로 따로 묶었습니다(지난달 급여대장 미작성 가능성).<br />
            · 전월액은 <b>지난달 급여대장의 확정액</b>이 기준입니다. 지난달 문서가 없는 달은 이번 달 급여대장의 ‘전월급여’ 칸(지점 기입값)으로 비교하고 <b>지점기입</b>으로 표시합니다.
          </p>
        </>
      )}
    </div>
  );
}
