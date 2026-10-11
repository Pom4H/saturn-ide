import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeGeometry,minimumQuadraticRadius,flattenRoute,segmentSeparation} from '../src/core/route-geometry';
import {inspectPipeInstallation,type InstallationPipe,type InstallationRules,type InstallationFitting} from '../src/core/pipe-installation';
const p=(x:number,y:number,z=0)=>({x,y,z});
const pipe=(id:string,points:ReturnType<typeof p>[],diameter=60):InstallationPipe=>({id,points,outsideDiameterMm:diameter,millimetresPerUnit:1,visualInset:12});
const policy:InstallationRules={minimumGapMm:10,minimumBendRadiusMm:0,fittings:[]};
const parallel=(y:number,z=0)=>[pipe('a',[p(0,0),p(1000,0)]),pipe('b',[p(0,y,z),p(1000,y,z)])];
const near=(a:number,b:number,e=1e-6)=>assert(Math.abs(a-b)<e,`${a} is not near ${b}`);

test('quadratic minimum curvature is not mislabeled as its visual inset',()=>{
  near(minimumQuadraticRadius(p(0,0),p(12,0),p(12,12)),12/Math.sqrt(2));
  const geometry=routeGeometry([p(0,0),p(100,0),p(100,100)],12);
  assert.equal(geometry.bends.length,1);near(geometry.bends[0]!.minimumRadius,12/Math.sqrt(2));
  assert.deepEqual(geometry.curves[0]!.from,p(0,0));assert.deepEqual(geometry.curves.at(-1)!.to,p(100,100));
});
test('fixed named passages and sharp reversals cannot be silently rounded away',()=>{
  const source=[p(0,0),p(100,0),p(100,100)],copy=JSON.stringify(source);
  const geometry=routeGeometry(source,12,[p(100,0)]);
  assert.equal(geometry.bends[0]!.minimumRadius,0);assert(geometry.bends[0]!.fixed);
  assert.equal(JSON.stringify(source),copy);
  const reverse=routeGeometry([p(0,0),p(100,0),p(0,0)]);
  assert.equal(reverse.bends[0]!.minimumRadius,0);
});
test('segment distance handles interior skew crossing, parallel and degenerate segments',()=>{
  near(segmentSeparation(p(0,0),p(10,0),p(5,-5,3),p(5,5,3)).distance,3);
  near(segmentSeparation(p(0,0),p(10,0),p(2,4),p(8,4)).distance,4);
  near(segmentSeparation(p(0,0),p(0,0),p(3,4),p(3,4)).distance,5);
  near(segmentSeparation(p(0,0),p(1e7,0),p(0,-.1),p(1e7,.1)).distance,0,1e-7);
});
test('curve subdivision retains conservative deviation bounds when work is exhausted',()=>{
  const geometry=routeGeometry([p(0,0),p(100,0),p(100,100)],12);
  const fine=flattenRoute(geometry.curves,.01,256);
  assert(fine.complete);assert(fine.spans.every(span=>span.deviation<=.01));
  const coarse=flattenRoute(geometry.curves,.000001,3);
  assert(!coarse.complete);assert(coarse.spans.some(span=>span.deviation>.000001));
});
test('outside-surface gap uses both actual radii, not centerline distance or DN',()=>{
  assert.equal(inspectPipeInstallation(parallel(100),policy).status,'clear');
  const tight=inspectPipeInstallation(parallel(65),policy);
  assert.equal(tight.status,'violation');const gap=tight.findings.find(item=>item.code==='PIPE_GAP');assert(gap);
  near(gap.lowerMm!,5);near(gap.upperMm!,5);assert.equal(gap.requiredMm,10);
  assert.equal(inspectPipeInstallation(parallel(50),{...policy,minimumGapMm:0}).status,'violation');
});
test('3D-separated crossings are allowed; same-floor crossings collide',()=>{
  const a=pipe('horizontal',[p(-100,0),p(100,0)]),b=pipe('vertical',[p(0,-100,100),p(0,100,100)]);
  assert.equal(inspectPipeInstallation([a,b],policy).status,'clear');
  const crossed={...b,points:b.points.map(point=>({...point,z:0}))};
  assert(inspectPipeInstallation([a,crossed],policy).findings.some(issue=>issue.code==='PIPE_GAP'));
});
test('an exact threshold and sub-millimetre uncertainty never turn green',()=>{
  const report=inspectPipeInstallation(parallel(70),policy);
  assert.equal(report.status,'incomplete');assert(report.findings.some(f=>f.code==='PRECISION_LIMIT'));
});
test('missing diameter, scale and engineering rules remain explicitly unverified',()=>{
  const a=pipe('a',[p(0,0),p(1000,0)]);
  assert(inspectPipeInstallation([{...a,outsideDiameterMm:undefined}],policy).findings.some(f=>f.code==='MISSING_DIAMETER'));
  assert(inspectPipeInstallation([{...a,millimetresPerUnit:undefined}],policy).findings.some(f=>f.code==='MISSING_SCALE'));
  assert.equal(inspectPipeInstallation([a]).status,'incomplete');
  assert.equal(inspectPipeInstallation([],policy).status,'incomplete');
});
test('minimum bend check uses current geometry in physical mm, including short-leg clamping',()=>{
  const a={...pipe('a',[p(0,0),p(100,0),p(100,100)]),millimetresPerUnit:10};
  const report=inspectPipeInstallation([a],{...policy,minimumBendRadiusMm:100});
  const finding=report.findings.find(f=>f.code==='BEND_RADIUS');assert(finding);
  near(finding.actualMm!,120/Math.sqrt(2));assert.equal(finding.requiredMm,100);
  assert.equal(inspectPipeInstallation([a],{...policy,minimumBendRadiusMm:80}).status,'clear');
});
test('numerical decisions are invariant to translating and swapping the XYZ axes',()=>{
  const scene=parallel(65),first=inspectPipeInstallation(scene,policy);
  const transformed=scene.map(item=>({...item,points:item.points.map(point=>p(point.z+2000,point.x-2500,point.y+10000))}));
  const second=inspectPipeInstallation(transformed,policy);
  assert.equal(second.status,first.status);near(second.findings[0]!.upperMm!,first.findings[0]!.upperMm!,1e-7);
});
test('pair budget exhaustion cannot masquerade as a clear installation',()=>{
  const many=[...parallel(100),pipe('c',[p(0,200),p(1000,200)])];
  const report=inspectPipeInstallation(many,{...policy,maxSpanPairs:1});
  assert.equal(report.status,'incomplete');assert(report.findings.some(f=>f.code==='BUDGET_EXCEEDED'));
});
const fitting:InstallationFitting={id:'union',source:'manufacturer:test-fixture',from:p(0,0),to:p(100,0),outsideDiameterMm:100,
  ports:[{pipeId:'a',end:'from',outsideDiameterMm:60}]};
