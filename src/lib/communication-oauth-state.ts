import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { overlaySql } from './overlay-db';

export const GMAIL_STATE_COOKIE = 'insulhub_gmail_state';
export const GMAIL_STATE_PATH = '/api/communication-senders/gmail/callback';
export const GMAIL_STATE_TTL_SECONDS = 600;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

// Stored state grants only the connection owner’s previously authenticated request.
// The browser cookie also prevents another browser completing that request.
export async function createGmailState(senderId: string, ownerUserId: string) {
  const state = randomBytes(32).toString('base64url');
  await overlaySql`DELETE FROM communication_oauth_states WHERE expires_at <= now()`;
  await overlaySql`INSERT INTO communication_oauth_states (state_hash,sender_id,owner_user_id,expires_at)
    VALUES (${hash(state)},${senderId},${ownerUserId},${new Date(Date.now()+GMAIL_STATE_TTL_SECONDS*1000).toISOString()})`;
  return state;
}

export async function consumeGmailState(state: string, cookie?: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || state !== cookie) return null;
  const rows = await overlaySql`DELETE FROM communication_oauth_states
    WHERE state_hash=${hash(state)} AND expires_at > now()
    RETURNING sender_id,owner_user_id`;
  return rows[0] as {sender_id:string;owner_user_id:string} | undefined ?? null;
}
