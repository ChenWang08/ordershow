import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './helpers/load-ts-module.mjs';

test('slim H5 product response retains image ordering, tier prices and cart fields', () => {
  const { runtimeProductToProduct } = loadModule('app/features/h5/h5-domain.ts', {
    '../../api': { apiAssetUrl: url => `https://fixture.example${url}` },
  });
  const product = runtimeProductToProduct({
    id: 9, materialCode: 'C9', materialName: '商品', description: '说明', productLine: '项目组',
    specification: '500ml', casePack: '12', casePrice: 100, customerType: 'GENERAL',
    rebateStatus: 'PARTICIPATING', giftBox: true, visible: true, orderable: true, dataStatus: 'ACTIVE',
    sortNo: 0, version: 1, branchScope: ['分公司'],
    priceTier: { minQuantity: 10, casePrice: 80, pricingMode: 'INCREMENTAL' },
    images: [{ id: 2, url: '/second', primary: false, sortNo: 0 }, { id: 1, url: '/first', primary: true, sortNo: 1 }],
  });
  assert.equal(product.name, '商品'); assert.equal(product.price, 100); assert.equal(product.isOrderable, true);
  assert.equal(product.materialCode, 'C9'); assert.equal(product.casePack, '12'); assert.equal(product.description, '说明');
  assert.equal(product.tierCasePrice, 80); assert.equal(product.tierMinQuantity, 10); assert.equal(product.tierPricingMode, 'INCREMENTAL');
  assert.deepEqual(Array.from(product.imageUrls), ['https://fixture.example/first', 'https://fixture.example/second']);
  assert.equal(product.imageUrl, product.imageUrls[0]); assert.deepEqual(Array.from(product.branchScope), ['分公司']);
});
