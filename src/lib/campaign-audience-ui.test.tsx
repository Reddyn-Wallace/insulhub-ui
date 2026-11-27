// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'campaign' }), useRouter: () => router }));
vi.mock('@/lib/graphql', () => ({ gql: vi.fn(async (_query, variables?: { stages?: string[] }) => ({ users: { results: [] }, jobs: { results: [
  { _id: '1', jobNumber: 1, stage: 'LEAD', client: { contactDetails: { name: 'Previously sent', email: 'ALICE@example.com' } } },
  { _id: '2', jobNumber: 2, stage: 'LEAD', client: { contactDetails: { name: 'Eligible lead', email: 'bob@example.com' } } },
  { _id: '3', jobNumber: 3, stage: 'QUOTE', client: { contactDetails: { name: 'Quote customer', email: 'cara@example.com' } } },
  { _id: '4', jobNumber: 4, stage: 'COMPLETED', client: { contactDetails: { name: 'Completed customer', email: 'dana@example.com' } } },
  { _id: '5', jobNumber: 5, stage: 'COMPLETED', archivedAt: '2026-10-01', client: { contactDetails: { name: 'Archived customer', email: 'eli@example.com' } } },
].filter(job => variables?.stages?.includes(job.stage)) } })) }));
import NewCampaign from '@/app/jobs/campaigns/new/page';
import CampaignPage from '@/app/jobs/campaigns/[id]/page';
import Audience from '@/app/jobs/campaigns/[id]/audience/page';
import AudienceBuilder from '@/app/jobs/campaigns/[id]/audience-builder/page';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const campaign = { id: 'campaign', name: 'October campaign', channel: 'email', status: 'sent', recipientCount: 1 };
const recipient = { id: 'recipient', jobId: 'job', jobNumber: 1, contactName: 'Alice', destination: 'alice@example.com', address: 'Auckland', salespersonName: '', jobStage: 'LEAD', status: 'sent' };
function setup() { vi.stubGlobal('localStorage', { getItem: () => 'token' }); }
it('requires a non-blank name before creating a campaign', () => {
  setup(); render(<NewCampaign />);
  const name = screen.getByRole('textbox', { name: /Campaign name/ }) as HTMLInputElement;
  expect(name.required).toBe(true);
  fireEvent.change(name, { target: { value: '   ' } });
  expect((screen.getByRole('button', { name: 'Create Draft' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(name, { target: { value: 'October follow-up' } });
  expect((screen.getByRole('button', { name: 'Create Draft' }) as HTMLButtonElement).disabled).toBe(false);
});
it('renames a finished campaign', async () => {
  setup();
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => ({ campaign: init?.method === 'PATCH' ? { ...campaign, name: JSON.parse(init.body as string).name } : campaign, recipients: [recipient] }) }));
  vi.stubGlobal('fetch', fetcher); render(<CampaignPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Name' }));
  fireEvent.change(screen.getByRole('textbox', { name: /Campaign name/ }), { target: { value: '  Renamed campaign  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Name' }));
  expect(await screen.findByRole('heading', { name: 'Renamed campaign' })).toBeTruthy();
  expect(fetcher.mock.calls.filter(([,init]) => init?.method === 'PATCH').map(([,init]) => JSON.parse(init!.body as string))).toEqual([{ name: 'Renamed campaign' }]);
});
it.each(['pending', 'sending', 'sent', 'failed', 'halted'])('shows a searchable read-only audience for a %s campaign', async status => {
  setup(); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ campaign: { ...campaign, status }, recipients: [recipient] }) })));
  render(<Audience />);
  expect(await screen.findByText('Alice')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('link', { name: 'Back to Campaign' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Nobody' } });
  expect(screen.queryByText('Alice')).toBeNull();
});
it('combines inclusion filters with prior campaign exclusion and sends the exclusion rule when saving', async () => {
  setup(); const oldId = '11111111-1111-1111-1111-111111111111';
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/campaigns?')) return { ok: true, json: async () => ({ campaigns: [{ id: oldId, name: 'September campaign', channel: 'email', sentCount: 1, archivedAt: '2026-10-01' }] }) };
    if (url.startsWith('/api/campaigns/exclusions')) return { ok: true, json: async () => ({ recipients: [{ jobId: 'old-job', destination: 'alice@example.com', channel: 'email' }] }) };
    return { ok: true, json: async () => ({ campaign: { ...campaign, status: 'draft' }, recipients: init?.method === 'PATCH' ? [{ ...recipient, jobId: '2' }] : [] }) };
  });
  vi.stubGlobal('fetch', fetcher); render(<AudienceBuilder />);
  fireEvent.change(await screen.findByRole('combobox', { name: 'Status' }), { target: { value: 'LEAD' } });
  fireEvent.click(await screen.findByText('Choose campaigns to exclude'));
  fireEvent.click(await screen.findByRole('checkbox', { name: /September campaign/ }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Apply Filters' }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByText('1 jobs match the current filters. 1 excluded by prior campaigns.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Apply Filters' }));
  expect(screen.getByText('Eligible lead')).toBeTruthy();
  expect(screen.queryByText('Previously sent')).toBeNull();
  expect(screen.queryByText('Quote customer')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add Selected to Audience' }));
  await screen.findByText('1 new recipient added to the audience.');
  const body = JSON.parse(fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')![1]!.body as string);
  expect(body.excludedCampaignIds).toEqual([oldId]); expect(body.recipients.map((row: { jobId: string }) => row.jobId)).toEqual(['2']);
});
it('blocks filtering if a selected campaign’s history fails to load', async () => {
  setup();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/campaigns?')) return { ok: true, json: async () => ({ campaigns: [{ id: '11111111-1111-1111-1111-111111111111', name: 'Old campaign', channel: 'email', sentCount: 1 }] }) };
    if (url.startsWith('/api/campaigns/exclusions')) return { ok: false, json: async () => ({ error: 'History unavailable' }) };
    return { ok: true, json: async () => ({ campaign: { ...campaign, status: 'draft' }, recipients: [] }) };
  }));
  render(<AudienceBuilder />);
  fireEvent.click(await screen.findByText('Choose campaigns to exclude'));
  fireEvent.click(await screen.findByRole('checkbox', { name: /Old campaign/ }));
  await screen.findByRole('alert');
  expect((screen.getByRole('button', { name: 'Apply Filters' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Add Selected to Audience' }) as HTMLButtonElement).disabled).toBe(true);
});

it('refreshes delivery records without automatically processing a running campaign', async () => {
  setup(); vi.useFakeTimers();
  let status = 'sending';
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({
    campaign: { ...campaign, status, senderId: 'sender' },
    recipients: [{ ...recipient, status: status === 'sending' ? 'pending' : 'sent' }],
    senders: [{ id: 'sender', isActive: true }],
  }));
  vi.stubGlobal('fetch', fetcher);
  render(<CampaignPage />);
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByRole('heading', { name: 'Delivery Records' })).toBeTruthy();
  const campaignRequests = () => fetcher.mock.calls.filter(([url]) => url.startsWith('/api/campaigns/campaign'));
  await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
  expect(campaignRequests()).toHaveLength(1);
  status = 'sent';
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(campaignRequests().map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
    ['/api/campaigns/campaign', 'GET'], ['/api/campaigns/campaign', 'GET'],
  ]);
  expect(screen.getByText('1 sent, 0 pending, 0 failed, 0 skipped.')).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(6 * 60_000));
  expect(campaignRequests()).toHaveLength(2);
});

it('adds completed jobs to an email audience when explicitly selected', async () => {
  setup();
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => ({
      campaign: { ...campaign, status: 'draft' },
      recipients: init?.method === 'PATCH' ? [{ ...recipient, jobId: '4', jobStage: 'COMPLETED' }] : [],
    }),
  }));
  vi.stubGlobal('fetch', fetcher);
  render(<AudienceBuilder />);
  await screen.findByText('3 jobs match the current filters.');
  fireEvent.click(screen.getByRole('button', { name: 'Apply Filters' }));
  expect(screen.queryByText('Completed customer')).toBeNull();

  fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'COMPLETED' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply Filters' }));
  expect(screen.getByText('Completed customer')).toBeTruthy();
  expect(screen.queryByText('Archived customer')).toBeNull();
  expect(screen.queryByText('Eligible lead')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add Selected to Audience' }));
  await screen.findByText('1 new recipient added to the audience.');
  const patch = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1];
  expect(JSON.parse(String(patch?.body))).toMatchObject({
    mode: 'add', recipients: [{ jobId: '4', jobStage: 'COMPLETED', destination: 'dana@example.com' }],
  });
});
