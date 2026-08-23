/**
 * 시연용 가상 데이터 생성기.
 *
 *   node scripts/demo/generate_fake_data.mjs [--out <폴더>]
 *
 * 산출: <폴더>/*.json — 컬렉션명.json = [{ id, data }] 배열 + _auth_accounts.json
 * 기본 폴더: ../02. 재무 회계/output/demo_data
 *
 * 스키마 근거: blueprint-ugd-erp-demo-instance.md 의 스키마 지도(2026-08-20 역추출).
 * 핵심 규약(어기면 화면이 비거나 잠긴다):
 *  - daily_settles ID = `${encodeURIComponent(지점)}--${YYYY-MM-DD}`, master는 camelCase,
 *    expenses/staff 배열 필수(규칙 검증), memo 끝에 "\n---\nMETADATA:{JSON}"
 *  - shared_data 문서 ID = encodeURIComponent(키), 본문은 { value, updatedAt } 래퍼
 *  - monthly_closings 는 shared_data 의 **단일 배열 문서** (전 지점·전 월·전 섹션)
 *  - admin_settings.fullTimeSalaryPasscode: 운영 앱은 ""/"1234"를 '미설정'으로 판정하지만,
 *    데모 빌드는 IS_DEMO 예외로 "1234"를 허용한다(SalaryAccessGate, 2026-08-20)
 *  - users 프로필의 salaryBranches/allowedBranches 는 *Encoded 짝을 반드시 함께
 *  - 지점명에 "본사"/"오키스테이크하우스"/"--" 금지, 전 컬렉션에서 글자 단위 동일
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const argv = process.argv.slice(2);
const outArg = (() => { const i = argv.indexOf("--out"); return i >= 0 ? argv[i + 1] : null; })();
const OUT_DIR = path.resolve(ROOT, outArg ?? path.join("..", "02. 재무 회계", "output", "demo_data"));

// ── 시드 고정 난수 (재실행해도 같은 기준선) ────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260820);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randint = (min, max) => min + Math.floor(rand() * (max - min + 1));
// 원 단위 반올림(백원 단위 절사로 그럴듯하게)
const won = (n) => Math.round(n / 100) * 100;

// ── 가상 회사 정의 ────────────────────────────────────────────────────────
// 체험 계정 간소화(사용자 지시 2026-08-24): **외울 번호를 하나로** 만든다 — 비밀번호·PIN·급여잠금 전부 123456.
//
// 원래 지시는 "1234"였으나 **Firebase 는 6자 미만 비밀번호를 거부한다**(실측: 1234·12345 거부,
// 123456 통과 — auth/invalid-password). 비밀번호만 늘리면 번호가 둘이 되므로 셋 다 123456 으로 맞췄다.
// 이 값을 4자리로 되돌리려는 시도는 Firebase 정책상 실패한다.
//
// 급여잠금은 운영 앱이라면 '미설정' 취급 규칙에 걸릴 수 있으나 데모 빌드는 예외 처리됨(SalaryAccessGate IS_DEMO).
const DEMO_PIN_BRANCH = "123456";
const DEMO_PIN_ADMIN = "123456";
const DEMO_PASSWORD = "123456";
const SALARY_PASSCODE = "123456";

// 방문자가 직접 타이핑하는 주소라 짧게 둔다. 로그인 게이트가 쓰는 내부 계정
// (admin@ugd-erp.example / branch-NN@ugd-erp.example)은 화면에 안 보이므로 그대로 둔다 —
// 그쪽 주소는 gateAuth.ts 에 하드코딩돼 있어 바꾸면 운영 코드를 건드리게 된다.
const DEMO_EMAIL_ADMIN = "admin@demo.com";
const DEMO_EMAIL_BRANCH = "branch@demo.com";

const BRANCHES = [
  { branchId: "01", branchName: "온담식당 시청점", brand: "온담식당", baseDaily: 2600000 },
  { branchId: "02", branchName: "온담식당 판교점", brand: "온담식당", baseDaily: 2100000 },
  { branchId: "03", branchName: "화로연 홍대점", brand: "화로연", baseDaily: 3200000 },
  { branchId: "04", branchName: "화로연 해운대점", brand: "화로연", baseDaily: 1800000 },
];

/**
 * 지점별 월 추세 배수. 6개월 추이 그래프가 **밋밋한 가로선**이 되면 차트를 보여주는 의미가 없어서,
 * 지점마다 다른 곡선을 준다(성장/정체/계절/하락 각 1개 — 순위 변동과 경보가 실제로 발생한다).
 * i = 0(가장 오래된 마감월) … 5(최근 마감월), 6 = 당월.
 */
const MONTH_TREND = {
  "01": (i) => 0.86 + 0.05 * i,                       // 꾸준히 성장
  "02": (i) => 1.02 - 0.035 * i,                      // 완만한 하락 — 경보 배지가 뜨는 지점
  "03": (i) => 0.95 + 0.12 * Math.sin((i + 1) * 0.9), // 계절 변동
  "04": (i) => 0.92 + 0.03 * i,                       // 소폭 성장
};
const monthFactor = (b, month) => MONTH_TREND[b.branchId](ALL_MONTHS.indexOf(month));

