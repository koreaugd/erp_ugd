// src/pages/branch/helpers/partTimeSalaryRules.ts
// 파트타이머 급여대장에서 "저장된 값을 쓸 것인가, 일일마감 집계를 따를 것인가"를 정하는 규칙.
//
// 왜 따로 뺐나
//   이 판정이 화면(MonthlyPartTimeSalarySubTab)과 마감 엑셀(monthlyCloseWorkbook)에 따로 적혀 있었고,
//   실제로 두 곳이 어긋나 있었다 — 화면에는 5시간이 보이는데 엑셀에는 0시간이 찍히는 상태였다.
//   이 표는 그대로 은행 이체로 이어지므로 그 어긋남이 곧 급여 누락·과지급이다.
//   그래서 판정은 이 파일 한 곳에서만 한다. 한쪽만 고치는 일이 다시 생기지 않게.

/** 이름별 이번 달 근무 집계. hours=합계 시간, dates=출근일(표기 형식은 부르는 쪽이 정한다). */
export type PartTimeWorkTelemetry = { hours: number; dates: string[] };

/**
 * 파트타이머 근무일지에 **수기로 적은 근무**(shared_data `manual_parttime:<지점>`)를 집계에 더한다.
 *
 * 일지 탭은 일일마감 기록과 수기 기록을 합쳐 보여주는데, 급여대장과 마감 엑셀은 오랫동안 일일마감만
 * 읽었다. 그래서 수기로 적은 근무는 일지에는 보이면서 **급여에서는 빠졌다** — 두 화면의 숫자가
 * 어긋나고 경고도 없어, 수기 입력에 기댄 달은 급여가 적게 나갈 수 있었다(2026-07-31 수정).
 * (정직원 초과근무는 원래부터 manual_overtime 을 같이 합산한다. 파트타이머만 빠져 있었다.)
 *
 * 이 집계를 만드는 곳이 화면 2곳·엑셀 1곳으로 모두 셋이라, 한 곳만 고치면 또 어긋난다.
 * 그래서 이 파일의 다른 규칙들과 같은 이유로 여기 한 곳에 둔다.
 *
 * 같은 날 같은 사람이 일일마감에도 있고 수기에도 있으면 **둘 다 더한다** — 일지 탭이 그렇게 세고,
 * 세 곳이 같은 숫자를 보여주는 것이 먼저다. 중복이면 일지에서 지우는 것이 맞는 처리다.
 *
 * @param manualRows null 이면 "아직 못 읽었다"는 뜻이라 아무것도 더하지 않는다. 부르는 쪽이 그 상태를
 *                   반드시 사용자에게 알려야 한다 — 0으로 치고 넘어가면 조용한 누락으로 되돌아간다.
 * @param formatDay 출근일 표기를 부르는 쪽 형식에 맞춘다. 형식이 다르면 같은 날이 두 번 들어간다.
 */
export function mergeManualPartTimeWork(
  telemetry: Record<string, PartTimeWorkTelemetry>,
  manualRows: unknown,
  selectedMonth: string,
  formatDay: (settleDate: string) => string
): void {
  if (!Array.isArray(manualRows)) return;
  manualRows.forEach((row: any) => {
    const name = String(row?.staffName || "").trim();
    const hours = Number(row?.workHours || 0);
    const settleDate = String(row?.settleDate || "");
    if (!name || !(hours > 0) || settleDate.slice(0, 7) !== selectedMonth) return;
    const item = telemetry[name] || { hours: 0, dates: [] };
    item.hours += hours;
    const day = formatDay(settleDate);
    if (day && !item.dates.includes(day)) item.dates.push(day);
    telemetry[name] = item;
  });
}

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

// ─────────────────────────────────────────────────────────────────────────────
// 같은 사람이 두 줄이 되는 것을 막는 규칙 (2026-08-31 신설)
//
// 근무기록에 먼저 나타난 사람은 `legacy-<지점>-<이름>` 행으로 급여대장에 오른다. 그 사람이 나중에
// 직원명부에 등록되면 명부 id 로 새 행이 만들어지는데, 옛 legacy 행은 아무도 지우지 않았다.
// 저장 병합이 "서버엔 있고 화면엔 없는 행"을 다른 기기가 추가한 행으로 보고 되살려서, 칸 하나만
// 고쳐도 유령 행이 화면에 튀어나왔고 마감 엑셀에는 같은 사람이 두 줄로 나가 급여가 두 번 잡혔다.
//
// 규칙은 화면과 엑셀이 **같은 함수**를 쓴다. 각자 판단하면 한쪽만 고쳐 다시 어긋난다.
// 검증: scripts/check-parttime-dedupe.ts
// ─────────────────────────────────────────────────────────────────────────────

