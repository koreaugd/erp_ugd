// src/pages/admin/helpers/kakaoTaxiBranchHistory.ts
// 법인택시 직원의 지점(부서) 변경 이력 — "변경일부터만 새 지점으로 집계"의 원본 데이터(2026-07-29).
//
// 왜 필요한가: 이용내역은 ERP에 저장되지 않고 카카오 API가 **조회 시점의** 직원 부서(member_department)를
// 실어 보낸다(gas/Code.gs 참조). 그래서 부서를 바꾸면 과거 내역까지 새 지점으로 소급 집계되고,
// 직원을 삭제하면 과거 내역의 부서가 null 이 된다(실측 — KAKAO_RETIRED_MEMBER_BRANCH 하드코딩의 원인).
// 변경 시점을 ERP에 남겨 두고, 집계할 때 이용일 기준으로 지점을 판정해 과거를 보존한다.
//
// 저장: Firestore 공유데이터 `kakao_taxi_branch_history` (전역 1문서, { value: Entry[] }).
// 쓰기는 gasClient.appendSharedArrayItem(Firestore 트랜잭션)만 쓴다 — 배열을 읽어 통째로 저장하면
// 두 관리자의 동시 기록이 서로를 덮어쓴다(kakao_taxi_requests 와 같은 규약).

export const KAKAO_TAXI_BRANCH_HISTORY_KEY = "kakao_taxi_branch_history";

export interface KakaoTaxiBranchHistoryEntry {
  id: string;
  accountKey: string;
  memberId: string;
  /** 표시·추적용 스냅샷 — 판정에는 쓰지 않는다(동명이인 함정, memberId 로만 판정) */
  memberName: string;
  /** 변경 전 부서(원문). 부서가 없던 직원이면 빈 문자열 */
  fromBranch: string;
  /** 변경 후 부서(원문) */
  toBranch: string;
  /** YYYY-MM-DD — 이 날짜(포함)부터 toBranch 소속으로 집계된다 */
  effectiveDate: string;
  recordedAt: string; // ISO
  /** 기록 경위 — 예: "직원 수정", "변경신청 승인", "삭제 전 지점 스냅샷" */
  note?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function makeBranchHistoryId(): string {
  return `kbh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 이력 레코드 생성 — 검증 실패 시 사유 문자열을 던진다(화면이 alert 로 그대로 보여줌) */
export function createBranchHistoryEntry(input: {
  accountKey: string;
  memberId: string;
  memberName: string;
  fromBranch: string;
  toBranch: string;
  effectiveDate: string;
  note?: string;
}): KakaoTaxiBranchHistoryEntry {
  if (!input.memberId) throw new Error("대상 인원이 지정되지 않았습니다.");
  if (!DATE_RE.test(input.effectiveDate)) throw new Error("적용일을 선택해주세요. (예: 2026-07-29)");
  return {
    id: makeBranchHistoryId(),
    accountKey: String(input.accountKey || "acct1"),
    memberId: String(input.memberId),
    memberName: String(input.memberName || "").trim(),
    fromBranch: String(input.fromBranch || "").trim(),
    toBranch: String(input.toBranch || "").trim(),
    effectiveDate: input.effectiveDate,
    recordedAt: new Date().toISOString(),
    ...(input.note ? { note: input.note } : {}),
  };
}

const memberHistoryKey = (accountKey: string, memberId: string) =>
  `${String(accountKey || "acct1")}|${String(memberId)}`;

export type BranchHistoryMap = Map<string, KakaoTaxiBranchHistoryEntry[]>;

/** 이력 배열 → 직원별(계정|member_id) 맵. 각 목록은 적용일 오름차순(같으면 기록 시각순 — 나중 기록이 이긴다). */
export function buildBranchHistoryMap(entries: KakaoTaxiBranchHistoryEntry[] | null | undefined): BranchHistoryMap {
  const map: BranchHistoryMap = new Map();
  for (const e of entries || []) {
    if (!e || !e.memberId || !DATE_RE.test(String(e.effectiveDate || ""))) continue; // 깨진 레코드는 판정에 쓰지 않는다
    const key = memberHistoryKey(e.accountKey, e.memberId);
    const list = map.get(key) || [];
    list.push(e);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) =>
      (a.effectiveDate || "").localeCompare(b.effectiveDate || "") ||
      (a.recordedAt || "").localeCompare(b.recordedAt || "")
    );
  }
  return map;
}

/**
 * 이용일 기준 지점 판정 결과.
 * - { branch }     : 그 날짜의 소속 지점
 * - { unassigned } : 그 날짜에는 부서가 없었다 — 호출부는 '미지정'으로 표시해야 한다.
 *   null 로 돌려 기존 로직(현재 부서)으로 폴백하면, 부서가 없던 시절의 이용까지 지금 지점으로
 *   잘못 귀속된다(Codex 지적 2026-07-29).
 * - null           : 이 직원의 이력이 없거나 날짜를 모른다 — 기존 로직으로 폴백.
 */
export type BranchAtDate = { branch: string } | { unassigned: true } | null;

/**
 * 이용일 기준 지점 판정. 이 직원의 이력이 없으면 null(호출부가 기존 로직으로 폴백).
 * - 이용일 ≥ 어떤 이력의 적용일 → 그중 가장 늦은 이력의 toBranch (빈값이면 그 날짜엔 부서 없음)
 * - 이용일 < 첫 이력의 적용일 → 첫 이력의 fromBranch (빈값이면 그 날짜엔 부서 없음)
 * - 이용일을 파싱할 수 없으면 null — 날짜를 모르면 소급 판정하지 않는다.
 */
export function branchForOrderDate(
  map: BranchHistoryMap,
  accountKey: string,
  memberId: string,
  orderTimeText: string
): BranchAtDate {
  if (!memberId) return null;
  const list = map.get(memberHistoryKey(accountKey, memberId));
  if (!list || !list.length) return null;
  const day = String(orderTimeText || "").slice(0, 10);
  if (!DATE_RE.test(day)) return null;
  let branch: string | null = null;
  let matched = false;
  for (const e of list) {
    if (e.effectiveDate <= day) { branch = e.toBranch; matched = true; }
  }
  if (matched) return branch ? { branch } : { unassigned: true };
  const from = list[0].fromBranch;
  return from ? { branch: from } : { unassigned: true };
}
