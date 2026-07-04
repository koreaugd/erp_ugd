// src/pages/branch/helpers/formatters.ts
// BranchConfirmPage에서 분리한 순수 포맷/변환 헬퍼.
// 동작 변경 없음 — 원본 코드를 그대로 이동함.

export const formatWithCommas = (val: string | number | undefined | null) => {
  if (val === undefined || val === null || val === "") return "";
  const str = String(val).replace(/[^0-9]/g, "");
  if (!str) return "";
  return Number(str).toLocaleString("ko-KR");
};

export const cleanNumeric = (val: string) => {
  return val.replace(/[^0-9]/g, "");
};

export const toLocalDateInputValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const toLocalMonthInputValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

export const addDaysToDateInputValue = (dateValue: string, days: number) => {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toLocalDateInputValue(date);
};

export const addMonthsToMonthInputValue = (monthValue: string, months: number) => {
  const [year, month] = monthValue.split("-").map(Number);
  const date = new Date(year, month - 1 + months, 1);
  return toLocalMonthInputValue(date);
};

export const toDateInputValue = (value: string) => {
  const match = String(value || "").match(/^(\d{4})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
};

export const formatResidentNumber = (value: string) => {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 13);
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
};

export const maskResidentNumber = (value?: string) => {
  const formatted = formatResidentNumber(value || "");
  const digits = formatted.replace(/\D/g, "");
  if (digits.length <= 6) return formatted || "-";
  return `${digits.slice(0, 6)}-${"*".repeat(Math.min(7, digits.length - 6))}`;
};

export const toPhoneTail8 = (value: string) => {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("010-") || (digits.length >= 11 && digits.startsWith("010"))) {
    return digits.slice(3, 11);
  }
  return digits.slice(0, 8);
};
export const formatMobilePhone = (tail8: string) => {
  const digits = toPhoneTail8(tail8);
  if (digits.length !== 8) return digits;
  return `010-${digits.slice(0, 4)}-${digits.slice(4)}`;
};

export const residentBirthKey = (value?: string) => String(value || "").replace(/\D/g, "").slice(0, 6);

export const toNumberPromptValue = (value: any) => String(value ?? "").replace(/,/g, "");
