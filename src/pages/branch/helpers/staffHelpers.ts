// src/pages/branch/helpers/staffHelpers.ts
// 직원명부/근무행/검증 관련 공유 헬퍼. BranchConfirmPage에서 분리.
// 동작 변경 없음 — 원본 코드를 그대로 이동함.

import type {
  StaffAddDraft,
  StaffRow,
  Employee,
  EmployeeEditableField,
  StaffAddReason,
  StaffAddReasonChoice,
  SalaryChangeStatus,
  SalaryChangeChoice,
  DailySettleValidationTargets,
} from "../types";
import type { RosterEmployee } from "../../../api/gasClient";
import { formatResidentNumber, toPhoneTail8, residentBirthKey } from "./formatters";

export const getSameNameWarning = (name: string, residentNumber: string | undefined, employees: Array<{ name: string; residentNumber?: string; division?: string }>, division?: string) => {
  const cleanName = name.trim();
  if (!cleanName) return "";
  const incomingBirth = residentBirthKey(residentNumber);
  const sameName = employees.filter((employee) => employee.name?.trim() === cleanName && (!division || employee.division === division));
  if (sameName.length === 0) return "";
  const hasMissingResident = sameName.some((employee) => !residentBirthKey(employee.residentNumber));
  if (hasMissingResident || !incomingBirth) {
    return `${cleanName} 이름의 직원이 이미 있고 주민등록번호 앞 6자리 확인이 필요합니다. 동명이인 또는 동일인 여부를 직원현황에서 먼저 확인해주세요.`;
  }
  const hasDifferentBirth = sameName.some((employee) => residentBirthKey(employee.residentNumber) !== incomingBirth);
  if (hasDifferentBirth) {
    return `${cleanName} 이름의 동명이인이 있습니다. 주민등록번호 앞 6자리로 구분해서 확인해주세요.`;
  }
  return `${cleanName} 이름과 주민등록번호 앞 6자리가 같은 직원이 이미 등록되어 있습니다.`;
};

export const createStaffAddDraft = (): StaffAddDraft => ({
  id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  name: "",
  division: "정직원",
  residentNumber: "",
  rank: "",
  contractType: "4대보험",
  entryDate: "",
  phoneDigits: "",
  addReason: "",
  fromBranch: "",
  transferDate: "",
  salaryChanged: "",
  addReasonMemo: ""
});

export const staffListStorageKey = (branchName: string) => `erp_staff_list_${branchName}`;
export const staffListPendingStorageKey = (branchName: string) => `erp_staff_list_pending_${branchName}`;
export const staffAddDraftStorageKey = (branchName: string) => `erp_staff_add_drafts_${branchName}`;
export const pendingLocalSaveStorageKey = (storageKey: string) => `erp_pending_local_save_${storageKey}`;

export const readLocalStaffList = (branchName: string): Employee[] => {
  try {
    const saved = localStorage.getItem(staffListStorageKey(branchName));
    if (!saved) return [];
    return JSON.parse(saved).filter((employee: any) => !isSampleEmployee(employee));
  } catch {
    return [];
  }
};

export const readLocalStaffAddDrafts = (branchName: string): StaffAddDraft[] => {
  try {
    const saved = localStorage.getItem(staffAddDraftStorageKey(branchName));
    if (!saved) return [createStaffAddDraft()];
    const drafts = JSON.parse(saved);
    return Array.isArray(drafts) && drafts.length > 0
      ? drafts.map((draft: Partial<StaffAddDraft>) => ({
        ...createStaffAddDraft(),
        ...draft,
        addReason:
          draft.addReason === "신규입사" ||
          draft.addReason === "지점이동" ||
          draft.addReason === "기존직원" ||
          draft.addReason === "기타"
            ? draft.addReason
            : "",
        salaryChanged: draft.salaryChanged === "있음" || draft.salaryChanged === "없음" ? draft.salaryChanged : ""
      }))
      : [createStaffAddDraft()];
  } catch {
    return [createStaffAddDraft()];
  }
};

const SAMPLE_EMPLOYEE_IDS = new Set(["e1", "e2", "e3", "e4"]);
const SAMPLE_EMPLOYEE_NAMES = new Set(["김철수", "이영희", "박민수", "최정우"]);
export const isSampleEmployee = (employee: any) =>
  SAMPLE_EMPLOYEE_IDS.has(String(employee?.id || "")) &&
  SAMPLE_EMPLOYEE_NAMES.has(String(employee?.name || "")) &&
  !employee?.residentNumber &&
  !employee?.entryDate;

export const createDailySettleValidationTargets = (): DailySettleValidationTargets => ({
  fields: {},
  overtimeReasonRows: {},
  officeWorkRows: {}
});

export const getDailyStaffValidationKey = (staff: StaffRow, index: number) =>
  `${staff.segmentId || ""}|${staff.residentNumber || ""}|${staff.name || ""}|${index}`;

export const needsOvertimeReason = (staff: StaffRow) =>
  staff.division !== "파트타이머" && Number(staff.overtime || 0) !== 0;

