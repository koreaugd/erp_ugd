// src/pages/branch/tabs/AdminRecordEditModal.tsx
// 관리자 기제출 자료 인라인 수정 모달(여러 탭·서브탭이 공유).
// BranchConfirmPage에서 분리 — 동작 변경 없음(코드 이동만).
import { X } from "lucide-react";

export type AdminEditField = { key: string; label: string; value: string; type?: "text" | "number" };

export function AdminRecordEditModal({
  title,
  fields,
  onChange,
  onCancel,
  onSave
}: {
  title: string;
  fields: AdminEditField[];
  onChange: (key: string, value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-sm font-black text-gray-900">{title}</h3>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {fields.map((field) => (
            <label key={field.key} className="block space-y-1.5">
              <span className="text-xs font-black text-gray-500">{field.label}</span>
              <input
                type={field.type || "text"}
                value={field.value}
                onChange={(e) => onChange(field.key, e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold focus:outline-hidden focus:border-[#2E6DB4]"
              />
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 bg-gray-50 px-5 py-4">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl bg-white border border-gray-200 text-xs font-bold text-gray-600">취소</button>
          <button onClick={onSave} className="px-5 py-2 rounded-xl bg-[#2E6DB4] text-white text-xs font-black">저장</button>
        </div>
      </div>
    </div>
  );
}
