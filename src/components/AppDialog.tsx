"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type DialogTone = "default" | "danger" | "warning";
type DialogMode = "confirm" | "alert";

interface AppDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
  mode?: DialogMode;
  onConfirm: () => void;
  onCancel?: () => void;
}

interface DialogOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
}

const toneStyles: Record<DialogTone, { icon: string; button: string; ring: string }> = {
  default: {
    icon: "bg-[#1a3a4a]/10 text-[#1a3a4a]",
    button: "bg-[#1a3a4a] text-white hover:bg-[#122b37]",
    ring: "focus:ring-[#1a3a4a]/25",
  },
  danger: {
    icon: "bg-red-50 text-red-700",
    button: "bg-red-600 text-white hover:bg-red-700",
    ring: "focus:ring-red-500/25",
  },
  warning: {
    icon: "bg-amber-50 text-amber-700",
    button: "bg-amber-600 text-white hover:bg-amber-700",
    ring: "focus:ring-amber-500/25",
  },
};

export function AppDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  mode = "confirm",
  onConfirm,
  onCancel,
}: AppDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const styles = toneStyles[tone];

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => confirmButtonRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onCancel, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-6" role="presentation">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 cursor-default bg-slate-950/45 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div
        role={mode === "alert" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        aria-describedby={description ? "app-dialog-description" : undefined}
        className="relative w-full max-w-[440px] overflow-hidden rounded-2xl border border-white/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]"
      >
        <div className="p-5 sm:p-6">
          <div className="flex gap-4">
            <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${styles.icon}`}>
              {tone === "danger" ? (
                <span className="text-xl font-bold leading-none">!</span>
              ) : (
                <span className="text-lg font-bold leading-none">?</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="app-dialog-title" className="text-base font-semibold leading-6 text-gray-950">
                {title}
              </h2>
              {description && (
                <p id="app-dialog-description" className="mt-2 text-sm leading-6 text-gray-600">
                  {description}
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 bg-gray-50/80 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          {mode === "confirm" && (
            <button
              type="button"
              onClick={onCancel}
              className="h-10 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-4 focus:ring-gray-200"
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            className={`h-10 rounded-xl px-4 text-sm font-semibold shadow-sm focus:outline-none focus:ring-4 ${styles.button} ${styles.ring}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useAppDialog() {
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const [options, setOptions] = useState<(DialogOptions & { mode: DialogMode }) | null>(null);

  const close = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback((dialogOptions: DialogOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOptions({ mode: "confirm", ...dialogOptions });
    });
  }, []);

  const alert = useCallback((dialogOptions: DialogOptions) => {
    return new Promise<void>((resolve) => {
      resolverRef.current = () => resolve();
      setOptions({
        mode: "alert",
        confirmLabel: "OK",
        ...dialogOptions,
      });
    });
  }, []);

  const dialog = (
    <AppDialog
      open={Boolean(options)}
      title={options?.title || ""}
      description={options?.description}
      confirmLabel={options?.confirmLabel}
      cancelLabel={options?.cancelLabel}
      tone={options?.tone}
      mode={options?.mode}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );

  return { alert, confirm, dialog };
}
