// src/pages/AdminPage.tsx
import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../contexts/AuthContext";
import { gasClient, DailyListRow, DailySettleDetail, ExpenseDetail, StaffRecord } from "../api/gasClient";
import LoadingSpinner from "../components/LoadingSpinner";
import ToastMessage, { ToastType } from "../components/ToastMessage";
import ConfirmModal from "../components/ConfirmModal";
import NumberInput from "../components/NumberInput";
import { formatNumber } from "../utils/formatNumber";
import * as XLSX from "xlsx";
import { 
  Users, CheckCircle2, AlertTriangle, 
  TrendingUp, Calendar, Filter, 
  Download, FileSpreadsheet, Eye, 
  X, Plus, Edit3, Save, LogOut, ShieldAlert, ClipboardList, Clock, Briefcase, Trash2,
  Coins
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { loginWithAdminPin } from "../api/firebaseAuth";

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
  const [closingView, setClosingView] = useState<"dashboard" | "overtime" | "cash" | "remarks">("dashboard");
  const [dailySettlementTab, setDailySettlementTab] = useState<"status" | "logs">("status");
  const [dailyLogsSubTab, setDailyLogsSubTab] = useState<"logs" | "manualOvertimes">("logs");
  const [monthlyClosingTab, setMonthlyClosingTab] = useState<"status" | "cashManagement" | "cashExpenses">("status");
  const [dashboardAlerts, setDashboardAlerts] = useState<{ editLogs: number; manualOvertimes: number; latestEditLogAt: string; latestManualOvertimeAt: string }>({ editLogs: 0, manualOvertimes: 0, latestEditLogAt: "", latestManualOvertimeAt: "" });
  const [dashboardAlertsLoading, setDashboardAlertsLoading] = useState(false);
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
    try {
      setLoading(true);
      const [list, branches] = await Promise.all([
        gasClient.getDailyList(selectedDate, user.pinHash),
        gasClient.getBranchList().catch(() => [])
      ]);
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
      console.error(e);
      triggerToast(e.message || "정산 리스트를 불러오지 못했습니다.", "error");
    } finally {
      setLoading(false);
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
  };

  const handlePayrollUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []) as File[];
    if (!files.length) return;
    try {
      setUploadingPayroll(true);
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
    try { await loginWithAdminPin(pin); setSalaryUnlocked(true); return true; }
    catch { triggerToast("관리자 PIN이 일치하지 않습니다.", "error"); return false; }
  };

  const downloadEmployeeDirectory = async () => {
    let includeSalary = window.confirm("급여 정보를 포함해 다운로드할까요?");
    if (includeSalary && !salaryUnlocked) includeSalary = await unlockSalary();
    const rows = directoryEmployees.map((employee) => ({ "직원ID": employee.employeeId || employee.id, "지점": employee.branchName, "이름": employee.name, "생년월일": employee.birthDate || "", "직급": employee.rank || "사원", "입사일": employee.entryDate || "", ...(includeSalary ? { "급여": employee.salary || 0 } : {}), "재직년수": formatTenure(employee.entryDate) }));
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
            const hasRemark = Boolean(remarks.staffMemo || remarks.reviewMemo || remarks.otherMemo);
            if (!cashDifference && !overtime && !hasRemark) return [];
            return [{
              branchName: branch.branchName,
              date: record.settleDate,
              writer: record.submittedBy || record.modifiedBy || "-",
              issues: [cashDifference ? "현금 차이" : "", overtime ? "초과근무" : "", hasRemark ? "특이사항" : ""].filter(Boolean),
              cashDifference,
              overtime,
              reason: meta.cashDiffReason || "",
              remarks
            }];
          } catch { return []; }
        });
      }));
      setAnomalyRecords(records.flat().sort((a, b) => String(b.date).localeCompare(String(a.date))));
    } finally {
      setAnomalyLoading(false);
    }
  };
  useEffect(() => { if (adminSection === "dashboard") void loadClosingAnomalies(); }, [adminSection]);

  const loadDashboardAlerts = useCallback(async () => {
    try {
      setDashboardAlertsLoading(true);
      const editAck = localStorage.getItem("admin_dashboard_ack_edit_logs") || "";
      const manualAck = localStorage.getItem("admin_dashboard_ack_manual_overtimes") || "";
      const [editLogs, manualOvertimes] = await Promise.all([
        gasClient.getEditLogs().catch(() => []),
        gasClient.getAllManualOvertimes().catch(() => [])
      ]);
      const afterAck = (value: string | undefined, ack: string) => {
        if (!value) return !ack;
        if (!ack) return true;
        return String(value) > ack;
      };
      const editNew = (editLogs || []).filter((log: any) => afterAck(log.modifiedAt || log.createdAt, editAck));
      const manualNew = (manualOvertimes || []).filter((record: any) => afterAck(record.createdAt || record.updatedAt || record.settleDate, manualAck));
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
      localStorage.setItem("admin_dashboard_ack_edit_logs", dashboardAlerts.latestEditLogAt || new Date().toISOString());
      setDailyLogsSubTab("logs");
      setDashboardAlerts((current) => ({ ...current, editLogs: 0 }));
    } else {
      localStorage.setItem("admin_dashboard_ack_manual_overtimes", dashboardAlerts.latestManualOvertimeAt || new Date().toISOString());
      setDailyLogsSubTab("manualOvertimes");
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

  // ----------------------------------------------------
  // 특정 지점 클릭 시 우측 드로어 상세 오픈 및 서브테이블 로드
  // ----------------------------------------------------
  const handleOpenDetail = async (row: DailyListRow) => {
    if (!row.record || !row.record.recordId) {
      triggerToast("이 지점은 아직 마감을 등록하지 않았습니다.", "warning");
      return;
    }
    
    setSelectedRow(row);
    setIsDrawerOpen(true);
    setIsEditing(false);

    try {
      setDetailLoading(true);
      const res = await gasClient.getDailyDetail(row.record.recordId);
      setDetailData(res);

      // 인라인 수정용 원본 임시 바인딩
      setEditCashSales(String(res.master.cashSales || "0"));
      setEditCardSales(String(res.master.cardSales || "0"));
      setEditTransferSales(String(res.master.transferSales || "0"));
      setEditDeliverySales(String(res.master.deliverySales || "0"));
      setEditMemo(res.master.memo || "");

    } catch (e: any) {
      console.error(e);
      triggerToast("지점 상세 데이터를 불러오지 못했습니다.", "error");
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCloseDrawer = () => {
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
  const handleDownloadExcel = () => {
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

  return (
    <div className="min-h-screen bg-[#F5F7FA] flex" id="admin-layout-wrapper">
      
      {/* PC 전전 사이드바 레이아웃 */}
      <aside className="hidden lg:flex flex-col w-64 bg-[#1A3C6E] text-white p-6 shrink-0" id="sidebar">
        <div className="mb-10 text-center py-4 border-b border-white/10">
          <h2 className="text-2xl font-black tracking-widest text-[#D6E4F0]">ERP_UGD</h2>
          <p className="text-[10px] text-white/60 mt-1 uppercase font-semibold">UGD 주식회사 마감 총괄 시스템</p>
        </div>

        <nav className="grow space-y-2">
          <button
            onClick={() => setAdminSection("dashboard")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-colors ${adminSection === "dashboard" ? "bg-[#2E6DB4] text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`}
          >
            <TrendingUp className="w-5 h-5" />
            대시보드
          </button>
          <button
            onClick={() => setAdminSection("dailySettlement")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-colors ${adminSection === "dailySettlement" ? "bg-[#2E6DB4] text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`}
          >
            <FileSpreadsheet className="w-5 h-5" />
            일일 정산현황
          </button>
          <button
            onClick={() => setAdminSection("monthlyClosing")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-colors ${adminSection === "monthlyClosing" ? "bg-[#2E6DB4] text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`}
          >
            <Coins className="w-5 h-5" />
            월말마감
          </button>
          <button
            onClick={() => setAdminSection("annualLeave")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-colors ${adminSection === "annualLeave" ? "bg-[#2E6DB4] text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`}
          >
            <Calendar className="w-5 h-5" />
            연차관리
          </button>
          <button
            onClick={() => setAdminSection("laborContracts")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-colors ${adminSection === "laborContracts" ? "bg-[#2E6DB4] text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`}
          >
            <Briefcase className="w-5 h-5" />
            근로계약서 발송 현황
          </button>
          <button
            onClick={() => navigate("/branch-confirm")}
            className="w-full flex items-center gap-3 px-4 py-3 mt-8 pt-5 border-t border-white/10 rounded-xl font-bold text-sm transition-colors text-white/80 hover:bg-white/10 hover:text-white"
          >
            <ClipboardList className="w-5 h-5" />
            지점 대시보드
          </button>
          {employeeDirectoryEnabled && <button
            onClick={() => setAdminSection("employeeDirectory")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-colors ${adminSection === "employeeDirectory" ? "bg-[#2E6DB4] text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`}
          >
            <Users className="w-5 h-5" />
            직원명부
          </button>}
          <div className="hidden">
            <TrendingUp className="w-5 h-5" />
            실시간 매출 현황
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/10 rounded-xl text-white/80 hover:text-white font-semibold text-sm cursor-pointer transition-all"
          >
            <LogOut className="w-5 h-5" />
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
        <header className="lg:hidden bg-[#1A3C6E] text-white px-4 py-4 flex items-center justify-between shadow-md">
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
              <AdminNoticeManager />
              <AdminDashboardAlertHub
                pendingDailyCount={stats.pending}
                alerts={dashboardAlerts}
                loading={dashboardAlertsLoading}
                onRefresh={() => void loadDashboardAlerts()}
                onOpen={handleDashboardAlertClick}
              />

              <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
                <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-black text-[#2C3E50]">마감현황</h2><p className="text-xs text-gray-400 mt-1">전체 지점의 마감 상태와 누적 이상치를 점검합니다.</p></div><button onClick={() => void loadClosingAnomalies()} className="text-xs font-bold text-[#2E6DB4]">새로고침</button></div>
                <div className="flex gap-2 border-b border-gray-100"><button onClick={() => setClosingView("dashboard")} className={`px-4 py-3 text-sm font-bold border-b-2 ${closingView === "dashboard" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>대시보드</button><button onClick={() => setClosingView("overtime")} className={`px-4 py-3 text-sm font-bold border-b-2 ${closingView === "overtime" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>초과근무</button><button onClick={() => setClosingView("cash")} className={`px-4 py-3 text-sm font-bold border-b-2 ${closingView === "cash" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>현금차이</button><button onClick={() => setClosingView("remarks")} className={`px-4 py-3 text-sm font-bold border-b-2 ${closingView === "remarks" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>특이사항</button></div>
                {closingView === "dashboard" && <div className="grid grid-cols-1 sm:grid-cols-4 gap-3"><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500 font-bold">누적 이상치</p><p className="text-2xl font-black">{anomalyRecords.length}건</p></div><div className="rounded-xl bg-rose-50 p-4"><p className="text-xs text-rose-600 font-bold">현금 차이</p><p className="text-2xl font-black text-rose-700">{anomalyRecords.filter((item) => item.cashDifference).length}건</p></div><div className="rounded-xl bg-amber-50 p-4"><p className="text-xs text-amber-600 font-bold">초과근무</p><p className="text-2xl font-black text-amber-700">{anomalyRecords.filter((item) => item.overtime).length}건</p></div></div>}
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
                        anomalyRecords
                          .filter((item) =>
                            closingView === "remarks"
                              ? Boolean(item.remarks?.staffMemo || item.remarks?.reviewMemo || item.remarks?.otherMemo)
                              : closingView === "dashboard" || closingView === "cash"
                              ? Boolean(item.cashDifference)
                              : Boolean(item.overtime)
                          )
                          .map((item, index, list) => (
                            <tr
                              key={`${item.branchName}-${item.date}-${index}`}
                              className={index === 0 || item.date === list[0]?.date ? "bg-sky-50" : ""}
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
                                  : item.issues.join(", ")}
                                {(index === 0 || item.date === list[0]?.date) && (
                                  <span className="ml-2 rounded bg-sky-600 px-1.5 py-0.5 text-[10px] text-white">
                                    NEW
                                  </span>
                                )}
                              </td>
                              <td>
                                {closingView === "cash"
                                  ? `${formatNumber(item.cashDifference)}원 ${item.reason || ""}`
                                  : closingView === "remarks"
                                  ? <div className="space-y-1 text-xs"><p><b>직원</b> {item.remarks?.staffMemo || "-"}</p><p><b>리뷰</b> {item.remarks?.reviewMemo || "-"}</p><p><b>기타</b> {item.remarks?.otherMemo || "-"}</p></div>
                                  : item.overtime || "-"}
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* 상단 웰컴 인사 및 기준 일자 헤더 */}
              <div className="hidden">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black text-[#2C3E50] tracking-tight">전일 정산 현황</h2>
                  <p className="text-xs text-gray-400 mt-0.5 font-medium">14개 외식 사업장의 전일 기준 매출 보고서 자동 합산 내역입니다.</p>
                </div>

                {/* 필터 세트 */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 border border-gray-200 bg-white py-2 px-3 rounded-xl shadow-xs">
                    <Calendar className="w-4 h-4 text-[#2E6DB4]" />
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="font-mono text-xs font-extrabold text-[#2C3E50] border-0 outline-hidden bg-transparent focus:ring-0 p-0 w-32"
                      id="admin-date-picker"
                    />
                  </div>

                  {/* 엑셀 파일 다운로드 링크 */}
                  <button
                    onClick={handleDownloadExcel}
                    className="flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer select-none"
                    id="btn-excel-download"
                  >
                    <Download className="w-4 h-4" /> 엑셀 다운로드 (XLSX)
                  </button>
                </div>
              </div>

              {/* ----------------------------------------------------
                  [상단 요약 카드 3개]
                 ---------------------------------------------------- */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5" id="stats-cards">
                {/* 1. 제출 상태 지표 */}
                <div className="bg-white p-5 rounded-2xl shadow-xs border border-gray-100 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-gray-400 block">어제 제출 지점</span>
                    <span className="text-2xl font-mono font-black text-[#2C3E50]" id="stat-submitted-count">
                      {stats.submitted} <span className="text-xs font-bold text-gray-300 font-sans">/ {stats.total} 지점</span>
                    </span>
                    <div className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> 완료율 {stats.total > 0 ? Math.round((stats.submitted / stats.total) * 100) : 0}%
                    </div>
                  </div>
                  <div className="p-4 bg-emerald-50 rounded-2xl text-emerald-600">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                </div>

                {/* 2. 미제출 지점 */}
                <div className="bg-white p-5 rounded-2xl shadow-xs border border-gray-100 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-gray-400 block">어제 미제출 지점</span>
                    <span className="text-2xl font-mono font-black text-[#2C3E50]" id="stat-pending-count">
                      {stats.pending} <span className="text-xs font-bold text-gray-300 font-sans">지점</span>
                    </span>
                    {stats.pending > 0 ? (
                      <div className="text-[11px] font-semibold text-[#F39C12] flex items-center gap-1 animate-pulse">
                        <AlertTriangle className="w-3.5 h-3.5" /> 대기 등록 수집 중
                      </div>
                    ) : (
                      <div className="text-[11px] font-semibold text-emerald-600">만점 매장 완료</div>
                    )}
                  </div>
                  <div className="p-4 bg-amber-50 rounded-2xl text-[#F39C12]">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                </div>

                {/* 3. 금일 총 매출 합계 */}
                <div className="bg-white p-5 rounded-2xl shadow-xs border border-gray-100 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-gray-400 block">어제 총 수집 매출액</span>
                    <span className="text-2xl font-mono font-black text-[#2E6DB4]" id="stat-total-revenue">
                      {formatNumber(stats.revenue)} <span className="text-xs font-sans font-bold text-gray-400">원</span>
                    </span>
                    <div className="text-[11px] font-semibold text-gray-400">어제 기준 순수 매출 자동 산정</div>
                  </div>
                  <div className="p-4 bg-blue-50 text-[#2E6DB4] rounded-2xl">
                    <TrendingUp className="w-6 h-6" />
                  </div>
                </div>
              </div>

          {/* ----------------------------------------------------
              [필터 바]
             ---------------------------------------------------- */}
          <div className="bg-white p-4 rounded-2xl shadow-xs border border-gray-100 flex flex-wrap gap-4 items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="text-xs font-bold text-gray-500">브랜드 정밀 필터링</span>
            </div>
            
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5 overflow-x-auto pb-1 max-w-full">
                {brandList.map(brand => (
                  <button
                    key={brand}
                    onClick={() => setSelectedBrand(brand)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer transition-colors whitespace-nowrap ${
                      selectedBrand === brand 
                        ? "bg-[#2E6DB4] text-white" 
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    }`}
                  >
                    {brand}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ----------------------------------------------------
              [지점별 현황 테이블]
             ---------------------------------------------------- */}
          <div className="bg-white rounded-3xl shadow-xs border border-gray-100 overflow-hidden" id="table-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse" id="admin-table">
                <thead>
                  <tr className="bg-[#D6E4F0]/30 border-b border-gray-100 text-left">
                    <th className="px-6 py-4 text-xs font-bold text-gray-500">지점명</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500">브랜드</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 text-right">실시간 총 매출</th>
                    <th className="px-4 py-4 text-xs font-bold text-gray-400 text-right">현금 매출</th>
                    <th className="px-4 py-4 text-xs font-bold text-gray-400 text-right">카드 매출</th>
                    <th className="px-4 py-4 text-xs font-bold text-gray-400 text-right">계좌이체</th>
                    <th className="px-4 py-4 text-xs font-bold text-gray-400 text-right">배달 매출</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500">정산상태</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 text-center">액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm">
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="text-center py-16">
                        <div className="flex flex-col items-center gap-3">
                          <LoadingSpinner size="md" />
                          <span className="text-xs text-gray-400 font-bold">인그레스 스프레드시트 수집 동기화 중...</span>
                        </div>
                      </td>
                    </tr>
                  ) : filteredList.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-16 text-gray-400 text-xs">
                        선택한 날짜 및 브랜드 필터 조건에 부합하는 지점이 존재하지 않습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredList.map((item, index) => {
                      const record = item.record;
                      return (
                        <tr 
                          key={item.branchName}
                          className="hover:bg-gray-50/50 transition-colors"
                        >
                          <td className="px-6 py-4 font-bold text-[#2C3E50]">{item.branchName}</td>
                          <td className="px-6 py-4 text-xs text-gray-500 font-semibold">{item.brand}</td>
                          
                          {/* 실시간 총 매출 */}
                          <td className="px-6 py-4 text-right font-mono font-bold text-[#1A3C6E]">
                            {record ? `${formatNumber(record.totalSales)}원` : "—"}
                          </td>
                          <td className="px-4 py-4 text-right font-mono text-xs text-gray-500">
                            {record ? formatNumber(record.cashSales) : "—"}
                          </td>
                          <td className="px-4 py-4 text-right font-mono text-xs text-gray-500">
                            {record ? formatNumber(record.cardSales) : "—"}
                          </td>
                          <td className="px-4 py-4 text-right font-mono text-xs text-gray-400">
                            {record && record.transferSales ? formatNumber(record.transferSales) : "—"}
                          </td>
                          <td className="px-4 py-4 text-right font-mono text-xs text-gray-400">
                            {record && record.deliverySales ? formatNumber(record.deliverySales) : "—"}
                          </td>

                          {/* 제출 상태 정보 */}
                          <td className="px-6 py-4">
                            {item.submitted ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-full">
                                <CheckCircle2 className="w-3.5 h-3.5" /> 완료
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 text-[#F39C12] text-xs font-bold rounded-full animate-pulse">
                                <AlertTriangle className="w-3.5 h-3.5" /> 미제출
                              </span>
                            )}
                          </td>

                          {/* 보기 액션 */}
                          <td className="px-6 py-4 text-center">
                            {item.submitted ? (
                              <button
                                onClick={() => handleOpenDetail(item)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-[#D6E4F0]/60 text-gray-600 hover:text-[#1A3C6E] text-xs font-bold rounded-xl transition-all cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" /> 상세 보기
                              </button>
                            ) : (
                              <span className="text-xs text-gray-300 font-semibold">대기중</span>
                            )}
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
            </>
          )}

          {adminSection === "annualLeave" && <AdminAnnualLeaveSection />}

          {adminSection === "dailySettlement" && (
            <section className="space-y-5 animate-fade-in">
              <div className="flex gap-2 border-b border-gray-200">
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
              <div className="flex gap-2 border-b border-gray-200">
                <button onClick={() => setMonthlyClosingTab("status")} className={`px-4 py-3 text-sm font-bold border-b-2 ${monthlyClosingTab === "status" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>월말마감 제출현황</button>
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

function AdminNoticeManager() {
  const [notices, setNotices] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [noticeTab, setNoticeTab] = useState<"admin" | "branch">("branch");
  const [targetBranch, setTargetBranch] = useState("전체");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const noticeStorageKey = noticeTab === "admin" ? "admin_dashboard_notices" : "admin_notices";

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
  }, [load]);

  const saveNotice = async () => {
    if (!title.trim() && !body.trim()) return;
    try {
      setSaving(true);
      const next = [{ id: `notice-${Date.now()}`, targetBranch, title: title.trim() || "공지사항", body: body.trim(), createdAt: new Date().toISOString() }, ...notices].slice(0, 20);
      await gasClient.saveSharedData(noticeStorageKey, next);
      setNotices(next);
      setTitle("");
      setBody("");
    } finally {
      setSaving(false);
    }
  };

  const deleteNotice = async (id: string) => {
    if (!window.confirm("공지사항을 삭제할까요?")) return;
    const next = notices.filter((notice) => notice.id !== id);
    await gasClient.saveSharedData(noticeStorageKey, next);
    setNotices(next);
  };

  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
      <div>
        <h2 className="text-lg font-black text-[#2C3E50]">지점 공지사항</h2>
        <p className="text-xs text-gray-400 mt-1">여기에 작성한 공지는 각 지점 대시보드 첫 화면에 표시됩니다.</p>
      </div>
      <div className="flex rounded-xl bg-slate-100 p-1 w-fit">
        <button onClick={() => setNoticeTab("admin")} className={`px-3 py-1.5 rounded-lg text-xs font-black ${noticeTab === "admin" ? "bg-white text-[#2E6DB4] shadow-sm" : "text-gray-500"}`}>관리자 공지</button>
        <button onClick={() => setNoticeTab("branch")} className={`px-3 py-1.5 rounded-lg text-xs font-black ${noticeTab === "branch" ? "bg-white text-[#2E6DB4] shadow-sm" : "text-gray-500"}`}>지점 공지사항</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[180px_180px_1fr_auto] gap-2">
        <select value={targetBranch} onChange={(e) => setTargetBranch(e.target.value)} disabled={noticeTab === "admin"} className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold disabled:bg-gray-100 disabled:text-gray-400">
          <option value="전체">전체공지</option>
          {branches.map((branch) => <option key={branch.branchName} value={branch.branchName}>{branch.branchName}</option>)}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="공지 제목" className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold" />
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="공지 내용" className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold" />
        <button onClick={() => void saveNotice()} disabled={saving} className="px-4 py-2 bg-[#2E6DB4] text-white rounded-xl text-xs font-black disabled:opacity-50">{saving ? "저장 중…" : "공지 등록"}</button>
      </div>
      {notices.length > 0 && (
        <div className="space-y-2">
          {notices.slice(0, 3).map((notice) => (
            <div key={notice.id} className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 border border-slate-100 p-3">
              <div>
                <p className="text-sm font-black text-gray-800">{notice.title} <span className="ml-2 rounded bg-blue-50 px-2 py-0.5 text-[10px] text-[#2E6DB4]">{notice.targetBranch || "전체"}</span></p>
                <p className="text-xs text-gray-500 mt-1">{notice.body}</p>
              </div>
              <button onClick={() => void deleteNotice(notice.id)} className="text-xs font-black text-rose-600">삭제</button>
            </div>
          ))}
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
    <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
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
        <div className="flex flex-wrap gap-2">
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
  const [subTab, setSubTab] = useState<"logs" | "manualOvertimes">(defaultSubTab);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchBranch, setSearchBranch] = useState("");
  const [searchDate, setSearchDate] = useState("");

  const loadLogs = async () => {
    try {
      setLoading(true);
      const data = await gasClient.getEditLogs();
      setLogs(data);
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
    if (before.memo !== after.memo) {
      changes.push(`마감 메모 변경됨`);
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
                    <th className="py-4 px-3 w-20 text-center">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-gray-400 font-semibold">
                        <LoadingSpinner size="sm" />
                      </td>
                    </tr>
                  ) : filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-gray-400 font-bold">
                        기록된 마감 수정 이력이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log) => (
                      <tr key={log.id} className="border-b hover:bg-slate-50/50 transition-colors">
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <AdminManualOvertimesSection />
      )}
    </div>
  );
}

function AdminMonthlyClosingStatusSection() {
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [branches, setBranches] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

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
      const matched = records
        .filter((record) => record.branchName === branch.branchName && record.month === selectedMonth)
        .sort((a, b) => String(b.updatedAt || b.confirmedAt || "").localeCompare(String(a.updatedAt || a.confirmedAt || "")))[0];
      return { branch, record: matched };
    });
  }, [branches, records, selectedMonth]);

  const stats = useMemo(() => {
    const confirmed = rows.filter((row) => row.record?.status === "confirmed").length;
    const editing = rows.filter((row) => row.record?.status === "editing").length;
    return { confirmed, editing, pending: Math.max(rows.length - confirmed - editing, 0), total: rows.length };
  }, [rows]);

  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-[#2C3E50]">월말마감 제출 현황</h2>
          <p className="text-xs text-gray-400 mt-1">선택한 월 기준으로 지점별 월말마감 확정/수정 상태를 확인합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs font-black"
          />
          <button onClick={() => void loadData()} className="px-3 py-2 rounded-xl bg-[#2E6DB4] text-white text-xs font-black">
            새로고침
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500 font-bold">대상 지점</p><p className="text-2xl font-black">{stats.total}</p></div>
        <div className="rounded-xl bg-emerald-50 p-4"><p className="text-xs text-emerald-600 font-bold">확정</p><p className="text-2xl font-black text-emerald-700">{stats.confirmed}</p></div>
        <div className="rounded-xl bg-amber-50 p-4"><p className="text-xs text-amber-600 font-bold">수정중</p><p className="text-2xl font-black text-amber-700">{stats.editing}</p></div>
        <div className="rounded-xl bg-rose-50 p-4"><p className="text-xs text-rose-600 font-bold">미제출</p><p className="text-2xl font-black text-rose-700">{stats.pending}</p></div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500 font-black">
            <tr>
              <th className="py-3 px-4">월</th>
              <th className="py-3 px-4">지점</th>
              <th className="py-3 px-4">상태</th>
              <th className="py-3 px-4">처리자</th>
              <th className="py-3 px-4">처리시각</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={5} className="py-10 text-center"><LoadingSpinner size="sm" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="py-10 text-center text-gray-400 font-bold">등록된 지점이 없습니다.</td></tr>
            ) : rows.map(({ branch, record }) => {
              const status = record?.status || "pending";
              const label = status === "confirmed" ? "월말마감 확정" : status === "editing" ? "수정중" : "미제출";
              const badge = status === "confirmed" ? "bg-emerald-50 text-emerald-700" : status === "editing" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700";
              const date = record?.updatedAt || record?.confirmedAt || "";
              return (
                <tr key={`${branch.branchName}-${selectedMonth}`} className="hover:bg-slate-50/60">
                  <td className="py-3 px-4 font-mono text-xs font-bold">{selectedMonth}</td>
                  <td className="py-3 px-4 font-black text-gray-800">{branch.branchName}</td>
                  <td className="py-3 px-4"><span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-black ${badge}`}>{label}</span></td>
                  <td className="py-3 px-4 text-xs font-bold text-gray-600">{record?.writer || "-"}</td>
                  <td className="py-3 px-4 font-mono text-xs text-gray-500">{date ? new Date(date).toLocaleString("ko-KR") : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AdminManualOvertimesSection() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchBranch, setSearchBranch] = useState("");
  const [searchName, setSearchName] = useState("");

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await gasClient.getAllManualOvertimes();
      setRecords(data || []);
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
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-gray-400 font-bold">
                    수기로 등록된 초과근무 내역이 없습니다.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((r, idx) => (
                  <tr key={r.id || idx} className="border-b hover:bg-slate-50/50 transition-colors">
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
                ))
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
  const loadData = async () => { try { setLoading(true); const data = await gasClient.getAllLaborContracts(); setContracts(data || []); } catch (err) { console.error("Failed to load labor contracts:", err); } finally { setLoading(false); } };
  useEffect(() => { void loadData(); }, []);
  const saveBranchContracts = async (branchName: string, next: any[]) => { await gasClient.saveSharedData("labor_contracts:" + branchName, next); await gasClient.saveSharedData("labor_contracts_" + branchName, next); await loadData(); };
  const updateStatus = async (row: any, status: string) => { const list = (await gasClient.getSharedData<any[]>("labor_contracts:" + row.branchName)) || []; const next = list.map((item) => item.id === row.id ? { ...item, status, statusUpdatedAt: new Date().toISOString() } : item); await saveBranchContracts(row.branchName, next); };
  const deleteContract = async (row: any) => { if (!window.confirm(row.branchName + " / " + row.name + " 내역을 삭제할까요?")) return; const list = (await gasClient.getSharedData<any[]>("labor_contracts:" + row.branchName)) || []; await saveBranchContracts(row.branchName, list.filter((item) => item.id !== row.id)); };
  const filteredContracts = useMemo(() => contracts.filter((c) => { const matchBranch = !searchBranch || c.branchName?.toLowerCase().includes(searchBranch.toLowerCase()); const matchName = !searchName || c.name?.toLowerCase().includes(searchName.toLowerCase()); return matchBranch && matchName; }).sort((a, b) => { if (a.deleteRequested !== b.deleteRequested) return a.deleteRequested ? -1 : 1; return String(b.createdAt || "").localeCompare(String(a.createdAt || "")); }), [contracts, searchBranch, searchName]);
  return <div className="space-y-5 animate-fade-in" id="admin-labor-contracts-section"><div className="bg-white p-6 rounded-2xl border shadow-sm"><div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"><div><h3 className="font-black text-gray-800 text-lg flex items-center gap-2"><Briefcase className="w-5 h-5 text-[#2E6DB4]" /> 전 지점 근로계약서 관리</h3><p className="text-xs text-gray-400 mt-1">지점에서 등록/수정요청한 인적사항의 진행 상태를 변경하거나 삭제요청을 처리합니다.</p></div><button onClick={() => void loadData()} className="px-4 py-2 bg-[#2E6DB4] hover:bg-[#20528B] text-white rounded-xl text-xs font-bold cursor-pointer transition-colors">새로고침</button></div><div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5"><input value={searchBranch} onChange={(e) => setSearchBranch(e.target.value)} placeholder="지점명 검색" className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold bg-gray-50" /><input value={searchName} onChange={(e) => setSearchName(e.target.value)} placeholder="직원명 검색" className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold bg-gray-50" /></div></div><div className="bg-white rounded-2xl border overflow-hidden shadow-2xs"><div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead><tr className="bg-gray-50 text-left border-b text-gray-500 font-extrabold text-xs"><th className="p-4">등록일</th><th className="py-4 px-3">지점명</th><th className="py-4 px-3">이름</th><th className="py-4 px-3">연락처</th><th className="py-4 px-3 text-right">급여</th><th className="py-4 px-3 text-center">요청</th><th className="py-4 px-3 text-center">진행 상태</th><th className="py-4 px-3 text-center">관리</th></tr></thead><tbody>{loading ? <tr><td colSpan={8} className="p-12 text-center"><LoadingSpinner size="sm" /></td></tr> : filteredContracts.length === 0 ? <tr><td colSpan={8} className="p-12 text-center text-gray-400 font-bold">근로계약서 등록 내역이 없습니다.</td></tr> : filteredContracts.map((c, idx) => <tr key={c.id || idx} className="border-b hover:bg-slate-50/50"><td className="p-4 font-mono text-xs text-gray-500 whitespace-nowrap">{c.createdAt ? c.createdAt.slice(0, 10) : "-"}</td><td className="py-4 px-3 font-black text-gray-800 whitespace-nowrap">{c.branchName}</td><td className="py-4 px-3 font-extrabold text-zinc-800 whitespace-nowrap">{c.name}</td><td className="py-4 px-3 font-mono text-xs text-blue-700 font-black whitespace-nowrap">{c.phone}</td><td className="py-4 px-3 text-right font-black text-zinc-700 whitespace-nowrap">{Number(c.salary || 0).toLocaleString("ko-KR")}원</td><td className="py-4 px-3 text-center">{c.deleteRequested ? <span className="px-2 py-1 rounded-full bg-rose-50 text-rose-700 text-xs font-black">삭제요청</span> : c.editRequestedAt ? <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-black">수정됨</span> : "-"}</td><td className="py-4 px-3 text-center"><select value={c.status || "발송 대기"} onChange={(e) => void updateStatus(c, e.target.value)} className="border rounded-lg px-2 py-1 text-xs font-black"><option>발송 대기</option><option>발송 완료</option><option>서명 완료</option><option>보류</option></select></td><td className="py-4 px-3 text-center"><button onClick={() => void deleteContract(c)} className="px-3 py-1.5 bg-rose-50 text-rose-700 rounded-lg text-xs font-black">삭제</button></td></tr>)}</tbody></table></div></div></div>;
}
