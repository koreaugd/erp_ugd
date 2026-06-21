// src/components/ToastMessage.tsx
import React, { useEffect } from "react";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastProps {
  id?: string;
  message: string;
  type?: ToastType;
  onClose: () => void;
}

export default function ToastMessage({ message, type = "success", onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 3500);
    return () => clearTimeout(timer);
  }, [onClose]);

  const themes = {
    success: {
      bg: "bg-emerald-50 border-emerald-200",
      text: "text-emerald-800",
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
    },
    error: {
      bg: "bg-rose-50 border-rose-200",
      text: "text-rose-800",
      icon: <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
    },
    warning: {
      bg: "bg-amber-50 border-amber-200",
      text: "text-amber-800",
      icon: <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
    },
    info: {
      bg: "bg-blue-50 border-blue-200",
      text: "text-blue-800",
      icon: <Info className="w-5 h-5 text-blue-600 shrink-0" />
    }
  };

  const current = themes[type] || themes.info;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -15, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 border rounded-xl shadow-lg w-full max-w-sm ${current.bg}`}
      id="toast-notification"
    >
      {current.icon}
      <span className={`text-sm font-medium grow ${current.text}`}>{message}</span>
      <button
        onClick={onClose}
        className="text-gray-400 hover:text-gray-600 transition-colors cursor-pointer p-0.5 rounded-full hover:bg-black/5"
        aria-label="닫기"
        id="btn-toast-close"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}
