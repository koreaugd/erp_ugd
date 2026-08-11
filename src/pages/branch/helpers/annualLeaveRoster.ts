// src/pages/branch/helpers/annualLeaveRoster.ts
// 연차관리 인원 목록의 **단일 출처**. 설계서: docs/superpowers/specs/2026-08-11-연차관리-인원출처-급여대장-설계.md
//
// [무엇이 바뀌었나] 연차 대상자를 지점 직원현황(branch_own_rosters)이 아니라
// **정직원 급여대장**(monthly_fulltime_salary:{지점}:{월})에서 뽑는다. 직원현황은 일일마감이 근무자
// 이름으로 자동 등록하는 경로가 있어 퇴사자·오타 이름이 쌓이지만, 급여대장에는 실제로 급여가 나가는
// 사람만 남기 때문이다(사용자 지시 2026-08-11).
//
// [왜 한 파일인가] 관리자 연차관리(AdminPage)와 지점 연차관리 탭(AnnualLeaveTab)이 각자 조회 규칙을
// 적으면 두 화면의 인원이 갈라진다. 등록 직전 서버 재확인까지 **같은 변환 함수**(toAnnualLeaveMembers)를
// 통과시켜, "목록엔 보이는데 등록은 거부"가 생기지 않게 한다.
//
// [권한 주의] 급여대장 문서는 firestore.rules(isSalaryKey/canReadSalary)가 급여권한 계정만 읽게 막는다.
// 권한이 없으면 읽기가 거부되어 이 함수는 failed=true 를 돌려준다 — "급여대장 미작성"과 구분되지 않으니
// 호출부는 반드시 canReadSalaryBranch() 로 먼저 거르고, 권한이 없으면 아예 부르지 말 것.
//
// [캐시 금지 — 마감확인의 전제] 조회는 **서버 문서만** 읽는다(getSharedDataFromServer / ...FromServer).
// 캐시 폴백을 쓰면 서버에 못 닿는 상황에서 **묵은 목록이 정상 목록처럼** 떠서 failed 가 서지 않고,
// 지점이 그 낡은 표를 보고 월말 확인(마감제출)을 눌러 버린다 — 확인 절차가 통째로 형식이 된다
// (MonthlyCheckAction 의 blockedReason 주석과 같은 취지, Codex 지적 2026-08-11).
// 실패는 실패라고 말하고 화면이 저장·확인을 잠그게 두는 편이 안전하다.
import { gasClient } from "../../../api/gasClient";
import { addMonthsToMonthInputValue, toLocalMonthInputValue } from "./formatters";

/** 연차 대상자 1명 — 급여대장 행에서 뽑아낸 값. */
export interface AnnualLeaveMember {
  /**
   * 연차 데이터(사용기록·부여 수동값·사용 보정)의 열쇠. **항상 값이 있다.**
   * 급여대장에 있는 사람은 예외 없이 연차를 쓸 수 있어야 하므로, 번호가 없으면 만들어 준다(§4.3).
   */
  employeeId: string;
  name: string;
  /** 부여일수 자동계산용 원본 문자열. 표시용 축약은 화면에서 한다. */
  entryDate: string;
  /** 급여대장 행 id — React key 전용. **달마다 바뀌므로 저장 열쇠로 쓰지 말 것.** */
  rowId: string;
}

export interface AnnualLeaveRosterResult {
  /** 인원을 실제로 가져온 달("2026-07"). null = 되돌아본 기간에 급여대장이 없음. */
  sourceMonth: string | null;
  members: AnnualLeaveMember[];
  /** 조회 실패 — 화면은 저장을 잠근다(fail-closed). "인원 0명"과 반드시 구분할 것. */
  failed: boolean;
}

/**
 * 당월에 급여대장이 없을 때 되돌아보는 개월 수.
 * 지점은 보통 월말에 급여대장을 쓰므로, 달 초에는 당월 문서가 비어 있다.
 * 3으로 둔 이유: 두 달 연속 비는 일은 사실상 없고, 더 늘리면 오래전 퇴사자가 되살아난다.
 */
export const ANNUAL_LEAVE_ROSTER_LOOKBACK_MONTHS = 3;

export const fullTimeSalaryKey = (branchName: string, month: string) =>
  `monthly_fulltime_salary:${branchName}:${month}`;

const trimmed = (value: unknown) => String(value ?? "").trim();

/**
 * 인원으로 셀 수 있는 급여대장 행 = **이름이 있는 행**.
 *
 * · 이름이 빈 행은 세지 않는다 — '직원 추가'를 눌러 두고 이름을 안 적은 빈 행 하나 때문에
 *   당월이 채택되면, 실제 인원이 있는 직전 달이 통째로 가려진다.
 * · 금액이 0인 행은 **센다.** 이번 달 새로 올라온 신규 입사자는 금액이 비어 있다.
 *   (급여대장의 flushFullTimeSalaryForClose 는 '마감 가능 여부'를 보려고 금액을 따지는데,
 *    여기는 '사람이 있는가'를 본다. 판정 기준이 다르므로 그쪽 규칙을 가져오지 말 것.)
 */
