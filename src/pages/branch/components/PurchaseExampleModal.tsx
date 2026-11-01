// 매입집계 '작성예시' 창. 작성방법 말풍선은 켜둔 채 입력하는 용도라 표 위에 겹치므로, 예시는 별도 창으로 띄운다(사용자 지시 2026-11-01).
import { useEffect, useRef } from "react";
import { X } from "lucide-react";

// 문구는 지점 공지와 같게 유지한다. 금액 조합은 마감제출 차단 규칙(monthlyCloseWorkbook.ts)을 통과해야 한다.
const EXAMPLES: Array<{ title: string; situation?: string; values: string; memo?: string; note?: string }> = [
  {
    title: "일반 업체 (이체금액 = 이달 사용액)",
    values: "이체필요 720,000 / 이달사용액 720,000",
  },
  {
    title: "선입금 잔액과 추가 이체로 결제한 업체",
    situation: "전월잔액 700,000에 700,000을 더 이체해 1,400,000을 쓴 경우",
    values: "이체필요 700,000 / 이달사용액 1,400,000",
    memo: "전월잔액 700,000 / 이달선입금 700,000 / 이달잔액 0",
  },
  {
    title: "선입금을 넣고 일부만 사용한 업체 (월말에 이체할 금액 없음)",
    values: "이체필요 체크 해제 / 이달사용액 3,000,000",
    memo: "전월잔액 0 / 이달선입금 5,000,000 / 이달잔액 2,000,000",
  },
  {
    title: "이체는 하지만 이달 사용이 없는 업체",
    values: "이체필요 1,000,000 / 이달사용액 0",
    note: "빈칸으로 두지 말고 0을 적어주세요",
  },
  {
    title: "이미 결제를 마친 업체",
    values: "이체필요 체크 해제 / 이달사용액에 실제 사용 금액 입력",
  },
];

export function PurchaseExampleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // 닫으면 창을 연 버튼으로 포커스를 돌려준다.
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // 맨 위의 이 창만 닫는다 — 뒤에 켜 둔 작성방법 말풍선(GuideCallouts)도 Esc로 닫히므로 먼저 받아 끊는다.
        e.stopImmediatePropagation();
        onClose();
      }
      // 창 안에서 누를 수 있는 것은 닫기 버튼뿐이라, Tab이 뒤쪽 표로 빠져나가지 않게 막는다.
      if (e.key === "Tab") {
        e.preventDefault();
        closeButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      previousFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="매입집계 작성예시"
        className="flex w-full max-w-[560px] max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-zinc-900 bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-900 bg-[#F4F2CC] px-5 py-3">
          <h3 className="branch-band-title">매입집계 작성예시</h3>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="닫기" className="cursor-pointer text-zinc-900">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <p className="mb-3 text-[11px] font-bold text-zinc-900">
            이체필요 금액이 있어도 <span className="font-black text-[#B91C1C]">실제 이달사용액</span>을 꼭 적어주세요. 비워 두면 마감제출이 되지 않습니다.
          </p>
          <ol className="space-y-2.5">
            {EXAMPLES.map((example, index) => (
              <li key={example.title} className="rounded-lg border border-gray-200 px-3 py-2.5 text-[11px]">
                <p className="font-black text-zinc-900">{index + 1}. {example.title}</p>
                {example.situation && <p className="mt-1 text-zinc-600">{example.situation}</p>}
                <p className="mt-1 font-bold text-zinc-900">{example.values}</p>
                {example.memo && <p className="mt-1 text-zinc-600">비고: {example.memo}</p>}
                {example.note && <p className="mt-1 font-bold text-[#B91C1C]">{example.note}</p>}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[11px] text-zinc-600">금액을 잘못 적으면 손익계산서가 틀어질 수 있으니 한 번 더 확인해 주세요.</p>
        </div>
      </div>
    </div>
  );
}
