// src/pages/branch/tabs/MonthlyCardExpensesSubTab.tsx  (BranchConfirmPage에서 분리 — 동작 변경 없음)
import { useState, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { formatNumber } from "../../../utils/formatNumber";
import { toNumberPromptValue } from "../helpers/formatters";
import { getMonthlyExpenseCategoryChipClass, getMonthlyExpenseUsageChipClass } from "../helpers/chipClasses";
import { updateDailyMetadata } from "../helpers/dailyOps";
import { EXPENSE_CLASSIFICATIONS, EXPENSE_USAGES } from "../helpers/expenseRows";
import { AdminRecordEditModal } from "./AdminRecordEditModal";
import { useAuthContext } from "../../../contexts/AuthContext";

// 드롭다운 목록에 현재 값이 없으면(레거시 표기 등) 그 값을 앞에 끼워 빈 칸으로 보이지 않게 한다.
const withCurrent = (list: readonly string[], value: string): string[] =>
  value && !list.includes(value) ? [value, ...list] : [...list];

export function MonthlyCardExpensesSubTab({
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
  // (월 총계 문구는 밴드 설명과 함께 삭제 — 필터를 안 걸면 '표시 합계'가 곧 월 총계다. 2026-08-04)
  const filterActive = usageFilter !== "전체" || classificationFilter !== "전체";

  /**
   * 쿠팡·네이버 이 달 결제액.
   *
   * 필터와 무관하게 **이 달 전체**를 센다. filteredItems로 세면 사용처를 "네이버"로 거르는 순간
   * 쿠팡이 0원으로 보인다 — 두 곳을 나란히 비교하려고 두는 숫자인데 그러면 쓸모가 없다.
   * 사용처는 고정 목록(EXPENSE_USAGES)이라 정확히 맞춰 센다.
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
    const patch = { amount, usage: fields.usage.trim(), classification: fields.classification.trim(), detail: fields.detail.trim() };
    let saved: { success: boolean; editLogFailed?: boolean } | undefined;
    try {
      // 지점이 고치면 이력에 지점명을 남긴다 — 안 넘기면 "관리자가 고침"으로 거짓 기록된다.
      saved = await updateDailyMetadata(item.recordId, (metadata) => {
        const cardExpenses = Array.isArray(metadata.cardExpenses) ? [...metadata.cardExpenses] : [];
        const current = cardExpenses[item.metaIndex];
        // 로드 이후 다른 사람이 이 기록의 앞 지출을 삭제하면 인덱스가 밀려 다른 행을 덮어쓸 수 있다.
        // 금액·상세뿐 아니라 사용처·분류까지 로드 당시 값(같은 fallback)과 대조한다 —
        // 두 행이 금액·상세만 같고 사용처/분류가 다를 수 있기 때문. 네 값이 다 같으면 사실상 동일 행이라 안전.
        if (
          !current ||
          Number(current.amount) !== item.amount ||
          String(current.detail || "") !== String(item.detail || "") ||
          String(current.usage || "공란") !== String(item.usage) ||
          String(current.classification || "미분류") !== String(item.classification)
        ) {
          throw new Error("STALE_METAINDEX");
        }
        cardExpenses[item.metaIndex] = { ...current, amount: String(amount), usage: patch.usage, classification: patch.classification, detail: patch.detail };
        return { metadata: { ...metadata, cardExpenses } };
      }, actor);
    } catch (err) {
      console.error("카드지출 수정 실패", err);
      if (err instanceof Error && err.message === "STALE_METAINDEX") {
        alert("그 사이 목록이 바뀌어 저장을 취소했습니다. 새로고침 후 다시 시도해 주세요.");
        void refreshHistory?.();
      } else {
        alert("수정 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      }
      return;
    }
    // 본문은 저장됐는데 이력 기록만 실패 — 조용히 삼키면 아무도 모른다(Codex 지적 2026-08-07, 삭제와 같은 기준).
    if (saved?.editLogFailed) {
      alert("수정은 저장됐습니다. 다만 수정이력 기록에 실패했으니 본사에 알려 주세요.");
    }
    // 저장 성공 → 그 행만 즉시 반영하고 모달을 닫는다. 전체 히스토리 재조회는 백그라운드로.
    setItems((prev) => prev.map((row) =>
      row.recordId === item.recordId && row.metaIndex === item.metaIndex ? { ...row, ...patch } : row
    ));
    setEditCardExpense(null);
    void refreshHistory?.();
  };

  const handleDeleteCardExpense = async (item: any) => {
    if (!item.recordId) return;
    // 지점은 사유 필수(카드결제 취소·반품 대응, 사용자 승인 2026-08-07) — 수정이력에 그대로 남아
    // 본사가 "왜 지웠는지"를 이력에서 바로 본다. 관리자는 종전대로 확인창만.
    let reason: string | undefined;
    if (!isAdmin) {
      const input = window.prompt(
        `${item.date} 카드지출 ${formatNumber(item.amount)}원을 삭제합니다.\n삭제 사유를 입력해 주세요. (예: 카드결제 취소, 반품)`
      );
      if (input === null) return;
      reason = input.trim();
      if (!reason) {
        alert("삭제 사유를 입력해야 삭제할 수 있습니다.");
        return;
      }
    } else if (!window.confirm(`${item.date} 카드지출 ${formatNumber(item.amount)}원을 삭제할까요?`)) {
      return;
    }
    let saved: { success: boolean; editLogFailed?: boolean } | undefined;
    try {
      saved = await updateDailyMetadata(item.recordId, (metadata) => {
        const cardExpenses = Array.isArray(metadata.cardExpenses) ? [...metadata.cardExpenses] : [];
        const current = cardExpenses[item.metaIndex];
        // 수정과 같은 가드: 로드 이후 앞 행이 지워지면 인덱스가 밀려 **다른 행을 지울 수 있다.**
        // 네 값(금액·상세·사용처·분류)이 로드 당시와 같을 때만 같은 행으로 보고 지운다.
        if (
          !current ||
          Number(current.amount) !== item.amount ||
          String(current.detail || "") !== String(item.detail || "") ||
          String(current.usage || "공란") !== String(item.usage) ||
          String(current.classification || "미분류") !== String(item.classification)
        ) {
          throw new Error("STALE_METAINDEX");
        }
        cardExpenses.splice(item.metaIndex, 1);
        return { metadata: { ...metadata, cardExpenses } };
      }, actor, { reason });
    } catch (err) {
      console.error("카드지출 삭제 실패", err);
      if (err instanceof Error && err.message === "STALE_METAINDEX") {
        alert("그 사이 목록이 바뀌어 삭제를 취소했습니다. 새로고침 후 다시 시도해 주세요.");
      } else {
        alert("삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      }
      void refreshHistory?.();
      return;
    }
    // 본문 삭제는 끝났는데 이력(사유) 기록만 실패한 경우 — 조용히 삼키면 "왜 지웠는지"가
    // 아무 데도 안 남는다. 사유 기록이 이 기능의 전제이므로 반드시 알린다(Codex 지적 2026-08-07).
    if (saved?.editLogFailed) {
      alert("삭제는 완료됐습니다. 다만 수정이력(사유) 기록에 실패했으니 본사에 알려 주세요.");
    }
    await refreshHistory?.();
  };

  return (
    <div className="branch-sheet-card animate-fade-in" id="card-expenses-subtab">
      {editCardExpense && (
        <AdminRecordEditModal
          title="카드지출 수정"
          fields={[
            { key: "amount", label: "지출 금액", value: editCardExpense.fields.amount, type: "number" },
            { key: "usage", label: "사용처", value: editCardExpense.fields.usage, options: withCurrent(EXPENSE_USAGES, editCardExpense.fields.usage) },
            { key: "classification", label: "분류 항목", value: editCardExpense.fields.classification, options: withCurrent(EXPENSE_CLASSIFICATIONS, editCardExpense.fields.classification) },
            { key: "detail", label: "지출내용", value: editCardExpense.fields.detail }
          ]}
          onChange={(key, value) => setEditCardExpense((current) => current ? { ...current, fields: { ...current.fields, [key]: value } } : current)}
          onCancel={() => setEditCardExpense(null)}
          onSave={() => void saveEditCardExpense()}
        />
      )}
      {/* 제목 밴드 = 지점 표준(DESIGN.md §6-3). 제목엔 글자만 — 아이콘 금지(§6-1). */}
      <div className="branch-band">
        <h3 className="branch-band-title">월 카드지출 일람표</h3>
        {monthPicker}
        {/* 사용처·분류항목 거르개도 밴드 안 필터 자리에 둔다(DESIGN.md §6-3).
            종전에는 카드 안쪽에 회색 상자로 따로 떠 있어 관리자 화면과 모양이 달랐다.
            모양(28px·11px·흰 알약)은 `.branch-band-filters` 가 정하므로 여기 적지 않는다. */}
        <div className="branch-band-filters">
          <select
            value={usageFilter}
            onChange={(e) => setUsageFilter(e.target.value)}
            aria-label="사용처 거르개"
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
            aria-label="분류항목 거르개"
          >
            {classificationOptions.map((option) => (
              <option key={option} value={option}>
                분류항목: {option}
              </option>
            ))}
          </select>
        </div>
        {/* 설명문은 삭제(사용자 지시 2026-08-04). 월 총계는 오른쪽 '표시 합계'가 대신한다
            (필터를 안 걸면 표시 합계 = 월 총계). */}

        {/* 필터 합계 + 쿠팡·네이버 결제액 — 오른쪽 끝(사용자 지시 2026-08-04 재조정).
            `.branch-band-actions` 가 margin-left:auto 로 밀어 준다. 칩(span) 모양은 손대지 않는다. */}
        <div className="branch-band-actions">
          {/* 지금 고른 조건의 합. 필터를 걸면 위 "월 카드지출 총계"와 나란히 놓여 전체 대비 얼마인지 보인다. */}
          <span
            className="text-[11px] font-black text-zinc-500"
            title={filterActive ? "지금 필터로 걸러진 내역의 합계입니다." : "필터를 걸지 않아 이 달 전체와 같습니다."}
          >
            {filterActive ? "필터 합계" : "표시 합계"}
            <b className="ml-1 font-mono text-xs text-zinc-900">{formatNumber(filteredSum)}</b>원
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

      {/* 한 달치가 통째로 늘어나 헤더가 스크롤 위로 사라졌다. 표 안에서만 스크롤하고 헤더는 붙여 둔다.
          [2026-08-04] 카드 안쪽 여백(p-4)과 표 테두리(rounded-2xl border)를 걷어냈다 — 카드가 이미
          테두리를 그리므로 상자가 겹쳐 보였다(현금관리 탭과 같은 모양으로, §9-1-A). */}
      <div className="max-h-[60vh] overflow-auto">
        {/* 머리글 모양(엘리스·11px·900·스크롤 고정)은 `.branch-sheet-head` 가 준다 — 색·굵기·테두리를 여기 적지 않는다(DESIGN.md §6-3-1). */}
        <table className="branch-sheet-head w-full text-left text-xs border-collapse font-sans whitespace-nowrap">
          <thead>
            <tr>
              <th className="w-[96px]">마감 일자</th>
              <th className="w-[72px]">결제 수단</th>
              <th className="text-right w-[104px]">지출 금액</th>
              <th>사용처 (가맹점)</th>
              <th>항목 (분류)</th>
              <th>지출내용 (세부)</th>
              <th>비고</th>
              <th>작성자</th>
              <th className="text-center">관리</th>
            </tr>
          </thead>
          <tbody className="sheet-rows-soft divide-y text-[11px]">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-20 text-center text-gray-400 font-bold">
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
                  <td className="py-2 px-2.5">
                    <div className="flex justify-center gap-1">
                      <button onClick={() => void handleEditCardExpense(it)} className="px-2 py-1 rounded-lg border border-blue-100 bg-blue-50 text-blue-700 text-[10px] font-black">수정</button>
                      {/* 삭제는 지점에도 개방(2026-08-07) — 카드결제 취소·반품 시 지점이 스스로 지운다. 지점은 사유 필수. */}
                      <button onClick={() => void handleDeleteCardExpense(it)} className="px-2 py-1 rounded-lg border border-rose-100 bg-rose-50 text-rose-700 text-[10px] font-black">삭제</button>
                    </div>
                  </td>
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
