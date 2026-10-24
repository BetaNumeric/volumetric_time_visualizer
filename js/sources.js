        async function handleFileSelect(event) {
            if (isProcessing || isExportingPreviewImage || isBatchPreviewRunning) return;
            const source = getSelectedSource(event.target.files);
            if (!source) return;

            if (source.type === 'sequence') {
                await processImageSequenceSource(source.files, source.metadataFile, { preserveGeometry: false, directoryHandle: null });
            } else {
                await processVideoSource(source.files[0], { metadataFile: source.metadataFile, preserveGeometry: false, directoryHandle: null });
            }
        }

        function waitForVideoEvent(video, eventName, start = () => {}) {
            return new Promise((resolve, reject) => {
                const cleanup = () => {
                    clearTimeout(timeout);
                    clearInterval(cancelCheck);
                    video.removeEventListener(eventName, onReady);
                    video.removeEventListener('error', onError);
                };
                const finish = error => {
                    cleanup();
                    if (error) reject(error);
                    else resolve();
                };
                const onReady = () => finish();
                const onError = () => finish(new Error(video.error?.code === 4
                    ? 'This video format is not supported by this browser.'
                    : 'Could not decode this video.'));
                const timeout = setTimeout(() => finish(new Error('Video decoding timed out.')), 15000);
                const cancelCheck = setInterval(() => {
                    if (cancelProcessingRequested) finish(new Error('Processing Cancelled'));
                }, 50);
                video.addEventListener(eventName, onReady);
                video.addEventListener('error', onError);
                try { start(); } catch (error) { finish(error); }
            });
        }

        function seekVideoFrame(video, time) {
            if (!video.seeking && Math.abs(video.currentTime - time) < 0.000001) {
                return video.readyState >= 2 ? Promise.resolve() : waitForVideoEvent(video, 'loadeddata');
            }
            return waitForVideoEvent(video, 'seeked', () => { video.currentTime = time; });
        }

        async function processVideoSource(file, options = {}) {
            if (!file || isProcessing || isExportingPreviewImage) return false;

            let video = null;
            let objectUrl = '';
            let didBuildStack = false;
            let extractedFrames = [];

            const transaction = captureSourceState();
            beginProcessing('PROCESSING...');

            try {
                const metadataFile = options.metadataFile || null;
                const metadata = await loadSequenceMetadata(metadataFile);
                const previousGeometry = { ...sourceGeometry };
                video = document.createElement('video');
                video.style.display = 'none';
                document.body.appendChild(video);

                const prepared = await Mp4Index.prepareForSeeking(file, { checkCancelled: throwIfProcessingCancelled });
                throwIfProcessingCancelled();
                objectUrl = URL.createObjectURL(prepared.blob);
                video.muted = true;
                video.playsInline = true;
                video.autoplay = false;
                video.crossOrigin = "anonymous";

                await waitForVideoEvent(video, 'loadedmetadata', () => { video.src = objectUrl; });
                throwIfProcessingCancelled();
                if (!Number.isFinite(video.duration) || video.duration <= 0) {
                    throw new Error('This video has no readable duration. Export it with duration metadata and try again.');
                }
                const duration = video.duration;
                const signature = getFilesSignature(metadataFile ? [file, metadataFile] : [file]);
                const isNewSource = currentSourceType !== 'video'
                    || currentSourceSignature !== signature
                    || Math.abs(currentSourceDuration - duration) > 0.1;

                currentSourceType = 'video';
                currentVideoFile = file;
                currentMetadataFile = metadataFile;
                currentSourceMetadata = metadata.raw;
                currentSourceDuration = duration;
                currentSourceSignature = signature;
                currentPreviewFilename = getVideoPreviewFilename(file);
                currentSequenceFiles = [];
                setTrimRange(duration, isNewSource && !options.preserveTrim);
                
                // Get Trim Values
                const startTime = parseFloat(trimStartInput.value);
                const endTime = parseFloat(trimEndInput.value);
                const trimDuration = Math.max(0.1, endTime - startTime);

                // Save Gen Params for visibility logic
                stackGenParams.start = startTime;
                stackGenParams.duration = trimDuration;

                // Update limits
                updateFrameSliderLimits();
                
                targetFrameCount = parseInt(inputs.count.value);
                pendingFrameCount = targetFrameCount;
                applySourceGeometry(metadata, targetFrameCount,
                    !isNewSource && options.preserveGeometry !== false ? previousGeometry : null);
                updateMemoryEstimate();
                
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const dimensions = getFrameTexturePlan(targetFrameCount);
                canvas.width = dimensions.width;
                canvas.height = dimensions.height;

                const frames = [];
                extractedFrames = frames;

                for (let i = 0; i < targetFrameCount; i++) {
                    throwIfProcessingCancelled();
                    updateProcessingProgress(i, targetFrameCount);

                    const sampleT = targetFrameCount > 1 ? i / (targetFrameCount - 1) : 0;
                    const currentTime = Math.min(startTime + sampleT * trimDuration, duration);
                    await seekVideoFrame(video, currentTime);
                    throwIfProcessingCancelled();

                    drawContainedFrame(ctx, video, video.videoWidth, video.videoHeight, canvas.width, canvas.height);

                    frames.push({ ...createTextureFrameFromCanvas(canvas), sourceTime: currentTime });
                }

                if (frames.length === 0) {
                    throw new Error('No frames were extracted');
                }

                progressBar.style.width = '100%';
                progressText.textContent = '100%';
                throwIfProcessingCancelled();
                commitSourceFrames(frames);
                currentSequenceDirectoryHandle = options.directoryHandle === undefined
                    ? transaction.source.currentSequenceDirectoryHandle : options.directoryHandle;
                didBuildStack = true;
            } catch(e) {
                restoreSourceState(transaction);
                handleProcessingError(e, 'ERROR PROCESSING VIDEO');
            } finally {
                if (video) {
                    video.pause();
                    video.removeAttribute('src');
                    video.load();
                    if (video.parentNode) {
                        video.parentNode.removeChild(video);
                    }
                }
                if (objectUrl) {
                    URL.revokeObjectURL(objectUrl);
                }

                pendingFrameCount = 0;
                finishProcessing();

                if (didBuildStack) {
                    statusContainer.classList.add('hidden');
                } else {
                    extractedFrames.forEach(frame => {
                        if (frame.texture) {
                            disposeFrameTexture(frame.texture);
                        }
                    });
                }
            }

            return didBuildStack;
        }

        async function processImageSequenceSource(files, metadataFile = null, options = {}) {
            if (!files || files.length === 0 || isProcessing || isExportingPreviewImage) return false;

            const sequenceFiles = Array.from(files).filter(isSequenceImageFile).sort(compareSequenceFiles);
            if (sequenceFiles.length === 0) return false;

            let didBuildStack = false;
            let extractedFrames = [];

            const transaction = captureSourceState();
            beginProcessing('PROCESSING IMAGES...');

            try {
                const sequenceMetadata = await loadSequenceMetadata(metadataFile);
                const previousGeometry = { ...sourceGeometry };
                throwIfProcessingCancelled();

                throwIfProcessingCancelled();

                const signature = getFilesSignature(metadataFile ? [...sequenceFiles, metadataFile] : sequenceFiles);
                const duration = getSequenceDuration(sequenceFiles.length, parseInt(fpsSelect.value));
                const isNewSource = currentSourceType !== 'sequence'
                    || currentSourceSignature !== signature
                    || Math.abs(currentSourceDuration - duration) > 0.1;

                currentSourceType = 'sequence';
                currentVideoFile = null;
                currentMetadataFile = metadataFile;
                currentSourceMetadata = sequenceMetadata.raw;
                currentSequenceFps = parseInt(fpsSelect.value);
                currentSourceDuration = duration;
                currentSourceSignature = signature;
                currentPreviewFilename = 'preview.png';
                currentSequenceFiles = sequenceFiles;
                setTrimRange(duration, isNewSource && !options.preserveTrim);

                updateFrameSliderLimits();

                const trimRange = getSequenceTrimRange(sequenceFiles.length);
                const trimmedFiles = sequenceFiles.slice(trimRange.startIndex, trimRange.endIndex + 1);
                if (trimmedFiles.length === 0) {
                    throw new Error('No images were selected for the current trim range');
                }

                if (isNewSource && !options.preserveFrameCount) {
                    inputs.count.value = Math.min(trimmedFiles.length, VolumeCore.MAX_PREVIEW_FRAMES);
                }

                targetFrameCount = Math.min(parseInt(inputs.count.value), trimmedFiles.length);
                pendingFrameCount = targetFrameCount;
                inputs.count.value = targetFrameCount;
                displays.count.value = targetFrameCount;
                applySourceGeometry(sequenceMetadata, targetFrameCount,
                    !isNewSource && options.preserveGeometry !== false ? previousGeometry : null);
                updateMemoryEstimate();

                const startTime = parseFloat(trimStartInput.value);
                const endTime = parseFloat(trimEndInput.value);
                const trimDuration = Math.max(0.1, endTime - startTime);

                stackGenParams.start = startTime;
                stackGenParams.duration = trimDuration;

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const dimensions = getFrameTexturePlan(targetFrameCount);
                canvas.width = dimensions.width;
                canvas.height = dimensions.height;
                const frames = [];
                extractedFrames = frames;

                for (let i = 0; i < targetFrameCount; i++) {
                    throwIfProcessingCancelled();
                    updateProcessingProgress(i, targetFrameCount);

                    const sampleT = targetFrameCount > 1 ? i / (targetFrameCount - 1) : 0;
                    const sourceIndex = Math.min(Math.round(sampleT * (trimmedFiles.length - 1)), trimmedFiles.length - 1);
                    const drawable = await loadDrawableFromImageFile(trimmedFiles[sourceIndex]);
                    try {
                        throwIfProcessingCancelled();
                        const sourceDimensions = getDrawableDimensions(drawable);
                        drawContainedFrame(
                            ctx,
                            drawable,
                            sourceDimensions.width,
                            sourceDimensions.height,
                            canvas.width,
                            canvas.height
                        );

                        const absoluteIndex = trimRange.startIndex + sourceIndex;
                        frames.push({ ...createTextureFrameFromCanvas(canvas),
                            sourceIndex: absoluteIndex, sourceTime: absoluteIndex / currentSequenceFps });
                    } finally {
                        disposeDrawable(drawable);
                    }
                }

                if (frames.length === 0) {
                    throw new Error('No images were loaded');
                }

                progressBar.style.width = '100%';
                progressText.textContent = '100%';
                throwIfProcessingCancelled();
                commitSourceFrames(frames);
                currentSequenceDirectoryHandle = options.directoryHandle === undefined
                    ? transaction.source.currentSequenceDirectoryHandle : options.directoryHandle;
                didBuildStack = true;
            } catch(e) {
                restoreSourceState(transaction);
                handleProcessingError(e, 'ERROR PROCESSING IMAGES');
            } finally {
                pendingFrameCount = 0;
                finishProcessing();

                if (didBuildStack) {
                    statusContainer.classList.add('hidden');
                } else {
                    extractedFrames.forEach(frame => {
                        if (frame.texture) {
                            disposeFrameTexture(frame.texture);
                        }
                    });
                }
            }

            return didBuildStack;
        }

