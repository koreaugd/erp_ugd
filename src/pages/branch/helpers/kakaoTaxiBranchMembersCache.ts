// src/pages/branch/helpers/kakaoTaxiBranchMembersCache.ts
// 지점 > 비즈니스택시 '등록된 인원'의 세션 내 공유 캐시(2026-08-06, 사용자 체감속도 요청).
//
// 왜: 이 조회 하나가 화면에서 가장 느리다. 카카오 API 를 타기 때문인데, 백엔드가 계정을
// **순서대로** 돌며 받아오므로(gas/Code.gs kakaoTaxiCollect) 계정 수만큼 왕복이 쌓인다
// (실측 첫 조회 7.7초, 백엔드 캐시가 살아 있어도 2.7초). 그런데 지점은 이 탭을 자주 드나들고,
// 탭을 나갔다 오면 컴포넌트가 다시 마운트돼 **매번 처음부터** 기다렸다.
//
// 그래서 관리자 이용내역(admin/helpers/kakaoTaxiOrdersCache.ts)과 같은 방식으로,
// 진행 중이거나 방금 끝난 조회를 모듈 스코프에 공유한다. 탭 재진입은 기다림 없이 즉시 그린다.
//
// 규약(위 이용내역 캐시와 동일하게 유지할 것):
// - 실패한 조회는 캐시에 남기지 않는다 — 남기면 재진입마다 같은 실패가 "빠르게" 반복된다.
// - '새로고침'(forceRefresh)은 캐시를 지나쳐 새로 받고, 그 결과로 캐시를 갱신한다.
// - 카카오에 쓰는 동작(등록·전입) 뒤에는 forceRefresh 로 받아 캐시를 덮는다.
// - **디스크에 남기지 않는다**(sessionStorage 등). 직원 이름·전화번호라서 세션 메모리까지만 둔다.
import { gasClient } from "../../../api/gasClient";
import type { KakaoTaxiMember } from "../../../api/gasClient";

// 백엔드 ScriptCache TTL(90초)보다 조금 길게 잡는다 — 더 짧게 두면 왕복만 다시 하고
// 같은 값을 받아오는 구간이 생긴다. 더 길게 두면 관리자가 처리한 이용중지·이용재개가
// 지점 화면에 늦게 반영된다(그 경우도 '새로고침' 한 번이면 즉시 최신).
const TTL_MS = 120 * 1000;

type Entry = {
  at: number;
  promise: Promise<KakaoTaxiMember[]>;
  /** 이미 도착한 값 — 첫 렌더에 **기다리지 않고** 꽂아 넣기 위해 따로 들고 있는다. */
  value?: KakaoTaxiMember[];
};

const cache = new Map<string, Entry>();

// 지점명까지 키에 넣는다 — PIN 은 지점끼리 공통일 수 있어(운영 14지점 공통) pinHash 만으로는
// 다른 지점의 인원이 그대로 보인다. pinHash 를 함께 넣어 재로그인 시 옛 세션과 자연 분리한다.
const keyOf = (branchName: string, pinHash: string) => `${branchName}|${pinHash}`;

/**
 * 캐시에 **이미 도착해 있는** 값만 즉시 돌려준다(없으면 null). 첫 렌더의 초기값 전용 —
 * 이걸 안 쓰면 캐시가 살아 있어도 프라미스 한 틱 때문에 로딩 스피너가 한 번 깜빡인다.
 *
 * TTL 이 지난 값도 돌려주되 **stale 을 함께 알린다.** 빈 화면보다 묵은 표가 낫지만,
 * 묵은 줄 모르고 쓰면 그게 곧 이 화면의 원래 문제(잘못된 상태를 확정처럼 보여주기)가 된다 —
 * 호출부는 stale 인 동안 '확인 중'을 유지하고 재조회 결과로 확정해야 한다(Codex 2026-08-06).
 */
export function peekBranchMembers(
  branchName: string, pinHash: string
): { members: KakaoTaxiMember[]; stale: boolean } | null {
  const hit = cache.get(keyOf(branchName, pinHash));
  if (!hit || !hit.value) return null;
  // stale 판정 기준은 getBranchMembersShared 의 TTL 과 **같아야 한다** — 다르면
  // "묵었다고 표시했는데 재조회는 안 하는"(또는 그 반대) 구간이 생긴다.
  return { members: hit.value, stale: Date.now() - hit.at >= TTL_MS };
}

export function getBranchMembersShared(
  branchName: string, pinHash: string, forceRefresh?: boolean
): Promise<KakaoTaxiMember[]> {
  const key = keyOf(branchName, pinHash);
  const hit = cache.get(key);
  if (!forceRefresh && hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const entry: Entry = {
    at: Date.now(),
    promise: gasClient.getKakaoTaxiBranchMembers(branchName, pinHash, forceRefresh)
      .then((value) => {
        const list = value || [];
        // 이 항목이 아직 최신일 때만 값을 붙인다 — 늦게 도착한 옛 조회가 새 결과를 덮지 않게.
        if (cache.get(key) === entry) entry.value = list;
        return list;
      })
      .catch((e) => {
        if (cache.get(key) === entry) cache.delete(key);
        throw e;
      }),
  };
  cache.set(key, entry);
  return entry.promise;
}

/** 인원이 바뀌는 동작 뒤 호출 — 묵은 목록이 캐시로 되살아나지 않게 전부 비운다. */
export function invalidateBranchMembersShared(): void {
  cache.clear();
}
