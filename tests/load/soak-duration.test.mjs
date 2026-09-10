import test from 'node:test';
import assert from 'node:assert/strict';
import {assessSoakDuration} from './soak-duration.mjs';
const sample=(ms,count)=>({state:{testRunDurationMs:ms},metrics:{iterations:{values:{count}}}});
test('records the observed 171ms statistics offset without dropping the scheduled-work requirement',()=>{
 const verdict=assessSoakDuration({duration:'60m',rate:'20'},sample(3599828.69356,72000));
 assert.equal(verdict.strictDurationPassed,false);assert.equal(verdict.accepted,true);
 assert(verdict.statisticsShortfallMs>171 && verdict.statisticsShortfallMs<172);
});
test('rejects incomplete work, meaningful time shortfall, and shorter configured tests',()=>{
 assert.equal(assessSoakDuration({duration:'60m',rate:'20'},sample(3600000,71999)).accepted,false);
 assert.equal(assessSoakDuration({duration:'60m',rate:'20'},sample(3598000,72000)).accepted,false);
 assert.equal(assessSoakDuration({duration:'30m',rate:'20'},sample(3600000,72000)).accepted,false);
 assert.equal(assessSoakDuration({duration:'60m',rate:'20'},sample(1800000,36000)).accepted,false);
});
