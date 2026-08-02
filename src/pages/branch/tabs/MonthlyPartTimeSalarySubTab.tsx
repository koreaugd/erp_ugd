// src/pages/branch/tabs/MonthlyPartTimeSalarySubTab.tsx  (BranchConfirmPage에서 분리 — 동작 변경 없음)
import { useState, useEffect, useCallback, useRef } from "react";
import { AlertTriangle, Check, Plus, RotateCcw, X } from "lucide-react";
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
  mergeManualPartTimeWork,
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

/**
 * 지점별 급여 저장 직렬화 체인.
 *
 * 화면 자동저장·화면이탈 flush·마감 flush 가 **전부 이 한 줄에 선다.** 따로 돌면 느린 앞 저장이
 * 나중에 도착해 방금 올린 값을 옛 값으로 되돌리고, 그 옛 값이 synced 기준값과 어긋나
 * 다음 병합이 "다른 기기의 수정"으로 오인해 영구히 굳힌다(Codex P0 2026-08-01 — 마감 flush 가
 * 컴포넌트 ref 체인 밖에서 쓰다가 잡힌 시나리오). 컴포넌트 ref 로는 모듈 함수(마감 flush)가
 * 같은 줄에 설 수 없어 모듈 레벨로 올렸다. 모양은 ref 와 같은 { current } 라 쓰는 쪽 코드는 동일하다.
 */
const partTimeSaveChains = new Map<string, { current: Promise<unknown> }>();
const getPartTimeSaveChain = (branchName: string) => {
  let chain = partTimeSaveChains.get(branchName);
  if (!chain) {
    chain = { current: Promise.resolve() };
    partTimeSaveChains.set(branchName, chain);
  }
  return chain;
};

/**
 * 마감 flush 가 '화면에 지금 보이는 그 표'를 확정하도록, 떠 있는 화면이 자기 행 스냅샷 getter 를 등록한다.
 *
 * 이게 없으면 flush 는 로컬 사본('못 올림'일 때)이나 서버 값만 보고 확정한다. 그런데 이 표의 행은
 * 화면에서 매번 다시 조립된다(명부·일일마감·수기근무) — 사용자가 아무것도 안 고친 달은 사본도 pending 도
 * 없어서, 화면에는 새로 집계된 행이 보이는데 **확정은 옛 서버 값으로** 되는 어긋남이 생긴다
 * (Codex 스톱훅 지적 2026-08-02: 표시된 급여대장과 다른 데이터가 확정될 수 있음).
 * 마감 버튼은 이 탭이 떠 있을 때만 보이므로, 화면이 등록한 스냅샷이 곧 사용자가 확정하려는 값이다.
 *
 * reconcileUploaded 는 반대 방향 다리 — 마감 flush 가 올린 최종본을 화면·기준값 상태에 되반영한다.
 * 이게 없으면 flush 가 synced 기준값만 최신(병합본)으로 바꾸고 화면은 옛 값으로 남아, 다음 편집 때
 * "이 기기에서 바뀐 행" 오판으로 다른 기기의 수정을 옛 화면값으로 덮는다(Codex High 2026-08-02).
 * baseline(flush 가 읽어 간 스냅샷)과 지문이 달라진 행 = flush 중 사용자가 고친 행이므로 화면 값을 지킨다.
 */
type PartTimeScreenBridge = {
  snapshot: () => { month: string; rows: PartTimeSalaryRow[] };
  reconcileUploaded: (month: string, baseline: PartTimeSalaryRow[], uploaded: PartTimeSalaryRow[]) => void;
};
const partTimeScreenSnapshots = new Map<string, PartTimeScreenBridge>();

/**
 * 급여 행에서 달과 무관하게 지점에 남길 프로필(주민번호·입사일·은행·계좌·시급)을 추린다.
 * 급여대장을 올리는 모든 경로가 이걸 함께 올려야 다음 달에 시급·계좌가 따라온다.
 * (화면 자동저장·밀린분 재전송·마감 flush 가 같은 함수를 쓴다 — 따로 만들면 한쪽만 어긋난다.)
 */
const buildPartTimeProfiles = (sourceSalaries: PartTimeSalaryRow[]) => {
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
};

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
/**
 * 이 기기의 행이 병합에서 이길 때, **다른 기기가 직접 정한 시간·출근일은 필드 단위로 지킨다.**
 *
 * 병합은 행 단위다 — 내가 memo·시급만 고쳐도 행 전체가 내 버전으로 올라간다. 그런데 내 화면의
 * 시간은 자동 집계값이라, 다른 기기가 hoursOverridden=true 로 직접 적어 둔 예상 시간을 그 업로드가
 * 소리 없이 덮는다(Codex High 2026-08-02 — 같은 행 동시 편집 시나리오). 그래서 행은 내 것을 쓰되
 * '사람이 정한 시간' 필드만 서버 값을 지키고, 금액은 최종 시간으로 다시 계산한다.
 *
 * 단, **이 기기에서 방금 '되돌리기'를 누른 행은 예외다** — 기준값(synced)엔 직접 적은 표시가 있는데
 * 지금은 풀려 있다면 이 기기의 의도된 동작이므로 서버의 true 를 다시 얹지 않는다
 * (reconcileLoadedRow 의 false/undefined 구분과 같은 철학). 기준값이 없으면(옛 캐시) 되돌리기를
 * 구분할 수 없어 서버 수기값을 지키는 쪽을 택한다 — 돈이 걸린 값은 지키는 쪽이 안전하다.
 */
const preserveServerManualFields = (
  localRow: PartTimeSalaryRow,
  serverRow: PartTimeSalaryRow,
  synced: PartTimeSalaryRow | undefined
): PartTimeSalaryRow => {
  const next: PartTimeSalaryRow = { ...localRow };
  let preserved = false;
  const hoursRevertedHere = synced?.hoursOverridden === true && localRow.hoursOverridden !== true;
  if (localRow.hoursOverridden !== true && serverRow.hoursOverridden === true && !hoursRevertedHere) {
    next.accumulatedHours = serverRow.accumulatedHours;
    next.hoursOverridden = true;
    preserved = true;
  }
  const attendanceRevertedHere = synced?.attendanceOverridden === true && localRow.attendanceOverridden !== true;
  if (localRow.attendanceOverridden !== true && serverRow.attendanceOverridden === true && !attendanceRevertedHere) {
    next.attendanceDates = serverRow.attendanceDates;
    next.attendanceOverridden = true;
    preserved = true;
  }
  if (preserved) {
    // 시간이 바뀌었으면 금액도 그 시간으로 — 시간과 금액이 어긋난 채 올라가면 안 된다.
    next.calculatedSalary = computePartTimeSalary(next.hourlyRate, next.accumulatedHours, next.tipsEtcAmount);
    next.actualPaidAmount = syncPartTimeActualPaid(next.actualPaidAmount, next.calculatedSalary);
  }
  return next;
};

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
    // 내 행이 이겨도 다른 기기가 직접 정한 시간·출근일은 필드 단위로 지킨다(위 helper 설명 참고).
    merged.push(changedHere ? preserveServerManualFields(localRow, serverRow, synced) : serverRow);
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

/** 마감 flush 가 막힌 이유. 부르는 쪽(MonthlySettleTab)이 이유별로 다른 안내를 띄운다. */
export type PartTimeCloseBlockReason = "network" | "empty" | "unnamed" | "zeroPaid" | "manualWork";

/**
 * 파트타이머 급여대장 마감제출 전, 이 기기의 미저장 편집분을 서버에 반영 보장한다(정직원 flushFullTimeSalaryForClose 짝).
 *
 * 이 표의 저장에는 불변식이 있다(2026-07-31 Codex 11R에서 확립 — 업로드 경로를 추가하면 반드시 같이 적용):
 *  · 서버 조회는 캐시 폴백 없는 서버 전용(getSharedDataFromServer)만. 실패하면 올리지 않고 마감을 막는다(fail-closed).
 *  · 제외 목록을 확정하기 전에는 급여를 올리지 않는다 — 여기서는 서버(또는 못 올린 로컬 사본)에서 제외를 먼저
 *    확정하고, 그 목록으로 행을 걸러서 올린다. 화면이 제외 미확정 상태로 받아 둔 편집분도 이 필터로 바로잡힌다.
 *  · 통째로 덮지 않는다 — 서버를 읽어 mergePendingLocalRows 로 '이 기기에서 정말 바뀐 행만' 얹는다.
 *  · 사본이 없으면 빈 배열이 아니라 null — 빈 배열을 올리면 서버 대장이 통째로 지워진다.
 *  · '못 올림' 표시는 올리는 동안 사본이 안 바뀌었을 때만 지운다 — 지우면 그 사이 편집이 조용히 사라진다.
 */
export async function flushPartTimeSalaryForClose(
  branchName: string,
  selectedMonth: string
): Promise<{ blocked: boolean; reason?: PartTimeCloseBlockReason }> {
  // 화면이 수기 근무(manual_parttime)를 아직 확정하지 못했으면 마감하지 않는다 — 그 화면의 시간은
  // 실제보다 적을 수 있고, 화면 저장·이탈 flush 는 이 상태에서 업로드를 거부한다. 마감만 열어 두면
  // 그 가드를 우회하는 뒷문이 된다(Codex P0 2026-08-01). 마감 버튼은 이 탭이 떠 있을 때만 보이므로
  // 화면이 게시한 플래그가 곧 진실이다(지점 대조 포함 — 다른 지점의 낡은 플래그는 무시).
  if ((window as any).__ugdPartTimeManualWorkUnresolvedBranch === branchName) {
    return { blocked: true, reason: "manualWork" };
  }
  // 자동저장·화면이탈 flush 와 같은 직렬화 체인에 선다. 밖에서 따로 쓰면 진행 중이던 자동저장이
  // 늦게 끝나며 방금 올린 값을 옛 값으로 되돌리고, synced 기준값과 어긋나 다음 병합이 그 옛 값을
  // "다른 기기의 수정"으로 오인해 영구히 굳힌다(Codex P0 2026-08-01).
  const chain = getPartTimeSaveChain(branchName);
  const task = chain.current.catch(() => {}).then(() => flushPartTimeSalaryForCloseInner(branchName, selectedMonth));
  chain.current = task.catch(() => {});
  return task;
}

