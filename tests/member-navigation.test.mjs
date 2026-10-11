import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/load-ts-module.mjs';

function render(identity, hasActivity = true) {
  const { AdminLayout } = loadModule('app/features/admin/AdminLayout.tsx', {
    '../../admin-context': { useAdminIdentity: () => identity, useAdminSession: () => null },
  });
  return renderToStaticMarkup(React.createElement(AdminLayout, { tab: '订单管理', onTabChange() {}, hasActivity, header: null }, null));
}
test('order-only member has exactly one business navigation entry and no account administration', () => {
  const html = render({ roleCode: 'DEPARTMENT_MEMBER', displayName: '张三', permissions: ['ORDER'] });
  assert.match(html, /订单管理/);
  for (const label of ['活动概览', '商品导入', '白名单', '现场到场', '抽奖规则', '成员管理', '部门与账号']) assert.equal(html.includes(label), false);
  assert.match(html, /部门成员/);
});
test('department managers retain member management even before their first activity', () => {
  const html = render({ roleCode: 'DEPARTMENT_ADMIN', displayName: '部门管理员' }, false);
  assert.match(html, /成员管理/);
  assert.doesNotMatch(html, /部门与账号/);
  const button = html.match(/<button[^>]*><i[^>]*>成<\/i>成员管理<\/button>/)?.[0];
  assert.ok(button);
  assert.doesNotMatch(button, /disabled/);
});
test('a member whose last permission was removed gets no stale business navigation', () => {
  const html = render({ roleCode: 'DEPARTMENT_MEMBER', permissions: [] });
  assert.equal((html.match(/<button/g) || []).length, 0);
});
