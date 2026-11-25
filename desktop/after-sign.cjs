// electron-builder's afterSign hook (package.json build.afterSign): signs the
// app again with the one release certificate, "Colour Archive Release", so
// every build has the same designated requirement and macOS keeps its
// permissions across updates (desktop/updater.cjs checks downloads against it).
// The certificate is self-signed, and electron-builder signs only with
// identities `security find-identity -v` calls valid, so it signs ad hoc
// ("identity": "-") and this runs codesign itself, before the .dmg and .zip
// are made.
//
// The release job imports the certificate into a temporary keychain and names
// it in COLOUR_ARCHIVE_SIGN_KEYCHAIN; the identity must then be there. With no
// keychain named, the keychain search list is asked, and with no certificate
// there either (a fork's pull request) the ad hoc signature stays.

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const IDENTITY = 'Colour Archive Release';

const run = (file, args) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const keychain = process.env.COLOUR_ARCHIVE_SIGN_KEYCHAIN || null;
  const inKeychain = keychain ? [keychain] : [];

  let identities = '';
  try {
    identities = run('/usr/bin/security', ['find-identity', '-p', 'codesigning', ...inKeychain]);
  } catch (err) {
    if (keychain) throw err;
  }
  if (!identities.includes(`"${IDENTITY}"`)) {
    if (keychain) throw new Error(`No "${IDENTITY}" identity in ${keychain}.`);
    console.log(`  • no "${IDENTITY}" certificate here: ${path.basename(app)} stays signed ad hoc`);
    return;
  }

  // codesign finds the identity only in a keychain on the search list; the
  // release job puts the temporary one there.
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', IDENTITY, ...(keychain ? ['--keychain', keychain] : []), app]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  console.log(`  • signed with "${IDENTITY}": ${run('/usr/bin/codesign', ['-d', '-r-', app])}`);
};
