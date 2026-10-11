/**
 * 관리자 > 일일업무 > 이상점검(일일마감 근무 ↔ 법인택시 이용) — 순수 로직 검증(네트워크 호출 없음).
 *   npx tsx scripts/verify-taxi-work-check.mts
 * 실패 시 비정상 종료한다. 배포 전 필수.
 */
// 반드시 첫 import — src/demo.ts 의 __IS_DEMO__ 는 Vite 빌드 때만 치환된다.
import "./vite-define-shim.mts";
import { normalizeKakaoTaxiOrders } from "../src/pages/admin/helpers/kakaoTaxi";
import {
  checkTaxiAgainstWork, buildShifts, groupWorkCheckByReason, absoluteMinutes, type SettleDay, type WorkCheckResult,
} from "../src/pages/admin/helpers/taxiWorkCheck";
import type { KakaoTaxiOrder } from "../src/api/gasClient";

let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { console.log(`  OK   ${name}`); return; }
  failed += 1;
  console.error(`  FAIL ${name}${detail ? " — " + detail : ""}`);
}

const BRANCHES = ["남산광어", "카라멘야", "본사"];
let seq = 0;
function ride(name: string, branch: string, time: string, extra: Partial<KakaoTaxiOrder> = {}): KakaoTaxiOrder {
  seq += 1;
  return {
    id: `R${seq}`, service_fare: 10000, toll: 0,
    call_time: time, departure_time: time,
    departure_point: "", arrival_point: "",
    member_id: `M-${name}`, member_name: name, member_identifier: name, member_department: branch,
    group_name: "", car_number: "", taxi_company_name: "", taxi_kind: "",
    vertical_code: "taxi", vertical_product_name: "", use_code: "", account_key: "acct1",
    ...extra,
  } as KakaoTaxiOrder;
}
const staff = (name: string, clockIn: string, clockOut: string, extra: Record<string, unknown> = {}) =>
  ({ name, clockIn, clockOut, workHours: 9, officeWorkType: "근무", ...extra });

function run(orders: KakaoTaxiOrder[], settles: SettleDay[], failedBranches?: Set<string>): WorkCheckResult[] {
  return checkTaxiAgainstWork({ rows: normalizeKakaoTaxiOrders(orders, BRANCHES), settles, failedBranches });
}
const reasonsOf = (r: WorkCheckResult | undefined) => (r?.reasons || []).join(",");

console.log("[1] 시각 계산 — 자정 넘는 퇴근은 다음 날");
{
  const [s] = buildShifts([{ branchName: "남산광어", settleDate: "2026-10-10", staffRows: [staff("김가", "11:00", "01:00")] }]);
  check("퇴근 01:00 은 다음 날 01:00", s.end - s.start === 14 * 60, String(s.end - s.start));
  check("절대 분 파싱", absoluteMinutes("2026-10-11 00:30:00") === s.end - 30);
}

console.log("[2] 예시 — 마감 01:00 인데 택시 00:30 → 퇴근 전 탑승(전날 근무로 귀속)");
{
  const [r] = run([ride("김가", "남산광어", "2026-10-11 00:30:00")],
    [{ branchName: "남산광어", settleDate: "2026-10-10", staffRows: [staff("김가", "11:00", "01:00")] }]);
  check("사유 = 퇴근 전 탑승", reasonsOf(r) === "beforeClockOut", reasonsOf(r));
  check("근무일 = 전날", r.workDate === "2026-10-10", r.workDate);
  check("설명에 30분", (r.notes.beforeClockOut || "").includes("30분"), r.notes.beforeClockOut);
}

console.log("[3] 정상 — 퇴근 직후·여유 10분 이내는 표식 없음");
{
  const settles: SettleDay[] = [{ branchName: "남산광어", settleDate: "2026-10-10", staffRows: [staff("김가", "11:00", "22:00")] }];
  check("퇴근 후 탑승", reasonsOf(run([ride("김가", "남산광어", "2026-10-10 22:15:00")], settles)[0]) === "");
  check("퇴근 5분 전(여유 안)", reasonsOf(run([ride("김가", "남산광어", "2026-10-10 21:55:00")], settles)[0]) === "");
  check("퇴근 11분 전은 표식", reasonsOf(run([ride("김가", "남산광어", "2026-10-10 21:49:00")], settles)[0]) === "beforeClockOut");
}

