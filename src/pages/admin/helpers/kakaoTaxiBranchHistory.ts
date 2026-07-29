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

import { gasClient } from "../../../api/gasClient";

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

// ----------------------------------------------------
// 이력 기록(쓰기) — 관리자 화면(KakaoTaxiSection)과 지점 화면(BusinessTaxiTab)이 **같은 함수**를 쓴다.
// 한쪽만 규약이 달라지면(선기록 생략·보정 누락) 그 경로로 바꾼 직원의 과거 내역이 소급 집계된다.
// ----------------------------------------------------

/** 이력 append(2회 재시도). 성공하면 true — 실패해도 던지지 않는다(호출부가 흐름을 정한다). */
export async function appendBranchHistory(entry: KakaoTaxiBranchHistoryEntry): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await gasClient.appendSharedArrayItem(
        KAKAO_TAXI_BRANCH_HISTORY_KEY,
        entry as unknown as Record<string, unknown>
      );
      return true;
    } catch (e) {
      console.error(`지점 변경 이력 기록 실패(${attempt + 1}/2):`, e);
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  return false;
}

/**
 * 부서 변경 이력 **선기록** + 실패 시 사용자 주도 재시도.
 * 이력은 카카오 반영보다 **먼저** 남긴다 — 카카오만 바뀌고 이력이 없으면 과거 내역이 통째로
 * 소급되는데, 그 상태는 재시도 경로를 만들기 어렵다(부서가 이미 새 값이라 변경 전 지점을 모른다).
 * 선기록이 실패하면 호출부는 변경 자체를 진행하지 않는다(fail-closed — 아무것도 안 바뀐 상태라
 * 그냥 다시 시도하면 된다). 카카오가 확실히 실패하면 보정 이력(appendBranchHistoryReversal)으로 되돌린다.
 */
export async function appendBranchHistoryOrWarn(entry: KakaoTaxiBranchHistoryEntry): Promise<boolean> {
  let recorded = await appendBranchHistory(entry);
  while (!recorded) {
    const retry = window.confirm(
      "지점 변경 이력 기록에 실패했습니다.\n" +
      "기록 없이 부서를 바꾸면 과거 이용내역까지 새 지점으로 집계되므로, 기록 전에는 변경을 진행하지 않습니다.\n\n" +
      "지금 다시 시도할까요?"
    );
    if (!retry) {
      window.alert("이력이 기록되지 않아 지점 변경을 진행하지 않았습니다. 네트워크 확인 후 다시 시도해주세요.");
      return false;
    }
    recorded = await appendBranchHistory(entry);
  }
  return true;
}

/**
 * 선기록 보정 — 이력을 먼저 남겼는데 카카오 반영이 '확실히' 실패했을 때, 반대 방향 이력을 덧붙여
 * 집계를 원상복구한다(append-only 저장소라 삭제 대신 상쇄). 같은 적용일의 나중 기록이 이기므로
 * (buildBranchHistoryMap 정렬 규칙) 모든 날짜가 변경 전 지점으로 되돌아간다.
 *
 * [반드시 확인하고 되돌린다] 바로 그 '나중 기록이 이긴다'는 성질 때문에, 우리가 실패한 사이 다른
 * 경로(다른 지점의 정상 전입·관리자 변경)가 더 새 이력을 남겼다면 우리 보정이 **그 진짜 변경까지
 * 덮어써** 집계가 틀어진다(Codex stop-time 지적 2026-07-30). 그래서 우리 항목이 아직 이 직원의
 * 마지막 기록일 때만 되돌리고, 아니면 손대지 않고 사람에게 알린다.
 */
