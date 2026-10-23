/* Import state is staged while the previous stack stays available for rollback. */
function captureSourceState() {
    return {
        source: { currentSourceType, currentSourceDuration, currentSourceSignature, currentPreviewFilename,
            currentSequenceFiles, currentVideoFile, currentMetadataFile, currentSourceMetadata,
            currentSequenceFps, currentSequenceDirectoryHandle, targetFrameCount, loadedSamplingSignature },
        geometry: { ...sourceGeometry }, generation: { ...stackGenParams }, playback: { ...playback },
        camera: activeCamera.clone(), target: controls.target.clone(), autoRotate: controls.autoRotate,
        fields: Array.from(mainPanel.querySelectorAll('input:not([type=file]), select')).map(field =>
            ({ field, value: field.value, checked: field.checked, min: field.min, max: field.max }))
    };
}

function restoreSourceState(snapshot) {
    ({ currentSourceType, currentSourceDuration, currentSourceSignature, currentPreviewFilename,
        currentSequenceFiles, currentVideoFile, currentMetadataFile, currentSourceMetadata,
        currentSequenceFps, currentSequenceDirectoryHandle, targetFrameCount, loadedSamplingSignature } = snapshot.source);
    Object.assign(sourceGeometry, snapshot.geometry);
    Object.assign(stackGenParams, snapshot.generation);
    Object.assign(playback, snapshot.playback, { lastTime: 0 });
    snapshot.fields.forEach(({ field, value, checked, min, max }) => {
        if (min !== undefined) field.min = min;
        if (max !== undefined) field.max = max;
        field.value = value;
        if (checked !== undefined) field.checked = checked;
    });
    activeCamera.position.copy(snapshot.camera.position);
    activeCamera.quaternion.copy(snapshot.camera.quaternion);
    activeCamera.up.copy(snapshot.camera.up);
    activeCamera.zoom = snapshot.camera.zoom;
    activeCamera.updateProjectionMatrix();
    controls.target.copy(snapshot.target);
    controls.autoRotate = snapshot.autoRotate;
    setSequenceToolsVisible(sourceGeometry.isSequence);
    updateSequenceGeometryDisplay();
    updateTrimLabel();
    updateMemoryEstimate();
    playPauseBtn.textContent = playback.isPlaying ? 'Pause' : 'Play';
    updateRegenerateHint();
}

function disposeStackResources(group, scanner) {
    const geometries = new Set(), textures = new Set();
    [...group.children, scanner].filter(Boolean).forEach(mesh => {
        if (!geometries.has(mesh.geometry)) { mesh.geometry.dispose(); geometries.add(mesh.geometry); }
        const texture = mesh.material?.uniforms?.map?.value;
        if (texture && !textures.has(texture)) { disposeFrameTexture(texture); textures.add(texture); }
        mesh.material?.dispose();
    });
    scene.remove(group);
    if (scanner) scene.remove(scanner);
    group.clear();
}

function commitSourceFrames(frames) {
    const previous = { group: stackGroup, meshes: frameMeshes, scanner: scannerMesh };
    stackGroup = new THREE.Group();
    stackGroup.scale.copy(previous.group.scale);
    frameMeshes = [];
    scannerMesh = null;
    try {
        buildStack(frames);
        scene.add(stackGroup);
    } catch (error) {
        disposeStackResources(stackGroup, scannerMesh);
        stackGroup = previous.group;
        frameMeshes = previous.meshes;
        scannerMesh = previous.scanner;
        throw error;
    }
    disposeStackResources(previous.group, previous.scanner);
    disposeExposure();
    viewportTrail.invalidate();
    resetPlaybackState();
    updateVisibility();
    loadedSamplingSignature = samplingSignature();
    updateRegenerateHint();
}
