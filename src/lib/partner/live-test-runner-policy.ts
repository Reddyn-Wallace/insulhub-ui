const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PartnerLiveTestRunConfig {requestId:string;mode:"run"|"status"}

export function partnerLiveTestRunConfig(env:Readonly<Record<string,string|undefined>>,args:readonly string[]):PartnerLiveTestRunConfig{
  const requestId=env.PARTNER_LIVE_TEST_REQUEST_ID??"";
  const mode=args[0]??"run";
  if(!UUID.test(requestId))throw new Error("PARTNER_LIVE_TEST_REQUEST_ID must identify the single submitted test request");
  if(mode!=="run"&&mode!=="status")throw new Error("Use partner:live-test-once -- run or -- status");
  if(env.PARTNER_DEMO_MODE||env.PARTNER_DEMO_CONFIRM)throw new Error("The live test runner refuses demo mode");
  if(mode==="run"&&env.PARTNER_LIVE_TEST_CONFIRM!=="ONE_LABELLED_PRODUCTION_SUBMISSION")
    throw new Error("Set PARTNER_LIVE_TEST_CONFIRM=ONE_LABELLED_PRODUCTION_SUBMISSION for the one deliberate run");
  return{requestId:requestId.toLowerCase(),mode};
}
