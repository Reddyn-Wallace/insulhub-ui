import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ sql:vi.fn(), identity:vi.fn(), deliver:vi.fn() }));
vi.mock('@/lib/overlay-db',()=>({overlaySql:mocks.sql,ensureOverlaySchema:vi.fn()}));
vi.mock('@/lib/insulhub-auth',()=>({requireInsulhubAuth:vi.fn().mockResolvedValue(null)}));
vi.mock('@/lib/job-sms-access',()=>({jobSmsIdentity:mocks.identity}));
vi.mock('@/lib/communication-delivery',()=>({deliverCommunication:mocks.deliver}));
vi.mock('@/lib/communication-settings',()=>({loadCommunicationSettings:vi.fn().mockResolvedValue({}),communicationSendWindowError:vi.fn().mockReturnValue(null)}));
import { PATCH } from '@/app/api/campaigns/[id]/route';
import { processCampaignQueue } from './campaign-queue';
let campaign:Record<string,unknown>, sender:Record<string,unknown>;
beforeEach(()=>{
 vi.clearAllMocks();mocks.deliver.mockResolvedValue({ok:true});mocks.identity.mockResolvedValue({me:{_id:'reddyn'}});
 campaign={id:'campaign',channel:'sms',status:'draft',sender_id:'sender',sender_label:'Andrew',message_body:'Hello',send_authorized_user_id:'reddyn'};
 sender={id:'sender',owner_user_id:'andrew',channel:'sms',provider:'smsgate',connection_status:'connected',is_active:true};
 mocks.sql.mockImplementation(async (parts:TemplateStringsArray,...values:unknown[])=>{
  const sql=parts.join('?');
  if(sql.includes('FROM communication_senders')) return sql.includes('owner_user_id') && !values.includes(sender.owner_user_id) ? [] : [sender];
  if(sql.includes('FROM campaigns')) return [campaign];
  if(sql.includes('FROM campaign_recipients'))return [{id:'recipient',destination:'+64211234567',rendered_body:'Hi'}];
  return [];
 });
});
it.each([{senderId:'sender',senderLabel:'Spoofed'},{test:true,testDestination:'+64211234567'},{sendCampaign:true}])('rejects another account’s campaign sender: %j',async body=>{
 const response=await PATCH(new NextRequest('http://localhost/api/campaigns/campaign',{method:'PATCH',body:JSON.stringify(body)}),{params:Promise.resolve({id:'campaign'})});
 expect(response.status).toBeGreaterThanOrEqual(400);expect(mocks.deliver).not.toHaveBeenCalled();
 expect(mocks.sql.mock.calls.some(([parts])=>parts.join('').includes('UPDATE campaigns'))).toBe(false);
});
it.each([null,'someone-else'])('never processes a campaign with invalid stored authorisation: %s',async owner=>{
 campaign.status='pending';campaign.send_authorized_user_id=owner;
 const result=await processCampaignQueue('campaign');
 expect(result.processedCount).toBe(0); expect(mocks.deliver).not.toHaveBeenCalled();
});
it('rejects a manual queue trigger from someone other than the sender owner',async()=>{
 campaign.status='pending';campaign.send_authorized_user_id='andrew';
 await expect(processCampaignQueue('campaign','reddyn')).rejects.toThrow(/own|permission/i); expect(mocks.deliver).not.toHaveBeenCalled();
});

it('delivers an authorised campaign using only its owner’s selected connection',async()=>{
 campaign.status='pending';campaign.send_authorized_user_id='andrew';
 const result=await processCampaignQueue('campaign');
 expect(result.processedCount).toBe(1);
 expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({strictSmsgateConnection:true,provider:'smsgate',to:'+64211234567'}));
});
it('stops an authorised campaign if its connection is disconnected',async()=>{
 campaign.status='pending';campaign.send_authorized_user_id='andrew';sender.connection_status='disconnected';
 expect((await processCampaignQueue('campaign')).processedCount).toBe(0);expect(mocks.deliver).not.toHaveBeenCalled();
});
