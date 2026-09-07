import { afterEach, expect, it, vi } from 'vitest';
import { deliverCommunication, testCommunicationConnection, fetchGmailSignature } from './communication-delivery';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('never borrows deployment Gmail credentials for an owned connection test or signature',async()=>{
 vi.stubEnv('GMAIL_SEND_ACCESS_TOKEN','deployment-secret');vi.stubEnv('GMAIL_SEND_REFRESH_TOKEN','deployment-refresh');vi.stubEnv('GMAIL_CLIENT_ID','client');vi.stubEnv('GMAIL_CLIENT_SECRET','secret');
 const fetchMock=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetchMock);
 const input={provider:'gmail' as const,strictGmailConnection:true};
 await testCommunicationConnection(input).catch(()=>{});await fetchGmailSignature(input);
 expect(fetchMock).not.toHaveBeenCalled();
});
it.each([undefined, { smsgateBaseUrl: 'https://owned.example.com' }])('never borrows deployment SMS credentials with config %j',async providerConfig=>{
 vi.stubEnv('SMSGATE_BASE_URL','https://sms.example.com');vi.stubEnv('SMSGATE_AUTH_TOKEN','deployment-secret');
 const fetchMock=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetchMock);
 const input={provider:'smsgate' as const,strictSmsgateConnection:true,providerConfig};
 await testCommunicationConnection(input).catch(()=>{});
 await deliverCommunication({...input,channel:'sms',from:'021',to:'0211234567',subject:'',body:'Hi'}).catch(()=>{});
 expect(fetchMock).not.toHaveBeenCalled();
});
