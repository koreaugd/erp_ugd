// src/pages/AdminPage.tsx
import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../contexts/AuthContext";
import { gasClient, DailyListRow, DailySettleDetail } from "../api/gasClient";
import type { LaborContractTemplateMeta } from "../api/gasClient";
import LoadingSpinner from "../components/LoadingSpinner";
import ToastMessage, { ToastType } from "../components/ToastMessage";
import ConfirmModal from "../components/ConfirmModal";
import NumberInput from "../components/NumberInput";
import { formatNumber } from "../utils/formatNumber";
import { assembleMonthlyCloseWorkbook, purchaseRowHasExportableAmount, unnamedPartTimeSalaryRows, type MonthlyCloseData } from "./branch/helpers/monthlyCloseWorkbook";
import {
  Users, CheckCircle2, AlertTriangle, 
  TrendingUp, Calendar, Filter, 
  Download, FileSpreadsheet, Eye, 
  X, Edit3, Save, LogOut, ShieldAlert, ClipboardList, Clock, Briefcase, Trash2,
  Coins
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function AdminPage() {
  const { user, logout } = useAuthContext();
  const navigate = useNavigate();

  const getTodayDateString = () => {
    const local = new Date();
    const year = local.getFullYear();
    const month = String(local.getMonth() + 1).padStart(2, "0");
    const day = String(local.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const getYesterdayDateString = () => {
    const local = new Date();
    local.setDate(local.getDate() - 1);
    const year = local.getFullYear();
    const month = String(local.getMonth() + 1).padStart(2, "0");
    const day = String(local.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // 1. 관리자 필터 관련 상태
  const [selectedDate, setSelectedDate] = useState<string>(getYesterdayDateString());
  const [selectedBrand, setSelectedBrand] = useState<string>("전체");
  
  // 2. 데이터 수집 상태
  const [loading, setLoading] = useState<boolean>(true);
  const [dailyList, setDailyList] = useState<DailyListRow[]>([]);
  
  // 3. 상세 세부 드로어/모달 상태
  const [selectedRow, setSelectedRow] = useState<DailyListRow | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailData, setDetailData] = useState<DailySettleDetail | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  // 4. 인라인 수정 모드 상태
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editCashSales, setEditCashSales] = useState<string>("");
  const [editCardSales, setEditCardSales] = useState<string>("");
  const [editTransferSales, setEditTransferSales] = useState<string>("");
  const [editDeliverySales, setEditDeliverySales] = useState<string>("");
  const [editMemo, setEditMemo] = useState<string>("");

  // 5. 알림 및 저장 모달 상태
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [isSaveConfirmOpen, setIsSaveConfirmOpen] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [adminSection, setAdminSection] = useState<"dashboard" | "dailySettlement" | "monthlyClosing" | "employeeDirectory" | "annualLeave" | "modificationLogs" | "laborContracts">("dashboard");
  const [directoryTab, setDirectoryTab] = useState<"roster" | "movements">("roster");
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryEmployees, setDirectoryEmployees] = useState<Array<any>>([]);
  const [movementHistory, setMovementHistory] = useState<Array<any>>([]);
  const [directoryBranches, setDirectoryBranches] = useState<Array<any>>([]);
  const [showEmployeeRegistration, setShowEmployeeRegistration] = useState(false);
  const [registrationRows, setRegistrationRows] = useState<Array<any>>([{ branchName: "", name: "", residentNumber: "", rank: "사원", entryDate: "", salary: "", addReason: "신규입사", fromBranch: "", transferDate: "", hireDate: "", addReasonMemo: "" }]);
  const [uploadingPayroll, setUploadingPayroll] = useState(false);
  const [salaryUnlocked, setSalaryUnlocked] = useState(false);
  const [anomalyLoading, setAnomalyLoading] = useState(false);
  const [anomalyRecords, setAnomalyRecords] = useState<Array<any>>([]);
  const [cleaningRosters, setCleaningRosters] = useState(false);
  const [clearingDirectory, setClearingDirectory] = useState(false);
  const [closingView, setClosingView] = useState<"dashboard" | "overtime" | "cash" | "remarks" | "otherMemo">("dashboard");
  const [dailySettlementTab, setDailySettlementTab] = useState<"status" | "logs">("status");
  const [dailyLogsSubTab, setDailyLogsSubTab] = useState<"logs" | "manualOvertimes">("logs");
  const [monthlyClosingTab, setMonthlyClosingTab] = useState<"status" | "cashManagement" | "cashExpenses">("status");
  const [dashboardAlerts, setDashboardAlerts] = useState<{ editLogs: number; manualOvertimes: number; latestEditLogAt: string; latestManualOvertimeAt: string }>({ editLogs: 0, manualOvertimes: 0, latestEditLogAt: "", latestManualOvertimeAt: "" });
  const [dashboardAlertsLoading, setDashboardAlertsLoading] = useState(false);
  // 비동기 응답이 뒤섞여 화면에 이전 요청 결과가 남는 것을 막기 위한 최신 요청 표식입니다.
  const dailyListRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const employeeIdSequence = useRef(1);
  // 직원명부 기능은 별도 재설계 전까지 이전 관리자 화면처럼 노출·동기화하지 않는다.
  const employeeDirectoryEnabled = false;

  // 본인 권한 검수 및 마크업 라우팅 분기
  useEffect(() => {
    if (!user) {
      navigate("/");
      return;
    }
    if (user.role !== "admin") {
      navigate("/branch-confirm");
    }
  }, [user, navigate]);

  // 전 지점 정산 총람 불러오기
  const fetchDailyList = async () => {
    if (!user) return;
    const requestId = ++dailyListRequestRef.current;
    try {
      setLoading(true);
      const [list, branches] = await Promise.all([
        gasClient.getDailyList(selectedDate, user.pinHash),
        gasClient.getBranchList().catch(() => [])
      ]);
      // 이 응답을 기다리는 사이 더 최신 요청(예: 다른 날짜 선택)이 시작됐다면 무시합니다.
      if (dailyListRequestRef.current !== requestId) return;
      const byBranch = new Map<string, DailyListRow>();
      list.forEach((item) => byBranch.set(item.branchName, item));
      branches
        .filter((branch: any) => branch?.role === "branch" && branch.branchName)
        .forEach((branch: any) => {
          if (!byBranch.has(branch.branchName)) {
            byBranch.set(branch.branchName, {
              branchName: branch.branchName,
              brand: branch.brand || branch.branchName,
              role: "branch",
              submitted: false,
              record: null
            });
          }
        });
      setDailyList(Array.from(byBranch.values()));
    } catch (e: any) {
      if (dailyListRequestRef.current !== requestId) return;
      console.error(e);
      triggerToast(e.message || "정산 리스트를 불러오지 못했습니다.", "error");
    } finally {
      if (dailyListRequestRef.current === requestId) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDailyList();
  }, [selectedDate, user]);

  const triggerToast = (message: string, type: ToastType = "success") => {
    setToast({ message, type });
  };

  const loadEmployeeDirectory = async () => {
    if (!employeeDirectoryEnabled) return;
    try {
      setDirectoryLoading(true);
      const branches = await gasClient.getBranchList();
      setDirectoryBranches(branches);
      const results = await Promise.all(branches.map(async (branch) => {
        const [employees, movements] = await Promise.all([
          gasClient.getStaffRoster(branch.branchName),
          gasClient.getSharedData<any[]>(`staff_movements:${branch.branchName}`).catch(() => null)
        ]);
        const normalizedEmployees = employees.map((employee) => employee.employeeId ? employee : {
          ...employee,
          employeeId: `UGD-${normalizeText(branch.branchName).toUpperCase()}-${employee.id}`
        });
        if (normalizedEmployees.some((employee, index) => employee !== employees[index])) {
          await gasClient.saveStaffRoster(branch.branchName, normalizedEmployees);
        }
        return {
          employees: normalizedEmployees.filter((employee) => employee.division === "정직원").map((employee) => ({ ...employee, branchName: branch.branchName, brand: branch.brand })),
          movements: Array.isArray(movements) ? movements : []
        };
      }));
      setDirectoryEmployees(results.flatMap((result) => result.employees));
      const ids = results.flatMap((result) => result.employees).map((employee: any) => Number(String(employee.employeeId || "").replace(/^emp-/i, ""))).filter(Number.isFinite);
      employeeIdSequence.current = Math.max(0, ...ids) + 1;
      setMovementHistory(results.flatMap((result) => result.movements).sort((a, b) => String(b.effectiveDate || b.createdAt || "").localeCompare(String(a.effectiveDate || a.createdAt || ""))));
    } catch (error) {
      console.error("Employee directory load failed:", error);
      triggerToast("직원명부를 불러오지 못했습니다.", "error");
    } finally {
      setDirectoryLoading(false);
    }
  };

  useEffect(() => {
    if (employeeDirectoryEnabled && adminSection === "employeeDirectory") void loadEmployeeDirectory();
  }, [adminSection, employeeDirectoryEnabled]);

  const cleanBranchOwnRosters = async () => {
    if (!window.confirm("모든 지점의 직원현황에서 관리자 등록 직원을 제거하고 지점 등록 직원만 남깁니다. 계속할까요?")) return;
    try {
      setCleaningRosters(true);
      const branches = await gasClient.getBranchList();
      for (const branch of branches) {
        const employees = await gasClient.getStaffRoster(branch.branchName);
        const branchCode = String(branch.branchName).replace(/[\s()점]/g, "");
        const isAdminEmployee = (emp: any): boolean => {
          const id = String(emp.id || "");
          const eid = String(emp.employeeId || "");
          if (/^emp-\d{10,}-[a-z0-9]{3,}$/i.test(id)) return true;
          if (/^emp-\d{1,6}$/.test(eid)) return true;
          return false;
        };
        const isBranchEmployee = (emp: any): boolean => {
          const eid = String(emp.employeeId || "").toLowerCase();
          if (!eid) return true;
          if (eid.startsWith(`ugd-${branchCode.toLowerCase()}-`)) return true;
          return false;
        };
        const branchOnly = employees.filter((emp: any) => !isAdminEmployee(emp) && isBranchEmployee(emp));
        await gasClient.saveBranchOwnRoster(branch.branchName, branchOnly);
      }
      triggerToast(`${branches.length}개 지점 직원현황 정리 완료`, "success");
    } catch (error) {
      console.error("직원현황 정리 실패:", error);
      triggerToast("직원현황 정리에 실패했습니다.", "error");
    } finally {
      setCleaningRosters(false);
    }
  };

  const clearEmployeeDirectory = async () => {
    if (!window.confirm("전 지점 직원명부의 모든 직원 데이터를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?")) return;
    try {
      setClearingDirectory(true);
      const branches = await gasClient.getBranchList();
      for (const branch of branches) {
        await gasClient.saveStaffRoster(branch.branchName, []);
      }
      setDirectoryEmployees([]);
      triggerToast(`전 지점 직원명부 초기화 완료`, "success");
    } catch (error) {
      console.error("직원명부 초기화 실패:", error);
      triggerToast("직원명부 초기화에 실패했습니다.", "error");
    } finally {
      setClearingDirectory(false);
    }
  };

  const makeEmployeeId = () => `emp-${String(employeeIdSequence.current++).padStart(5, "0")}`;
  const toMoney = (value: unknown) => Number(String(value ?? "").replace(/[^0-9.-]/g, "")) || 0;
  const normalizeText = (value: unknown) => String(value ?? "").replace(/[\s()점]/g, "").toLowerCase();
  const birthDateFromResident = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 7) return "";
    const century = ["1", "2", "5", "6"].includes(digits[6]) ? "19" : "20";
    return digits.slice(0, 6);
  };
  const formatDate = (value?: string) => value ? String(value).replace(/-/g, ".") : "-";
  const formatBirthDate = (value?: string) => String(value || "").replace(/\D/g, "").slice(0, 6) || "-";
  const formatResidentNumber = (value?: string) => {
    const digits = String(value || "").replace(/\D/g, "").slice(0, 13);
    if (digits.length <= 6) return digits;
    return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  };
  const maskResidentNumber = (value?: string) => {
    const digits = String(value || "").replace(/\D/g, "").slice(0, 13);
    if (digits.length <= 6) return digits || "-";
    return `${digits.slice(0, 6)}-${"*".repeat(Math.min(7, digits.length - 6))}`;
  };
  const formatTenure = (entryDate?: string) => {
    if (!entryDate) return "-";
    const start = new Date(entryDate);
    if (Number.isNaN(start.getTime())) return "-";
    const now = new Date();
    let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
    if (now.getDate() < start.getDate()) months--;
    if (months < 0) return "-";
    return `${Math.floor(months / 12)}년 ${months % 12}개월`;
  };

  const saveRegistrationRows = async () => {
    const grouped = new Map<string, any[]>();
    registrationRows.filter((row) => row.branchName && row.name.trim()).forEach((row) => {
      const list = grouped.get(row.branchName) || [];
      list.push(row);
      grouped.set(row.branchName, list);
    });
    if (grouped.size === 0) return triggerToast("지점과 직원명을 입력해 주세요.", "error");
    const invalidResident = registrationRows.find((row) => row.branchName && row.name.trim() && formatResidentNumber(row.residentNumber).replace(/\D/g, "").length !== 13);
    if (invalidResident) return triggerToast("주민등록번호 13자리를 모두 입력해 주세요.", "error");
    try {
    await Promise.all(Array.from(grouped.entries()).map(async ([branchName, rows]) => {
      const current = await gasClient.getStaffRoster(branchName);
      const next = [...current, ...rows.map((row) => {
        const formattedResident = formatResidentNumber(row.residentNumber);
        const effectiveEntryDate = row.addReason === "신규입사" ? row.hireDate || row.entryDate : row.entryDate;
        return {
          id: `emp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          employeeId: makeEmployeeId(),
          name: row.name.trim(),
          division: "정직원",
          rank: row.rank || "사원",
          residentNumber: formattedResident,
          birthDate: formattedResident.replace(/\D/g, "").slice(0, 6),
          entryDate: effectiveEntryDate,
          salary: toMoney(row.salary),
          contractType: "4대보험" as const,
          addReason: row.addReason || "신규입사",
          fromBranch: row.addReason === "지점이동" ? row.fromBranch : "",
          transferDate: row.addReason === "지점이동" ? row.transferDate : "",
          hireDate: row.addReason === "신규입사" ? row.hireDate || row.entryDate : "",
          addReasonMemo: row.addReason === "기타" ? row.addReasonMemo : ""
        };
      })];
      await gasClient.saveStaffRoster(branchName, next);
    }));
    setRegistrationRows([{ branchName: "", name: "", residentNumber: "", rank: "사원", entryDate: "", salary: "", addReason: "신규입사", fromBranch: "", transferDate: "", hireDate: "", addReasonMemo: "" }]);
    setShowEmployeeRegistration(false);
    await loadEmployeeDirectory();
    triggerToast("직원명부를 등록했습니다.");
    } catch (error) {
      // 인증 복원 대기 실패 등으로 저장이 거부되면 조용히 넘어가지 않는다 — 입력 행을 남겨두고 재시도를 안내한다.
      console.error("직원명부 등록 저장 실패", error);
      triggerToast("직원 등록 저장에 실패했습니다. 로그인 상태를 확인한 뒤 다시 시도해 주세요.", "error");
    }
  };

  const handlePayrollUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []) as File[];
    if (!files.length) return;
    try {
      setUploadingPayroll(true);
      const XLSX = await import("xlsx");
      const branches = directoryBranches.length ? directoryBranches : await gasClient.getBranchList();
      const updates = new Map<string, any[]>();
      for (const file of files) {
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
        for (const sheetName of workbook.SheetNames) {
          const rows = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false });
          const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell).trim() === "성명"));
          if (headerIndex < 0) continue;
          const headers = rows[headerIndex].map((cell) => String(cell).trim());
          const col = (name: string) => headers.indexOf(name);
          const nameCol = col("성명"), typeCol = col("분류"), salaryCol = col("이달급여"), residentCol = col("주민등록번호"), rankCol = col("직급"), entryCol = col("입사일"), contractCol = col("근로계약"), branchCol = col("실제 송금지점");
          for (const row of rows.slice(headerIndex + 1)) {
            const name = String(row[nameCol] || "").trim();
            if (!name || name === "합계") continue;
            const employmentType = String(row[typeCol] || "").trim();
            const rank = String(row[rankCol] || "사원").trim();
            if (employmentType.includes("파트") || rank.includes("파트")) continue;
            const rawBranch = String(row[branchCol] || sheetName).trim();
            const branch = branches.find((item) => { const a = normalizeText(item.branchName); const b = normalizeText(rawBranch); const c = normalizeText(sheetName); return a === b || a === c || a.includes(b) || b.includes(a) || a.includes(c) || c.includes(a); });
            if (!branch) continue;
            const list = updates.get(branch.branchName) || [];
            const residentNumber = String(row[residentCol] || "").trim();
            list.push({ name, residentNumber, birthDate: birthDateFromResident(residentNumber), rank, entryDate: String(row[entryCol] || "").trim(), contractType: String(row[contractCol] || "4대보험").trim(), salary: toMoney(row[salaryCol]) });
            updates.set(branch.branchName, list);
          }
        }
      }
      await Promise.all(Array.from(updates.entries()).map(async ([branchName, rows]) => {
        const current = await gasClient.getStaffRoster(branchName);
        const next = [...current];
        rows.forEach((row) => {
          const index = next.findIndex((employee: any) => (row.residentNumber && employee.residentNumber === row.residentNumber) || employee.name === row.name);
          const patch = { ...row, division: "정직원", contractType: row.contractType.includes("3.3%") ? "3.3%" as const : "4대보험" as const, employeeId: index >= 0 ? next[index].employeeId || makeEmployeeId() : makeEmployeeId() };
          if (index >= 0) next[index] = { ...next[index], ...patch }; else next.push({ id: `emp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...patch });
        });
        await gasClient.saveStaffRoster(branchName, next);
      }));
      await loadEmployeeDirectory();
      triggerToast("인건비 파일의 급여 정보를 반영했습니다.");
    } catch (error) {
      console.error("Payroll upload failed:", error);
      triggerToast("인건비 파일을 처리하지 못했습니다.", "error");
    } finally {
      setUploadingPayroll(false);
      event.target.value = "";
    }
  };

  // 고유 브랜드 리스트 추출
  const unlockSalary = async () => {
    const pin = window.prompt("급여 정보를 열람하려면 관리자 PIN을 다시 입력하세요.");
    if (!pin) return false;
    try { const { loginWithAdminPin } = await import("../api/firebaseAuth"); await loginWithAdminPin(pin); setSalaryUnlocked(true); return true; }
    catch { triggerToast("관리자 PIN이 일치하지 않습니다.", "error"); return false; }
  };

  const downloadEmployeeDirectory = async () => {
    let includeSalary = window.confirm("급여 정보를 포함해 다운로드할까요?");
    if (includeSalary && !salaryUnlocked) includeSalary = await unlockSalary();
    const rows = directoryEmployees.map((employee) => ({ "직원ID": employee.employeeId || employee.id, "지점": employee.branchName, "이름": employee.name, "생년월일": employee.birthDate || "", "직급": employee.rank || "사원", "입사일": employee.entryDate || "", ...(includeSalary ? { "급여": employee.salary || 0 } : {}), "재직년수": formatTenure(employee.entryDate) }));
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "직원명부"); XLSX.writeFile(workbook, `UGD_직원명부_${getTodayDateString()}.xlsx`);
  };

  const loadClosingAnomalies = async () => {
    try {
      setAnomalyLoading(true);
      const branches = await gasClient.getBranchList();
      const records = await Promise.all(branches.map(async (branch) => {
        const history = await gasClient.getBranchHistory(branch.branchName);
        return history.flatMap((record: any) => {
          try {
            const memoText = String(record.memo || "");
            const meta = JSON.parse(memoText.split("\n---\nMETADATA:")[1] || "{}");
            const visibleMemo = memoText.split("\n---\nMETADATA:")[0] || "";
            const section = (title: string) => {
              const match = visibleMemo.match(new RegExp("\\[" + title + "\\]\\n([\\s\\S]*?)(?=\\n\\n\\[|$)"));
              return (match?.[1] || "").trim();
            };
            const remarks = {
              staffMemo: meta.staffMemo || section("등록 저장??"),
              reviewMemo: meta.reviewMemo || section("등록 저장??"),
              otherMemo: meta.otherMemo || section("등록 저장??")
            };
            const expenses = (meta.cashExpenses || []).reduce((sum: number, item: any) => sum + (Number(item.amount) || 0), 0);
            const cashDifference = (Number(meta.cashBalance) || 0) - ((Number(meta.prevDayCash) || 0) + (Number(record.cashSales) || 0) - expenses);
            const overtime = (meta.staffRows || []).filter((staff: any) => staff.division === "정직원" && Number(staff.overtime) > 0).map((staff: any) => `${staff.name} +${staff.overtime}h`).join(", ");
            const hasRemark = Boolean(remarks.staffMemo || remarks.reviewMemo);
            const hasOtherMemo = Boolean(remarks.otherMemo);
            if (!cashDifference && !overtime && !hasRemark && !hasOtherMemo) return [];
            return [{
              branchName: branch.branchName,
              date: record.settleDate,
              writer: record.submittedBy || record.modifiedBy || "-",
              issues: [cashDifference ? "현금 차이" : "", overtime ? "초과근무" : "", hasRemark ? "특이사항" : "", hasOtherMemo ? "기타메모" : ""].filter(Boolean),
              cashDifference,
              overtime,
              reason: meta.cashDiffReason || "",
              remarks
            }];
          } catch { return []; }
        });
      }));
      setAnomalyRecords(records.flat().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.branchName).localeCompare(String(b.branchName), "ko")));
    } finally {
      setAnomalyLoading(false);
    }
  };
  useEffect(() => { if (adminSection === "dashboard") void loadClosingAnomalies(); }, [adminSection]);

  const loadDashboardAlerts = useCallback(async () => {
    try {
      setDashboardAlertsLoading(true);
      const [editLogs, manualOvertimes, reviewedEditLogs, reviewedManualOvertimes] = await Promise.all([
        gasClient.getEditLogs().catch(() => []),
        gasClient.getAllManualOvertimes().catch(() => []),
        gasClient.getSharedData<string[]>("admin_reviewed_edit_logs").catch(() => []),
        gasClient.getSharedData<string[]>("admin_reviewed_manual_overtimes").catch(() => [])
      ]);
      const reviewedEditSet = new Set(Array.isArray(reviewedEditLogs) ? reviewedEditLogs : []);
      const reviewedManualSet = new Set(Array.isArray(reviewedManualOvertimes) ? reviewedManualOvertimes : []);
      const getEditReviewId = (log: any) => String(log.id || `${log.branchName || ""}:${log.settleDate || ""}:${log.modifiedAt || log.createdAt || ""}`);
      const getManualReviewId = (record: any) => String(`${record.branchName || ""}:${record.id || ""}:${record.createdAt || record.updatedAt || record.settleDate || ""}`);
      const yesterday = getYesterdayDateString();
      const editDismissed = localStorage.getItem("admin_dashboard_dismissed_edit_logs_date") === yesterday;
      const manualDismissed = localStorage.getItem("admin_dashboard_dismissed_manual_overtimes_date") === yesterday;
      const editNew = editDismissed ? [] : (editLogs || []).filter((log: any) => log.settleDate === yesterday && !reviewedEditSet.has(getEditReviewId(log)));
      const manualNew = manualDismissed ? [] : (manualOvertimes || []).filter((record: any) => record.settleDate === yesterday && !reviewedManualSet.has(getManualReviewId(record)));
      const latest = (items: any[], fields: string[]) => items.reduce((max, item) => {
        const value = fields.map((field) => item?.[field]).find(Boolean) || "";
        return String(value) > max ? String(value) : max;
      }, "");
      setDashboardAlerts({
        editLogs: editNew.length,
        manualOvertimes: manualNew.length,
        latestEditLogAt: latest(editLogs || [], ["modifiedAt", "createdAt"]),
        latestManualOvertimeAt: latest(manualOvertimes || [], ["createdAt", "updatedAt", "settleDate"])
      });
    } finally {
      setDashboardAlertsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (adminSection === "dashboard") void loadDashboardAlerts();
  }, [adminSection, loadDashboardAlerts]);

  const handleDashboardAlertClick = (target: "dailyPending" | "editLogs" | "manualOvertimes") => {
    if (target === "dailyPending") {
      setAdminSection("dailySettlement");
      setDailySettlementTab("status");
      return;
    }
    setAdminSection("dailySettlement");
    setDailySettlementTab("logs");
    if (target === "editLogs") {
      setDailyLogsSubTab("logs");
      localStorage.setItem("admin_dashboard_dismissed_edit_logs_date", getYesterdayDateString());
      setDashboardAlerts((current) => ({ ...current, editLogs: 0 }));
    } else {
      setDailyLogsSubTab("manualOvertimes");
      localStorage.setItem("admin_dashboard_dismissed_manual_overtimes_date", getYesterdayDateString());
      setDashboardAlerts((current) => ({ ...current, manualOvertimes: 0 }));
    }
  };

  const brandList = useMemo(() => {
    const brands = new Set<string>();
    brands.add("전체");
    dailyList.forEach(item => {
      if (item.brand) {
        brands.add(item.brand);
      }
    });
    return Array.from(brands);
  }, [dailyList]);

  // 필터 통과한 최종 데이터 목록
  const filteredList = useMemo(() => {
    return dailyList.filter(item => {
      if (selectedBrand === "전체") return true;
      return item.brand === selectedBrand;
    });
  }, [dailyList, selectedBrand]);

  // ----------------------------------------------------
  // 상단 핵심 요약 지표 산출
  // ----------------------------------------------------
  const stats = useMemo(() => {
    const totalBranches = filteredList.length;
    const submittedCount = filteredList.filter(i => i.submitted).length;
    const pendingCount = totalBranches - submittedCount;
    
    const sumRevenue = filteredList.reduce((acc, curr) => {
      if (curr.record) {
        return acc + (curr.record.totalSales || 0);
      }
      return acc;
    }, 0);

    return {
      total: totalBranches,
      submitted: submittedCount,
      pending: pendingCount,
      revenue: sumRevenue
    };
  }, [filteredList]);

  const yesterdayAnomalyRecords = useMemo(() => {
    const yesterday = getYesterdayDateString();
    return anomalyRecords.filter((item) => item.date === yesterday);
  }, [anomalyRecords]);

  const recentAnomalyRecords = useMemo(() => {
    const recentDates = Array.from(new Set<string>(anomalyRecords.map((item) => String(item.date || "")).filter(Boolean)))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 3);
    const dateSet = new Set(recentDates);
    return anomalyRecords.filter((item) => dateSet.has(String(item.date || "")));
  }, [anomalyRecords]);

  // ----------------------------------------------------
  // 특정 지점 클릭 시 우측 드로어 상세 오픈 및 서브테이블 로드
  // ----------------------------------------------------
  const handleOpenDetail = async (row: DailyListRow) => {
    if (!row.record || !row.record.recordId) {
      triggerToast("이 지점은 아직 마감을 등록하지 않았습니다.", "warning");
      return;
    }
    
    const requestId = ++detailRequestRef.current;
    setSelectedRow(row);
    setIsDrawerOpen(true);
    setIsEditing(false);

    try {
      setDetailLoading(true);
      const res = await gasClient.getDailyDetail(row.record.recordId);
      // 응답을 기다리는 사이 다른 지점을 클릭했다면, 이전 응답으로 화면을 덮어쓰지 않습니다.
      if (detailRequestRef.current !== requestId) return;
      setDetailData(res);

      // 인라인 수정용 원본 임시 바인딩
      setEditCashSales(String(res.master.cashSales || "0"));
      setEditCardSales(String(res.master.cardSales || "0"));
      setEditTransferSales(String(res.master.transferSales || "0"));
      setEditDeliverySales(String(res.master.deliverySales || "0"));
      setEditMemo(res.master.memo || "");

    } catch (e: any) {
      if (detailRequestRef.current !== requestId) return;
      console.error(e);
      triggerToast("지점 상세 데이터를 불러오지 못했습니다.", "error");
    } finally {
      if (detailRequestRef.current === requestId) setDetailLoading(false);
    }
  };

  const handleCloseDrawer = () => {
    // 진행 중인 상세 요청을 무효화해, 닫은 뒤 늦게 온 응답이 드로어를 다시 채우지 않게 합니다.
    detailRequestRef.current++;
    setIsDrawerOpen(false);
    setSelectedRow(null);
    setDetailData(null);
    setIsEditing(false);
  };

  // ----------------------------------------------------
  // 인라인 편집 개시 및 보존 트리거
  // ----------------------------------------------------
  const handleStartEdit = () => {
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    if (detailData) {
      setEditCashSales(String(detailData.master.cashSales || "0"));
      setEditCardSales(String(detailData.master.cardSales || "0"));
      setEditTransferSales(String(detailData.master.transferSales || "0"));
      setEditDeliverySales(String(detailData.master.deliverySales || "0"));
      setEditMemo(detailData.master.memo || "");
    }
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!selectedRow?.record?.recordId || !detailData) return;
    setIsSaveConfirmOpen(false);
    setSaving(true);

    try {
      const parsedCash = parseFloat(editCashSales) || 0;
      const parsedCard = parseFloat(editCardSales) || 0;
      const parsedTransfer = parseFloat(editTransferSales) || 0;
      const parsedDelivery = parseFloat(editDeliverySales) || 0;

      const masterPayload = {
        cashSales: parsedCash,
        cardSales: parsedCard,
        transferSales: parsedTransfer,
        deliverySales: parsedDelivery,
        memo: editMemo.substring(0, 500)
      };

      await gasClient.updateDaily(
        selectedRow.record.recordId,
        masterPayload,
        undefined, // 지출 상세 및 직원은 관리자 인라인 수정에서 제외 (마스터 매출 수정 최우선 요구)
        undefined,
        user?.branchName || "관리자"
      );

      triggerToast("정산 수정 내역이 성공적으로 구글 시트에 업데이트 되었습니다.", "success");
      
      // 메인 리스트 갱신 및 드로어 내용도 반영
      await fetchDailyList();
      
      // 드로어 캡처 업데이트
      const updatedDetail = await gasClient.getDailyDetail(selectedRow.record.recordId);
      setDetailData(updatedDetail);
      setIsEditing(false);

    } catch (e: any) {
      console.error(e);
      triggerToast(e.message || "원격 데이터 저장 실패", "error");
    } finally {
      setSaving(false);
    }
  };

  // ----------------------------------------------------
  // 현재 필터링 상태 기준 데이터 XLSX 양식 출력 (SheetJS)
  // ----------------------------------------------------
  const handleDownloadExcel = async () => {
    if (filteredList.length === 0) {
      triggerToast("다운로드할 데이터가 존재하지 않습니다.", "warning");
      return;
    }

    try {
      const dataToExport = filteredList.map(row => {
        return {
          "지점명": row.branchName,
          "브랜드": row.brand,
          "제출여부": row.submitted ? "제출 완료" : "미제출",
          "실시간 총 매출 (원)": row.record ? row.record.totalSales : 0,
          "현금 매출 (원)": row.record ? row.record.cashSales : 0,
          "카드 매출 (원)": row.record ? row.record.cardSales : 0,
          "계좌이체 매출 (원)": row.record ? row.record.transferSales : 0,
          "배달 매출 (원)": row.record ? row.record.deliverySales : 0,
          "제출 시각": row.record && row.record.submittedAt ? new Date(row.record.submittedAt).toLocaleString() : "-",
          "최종 정정 시간": row.record && row.record.modifiedAt ? new Date(row.record.modifiedAt).toLocaleString() : "-",
          "최종 정정인": row.record && row.record.modifiedBy ? row.record.modifiedBy : "-",
          "특이사항 및 메모": row.record ? row.record.memo : ""
        };
      });

      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "UGD_정산조회");

      // 브라우저 다운로드 바인딩
      XLSX.writeFile(workbook, `UGD_일일마감_${selectedDate}.xlsx`);
      triggerToast("엑셀 형태의 정산 현황 다운로드를 완료했습니다.", "success");
    } catch (err) {
      console.error("Excel download fail:", err);
      triggerToast("엑셀 파일 파싱 중 예기치 못한 에러가 발생했습니다.", "error");
    }
  };

  if (!user) return null;
  const designPreview = new URLSearchParams(window.location.search).get("designPreview") !== "0";

  return (
    <div className={`admin-redesign ${designPreview ? "admin-design-preview" : ""} min-h-screen bg-[#F6F5FA] flex`} id="admin-layout-wrapper">
      
      {/* PC 전전 사이드바 레이아웃 */}
      <aside className="hidden lg:flex flex-col w-64 bg-[#1A3C6E] text-white p-6 shrink-0" id="sidebar">
        <div className="mb-10 text-center py-4 border-b border-white/10">
          <h2 className="text-2xl font-black tracking-widest text-[#D6E4F0]">ERP_UGD</h2>
          <p className="text-[10px] text-white/60 mt-1 uppercase font-semibold">UGD 주식회사 마감 총괄 시스템</p>
        </div>

        <nav className="grow space-y-0">
          <p className="ugd-nav-group">정산</p>
          <button
            onClick={() => setAdminSection("dashboard")}
            aria-current={adminSection === "dashboard" ? "page" : undefined}
            className={`ugd-nav-item${adminSection === "dashboard" ? " is-active" : ""}`}
          >
            대시보드
          </button>
          <button
            onClick={() => setAdminSection("dailySettlement")}
            aria-current={adminSection === "dailySettlement" ? "page" : undefined}
            className={`ugd-nav-item${adminSection === "dailySettlement" ? " is-active" : ""}`}
          >
            일일 정산현황
          </button>
          {adminSection === "dailySettlement" && (
            <div className="ml-4 pl-3 border-l border-[rgba(33,33,33,0.12)] space-y-1 py-1">
              {[{ id: "status", label: "전일 정산현황" }, { id: "logs", label: "변경이력 & 수기대장" }].map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setDailySettlementTab(sub.id as "status" | "logs")}
                  aria-current={dailySettlementTab === sub.id ? "page" : undefined}
                  className={`ugd-subnav-item w-full text-left${dailySettlementTab === sub.id ? " is-active" : ""}`}
                >
                  {sub.label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setAdminSection("monthlyClosing")}
            aria-current={adminSection === "monthlyClosing" ? "page" : undefined}
            className={`ugd-nav-item${adminSection === "monthlyClosing" ? " is-active" : ""}`}
          >
            월말마감
          </button>
          {adminSection === "monthlyClosing" && (
            <div className="ml-4 pl-3 border-l border-[rgba(33,33,33,0.12)] space-y-1 py-1">
              {[{ id: "status", label: "제출현황" }, { id: "cashManagement", label: "현금관리" }, { id: "cashExpenses", label: "현금지출" }].map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setMonthlyClosingTab(sub.id as "status" | "cashManagement" | "cashExpenses")}
                  aria-current={monthlyClosingTab === sub.id ? "page" : undefined}
                  className={`ugd-subnav-item w-full text-left${monthlyClosingTab === sub.id ? " is-active" : ""}`}
                >
                  {sub.label}
                </button>
              ))}
            </div>
          )}

          <p className="ugd-nav-group">인사</p>
          <button
            onClick={() => setAdminSection("laborContracts")}
            aria-current={adminSection === "laborContracts" ? "page" : undefined}
            className={`ugd-nav-item${adminSection === "laborContracts" ? " is-active" : ""}`}
          >
            근로계약서 발송 현황
          </button>
          <button
            onClick={() => setAdminSection("annualLeave")}
            aria-current={adminSection === "annualLeave" ? "page" : undefined}
            className={`ugd-nav-item${adminSection === "annualLeave" ? " is-active" : ""}`}
          >
            연차관리
          </button>
          {employeeDirectoryEnabled && <button
            onClick={() => setAdminSection("employeeDirectory")}
            aria-current={adminSection === "employeeDirectory" ? "page" : undefined}
            className={`ugd-nav-item${adminSection === "employeeDirectory" ? " is-active" : ""}`}
          >
            직원명부
          </button>}

          <p className="ugd-nav-group">이동</p>
          <button
            onClick={() => navigate("/branch-confirm")}
            className="ugd-nav-item"
          >
            지점 대시보드
          </button>
          <button
            onClick={logout}
            className="admin-logout-link ugd-nav-item"
          >
            보안 로그아웃
          </button>
        </nav>

        <div className="mt-auto bg-white/5 rounded-2xl p-4 border border-white/5 text-center space-y-2">
          <p className="text-xs text-white/50">현재 계정 정보</p>
          <div className="text-xs font-bold text-[#D6E4F0]" id="admin-role-badge">본사 총괄 관리자</div>
        </div>
      </aside>

      {/* 실시간 콘텐츠 영역 */}
      <div className="grow flex flex-col min-w-0" id="admin-main-container">
        
        {/* 모바일 대형 헤더 */}
        <header className="admin-mobile-header lg:hidden bg-[#1A3C6E] text-white px-4 py-4 flex items-center justify-between shadow-md">
          <div className="flex flex-col">
            <span className="text-lg font-black tracking-wider text-white">ERP_UGD</span>
            <span className="text-[10px] text-white/75">본사 총괄 대시보드</span>
          </div>
          
          <button
            onClick={logout}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            id="mobile-btn-logout"
          >
            <LogOut className="w-3.5 h-3.5" />
            로그아웃
          </button>
        </header>

        <main className="grow p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto w-full">
          {adminSection === "dashboard" && (
            <>
              <section className="admin-hero-panel">
                <div>
                  <p className="admin-kicker">UGD Finance Control</p>
                  <AdminLatestNoticeHeadline />
                </div>
                <div className="admin-hero-actions">
                  <span><Calendar className="w-4 h-4" /> {getTodayDateString()}</span>
                </div>
              </section>

              <section className="admin-kpi-grid">
                <button type="button" onClick={() => setAdminSection("dailySettlement")} className="admin-kpi-card admin-kpi-vanilla">
                  <span>일일정산 미제출</span>
                  <strong>{stats.pending}</strong>
                  <small>클릭해서 지점별 제출 상태 확인</small>
                </button>
                <button type="button" onClick={() => setClosingView("cash")} className="admin-kpi-card admin-kpi-blue">
                  <span>현금차이</span>
                  <strong>{yesterdayAnomalyRecords.filter((item) => item.cashDifference).length}</strong>
                  <small>어제 마감의 현금 차이 확인</small>
                </button>
                <button type="button" onClick={() => setClosingView("otherMemo")} className="admin-kpi-card admin-kpi-honey">
                  <span>ERP 기타메모</span>
                  <strong>{yesterdayAnomalyRecords.filter((item) => item.remarks?.otherMemo).length}</strong>
                  <small>어제 마감의 기타메모 확인</small>
                </button>
                <button type="button" onClick={() => setAdminSection("monthlyClosing")} className="admin-kpi-card admin-kpi-white">
                  <span>월말마감</span>
                  <strong>보기</strong>
                  <small>현금관리와 제출 현황으로 이동</small>
                </button>
              </section>

              <section className="admin-dashboard-closing-section bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
                <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-black text-[#2C3E50]">마감현황</h2><p className="text-xs text-gray-400 mt-1">전체 지점의 마감 상태와 누적 이상치를 점검합니다. 어제 날짜({getYesterdayDateString()}) 마감 내용만 강조 표시합니다.</p></div><button onClick={() => void loadClosingAnomalies()} className="text-xs font-bold text-[#2E6DB4]">새로고침</button></div>
                <div className="flex gap-2 border-b border-gray-100"><button onClick={() => setClosingView("dashboard")} className={`px-4 py-3 text-sm font-bold border-b-2 ${closingView === "dashboard" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>대시보드</button><button onClick={() => setClosingView("overtime")} className={`px-4 py-3 text-sm font-bold border-b-2 ${closingView === "overtime" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>초과근무</button><button onClick={() => setClosingView("cash")} className={`px-4 py-3 text-sm font-bold border-b-2 ${closingView === "cash" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>현금차이</button><button onClick={() => setClosingView("remarks")} className={`px-4 py-3 text-sm font-bold border-b-2 ${closingView === "remarks" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>특이사항</button><button onClick={() => setClosingView("otherMemo")} className={`px-4 py-3 text-sm font-bold border-b-2 ${closingView === "otherMemo" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>기타메모</button></div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="border-b text-left text-gray-500">
                      <tr>
                        <th className="py-3">마감일</th>
                        <th>지점</th>
                        <th>마감자</th>
                        <th>이상 항목</th>
                        <th>내용</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {anomalyLoading ? (
                        <tr>
                          <td colSpan={5} className="py-10 text-center">
                            <LoadingSpinner size="sm" />
                          </td>
                        </tr>
                      ) : (
                        recentAnomalyRecords
                          .filter((item) =>
                            closingView === "remarks"
                              ? Boolean(item.remarks?.staffMemo || item.remarks?.reviewMemo)
                              : closingView === "otherMemo"
                              ? Boolean(item.remarks?.otherMemo)
                              : closingView === "dashboard" || closingView === "cash"
                              ? Boolean(item.cashDifference)
                              : Boolean(item.overtime)
                          )
                          .map((item, index) => (
                            <tr
                              key={`${item.branchName}-${item.date}-${index}`}
                              className={item.date === getYesterdayDateString() ? "admin-yesterday-new-row bg-sky-50" : ""}
                            >
                              <td className="py-3 font-mono">{item.date}</td>
                              <td className="font-bold">{item.branchName}</td>
                              <td>{item.writer || "-"}</td>
                              <td className="font-bold text-rose-600">
                                {closingView === "cash"
                                  ? "현금 차이"
                                  : closingView === "overtime"
                                  ? "초과근무"
                                  : closingView === "remarks"
                                  ? "특이사항"
                                  : closingView === "otherMemo"
                                  ? "기타메모"
                                  : item.issues.join(", ")}
                                {item.date === getYesterdayDateString() && (
                                  <span className="admin-yesterday-new-badge ml-2 rounded bg-sky-600 px-1.5 py-0.5 text-[10px] text-white">
                                    어제
                                  </span>
                                )}
                              </td>
                              <td>
                                {closingView === "cash"
                                  ? `${formatNumber(item.cashDifference)}원 ${item.reason || ""}`
                                  : closingView === "remarks"
                                  ? <div className="space-y-1 text-xs"><p><b>직원</b> {item.remarks?.staffMemo || "-"}</p><p><b>리뷰</b> {item.remarks?.reviewMemo || "-"}</p></div>
                                  : closingView === "otherMemo"
                                  ? <div className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{item.remarks?.otherMemo || "-"}</div>
                                  : item.overtime || "-"}
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="admin-dashboard-compact-grid">
                <AdminDashboardAlertHub
                  pendingDailyCount={stats.pending}
                  alerts={dashboardAlerts}
                  loading={dashboardAlertsLoading}
                  onRefresh={() => void loadDashboardAlerts()}
                  onOpen={handleDashboardAlertClick}
                />
                <AdminNoticeManager />
              </div>

            </>
          )}

          {adminSection === "annualLeave" && <AdminAnnualLeaveSection />}

          {adminSection === "dailySettlement" && (
            <section className="admin-daily-settlement-section space-y-5 animate-fade-in">
              <div className="flex gap-2 border-b border-gray-200 lg:hidden">
                <button onClick={() => setDailySettlementTab("status")} className={`px-4 py-3 text-sm font-bold border-b-2 ${dailySettlementTab === "status" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>전일 정산현황</button>
                <button onClick={() => setDailySettlementTab("logs")} className={`px-4 py-3 text-sm font-bold border-b-2 ${dailySettlementTab === "logs" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>변경이력 & 수기대장</button>
              </div>
              {dailySettlementTab === "status" ? (
                <AdminDailySettlementStatusSection
                  selectedDate={selectedDate}
                  setSelectedDate={setSelectedDate}
                  selectedBrand={selectedBrand}
                  setSelectedBrand={setSelectedBrand}
                  brandList={brandList}
                  stats={stats}
                  loading={loading}
                  filteredList={filteredList}
                  handleDownloadExcel={handleDownloadExcel}
                  handleOpenDetail={handleOpenDetail}
                />
              ) : <AdminModificationLogsSection defaultSubTab={dailyLogsSubTab} />}
            </section>
          )}

          {adminSection === "monthlyClosing" && (
            <section className="space-y-5 animate-fade-in">
              <div className="flex gap-2 border-b border-gray-200 lg:hidden">
                <button onClick={() => setMonthlyClosingTab("status")} className={`px-4 py-3 text-sm font-bold border-b-2 ${monthlyClosingTab === "status" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>제출현황</button>
                <button onClick={() => setMonthlyClosingTab("cashManagement")} className={`px-4 py-3 text-sm font-bold border-b-2 ${monthlyClosingTab === "cashManagement" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>현금관리</button>
                <button onClick={() => setMonthlyClosingTab("cashExpenses")} className={`px-4 py-3 text-sm font-bold border-b-2 ${monthlyClosingTab === "cashExpenses" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>현금지출</button>
              </div>
              {monthlyClosingTab === "status" && <AdminMonthlyClosingStatusSection />}
              {monthlyClosingTab === "cashManagement" && <AdminCashManagementSection fixedTab="cashManagement" />}
              {monthlyClosingTab === "cashExpenses" && <AdminCashManagementSection fixedTab="cashExpenses" />}
            </section>
          )}

          {adminSection === "modificationLogs" && <AdminModificationLogsSection />}

          {adminSection === "laborContracts" && <AdminLaborContractsSection />}

          {employeeDirectoryEnabled && adminSection === "employeeDirectory" && (
            <section className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black text-[#2C3E50] tracking-tight">전 지점 직원명부</h2>
                  <p className="text-xs text-gray-400 mt-1">정직원 명부와 퇴사·지점이동 이력을 확인합니다.</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => void loadEmployeeDirectory()} className="px-4 py-2 bg-[#2E6DB4] text-white rounded-xl text-xs font-bold">새로고침</button>
                  <button onClick={() => void cleanBranchOwnRosters()} disabled={cleaningRosters} className="px-4 py-2 bg-orange-500 text-white rounded-xl text-xs font-bold disabled:opacity-50">{cleaningRosters ? "정리 중…" : "직원현황 정리"}</button>
                  <button onClick={() => void clearEmployeeDirectory()} disabled={clearingDirectory} className="px-4 py-2 bg-red-700 text-white rounded-xl text-xs font-bold disabled:opacity-50">{clearingDirectory ? "삭제 중…" : "명부 전체 삭제"}</button>
                </div>
              </div>
              <div className="flex gap-2 border-b border-gray-200">
                <button onClick={() => setDirectoryTab("roster")} className={`px-4 py-3 text-sm font-bold border-b-2 ${directoryTab === "roster" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>직원명부</button>
                <button onClick={() => setDirectoryTab("movements")} className={`px-4 py-3 text-sm font-bold border-b-2 ${directoryTab === "movements" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>변동내역</button>
              </div>
              {directoryTab === "roster" && !directoryLoading && (
                <>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button onClick={() => setShowEmployeeRegistration((open) => !open)} className="px-4 py-2 rounded-xl bg-[#2E6DB4] text-white text-xs font-bold">직원 직접 등록</button>
                    <label className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer">{uploadingPayroll ? "인건비 반영 중…" : "인건비내역 업로드"}<input type="file" accept=".xlsx,.xls" multiple className="hidden" disabled={uploadingPayroll} onChange={handlePayrollUpload} /></label>
                    <button onClick={() => void downloadEmployeeDirectory()} className="px-4 py-2 rounded-xl bg-slate-700 text-white text-xs font-bold">엑셀 다운로드</button>
                    <button onClick={() => salaryUnlocked ? setSalaryUnlocked(false) : void unlockSalary()} className="px-4 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-xs font-bold">{salaryUnlocked ? "급여 다시 잠금" : "급여 열람 잠금 해제"}</button>
                  </div>
                  {showEmployeeRegistration && <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 space-y-3"><div className="overflow-x-auto"><table className="w-full min-w-[1280px] text-xs"><thead><tr className="text-gray-500"><th className="text-left pb-2">지점</th><th className="text-left pb-2">이름</th><th className="text-left pb-2">주민등록번호</th><th className="text-left pb-2">직급</th><th className="text-left pb-2">추가 사유</th><th className="text-left pb-2">신규입사일</th><th className="text-left pb-2">이동 전 지점</th><th className="text-left pb-2">이동일</th><th className="text-left pb-2">기타 내용</th><th className="text-left pb-2">급여</th></tr></thead><tbody>{registrationRows.map((row, index) => <tr key={index}><td className="pr-2 pb-2"><select value={row.branchName} onChange={(e) => setRegistrationRows((rows) => rows.map((item, i) => i === index ? { ...item, branchName: e.target.value } : item))} className="w-full p-2 rounded border"><option value="">지점 선택</option>{directoryBranches.map((branch) => <option key={branch.branchName} value={branch.branchName}>{branch.branchName}</option>)}</select></td><td className="pr-2 pb-2"><input value={row.name} onChange={(e) => setRegistrationRows((rows) => rows.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} className="w-full p-2 rounded border" /></td><td className="pr-2 pb-2"><input value={row.residentNumber || ""} onChange={(e) => setRegistrationRows((rows) => rows.map((item, i) => i === index ? { ...item, residentNumber: formatResidentNumber(e.target.value) } : item))} placeholder="000000-0000000" className="w-full p-2 rounded border font-mono" /></td><td className="pr-2 pb-2"><input value={row.rank} onChange={(e) => setRegistrationRows((rows) => rows.map((item, i) => i === index ? { ...item, rank: e.target.value } : item))} className="w-full p-2 rounded border" /></td><td className="pr-2 pb-2"><select value={row.addReason || "신규입사"} onChange={(e) => setRegistrationRows((rows) => rows.map((item, i) => i === index ? { ...item, addReason: e.target.value } : item))} className="w-full p-2 rounded border"><option value="신규입사">신규입사</option><option value="지점이동">지점이동</option><option value="기타">기타</option></select></td><td className="pr-2 pb-2"><input type="date" value={row.hireDate || row.entryDate || ""} disabled={(row.addReason || "신규입사") !== "신규입사"} onChange={(e) => setRegistrationRows((rows) => rows.map((item, i) => i === index ? { ...item, hireDate: e.target.value, entryDate: e.target.value } : item))} className="w-full p-2 rounded border disabled:bg-gray-100" /></td><td className="pr-2 pb-2"><select value={row.fromBranch || ""} disabled={row.addReason !== "지점이동"} onChange={(e) => setRegistrationRows((rows) => rows.map((item, i) => i === index ? { ...item, fromBranch: e.target.value } : item))} className="w-full p-2 rounded border disabled:bg-gray-100"><option value="">이동 전 지점</option>{directoryBranches.filter((branch) => branch.branchName !== row.branchName).map((branch) => <option key={branch.branchName} value={branch.branchName}>{branch.branchName}</option>)}</select></td><td className="pr-2 pb-2"><input type="date" value={row.transferDate || ""} disabled={row.addReason !== "지점이동"} onChange={(e) => setRegistrationRows((rows) => rows.map((item, i) => i === index ? { ...item, transferDate: e.target.value, entryDate: e.target.value } : item))} className="w-full p-2 rounded border disabled:bg-gray-100" /></td><td className="pr-2 pb-2"><input value={row.addReasonMemo || ""} disabled={row.addReason !== "기타"} onChange={(e) => setRegistrationRows((rows) => rows.map((item, i) => i === index ? { ...item, addReasonMemo: e.target.value } : item))} className="w-full p-2 rounded border disabled:bg-gray-100" /></td><td className="pb-2"><input type="number" value={row.salary} onChange={(e) => setRegistrationRows((rows) => rows.map((item, i) => i === index ? { ...item, salary: e.target.value } : item))} className="w-full p-2 rounded border" /></td></tr>)}</tbody></table></div><p className="text-[11px] text-gray-500 font-bold">수정 추천: 주민등록번호처럼 민감한 정보는 목록에서는 마스킹하고, 수정 버튼을 눌러 별도 확인 후 편집하는 방식이 가장 안전합니다.</p><div className="flex gap-2"><button onClick={() => setRegistrationRows((rows) => [...rows, { branchName: "", name: "", residentNumber: "", rank: "사원", entryDate: "", salary: "", addReason: "신규입사", fromBranch: "", transferDate: "", hireDate: "", addReasonMemo: "" }])} className="px-3 py-2 bg-white border rounded-lg text-xs font-bold">입력칸 추가</button><button onClick={() => void saveRegistrationRows()} className="px-3 py-2 bg-[#2E6DB4] text-white rounded-lg text-xs font-bold">등록 저장</button></div></div>}
                  <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="bg-gray-50 text-gray-500"><tr><th className="px-4 py-3 text-left">직원ID</th><th className="px-4 py-3 text-left">지점</th><th className="px-4 py-3 text-left">이름</th><th className="px-4 py-3 text-left">생년월일</th><th className="px-4 py-3 text-left">직급</th><th className="px-4 py-3 text-left">입사일</th><th className="px-4 py-3 text-right">급여</th><th className="px-4 py-3 text-left">재직년수</th></tr></thead><tbody className="divide-y divide-gray-100">{directoryEmployees.length ? directoryEmployees.map((employee) => <tr key={`${employee.branchName}-${employee.id}`}><td className="px-4 py-3 font-mono text-xs">{employee.employeeId || employee.id}</td><td className="px-4 py-3 font-bold text-[#1A3C6E]">{employee.branchName}</td><td className="px-4 py-3 font-bold">{employee.name}</td><td className="px-4 py-3 font-mono">{formatBirthDate(employee.birthDate || employee.residentNumber)}</td><td className="px-4 py-3">{employee.rank || "사원"}</td><td className="px-4 py-3 font-mono">{formatDate(employee.entryDate)}</td><td className="px-4 py-3 text-right font-mono">{salaryUnlocked && employee.salary ? formatNumber(employee.salary) : "잠김"}</td><td className="px-4 py-3">{formatTenure(employee.entryDate)}</td></tr>) : <tr><td colSpan={8} className="px-5 py-16 text-center text-gray-400">등록된 정직원이 없습니다.</td></tr>}</tbody></table></div>
                </>
              )}
              {directoryLoading ? <div className="py-20 text-center"><LoadingSpinner size="md" /></div> : directoryTab === "roster" ? (
                <div className="hidden">
                  <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-gray-50 text-gray-500"><tr><th className="px-5 py-3 text-left">지점</th><th className="px-5 py-3 text-left">직원명</th><th className="px-5 py-3 text-left">직급</th><th className="px-5 py-3 text-left">주민등록번호</th><th className="px-5 py-3 text-left">입사일</th></tr></thead><tbody className="divide-y divide-gray-100">{directoryEmployees.length ? directoryEmployees.map((employee) => <tr key={`${employee.branchName}-${employee.id}`}><td className="px-5 py-3 font-bold text-[#1A3C6E]">{employee.branchName}</td><td className="px-5 py-3 font-bold">{employee.name}</td><td className="px-5 py-3">{employee.rank || "사원"}</td><td className="px-5 py-3 font-mono">{maskResidentNumber(employee.residentNumber)}</td><td className="px-5 py-3 font-mono">{employee.entryDate || "-"}</td></tr>) : <tr><td colSpan={5} className="px-5 py-16 text-center text-gray-400">등록된 정직원이 없습니다.</td></tr>}</tbody></table></div>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="bg-gray-50 text-gray-500"><tr><th className="px-5 py-3 text-left">처리일</th><th className="px-5 py-3 text-left">구분</th><th className="px-5 py-3 text-left">직원명</th><th className="px-5 py-3 text-left">기존 지점</th><th className="px-5 py-3 text-left">이동 지점</th></tr></thead><tbody className="divide-y divide-gray-100">{movementHistory.length ? movementHistory.map((item, index) => <tr key={item.id || index}><td className="px-5 py-3 font-mono">{item.effectiveDate || "-"}</td><td className="px-5 py-3 font-bold">{item.type || "-"}</td><td className="px-5 py-3 font-bold">{item.employeeName || "-"}</td><td className="px-5 py-3">{item.fromBranch || "-"}</td><td className="px-5 py-3">{item.toBranch || "-"}</td></tr>) : <tr><td colSpan={5} className="px-5 py-16 text-center text-gray-400">등록된 퇴사 또는 지점이동 내역이 없습니다.</td></tr>}</tbody></table></div></div>
              )}
            </section>
          )}
        </main>
      </div>

      {/* ----------------------------------------------------
          [우측 슬라이드인 드로어 상세정보]
         ---------------------------------------------------- */}
      <AnimatePresence>
        {isDrawerOpen && selectedRow && (
          <div 
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end"
            id="drawer-backdrop"
          >
            {/* 백드롭 클릭 시 닫기 */}
            <div className="absolute inset-0 cursor-pointer" onClick={handleCloseDrawer} />

            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.3 }}
              className="relative w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col z-10 overflow-hidden"
              id="drawer-container"
            >
              {/* 드로어 헤더 */}
              <div className="p-6 bg-[#1A3C6E] text-white flex items-center justify-between shrink-0">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-[#D6E4F0]">정산 일자: {selectedRow.record?.settleDate}</span>
                  <h3 className="text-xl font-extrabold tracking-tight">{selectedRow.branchName} 상세 내역</h3>
                </div>
                <button
                  onClick={handleCloseDrawer}
                  className="p-2 hover:bg-white/10 rounded-full transition-all cursor-pointer text-white/80 hover:text-white"
                  title="닫기"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 드로어 스크롤 바디 */}
              <div className="grow overflow-y-auto p-6 space-y-6" id="drawer-scroll-body">
                {detailLoading ? (
                  <div className="h-64 flex flex-col items-center justify-center gap-3">
                    <LoadingSpinner />
                    <span className="text-xs text-gray-400 font-bold">영격 상세 데이터를 수집 중입니다...</span>
                  </div>
                ) : detailData ? (
                  <>
                    {/* [드로어 1] 매출 및 수정 로그 */}
                    <div className="bg-[#D6E4F0]/20 p-5 rounded-2xl border border-[#D6E4F0] space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-[#1A3C6E] tracking-wider uppercase">최종 정산 합계</span>
                        <div className="flex gap-2">
                          {!isEditing ? (
                            <button
                              onClick={handleStartEdit}
                              className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-gray-50 text-gray-600 border border-gray-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                              id="btn-drawer-edit"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-[#2E6DB4]" /> 편집
                            </button>
                          ) : (
                            <div className="flex gap-1.5">
                              <button
                                onClick={handleCancelEdit}
                                className="px-3 py-1 bg-white hover:bg-gray-100 text-gray-500 text-xs font-semibold border rounded-lg cursor-pointer"
                              >
                                취소
                              </button>
                              <button
                                onClick={() => setIsSaveConfirmOpen(true)}
                                className="flex items-center gap-1 px-3 py-1 bg-[#2E6DB4] hover:bg-[#1A3C6E] text-white text-xs font-semibold rounded-lg cursor-pointer"
                              >
                                <Save className="w-3.5 h-3.5" /> 저장
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 인라인 수정 분기 처리 */}
                      {isEditing ? (
                        <div className="space-y-3.5 bg-white p-4 rounded-xl border border-dashed border-[#2E6DB4]">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <span className="text-[11px] font-bold text-gray-400 block">현금 매출 *</span>
                              <NumberInput
                                value={editCashSales}
                                onChange={setEditCashSales}
                                id="edit-cash-sales"
                              />
                            </div>
                            <div className="space-y-1">
                              <span className="text-[11px] font-bold text-gray-400 block">카드 매출 *</span>
                              <NumberInput
                                value={editCardSales}
                                onChange={setEditCardSales}
                                id="edit-card-sales"
                              />
                            </div>
                            <div className="space-y-1">
                              <span className="text-[11px] font-bold text-gray-400 block">계좌이체 매출</span>
                              <NumberInput
                                value={editTransferSales}
                                onChange={setEditTransferSales}
                                id="edit-transfer-sales"
                              />
                            </div>
                            <div className="space-y-1">
                              <span className="text-[11px] font-bold text-gray-400 block">배달 매출</span>
                              <NumberInput
                                value={editDeliverySales}
                                onChange={setEditDeliverySales}
                                id="edit-delivery-sales"
                              />
                            </div>
                          </div>
                          
                          <div className="space-y-1 pt-1.5">
                            <span className="text-[11px] font-bold text-gray-400 block">특이사항 메모 수정</span>
                            <textarea
                              rows={3}
                              value={editMemo}
                              onChange={(e) => setEditMemo(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-200 text-sm text-gray-700 rounded-lg outline-hidden focus:border-[#2E6DB4] resize-none"
                            />
                          </div>
                        </div>
                      ) : (
                        /* 단순 정보 출력 화면 */
                        <div className="divide-y divide-[#D6E4F0] font-mono text-sm space-y-1">
                          <div className="flex justify-between py-2 items-center">
                            <span className="text-gray-500 font-sans font-semibold">현금 매출</span>
                            <span className="font-bold text-[#2C3E50]">{formatNumber(detailData.master.cashSales)} 원</span>
                          </div>
                          <div className="flex justify-between py-2 items-center">
                            <span className="text-gray-500 font-sans font-semibold">카드 매출</span>
                            <span className="font-bold text-[#2C3E50]">{formatNumber(detailData.master.cardSales)} 원</span>
                          </div>
                          <div className="flex justify-between py-2 items-center">
                            <span className="text-gray-500 font-sans font-semibold">계좌이체 매출</span>
                            <span className="font-bold text-gray-600">{formatNumber(detailData.master.transferSales || 0)} 원</span>
                          </div>
                          <div className="flex justify-between py-2 items-center">
                            <span className="text-gray-500 font-sans font-semibold">배달 주문 매출</span>
                            <span className="font-bold text-gray-600">{formatNumber(detailData.master.deliverySales || 0)} 원</span>
                          </div>
                          <div className="flex justify-between py-3 items-center text-base border-t border-[#D6E4F0]">
                            <span className="text-[#1A3C6E] font-sans font-extrabold text-sm">실시간 매출 합산</span>
                            <span className="font-black text-[#1A3C6E]">{formatNumber(detailData.master.totalSales)} 원</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* [드로어 2] 현금 및 카드 지출 배열 상세 */}
                    <div className="space-y-4">
                      <h4 className="text-sm font-extrabold text-gray-600 border-l-4 border-[#2E6DB4] pl-2">당일 기록 지출 목록</h4>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* 현금 지출 내역 목록 */}
                        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                          <span className="text-xs font-bold text-gray-400 block mb-3">금고 현금 지출</span>
                          {detailData.expenses.filter(e => e.expenseType === "현금지출").length === 0 ? (
                            <p className="text-xs text-gray-400 py-3 text-center">등록된 현금 지출 없음</p>
                          ) : (
                            <ul className="space-y-2 max-h-48 overflow-y-auto">
                              {detailData.expenses.filter(e => e.expenseType === "현금지출").map((e, idx) => (
                                <li key={idx} className="flex justify-between items-center text-xs text-gray-600 py-1 border-b border-gray-100 font-mono">
                                  <span className="font-sans font-medium text-gray-500 truncate max-w-[120px]" title={e.itemName}>{e.itemName}</span>
                                  <span className="font-bold text-red-500">-{formatNumber(e.amount)}원</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        {/* 카드 지출 내역 목록 */}
                        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                          <span className="text-xs font-bold text-gray-400 block mb-3">법인 카드 지출</span>
                          {detailData.expenses.filter(e => e.expenseType === "카드지출").length === 0 ? (
                            <p className="text-xs text-gray-400 py-3 text-center">등록된 카드 지출 없음</p>
                          ) : (
                            <ul className="space-y-2 max-h-48 overflow-y-auto">
                              {detailData.expenses.filter(e => e.expenseType === "카드지출").map((e, idx) => (
                                <li key={idx} className="flex justify-between items-center text-xs text-gray-600 py-1 border-b border-gray-100 font-mono">
                                  <span className="font-sans font-medium text-gray-500 truncate max-w-[120px]" title={e.itemName}>{e.itemName}</span>
                                  <span className="font-bold text-orange-500">-{formatNumber(e.amount)}원</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* [드로어 3] 투입 인력 및 총 시간 */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-extrabold text-gray-600 border-l-4 border-[#2E6DB4] pl-2">당일 업무 투입 정원</h4>
                      <div className="p-4 bg-gray-50 border border-gray-100 rounded-2xl">
                        {detailData.staff.length === 0 ? (
                          <p className="text-xs text-gray-400 py-3 text-center">외근 및 근무 투입 기록 없음</p>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {detailData.staff.map((st, idx) => (
                              <div key={idx} className="bg-white px-3.5 py-2.5 rounded-xl border border-gray-100 flex justify-between items-center text-xs font-mono">
                                <span className="font-sans text-gray-500 font-semibold">{st.staffName}</span>
                                <span className="text-[#2E6DB4] font-bold">{st.workHours}H</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* [드로어 4] 특이사항 메모 본문 */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-extrabold text-gray-600 border-l-4 border-[#2E6DB4] pl-2">전달된 특이사항 메모</h4>
                      <div className="p-4 bg-rose-50/30 border border-rose-100/50 rounded-2xl block text-sm text-gray-600 leading-relaxed min-h-[80px]">
                        {detailData.master.memo ? detailData.master.memo : <span className="text-gray-400 text-xs italic">추가 기재된 특이 상이 존재하지 않습니다.</span>}
                      </div>
                    </div>

                    {/* [드로어 5] 연동 제어 기록 및 메타 */}
                    <div className="pt-4 border-t border-gray-100 space-y-1.5 text-[11px] text-gray-400 font-medium">
                      <div className="flex justify-between">
                        <span>제출 시간</span>
                        <span>{new Date(detailData.master.submittedAt || "").toLocaleString()}</span>
                      </div>
                      {detailData.master.modifiedAt && (
                        <div className="flex justify-between text-yellow-600 font-bold">
                          <span>최종 수정 보고: {detailData.master.modifiedBy}</span>
                          <span>{new Date(detailData.master.modifiedAt).toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-center text-xs text-gray-400 py-12">데이터를 불러오지 못했습니다.</p>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 공통 알람 및 모달창 백그라운드 구동 */}
      <AnimatePresence>
        {toast && (
          <ToastMessage
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </AnimatePresence>

      <ConfirmModal
        isOpen={isSaveConfirmOpen}
        title="마감 데이터 직접 수정 승인"
        message="지점의 마감 정산액을 고의 정정하시겠습니까? 구글 시트에 업데이트되며, 정정 사항이 수정_로그 시트에 자동으로 추적 기록되어 저장됩니다."
        confirmText="정산 저장"
        cancelText="돌아가기"
        type="warning"
        onConfirm={handleSaveEdit}
        onCancel={() => setIsSaveConfirmOpen(false)}
      />

      {saving && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-xs flex items-center justify-center z-[60]">
          <div className="bg-white px-8 py-6 rounded-2xl shadow-xl flex flex-col items-center gap-3">
            <LoadingSpinner size="lg" />
            <span className="text-xs text-gray-500 font-bold">구글 스프레드시트 업데이트 및 정정 로그 기록 중...</span>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminLatestNoticeHeadline() {
  const [notices, setNotices] = useState<any[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const saved = await gasClient.getSharedData<any[]>("admin_dashboard_notices").catch(() => []);
    setNotices(Array.isArray(saved) ? saved.filter((notice) => notice?.title || notice?.body) : []);
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener("admin_dashboard_notices_updated", load);
    return () => window.removeEventListener("admin_dashboard_notices_updated", load);
  }, [load]);

  if (notices.length === 0) {
    return <h1>등록된 관리자 공지사항이 없습니다.</h1>;
  }

  const latest = notices[0];

  return (
    <div className="admin-latest-notice-headline">
      <button type="button" onClick={() => setOpen((current) => !current)}>
        <h1>{latest.title}</h1>
      </button>
      {open && (
        <div className="admin-registered-notices rounded-2xl border border-gray-100 p-4 space-y-2">
          {notices.slice(0, 3).map((notice) => (
            <div key={notice.id} className="admin-notice-item flex items-start justify-between gap-3 rounded-xl border border-slate-100 p-3">
              <div>
                <p className="text-sm font-black text-gray-800">{notice.title}</p>
                <p className="text-xs text-gray-500 mt-1">{notice.body}</p>
              </div>
              <span className="rounded-full px-2 py-1 text-[10px] font-black">관리자 공지</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminNoticeManager() {
  const [notices, setNotices] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [noticeTab, setNoticeTab] = useState<"admin" | "branch">("branch");
  const [targetBranch, setTargetBranch] = useState("전체");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingNoticeId, setEditingNoticeId] = useState<string | null>(null);
  const noticeStorageKey = noticeTab === "admin" ? "admin_dashboard_notices" : "admin_notices";
  // 지금 화면이 어느 공지함인지. 저장이 실패해 되돌릴 때, 그 사이 탭이 바뀌지 않았는지 확인하는 데 쓴다
  // (관리자 공지 화면에 지점 공지 목록을 되돌려 놓으면, 다음 저장 때 그 목록이 엉뚱한 키로 저장된다).
  //
  // **렌더 단계에서 갱신한다. useEffect로 미루면 안 된다** — effect는 그려진 뒤에 도는데,
  // 탭을 바꾼 직후 effect가 아직 돌지 않은 그 틈에 옛 탭의 저장이 실패하면 이 값이 아직 옛 키라
  // 가드를 그대로 통과해 새 탭 화면에 옛 목록을 덮어쓴다.
  // (연차관리도 같은 이유로 지점 전환 감지를 effect가 아닌 렌더 단계에서 한다 — 커밋 1246795)
  const noticeKeyRef = useRef(noticeStorageKey);
  noticeKeyRef.current = noticeStorageKey;

  const load = useCallback(async () => {
    const [saved, branchList] = await Promise.all([
      gasClient.getSharedData<any[]>(noticeStorageKey).catch(() => []),
      gasClient.getBranchList().catch(() => [])
    ]);
    setNotices(Array.isArray(saved) ? saved : []);
    setBranches(Array.isArray(branchList) ? branchList : []);
  }, [noticeStorageKey]);

  useEffect(() => {
    void load();
    setEditingNoticeId(null);
    setTitle("");
    setBody("");
  }, [load]);

  /**
   * 공지 저장.
   *
   * 저장 한 번은 클라우드를 세 번 오간다(기존 값 읽기 → 백업 쓰기 → 실제 쓰기).
   * 그걸 다 기다린 뒤에 화면을 바꾸면 등록 버튼이 한참 멈춘 것처럼 보인다.
   * 그래서 화면은 먼저 바꾸고 저장은 뒤에서 돌린다 — 백업 단계는 손대지 않는다.
   * (백업은 덮어쓰기 전의 옛 값을 읽어야 하므로 기다리지 않게 만들면 새 값이 백업될 수 있다.)
   *
   * 실패하면 목록을 되돌리고 **쓰던 글을 그대로 되살린다.** 예전에는 catch가 아예 없어서
   * 저장이 실패해도 아무 말이 없었다 — 등록된 줄 알고 지나가면 그 공지는 어디에도 없다.
   */
  const saveNotice = async () => {
    if (!title.trim() && !body.trim()) return;
    const now = new Date().toISOString();
    const next = editingNoticeId
      ? notices.map((notice) => notice.id === editingNoticeId ? { ...notice, targetBranch, title: title.trim() || "공지사항", body: body.trim(), updatedAt: now } : notice)
      : [{ id: `notice-${Date.now()}`, targetBranch, title: title.trim() || "공지사항", body: body.trim(), createdAt: now }, ...notices].slice(0, 20);
    // 실패했을 때 되살릴 것들
    const previousNotices = notices;
    const draft = { editingNoticeId, targetBranch, title, body };

    const keyAtStart = noticeStorageKey;

    setNotices(next);
    setEditingNoticeId(null);
    setTitle("");
    setBody("");
    setSaving(true);
    try {
      await gasClient.saveSharedData(keyAtStart, next);
      // 대시보드 갱신은 저장이 끝난 뒤에 알린다. 먼저 알리면 대시보드가 아직 옛 값이 든
      // 서버를 다시 읽어 새 공지가 없는 것처럼 보인다.
      if (keyAtStart === "admin_dashboard_notices") window.dispatchEvent(new Event("admin_dashboard_notices_updated"));
    } catch (error) {
      console.error("공지 저장 실패:", error);
      // 저장하는 사이 다른 공지함으로 옮겨갔다면 화면을 건드리지 않는다 —
      // 지금 보이는 목록은 다른 공지함의 것이라, 되돌리면 남의 목록을 덮어쓴다.
      // (탭을 옮기면 입력창은 이미 비워지므로 되살릴 초안도 없다.)
      const restored = noticeKeyRef.current === keyAtStart;
      if (restored) {
        setNotices(previousNotices);
        setEditingNoticeId(draft.editingNoticeId);
        setTargetBranch(draft.targetBranch);
        setTitle(draft.title);
        setBody(draft.body);
      }
      // 되살리지 못했으면 되살렸다고 말하지 않는다. 저장 중 탭 전환은 위에서 막았으므로
      // 여기 걸릴 일은 거의 없지만, 안내가 사실과 달라지는 쪽으로는 절대 두지 않는다.
      window.alert(restored
        ? "공지 저장에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 등록해 주세요.\n\n작성하신 내용은 그대로 두었습니다."
        : `공지 저장에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 등록해 주세요.\n\n[작성하신 내용]\n제목: ${draft.title}\n내용: ${draft.body}`);
    } finally {
      setSaving(false);
    }
  };

  const startEditNotice = (notice: any) => {
    setEditingNoticeId(notice.id);
    setTargetBranch(notice.targetBranch || "전체");
    setTitle(notice.title || "");
    setBody(notice.body || notice.content || "");
  };

  const cancelEditNotice = () => {
    setEditingNoticeId(null);
    setTitle("");
    setBody("");
    setTargetBranch("전체");
  };

  /** 저장과 같은 규칙 — 화면에서 먼저 지우고, 실패하면 되돌리고 알린다. */
  const deleteNotice = async (id: string) => {
    if (!window.confirm("공지사항을 삭제할까요?")) return;
    const previousNotices = notices;
    const next = notices.filter((notice) => notice.id !== id);
    const keyAtStart = noticeStorageKey;
    setNotices(next);
    setSaving(true);
    try {
      await gasClient.saveSharedData(keyAtStart, next);
      if (keyAtStart === "admin_dashboard_notices") window.dispatchEvent(new Event("admin_dashboard_notices_updated"));
    } catch (error) {
      console.error("공지 삭제 실패:", error);
      // 저장과 같은 이유 — 그 사이 공지함을 옮겼으면 지금 화면을 건드리지 않는다.
      if (noticeKeyRef.current === keyAtStart) setNotices(previousNotices);
      window.alert("공지 삭제에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-notice-manager bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
      <div>
        <h2 className="text-lg font-black text-[#2C3E50]">공지사항</h2>
        <p className="text-xs text-gray-400 mt-1">여기에 작성한 공지는 각 지점 대시보드 첫 화면에 표시됩니다.</p>
      </div>
      <div className="flex rounded-xl bg-slate-100 p-1 w-fit">
        {/* 저장하는 동안은 공지함을 옮기지 못하게 막는다.
            옮겨 버리면 탭 전환이 입력창을 비우는데, 그 사이 저장이 실패해도 되살릴 곳이 없어
            애써 쓴 글이 사라진다(그러면서 "그대로 두었다"고 알리게 된다 — 거짓말이 된다).
            저장은 1초 안쪽이라 잠깐 잠기는 것이 글을 잃는 것보다 낫다. */}
        <button onClick={() => setNoticeTab("admin")} disabled={saving} className={`admin-notice-tab admin-notice-tab-admin px-3 py-1.5 rounded-lg text-xs font-black disabled:opacity-50 disabled:cursor-not-allowed ${noticeTab === "admin" ? "is-active shadow-sm" : "text-gray-500"}`}>관리자 공지</button>
        <button onClick={() => setNoticeTab("branch")} disabled={saving} className={`admin-notice-tab admin-notice-tab-branch px-3 py-1.5 rounded-lg text-xs font-black disabled:opacity-50 disabled:cursor-not-allowed ${noticeTab === "branch" ? "is-active shadow-sm" : "text-gray-500"}`}>공지사항</button>
      </div>
      <div className="admin-notice-form space-y-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-3">
          <select value={targetBranch} onChange={(e) => setTargetBranch(e.target.value)} disabled={noticeTab === "admin"} className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold bg-white disabled:bg-gray-100 disabled:text-gray-400">
            <option value="전체">전체공지</option>
            {branches.map((branch) => <option key={branch.branchName} value={branch.branchName}>{branch.branchName}</option>)}
          </select>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="공지 제목" className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold bg-white" />
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="공지 내용" rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold resize-y min-h-[88px] bg-white leading-relaxed" />
        <div className="flex justify-end">
          {editingNoticeId && (
            <button onClick={cancelEditNotice} disabled={saving} className="px-5 py-3 bg-white text-gray-600 border border-gray-200 rounded-xl text-xs font-black disabled:opacity-50">
              수정 취소
            </button>
          )}
          <button onClick={() => void saveNotice()} disabled={saving} className="min-w-[160px] px-5 py-3 bg-[#2E6DB4] text-white rounded-xl text-xs font-black disabled:opacity-50">{saving ? "저장 중…" : editingNoticeId ? "공지 수정" : "공지 등록"}</button>
        </div>
      </div>
      {notices.length > 0 ? (
        <div className="space-y-2">
          {notices.slice(0, 3).map((notice) => (
            <div key={notice.id} className="admin-notice-item flex items-start justify-between gap-3 rounded-xl bg-slate-50 border border-slate-100 p-3">
              <div>
                <p className="text-sm font-black text-gray-800">{notice.title} <span className="ml-2 rounded bg-blue-50 px-2 py-0.5 text-[10px] text-[#2E6DB4]">{notice.targetBranch || "전체"}</span></p>
                <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{notice.body}</p>
              </div>
              {/* 저장이 도는 동안은 잠근다.
                  공지 저장은 목록 "전체"를 한 덩어리로 덮어쓴다. 화면이 즉시 반응하니 연달아 누르기 쉬운데,
                  그러면 두 요청이 동시에 날아가고 늦게 도착한 쪽이 옛 목록으로 덮어써서
                  지운 공지가 다른 노트북에 되살아난다. 한 번에 하나씩만 보낸다. */}
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => startEditNotice(notice)} disabled={saving} className="text-xs font-black text-[#2E6DB4] disabled:opacity-40 disabled:cursor-not-allowed">수정</button>
                <button onClick={() => void deleteNotice(notice.id)} disabled={saving} className="text-xs font-black text-rose-600 disabled:opacity-40 disabled:cursor-not-allowed">삭제</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="admin-notice-empty rounded-xl border border-slate-100 p-3 text-xs font-bold text-gray-500">
          등록된 {noticeTab === "admin" ? "관리자 공지" : "공지사항"}이 없습니다.
        </div>
      )}
    </section>
  );
}

function AdminDashboardAlertHub({
  pendingDailyCount,
  alerts,
  loading,
  onRefresh,
  onOpen
}: {
  pendingDailyCount: number;
  alerts: { editLogs: number; manualOvertimes: number };
  loading: boolean;
  onRefresh: () => void;
  onOpen: (target: "dailyPending" | "editLogs" | "manualOvertimes") => void;
}) {
  const totalAlerts = pendingDailyCount + alerts.editLogs + alerts.manualOvertimes;

  return (
    <section className="admin-dashboard-alert-hub bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-[#2C3E50]">새로 확인할 항목</h2>
          <p className="text-xs text-gray-400 mt-1">버튼을 누르면 해당 사이드바 탭으로 이동하고, 신규 변경 항목은 확인 처리됩니다.</p>
        </div>
        <button onClick={onRefresh} className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black">
          {loading ? "확인 중..." : "새로고침"}
        </button>
      </div>

      {totalAlerts === 0 ? (
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4 text-sm font-bold text-emerald-700">
          새로 확인할 항목이 없습니다.
        </div>
      ) : (
        <div className="admin-dashboard-alert-actions flex flex-col gap-2">
          {pendingDailyCount > 0 && (
            <button onClick={() => onOpen("dailyPending")} className="px-4 py-2 rounded-xl bg-amber-50 text-amber-700 border border-amber-100 text-sm font-black hover:bg-amber-100">
              일일정산 미제출: {pendingDailyCount}건
            </button>
          )}
          {alerts.editLogs > 0 && (
            <button onClick={() => onOpen("editLogs")} className="px-4 py-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 text-sm font-black hover:bg-blue-100">
              정산 변경: {alerts.editLogs}건
            </button>
          )}
          {alerts.manualOvertimes > 0 && (
            <button onClick={() => onOpen("manualOvertimes")} className="px-4 py-2 rounded-xl bg-violet-50 text-violet-700 border border-violet-100 text-sm font-black hover:bg-violet-100">
              초과근무 수기작성: {alerts.manualOvertimes}건
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// 이번 달에 일일마감을 빠뜨린(기록 없는) 날짜를 지점별로 보여준다.
// 기대 일수: 지난달이면 말일까지, 이번달이면 '어제'까지(오늘치는 아직 마감 전일 수 있어 제외).
function AdminMonthlyMissingDaysPanel({ month }: { month: string }) {
  const [rows, setRows] = useState<Array<{ branchName: string; missing: number[]; error?: boolean }> | null>(null);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setLoadError(false);
    (async () => {
      try {
        const branchList = (await gasClient.getBranchList()).filter((b: any) => b?.role === "branch" && b.branchName);
        const [y, m] = month.split("-").map(Number);
        if (!y || !m) { if (!cancelled) setRows([]); return; }
        const daysInMonth = new Date(y, m, 0).getDate();
        const today = new Date();
        const isCurrentMonth = today.getFullYear() === y && today.getMonth() + 1 === m;
        const cutoff = isCurrentMonth ? Math.max(0, today.getDate() - 1) : daysInMonth;
        const result = await Promise.all(branchList.map(async (b: any) => {
          // 읽기 실패를 '빈 이력=전부 빠짐'으로 오해하면 안 된다(fail-closed):
          // 반드시 서버 전용 조회를 쓴다 — getBranchHistory는 실패를 []로 삼켜(gasClient) 이 센티넬이 무력화된다.
          // 실패는 throw → null 센티넬로 잡아 '확인 불가'로 표시한다.
          const history = await gasClient.getBranchHistoryFromServer(b.branchName, month).catch(() => null);
          if (history === null) return { branchName: b.branchName, missing: [], error: true };
          const submitted = new Set<number>();
          (Array.isArray(history) ? history : []).forEach((r: any) => {
            const d = String(r.settleDate || "");
            if (d.slice(0, 7) === month) { const day = Number(d.split("-")[2]); if (day) submitted.add(day); }
          });
          const missing: number[] = [];
          for (let d = 1; d <= cutoff; d++) if (!submitted.has(d)) missing.push(d);
          return { branchName: b.branchName, missing };
        }));
        // 확인 불가(에러) 지점을 위로, 그다음 빠진 일수 많은 순.
        if (!cancelled) setRows(
          result
            .filter((r) => r.error || r.missing.length > 0)
            .sort((a, b) => Number(!!b.error) - Number(!!a.error) || b.missing.length - a.missing.length)
        );
      } catch {
        // 지점 목록 자체를 못 불러온 경우 — 초록 '이상 없음'으로 오도하지 않도록 별도 에러 표시.
        if (!cancelled) { setRows([]); setLoadError(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [month]);

  return (
    <div className="bg-white p-5 rounded-2xl shadow-xs border border-gray-100 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-[#F39C12]" />
        <h3 className="text-sm font-black text-[#2C3E50]">이번 달 미작성 지점 <span className="font-bold text-gray-400">({month} · 기록 없는 날짜 · 어제까지 기준)</span></h3>
      </div>
      {rows === null ? (
        <p className="text-xs font-bold text-gray-400">불러오는 중…</p>
      ) : loadError ? (
        <p className="text-xs font-bold text-rose-600">지점 목록을 서버에서 불러오지 못했습니다. 새로고침 후 다시 확인해주세요. (미작성 여부를 확인하지 못했습니다.)</p>
      ) : rows.length === 0 ? (
        <p className="text-xs font-bold text-emerald-600">모든 지점이 이번 달 일일마감을 빠짐없이 작성했습니다.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.branchName} className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-3 border-b border-gray-50 pb-2 last:border-0 last:pb-0">
              <span className="shrink-0 inline-flex items-center gap-1.5 min-w-36">
                <span className="font-black text-[#2C3E50] text-sm">{r.branchName}</span>
                {r.error ? (
                  <span className="inline-flex px-1.5 py-0.5 rounded-md bg-gray-200 text-gray-600 text-[10px] font-black">확인 불가</span>
                ) : (
                  <span className="inline-flex px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-700 text-[10px] font-black">{r.missing.length}일 빠짐</span>
                )}
              </span>
              <span className="text-xs font-bold text-gray-500 leading-relaxed">
                {r.error ? "서버 응답이 없어 작성 여부를 확인하지 못했습니다." : r.missing.map((d) => `${d}일`).join(", ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminDailySettlementStatusSection({
  selectedDate,
  setSelectedDate,
  selectedBrand,
  setSelectedBrand,
  brandList,
  stats,
  loading,
  filteredList,
  handleDownloadExcel,
  handleOpenDetail
}: {
  selectedDate: string;
  setSelectedDate: (value: string) => void;
  selectedBrand: string;
  setSelectedBrand: (value: string) => void;
  brandList: string[];
  stats: { total: number; submitted: number; pending: number; revenue: number };
  loading: boolean;
  filteredList: DailyListRow[];
  handleDownloadExcel: () => void;
  handleOpenDetail: (row: DailyListRow) => void;
}) {
  return (
    <section className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#2C3E50] tracking-tight">전일 정산현황</h2>
          <p className="text-xs text-gray-400 mt-0.5 font-medium">선택한 날짜 기준으로 지점별 제출 상태와 매출 합계를 확인합니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 border border-gray-200 bg-white py-2 px-3 rounded-xl shadow-xs">
            <Calendar className="w-4 h-4 text-[#2E6DB4]" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="font-mono text-xs font-extrabold text-[#2C3E50] border-0 outline-hidden bg-transparent focus:ring-0 p-0 w-32"
            />
          </div>
          <button onClick={handleDownloadExcel} className="flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer">
            <Download className="w-4 h-4" /> 엑셀 다운로드
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white p-5 rounded-2xl shadow-xs border border-gray-100 flex items-center justify-between">
          <div className="space-y-1"><span className="text-xs font-bold text-gray-400 block">제출 지점</span><span className="text-2xl font-mono font-black text-[#2C3E50]">{stats.submitted} <span className="text-xs font-bold text-gray-300 font-sans">/ {stats.total}</span></span></div>
          <div className="p-4 bg-emerald-50 rounded-2xl text-emerald-600"><CheckCircle2 className="w-6 h-6" /></div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-xs border border-gray-100 flex items-center justify-between">
          <div className="space-y-1"><span className="text-xs font-bold text-gray-400 block">미제출 지점</span><span className="text-2xl font-mono font-black text-[#2C3E50]">{stats.pending}</span></div>
          <div className="p-4 bg-amber-50 rounded-2xl text-[#F39C12]"><AlertTriangle className="w-6 h-6" /></div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-xs border border-gray-100 flex items-center justify-between">
          <div className="space-y-1"><span className="text-xs font-bold text-gray-400 block">총 수집 매출</span><span className="text-2xl font-mono font-black text-[#2E6DB4]">{formatNumber(stats.revenue)}원</span></div>
          <div className="p-4 bg-blue-50 text-[#2E6DB4] rounded-2xl"><TrendingUp className="w-6 h-6" /></div>
        </div>
      </div>

      {/* 선택한 날짜가 속한 '이번 달' 전체에서 일일마감을 빠뜨린 지점·날짜를 한눈에. */}
      <AdminMonthlyMissingDaysPanel month={selectedDate.slice(0, 7)} />

      <div className="bg-white p-4 rounded-2xl shadow-xs border border-gray-100 flex flex-wrap gap-4 items-center justify-between">
        <div className="flex items-center gap-2"><Filter className="w-4 h-4 text-gray-400 shrink-0" /><span className="text-xs font-bold text-gray-500">브랜드 필터</span></div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 max-w-full">
          {brandList.map((brand) => (
            <button key={brand} onClick={() => setSelectedBrand(brand)} className={`px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer transition-colors whitespace-nowrap ${selectedBrand === brand ? "bg-[#2E6DB4] text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
              {brand}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-xs border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead><tr className="bg-[#D6E4F0]/30 border-b border-gray-100 text-left"><th className="px-6 py-4 text-xs font-bold text-gray-500">지점명</th><th className="px-6 py-4 text-xs font-bold text-gray-500">브랜드</th><th className="px-6 py-4 text-xs font-bold text-gray-500 text-right">총 매출</th><th className="px-4 py-4 text-xs font-bold text-gray-400 text-right">현금</th><th className="px-4 py-4 text-xs font-bold text-gray-400 text-right">카드</th><th className="px-6 py-4 text-xs font-bold text-gray-500">상태</th><th className="px-6 py-4 text-xs font-bold text-gray-500 text-center">관리</th></tr></thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-16"><LoadingSpinner size="md" /></td></tr>
              ) : filteredList.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-16 text-gray-400 text-xs">조건에 맞는 지점이 없습니다.</td></tr>
              ) : filteredList.map((item) => {
                const record = item.record;
                return (
                  <tr key={item.branchName} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 font-bold text-[#2C3E50]">{item.branchName}</td>
                    <td className="px-6 py-4 text-xs text-gray-500 font-semibold">{item.brand}</td>
                    <td className="px-6 py-4 text-right font-mono font-bold text-[#1A3C6E]">{record ? `${formatNumber(record.totalSales)}원` : "-"}</td>
                    <td className="px-4 py-4 text-right font-mono text-xs text-gray-500">{record ? formatNumber(record.cashSales) : "-"}</td>
                    <td className="px-4 py-4 text-right font-mono text-xs text-gray-500">{record ? formatNumber(record.cardSales) : "-"}</td>
                    <td className="px-6 py-4">{item.submitted ? <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-full"><CheckCircle2 className="w-3.5 h-3.5" /> 완료</span> : <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 text-[#F39C12] text-xs font-bold rounded-full"><AlertTriangle className="w-3.5 h-3.5" /> 미제출</span>}</td>
                    <td className="px-6 py-4 text-center">{item.submitted ? <button onClick={() => handleOpenDetail(item)} className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-[#D6E4F0]/60 text-gray-600 hover:text-[#1A3C6E] text-xs font-bold rounded-xl transition-all cursor-pointer"><Eye className="w-3.5 h-3.5" /> 상세 보기</button> : <span className="text-xs text-gray-300 font-semibold">대기중</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function AdminCashManagementSection({ fixedTab }: { fixedTab?: "cashManagement" | "cashExpenses" } = {}) {
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  });
  const [selectedBranch, setSelectedBranch] = useState("전체");
  const [activeTab, setActiveTab] = useState<"cashManagement" | "cashExpenses">(fixedTab || "cashManagement");
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [cashRows, setCashRows] = useState<any[]>([]);
  const [expenseRows, setExpenseRows] = useState<any[]>([]);

  const parseMetadata = (memo?: string | null) => {
    const parts = String(memo || "").split("\n---\nMETADATA:");
    if (!parts[1]) return {};
    try {
      return JSON.parse(parts[1].trim());
    } catch {
      return {};
    }
  };

  useEffect(() => {
    if (fixedTab) setActiveTab(fixedTab);
  }, [fixedTab]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const branchList = await gasClient.getBranchList();
      const activeBranches = (Array.isArray(branchList) ? branchList : []).filter((branch: any) => branch?.role === "branch" && branch.branchName);
      setBranches(activeBranches);
      const targets = selectedBranch === "전체"
        ? activeBranches
        : activeBranches.filter((branch: any) => branch.branchName === selectedBranch);

      const histories = await Promise.all(targets.map(async (branch: any) => ({
        branch,
        history: await gasClient.getBranchHistory(branch.branchName, selectedMonth).catch(() => [])
      })));

      const nextCashRows: any[] = [];
      const nextExpenseRows: any[] = [];

      histories.forEach(({ branch, history }) => {
        (history || []).forEach((record: any) => {
          if (!String(record.settleDate || "").startsWith(selectedMonth)) return;
          const meta = parseMetadata(record.memo);
          const cashExpenses = Array.isArray(meta.cashExpenses) ? meta.cashExpenses : [];
          const cashExpenseTotal = cashExpenses.reduce((sum: number, item: any) => sum + (Number(item.amount) || 0), 0);
          const prevDayCash = Number(meta.prevDayCash ?? record.prevDayCash ?? 0) || 0;
          const cashSales = Number(record.cashSales ?? meta.cashSales ?? 0) || 0;
          const actualCash = Number(meta.cashBalance ?? record.cashBalance ?? 0) || 0;
          const theoreticalCash = prevDayCash + cashSales - cashExpenseTotal;
          nextCashRows.push({
            branchName: branch.branchName,
            brand: branch.brand || branch.branchName,
            date: record.settleDate,
            prevDayCash,
            cashSales,
            cashExpenseTotal,
            theoreticalCash,
            actualCash,
            diff: actualCash - theoreticalCash,
            transfer: Number(meta.transferSales ?? record.transferSales ?? 0) || 0,
            reason: meta.cashDiffReason || ""
          });
          cashExpenses.forEach((expense: any, index: number) => {
            const amount = Number(expense.amount) || 0;
            if (amount <= 0) return;
            nextExpenseRows.push({
              id: `${branch.branchName}-${record.settleDate}-${index}`,
              branchName: branch.branchName,
              brand: branch.brand || branch.branchName,
              date: record.settleDate,
              classification: expense.classification || "-",
              usage: expense.usage || "-",
              detail: expense.detail || "",
              amount,
              writer: record.submittedBy || record.modifiedBy || ""
            });
          });
        });
      });

      setCashRows(nextCashRows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.branchName).localeCompare(String(b.branchName))));
      setExpenseRows(nextExpenseRows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.branchName).localeCompare(String(b.branchName))));
    } finally {
      setLoading(false);
    }
  }, [selectedBranch, selectedMonth]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => ({
    cashExpenseTotal: expenseRows.reduce((sum, row) => sum + row.amount, 0),
    diffTotal: cashRows.reduce((sum, row) => sum + row.diff, 0)
  }), [cashRows, expenseRows]);

  return (
    <section className="space-y-5 animate-fade-in">
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-[#2C3E50]">현금관리</h2>
            <p className="text-xs text-gray-400 mt-1">전 지점 월말마감의 현금관리 집계와 현금지출 일람을 모아 확인합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold" />
            <select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold min-w-40">
              <option value="전체">전체 지점</option>
              {branches.map((branch) => <option key={branch.branchName} value={branch.branchName}>{branch.branchName}</option>)}
            </select>
            <button onClick={() => void load()} className="px-4 py-2 rounded-xl bg-[#2E6DB4] text-white text-xs font-black">새로고침</button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">현금관리 집계</p><p className="text-2xl font-black">{cashRows.length}건</p></div>
          <div className="rounded-xl bg-orange-50 p-4"><p className="text-xs font-bold text-orange-600">현금지출 합계</p><p className="text-2xl font-black text-orange-700">{formatNumber(summary.cashExpenseTotal)}원</p></div>
          <div className="rounded-xl bg-rose-50 p-4"><p className="text-xs font-bold text-rose-600">현금 차이 합계</p><p className="text-2xl font-black text-rose-700">{formatNumber(summary.diffTotal)}원</p></div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {!fixedTab && (
          <div className="flex gap-2 border-b border-gray-100 px-5">
            <button onClick={() => setActiveTab("cashManagement")} className={`px-4 py-3 text-sm font-bold border-b-2 ${activeTab === "cashManagement" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>현금관리</button>
            <button onClick={() => setActiveTab("cashExpenses")} className={`px-4 py-3 text-sm font-bold border-b-2 ${activeTab === "cashExpenses" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>현금지출</button>
          </div>
        )}
        <div className="overflow-x-auto">
          {activeTab === "cashManagement" ? (
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 font-black"><tr><th className="p-3">마감일자</th><th className="p-3">지점</th><th className="p-3 text-right">전일현금</th><th className="p-3 text-right">현금매출</th><th className="p-3 text-right">현금지출</th><th className="p-3 text-right">현금잔액</th><th className="p-3 text-right">실사현금</th><th className="p-3 text-right">차이</th><th className="p-3">비고</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? <tr><td colSpan={9} className="p-12 text-center"><LoadingSpinner size="sm" /></td></tr> : cashRows.length === 0 ? <tr><td colSpan={9} className="p-12 text-center text-gray-400 font-bold">현금관리 내역이 없습니다.</td></tr> : cashRows.map((row) => (
                  <tr key={`${row.branchName}-${row.date}`}><td className="p-3 font-mono text-xs">{row.date}</td><td className="p-3 font-black">{row.branchName}</td><td className="p-3 text-right font-mono">{formatNumber(row.prevDayCash)}</td><td className="p-3 text-right font-mono">{formatNumber(row.cashSales)}</td><td className="p-3 text-right font-mono text-orange-600">{formatNumber(row.cashExpenseTotal)}</td><td className="p-3 text-right font-mono">{formatNumber(row.theoreticalCash)}</td><td className="p-3 text-right font-mono">{formatNumber(row.actualCash)}</td><td className={`p-3 text-right font-mono font-black ${row.diff ? "text-rose-600" : "text-emerald-600"}`}>{formatNumber(row.diff)}</td><td className="p-3 text-xs text-gray-500">{row.reason || "-"}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 font-black"><tr><th className="p-3">일자</th><th className="p-3">지점</th><th className="p-3">분류</th><th className="p-3">사용처</th><th className="p-3">상세</th><th className="p-3 text-right">금액</th><th className="p-3">작성자</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? <tr><td colSpan={7} className="p-12 text-center"><LoadingSpinner size="sm" /></td></tr> : expenseRows.length === 0 ? <tr><td colSpan={7} className="p-12 text-center text-gray-400 font-bold">현금지출 내역이 없습니다.</td></tr> : expenseRows.map((row) => (
                  <tr key={row.id}><td className="p-3 font-mono text-xs">{row.date}</td><td className="p-3 font-black">{row.branchName}</td><td className="p-3">{row.classification}</td><td className="p-3">{row.usage}</td><td className="p-3 text-gray-500">{row.detail || "-"}</td><td className="p-3 text-right font-mono font-black">{formatNumber(row.amount)}</td><td className="p-3 text-xs text-gray-500">{row.writer || "-"}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}

function AdminAnnualLeaveSection() {
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [entriesByBranch, setEntriesByBranch] = useState<Record<string, any[]>>({});
  const [grantsByBranch, setGrantsByBranch] = useState<Record<string, Record<string, number>>>({});
  const [selectedBranch, setSelectedBranch] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [editLeave, setEditLeave] = useState<{ branchName: string; entry: any; fields: { startDate: string; endDate: string; days: string; reason: string } } | null>(null);
  const [partialDeleteLeave, setPartialDeleteLeave] = useState<{ branchName: string; entry: any; startDate: string; endDate: string } | null>(null);

  const formatShortDate = (value: string) => {
    if (!value) return "-";
    const normalized = String(value).replace(/\./g, "-");
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return value;
    return `${String(date.getFullYear()).slice(2)}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
  };

  const formatTenureText = (value: string) => {
    if (!value) return "-";
    const normalized = String(value).replace(/\./g, "-");
    const start = new Date(normalized);
    if (Number.isNaN(start.getTime())) return "-";
    const today = new Date();
    let months = (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth());
    if (today.getDate() < start.getDate()) months -= 1;
    if (months < 0) months = 0;
    const years = Math.floor(months / 12);
    const remainMonths = months % 12;
    return years > 0 ? `${years}년 ${remainMonths}개월` : `${remainMonths}개월`;
  };

  const calcDays = (from: string, to: string) => {
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    return Number.isFinite(days) ? days : 0;
  };

  const addDays = (value: string, amount: number) => {
    const date = new Date(`${value}T00:00:00`);
    date.setDate(date.getDate() + amount);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };

  const toTime = (value: string) => new Date(`${value}T00:00:00`).getTime();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const branchList = await gasClient.getBranchList();
      setBranches(branchList || []);
      const packed = await Promise.all((branchList || []).map(async (branch: any) => {
        const branchName = branch.branchName;
        const [roster, entries, grants] = await Promise.all([
          gasClient.getBranchOwnRoster(branchName).catch(() => []),
          gasClient.getSharedData<any[]>(`annual_leave:${branchName}`).catch(() => []),
          gasClient.getSharedData<Record<string, number>>(`annual_leave_grants:${branchName}`).catch(() => ({}))
        ]);
        return {
          branchName,
          brand: branch.brand,
          employees: (roster || []).filter((employee: any) => employee.division === "정직원").map((employee: any) => ({ ...employee, branchName, brand: branch.brand })),
          entries: Array.isArray(entries) ? entries : [],
          grants: grants || {}
        };
      }));
      setEmployees(packed.flatMap((item) => item.employees));
      setEntriesByBranch(Object.fromEntries(packed.map((item) => [item.branchName, item.entries])));
      setGrantsByBranch(Object.fromEntries(packed.map((item) => [item.branchName, item.grants])));
      if (!selectedBranch && packed[0]) setSelectedBranch(packed[0].branchName);
    } finally {
      setLoading(false);
    }
  }, [selectedBranch]);

  useEffect(() => {
    void load();
  }, [load]);

  const availableEmployees = employees.filter((employee) => !selectedBranch || employee.branchName === selectedBranch);

  const saveGrant = async (branchName: string, employeeId: string, value: string) => {
    const nextValue = Math.max(0, Number(value) || 0);
    const branchGrants = { ...(grantsByBranch[branchName] || {}), [employeeId]: nextValue };
    const next = { ...grantsByBranch, [branchName]: branchGrants };
    setGrantsByBranch(next);
    await gasClient.saveSharedData(`annual_leave_grants:${branchName}`, branchGrants);
  };

  const saveLeaveUse = async () => {
    const employee = employees.find((item) => item.id === selectedEmployeeId && item.branchName === selectedBranch);
    const days = calcDays(startDate, endDate);
    if (!employee || days < 1 || !reason.trim()) {
      alert("직원, 기간, 사용 사유를 모두 확인해주세요.");
      return;
    }
    const key = `annual_leave:${selectedBranch}`;
    const previous = entriesByBranch[selectedBranch] || [];
    const nextEntry = {
      id: `admin-leave-${Date.now()}`,
      employeeId: employee.id,
      staffName: employee.name,
      branchName: selectedBranch,
      startDate,
      endDate,
      date: startDate,
      days,
      reason: reason.trim(),
      createdAt: new Date().toISOString(),
      createdBy: "관리자"
    };
    const nextEntries = [nextEntry, ...previous];
    await gasClient.saveSharedData(key, nextEntries);
    setEntriesByBranch((prev) => ({ ...prev, [selectedBranch]: nextEntries }));
    setReason("");
  };

  const saveEditedLeave = async () => {
    if (!editLeave) return;
    const key = `annual_leave:${editLeave.branchName}`;
    const previous = entriesByBranch[editLeave.branchName] || [];
    const nextEntries = previous.map((entry) => entry.id === editLeave.entry.id ? {
      ...entry,
      startDate: editLeave.fields.startDate,
      endDate: editLeave.fields.endDate,
      date: editLeave.fields.startDate,
      days: Number(editLeave.fields.days) || calcDays(editLeave.fields.startDate, editLeave.fields.endDate),
      reason: editLeave.fields.reason.trim()
    } : entry);
    await gasClient.saveSharedData(key, nextEntries);
    setEntriesByBranch((prev) => ({ ...prev, [editLeave.branchName]: nextEntries }));
    setEditLeave(null);
  };

  const deleteLeaveEntry = async (branchName: string, entryId: string) => {
    if (!window.confirm("선택한 연차 사용기록을 삭제할까요?")) return;
    const key = `annual_leave:${branchName}`;
    const nextEntries = (entriesByBranch[branchName] || []).filter((entry) => entry.id !== entryId);
    await gasClient.saveSharedData(key, nextEntries);
    setEntriesByBranch((prev) => ({ ...prev, [branchName]: nextEntries }));
  };

  const deleteLeavePartialRange = async () => {
    if (!partialDeleteLeave) return;
    const { branchName, entry, startDate: deleteStart, endDate: deleteEnd } = partialDeleteLeave;
    const entryStart = entry.startDate || entry.date;
    const entryEnd = entry.endDate || entryStart;
    if (toTime(deleteStart) > toTime(deleteEnd) || toTime(deleteStart) > toTime(entryEnd) || toTime(deleteEnd) < toTime(entryStart)) {
      alert("삭제할 기간이 기존 연차 사용기간과 겹치지 않습니다.");
      return;
    }
    const key = `annual_leave:${branchName}`;
    const previous = entriesByBranch[branchName] || [];
    const nextEntries = previous.flatMap((item) => {
      if (item.id !== entry.id) return [item];
      const pieces: any[] = [];
      if (toTime(deleteStart) > toTime(entryStart)) {
        const leftEnd = addDays(deleteStart, -1);
        pieces.push({ ...item, id: `${item.id}-left-${Date.now()}`, startDate: entryStart, endDate: leftEnd, date: entryStart, days: calcDays(entryStart, leftEnd) });
      }
      if (toTime(deleteEnd) < toTime(entryEnd)) {
        const rightStart = addDays(deleteEnd, 1);
        pieces.push({ ...item, id: `${item.id}-right-${Date.now()}`, startDate: rightStart, endDate: entryEnd, date: rightStart, days: calcDays(rightStart, entryEnd) });
      }
      return pieces;
    });
    await gasClient.saveSharedData(key, nextEntries);
    setEntriesByBranch((prev) => ({ ...prev, [branchName]: nextEntries }));
    setPartialDeleteLeave(null);
  };

  const rows = employees.filter((employee) => !selectedBranch || employee.branchName === selectedBranch).map((employee) => {
    const branchEntries = entriesByBranch[employee.branchName] || [];
    const logs = branchEntries.filter((entry) => entry.employeeId === employee.id);
    const used = logs.reduce((sum, entry) => sum + Number(entry.days || 0), 0);
    const grant = Number(grantsByBranch[employee.branchName]?.[employee.id] ?? 15);
    return { employee, logs, used, grant, remain: grant - used };
  });

  return (
    <section className="space-y-6">
      {editLeave && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-black text-gray-900">연차 사용기록 수정</h3>
              <button onClick={() => setEditLeave(null)} className="text-gray-400">×</button>
            </div>
            <div className="p-5 grid grid-cols-1 gap-3 text-sm">
              <label className="space-y-1"><span className="text-xs font-black text-gray-500">시작일</span><input type="date" value={editLeave.fields.startDate} onChange={(e) => setEditLeave((cur) => cur ? { ...cur, fields: { ...cur.fields, startDate: e.target.value, days: String(calcDays(e.target.value, cur.fields.endDate)) } } : cur)} className="w-full border rounded-xl px-3 py-2" /></label>
              <label className="space-y-1"><span className="text-xs font-black text-gray-500">종료일</span><input type="date" value={editLeave.fields.endDate} onChange={(e) => setEditLeave((cur) => cur ? { ...cur, fields: { ...cur.fields, endDate: e.target.value, days: String(calcDays(cur.fields.startDate, e.target.value)) } } : cur)} className="w-full border rounded-xl px-3 py-2" /></label>
              <label className="space-y-1"><span className="text-xs font-black text-gray-500">사용일수</span><input type="number" value={editLeave.fields.days} onChange={(e) => setEditLeave((cur) => cur ? { ...cur, fields: { ...cur.fields, days: e.target.value } } : cur)} className="w-full border rounded-xl px-3 py-2" /></label>
              <label className="space-y-1"><span className="text-xs font-black text-gray-500">사유</span><input value={editLeave.fields.reason} onChange={(e) => setEditLeave((cur) => cur ? { ...cur, fields: { ...cur.fields, reason: e.target.value } } : cur)} className="w-full border rounded-xl px-3 py-2" /></label>
            </div>
            <div className="px-5 py-4 bg-gray-50 flex justify-end gap-2">
              <button onClick={() => setEditLeave(null)} className="px-4 py-2 rounded-xl bg-white border text-xs font-bold">취소</button>
              <button onClick={() => void saveEditedLeave()} className="px-5 py-2 rounded-xl bg-[#2E6DB4] text-white text-xs font-black">저장</button>
            </div>
          </div>
        </div>
      )}
      {partialDeleteLeave && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-black text-gray-900">연차 기간 일부 삭제</h3>
              <button onClick={() => setPartialDeleteLeave(null)} className="text-gray-400">×</button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <p className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">
                기존 기록: {partialDeleteLeave.entry.startDate || partialDeleteLeave.entry.date}~{partialDeleteLeave.entry.endDate || partialDeleteLeave.entry.startDate || partialDeleteLeave.entry.date}
              </p>
              <label className="block space-y-1"><span className="text-xs font-black text-gray-500">삭제 시작일</span><input type="date" value={partialDeleteLeave.startDate} onChange={(e) => setPartialDeleteLeave((cur) => cur ? { ...cur, startDate: e.target.value } : cur)} className="w-full border rounded-xl px-3 py-2" /></label>
              <label className="block space-y-1"><span className="text-xs font-black text-gray-500">삭제 종료일</span><input type="date" value={partialDeleteLeave.endDate} onChange={(e) => setPartialDeleteLeave((cur) => cur ? { ...cur, endDate: e.target.value } : cur)} className="w-full border rounded-xl px-3 py-2" /></label>
              <p className="text-xs text-gray-400">예: 1~10일 기록에서 1~3일만 삭제하면 4~10일 기록만 남습니다.</p>
            </div>
            <div className="px-5 py-4 bg-gray-50 flex justify-end gap-2">
              <button onClick={() => setPartialDeleteLeave(null)} className="px-4 py-2 rounded-xl bg-white border text-xs font-bold">취소</button>
              <button onClick={() => void deleteLeavePartialRange()} className="px-5 py-2 rounded-xl bg-rose-600 text-white text-xs font-black">선택 기간 삭제</button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#2C3E50] tracking-tight">전 직원 연차 통합 관리</h2>
          <p className="text-xs text-gray-400 mt-1">각 지점 정직원의 연차 부여일수, 사용 기간, 사용기록, 잔여일수를 한 화면에서 관리합니다.</p>
        </div>
        <button onClick={() => void load()} className="px-4 py-2 bg-[#2E6DB4] text-white rounded-xl text-xs font-bold">새로고침</button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <h3 className="font-black text-gray-800">연차 사용 등록</h3>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <select value={selectedBranch} onChange={(e) => { setSelectedBranch(e.target.value); setSelectedEmployeeId(""); }} className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold">
            <option value="">지점 선택</option>
            {branches.map((branch) => <option key={branch.branchName} value={branch.branchName}>{branch.branchName}</option>)}
          </select>
          <select value={selectedEmployeeId} onChange={(e) => setSelectedEmployeeId(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold">
            <option value="">직원 선택</option>
            {availableEmployees.map((employee) => <option key={`${employee.branchName}-${employee.id}`} value={employee.id}>{employee.name}</option>)}
          </select>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold" />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold" />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사용 사유" className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold" />
          <button onClick={() => void saveLeaveUse()} className="bg-emerald-600 text-white rounded-xl text-sm font-black">등록</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1060px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3">지점</th>
                <th className="px-4 py-3">직원</th>
                <th className="px-4 py-3">입사일</th>
                <th className="px-4 py-3">근속년수</th>
                <th className="px-4 py-3 text-center">부여일수</th>
                <th className="px-4 py-3 text-center">사용일수</th>
                <th className="px-4 py-3 text-center">잔여일수</th>
                <th className="px-4 py-3">사용기록</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="py-16 text-center"><LoadingSpinner size="sm" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="py-16 text-center text-gray-400 font-bold">표시할 정직원 데이터가 없습니다.</td></tr>
              ) : rows.map(({ employee, logs, used, grant, remain }) => (
                <tr key={`${employee.branchName}-${employee.id}`} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-bold text-gray-500">{employee.branchName}</td>
                  <td className="px-4 py-3 font-black text-gray-800">{employee.name}</td>
                  <td className="px-4 py-3 font-mono text-gray-500">{formatShortDate(employee.entryDate)}</td>
                  <td className="px-4 py-3 font-bold text-gray-600">{formatTenureText(employee.entryDate)}</td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="number"
                      value={grant}
                      onChange={(e) => setGrantsByBranch((prev) => ({ ...prev, [employee.branchName]: { ...(prev[employee.branchName] || {}), [employee.id]: Number(e.target.value) || 0 } }))}
                      onBlur={(e) => void saveGrant(employee.branchName, employee.id, e.target.value)}
                      className="w-20 text-center border border-gray-200 rounded-lg px-2 py-1 font-bold"
                    />
                  </td>
                  <td className="px-4 py-3 text-center font-black text-rose-600">{used}</td>
                  <td className={`px-4 py-3 text-center font-black ${remain < 0 ? "text-rose-700" : "text-[#2E6DB4]"}`}>{remain}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {logs.length === 0 ? "-" : (
                      <div className="space-y-1">
                        {logs.map((entry) => (
                          <div key={entry.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2 py-1">
                            <span>{entry.startDate || entry.date}{entry.endDate && entry.endDate !== (entry.startDate || entry.date) ? `~${entry.endDate}` : ""} ({entry.days}일, {entry.reason || "-"})</span>
                            <span className="flex gap-1">
                              <button onClick={() => setEditLeave({ branchName: employee.branchName, entry, fields: { startDate: entry.startDate || entry.date || "", endDate: entry.endDate || entry.startDate || entry.date || "", days: String(entry.days || 0), reason: entry.reason || "" } })} className="text-[10px] font-black text-[#2E6DB4]">수정</button>
                              <button onClick={() => setPartialDeleteLeave({ branchName: employee.branchName, entry, startDate: entry.startDate || entry.date || "", endDate: entry.endDate || entry.startDate || entry.date || "" })} className="text-[10px] font-black text-amber-600">일부삭제</button>
                              <button onClick={() => void deleteLeaveEntry(employee.branchName, entry.id)} className="text-[10px] font-black text-rose-600">삭제</button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function AdminModificationLogsSection({ defaultSubTab = "logs" }: { defaultSubTab?: "logs" | "manualOvertimes" } = {}) {
  const [subTab, setSubTab] = useState<"logs" | "manualOvertimes" | "cashDiff">(defaultSubTab);
  const [logs, setLogs] = useState<any[]>([]);
  const [reviewedLogIds, setReviewedLogIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchBranch, setSearchBranch] = useState("");
  const [searchDate, setSearchDate] = useState("");

  const loadLogs = async () => {
    try {
      setLoading(true);
      const [data, reviewed] = await Promise.all([
        gasClient.getEditLogs(),
        gasClient.getSharedData<string[]>("admin_reviewed_edit_logs").catch(() => [])
      ]);
      setLogs(data);
      setReviewedLogIds(Array.isArray(reviewed) ? reviewed : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  useEffect(() => {
    setSubTab(defaultSubTab);
  }, [defaultSubTab]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchBranch = !searchBranch || log.branchName?.toLowerCase().includes(searchBranch.toLowerCase());
      const matchDate = !searchDate || log.settleDate?.includes(searchDate);
      return matchBranch && matchDate;
    });
  }, [logs, searchBranch, searchDate]);

  const deleteLog = async (log: any) => {
    if (!log?.id) return;
    if (!window.confirm(`${log.branchName || ""} ${log.settleDate || ""} 변경이력 로그를 삭제할까요?`)) return;
    try {
      await gasClient.deleteEditLog(log.id);
      await loadLogs();
    } catch (error) {
      console.error("변경이력 삭제 실패:", error);
      alert("변경이력 삭제에 실패했습니다.");
    }
  };

  const getLogReviewId = (log: any) => String(log.id || `${log.branchName || ""}:${log.settleDate || ""}:${log.modifiedAt || log.createdAt || ""}`);

  const markLogReviewed = async (log: any) => {
    const reviewId = getLogReviewId(log);
    const next = Array.from(new Set([...reviewedLogIds, reviewId]));
    setReviewedLogIds(next);
    await gasClient.saveSharedData("admin_reviewed_edit_logs", next);
  };

  const formatShortDate = (isoString: string) => {
    if (!isoString) return "-";
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  };

  const getChangesSummary = (log: any) => {
    const changes: string[] = [];
    const before = log.before || {};
    const after = log.after || {};

    if (before.cashSales !== after.cashSales) {
      changes.push(`현금매출: ${formatNumber(before.cashSales)}원 ➔ ${formatNumber(after.cashSales)}원`);
    }
    if (before.cardSales !== after.cardSales) {
      changes.push(`카드매출: ${formatNumber(before.cardSales)}원 ➔ ${formatNumber(after.cardSales)}원`);
    }
    if (before.transferSales !== after.transferSales) {
      changes.push(`계좌매출: ${formatNumber(before.transferSales)}원 ➔ ${formatNumber(after.transferSales)}원`);
    }
    if (before.deliverySales !== after.deliverySales) {
      changes.push(`배달매출: ${formatNumber(before.deliverySales)}원 ➔ ${formatNumber(after.deliverySales)}원`);
    }
    const beforeExpLength = before.expenses?.length || 0;
    const afterExpLength = after.expenses?.length || 0;
    if (beforeExpLength !== afterExpLength) {
      changes.push(`지출 항목 수: ${beforeExpLength}개 ➔ ${afterExpLength}개`);
    } else if (before.expenses && after.expenses) {
      let diff = false;
      for (let i = 0; i < beforeExpLength; i++) {
        if (before.expenses[i]?.amount !== after.expenses[i]?.amount || before.expenses[i]?.itemName !== after.expenses[i]?.itemName) {
          diff = true;
          break;
        }
      }
      if (diff) changes.push(`지출 세부 내역 수정됨`);
    }

    const beforeStaffLength = before.staff?.length || 0;
    const afterStaffLength = after.staff?.length || 0;
    if (beforeStaffLength !== afterStaffLength) {
      changes.push(`근무 직원 수: ${beforeStaffLength}명 ➔ ${afterStaffLength}명`);
    } else if (before.staff && after.staff) {
      let diff = false;
      for (let i = 0; i < beforeStaffLength; i++) {
        if (before.staff[i]?.workHours !== after.staff[i]?.workHours) {
          diff = true;
          break;
        }
      }
      if (diff) changes.push(`근무 시간/직원 내역 수정됨`);
    }

    if (changes.length === 0) {
      return <span className="text-gray-400">변경 사항 없음 (또는 기타 설정 변경)</span>;
    }

    return (
      <ul className="space-y-1 text-xs font-bold text-gray-700">
        {changes.map((ch, idx) => (
          <li key={idx} className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2E6DB4]" />
            <span>{ch}</span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="space-y-5 animate-fade-in" id="modification-logs-section">
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setSubTab("logs")}
          className={`px-4 py-3 text-sm font-bold border-b-2 transition-all ${subTab === "logs" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400 hover:text-gray-600"}`}
        >
          정산 변경이력 로그
        </button>
        <button
          onClick={() => setSubTab("manualOvertimes")}
          className={`px-4 py-3 text-sm font-bold border-b-2 transition-all ${subTab === "manualOvertimes" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400 hover:text-gray-600"}`}
        >
          지점 수기 초과근무 대장
        </button>
        <button
          onClick={() => setSubTab("cashDiff")}
          className={`px-4 py-3 text-sm font-bold border-b-2 transition-all ${subTab === "cashDiff" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400 hover:text-gray-600"}`}
        >
          현금차이 이력
        </button>
      </div>

      {subTab === "logs" ? (
        <>
          <div className="bg-white p-6 rounded-2xl border shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 className="font-black text-gray-800 text-lg flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-amber-500" /> 지점 마감 수정이력 모니터링
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  각 지점에서 마감 제출 후 수정한 세부 정보 및 변경 내역을 실시간으로 추적합니다.
                </p>
              </div>
              <button
                onClick={loadLogs}
                className="px-4 py-2 bg-[#2E6DB4] hover:bg-[#20528B] text-white rounded-xl text-xs font-bold cursor-pointer transition-colors"
              >
                새로고침
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase">지점명 검색</label>
                <input
                  type="text"
                  value={searchBranch}
                  onChange={(e) => setSearchBranch(e.target.value)}
                  placeholder="예: 강남점"
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold bg-gray-50 focus:bg-white focus:outline-none focus:border-[#2E6DB4] transition-all"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase">마감 대상 날짜 검색</label>
                <input
                  type="text"
                  value={searchDate}
                  onChange={(e) => setSearchDate(e.target.value)}
                  placeholder="예: 2026-06"
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold bg-gray-50 focus:bg-white focus:outline-none focus:border-[#2E6DB4] transition-all"
                />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left border-b text-gray-500 font-extrabold text-xs">
                    <th className="p-4 w-44">수정 일시</th>
                    <th className="py-4 px-3 w-28">지점명</th>
                    <th className="py-4 px-3 w-32">마감 대상일</th>
                    <th className="py-4 px-3 w-28">작업자</th>
                    <th className="py-4 px-3">수정 전 ➔ 수정 후 세부 내역</th>
                    <th className="py-4 px-3 w-24 text-center">확인</th>
                    <th className="py-4 px-3 w-20 text-center">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-gray-400 font-semibold">
                        <LoadingSpinner size="sm" />
                      </td>
                    </tr>
                  ) : filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-gray-400 font-bold">
                        기록된 마감 수정 이력이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log) => {
                      const reviewed = reviewedLogIds.includes(getLogReviewId(log));
                      return (
                      <tr key={log.id} className={`border-b transition-colors ${reviewed ? "bg-white hover:bg-slate-50/50" : "bg-[#F4F2A8]/70 hover:bg-[#F4F2A8]"}`}>
                        <td className="p-4 font-mono text-xs text-gray-500 font-medium whitespace-nowrap">
                          {formatShortDate(log.modifiedAt)}
                        </td>
                        <td className="py-4 px-3 font-black text-gray-800 whitespace-nowrap">
                          {log.branchName}
                        </td>
                        <td className="py-4 px-3 font-mono text-xs text-blue-700 font-black whitespace-nowrap">
                          {log.settleDate}
                        </td>
                        <td className="py-4 px-3 whitespace-nowrap">
                          <span className="inline-block px-2.5 py-1 bg-zinc-100 text-zinc-800 rounded-full text-xs font-extrabold">
                            {log.modifiedBy || "지점담당"}
                          </span>
                        </td>
                        <td className="py-4 px-3">
                          {getChangesSummary(log)}
                        </td>
                        <td className="py-4 px-3 text-center">
                          {reviewed ? (
                            <span className="inline-flex items-center justify-center rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs font-black text-slate-500">
                              확인됨
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void markLogReviewed(log)}
                              className="inline-flex items-center justify-center rounded-lg bg-[#2E6DB4] px-3 py-2 text-xs font-black text-white hover:bg-[#20528B]"
                            >
                              확인
                            </button>
                          )}
                        </td>
                        <td className="py-4 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => void deleteLog(log)}
                            className="inline-flex items-center justify-center rounded-lg border border-rose-100 bg-rose-50 p-2 text-rose-600 hover:bg-rose-100"
                            title="변경이력 삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : subTab === "cashDiff" ? (
        <AdminCashDiffHistorySection />
      ) : (
        <AdminManualOvertimesSection />
      )}
    </div>
  );
}

// 현금차이 이력 — 선택한 달에 각 지점이 기록한 현금 차이(실사현금 − 장부)를 날짜별로 모아 보여준다.
// 대시보드 '전일 정산'은 어제치만 보이므로, 지난 기록을 지점·날짜별로 되짚어 볼 수 있게 한다.
function AdminCashDiffHistorySection() {
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const [rows, setRows] = useState<Array<{ date: string; branchName: string; cashDifference: number; reason: string }> | null>(null);
  const [partialError, setPartialError] = useState(false);

  const load = useCallback(async () => {
    setRows(null);
    setPartialError(false);
    try {
      const branchList = (await gasClient.getBranchList()).filter((b: any) => b?.role === "branch" && b.branchName);
      let anyFail = false;
      const perBranch = await Promise.all(branchList.map(async (b: any) => {
        // 읽기 실패는 '차이 없음'과 구분한다(fail-closed): null이면 배너로 '일부 누락'을 알린다.
        // 서버 전용 조회 필수 — getBranchHistory는 실패를 []로 삼켜(gasClient) 실패 지점이 조용히 사라진다.
        const history = await gasClient.getBranchHistoryFromServer(b.branchName, month).catch(() => null);
        if (history === null) { anyFail = true; return []; }
        return (Array.isArray(history) ? history : []).flatMap((record: any) => {
          try {
            const memoText = String(record.memo || "");
            const meta = JSON.parse(memoText.split("\n---\nMETADATA:")[1] || "{}");
            const expenses = (meta.cashExpenses || []).reduce((s: number, it: any) => s + (Number(it.amount) || 0), 0);
            // 대시보드 전일정산과 동일 산식: 실사현금 − (전일현금 + 현금매출 − 현금지출)
            const cashDifference = (Number(meta.cashBalance) || 0) - ((Number(meta.prevDayCash) || 0) + (Number(record.cashSales) || 0) - expenses);
            const d = String(record.settleDate || "");
            if (!cashDifference || d.slice(0, 7) !== month) return [];
            return [{ date: d, branchName: b.branchName, cashDifference, reason: meta.cashDiffReason || "" }];
          } catch { return []; }
        });
      }));
      setPartialError(anyFail);
      const flat = perBranch.flat();
      setRows(flat.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.branchName.localeCompare(b.branchName, "ko")));
    } catch {
      setPartialError(true);
      setRows([]);
    }
  }, [month]);

  useEffect(() => { void load(); }, [load]);

  const totalDiff = (rows || []).reduce((s, r) => s + r.cashDifference, 0);

  return (
    <div className="space-y-4">
      <div className="bg-white p-5 rounded-2xl border shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="font-black text-gray-800 text-lg flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-500" /> 현금차이 이력
          </h3>
          <p className="text-xs text-gray-400 mt-1">선택한 달에 각 지점이 기록한 현금 차이(실사현금 − 장부)를 날짜별로 모았습니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs font-black" />
          <button onClick={() => void load()} className="px-3 py-2 rounded-xl bg-[#2E6DB4] text-white text-xs font-black">새로고침</button>
        </div>
      </div>

      {partialError && (
        <p className="text-xs font-bold text-rose-600">일부 지점의 이력을 서버에서 불러오지 못했습니다. 아래 목록이 일부 누락됐을 수 있습니다 — 새로고침 후 다시 확인해주세요.</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-rose-50 p-4"><p className="text-xs font-bold text-rose-600">현금차이 발생</p><p className="text-2xl font-black text-rose-700">{rows === null ? "…" : `${rows.length}건`}</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">차이 합계</p><p className="text-2xl font-black text-slate-700">{rows === null ? "…" : `${formatNumber(totalDiff)}원`}</p></div>
      </div>

      <div className="bg-white rounded-2xl border overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500 font-black border-b">
              <tr>
                <th className="p-4 w-32">마감일자</th>
                <th className="py-4 px-3 w-32">지점</th>
                <th className="py-4 px-3 w-32 text-right">현금차이</th>
                <th className="py-4 px-3">사유</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows === null ? (
                <tr><td colSpan={4} className="p-12 text-center"><LoadingSpinner size="sm" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} className="p-12 text-center text-gray-400 font-bold">{month}에 기록된 현금차이가 없습니다.</td></tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={`${r.branchName}-${r.date}-${i}`} className="hover:bg-slate-50/60">
                    <td className="p-4 font-mono text-xs font-bold text-blue-700 whitespace-nowrap">{r.date}</td>
                    <td className="py-4 px-3 font-black text-gray-800 whitespace-nowrap">{r.branchName}</td>
                    <td className={`py-4 px-3 text-right font-mono font-black whitespace-nowrap ${r.cashDifference < 0 ? "text-rose-600" : "text-amber-600"}`}>
                      {r.cashDifference > 0 ? "+" : ""}{formatNumber(r.cashDifference)}원
                    </td>
                    <td className="py-4 px-3 text-gray-600 font-bold">{r.reason || <span className="text-gray-300">사유 미입력</span>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const MONTHLY_CLOSE_SECTIONS: Array<{ key: "salesSummary" | "purchase" | "salary"; label: string }> = [
  { key: "salesSummary", label: "매출집계" },
  { key: "purchase", label: "매입매출" },
  { key: "salary", label: "정직원 급여" },
];

// 법인 분류 — 지점명 키워드로 3개 법인으로 나눈다. 실제 지점명 표기가 다양해(연하동 대학로점/연하동 연남본점/
// 강남대골뼈국/카라멘야/마음죽) 정확 일치가 아닌 '키워드 포함'으로 매칭한다. 목록에 없는 나머지는 전부 UGD.
const CORP_GROUPS: Array<{ key: string; label: string }> = [
  { key: "ugd", label: "UGD" },
  { key: "karamenya", label: "카라멘야" },
  { key: "yeonhadong", label: "연하동" },
];
const corpOfBranch = (branchName: string): string => {
  const n = String(branchName || "");
  if (n.includes("카라멘야") || n.includes("마음죽")) return "karamenya";
  if (n.includes("연하동") || n.includes("대골뼈국")) return "yeonhadong";
  return "ugd";
};
const corpLabel = (key: string): string => CORP_GROUPS.find((c) => c.key === key)?.label || key;

const monthlyCloseBadge = (status: string | null) => {
  const label = status === "confirmed" ? "확정" : status === "editing" ? "수정중" : "미제출";
  const cls = status === "confirmed" ? "admin-monthly-status-confirmed" : status === "editing" ? "admin-monthly-status-editing" : "admin-monthly-status-pending";
  return <span className={`inline-flex px-2 py-1 rounded-lg text-[11px] font-black ${cls}`}>{label}</span>;
};

function AdminMonthlyClosingStatusSection() {
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [branches, setBranches] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  // '확정후수정' 버튼을 누르면 뜨는 말풍선. 표가 가로 스크롤 상자 안이라 화면(fixed) 좌표로 띄운다.
  const [modPopup, setModPopup] = useState<{ left: number; top?: number; bottom?: number; branch: string; section: "salary" | "purchase" | "salesSummary"; rec: any } | null>(null);
  // 말풍선을 띄운 버튼(앵커)을 기억해 스크롤 시 위치를 따라가게 한다(닫지 않는다).
  const modAnchorRef = useRef<HTMLElement | null>(null);
  // 버튼 좌표로부터 말풍선 위치를 계산한다: 아래 공간이 부족하면 위로 뒤집어 하단 잘림을 막는다.
  const computeModPos = useCallback((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const POPUP_W = 320, MARGIN = 8, EST_H = 240;
    const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - POPUP_W - MARGIN));
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < EST_H && r.top > spaceBelow;
    return openUp
      ? { left, top: undefined as number | undefined, bottom: Math.max(MARGIN, window.innerHeight - r.top + 6) }
      : { left, top: r.bottom + 6, bottom: undefined as number | undefined };
  }, []);
  const sectionLabel = (s: string) => (s === "salary" ? "정직원 급여대장" : s === "purchase" ? "매입매출" : "매출집계");
  // 관리자가 이 지점·섹션 엑셀을 마지막으로 다운로드한 시각(브라우저에 기록).
  const dlTimeKey = (branch: string, section: string) => `admin_section_dl_${branch}_${selectedMonth}_${section}`;
  const markDownloaded = (branch: string, section: string) => {
    try { localStorage.setItem(dlTimeKey(branch, section), new Date().toISOString()); } catch {}
  };

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [branchList, monthlyRecords] = await Promise.all([
        gasClient.getBranchList(),
        gasClient.getSharedData<any[]>("monthly_closings")
      ]);
      setBranches((branchList || []).filter((branch: any) => branch.role === "branch"));
      setRecords(Array.isArray(monthlyRecords) ? monthlyRecords : []);
    } catch (error) {
      console.error("월말마감 현황 로드 실패:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const rows = useMemo(() => {
    return branches.map((branch) => {
      const bySection: Record<string, any> = {};
      MONTHLY_CLOSE_SECTIONS.forEach((s) => {
        bySection[s.key] = records
          .filter((r) => r.branchName === branch.branchName && r.month === selectedMonth && (r.section || "purchase") === s.key)
          .sort((a, b) => String(b.updatedAt || b.confirmedAt || "").localeCompare(String(a.updatedAt || a.confirmedAt || "")))[0] || null;
      });
      return { branch, bySection };
    });
  }, [branches, records, selectedMonth]);

  const sectionStats = useMemo(() => {
    const pendingCount = (key: string) => rows.filter((r) => r.bySection[key]?.status !== "confirmed").length;
    return {
      salary: pendingCount("salary"),
      purchase: pendingCount("purchase"),
      salesSummary: pendingCount("salesSummary"),
    };
  }, [rows]);

  // 지점·섹션별 마감 엑셀 내보내기 (기본 양식 — 최종 템플릿 확정 전 임시 데이터 덤프).
  // 서버 전용 읽기로 신선한 데이터를 받고, 실패 시 파일을 만들지 않고 중단한다.
  // 'purchase'는 5시트 통합 downloadBranchMonthlyClose가 담당하므로 타입에서 제외한다
  // (여기로 들어오면 else 분기를 타 정직원 급여 엑셀이 잘못 나간다).
  const downloadBranchSection = async (branchName: string, section: "salesSummary" | "salary") => {
    const num = (v: unknown) => Number(String(v ?? "").replace(/[^0-9.-]/g, "")) || 0;
    // '확정' 표시는 있으나 서버에 상세가 없을 때, 관리자에게 복구 방법을 안내한다.
    // (정산 산출물이므로 서버 전용 읽기를 유지한다 — 네트워크 실패는 아래 바깥 catch에서 다운로드 취소로 처리.)
    const emptyMsg = (label: string, tab: string) =>
      `${branchName} · ${selectedMonth} ${label} 상세 데이터가 서버에 없습니다.\n\n` +
      `'확정' 표시는 있으나 실제 내역이 서버에 저장돼 있지 않습니다.\n` +
      `해당 지점에서 [월말마감 → ${tab}] 탭을 연 뒤 저장하고 다시 '확정'하면 다운로드됩니다.`;
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      let filename = "";
      if (section === "salesSummary") {
        const s: any = await gasClient.getSharedDataFromServer<any>(`monthly_sales_summary:${branchName}:${selectedMonth}`);
        if (!s || typeof s !== "object") { window.alert(emptyMsg("매출집계", "매출집계")); return; }
        const summaryRows = [
          { 항목: "총매출", 값: num(s.totalSales) },
          { 항목: "총할인", 값: num(s.totalDiscount) },
          { 항목: "실매출", 값: num(s.netSales) },
          { 항목: "영수건수", 값: num(s.receiptCount) },
          { 항목: "카드결제", 값: num(s.cardPay) },
          { 항목: "단순현금결제", 값: num(s.cashPlain) },
          { 항목: "현금영수증", 값: num(s.cashReceipt) },
          { 항목: "메뉴매출", 값: num(s.menuSales) },
          { 항목: "주류매출", 값: num(s.liquorSales) },
          { 항목: "자리값", 값: num(s.seatCharge) },
          { 항목: "빈칸 사유", 값: s.blankReason || "" },
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "매출집계");
        filename = `${branchName}_${selectedMonth}_매출집계.xlsx`;
      } else {
        // 매입매출(purchase) 섹션은 downloadBranchMonthlyClose(5시트 통합)로 처리하므로 여기서는 정직원 급여만 담당한다.
        const salary: any = await gasClient.getSharedDataFromServer<any[]>(`monthly_fulltime_salary:${branchName}:${selectedMonth}`);
        if (!Array.isArray(salary) || !salary.length) { window.alert(emptyMsg("정직원 급여", "정직원 급여대장")); return; }
        // 본사 표준 양식(2026.06 대학로고래 급여내역)과 동일한 모양(색·테두리·병합·수식·열너비)으로 만든다.
        // 일반 xlsx 모듈은 셀 스타일을 버리므로, 조립부터 저장까지 xlsx-js-style로 해야 서식이 살아남는다.
        const XLSXSMod: any = await import("xlsx-js-style");
        // 동적 import 상호운용: 번들러/런타임에 따라 utils가 최상위 또는 default에 위치할 수 있어 정규화한다
        // (assembleMonthlyCloseWorkbook:485와 동일 규칙 — 정규화 없이 쓰면 런타임에서 utils undefined로 터질 수 있다).
        const XLSXS: any = XLSXSMod && XLSXSMod.utils ? XLSXSMod : (XLSXSMod && XLSXSMod.default) ? XLSXSMod.default : XLSXSMod;
        const { buildFullTimeSalarySheet, fullTimeSalarySheetName } = await import("./branch/helpers/fullTimeSalaryWorkbook");
        const wbStyled = XLSXS.utils.book_new();
        XLSXS.utils.book_append_sheet(wbStyled, buildFullTimeSalarySheet(XLSXS, branchName, selectedMonth, salary), fullTimeSalarySheetName(selectedMonth));
        XLSXS.writeFile(wbStyled, `${branchName}_${selectedMonth}_정직원급여.xlsx`);
        markDownloaded(branchName, "salary"); // 파일이 실제로 저장된 뒤에만 '내 다운로드 시각' 기록(빈데이터/실패 시 기록 안 함)
        return;
      }
      XLSX.writeFile(wb, filename);
      markDownloaded(branchName, section); // 저장 성공 뒤에만 기록(여기 도달하면 section === "salesSummary")
    } catch (error) {
      console.error("마감 엑셀 다운로드 실패:", error);
      window.alert("마감 데이터를 서버에서 불러오지 못해 엑셀 다운로드를 취소했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.");
    }
  };

  // 지점 '월말마감' 엑셀 — 옛 지점화면과 동일한 5개 시트(매입매출·파트타이머급여·현금지출·카드지출·현금관리)를
  // 한 파일로 생성한다. 개편(1b22d0e) 전 지점화면 handleDownloadExcel을 관리자용으로 이식(데이터는 서버에서 신선하게 조회).
  const downloadBranchMonthlyClose = async (branchName: string) => {
    try {
      // fail-closed + 서버 전용: 모든 소스를 캐시 폴백 없는 서버 전용 리더로 읽고, 하나라도 실패(throw)하면
      // Promise.all이 reject → 아래 catch에서 다운로드를 취소한다. 실패를 삼켜 빈/오래된 데이터로 채우면
      // 파트타이머급여·현금지출·카드지출·현금관리 시트가 '데이터 없음/구값'인 채 '정상 파일'처럼 다운로드돼
      // (중복이체·누락·stale) 눈에 띄지 않는 오류가 된다. (전지점 매출집계 다운로드와 동일한 fail-closed 원칙)
      const [purchases, roster, salaries, exclusions, profiles, history] = await Promise.all([
        gasClient.getSharedDataFromServer<any[]>(`monthly_purchases:${branchName}:${selectedMonth}`),
        gasClient.getBranchOwnRosterFromServer(branchName),
        gasClient.getSharedDataFromServer<any[]>(`part_time_salaries:${branchName}:${selectedMonth}`),
        gasClient.getSharedDataFromServer<string[]>(`part_time_salary_exclusions:${branchName}:${selectedMonth}`),
        gasClient.getSharedDataFromServer<Record<string, any>>(`part_time_profiles:${branchName}`),
        gasClient.getBranchHistoryFromServer(branchName, selectedMonth),
      ]);

      // 매입매출 확정건에는 매입 데이터가 있어야 정상. 서버가 정상 응답했으나 비어 있으면(레거시/미저장) 재확정을 안내하고 중단.
      if (!Array.isArray(purchases) || purchases.length === 0) {
        window.alert(
          `${branchName} · ${selectedMonth} 월말마감(매입매출) 상세 데이터가 서버에 없습니다.\n\n` +
          `'확정' 표시는 있으나 실제 내역이 서버에 저장돼 있지 않습니다.\n` +
          `해당 지점에서 [월말마감 → 매입매출] 탭을 연 뒤 저장하고 다시 '확정'하면 다운로드됩니다.`
        );
        return;
      }
      // 성명을 몰라 워크북에서 빠질 파트타이머 급여 행이 있으면 내려받지 않는다.
      // 조용히 빠지면 실제로 일한 사람의 급여가 누락된 채 '정상 파일'처럼 보인다.
      // 판단 기준은 워크북 빌더와 같은 함수를 쓴다 — 각자 판단하면 어긋나서 구멍이 생긴다.
      const unnamedSalaryRows = unnamedPartTimeSalaryRows({ salaries, roster, exclusions });
      if (unnamedSalaryRows.length > 0) {
        window.alert(
          `${branchName} · ${selectedMonth} 파트타이머 급여대장에 성명이 비어 있는 행이 ${unnamedSalaryRows.length}건 있습니다.\n\n` +
          `이름 없는 행은 급여 엑셀에 넣을 수 없어 다운로드를 중단했습니다.\n` +
          `해당 지점에서 [월말마감 → 파트타이머 급여대장] 탭을 열어 성명을 채우거나, 필요 없는 행이면 삭제(X)한 뒤 다시 받아주세요.`
        );
        return;
      }
      // 확정 게이트와 동일 기준: export에 0 초과 금액으로 나가는 행이 하나도 없으면(레거시/빈 확정) 빈 워크북을 만들지 않고 중단.
      if (!purchases.some(purchaseRowHasExportableAmount)) {
        window.alert(
          `${branchName} · ${selectedMonth} 월말마감(매입매출)에 실제 금액이 있는 내역이 없습니다.\n\n` +
          `모든 행의 이체필요/이달사용 금액이 비어 있어 다운로드할 내용이 없습니다.\n` +
          `해당 지점에서 [월말마감 → 매입매출] 탭에서 금액을 입력하고 다시 '확정'해주세요.`
        );
        return;
      }

      const data: MonthlyCloseData = {
        branchName,
        month: selectedMonth,
        purchases,
        roster: Array.isArray(roster) ? roster : [],
        salaries: Array.isArray(salaries) ? salaries : [],
        exclusions: Array.isArray(exclusions) ? exclusions : [],
        profiles: profiles && typeof profiles === "object" ? profiles : {},
        history: Array.isArray(history) ? history : [],
      };

      const XLSX = await import("xlsx-js-style");
      const wb = assembleMonthlyCloseWorkbook(XLSX, data);
      const monthNumber = Number(selectedMonth.split("-")[1]) || 0;
      XLSX.writeFile(wb, `월말정산_${branchName}${monthNumber}월_결산자료.xlsx`);
      markDownloaded(branchName, "purchase"); // 파일이 실제로 저장된 뒤에만 '내 다운로드 시각' 기록
    } catch (error) {
      console.error("월말마감 엑셀 다운로드 실패:", error);
      window.alert("월말마감 데이터를 서버에서 불러오지 못해 엑셀 다운로드를 취소했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.");
    }
  };

  // 매출집계 엑셀 (첨부 양식: POS 매출집계 컬럼 구성, 한 지점당 한 행).
  // branchFilter로 대상 지점을 좁히고 label로 파일명을 정한다(전지점/법인별 공용 — 정직원급여 통합과 같은 패턴).
  const downloadSalesSummary = async (branchFilter: (name: string) => boolean, label: string, confirmedOnly = false) => {
    const num = (v: unknown) => Number(String(v ?? "").replace(/[^0-9.-]/g, "")) || 0;
    try {
      const XLSX = await import("xlsx");
      const allBranches = branches.length ? branches : (await gasClient.getBranchList()).filter((b: any) => b.role === "branch");
      // 법인별 배치(confirmedOnly): 정직원급여 통합과 동일 기준 — '확정(제출)'한 지점만 내보낸다.
      // 확정 상태는 서버에서 '신선하게' 읽어 fail-closed로 거른다. 화면 캐시(records)로만 거르면 방금 다른 기기에서
      // '수정중/미제출'로 바뀐 지점을 못 걸러, 미확정 매출집계가 최종본처럼 섞여 나갈 수 있다.
      // (헤더의 '전지점 매출집계'는 수집현황 덤프라 confirmedOnly=false로 전체를 유지한다.)
      let confirmedSet: Set<string> | null = null;
      if (confirmedOnly) {
        let freshRecords: any[];
        try {
          const fr = await gasClient.getSharedDataFromServer<any[]>("monthly_closings");
          if (!Array.isArray(fr)) throw new Error("invalid monthly_closings");
          freshRecords = fr;
        } catch {
          window.alert("마감 확정 상태를 서버에서 확인하지 못해 다운로드를 취소했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.");
          return;
        }
        confirmedSet = new Set(
          freshRecords
            .filter((r) => r.month === selectedMonth && (r.section || "purchase") === "salesSummary" && r.status === "confirmed")
            .map((r) => r.branchName)
        );
      }
      const branchList = allBranches.filter((b: any) => branchFilter(b.branchName) && (!confirmedSet || confirmedSet.has(b.branchName)));
      if (branchList.length === 0) {
        window.alert(confirmedOnly ? `${label} 중 ${selectedMonth} 매출집계를 '확정(제출)'한 지점이 없습니다.` : `${label}에 해당하는 지점이 없습니다.`);
        return;
      }
      const summaries = await Promise.all(branchList.map(async (b: any) => {
        try {
          const s = await gasClient.getSharedDataFromServer<any>(`monthly_sales_summary:${b.branchName}:${selectedMonth}`);
          return { branch: b, s: s && typeof s === "object" ? s : null, failed: false };
        } catch { return { branch: b, s: null, failed: true }; }
      }));
      // 읽기 실패를 삼키면 그 지점이 "빈 데이터(0/미입력)"처럼 보여 불완전한 파일이 나간다 → 하나라도 실패하면 전체 취소.
      const failedBranches = summaries.filter((r) => r.failed).map((r) => r.branch.branchName);
      if (failedBranches.length > 0) {
        window.alert(`다음 지점의 매출집계를 서버에서 불러오지 못해 다운로드를 취소했습니다:\n${failedBranches.join(", ")}\n네트워크 상태를 확인한 뒤 다시 시도해주세요. (불완전한 파일은 생성하지 않았습니다.)`);
        return;
      }
      // 법인별 배치(confirmedOnly): '확정'인데 매출집계 상세가 서버에 비어 있는(문서 없음) 지점은
      // 0/미입력 행으로 최종본에 섞이지 않게 — 정직원급여 통합의 confirmedButEmpty와 동일하게 — 명시적으로 알리고
      // 빼고 받을지 관리자가 정한다. 전지점 수집덤프(confirmedOnly=false)는 미입력 지점을 '미입력'으로 담는 게 목적이라 제외.
      let rowsSource = summaries;
      if (confirmedOnly) {
        const confirmedButEmpty = summaries.filter((r) => !r.s).map((r) => r.branch.branchName);
        if (confirmedButEmpty.length > 0) {
          const proceed = window.confirm(
            `다음 지점은 '확정' 표시가 있으나 매출집계 내역이 서버에 비어 있습니다:\n${confirmedButEmpty.join(", ")}\n\n` +
            `이 지점들은 통합 파일에서 빠집니다. 빼고 나머지만 받으시겠습니까?\n` +
            `(취소하면 다운로드를 멈춥니다 — 해당 지점에서 [월말마감 → 매출집계]를 연 뒤 저장하고 다시 '확정'하면 포함됩니다.)`
          );
          if (!proceed) return;
        }
        rowsSource = summaries.filter((r) => r.s);
        if (rowsSource.length === 0) { window.alert(`${selectedMonth} 매출집계가 저장된 지점이 없습니다.`); return; }
      }
      const excelRows = rowsSource.map(({ branch, s }) => {
        const d: any = s || {};
        const net = num(d.netSales);
        const cnt = num(d.receiptCount);
        return {
          "수집일시": "",
          "연월": selectedMonth,
          "지점코드": "",
          "지점명": branch.branchName,
          "pos_type": "",
          "총매출": num(d.totalSales),
          "총할인": num(d.totalDiscount),
          "실매출": net,
          "영수건수": cnt,
          "영수단가": cnt > 0 ? Math.round(net / cnt) : 0,
          "결제합계": num(d.cardPay) + num(d.cashPlain) + num(d.cashReceipt),
          "단순현금": num(d.cashPlain),
          "현금영수증": num(d.cashReceipt),
          "신용카드": num(d.cardPay),
          "수집상태": s ? "입력완료" : "미입력",
          "비고": "",
          "메뉴매출": num(d.menuSales),
          "주류매출": num(d.liquorSales),
          "자리값": num(d.seatCharge),
          "자리값내역": "",
        };
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(excelRows), "매출집계");
      XLSX.writeFile(wb, `${label}_매출집계_${selectedMonth}.xlsx`);
    } catch (error) {
      console.error("매출집계 다운로드 실패:", error);
      window.alert("매출집계 데이터를 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.");
    }
  };
  // 매출집계는 전지점 통합(헤더 버튼, 수집현황 덤프 = 전체)과 법인별 통합(법인 밴드 버튼, 확정 지점만) 둘 다 제공한다.
  const downloadAllSalesSummary = () => downloadSalesSummary(() => true, "전지점");
  const downloadCorpSalesSummary = (corpKey: string) => downloadSalesSummary((name) => corpOfBranch(name) === corpKey, `${corpLabel(corpKey)}법인`, true);

  // 전지점 정직원 급여를 하나의 엑셀로 — 지점마다 시트를 나눈다(본사 표준 양식 그대로).
  // 정직원급여 통합 다운로드(법인/전지점 공용). branchFilter로 대상 지점을 좁히고, label로 파일명/안내문을 정한다.
  const downloadFullTimeSalary = async (branchFilter: (name: string) => boolean, label: string) => {
    try {
      const branchList = branches.length ? branches : (await gasClient.getBranchList()).filter((b: any) => b.role === "branch");
      // '확정(제출)'한 지점만 포함한다 — 지점별 다운로드 버튼과 같은 기준. 미제출·수정중 지점(예: 한남점)이 섞여 나가지 않게 한다.
      // 확정 판정은 화면 캐시(records)가 아니라 '서버에서 신선하게' 읽는다: 관리자가 새로고침 전이면
      // 방금 다른 기기에서 '수정중/미제출'로 바뀐 지점을 못 걸러 잘못된 통합본이 나갈 수 있다(fail-closed — 못 읽으면 취소).
      let freshRecords: any[];
      try {
        const fr = await gasClient.getSharedDataFromServer<any[]>("monthly_closings");
        if (!Array.isArray(fr)) throw new Error("invalid monthly_closings");
        freshRecords = fr;
      } catch {
        window.alert("마감 확정 상태를 서버에서 확인하지 못해 다운로드를 취소했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.");
        return;
      }
      const confirmedSalary = new Set(
        freshRecords.filter((r) => r.month === selectedMonth && (r.section || "purchase") === "salary" && r.status === "confirmed").map((r) => r.branchName)
      );
      const targets = branchList.filter((b: any) => confirmedSalary.has(b.branchName) && branchFilter(b.branchName));
      if (targets.length === 0) { window.alert(`${label} 중 ${selectedMonth} 정직원 급여를 '확정(제출)'한 지점이 없습니다.`); return; }
      const loaded = await Promise.all(targets.map(async (b: any) => {
        try {
          const s = await gasClient.getSharedDataFromServer<any[]>(`monthly_fulltime_salary:${b.branchName}:${selectedMonth}`);
          return { branch: b, salary: Array.isArray(s) ? s : [], failed: false };
        } catch { return { branch: b, salary: [] as any[], failed: true }; }
      }));
      // 읽기 실패를 삼키면 그 지점이 '데이터 없음'처럼 빠져 불완전한 통합 파일이 나간다 → 하나라도 실패하면 전체 취소.
      const failed = loaded.filter((r) => r.failed).map((r) => r.branch.branchName);
      if (failed.length > 0) {
        window.alert(`다음 지점의 정직원 급여를 서버에서 불러오지 못해 다운로드를 취소했습니다:\n${failed.join(", ")}\n네트워크 확인 후 다시 시도해주세요. (불완전한 파일은 만들지 않았습니다.)`);
        return;
      }
      // 확정했는데 급여 내역이 비어 있는 지점 — 뭔가 잘못된 상태다('확정'하려면 내역이 있어야 함).
      // 조용히 빼고 완성본처럼 저장하면 관리자가 누락을 모른 채 급여를 지급할 수 있어 위험하다 → 반드시 알리고 관리자가 결정한다.
      const confirmedButEmpty = loaded.filter((r) => !r.failed && r.salary.length === 0).map((r) => r.branch.branchName);
      const withData = loaded.filter((r) => r.salary.length > 0);
      if (confirmedButEmpty.length > 0) {
        const proceed = window.confirm(
          `다음 지점은 '확정' 표시가 있으나 급여 내역이 서버에 비어 있습니다:\n${confirmedButEmpty.join(", ")}\n\n` +
          `이 지점들은 통합 파일에서 빠집니다. 빼고 나머지만 받으시겠습니까?\n` +
          `(취소하면 다운로드를 멈춥니다 — 해당 지점에서 [월말마감 → 정직원 급여대장]을 연 뒤 저장하고 다시 '확정'하면 포함됩니다.)`
        );
        if (!proceed) return;
      }
      if (withData.length === 0) { window.alert(`${selectedMonth} 정직원 급여대장이 저장된 지점이 없습니다.`); return; }

      const XLSXSMod: any = await import("xlsx-js-style");
      const XLSXS: any = XLSXSMod && XLSXSMod.utils ? XLSXSMod : (XLSXSMod && XLSXSMod.default) ? XLSXSMod.default : XLSXSMod;
      const { buildFullTimeSalarySheet } = await import("./branch/helpers/fullTimeSalaryWorkbook");
      const wb = XLSXS.utils.book_new();
      const usedNames = new Set<string>();
      withData.forEach(({ branch, salary }) => {
        // 엑셀 시트명 제약: 31자 이하 + \/?*[]: 금지 + 중복 불가.
        let name = String(branch.branchName).replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "지점";
        let n = name, i = 2;
        while (usedNames.has(n)) { const suffix = `(${i++})`; n = `${name.slice(0, 31 - suffix.length)}${suffix}`; }
        usedNames.add(n);
        XLSXS.utils.book_append_sheet(wb, buildFullTimeSalarySheet(XLSXS, branch.branchName, selectedMonth, salary), n);
      });
      XLSXS.writeFile(wb, `${label}_정직원급여_${selectedMonth}.xlsx`);
      // 파일이 실제로 저장된 뒤에만 '내 다운로드 시각'을 기록한다(중간 취소/실패 시에는 기록하지 않음).
      withData.forEach(({ branch }) => markDownloaded(branch.branchName, "salary"));
    } catch (error) {
      console.error("정직원급여 통합 다운로드 실패:", error);
      window.alert("정직원 급여 데이터를 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.");
    }
  };
  // 정직원급여는 법인별로만 받는다(전지점 통합 버튼은 UI에서 삭제됨). 매출집계는 전지점 통합만 유지.
  const downloadCorpFullTimeSalary = (corpKey: string) => downloadFullTimeSalary((name) => corpOfBranch(name) === corpKey, `${corpLabel(corpKey)}법인`);

  // 확정 후 수정 여부: 지점이 확정된 섹션을 '수정'으로 다시 연 순간 기록되는 플래그(재확정해도 유지, 오탐 없음).
  // 버튼을 누르면 말풍선으로 (내 다운로드 시각 + 수정 이력)을 보여준다.
  // 취소되어 '미제출(pending)'인 섹션은 표시하지 않는다 — 초기화 정리 저장이 실패해 표식이 찌꺼기로 남아도 무해하게 한다.
  // 수정기록 버튼 — 엑셀 다운로드 버튼처럼 항상 자리에 있고, '확정 후 수정' 기록이 있을 때만 색이 켜져(검정) 클릭할 수 있다.
  // 기록이 없으면 회색 비활성. 클릭하면 말풍선으로 (내 다운로드 시각 + 수정 이력)을 보여준다. 스타일·크기는 엑셀 버튼과 통일.
  const modifiedButton = (rec: any, branchName: string, section: "salary" | "purchase" | "salesSummary") => {
    const has = !!rec?.editedAfterConfirm && rec?.status !== "pending";
    return (
      <button
        type="button"
        disabled={!has}
        onClick={has ? (e) => {
          modAnchorRef.current = e.currentTarget;
          const pos = computeModPos(e.currentTarget);
          setModPopup({ ...pos, branch: branchName, section, rec });
        } : undefined}
        title={has ? "확정 후 수정한 기록 보기" : "수정 기록 없음"}
        className={`inline-flex h-7 w-[76px] items-center justify-center gap-1 rounded-md text-[11px] font-black transition-colors ${has ? "bg-[#212121] text-white hover:bg-black cursor-pointer" : "bg-[#E5E7EB] text-[#6B7280] cursor-not-allowed"}`}
      >
        <Edit3 className="w-3 h-3" /> 수정기록
      </button>
    );
  };

  // 말풍선은 화면 좌표로 고정해 띄운다. 스크롤/리사이즈 때 '닫지 말고' 앵커 버튼을 따라 위치만 갱신한다
  // (예전엔 스크롤=닫기라 내용을 읽으려 스크롤하면 바로 꺼졌다). 버튼이 화면 밖으로 사라지면 그때만 닫는다.
  useEffect(() => {
    if (!modPopup) return;
    let raf = 0;
    const reposition = () => {
      const el = modAnchorRef.current;
      if (!el) { setModPopup(null); return; }
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) { setModPopup(null); return; }
      const pos = computeModPos(el);
      setModPopup((prev) => (prev ? { ...prev, ...pos } : prev));
    };
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(reposition); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setModPopup(null); };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onKey);
    };
    // 대상(지점·섹션)이 바뀔 때만 재장착 — 위치 갱신(setModPopup)마다 재장착되지 않게 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modPopup?.branch, modPopup?.section, computeModPos]);

  return (
    <section className="admin-monthly-closing-status-section bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
      {/* 헤더: 제목 + 전지점 매출집계 + 월 선택 + 새로고침 (컴팩트 h-8 컨트롤) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="space-y-1.5">
          {/* 섹션 제목 = 바닐라 알약(지점 DESIGN.md §6, 색만 연한 관리자 바닐라). bg-amber-50 → var(--admin-vanilla) */}
          <h2 className="inline-flex w-fit items-center rounded-full border border-[#212121] bg-amber-50 px-3 py-1.5 text-[11px] font-black text-gray-900">제출현황</h2>
          <p className="text-[11px] text-gray-400">선택한 월 기준 지점별 3개 마감(매출집계·매입매출·정직원 급여) 상태</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* 정직원급여·매출집계 '법인별' 배치 다운로드는 각 법인 밴드(제목 행)에 있다.
              여기 '전지점 매출집계'는 모든 법인을 한 번에 받는 전체용으로 유지한다. */}
          <button type="button" onClick={() => void downloadAllSalesSummary()} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#1A3C6E]/25 bg-white px-2.5 text-[11px] font-black text-[#1A3C6E] hover:bg-[#2E6DB4]/10 cursor-pointer">
            <Download className="w-3.5 h-3.5" /> 전지점 매출집계
          </button>
          <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-bold" />
          <button onClick={() => void loadData()} className="h-8 rounded-lg bg-[#2E6DB4] text-white px-3 text-[11px] font-black cursor-pointer">새로고침</button>
        </div>
      </div>

      {/* 미제출 요약 카드 3개 — 섹션과 구분되는 배경색 + 검정 테두리 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-[#212121] bg-[#FBF4E6] px-3 py-2.5 flex items-center justify-between gap-2"><span className="text-[11px] font-black text-gray-800 leading-tight">정직원 급여<br />미제출</span><span className="text-xl font-black text-gray-900">{sectionStats.salary}</span></div>
        <div className="rounded-xl border border-[#212121] bg-[#FBF4E6] px-3 py-2.5 flex items-center justify-between gap-2"><span className="text-[11px] font-black text-gray-800 leading-tight">매입매출<br />미제출</span><span className="text-xl font-black text-gray-900">{sectionStats.purchase}</span></div>
        <div className="rounded-xl border border-[#212121] bg-[#FBF4E6] px-3 py-2.5 flex items-center justify-between gap-2"><span className="text-[11px] font-black text-gray-800 leading-tight">매출집계<br />미제출</span><span className="text-xl font-black text-gray-900">{sectionStats.salesSummary}</span></div>
      </div>

      {/* 법인별 3개 섹션 — 각 법인을 제목 + 테두리로 묶고, 제목 옆에 그 법인 정직원급여 다운로드 버튼 */}
      {loading ? (
        <div className="py-10 text-center"><LoadingSpinner size="sm" /></div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-gray-400 font-bold text-xs">등록된 지점이 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {CORP_GROUPS.map((corp) => {
            const items = rows.filter(({ branch }) => corpOfBranch(branch.branchName) === corp.key);
            if (items.length === 0) return null;
            return (
              <div key={corp.key} className="rounded-2xl border border-[#212121] bg-white overflow-hidden">
                {/* 법인 제목 밴드 + 그 법인 배치 다운로드 버튼(정직원급여 받기 · 매출집계 전체).
                    bg-amber-50 → var(--admin-vanilla)(연한 바닐라). 버튼은 검정 알약(지점 DESIGN.md §10). */}
                <div className="flex items-center justify-between gap-2 flex-wrap px-4 py-2.5 border-b border-[#212121] bg-amber-50">
                  <h3 className="text-sm font-black text-gray-900">{corp.label} 법인 <span className="text-gray-500 font-bold text-[11px]">· {items.length}개 지점</span></h3>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button type="button" onClick={() => void downloadCorpFullTimeSalary(corp.key)} title={`${corp.label} 법인의 확정 지점 정직원급여를 한 파일로 받습니다`} className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#212121] text-white px-3 text-[11px] font-black hover:bg-black cursor-pointer whitespace-nowrap">
                      <Download className="w-3.5 h-3.5" /> 정직원급여 받기
                    </button>
                    <button type="button" onClick={() => void downloadCorpSalesSummary(corp.key)} title={`${corp.label} 법인 매출집계를 한 파일로 받습니다`} className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#212121] text-white px-3 text-[11px] font-black hover:bg-black cursor-pointer whitespace-nowrap">
                      <Download className="w-3.5 h-3.5" /> 매출집계 전체
                    </button>
                  </div>
                </div>
                {/* 그 법인 지점 표 */}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-xs table-fixed">
                    {/* 표 헤더 = 엘리스(admin-redesign thead tr, 연한 엘리스블루). 라벨은 text-[#212121]로 100% 검정
                        (text-gray-*는 68% 회색으로 치환돼 흐려짐 — DESIGN.md §9-1).
                        법인별 배치 다운로드 버튼은 위 법인 밴드에 있다. 여기 헤더는 라벨만.
                        table-fixed + 각 th 고정폭 → 법인 표가 여러 개라도 컬럼 x위치가 항상 같게 정렬된다
                        (auto 레이아웃이면 법인마다 지점명 길이로 '지점' 폭이 달라져 뒤 컬럼이 어긋난다). */}
                    <thead className="text-left text-[11px] font-black border-b bg-gray-50">
                      <tr>
                        <th className="w-[160px] py-2 px-3 text-[#212121]">지점</th>
                        <th className="w-[220px] py-2 px-3 text-center text-[#212121]">정직원급여</th>
                        <th className="w-[220px] py-2 px-3 text-center text-[#212121]">월말마감</th>
                        <th className="w-[160px] py-2 px-3 text-center text-[#212121]">매출집계</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {items.map(({ branch, bySection }) => {
                        const dlBtn = (section: "salesSummary" | "purchase" | "salary") => {
                          const ok = bySection[section]?.status === "confirmed";
                          return (
                            <button
                              type="button"
                              disabled={!ok}
                              onClick={() => { void (section === "purchase" ? downloadBranchMonthlyClose(branch.branchName) : downloadBranchSection(branch.branchName, section)); }}
                              title={ok ? "엑셀 다운로드 (기본 양식)" : "확정된 마감만 다운로드할 수 있습니다"}
                              // 확정/미확정 버튼 크기·모양을 동일하게: 두 상태 모두 같은 고정폭(w-[60px]) + 중앙정렬 + 솔리드 채움 박스.
                              // 확정=검정 솔리드/흰 글자, 미확정=회색 솔리드/옅은 글자 — 채움 '방식'이 같아 크기가 동일하게 읽힌다(꽉 찬 검정만 커 보이던 착시 제거).
                              className={`inline-flex h-7 w-[60px] items-center justify-center gap-1 rounded-md text-[11px] font-black transition-colors ${ok ? "bg-[#212121] text-white hover:bg-black cursor-pointer" : "bg-[#E5E7EB] text-[#6B7280] cursor-not-allowed"}`}
                            >
                              <Download className="w-3 h-3" /> 엑셀
                            </button>
                          );
                        };
                        return (
                          <tr key={`${branch.branchName}-${selectedMonth}`} className="hover:bg-slate-50/60">
                            <td className="py-2 px-3 font-black text-gray-800 truncate" title={branch.branchName}>{branch.branchName}</td>
                            {/* 상태 캡 바로 오른쪽에 다운로드 버튼 + (있으면) 확정후수정 표시를 붙인다 — 별도 '엑셀' 컬럼을 두지 않는다(사용자 지정). */}
                            <td className="py-2 px-3 text-center">
                              <span className="inline-flex items-center justify-center gap-1 flex-wrap">
                                {monthlyCloseBadge(bySection.salary?.status || null)}
                                {dlBtn("salary")}
                                {modifiedButton(bySection.salary, branch.branchName, "salary")}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-center">
                              <span className="inline-flex items-center justify-center gap-1 flex-wrap">
                                {monthlyCloseBadge(bySection.purchase?.status || null)}
                                {dlBtn("purchase")}
                                {modifiedButton(bySection.purchase, branch.branchName, "purchase")}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-center">
                              <span className="inline-flex items-center justify-center gap-1 flex-wrap">
                                {monthlyCloseBadge(bySection.salesSummary?.status || null)}
                                {modifiedButton(bySection.salesSummary, branch.branchName, "salesSummary")}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modPopup && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setModPopup(null)} />
          <div className="fixed z-50 w-[320px] rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl" style={{ top: modPopup.top, bottom: modPopup.bottom, left: modPopup.left }} role="dialog">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-black text-amber-800">확정한 뒤 수정한 기록이 있습니다</p>
              <button type="button" onClick={() => setModPopup(null)} className="text-gray-400 hover:text-gray-700"><X className="w-3.5 h-3.5" /></button>
            </div>
            {(() => {
              const dl = (() => { try { return localStorage.getItem(dlTimeKey(modPopup.branch, modPopup.section)); } catch { return null; } })();
              const events: any[] = Array.isArray(modPopup.rec?.editEvents) ? modPopup.rec.editEvents : [];
              return (
                <div className="mt-2 space-y-2 text-[11px] font-bold">
                  <p className="text-gray-600">{modPopup.branch} · {sectionLabel(modPopup.section)}</p>
                  <p className={dl ? "text-[#1A3C6E]" : "text-gray-400"}>
                    내가 엑셀을 다운로드한 시각: {dl ? new Date(dl).toLocaleString() : "이 브라우저에서 받은 기록 없음"}
                  </p>
                  <div className="border-t border-gray-100 pt-2 space-y-1.5 max-h-[40vh] overflow-y-auto">
                    <p className="text-gray-500">수정 이력 (시각 · 지점이 입력한 사유)</p>
                    {events.length === 0 ? (
                      <p className="text-gray-700">· 최종 수정 {modPopup.rec?.updatedAt ? new Date(modPopup.rec.updatedAt).toLocaleString() : "-"}</p>
                    ) : (
                      events.slice().reverse().map((ev, i) => (
                        <div key={i} className="text-gray-700">
                          <p>· 수정 {ev?.at ? new Date(ev.at).toLocaleString() : "-"}</p>
                          <p className={`pl-3 ${ev?.reason ? "text-gray-600" : "text-gray-400"}`}>사유: {ev?.reason || "미입력(옛 기록)"}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </>
      )}
    </section>
  );
}

function AdminManualOvertimesSection() {
  const [records, setRecords] = useState<any[]>([]);
  const [reviewedRecordIds, setReviewedRecordIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchBranch, setSearchBranch] = useState("");
  const [searchName, setSearchName] = useState("");

  const loadData = async () => {
    try {
      setLoading(true);
      const [data, reviewed] = await Promise.all([
        gasClient.getAllManualOvertimes(),
        gasClient.getSharedData<string[]>("admin_reviewed_manual_overtimes").catch(() => [])
      ]);
      setRecords(data || []);
      setReviewedRecordIds(Array.isArray(reviewed) ? reviewed : []);
    } catch (err) {
      console.error("Failed to load manual overtimes:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      const matchBranch = !searchBranch || r.branchName?.toLowerCase().includes(searchBranch.toLowerCase());
      const matchName = !searchName || r.staffName?.toLowerCase().includes(searchName.toLowerCase());
      return matchBranch && matchName;
    }).sort((a, b) => {
      const dateA = a.createdAt || a.settleDate || "";
      const dateB = b.createdAt || b.settleDate || "";
      return dateB.localeCompare(dateA);
    });
  }, [records, searchBranch, searchName]);

  const deleteManualRecord = async (record: any) => {
    if (!record?.branchName || !record?.id) return;
    if (!window.confirm(`${record.branchName} ${record.staffName || ""} ${record.settleDate || ""} 수기 초과근무 내역을 삭제할까요?`)) return;
    try {
      const key = `manual_overtime:${record.branchName}`;
      const previous = await gasClient.getSharedData<any[]>(key);
      const next = (previous || []).filter((item: any) => item.id !== record.id);
      await gasClient.saveSharedData(key, next);
      await loadData();
    } catch (error) {
      console.error("수기 초과근무 삭제 실패:", error);
      alert("수기 초과근무 삭제에 실패했습니다.");
    }
  };

  const getManualReviewId = (record: any) => String(`${record.branchName || ""}:${record.id || ""}:${record.createdAt || record.updatedAt || record.settleDate || ""}`);

  const markManualReviewed = async (record: any) => {
    const reviewId = getManualReviewId(record);
    const next = Array.from(new Set([...reviewedRecordIds, reviewId]));
    setReviewedRecordIds(next);
    await gasClient.saveSharedData("admin_reviewed_manual_overtimes", next);
  };

  const formatShortDate = (isoStr?: string) => {
    if (!isoStr) return "-";
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const date = String(d.getDate()).padStart(2, "0");
      const hour = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      return `${year}-${month}-${date} ${hour}:${min}`;
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="space-y-5 animate-fade-in" id="manual-overtimes-section">
      <div className="bg-white p-6 rounded-2xl border shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="font-black text-gray-800 text-lg flex items-center gap-2">
              <Clock className="w-5 h-5 text-[#2E6DB4]" /> 지점 수기 초과근무 대장
            </h3>
            <p className="text-xs text-gray-400 mt-1">
              각 지점에서 수기로 직접 등록한 초과근무 대장 내역을 종합 모니터링합니다.
            </p>
          </div>
          <button
            onClick={() => void loadData()}
            className="px-4 py-2 bg-[#2E6DB4] hover:bg-[#20528B] text-white rounded-xl text-xs font-bold cursor-pointer transition-colors"
          >
            새로고침
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
          <div>
            <label className="text-[10px] font-black text-gray-500 uppercase">지점명 검색</label>
            <input
              type="text"
              value={searchBranch}
              onChange={(e) => setSearchBranch(e.target.value)}
              placeholder="예: 강남점"
              className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold bg-gray-50 focus:bg-white focus:outline-none focus:border-[#2E6DB4] transition-all"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-gray-500 uppercase">직원명 검색</label>
            <input
              type="text"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              placeholder="예: 홍길동"
              className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold bg-gray-50 focus:bg-white focus:outline-none focus:border-[#2E6DB4] transition-all"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="bg-gray-50 text-left border-b text-gray-500 font-extrabold text-xs">
                <th className="p-4 w-44">등록 일시</th>
                <th className="py-4 px-3 w-32">지점명</th>
                <th className="py-4 px-3 w-32">마감 대상일</th>
                <th className="py-4 px-3 w-32">직원명</th>
                <th className="py-4 px-3 w-28 text-center">초과시간</th>
                <th className="py-4 px-3">수기 입력 사유</th>
                <th className="py-4 px-3 w-24 text-center">확인</th>
                <th className="py-4 px-3 w-20 text-center">관리</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-gray-400 font-semibold">
                    <LoadingSpinner size="sm" />
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-gray-400 font-bold">
                    수기로 등록된 초과근무 내역이 없습니다.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((r, idx) => {
                  const reviewed = reviewedRecordIds.includes(getManualReviewId(r));
                  return (
                  <tr key={r.id || idx} className={`border-b transition-colors ${reviewed ? "bg-white hover:bg-slate-50/50" : "bg-[#F4F2A8]/70 hover:bg-[#F4F2A8]"}`}>
                    <td className="p-4 font-mono text-xs text-gray-500 font-medium whitespace-nowrap">
                      {formatShortDate(r.createdAt)}
                    </td>
                    <td className="py-4 px-3 font-black text-gray-800 whitespace-nowrap">
                      {r.branchName}
                    </td>
                    <td className="py-4 px-3 font-mono text-xs text-blue-700 font-black whitespace-nowrap">
                      {r.settleDate}
                    </td>
                    <td className="py-4 px-3 font-extrabold text-zinc-800 whitespace-nowrap">
                      {r.staffName}
                    </td>
                    <td className="py-4 px-3 text-center whitespace-nowrap">
                      <span className="inline-block px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-black">
                        {r.overtime}h
                      </span>
                    </td>
                    <td className="py-4 px-3 text-gray-700 font-medium max-w-sm truncate">
                      {r.reason || "-"}
                    </td>
                    <td className="py-4 px-3 text-center">
                      {reviewed ? (
                        <span className="inline-flex items-center justify-center rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs font-black text-slate-500">
                          확인됨
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void markManualReviewed(r)}
                          className="inline-flex items-center justify-center rounded-lg bg-[#2E6DB4] px-3 py-2 text-xs font-black text-white hover:bg-[#20528B]"
                        >
                          확인
                        </button>
                      )}
                    </td>
                    <td className="py-4 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => void deleteManualRecord(r)}
                        className="inline-flex items-center justify-center rounded-lg border border-rose-100 bg-rose-50 p-2 text-rose-600 hover:bg-rose-100"
                        title="수기 내역 삭제"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AdminLaborContractsSection() {
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchBranch, setSearchBranch] = useState("");
  const [searchName, setSearchName] = useState("");
  const [templateMeta, setTemplateMeta] = useState<LaborContractTemplateMeta | null>(null);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [contractData, meta] = await Promise.all([
        gasClient.getAllLaborContracts().catch(() => []),
        gasClient.getLaborContractTemplateMeta().catch(() => null)
      ]);
      setContracts(contractData || []);
      setTemplateMeta(meta);
    } catch (err) {
      console.error("Failed to load labor contracts:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

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

  // Firestore 문서 1개는 약 1MB가 상한이고 base64는 원본보다 약 33% 커진다.
  // 700KB를 넘으면 저장 자체가 실패하므로 업로드 시점에 막고 이유를 알린다.
  const TEMPLATE_MAX_BYTES = 700 * 1024;

  const handleTemplateUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // 같은 파일을 다시 골라도 onChange가 뜨도록 초기화
    if (!file) return;
    if (file.size > TEMPLATE_MAX_BYTES) {
      window.alert(`파일이 너무 큽니다. 최대 700KB까지 등록할 수 있습니다.\n선택한 파일: ${Math.round(file.size / 1024)}KB`);
      return;
    }
    setUploadingTemplate(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          const comma = result.indexOf(",");
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const meta: LaborContractTemplateMeta = {
        fileId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        uploadedAt: new Date().toISOString()
      };
      await gasClient.saveLaborContractTemplate(meta, dataBase64);
      setTemplateMeta(meta);
      window.alert("파트타이머 근로계약서 양식을 등록했습니다.");
    } catch (err) {
      console.error("양식 등록 실패", err);
      window.alert("양식 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setUploadingTemplate(false);
    }
  };

  const saveBranchContracts = async (branchName: string, next: any[]) => {
    await gasClient.saveSharedData("labor_contracts:" + branchName, next);
    await gasClient.saveSharedData("labor_contracts_" + branchName, next);
    await loadData();
  };

  const updateStatus = async (row: any, status: string) => {
    const list = (await gasClient.getSharedData<any[]>("labor_contracts:" + row.branchName)) || [];
    const next = list.map((item) => item.id === row.id ? { ...item, status, statusUpdatedAt: new Date().toISOString() } : item);
    await saveBranchContracts(row.branchName, next);
  };

  const deleteContract = async (row: any) => {
    if (!window.confirm(row.branchName + " / " + row.name + " 내역을 삭제할까요?")) return;
    const list = (await gasClient.getSharedData<any[]>("labor_contracts:" + row.branchName)) || [];
    await saveBranchContracts(row.branchName, list.filter((item) => item.id !== row.id));
  };

  // 지점명 필터 드롭다운 옵션 — 등록된 발송 내역에 실제로 있는 지점만(가나다순).
  const branchOptions = useMemo(
    () => Array.from(new Set(contracts.map((c) => c.branchName).filter(Boolean)))
      .sort((a, b) => String(a).localeCompare(String(b), "ko")),
    [contracts]
  );

  const filteredContracts = useMemo(() => contracts.filter((contract) => {
    const matchBranch = !searchBranch || contract.branchName === searchBranch;
    const matchName = !searchName || contract.name?.toLowerCase().includes(searchName.toLowerCase());
    return matchBranch && matchName;
  }).sort((a, b) => {
    if (a.deleteRequested !== b.deleteRequested) return a.deleteRequested ? -1 : 1;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  }), [contracts, searchBranch, searchName]);

  return (
    <div className="space-y-5 animate-fade-in" id="admin-labor-contracts-section">
      <div className="bg-white p-6 rounded-2xl border shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="font-black text-gray-800 text-lg flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-[#2E6DB4]" />
              전 지점 근로계약서 관리
            </h3>
            <p className="text-xs text-gray-400 mt-1">지점이 근로계약서 발송을 요청한 인원 목록입니다.</p>
            <p className="text-xs font-bold text-gray-500 mt-1">
              파트타이머 양식: {templateMeta
                ? `${templateMeta.fileName} (${Math.round(templateMeta.size / 1024)}KB · ${templateMeta.uploadedAt.slice(0, 10)} 등록)`
                : "등록 전 — 지점에서 내려받을 수 없습니다."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className={`px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs font-bold ${uploadingTemplate ? "opacity-40" : "cursor-pointer"}`}>
              {uploadingTemplate ? "등록 중…" : templateMeta ? "파트타이머 양식 교체" : "파트타이머 양식 등록"}
              <input type="file" className="hidden" disabled={uploadingTemplate} onChange={handleTemplateUpload} />
            </label>
            <button onClick={() => void loadData()} className="px-4 py-2 bg-[#2E6DB4] hover:bg-[#20528B] text-white rounded-xl text-xs font-bold cursor-pointer transition-colors">새로고침</button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
          <select value={searchBranch} onChange={(e) => setSearchBranch(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold bg-gray-50">
            <option value="">지점 선택</option>
            {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <input value={searchName} onChange={(e) => setSearchName(e.target.value)} placeholder="직원명 검색" className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold bg-gray-50" />
        </div>
      </div>

      <div className="bg-white rounded-2xl border overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="bg-gray-50 text-left border-b text-gray-500 font-extrabold text-xs">
                  <th className="p-4">등록일</th>
                  <th className="py-4 px-3">지점명</th>
                  <th className="py-4 px-3">구분</th>
                  <th className="py-4 px-3">이름</th>
                  <th className="py-4 px-3">연락처</th>
                  <th className="py-4 px-3">입사·이동일</th>
                  <th className="py-4 px-3 text-right">급여</th>
                  <th className="py-4 px-3 text-center">요청</th>
                  <th className="py-4 px-3 text-center">진행 상태</th>
                  <th className="py-4 px-3 text-center">관리</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="p-12 text-center"><LoadingSpinner size="sm" /></td></tr>
                ) : filteredContracts.length === 0 ? (
                  <tr><td colSpan={10} className="p-12 text-center text-gray-400 font-bold">근로계약서 등록 내역이 없습니다.</td></tr>
                ) : filteredContracts.map((contract, idx) => (
                  <tr key={contract.id || idx} className="border-b hover:bg-slate-50/50">
                    <td className="p-4 font-mono text-xs text-gray-500 whitespace-nowrap">{contract.createdAt ? contract.createdAt.slice(0, 10) : "-"}</td>
                    <td className="py-4 px-3 font-black text-gray-800 whitespace-nowrap">{contract.branchName}</td>
                    <td className="py-4 px-3 whitespace-nowrap">
                      {contract.contractType === "지점이동" ? (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-black text-emerald-800">지점이동</span>
                          {contract.previousBranch && <span className="text-gray-400">← {contract.previousBranch}</span>}
                        </span>
                      ) : contract.contractType === "신규입사" ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-black text-amber-800">신규입사</span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="py-4 px-3 font-extrabold text-zinc-800 whitespace-nowrap">{contract.name}</td>
                    <td className="py-4 px-3 font-mono text-xs text-blue-700 font-black whitespace-nowrap">{contract.phone}</td>
                    <td className="py-4 px-3 font-mono text-xs text-gray-500 whitespace-nowrap">{contract.effectiveDate || "-"}</td>
                    <td className="py-4 px-3 text-right font-black text-zinc-700 whitespace-nowrap">{Number(contract.salary || 0).toLocaleString("ko-KR")}원</td>
                    <td className="py-4 px-3 text-center">{contract.deleteRequested ? <span className="px-2 py-1 rounded-full bg-rose-50 text-rose-700 text-xs font-black">삭제요청</span> : contract.editRequestedAt ? <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-black">수정됨</span> : "-"}</td>
                    <td className="py-4 px-3 text-center">
                      <select value={contract.status || "발송 대기"} onChange={(e) => void updateStatus(contract, e.target.value)} className="border rounded-lg px-2 py-1 text-xs font-black">
                        <option>발송 대기</option>
                        <option>발송 완료</option>
                        <option>서명 완료</option>
                        <option>보류</option>
                      </select>
                    </td>
                    <td className="py-4 px-3 text-center"><button onClick={() => void deleteContract(contract)} className="px-3 py-1.5 bg-rose-50 text-rose-700 rounded-lg text-xs font-black">삭제</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
    </div>
  );
}
