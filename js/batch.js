        async function isSameDirectoryHandle(a, b) {
            if (!a || !b) return false;
            if (a === b) return true;
            if ('isSameEntry' in a) {
                try {
                    return await a.isSameEntry(b);
                } catch (error) {
                    return false;
                }
            }
            return a.name === b.name;
        }

        async function directoryHasBatchSource(directoryHandle) {
            const files = await getFilesFromDirectory(directoryHandle);
            return getBatchPreviewJobsForFiles(files, directoryHandle, directoryHandle.name).length > 0;
        }

        async function queueBatchPreviewDirectory(directoryHandle, options = {}) {
            if (!directoryHandle) return false;

            for (const item of batchPreviewQueue) {
                if (await isSameDirectoryHandle(item.handle, directoryHandle)) {
                    return false;
                }
            }

            if (options.validate !== false && !(await directoryHasBatchSource(directoryHandle))) {
                return false;
            }

            batchPreviewQueue.push({
                handle: directoryHandle,
                name: directoryHandle.name || `Folder ${batchPreviewQueue.length + 1}`
            });
            return true;
        }

        async function addBatchPreviewFolderFromPicker() {
            if (!('showDirectoryPicker' in window) || isBatchPreviewRunning || isProcessing || isExportingPreviewImage) return;

            try {
                const directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                const added = await queueBatchPreviewDirectory(directoryHandle);
                updateBatchPreviewUi(added
                    ? `Queued ${directoryHandle.name}.`
                    : `${directoryHandle.name} is already queued or has no supported source.`);
            } catch (error) {
                if (error && error.name !== 'AbortError') {
                    console.error(error);
                    updateBatchPreviewUi('Could not add that folder.');
                }
            }
        }

        async function addBatchPreviewParentFromPicker() {
            if (!('showDirectoryPicker' in window) || isBatchPreviewRunning || isProcessing || isExportingPreviewImage) return;

            try {
                const parentHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                let scannedCount = 0;
                let addedCount = 0;

                updateBatchPreviewUi(`Scanning ${parentHandle.name}...`);

                scannedCount++;
                if (await queueBatchPreviewDirectory(parentHandle)) {
                    addedCount++;
                }

                for await (const entry of parentHandle.values()) {
                    if (entry.kind !== 'directory') continue;
                    scannedCount++;
                    updateBatchPreviewUi(`Scanning ${entry.name}...`);
                    if (await queueBatchPreviewDirectory(entry)) {
                        addedCount++;
                    }
                    await new Promise(resolve => setTimeout(resolve, 0));
                }

                updateBatchPreviewUi(`Added ${addedCount}/${scannedCount} source folders from ${parentHandle.name}.`);
            } catch (error) {
                if (error && error.name !== 'AbortError') {
                    console.error(error);
                    updateBatchPreviewUi('Could not scan that parent folder.');
                }
            }
        }

        function requestBatchPreviewCancel() {
            if (!isBatchPreviewRunning) return;
            batchPreviewCancelRequested = true;
            if (isProcessing) {
                requestProcessingCancel();
            }
            updateBatchPreviewUi('Stopping batch...');
        }

        async function savePreviewImageForDirectory(directoryHandle, filename = 'preview.png') {
            setPreviewExportBusy(true);
            try {
                const blob = await renderDisplayVolumePreviewBlob();
                return await writePreviewImageToDirectory(directoryHandle, blob, filename);
            } finally {
                setPreviewExportBusy(false);
            }
        }

        async function getBatchPreviewJobs() {
            const jobs = [];

            for (const item of batchPreviewQueue) {
                const files = await getFilesFromDirectory(item.handle);
                const folderJobs = getBatchPreviewJobsForFiles(files, item.handle, item.name);
                folderJobs.forEach(job => {
                    jobs.push({
                        ...job,
                        folderName: item.name
                    });
                });
            }

            return jobs;
        }

        async function processBatchPreviewJob(job, options = {}) {

            if (job.type === 'sequence') {
                return await processImageSequenceSource(job.files, job.metadataFile, { ...options, directoryHandle: job.directoryHandle });
            }

            return await processVideoSource(job.files[0], { ...options, directoryHandle: job.directoryHandle, metadataFile: job.metadataFile });
        }

        function captureBatchPreviewSettings() {
            return {
                frameCount: parseInt(inputs.count.value),
                trimStart: parseFloat(trimStartInput.value),
                trimEnd: parseFloat(trimEndInput.value)
            };
        }

        function applyBatchPreviewSettings(settings) {
            if (!settings) return;

            if (Number.isFinite(settings.frameCount)) {
                inputs.count.value = settings.frameCount;
                displays.count.value = settings.frameCount;
            }

            if (Number.isFinite(settings.trimStart)) {
                trimStartInput.value = settings.trimStart;
            }
            if (Number.isFinite(settings.trimEnd)) {
                trimEndInput.value = settings.trimEnd;
            }
            updateTrimLabel();
        }

        async function runBatchPreviewQueue(options = {}) {
            if (isBatchPreviewRunning || isProcessing || isExportingPreviewImage) return;
            if (batchPreviewQueue.length === 0 && !options.jobs?.length) {
                alert('Add one or more source folders before running a batch.');
                return;
            }

            let completedCount = 0;
            let failedCount = 0;
            let totalCount = 0;
            let preparationError = null;
            batchPreviewResults = [];
            isBatchPreviewRunning = true;
            batchPreviewCancelRequested = false;
            updateInteractionState();
            updateBatchPreviewUi('Reading queued folders...');

            try {
                const jobs = options.jobs || await getBatchPreviewJobs();
                batchPreviewResults = jobs.map(job => ({ job, status: 'queued', error: '' }));
                updateBatchResults();
                totalCount = jobs.length;
                const batchSettings = captureBatchPreviewSettings();
                for (let i = 0; i < jobs.length; i++) {
                    if (batchPreviewCancelRequested) break;

                    const job = jobs[i];
                    const result = batchPreviewResults[i];
                    result.status = 'loading';
                    updateBatchResults();
                    const label = `Batch ${i + 1}/${totalCount}: ${job.name}`;
                    updateBatchPreviewUi(`${label} - loading`);
                    applyBatchPreviewSettings(batchSettings);

                    try {
                        const loaded = await processBatchPreviewJob(job, {
                            preserveFrameCount: true,
                            preserveTrim: true,
                            preserveGeometry: false
                        });
                        if (!loaded) {
                            if (batchPreviewCancelRequested) { result.status = 'cancelled'; break; }
                            failedCount++;
                            result.status = 'failed';
                            result.error = statusText.textContent;
                            updateBatchPreviewUi(`${label} - skipped`);
                            await new Promise(resolve => setTimeout(resolve, 0));
                            continue;
                        }

                        if (batchPreviewCancelRequested) break;

                        updateBatchPreviewUi(`${label} - saving preview`);
                        statusContainer.classList.remove('hidden');
                        statusText.textContent = 'SAVING PREVIEW...';
                        progressText.textContent = '100%';
                        progressBar.style.width = '100%';

                        const saved = await savePreviewImageForDirectory(job.directoryHandle, job.outputFilename);
                        if (saved) {
                            result.status = 'saved';
                            completedCount++;
                            updateBatchPreviewUi(`Saved ${completedCount}/${totalCount}: ${job.outputFilename}`);
                        } else {
                            result.status = 'failed';
                            result.error = 'Write permission denied.';
                            failedCount++;
                            updateBatchPreviewUi(`${label} - permission denied`);
                        }
                    } catch (error) {
                        result.status = 'failed';
                        result.error = error.message;
                        failedCount++;
                        console.error(`Could not export ${job.name}:`, error);
                        updateBatchPreviewUi(`${label} - failed: ${error.message}`);
                    }

                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            } catch (error) {
                preparationError = error;
                console.error(error);
            } finally {
                const canceled = batchPreviewCancelRequested;
                batchPreviewResults.forEach(result => {
                    if (result.status === 'queued' || result.status === 'loading') result.status = canceled ? 'cancelled' : 'failed';
                });
                isBatchPreviewRunning = false;
                batchPreviewCancelRequested = false;
                updateInteractionState();
                updateBatchPreviewUi(preparationError
                    ? `Batch failed: ${preparationError.message}`
                    : totalCount === 0
                    ? 'No supported sources found in the queued folders.'
                    : canceled
                    ? `Batch stopped after ${completedCount}/${totalCount}.`
                    : `Batch complete: ${completedCount}/${totalCount} saved${failedCount ? `, ${failedCount} failed` : ''}.`);
            }
        }

