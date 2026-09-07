// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import JobCommunications from '@/components/JobCommunications';
const records = [
 { id:'email',source:'crm_email',channel:'email',renderedSubject:'Booking confirmation',renderedBody:'Saved email and signature',renderedHtml:'<p>Saved email</p><b>Original signature</b>',senderName:'Office',senderValue:'andrew@example.com',actorName:'Andrew Potter',destination:'customer@example.com',status:'sent',sentAt:'2026-09-07T01:00:00Z' },
 { id:'sms',source:'crm_sms',channel:'sms',renderedBody:'We will arrive at nine',senderName:'Reddyn mobile',senderValue:'+64273623220',actorName:'Reddyn Wallace',destination:'+64211234567',status:'accepted',sentAt:'2026-09-07T02:00:00Z' },
 { id:'manual',source:'job',channel:'email',renderedSubject:'Manual draft',renderedBody:'Not a confirmed send',destination:'customer@example.com',status:'launched',sentAt:'2026-09-07T03:00:00Z' },
] as const;
afterEach(cleanup);
function showHistory() { fireEvent.click(screen.getByRole('button', { name: 'Show all communications' })); }
it('shows only the newest message by default and expands older messages',()=>{
 const many=[...records, ...Array.from({length:6},(_,i)=>({...records[0],id:String(i)}))];
 render(<JobCommunications messages={many} />);
 expect(within(screen.getByRole('list',{name:'CRM-sent messages'})).getAllByRole('listitem')).toHaveLength(1);
 expect(screen.getByText('We will arrive at nine')).toBeTruthy();
 expect(screen.queryByText('Booking confirmation')).toBeNull();
 expect(screen.getByRole('status').textContent).toContain('Pending');
 expect(screen.queryByText(/Messages sent from the CRM/)).toBeNull();
 showHistory();expect(within(screen.getByRole('list',{name:'CRM-sent messages'})).getAllByRole('listitem')).toHaveLength(8);
 expect(screen.queryByRole('button',{name:/^All /})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Show latest only'}));
 expect(screen.queryByRole('searchbox')).toBeNull();
 expect(within(screen.getByRole('list',{name:'CRM-sent messages'})).getAllByRole('listitem')).toHaveLength(1);
});
it('shows CRM records newest first and distinguishes manual app launches',()=>{
 render(<JobCommunications messages={[...records]} />); showHistory();
 const list=screen.getByRole('list',{name:'CRM-sent messages'});
 const items=within(list).getAllByRole('listitem');expect(items[0].textContent).toContain('We will arrive at nine');expect(items[1].textContent).toContain('Booking confirmation');
 expect(within(list).queryByText('Manual draft')).toBeNull();expect(screen.getByText(/Opened in another app/)).toBeTruthy();
});
it('searches message contents and staff names',()=>{
 render(<JobCommunications messages={[...records]} />); showHistory();
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'Andrew Potter'}});expect(screen.getByText('Booking confirmation')).toBeTruthy();
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'missing phrase'}});expect(screen.getByText(/No messages match/)).toBeTruthy();
});
it('expands an email into its saved HTML once, with original sender and staff metadata',()=>{
 render(<JobCommunications messages={[...records]} />); showHistory();
 expect(screen.queryByTitle('Email preview')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/Booking confirmation/}));
 const frame=screen.getByTitle('Email preview');expect(frame.getAttribute('sandbox')).toBe('');expect(frame.getAttribute('srcdoc')).toContain('Original signature');
 expect(screen.getByText('andrew@example.com')).toBeTruthy();expect(screen.getByText(/Accepted by Gmail/)).toBeTruthy();
 expect(screen.queryByText('Saved email and signature')).toBeNull();
});
it('keeps an expanded SMS open while its status updates and shows failures',()=>{
 const {rerender}=render(<JobCommunications messages={[records[1]]} />);
 fireEvent.click(screen.getByRole('button',{name:/We will arrive/}));
 rerender(<JobCommunications messages={[{...records[1],status:'failed',failureReason:'Phone offline'}]} />);
 expect(screen.getByRole('button',{name:/We will arrive/}).getAttribute('aria-expanded')).toBe('true');expect(screen.getByText('Phone offline')).toBeTruthy();expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
});
it('retains saved records during a refresh failure and offers retry',()=>{
 render(<JobCommunications messages={[records[1]]} error="Could not refresh history" onRetry={()=>{}} />);
 expect(screen.getByRole('alert').textContent).toContain('Could not refresh history');expect(screen.getByText('We will arrive at nine')).toBeTruthy();expect(screen.getByRole('button',{name:'Try again'})).toBeTruthy();
});
it('does not imply the original campaign address is known when it was never saved',()=>{
 render(<JobCommunications messages={[{...records[0],source:'campaign',senderValue:'',senderName:'Office'}]} />);
 fireEvent.click(screen.getByRole('button',{name:/Booking confirmation/}));
 expect(screen.getByText(/Sending address wasn’t saved/)).toBeTruthy();
});

it('keeps the latest visible after collapsing a search that excluded it',()=>{
 render(<JobCommunications messages={[...records]} />); showHistory();
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'Andrew Potter'}});
 fireEvent.click(screen.getByRole('button',{name:'Show latest only'}));
 expect(screen.getByText('We will arrive at nine')).toBeTruthy();
 expect(screen.queryByText('Booking confirmation')).toBeNull();
});
it('shows an empty history without a redundant expansion control',()=>{
 render(<JobCommunications messages={[]} />);
 expect(screen.getByText('No CRM messages recorded yet.')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Show all communications'})).toBeNull();
});