/** 흡수 규칙이 들여다보는 칸만. 화면 행 타입과 저장본의 느슨한 행을 모두 받는다. */
export interface PartTimeAbsorbableRow {
  employeeId: string;
  name: string;
  rosterName?: string;
  residentNumber?: string;
  entryDate?: string;
  contractStatus?: string;
  bank?: string;
  accountNumber?: string;
  hourlyRate?: string;
  accumulatedHours?: string;
  hoursOverridden?: boolean;
  autoAccumulatedHours?: string;
  attendanceOverridden?: boolean;
  tipsEtcAmount?: string;
  calculatedSalary?: string;
  attendanceDates?: string;
  actualPaidAmount?: string;
  payoutBranch?: string;
  memo?: string;
}

export const legacyPartTimeId = (branchName: string, name: string) => `legacy-${branchName}-${name}`;

const isLegacyId = (employeeId: unknown) => String(employeeId ?? "").startsWith("legacy-");
const isManualId = (employeeId: unknown) => String(employeeId ?? "").startsWith("manual-");
const trimmed = (value: unknown) => String(value ?? "").trim();
const isEmptyCell = (value: unknown) => trimmed(value) === "";

/**
 * legacy 행이 대신하고 있는 **근무기록상의 이름**. 이 지점 것이 아니면 null.
 *
 * 표시 이름(name)이 아니라 id 를 본다. 급여대장에서 이름을 고쳐 쓴 legacy 행이 있기 때문이다
 * (카츠스위스 2026-08: `legacy-카츠스위스-전지유` 행을 '이종현'으로 고쳐 씀). 표시 이름으로
 * 판정하면 그 행이 엉뚱한 사람의 것으로 취급돼, 흡수되면서 근무분이 통째로 사라진다.
 */
export function legacyPartTimeNameOf(employeeId: unknown, branchName: string): string | null {
  const id = String(employeeId ?? "");
  const prefix = `legacy-${branchName}-`;
  if (!id.startsWith(prefix)) return null;
  const name = id.slice(prefix.length).trim();
  return name || null;
}

/**
 * legacy 행이 갖고 있을 수 있는 **사람이 적은 값**. 자동으로 정해지는 값(누적시간·출근일·급여)은
 * 여기 없다 — 그건 흡수 대상이 아니라 언제나 지금 집계로 다시 정해지는 값이다.
 */
const ABSORBABLE_FIELDS = [
  "residentNumber", "entryDate", "bank", "accountNumber",
  "hourlyRate", "tipsEtcAmount", "payoutBranch", "memo"
] as const;

/**
 * **시급만** 0 도 빈칸으로 본다.
 *
 * 시급 0 은 언제나 "아직 안 적음"이다 — 0원짜리 시급은 없고, 비어 있으면 급여가 통째로 0원이 되는
 * 칸이라 화면에도 따로 경고가 뜬다. 그래서 legacy 행에 적힌 시급을 가져오는 편이 안전하다.
 *
 * 팁은 다르다. 0 이 "안 적음"인지 "없다고 적음"인지 구분할 표시가 없어서, 덮으면 **없는 팁이 급여에
 * 붙어 더 나간다**(Codex 4R 지적 2026-08-31). 실제 데이터에도 팁이 0보다 큰 행은 한 건도 없어
 * 가져올 이득이 없다. 그래서 팁은 칸이 완전히 비었을 때만(옛 저장본) 흡수한다.
 */
const MONEY_FIELDS = new Set<string>(["hourlyRate"]);
const isAbsorbTarget = (field: string, value: unknown) =>
  isEmptyCell(value) || (MONEY_FIELDS.has(field) && Number(value) === 0);

/**
 * 명부에 등록된 사람의 옛 `legacy-` 행을 명부 행에 흡수한다.
 *
 * 흡수는 **빈칸 채우기**다. 명부 행에 이미 값이 있으면 그대로 둔다 — 나중에 적은 값이 더 맞다.
 * 흡수하고 나면 legacy 행은 목록에서 뺀다(그 사람은 이제 명부 행 한 줄로 대표된다).
 *
 * **명부 행이 제외(X) 상태면 흡수하지 않는다.** 지점이 일부러 명부 행을 지우고 legacy 행으로 급여를
 * 주고 있는 경우가 있다(대물섬 한남점 2026-08). 거기서 흡수하면 남은 legacy 행까지 없어져
 * 그 사람 급여가 통째로 사라진다.
 *
 * 명부 행이 아예 없으면(수기 행만 있는 경우 포함) 지우지 않는다 — 지울 곳이 없으면 legacy 행이
 * 그 사람의 유일한 급여 행이다.
 */
