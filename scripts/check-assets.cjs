const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');

function checkAssets() {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const dependencies = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map(match => match[1]);
    for (const dependency of dependencies) {
        if (!fs.existsSync(path.join(root, dependency))) throw new Error(`Missing asset: ${dependency}`);
    }
    if (/<(?:script|link)\b[^>]*(?:src|href)="https?:/i.test(html)) {
        throw new Error('Startup depends on an external asset.');
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor/manifest.json'), 'utf8'));
    for (const asset of manifest) {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'vendor', asset.file))).digest('hex');
        if (hash !== asset.sha256) throw new Error(`Vendor checksum mismatch: ${asset.file}`);
    }
    return { localDependencies: dependencies.length, verifiedVendorFiles: manifest.length };
}

if (require.main === module) console.log(checkAssets());
module.exports = checkAssets;
