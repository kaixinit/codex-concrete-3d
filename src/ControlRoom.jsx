import React, { memo, useEffect, useMemo, useRef } from 'react';
import { SceneLabel } from './SceneLabels';
import * as THREE from 'three';

// Two-storey operation building entirely inside the station's southern parking
// strip. Its front edge z=18.0 clears the road edge z=17.8; rear edge z=21.3
// stays inside the fence z=21.5. All visible equipment/people are exportable mesh.
const origin = [9, 0, 19.65];
const colors = {
  white: ['#edf2f3', 0.08, 0.58], concrete: ['#bfc9ce', 0, 0.93], blue: ['#286a9c', 0.17, 0.47],
  steel: ['#879aa5', 0.55, 0.37], dark: ['#344e60', 0.22, 0.55], darkSteel: ['#4e6270', 0.48, 0.42],
  floor: ['#d7dfe0', 0, 0.83], desk: ['#dfdad0', 0, 0.75], rubber: ['#303a44', 0.02, 0.92],
  green: ['#54b494', 0.04, 0.5], amber: ['#dfad4b', 0.09, 0.55], idle: ['#8fa5b2', 0.12, 0.6],
  yellow: ['#e6b438', 0.14, 0.48], skin: ['#dcb296', 0, 0.83], skin2: ['#c79c83', 0, 0.83],
  hair: ['#38424b', 0, 0.94], navy: ['#335a7b', 0.04, 0.84], shirt: ['#9fc0d2', 0.03, 0.82],
  trousers: ['#4b5c68', 0, 0.9], face: ['#273743', 0, 0.92], screenDark: ['#143348', 0.02, 0.55],
};
const materials = Object.fromEntries(Object.entries(colors).map(([name, [color, metalness, roughness]]) =>
  [name, new THREE.MeshStandardMaterial({ color, metalness, roughness })]));
materials.glass = new THREE.MeshStandardMaterial({ color: '#a2c8d7', roughness: 0.14, metalness: 0.08, transparent: true, opacity: 0.24, depthWrite: false });
materials.screen = new THREE.MeshStandardMaterial({ color: '#295575', emissive: '#1d5577', emissiveIntensity: 0.3, roughness: 0.63, metalness: 0.02 });
materials.screenGreen = new THREE.MeshStandardMaterial({ color: '#63bba8', emissive: '#288a74', emissiveIntensity: 0.32, roughness: 0.62 });
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitSphere = new THREE.SphereGeometry(1, 20, 14);
const unitCapsule = new THREE.CapsuleGeometry(0.5, 1, 4, 12);
const cylinders = new Map();
const vertical = new THREE.Vector3(0, 1, 0);
const clamp = value => THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
function cylinder(radius, height, segments = 12) {
  const key = `${radius}/${height}/${segments}`;
  if (!cylinders.has(key)) cylinders.set(key, new THREE.CylinderGeometry(radius, radius, height, segments));
  return cylinders.get(key);
}
function Box({ at = [0, 0, 0], size = [1, 1, 1], mat = 'white', rotation, ...props }) {
  return <mesh geometry={unitBox} material={materials[mat]} position={at} scale={size} rotation={rotation} castShadow receiveShadow {...props} />;
}
function Sphere({ at, size, mat = 'skin' }) {
  return <mesh geometry={unitSphere} material={materials[mat]} position={at} scale={size} castShadow />;
}
function Cylinder({ at = [0, 0, 0], radius = 0.05, height = 1, mat = 'steel', rotation }) {
  return <mesh geometry={cylinder(radius, height)} material={materials[mat]} position={at} rotation={rotation} castShadow />;
}
function Beam({ from, to, radius = 0.026, mat = 'steel', rounded = false }) {
  const key = `${from.join(',')}/${to.join(',')}`;
  const transform = useMemo(() => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), delta = b.clone().sub(a);
    return { center: a.add(b).multiplyScalar(0.5), length: delta.length(), quaternion: new THREE.Quaternion().setFromUnitVectors(vertical, delta.normalize()) };
  }, [key]);
  return <mesh position={transform.center} quaternion={transform.quaternion}
    geometry={rounded ? unitCapsule : cylinder(radius, transform.length)} scale={rounded ? [radius * 2, transform.length / 2, radius * 2] : undefined}
    material={materials[mat]} castShadow />;
}
function TinyLabel({ at, children, selected = false, title = false }) {
  return <SceneLabel at={at} selected={selected} small={!title} priority={title?2:-1}>{children}</SceneLabel>;
}

