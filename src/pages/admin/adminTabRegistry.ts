// src/pages/admin/adminTabRegistry.ts
// 관리자 화면 탭 권한의 단일 출처. 키 = AdminPage.tsx의 adminSection state 값 그대로(새 키 발명 금지 —
// AdminPage.tsx :91 부근의 adminSection 유니언과 글자 단위로 일치해야 한다).
export type AdminPermKey =
  | "dashboard" | "analysis" | "dailySettlement" | "monthlyClosing"
  | "annualLeave" | "modificationLogs" | "laborContracts"
  | "salaryChanges" | "kakaoTaxi" | "accounts";

// modificationLogs는 독립 화면이 아니라 dailySettlement(전일 정산현황)의 하위 화면이라 별도 권한
// 체크박스를 두지 않는다 — SECTION_PERMISSION_ALIAS로 부모 권한을 따른다.
export const ADMIN_TAB_KEYS: AdminPermKey[] = [
  "dashboard", "analysis", "dailySettlement", "monthlyClosing",
  "annualLeave", "laborContracts",
  "salaryChanges", "kakaoTaxi", "accounts"
];

// 라벨은 AdminPage 사이드바의 실제 한글 버튼(또는 그룹) 텍스트를 그대로 따른다.
// ADMIN_TAB_KEYS에서 빠진 modificationLogs는 여기서도 뺀다(Partial —
// 계정 관리 체크박스가 ADMIN_TAB_KEYS만 순회하므로 실사용에는 영향 없다).
export const ADMIN_TAB_LABELS: Partial<Record<AdminPermKey, string>> = {
  dashboard: "대시보드",
  analysis: "분석",
  dailySettlement: "일일업무",
  monthlyClosing: "월말업무",
  annualLeave: "연차관리",
  laborContracts: "근로계약서 발송 현황",
  salaryChanges: "급여 변동 이력",
  kakaoTaxi: "법인택시",
  accounts: "계정 관리"
};

// 개인정보 민감 탭 — 계정 관리 편집 UI가 이 목록으로 "개인정보" 배지를 붙인다.
export const ADMIN_SENSITIVE_TAB_KEYS: AdminPermKey[] = [
  "laborContracts", "salaryChanges", "annualLeave", "kakaoTaxi"
];

// 일부 섹션은 다른 섹션의 하위 화면이라 부모 권한을 따른다.
const SECTION_PERMISSION_ALIAS: Partial<Record<AdminPermKey, AdminPermKey>> = { modificationLogs: "dailySettlement" };
export function effectivePermKey(section: AdminPermKey): AdminPermKey {
  return SECTION_PERMISSION_ALIAS[section] ?? section;
}

export function isAdminTabAllowed(allowed: string[] | "all" | undefined, key: AdminPermKey): boolean {
  return allowed === undefined || allowed === "all" || allowed.includes(key);
}

// 허용 목록의 첫 화면 — "all"/undefined는 항상 대시보드, 그 외에는 ADMIN_TAB_KEYS 순서상 첫 허용 키.
export function firstAllowedAdminKey(allowed: string[] | "all" | undefined): AdminPermKey {
  if (allowed === undefined || allowed === "all") return "dashboard";
  return ADMIN_TAB_KEYS.find((k) => allowed.includes(k)) || "dashboard";
}
