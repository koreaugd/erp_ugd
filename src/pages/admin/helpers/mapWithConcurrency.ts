// src/pages/admin/helpers/mapWithConcurrency.ts
// 목록을 limit 개씩만 동시에 처리한다(Promise.all 은 전부 한꺼번에 던진다).
// 매출 대시보드('올해' = 지점×월 수백 건)와 분석 탭(지점×6개월×5키)이 공유한다.
//
// `shouldContinue` 가 false 를 돌려주면 남은 작업을 시작하지 않는다 — 무거운 조회 도중
// 사용자가 기간/월을 바꿨을 때, 이미 의미 없어진 조회가 계속 서버를 때리지 않게 하기 위함이다.
// 중단되면 결과 배열에 undefined 구멍이 남으므로, 호출부는 반드시 최신 요청인지 확인한 뒤에만 결과를 쓴다.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
  shouldContinue: () => boolean = () => true
): Promise<Array<R | undefined>> {
  const results = new Array<R | undefined>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      if (!shouldContinue()) return;
      const index = cursor++;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
