// src/pages/branch/components/MonthlyCheckAction.tsx
// 비즈니스택시 '등록된 인원' · 연차관리 '직원별 연차 현황' 제목 밴드 **우측**에 붙는 월말 확인 컨트롤.
// 설계서: docs/superpowers/specs/2026-08-11-비즈니스택시-연차-마감확인-설계.md
//
// 지점이 그 표를 눈으로 확인하고 [마감제출]을 누르면 monthly_closings 에 기록이 남는다.
// 이게 없으면 월말마감(매입매출·매출집계·파트타이머) 제출이 막힌다(MonthlySettleTab 의 게이트).
//
// [배치] 별도 카드가 아니라 **밴드 안**이다(사용자 지시 2026-08-11). 조각(fragment)만 그리고
//   감싸는 `.branch-band-actions`(우측 정렬 슬롯)는 호출부가 준다 —
//   '등록된 인원' 밴드엔 이미 새로고침 버튼이 그 슬롯에 있어서, 같은 슬롯을 함께 써야 한 줄로 붙는다.
//
// [설계상 중요한 두 가지]
// 1) **확정해도 탭을 잠그지 않는다.** 택시 신청·연차 등록은 상시 업무라 잠그면 다음 달 초 업무가 막힌다.
// 2) **작성 권한과 무관하게 누를 수 있다.** 연차관리 탭은 작성이 지점관리자·총괄뿐인데, 확인까지 거기
//    묶으면 지점관리자 계정이 없는 지점은 매입매출 마감까지 데드락에 걸린다.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHECK_SECTION_LABEL, currentMonthValue, fetchCheckRecord, saveCheckClose,
  type CheckCloseRecord, type CheckSection,
} from "../helpers/monthlyCheckSections";

// 상태 알약 — 같은 화면(비즈니스택시 탭)의 STATUS_CHIP 과 같은 팔레트를 hex 로 못 박는다.
// 토큰(var(--branch-*))을 참조하면 팔레트 개정에 딸려가 연한 밴드 바탕과 구분이 사라진다(2026-08-04 실제 발생).
const PILL = "inline-block w-fit rounded-full px-2.5 py-0.5 text-[11px] font-black whitespace-nowrap";
const PILL_CONFIRMED = `${PILL} bg-[#CFDECA] text-[#212121]`;   // 완료
const PILL_PENDING = `${PILL} bg-[#EFF0A3] text-[#212121]`;     // 주의·미확인
const PILL_UNKNOWN = `${PILL} border border-gray-200 bg-white text-[#212121]/70`;

