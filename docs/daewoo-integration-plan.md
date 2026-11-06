# Daewoo courier integration plan - 6 Nov 2026

Status: analysis only. No Daewoo adapter, account, schema or live setting changed.
Owner wants the same Fusion courier screens and behavior, with a Daewoo-specific
implementation underneath. Owner confirms only the supplied API guide is offered
in the merchant portal and there is no webhook. Credentials must stay private.

## Evidence reviewed

- Supplied local COD Home Delivery API PDF: 16 pages. Filename says Version 1.3;
  cover and page headers say Version 1.6, updated 8 September 2021.
- Existing adapters.js, couriers.js, statuses.js, wire.js, keeper.js,
  courierlive.js, reach.js and targeted Trax/M&P/PostEx portal code.
- Signed-in merchant portal inspected through native Chrome UI, read-only:
  https://codportal.daewoo.net.pk/Index.aspx
- No API credentials revealed, no bookings/cancellations made, no report records
  exported or inserted. Menu/form/column inspection does not prove report totals,
  successful background login, server reachability or a stable private endpoint.

## Documented API capabilities

| Operation | Purpose | Proposed use |
|---|---|---|
| GET /api/cargo/getLocations | Available destination terminals | Connection test and service areas |
| POST /api/booking/quickBook | Book from one location | Outside initial reporting/connection scope |
| POST /api/booking/quickBookV3 | Book from multiple locations | Outside initial scope |
| GET /api/booking/quickTrack | Look up an already-known tracking number | Tracking updates |
| POST /api/booking/quickCancel | Cancel a consignment | Outside initial scope |
| POST /api/booking/quickCalculateRate | Quote a service charge | Optional estimate, never actual paid charges |

Guide base: https://codapi.daewoo.net.pk/
Authenticated calls use API key, API user and API password in query parameters.
Tracking is documented with trackingNo only. Tracking success therefore does not
prove the saved API credentials work or that a parcel belongs to this merchant.

The guide documents no date-range shipment list, payout/CPR API, bulk tracking,
payment notification, rate limit or webhook contract. Absence here does not prove
that Daewoo has no other internal reporting service. No replacement current API
contract was independently verified.

## Portal capabilities actually observed

| Portal page | Observed UI | Integration role |
|---|---|---|
| DatewiseBookingReport.aspx | Date-wise report, Load Report, Excel/Copy/PDF; Booking #, Barcode #, Web Track code, booking date, quantity, weight, COD, service charges, total amount, current status, source/destination, invoice | Discover consignments, backfill and compare totals |
| CODInvoiceSummaryReport.aspx | Date/customer filters, Excel/Copy/PDF; invoice number/period/date, total COD, total service charges, total reimbursed amount, Action | Candidate invoice/settlement covers; meaning and detail still require verification |
| CODReimburseDet.aspx | Customer COD Reimburse Detail Report; dates, terminals, status, customer, products, report type and Load Report | Candidate parcel-level reconciliation; actual output not loaded |
| FinancialReport.aspx | Financial Summary menu link | Further source to inspect, not yet validated |
| QSRSummaryReport.aspx | QSR Summary menu link | Optional operational cross-check; not yet inspected |

These are observed page URLs, not verified JSON API endpoints. Invoice existence
or a column named reimbursed does not by itself prove bank receipt or settlement.

## Recommended architecture: portal reports plus tracking API

1. Add daewoo.js beside the existing courier adapters. Register it once in
   adapters.js. Set lists:false for the documented API, implement trackOne and
   refreshKnown, and expose only capabilities actually validated.
2. Add daewooportal.js for the portal's own authenticated read-only report flow.
   Use it for date-range discovery, historical imports and financial reports.
   Existing Trax/PostEx integrations already separate API and merchant-portal login.
3. Verify how the report forms submit before implementing the portal reader:
   cookies, redirects, hidden state/anti-forgery tokens if present, pagination,
   date boundaries and export contents. Do not guess endpoints from .aspx names.
   Prefer the portal's actual report/export requests, not a permanently running
   desktop browser or a new browser server.
4. If automated portal sign-in/report reading cannot run reliably, provide a
   validated Excel/CSV import using these same exported report formats. Clearly
   identify this as manual discovery; tracking updates alone cannot discover new
   consignments. Do not promise fully automatic history before this is resolved.
5. Keep the same account form, sidebar disclosure, account child rows, courier
   overview, parcel/status/city/date filters and exports. Derive names/capabilities
   from the registry; fix existing hardcoded three-courier name maps where needed.
   API credentials and portal login are distinct until proven otherwise.
6. Use existing company/account/order/CPR storage and company-scoped services where
   their contracts fit. New routers live in their own module; server.js registers
   them rather than gaining another block of feature code.

## Field and status rules

