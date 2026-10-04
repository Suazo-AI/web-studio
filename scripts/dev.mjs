import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createWorker } from '../src/worker.mjs';
const port=Number(process.env.PORT||4177);
await mkdir('.local',{recursive:true});
const db=new DatabaseSync(process.env.EDITOR_TEST_DB||'.local/editor.sqlite');
const migration=await readFile('drizzle/0000_familiar_spitfire.sql','utf8').catch(async()=>{const {readdir}=await import('node:fs/promises');const file=(await readdir('drizzle')).find(x=>x.endsWith('.sql'));return readFile('drizzle/'+file,'utf8');});
if(!db.prepare("SELECT name FROM sqlite_master WHERE name='editor_projects'").get())db.exec(migration);
const DB={prepare(sql){return {bind(...args){return {async first(){return db.prepare(sql).get(...args)||null;},async run(){const result=db.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}};}};}};}};
const bundle=JSON.parse(await readFile('.local/bundle.json','utf8'));const worker=createWorker(bundle);
createServer(async(req,res)=>{
  try{
    // This adapter is local-only and is excluded from the Worker bundle. Never bind to a public interface.
    const host=req.headers.host;if(!['127.0.0.1:'+port,'localhost:'+port].includes(host)){res.writeHead(403).end();return;}
    const headers=new Headers(req.headers);headers.set('oai-authenticated-user-id','local-owner');
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const request=new Request('http://'+host+req.url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
    const response=await worker.fetch(request,{DB,EDITOR_OWNER_USER_ID:'local-owner'});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){console.error(error);res.writeHead(500).end('Local adapter error');}
}).listen(port,'127.0.0.1',()=>console.log(`Local-only editor http://127.0.0.1:${port}; source-backed drafts, no live integration`));