async function flushPartTimeSalaryForCloseInner(
  branchName: string,
  selectedMonth: string
): Promise<{ blocked: boolean; reason?: PartTimeCloseBlockReason }> {
  const storageKey = `erp_monthly_part_time_salary_${branchName}_${selectedMonth}`;
  const dataKey = `part_time_salaries:${branchName}:${selectedMonth}`;
  const exclusionStorageKey = `erp_monthly_part_time_exclusions_${branchName}_${selectedMonth}`;
  const exclusionDataKey = `part_time_salary_exclusions:${branchName}:${selectedMonth}`;
  const pendingKey = pendingLocalSaveStorageKey(storageKey);
  const exclusionPendingKey = pendingLocalSaveStorageKey(exclusionStorageKey);
  const syncedKey = `${storageKey}_synced`;
  const readJson = (key: string): any | null => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
  };

  // 1) 제외 목록 확정. 못 올린 로컬 사본이 있으면 그것이 최신(사용자가 서버 확정 후 바꾼 값 — persist 가
  //    확정 전 제외 편집을 거부하므로 이 사본은 항상 확정 후의 것이다). 없으면 서버가 진실.
  const exclusionRaw = localStorage.getItem(exclusionPendingKey) === "1" ? localStorage.getItem(exclusionStorageKey) : null;
  const pendingExclusions: string[] | null = (() => {
    try { const parsed = exclusionRaw ? JSON.parse(exclusionRaw) : null; return Array.isArray(parsed) ? parsed : null; } catch { return null; }
  })();
  let exclusions: string[];
  if (pendingExclusions) {
    exclusions = pendingExclusions;
  } else {
    try {
      const server = await gasClient.getSharedDataFromServer<string[]>(exclusionDataKey);
      exclusions = Array.isArray(server) ? server : [];
    } catch { return { blocked: true, reason: "network" }; }
  }
  const excluded = new Set(exclusions);

  // 2) 서버 급여 행(서버 전용, 실패 시 마감 차단). null = 아직 저장된 적 없는 달.
  let serverRows: PartTimeSalaryRow[] | null = null;
  try {
    const fetched = await gasClient.getSharedDataFromServer<PartTimeSalaryRow[]>(dataKey);
    if (Array.isArray(fetched)) serverRows = fetched.filter((row) => !excluded.has(row.employeeId));
  } catch { return { blocked: true, reason: "network" }; }

  // 3) 확정할 최종 행 결정. **화면 스냅샷이 최우선이다** — 사용자가 보고 확정하는 것은 화면의 표이므로,
  //    화면이 떠 있으면 그 행을 원본으로 병합해 올린다. 로컬 사본/서버만 보면, 아무것도 안 고친 달에
  //    화면에는 새로 집계된 행이 보이는데 확정은 옛 서버 값으로 되는 어긋남이 생긴다(Codex 스톱훅 2026-08-02).
  //    스냅샷이 없거나 달이 다르면(이 함수가 화면 밖에서 불린 비정상 경로) 종전대로 사본/서버 순서.
  const bridge = partTimeScreenSnapshots.get(branchName);
  const snapshot = bridge?.snapshot();
  const screenRows: PartTimeSalaryRow[] | null =
    snapshot && snapshot.month === selectedMonth
      ? toStorableRows(snapshot.rows.filter((row) => !excluded.has(row.employeeId)))
      : null;
  const localRaw = localStorage.getItem(storageKey);
  const localRows: PartTimeSalaryRow[] | null = (() => {
    try { const parsed = localRaw ? JSON.parse(localRaw) : null; return Array.isArray(parsed) ? parsed : null; } catch { return null; }
  })();
  const salaryPending = localStorage.getItem(pendingKey) === "1" && !!localRows;
  // 병합 기준값 — '이 기기에서 정말 바뀐 행'만 서버 위에 얹기 위한 마지막 업로드 성공본.
  const syncedRaw = readJson(syncedKey);
  const syncedById = new Map<string, PartTimeSalaryRow>(
    Array.isArray(syncedRaw) ? syncedRaw.map((row: PartTimeSalaryRow) => [row.employeeId, row]) : []
  );
  let finalRows: PartTimeSalaryRow[];
  let uploadSalary = false;
  if (screenRows && screenRows.length > 0) {
    // 화면의 표를 원본으로 병합해 올린다 — 통째로 덮지 않고, 사람이 고친 행만 서버 위에 얹는다(자동저장과 같은 규칙).
    const merged = mergePendingLocalRows(screenRows, serverRows, syncedById);
    // 병합은 사람이 고친 값만 본다(fingerprint) — 자동 집계 필드(누적시간·출근일·급여)는 비교 밖이라,
    // 아무도 안 고친 행은 서버의 **옛 집계**가 그대로 확정된다(화면 12시간 vs 확정 10시간 — Codex High 2026-08-02).
    // 화면은 방금 일일마감·수기근무로 새로 집계했고 수기근무는 위 게이트가 확정을 보장하므로,
    // 자동 필드만 화면 값으로 덮어 '보이는 표 그대로' 확정한다. 사람이 직접 정한 값
    // (hoursOverridden/attendanceOverridden=true)은 병합 결과를 그대로 둔다 — 다른 기기에서 정한
    // 값일 수 있어 화면 값으로 되돌리면 그 수정을 지운다. 금액은 최종 시간·시급으로 다시 계산해
    // 시간과 금액이 어긋난 채 확정되지 않게 한다(reconcileLoadedRow 와 같은 규칙).
    // 다른 기기의 수기 시간·출근일 보존은 병합 함수(preserveServerManualFields)가 이미 처리했다 —
    // 여기서는 '자동 집계' 필드만 화면의 새 집계값으로 맞춰 확정본 = 보이는 표를 만든다.
    const screenById = new Map(screenRows.map((row) => [row.employeeId, row]));
    finalRows = toStorableRows(merged.map((row) => {
      const onScreen = screenById.get(row.employeeId);
      if (!onScreen) return row; // 다른 기기가 만든, 이 화면에 없는 행 — 병합 결과 그대로.
      const next: PartTimeSalaryRow = { ...row };
      if (next.hoursOverridden !== true) {
        next.accumulatedHours = onScreen.accumulatedHours;
        next.autoAccumulatedHours = onScreen.autoAccumulatedHours;
      }
      if (next.attendanceOverridden !== true) next.attendanceDates = onScreen.attendanceDates;
      next.calculatedSalary = computePartTimeSalary(next.hourlyRate, next.accumulatedHours, next.tipsEtcAmount);
      next.actualPaidAmount = syncPartTimeActualPaid(next.actualPaidAmount, next.calculatedSalary);
      return next;
    }));
    uploadSalary = true;
  } else if (salaryPending && localRows) {
    // 미저장 편집이 있으면 병합해서 올린다 — 방금 지우거나 고친 값이 옛 서버값에 밀려 확정되는 것을 막는다.
    finalRows = toStorableRows(mergePendingLocalRows(localRows.filter((row) => !excluded.has(row.employeeId)), serverRows, syncedById));
    uploadSalary = true;
  } else if (serverRows && serverRows.length > 0) {
    finalRows = serverRows;
  } else if (localRows && localRows.length > 0) {
    // 서버는 비었는데 로컬에 대장이 남아 있으면 복구 저장(레거시 상태 만회 — 정직원 flush 와 같은 단계).
    finalRows = toStorableRows(localRows.filter((row) => !excluded.has(row.employeeId)));
    uploadSalary = true;
  } else {
    return { blocked: true, reason: "empty" };
  }
  if (finalRows.length === 0) return { blocked: true, reason: "empty" };

  // 4) 돈이 새는 상태로는 확정하지 않는다(관리자 엑셀 다운로드 게이트와 같은 취지 — 거기서 막히면
  //    지점은 이미 '확정했다'고 믿은 뒤라 늦다. 제출 순간에 알려 바로 고치게 한다).
  //    확정본(finalRows)과 화면(screenRows) **둘 다** 본다 — 병합은 이 기기에서 안 고친 행을 서버 값으로
  //    두므로, 화면에만 보이는 위반(예: 새로 집계된 근무시간이 있는데 시급이 빈 행)이 확정본 검사만으로는
  //    새어 나갈 수 있다. 사용자가 보는 표에 위반이 보이면 그대로 막는 것이 맞다.
  const trimmedName = (row: PartTimeSalaryRow) => String(row.name || "").trim();
  const gateRows = screenRows ? [...finalRows, ...screenRows] : finalRows;
  if (gateRows.some((row) => !trimmedName(row))) return { blocked: true, reason: "unnamed" };
  if (gateRows.some((row) => trimmedName(row) && Number(row.accumulatedHours) > 0 && !(Number(row.calculatedSalary) > 0))) {
    return { blocked: true, reason: "zeroPaid" };
  }

  // 5) 서버 반영. **제외 목록을 급여보다 먼저 쓴다** — 급여만 성공하고 제외가 실패하면, 제외 기준으로
  //    행이 빠진 급여 문서만 남고 제외 기록이 없어 다른 기기의 재조립이 그 사람을 자동 행으로 되살린다.
  //    반대(제외만 성공)는 무해하다 — 읽는 쪽이 모두 제외 목록으로 행을 거르므로 급여 문서에 남은
  //    행은 어차피 화면·엑셀에서 빠진다(Codex P1 2026-08-01, 부분 성공이 무해해지는 순서).
  try {
    if (pendingExclusions) await gasClient.saveSharedData(exclusionDataKey, pendingExclusions);
    if (uploadSalary) {
      // 급여를 올릴 땐 프로필도 함께(모든 업로드 경로 공통 — 다음 달 시급·계좌가 여기서 따라온다).
      await Promise.all([
        gasClient.saveSharedData(dataKey, finalRows),
        gasClient.saveSharedData(`part_time_profiles:${branchName}`, buildPartTimeProfiles(finalRows)),
      ]);
    }
  } catch { return { blocked: true, reason: "network" }; }

  // 6) 올린 값을 기준값으로 남기고, 올리는 동안 사본이 안 바뀐 경우에만 '못 올림' 표시를 지운다.
  //    (바뀌었으면 표시를 남겨 화면 쪽 재시도가 그 새 값을 올린다 — 여기서 지우면 그 편집이 조용히 사라진다.)
  if (uploadSalary) {
    localStorage.setItem(syncedKey, JSON.stringify(finalRows));
    if (localStorage.getItem(storageKey) === localRaw) {
      localStorage.setItem(storageKey, JSON.stringify(finalRows));
      localStorage.removeItem(pendingKey);
    }
    // 올린 최종본을 화면에도 되반영한다 — 기준값(synced)만 앞서가고 화면이 옛 값으로 남으면,
    // 다음 편집 때 손대지 않은 행까지 "이 기기에서 바뀐 행"으로 오판돼 다른 기기의 수정을 덮는다.
    if (screenRows) bridge?.reconcileUploaded(selectedMonth, screenRows, finalRows);
  }
  if (pendingExclusions && localStorage.getItem(exclusionStorageKey) === exclusionRaw) {
    localStorage.removeItem(exclusionPendingKey);
  }
  return { blocked: false };
}

