// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {StrictMode} from "react";
import PartnerSubmissionStatusPanel from "@/components/PartnerSubmissionStatusPanel";

afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});
const initial={state:"QUEUED",checkpoint:"FROZEN",errorCode:null,updatedAt:"2026-08-30T00:00:00Z",completedAt:null,notification:"PENDING" as const};
const response=(status:unknown,code=200)=>new Response(JSON.stringify({status}),{status:code,headers:{"content-type":"application/json"}});
describe("fictional submission status recovery",()=>{
 it.each(["FAILED_RETRYABLE","RECONCILIATION_REQUIRED"])("keeps %s technical labels out of partner-facing status",state=>{
   vi.useFakeTimers();
   const view=render(<PartnerSubmissionStatusPanel jobId="test" initialStatus={{...initial,state,notification:undefined}}/>);
   expect(screen.getByRole("heading",{name:"Contact Insulmax"})).toBeTruthy();
   expect(view.container.textContent).toContain("Insulmax team directly");
   expect(view.container.textContent).not.toMatch(/FAILED RETRYABLE|RECONCILIATION REQUIRED|Internal retry pending/);
 });
 it("continues the demo handoff without showing any submission panel",async()=>{
   vi.useFakeTimers();const fetchMock=vi.fn().mockResolvedValue(response({...initial,state:"SUCCEEDED",checkpoint:"FINALIZED",notification:"DELIVERED"}));vi.stubGlobal("fetch",fetchMock);
   const view=render(<StrictMode><PartnerSubmissionStatusPanel backgroundOnly demoMode jobId="11111111-1111-4111-8111-111111111111" initialStatus={initial}/></StrictMode>);
   await act(async()=>{});
   await act(async()=>{await vi.advanceTimersByTimeAsync(30_000);});
   expect(fetchMock).toHaveBeenCalledOnce();expect(fetchMock.mock.calls[0][0]).toContain("/submission/resume");
   expect(view.container.innerHTML).toBe("");
 });
 it("never starts a demo handoff in a production background view",async()=>{
   vi.useFakeTimers();const fetchMock=vi.fn().mockResolvedValue(response({...initial,state:"SUCCEEDED",notification:undefined}));vi.stubGlobal("fetch",fetchMock);
   const view=render(<PartnerSubmissionStatusPanel backgroundOnly jobId="11111111-1111-4111-8111-111111111111" initialStatus={{...initial,notification:undefined}}/>);
   await act(async()=>{await vi.advanceTimersByTimeAsync(30_000);});
   expect(fetchMock).toHaveBeenCalledOnce();expect(fetchMock.mock.calls[0][0]).not.toContain("/resume");expect(view.container.innerHTML).toBe("");
 });
 it("publishes resumed completion after StrictMode's setup-cleanup-setup cycle",async()=>{
   const fetchMock=vi.fn().mockResolvedValue(response({...initial,state:"SUCCEEDED",checkpoint:"FINALIZED",notification:"DELIVERED"}));
   vi.stubGlobal("fetch",fetchMock);
   render(<StrictMode><PartnerSubmissionStatusPanel demoMode jobId="11111111-1111-4111-8111-111111111111" initialStatus={initial}/></StrictMode>);
   expect(await screen.findByText("Submitted")).toBeTruthy();
   expect(screen.getByText("Delivered in the demo only")).toBeTruthy();
   expect(screen.queryByRole("button",{name:"Checking…"})).toBeNull();expect(fetchMock).toHaveBeenCalledOnce();
 });
 it("auto-resumes after a suppressed after callback and announces terminal submission plus notification",async()=>{const fetchMock=vi.fn().mockResolvedValueOnce(response({...initial,state:"SUCCEEDED",checkpoint:"FINALIZED",notification:"DELIVERED",completedAt:"2026-08-30T00:01:00Z"}));vi.stubGlobal("fetch",fetchMock);render(<PartnerSubmissionStatusPanel demoMode jobId="11111111-1111-4111-8111-111111111111" initialStatus={initial}/>);expect(await screen.findByText("Submitted")).toBeTruthy();expect(screen.getByText("Delivered in the demo only")).toBeTruthy();expect(fetchMock.mock.calls[0]?.[0]).toContain("/resume");expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");});
 it("guards concurrent manual recovery and preserves the last authoritative state on failure",async()=>{let resolve!:(value:Response)=>void;const fetchMock=vi.fn(()=>new Promise<Response>(done=>{resolve=done;}));vi.stubGlobal("fetch",fetchMock);render(<PartnerSubmissionStatusPanel demoMode jobId="11111111-1111-4111-8111-111111111111" initialStatus={initial}/>);await waitFor(()=>expect(fetchMock).toHaveBeenCalledOnce());const button=screen.getByRole("button",{name:"Checking…"});fireEvent.click(button);fireEvent.click(button);expect(fetchMock).toHaveBeenCalledOnce();resolve(new Response(JSON.stringify({code:"SUBMISSION_UNAVAILABLE"}),{status:503,headers:{"content-type":"application/json"}}));expect(await screen.findByText(/last verified status remains shown/i)).toBeTruthy();expect(screen.getByText("Submission received")).toBeTruthy();});
 it("does not stop when submission succeeds before its public notification becomes terminal",async()=>{vi.useFakeTimers();const fetchMock=vi.fn().mockResolvedValueOnce(response({...initial,state:"SUCCEEDED",checkpoint:"FINALIZED",notification:"PENDING"})).mockResolvedValueOnce(response({...initial,state:"SUCCEEDED",checkpoint:"FINALIZED",notification:"DELIVERED"}));vi.stubGlobal("fetch",fetchMock);render(<PartnerSubmissionStatusPanel demoMode jobId="11111111-1111-4111-8111-111111111111" initialStatus={initial}/>);await vi.runAllTimersAsync();expect(fetchMock.mock.calls.some(call=>String(call[0]).endsWith("/submission"))).toBe(true);expect(screen.getByText("Delivered in the demo only")).toBeTruthy();});
 it("treats DEAD as terminal, makes no recovery call, and keeps fictional wording out of production",async()=>{const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);render(<PartnerSubmissionStatusPanel demoMode jobId="11111111-1111-4111-8111-111111111111" initialStatus={{...initial,state:"SUCCEEDED",checkpoint:"FINALIZED",notification:"DEAD"}}/>);expect(screen.getByText("Stopped without delivery")).toBeTruthy();expect(screen.queryByRole("button",{name:/resume/i})).toBeNull();expect(fetchMock).not.toHaveBeenCalled();cleanup();render(<PartnerSubmissionStatusPanel jobId="11111111-1111-4111-8111-111111111111" initialStatus={{...initial,state:"SUCCEEDED",checkpoint:"FINALIZED",notification:undefined}}/>);expect(screen.getByText("The submission completed. The saved quote and plans remain read-only.")).toBeTruthy();expect(screen.queryByText(/fictional/i)).toBeNull();});
 it("renders the manual recovery control at the mobile target size",async()=>{let resolve!:(value:Response)=>void;vi.stubGlobal("fetch",vi.fn(()=>new Promise<Response>(done=>{resolve=done;})));render(<PartnerSubmissionStatusPanel demoMode jobId="11111111-1111-4111-8111-111111111111" initialStatus={initial}/>);const button=await screen.findByRole("button",{name:"Checking…"});expect(button.className).toContain("min-h-11");resolve(response({...initial,state:"SUCCEEDED",notification:"DELIVERED"}));});
});
