import { describe, expect, it } from "vitest";
import { allocatePendingPartnerSubmissionKey, clearPartnerSubmissionKey, clearPartnerSubmissionScope, partnerSubmissionBrowserKeyName, readPendingPartnerSubmissionKey, readPartnerSubmissionKeyRecord, type SubmissionKeyStorage, type SubmissionLockManager } from "./submission-client";

class MemoryStorage implements SubmissionKeyStorage {
  readonly values = new Map<string,string>();
  get length(){return this.values.size;}
  getItem(key:string){return this.values.get(key)??null;}
  setItem(key:string,value:string){this.values.set(key,value);}
  removeItem(key:string){this.values.delete(key);}
  key(index:number){return [...this.values.keys()][index]??null;}
}

class Locks implements SubmissionLockManager {
  private tails=new Map<string,Promise<void>>();
  async request<T>(name:string,callback:()=>Promise<T>|T):Promise<T>{
    const previous=this.tails.get(name)??Promise.resolve();let release!:()=>void;
    const current=new Promise<void>((resolve)=>{release=resolve;});const tail=previous.then(()=>current);this.tails.set(name,tail);await previous;
    try{return await callback();}finally{release();if(this.tails.get(name)===tail)this.tails.delete(name);}
  }
}

const input={scope:"user-company-scope",jobId:"11111111-1111-4111-8111-111111111111",jobRevision:4,floorPlanRevision:2};
const uuidA="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const uuidB="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("partner submission browser recovery key",()=>{
  it("serializes simultaneous tabs onto one durably pending key",async()=>{
    const storage=new MemoryStorage();const locks=new Locks();let generated=0;
    const keys=await Promise.all(Array.from({length:10},()=>allocatePendingPartnerSubmissionKey(input,storage,locks,()=>generated++?uuidB:uuidA,()=>1_000)));
    expect(new Set(keys)).toEqual(new Set([uuidA]));expect(generated).toBe(1);
    expect(readPartnerSubmissionKeyRecord(input,storage)).toEqual({key:uuidA,state:"PENDING",createdAt:1_000,updatedAt:1_000});
  });

  it("fails closed without storage or cross-tab locks",async()=>{
    const storage=new MemoryStorage();
    await expect(allocatePendingPartnerSubmissionKey(input,null,new Locks(),()=>uuidA)).resolves.toBeNull();
    await expect(allocatePendingPartnerSubmissionKey(input,storage,null,()=>uuidA)).resolves.toBeNull();
    expect(storage.length).toBe(0);
  });

  it("removes an unverified pending write and never auto-submits it",async()=>{
    class BrokenReadback extends MemoryStorage { reads=0; override getItem(key:string){this.reads+=1;if(this.reads>=3)throw new Error("read failure");return super.getItem(key);} }
    const storage=new BrokenReadback();
    await expect(allocatePendingPartnerSubmissionKey(input,storage,new Locks(),()=>uuidA,()=>2_000)).resolves.toBeNull();
    expect(storage.values.has(partnerSubmissionBrowserKeyName(input.scope,input.jobId,input.jobRevision,input.floorPlanRevision))).toBe(false);
  });

  it("never expires a pending response-loss key, but replaces an old unused allocation",async()=>{
    const storage=new MemoryStorage();const name=partnerSubmissionBrowserKeyName(input.scope,input.jobId,input.jobRevision,input.floorPlanRevision);
    storage.setItem(name,JSON.stringify({key:uuidA,state:"PENDING",createdAt:1,updatedAt:1}));
    await expect(allocatePendingPartnerSubmissionKey(input,storage,new Locks(),()=>uuidB,()=>99_999_999_999)).resolves.toBe(uuidA);
    storage.setItem(name,JSON.stringify({key:uuidA,state:"ALLOCATED",createdAt:1,updatedAt:1}));
    await expect(allocatePendingPartnerSubmissionKey(input,storage,new Locks(),()=>uuidB,()=>99_999_999_999)).resolves.toBe(uuidB);
  });

  it("isolates scopes and clears exact acceptance or the authenticated logout scope",async()=>{
    const storage=new MemoryStorage();const locks=new Locks();const other={...input,scope:"other-company-user"};
    await allocatePendingPartnerSubmissionKey(input,storage,locks,()=>uuidA,()=>3_000);
    await allocatePendingPartnerSubmissionKey(other,storage,locks,()=>uuidB,()=>3_000);
    clearPartnerSubmissionKey(input,storage);expect(readPendingPartnerSubmissionKey(input,storage)).toBeNull();expect(readPendingPartnerSubmissionKey(other,storage)).toBe(uuidB);
    clearPartnerSubmissionScope(other.scope,storage);expect(storage.length).toBe(0);
  });
});
