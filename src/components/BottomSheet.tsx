"use client";
import { useEffect } from "react";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export default function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  // Lock body scroll when open
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        onClick={onClose}
      />
      {/* Sheet */}
      <div className="relative bg-white rounded-t-3xl max-h-[92vh] flex flex-col shadow-2xl border border-gray-100">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-11 h-1.5 bg-gray-300 rounded-full" />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 sticky top-0 bg-white/95 backdrop-blur">
          <h2 className="text-[15px] font-bold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none w-8 h-8 flex items-center justify-center"
          >
            ×
          </button>
        </div>
        {/* Content */}
        <div className="overflow-y-auto flex-1 px-4 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