/** `2026-08-31T18:20:00.000Z` → `08-31 18:20` */
const formatConfirmedAt = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function MonthlyCheckAction({ branchName, section, blockedReason, onMonthChange }: {
  branchName: string;
  section: CheckSection;
  /**
   * 확인 대상 표를 **지금 믿을 수 없으면** 그 이유(짧게). `undefined` = 확인 가능.
   *
   * 이 버튼은 밴드 안에 있어 "이 표를 눈으로 봤다"는 뜻이다. 그런데 표가 조회에 실패했거나
   * 아직 안 떴거나 캐시에서 꺼낸 묵은 목록이면, 지점은 **아무것도 못 본 채** 확정하게 된다.
   * 그렇게 남은 '확정'은 월말마감을 열어 주므로, 확인 절차가 통째로 형식이 된다.
   * 그래서 호출부가 자기 표의 상태를 넘겨주고, 준비되지 않았으면 마감제출을 막는다(Codex 지적 2026-08-11).
   *
   * 마감취소는 막지 않는다 — 확인을 **거두는** 방향이라 게이트를 조이기만 한다(fail-closed).
   */
  blockedReason?: string;
  /**
   * 확인할 월이 정해질 때마다(첫 렌더 포함) 호출부에 알린다.
   *
   * 확인 대상 표가 '월'을 가진 화면(연차관리는 그 달 급여대장에서 인원을 뽑는다)은 **반드시 이 값에
   * 표를 맞춰야 한다.** 표가 7월 기준인데 이 컨트롤이 8월을 확정하면, 지점은 **보지도 않은 달**을
   * 확인한 것이 된다(Codex 지적 2026-08-11). 월이 다르면 호출부가 blockedReason 으로 막을 것.
   */
  onMonthChange?: (month: string) => void;
}) {
  const [month, setMonth] = useState(() => currentMonthValue());
  // 콜백을 ref 로 받아 둔다 — 의존성에 직접 넣으면 호출부가 인라인 함수를 넘길 때마다 다시 불린다.
  const onMonthChangeRef = useRef(onMonthChange);
  useEffect(() => { onMonthChangeRef.current = onMonthChange; });
  useEffect(() => { onMonthChangeRef.current?.(month); }, [month]);
  const [record, setRecord] = useState<CheckCloseRecord | null>(null);
  // 아직 한 번도 못 읽었으면 '미제출'로 단정하지 않는다 — 확인해 둔 지점에 미제출로 보이면
  // 다시 누르게 만들고, 그 저장이 손상된 문서를 건드릴 수도 있다.
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);

  // 지점·월을 빠르게 바꿀 때 늦게 도착한 옛 조회가 새 화면을 덮지 않도록 순번을 매긴다.
  const loadSeqRef = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoadError("");
    setLoaded(false);
    try {
      const rec = await fetchCheckRecord(branchName, month, section);
      if (seq !== loadSeqRef.current) return;
      setRecord(rec);
      setLoaded(true);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      console.warn("월말 확인 상태를 불러오지 못했습니다.", err);
      setRecord(null);
      // 문서 형식 손상처럼 '다시 시도해도 안 되는' 원인은 그 문구를 그대로 남긴다 —
      // 일반 안내로 덮으면 지점이 새로고침만 반복하고 본사에 알리지 않는다.
      setLoadError((err as any)?.message || "확인 상태를 불러오지 못했습니다.");
    }
  }, [branchName, month, section]);
  useEffect(() => { void load(); }, [load]);

  const confirmed = record?.status === "confirmed";
  const label = CHECK_SECTION_LABEL[section];

  const submit = async (next: "confirmed" | "pending") => {
    if (saving) return;
    // 화면에서 버튼을 잠그는 것과 별개로 여기서도 한 번 막는다 — 표가 실패로 바뀌는 순간과
    // 클릭이 겹치면 잠기기 전 클릭이 통과한다.
    if (next === "confirmed" && blockedReason) {
      window.alert(`${blockedReason}\n\n확인할 내용이 화면에 떠 있어야 마감제출할 수 있습니다.`);
      return;
    }
    const ask = next === "confirmed"
      ? `${month} ${label} 내용을 확인하셨습니까?\n\n확인하셨다면 마감제출됩니다. 확정 후에도 이 화면은 계속 사용할 수 있습니다.`
      : `${month} ${label} 마감을 취소할까요?\n\n취소하면 월말마감(매입매출·매출집계·파트타이머) 제출이 다시 막힙니다.`;
    if (!window.confirm(ask)) return;
    setSaving(true);
    // 저장을 시작한 시점의 조회 순번을 잡아 둔다. 지점·월·섹션이 바뀌면 load 가 다시 돌며 이 순번이
    // 올라가므로, 늦게 도착한 옛 저장 응답을 새 화면에 꽂는 일이 없다 —
    // A지점 저장 중 B지점으로 옮기면 B 밴드에 A의 '확정'이 뜬다(Codex 지적 2026-08-11).
    const seq = loadSeqRef.current;
    try {
      const saved = await saveCheckClose(branchName, month, section, next);
      if (seq !== loadSeqRef.current) return; // 화면이 다른 지점·월로 넘어갔다 — 서버에는 저장됐고 표시만 건너뛴다
      setRecord(saved);
      setLoaded(true);
    } catch (err) {
      console.error("월말 확인 저장 실패", err);
      // 낙관적 표시를 남기지 않는다 — 안 올라간 확인이 '확정'으로 보이면 지점은 게이트가 통과된 줄 알고
      // 마감이 막히는 이유를 못 찾는다. 서버 진실로 되돌린 뒤 실패를 알린다.
      // (밴드 안에는 배너를 놓을 자리가 없어 alert 로 알린다 — 놓치면 안 되는 실패다.)
      // 실패 알림은 화면이 넘어갔어도 띄운다 — 저장이 안 됐다는 사실은 지점이 반드시 알아야 한다.
      // 다만 되돌리기(load)는 **아직 같은 화면일 때만** 한다: 이미 다른 지점을 보고 있는데 여기서
      // load 를 부르면 그 지점 조회를 한 번 더 돌려 방금 그린 값을 흔든다.
      if (seq === loadSeqRef.current) await load();
      window.alert(`[${branchName} · ${month}] ` + ((err as any)?.message || "저장에 실패했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요."));
    } finally {
      setSaving(false);
    }
  };

  // 조회에 실패하면 상태를 아는 척하지 않는다 — 눌러도 되는지 알 수 없으므로 재시도만 내놓는다.
  if (loadError) {
    return (
      <button
        type="button" onClick={() => void load()} title={loadError}
        className="h-8 rounded-full border border-[#C93A3A] bg-[#FDE2E2] px-3.5 text-[11px] font-black text-[#B91C1C] cursor-pointer"
      >
        확인 상태 불러오기 실패 — 다시 시도
      </button>
    );
  }

  return (
    <>
      <input
        type="month"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        disabled={saving}
        aria-label={`${label} 확인할 월`}
        className="h-8 rounded-full border border-[#212121] bg-white px-2.5 text-[11px] font-bold text-[#212121] disabled:opacity-50"
      />
      <span className={!loaded ? PILL_UNKNOWN : confirmed ? PILL_CONFIRMED : PILL_PENDING}>
        {!loaded ? "확인 중…" : confirmed ? `확정 · ${formatConfirmedAt(record?.confirmedAt || "")}` : "미제출"}
      </span>
      {/* 마감취소는 확인을 거두는 방향이라 표 상태와 무관하게 열어 둔다(게이트를 조이기만 한다). */}
      {confirmed ? (
        <button
          type="button" onClick={() => void submit("pending")} disabled={saving || !loaded}
          title={`${month} ${label} 마감을 취소합니다`}
          className="h-8 rounded-full bg-slate-600 hover:bg-slate-700 px-3.5 text-[11px] font-black text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {saving ? "처리 중…" : "마감취소"}
        </button>
      ) : blockedReason ? (
        // 표를 못 본 상태다 — 버튼 글자에 이유를 그대로 적는다. 잠긴 채 '마감제출'만 떠 있으면
        // 지점은 왜 안 눌리는지 모르고 본사에 전화한다.
        <button
          type="button" disabled title={blockedReason}
          className="h-8 rounded-full border border-[#C93A3A] bg-[#FDE2E2] px-3.5 text-[11px] font-black text-[#B91C1C] cursor-not-allowed"
        >
          {blockedReason}
        </button>
      ) : (
        // 확인 상태 조회 전에도 잠근다 — 미제출로 보이는 확정건에 눌러 확정일시가 덮이는 걸 막는다.
        <button
          type="button" onClick={() => void submit("confirmed")} disabled={saving || !loaded}
          title={`${month} ${label} 내용을 확인했다면 누르세요 — 월말마감(매입매출·매출집계·파트타이머)의 선행조건입니다`}
          className="h-8 rounded-full bg-emerald-600 hover:bg-emerald-700 px-3.5 text-[11px] font-black text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {saving ? "제출 중…" : "마감제출"}
        </button>
      )}
    </>
  );
}
