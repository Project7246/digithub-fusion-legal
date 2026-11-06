// Execute the shared renderer/handlers with synthetic users and courier accounts.
// This verifies navigation and permissions; it does not claim browser layout QA.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('public/nav.js', 'utf8');

class Element {
  constructor(tag = 'div', attributes = {}) {
    this.tagName = tag.toUpperCase(); this.attributes = attributes;
    this.children = []; this.events = {}; this.open = 'open' in attributes;
    this.style = {}; this._html = '';
    this.classList = {
      contains: name => (this.attributes.class || '').split(/\s+/).includes(name),
      toggle: (name, force) => {
        const classes = new Set((this.attributes.class || '').split(/\s+/).filter(Boolean));
        const on = force ?? !classes.has(name);
        if (on) classes.add(name); else classes.delete(name);
        this.attributes.class = [...classes].join(' '); return on;
      },
      add: name => this.classList.toggle(name, true),
      remove: name => this.classList.toggle(name, false)
    };
  }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  get nextElementSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] || null; }
  get firstChild() { return this.children[0]; }
  get lastChild() { return this.children.at(-1); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(type, handler) { this.events[type] = handler; }
  get innerHTML() { return this._html; }
  set innerHTML(html) {
    this._html = html; this.children = [];
    const stack = [this];
    for (const token of html.matchAll(/<\/?([\w-]+)([^>]*?)>/g)) {
      const [whole, tag, rest] = token;
      if (whole.startsWith('</')) { stack.pop(); continue; }
      const attributes = {};
      for (const attr of rest.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attributes[attr[1]] = attr[2] ?? '';
      const child = stack.at(-1).appendChild(new Element(tag, attributes));
      if (!whole.endsWith('/>') && !['img','input','br','hr'].includes(tag)) stack.push(child);
    }
  }
  querySelectorAll(selector) {
    const matchSimple = (node, part) => {
      const tag = part.match(/^[\w-]+/);
      if (tag && node.tagName !== tag[0].toUpperCase()) return false;
      for (const item of part.matchAll(/\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (item[1] && !node.classList.contains(item[1])) return false;
        if (item[2] && node.getAttribute('id') !== item[2]) return false;
        if (item[3] && (node.getAttribute(item[3]) === null ||
          (item[4] !== undefined && node.getAttribute(item[3]) !== item[4]))) return false;
      }
      return true;
    };
    const matches = (node, parts) => {
      if (!matchSimple(node, parts.at(-1))) return false;
      if (parts.length === 1) return true;
      if (parts.at(-2) === '>') return !!node.parent && matches(node.parent, parts.slice(0, -2));
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (matches(parent, parts.slice(0, -1))) return true;
      }
      return false;
    };
    const alternatives = selector.split(',').map(part => part.trim().match(/\[[^\]]*\]|[^\s]+/g));
    const result = [];
    const walk = parent => parent.children.forEach(child => {
      if (alternatives.some(parts => matches(child, parts))) result.push(child);
      walk(child);
    });
    walk(this); return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function navigation(section, pathname, search = '', saved = {}) {
  const root = new Element('html');
  const head = root.appendChild(new Element('head'));
  const rail = root.appendChild(new Element('aside', { class: 'rail' }));
  const storage = new Map(Object.entries({ 'fusion:section': section, ...saved }));
  const document = {
    cookie: 'signed=1', head, documentElement: root,
    createElement: tag => new Element(tag),
    querySelector: selector => root.querySelector(selector),
    querySelectorAll: selector => root.querySelectorAll(selector),
    getElementById: id => root.querySelector('#' + id), addEventListener() {}
  };
  const context = vm.createContext({ document, window: {}, location: { pathname, search },
    localStorage: { getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value) }, URLSearchParams });
  const prefixEnd = source.indexOf('  /* ----------', source.indexOf("if(rail) rail.querySelectorAll('.nav-group')"));
  assert.ok(prefixEnd > 0, 'shared renderer boundary found');
  vm.runInContext(source.slice(0, prefixEnd) +
    '\nglobalThis.rail = rail; globalThis.path = path; globalThis.esc = esc;\n})();', context);
  return { context, document, rail, storage, root };
}

for (const section of ['finance','logistics','operations','banking','hr','csr','shopify']) {
  const route = { banking: '/banking', shopify: '/shopify-connect' }[section] || '/' + section;
  const ui = navigation(section, route);
  assert.ok(ui.rail.querySelector('nav'), section + ' shared navigation renders');
  for (const group of ui.rail.querySelectorAll('.nav-group')) {
    assert.equal(group.firstChild.tagName, 'SUMMARY');
    assert.ok(group.querySelector('.nav-group-items > a, .nav-group-items > button'));
    assert.equal(group.open, false, 'overview starts with compact closed groups');
    group.open = true; group.events.toggle();
    assert.equal(ui.storage.get('fusion:nav-open:' + section), group.getAttribute('data-nav-group'));
    assert.equal(ui.rail.querySelectorAll('.nav-group').filter(item => item.open).length, 1,
      'only one top-level group stays open');
    group.open = false; group.events.toggle();
    assert.equal(ui.storage.get('fusion:nav-open:' + section), '');
  }
}

const active = navigation('hr', '/payroll', '', { 'fusion:nav-open:hr': 'The people' });
assert.equal(active.rail.querySelector('[data-nav-group="The month"]').open, true,
  'active page reopens its ancestor');
assert.equal(active.rail.querySelector('[data-nav-group="The people"]').open, false,
  'current page overrides a different previously opened group');
assert.ok(active.rail.querySelector('[data-nav-group="The month"]').classList.contains('has-current'));
assert.equal(active.rail.querySelector('a[href="/payroll"]').getAttribute('aria-current'), 'page');
const remembered = navigation('finance', '/finance', '', { 'fusion:nav-open:finance': 'Payments' });
assert.equal(remembered.rail.querySelector('[data-nav-group="Payments"]').open, true,
  'overview remembers the last group browsed');

const couriers = navigation('logistics', '/courier-dash', '?account=10');
couriers.context.fetch = async () => ({ json: async () => ({ couriers: [
  { key: 'trax', name: 'Trax', ready: true, accounts: [{ id: 1, label: 'Synthetic first' }] },
  { key: 'mnp', name: 'M&P', ready: true, accounts: [{ id: 10, label: 'Synthetic <second>' }] }
] }) });
vm.runInContext(source.slice(source.indexOf('  (function courierTree(){'),
  source.indexOf('  // A CPR belongs to one courier.')), couriers.context);
await new Promise(resolve => setImmediate(resolve));
const folder = couriers.document.getElementById('couriersLink');
assert.equal(folder.tagName, 'BUTTON');
assert.equal(folder.getAttribute('aria-expanded'), 'true');
folder.events.click({ preventDefault() {} });
assert.equal(folder.getAttribute('aria-expanded'), 'false');
const branches = couriers.rail.querySelectorAll('.courier-group');
assert.equal(branches.length, 2);
assert.equal(branches[0].open, false, 'account 1 must not match account 10');
assert.equal(branches[1].open, true);
assert.ok(branches[1].classList.contains('has-current'), 'selected courier heading stays marked');
assert.equal(couriers.rail.querySelector('a.acc.on').getAttribute('aria-current'), 'page');
assert.match(couriers.document.getElementById('ctree').innerHTML, /Synthetic &lt;second&gt;/);
assert.equal(couriers.rail.querySelectorAll('a.acc.on').length, 1);
branches[0].open = true; branches[0].events.toggle();
assert.equal(branches[1].open, false, 'opening a provider closes its sibling');

const pruning = source.slice(source.indexOf('      if(!s.boss && rail){'),
  source.indexOf('      if(!s.admin){'));
couriers.context.s = { boss: false, limited: true };
couriers.context.mine = [];
vm.runInContext(pruning, couriers.context);
assert.equal(couriers.document.getElementById('ctree'), null, 'denied courier tree is removed');
assert.equal(couriers.document.getElementById('couriersLink'), null, 'denied folder is removed');
assert.equal(couriers.rail.querySelectorAll('.nav-group').length, 0, 'empty permission groups are removed');
assert.ok(couriers.rail.querySelector('a[href="/logistics"]'), 'overview remains available');

for (const boss of [true, false]) {
  const ui = navigation('finance', '/');
  ui.context.window.APP.ready = Promise.resolve({ boss, name: 'Synthetic user', email: 'fixture@example.test' });
  vm.runInContext(source.slice(source.indexOf('  window.FUSION = window.FUSION || {};',
    source.indexOf('  /* ---------- the person:')),
    source.indexOf('  (function pageTools(){')), ui.context);
  const host = ui.root.appendChild(new Element('div'));
  ui.context.window.FUSION.profileMenu(host);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(!!host.querySelector('a[href="/settings#storage"]'), boss,
    'Settings/Database shortcut is offered only to the super-admin');
  assert.ok(host.querySelector('a[href="/settings#profile"]'), 'existing profile entry remains');
}

console.log('Navigation: 7 sections, active ancestors, disclosure handlers, exact account selection, rights pruning and super-admin Settings PASS');
