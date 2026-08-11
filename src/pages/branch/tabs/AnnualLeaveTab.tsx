// src/pages/branch/tabs/AnnualLeaveTab.tsx
// 연차관리 탭 — 직원별 연차 현황 + 연차 사용 등록.
//
// [인원 출처] **정직원 급여대장**이다(2026-08-11 전환, 설계서:
//   docs/superpowers/specs/2026-08-11-연차관리-인원출처-급여대장-설계.md).
//   직원현황(branch_own_rosters)이 아니다 — 조회 규칙은 helpers/annualLeaveRoster 한 곳에만 있다.
//
// [권한] 급여대장은 급여·주민번호·계좌가 담긴 문서라 firestore.rules 가 급여권한 계정만 읽게 막는다.
//   따라서 인원·연차 표도 **급여권한 계정만** 본다(canReadSalaryBranch). 작성(연차 등록)은 거기에
//   더해 지점관리자·총괄(canWrite)이어야 한다.
//   월말 확인 컨트롤은 **항상 그리되**, 표를 못 보는 계정에게는 **누르지 못하게** 막는다 —
//   아무것도 못 본 확정이 매입매출·매출집계·파트타이머 마감을 열어 주면 확인 절차가 형식이 된다.
//   막힌 이유와 푸는 방법(총괄 대행 / 급여권한 부여)을 문구로 알려 준다(checkBlockedReason 주석).
//
// 부여/사용/잔여 계산은 관리자페이지 연차관리와 같은 저장소·같은 함수(annualLeavePolicy)를 쓴다 —
// 어느 화면에서 보든 숫자가 같아야 한다.
import { useState, useCallback, useEffect, useRef } from "react";
import { gasClient } from "../../../api/gasClient";
import { useAuthContext } from "../../../contexts/AuthContext";
import { canReadSalaryBranch, salaryAccessDenialMessage } from "../../../utils/salaryAccess";
import { toLocalDateInputValue } from "../helpers/formatters";
import { calcAutoGrantDays, mergeLegacyGrantOverrides, ANNUAL_LEAVE_GRANT_OVERRIDES_PREFIX, ANNUAL_LEAVE_USED_ADJUST_PREFIX, LEGACY_ANNUAL_LEAVE_GRANTS_PREFIX } from "../../../utils/annualLeavePolicy";
import { loadAnnualLeaveRoster, toAnnualLeaveMembers, fullTimeSalaryKey, findStrandedLeaveOwners, describeStrandedOwners, type AnnualLeaveMember } from "../helpers/annualLeaveRoster";
// 월말 확인 컨트롤 — '직원별 연차 현황' 밴드 우측에 붙는다(월말마감의 선행조건).
import { MonthlyCheckAction } from "../components/MonthlyCheckAction";
import { currentMonthValue } from "../helpers/monthlyCheckSections";

