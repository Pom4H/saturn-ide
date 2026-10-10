import * as T from 'three';

/** Round the corners of an authored route without moving its terminal endpoints. */
export function roundedRoute(points: readonly T.Vector3[], bend = 12, fixed: readonly T.Vector3[] = []): { path: T.CurvePath<T.Vector3>; bends: number } {
  const path = new T.CurvePath<T.Vector3>();
  if (points.length < 2) return { path, bends: 0 };
  let cursor = points[0]!.clone(), bends = 0;
  const line = (end: T.Vector3) => {
    if (cursor.distanceToSquared(end) > 1e-6) path.add(new T.LineCurve3(cursor.clone(), end.clone()));
    cursor = end.clone();
  };
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1]!, corner = points[i]!, after = points[i + 1]!;
    // A measured passage is an exact centerline constraint, not a bend hint.
    if(fixed.some(point=>point.distanceToSquared(corner)<1e-12)){line(corner);continue;}
    const incoming = corner.clone().sub(before), outgoing = after.clone().sub(corner);
    const left = incoming.length(), right = outgoing.length();
    if (left < 1e-3 || right < 1e-3) continue;
    incoming.divideScalar(left); outgoing.divideScalar(right);
    if (incoming.dot(outgoing) > .999) continue;
    if (incoming.dot(outgoing) < -.999) { line(corner); continue; }
    const inset = Math.min(bend, left * .35, right * .35);
    const enter = corner.clone().addScaledVector(incoming, -inset);
    const leave = corner.clone().addScaledVector(outgoing, inset);
    line(enter);
    path.add(new T.QuadraticBezierCurve3(enter, corner.clone(), leave));
    cursor = leave;
    bends++;
  }
  line(points.at(-1)!);
  return { path, bends };
}