| Daewoo field | Fusion interpretation |
|---|---|
| track_no / Booking # | tracking, subject to agreement between reports and API |
| order_id | orderRef; preserve string and leading zeros |
| Barcode # / web_track_code | Separate identifiers, never substituted silently for tracking |
| amount_cod / COD Amount | Parcel COD, not a payout |
| booking_date_time / Booking Date | bookedOn |
| receiver_city / Destination | Validate terminal vs destination city before city mapping |
| tweight / Total Weight | Weight; verify units and total-vs-piece meaning |
| status_name and TrackingDetails | Original wording plus Daewoo bucket mapping |
| Portal Service Charges | Reported charge; tax inclusion requires evidence |
| Invoice number | Candidate document reference; not automatically a CPR/payment ID |

Tracking JSON has a Result wrapper and arrays despite the field table describing
objects. The outer Status in the sample belongs to a task-style wrapper, not to
the parcel. Require explicit inner Success/Error validation, not merely HTTP 200.

The sample contradicts itself: header says Booked while events include Delivered,
and header/event tracking identifiers differ. Reject mismatched identities rather
than attaching another parcel's delivery. Agree authoritative status precedence
using consistent report/API examples; do not trust sample array order. Parse
documented/observed timestamp formats explicitly in Asia/Karachi, distinguish
ambiguous dates, and preserve source timestamps. Late/stale responses must not
erase newer delivery/return information. Unknown statuses remain visibly unmapped.

## Financial correctness gates

- Delivered, COD collected, invoice generated, reimbursed and bank-received are
  different states. Track them separately; do not mark paid from delivery alone.
- Confirm CODMode/payment_mode_name, service-charge deduction vs separate invoice,
  GST/withholding/adjustments, return charges and the meaning of Total Amount.
  adapters.js currently assumes charges are deducted unless deducts:false; neither
  choice is safe for Daewoo until its actual merchant terms and reports agree.
- quickCalculateRate is a quote, not final charge or proof of deduction.
- Missing charge/tax/settlement data is unavailable, not zero. Existing saveOrders
  uses zero defaults and preserves earlier nonzero fees; an availability contract
  is needed before enabling Daewoo financial totals. Do not put essential coverage
  flags only in raw payloads that housekeeping can discard.
- Keep financial covers even if parcel detail is incomplete. Show linked/missing
  counts and reconcile cover totals separately; never invent CPR rows from guesses.
- Use NUMERIC/integer paisa and existing audit/reversal rules. No automatic bank
  or QuickBooks posting until actual settlement details reconcile exactly.

## Security, duplicates and compute

- First adapter field can hold the API key under the existing encrypted token
  storage; API user/password belong in encrypted extra credentials. Portal cookies
  and passwords also remain server-side, isolated by realm and account.
- Credentials in query strings require redaction in every error, redirect, debug
  response and log; never return upstream request URLs or echoed secrets. Use HTTPS
  and fixed approved hosts; check redirects before forwarding credentials.
- Public tracking does not prove merchant ownership. Discover parcel numbers from
  an authenticated merchant report/export, not guessed numbers or numeric ranges.
  Resolve account/customer ownership before importing or refreshing a new parcel.
- Upsert by realm + account + tracking. Repeat report windows/imports must be
  idempotent; overlapping merchant logins/subaccounts need an explicit scope rule.
- No webhook URL advertised. Existing no-list keeper text assumes webhooks bring
  new orders, so capability-aware wording and discovery are required for Daewoo.
- Reuse the compute-budgeted scheduler; batch report discovery, refresh moving
  parcels with bounded concurrency/backoff and stop conditions. No unmetered timer
  or one-request-per-order financial sweep. Re-read compute-budget notes before
  implementing scheduling. Check connectivity from the live SGP1 app, not just PC.
- No database migration reserved during planning. If persistent capability or
  reconciliation fields need a migration, reserve the next free number first.

## Implementation order and acceptance

1. Validate private portal login flow, customer selection, report requests, full
   export/pagination and financial detail. Confirm API credentials and current
   contract privately; do not ask owner to paste secrets into chat.
2. Build synthetic contract tests before adapter code: nested success/failure,
   malformed/missing records, conflicting identifiers, status chronology, Pakistani
   dates, leading-zero IDs, zero-vs-missing figures, decimal money and auth expiry.
3. Implement connection/service-area test, parser and portal discovery. Validate
   repeated imports, overlapping dates, separate accounts/companies and partial
   failure recovery. Do not accept a partial report as a complete successful sync.
4. Enable shared courier UI with capability-aware actions. Date pull appears only
   when portal listing works; otherwise provide explicit report import. Keep the
   same styling/navigation and existing access/money restrictions.
5. Reconcile booking counts/status/COD/charges, then financial covers and parcel
   linkage against the same report period. Synthetic money fixtures must pass
   first; any real-account comparison is read-only and private.
6. Add tested settlement support only after its meaning/source is established.
   Match cover net, deductions, dates and linkage before Banking/Finance activation.
7. Run shared check:all plus Daewoo-specific contracts/import/reconciliation checks;
   verify existing PostEx/Trax/M&P behavior, deployment version and changed screens.

Outstanding: portal session automation, complete export semantics, current status
catalogue, settlement/charge/tax rules, invoice Action detail, report date semantics,
multi-customer ownership, rate limits and SGP1 connectivity. UI feasibility is
established; end-to-end automatic financial integration is not yet established.
