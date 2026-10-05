// Metre-based coordinates shared by the entrance model and vehicle journeys.
// The bridge is a flush, through lane; vehicles stop with the full chassis on it.
export const WEIGHBRIDGE_LAYOUT=Object.freeze({
  center:Object.freeze([-25,0,23.5]),
  length:14,
  width:3.6,
  surfaceY:.10,
});
export const ENTRY_BARRIER_Z=34.5;
export const ENTRY_CANOPY_Z=35.7;
export const ENTRY_QUEUE_Z=41.5;
export const WEST_LANE_X=-34;
export const LOADER_PARK=Object.freeze([-34,0,18.5]);
// Leave the unloading approaches open. The collection belt crosses the stone
// approach in a sealed trench rather than above the vehicle running surface.
export const AGGREGATE_BIN_X=Object.freeze([-18.8,-14.7,-5.8]);
export const AGGREGATE_BIN_Z=.1;
export const AGGREGATE_COLLECTION_BELT=Object.freeze({
  start:Object.freeze([-20.7,-.3,AGGREGATE_BIN_Z]),
  slopeStart:Object.freeze([-7.2,-.3,AGGREGATE_BIN_Z]),
  outlet:Object.freeze([-4.4,.77,AGGREGATE_BIN_Z]),
  crossing:Object.freeze({minX:-12.3,maxX:-7.8,surfaceY:.10}),
});
// Rounded tyres have their carcass bottom at local Y=.03; tread presses into it.
export const VEHICLE_ROAD_Y=WEIGHBRIDGE_LAYOUT.surfaceY-.03;
