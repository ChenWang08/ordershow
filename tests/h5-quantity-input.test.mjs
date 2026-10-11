import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { loadModule } from './helpers/load-ts-module.mjs';

function harness(initial = 0) {
  let draft = null;
  const props = { value: initial, label: '订货箱数', onChange(value) { props.value = value; } };
  const { QuantityInput } = loadModule('app/features/h5/QuantityInput.tsx', {
    react: { ...React, useState: () => [draft, value => { draft = value; }] },
  });
  const input = () => QuantityInput(props).props;
  return { props, input, focus() { input().onFocus({ currentTarget: { select() {} } }); }, type(text) { input().onChange({ target: { value: text } }); }, blur() { input().onBlur(); } };
}

test('zero can be erased and replaced; leading zeros normalize on blur', () => {
  const h = harness(); h.focus(); h.type('');
  assert.equal(h.input().value, '');
  h.type('0020'); assert.equal(h.input().value, '0020'); assert.equal(h.props.value, 20);
  h.blur(); assert.equal(h.input().value, '20');
});
test('empty cart input keeps its row while editing and commits zero on blur', () => {
  const h = harness(200); h.focus(); h.type('');
  assert.equal(h.props.value, 200); assert.equal(h.input().value, '');
  h.type('30'); h.blur(); assert.equal(h.props.value, 30);
  h.focus(); h.type(''); h.blur(); assert.equal(h.props.value, 0); assert.equal(h.input().value, '0');
});
test('only whole nonnegative digits are accepted and quantity is capped', () => {
  const h = harness(20); h.focus();
  for (const text of ['-1', '1.5', '1e3', 'abc']) { h.type(text); assert.equal(h.props.value, 20); }
  h.type('1000000'); assert.equal(h.props.value, 999999); assert.equal(h.input().value, '999999');
  h.blur(); h.props.value = 15; assert.equal(h.input().value, '15');
});
