// src/pages/branch/tabs/LaborContractTab.tsx
// 근로계약서 탭. 지점이 발송 대상 인적사항을 등록하면 관리자 화면에 뜬다.
// 급여는 등록할 때만 입력받는다 — 등록 후에는 지점 화면에 표시하지도, 수정하지도 않는다.
import { useState, useEffect, useCallback, type ChangeEvent } from "react";
import { Download } from "lucide-react";
import { gasClient, LABOR_CONTRACT_PERIOD_LABEL, laborContractPeriodText } from "../../../api/gasClient";
import type { LaborContract, LaborContractTemplateMeta } from "../../../api/gasClient";
import LoadingSpinner from "../../../components/LoadingSpinner";

const CONTRACT_STATUSES = ["발송 대기", "발송 완료", "서명 완료", "보류"] as const;

const statusChipClass = (status: string) => {
  if (status === "발송 완료") return "bg-blue-50 text-blue-700";
  if (status === "서명 완료") return "bg-emerald-50 text-emerald-700";
  if (status === "보류") return "bg-slate-100 text-slate-600";
  return "bg-amber-50 text-amber-700";
};

const normalizeStatus = (status: unknown) => {
  const value = String(status || "");
  return (CONTRACT_STATUSES as readonly string[]).includes(value) ? value : "발송 대기";
};

const formatPhone = (digits: string) => `010-${digits.slice(0, 4)}-${digits.slice(4)}`;

const onlyDigits = (value: string, max: number) => value.replace(/[^0-9]/g, "").slice(0, max);

const phoneTail = (phone: unknown) =>
  String(phone || "").replace(/^010-?/, "").replace(/[^0-9]/g, "").slice(0, 8);

// "250만" / "250" / "2500000" 을 모두 2,500,000으로 해석한다. 기존 동작 그대로.
const parseSalaryInput = (rawVal: string): number => {
  const raw = rawVal.trim();
  if (!raw) return 0;
  if (raw.includes("만")) return Math.round((parseFloat(raw.replace(/[^0-9.]/g, "")) || 0) * 10000);
  const numeric = raw.replace(/[,원\s]/g, "");
  let parsed = parseFloat(numeric) || 0;
  if (parsed > 0 && parsed < 1000) parsed *= 10000;
  else if (parsed >= 1000 && parsed < 10000) parsed *= 1000;
  return Math.round(parsed);
};

// 급여 입력을 칠 때 순수 숫자면 3자리마다 쉼표를 넣는다.
// "250만"처럼 숫자가 아닌 표기가 섞이면 그대로 둔다(parseSalaryInput이 만/쉼표 모두 처리).
const formatSalaryTyping = (raw: string) => {
  const stripped = raw.replace(/,/g, "");
  return /^\d+$/.test(stripped) ? Number(stripped).toLocaleString("ko-KR") : raw;
};

const base64ToBlob = (dataBase64: string, mimeType: string) => {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
};