const SURNAMES = ["김", "이", "박", "정", "최", "한", "윤", "장", "임", "서", "오", "신"];
const GIVEN = ["서준", "지우", "하윤", "도현", "수아", "예진", "민재", "가온", "태윤", "소율", "재이", "다은", "시우", "유나", "준서", "채원", "지호", "은우", "라온", "해솔"];
const usedNames = new Set();
function personName() {
  for (let i = 0; i < 200; i++) {
    const n = pick(SURNAMES) + pick(GIVEN);
    if (!usedNames.has(n)) { usedNames.add(n); return n; }
  }
  const n = pick(SURNAMES) + pick(GIVEN) + String(usedNames.size);
  usedNames.add(n);
  return n;
}
const BANKS = ["국민", "신한", "우리", "하나", "농협", "기업"];
const fakeAccount = () => `${randint(100, 999)}-${randint(10, 99)}-${randint(100000, 999999)}`;
const fakeRRN = () => `${randint(85, 99)}${String(randint(1, 12)).padStart(2, "0")}${String(randint(1, 28)).padStart(2, "0")}-${pick(["1", "2"])}******`;
const fakePhone = () => `010-${randint(2000, 9999)}-${randint(1000, 9999)}`;

// ── 기간: 직전 6개월(마감완료) + 당월(어제까지 진행중) ─────────────────────
// 6개월인 이유: 분석 탭의 손익 차트·지점 손익계산서가 **월별 추이 그래프**라 점이 두어 개면 선이 안 그려진다
// (사용자 지시 2026-08-21 — "6개월치가 전부 보이게"). 통합보고서도 같은 6개월로 만든다.
const now = new Date();
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ym = (d) => ymd(d).slice(0, 7);
const monthOf = (offset) => new Date(now.getFullYear(), now.getMonth() + offset, 1);
const CLOSED_MONTHS = [6, 5, 4, 3, 2, 1].map((back) => ym(monthOf(-back)));
/** 가장 최근 마감월. "직전 달" 성격의 표본(수기근무·근로계약·수정이력)은 전부 이 달에 붙인다.
    2개월 가정 시절엔 배열의 두 번째가 곧 최근 마감월이었지만 이제는 아니다 — 반드시 이 상수를 쓸 것. */
const LAST_CLOSED = CLOSED_MONTHS[CLOSED_MONTHS.length - 1];
const CURRENT_MONTH = ym(now);
function daysInMonth(monthStr, partial) {
  const [y, m] = monthStr.split("-").map(Number);
  const last = partial ? Math.max(1, now.getDate() - 1) : new Date(y, m, 0).getDate();
  const days = [];
  for (let d = 1; d <= last; d++) days.push(`${monthStr}-${String(d).padStart(2, "0")}`);
  return days;
}
const ALL_MONTHS = [...CLOSED_MONTHS, CURRENT_MONTH];
const iso = (dateStr, h = 22, mi = 30) => `${dateStr}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00.000Z`;

// ── 직원 구성 (지점별 정직원 4 + 파트 4) ──────────────────────────────────
const RANKS = ["사원", "사원", "대리", "실장"];
const staffByBranch = new Map();
for (const b of BRANCHES) {
  const fulltime = RANKS.map((rank, i) => ({
    id: `emp-${b.branchId}-f${i + 1}`,
    name: personName(),
    division: "정직원",
    rank,
    residentNumber: fakeRRN(),
    contractType: pick(["4대보험", "4대보험", "3.3%"]),
    entryDate: `${2020 + randint(0, 4)}-${String(randint(1, 12)).padStart(2, "0")}-${String(randint(1, 28)).padStart(2, "0")}`,
    phone: fakePhone(),
    addReason: "기존직원",
    salary: won(2600000 + randint(0, 9) * 100000 + (rank === "실장" ? 700000 : rank === "대리" ? 300000 : 0)),
    bank: pick(BANKS),
    accountNumber: fakeAccount(),
  }));
  const parttime = Array.from({ length: 4 }, (_, i) => ({
    id: `emp-${b.branchId}-p${i + 1}`,
    name: personName(),
    division: "파트타이머",
    residentNumber: fakeRRN(),
    contractType: "3.3%",
    entryDate: `${2024 + randint(0, 2)}-${String(randint(1, 12)).padStart(2, "0")}-${String(randint(1, 28)).padStart(2, "0")}`,
    phone: fakePhone(),
    addReason: "신규입사",
    hourlyRate: 10030 + randint(0, 4) * 500,
    bank: pick(BANKS),
    accountNumber: fakeAccount(),
  }));
  staffByBranch.set(b.branchName, { fulltime, parttime });
}

// ── 일일마감 생성 ─────────────────────────────────────────────────────────
const CASH_ITEMS = [
  ["부식비", "인근매장", "쌈채소 추가 구매"],
  ["소모품등 기타", "인근매장", "고무장갑·수세미"],
  ["식재료", "그외기타", "대파 급구"],
  ["소모품등 기타", "그외기타", "건전지"],
];
const CARD_ITEMS = [
  ["식재료", "쿠팡", "청양고추 2박스"],
  ["소모품등 기타", "쿠팡", "위생장갑·랩"],
  ["음료", "네이버", "탄산음료 보충"],
  ["소모품등 기타", "인근매장", "주방세제"],
  ["부식비", "계좌이체", "반찬 재료"],
];

const dailySettles = [];
const dailyByBranchMonth = new Map(); // `${지점}|${월}` → { totalSales 합, days: [{date, cash, card, ...}] }

