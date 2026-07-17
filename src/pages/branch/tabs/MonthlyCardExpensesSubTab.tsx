// src/pages/branch/tabs/MonthlyCardExpensesSubTab.tsx  (BranchConfirmPage에서 분리 — 동작 변경 없음)
import { useState, useEffect, useMemo } from "react";
import { ShoppingCart } from "lucide-react";
import { formatNumber } from "../../../utils/formatNumber";
import { toNumberPromptValue } from "../helpers/formatters";
import { getMonthlyExpenseCategoryChipClass, getMonthlyExpenseUsageChipClass } from "../helpers/chipClasses";
import { updateDailyMetadata } from "../helpers/dailyOps";
import { AdminRecordEditModal } from "./AdminRecordEditModal";

export function MonthlyCardExpensesSubTab({
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
  const [editCardExpense, setEditCardExpense] = useState<{ item: any; fields: Record<string, string> } | null>(null);
  const [usageFilter, setUsageFilter] = useState("전체");
  const [classificationFilter, setClassificationFilter] = useState("전체");

  useEffect(() => {
    const cardList: any[] = [];

    history.forEach((m) => {
      if (m.settleDate && m.settleDate.startsWith(selectedMonth)) {
        const parts = (m.memo || "").split("\n---\nMETADATA:");
        if (parts[1]) {
          try {
            const meta = JSON.parse(parts[1].trim());
            if (meta && meta.cardExpenses) {
              meta.cardExpenses.forEach((exp: any, index: number) => {
                const itemAmount = Number(exp.amount) || 0;
                if (itemAmount > 0) {
                  cardList.push({
                    recordId: m.recordId,
                    metaIndex: index,
                    date: m.settleDate,
                    paymentType: "카드",
                    amount: itemAmount,
                    usage: exp.usage || "공란",
                    classification: exp.classification || "미분류",
                    detail: exp.detail || "",
                    author: m.submittedBy || m.submitted_by || (m as any).writer || "매니저"
                  });
                }
              });
            }
          } catch {}
        }
      }
    });

    // Sort by Date ascending
    cardList.sort((a,b) => a.date.localeCompare(b.date));
    setItems(cardList);
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
  // 지금 표에 보이는 것(필터 적용)의 합. 필터를 걸면 이 숫자가 따라 움직인다.
  const filteredSum = filteredItems.reduce((acc, i) => acc + i.amount, 0);
  // 이 달 전체 합. 필터와 무관하다 — 위 머리글의 "월 카드지출 총계"는 이 숫자여야 말이 맞는다.
  // (예전에는 여기에 필터 합계를 넣어 두고 "월 총계"라고 적어, 필터를 걸면 라벨과 숫자가 서로 다른 말을 했다.)
  const monthSum = useMemo(() => items.reduce((acc, i) => acc + i.amount, 0), [items]);
  const filterActive = usageFilter !== "전체" || classificationFilter !== "전체";

  /**
   * 쿠팡·네이버 이 달 결제액.
   *
   * 필터와 무관하게 **이 달 전체**를 센다. filteredItems로 세면 사용처를 "네이버"로 거르는 순간
   * 쿠팡이 0원으로 보인다 — 두 곳을 나란히 비교하려고 두는 숫자인데 그러면 쓸모가 없다.
   * 사용처는 고정 항목(쿠팡/네이버/인근매장/그외기타/현금입금)이라 정확히 맞춰 센다.
   * 관리자 수정창에서 사용처를 자유롭게 고칠 수 있어 앞뒤 공백이 섞일 수 있으므로 다듬어서 비교한다.
   */
  const usageTotals = useMemo(() => {
    const sumOf = (target: string) =>
      items.filter((item) => String(item.usage || "").trim() === target).reduce((acc, item) => acc + item.amount, 0);
    return { 쿠팡: sumOf("쿠팡"), 네이버: sumOf("네이버") };
  }, [items]);

  const handleEditCardExpense = (item: any) => {
    if (!item.recordId) return;
    setEditCardExpense({ item, fields: { amount: toNumberPromptValue(item.amount), usage: item.usage || "", classification: item.classification || "", detail: item.detail || "" } });
  };

  const saveEditCardExpense = async () => {
    if (!editCardExpense) return;
    const { item, fields } = editCardExpense;
    const amount = Number(fields.amount);
    if (!Number.isFinite(amount)) {
      alert("금액은 숫자로 입력해주세요.");
      return;
    }
    await updateDailyMetadata(item.recordId, (metadata) => {
      const cardExpenses = Array.isArray(metadata.cardExpenses) ? [...metadata.cardExpenses] : [];
      cardExpenses[item.metaIndex] = { ...(cardExpenses[item.metaIndex] || {}), amount: String(amount), usage: fields.usage.trim(), classification: fields.classification.trim(), detail: fields.detail.trim() };
      return { metadata: { ...metadata, cardExpenses } };
    });
    setEditCardExpense(null);
    await refreshHistory?.();
  };

  const handleDeleteCardExpense = async (item: any) => {
    if (!item.recordId || !window.confirm(`${item.date} 카드지출 ${formatNumber(item.amount)}원을 삭제할까요?`)) return;
    await updateDailyMetadata(item.recordId, (metadata) => {
      const cardExpenses = Array.isArray(metadata.cardExpenses) ? [...metadata.cardExpenses] : [];
      cardExpenses.splice(item.metaIndex, 1);
      return { metadata: { ...metadata, cardExpenses } };
    });
    await refreshHistory?.();
  };

  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5 animate-fade-in" id="card-expenses-subtab">
      {editCardExpense && (
        <AdminRecordEditModal
          title="카드지출 수정"
          fields={[
            { key: "amount", label: "지출 금액", value: editCardExpense.fields.amount, type: "number" },
            { key: "usage", label: "사용처", value: editCardExpense.fields.usage },
            { key: "classification", label: "분류 항목", value: editCardExpense.fields.classification },
            { key: "detail", label: "지출내용", value: editCardExpense.fields.detail }
          ]}
          onChange={(key, value) => setEditCardExpense((current) => current ? { ...current, fields: { ...current.fields, [key]: value } } : current)}
          onCancel={() => setEditCardExpense(null)}
          onSave={() => void saveEditCardExpense()}
        />
      )}
      <div className="flex justify-between items-center pb-3 border-b border-gray-50 font-sans">
        <div>
          <h3 className="text-sm font-black text-zinc-900 flex items-center gap-1.5">
            <ShoppingCart className="w-5 h-5 text-blue-500" />
            월 카드 (법인카드/외식카드 등) 지출 일람표
          </h3>
          <p className="text-[10px] text-gray-400 font-bold mt-0.5">
             일일 지점 마감 영수증 보고 시 기입하여 제출된 카드 사용 영수 금액 전표 일치 내역서입니다.
          </p>
        </div>

        <div className="bg-blue-50/50 p-2.5 px-4 rounded-xl border border-blue-100 text-right">
          <span className="text-[9px] text-[#2E6DB4] font-black block leading-none">월 카드지출 총계</span>
          <span className="text-sm font-black text-zinc-850 font-mono mt-1 block">{formatNumber(monthSum)} 원</span>
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

        {/* 필터 합계 + 쿠팡·네이버 결제액. ml-auto로 필터 줄 오른쪽 끝에 붙인다. */}
        <div className="ml-auto flex items-center gap-2.5">
          {/* 지금 고른 조건의 합. 필터를 걸면 위 "월 카드지출 총계"와 나란히 놓여 전체 대비 얼마인지 보인다. */}
          <span
            className="text-[11px] font-black text-zinc-500"
            title={filterActive ? "지금 필터로 걸러진 내역의 합계입니다." : "필터를 걸지 않아 이 달 전체와 같습니다."}
          >
            {filterActive ? "필터 합계" : "표시 합계"}
            <b className="ml-1 font-mono text-sm text-zinc-900">{formatNumber(filteredSum)}</b>원
            <span className="ml-1 font-mono text-zinc-400">({filteredItems.length}건)</span>
          </span>
          <span
            className="monthly-expense-chip monthly-chip-vanilla text-[11px] font-black"
            title="필터와 상관없이 이 달 전체에서 사용처가 쿠팡인 금액입니다."
          >
            쿠팡: <b className="font-mono">{formatNumber(usageTotals.쿠팡)}</b>원
          </span>
          <span
            className="monthly-expense-chip monthly-chip-honey text-[11px] font-black"
            title="필터와 상관없이 이 달 전체에서 사용처가 네이버인 금액입니다."
          >
            네이버: <b className="font-mono">{formatNumber(usageTotals.네이버)}</b>원
          </span>
        </div>
      </div>

      {/* 한 달치가 통째로 늘어나 헤더가 스크롤 위로 사라졌다. 표 안에서만 스크롤하고 헤더는 붙여 둔다. */}
      <div className="max-h-[60vh] overflow-auto rounded-2xl border border-gray-100">
        <table className="w-full text-left text-xs border-collapse font-sans whitespace-nowrap">
          <thead className="sticky top-0 z-10">
            <tr className="bg-zinc-50 border-b border-gray-100 text-zinc-500 font-black text-[10px] uppercase">
              <th className="py-2 px-2.5 w-[96px]">마감 일자</th>
              <th className="py-2 px-2.5 w-[72px]">결제 수단</th>
              <th className="py-2 px-2.5 text-right w-[104px]">지출 금액</th>
              <th className="py-2 px-2.5">사용처 (가맹점)</th>
              <th className="py-2 px-2.5">항목 (분류)</th>
              <th className="py-2 px-2.5">지출내용 (세부)</th>
              <th className="py-2 px-2.5">비고</th>
              <th className="py-2 px-2.5">작성자</th>
            </tr>
          </thead>
          <tbody className="sheet-rows-soft divide-y text-[11px]">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 9 : 8} className="py-20 text-center text-gray-400 font-bold">
                  이번 달에 일일보고에 기록된 카드 지출 영수증이 존재하지 않습니다.
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
                    <span className="pay-chip pay-chip-card inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-md whitespace-nowrap">
                      {it.paymentType}
                    </span>
                  </td>
                  <td className="py-2 px-2.5 text-right font-mono font-black text-gray-800 text-xs">
                    {formatNumber(it.amount)} 원
                  </td>
                  <td className="py-2 px-2.5 font-bold text-zinc-800">
                    <span className={`monthly-expense-chip ${getMonthlyExpenseUsageChipClass(it.usage)}`}>{it.usage}</span>
                  </td>
                  <td className="py-2 px-2.5 font-bold text-indigo-600">
                    <span className={`monthly-expense-chip ${getMonthlyExpenseCategoryChipClass(it.classification)}`}>{it.classification}</span>
                  </td>
                  <td className="py-2 px-2.5 text-gray-550 font-semibold">{it.detail || "공란"}</td>
                  <td className="py-2 px-2.5 text-gray-450 font-bold">확인증빙필</td>
                  <td className="py-2 px-2.5 text-zinc-650 font-bold">{it.author}</td>
                  {isAdmin && (
                    <td className="py-2 px-2.5">
                      <div className="flex justify-center gap-1">
                        <button onClick={() => void handleEditCardExpense(it)} className="px-2 py-1 rounded-lg border border-blue-100 bg-blue-50 text-blue-700 text-[10px] font-black">수정</button>
                        <button onClick={() => void handleDeleteCardExpense(it)} className="px-2 py-1 rounded-lg border border-rose-100 bg-rose-50 text-rose-700 text-[10px] font-black">삭제</button>
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
