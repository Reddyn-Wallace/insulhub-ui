import { afterEach, describe, expect, it, vi } from "vitest";
import { settingsRequest } from "./settings-client";
afterEach(()=>{vi.unstubAllGlobals();});
describe("Settings account throttle feedback",()=>{
  it.each([["60","wait a minute"],["900","fifteen minutes"]])("explains the actual resend wait for Retry-After %s",async(seconds,copy)=>{
    vi.stubGlobal("localStorage",{getItem:()=>"fictional-test-token"});
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:"server error"},{status:429,headers:{"retry-after":seconds}})));
    await expect(settingsRequest("/api/settings/partners/company/users/user/access","POST",{action:"INVITE"})).rejects.toThrow(copy);
  });
});
