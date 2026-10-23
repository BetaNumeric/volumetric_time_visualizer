const test = require('node:test');
const assert = require('node:assert/strict');
const checkAssets = require('../scripts/check-assets.cjs');
test('offline distribution contains local assets and unchanged vendor files', () => {
    const result = checkAssets();
    assert.ok(result.localDependencies > 0);
    assert.equal(result.verifiedVendorFiles, 4);
});