console.log("[4] 출근길 — 출근 전이나 출근 30분 안");
{
  const settles: SettleDay[] = [{ branchName: "남산광어", settleDate: "2026-10-10", staffRows: [staff("김가", "11:00", "22:00")] }];
  check("출근 30분 전", reasonsOf(run([ride("김가", "남산광어", "2026-10-10 10:30:00")], settles)[0]) === "commute");
  check("출근 20분 후", reasonsOf(run([ride("김가", "남산광어", "2026-10-10 11:20:00")], settles)[0]) === "commute");
  check("출근 40분 후는 퇴근 전 탑승", reasonsOf(run([ride("김가", "남산광어", "2026-10-10 11:40:00")], settles)[0]) === "beforeClockOut");
}

console.log("[5] 오전 택시는 전날 늦은 근무가 아니라 당일 근무로 귀속");
{
  const [r] = run([ride("김가", "남산광어", "2026-10-11 10:30:00")], [
    { branchName: "남산광어", settleDate: "2026-10-10", staffRows: [staff("김가", "11:00", "01:00")] },
    { branchName: "남산광어", settleDate: "2026-10-11", staffRows: [staff("김가", "11:00", "22:00")] },
  ]);
  check("근무일 = 당일", r.workDate === "2026-10-11", r.workDate);
  check("출근길", reasonsOf(r) === "commute", reasonsOf(r));
}

console.log("[6] 근무 기록 없는 날 — 휴무 / 명단엔 있으나 그날 없음");
{
  const settles: SettleDay[] = [
    { branchName: "남산광어", settleDate: "2026-10-09", staffRows: [staff("김가", "11:00", "22:00")] },
    { branchName: "남산광어", settleDate: "2026-10-10", staffRows: [staff("김가", "", "", { workHours: 0, officeWorkType: "휴무" })] },
    { branchName: "남산광어", settleDate: "2026-10-12", staffRows: [staff("이나", "11:00", "22:00")] },
  ];
  const [off] = run([ride("김가", "남산광어", "2026-10-10 15:00:00")], settles);
  check("휴무일 이용", reasonsOf(off) === "noWork" && (off.notes.noWork || "").includes("휴무"), `${reasonsOf(off)} ${off.notes.noWork}`);
  const [absent] = run([ride("김가", "남산광어", "2026-10-12 15:00:00")], settles);
  check("그날 명단에 없음", reasonsOf(absent) === "noWork", reasonsOf(absent));
}

console.log("[7] 확인 불가 — 마감 미제출 / 이름 불일치 / 지점 조회 실패 / 지점 미매핑");
{
  const settles: SettleDay[] = [{ branchName: "남산광어", settleDate: "2026-10-10", staffRows: [staff("김가", "11:00", "22:00")] }];
  const [noSettle] = run([ride("김가", "남산광어", "2026-10-15 15:00:00")], settles);
  check("마감 미제출", reasonsOf(noSettle) === "unverifiable" && (noSettle.notes.unverifiable || "").includes("미제출"), noSettle.notes.unverifiable);
  const [typo] = run([ride("김가2", "남산광어", "2026-10-10 15:00:00")], settles);
  check("이름 불일치", reasonsOf(typo) === "unverifiable" && (typo.notes.unverifiable || "").includes("이름"), typo.notes.unverifiable);
  const [failedRead] = run([ride("이나", "남산광어", "2026-10-10 15:00:00")], settles, new Set(["남산광어"]));
  check("마감 조회 실패 지점은 '근무 없음'으로 몰지 않음", reasonsOf(failedRead) === "unverifiable", reasonsOf(failedRead));
  const [unmapped] = run([ride("이나", "엉뚱한부서", "2026-10-10 15:00:00")], settles);
  check("지점 미매핑", reasonsOf(unmapped) === "unverifiable", reasonsOf(unmapped));
  const [oldDoc] = run([ride("김가", "카라멘야", "2026-10-10 15:00:00")],
    [...settles, { branchName: "카라멘야", settleDate: "2026-10-10", staffRows: null }]);
  // 김가는 남산광어 근무 15:00 구간 안이라 그쪽으로 짝지어진다 — 다른 지점 지원 근무 탐색.
  check("다른 지점 마감에서 같은 이름 근무를 찾음", oldDoc.shift?.branchName === "남산광어", oldDoc.shift?.branchName);
  const [oldOnly] = run([ride("박다", "카라멘야", "2026-10-10 15:00:00")],
    [{ branchName: "카라멘야", settleDate: "2026-10-10", staffRows: null }]);
  check("근무 상세 없는 구형 마감은 확인 불가", reasonsOf(oldOnly) === "unverifiable" && (oldOnly.notes.unverifiable || "").includes("구형"), oldOnly.notes.unverifiable);
}

