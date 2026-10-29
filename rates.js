// What a courier agreed to charge, against what it actually charged.
//
// Two halves, and only one of them needs anybody to type anything:
//
//   charged   what is on the parcels themselves - every one of them carries
//             the courier's own fee and tax, so "what did PostEx cost us per
//             parcel last month" is answerable today, for every courier, with
//             no rate card anywhere.
//   agreed    the rate card. Typed in here, because a courier's rates are in
//             an agreement and on a letter, not on an API - "rate kyun ke
//             company change karti rehti hai" - and the one thing that makes
//             that workable is the **date**.
//
// **A rate card has a day it starts and never an end.** Rates move, and a
// parcel booked in August has to be costed at August's rates however many
// times they have changed since. So a card is never edited into the next one:
// a new rate is a new card, from the day it starts, and every parcel finds the
// card that was in force on the day it was booked. Editing the old card in
// place would quietly re-price a year of parcels and make last month's figures
// disagree with last month's screen.
//
// A card belongs to a courier company, or to one account of it where a company
// has two accounts on different rates (`account_id`). The account's own card
// wins where there is one.

import { pool } from './db.js';

/* ==================== the tables ==================== */

export async function initRates() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS courier_rate_cards (
      id             SERIAL PRIMARY KEY,
      realm_id       TEXT NOT NULL,
      courier        TEXT NOT NULL,
      account_id     INTEGER,              -- NULL = every account of that courier
      effective_from DATE NOT NULL,
      note           TEXT,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS courier_rate_cards_key
      ON courier_rate_cards (realm_id, courier, effective_from DESC)
  `);

  // One line per zone. '*' is the rate for everywhere, and a city named here
  // overrides it for that city alone - which is how these agreements are
  // actually written: one rate, and a handful of places that cost more.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS courier_rate_lines (
      id            SERIAL PRIMARY KEY,
      realm_id      TEXT NOT NULL,
      card_id       INTEGER NOT NULL REFERENCES courier_rate_cards(id) ON DELETE CASCADE,
      zone          TEXT NOT NULL DEFAULT '*',
      base_kg       NUMERIC(8,3)  DEFAULT 1,
      base_charge   NUMERIC(12,2) DEFAULT 0,
      extra_charge  NUMERIC(12,2) DEFAULT 0,   -- per kg over base_kg
      cod_percent   NUMERIC(7,3)  DEFAULT 0,
      cod_min       NUMERIC(12,2) DEFAULT 0,
      return_charge NUMERIC(12,2) DEFAULT 0,   -- what a parcel sent back costs
      fuel_percent  NUMERIC(7,3)  DEFAULT 0,
      gst_percent   NUMERIC(7,3)  DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS courier_rate_lines_key
      ON courier_rate_lines (card_id, zone)
  `);
}

/* ==================== the cards ==================== */

const n2 = v => Math.round(Number(v || 0) * 100) / 100;
const num = v => {
  const f = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isNaN(f) ? 0 : f;
};

// Ten characters, or nothing. A date typed on a form is a calendar date and
// never a moment - the lesson `day()` and `qb_start` both learned the hard way.
export function dayText(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const year = Number(s.slice(0, 4));
  return year >= 2000 && year <= 2100 ? s : null;
}

export function todayText() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function listCards(realmId, opts) {
  const where = ['c.realm_id = $1'];
  const args = [realmId];
  if (opts && opts.courier) { args.push(String(opts.courier)); where.push(`c.courier = $${args.length}`); }

  const r = await pool.query(
    `SELECT c.id, c.courier, c.account_id, c.effective_from, c.note,
            a.label AS account_label,
            COALESCE(json_agg(json_build_object(
              'id', l.id, 'zone', l.zone,
              'baseKg', l.base_kg, 'baseCharge', l.base_charge,
              'extraCharge', l.extra_charge,
              'codPercent', l.cod_percent, 'codMin', l.cod_min,
              'returnCharge', l.return_charge,
              'fuelPercent', l.fuel_percent, 'gstPercent', l.gst_percent
            ) ORDER BY (l.zone = '*') DESC, l.zone) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
       FROM courier_rate_cards c
       LEFT JOIN courier_rate_lines l ON l.card_id = c.id
       LEFT JOIN courier_accounts a  ON a.id = c.account_id
      WHERE ${where.join(' AND ')}
      GROUP BY c.id, a.label
      ORDER BY c.courier, c.effective_from DESC`,
    args
  );

  return r.rows.map(x => ({
    id: x.id,
    courier: x.courier,
    accountId: x.account_id,
    accountLabel: x.account_label || null,
    from: x.effective_from ? String(x.effective_from).slice(0, 10) : null,
    note: x.note || '',
    lines: (x.lines || []).map(l => ({
      id: l.id,
      zone: l.zone,
      baseKg: Number(l.baseKg), baseCharge: Number(l.baseCharge),
      extraCharge: Number(l.extraCharge),
      codPercent: Number(l.codPercent), codMin: Number(l.codMin),
      returnCharge: Number(l.returnCharge),
      fuelPercent: Number(l.fuelPercent), gstPercent: Number(l.gstPercent)
    }))
  }));
}

