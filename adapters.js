// Every courier the app can speak to, in one place.
//
// This list used to be written out three times - in server.js, in keeper.js and
// in courierlive.js - so adding a courier meant remembering three lines, and
// forgetting one of them meant the page offered a courier the sweep then
// ignored. There is one list now and those three read it.
//
// What an adapter has to hand over is below. Everything after `groupOf` is
// optional: a courier that cannot be asked about one parcel simply has no
// trackOne, and the caller checks before using it.
//
//   key        what the row in courier_accounts says
//   name       what a person reads
//   fields     what has to be typed in to add an account. The FIRST field is
//              the account's token; the rest are kept encrypted beside it and
//              handed back to the adapter as `extra`
//   hook       where in that courier's portal our address goes
//   groupOf    their word for a parcel's state -> one of our buckets
//   testToken  proves a key before it is saved
//   fetchOrders(token, from, to, statusId, extra)
//   fetchPayment(token, tracking, extra)      - settlement, if they tell us
//   trackOne(token, tracking, extra)          - one parcel, if they allow it
//   fetchCprs(...)                            - PostEx's portal receipts only
//   fetchAreas(token, extra)                  - where they go, if they say

import { adapter as postex } from './postex.js';
import { adapter as trax }   from './trax.js';
import { adapter as mnp }    from './mnp.js';
import { readHook } from './hooks.js';
import { makeGrouper } from './statuses.js';

export const ADAPTERS = {
  postex: postex,
  trax:   trax,
  mnp:    mnp
};

// Which couriers take their charges out of the money they send us.
//
// Most do: PostEx and Trax both pay the COD less what they kept, so a parcel
// is worth `amount - fee - tax` to us. **M&P do not** - they pay the whole COD
// and invoice their charges separately - so netting their fee off would
// understate what they owe by exactly their charges, every month.
//
// The money queries build a SQL fragment out of this. The keys are our own
// identifiers from the files above, never anything typed in.
export function deductingCouriers() {
  return Object.values(ADAPTERS)
    .filter(a => a.deducts !== false)
    .map(a => a.key);
}

export function adapterFor(courier) {
  return ADAPTERS[String(courier || '').trim().toLowerCase()] || null;
}

// Daewoo was on this list as "soon" and is off it on purpose: nobody is
// working on it, and a courier shown greyed out for months reads as something
// broken rather than something not started. It comes back as a file beside
// trax.js on the day it is wanted.
export function courierKinds() {
  return Object.values(ADAPTERS).map(a => ({
    key: a.key,
    name: a.name,
    fields: (a.fields || [{ name: 'token', label: 'API token', secret: true }])
      .map(f => ({
        name: f.name,
        label: f.label,
        secret: !!f.secret,
        optional: !!f.optional,
        hint: f.hint || ''
      })),
    hook: a.hook || null,
    // false for a courier whose API cannot be asked for a span of days - Trax
    // is one, and the page says so rather than showing an empty week
    lists: a.lists !== false,
    tracks: typeof a.trackOne === 'function',
    settles: typeof a.fetchPayment === 'function',
    receipts: typeof a.fetchCprs === 'function',
    // whether the courier will say where it goes - the service areas page
    // offers a tab only for a courier that answers
    areas: typeof a.fetchAreas === 'function',
    // Some couriers keep a merchant portal behind a second sign-in, and it
    // answers questions their API will not. The page draws the sign-in box
    // from this rather than from a courier's name, so a courier that grows one
    // needs nothing changed on the screen.
    portal: a.portal
      ? {
          where: a.portal.where || '',
          says: a.portal.says || '',
          // whether that portal can be asked for a span of days, which is what
          // makes bringing a past in possible at all
          lists: !!a.portal.lists
        }
      : null
  }));
}

// The one bucket-reader for a courier whose own file is not to hand. A webhook
// arrives naming its courier, and if that courier is not one we know the words
// in the status still decide - better than filing it under "other".
const plain = makeGrouper({});

export function groupFor(courier, status) {
  const a = adapterFor(courier);
  return a && a.groupOf ? a.groupOf(status) : plain(status);
}

// What arrived on a webhook, read by the courier's own file where it has
// something to say about it and by the forgiving reader in hooks.js otherwise.
export function readFor(courier, body) {
  const a = adapterFor(courier);
  return a && typeof a.readHook === 'function' ? a.readHook(body) : readHook(body);
}
