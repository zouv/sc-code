'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('ScCode display identity agrees across web, native and extension environments',()=>{
  const conf=JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.equal(conf.productName,'ScCode');assert.equal(conf.app.windows[0].title,'ScCode');
  assert.match(read('index.html'),/<title>ScCode<\/title>/);
  assert.match(read('src-tauri/Cargo.toml'),/\[\[bin\]\]\s+name = "ScCode"/);
  for(const p of ['src/bootstrap-globals.ts','src/main.ts','src/vs/platform/product/common/product.ts']){
    assert.match(read(p),/nameShort: 'ScCode'/);assert.match(read(p),/nameLong: 'ScCode'/);
  }
  for(const p of ['src-tauri/extension-host/host.cjs','src-tauri/extension-host/server.cjs'])assert.match(read(p),/appName: 'ScCode'/);
  assert.match(read('src-tauri/src/commands/extension_platform.rs'),/app_name: "ScCode"/);
  assert.match(read('src-tauri/src/commands/extension_wasm.rs'),/"ScCode"\.to_string\(\)/);
});
test('independent product identity and updates do not reference an old release channel',()=>{
  const pkg=JSON.parse(read('package.json'));
  const conf=JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.equal(pkg.name,'sc-code');assert.equal(conf.productName,'ScCode');
  assert.equal(pkg.version,conf.version);assert.equal(conf.identifier,'dev.sccode.app');
  assert.equal(conf.plugins.updater,undefined);
  for(const file of fs.readdirSync(path.join(root,'.github/workflows'))){
    const text=fs.readFileSync(path.join(root,'.github/workflows',file),'utf8');
    assert.doesNotMatch(text,/siden\.dev|siden\.ai|s3:\/\/|SC_CODE_SIGNING|tauri-action|contents:\s*write/);
  }
});
test('custom mechanisms have become ordinary feature modules',()=>{
  const main=read('src/main.ts');
  for(const name of ['vsix-install/vsixInstall','accessibility/accessibleViewInformationService','extension-sync/extensionSync'])assert.ok(main.includes(`./sc-code/${name}.contribution`));
  assert.doesNotMatch(main,/CUSTOMIZATIONS\/src/);
});
test('visible workbench string literals contain no old application branding',()=>{
  const oldBrand = ['s','i','d','e','x'].join('');
  const oldBrandRx = new RegExp(oldBrand, 'i');
  const failures=[];
  function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.tsx?$/.test(e.name)){
    const source=fs.readFileSync(p,'utf8');if(!oldBrandRx.test(source))continue;
    const sf=ts.createSourceFile(p,source,ts.ScriptTarget.Latest,true);
    function visit(n){if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||[ts.SyntaxKind.TemplateHead,ts.SyntaxKind.TemplateMiddle,ts.SyntaxKind.TemplateTail].includes(n.kind)){
      if(oldBrandRx.test(n.text))failures.push(path.relative(root,p)+': '+n.text);
    }ts.forEachChild(n,visit);}visit(sf);
  }}}walk(path.join(root,'src'));assert.deepEqual(failures,[]);
});
test('canonical profile and protocol are ScCode-owned',()=>{
  assert.match(read('src-tauri/src/app_dirs.rs'),/const PROFILE_DIR_NAME: &str = "ScCode"/);
  assert.match(read('src-tauri/extension-host/storage.cjs'),/APPDATA[^\n]+ScCode/);
  assert.doesNotMatch(read('src-tauri/src/app_dirs.rs'),/migration|legacy/i);
  assert.match(read('index.html'),/urlProtocol: 'sc-code'/);
  assert.match(read('src/bootstrap-globals.ts'),/version: '1.110.0'/);
});
test('font-independent SC editor SVG is connected to favicon and titlebar',()=>{
  const svg=read('public/sc-code.svg');assert.match(svg,/viewBox="0 0 512 512"/);
  assert.match(svg,/<title[^>]*>ScCode<\/title>/);assert.match(svg,/SC monogram in a plum-charcoal editor window/);
  assert.doesNotMatch(svg,/<(?:script|text|image|foreignObject)\b|(?:href|font-family)=/i);
  // ScBrowser keeps its blue/cyan identity; ScCode uses plum-charcoal/lavender.
  for(const color of ['#272132','#675477','#b59bcf','#f0e5ff','#f7f2fc','#c19aff','#e8d9ff'])assert.ok(svg.includes(color),color);
  assert.doesNotMatch(svg,/#111827|#182438|#526782|#8ca0b8|#f4f8ff|#55e2c0/i);
  assert.match(read('index.html'),/href="\/sc-code\.svg"/);
  assert.match(read('src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css'),/url\("\/sc-code\.svg"\)/);
});
test('desktop icon formats and requested PNG dimensions are valid',()=>{
  for(const [name,size] of [['32x32.png',32],['128x128.png',128],['128x128@2x.png',256],['icon.png',512]]){
    const bytes=fs.readFileSync(path.join(root,'src-tauri/icons',name));assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);
  }
  const ico=fs.readFileSync(path.join(root,'src-tauri/icons/icon.ico'));assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);
  assert.equal(ico.readUInt16LE(4),7);
  assert.equal(fs.readFileSync(path.join(root,'src-tauri/icons/icon.icns')).subarray(0,4).toString(),'icns');
});
test('About dialog displays the product icon',()=>{
  const handler=read('src/vs/workbench/browser/parts/dialogs/dialogHandler.ts');
  assert.match(handler,/imageIcon:\s*'\/sc-code\.svg'/);
  assert.match(handler,/imageIconAlt:\s*'ScCode'/);
  assert.match(read('src/vs/base/browser/ui/dialog/dialog.ts'),/dialog-image-icon/);
  assert.match(read('src/vs/base/browser/ui/dialog/dialog.css'),/\.dialog-image-icon-image/);
});
test('titlebar app icon precedes the menu and project label',()=>{
  const css=read('src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css');
  const block=selector=>{
    const match=css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*\\{([^}]*)\\}'));
    assert.ok(match,selector);return match[1];
  };
  assert.match(block('.monaco-workbench .part.titlebar > .titlebar-container > .titlebar-left > .window-appicon'),/order:\s*0/);
  assert.match(block('.monaco-workbench .part.titlebar > .titlebar-container > .titlebar-left > .menubar'),/order:\s*1/);
  assert.match(block('.monaco-workbench .part.titlebar .sc-code-project-name'),/order:\s*2/);
});
test('recent folders and workspaces are wired to a Windows jump list',()=>{
  assert.match(read('src/main.ts'),/recentJumpList\.contribution\.js/);
  assert.match(read('src/sc-code/taskbar/recentJumpList.contribution.ts'),/taskbar_update_jump_list/);
  assert.match(read('src-tauri/src/lib.rs'),/taskbar::taskbar_update_jump_list/);
  assert.match(read('src-tauri/src/taskbar.rs'),/ICustomDestinationList/);
  assert.match(read('src-tauri/Cargo.toml'),/Win32_UI_Shell/);
});
