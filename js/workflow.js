function samplingSignature() {
    return JSON.stringify([fpsSelect.value, resolutionSelect.value, inputs.count.value,
        trimStartInput.value, trimEndInput.value]);
}

function updateRegenerateHint() {
    const pending = frameMeshes.length > 0 && samplingSignature() !== loadedSamplingSignature;
    document.getElementById('regenerateHint').textContent = pending
        ? 'Sampling settings changed. Regenerate Stack to resample the source.' : '';
}

function initializeWorkflow() {
    const select = document.getElementById('presetSelect');
    const name = document.getElementById('presetName');
    const status = document.getElementById('settingsStatus');
    const refresh = selected => {
        select.replaceChildren(new Option('Choose a preset', ''));
        VolumeSettings.names().forEach(label => select.add(new Option(label, label)));
        select.value = selected || '';
    };
    mainPanel.addEventListener('input', updateRegenerateHint);
    mainPanel.addEventListener('change', () => {
        updateRegenerateHint();
        if (!VolumeSettings.save()) status.textContent = 'Settings cannot be stored in this browser. They still work for this session.';
    });
    document.getElementById('savePresetBtn').addEventListener('click', () => {
        const label = name.value.trim();
        if (!label) { status.textContent = 'Enter a name for the render preset.'; return; }
        const stored = VolumeSettings.savePreset(label);
        refresh(label);
        status.textContent = stored ? `Saved ${label}.` : 'Preset kept for this session; browser storage is unavailable.';
    });
    document.getElementById('applyPresetBtn').addEventListener('click', () => {
        if (!select.value) return;
        VolumeSettings.applyPreset(select.value);
        status.textContent = `Applied ${select.value}. Physical placement is unchanged.`;
        updateRegenerateHint();
    });
    document.getElementById('deletePresetBtn').addEventListener('click', () => {
        if (!select.value) return;
        VolumeSettings.deletePreset(select.value);
        refresh();
        status.textContent = 'Preset deleted.';
    });
    select.addEventListener('change', () => { name.value = select.value; });
    document.getElementById('resetGeometryBtn').addEventListener('click', () => {
        if (!frameMeshes.length || isProcessing) return;
        applySequenceGeometry(normalizeSequenceMetadata(currentSourceMetadata), frameMeshes.length, Boolean(currentMetadataFile));
        updateSpacing(sourceGeometry.spacingCm);
        updateVisibility();
        markExposureDirty('GEOMETRY RESET');
    });
    ['exposureModel', 'exposureDuration'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => markExposureDirty('EXPOSURE MODEL CHANGED'));
    });
    document.getElementById('interpolateToggle').addEventListener('change', () => {
        viewportTrail.invalidate();
        updateVisibility();
        requestRender();
    });
    document.getElementById('retryFailedBtn').addEventListener('click', () => {
        const jobs = batchPreviewResults.filter(result => result.status === 'failed').map(result => result.job);
        runBatchPreviewQueue({ jobs });
    });
    VolumeSettings.load();
    VolumeSettings.restore();
    refresh();
}

function updateBatchResults() {
    const list = document.getElementById('batchResults');
    list.replaceChildren();
    batchPreviewResults.forEach(result => {
        const item = document.createElement('li');
        item.textContent = `${result.job.name}: ${result.status}${result.error ? ' — ' + result.error : ''}`;
        list.appendChild(item);
    });
    document.getElementById('retryFailedBtn').disabled = isBatchPreviewRunning || isProcessing
        || isExportingPreviewImage || !batchPreviewResults.some(result => result.status === 'failed');
}
