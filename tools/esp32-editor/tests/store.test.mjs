import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {packLayout} from '../src/layout/package-layout.mts';
import {defaultProject} from '../src/layout/default-project.mts';
test('actual firmware C store validates and commits packages with interruption recovery',t=>{
 if(spawnSync('gcc',['--version']).status!==0){t.skip('host GCC is not installed');return;}
 const dir=mkdtempSync(path.join(tmpdir(),'optimuse-store-test-'));t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(tmpdir()));assert.ok(path.basename(dir).startsWith('optimuse-store-test-'));rmSync(dir,{recursive:true,force:true});});
 const source=fileURLToPath(new URL('./layout-store.c',import.meta.url)),exe=path.join(dir,'store.exe'),packet=path.join(dir,'layout.oui');writeFileSync(packet,packLayout(defaultProject()));
 const build=spawnSync('gcc',['-std=c11','-O1','-I'+path.dirname(source),source,'-o',exe],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 const result=spawnSync(exe,[packet],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/PASS/);
});
