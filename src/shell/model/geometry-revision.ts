import type { Project } from '../../core';
/** Geometry is a projection of definitions, not telemetry or authored placement. */
export function geometryRevision(project:Project,interaction?:'select'|'edit'):string {
  return JSON.stringify([project.id,interaction,project.equipment.map(equipment=>{
    const {x:_x,y:_y,z:_z,...definition}=equipment;
    return definition;
  })]);
}
