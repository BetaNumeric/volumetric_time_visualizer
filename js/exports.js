        function getSequenceJsonPayload() {
            applyAlignmentToGeometry();
            updateSequenceGeometryDisplay();

            return VolumeCore.metadataPayload(currentSourceMetadata, sourceGeometry);
        }

        function getMetadataFilename() {
            return currentSourceType === 'video' && currentVideoFile
                ? currentVideoFile.name.replace(/\.[^/.]+$/, '') + '.json'
                : 'sequence.json';
        }

        function getSequenceJsonText() {
            return `${JSON.stringify(getSequenceJsonPayload(), null, 2)}\n`;
        }

        function downloadSequenceJson(jsonText) {
            const blob = new Blob([jsonText], { type: 'application/json' });
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = getMetadataFilename();
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(objectUrl);
        }

        async function verifyReadWritePermission(directoryHandle) {
            const options = { mode: 'readwrite' };
            if ((await directoryHandle.queryPermission(options)) === 'granted') return true;
            return (await directoryHandle.requestPermission(options)) === 'granted';
        }

        async function writeSequenceJsonToDirectory(directoryHandle, jsonText) {
            if (!directoryHandle || !(await verifyReadWritePermission(directoryHandle))) return false;

            const fileHandle = await directoryHandle.getFileHandle(getMetadataFilename(), { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(jsonText);
            await writable.close();
            return true;
        }

        async function saveSequenceJsonWithPicker(jsonText) {
            if (!('showSaveFilePicker' in window)) return false;

            try {
                const fileHandle = await window.showSaveFilePicker({
                    suggestedName: getMetadataFilename(),
                    types: [{
                        description: 'JSON',
                        accept: { 'application/json': ['.json'] }
                    }]
                });
                const writable = await fileHandle.createWritable();
                await writable.write(jsonText);
                await writable.close();
                return true;
            } catch (error) {
                if (error && error.name === 'AbortError') return null;
                throw error;
            }
        }

        function flashExportButton(label) {
            const previousLabel = exportSequenceJsonBtn.textContent;
            exportSequenceJsonBtn.textContent = label;
            setTimeout(() => {
                exportSequenceJsonBtn.textContent = previousLabel;
            }, 1200);
        }

        async function exportSequenceJson() {
            if (!sourceGeometry.isSequence) return;

            const jsonText = getSequenceJsonText();

            try {
                if (await writeSequenceJsonToDirectory(currentSequenceDirectoryHandle, jsonText)) {
                    flashExportButton('Saved');
                    return;
                }

                const pickerResult = await saveSequenceJsonWithPicker(jsonText);
                if (pickerResult === true) {
                    flashExportButton('Saved');
                    return;
                }
                if (pickerResult === null) return;

                downloadSequenceJson(jsonText);
            } catch (error) {
                console.error(error);
                downloadSequenceJson(jsonText);
            }
        }

        function downloadBlob(blob, filename) {
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(objectUrl);
        }

        function canvasToPngBlob(canvas, errorMessage = 'Could not create preview PNG') {
            return new Promise((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error(errorMessage));
                    }
                }, 'image/png');
            });
        }

        function getPreviewAngleMode() {
            const mode = previewAngleSelect.value;
            return Object.values(PREVIEW_ANGLE_MODES).includes(mode)
                ? mode
                : PREVIEW_ANGLE_MODES.TOP;
        }

        function getPreviewViewBasis(mode) {
            const direction = mode === PREVIEW_ANGLE_MODES.DEFAULT_3D
                ? new THREE.Vector3(1, 0.72, 1).normalize()
                : new THREE.Vector3(0, 1, 0);
            const upHint = mode === PREVIEW_ANGLE_MODES.DEFAULT_3D
                ? new THREE.Vector3(0, 1, 0)
                : new THREE.Vector3(0, 0, -1);
            const vertical = upHint
                .clone()
                .addScaledVector(direction, -upHint.dot(direction))
                .normalize();
            const horizontal = new THREE.Vector3().crossVectors(vertical, direction).normalize();

            return {
                direction,
                up: vertical,
                horizontal,
                vertical
            };
        }

        function getBoxCorners(box) {
            return [
                new THREE.Vector3(box.min.x, box.min.y, box.min.z),
                new THREE.Vector3(box.min.x, box.min.y, box.max.z),
                new THREE.Vector3(box.min.x, box.max.y, box.min.z),
                new THREE.Vector3(box.min.x, box.max.y, box.max.z),
                new THREE.Vector3(box.max.x, box.min.y, box.min.z),
                new THREE.Vector3(box.max.x, box.min.y, box.max.z),
                new THREE.Vector3(box.max.x, box.max.y, box.min.z),
                new THREE.Vector3(box.max.x, box.max.y, box.max.z)
            ];
        }

        function getProjectedRange(points, axis) {
            let min = Infinity;
            let max = -Infinity;

            points.forEach(point => {
                const value = point.dot(axis);
                min = Math.min(min, value);
                max = Math.max(max, value);
            });

            return {
                min,
                max,
                span: Math.max(0, max - min)
            };
        }

        function getPreviewFitBox() {
            const scale = getDisplayVolumeScale();
            const halfWidth = (DISPLAY_WIDTH_CM * scale) / 2;
            const halfDepth = (DISPLAY_HEIGHT_CM * scale) / 2;
            const box = new THREE.Box3();

            if (frameMeshes.length > 0) {
                const startY = getStackStartCm() * scale;
                const height = getStackHeightCm(frameMeshes.length, getCurrentSpacingCm()) * scale;
                const endY = startY + height;
                box.min.set(-halfWidth, Math.min(startY, endY), -halfDepth);
                box.max.set(halfWidth, Math.max(startY, endY), halfDepth);
            } else {
                box.min.set(-halfWidth, 0, -halfDepth);
                box.max.set(halfWidth, TRAVEL_DISTANCE_CM * scale, halfDepth);
            }

            if (Math.abs(box.max.y - box.min.y) < 0.0001) {
                const centerY = (box.min.y + box.max.y) / 2;
                box.min.y = centerY - 0.00005;
                box.max.y = centerY + 0.00005;
            }

            return box;
        }

        function createPreviewExportCamera(mode = getPreviewAngleMode()) {
            const width = Math.max(1, renderer.domElement.width || window.innerWidth || 1);
            const height = Math.max(1, renderer.domElement.height || window.innerHeight || 1);
            const aspect = width / Math.max(1, height);
            const box = getPreviewFitBox();
            const corners = getBoxCorners(box);
            const { direction, up, horizontal, vertical } = getPreviewViewBasis(mode);
            const horizontalRange = getProjectedRange(corners, horizontal);
            const verticalRange = getProjectedRange(corners, vertical);
            const depthRange = getProjectedRange(corners, direction);
            const horizontalSpan = Math.max(0.0001, horizontalRange.span);
            const verticalSpan = Math.max(0.0001, verticalRange.span);
            const frustumHeight = Math.max(verticalSpan, horizontalSpan / Math.max(0.0001, aspect));
            const frustumWidth = frustumHeight * aspect;
            const target = new THREE.Vector3()
                .addScaledVector(horizontal, (horizontalRange.min + horizontalRange.max) / 2)
                .addScaledVector(vertical, (verticalRange.min + verticalRange.max) / 2)
                .addScaledVector(direction, (depthRange.min + depthRange.max) / 2);
            const distance = Math.max(100, depthRange.span + TRAVEL_DISTANCE_CM * getDisplayVolumeScale() + 100);
            const camera = new THREE.OrthographicCamera(
                -frustumWidth / 2,
                frustumWidth / 2,
                frustumHeight / 2,
                -frustumHeight / 2,
                0.01,
                1000
            );

            camera.position.copy(target).addScaledVector(direction, distance);
            camera.up.copy(up);
            camera.lookAt(target);
            camera.updateProjectionMatrix();
            camera.updateMatrixWorld(true);
            return camera;
        }

        async function renderDisplayVolumePreviewBlob() {
            const previousBackground = scene.background;
            const previousAutoClear = renderer.autoClear;
            const previousClearColor = renderer.getClearColor(new THREE.Color());
            const previousClearAlpha = renderer.getClearAlpha();
            const previousVolumeVisible = travelCuboid ? travelCuboid.visible : false;
            const previousStackVisible = stackGroup.visible;
            const previousScannerVisible = scannerMesh ? scannerMesh.visible : false;
            const previousFrameVisibility = frameMeshes.map(mesh => mesh.visible);
            const previewCamera = createPreviewExportCamera();

            try {
                if (travelCuboid) travelCuboid.visible = false;
                if (scannerMesh) scannerMesh.visible = false;
                stackGroup.visible = true;
                frameMeshes.forEach((mesh, index) => {
                    mesh.visible = frameIsWithinTrim(index, frameMeshes.length);
                });

                scene.background = null;
                renderer.setClearColor(0x000000, 0);
                renderer.autoClear = true;
                renderer.clear();
                renderer.render(scene, previewCamera);
                return await canvasToPngBlob(renderer.domElement);
            } finally {
                if (travelCuboid) travelCuboid.visible = previousVolumeVisible;
                if (scannerMesh) scannerMesh.visible = previousScannerVisible;
                stackGroup.visible = previousStackVisible;
                frameMeshes.forEach((mesh, index) => {
                    mesh.visible = previousFrameVisibility[index];
                });
                scene.background = previousBackground;
                renderer.setClearColor(previousClearColor, previousClearAlpha);
                renderer.autoClear = previousAutoClear;
            }
        }

        async function writePreviewImageToDirectory(directoryHandle, blob, filename = 'preview.png') {
            if (!directoryHandle || !(await verifyReadWritePermission(directoryHandle))) return false;

            const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            return true;
        }

        function setPreviewExportBusy(isBusy) {
            isExportingPreviewImage = isBusy;
            exportPreviewBtn.disabled = isBusy || isProcessing;
            exportPreviewBtn.textContent = isBusy ? 'Exporting...' : 'Preview PNG';
            exportPreviewBtn.classList.toggle('opacity-50', isBusy || isProcessing);
            exportPreviewBtn.classList.toggle('cursor-not-allowed', isBusy || isProcessing);
            updateInteractionState();
            updateBatchPreviewUi();
            if (!isBusy) requestRender();
        }

        async function exportPreviewImage() {
            if (isProcessing || isExportingPreviewImage) return;
            if (frameMeshes.length === 0) {
                alert('Load or generate a stack before exporting a preview.');
                return;
            }

            let resultLabel = '';
            setPreviewExportBusy(true);

            try {
                const blob = await renderDisplayVolumePreviewBlob();

                if (await writePreviewImageToDirectory(currentSequenceDirectoryHandle, blob, currentPreviewFilename)) {
                    resultLabel = 'Saved';
                } else {
                    downloadBlob(blob, currentPreviewFilename);
                    resultLabel = 'Downloaded';
                }
            } catch (error) {
                console.error(error);
                alert('Preview export failed.');
            } finally {
                setPreviewExportBusy(false);
                if (resultLabel) {
                    exportPreviewBtn.textContent = resultLabel;
                    setTimeout(() => {
                        if (!isExportingPreviewImage) exportPreviewBtn.textContent = 'Preview PNG';
                    }, 1200);
                }
            }
        }

