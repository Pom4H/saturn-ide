import type {Pipe,Project} from '../core';

/** Converts outside diameter in mm into authored plan coordinates ONLY when imported CAD
 * provides one unambiguous physical scale. Otherwise keep the legacy schematic radius.
 * DN is a designation and must never enter this conversion. */
export function calibratedPipeRadius(project:Pick<Project,'cad'>,outerDiameterMm?:number):number|undefined {
  if(outerDiameterMm===undefined||!Number.isFinite(outerDiameterMm)||outerDiameterMm<=0)return;
  const scales=new Set((project.cad??[]).map(ref=>ref.coordinates.displayScale));
  if(scales.size!==1)return;
  const scale=[...scales][0]!;
  if(!Number.isFinite(scale)||scale<=0)return;
  return outerDiameterMm*scale/2000;
}
export function pipeRenderRadii(project:Pick<Project,'cad'>,pipe:Pick<Pipe,'outerDiameterMm'>){
  const measured=calibratedPipeRadius(project,pipe.outerDiameterMm);
  const shell=measured??9;
  return {shell,fluid:measured===undefined?7:Math.max(.0001,measured*.72),calibrated:measured!==undefined};
}
