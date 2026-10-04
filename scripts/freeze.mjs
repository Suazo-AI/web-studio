import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = (process.env.EDITOR_PROJECT_DIR||'examples/studio-demo')+'/snapshot';
const files = (await readdir(root, { recursive:true, withFileTypes:true })).filter(x=>x.isFile()).map(x=>`${x.parentPath}/${x.name}`).filter(x=>!x.endsWith('manifest.json')).sort();
const hashes = {};
for (const p of files) hashes[p.slice(root.length+1)] = createHash('sha256').update(await readFile(p)).digest('hex');
await writeFile(`${root}/manifest.json`, JSON.stringify({ sourceKind:'frozen-source-draft', repository:null, commit:'synthetic-demo-v1', files:hashes },null,2)+'\n');
