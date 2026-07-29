// src/pages/admin/helpers/kakaoTaxiOrdersCache.ts
// 카카오T 이용내역 월별 조회의 세션 내 공유 캐시(2026-07-29, 사용자 체감속도 요청).
//
// 왜: 관리자 대시보드(점검 대상 수 계산)와 법인택시 > 이용내역이 **같은 달을 각자 조회**해,
// 대시보드를 본 직후 이용내역을 열어도 처음부터 다시 기다렸다(카카오 API 왕복 5~12초).
// 진행 중/완료된 조회 프로미스를 모듈 스코프에 공유해 두 번째 진입을 즉시 만든다 —
// 대시보드가 먼저 조회해 두면 이용내역 클릭 시 바로 뜬다.
//
// 캐시 완전성 규약(법인택시 성능개선 2026-07-27과 동일):
// - 계정 일부 실패(accountErrors)가 실린 결과는 캐시에 남기지 않는다 — 남기면 재진입마다
//   같은 결함 데이터가 "빠르게" 보인다. 실패는 매번 다시 조회해 스스로 낫게 한다.
// - 직원 쓰기(부서 변경·등록·삭제) 후에는 반드시 invalidate — 백엔드 캐시 무효화와 짝.
import { gasClient } from "../../../api/gasClient";

type OrdersResult = Awaited<ReturnType<typeof gasClient.getKakaoTaxiOrders>>;

const TTL_MS = 10 * 60 * 1000;   // 백엔드(ScriptCache) 캐시와 비슷한 수준 — 오래된 화면 고착 방지
const cache = new Map<string, { at: number; promise: Promise<OrdersResult> }>();

export function getKakaoTaxiOrdersShared(month: string, pinHash: string, forceRefresh?: boolean): Promise<OrdersResult> {
  const key = `${pinHash}|${month}`;   // 재로그인(pinHash 변경) 시 이전 세션 캐시를 자연 격리
  const hit = cache.get(key);
  if (!forceRefresh && hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = gasClient.getKakaoTaxiOrders(month, pinHash, forceRefresh)
    .then((result) => {
      if ((result.accountErrors || []).length > 0) cache.delete(key);
      return result;
    })
    .catch((e) => {
      cache.delete(key);
      throw e;
    });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

/** 직원 쓰기(부서·등록·삭제) 후 호출 — 묵은 집계가 캐시로 되살아나지 않게 전부 비운다. */
export function invalidateKakaoTaxiOrdersShared(): void {
  cache.clear();
}
