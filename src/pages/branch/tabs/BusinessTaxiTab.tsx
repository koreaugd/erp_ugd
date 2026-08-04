// src/pages/branch/tabs/BusinessTaxiTab.tsx
// 지점 > 인사·기타 > 비즈니스택시 — 카카오T 법인택시 이용신청(직원 등록 신청)과
// 우리 지점 등록 인원 확인, 인원 수정/삭제 요청(사유 필수), 내 신청 현황을 다룬다.
// 지점은 카카오를 직접 건드리지 않는다 — 신청만 남기고, 관리자가 법인택시 > 신청 관리에서
// 승인해야 실제 카카오 등록/삭제가 실행된다(설계서 blueprint-지점-비즈니스택시-신청.md).
import { useCallback, useEffect, useMemo, useState } from "react";
import { gasClient } from "../../../api/gasClient";
import type { KakaoTaxiMember, KakaoTaxiPhoneCheck } from "../../../api/gasClient";
import { useAuthContext } from "../../../contexts/AuthContext";
import LoadingSpinner from "../../../components/LoadingSpinner";
import {
  createBranchChangeRequest, createMemberRequest, createRegisterRequest, kakaoTaxiRequestsKey, makeRequestId,
  normalizePhone, REQUEST_TYPE_LABEL, sortRequests, type KakaoTaxiRequest,
} from "../../admin/helpers/kakaoTaxiRequests";
// 전입(다른 지점 직원을 우리 지점으로 데려오기)은 관리자 화면과 **같은 공용 헬퍼**를 쓴다 —
// 이력 선기록·실패 보정 규약이 한쪽만 달라지면 그 경로로 옮긴 직원의 과거 내역이 소급 집계된다.
import {
  KAKAO_TAXI_BRANCH_HISTORY_KEY, appendBranchHistoryOrWarn, appendBranchHistoryReversal,
  createBranchHistoryEntry, isKakaoWriteDefinitelyNotExecuted,
} from "../../admin/helpers/kakaoTaxiBranchHistory";
import { KAKAO_BRANCH_ALIASES } from "../../admin/helpers/kakaoTaxi";

// 오류/반려 표시는 DESIGN.md §11 오류색 hex 를 직접 쓴다(rose 계열은 스코프 치환으로 뒤집힐 수 있음).
const ERROR_BANNER = "border rounded-xl px-4 py-3 text-xs font-bold bg-[#FDE2E2] border-[#C93A3A] text-[#B91C1C]";

// 상태 알약. 지점 화면 색 규칙(DESIGN.md §11)을 따른다 —
// 완료·긍정은 honey, 주의·미확인은 vanilla, 처리 중은 alice.
// [P0] 상태 칩은 **옛 진한 값을 hex 로 박는다** — 토큰(var(--branch-*))을 참조하면 팔레트 개정
// (2026-08-04, 토큰이 연한 값으로 바뀜)에 딸려가 연한 바탕과 구분이 사라진다(실제 발생, Codex 지적).
// 상태 칩은 §2-1 "원래 채도 유지" 대상이라 팔레트 개정에서 의도적으로 제외한다.
// 반려만 오류색을 쓴다(이 화면의 ERROR_BANNER 와 같은 계열).
const STATUS_PILL = "inline-block w-fit rounded-full px-2 py-0.5 text-[11px] font-black";
const STATUS_CHIP: Record<string, string> = {
  waiting: `${STATUS_PILL} bg-[#EFF0A3] text-[#212121]`,
  done: `${STATUS_PILL} bg-[#CFDECA] text-[#212121]`,
  rejected: `${STATUS_PILL} bg-[#FDE2E2] text-[#B91C1C] border border-[#C93A3A]`,
  processing: `${STATUS_PILL} bg-[#D8DFE9] text-[#212121]`,
  // 판단할 근거가 없을 때. 좋다·나쁘다를 말하지 않는 중립 회색이라 오해를 만들지 않는다.
  unknown: `${STATUS_PILL} border border-gray-200 bg-[var(--branch-ghost)] text-[#212121]/70`,
};

const MEMBER_STATUS_LABEL: Record<string, string> = {
  created: "등록됨(미인증)", connected: "인증완료", refused: "거부", blocked: "이용중지",
};

