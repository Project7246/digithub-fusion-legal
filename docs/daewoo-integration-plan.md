# Daewoo courier integration plan - 6 Nov 2026

Status: portal client and private diagnostics built, tested offline. No Daewoo
adapter registered, account created, schema or live setting changed.
Owner wants the same Fusion courier screens and behavior, with a Daewoo-specific
implementation underneath. Owner confirms only the supplied API guide is offered
in the merchant portal and there is no webhook. Credentials must stay private.

## Current settlement model - owner clarification, 7 Nov 2026

Owner clarified that COD/CPR invoices and delivery/tax invoices are separate.
Daewoo deducts applicable service/tax invoices when making a payment. This
supersedes the earlier interpretation that one CPR must equal its parcel COD
minus that same document's charges/taxes. Different figure comparisons alone
are not proof of an accounting discrepancy. No source numbers were adjusted.

Implemented in daewoo-finance.js, with synthetic checks written first:
- Typed COD, delivery and tax documents remain separate, scoped by realm,
  courier account and portal customer. No matching by amount/date/number similarity.
- A payment has explicit allocations to one or more source documents; COD
  allocations add, delivery/tax allocations deduct. No allocations means UNVERIFIED.
- Partial allocation and remaining invoice balances are preserved. Duplicate
  documents/payments/links, foreign scope, unknown links, over-allocation and
  missing/invalid money refuse calculation. Exact BigInt paisa, no float subtraction.
- A tax document must explicitly state whether it is a separate deduction or a
  breakdown already included in a delivery invoice. Included tax cannot be
  allocated again. Source mappings must establish this, never guess it.
- MATCH describes declared allocation arithmetic only. Outstanding documents are
  reported separately; bank receipt is not verified and posting remains disabled.

compareInvoiceFigures replaces the misleading reconcileInvoice name. Its
comparisons are diagnostic facts only; settlementStatus is always NOT_CHECKED.
The private helper now says DOCUMENT_LINKS_REQUIRED rather than deriving a
settlement error or success from a cover/detail comparison. No rerun needed.

Portal client now exposes financialRows using the observed GetFinancialReport
contract. It preserves Service_invoice_no, Payment_invoice_no, payable and paid
fields separately, including null. No implicit deduction or payment is created.

Read-only native portal inspection (same selected customer) loaded Customer Ledger
and COD Invoice (Services) and exported both privately to owner's Downloads:
- Ledger columns: Date /Time, Details, Reimbur. Amount, Paid Amount, Balance.
  Full export has invoice and bank-paid descriptions. Bank-paid descriptions do
  not carry the observed invoice-number pattern; allocation references unverified.
  The requested month returned a much longer ledger: date-filter behavior is not
  assumed. Keep complete source coverage separate from requested period.
- Service report columns: date, consignment, route, weight, Service Ch, Fuel Adj.,
  GST Amount, Total Service Ch. No invoice reference or RST/WHT column in that
  export. Two rows do not satisfy service+fuel+GST=total even at displayed paisa;
  do not label a source error or change figures without row status/basis evidence.
- Source exports remain private, unchanged and outside git. No raw records,
  amounts, customer names or IDs are recorded in fixtures/docs.

Remaining before app attachment: verify the service-invoice identity and payment
allocation source (possibly payment advice/voucher), report date semantics and
complete order discovery/mapping. No adapter registration, UI integration,
financial posting, database/schema/env change or migration reservation in this step.

## Read-only verification results - 6 Nov 2026

### Earlier figure-comparison checkpoint - superseded by owner settlement clarification

Updated owner-supplied PDF supersedes the clipped copy: both RST and WHT columns
and the printed reimbursement/service/payable header are now visible. Same invoice
identity matched the earlier private summary XLSX. Exact Decimal comparisons still
show COD different and service charges matching. Neither adding nor subtracting
both visible tax totals explains the summary COD difference; subtracting service
charges and both taxes from printed COD also does not match summary reimbursement.
Summary cover arithmetic itself matches. This is evidence for an unresolved source
basis difference, not permission to invent an adjustment or infer a universal tax
rule. No new export or credential rerun is needed for this sample. No real figures,
names or IDs are stored. No code, financial posting, adapter or live settings changed
for this updated-PDF review.


Owner supplied the invoice PDF directly after the helper returned NOT_PDF. Local
PDF inspection and comparison with the earlier private summary XLSX identified
the SAME invoice. Printed COD differs from the matching summary cover; service
charges match. The visible RST alone does not explain the difference. This does
not establish an upstream bug, a balancing adjustment, or a gross/net rule.
The first PDF was browser-generated with clipped right-hand columns; that limitation
is superseded by the updated-PDF review above. No private
figures, IDs or names are retained in these notes or synthetic fixtures.

