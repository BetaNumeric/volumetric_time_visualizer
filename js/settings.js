/* Versioned preferences; source files and physical placement are never persisted. */
const VolumeSettings = (() => {
    const key = 'volumetric-time.settings.v1';
    const ids = ['fpsSelect', 'resolutionSelect', 'opacity', 'threshold', 'brightThreshold',
        'blendMode', 'scale', 'speed', 'boxToggle', 'orthoToggle', 'smoothMotionToggle',
        'lightPaintToggle', 'previewAngle', 'exposureSamples', 'exposureModel', 'exposureDuration', 'interpolateToggle'];
    let data = { version: 1, values: {}, presets: {} };
    let available = true;
    function load() {
        try {
            const saved = JSON.parse(localStorage.getItem(key) || 'null');
            if (saved?.version === 1 && saved.values && typeof saved.values === 'object'
                && !Array.isArray(saved.values) && saved.presets && typeof saved.presets === 'object'
                && !Array.isArray(saved.presets)) data = saved;
        } catch { available = false; }
    }
    function read() {
        return Object.fromEntries(ids.map(id => {
            const field = document.getElementById(id);
            return [id, field.type === 'checkbox' ? field.checked : field.value];
        }));
    }
    function apply(values) {
        if (!values || typeof values !== 'object' || Array.isArray(values)) return;
        ids.forEach(id => {
            const field = document.getElementById(id), value = values?.[id];
            if (value === undefined) return;
            if (field.type === 'checkbox') {
                if (typeof value !== 'boolean') return;
                field.checked = value;
            } else if (field.tagName === 'SELECT') {
                if (!Array.from(field.options).some(option => option.value === value)) return;
                field.value = value;
            } else {
                if (value === '' || !Number.isFinite(Number(value))) return;
                field.value = Math.max(Number(field.min), Math.min(Number(field.max), Number(value)));
            }
            field.dispatchEvent(new Event(field.type === 'range' ? 'input' : 'change', { bubbles: true }));
        });
    }
    function persist() {
        try { localStorage.setItem(key, JSON.stringify(data)); available = true; }
        catch { available = false; }
        return available;
    }
    function save() { data.values = read(); return persist(); }
    function savePreset(name) {
        data.presets = { ...data.presets, [name]: read() };
        return persist();
    }
    function deletePreset(name) { delete data.presets[name]; return persist(); }
    function names() { return Object.keys(data.presets).sort(); }
    return { load, read, apply, save, savePreset, deletePreset, names,
        restore: () => apply(data.values), applyPreset: name => apply(data.presets[name]) };
})();
