/**
 * 카카오T 2계정 지원 — 순수 로직 검증(읽기 전용, 네트워크 호출 없음).
 *   npx tsx scripts/verify-kakao-multiaccount.mts
 * 실패 시 비정상 종료한다. 배포 전 필수.
 */
import {
  normalizeKakaoTaxiOrders,
  aggregateByBranch,
  buildOrdersExcelRows,
  memberAmountMap,
  accountLabel,
  shortTimeText,
  verticalLabel,
  KAKAO_ACCOUNT_BY_BRANCH,
  kakaoTaxiAccountForBranch,
  type NormalizedTaxiOrder,
} from "../src/pages/admin/helpers/kakaoTaxi";
import {
  flagTaxiOrders, isAnomalyExempt, detectMemberSurges, excludeLogisticsOrders, DEFAULT_TAXI_THRESHOLDS,
} from "../src/pages/admin/helpers/kakaoTaxiAnomaly";
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
    use_code: "", // 이용사유(자유 입력) — 실데이터는 대부분 빈 문자열이다
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
  // [시각 배치 주의] 이 픽스처는 "한 건에 사유가 하나씩만 붙는" 상태를 전제로 대표 사유·정렬을 본다.
  // 낮 시간대 창이 08~23시로 넓어졌으므로(2026-07-29), 고액 전용(n1·n2)·미매핑 전용(n5·n6) 건은
  // 반드시 창 밖(23시~07시대) 시각이어야 daytime 사유가 덧붙지 않는다.
  const rows = normalizeKakaoTaxiOrders([
    order({ id: "n1", member_department: "사카바단단", service_fare: 31000, departure_time: "2026-07-01 23:30:00" }),
    order({ id: "n2", member_department: "사카바단단", service_fare: 99000, departure_time: "2026-07-20 23:00:00" }),
    order({ id: "n3", member_department: "사카바단단", service_fare: 1000, departure_time: "2026-07-05 09:00:00" }),
    order({ id: "n4", member_department: "사카바단단", service_fare: 2000, departure_time: "2026-07-25 10:00:00" }),
    order({ id: "n5", member_department: "", group_name: "기본그룹", member_id: "NOMAP1", service_fare: 500, departure_time: "2026-07-03 23:30:00" }),
    order({ id: "n6", member_department: "", group_name: "기본그룹", member_id: "NOMAP2", service_fare: 500, departure_time: "2026-07-27 23:30:00" }),
  ], ERP_BRANCHES);
  const flagged = flagTaxiOrders(rows, DEFAULT_TAXI_THRESHOLDS);
  const seq = flagged.map((f) => f.row.order.id).join(",");
  // 고액(n2 07-20 → n1 07-01) → 낮 시간대(n4 07-25 → n3 07-05) → 미매핑(n6 07-27 → n5 07-03)
  check("사유 묶음 + 묶음별 최신순", seq === "n2,n1,n4,n3,n6,n5", seq);
  const firstReasons = flagged.map((f) => f.reasons[0]).join(",");
  check("대표 사유가 묶음 순서대로", firstReasons === "highFare,highFare,daytime,daytime,unmapped,unmapped", firstReasons);
  check("건이 사유마다 복제되지 않는다", flagged.length === 6, String(flagged.length));
}

console.log("[10] 퀵·택배(logistics)는 건 단위 규칙 전부에서 빠지고, 대리(driver)는 그대로 표식된다");
{
  // 같은 조건(고액 + 낮 시간대 + 미매핑)을 세 건에 똑같이 준다 — 차이는 vertical_code 뿐이다.
  const rows = normalizeKakaoTaxiOrders([
    order({ id: "L1", vertical_code: "logistics", vertical_product_name: "퀵", member_id: "NOMAPQ",
      member_department: "", group_name: "기본그룹", service_fare: 50000, departure_time: "2026-07-10 11:00:00" }),
    order({ id: "D1", vertical_code: "driver", member_id: "NOMAPD",
      member_department: "", group_name: "기본그룹", service_fare: 50000, departure_time: "2026-07-10 11:00:00" }),
    order({ id: "T1", vertical_code: "taxi", member_id: "NOMAPT",
      member_department: "", group_name: "기본그룹", service_fare: 50000, departure_time: "2026-07-10 11:00:00" }),
  ], ERP_BRANCHES);
  const flagged = flagTaxiOrders(rows, DEFAULT_TAXI_THRESHOLDS);
  const ids = flagged.map((f) => f.row.order.id);
  check("logistics 는 고액·낮 시간대·미매핑 어디에도 안 잡힌다", !ids.includes("L1"), ids.join(","));
  check("driver 는 그대로 잡힌다", ids.includes("D1"), ids.join(","));
  check("택시 대조군도 잡힌다", ids.includes("T1"), ids.join(","));
  const driverReasons = flagged.find((f) => f.row.order.id === "D1")?.reasons.join(",") || "";
  check("driver 는 세 규칙 모두 적용", driverReasons === "highFare,daytime,unmapped", driverReasons);
  // 이상 점검에서만 뺄 뿐, 지점 집계에서는 빠지지 않는다(집계 불변 원칙).
  const totals = aggregateByBranch(rows);
  check("logistics 도 지점 집계에는 남는다", totals.reduce((a, b) => a + b.count, 0) === 3);
}

