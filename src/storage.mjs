import { initialState, fail } from './model.mjs';
export class D1Store {
  constructor(db){this.db=db;}
  async read(projectId,ownerId){
    if(!this.db)fail('STORAGE_UNAVAILABLE','El almacenamiento no está configurado',503);
    const row=await this.db.prepare('SELECT owner_id, version, state_json FROM editor_projects WHERE id = ?').bind(projectId).first();
    if(row){if(row.owner_id!==ownerId)fail('FORBIDDEN','Sin acceso a este proyecto',403);return {version:row.version,state:JSON.parse(row.state_json)};}
    // Owner identity is checked against explicit deployment configuration before this point.
    await this.db.prepare('INSERT OR IGNORE INTO editor_projects (id, owner_id, version, state_json, updated_at) VALUES (?, ?, 0, ?, ?)').bind(projectId,ownerId,JSON.stringify(initialState()),new Date().toISOString()).run();
    const created=await this.db.prepare('SELECT owner_id, version, state_json FROM editor_projects WHERE id = ?').bind(projectId).first();
    if(!created||created.owner_id!==ownerId)fail('FORBIDDEN','Sin acceso a este proyecto',403);
    return {version:created.version,state:JSON.parse(created.state_json)};
  }
  async save(projectId,ownerId,version,state){
    const json=JSON.stringify(state);if(json.length>2000000)fail('STORAGE_LIMIT','El borrador alcanzó su límite de tamaño',409);
    const result=await this.db.prepare('UPDATE editor_projects SET version = version + 1, state_json = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?').bind(json,new Date().toISOString(),projectId,ownerId,version).run();
    if(result.meta.changes!==1)fail('REVISION_CONFLICT','Otro cambio llegó antes. Recargá el proyecto.',409);
  }
}
