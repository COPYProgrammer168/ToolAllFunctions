/**
 * Verifies the cookie-file resolution:
 *   YT_COOKIES_FILE -> /tmp/yt-cookies.txt copy, path only in logs, and no
 *   deletion of a mounted file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const source = path.join(os.tmpdir(), `yt-cookies-source-${Date.now()}.txt`);
const contents = [
  '# Netscape HTTP Cookie File',
  '.youtube.com\tTRUE\t/\tTRUE\t2147483647\tSID\tabc123',
  '.tiktok.com\tTRUE\t/\tTRUE\t2145916800\tttwid\t1%7Cxyz',
].join('\n');
fs.writeFileSync(source, contents, { mode: 0o600 });
process.env.YT_COOKIES_FILE = source;

const mod = await import('../src/utils/cookies.js');
const resolved = mod.prepareCookiesFile();
console.log('source            :', source);
console.log('resolved          :', resolved);
console.log('working copy path :', mod.COOKIES_WORKING_PATH);
console.log('COPY EXISTS       :', fs.existsSync(mod.COOKIES_WORKING_PATH));
console.log('CONTENT MATCHES   :', fs.readFileSync(mod.COOKIES_WORKING_PATH, 'utf8') === contents);
console.log('IS SAME FILE      :', path.resolve(source) === path.resolve(resolved || ''));
console.log('findCookiesFile() :', mod.findCookiesFile());
// Deleting the working copy must not resurrect a stale one from an earlier run;
// the file is re-derived from the configured source instead.
fs.unlinkSync(mod.COOKIES_WORKING_PATH);
const afterDelete = mod.prepareCookiesFile();
console.log('after del -> re-copied :', afterDelete === mod.COOKIES_WORKING_PATH);
console.log('re-copy content matches :', fs.readFileSync(mod.COOKIES_WORKING_PATH, 'utf8') === contents);
console.log('source untouched  :', fs.existsSync(source));
fs.unlinkSync(mod.COOKIES_WORKING_PATH);
fs.unlinkSync(source);
process.exit(0);