console.log("[11] 급증(R2) 합산에서 퀵·택배가 당월·전월 양쪽에서 빠진다");
{
  const curr = normalizeKakaoTaxiOrders([
    // 퀵 20만 + 택시 1만 — 퀵을 합산하면 신규 급증(+50,000원 이상)으로 오탐된다.
    order({ id: "s1", member_name: "퀵많은사람", member_identifier: "퀵많은사람", member_department: "사카바단단",
      vertical_code: "logistics", vertical_product_name: "퀵", service_fare: 200000, departure_time: "2026-07-02 11:00:00" }),
    order({ id: "s2", member_name: "퀵많은사람", member_identifier: "퀵많은사람", member_department: "사카바단단",
      service_fare: 10000, departure_time: "2026-07-03 11:00:00" }),
    // 대조군 — 택시만으로 증가액 기준을 넘겨 여전히 급증으로 잡혀야 한다.
    order({ id: "s3", member_name: "택시많은사람", member_identifier: "택시많은사람", member_department: "사카바단단",
      service_fare: 100000, departure_time: "2026-07-04 11:00:00" }),
  ], ERP_BRANCHES);
  const surges = detectMemberSurges(curr, new Map(), DEFAULT_TAXI_THRESHOLDS);
  const names = surges.map((s) => s.name).join(",");
  check("퀵 비용은 급증 합산에 안 들어간다", !names.includes("퀵많은사람"), names);
  check("택시 급증은 그대로 잡힌다", names.includes("택시많은사람"), names);

  // 전월 쪽도 같은 기준이어야 한다 — 전월에 퀵이 섞여 있으면 비교 기준이 부풀어 진짜 급증을 놓친다(미탐).
  const prev = normalizeKakaoTaxiOrders([
    order({ id: "p1", member_name: "작년퀵", member_identifier: "작년퀵", member_department: "사카바단단",
      vertical_code: "logistics", service_fare: 300000, departure_time: "2026-06-02 11:00:00" }),
    order({ id: "p2", member_name: "작년퀵", member_identifier: "작년퀵", member_department: "사카바단단",
      service_fare: 10000, departure_time: "2026-06-03 11:00:00" }),
  ], ERP_BRANCHES);
  const currForPrev = normalizeKakaoTaxiOrders([
    order({ id: "p3", member_name: "작년퀵", member_identifier: "작년퀵", member_department: "사카바단단",
      service_fare: 100000, departure_time: "2026-07-03 11:00:00" }),
  ], ERP_BRANCHES);
  const rawPrevSurges = detectMemberSurges(currForPrev, memberAmountMap(prev), DEFAULT_TAXI_THRESHOLDS);
  check("전월에 퀵이 섞이면 급증을 놓친다(필터가 필요한 이유)", rawPrevSurges.length === 0, String(rawPrevSurges.length));
  const filteredPrevSurges = detectMemberSurges(currForPrev, memberAmountMap(excludeLogisticsOrders(prev)), DEFAULT_TAXI_THRESHOLDS);
  check("전월도 퀵을 빼면 급증으로 잡힌다", filteredPrevSurges.length === 1 && filteredPrevSurges[0].increase === 90000,
    JSON.stringify(filteredPrevSurges));
  check("excludeLogisticsOrders 는 원본을 변형하지 않는다", prev.length === 2);
}

console.log("[12] 낮 시간대 경계 — 08:00 포함 / 07:59 제외 / 22:59 포함 / 23:00 제외");
{
  const at = (time: string) => normalizeKakaoTaxiOrders([
    order({ id: time, member_department: "사카바단단", service_fare: 1000, departure_time: `2026-07-10 ${time}:00` }),
  ], ERP_BRANCHES);
  const isDaytime = (time: string) => {
    const flagged = flagTaxiOrders(at(time), DEFAULT_TAXI_THRESHOLDS);
    return flagged.length === 1 && flagged[0].reasons.includes("daytime");
  };
  check("08:00 은 낮 시간대", isDaytime("08:00"));
  check("07:59 는 아니다", !isDaytime("07:59"));
  check("22:59 는 낮 시간대", isDaytime("22:59"));
  check("23:00 은 아니다", !isDaytime("23:00"));
  check("기본 임계값이 08~23시", DEFAULT_TAXI_THRESHOLDS.dayStartHour === 8 && DEFAULT_TAXI_THRESHOLDS.dayEndHour === 23);
}

console.log("[13] 이용사유(use_code)·구분 라벨·일시 축약");
{
  check("logistics 라벨", verticalLabel("logistics") === "퀵·택배");
  check("driver 라벨", verticalLabel("driver") === "대리");
  check("모르는 코드는 원문", verticalLabel("newthing") === "newthing");
  check("일시 축약", shortTimeText("2026-07-10 08:05:00") === "07-10 08:05");
  check("형식이 다르면 원문 유지", shortTimeText("2026/07/10") === "2026/07/10");
  check("빈 값도 안전", shortTimeText("") === "");

  const rows = normalizeKakaoTaxiOrders([
    order({ id: "u1", member_department: "사카바단단", use_code: "거래처 미팅" }),
    // 옛 캐시·미배포 GAS 응답에는 use_code 필드 자체가 없다 — undefined 가 그대로 새면 안 된다.
    order({ id: "u2", member_department: "사카바단단", use_code: undefined as unknown as string }),
  ], ERP_BRANCHES);
  const excel = buildOrdersExcelRows(rows);
  check("엑셀에 이용사유 컬럼", excel[0]["이용사유"] === "거래처 미팅", String(excel[0]["이용사유"]));
  check("결측은 빈 문자열", excel[1]["이용사유"] === "", JSON.stringify(excel[1]["이용사유"]));
  check("엑셀 이용일시는 축약하지 않는다", excel[0]["이용일시"] === "2026-07-01 12:00:00", excel[0]["이용일시"]);
}

if (failed) { console.error(`\n실패 ${failed}건`); process.exit(1); }
console.log("\n전부 통과");
