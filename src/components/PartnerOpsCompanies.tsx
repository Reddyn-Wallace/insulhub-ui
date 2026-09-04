"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { opsButtonClass, opsInputClass } from "@/lib/partner/operations-client";
import { settingsRequest as opsRequest, type PartnerCompanySummary } from "@/lib/partner/settings-client";
import { useAppDialog } from "@/components/AppDialog";

type PartnerUser = { id: string; name: string; email: string; disabledAt: string | null; invitationPending?: boolean; role?: "ADMIN" | "SALES" };
type AccessResult = { ok: true; delivery?: "SENT" | "DEMO" | "FAILED"; demoUrl?: string; message?: string };
const passwordValid = (password: string) => password.length >= 12 && password.length <= 128 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password) && /[\W_]/.test(password);
const passwordPolicy = "Use 12–128 characters with lowercase, uppercase, a number and a symbol.";

type CompanyDraft = PartnerCompanySummary & { creationKey?: string };
const blankCompany = (): CompanyDraft => ({ id: "", revision: 0, creationKey: crypto.randomUUID(), name: "" });

export default function PartnerOpsCompanies({ companies }: { companies: CompanyDraft[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<CompanyDraft | null>(null);
  const [formLocked, setFormLocked] = useState(false);
  const [filter, setFilter] = useState("active");
  const shown = companies.filter(company => filter === "all" || (filter === "archived" ? company.isActive === false : company.isActive !== false));
  return <section className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-[#1a3a4a]">Partner companies</h2><p className="mt-1 text-sm text-slate-600">Open a company to manage its details, users and InsulHub connection.</p></div>
      <button type="button" disabled={formLocked} onClick={() => setEditing(blankCompany())} className={opsButtonClass}>Add company</button></div>
    {editing ? <CompanyForm company={editing} close={() => setEditing(null)} onLock={setFormLocked} onSaved={company => router.push(`/jobs/settings/partners/${company.id}?created=1`)} /> : null}
    <label className="mt-5 flex items-center gap-3 text-sm font-semibold">Show companies<select disabled={formLocked} value={filter} onChange={event => setFilter(event.target.value)} className={opsInputClass + " max-w-48"}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All companies</option></select></label>
    <div className="mt-4 grid gap-3">{shown.map(company => <article key={company.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div><h3 className="font-bold text-[#1a3a4a]">{company.name}</h3>{company.isActive === false ? <p className="mt-1 text-sm text-slate-500">Archived</p> : null}</div>
      {formLocked ? <span className="text-sm text-slate-500">Finish saving first</span> : <Link href={`/jobs/settings/partners/${company.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-3 font-semibold" aria-label={`Manage ${company.name}`}>Manage company</Link>}
    </article>)}</div>
    {!shown.length ? <p className="mt-4 text-sm text-slate-600">No {filter === "all" ? "" : filter + " "}companies.</p> : null}
  </section>;
}

export function PartnerCompanyManagement({ initialCompany, created = false }: { initialCompany: CompanyDraft; created?: boolean }) {
  const [company, setCompany] = useState(initialCompany);
  const [locked, setLocked] = useState(false);
  const [tab, setTab] = useState<"details" | "users">(created ? "users" : "details");
  const [notice, setNotice] = useState(created ? "Company created. Add its first user and choose Admin if they will manage the team." : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useAppDialog();
  async function setActive() {
    if (locked || busy) return;
    const active = company.isActive === false;
    if (!await confirm({title: active ? "Unarchive company?" : "Archive company?", description: active ? "Employees will stay inactive. Reactivate them individually from Users." : "All employees will be deactivated and signed out. Existing jobs will be kept.", confirmLabel: active ? "Unarchive company" : "Archive company", tone: active ? "warning" : "danger"})) return;
    setBusy(true); setLocked(true); setError(""); setNotice("");
    try {
      await opsRequest(`/api/settings/partners/${company.id}`, "PATCH", {revision: company.revision, isActive: active});
      const result = await opsRequest<{companies: PartnerCompanySummary[]}>("/api/settings/partners");
      const updated = result.companies.find(item => item.id === company.id);
      if (!updated) throw new Error("Reload to check the company's status.");
      setCompany(updated); setLocked(false);
      setNotice(active ? "Company unarchived. Reactivate employees individually from Users." : "Company archived. All employees are inactive.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The change could not be confirmed. Reload before trying again."); }
    finally { setBusy(false); }
  }
  return <section className="min-w-0">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold text-[#1a3a4a]">{company.name}</h1><p className="mt-1 text-sm text-slate-600">{company.isActive === false ? "Archived · employees cannot sign in" : "Active partner company"}</p></div><button type="button" disabled={locked || busy} onClick={() => void setActive()} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 font-semibold">{busy ? "Updating…" : company.isActive === false ? "Unarchive company" : "Archive company"}</button></div>
    {notice ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p> : null}
    {error ? <div role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800"><p>{error}</p><button onClick={() => window.location.reload()} className="min-h-11 font-semibold underline">Reload latest details</button></div> : null}
    <div className="mt-5 flex gap-2" role="group" aria-label="Company management">{(["details", "users"] as const).map(value => <button key={value} type="button" aria-pressed={tab === value} disabled={locked} onClick={() => {setTab(value); setNotice("");}} className={`min-h-11 rounded-lg px-4 font-semibold ${tab === value ? "bg-[#1a3a4a] text-white" : "border border-slate-300 bg-white"}`}>{value === "details" ? "Company details" : "Users"}</button>)}</div>
    <div>{tab === "details" ? <>
      <CompanyForm company={company} close={() => setNotice("")} onLock={setLocked} onSaved={updated => {setCompany(updated);setLocked(false);setNotice("Company details saved.");}} disabled={locked}/>
      <LegacyConnection company={company} onLock={setLocked} onUpdated={setCompany} disabled={locked || company.isActive === false}/>
    </> : <Users key={`${company.id}:${company.isActive}`} companyId={company.id} companyName={company.name} onLock={setLocked} companyActive={company.isActive !== false} disabled={busy || Boolean(error)}/>}</div>{dialog}
  </section>;
}

function LegacyConnection({company,onLock,onUpdated,disabled}:{company:CompanyDraft;onLock:(locked:boolean)=>void;onUpdated:(company:CompanyDraft)=>void;disabled:boolean}){
  const [status,setStatus]=useState<{configured:boolean;updatedAt:string|null;quotePrefix:string|null}|null>(null);
  const [notice,setNotice]=useState("");const [locked,setLocked]=useState(false);const [email,setEmail]=useState("");const[password,setPassword]=useState("");const[loading,setLoading]=useState(true);const[busy,setBusy]=useState(false);const[error,setError]=useState("");
  useEffect(()=>{let active=true;void opsRequest<{status:{configured:boolean;updatedAt:string|null;quotePrefix:string|null}}>(`/api/settings/partners/${company.id}/connection`).then(result=>{if(active)setStatus(result.status);}).catch(caught=>{if(active)setError(caught instanceof Error?caught.message:"Connection status could not be loaded.");}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[company.id]);

  async function connect(event:FormEvent<HTMLFormElement>){
    event.preventDefault(); if(busy || disabled || locked)return;
    setBusy(true);onLock(true);setError("");setNotice("");
    let changed=false;
    try {
      await opsRequest(`/api/settings/partners/${company.id}/connection`,"POST",{revision:company.revision,email:email.trim().toLowerCase(),password});
      changed=true;setPassword("");
      const result=await opsRequest<{companies:PartnerCompanySummary[]}>("/api/settings/partners");
      const updated=result.companies.find(item=>item.id===company.id);
      if(!updated)throw new Error("Company details could not be refreshed. Reload before making another change.");
      const connection=await opsRequest<{status:NonNullable<typeof status>}>(`/api/settings/partners/${company.id}/connection`);
      setStatus(connection.status);onUpdated(updated);setNotice("InsulHub connection saved.");onLock(false);
    } catch(caught) {
      const code=typeof caught==="object"&&caught&&"status" in caught?Number(caught.status):undefined;
      setError(caught instanceof Error?caught.message:"The connection could not be saved.");
      if(changed||code===0||code===409||code===undefined)setLocked(true);else onLock(false);
    } finally {setBusy(false);}
  }
  return <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="font-bold text-[#1a3a4a]">InsulHub connection</h3>
    {loading?<p role="status" className="mt-2 text-sm text-slate-600">Checking connection…</p>:status?.configured?<p className="mt-2 text-sm text-emerald-800">Connected{status.quotePrefix?` · Quote prefix ${status.quotePrefix}`:""}</p>:<p className="mt-2 text-sm text-amber-800">Not connected</p>}
    <p className="mt-2 text-sm text-slate-600">Connect the InsulHub account for this company so submitted quotes go to the correct account. The password is checked once and is not stored.</p>
    {error?<p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>:null}
    {notice?<p role="status" className="mt-3 text-sm text-emerald-800">{notice}</p>:null}
    {locked?<button type="button" onClick={()=>window.location.reload()} className={opsButtonClass}>Reload latest details</button>:null}
    <form onSubmit={connect} className="mt-3 grid gap-3 sm:grid-cols-2" noValidate><label className="grid gap-1 text-sm font-semibold">InsulHub email<input type="email" autoComplete="username" required maxLength={254} disabled={busy || disabled || locked} value={email} onChange={event=>setEmail(event.target.value)} className={opsInputClass}/></label><label className="grid gap-1 text-sm font-semibold">InsulHub password<input type="password" autoComplete="current-password" required maxLength={256} disabled={busy || disabled || locked} value={password} onChange={event=>setPassword(event.target.value)} className={opsInputClass}/></label><div className="sm:col-span-2"><button disabled={busy||disabled||locked||loading||!email.trim()||!password} className={opsButtonClass}>{busy?"Connecting…":status?.configured?"Replace connection":"Connect InsulHub"}</button></div></form>
  </section>;
}

function CompanyForm({ company, close, onLock, onSaved, disabled = false }: { company: CompanyDraft; close: () => void; onLock: (locked: boolean) => void; onSaved: (company: CompanyDraft, created: boolean) => void; disabled?: boolean }) {
  const [name, setName] = useState(company.name);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const inFlight = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || disabled || inFlight.current) return;
    if (!name.trim() || name.trim().length > 160) { setError("Enter a company name."); return; }
    inFlight.current = true; onLock(true); setBusy(true); setError("");
    let persisted = false;
    try {
      const companyInput = { name: name.trim() };
      let id = company.id;
      if (id) await opsRequest(`/api/settings/partners/${encodeURIComponent(id)}`, "PUT", { revision: company.revision, ...companyInput });
      else id = (await opsRequest<{ company: { id: string } }>("/api/settings/partners", "POST", { creationKey: company.creationKey, ...companyInput })).company.id;
      persisted = true;
      // Refresh authoritative revisions before exposing either editor again.
      const result = await opsRequest<{ companies: PartnerCompanySummary[] }>("/api/settings/partners");
      const saved = result.companies.find(item => item.id === id);
      if (!saved) throw new Error("The company was saved, but its details could not be refreshed. Reload before making another change.");
      onSaved(saved, !company.id);
    } catch (caught) {
      const status = typeof caught === "object" && caught && "status" in caught ? Number(caught.status) : undefined;
      setError(caught instanceof Error ? caught.message : "Unable to save company.");
      if (persisted || status === 0 || status === 409 || status === undefined) setLocked(true); else onLock(false);
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-5 grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4" noValidate>
    <h2 className="font-bold text-[#1a3a4a]">{company.id ? "Edit company" : "Add company"}</h2>
    {!company.id ? <p className="text-sm text-slate-600">Start with the company name. Next, add users who can sign in to the partner portal.</p> : null}
    <div className="grid gap-3">
      <label className="grid gap-1 text-sm font-semibold">Company name<input autoFocus disabled={busy || locked || disabled} required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} className={opsInputClass} /></label>
    </div>
    {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}{locked ? " Reload required before another save." : ""}</p> : null}
    <div className="flex flex-wrap gap-2"><button disabled={busy || locked || disabled} className={opsButtonClass}>{busy ? "Saving…" : "Save company"}</button>{locked ? <button type="button" onClick={() => window.location.reload()} className="min-h-11 rounded-lg border border-slate-300 px-4 font-semibold">Reload latest details</button> : null}<button type="button" onClick={() => {setName(company.name); close();}} disabled={busy || locked || disabled} className="min-h-11 rounded-lg border border-slate-300 px-4 font-semibold">Cancel</button></div>
  </form>;
}

export function Users({ companyId, companyName, onLock, companyActive = true, partnerMode = false, currentUserId, disabled = false }: { companyId: string; companyName: string; onLock: (locked: boolean) => void; companyActive?: boolean; partnerMode?: boolean; currentUserId?: string; disabled?: boolean }) {
  const [role, setRole] = useState<"ADMIN" | "SALES">("SALES");
  const [users, setUsers] = useState<PartnerUser[]>([]);
  const [name, setName] = useState(""); const [email, setEmail] = useState("");
  const [mode, setMode] = useState<"invite" | "manual">("invite");
  const [initialPassword, setPassword] = useState("");
  const [passwordUser, setPasswordUser] = useState<PartnerUser | null>(null);
  const [overridePassword, setOverridePassword] = useState(""); const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [demoUrl, setDemoUrl] = useState("");
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [locked, setLocked] = useState(false);
  const inFlight = useRef(false);
  const { confirm, dialog } = useAppDialog();
  const base = partnerMode ? "/api/partner/users" : `/api/settings/partners/${encodeURIComponent(companyId)}/users`;
  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers((await opsRequest<{ users: PartnerUser[] }>(base)).users); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load partner users."); setLocked(true); throw caught; }
    finally { setLoading(false); }
  }, [base]);
  useEffect(() => { void load().catch(() => {}); }, [load]);
  useEffect(() => { onLock(busy || locked); }, [busy, locked, onLock]);
  function recordFailure(caught: unknown, fallback: string) {
    const status = typeof caught === "object" && caught && "status" in caught ? Number(caught.status) : undefined;
    setError(caught instanceof Error ? caught.message : fallback);
    if (status === 0 || status === 409 || status === undefined) setLocked(true);
  }
  function deliveryNotice(result: AccessResult, kind: "Invitation" | "Password reset") {
    if (result.delivery === "FAILED") { setError(result.message || `${kind} email sending could not be confirmed. Check the inbox before requesting another link.`); return; }
    if (result.delivery === "DEMO") {
      // Never render a cross-origin link even if a malformed response supplies one.
      try { const url = new URL(result.demoUrl ?? "", window.location.origin); if (url.origin === window.location.origin && url.pathname === "/partner/set-password" && url.hash.startsWith("#token=")) setDemoUrl(url.href); } catch { /* malformed demo URL is not shown */ }
      setNotice("Local demo email — no email sent."); return;
    }
    if (result.delivery === "SENT") { setNotice(`${kind} email sent.`); return; }
    throw new Error("The email result could not be confirmed. Reload before trying again.");
  }
  function begin() { inFlight.current = true; setBusy(true); setError(""); setNotice(""); setDemoUrl(""); }
  function finish() { inFlight.current = false; setBusy(false); }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (disabled || !companyActive || locked || inFlight.current) return;
    const userName = name.trim(), userEmail = email.trim().toLowerCase();
    if (!userName || userName.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail) || userEmail.length > 254) { setError("Enter a name and a valid email address."); return; }
    if (mode === "manual" && !passwordValid(initialPassword)) { setError(passwordPolicy); return; }
    begin();
    try {
      if (mode === "invite") {
        const result = await opsRequest<AccessResult>(`${base}/invite`, "POST", { name: userName, email: userEmail, role });
        deliveryNotice(result, "Invitation");
      } else {
        await opsRequest(base, "POST", { name: userName, email: userEmail, initialPassword, role });
        setNotice("User created. Share their password securely.");
      }
      setName(""); setEmail(""); setPassword(""); await load();
    } catch (caught) { recordFailure(caught, "Unable to create user."); }
    finally { finish(); }
  }
  async function access(user: PartnerUser, action: "INVITE" | "RESET") {
    if (disabled || !companyActive || locked || inFlight.current) return;
    begin();
    try {
      const result = await opsRequest<AccessResult>(`${base}/${encodeURIComponent(user.id)}/access`, "POST", { action });
      deliveryNotice(result, action === "INVITE" ? "Invitation" : "Password reset"); await load();
    } catch (caught) { recordFailure(caught, "Unable to send email."); }
    finally { finish(); }
  }
  async function override(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (disabled || !companyActive || !passwordUser || locked || inFlight.current) return;
    if (!passwordValid(overridePassword)) { setError(passwordPolicy); return; }
    if (confirmation !== overridePassword) { setError("Passwords do not match."); return; }
    inFlight.current = true;
    const approved = await confirm({ title: "Set this user's password?", description: `${passwordUser.email} will be signed out on all devices. Share the new password securely.`, confirmLabel: "Set password", tone: "warning" });
    if (!approved) { inFlight.current = false; return; }
    begin();
    try {
      await opsRequest(`${base}/${encodeURIComponent(passwordUser.id)}/access`, "POST", { action: "PASSWORD", password: overridePassword });
      setNotice("Password updated. Existing sessions have been signed out.");
      setOverridePassword(""); setConfirmation(""); setPasswordUser(null); await load();
    } catch (caught) { recordFailure(caught, "Unable to set password."); }
    finally { finish(); }
  }
  async function disable(user: PartnerUser) {
    if (disabled || !companyActive || locked || inFlight.current) return;
    inFlight.current = true;
    const approved = await confirm({ title: "Disable partner user?", description: `${user.email} will be signed out immediately.`, confirmLabel: "Disable user", tone: "danger" });
    if (!approved) { inFlight.current = false; return; }
    begin();
    try { await opsRequest(`${base}/${encodeURIComponent(user.id)}`, "DELETE"); setPasswordUser(null); setOverridePassword(""); setConfirmation(""); await load(); }
    catch (caught) { recordFailure(caught, "Unable to disable user."); }
    finally { finish(); }
  }
  async function updateUser(user: PartnerUser, change: {isActive?: boolean; role?: "ADMIN" | "SALES"}) {
    if (disabled || !companyActive || locked || inFlight.current) return;
    begin();
    try { await opsRequest(`${base}/${encodeURIComponent(user.id)}`, "PATCH", change); await load(); setNotice((change.role ? "User role updated." : "User reactivated.") + (user.invitationPending ? " Resend their invitation so they can finish setting up their account." : "")); }
    catch(caught) { recordFailure(caught, "Unable to update user."); }
    finally { finish(); }
  }
  return <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
    <h3 className="font-bold text-[#1a3a4a]">Users at {companyName}</h3><p className="mt-1 text-sm text-slate-600">Admins can manage users in this company. Sales users have the same job access.</p>
    {!companyActive ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Unarchive this company before adding or reactivating users.</p> : null}
    {error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}{locked ? " Reload before trying another change." : ""}</p> : null}
    {locked ? <button type="button" onClick={() => window.location.reload()} className="mt-3 min-h-11 rounded-lg border border-slate-300 px-3 font-semibold">Reload latest details</button> : null}
    {notice ? <p role="status" className="mt-3 text-sm text-[#1a3a4a]">{notice}</p> : null}
    {demoUrl ? <a href={demoUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-[#a84202] underline">Local demo email — open link (no email sent)</a> : null}
    {loading ? <p role="status" className="mt-3 text-sm text-slate-600">Loading users…</p> : null}
    <form onSubmit={create} className="mt-4 grid gap-3 sm:grid-cols-2" noValidate>
      <h4 className="font-semibold sm:col-span-2">Add user to {companyName}</h4>
      <label className="grid gap-1 text-sm font-semibold">User name<input autoComplete="name" required maxLength={160} disabled={disabled || !companyActive || busy || locked} value={name} onChange={(event) => setName(event.target.value)} className={opsInputClass} /></label>
      <label className="grid gap-1 text-sm font-semibold">User email<input autoComplete="email" required maxLength={254} disabled={disabled || !companyActive || busy || locked} type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={opsInputClass} /></label>
      <label className="grid gap-1 text-sm font-semibold sm:col-span-2">Role<select aria-label="Role" disabled={disabled || !companyActive || busy || locked} value={role} onChange={event => setRole(event.target.value as "ADMIN" | "SALES")} className={opsInputClass}><option value="SALES">Sales</option><option value="ADMIN">Admin</option></select></label>
      <label className="grid gap-1 text-sm font-semibold sm:col-span-2">Account setup<select disabled={disabled || !companyActive || busy || locked} value={mode} onChange={(event) => { setMode(event.target.value as "invite" | "manual"); setPassword(""); }} className={opsInputClass}><option value="invite">Send email invitation</option><option value="manual">Set password manually</option></select></label>
      {mode === "manual" ? <><label className="grid gap-1 text-sm font-semibold sm:col-span-2">Initial password<input autoComplete="new-password" required disabled={disabled || !companyActive || busy || locked} type="password" minLength={12} maxLength={128} value={initialPassword} onChange={(event) => setPassword(event.target.value)} className={opsInputClass} /></label><p className="text-xs text-slate-600 sm:col-span-2">{passwordPolicy} Share it securely.</p></> : null}
      <div><button disabled={disabled || !companyActive || busy || locked || loading} className={opsButtonClass}>{busy ? "Working…" : mode === "invite" ? "Send invitation" : "Create user"}</button></div>
    </form>
    <h4 className="mt-6 font-semibold text-[#1a3a4a]">Existing users</h4>
    {!loading && !users.length ? <p className="mt-2 text-sm text-slate-600">No users yet. Add the first user above.</p> : null}
    <ul className="mt-3 space-y-2">{users.map((user) => <li key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-3 text-sm">
      <div className="min-w-0 break-words"><p className="font-semibold">{user.name}</p><p>{user.email}</p>{user.invitationPending && !user.disabledAt ? <p className="mt-1 text-xs font-semibold text-amber-800">Invitation pending</p> : null}</div>
      <label className="grid gap-1 text-xs font-semibold">Role for {user.name}<select aria-label={`Role for ${user.name}`} disabled={disabled || !companyActive || locked || busy || user.id === currentUserId} value={user.role ?? "SALES"} onChange={event => void updateUser(user, {role: event.target.value as "ADMIN" | "SALES"})} className={opsInputClass}><option value="SALES">Sales</option><option value="ADMIN">Admin</option></select></label>
      {user.disabledAt ? <div className="flex items-center gap-2"><span className="font-semibold text-slate-500">Inactive</span><button type="button" disabled={disabled || !companyActive || locked || busy} onClick={() => void updateUser(user, {isActive: true})} className="min-h-11 rounded-lg border border-slate-300 px-3 font-semibold">Reactivate</button></div> : <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled || !companyActive || locked || busy} onClick={() => void access(user, user.invitationPending ? "INVITE" : "RESET")} className="min-h-11 rounded-lg border border-slate-300 px-3 font-semibold">{user.invitationPending ? "Resend invitation" : "Send password reset"}</button>
        <button type="button" disabled={disabled || !companyActive || locked || busy} onClick={() => { setPasswordUser(user); setOverridePassword(""); setConfirmation(""); setError(""); }} className="min-h-11 rounded-lg border border-slate-300 px-3 font-semibold">Set password</button>
        <button type="button" disabled={disabled || !companyActive || locked || busy || user.id === currentUserId} onClick={() => void disable(user)} className="min-h-11 rounded-lg border border-slate-300 px-3 font-semibold">Disable</button>
      </div>}
    </li>)}</ul>
    {passwordUser ? <form onSubmit={override} className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2" noValidate>
      <h4 className="font-semibold sm:col-span-2">Set password for {passwordUser.name}</h4>
      <label className="grid gap-1 text-sm font-semibold">New password<input autoComplete="new-password" disabled={disabled || !companyActive || busy || locked} type="password" minLength={12} maxLength={128} value={overridePassword} onChange={(event) => setOverridePassword(event.target.value)} className={opsInputClass} /></label>
      <label className="grid gap-1 text-sm font-semibold">Confirm password<input autoComplete="new-password" disabled={disabled || !companyActive || busy || locked} type="password" minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className={opsInputClass} /></label>
      <p className="text-xs text-slate-600 sm:col-span-2">{passwordPolicy} This signs out existing sessions.</p>
      <div className="flex gap-2 sm:col-span-2"><button disabled={disabled || !companyActive || busy || locked} className={opsButtonClass}>{busy ? "Saving…" : "Update password"}</button><button type="button" disabled={disabled || !companyActive || busy || locked} onClick={() => { setPasswordUser(null); setOverridePassword(""); setConfirmation(""); }} className="min-h-11 rounded-lg border border-slate-300 px-3 font-semibold">Cancel</button></div>
    </form> : null}

    {dialog}
  </section>;
}
