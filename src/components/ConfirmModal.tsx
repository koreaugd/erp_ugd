// src/components/ConfirmModal.tsx
import React from "react";
import { HelpCircle, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: "danger" | "info" | "warning";
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = "확인",
  cancelText = "취소",
  type = "info",
  onConfirm,
  onCancel
}: ConfirmModalProps) {
  if (!isOpen) return null;

  const colors = {
    info: {
      btn: "bg-[#2E6DB4] hover:bg-[#1A3C6E] text-white focus:ring-blue-100",
      accent: "text-[#2E6DB4]",
      icon: <HelpCircle className="w-8 h-8 text-[#2E6DB4]" />
    },
    warning: {
      btn: "bg-[#F39C12] hover:bg-[#d6840c] text-white focus:ring-orange-100",
      accent: "text-[#F39C12]",
      icon: <AlertTriangle className="w-8 h-8 text-[#F39C12]" />
    },
    danger: {
      btn: "bg-[#E74C3C] hover:bg-[#c0392b] text-white focus:ring-red-100",
      accent: "text-[#E74C3C]",
      icon: <AlertTriangle className="w-8 h-8 text-[#E74C3C]" />
    }
  };

  const current = colors[type];

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
      id="confirm-modal-overlay"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100"
        id="confirm-modal-container"
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-gray-50 rounded-xl shrink-0">
              {current.icon}
            </div>
            <div className="grow">
              <h3 className="text-lg font-bold text-[#2C3E50] tracking-tight" id="confirm-modal-title">
                {title}
              </h3>
              <p className="mt-2 text-sm text-gray-500 leading-relaxed" id="confirm-modal-message">
                {message}
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50/50 border-t border-gray-100 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-800 transition-colors bg-white border border-gray-200 rounded-xl hover:bg-gray-50 shrink-0 cursor-pointer"
            id="btn-confirm-cancel"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-semibold rounded-xl shadow-xs transition-colors focus:outline-hidden focus:ring-2 shrink-0 cursor-pointer ${current.btn}`}
            id="btn-confirm-ok"
          >
            {confirmText}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
