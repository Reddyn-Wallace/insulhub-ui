// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { StrictMode } from "react";

const refresh=vi.fn();
vi.mock("next/navigation",()=>({useRouter:()=>({refresh,replace:vi.fn(),push:vi.fn()})}));

import PartnerSubmissionPanel from "@/components/PartnerSubmissionPanel";
import { partnerSubmissionBrowserKeyName } from "./submission-client";

const jobId="11111111-1111-4111-8111-111111111111";
const uuid="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const keyName=partnerSubmissionBrowserKeyName("scope-a",jobId,2,3);
const draftResponse=()=>new Response(JSON.stringify({status:{state:"DRAFT"}}),{status:200,headers:{"content-type":"application/json"}});
const acceptedResponse=()=>new Response(JSON.stringify({status:{state:"SUCCEEDED",notification:"DELIVERED"},replayed:false}),{status:200,headers:{"content-type":"application/json"}});

class BrowserLocks {
  private tail=Promise.resolve();
  request<T>(_name:string,callback:()=>Promise<T>|T):Promise<T>{const result=this.tail.then(callback);this.tail=result.then(()=>undefined,()=>undefined);return result;}
}
class TestStorage implements Storage {
  private values=new Map<string,string>();
  get length(){return this.values.size;}
  clear(){this.values.clear();}
  getItem(key:string){return this.values.get(key)??null;}
  key(index:number){return [...this.values.keys()][index]??null;}
  removeItem(key:string){this.values.delete(key);}
  setItem(key:string,value:string){this.values.set(key,String(value));}
}

function renderPanel(overrides:Partial<React.ComponentProps<typeof PartnerSubmissionPanel>>={}){
  const props={jobId,recoveryScope:"scope-a",jobRevision:2,floorPlanRevision:3,ready:true,dirty:false,saving:false,plansBusy:false,stale:false,frozen:false,recoveryChecked:true,onLockChange:vi.fn(),onRecoveryChecked:vi.fn(),onFrozen:vi.fn(),...overrides};
  return {props,...render(<PartnerSubmissionPanel {...props}/>)};
}

async function confirmSubmit(){const user=userEvent.setup();await user.click(await screen.findByRole("button",{name:"Submit quote"}));await user.click(await screen.findByRole("button",{name:"Submit and make read-only"}));}

