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
  actor: { name: string; uid?: string }
) => {
  const detail = await gasClient.getDailyDetail(recordId);
  const { visibleMemo, metadata } = splitDailyMemoMetadata(detail.master?.memo);
  const result = updater(metadata, detail) || { metadata };
  const nextMetadata = result.metadata || metadata;
  const masterPatch = {
    ...detail.master,
    ...(result.masterPatch || {}),
    memo: joinDailyMemoMetadata(visibleMemo, nextMetadata)
  };
  return await gasClient.updateDaily(
    recordId,
    masterPatch,
    result.expenses || detail.expenses,
    result.staff || detail.staff,
    actor.name,
    actor.uid
  );
};
