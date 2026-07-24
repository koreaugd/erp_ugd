// src/pages/admin/helpers/kakaoTaxiRequests.ts
// 지점 비즈니스택시 신청(이용신청·수정요청·삭제요청) 레코드의 공용 타입·순수 함수.
// 지점 탭(BusinessTaxiTab)과 관리자 신청 관리(KakaoTaxiSection)가 같이 쓴다.
// 저장 위치: Firestore 공유데이터 `kakao_taxi_requests:<지점>` (지점별 배열 — 설계서 참조).

export type KakaoTaxiRequestType = "register" | "update" | "delete";
// processing = 관리자가 처리를 선점한 중간 상태. 카카오 API 호출 **전에** 저장되어
// 두 관리자가 같은 신청을 동시에 승인하는 이중 실행을 막는다(실패 시 pending 으로 되돌림).
export type KakaoTaxiRequestStatus = "pending" | "processing" | "approved" | "rejected";

export interface KakaoTaxiRequest {
  id: string;
  type: KakaoTaxiRequestType;
  branchName: string;
  status: KakaoTaxiRequestStatus;
  requestedAt: string; // ISO
  /** register: 등록할 직원 이름 / update·delete: 대상 인원 이름(표시용 스냅샷) */
  name: string;
  /** register 전용 — 숫자만 저장 */
  phone?: string;
  /** register 전용 — 지점이 남기는 메모(선택) */
  memo?: string;
  /** update·delete 전용 — 카카오 member id */
  memberId?: string;
  /** update·delete 필수 — 요청 사유 */
  reason?: string;
  processedAt?: string;
  /** processing 선점 시각·주체 (동시 승인 방지용) */
  claimedAt?: string;
  claimedBy?: string;
  /** rejected 필수 — 반려 사유 (지점 화면에 그대로 보인다) */
  rejectReason?: string;
  /** approved 부가 정보 — 예: "카카오 등록됨(인증 알림톡 발송)" */
  resultNote?: string;
}

export const KAKAO_TAXI_REQUESTS_KEY_PREFIX = "kakao_taxi_requests:";
export const kakaoTaxiRequestsKey = (branchName: string) => `${KAKAO_TAXI_REQUESTS_KEY_PREFIX}${branchName}`;

export const REQUEST_TYPE_LABEL: Record<KakaoTaxiRequestType, string> = {
  register: "이용신청(등록)",
  update: "수정 요청",
  delete: "삭제 요청",
};

export const REQUEST_STATUS_LABEL: Record<KakaoTaxiRequestStatus, string> = {
  pending: "대기",
  processing: "처리 중",
  approved: "승인",
  rejected: "반려",
};

// [주의] 신청 배열은 "읽어서 통째로 저장"하지 않는다 — 동시 제출/처리 때 서로를 덮어써 신청이 사라진다.
// 추가는 gasClient.appendSharedArrayItem, 상태 전이는 gasClient.updateSharedArrayItem
// (둘 다 Firestore 트랜잭션)만 쓴다.

export function makeRequestId(): string {
  return `ktr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizePhone(raw: string): string {
  return String(raw || "").replace(/[^0-9]/g, "");
}

export function isValidPhone(digits: string): boolean {
  return /^01[0-9]{8,9}$/.test(digits);
}

/** 이용신청(등록) 레코드 생성 — 검증 실패 시 사유 문자열을 던진다(화면이 alert 로 그대로 보여줌) */
export function createRegisterRequest(branchName: string, input: { name: string; phone: string; memo?: string }): KakaoTaxiRequest {
  const name = (input.name || "").trim();
  const phone = normalizePhone(input.phone);
  if (!name) throw new Error("이름을 입력해주세요.");
  if (!isValidPhone(phone)) throw new Error("휴대전화번호를 확인해주세요. (예: 01012345678)");
  return {
    id: makeRequestId(),
    type: "register",
    branchName,
    status: "pending",
    requestedAt: new Date().toISOString(),
    name,
    phone,
    ...(input.memo?.trim() ? { memo: input.memo.trim() } : {}),
  };
}

/** 수정/삭제 요청 레코드 생성 — 사유 필수 */
export function createMemberRequest(
  type: "update" | "delete",
  branchName: string,
  member: { id: string; name: string },
  reason: string
): KakaoTaxiRequest {
  const trimmed = (reason || "").trim();
  if (!trimmed) throw new Error("요청 사유를 입력해주세요.");
  if (!member?.id) throw new Error("대상 인원이 지정되지 않았습니다.");
  return {
    id: makeRequestId(),
    type,
    branchName,
    status: "pending",
    requestedAt: new Date().toISOString(),
    name: member.name || "(이름 없음)",
    memberId: member.id,
    reason: trimmed,
  };
}

const isOpen = (s: KakaoTaxiRequestStatus) => s === "pending" || s === "processing";

/** 처리 전(대기·처리중) 먼저, 그 안에서는 최신순 */
export function sortRequests(list: KakaoTaxiRequest[]): KakaoTaxiRequest[] {
  return [...list].sort((a, b) => {
    if (isOpen(a.status) !== isOpen(b.status)) return isOpen(a.status) ? -1 : 1;
    return (b.requestedAt || "").localeCompare(a.requestedAt || "");
  });
}

/**
 * 처리 결과를 배열에 반영한다(순수 함수 — 저장은 호출부 책임).
 * 이미 처리된 신청이면 반영하지 않고 alreadyProcessed 로 알린다 — 두 관리자가 동시에 처리하는 경쟁 방지.
 */
// [주의] 신청의 상태 전이(선점·승인·반려)는 이 파일의 순수 함수로 하지 않는다.
// 배열을 읽고-고치고-쓰면 두 관리자가 동시에 통과해 카카오 등록이 이중 실행될 수 있어,
// gasClient.updateSharedArrayItem(Firestore 트랜잭션 compare-and-set)만 쓴다.
// - 선점: expectStatus ["pending"] → processing
// - 실패 복구: ["processing"] → pending
// - 최종 기록: ["pending","processing"] → approved | rejected