Automatic print/export fetching and saving was removed from the diagnostic:
the response format remains unverified, and repeated credential reruns add no
evidence. Login/error/unknown bodies must not become arbitrary invoice files.
The low-level read-only transport method is retained, without any claim that its
bytes are a validated invoice. No unsupported format is accepted automatically.

reconcileInvoice now explicitly returns reconciliationRequired for differences,
missing figures/taxes or duplicate parcels, while leaving original inputs intact.
The diagnostic reports that state and FINANCIAL_POSTING=DISABLED. Even a matched
sample alone does not authorize posting. No Daewoo financial write route exists.

Removed the unjustified seven-day access clamp from reusable client and helper.
Only real ISO dates and from <= to are required. GetReport receives the caller's
full authorized range directly; no truncation, splitting or deduplication is added.
Monthly fixtures include first/last dates and week boundaries and compare a full
month with all non-overlapping partitions. Auth/session/customer/invoice checks,
response-size limits and fail-without-partial-results behavior remain unchanged.
Batching is a future operational choice, never a restriction on entitled history.
Actual live monthly server behavior has not been exercised by these fixtures.

Latest owner diagnostic: portal PASS, customer CONFIRMED, CPR READ_OK, COD DIFFERENT,
charges MATCH, cover arithmetic MATCH, taxes PRESENT and no duplicates in the sample.
This independently reproduces the native inspection's COD reconciliation exception.
No import or financial posting has happened; login/connectivity is not the blocker.

Public function.js printInvoice() confirms the same-session read-only GET export:
CODInvoiceSummaryReportPrint.aspx with invoiceNo, customer, isExport=1 and
isInvoiceExport=1. Client exposes that read-only transport. Its automatic diagnostic
use was stopped after NOT_PDF; its response format is not assumed from the URL.

The earlier automatic PDF-copy logic was removed; no unknown response was saved.
Synthetic transport tests still verify authenticated GET, exact query, preserved
bytes and unauthenticated refusal. Owner-supplied PDF findings are recorded above.

Owner subsequently reported DAEWOO_PORTAL=PASS and CUSTOMER_SCOPE=SELECTION_REQUIRED.
Fresh programmatic website login/session therefore worked from this PC; no invoice
data was read by that run because the returned customer list was not singular.
The diagnostic now keeps the session open and asks privately for a customer name
or ID. It only selects from that session's returned customers: exact name/ID first,
or a unique name fragment of at least three characters. Ambiguous input requests
the full label, without printing names/IDs or making report requests. Duplicate
IDs are collapsed; aggregate 0/-1 options are excluded. At most five local attempts
are allowed; it never guesses the first customer. Selected report/detail scope
checks remain unchanged. Synthetic exact/partial/ambiguous/foreign/empty/aggregate
selection fixtures pass. Actual chosen-customer report result is still pending.

Owner reran the private API checker and reported DAEWOO_API=PASS: documented
getLocations accepted their request from this PC. Earlier REJECTED is superseded
by this successful rerun; its original cause was not established. This still does
not establish authenticated API behavior from Singapore or complete portal access.

daewoo-portal.js now implements a private per-instance cookie session and only
observed read-only portal methods. Login uses AuthenticateUser followed by the
session check; customer and invoice identity are validated. No upstream errors,
cookie values, names, IDs or financial figures are printed by the diagnostic.
It refuses redirects and responses over 4 MB and preserves the full requested
authorized date range. No session renewal loop, background timer or data writes exist.

Run the existing checker with --portal --from YYYY-MM-DD --to YYYY-MM-DD for a
private WEBSITE username/password prompt, session/customer validation, cover read
and one invoice-detail comparison. Output contains only fixed status/match flags.
It does not correct the discrepancy or treat cover arithmetic as bank receipt.
No writes to Banking or QuickBooks are performed. Actual portal-run result pending.

tools/daewoo-portal-check.mjs uses only synthetic HTTP/session and money fixtures:
cookies, nested wrappers, session expiry, sanitized failures, scope mismatches,
bounded dates, exact paisa arithmetic, missing values and reconciliation exceptions.
Registered in check:all; 23 repository checks passed, with targeted checks rerun
after the final invoice-scope validation. Existing private API-input tests pass.

### Private API credential check for the owner

