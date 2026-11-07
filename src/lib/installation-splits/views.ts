import { projectVisits, type SourceJob, type SavedSplit, type VisitLabel } from "./projection";
export type VisitJob<T extends SourceJob> = T & {
  splitSource: T;
  installationSplit: SavedSplit | null;
  splitVisit?: VisitLabel;
};
export function calendarVisits<T extends SourceJob>(job: T, split: SavedSplit | null): VisitJob<T>[] {
  return (split ? projectVisits(job,split) : [job]).map(v=>({
    ...v,splitSource:job,installationSplit:split,
  }));
}
export function replaceCalendarJob<T extends SourceJob>(jobs:T[], source:T, split:SavedSplit): T[] {
  return [...jobs.filter(j=>j._id!==source._id),...calendarVisits(source,split)];
}
export function queueVisits<T extends SourceJob>(jobs:T[], splits:Record<string,SavedSplit>): VisitJob<T>[] {
  return jobs.flatMap(job=>{
    if (job.archivedAt) return [];
    const split=splits[job._id];
    const visits=calendarVisits(job,split || null);
    const pending=visits.filter(v=>v.splitVisit?.state==="planned");
    if (pending.length) return pending;
    if (!["SCHEDULED","INSTALLATION","INVOICE"].includes(job.stage || "")) return [];
    // Keep completed active jobs in their existing paperwork workflow, once per job.
    return [{...job,splitSource:job,installationSplit:split || null}];
  });
}

export function searchVisits<T extends SourceJob>(jobs:T[],splits:Record<string,SavedSplit>): VisitJob<T>[] {
  return jobs.flatMap(job=>{
    const split=splits[job._id];
    const pending=split ? calendarVisits(job,split).filter(v=>v.splitVisit?.state==="planned") : [];
    return pending.length ? pending : [{...job,splitSource:job,installationSplit:split || null}];
  });
}
export function calendarSource<T extends SourceJob>(job:T & {
  splitSource?:T;installationSplit?:SavedSplit|null;splitVisit?:VisitLabel;
}):T {
  const source=job.installationSplit && job.splitSource ? job.splitSource : job;
  // Keep source snapshots flat and never seed an ordinary job with a stale original date.
  const copy={...source} as T & {splitSource?:T;installationSplit?:SavedSplit|null;splitVisit?:VisitLabel};
  delete copy.splitSource; delete copy.installationSplit; delete copy.splitVisit;
  return copy;
}
