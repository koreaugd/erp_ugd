// src/pages/admin/helpers/taxiWorkCheck.ts
// 관리자 > 일일업무 > 이상점검 — 지점 일일마감의 근무시간과 법인택시(카카오T) 이용시각을 맞대어
// '사람이 봐야 할 건'을 골라준다(사용자 지시 2026-10-12). 차단이 아니라 표식이다. 화면 없는 순수 계산만 둔다 —
// 규칙은 scripts/verify-taxi-work-check.mts 가 고정한다.
//
// [짝짓기] 택시 건 ↔ 마감 근무는 **직원 이름 + 날짜**로 맞춘다(사번=이름 관례). 퇴근이 자정을 넘는 근무
// (예: 11:00~01:00)가 흔하므로, 택시 시각 T 를 '마감일 D-1 과 D' 두 날의 근무 구간과 모두 비교해
// T 에 가장 가까운 근무를 고른다. 구간 안이면 거리 0, 밖이면 가까운 끝까지의 거리다.
//   - 새벽 00:30 택시 + 전날 11:00~01:00 근무 → 구간 안 → 전날 근무로 본다
//   - 오전 10:30 택시 + 당일 11:00~22:00 근무 → 30분 거리 → 당일 근무(출근길)로 본다
// MATCH_WINDOW_MIN 보다 멀면 '근무 기록 없음'이다.
//
// [지점] 택시 지점의 마감을 먼저 보고, 없으면 다른 지점 마감에서 같은 이름을 찾는다 — 지원 근무·본사 파견처럼
// 다른 지점 마감에 이름이 올라가는 경우가 있다. 그래서 다른 지점의 동명이인과 짝지어질 수 있다(화면에 근무지점을 밝힌다).
import type { NormalizedTaxiOrder } from "./kakaoTaxi";

export type WorkCheckReason = "beforeClockOut" | "commute" | "multiple" | "noWork" | "unverifiable";

export const WORK_CHECK_LABEL: Record<WorkCheckReason, string> = {
  beforeClockOut: "퇴근 전 탑승",
  commute: "출근길 이용",
  multiple: "하루 2회 이상 이용",
  noWork: "근무 기록 없는 날 이용",
  unverifiable: "확인 불가",
};

export const WORK_CHECK_THRESHOLDS = {
  /** 택시 시각과 근무 구간이 이만큼(분)보다 멀면 그 근무와 무관한 이용으로 본다 */
  matchWindowMin: 6 * 60,
  /** 퇴근 시각보다 이만큼(분) 넘게 먼저 타야 '퇴근 전 탑승' — 마감 정리·호출 대기 오차 허용 */
  beforeClockOutGraceMin: 10,
  /** 출근 시각 + 이만큼(분) 전에 탄 건은 '출근길 이용' */
  commuteAfterStartMin: 30,
  /** 이 시각(시) 전의 새벽 택시는 전날 근무일로 본다 — 근무를 못 찾았을 때 어느 날 마감을 볼지 정한다 */
  overnightCutoffHour: 6,
};

/**
 * '퇴근 전 탑승' 판정에서 빼는 지점(사용자 지시 2026-10-12 — 법인택시 이상 점검의 23:00~00:30 제외와 같은 두 지점).
 * 택시 지점(row.branchName — 지점 변경 이력·별칭까지 반영된 ERP 지점명) 기준이다. 다른 판정(근무 없음·2회 이상 등)은 그대로.
 * 화면 카드의 안내 문구도 이 목록을 그대로 쓴다.
 */
export const BEFORE_CLOCK_OUT_EXEMPT_BRANCHES: readonly string[] = ["사카바단단", "8번대물집"];

/** 마감 METADATA staffRows 의 필요한 필드만 */
export interface SettleStaffRow {
  name?: string;
  /** 동명이인 구분용 — 같은 날 같은 이름 행이 근무 분할(같은 사람)인지 다른 사람인지 가른다 */
  residentNumber?: string;
  staffName?: string;
  clockIn?: string;
  clockOut?: string;
  workHours?: number | string;
  officeWorkType?: string;
}

/** 한 지점·한 날의 마감. staffRows=null 이면 문서는 있으나 근무 상세가 없는 구형 마감이다. */
export interface SettleDay {
  branchName: string;
  settleDate: string;
  staffRows: SettleStaffRow[] | null;
}

