// src/components/LoadingSpinner.tsx
import React from "react";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  light?: boolean;
}

export default function LoadingSpinner({ size = "md", light = false }: SpinnerProps) {
  const sizes = {
    sm: "w-4 h-4 border-2",
    md: "w-6 h-6 border-2",
    lg: "w-10 h-10 border-3"
  };

  const borderClass = light 
    ? "border-white/30 border-t-white" 
    : "border-[#D6E4F0] border-t-[#2E6DB4]";

  return (
    <div 
      className={`inline-block animate-spin rounded-full ${sizes[size]} ${borderClass}`} 
      role="status"
      id="loading-spinner"
    >
      <span className="sr-only">로딩중...</span>
    </div>
  );
}
