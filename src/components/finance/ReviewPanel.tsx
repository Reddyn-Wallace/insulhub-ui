"use client";
import { useState } from "react";
import { quoteReference } from "@/lib/finance/linking";
import type { DashboardResponse } from "@/lib/finance/dashboard";
import type { Allocation, ReviewValue } from "@/lib/finance/model";
import { money, financeApi, inputClass, buttonClass } from "./format";
export type ReviewTarget = {
  kind: "receipt" | "link" | "opening" | "release" | "classification";
  id: string;
};
const toCents = (s: string) => {
  if (!/^-?\d+(\.\d{1,2})?$/.test(s.trim()))
    throw Error("Use an amount with at most two decimal places.");
  return Math.round(Number(s) * 100);
};
export function ReviewPanel({
  data,
  target,
  onClose,
  onSaved,
}: {
  data: DashboardResponse;
  target: ReviewTarget;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const receipt = data.matches.find((m) => m.receipt.id === target.id)?.receipt;
  const invoice = data.rows.find((i) => i.id === target.id);
  const key = target.kind + ":" + target.id,
    existing = data.decisions.find((d) => d.key === key);
  const [classification, setClassification] = useState<
    "refunded" | "non-installation" | "earned"
  >(invoice?.classification?.classification || "refunded");
  const [reason, setReason] = useState(""),
    [jobSearch, setJobSearch] = useState(
      quoteReference(invoice?.reference || ""),
    ),
    [jobId, setJobId] = useState(""),
    [nonCustomer, setNonCustomer] = useState(false),
    [amount, setAmount] = useState(""),
    [date, setDate] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [parts, setParts] = useState([
    {
      invoiceId: "",
      gross: receipt ? (receipt.amount / 100).toFixed(2) : "",
      fee: "0.00",
      paymentId: "",
    },
  ]);
  const jobs = data.jobs
    .filter((j) =>
      (j.quote + " " + j.number + " " + j.name)
        .toLowerCase()
        .includes(jobSearch.toLowerCase()),
    )
    .slice(0, 40);
  async function save(undo = false) {
    setBusy(true);
    setError("");
    try {
      let value: ReviewValue | null = null;
      if (!undo) {
        if (target.kind === "receipt") {
          value = {
            kind: "receipt",
            receiptId: target.id,
            nonCustomer,
            reason,
            allocations: nonCustomer
              ? []
              : parts.map(
                  (p) =>
                    ({
                      invoiceId: p.invoiceId,
                      gross: toCents(p.gross),
                      fee: toCents(p.fee),
                      paymentId: p.paymentId || null,
                    }) as Allocation,
                ),
          };
        } else if (target.kind === "classification") {
          value = {
            kind: "classification",
            invoiceId: target.id,
            classification,
            reason,
          };
        } else if (target.kind === "link") {
          value = { kind: "link", invoiceId: target.id, jobId, reason };
        } else if (target.kind === "opening") {
          value = {
            kind: "opening",
            invoiceId: target.id,
            amount: toCents(amount),
            date,
            reason,
          };
        } else {
          value = {
            kind: "release",
            invoiceId: target.id,
            amount: toCents(amount),
            reason,
          };
        }
      }
      await financeApi("review", {
        key,
        revision: existing?.revision || 0,
        fingerprint: data.fingerprints[key],
        value,
        targetFingerprints: Object.fromEntries(
          (value?.kind === "receipt"
            ? value.allocations.map((a) => "link:" + a.invoiceId)
            : value?.kind === "link"
              ? ["job:" + value.jobId]
              : []
          ).map((key) => [key, data.fingerprints[key]]),
        ),
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/40"
      onClick={() => !busy && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Review financial evidence"
        className="h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-2xl sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">
              Owner review
            </p>
            <h2 className="mt-2 text-2xl font-semibold">
              {target.kind === "receipt"
                ? "Classify bank transaction"
                : target.kind === "classification"
                  ? "Classify closed invoice"
                  : target.kind === "link"
                    ? "Confirm invoice’s job"
                    : target.kind === "opening"
                      ? "Confirm historical advance"
                      : "Release retained advance"}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Close review"
            className="rounded-lg p-2 text-xl"
          >
            ×
          </button>
        </div>
        {receipt && (
          <div className="my-6 rounded-2xl bg-slate-50 p-5">
            <div className="text-2xl font-semibold tabular-nums">
              {money(receipt.amount)}
            </div>
            <p className="mt-2 text-sm">
              {receipt.date} · {receipt.description}
            </p>
            <p className="mt-2 break-all text-xs text-slate-500">
              {receipt.reference}
            </p>
          </div>
        )}
        {invoice && (
          <div className="my-6 rounded-2xl bg-slate-50 p-5">
            <strong>{invoice.number}</strong>
            <p className="mt-1 text-sm">
              {invoice.contact} · {invoice.reference || "No reference"}
            </p>
            <p className="mt-2 text-sm">
              Total {money(invoice.total)} · Xero paid {money(invoice.paid)} ·
              Due {money(invoice.due)}
            </p>
          </div>
        )}
        {target.kind === "classification" && (
          <div className="space-y-3">
            <label className="block text-sm font-medium">
              Classification
              <select
                className={inputClass + " mt-1"}
                value={classification}
                onChange={(e) =>
                  setClassification(e.target.value as typeof classification)
                }
              >
                <option value="earned">
                  Paid work completed — CRM job remains open
                </option>
                <option value="refunded">Cancelled job — fully refunded</option>
                <option value="non-installation">
                  Not related to installation work
                </option>
              </select>
            </label>
            <p className="text-sm text-slate-600">
              Owner confirmation only. Removes this closed invoice from deposits
              and job-linking checks; keeps its Xero amounts and this decision
              in the audit history. This does not record a refund in Xero or
              move money. Undo this decision if the job goes ahead or a refund
              remains owing.
            </p>
            {existing?.value && (
              <p className="text-sm">Saved reason: {existing.value.reason}</p>
            )}
          </div>
        )}
        {target.kind === "link" && (
          <div className="space-y-3">
            <label className="block text-sm font-medium">
              Find CRM job
              <input
                className={inputClass + " mt-1"}
                value={jobSearch}
                onChange={(e) => {
                  setJobSearch(e.target.value);
                  setJobId("");
                }}
                placeholder="Quote, job number or address"
              />
            </label>
            <label className="block text-sm font-medium">
              Confirmed job
              <select
                className={inputClass + " mt-1"}
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
              >
                <option value="">Select the correct job</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.quote || j.number} · {j.name}
                    {j.archived ? " · archived" : ""}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-slate-500">
              This links records for this dashboard only. It does not change
              Xero or the CRM.
            </p>
          </div>
        )}
        {target.kind === "receipt" && (
          <div className="space-y-4">
            <label className="flex gap-3 rounded-xl border border-slate-200 p-4 text-sm">
              <input
                type="checkbox"
                checked={nonCustomer}
                onChange={(e) => setNonCustomer(e.target.checked)}
              />
              Not a customer payment or refund (for example, a transfer or owner
              contribution)
            </label>
            {!nonCustomer && (
              <>
                {parts.map((p, index) => (
                  <div
                    key={index}
                    className="space-y-3 rounded-xl border border-slate-200 p-4"
                  >
                    <label className="block text-sm font-medium">
                      Invoice {index + 1}
                      <select
                        className={inputClass + " mt-1"}
                        value={p.invoiceId}
                        onChange={(e) =>
                          setParts(
                            parts.map((x, n) =>
                              n === index
                                ? {
                                    ...x,
                                    invoiceId: e.target.value,
                                    paymentId: "",
                                  }
                                : x,
                            ),
                          )
                        }
                      >
                        <option value="">Select invoice</option>
                        {data.rows
                          .filter((i) => i.currency === "NZD")
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.number} · {i.reference} · {i.contact}
                            </option>
                          ))}
                      </select>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-sm">
                        Customer amount (NZD)
                        <input
                          className={inputClass + " mt-1"}
                          inputMode="decimal"
                          value={p.gross}
                          onChange={(e) =>
                            setParts(
                              parts.map((x, n) =>
                                n === index
                                  ? { ...x, gross: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="text-sm">
                        Evidenced fee (NZD)
                        <input
                          className={inputClass + " mt-1"}
                          inputMode="decimal"
                          value={p.fee}
                          onChange={(e) =>
                            setParts(
                              parts.map((x, n) =>
                                n === index ? { ...x, fee: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                    <label className="block text-sm">
                      Corresponding Xero payment
                      <select
                        className={inputClass + " mt-1"}
                        value={p.paymentId}
                        onChange={(e) =>
                          setParts(
                            parts.map((x, n) =>
                              n === index
                                ? { ...x, paymentId: e.target.value }
                                : x,
                            ),
                          )
                        }
                      >
                        <option value="">
                          Not identified / let exact matching check
                        </option>
                        {data.payments
                          .filter((x) => x.invoiceId === p.invoiceId)
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.date} · {money(x.amount)} · {x.reference}
                            </option>
                          ))}
                      </select>
                    </label>
                    {parts.length > 1 && (
                      <button
                        className="text-sm text-rose-700"
                        onClick={() =>
                          setParts(parts.filter((_, n) => n !== index))
                        }
                      >
                        Remove split
                      </button>
                    )}
                  </div>
                ))}
                <button
                  className="text-sm font-semibold text-teal-700"
                  onClick={() =>
                    setParts([
                      ...parts,
                      { invoiceId: "", gross: "", fee: "0.00", paymentId: "" },
                    ])
                  }
                >
                  + Split across another invoice
                </button>
                <p className="text-xs text-slate-500">
                  Customer amounts less fees must equal the bank transaction.
                  Use negative amounts for settled refunds. This records
                  evidence only; no money is moved.
                </p>
              </>
            )}
          </div>
        )}
        {(target.kind === "opening" || target.kind === "release") && (
          <div className="space-y-3">
            <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
              {target.kind === "opening"
                ? "Confirm only money you can evidence as received before the loaded bank-history window. Do not include receipts already matched in this dashboard."
                : "Use only for a customer advance you have agreed to retain. Refunds must be allocated to the actual outgoing bank transaction."}
            </p>
            <label className="block text-sm font-medium">
              Amount (NZD)
              <input
                className={inputClass + " mt-1"}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            {target.kind === "opening" && (
              <label className="block text-sm font-medium">
                Original settlement date
                <input
                  className={inputClass + " mt-1"}
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
            )}
          </div>
        )}
        <label className="mt-6 block text-sm font-medium">
          Evidence / reason
          <textarea
            className={inputClass + " mt-2 min-h-24"}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What confirms this allocation or classification?"
            maxLength={1000}
          />
        </label>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-800"
          >
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            className={buttonClass}
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "Checking evidence and saving…" : "Confirm and save"}
          </button>
          <button
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          {existing?.value && (
            <button
              className="px-2 text-sm text-rose-700"
              disabled={busy}
              onClick={() => void save(true)}
            >
              Undo saved decision
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
