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
  REQUEST_STATUS_LABEL, REQUEST_TYPE_LABEL, sortRequests, type KakaoTaxiRequest,
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

const STATUS_CHIP: Record<string, string> = {
  pending: "bg-amber-50 text-[#212121]",
  approved: "bg-emerald-50 text-[#212121]",
  rejected: "bg-[#FDE2E2] text-[#B91C1C]",
};

const MEMBER_STATUS_LABEL: Record<string, string> = {
  created: "등록됨(미인증)", connected: "인증완료", refused: "거부", blocked: "휴직",
};

const formatDateTime = (iso: string) => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
  const [members, setMembers] = useState<KakaoTaxiMember[] | null>(null);
  const [membersError, setMembersError] = useState("");
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
    // 신청 현황과 등록 인원은 실패를 각자 드러낸다 — 한쪽 실패가 다른 쪽을 가리지 않게 개별 처리.
    const [reqResult, memResult] = await Promise.allSettled([
      gasClient.getSharedDataFromServer<KakaoTaxiRequest[]>(requestsKey),
      gasClient.getKakaoTaxiBranchMembers(branchName, pinHash, forceRefresh),
    ]);
    if (reqResult.status === "fulfilled") {
      setRequests(Array.isArray(reqResult.value) ? sortRequests(reqResult.value) : []);
    } else {
      console.error("비즈니스택시 신청 현황 로드 실패:", reqResult.reason);
      setRequests(null);
      setRequestsError("신청 현황을 불러오지 못했습니다. 네트워크 확인 후 새로고침해주세요.");
    }
    if (memResult.status === "fulfilled") {
      // 이용 중지(휴직)된 인원은 지점 화면에 보여주지 않는다(사용자 지시 2026-07-31) —
      // 퇴사 처리한 사람이 목록에 남아 있으면 아직 쓰는 사람으로 오해한다.
      setMembers((memResult.value || []).filter((m) => m.status !== "blocked"));
    } else {
      console.error("비즈니스택시 등록 인원 로드 실패:", memResult.reason);
      setMembers(null);
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
    await load(true);
    window.alert(
      `${result.name || check.name || "직원"} 님을 우리 지점으로 데려왔습니다.\n오늘(${today})부터의 이용이 ${branchName}으로 집계됩니다.`
    );
  };

  const submitRegister = async () => {
    if (saving) return;
    const name = regName.trim();
    const phone = regPhone.replace(/[^0-9]/g, "");
    if (!name) { window.alert("이름을 입력해주세요."); return; }
    if (!/^01[0-9]{8,9}$/.test(phone)) { window.alert("휴대전화번호를 확인해주세요. (예: 01012345678)"); return; }
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
    const member = { id: requestTarget.member.id, name: requestTarget.member.name };
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

  return (
    <div className="space-y-6">
      {/* ---------- 이용신청 ---------- */}
      <section className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-4">
        <h3 className="branch-pill-title">비즈니스택시 이용신청</h3>
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
      </section>

      {/* ---------- 우리 지점 등록 인원 ---------- */}
      <section className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="branch-pill-title">등록된 인원 ({branchName})</h3>
          <button onClick={() => void load(true)} disabled={loading}
            className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-[11px] font-black text-[#212121] disabled:opacity-50">새로고침</button>
        </div>
        {membersError && <div className={ERROR_BANNER}>{membersError}</div>}
        {loading && members === null && !membersError && <div className="py-10 text-center"><LoadingSpinner size="md" /></div>}
        {members !== null && (
          <>
            <div className="overflow-x-auto rounded-2xl border border-gray-100">
              <table className="w-full text-xs whitespace-nowrap">
                {/* 입력 칸은 '요청' 오른쪽에 컬럼으로 세운다(사용자 지시 2026-07-29) —
                    종류를 고른 뒤 오른쪽으로 이어서 적는 순서가 되고, 행끼리 칸이 세로로 맞는다. */}
                <thead><tr className="text-left">
                  <th className="px-3 py-2 text-[11px] font-black text-[#212121]">이름</th>
                  {/* 부서(지점) — 이용내역이 어느 지점으로 잡히는지가 이 값으로 정해진다.
                      지점명과 다르게 적혀 있으면 그 사람 이용이 엉뚱한 곳으로 집계되므로 눈으로 확인할 수 있게 둔다. */}
                  <th className="px-3 py-2 text-[11px] font-black text-[#212121]">부서(지점)</th>
                  <th className="px-3 py-2 text-[11px] font-black text-[#212121]">휴대전화</th>
                  <th className="px-3 py-2 text-[11px] font-black text-[#212121]">상태</th>
                  <th className="px-3 py-2 text-[11px] font-black text-[#212121]">요청</th>
                  <th className="px-3 py-2 text-[11px] font-black text-[#212121]">옮겨간 지점</th>
                  <th className="px-3 py-2 text-[11px] font-black text-[#212121]">이동일</th>
                  <th className="px-3 py-2 text-[11px] font-black text-[#212121]">사유</th>
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
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-xs font-bold text-[#212121]/50">
                      이 지점으로 등록된 인원이 없습니다. (부서가 지점명으로 등록된 인원만 표시됩니다)
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* ---------- 신청 현황 ---------- */}
      <section className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-4">
        <h3 className="branch-pill-title">신청 현황{pendingCount ? ` — 대기 ${pendingCount}건` : ""}</h3>
        {requestsError && <div className={ERROR_BANNER}>{requestsError}</div>}
        {requests !== null && (
          <div className="overflow-x-auto rounded-2xl border border-gray-100">
            <table className="w-full text-xs whitespace-nowrap">
              <thead><tr className="text-left">
                <th className="px-3 py-2 text-[11px] font-black text-[#212121]">신청일</th>
                <th className="px-3 py-2 text-[11px] font-black text-[#212121]">종류</th>
                <th className="px-3 py-2 text-[11px] font-black text-[#212121]">대상</th>
                <th className="px-3 py-2 text-[11px] font-black text-[#212121]">상태</th>
                <th className="px-3 py-2 text-[11px] font-black text-[#212121]">비고</th>
              </tr></thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="px-3 py-2">{formatDateTime(r.requestedAt)}</td>
                    <td className="px-3 py-2 font-bold text-[#212121]">{REQUEST_TYPE_LABEL[r.type]}</td>
                    <td className="px-3 py-2">{r.name}{r.phone ? ` (${r.phone})` : ""}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${STATUS_CHIP[r.status] || ""}`}>
                        {REQUEST_STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 max-w-[24rem] truncate" title={r.rejectReason || r.resultNote || r.reason || r.memo || ""}>
                      {r.status === "rejected" && r.rejectReason ? `반려 사유: ${r.rejectReason}`
                        : r.status === "approved" && r.type === "register" ? "승인됨 — 직원 휴대폰 인증 알림톡 발송, 카카오T 앱에서 인증 필요"
                        : r.status === "approved" ? (r.resultNote || "처리 완료")
                        : r.type === "branchChange" ? `${r.targetBranch ? `→ ${r.targetBranch} · ` : ""}${r.effectiveDate ? `이동일 ${r.effectiveDate} · ` : ""}${r.reason || "-"}`
                        : (r.reason || r.memo || "-")}
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
