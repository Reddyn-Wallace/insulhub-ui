interface CompletionJob {
  stage: string;
  archivedAt?: string | null;
  installation?: { installStatus?: string | null } | null;
}

export function isAwaitingCompletion(job: CompletionJob): boolean {
  return !job.archivedAt && job.stage !== "COMPLETED" &&
    ["INSTALLED_AS_QUOTED", "INSTALLED_WITH_VARIATIONS_FROM_QUOTE"].includes(
      (job.installation?.installStatus || "").trim().toUpperCase(),
    );
}

export function isActiveJob(job: CompletionJob): boolean {
  return !job.archivedAt && job.stage !== "COMPLETED" &&
    ["SCHEDULED", "INSTALLATION", "INVOICE"].includes(job.stage);
}

