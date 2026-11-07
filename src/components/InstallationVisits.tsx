"use client";
import { useCallback, useEffect, useState } from "react";
import { splitRequest, invalidateSplitCaches } from "@/lib/installation-splits/client";
import { initialSplit, needsHistoricalSplitReason, type SourceJob, type SavedSplit } from "@/lib/installation-splits/projection";
import { editVisits, type Visit } from "@/lib/installation-splits/model";

type Data = { job: SourceJob; split: SavedSplit | null };
const field = "w-full min-w-0 rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm";
const button = "rounded-lg bg-[#e85d04] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40";
function displayDate(date: string | null) {
  return date ? new Date(date + "T00:00:00Z").toLocaleDateString("en-NZ", {day:"numeric",month:"short",year:"numeric",timeZone:"Pacific/Auckland"}) : "Unscheduled";
}
export default function InstallationVisits({
  jobId, initialData, onLoaded, onSaved, onEditingChange,
}: {
  onEditingChange?: (editing:boolean) => void;
  jobId: string;
  initialData?: Data;
  onLoaded?: (split: SavedSplit | null) => void;
  onSaved?: (split: SavedSplit) => void;
}) {
  // Calendar data is already authorised and loaded. Only standalone job pages fetch here.
  const [seed] = useState(initialData);
  const [data, setData] = useState<Data | undefined>(seed);
  const [loading, setLoading] = useState(!seed);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Visit[]>([]);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const next = await splitRequest<Data>(`/api/jobs/${jobId}/installation-splits`);
      setData(next); onLoaded?.(next.split); setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load visits.");
    } finally { setLoading(false); }
  }, [jobId, onLoaded]);
  useEffect(() => {
    if (seed) onLoaded?.(seed.split);
    else void load();
  }, [seed, load, onLoaded]);
  useEffect(()=>{ onEditingChange?.(editing); return ()=>onEditingChange?.(false); },[editing,onEditingChange]);
  const split = data?.split;
  const isSplit = !!split && split.visits.length > 1;
  const historical = !!data && !split && needsHistoricalSplitReason(data.job);
  function begin() {
    if (!data) return;
    try {
      const base = split || initialSplit(data.job);
      const visits = split ? base.visits : [
        {...base.visits[0], percent:50, state:"completed" as const},
        {id:crypto.randomUUID(), date:null, percent:50, state:"planned" as const},
      ];
      setRows(visits.map(v=>({...v}))); setEditing(true); setError("");
    } catch(e) { setError(e instanceof Error ? e.message : "Could not split this job."); }
  }
  function update(index: number, patch: Partial<Visit>) {
    setRows(prev => prev.map((v,i) => {
      if (i === index) return {...v,...patch};
      // On first creation the return visit automatically gets the remainder.
      if (!split && rows.length === 2 && index === 0 && i === 1 && patch.percent !== undefined)
        return {...v,percent:Math.round((100-patch.percent)*100)/100};
      return v;
    }));
  }
  function addVisit() {
    setRows(prev => {
      const donor = prev.findLastIndex(v=>v.state==="planned" && v.percent>=0.02);
      const index = donor >= 0 ? donor : prev.findLastIndex(v=>v.percent>=0.02);
      if (index < 0) return prev;
      const percent = Math.floor(prev[index].percent*50)/100;
      return [...prev.map((v,i)=>i===index?{...v,percent:Math.round((v.percent-percent)*100)/100}:v),
        {id:crypto.randomUUID(),date:null,percent,state:"planned"}];
    });
  }
  const total = Math.round(rows.reduce((n,v)=>n+(Number.isFinite(v.percent)?v.percent:0),0)*100)/100;
  let invalid = "";
  if (editing && data) {
    try { editVisits(split || initialSplit(data.job), rows); }
    catch(e) { invalid = e instanceof Error ? e.message : "Check the visits."; }
  }
  async function save() {
    if (!data || invalid) return;
    setSaving(true); setError("");
    try {
      const result = await splitRequest<{split:SavedSplit}>(`/api/jobs/${jobId}/installation-splits`,{
        action:"edit",version:split?.version ?? 0,visits:rows,reason,
      });
      setData({...data,split:result.split}); setEditing(false);
      invalidateSplitCaches(); onLoaded?.(result.split); onSaved?.(result.split);
    } catch(e) { setError(e instanceof Error ? e.message : "Could not save visits."); }
    finally { setSaving(false); }
  }
  return <section id="installation-visits" className={isSplit || editing ? "rounded-xl border border-blue-200 bg-blue-50/40 p-3 space-y-3" : "space-y-2"}>
    {!editing && <>
      <div className="flex items-center justify-between gap-2">
        {split && <h2 className="text-sm font-semibold text-blue-900">Installation visits</h2>}
        <button type="button" className="text-sm font-semibold text-blue-800 underline disabled:opacity-40" disabled={loading || saving || !data} onClick={begin}>
          {split ? "Edit visits" : "Split job"}
        </button>
      </div>
      {split && <div className="space-y-1">
        {split.visits.map((v,i)=><div key={v.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>Visit {i+1} · {displayDate(v.date)}</span>
          <span><strong>{v.percent}%</strong> · {v.state==="completed"?"Done":"Planned"}</span>
        </div>)}
      </div>}
    </>}
    {editing && <form className="space-y-3" onSubmit={e=>{e.preventDefault();void save();}}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-blue-900">Edit installation visits</h2>
        <button type="button" disabled={saving} className="text-xs underline" onClick={()=>setEditing(false)}>Cancel</button>
      </div>
      <fieldset disabled={saving} className="space-y-3">
        {rows.map((v,i)=><div key={v.id} className="space-y-2 rounded-lg border border-blue-100 bg-white p-2">
          <div className="flex justify-between text-xs font-semibold">
            <span>Visit {i+1}</span>
            {rows.length>1 && <button type="button" aria-label={`Remove visit ${i+1}`} disabled={v.actualBags!==undefined} className="text-red-700 disabled:opacity-40" onClick={()=>setRows(prev=>{ const remaining=prev.filter(r=>r.id!==v.id); return remaining.length===1 ? [{...remaining[0],percent:100}] : remaining; })}>Remove</button>}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_80px_94px] gap-2">
            <label className="text-xs">Date<input aria-label={`Visit ${i+1} date`} className={field} type="date" required={v.state==="completed"} value={v.date||""} onChange={e=>update(i,{date:e.target.value||null})}/></label>
            <label className="text-xs">Share %<input aria-label={`Visit ${i+1} percentage`} className={field} type="number" min="0.01" max="100" step="0.01" required value={Number.isNaN(v.percent)?"":v.percent} onChange={e=>update(i,{percent:e.target.value===""?NaN:Number(e.target.value)})}/></label>
            <label className="text-xs">Status<select aria-label={`Visit ${i+1} status`} className={field} value={v.state} disabled={v.actualBags!==undefined} onChange={e=>update(i,{state:e.target.value as Visit["state"]})}><option value="planned">Planned</option><option value="completed">Done</option></select></label>
          </div>
          {v.state==="planned" && v.date && <button type="button" aria-label={`Clear visit ${i+1} date`} className="text-xs text-blue-800 underline" onClick={()=>update(i,{date:null})}>Clear date</button>}
        </div>)}
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <button type="button" className="font-semibold text-blue-800 underline" disabled={rows.length>=100} onClick={addVisit}>Add visit</button>
          <span className={total===100?"text-gray-600":"font-semibold text-red-700"}>Total: {total}%{total!==100?" — must equal 100%":""}</span>
        </div>
        {historical && <label className="block text-sm">Reason for historical split<input className={field} required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
        {invalid && total===100 && <p className="text-xs text-red-700">{invalid}</p>}
        <div className="pt-2"><button className={button} disabled={saving || !!invalid || (historical && !reason.trim())}>{saving?"Saving…":"Save visits"}</button></div>
      </fieldset>
    </form>}
    {error && <div className="space-y-1"><p role="alert" className="text-sm text-red-700">{error}</p><button type="button" disabled={loading||saving} className="text-xs underline" onClick={()=>void load()}>Reload visits</button></div>}
  </section>;
}