for (const b of BRANCHES) {
  const staff = staffByBranch.get(b.branchName);
  let prevCash = won(300000 + rand() * 200000); // 전일 이월 시재
  for (const month of ALL_MONTHS) {
    const partial = month === CURRENT_MONTH;
    const acc = { totalSales: 0, menu: 0, liquor: 0, cover: 0, discount: 0, days: [] };
    dailyByBranchMonth.set(`${b.branchName}|${month}`, acc);
    for (const date of daysInMonth(month, partial)) {
      const dow = new Date(date + "T12:00:00").getDay(); // 0=일
      const weight = [0.85, 0.7, 0.8, 0.9, 1.0, 1.35, 1.25][dow];
      const total = won(b.baseDaily * weight * monthFactor(b, month) * (0.85 + rand() * 0.3));
      const cashSales = won(total * (0.06 + rand() * 0.06));
      const transferSales = won(total * (0.01 + rand() * 0.02));
      const deliverySales = b.brand === "온담식당" ? won(total * (0.08 + rand() * 0.07)) : 0;
      const cardSales = total - cashSales - transferSales - deliverySales;

      // 지출 행 (METADATA)
      const cashExpenses = Array.from({ length: randint(0, 2) }, () => {
        const [classification, usage, detail] = pick(CASH_ITEMS);
        return { classification, usage, detail, amount: String(won(8000 + rand() * 40000)) };
      });
      const cardExpenses = Array.from({ length: randint(1, 3) }, () => {
        const [classification, usage, detail] = pick(CARD_ITEMS);
        return { classification, usage, detail, amount: String(won(15000 + rand() * 80000)) };
      });
      const cashSpent = cashExpenses.reduce((s, r) => s + Number(r.amount), 0);
      const theoretical = prevCash + cashSales - cashSpent;
      const hasDiff = rand() < 0.05;
      const cashBalance = hasDiff ? theoretical - 1000 : theoretical;

      // 근무 인원 (METADATA staffRows)
      const workingFull = staff.fulltime.filter(() => rand() > 0.15);
      const workingPart = staff.parttime.filter(() => rand() > 0.4);
      const staffRows = [
        ...workingFull.map((e) => {
          const overtime = rand() < 0.12 ? 1 : 0;
          return {
            division: "정직원", name: e.name, standardHours: 9,
            clockIn: pick(["09:00", "10:00"]), clockOut: overtime ? "20:00" : "19:00",
            workHours: 9 + overtime, overtime,
            overtimeReason: overtime ? pick(["단체 예약 마감", "재고 정리", "위생 점검 준비"]) : "",
          };
        }),
        ...workingPart.map((e) => {
          const hours = pick([4, 5, 6]);
          const start = pick(["11:00", "17:00", "18:00"]);
          const end = `${String(Number(start.slice(0, 2)) + hours).padStart(2, "0")}:00`;
          return {
            division: "파트타이머", name: e.name, standardHours: 0,
            clockIn: start, clockOut: end, workHours: hours, overtime: 0, overtimeReason: "",
          };
        }),
      ];

      const metadata = {
        staffRows,
        cashExpenses,
        cardExpenses,
        cashBalance: String(cashBalance),
        prevDayCash: String(prevCash),
        naverReviewCount: String(randint(0, 3)),
        cashDiffReason: hasDiff ? "동전 시재 차이 확인 중" : "",
        staffMemo: rand() < 0.1 ? "신규 파트타이머 교육 진행" : "",
        reviewMemo: rand() < 0.1 ? "네이버 리뷰 답글 완료" : "",
        otherMemo: "",
      };
      const workSummary = staffRows
        .map((r) => `- ${r.name} (${r.division}): 출근 ${r.clockIn}, 퇴근 ${r.clockOut} [기준 ${r.standardHours}h, 근무 ${r.workHours}h, 초과 +${r.overtime}h]`)
        .join("\n");
      const memo = `[직원 특이사항]\n${metadata.staffMemo}\n\n[리뷰 특이사항]\n${metadata.reviewMemo}\n\n[기타 특이사항]\n${metadata.otherMemo}\n\n[근무 일지 요약]\n${workSummary}\n---\nMETADATA:${JSON.stringify(metadata)}`;

      const recordId = `${encodeURIComponent(b.branchName)}--${date}`;
      const submitter = staff.fulltime[0].name;
      dailySettles.push({
        id: recordId,
        data: {
          recordId,
          master: {
            recordId,
            branchName: b.branchName,
            settleDate: date,
            cashSales, cardSales, transferSales, deliverySales,
            totalSales: total,
            memo,
            submittedAt: iso(date, 13, randint(0, 59)), // UTC 13시 ≈ KST 22시
            submittedBy: submitter,
            submittedByUid: "",
            modifiedAt: "", modifiedBy: "", modifiedByUid: "",
          },
          expenses: [
            ...cashExpenses.map((r) => ({ expenseType: "현금지출", itemName: `${r.classification} | ${r.usage} | ${r.detail}`, amount: Number(r.amount) })),
            ...cardExpenses.map((r) => ({ expenseType: "카드지출", itemName: `${r.classification} | ${r.usage} | ${r.detail}`, amount: Number(r.amount) })),
          ],
          staff: staffRows.map((r) => ({ staffName: r.name, workHours: r.workHours, division: r.division })),
          updatedAt: iso(date, 13, 30),
        },
      });

      const menu = won(total * (b.brand === "화로연" ? 0.66 : 0.8));
      const liquor = won(total * (b.brand === "화로연" ? 0.3 : 0.16));
      acc.totalSales += total;
      acc.menu += menu;
      acc.liquor += liquor;
      acc.cover += total - menu - liquor;
      prevCash = cashBalance;
    }
  }
}

// ── shared_data 문서 빌더 ─────────────────────────────────────────────────
const sharedDocs = [];
const putShared = (key, value, updatedDate) => {
  // 같은 키를 두 번 넣으면 **시드가 조용히 미달한다** — 문서는 id 로 덮어쓰여 하나로 합쳌지는데
  // 검증은 배열 길이를 기대치로 써서 "191중 189건"으로 실패한다(2026-08-21 실제 발생).
  // 뒤에 온 값이 이기도록 **갱신**한다 — 빈 기본값을 먼저 깔고 나중에 표본을 덮는 순서가 살아난다.
  const id = encodeURIComponent(key);
  const data = { value, updatedAt: iso(updatedDate ?? ymd(now), 3, 0) };
  const at = sharedDocs.findIndex((d) => d.id === id);
  if (at >= 0) sharedDocs[at] = { id, data };
  else sharedDocs.push({ id, data });
};
const monthEndDate = (month) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
};