const BuildingShell = memo(function BuildingShell({ cutaway }) {
  return <group name="two-storey-control-building-shell">
    <Box at={[0, 0.08, 0]} size={[9.2, 0.16, 3.4]} mat="concrete" />
    <Box at={[0, 0.2, 0]} size={[8.85, 0.12, 3.22]} mat="floor" />
    <Box at={[2.1, 3.12, 0]} size={[4.8, 0.17, 3.3]} mat="floor" />
    <Box at={[-2.4, 3.12, -0.77]} size={[4.2, 0.17, 1.76]} mat="floor" />
    <Box at={[-0.12, 3.12, 0.88]} size={[0.72, 0.17, 1.38]} mat="floor" />
    {[-4.43, -0.25, 4.43].flatMap(x => [-1.58, 1.58].map(z => <Box key={`${x}/${z}`} at={[x, 3.16, z]} size={[0.12, 6.1, 0.12]} mat="steel" />))}
    {[0.52, 3.08, 6.08].flatMap(y => [-1.64, 1.64].map(z => <Box key={`${y}/${z}`} at={[0, y, z]} size={[9, 0.18, 0.12]} mat="blue" />))}
    {[-4.47, 4.47].map(x => <Box key={x} at={[x, 3.17, 0]} size={[0.1, 6, 3.3]} mat={cutaway && x > 0 ? 'glass' : 'white'} />)}
    {[1.74, 4.66].map(y => <group key={y}>
      {[-3.3, -1.1, 1.1, 3.3].map(x => <group key={x}>
        <Box at={[x, y, -1.645]} size={[2.12, 2.34, 0.035]} mat="glass" />
        {!cutaway && <Box at={[x, y, 1.645]} size={[2.12, 2.34, 0.035]} mat="glass" />}
        <Box at={[x - 1.08, y, -1.635]} size={[0.045, 2.42, 0.06]} mat="white" />
        {!cutaway && <Box at={[x - 1.08, y, 1.635]} size={[0.045, 2.42, 0.06]} mat="white" />}
      </group>)}
    </group>)}
    {!cutaway && <group name="removable-control-building-roof">
      <Box at={[0, 6.2, 0]} size={[9.4, 0.22, 3.55]} mat="white" />
      <Box at={[0, 6.33, 0]} size={[9.24, 0.05, 3.38]} mat="blue" />
      <Box at={[2.7, 6.57, -0.5]} size={[1.25, 0.42, 0.86]} mat="steel" />
      {[0, 1, 2, 3].map(i => <Box key={i} at={[2.3 + i * 0.26, 6.8, -0.5]} size={[0.075, 0.025, 0.65]} mat="darkSteel" />)}
    </group>}
    <group name="operation-building-entry-door" position={[-3.7, 0, 1.63]}>
      <Box at={[0, 1.45, 0]} size={[1.25, 2.4, 0.035]} mat="glass" />
      <Box at={[0, 2.67, 0]} size={[1.37, 0.08, 0.075]} mat="white" />
      {[-0.63, 0.63].map(x => <Box key={x} at={[x, 1.46, 0]} size={[0.055, 2.45, 0.07]} mat="white" />)}
      <Beam from={[0.27, 1.2, 0.075]} to={[0.27, 1.57, 0.075]} radius={0.02} />
    </group>
  </group>;
});
const InteriorStair = memo(function InteriorStair() {
  return <group name="internal-stair-and-upper-landing">
    {Array.from({ length: 16 }, (_, i) => <Box key={i} at={[-4.15 + i * 0.24, 0.34 + i * 0.18, 0.92]} size={[0.27, 0.07, 0.92]} mat="steel" />)}
    <Beam from={[-4.23, 0.82, 0.39]} to={[-0.45, 3.85, 0.39]} radius={0.03} mat="yellow" />
    <Beam from={[-4.23, 0.82, 1.43]} to={[-0.45, 3.85, 1.43]} radius={0.03} mat="yellow" />
    {[0, 4, 8, 12, 15].flatMap(i => [0.39, 1.43].map(z => <Beam key={`${i}/${z}`} from={[-4.15 + i * 0.24, 0.34 + i * 0.18, z]} to={[-4.15 + i * 0.24, 1.14 + i * 0.18, z]} radius={0.023} />))}
    <Beam from={[-4.23, 3.93, 0.12]} to={[-0.85, 3.93, 0.12]} radius={0.024} mat="yellow" />
    {[-4.2, -3.1, -2, -0.9].map(x => <Beam key={x} from={[x, 3.2, 0.12]} to={[x, 3.94, 0.12]} radius={0.024} />)}
    <Box at={[-3.4, 2.77, -1.6]} size={[1.15, 0.14, 0.06]} mat="green" />
  </group>;
});
function PLCCabinets({ production, time }) {
  return <group name="ground-floor-plc-and-distribution-cabinets">
    {[-0.3, 0.7, 1.7, 2.7, 3.7].map((x, i) => <group key={x} position={[x, 0.27, -1.13]}>
      <Box at={[0, 1.14, 0]} size={[0.88, 2.28, 0.7]} mat={i < 3 ? 'white' : 'blue'} />
      <Box at={[0, 1.16, 0.365]} size={[0.79, 2.1, 0.034]} mat="steel" />
      <Box at={[-0.25, 1.17, 0.405]} size={[0.035, 0.27, 0.038]} mat="dark" />
      <Box at={[0.05, 1.73, 0.395]} size={[0.45, 0.25, 0.035]} mat="screenDark" />
      {[0, 1, 2].map(n => <Sphere key={n} at={[-0.22 + n * 0.21, 1.38, 0.41]} size={[0.036, 0.036, 0.025]} mat={production && (n !== 1 || Math.sin(time * 2.4 + i) > -0.3) ? 'green' : 'idle'} />)}
      {[0, 1, 2, 3].map(n => <Box key={n} at={[0, 0.35 + n * 0.07, 0.395]} size={[0.54, 0.026, 0.025]} mat="darkSteel" />)}
    </group>)}
    <Box at={[1.9, 2.83, -1.05]} size={[4.65, 0.09, 0.32]} mat="darkSteel" />
    {production&&<TinyLabel at={[1.7, 2.96, -1.13]}>自动配料</TinyLabel>}
  </group>;
}
const Chair = memo(function Chair() {
  return <group name="adjustable-operator-chair">
    <Cylinder at={[0, 0.32, 0]} radius={0.065} height={0.5} mat="darkSteel" />
    <Box at={[0, 0.59, 0]} size={[0.49, 0.1, 0.49]} mat="rubber" />
    <Box at={[0, 0.93, 0.23]} size={[0.48, 0.6, 0.095]} mat="navy" rotation={[-0.1, 0, 0]} />
    <Beam from={[0, 0.54, 0.16]} to={[0, 0.94, 0.23]} radius={0.038} mat="darkSteel" />
    {[0, 1, 2, 3, 4].map(i => {
      const angle = i * Math.PI * 2 / 5;
      const x = Math.cos(angle) * 0.27, z = Math.sin(angle) * 0.27;
      return <group key={i}><Beam from={[0, 0.17, 0]} to={[x, 0.14, z]} radius={0.025} mat="darkSteel" /><Sphere at={[x, 0.1, z]} size={[0.045, 0.045, 0.045]} mat="rubber" /></group>;
    })}
  </group>;
});
function Operator({ at, time, working, variant = 0 }) {
  const arm = working ? Math.sin(time * 3.4 + variant * 1.6) * 0.024 : 0;
  const shift = working ? Math.sin(time * 0.85 + variant) * 0.009 : 0;
  const skin = variant ? 'skin2' : 'skin';
  const handRight = [0.16 + arm * 0.3, 0.87 + Math.abs(arm), -0.5 + arm];
  return <group name={`seated-control-operator-${variant + 1}`} position={at} userData={{ entityRole: 'simulation-operator' }}>
    <Chair />
    <group position={[0, shift, 0]}>
      <mesh geometry={unitCapsule} material={materials[variant ? 'shirt' : 'navy']} position={[0, 0.97, -0.015]} scale={[0.29, 0.27, 0.19]} castShadow />
      <Sphere at={[0, 0.74, -0.035]} size={[0.18, 0.12, 0.17]} mat="trousers" />
      <Cylinder at={[0, 1.21, -0.024]} radius={0.048} height={0.11} mat={skin} />
      <Sphere at={[0, 1.38, -0.036]} size={[0.135, 0.17, 0.135]} mat={skin} />
      <Sphere at={[0, 1.48, -0.024]} size={[0.14, 0.085, 0.139]} mat="hair" />
      <Sphere at={[0, 1.36, -0.173]} size={[0.028, 0.028, 0.026]} mat={skin} />
      {[-1, 1].map(side => <group key={side}>
        <Sphere at={[side * 0.058, 1.405, -0.154]} size={[0.012, 0.011, 0.009]} mat="face" />
        <Sphere at={[side * 0.131, 1.38, -0.036]} size={[0.025, 0.041, 0.023]} mat={skin} />
        <Beam from={[side * 0.12, 0.7, -0.06]} to={[side * 0.12, 0.47, -0.31]} radius={0.074} mat="trousers" rounded />
        <Beam from={[side * 0.12, 0.47, -0.31]} to={[side * 0.12, 0.12, -0.35]} radius={0.062} mat="trousers" rounded />
        <Sphere at={[side * 0.12, 0.105, -0.425]} size={[0.084, 0.051, 0.13]} mat="rubber" />
      </group>)}
      <Beam from={[-0.15, 1.11, -0.015]} to={[-0.235, 0.91, -0.22]} radius={0.056} mat={variant ? 'shirt' : 'navy'} rounded />
      <Beam from={[-0.235, 0.91, -0.22]} to={[-0.15, 0.87, -0.5]} radius={0.043} mat={skin} rounded />
      <Sphere at={[-0.15, 0.865, -0.505]} size={[0.049, 0.032, 0.067]} mat={skin} />
      <Beam from={[0.15, 1.11, -0.015]} to={[0.235, 0.92, -0.19]} radius={0.057} mat={variant ? 'shirt' : 'navy'} rounded />
      <Beam from={[0.235, 0.92, -0.19]} to={handRight} radius={0.043} mat={skin} rounded />
      <Sphere at={handRight} size={[0.049, 0.032, 0.067]} mat={skin} />
      <Box at={[0.014, 1.05, -0.11]} size={[0.06, 0.083, 0.009]} mat="white" />
    </group>
  </group>;
}
function Desktop({ x, working, time }) {
  return <group name="operator-desktop-console" position={[x, 3.22, -0.25]}>
    <Box at={[0, 0.73, 0]} size={[1.85, 0.09, 0.85]} mat="desk" />
    {[-0.77, 0.77].map(dx => <Box key={dx} at={[dx, 0.36, 0]} size={[0.1, 0.72, 0.69]} mat="darkSteel" />)}
    <Box at={[0, 0.8, 0.25]} size={[0.64, 0.04, 0.21]} mat="dark" />
    {[0, 1, 2, 3, 4].map(i => <Box key={i} at={[-0.23 + i * 0.115, 0.826, 0.25]} size={[0.08, 0.012, 0.15]} mat="steel" />)}
    <Sphere at={[0.45, 0.82, 0.26]} size={[0.047, 0.02, 0.07]} mat="dark" />
    <Box at={[0, 0.79, -0.25]} size={[0.37, 0.04, 0.27]} mat="darkSteel" />
    <Box at={[0, 0.98, -0.32]} size={[0.045, 0.35, 0.045]} mat="steel" />
    <Box at={[0, 1.17, -0.34]} size={[1.05, 0.61, 0.08]} mat="dark" rotation={[-0.08, 0, 0]} />
    <Box at={[0, 1.17, -0.292]} size={[0.94, 0.51, 0.009]} mat="screen" />
    {[0, 1, 2].map(i => <Box key={i} at={[-0.23 + i * 0.22, 1.08, -0.28]} size={[0.12, 0.14 + (working ? Math.sin(time * 0.5 + i) * 0.06 : 0.02) + i * 0.05, 0.009]} mat={working ? 'screenGreen' : 'idle'} />)}
  </group>;
}
function ActionPad({ at, action, label, enabled, completed, onAction, onSelect }) {
  return <group name={`control-action-${action}`} position={at} userData={{uiAction:action,interactiveEnabled:Boolean(enabled&&onAction)}}
    onClick={event => { event.stopPropagation(); onSelect?.('control-room'); if (enabled) onAction?.(action); }}
    onPointerOver={event => { event.stopPropagation(); }}>
    <Box size={[0.63, 0.105, 0.35]} mat="darkSteel" />
    <Cylinder at={[-0.17, 0.08, 0]} radius={0.07} height={0.07} mat={completed ? 'green' : enabled ? 'blue' : 'idle'} />
    <Sphere at={[0.16, 0.071, 0]} size={[0.035, 0.023, 0.035]} mat={completed ? 'green' : 'idle'} />
    <TinyLabel at={[0, 0.29, 0]}>{label}</TinyLabel>
  </group>;
}
function MonitorWall({ phase, trialPassed, recipeApproved, productionProgress }) {
  const screens = [
    { x: -0.12, title: '配合比', status: recipeApproved ? '已确认' : phase === 'mix_design' ? '设定中' : '待确认', ready: recipeApproved, bars: [0.72, 0.41, 0.56, 0.84] },
    { x: 1.72, title: '试配', status: trialPassed ? '检验通过' : phase === 'trial' ? '检验中' : '待试配', ready: trialPassed, bars: [0.56, 0.68, 0.76, 0.87] },
    { x: 3.55, title: '自动生产', status: productionProgress >= 1 ? '本盘完成' : phase === 'production' ? '运行中' : recipeApproved ? '已就绪' : '待批准', ready: recipeApproved, bars: [productionProgress, productionProgress * 0.82, productionProgress * 0.93, productionProgress] },
  ];
  return <group name="recipe-trial-and-production-monitor-wall">
    <Box at={[1.7, 4.82, -1.42]} size={[5.65, 1.45, 0.1]} mat="darkSteel" />
    {screens.map(screen => <group key={screen.title} position={[screen.x, 4.81, -1.34]}>
      <Box size={[1.64, 1.08, 0.07]} mat="dark" />
      <Box at={[0, 0, 0.041]} size={[1.5, 0.94, 0.012]} mat="screenDark" />
      {screen.bars.map((height, i) => <Box key={i} at={[-0.48 + i * 0.31, -0.3 + height * 0.25, 0.057]} size={[0.17, Math.max(0.045, height * 0.5), 0.013]} mat={screen.ready ? 'screenGreen' : 'blue'} />)}
      <Sphere at={[0.58, 0.31, 0.073]} size={[0.042, 0.042, 0.017]} mat={screen.ready ? 'green' : 'amber'} />
      <TinyLabel at={[0, 0.69, 0.045]}>{screen.title}</TinyLabel>
    </group>)}
  </group>;
}

