// src/pages/InputPage.tsx
import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthContext } from "../contexts/AuthContext";
import { useDailyForm } from "../hooks/useDailyForm";
import { gasClient } from "../api/gasClient";
import NumberInput from "../components/NumberInput";
import ToastMessage, { ToastType } from "../components/ToastMessage";
import ConfirmModal from "../components/ConfirmModal";
import LoadingSpinner from "../components/LoadingSpinner";
import { 
  ArrowLeft, Store, Calendar, HelpCircle, 
  Trash2, Plus, FileText, CheckCircle2, 
  ChevronRight, CircleDollarSign, NotebookTabs, 
  UsersRound, Landmark 
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { formatNumber } from "../utils/formatNumber";

export default function InputPage() {
  const { user } = useAuthContext();
  const location = useLocation();
  const navigate = useNavigate();

  // 이전 확인 화면에서의 라우팅 파라미터 복구
  const isEditMode = location.state?.isEdit || false;
  const initialData = location.state?.initialData || null;
  const recordId = location.state?.recordId || null;

  const {
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
    getSubmissionPayload
  } = useDailyForm(initialData);

  // 로컬 알림/토스트 및 모달 제어 상태
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [showValidationErrors, setShowValidationErrors] = useState<boolean>(false);

  // 본인 세션 없을 경우 돌려보내기
  useEffect(() => {
    if (!user) {
      navigate("/");
    }
  }, [user, navigate]);

  const triggerToast = (message: string, type: ToastType = "success") => {
    setToast({ message, type });
  };

  const handleValidateForm = (): boolean => {
    // 필수 데이터 검수: 현금 매출, 카드 매출
    if (!cashSales || !cardSales) {
      setShowValidationErrors(true);
      triggerToast("필수 항목인 현금 매출과 카드 매출을 모두 입력해 주세요.", "error");
      
      // 상단 필수 필드로 자동 스크롤
      const element = document.getElementById("revenue-section");
      if (element) {
        element.scrollIntoView({ behavior: "smooth" });
      }
      return false;
    }
    return true;
  };

  const openConfirmModal = () => {
    if (handleValidateForm()) {
      setIsSubmitModalOpen(true);
    }
  };

  const handleFinalSubmit = async () => {
    if (!user) return;
    setIsSubmitModalOpen(false);
    setSubmitting(true);

    try {
      const { master, expenses, staff: staffData } = getSubmissionPayload(user.branchName, user.pinHash);
      
      if (isEditMode && recordId) {
        // 관리자/지점 수정 업데이트 실행
        await gasClient.updateDaily(recordId, master, expenses, staffData, user.branchName);
        triggerToast("마감 정산 수정 사항이 저장되었습니다.", "success");
      } else {
        // 신규 추가 실행 (recordId를 내부적으로 UUID 생성하여 위임)
        await gasClient.submitDaily(master, expenses, staffData);
        triggerToast("마감 정산이 안전하게 제출되었습니다.", "success");
      }

      setSubmitted(true);
    } catch (error: any) {
      console.error(error);
      triggerToast(error.message || "원격 데이터베이스 저장 실패", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return null;

  if (submitted) {
    /* 최종 마감 제출 완료 뷰 */
    return (
      <div 
        className="min-h-screen bg-[#F5F7FA] flex items-center justify-center p-4 py-12"
        id="input-success-wrapper"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-xl bg-white p-8 rounded-3xl shadow-xl border border-gray-150 text-center space-y-6"
          id="input-success-card"
        >
          <div className="inline-flex w-16 h-16 rounded-full bg-emerald-50 items-center justify-center text-emerald-600 mb-2">
            <CheckCircle2 className="w-10 h-10 animate-bounce" />
          </div>

          <div>
            <h2 className="text-2xl font-extrabold text-zinc-900">
              {isEditMode ? "정산 수정 완료!" : "마감 정산 제출 성공!"}
            </h2>
            <p className="text-sm text-gray-400 mt-2">
              입력받은 {user.branchName}의 당일 정산 정보가 실시간 데이터베이스(Google Sheets)에 최종 전송 기록되었습니다.
            </p>
          </div>

          {/* 매출 요역 카드 */}
          <div className="bg-zinc-100/50 rounded-2xl p-5 text-left border border-gray-150 divide-y divide-gray-100 font-mono text-sm">
            <div className="flex justify-between py-2 items-center">
              <span className="text-zinc-700 font-sans font-medium">정산일자</span>
              <span className="text-gray-600 font-bold">{settleDate}</span>
            </div>
            <div className="flex justify-between py-2 items-center">
              <span className="text-zinc-700 font-sans font-medium">실시간 총 매출</span>
              <span className="text-zinc-955 text-zinc-900 font-extrabold text-base">{formatNumber(totalSales)} 원</span>
            </div>
            <div className="flex justify-between py-2 items-center text-xs text-gray-500">
              <span className="font-sans">현금 매출</span>
              <span>{formatNumber(cashSales)} 원</span>
            </div>
            <div className="flex justify-between py-2 items-center text-xs text-gray-500">
              <span className="font-sans">카드 매출</span>
              <span>{formatNumber(cardSales)} 원</span>
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={() => navigate("/branch-confirm")}
              className="w-full py-4 bg-zinc-900 hover:bg-black text-white font-bold rounded-2xl transition-colors cursor-pointer shadow-md text-sm"
              id="btn-success-home"
            >
              지점 게이트 포털로 돌아가기
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F7FA] pb-24" id="input-page-wrapper">
      {/* 1. 상단 고정 바 (지점 정보 브랜딩 + 일차 선택 + 진행바) */}
      <header 
        className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-gray-100 shadow-xs px-4 py-3 sm:px-6"
        id="input-header"
      >
        <div className="max-w-4xl mx-auto flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate("/branch-confirm")}
                className="p-2 -ml-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer transition-all"
                id="btn-input-abort"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <div className="flex items-center gap-1.5 font-bold text-gray-800 text-sm">
                  <Store className="w-4 h-4 text-zinc-900" />
                  {user.branchName}
                </div>
                <p className="text-xs text-gray-400 font-medium">brand: {user.brand}</p>
              </div>
            </div>

            {/* 정산 기준일 선택 (오늘 및 소급 변경 가능) */}
            <div className="flex items-center gap-2 border border-gray-150 bg-gray-50 py-1.5 px-3 rounded-xl">
              <Calendar className="w-3.5 h-3.5 text-zinc-600" />
              <input
                type="date"
                value={settleDate}
                onChange={(e) => setSettleDate(e.target.value)}
                className="font-mono text-xs font-bold text-zinc-800 border-0 bg-transparent py-0 outline-hidden focus:ring-0 w-32"
                id="input-settle-date"
              />
            </div>
          </div>

          {/* 진행율 표시바 */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] font-bold text-gray-400">
              <span className="flex items-center gap-1">필수 입력 진행도 {isEditMode && <span className="text-[#F39C12]">(수정 모드)</span>}</span>
              <span className={progressRatio === 100 ? "text-emerald-600" : "text-zinc-800"}>
                {progressRatio}%
              </span>
            </div>
            <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
              <motion.div 
                className={`h-full ${progressRatio === 100 ? "bg-[#27AE60]" : "bg-zinc-800"}`}
                initial={{ width: 0 }}
                animate={{ width: `${progressRatio}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>
        </div>
      </header>

      {/* 2. 메인 입력 영역 */}
      <main className="max-w-4xl mx-auto px-4 mt-6 space-y-6" id="input-main-content">
        
        {/* [섹션 1] 매출 입력 */}
        <section 
          className="bg-white rounded-3xl shadow-xs border border-gray-100 overflow-hidden" 
          id="revenue-section"
        >
          <div className="p-5 sm:p-6 border-b border-gray-50 bg-zinc-50 flex items-center gap-3">
            <div className="p-2 bg-zinc-150 text-zinc-900 rounded-xl">
              <CircleDollarSign className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-zinc-800">매출 입력</h3>
              <p className="text-[11px] text-gray-400 font-medium font-bold">오늘 마감 정산 매출을 정확하게 입력하세요 (*필수)</p>
            </div>
          </div>

          <div className="p-6 space-y-4 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:space-y-0">
            {/* 현금 매출 (필수) */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500 block">
                현금 매출 <span className="text-[#E74C3C] font-normal">*</span>
              </label>
              <NumberInput
                value={cashSales}
                onChange={setCashSales}
                placeholder="금액 입력"
                error={showValidationErrors && !cashSales}
                id="input-cash-sales"
              />
            </div>

            {/* 카드 매출 (필수) */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500 block">
                카드 매출 <span className="text-[#E74C3C] font-normal">*</span>
              </label>
              <NumberInput
                value={cardSales}
                onChange={setCardSales}
                placeholder="금액 입력"
                error={showValidationErrors && !cardSales}
                id="input-card-sales"
              />
            </div>

            {/* 계좌이체 매출 (선택) */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-400 block">계좌이체 매출 (선택)</label>
              <NumberInput
                value={transferSales}
                onChange={setTransferSales}
                placeholder="금액 입력"
                id="input-transfer-sales"
              />
            </div>

            {/* 배달 매출 (선택) */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-400 block">배달 매출 (선택)</label>
              <NumberInput
                value={deliverySales}
                onChange={setDeliverySales}
                placeholder="금액 입력"
                id="input-delivery-sales"
              />
            </div>

            {/* 실시간 합계 출력 */}
            <div className="sm:col-span-2 mt-4 bg-gray-50 p-4 rounded-2xl flex items-center justify-between border border-gray-100">
              <span className="text-sm font-bold text-gray-500">실시간 총 매출 합산</span>
              <span className="font-mono text-2xl font-black text-[#1A3C6E]">
                {formatNumber(totalSales)} <span className="text-sm font-bold text-gray-400">원</span>
              </span>
            </div>
          </div>
        </section>

        {/* [섹션 2] 현금 지출 내역 */}
        <section 
          className="bg-white rounded-3xl shadow-xs border border-gray-150 overflow-hidden"
          id="cash-expenses-section"
        >
          <div className="p-5 sm:p-6 border-b border-gray-50 bg-zinc-50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-zinc-150 text-zinc-900 rounded-xl">
                <Landmark className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-zinc-800">현금 지출 내역</h3>
                <p className="text-[11px] text-gray-400 font-medium font-bold">금고 캐쉬로 처리한 현금 지출 목록입니다.</p>
              </div>
            </div>
            <button
              onClick={addCashExpense}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-black text-white text-xs font-semibold rounded-xl cursor-pointer transition-colors"
              id="btn-add-cash-expense"
            >
              <Plus className="w-3.5 h-3.5" /> 추가
            </button>
          </div>

          <div className="p-5 space-y-3" id="cash-expenses-list">
            {cashExpenses.map((exp, index) => (
              <div key={`cash-exp-${index}`} className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="지출 항목명 (예: 식자재 보충)"
                  value={exp.itemName}
                  onChange={(e) => updateCashExpense(index, "itemName", e.target.value)}
                  className="grow px-4 py-3 border border-gray-200 rounded-xl text-sm text-zinc-900 outline-hidden focus:border-zinc-800 min-w-0"
                />
                
                <div className="w-36 sm:w-48 shrink-0">
                  <NumberInput
                    value={exp.amount}
                    onChange={(val) => updateCashExpense(index, "amount", val)}
                    placeholder="0"
                    suffix="원"
                    className="py-1.5!"
                  />
                </div>

                <button
                  onClick={() => removeCashExpense(index)}
                  className="p-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors shrink-0 cursor-pointer"
                  title="삭제"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* [섹션 3] 카드 지출 내역 */}
        <section 
          className="bg-white rounded-3xl shadow-xs border border-gray-150 overflow-hidden"
          id="card-expenses-section"
        >
          <div className="p-5 sm:p-6 border-b border-gray-50 bg-zinc-50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-zinc-150 text-zinc-900 rounded-xl">
                <NotebookTabs className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-zinc-800">카드 지출 내역</h3>
                <p className="text-[11px] text-gray-400 font-medium font-bold">지점 법인카드로 긴급 지출한 목록입니다.</p>
              </div>
            </div>
            <button
              onClick={addCardExpense}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-black text-white text-xs font-semibold rounded-xl cursor-pointer transition-colors"
              id="btn-add-card-expense"
            >
              <Plus className="w-3.5 h-3.5" /> 추가
            </button>
          </div>

          <div className="p-5 space-y-3" id="card-expenses-list">
            {cardExpenses.map((exp, index) => (
              <div key={`card-exp-${index}`} className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="지출 항목명 (예: 철물점 비품 구입)"
                  value={exp.itemName}
                  onChange={(e) => updateCardExpense(index, "itemName", e.target.value)}
                  className="grow px-4 py-3 border border-gray-200 rounded-xl text-sm text-zinc-900 outline-hidden focus:border-zinc-850 min-w-0"
                />
                
                <div className="w-36 sm:w-48 shrink-0">
                  <NumberInput
                    value={exp.amount}
                    onChange={(val) => updateCardExpense(index, "amount", val)}
                    placeholder="0"
                    suffix="원"
                    className="py-1.5!"
                  />
                </div>

                <button
                  onClick={() => removeCardExpense(index)}
                  className="p-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors shrink-0 cursor-pointer"
                  title="삭제"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* [섹션 4] 인원 / 근무시간 기록 */}
        <section 
          className="bg-white rounded-3xl shadow-xs border border-gray-150 overflow-hidden"
          id="staff-section"
        >
          <div className="p-5 sm:p-6 border-b border-gray-50 bg-zinc-50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-zinc-150 text-zinc-900 rounded-xl">
                <UsersRound className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-zinc-800">인원 / 근무시간 기록</h3>
                <p className="text-[11px] text-gray-400 font-medium font-bold">당일 총 근무에 투입된 직원과 개별 근무시간을 기록합니다.</p>
              </div>
            </div>
            <button
              onClick={addStaff}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-black text-white text-xs font-semibold rounded-xl cursor-pointer transition-colors"
              id="btn-add-staff"
            >
              <Plus className="w-3.5 h-3.5" /> 직원 추가
            </button>
          </div>

          <div className="p-5 space-y-3" id="staff-list">
            {staff.length === 0 ? (
              <div className="text-center py-6 text-xs text-gray-400 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                추가된 인원 기록이 없습니다. 우측 상단의 [직원 추가] 링크를 이용해 입력하세요.
              </div>
            ) : (
              staff.map((st, index) => (
                <div key={`staff-${index}`} className="flex items-center gap-3">
                  <input
                    type="text"
                    placeholder="직원 성명 (예: 김철수)"
                    value={st.staffName}
                    onChange={(e) => updateStaff(index, "staffName", e.target.value)}
                    className="grow px-4 py-3 border border-gray-200 rounded-xl text-sm text-zinc-900 outline-hidden focus:border-zinc-800 min-w-0"
                  />
                  
                  <div className="w-36 sm:w-48 shrink-0 relative flex items-center">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="8.5"
                      value={st.workHours}
                      onChange={(e) => updateStaff(index, "workHours", e.target.value)}
                      className="w-full px-4 py-3 pr-10 text-right font-mono font-semibold text-sm border border-gray-200 rounded-xl focus:border-zinc-800 outline-hidden"
                    />
                    <span className="absolute right-4 font-sans text-xs text-gray-400 font-bold select-none pointer-events-none">시간</span>
                  </div>

                  <button
                    onClick={() => removeStaff(index)}
                    className="p-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors shrink-0 cursor-pointer"
                    title="삭제"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* [섹션 5] 특이사항 메모 */}
        <section 
          className="bg-white rounded-3xl shadow-xs border border-gray-150 overflow-hidden"
          id="memo-section"
        >
          <div className="p-5 sm:p-6 border-b border-gray-50 bg-zinc-50 flex items-center gap-3">
            <div className="p-2 bg-zinc-150 text-zinc-900 rounded-xl">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-zinc-800">특이사항 메모</h3>
              <p className="text-[11px] text-gray-400 font-medium font-bold">당일 특이 손님 응대 기록, 예약 소품 변경 등 본사에 보고할 주요 특이사항을 적어주세요.</p>
            </div>
          </div>

          <div className="p-5 space-y-2">
            <textarea
              maxLength={500}
              placeholder="예: 금일 저녁 7시 마스터 테이블 및 테라스 홀 대량 과음 고객 입실하여 특수 주류 발주 요청 예정, 주차장 램프 차단바 노후로 오작동 보고 등 (최대 500자)"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={4}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-zinc-900 outline-hidden focus:border-zinc-800 resize-none"
              id="input-memo"
            />
            <div className="flex justify-end text-xs text-gray-400 font-medium">
              <span className={memo.length >= 500 ? "text-red-500 font-bold" : ""}>
                {memo.length}
              </span> / 500 자
            </div>
          </div>
        </section>

      </main>

      {/* 3. 하단 고정 제어 바 */}
      <footer 
        className="fixed bottom-0 left-0 right-0 h-20 bg-white border-t border-gray-100 px-4 flex items-center justify-center shadow-lg z-30"
        id="input-sticky-footer"
      >
        <div className="w-full max-w-4xl flex items-center justify-between gap-4">
          <button
            onClick={() => {
              if (window.confirm("진작하던 마감 정산을 취소하고 게이트 화면으로 나갈까요?")) {
                navigate("/branch-confirm");
              }
            }}
            className="flex items-center justify-center gap-1.5 px-5 h-12 border border-gray-200 hover:bg-gray-50 text-xs font-bold text-gray-500 rounded-xl select-none cursor-pointer transition-colors"
            id="btn-input-cancel"
          >
            뒤로
          </button>
          
          <button
            onClick={openConfirmModal}
            className="grow h-12 bg-zinc-900 hover:bg-black text-white text-sm font-extrabold rounded-xl shadow-xs cursor-pointer select-none transition-colors animate-fade-in"
            id="btn-input-submit"
          >
            {isEditMode ? "정산 내용 최종 수정 완료하기" : "마감 정산 스프레드시트에 제출하기"}
          </button>
        </div>
      </footer>

      {/* 4. 공통 모달 및 토스트 알람 */}
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
        isOpen={isSubmitModalOpen}
        title={isEditMode ? "정산 정보 정정 제출" : "일일마감 정보 전송"}
        message={`기준일(${settleDate})로 가동된 UGD 정산 매출 정보를 정말 최종 제출하시겠습니까? 제출을 누르는 즉시 구글 스프레드시트에 기입됩니다.`}
        confirmText="최종 제출"
        cancelText="수정하기"
        type="info"
        onConfirm={handleFinalSubmit}
        onCancel={() => setIsSubmitModalOpen(false)}
      />

      {submitting && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-xs flex items-center justify-center z-50">
          <div className="bg-white px-8 py-6 rounded-2xl shadow-xl flex flex-col items-center gap-3">
            <LoadingSpinner size="lg" />
            <span className="text-xs text-gray-500 font-bold">원격 데이터베이스 저장 처리 중... 잠시만 기다려주세요.</span>
          </div>
        </div>
      )}
    </div>
  );
}
