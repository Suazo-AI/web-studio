import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const editorProjects = sqliteTable('editor_projects', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  version: integer('version').notNull(),
  stateJson: text('state_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});
