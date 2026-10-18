#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  custom-sidex —— release 打包脚本（只打包，不改版本号）
 *
 *  作用：读取并打印当前版本号（四处核对），然后跑 `npm run build:custom` 出安装包，最后列出产物。
 *  **不修改任何版本号文件** —— 版本号请用 CUSTOMIZATIONS/docs/commands.md §4 的四处清单手工同步。
 *  产物在仓库根 target/release/bundle/（不是 src-tauri/target/，见 docs/pitfalls.md #4）。
 *
 *  用法（仓库根）：
 *     node CUSTOMIZATIONS/scripts/release.js
 *  或双击 CUSTOMIZATIONS/scripts/build-release.bat（等价，带 pause）。
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const PKG = path.join(ROOT, 'package.json');
const TAURI_CONF = path.join(ROOT, 'src-tauri', 'tauri.conf.json');
const CARGO_TOML = path.join(ROOT, 'src-tauri', 'Cargo.toml');
const BUNDLE_DIR = path.join(ROOT, 'target', 'release', 'bundle');

function fail(message) {
	console.error(`[X] ${message}`);
	process.exit(1);
}

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readCargoVersion(file) {
	const content = fs.readFileSync(file, 'utf8');
	const matched = content.match(/^version\s*=\s*"([^"]*)"/m);
	return matched ? matched[1] : '(unknown)';
}

function walk(dir, out = []) {
	if (!fs.existsSync(dir)) {
		return out;
	}
	for (const name of fs.readdirSync(dir)) {
		const full = path.join(dir, name);
		const stat = fs.statSync(full);
		if (stat.isDirectory()) {
			walk(full, out);
		} else {
			out.push(full);
		}
	}
	return out;
}

function main() {
	// 1) 打印当前版本号供核对（只读，不改动任何文件）
	const pkgVersion = readJson(PKG).version;
	const conf = readJson(TAURI_CONF);
	const confVersion = conf.version;
	const wixVersion = conf.bundle?.windows?.wix?.version ?? '(missing)';
	const cargoVersion = readCargoVersion(CARGO_TOML);

	console.log('=== 当前版本号（四处）===');
	console.log(`  package.json             : ${pkgVersion}`);
	console.log(`  tauri.conf.json version  : ${confVersion}`);
	console.log(`  tauri wix.version        : ${wixVersion}`);
	console.log(`  src-tauri/Cargo.toml     : ${cargoVersion}`);
	if (pkgVersion !== confVersion || pkgVersion !== cargoVersion) {
		console.log('  [!] 警告：版本号不一致，请先手工同步（见 CUSTOMIZATIONS/docs/pitfalls.md #4）');
	}
	console.log('');

	// 2) 打包
	console.log('=== 开始打包（npm run build:custom，已内置 AWS_LC_SYS_PREBUILT_NASM=1）===');
	// Windows 下 npm 是 npm.cmd，spawnSync 直接 spawn 会 EINVAL，必须 shell:true 走 cmd.exe
	const result = spawnSync('npm', ['run', 'build:custom'], {
		stdio: 'inherit',
		cwd: ROOT,
		env: process.env,
		shell: true
	});
	if (result.status !== 0) {
		fail(`打包失败（退出码 ${result.status}）`);
	}

	// 3) 列出产物
	console.log('');
	console.log('=== 产物 ===');
	const artifacts = walk(BUNDLE_DIR).filter(f => /\.(msi|exe|dmg|AppImage|deb)$/i.test(f));
	if (artifacts.length === 0) {
		console.log('  [X] 未在 target/release/bundle/ 找到安装包（注意看上面是否出现 "Finished N bundles at:"）');
		process.exit(1);
	}
	for (const f of artifacts) {
		const size = (fs.statSync(f).size / 1024 / 1024).toFixed(1);
		console.log(`  ${f}  (${size} MB)`);
	}
	console.log('');
	console.log('提示：判断成功看上面是否有 "Finished N bundles at:"，编译成功 != 打包成功（见 pitfalls.md #4）。');
}

main();
