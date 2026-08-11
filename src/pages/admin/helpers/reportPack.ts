// src/pages/admin/helpers/reportPack.ts
// 관리자 > 분석 > 통합보고서 — 03 에이전트의 `{YYMM}_손익계산서_통합*.xlsx` 를
// **엑셀 격자·서식 그대로** 보관·열람·수정하기 위한 파싱/마스킹/압축 계층.
//
// [왜 항목별로 파싱하지 않는가]
// 한 파일에 17개 시트가 들어 있고 **시트마다 양식이 다르다.**
//   · 지점 시트 : 손익계산서(A열) + 매출상세(F열) + 급여명단(M열) + 카테고리별 거래내역 + 총 거래내역
//   · 본사      : 손익계산서에 '계산식' 열이 붙고 배당인센이 여러 줄, 급여 블록 열이 한 칸씩 밀린다
//   · 험프리스  : 통장 원본이 P·X열 두 벌, 환율 환산 블록이 따로 있다
//   · 상각      : 아예 다른 표(상호·상각개시월·투자총액…)를 세로로 세운 형태
// 항목별로 재해석하면 어느 시트에선 반드시 깨진다. 셀 위치와 서식을 그대로 보존한다.
//
// [왜 원본 xlsx 를 그대로 저장하지 않는가]
// 원본을 base64 로 저장하면 편하지만 파일 안의 **주민번호·계좌가 원본 그대로 서버에 남는다.**
// 마스킹이 불가능해진다. 그래서 브라우저에서 파싱 → 마스킹 → 저장한다.
//
// [서식은 두 곳에서 온다]
//   · SheetJS(xlsx-js-style) : 값 · 숫자서식(z) · 열너비(!cols.wpx) · 행높이(!rows.hpx) · 병합(!merges)
//   · helpers/xlsxStyles.ts  : 볼드 · 정렬 · 테두리 · 글자색/크기 · 배경색
//     (SheetJS 읽기 경로는 `cellStyles:true` 여도 채우기만 준다 — 이 파일들은 머리글·합계행이
//      전부 볼드라 그것이 빠지면 "엑셀 서식 그대로"가 성립하지 않는다)
// 서식은 **사전(styles/numFmts)** 으로 모으고 셀에는 색인만 둔다 — 2607 파일 실측 263종뿐이라
// 통째로 담는 것보다 훨씬 작다.
import { readXlsxStyles, type XlsxCellStyle } from "./xlsxStyles";

export const REPORT_PACK_PREFIX = "pnl_report_pack";
export const REPORT_PACK_INDEX_KEY = "pnl_report_pack_index";

/** 월별 문서 키. firestore.rules 의 isReportPackKey() 정규식과 짝이다 — 접두사를 바꾸면 규칙도 바꾼다. */
export function reportPackKey(month: string): string {
  return `${REPORT_PACK_PREFIX}:${month}`;
}

/** 저장 한도 — Firestore 1MB 문서 한도에 여유를 둔 값. 넘으면 저장을 거부한다(조용한 실패 금지). */
const MAX_ENCODED_BYTES = 900_000;

/** 엑셀 기본 열 너비(px). `!cols` 에 항목이 없는 열에 쓴다. */
const DEFAULT_COL_PX = 64;

export type ReportCell = string | number;

export type ReportMerge = { r: number; c: number; rs: number; cs: number };

export type ReportSheet = {
  name: string;
  /** 값 격자. 마스킹이 적용된 상태로 저장된다. */
  rows: ReportCell[][];
  /** 숫자서식 색인(-1 = General). 값과 같은 모양의 격자. */
  fmt: number[][];
  /** 셀서식 색인(-1 = 없음). 값과 같은 모양의 격자. */
  sty: number[][];
  /** 열 너비(px) */
  cols: number[];
  /** 행 높이(px). 0 = 기본 높이 */
  heights: number[];
  merges: ReportMerge[];
};

export type ReportBody = {
  sheets: ReportSheet[];
  styles: XlsxCellStyle[];
  numFmts: string[];
};

