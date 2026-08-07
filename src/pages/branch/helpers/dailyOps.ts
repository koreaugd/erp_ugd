// src/pages/branch/helpers/dailyOps.ts
// 일일마감 메타데이터를 안전하게 갱신하는 공유 연산(여러 탭이 사용).
// BranchConfirmPage에서 분리 — 동작 변경 없음(코드 이동만).
import { gasClient } from "../../../api/gasClient";
import type { DailySettleDetail } from "../../../api/gasClient";
import { splitDailyMemoMetadata, joinDailyMemoMetadata } from "./memoMetadata";

/**
 * @param actor 이 수정을 실제로 한 사람. 수정이력(edit_logs)에 그대로 남는다.
 *
 * 기본값 없이 필수로 받는다 — 안 넘기면 컴파일 오류가 난다. 예전엔 기본값이 "관리자"라
 * 지점이 고친 기록도 "관리자가 고쳤다"고 거짓으로 남을 수 있었다(설계서 §7).
 * 개인 로그인 계정이면 uid도 함께 넘겨 Firebase 문서·이력에 병행 기록한다.
 */
export const updateDailyMetadata = async (
  recordId: string,
  updater: (metadata: any, detail: DailySettleDetail) => { metadata: any; staff?: any[]; expenses?: any[]; masterPatch?: any } | void,
  actor: { name: string; uid?: string },
  // reason: 이 수정/삭제의 사유(예: 카드결제 취소·반품). 수정이력(edit_logs)에 함께 남는다.
  options?: { reason?: string }
) => {
  // Firestore 트랜잭션으로 읽고-고치고-쓴다(Codex P0 2026-08-08).
  // 종전에는 먼저 읽은 스냅샷을 고쳐 통째로 덮어써서, 두 기기가 같은 날 기록을 동시에 고치면
  // (지출 A·B를 각자 삭제 등) 나중 저장이 먼저 저장을 되살렸다. 이제 경합하면 updater가
  // 최신 문서로 다시 실행된다 — 그래서 updater는 순수해야 한다(이 파일을 쓰는 모든 탭이 그렇다).
  return await gasClient.updateDailyAtomic(recordId, (detail) => {
    const { visibleMemo, metadata } = splitDailyMemoMetadata(detail.master?.memo);
    const result = updater(metadata, detail) || { metadata };
    const nextMetadata = result.metadata || metadata;
    const master = {
      ...detail.master,
      ...(result.masterPatch || {}),
      memo: joinDailyMemoMetadata(visibleMemo, nextMetadata)
    };
    return { master, expenses: result.expenses || detail.expenses, staff: result.staff || detail.staff };
  }, actor.name, actor.uid, options?.reason);
};
