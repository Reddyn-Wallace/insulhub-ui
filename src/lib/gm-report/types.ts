import type { SourceJob, SavedSplit } from "../installation-splits/projection";
export type Settings = {
  wallBagCost: number;
  ceilingBagCost: number;
  weeklyWages: number;
  weeklyOpex: number;
  profitBudget: number;
  salesSqmBudget: number;
  councilAliases: string[];
};
export type Job = SourceJob & {
  updatedAt?: string | null;
  createdAt?: string | null;
  acceptedAt?: string | null;
  acceptedAtMissing?: boolean;
  quote?: SourceJob["quote"] & {
    status?: string | null;
    consentFee?: number | null;
    c_gst?: number | null;
    totalOverridden?: boolean | null;
    ceiling?: { SQM?: number | null; c_bagCount?: number | null } | null;
    extras?: { name?: string | null; price?: number | null }[] | null;
  };
};
export type Placeholder = {
  id: string;
  startsAt: string;
  endsAt?: string | null;
  title: string;
  note?: string | null;
  estimatedSqm?: number;
  estimatedValue?: number;
};
export type Pnl = {
  revenue: number;
  wallCogs: number;
  ceilingCogs: number;
  council: number;
  wages: number;
  opex: number;
  profit: number;
  budget: number;
  variance: number;
};
export type Row = {
  id: string;
  jobId: string;
  number: string;
  customer: string;
  date: string;
  percent: number;
  completed: boolean;
  wallSqm: number;
  ceilingSqm: number;
  sqm: number;
  revenue: number;
  grossRevenue?: number;
  calendarRevenue?: number;
  wallBags: number | null;
  ceilingBags: number | null;
  council: number;
  councilLines: { name: string; cents: number }[];
  basis: string;
  estimated: boolean;
  issues: string[];
};
export type Week = {
  week: string;
  rows: Row[];
  placeholders: Placeholder[];
  sqm: number;
  estimated: boolean;
  issues: string[];
  pnl: Pnl;
};
export type Snapshot = {
  version: 1;
  week: string;
  builtAt: string;
  retrospective: boolean;
  settings: Settings;
  leads: { date: string; count: number }[];
  current: Week;
  upcoming: Week[];
  pipeline: {
    sqm: number;
    days: number;
    weeks: number;
    unscheduledSqm: number;
  };
  sales: {
    jobs: {
      id: string;
      number: string;
      customer: string;
      date: string;
      wallSqm: number;
      ceilingSqm: number;
      sqm: number;
      revenue: number;
      revenueIssue?: string;
    }[];
    sqm: number;
    budget: number;
    variance: number;
    undatedJobs?: {
      id: string;
      number: string;
      customer: string;
      sqm: number;
    }[];
  };
  issues: string[];
};
export type Commentary = { profit: string; upcoming: string; pipeline: string };
export type Report = {
  week: string;
  revision: number;
  status: "draft" | "finalised";
  commentary: Commentary;
  snapshot: Snapshot | null;
  updatedAt: string;
  finalisedAt: string | null;
  refreshing: boolean;
};
export type Splits = Record<string, SavedSplit>;
