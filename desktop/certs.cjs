// The certificate the Mac app serves the iPad with (issue #138).
//
// iOS only lets a home-screen web app keep itself offline (service worker) on
// a secure origin, so the archive is served to the home network over HTTPS.
// Nothing public can vouch for a name like `Studio-Mac.local`, so the app
// makes its own small certificate authority, once, and signs a certificate for
// this Mac's Bonjour name with it. The iPad trusts that authority after one
// install from the setup page (server.mjs serves it).
//
// Uses the system's /usr/bin/openssl: Node can read certificates but not make
// them. The authority's key never leaves this Mac's Application Support.

const { execFileSync } = require('node:child_process');
const { X509Certificate, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OPENSSL = '/usr/bin/openssl';
// iOS refuses a server certificate valid for more than 825 days.
const SERVER_DAYS = 800;
const RENEW_WITHIN_MS = 30 * 86_400_000;

/** This Mac's Bonjour name, without `.local` — what the iPad types. */
function localHostName() {
  try {
    const name = execFileSync('/usr/sbin/scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).trim();
    if (name) return name;
  } catch { /* not macOS, or scutil missing */ }
  return os.hostname().replace(/\.local$/i, '');
}

function openssl(args, cwd) {
  execFileSync(OPENSSL, args, { cwd, stdio: 'pipe' });
}

/** Whether `certPath` is a certificate for `host` that won't expire soon. */
function serverCertGood(certPath, host, caPath) {
  try {
    const cert = new X509Certificate(fs.readFileSync(certPath));
    const ca = new X509Certificate(fs.readFileSync(caPath));
    if (!cert.checkIssued(ca) || !cert.verify(ca.publicKey)) return false;
    if (!cert.checkHost(host)) return false;
    return Date.parse(cert.validTo) - Date.now() > RENEW_WITHIN_MS;
  } catch {
    return false;
  }
}

/**
 * Make sure `dir` holds an authority and a current certificate for `host`
 * (e.g. `Studio-Mac.local`). Returns the paths. Throws with openssl's words
 * if a certificate can't be made.
 */
function ensureCerts(dir, host) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const caKey = path.join(dir, 'ca.key');
  const caPem = path.join(dir, 'ca.pem');
  const key = path.join(dir, 'server.key');
  const cert = path.join(dir, 'server.crt');
  const cnf = path.join(dir, 'openssl.cnf');
  // The name goes in the config, not -subj: LibreSSL ignores -subj when the
  // config already names the subject, which it must for `prompt = no`.
  const writeConfig = (cn) => fs.writeFileSync(
    cnf,
    [
      '[req]',
      'distinguished_name = dn',
      'prompt = no',
      '[dn]',
      `CN = ${cn}`,
      '[ca]',
      'basicConstraints = critical, CA:TRUE',
      'keyUsage = critical, keyCertSign, cRLSign',
      'subjectKeyIdentifier = hash',
      '[server]',
      'basicConstraints = CA:FALSE',
      'keyUsage = critical, digitalSignature, keyEncipherment',
      'extendedKeyUsage = serverAuth',
      `subjectAltName = DNS:${host}, DNS:localhost, IP:127.0.0.1`,
      '',
    ].join('\n'),
  );

  if (!fs.existsSync(caKey) || !fs.existsSync(caPem)) {
    writeConfig(`Colour Archive on ${host.replace(/\.local$/i, '')}`);
    openssl(['req', '-x509', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650',
      '-keyout', caKey, '-out', caPem, '-config', cnf, '-extensions', 'ca'], dir);
    fs.chmodSync(caKey, 0o600);
    // A new authority makes every certificate it didn't sign useless.
    fs.rmSync(cert, { force: true });
  }

  if (!serverCertGood(cert, host, caPem)) {
    const csr = path.join(dir, 'server.csr');
    writeConfig(host);
    openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr, '-config', cnf], dir);
    openssl(['x509', '-req', '-sha256', '-days', String(SERVER_DAYS), '-in', csr,
      '-CA', caPem, '-CAkey', caKey, '-set_serial', `0x${randomBytes(8).toString('hex')}`,
      '-out', cert, '-extfile', cnf, '-extensions', 'server'], dir);
    fs.rmSync(csr, { force: true });
    fs.rmSync(cnf, { force: true });
    fs.chmodSync(key, 0o600);
  }
  return { key, cert, ca: caPem };
}

module.exports = { ensureCerts, localHostName, serverCertGood };
