import type { Driver, Value } from '@saturn/core';
import { booster, controller, outlet, reservoir } from '../project';
// Demonstration only; not a hydraulic solver or physical PLC driver.
const commands:Record<string,Value>={};
const driver:Driver={
  mode:'simulation',
  async start({project,snapshot,publish}){
    let disposed=false,elapsed=0,timer:ReturnType<typeof setTimeout>;
    for(const signal of Object.values(project.signals))commands[signal.id]??=snapshot.samples[signal.id]?.value??signal.initial;
    const tick=async()=>{
      if(disposed)return;
      const running=commands[booster.run.id]===true,opening=Number(commands[outlet.opening.id]??0);
      await publish({
        [booster.run.id]:running,[booster.rpm.id]:running?1450:0,[outlet.opening.id]:opening,
        [booster.flow.id]:running?opening*.24:0,[booster.pressure.id]:running?2+(100-opening)*.038:0,
        [reservoir.level.id]:64+Math.sin(elapsed++/30)*3,[controller.online.id]:true,
      });
      if(!disposed)timer=setTimeout(()=>void tick().catch(console.error),1000);
    };
    await tick();return()=>{disposed=true;clearTimeout(timer);};
  },
  async write(id,value){commands[id]=value;},
};
export default driver;