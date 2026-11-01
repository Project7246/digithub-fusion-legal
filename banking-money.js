// Banking report arithmetic. Values stay in integer paisa until presentation.
export function money(value) {
  const text = String(value ?? '0').trim();
  const match = text.match(/^(-?)(\d+)(?:\.(\d{1,2})0*)?$/);
  if (!match) throw new Error('Invalid money amount');
  const amount = BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0'));
  return match[1] ? -amount : amount;
}

function decimal(value) {
  const absolute = value < 0n ? -value : value;
  return (value < 0n ? '-' : '') + absolute / 100n + '.' +
    String(absolute % 100n).padStart(2, '0');
}

export function addMoney(values) {
  return decimal(values.reduce((sum, value) => sum + money(value), 0n));
}

// Column totals retain available figures and describe their coverage. Missing
// amounts are never converted to zero or presented as a complete bank total.
export function reportTotals(rows) {
  const fields = {
    opening: b => b.openingKnown === false ? null : b.opening,
    inYear: b => (b.incomeIncomplete ?? b.balanceIncomplete) ? null : b.inYear,
    outYear: b => b.expenseIncomplete ? null : b.outYear,
    received: b => b.fromCouriersYear,
    receivable: b => b.receivable,
    balance: b => b.balance
  };
  const totals = { coverage: {}, payable: null,
    receivedCprs: rows.reduce((n, b) => n + (b.receivedCprs || 0), 0),
    receivableCprs: rows.reduce((n, b) => n + (b.receivableCprs || 0), 0) };
  for (const [key, read] of Object.entries(fields)) {
    const values = rows.map(read).filter(v => v != null && v !== '');
    totals[key] = values.length || !rows.length ? addMoney(values) : null;
    totals.coverage[key] = { included: values.length, total: rows.length,
      complete: values.length === rows.length };
  }
  return totals;
}

export function receiptState(status) {
  const text = String(status || '').trim().toLowerCase().replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ').replace(/^payment (?:status )?/, '');
  if (/cancelled|canceled|void|rejected/.test(text)) return 'excluded';
  if (/pending|unconfirmed|unprocessed|not (?:processed|confirmed|transferred|paid)|awaiting/.test(text)) {
    return 'receivable';
  }
  if (/^(?:confirmed|transferred|processed|closed|paid|cleared)$/.test(text)) return 'received';
  if (/^(?:open|generated|created|approved|unpaid)$/.test(text)) return 'receivable';
  return 'unknown';
}

export function placeReceipts(receipts, banks, links, moves, today) {
  const byBank = new Map(banks.map(b => [Number(b.id), b]));
  const ordered = [...links].sort((a, b) => b.from.localeCompare(a.from) || b.id - a.id);
  return receipts.map(r => {
    const state = receiptState(r.status);
    const on = state === 'received' ? r.paidOn : r.createdOn;
    const link = ordered.find(l => Number(l.accountId) === Number(r.accountId) &&
      l.from <= (state === 'received' ? on || today : today));
    // Preserve an explicit bank-to-bank correction made through the existing
    // move endpoint. Ordinary old generated deposits do not override dated links.
    const override = moves.find(m => m.source === 'courier' &&
      Number(m.accountId) === Number(r.accountId) && m.ref === r.cpr &&
      (m.note || '').includes('(moved from another bank)'));
    const bankId = Number(override?.bankId || link?.bankId) || null;
    const bank = byBank.get(bankId);
    let why = '';
    if (!bank) why = 'No bank linked for this CPR';
    else if (state === 'received' && !on) why = 'Payment date not supplied';
    else if (state === 'received' && on > today) why = 'Payment date is in the future';
    else if (state === 'received' && bank.openingOn && on < bank.openingOn) {
      why = 'Before the opening balance date';
    }
    else if (state === 'received' && bank.inFrom && on < bank.inFrom) {
      why = 'Before the Transaction In start date';
    }
    if (state === 'unknown') why = 'Payment status not recognised';
    if (state === 'excluded') why = 'CPR cancelled or rejected';
    if (r.net == null) why = 'Net amount not supplied';
    const nonCash = r.net != null && money(r.net) < 0n;
    if(nonCash && bank && state !== 'excluded') why = '';
    return { ...r, key: String(r.accountId) + ':' + r.cpr, state, on: on || null,
      bankId, bank: bank?.title || bank?.name || '', included: !why, why, nonCash };
  });
}

export function bankFigures(bank, receipts, moves, year, today) {
  const valid = on => on && on <= today && (!bank.openingOn || on >= bank.openingOn);
  const afterStart = (on, value) => !bank[money(value) < 0n ? 'outFrom' : 'inFrom'] ||
    on >= bank[money(value) < 0n ? 'outFrom' : 'inFrom'];
  const actual = [
    ...receipts.filter(r => r.state === 'received' && money(r.net) >= 0n && valid(r.on))
      .map(r => ({ on: r.on, amount: r.net })),
    ...moves.filter(m => valid(m.on))
  ].filter(m => afterStart(m.on, m.amount));
  const sum = filter => actual.filter(filter).reduce((n, m) => n + money(m.amount), 0n);
  const net = sum(() => true);
  const inYear = sum(m => m.on >= year.from && m.on <= year.to && money(m.amount) > 0n);
  const outYear = -sum(m => m.on >= year.from && m.on <= year.to && money(m.amount) < 0n);
  return {
    moved: decimal(net),
    balance: bank.opening == null ? null : decimal(money(bank.opening) + net),
    inAll: decimal(sum(m => money(m.amount) > 0n)),
    outAll: decimal(-sum(m => money(m.amount) < 0n)),
    inYear: decimal(inYear + (bank.fiscalYear === year.year ? money(bank.openingIn) : 0n)),
    outYear: decimal(outYear + (bank.fiscalYear === year.year ? money(bank.openingOut) : 0n)),
    receivable: addMoney(receipts.filter(r => r.state === 'receivable' && money(r.net) >= 0n).map(r => r.net))
  };
}
