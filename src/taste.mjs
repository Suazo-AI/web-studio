export function tasteMarkdown(taste){
 return `# web-taste.md\n\n## Scope\n${taste.scope}\nThese approved decisions apply only to this project, not universally. Editor experiments do not become preferences without explicit human approval.\n\nRevision: ${taste.revision}\n\n`+taste.decisions.map(d=>`## ${d.scope}\n- Rule: ${d.rule}\n- Status: ${d.status}\n- Evidence: ${d.evidence}\n`).join('\n');
}
