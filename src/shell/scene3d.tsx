import { useEffect, useRef, useState } from 'react';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { isAttached, type ConnectionEnd, cableAppearance, equipmentSignal, interfaceProfile, validateProject, type Endpoint, type Equipment, type Point } from '../core';
import { anchor, connectionTip } from '../topology';
import { geometryRevision } from './model/geometry-revision';
import { advancePhase, flowOf, numeric, rpmOf } from '../motion';
import { projectPanelCable, roundedRoute } from './route3d';
import { Scene, type SceneProps } from './scene';
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
    const equipmentWorld=new T.Group(),routeWorld=new T.Group();world.add(equipmentWorld,routeWorld);
    const metal=new T.MeshStandardMaterial({color:0xa6bec8,metalness:.72,roughness:.32}),paint=new T.MeshStandardMaterial({color:0x3c6572,metalness:.28,roughness:.4}),dark=new T.MeshStandardMaterial({color:0x29404c,metalness:.45,roughness:.5});
    const water=new T.MeshPhysicalMaterial({color:0x3fb2c8,metalness:0,roughness:.18,transparent:true,opacity:.68,depthWrite:false,side:T.DoubleSide});
    const casing=new T.MeshStandardMaterial({color:0xc8dfe5,metalness:.65,roughness:.35,side:T.DoubleSide}),amber=new T.MeshStandardMaterial({color:0xd6ab60,metalness:.4,roughness:.36}),wire=new T.MeshStandardMaterial({color:0x977e59,roughness:.65}),invalid=new T.MeshBasicMaterial({color:0xc95751});
    const pipeShell=new T.MeshPhysicalMaterial({color:0xa9cbd4,metalness:.15,roughness:.28,transparent:true,opacity:.5,depthWrite:false,side:T.DoubleSide});
    const materials=[metal,paint,dark,water,casing,amber,wire,invalid,pipeShell];
    const floor=new T.Mesh(new T.PlaneGeometry(60,60),new T.MeshStandardMaterial({color:0xdde5e8,roughness:.95}));floor.rotation.x=-Math.PI/2;floor.position.y=-.02;floor.receiveShadow=true;scene.add(floor);
    const grid=new T.GridHelper(24,48,0xabb9bf,0xcad3d7);grid.position.y=-.015;for(const material of Array.isArray(grid.material)?grid.material:[grid.material]){material.transparent=true;material.opacity=.38;material.depthWrite=false;}scene.add(grid);
    const phases=new Map<string,number>();
    const allocate=()=>({geometries:new Set<T.BufferGeometry>(),textures:new Set<T.Texture>(),materials:new Set<T.Material>(),updaters:[] as ((dt:number)=>void)[]});
    const equipmentResources=allocate(),routeResources=allocate();let resources=equipmentResources;
    const dispose=(scope:ReturnType<typeof allocate>)=>{for(const geometry of scope.geometries)geometry.dispose();for(const texture of scope.textures)texture.dispose();for(const material of scope.materials)material.dispose();scope.geometries.clear();scope.textures.clear();scope.materials.clear();scope.updaters.length=0;};
    const roots=new Map<string,T.Group>();let plugMeshes:T.Mesh[]=[],equipmentRevision='',routeRevision='',equipmentBuilds=0,routeBuilds=0,dirty=true;
    const buttonDrivers=new Map<string,{refresh:(snapshot:SceneProps['snapshot'])=>void;press:(key:'up'|'down'|'left'|'right')=>void}>(),buttonScreens=new Map<string,T.CanvasTexture>();
    const mesh=(parent:T.Object3D,g:T.BufferGeometry,m:T.Material|T.Material[],x:number,y:number,z:number)=>{resources.geometries.add(g);const n=new T.Mesh(g,m);n.position.set(x,y,z);n.castShadow=n.receiveShadow=true;parent.add(n);return n;};
    const box=(p:T.Object3D,w:number,h:number,d:number,x:number,y:number,z:number,m:T.Material=dark)=>mesh(p,new T.BoxGeometry(w,h,d),m,x,y,z);
    const tube=(parent:T.Object3D,a:T.Vector3,b:T.Vector3,r:number,m:T.Material=metal)=>{const d=b.clone().sub(a);if(d.length()<.001)return;const n=mesh(parent,new T.CylinderGeometry(r,r,d.length(),24),m,...a.clone().add(b).multiplyScalar(.5).toArray() as [number,number,number]);n.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());return n;};
    const flange=(root:T.Group,at:T.Vector3,normal:T.Vector3)=>{
      tube(root,at.clone().addScaledVector(normal,-7),at,17,metal);
      const u=new T.Vector3(0,1,0).cross(normal).normalize();if(u.length()<.1)u.set(1,0,0);const v=normal.clone().cross(u).normalize();
      for(let i=0;i<8;i++){const p=at.clone().addScaledVector(u,13*Math.cos(i*Math.PI/4)).addScaledVector(v,13*Math.sin(i*Math.PI/4));tube(root,p.clone().addScaledVector(normal,-8),p.clone().addScaledVector(normal,1),1.6,dark);}
    };
    const portGeometry=(e:Equipment,root:T.Group,showControlPins=true)=>{
      for(const port of Object.values(e.ports)){
        const t=port.terminal,point=new T.Vector3(t.x,t.z,t.y),normal=t.side==='left'?new T.Vector3(-1,0,0):t.side==='right'?new T.Vector3(1,0,0):t.side==='up'?new T.Vector3(0,0,-1):new T.Vector3(0,0,1);
        const anchor=new T.Object3D();anchor.position.copy(point);anchor.name=`${e.id}.${port.port}`;root.add(anchor);
        if(current.current.interaction==='edit'){
          const pick=mesh(root,new T.SphereGeometry(9,12,8),amber,t.x,t.z,t.y);pick.userData.port=port.port;pick.userData.device=e.id;pick.name=`${e.id}.${port.port}.pick`;
        }
        if(t.medium==='fluid')flange(root,point,normal);else if(showControlPins)box(root,7,6,7,t.x,t.z,t.y,amber);
      }
    };
    const buildEquipment=(e:Equipment)=>{
      const root=new T.Group();root.position.set(e.x,e.z??0,e.y);root.userData.equipment=e.id;roots.set(e.id,root);equipmentWorld.add(root);
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
        let level=0;resources.updaters.push(dt=>{const v=numeric(current.current.snapshot,levelSignal.id,Date.now(),levelSignal.staleAfter);liquid.visible=surface.visible=v!==null&&v>0;if(v!==null){level+=(Math.max(0,Math.min(100,v))-level)*(dt===0?1:1-Math.exp(-dt*8));const h=185*level/100;liquid.scale.y=Math.max(.001,h);liquid.position.y=24+h/2;surface.position.y=24+h+.1;}});
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
        let phase=phases.get(e.id)??0;resources.updaters.push(dt=>{const rpm=rpmOf(e,current.current.snapshot);phase=advancePhase(phase,rpm===null?0:rpm/1450*.35,dt);rotor.rotation.x=phase*Math.PI*2;rotor.visible=rpm!==null;rotor.userData.phase=phase;phases.set(e.id,phase);});
      }else if(e.kind==='valve'){
        const openingSignal=equipmentSignal<number>(e,'opening','number');if(!openingSignal)return;
        tube(root,new T.Vector3(0,60,102),new T.Vector3(160,60,102),11);
        mesh(root,new T.SphereGeometry(26,32,24),paint,80,60,102);tube(root,new T.Vector3(80,78,102),new T.Vector3(80,113,102),5);box(root,54,24,35,80,125,102);
        tube(root,new T.Vector3(80,105,102),new T.Vector3(80,105,6),2,wire);
        const indicator=box(root,34,3,4,80,140,102,amber);let value=0;resources.updaters.push(dt=>{const v=numeric(current.current.snapshot,openingSignal.id,Date.now(),openingSignal.staleAfter);indicator.visible=v!==null;if(v!==null)value+=(v-value)*(dt===0?1:1-Math.exp(-dt*8));indicator.rotation.y=value*Math.PI/200;});
      }else if(e.capabilities.scene3d?.kind==='control-panel'&&e.capabilities.diagram){
        const panel=e.capabilities.scene3d,{width,height}=e.capabilities.diagram,top=panel.depth;
        const material=(color:number,metalness=0,roughness=.66)=>{const m=new T.MeshStandardMaterial({color,metalness,roughness});resources.materials.add(m);return m;};
        const shell=material(0x556b78,.28,.5),face=material(0xe8edf1),recess=material(0x09151e),silver=material(0xb8c6d0,.45),pin=material(0xc7d8e3,.55),arrow=material(0xf9fcff);
        const outline=new T.Shape();
        outline.moveTo(16,32);outline.lineTo(width-16,32);outline.quadraticCurveTo(width-8,32,width-8,40);
        outline.lineTo(width-8,height-40);outline.quadraticCurveTo(width-8,height-32,width-16,height-32);
        outline.lineTo(16,height-32);outline.quadraticCurveTo(8,height-32,8,height-40);
        outline.lineTo(8,40);outline.quadraticCurveTo(8,32,16,32);
        const chassis=mesh(root,new T.ExtrudeGeometry(outline,{depth:top,steps:1,bevelEnabled:false,curveSegments:6}),[face,shell],0,top,0);
        chassis.rotation.x=Math.PI/2;chassis.name=`${e.id}.chassis`;
        const marking=(label:string,x:number,z:number,w:number,h:number,size=32,color='#17304a')=>{
          const canvas=document.createElement('canvas');canvas.width=512;canvas.height=64;
          const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,512,64);ctx.fillStyle=color;ctx.font=`700 ${size}px Arial, sans-serif`;ctx.textBaseline='middle';ctx.fillText(label,8,32);
          const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;resources.textures.add(texture);
          const m=new T.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,toneMapped:false,side:T.DoubleSide});resources.materials.add(m);
          const plaque=mesh(root,new T.PlaneGeometry(w,h),m,x,top+.4,z);plaque.rotation.x=-Math.PI/2;
        };
        marking(panel.title,96,157,145,24,38);marking(panel.subtitle,80,181,112,14,27,'#526879');
        marking('Un=220V  50Hz',86,217,130,12,25,'#62727e');marking('IP20    EAC',79,237,116,12,25,'#62727e');
        for(const group of panel.terminals){
          const colored=material(group.color,.12,.48),x=group.x+group.width/2,upper=group.y<100;
          const matched=Object.values(e.ports).find(port=>port.terminal.x>=group.x&&port.terminal.x<=group.x+group.width&&port.terminal.side===(upper?'up':'down'));
          const endZ=matched?.terminal.y??(upper?10.5:329.5),z=endZ+(upper?20:-20);
          mesh(root,new RoundedBoxGeometry(group.width,14,40,2,2),colored,x,top+7,z);
          box(root,group.width-3,1,13,x,top+14.5,z+(upper?10:-10),material(0xffffff,.02,.8));
          if(!group.socket)for(let i=0;i<group.count;i++){
            const gap=(group.width-group.count*9)/(group.count+1),px=group.x+gap*(i+1)+9*i+4.5;
            if(Object.values(e.ports).some(port=>Math.abs(port.terminal.x-px)<5&&Math.abs(port.terminal.y-endZ)<.1))continue;
            const opening=mesh(root,new T.CylinderGeometry(Math.min(4,group.width/group.count*.25),Math.min(4,group.width/group.count*.25),.7,12),recess,px,panel.portElevation,endZ+(upper?-.4:.4));
            opening.rotation.x=Math.PI/2;
            box(root,Math.min(5,group.width/group.count*.35),2,.5,px,panel.portElevation,endZ+(upper?-.9:.9),pin);
          }
          marking(group.id,x,group.y<100?51:286,Math.min(group.width,96),10,25,'#4b6273');
        }
        for(const port of Object.values(e.ports)){
          const t=port.terminal,normal=t.side==='up'?-1:t.side==='down'?1:0;
          if(t.interfaceId==='rj45-ethernet'){
            const profile=interfaceProfile(t.interfaceId);
            const mouth=box(root,profile.width+4,profile.height+4,1.4,t.x,panel.portElevation,t.y+normal*.6,silver);
            mouth.name=`${e.id}.${port.port}.shield`;
            box(root,profile.width,profile.height,1.5,t.x,panel.portElevation,t.y+normal*1.3,recess);
            box(root,21,3,1.7,t.x,panel.portElevation-6,t.y+normal*1.6,shell);
            for(let i=0;i<profile.contacts;i++)box(root,2.2,3,1.7,t.x-14+i*4,panel.portElevation+4,t.y+normal*1.8,amber);
          }else if(t.medium==='bus'){
            box(root,18,10,1,t.x,panel.portElevation,t.y+normal*.5,silver);
            if(t.interfaceId==='rs485-terminal')for(let i=0;i<interfaceProfile(t.interfaceId).contacts;i++)box(root,3,3,1,t.x-4+i*8,panel.portElevation+1,t.y+normal*1.5,amber);
          }else{
            const rim=mesh(root,new T.CylinderGeometry(6,6,1,16),silver,t.x,panel.portElevation,t.y+normal*.5);rim.rotation.x=Math.PI/2;
          }
          const slot=t.interfaceId==='rj45-ethernet'?new T.BoxGeometry(37,15,.1):t.medium==='bus'?new T.BoxGeometry(14,6,1.4):new T.CylinderGeometry(4.5,4.5,1.4,16);
          const socket=mesh(root,slot,recess,t.x,panel.portElevation,t.y+normal*(t.interfaceId==='rj45-ethernet'?1.4:.9));if(t.medium!=='bus')socket.rotation.x=Math.PI/2;
          socket.name=`${e.id}.${port.port}.slot`;
          socket.userData.port=port.port;socket.userData.interfaceId=t.interfaceId??t.family;
        }
        const screen=panel.screen,sx=screen.x+screen.width/2,sz=screen.y+screen.height/2;
        mesh(root,new RoundedBoxGeometry(screen.width+13,5,screen.height+13,2,3),recess,sx,top+6,sz);
        mesh(root,new RoundedBoxGeometry(screen.width+3,1,screen.height+3,1,2),silver,sx,top+9,sz);
        const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
        const displayFactory=current.current.displays?.[e.capabilities.hmi?.target??''];
        const displayDriver=displayFactory?.(canvas,current.current.project,e);
        if(displayDriver){displayDriver.refresh(current.current.snapshot);buttonDrivers.set(e.id,displayDriver);node.dataset.screenSource=canvas.dataset.source??'unknown';}
        const frame=new T.CanvasTexture(canvas);frame.colorSpace=T.SRGBColorSpace;frame.magFilter=T.NearestFilter;frame.minFilter=T.LinearMipmapLinearFilter;frame.anisotropy=renderer.capabilities.getMaxAnisotropy();resources.textures.add(frame);
        buttonScreens.set(e.id,frame);
        const lcd=new T.ShaderMaterial({uniforms:{uFrame:{value:frame}},vertexShader:`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,fragmentShader:`uniform sampler2D uFrame;varying vec2 vUv;void main(){gl_FragColor=vec4(texture2D(uFrame,vUv).rgb,1.0);}`,side:T.DoubleSide,toneMapped:false});resources.materials.add(lcd);
        const displayMesh=mesh(root,new T.PlaneGeometry(screen.width-3,screen.height-3),lcd,sx,top+9.7,sz);displayMesh.rotation.x=-Math.PI/2;
        let refresh=0,updates=0;resources.updaters.push(dt=>{refresh+=dt;if(refresh<.2||!displayDriver)return;refresh=0;displayDriver.refresh(current.current.snapshot);frame.needsUpdate=true;node.dataset.screenPage=canvas.dataset.page??'0';node.dataset.screenUpdates=String(++updates);});
        for(const button of panel.buttons){
          const cap=material(button.color,.08,.32);
          const base=mesh(root,new T.CylinderGeometry(23,23,2,32),recess,button.x,top+4,button.y);base.userData.button=button.id;
          const key=mesh(root,new T.CylinderGeometry(19,19,3,32),cap,button.x,top+6.5,button.y);key.userData.button=button.id;
          const coords=button.id==='up'?[0,7,-7,-5,7,-5]:button.id==='down'?[0,-7,-7,5,7,5]:button.id==='left'?[-7,0,5,-7,5,7]:[7,0,-5,-7,-5,7];
          const shape=new T.Shape();shape.moveTo(coords[0]!,coords[1]!);shape.lineTo(coords[2]!,coords[3]!);shape.lineTo(coords[4]!,coords[5]!);shape.closePath();
          const glyph=mesh(root,new T.ShapeGeometry(shape),arrow,button.x,top+8.2,button.y);glyph.rotation.x=-Math.PI/2;glyph.userData.button=button.id;
        }
      }else{
        box(root,155,68,145,80,35,75,paint);box(root,106,2,65,80,70,75,metal);for(let i=0;i<8;i++){box(root,11,8,13,15+i*18,70,8,amber);box(root,11,8,13,15+i*18,70,135,amber);}
      }
      portGeometry(e,root,e.capabilities.scene3d?.kind!=='control-panel');
    };
    const synchronize=()=>{
      dirty=false;const p=current.current;
      const revision=geometryRevision(p.project,p.interaction)+JSON.stringify(p.inactive??[]);
      if(revision!==equipmentRevision){
        equipmentRevision=revision;dispose(equipmentResources);equipmentWorld.clear();roots.clear();buttonDrivers.clear();buttonScreens.clear();node.dataset.screenUpdates='0';
        resources=equipmentResources;for(const e of p.project.equipment){buildEquipment(e);if(p.inactive?.includes(e.id))roots.get(e.id)?.traverse(object=>{if(object instanceof T.Mesh){const fade=(material:T.Material)=>{const clone=material.clone();clone.transparent=true;clone.opacity=.4;clone.depthWrite=false;equipmentResources.materials.add(clone);return clone;};object.material=Array.isArray(object.material)?object.material.map(fade):fade(object.material);}});}
        node.dataset.equipmentBuilds=String(++equipmentBuilds);
      }
      // Pose-only edits retain equipment meshes, display drivers, textures and animation state.
      for(const e of p.project.equipment)roots.get(e.id)?.position.set(e.x,e.z??0,e.y);
      const nextRoutes=JSON.stringify([p.routes,p.project.pipes,p.project.cables,p.interaction]);
      if(nextRoutes===routeRevision)return;
      routeRevision=nextRoutes;dispose(routeResources);routeWorld.clear();plugMeshes=[];resources=routeResources;
      node.dataset.routeBuilds=String(++routeBuilds);
      const routes=p.routes;node.dataset.routeCount=String(routes.length);node.dataset.invalidRoutes=String(routes.filter(r=>!r.valid).length);
      let pipeBends=0;
      for(const route of routes){
        const cable=route.kind==='cable'?p.project.cables?.find(edge=>edge.id===route.id):undefined;
        const panelSide=(end:ConnectionEnd)=>{if(!isAttached(end))return null;const equipment=p.project.equipment.find(e=>e.id===end.device);return equipment?.capabilities.scene3d?.kind==='control-panel'?Object.entries(equipment.ports).find(([id])=>id===end.port)?.[1].terminal.side??null:null;};
        const points=route.kind==='cable'&&route.valid?projectPanelCable(route.points.map(vector),cable?panelSide(cable.from):null,cable?panelSide(cable.to):null):route.points.map(vector);
        const cableMaterial=cable?new T.MeshStandardMaterial({color:cableAppearance(cable.from.terminal.medium as 'control'|'power'|'bus',cable.from.terminal.family).color,roughness:.65}):wire;
        if(cable)resources.materials.add(cableMaterial);
        const m=route.valid?(route.kind==='pipe'?pipeShell:cableMaterial):invalid;
        const rounded=route.valid?roundedRoute(points,route.kind==='pipe'?12:6):null;
        if(rounded&&rounded.path.curves.length){
          const path=rounded.path;if(route.kind==='pipe')pipeBends+=rounded.bends;
          mesh(routeWorld,new T.TubeGeometry(path,Math.max(24,Math.ceil(path.getLength()/4)),route.kind==='pipe'?6:1.8,route.kind==='pipe'?16:8,false),m,0,0,0);
        }else for(let i=1;i<points.length;i++)tube(routeWorld,points[i-1]!,points[i]!,route.kind==='pipe'?5:1.5,m);
        if(p.interaction==='edit')for(const end of ['from','to'] as const){const point=end==='from'?points[0]:points.at(-1);if(!point)continue;const handle=mesh(routeWorld,new T.SphereGeometry(6,16,10),amber,point.x,point.y,point.z);handle.userData.cablePlug={id:route.id,end};plugMeshes.push(handle);}
        if(route.kind!=='pipe'||!route.valid)continue;
        const edge=p.project.pipes.find(e=>e.id===route.id)!;
        // The moving indicators follow the rendered curve, including its vertical risers and bends.
        const path=rounded!.path,total=path.getLength();
        const dots=Array.from({length:Math.max(3,Math.min(24,Math.ceil(total/32)))},()=>mesh(routeWorld,new T.SphereGeometry(3.5,12,8),water,0,0,0));let phase=phases.get(`route:${route.id}`)??0;
        resources.updaters.push(dt=>{const flow=flowOf(edge,current.current.project,current.current.snapshot);phase=advancePhase(phase,flow===null?0:Math.sign(flow)*Math.min(2,Math.abs(flow)/18)*.25,dt);phases.set(`route:${route.id}`,phase);
          dots.forEach((dot,index)=>{dot.visible=flow!==null&&Math.abs(flow)>.001;if(dot.visible)dot.position.copy(path.getPointAt((phase+index/dots.length+1)%1));});
        });
      }
      node.dataset.pipeBends=String(pipeBends);
    };
    rebuild.current=()=>{dirty=true;};
    fit.current=()=>{if(dirty)synchronize();world.updateWorldMatrix(true,true);const box=new T.Box3();for(const root of roots.values())box.expandByObject(root);box.expandByObject(routeWorld);if(box.isEmpty())return;const center=box.getCenter(new T.Vector3()),radius=box.getSize(new T.Vector3()).length()/2;
      if(node.clientWidth&&node.clientHeight)camera.aspect=node.clientWidth/node.clientHeight;
      const vertical=T.MathUtils.degToRad(camera.fov),horizontal=2*Math.atan(Math.tan(vertical/2)*camera.aspect);
      const direction=new T.Vector3(-.55,.85,1).normalize(),right=new T.Vector3(0,1,0).cross(direction).normalize(),up=direction.clone().cross(right).normalize();
      let distance=5;for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
        const corner=new T.Vector3(x,y,z).sub(center),depth=corner.dot(direction);
        distance=Math.max(distance,depth+Math.abs(corner.dot(right))/Math.tan(horizontal/2),depth+Math.abs(corner.dot(up))/Math.tan(vertical/2));
      }
      distance*=1.15;
      controls.target.copy(center);controls.maxDistance=Math.max(40,distance*2);camera.position.copy(center).addScaledVector(direction,distance);camera.near=.01;camera.far=Math.max(200,distance+radius*5);camera.updateProjectionMatrix();controls.update();};
    synchronize();fit.current();
    const resize=new ResizeObserver(()=>{const w=node.clientWidth,h=node.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});resize.observe(node);
    const ray=new T.Raycaster();let down=[0,0],gesture:{kind:'equipment';pointer:number;id:string;x:number;y:number;origin:T.Vector3;moved:boolean;started:boolean}|{kind:'plug';pointer:number;id:string;end:'from'|'to';moved:boolean;height:number;point:Point;offset:T.Vector3;lastY:number;vertical:boolean;targets:Endpoint[];target?:Endpoint}|null=null;
    const aim=(event:MouseEvent|globalThis.PointerEvent)=>{const rect=renderer.domElement.getBoundingClientRect();ray.setFromCamera(new T.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),camera);};
    const ground=(event:globalThis.PointerEvent,height:number)=>{aim(event);return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0,1,0),-height),new T.Vector3());};
    const hitEquipment=(event:MouseEvent|globalThis.PointerEvent)=>{aim(event);const hit=ray.intersectObjects([...roots.values()],true)[0];let object:T.Object3D|null=hit?.object??null;while(object&&!object.userData.equipment)object=object.parent;if(object)return object;
      let nearest:T.Group|null=null,distance=Infinity;for(const root of roots.values()){const point=ray.ray.intersectBox(new T.Box3().setFromObject(root),new T.Vector3());if(point){const d=point.distanceToSquared(ray.ray.origin);if(d<distance){distance=d;nearest=root;}}}return nearest;};
    const capture=(event:globalThis.PointerEvent)=>{node.dataset.dragPointer=String(event.pointerId);node.dataset.dragKind=gesture?.kind??'';controls.enabled=false;event.preventDefault();event.stopImmediatePropagation();renderer.domElement.setPointerCapture(event.pointerId);};
    const release=(pointer:number)=>{controls.enabled=true;if(renderer.domElement.hasPointerCapture(pointer))renderer.domElement.releasePointerCapture(pointer);delete node.dataset.connectionTarget;delete node.dataset.dragPointer;delete node.dataset.dragKind;};
    const pointerDown=(e:globalThis.PointerEvent)=>{if(gesture)return;down=[e.clientX,e.clientY];renderer.domElement.focus({preventScroll:true});if(current.current.interaction!=='edit'||e.button!==0)return;
      aim(e);const plugHit=ray.intersectObjects(plugMeshes,false)[0],equipmentHit=ray.intersectObjects([...roots.values()],true)[0];
      const hit=plugHit&&(!equipmentHit||plugHit.distance<=equipmentHit.distance+.01)?plugHit.object:equipmentHit?.object;
      const plug=hit?.userData.cablePlug as {id:string;end:'from'|'to'}|undefined;
      if(plug){
        current.current.select(plug.id);
        const project=current.current.project,edge=[...project.pipes,...project.cables??[]].find(item=>item.id===plug.id);if(!edge)return;
        // The old implementation used local terminal coordinates, jumping when the device was translated/elevated.
        const tip=connectionTip(project,edge,plug.end),origin=ground(e,tip.z*.01);if(!origin)return;
        if(current.current.beginCable?.(plug.id,plug.end,tip.x,tip.y,tip.z)){
          const targets=project.equipment.flatMap(device=>Object.values(device.ports)).filter(target=>{
            try{validateProject({...project,pipes:project.pipes.map(cable=>cable.id===plug.id?{...cable,[plug.end]:target}:cable),cables:project.cables?.map(cable=>cable.id===plug.id?{...cable,[plug.end]:target}:cable)});return true;}catch{return false;}
          });
          gesture={kind:'plug',pointer:e.pointerId,...plug,moved:false,height:tip.z*.01,point:tip,offset:vector(tip).multiplyScalar(.01).sub(origin),lastY:e.clientY,vertical:false,targets};capture(e);
        }return;
      }
      let part:T.Object3D|null=hit??null,port=false,button=false;while(part){if(part.userData.port)port=true;if(part.userData.button)button=true;if(part.userData.equipment)break;part=part.parent;}
      if(!part)part=hitEquipment(e);if(!part||port||button)return;const id=String(part.userData.equipment),equipment=current.current.project.equipment.find(item=>item.id===id);if(!equipment)return;
      const origin=ground(e,(equipment.z??0)*.01);if(!origin)return;gesture={kind:'equipment',pointer:e.pointerId,id,x:equipment.x,y:equipment.y,origin,moved:false,started:false};capture(e);
    };
    const pointerMove=(e:globalThis.PointerEvent)=>{if(!gesture||gesture.pointer!==e.pointerId)return;
      if(gesture.kind==='plug'){
        const plug=gesture;if(!plug.moved&&Math.hypot(e.clientX-down[0]!,e.clientY-down[1]!)<=4)return;plug.moved=true;
        let point:T.Vector3|null;
        if(e.shiftKey){
          const scale=2*camera.position.distanceTo(controls.target)*Math.tan(T.MathUtils.degToRad(camera.fov)/2)/Math.max(1,node.clientHeight);
          plug.height=Math.max(0,Math.min(150,plug.height-(e.clientY-plug.lastY)*scale));point=vector({...plug.point,z:plug.height*100}).multiplyScalar(.01);
        }else{
          point=ground(e,plug.height);
          if(point){if(plug.vertical)plug.offset.copy(vector(plug.point).multiplyScalar(.01).sub(point));point.add(plug.offset);point.y=plug.height;}
        }
        plug.lastY=e.clientY;plug.vertical=e.shiftKey;if(!point)return;
        const previousTarget=plug.target;plug.target=undefined;
        if(!e.shiftKey){
          const rect=renderer.domElement.getBoundingClientRect();let distance=18;
          // Screen-space tolerance remains usable at any camera zoom; domain validation above owns compatibility.
          for(const target of previousTarget?[previousTarget,...plug.targets.filter(item=>item!==previousTarget)]:plug.targets){
            const world=vector(anchor(current.current.project,target)).multiplyScalar(.01),screen=world.clone().project(camera);
            if(screen.z< -1||screen.z>1)continue;
            const x=rect.left+(screen.x+1)*rect.width/2,y=rect.top+(1-screen.y)*rect.height/2,d=Math.hypot(e.clientX-x,e.clientY-y);
            if(d>=(target===previousTarget?24:distance))continue;
            ray.setFromCamera(new T.Vector2(screen.x,screen.y),camera);
            let visible:T.Object3D|null=ray.intersectObjects([...roots.values()],true)[0]?.object??null,port:string|undefined;
            while(visible){if(visible.userData.port)port=String(visible.userData.port);if(visible.userData.equipment)break;visible=visible.parent;}
            if(visible?.userData.equipment!==target.device||port!==target.port)continue;
            distance=d;plug.target=target;point.copy(world);if(target===previousTarget)break;
          }
        }
        plug.point={x:Math.round(point.x*100),y:Math.round(point.z*100),z:Math.round(point.y*100)};
        node.dataset.connectionTarget=plug.target?`${plug.target.device}.${plug.target.port}`:'';
        current.current.moveCable?.(plug.point.x,plug.point.y,plug.point.z);return;
      }
      const g=gesture;if(Math.hypot(e.clientX-down[0]!,e.clientY-down[1]!)<4&&!g.started)return;
      if(!g.started){g.started=!!current.current.begin?.(g.id);if(!g.started){gesture=null;release(g.pointer);return;}}
      const point=ground(e,(current.current.project.equipment.find(item=>item.id===g.id)?.z??0)*.01);if(!point)return;g.moved=true;
      current.current.move?.(g.id,Math.round(g.x+(point.x-g.origin.x)*100),Math.round(g.y+(point.z-g.origin.z)*100));
    };
    const pointerUp=(e:globalThis.PointerEvent)=>{
      if(gesture&&gesture.pointer!==e.pointerId)return;
      const g=gesture;gesture=null;if(g)release(g.pointer);
      if(g?.kind==='plug'){current.current.endCable?.(g.target?{device:g.target.device,port:g.target.port}:undefined,!g.moved);return;}
      if(g?.kind==='equipment'&&g.started){current.current.end?.(!g.moved);if(g.moved)return;}
      select(e);
    };
    const pointerCancel=()=>{const g=gesture;gesture=null;if(!g)return;release(g.pointer);if(g.kind==='plug')current.current.endCable?.(undefined,true);else if(g.started)current.current.end?.(true);};
    const pressButton=(id:string,key:'up'|'down'|'left'|'right')=>{const driver=buttonDrivers.get(id);if(!driver)return;driver.press(key);driver.refresh(current.current.snapshot);buttonScreens.get(id)!.needsUpdate=true;node.dataset.lastButton=key;};
    const select=(event:globalThis.PointerEvent)=>{if(Math.hypot(event.clientX-down[0]!,event.clientY-down[1]!)>4)return;const object=hitEquipment(event);if(!object)return;current.current.select(String(object.userData.equipment),current.current.interaction==='select'&&(event.shiftKey||event.metaKey||event.ctrlKey));
      const rect=renderer.domElement.getBoundingClientRect();ray.setFromCamera(new T.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),camera);
      const hit=ray.intersectObject(object,true)[0]?.object,key=hit?.userData.button as 'up'|'down'|'left'|'right'|undefined;
      if(key)pressButton(String(object.userData.equipment),key);
    };
    const keyDown=(event:KeyboardEvent)=>{if(event.key==='Escape'&&gesture){event.preventDefault();pointerCancel();return;}const key=({ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'} as const)[event.key as 'ArrowUp'|'ArrowDown'|'ArrowLeft'|'ArrowRight'];if(!key||!buttonDrivers.has(current.current.selected))return;event.preventDefault();pressButton(current.current.selected,key);};
    const focusEquipment=(event:MouseEvent)=>{
      const object=hitEquipment(event);if(!object)return;
      const bounds=new T.Box3().setFromObject(object),center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3());
      const direction=camera.position.clone().sub(controls.target).normalize();
      const vertical=T.MathUtils.degToRad(camera.fov),horizontal=2*Math.atan(Math.tan(vertical/2)*camera.aspect);
      const distance=Math.max(3,size.x/2/Math.tan(horizontal/2),size.z/2/Math.tan(vertical/2),size.y/2/Math.tan(vertical/2))*1.85;
      controls.target.copy(center);camera.position.copy(center).addScaledVector(direction,distance);camera.far=Math.max(200,distance+size.length()*3);camera.updateProjectionMatrix();controls.update();
      node.dataset.focusedEquipment=String(object.userData.equipment);current.current.select(String(object.userData.equipment));
    };
    renderer.domElement.tabIndex=0;renderer.domElement.addEventListener('pointerdown',pointerDown,true);renderer.domElement.addEventListener('pointermove',pointerMove);renderer.domElement.addEventListener('pointerup',pointerUp);renderer.domElement.addEventListener('pointercancel',pointerCancel);renderer.domElement.addEventListener('lostpointercapture',pointerCancel);renderer.domElement.addEventListener('keydown',keyDown);
    renderer.domElement.addEventListener('dblclick',focusEquipment);window.addEventListener('blur',pointerCancel);
    const theme=matchMedia('(prefers-color-scheme: dark)'),applyTheme=()=>{const bg=theme.matches?0x1b2631:0xe8eef0;scene.background=new T.Color(bg);floor.material.color.set(theme.matches?0x27343f:0xdde5e8);};applyTheme();theme.addEventListener('change',applyTheme);
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    let frame=0,last=performance.now(),count=0,screenRevision='';
    const selections=new Map<string,T.BoxHelper>();
    const dragGeometry=new T.BufferGeometry(),dragCoordinates=new Float32Array(6);dragGeometry.setAttribute('position',new T.BufferAttribute(dragCoordinates,3));const dragMaterial=new T.LineBasicMaterial({color:0xf2a13e,linewidth:3}),dragLine=new T.Line(dragGeometry,dragMaterial);dragLine.visible=false;world.add(dragLine);
    const tick=(now:number)=>{const dt=Math.min(.1,(now-last)/1000);last=now;if(!document.hidden){if(gesture&&current.current.interaction!=='edit')pointerCancel();if(dirty)synchronize();const elapsed=reduced.matches?0:dt;for(const scope of [equipmentResources,routeResources])for(const update of scope.updaters)update(elapsed);
      const selected=new Set(current.current.selectedIds??[current.current.selected]);node.dataset.selectedEquipment=[...selected].join(',');for(const [id,helper] of selections)if(!selected.has(id)||!roots.has(id)){scene.remove(helper);helper.geometry.dispose();helper.material.dispose();selections.delete(id);}
      for(const id of selected){const chosen=roots.get(id);if(!chosen)continue;let helper=selections.get(id);if(!helper){helper=new T.BoxHelper(chosen,0x258ebb);scene.add(helper);selections.set(id,helper);}helper.setFromObject(chosen);}
      if(!dragLine.parent)world.add(dragLine);const preview=current.current.cablePreview,route=preview&&current.current.routes.find(item=>item.id===preview.id),fixed=preview?.end==='from'?route?.points.at(-1):route?.points[0];dragLine.visible=!!preview&&!!fixed;if(preview&&fixed){dragCoordinates.set([fixed.x,fixed.z,fixed.y,preview.x,preview.z,preview.y]);dragGeometry.attributes.position!.needsUpdate=true;dragGeometry.computeBoundingSphere();}
      if(!gesture)controls.update();renderer.render(scene,camera);node.dataset.cameraPose=JSON.stringify([...camera.position.toArray(),...controls.target.toArray()]);node.dataset.dragTip=JSON.stringify(current.current.cablePreview??null);node.dataset.frames=String(++count);const nextScreens=JSON.stringify([node.dataset.cameraPose,equipmentRevision,routeRevision,[...roots].map(([id,root])=>[id,root.position.x,root.position.y,root.position.z]),node.clientWidth,node.clientHeight]);if(nextScreens!==screenRevision){screenRevision=nextScreens;const rect=renderer.domElement.getBoundingClientRect(),projectPoint=(point:T.Vector3)=>{point.project(camera);return {x:Math.round(rect.left+(point.x+1)*rect.width/2),y:Math.round(rect.top+(1-point.y)*rect.height/2)};},project=(mesh:T.Object3D)=>projectPoint(mesh.getWorldPosition(new T.Vector3()));node.dataset.cablePlugs=JSON.stringify(plugMeshes.map(mesh=>({...mesh.userData.cablePlug,...project(mesh)})));const ports:{device:string;port:string;x:number;y:number}[]=[];for(const root of roots.values())root.traverse(object=>{if(object.userData.port&&object.userData.device)ports.push({device:String(object.userData.device),port:String(object.userData.port),...project(object)});});node.dataset.portScreens=JSON.stringify(ports);node.dataset.equipmentScreens=JSON.stringify([...roots].map(([id,root])=>({id,...projectPoint(new T.Box3().setFromObject(root).getCenter(new T.Vector3()))})));}}frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);
    return()=>{pointerCancel();window.removeEventListener('blur',pointerCancel);cancelAnimationFrame(frame);resize.disconnect();theme.removeEventListener('change',applyTheme);renderer.domElement.removeEventListener('pointerdown',pointerDown,true);renderer.domElement.removeEventListener('pointermove',pointerMove);renderer.domElement.removeEventListener('pointerup',pointerUp);renderer.domElement.removeEventListener('pointercancel',pointerCancel);renderer.domElement.removeEventListener('lostpointercapture',pointerCancel);renderer.domElement.removeEventListener('dblclick',focusEquipment);renderer.domElement.removeEventListener('keydown',keyDown);controls.dispose();for(const helper of selections.values()){helper.geometry.dispose();helper.material.dispose();}dragGeometry.dispose();dragMaterial.dispose();environment.dispose();dispose(equipmentResources);dispose(routeResources);for(const m of materials)m.dispose();floor.geometry.dispose();floor.material.dispose();grid.geometry.dispose();for(const m of Array.isArray(grid.material)?grid.material:[grid.material])m.dispose();renderer.dispose();renderer.domElement.remove();rebuild.current=()=>{};fit.current=()=>{};};
  },[]);
  useEffect(()=>rebuild.current(),[props.project,props.routes,props.interaction]);useEffect(()=>fit.current(),[props.fit]);
  return error ? <div className="scene3d-fallback"><Scene {...props}/><p role="status">{props.locale==='ru'?'3D недоступна. Продолжаем в 2D.':'3D unavailable. Continuing in 2D.'}</p></div> : <div ref={host} className="scene3d" aria-label="3D process model"/>;
}
