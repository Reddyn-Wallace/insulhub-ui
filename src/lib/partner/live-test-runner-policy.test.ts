import {describe,expect,it} from "vitest";
import {partnerLiveTestRunConfig} from "./live-test-runner-policy";

const requestId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("one-shot live production test policy",()=>{
  it("allows a read-only status check without destructive confirmation",()=>{
    expect(partnerLiveTestRunConfig({PARTNER_LIVE_TEST_REQUEST_ID:requestId},["status"])).toEqual({requestId,mode:"status"});
  });
  it("requires the exact destructive confirmation",()=>{
    expect(()=>partnerLiveTestRunConfig({PARTNER_LIVE_TEST_REQUEST_ID:requestId},["run"])).toThrow("ONE_LABELLED_PRODUCTION_SUBMISSION");
    expect(partnerLiveTestRunConfig({PARTNER_LIVE_TEST_REQUEST_ID:requestId,PARTNER_LIVE_TEST_CONFIRM:"ONE_LABELLED_PRODUCTION_SUBMISSION"},["run"])).toEqual({requestId,mode:"run"});
  });
  it("rejects demo mode, unknown modes and malformed request ids",()=>{
    expect(()=>partnerLiveTestRunConfig({PARTNER_LIVE_TEST_REQUEST_ID:requestId,PARTNER_DEMO_MODE:"true"},["status"])).toThrow("refuses demo mode");
    expect(()=>partnerLiveTestRunConfig({PARTNER_LIVE_TEST_REQUEST_ID:requestId},["again"])).toThrow("Use partner:live-test-once");
    expect(()=>partnerLiveTestRunConfig({PARTNER_LIVE_TEST_REQUEST_ID:"not-a-request"},["status"])).toThrow("must identify");
  });
});
