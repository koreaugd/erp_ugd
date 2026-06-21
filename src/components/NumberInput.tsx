// src/components/NumberInput.tsx
import React from "react";
import { formatNumber } from "../utils/formatNumber";

interface NumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  error?: boolean;
}

export default function NumberInput({
  value,
  onChange,
  suffix = "원",
  error = false,
  className = "",
  id,
  placeholder = "0",
  ...props
}: NumberInputProps) {
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    // 숫자 이외의 문자 제거 (빈 값 처리 포함)
    const cleanValue = rawValue.replace(/[^\d]/g, "");
    
    // 이끄는 0 제거 (단, "0" 단독 혹은 빈 상태가 아닐 때)
    let finalized = cleanValue;
    if (finalized.length > 1 && finalized.startsWith("0")) {
      finalized = finalized.replace(/^0+/, "");
    }

    onChange(finalized);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 숫자 입력 편의를 위해 소수점, 부호 키 등의 특수문자 입력을 사전에 걸러줌
    if (["-", "+", ".", "e", "E"].includes(e.key)) {
      e.preventDefault();
    }
  };

  // 포맷팅 처리한 문자열 생성
  const formattedValue = value ? formatNumber(value) : "";

  return (
    <div className="relative flex items-center rounded-xl bg-white shadow-xs">
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={formattedValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={`w-full px-4 py-3 text-right font-mono font-semibold text-lg text-[#2C3E50] border rounded-xl outline-hidden transition-all placeholder:text-gray-300 placeholder:font-sans placeholder:font-normal pr-10 ${
          error
            ? "border-[#E74C3C] bg-red-50/25 focus:border-[#E74C3C] focus:ring-1 focus:ring-[#E74C3C]"
            : "border-gray-200 focus:border-[#2E6DB4] focus:ring-1 focus:ring-[#2E6DB4]"
        } ${className}`}
        id={id}
        {...props}
      />
      {suffix && (
        <span className="absolute right-4 font-sans text-sm font-semibold text-gray-400 select-none pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  );
}
