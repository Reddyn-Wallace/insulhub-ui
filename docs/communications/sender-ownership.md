# Sending connection ownership — chunk 1

Connections reference the canonical Insulhub user ID in `communication_senders.owner_user_id`. User records stay in the canonical API. Creation derives ownership from authenticated `me`; client-supplied ownership is ignored. Unassigned connections are unavailable for human sends.

The owner alone can list, edit, delete, test, disconnect, reconnect, sync signatures, and use a connection for job or campaign sends. Defaults are scoped to owner and channel. Job message snapshots and campaign history remain shared under their existing read permissions. Manual SMS/email links and the CRM feature flag are unchanged.

Campaigns record `send_authorized_user_id` when an owner queues them. Each processing batch rechecks the current connection owner, channel, active state and connection status. A missing or invalid authorisation halts the campaign and skips pending recipients. Colleagues viewing a queued campaign poll its read endpoint; only the owner can explicitly process sends.

Gmail OAuth uses a random, ten-minute, single-use database grant, hashed at rest and bound to an HttpOnly browser cookie. The callback rechecks connection ownership. Selected human connections never fall back to deployment Gmail or SMS credentials. Existing automatic partner account and submission emails retain their separate system-sender policy.

## Migration and deployment

Run `npm run communication-ownership:migrate -- --dry-run` to verify the schema and reviewed assignments in a transaction that rolls back. Run without `--dry-run` before deploying the application. The migration checks all three exact sender IDs, addresses and current owners, and refuses unowned queued campaigns. It leaves other unassigned connections unavailable rather than guessing their owner.

Verified canonical staff IDs on 7 September 2026:

- Reddyn Wallace: `6965831ea5185b0a06b94bf4`; existing Reddyn email and SMS connections.
- Andrew Potter: `6a88b869e193712a0118eff5`; existing Andrew email connection.

Schema additions are compatible with the previous app version. Rolling back application code would restore the former shared-sender access, so prefer a forward fix for access-control problems. No messages, tokens or communication history are migrated or deleted.

## Validation

`npm test`: 751 tests passed plus the three communications script checks. Production build and targeted lint passed. Ownership tests cover cross-account listing and writes, owner assignment, defaults, job sends, campaign permissions and background authorisation, OAuth forgery/browser binding/replay/expiry, and deployment-credential fallback. The migration dry run passed against the configured production database.

No live messages are sent as part of automated verification. Production acceptance: Reddyn sees only his email/phone in settings and sender selectors; Andrew sees his email; another account cannot use either; previous sent job history is still visible. Provider sending and a real Google reconnect can be checked deliberately by the owner.
