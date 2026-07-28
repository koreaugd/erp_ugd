/**
 * 카카오T 2계정 지원 — 순수 로직 검증(읽기 전용, 네트워크 호출 없음).
 *   npx tsx scripts/verify-kakao-multiaccount.mts
 * 실패 시 비정상 종료한다. 배포 전 필수.
 */
import {
  normalizeKakaoTaxiOrders,
  aggregateByBranch,
  memberAmountMap,
  accountLabel,
  KAKAO_ACCOUNT_BY_BRANCH,
  kakaoTaxiAccountForBranch,
  type NormalizedTaxiOrder,
} from "../src/pages/admin/helpers/kakaoTaxi";
import { flagTaxiOrders, isAnomalyExempt, DEFAULT_TAXI_THRESHOLDS } from "../src/pages/admin/helpers/kakaoTaxiAnomaly";
import type { KakaoTaxiOrder } from "../src/api/gasClient";

let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { console.log(`  OK   ${name}`); return; }
  failed += 1;
  console.error(`  FAIL ${name}${detail ? " — " + detail : ""}`);
}

function order(o: Partial<KakaoTaxiOrder>): KakaoTaxiOrder {
  return {
    id: "x", service_fare: 0, toll: 0,
    call_time: "2026-07-01 12:00:00", departure_time: "2026-07-01 12:00:00",
    departure_point: "", arrival_point: "",
    member_id: "M1", member_name: "홍길동", member_identifier: "홍길동", member_department: "",
    group_name: "", car_number: "", taxi_company_name: "",
    taxi_kind: "", vertical_code: "taxi", vertical_product_name: "",
    account_key: "acct1",
    ...o,
  } as KakaoTaxiOrder;
}

const ERP_BRANCHES = ["사카바단단", "8번대물집", "대물섬 한남점"];

console.log("[1] 계정별 동명이인이 합산되지 않는다");
{
  const rows = normalizeKakaoTaxiOrders([
    order({ id: "a", account_key: "acct1", member_name: "정윤기", member_identifier: "정윤기", member_department: "대물섬 한남점", service_fare: 10000 }),
    order({ id: "b", account_key: "acct2", member_name: "정윤기", member_identifier: "정윤기", member_department: "8번대물집", service_fare: 20000 }),
  ], ERP_BRANCHES);
  const keys = new Set(rows.map((r) => r.memberKey));
  check("동명이인 memberKey 2개", keys.size === 2, [...keys].join(" / "));
  const amounts = memberAmountMap(rows);
  check("각각 따로 집계", amounts.size === 2 && [...amounts.values()].every((v) => v === 10000 || v === 20000));
}

console.log("[2] 퇴사자 보정표가 삭제된 회원의 과거 건을 지점에 귀속시킨다");
{
  const rows = normalizeKakaoTaxiOrders([
    order({ id: "c", account_key: "acct2", member_id: "ZB2L167I", member_name: "김태호", member_identifier: "김태호", member_department: "", service_fare: 9070 }),
  ], ERP_BRANCHES);
  check("보정으로 사카바단단 귀속", rows[0].branchName === "사카바단단", rows[0].branchName);
  check("보정된 건은 미매핑 아님", rows[0].unmapped === false);
}

console.log("[3] 보정표에 없는 빈 부서는 그대로 미매핑");
{
  const rows = normalizeKakaoTaxiOrders([
    order({ id: "d", account_key: "acct2", member_id: "UNKNOWN1", member_department: "", group_name: "기본그룹" }),
  ], ERP_BRANCHES);
  check("미매핑 유지", rows[0].unmapped === true);
  check("표시는 그룹 원문", rows[0].branchName === "기본그룹", rows[0].branchName);
}

console.log("[4] 집계 대사 — 지점별 합계 총합 == 건별 총합");
{
  const rows = normalizeKakaoTaxiOrders([
    order({ id: "e", account_key: "acct2", member_department: "사카바단단", service_fare: 5000, toll: 500 }),
    order({ id: "f", account_key: "acct1", member_department: "대물섬 한남점", service_fare: 3000 }),
  ], ERP_BRANCHES);
  const totals = aggregateByBranch(rows);
  const sum = totals.reduce((a, b) => a + b.amount, 0);
  check("합계 일치", sum === 8500, String(sum));
}

console.log("[5] 계정 라벨");
check("acct1 라벨", accountLabel("acct1") === "1계정");
check("acct2 라벨", accountLabel("acct2") === "2계정");
check("미등록 키는 원문", accountLabel("acct9") === "acct9");