export default function ControlRoom({ workflow, paused = false, cutaway = false, selectedId, onSelect, onAction }) {
  const phase = workflow?.stageName || workflow?.phase?.key || (typeof workflow?.phase === 'string' ? workflow.phase : '');
  const time = Number(workflow?.time) || 0;
  const businessTime = time;
  const selected = selectedId === 'control-room';
  const trialPassed = Boolean(workflow?.trialPassed);
  const recipeApproved = Boolean(workflow?.recipeApproved);
  const working = ['mix_design', 'trial', 'approval', 'production'].includes(phase);
  const production = phase === 'production';
  const productionProgress = clamp(workflow?.productionProgress);
  return <group name="control-room" userData={{ entityId: 'control-room', assetType: 'operation-building', modelVersion: '3.0', units: 'metres' }} position={origin} dispose={null}
    onClick={event => { event.stopPropagation(); onSelect?.('control-room'); }}
    onPointerOver={event => { event.stopPropagation(); }}>
    <BuildingShell cutaway={cutaway} />
    <InteriorStair />
    <PLCCabinets production={production} time={businessTime} />
    <MonitorWall {...{ phase, trialPassed, recipeApproved, productionProgress }} />
    <Desktop x={0.65} working={working} time={businessTime} />
    <Desktop x={2.75} working={working} time={businessTime + 0.8} />
    <Operator at={[0.65, 3.22, 0.52]} time={businessTime} working={working} />
    <Operator at={[2.75, 3.22, 0.52]} time={businessTime} working={working} variant={1} />
    <ActionPad at={[0.32, 4.025, 0.065]} action="trial" label="试配" enabled={['mix_design', 'trial'].includes(phase)} completed={trialPassed} {...{ onAction, onSelect }} />
    <ActionPad at={[1.0, 4.025, 0.065]} action="approve" label="确认" enabled={trialPassed && !recipeApproved} completed={recipeApproved} {...{ onAction, onSelect }} />
    <ActionPad at={[3.23, 4.025, 0.065]} action="production" label="自动" enabled={recipeApproved} completed={productionProgress >= 1} {...{ onAction, onSelect }} />
    {selected && <group name="control-room-selection">
      {[-1.77, 1.77].map(z => <Box key={z} at={[0, 0.16, z]} size={[9.45, 0.045, 0.06]} mat="blue" />)}
      {[-4.72, 4.72].map(x => <Box key={x} at={[x, 0.16, 0]} size={[0.06, 0.045, 3.6]} mat="blue" />)}
    </group>}
    <TinyLabel at={[0, 6.95, 0]} selected={selected} title>中控操作楼</TinyLabel>
  </group>;
}