export async function appendBranchHistoryReversal(entry: KakaoTaxiBranchHistoryEntry): Promise<void> {
  // [fail-closed] 확인하지 못하면 쓰지 않는다. 보정은 append-only 저장소에 '나중 기록'을 더하는
  // 일이라, 잘못 쓰면 다른 지점이 남긴 정상 이력까지 무효로 만든다(되돌리기 어렵다).
  // 반대로 보정을 못 해도 틀어지는 것은 이 직원 한 명의 귀속뿐이고, 관리자가 다시 기록해 고칠 수 있다.
  let list: KakaoTaxiBranchHistoryEntry[] | null = null;
  let verified = false;
  for (let attempt = 0; attempt < 2 && !verified; attempt++) {
    try {
      list = await gasClient.getSharedDataFromServer<KakaoTaxiBranchHistoryEntry[]>(KAKAO_TAXI_BRANCH_HISTORY_KEY);
      verified = true;
    } catch (e) {
      console.error(`보정 전 이력 확인 실패(${attempt + 1}/2):`, e);
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  if (!verified) {
    window.alert(
      "지점 변경은 실행되지 않았는데, 미리 남긴 기록을 되돌려도 되는지 확인하지 못했습니다.\n" +
      "잘못 되돌리면 다른 지점의 기록까지 어긋나므로 그대로 두었습니다.\n\n" +
      "이 직원의 이용내역이 엉뚱한 지점으로 보이면 관리자에게 알려 소속·이력을 확인해주세요."
    );
    return;
  }
  const mine = (list || []).filter(
    (e) => e && String(e.memberId) === String(entry.memberId)
      && String(e.accountKey || "acct1") === String(entry.accountKey || "acct1")
  );
  mine.sort((a, b) =>
    (a.effectiveDate || "").localeCompare(b.effectiveDate || "") ||
    (a.recordedAt || "").localeCompare(b.recordedAt || "")
  );
  const last = mine[mine.length - 1];
  if (!last || last.id !== entry.id) {
    // 우리 항목이 마지막이 아니다(또는 아예 없다) — 더 새 기록이 현재 상태를 설명하고 있으므로
    // 여기서 반대 이력을 덧붙이면 그 기록을 무효로 만든다. 건드리지 않고 알린다.
    console.warn("보정 생략 — 더 새로운 지점 변경 이력이 있습니다:", { mine: entry.id, last: last?.id });
    window.alert(
      "지점 변경은 실행되지 않았지만, 그 사이 이 직원의 소속이 다른 곳에서 바뀌어 기록을 되돌리지 않았습니다.\n" +
      "관리자 > 법인택시에서 현재 소속이 맞는지 한 번 확인해주세요."
    );
    return;
  }
  const reverted = await appendBranchHistory(createBranchHistoryEntry({
    accountKey: entry.accountKey,
    memberId: entry.memberId,
    memberName: entry.memberName,
    fromBranch: entry.toBranch,
    toBranch: entry.fromBranch,
    effectiveDate: entry.effectiveDate,
    note: "변경 실패 보정",
  }));
  if (!reverted) {
    window.alert(
      "부서 변경은 실행되지 않았는데, 미리 남긴 지점 변경 이력을 되돌리지 못했습니다.\n" +
      "이 직원의 집계가 새 지점으로 잘못 보이면, 잠시 후 부서 변경을 다시 시도해 상태를 맞춰주세요."
    );
  }
}

/**
 * 이 오류를 보고 "카카오가 실행되지 않았다"고 단정할 수 있는가?
 *
 * 타임아웃·네트워크 단절은 **요청이 서버에 닿아 실행됐을 수도** 있다. 이때 되돌리면(선점 해제·이력 보정)
 * 실제로는 반영된 변경을 없던 일로 만들어 집계가 어긋난다. 그런 오류는 사람이 실제 반영을 확인하게 둔다.
 */
export function isKakaoWriteDefinitelyNotExecuted(e: any): boolean {
  const msg = String(e?.message || e || "");
  const name = String(e?.name || "");
  if (name === "AbortError" || /aborted|timeout|시간이 초과|응답이 지연|network|Failed to fetch|NetworkError/i.test(msg)) return false;
  // 값 검증 실패 등 백엔드가 카카오를 부르기 전에 거부한 경우는 실행되지 않은 것이 확실하다.
  // 뒤쪽 네 개는 전입(transferKakaoTaxiMember)의 사전 거부 문구 — 전부 카카오 호출 이전에만 나온다
  // (대상 없음·그룹 없음·이미 우리 지점·계정 간 이동·계정 조회 실패 fail-closed).
  if (/필요합니다|올바르지 않|지정되지 않았습니다|관리자만|연동 정보가 없습니다/.test(msg)) return true;
  if (/찾지 못했습니다|이미 우리 지점|인증에 실패|진행하지 않았습니다|옮길 수 없습니다/.test(msg)) return true;
  // 카카오가 명시적 오류코드를 준 경우도 실행 실패로 본다.
  if (/카카오T API 오류/.test(msg)) return true;
  return false; // 알 수 없는 오류는 안전한 쪽(실행됐을 수 있음)으로 본다
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