export type ReportPack = ReportBody & {
  month: string;
  fileName: string;
  sheetNames: string[];
  maskedFields: number;
  uploadedAt: string;
  uploadedBy: string;
  /** 화면에서 고친 뒤 저장한 시각·사람. 업로드와 구분해 밴드에 표시한다. */
  editedAt?: string;
  editedBy?: string;
  /** 내가 읽어 온 판올림 번호. 저장할 때 이 값으로 비교-후-쓰기(CAS)를 건다. */
  rev?: number;
};

/** 서버에 저장되는 모양 — 본문(시트·서식사전)은 gzip+base64 문자열 한 필드다. */
export type ReportPackDoc = {
  month: string;
  fileName: string;
  sheetNames: string[];
  gzipBase64: string;
  maskedFields: number;
  uploadedAt: string;
  uploadedBy: string;
  editedAt?: string;
  editedBy?: string;
  /**
   * 판올림 번호 — 저장할 때마다 1씩 오른다. **동시 수정 방어의 유일한 기준**이다.
   *
   * [왜 시각으로는 안 되는가] 예전에는 `editedAt || uploadedAt` 문자열을 비교했는데,
   * 둘 다 비어 있는 문서끼리는 `"" === ""` 로 통과해 **서로 다른 내용을 조용히 덮어썼다.**
   * 숫자 판올림은 그런 무승부가 없다. 값이 없는 옛 문서는 revOf() 가 0으로 본다.
   */
  rev?: number;
};

export type ReportPackIndexEntry = {
  month: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string;
};
export type ReportPackIndex = { months: ReportPackIndexEntry[] };

export class ReportPackError extends Error {}

// ── 마스킹 ────────────────────────────────────────────────

/**
 * 주민등록번호 — 뒤 7자리 중 성별자리 1자리만 남기고 지운다. `740130-2624718` → `740130-2******`
 * 성별자리를 남기는 이유: 명단을 훑을 때 성별 구분이 실무에 쓰이고, 그 한 자리로는 개인을 특정할 수 없다.
 *
 * [g 플래그를 판정용과 치환용으로 나눈 이유] 전역 정규식은 `test()` 가 lastIndex 를 남겨
 * **다음 호출을 중간부터 검사한다** — 같은 객체를 판정과 치환에 함께 쓰면 셀마다 결과가 달라진다.
 */
const RRN_TEST_RE = /\d{6}\s*-\s*\d{7}/;
const RRN_REPLACE_RE = /(\d{6})\s*-\s*(\d)(\d{6})/g;

/** 계좌로 볼 만한 은행 이름 조각. 머리글을 못 찾은 칸을 값만 보고 잡을 때 쓴다. */
const BANK_WORDS = [
  "국민", "신한", "우리", "하나", "기업", "농협", "카카오", "토스", "새마을", "우체국",
  "부산", "대구", "광주", "전북", "경남", "제주", "수협", "씨티", "SC제일", "케이뱅크",
  "산업", "신협", "저축", "KB", "IBK", "NH", "SC",
];

/** 머리글 이름으로 찾는 마스킹 대상 열. 시트마다 열 위치가 달라 위치를 못 박으면 새어 나간다. */
const RRN_HEADERS = ["주민등록번호", "주민번호"];
const ACCOUNT_HEADERS = ["입금계좌", "계좌번호", "입금 계좌"];

function maskRrnText(text: string): { text: string; hits: number } {
  let hits = 0;
  const out = text.replace(RRN_REPLACE_RE, (_m, front: string, gender: string) => {
    hits += 1;
    return `${front}-${gender}******`;
  });
  return { text: out, hits };
}

/**
 * 계좌번호 — 숫자만 골라 **앞 4자리·뒤 3자리만 남기고** 나머지를 `*` 로 바꾼다. 구분기호는 그대로 둔다.
 *   `국민 004-21-0708-250` → `국민 004-2*-****-250`
 *   `카카오 3333027241167`  → `카카오 3333******167`
 * 앞자리를 남기는 이유는 은행·지점 확인, 뒷자리는 대조용이다. 이 조합으로는 송금이 불가능하다.
 */
