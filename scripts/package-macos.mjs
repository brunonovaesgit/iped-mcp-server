import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('O pacote macOS deve ser gerado em um Mac.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'package');
const app = join(output, 'IPED MCP.app');
const resources = join(app, 'Contents/Resources/app');
const macos = join(app, 'Contents/MacOS');
const run = (file, args, options = {}) => execFileSync(file, args, { cwd: root, stdio: 'inherit', ...options });
const arch = process.arch;
if (!['arm64', 'x64'].includes(arch)) throw new Error('Arquitetura não suportada: ' + arch);
const version = '22.20.0';
const archive = `node-v${version}-darwin-${arch}.tar.gz`;
const cache = join(output, 'cache');
mkdirSync(cache, { recursive: true });
if (!existsSync(join(cache, archive))) run('/usr/bin/curl', ['-fSL', `https://nodejs.org/dist/v${version}/${archive}`, '-o', join(cache, archive)]);
run('/usr/bin/curl', ['-fsSL', `https://nodejs.org/dist/v${version}/SHASUMS256.txt`, '-o', join(cache, 'SHASUMS256.txt')]);
const expected = readFileSync(join(cache, 'SHASUMS256.txt'), 'utf8').split('\n').find(line => line.endsWith('  ' + archive))?.split(' ')[0];
if (!expected || createHash('sha256').update(readFileSync(join(cache, archive))).digest('hex') !== expected) throw new Error('Checksum do Node inválido.');
rmSync(app, { recursive: true, force: true });
mkdirSync(macos, { recursive: true });
mkdirSync(join(resources, 'runtime'), { recursive: true });
for (const name of ['dist', 'package.json', 'package-lock.json', 'README.md', '.env.example']) cpSync(join(root, name), join(resources, name), { recursive: true });
// Install production dependencies in the bundle; never include the maintainer's .env or audit files.
run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--prefix', resources]);
run('/usr/bin/tar', ['-xzf', join(cache, archive), '--strip-components=1', '-C', join(resources, 'runtime')]);
const bundleVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
writeFileSync(join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>IPED MCP</string>
<key>CFBundleDisplayName</key><string>IPED MCP</string>
<key>CFBundleIdentifier</key><string>br.com.novaes.iped-mcp</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>${bundleVersion}</string>
<key>CFBundleShortVersionString</key><string>${bundleVersion}</string>
<key>CFBundleExecutable</key><string>iped-mcp</string>
<key>LSMinimumSystemVersion</key><string>11.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>`);
const executable = join(macos, 'iped-mcp');
run('/usr/bin/xcrun', ['swiftc', '-O', '-target', `${arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx11.0`, '-module-cache-path', join(cache, 'swift'), join(root, 'macos/Launcher.swift'), '-o', executable]);
chmodSync(executable, 0o755);
run('/usr/bin/plutil', ['-lint', join(app, 'Contents/Info.plist')]);
const node = join(resources, 'runtime/bin/node');
run(node, ['--version'], { cwd: '/private/tmp', env: { PATH: '/usr/bin:/bin' } });
for (const name of ['launch.js', 'connect-iped.js', 'investigator-http.js']) run(node, ['--check', join(resources, 'dist', name)]);
run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
const zip = join(output, `iped-mcp-macos-${arch}.zip`);
run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
console.log(`Pacote criado: ${app}\nArquivo de distribuição: ${zip}`);
