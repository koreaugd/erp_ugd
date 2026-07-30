// src/pages/branch/tabs/MonthlyPartTimeSalarySubTab.tsx  (BranchConfirmPage에서 분리 — 동작 변경 없음)
import { useState, useEffect, useCallback, useRef } from "react";
import { Check, Plus, RotateCcw, X } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import { SheetKeyHint } from "../../../components/SheetKeyHint";
import { formatNumber } from "../../../utils/formatNumber";
import { cleanNumeric, formatWithCommas, toDateInputValue } from "../helpers/formatters";
import { pendingLocalSaveStorageKey } from "../helpers/staffHelpers";
import { useSheetKeyboardNav } from "../helpers/useSheetKeyboardNav";
// 저장값 vs 일일마감 집계 판정은 마감 엑셀과 같은 규칙을 써야 한다(어긋나면 곧 급여 누락이다).
import {
  PART_TIME_ATTENDANCE_MAX,
  computePartTimeSalary,
  resolvePartTimeAccumulatedHours,
  resolvePartTimeAttendanceDates,
  syncPartTimeActualPaid
} from "../helpers/partTimeSalaryRules";

// 표에 보이는 순서 그대로의 셀 좌표. 기본급여(8)는 자동 계산이라 커서가 서지 않는다.
// 성명(0)은 수기로 추가한 행에서만 입력 칸이다 — 자동으로 만들어진 행의 이름은 직원명부에서 오므로 고칠 수 없다.
const COL_NAME = 0;
const COL_RESIDENT = 1;
const COL_ENTRY_DATE = 2;
const COL_BANK = 3;
const COL_ACCOUNT = 4;
const COL_HOURLY_RATE = 5;
const COL_HOURS = 6;
const COL_TIPS = 7;
const COL_ATTENDANCE = 9;
const COL_MEMO = 10;
const PARTTIME_COL_COUNT = 11;

// 수기로 추가한 행.
//
// 이 표의 행은 직원명부의 파트타이머와 일일마감의 근무기록에서 매번 다시 만들어진다.
// 수기 행은 그 두 곳 어디에도 없는 사람이라, 다시 만들 때 목록에 직접 붙여 주지 않으면 통째로 사라진다.
// id로 구분한다 — 자동으로 만들어진 행의 id는 직원명부의 사원 id다.
const MANUAL_ID_PREFIX = "manual-";
const isManualRow = (row: { employeeId: string }) => row.employeeId.startsWith(MANUAL_ID_PREFIX);