function maskAccountText(text: string): { text: string; hits: number } {
  const digits = text.match(/\d/g);
  if (!digits || digits.length < 8) return { text, hits: 0 }; // 계좌로 보기 어려운 짧은 값은 건드리지 않는다
  const keepFront = 4;
  const keepBack = 3;
  let seen = 0;
  const total = digits.length;
  const out = text.replace(/\d/g, (d) => {
    const index = seen++;
    return index < keepFront || index >= total - keepBack ? d : "*";
  });
  return { text: out, hits: 1 };
}

function cellText(value: ReportCell): string {
  return typeof value === "string" ? value : String(value);
}

function headerMatches(value: ReportCell, names: string[]): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.replace(/\s+/g, "");
  return names.some((n) => trimmed === n.replace(/\s+/g, ""));
}

/**
 * 시트 한 장을 마스킹한다. 판정은 **머리글 + 값 패턴 이중**이다.
 *  ① 머리글: `주민등록번호`/`입금계좌` 가 적힌 칸을 찾아 그 **열의 아래쪽 전부**를 대상으로 삼는다.
 *     한 시트에 급여 블록이 두 벌(실무자/실무자 외) 있어도 같은 열이라 함께 걸린다.
 *  ② 값 패턴: 머리글을 못 찾아도 주민번호 형태(`\d{6}-\d{7}`)는 어느 칸에 있든 지운다.
 *     계좌는 값만으로 단정하기 어려워(전화·사업자번호와 헷갈린다) 은행 이름이 함께 있을 때만 잡는다.
 * 반환값의 hits 가 0 이면 패턴이 안 맞은 것일 수 있으므로 화면에서 경고한다.
 */
export function maskSheetRows(rows: ReportCell[][]): { rows: ReportCell[][]; hits: number } {
  // 열 → 그 열을 마스킹하기 시작할 행. 같은 열에 머리글이 여러 번 나오면 가장 위 행부터 적용한다.
  const rrnCols = new Map<number, number>();
  const accountCols = new Map<number, number>();
  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      if (headerMatches(value, RRN_HEADERS)) rrnCols.set(c, Math.min(rrnCols.get(c) ?? Infinity, r + 1));
      if (headerMatches(value, ACCOUNT_HEADERS)) accountCols.set(c, Math.min(accountCols.get(c) ?? Infinity, r + 1));
    });
  });

  let hits = 0;
  const masked = rows.map((row, r) =>
    row.map((value, c) => {
      if (value === "" || value === null || value === undefined) return value;
      const text = cellText(value);

      // ① 주민번호 열 · ② 어디에 있든 주민번호 형태
      const rrnStart = rrnCols.get(c);
      const inRrnColumn = rrnStart !== undefined && r >= rrnStart;
      if (inRrnColumn || RRN_TEST_RE.test(text)) {
        const result = maskRrnText(text);
        if (result.hits > 0) { hits += result.hits; return result.text; }
        // 주민번호 열인데 형태가 다르면(구분기호 없이 숫자로만 들어온 값 등) 통째로 가린다 — 새는 것보다 낫다.
        if (inRrnColumn && /\d{6,}/.test(text)) {
          hits += 1;
          return `${text.slice(0, 6)}******`;
        }
        return value;
      }

      // ③ 계좌 열 · ④ 은행 이름이 함께 있는 값
      const accountStart = accountCols.get(c);
      const looksLikeAccount =
        (accountStart !== undefined && r >= accountStart) ||
        (BANK_WORDS.some((w) => text.includes(w)) && (text.match(/\d/g)?.length ?? 0) >= 8);
      if (looksLikeAccount) {
        const result = maskAccountText(text);
        hits += result.hits;
        return result.text;
      }
      return value;
    })
  );
  return { rows: masked, hits };
}

// ── 결산월 인식 ────────────────────────────────────────────

