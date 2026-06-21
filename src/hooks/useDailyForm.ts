// src/hooks/useDailyForm.ts
import { useState, useMemo, useEffect } from "react";
import { ExpenseDetail, StaffRecord, MasterDaily, DailySettleDetail } from "../api/gasClient";

export interface FormState {
  settleDate: string;
  cashSales: string; // 문자열 상태로 입력 핸들링 (쉼표 미포함된 순수 숫자 문자열)
  cardSales: string;
  transferSales: string;
  deliverySales: string;
  cashExpenses: { itemName: string; amount: string }[];
  cardExpenses: { itemName: string; amount: string }[];
  staff: { staffName: string; workHours: string }[];
  memo: string;
}

const getTodayDateString = () => {
  const local = new Date();
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function useDailyForm(initialData?: DailySettleDetail | null) {
  const [settleDate, setSettleDate] = useState<string>(getTodayDateString());
  const [cashSales, setCashSales] = useState<string>("");
  const [cardSales, setCardSales] = useState<string>("");
  const [transferSales, setTransferSales] = useState<string>("");
  const [deliverySales, setDeliverySales] = useState<string>("");

  const [cashExpenses, setCashExpenses] = useState<{ itemName: string; amount: string }[]>([
    { itemName: "", amount: "" }
  ]);
  const [cardExpenses, setCardExpenses] = useState<{ itemName: string; amount: string }[]>([
    { itemName: "", amount: "" }
  ]);

  const [staff, setStaff] = useState<{ staffName: string; workHours: string }[]>([]);
  const [memo, setMemo] = useState<string>("");

  // 기제출 데이터가 넘어왔을 때 채워주는 로직
  useEffect(() => {
    if (initialData) {
      const { master, expenses, staff: staffList } = initialData;
      setSettleDate(master.settleDate);
      setCashSales(String(master.cashSales || ""));
      setCardSales(String(master.cardSales || ""));
      setTransferSales(String(master.transferSales || ""));
      setDeliverySales(String(master.deliverySales || ""));
      setMemo(master.memo || "");

      const cashExps = expenses.filter(e => e.expenseType === "현금지출");
      const cardExps = expenses.filter(e => e.expenseType === "카드지출");

      setCashExpenses(
        cashExps.length > 0 
          ? cashExps.map(e => ({ itemName: e.itemName, amount: String(e.amount) }))
          : [{ itemName: "", amount: "" }]
      );
      
      setCardExpenses(
        cardExps.length > 0 
          ? cardExps.map(e => ({ itemName: e.itemName, amount: String(e.amount) }))
          : [{ itemName: "", amount: "" }]
      );

      setStaff(
        staffList.map(s => ({ staffName: s.staffName, workHours: String(s.workHours) }))
      );
    }
  }, [initialData]);

  // 실시간 총 매출 합계 계산
  const totalSales = useMemo(() => {
    const cash = parseFloat(cashSales) || 0;
    const card = parseFloat(cardSales) || 0;
    const transfer = parseFloat(transferSales) || 0;
    const delivery = parseFloat(deliverySales) || 0;
    return cash + card + transfer + delivery;
  }, [cashSales, cardSales, transferSales, deliverySales]);

  // 필수 항목들의 입력 완료 계산율 (현금 매출, 카드 매출)
  const progressRatio = useMemo(() => {
    let completed = 0;
    const totalRequired = 2; // cash과 card
    if (cashSales.trim() !== "") completed += 1;
    if (cardSales.trim() !== "") completed += 1;
    return Math.round((completed / totalRequired) * 100);
  }, [cashSales, cardSales]);

  // 동적 현금 지출 제어
  const addCashExpense = () => {
    setCashExpenses(prev => [...prev, { itemName: "", amount: "" }]);
  };

  const removeCashExpense = (index: number) => {
    setCashExpenses(prev => {
      const updated = prev.filter((_, i) => i !== index);
      return updated.length === 0 ? [{ itemName: "", amount: "" }] : updated;
    });
  };

  const updateCashExpense = (index: number, field: "itemName" | "amount", value: string) => {
    setCashExpenses(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  // 동적 카드 지출 제어
  const addCardExpense = () => {
    setCardExpenses(prev => [...prev, { itemName: "", amount: "" }]);
  };

  const removeCardExpense = (index: number) => {
    setCardExpenses(prev => {
      const updated = prev.filter((_, i) => i !== index);
      return updated.length === 0 ? [{ itemName: "", amount: "" }] : updated;
    });
  };

  const updateCardExpense = (index: number, field: "itemName" | "amount", value: string) => {
    setCardExpenses(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  // 동적 직원 근무시간 기록 제어
  const addStaff = () => {
    setStaff(prev => [...prev, { staffName: "", workHours: "" }]);
  };

  const removeStaff = (index: number) => {
    setStaff(prev => prev.filter((_, i) => i !== index));
  };

  const updateStaff = (index: number, field: "staffName" | "workHours", value: string) => {
    setStaff(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  // 폼 초기화
  const resetForm = () => {
    setSettleDate(getTodayDateString());
    setCashSales("");
    setCardSales("");
    setTransferSales("");
    setDeliverySales("");
    setCashExpenses([{ itemName: "", amount: "" }]);
    setCardExpenses([{ itemName: "", amount: "" }]);
    setStaff([]);
    setMemo("");
  };

  // 마스터 객체 & 최종 제출용 데이터 가공
  const getSubmissionPayload = (branchName: string, pinHash: string) => {
    const formattedExpenses: ExpenseDetail[] = [
      ...cashExpenses
        .filter(e => e.itemName.trim() !== "" && e.amount.trim() !== "")
        .map(e => ({
          expenseType: "현금지출" as const,
          itemName: e.itemName.trim(),
          amount: parseFloat(e.amount) || 0
        })),
      ...cardExpenses
        .filter(e => e.itemName.trim() !== "" && e.amount.trim() !== "")
        .map(e => ({
          expenseType: "카드지출" as const,
          itemName: e.itemName.trim(),
          amount: parseFloat(e.amount) || 0
        }))
    ];

    const formattedStaff: StaffRecord[] = staff
      .filter(s => s.staffName.trim() !== "" && s.workHours.trim() !== "")
      .map(s => ({
        staffName: s.staffName.trim(),
        workHours: parseFloat(s.workHours) || 0
      }));

    const master: MasterDaily = {
      branchName,
      settleDate,
      cashSales: parseFloat(cashSales) || 0,
      cardSales: parseFloat(cardSales) || 0,
      transferSales: parseFloat(transferSales) || 0,
      deliverySales: parseFloat(deliverySales) || 0,
      memo: memo.substring(0, 500),
      submittedBy: pinHash
    };

    return { master, expenses: formattedExpenses, staff: formattedStaff };
  };

  return {
    settleDate,
    setSettleDate,
    cashSales,
    setCashSales,
    cardSales,
    setCardSales,
    transferSales,
    setTransferSales,
    deliverySales,
    setDeliverySales,
    totalSales,
    progressRatio,
    
    cashExpenses,
    addCashExpense,
    removeCashExpense,
    updateCashExpense,

    cardExpenses,
    addCardExpense,
    removeCardExpense,
    updateCardExpense,

    staff,
    addStaff,
    removeStaff,
    updateStaff,

    memo,
    setMemo,
    resetForm,
    getSubmissionPayload
  };
}
