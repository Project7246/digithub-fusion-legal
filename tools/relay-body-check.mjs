// The relay hands a courier's body back without Content-Encoding, so anything
// compressed arrives as bytes with nothing saying so. This is what readBody()
// has to survive. Synthetic only - no network, no database.
import assert from 'node:assert/strict';
import { gzipSync, deflateSync } from 'node:zlib';
import { readBody, NO_ZIP } from '../wire.js';

// a Response-alike, which is all readBody touches
const body = (buf) => ({ arrayBuffer: async () => buf });

const html = '<form><input name="_token" value="abc123xyz"></form>';

// plain text comes back as itself
assert.equal(await readBody(body(Buffer.from(html, 'utf8'))), html);

// gzip with no Content-Encoding - the exact shape that broke the Trax sign-in
const zipped = gzipSync(Buffer.from(html, 'utf8'));
assert.equal(zipped[0], 0x1f);
assert.equal(zipped[1], 0x8b);
assert.equal(await readBody(body(zipped)), html);

// and the token can be found in what comes out, which is the point of it
assert.match(await readBody(body(zipped)), /name="_token" value="abc123xyz"/);

// zlib-wrapped deflate
assert.equal(await readBody(body(deflateSync(Buffer.from(html, 'utf8')))), html);

// something that merely starts with the gzip bytes and is not gzip must not
// throw - it is handed back as it came
const liar = Buffer.from([0x1f, 0x8b, 0x41, 0x42, 0x43]);
assert.equal(await readBody(body(liar)).then(s => s.length > 0), true);

// empty body
assert.equal(await readBody(body(Buffer.alloc(0))), '');

// and we ask for plain text in the first place
assert.deepEqual(NO_ZIP, { 'Accept-Encoding': 'identity' });

console.log('Relay body decoding checks passed (synthetic data only).');
