// src/pages/branch/tabs/BranchDashboardTab.tsx
// 지점 대시보드 탭(공지·미결 확인사항). BranchConfirmPage에서 분리 — 동작 변경 없음(코드 이동만).
import { useState, useCallback, useEffect } from "react";
import { Info, AlertCircle } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import LoadingSpinner from "../../../components/LoadingSpinner";
import { residentBirthKey, toPhoneTail8 } from "../helpers/formatters";
import { parseStaffAddReason, parseSalaryChangeStatus } from "../helpers/staffHelpers";

export function BranchDashboardTab({ branchName }: { branchName: string }) {
  const [loading, setLoading] = useState(true);
  const [notices, setNotices] = useState<any[]>([]);
  const [issues, setIssues] = useState<Array<{ type: string; message: string; level: "warn" | "danger" | "info"; names?: string[] }>>([]);
  const [expandedIssueIndexes, setExpandedIssueIndexes] = useState<Record<number, boolean>>({});
  const [noticeChecks, setNoticeChecks] = useState<Record<string, { name: string; checkedAt: string }>>({});
  const [noticeCheckNames, setNoticeCheckNames] = useState<Record<string, string>>({});
  const [pendingNoticeCheckId, setPendingNoticeCheckId] = useState<string | null>(null);
  const noticeCheckKey = `branch_notice_checks:${branchName}`;

  const getDateStr = (offsetDays = 0) => {
    const local = new Date();
    local.setDate(local.getDate() + offsetDays);
    return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [savedNotices, roster, today, savedNoticeChecks] = await Promise.all([
        gasClient.getSharedData<any[]>("admin_notices").catch(() => []),
        gasClient.getBranchOwnRoster(branchName).catch(() => []),
        gasClient.getDailyFormBootstrap(branchName, getDateStr(-1)).catch(() => null),
        gasClient.getSharedData<Record<string, { name: string; checkedAt: string }>>(noticeCheckKey).catch(() => ({}))
      ]);
      setNotices((Array.isArray(savedNotices) ? savedNotices : []).filter((notice) => !notice.targetBranch || notice.targetBranch === "전체" || notice.targetBranch === branchName));

      setNoticeChecks(savedNoticeChecks && typeof savedNoticeChecks === "object" ? savedNoticeChecks : {});

      const nextIssues: Array<{ type: string; message: string; level: "warn" | "danger" | "info"; names?: string[] }> = [];
      if (!today?.exists) {
        nextIssues.push({ type: "전일마감", message: `${getDateStr(-1)} 일일마감 미제출`, level: "info" });
      }

      const missingAddReason: string[] = [];
      const incompleteNewHires: string[] = [];
      const incompleteTransfers: string[] = [];
      const incompleteOtherReasons: string[] = [];
      (roster || []).forEach((employee: any) => {
        const name = String(employee.name || "").trim();
        if (!name) return;
        const addReason = parseStaffAddReason(String(employee.addReason || ""));
        if (!addReason) {
          missingAddReason.push(name);
          return;
        }
        const residentBirth = residentBirthKey(employee.residentNumber);
        if (addReason === "신규입사") {
          const effectiveDate = String(employee.hireDate || employee.entryDate || "");
          if (!residentBirth || !effectiveDate || toPhoneTail8(String(employee.phone || "")).length !== 8) incompleteNewHires.push(name);
        }
        if (addReason === "지점이동") {
          const effectiveDate = String(employee.transferDate || employee.entryDate || "");
          const salaryChanged = parseSalaryChangeStatus(String(employee.salaryChanged || ""));
          if (!residentBirth || !effectiveDate || !salaryChanged) incompleteTransfers.push(name);
        }
        if (addReason === "기타" && !String(employee.addReasonMemo || "").trim()) {
          incompleteOtherReasons.push(name);
        }
      });
      if (missingAddReason.length > 0) {
        nextIssues.push({ type: "직원현황", message: "추가사유 선택 필요", names: missingAddReason, level: "warn" });
      }
      if (incompleteNewHires.length > 0) {
        nextIssues.push({ type: "근로계약 후보", message: "신규입사 필수정보 확인 필요", names: incompleteNewHires, level: "warn" });
      }
      if (incompleteTransfers.length > 0) {
        nextIssues.push({ type: "근로계약 후보", message: "지점이동 필수정보 확인 필요", names: incompleteTransfers, level: "warn" });
      }
      if (incompleteOtherReasons.length > 0) {
        nextIssues.push({ type: "근로계약 후보", message: "기타 사유 내용 입력 필요", names: incompleteOtherReasons, level: "warn" });
      }

      const byName = new Map<string, any[]>();
      (roster || []).forEach((employee: any) => {
        const name = String(employee.name || "").trim();
        if (!name) return;
        byName.set(name, [...(byName.get(name) || []), employee]);
      });
      const duplicateNames: string[] = [];
      let hasMissingResidentDuplicate = false;
      byName.forEach((group, name) => {
        if (group.length < 2) return;
        const birthKeys = group.map((employee) => residentBirthKey(employee.residentNumber));
        if (birthKeys.some((key) => !key)) hasMissingResidentDuplicate = true;
        duplicateNames.push(name);
      });
      if (duplicateNames.length > 0) {
        nextIssues.push({
          type: "동명이인 확인",
          message: hasMissingResidentDuplicate
            ? "동명이인/동일인 확인 필요 (주민등록번호 미입력 포함)"
            : "동명이인/동일인 확인 필요",
          names: duplicateNames,
          level: "danger"
        });
      }

      setIssues(nextIssues);
    } finally {
      setLoading(false);
    }
  }, [branchName, noticeCheckKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const getNoticeId = (notice: any, index: number) => String(notice.id || `${notice.createdAt || "notice"}-${index}`);

  const handleConfirmNotice = async (noticeId: string) => {
    const name = String(noticeCheckNames[noticeId] || "").trim();
    if (!name) {
      window.alert("확인자 이름을 입력해주세요.");
      return;
    }
    const next = {
      ...noticeChecks,
      [noticeId]: { name, checkedAt: new Date().toISOString() }
    };
    setNoticeChecks(next);
    setPendingNoticeCheckId(null);
    setNoticeCheckNames((current) => ({ ...current, [noticeId]: "" }));
    await gasClient.saveSharedData(noticeCheckKey, next);
  };

  const handleCancelNotice = async (noticeId: string) => {
    const next = { ...noticeChecks };
    delete next[noticeId];
    setNoticeChecks(next);
    await gasClient.saveSharedData(noticeCheckKey, next);
  };

  return (
    <div className="branch-dashboard-tab space-y-6">
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-gray-900">{branchName} 대시보드</h2>
            <p className="text-xs text-gray-400 mt-1">공지사항과 지점에서 아직 확인해야 할 미결사항을 모아 보여줍니다.</p>
          </div>
          <button onClick={() => void load()} className="px-4 py-2 rounded-xl bg-[#2E6DB4] text-white text-xs font-black">새로고침</button>
        </div>
      </div>

      <section className="rounded-3xl border-2 border-rose-500 bg-gradient-to-br from-rose-50 via-white to-amber-50 shadow-sm p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#2E6DB4] px-3 py-1 text-[11px] font-black text-white shadow-sm">
              <Info className="w-3.5 h-3.5" />
              관리자 공지
            </div>
          </div>
          <span className="rounded-full bg-white/85 px-3 py-1 text-xs font-black text-rose-600 border border-rose-200">{notices.length}건</span>
        </div>
        {loading ? (
          <div className="py-10 flex justify-center"><LoadingSpinner size="md" /></div>
        ) : notices.length === 0 ? (
          <div className="rounded-2xl bg-white/75 border border-rose-100 p-5 text-sm font-bold text-gray-500 text-center">등록된 공지사항이 없습니다.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {notices.slice(0, 6).map((notice, index) => {
              const noticeId = getNoticeId(notice, index);
              const checked = noticeChecks[noticeId];
              return (
              <div key={noticeId} className={`branch-notice-card rounded-2xl border p-4 shadow-xs ${checked ? "branch-notice-checked" : "branch-notice-unchecked"}`}>
                <p className="text-sm font-black text-gray-900">{notice.title || "공지사항"}</p>
                <p className="branch-notice-body text-sm mt-2 whitespace-pre-wrap leading-relaxed font-black">{notice.body || notice.content || ""}</p>
                <p className="text-[10px] text-gray-400 mt-3 font-mono">{notice.createdAt ? new Date(notice.createdAt).toLocaleString("ko-KR") : ""}</p>
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2">
                  {checked ? (
                    <>
                      <span className="text-xs font-black text-gray-800">확인자: {checked.name}</span>
                      <button type="button" onClick={() => void handleCancelNotice(noticeId)} className="branch-notice-cancel-button rounded-xl px-3 py-2 text-xs font-black">확인취소</button>
                    </>
                  ) : pendingNoticeCheckId === noticeId ? (
                    <>
                      <input
                        value={noticeCheckNames[noticeId] || ""}
                        onChange={(event) => setNoticeCheckNames((current) => ({ ...current, [noticeId]: event.target.value }))}
                        placeholder="확인자 이름"
                        className="branch-notice-check-name rounded-xl px-3 py-2 text-xs font-bold outline-none"
                      />
                      <button type="button" onClick={() => void handleConfirmNotice(noticeId)} className="branch-notice-check-button rounded-xl px-3 py-2 text-xs font-black">확인완료</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setPendingNoticeCheckId(noticeId)} className="branch-notice-check-button rounded-xl px-3 py-2 text-xs font-black">확인</button>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6">
        <section className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-gray-800 flex items-center gap-2"><AlertCircle className="w-4 h-4 text-amber-500" /> 미결 확인사항</h3>
            <span className="text-xs font-black text-gray-400">{issues.length}건</span>
          </div>
          {loading ? (
            <div className="py-16 flex justify-center"><LoadingSpinner size="md" /></div>
          ) : issues.length === 0 ? (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-5 text-sm font-bold text-emerald-800">현재 확인 필요한 미결사항이 없습니다.</div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {issues.map((issue, index) => (
                <div key={index} className={`rounded-2xl border p-4 text-sm ${issue.level === "danger" ? "bg-rose-50 border-rose-100 text-rose-800" : issue.level === "warn" ? "bg-amber-50 border-amber-100 text-amber-800" : "bg-sky-50 border-sky-100 text-sky-800"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-black opacity-70">{issue.type}</p>
                    {issue.names && <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-black">{issue.names.length}명</span>}
                  </div>
                  <p className="font-black mt-1">{issue.message}</p>
                  {issue.names && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(expandedIssueIndexes[index] ? issue.names : issue.names.slice(0, 12)).map((name) => (
                        <span key={name} className="rounded-full bg-white/75 border border-current/10 px-2 py-1 text-[11px] font-bold">{name}</span>
                      ))}
                      {issue.names.length > 12 && !expandedIssueIndexes[index] && (
                        <button
                          type="button"
                          onClick={() => setExpandedIssueIndexes((current) => ({ ...current, [index]: true }))}
                          className="rounded-full bg-white/90 px-2 py-1 text-[11px] font-black underline"
                        >
                          +{issue.names.length - 12}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
