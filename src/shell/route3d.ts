import * as T from 'three';
import {routeGeometry} from '../core/route-geometry';

/** The renderer consumes the same exact centerline description as engineering inspection.
 * Keep the established Bézier appearance; do not claim a constant-radius manufactured elbow. */
export function roundedRoute(points:readonly T.Vector3[],bend=12,fixed:readonly T.Vector3[]=[]):{path:T.CurvePath<T.Vector3>;bends:number} {
  const geometry=routeGeometry(points,bend,fixed),path=new T.CurvePath<T.Vector3>();
  const vector=(point:{x:number;y:number;z:number})=>new T.Vector3(point.x,point.y,point.z);
  for(const curve of geometry.curves)path.add(curve.kind==='line'
    ? new T.LineCurve3(vector(curve.from),vector(curve.to))
    : new T.QuadraticBezierCurve3(vector(curve.from),vector(curve.control),vector(curve.to)));
  return {path,bends:geometry.curves.filter(curve=>curve.kind==='quadratic').length};
}
