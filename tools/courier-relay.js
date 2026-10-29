// A relay for a courier that cannot be reached from where this app is hosted.
//
// Why it exists: sonic.pk - Trax's platform - answers from a PTCL address
// inside Pakistan, and Fusion is hosted in DigitalOcean's Bangalore region.
// Those two networks do not reliably see each other, so the call times out from
// the server while the same call from a laptop in Karachi is instant. No key
// and no code can fix that; the traffic has to go a different way.
//
// This is a Cloudflare Worker. Cloudflare's network sees both sides, it is free
// at this volume, and it adds a few dozen milliseconds. It is a **relay for
// these hosts only** and it will not forward anywhere else, because a worker
// that forwards wherever it is told is an open proxy with your name on it.
//
// Setting it up, once:
//
//   1. dash.cloudflare.com -> Workers & Pages -> Create -> Worker. Name it
//      something like `fusion-courier-relay`. Paste this whole file in as the
//      worker's code and Deploy. It will have an address like
//      https://fusion-courier-relay.<your-subdomain>.workers.dev
//   2. Settings -> Variables -> add a secret called RELAY_KEY. Make it long
//      and random - `openssl rand -hex 24`, or any 40-odd characters nobody
//      could guess. Nothing can use the relay without it.
//   3. In DigitalOcean, on the app component's Environment Variables, add:
//        COURIER_RELAY      = https://fusion-courier-relay.<...>.workers.dev
//        COURIER_RELAY_KEY  = the same secret
//      and press **Save**. (COURIER_RELAY_HOSTS is optional - it defaults to
//      the sonic.pk hosts, which are the only ones that need this.)
//   4. Redeploy, then on /couriers press "Can this server reach Trax?" - it
//      should come back green, and adding the account will work.
//
// Everything else - PostEx and M&P - is behind Cloudflare or Azure already and
// goes straight out, so it never touches this.

// Only these. Anything else gets a flat no, whoever is asking.
const ALLOWED = [
  'sonic.pk',
  'www.sonic.pk',
  'app.sonic.pk'
];

export default {
  async fetch(request, env) {
    // The key is the whole of the lock. Compared in constant time, because a
    // == on a secret tells a patient guesser how much of it was right.
    const given = request.headers.get('X-Relay-Key') || '';
    if (!env.RELAY_KEY || !same(given, env.RELAY_KEY)) {
      return new Response('no', { status: 401 });
    }

    // the address being relayed is the rest of the path, whole:
    //   /https://sonic.pk/api/cities?x=1
    const here = new URL(request.url);
    const target = here.pathname.slice(1) + (here.search || '');

    let to;
    try { to = new URL(target); }
    catch (e) { return new Response('not a URL', { status: 400 }); }

    if (!ALLOWED.includes(to.hostname.toLowerCase())) {
      return new Response('not a host this relay serves', { status: 403 });
    }
    if (to.protocol !== 'https:' && to.protocol !== 'http:') {
      return new Response('not a scheme this relay serves', { status: 403 });
    }

    // Everything the courier needs, and nothing of ours: the relay key is
    // dropped here rather than being passed on to them.
    const out = new Headers();
    for (const [k, v] of request.headers) {
      const key = k.toLowerCase();
      if (key === 'x-relay-key' || key === 'host' || key.startsWith('cf-')) continue;
      out.set(k, v);
    }

    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();

    try {
      const answer = await fetch(to.toString(), {
        method: request.method,
        headers: out,
        body,
        // Not followed. A courier's API never redirects; a courier's portal
        // answers a sign-in with a 302 and sets the session cookie on it, so
        // following it here would drop the one thing the call was for and the
        // sign-in would read as a wrong password.
        redirect: 'manual'
      });

      // handed back as it came, so the adapter reads the courier's own words
      const back = new Headers(answer.headers);
      back.delete('content-encoding');
      back.delete('content-length');
      back.set('X-Relayed-To', to.hostname);

      // Set-Cookie is the one header that can be there more than once, and
      // copying the headers folds them into a single line. Put back one by one.
      if (typeof answer.headers.getSetCookie === 'function') {
        back.delete('set-cookie');
        for (const line of answer.headers.getSetCookie()) back.append('Set-Cookie', line);
      }

      return new Response(answer.body, { status: answer.status, headers: back });
    } catch (e) {
      // the relay could not reach them either - said plainly, so it is not
      // mistaken for the courier refusing us
      return new Response('relay could not reach ' + to.hostname + ': ' + e.message,
                          { status: 502 });
    }
  }
};

function same(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
