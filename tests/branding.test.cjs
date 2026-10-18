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
test('visible workbench string literals have no old application brand except stored legacy theme IDs',()=>{
  const failures=[];
  function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.tsx?$/.test(e.name)){
    const source=fs.readFileSync(p,'utf8');if(!/SideX|Sc-Code|\bSidex\b|\bSIDEX\b/.test(source))continue;
    const sf=ts.createSourceFile(p,source,ts.ScriptTarget.Latest,true);
    function visit(n){if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||[ts.SyntaxKind.TemplateHead,ts.SyntaxKind.TemplateMiddle,ts.SyntaxKind.TemplateTail].includes(n.kind)){
      if(n.text==='SideX Monochrome Dark')return;
      if(/SideX|Sc-Code|\bSidex\b|\bSIDEX\b/.test(n.text))failures.push(path.relative(root,p)+': '+n.text);
    }ts.forEachChild(n,visit);}visit(sf);
  }}}walk(path.join(root,'src'));assert.deepEqual(failures,[]);
});
test('canonical profile is ScCode and legacy sources and protocol remain compatible',()=>{
  assert.match(read('src-tauri/src/app_dirs.rs'),/const PROFILE_DIR_NAME: &str = "ScCode"/);
  assert.match(read('src-tauri/extension-host/storage.cjs'),/APPDATA[^\n]+ScCode/);
  assert.match(read('src-tauri/src/app_dirs.rs'),/parent\.join\("SideX"\)/);
  assert.match(read('src-tauri/src/app_dirs.rs'),/parent\.join\("Sc-Code"\)/);
  assert.match(read('index.html'),/urlProtocol: 'sidex'/);
  assert.match(read('src/bootstrap-globals.ts'),/version: '1.110.0'/);
});
test('font-independent SC editor SVG is connected to favicon and titlebar',()=>{
  const svg=read('public/sc-code.svg');assert.match(svg,/viewBox="0 0 512 512"/);
  assert.match(svg,/<title[^>]*>ScCode<\/title>/);assert.match(svg,/SC letters in a code editor/);
  assert.doesNotMatch(svg,/<(?:script|text|image|foreignObject)\b|(?:href|font-family)=/i);
  // ScBrowser keeps its blue/cyan identity; ScCode uses plum-charcoal/lavender.
  for(const color of ['#191621','#272132','#716083','#ad9bc4','#f7f2fc','#c19aff'])assert.ok(svg.includes(color),color);
  assert.doesNotMatch(svg,/#111827|#182438|#526782|#8ca0b8|#f4f8ff|#55e2c0/i);
  assert.match(read('index.html'),/href="\/sc-code\.svg"/);
  assert.match(read('src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css'),/url\("\/sc-code\.svg"\)/);
});
test('desktop icon formats and requested PNG dimensions are valid',()=>{
  for(const [name,size] of [['32x32.png',32],['128x128.png',128],['128x128@2x.png',256],['icon.png',512]]){
    const bytes=fs.readFileSync(path.join(root,'src-tauri/icons',name));assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);
  }
  const ico=fs.readFileSync(path.join(root,'src-tauri/icons/icon.ico'));assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);assert.ok(ico.readUInt16LE(4)>0);
  assert.equal(fs.readFileSync(path.join(root,'src-tauri/icons/icon.icns')).subarray(0,4).toString(),'icns');
});