// (1) 월말 payload — 마감완료 2개월
const closings = [];
for (const b of BRANCHES) {
  const staff = staffByBranch.get(b.branchName);
  for (const month of CLOSED_MONTHS) {
    const acc = dailyByBranchMonth.get(`${b.branchName}|${month}`);
    const closedAt = monthEndDate(month);

    // 매출집계 — 검증식: total − discount == net, menu+liquor+cover == net
    const discount = won(acc.totalSales * 0.015);
    const net = acc.totalSales - discount;
    const menu = acc.menu;
    const liquor = acc.liquor;
    const cover = net - menu - liquor; // 합산식을 정확히 맞춘다
    putShared(`monthly_sales_summary:${b.branchName}:${month}`, {
      totalSales: String(acc.totalSales),
      totalDiscount: String(discount),
      netSales: String(net),
      menuSales: String(menu),
      liquorSales: String(liquor),
      coverCharge: String(cover),
      seatCharge: String(won(net * 0.005)),
    }, closedAt);

    // 매입매출
    const vendors = b.brand === "온담식당"
      ? [["식재료비", "미르푸드"], ["식재료비", "청록유통"], ["주류비", "가온주류"], ["식음료외 기타", "세림위생"]]
      : [["식재료비", "한들축산"], ["식재료비", "청록유통"], ["주류비", "다온주류"], ["식음료외 기타", "누리소모품"]];
    putShared(`monthly_purchases:${b.branchName}:${month}`, vendors.map(([category, vendorName], i) => {
      const amt = won(acc.totalSales * (category === "식재료비" ? 0.13 : category === "주류비" ? 0.07 : 0.02) * (0.8 + rand() * 0.4));
      return {
        id: `pur-${b.branchId}-${month}-${i}`,
        category, vendorName,
        transferAmount: String(amt),
        bank: pick(BANKS), accountNumber: fakeAccount(),
        monthlyUsageAmount: String(amt),
        transferNeeded: true,
        memo: "",
      };
    }), closedAt);

    // 정직원 급여대장
    putShared(`monthly_fulltime_salary:${b.branchName}:${month}`, staff.fulltime.map((e) => ({
      id: `ft_${e.id}`,
      employeeId: e.id,
      name: e.name, rank: e.rank,
      residentNumber: e.residentNumber,
      entryDate: e.entryDate,
      contractType: e.contractType,
      bank: e.bank, accountNumber: e.accountNumber,
      prevSalary: String(e.salary), thisSalary: String(e.salary),
      taxiEtc: "0", bonusTip: "0",
      overtimePay: "", overtimeHours: String(randint(0, 4)), overtimeRate: "12000",
      remitBranch: b.branchName, memo: "",
    })), closedAt);

    // 파트타이머 급여대장 + 프로필 + 제외목록
    putShared(`part_time_salaries:${b.branchName}:${month}`, staff.parttime.map((e) => {
      const hours = randint(40, 90);
      const salary = won(hours * e.hourlyRate);
      return {
        employeeId: e.id, name: e.name,
        residentNumber: e.residentNumber, entryDate: e.entryDate,
        contractStatus: "완료",
        bank: e.bank, accountNumber: e.accountNumber,
        hourlyRate: String(e.hourlyRate),
        accumulatedHours: String(hours),
        tipsEtcAmount: "0",
        calculatedSalary: String(salary),
        attendanceDates: "",
        actualPaidAmount: String(salary),
        payoutBranch: b.branchName,
        memo: "",
      };
    }), closedAt);
    putShared(`part_time_salary_exclusions:${b.branchName}:${month}`, [], closedAt);

    // 마감 상태 — 4개 마감 섹션 + 2개 확인 섹션 전부 confirmed
    for (const section of ["purchase", "salary", "salesSummary", "partTimeSalary"]) {
      closings.push({
        id: `${b.branchName}-${month}-${section}`,
        branchName: b.branchName, month, section,
        status: "confirmed", writer: b.branchName,
        confirmedAt: iso(closedAt, 5, 0), editedAfterConfirm: false, editEvents: [],
        updatedAt: iso(closedAt, 5, 0),
      });
    }
    for (const section of ["businessTaxi", "annualLeave"]) {
      closings.push({
        branchName: b.branchName, month, section,
        status: "confirmed", confirmedAt: iso(closedAt, 4, 0), updatedAt: iso(closedAt, 4, 0),
      });
    }
  }
  // 파트 프로필은 월 무관 키
  putShared(`part_time_profiles:${b.branchName}`, Object.fromEntries(
    staff.parttime.map((e) => [e.id, {
      residentNumber: e.residentNumber, entryDate: e.entryDate, contractStatus: "완료",
      bank: e.bank, accountNumber: e.accountNumber, hourlyRate: String(e.hourlyRate),
    }])
  ));
}
putShared("monthly_closings", closings);