export const applyEmployeeEditableField = (employee: Employee, field: EmployeeEditableField, value: string): Employee => {
  const updated: Employee = { ...employee };

  if (field === "name") updated.name = value;
  if (field === "residentNumber") updated.residentNumber = formatResidentNumber(value);
  if (field === "contractType" && (value === "4대보험" || value === "3.3%")) updated.contractType = value;
  if (field === "rank") updated.rank = value;
  if (field === "entryDate") {
    updated.entryDate = value;
    if (updated.addReason === "지점이동") updated.transferDate = value;
    if (updated.addReason === "신규입사") updated.hireDate = value;
  }
  if (field === "division" && value === "파트타이머") {
    updated.division = value;
    updated.rank = "";
    updated.contractType = "3.3%";
  }
  if (field === "division" && value === "정직원") {
    updated.division = value;
    updated.contractType = "4대보험";
  }
  if (field === "addReason") {
    const nextReason = parseStaffAddReason(value);
    updated.addReason = nextReason || undefined;
    if (!nextReason) {
      updated.hireDate = "";
      updated.transferDate = "";
      updated.phone = "";
      updated.salaryChanged = undefined;
      updated.addReasonMemo = "";
    } else if (nextReason === "신규입사") {
      updated.hireDate = updated.hireDate || updated.entryDate || "";
      updated.transferDate = "";
      updated.salaryChanged = undefined;
      updated.addReasonMemo = "";
    } else if (nextReason === "지점이동") {
      updated.transferDate = updated.transferDate || updated.entryDate || "";
      updated.hireDate = "";
      updated.phone = "";
      updated.addReasonMemo = "";
    } else if (nextReason === "기타") {
      updated.hireDate = "";
      updated.transferDate = "";
      updated.phone = "";
      updated.salaryChanged = undefined;
    } else {
      updated.hireDate = "";
      updated.transferDate = "";
      updated.phone = "";
      updated.salaryChanged = undefined;
      updated.addReasonMemo = "";
    }
  }
  if (field === "phone") updated.phone = toPhoneTail8(value);
  if (field === "hireDate") {
    updated.hireDate = value;
    updated.entryDate = value;
  }
  if (field === "transferDate") {
    updated.transferDate = value;
    updated.entryDate = value;
  }
  if (field === "salaryChanged") {
    const status = parseSalaryChangeStatus(value);
    updated.salaryChanged = status || undefined;
  }
  if (field === "addReasonMemo") updated.addReasonMemo = value;

  return updated;
};

export const parseStaffAddReason = (value: string): StaffAddReason | null => {
  if (value === "신규입사" || value === "지점이동" || value === "기존직원" || value === "기타") return value;
  return null;
};

export const parseStaffAddReasonChoice = (value: string): StaffAddReasonChoice => parseStaffAddReason(value) || "";

export const parseSalaryChangeStatus = (value: string): SalaryChangeStatus | null => {
  if (value === "있음" || value === "없음") return value;
  return null;
};

export const parseSalaryChangeChoice = (value: string): SalaryChangeChoice => parseSalaryChangeStatus(value) || "";

export const getAddReasonChoiceClass = (reason?: StaffAddReasonChoice) => {
  const base = "branch-choice-select";
  if (!reason) return `${base} branch-choice-placeholder`;
  if (reason === "신규입사") return `${base} branch-choice-hire`;
  if (reason === "지점이동") return `${base} branch-choice-transfer`;
  if (reason === "기존직원") return `${base} branch-choice-existing`;
  return `${base} branch-choice-other`;
};

export const getSalaryChoiceClass = (status?: SalaryChangeChoice) => {
  const base = "branch-choice-select";
  if (!status) return `${base} branch-choice-placeholder`;
  return status === "있음" ? `${base} branch-choice-salary-yes` : `${base} branch-choice-salary-no`;
};

export const employeeNameKey = (value?: string) => String(value || "").trim();

export const normalizeRosterEmployee = (employee: Employee | RosterEmployee): Employee | null => {
  const name = employeeNameKey(employee.name);
  if (!name || (employee.division !== "정직원" && employee.division !== "파트타이머")) return null;
  const addReason = parseStaffAddReason(String(employee.addReason || ""));
  const salaryChanged = parseSalaryChangeStatus(String(employee.salaryChanged || ""));
  return {
    ...employee,
    name,
    division: employee.division,
    addReason: addReason || undefined,
    salaryChanged: salaryChanged || undefined
  };
};

export const shouldSkipDailyRosterRegistration = (staff: StaffRow) =>
  SAMPLE_EMPLOYEE_NAMES.has(employeeNameKey(staff.name)) &&
  !staff.residentNumber &&
  !staff.entryDate &&
  !staff.phone &&
  !staff.rank;

export const createEmployeeFromStaffRow = (staff: StaffRow): Employee => ({
  id: `e_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
  name: employeeNameKey(staff.name),
  division: staff.division,
  residentNumber: formatResidentNumber(staff.residentNumber || ""),
  contractType: staff.division === "정직원" ? "4대보험" : "3.3%",
  entryDate: staff.entryDate || "",
  phone: staff.phone || "",
  addReason: staff.addReason,
  fromBranch: staff.fromBranch || "",
  transferDate: staff.transferDate || "",
  salaryChanged: staff.salaryChanged,
  hireDate: staff.hireDate || "",
  addReasonMemo: staff.addReasonMemo || "",
  ...(staff.division === "정직원" ? { rank: staff.rank || "" } : {})
});
