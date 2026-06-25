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
  X, Plus, Edit3, Save, LogOut, ShieldAlert, ClipboardList
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

  // 1. 관리자 필터 관련 상태
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateString());
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
  const [adminSection, setAdminSection] = useState<"dashboard" | "employeeDirectory" | "annualLeave">("dashboard");
  const [directoryTab, setDirectoryTab] = useState<"roster" | "movements">("roster");
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryEmployees, setDirectoryEmployees] = useState<Array<any>>([]);
  const [movementHistory, setMovementHistory] = useState<Array<any>>([]);
  const [directoryBranches, setDirectoryBranches] = useState<Array<any>>([]);
  const [showEmployeeRegistration, setShowEmployeeRegistration] = useState(false);
  const [registrationRows, setRegistrationRows] = useState<Array<any>>([{ branchName: "", name: "", birthDate: "", rank: "사원", entryDate: "", salary: "" }]);
  const [uploadingPayroll, setUploadingPayroll] = useState(false);
  const [salaryUnlocked, setSalaryUnlocked] = useState(false);
  const [anomalyLoading, setAnomalyLoading] = useState(false);
  const [anomalyRecords, setAnomalyRecords] = useState<Array<any>>([]);
  const [cleaningRosters, setCleaningRosters] = useState(false);
  const [clearingDirectory, setClearingDirectory] = useState(false);
  const [closingView, setClosingView] = useState<"dashboard" | "overtime" | "cash">("dashboard");
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
      const list = await gasClient.getDailyList(selectedDate, user.pinHash);
      setDailyList(list);
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
    await Promise.all(Array.from(grouped.entries()).map(async ([branchName, rows]) => {
      const current = await gasClient.getStaffRoster(branchName);
      const next = [...current, ...rows.map((row) => ({
        id: `emp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        employeeId: makeEmployeeId(), name: row.name.trim(), division: "정직원", rank: row.rank || "사원",
        birthDate: row.birthDate, entryDate: row.entryDate, salary: toMoney(row.salary), contractType: "4대보험" as const
      }))];
      await gasClient.saveStaffRoster(branchName, next);
    }));
    setRegistrationRows([{ branchName: "", name: "", birthDate: "", rank: "사원", entryDate: "", salary: "" }]);
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
    try { setAnomalyLoading(true); const branches = await gasClient.getBranchList(); const records = await Promise.all(branches.map(async (branch) => { const history = await gasClient.getBranchHistory(branch.branchName); return history.flatMap((record: any) => { try { const meta = JSON.parse(String(record.memo || "").split("\n---\nMETADATA:")[1] || "{}"); const expenses = (meta.cashExpenses || []).reduce((sum: number, item: any) => sum + (Number(item.amount) || 0), 0); const cashDifference = (Number(meta.cashBalance) || 0) - ((Number(meta.prevDayCash) || 0) + (Number(record.cashSales) || 0) - expenses); const overtime = (meta.staffRows || []).filter((staff: any) => staff.division === "정직원" && Number(staff.overtime) > 0).map((staff: any) => `${staff.name} +${staff.overtime}h`).join(", "); return cashDifference || overtime ? [{ branchName: branch.branchName, date: record.settleDate, issues: [cashDifference ? "현금 차이" : "", overtime ? "초과근무" : ""].filter(Boolean), cashDifference, overtime, reason: meta.cashDiffReason || "" }] : []; } catch { return []; } }); })); setAnomalyRecords(records.flat().sort((a, b) => String(b.date).localeCompare(String(a.date)))); } finally { setAnomalyLoading(false); }
  };
  useEffect(() => { if (adminSection === "dashboard") void loadClosingAnomalies(); }, [adminSection]);

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
            마감현황
          </button>
          <button
            onClick={() => setAdminSection("annualLeave")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-colors ${adminSection === "annualLeave" ? "bg-[#2E6DB4] text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`}
          >
            <Calendar className="w-5 h-5" />
            연차관리
          </button>
          <button
            onClick={() => navigate("/branch-confirm")}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-colors text-white/80 hover:bg-white/10 hover:text-white"
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

              <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
                <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-black text-[#2C3E50]">마감현황</h2><p className="text-xs text-gray-400 mt-1">전체 지점의 마감 상태와 누적 이상치를 점검합니다.</p></div><button onClick={() => void loadClosingAnomalies()} className="text-xs font-bold text-[#2E6DB4]">새로고침</button></div>
                <div className="flex gap-2 border-b border-gray-100"><button onClick={() => setClosingView("dashboard")} className={`px-4 py-3 text-sm font-bold border-b-2 ${closingView === "dashboard" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>대시보드</button><button onClick={() => setClosingView("overtime")} className={`px-4 py-3 text-sm font-bold border-b-2 ${closingView === "overtime" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>초과근무</button><button onClick={() => setClosingView("cash")} className={`px-4 py-3 text-sm font-bold border-b-2 ${closingView === "cash" ? "border-[#2E6DB4] text-[#2E6DB4]" : "border-transparent text-gray-400"}`}>현금차이</button></div>
                {closingView === "dashboard" && <div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500 font-bold">누적 이상치</p><p className="text-2xl font-black">{anomalyRecords.length}건</p></div><div className="rounded-xl bg-rose-50 p-4"><p className="text-xs text-rose-600 font-bold">현금 차이</p><p className="text-2xl font-black text-rose-700">{anomalyRecords.filter((item) => item.cashDifference).length}건</p></div><div className="rounded-xl bg-amber-50 p-4"><p className="text-xs text-amber-600 font-bold">초과근무</p><p className="text-2xl font-black text-amber-700">{anomalyRecords.filter((item) => item.overtime).length}건</p></div></div>}
                <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="border-b text-left text-gray-500"><tr><th className="py-3">마감일</th><th>지점</th><th>마감자</th><th>이상 항목</th><th>내용</th></tr></thead><tbody className="divide-y">{anomalyLoading ? <tr><td colSpan={5} className="py-10 text-center"><LoadingSpinner size="sm" /></td></tr> : anomalyRecords.filter((item) => closingView === "dashboard" || closingView === "cash" ? Boolean(item.cashDifference) : Boolean(item.overtime)).map((item, index, list) => <tr key={`${item.branchName}-${item.date}-${index}`} className={index === 0 || item.date === list[0]?.date ? "bg-sky-50" : ""}><td className="py-3 font-mono">{item.date}</td><td className="font-bold">{item.branchName}</td><td>{item.writer || "-"}</td><td className="font-bold text-rose-600">{closingView === "cash" ? "현금 차이" : closingView === "overtime" ? "초과근무" : item.issues.join(", ")}{(index === 0 || item.date === list[0]?.date) && <span className="ml-2 rounded bg-sky-600 px-1.5 py-0.5 text-[10px] text-white">NEW</span>}</td><td>{closingView === "cash" ? `${formatNumber(item.cashDifference)}원 ${item.reason || ""}` : item.overtime || "-"}</td></tr>)}</tbody></table></div>
              </section>
              <section className="hidden">
                <div className="flex items-center justify-between"><div><h2 className="text-xl font-black text-[#2C3E50]">마감 이상치 누적 모니터링</h2><p className="text-xs text-gray-400 mt-1">현금 차이와 초과근무가 발생한 일일마감 기록을 누적 표시합니다.</p></div><button onClick={() => void loadClosingAnomalies()} className="text-xs font-bold text-[#2E6DB4]">새로고침</button></div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><div className="rounded-xl bg-rose-50 p-4"><p className="text-xs text-rose-500 font-bold">현금 차이 발생</p><p className="text-2xl font-black text-rose-700">{anomalyRecords.filter((item) => item.cashDifference !== 0).length}건</p></div><div className="rounded-xl bg-amber-50 p-4"><p className="text-xs text-amber-600 font-bold">초과근무 발생</p><p className="text-2xl font-black text-amber-700">{anomalyRecords.filter((item) => item.overtime).length}건</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500 font-bold">누적 이상치</p><p className="text-2xl font-black text-slate-700">{anomalyRecords.length}건</p></div></div>
                <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="text-left text-gray-500 border-b"><tr><th className="py-3">마감일</th><th>지점</th><th>이상 항목</th><th className="text-right">현금 차이</th><th>초과근무</th><th>차이 사유</th></tr></thead><tbody className="divide-y">{anomalyLoading ? <tr><td colSpan={6} className="py-8 text-center"><LoadingSpinner size="sm" /></td></tr> : anomalyRecords.slice(0, 100).map((item, index) => <tr key={`${item.branchName}-${item.date}-${index}`}><td className="py-3 font-mono">{item.date}</td><td className="font-bold">{item.branchName}</td><td><span className="text-rose-600 font-bold">{item.issues.join(", ")}</span></td><td className="text-right font-mono">{item.cashDifference ? formatNumber(item.cashDifference) : "-"}</td><td>{item.overtime || "-"}</td><td className="text-gray-500">{item.reason || "-"}</td></tr>)}</tbody></table></div>
              </section>
          
          {/* 상단 웰컴 인사 및 기준 일자 헤더 */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black text-[#2C3E50] tracking-tight">지점 정산 실시간 모니터링</h2>
              <p className="text-xs text-gray-400 mt-0.5 font-medium">14개 외식 사업장의 매출 보고서 자동 합산 내역입니다.</p>
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
                <span className="text-xs font-bold text-gray-400 block">오늘 제출 지점</span>
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
                <span className="text-xs font-bold text-gray-400 block">오늘 미제출 지점</span>
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
                <span className="text-xs font-bold text-gray-400 block">금일 총 수집 매출액</span>
                <span className="text-2xl font-mono font-black text-[#2E6DB4]" id="stat-total-revenue">
                  {formatNumber(stats.revenue)} <span className="text-xs font-sans font-bold text-gray-400">원</span>
                </span>
                <div className="text-[11px] font-semibold text-gray-400">실시간 순수 매출 자동 산정</div>
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
            </>
          )}

          {adminSection === "annualLeave" && <AdminAnnualLeaveSection />}

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
                  {showEmployeeRegistration && <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 space-y-3"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-xs"><thead><tr className="text-gray-500"><th className="text-left pb-2">지점</th><th className="text-left pb-2">이름</th><th className="text-left pb-2">생년월일</th><th className="text-left pb-2">직급</th><th className="text-left pb-2">입사일</th><th className="text-left pb-2">급여</th></tr></thead><tbody>{registrationRows.map((row, index) => <tr key={index}><td className="pr-2 pb-2"><select value={row.branchName} onChange={(e) => setRegistrationRows((rows) => rows.map((item, i) => i === index ? { ...item, branchName: e.target.value } : item))} className="w-full p-2 rounded border"><option value="">지점 선택</option>{directoryBranches.map((branch) => <option key={branch.branchName} value={branch.branchName}>{branch.branchName}</option>)}</select></td><td className="pr-2 pb-2"><input value={row.name} onChange={(e) => setRegistrationRows((rows) => rows.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} className="w-full p-2 rounded border" /></td><td className="pr-2 pb-2"><input type="date" value={row.birthDate} onChange={(e) => setRegistrationRows((rows) => rows.map((item, i) => i === index ? { ...item, birthDate: e.target.value } : item))} className="w-full p-2 rounded border" /></td><td className="pr-2 pb-2"><input value={row.rank} onChange={(e) => setRegistrationRows((rows) => rows.map((item, i) => i === index ? { ...item, rank: e.target.value } : item))} className="w-full p-2 rounded border" /></td><td className="pr-2 pb-2"><input type="date" value={row.entryDate} onChange={(e) => setRegistrationRows((rows) => rows.map((item, i) => i === index ? { ...item, entryDate: e.target.value } : item))} className="w-full p-2 rounded border" /></td><td className="pb-2"><input type="number" value={row.salary} onChange={(e) => setRegistrationRows((rows) => rows.map((item, i) => i === index ? { ...item, salary: e.target.value } : item))} className="w-full p-2 rounded border" /></td></tr>)}</tbody></table></div><div className="flex gap-2"><button onClick={() => setRegistrationRows((rows) => [...rows, { branchName: "", name: "", birthDate: "", rank: "사원", entryDate: "", salary: "" }])} className="px-3 py-2 bg-white border rounded-lg text-xs font-bold">입력칸 추가</button><button onClick={() => void saveRegistrationRows()} className="px-3 py-2 bg-[#2E6DB4] text-white rounded-lg text-xs font-bold">등록 저장</button></div></div>}
                  <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="bg-gray-50 text-gray-500"><tr><th className="px-4 py-3 text-left">직원ID</th><th className="px-4 py-3 text-left">지점</th><th className="px-4 py-3 text-left">이름</th><th className="px-4 py-3 text-left">생년월일</th><th className="px-4 py-3 text-left">직급</th><th className="px-4 py-3 text-left">입사일</th><th className="px-4 py-3 text-right">급여</th><th className="px-4 py-3 text-left">재직년수</th></tr></thead><tbody className="divide-y divide-gray-100">{directoryEmployees.length ? directoryEmployees.map((employee) => <tr key={`${employee.branchName}-${employee.id}`}><td className="px-4 py-3 font-mono text-xs">{employee.employeeId || employee.id}</td><td className="px-4 py-3 font-bold text-[#1A3C6E]">{employee.branchName}</td><td className="px-4 py-3 font-bold">{employee.name}</td><td className="px-4 py-3 font-mono">{formatBirthDate(employee.birthDate || employee.residentNumber)}</td><td className="px-4 py-3">{employee.rank || "사원"}</td><td className="px-4 py-3 font-mono">{formatDate(employee.entryDate)}</td><td className="px-4 py-3 text-right font-mono">{salaryUnlocked && employee.salary ? formatNumber(employee.salary) : "잠김"}</td><td className="px-4 py-3">{formatTenure(employee.entryDate)}</td></tr>) : <tr><td colSpan={8} className="px-5 py-16 text-center text-gray-400">등록된 정직원이 없습니다.</td></tr>}</tbody></table></div>
                </>
              )}
              {directoryLoading ? <div className="py-20 text-center"><LoadingSpinner size="md" /></div> : directoryTab === "roster" ? (
                <div className="hidden">
                  <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-gray-50 text-gray-500"><tr><th className="px-5 py-3 text-left">지점</th><th className="px-5 py-3 text-left">직원명</th><th className="px-5 py-3 text-left">직급</th><th className="px-5 py-3 text-left">주민등록번호</th><th className="px-5 py-3 text-left">입사일</th></tr></thead><tbody className="divide-y divide-gray-100">{directoryEmployees.length ? directoryEmployees.map((employee) => <tr key={`${employee.branchName}-${employee.id}`}><td className="px-5 py-3 font-bold text-[#1A3C6E]">{employee.branchName}</td><td className="px-5 py-3 font-bold">{employee.name}</td><td className="px-5 py-3">{employee.rank || "사원"}</td><td className="px-5 py-3 font-mono">{employee.residentNumber || "-"}</td><td className="px-5 py-3 font-mono">{employee.entryDate || "-"}</td></tr>) : <tr><td colSpan={5} className="px-5 py-16 text-center text-gray-400">등록된 정직원이 없습니다.</td></tr>}</tbody></table></div>
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
  const [targetBranch, setTargetBranch] = useState("전체");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [saved, branchList] = await Promise.all([
      gasClient.getSharedData<any[]>("admin_notices").catch(() => []),
      gasClient.getBranchList().catch(() => [])
    ]);
    setNotices(Array.isArray(saved) ? saved : []);
    setBranches(Array.isArray(branchList) ? branchList : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveNotice = async () => {
    if (!title.trim() && !body.trim()) return;
    try {
      setSaving(true);
      const next = [{ id: `notice-${Date.now()}`, targetBranch, title: title.trim() || "공지사항", body: body.trim(), createdAt: new Date().toISOString() }, ...notices].slice(0, 20);
      await gasClient.saveSharedData("admin_notices", next);
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
    await gasClient.saveSharedData("admin_notices", next);
    setNotices(next);
  };

  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
      <div>
        <h2 className="text-lg font-black text-[#2C3E50]">지점 공지사항</h2>
        <p className="text-xs text-gray-400 mt-1">여기에 작성한 공지는 각 지점 대시보드 첫 화면에 표시됩니다.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[180px_180px_1fr_auto] gap-2">
        <select value={targetBranch} onChange={(e) => setTargetBranch(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold">
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

  const rows = employees.map((employee) => {
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
