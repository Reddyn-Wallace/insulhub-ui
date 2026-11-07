import { expect, it } from "vitest";
import { calendarSource, searchVisits, calendarVisits, queueVisits, replaceCalendarJob } from "./views";
import { initialSplit } from "./projection";
const job={_id:"a",stage:"COMPLETED",quote:{c_total:1000,wall:{SQM:100,c_bagCount:20}},installation:{installDate:"2026-11-06T00:00:00Z"}};
const split={...initialSplit(job),version:1,visits:[
{id:"initial",date:"2026-11-06",percent:60,state:"completed" as const},
{id:"second",date:null,percent:25,state:"planned" as const},
{id:"third",date:"2026-11-20",percent:15,state:"planned" as const},
]};
it("seeds the editor with full source and split data instead of refetching or using scaled quotes",()=>{
 const cards=calendarVisits(job,split);
 expect(cards[0].splitSource.quote.c_total).toBe(1000);
 expect(cards[0].installationSplit).toEqual(split);
 expect(cards[0].quote.c_total).toBe(600);
});
it("includes remaining work from completed parents in the normal queue without duplicating the full job",()=>{
 const queue=queueVisits([job],{a:split});
 expect(queue).toHaveLength(2);
 expect(queue.map(j=>j.quote.c_total)).toEqual([250,150]);
 expect(queue[0].installation.installDate).toBeNull();
 expect(queue[0].splitVisit?.state).toBe("planned");
 expect(queueVisits([{...job,archivedAt:"2026-01-01"}],{a:split})).toEqual([]);
 expect(queueVisits([job],{})).toEqual([]);
});
it("replaces only one job's calendar cards after a save",()=>{
 const other={...job,_id:"b"};
 const next=replaceCalendarJob([job,other],job,split);
 expect(next.filter(j=>j._id==="a")).toHaveLength(3);
 expect(next.find(j=>j._id==="b")).toBe(other);
 expect(replaceCalendarJob(next,job,{...split,visits:[{...split.visits[0],percent:100}]}).filter(j=>j._id==="a")).toHaveLength(1);
});

it("keeps revisit scheduling available in global search alongside leads and completed jobs",()=>{
 const lead={...job,_id:"lead",stage:"LEAD"};
 const closed={...job,_id:"closed"};
 const found=searchVisits([job,lead,closed],{a:split});
 expect(found.map(j=>j._id)).toEqual(["a","a","lead","closed"]);
 expect(found[0].installation.installDate).toBeNull();
 expect(found[0].quote.c_total).toBe(250);
});
it("uses the current ordinary job date instead of stale seed metadata",()=>{
 const stale=calendarVisits(job,null)[0];
 const moved={...stale,installation:{installDate:"2026-11-10T00:00:00Z"}};
 expect(calendarSource(moved).installation.installDate).toBe("2026-11-10T00:00:00Z");
 expect(calendarSource(calendarVisits(job,split)[1]).quote.c_total).toBe(1000);
});
