// src/pages/branch/helpers/monthlyCheckSections.ts
// 월말 '확인 마감' 섹션(비즈니스택시·연차관리)의 단일 출처.
// 설계서: docs/superpowers/specs/2026-08-11-비즈니스택시-연차-마감확인-설계.md
//
// 왜 필요한가: 비즈니스택시 등록 인원과 연차 내역은 상시 업무라 아무도 "이번 달 것이 맞는지"
// 멈춰서 보지 않는다. 그래서 말일 마감(매입매출·매출집계·파트타이머)을 제출하기 전에
// 두 화면을 눈으로 확인하고 버튼을 누르게 한다.
//
// 이 파일이 '단일 출처'인 이유: 섹션 문자열("businessTaxi" 등)을 여기와 MonthlySettleTab 두 곳에
// 각자 적으면, 나중에 한쪽만 고쳤을 때 게이트가 **조용히** 빠진다(에러도 안 난다).
// MonthlySettleTab 의 CloseSection 은 여기의 CheckSection 을 가져다 넓힌다.
//
// 자동 대조는 하지 않는다(사용자 지시 2026-08-11) — 지점 명부와 택시 등록 인원을 시스템이 맞춰보지
// 않는다. 판단은 사람이 하고, 여기서는 '확인했다'는 사실만 기록한다.
import { gasClient } from "../../../api/gasClient";

export const CHECK_SECTIONS = ["businessTaxi", "annualLeave"] as const;
export type CheckSection = (typeof CHECK_SECTIONS)[number];

export const CHECK_SECTION_LABEL: Record<CheckSection, string> = {
  businessTaxi: "비즈니스택시",
  annualLeave: "연차관리",
};

/** 경고 문구에서 "어디로 가야 하는지"까지 알려주기 위한 화면 경로. */
export const CHECK_SECTION_NAV: Record<CheckSection, string> = {
  businessTaxi: "인사·기타 > 비즈니스택시",
  annualLeave: "인사·기타 > 연차관리",
};

/** 확인 섹션이 선행조건으로 걸리는 마감 섹션 — 말일에 제출하는 3종.
 *  정직원 급여대장(salary)은 25일 작성이라 말일 확인과 시점이 달라 제외한다. */
export const GATED_CLOSE_SECTIONS = ["purchase", "salesSummary", "partTimeSalary"] as const;

/**
 * 게이트가 **실제로 요구하는** 확인 섹션. `CHECK_SECTIONS` 전체가 아니다.
 *
 * 여기엔 **확인 버튼이 화면에 실제로 배포된 섹션만** 넣는다. 요구만 해 놓고 누를 화면이 없으면
 * 그 지점은 말일 마감 3종이 **영구히 막힌다** — 게이트가 fail-closed 라 우회 통로도 없다
 * (Codex 지적 2026-08-11: 확인 컨트롤 없이 게이트만 배포된 커밋).
 *
 * [2026-08-11 연차 추가] 연차관리 확인 버튼(`AnnualLeaveTab` 의 MonthlyCheckAction)이
 * 연차 인원출처 개편과 함께 이 배포에 들어왔다 — 그래서 예고대로 "annualLeave" 를 켠다.
 *
 * **다음에 확인 섹션을 늘릴 때도 같은 순서를 지킬 것:**
 *   ① 그 화면에 확인 버튼을 먼저 배포한다 → ② 그 다음에(또는 같은 배포에) 여기에 더한다.
 * 순서를 뒤집으면 누를 데가 없는 조건을 요구하게 되어 전 지점 말일 마감이 잠긴다.
 */
export const GATE_REQUIRED_SECTIONS: readonly CheckSection[] = ["businessTaxi", "annualLeave"];

export type CheckCloseStatus = "confirmed" | "pending";

export interface CheckCloseRecord {
  branchName: string;
  month: string;
  section: CheckSection;
  status: CheckCloseStatus;
  confirmedAt: string;
  updatedAt: string;
}

const SHARED_KEY = "monthly_closings";