// (2) 지점 운영 데이터
for (const b of BRANCHES) {
  const staff = staffByBranch.get(b.branchName);

  // 주류재고
  const products = (b.brand === "화로연"
    ? [["소주", "참좋은소주", 5000, 1350], ["소주", "새벽소주", 5000, 1400], ["맥주", "구름맥주 500", 6000, 1800], ["맥주", "구름맥주 330", 5000, 1500], ["기타주류", "매실주", 9000, 3200]]
    : [["소주", "참좋은소주", 5000, 1350], ["맥주", "구름맥주 500", 6000, 1800], ["막걸리", "달빛막걸리", 7000, 2100]]
  ).map(([classification, itemName, sale, cost], i) => ({
    id: `liq-${b.branchId}-${i}`, classification, importer: "가온주류",
    itemName, salePrice: String(sale), costPrice: String(cost),
  }));
  putShared(`liquor_products:${b.branchName}`, products);
  const movements = [];
  for (const month of ALL_MONTHS) {
    for (const p of products) {
      movements.push({
        id: `liqmv-${b.branchId}-${month}-${p.id}`,
        productId: p.id,
        movementDate: `${month}-05`,
        inbound: String(randint(24, 120)),
        sold: String(randint(20, 110)),
        memo: "",
      });
    }
  }
  putShared(`liquor_movements:${b.branchName}`, movements);

  // 발주
  const vendorMap = { "식자재": ["미르푸드", "청록유통"], "부식비": ["동네반찬"], "주류": ["가온주류"], "식음료외 기타": ["세림위생"] };
  putShared(`order_vendors:${b.branchName}`, vendorMap);
  const orders = [];
  let oi = 0;
  for (const month of ALL_MONTHS) {
    for (const day of ["03", "10", "17", "24"]) {
      const date = `${month}-${day}`;
      if (date > ymd(now)) continue;
      for (const category of ["식자재", "주류"]) {
        orders.push({
          id: `ord-${b.branchId}-${oi++}`,
          category, vendorName: pick(vendorMap[category]),
          amount: String(won(150000 + rand() * 500000)),
          memo: "", orderDate: date,
        });
      }
    }
  }
  putShared(`orders:${b.branchName}`, orders);

  // 초과근무·파트일지 수기 보정 몇 건
  putShared(`manual_overtime:${b.branchName}`, [{
    id: `manual-${Date.parse(iso(LAST_CLOSED + "-15"))}`,
    staffName: staff.fulltime[1].name,
    settleDate: `${LAST_CLOSED}-15`,
    overtime: 2, reason: "냉장고 고장 대응", createdAt: iso(`${LAST_CLOSED}-15`),
  }]);
  putShared(`manual_parttime:${b.branchName}`, [{
    id: `manual-pt-${Date.parse(iso(LAST_CLOSED + "-20"))}`,
    staffName: staff.parttime[0].name,
    settleDate: `${LAST_CLOSED}-20`,
    clockIn: "수기", clockOut: "수기", workHours: 5,
    reason: "출근 기록 누락 보정", writer: "수기 (출근 기록 누락 보정)", createdAt: iso(`${LAST_CLOSED}-20`),
  }]);

  // 연차 사용 기록 (급여대장 employeeId 와 연결)
  putShared(`annual_leave:${b.branchName}`, staff.fulltime.slice(0, 2).map((e, i) => {
    const start = `${LAST_CLOSED}-${String(10 + i * 7).padStart(2, "0")}`;
    return {
      id: `leave-${Date.parse(iso(start))}`,
      employeeId: e.id, days: 1,
      startDate: start, endDate: start, date: start,
      reason: pick(["개인 사유", "가족 행사", "병원 방문"]),
    };
  }));

  // 근로계약서 발송 대상
  putShared(`labor_contracts:${b.branchName}`, [{
    id: `lc-${b.branchId}-1`,
    name: staff.parttime[3].name,
    phone: staff.parttime[3].phone,
    salary: staff.parttime[3].hourlyRate,
    contractType: "신규입사", periodType: "정규",
    effectiveDate: `${CURRENT_MONTH}-01`,
    status: "발송 대기",
    createdAt: iso(`${CURRENT_MONTH}-01`),
  }]);

  putShared(`staff_movements:${b.branchName}`, []);
  putShared(`branch_notice_checks:${b.branchName}`, {});
  putShared(`kakao_taxi_requests:${b.branchName}`, []);
}

// (3) 전역 설정·공지
putShared("admin_settings", {
  logoUrl: "",
  fullTimeSalaryPasscode: SALARY_PASSCODE,
  adminSecurityPasscode: DEMO_PIN_ADMIN,
});
putShared("admin_notices", [{
  id: `notice-${Date.parse(iso(ymd(now)))}`,
  targetBranch: "전체",
  title: "시연용 안내",
  body: "이 화면의 모든 데이터는 시연을 위한 가상 데이터입니다. 자유롭게 입력해 보셔도 됩니다.",
  createdAt: iso(ymd(now), 0, 0),
}]);
putShared("admin_dashboard_notices", [{
  id: `notice-${Date.parse(iso(ymd(now))) + 1}`,
  targetBranch: "전체",
  title: "데모 리셋 안내",
  body: "시연이 끝나면 데이터는 기준선으로 리셋됩니다.",
  createdAt: iso(ymd(now), 0, 0),
}]);