console.log("[8] 새벽 건은 근무를 못 찾으면 전날 마감을 본다");
{
  const [r] = run([ride("김가", "남산광어", "2026-10-11 03:00:00")],
    [{ branchName: "남산광어", settleDate: "2026-10-10", staffRows: [staff("이나", "11:00", "22:00"), staff("김가", "", "", { workHours: 0, officeWorkType: "휴무" })] }]);
  check("전날(10-10) 휴무로 판정", reasonsOf(r) === "noWork" && r.workDate === "2026-10-10", `${reasonsOf(r)} ${r.workDate}`);
}

console.log("[9] 하루 2회 이상 — 같은 근무일 기준, 다른 사유와 겹침");
{
  const settles: SettleDay[] = [{ branchName: "남산광어", settleDate: "2026-10-10", staffRows: [staff("김가", "11:00", "01:00")] }];
  const results = run([
    ride("김가", "남산광어", "2026-10-10 10:40:00"),
    ride("김가", "남산광어", "2026-10-11 01:10:00"),
  ], settles);
  check("두 건 모두 multiple", results.every((r) => r.reasons.includes("multiple")), results.map(reasonsOf).join(" | "));
  check("첫 건은 출근길도", results[0].reasons.includes("commute"));
  const groups = groupWorkCheckByReason(results);
  check("카드 분배: multiple 2건·commute 1건", groups.multiple.length === 2 && groups.commute.length === 1);
}

console.log("[10] 근무 분할(같은 날 두 줄)은 가장 이른 출근~가장 늦은 퇴근으로 합친다");
{
  const [r] = run([ride("김가", "남산광어", "2026-10-10 16:00:00")],
    [{ branchName: "남산광어", settleDate: "2026-10-10", staffRows: [staff("김가", "10:00", "15:00"), staff("김가", "17:00", "22:00")] }]);
  check("쉬는 시간 택시도 퇴근 전 탑승", reasonsOf(r) === "beforeClockOut", reasonsOf(r));
}

console.log("[11] 없는 날짜(2026-02-31)는 정상 날짜로 넘기지 않는다");
{
  check("dayIndex 거부", absoluteMinutes("2026-02-31 10:00:00") === null);
  const [r] = run([ride("김가", "남산광어", "2026-02-31 10:00:00")],
    [{ branchName: "남산광어", settleDate: "2026-03-03", staffRows: [staff("김가", "11:00", "22:00")] }]);
  check("확인 불가", reasonsOf(r) === "unverifiable", reasonsOf(r));
}

console.log("[12] 동명이인 — 누구 근무인지 모르면 짐작하지 않고 확인 불가");
{
  const sameBranch = run([ride("김가", "남산광어", "2026-10-10 15:00:00")],
    [{ branchName: "남산광어", settleDate: "2026-10-10", staffRows: [
      staff("김가", "11:00", "22:00", { residentNumber: "900101-1" }),
      staff("김가", "09:00", "16:00", { residentNumber: "950505-2" }),
    ] }])[0];
  check("같은 지점 동명이인(주민번호 다름)", reasonsOf(sameBranch) === "unverifiable" && (sameBranch.notes.unverifiable || "").includes("여러 명"), sameBranch.notes.unverifiable);
  const split = run([ride("김가", "남산광어", "2026-10-10 16:00:00")],
    [{ branchName: "남산광어", settleDate: "2026-10-10", staffRows: [
      staff("김가", "10:00", "15:00", { residentNumber: "900101-1" }),
      staff("김가", "17:00", "22:00", { residentNumber: "900101-1" }),
    ] }])[0];
  check("같은 사람 근무 분할은 그대로 합침", reasonsOf(split) === "beforeClockOut", reasonsOf(split));
  const crossBranch = run([ride("김가", "본사", "2026-10-10 15:00:00")], [
    { branchName: "본사", settleDate: "2026-10-10", staffRows: [staff("이나", "09:00", "18:00")] },
    { branchName: "남산광어", settleDate: "2026-10-10", staffRows: [staff("김가", "11:00", "22:00")] },
    { branchName: "카라멘야", settleDate: "2026-10-10", staffRows: [staff("김가", "11:00", "22:00")] },
  ])[0];
  check("다른 지점 후보가 여러 곳", reasonsOf(crossBranch) === "unverifiable", reasonsOf(crossBranch));
  const ownFirst = run([ride("김가", "남산광어", "2026-10-10 15:00:00")], [
    { branchName: "남산광어", settleDate: "2026-10-10", staffRows: [staff("김가", "11:00", "22:00")] },
    { branchName: "카라멘야", settleDate: "2026-10-10", staffRows: [staff("김가", "09:00", "14:00")] },
  ])[0];
  check("택시 지점 근무가 있으면 그쪽 우선", ownFirst.shift?.branchName === "남산광어", ownFirst.shift?.branchName);
}

