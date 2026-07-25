// src/pages/branch/tabRegistry.ts
// 지점 화면 탭 권한의 단일 출처(설계서 §5). 키 = "대분류.서브탭", 서브탭은 현행 state 값 그대로.
// 새 탭을 만들면 여기에 등록해야 화면에 나타난다.
export type PermKey =
  | "dashboard"
  | "daily.settle" | "daily.orders" | "daily.liquorInventory" | "daily.officeWorkLog"
  | "daily.overtimeLog" | "daily.partTimeLog" | "daily.roster"
  | "monthly.fullTimeSalary" | "monthly.purchaseSales" | "monthly.partTimeSalary"
  | "monthly.cashManagement" | "monthly.cashExpenses" | "monthly.cardExpenses"
  | "laborContract" | "businessTaxi" | "annualLeave";

export interface TabNavTarget { mainCategory: string; activeTab?: string; monthlyTab?: string; }

export const BRANCH_TAB_REGISTRY: Record<PermKey, TabNavTarget> = {
  "dashboard": { mainCategory: "dashboard" },
  "daily.settle": { mainCategory: "daily", activeTab: "settle" },
  "daily.orders": { mainCategory: "daily", activeTab: "orders" },
  "daily.liquorInventory": { mainCategory: "daily", activeTab: "liquorInventory" },
  "daily.officeWorkLog": { mainCategory: "daily", activeTab: "officeWorkLog" },
  "daily.overtimeLog": { mainCategory: "daily", activeTab: "overtimeLog" },
  "daily.partTimeLog": { mainCategory: "daily", activeTab: "partTimeLog" },
  "daily.roster": { mainCategory: "daily", activeTab: "roster" },
  "monthly.fullTimeSalary": { mainCategory: "monthly", monthlyTab: "fullTimeSalary" },
  "monthly.purchaseSales": { mainCategory: "monthly", monthlyTab: "purchaseSales" },
  "monthly.partTimeSalary": { mainCategory: "monthly", monthlyTab: "partTimeSalary" },
  "monthly.cashManagement": { mainCategory: "monthly", monthlyTab: "cashManagement" },
  "monthly.cashExpenses": { mainCategory: "monthly", monthlyTab: "cashExpenses" },
  "monthly.cardExpenses": { mainCategory: "monthly", monthlyTab: "cardExpenses" },
  "laborContract": { mainCategory: "laborContract" },
  "businessTaxi": { mainCategory: "businessTaxi" },
  "annualLeave": { mainCategory: "annualLeave", activeTab: "annualLeave" }
};

export function isTabAllowed(allowedTabs: string[] | "all", key: PermKey): boolean {
  return allowedTabs === "all" || allowedTabs.includes(key);
}

// 허용 목록의 첫 화면 — 기본값 계정(daily.settle만)이 대시보드로 떨어지는 모순 방지(설계서 §5)
export function firstAllowedKey(allowedTabs: string[] | "all"): PermKey {
  if (allowedTabs === "all") return "dashboard";
  const keys = Object.keys(BRANCH_TAB_REGISTRY) as PermKey[];
  return keys.find((k) => allowedTabs.includes(k)) || "daily.settle";
}

// 현재 화면 state 조합 → 권한 키 역산. 렌더 가드가 사용한다.
export function permKeyForState(mainCategory: string, activeTab: string, monthlyTab: string): PermKey | null {
  if (mainCategory === "daily") return ("daily." + activeTab) as PermKey;
  if (mainCategory === "monthly") return ("monthly." + monthlyTab) as PermKey;
  const direct = ["dashboard", "laborContract", "businessTaxi", "annualLeave"];
  return direct.includes(mainCategory) ? (mainCategory as PermKey) : null;
}
