// src/pages/admin/AdminReportPackTab.tsx
// 관리자 > 분석 > 통합보고서 — 03 에이전트의 `{YYMM}_손익계산서_통합*.xlsx` 를 엑셀 그대로 보고 고친다.
//
// 이 파일이 맡는 일: 월 선택 · 시트 탭 · 업로드 · 저장 · 안내.
// 격자를 그리고 칸을 고치는 일은 ReportGrid.tsx 가 맡는다(17,000칸 렌더링·키보드 처리가 따로 놀아야 읽힌다).
//
// [개인정보] 주민번호·계좌는 **업로드 파싱 단계에서** 지운다(helpers/reportPack.ts). 서버에 뒷자리가 남지 않는다.
// 문서 자체도 firestore.rules 의 isReportPackKey() 로 총괄관리자 전용이며, 자동 백업 사본까지 같이 막았다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gasClient } from "../../api/gasClient";
import LoadingSpinner from "../../components/LoadingSpinner";
import { DEFAULT_ZOOM, ReportGrid, ZOOM_OPTIONS, type CellRef } from "./ReportGrid";

import {
  REPORT_PACK_INDEX_KEY, ReportPackError, buildReportPackDoc, decodeReportPack, monthLabel,
  normalizeIndex, reencodeReportPack, reportPackCasUpdater, reportPackKey, revOf, supportsGzip,
  withColumnWidth, withEditedCell, withMonthEntry, withRowHeight,
  type ReportCell, type ReportPack, type ReportPackDoc, type ReportPackIndexEntry,
} from "./helpers/reportPack";

/**
 * 화면 배율 기억 — **보기 설정이지 업무 데이터가 아니다.**
 * 그래서 서버(shared_data)가 아니라 이 브라우저에만 둔다. 노트북마다 화면 크기가 달라
 * 오히려 기기별로 따로 기억하는 편이 맞다("모든 노트북에서 같아야 한다"는 규칙은 데이터에 대한 것이다).
 */
const ZOOM_STORAGE_KEY = "ugd.reportPack.zoom";

function readSavedZoom(): number {
  try {
    const saved = Number(window.localStorage.getItem(ZOOM_STORAGE_KEY));
    return ZOOM_OPTIONS.includes(saved as (typeof ZOOM_OPTIONS)[number]) ? saved : DEFAULT_ZOOM;
  } catch {
    return DEFAULT_ZOOM; // 사생활 보호 모드 등에서 localStorage 가 막혀도 화면은 떠야 한다
  }
}

/**
 * 월 보고서를 **원자적으로** 저장한다(비교-후-쓰기).
 *
 * [왜 saveSharedData 를 쓰지 않는가]
 * 예전에는 "서버 값을 읽어 시각을 비교" → "saveSharedData 로 쓰기" 두 단계였다. 그 **사이**에 다른
 * 노트북이 저장하면 그대로 덮어썼고, 두 문서의 시각이 모두 비어 있으면 `"" === ""` 로 비교를 통과해
 * **조용히** 덮어썼다(Codex 정지게이트 지적 2026-08-11). mutateSharedData 는 트랜잭션이라 읽고-쓰는
 * 사이가 없고, 판올림 번호가 다르면 **아무것도 쓰지 않는다.**
 *
 * 갱신하지 않았을 때 돌려주는 value 는 **트랜잭션이 실제로 본 서버 값**이다(firebaseDirect.ts 규약).
 * 따로 다시 읽을 필요가 없고, 다시 읽는 사이에 또 바뀌는 문제도 없다.
 *
 * mutate 는 순수 함수여야 한다 — 트랜잭션 재시도로 여러 번 불린다. 그래서 바깥 변수에 적지 않고
 * 반환값(changed/value)만으로 판단한다.
 */
type CommitResult = {
  /** true = 내 내용이 서버에 들어갔다. false = 판올림이 어긋나 **아무것도 쓰지 않았다.** */
  ok: boolean;
  /** 저장에 성공했을 때의 새 판올림 번호 */
  rev: number;
  /** 실패했을 때 트랜잭션이 실제로 본 서버 문서(누가 언제 고쳤는지 안내에 쓴다) */
  server: Partial<ReportPackDoc> | null;
};