/** 두 번 눌러도 같은 순간이면 id가 겹친다. 겹치면 React 키·수정·삭제가 두 행을 한 행으로 본다. */
const newManualId = () =>
  `${MANUAL_ID_PREFIX}${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;

/**
 * 새로 받아온 목록으로 갈아치우되, 그 안에 없는 수기 행은 지켜서 얹는다.
 *
 * 목록을 통째로 setSalaries 하는 자리가 여럿인데(조립·저장본 로드·원격 병합), 그때마다 수기 행이 지워진다.
 * 특히 저장본을 불러오는 중에 "수기 추가"를 누르면, 뒤늦게 도착한 옛 응답이 방금 만든 행을 삼킨다.
 */
/**
 * 저장본에서 불러온 행을, 화면이 이미 알고 있는 같은 사람의 행과 맞춘다.
 *
 * 저장본에는 **대장을 열어 둔 그 시점**의 누적시간·출근일·급여가 굳어 있다(이 표는 열기만 해도
 * 자동저장된다). 그대로 화면에 얹으면 그 뒤 일한 시간이 사라진다 — 방금 12시간으로 집계해 둔 행이
 * 저장본의 5시간으로 되돌아간다. 마감 엑셀은 12시간으로 계산하므로 화면과 엑셀 금액까지 갈린다.
 *
 * 그래서 **사람이 적은 값만 저장본에서 가져오고, 자동으로 정해지는 값은 화면이 방금 집계한 값**을 쓴다.
 * 저장본 쪽에 "직접 적었다"는 표시가 있으면 그건 사람이 정한 값이므로 그대로 둔다(다른 기기에서 적었을 수 있다).
 */
const reconcileLoadedRow = (incoming: PartTimeSalaryRow, known: PartTimeSalaryRow | undefined): PartTimeSalaryRow => {
  if (!known) return incoming;
  const merged: PartTimeSalaryRow = { ...incoming };

  // 명부 이름은 저장본에 없을 수 있다(그 칸이 생기기 전 저장본). 없으면 화면이 알던 값을 물려준다.
  // 없으면 이름을 고친 행에서 명부 이름이 사라져, 그 이름으로 수기 추가할 때 중복 경고가
  // 뜨지 않고 한 사람이 두 줄이 된다(급여 이중 지급).
  if (!merged.rosterName && known.rosterName) merged.rosterName = known.rosterName;
  if (!merged.edited && known.edited) merged.edited = true;
  if (known.autoAccumulatedHours !== undefined) merged.autoAccumulatedHours = known.autoAccumulatedHours;

  // 누적시간. **"표시가 없다(undefined)"와 "직접 적은 값 아님(false)"을 구분해야 한다.**
  //  · undefined = 이 표시를 모르는 옛 형식 저장본 → 화면이 이미 규칙대로 정해 둔 값을 물려준다.
  //  · false = 저장본이 분명히 "자동값"이라고 말한다(다른 기기에서 되돌리기를 눌렀을 수 있다)
  //    → 이 기기에 남아 있던 옛 수기값을 되살리지 않고 방금 집계한 자동값을 쓴다.
  //    구분하지 않으면 다른 기기가 되돌려 놓은 것이 이 기기의 옛 캐시로 되살아나고,
  //    아무 칸이나 고치는 순간 그 되살아난 값이 서버로 다시 올라가 상대의 수정이 지워진다.
  //  · true = 사람이 정한 값이므로 저장본 값을 그대로 둔다.
  if (merged.hoursOverridden === undefined) {
    merged.accumulatedHours = known.accumulatedHours;
    merged.hoursOverridden = known.hoursOverridden;
  } else if (merged.hoursOverridden === false && known.autoAccumulatedHours !== undefined) {
    merged.accumulatedHours = known.autoAccumulatedHours;
  }

  // 출근일도 같은 구분. 자동 목록은 따로 보관하지 않으므로, 양쪽 다 "자동"일 때만 화면 목록이 더 새롭다고 본다.
  if (merged.attendanceOverridden === undefined) {
    merged.attendanceDates = known.attendanceDates;
    merged.attendanceOverridden = known.attendanceOverridden;
  } else if (merged.attendanceOverridden === false && !known.attendanceOverridden) {
    merged.attendanceDates = known.attendanceDates;
  }
  // 최대 7개 규칙은 저장본에서 받은 값에도 적용한다(2026-07-31 규칙이 생기기 전 저장본에는 8개 이상이 있다).
  // 여기서 안 자르면 화면·저장본에는 8개가 남는데 마감 엑셀은 7개만 내보내 서로 어긋난다.
  merged.attendanceDates = resolvePartTimeAttendanceDates(
    { attendanceDates: merged.attendanceDates, attendanceOverridden: true },
    []
  );

  // 금액은 위에서 정해진 시간으로 다시 계산한다 — 저장본의 옛 금액이 남으면 시간과 금액이 어긋난다.
  merged.calculatedSalary = computePartTimeSalary(merged.hourlyRate, merged.accumulatedHours, merged.tipsEtcAmount);
  merged.actualPaidAmount = syncPartTimeActualPaid(merged.actualPaidAmount, merged.calculatedSalary);
  return merged;
};

/**
 * **사람이 정한 값만** 모은 비교용 문자열.
 *
 * "이 행이 마지막으로 서버에 올린 뒤에 이 기기에서 바뀌었나"를 판단할 때 쓴다.
 * 그래서 **자동으로 정해지는 값은 절대 넣으면 안 된다.** 넣으면 근무기록이 하나 올라온 것만으로
 * 손대지도 않은 행이 "내가 고친 행"으로 잡혀, 그 행에 대한 다른 기기의 수정을 덮어 버린다.
 *
 * 빼는 값: 급여·실수령액(시급×시간+팁으로 자동 계산), 자동집계시간, edited/rosterName(표시용).
 * 누적시간·출근일은 **직접 적은 값일 때만** 넣는다 — 손대지 않은 행에서는 집계를 따라 저절로 바뀐다.
 * 칸 순서를 고정해 두 저장본을 안전하게 견준다.
 */
/**
 * Firestore로 보낼 수 있는 형태로 다듬는다.
 *
 * 이 표의 행에는 "값이 없을 수 있는 칸"이 여럿이다(hoursOverridden·attendanceOverridden·edited·
 * nameOverride·rosterName…). 행을 다시 만들 때 `saved.hoursOverridden`처럼 그대로 옮겨 적으면
 * 저장본이 없는 사람에게는 그 칸이 **undefined로 채워진다.**
 *
 * Firestore는 undefined가 **하나라도** 섞이면 저장 요청 전체를 거부한다. 그러면 그 지점의
 * 급여대장이 통째로 저장되지 않고 "자동저장 실패"만 뜬다 — 적어 둔 값이 서버에 하나도 안 올라간다.
 * JSON 왕복은 그런 칸을 조용히 없애 준다(정직원 급여대장도 같은 방식으로 걷어낸다).
 */
const toStorableRows = (rows: PartTimeSalaryRow[]): PartTimeSalaryRow[] => JSON.parse(JSON.stringify(rows ?? []));

const rowFingerprint = (row: PartTimeSalaryRow) => JSON.stringify([
  row.name ?? "", row.nameOverride ?? "", row.residentNumber ?? "", row.entryDate ?? "",
  row.contractStatus ?? "", row.bank ?? "", row.accountNumber ?? "", row.hourlyRate ?? "",
  row.tipsEtcAmount ?? "", row.payoutBranch ?? "", row.memo ?? "",
  row.hoursOverridden === true,
  row.hoursOverridden === true ? (row.accumulatedHours ?? "") : "",
  row.attendanceOverridden === true,
  row.attendanceOverridden === true ? (row.attendanceDates ?? "") : ""
]);

/**
 * 아직 서버에 못 올린 이 기기의 편집분을, 서버 저장본 **위에 얹어서** 올릴 목록을 만든다.
 *
 * 예전에는 로컬을 통째로 올렸다. 그러면 그 사이 다른 기기가 고쳐 둔 것이 통째로 지워진다 —
 * 저쪽에서 '되돌리기'를 눌러 자동값으로 맞춰 놓은 행이, 이쪽 캐시에 남아 있던 옛 수기값으로 되돌아간다.
 * 그렇다고 서버 것만 쓰면 이 기기가 적어 둔 값이 사라진다(그걸 지키려고 pending 표시가 있는 것이다).
 *
 * 그래서 **마지막으로 서버에 올린 값과 달라진 행만** 덮고, 나머지는 서버 것을 그대로 둔다.
 * "한 번이라도 손댄 행(edited)"으로 판단하면 안 된다 — 그 표시는 지워지지 않아서, 지난주에 고치고
 * 이미 올려 둔 행까지 "내 것이 맞다"며 상대의 새 수정을 덮어 버린다.
 * 기준값이 없으면(옛 버전에서 넘어온 캐시) 그때만 edited로 판단한다.
 *
 * 서버를 못 읽었으면(오프라인 등) 종전처럼 로컬을 올린다 — 편집분을 잃지 않는 쪽이 먼저다.
 */
const mergePendingLocalRows = (
  localRows: PartTimeSalaryRow[],
  serverRows: PartTimeSalaryRow[] | null,
  syncedById: Map<string, PartTimeSalaryRow>
): PartTimeSalaryRow[] => {
  if (!serverRows) return localRows;
  const remainingLocal = new Map(localRows.map((row) => [row.employeeId, row]));
  const merged: PartTimeSalaryRow[] = [];
  serverRows.forEach((serverRow) => {
    const localRow = remainingLocal.get(serverRow.employeeId);
    remainingLocal.delete(serverRow.employeeId);
    if (!localRow) {
      // 로컬에 없는 행 — 이 기기가 지운 것인가, 다른 기기가 새로 만든 것인가?
      // 기준값에 있었다면 이 기기가 갖고 있다가 지운 것이다. 수기 행 삭제는 제외 목록에 남지 않으므로
      // (자동 행과 달리 다시 만들어질 곳이 없어 목록에서 빼는 것으로 끝난다) 여기서 판단해야 한다.
      // 그러지 않으면 지운 수기 행이 다음 재시도 때 되살아나 급여가 한 번 더 나간다.
      if (isManualRow(serverRow) && syncedById.has(serverRow.employeeId)) return;
      merged.push(serverRow);
      return;
    }
    const synced = syncedById.get(serverRow.employeeId);
    const changedHere = synced
      ? rowFingerprint(localRow) !== rowFingerprint(synced)
      : localRow.edited === true;
    merged.push(changedHere ? localRow : serverRow);
  });
  // 서버에 없는 행(이 기기에서 새로 만든 수기 행 등)은 뒤에 붙여 살린다.
  return [...merged, ...remainingLocal.values()];
};

const mergeKeepingManualRows = (
  incoming: PartTimeSalaryRow[],
  current: PartTimeSalaryRow[],
  excluded: Set<string>
): PartTimeSalaryRow[] => {
  const incomingIds = new Set(incoming.map((row) => row.employeeId));
  const currentById = new Map(current.map((row) => [row.employeeId, row]));
  const reconciled = incoming.map((row) => reconcileLoadedRow(row, currentById.get(row.employeeId)));
  const keptManualRows = current.filter(
    (row) => isManualRow(row) && !incomingIds.has(row.employeeId) && !excluded.has(row.employeeId)
  );
  return [...reconciled, ...keptManualRows];
};

/**
 * 이름이 적힌 행인가.
 *
 * 이름 없는 행은 마감 엑셀에서 빠진다(monthlyCloseWorkbook.ts에서 걸러 낸다).
 * 돈이 나가는 표라 이름 없는 사람을 올릴 수는 없기 때문이다. 다만 그 사실을 조용히 두면
 * 적어 뒀다고 믿고 마감해 버리므로, 이 함수로 세어 화면에 경고를 띄운다.
 *
 * 저장은 막지 않는다. 이름을 적기 전에 은행·계좌부터 적어 두는 사람이 있는데,
 * 저장에서 빼 버리면 그렇게 적은 값이 새로고침 한 번에 사라진다.
 */
const hasName = (row: PartTimeSalaryRow) => row.name.trim() !== "";

/**
 * 누적시간을 사람이 직접 정한 행인가.
 *
 * 이 표는 일일마감 근무기록으로 누적시간을 채워 준다. 그런데 말일 낮에 급여대장을 쓰는 동안에는
 * 그날 저녁 근무가 아직 기록되기 전이라, 예상 시간을 사람이 직접 적어야 한다.
 * 직접 적었다는 사실을 남겨 두지 않으면 두 가지가 깨진다.
 *   1) 시간을 지워 다시 적으려는 순간 0시간이 되어 행이 화면에서 사라진다.
 *   2) 빈 값이 "아직 안 정한 값"으로 읽혀, 재조립 때 일일마감 집계로 되채워진다.
 *      그 사이 같은 사람을 수기로 추가해 두었다면 한 사람이 두 줄이 된다(= 급여 이중 지급).
 */
const isHoursOverridden = (row: PartTimeSalaryRow) => row.hoursOverridden === true;

/**
 * 화면에서 감추지 않을 행인가.
 *
 * 0시간이라고 무조건 감추면 안 된다. 마감 엑셀은 0시간 행도 그대로 내보내기 때문에,
 * 사람이 뭔가 적어 둔 행(팁·계좌 등)을 화면에서만 감추면 **화면에 없는데 돈은 나가는 행**이 된다.
 * 그래서 한 칸이라도 손댄 행은 남긴다.
 */
const isAlwaysVisibleRow = (row: PartTimeSalaryRow) =>
  Number(row.accumulatedHours) > 0 || isManualRow(row) || isHoursOverridden(row) || row.edited === true;

/** 이름 비교용. "홍 길동"과 "홍길동"을 같은 사람으로 본다(수기 추가 중복 경고에서만 쓴다). */
const normalizedName = (name: string) => String(name || "").replace(/\s+/g, "");

/**
 * 한 행이 가진 이름을 모두 모은다.
 *
 * 급여대장에서 이름을 고친 행(nameOverride)은 화면에 고친 이름만 보이고 명부 이름은 남지 않는다.
 * 그래서 명부 이름으로 수기 추가를 시도하면 중복 경고가 뜨지 않고 같은 사람이 두 줄이 된다
 * (엑셀·이체 리스트에도 두 줄로 나가 급여가 두 번 빠진다).
 */
const allNamesOf = (row: PartTimeSalaryRow) =>
  [row.name, row.nameOverride, row.rosterName].map(normalizedName).filter(Boolean);

interface PartTimeSalaryRow {
  employeeId: string;
  name: string;
  /**
   * 급여대장에서만 쓰는 이름. 사용자가 이 표에서 이름을 직접 고쳤을 때만 담긴다.
   *
   * 이 표의 행은 직원명부에서 매번 다시 만들어지므로, 고친 이름을 name에만 넣어두면
   * 다음 재생성 때 명부 이름으로 소리 없이 되돌아간다. 그래서 "직접 고쳤다"는 사실을 따로 남긴다.
   *
   * 명부 이름을 바꾸지는 않는다 — 누적근무시간·출근일 집계가 명부 이름으로 일일마감 기록을 찾기 때문에
   * 명부 이름을 바꾸면 과거 기록과 안 맞아 그 사람 집계가 0이 된다.
   * (통장 예금주 실명이 명부의 이름과 다를 때 이 칸을 쓴다.)
   *
   * 비우면 다시 명부 이름을 따라간다.
   */
  nameOverride?: string;
  /** 직원명부에 적힌 원래 이름. 이름을 고친 행에서도 중복 추가를 잡아내려고 남긴다(수기 행은 없다). */
  rosterName?: string;
  /**
   * 사람이 이 행의 칸을 하나라도 고쳤는가.
   *
   * 0시간 행을 화면에서 감추는 규칙 때문에 필요하다. 팁·계좌만 적어 둔 0시간 행을 감춰 버리면
   * 마감 엑셀에는 나가는데 화면에는 없는 행이 되어, 확인할 길 없이 돈이 나간다.
   */
  edited?: boolean;
  residentNumber: string;
  entryDate: string;
  contractStatus: "완료" | "미작성";
  bank: string;
  accountNumber: string;
  hourlyRate: string;
  accumulatedHours: string;
  /**
   * 누적시간을 사람이 직접 적었는가. isHoursOverridden 설명 참고.
   *
   * 켜지면 그 행의 누적시간은 일일마감 집계로 다시 덮이지 않고, 값이 0이거나 비어 있어도 화면에 남는다.
   * (옛 저장본에는 이 값이 없다 — 없으면 지금까지와 똑같이 동작한다.)
   */
  hoursOverridden?: boolean;
  /** 일일마감에서 집계한 원래 시간. 직접 적은 값을 되돌릴 때 쓴다(수기 행은 출처가 없어 비어 있다). */
  autoAccumulatedHours?: string;
  /** 출근일을 사람이 직접 적었는가. 누적시간과 같은 규칙(직접 적은 값만 지키고 나머지는 집계를 따름). */
  attendanceOverridden?: boolean;
  tipsEtcAmount: string;
  calculatedSalary: string;
  attendanceDates: string;
  actualPaidAmount: string;
  payoutBranch: string;
  memo: string;
}

export function MonthlyPartTimeSalarySubTab({
  branchName,
  selectedMonth,
  history,
  triggerToast
}: {
  branchName: string;
  selectedMonth: string;
  history: any[];
  triggerToast: (msg: string, type?: "success" | "error") => void;
}) {
  const [salaries, setSalaries] = useState<PartTimeSalaryRow[]>([]);
  const [excludedEmployeeIds, setExcludedEmployeeIds] = useState<string[]>([]);
  // 이번 달 근무기록이 아직 없는 인원까지 펼쳐 본다.
  // 말일 낮에 급여대장을 쓰면 그날 저녁 근무가 아직 안 올라와 0시간인 사람이 있는데,
  // 그 행이 안 보이면 예상 시간을 적을 길이 없어 수기 행을 만들게 되고 결국 한 사람이 두 줄이 된다.
  const [showZeroHourRows, setShowZeroHourRows] = useState(false);
  const salaryAutoSaveTimerRef = useRef<number | null>(null);

  const salaryStorageKey = `erp_monthly_part_time_salary_${branchName}_${selectedMonth}`;
  const salaryDataKey = `part_time_salaries:${branchName}:${selectedMonth}`;
  const exclusionStorageKey = `erp_monthly_part_time_exclusions_${branchName}_${selectedMonth}`;
  const exclusionDataKey = `part_time_salary_exclusions:${branchName}:${selectedMonth}`;
  const salaryPendingKey = pendingLocalSaveStorageKey(salaryStorageKey);
  const exclusionPendingKey = pendingLocalSaveStorageKey(exclusionStorageKey);
  // 마지막으로 서버에 올리는 데 성공한 값. 못 올린 편집분을 다시 올릴 때
  // "이 기기에서 정말 바뀐 행"만 골라내는 기준으로 쓴다(mergePendingLocalRows).
  const salarySyncedKey = `${salaryStorageKey}_synced`;
  const readSyncedRows = useCallback(() => {
    try {
      const raw = localStorage.getItem(salarySyncedKey);
      const parsed = raw ? JSON.parse(raw) : null;
      return new Map<string, PartTimeSalaryRow>(
        Array.isArray(parsed) ? parsed.map((row: PartTimeSalaryRow) => [row.employeeId, row]) : []
      );
    } catch {
      return new Map<string, PartTimeSalaryRow>();
    }
  }, [salarySyncedKey]);

  const buildPartTimeProfiles = useCallback((sourceSalaries: PartTimeSalaryRow[]) => {
    return sourceSalaries.reduce((result: Record<string, any>, sal) => {
      result[sal.employeeId] = {
        residentNumber: sal.residentNumber,
        entryDate: sal.entryDate,
        contractStatus: sal.contractStatus,
        bank: sal.bank,
        accountNumber: sal.accountNumber,
        hourlyRate: sal.hourlyRate
      };
      return result;
    }, {});
  }, []);

  const persistPartTimeSalaries = useCallback((nextSalaries: PartTimeSalaryRow[], nextExcluded = excludedEmployeeIds, showToast = false) => {
    setSalaries(nextSalaries);
    nextSalaries.forEach((sal) => {
      localStorage.setItem(`erp_pt_profile_${branchName}_${sal.employeeId}`, JSON.stringify({
        residentNumber: sal.residentNumber,
        entryDate: sal.entryDate,
        contractStatus: sal.contractStatus,
        bank: sal.bank,
        accountNumber: sal.accountNumber,
        hourlyRate: sal.hourlyRate
      }));
    });
    localStorage.setItem(salaryStorageKey, JSON.stringify(nextSalaries));
    localStorage.setItem(exclusionStorageKey, JSON.stringify(nextExcluded));
    localStorage.setItem(salaryPendingKey, "1");
    localStorage.setItem(exclusionPendingKey, "1");
    if (salaryAutoSaveTimerRef.current) window.clearTimeout(salaryAutoSaveTimerRef.current);
    salaryAutoSaveTimerRef.current = window.setTimeout(() => {
      // toStorableRows: 값이 없는 칸(undefined)을 걷어낸다. 하나라도 섞이면 Firestore가 저장을 통째로 거부한다.
      const storableSalaries = toStorableRows(nextSalaries);
      Promise.all([
        gasClient.saveSharedData(salaryDataKey, storableSalaries),
        gasClient.saveSharedData(`part_time_profiles:${branchName}`, buildPartTimeProfiles(storableSalaries)),
        gasClient.saveSharedData(exclusionDataKey, nextExcluded)
      ])
        .then(() => {
          localStorage.removeItem(salaryPendingKey);
          localStorage.removeItem(exclusionPendingKey);
          // 방금 올린 값을 기준값으로 남긴다 — 다음에 못 올린 편집분을 다시 올릴 때
          // "이 기기에서 정말 바뀐 행"만 골라 상대의 수정을 덮지 않기 위해서다.
          localStorage.setItem(salarySyncedKey, JSON.stringify(nextSalaries));
          if (showToast) triggerToast("파트타이머 급여대장이 저장되었습니다.", "success");
        })
        .catch(() => triggerToast("급여지급 대장 자동저장 실패", "error"));
    }, 500);
  }, [branchName, buildPartTimeProfiles, excludedEmployeeIds, exclusionDataKey, exclusionPendingKey, exclusionStorageKey, salaryDataKey, salaryPendingKey, salaryStorageKey, salarySyncedKey, triggerToast]);

  useEffect(() => {
    return () => {
      if (salaryAutoSaveTimerRef.current) {
        window.clearTimeout(salaryAutoSaveTimerRef.current);
        salaryAutoSaveTimerRef.current = null;
      }
      const salaryPending = localStorage.getItem(salaryPendingKey) === "1";
      const exclusionPending = localStorage.getItem(exclusionPendingKey) === "1";
      if (!salaryPending && !exclusionPending) return;

      const savedSalaries = localStorage.getItem(salaryStorageKey);
      const savedExclusions = localStorage.getItem(exclusionStorageKey);
      try {
        const pendingSalaries = savedSalaries ? JSON.parse(savedSalaries) : [];
        const pendingExclusions = savedExclusions ? JSON.parse(savedExclusions) : [];
        const saveTasks: Promise<unknown>[] = [];
        if (salaryPending && Array.isArray(pendingSalaries)) {
          // 탭을 옮기며 올릴 때도 통째로 덮으면 그 사이 다른 기기가 고쳐 둔 것이 지워진다.
          // 올리기 전에 서버를 읽어 **이 기기에서 실제로 바뀐 행만** 얹는다(자동저장 경로와 같은 규칙).
          // 서버를 못 읽으면 로컬을 올린다 — 아직 못 올린 편집분을 잃지 않는 쪽이 먼저다.
          const syncedById = readSyncedRows();
          saveTasks.push(
            gasClient.getSharedData<PartTimeSalaryRow[]>(salaryDataKey)
              .then((server) => (Array.isArray(server) ? server : null))
              .catch(() => null)
              .then((server) => {
                const merged = toStorableRows(mergePendingLocalRows(pendingSalaries as PartTimeSalaryRow[], server, syncedById));
                return Promise.all([
                  gasClient.saveSharedData(salaryDataKey, merged),
                  gasClient.saveSharedData(`part_time_profiles:${branchName}`, buildPartTimeProfiles(merged))
                ]).then(() => {
                  // 올린 것과 같은 값을 기준값으로 남긴다. 안 남기면 다음 재시도 때
                  // 이미 올린 행까지 "이 기기에서 바뀐 행"으로 잡혀 상대의 수정을 덮는다.
                  localStorage.setItem(salarySyncedKey, JSON.stringify(merged));
                });
              })
          );
        }
        if (exclusionPending && Array.isArray(pendingExclusions)) {
          saveTasks.push(gasClient.saveSharedData(exclusionDataKey, pendingExclusions));
        }
        void Promise.all(saveTasks)
          .then(() => {
            if (salaryPending) localStorage.removeItem(salaryPendingKey);
            if (exclusionPending) localStorage.removeItem(exclusionPendingKey);
          })
          .catch((error) => {
            console.warn("Pending part-time salary save failed during tab change.", error);
          });
      } catch (error) {
        console.warn("Pending part-time salary data could not be parsed during tab change.", error);
      }
    };
  }, [branchName, buildPartTimeProfiles, exclusionDataKey, exclusionPendingKey, exclusionStorageKey, salaryDataKey, salaryPendingKey, salaryStorageKey, salarySyncedKey]);

  useEffect(() => {
    let active = true;
    const loadExclusions = async () => {
      try {
        const local = localStorage.getItem(exclusionStorageKey);
        const hasPendingExclusions = localStorage.getItem(exclusionPendingKey) === "1";
        if (local && active) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed)) setExcludedEmployeeIds(parsed);
          if (hasPendingExclusions) {
            await gasClient.saveSharedData(exclusionDataKey, parsed);
            localStorage.removeItem(exclusionPendingKey);
            return;
          }
        }

        const remote = await gasClient.getSharedData<string[]>(exclusionDataKey);
        if (active && Array.isArray(remote)) {
          setExcludedEmployeeIds(remote);
          localStorage.setItem(exclusionStorageKey, JSON.stringify(remote));
        }
      } catch (error) {
        console.warn("파트타이머 급여대장 제외 목록을 불러오지 못했습니다.", error);
      }
    };
    loadExclusions();
    return () => { active = false; };
  }, [exclusionDataKey, exclusionPendingKey, exclusionStorageKey]);

  // 1. Fetch current live Roster for PTs and merge with previously saved info + auto computed work logs from history!
  useEffect(() => {
    // A. Retrieve general roster
    let rosterPartTimers: any[] = [];
    try {
      const savedRoster = localStorage.getItem(`erp_staff_list_${branchName}`);
      if (savedRoster) {
        const parsed = JSON.parse(savedRoster);
        rosterPartTimers = parsed.filter((emp: any) => emp.division === "파트타이머");
      }
    } catch (e) {
      console.error("Roster 파악 에러:", e);
    }

    // B. Calculate PT hours & attendance dates from DAILY HISTORY of the selected month
    const ptTelemetry: { [name: string]: { hours: number; dates: string[] } } = {};
    history.forEach((m) => {
      // Check if day belongs toselected month (YYYY-MM-DD startsWith YYYY-MM)
      if (m.settleDate && m.settleDate.startsWith(selectedMonth)) {
        const parts = (m.memo || "").split("\n---\nMETADATA:");
        if (parts[1]) {
          try {
            const meta = JSON.parse(parts[1].trim());
            if (meta && meta.staffRows) {
              meta.staffRows.forEach((s: any) => {
                if (s.division === "파트타이머" && Number(s.workHours || 0) > 0) {
                  if (!ptTelemetry[s.name]) {
                    ptTelemetry[s.name] = { hours: 0, dates: [] };
                  }
                  ptTelemetry[s.name].hours += Number(s.workHours || 0);

                  // Keep only date day integer like "28" or "28"
                  const dateParts = m.settleDate.split("-");
                  const daySuffix = dateParts[2] ? `${Number(dateParts[2])}` : m.settleDate;
                  if (!ptTelemetry[s.name].dates.includes(daySuffix)) {
                    ptTelemetry[s.name].dates.push(daySuffix);
                  }
                }
              });
            }
          } catch {}
        }
      }
    });

    // C. Combine with stored monthly salary configurations for the selected branch/month
    let savedSalaryMap: { [empId: string]: Partial<PartTimeSalaryRow> } = {};
    try {
        const savedConfig = localStorage.getItem(salaryStorageKey);
      if (savedConfig) {
        const list: PartTimeSalaryRow[] = JSON.parse(savedConfig);
        list.forEach((item) => {
          savedSalaryMap[item.employeeId] = item;
        });
      }
    } catch {}

    // D. Fetch profile memory (은행, 주민번호, 입사일 등 매월 반복되는 기초 사원 데이터) to auto-fill across months
    const getStoredProfile = (empId: string): any => {
      try {
        const stored = localStorage.getItem(`erp_pt_profile_${branchName}_${empId}`);
        if (stored) return JSON.parse(stored);
      } catch {}
      return {};
    };

    // E. Assemble all pieces
    const excluded = new Set<string>(excludedEmployeeIds);
    const assembledRows: PartTimeSalaryRow[] = rosterPartTimers
      .filter((pt) => !excluded.has(pt.id))
      .map((pt) => {
      const tel = ptTelemetry[pt.name] || { hours: 0, dates: [] };
      const saved = savedSalaryMap[pt.id] || {};
      const profile = getStoredProfile(pt.id);

      // 시급은 기본값을 넣지 않는다(빈칸으로 두고 사람이 적는다).
      // 예전에는 15000을 박아 넣었는데, 그 값이 그대로 저장돼 실제 시급과 다른 금액이 급여로 나갔다.
      // profile(part_time_profiles:{지점})은 달과 무관하게 지점별로 남으므로, 지난달에 적어 둔 시급이
      // 다음 달에 자동으로 따라온다. 물론 이 칸에서 고쳐 쓸 수 있다(시급 인상 등).
      const hourlyRate = saved.hourlyRate || profile.hourlyRate || "";
      const tipsEtcAmount = saved.tipsEtcAmount || "0";
      // 판정 규칙은 마감 엑셀과 공유한다(partTimeSalaryRules). 한쪽만 고치면 화면과 엑셀 금액이 어긋난다.
      const accumulatedHours = resolvePartTimeAccumulatedHours(saved, String(tel.hours));
      const calcSalary = computePartTimeSalary(hourlyRate, accumulatedHours, tipsEtcAmount);
      // 비어 있으면 비운 채로 둔다(본사가 채우는 칸). 값이 있으면 방금 계산한 급여를 따라가게 한다.
      const calcActualPaid = syncPartTimeActualPaid(saved.actualPaidAmount, calcSalary);
      const attendanceDates = resolvePartTimeAttendanceDates(saved, tel.dates);

      return {
        employeeId: pt.id,
        // 이 표에서 직접 고친 이름이 있으면 그것을 쓴다. 없으면 명부 이름을 따라간다
        // (명부에서 이름을 고치면 손대지 않은 행은 그대로 따라오게 하려는 것이다).
        name: saved.nameOverride || pt.name,
        nameOverride: saved.nameOverride,
        // 명부 이름을 남겨 둔다 — 이름을 고친 행도 명부 이름으로 중복 추가를 막기 위해서다.
        rosterName: pt.name,
        // 행을 매번 새로 만드는 자리라, 명시하지 않으면 "손댄 행"이라는 사실이 조립 한 번에 사라진다.
        edited: saved.edited,
        residentNumber: saved.residentNumber || profile.residentNumber || pt.residentNumber || "",
        entryDate: saved.entryDate || profile.entryDate || pt.entryDate || "",
        contractStatus: saved.contractStatus || profile.contractStatus || "미작성",
        bank: saved.bank || profile.bank || "",
        accountNumber: saved.accountNumber || profile.accountNumber || "",
        hourlyRate,
        accumulatedHours,
        // 행을 매번 새로 만드는 자리라, 명시하지 않으면 "직접 적었다"는 사실이 조립 한 번에 사라진다.
        hoursOverridden: saved.hoursOverridden,
        attendanceOverridden: saved.attendanceOverridden,
        autoAccumulatedHours: String(tel.hours),
        tipsEtcAmount,
        calculatedSalary: calcSalary,
        attendanceDates,
        actualPaidAmount: calcActualPaid,
        payoutBranch: saved.payoutBranch || branchName,
        memo: saved.memo || ""
      };
      });

    // 수기 행은 직원명부에도 일일마감에도 없으니 위에서 다시 만들어지지 않는다. 그대로 물려준다.
    setSalaries((current) => [
      ...assembledRows,
      ...current.filter((row) => isManualRow(row) && !excluded.has(row.employeeId))
    ]);
  }, [branchName, selectedMonth, history, excludedEmployeeIds, salaryStorageKey]);

  useEffect(() => {
    const loadSharedSalaries = async () => {
      try {
        const local = localStorage.getItem(salaryStorageKey);
        if (localStorage.getItem(salaryPendingKey) === "1" && local) {
          const localRows = JSON.parse(local);
          if (Array.isArray(localRows)) {
            const excluded = new Set<string>(excludedEmployeeIds);
            const restoredRows = localRows.filter((salary) => !excluded.has(salary.employeeId)).map((salary) => ({
              ...salary,
              tipsEtcAmount: salary.tipsEtcAmount || "0"
            }));
            // 올리기 전에 서버를 먼저 읽는다. 그냥 덮으면 그 사이 다른 기기가 고쳐 둔 것이 통째로 지워진다.
            // 못 읽으면 null로 두고 종전처럼 로컬을 올린다 — 편집분을 잃지 않는 쪽이 먼저다.
            let serverRows: PartTimeSalaryRow[] | null = null;
            try {
              const fetched = await gasClient.getSharedData<PartTimeSalaryRow[]>(salaryDataKey);
              if (Array.isArray(fetched)) serverRows = fetched.filter((salary) => !excluded.has(salary.employeeId));
            } catch (error) {
              console.warn("저장 전 서버 급여대장을 읽지 못했습니다. 이 기기 편집분만 올립니다.", error);
            }
            const uploadRows = toStorableRows(mergePendingLocalRows(restoredRows, serverRows, readSyncedRows()));
            setSalaries((current) => mergeKeepingManualRows(uploadRows, current, excluded));
            // 프로필(주민번호·입사일·은행·계좌·시급)도 함께 올린다. 다른 두 저장 경로는 늘 같이 올리는데
            // 이 경로만 빠져 있었다 — 그러면 급여대장은 올라갔는데 시급이 서버에 없어,
            // **다음 달에 전월 시급이 따라오지 않고** 다른 기기에서도 계좌가 비어 보인다.
            await Promise.all([
              gasClient.saveSharedData(salaryDataKey, uploadRows),
              gasClient.saveSharedData(`part_time_profiles:${branchName}`, buildPartTimeProfiles(uploadRows))
            ]);
            localStorage.setItem(salaryStorageKey, JSON.stringify(uploadRows));
            localStorage.setItem(salarySyncedKey, JSON.stringify(uploadRows));
            localStorage.removeItem(salaryPendingKey);
            return;
          }
        }
        const remote = await gasClient.getSharedData<PartTimeSalaryRow[]>(salaryDataKey);
        // 빈 배열은 아직 저장된 급여대장이 없다는 뜻이므로, 일일마감에서 계산한 행을 유지합니다.
        if (Array.isArray(remote) && remote.length > 0) {
          const excluded = new Set<string>(excludedEmployeeIds);
          const loadedRows = remote.filter((salary) => !excluded.has(salary.employeeId)).map((salary) => ({
            ...salary,
            tipsEtcAmount: salary.tipsEtcAmount || "0"
          }));
          // 통째로 갈아치우면 안 된다 — 이 요청이 오가는 사이에 "수기 추가"를 눌렀다면,
          // 뒤늦게 도착한 옛 응답이 방금 만든 행을 지워 버린다. 여기에 없는 수기 행은 지키고 얹는다.
          setSalaries((current) => mergeKeepingManualRows(loadedRows, current, excluded));
          // 방금 서버에서 받은 값이 곧 "서버와 맞춰진 상태"다. 기준값으로 남겨 둔다.
          // 안 남기면 기준값 없이 sticky한 edited 표시로 판단하게 되어, 서버에서 받은 옛 행까지
          // "내가 고친 행"으로 잡혀 다음 재시도 때 상대의 수정을 덮는다.
          localStorage.setItem(salarySyncedKey, JSON.stringify(loadedRows));
        }
      } catch (error) {
        console.warn("파트타이머 급여 공통 데이터를 불러오지 못했습니다.", error);
      }
    };
    loadSharedSalaries();
  }, [excludedEmployeeIds, readSyncedRows, salaryDataKey, salaryPendingKey, salaryStorageKey, salarySyncedKey]);

  useEffect(() => {
    const loadSharedProfiles = async () => {
      try {
        const profiles = await gasClient.getSharedData<Record<string, any>>(`part_time_profiles:${branchName}`);
      if (!profiles || localStorage.getItem(salaryPendingKey) === "1") return;
        Object.entries(profiles).forEach(([employeeId, profile]) => {
          localStorage.setItem(`erp_pt_profile_${branchName}_${employeeId}`, JSON.stringify(profile));
        });
        setSalaries((current) => current.map((salary) => {
          const profile = profiles[salary.employeeId];
          if (!profile) return salary;
          const merged = {
            ...salary,
            residentNumber: salary.residentNumber || profile.residentNumber || "",
            entryDate: salary.entryDate || profile.entryDate || "",
            contractStatus: salary.contractStatus || profile.contractStatus || salary.contractStatus,
            bank: salary.bank || profile.bank || "",
            accountNumber: salary.accountNumber || profile.accountNumber || "",
            // 지난달에 적어 둔 시급이 여기서 따라온다(시급 기본값을 없앤 뒤부터 이 경로가 실제로 값을 채운다).
            hourlyRate: salary.hourlyRate || profile.hourlyRate || salary.hourlyRate
          };
          // 시급이 방금 채워졌으면 급여도 다시 계산해야 한다.
          // 안 하면 시급 칸에는 숫자가 보이는데 기본급여는 0원으로 남아, 실제로 받을 돈이 0원으로 마감된다.
          const calculatedSalary = computePartTimeSalary(merged.hourlyRate, merged.accumulatedHours, merged.tipsEtcAmount);
          return { ...merged, calculatedSalary, actualPaidAmount: syncPartTimeActualPaid(merged.actualPaidAmount, calculatedSalary) };
        }));
      } catch (error) {
        console.warn("파트타이머 프로필 공통 데이터를 불러오지 못했습니다.", error);
      }
    };
    loadSharedProfiles();
  }, [branchName, salaryPendingKey]);

  // 다른 기기에서도 공통 직원현황을 기준으로 파트타이머 행을 생성합니다.
  useEffect(() => {
    const mergeRemotePartTimers = async () => {
      try {
        const roster = await gasClient.getBranchOwnRoster(branchName);
        const partTimers = roster.filter((employee) => employee.division === "파트타이머");
        if (partTimers.length === 0) return;

        const telemetry: Record<string, { hours: number; dates: string[] }> = {};
        history.filter((record) => record.settleDate?.startsWith(selectedMonth)).forEach((record) => {
          const metadata = String(record.memo || "").split("\n---\nMETADATA:")[1];
          if (!metadata) return;
          try {
            JSON.parse(metadata).staffRows?.forEach((staff: any) => {
              if (staff.division !== "파트타이머" || !staff.name || Number(staff.workHours || 0) <= 0) return;
              const item = telemetry[staff.name] || { hours: 0, dates: [] };
              item.hours += Number(staff.workHours || 0);
              const day = String(record.settleDate).split("-")[2];
              if (day && !item.dates.includes(day)) item.dates.push(day);
              telemetry[staff.name] = item;
            });
          } catch {}
        });

        // 기존 파트타이머 일지에만 있는 직원도 급여대장에 포함합니다.
        // 직원현황에 등록되지 않은 과거 기록은 이름 기반 임시 ID를 사용합니다.
        const allPartTimers = [...partTimers];
        const rosterNames = new Set(allPartTimers.map((employee) => employee.name));
        Object.keys(telemetry).forEach((name) => {
          if (!rosterNames.has(name)) {
            allPartTimers.push({
              id: `legacy-${branchName}-${name}`,
              name,
              division: "파트타이머"
            });
          }
        });

        setSalaries((current) => {
          const byEmployeeId = new Map<string, PartTimeSalaryRow>(current.map((salary) => [salary.employeeId, salary]));
          const excluded = new Set<string>(excludedEmployeeIds);
          // 수기 행은 명부에도 마감에도 없어 여기서 다시 만들어지지 않는다. 뒤에 그대로 붙여 살린다.
          const manualRows = current.filter((row) => isManualRow(row) && !excluded.has(row.employeeId));
          const rebuiltRows = allPartTimers.filter((employee) => !excluded.has(employee.id)).map((employee) => {
            const existing = byEmployeeId.get(employee.id);
            const work = telemetry[employee.name] || { hours: 0, dates: [] };
            if (existing) {
              // 판정 규칙은 조립 효과·마감 엑셀과 같은 함수를 쓴다(partTimeSalaryRules).
              const accumulatedHours = resolvePartTimeAccumulatedHours(existing, String(work.hours));
              const calculatedSalary = computePartTimeSalary(existing.hourlyRate, accumulatedHours, existing.tipsEtcAmount);
              return {
                ...existing,
                // 위 조립 효과와 같은 규칙 — 고친 이름이 있으면 그것, 없으면 명부 이름.
                // 두 곳이 규칙이 다르면 어느 쪽이 마지막에 도느냐에 따라 이름이 오락가락한다.
                name: existing.nameOverride || employee.name,
                rosterName: employee.name,
                residentNumber: existing.residentNumber || employee.residentNumber || "",
                entryDate: existing.entryDate || employee.entryDate || "",
                contractStatus: existing.contractStatus || (employee as any).contractStatus || existing.contractStatus,
                accumulatedHours,
                autoAccumulatedHours: String(work.hours),
                tipsEtcAmount: existing.tipsEtcAmount || "0",
                attendanceDates: resolvePartTimeAttendanceDates(existing, work.dates),
                calculatedSalary,
                actualPaidAmount: syncPartTimeActualPaid(existing.actualPaidAmount, calculatedSalary)
              };
            }
            // 시급은 빈칸으로 둔다 — 기본값을 박으면 그 값이 그대로 저장돼 실제와 다른 급여가 나간다.
            // 지난달에 적어 둔 시급은 part_time_profiles 를 통해 따라온다(loadSharedProfiles).
            const hourlyRate = "";
            return {
              employeeId: employee.id,
              name: employee.name,
              rosterName: employee.name,
              residentNumber: employee.residentNumber || "",
              entryDate: employee.entryDate || "",
              contractStatus: "미작성",
              bank: "",
              accountNumber: "",
              hourlyRate,
              accumulatedHours: String(work.hours),
              autoAccumulatedHours: String(work.hours),
              tipsEtcAmount: "0",
              calculatedSalary: computePartTimeSalary(hourlyRate, work.hours, "0"),
              attendanceDates: resolvePartTimeAttendanceDates(null, work.dates),
              actualPaidAmount: "",
              payoutBranch: branchName,
              memo: ""
            } as PartTimeSalaryRow;
          });
          return [...rebuiltRows, ...manualRows];
        });
      } catch (error) {
        console.warn("공통 파트타이머 명단을 불러오지 못했습니다.", error);
      }
    };
    mergeRemotePartTimers();
  }, [branchName, selectedMonth, history, excludedEmployeeIds]);

  const handleUpdate = (empId: string, field: keyof PartTimeSalaryRow, value: any) => {
    const nextSalaries = salaries.map(item => {
      if (item.employeeId !== empId) return item;
      // 금액칸은 쉼표를 넣어 보여 주므로, 저장할 땐 쉼표를 떼고 숫자만 남긴다.
      const nextValue = field === "tipsEtcAmount" || field === "hourlyRate"
        ? cleanNumeric(String(value || ""))
        : field === "attendanceDates"
          // 근무일정은 최대 7개까지만 적는다(사용자 지시 2026-07-31). 칸 폭도 그 개수에 맞춰 두었다.
          ? String(value || "").split(",").map((day) => day.trim()).filter(Boolean).slice(0, PART_TIME_ATTENDANCE_MAX).join(",")
          : value;
      // 손댄 행은 0시간이어도 화면에 남긴다. 팁·계좌만 적어 둔 0시간 행이 감춰지면
      // 마감 엑셀에는 나가는데 화면에는 없는 행이 되어, 확인할 길 없이 돈이 나간다.
      const updated = { ...item, [field]: nextValue, edited: true };
      // 이름을 직접 고쳤다는 사실을 함께 남긴다. 이게 없으면 명부에서 행을 다시 만들 때 옛 이름으로 되돌아간다.
      // 수기 행은 명부에 없어 되돌아갈 일이 없지만, 같은 규칙으로 남겨 두면 분기가 하나 줄어든다.
      // 비우면 override도 비워져 다시 명부 이름을 따라간다.
      if (field === "name") updated.nameOverride = String(nextValue || "").trim();
      // 누적시간을 사람이 만졌다는 사실을 남긴다. 이게 없으면 (1) 지우는 순간 0시간이 되어 행이 사라지고
      // (2) 빈 값이 일일마감 집계로 되채워져, 수기로 다시 적어 둔 줄과 한 사람이 두 줄이 된다.
      // 말일 낮에 그날 저녁 근무를 예상해 적는 경우가 이 경로다.
      if (field === "accumulatedHours") updated.hoursOverridden = true;
      // 출근일도 같은 규칙 — 직접 적었다는 표시가 없으면 다음 재조립 때 집계값으로 되돌아간다.
      if (field === "attendanceDates") updated.attendanceOverridden = true;
      // Recalculate salary if wage or code changes
      if (field === "hourlyRate" || field === "accumulatedHours" || field === "tipsEtcAmount") {
        const total = computePartTimeSalary(updated.hourlyRate, updated.accumulatedHours, updated.tipsEtcAmount);
        updated.calculatedSalary = total;
        updated.actualPaidAmount = total; // Pre-fill with normal calculation
      }
      return updated;
    });
    persistPartTimeSalaries(nextSalaries);
  };

  /**
   * 직접 적은 누적시간을 버리고 일일마감 집계값으로 되돌린다.
   *
   * 되돌릴 길이 없으면, 한 번 잘못 만진 행은 그 달 내내 일일마감과 어긋난 채로 남는다.
   * 말일에 예상 시간을 적어 둔 뒤 실제 근무가 기록되면 이 버튼으로 실제값에 맞춘다.
   */
  const handleRestoreAutoHours = (employee: PartTimeSalaryRow) => {
    const autoHours = employee.autoAccumulatedHours ?? "";
    if (autoHours === "") return;
    const who = employee.name.trim() || "이름 없는 행";
    if (!window.confirm(`${who} 님의 누적시간을 일일마감 집계값 ${autoHours}시간으로 되돌릴까요?\n직접 적어 둔 ${employee.accumulatedHours || "0"}시간은 사라집니다.`)) return;

    const nextSalaries = salaries.map((item) => {
      if (item.employeeId !== employee.employeeId) return item;
      const total = computePartTimeSalary(item.hourlyRate, autoHours, item.tipsEtcAmount);
      // edited는 그대로 둔다 — 되돌린 값이 0시간이어도 행이 갑자기 사라지지 않게.
      return { ...item, accumulatedHours: autoHours, hoursOverridden: false, calculatedSalary: total, actualPaidAmount: total };
    });
    persistPartTimeSalaries(nextSalaries);
    triggerToast(`${who} 님의 누적시간을 ${autoHours}시간으로 되돌렸습니다.`);
  };

  /**
   * 행을 지운다.
   *
   * 자동으로 만들어진 행은 지워도 직원명부·일일마감에서 다시 만들어진다. 그래서 "제외" 목록에 넣어 막는다.
   * 수기 행은 다시 만들어질 곳이 없으니 목록에서 빼는 것으로 끝이다 — 그쪽에는 "삭제"라고 말해야 맞다.
   */
  const handleRemoveRow = (employee: PartTimeSalaryRow) => {
    const manual = isManualRow(employee);
    const who = employee.name.trim() || "이름 없는 행";
    const question = manual
      ? `${who}을(를) 급여대장에서 삭제할까요?`
      : `${who} 님을 이번 달 파트타이머 급여대장에서 제외할까요?\n직원현황과 일일마감 근무기록은 삭제되지 않습니다.`;
    if (!window.confirm(question)) return;

    const nextSalaries = salaries.filter((salary) => salary.employeeId !== employee.employeeId);
    const nextExcluded = manual || excludedEmployeeIds.includes(employee.employeeId)
      ? excludedEmployeeIds
      : [...excludedEmployeeIds, employee.employeeId];
    setExcludedEmployeeIds(nextExcluded);
    persistPartTimeSalaries(nextSalaries, nextExcluded, true);
    triggerToast(manual ? `${who}을(를) 삭제했습니다.` : `${who} 님을 이번 달 급여대장에서 제외했습니다.`);
  };

  /**
   * 직원명부에도 일일마감에도 없는 사람을 직접 넣는다.
   *
   * 표 맨 아래에 빈 행을 만들고 성명 칸으로 커서를 보낸다(사용자 지시 2026-07-31).
   * 예전에는 이름을 묻는 창을 먼저 띄웠는데, 엑셀처럼 바로 적는 편이 빠르다.
   *
   * 창을 없애며 그 창이 맡던 두 가지는 다른 자리로 옮겼다.
   *  · 이름 없이 남는 것 막기 → 요약줄의 "성명 미입력 N행" 경고(그 행은 마감 엑셀에서 빠진다).
   *  · 같은 사람 두 줄 막기 → 성명 칸에서 손을 뗄 때(onBlur) 확인하는 warnIfDuplicateName.
   */
  const handleAddManualRow = () => {
    const newRow: PartTimeSalaryRow = {
      employeeId: newManualId(),
      name: "",
      residentNumber: "",
      entryDate: "",
      contractStatus: "미작성",
      bank: "",
      accountNumber: "",
      hourlyRate: "",
      accumulatedHours: "0",
      tipsEtcAmount: "0",
      calculatedSalary: "0",
      attendanceDates: "",
      actualPaidAmount: "",
      payoutBranch: branchName,
      memo: ""
    };
    // 저장 완료 토스트는 띄우지 않는다 — 바로 아래 안내와 두 개가 겹친다.
    const nextSalaries = [...salaries, newRow];
    // 수기 행은 언제나 보이므로(isAlwaysVisibleRow) 새 행은 표의 마지막 줄이 된다.
    // 그 줄의 성명 칸으로 커서를 보내 바로 이름부터 적게 한다.
    const newRowIndex = visibleSalaries.length;
    persistPartTimeSalaries(nextSalaries, excludedEmployeeIds, false);
    requestFocus(newRowIndex, COL_NAME);
    triggerToast("행을 추가했습니다. 성명부터 적어 주세요.");
  };

  /**
   * 성명 칸에서 손을 뗄 때 같은 사람이 이미 있는지 알린다.
   *
   * 숨은 행(이번 달 근무기록이 없어 안 보이는 행)을 못 찾아 수기로 다시 만드는 일이 실제로 있었고,
   * 그렇게 두 줄이 되면 마감 엑셀·이체 리스트에도 두 줄로 나가 **급여가 두 번 빠진다.**
   * 화면에 보이는 이름만이 아니라 명부 이름·고친 이름을 전부 본다 — 예금주명으로 이름을 고쳐 둔 행은
   * 명부 이름이 화면에 없어, 명부 이름으로 적으면 경고 없이 두 줄이 된다.
   */
  const warnIfDuplicateName = (row: PartTimeSalaryRow) => {
    const typedKey = normalizedName(row.name);
    if (!typedKey) return;
    const duplicate = salaries.find(
      (other) => other.employeeId !== row.employeeId && allNamesOf(other).includes(typedKey)
    );
    if (!duplicate) return;

    const hidden = !isAlwaysVisibleRow(duplicate);
    const shownAs = duplicate.name.trim() && normalizedName(duplicate.name) !== typedKey
      ? `\n(급여대장에는 "${duplicate.name.trim()}" 으로 적혀 있습니다.)`
      : "";
    if (hidden) setShowZeroHourRows(true);
    window.alert(
      `"${row.name.trim()}" 님은 이미 급여대장에 있습니다.${shownAs}\n` +
      (hidden
        ? "이번 달 근무기록이 없어 숨어 있던 행을 펼쳤습니다. 그 행에 적어 주세요.\n"
        : "") +
      "이 행을 그대로 두면 같은 사람이 두 줄이 되어 급여가 두 번 나갈 수 있습니다.\n" +
      "이름 옆 × 를 눌러 이 행을 지워 주세요."
    );
  };

  // Grand totals
  // 실제 근무시간이 없는 인원은 이번 달 급여대장에 기본으로 표시하지 않습니다(명부 전체가 뜨면 표가 어수선해진다).
  // 다만 아래 셋은 0시간이어도 남긴다 — 안 남기면 적는 도중에 행이 사라진다.
  //   · 수기 행: 방금 만든 빈 행(0시간)이 곧바로 사라지면 아무것도 적을 수 없다.
  //   · 사람이 시간을 직접 정한 행: 지우고 다시 적으려는 순간 사라지던 문제(사용자 지적 2026-07-31).
  //   · '근무기록 없는 인원 보기'를 켠 동안: 말일에 예상 시간을 적어 넣기 위한 통로.
  const hiddenZeroHourCount = salaries.filter((salary) => !isAlwaysVisibleRow(salary)).length;
  const visibleSalaries = salaries.filter((salary) => isAlwaysVisibleRow(salary) || showZeroHourRows);
  const unnamedManualCount = salaries.filter((salary) => !hasName(salary)).length;
  // 시급을 안 적으면 급여가 0원으로 계산돼 그대로 마감 엑셀에 나간다(기본값을 박지 않기로 한 뒤부터).
  // 조용히 0원으로 두면 그 사람 급여가 통째로 빠지므로 눈에 띄게 알린다.
  const missingRateCount = visibleSalaries.filter((salary) => hasName(salary) && !(Number(salary.hourlyRate) > 0)).length;
  const totalHours = visibleSalaries.reduce((acc, s) => acc + (Number(s.accumulatedHours) || 0), 0);
  const totalSalary = visibleSalaries.reduce((acc, s) => acc + (Number(s.calculatedSalary) || 0), 0);

  // 엑셀처럼 키보드로 칸을 옮긴다. 맨 끝 칸에서 Tab을 눌러도 행이 생기지는 않는다(onAppendRow 없음) —
  // 행은 명부·일일마감에서 오거나 위 '행 추가' 버튼으로 만든다(이름을 먼저 받아야 하기 때문).
  const { cellProps, isActive, requestFocus } = useSheetKeyboardNav({
    rowCount: visibleSalaries.length,
    colCount: PARTTIME_COL_COUNT
  });

  // 엑셀 셀: 격자선은 td가 긋고, 현재 칸은 굵은 테두리로 짚어준다.
  const cellTd = (rowIndex: number, col: number, extra = "") =>
    [
      "border-r border-b border-black/10 p-0 relative",
      isActive(rowIndex, col) ? "outline outline-2 -outline-offset-2 outline-[#2E6DB4] z-10" : "",
      extra
    ].join(" ");
  // sheet-cell-input: index.css에서 전역 input 배경/테두리 !important를 ID 특이성으로 되돌리는 클래스.
  const cellInput = "sheet-cell-input w-full h-9 px-2 text-xs focus:outline-none";

  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5 animate-fade-in" id="parttime-salaries-subtab">
      <div className="flex justify-between items-center pb-3 border-b border-gray-50 flex-col sm:flex-row gap-3">
        <div>
          <h3 className="text-sm font-black text-zinc-900 leading-snug w-fit">
            파트타이머 급여대장
          </h3>
          <p className="text-[10px] text-gray-400 font-extrabold mt-1">
             직원현황의 파트타이머 리스트가 자동으로 연동되고, 이번 달 일일 일지에서 실시간 근무시간과 출근일이 집계되어 프리필링됩니다.
             누적시간은 직접 고쳐 쓸 수 있습니다 — 말일에 그날 저녁 근무를 예상해 적어 두는 경우가 그렇습니다.
          </p>
        </div>

        <div className="flex w-full sm:w-auto items-center gap-2">
          {/* 이번 달 근무기록이 없어 숨은 인원을 펼친다.
              이 통로가 없으면 "아직 안 찍힌 사람"에게 예상 시간을 적을 방법이 수기 행뿐이라, 나중에 그 사람의
              근무기록이 올라오면 자동 행과 수기 행이 겹쳐 한 사람이 두 줄이 된다(= 급여 이중 지급).
              알약 토글이라 모서리는 rounded-full, 켜짐=검정+바닐라 글자·꺼짐=바닐라+검정 글자(DESIGN.md §10).
              글자는 버튼 기준 11px·900(§6-0-1). 토큰에 없는 색을 만들지 않으려고 hover 전용 색은 두지 않는다. */}
          {hiddenZeroHourCount > 0 && (
            <button
              type="button"
              onClick={() => setShowZeroHourRows((current) => !current)}
              aria-pressed={showZeroHourRows}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-full text-[11px] font-black flex items-center justify-center gap-2 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#2E6DB4] focus:ring-offset-2 ${
                showZeroHourRows ? "bg-zinc-900 text-[#EFF0A3]" : "bg-[#EFF0A3] text-zinc-900"
              }`}
              title="이번 달 근무기록이 아직 없는 파트타이머까지 표에 펼칩니다. 말일에 예상 시간을 적을 때 씁니다."
            >
              {showZeroHourRows ? "근무기록 없는 인원 숨기기" : `근무기록 없는 인원 ${hiddenZeroHourCount}명 보기`}
            </button>
          )}
          {/* 자동저장 배지 — 한 줄에 선 것들이 서로 다른 크기면 어색하다. 버튼 기준 11px·900로 맞춘다(§6-0-1·§11). */}
          <div className="flex-1 sm:flex-none px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-[11px] font-black flex items-center justify-center gap-2 shadow-sm">
            <Check className="w-3.5 h-3.5" />
            자동저장
          </div>
        </div>
      </div>

      {/* 요약 — 숫자 세 개와 경고, 그리고 오른쪽 끝에 '행 추가'(사용자 지시 2026-07-31).
          표 바로 위 한 줄에 두어 "여기서 행을 늘린다"가 표와 붙어 읽히게 한다. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2">
        <span className="text-[11px] font-black text-zinc-500">
          누적근무 <b className="ml-1 font-mono text-sm text-zinc-800">{formatNumber(totalHours)} hr</b>
        </span>
        <span className="text-[11px] font-black text-zinc-500">
          급여합계(세전) <b className="ml-1 font-mono text-sm text-[#2E6DB4]">{formatNumber(totalSalary)} 원</b>
        </span>
        <span className="text-[11px] font-black text-zinc-500">
          인원 <b className="ml-1 font-mono text-sm text-zinc-800">{formatNumber(visibleSalaries.length)} 명</b>
        </span>
        {/* 이름·시급이 빠진 행은 급여가 통째로 빠지거나 0원으로 나간다. 조용히 두면 적어 뒀다고 믿고
            마감해 버리므로 눈에 띄게 알린다. 둘 다면 더 급한 '성명'을 보여준다. */}
        {unnamedManualCount > 0 ? (
          <span className="text-[10px] font-black text-rose-600">
            성명 미입력 {formatNumber(unnamedManualCount)}행 — 이름을 적어야 마감 엑셀에 포함됩니다
          </span>
        ) : missingRateCount > 0 ? (
          <span className="text-[10px] font-black text-rose-600">
            시급 미입력 {formatNumber(missingRateCount)}명 — 급여가 0원으로 계산됩니다
          </span>
        ) : (
          <span className="text-[10px] font-bold text-zinc-400">100% 자동 산정</span>
        )}
        {/* 직원명부에도 일일마감에도 없는 사람을 넣는 길. 이 표는 그 두 곳에서만 행을 만들기 때문에
            이 버튼이 없으면 일용직처럼 명부에 없는 사람에게 급여를 줄 방법이 없다. */}
        <button
          type="button"
          onClick={handleAddManualRow}
          className="ml-auto px-4 py-2 rounded-xl bg-[#2E6DB4] text-white text-[11px] font-black flex items-center justify-center gap-2 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#2E6DB4] focus:ring-offset-2"
          title="직원명부에 없는 사람(일용직 등)을 직접 추가합니다. 명부에 있는 사람은 '근무기록 없는 인원 보기'로 펼쳐 쓰세요."
        >
          <Plus className="w-3.5 h-3.5" />
          행 추가
        </button>
      </div>

      {/* Ledger Table */}
      {/* 표가 가로 스크롤(overflow)이라 칩은 바깥 relative 층에 얹는다. */}
      <div className="relative">
      <SheetKeyHint />
      <div className="overflow-x-auto rounded-2xl border border-gray-100 shadow-xs">
        {/* 성명은 길어야 네 글자, 근무일정은 숫자 7개까지라 그 폭에 맞춰 좁혔다(사용자 지시 2026-07-31).
            좁힌 만큼 표 전체 최소폭도 함께 줄여, 남는 자리가 비고 칸으로 가게 한다.
            성명은 이름 옆에 지우기(×) 버튼이 함께 서므로 **버튼 자리까지 더한 폭**이어야 한다 —
            글자 수만 보고 더 좁히면 이름이 잘리고 버튼과 겹쳐 보인다(2026-07-31 실제 발생). */}
        <table className="w-full text-left text-xs border-collapse font-medium min-w-[1270px]">
          <thead>
            <tr className="bg-zinc-50 border-b border-gray-100 text-zinc-550 font-black text-[9px] tracking-wider uppercase">
              <th className="py-3 px-2 w-24 whitespace-nowrap">성명</th>
              <th className="py-3 px-3 w-32 whitespace-nowrap">주민등록번호</th>
              <th className="py-3 px-2 w-28 whitespace-nowrap">입사일자</th>
              <th className="py-3 px-3 w-20 whitespace-nowrap">은행</th>
              <th className="py-3 px-3 w-32 whitespace-nowrap">입금 계좌번호</th>
              <th className="py-3 px-3 w-20 text-right whitespace-nowrap">시급 (원)</th>
              <th className="py-3 px-2 w-16 text-right whitespace-nowrap">누적시간</th>
              <th className="py-3 px-2 w-20 text-right whitespace-nowrap">팁/기타</th>
              <th className="py-3 px-3 w-24 text-right whitespace-nowrap">기본급여 (원)</th>
              <th className="py-3 px-2 w-24 whitespace-nowrap">근무일정 (출근일)</th>
              <th className="py-3 px-3 w-[260px] whitespace-nowrap">기타 비고 내용 (퇴사일 등)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-[10px] font-sans">
            {visibleSalaries.length === 0 ? (
              <tr>
                <td colSpan={PARTTIME_COL_COUNT} className="py-16 text-center text-gray-400 font-bold">
                  이번 달 근무시간이 기록된 파트타이머가 없습니다.
                  {hiddenZeroHourCount > 0 && (
                    <span className="mt-1 block text-[10px] font-extrabold text-gray-400">
                      위 &lsquo;근무기록 없는 인원 {hiddenZeroHourCount}명 보기&rsquo;로 명부의 파트타이머를 펼쳐 시간을 적을 수 있습니다.
                    </span>
                  )}
                </td>
              </tr>
            ) : (
              visibleSalaries.map((sal, rowIndex) => (
                <tr key={sal.employeeId} className="hover:bg-zinc-50/40">
                  {/* 성명. 이 표에서 직접 고칠 수 있다 — 통장 예금주 실명이 직원명부의 이름과 다를 때 쓴다.
                      고친 이름은 이 급여대장(과 마감 엑셀·이체 리스트)에만 쓰이고 직원명부는 그대로 둔다.
                      명부 이름을 바꾸면 누적근무시간 집계가 옛 일일마감 기록과 안 맞아 0이 되기 때문이다.
                      비우면 다시 명부 이름을 따라간다(수기 행은 따라갈 명부가 없어 빈 채로 남는다).
                      지우기는 이 칸에 둔다. 표가 가로로 길어 오른쪽 끝에 두면 스크롤해야 닿는다.
                      마우스를 올려야 보이게 숨기지 않는다 — 태블릿에는 hover가 없어 지울 길이 사라진다. */}
                  <td className="border-r border-b border-black/10 py-3 px-2 text-xs">
                    <div className="flex items-center gap-1">
                      <input
                        {...cellProps(rowIndex, COL_NAME)}
                        aria-label="성명"
                        type="text"
                        value={sal.name}
                        onChange={(e) => handleUpdate(sal.employeeId, "name", e.target.value)}
                        // 커서가 빠질 때 같은 사람이 이미 있는지 알린다(입력 도중엔 알리지 않는다 —
                        // 한 글자 칠 때마다 뜨면 이름을 끝까지 적을 수가 없다).
                        // cellProps의 onBlur(활성 칸 해제)도 그대로 살려야 커서 표시가 남지 않는다.
                        onBlur={(e) => {
                          cellProps(rowIndex, COL_NAME).onBlur?.();
                          warnIfDuplicateName({ ...sal, name: e.target.value });
                        }}
                        placeholder="성명 입력"
                        title={
                          sal.nameOverride
                            ? "급여대장에서 고친 이름입니다. 직원현황의 이름은 그대로입니다. 비우면 직원현황 이름을 따라갑니다."
                            : "통장 예금주명이 다르면 여기서 고칠 수 있습니다. 직원현황의 이름은 바뀌지 않습니다."
                        }
                        className={`w-full min-w-0 bg-transparent font-extrabold focus:outline-none placeholder-rose-300 ${
                          sal.nameOverride ? "text-[#2E6DB4]" : "text-zinc-900"
                        }`}
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => handleRemoveRow(sal)}
                        aria-label={`${sal.name || "이름 없는 행"} ${isManualRow(sal) ? "삭제" : "제외"}`}
                        title={isManualRow(sal) ? "이 행을 삭제합니다" : "이번 달 급여대장에서만 제외합니다"}
                        className="shrink-0 rounded p-0.5 text-gray-300 transition hover:bg-rose-50 hover:text-rose-600 focus:text-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-400"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className={cellTd(rowIndex, COL_RESIDENT)}>
                    <input
                      {...cellProps(rowIndex, COL_RESIDENT)}
                      aria-label={`${sal.name} 주민등록번호`}
                      type="text"
                      value={sal.residentNumber}
                      onChange={(e) => handleUpdate(sal.employeeId, "residentNumber", e.target.value)}
                      className={`${cellInput} font-mono font-bold text-gray-800 tracking-tighter text-center`}
                    />
                  </td>
                  <td className={cellTd(rowIndex, COL_ENTRY_DATE)}>
                    <input
                      {...cellProps(rowIndex, COL_ENTRY_DATE)}
                      aria-label={`${sal.name} 입사일자`}
                      type="date"
                      value={toDateInputValue(sal.entryDate)}
                      onChange={(e) => handleUpdate(sal.employeeId, "entryDate", e.target.value)}
                      className={`${cellInput} text-gray-800 text-center`}
                    />
                  </td>
                  <td className={cellTd(rowIndex, COL_BANK)}>
                    <input
                      {...cellProps(rowIndex, COL_BANK)}
                      aria-label={`${sal.name} 은행`}
                      type="text"
                      value={sal.bank}
                      onChange={(e) => handleUpdate(sal.employeeId, "bank", e.target.value)}
                      className={`${cellInput} font-bold text-gray-800 text-center`}
                    />
                  </td>
                  <td className={cellTd(rowIndex, COL_ACCOUNT)}>
                    <input
                      {...cellProps(rowIndex, COL_ACCOUNT)}
                      aria-label={`${sal.name} 입금 계좌번호`}
                      type="text"
                      value={sal.accountNumber}
                      onChange={(e) => handleUpdate(sal.employeeId, "accountNumber", e.target.value)}
                      className={`${cellInput} font-mono font-medium text-gray-850`}
                    />
                  </td>
                  {/* 시급 — 금액칸이라 쉼표를 넣어 자릿수를 바로 읽게 한다(DESIGN.md §9-4).
                      쉼표를 쓰려면 type="number"로는 안 되므로 text로 둔다.
                      **inputMode="numeric"은 넣지 않는다(§9-1)** — 윈도우 IME가 영문으로 전환된 채 남아
                      다음 한글 칸(성명·비고)에 영문이 찍힌다.
                      기본값을 넣지 않으므로 비어 있으면 안내 문구를 보여 준다(비면 급여가 0원이 된다). */}
                  <td className={cellTd(rowIndex, COL_HOURLY_RATE)}>
                    <input
                      {...cellProps(rowIndex, COL_HOURLY_RATE)}
                      aria-label={`${sal.name} 시급`}
                      type="text"
                      value={formatWithCommas(sal.hourlyRate || "")}
                      onChange={(e) => handleUpdate(sal.employeeId, "hourlyRate", e.target.value)}
                      placeholder="시급 입력"
                      title="지난달에 적어 둔 시급이 자동으로 따라옵니다. 시급이 올랐으면 여기서 고쳐 주세요."
                      className={`${cellInput} font-mono font-black text-right text-gray-800 placeholder-rose-300`}
                    />
                  </td>
                  {/* 누적시간. 일일마감 집계가 채워 주지만 직접 고칠 수 있다(말일 저녁 근무 예상 입력).
                      직접 고친 칸은 색을 달리해 "이 값은 더 이상 자동으로 갱신되지 않는다"를 알리고,
                      옆의 되돌리기 버튼으로 집계값으로 되돌릴 수 있게 둔다. */}
                  <td className={cellTd(rowIndex, COL_HOURS)}>
                    <div className="flex items-center">
                      <input
                        {...cellProps(rowIndex, COL_HOURS)}
                        aria-label={`${sal.name} 누적시간`}
                        type="number"
                        value={sal.accumulatedHours}
                        onChange={(e) => handleUpdate(sal.employeeId, "accumulatedHours", e.target.value)}
                        title={
                          isHoursOverridden(sal)
                            ? `직접 적은 시간입니다. 일일마감 집계는 ${sal.autoAccumulatedHours ?? "0"}시간입니다.`
                            : "일일마감 근무기록에서 집계된 시간입니다. 직접 고쳐 적을 수 있습니다."
                        }
                        className={`${cellInput} min-w-0 font-mono font-black text-right ${
                          isHoursOverridden(sal) ? "parttime-hours-manual" : "text-blue-600"
                        }`}
                      />
                      {isHoursOverridden(sal) && (sal.autoAccumulatedHours ?? "") !== "" && (
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => handleRestoreAutoHours(sal)}
                          aria-label={`${sal.name || "이름 없는 행"} 누적시간을 일일마감 집계값으로 되돌리기`}
                          title={`일일마감 집계값 ${sal.autoAccumulatedHours}시간으로 되돌립니다`}
                          className="shrink-0 rounded p-0.5 mr-1 text-gray-300 transition hover:bg-blue-50 hover:text-[#2E6DB4] focus:text-[#2E6DB4] focus:outline-none focus:ring-2 focus:ring-[#2E6DB4]"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className={cellTd(rowIndex, COL_TIPS)}>
                    <input
                      {...cellProps(rowIndex, COL_TIPS)}
                      aria-label={`${sal.name} 팁/기타`}
                      type="text"
                      value={formatWithCommas(sal.tipsEtcAmount || "")}
                      onChange={(e) => handleUpdate(sal.employeeId, "tipsEtcAmount", e.target.value)}
                      placeholder="0"
                      className={`${cellInput} font-mono font-black text-right text-emerald-700`}
                    />
                  </td>
                  {/* 단위(원)는 헤더에 적고 칸에는 숫자만 둔다(DESIGN.md §9-5) — 자릿수가 나란히 읽히고,
                      칸을 복사해 붙일 때도 숫자로 들어간다. 마감 엑셀은 원래 숫자만 넣으므로 표기가 서로 맞는다. */}
                  <td className="border-r border-b border-black/10 py-2.5 px-1.5 text-right font-mono font-black text-gray-700">
                    {formatNumber(Number(sal.calculatedSalary) || 0)}
                  </td>
                  <td className={cellTd(rowIndex, COL_ATTENDANCE)}>
                    <input
                      {...cellProps(rowIndex, COL_ATTENDANCE)}
                      aria-label={`${sal.name} 근무일정`}
                      type="text"
                      value={sal.attendanceDates}
                      onChange={(e) => handleUpdate(sal.employeeId, "attendanceDates", e.target.value)}
                      className={`${cellInput} text-[10px] font-mono text-zinc-600 truncate`}
                      title={`${sal.attendanceDates}${sal.attendanceDates ? "\n" : ""}출근일은 최대 ${PART_TIME_ATTENDANCE_MAX}개까지 적힙니다.`}
                    />
                  </td>
                  <td className={cellTd(rowIndex, COL_MEMO, "min-w-[260px]")}>
                    <input
                      {...cellProps(rowIndex, COL_MEMO)}
                      aria-label={`${sal.name} 기타 비고`}
                      type="text"
                      value={sal.memo}
                      onChange={(e) => handleUpdate(sal.employeeId, "memo", e.target.value)}
                      className={`${cellInput} font-medium placeholder-gray-300`}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
}
