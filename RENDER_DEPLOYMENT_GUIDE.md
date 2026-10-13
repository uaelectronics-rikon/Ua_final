# Render Deployment Guide — UA Electronics

## Checkout fix status

The active checkout handler is inline in the root `index.html`; the root
`checkout.js` file is not loaded by that page. The server now persists an
order before responding and processes receipt/PDF work asynchronously. The
online-payment path still requires server-side Razorpay verification.

These changes are local until they are committed to the deployment repository
and deployed. No production deployment or purchase was performed as part of
this change.

## Production prerequisites

1. **Use durable storage before deploying the new order-writing code.**
   `render.yaml` currently configures a free web service with no persistent
   disk. Orders, payment intents, user data, the email retry queue, and PDF
   receipts must survive instance replacement. Attach a Render persistent disk
   to a plan that supports it, mounted at `/var/data/ua-electronics`, and set:

   | Variable | Value |
   | --- | --- |
   | `UA_DATA_DIR` | `/var/data/ua-electronics` |
   | `UA_ORDERS_PDF_DIR` | `/var/data/ua-electronics/Orders` |

   Migrate and verify existing production files on that disk before routing
   traffic to the updated service. Do not let the service initialize empty
   production order/user stores over the expectation that old data will appear
   automatically. Keep an independently restorable backup. This file-backed
   storage design must remain on one service instance; do not scale it to
   multiple instances.
2. **Set provider secrets in Render's Environment settings only.** Configure
   `EMAIL_USER`, `EMAIL_PASS`, `RAZORPAY_KEY_ID`, and `RAZORPAY_KEY_SECRET` as
   appropriate. Never place their values in Git, source files, documentation,
   logs, or browser code. A credential was found embedded in the previous
   version of this guide; revoke/rotate it and audit its use before production
   deployment.
3. Confirm the Render service uses the repository containing the reviewed
   changes, `npm install` as the build command, and `npm start` as the start
   command. The service's health check is `/`.
4. Verify the existing `data/products.json` catalog and shipping configuration
   before checkout testing. The catalog currently does not define stock
   quantities, so quantity-based stock enforcement only applies when catalog
   stock fields are present.
5. Take a secured backup of the current production data before the migration.
   Preserve a known-good deployment/revision for rollback.

## Safe release procedure

1. Run the local checks listed below. Use a staging service and test products,
   test email configuration, and Razorpay test mode. Never place an automated
   real-customer order or use live payment credentials in tests.
2. Prepare the persistent disk and migrate existing order, user, payment
   intent, email queue/log, and PDF data. Verify the migrated data before
   changing the service's data-directory environment variables.
3. Deploy from the intended Git revision to staging. Do not deploy by
   uploading files manually or by changing the live site directly.
4. Verify COD and Razorpay test-mode checkout end to end, then deploy the same
   revision to production during a monitored release window.
5. Keep the previous release and the pre-migration data backup available until
   order status, admin order access, receipt downloads, and email retries have
   been verified.

## Local validation

From the project directory:

```sh
node --check server.js
node --check email.js
node --check email-queue.js
node --test test/checkout-order.test.js test/razorpay-check.test.js
```

The checkout tests use temporary storage and fake email/payment services.
They do not create real orders or contact Razorpay.

## Verify checkout in Chrome DevTools

1. Open the staging site, open DevTools → **Network**, enable **Preserve log**,
   and complete a COD test order.
2. Inspect `POST /save-order`: a valid persisted order should return promptly
   with a successful status and server-calculated order details. Its response
   must not wait for email or PDF generation.
3. Confirm the confirmation UI displays the returned order ID and totals, the
   cart is cleared once, and the Place Order button is restored/disabled
   appropriately. A repeated click or retry with the same order ID must not
   create a second order.
4. Simulate a client timeout or disconnect only in staging. Resolve the
   outcome through the order-status request before retrying; a timeout alone
   does not mean the order failed.
5. Test card/UPI using Razorpay test mode. Confirm that the server verification
   request succeeds only for the matching captured payment, amount, currency,
   Razorpay order, and internal order. Do not trust a browser-only success
   callback.
6. Inspect purchase events in the browser analytics/debug tools and verify
   they are emitted once per order.

## Verify in Render

1. In **Events**, confirm the expected Git revision completed deployment.
2. In **Logs**, find the same test order ID and check the structured timings:
   `order.validated`, `order.persisted`, `order.http_response`, then the
   independent `order.pdf_*` and `order.email_*` events.
3. Check that `order.http_response` follows persistence without waiting for
   PDF/email completion. Notification errors should be logged and retried;
   they must not change the already-confirmed order response.
4. Confirm the order and its post-processing state remain present after a
   service restart, and confirm PDF and email-queue data are on the mounted
   disk. Never copy customer data or secrets into public logs or tickets.
5. If email is intentionally slow or unavailable in staging, verify the
   customer still sees confirmation promptly and the email work remains
   queued/retryable.

## Rollback

1. If checkout or payment verification regresses, disable/roll back the
   application release to the last known-good revision using Render's deploy
   history. Do not delete or replace the persistent disk during rollback.
2. Keep the updated disk mounted and preserve all orders created since release.
   Older application revisions may not understand newer payment intent or
   outbox metadata; confirm backward compatibility in staging before rollback.
   If incompatible, keep checkout in maintenance mode while reconciling the
   data—never restore an old backup over newer production orders.
3. Verify health, checkout availability, admin order access, and the latest
   order IDs after rollback. Retain the failed revision and logs for diagnosis.
4. Rotate any credential that may have been exposed, then update it only in
   Render's Environment settings.

## Current limitations to resolve before production

- The current `render.yaml` specifies a free service and does not configure a
  persistent disk. A disk and data migration are release prerequisites, not
  optional performance improvements.
- The order store and outbox are JSON files, not a transactional database or
  external job broker. Keep one application instance and maintain verified
  backups.
- The product catalog currently has no stock quantity fields. Add and maintain
  authoritative inventory data before relying on quantity-based stock checks.
- The live website is not updated by local file changes. Confirm the live
  deployment revision and repeat the staging checks after production rollout.