// (4) 분석 탭 손익 DB — 6개월 × 지점 4 + **본사 행**
// 본사 행 규약(pnlDb.ts 주석 = 04 collector 실측): 총매출 = 전지점 합산 · 공과금 = 배당/인센 ·
// 총지출 = 본사지출 + 배당/인센 · 이익금 = 본사 자체 손익(음수). 순위·평균에서는 제외된다.
// 이 행이 없으면 [손익 종합 > 본사 종합] 하단 정산부(본사지출~이익잉여금)가 통째로 안 그려진다.
/** 특별지출(일회성) 표본 — 달·지점을 흩어 놓아야 추이 그래프에서 "이 달만 튄 이유"를 설명할 수 있다. */
const SPECIAL_SPEND = [
  { month: CLOSED_MONTHS[0], branchId: "03", amount: 1800000, note: "주방 배기 설비 교체" },
  { month: CLOSED_MONTHS[2], branchId: "01", amount: 2400000, note: "홀 테이블·의자 교체" },
  { month: CLOSED_MONTHS[3], branchId: "04", amount: 1250000, note: "간판 LED 보수" },
  { month: CLOSED_MONTHS[4], branchId: "02", amount: 3100000, note: "냉난방기 교체" },
];
const pnlRows = [];
for (const b of BRANCHES) {
  for (const month of CLOSED_MONTHS) {
    const acc = dailyByBranchMonth.get(`${b.branchName}|${month}`);
    const staff = staffByBranch.get(b.branchName);
    const total = acc.totalSales;
    const 식재료 = won(total * 0.30);
    const 주류원가 = won(acc.liquor * 0.35);
    const 인건비 = won(staff.fulltime.reduce((s, e) => s + e.salary, 0) + staff.parttime.length * 650000);
    const 임대료 = won(total * 0.09);
    const 공과금 = won(total * 0.035);
    const 기타비용 = won(total * 0.02);
    const 광고비 = won(total * 0.015);
    const 세금예비 = won(total * 0.03);
    const 수수료 = won(total * 0.02);
    const 특별지출건 = SPECIAL_SPEND.find((x) => x.month === month && x.branchId === b.branchId);
    const 특별지출 = 특별지출건 ? 특별지출건.amount : 0;
    const 총지출 = 식재료 + 주류원가 + 인건비 + 임대료 + 공과금 + 기타비용 + 광고비 + 세금예비 + 수수료 + 특별지출;
    const 영수건수 = randint(900, 2200);
    pnlRows.push({
      month, "지점": b.branchName,
      "메뉴매출": acc.menu, "주류매출": acc.liquor, "배달/기타매출": total - acc.menu - acc.liquor,
      "총매출": total,
      "임대료": 임대료, "식재료": 식재료, "주류원가": 주류원가, "인건비": 인건비,
      "공과금": 공과금, "기타비용": 기타비용, "광고비": 광고비, "세금예비": 세금예비,
      "수수료": 수수료, "특별지출": 특별지출,
      "특별지출비고": 특별지출건 ? 특별지출건.note : "",
      "총지출": 총지출, "이익금": total - 총지출,
      "영수건수": 영수건수, "객단가": Math.round(total / 영수건수),
    });
  }
}
// 본사 행 — 지점 행이 모두 만들어진 뒤에 그 합으로 세운다.
for (const month of CLOSED_MONTHS) {
  const branchRows = pnlRows.filter((r) => r.month === month);
  const 지점총매출 = branchRows.reduce((sum, r) => sum + r.총매출, 0);
  const 지점이익합 = branchRows.reduce((sum, r) => sum + r.이익금, 0);
  // 본사 자체 지출(임대·인건·공과·기타) + 배당/인센. 배당/인센은 지점 이익 합의 일부로 잡아
  // 이익잉여금(= 소계이익 − 본사 총지출)이 항상 양수로 남게 한다 — 데모에서 적자 회사로 보이면 곤란하다.
  const 배당인센 = won(Math.max(0, 지점이익합) * 0.28);
  const 본사임대료 = won(지점총매출 * 0.006);
  const 본사인건비 = won(지점총매출 * 0.031);
  const 본사공과금 = 배당인센;              // 규약: 본사 행 공과금 칸 = 배당/인센
  const 본사기타 = won(지점총매출 * 0.011);
  const 본사광고비 = won(지점총매출 * 0.008);
  const 본사지출 = 본사임대료 + 본사인건비 + 본사기타 + 본사광고비;
  const 총지출 = 본사지출 + 배당인센;
  pnlRows.push({
    month, "지점": "본사",
    "메뉴매출": 0, "주류매출": 0, "배달/기타매출": 0,
    "총매출": 지점총매출,                   // 규약: 전지점 합산
    "임대료": 본사임대료, "식재료": 0, "주류원가": 0, "인건비": 본사인건비,
    "공과금": 본사공과금, "기타비용": 본사기타, "광고비": 본사광고비,
    "세금예비": 0, "수수료": 0, "특별지출": 0, "특별지출비고": "",
    "총지출": 총지출,
    "이익금": -총지출,                      // 규약: 본사는 자체 손익(음수)
    "영수건수": 0, "객단가": 0,
  });
}

putShared("analysis_pnl_db", {
  rows: pnlRows,
  branchOps: Object.fromEntries(BRANCHES.map((b) => [b.branchName, { tables: randint(10, 18), restDays: 4 }])),
  uploadedAt: iso(ymd(now), 1, 0),
  uploadedBy: "데모 시드",
});

// ── (5) 법인택시(카카오T 비즈니스) ────────────────────────────────────────
// 운영에서는 이 화면만 GAS(구글시트)+카카오T API를 통해 데이터를 받는다. 시연용 인스턴스에는 그 백엔드가
// 없으므로, 같은 응답 모양을 Firestore 에 미리 넣어 두고 src/api/demoGas.ts 가 그대로 되돌려 준다.
// 필드 이름은 gasClient 의 KakaoTaxiOrder/Member/Group 타입과 **1:1로 맞춰야** 한다 — 하나만 달라도
// 집계(지점 귀속·금액 합)가 조용히 어긋난다.
const TAXI_ACCOUNT = "acct1"; // 데모 지점은 계정 표(KAKAO_ACCOUNT_BY_BRANCH)에 없으므로 전부 기본 계정
const taxiGroups = BRANCHES.map((b) => ({
  id: `grp-${b.branchId}`,
  name: b.branchName,
  status: "enabled",
  description: `${b.brand} ${b.branchName} 이용자 그룹`,
  account_key: TAXI_ACCOUNT,
}));

