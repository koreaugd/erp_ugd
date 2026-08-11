// src/pages/admin/helpers/xlsxStyles.ts
// xlsx 파일에서 **셀 서식**을 직접 읽어 온다 — 볼드·정렬·테두리·글자색/크기.
//
// [왜 직접 읽는가]
// SheetJS(xlsx / xlsx-js-style 1.2.0)의 읽기 경로는 `cellStyles: true` 를 줘도 셀의 `.s` 에
// **채우기(fill)만** 담아 준다. 통합보고서는 머리글·합계행·강조행이 전부 볼드라, 그것이 빠지면
// "엑셀 서식 그대로"가 성립하지 않는다(2026-08-11 사용자 지시). 그래서 값·숫자서식·열너비·병합은
// SheetJS 에서 받고, **볼드·정렬·테두리·글자색만** 여기서 채운다.
//
// [무엇을 하지 않는가]
// 값을 다시 파싱하지 않는다. 필요한 것은 `<c r="A3" s="12">` 의 **s(서식 번호)** 뿐이고,
// 값은 SheetJS 가 이미 정확히 읽었다. 그래서 이 파일은 "주소 → 서식번호" 와 "서식번호 → 서식" 두 표만 만든다.
//
// [XML 을 정규식으로 읽는 이유]
// 브라우저에는 DOMParser 가 있지만 Node(검증 스크립트)에는 없다. 한 구현으로 양쪽에서 돌려야
// 검증한 코드가 곧 화면에서 도는 코드가 된다. 엑셀이 뱉는 XML 은 기계 생성이라 형태가 일정하고,
// SheetJS 자신도 같은 이유로 정규식 파서를 쓴다.

export type XlsxCellStyle = {
  /** 배경색 6자리 RGB(대문자, 앞의 알파 2자리는 뗀다). 없으면 undefined */
  bg?: string;
  /** 글자색 6자리 RGB */
  fg?: string;
  bold?: boolean;
  italic?: boolean;
  /** 글자 크기(pt) */
  size?: number;
  align?: "left" | "center" | "right";
  wrap?: boolean;
  /** 사방 테두리 유무 — 굵기는 구분하지 않는다(엑셀은 대부분 thin 하나만 쓴다) */
  bt?: boolean;
  br?: boolean;
  bb?: boolean;
  bl?: boolean;
};

/** 시트 하나의 서식 — cells 는 `"행,열"`(0부터) → styles 배열의 색인. 빈 서식은 담지 않는다. */
export type SheetStyles = { cells: Record<string, number> };

export type WorkbookStyles = {
  /** 서식 사전. 파일 전체에서 공유한다(2607 파일 실측 서로 다른 서식 69종). */
  styles: XlsxCellStyle[];
  /** 시트 이름 → 그 시트의 셀 서식 색인 */
  sheets: Record<string, SheetStyles>;
};

// ── 최소 ZIP 리더 ──────────────────────────────────────────
// xlsx 는 zip 이다. 필요한 항목(styles.xml, workbook.xml, 시트 xml)만 꺼낸다.
// 압축 해제는 브라우저·Node 에 모두 있는 DecompressionStream("deflate-raw") 로 한다.

type ZipEntry = { name: string; method: number; offset: number; compressedSize: number };

function readU16(view: DataView, at: number): number { return view.getUint16(at, true); }
function readU32(view: DataView, at: number): number { return view.getUint32(at, true); }