export function MonthlyPartTimeSalarySubTab({
  branchName,
  selectedMonth,
  history,
  triggerToast,
  isLocked = false
}: {
  branchName: string;
  selectedMonth: string;
  history: any[];
  triggerToast: (msg: string, type?: "success" | "error") => void;
  isLocked?: boolean;
}) {
  const [salaries, setSalaries] = useState<PartTimeSalaryRow[]>([]);
  const [excludedEmployeeIds, setExcludedEmployeeIds] = useState<string[]>([]);
  // 이번 달 근무기록이 아직 없는 인원까지 펼쳐 본다.
  // 말일 낮에 급여대장을 쓰면 그날 저녁 근무가 아직 안 올라와 0시간인 사람이 있는데,
  // 그 행이 안 보이면 예상 시간을 적을 길이 없어 수기 행을 만들게 되고 결국 한 사람이 두 줄이 된다.
  const [showZeroHourRows, setShowZeroHourRows] = useState(false);
  /**
   * 근무일지에 수기로 적은 파트타이머 근무(manual_parttime:<지점>).
   *
   * null = 아직 못 읽음. 빈 배열(= 수기 기록 없음)과 반드시 구분한다 — 못 읽은 것을 '없음'으로
   * 치면 근무시간이 조용히 실제보다 적게 잡힌다(이 탭이 예전에 겪은 실패 방식 그대로다).
   *
   * **어느 지점 것인지 함께 들고 있는다.** 지점을 바꾸면 이 값을 비우는 일이 effect 안에서 일어나는데,
   * 그 전에 같은 커밋의 다른 effect 들이 이미 옛 지점의 배열을 손에 쥔 채 비동기 조회를 시작한다.
   * 그것이 늦게 끝나면 **옛 지점의 수기 근무가 새 지점 급여에 섞인다**(Codex P0 2026-07-31).
   * 그래서 쓰는 쪽에서 지점이 같을 때만 쓴다.
   */
  const [manualWork, setManualWork] = useState<{ branch: string; rows: any[] } | null>(null);
  /** 수기 기록을 못 읽었다는 사실. 화면 위에 경고로 띄워 '정상 집계'로 오해하지 않게 한다. */
  const [manualWorkFailed, setManualWorkFailed] = useState(false);
  /** 경고의 '다시 시도'가 다시 읽게 하는 방아쇠. */
  const [manualWorkReloadKey, setManualWorkReloadKey] = useState(0);
  /**
   * **지금 보고 있는 지점의** 수기 근무만 통과시킨다. 지점이 다르면 아직 안 읽은 것과 같게 다룬다(null).
   * 이 한 줄이 '옛 지점 값 섞임'과 '못 읽음'을 한 자리에서 막는다 — 아래 두 집계와 저장 가드가 모두 이 값을 본다.
   */
  const manualWorkRows = manualWork && manualWork.branch === branchName ? manualWork.rows : null;
  /** 수기 근무를 아직 확정하지 못했다 = 이 화면의 근무시간이 실제보다 적을 수 있다. */
  const manualWorkUnresolved = manualWorkRows === null;
  /**
   * 위 값의 ref 사본. 화면을 떠날 때 도는 flush 는 deps 를 늘리면 리스너를 매번 다시 걸게 되므로
   * (제외 목록이 같은 이유로 ref 를 쓴다) 최신 상태를 여기서 본다.
   */
  const manualWorkUnresolvedRef = useRef(true);
  manualWorkUnresolvedRef.current = manualWorkUnresolved;
  /**
   * 마감 flush(모듈 함수 flushPartTimeSalaryForClose)가 화면의 '수기 근무 미확정' 상태를 볼 수 있게
   * 창에 게시한다(매출집계의 __ugdSalesSummaryInvalid 와 같은 패턴). 미확정인 화면의 시간은 실제보다
   * 적을 수 있어, 그 상태로 마감을 확정하면 급여 누락이 굳는다 — 화면 저장의 fail-closed 가드를
   * 마감 경로에도 똑같이 적용하기 위한 다리다. 지점명을 함께 담아 다른 지점의 낡은 플래그를 걸러 낸다.
   */
  useEffect(() => {
    (window as any).__ugdPartTimeManualWorkUnresolvedBranch = manualWorkUnresolved ? branchName : null;
    return () => { (window as any).__ugdPartTimeManualWorkUnresolvedBranch = null; };
  }, [manualWorkUnresolved, branchName]);
  /** 화면 행의 ref 사본 — 마감 flush 스냅샷이 등록 시점이 아니라 '실행 시점'의 최신 표를 읽게 한다. */
  const salariesRef = useRef<PartTimeSalaryRow[]>([]);
  salariesRef.current = salaries;
  /**
   * 마감 flush 에 '화면에 보이는 표'를 내어 주는 스냅샷 등록. 제출 중에는 표가 잠기므로(부모 isLocked)
   * flush 가 읽는 스냅샷은 사용자가 마지막으로 본 값 그대로다. 달·지점이 바뀌면 다시 등록하고,
   * 화면을 떠나면 지운다 — flush 는 스냅샷이 없으면 종전대로 사본/서버 값으로 동작한다.
   */
  useEffect(() => {
    partTimeScreenSnapshots.set(branchName, {
      snapshot: () => ({ month: selectedMonth, rows: salariesRef.current }),
      // 마감 flush 가 올린 최종본을 화면에 되반영한다. flush 를 시작한 뒤 사용자가 고친 행
      // (baseline 과 지문이 달라진 행)은 화면 값을 지킨다 — 자동저장 완료 지점과 같은 reconcile 규칙.
      reconcileUploaded: (month, baseline, uploaded) => {
        if (month !== selectedMonth) return; // 그 사이 결산월을 옮겼으면 옛 달의 반영은 버린다.
        const baselineById = new Map<string, PartTimeSalaryRow>(baseline.map((row) => [row.employeeId, row]));
        setSalaries((current) => {
          const currentById = new Map<string, PartTimeSalaryRow>(current.map((row) => [row.employeeId, row]));
          const uploadedIds = new Set(uploaded.map((row) => row.employeeId));
          const reconciledRows = uploaded.map((up) => {
            const onScreen = currentById.get(up.employeeId);
            if (!onScreen) return up;
            const base = baselineById.get(up.employeeId);
            if (base && rowFingerprint(onScreen) !== rowFingerprint(base)) return onScreen;
            return up;
          });
          // 올라간 목록에 없는 화면 행(그 사이 추가한 수기 행 등)은 지킨다 — 아직 안 올라갔을 뿐이다.
          return [...reconciledRows, ...current.filter((row) => !uploadedIds.has(row.employeeId))];
        });
      },
    });
    return () => { partTimeScreenSnapshots.delete(branchName); };
  }, [branchName, selectedMonth]);
  /**
   * 이 안내를 이미 띄웠는지. 재시도가 15초마다 돌면서 같은 토스트를 반복하면 화면을 덮어 버린다.
   * 못 읽은 상태는 상단 배너가 계속 말해 주므로, 토스트는 한 번이면 된다.
   */
  const manualWorkToastShownRef = useRef(false);
  /**
   * 지금 수기 근무를 읽는 중인지.
   *
   * 못 읽은 상태에서는 칸을 고칠 때마다 저장이 거부되면서 재조회를 부탁하는데, 그대로 두면
   * **글자 하나 칠 때마다 서버 조회가 새로 뜬다.** 이미 읽는 중이면 그 결과를 기다린다.
   */
  const manualWorkFetchingRef = useRef(false);
  const salaryAutoSaveTimerRef = useRef<number | null>(null);
  /**
   * 저장을 한 줄로 세우는 고리.
   *
   * 저장은 "서버 읽기 → 병합 → 쓰기"라 시간이 걸린다. 여러 저장이 겹치면 느린 앞 저장이 나중에 끝나
   * 옛 값으로 되돌린다("16000"까지 친 뒤 "1600" 저장이 늦게 도착하는 식). 앞 저장이 끝난 뒤에
   * 다음 저장을 시작해 그 역전을 없앤다.
   *
   * 지점별 모듈 체인을 쓴다 — 마감 flush(flushPartTimeSalaryForClose)도 같은 줄에 서야 하기 때문.
   * ref 와 같은 { current } 모양이라 아래 코드는 그대로다.
   */
  const salarySaveChainRef = getPartTimeSaveChain(branchName);
  /** 편집 순번. 저장이 끝난 뒤 "그 사이 또 고쳤는지"를 가려 '못 올림' 표시를 성급히 지우지 않게 한다. */
  const salaryEditSeqRef = useRef(0);
  /** 못 올린 값을 다시 올리려는 타이머. 연결이 끊겼다 돌아오면 스스로 회복한다. */
  const salaryRetryTimerRef = useRef<number | null>(null);
  /**
   * 저장 상태 배지.
   *
   * 예전에는 늘 초록 '자동저장'만 보여줬다. 그런데 서버를 못 읽어 저장을 미룬 동안에도 그대로여서,
   * **안 올라간 값을 올라간 줄 알고** 화면을 닫는 일이 생긴다. 실제 상태를 그대로 보여준다.
   *
   * 처음 값은 '못 올린 표시'가 남아 있는지를 보고 정한다 — 저장을 못 한 채 새로고침했으면
   * 화면을 다시 열어도 여전히 안 올라간 상태이므로, 초록으로 시작하면 또 속게 된다.
   */
  const [salarySaveState, setSalarySaveState] = useState<"saved" | "saving" | "retry">(() => {
    // 제외 목록만 못 올라간 상태도 똑같이 '못 올림'이다. 급여 배열만 보고 초록으로 시작하면,
    // 이 기기에서 제외한 사람이 다른 노트북에서는 자동 행으로 되살아나는데도
    // 저장된 줄 알고 화면을 닫는다(Codex P0 2026-07-31).
    const salaryKey = pendingLocalSaveStorageKey(`erp_monthly_part_time_salary_${branchName}_${selectedMonth}`);
    const exclusionKey = pendingLocalSaveStorageKey(`erp_monthly_part_time_exclusions_${branchName}_${selectedMonth}`);
    return localStorage.getItem(salaryKey) === "1" || localStorage.getItem(exclusionKey) === "1" ? "retry" : "saved";
  });

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

  /** 재시도 실패 때 다시 예약하려면 아래에 정의된 scheduleSalaryRetry 가 필요해 ref 로 이어 준다. */
  const scheduleSalaryRetryRef = useRef<(() => void) | null>(null);

  /**
   * 제외 목록을 **확정했는지** 여부.
   *
   * `excludedEmployeeIds` 의 초기값은 빈 배열인데, 이건 "제외한 사람이 없다"와 "아직 못 읽었다"를
   * 구분하지 못한다. 서버를 못 읽은 채로 그 빈 배열을 저장에 실어 보내면 **서버에 있던 제외 목록이
   * 통째로 지워져** 제외해 둔 사람이 전부 급여대장에 되살아난다(Codex 5R P0 2026-07-31).
   * 그래서 로컬 사본이나 서버 값으로 실제로 확정했을 때만 true 로 올리고, 그 전에는 제외 목록을
   * 아예 건드리지 않는다(급여 저장은 평소대로 진행된다).
   */
  const exclusionsResolvedRef = useRef(false);

  /**
   * 지금 화면이 보고 있는 제외 목록 키. 서버 응답이 늦게 도착했을 때 "아직 같은 달인가"를 가린다.
   * 이게 없으면 7월 조회가 느린 사이 8월로 옮겼을 때, 뒤늦게 온 7월 제외 목록이 8월 화면에 박히고
   * 다음 저장이 그 값을 8월 키로 올려 버린다(Codex 6R P0 2026-07-31).
   */
  const currentExclusionKeyRef = useRef(exclusionDataKey);
  currentExclusionKeyRef.current = exclusionDataKey;

  /**
   * 제외 목록을 이 화면에서 건드린 횟수.
   *
   * 키(달·지점)만 봐서는 **같은 달 안에서** 늦게 온 서버 응답을 걸러낼 수 없다. 조회가 오가는 사이에
   * 사용자가 누군가를 제외하면, 뒤늦게 도착한 옛 서버 목록이 그 제외를 덮고 '못 올림' 표시까지 지운다
   * (Codex 7R P0 2026-07-31). 조회를 시작할 때 이 값을 적어 두고, 응답이 왔을 때 그대로면 그동안
   * 아무도 안 건드린 것이므로 반영해도 된다.
   */
  const exclusionSeqRef = useRef(0);
  /**
   * 진행 중인 서버 조회. 같은 요청을 겹쳐 쏘지 않으려고 공유한다.
   *
   * **키뿐 아니라 세대값도 함께 들고 있어야 한다.** 진행 중인 조회는 시작 시점의 세대값으로
   * 판정하므로, 그 사이 제외가 바뀌었으면 그 조회는 아무것도 반영하지 않고 끝난다. 그런 조회를
   * 키만 보고 새 호출자에게 돌려주면, 그 호출자는 "확정해 달라"고 불렀는데 아무 일도 안 일어난
   * 응답을 성공으로 받는다 — 확정이 안 된 채로 화면이 남는다(Codex 10R 2026-07-31).
   */
  const restoreExclusionsInFlightRef = useRef<{ key: string; seq: number; promise: Promise<void> } | null>(null);

  /**
   * 서버에서 제외 목록을 되받아 화면·로컬 사본·'못 올림' 표시를 한 번에 확정한다.
   * 실패하면 던진다 — 부르는 쪽이 표시를 남긴 채 재시도를 걸도록.
   */
  const restoreExclusionsFromServer = useCallback(() => {
    const inFlight = restoreExclusionsInFlightRef.current;
    // 세대까지 같을 때만 공유한다 — 다르면 그 조회는 no-op 으로 끝날 운명이라 새로 쏴야 한다.
    if (inFlight?.key === exclusionDataKey && inFlight.seq === exclusionSeqRef.current) return inFlight.promise;
    // **캐시 폴백이 없는 서버 전용 조회여야 한다.** getSharedData 로 읽으면 서버에 못 닿아도
    // 던지지 않고 옛 사본이나 빈 값을 돌려줄 수 있는데, 여기서는 그 값을 "서버에 제외가 없다"로
    // 확정해 버리므로 위와 똑같은 유실이 다른 문으로 들어온다.
    const startSeq = exclusionSeqRef.current;
    let restoreTask: Promise<void>;
    restoreTask = (async () => {
      const restored = await gasClient.getSharedDataFromServer<string[]>(exclusionDataKey);
      // 기다리는 사이 달·지점이 바뀌었으면 이 응답은 옛 화면의 것이다. 반영하면 새 달에 지난달 제외가 박힌다.
      if (currentExclusionKeyRef.current !== exclusionDataKey) return;
      // 같은 달이어도, 기다리는 사이 이 화면에서 제외 목록을 건드렸으면 덮으면 안 된다.
      // 덮으면 방금 제외한 사람이 되살아나고 '못 올림' 표시까지 지워져 다시 올라가지도 않는다.
      if (exclusionSeqRef.current !== startSeq) return;
      // 여기서의 빈 배열은 "아직 저장된 제외 목록이 없다"가 확실하다(서버가 실제로 그렇게 답했다).
      const restoredExclusions = Array.isArray(restored) ? restored : [];
      setExcludedEmployeeIds(restoredExclusions);
      localStorage.setItem(exclusionStorageKey, JSON.stringify(restoredExclusions));
      localStorage.removeItem(exclusionPendingKey);
      exclusionsResolvedRef.current = true;
      if (localStorage.getItem(salaryPendingKey) !== "1") setSalarySaveState("saved");
    })().finally(() => {
      if (restoreExclusionsInFlightRef.current?.promise === restoreTask) {
        restoreExclusionsInFlightRef.current = null;
      }
    });
    restoreExclusionsInFlightRef.current = { key: exclusionDataKey, seq: startSeq, promise: restoreTask };
    return restoreTask;
  }, [exclusionDataKey, exclusionPendingKey, exclusionStorageKey, salaryPendingKey]);

  /**
   * 제외 목록만 따로 올린다.
   *
   * 평소에는 급여와 제외가 한 번에 올라가므로 이 경로를 탈 일이 없다. 다만 브라우저가 저장 공간을
   * 정리하며 급여 사본만 지워 가면, 제외는 '못 올림'인데 급여 경로로는 다시 올릴 수가 없어
   * 화면을 열어 둔 채로는 영영 안 올라간다(Codex 2R P0 2026-07-31). 그 막다른 길을 막는다.
   */
  const retryExclusionsOnly = useCallback(() => {
    if (localStorage.getItem(exclusionPendingKey) !== "1") return;
    const savedExclusions = localStorage.getItem(exclusionStorageKey);
    // 올릴 사본조차 없으면 올릴 것이 없다. 그렇다고 그냥 물러나면 이 화면에서는 제외 목록이
    // 영영 확정되지 않고, 그 사이 화면의 빈 목록이 다음 편집에 섞여 서버 제외 목록을 지운다
    // (Codex 5R P0). 서버에서 되받아 확정한다 — 실패하면 표시를 남긴 채 재시도를 건다.
    if (!savedExclusions) {
      restoreExclusionsFromServer().catch((error) => {
        console.warn("제외 목록을 서버에서 되받지 못했습니다.", error);
        scheduleSalaryRetryRef.current?.();
      });
      return;
    }
    try {
      const parsed = JSON.parse(savedExclusions);
      if (!Array.isArray(parsed)) return;
      gasClient.saveSharedData(exclusionDataKey, parsed)
        .then(() => {
          // **올리는 동안 사용자가 또 제외했으면 로컬 사본이 바뀐다.**
          // 그때도 '못 올림' 표시를 지우면, 방금 제외한 사람은 서버에 올라간 적이 없는데도
          // 올라간 것으로 취급돼 다른 노트북에서 급여대장에 도로 나타난다(Codex 3R P0 2026-07-31).
          // 이 경로는 저장 체인 밖에서 혼자 도는 저장이라, 여기서 직접 최신 여부를 확인해야 한다.
          if (localStorage.getItem(exclusionStorageKey) !== savedExclusions) {
            scheduleSalaryRetryRef.current?.(); // 더 새 값이 밀려 있으니 그걸 다시 올린다.
            return;
          }
          localStorage.removeItem(exclusionPendingKey);
          if (localStorage.getItem(salaryPendingKey) !== "1") setSalarySaveState("saved");
        })
        .catch((error) => {
          console.warn("제외 목록을 다시 올리지 못했습니다.", error);
          scheduleSalaryRetryRef.current?.(); // 한 번 실패했다고 놓으면 그대로 멈춘다.
        });
    } catch { /* 손상된 사본은 다음 편집 때 새로 쓰인다 */ }
  }, [exclusionDataKey, exclusionPendingKey, exclusionStorageKey, restoreExclusionsFromServer, salaryPendingKey]);

  /**
   * 못 올린 값을 다시 올린다.
   *
   * 저장을 미루거나 실패했을 때 이걸 예약해 두지 않으면, 사용자가 그 화면에 그대로 머무는 한
   * 적어 둔 값이 **영영 서버에 올라가지 않는다.** 화면에는 아무 일 없어 보이는 것이 특히 위험하다.
   * localStorage에 남은 최신값을 그대로 다시 올리므로, 재시도 사이에 더 고쳤어도 그 값이 올라간다.
   */
  const scheduleSalaryRetry = useCallback(() => {
    setSalarySaveState("retry");
    if (salaryRetryTimerRef.current) window.clearTimeout(salaryRetryTimerRef.current);
    salaryRetryTimerRef.current = window.setTimeout(() => {
      salaryRetryTimerRef.current = null;
      // 제외가 아직 확정 안 됐으면 그것부터 다시 확정한다 — 확정 전에는 업로드가 보류되므로,
      // 이걸 안 하면 재시도가 보류만 반복하며 영영 빠져나오지 못한다(Codex 8R P0 2026-07-31).
      if (!exclusionsResolvedRef.current) {
        restoreExclusionsFromServer().catch((error) => {
          console.warn("제외 목록 확정을 다시 시도했지만 실패했습니다.", error);
        });
      }
      // 그 사이 다른 저장이 성공해 '못 올림' 표시가 지워졌으면 할 일이 없다.
      // 제외 목록도 함께 본다 — persistPartTimeSalaries 는 급여와 제외를 한 번에 올리므로,
      // 제외만 밀려 있어도 이 재시도로 같이 올라간다.
      if (localStorage.getItem(salaryPendingKey) !== "1"
        && localStorage.getItem(exclusionPendingKey) !== "1") { setSalarySaveState("saved"); return; }
      const saved = localStorage.getItem(salaryStorageKey);
      // 급여 사본이 없으면 급여 경로로는 올릴 수 없다. 제외만 밀려 있는 경우를 여기서 따로 구제한다.
      if (!saved) { retryExclusionsOnly(); return; }
      try {
        const rows = JSON.parse(saved);
        if (Array.isArray(rows)) persistPartTimeSalariesRef.current?.(rows, undefined, false);
      } catch (error) {
        console.warn("다시 올릴 급여대장을 읽지 못했습니다.", error);
      }
    }, 15000);
  }, [exclusionPendingKey, restoreExclusionsFromServer, retryExclusionsOnly, salaryPendingKey, salaryStorageKey]);

  scheduleSalaryRetryRef.current = scheduleSalaryRetry;

  /** 재시도가 persistPartTimeSalaries 를 부르는데, 그 함수가 아래에 정의되므로 ref 로 이어 준다. */
  const persistPartTimeSalariesRef = useRef<((rows: PartTimeSalaryRow[], excluded?: string[], showToast?: boolean) => void) | null>(null);

  const persistPartTimeSalaries = useCallback((nextSalaries: PartTimeSalaryRow[], explicitExcluded?: string[], showToast = false) => {
    // 제외 목록을 **사용자가 직접 바꾼 호출**인지, 급여만 고친 호출인지 구분한다.
    // 자동 재시도 경로는 undefined 를 넘기므로 여기서 false 가 되고, 화면의 제외 목록이 그대로 쓰인다.
    const isExclusionEdit = explicitExcluded !== undefined;
    const nextExcluded = explicitExcluded ?? excludedEmployeeIds;
    // **제외를 저장할 수 없으면 아무것도 하지 않고 물러난다.**
    // 예전에는 안내만 띄우고 급여 저장은 그대로 진행했는데, 그러면 화면에서는 그 사람이 빠지고
    // 급여 배열도 그대로 저장돼 초록 '자동저장'까지 뜬다. 정작 제외는 서버에 없으니 다음 재조립 때
    // 되살아난다 — 사용자는 저장됐다고 믿는데 결과가 다르다(Codex 6R P0 2026-07-31).
    if (isExclusionEdit && !exclusionsResolvedRef.current) {
      triggerToast("제외 목록을 아직 불러오지 못해 이 변경을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.", "error");
      restoreExclusionsFromServer().catch((error) => {
        console.warn("제외 목록 확정을 다시 시도했지만 실패했습니다.", error);
      });
      return false;
    }
    // **수기 근무를 아직 확정하지 못했으면 저장하지 않는다.**
    // 이 상태의 화면은 근무시간이 실제보다 적게 잡혀 있다. 그대로 저장하면 그 값이 서버에 올라가고
    // 다른 기기·마감이 그걸 정상값으로 읽는다. 더 나쁜 것은, 사용자가 그 적은 숫자를 보고 시간칸을
    // 직접 고치면 '사람이 정한 값'으로 굳어져 이후 집계가 고쳐 주지도 못한다는 점이다.
    // (제외 목록과 같은 fail-closed 규칙 — Codex P0 2026-07-31)
    if (manualWorkUnresolved) {
      // 안내는 한 번만. 아래 재시도가 15초마다 이 자리를 다시 지나므로, 매번 띄우면 토스트가 화면을 덮는다.
      if (!manualWorkToastShownRef.current) {
        manualWorkToastShownRef.current = true;
        triggerToast("근무일지의 수기 근무를 아직 불러오지 못해 저장하지 않았습니다. 화면 위 [다시 시도]를 눌러주세요.", "error");
      }
      // 이미 읽는 중이면 또 부탁하지 않는다 — 안 그러면 글자 하나마다 조회가 새로 뜬다.
      if (!manualWorkFetchingRef.current) setManualWorkReloadKey((key) => key + 1);
      // **재시도를 다시 걸어 둔다.** 이 자리는 '못 올림' 표시가 남은 재시도 경로도 지나간다.
      // 여기서 그냥 물러나면 그 재시도는 끝나 버리고, 나중에 수기 근무를 읽는 데 성공해도
      // 아무도 다시 올리지 않는다 — 적어 둔 값이 영영 서버에 안 올라간 채 화면만 멀쩡해진다
      // (Codex 2R P0 2026-07-31). 표시가 없으면 재시도가 스스로 할 일 없음을 보고 끝낸다.
      scheduleSalaryRetry();
      return false;
    }
    // 이 편집의 순번. 저장이 끝났을 때 그 사이 새 편집이 있었는지 이걸로 가린다.
    // (앞 저장 성공이 '못 올림' 표시를 지워 버리면, 그 사이 친 값이 아직 안 올라갔는데도
    //  올라간 것으로 취급돼 탭을 옮기는 순간 사라진다.)
    const editSeq = ++salaryEditSeqRef.current;
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
    // 제외 목록을 아직 확정하지 못했으면(서버를 못 읽은 채 화면이 열린 상태) **손대지 않는다.**
    // 이때 화면의 제외 목록은 빈 배열인데, 그걸 저장하면 서버에 있던 제외 목록이 통째로 지워진다.
    // 급여 저장은 그대로 진행한다.
    localStorage.setItem(salaryStorageKey, JSON.stringify(nextSalaries));
    localStorage.setItem(salaryPendingKey, "1");
    // **급여만 고친 저장은 제외 목록을 건드리지 않는다.** 다시 쓰지도, '못 올림'을 켜지도,
    // 세대를 올리지도 않는다. 예전에는 매 저장마다 화면의 제외 목록을 다시 썼는데, 그러면
    // 서버에서 막 받아온 최신 제외가 화면의 옛 목록으로 덮이고, 진행 중이던 서버 조회까지
    // 세대가 바뀌었다는 이유로 취소된다(stop-hook 지적 2026-07-31).
    if (isExclusionEdit) {
      // 사용자가 제외를 바꿨다는 표시. 이미 떠 있는 서버 조회가 이 값을 덮지 못하게 막는다.
      exclusionSeqRef.current += 1;
      localStorage.setItem(exclusionStorageKey, JSON.stringify(nextExcluded));
      localStorage.setItem(exclusionPendingKey, "1");
    }
    if (salaryAutoSaveTimerRef.current) window.clearTimeout(salaryAutoSaveTimerRef.current);
    setSalarySaveState("saving");
    // **제외 목록을 확정하기 전에는 서버로 올리지 않는다.**
    // 이 시점의 행 구성은 제외 목록을 기준으로 만들어지는데, 아직 그 목록을 모르면
    // 지금 화면이 이번 달에 맞는 구성이라고 보증할 수 없다. 그대로 올리면 이번 달 급여대장이
    // 잘못된 기준으로 저장된다(stop-hook 지적 2026-07-31).
    // 적어 둔 값은 위에서 localStorage 와 '못 올림' 표시로 남겨 뒀으므로 잃지 않는다 —
    // 제외가 확정된 뒤 재시도가 올바른 구성으로 올린다.
    if (!exclusionsResolvedRef.current) {
      // **확정 자체를 다시 시도해야 여기서 빠져나온다.** 재시도만 걸면 그 재시도가 다시 이 자리로
      // 돌아와 보류만 반복하고, 적어 둔 값은 영영 안 올라간다(Codex 8R P0 2026-07-31).
      restoreExclusionsFromServer().catch((error) => {
        console.warn("제외 목록 확정을 다시 시도했지만 실패했습니다.", error);
      });
      scheduleSalaryRetry();
      return true;
    }
    salaryAutoSaveTimerRef.current = window.setTimeout(() => {
      // toStorableRows: 값이 없는 칸(undefined)을 걷어낸다. 하나라도 섞이면 Firestore가 저장을 통째로 거부한다.
      const storableSalaries = toStorableRows(nextSalaries);
      // **평상시 저장도 통째로 덮지 않는다.**
      // 이 표는 배열 하나를 통째로 쓰기 때문에, 그냥 저장하면 그 사이 다른 노트북이 고친 행까지
      // 내 화면의 옛 값으로 되돌아간다. 예전에는 시급이 15,000 고정이라 덮여도 같은 값이었지만,
      // 이제는 사람마다 다른 시급을 손으로 넣으므로 덮이는 순간 그 사람 급여가 통째로 틀어진다.
      // 그래서 올리기 직전에 서버를 읽어, 기준값과 견줘 **이 기기에서 실제로 바뀐 행만** 얹는다.
      // 서버를 못 읽으면 종전대로 올린다 — 적어 둔 값을 잃지 않는 쪽이 먼저다.
      salarySaveChainRef.current = salarySaveChainRef.current.catch(() => {}).then(async () => {
        try {
          let serverRows: PartTimeSalaryRow[] | null = null;
          try {
            // **반드시 서버 전용 조회**(getSharedDataFromServer)를 쓴다. 캐시 폴백이 있는 getSharedData로 읽으면
            // 오프라인·일시 실패 때 옛 사본을 "서버 최신"으로 착각해, 다른 기기가 방금 올린 수정을 못 본 채
            // 내 값으로 덮어쓴다 — 병합한다고 해 놓고 정작 덮어쓰는 꼴이 된다.
            // (null = 아직 저장된 적 없는 달. 병합할 것이 없으니 그대로 올린다.)
            const fetched = await gasClient.getSharedDataFromServer<PartTimeSalaryRow[]>(salaryDataKey);
            if (Array.isArray(fetched)) serverRows = fetched;
          } catch (error) {
            // 서버 상태를 모르는 채로 표 전체를 올리면 다른 기기의 수정이 소리 없이 사라진다.
            // 그런데 화면에는 "저장되었습니다"가 뜨니 아무도 알아채지 못한다 — 그래서 저장을 **미룬다.**
            // 미루기만 하고 끝내면 그 값은 영영 안 올라가므로, 여기서 **다시 시도를 예약**한다.
            console.warn("저장 전 서버 급여대장을 읽지 못해 저장을 미뤘습니다.", error);
            scheduleSalaryRetry();
            triggerToast("연결이 불안정해 저장을 잠시 미뤘습니다. 적으신 내용은 그대로 있고 곧 다시 저장됩니다.", "error");
            return;
          }
          const mergedRows = toStorableRows(mergePendingLocalRows(storableSalaries, serverRows, readSyncedRows()));
          // 아직 못 올린 제외 목록이 있으면 이 저장에 실어 함께 올린다.
          // **화면 값이 아니라 저장된 사본을 올린다** — 화면 값은 그 사이 달 전환 등으로 비워졌을 수 있다.
          // (제외를 바꾼 저장이면 위에서 방금 그 사본을 써 뒀으므로 같은 값이다.)
          const pendingExclusionsRaw = localStorage.getItem(exclusionPendingKey) === "1"
            ? localStorage.getItem(exclusionStorageKey)
            : null;
          let exclusionsToUpload: string[] | null = null;
          if (pendingExclusionsRaw) {
            try {
              const parsed = JSON.parse(pendingExclusionsRaw);
              if (Array.isArray(parsed)) exclusionsToUpload = parsed;
            } catch { /* 손상된 사본은 올리지 않는다 — 표시가 남아 다음에 다시 다룬다 */ }
          }
          await Promise.all([
            gasClient.saveSharedData(salaryDataKey, mergedRows),
            gasClient.saveSharedData(`part_time_profiles:${branchName}`, buildPartTimeProfiles(mergedRows)),
            ...(exclusionsToUpload ? [gasClient.saveSharedData(exclusionDataKey, exclusionsToUpload)] : [])
          ]);
          // 방금 올린 값을 기준값으로 남긴다 — 다음 저장 때 "이 기기에서 정말 바뀐 행"만 골라
          // 상대의 수정을 덮지 않기 위해서다.
          localStorage.setItem(salarySyncedKey, JSON.stringify(mergedRows));
          // **화면도 올린 값으로 맞춘다.** 이걸 빠뜨리면 병합이 무의미해진다 —
          // 병합에서 다른 기기 수정을 받아들여 놓고 화면은 옛 값 그대로면, 다음 저장 때
          // "이 기기에서 바뀐 행"으로 잘못 판정해 방금 받아들인 상대 수정을 도로 덮는다.
          //
          // 반드시 **올린 목록(mergedRows)을 기준으로** 다시 만든다. 화면 목록만 훑으면
          // 다른 기기가 새로 추가한 행이 화면에 안 들어오는데 기준값에는 들어 있어서,
          // 다음 저장 때 "이 기기에서 지운 행"으로 오해받아 서버에서 사라진다(급여 누락).
          const atSaveTimeById = new Map<string, PartTimeSalaryRow>(storableSalaries.map((row) => [row.employeeId, row]));
          setSalaries((current) => {
            const currentById = new Map<string, PartTimeSalaryRow>(current.map((row) => [row.employeeId, row]));
            const mergedIds = new Set(mergedRows.map((row) => row.employeeId));
            const reconciledRows = mergedRows.map((merged) => {
              const onScreen = currentById.get(merged.employeeId);
              if (!onScreen) return merged; // 다른 기기가 추가한 행 — 화면에 들인다
              const atSaveTime = atSaveTimeById.get(merged.employeeId);
              // 저장을 예약한 뒤 사용자가 또 고친 행은 화면 값을 지킨다(그건 다음 저장이 올린다).
              if (atSaveTime && rowFingerprint(onScreen) !== rowFingerprint(atSaveTime)) return onScreen;
              return merged;
            });
            // 저장을 예약한 뒤 새로 추가한 행도 지킨다(아직 올라가지 않았을 뿐이다).
            return [...reconciledRows, ...current.filter((row) => !mergedIds.has(row.employeeId))];
          });
          // 그 사이 새 편집이 있었으면 '못 올림' 표시와 로컬 사본을 건드리지 않는다.
          // 지워 버리면 아직 안 올라간 값이 올라간 것으로 취급돼, 탭을 옮기는 순간 사라진다.
          if (editSeq === salaryEditSeqRef.current) {
            localStorage.setItem(salaryStorageKey, JSON.stringify(mergedRows));
            localStorage.removeItem(salaryPendingKey);
            // 제외 표시는 **이 저장이 실제로 올린 경우에만** 지운다. 안 올렸는데 지우면
            // 아직 서버에 없는 제외가 올라간 것으로 취급돼 다시 시도되지 않는다.
            // 올리는 사이 사용자가 또 제외했으면(사본이 바뀌었으면) 그것도 남겨 둔다.
            if (exclusionsToUpload && localStorage.getItem(exclusionStorageKey) === pendingExclusionsRaw) {
              localStorage.removeItem(exclusionPendingKey);
            }
            // 제외가 아직 안 올라갔으면 초록으로 돌리지 않는다 — 다 저장된 것처럼 보이면 안 된다.
            if (localStorage.getItem(exclusionPendingKey) !== "1") setSalarySaveState("saved");
          }
          if (showToast) triggerToast("파트타이머 급여대장이 저장되었습니다.", "success");
        } catch {
          // 올리기 자체가 실패했을 때도 다시 시도한다 — 한 번 실패하고 끝나면 그 값은 서버에 없다.
          scheduleSalaryRetry();
          triggerToast("급여지급 대장 자동저장 실패 — 잠시 후 다시 시도합니다.", "error");
        }
      });
    }, 500);
    return true; // 편집을 받아들였다. 부르는 쪽이 성공 안내를 띄워도 되는지 이걸로 가린다.
  }, [branchName, excludedEmployeeIds, exclusionDataKey, exclusionPendingKey, exclusionStorageKey, manualWorkUnresolved, readSyncedRows, restoreExclusionsFromServer, salaryDataKey, salaryPendingKey, salaryStorageKey, salarySyncedKey, scheduleSalaryRetry, triggerToast]);

  // 재시도 타이머가 부를 수 있게 최신 저장 함수를 ref 에 담아 둔다.
  persistPartTimeSalariesRef.current = persistPartTimeSalaries;

  // 연결이 돌아오면 곧바로 다시 올린다 — 15초 타이머를 기다리지 않는다.
  useEffect(() => {
    const retryNow = () => {
      // 제외 목록만 밀려 있는 경우도 여기서 같이 올린다 — 급여 배열만 보면 그 상태를 놓친다.
      if (localStorage.getItem(salaryPendingKey) !== "1"
        && localStorage.getItem(exclusionPendingKey) !== "1") return;
      const saved = localStorage.getItem(salaryStorageKey);
      // 급여 사본이 없으면 급여 경로로는 못 올린다 — 제외만 밀려 있는 경우를 따로 구제한다.
      if (!saved) { retryExclusionsOnly(); return; }
      try {
        const rows = JSON.parse(saved);
        if (Array.isArray(rows)) persistPartTimeSalariesRef.current?.(rows, undefined, false);
      } catch { /* 손상된 사본은 다음 편집 때 새로 쓰인다 */ }
    };
    window.addEventListener("online", retryNow);
    return () => {
      window.removeEventListener("online", retryNow);
      if (salaryRetryTimerRef.current) {
        window.clearTimeout(salaryRetryTimerRef.current);
        salaryRetryTimerRef.current = null;
      }
    };
  }, [exclusionPendingKey, retryExclusionsOnly, salaryPendingKey, salaryStorageKey]);

  useEffect(() => {
    // **화면을 떠나는 순간에도 밀린 저장을 내보낸다.**
    // 값을 적으면 localStorage 에는 즉시 들어가지만 클라우드 전송은 500ms 타이머 뒤에 시작한다.
    // 언마운트 cleanup 만 걸어 두면, 탭 닫기·새로고침·모바일 백그라운드 전환처럼 React 가
    // 정리 함수를 돌리지 못하는 경로에서 그 500ms 안의 입력이 이 기기에만 남는다. 31일 낮에 적어 둔
    // 예측 근무시간이 그렇게 사라지면, 본사 마감 엑셀은 자동 집계값으로 급여를 계산한다(Codex P0 2026-07-31).
    // 주류재고 탭(LiquorInventoryTabV2)에서 쓰는 것과 같은 배선이다.
    const chainFlush = () => {
      if (salaryAutoSaveTimerRef.current) {
        window.clearTimeout(salaryAutoSaveTimerRef.current);
        salaryAutoSaveTimerRef.current = null;
      }
      // **이 정리 저장도 자동저장과 같은 줄에 세운다.**
      // 따로 돌면 진행 중이던 자동저장과 겹쳐, 완료 순서에 따라 옛 값이 나중에 도착해 최신 편집을 덮는다.
      // 앞 저장이 끝난 뒤에 실행되므로, 그 저장이 이미 다 올려 pending이 지워졌으면 여기서는 아무것도 안 한다.
      salarySaveChainRef.current = salarySaveChainRef.current.catch(() => {}).then(() => runPendingFlush());
    };
    // visibilitychange(hidden)가 탭 닫기·새로고침·모바일 백그라운드 전환에서 가장 안정적으로 발동한다.
    const handleVisibility = () => { if (document.visibilityState === "hidden") chainFlush(); };
    window.addEventListener("beforeunload", chainFlush);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", chainFlush);
    return () => {
      window.removeEventListener("beforeunload", chainFlush);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", chainFlush);
      chainFlush();
    };

    /** 밀린 편집분을 올린다. 체인이 이 저장을 기다리도록 promise를 돌려준다. */
    function runPendingFlush(): Promise<unknown> {
      const salaryPending = localStorage.getItem(salaryPendingKey) === "1";
      const exclusionPending = localStorage.getItem(exclusionPendingKey) === "1";
      if (!salaryPending && !exclusionPending) return Promise.resolve();
      // 제외 목록을 확정하기 전에는 여기서도 올리지 않는다(자동저장 경로와 같은 규칙).
      // '못 올림' 표시가 그대로 남아 다음 진입 때 올바른 구성으로 올라간다.
      if (!exclusionsResolvedRef.current) return Promise.resolve();
      // 수기 근무를 확정하기 전에도 올리지 않는다(자동저장 경로와 같은 fail-closed 규칙).
      // 이 경로는 화면을 떠날 때 도는데, 여기만 열려 있으면 저장 화면에서는 막아 둔 값이
      // 탭을 옮기는 것만으로 서버에 올라간다 — 가드를 우회하는 뒷문이 된다(Codex 2R P0 2026-07-31).
      // '못 올림' 표시는 그대로 남아, 수기 근무를 읽은 뒤 재시도가 올바른 값으로 올린다.
      if (manualWorkUnresolvedRef.current) return Promise.resolve();

      const savedSalaries = localStorage.getItem(salaryStorageKey);
      const savedExclusions = localStorage.getItem(exclusionStorageKey);
      try {
        // **사본이 없으면 빈 배열이 아니라 null 이다.**
        // 빈 배열로 두면 '못 올림' 표시만 남고 사본이 사라진 상태(브라우저가 저장 공간을 정리하면
        // 그렇게 된다)에서 빈 배열을 그대로 올려 **서버의 급여대장과 제외 목록이 통째로 지워진다.**
        // null 이면 아래 Array.isArray 검사에서 걸러져 올리지 않고, 표시만 정리된다.
        const pendingSalaries = savedSalaries ? JSON.parse(savedSalaries) : null;
        const pendingExclusions = savedExclusions ? JSON.parse(savedExclusions) : null;
        const saveTasks: Promise<unknown>[] = [];
        // 실제로 올린 병합본. 성공 후 로컬 작업본·화면을 이 값으로 맞추는 데 쓴다(아래 설명).
        let uploadedMerged: PartTimeSalaryRow[] | null = null;
        if (salaryPending && Array.isArray(pendingSalaries)) {
          // 탭을 옮기며 올릴 때도 통째로 덮으면 그 사이 다른 기기가 고쳐 둔 것이 지워진다.
          // 올리기 전에 서버를 읽어 **이 기기에서 실제로 바뀐 행만** 얹는다(자동저장 경로와 같은 규칙).
          // **서버를 못 읽으면 올리지 않는다** — 서버 상태를 모른 채 덮으면 상대의 수정이 소리 없이 사라진다.
          // 못 올린 표시(pending)가 남아 다음 진입 때 다시 시도하므로, 적어 둔 값은 잃지 않는다.
          const syncedById = readSyncedRows();
          saveTasks.push(
            // 서버 전용 조회 — 캐시 폴백으로 옛 사본을 읽으면 병합이 상대 수정을 덮는 결과가 된다.
            gasClient.getSharedDataFromServer<PartTimeSalaryRow[]>(salaryDataKey)
              .then((server) => {
                const merged = toStorableRows(
                  mergePendingLocalRows(pendingSalaries as PartTimeSalaryRow[], Array.isArray(server) ? server : null, syncedById)
                );
                return Promise.all([
                  gasClient.saveSharedData(salaryDataKey, merged),
                  gasClient.saveSharedData(`part_time_profiles:${branchName}`, buildPartTimeProfiles(merged))
                ]).then(() => {
                  // 올린 것과 같은 값을 기준값으로 남긴다. 안 남기면 다음 재시도 때
                  // 이미 올린 행까지 "이 기기에서 바뀐 행"으로 잡혀 상대의 수정을 덮는다.
                  localStorage.setItem(salarySyncedKey, JSON.stringify(merged));
                  uploadedMerged = merged;
                });
              })
          );
        }
        if (exclusionPending && Array.isArray(pendingExclusions)) {
          saveTasks.push(gasClient.saveSharedData(exclusionDataKey, pendingExclusions));
        }
        return Promise.all(saveTasks)
          .then(() => {
            // **올리는 동안 사용자가 더 고쳤으면 그 표시를 지우면 안 된다.**
            // 이 flush 는 화면을 떠날 때 시작되는데, 잠깐 다른 앱을 봤다 돌아와 이어서 고치는 일이 흔하다.
            // 그때 여기서 '못 올림' 표시를 지우면 새로 고친 값은 올라간 적이 없는데도 올라간 것으로
            // 취급돼 조용히 사라진다. 시작 시점에 읽어 둔 사본과 같을 때만 지운다 —
            // 다르면 표시가 남아 다음 진입·재시도 때 그 새 값이 올라간다.
            // (사본이 아예 없던 경우도 null === null 로 같아 표시가 정리된다.)
            if (salaryPending && localStorage.getItem(salaryStorageKey) === savedSalaries) {
              // **로컬 작업본도 올린 병합본으로 맞춘다.** 기준값(synced)만 병합본으로 앞서가고 작업본·화면이
              // 옛 값으로 남으면, 돌아와서 아무 칸이나 고칠 때 손대지 않은 행까지 지문이 달라져
              // "이 기기에서 바뀐 행"으로 오판돼 다른 기기의 수정을 옛값으로 덮는다(Codex High 2026-08-02).
              if (uploadedMerged) localStorage.setItem(salaryStorageKey, JSON.stringify(uploadedMerged));
              localStorage.removeItem(salaryPendingKey);
            }
            if (exclusionPending && localStorage.getItem(exclusionStorageKey) === savedExclusions) {
              localStorage.removeItem(exclusionPendingKey);
            }
            // 화면도 병합본으로 맞춘다 — flush 시작 후 사용자가 고친 행(지문 변화)은 화면 값을 지킨다
            // (자동저장 완료 지점과 같은 reconcile). 언마운트 뒤라면 setSalaries 는 조용히 무시된다.
            if (uploadedMerged && Array.isArray(pendingSalaries)) {
              const baselineById = new Map<string, PartTimeSalaryRow>(
                (pendingSalaries as PartTimeSalaryRow[]).map((row) => [row.employeeId, row])
              );
              const uploadedRows = uploadedMerged;
              setSalaries((current) => {
                const currentById = new Map<string, PartTimeSalaryRow>(current.map((row) => [row.employeeId, row]));
                const uploadedIds = new Set(uploadedRows.map((row) => row.employeeId));
                const reconciledRows = uploadedRows.map((up) => {
                  const onScreen = currentById.get(up.employeeId);
                  if (!onScreen) return up;
                  const base = baselineById.get(up.employeeId);
                  if (base && rowFingerprint(onScreen) !== rowFingerprint(base)) return onScreen;
                  return up;
                });
                return [...reconciledRows, ...current.filter((row) => !uploadedIds.has(row.employeeId))];
              });
            }
          })
          .catch((error) => {
            console.warn("Pending part-time salary save failed during tab change.", error);
          });
      } catch (error) {
        console.warn("Pending part-time salary data could not be parsed during tab change.", error);
        return Promise.resolve();
      }
    }
  }, [branchName, exclusionDataKey, exclusionPendingKey, exclusionStorageKey, readSyncedRows, salaryDataKey, salaryPendingKey, salaryStorageKey, salarySyncedKey]);

  useEffect(() => {
    let active = true;
    // 달·지점이 바뀌면 확정 상태도 처음으로 돌린다. 안 그러면 지난달에 확정한 표시가 남아,
    // 이번 달 제외 목록을 아직 못 읽었는데도 화면의 빈 배열을 저장에 실어 보낸다.
    exclusionsResolvedRef.current = false;
    // 화면의 제외 목록도 함께 비운다. **지난달 제외가 그대로 남으면 그게 이번 달 행 구성에 쓰여**,
    // 이번 달에는 제외 대상이 아닌 사람이 빠진 채로 급여대장이 저장된다(stop-hook 지적 2026-07-31).
    // 비워 두면 잠깐 전원이 보일 뿐이고, 바로 아래에서 이번 달 값으로 채운다.
    setExcludedEmployeeIds([]);
    const loadExclusions = async () => {
      try {
        const local = localStorage.getItem(exclusionStorageKey);
        const hasPendingExclusions = localStorage.getItem(exclusionPendingKey) === "1";
        if (local && active) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed)) {
            setExcludedEmployeeIds(parsed);
            exclusionsResolvedRef.current = true; // 사본으로 확정됐다 — 이제 저장에 실어도 된다.
          }
          if (hasPendingExclusions) {
            await gasClient.saveSharedData(exclusionDataKey, parsed);
            // 올리는 동안 사용자가 또 제외했으면 사본이 바뀐다. 그때 '못 올림' 표시를 지우면
            // 그 새 제외는 올라간 적이 없는데도 올라간 것으로 취급돼, 다른 노트북에서 되살아난다.
            // 같을 때만 지운다 — 다르면 표시가 남아 다음 저장이 그 새 값을 올린다.
            if (localStorage.getItem(exclusionStorageKey) === local) {
              localStorage.removeItem(exclusionPendingKey);
            }
            return;
          }
        }

        // 올릴 사본은 없는데 '못 올림' 표시만 남은 상태가 있을 수 있다(브라우저가 저장 공간을 정리한 경우).
        // 그대로 두면 올릴 것이 없어 아무도 다시 시도하지 않는데 배지만 '저장 대기 중'으로 영영 남는다.
        // **다만 표시를 지우는 것은 서버 값을 되받아 온 뒤여야 한다.**
        // 순서를 뒤집으면(먼저 지우고 나중에 조회) 조회가 실패했을 때 화면의 제외 목록이 빈 채로 남고,
        // 그 뒤 아무 칸이나 고치면 그 빈 목록이 서버로 올라가 **제외해 둔 사람이 전부 되살아난다**(Codex 4R P0).
        // 조회가 실패하면 표시를 남긴 채 물러난다 — 아래 catch 가 재시도를 걸어 준다.
        if (!local && hasPendingExclusions) {
          // 서버 전용 조회로 되받아 확정한다(실패하면 던져서 아래 catch 가 표시를 남긴 채 재시도).
          await restoreExclusionsFromServer();
          return;
        }

        // 평상시 조회도 **서버 전용**이어야 한다. 캐시 폴백이 있는 getSharedData 로 읽으면
        // 서버에 못 닿았을 때도 던지지 않고 옛 사본을 돌려주는데, 그걸 '확정'으로 올리면
        // 그 옛 값이 다음 저장 때 서버의 최신 제외 목록을 덮는다 — 복구 경로만 서버 전용으로
        // 막아 놓고 이 문을 열어 두면 같은 유실이 그대로 들어온다.
        await restoreExclusionsFromServer();
      } catch (error) {
        console.warn("파트타이머 급여대장 제외 목록을 불러오지 못했습니다.", error);
        // 밀린 제외 목록을 **올리다** 실패한 경우도 여기로 온다. 경고만 남기고 끝내면
        // 표시는 그대로 '저장됨'인데 서버에는 안 올라가, 다른 노트북에서 제외한 사람이 되살아난다.
        if (localStorage.getItem(exclusionPendingKey) === "1") scheduleSalaryRetry();
      }
    };
    loadExclusions();
    return () => { active = false; };
  }, [exclusionDataKey, exclusionPendingKey, exclusionStorageKey, restoreExclusionsFromServer, salaryPendingKey, scheduleSalaryRetry]);

  // 0. 근무일지의 수기 근무를 읽어 둔다. 아래 두 집계가 이 값을 같이 더한다.
  useEffect(() => {
    let cancelled = false;
    setManualWorkFailed(false);
    manualWorkFetchingRef.current = true;
    (async () => {
      try {
        // 급여 금액에 직접 들어가는 값이라 캐시 폴백을 쓰지 않는다(정직원 초과근무 집계와 같은 규칙) —
        // 서버 실패가 오래된 캐시로 둔갑하면 stale 시간을 보고 급여를 적게 된다.
        const rows = await gasClient.getSharedDataFromServer<any[]>(`manual_parttime:${branchName}`);
        if (cancelled) return;
        // 문서가 없으면 null 이 온다. 그건 '수기 기록 없음'이라는 확인된 답이므로 빈 배열로 확정한다.
        // 어느 지점 것인지 함께 담는다 — 쓰는 쪽이 지점을 대조해 옛 지점 값을 걸러 낸다.
        setManualWork({ branch: branchName, rows: Array.isArray(rows) ? rows : [] });
        setManualWorkFailed(false);
        // 다시 막히면 그때는 한 번 더 안내해야 하므로 여기서 푼다.
        manualWorkToastShownRef.current = false;
        // 못 읽는 동안 저장이 거부돼 '못 올림' 표시만 남은 값이 있으면 지금 올린다.
        // 이 깨우기가 없으면 사용자가 다시 손대기 전까지 그 값은 서버에 안 올라간다.
        if (localStorage.getItem(salaryPendingKey) === "1"
          || localStorage.getItem(exclusionPendingKey) === "1") scheduleSalaryRetryRef.current?.();
      } catch (error) {
        if (cancelled) return;
        console.warn("수기 파트타이머 근무기록을 불러오지 못했습니다.", error);
        setManualWork(null);
        setManualWorkFailed(true);
      } finally {
        // **뒤늦게 끝난 옛 조회는 이 표시를 내리지 않는다.** 내려 버리면 아직 도는 새 조회가 있는데도
        // '읽는 중 아님'으로 보여, 글자를 칠 때마다 조회를 또 걸게 된다(Codex 3R P2 2026-07-31).
        if (!cancelled) manualWorkFetchingRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branchName, exclusionPendingKey, manualWorkReloadKey, salaryPendingKey]);

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

    // B-2. 근무일지에 수기로 적은 근무를 같이 더한다. 여기서 빠지면 일지에는 보이는 시간이 급여에서 사라진다.
    // 출근일 표기는 바로 위 B 와 같은 형식(앞자리 0 없는 '일')으로 맞춘다 — 다르면 같은 날이 두 번 들어간다.
    mergeManualPartTimeWork(ptTelemetry, manualWorkRows, selectedMonth, (settleDate) => {
      const dateParts = String(settleDate).split("-");
      return dateParts[2] ? `${Number(dateParts[2])}` : String(settleDate);
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
  }, [branchName, selectedMonth, history, excludedEmployeeIds, salaryStorageKey, manualWorkRows]);

  useEffect(() => {
    const loadSharedSalaries = async () => {
      try {
        const local = localStorage.getItem(salaryStorageKey);
        if (localStorage.getItem(salaryPendingKey) === "1" && local) {
          const localRows = JSON.parse(local);
          // **제외 목록을 확정하기 전에는 여기서도 올리지 않는다**(자동저장·flush 경로와 같은 규칙).
          // 이 경로는 화면에 들어오자마자 도는데, 그 시점의 `excludedEmployeeIds` 는 아직 비어 있을 수
          // 있다. 그대로 올리면 제외해야 할 사람이 포함된 구성이 이번 달 급여대장으로 저장된다
          // (stop-hook 지적 2026-07-31). '못 올림' 표시가 남아 있으므로 확정된 뒤 재시도가 올린다.
          if (!exclusionsResolvedRef.current) {
            // **올리지 않을 뿐, 화면에서는 살려 둔다.** 적어 둔 값이 화면에서 사라지면 사용자는
            // 잃어버린 줄 안다 — 특히 수기로 넣은 행은 명부·일일마감에서 다시 만들어지지 않아
            // 이 복원이 없으면 확정될 때까지 표에서 통째로 사라진다(stop-hook 지적 2026-07-31).
            if (Array.isArray(localRows)) {
              const excluded = new Set<string>(excludedEmployeeIds);
              const restoredRows = localRows.filter((salary) => !excluded.has(salary.employeeId)).map((salary) => ({
                ...salary,
                tipsEtcAmount: salary.tipsEtcAmount || "0"
              }));
              setSalaries((current) => mergeKeepingManualRows(restoredRows, current, excluded));
            }
            scheduleSalaryRetry();
            return;
          }
          if (Array.isArray(localRows)) {
            const excluded = new Set<string>(excludedEmployeeIds);
            const restoredRows = localRows.filter((salary) => !excluded.has(salary.employeeId)).map((salary) => ({
              ...salary,
              tipsEtcAmount: salary.tipsEtcAmount || "0"
            }));
            // 화면 복원은 즉시 한다 — 시각적 복구를 저장 순서에 묶을 이유가 없다.
            setSalaries((current) => mergeKeepingManualRows(restoredRows, current, excluded));
            // **서버 읽기→병합→쓰기는 자동저장과 같은 직렬화 체인에 세운다.**
            // 밖에서 따로 돌면, 이 재전송이 서버를 오가는 사이 사용자가 셀을 고쳐 500ms 자동저장이
            // 최신값을 먼저 올리고, 늦게 끝난 이 재전송이 옛값(uploadRows)을 다시 올려 되돌린다
            // (Codex High 2026-08-02 — 마감 flush 가 같은 이유로 체인에 들어간 것과 동일).
            // 체인에 서면 나중에 enqueue 된 자동저장이 반드시 뒤에 실행돼 최신값으로 수렴한다.
            const resendTask = salarySaveChainRef.current.catch(() => {}).then(async () => {
              // **실행 시점에 이 재전송이 아직 유효한지 재확인한다.** 체인 앞 순번(이전 마운트의 이탈 flush,
              // 마감 flush 등)이 이미 올려 '못 올림' 표시가 지워졌거나, 그 사이 새 편집이 사본을 바꿨으면
              // 이 task 가 들고 있는 local 은 낡은 값이다 — 올리면 방금 올라간 최신값을 되돌린다
              // (Codex High 2026-08-02, 언마운트→같은 달 재진입 경로). 새 값은 그 경로가 책임진다.
              if (localStorage.getItem(salaryPendingKey) !== "1" || localStorage.getItem(salaryStorageKey) !== local) return;
              // 올리기 전에 서버를 먼저 읽는다. 그냥 덮으면 그 사이 다른 기기가 고쳐 둔 것이 통째로 지워진다.
              let serverRows: PartTimeSalaryRow[] | null = null;
              try {
                // 캐시 폴백이 있는 getSharedData로 읽으면 옛 사본을 최신으로 착각해 상대 수정을 덮는다 — 서버 전용으로 읽는다.
                const fetched = await gasClient.getSharedDataFromServer<PartTimeSalaryRow[]>(salaryDataKey);
                if (Array.isArray(fetched)) serverRows = fetched.filter((salary) => !excluded.has(salary.employeeId));
              } catch (error) {
                // 서버 상태를 모른 채 올리면 다른 기기 수정이 소리 없이 사라진다. 못 올린 표시를 남긴 채 물러난다.
                // **재시도 예약이 핵심이다** — 화면을 새로 연 직후 이 경로로 빠지면, 예약이 없을 때
                // 사용자가 더 고치지 않는 한 그 값은 영영 안 올라간다(화면은 멀쩡해 보인다).
                console.warn("밀린 편집분을 올리기 전 서버를 읽지 못해 전송을 미뤘습니다.", error);
                scheduleSalaryRetry();
                return;
              }
              const uploadRows = toStorableRows(mergePendingLocalRows(restoredRows, serverRows, readSyncedRows()));
              // **화면 반영은 '재전송을 시작한 뒤 사용자가 안 고친 행'만.** 늦게 끝난 이 task 가 화면을
              // 통째로 uploadRows(옛 스냅샷)로 되돌리면, 그 사이 고친 값이 화면에서 사라지고 이후 편집 때
              // 그 옛 화면값이 다시 서버로 올라간다(Codex High 2026-08-02). 자동저장 완료 지점(atSaveTimeById
              // reconcile)과 같은 규칙 — 시작 시점 사본과 지문이 달라진 행은 화면 값을 지킨다.
              const atResendById = new Map<string, PartTimeSalaryRow>(restoredRows.map((row) => [row.employeeId, row]));
              setSalaries((current) => {
                const currentById = new Map<string, PartTimeSalaryRow>(current.map((row) => [row.employeeId, row]));
                const uploadedIds = new Set(uploadRows.map((row) => row.employeeId));
                const reconciledRows = uploadRows.map((uploaded) => {
                  const onScreen = currentById.get(uploaded.employeeId);
                  if (!onScreen) return uploaded; // 서버/병합에서 온, 화면에 없던 행 — 화면에 들인다
                  const atResend = atResendById.get(uploaded.employeeId);
                  if (atResend && rowFingerprint(onScreen) !== rowFingerprint(atResend)) return onScreen;
                  return uploaded;
                });
                // 재전송 시작 후 새로 추가한 행(수기 등)도 지킨다 — 아직 안 올라갔을 뿐이다.
                return [...reconciledRows, ...current.filter((row) => !uploadedIds.has(row.employeeId))];
              });
              // 프로필(주민번호·입사일·은행·계좌·시급)도 함께 올린다. 다른 두 저장 경로는 늘 같이 올리는데
              // 이 경로만 빠져 있었다 — 그러면 급여대장은 올라갔는데 시급이 서버에 없어,
              // **다음 달에 전월 시급이 따라오지 않고** 다른 기기에서도 계좌가 비어 보인다.
              await Promise.all([
                gasClient.saveSharedData(salaryDataKey, uploadRows),
                gasClient.saveSharedData(`part_time_profiles:${branchName}`, buildPartTimeProfiles(uploadRows))
              ]);
              // **올리는 사이에 사용자가 더 고쳤으면 여기서 손대면 안 된다.**
              // 이 경로는 화면에 들어오자마자 밀린 편집분을 올리는데, 그 몇 초 사이에 셀을 고치는 일이 흔하다.
              // 그때 옛 값(uploadRows)으로 로컬 사본과 기준값을 덮고 '못 올림' 표시까지 지우면,
              // 방금 고친 값이 로컬에서도 사라지고 다시 올라가지도 않는다.
              // 사본이 그대로일 때만 확정하고, 바뀌었으면 그 새 저장에 맡긴다(표시가 남아 있어 다시 올라간다).
              if (localStorage.getItem(salaryStorageKey) === local) {
                localStorage.setItem(salaryStorageKey, JSON.stringify(uploadRows));
                localStorage.setItem(salarySyncedKey, JSON.stringify(uploadRows));
                localStorage.removeItem(salaryPendingKey);
                // 제외 목록이 아직 안 올라갔으면 초록으로 돌리지 않는다 — 여기서 '저장됨'으로 바꾸면
                // 제외만 로컬에 남은 상태를 다 저장된 것으로 보여 준다.
                if (localStorage.getItem(exclusionPendingKey) !== "1") setSalarySaveState("saved");
              }
            });
            salarySaveChainRef.current = resendTask.catch(() => {}); // 체인이 에러로 끊기지 않게 흡수
            // 업로드 실패는 바깥 catch 가 재시도를 예약한다(종전과 동일한 실패 처리).
            await resendTask;
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
          const loadedText = JSON.stringify(loadedRows);
          localStorage.setItem(salarySyncedKey, loadedText);
          // **로컬 작업본에도 같이 쓴다.** 이 값은 화면 state 에만 들어가는데, 표를 다시 조립하는
          // effect 는 state 가 아니라 이 로컬 작업본에서 행을 만든다. 여기 안 쓰면 조립이 한 번
          // 더 도는 순간 방금 받은 서버 값이 **옛 로컬 값으로 되돌아간다** — 다른 기기가 적어 둔
          // 팁·메모·실수령액이 사라지고, 특히 hoursOverridden(사람이 직접 적은 시간)이 풀려
          // 그 사람 급여 시간이 조용히 바뀐다(stop-hook 지적 2026-07-31).
          //
          // 단, **서버를 읽는 사이에 사용자가 고쳤으면 손대지 않는다.** 저장은 로컬 사본과
          // '못 올림' 표시를 곧바로 남기므로(persistPartTimeSalaries), 여기서 그냥 덮으면 방금 친
          // 값이 로컬에서 사라진 채 표시만 남아 재시도가 옛 값을 올린다 — 위 밀린-편집 경로가
          // 같은 이유로 쓰는 가드와 똑같이, 사본이 그대로일 때만 맞춘다(stop-hook 지적 2026-07-31).
          const untouched = localStorage.getItem(salaryStorageKey) === local
            && localStorage.getItem(salaryPendingKey) !== "1";
          if (untouched) localStorage.setItem(salaryStorageKey, loadedText);
        }
      } catch (error) {
        console.warn("파트타이머 급여 공통 데이터를 불러오지 못했습니다.", error);
        // 밀린 편집분을 **올리다** 실패한 경우도 여기로 온다(읽기 실패만 위에서 따로 막았다).
        // 재시도를 걸지 않으면 그 값은 영영 서버에 안 올라가는데 화면은 멀쩡해 보인다.
        if (localStorage.getItem(salaryPendingKey) === "1"
          || localStorage.getItem(exclusionPendingKey) === "1") scheduleSalaryRetry();
      }
    };
    loadSharedSalaries();
  }, [branchName, excludedEmployeeIds, exclusionPendingKey, readSyncedRows, salaryDataKey, salaryPendingKey, salaryStorageKey, salarySyncedKey, scheduleSalaryRetry]);

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
    // **지점·달이 바뀌면 이 조회 결과는 버린다.**
    // 명부 조회를 기다리는 사이에 지점을 옮기면, 늦게 도착한 옛 지점의 명단·수기 근무로 만든 행이
    // 지금 보고 있는 지점의 급여대장을 덮는다 — 다른 지점 사람이 이 지점 급여에 섞여 그대로
    // 이체로 이어질 수 있다. 아래 파생값 대조(manualWork.branch)는 이번 렌더만 막을 뿐,
    // 이미 떠난 조회는 막지 못한다(Codex 2R P0 2026-07-31).
    let cancelled = false;
    const mergeRemotePartTimers = async () => {
      try {
        const roster = await gasClient.getBranchOwnRoster(branchName);
        if (cancelled) return;
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

        // 수기 근무도 같이 더한다(위 A 집계와 같은 함수). 출근일 표기는 이 집계의 형식(앞자리 0 유지)에 맞춘다.
        // 이 집계가 아래에서 'legacy-' 행까지 만들어 주므로, 명부에 없고 수기로만 적힌 사람도 여기서 급여대장에 올라온다.
        mergeManualPartTimeWork(telemetry, manualWorkRows, selectedMonth, (settleDate) =>
          String(settleDate).split("-")[2] || ""
        );

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

        // 명단을 손질하는 동안에도 지점이 바뀌었을 수 있다. 화면에 넣기 직전에 한 번 더 본다.
        if (cancelled) return;
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
    return () => {
      cancelled = true;
    };
  }, [branchName, selectedMonth, history, excludedEmployeeIds, manualWorkRows]);

  const handleUpdate = (empId: string, field: keyof PartTimeSalaryRow, value: any) => {
    if (isLocked) return; // 마감 확정 후에는 입력을 받지 않는다(정직원 급여대장 updateRow 와 같은 가드).
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
    if (isLocked) return;
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
    // 저장이 거부되면 되돌리기도 일어나지 않는다. 거부 사유는 persistPartTimeSalaries 가 이미 안내했다 —
    // 여기서 "되돌렸습니다"까지 띄우면 그대로인 값을 바뀌었다고 말하는 셈이고, 사용자는 확인하러 오지 않는다
    // (행 추가·제외 경로와 같은 규칙. stop-hook 지적 2026-07-31).
    if (!persistPartTimeSalaries(nextSalaries)) return;
    triggerToast(`${who} 님의 누적시간을 ${autoHours}시간으로 되돌렸습니다.`);
  };

  /**
   * 행을 지운다.
   *
   * 자동으로 만들어진 행은 지워도 직원명부·일일마감에서 다시 만들어진다. 그래서 "제외" 목록에 넣어 막는다.
   * 수기 행은 다시 만들어질 곳이 없으니 목록에서 빼는 것으로 끝이다 — 그쪽에는 "삭제"라고 말해야 맞다.
   */
  const handleRemoveRow = (employee: PartTimeSalaryRow) => {
    if (isLocked) return;
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
    // 수기 행 삭제는 제외 목록을 바꾸지 않는다(같은 배열 그대로). 실제로 바뀐 경우에만 '제외 변경'으로 넘긴다.
    const isExclusionChange = nextExcluded !== excludedEmployeeIds;
    // **저장이 거절되면 화면도 바꾸지 않는다.** 화면에서만 사라지고 서버에는 안 남으면,
    // 저장된 줄 알고 넘어갔다가 다음에 그 사람이 급여대장에 되살아난다.
    const accepted = persistPartTimeSalaries(nextSalaries, isExclusionChange ? nextExcluded : undefined, true);
    if (!accepted) return; // 거절 사유는 persistPartTimeSalaries 가 이미 안내했다.
    if (isExclusionChange) setExcludedEmployeeIds(nextExcluded);
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
    if (isLocked) return;
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
    // 제외 목록은 건드리지 않는 동작이므로 넘기지 않는다(넘기면 '제외 변경'으로 오인된다).
    // **저장이 거부되면 행도 안 생긴다.** 거부 사유는 persistPartTimeSalaries 가 이미 안내했으므로,
    // 여기서 커서를 옮기고 "추가했습니다"까지 띄우면 없는 행을 있다고 말하는 셈이다(삭제 경로와 같은 규칙).
    const accepted = persistPartTimeSalaries(nextSalaries, undefined, false);
    if (!accepted) return;
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
      {/* 수기 근무를 못 읽으면 근무시간이 실제보다 적게 나온다. 그 사실을 말하지 않으면 '정상 집계'로
          보이는 화면을 그대로 믿고 급여를 적게 지급하게 된다 — 조용히 넘어가면 안 되는 실패다. */}
      {/* 색은 지점 실패색 3종을 hex 그대로 쓴다(DESIGN.md §11 · §2 매핑표).
          `bg-rose-50` 같은 Tailwind 색을 쓰면 지점 CSS가 **바닐라(연노랑)로 치환해** 급여 위험 경고가
          평범한 '주의'로 보인다 — 저장 실패를 눈에 띄게 하라는 규칙(AGENTS.md P0-2)과 어긋난다.
          같은 파일의 '저장 대기 중' 배지와 같은 조합이라 두 경고가 한 화면에서 같은 색으로 읽힌다.
          글자는 경고 배너 규격 12px·700(§6). 버튼은 색으로 의미를 나누지 않고 검정+고스트(§10). */}
      {manualWorkFailed && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl px-4 py-3 bg-[#FDE2E2] border border-[#C93A3A]">
          <AlertTriangle className="w-3.5 h-3.5 text-[#B91C1C] shrink-0" />
          <span className="text-xs font-bold text-[#B91C1C]">
            근무일지에 수기로 적은 근무를 불러오지 못했습니다. 아래 누적시간이 실제보다 적을 수 있으니, 다시 시도한 뒤 금액을 확정해 주세요.
          </span>
          <button
            type="button"
            onClick={() => setManualWorkReloadKey((key) => key + 1)}
            className="ml-auto rounded-full px-4 py-1.5 text-[11px] font-black bg-[#212121] text-[#F6F5FA] focus:outline-none focus:ring-2 focus:ring-[#C93A3A] focus:ring-offset-2"
          >
            다시 시도
          </button>
        </div>
      )}
      {/* 마감 확정 잠금 안내 — 정직원 급여대장과 같은 문구·색(확정 상태라 emerald, 실패 경고 아님). */}
      {isLocked && (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
          마감제출이 확정되어 입력값이 잠겨 있습니다. 수정하려면 마감수정 버튼을 눌러주세요.
        </div>
      )}
      <div className="flex justify-between items-center pb-3 border-b border-gray-50 flex-col sm:flex-row gap-3">
        <div>
          <h3 className="text-sm font-black text-zinc-900 leading-snug w-fit">
            파트타이머 급여대장
          </h3>
          <p className="text-[10px] text-gray-400 font-extrabold mt-1">
             직원현황의 파트타이머 리스트가 자동으로 연동되고, 이번 달 일일 일지(근무일지에 수기로 적은 근무 포함)에서 실시간 근무시간과 출근일이 집계되어 프리필링됩니다.
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
          {/* 저장 상태 배지 — 실제 상태를 보여준다(§11).
              늘 초록 '자동저장'만 띄우면, 서버에 못 올린 동안에도 올라간 줄 알고 화면을 닫게 된다.
              못 올린 상태는 오류색 hex 로 못 박는다 — bg-rose-* 는 지점 스코프에서 색이 죽는다(§11·§12). */}
          {salarySaveState === "retry" ? (
            <div
              className="flex-1 sm:flex-none px-4 py-2 rounded-xl text-[11px] font-black flex items-center justify-center gap-2 shadow-sm bg-[#FDE2E2] text-[#B91C1C] border border-[#C93A3A]"
              title="연결이 불안정해 아직 서버에 올리지 못했습니다. 적으신 내용은 이 기기에 남아 있고, 연결이 돌아오면 자동으로 다시 올립니다."
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              저장 대기 중
            </div>
          ) : (
            // 잠금 중에도 '못 올림(retry)' 배지는 위 분기가 우선한다 — 잠겼다고 미전송 상태를 감추면 안 된다.
            <div className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-[11px] font-black flex items-center justify-center gap-2 shadow-sm ${
              isLocked ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"
            }`}>
              <Check className="w-3.5 h-3.5" />
              {isLocked ? "확정 잠금" : salarySaveState === "saving" ? "저장 중…" : "자동저장"}
            </div>
          )}
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
          disabled={isLocked}
          className="ml-auto px-4 py-2 rounded-xl bg-[#2E6DB4] text-white text-[11px] font-black flex items-center justify-center gap-2 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#2E6DB4] focus:ring-offset-2 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
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
                        disabled={isLocked}
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
                        disabled={isLocked}
                        onClick={() => handleRemoveRow(sal)}
                        aria-label={`${sal.name || "이름 없는 행"} ${isManualRow(sal) ? "삭제" : "제외"}`}
                        title={isManualRow(sal) ? "이 행을 삭제합니다" : "이번 달 급여대장에서만 제외합니다"}
                        className="shrink-0 rounded p-0.5 text-gray-300 transition hover:bg-rose-50 hover:text-rose-600 focus:text-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-400 disabled:text-gray-200 disabled:cursor-not-allowed"
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
                      disabled={isLocked}
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
                      disabled={isLocked}
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
                      disabled={isLocked}
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
                      disabled={isLocked}
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
                      disabled={isLocked}
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
                        disabled={isLocked}
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
                      {!isLocked && isHoursOverridden(sal) && (sal.autoAccumulatedHours ?? "") !== "" && (
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
                      disabled={isLocked}
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
                      disabled={isLocked}
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
                      disabled={isLocked}
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
