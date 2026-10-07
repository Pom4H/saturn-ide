import {summarizeSources} from './git-summary';
import type { GitReview } from '../core/git';
import type { GitState, GitCommit, GitBranch } from '../core/git';
import type { Workspace } from './files';
export async function execute(argv: string[], cwd: string, timeout = 15000): Promise<string> {
  const process = Bun.spawn(argv, { cwd, stdin:'ignore', stdout: 'pipe', stderr: 'pipe', env: { ...Bun.env, GIT_TERMINAL_PROMPT: '0' } });
  let expired = false;
  const timer = setTimeout(() => { expired = true; process.kill(); }, timeout);
  try {
    const [out, err, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
    if (expired) throw new Error('Command timed out');
    if (code !== 0) throw new Error((err || out || `Command exited ${code}`).slice(0, 4000));
    return out.slice(0, 100_000);
  } finally { clearTimeout(timer); }
}
export class Git {
  constructor(readonly workspace: Workspace) {}
  private run(...args: string[]) { return execute(['git', ...args], this.workspace.root); }
  private fetchedAt:number|null=null;
  private async head(){return (await this.run('rev-parse','--verify','HEAD')).trim();}
  private validHash(hash:string){if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash))throw new Error('Expected a full commit hash');return hash;}
  private async branchTitle(name:string):Promise<string|undefined> {
    // Read one ordinary local branch field, never expose the repository configuration.
    const description=await this.run('config','--local','--get','--',`branch.${name}.description`).catch(()=>'');
    const title=description.split(/[\r\n\u2028\u2029]/).map(line=>line.replace(/[\x00-\x1f\x7f]/g,'').trim()).find(Boolean);
    return title?Array.from(title).slice(0,120).join(''):undefined;
  }
  private async localBranches(mainHead:string|null):Promise<GitBranch[]> {
    const raw=await this.run('for-each-ref','--format=%(refname:lstrip=2)%00%(objectname)%00%(HEAD)%00%(subject)','refs/heads/');
    const ancestors=new Map<string,Promise<boolean|null>>();
    return Promise.all(raw.split('\n').filter(Boolean).map(async row=>{
      const [name='',head='',current='',...subject]=row.split('\0');
      this.validHash(head);
      if(mainHead&&!ancestors.has(head))ancestors.set(head,this.run('rev-list','--count','--max-count=1',`${mainHead}..${head}`)
        .then(value=>value.trim()==='0'?true:value.trim()==='1'?false:null,()=>null));
      const title=await this.branchTitle(name);
      return {name,head,current:current==='*',subject:subject.join('\0'),...(title?{title}:{}),merged:mainHead?await ancestors.get(head)!:null};
    }));
  }
  private async taskHead(expectedHead:string|undefined):Promise<string> {
    if(!expectedHead)throw new Error('Task branch actions require the reviewed HEAD');
    this.validHash(expectedHead);
    const head=await this.head().catch(()=>{throw new Error('A committed HEAD is required for task branches');});
    if(head!==expectedHead)throw new Error('HEAD changed; refresh before continuing');
    // The workspace may be a subdirectory. Switching changes the whole checkout,
    // so unrelated staged, unstaged and untracked files must also block it.
    if((await this.run('status','--porcelain=v1','--untracked-files=all','--ignore-submodules=none')).trim())
      throw new Error('Task branch actions require a clean repository, including tracked and untracked files');
    return head;
  }
  private taskName(title:string|undefined):string {
    if(typeof title!=='string'||!title.trim()||title.length>200||/[\x00-\x1f\x7f]/.test(title))
      throw new Error('A single-line task title of 1–200 characters is required');
    const slug=Array.from(title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,''))
      .slice(0,60).join('').replace(/-+$/g,'');
    if(!slug)throw new Error('A task title must contain letters or numbers');
    return `task/${slug}-${crypto.randomUUID().slice(0,8)}`;
  }
  private async taskBranch(name:string|undefined):Promise<string> {
    if(typeof name!=='string'||!name||name.length>250||name.trim()!==name||name.startsWith('-')
      ||name.startsWith('refs/')||name==='HEAD'||name==='@')throw new Error('A valid local branch name is required');
    // Validate the complete ref, not --branch's @{-n} expansion. Do not guess a
    // remote tracking branch or accept revision expressions such as HEAD~1.
    await this.run('check-ref-format',`refs/heads/${name}`).catch(()=>{throw new Error('A valid local branch name is required');});
    await this.run('show-ref','--verify',`refs/heads/${name}`).catch(()=>{throw new Error('The local task branch does not exist');});
    return name;
  }
  async preview(hash:string){return this.run('diff','--no-ext-diff','--no-color','HEAD',this.validHash(hash),'--','.');}
  async review(commit?:string):Promise<GitReview> {
    const to=commit?this.validHash(commit):'working',head=await this.head().catch(()=>null);
    const from=commit?(await this.run('rev-list','--parents','-n','1',to)).trim().split(' ')[1]??null:head;
    const base=from??(await this.run('hash-object','-t','tree','--stdin')).trim();
    const args=commit?[base,to]:[base];
    let [tracked,untracked,diff]=await Promise.all([
      this.run('diff','--relative','--name-only','-z',...args,'--','.'),
      commit?Promise.resolve(''):this.run('ls-files','--others','--exclude-standard','-z','--','.'),
      this.run('diff','--no-ext-diff','--no-color','--relative',...args,'--','.'),
    ]);
    for(const path of untracked.split('\0').filter(Boolean)){if(diff.length>=100_000)break;try{const source=this.workspace.read(path).source,lines=source.split('\n');if(lines.at(-1)==='')lines.pop();diff+=`diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n`+lines.map(line=>'+'+line).join('\n')+'\n';}catch{/* Binary and unsupported files stay in the file list. */}}
    diff=diff.slice(0,100_000);
    const files=[...new Set((tracked+untracked).split('\0').filter(Boolean))];
    const sources=[];let limited=diff.length>=100_000||files.length>60;
    for(const path of files.filter(p=>/\.tsx?$/.test(p)).slice(0,60)){
      const read=async(ref:string|null)=>ref?this.run('show',`${ref}:./${path}`).catch(()=>''):'';
      const before=await read(from),after=commit?await read(to):(()=>{try{return this.workspace.read(path).source;}catch{return '';}})();
      if(before.length>=100_000||after.length>=100_000){limited=true;continue;}
      sources.push({path,before,after});
    }
    return {from,to,diff,files,changes:summarizeSources(sources),limited};
  }
  async status():Promise<GitState> {
    const empty:GitState={available:false,branch:'',head:'',status:'',log:'',remotes:'',diff:'',commits:[],branches:[],mainRef:null,ahead:0,behind:0,fetchedAt:this.fetchedAt};
    try{await this.run('rev-parse','--git-dir');}catch{return {...empty,installed:await this.run('--version').then(()=>true,()=>false)};}
    const [branch,status,remotes,head]=await Promise.all([this.run('branch','--show-current'),this.run('status','--porcelain=v1','--','.'),this.run('remote'),this.head().catch(()=>'')]);
    const remote=remotes.trim().split('\n').find(r=>r==='origin')??remotes.trim().split('\n')[0];
    const candidates=['refs/remotes/origin/main','refs/heads/main',...(remote&&remote!=='origin'?[`refs/remotes/${remote}/main`]:[])];
    let mainRef:string|null=null,mainHead:string|null=null;
    for(const candidate of candidates){
      const commit=await this.run('rev-parse','--verify',`${candidate}^{commit}`).then(value=>value.trim(),()=>null);
      if(commit){mainRef=candidate;mainHead=commit;break;}
    }
    const [raw,diff,counts,branches]=await Promise.all([
      head?this.run('log','--all','--topo-order','-60','--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1e'):Promise.resolve(''),
      head?this.run('diff','HEAD','--','.'):this.run('diff','--cached','--','.'),
      head&&mainHead?this.run('rev-list','--left-right','--count',`${head}...${mainHead}`):Promise.resolve('0 0'),
      this.localBranches(mainHead),
    ]);
    const commits:GitCommit[]=raw.split('\x1e').filter(s=>s.trim()).map(row=>{const [hash='',parents='',name='',email='',date='',subject='',refs='']=row.trim().split('\x1f');return {hash,parents:parents?parents.split(' '):[],name,email,date,subject,refs};});
    const [ahead=0,behind=0]=counts.trim().split(/\s+/).map(Number);
    return {...empty,available:true,installed:true,branch:branch.trim()||'detached',head,status,remotes:remotes.trim(),diff,commits,branches,log:commits.slice(0,5).map(c=>`${c.hash.slice(0,7)} ${c.subject}`).join('\n'),mainRef,ahead,behind};
  }
  async action(action: string, message?: string, options:{expectedHead?:string;commit?:string}={}) {
    if(action==='create-task'||action==='switch-task'){
      const expectedHead=await this.taskHead(options.expectedHead);
      const branch=action==='create-task'?this.taskName(message):await this.taskBranch(message);
      if(action==='create-task'){
        await this.run('check-ref-format',`refs/heads/${branch}`);
        const metadata=`branch.${branch}.description`,exists=()=>this.run('show-ref','--verify',`refs/heads/${branch}`).then(()=>true,()=>false);
        if(await exists()||await this.run('config','--local','--get','--',metadata).then(()=>true,()=>false))throw new Error('Task branch name already exists; retry creation');
        // Set the title first: a config write failure must not silently create a task.
        await this.run('config','--local','--replace-all','--',metadata,message!.trim());
        try{
          await this.taskHead(expectedHead);
          await this.run('switch','--no-guess','--no-overwrite-ignore','-c',branch,expectedHead);
        }catch(error){
          // A post-checkout hook may fail after Git creates the branch; retain its title in that case.
          if(!await exists())await this.run('config','--local','--unset-all','--',metadata).catch(()=>{});
          throw error;
        }
      }else{
        await this.taskHead(expectedHead);
        await this.run('switch','--no-guess','--no-overwrite-ignore',branch);
      }
      return this.status();
    }
    if(options.expectedHead!==undefined&&await this.head()!==options.expectedHead)throw new Error('HEAD changed; refresh before continuing');
    if (action === 'init') await this.run('init', '-b', 'main');
    else if (action === 'commit') {
      if (!message?.trim() || message.length > 500) throw new Error('A commit message is required');
      await this.run('add', '--', '.'); await this.run('commit', '--only', '-m', message, '--', '.');
    } else if(action==='fetch'){
      await this.run('fetch','--all','--prune');this.fetchedAt=Date.now();
    } else if (action === 'pull'||action==='pull-main') {
      if ((await this.run('status', '--porcelain')).trim()) throw new Error('Commit or stash changes before pulling');
      if(action==='pull')await this.run('pull','--ff-only');
      else{await this.run('fetch','--all','--prune');this.fetchedAt=Date.now();const state=await this.status();if(!state.mainRef)throw new Error('No main branch');await this.run('merge','--ff-only',state.mainRef);}
    } else if(action==='restore'){
      if(!options.expectedHead||!options.commit)throw new Error('Restore requires the reviewed HEAD and commit');
      const hash=this.validHash(options.commit);
      if((await this.run('status','--porcelain')).trim())throw new Error('Commit or stash all changes before restoring');
      await this.run('merge-base','--is-ancestor',hash,'HEAD');
      if(!(await this.preview(hash)).trim())throw new Error('Project already matches this commit');
      await this.run('restore',`--source=${hash}`,'--staged','--worktree','--','.');
      await this.run('commit','--only','-m',`Restore project to ${hash.slice(0,12)}`,'--','.');
    } else if (action === 'push') await this.run('push');
    else throw new Error('Unsupported Git action');
    return this.status();
  }
}
