/**
 * 월말마감 상태 가드 — 확정(confirmed)되었거나 지점이 수정중(editing)인 달의 매입매출 문서를
 * 스크립트가 덮어쓰거나 지우지 못하게 막는다.
 *
 * 시드/이월/복구 스크립트가 모두 이 모듈을 쓴다. Firestore 를 모르는 순수 함수라 단위 검증이 가능하다.
 *
 * 상태 판정은 MonthlySettleTab 의 getSectionStatus 와 같은 규칙을 따른다:
 *   - section 이 없는 옛 레코드는 "purchase" 로 간주
 *   - 같은 (지점, 월, 섹션) 레코드가 여럿이면 updatedAt/confirmedAt 이 가장 최신인 것을 채택
 */

export const PURCHASE_PREFIX = "monthly_purchases:";

/**
 * "monthly_purchases:대물섬 한남점:2026-06" → { governed: true, branchName, month }
 *
 *  - 매입매출 키가 아니면 { governed: false } — 마감 상태가 관장하지 않으므로 가드 대상이 아니다.
 *  - 매입매출 키인데 형식이 깨졌으면 { governed: true, malformed: true } — 안전하게 막는다(fail-closed).
 */
export function parseDataKey(dataKey) {
  const key = String(dataKey);
  if (!key.startsWith(PURCHASE_PREFIX)) return { governed: false };
  const parts = key.split(":");
  if (parts.length !== 3 || !parts[1] || !/^\d{4}-\d{2}$/.test(parts[2])) return { governed: true, malformed: true };
  return { governed: true, branchName: parts[1], month: parts[2] };
}

export function sectionStatus(closings, branchName, month, section = "purchase") {
  const matches = (Array.isArray(closings) ? closings : []).filter(
    (r) => r.branchName === branchName && r.month === month && (r.section || "purchase") === section
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => String(b.updatedAt || b.confirmedAt || "").localeCompare(String(a.updatedAt || a.confirmedAt || "")));
  return matches[0].status || null;
}

/** 건드리려는 dataKey 중 막아야 할 것들을 돌려준다. 빈 배열이면 진행해도 된다. */
export function blockedTargets(closings, dataKeys, { allowEditing = false } = {}) {
  const blocked = [];
  for (const dataKey of dataKeys) {
    const parsed = parseDataKey(dataKey);
    if (!parsed.governed) continue; // 매입매출 키가 아니면 마감 상태와 무관
    if (parsed.malformed) {
      blocked.push({ dataKey, status: null, reason: "매입매출 키인데 형식을 해석할 수 없음" });
      continue;
    }
    const status = sectionStatus(closings, parsed.branchName, parsed.month);
    if (status === "confirmed") {
      blocked.push({ dataKey, branchName: parsed.branchName, month: parsed.month, status, reason: "매입매출이 확정된 달 — 덮어쓰면 마감 자료가 사라짐" });
    } else if (status === "editing" && !allowEditing) {
      blocked.push({ dataKey, branchName: parsed.branchName, month: parsed.month, status, reason: "지점이 마감 수정중 — 강행하려면 --allow-editing" });
    }
  }
  return blocked;
}

/** 막힌 대상을 사람이 읽을 형태로 출력하고, 하나라도 있으면 true. */
export function reportBlocked(blocked) {
  if (blocked.length === 0) return false;
  console.error(`\n중단: 마감 상태 때문에 건드릴 수 없는 문서가 ${blocked.length}개 있습니다.\n`);
  for (const item of blocked) {
    console.error(`  ${item.dataKey}  [${item.status ?? "?"}]  ${item.reason}`);
  }
  return true;
}
