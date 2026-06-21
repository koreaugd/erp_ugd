// src/pages/AdminPage.tsx
import React, { useEffect, useState, useMemo } from "react";
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
  X, Plus, Edit3, Save, LogOut, ShieldAlert
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

  // 고유 브랜드 리스트 추출
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
          <div className="flex items-center gap-3 px-4 py-3 bg-[#2E6DB4] rounded-xl text-white font-bold text-sm">
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
