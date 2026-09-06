# Stage one: SMS from jobs

Manual Text and Email remain available. CRM SMS is an additional action, disabled by default.

## Production review

1. In Jobs → Settings → Communication Settings, users with access to the existing campaign settings can enable **CRM SMS sending** under **SMS from jobs**. This saves immediately and does not change campaign limits.
2. Open a designated test job whose contact number is your test phone. Choose **Send SMS from CRM**, select a connected SMS Gateway sender, select/edit a template or write a blank message, then send.
3. Verify the received number and exact text. Open communication history to inspect the saved sender/staff member, body, recipient and status. **Accepted by SMS service** does not mean delivered.
4. Use **Check message status** in the composer or the historical record. Reload the page: the latest attempt is retained in that browser tab and is not submitted again.
5. Verify the original Text and Email buttons still open their manual templates/apps.
6. Disable CRM SMS in settings and reload the job. Manual actions and historical records remain available; history status checks still work.

No incoming reply capture is included. An uncertain attempt is never automatically resent. If the browser could not confirm whether submission began, **Recover original send attempt** explicitly reuses the same immutable attempt ID. Provider lookup errors do not prove that a text was not sent; check the sending device before sending manually.

## Deployment and verification

- Run `npm run job-sms:migrate` against the configured overlay database **before deploying**. The additive, repeatable migration creates only `job_sms_messages` and its index. It never enables sending. Fresh overlay provisioning includes the same schema.
- `npm run test:job-sms` covers validation, duplicate claims, access/feature restrictions, provider errors and composer recovery.
- `npm run test:communications` checks the existing campaign delivery code.
- `npm run build` verifies the production build.
- Run the production preview on port 3108, then `npm run test:job-sms-browser`. The browser check uses installed Chrome and intercepts all business APIs, so it sends no real texts. `SMS_SMOKE_BASE_URL` can select another localhost port.

Messages retain sender snapshots if connection details change. Status lookup uses the sender's current connection; if the connection is removed or changed, the sending device may need to be checked directly. New sends use only that sender's configured credentials, never a fallback account/device.
