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
/**
 * 카카오에 적힌 부서·그룹이 실제 소속과 달라 바로잡아야 하는 인원. 키는 `${account_key}|${member_id}`.
 *
 * 왜 필요한가 — 카카오는 **주문마다 그때의 부서·그룹을 함께 실어 보낸다.** 그래서 뒤늦게 부서를 고쳐도
 * 이미 지나간 이용내역은 옛 값 그대로다. 과거 건까지 실제 지점으로 읽으려면 이 표가 있어야 한다.
 *
 * 왜 부서·그룹보다 **먼저** 보는가 — 그룹명만으로도 매핑이 성립해 버리기 때문이다.
 * 아래 세 사람은 부서가 '대물섬'(브랜드명)뿐인데 그룹이 한남점으로 잘못 잡혀 있어, 뒤에 두면
 * 그룹명이 먼저 걸려 한남점 이용으로 계속 집계된다(KAKAO_RETIRED_MEMBER_BRANCH 를 맨 뒤에 둔 것과 다른 이유).
 * 다만 관리자가 남긴 지점 변경 이력이 있으면 그쪽이 우선이다 — 이력은 "언제부터 어디"를 담고 있어 더 정확하다.
 */
export const KAKAO_MEMBER_BRANCH_OVERRIDE: Record<string, string> = {
  // 종로점 직원인데 부서가 '대물섬'뿐이고 그룹은 한남점으로 등록돼 있던 세 사람(2026-07-31 사용자 확인).
  // 부서는 그 뒤 '대물섬 종로점'으로 고쳐졌지만, 그 전 이용내역은 옛 값이라 이 표로 바로잡는다.
  "acct1|TCWAY6ZY": "대물섬 종로점", // 김현준
  "acct1|A4L2RTKS": "대물섬 종로점", // 정휘찬
  "acct1|8F3YIU1T": "대물섬 종로점", // 황혁
};

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
  // [소속 교정] 카카오에 적힌 부서·그룹이 실제와 다른 인원은 여기서 바로잡는다.
  // 부서·그룹을 보기 **전에** 확인해야 한다 — 그룹명만으로도 매핑이 성립해 버려서,
  // 뒤에 두면 잘못 등록된 그룹이 먼저 걸려 이 표가 아무 일도 하지 못한다.
  const override = KAKAO_MEMBER_BRANCH_OVERRIDE[`${order.account_key}|${order.member_id}`];
  if (override && erpBranchNames.has(override)) return { branchName: override, unmapped: false };

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

/**
 * 건 하나를 가리키는 안정 키 — `계정|주문id`. 계정이 다르면 카카오가 매긴 주문 id 가 우연히 겹칠 수
 * 있으므로(계정별 채번) 계정까지 묶는다 — normalizeKakaoTaxiOrders 의 중복 제거와 같은 규칙이다.
 *
 * 대시보드의 '새 점검 대상' 판정이 이 키로 확인 여부를 기억한다. 그래서 두 성질이 필요하다.
 *   ① **같은 건이면 조회할 때마다 같은 값**(랜덤·순번·조회시각 금지) — 아니면 확인해 둔 건이 매번 새 건으로 뜬다.
 *   ② **다른 건이면 다른 값** — 겹치면 한쪽을 '이미 확인함'으로 착각해 조용히 숨긴다(Codex 6R).
 *
 * id 가 없는 건(정규화가 버리지 않고 남기는 방어 경로)은 ②를 위해 이용 자체를 특정하는 원본 필드를
 * 최대한 넓게 붙인다. 여기 쓰는 값은 모두 **그 이용에 고정된 값**이어야 한다 —
 * 부서·그룹처럼 나중에 카카오에서 바뀌는 필드를 넣으면 ①이 깨진다(퇴사자 부서 null 사례).
 */
export function taxiOrderKey(row: NormalizedTaxiOrder): string {
  const id = String(row.order.id || "");
  if (id) return `${row.accountKey}|${id}`;
  const o = row.order;
  const parts = [
    row.timeText, o.call_time, String(o.member_id || ""),
    o.departure_point, o.arrival_point, o.car_number, o.taxi_company_name,
    o.vertical_code, String(Number(o.service_fare) || 0), String(Number(o.toll) || 0),
  ].map((v) => String(v || ""));
  // 구분자로 이어 붙이지 않고 JSON 배열로 만든다 — 값 안에 구분자가 들어 있어도 경계가 뭉개지지 않는다.
  // (파이프를 다른 글자로 치환하는 방식은 `A|B` 와 `A/B` 가 같은 키가 돼 ②를 깬다, Codex 7R)
  return `${row.accountKey}|noid|${JSON.stringify(parts)}`;
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

// 카카오 vertical_code → 화면 표기. 없는 코드는 원문을 그대로 노출한다(새 상품이 조용히 '택시'로
// 둔갑하지 않게 — 원문이 보이면 여기에 한 줄 추가하면 된다).
// [2026-07-29] logistics(퀵·택배)·driver(대리)를 추가했다 — 실제로 오는 코드인데 표에 영문 그대로
// 노출되고 있었다(5월 계정1 logistics 20건 실측). logistics 는 이상 점검에서 제외되고
// 이용내역 탭의 '퀵·택배 내역' 섹션에서 따로 본다(kakaoTaxiAnomaly.ts 참고).
const VERTICAL_LABEL: Record<string, string> = {
  taxi: "택시", quick: "퀵", venti: "벤티", black: "블랙",
  logistics: "퀵·택배", driver: "대리",
};
export function verticalLabel(code: string): string {
  return VERTICAL_LABEL[code] || code || "택시";
}

/**
 * 표에 찍을 이용일시 축약 — "YYYY-MM-DD HH:mm:ss" → "MM-DD HH:mm"(2026-07-29, 표 폭 절약).
 * 고정 형식일 때만 자르고 아니면 원문을 그대로 돌려준다(형식이 바뀌면 엉뚱하게 잘리는 것 방지).
 * [표시 전용] 정렬·최근 3일 판정·엑셀은 반드시 원본 timeText 를 쓴다 — 축약본으로 비교하면
 * 연도가 빠져 정렬이 깨진다. 화면은 `title={timeText}` 로 전체 시각을 툴팁으로 남긴다.
 */
export function shortTimeText(timeText: string): string {
  const t = String(timeText || "");
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(t) ? t.slice(5, 16) : t;
}

export function buildOrdersExcelRows(rows: NormalizedTaxiOrder[]) {
  return rows.map(({ order, accountKey, branchName, unmapped, amount, timeText }) => ({
    // 엑셀은 축약하지 않는다 — 원본 전체 시각(연도 포함)이 있어야 정렬·필터가 제대로 된다.
    "이용일시": timeText,
    "계정": accountLabel(accountKey),
    "직원": order.member_name,
    "사번": order.member_identifier,
    "지점": branchName + (unmapped ? " (미매핑)" : ""),
    "카카오 그룹": order.group_name,
    "출발지": order.departure_point,
    "도착지": order.arrival_point,
    // 이용사유 — 카카오T 앱에서 직원이 자유 입력한 텍스트. 옛 캐시·미배포 GAS 에는 필드 자체가
    // 없어 undefined 가 오므로 반드시 `|| ""`(엑셀에 undefined 가 찍히면 안 된다).
    "이용사유": order.use_code || "",
    "요금": Number(order.service_fare) || 0,
    "톨비": Number(order.toll) || 0,
    "합계": amount,
    "차종": order.vertical_product_name || order.taxi_kind,
    "차량번호": order.car_number,
    "택시회사": order.taxi_company_name,
    "구분": verticalLabel(order.vertical_code),
  }));
}