// A card and its lines, written in one go. An id means the card itself is
// being corrected - a typo in the rate that was agreed - rather than a new
// rate starting: that is always a new card with its own date.
export async function saveCard(realmId, card) {
  const from = dayText(card.from);
  if (!from) throw new Error('Pick the date these rates start from');
  if (!card.courier) throw new Error('Which courier?');

  const lines = (card.lines || []).filter(l => l && String(l.zone || '').trim() !== '');
  if (!lines.length) throw new Error('A rate card needs at least the rate for everywhere');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let id = Number(card.id) || 0;
    if (id) {
      const r = await client.query(
        `UPDATE courier_rate_cards
            SET effective_from = $3, note = $4, account_id = $5
          WHERE realm_id = $1 AND id = $2 RETURNING id`,
        [realmId, id, from, card.note || null, card.accountId || null]
      );
      if (!r.rows.length) throw new Error('No such rate card');
      await client.query(`DELETE FROM courier_rate_lines WHERE realm_id = $1 AND card_id = $2`,
                         [realmId, id]);
    } else {
      const r = await client.query(
        `INSERT INTO courier_rate_cards (realm_id, courier, account_id, effective_from, note)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [realmId, String(card.courier), card.accountId || null, from, card.note || null]
      );
      id = r.rows[0].id;
    }

    for (const l of lines) {
      await client.query(
        `INSERT INTO courier_rate_lines
           (realm_id, card_id, zone, base_kg, base_charge, extra_charge,
            cod_percent, cod_min, return_charge, fuel_percent, gst_percent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (card_id, zone) DO UPDATE SET
           base_kg = EXCLUDED.base_kg, base_charge = EXCLUDED.base_charge,
           extra_charge = EXCLUDED.extra_charge,
           cod_percent = EXCLUDED.cod_percent, cod_min = EXCLUDED.cod_min,
           return_charge = EXCLUDED.return_charge,
           fuel_percent = EXCLUDED.fuel_percent, gst_percent = EXCLUDED.gst_percent`,
        [realmId, id, String(l.zone).trim(),
         num(l.baseKg) || 1, num(l.baseCharge), num(l.extraCharge),
         num(l.codPercent), num(l.codMin), num(l.returnCharge),
         num(l.fuelPercent), num(l.gstPercent)]
      );
    }

    await client.query('COMMIT');
    return id;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function dropCard(realmId, id) {
  const r = await pool.query(
    `DELETE FROM courier_rate_cards WHERE realm_id = $1 AND id = $2`,
    [realmId, Number(id)]
  );
  return r.rowCount;
}

/* ==================== what a parcel should have cost ==================== */

// Written once, here, and used by both sides: the figures on the screen and
// the worked example under the card a person is typing. A second place that
// prices a parcel is a second answer to the same question.
export function expectedFor(parcel, line) {
  if (!line) return null;

  const base = Number(line.baseKg) || 1;
  const weight = Number(parcel.weight) || 0;
  // Couriers charge the next whole step, never a fraction of one: 1.2 kg on a
  // 1 kg base is one extra step, not 0.2 of one.
  const steps = weight > base ? Math.ceil((weight - base) / base) : 0;

  const returned = parcel.statusGroup === 'returned' || parcel.statusGroup === 'returning';

  // A parcel sent back has its own charge and collects nothing at the door.
  const carriage = returned && Number(line.returnCharge) > 0
    ? Number(line.returnCharge)
    : Number(line.baseCharge) + steps * Number(line.extraCharge);

  const cod = returned ? 0 : Math.max(
    (Number(line.codPercent) / 100) * (Number(parcel.amount) || 0),
    Number(line.codMin) || 0
  );

  const fuel = (Number(line.fuelPercent) / 100) * carriage;
  const net = carriage + cod + fuel;
  const gst = (Number(line.gstPercent) / 100) * net;

  return {
    carriage: n2(carriage),
    cod: n2(cod),
    fuel: n2(fuel),
    gst: n2(gst),
    total: n2(net + gst),
    steps
  };
}

/* ==================== charged, and charged against agreed ==================== */

// The SQL that prices a parcel from the card line beside it. It is the same
// arithmetic as expectedFor() above, said in the other language - which is a
// thing to be careful of, so the shape is kept line for line with it.
const EXPECTED_SQL = `
  CASE WHEN rc.card_id IS NULL THEN NULL ELSE
    (
      (CASE WHEN o.status_group IN ('returned','returning') AND rc.return_charge > 0
            THEN rc.return_charge
            ELSE rc.base_charge + rc.extra_charge *
                 GREATEST(0, CEIL((GREATEST(COALESCE(o.weight,0), rc.base_kg) - rc.base_kg)
                                  / NULLIF(rc.base_kg,0)))
       END)
      + (CASE WHEN o.status_group IN ('returned','returning') THEN 0
              ELSE GREATEST(rc.cod_percent / 100 * COALESCE(o.amount,0), rc.cod_min) END)
      + (rc.fuel_percent / 100 *
         (CASE WHEN o.status_group IN ('returned','returning') AND rc.return_charge > 0
               THEN rc.return_charge
               ELSE rc.base_charge + rc.extra_charge *
                    GREATEST(0, CEIL((GREATEST(COALESCE(o.weight,0), rc.base_kg) - rc.base_kg)
                                     / NULLIF(rc.base_kg,0)))
          END))
    ) * (1 + rc.gst_percent / 100)
  END`;

// The card in force on the day a parcel was **booked**, and the line for its
// city if that city has one. An account's own card beats the company's.
const CARD_JOIN = `
  LEFT JOIN LATERAL (
    SELECT l.card_id, l.base_kg, l.base_charge, l.extra_charge,
           l.cod_percent, l.cod_min, l.return_charge, l.fuel_percent, l.gst_percent
      FROM courier_rate_cards c
      JOIN courier_rate_lines l ON l.card_id = c.id
     WHERE c.realm_id = o.realm_id
       AND c.courier = o.courier
       AND (c.account_id IS NULL OR c.account_id = o.account_id)
       AND c.effective_from <= COALESCE(o.booked_on, CURRENT_DATE)
       AND (l.zone = '*' OR LOWER(l.zone) = LOWER(COALESCE(o.city, '')))
     ORDER BY (c.account_id IS NOT NULL) DESC,
              c.effective_from DESC,
              (l.zone <> '*') DESC
     LIMIT 1
  ) rc ON TRUE`;

function scope(realmId, opts) {
  const where = ['o.realm_id = $1'];
  const args = [realmId];
  if (opts.account) { args.push(Number(opts.account)); where.push(`o.account_id = $${args.length}`); }
  if (opts.courier) { args.push(String(opts.courier)); where.push(`o.courier = $${args.length}`); }
  if (opts.from)    { args.push(opts.from); where.push(`o.booked_on >= $${args.length}`); }
  if (opts.to)      { args.push(opts.to);   where.push(`o.booked_on <= $${args.length}`); }
  return { where: where.join(' AND '), args };
}

// Everything the Rates screen shows, in four queries.
export async function rateReport(realmId, opts) {
  const s = scope(realmId, opts || {});
  const w = s.where;
  const args = s.args;

  const [byCourier, byMonth, byCity, worst] = await Promise.all([
    // Per courier company: what they carried, what they charged, and - where a
    // card exists - what that should have come to.
    pool.query(
      `SELECT o.courier,
              COUNT(*) AS parcels,
              COUNT(*) FILTER (WHERE o.status_group IN ('returned','returning')) AS returned,
              COALESCE(SUM(o.fee + o.tax),0) AS charged,
              COALESCE(SUM(o.weight),0) AS weight,
              COUNT(*) FILTER (WHERE COALESCE(o.weight,0) > 0) AS weighed,
              COUNT(*) FILTER (WHERE rc.card_id IS NOT NULL) AS priced,
              COALESCE(SUM(${EXPECTED_SQL}),0) AS expected,
              COALESCE(SUM(o.fee + o.tax) FILTER (WHERE rc.card_id IS NOT NULL),0) AS charged_priced
         FROM courier_orders o ${CARD_JOIN}
        WHERE ${w}
        GROUP BY o.courier
        ORDER BY 2 DESC`, args),

    // Month by month, so a rate that moved shows up as a step rather than as
    // an average nobody can place.
    pool.query(
      `SELECT o.courier,
              to_char(date_trunc('month', o.booked_on), 'YYYY-MM') AS month,
              COUNT(*) AS parcels,
              COALESCE(SUM(o.fee + o.tax),0) AS charged,
              COALESCE(SUM(${EXPECTED_SQL}),0) AS expected,
              COUNT(*) FILTER (WHERE rc.card_id IS NOT NULL) AS priced
         FROM courier_orders o ${CARD_JOIN}
        WHERE ${w} AND o.booked_on IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 2 DESC, 1`, args),

    pool.query(
      `SELECT COALESCE(NULLIF(o.city,''),'(not said)') AS city, o.courier,
              COUNT(*) AS parcels,
              COALESCE(SUM(o.fee + o.tax),0) AS charged,
              COALESCE(SUM(${EXPECTED_SQL}),0) AS expected
         FROM courier_orders o ${CARD_JOIN}
        WHERE ${w}
        GROUP BY 1, 2
        ORDER BY 4 DESC
        LIMIT 40`, args),

    // The parcels where the difference is biggest. A figure nobody can open
    // into its parcels is a figure nobody believes.
    pool.query(
      `SELECT o.tracking, o.order_ref, o.courier, o.city, o.booked_on,
              o.weight, o.amount, (o.fee + o.tax) AS charged,
              ${EXPECTED_SQL} AS expected,
              o.status_group
         FROM courier_orders o ${CARD_JOIN}
        WHERE ${w} AND rc.card_id IS NOT NULL
          AND ABS((o.fee + o.tax) - (${EXPECTED_SQL})) > 1
        ORDER BY ABS((o.fee + o.tax) - (${EXPECTED_SQL})) DESC
        LIMIT 50`, args)
  ]);

  const f = v => Number(v || 0);

  return {
    couriers: byCourier.rows.map(x => ({
      courier: x.courier,
      parcels: f(x.parcels),
      returned: f(x.returned),
      charged: n2(x.charged),
      perParcel: f(x.parcels) ? n2(f(x.charged) / f(x.parcels)) : 0,
      weight: n2(x.weight),
      weighed: f(x.weighed),
      perKg: f(x.weight) ? n2(f(x.charged) / f(x.weight)) : 0,
      priced: f(x.priced),
      expected: n2(x.expected),
      // compared like against like: only the parcels a card could price
      chargedPriced: n2(x.charged_priced),
      difference: n2(f(x.charged_priced) - f(x.expected))
    })),
    months: byMonth.rows.map(x => ({
      courier: x.courier, month: x.month,
      parcels: f(x.parcels), charged: n2(x.charged),
      expected: n2(x.expected), priced: f(x.priced),
      perParcel: f(x.parcels) ? n2(f(x.charged) / f(x.parcels)) : 0
    })),
    cities: byCity.rows.map(x => ({
      city: x.city, courier: x.courier,
      parcels: f(x.parcels), charged: n2(x.charged), expected: n2(x.expected),
      perParcel: f(x.parcels) ? n2(f(x.charged) / f(x.parcels)) : 0
    })),
    worst: worst.rows.map(x => ({
      tracking: x.tracking, orderRef: x.order_ref, courier: x.courier,
      city: x.city, bookedOn: x.booked_on ? String(x.booked_on).slice(0, 10) : null,
      weight: f(x.weight), amount: n2(x.amount),
      charged: n2(x.charged), expected: n2(x.expected),
      difference: n2(f(x.charged) - f(x.expected)),
      statusGroup: x.status_group
    }))
  };
}
