import { useEffect, useRef, useState } from 'react';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { equipmentSignal, type Equipment, type Point } from '../core';
import { advancePhase, flowOf, numeric, rpmOf } from '../motion';
import type { SceneProps } from './scene';
// Diagram x/y maps to world x/z; port elevation maps to world y. No independent 3D topology.
const vector=(p:Point)=>new T.Vector3(p.x,p.z,p.y);
export default function Scene3D(props:SceneProps){
  const host=useRef<HTMLDivElement>(null),current=useRef(props);current.current=props;
  const [error,setError]=useState('');
  const rebuild=useRef<()=>void>(()=>{}),fit=useRef<()=>void>(()=>{});
  useEffect(()=>{
    const node=host.current!;let renderer:T.WebGLRenderer;
    try{renderer=new T.WebGLRenderer({antialias:true,alpha:false});}catch(e){setError(String(e));return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;node.append(renderer.domElement);
    const scene=new T.Scene(),camera=new T.PerspectiveCamera(42,1,.01,200);camera.position.set(-4,8,10);
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=2;controls.maxDistance=40;controls.maxPolarAngle=Math.PI*.48;
    const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;room.dispose();pmrem.dispose();
    scene.add(new T.HemisphereLight(0xeaf5ff,0x8a999a,1.5));
    const sun=new T.DirectionalLight(0xfff4df,3);sun.position.set(-3,9,4);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-10;sun.shadow.camera.right=10;sun.shadow.camera.top=10;sun.shadow.camera.bottom=-10;sun.shadow.normalBias=.025;sun.shadow.camera.updateProjectionMatrix();scene.add(sun);
    const world=new T.Group();world.scale.setScalar(.01);scene.add(world);
    const metal=new T.MeshStandardMaterial({color:0xa6bec8,metalness:.72,roughness:.32}),paint=new T.MeshStandardMaterial({color:0x3c6572,metalness:.28,roughness:.4}),dark=new T.MeshStandardMaterial({color:0x29404c,metalness:.45,roughness:.5});
    const water=new T.MeshPhysicalMaterial({color:0x3fb2c8,metalness:0,roughness:.18,transparent:true,opacity:.68,depthWrite:false,side:T.DoubleSide});
    const casing=new T.MeshStandardMaterial({color:0xc8dfe5,metalness:.65,roughness:.35,side:T.DoubleSide}),amber=new T.MeshStandardMaterial({color:0xd6ab60,metalness:.4,roughness:.36}),wire=new T.MeshStandardMaterial({color:0x977e59,roughness:.65}),invalid=new T.MeshBasicMaterial({color:0xc95751});
    const pipeShell=new T.MeshPhysicalMaterial({color:0xa9cbd4,metalness:.15,roughness:.28,transparent:true,opacity:.3,depthWrite:false,side:T.DoubleSide});
    const materials=[metal,paint,dark,water,casing,amber,wire,invalid,pipeShell];
    const floor=new T.Mesh(new T.PlaneGeometry(60,60),new T.MeshStandardMaterial({color:0xdde5e8,roughness:.95}));floor.rotation.x=-Math.PI/2;floor.position.y=-.02;floor.receiveShadow=true;scene.add(floor);
    const grid=new T.GridHelper(60,120,0xabb9bf,0xcad3d7);grid.position.y=-.015;scene.add(grid);
    const phases=new Map<string,number>();
    let geometries=new Set<T.BufferGeometry>(),updaters:((dt:number)=>void)[]=[],roots=new Map<string,T.Group>();
    const mesh=(parent:T.Object3D,g:T.BufferGeometry,m:T.Material,x:number,y:number,z:number)=>{geometries.add(g);const n=new T.Mesh(g,m);n.position.set(x,y,z);n.castShadow=n.receiveShadow=true;parent.add(n);return n;};
    const box=(p:T.Object3D,w:number,h:number,d:number,x:number,y:number,z:number,m:T.Material=dark)=>mesh(p,new T.BoxGeometry(w,h,d),m,x,y,z);
    const tube=(parent:T.Object3D,a:T.Vector3,b:T.Vector3,r:number,m:T.Material=metal)=>{const d=b.clone().sub(a);if(d.length()<.001)return;const n=mesh(parent,new T.CylinderGeometry(r,r,d.length(),24),m,...a.clone().add(b).multiplyScalar(.5).toArray() as [number,number,number]);n.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());return n;};
    const flange=(root:T.Group,at:T.Vector3,normal:T.Vector3)=>{
      tube(root,at.clone().addScaledVector(normal,-7),at,17,metal);
      const u=new T.Vector3(0,1,0).cross(normal).normalize();if(u.length()<.1)u.set(1,0,0);const v=normal.clone().cross(u).normalize();
      for(let i=0;i<8;i++){const p=at.clone().addScaledVector(u,13*Math.cos(i*Math.PI/4)).addScaledVector(v,13*Math.sin(i*Math.PI/4));tube(root,p.clone().addScaledVector(normal,-8),p.clone().addScaledVector(normal,1),1.6,dark);}
    };
    const portGeometry=(e:Equipment,root:T.Group)=>{
      for(const port of Object.values(e.ports)){
        const t=port.terminal,point=new T.Vector3(t.x,t.z,t.y),normal=t.side==='left'?new T.Vector3(-1,0,0):t.side==='right'?new T.Vector3(1,0,0):t.side==='up'?new T.Vector3(0,0,-1):new T.Vector3(0,0,1);
        const anchor=new T.Object3D();anchor.position.copy(point);anchor.name=`${e.id}.${port.port}`;root.add(anchor);
        if(t.medium==='fluid')flange(root,point,normal);else box(root,7,6,7,t.x,t.z,t.y,amber);
      }
    };
    const buildEquipment=(e:Equipment)=>{
      const root=new T.Group();root.position.set(e.x,e.z??0,e.y);root.userData.equipment=e.id;roots.set(e.id,root);world.add(root);
      if(e.kind==='tank'){
        const levelSignal=equipmentSignal<number>(e,'level','number');if(!levelSignal)return;
        box(root,140,7,150,79,5,116);for(const x of [28,120])box(root,10,25,10,x,17,130);
        const shell=mesh(root,new T.CylinderGeometry(61,61,185,64,1,true,.6,Math.PI*2-1.2),casing,79,117,120);shell.rotation.y=Math.PI;
        for(const y of [24,210]){const rim=mesh(root,new T.TorusGeometry(61,2,12,64),metal,79,y,120);rim.rotation.x=Math.PI/2;}
        const liquid=mesh(root,new T.CylinderGeometry(58,58,1,64),water,79,24,120);
        const surface=mesh(root,new T.CircleGeometry(58,64),water,79,24,120);surface.rotation.x=-Math.PI/2;
        for(let i=0;i<=10;i++)box(root,i%5===0?13:8,1.3,2,35,24+i*18.5,65,paint);
        tube(root,new T.Vector3(135,24,120),new T.Vector3(170,24,120),9);tube(root,new T.Vector3(170,24,120),new T.Vector3(170,24,184),9);
        tube(root,new T.Vector3(79,195,120),new T.Vector3(79,195,3),9);
        let level=0;updaters.push(dt=>{const v=numeric(current.current.snapshot,levelSignal.id,Date.now(),levelSignal.staleAfter);liquid.visible=surface.visible=v!==null&&v>0;if(v!==null){level+=(Math.max(0,Math.min(100,v))-level)*(dt===0?1:1-Math.exp(-dt*8));const h=185*level/100;liquid.scale.y=Math.max(.001,h);liquid.position.y=24+h/2;surface.position.y=24+h+.1;}});
      }else if(e.kind==='pump'){
        box(root,205,7,78,112,6,96);box(root,40,20,56,76,20,96,metal);box(root,72,20,54,171,20,96,metal);
        tube(root,new T.Vector3(130,60,96),new T.Vector3(210,60,96),29,paint);
        for(let i=0;i<10;i++)tube(root,new T.Vector3(136+i*7,60,96),new T.Vector3(138+i*7,60,96),33,metal);
        box(root,29,18,25,170,95,65);tube(root,new T.Vector3(106,60,96),new T.Vector3(133,60,96),9,metal);
        const back=mesh(root,new T.CylinderGeometry(45,45,7,48),paint,96,60,96);back.rotation.z=Math.PI/2;
        const cover=mesh(root,new T.CylinderGeometry(45,45,36,48,1,true),casing,76,60,96);cover.rotation.z=Math.PI/2;
        const rim=mesh(root,new T.TorusGeometry(45,2.5,12,64),metal,57,60,96);rim.rotation.y=Math.PI/2;
        const rotor=new T.Group();rotor.position.set(59,60,96);root.add(rotor);
        for(let i=0;i<7;i++){const a=i*Math.PI*2/7,n=box(rotor,4,30,7,0,17*Math.cos(a),17*Math.sin(a),amber);n.rotation.x=a+.5;}
        tube(root,new T.Vector3(0,60,96),new T.Vector3(55,60,96),10);tube(root,new T.Vector3(76,100,96),new T.Vector3(76,105,96),10);tube(root,new T.Vector3(76,105,96),new T.Vector3(76,105,0),10);
        let phase=phases.get(e.id)??0;updaters.push(dt=>{const rpm=rpmOf(e,current.current.snapshot);phase=advancePhase(phase,rpm===null?0:rpm/1450*.35,dt);rotor.rotation.x=phase*Math.PI*2;rotor.visible=rpm!==null;rotor.userData.phase=phase;phases.set(e.id,phase);});
      }else if(e.kind==='valve'){
        const openingSignal=equipmentSignal<number>(e,'opening','number');if(!openingSignal)return;
        tube(root,new T.Vector3(0,60,102),new T.Vector3(160,60,102),11);
        mesh(root,new T.SphereGeometry(26,32,24),paint,80,60,102);tube(root,new T.Vector3(80,78,102),new T.Vector3(80,113,102),5);box(root,54,24,35,80,125,102);
        tube(root,new T.Vector3(80,105,102),new T.Vector3(80,105,6),2,wire);
        const indicator=box(root,34,3,4,80,140,102,amber);let value=0;updaters.push(dt=>{const v=numeric(current.current.snapshot,openingSignal.id,Date.now(),openingSignal.staleAfter);indicator.visible=v!==null;if(v!==null)value+=(v-value)*(dt===0?1:1-Math.exp(-dt*8));indicator.rotation.y=value*Math.PI/200;});
      }else{
        box(root,155,68,145,80,35,75,paint);box(root,106,2,65,80,70,75,metal);for(let i=0;i<8;i++){box(root,11,8,13,15+i*18,70,8,amber);box(root,11,8,13,15+i*18,70,135,amber);}
      }
      portGeometry(e,root);
    };
    rebuild.current=()=>{
      for(const g of geometries)g.dispose();geometries=new Set();world.clear();roots.clear();updaters=[];
      const p=current.current;for(const e of p.project.equipment)buildEquipment(e);
      const routes=p.routes;node.dataset.routeCount=String(routes.length);node.dataset.invalidRoutes=String(routes.filter(r=>!r.valid).length);
      for(const route of routes){
        const points=route.points.map(vector),m=route.valid?(route.kind==='pipe'?pipeShell:wire):invalid;
        for(let i=1;i<points.length;i++)tube(world,points[i-1]!,points[i]!,route.kind==='pipe'?5:1.5,m);
        if(route.kind!=='pipe'||!route.valid)continue;
        const edge=p.project.pipes.find(e=>e.id===route.id)!;
        // The moving indicators follow the same routed polyline, including vertical risers.
        const lengths=points.slice(1).map((v,i)=>v.distanceTo(points[i]!)),total=lengths.reduce((a,b)=>a+b,0);
        const dots=Array.from({length:Math.max(3,Math.min(24,Math.ceil(total/32)))},()=>mesh(world,new T.SphereGeometry(3.5,12,8),water,0,0,0));let phase=0;
        updaters.push(dt=>{const flow=flowOf(edge,current.current.project,current.current.snapshot);phase=advancePhase(phase,flow===null?0:Math.sign(flow)*Math.min(2,Math.abs(flow)/18)*.25,dt);
          dots.forEach((dot,index)=>{dot.visible=flow!==null&&Math.abs(flow)>.001;if(!dot.visible)return;let d=((phase+index/dots.length)%1)*total;for(let i=0;i<lengths.length;i++){if(d<=lengths[i]!){dot.position.copy(points[i]!).lerp(points[i+1]!,d/lengths[i]!);break;}d-=lengths[i]!;}});
        });
      }
    };
    fit.current=()=>{const box=new T.Box3().setFromObject(world);if(box.isEmpty())return;const center=box.getCenter(new T.Vector3()),radius=box.getSize(new T.Vector3()).length()/2;
      if(node.clientWidth&&node.clientHeight)camera.aspect=node.clientWidth/node.clientHeight;
      const vertical=T.MathUtils.degToRad(camera.fov),horizontal=2*Math.atan(Math.tan(vertical/2)*camera.aspect);
      const distance=Math.max(5,radius/Math.sin(Math.min(vertical,horizontal)/2)*1.05);
      controls.target.copy(center);controls.maxDistance=Math.max(40,distance*2);camera.position.copy(center).add(new T.Vector3(-.55,.85,1).normalize().multiplyScalar(distance));camera.near=.01;camera.far=Math.max(200,distance+radius*5);camera.updateProjectionMatrix();controls.update();};
    rebuild.current();fit.current();
    const resize=new ResizeObserver(()=>{const w=node.clientWidth,h=node.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});resize.observe(node);
    const ray=new T.Raycaster();let down=[0,0];
    const pointerDown=(e:globalThis.PointerEvent)=>{down=[e.clientX,e.clientY];};
    const select=(event:globalThis.PointerEvent)=>{if(Math.hypot(event.clientX-down[0]!,event.clientY-down[1]!)>4)return;const rect=renderer.domElement.getBoundingClientRect();ray.setFromCamera(new T.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),camera);const hit=ray.intersectObjects([...roots.values()],true)[0];let object:T.Object3D|null=hit?.object??null;while(object&&!object.userData.equipment)object=object.parent;if(object)current.current.select(String(object.userData.equipment));};
    renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',select);
    const theme=matchMedia('(prefers-color-scheme: dark)'),applyTheme=()=>{const bg=theme.matches?0x1b2631:0xe8eef0;scene.background=new T.Color(bg);floor.material.color.set(theme.matches?0x27343f:0xdde5e8);};applyTheme();theme.addEventListener('change',applyTheme);
    let frame=0,last=performance.now(),count=0;
    const selection=new T.BoxHelper(world,0x258ebb);selection.visible=false;scene.add(selection);
    const tick=(now:number)=>{const dt=Math.min(.1,(now-last)/1000);last=now;if(!document.hidden){const elapsed=matchMedia('(prefers-reduced-motion: reduce)').matches?0:dt;for(const update of updaters)update(elapsed);const chosen=roots.get(current.current.selected);selection.visible=!!chosen;if(chosen)selection.setFromObject(chosen);controls.update();renderer.render(scene,camera);node.dataset.frames=String(++count);}frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);
    return()=>{cancelAnimationFrame(frame);resize.disconnect();theme.removeEventListener('change',applyTheme);controls.dispose();selection.geometry.dispose();selection.material.dispose();environment.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();floor.geometry.dispose();floor.material.dispose();grid.geometry.dispose();for(const m of Array.isArray(grid.material)?grid.material:[grid.material])m.dispose();renderer.dispose();renderer.domElement.remove();rebuild.current=()=>{};fit.current=()=>{};};
  },[]);
  useEffect(()=>rebuild.current(),[props.project]);useEffect(()=>fit.current(),[props.fit]);
  return <div ref={host} className="scene3d" aria-label="3D process model">{error&&<div role="alert">WebGL: {error}</div>}</div>;
}
