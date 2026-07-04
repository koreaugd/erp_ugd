// src/pages/branch/helpers/dailyOps.ts
// 일일마감 메타데이터를 안전하게 갱신하는 공유 연산(여러 탭이 사용).
// BranchConfirmPage에서 분리 — 동작 변경 없음(코드 이동만).
import { gasClient } from "../../../api/gasClient";
import type { DailySettleDetail } from "../../../api/gasClient";
import { splitDailyMemoMetadata, joinDailyMemoMetadata } from "./memoMetadata";

export const updateDailyMetadata = async (
  recordId: string,
  updater: (metadata: any, detail: DailySettleDetail) => { metadata: any; staff?: any[]; expenses?: any[]; masterPatch?: any } | void
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
    "관리자"
  );
};
