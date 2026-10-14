import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { load } from 'js-yaml';
const version = JSON.parse(await fs.readFile('package.json', 'utf8')).version;
const metadata = process.platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml';
const info = load(await fs.readFile(path.join('release', metadata), 'utf8'));
if (info.version !== version) throw new Error('Update metadata version does not match package.json.');
if (!info.files?.length) throw new Error('No update artifacts generated.');
for (const file of info.files) {
  if (file.url !== path.basename(file.url)) throw new Error('Update URL must name a release asset.');
  const hash = crypto.createHash('sha512');
  for await (const chunk of createReadStream(path.join('release', file.url))) hash.update(chunk);
  if (hash.digest('base64') !== file.sha512) throw new Error(`Invalid update checksum: ${file.url}`);
}
console.log(`${metadata}: version ${version}, all artifact checksums verified.`);