/** 오늘이 속한 달(YYYY-MM). toISOString()은 UTC 라 매월 1일 자정 부근에 전달로 어긋난다. */
export function currentMonthValue(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * 공유 문서의 형식을 검사해 레코드 배열로 돌려준다.
 *
 * `null`(문서 없음) = 아직 아무 마감도 없는 정상 상태 → 빈 배열.
 * 값이 있는데 배열이 아니면 **손상**이다 — 이때 빈 배열로 갈아타면 안 된다.
 * monthly_closings 는 전 지점·전 월·전 섹션이 함께 쓰는 문서 하나라, 손상됐다고 []에서 다시 쌓으면
 * 저장 한 번으로 **모든 지점의 마감 기록이 레코드 하나로 덮인다.** 손상은 만지지 말고 중단한다.
 */
export function assertCloseRecordList(current: unknown): any[] {
  if (current == null) return [];
  if (!Array.isArray(current)) {
    throw new Error("마감 상태 형식이 올바르지 않습니다. 본사 관리자에게 문의해주세요.");
  }
  return current;
}

/**
 * 레코드 목록에서 지점·월·섹션의 **최신** 레코드를 고른다.
 *
 * `(r.section || "purchase")` 정규화는 기존 화면과 같은 규약이다 — section 이 없는 옛 레코드는
 * 매입매출로 본다. 확인 섹션은 "purchase" 가 아니므로 옛 레코드가 잘못 잡히지 않는다.
 */
export function latestCheckRecord(
  list: any[], branchName: string, month: string, section: CheckSection
): CheckCloseRecord | null {
  return (
    list
      .filter((r: any) => r && r.branchName === branchName && r.month === month && (r.section || "purchase") === section)
      .sort((a: any, b: any) =>
        String(b.updatedAt || b.confirmedAt || "").localeCompare(String(a.updatedAt || a.confirmedAt || ""))
      )[0] || null
  );
}

/**
 * 화면 표시용 조회. 캐시를 써도 되는 경로(밴드 초기 렌더)에서 쓴다.
 * 문서가 손상됐으면 throw — 호출부가 오류 배너를 띄운다. '미제출'로 보여주면 지점이 다시 누르게 되고,
 * 그 저장이 손상된 문서를 건드리게 된다.
 */
export async function fetchCheckRecord(
  branchName: string, month: string, section: CheckSection
): Promise<CheckCloseRecord | null> {
  const list = assertCloseRecordList(await gasClient.getSharedData<any[]>(SHARED_KEY));
  return latestCheckRecord(list, branchName, month, section);
}

/**
 * 확인 상태를 저장한다.
 *
 * `saveSharedData`(통째 저장)를 쓰지 않는다 — monthly_closings 는 **전 지점이 공유하는 문서 하나**라,
 * 읽어둔 값 위에 통째로 쓰면 그 사이 다른 지점이 올린 마감이 사라진다.
 * updater 는 순수 함수로 둔다(트랜잭션은 재시도로 여러 번 호출된다) — 그래서 시각은 바깥에서 만든다.
 */
export async function saveCheckClose(
  branchName: string, month: string, section: CheckSection, status: CheckCloseStatus
): Promise<CheckCloseRecord> {
  const now = new Date().toISOString();
  const nextRecord: CheckCloseRecord = {
    branchName,
    month,
    section,
    status,
    // 취소(pending)는 확정 시각을 지운다 — 남겨두면 '미제출인데 확정일시가 있는' 모순이 화면에 뜬다.
    confirmedAt: status === "confirmed" ? now : "",
    updatedAt: now,
  };
  const matches = (r: any) =>
    r && r.branchName === branchName && r.month === month && (r.section || "purchase") === section;

  await gasClient.mutateSharedData<any[]>(SHARED_KEY, (current) => {
    // 손상된 문서는 만지지 않는다(throw = 트랜잭션 취소). 빈 배열로 갈아타면 저장 한 번으로
    // 전 지점의 마감 기록이 이 레코드 하나로 덮인다.
    const list = assertCloseRecordList(current);
    return [nextRecord, ...list.filter((r: any) => !matches(r))];
  });
  return nextRecord;
}

/**
 * 아직 확인하지 않은 섹션 목록을 돌려준다. **빈 배열이면 통과.**
 *
 * fail-closed: 조회 실패나 형식 손상은 `throw` 한다. "확인했는지 알 수 없음"을 "확인함"으로
 * 흘리면 게이트가 있으나 마나다. 호출부는 catch 해서 별도 안내를 띄운다.
 *
 * 캐시를 쓰지 않고 **서버 최신값**을 읽는다 — 화면 캐시는 다른 노트북에서 방금 누른 확인을
 * 못 봐서, 이미 확인한 지점이 마감을 못 하게 된다.
 */
export async function findMissingCheckSections(
  branchName: string, month: string
): Promise<CheckSection[]> {
  // null = 문서 없음(아직 아무 마감도 없음, 정상) → 전부 미확인.
  // 값이 있는데 배열이 아니면 형식 손상이라 확인 여부를 단정할 수 없다 → 중단(assertCloseRecordList 가 throw).
  const list = assertCloseRecordList(await gasClient.getSharedDataFromServer<any[]>(SHARED_KEY));
  // CHECK_SECTIONS 가 아니라 GATE_REQUIRED_SECTIONS 를 돈다 — 누를 화면이 없는 섹션을 요구하면
  // 지점이 마감을 영원히 못 한다(위 상수 주석).
  return GATE_REQUIRED_SECTIONS.filter(
    (section) => latestCheckRecord(list, branchName, month, section)?.status !== "confirmed"
  );
}

/**
 * 게이트 안내 문구. 팝업(window.alert)에 그대로 넣는 형태라 줄바꿈을 포함한다.
 *
 * **대상 월을 반드시 넣는다** — 확인 컨트롤의 기본값은 당월인데, 9월 1일에 8월 마감을 제출하면
 * 지점이 보는 화면은 2026-09 이고 게이트가 요구하는 건 2026-08 이라
 * "분명히 눌렀는데 왜 막히지"가 된다.
 */
export function missingCheckMessage(month: string, missing: CheckSection[]): string {
  const names = missing.map((s) => CHECK_SECTION_LABEL[s]).join(" · ");
  const navs = missing.map((s) => `  · ${CHECK_SECTION_NAV[s]}`).join("\n");
  return (
    `${month} ${names} 확인이 아직 안 됐습니다.\n\n${navs}\n\n` +
    `위 화면에서 월을 ${month}로 맞추고, 표 내용이 실제와 맞는지 확인한 뒤 [마감제출]을 눌러주세요.`
  );
}
