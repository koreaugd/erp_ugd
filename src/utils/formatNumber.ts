/**
 * 숫자를 한국 원화 형식(천 단위 쉼표)으로 포맷팅합니다.
 */
export function formatNumber(val: number | string | undefined | null): string {
  if (val === undefined || val === null || val === "") return "";
  const num = typeof val === "number" ? val : parseFloat(String(val).replace(/,/g, ""));
  if (isNaN(num)) return "";
  return num.toLocaleString("ko-KR");
}

/**
 * 천 단위 쉼표가 들어간 문자열을 순수 숫자로 파싱합니다.
 */
export function parseNumber(val: string): number {
  const clean = val.replace(/,/g, "");
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}
