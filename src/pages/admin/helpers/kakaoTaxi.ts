// src/pages/admin/helpers/kakaoTaxi.ts
// 관리자 > 법인택시 — 카카오T 이용내역의 정규화(지점 매핑)·집계 순수 함수 모음.
// 화면(KakaoTaxiSection.tsx)은 조회·표시만 하고 계산은 전부 여기서 한다.
import type { KakaoTaxiOrder } from "../../../api/gasClient";
import { branchForOrderDate, type BranchHistoryMap } from "./kakaoTaxiBranchHistory";

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

// 카카오T 비즈니스 계정 표시명. 백엔드 KAKAO_TAXI_ACCOUNTS 의 key 와 같게 유지할 것
// ([동기화] gas/Code.gs, server.ts).
export const KAKAO_TAXI_ACCOUNT_LABEL: Record<string, string> = {
  acct1: "1계정",
  acct2: "2계정",
};

export function accountLabel(key: string): string {
  return KAKAO_TAXI_ACCOUNT_LABEL[key] || key || "";
}

// 퇴사자 과거 내역 귀속 보정표 — 키는 `${account_key}|${member_id}`.
// 카카오에서 회원을 삭제하면 그 사람의 과거 주문에서 member_department 가 null 이 된다(실측).
// 이름으로 매칭하면 동명이인을 가를 수 없어(정윤기 사례) 반드시 member_id 로 지정한다.
// 삭제 전에 부서를 채워두면 애초에 필요 없다 — 운영 지침은 "퇴사자 존치"다.
export const KAKAO_RETIRED_MEMBER_BRANCH: Record<string, string> = {
  "acct2|ZB2L167I": "사카바단단", // 김태호, 2026-05 10건 90,700원
};

// 지점 → 카카오T 계정. 미기재 지점은 계정 #1(기본값)이다.
// 계정 #2(기업ID 25648071)는 사카바단단·8번대물집 두 지점 인원만 쓴다(2026-07-28 확인).
// [동기화] gas/Code.gs, server.ts 의 같은 이름 상수와 세 곳을 같게 유지할 것.
// [주의] 계정 #1 에도 '사카바단단'·'8번대물집' 이름의 그룹이 껍데기로 남아 있다 —
// 이 표가 없으면 지점 자동등록이 그 껍데기 그룹을 찾아 엉뚱한 계정에 등록한다.
export const KAKAO_ACCOUNT_BY_BRANCH: Record<string, string> = {
  "사카바단단": "acct2",
  "8번대물집": "acct2",
};

export function kakaoTaxiAccountForBranch(branchName: string): string {
  return KAKAO_ACCOUNT_BY_BRANCH[String(branchName || "").trim()] || "acct1";
}

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
  /** 어느 카카오T 계정 건인지 — 화면 계정 컬럼·필터와 memberKey 구성에 쓴다 */
  accountKey: string;
  /** 직원 구분 키 — 계정이 다르면 동명이인이므로 계정까지 포함한다 */
  memberKey: string;
}

