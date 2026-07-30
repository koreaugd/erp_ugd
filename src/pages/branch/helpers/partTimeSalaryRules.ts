// src/pages/branch/helpers/partTimeSalaryRules.ts
// 파트타이머 급여대장에서 "저장된 값을 쓸 것인가, 일일마감 집계를 따를 것인가"를 정하는 규칙.
//
// 왜 따로 뺐나
//   이 판정이 화면(MonthlyPartTimeSalarySubTab)과 마감 엑셀(monthlyCloseWorkbook)에 따로 적혀 있었고,
//   실제로 두 곳이 어긋나 있었다 — 화면에는 5시간이 보이는데 엑셀에는 0시간이 찍히는 상태였다.
//   이 표는 그대로 은행 이체로 이어지므로 그 어긋남이 곧 급여 누락·과지급이다.
//   그래서 판정은 이 파일 한 곳에서만 한다. 한쪽만 고치는 일이 다시 생기지 않게.

/** 이 규칙이 들여다보는 부분만. 화면의 행 타입과 엑셀 쪽 느슨한 저장본을 모두 받는다. */
export interface PartTimeHoursSource {
  accumulatedHours?: unknown;
  hoursOverridden?: unknown;
  attendanceDates?: unknown;
  attendanceOverridden?: unknown;
}

/**
 * 이 행에 쓸 누적시간. 규칙은 한 문장이다 — **직접 적은 값만 지키고, 나머지는 일일마감을 따른다.**
 *
 *  · 사람이 직접 정했으면(hoursOverridden) 0이든 빈 값이든 그대로 둔다.
 *    말일 낮에 그날 저녁 근무를 예상해 적어 두는 경우가 이 경로다 — 나중에 실제 기록이 올라와도 덮지 않는다.
 *  · 직접 정한 적이 없으면 언제나 일일마감 집계를 따른다.
 *
 * 저장된 값을 물려주지 않는 이유:
 *   이 표는 열기만 해도 모든 행이 통째로 저장된다(자동저장). 그래서 20일에 한 번 열어 두면
 *   그때의 시간이 저장되는데, 저장값을 우선하면 그 뒤에 일한 시간이 영영 반영되지 않는다.
 *   5시간에서 멈춘 채 12시간을 일한 사람에게 5시간치만 지급되는 식이다 — 화면에도 엑셀에도
 *   똑같이 5시간으로 보이니 **아무도 알아채지 못한 채 급여가 빠진다.** 0시간이든 5시간이든 같은 사고다.
 *
 * 옛 저장본(이 플래그가 생기기 전에 손으로 적어 둔 값)은 이 규칙에서 일일마감 집계로 맞춰진다.
 * 표시된 값이 근무기록과 어긋난 채로 남는 것보다, 기록과 맞춘 뒤 필요하면 다시 적게 하는 편이
 * 확인할 수 있어 안전하다(다시 적으면 그때부터는 위 첫 번째 규칙으로 지켜진다).
 */
export function resolvePartTimeAccumulatedHours(
  saved: PartTimeHoursSource | null | undefined,
  autoHours: string
): string {
  if (!saved?.hoursOverridden) return autoHours;
  const savedHours = saved.accumulatedHours;
  return savedHours === undefined ? autoHours : String(savedHours);
}

/**
 * 시급 × 누적시간 + 팁.
 *
 * 화면에도 엑셀에도 이 금액을 직접 고치는 칸이 없다. 순전히 계산으로만 나오는 값이라 언제나 다시 계산한다.
 * 저장된 금액을 물려주면 누적시간만 갱신됐을 때 금액이 옛 숫자로 남아, 같은 줄의 시간과 금액이 서로 어긋난다.
 */
export function computePartTimeSalary(hourlyRate: unknown, hours: unknown, tips: unknown): string {
  return String(((Number(hourlyRate) || 0) * (Number(hours) || 0)) + (Number(tips) || 0));
}

/**
 * 실수령액(송금액).
 *
 * 지점 화면에는 이 칸의 입력란이 없다 — 값이 들어 있다면 그건 급여를 고칠 때 자동으로 채워 둔 금액이다.
 * 그러니 급여가 다시 계산되면 이 값도 함께 따라가야 한다. 그대로 두면 엑셀의 '실수령액(송금액)' 칸에
 * 옛 금액이 남아 그 금액대로 송금된다.
 * 비어 있는 칸은 비운 채로 둔다 — 본사가 직접 채우는 자리라, 채워 넣으면 본사 판단을 앞질러 버린다.
 */
export function syncPartTimeActualPaid(previousActualPaid: unknown, calculatedSalary: string): string {
  const previous = previousActualPaid === undefined || previousActualPaid === null ? "" : String(previousActualPaid);
  return previous === "" ? "" : calculatedSalary;
}

/**
 * 출근일 표시. 누적시간과 **똑같은 규칙**을 쓴다 — 직접 적은 값만 지키고, 나머지는 일일마감을 따른다.
 *
 * 저장값을 우선하면 누적시간과 같은 사고가 난다. 20일에 대장을 한 번 열면 그때까지의 출근일이 저장되고,
 * 그 뒤 근무한 날짜가 영영 붙지 않는다. 시간은 12시간으로 늘었는데 출근일은 3일치만 남아 있으면,
 * 급여를 확인하는 사람이 어느 쪽이 맞는지 알 수 없다(시간을 날짜에 맞춰 깎을 수도 있다).
 *
 * **최대 7개까지만 적는다**(사용자 지시 2026-07-31) — 1~10일 일한 기록이 있어도 1~7만 남긴다.
 * 칸 폭을 그 개수에 맞춰 두었기 때문에, 직접 적은 값도 같은 한도를 지킨다.
 * 앞의 0은 뗀다(05 → 5).
 */
export const PART_TIME_ATTENDANCE_MAX = 7;

export function resolvePartTimeAttendanceDates(
  saved: PartTimeHoursSource | null | undefined,
  autoDates: string[]
): string {
  if (saved?.attendanceOverridden) {
    return String(saved.attendanceDates ?? "")
      .split(",")
      .map((day) => day.trim())
      .filter(Boolean)
      .slice(0, PART_TIME_ATTENDANCE_MAX)
      .join(",");
  }
  return (Array.isArray(autoDates) ? autoDates : [])
    .slice()
    .sort((a, b) => Number(a) - Number(b))
    .slice(0, PART_TIME_ATTENDANCE_MAX)
    .map((day) => String(Number(day)))
    .join(",");
}
