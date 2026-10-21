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
  // Everything a courier says about a delivery that did not happen still has
  // the word "delivery" in it - "Delivery Unsuccessful", "Delivery In Process",
  // "Undelivered", "RTO Delivered" - so the exceptions are listed, and they
  // are listed from what the three couriers' own documents say.
  if (s.includes('deliver') && !s.includes('under review') && !s.includes('out for') &&
      !s.includes('attempt') && !s.includes('in process') && !s.includes('failed') &&
      !s.includes('undeliver') && !s.includes('return') && !s.includes('rto') &&
      !s.includes('unsuccess') && !s.includes('not deliver') && !s.includes('pending')) {
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
  // A delivery that was tried and did not come off is a parcel still with the
  // courier, not a parcel in limbo - "other" is where orders go to be
  // forgotten, and an attempted delivery is the opposite of forgotten.
  if (s.includes('unsuccess') || s.includes('undeliver') ||
      s.includes('not deliver') || s.includes('failed')) {
    return 'transit';
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

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

const iso = (y, m, d) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Only the day, because that is all any report here is cut by - and a courier's
// own idea of a timestamp is not something to trust past the date.
//
// Read by hand, in the order the three couriers actually write it, and never
// through toISOString(). That was the bug worth remembering: M&P send
// "02 Nov 2024", `new Date` reads it as midnight **here**, and toISOString
// then moves it back five hours into the 1st. A courier's date is the date it
// printed - it is not a moment to be converted into another timezone.
// `order` is for the one thing a date like 06/12/2025 cannot tell you: Sonic
// writes 5 April as 05/04/2022 and M&P write 14 June as 06/14/2025, so the two
// couriers disagree and only the caller knows which it is holding. Day-first
// is the default because that is how Pakistan writes a date; 'mdy' is M&P's
// tracking screen. Where the numbers settle it - either of them past 12 - the
// numbers win and `order` is ignored.
export function day(v, order) {
  if (!v) return null;
  const s = String(v).trim();

  // 2024-11-02, and 2024-11-02T10:22:41.861Z
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(m[1], m[2], m[3]);

  // 02/11/2024 and 02-11-2024
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12) return iso(m[3], b, a);          // the first must be the day
    if (b > 12) return iso(m[3], a, b);          // the second must be the day
    return order === 'mdy' ? iso(m[3], a, b) : iso(m[3], b, a);
  }

  // 02 Nov 2024, which is how M&P's reports write it
  m = s.match(/^(\d{1,2})[\s\-]([A-Za-z]{3,})[\s\-](\d{4})/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
    return iso(m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]);
  }

  // Nov 02, 2024
  m = s.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
    return iso(m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], m[2]);
  }

  // a number of seconds since 1970, as Sonic's tracking history carries
  if (/^\d{10}$/.test(s)) {
    const d = new Date(Number(s) * 1000);
    return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  // local parts, not UTC - see above
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
