// src/pages/admin/helpers/kakaoTaxi.ts
// 관리자 > 법인택시 — 카카오T 이용내역의 정규화(지점 매핑)·집계 순수 함수 모음.
// 화면(KakaoTaxiSection.tsx)은 조회·표시만 하고 계산은 전부 여기서 한다.
import type { KakaoTaxiOrder } from "../../../api/gasClient";

// 카카오 쪽 표기(그룹명·부서명) → ERP 표준 지점명 별칭표.
// 카카오 그룹은 지점이 아니라 '동네' 단위(예: 한남점 그룹에 남산광어 직원이 속함)라서
// 지점 판정은 member_department 를 우선하고, 그룹명은 보조로만 쓴다.
// 여기 없는 표기는 버리지 않고 원문 그대로 + 미매핑 표시로 내보낸다(집계 소실 금지).
// 2026-06~07 실데이터 409건 전수 조사로 채움(2026-07-24). 새 변형 표기가 미매핑으로 뜨면 여기에 한 줄 추가.
// 별칭은 ERP 지점목록에 실제 존재할 때만 적용되므로(resolveBranchName), 지점이 없으면 자동으로 미매핑 표시된다.
export const KAKAO_BRANCH_ALIASES: Record<string, string> = {
  "금샤빠 을지로": "금샤빠",
  "대물섬 한남동": "대물섬 한남점", // 실측 6건
  "대골뼈국": "강남대골뼈국", // 실측 11건
  "대물섬종로점": "대물섬 종로점", // 붙여쓰기 변형, 실측 3건
};

export interface NormalizedTaxiOrder {
  order: KakaoTaxiOrder;
  /** ERP 표준 지점명 (매핑 실패 시 카카오 원문 표기 그대로) */
  branchName: string;
  /** ERP 지점명으로 확정하지 못한 건 — 화면에서 표식을 붙이고 이상 점검 대상이 된다 */
  unmapped: boolean;
  /** 요금 + 톨비. platform_fee 는 0으로 오고 있으나 명세상 별도 항목이라 합산하지 않는다 */
  amount: number;
  /** 출발 시각 기준 (없으면 호출 시각) — "YYYY-MM-DD HH:mm:ss" */
  timeText: string;
  /** timeText 의 시(hour). 파싱 불가 시 null — 시간대 규칙 평가에서 제외하고 화면에 원문만 보여준다 */
  hour: number | null;
  /** 직원 구분 키 — 동명이인 대비 사번(identifier)까지 붙인다 */
  memberKey: string;
}

function resolveBranchName(order: KakaoTaxiOrder, erpBranchNames: Set<string>): { branchName: string; unmapped: boolean } {
  const candidates = [order.member_department, order.group_name]
    .map((v) => (v || "").trim())
    .filter(Boolean);
  for (const raw of candidates) {
    if (erpBranchNames.has(raw)) return { branchName: raw, unmapped: false };
    const alias = KAKAO_BRANCH_ALIASES[raw];
    if (alias && erpBranchNames.has(alias)) return { branchName: alias, unmapped: false };
  }
  // 매핑 실패 — 부서 원문(없으면 그룹 원문)을 그대로 보여준다. 숨기면 금액이 사라진 것처럼 보인다.
  return { branchName: candidates[0] || "미지정", unmapped: true };
}

export function normalizeKakaoTaxiOrders(orders: KakaoTaxiOrder[], erpBranchNames: string[]): NormalizedTaxiOrder[] {
  const nameSet = new Set(erpBranchNames.map((n) => n.trim()).filter(Boolean));
  // 페이지 조회 도중 같은 건이 두 페이지에 걸쳐 중복 응답될 수 있다 — id 기준으로 걸러
  // 이중 집계를 막는다. 걸러서 건수가 줄면 카카오 보고 count 와 어긋나 화면 경고가 뜬다(의도).
  const seen = new Set<string>();
  const deduped = (orders || []).filter((order) => {
    const id = String(order.id || "");
    if (!id) return true; // id 없는 건은 진위를 판단할 수 없으니 버리지 않는다
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return deduped.map((order) => {
    const { branchName, unmapped } = resolveBranchName(order, nameSet);
    const timeText = order.departure_time || order.call_time || "";
    const hourMatch = /\b(\d{2}):\d{2}/.exec(timeText);
    return {
      order,
      branchName,
      unmapped,
      amount: (Number(order.service_fare) || 0) + (Number(order.toll) || 0),
      timeText,
      hour: hourMatch ? Number(hourMatch[1]) : null,
      memberKey: `${(order.member_name || "").trim()}|${(order.member_identifier || "").trim()}`,
    };
  });
}

export interface BranchTotal { branchName: string; count: number; amount: number; unmapped: boolean }
export interface MemberTotal { memberKey: string; name: string; branchName: string; count: number; amount: number }

export function aggregateByBranch(rows: NormalizedTaxiOrder[]): BranchTotal[] {
  const map = new Map<string, BranchTotal>();
  for (const row of rows) {
    const entry = map.get(row.branchName) || { branchName: row.branchName, count: 0, amount: 0, unmapped: row.unmapped };
    entry.count += 1;
    entry.amount += row.amount;
    entry.unmapped = entry.unmapped && row.unmapped; // 같은 이름에 매핑/미매핑이 섞이면 매핑된 것으로 취급
    map.set(row.branchName, entry);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export function aggregateByMember(rows: NormalizedTaxiOrder[]): MemberTotal[] {
  const map = new Map<string, MemberTotal>();
  for (const row of rows) {
    const name = (row.order.member_name || "").trim() || "(이름 없음)";
    const entry = map.get(row.memberKey) || { memberKey: row.memberKey, name, branchName: row.branchName, count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += row.amount;
    map.set(row.memberKey, entry);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

/** 직원별 합계를 Map<memberKey, amount> 로 — 이상 점검(전월 대비 급증)에서 쓴다 */
export function memberAmountMap(rows: NormalizedTaxiOrder[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.memberKey, (map.get(row.memberKey) || 0) + row.amount);
  return map;
}

/** 집계 대사식 — 지점별 합계의 총합이 건별 총합과 일치해야 한다. 불일치면 화면이 경고 배너를 띄운다. */
export function verifyBranchTotals(rows: NormalizedTaxiOrder[], branchTotals: BranchTotal[]): boolean {
  const rowSum = rows.reduce((acc, r) => acc + r.amount, 0);
  const branchSum = branchTotals.reduce((acc, b) => acc + b.amount, 0);
  return rowSum === branchSum && rows.length === branchTotals.reduce((acc, b) => acc + b.count, 0);
}

const VERTICAL_LABEL: Record<string, string> = { taxi: "택시", quick: "퀵", venti: "벤티", black: "블랙" };
export function verticalLabel(code: string): string {
  return VERTICAL_LABEL[code] || code || "택시";
}

export function buildOrdersExcelRows(rows: NormalizedTaxiOrder[]) {
  return rows.map(({ order, branchName, unmapped, amount, timeText }) => ({
    "이용일시": timeText,
    "직원": order.member_name,
    "사번": order.member_identifier,
    "지점": branchName + (unmapped ? " (미매핑)" : ""),
    "카카오 그룹": order.group_name,
    "출발지": order.departure_point,
    "도착지": order.arrival_point,
    "요금": Number(order.service_fare) || 0,
    "톨비": Number(order.toll) || 0,
    "합계": amount,
    "차종": order.vertical_product_name || order.taxi_kind,
    "차량번호": order.car_number,
    "택시회사": order.taxi_company_name,
    "구분": verticalLabel(order.vertical_code),
  }));
}