async function commitReportPack(month: string, doc: ReportPackDoc, baseRev: number): Promise<CommitResult> {
  // 갱신자는 순수 함수라 따로 뽑아 뒀다(helpers/reportPack.ts) — 검증 스크립트가 같은 함수로
  // 동시 저장 시나리오를 돌린다. 여기서 다시 짜면 "검증한 코드"와 "도는 코드"가 갈라진다.
  // [cast 이유] gasClient 의 타입은 { changed } 만 노출하지만 실제 구현은 트랜잭션이 본 value 도 준다
  // (firebaseDirect.ts:756 주석 — "호출부가 커밋 결과로 화면을 갱신하려면 이 값이 필요하다").
  const result = (await gasClient.mutateSharedData(
    reportPackKey(month),
    reportPackCasUpdater(doc, baseRev)
  )) as { changed: boolean; value?: unknown };
  if (result.changed) return { ok: true, rev: baseRev + 1, server: null };
  return { ok: false, rev: baseRev, server: (result.value as Partial<ReportPackDoc> | null) ?? null };
}

/** 충돌 안내 문구 — 누가 언제 고쳤는지 밝힌다. "누군가 고쳤다"만으로는 덮어쓸지 판단할 수 없다. */
function conflictText(server: Partial<ReportPackDoc> | null): string {
  const who = server?.editedBy || server?.uploadedBy || "다른 사용자";
  const when = server?.editedAt || server?.uploadedAt;
  const whenText = when ? new Date(when).toLocaleString("ko-KR") : "방금";
  return `${who} 님이 ${whenText}에 이 보고서를 저장했습니다.`;
}

/** 업로드·저장·새로고침 단추 묶음. 모양은 `.admin-band-filters`(DESIGN_ADMIN §4-0)를 그대로 빌린다. */
function ReportTopControls({ onUpload, uploading, onRefresh, loading, onSave, saving, dirty, uploadedAtLabel }: {
  onUpload: (file: File) => void;
  uploading: boolean;
  onRefresh: () => void;
  loading: boolean;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
  uploadedAtLabel: string;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="admin-band-filters ml-auto">
      <input ref={fileRef} type="file" accept=".xlsx" className="hidden" aria-label="통합보고서 업로드"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          // 같은 파일을 다시 올릴 수 있게 값을 비운다 — 안 비우면 두 번째부터 change 가 안 뜬다.
          e.target.value = "";
        }} />
      {/* 저장은 고친 것이 있을 때만 눌린다 — 늘 눌리면 "눌렀는데 아무 일도 안 난다"가 된다. */}
      <button type="button" onClick={onSave} disabled={!dirty || saving}
        className={dirty ? "is-active" : undefined}
        title={dirty ? "고친 내용을 서버에 저장합니다" : "고친 내용이 없습니다"}>
        {saving ? "저장 중…" : dirty ? "저장" : "저장됨"}
      </button>
      <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
        title={uploadedAtLabel ? `마지막 업로드: ${uploadedAtLabel}` : "03 에이전트의 통합보고서 xlsx 를 올립니다"}>
        {uploading ? "업로드 중…" : "파일 업로드"}
      </button>
      <button type="button" onClick={onRefresh} disabled={loading}>
        {loading ? "불러오는 중…" : "새로고침"}
      </button>
    </div>
  );
}

