// src/pages/branch/tabs/MonthlyCashExpensesSubTab.tsx  (BranchConfirmPage에서 분리 — 동작 변경 없음)
import { useState, useEffect, useMemo } from "react";
import { Coins } from "lucide-react";
import { formatNumber } from "../../../utils/formatNumber";
import { toNumberPromptValue } from "../helpers/formatters";
import { getMonthlyExpenseCategoryChipClass, getMonthlyExpenseUsageChipClass } from "../helpers/chipClasses";
import { updateDailyMetadata } from "../helpers/dailyOps";
import { AdminRecordEditModal } from "./AdminRecordEditModal";

export function MonthlyCashExpensesSubTab({
  branchName,
  selectedMonth,
  history,
  isAdmin = false,
  refreshHistory
}: {
  branchName: string;
  selectedMonth: string;
  history: any[];
  isAdmin?: boolean;
  refreshHistory?: () => Promise<void>;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [editExpense, setEditExpense] = useState<{ item: any; fields: Record<string, string> } | null>(null);
  const [usageFilter, setUsageFilter] = useState("전체");
  const [classificationFilter, setClassificationFilter] = useState("전체");

  useEffect(() => {
    const cashList: any[] = [];

    history.forEach((m) => {
      if (m.settleDate && m.settleDate.startsWith(selectedMonth)) {
        const parts = (m.memo || "").split("\n---\nMETADATA:");
        if (parts[1]) {
          try {
            const meta = JSON.parse(parts[1].trim());
            if (meta && meta.cashExpenses) {
              meta.cashExpenses.forEach((exp: any, index: number) => {
                const itemAmount = Number(exp.amount) || 0;
                if (itemAmount > 0) {
                  cashList.push({
                    recordId: m.recordId,
                    metaIndex: index,
                    date: m.settleDate,
                    paymentType: "현금",
                    amount: itemAmount,
                    usage: exp.usage || "공란",
                    classification: exp.classification || "미분류",
                    detail: exp.detail || "",
                    author: m.submittedBy || m.submitted_by || (m as any).writer || "매니저" ,
                    timestamp: m.submittedAt ? new Date(m.submittedAt).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" }) : "-"
                  });
                }
              });
            }
          } catch {}
        }
      }
    });

    // Sort by Date ascending
    cashList.sort((a,b) => a.date.localeCompare(b.date));
    setItems(cashList);
  }, [selectedMonth, history]);

  const usageOptions = useMemo(
    () => ["전체", ...Array.from(new Set(items.map((item) => String(item.usage || "").trim()).filter(Boolean)))],
    [items]
  );
  const classificationOptions = useMemo(
    () => ["전체", ...Array.from(new Set(items.map((item) => String(item.classification || "").trim()).filter(Boolean)))],
    [items]
  );
  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        const matchesUsage = usageFilter === "전체" || item.usage === usageFilter;
        const matchesClassification = classificationFilter === "전체" || item.classification === classificationFilter;
        return matchesUsage && matchesClassification;
      }),
    [items, usageFilter, classificationFilter]
  );
  const totalSum = filteredItems.reduce((acc, i) => acc + i.amount, 0);

  const handleEditExpense = (item: any) => {
    if (!item.recordId) return;
    setEditExpense({ item, fields: { amount: toNumberPromptValue(item.amount), usage: item.usage || "", classification: item.classification || "", detail: item.detail || "" } });
  };

  const saveEditExpense = async () => {
    if (!editExpense) return;
    const { item, fields } = editExpense;
    const amount = Number(fields.amount);
    if (!Number.isFinite(amount)) {
      alert("금액은 숫자로 입력해주세요.");
      return;
    }
    await updateDailyMetadata(item.recordId, (metadata) => {
      const cashExpenses = Array.isArray(metadata.cashExpenses) ? [...metadata.cashExpenses] : [];
      cashExpenses[item.metaIndex] = { ...(cashExpenses[item.metaIndex] || {}), amount: String(amount), usage: fields.usage.trim(), classification: fields.classification.trim(), detail: fields.detail.trim() };
      return { metadata: { ...metadata, cashExpenses } };
    });
    setEditExpense(null);
    await refreshHistory?.();
  };

  const handleDeleteExpense = async (item: any) => {
    if (!item.recordId || !window.confirm(`${item.date} 현금지출 ${formatNumber(item.amount)}원을 삭제할까요?`)) return;
    await updateDailyMetadata(item.recordId, (metadata) => {
      const cashExpenses = Array.isArray(metadata.cashExpenses) ? [...metadata.cashExpenses] : [];
      cashExpenses.splice(item.metaIndex, 1);
      return { metadata: { ...metadata, cashExpenses } };
    });
    await refreshHistory?.();
  };

  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5 animate-fade-in" id="cash-expenses-subtab">
      {editExpense && (
        <AdminRecordEditModal
          title="현금지출 수정"
          fields={[
            { key: "amount", label: "지출 금액", value: editExpense.fields.amount, type: "number" },
            { key: "usage", label: "거래처/사용처", value: editExpense.fields.usage },
            { key: "classification", label: "분류 항목", value: editExpense.fields.classification },
            { key: "detail", label: "지출내용", value: editExpense.fields.detail }
          ]}
          onChange={(key, value) => setEditExpense((current) => current ? { ...current, fields: { ...current.fields, [key]: value } } : current)}
          onCancel={() => setEditExpense(null)}
          onSave={() => void saveEditExpense()}
        />
      )}
      <div className="flex justify-between items-center pb-3 border-b border-gray-50">
        <div>
          <h3 className="text-sm font-black text-zinc-900 flex items-center gap-1.5 font-sans">
            <Coins className="w-5 h-5 text-orange-500" />
            월 현금 지출 내역부 (일일보고 연동)
          </h3>
          <p className="text-[10px] text-gray-400 font-bold mt-0.5">
             매일 마감 일지 작성 시 각 가맹 지점에서 현금 금고에서 차감하고 신고한 실시간 개별 지출 전표의 자동 집계 장부입니다.
          </p>
        </div>

        <div className="bg-orange-50/50 p-2.5 px-4 rounded-xl border border-orange-100 text-right">
          <span className="text-[9px] text-orange-600 font-black block leading-none">월 현금지출 총계</span>
          <span className="text-sm font-black text-zinc-850 font-mono mt-1 block">{formatNumber(totalSum)} 원</span>
        </div>
      </div>

      <div className="monthly-expense-filter-bar flex flex-wrap items-center gap-3">
        <select
          value={usageFilter}
          onChange={(e) => setUsageFilter(e.target.value)}
          className="monthly-expense-filter-select"
        >
          {usageOptions.map((option) => (
            <option key={option} value={option}>
              사용처: {option}
            </option>
          ))}
        </select>
        <select
          value={classificationFilter}
          onChange={(e) => setClassificationFilter(e.target.value)}
          className="monthly-expense-filter-select"
        >
          {classificationOptions.map((option) => (
            <option key={option} value={option}>
              분류항목: {option}
            </option>
          ))}
        </select>
      </div>

      {/* 한 달치가 통째로 늘어나 헤더가 스크롤 위로 사라졌다. 표 안에서만 스크롤하고 헤더는 붙여 둔다. */}
      <div className="max-h-[60vh] overflow-auto rounded-2xl border border-gray-100">
        <table className="w-full text-left text-xs border-collapse whitespace-nowrap">
          <thead className="sticky top-0 z-10">
            <tr className="bg-zinc-50 border-b border-gray-100 text-zinc-500 font-black text-[10px] uppercase">
              <th className="py-2 px-2.5 w-[96px]">마감 일자</th>
              <th className="py-2 px-2.5 w-[72px]">결제 수단</th>
              <th className="py-2 px-2.5 text-right w-[104px]">지출 금액</th>
              <th className="py-2 px-2.5">거래처 (사용처)</th>
              <th className="py-2 px-2.5">분류 항목</th>
              <th className="py-2 px-2.5">지출내용 (세부)</th>
              <th className="py-2 px-2.5">비고</th>
              <th className="py-2 px-2.5">작성자</th>
              <th className="py-2 px-2.5">입력 시각</th>
              {isAdmin && <th className="py-2 px-2.5 text-center">관리</th>}
            </tr>
          </thead>
          <tbody className="sheet-rows-soft divide-y text-[11px] font-sans">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 10 : 9} className="py-20 text-center text-gray-400 font-bold">
                  선택한 월에 일일마감 시 접수된 현금지출 전표가 한 건도 존재하지 않습니다.
                </td>
              </tr>
            ) : (
              filteredItems.map((it, idx) => {
                // 같은 날짜가 이어지면 날짜는 한 번만 적고, 날짜가 바뀌는 자리에만 선을 긋는다.
                // 날짜가 매 행 반복되면 눈이 그걸 다 읽느라 정작 금액·사용처를 못 훑는다.
                const newDate = idx === 0 || filteredItems[idx - 1].date !== it.date;
                return (
                <tr key={idx} className={`hover:bg-zinc-50/40 ${newDate && idx > 0 ? "row-group-start" : ""}`}>
                  <td className="py-2 px-2.5 font-mono font-bold text-gray-500">{newDate ? it.date : ""}</td>
                  <td className="py-2 px-2.5">
                    <span className="pay-chip pay-chip-cash inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-md whitespace-nowrap">
                      {it.paymentType}
                    </span>
                  </td>
                  <td className="py-2 px-2.5 text-right font-mono font-black text-gray-800 text-xs">
                    {formatNumber(it.amount)} 원
                  </td>
                  <td className="py-2 px-2.5 font-bold text-zinc-800">
                    <span className={`monthly-expense-chip ${getMonthlyExpenseUsageChipClass(it.usage)}`}>{it.usage}</span>
                  </td>
                  <td className="py-2 px-2.5 font-bold text-blue-650">
                    <span className={`monthly-expense-chip ${getMonthlyExpenseCategoryChipClass(it.classification)}`}>{it.classification}</span>
                  </td>
                  <td className="py-2 px-2.5 text-gray-550 font-semibold">{it.detail || "공란"}</td>
                  <td className="py-2 px-2.5 text-gray-400 font-bold">확인완료</td>
                  <td className="py-2 px-2.5 text-zinc-600 font-bold">{it.author}</td>
                  <td className="py-2 px-2.5 font-mono text-gray-400">{it.timestamp}</td>
                  {isAdmin && (
                    <td className="py-2 px-2.5">
                      <div className="flex justify-center gap-1">
                        <button onClick={() => void handleEditExpense(it)} className="px-2 py-1 rounded-lg border border-blue-100 bg-blue-50 text-blue-700 text-[10px] font-black">수정</button>
                        <button onClick={() => void handleDeleteExpense(it)} className="px-2 py-1 rounded-lg border border-rose-100 bg-rose-50 text-rose-700 text-[10px] font-black">삭제</button>
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