console.log("[6] 이상 점검 면제는 계정+id 쌍으로만 적용된다");
{
  check("계정1 서광엽 면제", isAnomalyExempt("acct1", "JE1T6UC2") === true);
  check("계정2의 같은 id 는 면제 아님", isAnomalyExempt("acct2", "JE1T6UC2") === false);
  const rows = normalizeKakaoTaxiOrders([
    order({ id: "g", account_key: "acct1", member_id: "JE1T6UC2", member_department: "본사", service_fare: 90000 }),
    order({ id: "h", account_key: "acct2", member_id: "JE1T6UC2", member_department: "사카바단단", service_fare: 90000 }),
  ], [...ERP_BRANCHES, "본사"]);
  const flagged = flagTaxiOrders(rows, DEFAULT_TAXI_THRESHOLDS);
  check("고액 표식은 계정2 건에만", flagged.length === 1 && flagged[0].row.accountKey === "acct2",
    flagged.map((f) => f.row.accountKey).join(","));
}

console.log("[7] 지점→계정 매핑");
check("사카바단단은 2계정", kakaoTaxiAccountForBranch("사카바단단") === "acct2");
check("8번대물집은 2계정", kakaoTaxiAccountForBranch("8번대물집") === "acct2");
check("그 외 지점은 1계정", kakaoTaxiAccountForBranch("대물섬 한남점") === "acct1");
check("빈 지점명도 1계정", kakaoTaxiAccountForBranch("") === "acct1");
check("매핑표에 acct2 만 기재", Object.values(KAKAO_ACCOUNT_BY_BRANCH).every((v) => v === "acct2"));

console.log("[8] 주문 dedup 은 계정으로 한정된다(F3)");
{
  // 계정이 다르면 카카오가 매긴 id 가 우연히 같을 수 있다 — id 만으로 걸렀다면 아래는 1건으로 뭉개진다.
  const crossAccount = normalizeKakaoTaxiOrders([
    order({ id: "same-id", account_key: "acct1", member_department: "대물섬 한남점", service_fare: 1000 }),
    order({ id: "same-id", account_key: "acct2", member_department: "사카바단단", service_fare: 2000 }),
  ], ERP_BRANCHES);
  check("계정이 다르면 같은 id 라도 둘 다 남는다", crossAccount.length === 2, String(crossAccount.length));

  // 같은 계정 안에서 id 가 같으면 여전히 중복으로 걸러야 한다(기존 동작 유지 확인).
  const sameAccount = normalizeKakaoTaxiOrders([
    order({ id: "dup-id", account_key: "acct1", member_department: "대물섬 한남점", service_fare: 1000 }),
    order({ id: "dup-id", account_key: "acct1", member_department: "대물섬 한남점", service_fare: 1000 }),
  ], ERP_BRANCHES);
  check("같은 계정의 같은 id 는 1건으로 합쳐진다", sameAccount.length === 1, String(sameAccount.length));
}

console.log("[9] 점검 대상은 사유별로 묶이고 묶음 안에서는 최근 이용이 위로 온다");
{
  // 금액을 일부러 뒤섞어 둔다 — 예전 '금액 큰 순' 정렬이 남아 있으면 이 순서가 깨진다.
  const rows = normalizeKakaoTaxiOrders([
    order({ id: "n1", member_department: "사카바단단", service_fare: 31000, departure_time: "2026-07-01 22:00:00" }),
    order({ id: "n2", member_department: "사카바단단", service_fare: 99000, departure_time: "2026-07-20 23:00:00" }),
    order({ id: "n3", member_department: "사카바단단", service_fare: 1000, departure_time: "2026-07-05 09:00:00" }),
    order({ id: "n4", member_department: "사카바단단", service_fare: 2000, departure_time: "2026-07-25 10:00:00" }),
    order({ id: "n5", member_department: "", group_name: "기본그룹", member_id: "NOMAP1", service_fare: 500, departure_time: "2026-07-03 21:00:00" }),
    order({ id: "n6", member_department: "", group_name: "기본그룹", member_id: "NOMAP2", service_fare: 500, departure_time: "2026-07-27 21:00:00" }),
  ], ERP_BRANCHES);
  const flagged = flagTaxiOrders(rows, DEFAULT_TAXI_THRESHOLDS);
  const seq = flagged.map((f) => f.row.order.id).join(",");
  // 고액(n2 07-20 → n1 07-01) → 낮 시간대(n4 07-25 → n3 07-05) → 미매핑(n6 07-27 → n5 07-03)
  check("사유 묶음 + 묶음별 최신순", seq === "n2,n1,n4,n3,n6,n5", seq);
  const firstReasons = flagged.map((f) => f.reasons[0]).join(",");
  check("대표 사유가 묶음 순서대로", firstReasons === "highFare,highFare,daytime,daytime,unmapped,unmapped", firstReasons);
  check("건이 사유마다 복제되지 않는다", flagged.length === 6, String(flagged.length));
}

if (failed) { console.error(`\n실패 ${failed}건`); process.exit(1); }
console.log("\n전부 통과");
