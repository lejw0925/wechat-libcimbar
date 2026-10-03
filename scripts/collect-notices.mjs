import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const upstream = 'third_party/libcimbar';
const thirdParty = upstream + '/src/third_party_lib';
const entries = [
  ['libcimbar — Mozilla Public License 2.0', `${upstream}/LICENSE`],
  ['OpenCV 4.11.0 — Apache License 2.0', '.cache/opencv/LICENSE'],
  ['zlib (OpenCV dependency)', '.cache/opencv/3rdparty/zlib/LICENSE'],
  ...['wirehair', 'libcorrect', 'zstd', 'fmt', 'intx', 'libpopcnt', 'stb', 'base91'].map(name => [name, `${thirdParty}/${name}/LICENSE`])
];
const result = spawnSync('em-config', ['EMSCRIPTEN_ROOT'], { encoding: 'utf8' });
if (result.status !== 0) throw new Error('em-config is required to collect runtime license notices');
const emRoot = result.stdout.trim();
const emLicense = [path.join(emRoot, 'LICENSE'), path.join(emRoot, '../LICENSE')].find(file => fs.existsSync(file));
if (!emLicense) throw new Error('Cannot locate the Emscripten license');
entries.push(['Emscripten runtime', emLicense]);
for (const [name, file] of [
  ['musl libc', 'libc/musl/COPYRIGHT'], ['LLVM libc++', 'libcxx/LICENSE.TXT'],
  ['LLVM libc++abi', 'libcxxabi/LICENSE.TXT'], ['LLVM compiler-rt', 'compiler-rt/LICENSE.TXT']
]) entries.push([name, path.join(emRoot, 'system/lib', file)]);

let notice = 'CIMBAR receiver — third-party notices\n\n' +
  'libcimbar source: https://github.com/sz3/libcimbar/tree/bfb0c8e471820ae493cd3694ea6bed5d5ac06c37\n' +
  'OpenCV source: https://github.com/opencv/opencv/tree/4.11.0\n' +
  'The decoder adapter (native/decoder.cpp) is provided under MPL-2.0.\n' +
  'Adapter source and build scripts are supplied with this project in native/ and scripts/.\n' +
  'CFC is a design reference; no Android application code is included.\n';
for (const [name, file] of entries) notice += `\n\n${'='.repeat(72)}\n${name}\n${'='.repeat(72)}\n\n${fs.readFileSync(file, 'utf8')}`;
// base91 contains an additional notice from Joachim Henke in its source header.
notice += '\n\nAdditional basE91 attribution:\n' + fs.readFileSync(`${thirdParty}/base91/base.hpp`, 'utf8').split('#pragma once')[0];
fs.mkdirSync('miniprogram/licenses', { recursive: true });
fs.writeFileSync('miniprogram/licenses/THIRD_PARTY_NOTICES.txt', notice);
console.log(`Collected ${entries.length} license notices (${Buffer.byteLength(notice)} bytes).`);
