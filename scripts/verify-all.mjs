import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const project=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);
let runtime;
for(let i=0;i<args.length;i++){
  if(args[i]==='--runtime'&&args[i+1])runtime=path.resolve(args[++i]);
  else throw new Error('Usage: npm test -- [--runtime DIR]');
}
const scripts=fs.readdirSync(path.join(project,'scripts')).filter(name=>/^verify-.*\.mjs$/.test(name)&&!['verify-all.mjs','verify-glb.mjs'].includes(name)).sort();
let failed=0;
for(const name of scripts){
  const file=path.join(project,'scripts',name),source=fs.readFileSync(file,'utf8');
  const command=[file,...(runtime&&source.includes('--runtime')?['--runtime',runtime]:[])];
  const result=spawnSync(process.execPath,command,{cwd:project,stdio:'inherit'});
  if(result.error){console.error(name+': '+result.error.message);failed++;}
  else if(result.status!==0)failed++;
}
console.log(`Validation suites: ${scripts.length-failed} passed, ${failed} failed. GLB re-import is checked separately with npm run test:glb.`);
process.exitCode=failed?1:0;