function resolveBranchName(
  order: KakaoTaxiOrder,
  erpBranchNames: Set<string>,
  history?: BranchHistoryMap
): { branchName: string; unmapped: boolean } {
  // [이력 우선] 지점 변경 이력이 있는 직원은 **이용일 기준**으로 판정한다(2026-07-29).
  // 카카오는 조회 시점의 부서를 실어 보내 과거 내역이 현재 지점으로 소급되기 때문 —
  // 변경일 이전 이용은 이전 지점, 이후 이용은 새 지점으로 남긴다. 이력 지점도 별칭 보정을 거친다.
  if (history) {
    const atDate = branchForOrderDate(
      history,
      String(order.account_key || "acct1"),
      String(order.member_id || ""),
      order.departure_time || order.call_time || ""
    );
    if (atDate) {
      // 그 날짜엔 부서가 없었다 — 현재 부서로 폴백하면 부서 없던 시절 이용까지 지금 지점으로
      // 잘못 귀속된다(Codex 지적 2026-07-29). 당시 화면과 같은 '미지정'으로 명시한다.
      if ("unassigned" in atDate) return { branchName: "미지정", unmapped: true };
      const trimmed = atDate.branch.trim();
      if (erpBranchNames.has(trimmed)) return { branchName: trimmed, unmapped: false };
      const alias = KAKAO_BRANCH_ALIASES[trimmed];
      if (alias && erpBranchNames.has(alias)) return { branchName: alias, unmapped: false };
      // 이력 지점이 ERP 목록에 없어도(지점 폐업 등) 버리지 않는다 — 숨기면 금액이 사라진 것처럼 보인다.
      return { branchName: trimmed, unmapped: true };
    }
  }
  const candidates = [order.member_department, order.group_name]
    .map((v) => (v || "").trim())
    .filter(Boolean);
  for (const raw of candidates) {
    if (erpBranchNames.has(raw)) return { branchName: raw, unmapped: false };
    const alias = KAKAO_BRANCH_ALIASES[raw];
    if (alias && erpBranchNames.has(alias)) return { branchName: alias, unmapped: false };
  }
  // 부서·그룹으로 못 찾았다 — 카카오에서 삭제된 퇴사자일 수 있으니 보정표를 마지막으로 본다.
  const retired = KAKAO_RETIRED_MEMBER_BRANCH[`${order.account_key}|${order.member_id}`];
  if (retired && erpBranchNames.has(retired)) return { branchName: retired, unmapped: false };
  // 매핑 실패 — 부서 원문(없으면 그룹 원문)을 그대로 보여준다. 숨기면 금액이 사라진 것처럼 보인다.
  return { branchName: candidates[0] || "미지정", unmapped: true };
}

export function normalizeKakaoTaxiOrders(
  orders: KakaoTaxiOrder[],
  erpBranchNames: string[],
  /** 지점 변경 이력(kakaoTaxiBranchHistory) — 있으면 이용일 기준으로 지점을 판정한다 */
  history?: BranchHistoryMap
): NormalizedTaxiOrder[] {
  const nameSet = new Set(erpBranchNames.map((n) => n.trim()).filter(Boolean));
  // 페이지 조회 도중 같은 건이 두 페이지에 걸쳐 중복 응답될 수 있다 — id 기준으로 걸러
  // 이중 집계를 막는다. 걸러서 건수가 줄면 카카오 보고 count 와 어긋나 화면 경고가 뜬다(의도).
  // [F3] 계정이 서로 다르면 카카오가 매긴 주문 id 가 우연히 같을 수 있다(계정별로 따로 채번) —
  // id 만으로 dedup 하면 서로 다른 계정의 서로 다른 실제 이용 건이 하나로 뭉개진다.
  // "계정|id" 로 묶어야 같은 계정 안에서만 진짜 중복을 걸러낸다(코덱스 리뷰 2026-07-28).
  const seen = new Set<string>();
  const deduped = (orders || []).filter((order) => {
    const id = String(order.id || "");
    if (!id) return true; // id 없는 건은 진위를 판단할 수 없으니 버리지 않는다
    const key = `${String(order.account_key || "acct1")}|${id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.map((order) => {
    const { branchName, unmapped } = resolveBranchName(order, nameSet, history);
    const timeText = order.departure_time || order.call_time || "";
    const hourMatch = /\b(\d{2}):\d{2}/.exec(timeText);
    const accountKey = String(order.account_key || "acct1");
    return {
      order,
      accountKey,
      branchName,
      unmapped,
      amount: (Number(order.service_fare) || 0) + (Number(order.toll) || 0),
      timeText,
      hour: hourMatch ? Number(hourMatch[1]) : null,
      memberKey: `${accountKey}|${(order.member_name || "").trim()}|${(order.member_identifier || "").trim()}`,
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
  return rows.map(({ order, accountKey, branchName, unmapped, amount, timeText }) => ({
    "이용일시": timeText,
    "계정": accountLabel(accountKey),
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
