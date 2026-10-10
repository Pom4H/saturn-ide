from pathlib import Path
import hashlib
p=Path('src/topology.ts');s=p.read_text();assert hashlib.sha1(f'blob {len(s.encode())}\0'.encode()+s.encode()).hexdigest()=='c66d724ee8dd8448626e6b2d745aee257126c70b'
s=s.replace("  const via=[{...s,z:high},...routingWaypoints(project,edge),{...t,z:high}],points:Point[]=[start,s,{...s,z:high}];", "  const spatial=edge.via?.some(point=>point.kind==='route-port'||point.z!==undefined);\n  const first=spatial?s:{...s,z:high},last=spatial?t:{...t,z:high};\n  const via=[first,...routingWaypoints(project,edge),last],points:Point[]=[start,s,first];")
s=s.replace('  points.push({...t,z:high},t,end);','  points.push(last,t,end);');p.write_text(s)
p=Path('tests/spatial-routing.test.ts');s=p.read_text();assert hashlib.sha1(f'blob {len(s.encode())}\0'.encode()+s.encode()).hexdigest()=='43f0d1b1a46b93467d349159007371c1c1f3ba79'
s+='''

test('explicit passages do not force an unrelated high-level detour before the first opening',()=>{
  const {model,water}=fixture();
  const opening={x:200,y:50,z:220};
  const changed={...model,pipes:[{...water,via:[opening]}]};
  const route=assertRoute(changed,'water');
  const index=route.points.findIndex(p=>p.x===opening.x&&p.y===opening.y&&p.z===opening.z);
  expect(index).toBeGreaterThan(0);
  const start=anchor(changed,water.from);
  expect(route.points.slice(0,index+1).every(p=>p.z>=opening.z&&p.z<=start.z)).toBe(true);
});
'''
p.write_text(s)
