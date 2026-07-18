// src/pages/branch/tabs/LaborContractTab.tsx
// 근로계약서 탭. 지점이 발송 대상 인적사항을 등록하면 관리자 화면에 뜬다.
// 급여는 등록할 때만 입력받는다 — 등록 후에는 지점 화면에 표시하지도, 수정하지도 않는다.
import { useState, useEffect, useCallback } from "react";
import { Download } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
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

  const [name, setName] = useState("");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [salary, setSalary] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhoneDigits, setEditPhoneDigits] = useState("");

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

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [list, meta] = await Promise.all([
        readContracts(),
        gasClient.getLaborContractTemplateMeta().catch(() => null)
      ]);
      setContracts(list);
      setTemplateMeta(meta);
      setLoadedBranch(branchName);
    } catch (err) {
      console.error("근로계약서 내역을 불러오지 못했습니다.", err);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [branchName, readContracts]);

  useEffect(() => { void loadData(); }, [loadData]);

  // 관리자가 발송 상태를 바꿨을 수 있으므로 화면으로 돌아올 때 다시 읽는다.
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadData();
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
    // 이게 실패하면 throw되어 호출부가 사용자에게 알린다. "_" 사본 쓰기가 실패해도
    // 기준값은 이미 갱신됐으므로 관리자·지점이 같은 값을 본다.
    await gasClient.saveSharedData(`labor_contracts:${branchName}`, next);
    await gasClient.saveSharedData(`labor_contracts_${branchName}`, next);
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
    if (!name.trim() || digits.length !== 8 || !salary.trim()) {
      window.alert("이름, 연락처 8자리, 급여를 모두 입력해 주세요.");
      return;
    }
    const numericSalary = parseSalaryInput(salary);
    if (!numericSalary) {
      window.alert("급여를 올바르게 입력해 주세요.");
      return;
    }
    setSaving(true);
    try {
      const latest = await readContracts();
      await writeContracts([
        {
          id: `contract-${Date.now()}`,
          name: name.trim(),
          phone: formatPhone(digits),
          salary: numericSalary,
          status: "발송 대기",
          createdAt: new Date().toISOString()
        },
        ...latest
      ]);
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-black text-gray-900 w-fit">근로계약서 발송 인적사항 등록</h3>
            <p className="text-[11px] text-gray-400 mt-1">급여가 잘못된 경우에는 기존 내역 삭제요청 후 새로 등록해 주세요.</p>
          </div>
          <button
            onClick={() => void downloadTemplate()}
            disabled={!templateMeta || downloading}
            title={templateMeta ? templateMeta.fileName : "본사에서 양식 등록 전입니다."}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-[11px] font-black text-slate-600 hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" />
            {downloading ? "받는 중…" : "파트타이머 근로계약서 양식"}
          </button>
        </div>

        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" className="h-8 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 text-[11px] font-bold" />
          <div className="flex h-8 items-center overflow-hidden rounded-lg border border-gray-200 bg-white sm:w-44">
            <span className="flex h-full items-center bg-gray-50 px-2.5 text-[11px] font-extrabold text-gray-400 border-r border-gray-200">010</span>
            <input value={phoneDigits} onChange={(e) => setPhoneDigits(onlyDigits(e.target.value, 8))} placeholder="12345678" className="h-full w-full px-2.5 text-[11px] font-bold outline-none" />
          </div>
          <input value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="급여 예: 250만" className="h-8 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 text-[11px] font-bold" />
          <button
            onClick={() => void saveContract()}
            disabled={busy}
            title={!isLoaded ? "등록 내역을 불러오는 중입니다." : undefined}
            className="flex h-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 px-5 text-[11px] font-black text-white hover:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "처리 중…" : "등록"}
          </button>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[11px]">
            <thead>
              <tr className="bg-gray-50/70 text-left border-b border-gray-100 text-slate-400 font-black">
                <th className="px-3 py-2.5 w-24">등록일</th>
                <th className="px-3 py-2.5 w-28">이름</th>
                <th className="px-3 py-2.5 w-36">연락처</th>
                <th className="px-3 py-2.5 w-24">발송 상태</th>
                <th className="px-3 py-2.5">안내</th>
                <th className="px-3 py-2.5 text-center w-36">요청</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="p-6 text-center"><LoadingSpinner size="sm" /></td></tr>
              ) : contracts.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-slate-300 font-bold">등록된 인적사항이 없습니다.</td></tr>
              ) : contracts.map((c) => (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-slate-50/50">
                  <td className="px-3 py-2.5 font-mono text-slate-400">{c.createdAt ? c.createdAt.slice(0, 10) : "-"}</td>
                  <td className="px-3 py-2.5 font-black text-slate-800">
                    {editingId === c.id
                      ? <input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-7 w-full rounded-lg border border-gray-200 px-2 text-[11px]" />
                      : c.name}
                  </td>
                  <td className="px-3 py-2.5 font-mono font-black text-slate-600">
                    {editingId === c.id ? (
                      <div className="flex items-center">
                        <span className="text-slate-400 mr-1">010</span>
                        <input value={editPhoneDigits} onChange={(e) => setEditPhoneDigits(onlyDigits(e.target.value, 8))} className="h-7 w-24 rounded-lg border border-gray-200 px-2 text-[11px]" />
                      </div>
                    ) : c.phone}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 font-black ${statusChipClass(normalizeStatus(c.status))}`}>
                      {normalizeStatus(c.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400">
                    {c.deleteRequested
                      ? <span className="font-black text-rose-500">삭제요청됨</span>
                      : "급여 변경은 삭제요청 후 새로 등록"}
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
