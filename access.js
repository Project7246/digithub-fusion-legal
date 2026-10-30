// Who may see what, and how far down.
//
// Until 30 Oct 2026 a person was given a flat list of jobs - `["hr"]`,
// `["upload","payments"]` - and that was the whole of it. Two things were
// wrong with it, and both were found by giving one employee a login:
//
//   **A job is not a module.** Somebody given HR saw every module on the
//   launcher, because a tile with no job on it was treated as everybody's.
//   That half is shut (see tiles.js), but the list still cannot say "HR, and
//   only the attendance screen".
//
//   **Seeing a figure is not the same as doing the work.** The person who
//   books parcels needs the delivery rate; they have no business seeing what
//   the courier owes, or a CPR, or a bank account. The person who keeps the
//   attendance needs everybody's days and **nobody's salary**. A list of jobs
//   cannot say either, because a job is a verb and this is about numbers.
//
// So a grant has three levels now, and the old flat list still works exactly
// as it did - `read()` below turns either shape into the same answer.
//
//     module   finance, logistics, hr, csr, banking
//       app    the jobs inside it - the keys already in RIGHT_GROUPS
//       money  per module: may this person see amounts at all
//
// Nothing here decides anything by itself. `server.js` owns RIGHT_GROUPS and
// hands it in, so there is still one list of jobs and this is only the shape
// a person's share of it takes.

/* ==================== the shape a grant is stored in ==================== */
//
// v2:  { v: 2, apps: ['hr', 'payroll'], money: { hr: false, logistics: true } }
// v1:  ['hr', 'payroll']                        <- still read, never written
//
// `apps` is the same key RIGHT_GROUPS uses, so a job added there is a job
// that can be given out here without anything being mapped twice.

export function read(rights) {
  // nothing, or something unreadable, is nothing - never everything
  if (!rights) return { v: 2, apps: [], money: {} };

  if (Array.isArray(rights)) {
    return { v: 2, apps: rights.filter(x => typeof x === 'string'), money: {}, from: 1 };
  }

  if (typeof rights === 'object') {
    return {
      v: 2,
      apps: Array.isArray(rights.apps) ? rights.apps.filter(x => typeof x === 'string') : [],
      money: (rights.money && typeof rights.money === 'object') ? rights.money : {}
    };
  }

  return { v: 2, apps: [], money: {} };
}

// What goes into the database. Always v2, always the same shape.
export function write(apps, money) {
  return {
    v: 2,
    apps: [...new Set((apps || []).filter(x => typeof x === 'string' && x))],
    money: Object.fromEntries(
      Object.entries(money || {}).map(([k, v]) => [k, v !== false]))
  };
}

/* ==================== asking it something ==================== */

// May this person do this job?
export function mayApp(who, app) {
  if (!who || !app) return false;
  if (who.admin || who.role === 'admin' || who.role === 'standard') return true;
  if (who.role !== 'custom') return false;
  return read(who.rights).apps.indexOf(app) > -1;
}

// Is this person part of this module at all? Holding one job inside it is
// what puts them in it - the same rule the launcher draws tiles by.
export function inModule(who, moduleKey, groups) {
  if (!who || !moduleKey) return false;
  if (who.admin || who.role === 'admin' || who.role === 'standard') return true;
  if (who.role !== 'custom') return false;

  const mine = read(who.rights).apps;
  return (groups || []).some(g => g.module === moduleKey && mine.indexOf(g.key) > -1);
}

// **May this person see amounts in this module?**
//
// Said per module on purpose. The courier clerk may see every parcel and no
// figure; the accounts clerk may see every figure. One switch for the whole
// person would have made that impossible to express.
//
// Nothing said means **yes**, because that is what everybody had before this
// existed and a change to how rights are stored must not quietly take
// something away. Turning it off is a decision somebody makes.
export function seesMoney(who, moduleKey) {
  if (!who) return false;
  if (who.admin || who.role === 'admin' || who.role === 'standard') return true;
  if (who.hideMoney) return false;            // the old per-person switch still bites
  const money = read(who.rights).money || {};
  return money[moduleKey] !== false;
}

/* ==================== the catalogue a screen draws ==================== */

// RIGHT_GROUPS, arranged the way somebody reads it: module, then the jobs in
// it, each saying whether it is a job about money. The screen that hands
// access out is drawn from this, so a job added to RIGHT_GROUPS turns up there
// without anybody remembering to add it twice.
export const MODULE_NAMES = {
  finance:   'Finance',
  logistics: 'Logistics',
  csr:       'Shopify and orders',
  hr:        'HR and payroll',
  banking:   'Banking'
};

export function catalogue(groups) {
  const byModule = new Map();

  (groups || []).forEach(g => {
    const key = g.module || 'finance';
    if (!byModule.has(key)) {
      byModule.set(key, {
        key,
        label: MODULE_NAMES[key] || key,
        // whether anything in this module shows amounts at all - a module
        // with no money in it needs no switch, and offering one would be a
        // question with no meaning
        hasMoney: false,
        apps: []
      });
    }
    const m = byModule.get(key);
    if (g.money) m.hasMoney = true;
    m.apps.push({ key: g.key, label: g.label, what: g.what || '', money: !!g.money });
  });

  return [...byModule.values()];
}

// What one person holds, in the shape the screen draws.
export function grantOf(who, groups) {
  const got = read(who && who.rights);
  const cat = catalogue(groups);

  return {
    role: (who && who.role) || 'none',
    apps: got.apps,
    money: Object.fromEntries(cat.map(m => [m.key, seesMoney(who, m.key)])),
    modules: cat.map(m => m.key).filter(k => inModule(who, k, groups))
  };
}
