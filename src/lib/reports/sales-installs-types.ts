export type Person = {
  _id?: string;
  firstname?: string | null;
  lastname?: string | null;
};

export type ContactDetails = {
  name?: string | null;
  streetAddress?: string | null;
  suburb?: string | null;
  city?: string | null;
  postCode?: string | null;
};

export type ReportJob = {
  _id: string;
  jobNumber?: number | null;
  stage?: string | null;
  notes?: string | null;
  createdAt?: string | null;
  archivedAt?: string | null;
  acceptedAt?: string | null;
  lead?: {
    allocatedTo?: Person | null;
  } | null;
  quote?: {
    status?: string | null;
    c_total?: number | null;
    wall?: { SQM?: number | null } | null;
    ceiling?: { SQM?: number | null } | null;
  } | null;
  installation?: {
    installDate?: string | null;
    installStatus?: string | null;
  } | null;
  client?: {
    contactDetails?: ContactDetails | null;
  } | null;
};

export type ReportResult = {
  leads: ReportJob[];
  sales: ReportJob[];
  installs: ReportJob[];
  upcoming: {
    unscheduled: ReportJob[];
    pencilled: ReportJob[];
    confirmed: ReportJob[];
  };
};

export type ReportResponse = {
  report: ReportResult;
  cache: {
    status: "hit" | "miss" | "refresh";
    builtAt: string;
    expiresAt: string;
  };
};

export function todayNzKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDays(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function defaultFromDate(today: string): string {
  const day = new Date(`${today}T00:00:00`).getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(today, mondayOffset);
}

export function weekRangeFor(key: string): { fromDate: string; toDate: string } {
  const fromDate = defaultFromDate(key);
  return { fromDate, toDate: addDays(fromDate, 6) };
}

export function toNzDateKey(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