export interface WorkShift {
  branchName: string;
  settleDate: string;
  name: string;
  /** 사람 구분 — 주민번호가 있으면 그것, 없으면 이름(이 경우 같은 날 동명이인은 구분 불가) */
  personId: string;
  clockIn: string;
  clockOut: string;
  /** 절대 분(일 번호 × 1440 + 분). 퇴근이 출근보다 이르거나 같으면 다음 날로 넘긴다. */
  start: number;
  end: number;
}

export interface WorkCheckResult {
  row: NormalizedTaxiOrder;
  /** 비교에 쓴 근무(없으면 null) */
  shift: WorkShift | null;
  /** 이 이용을 귀속한 근무일(근무를 찾았으면 그 마감일, 못 찾았으면 시각으로 정한 날) */
  workDate: string;
  reasons: WorkCheckReason[];
  /** 사람이 읽는 설명 — 사유마다 한 줄 */
  notes: Partial<Record<WorkCheckReason, string>>;
}

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" → 일 번호(UTC 기준 — 날짜 산술만 하므로 시간대 영향 없음). 형식이 틀리면 null */
export function dayIndex(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || "").trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(t)) return null;
  // Date.UTC 는 2026-02-31 을 03-03 으로 조용히 넘긴다 — 되돌려 비교해 없는 날짜는 거부한다(Codex 지적).
  const d = new Date(t);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() + 1 !== Number(m[2]) || d.getUTCDate() !== Number(m[3])) return null;
  return Math.round(t / DAY_MS);
}

export function dateFromIndex(index: number): string {
  const d = new Date(index * DAY_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** "HH:mm" → 분. 범위 밖·형식 오류는 null */
export function clockMinutes(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(text || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** "YYYY-MM-DD HH:mm(:ss)" → 절대 분. 파싱 불가면 null */
export function absoluteMinutes(timeText: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})/.exec(String(timeText || "").trim());
  if (!m) return null;
  const day = dayIndex(m[1]);
  const minute = clockMinutes(m[2]);
  return day === null || minute === null ? null : day * 1440 + minute;
}

const staffNameOf = (row: SettleStaffRow): string => String(row.staffName || row.name || "").trim();

/**
 * 마감들에서 근무 구간을 만든다. 휴무·근무시간 0·시각 누락 행은 근무가 아니다.
 * 같은 사람이 같은 날 여러 줄(근무 분할)이면 가장 이른 출근 ~ 가장 늦은 퇴근으로 합친다.
 */
export function buildShifts(settles: SettleDay[]): WorkShift[] {
  const merged = new Map<string, WorkShift>();
  for (const settle of settles) {
    const day = dayIndex(settle.settleDate);
    if (day === null || !settle.staffRows) continue;
    for (const staff of settle.staffRows) {
      const name = staffNameOf(staff);
      if (!name || staff.officeWorkType === "휴무" || !(Number(staff.workHours) > 0)) continue;
      const inMin = clockMinutes(staff.clockIn || "");
      const outMin = clockMinutes(staff.clockOut || "");
      if (inMin === null || outMin === null) continue;
      const start = day * 1440 + inMin;
      const end = day * 1440 + outMin + (outMin <= inMin ? 1440 : 0);
      // 근무 분할(같은 사람의 여러 줄)만 합친다. 주민번호가 다르면 동명이인이라 따로 둔다(Codex 지적).
      const personId = String(staff.residentNumber || "").trim() || `name:${name}`;
      const key = `${settle.branchName}|${settle.settleDate}|${personId}`;
      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, { branchName: settle.branchName, settleDate: settle.settleDate, name, personId, clockIn: staff.clockIn || "", clockOut: staff.clockOut || "", start, end });
      } else {
        if (start < prev.start) { prev.start = start; prev.clockIn = staff.clockIn || ""; }
        if (end > prev.end) { prev.end = end; prev.clockOut = staff.clockOut || ""; }
      }
    }
  }
  return Array.from(merged.values());
}

const distanceToShift = (t: number, shift: WorkShift): number =>
  t < shift.start ? shift.start - t : t > shift.end ? t - shift.end : 0;

/**
 * 택시 시각 T 에 귀속할 근무 — 택시 지점의 근무를 먼저, 없으면 다른 지점에서 찾는다.
 * [동명이인] 후보가 **서로 다른 사람**(지점 또는 주민번호가 다름)이면 누구 근무인지 알 수 없다 — 짐작해서
 * 고르면 남의 근무로 억울한 표식을 만든다. 그때는 'ambiguous' 를 돌려 확인 불가로 보낸다(Codex 지적).
 * 같은 사람의 전날·당일 근무 둘 중에서는 T 에 가까운 쪽을 고른다(자정 넘는 근무 처리).
 */
