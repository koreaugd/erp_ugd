// src/pages/branch/helpers/orderFormula.ts
// 발주 셀에서 엑셀처럼 "=" 로 시작하는 사칙연산 수식을 계산한다.
//
// 왜 자체 파서인가: eval/Function 은 임의 코드 실행 위험이 있어 절대 쓰지 않는다.
// 여기서는 숫자·괄호·(+ - * /)만 허용하는 재귀 하강 파서로 안전하게 계산한다.
//
// 계약
//   - 입력이 "=" 로 시작할 때만 수식으로 본다(isFormulaInput).
//   - 결과는 원 단위 정수(반올림). 저장 규칙과 같게 1 ~ 9,999,999 범위만 통과시킨다.
//   - 계산 못 하거나(0으로 나눔·괄호 안 맞음·오타 등) 범위를 벗어나면 ok:false 와 사람이 읽을 이유를 돌려준다.

// 판별 유니온으로 쓰고 싶지만 이 프로젝트 tsconfig 는 strictNullChecks 가 꺼져 있어
// if (result.ok) 로 분기해도 TS 가 유니온을 좁혀 주지 않는다. 그래서 선택 필드를 가진 단일 형태로 둔다.
// 계약: ok 가 true 면 value 가 있고, false 면 reason 이 있다.
export interface FormulaResult {
  ok: boolean;
  value?: number;
  reason?: string;
}

/** 셀에 친 글자가 수식 입력인지(엑셀처럼 "=" 로 시작) — 앞 공백은 눈감아 준다. */
export const isFormulaInput = (text: string | undefined | null): boolean =>
  typeof text === "string" && text.trimStart().startsWith("=");

// 저장 상한 — updateOrderDraft 의 cleanNumeric(...).slice(0, 7) 와 같은 7자리 한도.
const MAX_ORDER_AMOUNT = 9_999_999;
// 사람이 쓸 발주 수식은 짧다. 병적으로 긴 입력은 애초에 막아 파서를 지킨다.
const MAX_FORMULA_LENGTH = 120;

/**
 * "=" 로 시작하는 발주 수식을 계산한다.
 * 친화적으로 ×÷− 기호와 1,000 식 콤마도 받아들인 뒤 표준 연산자로 바꿔 파싱한다.
 */
export function evaluateOrderFormula(raw: string): FormulaResult {
  if (typeof raw !== "string") return { ok: false, reason: "빈 수식입니다." };

  let body = raw.trimStart();
  if (!body.startsWith("=")) return { ok: false, reason: "수식은 = 로 시작해야 합니다." };
  body = body.slice(1);

  if (body.length > MAX_FORMULA_LENGTH) return { ok: false, reason: "수식이 너무 깁니다." };

  // 친화 기호 → 표준 연산자, 천단위 콤마·공백 제거.
  const normalized = body
    .replace(/[×xX]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/[−–—]/g, "-") // 유니코드 빼기·대시류
    .replace(/[,\s]/g, "");

  if (normalized === "") return { ok: false, reason: "빈 수식입니다." };

  // 허용 문자만: 숫자, 소수점, + - * /, 괄호.
  if (/[^0-9.+\-*/()]/.test(normalized)) {
    return { ok: false, reason: "숫자와 + - * / ( ) 만 쓸 수 있습니다." };
  }

  let parsed: number;
  try {
    parsed = parseExpression(normalized);
  } catch {
    return { ok: false, reason: "수식을 계산할 수 없습니다. 예: =15000*3, =(1000+500)*2" };
  }

  if (!Number.isFinite(parsed)) return { ok: false, reason: "0 으로 나눌 수 없습니다." };

  const rounded = Math.round(parsed);
  if (rounded <= 0) return { ok: false, reason: "결과가 0 이하입니다." };
  if (rounded > MAX_ORDER_AMOUNT) return { ok: false, reason: "최대 9,999,999원까지 넣을 수 있습니다." };

  return { ok: true, value: rounded };
}

// ── 재귀 하강 파서 ────────────────────────────────────────────────
// expr   = term (("+" | "-") term)*
// term   = factor (("*" | "/") factor)*
// factor = number | "(" expr ")" | ("+" | "-") factor   (단항 부호)
// number = digits ("." digits)?  |  "." digits
//
// 파싱 실패(예상 못한 문자, 괄호 안 맞음, 남은 글자)는 모두 throw → 호출부에서 ok:false 로 변환한다.

function parseExpression(input: string): number {
  const state = { s: input, i: 0 };
  const value = parseExpr(state);
  skipNothing(state);
  if (state.i !== state.s.length) throw new Error("남은 글자");
  return value;
}

function parseExpr(state: { s: string; i: number }): number {
  let value = parseTerm(state);
  for (;;) {
    const op = state.s[state.i];
    if (op === "+" || op === "-") {
      state.i++;
      const right = parseTerm(state);
      value = op === "+" ? value + right : value - right;
    } else {
      return value;
    }
  }
}

function parseTerm(state: { s: string; i: number }): number {
  let value = parseFactor(state);
  for (;;) {
    const op = state.s[state.i];
    if (op === "*" || op === "/") {
      state.i++;
      const right = parseFactor(state);
      value = op === "*" ? value * right : value / right;
    } else {
      return value;
    }
  }
}

function parseFactor(state: { s: string; i: number }): number {
  const ch = state.s[state.i];

  if (ch === "+" || ch === "-") {
    state.i++;
    const inner = parseFactor(state);
    return ch === "-" ? -inner : inner;
  }

  if (ch === "(") {
    state.i++;
    const inner = parseExpr(state);
    if (state.s[state.i] !== ")") throw new Error("괄호가 안 맞습니다");
    state.i++;
    return inner;
  }

  return parseNumber(state);
}

function parseNumber(state: { s: string; i: number }): number {
  const start = state.i;
  while (state.i < state.s.length && /[0-9]/.test(state.s[state.i])) state.i++;
  if (state.s[state.i] === ".") {
    state.i++;
    while (state.i < state.s.length && /[0-9]/.test(state.s[state.i])) state.i++;
  }
  const token = state.s.slice(start, state.i);
  if (token === "" || token === ".") throw new Error("숫자가 필요합니다");
  const num = Number(token);
  if (!Number.isFinite(num)) throw new Error("숫자를 읽을 수 없습니다");
  return num;
}

// 이 파서는 공백을 미리 다 지워서(normalize) 사이에 건너뛸 게 없다.
// 계약을 분명히 하려고 자리만 남겨 둔다 — 공백 처리 방식을 바꾸면 여기만 손보면 된다.
function skipNothing(_state: { s: string; i: number }): void {
  /* normalize 단계에서 공백을 이미 제거했다 */
}