test('fitting envelope and actual port diameter participate in validation',()=>{
  const a=pipe('a',[p(0,0),p(-1000,0)]);
  assert.equal(inspectPipeInstallation([a],{...policy,fittings:[fitting]}).status,'clear');
  const b=pipe('b',[p(50,-100),p(50,100)]);
  const report=inspectPipeInstallation([a,b],{...policy,fittings:[fitting]});
  assert(report.findings.some(f=>f.code==='FITTING_GAP'));
  const wrong={...fitting,ports:[{pipeId:'a',end:'from' as const,outsideDiameterMm:50}]};
  assert(inspectPipeInstallation([a],{...policy,fittings:[wrong]}).findings.some(f=>f.code==='FITTING_PORT_SIZE'));
});
test('association with a fitting cannot exempt an inward or returning pipe from clashes',()=>{
  const inward=pipe('a',[p(0,0),p(200,0)]);
  assert(inspectPipeInstallation([inward],{...policy,fittings:[fitting]}).findings.some(f=>f.code==='FITTING_GAP'));
  const returning=pipe('a',[p(0,0),p(-100,0),p(-100,100),p(50,100),p(50,-100)]);
  assert(inspectPipeInstallation([returning],{...policy,fittings:[fitting]}).findings.some(f=>f.code==='FITTING_GAP'));
});
test('invalid dimensions and foreign fitting references are not accepted',()=>{
  assert.throws(()=>inspectPipeInstallation(parallel(100),{minimumGapMm:-1}));
  assert.throws(()=>inspectPipeInstallation(parallel(100),{...policy,fittings:[{...fitting,outsideDiameterMm:NaN}]}));
  assert(inspectPipeInstallation(parallel(100),{...policy,fittings:[{...fitting,ports:[{pipeId:'missing',end:'to',outsideDiameterMm:60}]}]}).findings.some(f=>f.code==='UNKNOWN_FITTING_PIPE'));
});

test('1000 deterministic segment cases preserve symmetry and witness distance',()=>{
  let seed=123456;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2000-1000;};
  for(let i=0;i<1000;i++){
    const a=p(next(),next(),next()),b=p(next(),next(),next()),c=p(next(),next(),next()),d=p(next(),next(),next());
    const ab=segmentSeparation(a,b,c,d),ba=segmentSeparation(c,d,a,b);
    near(ab.distance,ba.distance,1e-7);near(ab.distance,Math.hypot(ab.a.x-ab.b.x,ab.a.y-ab.b.y,ab.a.z-ab.b.z),1e-7);
    const reverse=segmentSeparation(b,a,d,c);near(ab.distance,reverse.distance,1e-7);
  }
});
test('sampled quadratic centerline lies inside the analytical chord error envelope',()=>{
  const geometry=routeGeometry([p(0,0,0),p(70,10,80),p(120,100,50)],12);
  const flat=flattenRoute(geometry.curves,.01,2048);assert(flat.complete);
  for(const curve of geometry.curves){if(curve.kind!=='quadratic')continue;
    for(let i=0;i<=100;i++){const t=i/100,s=1-t;
      const point=p(s*s*curve.from.x+2*s*t*curve.control.x+t*t*curve.to.x,
        s*s*curve.from.y+2*s*t*curve.control.y+t*t*curve.to.y,
        s*s*curve.from.z+2*s*t*curve.control.z+t*t*curve.to.z);
      const nearest=Math.min(...flat.spans.map(span=>segmentSeparation(point,point,span.from,span.to).distance));
      assert(nearest<=.01000001,'Approximation exceeded its analytical error bound');
    }
  }
});
