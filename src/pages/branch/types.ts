// src/pages/branch/types.ts
// BranchConfirmPage 및 하위 탭이 공유하는 타입 정의.
// 동작 변경 없음 — 원본 코드를 그대로 이동함.

export type StaffAddReason = "신규입사" | "지점이동" | "기존직원" | "기타";
export type StaffAddReasonChoice = StaffAddReason | "";
export type SalaryChangeStatus = "있음" | "없음";
export type SalaryChangeChoice = SalaryChangeStatus | "";

export interface StaffAddDraft {
  id: string;
  name: string;
  division: "정직원" | "파트타이머";
  residentNumber: string;
  rank: string;
  contractType: "4대보험" | "3.3%";
  entryDate: string;
  phoneDigits: string;
  addReason: StaffAddReasonChoice;
  fromBranch: string;
  transferDate: string;
  salaryChanged: SalaryChangeChoice;
  addReasonMemo: string;
}

export interface StaffRow {
  division: "정직원" | "파트타이머";
  name: string;
  residentNumber?: string;
  rank?: string;
  entryDate?: string;
  phone?: string;
  addReason?: StaffAddReason;
  fromBranch?: string;
  transferDate?: string;
  salaryChanged?: SalaryChangeStatus;
  hireDate?: string;
  addReasonMemo?: string;
  standardHours: number; // 0, 9, 10, 10.5
  clockIn: string; // e.g. "09:00"
  clockOut: string; // e.g. "18:00"
  workHours: number; // calculated
  overtime: number; // calculated
  overtimeReason: string;
  officeWorkType?: "근무" | "휴무";
  officeTaskMemo?: string;
  officeWorkplace?: string;
  segmentId?: string;
}

export type DailySettleValidationField =
  | "writer"
  | "cashSales"
  | "cardSales"
  | "cashBalance"
  | "cashDiffReason";

export interface DailySettleValidationTargets {
  fields: Partial<Record<DailySettleValidationField, boolean>>;
  overtimeReasonRows: Record<string, boolean>;
  officeWorkRows: Record<string, boolean>;
}

export interface ExpenseRow {
  classification: "식재료" | "소모품등 기타" | "부식비" | "음료" | "현금입금";
  usage: "쿠팡" | "네이버" | "인근매장" | "그외기타" | "현금입금";
  detail: string;
  amount: string;
}

export type OrderCategory = "식자재" | "부식비" | "주류" | "식음료외 기타";
export type OrderReportCategory = OrderCategory | "전체";
export type BranchDailyTab = "dashboard" | "settle" | "orders" | "liquorInventory" | "roster" | "overtimeLog" | "annualLeave" | "partTimeLog" | "officeWorkLog";

export interface OrderItem {
  id: string;
  category: OrderCategory;
  vendorName: string;
  amount: string;
  memo: string;
  orderDate: string;
}

export interface InventoryProduct {
  id: string;
  classification: string;
  importer: string;
  itemName: string;
  salePrice: string;
  costPrice: string;
}

export interface InventoryMovement {
  id: string;
  productId: string;
  movementDate: string;
  inbound: string;
  sold: string;
  memo: string;
}

export interface Employee {
  id: string;
  name: string;
  division: "정직원" | "파트타이머";
  rank?: string;       // 사원, 대리, 과장, 차장, 실장, 부장, 이사, 대표, 부대표, 기타
  customRank?: string; // 기타 선택 시 직접 입력한 직급
  residentNumber?: string;
  contractType?: "4대보험" | "3.3%";
  entryDate?: string;
  phone?: string;
  addReason?: StaffAddReason;
  fromBranch?: string;
  transferDate?: string;
  salaryChanged?: SalaryChangeStatus;
  hireDate?: string;
  addReasonMemo?: string;
}

export type EmployeeEditableField =
  | "name"
  | "residentNumber"
  | "contractType"
  | "entryDate"
  | "rank"
  | "division"
  | "addReason"
  | "phone"
  | "hireDate"
  | "transferDate"
  | "salaryChanged"
  | "addReasonMemo";
