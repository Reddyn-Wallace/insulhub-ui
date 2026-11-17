import { redirect } from "next/navigation";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ week?: string | string[] }>;
}) {
  const { week } = await searchParams;
  redirect(
    `/jobs/settings?section=weekly-gm${typeof week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(week) ? `&week=${week}` : ""}`,
  );
}
