// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'campaign' }), useRouter: () => router }));
import CampaignPage from '@/app/jobs/campaigns/[id]/page';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(owned = true, failureReason = 'Campaign halted before delivery.', withFailures = false) {
  const campaign = { id: 'campaign', name: 'Follow up', status: 'halted', channel: 'sms', senderId: 'sender', recipientCount: 2 };
  const recipients = [
    { id: 'sent', status: 'sent', contactName: 'Sent customer', destination: '+64211111111' },
    { id: 'skipped', selected: true, status: 'skipped', contactName: 'Waiting customer', destination: '+64212222222', failureReason },
  ];
  if (withFailures) recipients.push(...['Alice', 'Bob', 'Cara'].map(name => ({ id: name, selected: true, status: 'failed', contactName: name, destination: '+64213333333', failureReason: 'Connection timed out' })));
  vi.stubGlobal('localStorage', { getItem: () => 'token' });
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('communication-senders')) return { ok: true, json: async () => ({ senders: owned ? [{ id: 'sender', isActive: true }] : [] }) };
    if (url.includes('communication-settings')) return { ok: true, json: async () => ({}) };
    if (init?.method === 'PATCH') return { ok: true, json: async () => ({ campaign: { ...campaign, status: 'pending' }, recipients: [recipients[0], { ...recipients[1], status: 'pending' }], sendResult: 'Campaign resumed.' }) };
    return { ok: true, json: async () => ({ campaign, recipients }) };
  });
  vi.stubGlobal('fetch', fetcher);
  render(<CampaignPage />);
  return fetcher;
}
it('confirms resume and updates delivery counts while preserving sent recipients', async () => {
  const fetcher = setup();
  const button = await screen.findByRole('button', { name: 'Resume Campaign' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/Messages already sent will not be resent/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Resume Campaign' }));
  expect(await screen.findByText('Campaign resumed.')).toBeTruthy();
  expect(screen.getByText('1 sent, 1 pending, 0 failed, 0 skipped.')).toBeTruthy();
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(init!.body as string))).toEqual([{ resumeCampaign: true }]);
  expect(screen.queryByRole('button', { name: 'Resume Campaign' })).toBeNull();
});
it('disables resume for another sender’s account', async () => {
  setup(false);
  expect((await screen.findByRole('button', { name: 'Resume Campaign' }) as HTMLButtonElement).disabled).toBe(true);
});
it('does not offer resume for unrelated skips', async () => {
  setup(true, 'Invalid destination');
  await screen.findByText('Delivery Records');
  expect(screen.queryByRole('button', { name: 'Resume Campaign' })).toBeNull();
});

it.each([
  { action: 'Retry Alice', ids: ['Alice'] },
  { action: 'Retry Selected (2)', ids: ['Alice', 'Cara'] },
  { action: 'Retry All Failed (3)', ids: ['Alice', 'Bob', 'Cara'] },
])('queues the right recipients with $action', async ({ action, ids }) => {
  const fetcher = setup(true, 'Campaign halted before delivery.', true);
  await screen.findByRole('button', { name: 'Retry Alice' });
  if (action.startsWith('Retry Selected')) {
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alice for retry' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Cara for retry' }));
  }
  const button = screen.getByRole('button', { name: action });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/already sent will not be resent/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Retry Failed' }));
  await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(init!.body as string))).toEqual([{ retryFailed: true, recipientIds: ids }]));
});
