// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ request: vi.fn(), invalidate: vi.fn() }));
vi.mock("./client", () => ({ splitRequest: mocks.request, invalidateSplitCaches: mocks.invalidate }));
import InstallationVisits from "@/components/InstallationVisits";
import { initialSplit } from "./projection";
import { completeVisit } from "./model";
const source = {_id:"aaaaaaaaaaaaaaaaaaaaaaaa",quote:{c_total:10000,wall:{SQM:200,c_bagCount:30}},installation:{installDate:"2026-11-06T00:00:00Z"}};
const split = {...initialSplit(source),...completeVisit(initialSplit(source),"initial",60,"2026-11-10"),version:1};
beforeEach(()=>vi.resetAllMocks());
afterEach(cleanup);
it("shows only Split job for an ordinary seeded job without a network wait",()=>{
 render(<InstallationVisits jobId={source._id} initialData={{job:source,split:null}}/>);
 expect(screen.getByRole("button",{name:"Split job"})).toBeTruthy();
 expect(screen.queryByLabelText("Visit 1 percentage")).toBeNull();
 expect(mocks.request).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Split job"}));
 fireEvent.change(screen.getByLabelText("Visit 1 percentage"),{target:{value:"60"}});
 expect(screen.getByLabelText("Visit 2 percentage")).toHaveProperty("value","40");
});
it("shows a compact split summary immediately, with no report or history clutter",()=>{
 render(<InstallationVisits jobId={source._id} initialData={{job:source,split}}/>);
 expect(screen.getByText("60%")).toBeTruthy();
 expect(screen.getByText("Visit 1 · 6 Nov 2026")).toBeTruthy();
 expect(screen.getByText("40%")).toBeTruthy();
 expect(screen.getByRole("button",{name:"Edit visits"})).toBeTruthy();
 expect(screen.queryByText(/Usage reporting|Visit change history|Correct the last/)).toBeNull();
 expect(mocks.request).not.toHaveBeenCalled();
});
it("clears a revisit and returns the saved list to its parent without refetching",async()=>{
 const saved={...split,version:2,visits:split.visits.map(v=>v.state==="planned"?{...v,date:null}:v)};
 mocks.request.mockResolvedValue({split:saved});
 const onSaved=vi.fn();
 render(<InstallationVisits jobId={source._id} initialData={{job:source,split}} onSaved={onSaved}/>);
 fireEvent.click(screen.getByRole("button",{name:"Edit visits"}));
 fireEvent.click(screen.getByRole("button",{name:"Clear visit 2 date"}));
 fireEvent.click(screen.getByRole("button",{name:"Save visits"}));
 await waitFor(()=>expect(onSaved).toHaveBeenCalledWith(saved));
 expect(mocks.request).toHaveBeenCalledTimes(1);
 expect(mocks.request.mock.calls[0][1]).toMatchObject({action:"edit",version:1,visits:saved.visits});
 expect(screen.getByText(/Unscheduled/)).toBeTruthy();
});
it("supports three visits and blocks invalid totals",()=>{
 render(<InstallationVisits jobId={source._id} initialData={{job:source,split}}/>);
 fireEvent.click(screen.getByRole("button",{name:"Edit visits"}));
 fireEvent.click(screen.getByRole("button",{name:"Add visit"}));
 expect(screen.getByLabelText("Visit 3 percentage")).toHaveProperty("value","20");
 fireEvent.change(screen.getByLabelText("Visit 1 percentage"),{target:{value:"50"}});
 expect(screen.getByRole("button",{name:"Save visits"})).toHaveProperty("disabled",true);
 expect(screen.getByText("Total: 90% — must equal 100%")).toBeTruthy();
});
it("keeps failed edits open and offers an explicit reload for stale state",async()=>{
 mocks.request.mockRejectedValue(Error("This job changed. Reload the visits before trying again."));
 render(<InstallationVisits jobId={source._id} initialData={{job:source,split}}/>);
 fireEvent.click(screen.getByRole("button",{name:"Edit visits"}));
 fireEvent.click(screen.getByRole("button",{name:"Save visits"}));
 await screen.findByRole("alert");
 expect(screen.getByLabelText("Visit 1 percentage")).toBeTruthy();
 expect(screen.getByRole("button",{name:"Reload visits"})).toBeTruthy();
 expect(mocks.invalidate).not.toHaveBeenCalled();
});
it("requires historical correction reason only inside the editor",()=>{
 render(<InstallationVisits jobId={source._id} initialData={{job:{...source,installerChecksheet:{complete:true}},split:null}}/>);
 expect(screen.queryByLabelText("Reason for historical split")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Split job"}));
 expect(screen.getByLabelText("Reason for historical split")).toHaveProperty("required",true);
});


it("removes a split only through an explicit editable 100 percent visit",async()=>{
 const saved={...split,version:2,visits:[{...split.visits[0],percent:100,date:"2026-11-07"}]};
 mocks.request.mockResolvedValue({split:saved});
 render(<InstallationVisits jobId={source._id} initialData={{job:source,split}}/>);
 fireEvent.click(screen.getByRole("button",{name:"Edit visits"}));
 fireEvent.click(screen.getByRole("button",{name:"Remove split — use one visit"}));
 expect(screen.getByLabelText("Visit 1 percentage")).toHaveProperty("value","100");
 expect(screen.queryByLabelText("Visit 2 percentage")).toBeNull();
 fireEvent.change(screen.getByLabelText("Visit 1 date"),{target:{value:"2026-11-07"}});
 fireEvent.click(screen.getByRole("button",{name:"Save visits"}));
 await screen.findByText("Visit 1 · 7 Nov 2026");
 expect(mocks.request.mock.calls[0][1].visits).toEqual(saved.visits);
});