// isAdmin·moveTargets 는 더 이상 쓰지 않는다(지점변경 기능 제거, 2026-08-11).
// 호출부(BranchConfirmPage) 호환을 위해 타입에는 남기되 구조분해하지 않는다.
export function AnnualLeaveTab({ branchName, canWrite = false }: { branchName: string; isAdmin?: boolean; canWrite?: boolean; moveTargets?: string[] | "all" }) {
  const { user } = useAuthContext();
  // 급여대장을 읽을 수 있는가 = 인원·연차 표를 볼 수 있는가. 화면과 firestore.rules 가 같은 함수를 쓴다.
  const canRead = canReadSalaryBranch(user, branchName);
  // 작성은 '볼 수 있는 사람' 중 지점관리자·총괄만.
  const canEdit = canWrite && canRead;

  const [members, setMembers] = useState<AnnualLeaveMember[]>([]);
  // 인원을 실제로 가져온 달. 화면에 반드시 표시한다 — 없으면 "새로 뽑은 사람이 왜 안 보이나"에서 헤맨다.
  const [sourceMonth, setSourceMonth] = useState<string | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  // loadedBranch = 지금 화면에 든 데이터가 어느 지점 것인가. isLoaded = 그게 현재 지점과 일치하는가.
  // 지점이 바뀌면(예전에 불러왔던 지점으로 되돌아온 경우까지 포함) 아래 렌더-단계 리셋이 loadedBranch를
  // 즉시 null로 만든다 → 새 지점 값을 다시 받기 전까지 isLoaded=false로 저장이 막힌다.
  // (async load 안에서 리셋하면 지점 전환~이펙트 실행 사이 한 프레임의 창이 남아 stale 저장이 가능하므로,
  //  React "prop 바뀔 때 state 조정" 패턴으로 렌더 중 동기적으로 무효화한다.)
  // 월말 확인 컨트롤이 고른 달. 인원(급여대장)을 **그 달 기준**으로 뽑아야, 지점이 화면에서 본 달과
  // 확정하는 달이 같아진다(MonthlyCheckAction 의 onMonthChange 주석).
  const [checkMonth, setCheckMonth] = useState(() => currentMonthValue());
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // 지점이나 확인 월이 바뀌면 렌더 단계에서 즉시 무효화한다 — async load 안에서 리셋하면
  // 전환~이펙트 실행 사이 한 프레임의 창이 남아 옛 데이터 위에 저장이 통과할 수 있다.
  const dataKey = `${branchName}:${checkMonth}`;
  const [trackedKey, setTrackedKey] = useState(dataKey);
  if (trackedKey !== dataKey) { setTrackedKey(dataKey); setLoadedKey(null); setLoadFailed(false); }
  const isLoaded = loadedKey === dataKey;
  const [employeeId, setEmployeeId] = useState(""); const [startDate, setStartDate] = useState(toLocalDateInputValue()); const [endDate, setEndDate] = useState(toLocalDateInputValue()); const [reason, setReason] = useState("");
  // 부여일수 수동값·사용일수 보정값 — 관리자 연차관리와 같은 키를 읽어 어느 화면에서 보든 숫자가 같아야 한다.
  const [grantOverrides, setGrantOverrides] = useState<Record<string, number>>({});
  const [usedAdjusts, setUsedAdjusts] = useState<Record<string, number>>({});
  // 지점 전환 직후 옛 지점의 늦은 응답이 새 지점 화면에 스며들지 않게 순번을 매긴다(저장은 loadedBranch가 이미 막지만
  // 표시 숫자도 섞이면 관리자 화면과 어긋나 보인다 — Codex 지적 2026-08-04).
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoadFailed(false);
    // 권한이 없으면 **아예 조회하지 않는다.** getSharedData 는 읽기 거부를 캐시 폴백으로 삼켜 null 을
    // 돌려주므로, 그냥 부르면 "급여대장 미작성"으로 잘못 보인다(annualLeaveRoster 주석).
    if (!canRead) { setMembers([]); setSourceMonth(null); setEntries([]); setLoadedKey(dataKey); return; }
    try {
      // **전부 서버 전용**(...FromServer). 캐시 폴백을 쓰면 묵은 사용·잔여 숫자가 정상처럼 떠서
      // failed 가 서지 않고, 지점이 그 낡은 표를 보고 월말 확인(마감제출)을 눌러 버린다.
      // 인원(급여대장)만 서버로 읽고 연차 숫자는 캐시로 읽으면 구멍이 그대로 남는다(Codex 지적 2026-08-11).
      const [roster, saved, grants, legacyGrants, adjust] = await Promise.all([
        loadAnnualLeaveRoster(branchName, checkMonth),
        gasClient.getSharedDataFromServer<any[]>(`annual_leave:${branchName}`),
        gasClient.getSharedDataFromServer<Record<string, number>>(`${ANNUAL_LEAVE_GRANT_OVERRIDES_PREFIX}${branchName}`),
        gasClient.getSharedDataFromServer<Record<string, number>>(`${LEGACY_ANNUAL_LEAVE_GRANTS_PREFIX}${branchName}`),
        gasClient.getSharedDataFromServer<Record<string, number>>(`${ANNUAL_LEAVE_USED_ADJUST_PREFIX}${branchName}`),
      ]);
      if (seq !== loadSeqRef.current) return; // 더 새 조회가 시작됨 — 옛 결과는 버린다
      // 급여대장 조회 실패는 "인원 0명"과 반드시 구분한다 — 빈 화면으로 두면 저장이 기존 값을 지운다.
      // 실패하면 **불러온 표시를 반드시 거둔다**(아래 catch 도 같다). 이걸 빠뜨리면 한 번 성공한 뒤
      // [다시 시도]가 실패했을 때 loadedKey 가 남아 isLoaded 가 참으로 유지된다 —
      // "저장이 잠겼습니다" 배너를 띄운 채로 저장이 그대로 통과한다(Codex 지적 2026-08-11).
      if (roster.failed) { setLoadedKey(null); setLoadFailed(true); return; }
      setMembers(roster.members);
      setSourceMonth(roster.sourceMonth);
      setEntries(saved || []);
      setGrantOverrides(mergeLegacyGrantOverrides(legacyGrants, grants));
      setUsedAdjusts(adjust || {});
      setLoadedKey(dataKey);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      console.warn("연차관리 데이터를 불러오지 못했습니다(로그인 복원 대기 실패 등).", err);
      setLoadedKey(null);
      setLoadFailed(true);
    }
  }, [branchName, canRead, checkMonth, dataKey]);
  useEffect(() => { void load(); }, [load]);

  // 이 지점에 남아 있지만 지금 급여대장 인원에는 없는 사람의 연차 기록.
  // 급여대장에서 빠졌거나 다른 지점으로 옮겨 간 경우다 — 옮겨 간 지점에서는 사용 0일로 보이므로,
  // 기록이 사라진 게 아니라는 사실을 여기서 알려 준다(지우거나 자동으로 옮기지 않는다).
  const stranded = isLoaded && sourceMonth ? findStrandedLeaveOwners(entries, members) : [];

  // 등록은 트랜잭션 prepend — 읽어둔 목록 위에 통째 저장하면 다른 기기(관리자페이지 포함)가 방금 등록한 기록이 지워진다.
  const save = async () => {
    if (!isLoaded) { window.alert("연차 데이터를 아직 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요. (그대로 저장하면 기존 연차 기록이 지워질 수 있습니다.)"); return; }
    const days = Math.floor((new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86400000) + 1;
    if (!employeeId || days < 1 || !reason.trim()) return;
    if (!sourceMonth) { window.alert("급여대장을 찾지 못해 등록할 수 없습니다."); return; }
    // 고른 직원이 아직 급여대장에 있는지 **서버 기준**으로 확인한다. 화면 목록은 낡을 수 있어(다른 노트북이
    // 방금 행을 뺐을 수 있다) 그것만 믿으면 아무 행에도 안 보이는 고아 기록이 남는다.
    // 판정은 화면 목록과 **같은 변환 함수**를 쓴다 — 규칙이 갈라지면 "목록엔 있는데 등록은 거부"가 생긴다.
    // 조회 실패도 저장 금지(fail-closed).
    try {
      const [freshRows, freshRoster] = await Promise.all([
        gasClient.getSharedDataFromServer<any[]>(fullTimeSalaryKey(branchName, sourceMonth)),
        gasClient.getBranchOwnRosterFromServer(branchName).catch(() => [] as any[]),
      ]);
      if (!toAnnualLeaveMembers(freshRows, freshRoster).some((m) => m.employeeId === employeeId)) {
        window.alert("선택한 직원이 급여대장에 없습니다(다른 기기에서 빠졌을 수 있습니다). 목록을 새로 불러옵니다.");
        setEmployeeId("");
        void load();
        return;
      }
    } catch (err) {
      console.error("급여대장 확인 실패", err);
      window.alert("급여대장을 확인하지 못해 등록을 멈췄습니다. 네트워크 상태 확인 후 다시 시도해 주세요.");
      return;
    }
    const nextEntry = { id: `leave-${Date.now()}`, employeeId, days, startDate, endDate, date: startDate, reason: reason.trim() };
    try {
      await gasClient.mutateSharedData<any[]>(`annual_leave:${branchName}`, (current) => [nextEntry, ...(Array.isArray(current) ? current : [])]);
      setEntries((prev) => [nextEntry, ...prev]);
      setReason("");
    } catch (err) {
      console.error("연차 저장 실패", err);
      window.alert("연차 저장에 실패했습니다. 로그인 상태를 확인한 뒤 다시 시도해 주세요.");
    }
  };

  // 실패색은 hex 로 못 박는다 — `bg-rose-*`/`text-rose-*` 는 지점 스코프에서 바닐라·검정으로 치환돼
  // "저장이 잠겼다"는 경고가 평범한 안내로 보인다(DESIGN.md §11·§12). 파트타이머 급여대장의 실패 배너와 같은 조합.
  const failBanner = loadFailed && <div className="bg-[#FDE2E2] border border-[#C93A3A] text-[#B91C1C] text-xs font-bold rounded-xl p-3 flex items-center justify-between gap-3"><span>연차 데이터를 불러오지 못했습니다. 저장이 잠겼습니다(기존 기록 덮어쓰기 방지).</span><button onClick={()=>void load()} className="shrink-0 rounded-full bg-[#212121] text-[#F6F5FA] px-4 py-1.5 text-[11px] font-black">다시 시도</button></div>;

  // 표 위 안내 한 줄 — 어느 달 급여대장을 보고 있는지. 지점마다 기준월이 다를 수 있다.
  const sourceNote = (
    <div className="px-4 pt-3 text-[11px] font-bold text-gray-500">
      {!canRead
        ? "인원·연차 상세는 급여대장 열람 권한이 있는 계정만 볼 수 있습니다."
        : loadFailed ? "조회 실패"
        : !isLoaded ? "불러오는 중…"
        : !sourceMonth ? `${checkMonth}부터 3개월을 거슬러 봐도 작성된 정직원 급여대장이 없습니다. 월말마감 > 정직원 급여대장에 인원을 등록해 주세요.`
        : sourceMonth !== checkMonth ? `${checkMonth} 급여대장이 없어 ${sourceMonth} 기준으로 표시 중 · ${members.length}명`
        : `${sourceMonth} 정직원 급여대장 기준 · ${members.length}명`}
    </div>
  );

  // 확인 대상 표를 믿을 수 없으면 마감제출을 막는다.
  //
  // [권한 없음도 막는다 — 설계서 §6에서 뒤집힌 결정] 처음에는 데드락(급여권한 계정이 없는 지점이
  // 매입매출 마감까지 못 하게 되는 것)을 피하려고 권한 없는 계정에도 확인 버튼을 열어 두었다.
  // 그런데 그 계정은 **표를 한 줄도 못 본다.** 아무것도 못 본 확정이 월말마감 세 섹션을 열어 주므로
  // 확인 절차가 통째로 형식이 된다(Codex 지적 2026-08-11).
  // 데드락은 두 경로로 풀린다 — ① 총괄이 그 지점 화면에서 대신 확인 ② 지점관리자에게 급여권한 부여.
  // 그래서 '아무나 누를 수 있게' 두는 대신, 무엇을 해야 열리는지 문구로 알려 준다.
  //
  // [기준월이 다르면 막는다] 표는 확인하려는 달의 급여대장에서 인원을 뽑되, 그 달이 비어 있으면
  // 직전 달로 후퇴한다. 그 상태로 확정하면 **7월 인원을 보고 8월을 확인한 것**이 된다(Codex 지적).
  const checkBlockedReason = !canRead ? "급여대장 열람 권한이 없어 연차 현황을 볼 수 없습니다 — 권한 있는 계정으로 확인해 주세요"
    : loadFailed ? "연차 현황 조회 실패 — 확인 불가"
    : !isLoaded ? "연차 현황 불러오는 중"
    : !sourceMonth ? `${checkMonth} 정직원 급여대장이 없습니다 — 먼저 작성해 주세요`
    : sourceMonth !== checkMonth ? `${checkMonth}이 아닌 ${sourceMonth} 인원이 표시 중 — ${checkMonth} 정직원 급여대장을 작성해 주세요`
    : undefined;

  // 직원별 연차 현황 — 급여권한 계정만 표를 본다. 저장소가 관리자페이지와 같아 양쪽에 똑같이 반영된다.
  const statusCard = (
    <div className="branch-sheet-card">
      <div className="branch-band">
        <h3 className="branch-band-title">직원별 연차 현황</h3>
        {/* 제목 옆 부연은 뺀다(사용자 지시 2026-08-11) — 우측은 월말 확인 컨트롤 자리. */}
        <div className="branch-band-actions">
          <MonthlyCheckAction branchName={branchName} section="annualLeave" blockedReason={checkBlockedReason} onMonthChange={setCheckMonth} />
        </div>
      </div>
      {sourceNote}
      {/* 남겨진 기록 알림 — 주의색은 hex 로 못 박는다(지점 스코프가 유틸리티 색을 치환한다, DESIGN.md §11). */}
      {canRead && stranded.length > 0 && (
        <div className="mx-4 mt-2 rounded-xl border border-[#E0B33A] bg-[#FDF3C7] px-3 py-2 text-[11px] font-bold text-[#8A6100]">
          급여대장에 없는 직원의 연차 기록이 남아 있습니다 — {describeStrandedOwners(stranded)}. 급여대장에서 빠졌거나 다른 지점으로 옮긴 경우입니다. 기록은 지워지지 않았고, 급여대장에 다시 오르면 이어집니다.
        </div>
      )}
      {canRead && (
        <div className="branch-sheet-scroll">
          <table id="annual-leave-status-sheet" className="branch-sheet">
            <thead><tr><th>지점</th><th>직원</th><th>입사일</th><th>부여</th><th>사용</th><th>잔여</th><th>사용 날짜 기록</th></tr></thead>
            <tbody>
              {members.map((member) => {
                const logs = entries.filter((x) => x.employeeId === member.employeeId);
                const logsSum = logs.reduce((s, x) => s + Number(x.days || 0), 0);
                const used = Math.max(0, logsSum + Number(usedAdjusts[member.employeeId] ?? 0));
                const grant = grantOverrides[member.employeeId] ?? calcAutoGrantDays(member.entryDate) ?? 0;
                return (
                  <tr key={member.rowId} className="border-t">
                    {/* 지점은 글자만 — 지점 이동은 급여대장에서 한다(2026-08-11 기능 제거). */}
                    <td><span className="text-[11px] font-bold text-gray-600">{branchName}</span></td>
                    <td><span className="truncate font-bold">{member.name}</span></td>
                    <td>{member.entryDate ? String(member.entryDate).replace(/\./g,"-").slice(2).replace(/-/g,".") : "-"}</td>
                    <td>{grant}일</td>
                    <td>{used}일</td>
                    <td className="font-bold text-[#2E6DB4]">{grant - used}일</td>
                    <td className="text-xs text-gray-500">{logs.map((x) => `${x.startDate || x.date}${x.endDate && x.endDate !== (x.startDate || x.date) ? ` ~ ${x.endDate}` : ""}`).join(", ") || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // 볼 수 없는 계정: 이유를 알려 주고 현황 카드만(월말 확인 컨트롤은 그 안에 있어 누를 수 있다).
  if (!canRead) return (
    <div className="space-y-5" id="annual-leave-maintenance">
      <div className="rounded-xl border border-gray-200 bg-[var(--branch-ghost)] p-3 text-xs font-bold text-[#212121]/70">
        {salaryAccessDenialMessage(user, branchName)}
      </div>
      {statusCard}
    </div>
  );

  // 작성 권한이 없는 계정(일반 지점): 현황 열람만.
  if (!canEdit) return (
    <div className="space-y-5" id="annual-leave-maintenance">
      {failBanner}
      {statusCard}
    </div>
  );

  return (
    <div className="space-y-5" id="annual-leave-maintenance">
      {failBanner}
      <div className="branch-sheet-card">
        <div className="branch-band">
          <h3 className="branch-band-title">연차 사용 등록</h3>
          <p className="branch-band-meta">시작일과 종료일을 선택하면 사용 일수가 자동 계산됩니다. 인원은 정직원 급여대장에서 가져옵니다.</p>
        </div>
        <div className="flex flex-wrap gap-2 p-4">
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="border rounded px-3 py-2 text-xs font-bold">
            <option value="">직원 선택</option>
            {members.map((m) => <option key={m.rowId} value={m.employeeId}>{m.name}</option>)}
          </select>
          <label className="text-xs">시작일<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="block border rounded px-2 py-1"/></label>
          <label className="text-xs">종료일<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="block border rounded px-2 py-1"/></label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사용 사유" className="border rounded px-3"/>
          <button onClick={() => void save()} disabled={!isLoaded} title={!isLoaded ? "연차 데이터를 불러오는 중입니다." : undefined} className="bg-[#2E6DB4] text-white rounded px-4 text-[11px] font-black disabled:opacity-40 disabled:cursor-not-allowed">연차 사용 등록</button>
        </div>
      </div>
      {statusCard}
    </div>
  );
}