type ShiftMatch = { shift: WorkShift } | { ambiguous: true } | null;
function findShift(t: number, name: string, branchName: string, shiftsByName: Map<string, WorkShift[]>, window: number): ShiftMatch {
  const day = Math.floor(t / 1440);
  const candidates = (shiftsByName.get(name) || []).filter((s) => {
    const d = dayIndex(s.settleDate);
    return d !== null && (d === day || d === day - 1) && distanceToShift(t, s) <= window;
  });
  if (!candidates.length) return null;
  const sameBranch = candidates.filter((s) => s.branchName === branchName);
  const pool = sameBranch.length ? sameBranch : candidates;
  const people = new Set(pool.map((s) => `${s.branchName}|${s.personId}`));
  if (people.size > 1) return { ambiguous: true };
  return { shift: pool.reduce((best, s) => (distanceToShift(t, s) < distanceToShift(t, best) ? s : best)) };
}

const fmtGap = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? (m > 0 ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`;
};

export interface WorkCheckInput {
  /** 퀵·택배·점검 제외 직원은 호출부가 걸러서 넘긴다 */
  rows: NormalizedTaxiOrder[];
  settles: SettleDay[];
  /** 마감을 **읽지 못한** 지점 — 그 지점 건은 '근무 기록 없음'이 아니라 확인 불가로 보낸다 */
  failedBranches?: Set<string>;
  /**
   * 마감을 읽으려 한 지점 전체(성공·실패 모두). 주면 여기 없는 지점(지점 변경 이력상 옛 지점·휴업 지점 등)의
   * 택시 건은 짝짓기 전에 확인 불가로 보낸다 — 그 지점 마감을 안 읽었으니 다른 지점 동명 근무와 짝지으면 안 된다.
   */
  loadedBranches?: Set<string>;
}

export function checkTaxiAgainstWork({ rows, settles, failedBranches = new Set(), loadedBranches }: WorkCheckInput): WorkCheckResult[] {
  const th = WORK_CHECK_THRESHOLDS;
  const shifts = buildShifts(settles);
  const shiftsByName = new Map<string, WorkShift[]>();
  for (const s of shifts) shiftsByName.set(s.name, [...(shiftsByName.get(s.name) || []), s]);
  // 제출된 마감(지점|날짜)과, 마감 명단에 한 번이라도 오른 이름(휴무 포함) — 이름 불일치 판정용.
  const submitted = new Map<string, SettleDay>();
  const allNames = new Set<string>();
  for (const settle of settles) {
    submitted.set(`${settle.branchName}|${settle.settleDate}`, settle);
    for (const staff of settle.staffRows || []) {
      const name = staffNameOf(staff);
      if (name) allNames.add(name);
    }
  }

  const results: WorkCheckResult[] = [];
  for (const row of rows) {
    const name = String(row.order.member_name || "").trim();
    const t = absoluteMinutes(row.timeText);
    const result: WorkCheckResult = { row, shift: null, workDate: String(row.timeText || "").slice(0, 10), reasons: [], notes: {} };
    results.push(result);
    if (t === null) {
      result.reasons.push("unverifiable");
      result.notes.unverifiable = "이용 시각을 읽을 수 없음";
      continue;
    }
    // 근무를 못 찾았을 때 볼 마감일 — 새벽 건은 전날 근무의 퇴근길일 가능성이 높다.
    const calendarDay = Math.floor(t / 1440);
    const fallbackDate = dateFromIndex((t % 1440) < th.overnightCutoffHour * 60 ? calendarDay - 1 : calendarDay);
    result.workDate = fallbackDate;

    // 지점을 모르거나 그 지점 마감을 읽지 않았으면 짝짓기 전에 멈춘다(아래 실패 가드와 같은 이유, Codex 지적).
    if (row.unmapped) {
      result.reasons.push("unverifiable");
      result.notes.unverifiable = "택시 지점을 ERP 지점으로 확정하지 못함";
      continue;
    }
    if (loadedBranches && !loadedBranches.has(row.branchName)) {
      result.reasons.push("unverifiable");
      result.notes.unverifiable = `${row.branchName} 마감은 조회 대상이 아님(옛 지점·휴업 지점 등)`;
      continue;
    }
    // 택시 지점의 마감을 못 읽었으면 짝짓기 전에 멈춘다 — 본인 근무가 그 지점 마감에 있었을 수 있는데
    // 다른 지점의 같은 이름 근무와 짝지으면 실패가 정상 판정으로 둔갑한다(Codex 지적).
    if (failedBranches.has(row.branchName)) {
      result.reasons.push("unverifiable");
      result.notes.unverifiable = "이 지점 마감을 불러오지 못함";
      continue;
    }
    const match = name ? findShift(t, name, row.branchName, shiftsByName, th.matchWindowMin) : null;
    if (match && "ambiguous" in match) {
      result.reasons.push("unverifiable");
      result.notes.unverifiable = `같은 이름 '${name}' 근무자가 여러 명이라 누구 근무인지 알 수 없음`;
      continue;
    }
    const shift = match && "shift" in match ? match.shift : null;
    if (shift) {
      result.shift = shift;
      result.workDate = shift.settleDate;
      if (t < shift.start + th.commuteAfterStartMin) {
        result.reasons.push("commute");
        result.notes.commute = t < shift.start
          ? `출근 ${shift.clockIn} 보다 ${fmtGap(shift.start - t)} 전에 탑승`
          : `출근 ${shift.clockIn} 직후(${fmtGap(t - shift.start)}) 탑승`;
      } else if (t < shift.end - th.beforeClockOutGraceMin && !BEFORE_CLOCK_OUT_EXEMPT_BRANCHES.includes(row.branchName)) {
        result.reasons.push("beforeClockOut");
        result.notes.beforeClockOut = `퇴근 ${shift.clockOut} 보다 ${fmtGap(shift.end - t)} 먼저 탑승`;
      }
      continue;
    }

    // 근무를 못 찾음 — 비교 자체가 가능한지부터 가른다. 불가능한 건을 '근무 없음'으로 몰면 억울한 표식이 된다.
    const settle = submitted.get(`${row.branchName}|${fallbackDate}`);
    if (!settle) {
      result.reasons.push("unverifiable");
      result.notes.unverifiable = `${fallbackDate} ${row.branchName} 마감 미제출`;
      continue;
    }
    if (!settle.staffRows) {
      result.reasons.push("unverifiable");
      result.notes.unverifiable = `${fallbackDate} 마감에 근무 상세가 없음(구형 마감)`;
      continue;
    }
    // 이번에 읽은 어느 지점 마감에도 한 번도 오르지 않은 이름이면 '근무 안 함'이 아니라 표기 불일치일 가능성이 크다.
    if (!name || !allNames.has(name)) {
      result.reasons.push("unverifiable");
      result.notes.unverifiable = `마감 명단에 '${name || "(이름 없음)"}' 이 없음 — 이름 표기가 다를 수 있음`;
      continue;
    }
    const sameDayRow = settle.staffRows.find((staff) => staffNameOf(staff) === name);
    result.reasons.push("noWork");
    result.notes.noWork = sameDayRow && (sameDayRow.officeWorkType === "휴무" || !(Number(sameDayRow.workHours) > 0))
      ? `${fallbackDate} 마감에 휴무로 기록됨`
      : `${fallbackDate} 앞뒤 근무 기록이 없음`;
  }

  // 하루 2회 이상 — 같은 사람(계정 포함 키)·같은 근무일. 다른 사유와 겹칠 수 있다.
  const byDay = new Map<string, WorkCheckResult[]>();
  for (const r of results) {
    const key = `${r.row.memberKey}|${r.workDate}`;
    byDay.set(key, [...(byDay.get(key) || []), r]);
  }
  for (const group of byDay.values()) {
    if (group.length < 2) continue;
    for (const r of group) {
      r.reasons.push("multiple");
      r.notes.multiple = `${r.workDate} 하루 ${group.length}회 이용`;
    }
  }
  return results;
}

/** 사유별 카드 분배 — 한 건이 여러 사유면 카드마다 나온다. 카드 안은 최근 이용이 위로. */
export function groupWorkCheckByReason(results: WorkCheckResult[]): Record<WorkCheckReason, WorkCheckResult[]> {
  const groups: Record<WorkCheckReason, WorkCheckResult[]> = { beforeClockOut: [], commute: [], multiple: [], noWork: [], unverifiable: [] };
  for (const r of results) for (const reason of r.reasons) groups[reason].push(r);
  for (const list of Object.values(groups)) list.sort((a, b) => String(b.row.timeText).localeCompare(String(a.row.timeText)));
  return groups;
}
