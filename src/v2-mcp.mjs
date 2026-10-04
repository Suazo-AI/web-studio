import {fail} from './model.mjs';
export const v2ToolSchemas=[
 {name:'v2_open_editor',description:'Open the separate V2 draft editor. No deployment or V1 change.',inputSchema:{type:'object',additionalProperties:false,properties:{},required:[]}},
 {name:'v2_inspect_document',description:'Read the current source-backed layer graph, revision and source fingerprint. Deleted layers are explicit tombstones.',inputSchema:{type:'object',additionalProperties:false,properties:{project_id:{type:'string'}},required:['project_id']}},
 {name:'v2_list_saved_changes',description:'Read immutable V2 draft revisions, operations and exact source hashes. No write side effects.',inputSchema:{type:'object',additionalProperties:false,properties:{project_id:{type:'string'}},required:['project_id']}},
 {name:'v2_export_draft',description:'Read exact HTML/CSS for a specified saved V2 revision. Human review and separately authorized integration/deployment required.',inputSchema:{type:'object',additionalProperties:false,properties:{project_id:{type:'string'},revision_id:{type:'string'}},required:['project_id','revision_id']}},
].map(t=>({...t,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}}));
export async function invokeV2Tool(service,name,args,owner,origin,projectId){
 const schema=v2ToolSchemas.find(t=>t.name===name)?.inputSchema;
 if(!schema)fail('UNKNOWN_TOOL','Herramienta V2 desconocida',404);
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(schema.properties,k))||schema.required.some(k=>typeof args[k]!=='string'))fail('INVALID_ARGUMENTS','Argumentos V2 inválidos');
 if(name==='v2_open_editor')return {url:origin+'/v2',editor_version:2,draft_only:true,deployed:false};
 if(args.project_id!==projectId)fail('FORBIDDEN','Proyecto V2 no disponible',403);
 if(name==='v2_export_draft')return service.invoke('export',{revision_id:args.revision_id},owner);
 const state=await service.invoke('load',{},owner);
 if(name==='v2_list_saved_changes')return {project_id:projectId,head:state.head,source_fingerprint:state.sourceFingerprint,history:state.history,draft_only:true,deployed:false};
 return {project_id:projectId,head:state.head,source_fingerprint:state.sourceFingerprint,document:state.document,draft_only:true,deployed:false};
}