API Management exposes three credentials and has no Test button (owner confirmed).
tools/daewoo-connection-check.mjs runs the documented read-only locations request
from the owner's PC. Run with node; it has no package dependencies or PowerShell
execution-policy changes. It prompts for all three values with fully muted input
and no input history. No values go into arguments, files, echoed URLs or errors.
It uses a fixed HTTPS host, refuses redirects, times out after 25 seconds and
prints only DAEWOO_API / HTTP_STATUS status lines. Never paste credentials in chat.

Offline --self-test checks nine success/rejection/schema fixtures and that hidden
input preserves punctuation without echo. PASS means this locations request was
accepted from the PC; it does not verify app-server API auth, portal login or CPRs.
Owner ran the private check and reported DAEWOO_API=REJECTED. The reply passed
the expected boolean Success/Error envelope but indicated rejection. This does
not isolate a wrong password, key, user, account state or access policy. Helper
now also emits DAEWOO_REASON as a fixed category inferred from Response/ResponseDetail;
raw upstream text never leaves the diagnostic. Mixed key/password messages remain
ambiguous. Updated self-test covers 9 response + 11 reason + hidden-input checks.
Use API Management's USER PASSWORD, which is not assumed to equal portal login.
No actual values are recorded; another private run is needed for the safe reason.

### Singapore container connectivity - subsequently verified

Opened the existing DigitalOcean app's web-service console. UI confirmed Healthy
and SGP1. A one-off credential-free Node fetch from the running container returned:

- Portal public financial-report script: HTTP 200.
- API host root https://codapi.daewoo.net.pk/: HTTP 403.

The portal is reachable from the live application, including validated HTTPS.
The API host also returned an HTTP response, so this was not a DNS/TCP/TLS timeout.
However a root-path 403 does NOT establish whether a documented authenticated API
endpoint works, nor whether the merchant's credentials are valid. No credentials,
environment variables or database records were read by the probe. No settings,
deployments or application files were changed in the container. This supersedes
the earlier SGP1-not-tested checkpoint below; authenticated API testing is pending.

Console paste caveat: pasted input acquired literal bracketed-paste markers.
Removed the six-character prefix and trailing marker before execution. Browser
Ctrl+E targets its search bar, so use terminal End after restoring terminal focus.
Verify the settled terminal buffer before Enter; do not execute the paste wrapper.

Verified after the initial plan, using the signed-in portal and its public scripts:

- Native report and invoice-detail UI works. Invoice cover Excel download completed;
  downloaded XLSX passed ZIP/workbook/worksheet checks and contains the expected
  invoice, period, date, COD, service-charge and reimbursed-amount headers.
  Export remains private in Downloads; no contents copied into this repository.
- Public script assets/js/globalJs.js sets Admin.asmx/ as its service base. Calls
  are POST JSON with application/json; charset=utf-8 and a response .d envelope.
  Some methods return nested JSON strings; others return arrays/objects directly.
- assets/js/pages/financial-report.js calls GetCustomersNew and GetFinancialReport.
  Financial request keys: fromDate, toDate, customerId. response.d.Data is parsed
  with JSON.parse. Actual fields include booking_id, BarCode, reference_no,
  booking_datetime_f, SourceTerminal, DestinationTerminal, status, StatusDate,
  invoice_status, Service_invoice_no, Payment_invoice_no, amount_cod, amount_wr,
  AmountToPaid, AmountPaid2 and invoice_no.
- assets/js/pages/master.js creates a browser-side DataTable with Copy/Excel/PDF.
  Financial script adds the entire returned array locally; no server paging keys
  are sent by that flow. Bounded resumable date windows are required.
- Public assets/js/function.js defines invoice covers via Admin.asmx/GetReport,
  keys fromDate/toDate/customerId. Success is response.d.Success; Data is an array.
  Cover fields: invoice_no, customer_id, invoice_period_start_date,
  invoice_period_end_date, invoice_date, TotalCODAmount, TotalServiceCharges,
  TotalReimbursementAmount. Dates use the ASP.NET /Date(...)/ representation.
- Detail uses Admin.asmx/GetDetailReport with invoiceNo/customerId. Fields include
  booking_id, Barcode, booking_datetime, STI, BTN, weight, amount_wr, amount_cod,
  RST_Amt, RWHT_Amt and portal_ref_invoice. Separate tax fields are confirmed.
