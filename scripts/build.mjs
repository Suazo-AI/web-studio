import { readFile, writeFile, mkdir, readdir, cp, rm, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { makeManifest } from '../src/model.mjs';
import { tasteMarkdown } from '../src/taste.mjs';
const root=process.env.EDITOR_PROJECT_DIR||'examples/studio-demo';
const project=JSON.parse(await readFile(`${root}/project.json`,'utf8'));
if(!/^[a-z0-9-]{1,64}$/.test(project.id))throw new Error('Invalid project ID');
const provenance=JSON.parse(await readFile(`${root}/snapshot/manifest.json`,'utf8'));
if(!provenance.files||!provenance.files['src/index.html']||!provenance.files['src/styles.css'])throw new Error('HTML/CSS hashes are required');
const assets={};
for(const [path,hash] of Object.entries(provenance.files)){
  if(!/^src\/[A-Za-z0-9_./-]+$/.test(path)||path.split('/').some(s=>!s||s==='.'||s==='..')||!/^([a-f0-9]{64})$/.test(hash))throw new Error('Unsafe source manifest entry');
  let current=`${root}/snapshot`;for(const part of path.split('/')){current+='/'+part;if((await lstat(current)).isSymbolicLink())throw new Error('Source symlinks are not allowed');}
  const data=await readFile(`${root}/snapshot/${path}`);if(createHash('sha256').update(data).digest('hex')!==hash)throw new Error(`Frozen source changed: ${path}`);
  if(path.startsWith('src/assets/')){const ext=path.split('.').at(-1),type={ttf:'font/ttf',woff2:'font/woff2',webp:'image/webp',jpg:'image/jpeg',txt:'text/plain'}[ext];if(!type)throw new Error('Unexpected asset');assets[path.slice(4)]={data:`data:${type};base64,${data.toString('base64')}`};}
}
const snapshot={html:await readFile(`${root}/snapshot/src/index.html`,'utf8'),css:await readFile(`${root}/snapshot/src/styles.css`,'utf8')};
const manifest=makeManifest(snapshot.html);
const ui={};for(const path of await readdir('ui')){if(!/\.(html|css|js)$/.test(path))throw new Error('Unexpected UI file');ui['/'+path]={content:await readFile('ui/'+path,'utf8'),type:{html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'application/javascript; charset=utf-8'}[path.split('.').at(-1)]};}
const bundle={project,snapshot,manifest,provenance,assets,ui};
await mkdir('.local',{recursive:true});await writeFile('.local/bundle.json',JSON.stringify(bundle));
const result=await build({stdin:{contents:`import { createWorker } from './src/worker.mjs'; export default createWorker(${JSON.stringify(bundle)});`,resolveDir:process.cwd(),sourcefile:'worker-entry.mjs'},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,minify:true});
await rm('dist',{recursive:true,force:true});await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});await writeFile('dist/server/index.js',result.outputFiles[0].contents);await cp('.openai/hosting.json','dist/.openai/hosting.json');await cp('drizzle','dist/.openai/drizzle',{recursive:true});await writeFile('.local/web-taste.md',tasteMarkdown(project.taste));
console.log(`Built source-backed editor: ${manifest.length} mapped elements; ${result.outputFiles[0].contents.length} Worker bytes. No Site created or deployed.`);
