// src/pages/branch/tabs/MonthlySettleTab.tsx  (BranchConfirmPage에서 분리 — 동작 변경 없음)
import { useState, useEffect, useMemo, useCallback } from "react";
import { AlertTriangle, CheckCircle2, Coins, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import LoadingSpinner from "../../../components/LoadingSpinner";
import { addMonthsToMonthInputValue } from "../helpers/formatters";
import { isSampleEmployee } from "../helpers/staffHelpers";
import { MonthlyPurchaseSalesSubTab } from "./MonthlyPurchaseSalesSubTab";
import { MonthlyPartTimeSalarySubTab } from "./MonthlyPartTimeSalarySubTab";
import { MonthlyCashExpensesSubTab } from "./MonthlyCashExpensesSubTab";
import { MonthlyCashManagementSubTab } from "./MonthlyCashManagementSubTab";
import { MonthlyCardExpensesSubTab } from "./MonthlyCardExpensesSubTab";

interface MonthlySettleTabProps {
  branchName: string;
  activeSubTab: "purchaseSales" | "partTimeSalary" | "cashExpenses" | "cashManagement" | "cardExpenses";
  isAdmin?: boolean;
}

export function MonthlySettleTab({ branchName, activeSubTab, isAdmin = false }: MonthlySettleTabProps) {
  const [adminSettings, setAdminSettings] = useState(() => {
    const saved = localStorage.getItem("erp_admin_settings");
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return {
      logoUrl: "",
      dailyAccentColor: "#2E6DB4",
      monthlyAccentColor: "#4F46E5",
      sidebarBgDaily: "#09090b",
      sidebarBgMonthly: "#1E1B4B",
      dailyPortalText: "실시간 마감 포탈 업무중",
      monthlyReportText: "월말 마감 결산 포탈",
      monthlyReportDesc: "가맹점의 월간 매입매출 상황, 근무일지 기반 아르바이트 급여 정산, 그리고 일일 시재 및 현금·카드 지출을 한눈에 결합 정산합니다.",
      excelFilenamePattern: "yymm_지점명_월말마감_m월",
      excelHeaderColorFill: "#E2E8F0",
      moneyFormatSuffix: "원",
      salaryTaxRate: "3.3%",
    };
  });

  useEffect(() => {
    const handleUpdate = () => {
      const saved = localStorage.getItem("erp_admin_settings");
      if (saved) {
        try { setAdminSettings(JSON.parse(saved)); } catch {}
      }
    };
    window.addEventListener("admin_settings_updated", handleUpdate);
    return () => window.removeEventListener("admin_settings_updated", handleUpdate);
  }, []);

  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  });

  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [monthlyCloseStatus, setMonthlyCloseStatus] = useState<any | null>(null);
  const [monthlyCloseRecords, setMonthlyCloseRecords] = useState<any[]>([]);
  const [purchaseResetToken, setPurchaseResetToken] = useState(0);

  const triggerToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      const h = await gasClient.getBranchHistory(branchName, selectedMonth);
      setHistory(h || []);
    } catch (e) {
      console.error("월말 정산용 이력 가져오기 실패:", e);
    } finally {
      setLoading(false);
    }
  }, [branchName, selectedMonth]);

  const fetchMonthlyCloseStatus = useCallback(async () => {
    try {
      const records = await gasClient.getSharedData<any[]>("monthly_closings");
      setMonthlyCloseRecords(Array.isArray(records) ? records : []);
      const current = Array.isArray(records)
        ? records
            .filter((record) => record.branchName === branchName && record.month === selectedMonth)
            .sort((a, b) => String(b.updatedAt || b.confirmedAt || "").localeCompare(String(a.updatedAt || a.confirmedAt || "")))[0]
        : null;
      setMonthlyCloseStatus(current || null);
    } catch (error) {
      console.warn("월말마감 상태를 불러오지 못했습니다.", error);
    }
  }, [branchName, selectedMonth]);

  const saveMonthlyCloseStatus = useCallback(async (status: "confirmed" | "editing" | "pending") => {
    const previous = await gasClient.getSharedData<any[]>("monthly_closings");
    const list = Array.isArray(previous) ? previous : [];
    const now = new Date().toISOString();
    const current = list.find((record) => record.branchName === branchName && record.month === selectedMonth);
    const nextRecord = {
      id: `${branchName}-${selectedMonth}`,
      branchName,
      month: selectedMonth,
      status,
      writer: branchName,
      confirmedAt: status === "confirmed" ? now : current?.confirmedAt || "",
      updatedAt: now
    };
    const next = [nextRecord, ...list.filter((record) => !(record.branchName === branchName && record.month === selectedMonth))];
    await gasClient.saveSharedData("monthly_closings", next);
    setMonthlyCloseRecords(next);
    setMonthlyCloseStatus(nextRecord);
    return nextRecord;
  }, [branchName, selectedMonth]);

  const confirmedCloseMonths = useMemo(() => {
    return Array.from(new Set<string>(
      monthlyCloseRecords
        .filter((record) => record.branchName === branchName && record.status === "confirmed" && record.month)
        .map((record) => String(record.month))
    )).sort((a, b) => b.localeCompare(a));
  }, [branchName, monthlyCloseRecords]);

  const handleDownloadExcel = useCallback(async () => {
    try {
      const XLSX = await import("xlsx-js-style");
      const wb = XLSX.utils.book_new();

      // 1. 매입매출 대장
      let psRows: any[] = [];
      try {
        const saved = localStorage.getItem(`erp_monthly_purchases_${branchName}_${selectedMonth}`);
        if (saved) {
          psRows = JSON.parse(saved);
        } else {
          psRows = [
            { category: "식재료비", vendorName: "주식회사 식자재창고", transferAmount: "1250000", bank: "국민은행", accountNumber: "123-456-789012", isPrepaid: false, prepaidChargeAmount: "", monthlyUsageAmount: "1250000", memo: "일반 후불 외상 결제" },
            { category: "식음료외 기타", vendorName: "드림 물류 (선입금 업체)", transferAmount: "0", bank: "신한은행", accountNumber: "987-654-321098", isPrepaid: true, prepaidChargeAmount: "0", monthlyUsageAmount: "450000", memo: "매월 선충전 후 발주금액 차감 방식" }
          ];
        }
      } catch {}
      try {
        const remotePurchases = await gasClient.getSharedData<any[]>(`monthly_purchases:${branchName}:${selectedMonth}`);
        if (Array.isArray(remotePurchases) && remotePurchases.length > 0) {
          psRows = remotePurchases;
          localStorage.setItem(`erp_monthly_purchases_${branchName}_${selectedMonth}`, JSON.stringify(remotePurchases));
        }
      } catch (error) {
        console.warn("월 매입매출 공통 데이터를 엑셀 다운로드에 반영하지 못했습니다.", error);
      }
      const psData = psRows.map(r => ({
        "분류항목": r.category,
        "송금/사용 대상업체명": r.vendorName,
        "선입금 충전방식?": r.isPrepaid ? "선입금" : "후불이체",
        "_선입금여부": Boolean(r.isPrepaid),
        "이체필요 금액 (원)": Number(r.transferAmount) || 0,
        "충전금액 (원)": Number(r.prepaidChargeAmount) || 0,
        "실제 이달사용액 (원)": Number(r.monthlyUsageAmount) || 0,
        "은행": r.bank,
        "계좌번호": r.accountNumber,
        "거래 비고 고지": r.memo
      }));

      // 2. 파트타이머 급여대장
      let rosterPartTimers: any[] = [];
      try {
        const savedRoster = localStorage.getItem(`erp_staff_list_${branchName}`);
        if (savedRoster) {
          rosterPartTimers = JSON.parse(savedRoster).filter((emp: any) => emp.division === "파트타이머" && !isSampleEmployee(emp));
        }
      } catch {}
      try {
        const remoteRoster = await gasClient.getBranchOwnRoster(branchName);
        const remotePartTimers = remoteRoster.filter((emp: any) => emp.division === "파트타이머" && !isSampleEmployee(emp));
        if (remotePartTimers.length > 0) {
          rosterPartTimers = remotePartTimers;
          localStorage.setItem(`erp_staff_list_${branchName}`, JSON.stringify(remoteRoster.filter((emp: any) => !isSampleEmployee(emp))));
        }
      } catch (error) {
        console.warn("공통 직원현황을 엑셀 다운로드에 반영하지 못했습니다.", error);
      }

      const ptTelemetry: { [name: string]: { hours: number; dates: string[] } } = {};
      history.forEach((m) => {
        if (m.settleDate && m.settleDate.startsWith(selectedMonth)) {
          const parts = (m.memo || "").split("\n---\nMETADATA:");
          if (parts[1]) {
            try {
              const meta = JSON.parse(parts[1].trim());
              if (meta && meta.staffRows) {
                meta.staffRows.forEach((s: any) => {
                  if (s.division === "파트타이머" && Number(s.workHours || 0) > 0) {
                    if (!ptTelemetry[s.name]) {
                      ptTelemetry[s.name] = { hours: 0, dates: [] };
                    }
                    ptTelemetry[s.name].hours += Number(s.workHours || 0);
                    const dateParts = m.settleDate.split("-");
                    const daySuffix = dateParts[2] ? `${Number(dateParts[2])}` : m.settleDate;
                    if (!ptTelemetry[s.name].dates.includes(daySuffix)) {
                      ptTelemetry[s.name].dates.push(daySuffix);
                    }
                  }
                });
              }
            } catch {}
          }
        }
      });

      let savedSalaryMap: { [empId: string]: any } = {};
      try {
        const savedConfig = localStorage.getItem(`erp_monthly_part_time_salary_${branchName}_${selectedMonth}`);
        if (savedConfig) {
          JSON.parse(savedConfig).forEach((item: any) => {
            savedSalaryMap[item.employeeId] = item;
          });
        }
      } catch {}
      try {
        const remoteSalaries = await gasClient.getSharedData<any[]>(`part_time_salaries:${branchName}:${selectedMonth}`);
        if (Array.isArray(remoteSalaries) && remoteSalaries.length > 0) {
          savedSalaryMap = {};
          remoteSalaries.forEach((item: any) => {
            savedSalaryMap[item.employeeId] = item;
          });
          localStorage.setItem(`erp_monthly_part_time_salary_${branchName}_${selectedMonth}`, JSON.stringify(remoteSalaries));
        }
      } catch (error) {
        console.warn("파트타이머 급여 공통 데이터를 엑셀 다운로드에 반영하지 못했습니다.", error);
      }

      let excludedEmployeeIdsForExcel: string[] = [];
      try {
        const localExcluded = localStorage.getItem(`erp_part_time_salary_exclusions_${branchName}_${selectedMonth}`);
        if (localExcluded) excludedEmployeeIdsForExcel = JSON.parse(localExcluded);
        const remoteExcluded = await gasClient.getSharedData<string[]>(`part_time_salary_exclusions:${branchName}:${selectedMonth}`);
        if (Array.isArray(remoteExcluded)) excludedEmployeeIdsForExcel = remoteExcluded;
      } catch {}

      let sharedProfiles: Record<string, any> = {};
      try {
        const remoteProfiles = await gasClient.getSharedData<Record<string, any>>(`part_time_profiles:${branchName}`);
        if (remoteProfiles) sharedProfiles = remoteProfiles;
      } catch (error) {
        console.warn("파트타이머 프로필 공통 데이터를 엑셀 다운로드에 반영하지 못했습니다.", error);
      }

      const knownPartTimerIds = new Set(rosterPartTimers.map((pt) => pt.id));
      Object.values(savedSalaryMap).forEach((salary: any) => {
        if (salary?.employeeId && !knownPartTimerIds.has(salary.employeeId)) {
          rosterPartTimers.push({
            id: salary.employeeId,
            name: salary.name || salary.staffName || salary.employeeName || salary.employeeId,
            division: "파트타이머"
          });
          knownPartTimerIds.add(salary.employeeId);
        }
      });
      Object.keys(ptTelemetry).forEach((name) => {
        if (!rosterPartTimers.some((pt) => pt.name === name)) {
          rosterPartTimers.push({ id: `legacy-${branchName}-${name}`, name, division: "파트타이머" });
        }
      });
      const excludedSetForExcel = new Set(excludedEmployeeIdsForExcel);

      const getStoredProfile = (empId: string): any => {
        if (sharedProfiles[empId]) return sharedProfiles[empId];
        try {
          const stored = localStorage.getItem(`erp_pt_profile_${branchName}_${empId}`);
          if (stored) return JSON.parse(stored);
        } catch {}
        return {};
      };

      const ptData = rosterPartTimers.filter((pt) => !excludedSetForExcel.has(pt.id)).map((pt) => {
        const tel = ptTelemetry[pt.name] || { hours: 0, dates: [] };
        const saved = savedSalaryMap[pt.id] || {};
        const profile = getStoredProfile(pt.id);

        const hourlyRate = saved.hourlyRate || profile.hourlyRate || "15000";
        const accumulatedHours = saved.accumulatedHours !== undefined ? saved.accumulatedHours : String(tel.hours);
        const tipsEtcAmount = saved.tipsEtcAmount || "0";
        const calcSalary = saved.calculatedSalary !== undefined && saved.calculatedSalary !== ""
          ? saved.calculatedSalary
          : String((Number(hourlyRate) * Number(accumulatedHours)) + (Number(tipsEtcAmount) || 0));
        const calcActualPaid = saved.actualPaidAmount || "";
        const attendanceDates = saved.attendanceDates !== undefined
          ? saved.attendanceDates
          : tel.dates.sort((a,b) => Number(a) - Number(b)).slice(0, 7).join(",");

        return {
          "성명 (사원)": pt.name,
          "주민등록번호": saved.residentNumber || profile.residentNumber || "",
          "입사일자": saved.entryDate || profile.entryDate || "",
          "근로계약": saved.contractStatus || profile.contractStatus || "미작성",
          "은행": saved.bank || profile.bank || "",
          "입금 계좌번호": saved.accountNumber || profile.accountNumber || "",
          "시급 (원)": Number(hourlyRate) || 0,
          "누적시간": Number(accumulatedHours) || 0,
          "팁/기타": Number(tipsEtcAmount) || 0,
          "기본급여": Number(calcSalary) || 0,
          "근무일정 (출근일)": attendanceDates,
          "실수령액 (송금)": calcActualPaid ? (Number(calcActualPaid) || "") : "",
          "실제 송금지점": saved.payoutBranch || branchName,
          "기타 비고 내용 (퇴사일 등)": saved.memo || ""
        };
      });

      // 3. 현금지출 일람 (cashExpenses)
      const cashList: any[] = [];
      history.forEach((m) => {
        if (m.settleDate && m.settleDate.startsWith(selectedMonth)) {
          const parts = (m.memo || "").split("\n---\nMETADATA:");
          if (parts[1]) {
            try {
              const meta = JSON.parse(parts[1].trim());
              if (meta && meta.cashExpenses) {
                meta.cashExpenses.forEach((exp: any) => {
                  const itemAmount = Number(exp.amount) || 0;
                  if (itemAmount > 0) {
                    cashList.push({
                      "마감 일자": m.settleDate,
                      "결제 수단": "현금",
                      "지출 금액": itemAmount,
                      "거래처 (사용처)": exp.usage || "공란",
                      "분류 항목": exp.classification || "미분류",
                      "지출내용 (세부)": exp.detail || "",
                      "비고": "확인완료",
                      "작성자": m.submittedBy || m.submitted_by || (m as any).writer || "미상",
                      "입력 시각": m.submittedAt ? new Date(m.submittedAt).toISOString() : "",
                      "_마감원본": m.settleDate
                    });
                  }
                });
              }
            } catch {}
          }
        }
      });
      cashList.sort((a,b) => a["마감 일자"].localeCompare(b["마감 일자"]));

      // 4. 현금관리 집계 (cashManagement)
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
            "마감 일자": m.settleDate,
            "전일 금고현금": prevVal,
            "금일 현금매출": salesVal,
            "현금지출 합계": expensesVal,
            "이론상 잔액 (원)": theoryVal,
            "금고 실사 현금 (원)": vaultVal,
            "차액 (불일치)": difference,
            "계좌이체": Number(m.transferSales) || 0,
            "대조 불일치 사유 소명": metaParsed.cashDiffReason || "",
            "점검 작성자": m.submittedBy || m.submitted_by || (m as any).writer || "매니저",
            "_입력원본": m.submittedAt || "",
            "_마감원본": m.settleDate
          });
        }
      });
      cashMgmt.sort((a,b) => a["마감 일자"].localeCompare(b["마감 일자"]));

      // 5. 카드지출 일람 (cardExpenses)
      const cardList: any[] = [];
      history.forEach((m) => {
        if (m.settleDate && m.settleDate.startsWith(selectedMonth)) {
          const parts = (m.memo || "").split("\n---\nMETADATA:");
          if (parts[1]) {
            try {
              const meta = JSON.parse(parts[1].trim());
              if (meta && meta.cardExpenses) {
                meta.cardExpenses.forEach((exp: any) => {
                  const itemAmount = Number(exp.amount) || 0;
                  if (itemAmount > 0) {
                    cardList.push({
                      "마감 일자": m.settleDate,
                      "결제 수단": "카드",
                      "지출 금액": itemAmount,
                      "사용처 (가맹점)": exp.usage || "공란",
                      "항목 (분류)": exp.classification || "미분류",
                      "지출내용 (세부)": exp.detail || "",
                      "비고": "확인증빙필",
                      "작성자": m.submittedBy || m.submitted_by || (m as any).writer || "매니저",
                      "_입력원본": m.submittedAt || "",
                      "_마감원본": m.settleDate
                    });
                  }
                });
              }
            } catch {}
          }
        }
      });
      cardList.sort((a,b) => a["마감 일자"].localeCompare(b["마감 일자"]));

      const [year, month] = selectedMonth.split("-");
      const monthNumber = Number(month);
      const formatDate = (value: string) => {
        const match = String(value || "").match(/(\d{4})-(\d{2})-(\d{2})/);
        return match ? `${match[1]}. ${Number(match[2])}. ${Number(match[3])}` : "";
      };
      const formatCardDate = (value: string) => {
        const match = String(value || "").match(/\d{4}-(\d{2})-(\d{2})/);
        return match ? `${Number(match[1])} . ${Number(match[2])}` : "";
      };
      const formatInputDate = (value: string, fallback: string) => {
        const parsed = value ? new Date(value) : null;
        return parsed && !Number.isNaN(parsed.getTime())
          ? `${parsed.getFullYear()}. ${parsed.getMonth() + 1}. ${parsed.getDate()}`
          : formatDate(fallback);
      };

      const headerStyle = {
        font: { bold: true, sz: 10, color: { rgb: "1F2937" } },
        fill: { patternType: "solid", fgColor: { rgb: "F1C232" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: false },
        border: { top: { style: "thin", color: { rgb: "B08A00" } }, bottom: { style: "thin", color: { rgb: "B08A00" } }, left: { style: "thin", color: { rgb: "B08A00" } }, right: { style: "thin", color: { rgb: "B08A00" } } }
      };
      const titleStyle = { font: { bold: true, sz: 10, color: { rgb: "17365D" } }, alignment: { vertical: "center" } };
      const bodyBorder = { top: { style: "thin", color: { rgb: "D9E2F3" } }, bottom: { style: "thin", color: { rgb: "D9E2F3" } }, left: { style: "thin", color: { rgb: "D9E2F3" } }, right: { style: "thin", color: { rgb: "D9E2F3" } } };

      const makeSheet = (headers: string[], rows: any[][], widths: number[], includeTitle: boolean, numericColumns: number[] = [], textColumns: number[] = []) => {
        const source = includeTitle
          ? [[branchName, "", "", monthNumber, "월"], headers, ...rows]
          : [headers, ...rows];
        const sheet = XLSX.utils.aoa_to_sheet(source);
        const headerRow = includeTitle ? 1 : 0;
        sheet["!cols"] = widths.map((wch) => ({ wch }));
        sheet["!rows"] = source.map((_, index) => ({ hpt: includeTitle && index === 0 ? 24 : index === headerRow ? 20 : 17 }));
        for (let col = 0; col < headers.length; col++) {
          const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c: col })];
          if (cell) cell.s = headerStyle;
        }
        if (includeTitle) {
          [0, 3, 4].forEach((col) => {
            const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: col })];
            if (cell) cell.s = titleStyle;
          });
        }
        for (let row = headerRow + 1; row < source.length; row++) {
          for (let col = 0; col < headers.length; col++) {
            const address = XLSX.utils.encode_cell({ r: row, c: col });
            const cell = sheet[address];
            if (!cell) continue;
            cell.s = { font: { sz: 10 }, border: bodyBorder, alignment: { vertical: "center", wrapText: col === headers.length - 1 } };
            if (numericColumns.includes(col)) cell.z = "#,##0";
            if (textColumns.includes(col)) cell.z = "@";
          }
        }
        return sheet;
      };

      // 기준 파일의 시트명, 제목행, 헤더 순서와 열 폭을 그대로 사용합니다.
      const purchaseHeaders = ["매출항목", "업체명", "이체 필요금액", "은행", "계좌번호", "기타내용", "이달사용금액", "오류"];
      const purchaseRows = psData.map((row) => [row["분류항목"], row["송금/사용 대상업체명"], row["이체필요 금액 (원)"], row["은행"], row["계좌번호"], row["거래 비고 고지"], row["_선입금여부"] ? row["실제 이달사용액 (원)"] : "", ""]);
      const psWS = makeSheet(purchaseHeaders, purchaseRows, [17.17, 14, 12.17, 13.33, 40.83, 60.17, 14.83, 10.33], true, [2, 6], [4]);

      const partTimeHeaders = ["성명(입사일)", "주민등록번호", "입사일", "근로계약", "은행", "입금계좌", "시급", "누적시간", "팁/기타", "급여", "출근날짜", "실수령액(송금액)", "실제 송금지점", "기타내용(퇴사일 및 퇴직금등)"];
      const partTimeRows = ptData.map((row) => [row["성명 (사원)"], row["주민등록번호"], row["입사일자"], row["근로계약"], row["은행"], row["입금 계좌번호"], row["시급 (원)"], row["누적시간"], row["팁/기타"], row["기본급여"], row["근무일정 (출근일)"], row["실수령액 (송금)"], row["실제 송금지점"], row["기타 비고 내용 (퇴사일 등)"]]);
      const ptWS = makeSheet(partTimeHeaders, partTimeRows, [11.57, 15.86, 9.2, 8.21, 5.14, 19.64, 10.71, 7.2, 9.29, 9.29, 24.14, 10.21, 10.21, 41.43], true, [6, 7, 8, 9, 11], [1, 5]);

      const expenseHeaders = ["마감일자", "결제수단", "금액", "사용처(거래처)", "항목", "지출내용(세부)", "비고", "작성자", "입력시각", "마감키"];
      const cashRows = cashList.map((row) => {
        const date = String(row["_마감원본"] || row["마감 일자"] || "");
        const writer = String(row["작성자"] || "");
        return [formatDate(date), "현금", row["지출 금액"], row["거래처 (사용처)"], row["분류 항목"], row["지출내용 (세부)"], row["비고"] === "확인완료" ? "" : row["비고"], writer, formatInputDate(row["입력 시각"], date), `${date}|${writer}`];
      });
      const cashWS = makeSheet(expenseHeaders, cashRows, [11.3, 6.8, 16.4, 11.3, 24.8, 11.9, 6.8, 10.2, 11, 28.8], false, [2]);

      const cashManagementHeaders = ["마감일자", "전일현금", "현금매출", "현금지출", "현금잔액", "실사현금", "차이", "계좌이체", "비고", "작성자", "입력시각"];
      const mgmtRows = cashMgmt.map((row) => {
        const date = String(row["_마감원본"] || row["마감 일자"] || "");
        const writer = String(row["점검 작성자"] || "");
        return [formatDate(date), row["전일 금고현금"], row["금일 현금매출"], row["현금지출 합계"], row["이론상 잔액 (원)"], row["금고 실사 현금 (원)"], row["차액 (불일치)"], row["계좌이체"], row["대조 불일치 사유 소명"], writer, formatInputDate(row["_입력원본"], date)];
      });
      const mgmtWS = makeSheet(cashManagementHeaders, mgmtRows, [10.08, 10.08, 10.08, 10.08, 10.08, 10.08, 10.08, 10.08, 23.23, 10.08, 10.08], false, [1, 2, 3, 4, 5, 6, 7]);

      const cardRows = cardList.map((row) => {
        const date = String(row["_마감원본"] || row["마감 일자"] || "");
        const writer = String(row["작성자"] || "");
        return [formatCardDate(date), "카드", row["지출 금액"], row["사용처 (가맹점)"], row["항목 (분류)"], row["지출내용 (세부)"], row["비고"] === "확인증빙필" ? "" : row["비고"], writer, formatInputDate(row["_입력원본"], date), `${date}|${writer}`];
      });
      const cardWS = makeSheet(expenseHeaders, cardRows, [11.3, 6.8, 16.4, 18.8, 24.8, 13.3, 6.8, 6.8, 9.9, 23.5], false, [2]);

      XLSX.utils.book_append_sheet(wb, psWS, "매입매출");
      XLSX.utils.book_append_sheet(wb, ptWS, "파트타이머급여");
      XLSX.utils.book_append_sheet(wb, cashWS, "현금지출");
      XLSX.utils.book_append_sheet(wb, cardWS, "카드지출");
      XLSX.utils.book_append_sheet(wb, mgmtWS, "현금관리");

      const fileName = `월말정산_${branchName}${monthNumber}월_결산자료.xlsx`;

      XLSX.writeFile(wb, fileName);
      triggerToast("엑셀 파일 다운로드 성공!", "success");
    } catch (err: any) {
      console.error(err);
      triggerToast("엑셀 생성 오류: " + err.message, "error");
    }
  }, [branchName, selectedMonth, history, triggerToast, adminSettings]);

  const carryMonthlyPurchasesToNextMonth = useCallback(async () => {
    const nextMonth = addMonthsToMonthInputValue(selectedMonth, 1);
    const nextKey = `monthly_purchases:${branchName}:${nextMonth}`;
    const nextLocalKey = `erp_monthly_purchases_${branchName}_${nextMonth}`;
    try {
      const existingRemote = await gasClient.getSharedData<any[]>(nextKey);
      if (Array.isArray(existingRemote) && existingRemote.length > 0) return;
    } catch {}
    try {
      const existingLocal = localStorage.getItem(nextLocalKey);
      if (existingLocal && JSON.parse(existingLocal).length > 0) return;
    } catch {}

    let currentRows: any[] = [];
    try {
      const currentLocal = localStorage.getItem(`erp_monthly_purchases_${branchName}_${selectedMonth}`);
      if (currentLocal) currentRows = JSON.parse(currentLocal);
    } catch {}
    if (currentRows.length === 0) {
      try {
        const remote = await gasClient.getSharedData<any[]>(`monthly_purchases:${branchName}:${selectedMonth}`);
        if (Array.isArray(remote)) currentRows = remote;
      } catch {}
    }
    if (currentRows.length === 0) return;

    const carriedRows = currentRows.map((row) => ({
      ...row,
      id: `p_${nextMonth}_${row.id || Date.now()}`,
      transferAmount: "",
      prepaidChargeAmount: "",
      monthlyUsageAmount: ""
    }));
    localStorage.setItem(nextLocalKey, JSON.stringify(carriedRows));
    await gasClient.saveSharedData(nextKey, carriedRows);
  }, [branchName, selectedMonth]);

  const handleConfirmMonthlyClose = useCallback(async () => {
    try {
      await carryMonthlyPurchasesToNextMonth();
      await saveMonthlyCloseStatus("confirmed");
      triggerToast(`${selectedMonth} 월말마감이 확정되었습니다.`, "success");
      if (window.confirm("월말마감이 확정되었습니다. 결산자료 엑셀을 다운로드할까요?")) {
        await handleDownloadExcel();
      }
    } catch (error: any) {
      console.error(error);
      triggerToast(error?.message || "월말마감 확정 저장에 실패했습니다.", "error");
    }
  }, [carryMonthlyPurchasesToNextMonth, handleDownloadExcel, saveMonthlyCloseStatus, selectedMonth, triggerToast]);

  const handleEditMonthlyClose = useCallback(async () => {
    try {
      await saveMonthlyCloseStatus("editing");
      triggerToast(`${selectedMonth} 월말마감이 수정중 상태로 변경되었습니다.`, "success");
    } catch (error: any) {
      console.error(error);
      triggerToast(error?.message || "월말마감 수정 상태 저장에 실패했습니다.", "error");
    }
  }, [saveMonthlyCloseStatus, selectedMonth, triggerToast]);

  const resetMonthlyPurchaseAmounts = useCallback(async () => {
    let purchaseRows: any[] = [];
    try {
      const remote = await gasClient.getSharedData<any[]>(`monthly_purchases:${branchName}:${selectedMonth}`);
      if (Array.isArray(remote)) purchaseRows = remote;
    } catch {}
    if (purchaseRows.length === 0) {
      try {
        const saved = localStorage.getItem(`erp_monthly_purchases_${branchName}_${selectedMonth}`);
        if (saved) purchaseRows = JSON.parse(saved);
      } catch {}
    }
    if (purchaseRows.length === 0) return;
    const resetRows = purchaseRows.map((row) => ({
      ...row,
      transferAmount: "",
      prepaidChargeAmount: "",
      monthlyUsageAmount: ""
    }));
    localStorage.setItem(`erp_monthly_purchases_${branchName}_${selectedMonth}`, JSON.stringify(resetRows));
    await gasClient.saveSharedData(`monthly_purchases:${branchName}:${selectedMonth}`, resetRows);
  }, [branchName, selectedMonth]);

  const handleCancelMonthlyClose = useCallback(async () => {
    if (!window.confirm("월말마감을 취소하고 거래처 금액 입력값만 초기화할까요?\n거래처명, 은행, 계좌, 기타내용은 유지됩니다.")) return;
    try {
      await saveMonthlyCloseStatus("pending");
      await resetMonthlyPurchaseAmounts();
      setPurchaseResetToken((value) => value + 1);
      triggerToast(`${selectedMonth} 월말마감이 취소되었고 거래처 금액이 초기화되었습니다.`, "success");
    } catch (error: any) {
      console.error(error);
      triggerToast(error?.message || "월말마감 취소에 실패했습니다.", "error");
    }
  }, [resetMonthlyPurchaseAmounts, saveMonthlyCloseStatus, selectedMonth, triggerToast]);

  const handleCancelMonthlyEdit = useCallback(async () => {
    try {
      await saveMonthlyCloseStatus("confirmed");
      triggerToast(`${selectedMonth} 월말마감 수정이 취소되고 확정 상태로 돌아갔습니다.`, "success");
    } catch (error: any) {
      console.error(error);
      triggerToast(error?.message || "월말마감 수정 취소에 실패했습니다.", "error");
    }
  }, [saveMonthlyCloseStatus, selectedMonth, triggerToast]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    void fetchMonthlyCloseStatus();
  }, [fetchMonthlyCloseStatus]);

  return (
    <div className="space-y-6 animate-fade-in" id="monthly-settle-tab-root">
      {/* Toast Alert overlay */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-fade-in">
          <div className={`px-5 py-3.5 rounded-2xl border text-xs font-bold shadow-xl flex items-center gap-2.5 ${
            toast.type === "success"
              ? "bg-emerald-50 border-emerald-100 text-emerald-800"
              : "bg-rose-50 border-rose-100 text-rose-800"
          }`}>
            {toast.type === "success" ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <AlertTriangle className="w-4 h-4 text-rose-500" />}
            {toast.message}
          </div>
        </div>
      )}

      {/* Month Selector Header */}
      <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-black text-zinc-900 flex items-center gap-2">
            <Coins className="w-5 h-5" style={{ color: adminSettings.monthlyAccentColor }} />
            {adminSettings.monthlyReportText}
          </h2>
          <p className="text-[10px] text-gray-400 font-bold">
            {adminSettings.monthlyReportDesc}
          </p>
        </div>

        {activeSubTab === "purchaseSales" && (
          <div className="flex flex-col items-end gap-2 w-full md:w-auto self-end md:self-auto">
            <div className="flex flex-wrap items-center gap-3 justify-end">
              <span className="text-xs font-black text-gray-500 whitespace-nowrap">결산월 선택:</span>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                style={{ color: adminSettings.monthlyAccentColor }}
                className="p-2 bg-zinc-50 hover:bg-zinc-100/50 border border-gray-200 text-xs font-extrabold rounded-xl shadow-inner focus:outline-none cursor-pointer"
              />
              <button
                onClick={fetchHistory}
                className="monthly-action-refresh p-2 px-3.5 bg-zinc-900 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all hover:bg-zinc-850 cursor-pointer shadow-subtle"
              >
                <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
                이력 갱신
              </button>
              <button
                onClick={handleConfirmMonthlyClose}
                className="monthly-action-confirm p-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-subtle"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-200" />
                월말마감 확정
              </button>
              {monthlyCloseStatus?.status === "editing" ? (
              <button
                onClick={handleCancelMonthlyEdit}
                className="monthly-action-edit-cancel p-2 px-4 bg-slate-600 hover:bg-slate-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-subtle"
              >
                <X className="w-4 h-4 text-slate-200" />
                월말마감 수정 취소
              </button>
            ) : (
              <button
                onClick={handleEditMonthlyClose}
                className="monthly-action-edit p-2 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-subtle"
              >
                <Pencil className="w-4 h-4 text-amber-100" />
                월말마감 수정
              </button>
            )}
              <button
                onClick={handleCancelMonthlyClose}
                className="monthly-action-cancel p-2 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-subtle"
              >
                <Trash2 className="w-4 h-4 text-rose-200" />
                월말마감 취소
              </button>
            </div>
            {confirmedCloseMonths.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1.5 max-w-xl">
                <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1">마감 완료 월</span>
                {confirmedCloseMonths.slice(0, 12).map((month) => (
                  <button
                    key={month}
                    type="button"
                    onClick={() => setSelectedMonth(month)}
                    className={`rounded-lg border px-2 py-1 text-[10px] font-black transition-colors ${
                      selectedMonth === month
                        ? "border-emerald-500 bg-emerald-600 text-white"
                        : "border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    }`}
                  >
                    {month}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white px-5 py-3 text-xs font-bold text-slate-600 flex flex-wrap items-center gap-2">
        <span className="text-slate-400">현재 월말마감 상태</span>
        <span className={`monthly-close-status-pill rounded-lg px-2.5 py-1 font-black ${
          monthlyCloseStatus?.status === "confirmed"
            ? "monthly-close-status-confirmed bg-emerald-50 text-emerald-700"
            : monthlyCloseStatus?.status === "editing"
            ? "monthly-close-status-editing bg-amber-50 text-amber-700"
            : "monthly-close-status-missing bg-rose-50 text-rose-700"
        }`}>
          {monthlyCloseStatus?.status === "confirmed" ? "확정" : monthlyCloseStatus?.status === "editing" ? "수정중" : "미제출"}
        </span>
        <span className="font-mono text-slate-400">{selectedMonth}</span>
      </div>

      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center bg-white rounded-3xl border border-gray-100 shadow-sm space-y-3">
          <LoadingSpinner size="lg" />
          <span className="text-xs text-gray-400 font-bold font-mono">가맹점 무인 원격 일지에서 일일 정산자료 조합 파싱 중...</span>
        </div>
      ) : (
        <div className="space-y-6">
          {activeSubTab === "purchaseSales" && (
            <MonthlyPurchaseSalesSubTab branchName={branchName} selectedMonth={selectedMonth} triggerToast={triggerToast} resetToken={purchaseResetToken} isLocked={monthlyCloseStatus?.status === "confirmed"} />
          )}
          {activeSubTab === "partTimeSalary" && (
            <MonthlyPartTimeSalarySubTab branchName={branchName} selectedMonth={selectedMonth} history={history} triggerToast={triggerToast} />
          )}
          {activeSubTab === "cashExpenses" && (
            <MonthlyCashExpensesSubTab branchName={branchName} selectedMonth={selectedMonth} history={history} isAdmin={isAdmin} refreshHistory={fetchHistory} />
          )}
          {activeSubTab === "cashManagement" && (
            <MonthlyCashManagementSubTab branchName={branchName} selectedMonth={selectedMonth} history={history} isAdmin={isAdmin} refreshHistory={fetchHistory} />
          )}
          {activeSubTab === "cardExpenses" && (
            <MonthlyCardExpensesSubTab branchName={branchName} selectedMonth={selectedMonth} history={history} isAdmin={isAdmin} refreshHistory={fetchHistory} />
          )}
        </div>
      )}
    </div>
  );
}
