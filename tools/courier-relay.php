<?php
// The same relay as tools/courier-relay.js, for Hostinger instead of
// Cloudflare - so it can be set up without opening a new account anywhere.
//
// Why a relay at all: sonic.pk (Trax) answers from a PTCL address inside
// Pakistan, and Fusion is hosted in DigitalOcean's Bangalore region. The
// reach check on /couriers shows it plainly - the name resolves, and then
// nothing answers on port 443. The traffic has to go round by a network that
// can see both sides.
//
// Whether Hostinger's server can see sonic.pk is the one thing to find out,
// and it takes a minute: put this file up, set the two variables in
// DigitalOcean, and press "Can this server reach Trax?" again. If it is still
// red, their server is in the same position as ours and the Cloudflare worker
// is the one to use instead.
//
// Setting it up:
//
//   1. Hostinger -> File Manager -> public_html, upload this file. Rename it to
//      something nobody would guess, e.g. relay-7f3a91.php.
//   2. Open it once and set $KEY below to a long random string first - the
//      file refuses everything until you do. That string is typed into the file
//      on the server and nowhere else: it is a secret, so it never comes back
//      into git, and a key that has been in git is a key to replace.
//      Setting it below is also the only copy that matters - the one in
//      DigitalOcean has to match it character for character.
//   3. In DigitalOcean, on the app component's Environment Variables:
//        COURIER_RELAY      = https://availity.pk/relay-7f3a91.php
//        COURIER_RELAY_KEY  = the same string as $KEY
//      and press **Save**, then redeploy.
//
//      Plainly, with no `?u={url}` on the end: DigitalOcean reads braces in a
//      value as a variable of its own and refuses to save the line at all
//      (`Unexpected "}" at 43`). An address ending in .php is understood here
//      without it - see relayed() in wire.js.
//   4. /couriers -> "Can this server reach Trax?" should come back green. That
//      check walks the relay too, so it says which of the two is broken: a red
//      `tcp` with a green `relay` is the expected answer here - Bangalore
//      cannot see sonic.pk directly and does not need to.
//
// The target is passed as a query parameter rather than as a path, which is
// what `?u={url}` used to say out loud and what the .php ending now says by
// itself. Somewhere that does save braces, the placeholder still works.

$KEY = '';   // <- put a long random string here, the same one as COURIER_RELAY_KEY

// Only these hosts are ever forwarded to. A relay that forwards wherever it is
// told is an open proxy with your domain's name on it.
$ALLOWED = ['sonic.pk', 'www.sonic.pk', 'app.sonic.pk'];

header('Content-Type: application/json');

if ($KEY === '') {
    http_response_code(500);
    exit('{"error":"this relay has no key set yet"}');
}

// The key, compared in constant time - a plain === on a secret tells a patient
// guesser how much of it was right.
$given = isset($_SERVER['HTTP_X_RELAY_KEY']) ? $_SERVER['HTTP_X_RELAY_KEY'] : '';
if (!hash_equals($KEY, $given)) {
    http_response_code(401);
    exit('{"error":"no"}');
}

$target = isset($_GET['u']) ? $_GET['u'] : '';
$parts = parse_url($target);
if (!$parts || empty($parts['host']) || empty($parts['scheme'])) {
    http_response_code(400);
    exit('{"error":"not a URL"}');
}
if (!in_array(strtolower($parts['host']), $ALLOWED, true) ||
    !in_array($parts['scheme'], ['http', 'https'], true)) {
    http_response_code(403);
    exit('{"error":"not a host this relay serves"}');
}

// Everything the courier needs and nothing of ours: the relay key is dropped
// here rather than being passed on to them.
$pass = [];
foreach (getallheaders() as $name => $value) {
    $low = strtolower($name);
    if ($low === 'x-relay-key' || $low === 'host' || $low === 'content-length') continue;
    if (strpos($low, 'cf-') === 0 || strpos($low, 'x-forwarded') === 0) continue;
    $pass[] = $name . ': ' . $value;
}

$method = $_SERVER['REQUEST_METHOD'];
$body = ($method === 'GET' || $method === 'HEAD') ? null : file_get_contents('php://input');

// The three headers that have to come back, and why.
//
// A courier's API needs none of them. A courier's **portal** needs all three:
// it signs us in by setting a cookie, and it answers a sign-in with a 302 to
// the page it wants us on - so a relay that quietly follows the redirect and
// drops the cookie hands back a login page and the sign-in looks like a wrong
// password. The redirect is passed back as it came and Fusion reads it.
$backCookies = [];
$backLocation = '';

$ch = curl_init($target);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_HTTPHEADER     => $pass,
    CURLOPT_TIMEOUT        => 25,
    CURLOPT_CONNECTTIMEOUT => 12,
    CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$backCookies, &$backLocation) {
        $at = strpos($line, ':');
        if ($at !== false) {
            $name = strtolower(trim(substr($line, 0, $at)));
            $value = trim(substr($line, $at + 1));
            if ($name === 'set-cookie') $backCookies[] = $value;
            if ($name === 'location')   $backLocation = $value;
        }
        return strlen($line);
    }
]);
if ($body !== null && $body !== '') curl_setopt($ch, CURLOPT_POSTFIELDS, $body);

$answer = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$type = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$err = curl_error($ch);
curl_close($ch);

if ($answer === false) {
    // this server cannot reach them either - said plainly, so it is not
    // mistaken for the courier refusing us
    http_response_code(502);
    exit(json_encode(['error' => 'relay could not reach ' . $parts['host'] . ': ' . $err]));
}

http_response_code($code ? $code : 502);
if ($type) header('Content-Type: ' . $type);
header('X-Relayed-To: ' . $parts['host']);

// Handed back as they came. `false` on the second argument is what lets more
// than one Set-Cookie line through - with the default each one would replace
// the last, and a portal that sets two cookies at sign-in would lose one.
foreach ($backCookies as $line) header('Set-Cookie: ' . $line, false);
if ($backLocation !== '') header('Location: ' . $backLocation, true, $code ? $code : 302);

echo $answer;
