// src/pages/branch/helpers/memoMetadata.ts
// 일일마감 메모에 숨겨 저장하는 메타데이터의 분리/합성 헬퍼.
// 동작 변경 없음 — 원본 코드를 그대로 이동함.

export const splitDailyMemoMetadata = (memo?: string | null) => {
  const raw = String(memo || "");
  const parts = raw.split("\n---\nMETADATA:");
  let metadata: any = {};
  if (parts[1]) {
    try {
      metadata = JSON.parse(parts.slice(1).join("\n---\nMETADATA:").trim()) || {};
    } catch {
      metadata = {};
    }
  }
  return { visibleMemo: parts[0] || "", metadata };
};

export const joinDailyMemoMetadata = (visibleMemo: string, metadata: any) => `${visibleMemo || ""}\n---\nMETADATA:\n${JSON.stringify(metadata || {})}`;
