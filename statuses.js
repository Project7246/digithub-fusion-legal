// What a courier calls a parcel, and what the app calls it.
//
// Every courier has its own vocabulary - PostEx says "Out For Delivery", Trax
// says "Out for delivery", M&P says "DELIVERY IN PROCESS" - and every one of
// them adds a word next month without telling anybody. The app has thirteen
// buckets and no interest in the vocabulary, so each courier's file brings a
// table of the names it knows and borrows the word rules below for the rest.
//
// The rules matter more than the table. A status we have never seen must still
// land somewhere sensible, because the alternative is an order sitting in
// "other" where nobody looks for it.

export const BUCKETS = [
  'unbooked', 'booked', 'transit', 'review', 'delivered', 'returning',
  'returned', 'expired', 'cancelled', 'transferred', 'lost', 'damaged', 'other'
];

// The words in a status decide where it belongs. Order is the whole of it:
// "out for return" is a return on its way back, not a delivery, so delivery is
// asked first and told to ignore "out for", and returns are asked before
// transit because a parcel going back is still moving.
export function byWords(status) {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return '';

  // "RTO Delivered" is a return that finished, not a delivery - the return
  // words win over the word "delivered" whenever both are in the same status.
  if (s.includes('deliver') && !s.includes('under review') && !s.includes('out for') &&
      !s.includes('attempt') && !s.includes('in process') && !s.includes('failed') &&
      !s.includes('undeliver') && !s.includes('return') && !s.includes('rto')) {
    return 'delivered';
  }
  if (s.includes('return') || s.includes('rto') || s.includes('refused') ||
      s.includes('rejected')) {
    return s.includes('out for') || s.includes('route') || s.includes('transit') ||
           s.includes('way') || s.includes('process')
      ? 'returning' : 'returned';
  }
  if (s.includes('under review') || s.includes('on hold') || s.includes('hold') ||
      s.includes('dispute')) {
    return 'review';
  }
  if (s.includes('unbook') || s.includes('un-book') || s.includes('draft') ||
      s.includes('not booked')) {
    return 'unbooked';
  }
  if (s.includes('expire'))                                    return 'expired';
  if (s.includes('cancel') || s.includes('un-assign') ||
      s.includes('void'))                                      return 'cancelled';
  if (s.includes('transfer'))                                  return 'transferred';
  if (s.includes('stolen') || s.includes('lost') ||
      s.includes('missing'))                                   return 'lost';
  if (s.includes('damage') || s.includes('broken'))            return 'damaged';
  if (s.includes('warehouse') || s.includes('transit') || s.includes('route') ||
      s.includes('out for')   || s.includes('attempt') || s.includes('picked') ||
      s.includes('pickup')    || s.includes('arriv')   || s.includes('depart') ||
      s.includes('station')   || s.includes('hub')     || s.includes('dispatch') ||
      s.includes('in process')|| s.includes('on the way')) {
    return 'transit';
  }
  if (s.includes('book') || s.includes('manifest') ||
      s.includes('created') || s.includes('pending'))          return 'booked';

  return '';
}

// One courier's grouper: its own names first, the word rules after, 'other'
// only when both give up.
export function makeGrouper(exact) {
  const table = {};
  Object.keys(exact || {}).forEach(k => {
    table[String(k).trim().toLowerCase()] = exact[k];
  });

  return function groupOf(status) {
    const s = String(status || '').trim().toLowerCase();
    if (!s) return 'other';
    if (table[s]) return table[s];
    return byWords(s) || 'other';
  };
}

/* ---------- the small readings every adapter needs ---------- */

// A courier sends "1,250.00", "Rs 1250", " 1250 " and 1250 for the same money.
export function num(v) {
  if (v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// Only the day, because that is all any report here is cut by - and a courier's
// own idea of a timestamp is not something to trust past the date.
export function day(v) {
  if (!v) return null;
  const s = String(v).trim();

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // 21/10/2026 and 21-10-2026, which is how the Pakistani portals write it
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
