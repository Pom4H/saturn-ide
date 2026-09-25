import { readAuthoredFiles, readAuthoringOperation, type AuthoringFrame } from '../core/authoring';
import { canonical } from '../core/artifact';
import { authoringChanges } from '../workspace/authoring-operations';
import { buildAuthoring } from '../workspace/editor-build';
import { Language } from '../workspace/language';
import { HttpError, type Workspace } from '../workspace/files';

/** Engineering-only host adapter. The compiler plans against saved source, without applying to a runtime. */
export async function planSourceOperation(workspace:Workspace,frame:AuthoringFrame|undefined,input:Record<string,unknown>,appRoot:string,dataDir:string){
  if(!frame)throw new HttpError(409,'Check the source before editing');
  const files=readAuthoredFiles(input.files),operation=readAuthoringOperation(input.operation);
  if(canonical(files)!==canonical(frame.files))throw new HttpError(409,'Save and check changed source before visual editing');
  for(const file of files)if(workspace.read(file.path).version!==file.version)throw new HttpError(409,'Source changed on disk');
  const changes=authoringChanges(files,frame,operation),candidate=files.map(file=>({...file,source:changes.find(edit=>edit.path===file.path)?.source??file.source}));
  const language=new Language(workspace,appRoot);
  try{
    for(const file of candidate)language.set(file.path,file.source);
    const problems=language.diagnostics();if(problems.length)throw new HttpError(409,problems.map(problem=>problem.message.ru).join('\n'));
    await buildAuthoring(workspace,appRoot,dataDir,undefined,candidate);
  }finally{language.dispose();}
  return changes;
}