const namedRows = (rows: unknown): any[] =>
  Array.isArray(rows) ? rows.filter((row) => row && trimmed(row.name)) : [];

/**
 * 문자열 → 짧은 안정 해시(FNV-1a 32비트). 아래 파생 열쇠 전용.
 *
 * **주민번호를 그대로 열쇠에 넣지 않기 위해** 해시를 쓴다. 연차 기록(`annual_leave:{지점}`)은
 * 급여대장과 달리 급여권한 없이도 읽히는 문서라, 거기에 주민번호가 박히면 보호 등급이 낮은 곳으로
 * 개인정보가 새어 나간다.
 */
function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * 급여대장 행 + 직원현황 명부 → 연차 대상자 목록.
 *
 * [열쇠를 정하는 순서] 연차 기록은 employeeId 를 열쇠로 몇 년치가 쌓이는데, 급여대장 행 id 는
 * 안정적이지 않다(로스터에서 온 행 `ft_{직원id}` / 손으로 넣은 행 `ft_manual_{시각}` — 시각은 매번 바뀐다).
 * 그래서 **바뀌지 않는 값**을 순서대로 찾는다.
 *
 *   1. `row.employeeId`      — 로스터에서 올라온 행. 기존 연차 기록이 그대로 이어진다
 *   2. 직원현황 이름 대조     — 손으로 넣은 행이지만 직원현황에 같은 이름이 있는 경우. 기록이 이어진다
 *   3. 주민번호/이름 파생 열쇠 — 위 둘 다 아닌 경우. **새로 쌓기 시작한다**
 *
 * [3번을 왜 만드나] 급여대장에 있는 사람은 예외 없이 연차를 쓸 수 있어야 한다. 예전에는 여기서
 * null 을 주고 화면에서 '직원현황 미등록'으로 막았는데, **급여대장에서 인원을 가져오기로 해 놓고
 * 직원현황에 없다고 막는 것은 앞뒤가 맞지 않는다**(사용자 지적 2026-08-11).
 * 파생 열쇠는 주민번호(있으면)에서 만들어 달이 바뀌어도 그대로다 — 행 id 처럼 매달 달라지지 않는다.
 *
 * [3번의 한계] 주민번호가 없으면 이름으로 만든다. 그 사람의 이름을 나중에 고치면 열쇠가 달라져
 * 기록이 끊긴다. 끊긴 기록은 findStrandedLeaveOwners 가 화면에 띄워 준다(조용히 사라지지 않는다).
 */
export function toAnnualLeaveMembers(rows: unknown, roster: unknown): AnnualLeaveMember[] {
  // 이름 → 직원현황 id. 같은 이름이 둘 이상이면 null 로 표시해 **대조하지 않는다** —
  // 엉뚱한 동명이인의 연차에 기록이 붙느니 3번(파생 열쇠)으로 새로 쌓는 편이 안전하다.
  const idByName = new Map<string, string | null>();
  (Array.isArray(roster) ? roster : []).forEach((employee: any) => {
    const name = trimmed(employee?.name);
    const id = trimmed(employee?.id);
    if (!name || !id) return;
    idByName.set(name, idByName.has(name) ? null : id);
  });

  // 3번 파생 열쇠. 주민번호는 숫자만 남겨 비교한다("801010-1234567" / "8010101234567" 이 같은 사람).
  const derivedId = (row: any, name: string) => {
    const rrn = trimmed(row.residentNumber).replace(/\D/g, "");
    return rrn ? `ftx-r${stableHash(rrn)}` : `ftx-n${stableHash(name)}`;
  };

  const seen = new Set<string>();
  const members: AnnualLeaveMember[] = [];
  namedRows(rows).forEach((row: any, index: number) => {
    const name = trimmed(row.name);
    const employeeId = trimmed(row.employeeId) || idByName.get(name) || derivedId(row, name);
    // 같은 사람이 두 줄이면 사용일수가 두 배로 읽힌다. 첫 행만 남긴다.
    if (seen.has(employeeId)) {
      console.warn(`[연차관리] 급여대장에 같은 직원이 두 번 있습니다 — 뒤 행은 무시합니다: ${name}`);
      return;
    }
    seen.add(employeeId);
    members.push({
      employeeId,
      name,
      entryDate: trimmed(row.entryDate),
      rowId: trimmed(row.id) || `row-${index}`,
    });
  });
  return members;
}

