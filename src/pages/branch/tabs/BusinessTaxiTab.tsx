// src/pages/branch/tabs/BusinessTaxiTab.tsx
// 지점 > 인사·기타 > 비즈니스택시 — 카카오T 법인택시 이용신청(직원 등록 신청)과
// 우리 지점 등록 인원 확인, 인원 수정/삭제 요청(사유 필수), 내 신청 현황을 다룬다.
// 지점은 카카오를 직접 건드리지 않는다 — 신청만 남기고, 관리자가 법인택시 > 신청 관리에서
// 승인해야 실제 카카오 등록/삭제가 실행된다(설계서 blueprint-지점-비즈니스택시-신청.md).
import { useCallback, useEffect, useMemo, useState } from "react";
import { gasClient } from "../../../api/gasClient";
import type { KakaoTaxiMember } from "../../../api/gasClient";
import { useAuthContext } from "../../../contexts/AuthContext";
import LoadingSpinner from "../../../components/LoadingSpinner";
import {
  createMemberRequest, createRegisterRequest, kakaoTaxiRequestsKey,
  REQUEST_STATUS_LABEL, REQUEST_TYPE_LABEL, sortRequests, type KakaoTaxiRequest,
} from "../../admin/helpers/kakaoTaxiRequests";

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

  // 수정/삭제 요청 폼 — 인원 행의 버튼을 누르면 열린다. 사유 필수.
  const [requestTarget, setRequestTarget] = useState<{ member: KakaoTaxiMember; type: "update" | "delete" } | null>(null);
  const [requestReason, setRequestReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setRequestsError("");
    setMembersError("");
    // 신청 현황과 등록 인원은 실패를 각자 드러낸다 — 한쪽 실패가 다른 쪽을 가리지 않게 개별 처리.
    const [reqResult, memResult] = await Promise.allSettled([
      gasClient.getSharedDataFromServer<KakaoTaxiRequest[]>(requestsKey),
      gasClient.getKakaoTaxiBranchMembers(branchName, pinHash),
    ]);
    if (reqResult.status === "fulfilled") {
      setRequests(Array.isArray(reqResult.value) ? sortRequests(reqResult.value) : []);
    } else {
      console.error("비즈니스택시 신청 현황 로드 실패:", reqResult.reason);
      setRequests(null);
      setRequestsError("신청 현황을 불러오지 못했습니다. 네트워크 확인 후 새로고침해주세요.");
    }
    if (memResult.status === "fulfilled") {
      setMembers(memResult.value || []);
    } else {
      console.error("비즈니스택시 등록 인원 로드 실패:", memResult.reason);
      setMembers(null);
      setMembersError(String((memResult.reason as any)?.message || "등록 인원을 불러오지 못했습니다. 새로고침해주세요."));
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

  const submitRegister = async () => {
    if (saving) return;
    let request: KakaoTaxiRequest;
    try {
      request = createRegisterRequest(branchName, { name: regName, phone: regPhone, memo: regMemo });
    } catch (e: any) {
      window.alert(String(e?.message || e));
      return;
    }
    // 중복 최종 판정은 appendRequest 가 서버 최신본으로 한다(화면 상태만 믿으면 다른 기기 신청을 놓친다).
    if (!window.confirm(`비즈니스택시 이용신청을 등록할까요?\n\n이름: ${request.name}\n휴대전화: ${request.phone}\n\n관리자가 승인하면 직원 휴대폰으로 카카오T 인증 알림톡이 발송됩니다.`)) return;
    setSaving(true);
    try {
      await appendRequest(request);
      setRegName(""); setRegPhone(""); setRegMemo("");
      window.alert("이용신청이 등록되었습니다. 관리자 승인 후 처리 결과가 아래 '신청 현황'에 표시됩니다.");
    } catch (e: any) {
      window.alert(`신청 저장에 실패했습니다. 입력하신 내용은 그대로 남아 있으니 다시 시도해주세요.\n${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const submitMemberRequest = async () => {
    if (saving || !requestTarget) return;
    let request: KakaoTaxiRequest;
    try {
      request = createMemberRequest(requestTarget.type, branchName, { id: requestTarget.member.id, name: requestTarget.member.name }, requestReason);
    } catch (e: any) {
      window.alert(String(e?.message || e));
      return;
    }
    const typeLabel = REQUEST_TYPE_LABEL[requestTarget.type];
    if (!window.confirm(`${request.name} 님에 대한 ${typeLabel}을 등록할까요?\n\n사유: ${request.reason}`)) return;
    setSaving(true);
    try {
      await appendRequest(request);
      setRequestTarget(null);
      setRequestReason("");
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
          법인택시를 이용할 직원을 신청하면 관리자 승인 후 카카오T 비즈니스에 등록됩니다.
          승인되면 직원 휴대폰으로 <b>카카오T 인증 알림톡</b>이 발송되고, 직원이 카카오T 앱에서 인증을 마치면 이용할 수 있습니다.
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
          {saving ? "저장 중..." : "이용신청 등록"}
        </button>
      </section>

      {/* ---------- 우리 지점 등록 인원 ---------- */}
      <section className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="branch-pill-title">등록된 인원 ({branchName})</h3>
          <button onClick={() => void load()} disabled={loading}
            className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-[11px] font-black text-[#212121] disabled:opacity-50">새로고침</button>
        </div>
        {membersError && <div className={ERROR_BANNER}>{membersError}</div>}
        {loading && members === null && !membersError && <div className="py-10 text-center"><LoadingSpinner size="md" /></div>}
        {members !== null && (
          <>
            <div className="overflow-x-auto rounded-2xl border border-gray-100">
              <table className="w-full text-xs whitespace-nowrap">
                <thead><tr className="text-left">
                  <th className="px-3 py-2 text-[11px] font-black text-[#212121]">이름</th>
                  <th className="px-3 py-2 text-[11px] font-black text-[#212121]">휴대전화</th>
                  <th className="px-3 py-2 text-[11px] font-black text-[#212121]">상태</th>
                  <th className="px-3 py-2 text-[11px] font-black text-[#212121]">요청</th>
                </tr></thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-bold text-[#212121]">{m.name || "(이름 없음)"}</td>
                      <td className="px-3 py-2">{m.mobile_phone || "-"}</td>
                      <td className="px-3 py-2">{MEMBER_STATUS_LABEL[m.status] || m.status}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex gap-1.5">
                          <button onClick={() => { setRequestTarget({ member: m, type: "update" }); setRequestReason(""); }} disabled={saving}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-white border border-gray-200 disabled:opacity-50">수정 요청</button>
                          <button onClick={() => { setRequestTarget({ member: m, type: "delete" }); setRequestReason(""); }} disabled={saving}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-black text-[#B91C1C] bg-white border border-[#C93A3A] disabled:opacity-50">삭제 요청</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!members.length && (
                    <tr><td colSpan={4} className="px-3 py-8 text-center text-xs font-bold text-[#212121]/50">
                      이 지점으로 등록된 인원이 없습니다. (부서가 지점명으로 등록된 인원만 표시됩니다)
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {requestTarget && (
              <div className="rounded-2xl border border-gray-100 bg-white p-4 space-y-3">
                <p className="text-[11px] font-black text-[#212121]">
                  {requestTarget.member.name || "(이름 없음)"} 님 — {REQUEST_TYPE_LABEL[requestTarget.type]}
                </p>
                <textarea value={requestReason} onChange={(e) => setRequestReason(e.target.value)} disabled={saving}
                  placeholder={requestTarget.type === "delete" ? "삭제 요청 사유 (필수 — 예: 퇴사, 타지점 이동)" : "수정 요청 사유 (필수 — 예: 번호 변경, 소속 지점 정정)"}
                  className="w-full h-16 border border-gray-200 rounded-lg px-3 py-2 text-[11px] font-bold bg-white disabled:opacity-50 resize-none" />
                <div className="flex gap-2">
                  <button onClick={() => void submitMemberRequest()} disabled={saving}
                    className="h-8 rounded-lg bg-slate-800 px-3 text-[11px] font-black text-white disabled:opacity-50">요청 등록</button>
                  <button onClick={() => { setRequestTarget(null); setRequestReason(""); }} disabled={saving}
                    className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-[11px] font-black text-[#212121] disabled:opacity-50">취소</button>
                </div>
              </div>
            )}
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
