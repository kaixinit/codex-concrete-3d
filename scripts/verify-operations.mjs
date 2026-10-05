import assert from 'node:assert/strict';
import {SCENARIOS, getWorkflowState} from '../src/workflow.js';
import {getOperations, entityDetail, OPERATIONS_SNAPSHOT} from '../src/operations.js';

// Exercise each stage's beginning, middle, and event thresholds without
// accumulating state in the display layer. Every value is demo workflow data.
let samples = 0;
const counters = {
  preReceipt:0, preSignature:0, stockRows:0, faultStates:0, isolation:0,
};

for (const scenario of Object.values(SCENARIOS)) {
  for (const stage of scenario.stages) {
    for (let step = 0; step <= 10; step++) {
      const state = getWorkflowState(scenario.id, stage.start + stage.duration * step / 10);
      const context = scenario.id + '/' + stage.key + '/' + step;
      const operations = getOperations(state);
      const vehicle = operations.fleet[0];

      assert.equal(vehicle.source, 'workflow', context + ': current vehicle source');
      assert.equal(vehicle.entityId, state.vehicleId, context + ': same vehicle');
      assert.equal(vehicle.vehicleCode, state.vehicleCode, context + ': vehicle code');
      assert.equal(vehicle.task, state.task, context + ': current vehicle task');
      assert.equal(vehicle.target, state.warehouse, context + ': current vehicle destination');
      assert.equal(vehicle.material, state.short, context + ': current vehicle material');
      assert.equal(vehicle.status, state.vehicleStatus, context + ': current vehicle status');
      assert.deepEqual(vehicle.position, state.vehiclePosition, context + ': current position');
      assert.notStrictEqual(vehicle.position, state.vehiclePosition, context + ': copied position');
      assert.equal(JSON.stringify(operations), JSON.stringify(getOperations(state)),
        context + ': repeated calls cannot accumulate quantity');
      assert.equal(entityDetail(state.vehicleId, state).task, state.task,
        context + ': vehicle detail task');
      assert(entityDetail(state.vehicleId, state).fields.some(
        ([label, value]) => label === '关联任务' && value === state.task),
        context + ': visible vehicle detail task');

      for (const stock of operations.stocks) {
        assert(Number.isFinite(stock.current) && stock.current >= 0,
          context + ': stock must have a finite nonnegative lower bound');
        assert(Number.isFinite(stock.capacity) && stock.capacity > 0,
          context + ': capacity must be positive');
        assert(stock.current <= stock.capacity,
          context + ': demo stock must fit demo capacity');
        assert(stock.ratio >= 0 && stock.ratio <= 1,
          context + ': stock display ratio bounds');
        assert.equal(stock.unit, 't', context + ': stock unit');
        assert.equal(stock.low, stock.current < stock.threshold,
          context + ': low inventory threshold');
        counters.stockRows++;
      }
      assert.equal(operations.stocks.find(stock => stock.id === 'cement').capacity, 220);
      assert.equal(operations.stocks.find(stock => stock.id === 'flyash').capacity, 120);

      const snapshotFleet = operations.fleet.slice(1);
      assert(snapshotFleet.length > 0, context + ': example fleet is explicitly separated');
      assert(snapshotFleet.every(row =>
        row.source === 'snapshot' && row.position === null && row.progress === null &&
        row.sourceLabel.includes('非实时')),
        context + ': snapshot fleet cannot imply live tracking');

      if (state.flowKind !== 'concrete') {
        const currentStock = operations.stocks.find(stock => stock.id === scenario.id);
        assert.equal(currentStock.source, 'workflow', context + ': current material source');
        assert.equal(currentStock.current, state.stock, context + ': stock comes from workflow');
        assert.equal(currentStock.consumed, state.materialConsumed,
          context + ': consumption comes from workflow');
        assert.equal(operations.summary.receiptAdded, state.tareMeasured ? state.stockAdded : 0,
          context + ': receipt event gating');
        if (!state.tareMeasured) {
          assert.equal(operations.summary.receiptAdded, 0, context + ': no pre-weigh receipt');
          assert.equal(currentStock.added, 0, context + ': no pre-weigh stock addition');
          assert.equal(currentStock.current, scenario.initialStock,
            context + ': gross/unload alone cannot change book stock');
          assert.equal(vehicle.quantity, null, context + ': no unmeasured net quantity');
          counters.preReceipt++;
        } else {
          assert.equal(currentStock.added, scenario.net, context + ': receipt net added once');
          assert.equal(currentStock.current,
            scenario.initialStock + scenario.net - state.materialConsumed,
            context + ': inventory balance');
        }
        for (const stock of operations.stocks.filter(item => item.id !== scenario.id)) {
          assert.equal(stock.source, 'snapshot', context + ': unrelated stock is snapshot');
          assert.equal(stock.current, SCENARIOS[stock.id].initialStock,
            context + ': unrelated inventory remains independent');
          assert.equal(stock.added, 0);
          assert.equal(stock.consumed, 0);
        }
      } else {
        assert.equal(vehicle.onboardVolume, state.onboardVolume, context + ': current onboard');
        assert.equal(operations.summary.deliveredAdded, state.deliveredVolume,
          context + ': signed quantity from workflow');
        assert.equal(operations.kpis.find(kpi => kpi.id === 'delivery').value,
          OPERATIONS_SNAPSHOT.delivered + state.deliveredVolume,
          context + ': one signed-task increment');
        if (!state.delivered) {
          assert.equal(operations.summary.deliveredAdded, 0, context + ': no pre-signature delivery');
          assert.equal(operations.kpis.find(kpi => kpi.id === 'delivery').value,
            OPERATIONS_SNAPSHOT.delivered, context + ': no pre-signature KPI increment');
          counters.preSignature++;
        }
        const expectedProduction = state.productionProgress >= 1 ? state.plannedVolume : 0;
        assert.equal(operations.summary.productionAdded, expectedProduction,
          context + ': production only added after this batch completes');
        for (const stock of operations.stocks) {
          assert.equal(stock.source, 'snapshot',
            context + ': concrete workflow has no precise raw consumption');
          assert.equal(stock.current, SCENARIOS[stock.id].initialStock,
            context + ': no invented concrete raw-material deduction');
          assert.equal(stock.consumed, 0);
        }
      }

      const unacknowledged = getOperations(state, {faultActive:true, acknowledged:false});
      const acknowledged = getOperations(state, {faultActive:true, acknowledged:true});
      const ackAlert = acknowledged.alerts.find(alert => alert.id === 'fault-b01');
      const blocked = (state.flowKind === 'concrete' && state.stageName === 'production') ||
        (state.flowKind === 'aggregate' && state.stageName === 'supply');
      assert(ackAlert, context + ': acknowledging cannot remove the fault');
      assert.equal(ackAlert.status, '已确认 · 待处理', context + ': ack status');
      assert.equal(ackAlert.acknowledged, true);
      assert.equal(ackAlert.blocking, blocked, context + ': ack cannot clear blocking');
      assert.equal(ackAlert.nextAction.type, 'clear_fault',
        context + ': clearing remains an explicit separate action');
      assert.equal(acknowledged.summary.blocked, blocked);
      assert.equal(acknowledged.summary.blocked, unacknowledged.summary.blocked);
      assert.equal(acknowledged.alerts.length, unacknowledged.alerts.length);
      assert.equal(getOperations(state, {faultActive:false}).summary.blocked, false);
      assert(!getOperations(state, {faultActive:false}).alerts.some(alert => alert.id === 'fault-b01'));
      counters.faultStates++;

      // Mutating returned UI rows must not change a later calculation,
      // the source workflow, another material, or the snapshot templates.
      const baseline = JSON.stringify(getOperations(state));
      const copy = getOperations(state);
      copy.stocks[0].current = -999;
      copy.fleet[1].status = 'modified externally';
      copy.fleet[0].position[0] += 1000;
      copy.alerts[0].title = 'modified externally';
      assert.equal(JSON.stringify(getOperations(state)), baseline,
        context + ': returned data and snapshot templates are independent');
      assert.deepEqual(getOperations(state).fleet[0].position, state.vehiclePosition,
        context + ': source position remains unchanged');
      counters.isolation++;
      samples++;
    }
  }
}

console.log('PASS: ' + samples + ' workflow samples.');
console.log('  Receipt-before-reweigh checks: ' + counters.preReceipt);
console.log('  Zero-delivery-before-signature checks: ' + counters.preSignature);
console.log('  Nonnegative stock / valid capacity rows: ' + counters.stockRows);
console.log('  Ack preserves fault and production/supply blocking: ' + counters.faultStates);
console.log('  Snapshot isolation and repeated-call idempotence: ' + counters.isolation);
console.log('  Current vehicle identity, task, position and metadata: ' + samples);
