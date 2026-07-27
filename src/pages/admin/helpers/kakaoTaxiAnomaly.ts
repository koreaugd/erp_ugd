// src/pages/admin/helpers/kakaoTaxiAnomaly.ts
// 관리자 > 법인택시 > 이상 점검 — 규칙 기반 자동 표식. 차단이 아니라 "사람이 봐야 할 건"을 골라줄 뿐이다.
// 규칙 설계 근거: 외식업 특성상 마감 후 심야 퇴근 택시가 '정상' 패턴이므로, 흔한 심야 감시 대신
// 낮 시간대 이용을 점검 대상으로 잡는다.
import type { NormalizedTaxiOrder } from "./kakaoTaxi";

export interface TaxiAnomalyThresholds {
  /** R1: 건당 (요금+톨비)가 이 값 이상이면 고액 건 */
  highFare: number;
  /** R2: 직원 당월 합계가 전월의 이 배수 이상이면 급증 후보 */
  surgeRatio: number;
  /** R2: 배수 조건과 함께, 증가액이 이 값 이상이어야 급증으로 본다(소액 배수 급증 오탐 방지) */
  surgeMinIncrease: number;
  /** R3: 이 시각(포함)부터 */
  dayStartHour: number;
  /** R3: 이 시각(미만)까지를 '낮 시간대'로 본다 */
  dayEndHour: number;
}

export const DEFAULT_TAXI_THRESHOLDS: TaxiAnomalyThresholds = {
  highFare: 30000,
  surgeRatio: 2,
  surgeMinIncrease: 50000,
  dayStartHour: 6,
  dayEndHour: 17,
};

// 이상 점검 제외 대상 — 본사 운영진은 업무 특성상 고액/낮 시간대 이용이 정상 패턴이라
// 표식이 소음만 만든다(사용자 지시 2026-07-27). 이용내역 표에는 그대로 나온다 — 점검 표식만 제외.
// [동명이인 함정] 이름으로 거르면 지점에 같은 이름 직원이 생겼을 때 그 직원까지 조용히 점검에서
// 빠진다(사번=이름 관례라 identifier 로도 구분 불가) — 카카오 직원 고유 id 로 지정한다(운영 실측).
// 카카오에서 삭제 후 재등록하면 id 가 바뀌어 제외가 풀리고 점검 표에 다시 나타난다(눈에 보이는
// 실패라 안전한 방향 — 그때 이 목록의 id 만 갱신하면 된다).
export const TAXI_ANOMALY_EXEMPT_MEMBER_IDS = new Set([
  "JE1T6UC2", // 서광엽
  "OGKR9ACV", // 이미림
]);

export function isAnomalyExempt(memberId: string | null | undefined): boolean {
  return TAXI_ANOMALY_EXEMPT_MEMBER_IDS.has(String(memberId || "").trim());
}

export type TaxiAnomalyReason = "highFare" | "daytime" | "unmapped";

export const TAXI_ANOMALY_LABEL: Record<TaxiAnomalyReason, string> = {
  highFare: "고액",
  daytime: "낮 시간대",
  unmapped: "지점 미매핑",
};

export interface FlaggedTaxiOrder {
  row: NormalizedTaxiOrder;
  reasons: TaxiAnomalyReason[];
}

export interface MemberSurge {
  memberKey: string;
  name: string;
  branchName: string;
  prevAmount: number;
  currAmount: number;
  increase: number;
}

/** 건 단위 규칙(R1 고액 · R3 낮 시간대 · R4 미매핑). 모든 건이 모든 규칙에 대해 평가된다. */
export function flagTaxiOrders(rows: NormalizedTaxiOrder[], thresholds: TaxiAnomalyThresholds): FlaggedTaxiOrder[] {
  const flagged: FlaggedTaxiOrder[] = [];
  for (const row of rows) {
    if (isAnomalyExempt(row.order.member_id)) continue; // 본사 운영진 제외
    const reasons: TaxiAnomalyReason[] = [];
    if (row.amount >= thresholds.highFare) reasons.push("highFare");
    // hour 파싱 실패 건은 시간대 규칙에서 제외 — 억지로 플래그하면 오탐이 늘어 표식 신뢰가 떨어진다
    if (row.hour !== null && row.hour >= thresholds.dayStartHour && row.hour < thresholds.dayEndHour) reasons.push("daytime");
    if (row.unmapped) reasons.push("unmapped");
    if (reasons.length) flagged.push({ row, reasons });
  }
  // 금액 큰 순 — 관리자가 위에서부터 훑는다
  return flagged.sort((a, b) => b.row.amount - a.row.amount);
}

/**
 * R2 급증: 직원 당월 합계가 (전월 × 배수) 이상이면서 증가액이 최소치 이상.
 * 전월 이용이 아예 없던 직원은 배수를 계산할 수 없으므로 증가액 조건만으로 판단한다(신규 급증).
 */
export function detectMemberSurges(
  current: NormalizedTaxiOrder[],
  prevAmountByMember: Map<string, number>,
  thresholds: TaxiAnomalyThresholds
): MemberSurge[] {
  const currTotals = new Map<string, { name: string; branchName: string; amount: number }>();
  for (const row of current) {
    if (isAnomalyExempt(row.order.member_id)) continue; // 본사 운영진 제외
    const entry = currTotals.get(row.memberKey) || {
      name: (row.order.member_name || "").trim() || "(이름 없음)",
      branchName: row.branchName,
      amount: 0,
    };
    entry.amount += row.amount;
    currTotals.set(row.memberKey, entry);
  }
  const surges: MemberSurge[] = [];
  for (const [memberKey, curr] of currTotals) {
    const prev = prevAmountByMember.get(memberKey) || 0;
    const increase = curr.amount - prev;
    if (increase < thresholds.surgeMinIncrease) continue;
    if (prev > 0 && curr.amount < prev * thresholds.surgeRatio) continue;
    surges.push({ memberKey, name: curr.name, branchName: curr.branchName, prevAmount: prev, currAmount: curr.amount, increase });
  }
  return surges.sort((a, b) => b.increase - a.increase);
}