console.log("[13] 택시 지점 마감을 못 읽었으면 다른 지점의 같은 이름 근무와 짝짓지 않는다");
{
  const [r] = run([ride("김가", "남산광어", "2026-10-10 15:00:00")],
    [{ branchName: "카라멘야", settleDate: "2026-10-10", staffRows: [staff("김가", "11:00", "22:00")] }],
    new Set(["남산광어"]));
  check("확인 불가(조회 실패)", reasonsOf(r) === "unverifiable" && r.shift === null && (r.notes.unverifiable || "").includes("불러오지"), `${reasonsOf(r)} ${r.notes.unverifiable}`);
  // 지점 변경 이력 등으로 조회 대상 밖 지점(여기선 '본사')이 된 건 — 다른 지점 동명 근무와 짝짓지 않는다.
  const [outside] = checkTaxiAgainstWork({
    rows: normalizeKakaoTaxiOrders([ride("김가", "본사", "2026-10-10 15:00:00")], BRANCHES),
    settles: [{ branchName: "카라멘야", settleDate: "2026-10-10", staffRows: [staff("김가", "11:00", "22:00")] }],
    loadedBranches: new Set(["카라멘야", "남산광어"]),
  });
  check("조회 대상 밖 지점은 확인 불가", reasonsOf(outside) === "unverifiable" && outside.shift === null, `${reasonsOf(outside)} ${outside.notes.unverifiable}`);
  const [unmappedFirst] = run([ride("김가", "엉뚱한부서", "2026-10-10 15:00:00")],
    [{ branchName: "카라멘야", settleDate: "2026-10-10", staffRows: [staff("김가", "11:00", "22:00")] }]);
  check("미매핑은 다른 지점 동명 근무와 짝짓지 않음", reasonsOf(unmappedFirst) === "unverifiable" && unmappedFirst.shift === null, reasonsOf(unmappedFirst));
}

console.log("[14] 퇴근 전 탑승 — 사카바단단·8번대물집 택시는 제외(다른 판정은 유지)");
{
  const EX = ["사카바단단", "8번대물집"];
  for (const branch of EX) {
    const results = checkTaxiAgainstWork({
      rows: normalizeKakaoTaxiOrders([
        ride("최라", branch, "2026-10-10 21:00:00"),
        ride("최라", branch, "2026-10-10 23:30:00"),
      ], [...BRANCHES, ...EX]),
      settles: [{ branchName: branch, settleDate: "2026-10-10", staffRows: [staff("최라", "11:00", "01:00")] }],
    });
    check(`${branch}: 퇴근 전 탑승 아님`, results.every((r) => !r.reasons.includes("beforeClockOut")), results.map(reasonsOf).join(" | "));
    check(`${branch}: 하루 2회 이상은 유지`, results.every((r) => r.reasons.includes("multiple")), results.map(reasonsOf).join(" | "));
  }
  const [other] = run([ride("최라", "남산광어", "2026-10-10 21:00:00")],
    [{ branchName: "남산광어", settleDate: "2026-10-10", staffRows: [staff("최라", "11:00", "01:00")] }]);
  check("다른 지점은 그대로 퇴근 전 탑승", reasonsOf(other) === "beforeClockOut", reasonsOf(other));
}

console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
process.exit(failed ? 1 : 0);
