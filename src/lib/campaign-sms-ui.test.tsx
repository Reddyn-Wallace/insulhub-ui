// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'campaign' }), useRouter: () => router }));
import CampaignPage from '@/app/jobs/campaigns/[id]/page';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('shows a queued phone message as awaiting confirmation with its warning and no retry action', async () => {
  vi.stubGlobal('localStorage', { getItem: () => 'token' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok:true,json:async()=> url.includes('communication-senders') ? {senders:[{id:'sender',isActive:true}]} : url.includes('communication-settings') ? {} : {
    campaign:{id:'campaign',name:'Follow up',status:'sending',channel:'sms',senderId:'sender',recipientCount:1},
    recipients:[{id:'recipient',status:'pending',selected:true,contactName:'Customer',destination:'+64211234567',providerMessageId:'provider-id',failureReason:'Awaiting phone confirmation. Check SMSGate.'}]
  }})));
  render(<CampaignPage/>);
  expect(await screen.findByText('Awaiting phone confirmation')).toBeTruthy();
  expect(screen.getByText('Awaiting phone confirmation. Check SMSGate.')).toBeTruthy();
  expect(screen.getByText('0 sent, 1 pending, 0 failed, 0 skipped.')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Retry Customer'})).toBeNull();
});
