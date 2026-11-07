import { expect, it } from "vitest";
import { editVisits } from "./model";
import { initialSplit } from "./projection";
const base = initialSplit({_id:"a",quote:{c_total:1000,wall:{SQM:100,c_bagCount:20}},installation:{installDate:"2026-11-06T00:00:00Z"}});
const visits = [
 {id:"initial",date:"2026-11-05",percent:60,state:"completed" as const},
 {id:"second",date:null,percent:25,state:"planned" as const},
 {id:"third",date:"2026-11-20",percent:15,state:"planned" as const},
];
it("edits dates and shares and supports several remaining visits",()=>{
 const next=editVisits(base,visits);
 expect(next.visits).toEqual(visits);
 expect(next.value).toBe(1000);
 expect(next.history).toHaveLength(1);
});
it("requires exactly 100 percent and positive two-decimal shares",()=>{
 for(const percent of [0,-1,24.999,24,NaN]) expect(()=>editVisits(base,[visits[0],{...visits[1],percent},visits[2]])).toThrow();
});
it("validates dates, completion state, unique ids, and bounds",()=>{
 for(const list of [
 [],[{...visits[0],percent:100,date:null}],
 [{...visits[0],percent:100,date:"2026-02-30"}],
 [{...visits[0],percent:100,state:"invalid"}],
 [visits[0],{...visits[1],percent:40,id:"initial"}],
 [{...visits[0],percent:100,id:""}],
 ]) expect(()=>editVisits(base,list)).toThrow();
});
it("preserves recorded bags and rejects deleting or reopening their visit",()=>{
 const existing={...base,visits:[{...visits[0],actualBags:12},{...visits[1],percent:40}]};
 expect(editVisits(existing,visits).visits[0].actualBags).toBe(12);
 expect(()=>editVisits(existing,[{...visits[1],percent:100}])).toThrow(/recorded usage/i);
 expect(()=>editVisits(existing,[{...visits[0],state:"planned"}, {...visits[1],percent:40}])).toThrow(/recorded usage/i);
 expect(editVisits(base,[{...visits[0],percent:100,actualBags:999}]).visits[0].actualBags).toBeUndefined();
});
it("can collapse back to one explicitly dated 100 percent visit",()=>{
 expect(editVisits({...base,visits},[{...visits[0],percent:100}]).visits).toHaveLength(1);
});
