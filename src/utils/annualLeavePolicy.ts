// src/utils/annualLeavePolicy.ts
// 회사 연차 부여 정책(사용자 지시 2026-08-04) — "년 정산" 방식.
//
//   1) 입사 1년 미만            : 부여 0일 (연차수당을 매월 급여에 포함해 지급하므로 시스템 부여 없음)
//   2) 입사 1년이 되는 날 ~ 그 해 12/31 : 1년이 되는 날 1일을 시작으로 한 달에 1일씩
//   3) 그 다음 해 1월 1일부터    : 15일 + 근속 가산
//
// [근속 가산] 근로기준법 제60조제4항 — 3년 이상 계속근로 시 최초 1년을 초과하는 매 2년마다 1일 가산(한도 25일).
//   근속 1~2년 15일 · 3~4년 16일 · 5~6년 17일 … 21년 이상 25일.
//   가산이 붙는 시점은 **입사 기념일**로 본다(사용자 지시 2026-08-04: "재직기간 3년 지나면 16으로 보여야 한다").
//
// 관리자 연차관리(AdminPage)와 지점 연차관리 탭(AnnualLeaveTab)이 같은 함수를 써야
// 어느 화면에서 보든 부여일수가 같다. 값·규칙을 화면 쪽에 복붙하지 말 것.

// 부여일수 수동값·사용일수 보정값의 공유데이터 키 접두. 관리자 섹션·지점 탭·이동 로직이 모두 여기서 가져다 쓴다.
// 새 키를 쓰는 이유: 옛 키 `annual_leave_grants:`는 예전 화면이 **기본값 15를 그대로 저장해 둔 잔재**가 많아,
// 그걸 수동값으로 읽으면 자동계산(1년 미만 0일 등)이 영영 덮인다.
export const ANNUAL_LEAVE_GRANT_OVERRIDES_PREFIX = "annual_leave_grant_overrides:";
export const ANNUAL_LEAVE_USED_ADJUST_PREFIX = "annual_leave_used_adjust:";
/** 옛 부여일수 키(읽기 전용 승계용). 새로 쓰지 않는다. */
export const LEGACY_ANNUAL_LEAVE_GRANTS_PREFIX = "annual_leave_grants:";

/**
 * 옛 키의 값 중 **관리자가 실제로 고친 것만** 살려 새 수동값과 합친다.
 * 15는 옛 화면의 기본값이라 "칸을 스쳐서 저장된 것"과 구분되지 않으므로 버린다.
 * 그 외 값(예: 20일)은 일부러 넣은 것이므로 승계해야 한다(Codex 지적 2026-08-04 — 통째로 버리면 진짜 예외가 사라진다).
 */
export function mergeLegacyGrantOverrides(
  legacy: Record<string, number> | null | undefined,
  current: Record<string, number> | null | undefined
): Record<string, number> {
  const inherited: Record<string, number> = {};
  Object.entries(legacy || {}).forEach(([id, value]) => {
    const num = Number(value);
    if (Number.isFinite(num) && num !== 15) inherited[id] = num;
  });
  return { ...inherited, ...(current || {}) }; // 새 키가 항상 이긴다
}

/** 명부의 입사일 문자열("YYYY-MM-DD" / "YYYY.MM.DD" / "YY.MM.DD" / ISO)을 로컬 자정 Date로. 해석 불가면 null. */
export function parseEntryDate(value: unknown): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/\./g, "-").replace(/\s/g, "");
  const match = /^(\d{2}|\d{4})-(\d{1,2})-(\d{1,2})/.exec(normalized);
  let date: Date;
  if (match) {
    // "24.03.15"처럼 두 자리 연도는 축약형(옛 지점 화면이 이렇게 저장한 명부가 있다).
    // 무조건 20YY로 보면 "99.01.01"이 2099년(미래)이 되어 근속 20여 년인 사람이 0일로 나온다 —
    // 내년보다 뒤면 1900년대로 돌린다(Codex 지적 2026-08-04). 내년까지 열어 둔 건 입사 예정일 입력을 위해서다.
    let year = Number(match[1]);
    if (match[1].length === 2) {
      year += 2000;
      if (year > new Date().getFullYear() + 1) year -= 100;
    }
    const month = Number(match[2]);
    const day = Number(match[3]);
    // "24.02.31"·"24.13.01" 같은 값은 Date가 3/2·다음해 1/1로 **조용히 굴려** 엉뚱한 근속이 나온다.
    // 없는 날짜는 계산하지 말고 해석 불가로 돌린다(Codex 지적 2026-08-04).
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    date = new Date(year, month - 1, day);
    if (date.getMonth() !== month - 1 || date.getDate() !== day) return null; // 2월 30일 등 롤오버 차단
  } else {
    // "2024-03-15T00:00:00Z" 같은 ISO는 위 정규식이 이미 받는다. 여기로 오는 건 비표준 문자열뿐.
    const fallback = new Date(normalized);
    if (Number.isNaN(fallback.getTime())) return null;
    date = new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  }
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 1990 || date.getFullYear() > 2100) return null;
  return date;
}

/** 입사일을 date 입력칸 값("YYYY-MM-DD")으로. 해석 불가면 빈 문자열. */
export function toEntryDateInputValue(value: unknown): string {
  const parsed = parseEntryDate(value);
  if (!parsed) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

/** 오늘까지 채운 근속 연수(만 나이 계산과 같은 방식). 입사 1년 미만이면 0. */
export function completedServiceYears(entry: Date, base: Date): number {
  let years = base.getFullYear() - entry.getFullYear();
  const beforeAnniversary =
    base.getMonth() < entry.getMonth()
    || (base.getMonth() === entry.getMonth() && base.getDate() < entry.getDate());
  if (beforeAnniversary) years -= 1;
  return Math.max(0, years);
}

/**
 * 근속 n년차의 연간 부여일수 — 15일 + 3년 이상부터 매 2년 1일 가산, 한도 25일.
 * (1~2년 15 · 3~4년 16 · 5~6년 17 … 21년~ 25)
 */
export function annualGrantForServiceYears(years: number): number {
  if (years < 1) return 0;
  return Math.min(25, 15 + Math.floor((years - 1) / 2));
}

/**
 * 오늘 기준 자동 부여일수. 입사일을 해석할 수 없으면 null(화면에서 0 취급 + 입사일 입력 유도).
 * 예외 인원(중도 입사 정산 등)은 화면의 수동 덮어쓰기로 조정한다.
 */
export function calcAutoGrantDays(entryDateValue: unknown, today: Date = new Date()): number | null {
  const entry = parseEntryDate(entryDateValue);
  if (!entry) return null;
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const anniversary = new Date(entry.getFullYear() + 1, entry.getMonth(), entry.getDate());
  if (base.getTime() < anniversary.getTime()) return 0;
  // 전환기(1년이 되는 날이 속한 해): 지난 월 기념일 수 + 시작 1일. 그 해 12/31까지만 이 규칙을 쓴다.
  if (base.getFullYear() === anniversary.getFullYear()) {
    let months = base.getMonth() - anniversary.getMonth();
    if (base.getDate() < anniversary.getDate()) months -= 1;
    return Math.min(months + 1, 12);
  }
  // 그 다음 해 1/1부터: 정규 연차(15일 + 근속 가산)
  return annualGrantForServiceYears(completedServiceYears(entry, base));
}