export function absorbLegacyPartTimeRows<T extends PartTimeAbsorbableRow>(
  rows: T[],
  options: {
    branchName: string;
    /**
     * 직원명부 파트타이머의 이름 목록. **중복을 지운 Set 을 넘기면 안 된다** — 같은 이름이 두 번
     * 들어 있다는 사실이 곧 "이 이름은 흡수하면 안 된다"는 신호라서, Set 으로 바꾸는 순간 그 판정이
     * 조용히 죽는다. 배열만 받도록 타입을 좁혀 실수를 컴파일 단계에서 막는다.
     */
    rosterNames: readonly string[];
    excludedIds?: Iterable<string>;
  }
): T[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const excluded = new Set([...(options.excludedIds || [])].map((id) => String(id)));

  // **직원명부에 같은 이름이 둘 이상이면 그 이름은 흡수 대상에서 뺀다.**
  // 그 legacy 행이 둘 중 누구 것인지 알 방법이 없는데, 아무 쪽에나 붙이면 그 사람 계좌로 남의 급여가
  // 나간다. 판정은 **명부 이름 목록 자체**로 한다 — 화면에 남은 행으로만 세면, 동명이인 중 한쪽이
  // 제외(X)돼 목록에서 빠졌을 때 "이름이 하나뿐"으로 보여 다시 잘못 붙는다(Codex 정지리뷰 2026-08-31).
  const rosterNames = new Set<string>();
  const duplicatedRosterNames = new Set<string>();
  [...options.rosterNames].forEach((raw) => {
    const name = trimmed(raw);
    if (!name) return;
    if (rosterNames.has(name)) duplicatedRosterNames.add(name);
    rosterNames.add(name);
  });

  // 흡수받을 명부 행 — legacy 도 수기도 아니고, 제외되지 않은 행.
  // 목록 안에서도 같은 이름이 두 줄이면 마찬가지로 뺀다(명부에는 한 명인데 급여 행이 둘인 경우).
  // 손대지 않고 남겨 두면 중복 게이트가 잡아 사람이 정리한다 — 모를 때는 멈추는 쪽이 안전하다.
  const hostByName = new Map<string, T>();
  const ambiguousNames = new Set<string>(duplicatedRosterNames);
  rows.forEach((row) => {
    const id = String(row?.employeeId ?? "");
    if (!id || isLegacyId(id) || isManualId(id) || excluded.has(id)) return;
    const name = trimmed(row.rosterName || row.name);
    if (!name) return;
    if (hostByName.has(name)) ambiguousNames.add(name);
    else hostByName.set(name, row);
  });
  ambiguousNames.forEach((name) => hostByName.delete(name));

  const absorbedInto = new Map<string, T>();
  const dropped = new Set<string>();
  rows.forEach((row) => {
    const id = String(row?.employeeId ?? "");
    // 표시 이름이 아니라 id 로 판정한다 — 이름을 고쳐 쓴 legacy 행을 남의 행에 흡수시키지 않기 위해서다.
    const name = legacyPartTimeNameOf(id, options.branchName);
    if (!name || !rosterNames.has(name)) return; // 아직 명부에 없는 사람 — 이 행이 유일한 급여 행이다
    const host = hostByName.get(name);
    if (!host) return; // 명부 행이 없거나 제외됨 — 지울 곳이 없으니 그대로 둔다
    const merged = { ...(absorbedInto.get(String(host.employeeId)) || host) } as T;
    ABSORBABLE_FIELDS.forEach((field) => {
      if (isAbsorbTarget(field, merged[field]) && !isAbsorbTarget(field, row[field])) (merged as any)[field] = row[field];
    });
    // 사람이 직접 적은 근무시간·출근일은 집계로 다시 만들 수 없다 — 버리면 그대로 사라진다.
    // 명부 행이 이미 직접 적은 값을 갖고 있으면 그쪽이 이긴다(나중에 적은 값이 더 맞다).
    if (row.hoursOverridden === true && merged.hoursOverridden !== true) {
      merged.accumulatedHours = row.accumulatedHours;
      merged.hoursOverridden = true;
    }
    if (row.attendanceOverridden === true && merged.attendanceOverridden !== true) {
      merged.attendanceDates = row.attendanceDates;
      merged.attendanceOverridden = true;
    }
    // **급여를 반드시 다시 계산한다.** 시급·팁·시간이 흡수로 바뀌었는데 금액이 옛 값 그대로면,
    // 시급은 들어왔는데 급여가 0원인 행이 그대로 확정·이체로 나간다(Codex 정지리뷰 2026-08-31).
    merged.calculatedSalary = computePartTimeSalary(merged.hourlyRate, merged.accumulatedHours, merged.tipsEtcAmount);
    merged.actualPaidAmount = syncPartTimeActualPaid(merged.actualPaidAmount, merged.calculatedSalary);
    absorbedInto.set(String(host.employeeId), merged);
    dropped.add(id);
  });

  if (dropped.size === 0) return rows;
  return rows
    .filter((row) => !dropped.has(String(row?.employeeId ?? "")))
    .map((row) => absorbedInto.get(String(row?.employeeId ?? "")) || row);
}