- Date-wise discovery uses Admin.asmx/LoadDatewiseReport with reportMode,
  fromDate/toDate/reportType. Source explicitly uses reportMode 4 for custom dates;
  includes separate manual/API booking tabs. Data is returned directly as .d;
  session expiry can be the literal User Session Expired!, not an empty array.
- Without browser credentials, FinancialReport.aspx redirects to Login.aspx and
  the read-only Admin.asmx/CheckUserSession call rejects the session. Login page
  uses assets/js/pages/login.js: Admin.asmx/AuthenticateUser with userName/password.
  CheckUserSessionUpdated and SessionExpired handling exist in the newer wrapper.
  Fresh programmatic authentication has NOT been attempted with real credentials.
- Reimbursement report type controls are COD Invoice (Services) and COD Customer
  Ledger. This confirms separate service-invoice/ledger routes in the UI; their
  loaded report output and full accounting meaning remain to be verified.

Private arithmetic checks used integer paisa and emitted booleans only. Observed
invoice cover arithmetic reconciled internally. The selected detail's row count,
COD, charges and both tax sums matched its own footer; its COD did NOT reconcile
to its matching cover, including the tested subtraction of displayed taxes.
This is a verified reconciliation exception, not a proven upstream bug or a
justification to change the courier's figures. Do not infer a universal deduction
policy from the selected covers, which did not exercise a nonzero service-charge
deduction. Preserve authoritative covers and detail separately with an exception.

Still unverified: API-key authentication/current API behavior, server-side fresh
portal login/session renewal, customer-scope enforcement by the upstream service,
report date boundaries/completeness across periods, separate service/ledger output,
bank-paid semantics and the cover/detail discrepancy. SGP1 connectivity was not
tested: Computer Use stopped the DigitalOcean-tab switch because it could not
confidently establish the browser URL. No claim of full end-to-end readiness.

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
| FinancialReport.aspx | Owner opened the Financial Summary/report; observed CN/barcode/ref/date/status, Payment Status, Service Invoice #, Payment Invoice #, COD, Service Charges, Amount to be paid, Amount Paid and Invoice #; Copy/Excel/PDF | Primary candidate for payment-vs-charge reconciliation; field semantics/totals still unverified |
| QSRSummaryReport.aspx | QSR Summary menu link | Optional operational cross-check; not yet inspected |

These are observed page URLs, not verified JSON API endpoints. Invoice existence
or a column named reimbursed does not by itself prove bank receipt or settlement.

Owner clarification: prioritize the Financial Summary CPR and delivery-charge
sources they opened, rather than loading the very large individual-parcel report.
Native UI inspection confirmed the FinancialReport.aspx columns above, without
reloading the dataset or outputting private records. Keep payment-invoice and
service-invoice references separate. Do not combine invoices merely because
their numbers look alike, or subtract service charges again from an already-net
payment. Payment status, payable amount and paid amount need separate mappings;
the visible status date is not automatically a payment/bank-receipt date.

Use invoice/CPR covers first and fetch parcel detail only for the selected document
when needed. Date-window discovery should use small resumable ranges, explicit
completeness checks and bounded page sizes. Visible Previous/Next controls can be
client-side only: verify the actual report request before claiming server-side
pagination, and do not repeatedly load the entire historical parcel dataset.

## Recommended architecture: portal reports plus tracking API

1. Add daewoo.js beside the existing courier adapters. Register it once in
   adapters.js. Set lists:false for the documented API, implement trackOne and
   refreshKnown, and expose only capabilities actually validated.
2. Use daewoo-portal.js for the portal's own authenticated read-only report flow.
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
  Owner confirms deduction at payment against separate invoices. adapters.js
  parcel-level deduction cannot represent this; explicit document/payment links
  are required before registering Daewoo financial totals.
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
5. Prioritize Financial Summary payment/CPR covers and delivery-charge invoices;
   reconcile their separate references and amounts first, then validate booking
   counts/status/COD and parcel linkage in bounded windows for the same period.
   Synthetic money fixtures must pass
   first; any real-account comparison is read-only and private.
6. Add tested settlement support only after its meaning/source is established.
   Match cover net, deductions, dates and linkage before Banking/Finance activation.
7. Run shared check:all plus Daewoo-specific contracts/import/reconciliation checks;
   verify existing PostEx/Trax/M&P behavior, deployment version and changed screens.

Outstanding: portal session automation, complete export semantics, current status
catalogue, settlement/charge/tax rules, invoice Action detail, report date semantics,
multi-customer ownership, rate limits and SGP1 connectivity. UI feasibility is
established; end-to-end automatic financial integration is not yet established.