// 인원은 지점 정직원 명부에서 뽑는다 — 급여대장·직원현황과 같은 사람이라야 시연 중 앞뒤가 맞는다.
const taxiMembers = [];
for (const b of BRANCHES) {
  const staff = staffByBranch.get(b.branchName);
  staff.fulltime.forEach((e, i) => {
    // 마지막 한 명은 '등록 후 미인증(created)' 상태로 둔다 — 인증 알림톡 재발송 기능을 보여주기 위함.
    const pending = i === staff.fulltime.length - 1;
    taxiMembers.push({
      id: `TX${b.branchId}${String(i + 1).padStart(2, "0")}`,
      name: e.name,
      department: b.branchName,
      identifier: `${b.branchId}${String(i + 1).padStart(3, "0")}`,
      mobile_phone: e.phone,
      status: pending ? "created" : "connected",
      confirmed_at: pending ? null : iso(`${CLOSED_MONTHS[0]}-05`, 4, 10),
      group_ids: [`grp-${b.branchId}`],
      account_key: TAXI_ACCOUNT,
    });
  });
}
// 이용정지 인원 1명 — 차단/해제 버튼이 살아 있는 걸 보여준다.
taxiMembers.push({
  id: "TX9901", name: personName(), department: BRANCHES[1].branchName,
  identifier: "029001", mobile_phone: fakePhone(), status: "blocked",
  confirmed_at: iso(`${CLOSED_MONTHS[1]}-11`, 4, 10),
  group_ids: [`grp-${BRANCHES[1].branchId}`], account_key: TAXI_ACCOUNT,
});
putShared("demo_kakao_taxi_groups", taxiGroups);
putShared("demo_kakao_taxi_members", taxiMembers);

// 이용내역 — 마감월 6개 + 당월. 심야 할증·장거리 등 '이상 점검'이 실제로 걸리도록 섞는다.
const TAXI_SPOTS = [
  "서울역", "강남역", "여의도 IFC", "홍대입구역", "성수동 카페거리", "김포공항",
  "판교테크노밸리", "잠실 롯데월드타워", "용산역", "수서역", "사당역", "합정역",
];
const TAXI_COMPANIES = ["가온운수", "다온교통", "한빛택시", "새길운수"];
let taxiOrderSeq = 0;
for (const month of ALL_MONTHS) {
  const partial = month === CURRENT_MONTH;
  const lastDay = partial ? Math.max(1, now.getDate() - 1) : new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const orders = [];
  for (const m of taxiMembers) {
    if (m.status === "created") continue; // 미인증자는 아직 이용 이력이 없다
    const rides = randint(3, 9);
    for (let i = 0; i < rides; i++) {
      const day = String(randint(1, lastDay)).padStart(2, "0");
      // 대부분 퇴근 시간대, 가끔 심야(할증) — 이상 점검 화면이 볼 거리가 생긴다.
      const late = rand() < 0.18;
      const hour = late ? randint(0, 3) : randint(18, 23);
      const stamp = `${month}-${day} ${String(hour).padStart(2, "0")}:${String(randint(0, 59)).padStart(2, "0")}:00`;
      const far = rand() < 0.12;
      const fare = won(far ? randint(38000, 72000) : randint(6000, 21000));
      taxiOrderSeq += 1;
      const [from, to] = [pick(TAXI_SPOTS), pick(TAXI_SPOTS)];
      orders.push({
        id: `ord-${month}-${String(taxiOrderSeq).padStart(5, "0")}`,
        service_fare: fare,
        toll: far && rand() < 0.5 ? 800 : 0,
        call_time: stamp,
        departure_time: stamp,
        departure_point: from,
        arrival_point: to === from ? "자택" : to,
        member_id: m.id,
        member_name: m.name,
        member_identifier: m.identifier,
        member_department: m.department,
        group_name: m.department,
        car_number: `${randint(10, 99)}${pick(["가", "나", "다", "라", "마"])} ${randint(1000, 9999)}`,
        taxi_company_name: pick(TAXI_COMPANIES),
        taxi_kind: pick(["일반", "일반", "블루", "모범"]),
        vertical_code: "taxi",
        vertical_product_name: "택시",
        use_code: pick(["", "", "마감 후 귀가", "본사 회의", "식자재 긴급 구매"]),
        account_key: TAXI_ACCOUNT,
      });
    }
  }
  orders.sort((a, b) => a.call_time.localeCompare(b.call_time));
  putShared(`demo_kakao_taxi_orders:${month}`, orders, partial ? ymd(now) : monthEndDate(month));
}

// 지점이 올린 신청 — 관리자 '신청 처리' 화면이 비어 있지 않게 대기 2건 + 처리완료 1건.
{
  const b0 = BRANCHES[0], b2 = BRANCHES[2];
  const reqAt = (d) => iso(`${LAST_CLOSED}-${d}`, 5, 0);
  putShared(`kakao_taxi_requests:${b0.branchName}`, [
    {
      id: `req-${b0.branchId}-1`, type: "register", branchName: b0.branchName, status: "pending",
      requestedAt: reqAt("18"), name: personName(), phone: fakePhone().replace(/-/g, ""),
      memo: "신규 입사자 — 마감 후 귀가용",
    },
    {
      id: `req-${b0.branchId}-2`, type: "delete", branchName: b0.branchName, status: "approved",
      requestedAt: reqAt("06"), name: taxiMembers[1].name, memberId: taxiMembers[1].id,
      accountKey: TAXI_ACCOUNT, reason: "퇴사 예정", processedAt: reqAt("07"),
      resultNote: "이용중지 처리됨",
    },
  ]);
  putShared(`kakao_taxi_requests:${b2.branchName}`, [{
    id: `req-${b2.branchId}-1`, type: "update", branchName: b2.branchName, status: "pending",
    requestedAt: reqAt("20"), name: taxiMembers[8].name, memberId: taxiMembers[8].id,
    accountKey: TAXI_ACCOUNT, reason: "휴대폰 번호 변경",
  }]);
}