/**
 * 명부 밖 행(수기 행·아직 흡수되지 않은 legacy 행)에 붙일 근무 집계.
 *
 * **표시 이름으로 찾으면 안 된다.** 그렇게 하면 수기로 추가한 행에 명부 인원과 같은 이름을 적었을 때
 * 그 사람의 근무기록이 이 행에도 붙어 급여가 한 번 더 계산된다. 화면에는 0원으로 보이는데 마감
 * 엑셀에서만 776,000원이 되는 식이라(사카바단단 2026-08 정서영) 아무도 알아채지 못한 채 두 번 나간다.
 *
 * 근무기록에서 온 행(legacy)만 집계를 받는다. 그 행이 대신하는 이름은 id 에 박혀 있다.
 * 수기 행은 근무기록에 출처가 없으므로 저장된 값 그대로 나간다.
 */
export function resolveExtraPartTimeWork(
  employeeId: string,
  branchName: string,
  telemetry: Record<string, PartTimeWorkTelemetry>
): PartTimeWorkTelemetry {
  const name = legacyPartTimeNameOf(employeeId, branchName);
  if (!name) return { hours: 0, dates: [] };
  return telemetry[name] || { hours: 0, dates: [] };
}

/**
 * 서버 행을 그대로 채택할 때, **자동으로 정해지는 값만 화면의 최신 집계로 되돌린다.**
 *
 * 서버 사본에는 그 대장을 마지막으로 연 순간의 누적시간·출근일이 굳어 있다(이 표는 열기만 해도
 * 저장된다). 그것을 그대로 화면에 채택하면 그 뒤 일한 시간이 사라진다 — 실제로 사카바단단에서
 * 48.5시간 일한 사람이 저장본의 0시간으로 덮여 '근무기록 없는 인원'으로 밀려났다(2026-08-31).
 *
 * 사람이 직접 정한 값(hoursOverridden / attendanceOverridden)은 어느 쪽 것이든 그대로 지킨다 —
 * 그건 집계로 다시 만들 수 없는 값이다.
 */
export function adoptFreshAutoValues<T extends PartTimeAbsorbableRow>(serverRow: T, localRow: T | undefined): T {
  if (!localRow) return serverRow;
  // 이 기기가 실제로 집계한 적이 있어야 그 값을 쓴다(autoAccumulatedHours = 집계의 흔적).
  // 근거 없는 값으로 서버를 덮으면 다른 기기가 올려 둔 근무시간이 줄어든다 — 그건 곧 급여 축소다.
  if (localRow.autoAccumulatedHours === undefined) return serverRow;
  const next = { ...serverRow };
  if (!serverRow.hoursOverridden && !localRow.hoursOverridden) {
    next.accumulatedHours = localRow.accumulatedHours;
    next.autoAccumulatedHours = localRow.autoAccumulatedHours;
  }
  if (!serverRow.attendanceOverridden && !localRow.attendanceOverridden) {
    next.attendanceDates = localRow.attendanceDates;
  }
  next.calculatedSalary = computePartTimeSalary(next.hourlyRate, next.accumulatedHours, next.tipsEtcAmount);
  next.actualPaidAmount = syncPartTimeActualPaid(next.actualPaidAmount, next.calculatedSalary);
  return next;
}
