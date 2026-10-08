export const money = (cents: number) =>
  new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(
    cents / 100,
  );
export const when = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("en-NZ", {
        timeZone: "Pacific/Auckland",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Unavailable";
export async function financeApi(path: string, body?: unknown) {
  const token = localStorage.getItem("token");
  if (!token) throw Error("Sign in to Insulhub to view your cash dashboard.");
  const r = await fetch("/api/finance/" + path, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: {
      "x-access-token": token,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let d;
  try {
    d = await r.json();
  } catch {
    throw Error("The source check did not finish. Please try again.");
  }
  if (!r.ok) throw Error(d.error || "Finance request failed.");
  return d;
}
export const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100";
export const buttonClass =
  "rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50";