// ── edit_logs 몇 건 (마감 이력 점검 화면용) ───────────────────────────────
const editLogs = [];
{
  const b = BRANCHES[0];
  const date = `${LAST_CLOSED}-12`;
  const recordId = `${encodeURIComponent(b.branchName)}--${date}`;
  const src = dailySettles.find((d) => d.id === recordId);
  if (src) {
    const m = src.data.master;
    const ts = Date.parse(iso(date, 14, 10));
    const snap = (cash) => ({
      cashSales: cash, cardSales: m.cardSales, transferSales: m.transferSales,
      deliverySales: m.deliverySales, memo: m.memo,
      expenses: src.data.expenses, staff: src.data.staff,
    });
    editLogs.push({
      id: `${recordId}-${ts}`,
      data: {
        id: `${recordId}-${ts}`,
        recordId, branchName: b.branchName, settleDate: date,
        modifiedAt: iso(date, 14, 10),
        modifiedBy: staffByBranch.get(b.branchName).fulltime[0].name,
        modifiedByUid: "", reason: "",
        before: snap(m.cashSales - 30000),
        after: snap(m.cashSales),
      },
    });
  }
}

// ── public_branches / Auth 계정 ───────────────────────────────────────────
const publicBranches = BRANCHES.map((b) => ({
  id: b.branchId,
  data: {
    branchId: b.branchId,
    branchName: b.branchName,
    brand: b.brand,
    role: "branch",
    loginEmail: `branch-${b.branchId}@ugd-erp.example`,
    isActive: true,
    updatedAt: iso(ymd(now), 0, 0),
  },
}));

const allBranchNames = BRANCHES.map((b) => b.branchName);
const enc = (arr) => arr.map((s) => encodeURIComponent(s));
const authAccounts = [
  // PIN 게이트 전용 계정 (프로필 없음)
  { email: "admin@ugd-erp.example", password: `ugd-${DEMO_PIN_ADMIN}`, emailVerified: true, displayName: "게이트(관리자)" },
  ...BRANCHES.map((b) => ({
    email: `branch-${b.branchId}@ugd-erp.example`,
    password: `ugd-${DEMO_PIN_BRANCH}`,
    emailVerified: true,
    displayName: `게이트(${b.branchName})`,
  })),
  // 시연 방문자용 개인 계정
  {
    email: DEMO_EMAIL_ADMIN, password: DEMO_PASSWORD, emailVerified: true, displayName: "데모 관리자",
    profile: {
      name: "데모 관리자", email: DEMO_EMAIL_ADMIN, phone: "010-0000-0001",
      workBranch: allBranchNames[0],
      role: "admin", allowedTabs: "all", allowedBranches: "all",
      allowedAdminTabs: "all",
      salaryBranches: "all", salaryBranchesEncoded: "all", allowedBranchesEncoded: "all",
      status: "active", reviewedByAdmin: true, createdAt: iso(ymd(now), 0, 0),
    },
  },
  {
    email: DEMO_EMAIL_BRANCH, password: DEMO_PASSWORD, emailVerified: true, displayName: "데모 지점장",
    profile: {
      name: "데모 지점장", email: DEMO_EMAIL_BRANCH, phone: "010-0000-0002",
      workBranch: allBranchNames[0],
      role: "branchAdmin", allowedTabs: "all",
      allowedBranches: allBranchNames, allowedBranchesEncoded: enc(allBranchNames),
      salaryBranches: allBranchNames, salaryBranchesEncoded: enc(allBranchNames),
      status: "active", reviewedByAdmin: true, createdAt: iso(ymd(now), 0, 0),
    },
  },
];

// ── branch_own_rosters ────────────────────────────────────────────────────
const rosters = BRANCHES.map((b) => {
  const staff = staffByBranch.get(b.branchName);
  return {
    id: encodeURIComponent(b.branchName),
    data: {
      branchName: b.branchName,
      employees: [...staff.fulltime, ...staff.parttime].map((e) => ({
        id: e.id, name: e.name, division: e.division,
        ...(e.rank ? { rank: e.rank } : {}),
        residentNumber: e.residentNumber, contractType: e.contractType,
        entryDate: e.entryDate, phone: e.phone, addReason: e.addReason,
      })),
      movedOut: {},
      updatedAt: iso(ymd(now), 0, 0),
    },
  };
});

// ── 파일 출력 ─────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });
const writeJson = (name, value) =>
  fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(value, null, 1), "utf8");

writeJson("_auth_accounts.json", authAccounts);
writeJson("public_branches.json", publicBranches);
writeJson("daily_settles.json", dailySettles);
writeJson("shared_data.json", sharedDocs);
writeJson("branch_own_rosters.json", rosters);
writeJson("edit_logs.json", editLogs);

console.log(`[생성] ${OUT_DIR}`);
console.log(`  - 지점 ${BRANCHES.length}곳 (${BRANCHES.map((b) => b.branchName).join(", ")})`);
console.log(`  - 기간: ${CLOSED_MONTHS.join(", ")}(마감완료) + ${CURRENT_MONTH}(진행중)`);
console.log(`  - daily_settles ${dailySettles.length}건 / shared_data ${sharedDocs.length}건 / 계정 ${authAccounts.length}개`);
console.log(`  - 지점 PIN ${DEMO_PIN_BRANCH} / 관리자 PIN ${DEMO_PIN_ADMIN} / 급여대장 잠금번호 ${SALARY_PASSCODE}`);
