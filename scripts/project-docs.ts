import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import project from '../project/project';
import { projectDocumentation } from '../src/documentation';
const out=resolve('docs/generated');mkdirSync(out,{recursive:true});
for(const locale of ['ru','en'] as const)writeFileSync(resolve(out,`project.${locale}.md`),projectDocumentation(project,{locale}));
console.log('Generated docs/generated/project.ru.md and project.en.md from the canonical Project model');