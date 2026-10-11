import type {Project} from '../core';
import {calibratedPipeRadius} from './pipe-dimensions';
import {routingWaypoints,type PhysicalRoute} from '../topology';
import {inspectPipeInstallation,type InstallationReport,type InstallationRules} from './pipe-installation';

/** Accepts the caller's actual route projection, including cached corridors during a drag.
 * Omitted/paged-out routes are unknown, never implicitly collision-free. */
export function inspectProjectPipeRoutes(project:Project,routes:readonly PhysicalRoute[],rules:InstallationRules={}):InstallationReport {
  const radiusOfTwoMm=calibratedPipeRadius(project,2);
  const millimetresPerUnit=radiusOfTwoMm===undefined?undefined:1/radiusOfTwoMm;
  const byId=new Map(routes.filter(route=>route.kind==='pipe').map(route=>[route.id,route]));
  return inspectPipeInstallation(project.pipes.map(pipe=>{
    const route=byId.get(pipe.id);
    return {id:pipe.id,points:route?.points??[],valid:route?.valid??false,
      outsideDiameterMm:pipe.outerDiameterMm,millimetresPerUnit,visualInset:12,
      fixed:route?routingWaypoints(project,pipe):[]};
  }),rules);
}
