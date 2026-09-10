import {test} from 'node:test';
import assert from 'node:assert/strict';
import {expectedAudits} from './audit-verification.mjs';
test('counts successful and failed audited writes but not public verification or reads',()=>{
  assert.equal(expectedAudits({root_group:{checks:[
    {name:'draft success',passes:9,fails:1},{name:'submit success',passes:8,fails:2},
    {name:'verify success',passes:1000,fails:0},{name:'products success',passes:1000,fails:0},
    {name:'current success',passes:1000,fails:0}
  ]}}),20);
});
test('entry-only peak has no audit writes under the existing public-route policy',()=>{
  assert.equal(expectedAudits({root_group:{checks:[{name:'verify success',passes:20,fails:0}]}}),0);
});
