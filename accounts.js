// Who may open Fusion, and how they got in.
//
// There are three doors into the same room. One is a Google account, one is an
// email address with a password the person chose, and one is a user id the admin
// of a company handed out - hmna-01 and the like. Whichever door was used, what
// ends up in the users table is the same shape, because everything after sign-in
// - the rail, the rights, the company - already works off that one row. The door
// is remembered only so a person can be told how to get back in.
//
// Nothing here decides what anybody may do. That is still the role and the rights
// on the users row, read by whoIs() in server.js. This file is only the lock.

import crypto from 'node:crypto';
import { pool } from './db.js';

// ==================== the shape of an account ====================
export async function initAccounts() {
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS login_id   TEXT,
      ADD COLUMN IF NOT EXISTS pass       TEXT,
      ADD COLUMN IF NOT EXISTS email_ok   BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS door       TEXT NOT NULL DEFAULT 'qb',
      ADD COLUMN IF NOT EXISTS made_by    TEXT,
      ADD COLUMN IF NOT EXISTS home_realm TEXT,
      ADD COLUMN IF NOT EXISTS disabled   BOOLEAN NOT NULL DEFAULT FALSE
  `);

  // A user id is typed by a person at a keyboard, so it is matched without regard
  // to case and cannot be handed out twice.
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS users_login_id_key
       ON users (LOWER(login_id)) WHERE login_id IS NOT NULL`);

  // An email address is one account, whichever door it came through, so a person
  // who signed up with a password and later uses Google lands on their own row
  // instead of a second one.
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS users_email_key
       ON users (LOWER(email)) WHERE email IS NOT NULL`);

  // The code sent to an address, kept hashed and short-lived. One row per address:
  // asking for a new code replaces the old one, which is also what stops a mailbox
  // being filled with codes that all still work.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_codes (
      email       TEXT PRIMARY KEY,
      code_hash   TEXT NOT NULL,
      name        TEXT,
      tries       INT NOT NULL DEFAULT 0,
      sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at  TIMESTAMPTZ NOT NULL
    );
  `);

  // The company a person connected is theirs to run: they hand out its user ids
  // and say what each one may touch. Written once, when the company is first
  // connected, and never moved by anything the person does afterwards.
  await pool.query(
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS owner_sub TEXT`);

  // Codes nobody came back for do not need keeping.
  await pool.query(`DELETE FROM email_codes WHERE expires_at < NOW() - INTERVAL '1 day'`);
}

// ==================== passwords ====================
// scrypt, which Node has built in, so there is no third library in the way of the
// one thing in this app that must not be got wrong. What is stored is the salt and
// the result of grinding the password against it - never the password, and never
// anything that can be turned back into it.
const SCRYPT = { N: 16384, r: 8, p: 1, len: 64 };
const SCRYPT_MEM = { maxmem: 64 * 1024 * 1024 };

export function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(plain), salt, SCRYPT.len,
    { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, ...SCRYPT_MEM });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p,
    salt.toString('base64'), key.toString('base64')].join('$');
}

// A wrong password, and a password tried on an account that has none, take the same
// work to say no to - so one cannot be told from the other by how long it took.
export function checkPassword(plain, stored) {
  const real = String(stored || '');
  const dummy = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
    Buffer.alloc(64).toString('base64');
  const parts = (real.split('$').length === 6 ? real : dummy).split('$');
  if (parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, want] = parts;
  const a = Buffer.from(want, 'base64');
  let got;
  try {
    got = crypto.scryptSync(String(plain), Buffer.from(salt, 'base64'), a.length,
      { N: Number(N), r: Number(r), p: Number(p), ...SCRYPT_MEM });
  } catch { return false; }
  if (a.length !== got.length) return false;
  const same = crypto.timingSafeEqual(a, got);
  return same && real.split('$').length === 6;
}

// What a password has to be before it is worth storing. Said plainly, because the
// person reading it is trying to get on with their work.
export function passwordComplaint(plain) {
  const s = String(plain || '');
  if (s.length < 8) return 'Password must be at least 8 characters.';
  if (s.length > 200) return 'Password is too long.';
  if (!/[A-Za-z]/.test(s)) return 'Password needs at least one letter.';
  if (!/[0-9]/.test(s)) return 'Password needs at least one number.';
  return null;
}

// ==================== verification codes ====================
const CODE_LIFE_MIN = 15;
const CODE_TRIES = 5;

const codeHash = code => crypto.createHash('sha256')
  .update(String(code) + '|fusion-email-code').digest('hex');

// Six digits, drawn properly rather than from Math.random, and kept as text so a
// leading zero is never lost to something treating it as a number.
export function newCode() {
  return String(crypto.randomInt(100000, 1000000));
}

export async function putCode(email, code, name) {
  await pool.query(
    `INSERT INTO email_codes (email, code_hash, name, tries, sent_at, expires_at)
     VALUES ($1, $2, $3, 0, NOW(), NOW() + INTERVAL '${CODE_LIFE_MIN} minutes')
     ON CONFLICT (email) DO UPDATE SET
       code_hash = $2, name = COALESCE($3, email_codes.name),
       tries = 0, sent_at = NOW(),
       expires_at = NOW() + INTERVAL '${CODE_LIFE_MIN} minutes'`,
    [String(email).toLowerCase(), codeHash(code), name || null]);
}

// A code asked for again within the minute is one impatient person clicking twice,
// so the second ask is turned away instead of filling their mailbox.
export async function codeSentRecently(email) {
  const r = await pool.query(
    `SELECT 1 FROM email_codes
      WHERE email = $1 AND sent_at > NOW() - INTERVAL '45 seconds'`,
    [String(email).toLowerCase()]);
  return r.rowCount > 0;
}

// Gives back the name that was typed at sign-up, or a complaint. A code that is
// used is gone, and five wrong guesses end it for good: guessing six digits is
// only easy if you are allowed to keep guessing.
export async function useCode(email, code) {
  const key = String(email).toLowerCase();
  const r = await pool.query('SELECT * FROM email_codes WHERE email = $1', [key]);
  const row = r.rows[0];
  if (!row) return { error: 'Ask for a code first.' };
  if (new Date(row.expires_at) < new Date()) {
    await pool.query('DELETE FROM email_codes WHERE email = $1', [key]);
    return { error: 'That code has expired. Ask for a new one.' };
  }
  if (row.tries >= CODE_TRIES) {
    await pool.query('DELETE FROM email_codes WHERE email = $1', [key]);
    return { error: 'Too many wrong tries. Ask for a new code.' };
  }
  const want = Buffer.from(row.code_hash, 'hex');
  const got = Buffer.from(codeHash(code), 'hex');
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) {
    await pool.query('UPDATE email_codes SET tries = tries + 1 WHERE email = $1', [key]);
    const left = CODE_TRIES - row.tries - 1;
    return { error: 'That code is not right.' + (left > 0 ? ' ' + left + ' tries left.' : '') };
  }
  await pool.query('DELETE FROM email_codes WHERE email = $1', [key]);
  return { ok: true, name: row.name };
}

// ==================== accounts ====================
export const EMAIL_OK = s => /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(String(s || '').trim());

// A user id is typed, read aloud and written on a note, so it is kept to letters,
// numbers and a dash - hmna-01 - and nothing that could be mistaken for something
// else on a page or in an address.
export function loginIdComplaint(id) {
  const s = String(id || '').trim();
  if (s.length < 3) return 'User ID must be at least 3 characters.';
  if (s.length > 40) return 'User ID is too long.';
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/.test(s))
    return 'User ID can use letters, numbers and dashes, and must start and end with a letter or number.';
  if (s.indexOf('@') > -1) return 'A user ID is not an email address.';
  return null;
}

export async function byEmail(email) {
  const r = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1',
    [String(email).toLowerCase().trim()]);
  return r.rows[0] || null;
}

export async function byLoginId(loginId) {
  const r = await pool.query('SELECT * FROM users WHERE LOWER(login_id) = $1',
    [String(loginId).toLowerCase().trim()]);
  return r.rows[0] || null;
}

// Somebody who proved their own address and chose their own password. They are let
// in - the door was theirs, not somebody's invitation - but they arrive with no
// company, because a company is connected, not granted. Until they connect one the
// app has nothing to show them, which is what the chooser is for. They run their
// own company once they have one, so their role is admin: of their books, not of
// this server, which is a different list entirely.
export async function createSelfAccount({ email, name, password }) {
  const key = String(email).toLowerCase().trim();
  const r = await pool.query(
    `INSERT INTO users (sub, email, name, pass, email_ok, door, allowed, role, last_in, decided_at)
     VALUES ($1, $2, $3, $4, TRUE, 'password', TRUE, 'admin', NOW(), NOW())
     ON CONFLICT (sub) DO UPDATE SET
       pass = $4, email_ok = TRUE, name = COALESCE($3, users.name), last_in = NOW()
     RETURNING sub`,
    ['pw:' + key, key, name || null, hashPassword(password)]);
  return r.rows[0].sub;
}

// A Google account has already proved the address belongs to the person, so there
// is nothing here to verify. If that same address signed up with a password first,
// this is the same person at the same desk: the row is theirs, and the password
// they set still works.
export async function upsertGoogleAccount({ googleSub, email, name }) {
  const key = email ? String(email).toLowerCase().trim() : null;
  if (key) {
    const held = await byEmail(key);
    if (held) {
      await pool.query(
        `UPDATE users SET name = COALESCE($2, name), email_ok = TRUE, last_in = NOW()
          WHERE sub = $1`, [held.sub, name || null]);
      return { sub: held.sub, first: false };
    }
  }
  const r = await pool.query(
    `INSERT INTO users (sub, email, name, email_ok, door, allowed, role, last_in, decided_at)
     VALUES ($1, $2, $3, TRUE, 'google', TRUE, 'admin', NOW(), NOW())
     ON CONFLICT (sub) DO UPDATE SET
       email = COALESCE($2, users.email), name = COALESCE($3, users.name), last_in = NOW()
     RETURNING sub, (xmax = 0) AS first_time`,
    ['g:' + googleSub, key, name || null]);
  return { sub: r.rows[0].sub, first: !!r.rows[0].first_time };
}

// A user id made by the admin of a company, for somebody in that company. It needs
// no email and verifies nothing, because the admin standing there is the proof. It
// belongs to the one company it was made for and cannot be moved to another.
export async function createMemberAccount({ loginId, name, password, realmId, madeBy, role, rights }) {
  const id = String(loginId).trim();
  const r = await pool.query(
    `INSERT INTO users (sub, login_id, name, pass, door, allowed, role, rights,
                        home_realm, made_by, decided_at)
     VALUES ($1, $2, $3, $4, 'member', TRUE, $5, $6::jsonb, $7, $8, NOW())
     RETURNING sub`,
    ['id:' + id.toLowerCase(), id, name || id, hashPassword(password),
     role || 'custom', JSON.stringify(rights || []), realmId, madeBy]);
  return r.rows[0].sub;
}

export async function listMembers(realmId) {
  const r = await pool.query(
    `SELECT sub, login_id, name, role, rights, allowed, disabled, last_in, created_at, made_by
       FROM users WHERE door = 'member' AND home_realm = $1
      ORDER BY LOWER(login_id)`, [realmId]);
  return r.rows;
}

export async function setMemberPassword(sub, password) {
  await pool.query(
    `UPDATE users SET pass = $2 WHERE sub = $1 AND door = 'member'`,
    [sub, hashPassword(password)]);
}

export async function setDisabled(sub, off) {
  await pool.query('UPDATE users SET disabled = $2 WHERE sub = $1', [sub, !!off]);
}

export async function deleteMember(sub, realmId) {
  const r = await pool.query(
    `DELETE FROM users WHERE sub = $1 AND door = 'member' AND home_realm = $2`,
    [sub, realmId]);
  return r.rowCount > 0;
}

export async function touchSignIn(sub) {
  await pool.query('UPDATE users SET last_in = NOW() WHERE sub = $1', [sub]);
}

// ==================== who owns a company ====================
// The first person to connect a company keeps it. The claim is written only where
// nobody has claimed it, so a second person connecting the same books later does
// not quietly become their admin.
export async function claimCompany(realmId, sub) {
  const r = await pool.query(
    `UPDATE companies SET owner_sub = $2
      WHERE realm_id = $1 AND (owner_sub IS NULL OR owner_sub = '')
      RETURNING owner_sub`, [realmId, sub]);
  return r.rowCount > 0;
}

export async function ownerOf(realmId) {
  const r = await pool.query('SELECT owner_sub FROM companies WHERE realm_id = $1', [realmId]);
  return (r.rows[0] && r.rows[0].owner_sub) || null;
}

export async function ownsCompany(sub, realmId) {
  if (!sub || !realmId) return false;
  return (await ownerOf(realmId)) === sub;
}
