export type Visit = {
  id: string;
  date: string | null;
  percent: number;
  state: 'planned' | 'completed';
  actualBags?: number;
};
export type SplitJob = {
  id: string;
  number: string;
  customer: string;
  area: number;
  value: number;
  budgetBags: number | null;
  visits: Visit[];
  checksheet: { complete: boolean; actualBags: number | null };
  history: string[];
};
export type UsageBasis = 'budget-estimate' | 'actual-total-allocation' | 'recorded';
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
function validDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
}
export function weekOf(date: string) {
  if (!validDate(date)) throw new Error('Enter a valid date.');
  const d=new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay()+6)%7);
  return d.toISOString().slice(0,10);
}
export function completeVisit(job: SplitJob, visitId: string, percent: number, returnDate: string | null): SplitJob {
  const visit=job.visits.find(v=>v.id===visitId);
  if (!visit || visit.state!=='planned') throw new Error('This visit has already been recorded.');
  if (!visit.date || !validDate(visit.date)) throw new Error('Set the visit date before recording progress.');
  if (!Number.isFinite(percent) || percent<=0 || percent>visit.percent || round(percent)!==percent) throw new Error(`Enter more than 0 and no more than ${visit.percent}%, with up to two decimal places.`);
  if (percent<visit.percent && returnDate && (!validDate(returnDate) || returnDate<visit.date)) throw new Error('Return date must be on or after this visit.');
  const remaining=round(visit.percent-percent);
  return {...job, visits:job.visits.flatMap(v=> v.id!==visitId ? [v] : [
    {...v,percent,state:'completed' as const},
    ...(remaining>0 ? [{id:crypto.randomUUID(),date:returnDate,percent:remaining,state:'planned' as const}] : []),
  ]),history:[...job.history,`${visit.date}: recorded ${percent}% of the whole job; ${remaining}% remaining${remaining ? ` (${returnDate || 'unscheduled'})` : ''}.`]};
}
export function rescheduleVisit(job: SplitJob, visitId: string, date: string | null): SplitJob {
  const visit=job.visits.find(v=>v.id===visitId);
  if (!visit || visit.state!=='planned') throw new Error('Completed visits cannot be rescheduled.');
  const latest=job.visits.filter(v=>v.state==='completed').map(v=>v.date || '').sort().at(-1);
  if (date && (!validDate(date) || (latest && date<latest))) throw new Error('Choose a valid date on or after the last completed visit.');
  return {...job,visits:job.visits.map(v=>v.id===visitId ? {...v,date} : v),history:[...job.history,`Moved ${visit.percent}% from ${visit.date || 'unscheduled'} to ${date || 'unscheduled'}. Completed work unchanged.`]};
}
export function finaliseChecksheet(job: SplitJob, actualBags: number): SplitJob {
  if (job.visits.some(v=>v.state==='planned')) throw new Error('Record all remaining work before completing the checksheet.');
  if (!Number.isFinite(actualBags) || actualBags<0 || round(actualBags)!==actualBags) throw new Error('Enter a non-negative bag total with up to two decimal places.');
  const recorded=round(job.visits.reduce((n,v)=>n+(v.actualBags??0),0));
  if (recorded>actualBags || (job.visits.every(v=>v.actualBags!==undefined) && recorded!==actualBags)) throw new Error('The total conflicts with individually recorded usage. Correct the recorded usage first.');
  return {...job,checksheet:{complete:true,actualBags},history:[...job.history,`Final checksheet: ${actualBags} actual bags. Earlier estimates recalculated across visits; visit quantities remain allocated estimates.`]};
}
// Allocate in integer hundredths; assign rounding residue to the final visit.
function distribute(total: number | null, visits: Visit[]): (number | null)[] {
  if (total===null) return visits.map(()=>null);
  const weight=visits.reduce((n,v)=>n+v.percent,0);
  if (weight===0) return [];
  const units=Math.round(total*100); let assigned=0;
  return visits.map((v,i)=>{
    const share=i===visits.length-1 ? units-assigned : Math.floor(units*v.percent/weight);
    assigned+=share; return share/100;
  });
}
export function calendarRows(job: SplitJob) {
  const areas=distribute(job.area,job.visits), values=distribute(job.value,job.visits);
  return job.visits.map((v,i)=>({...v,jobId:job.id,number:job.number,customer:job.customer,area:areas[i]!,value:values[i]!}));
}
export function usageRows(job: SplitJob) {
  const final=job.checksheet.complete && job.checksheet.actualBags!==null;
  const budget=distribute(job.budgetBags,job.visits);
  const unrecorded=job.visits.filter(v=>v.actualBags===undefined);
  const total=final ? round(job.checksheet.actualBags! - job.visits.reduce((n,v)=>n+(v.actualBags??0),0)) : job.budgetBags;
  const allocation=final ? distribute(total,unrecorded) : budget;
  const finalById=new Map(unrecorded.map((v,i)=>[v.id,allocation[i]]));
  return calendarRows(job).flatMap((visit,i)=>visit.state!=='completed' ? [] : [{
    ...visit,
    budget:budget[i],
    bags:final ? visit.actualBags ?? finalById.get(visit.id) ?? null : budget[i],
    basis:(final ? visit.actualBags!==undefined ? 'recorded' : 'actual-total-allocation' : 'budget-estimate') as UsageBasis,
  }]);
}
export function demoJobs(): SplitJob[] {
  return [
    {id:'demo-101',number:'DEMO-101',customer:'Example: two-week installation',area:200,value:10000,budgetBags:30,visits:[{id:'visit-101',date:'2026-11-06',percent:100,state:'planned'}],checksheet:{complete:false,actualBags:null},history:[]},
    {id:'demo-102',number:'DEMO-102',customer:'Example: completed installation',area:100,value:5000,budgetBags:16,visits:[{id:'visit-102',date:'2026-11-05',percent:100,state:'completed'}],checksheet:{complete:true,actualBags:17},history:[]},
  ];
}