/** `마음죽_2607` / `험프리스_26.07월` / `2607_손익계산서_통합.xlsx` 에서 YYMM 을 꺼낸다. */
function monthFromText(text: string): string | null {
  const compact = text.match(/(\d{2})(\d{2})(?!\d)/);           // 2607
  const dotted = text.match(/(\d{2})\s*[.\-/]\s*(\d{2})\s*월?/); // 26.07월
  const pick = dotted || compact;
  if (!pick) return null;
  const [, yy, mm] = pick;
  const monthNum = Number(mm);
  if (monthNum < 1 || monthNum > 12) return null;
  return `${yy}${mm}`;
}

/** 시트 A1 들의 다수결 → 파일명 순으로 결산월을 정한다. 못 정하면 null(업로드를 거부한다). */
function detectMonth(sheets: { rows: ReportCell[][] }[], fileName: string): string | null {
  const votes = new Map<string, number>();
  sheets.forEach((sheet) => {
    const a1 = sheet.rows[0]?.[0];
    if (a1 === undefined) return;
    const month = monthFromText(cellText(a1));
    if (month) votes.set(month, (votes.get(month) ?? 0) + 1);
  });
  const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : monthFromText(fileName);
}

// ── gzip ──────────────────────────────────────────────────

export function supportsGzip(): boolean {
  return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
}