export function LaborContractTab({ branchName }: { branchName: string; isAdmin?: boolean }) {
  const [contracts, setContracts] = useState<LaborContract[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // loadedBranch = 지금 화면에 든 데이터가 어느 지점 것인가. isLoaded = 그게 현재 지점과 일치하는가.
  // 로드에 실패한 채로 저장하면 기존 내역이 빈 배열로 덮인다. 받아오기 전엔 저장을 잠근다.
  // (AnnualLeaveTab과 같은 패턴 — 지점 전환 시 렌더 중 동기적으로 무효화해 stale 저장 창을 없앤다.)
  const [loadedBranch, setLoadedBranch] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [trackedBranch, setTrackedBranch] = useState(branchName);
  if (trackedBranch !== branchName) {
    setTrackedBranch(branchName);
    setLoadedBranch(null);
    setLoadFailed(false);
  }
  const isLoaded = loadedBranch === branchName;

  const [contractType, setContractType] = useState<"" | "신규입사" | "지점이동">("");
  // 계약유형(필수, 2026-07-29): 신입은 1~2주 단위 계약서를 따로 보내야 해서 여기서 구분을 받는다.
  // 계약유형 — 1주·2주 고정 선택지를 없애고 기간을 직접 고르는 "기간작성"으로 바꿨다(2026-07-31).
  const [periodType, setPeriodType] = useState<"" | "기간작성" | "정규">("");
  const [effectiveDate, setEffectiveDate] = useState("");
  /** 기간작성일 때의 종료일. 시작일은 effectiveDate(입사·이동일)를 그대로 쓴다. */
  const [periodEndDate, setPeriodEndDate] = useState("");
  const [previousBranch, setPreviousBranch] = useState("");
  const [name, setName] = useState("");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [salary, setSalary] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhoneDigits, setEditPhoneDigits] = useState("");

  // 지점이동 시 "어느 지점에서 왔는지" 드롭다운에 채울 전 지점 목록(현재 지점 제외).
  const [branchOptions, setBranchOptions] = useState<string[]>([]);

  const [templateMeta, setTemplateMeta] = useState<LaborContractTemplateMeta | null>(null);
  const [downloading, setDownloading] = useState(false);

  // 같은 내역이 "labor_contracts:<지점>"과 "labor_contracts_<지점>" 두 키에 저장돼 있는데,
  // 관리자 화면은 ":" 키만 읽는다(firebaseGetAllLaborContracts). 지점이 "_" 키를 진실로 삼으면
  // 관리자가 바꾼 발송 상태를 지점은 보지도 못한 채 옛 값으로 덮어쓴다.
  // 그래서 ":" 키를 유일한 기준으로 삼고, "_" 키는 옛 클라이언트를 위한 사본으로만 둔다.
  const readContracts = useCallback(async (): Promise<LaborContract[]> => {
    const canonical = await gasClient.getSharedData<LaborContract[]>(`labor_contracts:${branchName}`);
    // 빈 배열([])도 유효한 값이다 — 관리자가 전부 지운 상태를 "_" 키로 되살리면 안 된다.
    // 문서 자체가 없을 때(null)만 옛 키를 본다.
    if (canonical) return canonical;
    const legacy = await gasClient.getSharedData<LaborContract[]>(`labor_contracts_${branchName}`);
    return legacy || [];
  }, [branchName]);

  // silent=true면 스피너(loading)를 켜지 않고 조용히 데이터만 갱신한다.
  // 화면 복귀(focus/visibilitychange) 때 발송 상태를 최신화하되 표가 깜빡이지 않게 하기 위함.
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [list, meta, branchList] = await Promise.all([
        readContracts(),
        gasClient.getLaborContractTemplateMeta().catch(() => null),
        gasClient.getBranchList().catch(() => [])
      ]);
      setContracts(list);
      setTemplateMeta(meta);
      // 지점이동 이전지점 후보: role이 지점인 곳 중 현재 지점을 뺀 이름 목록.
      setBranchOptions(
        (branchList || [])
          .filter((b) => b?.role === "branch" && b.branchName && b.branchName !== branchName)
          .map((b) => b.branchName)
      );
      setLoadedBranch(branchName);
      // 성공하면 실패 배너를 항상 해제한다 — 조용한 갱신으로 복구돼도 배너가 남지 않게.
      setLoadFailed(false);
    } catch (err) {
      console.error("근로계약서 내역을 불러오지 못했습니다.", err);
      // 조용한 갱신 실패는 화면을 잠그지 않는다 — 이미 불러온 데이터를 그대로 유지한다.
      if (!silent) setLoadFailed(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [branchName, readContracts]);

  useEffect(() => { void loadData(); }, [loadData]);

  // 관리자가 발송 상태를 바꿨을 수 있으므로 화면으로 돌아올 때 다시 읽는다.
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadData(true);
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadData]);

  const writeContracts = async (next: LaborContract[]) => {
    // ":" 키가 기준이다(관리자 조회도 이 키만 읽는다) → 먼저 쓴다.
    // 이게 실패하면 throw되어 호출부가 사용자에게 알린다.
    await gasClient.saveSharedData(`labor_contracts:${branchName}`, next);
    // "_" 사본 쓰기가 실패해도 기준값은 이미 갱신됐으므로 등록/수정 자체는 성공으로 본다.
    // 여기서 throw하면 기준엔 저장됐는데 화면만 "실패"로 남아, 재시도 시 같은 인원이 중복 등록된다.
    try {
      await gasClient.saveSharedData(`labor_contracts_${branchName}`, next);
    } catch (copyErr) {
      console.warn("근로계약서 사본(_) 저장 실패 — 기준(:) 저장은 성공했습니다.", copyErr);
    }
    setContracts(next);
  };

  // 화면 메모리를 통째로 덮어쓰면, 그 사이 관리자가 바꾼 발송 상태가 되돌아간다.
  // 저장 직전에 서버 최신본을 다시 읽고, 내가 건드린 레코드에만 변경분을 얹는다.
  const mutateContract = async (id: string, change: Partial<LaborContract>) => {
    setSaving(true);
    try {
      const latest = await readContracts();
      if (!latest.some((item) => item.id === id)) {
        window.alert("이미 관리자가 삭제한 내역입니다. 목록을 새로 불러옵니다.");
        await loadData();
        return false;
      }
      await writeContracts(latest.map((item) => (item.id === id ? { ...item, ...change } : item)));
      return true;
    } catch (err) {
      console.error("근로계약서 저장 실패", err);
      window.alert("저장에 실패했습니다. 인터넷 연결과 로그인 상태를 확인한 뒤 다시 시도해 주세요.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveContract = async () => {
    if (!isLoaded) {
      window.alert("등록 내역을 아직 불러오지 못했습니다. 다시 시도한 뒤 등록해 주세요.");
      return;
    }
    const digits = onlyDigits(phoneDigits, 8);
    if (!contractType) {
      window.alert("신규입사인지 지점이동인지 먼저 선택해 주세요.");
      return;
    }
    if (!periodType) {
      window.alert("계약유형(기간작성(수습) / 정규)을 선택해 주세요.");
      return;
    }
    if (!effectiveDate) {
      window.alert(`${contractType === "지점이동" ? "지점이동일" : "입사일"}을 선택해 주세요.`);
      return;
    }
    // 기간작성은 종료일이 있어야 계약서를 만들 수 있다 — 없이 넘기면 관리자가 기간을 알 수 없다.
    if (periodType === "기간작성") {
      if (!periodEndDate) {
        window.alert("계약 종료일을 선택해 주세요.");
        return;
      }
      if (periodEndDate < effectiveDate) {
        window.alert("계약 종료일이 시작일보다 앞설 수 없습니다.");
        return;
      }
    }
    if (!name.trim() || digits.length !== 8 || !salary.trim()) {
      window.alert("이름, 연락처 8자리, 급여를 모두 입력해 주세요.");
      return;
    }
    if (contractType === "지점이동" && !previousBranch) {
      window.alert("지점이동인 경우 이전 지점을 선택해 주세요.");
      return;
    }
    const numericSalary = parseSalaryInput(salary);
    if (!numericSalary) {
      window.alert("급여를 올바르게 입력해 주세요.");
      return;
    }
    setSaving(true);
    try {
      // [동시 등록 유실 방지] 배열을 읽어 통째로 저장하면 두 기기가 거의 동시에 등록할 때 나중 저장이
      // 먼저 등록을 덮어쓴다(Codex 지적 2026-07-29) — 원자적 append(Firestore 트랜잭션)로 이어붙인다.
      // 기준(:) 문서가 아직 없고 옛(_) 키에만 내역이 있으면 append 가 옛 내역을 모른 채 새 문서를
      // 만들므로, 먼저 옛 내역으로 기준 문서를 만들어 둔다(create-only 라 다른 기기 값을 덮지 않는다).
      const canonicalKey = `labor_contracts:${branchName}`;
      const canonical = await gasClient.getSharedData<LaborContract[]>(canonicalKey);
      if (!canonical) {
        const legacy = await gasClient.getSharedData<LaborContract[]>(`labor_contracts_${branchName}`);
        if (legacy && legacy.length) await gasClient.createSharedDataIfMissing(canonicalKey, legacy);
      }
      const record: LaborContract = {
        id: `contract-${Date.now()}`,
        name: name.trim(),
        phone: formatPhone(digits),
        salary: numericSalary,
        contractType,
        periodType,
        effectiveDate,
        // 기간작성일 때만 종료일을 싣는다. 값이 없으면 아예 넣지 않는다 —
        // 빈 문자열을 저장하면 "종료일이 있는데 비어 있다"로 읽힌다.
        ...(periodType === "기간작성" && periodEndDate ? { periodEndDate } : {}),
        ...(contractType === "지점이동" ? { previousBranch } : {}),
        status: "발송 대기",
        createdAt: new Date().toISOString()
      };
      const { list } = await gasClient.appendSharedArrayItem(canonicalKey, record as unknown as Record<string, unknown>);
      // "_" 사본은 최선노력 — 실패해도 기준(:)은 이미 갱신됐다(writeContracts 와 같은 규약).
      try {
        await gasClient.saveSharedData(`labor_contracts_${branchName}`, list);
      } catch (copyErr) {
        console.warn("근로계약서 사본(_) 저장 실패 — 기준(:) 저장은 성공했습니다.", copyErr);
      }
      setContracts(list as LaborContract[]);
      setContractType("");
      setPeriodType("");
      setEffectiveDate("");
      setPeriodEndDate("");
      setPreviousBranch("");
      setName("");
      setPhoneDigits("");
      setSalary("");
    } catch (err) {
      console.error("근로계약서 등록 실패", err);
      window.alert("등록에 실패했습니다. 인터넷 연결과 로그인 상태를 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (contract: LaborContract) => {
    setEditingId(contract.id);
    setEditName(contract.name || "");
    setEditPhoneDigits(phoneTail(contract.phone));
  };

  // 이름·연락처만 바꾼다. 급여는 건드리지 않는다 —
  // mutateContract가 서버 레코드에 변경분만 얹으므로 기존 급여가 그대로 보존된다.
  const saveEdit = async (id: string) => {
    const digits = onlyDigits(editPhoneDigits, 8);
    if (!editName.trim() || digits.length !== 8) {
      window.alert("이름과 연락처 8자리를 확인해 주세요.");
      return;
    }
    const ok = await mutateContract(id, {
      name: editName.trim(),
      phone: formatPhone(digits),
      editRequestedAt: new Date().toISOString()
    });
    if (ok) setEditingId(null);
  };

  const requestDelete = async (id: string) => {
    if (!window.confirm("삭제요청을 관리자에게 전달할까요? 급여가 다른 경우에는 삭제요청 후 새로 등록해 주세요.")) return;
    await mutateContract(id, { deleteRequested: true, deleteRequestedAt: new Date().toISOString() });
  };

  const downloadTemplate = async () => {
    if (!templateMeta) return;
    setDownloading(true);
    try {
      const dataBase64 = await gasClient.getLaborContractTemplateFile(templateMeta.fileId);
      if (!dataBase64) {
        window.alert("양식 파일을 찾을 수 없습니다. 본사에 문의해 주세요.");
        return;
      }
      const blob = base64ToBlob(dataBase64, templateMeta.mimeType);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = templateMeta.fileName || "파트타이머_근로계약서";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("양식 다운로드 실패", err);
      window.alert("양식을 내려받지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setDownloading(false);
    }
  };

  // 급여 입력: 콤마 자동. 매 입력마다 재포맷하면 캐럿이 끝으로 튀어 중간 수정이 깨진다.
  // 입력 시점의 "캐럿 앞 숫자 개수"를 기억했다가, 포맷 후 같은 자릿수 위치로 캐럿을 되돌린다.
  const handleSalaryChange = (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.target;
    const raw = el.value;
    const caret = el.selectionStart ?? raw.length;
    const digitsBefore = raw.slice(0, caret).replace(/[^0-9]/g, "").length;
    const formatted = formatSalaryTyping(raw);
    setSalary(formatted);
    if (formatted !== raw) {
      requestAnimationFrame(() => {
        let pos = 0;
        let seen = 0;
        while (pos < formatted.length && seen < digitsBefore) {
          const code = formatted.charCodeAt(pos);
          if (code >= 48 && code <= 57) seen += 1;
          pos += 1;
        }
        try { el.setSelectionRange(pos, pos); } catch { /* 일부 환경 미지원 */ }
      });
    }
  };

  const busy = saving || !isLoaded;

  return (
    <div className="space-y-3 animate-fade-in" id="labor-contract-tab">
      {loadFailed && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-bold rounded-xl px-3 py-2 flex items-center justify-between gap-3">
          <span>등록 내역을 불러오지 못했습니다. 등록·수정이 잠겼습니다(기존 내역 덮어쓰기 방지).</span>
          <button onClick={() => void loadData()} className="shrink-0 rounded-lg bg-rose-600 text-white px-3 py-1 text-[11px] font-black">다시 시도</button>
        </div>
      )}

      <section className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3">
        <div>
          <h3 className="text-sm font-black text-gray-900 w-fit">근로계약서 발송 인적사항 등록</h3>
          <p className="text-[11px] text-gray-400 mt-1">신규입사·지점이동 구분과 날짜를 고른 뒤 인적사항을 등록해 주세요. 급여가 잘못된 경우에는 기존 내역 삭제요청 후 새로 등록해 주세요.</p>
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-stretch">
          {/* 왼쪽: 파트타이머 근로계약서 양식 다운로드 — 허니듀.
              bg-emerald-* 클래스를 버튼에 쓰면 .branch-redesign button[class*="bg-emerald-"] 규칙이
              검정으로 강제한다(액션버튼 통일 규칙). 그래서 클래스 대신 인라인 색으로 칠한다. */}
          <button
            onClick={() => void downloadTemplate()}
            disabled={!templateMeta || downloading}
            title={templateMeta ? templateMeta.fileName : "본사에서 양식 등록 전입니다."}
            style={{ backgroundColor: "var(--branch-honey)" }}
            className="flex shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-[#a9c2a0] px-3 py-2.5 text-slate-800 shadow-sm transition hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed sm:w-28"
          >
            <Download className="h-5 w-5" />
            <span className="text-center text-[11px] font-black leading-tight">
              {downloading ? "받는 중…" : <>파트타이머<br />근로계약서 양식</>}
            </span>
          </button>

          {/* 오른쪽: 구분 → 날짜 → 이름 → 연락처 → 급여 → (이전지점) → 등록을 한 줄로. V2 톤 */}
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            <select
              value={contractType}
              onChange={(e) => {
                const v = e.target.value as "" | "신규입사" | "지점이동";
                setContractType(v);
                if (v !== "지점이동") setPreviousBranch("");
              }}
              aria-label="신규입사/지점이동 구분"
              className="h-8 w-[92px] rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-bold text-slate-700"
            >
              <option value="">선택</option>
              <option value="신규입사">신규입사</option>
              <option value="지점이동">지점이동</option>
            </select>
            {/* 계약유형(필수) — 1주/2주 단위 계약서인지, 수습 후 계속 근무 정규 계약서인지 구분 */}
            <select
              value={periodType}
              onChange={(e) => {
                const next = e.target.value as "" | "기간작성" | "정규";
                setPeriodType(next);
                // 기간작성이 아니면 종료일은 뜻이 없다 — 남겨 두면 저장까지 딸려 간다.
                if (next !== "기간작성") setPeriodEndDate("");
              }}
              aria-label="계약유형"
              title="기간을 정해 쓰는 계약서인지, 수습 후 계속 근무할 정규 계약서인지 선택"
              className="h-8 w-[150px] rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-bold text-slate-700"
            >
              <option value="">계약유형 선택</option>
              <option value="기간작성">{LABOR_CONTRACT_PERIOD_LABEL["기간작성"]}</option>
              <option value="정규">{LABOR_CONTRACT_PERIOD_LABEL["정규"]}</option>
            </select>
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              aria-label={contractType === "지점이동" ? "지점이동일" : "입사일"}
              title={contractType === "지점이동" ? "지점이동일" : "입사일"}
              className="h-8 w-[146px] rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-bold text-slate-700"
            />
            {/* 계약 종료일 — 기간작성일 때만 나온다. 시작일은 왼쪽 입사·이동일을 그대로 쓴다.
                min 을 시작일로 묶어 끝이 시작보다 앞서는 날짜를 애초에 못 고르게 한다. */}
            {periodType === "기간작성" && (
              <span className="flex items-center gap-1">
                <span className="text-[11px] font-black text-slate-400">~</span>
                <input
                  type="date"
                  value={periodEndDate}
                  min={effectiveDate || undefined}
                  onChange={(e) => setPeriodEndDate(e.target.value)}
                  aria-label="계약 종료일"
                  title="계약 종료일 (시작일은 왼쪽 입사·이동일)"
                  className="h-8 w-[146px] rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-bold text-slate-700"
                />
              </span>
            )}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" className="h-8 w-[80px] rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-bold" />
            <div className="flex h-8 w-[160px] items-center overflow-hidden rounded-lg border border-gray-200 bg-white">
              <span className="flex h-full items-center bg-gray-50 px-2 text-[11px] font-extrabold text-gray-400 border-r border-gray-200">010</span>
              <input value={phoneDigits} onChange={(e) => setPhoneDigits(onlyDigits(e.target.value, 8))} placeholder="12345678" className="h-full w-full min-w-0 px-2 text-[11px] font-bold outline-none" />
            </div>
            <input value={salary} onChange={handleSalaryChange} placeholder="급여" title="급여 예: 250만 또는 2500000" className="h-8 w-[104px] rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-bold" />
            {contractType === "지점이동" && (
              <select
                value={previousBranch}
                onChange={(e) => setPreviousBranch(e.target.value)}
                aria-label="이전 지점"
                className="h-8 w-[140px] rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-bold text-slate-700"
              >
                <option value="">이전 지점</option>
                {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
            <button
              onClick={() => void saveContract()}
              disabled={busy}
              title={!isLoaded ? "등록 내역을 불러오는 중입니다." : undefined}
              className="flex h-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 px-5 text-[11px] font-black text-white hover:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? "처리 중…" : "등록"}
            </button>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[720px] text-[11px]">
            <thead>
              <tr className="bg-gray-50/70 text-left border-b border-gray-100 text-slate-400 font-black whitespace-nowrap">
                <th className="px-3 py-2.5 w-24">등록일</th>
                <th className="px-3 py-2.5 w-40 whitespace-nowrap">구분</th>
                <th className="px-3 py-2.5 w-28 whitespace-nowrap">계약유형</th>
                <th className="px-3 py-2.5 w-24">이름</th>
                <th className="px-3 py-2.5 w-32">연락처</th>
                <th className="px-3 py-2.5 w-24">입사·이동일</th>
                <th className="px-3 py-2.5 w-20">발송 상태</th>
                <th className="px-3 py-2.5 w-28">안내</th>
                <th className="px-3 py-2.5 text-center w-28">요청</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="p-6 text-center"><LoadingSpinner size="sm" /></td></tr>
              ) : contracts.length === 0 ? (
                <tr><td colSpan={9} className="p-6 text-center text-slate-300 font-bold">등록된 인적사항이 없습니다.</td></tr>
              ) : contracts.map((c) => (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-slate-50/50">
                  <td className="px-3 py-2.5 font-mono text-slate-400 whitespace-nowrap">{c.createdAt ? c.createdAt.slice(0, 10) : "-"}</td>
                  <td className="px-3 py-2.5">
                    {c.contractType === "지점이동" ? (
                      <span className="inline-flex items-start gap-1">
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 font-black text-emerald-800 whitespace-nowrap">지점이동</span>
                        {c.previousBranch && (
                          <span className="inline-flex items-start gap-0.5 text-slate-400">
                            <span className="shrink-0">←</span>
                            {/* 이전 지점명이 7자를 넘으면 폭을 넘어 줄바꿈되도록 max-w + break-all */}
                            <span className="max-w-[5rem] break-all">{c.previousBranch}</span>
                          </span>
                        )}
                      </span>
                    ) : c.contractType === "신규입사" ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 font-black text-amber-800 whitespace-nowrap">신규입사</span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {/* 계약유형은 등록 시 확정 — 잘못 골랐으면 삭제요청 후 재등록(급여와 같은 규칙). 옛 레코드는 "-" */}
                    {c.periodType && LABOR_CONTRACT_PERIOD_LABEL[c.periodType]
                      ? <span className="rounded-full bg-slate-100 px-2 py-0.5 font-black text-slate-600">{LABOR_CONTRACT_PERIOD_LABEL[c.periodType]}</span>
                      : <span className="text-slate-300">-</span>}
                  </td>
                  <td className="px-3 py-2.5 font-black text-slate-800 whitespace-nowrap">
                    {editingId === c.id
                      ? <input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-7 w-full rounded-lg border border-gray-200 px-2 text-[11px]" />
                      : c.name}
                  </td>
                  <td className="px-3 py-2.5 font-mono font-black text-slate-600 whitespace-nowrap">
                    {editingId === c.id ? (
                      <div className="flex items-center">
                        <span className="text-slate-400 mr-1">010</span>
                        <input value={editPhoneDigits} onChange={(e) => setEditPhoneDigits(onlyDigits(e.target.value, 8))} className="h-7 w-24 rounded-lg border border-gray-200 px-2 text-[11px]" />
                      </div>
                    ) : c.phone}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-500 whitespace-nowrap">{laborContractPeriodText(c.effectiveDate, c.periodType, c.periodEndDate)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={`rounded-full px-2 py-0.5 font-black ${statusChipClass(normalizeStatus(c.status))}`}>
                      {normalizeStatus(c.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-[10px] text-slate-400">
                    {c.deleteRequested
                      ? <span className="font-black text-rose-500">삭제요청됨</span>
                      : "급여 변경 시 삭제 후 재등록"}
                  </td>
                  <td className="px-3 py-2.5 text-center space-x-1.5 whitespace-nowrap">
                    {editingId === c.id ? (
                      <button onClick={() => void saveEdit(c.id)} disabled={busy} className="h-7 rounded-lg bg-slate-800 px-2.5 font-black text-white disabled:opacity-40">저장</button>
                    ) : (
                      <button onClick={() => startEdit(c)} disabled={busy} className="h-7 rounded-lg bg-slate-100 px-2.5 font-black text-slate-600 disabled:opacity-40">수정</button>
                    )}
                    <button onClick={() => void requestDelete(c.id)} disabled={busy} className="h-7 rounded-lg bg-rose-50 px-2.5 font-black text-rose-500 disabled:opacity-40">삭제요청</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
