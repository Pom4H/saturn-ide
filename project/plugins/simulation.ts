import type { Driver, Value } from '@saturn/core';
// Demonstration only; not a hydraulic solver or physical PLC driver.
const commands:Record<string,Value>={};
const driver:Driver={
  mode:'simulation',
  async start({project,snapshot,publish}){
    let disposed=false,elapsed=0,timer:ReturnType<typeof setTimeout>;
    for(const s of Object.values(project.signals))commands[s.id]??=snapshot.samples[s.id]?.value??s.initial;
    const tick=async()=>{
      if(disposed)return;
      const running=commands['pump.run']===true,opening=Number(commands['valve.opening']??0);
      await publish({'pump.run':running,'pump.rpm':running?1450:0,'valve.opening':opening,'station.flow':running?opening*.24:0,'station.pressure':running?2+(100-opening)*.038:0,'tank.level':64+Math.sin(elapsed++/30)*3,'plc.online':true});
      if(!disposed)timer=setTimeout(()=>void tick().catch(console.error),1000);
    };
    await tick();return()=>{disposed=true;clearTimeout(timer);};
  },
  async write(id,value){commands[id]=value;},
};
export default driver;
