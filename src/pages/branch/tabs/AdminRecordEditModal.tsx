// src/pages/branch/tabs/AdminRecordEditModal.tsx
// 기제출 자료 인라인 수정 모달(여러 탭·서브탭이 공유).
import { X } from "lucide-react";

export type AdminEditField = {
  key: string;
  label: string;
  value: string;
  type?: "text" | "number";
  /** 주면 드롭다운이 된다. 값이 목록에 없으면 호출한 쪽에서 목록에 넣어 줘야 한다(안 그러면 빈 칸으로 보인다). */
  options?: string[];
  /** 다른 칸에서 자동으로 계산되는 값. 고칠 수 없다. */
  readOnly?: boolean;
  /** 칸 아래 작은 설명. 몰라서 잘못 쓰기 쉬운 칸에만 붙인다. */
  hint?: string;
  /** 한 줄을 통째로 쓴다. 기본은 반 줄(두 칸씩 나란히). */
  span?: "full";
};

/**
 * 칸은 두 개씩 나란히 놓는다.
 *
 * 예전에는 한 칸이 한 줄을 통째로 쓰고 높이도 커서, 네 칸짜리 수정창이 화면을 꽉 채웠다.
 * 실제로 채우는 건 짧은 숫자·시각뿐이라 그만한 자리가 필요 없다.
 * 긴 글을 쓰는 칸만 span: "full"로 한 줄을 준다.
 */
export function AdminRecordEditModal({
  title,
  fields,
  onChange,
  onCancel,
  onSave,
  saveLabel = "저장"
}: {
  title: string;
  fields: AdminEditField[];
  onChange: (key: string, value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  saveLabel?: string;
}) {
  const inputClass = "w-full h-9 rounded-lg border border-gray-200 px-2.5 text-sm font-bold focus:outline-hidden focus:border-[#2E6DB4]";
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
          <h3 className="text-sm font-black text-gray-900">{title}</h3>
          <button onClick={onCancel} aria-label="닫기" className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 p-4">
          {fields.map((field) => (
            <label key={field.key} className={`block space-y-1 ${field.span === "full" || fields.length === 1 ? "col-span-2" : ""}`}>
              <span className="text-[11px] font-black text-gray-500">{field.label}</span>
              {field.options ? (
                <select
                  value={field.value}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  className={`${inputClass} bg-white`}
                >
                  {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              ) : (
                <input
                  type={field.type || "text"}
                  value={field.value}
                  readOnly={field.readOnly}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  // 읽기 전용 칸은 눌러도 고쳐지지 않는다 — 눌리는 것처럼 보이면 안 되니 회색으로 못 박는다.
                  className={`${inputClass} ${field.readOnly ? "bg-gray-100 text-gray-500 cursor-not-allowed" : ""}`}
                />
              )}
              {field.hint ? <span className="block text-[10px] font-bold text-gray-400 leading-tight">{field.hint}</span> : null}
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 bg-gray-50 px-4 py-2.5">
          <button onClick={onCancel} className="px-3.5 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-600">취소</button>
          <button onClick={onSave} className="px-4 py-1.5 rounded-lg bg-[#2E6DB4] text-white text-xs font-black">{saveLabel}</button>
        </div>
      </div>
    </div>
  );
}