/** 중앙 디렉터리를 읽어 항목 목록을 만든다. 로컬 헤더만 훑으면 data descriptor 가 붙은 항목에서 어긋난다. */
function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // EOCD(0x06054b50) 는 파일 끝에 있다. 주석이 붙을 수 있어 최대 64KB 를 거슬러 찾는다.
  let eocd = -1;
  const from = Math.max(0, bytes.length - 22 - 65_535);
  for (let i = bytes.length - 22; i >= from; i -= 1) {
    if (readU32(view, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip 형식이 아닙니다(EOCD 없음)");
  const count = readU16(view, eocd + 10);
  let at = readU32(view, eocd + 16);

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (readU32(view, at) !== 0x02014b50) break;
    const method = readU16(view, at + 10);
    const compressedSize = readU32(view, at + 20);
    const nameLen = readU16(view, at + 28);
    const extraLen = readU16(view, at + 30);
    const commentLen = readU16(view, at + 32);
    const offset = readU32(view, at + 42);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    entries.push({ name, method, offset, compressedSize });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readZipFile(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readU32(view, entry.offset) !== 0x04034b50) throw new Error(`zip 항목이 깨졌습니다: ${entry.name}`);
  // 이름·extra 길이는 **로컬 헤더 쪽 값**을 써야 한다 — 중앙 디렉터리와 다를 수 있다.
  const nameLen = readU16(view, entry.offset + 26);
  const extraLen = readU16(view, entry.offset + 28);
  const start = entry.offset + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(raw);
  if (entry.method !== 8) throw new Error(`지원하지 않는 압축 방식(${entry.method}): ${entry.name}`);
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

// ── XML 훑기 ──────────────────────────────────────────────

/** `<fonts …> … </fonts>` 같은 묶음의 **안쪽**만 꺼낸다. 없으면 빈 문자열. */
function sectionOf(xml: string, tag: string): string {
  const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "");
  const m = open.exec(xml);
  if (!m) return "";
  const start = m.index + m[0].length;
  const end = xml.indexOf(`</${tag}>`, start);
  return end < 0 ? "" : xml.slice(start, end);
}

/**
 * 묶음 안의 같은 이름 자식들을 통째로(여는 태그~닫는 태그) 잘라 낸다. `<xf/>` 같은 빈 태그도 담는다.
 *
 * [P0 함정 — 실제로 당함] 속성부를 `[^>]*` 로 훑으면 **그리디 매칭이 끝의 `/` 까지 먹어**
 * `<xf a="1"/>` 를 여는 태그로 오인한다. 그러면 그 뒤에 오는 `</xf>` 를 자기 짝으로 삼아
 * 항목 여러 개를 하나로 삼켜 버린다 — 2607 파일에서 cellXfs 263개가 216개로 줄었고,
 * 셀의 s(서식번호)가 전부 엉뚱한 서식을 가리켰다. `/` 를 속성부 밖에서 따로 받아야 한다.
 */
function childrenOf(section: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*?)?\\s*(/?)>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    if (m[1] === "/") { out.push(m[0]); continue; }
    const end = section.indexOf(`</${tag}>`, re.lastIndex);
    if (end < 0) { out.push(m[0]); continue; }
    out.push(section.slice(m.index, end + tag.length + 3));
    re.lastIndex = end + tag.length + 3;
  }
  return out;
}

function attr(xml: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(xml);
  return m ? m[1] : undefined;
}

/** `FFFFFF00` / `FFFF00` → `FFFF00`. 알파 2자리를 떼고 6자리로 맞춘다. */
function rgb6(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const hex = value.trim().toUpperCase();
  if (/^[0-9A-F]{8}$/.test(hex)) return hex.slice(2);
  if (/^[0-9A-F]{6}$/.test(hex)) return hex;
  return undefined;
}

// ── styles.xml ────────────────────────────────────────────

type FontDef = { bold?: boolean; italic?: boolean; size?: number; fg?: string };
type BorderDef = { bt?: boolean; br?: boolean; bb?: boolean; bl?: boolean };

function parseFonts(stylesXml: string): FontDef[] {
  return childrenOf(sectionOf(stylesXml, "fonts"), "font").map((font) => {
    const def: FontDef = {};
    // `<b/>` 는 있으면 참, `<b val="0"/>` 는 거짓이다. val 이 없으면 참이 기본값.
    const b = /<b(\s[^>]*)?\/?>/.exec(font);
    if (b && attr(b[0], "val") !== "0") def.bold = true;
    const i = /<i(\s[^>]*)?\/?>/.exec(font);
    if (i && attr(i[0], "val") !== "0") def.italic = true;
    const sz = /<sz\s[^>]*\/?>/.exec(font);
    if (sz) { const v = Number(attr(sz[0], "val")); if (Number.isFinite(v)) def.size = v; }
    // theme/indexed 색은 다루지 않는다 — 이 파일들은 기본 검정이라 굳이 풀 필요가 없고,
    // 잘못 풀면 오히려 원본에 없는 색이 생긴다. rgb 로 명시된 것만 쓴다.
    const color = /<color\s[^>]*\/?>/.exec(font);
    if (color) { const v = rgb6(attr(color[0], "rgb")); if (v) def.fg = v; }
    return def;
  });
}

function parseFills(stylesXml: string): (string | undefined)[] {
  return childrenOf(sectionOf(stylesXml, "fills"), "fill").map((fill) => {
    if (!/patternType="solid"/.test(fill)) return undefined;
    const fg = /<fgColor\s[^>]*\/?>/.exec(fill);
    return fg ? rgb6(attr(fg[0], "rgb")) : undefined;
  });
}

function parseBorders(stylesXml: string): BorderDef[] {
  return childrenOf(sectionOf(stylesXml, "borders"), "border").map((border) => {
    const has = (side: string) => {
      const m = new RegExp(`<${side}(\\s[^>]*)?(/>|>)`).exec(border);
      if (!m) return false;
      const style = attr(m[0], "style");
      return !!style && style !== "none";
    };
    const def: BorderDef = {};
    if (has("top")) def.bt = true;
    if (has("right")) def.br = true;
    if (has("bottom")) def.bb = true;
    if (has("left")) def.bl = true;
    return def;
  });
}

