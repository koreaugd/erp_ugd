// src/pages/branch/tabs/MonthlyCashManagementSubTab.tsx  (BranchConfirmPage에서 분리 — 동작 변경 없음)
import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { formatNumber } from "../../../utils/formatNumber";
import { toNumberPromptValue } from "../helpers/formatters";
import { updateDailyMetadata } from "../helpers/dailyOps";
import { AdminRecordEditModal } from "./AdminRecordEditModal";
import { useAuthContext } from "../../../contexts/AuthContext";

export function MonthlyCashManagementSubTab({
  branchName,
  selectedMonth,
  history,
  isAdmin = false,
  refreshHistory,
  monthPicker
}: {
  branchName: string;
  selectedMonth: string;
  history: any[];
  isAdmin?: boolean;
  refreshHistory?: () => Promise<void>;
  /* 결산월 선택기. 예전엔 카드 위에 "결산월 선택:" 한 줄이 따로 떠 있었다 —
     제목 밴드 안 필터 자리에 들어가야 관리자 화면과 같은 모양이 된다(DESIGN.md §6-3). */
  monthPicker?: ReactNode;
}) {
  const { user } = useAuthContext();
  // 개인 로그인 계정이면 이력에 실제 이름을 남긴다. PIN 세션은 예전과 같은 소속 표기를 유지한다.
  const actor = {
    name: isAdmin
      ? (user?.loginType === "personal" ? user.name : "관리자")
      : (user?.loginType === "personal" ? user.name : branchName),
    uid: user?.uid
  };
  const [logs, setLogs] = useState<any[]>([]);
  const [editCashManagement, setEditCashManagement] = useState<{ row: any; fields: Record<string, string> } | null>(null);

  useEffect(() => {
    const cashMgmt: any[] = [];

    history.forEach((m) => {
      if (m.settleDate && m.settleDate.startsWith(selectedMonth)) {
        const parts = (m.memo || "").split("\n---\nMETADATA:");

        let metaParsed: any = {};
        if (parts[1]) {
          try {
            metaParsed = JSON.parse(parts[1].trim());
          } catch {}
        }

        const prevVal = Number(metaParsed.prevDayCash) || 0;
        const salesVal = Number(m.cashSales) || 0;

        const expensesVal = metaParsed.cashExpenses
          ? metaParsed.cashExpenses.reduce((sum: number, x: any) => sum + (Number(x.amount) || 0), 0)
          : 0;

        const theoryVal = prevVal + salesVal - expensesVal;
        const vaultVal = Number(metaParsed.cashBalance) || 0;
        const difference = vaultVal - theoryVal;

        cashMgmt.push({
          recordId: m.recordId,
          date: m.settleDate,
          prevDayCash: prevVal,
          cashSales: salesVal,
          cashExpensesSum: expensesVal,
          theoreticalBalance: theoryVal,
          actualCashBalance: vaultVal,
          diff: difference,
          reason: metaParsed.cashDiffReason || "",
          writer: m.submittedBy || "매니저"
        });
      }
    });

    // Sort by Date ascending
    cashMgmt.sort((a,b) => a.date.localeCompare(b.date));
    setLogs(cashMgmt);
  }, [selectedMonth, history]);

  const handleEditCashManagement = (row: any) => {
    if (!row.recordId) return;
    setEditCashManagement({ row, fields: { prevDayCash: toNumberPromptValue(row.prevDayCash), cashSales: toNumberPromptValue(row.cashSales), actualCashBalance: toNumberPromptValue(row.actualCashBalance), reason: row.reason || "" } });
  };

  const saveEditCashManagement = async () => {
    if (!editCashManagement) return;
    const { row, fields } = editCashManagement;
    await updateDailyMetadata(row.recordId, (metadata) => ({
      metadata: {
        ...metadata,
        prevDayCash: String(Number(fields.prevDayCash) || 0),
        cashBalance: String(Number(fields.actualCashBalance) || 0),
        cashDiffReason: fields.reason.trim()
      },
      masterPatch: { cashSales: Number(fields.cashSales) || 0 }
    }), actor);
    setEditCashManagement(null);
    await refreshHistory?.();
  };

  const handleClearCashManagement = async (row: any) => {
    if (!row.recordId || !window.confirm(`${row.date} 현금관리 값을 비울까요?`)) return;
    await updateDailyMetadata(row.recordId, (metadata) => ({
      metadata: { ...metadata, prevDayCash: "", cashBalance: "", cashDiffReason: "" },
      masterPatch: { cashSales: 0 }
    }), actor);
    await refreshHistory?.();
  };

  return (
    <div className="branch-sheet-card animate-fade-in" id="cash-management-subtab">
      {editCashManagement && (
        <AdminRecordEditModal
          title={`${editCashManagement.row.date} 현금관리 수정`}
          fields={[
            { key: "prevDayCash", label: "전일 금고현금", value: editCashManagement.fields.prevDayCash, type: "number" },
            { key: "cashSales", label: "금일 현금매출", value: editCashManagement.fields.cashSales, type: "number" },
            { key: "actualCashBalance", label: "금고 실사 현금", value: editCashManagement.fields.actualCashBalance, type: "number" },
            { key: "reason", label: "차액 사유", value: editCashManagement.fields.reason }
          ]}
          onChange={(key, value) => setEditCashManagement((current) => current ? { ...current, fields: { ...current.fields, [key]: value } } : current)}
          onCancel={() => setEditCashManagement(null)}
          onSave={() => void saveEditCashManagement()}
        />
      )}
      {/* 제목 밴드 = 지점 표준(DESIGN.md §6-3). 제목엔 글자만 — 아이콘 금지(§6-1). */}
      <div className="branch-band">
        <h3 className="branch-band-title">일일 금고 실재고 관리 대장</h3>
        {monthPicker}
        <p className="branch-band-meta">
          전일 시재 + 현금매출 − 현금지출 = 이론상 보유고. 금고 실사액과의 차액을 함께 봅니다.
        </p>
      </div>

      {/* 한 달치가 통째로 늘어나 헤더가 스크롤 위로 사라졌다. 표 안에서만 스크롤하고 헤더는 붙여 둔다.
          테두리는 카드가 이미 그리므로 여기서 또 그리지 않는다(선이 두 줄로 겹친다 — §9-1-A). */}
      <div className="max-h-[60vh] overflow-auto">
        {/* 머리글 모양(엘리스·11px·900·스크롤 고정)은 `.branch-sheet-head` 가 준다 — 색·굵기·테두리를 여기 적지 않는다(DESIGN.md §6-3-1). */}
        <table className="branch-sheet-head w-full text-left text-xs border-collapse font-medium whitespace-nowrap">
          <thead>
            <tr>
              <th>마감 일자</th>
              <th className="text-right">전일 금고현금</th>
              <th className="text-right">+ 금일 현금매출</th>
              <th className="text-right">- 현금지출 합계</th>
              <th className="text-right">이론상 잔액 (원)</th>
              <th className="text-right">금고 실사 현금 (원)</th>
              <th className="text-right">차액 (불일치)</th>
              <th>대조 불일치 사유 소명</th>
              <th className="text-center">점검 작성자</th>
              {isAdmin && <th className="text-center">관리</th>}
            </tr>
          </thead>
          <tbody className="sheet-rows-soft divide-y text-[11px] font-sans">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 10 : 9} className="py-20 text-center text-gray-400 font-bold">
                  선택한 월에 대조할 수 있는 일일 금고 보고데이터가 없습니다.
                </td>
              </tr>
            ) : (
              logs.map((row, idx) => {
                const hasDiff = row.diff !== 0;
                return (
                  <tr key={idx} className={`hover:bg-zinc-50/30 ${hasDiff ? "bg-rose-50/20" : ""}`}>
                    <td className="py-2 px-2.5 font-mono font-bold text-gray-500">{row.date}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-600">{formatNumber(row.prevDayCash)}</td>
                    <td className="py-2 px-2 text-right font-mono font-bold text-indigo-600">{formatNumber(row.cashSales)}</td>
                    <td className="py-2 px-2 text-right font-mono font-bold text-orange-600">{formatNumber(row.cashExpensesSum)}</td>
                    <td className="py-2 px-2.5 text-right font-mono font-black text-gray-800 bg-zinc-100/30">{formatNumber(row.theoreticalBalance)}</td>
                    <td className="py-2 px-2.5 text-right font-mono font-black text-emerald-800 bg-emerald-50/10">{formatNumber(row.actualCashBalance)}</td>
                    <td className="py-2 px-2.5 text-right">
                      {hasDiff ? (
                        <span className="text-rose-650 font-black font-mono">
                          {row.diff > 0 ? "+" : ""}
                          {formatNumber(row.diff)} 원
                        </span>
                      ) : (
                        <span className="text-emerald-600 font-extrabold font-mono">0 (정확)</span>
                      )}
                    </td>
                    <td className="py-2 px-2.5">
                      {hasDiff ? (
                        <span className="text-rose-600 font-bold text-[10px] break-all">{row.reason || "사유 미입력 누락!"}</span>
                      ) : (
                        <span className="text-gray-400 font-medium text-[10px]">시재 무결성 일치</span>
                      )}
                    </td>
                    <td className="py-2 px-2.5 text-center font-bold text-gray-650">{row.writer}</td>
                    {isAdmin && (
                      <td className="py-2 px-2.5">
                        <div className="flex justify-center gap-1">
                          <button onClick={() => void handleEditCashManagement(row)} className="px-2 py-1 rounded-lg border border-blue-100 bg-blue-50 text-blue-700 text-[10px] font-black">수정</button>
                          <button onClick={() => void handleClearCashManagement(row)} className="px-2 py-1 rounded-lg border border-rose-100 bg-rose-50 text-rose-700 text-[10px] font-black">삭제</button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