/**
 * 지점의 연차 대상자를 급여대장에서 읽는다.
 * `startMonth`(기본 = 이번 달)부터 최대 ANNUAL_LEAVE_ROSTER_LOOKBACK_MONTHS 개월 역순으로 훑어,
 * 이름이 있는 행이 하나라도 있는 **첫 번째 달**을 채택한다. 채택한 달은 화면에 반드시 표시할 것 —
 * 없으면 지점이 "새로 뽑은 사람이 왜 안 보이나"에서 헤맨다.
 *
 * [startMonth 를 받는 이유] 월말 확인이 걸린 화면은 **확인하려는 달**을 넘겨야 한다.
 * 이번 달 기준으로 뽑아 놓고 지난달을 확정하면 보지도 않은 달을 확인한 것이 된다(MonthlyCheckAction
 * 의 onMonthChange 주석). 되돌아본 끝에 채택한 달이 startMonth 와 다르면 호출부가 확인을 막아야 한다.
 */
export async function loadAnnualLeaveRoster(
  branchName: string,
  startMonth?: string
): Promise<AnnualLeaveRosterResult> {
  let month = startMonth || toLocalMonthInputValue(new Date());
  let rows: any[] | null = null;
  let sourceMonth: string | null = null;

  let roster: any[] = [];
  try {
    for (let step = 0; step < ANNUAL_LEAVE_ROSTER_LOOKBACK_MONTHS; step += 1) {
      // 서버 전용 — 캐시 폴백 금지(위 주석). 실패는 throw 되어 아래 catch 가 failed 로 바꾼다.
      const fetched = await gasClient.getSharedDataFromServer<any[]>(fullTimeSalaryKey(branchName, month));
      if (namedRows(fetched).length > 0) {
        rows = fetched as any[];
        sourceMonth = month;
        break;
      }
      month = addMonthsToMonthInputValue(month, -1);
    }
    // 이름 대조용 명부도 서버 전용으로 읽는다. 여기서 실패를 삼키면 2번(이름 대조)이 통째로 건너뛰어져
    // 기존 기록이 있는 사람까지 3번(파생 열쇠)으로 떨어진다 — 화면은 멀쩡한데 **사용일수가 0으로 보인다.**
    roster = (await gasClient.getBranchOwnRosterFromServer(branchName)) || [];
  } catch (err) {
    console.warn(`[연차관리] ${branchName} 인원을 불러오지 못했습니다(서버 조회 실패).`, err);
    return { sourceMonth: null, members: [], failed: true };
  }

  if (!sourceMonth) return { sourceMonth: null, members: [], failed: false };

  return { sourceMonth, members: toAnnualLeaveMembers(rows, roster), failed: false };
}

/**
 * 이 지점 연차 기록 중 **지금 인원 목록에 없는 사람**의 것을 골라낸다.
 *
 * [왜 필요한가] 인원의 주인이 급여대장으로 넘어가면서 연차관리에서 지점이동 기능이 사라졌다.
 * 그래서 직원이 A지점 급여대장에서 빠지고 B지점 급여대장에 들어가면, 연차 기록은 `annual_leave:A` 에
 * 그대로 남고 **B 화면에서는 사용 0일**로 보인다. 기록이 지워진 것은 아니지만 화면상 초기화된 것과
 * 같아, 그대로 두면 이미 쓴 연차를 다시 쓰게 된다(Codex 지적 2026-08-11).
 * 지우거나 자동으로 옮기지 않는다 — **눈에 보이게만** 만들고, 이관은 사람이 판단한다(설계서 §9).
 *
 * 인원을 못 불러온 지점(sourceMonth 없음·조회 실패)에 대고 부르면 기록 전부가 떠 보이므로,
 * 호출부는 그런 지점을 먼저 걸러야 한다.
 */
export function findStrandedLeaveOwners(
  entries: unknown,
  members: AnnualLeaveMember[]
): Array<{ employeeId: string; name: string; days: number }> {
  const known = new Set(members.map((member) => member.employeeId).filter(Boolean) as string[]);
  const stranded = new Map<string, { employeeId: string; name: string; days: number }>();
  (Array.isArray(entries) ? entries : []).forEach((entry: any) => {
    const employeeId = trimmed(entry?.employeeId);
    if (!employeeId || known.has(employeeId)) return;
    const prior = stranded.get(employeeId);
    // 이름은 관리자에서 등록한 기록에만 들어 있다(staffName). 없으면 번호로라도 알려 준다.
    const name = trimmed(entry?.staffName) || prior?.name || "";
    stranded.set(employeeId, {
      employeeId,
      name,
      days: (prior?.days || 0) + (Number(entry?.days) || 0),
    });
  });
  return [...stranded.values()];
}

/** 남겨진 기록 주인들을 한 줄 문구로. 이름을 모르면 "이름 미상 n명"으로 묶는다. */
export function describeStrandedOwners(owners: Array<{ name: string; days: number }>): string {
  const named = owners.filter((owner) => owner.name);
  const unnamed = owners.length - named.length;
  const parts = named.map((owner) => `${owner.name}(${owner.days}일)`);
  if (unnamed > 0) parts.push(`이름 미상 ${unnamed}명`);
  return parts.join(", ");
}
