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
// 표시 전용 — 연락처를 010까지 붙여 "010-1234-5678"로 보여 준다(관리자 근로계약서 발송현황 연락처 칸).
// 2026-09-14엔 010을 빼고 뒤 8자리만 보였는데, 2026-10-03 사용자 지시로 010을 다시 붙였다.
//   · 숫자 11자리 + 010 시작(정상 저장값 "010-1234-5678") → 010-1234-5678
//   · 그 밖의 값 → 손대지 않고 원문 그대로. **8자리에 010을 짐작해 붙이지 않는다** — 원래 휴대폰 뒷자리였는지
//     알 근거가 없어, 다른 번호를 그럴듯하게 보여 줄 수 있다(Codex 2026-10-03). 운영 데이터 23건은 전부 11자리였다.
// toPhoneTail8 을 쓰지 않는 이유: '입력 정규화'용이라 010이 아닌 값도 잘라 "011-123-4567"을 다른 번호처럼 만든다.
// 저장값은 바꾸지 않는다(지점 등록·매칭은 여전히 "010-1234-5678" 전체 문자열).
export const formatContractPhoneDisplay = (value?: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 11 || !digits.startsWith("010")) return raw;
  return `010-${digits.slice(3, 7)}-${digits.slice(7)}`;
};

export const residentBirthKey = (value?: string) => String(value || "").replace(/\D/g, "").slice(0, 6);

export const toNumberPromptValue = (value: any) => String(value ?? "").replace(/,/g, "");