function bytesToBase64(bytes: Uint8Array): string {
  // 한 번에 넘기면 인자 수 한도(수만 개)를 넘겨 RangeError 가 난다 — 조각내서 잇는다.
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function gzipToBase64(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const buffer = await new Response(stream).arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
}

async function base64ToText(base64: string): Promise<string> {
  const stream = new Blob([base64ToBytes(base64)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

/** 본문(시트+서식사전)을 압축해 문자열 하나로 만든다. 한도를 넘으면 던진다. */
export async function encodeReportBody(body: ReportBody): Promise<string> {
  if (!supportsGzip()) {
    throw new ReportPackError("이 브라우저는 압축(CompressionStream)을 지원하지 않습니다. Chrome 또는 Edge 최신 버전을 써주세요.");
  }
  const encoded = await gzipToBase64(JSON.stringify(body));
  if (encoded.length > MAX_ENCODED_BYTES) {
    throw new ReportPackError(
      `저장할 내용이 너무 큽니다(압축 후 ${Math.round(encoded.length / 1024)}KB). 한도는 ${Math.round(MAX_ENCODED_BYTES / 1024)}KB 입니다.`
    );
  }
  return encoded;
}

// ── 파일 → 저장 문서 ───────────────────────────────────────

function normalizeCell(value: unknown): ReportCell {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // 엑셀에서 날짜로 들어오는 칸이 섞여 있다(입사일 등). 시각이 0시면 날짜만 적는다.
    const pad = (n: number) => String(n).padStart(2, "0");
    const ymd = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    if (value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0) return ymd;
    return `${ymd} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

/** 서식 사전 — 같은 서식을 한 번만 담고 색인을 돌려준다. */
function makeDictionary<T>() {
  const list: T[] = [];
  const index = new Map<string, number>();
  return {
    list,
    idOf(value: T | undefined | null): number {
      if (value === undefined || value === null) return -1;
      const key = JSON.stringify(value);
      if (key === "{}" || key === '""') return -1;
      const found = index.get(key);
      if (found !== undefined) return found;
      list.push(value);
      index.set(key, list.length - 1);
      return list.length - 1;
    },
  };
}

/** 업로드한 xlsx 를 파싱 → 마스킹 → 저장 문서로 만든다. 실패는 ReportPackError 로 이유를 담아 던진다. */
export async function buildReportPackDoc(file: File, uploadedBy: string): Promise<ReportPackDoc> {
  if (!supportsGzip()) {
    throw new ReportPackError("이 브라우저는 압축(CompressionStream)을 지원하지 않습니다. Chrome 또는 Edge 최신 버전에서 올려주세요.");
  }
  const buffer = await file.arrayBuffer();
  const XLSXNS = await import("xlsx-js-style");
  const XLSX: any = (XLSXNS as any).default ?? XLSXNS;
  const workbook = XLSX.read(buffer, { cellStyles: true, cellDates: true });
  if (!workbook.SheetNames?.length) throw new ReportPackError("시트가 없는 파일입니다.");

  // 볼드·정렬·테두리는 SheetJS 가 안 주므로 원본 zip 에서 직접 읽는다. 실패해도 값은 보여야 하므로 null 허용.
  const workbookStyles = await readXlsxStyles(buffer);

  const styleDict = makeDictionary<XlsxCellStyle>();
  const fmtDict = makeDictionary<string>();
  let maskedFields = 0;

  const sheets: ReportSheet[] = workbook.SheetNames.map((name: string) => {
    const sheet = workbook.Sheets[name];
    const ref: string | undefined = sheet["!ref"];
    // [P0] 원점을 **반드시 A1 로 못 박는다.**
    // 값이 A1 에서 시작하지 않는 시트가 있다(2607 파일의 `상각` 시트는 범위가 `B2:Y66`).
    // 그대로 두면 B열이 A열로, 2행이 1행으로 **통째로 밀려** 엑셀과 칸 위치가 어긋난다.
    const range = ref
      ? { s: { r: 0, c: 0 }, e: XLSX.utils.decode_range(ref).e }
      : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } };

    const rowCount = range.e.r + 1;
    const colCount = range.e.c + 1;
    const rows: ReportCell[][] = [];
    const fmt: number[][] = [];
    const styleIds: number[][] = [];
    const sheetStyles = workbookStyles?.sheets[name]?.cells;

    for (let r = 0; r < rowCount; r += 1) {
      const rowValues: ReportCell[] = [];
      const rowFmt: number[] = [];
      const rowSty: number[] = [];
      for (let c = 0; c < colCount; c += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        rowValues.push(normalizeCell(cell?.v));
        // z 가 "General" 이면 굳이 담지 않는다 — 화면에서 기본 규칙(천 단위 쉼표)으로 그린다.
        rowFmt.push(cell?.z && cell.z !== "General" ? fmtDict.idOf(String(cell.z)) : -1);
        const styleId = sheetStyles?.[`${r},${c}`];
        rowSty.push(styleId === undefined ? -1 : styleDict.idOf(workbookStyles!.styles[styleId]));
      }
      // 꼬리 빈칸은 저장하지 않는다(격자 폭은 cols 가 정한다).
      while (rowValues.length > 0 && rowValues[rowValues.length - 1] === "" && rowSty[rowSty.length - 1] === -1) {
        rowValues.pop(); rowFmt.pop(); rowSty.pop();
      }
      rows.push(rowValues); fmt.push(rowFmt); styleIds.push(rowSty);
    }
    // 꼬리 빈 행도 버린다.
    while (rows.length > 0 && rows[rows.length - 1].length === 0) { rows.pop(); fmt.pop(); styleIds.pop(); }

    const masked = maskSheetRows(rows);
    maskedFields += masked.hits;

    // 열 너비 — 엑셀의 실제 폭(px)을 쓴다. 이것이 없으면 빈 열이 쪼그라들어 표가 화면보다 좁아지고,
    // 그러면 **가로 스크롤이 아예 생기지 않아** 오른쪽 열을 볼 수 없다(2026-08-11 사용자 지적).
    const cols: number[] = [];
    for (let c = 0; c < colCount; c += 1) {
      const width = sheet["!cols"]?.[c]?.wpx;
      cols.push(typeof width === "number" && width > 0 ? Math.round(width) : DEFAULT_COL_PX);
    }
    const heights: number[] = [];
    for (let r = 0; r < rowCount; r += 1) {
      const height = sheet["!rows"]?.[r]?.hpx;
      heights.push(typeof height === "number" && height > 0 ? Math.round(height) : 0);
    }
    const merges: ReportMerge[] = (sheet["!merges"] || []).map((m: any) => ({
      r: m.s.r, c: m.s.c, rs: m.e.r - m.s.r + 1, cs: m.e.c - m.s.c + 1,
    }));

    return { name, rows: masked.rows, fmt, sty: styleIds, cols, heights, merges };
  });

  const month = detectMonth(sheets, file.name);
  if (!month) {
    throw new ReportPackError(
      "결산월을 알아내지 못했습니다. 시트 A1의 '지점명_2607' 표기나 파일명 앞의 '2607'을 확인해주세요."
    );
  }

  const gzipBase64 = await encodeReportBody({ sheets, styles: styleDict.list, numFmts: fmtDict.list });

  return {
    month,
    fileName: file.name,
    sheetNames: sheets.map((s) => s.name),
    gzipBase64,
    maskedFields,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
  };
}

/** 화면에서 고친 내용을 저장 문서로 다시 만든다(업로드 정보는 그대로 두고 수정 정보만 갱신). */
export async function reencodeReportPack(pack: ReportPack, editedBy: string): Promise<ReportPackDoc> {
  const gzipBase64 = await encodeReportBody({ sheets: pack.sheets, styles: pack.styles, numFmts: pack.numFmts });
  return {
    month: pack.month,
    fileName: pack.fileName,
    sheetNames: pack.sheets.map((s) => s.name),
    gzipBase64,
    maskedFields: pack.maskedFields,
    uploadedAt: pack.uploadedAt,
    uploadedBy: pack.uploadedBy,
    editedAt: new Date().toISOString(),
    editedBy,
  };
}

/** 저장 문서 → 화면에서 쓰는 모양. 압축을 풀지 못하면 null(화면이 안내를 띄운다). */
export async function decodeReportPack(value: unknown): Promise<ReportPack | null> {
  if (!value || typeof value !== "object") return null;
  const doc = value as Partial<ReportPackDoc>;
  if (typeof doc.gzipBase64 !== "string" || typeof doc.month !== "string") return null;
  if (!supportsGzip()) throw new ReportPackError("이 브라우저는 압축 해제(DecompressionStream)를 지원하지 않습니다.");
  let body: ReportBody;
  try {
    body = JSON.parse(await base64ToText(doc.gzipBase64)) as ReportBody;
  } catch {
    return null;
  }
  if (!body || !Array.isArray(body.sheets)) return null;
  return {
    sheets: body.sheets,
    styles: Array.isArray(body.styles) ? body.styles : [],
    numFmts: Array.isArray(body.numFmts) ? body.numFmts : [],
    month: doc.month,
    fileName: doc.fileName || "",
    sheetNames: Array.isArray(doc.sheetNames) ? doc.sheetNames : body.sheets.map((s) => s.name),
    maskedFields: typeof doc.maskedFields === "number" ? doc.maskedFields : 0,
    uploadedAt: doc.uploadedAt || "",
    uploadedBy: doc.uploadedBy || "",
    editedAt: doc.editedAt,
    editedBy: doc.editedBy,
    rev: revOf(value),
  };
}

/**
 * 저장 문서의 판올림 번호를 꺼낸다. 번호가 없는 옛 문서는 **0** 으로 본다.
 * 0 으로 두면 옛 문서를 처음 저장할 때 1 이 되고, 그 뒤로는 두 기기가 같은 번호에서 출발할 수 없다.
 */
export function revOf(value: unknown): number {
  const rev = (value as { rev?: unknown } | null | undefined)?.rev;
  return typeof rev === "number" && Number.isFinite(rev) ? rev : 0;
}

/**
 * 비교-후-쓰기(CAS) 갱신자를 만든다. `mutateSharedData` 의 트랜잭션 안에서 불린다.
 *
 * **순수 함수여야 한다** — 트랜잭션이 재시도하면 여러 번 불린다. 그래서 바깥 변수에 아무것도 적지 않고,
 * "쓸지 말지"만 반환값으로 알린다(null = 한 글자도 쓰지 않음).
 *
 * 판정 기준은 **판올림 번호 하나뿐**이다. 시각 문자열로 비교하던 때는 두 문서가 모두 시각이 비면
 * `"" === ""` 로 통과해 서로 다른 내용을 조용히 덮어썼다.
 */
export function reportPackCasUpdater(doc: ReportPackDoc, baseRev: number) {
  return (current: unknown): ReportPackDoc | null => {
    if (current && revOf(current) !== baseRev) return null; // 내가 읽은 뒤 다른 기기가 썼다
    return { ...doc, rev: baseRev + 1 };
  };
}

/** 월 목록 문서를 안전하게 읽는다(형식이 깨졌으면 빈 목록). */
export function normalizeIndex(value: unknown): ReportPackIndex {
  if (!value || typeof value !== "object") return { months: [] };
  const list = (value as Partial<ReportPackIndex>).months;
  if (!Array.isArray(list)) return { months: [] };
  const months = list
    .filter((e): e is ReportPackIndexEntry => !!e && typeof e === "object" && typeof (e as ReportPackIndexEntry).month === "string")
    .map((e) => ({
      month: e.month,
      fileName: typeof e.fileName === "string" ? e.fileName : "",
      uploadedAt: typeof e.uploadedAt === "string" ? e.uploadedAt : "",
      uploadedBy: typeof e.uploadedBy === "string" ? e.uploadedBy : "",
    }));
  return { months };
}

/**
 * 월 목록에 한 달을 끼워 넣는다(같은 달은 교체). **순수 함수** — mutateSharedData 가 재시도 시
 * 여러 번 호출하므로 바깥 값을 건드리면 안 된다.
 */
export function withMonthEntry(current: unknown, entry: ReportPackIndexEntry): ReportPackIndex {
  const base = normalizeIndex(current);
  const months = base.months.filter((m) => m.month !== entry.month).concat(entry);
  months.sort((a, b) => a.month.localeCompare(b.month));
  return { months };
}

// ── 화면 표시 도우미 ────────────────────────────────────────

/** 0→A, 25→Z, 26→AA … 엑셀 열 문자. */
export function columnLabel(index: number): string {
  let n = index;
  let label = "";
  while (n >= 0) {
    label = String.fromCharCode((n % 26) + 65) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

/** `2607` → `2026년 7월` */
export function monthLabel(month: string): string {
  if (!/^\d{4}$/.test(month)) return month;
  return `20${month.slice(0, 2)}년 ${Number(month.slice(2, 4))}월`;
}

/**
 * 셀 표시값 — **엑셀의 숫자 서식을 그대로 적용한다.**
 * `#,##0` → `28,787,990` · `0.0%` → `17.7%` (엑셀이 보여주는 것과 같은 문자열).
 * 서식이 없는(General) 숫자는 ERP 공통 규칙대로 천 단위 쉼표를 넣는다(DESIGN.md §9-4).
 * 서식 적용에 실패하면 값을 그대로 보여준다 — 화면이 비는 것보다 낫다.
 */
export function formatCellText(value: ReportCell, formatCode: string | undefined, ssf: any): string {
  if (value === "" || value === null || value === undefined) return "";
  if (typeof value !== "number") return String(value);
  if (formatCode && ssf?.format) {
    try {
      return String(ssf.format(formatCode, value));
    } catch {
      /* 서식이 깨졌으면 아래 기본 규칙으로 */
    }
  }
  if (Number.isInteger(value)) return value.toLocaleString("ko-KR");
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 4 });
}

/**
 * 칸 하나를 고친 새 pack 을 만든다. **순수 함수 · 불변 갱신**이다.
 * 바꾼 행만 새 배열이라 나머지 행은 참조가 같고, 그래서 ReportGrid 의 행 memo 가
 * **그 행 하나만** 다시 그린다(640행을 매 타자마다 다시 그리면 눈에 띄게 버벅인다).
 * 값이 그대로면 **같은 pack 을 그대로 돌려준다** — 호출부는 이것으로 "고친 것 없음"을 판단한다.
 */
export function withEditedCell(pack: ReportPack, sheetName: string, cell: { r: number; c: number }, value: ReportCell): ReportPack {
  const sheetIndex = pack.sheets.findIndex((s) => s.name === sheetName);
  if (sheetIndex < 0) return pack;
  const sheet = pack.sheets[sheetIndex];
  const oldRow = sheet.rows[cell.r];
  if (!oldRow) return pack;
  if ((oldRow[cell.c] ?? "") === value) return pack;
  const newRow = oldRow.slice();
  // 꼬리 빈칸을 잘라 저장하므로 행이 짧을 수 있다 — 고치려는 칸까지 늘린다.
  while (newRow.length <= cell.c) newRow.push("");
  newRow[cell.c] = value;
  const rows = sheet.rows.slice();
  rows[cell.r] = newRow;
  const sheets = pack.sheets.slice();
  sheets[sheetIndex] = { ...sheet, rows };
  return { ...pack, sheets };
}

/** 끌어서 줄일 수 있는 최소 크기(배율 100% 기준 px). 0 으로 만들어 칸을 잃어버리지 않게 막는다. */
export const MIN_COL_PX = 24;
export const MIN_ROW_PX = 12;

/**
 * 열 너비를 바꾼 새 pack 을 만든다(순수 함수·불변 갱신). `px` 는 **배율 100% 기준**이다 —
 * 화면에서 끈 폭을 그대로 담으면 배율을 바꿨을 때 크기가 어긋난다.
 * 값이 그대로면 같은 pack 을 돌려준다(호출부가 "고친 것 없음"을 이것으로 판단한다).
 */
export function withColumnWidth(pack: ReportPack, sheetName: string, col: number, px: number): ReportPack {
  const sheetIndex = pack.sheets.findIndex((s) => s.name === sheetName);
  if (sheetIndex < 0) return pack;
  const sheet = pack.sheets[sheetIndex];
  if (col < 0 || col >= sheet.cols.length) return pack;
  const next = Math.max(MIN_COL_PX, Math.round(px));
  if (sheet.cols[col] === next) return pack;
  const cols = sheet.cols.slice();
  cols[col] = next;
  const sheets = pack.sheets.slice();
  sheets[sheetIndex] = { ...sheet, cols };
  return { ...pack, sheets };
}

/** 행 높이를 바꾼 새 pack 을 만든다(순수 함수·불변 갱신). `px` 는 배율 100% 기준. */
export function withRowHeight(pack: ReportPack, sheetName: string, row: number, px: number): ReportPack {
  const sheetIndex = pack.sheets.findIndex((s) => s.name === sheetName);
  if (sheetIndex < 0) return pack;
  const sheet = pack.sheets[sheetIndex];
  if (row < 0 || row >= sheet.rows.length) return pack;
  const next = Math.max(MIN_ROW_PX, Math.round(px));
  const heights = sheet.heights.slice();
  // heights 는 행 수보다 짧을 수 있다(꼬리 빈 행을 잘라 냈다) — 고치려는 행까지 늘린다.
  while (heights.length <= row) heights.push(0);
  if (heights[row] === next) return pack;
  heights[row] = next;
  const sheets = pack.sheets.slice();
  sheets[sheetIndex] = { ...sheet, heights };
  return { ...pack, sheets };
}

/** 사용자가 친 값을 셀 값으로 바꾼다. 숫자로 읽히면 숫자로 — 그래야 숫자 서식이 다시 걸린다. */
export function parseEditedValue(input: string): ReportCell {
  const trimmed = input.trim();
  if (trimmed === "") return "";
  // 천 단위 쉼표가 든 숫자도 숫자로 받는다("28,787,990" → 28787990).
  const numeric = trimmed.replace(/,/g, "");
  if (/^-?\d+(\.\d+)?$/.test(numeric)) {
    const n = Number(numeric);
    if (Number.isFinite(n)) return n;
  }
  // 퍼센트로 친 값은 엑셀과 같게 비율로 바꾼다("17.7%" → 0.177).
  const percent = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(numeric);
  if (percent) {
    const n = Number(percent[1]) / 100;
    if (Number.isFinite(n)) return n;
  }
  return input;
}
