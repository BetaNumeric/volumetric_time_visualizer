        // --- Configuration & State ---
        let scene, renderer, controls;
        let activeCamera, perspCamera, orthoCamera; // Cameras
        let stackGroup = new THREE.Group();
        let scannerMesh; // Smooth scanner mesh
        let travelCuboid = null;
        let frameMeshes = [];
        let exposureRenderTarget = null;
        let exposureScene = null;
        let exposureMesh = null;
        let exposureMaterial = null;
        let exposureDisplayScene = null;
        let exposureDisplayCamera = null;
        let exposureDisplayMesh = null;
        let exposureDisplayMaterial = null;
        let exposureDirty = true;
        let exposurePreviewVisible = false;
        let isProcessing = false;
        let isBakingExposure = false;
        let resizeAfterBake = false;
        let animationFrameId = null;
        let pendingFrameCount = 0;
        let loadedSamplingSignature = '';
        let graphicsContextLost = false;
        let viewportTrail;
        let cancelProcessingRequested = false;
        let isExportingPreviewImage = false;
        const ORTHO_VIEW_MODES = {
            FREE: 'free',
            TOP: 'top'
        };
        const PREVIEW_ANGLE_MODES = {
            TOP: 'top',
            DEFAULT_3D: 'default3d'
        };
        let orthoViewMode = ORTHO_VIEW_MODES.FREE;
        let currentSourceType = null;
        let currentSourceDuration = 0;
        let currentSourceSignature = '';
        let currentPreviewFilename = 'preview.png';
        let currentSequenceFiles = [];
        let currentVideoFile = null;
        let currentMetadataFile = null;
        let currentSourceMetadata = {};
        let currentSequenceFps = 30;
        let currentSequenceDirectoryHandle = null;
        let batchPreviewQueue = [];
        let isBatchPreviewRunning = false;
        let batchPreviewCancelRequested = false;
        let batchPreviewResults = [];

        const DISPLAY_WIDTH_CM = 53.6;
        const DISPLAY_HEIGHT_CM = 30.15;
        const DISPLAY_ASPECT_RATIO = DISPLAY_WIDTH_CM / DISPLAY_HEIGHT_CM;
        const TRAVEL_DISTANCE_CM = 48.0;

        let lastManualSpacingCm = 0.1;
        const sourceGeometry = {
            isSequence: false,
            alignment: 'bottom',
            startCm: 0,
            volumeHeightCm: TRAVEL_DISTANCE_CM,
            spacingCm: 0.1
        };
        
        // Tracking for Light Painting
        const lastCameraPos = new THREE.Vector3();
        const lastCameraQuat = new THREE.Quaternion();
        const controlStartCameraPos = new THREE.Vector3();
        const controlStartCameraQuat = new THREE.Quaternion();
        let controlStartCameraZoom = 1;
        const backgroundColor = new THREE.Color(0x050505);

        // Generation Parameters Storage (for visibility calculations)
        const stackGenParams = {
            start: 0,
            duration: 0
        };

        // Playback State
        const playback = {
            isPlaying: false,
            mode: 'static', 
            currentIndex: 0,
            direction: 1,
            speed: 1.0,
            lastTime: 0,
            loop: true
        };

        // Settings
        const ORTHO_VIEW_SIZE = 60; 
        let targetFrameCount = 200;
        
        // DOM Elements
        const fileInput = document.getElementById('videoInput');
        const statusContainer = document.getElementById('statusContainer');
        const statusText = document.getElementById('statusText');
        const progressText = document.getElementById('progressText');
        const progressBar = document.getElementById('progressBar');
        const cancelProcessingBtn = document.getElementById('cancelProcessingBtn');
        const panelContent = document.getElementById('panel-content');
        const exportPreviewBtn = document.getElementById('exportPreviewBtn');
        const regenerateBtn = document.getElementById('regenerateBtn');
        const previewAngleSelect = document.getElementById('previewAngle');
        const batchPreviewCount = document.getElementById('batchPreviewCount');
        const batchPreviewStatus = document.getElementById('batchPreviewStatus');
        const batchAddFolderBtn = document.getElementById('batchAddFolderBtn');
        const batchAddParentBtn = document.getElementById('batchAddParentBtn');
        const batchClearBtn = document.getElementById('batchClearBtn');
        const batchRunBtn = document.getElementById('batchRunBtn');
        const orthoToggle = document.getElementById('orthoToggle');
        const orthoViewButtons = document.getElementById('orthoViewButtons');
        const topDownViewBtn = document.getElementById('topDownViewBtn');
        const folderImportBtn = document.getElementById('folderImportBtn');
        const fitSpacingBtn = document.getElementById('fitSpacingBtn');
        const boxToggle = document.getElementById('boxToggle');

        // Playback DOM
        const playPauseBtn = document.getElementById('playPauseBtn');
        const resetAnimBtn = document.getElementById('resetAnimBtn');
        const playbackModeSel = document.getElementById('playbackMode');
        const animationControls = document.getElementById('animationControls');
        const speedInput = document.getElementById('speed');
        const speedVal = document.getElementById('speedVal');
        const timelineInput = document.getElementById('timeline');
        const loopToggle = document.getElementById('loopToggle');
        
        // Geometry / Source DOM
        const fpsSelect = document.getElementById('fpsSelect');
        const resolutionSelect = document.getElementById('resolutionSelect');
        
        // Trim DOM
        const trimStartInput = document.getElementById('trimStart');
        const trimEndInput = document.getElementById('trimEnd');
        const trimValues = document.getElementById('trimValues');
        const trimRangeControl = document.getElementById('trimRangeControl');
        const trimRangeFill = document.getElementById('trimRangeFill');
        const trimStartHandle = document.getElementById('trimStartHandle');
        const trimEndHandle = document.getElementById('trimEndHandle');
        
        // Conditional UI
        const scanOptions = document.getElementById('scanOptions');
        const exposureOptions = document.getElementById('exposureOptions');
        const exposureStatus = document.getElementById('exposureStatus');
        const bakeExposureBtn = document.getElementById('bakeExposureBtn');
        const smoothToggle = document.getElementById('smoothMotionToggle');
        const lightPaintToggle = document.getElementById('lightPaintToggle');
        const clearPaintBtn = document.getElementById('clearPaintBtn');

        // Panel Toggle Logic
        const mainPanel = document.getElementById('mainPanel');
        const openBtn = document.getElementById('openSettingsBtn');
        const closeBtn = document.getElementById('closePanelBtn');

        function togglePanel(show) {
            mainPanel.inert = !show;
            openBtn.inert = show;
            if (show) {
                mainPanel.classList.remove('opacity-0', 'pointer-events-none', 'scale-90');
                mainPanel.classList.add('opacity-100', 'scale-100');
                openBtn.classList.add('opacity-0', 'pointer-events-none', 'scale-90');
                openBtn.classList.remove('opacity-100', 'scale-100');
            } else {
                mainPanel.classList.add('opacity-0', 'pointer-events-none', 'scale-90');
                mainPanel.classList.remove('opacity-100', 'scale-100');
                openBtn.classList.remove('opacity-0', 'pointer-events-none', 'scale-90');
                openBtn.classList.add('opacity-100', 'scale-100');
            }
        }

        function updateOrthoViewButtonVisibility() {
            orthoViewButtons.classList.toggle('hidden', !orthoToggle.checked);
        }

        function setBatchPreviewButtonState(button, disabled) {
            button.disabled = disabled;
            button.classList.toggle('opacity-50', disabled);
            button.classList.toggle('cursor-not-allowed', disabled);
        }

        function updateBatchPreviewUi(message = '') {
            const supportsDirectoryPicker = 'showDirectoryPicker' in window;
            const count = batchPreviewQueue.length;
            const folderLabel = count === 1 ? 'folder' : 'folders';
            const busy = isProcessing || isExportingPreviewImage;
            const queueLocked = isBatchPreviewRunning || busy;

            batchPreviewCount.textContent = `${count} ${folderLabel}`;
            batchPreviewStatus.textContent = message || (supportsDirectoryPicker
                ? (count > 0 ? `${count} ${folderLabel} queued.` : 'Add source folders to batch export previews.')
                : 'Batch folders require a browser with directory access.');

            setBatchPreviewButtonState(batchAddFolderBtn, !supportsDirectoryPicker || queueLocked);
            setBatchPreviewButtonState(batchAddParentBtn, !supportsDirectoryPicker || queueLocked);
            setBatchPreviewButtonState(batchClearBtn, queueLocked || count === 0);

            batchRunBtn.disabled = !supportsDirectoryPicker || (!isBatchPreviewRunning && (busy || count === 0));
            batchRunBtn.textContent = isBatchPreviewRunning
                ? (batchPreviewCancelRequested ? 'Stopping...' : 'Stop Batch')
                : (count > 0 ? `Run Batch (${count})` : 'Run Batch');
            batchRunBtn.className = isBatchPreviewRunning
                ? 'w-full py-1.5 bg-amber-600 hover:bg-amber-500 rounded text-xs text-white border border-amber-500 transition-colors font-bold'
                : batchRunBtn.disabled
                    ? 'w-full py-1.5 bg-gray-900/70 rounded text-xs text-gray-500 border border-gray-700 transition-colors font-bold opacity-50 cursor-not-allowed'
                    : 'w-full py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white border border-blue-500 transition-colors font-bold';
        }

        function updateTrimLabel() {
            trimValues.textContent = `${parseFloat(trimStartInput.value).toFixed(1)}s - ${parseFloat(trimEndInput.value).toFixed(1)}s`;
            updateTrimRangeFill();
        }

        function updateTrimRangeFill() {
            const min = parseFloat(trimStartInput.min) || 0;
            const max = parseFloat(trimStartInput.max) || 1;
            const range = Math.max(0.000001, max - min);
            const start = clamp01((parseFloat(trimStartInput.value) - min) / range);
            const end = clamp01((parseFloat(trimEndInput.value) - min) / range);

            trimRangeFill.style.left = `${start * 100}%`;
            trimRangeFill.style.right = `${(1 - end) * 100}%`;
            trimStartHandle.style.left = `${start * 100}%`;
            trimEndHandle.style.left = `${end * 100}%`;
        }

        function getTrimValueFromPointer(clientX) {
            const rect = trimRangeControl.getBoundingClientRect();
            const pct = clamp01((clientX - rect.left) / Math.max(1, rect.width));
            const min = parseFloat(trimStartInput.min) || 0;
            const max = parseFloat(trimStartInput.max) || 1;
            return min + (pct * (max - min));
        }

        function setTrimEndpoint(endpoint, rawValue) {
            const min = parseFloat(trimStartInput.min) || 0;
            const max = parseFloat(trimStartInput.max) || 1;
            const minGap = Math.min(0.1, Math.max(0, max - min));
            const start = parseFloat(trimStartInput.value);
            const end = parseFloat(trimEndInput.value);

            if (endpoint === 'start') {
                trimStartInput.value = clamp(rawValue, min, Math.max(min, end - minGap));
                trimStartInput.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                trimEndInput.value = clamp(rawValue, Math.min(max, start + minGap), max);
                trimEndInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }

        function clampNumericInput(input, fallbackValue) {
            const parsed = parseFloat(input.value);
            const fallback = Number.isFinite(fallbackValue) ? fallbackValue : 0;
            const min = input.min === '' ? -Infinity : parseFloat(input.min);
            const max = input.max === '' ? Infinity : parseFloat(input.max);
            return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
        }

        function bindNumberInputToRange(numberInput, rangeInput) {
            numberInput.addEventListener('change', () => {
                const value = clampNumericInput(numberInput, parseFloat(rangeInput.value));
                rangeInput.value = value;
                numberInput.value = value;
                rangeInput.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }

        closeBtn.addEventListener('click', () => togglePanel(false));
        openBtn.addEventListener('click', () => togglePanel(true));

        // Sliders & Inputs
        const inputs = {
            count: document.getElementById('frameCount'),
            opacity: document.getElementById('opacity'),
            spacing: document.getElementById('spacing'),
            scale: document.getElementById('scale'),
            blendMode: document.getElementById('blendMode'),
            threshold: document.getElementById('threshold'),
            brightThreshold: document.getElementById('brightThreshold'),
            exposureSamples: document.getElementById('exposureSamples')
        };
        
        const displays = {
            count: document.getElementById('frameCountVal'),
            opacity: document.getElementById('opacityVal'),
            spacing: document.getElementById('spacingVal'),
            scale: document.getElementById('scaleVal'),
            threshold: document.getElementById('thresholdVal'),
            brightThreshold: document.getElementById('brightThresholdVal'),
            exposureSamples: document.getElementById('exposureSamplesVal')
        };

        const sequenceGeometryTools = document.getElementById('sequenceGeometryTools');
        const sequenceBoundsVal = document.getElementById('sequenceBoundsVal');
        const sequenceAlignSelect = document.getElementById('sequenceAlign');
        const exportSequenceJsonBtn = document.getElementById('exportSequenceJsonBtn');
        const sequenceStartControl = document.getElementById('sequenceStartControl');
        const sequenceStartInput = document.getElementById('sequenceStart');
        const sequenceStartVal = document.getElementById('sequenceStartVal');

        // --- Initialization ---
        function init() {
            const container = document.getElementById('canvas-container');
            const aspect = window.innerWidth / window.innerHeight;

            // Scene
            scene = new THREE.Scene();
            scene.background = backgroundColor;
            
            // Cameras
            perspCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
            perspCamera.position.set(40, 30, 40);

            orthoCamera = new THREE.OrthographicCamera(
                -ORTHO_VIEW_SIZE * aspect / 2, ORTHO_VIEW_SIZE * aspect / 2,
                ORTHO_VIEW_SIZE / 2, -ORTHO_VIEW_SIZE / 2,
                -500, 1000
            );
            orthoCamera.position.set(40, 30, 40); 
            orthoCamera.zoom = 0.5; 

            activeCamera = perspCamera;

            // Viewport trails live in a render target, so the default buffer can be discarded.
            renderer = new THREE.WebGLRenderer({ 
                antialias: true, 
                alpha: true, 
                preserveDrawingBuffer: false 
            });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.setClearColor(backgroundColor);
            renderer.autoClear = true; 
            container.appendChild(renderer.domElement);
            viewportTrail = new ViewportTrail(renderer);
            renderer.domElement.addEventListener('webglcontextlost', event => {
                event.preventDefault();
                graphicsContextLost = true;
                requestProcessingCancel();
                statusContainer.classList.remove('hidden');
                statusText.textContent = 'Graphics context lost. Waiting for recovery.';
            });
            renderer.domElement.addEventListener('webglcontextrestored', () => {
                graphicsContextLost = false;
                viewportTrail.dispose();
                disposeExposure();
                statusText.textContent = 'Graphics recovered. Re-bake exposure if needed.';
                requestRender();
            });

            // Controls
            controls = new THREE.OrbitControls(activeCamera, renderer.domElement);
            controls.enableDamping = false;
            controls.dampingFactor = 0.00;
            controls.autoRotate = true;
            controls.autoRotateSpeed = 1.0;
            controls.addEventListener('change', () => {
                viewportTrail.invalidate();
                if (exposurePreviewVisible) markExposureDirty('VIEW CHANGED');
                requestRender();
            });
            
            // Initial tracker
            lastCameraPos.copy(activeCamera.position);
            lastCameraQuat.copy(activeCamera.quaternion);

            scene.add(stackGroup);
            createTravelCuboid();
            centerCameraOnDisplayVolume();

            // Event Listeners
            window.addEventListener('resize', onWindowResize);
            document.addEventListener('visibilitychange', () => {
                playback.lastTime = 0;
                if (!document.hidden) requestRender();
            });
            mainPanel.addEventListener('input', requestRender);
            mainPanel.addEventListener('change', requestRender);
            mainPanel.addEventListener('click', requestRender);
            resolutionSelect.addEventListener('change', updateMemoryEstimate);
            inputs.count.addEventListener('input', updateMemoryEstimate);
            smoothToggle.addEventListener('change', () => {
                updateVisibility();
                requestRender();
            });
            fileInput.addEventListener('change', handleFileSelect);
            folderImportBtn.addEventListener('click', () => {
                importSequenceFolder();
            });
            if (!('showDirectoryPicker' in window)) {
                folderImportBtn.classList.add('hidden');
            }
            batchAddFolderBtn.addEventListener('click', () => {
                addBatchPreviewFolderFromPicker();
            });
            batchAddParentBtn.addEventListener('click', () => {
                addBatchPreviewParentFromPicker();
            });
            batchClearBtn.addEventListener('click', () => {
                if (isBatchPreviewRunning) return;
                batchPreviewQueue = [];
                updateBatchPreviewUi('Batch queue cleared.');
            });
            batchRunBtn.addEventListener('click', () => {
                if (isBatchPreviewRunning) {
                    requestBatchPreviewCancel();
                } else {
                    runBatchPreviewQueue();
                }
            });
            cancelProcessingBtn.addEventListener('click', () => {
                requestProcessingCancel();
            });
            exportPreviewBtn.addEventListener('click', () => {
                exportPreviewImage();
            });
            topDownViewBtn.addEventListener('click', () => {
                setTopDownOrthographicView();
            });
            
            // Trim Logic
            const beginTrimDrag = (endpoint, event) => {
                event.preventDefault();
                const pointerId = event.pointerId;
                let isDragging = true;
                trimRangeControl.setPointerCapture(pointerId);
                setTrimEndpoint(endpoint, getTrimValueFromPointer(event.clientX));

                const onMove = (moveEvent) => {
                    if (moveEvent.pointerId !== pointerId) return;
                    setTrimEndpoint(endpoint, getTrimValueFromPointer(moveEvent.clientX));
                };
                const onEnd = () => {
                    if (!isDragging) return;
                    isDragging = false;
                    trimRangeControl.removeEventListener('pointermove', onMove);
                    trimRangeControl.removeEventListener('pointerup', onEnd);
                    trimRangeControl.removeEventListener('pointercancel', onEnd);
                    trimRangeControl.removeEventListener('lostpointercapture', onEnd);
                    if (trimRangeControl.hasPointerCapture(pointerId)) {
                        trimRangeControl.releasePointerCapture(pointerId);
                    }
                };

                trimRangeControl.addEventListener('pointermove', onMove);
                trimRangeControl.addEventListener('pointerup', onEnd);
                trimRangeControl.addEventListener('pointercancel', onEnd);
                trimRangeControl.addEventListener('lostpointercapture', onEnd);
            };

            trimStartHandle.addEventListener('pointerdown', (event) => beginTrimDrag('start', event));
            trimEndHandle.addEventListener('pointerdown', (event) => beginTrimDrag('end', event));
            trimRangeControl.addEventListener('pointerdown', (event) => {
                if (event.target === trimStartHandle || event.target === trimEndHandle) return;
                const value = getTrimValueFromPointer(event.clientX);
                const startDistance = Math.abs(value - parseFloat(trimStartInput.value));
                const endDistance = Math.abs(value - parseFloat(trimEndInput.value));
                beginTrimDrag(startDistance <= endDistance ? 'start' : 'end', event);
            });
            [trimStartHandle, trimEndHandle].forEach((handle) => {
                handle.addEventListener('keydown', (event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();

                    const endpoint = handle === trimStartHandle ? 'start' : 'end';
                    const min = parseFloat(trimStartInput.min) || 0;
                    const max = parseFloat(trimStartInput.max) || 1;
                    const step = Math.max(0.01, (max - min) / 100);
                    const current = parseFloat(endpoint === 'start' ? trimStartInput.value : trimEndInput.value);

                    if (event.key === 'Home') {
                        setTrimEndpoint(endpoint, min);
                    } else if (event.key === 'End') {
                        setTrimEndpoint(endpoint, max);
                    } else {
                        setTrimEndpoint(endpoint, current + (event.key === 'ArrowRight' ? step : -step));
                    }
                });
            });

            trimStartInput.addEventListener('input', () => {
                if (parseFloat(trimStartInput.value) >= parseFloat(trimEndInput.value)) {
                    trimStartInput.value = parseFloat(trimEndInput.value) - 0.1;
                }
                updateTrimLabel();
                updateFrameSliderLimits(); 
                updateVisibility(); // Live Preview
                markExposureDirty('TRIM CHANGED');
            });
            
            trimEndInput.addEventListener('input', () => {
                if (parseFloat(trimEndInput.value) <= parseFloat(trimStartInput.value)) {
                    trimEndInput.value = parseFloat(trimStartInput.value) + 0.1;
                }
                updateTrimLabel();
                updateFrameSliderLimits();
                updateVisibility(); // Live Preview
                markExposureDirty('TRIM CHANGED');
            });

            controls.addEventListener('end', () => {
                if (activeCamera === orthoCamera && orthoViewMode === ORTHO_VIEW_MODES.TOP) {
                    const cameraMoved = activeCamera.position.distanceTo(controlStartCameraPos) > 0.001
                        || activeCamera.quaternion.angleTo(controlStartCameraQuat) > 0.001
                        || Math.abs(activeCamera.zoom - controlStartCameraZoom) > 0.001;

                    if (cameraMoved) {
                        orthoViewMode = ORTHO_VIEW_MODES.FREE;
                    }
                }
                markExposureDirty('VIEW CHANGED');
            });

            controls.addEventListener('start', () => {
                controlStartCameraPos.copy(activeCamera.position);
                controlStartCameraQuat.copy(activeCamera.quaternion);
                controlStartCameraZoom = activeCamera.zoom || 1;

                if (exposurePreviewVisible) {
                    markExposureDirty('VIEW CHANGED');
                }
            });

            // Playback Controls
            function updateModeOptionsVisibility() {
                if (playback.mode === 'static') {
                    animationControls.classList.add('hidden');
                } else {
                    animationControls.classList.remove('hidden');
                }

                if (playback.mode === 'scan') {
                    scanOptions.classList.remove('hidden');
                    scanOptions.classList.add('flex');
                } else {
                    scanOptions.classList.add('hidden');
                    scanOptions.classList.remove('flex');
                }

                if (playback.mode === 'static') {
                    exposureOptions.classList.remove('hidden');
                    exposureOptions.classList.add('flex');
                } else {
                    exposureOptions.classList.add('hidden');
                    exposureOptions.classList.remove('flex');
                }
            }

            playbackModeSel.addEventListener('change', (e) => {
                playback.mode = e.target.value;
                updateModeOptionsVisibility();

                if(playback.mode === 'static') {
                    playback.isPlaying = false;
                    playPauseBtn.textContent = 'Play';
                    updateVisibility(); 
                } else {
                    markExposureDirty('NEEDS BAKE');
                    if (!playback.isPlaying) {
                       playback.isPlaying = true; 
                       playPauseBtn.textContent = 'Pause';
                    }
                }
            });

            playPauseBtn.addEventListener('click', () => {
                playback.isPlaying = !playback.isPlaying;
                playPauseBtn.textContent = playback.isPlaying ? 'Pause' : 'Play';
                if(playback.mode === 'static' && playback.isPlaying) {
                    markExposureDirty('NEEDS BAKE');
                    playback.mode = 'scan';
                    playbackModeSel.value = 'scan';
                    updateModeOptionsVisibility();
                }
            });

            resetAnimBtn.addEventListener('click', () => {
                playback.currentIndex = 0;
                playback.direction = 1;
                timelineInput.value = 0;
                viewportTrail.invalidate();
                renderer.clear();
                updateVisibility();
            });
            
            clearPaintBtn.addEventListener('click', () => {
                viewportTrail.invalidate();
                renderer.clear();
            });

            bakeExposureBtn.addEventListener('click', () => {
                bakeExposure();
            });

            speedInput.addEventListener('input', (e) => {
                playback.speed = parseFloat(e.target.value);
                speedVal.value = playback.speed.toFixed(1);
            });
            
            timelineInput.addEventListener('input', (e) => {
                const pct = parseFloat(e.target.value);
                if (stackGroup.children.length > 0) {
                     const totalFrames = stackGroup.children.length;
                     playback.currentIndex = (pct / 100) * (totalFrames - 1);
                     updateVisibility();
                }
            });

            loopToggle.addEventListener('change', (e) => {
                playback.loop = e.target.checked;
            });
            
            lightPaintToggle.addEventListener('change', (e) => {
                 if(e.target.checked) {
                     viewportTrail.invalidate();
                     renderer.clear();
                 } else {
                     renderer.autoClear = true;
                     scene.background = backgroundColor;
                 }
            });
            
            fpsSelect.addEventListener('change', () => {
                if (currentSourceType === 'sequence') {
                    refreshSequenceTimingFromFps();
                }
                updateFrameSliderLimits();
                updateVisibility();
                markExposureDirty('TIMING CHANGED');
            });

            orthoToggle.addEventListener('change', (e) => {
                const useOrtho = e.target.checked;
                const prevCamera = activeCamera;
                orthoViewMode = ORTHO_VIEW_MODES.FREE;
                
                if (useOrtho) {
                    activeCamera = orthoCamera;
                    activeCamera.position.copy(prevCamera.position);
                    activeCamera.up.set(0, 1, 0);
                    activeCamera.lookAt(controls.target);
                } else {
                    activeCamera = perspCamera;
                    activeCamera.position.copy(prevCamera.position);
                    activeCamera.up.set(0, 1, 0);
                    activeCamera.lookAt(controls.target);
                }

                controls.object = activeCamera;
                controls.update(); 
                updateOrthoViewButtonVisibility();
                onWindowResize(); 
                renderer.clear(); 
                markExposureDirty('VIEW CHANGED');
            });

            const updateUniforms = (key, value) => {
                stackGroup.children.forEach(mesh => {
                    if(mesh.material && mesh.material.uniforms) {
                        mesh.material.uniforms[key].value = value;
                    }
                });
                if (scannerMesh && scannerMesh.material && scannerMesh.material.uniforms) {
                    scannerMesh.material.uniforms[key].value = value;
                }
            };

            // Setup Slider Listeners
            inputs.opacity.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                displays.opacity.value = val;
                updateUniforms('globalOpacity', val);
                markExposureDirty('SETTINGS CHANGED');
            });

            inputs.threshold.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                displays.threshold.value = val;
                updateUniforms('threshold', val);
                markExposureDirty('SETTINGS CHANGED');
            });

            inputs.brightThreshold.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                displays.brightThreshold.value = val;
                updateUniforms('brightThreshold', val);
                markExposureDirty('SETTINGS CHANGED');
            });

            inputs.spacing.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                applySpacingFromControl(val);
            });

            fitSpacingBtn.addEventListener('click', () => {
                fitSpacingToBox();
            });

            inputs.scale.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                displays.scale.value = val;
                stackGroup.scale.setScalar(val);
                if(scannerMesh) scannerMesh.scale.setScalar(val);
                updateTravelCuboidScale();
                if (activeCamera === orthoCamera && orthoViewMode === ORTHO_VIEW_MODES.TOP) {
                    applyTopDownOrthographicView();
                } else {
                    updateControlsTargetForStack();
                }
                updateVisibility();
                markExposureDirty('GEOMETRY CHANGED');
            });

            boxToggle.addEventListener('change', () => {
                updateTravelCuboidVisibility();
            });

            sequenceAlignSelect.addEventListener('change', (e) => {
                sourceGeometry.alignment = e.target.value;
                applyAlignmentToGeometry();
                updateSpacing(sourceGeometry.spacingCm);
                updateVisibility();
                updateSequenceGeometryDisplay();
                markExposureDirty('GEOMETRY CHANGED');
            });

            sequenceStartInput.addEventListener('input', (e) => {
                sourceGeometry.alignment = 'custom';
                sourceGeometry.startCm = parseFloat(e.target.value);
                applyAlignmentToGeometry();
                updateSpacing(sourceGeometry.spacingCm);
                updateVisibility();
                updateSequenceGeometryDisplay();
                markExposureDirty('GEOMETRY CHANGED');
            });

            exportSequenceJsonBtn.addEventListener('click', async () => {
                await exportSequenceJson();
            });

            inputs.count.addEventListener('input', (e) => {
                displays.count.value = e.target.value;
            });

            inputs.exposureSamples.addEventListener('input', (e) => {
                displays.exposureSamples.value = e.target.value;
                markExposureDirty('SETTINGS CHANGED');
            });

            inputs.blendMode.addEventListener('change', (e) => {
                const modeName = e.target.value;
                const blend = THREE[modeName];
                
                stackGroup.children.forEach(mesh => {
                    if(mesh.material) {
                        mesh.material.blending = blend;
                        mesh.material.needsUpdate = true;
                    }
                });
                
                if (scannerMesh && scannerMesh.material) {
                    scannerMesh.material.blending = blend;
                    scannerMesh.material.needsUpdate = true;
                }
                markExposureDirty('SETTINGS CHANGED');
            });
            
            regenerateBtn.addEventListener('click', async () => {
                if (isProcessing || isExportingPreviewImage || isBatchPreviewRunning) return;
                if (currentSourceType === 'sequence') {
                    await processImageSequenceSource(currentSequenceFiles, currentMetadataFile);
                } else if (currentVideoFile) {
                    await processVideoSource(currentVideoFile, { metadataFile: currentMetadataFile });
                }
            });

            bindNumberInputToRange(speedVal, speedInput);
            bindNumberInputToRange(displays.count, inputs.count);
            bindNumberInputToRange(displays.spacing, inputs.spacing);
            bindNumberInputToRange(displays.scale, inputs.scale);
            bindNumberInputToRange(displays.opacity, inputs.opacity);
            bindNumberInputToRange(displays.threshold, inputs.threshold);
            bindNumberInputToRange(displays.brightThreshold, inputs.brightThreshold);
            bindNumberInputToRange(displays.exposureSamples, inputs.exposureSamples);
            bindNumberInputToRange(sequenceStartVal, sequenceStartInput);

            updateOrthoViewButtonVisibility();
            updateBatchPreviewUi();
            updateModeOptionsVisibility();
            lastManualSpacingCm = parseFloat(inputs.spacing.value);
            applyManualGeometry();
            updateMemoryEstimate();
            const controlNames = { count: 'Frames', opacity: 'Opacity', spacing: 'Spacing (cm)',
                scale: 'Scale', blendMode: 'Blending', threshold: 'Dark cutoff',
                brightThreshold: 'Bright cutoff', exposureSamples: 'Samples per frame' };
            Object.entries(controlNames).forEach(([key, label]) => {
                inputs[key].setAttribute('aria-label', label);
                if (displays[key]) displays[key].setAttribute('aria-label', label);
            });
            const otherNames = { fpsSelect: 'Source FPS', resolutionSelect: 'Maximum resolution',
                playbackMode: 'Playback mode', timeline: 'Timeline', speed: 'Playback speed',
                speedVal: 'Playback speed', sequenceAlign: 'Alignment', sequenceStart: 'Start (cm)',
                sequenceStartVal: 'Start (cm)', previewAngle: 'Preview angle' };
            Object.entries(otherNames).forEach(([id, label]) => {
                document.getElementById(id).setAttribute('aria-label', label);
            });
            openBtn.inert = true;
            initializeWorkflow();
            requestRender();
        }

        // --- Accumulated Exposure ---

        function setExposureStatus(message, isReady = false) {
            exposureStatus.textContent = message;
            exposureStatus.className = `text-[10px] font-mono ${isReady ? 'text-green-400' : 'text-gray-500'}`;
        }

        function markExposureDirty(message = 'NEEDS BAKE') {
            exposureDirty = true;
            exposurePreviewVisible = false;
            viewportTrail?.invalidate();
            setExposureStatus(message, false);
            requestRender();
        }

        function getExposureTargetSize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const maxSide = 1000;
            let width = Math.max(1, Math.floor(window.innerWidth * dpr));
            let height = Math.max(1, Math.floor(window.innerHeight * dpr));
            const scale = Math.min(1, maxSide / Math.max(width, height));

            return {
                width: Math.max(1, Math.floor(width * scale)),
                height: Math.max(1, Math.floor(height * scale))
            };
        }

        function ensureExposureResources() {
            const targetSize = getExposureTargetSize();
            const supportsHalfFloat = renderer.capabilities.isWebGL2
                ? renderer.extensions.has('EXT_color_buffer_float')
                : renderer.extensions.has('OES_texture_half_float')
                    && renderer.extensions.has('EXT_color_buffer_half_float');
            if (!supportsHalfFloat) {
                throw new Error('Exposure baking requires floating-point rendering support on this device.');
            }
            const filter = renderer.capabilities.isWebGL2 || renderer.extensions.has('OES_texture_half_float_linear')
                ? THREE.LinearFilter : THREE.NearestFilter;

            if (
                !exposureRenderTarget ||
                exposureRenderTarget.width !== targetSize.width ||
                exposureRenderTarget.height !== targetSize.height
            ) {
                if (exposureRenderTarget) {
                    exposureRenderTarget.dispose();
                }

                exposureRenderTarget = new THREE.WebGLRenderTarget(targetSize.width, targetSize.height, {
                    minFilter: filter,
                    magFilter: filter,
                    format: THREE.RGBAFormat,
                    type: THREE.HalfFloatType,
                    depthBuffer: false,
                    stencilBuffer: false
                });
                exposureRenderTarget.texture.name = 'Accumulated Exposure';
            }

            if (!exposureScene) {
                exposureScene = new THREE.Scene();
            }

            if (!exposureMaterial) {
                exposureMaterial = new THREE.ShaderMaterial({
                    uniforms: {
                        map: { value: null },
                        globalOpacity: { value: 1 },
                        threshold: { value: 0 },
                        brightThreshold: { value: 1 },
                        linearLight: { value: 0 }
                    },
                    vertexShader: vertexShader,
                    fragmentShader: exposureFragmentShader,
                    transparent: true,
                    side: THREE.DoubleSide,
                    depthTest: false,
                    depthWrite: false
                });
                exposureMaterial.blending = THREE.AdditiveBlending;
            }

            if (!exposureMesh) {
                exposureMesh = new THREE.Mesh(frameMeshes[0].geometry, exposureMaterial);
                exposureMesh.rotation.x = -Math.PI / 2;
                exposureScene.add(exposureMesh);
            } else {
                exposureMesh.geometry = frameMeshes[0].geometry;
            }

            if (!exposureDisplayScene) {
                exposureDisplayScene = new THREE.Scene();
                exposureDisplayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
                exposureDisplayCamera.position.z = 1;
            }

            if (!exposureDisplayMaterial) {
                exposureDisplayMaterial = new THREE.ShaderMaterial({
                    uniforms: {
                        map: { value: exposureRenderTarget.texture },
                        linearOutput: { value: 0 }
                    },
                    vertexShader: vertexShader,
                    fragmentShader: exposureDisplayFragmentShader,
                    depthTest: false,
                    depthWrite: false
                });
            }

            if (!exposureDisplayMesh) {
                exposureDisplayMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), exposureDisplayMaterial);
                exposureDisplayScene.add(exposureDisplayMesh);
            }

            exposureDisplayMaterial.uniforms.map.value = exposureRenderTarget.texture;
        }

        function disposeExposure() {
            if (exposureRenderTarget) {
                exposureRenderTarget.dispose();
                exposureRenderTarget = null;
            }

            if (exposureMesh) {
                if (exposureScene) {
                    exposureScene.remove(exposureMesh);
                }
                exposureMesh = null;
            }

            if (exposureMaterial) {
                exposureMaterial.dispose();
                exposureMaterial = null;
            }

            if (exposureDisplayMesh) {
                if (exposureDisplayScene) {
                    exposureDisplayScene.remove(exposureDisplayMesh);
                }
                exposureDisplayMesh.geometry.dispose();
                exposureDisplayMesh = null;
            }

            if (exposureDisplayMaterial) {
                exposureDisplayMaterial.dispose();
                exposureDisplayMaterial = null;
            }

            exposureScene = null;
            exposureDisplayScene = null;
            exposureDisplayCamera = null;
            exposureDirty = true;
            exposurePreviewVisible = false;
            viewportTrail?.invalidate();
            setExposureStatus('NEEDS BAKE', false);
        }

        function getSliceTime(index, total) {
            const sourceTime = frameMeshes[index]?.userData.sourceTime;
            if (Number.isFinite(sourceTime)) return sourceTime;
            if (total <= 1) return stackGenParams.start;
            return stackGenParams.start + (index / (total - 1)) * stackGenParams.duration;
        }

        function frameIsWithinTrim(index, total) {
            const uiStart = parseFloat(trimStartInput.value);
            const uiEnd = parseFloat(trimEndInput.value);
            const sliceTime = getSliceTime(index, total);
            return sliceTime >= uiStart - 0.01 && sliceTime <= uiEnd + 0.01;
        }

        function getFrameTexture(mesh) {
            return mesh && mesh.material && mesh.material.uniforms && mesh.material.uniforms.map
                ? mesh.material.uniforms.map.value
                : null;
        }

        async function bakeExposure() {
            if (isProcessing || isExportingPreviewImage || isBatchPreviewRunning) return false;
            if (frameMeshes.length === 0) {
                setExposureStatus('NO FRAMES', false);
                return false;
            }
            const previousTarget = renderer.getRenderTarget();
            const previousAutoClear = renderer.autoClear;
            const previousClearColor = renderer.getClearColor(new THREE.Color());
            const previousClearAlpha = renderer.getClearAlpha();
            let completed = false;
            let renderedSamples = 0;
            isBakingExposure = true;
            beginProcessing('BAKING EXPOSURE...');
            markExposureDirty('BAKING...');
            try {
                ensureExposureResources();
                const spacing = getCurrentSpacingCm();
                const scale = parseFloat(inputs.scale.value);
                const startOffset = getStackStartCm();
                const opacity = parseFloat(inputs.opacity.value);
                const samplesPerFrame = parseInt(inputs.exposureSamples.value);
                const sampleCount = frameMeshes.length === 1 ? 1 : frameMeshes.length * samplesPerFrame;
                const linear = document.getElementById('exposureModel').value === 'linear';
                const durationOverride = Number(document.getElementById('exposureDuration').value);
                const sweepDuration = durationOverride > 0 ? durationOverride : stackGenParams.duration;
                const energyWeight = linear ? sweepDuration / frameMeshes.length : 1;
                exposureMaterial.uniforms.linearLight.value = linear ? 1 : 0;
                exposureDisplayMaterial.uniforms.linearOutput.value = linear ? 1 : 0;
                const bakeCamera = activeCamera.clone();
                exposureMaterial.uniforms.threshold.value = parseFloat(inputs.threshold.value);
                exposureMaterial.uniforms.brightThreshold.value = parseFloat(inputs.brightThreshold.value);
                exposureMesh.scale.setScalar(scale);
                renderer.setRenderTarget(exposureRenderTarget);
                const gl = renderer.getContext();
                if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                    throw new Error('This device cannot create an exposure render target.');
                }
                renderer.setClearColor(0x000000, 1);
                renderer.autoClear = false;
                renderer.clear(true, true, true);
                let chunkStart = performance.now();
                for (let i = 0; i < sampleCount; i++) {
                    throwIfProcessingCancelled();
                    const sample = VolumeCore.exposureSample(i, frameMeshes.length, samplesPerFrame);
                    if (frameIsWithinTrim(sample.frameIndex, frameMeshes.length)) {
                        exposureMaterial.uniforms.map.value = getFrameTexture(frameMeshes[sample.frameIndex]);
                        exposureMaterial.uniforms.globalOpacity.value = opacity * sample.weight * energyWeight;
                        exposureMesh.position.y = (startOffset + sample.position * spacing) * scale;
                        renderer.render(exposureScene, bakeCamera);
                        renderedSamples++;
                    }
                    if (performance.now() - chunkStart >= 8) {
                        updateProcessingProgress(i + 1, sampleCount);
                        await new Promise(resolve => setTimeout(resolve, 0));
                        chunkStart = performance.now();
                    }
                }
                throwIfProcessingCancelled();
                completed = true;
            } catch (error) {
                handleProcessingError(error, 'EXPOSURE BAKE FAILED');
                setExposureStatus(error.message === 'Processing Cancelled' ? 'BAKE CANCELLED' : 'BAKE FAILED');
            } finally {
                renderer.setRenderTarget(previousTarget);
                renderer.setClearColor(previousClearColor, previousClearAlpha);
                renderer.autoClear = previousAutoClear;
                isBakingExposure = false;
                finishProcessing();
                if (completed) {
                    exposureDirty = false;
                    exposurePreviewVisible = renderedSamples > 0;
                    setExposureStatus(renderedSamples > 0 ? `${renderedSamples} SAMPLES` : 'NO FRAMES', renderedSamples > 0);
                    statusContainer.classList.add('hidden');
                }
                if (resizeAfterBake) {
                    resizeAfterBake = false;
                    onWindowResize();
                }
                requestRender();
            }
            return completed;
        }

        function renderExposureView() {
            if (!exposureRenderTarget || !exposureDisplayScene || !exposureDisplayCamera) {
                renderer.render(scene, activeCamera);
                return;
            }

            renderer.render(exposureDisplayScene, exposureDisplayCamera);
        }

        function createTravelCuboid() {
            const geometry = new THREE.BoxGeometry(DISPLAY_WIDTH_CM, TRAVEL_DISTANCE_CM, DISPLAY_HEIGHT_CM);
            const edges = new THREE.EdgesGeometry(geometry);
            const material = new THREE.LineBasicMaterial({
                color: 0xff4444,
                transparent: true,
                opacity: 0.28,
                depthTest: true,
                depthWrite: false
            });

            travelCuboid = new THREE.LineSegments(edges, material);
            travelCuboid.position.y = TRAVEL_DISTANCE_CM / 2;
            travelCuboid.renderOrder = -100;
            scene.add(travelCuboid);
            updateTravelCuboidScale();
        }

        function centerCameraOnDisplayVolume() {
            if (!controls || !activeCamera) return;

            const scale = parseFloat(inputs.scale.value);
            const centerY = (TRAVEL_DISTANCE_CM * Math.max(scale, 0.1)) / 2;
            controls.target.set(0, centerY, 0);
            activeCamera.lookAt(controls.target);
            controls.update();
        }

        function updateTravelCuboidScale() {
            if (!travelCuboid) return;

            const scale = parseFloat(inputs.scale.value);
            travelCuboid.scale.setScalar(scale);
            travelCuboid.position.y = (TRAVEL_DISTANCE_CM * scale) / 2;
            updateTravelCuboidVisibility();
        }

        function updateTravelCuboidVisibility() {
            if (!travelCuboid) return;
            travelCuboid.visible = boxToggle.checked;
        }

        // --- Source Processing ---

        function isGeneratedPreviewImageFile(file) {
            return /(^preview|[_.]preview)\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(file.name);
        }

        function isImageFile(file) {
            return file.type.startsWith('image/') || /\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(file.name);
        }

        function isSequenceImageFile(file) {
            return isImageFile(file) && !isGeneratedPreviewImageFile(file);
        }

        function isVideoFile(file) {
            return file.type.startsWith('video/') || /\.(avi|m4v|mkv|mov|mp4|ogv|webm)$/i.test(file.name);
        }

        function isSequenceMetadataFile(file) {
            return file.name.toLowerCase() === 'sequence.json';
        }

        function compareSequenceFiles(a, b) {
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        }

        function getFilesSignature(files) {
            return files.map(file => `${file.name}:${file.size}:${file.lastModified}`).join('|');
        }

        function getSelectedSource(fileList) {
            const files = Array.from(fileList || []);
            const imageFiles = files.filter(isSequenceImageFile).sort(compareSequenceFiles);
            const videoFiles = files.filter(isVideoFile).sort(compareSequenceFiles);
            const metadataFile = files.find(isSequenceMetadataFile) || null;

            if (imageFiles.length > 0) {
                return { type: 'sequence', files: imageFiles, metadataFile };
            }

            if (videoFiles.length > 0) {
                return { type: 'video', files: [videoFiles[0]], metadataFile: getVideoMetadataFile(files, videoFiles[0]) };
            }

            return null;
        }

        function getVideoPreviewFilename(file) {
            const baseName = (file && file.name ? file.name : 'video').replace(/\.[^/.]+$/, '');
            return `${baseName}.preview.png`;
        }

        function getVideoMetadataFile(files, videoFile) {
            const name = videoFile.name.replace(/\.[^/.]+$/, '').toLowerCase() + '.json';
            return Array.from(files).find(file => file.name.toLowerCase() === name) || null;
        }

        function getBatchPreviewJobsForFiles(files, directoryHandle, folderName = '') {
            const source = getSelectedSource(files);
            if (!source) return [];

            if (source.type === 'sequence') {
                return [{
                    type: 'sequence',
                    directoryHandle,
                    files: source.files,
                    metadataFile: source.metadataFile,
                    outputFilename: 'preview.png',
                    name: folderName || directoryHandle?.name || 'Image Sequence'
                }];
            }

            return Array.from(files)
                .filter(isVideoFile)
                .sort(compareSequenceFiles)
                .map(file => ({
                    type: 'video',
                    directoryHandle,
                    files: [file],
                    metadataFile: getVideoMetadataFile(files, file),
                    outputFilename: getVideoPreviewFilename(file),
                    name: file.name
                }));
        }

        async function importSequenceFolder() {
            if (!('showDirectoryPicker' in window)) {
                fileInput.click();
                return;
            }

            try {
                const directoryHandle = await window.showDirectoryPicker({ mode: 'read' });
                await processSequenceDirectory(directoryHandle);
            } catch (error) {
                if (error && error.name !== 'AbortError') {
                    statusContainer.classList.remove('hidden');
                    handleProcessingError(error, 'Could not open this folder.');
                    updateInteractionState();
                }
            }
        }

        async function getFilesFromDirectory(directoryHandle) {
            const files = [];

            for await (const entry of directoryHandle.values()) {
                if (entry.kind !== 'file') continue;
                const file = await entry.getFile();
                files.push(file);
            }

            return files;
        }

        async function processSequenceDirectory(directoryHandle, options = {}) {
            if (!directoryHandle || isProcessing) return false;

            const files = await getFilesFromDirectory(directoryHandle);
            const jobs = getBatchPreviewJobsForFiles(files, directoryHandle, directoryHandle.name);
            const source = jobs[0] || null;

            if (!source) {
                statusContainer.classList.remove('hidden');
                statusText.textContent = 'NO SOURCE FOUND';
                progressText.textContent = '0%';
                progressBar.style.width = '0%';
                return false;
            }

            if (source.type === 'sequence') {
                return await processImageSequenceSource(source.files, source.metadataFile, { ...options, directoryHandle });
            }

            return await processVideoSource(source.files[0], { ...options, directoryHandle, metadataFile: source.metadataFile });
        }

        function getDefaultSequenceMetadata() {
            return {
                startCm: 0,
                volumeHeightCm: TRAVEL_DISTANCE_CM
            };
        }

        function clamp(value, min, max) {
            return Math.min(max, Math.max(min, value));
        }

        function normalizeSequenceMetadata(rawMetadata = {}) {
            return VolumeCore.normalizeMetadata(rawMetadata, TRAVEL_DISTANCE_CM);
        }

        async function loadSequenceMetadata(file) {
            if (!file) return { ...getDefaultSequenceMetadata(), raw: {} };

            const text = await file.text();
            const raw = JSON.parse(text);
            return { ...normalizeSequenceMetadata(raw), raw };
        }

        function formatSpacingCm(value) {
            return value < 1 ? value.toFixed(4) : value.toFixed(2);
        }

        function getActiveGeometryFrameCount() {
            return pendingFrameCount || frameMeshes.length || Math.max(1, parseInt(inputs.count.value) || 1);
        }

        function getMaxSpacingForFrameCount(frameCount) {
            return frameCount > 1 ? TRAVEL_DISTANCE_CM / (frameCount - 1) : TRAVEL_DISTANCE_CM;
        }

        function setSpacingControlRange(frameCount = getActiveGeometryFrameCount()) {
            const maxSpacing = sourceGeometry.isSequence
                ? getMaxSpacingForFrameCount(frameCount)
                : TRAVEL_DISTANCE_CM;
            inputs.spacing.max = Math.max(0, maxSpacing).toFixed(6);
            displays.spacing.max = inputs.spacing.max;
        }

        function setSpacingControlValue(value) {
            const spacing = Number.isFinite(value) ? Math.max(0, value) : 0;
            inputs.spacing.value = spacing;
            inputs.spacing.disabled = false;
            inputs.spacing.classList.remove('opacity-50', 'cursor-not-allowed');
            displays.spacing.value = formatSpacingCm(spacing);
        }

        function setSequenceToolsVisible(show) {
            sequenceGeometryTools.classList.toggle('hidden', !show);
            exportSequenceJsonBtn.disabled = !show;
            exportSequenceJsonBtn.classList.toggle('opacity-50', !show);
            exportSequenceJsonBtn.classList.toggle('cursor-not-allowed', !show);
        }

        function updateSequenceGeometryDisplay() {
            const start = sourceGeometry.startCm;
            const end = start + sourceGeometry.volumeHeightCm;
            const maxStart = Math.max(0, TRAVEL_DISTANCE_CM - sourceGeometry.volumeHeightCm);
            sequenceBoundsVal.textContent = `${start.toFixed(2)} - ${end.toFixed(2)} cm`;
            sequenceAlignSelect.value = sourceGeometry.alignment;
            sequenceStartInput.max = maxStart.toFixed(2);
            sequenceStartVal.max = sequenceStartInput.max;
            sequenceStartInput.value = clamp(start, 0, maxStart);
            sequenceStartVal.value = start.toFixed(2);
            sequenceStartControl.classList.toggle('hidden', sourceGeometry.alignment !== 'custom');
        }

        function applyAlignmentToGeometry() {
            const frameCount = getActiveGeometryFrameCount();
            const volumeHeightCm = getStackHeightCm(frameCount, sourceGeometry.spacingCm);
            const maxStart = Math.max(0, TRAVEL_DISTANCE_CM - volumeHeightCm);

            sourceGeometry.volumeHeightCm = volumeHeightCm;

            if (sourceGeometry.alignment === 'center') {
                sourceGeometry.startCm = maxStart / 2;
            } else if (sourceGeometry.alignment === 'bottom') {
                sourceGeometry.startCm = 0;
            } else {
                sourceGeometry.startCm = clamp(sourceGeometry.startCm, 0, maxStart);
            }
        }

        function inferSequenceAlignment(metadata) {
            const centerStart = Math.max(0, TRAVEL_DISTANCE_CM - metadata.volumeHeightCm) / 2;

            if (Math.abs(metadata.startCm) < 0.001) return 'bottom';
            if (Math.abs(metadata.startCm - centerStart) < 0.001) return 'center';
            return 'custom';
        }

        function applySpacingFromControl(rawValue) {
            const frameCount = getActiveGeometryFrameCount();
            setSpacingControlRange(frameCount);

            const maxSpacing = parseFloat(inputs.spacing.max) || TRAVEL_DISTANCE_CM;
            const spacing = clamp(Number.isFinite(rawValue) ? rawValue : 0, 0, maxSpacing);

            sourceGeometry.spacingCm = spacing;

            if (sourceGeometry.isSequence) {
                applyAlignmentToGeometry();
                updateSequenceGeometryDisplay();
            } else {
                sourceGeometry.startCm = 0;
                sourceGeometry.volumeHeightCm = TRAVEL_DISTANCE_CM;
                lastManualSpacingCm = spacing;
            }

            setSpacingControlValue(spacing);
            updateSpacing(spacing);
            updateVisibility();
            markExposureDirty('GEOMETRY CHANGED');
        }

        function fitSpacingToBox() {
            const frameCount = getActiveGeometryFrameCount();
            const spacing = frameCount > 1 ? getMaxSpacingForFrameCount(frameCount) : 0;

            sourceGeometry.spacingCm = spacing;

            if (sourceGeometry.isSequence) {
                applyAlignmentToGeometry();
                updateSequenceGeometryDisplay();
            } else {
                sourceGeometry.startCm = 0;
                sourceGeometry.volumeHeightCm = getStackHeightCm(frameCount, spacing);
                lastManualSpacingCm = spacing;
            }

            setSpacingControlRange(frameCount);
            setSpacingControlValue(spacing);
            updateSpacing(spacing);
            updateVisibility();
            markExposureDirty('GEOMETRY CHANGED');
        }

        function applyManualGeometry() {
            sourceGeometry.isSequence = false;
            sourceGeometry.alignment = 'bottom';
            sourceGeometry.startCm = 0;
            sourceGeometry.volumeHeightCm = TRAVEL_DISTANCE_CM;
            sourceGeometry.spacingCm = lastManualSpacingCm;
            setSequenceToolsVisible(false);
            setSpacingControlRange();
            setSpacingControlValue(lastManualSpacingCm);
        }

        function applySequenceGeometry(metadata, frameCount, hasMetadata) {
            sourceGeometry.isSequence = true;
            sourceGeometry.alignment = hasMetadata ? inferSequenceAlignment(metadata) : 'bottom';
            sourceGeometry.startCm = metadata.startCm;
            sourceGeometry.volumeHeightCm = metadata.volumeHeightCm;

            setSequenceToolsVisible(true);
            setSpacingControlRange(frameCount);

            const maxSpacing = getMaxSpacingForFrameCount(frameCount);
            const spacing = frameCount > 1
                ? metadata.volumeHeightCm / (frameCount - 1)
                : 0;

            sourceGeometry.spacingCm = clamp(spacing, 0, maxSpacing);
            applyAlignmentToGeometry();
            setSpacingControlValue(sourceGeometry.spacingCm);
            updateSequenceGeometryDisplay();
        }

        function getStackStartCm() {
            return sourceGeometry.startCm;
        }

        function getCurrentSpacingCm() {
            return sourceGeometry.spacingCm;
        }

        function getStackHeightCm(frameCount, spacing) {
            if (frameCount <= 1) return 0;
            return (frameCount - 1) * spacing;
        }

        function getStackWorldCenterY(frameCount = stackGroup.children.length) {
            const spacing = getCurrentSpacingCm();
            const scale = parseFloat(inputs.scale.value);
            const height = getStackHeightCm(frameCount, spacing);
            return (getStackStartCm() + (height / 2)) * scale;
        }

        function getDisplayVolumeScale() {
            return Math.max(0.0001, parseFloat(inputs.scale.value) || 1);
        }

        function getDisplayVolumeCenterY() {
            return (TRAVEL_DISTANCE_CM * getDisplayVolumeScale()) / 2;
        }

        function fitOrthographicCameraToDisplayFootprint(camera, aspect, padding = 1.04) {
            const scale = getDisplayVolumeScale();
            const displayWidth = DISPLAY_WIDTH_CM * scale;
            const displayHeight = DISPLAY_HEIGHT_CM * scale;
            const frustumHeight = Math.max(displayHeight, displayWidth / Math.max(0.0001, aspect)) * padding;
            camera.zoom = ORTHO_VIEW_SIZE / Math.max(0.0001, frustumHeight);
            camera.updateProjectionMatrix();
        }

        function updateOrthographicCameraFrustum(aspect) {
            orthoCamera.left = -ORTHO_VIEW_SIZE * aspect / 2;
            orthoCamera.right = ORTHO_VIEW_SIZE * aspect / 2;
            orthoCamera.top = ORTHO_VIEW_SIZE / 2;
            orthoCamera.bottom = -ORTHO_VIEW_SIZE / 2;
            orthoCamera.updateProjectionMatrix();
        }

        function applyTopDownOrthographicView() {
            const aspect = window.innerWidth / window.innerHeight;
            const centerY = getDisplayVolumeCenterY();
            const distance = Math.max(100, TRAVEL_DISTANCE_CM * getDisplayVolumeScale() + 100);

            updateOrthographicCameraFrustum(aspect);
            fitOrthographicCameraToDisplayFootprint(orthoCamera, aspect);
            orthoCamera.position.set(0, centerY + distance, 0);
            orthoCamera.up.set(0, 0, -1);
            controls.target.set(0, centerY, 0);
            orthoCamera.lookAt(controls.target);
            controls.update();
        }

        function setTopDownOrthographicView() {
            orthoViewMode = ORTHO_VIEW_MODES.TOP;

            if (activeCamera !== orthoCamera) {
                activeCamera = orthoCamera;
                controls.object = activeCamera;
                orthoToggle.checked = true;
                updateOrthoViewButtonVisibility();
            }

            applyTopDownOrthographicView();
            renderer.clear();
            markExposureDirty('VIEW CHANGED');
        }

        function updateControlsTargetForStack() {
            if (stackGroup.children.length === 0) return;
            controls.target.y = getStackWorldCenterY();
        }

        function getSequenceDuration(fileCount, fps) {
            if (fileCount <= 1) return 0.1;
            return Math.max(0.1, fileCount / Math.max(1, fps));
        }

        function clamp01(value) {
            return Math.min(1, Math.max(0, value));
        }

        function applyTrimValues(start, end, duration) {
            const maxDuration = Math.max(0.1, duration);
            const minGap = Math.min(0.1, maxDuration);

            start = Math.max(0, Math.min(start, maxDuration - minGap));
            end = Math.max(minGap, Math.min(end, maxDuration));

            if (end - start < minGap) {
                if (end >= maxDuration) {
                    start = Math.max(0, end - minGap);
                } else {
                    end = Math.min(maxDuration, start + minGap);
                }
            }

            trimStartInput.max = maxDuration;
            trimEndInput.max = maxDuration;
            trimStartInput.value = start;
            trimEndInput.value = end;
            updateTrimLabel();
        }

        function setTrimRange(duration, resetToFull) {
            const maxDuration = Math.max(0.1, duration);
            if (resetToFull) {
                applyTrimValues(0, maxDuration, maxDuration);
            } else {
                applyTrimValues(parseFloat(trimStartInput.value), parseFloat(trimEndInput.value), maxDuration);
            }
        }

        function refreshSequenceTimingFromFps() {
            if (currentSourceType !== 'sequence' || currentSequenceFiles.length === 0) return;

            const previousDuration = currentSourceDuration || parseFloat(trimEndInput.max) || 0.1;
            const startRatio = clamp01(parseFloat(trimStartInput.value) / previousDuration);
            const endRatio = clamp01(parseFloat(trimEndInput.value) / previousDuration);
            const fps = parseInt(fpsSelect.value);
            const timeScale = currentSequenceFps / fps;
            stackGenParams.start *= timeScale;
            stackGenParams.duration *= timeScale;
            frameMeshes.forEach(mesh => {
                mesh.userData.sourceTime = mesh.userData.sourceIndex / fps;
            });
            currentSequenceFps = fps;
            currentSourceDuration = getSequenceDuration(currentSequenceFiles.length, fps);
            applyTrimValues(startRatio * currentSourceDuration, endRatio * currentSourceDuration, currentSourceDuration);
        }

        function getSequenceTrimRange(fileCount) {
            if (fileCount <= 0) return { startIndex: 0, endIndex: -1, count: 0 };
            if (fileCount === 1) return { startIndex: 0, endIndex: 0, count: 1 };

            const fps = Math.max(1, parseInt(fpsSelect.value) || 1);
            const duration = Math.max(0.1, currentSourceDuration);
            const epsilon = 0.000001;
            const startTime = clamp(parseFloat(trimStartInput.value), 0, duration);
            const endTime = clamp(parseFloat(trimEndInput.value), 0, duration);
            let startIndex = Math.floor((startTime * fps) + epsilon);
            let endIndex = Math.ceil((endTime * fps) - epsilon) - 1;

            startIndex = Math.max(0, Math.min(startIndex, fileCount - 1));
            endIndex = Math.max(0, Math.min(endIndex, fileCount - 1));

            if (endIndex < startIndex) {
                const nearest = Math.max(0, Math.min(Math.floor(startTime * fps), fileCount - 1));
                startIndex = nearest;
                endIndex = nearest;
            }

            return {
                startIndex,
                endIndex,
                count: endIndex - startIndex + 1
            };
        }

        function updateProcessingProgress(index, total) {
            const progress = total > 0 ? Math.round((index / total) * 100) : 100;
            progressBar.style.width = `${progress}%`;
            progressText.textContent = `${progress}%`;
        }

        function beginProcessing(message) {
            isProcessing = true;
            cancelProcessingRequested = false;
            statusContainer.classList.remove('hidden');
            panelContent.classList.add('opacity-50', 'pointer-events-none');
            regenerateBtn.disabled = true;
            regenerateBtn.classList.add('opacity-50', 'cursor-not-allowed');
            exportPreviewBtn.disabled = true;
            exportPreviewBtn.classList.add('opacity-50', 'cursor-not-allowed');
            cancelProcessingBtn.disabled = false;
            cancelProcessingBtn.textContent = 'Cancel Processing';
            statusText.textContent = message;
            progressText.textContent = '0%';
            progressBar.style.width = '0%';
            updateInteractionState();
            updateBatchPreviewUi();
        }

        function updateInteractionState() {
            const busy = isProcessing || isExportingPreviewImage;
            panelContent.inert = busy;
            panelContent.classList.toggle('opacity-50', busy);
            panelContent.classList.toggle('pointer-events-none', busy);
            fileInput.disabled = busy || isBatchPreviewRunning;
            folderImportBtn.disabled = busy || isBatchPreviewRunning;
            regenerateBtn.disabled = busy || isBatchPreviewRunning;
            if (controls) controls.enabled = !busy;
            cancelProcessingBtn.classList.toggle('hidden', !isProcessing && !isBatchPreviewRunning);
            updateBatchResults();
        }

        function requestProcessingCancel() {
            if (isBatchPreviewRunning) {
                batchPreviewCancelRequested = true;
                updateBatchPreviewUi('Stopping batch...');
            }
            if (!isProcessing) return;
            cancelProcessingRequested = true;
            cancelProcessingBtn.disabled = true;
            cancelProcessingBtn.textContent = 'Cancelling...';
            statusText.textContent = 'CANCELLING...';
        }

        function throwIfProcessingCancelled() {
            if (cancelProcessingRequested || graphicsContextLost) {
                throw new Error('Processing Cancelled');
            }
        }

        function finishProcessing() {
            isProcessing = false;
            cancelProcessingRequested = false;
            cancelProcessingBtn.disabled = false;
            cancelProcessingBtn.textContent = 'Cancel Processing';
            regenerateBtn.disabled = false;
            regenerateBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            exportPreviewBtn.disabled = false;
            exportPreviewBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            panelContent.classList.remove('opacity-50', 'pointer-events-none');
            updateInteractionState();
            updateBatchPreviewUi();
            requestRender();
        }

        function handleProcessingError(error, label) {
            if (error && error.message === 'Processing Cancelled') {
                statusText.textContent = 'CANCELLED';
            } else {
                console.error(error);
                statusText.textContent = error?.message || label;
            }
            progressText.textContent = '0%';
            progressBar.style.width = '0%';
        }

        function resetPlaybackState() {
            playback.isPlaying = false;
            playback.currentIndex = 0;
            playback.direction = 1;
            playback.lastTime = 0;
            timelineInput.value = 0;
            playPauseBtn.textContent = 'Play';
            viewportTrail.invalidate();
            renderer.clear();
        }

        function getFrameTexturePlan(frameCount) {
            return VolumeCore.texturePlan(frameCount, parseInt(resolutionSelect.value),
                DISPLAY_ASPECT_RATIO, renderer?.capabilities.maxTextureSize);
        }

        function updateMemoryEstimate() {
            const count = Math.min(VolumeCore.MAX_PREVIEW_FRAMES, Math.max(1, parseInt(inputs.count.value) || 1));
            const plan = getFrameTexturePlan(count);
            document.getElementById('memoryEstimate').textContent =
                `${count} frames · ${plan.width} × ${plan.height} · ~${Math.ceil(plan.estimatedBytes / 1048576)} MiB` +
                (plan.downscaled ? ' · resolution limited by GPU texture size' : '');
        }

        function applySourceGeometry(metadata, frameCount, previousGeometry) {
            const geometry = previousGeometry || metadata;
            applySequenceGeometry(geometry, frameCount, Boolean(previousGeometry || currentMetadataFile));
            if (previousGeometry) {
                sourceGeometry.alignment = previousGeometry.alignment;
                applyAlignmentToGeometry();
                updateSequenceGeometryDisplay();
            }
        }

        function disposeFrameTexture(texture) {
            if (!texture) return;
            texture.dispose();
            if (texture.image instanceof HTMLCanvasElement) {
                texture.image.width = 0;
                texture.image.height = 0;
            }
            texture.image = null;
        }

        function drawContainedFrame(ctx, drawable, sourceWidth, sourceHeight, targetWidth, targetHeight) {
            ctx.clearRect(0, 0, targetWidth, targetHeight);
            if (sourceWidth <= 0 || sourceHeight <= 0) return;

            const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
            const drawWidth = sourceWidth * scale;
            const drawHeight = sourceHeight * scale;
            const drawX = (targetWidth - drawWidth) / 2;
            const drawY = (targetHeight - drawHeight) / 2;

            ctx.drawImage(drawable, drawX, drawY, drawWidth, drawHeight);
        }

        function createTextureFrameFromCanvas(canvas) {
            const texCanvas = document.createElement('canvas');
            texCanvas.width = canvas.width;
            texCanvas.height = canvas.height;
            const texCtx = texCanvas.getContext('2d');
            texCtx.drawImage(canvas, 0, 0);

            const texture = new THREE.CanvasTexture(texCanvas);
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;

            return {
                texture,
                aspectRatio: canvas.width / canvas.height
            };
        }

        function loadImageFromFile(file) {
            return new Promise((resolve, reject) => {
                const objectUrl = URL.createObjectURL(file);
                const image = new Image();
                image.onload = () => {
                    URL.revokeObjectURL(objectUrl);
                    resolve(image);
                };
                image.onerror = () => {
                    URL.revokeObjectURL(objectUrl);
                    reject(new Error(`Image Load Error: ${file.name}`));
                };
                image.src = objectUrl;
            });
        }

        async function loadDrawableFromImageFile(file) {
            if ('createImageBitmap' in window) {
                try {
                    return await createImageBitmap(file);
                } catch (error) {
                    console.warn('createImageBitmap failed, falling back to Image()', error);
                }
            }

            return loadImageFromFile(file);
        }

        function getDrawableDimensions(drawable) {
            return {
                width: drawable.naturalWidth || drawable.videoWidth || drawable.width,
                height: drawable.naturalHeight || drawable.videoHeight || drawable.height
            };
        }

        function disposeDrawable(drawable) {
            if (drawable && typeof drawable.close === 'function') {
                drawable.close();
            }
        }
        
        function updateFrameSliderLimits() {
            if (currentSourceDuration <= 0) return;
            
            const start = parseFloat(trimStartInput.value);
            const end = parseFloat(trimEndInput.value);
            const trimmedDuration = Math.max(0.1, end - start);
            let maxFrames = 1;

            if (currentSourceType === 'sequence') {
                maxFrames = getSequenceTrimRange(currentSequenceFiles.length).count;
            } else {
                const fps = parseInt(fpsSelect.value);
                maxFrames = Math.floor(trimmedDuration * fps);
            }

            const sliderMin = parseInt(inputs.count.min) || 1;
            const sliderMax = Math.min(VolumeCore.MAX_PREVIEW_FRAMES, Math.max(sliderMin, maxFrames));
            
            // Update Slider Max
            inputs.count.max = sliderMax;
            displays.count.max = sliderMax;
            
            // Clamp current value if it exceeds new max
            const currentVal = parseInt(inputs.count.value);
            if (currentVal > sliderMax) {
                inputs.count.value = sliderMax;
                displays.count.value = sliderMax;
            }
            updateMemoryEstimate();
        }

        function clearStack() {
            disposeExposure();

            const disposedGeometries = new Set();
            const disposedTextures = new Set();

            const disposeGeometry = (geometry) => {
                if (!geometry || disposedGeometries.has(geometry)) return;
                geometry.dispose();
                disposedGeometries.add(geometry);
            };

            const disposeTexture = (texture) => {
                if (!texture || disposedTextures.has(texture)) return;
                disposeFrameTexture(texture);
                disposedTextures.add(texture);
            };

            while(stackGroup.children.length > 0){ 
                const mesh = stackGroup.children[0];
                disposeGeometry(mesh.geometry);
                if(mesh.material) {
                    if(mesh.material.uniforms && mesh.material.uniforms.map) {
                        disposeTexture(mesh.material.uniforms.map.value);
                    }
                    mesh.material.dispose();
                }
                stackGroup.remove(mesh); 
            }
            frameMeshes = [];
            
            if(scannerMesh) {
                scene.remove(scannerMesh);
                disposeGeometry(scannerMesh.geometry);
                if(scannerMesh.material) {
                    if(scannerMesh.material.uniforms && scannerMesh.material.uniforms.map) {
                        disposeTexture(scannerMesh.material.uniforms.map.value);
                    }
                    scannerMesh.material.dispose();
                }
                scannerMesh = null;
            }
        }

        function buildStack(frames) {
            if(frames.length === 0) return;
            
            const spacing = getCurrentSpacingCm();
            const initialOpacity = parseFloat(inputs.opacity.value);
            const initialThreshold = parseFloat(inputs.threshold.value);
            const initialBrightThreshold = parseFloat(inputs.brightThreshold.value);
            const modeName = inputs.blendMode.value;
            const startOffset = getStackStartCm();
            const scale = parseFloat(inputs.scale.value);
            const stackHeight = getStackHeightCm(frames.length, spacing);
            const centerY = (startOffset + (stackHeight / 2)) * scale;

            const geometry = new THREE.PlaneGeometry(DISPLAY_WIDTH_CM, DISPLAY_HEIGHT_CM);

            frames.forEach((frameData, index) => {
                const material = new THREE.ShaderMaterial({
                    uniforms: {
                        map: { value: frameData.texture },
                        globalOpacity: { value: initialOpacity },
                        threshold: { value: initialThreshold },
                        brightThreshold: { value: initialBrightThreshold }
                    },
                    vertexShader: vertexShader,
                    fragmentShader: fragmentShader,
                    transparent: true,
                    side: THREE.DoubleSide,
                    depthWrite: false
                });

                material.blending = THREE[modeName];

                const plane = new THREE.Mesh(geometry, material);
                plane.userData.sourceTime = frameData.sourceTime;
                plane.userData.sourceIndex = frameData.sourceIndex;
                plane.rotation.x = -Math.PI / 2;
                plane.position.y = startOffset + (index * spacing);

                stackGroup.add(plane);
                frameMeshes.push(plane);
            });

            const scannerMat = new THREE.ShaderMaterial({
                uniforms: {
                    map: { value: frames[0].texture },
                    mapNext: { value: frames[0].texture },
                    mixFactor: { value: 0 }, 
                    globalOpacity: { value: initialOpacity },
                    threshold: { value: initialThreshold },
                    brightThreshold: { value: initialBrightThreshold }
                },
                vertexShader: vertexShader,
                fragmentShader: scannerFragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            scannerMat.blending = THREE[modeName];
            
            scannerMesh = new THREE.Mesh(geometry, scannerMat);
            scannerMesh.rotation.x = -Math.PI / 2;
            scannerMesh.visible = false;
            scannerMesh.scale.copy(stackGroup.scale); // Sync scale
            scene.add(scannerMesh);

            controls.target.set(0, centerY, 0);
            
            const cameraDistance = Math.max(DISPLAY_WIDTH_CM, DISPLAY_HEIGHT_CM, stackHeight, TRAVEL_DISTANCE_CM) * Math.max(scale, 0.1);
            activeCamera.position.set(cameraDistance, centerY + (cameraDistance * 0.65), cameraDistance);
            activeCamera.lookAt(0, centerY, 0);
            
            controls.autoRotate = false;
            updateVisibility();
            markExposureDirty('NEEDS BAKE');
        }

        function updateSpacing(val) {
            const startOffset = getStackStartCm();
            stackGroup.children.forEach((mesh, index) => {
                mesh.position.y = startOffset + (index * val);
            });
            if(stackGroup.children.length > 0) {
                updateControlsTargetForStack();
            }
        }

        function onWindowResize() {
            if (isBakingExposure) {
                resizeAfterBake = true;
                requestProcessingCancel();
                return;
            }
            const aspect = window.innerWidth / window.innerHeight;

            perspCamera.aspect = aspect;
            perspCamera.updateProjectionMatrix();

            renderer.setSize(window.innerWidth, window.innerHeight);

            if (activeCamera === orthoCamera && orthoViewMode === ORTHO_VIEW_MODES.TOP) {
                applyTopDownOrthographicView();
            } else {
                updateOrthographicCameraFrustum(aspect);
            }

            markExposureDirty('VIEW CHANGED');
        }

        function updateVisibility() {
            if (stackGroup.children.length === 0) return;

            const isSmooth = smoothToggle.checked;
            const spacing = getCurrentSpacingCm();
            
            if (playback.mode === 'scan' && isSmooth && scannerMesh) {
                stackGroup.visible = false;
                scannerMesh.visible = true;

                scannerMesh.position.y = (getStackStartCm() + (playback.currentIndex * spacing)) * stackGroup.scale.y;
                
                const texIndex = Math.min(Math.floor(playback.currentIndex), frameMeshes.length - 1);
                const frameMesh = frameMeshes[texIndex];
                if(frameMesh && frameMesh.material.uniforms.map.value) {
                     scannerMesh.material.uniforms.map.value = frameMesh.material.uniforms.map.value;
                     const next = frameMeshes[Math.min(texIndex + 1, frameMeshes.length - 1)];
                     scannerMesh.material.uniforms.mapNext.value = getFrameTexture(next);
                     scannerMesh.material.uniforms.mixFactor.value = document.getElementById('interpolateToggle').checked
                         ? playback.currentIndex - texIndex : 0;
                }

                return; 
            }

            stackGroup.visible = true;
            if(scannerMesh) scannerMesh.visible = false;

            const current = Math.floor(playback.currentIndex);
            const total = stackGroup.children.length;
            const uiStart = parseFloat(trimStartInput.value);
            const uiEnd = parseFloat(trimEndInput.value);
            
            stackGroup.children.forEach((mesh, index) => {
                let shouldBeVisible = false;

                if (playback.mode === 'static') {
                    // Check trim preview
                    const sliceTime = getSliceTime(index, total);
                    // Fuzzy match due to float precision
                    if (sliceTime >= uiStart - 0.01 && sliceTime <= uiEnd + 0.01) {
                        shouldBeVisible = true;
                    }
                } else if (playback.mode === 'scan') {
                    if (index === current) shouldBeVisible = true;
                } else if (playback.mode === 'build') {
                    if (index <= current) shouldBeVisible = true;
                }
                
                mesh.visible = shouldBeVisible;
            });
        }

        function requestRender() {
            if (animationFrameId === null && !document.hidden) {
                animationFrameId = requestAnimationFrame(animate);
            }
        }

        function animate(time = performance.now()) {
            animationFrameId = null;
            if (isExportingPreviewImage || isProcessing || graphicsContextLost || document.hidden) {
                playback.lastTime = 0;
                return;
            }

            const deltaSeconds = playback.lastTime
                ? Math.max(0, (time - playback.lastTime) / 1000)
                : 0;
            playback.lastTime = time;

            controls.update();

            if (playback.isPlaying && frameMeshes.length > 0 && !isProcessing) {
                const next = VolumeCore.advancePlayback(playback.currentIndex, playback.direction,
                    deltaSeconds, frameMeshes.length, stackGenParams.duration, playback.speed, playback.loop);
                playback.currentIndex = next.index;
                playback.direction = next.direction;
                playback.isPlaying = next.playing;
                playPauseBtn.textContent = next.playing ? 'Pause' : 'Play';
                timelineInput.value = frameMeshes.length > 1 ? next.index / (frameMeshes.length - 1) * 100 : 0;
                updateVisibility();
            }

            if (exposurePreviewVisible) {
                scene.background = backgroundColor;
                renderer.autoClear = true;
                renderExposureView();
                lastCameraPos.copy(activeCamera.position);
                lastCameraQuat.copy(activeCamera.quaternion);
                return;
            }

            // --- Light Painting Logic ---
            const isPainting = playback.mode === 'scan' && lightPaintToggle.checked;
            
            scene.background = backgroundColor;
            renderer.autoClear = true;
            lastCameraPos.copy(activeCamera.position);
            lastCameraQuat.copy(activeCamera.quaternion);
            if (isPainting) viewportTrail.render(scene, activeCamera, travelCuboid,
                smoothToggle.checked ? playback.currentIndex : Math.floor(playback.currentIndex));
            else renderer.render(scene, activeCamera);
            if (!isProcessing && (playback.isPlaying || controls.autoRotate)) {
                requestRender();
            } else {
                playback.lastTime = 0;
            }
        }

        try {
            init();
        } catch (error) {
            console.error(error);
            statusContainer.classList.remove('hidden');
            statusText.textContent = 'Graphics could not start. Check hardware acceleration or try another browser.';
            fileInput.disabled = true;
            folderImportBtn.disabled = true;
            regenerateBtn.disabled = true;
            exportPreviewBtn.disabled = true;
            cancelProcessingBtn.classList.add('hidden');
        }
