import {existsSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {isIP} from 'node:net';
import {isAbsolute,relative,resolve,sep} from 'node:path';

const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const text=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
export function publicHttps(value:unknown):boolean{
  if(!text(value))return false;
  try{
    const url=new URL(value),host=url.hostname.toLowerCase();
    return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&host.includes('.')&&!isIP(host)&&!host.startsWith('[')&&
      !/^(?:localhost|example\.(?:com|org|net))$/.test(host)&&!/(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(host);
  }catch{return false;}
}
/** Documented submission subset, not the official uploader/schema, a secret scan, or an approval guarantee. */
export function validateAppPlugin(root:string,scope:'local'|'public'='local'){
  const blockers:string[]=[];
  const issue=(message:string)=>blockers.push(message);
  const json=(name:string):Record<string,unknown>=>{
    try{return object(JSON.parse(readFileSync(resolve(root,name),'utf8')));}catch{issue(`Cannot read JSON: ${name}`);return {};}
  };
  const asset=(value:unknown,label:string):string|undefined=>{
    if(!text(value)||!value.startsWith('./')){issue(`${label}: include a ./ relative asset path`);return;}
    try{
      const path=realpathSync(resolve(root,value)),within=relative(realpathSync(root),path);
      if(isAbsolute(within)||within==='..'||within.startsWith('..'+sep))throw new Error('outside package');
      const stat=statSync(path);if(!stat.isFile()||stat.size>5*1024*1024)throw new Error('invalid asset');
      return path;
    }catch{issue(`${label}: missing, oversized or escaped package asset`);return;}
  };
  const manifest=json('plugin.json'),openai=object(object(manifest.extensions)['com.openai']),listing=object(openai.interface);
  if(manifest.$schema!=='https://agent-plugins.org/schemas/1.0.0/plugin.schema.json')issue('Use the portable Agent Plugins manifest schema');
  if(!text(manifest.name)||manifest.name.length>64||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.name))issue('Invalid stable plugin name');
  for(const [field,max] of [['displayName',30],['shortDescription',30],['longDescription',4000],['developerName',80],['category',120]] as const){
    const value=listing[field];if(!text(value)||value.length>max)issue(`${field}: required, maximum ${max} characters`);
  }
  for(const field of ['logo','composerIcon']){
    const path=asset(listing[field],field);
    if(path?.endsWith('.svg')){
      const svg=readFileSync(path,'utf8'),viewBox=svg.match(/viewBox=["']([^"']+)["']/)?.[1]?.trim().split(/[ ,]+/).map(Number);
      const width=Number(svg.match(/\bwidth=["'](\d+(?:\.\d+)?)["']/)?.[1]),height=Number(svg.match(/\bheight=["'](\d+(?:\.\d+)?)["']/)?.[1]);
      if(!(width>=48&&width===height)&&!(viewBox?.length===4&&viewBox[2]!>=48&&viewBox[2]===viewBox[3]))issue(`${field}: SVG needs square dimensions or viewBox of at least 48`);
    }
  }
  const skill=resolve(root,'skills/engineering/SKILL.md');
  if(!existsSync(skill)||!/^---\r?\n[\s\S]*?\bname:\s*\S+[\s\S]*?\bdescription:\s*\S+[\s\S]*?\r?\n---/.test(readFileSync(skill,'utf8')))issue('Saturn engineering skill requires name and description frontmatter');
  const servers=object(json('mcp.json').mcpServers),entries=Object.entries(servers);
  if(entries.length!==1)issue('Saturn requires exactly one MCP server for the current public connection flow');
  for(const [name,entry] of entries){
    const server=object(entry);
    if(server.type!=='streamable-http'||!text(server.url))issue(`${name}: Streamable HTTP URL required`);
    if(scope==='public'){
      if(!publicHttps(server.url))issue(`${name}: public submission requires a real HTTPS hostname; loopback/Tunnel mapping is local setup`);
      if(server.headers||server.env)issue(`${name}: keep connection credentials outside the public package`);
    }
  }
  if(scope==='public'){
    if(openai.apps||manifest.apps||existsSync(resolve(root,'.app.json')))issue('Public submission does not accept apps/.app.json references');
    if(openai.hooks||manifest.hooks||existsSync(resolve(root,'hooks')))issue('Public submission does not accept lifecycle hooks');
    for(const field of ['websiteURL','supportURL','privacyPolicyURL','termsOfServiceURL'])if(!publicHttps(listing[field]))issue(`${field}: real public HTTPS publisher page required for MCP review`);
    const review=object(openai.review),cases=object(review.test_cases);
    for(const [kind,count] of [['positive',5],['negative',3]] as const){
      const list=cases[kind];
      if(!Array.isArray(list)||list.length!==count){issue(`review.test_cases.${kind}: exactly ${count} review cases required`);continue;}
      for(const entry of list){
        const item=object(entry),required=kind==='positive'?['description','prompt','tools_triggered','expected_behavior']:['description','prompt'];
        if(required.some(field=>!text(item[field])))issue(`review.test_cases.${kind}: incomplete case`);
      }
    }
    if(!publicHttps(review.demo_recording_url))issue('review.demo_recording_url: accessible walkthrough URL required');
    if(review.test_credentials||review.reviewer_instructions)issue('Reviewer credentials/instructions belong in the secure portal form');
  }
  return {scope,package:manifest.name??null,packageChecksPassed:blockers.length===0,blockers,
    unchecked:scope==='public'?['Official ZIP/schema validation and skill scans','Verified publishing identity and portal permissions','MCP domain verification, OAuth/authorization and tool review','Real ChatGPT desktop/mobile test-account runs and accessible review recording','OpenAI review, approval and publication']:['Official package schema and installation','Real ChatGPT account registration and Secure MCP Tunnel connection']};
}
if(import.meta.main){
  const scope=process.argv.includes('--public')?'public':'local',path=process.argv.slice(2).find(arg=>!arg.startsWith('--'));
  const report=validateAppPlugin(resolve(path??resolve(import.meta.dir,'../.agents/plugins/saturn')),scope);
  console.log(JSON.stringify(report,null,2));process.exitCode=report.packageChecksPassed?0:1;
}
