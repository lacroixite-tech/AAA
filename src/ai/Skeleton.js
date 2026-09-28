import * as THREE from 'three';

/**
 * Soldier skeleton in bind pose ("character space": feet at y=0, forward +Z, soldier's LEFT = +X).
 * Every bone has identity rotation in bind, so a bone's orientation is fully described by its
 * character-space quaternion; `dir` (head->tail) and `front` are the bind reference axes used by
 * the positional pose solver (see SoldierRig.orient).
 */
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const J = {
  hips: V(0, 0.98, 0), spine: V(0, 1.10, -0.01), chest: V(0, 1.30, -0.015), neck: V(0, 1.50, -0.02),
  head: V(0, 1.595, -0.005), headTip: V(0, 1.80, 0.0),
};
for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
  J['clav' + k] = V(0.025 * s, 1.455, -0.005);
  J['shoulder' + k] = V(0.185 * s, 1.445, -0.02);
  J['elbow' + k] = V(0.205 * s, 1.155, -0.04);
  J['wrist' + k] = V(0.215 * s, 0.895, -0.015);
  J['handTip' + k] = V(0.218 * s, 0.795, -0.015);
  J['hip' + k] = V(0.095 * s, 0.93, 0.0);
  J['knee' + k] = V(0.105 * s, 0.51, 0.018);
  J['ankle' + k] = V(0.115 * s, 0.085, -0.03);
  J['toe' + k] = V(0.12 * s, 0.03, 0.15);
}

const FZ = V(0, 0, 1), FY = V(0, 1, 0);
// name, parent, head joint, tail joint, front
const DEF = [
  ['root', null, V(0, 0, 0), V(0, 1, 0), FZ],
  ['hips', 'root', J.hips, J.spine, FZ],
  ['spine', 'hips', J.spine, J.chest, FZ],
  ['chest', 'spine', J.chest, J.neck, FZ],
  ['neck', 'chest', J.neck, J.head, FZ],
  ['head', 'neck', J.head, J.headTip, FZ],
];
for (const k of ['L', 'R']) {
  DEF.push(
    ['clav' + k, 'chest', J['clav' + k], J['shoulder' + k], FZ],
    ['uarm' + k, 'clav' + k, J['shoulder' + k], J['elbow' + k], FZ],
    ['farm' + k, 'uarm' + k, J['elbow' + k], J['wrist' + k], FZ],
    ['hand' + k, 'farm' + k, J['wrist' + k], J['handTip' + k], FZ],
    ['thigh' + k, 'hips', J['hip' + k], J['knee' + k], FZ],
    ['shin' + k, 'thigh' + k, J['knee' + k], J['ankle' + k], FZ],
    ['foot' + k, 'shin' + k, J['ankle' + k], J['toe' + k], FY],
  );
}
DEF.push(['weapon', 'root', V(0, 0, 0), V(0, 0, 1), FY]);
DEF.push(['mag', 'root', V(0, 0, 0), V(0, 0, 1), FY]);

export const BONES = DEF.map(([name, parent, head, tail, front], i) => ({ name, parent, head, tail, front, i }));
export const BI = Object.fromEntries(BONES.map((b) => [b.name, b.i]));
for (const b of BONES) {
  b.p = b.parent ? BI[b.parent] : -1;
  b.len = b.head.distanceTo(b.tail);
  b.dir = b.tail.clone().sub(b.head).normalize();
  b.frontO = b.front.clone().addScaledVector(b.dir, -b.front.dot(b.dir)).normalize();
  // inverse bind basis (rows) so that Q = Bcur * Bbind^T
  const x = new THREE.Vector3().crossVectors(b.dir, b.frontO);
  b.bindBasis = new THREE.Matrix4().makeBasis(b.dir, b.frontO, x);
  b.bindBasisInv = b.bindBasis.clone().transpose();
  b.offset = b.p >= 0 ? b.head.clone().sub(BONES[b.p].head) : b.head.clone();
}

/** Build a THREE.Bone hierarchy in bind pose. Returns { bones[], root }. */
export function createBones() {
  const bones = BONES.map((b) => { const bone = new THREE.Bone(); bone.name = b.name; bone.position.copy(b.offset); return bone; });
  for (const b of BONES) if (b.p >= 0) bones[b.p].add(bones[b.i]);
  return { bones, root: bones[0] };
}
