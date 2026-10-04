import { EditorError, fail } from './model.mjs';
import { D1Store } from './storage.mjs';
import { makeService, toolSchemas } from './service.mjs';
import { previewHTML } from './preview.mjs';
import { makeV2Service } from './v2-service.mjs';
import {v2ToolSchemas,invokeV2Tool} from './v2-mcp.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
export function createWorker(bundle){
  const PROJECT_ID=bundle.project.id;
  return {async fetch(request,env){
    let rpcId=null;
    try {
      const url=new URL(request.url),path=url.pathname,isMcp=path==='/mcp'||path==='/mcp/v2',isV2Mcp=path==='/mcp/v2';
      if(request.method==='OPTIONS')return new Response(null,{status:405});
      if(path==='/health')return json({ok:true,app:'visual-editor',data:false});
      let body;
      if(request.method==='POST'){
        if(!request.headers.get('content-type')?.startsWith('application/json'))fail('CONTENT_TYPE','Se requiere application/json',415);
        if(Number(request.headers.get('content-length')||0)>65536)fail('BODY_LIMIT','Solicitud demasiado grande',413);
        const reader=request.body?.getReader();let size=0;const chunks=[];if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();fail('BODY_LIMIT','Solicitud demasiado grande',413);}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}const raw=new TextDecoder().decode(bytes);
        try{body=JSON.parse(raw);}catch{fail('INVALID_JSON','JSON inválido');}
      }
      if(isMcp){
        rpcId=body?.id??null;
        if(request.method!=='POST')return json({error:'Use POST'},405);
        if(!body||Array.isArray(body)||body.jsonrpc!=='2.0'||typeof body.method!=='string')return json({jsonrpc:'2.0',id:body?.id??null,error:{code:-32600,message:'Invalid Request'}},400);
        if(body.method==='initialize')return json({jsonrpc:'2.0',id:body.id??null,result:{protocolVersion:'2024-11-05',capabilities:{tools:{listChanged:false}},serverInfo:{name:isV2Mcp?'source-visual-editor-v2':'source-visual-editor',version:isV2Mcp?'0.2.0':'0.1.0'},instructions:'Source-backed drafts only. No tool writes to the live source website or deploys changes.'}});
        if(body.method==='notifications/initialized')return new Response(null,{status:202});
        if(body.method==='tools/list')return json({jsonrpc:'2.0',id:body.id??null,result:{tools:isV2Mcp?v2ToolSchemas:toolSchemas}});
        if(body.method!=='tools/call')return json({jsonrpc:'2.0',id:body.id??null,error:{code:-32601,message:'Method not found'}},404);
      }
      // Sites is the only production identity boundary. No body/header-supplied substitute or first-user claim.
      const owner=env.EDITOR_OWNER_USER_ID;
      if(!owner)fail('OWNER_NOT_CONFIGURED','El editor aún no tiene propietario configurado',503);
      const user=request.headers.get('oai-authenticated-user-id');
      if(!user)fail('UNAUTHENTICATED','Iniciá sesión para abrir el editor',401);
      if(user!==owner)fail('FORBIDDEN','No tenés acceso a este editor',403);
      const origin=request.headers.get('origin');if(origin&&origin!==url.origin)fail('ORIGIN_FORBIDDEN','Origen no permitido',403);
      const service=makeService({...bundle,store:new D1Store(env.DB)});
      if(isMcp){
        let result;try{if(isV2Mcp)result=await invokeV2Tool(makeV2Service({...bundle,store:new D1Store(env.DB)}),body.params?.name,body.params?.arguments??{},user,url.origin,PROJECT_ID);else result=await service.invoke(body.params?.name,body.params?.arguments??{},user,url.origin,{transport:'mcp'});}catch(error){if(!(error instanceof EditorError))throw error;return json({jsonrpc:'2.0',id:body.id??null,result:{content:[{type:'text',text:JSON.stringify({code:error.code,message:error.message})}],isError:true}});}
        return json({jsonrpc:'2.0',id:body.id??null,result:{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:false}});
      }
      if(path.startsWith('/api/v2/')){const action=path.slice('/api/v2/'.length);if(action==='load'?request.method!=='GET':request.method!=='POST')fail('METHOD_NOT_ALLOWED','Método no permitido',405);const v2=makeV2Service({...bundle,store:new D1Store(env.DB)});return json(await v2.invoke(action,body||{},user));}
      if(path==='/api/project'&&request.method==='GET')return json(await service.invoke('project',{project_id:PROJECT_ID},user,url.origin));
      if(path==='/api/action'&&request.method==='POST'){if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.action!=='string'||(body.args!==undefined&&(!body.args||typeof body.args!=='object'||Array.isArray(body.args))))fail('INVALID_ARGUMENTS','Solicitud inválida');return json(await service.invoke(body.action,{project_id:PROJECT_ID,...body.args},user,url.origin,{transport:'ui'}));}
      if(path==='/preview'&&request.method==='GET'){
        const nonce=url.searchParams.get('nonce');if(!/^[a-f0-9-]{36}$/.test(nonce||''))fail('INVALID_NONCE','Vista inválida');
        const rev=await service.getRevision(user,url.searchParams.get('revision'));
        const html=previewHTML(bundle.snapshot,bundle.manifest,rev.edits,bundle.assets,{nonce,project_id:PROJECT_ID,revision_id:rev.id});
        return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':`default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts`,'referrer-policy':'no-referrer'}});
      }
      if((path==='/v2'||path==='/v2/'||path==='/v2.html')&&request.method==='GET'){
        const nonce=crypto.randomUUID();const content=bundle.ui['/v2.html'].content.replace('</head>',`<meta name="v2-preview-nonce" content="${nonce}"></head>`);
        return new Response(content,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':`default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; connect-src 'self'; font-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,'referrer-policy':'no-referrer'}});
      }
      const asset=bundle.ui[path==='/'?'/index.html':path];
      if(asset&&request.method==='GET')return new Response(asset.content,{headers:{'content-type':asset.type,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",'referrer-policy':'no-referrer'}});
      return json({error:{code:'NOT_FOUND',message:'Ruta desconocida'}},404);
    }catch(error){
      const status=error instanceof EditorError?error.status:503;
      if(!(error instanceof EditorError))console.error('Editor storage/runtime unavailable',error.message);
      const detail={code:error instanceof EditorError?error.code:'UNAVAILABLE',message:error instanceof EditorError?error.message:'El editor no pudo guardar o cargar los datos. Tus cambios sin guardar siguen en el panel.'};
      if(['/mcp','/mcp/v2'].includes(new URL(request.url).pathname))return json({jsonrpc:'2.0',id:rpcId,error:{code:-32000,message:detail.message,data:{code:detail.code}}},status);
      return json({error:detail},status);
    }
  }};
}