describe("PartnerSubmissionPanel recovery interactions",()=>{
  beforeEach(()=>{Object.defineProperty(window,"localStorage",{configurable:true,value:new TestStorage()});refresh.mockClear();Object.defineProperty(globalThis.crypto,"randomUUID",{configurable:true,value:()=>uuid});Object.defineProperty(navigator,"locks",{configurable:true,value:new BrowserLocks()});});
  afterEach(()=>{cleanup();vi.unstubAllGlobals();});

  it("locks synchronously, sends one POST after confirmation, and clears the key on confirmed completion",async()=>{
    const fetchMock=vi.fn().mockImplementationOnce(async()=>draftResponse()).mockImplementationOnce(async()=>acceptedResponse());vi.stubGlobal("fetch",fetchMock);
    const {props}=renderPanel();await waitFor(()=>expect(props.onRecoveryChecked).toHaveBeenCalled());
    await confirmSubmit();await waitFor(()=>expect(props.onFrozen).toHaveBeenCalledTimes(1));
    expect(props.onLockChange).toHaveBeenCalledWith(true);expect(fetchMock).toHaveBeenCalledTimes(2);expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("POST");expect(window.localStorage.getItem(keyName)).toBeNull();expect(screen.getByText(/Quote submitted successfully/i)).toBeTruthy();
  });

  it("uses the success destination callback only after confirmed submission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(async()=>draftResponse()).mockImplementationOnce(async()=>acceptedResponse()));
    const success=vi.fn();const {props}=renderPanel({onSuccess:success});
    await waitFor(()=>expect(props.onRecoveryChecked).toHaveBeenCalled());await confirmSubmit();
    await waitFor(()=>expect(success).toHaveBeenCalledOnce());expect(props.onFrozen).not.toHaveBeenCalled();
  });

  it("keeps a failed transfer read-only and tells the partner to contact Insulmax",async()=>{
    const failed=new Response(JSON.stringify({code:"SUBMISSION_FAILED",error:"Submission unsuccessful. Contact the Insulmax team directly.",status:{state:"FAILED_RETRYABLE"}}),{status:502,headers:{"content-type":"application/json"}});
    const fetchMock=vi.fn().mockImplementationOnce(async()=>draftResponse()).mockImplementationOnce(async()=>failed);vi.stubGlobal("fetch",fetchMock);
    const {props}=renderPanel();await waitFor(()=>expect(props.onRecoveryChecked).toHaveBeenCalled());await confirmSubmit();
    expect(await screen.findByText(/Contact the Insulmax team directly/i)).toBeTruthy();expect(props.onFrozen).toHaveBeenCalledOnce();expect(window.localStorage.getItem(keyName)).toBeNull();
  });

  it("cannot open confirmation before recovery and rechecks the gate after confirmation opens",async()=>{
    const fetchMock=vi.fn().mockImplementation(async()=>draftResponse());vi.stubGlobal("fetch",fetchMock);const blocked=renderPanel({recoveryChecked:false});const initiallyBlocked=screen.getByRole("button",{name:/Submit quote|Submitting/});expect(initiallyBlocked.matches(":disabled")).toBe(true);fireEvent.click(initiallyBlocked);expect(screen.queryByRole("dialog")).toBeNull();blocked.unmount();const view=renderPanel();await waitFor(()=>expect(view.props.onRecoveryChecked).toHaveBeenCalled());const submit=await screen.findByRole("button",{name:"Submit quote"});fireEvent.click(submit);expect(screen.getByRole("dialog")).toBeTruthy();view.rerender(<PartnerSubmissionPanel {...view.props} recoveryChecked={false} frozen/>);fireEvent.click(screen.getByRole("button",{name:"Submit and make read-only"}));expect(await screen.findByText(/changed while confirmation was open/i)).toBeTruthy();expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps Submit quote enabled while confirming and restores focus after Escape",async()=>{
    const fetchMock=vi.fn().mockImplementationOnce(async()=>draftResponse());vi.stubGlobal("fetch",fetchMock);const {props}=renderPanel();await waitFor(()=>expect(props.onRecoveryChecked).toHaveBeenCalled());const user=userEvent.setup();const submit=screen.getByRole("button",{name:"Submit quote"});await user.click(submit);expect(submit.matches(":disabled")).toBe(false);expect(screen.getByRole("dialog")).toBeTruthy();await user.keyboard("{Escape}");await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());expect(document.activeElement).toBe(submit);expect(submit.matches(":disabled")).toBe(false);expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("suppresses a rapid double click and locks before the accepted POST resolves",async()=>{
    let resolve!: (value:Response)=>void;const fetchMock=vi.fn().mockImplementationOnce(async()=>draftResponse()).mockImplementationOnce(()=>new Promise<Response>((done)=>{resolve=done;}));vi.stubGlobal("fetch",fetchMock);const {props}=renderPanel();await waitFor(()=>expect(props.onRecoveryChecked).toHaveBeenCalled());const submit=screen.getByRole("button",{name:"Submit quote"});fireEvent.click(submit);fireEvent.click(submit);expect(screen.getAllByRole("dialog")).toHaveLength(1);fireEvent.click(screen.getByRole("button",{name:"Submit and make read-only"}));await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));expect(props.onLockChange).toHaveBeenLastCalledWith(true);expect(screen.getByRole("button",{name:"Submitting…"}).matches(":disabled")).toBe(true);resolve(acceptedResponse());await waitFor(()=>expect(props.onFrozen).toHaveBeenCalledOnce());
  });

  it("replays the identical pending key after a lost response and never allocates a second key",async()=>{
    const fetchMock=vi.fn().mockImplementationOnce(async()=>draftResponse()).mockImplementationOnce(async()=>{throw new TypeError("connection reset");}).mockImplementationOnce(async()=>acceptedResponse());vi.stubGlobal("fetch",fetchMock);
    const {props}=renderPanel();await waitFor(()=>expect(props.onRecoveryChecked).toHaveBeenCalled());await confirmSubmit();await waitFor(()=>expect(props.onFrozen).toHaveBeenCalled());
    const sent=fetchMock.mock.calls.slice(1).map((call)=>JSON.parse(String((call[1] as RequestInit).body)) as {idempotencyKey:string});expect(sent.map((value)=>value.idempotencyKey)).toEqual([uuid,uuid]);
  });

  it("preserves the key and lock when a lost original is followed by a no-effect retry",async()=>{
    const fetchMock=vi.fn().mockImplementationOnce(async()=>draftResponse()).mockImplementationOnce(async()=>{throw new TypeError("connection reset");}).mockImplementationOnce(async()=>new Response(JSON.stringify({code:"RATE_LIMITED"}),{status:429,headers:{"content-type":"application/json"}}));vi.stubGlobal("fetch",fetchMock);
    const {props}=renderPanel();await waitFor(()=>expect(props.onRecoveryChecked).toHaveBeenCalled());await confirmSubmit();await waitFor(()=>expect(screen.getByText(/status is still uncertain/i)).toBeTruthy());
    expect(readStoredState()).toBe("PENDING");expect(props.onLockChange).not.toHaveBeenLastCalledWith(false);expect(props.onFrozen).not.toHaveBeenCalled();
  });

  it("treats a stale revision as proven no-effect and offers a reload",async()=>{
    const fetchMock=vi.fn().mockImplementationOnce(async()=>draftResponse()).mockImplementationOnce(async()=>new Response(JSON.stringify({code:"STALE_REVISION"}),{status:409,headers:{"content-type":"application/json"}}));vi.stubGlobal("fetch",fetchMock);
    const {props}=renderPanel();await waitFor(()=>expect(props.onRecoveryChecked).toHaveBeenCalled());await confirmSubmit();await waitFor(()=>expect(screen.getByText(/Reload the latest version/i)).toBeTruthy());expect(props.onLockChange).toHaveBeenLastCalledWith(false);expect(window.localStorage.getItem(keyName)).toBeNull();
  });

  it("clears PENDING only for direct proven-no-effect 401, 429, and preflight 503 responses",async()=>{
    const cases=[{status:401,body:{code:"SESSION_EXPIRED"},text:/session has expired/i},{status:429,body:{code:"RATE_LIMITED"},text:/Too many attempts/i},{status:503,body:{code:"SUBMISSION_UNAVAILABLE",error:"Submission is unavailable."},text:/Submission is unavailable/i}];
    for(const item of cases){cleanup();Object.defineProperty(window,"localStorage",{configurable:true,value:new TestStorage()});const fetchMock=vi.fn().mockImplementationOnce(async()=>draftResponse()).mockImplementationOnce(async()=>new Response(JSON.stringify(item.body),{status:item.status,headers:{"content-type":"application/json","retry-after":"1"}}));vi.stubGlobal("fetch",fetchMock);const {props}=renderPanel();await waitFor(()=>expect(props.onRecoveryChecked).toHaveBeenCalled());await confirmSubmit();await waitFor(()=>expect(screen.getByText(item.text)).toBeTruthy());expect(window.localStorage.getItem(keyName)).toBeNull();expect(props.onLockChange).toHaveBeenLastCalledWith(false);}
  });

  it("blocks stale local readiness and offers floor-plan recovery after a PDF 422",async()=>{
    const target=document.createElement("section");target.id="floor-plans";target.tabIndex=-1;document.body.append(target);
    const fetchMock=vi.fn().mockImplementationOnce(async()=>draftResponse()).mockImplementationOnce(async()=>new Response(JSON.stringify({code:"SUBMISSION_PDF_STALE"}),{status:422,headers:{"content-type":"application/json"}}));vi.stubGlobal("fetch",fetchMock);
    const view=renderPanel();await waitFor(()=>expect(view.props.onRecoveryChecked).toHaveBeenCalled());await confirmSubmit();await waitFor(()=>expect(screen.getByText(/floor plan changed/i)).toBeTruthy());expect(view.props.onLockChange).toHaveBeenLastCalledWith(true);expect(document.activeElement?.id).toBe("floor-plans");expect(screen.getByRole("link",{name:"Open floor plans"}).getAttribute("href")).toBe(`/partner/jobs/${jobId}#floor-plans`);expect(screen.getByRole("button",{name:"Reload job status"})).toBeTruthy();expect(window.localStorage.getItem(keyName)).toBeNull();view.rerender(<PartnerSubmissionPanel {...view.props} frozen/>);expect(screen.getByRole("button",{name:"Submit quote"}).matches(":disabled")).toBe(true);target.remove();
  });

  it("locks a stale server-rendered DRAFT when the mount status check is already non-DRAFT",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({status:{state:"PROCESSING"}}),{status:200,headers:{"content-type":"application/json"}})));
    const {props}=renderPanel();await waitFor(()=>expect(props.onFrozen).toHaveBeenCalled());expect(props.onLockChange).toHaveBeenCalledWith(true);
  });

  it("fails before POST when durable cross-tab coordination is unavailable",async()=>{
    Object.defineProperty(navigator,"locks",{configurable:true,value:undefined});const fetchMock=vi.fn().mockImplementationOnce(async()=>draftResponse());vi.stubGlobal("fetch",fetchMock);
    const {props}=renderPanel();await waitFor(()=>expect(props.onRecoveryChecked).toHaveBeenCalled());await confirmSubmit();await waitFor(()=>expect(screen.getByText(/No submission was started/i)).toBeTruthy());expect(fetchMock).toHaveBeenCalledTimes(1);expect(props.onLockChange).toHaveBeenLastCalledWith(false);
  });

  it("detects a second-tab PENDING storage transition and immediately reconciles that exact key",async()=>{
    const fetchMock=vi.fn().mockImplementationOnce(async()=>draftResponse()).mockImplementationOnce(async()=>acceptedResponse());vi.stubGlobal("fetch",fetchMock);
    const {props}=renderPanel();await waitFor(()=>expect(props.onRecoveryChecked).toHaveBeenCalled());
    const value=JSON.stringify({key:uuid,state:"PENDING",createdAt:1_000,updatedAt:1_000});window.localStorage.setItem(keyName,value);
    const event=new Event("storage") as StorageEvent;Object.defineProperties(event,{key:{value:keyName},newValue:{value},storageArea:{value:window.localStorage}});window.dispatchEvent(event);
    await waitFor(()=>expect(props.onFrozen).toHaveBeenCalled());expect(props.onLockChange).toHaveBeenCalledWith(true);expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({idempotencyKey:uuid});
  });

  it("never lets an obsolete mount DRAFT response unlock after exact-key replay accepts",async()=>{
    let resolveStatus!: (value:Response)=>void;const fetchMock=vi.fn().mockImplementationOnce(()=>new Promise<Response>((done)=>{resolveStatus=done;})).mockImplementationOnce(async()=>acceptedResponse());vi.stubGlobal("fetch",fetchMock);function Harness(){const[frozen,setFrozen]=React.useState(false);const[checked,setChecked]=React.useState(false);return <PartnerSubmissionPanel jobId={jobId} recoveryScope="scope-a" jobRevision={2} floorPlanRevision={3} ready dirty={false} saving={false} plansBusy={false} stale={false} frozen={frozen} recoveryChecked={checked} onLockChange={setFrozen} onRecoveryChecked={()=>setChecked(true)} onFrozen={()=>setFrozen(true)}/>;}render(<Harness/>);await waitFor(()=>expect(fetchMock).toHaveBeenCalledOnce());const value=JSON.stringify({key:uuid,state:"PENDING",createdAt:1_000,updatedAt:1_000});window.localStorage.setItem(keyName,value);const event=new Event("storage") as StorageEvent;Object.defineProperties(event,{key:{value:keyName},newValue:{value},storageArea:{value:window.localStorage}});window.dispatchEvent(event);await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));await waitFor(()=>expect(screen.getByText(/Quote submitted successfully/i)).toBeTruthy());resolveStatus(draftResponse());await Promise.resolve();expect(screen.getByRole("button",{name:"Submit quote"}).matches(":disabled")).toBe(true);
  });

  it("locks a stale quote tab for a newer-revision PENDING key without replaying stale revisions",async()=>{
    let resolve!: (value:Response)=>void;const fetchMock=vi.fn().mockImplementationOnce(()=>new Promise<Response>((done)=>{resolve=done;}));vi.stubGlobal("fetch",fetchMock);const onLock=vi.fn();function Harness(){const[frozen,setFrozen]=React.useState(false);return <PartnerSubmissionPanel jobId={jobId} recoveryScope="scope-a" jobRevision={2} floorPlanRevision={3} ready dirty={false} saving={false} plansBusy={false} stale={false} frozen={frozen} onLockChange={(value)=>{onLock(value);setFrozen(value);}} onRecoveryChecked={vi.fn()} onFrozen={vi.fn()}/>;}render(<Harness/>);await waitFor(()=>expect(fetchMock).toHaveBeenCalledOnce());const newerName=partnerSubmissionBrowserKeyName("scope-a",jobId,3,4);const value=JSON.stringify({key:uuid,state:"PENDING",createdAt:1_000,updatedAt:1_000});window.localStorage.setItem(newerName,value);const event=new Event("storage") as StorageEvent;Object.defineProperties(event,{key:{value:newerName},newValue:{value},storageArea:{value:window.localStorage}});window.dispatchEvent(event);resolve(draftResponse());expect(await screen.findByText(/newer saved revision is already being submitted/i)).toBeTruthy();expect(onLock).toHaveBeenLastCalledWith(true);expect(fetchMock).toHaveBeenCalledTimes(1);expect(screen.getByRole("button",{name:"Submit quote"}).matches(":disabled")).toBe(true);
  });

  it("reconciles an existing PENDING key on remount and aborts a no-key status check on unmount",async()=>{
    window.localStorage.setItem(keyName,JSON.stringify({key:uuid,state:"PENDING",createdAt:1_000,updatedAt:1_000}));const accepted=vi.fn(async(...args:[string,RequestInit?])=>{void args;return acceptedResponse();});vi.stubGlobal("fetch",accepted);const first=renderPanel();await waitFor(()=>expect(first.props.onFrozen).toHaveBeenCalled());expect(JSON.parse(String(accepted.mock.calls[0]?.[1]?.body))).toMatchObject({idempotencyKey:uuid});first.unmount();
    let signal:AbortSignal|undefined;window.localStorage.clear();vi.stubGlobal("fetch",vi.fn((_url:string,init?:RequestInit)=>{signal=init?.signal??undefined;return new Promise<Response>(()=>undefined);}));const second=renderPanel();await waitFor(()=>expect(signal).toBeDefined());second.unmount();expect(signal?.aborted).toBe(true);expect(second.props.onFrozen).not.toHaveBeenCalled();
  });

  it("restarts the initial status check under StrictMode without publishing the aborted effect",async()=>{
    const fetchMock=vi.fn((_url:string,init?:RequestInit)=>fetchMock.mock.calls.length===1?new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener("abort",()=>reject(new DOMException("aborted","AbortError")))):Promise.resolve(draftResponse()));vi.stubGlobal("fetch",fetchMock);
    const props={jobId,recoveryScope:"scope-a",jobRevision:2,floorPlanRevision:3,ready:true,dirty:false,saving:false,plansBusy:false,stale:false,frozen:false,onLockChange:vi.fn(),onRecoveryChecked:vi.fn(),onFrozen:vi.fn()};
    render(<StrictMode><PartnerSubmissionPanel {...props}/></StrictMode>);await waitFor(()=>expect(props.onRecoveryChecked).toHaveBeenCalled());expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);expect(screen.queryByText(/status could not be confirmed/i)).toBeNull();expect(props.onLockChange).toHaveBeenLastCalledWith(false);
  });
});

function readStoredState():string|null{const raw=window.localStorage.getItem(keyName);return raw?(JSON.parse(raw) as {state?:string}).state??null:null;}
