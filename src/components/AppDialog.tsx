"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

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

export const APP_DIALOG_WARNING_CONFIRM_COLORS = {
  background: "#c04e03",
  foreground: "#ffffff",
} as const;

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
    button: "bg-[#c04e03] text-white hover:bg-[#963d02]",
    ring: "focus:ring-[#c04e03] focus:ring-offset-2",
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
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const styles = toneStyles[tone];

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => (mode === "confirm" ? cancelButtonRef.current : confirmButtonRef.current)?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel?.();
        return;
      }
      if (event.key === "Tab") {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (!focusable?.length) return;
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [mode, onCancel, open]);

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
        ref={dialogRef}
        role={mode === "alert" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
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
              <h2 id={titleId} className="text-base font-semibold leading-6 text-gray-950">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-2 text-sm leading-6 text-gray-600">
                  {description}
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 bg-gray-50/80 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          {mode === "confirm" && (
            <button
              ref={cancelButtonRef}
              type="button"
              onClick={onCancel}
              className="min-h-11 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-4 focus:ring-gray-200"
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            className={`min-h-11 rounded-xl px-4 text-sm font-semibold shadow-sm focus:outline-none focus:ring-4 ${styles.button} ${styles.ring}`}
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