const formatDateTime = (iso: string) => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  // 표 안에서는 세기(20)까지 적을 이유가 없어 연도를 두 자리로 줄인다 — `26-07-31 14:30`
  // (사용자 지시 2026-07-31). 일자·시각은 남긴다: 언제 올라온 신청인지가 처리 순서의 근거다.
  const yy = String(d.getFullYear()).slice(-2);
  return `${yy}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// 로컬(KST) 기준 오늘 — toISOString()은 UTC 라 자정 부근에 전날로 어긋난다.
const todayDateText = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

// 인원 행에서 올릴 수 있는 요청 종류.
//   · update       수정요청 — 이름·전화번호 정정
//   · branchChange 지점변경 — 다른 지점으로 옮김(계정 유지, 소속만 이동)
//   · delete       삭제요청 — **퇴사자 처리**. 승인해도 계정을 지우지 않고 인증만 해제(휴직)한다.
//     지점 목록에서는 사라지고 택시도 못 타지만, 과거 이용내역은 남는다.
//     (2026-07-29에 '진짜 삭제'라서 폐지했다가, 퇴사자 처리 통로가 없어 헷갈린다는 지적으로
//      2026-07-31에 '이용 중지' 뜻으로 되살렸다.)
type MemberRequestType = "update" | "branchChange" | "delete";

// 사전 확인에서 "이미 등록된 사람을 찾았다"로 좁힌 결과 — 전입 처리에 필요한 필드가 모두 있다.
type FoundPhoneCheck = Extract<KakaoTaxiPhoneCheck, { found: true }>;

export function BusinessTaxiTab({ branchName }: { branchName: string }) {
  const { user } = useAuthContext();
  const pinHash = user?.pinHash || "";
  const requestsKey = kakaoTaxiRequestsKey(branchName);

  const [requests, setRequests] = useState<KakaoTaxiRequest[] | null>(null);
  const [requestsError, setRequestsError] = useState("");
  // **서버가 준 그대로**(이용중지 포함). 화면 목록에서는 이용중지를 빼지만, 신청 현황의 상태를
  // 판정할 때는 "목록에 없다(=인증 전)"와 "이용중지됐다"를 갈라야 하므로 원본이 필요하다.
  const [allMembers, setAllMembers] = useState<KakaoTaxiMember[] | null>(null);
  const [membersError, setMembersError] = useState("");
  // 이용 중지(휴직)된 인원은 지점 화면 목록에 보여주지 않는다(사용자 지시 2026-07-31) —
  // 퇴사 처리한 사람이 목록에 남아 있으면 아직 쓰는 사람으로 오해한다.
  const members = useMemo(
    () => (allMembers === null ? null : allMembers.filter((m) => m.status !== "blocked")),
    [allMembers]
  );
  /** 이용중지된 인원 — 위 목록에서는 빠지지만, 복귀 시 이용재개를 신청할 수 있게 따로 모은다. */
  const blockedMembers = useMemo(
    () => (allMembers || []).filter((m) => m.status === "blocked"),
    [allMembers]
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 이용신청 폼
  const [regName, setRegName] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regMemo, setRegMemo] = useState("");

  // 수정요청/변경신청 폼 — 인원 행의 드롭다운에서 종류를 고르면 열린다. 사유 필수.
  const [requestTarget, setRequestTarget] = useState<{ member: KakaoTaxiMember; type: MemberRequestType } | null>(null);
  const [requestReason, setRequestReason] = useState("");
  // 변경신청 전용 — 옮겨간 지점(모르면 빈값)과 이동일(이 날짜부터 새 지점으로 집계)
  const [requestTargetBranch, setRequestTargetBranch] = useState("");
  const [requestEffectiveDate, setRequestEffectiveDate] = useState("");
  // 변경신청의 지점 선택지 — 실패해도 신청 자체는 막지 않는다(지점을 '모름'으로 두면 관리자가 지정)
  const [erpBranches, setErpBranches] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    gasClient.getBranchList()
      .then((list) => {
        if (!alive) return;
        setErpBranches(Array.from(new Set([
          ...(list || []).filter((b) => b.role === "branch").map((b) => b.branchName).filter(Boolean),
          "본사",
        ])).filter((b) => b !== branchName).sort((a, b) => a.localeCompare(b, "ko")));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [branchName]);

  // forceRefresh=true 는 '새로고침' 버튼 전용 — 백엔드 캐시를 우회해 카카오에서 실시간으로
  // 인원을 다시 읽는다. 직원이 방금 카카오T 인증을 마쳐 목록에 아직 안 뜰 때 즉시 반영하기 위함.
  const load = useCallback(async (forceRefresh?: boolean) => {
    setLoading(true);
    setRequestsError("");
    setMembersError("");
    // **두 조회를 같이 기다리지 않는다.**
    // 등록 인원은 카카오 API 를 타서 느리다(실측 첫 조회 7.7초, 캐시가 살아 있어도 2.7초).
    // 신청 현황은 1.4초면 온다. 종전에는 Promise.allSettled 로 둘을 함께 기다려,
    // 빠른 쪽까지 느린 쪽에 묶여 탭이 7초 넘게 비어 있었다(사용자 지적 2026-07-31).
    // 이제 각자 끝나는 대로 화면에 올린다 — 신청 현황이 먼저 뜨고 인원 목록이 뒤따른다.
    const requestsTask = gasClient.getSharedDataFromServer<KakaoTaxiRequest[]>(requestsKey)
      .then((value) => {
        setRequests(Array.isArray(value) ? sortRequests(value) : []);
      })
      .catch((error) => {
        console.error("비즈니스택시 신청 현황 로드 실패:", error);
        setRequests(null);
        setRequestsError("신청 현황을 불러오지 못했습니다. 네트워크 확인 후 새로고침해주세요.");
      });
    const memResult = await gasClient.getKakaoTaxiBranchMembers(branchName, pinHash, forceRefresh)
      .then((value) => ({ status: "fulfilled" as const, value }))
      .catch((reason) => ({ status: "rejected" as const, reason }));
    if (memResult.status === "fulfilled") {
      setAllMembers(memResult.value || []);
    } else {
      console.error("비즈니스택시 등록 인원 로드 실패:", memResult.reason);
      setAllMembers(null);
      const raw = String((memResult.reason as any)?.message || "");
      // "지점 인증에 실패" 의 원인은 하나가 아니다 — 열어 둔 화면의 인증값이 옛 것이거나,
      // 지점설정에 그 지점 행이 없거나(개발서버는 db_simulation.json 을 보므로 운영에만 있는
      // 지점은 여기서 걸린다), PIN 이 실제로 다르거나. 원인을 단정해 적으면 오히려 헤매게 되므로
      // (2026-07-31 오진) 가장 흔한 조치만 안내하고 원인은 단정하지 않는다.
      setMembersError(
        raw.includes("지점 인증")
          ? "지점 인증이 확인되지 않아 목록을 불러오지 못했습니다. 왼쪽 아래 [마감 보안 로그아웃]으로 나갔다가 다시 로그인해주세요. 그래도 같으면 관리자에게 이 지점의 PIN 등록 여부를 확인해주세요."
          : raw || "등록 인원을 불러오지 못했습니다. 새로고침해주세요."
      );
    }
    // 신청 현황 쪽은 이미 각자 화면에 올렸지만, **버튼을 풀기 전에 그쪽도 끝나기를 기다린다.**
    // 등록 인원만 끝났다고 버튼을 살리면, 아직 오가는 중인 신청 현황 요청 위에 새 요청이 겹쳐
    // 늦게 도착한 옛 응답이 최신 목록을 덮을 수 있다(Codex 2026-07-31).
    await requestsTask;
    setLoading(false);
  }, [requestsKey, branchName, pinHash]);

  useEffect(() => { void load(); }, [load]);

  /**
   * 신청 저장은 **원자적 append** 로 한다(Firestore 트랜잭션).
   * 배열 전체를 읽어 고쳐 쓰면, 두 사람이 거의 동시에 제출했을 때 나중 저장이 먼저 신청을
   * 통째로 덮어써 사라진다. 트랜잭션 안에서 최신 배열을 다시 읽어 중복 확인 후 이어붙이므로
   * 동시 제출도 둘 다 남고, 다른 기기가 방금 올린 같은 신청도 중복으로 걸러진다.
   */
  const appendRequest = async (request: KakaoTaxiRequest) => {
    const { outcome, list } = await gasClient.appendSharedArrayItem(
      requestsKey,
      request as unknown as Record<string, unknown>,
      {
        // 처리 전(대기·처리중) 상태의 같은 종류 요청이 이미 있으면 중복
        statuses: ["pending", "processing"],
        match: request.type === "register"
          ? { type: "register", phone: request.phone }
          : { type: request.type, memberId: request.memberId },
      }
    );
    setRequests(sortRequests((list || []) as KakaoTaxiRequest[]));
    if (outcome === "duplicate") {
      throw new Error(request.type === "register"
        ? "같은 휴대전화번호의 이용신청이 이미 접수되어 있습니다."
        : "이 인원에 대한 같은 요청이 이미 접수되어 있습니다.");
    }
  };

  /**
   * 전입 — 같은 번호가 다른 지점에 이미 등록돼 있을 때, 직원을 지우지 않고 **소속만** 우리 지점으로 옮긴다.
   *
   * 순서가 곧 안전장치다: ①이력 선기록 → ②카카오 반영 → ③신청 현황 기록.
   * 이력을 먼저 남기지 않으면 과거 이용내역까지 우리 지점으로 소급 집계된다(이 기능의 핵심 위험).
   * 이력 기록에 실패하면 카카오를 아예 부르지 않고 멈춘다(아무것도 안 바뀐 상태라 재시도가 깨끗하다).
   */
  const transferFoundMember = async (check: FoundPhoneCheck) => {
    const today = todayDateText();
    // fromBranch = 카카오 **부서 원문**(departmentRaw). 이력·대조 모두 이 값을 쓴다 —
    // 관리자 승인 경로(member.department)와 같은 의미여야 두 경로가 같은 뜻의 이력을 남긴다.
    // 부서가 비어 있으면 빈 문자열 그대로 남겨 '그때는 소속이 없었다'로 읽히게 한다(Codex 지적 2026-07-30):
    // 그룹명으로 보완한 값을 넣으면 그 직원의 과거 이용이 실제와 다른 지점으로 굳는다.
    // 화면 문구에는 보완된 표기(check.department)를 써서 "어디 소속인지"를 사람이 알아볼 수 있게 한다.
    const fromBranch = check.departmentRaw || "";
    const fromLabel = (fromBranch && (KAKAO_BRANCH_ALIASES[fromBranch] || fromBranch))
      || check.department
      || "소속 미지정";
    if (!window.confirm(
      `${check.name || "이 직원"} 님(${check.phone})은 현재 '${fromLabel}' 소속입니다.\n\n` +
      `우리 지점(${branchName})으로 데려올까요?\n\n` +
      `· 오늘(${today})부터의 이용이 우리 지점으로 집계됩니다.\n` +
      `· 이전 이용은 '${fromLabel}'에 그대로 남습니다.\n` +
      `· 직원 계정은 삭제되지 않고 소속만 바뀌며, 인증 알림톡은 다시 보내지 않습니다.`
    )) return;

    // ① 이력 선기록 — fromBranch 는 카카오 부서 '원문'을 그대로 남긴다(관리자 승인 경로와 같은 규약).
    let entry;
    try {
      entry = createBranchHistoryEntry({
        accountKey: check.accountKey,
        memberId: check.memberId,
        memberName: check.name || "",
        fromBranch,
        toBranch: branchName,
        effectiveDate: today,
        note: "지점 전입",
      });
    } catch (e: any) {
      window.alert(String(e?.message || e));
      return;
    }
    if (!(await appendBranchHistoryOrWarn(entry))) return; // 안내는 헬퍼가 이미 했다

    // ② 카카오 반영 — 지점은 카카오를 직접 부르지 않는다(백엔드 액션이 지점 PIN 게이트를 통과한 뒤 대신 호출).
    let result;
    try {
      // 이력에 남긴 이전 지점(=부서 원문)을 함께 보낸다 — 백엔드가 실제 소속과 대조해 다르면 옮기지 않는다.
      // 확인창 사이에 다른 지점이 먼저 데려간 경우, 그대로 진행하면 이력의 이전 지점이 틀린 값으로 굳어
      // 전입일 이전 이용내역이 엉뚱한 지점으로 집계된다(Codex 지적 2026-07-30).
      result = await gasClient.transferKakaoTaxiMember(branchName, pinHash, check.memberId, fromBranch);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (isKakaoWriteDefinitelyNotExecuted(e)) {
        // 실행되지 않은 것이 확실 → 선기록한 이력을 반대 방향으로 상쇄해 집계를 원상복구한다.
        await appendBranchHistoryReversal(entry);
        window.alert(`전입 실패 — ${msg}\n\n바뀐 것은 없습니다. 사유를 확인한 뒤 다시 시도해주세요.`);
      } else {
        // 반영 여부 불명(응답 지연·통신 끊김) → 이력은 의도한 값과 같으므로 그대로 둔다.
        window.alert(
          `전입 반영 여부를 확인하지 못했습니다 — ${msg}\n\n` +
          `이미 처리됐을 수 있습니다. '새로고침'으로 아래 '등록된 인원'에 ${check.name || "이 직원"} 님이 보이는지 확인하고, ` +
          `안 보이면 다시 시도해주세요.`
        );
      }
      return;
    }

    // 백엔드가 같은 값으로 대조한 뒤에만 옮기므로 여기서 어긋날 일은 없다 — 그래도 값이 다르면
    // 대조가 무력화된 것이니(옛 GAS 등) 흔적을 남긴다. 전입은 이미 성공이라 되돌리지 않는다.
    if ((result.fromBranch || "") !== fromBranch) {
      console.warn("전입 대조 불일치(옛 백엔드일 수 있음):", { 기록: fromBranch, 실제: result.fromBranch });
    }

    // ③ 신청 현황 기록 — 받는 지점과 보내는 지점 **양쪽**에 남겨 두 지점이 각자 추적할 수 있게 한다.
    const now = new Date().toISOString();
    const resultNote = `전입 완료: ${fromLabel} → ${branchName}`;
    const makeRecord = (owner: string): KakaoTaxiRequest => ({
      id: makeRequestId(),
      type: "branchChange",
      branchName: owner,
      status: "approved",
      requestedAt: now,
      processedAt: now,
      name: result.name || check.name || "(이름 없음)",
      memberId: check.memberId,
      targetBranch: branchName,
      effectiveDate: today,
      reason: "지점 전입(이용신청 중 발견)",
      resultNote,
    });
    try {
      const { list } = await gasClient.appendSharedArrayItem(
        requestsKey, makeRecord(branchName) as unknown as Record<string, unknown>
      );
      setRequests(sortRequests((list || []) as KakaoTaxiRequest[]));
    } catch (e) {
      console.error("전입 이력 기록 실패(전입 자체는 완료됨):", e);
      window.alert("전입은 완료됐지만 '신청 현황' 기록에는 실패했습니다.\n등록된 인원 목록에는 정상 반영되니, 기록이 필요하면 관리자에게 알려주세요.");
    }
    // 보내는 지점 기록 실패는 사용자에게 알리지 않는다 — 우리 지점 작업은 이미 끝났고, 남의 지점
    // 목록에 한 줄 남기는 부가 작업이라 여기서 경고를 띄우면 성공을 실패처럼 보이게 한다.
    const fromKey = fromBranch ? (KAKAO_BRANCH_ALIASES[fromBranch] || fromBranch) : "";
    if (fromKey && fromKey !== branchName) {
      try {
        await gasClient.appendSharedArrayItem(
          kakaoTaxiRequestsKey(fromKey), makeRecord(fromKey) as unknown as Record<string, unknown>
        );
      } catch (e) {
        console.warn("보내는 지점 신청 현황 기록 실패(전입 자체는 완료됨):", e);
      }
    }

    setRegName(""); setRegPhone(""); setRegMemo("");
    const refreshed = await gasClient.getKakaoTaxiBranchMembers(branchName, pinHash, true).catch(() => null);
    if (refreshed) setAllMembers(refreshed);
    await load();
    const who = result.name || check.name || "직원";
    // **전입은 소속만 옮길 뿐 이용중지를 풀지 않는다.**
    // 부서가 다른 지점으로 남아 있던 이용중지자는 위 blocked 검사에 안 걸려 여기까지 온다
    // (그 검사는 우리 지점 부서 목록만 본다). 그대로 "데려왔습니다"라고 하면 탈 수 있는 줄 알고
    // 기다리게 된다 — 옮겨온 뒤에는 우리 부서라 목록에 보이므로, 여기서 확인해 사실대로 알린다
    // (Codex 2026-07-31).
    // 재조회 자체가 실패했으면 **확인한 척하지 않는다.** 그대로 "데려왔습니다"만 말하면
    // 이용중지 상태여도 탈 수 있는 줄 알고 기다리게 된다(Codex 2026-07-31).
    if (!refreshed) {
      window.alert(
        `${who} 님을 우리 지점으로 데려왔습니다.\n오늘(${today})부터의 이용이 ${branchName}으로 집계됩니다.\n\n` +
        `다만 목록을 다시 불러오지 못해 지금 택시를 탈 수 있는 상태인지는 확인하지 못했습니다.\n` +
        `'새로고침'을 눌러 '등록된 인원'에 보이는지 확인해주세요(안 보이면 이용중지일 수 있습니다).`
      );
      return;
    }
    const movedIn = refreshed.find((m) => normalizePhone(m.mobile_phone || "") === normalizePhone(check.phone || ""));
    if (movedIn?.status === "blocked") {
      window.alert(
        `${who} 님을 우리 지점으로 데려왔습니다.\n오늘(${today})부터의 이용이 ${branchName}으로 집계됩니다.\n\n` +
        `다만 이 분은 **이용중지 상태**라 아직 택시를 탈 수 없습니다.\n` +
        `아래 '이용중지 인원'에서 [이용재개 신청]을 눌러주세요.`
      );
      return;
    }
    window.alert(
      `${who} 님을 우리 지점으로 데려왔습니다.\n오늘(${today})부터의 이용이 ${branchName}으로 집계됩니다.`
    );
  };

  const submitRegister = async () => {
    if (saving) return;
    const name = regName.trim();
    const phone = regPhone.replace(/[^0-9]/g, "");
    if (!name) { window.alert("이름을 입력해주세요."); return; }
    if (!/^01[0-9]{8,9}$/.test(phone)) { window.alert("휴대전화번호를 확인해주세요. (예: 01012345678)"); return; }
    // 등록 인원 목록이 아직 없으면 **이용중지 여부를 알 수 없다.** 그대로 진행하면 이용중지된
    // 사람인데 "이미 등록돼 있습니다"로만 끝나, 왜 안 되는지 모른 채 재등록을 반복하게 된다
    // (Codex P1 2026-07-31).
    //
    // **다만 이걸로 등록을 아주 막으면 안 된다.** 이 조회는 카카오를 타서 느리고(7.7초) 가끔
    // 실패하는데, 실패했다고 등록을 못 하게 하면 멀쩡한 신규 등록까지 통째로 멈춘다.
    // 그래서 아직 오는 중일 때만 기다리게 하고, 실패했으면 사정을 알린 뒤 진행 여부를 묻는다
    // (중복 등록은 백엔드가 따로 막으므로 최악이라도 이 기능을 만들기 전과 같다).
    if (allMembers === null) {
      if (!membersError) {
        window.alert("등록 인원 목록을 불러오는 중입니다. 잠시 후 다시 눌러주세요.");
        return;
      }
      if (!window.confirm(
        "등록 인원 목록을 불러오지 못해 이 번호가 이용중지 상태인지 확인할 수 없습니다.\n\n" +
        "이용중지된 사람이면 등록이 아니라 관리자의 이용재개가 필요합니다.\n" +
        "그래도 등록을 진행할까요?"
      )) return;
    }
    setSaving(true);
    try {
      // [사전 확인] 등록 확인창을 띄우기 전에 "이 번호가 이미 카카오T에 있는가"를 먼저 묻는다.
      // 다른 지점에 있으면 거부하지 않고 '전입(소속만 이동)'을 제안한다.
      //
      // [배포 순서 안전장치] 이 확인은 '개선'이지 '유일한 방어선'이 아니다 — 등록 경로
      // (submitBranchKakaoRegister)가 백엔드에서 같은 번호 중복을 이미 막는다. 그래서 확인이 실패하면
      // 등록 자체를 막지 않고 **기존 방식으로 진행**한다. 이렇게 두지 않으면 백엔드(GAS)가 아직
      // 새 액션을 모르는 동안 전 지점의 이용신청이 통째로 멈춘다(앱만 먼저 배포되는 상황).
      // 최악의 경우도 이 기능을 만들기 전과 같은 동작이다.
      let check: KakaoTaxiPhoneCheck | null = null;
      try {
        check = await gasClient.checkKakaoTaxiPhone(branchName, pinHash, phone);
      } catch (e: any) {
        console.warn("등록 전 확인 실패 — 기존 등록 방식으로 진행합니다(중복은 백엔드가 막습니다):", e);
      }
      // **이용중지된 사람이 복귀해 다시 등록하려는 경우.**
      // 지점에서는 이용재개(카카오 unblock)를 할 수 없다 — 관리자만 가능하다. 그런데 아래
      // "이미 우리 지점에 등록돼 있습니다"로 끝내면 왜 안 되는지 몰라 재등록만 반복하게 된다
      // (사용자 지시 2026-07-31). 이유를 알려 주고 관리자에게 요청으로 넘긴다.
      const blockedSame = (allMembers || []).find(
        (m) => m.status === "blocked" && normalizePhone(m.mobile_phone || "") === normalizePhone(phone)
      );
      if (blockedSame) {
        // 요청을 대신 올려 주지 않고 **안내만 한다**(사용자 지시 2026-07-31).
        // 무엇이 문제이고 무엇을 하면 되는지만 알려 주면, 재등록을 반복하는 일은 없어진다.
        window.alert(
          `${blockedSame.name || name} 님은 현재 이용중지 상태입니다.\n\n` +
          `지점에서는 풀 수 없습니다. 아래 '이용중지 인원'에서 [이용재개 신청]을 눌러주세요.\n` +
          `관리자가 처리하면 '등록된 인원'에 다시 나타나고 택시도 바로 탈 수 있습니다.`
        );
        return;
      }
      if (check?.found) {
        if (check.sameBranch) {
          window.alert(`${check.name || "이 직원"} 님은 이미 우리 지점에 등록돼 있습니다.\n(아래 '등록된 인원'에 안 보이면 목록이 묵은 것이니 '새로고침'을 눌러주세요)`);
          return;
        }
        if (!check.sameAccount) {
          window.alert(
            `${check.name || "이 직원"} 님(${check.phone})은 다른 카카오T 계정${check.accountLabel ? `(${check.accountLabel})` : ""}의 ` +
            `'${check.department || "다른 지점"}'에 등록돼 있습니다.\n\n계정이 달라 지점에서는 옮길 수 없습니다. 관리자에게 문의해주세요.`
          );
          return;
        }
        await transferFoundMember(check);
        return;
      }
      // 자동 등록 — 관리자 승인 없이 지점 PIN 으로 바로 카카오 등록 + 인증 알림톡.
      // 백엔드가 지점명→그룹 자동 매핑·전화 중복 차단을 처리한다(지점은 그룹을 고르지 않는다).
      if (!window.confirm(`${name} 님을 카카오T 비즈니스에 바로 등록할까요?\n\n휴대전화: ${phone}\n\n등록되면 직원 휴대폰으로 인증 알림톡이 즉시 발송됩니다.\n(관리자 승인 없이 바로 처리됩니다)`)) return;
      const res = await gasClient.submitBranchKakaoRegister(branchName, pinHash, name, phone, regMemo.trim());
      setRegName(""); setRegPhone(""); setRegMemo("");
      // 등록 결과를 '신청 현황'에 이력으로 남긴다 — 알림톡 실패도 지점이 나중에 계속 확인·추적할 수 있게 한다.
      // (등록된 직원은 인증 전이라 '등록된 인원' 목록에 안 떠서, 이 이력이 유일한 지속 상태다.)
      try {
        const record = createRegisterRequest(branchName, { name, phone, memo: regMemo.trim() });
        record.status = "approved";
        record.processedAt = new Date().toISOString();
        // 짧게 남긴다 — 신청 목록의 '상태' 칸에 그대로 찍히는 값이라, 길면 표를 읽을 수 없다.
        record.resultNote = res.tmsSent
          ? "등록 완료 · 알림톡 발송"
          : "등록 완료 · 알림톡 실패(직원이 카카오T 앱>비즈니스에서 초대를 직접 확인해 인증)";
        await appendRequest(record);
      } catch (histErr) {
        console.warn("등록 이력 기록 실패(등록 자체는 완료됨):", histErr);
      }
      if (res.tmsSent) {
        window.alert("등록되었습니다. 직원 휴대폰으로 인증 알림톡이 발송되었습니다.\n직원이 카카오T 앱에서 인증을 마치면 아래 '등록된 인원'에 표시됩니다.");
      } else {
        window.alert("직원 등록은 완료되었습니다. 다만 인증 알림톡 발송에는 실패했습니다.\n\n직원이 카카오T 앱 > 비즈니스에서 회사 초대를 직접 확인해 인증할 수 있습니다.\n아래 '신청 현황'에도 이 건이 남아 있으니 계속 안 되면 관리자에게 문의해주세요.");
      }
      await load(true);
    } catch (e: any) {
      // 사유를 첫 줄에 둔다 — "등록에 실패했습니다" 뒤에 붙이면 정작 읽어야 할 사유가 묻힌다.
      window.alert(`등록 실패 — ${String(e?.message || e)}\n\n입력하신 내용은 그대로 남아 있으니, 위 사유를 확인한 뒤 다시 시도해주세요.`);
    } finally {
      setSaving(false);
    }
  };

  const closeRequestForm = () => {
    setRequestTarget(null);
    setRequestReason("");
    setRequestTargetBranch("");
    setRequestEffectiveDate("");
  };

  const submitMemberRequest = async () => {
    if (saving || !requestTarget) return;
    // **계정(account_key)까지 넘긴다.** id 는 계정별로 발급돼 다른 계정에 같은 id 가 있을 수 있어,
    // 관리자가 승인할 때 계정을 추정하면 엉뚱한 사람을 건드린다. 신청에 못 박아 두면 그럴 일이 없다
    // (2026-07-31). 종전에는 여기서 id·name 만 뽑아 계정을 버렸다.
    const member = {
      id: requestTarget.member.id,
      name: requestTarget.member.name,
      account_key: requestTarget.member.account_key,
    };
    let request: KakaoTaxiRequest;
    try {
      request = requestTarget.type === "branchChange"
        ? createBranchChangeRequest(branchName, member, requestReason, requestTargetBranch, requestEffectiveDate)
        : createMemberRequest(requestTarget.type, branchName, member, requestReason);
    } catch (e: any) {
      window.alert(String(e?.message || e));
      return;
    }
    const typeLabel = REQUEST_TYPE_LABEL[requestTarget.type];
    const confirmBody = requestTarget.type === "branchChange"
      ? `옮겨간 지점: ${request.targetBranch || "모름 (관리자가 지정)"}\n이동일: ${request.effectiveDate}\n사유: ${request.reason}\n\n승인되면 이동일부터의 이용만 새 지점으로 집계되고, 직원은 삭제되지 않습니다.`
      : requestTarget.type === "delete"
        // 무엇이 지워지고 무엇이 남는지 분명히 알린다 — '삭제'라는 말 때문에 기록까지 지워진다고 오해하기 쉽다.
        ? `사유: ${request.reason}\n\n승인되면 이 인원의 인증이 해제되어 목록에서 사라지고 택시를 탈 수 없게 됩니다.\n과거 이용내역은 그대로 남습니다(계정을 지우지 않습니다).`
        : `사유: ${request.reason}`;
    if (!window.confirm(`${request.name} 님에 대한 ${typeLabel}을 등록할까요?\n\n${confirmBody}`)) return;
    setSaving(true);
    try {
      await appendRequest(request);
      closeRequestForm();
      window.alert(`${typeLabel}이 등록되었습니다. 관리자 확인 후 처리됩니다.`);
    } catch (e: any) {
      window.alert(`요청 저장에 실패했습니다. 다시 시도해주세요.\n${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const pendingCount = useMemo(() => (requests || []).filter((r) => r.status === "pending").length, [requests]);

  /**
   * 신청 한 줄의 상태를 한마디로 정한다(사용자 지시 2026-07-31 — 인증대기중·등록완료·반려).
   *
   * 지점이 알고 싶은 건 "이 사람이 택시를 탈 수 있느냐"다. 등록만으로는 못 탄다 —
   * 직원이 카카오T 앱에서 본인 인증을 마쳐야 한다. 그런데 카카오는 **인증을 마친 사람만**
   * 목록으로 돌려주므로(등록된 인원 = 인증 완료자), 그 목록에 있으면 인증까지 끝난 것이다.
   *
   * **모를 때는 '등록완료'라고 하지 않는다.** 목록을 아직 못 받았거나 대조할 전화번호가 없으면
   * 인증 여부를 단정할 수 없는데, 여기서 완료라고 적으면 정작 못 타는 사람을 끝난 것으로 믿고
   * 넘어간다. 그런 경우는 '인증대기중'으로 둬서 한 번 더 확인하게 한다.
   */
  /** 이 신청의 대상이 **지금** 이용중지 상태인가. 목록을 못 받았으면 단정하지 않는다. */
  const isMemberBlockedNow = (r: KakaoTaxiRequest): boolean =>
    !!r.memberId && allMembers !== null && allMembers.some((m) =>
      m.id === r.memberId && m.status === "blocked" && (!r.accountKey || m.account_key === r.accountKey));

  /**
   * 이용재개 신청 — 이용중지된 사람이 복귀했을 때.
   *
   * 지점은 카카오 이용재개(unblock)를 할 수 없어 관리자에게 넘겨야 한다. 사유는 따로 묻지 않는다 —
   * '복귀'라는 사실 자체가 사유이고, 한 번 더 묻는 창은 통로만 불편하게 만든다.
   */
  const submitResumeRequest = async (member: KakaoTaxiMember) => {
    if (saving) return;
    if (!window.confirm(`${member.name} 님의 이용재개를 관리자에게 신청할까요?\n\n승인되면 다시 택시를 탈 수 있고 '등록된 인원'에도 나타납니다.`)) return;
    setSaving(true);
    try {
      await appendRequest(createMemberRequest("resume", branchName, member, "복귀 — 이용재개 요청"));
      window.alert("이용재개를 신청했습니다. 관리자 확인 후 처리됩니다.");
    } catch (e: any) {
      window.alert(`이용재개 신청에 실패했습니다.\n${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const requestStatusChip = (r: KakaoTaxiRequest): { label: string; className: string } => {
    // **지금 이용중지된 사람이면 그것이 결론이다.** 기록상 반려로 남아 있어도 그 뒤 다른 경로로
    // 이용중지가 된 경우가 있다(이선복·김미화). '반려'라고만 적으면 아직 처리가 안 된 것으로
    // 읽혀 같은 요청을 또 올리게 된다(사용자 지시 2026-07-31).
    if (isMemberBlockedNow(r)) return { label: "이용중지", className: STATUS_CHIP.unknown };
    if (r.status === "rejected") return { label: "반려", className: STATUS_CHIP.rejected };
    // 관리자 처리를 기다리는 요청(삭제요청·지점변경)은 위 셋에 속하지 않는다 — 있는 그대로 적는다.
    if (r.status === "pending") return { label: "관리자 확인 대기", className: STATUS_CHIP.processing };
    if (r.status === "processing") return { label: "처리 중", className: STATUS_CHIP.processing };
    // 승인된 건 중 '등록'만 인증 여부를 따진다. 나머지(삭제요청·지점변경 승인)는 그것으로 끝이다.
    // 지점변경은 처리되면 끝이다 — 상태는 인증완료/반려 둘 중 하나로만 보인다(사용자 지시 2026-07-31).
    // (반려는 위에서 이미 걸러졌으므로 여기 오는 건 승인된 건뿐이다.)
    if (r.type === "branchChange") return { label: "인증완료", className: STATUS_CHIP.done };
    if (r.type !== "register") return { label: "처리 완료", className: STATUS_CHIP.done };
    const phone = normalizePhone(r.phone || "");
    // **모를 때는 '인증대기중'이라고 하지 않는다.** 목록을 못 받았거나 대조할 번호가 없는 것은
    // "직원이 인증을 안 했다"와 전혀 다른 이야기다. 그렇게 적으면 이미 인증을 마친 사람까지
    // 미완료로 읽히고, 지점은 직원에게 헛되이 인증을 재촉하게 된다(Codex P1 2026-07-31).
    if (allMembers === null) {
      return loading
        ? { label: "확인 중", className: STATUS_CHIP.processing }
        : { label: "상태 확인 불가", className: STATUS_CHIP.unknown };
    }
    if (!phone) return { label: "상태 확인 불가", className: STATUS_CHIP.unknown };
    const found = allMembers.find((m) => normalizePhone(m.mobile_phone || "") === phone);
    if (!found) return { label: "인증대기중", className: STATUS_CHIP.waiting };
    // **목록에 있다고 탈 수 있는 게 아니다.** 카카오 멤버 상태는 네 가지다
    // (created=등록만 됨 / connected=인증 완료 / refused=초대 거부 / blocked=이용 중지).
    // 종전에는 blocked 만 걸러내고 나머지를 전부 '등록완료'로 적었는데, 그러면 아직 인증을
    // 안 한 사람(created)과 초대를 거부한 사람(refused)까지 다 탈 수 있는 것으로 보인다
    // (Codex P0 2026-07-31). 확실한 connected 하나만 완료로 본다.
    if (found.status === "connected") return { label: "등록완료", className: STATUS_CHIP.done };
    if (found.status === "created") return { label: "인증대기중", className: STATUS_CHIP.waiting };
    if (found.status === "refused") return { label: "인증거부", className: STATUS_CHIP.rejected };
    // 이용중지된 사람은 인증을 안 한 것이 아니다 — '인증대기중'으로 적으면
    // 퇴사 처리한 사람을 두고 인증을 기다리게 된다.
    if (found.status === "blocked") return { label: "이용중지", className: STATUS_CHIP.unknown };
    // 모르는 상태값이면 단정하지 않는다(카카오가 값을 추가해도 거짓 완료로 새지 않게).
    return { label: "상태 확인 불가", className: STATUS_CHIP.unknown };
  };

  /**
   * 비고 칸에 적을 말. **본문과 툴팁이 반드시 같은 값을 쓴다.**
   *
   * 종전에는 본문만 상태에 맞춰 고치고 title 은 저장된 옛 메모를 그대로 써서,
   * 마우스를 올리면 상태 칸과 다른 말이 나왔다(Codex 2026-07-31).
   * 저장된 처리 메모(resultNote)는 **승인 순간의 기록**이라, 그 뒤 직원이 거부하거나
   * 이용중지되면 사실과 어긋난다 — 그래서 지금 상태를 먼저 본다.
   */
  const requestRemark = (r: KakaoTaxiRequest): string => {
    if (isMemberBlockedNow(r)) return "이용중지 승인됨 — 다시 쓰려면 관리자에게 이용재개를 신청해주세요";
    if (r.status === "rejected" && r.rejectReason) return `반려 사유: ${r.rejectReason}`;
    if (r.status === "approved" && r.type === "register") {
      const label = requestStatusChip(r).label;
      // 인증까지 끝난 사람에게는 알림톡 안내가 남아 있으면 안 된다 — 할 일이 없는데 뭔가
      // 더 해야 하는 것처럼 읽힌다(사용자 지시 2026-07-31). 끝났다는 말만 남긴다.
      if (label === "등록완료") return "카카오 등록완료";
      if (label === "이용중지") return "이용중지 상태입니다 — 다시 쓰려면 관리자에게 이용재개를 요청해주세요";
      if (label === "인증거부") return "직원이 카카오T 초대를 거부했습니다 — 관리자에게 재초대를 요청해주세요";
      if (label !== "인증대기중") return "등록 상태를 확인하지 못했습니다 — 새로고침해주세요";
      // 아직 인증 전이면 **저장된 처리 결과를 그대로** 보여준다.
      // 여기에 알림톡 발송 실패 여부가 들어 있다 — 일반 문구로 덮으면 알림톡이 간 줄 알고
      // 기다리기만 하게 된다(실패한 경우 직원이 카카오T 앱에서 초대를 직접 찾아 확인해야 한다).
      return r.resultNote || "인증 알림톡 발송됨 — 직원이 카카오T 앱>비즈니스에서 인증을 마쳐야 이용할 수 있습니다";
    }
    // 지점변경은 **어디서 어디로 언제** 옮기는지가 전부다(사용자 지시 2026-07-31).
    // 신청을 올린 지점(branchName)이 곧 이전 소속이다.
    if (r.type === "branchChange") {
      const move = r.targetBranch ? `${r.branchName} → ${r.targetBranch}` : "";
      return [move, r.effectiveDate ? `이동일 ${r.effectiveDate}` : "", r.reason || ""].filter(Boolean).join(" · ") || "-";
    }
    if (r.status === "approved") return r.resultNote || "처리 완료";
    return r.reason || r.memo || "-";
  };

  return (
    <div className="space-y-6">
      {/* ---------- 이용신청 ---------- */}
      {/* 제목 밴드 = 지점 표준(index.css `.branch-band*`) — 2026-08-03 사용자 지시.
          카드에 padding 을 주지 않는다(밴드가 폭을 꽉 채워야 한다) — 본문이 자기 여백을 갖는다. */}
      <section className="branch-sheet-card">
        <div className="branch-band">
          <h3 className="branch-band-title">비즈니스택시 이용신청</h3>
        </div>
        <div className="p-4 space-y-4">
        <p className="text-[11px] font-bold text-[#212121]/60">
          직원을 등록하면 <b>바로 카카오T 비즈니스에 등록</b>되고 직원 휴대폰으로 <b>인증 알림톡</b>이 발송됩니다(관리자 승인 없이 즉시 처리).
          직원이 카카오T 앱에서 인증을 마치면 아래 '등록된 인원'에 표시됩니다. 그룹(지점)은 지점명으로 자동 지정됩니다.
          같은 번호가 <b>다른 지점에 이미 등록</b>돼 있으면, 확인 후 <b>우리 지점으로 데려오기(전입)</b>를 물어봅니다 —
          직원 계정은 삭제되지 않고 소속만 바뀌며, 전입일부터의 이용만 우리 지점으로 집계됩니다.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="이름 (필수)" disabled={saving}
            className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white disabled:opacity-50" />
          <input value={regPhone} onChange={(e) => setRegPhone(e.target.value)} placeholder="휴대전화 (필수)" inputMode="numeric" disabled={saving}
            className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white disabled:opacity-50" />
          <input value={regMemo} onChange={(e) => setRegMemo(e.target.value)} placeholder="메모 (선택 — 직급·용도 등)" disabled={saving}
            className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white disabled:opacity-50 sm:col-span-2" />
        </div>
        <button onClick={() => void submitRegister()} disabled={saving}
          className="h-8 rounded-lg bg-slate-800 px-3 text-[11px] font-black text-white disabled:opacity-50">
          {saving ? "등록 중..." : "등록하고 인증 알림톡 보내기"}
        </button>
        </div>
      </section>

      {/* ---------- 우리 지점 등록 인원 ---------- */}
      <section className="branch-sheet-card">
        <div className="branch-band">
          <h3 className="branch-band-title">등록된 인원 ({branchName})</h3>
          <div className="branch-band-actions">
            <button onClick={() => void load(true)} disabled={loading}
              className="h-8 rounded-full border border-[#212121] bg-white px-3.5 text-[11px] font-black text-[#212121] cursor-pointer disabled:opacity-50">새로고침</button>
          </div>
        </div>
        {/* [2026-08-04] p-4 래퍼 제거 — 표 머리글이 밴드에 바로 붙는다(관리자와 같은 모양).
            표 아닌 블록(오류 배너·로딩)만 자기 여백(mx-4)을 갖는다. */}
        {membersError && <div className={`mx-4 my-3 ${ERROR_BANNER}`}>{membersError}</div>}
        {loading && members === null && !membersError && <div className="py-10 text-center"><LoadingSpinner size="md" /></div>}
        {members !== null && (
          <>
            <div className="branch-sheet-scroll">
              <table className="branch-sheet">
                {/* 입력 칸은 '요청' 오른쪽에 컬럼으로 세운다(사용자 지시 2026-07-29) —
                    종류를 고른 뒤 오른쪽으로 이어서 적는 순서가 되고, 행끼리 칸이 세로로 맞는다. */}
                <thead><tr className="text-left">
                  <th>이름</th>
                  {/* 부서(지점) — 이용내역이 어느 지점으로 잡히는지가 이 값으로 정해진다.
                      지점명과 다르게 적혀 있으면 그 사람 이용이 엉뚱한 곳으로 집계되므로 눈으로 확인할 수 있게 둔다. */}
                  <th>부서(지점)</th>
                  <th>휴대전화</th>
                  <th>상태</th>
                  <th>요청</th>
                  <th>옮겨간 지점</th>
                  <th>이동일</th>
                  <th>사유</th>
                </tr></thead>
                <tbody>
                  {members.map((m) => {
                    // 이 행에서 수정/삭제 요청을 작성 중인지 — 사유 칸을 행에서 바로 입력하게 한다.
                    const active = requestTarget?.member.id === m.id;
                    return (
                    <tr key={m.id} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-bold text-[#212121]">{m.name || "(이름 없음)"}</td>
                      {/* 부서가 우리 지점명과 다르면 그 사람 이용이 다른 지점으로 집계된다 — 빨간 글씨로 짚어 준다
                          (지점 화면은 색이 죽는 자리가 많아 오류 hex 로 못 박는다). */}
                      <td className={`px-3 py-2 ${String(m.department || "").trim() === branchName ? "" : "text-[#B3261E] font-bold"}`}
                        title={String(m.department || "").trim() === branchName ? "" : "부서가 우리 지점명과 다릅니다 — 이용내역이 다른 지점으로 집계될 수 있습니다. 관리자에게 수정을 요청해주세요."}>
                        {m.department || "(없음)"}
                      </td>
                      <td className="px-3 py-2">{m.mobile_phone || "-"}</td>
                      <td className="px-3 py-2">{MEMBER_STATUS_LABEL[m.status] || m.status}</td>
                      {/* 요청 — 고르면 오른쪽 칸들이 열린다. 작성 중에는 종류와 등록·취소 버튼을 보여준다. */}
                      <td className="px-3 py-2 align-top">
                        {active ? (
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[11px] font-black text-[#212121]">
                              {REQUEST_TYPE_LABEL[requestTarget!.type]}
                            </span>
                            {/* 버튼 글자는 '등록/취소'로 짧지만, 읽어주는 도구에는 누구의 무슨 요청인지 밝힌다 */}
                            <span className="inline-flex gap-1.5">
                              <button onClick={() => void submitMemberRequest()} disabled={saving}
                                aria-label={`${m.name || "이 인원"} ${REQUEST_TYPE_LABEL[requestTarget!.type]} 등록`}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-black text-white bg-slate-800 disabled:opacity-50">등록</button>
                              <button onClick={closeRequestForm} disabled={saving}
                                aria-label={`${m.name || "이 인원"} ${REQUEST_TYPE_LABEL[requestTarget!.type]} 취소`}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-white border border-gray-200 disabled:opacity-50">취소</button>
                            </span>
                          </div>
                        ) : (
                          // 요청 종류는 드롭다운 — 기본값 '선택', 고르면 이 행의 오른쪽 칸이 열린다(2026-07-29).
                          <select value="" disabled={saving} aria-label="요청 종류"
                            onChange={(e) => {
                              const type = e.target.value as MemberRequestType | "";
                              if (!type) return;
                              setRequestTarget({ member: m, type });
                              setRequestReason("");
                              setRequestTargetBranch("");
                              setRequestEffectiveDate(type === "branchChange" ? todayDateText() : "");
                            }}
                            className="h-8 border border-gray-200 rounded-lg px-2 text-[11px] font-bold bg-white cursor-pointer disabled:opacity-50">
                            <option value="">선택</option>
                            {/* 퇴사자는 '삭제요청'을 고른다 — 승인되면 인증만 해제돼 목록에서 사라지고,
                                과거 이용내역은 남는다(계정을 지우지 않는다). */}
                            <option value="delete">삭제요청 (퇴사)</option>
                            <option value="branchChange">지점변경 (타지점 이동)</option>
                            <option value="update">수정요청 (이름·번호 정정)</option>
                          </select>
                        )}
                      </td>
                      {/* 옮겨간 지점 — 변경신청에서만. 모르면 비워 두면 관리자가 지정한다. */}
                      <td className="px-3 py-2 align-top">
                        {active && requestTarget!.type === "branchChange" ? (
                          <select value={requestTargetBranch} onChange={(e) => setRequestTargetBranch(e.target.value)} disabled={saving} autoFocus
                            aria-label="옮겨간 지점"
                            className="h-8 w-40 border border-gray-200 rounded-lg px-2 text-[11px] font-bold bg-white disabled:opacity-50">
                            <option value="">모름 (관리자가 지정)</option>
                            {erpBranches.map((b) => <option key={b} value={b}>{b}</option>)}
                          </select>
                        ) : (
                          <span className="text-[#212121]/40">-</span>
                        )}
                      </td>
                      {/* 이동일 — 이 날짜부터의 이용만 새 지점으로 집계된다(직원 삭제 없음). */}
                      <td className="px-3 py-2 align-top">
                        {active && requestTarget!.type === "branchChange" ? (
                          <input type="date" value={requestEffectiveDate} onChange={(e) => setRequestEffectiveDate(e.target.value)} disabled={saving}
                            title="이 날짜부터의 이용이 새 지점으로 집계됩니다" aria-label="이동일"
                            className="h-8 w-36 border border-gray-200 rounded-lg px-2 text-[11px] font-bold bg-white disabled:opacity-50" />
                        ) : (
                          <span className="text-[#212121]/40">-</span>
                        )}
                      </td>
                      {/* 사유 — 수정요청·변경신청 모두 필수. */}
                      <td className="px-3 py-2 align-top">
                        {active ? (
                          <input value={requestReason} onChange={(e) => setRequestReason(e.target.value)} disabled={saving}
                            autoFocus={requestTarget!.type !== "branchChange"} aria-label="사유"
                            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) void submitMemberRequest(); }}
                            placeholder={requestTarget!.type === "branchChange" ? "변경 사유 (필수 — 예: 타지점 이동)" : "수정 사유 (필수 — 예: 번호 변경, 이름 정정)"}
                            className="h-8 w-64 border border-gray-200 rounded-lg px-2 text-[11px] font-bold bg-white disabled:opacity-50" />
                        ) : (
                          <span className="text-[#212121]/40">-</span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                  {!members.length && (
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-xs font-bold text-[#212121]/50">
                      이 지점으로 등록된 인원이 없습니다. (부서가 지점명으로 등록된 인원만 표시됩니다)
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* ---------- 이용중지 인원 ----------
          위 '등록된 인원'에는 일부러 넣지 않는다 — 지금 택시를 탈 수 있는 사람 목록이 흐려지면
          누가 현역인지 알 수 없다(사용자 지시 2026-07-31). 대신 여기 따로 모아,
          복귀했을 때 **이용재개를 신청할 통로**를 만든다(지점은 스스로 풀 수 없다). */}
      {blockedMembers.length > 0 && (
        <section className="branch-sheet-card">
          <div className="branch-band">
            <h3 className="branch-band-title">이용중지 인원 — {blockedMembers.length}명</h3>
            <p className="branch-band-meta">퇴사·휴직 등으로 이용이 중지된 인원입니다. 복귀했다면 다시 등록하지 말고 아래에서 이용재개를 신청해주세요.</p>
          </div>
          {/* [2026-08-04] p-4 래퍼 제거 — 표 머리글이 밴드에 바로 붙는다. */}
          <div className="branch-sheet-scroll">
            <table className="branch-sheet">
              <thead><tr className="text-left">
                <th>이름</th>
                <th>휴대전화</th>
                <th>부서(지점)</th>
                <th>요청</th>
              </tr></thead>
              <tbody>
                {blockedMembers.map((m) => {
                  const openResume = (requests || []).some(
                    (r) => r.type === "resume" && r.memberId === m.id && (r.status === "pending" || r.status === "processing")
                  );
                  return (
                    <tr key={m.id} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-bold text-[#212121]">{m.name}</td>
                      <td className="px-3 py-2">{m.mobile_phone}</td>
                      <td className="px-3 py-2">{m.department || "-"}</td>
                      <td className="px-3 py-2">
                        {openResume ? (
                          <span className={STATUS_CHIP.waiting}>이용재개 신청됨 — 관리자 확인 대기</span>
                        ) : (
                          <button onClick={() => void submitResumeRequest(m)} disabled={saving}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-[#212121] text-white disabled:opacity-50">
                            이용재개 신청
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---------- 신청 현황 ---------- */}
      <section className="branch-sheet-card">
        <div className="branch-band">
          <h3 className="branch-band-title">신청 현황{pendingCount ? ` — 대기 ${pendingCount}건` : ""}</h3>
        </div>
        {/* [2026-08-04] p-4 래퍼 제거 — 표 머리글이 밴드에 바로 붙는다. */}
        {requestsError && <div className={`mx-4 my-3 ${ERROR_BANNER}`}>{requestsError}</div>}
        {requests !== null && (
          <div className="branch-sheet-scroll">
            <table className="branch-sheet">
              <thead><tr className="text-left">
                <th>신청일</th>
                <th>종류</th>
                <th>대상</th>
                <th>상태</th>
                <th>비고</th>
              </tr></thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="px-3 py-2">{formatDateTime(r.requestedAt)}</td>
                    <td className="px-3 py-2 font-bold text-[#212121]">{REQUEST_TYPE_LABEL[r.type]}</td>
                    <td className="px-3 py-2">{r.name}{r.phone ? ` (${r.phone})` : ""}</td>
                    <td className="px-3 py-2">
                      {(() => {
                        const chip = requestStatusChip(r);
                        return <span className={chip.className}>{chip.label}</span>;
                      })()}
                    </td>
                    {/* 본문과 툴팁이 **같은 값**을 쓴다. 종전에는 본문만 상태에 맞춰 고치고 title 은
                        옛 처리 메모를 그대로 써서, 마우스를 올리면 "인증거부"인데 "등록 완료"가 떴다. */}
                    <td className="px-3 py-2 max-w-[24rem] truncate" title={requestRemark(r)}>
                      {requestRemark(r)}
                    </td>
                  </tr>
                ))}
                {!requests.length && (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-xs font-bold text-[#212121]/50">신청 내역이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