export function AdminReportPackTab({ uploadedBy }: { uploadedBy: string }) {
  const [entries, setEntries] = useState<ReportPackIndexEntry[]>([]);
  const [month, setMonth] = useState("");
  const [pack, setPack] = useState<ReportPack | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [messageBad, setMessageBad] = useState(false);
  // 엑셀 숫자 서식(#,##0 · 0.0%)을 화면에서 그대로 재현하려면 SheetJS 의 서식기가 필요하다.
  // 무겁기도 하고 업로드 때만 쓰이던 묶음이라 화면이 뜬 뒤 따로 불러온다(없으면 기본 규칙으로 그린다).
  const [ssf, setSsf] = useState<any>(null);
  // 같은 달을 다시 올리면 month 가 안 바뀌어 아래 effect 가 다시 돌지 않는다 — 이 토큰으로 강제한다.
  const [reloadToken, setReloadToken] = useState(0);
  const [zoom, setZoom] = useState(readSavedZoom);
  const indexRequest = useRef(0);
  const packRequest = useRef(0);

  useEffect(() => {
    let alive = true;
    import("xlsx-js-style")
      .then((mod) => { if (alive) setSsf(((mod as any).default ?? mod).SSF); })
      .catch((error) => console.error("숫자 서식기 로드 실패(기본 규칙으로 표시합니다):", error));
    return () => { alive = false; };
  }, []);

  const loadIndex = useCallback(async () => {
    const requestId = ++indexRequest.current;
    setLoading(true);
    setLoadError("");
    try {
      const value = await gasClient.getSharedDataFromServer<unknown>(REPORT_PACK_INDEX_KEY);
      if (indexRequest.current !== requestId) return;
      const list = normalizeIndex(value).months;
      setEntries(list);
      // 기본은 **가장 최근 달**. 이미 고른 달이 목록에 남아 있으면 그대로 둔다.
      setMonth((current) => (current && list.some((e) => e.month === current) ? current : list[list.length - 1]?.month || ""));
    } catch (error) {
      console.error("통합보고서 목록 로드 실패:", error);
      if (indexRequest.current !== requestId) return;
      setEntries([]);
      setLoadError("통합보고서 목록을 불러오지 못했습니다. 권한(총괄관리자)과 네트워크를 확인해주세요.");
    } finally {
      if (indexRequest.current === requestId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIndex();
    return () => { indexRequest.current++; };
  }, [loadIndex]);

  useEffect(() => {
    if (!month) { setPack(null); setSheetName(""); setDirty(false); return; }
    const requestId = ++packRequest.current;
    setLoading(true);
    setLoadError("");
    (async () => {
      try {
        const value = await gasClient.getSharedDataFromServer<unknown>(reportPackKey(month));
        const decoded = await decodeReportPack(value);
        if (packRequest.current !== requestId) return;
        setPack(decoded);
        setDirty(false);
        if (decoded) {
          setSheetName((current) => (current && decoded.sheetNames.includes(current) ? current : decoded.sheetNames[0] || ""));
        } else {
          setSheetName("");
          setLoadError(`${monthLabel(month)} 보고서를 읽지 못했습니다. 파일을 다시 올려주세요.`);
        }
      } catch (error) {
        console.error("통합보고서 로드 실패:", error);
        if (packRequest.current !== requestId) return;
        setPack(null);
        // 들고 있던 문서가 사라졌으니 '저장 안 됨' 표시도 함께 내린다 —
        // 안 내리면 저장할 대상이 없는데도 저장 단추가 켜진 채로 남아 눌러도 아무 일이 안 난다.
        setDirty(false);
        setLoadError(
          error instanceof ReportPackError
            ? error.message
            : "통합보고서를 불러오지 못했습니다. 권한(총괄관리자)과 네트워크를 확인해주세요."
        );
      } finally {
        if (packRequest.current === requestId) setLoading(false);
      }
    })();
    return () => { packRequest.current++; };
  }, [month, reloadToken]);

  // 고친 채로 창을 닫거나 새로고침하면 그대로 사라진다 — 브라우저 기본 경고를 붙인다.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const say = (text: string, bad = false) => { setMessage(text); setMessageBad(bad); };

  /**
   * 고친 내용이 **실제로 버려지는** 동작 앞에서만 되묻는다 — 다른 달로 옮기기 · 새로고침 · 새 파일 업로드.
   * 이 셋은 모두 서버에서 문서를 다시 읽어 `pack` 을 통째로 갈아 끼우므로, 확인을 누르면 수정이 진짜로 사라진다.
   *
   * **시트 전환에는 쓰지 않는다.** 시트는 같은 파일 안이라 옮겨도 아무것도 버려지지 않는데,
   * 예전엔 여기서도 물어 놓고 정작 버리는 동작이 없어 "확인을 눌렀는데 수정이 남아 나중에 저장되는"
   * 어긋남이 있었다(Codex 정지게이트 2026-08-11).
   */
  const confirmLeave = (): boolean => {
    if (!dirty) return true;
    return window.confirm(
      "저장하지 않은 수정이 있습니다.\n모든 시트의 수정을 버리고 이동할까요?\n\n(취소한 뒤 '저장'을 누르면 지킬 수 있습니다)"
    );
  };

  const handleUpload = async (file: File) => {
    if (!confirmLeave()) return;
    setUploading(true);
    say("");
    try {
      const doc = await buildReportPackDoc(file, uploadedBy);

      // [fail-closed] 덮어쓰기 판단은 **월 목록이 아니라 그 달의 보고서 문서 자체**로 한다.
      // 예전에는 월 목록(index)의 존재 여부만 봤는데, **목록은 셀을 고쳐 저장해도 갱신되지 않는다.**
      // 그래서 다른 노트북이 고쳐 둔 내용이 "이미 있습니다" 안내조차 없이 사라질 수 있었고,
      // 목록 쓰기가 한 번 실패한 상태에서는 확인 자체가 통째로 건너뛰어졌다(Codex 정지게이트 2026-08-11).
      // 못 읽으면 업로드를 막는다 — 무엇을 지우는지 모른 채 지우는 것이 가장 나쁘다.
      let currentDoc: Partial<ReportPackDoc> | null;
      try {
        currentDoc = await gasClient.getSharedDataFromServer<Partial<ReportPackDoc>>(reportPackKey(doc.month));
      } catch {
        say("업로드 중단: 서버의 기존 보고서를 확인하지 못했습니다. 네트워크 확인 후 다시 시도해주세요.", true);
        return;
      }
      if (currentDoc) {
        const edited = !!currentDoc.editedAt;
        const ok = window.confirm(
          `${monthLabel(doc.month)} 보고서가 이미 있습니다.\n${conflictText(currentDoc)}\n` +
          `(파일: ${currentDoc.fileName || "이름 없음"})\n\n` +
          `이 파일로 통째로 덮어쓸까요?${edited ? "\n\n※ 화면에서 고친 내용이 모두 사라집니다." : ""}`
        );
        if (!ok) { say("업로드를 취소했습니다.", true); return; }
      }

      // 확인을 받는 사이에 또 바뀔 수 있으므로 쓰기는 비교-후-쓰기로 한다.
      const first = await commitReportPack(doc.month, doc, revOf(currentDoc));
      if (!first.ok) {
        const ok = window.confirm(
          `확인하는 사이에 보고서가 또 바뀌었습니다.\n${conflictText(first.server)}\n\n그 내용을 버리고 이 파일로 덮어쓸까요?`
        );
        if (!ok) { say("업로드를 취소했습니다. 새로고침으로 최신 내용을 받아주세요.", true); return; }
        const retry = await commitReportPack(doc.month, doc, revOf(first.server));
        if (!retry.ok) {
          say("업로드 실패: 저장하는 사이에 또 바뀌었습니다. 새로고침 후 다시 시도해주세요.", true);
          return;
        }
      }
      // 월 목록은 **트랜잭션**으로 고친다 — 읽어둔 값 위에 통째로 쓰면 그 사이 다른 기기가
      // 올린 달이 목록에서 사라진다. withMonthEntry 는 순수 함수다(재시도 시 여러 번 불린다).
      // 본문은 이미 저장됐으므로 여기서 실패하면 "목록에만 안 뜬다"고 정확히 알린다.
      try {
        await gasClient.mutateSharedData(REPORT_PACK_INDEX_KEY, (current) =>
          withMonthEntry(current, {
            month: doc.month, fileName: doc.fileName, uploadedAt: doc.uploadedAt, uploadedBy: doc.uploadedBy,
          })
        );
      } catch (error) {
        console.error("통합보고서 월 목록 갱신 실패:", error);
        say(`보고서는 저장됐지만 월 목록 갱신에 실패했습니다(${monthLabel(doc.month)}). 새로고침 후에도 목록에 없으면 다시 올려주세요.`, true);
        setReloadToken((n) => n + 1);
        return;
      }
      const sizeKb = Math.round(doc.gzipBase64.length / 1024);
      say(
        doc.maskedFields > 0
          ? `업로드 완료: ${monthLabel(doc.month)} · 시트 ${doc.sheetNames.length}개 · ${sizeKb}KB · 주민번호·계좌 ${doc.maskedFields}칸을 가려서 저장했습니다.`
          : `업로드 완료: ${monthLabel(doc.month)} · 시트 ${doc.sheetNames.length}개 · ${sizeKb}KB — 다만 가린 칸이 0개입니다. 급여 명단의 주민번호·계좌 표기를 확인해주세요.`,
        doc.maskedFields === 0
      );
      setDirty(false);
      setMonth(doc.month);
      setReloadToken((n) => n + 1);
      await loadIndex();
    } catch (error) {
      console.error("통합보고서 업로드 실패:", error);
      say(
        error instanceof ReportPackError
          ? `업로드 실패: ${error.message}`
          : "업로드 실패: 파일을 처리하지 못했습니다. 파일 형식과 네트워크 상태를 확인해주세요.",
        true
      );
    } finally {
      setUploading(false);
    }
  };

  /**
   * 칸 하나를 고친다. 실제 갱신은 순수 함수 withEditedCell 이 한다(불변 갱신 — ReportGrid 의 행 memo 가 살아 있게).
   * 값이 그대로면 같은 참조가 돌아오므로 **바뀐 게 없을 때 '저장 안 됨' 표시가 헛되이 켜지지 않는다.**
   *
   * [왜 pack 을 ref 로 읽는가] `useCallback([pack])` 으로 두면 한 칸 고칠 때마다 이 함수의 정체가 바뀌고,
   * 그것이 ReportGrid → GridRow 의 onCommit 까지 타고 내려가 **640행이 통째로 다시 그려진다**(memo 무력화).
   * 정체를 고정하려면 최신 pack 을 ref 로 읽어야 한다.
   */
  const packRef = useRef<ReportPack | null>(null);
  useEffect(() => { packRef.current = pack; }, [pack]);

  const handleEdit = useCallback((cell: CellRef, value: ReportCell) => {
    const current = packRef.current;
    if (!current) return;
    const next = withEditedCell(current, sheetName, cell, value);
    if (next === current) return;
    packRef.current = next;
    setPack(next);
    setDirty(true);
  }, [sheetName]);

  /**
   * 열 너비·행 높이 조절. 값 수정과 **같은 취급**이다 — 엑셀에서도 열을 넓히면 문서가 바뀐 것이고,
   * 저장해야 다른 사람 화면에도 그 폭으로 보인다. 그래서 '저장 안 됨' 표시가 함께 켜진다.
   * handleEdit 과 같은 이유로 pack 을 ref 로 읽어 **함수의 정체를 고정**한다(고정하지 않으면 격자의
   * 행 memo 가 통째로 무력화된다).
   */
  const applyPackChange = useCallback((make: (current: ReportPack) => ReportPack) => {
    const current = packRef.current;
    if (!current) return;
    const next = make(current);
    if (next === current) return;
    packRef.current = next;
    setPack(next);
    setDirty(true);
  }, []);

  const handleResizeColumn = useCallback((col: number, px: number) => {
    applyPackChange((current) => withColumnWidth(current, sheetName, col, px));
  }, [applyPackChange, sheetName]);

  const handleResizeRow = useCallback((row: number, px: number) => {
    applyPackChange((current) => withRowHeight(current, sheetName, row, px));
  }, [applyPackChange, sheetName]);

  const handleSave = async () => {
    if (!pack || !dirty) return;
    setSaving(true);
    say("");
    try {
      const doc = await reencodeReportPack(pack, uploadedBy);
      // 비교-후-쓰기. 내가 읽어 온 판올림 번호와 서버가 다르면 **한 글자도 쓰지 않고** 돌아온다.
      // 예전처럼 "읽어서 시각 비교 → 따로 쓰기" 로 두면 그 사이에 들어온 저장을 덮어쓴다.
      const first = await commitReportPack(pack.month, doc, pack.rev ?? 0);
      let savedRev: number;
      if (first.ok) {
        savedRev = first.rev;
      } else {
        const ok = window.confirm(
          `${conflictText(first.server)}\n\n` +
          `그 내용을 버리고 내 수정으로 덮어쓸까요?\n` +
          `(취소하면 새로고침으로 최신 내용을 받은 뒤 다시 고칠 수 있습니다 — 내 수정은 사라집니다)`
        );
        if (!ok) { say("저장을 취소했습니다. 새로고침으로 최신 내용을 받아주세요.", true); return; }
        // 사용자가 확인한 덮어쓰기도 여전히 비교-후-쓰기다 — 그새 또 바뀌었으면 다시 막힌다.
        const retry = await commitReportPack(pack.month, doc, revOf(first.server));
        if (!retry.ok) {
          say("저장 실패: 저장하는 사이에 또 바뀌었습니다. 새로고침 후 다시 시도해주세요.", true);
          return;
        }
        savedRev = retry.rev;
      }
      setPack((current) => (current ? { ...current, editedAt: doc.editedAt, editedBy: doc.editedBy, rev: savedRev } : current));
      setDirty(false);
      say(`저장 완료: ${monthLabel(pack.month)} · ${Math.round(doc.gzipBase64.length / 1024)}KB`);
    } catch (error) {
      console.error("통합보고서 저장 실패:", error);
      say(
        error instanceof ReportPackError ? `저장 실패: ${error.message}` : "저장 실패: 네트워크 상태를 확인하고 다시 시도해주세요.",
        true
      );
    } finally {
      setSaving(false);
    }
  };

  const sheet = useMemo(() => pack?.sheets.find((s) => s.name === sheetName) || null, [pack, sheetName]);
  const currentEntry = entries.find((e) => e.month === month);
  const stampLabel = pack?.editedAt
    ? `수정 ${new Date(pack.editedAt).toLocaleString("ko-KR")}${pack.editedBy ? ` (${pack.editedBy})` : ""}`
    : pack?.uploadedAt
      ? `업로드 ${new Date(pack.uploadedAt).toLocaleString("ko-KR")}${pack.uploadedBy ? ` (${pack.uploadedBy})` : ""}`
      : "";
  const uploadedAtLabel = pack?.uploadedAt ? new Date(pack.uploadedAt).toLocaleString("ko-KR") : "";
  const monthsDescending = [...entries].map((e) => e.month).reverse(); // 최신월이 맨 위(분석 탭과 같은 규칙)

  return (
    <section className="space-y-4">
      {/* [P0] 이 줄은 **데이터가 없어도 반드시 그린다.** 본문 안에 넣으면 보고서가 하나도 없을 때
          업로드 버튼까지 같이 사라져, 안내만 뜨고 정작 올릴 방법이 없는 막다른 화면이 된다
          (분석 탭에서 실제로 났던 문제 — AdminAnalysisSection.tsx 의 같은 주석 참고). */}
      <div className="flex flex-wrap items-center gap-1.5">
        {entries.length > 0 && (
          <div className="admin-band-filters">
            <select value={month} aria-label="결산월 선택"
              onChange={(e) => { if (confirmLeave()) setMonth(e.target.value); }}>
              {monthsDescending.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
        )}
        {/* 배율 — 엑셀의 확대/축소. 열 너비가 넓게 느껴질 때 여기서 줄인다(2026-08-11 사용자 지적).
            폭만 줄이면 아래쪽 긴 값이 잘리고 글자만 커 보이므로 **글자·폭·행높이를 함께** 줄인다. */}
        <div className="admin-band-filters">
          <select value={zoom} aria-label="화면 배율"
            onChange={(e) => {
              const next = Number(e.target.value);
              setZoom(next);
              try { window.localStorage.setItem(ZOOM_STORAGE_KEY, String(next)); } catch { /* 저장 못 해도 화면은 그대로 동작한다 */ }
            }}>
            {ZOOM_OPTIONS.map((z) => <option key={z} value={z}>{`배율 ${Math.round(z * 100)}%`}</option>)}
          </select>
        </div>
        <ReportTopControls
          onUpload={(f) => void handleUpload(f)} uploading={uploading}
          onSave={() => void handleSave()} saving={saving} dirty={dirty}
          // 새로고침은 목록과 **보고 있는 달의 내용**을 함께 다시 읽는다 — 목록만 다시 읽으면
          // 고른 달이 그대로라 화면의 표는 옛 내용 그대로 남는다.
          onRefresh={() => { if (!confirmLeave()) return; setReloadToken((n) => n + 1); void loadIndex(); }}
          loading={loading} uploadedAtLabel={uploadedAtLabel}
        />
      </div>

      {message && <p className={`text-[11px] font-black ${messageBad ? "admin-rate-hot" : "text-gray-500"}`}>{message}</p>}
      {!supportsGzip() && (
        <p className="text-[11px] font-black admin-rate-hot">
          이 브라우저는 압축 기능(CompressionStream)을 지원하지 않아 통합보고서를 열 수 없습니다. Chrome 또는 Edge 최신 버전을 써주세요.
        </p>
      )}
      {loadError && <p className="text-[11px] font-black admin-rate-hot">{loadError}</p>}
      {!loading && !loadError && entries.length === 0 && (
        <p className="text-[11px] font-black admin-rate-hot">
          저장된 통합보고서가 없습니다. 위의 '파일 업로드'로 03 에이전트의 <b>{"{YYMM}_손익계산서_통합.xlsx"}</b> 를 올려주세요.
        </p>
      )}
      {loading && <div className="py-16 text-center"><LoadingSpinner size="md" /></div>}

      {!loading && pack && sheet && (
        <section className="admin-sales-overview-section admin-sheet-card overflow-hidden">
          <div className="admin-band">
            <h3 className="admin-band-title">통합보고서</h3>
            <p className="admin-band-meta">
              {monthLabel(month)} · {sheetName} · {sheet.rows.length}행
              {currentEntry?.fileName ? ` · ${currentEntry.fileName}` : ""}
              {stampLabel ? ` · ${stampLabel}` : ""}
              {dirty ? " · 저장 안 됨" : ""}
            </p>
          </div>

          {/* 시트 탭 — 엑셀의 시트 탭을 **표 머리글 위**에 일렬로 세운다(사용자 지시 2026-08-11).
              17개라 줄바꿈하지 않고 가로로 스크롤한다 — 줄이 접히면 표가 그만큼 아래로 밀린다. */}
          <div className="report-sheet-tabs" role="tablist" aria-label="시트 선택">
            {pack.sheetNames.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={name === sheetName}
                className={name === sheetName ? "is-active" : undefined}
                // [묻지 않는다] 시트는 **같은 파일 안**이라 여기서 옮겨도 고친 내용이 사라지지 않는다 —
                // 엑셀처럼 여러 시트를 고친 뒤 한 번에 저장한다. 예전에는 "버리고 이동할까요?"를
                // 물었는데, 정작 버리는 동작이 없어 **확인을 눌러도 수정이 그대로 남아 나중에 저장됐다**
                // (Codex 정지게이트 2026-08-11). 말과 동작이 어긋난 확인창은 없느니만 못하다.
                // 진짜로 버려지는 자리(월 변경·새로고침·업로드)에서만 confirmLeave 로 되묻는다.
                onClick={() => setSheetName(name)}
              >
                {name}
              </button>
            ))}
          </div>

          <ReportGrid
            sheet={sheet} styles={pack.styles} numFmts={pack.numFmts} ssf={ssf} zoom={zoom}
            onEdit={handleEdit} onResizeColumn={handleResizeColumn} onResizeRow={handleResizeRow}
          />

          <div className="px-4 py-3 border-t border-gray-100 space-y-1">
            <p className="text-[11px] font-bold text-gray-400">
              칸을 눌러 고칠 수 있습니다 · 방향키·Tab·Enter로 칸 이동 · 글자를 치거나 Enter·F2로 편집 시작 · Esc로 취소 · <b>시트를 옮겨도 고친 내용은 그대로 남아 저장할 때 함께 반영</b>됩니다 · 고친 뒤 <b>저장</b>을 눌러야 서버에 반영됩니다
            </p>
            <p className="text-[11px] font-bold text-gray-400">
              주민등록번호·입금계좌는 <b>저장 단계에서 가려져</b> 원본이 서버에 남지 않습니다 · 원본이 필요하면 03 에이전트 폴더의 엑셀 파일을 열어주세요
            </p>
            {/* 엑셀 수식은 값으로만 들어온다 — 합계가 자동으로 안 바뀐다는 사실을 숨기면 잘못된 보고서가 된다. */}
            <p className="text-[11px] font-bold admin-rate-hot">
              주의: 엑셀 수식은 계산된 값으로만 들어옵니다. 어떤 칸을 고쳐도 <b>총매출·총지출·이익금 같은 합계는 따라 바뀌지 않습니다</b> — 합계 칸도 직접 고쳐주세요.
            </p>
          </div>
        </section>
      )}
    </section>
  );
}