/** cellXfs 한 줄(`<xf …>`)을 실제 서식으로 푼다. apply* 가 0 이면 그 항목은 안 쓴다는 뜻이다. */
function parseCellXfs(stylesXml: string, fonts: FontDef[], fills: (string | undefined)[], borders: BorderDef[]): XlsxCellStyle[] {
  return childrenOf(sectionOf(stylesXml, "cellXfs"), "xf").map((xf) => {
    const style: XlsxCellStyle = {};

    if (attr(xf, "applyFont") !== "0") {
      const font = fonts[Number(attr(xf, "fontId") ?? -1)];
      if (font) {
        if (font.bold) style.bold = true;
        if (font.italic) style.italic = true;
        if (font.size) style.size = font.size;
        if (font.fg && font.fg !== "000000") style.fg = font.fg;
      }
    }
    if (attr(xf, "applyFill") !== "0") {
      const bg = fills[Number(attr(xf, "fillId") ?? -1)];
      // 흰색 채우기는 담지 않는다 — 배경이 이미 흰색이라 칸 수만 늘린다.
      if (bg && bg !== "FFFFFF") style.bg = bg;
    }
    if (attr(xf, "applyBorder") !== "0") {
      const border = borders[Number(attr(xf, "borderId") ?? -1)];
      if (border) Object.assign(style, border);
    }
    const alignment = /<alignment\s[^>]*\/?>/.exec(xf);
    if (alignment) {
      const horizontal = attr(alignment[0], "horizontal");
      if (horizontal === "left" || horizontal === "center" || horizontal === "right") style.align = horizontal;
      if (attr(alignment[0], "wrapText") === "1") style.wrap = true;
    }
    return style;
  });
}

// ── 시트 → 셀별 서식 번호 ───────────────────────────────────

/** `A3` → `{ r: 2, c: 0 }` (0부터) */
function decodeAddress(address: string): { r: number; c: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(address);
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}

/** 시트 XML 에서 `<c r="A3" s="12"` 만 훑어 주소 → 서식번호 를 만든다. 값은 건드리지 않는다. */
function parseSheetStyleIndex(sheetXml: string): Record<string, number> {
  const out: Record<string, number> = {};
  const re = /<c\s[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sheetXml)) !== null) {
    const s = attr(m[0], "s");
    if (s === undefined) continue;
    const address = attr(m[0], "r");
    if (!address) continue;
    const at = decodeAddress(address);
    if (at) out[`${at.r},${at.c}`] = Number(s);
  }
  return out;
}

// ── 본체 ──────────────────────────────────────────────────

export function supportsInflate(): boolean {
  return typeof DecompressionStream === "function";
}

/**
 * xlsx 원본에서 셀 서식을 읽어 온다. 실패하면 null — **서식이 없어도 값은 보여야 하므로**
 * 호출부는 null 을 정상 경로로 다뤄야 한다(서식만 빠진 화면이 뜬다).
 */
export async function readXlsxStyles(buffer: ArrayBuffer): Promise<WorkbookStyles | null> {
  if (!supportsInflate()) return null;
  try {
    const bytes = new Uint8Array(buffer);
    const entries = readZipEntries(bytes);
    const byName = new Map(entries.map((e) => [e.name, e] as const));

    const stylesEntry = byName.get("xl/styles.xml");
    const workbookEntry = byName.get("xl/workbook.xml");
    const relsEntry = byName.get("xl/_rels/workbook.xml.rels");
    if (!stylesEntry || !workbookEntry || !relsEntry) return null;

    const stylesXml = await readZipFile(bytes, stylesEntry);
    const styles = parseCellXfs(stylesXml, parseFonts(stylesXml), parseFills(stylesXml), parseBorders(stylesXml));

    // 관계 파일: r:id → 시트 xml 경로
    const relTarget = new Map<string, string>();
    for (const rel of childrenOf(await readZipFile(bytes, relsEntry), "Relationship")) {
      const id = attr(rel, "Id");
      const target = attr(rel, "Target");
      if (id && target) relTarget.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
    }

    // 워크북: 시트 이름 → r:id (**이름 순서가 아니라 관계로 잇는다** — sheet1.xml 이 첫 탭이라는 보장이 없다)
    const workbookXml = await readZipFile(bytes, workbookEntry);
    const sheets: Record<string, SheetStyles> = {};
    for (const sheet of childrenOf(sectionOf(workbookXml, "sheets"), "sheet")) {
      const name = attr(sheet, "name");
      const rid = attr(sheet, "r:id") || attr(sheet, "relationshipId");
      if (!name || !rid) continue;
      const target = relTarget.get(rid);
      if (!target) continue;
      const entry = byName.get(`xl/${target}`);
      if (!entry) continue;
      sheets[name] = { cells: parseSheetStyleIndex(await readZipFile(bytes, entry)) };
    }

    // 이름을 XML 이스케이프한 채로 들고 있으면 SheetJS 의 시트 이름과 안 맞는다(&amp; 등).
    const unescaped: Record<string, SheetStyles> = {};
    for (const [name, value] of Object.entries(sheets)) {
      unescaped[name.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")] = value;
    }
    return { styles, sheets: unescaped };
  } catch (error) {
    console.error("xlsx 서식 읽기 실패(서식 없이 계속합니다):", error);
    return null;
  }
}
