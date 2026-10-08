export type FinanceJob = {
  id: string;
  number: string;
  quote: string;
  status: string;
  archived: boolean;
  name: string;
  invoiceNumbers: string[];
  stage?: string;
  contact?: string;
  detailVerified?: boolean;
  completionConflict?: boolean;
  installDate?: string;
  quoteCents?: number | null;
  agreedCents?: number | null;
  finalInvoiceChecked?: boolean;
  finalInvoiceNumber?: string | null;
  depositInvoiceNumber?: string | null;
  installmentInvoiceNumbers?: string[];
};
export type FinanceInvoice = {
  id: string;
  number: string;
  reference: string;
  contact: string;
  date: string;
  dueDate: string;
  status: string;
  currency: string;
  total: number;
  paid: number;
  due: number;
  credited: number;
  description: string;
};
export type FinancePayment = {
  id: string;
  invoiceId: string;
  amount: number;
  date: string;
  reference: string;
};
export type FinanceReceipt = {
  id: string;
  amount: number;
  date: string;
  description: string;
  reference: string;
};
export type CreditCardSnapshot =
  | {
      name: string;
      currentCents: number;
      owedCents: number;
      creditCents: number;
      balanceUpdatedAt: string;
      stale: boolean;
    }
  | { error: string };
export type PendingReceipt = {
  date: string;
  amount: number;
  description: string;
  updatedAt: string;
};
export type FinanceInputs = {
  trackedUninvoicedIds?: string[];
  pendingBank?: { receipts: PendingReceipt[] } | { error: string };
  creditCard?: CreditCardSnapshot;
  checkedAt: string;
  bank: {
    accountName: string;
    currentCents: number;
    balanceUpdatedAt: string;
    transactionsUpdatedAt: string | null;
    stale: boolean;
  };
  historyStart: string;
  historyEnd: string;
  jobs: FinanceJob[];
  invoices: FinanceInvoice[];
  payments: FinancePayment[];
  receipts: FinanceReceipt[];
  warnings: string[];
  bankChecked?: boolean;
  recentBankChecked?: boolean;
  excludedReceiptIds?: string[];
};
export type Allocation = {
  invoiceId: string;
  gross: number;
  fee: number;
  paymentId: string | null;
};
export type ReviewValue =
  | {
      kind: "classification";
      invoiceId: string;
      classification: "refunded" | "non-installation" | "earned";
      reason: string;
    }
  | { kind: "link"; invoiceId: string; jobId: string; reason: string }
  | {
      kind: "receipt";
      receiptId: string;
      allocations: Allocation[];
      nonCustomer: boolean;
      reason: string;
    }
  | {
      kind: "opening";
      invoiceId: string;
      amount: number;
      date: string;
      reason: string;
    }
  | { kind: "release"; invoiceId: string; amount: number; reason: string };
export type ReviewDecision = {
  key: string;
  revision: number;
  fingerprint: string;
  value: ReviewValue | null;
  updatedAt: string;
};
export type InvoiceLink = {
  jobId: string | null;
  method: string;
  candidates: string[];
};
export const isInstalled = (status: string) =>
  ["INSTALLED_AS_QUOTED", "INSTALLED_WITH_VARIATIONS_FROM_QUOTE"].includes(
    status,
  );
export const isJobInstalled = (job: FinanceJob) =>
  isInstalled(job.status) ||
  (job.stage === "COMPLETED" && job.status !== "INSTALL_NOT_FINISHED");
export const cents = (v: unknown) => {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    !Number.isSafeInteger(Math.round(v * 100))
  )
    throw Error("Invalid money value");
  return Math.round(v * 100);
};
