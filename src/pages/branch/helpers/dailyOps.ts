// src/pages/branch/helpers/dailyOps.ts
// 일일마감 메타데이터를 안전하게 갱신하는 공유 연산(여러 탭이 사용).
// BranchConfirmPage에서 분리 — 동작 변경 없음(코드 이동만).
import { gasClient } from "../../../api/gasClient";
import type { DailySettleDetail } from "../../../api/gasClient";
import { splitDailyMemoMetadata, joinDailyMemoMetadata } from "./memoMetadata";

/**
 * @param actor 이 수정을 실제로 한 사람. 수정이력(edit_logs)에 그대로 남는다.
 *
 * 기본값이 "관리자"인 이유는 예전에 관리자만 이 함수를 쓸 수 있었기 때문이다.
 * 지점도 고칠 수 있게 된 화면은 반드시 지점명을 넘겨야 한다 —
 * 안 넘기면 지점이 지운 기록이 "관리자가 지웠다"고 남아 이력이 거짓이 된다.
 */
export const updateDailyMetadata = async (
  recordId: string,
  updater: (metadata: any, detail: DailySettleDetail) => { metadata: any; staff?: any[]; expenses?: any[]; masterPatch?: any } | void,
  actor: string = "관리자"
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
  await gasClient.updateDaily(
    recordId,
    masterPatch,
    result.expenses || detail.expenses,
    result.staff || detail.staff,
    actor
  );
};
