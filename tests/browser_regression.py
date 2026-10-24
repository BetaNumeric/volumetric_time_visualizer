"""Run with Python + Playwright; uses Chrome/Edge or Playwright's Chromium.

External requests are blocked. Source folders are read only; batch writes are
mocked. Optional examples/ media is tested when present.
"""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def passed(name, details=None):
    print('PASS', name, json.dumps(details) if details is not None else '', flush=True)


with sync_playwright() as playwright:
    candidates = [os.environ.get('CHROME_PATH'),
                  r'C:\Program Files\Google\Chrome\Application\chrome.exe',
                  r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe']
    executable = next((path for path in candidates if path and Path(path).exists()), None)
    engine = os.environ.get('BROWSER_ENGINE', 'chromium')
    browser = getattr(playwright, engine).launch(headless=True, **({'executable_path': executable} if executable and engine == 'chromium' else {}))
    context = browser.new_context(viewport={'width': 640, 'height': 360})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    external_requests = []
    def block_external(route):
        external_requests.append(route.request.url)
        route.abort()
    context.route('https://**/*', block_external)
    context.route('http://**/*', block_external)
    page.goto((ROOT / 'index.html').as_uri(), wait_until='load')
    assert not external_requests, external_requests
    assert page.evaluate('renderer.getContext().getContextAttributes().preserveDrawingBuffer') is False
    passed('offline startup with a discardable default framebuffer')
    page.evaluate('''window.makeTestFiles = async (count, color='white') => {
        const c=document.createElement('canvas'); c.width=64;c.height=36;
        const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,64,36);
        const blob=await new Promise(r=>c.toBlob(r,'image/png'));
        return Array.from({length:count},(_,i)=>new File([blob],`frame${String(i).padStart(4,'0')}.png`,
            {type:'image/png',lastModified:1}));
    };''')
    loaded = page.evaluate('''async()=>{
        resolutionSelect.value='400';window.testFiles=await makeTestFiles(30);
        window.testMetadata=new File([JSON.stringify({volume_height_cm:30,start_cm:10,name:'Keep me',outside_playback:'hold'})],
            'sequence.json',{type:'application/json',lastModified:1});
        const ok=await processImageSequenceSource(testFiles,testMetadata);
        return {ok,count:frameMeshes.length,height:sourceGeometry.volumeHeightCm,start:sourceGeometry.startCm};
    }''')
    assert loaded['ok'] and loaded['count'] == 30 and abs(loaded['height'] - 30) < 1e-9
    assert loaded['start'] == 10
    passed('sequence import and controller aliases', loaded)

    page.evaluate('''()=>{
        applySpacingFromControl(0.5);sourceGeometry.alignment='center';applyAlignmentToGeometry();
        updateSpacing(sourceGeometry.spacingCm);inputs.count.value='15';
    }''')
    page.locator('#regenerateBtn').click()
    page.wait_for_function('!isProcessing && frameMeshes.length === 15')
    geometry = page.evaluate('({geometry:{...sourceGeometry},json:getSequenceJsonPayload()})')
    assert geometry['geometry']['alignment'] == 'center'
    assert abs(geometry['geometry']['volumeHeightCm'] - 14.5) < 1e-9
    assert geometry['geometry']['startCm'] == 16.75
    assert geometry['json']['name'] == 'Keep me' and geometry['json']['outside_playback'] == 'hold'
    assert geometry['json']['volume_height_cm'] == geometry['json']['height_cm'] == 14.5
    passed('regeneration preserves edited geometry and metadata', geometry)

    timing = page.evaluate('''()=>{
        fpsSelect.value='60';fpsSelect.dispatchEvent(new Event('change'));
        playback.mode='scan';playback.isPlaying=true;playback.loop=false;playback.currentIndex=0;playback.direction=1;
        const now=performance.now();playback.lastTime=now-100;animate(now);playback.isPlaying=false;
        const index=playback.currentIndex;playback.mode='static';updateVisibility();
        return {index,duration:stackGenParams.duration,visible:frameMeshes.filter(m=>m.visible).length};
    }''')
    assert abs(timing['index'] - 2.8) < 1e-6 and timing['duration'] == 0.5 and timing['visible'] == 15
    passed('FPS retiming and source-duration playback', timing)

    trim = page.evaluate('''async()=>{
        trimStartInput.value='0.25';trimEndInput.value='0.5';updateVisibility();
        const before=frameMeshes.filter(m=>m.visible).length;const original=renderer.render;let exported;
        renderer.render=function(s,c){if(s===scene)exported=frameMeshes.filter(m=>m.visible).length;return original.call(this,s,c)};
        try{const blob=await renderDisplayVolumePreviewBlob();return {before,exported,bytes:blob.size}}
        finally{renderer.render=original}
    }''')
    assert 0 < trim['before'] < 15 and trim['before'] == trim['exported'] and trim['bytes'] > 0
    passed('PNG export respects trim', trim)

    exposure = page.evaluate('''async()=>{
        await processImageSequenceSource(await makeTestFiles(3,'rgb(32,32,32)'),null,{preserveGeometry:false});
        inputs.opacity.value='0.3';inputs.threshold.value='0';inputs.brightThreshold.value='1';setTopDownOrthographicView();
        const pixels=[];
        for(const samples of [1,30,60]){
            inputs.exposureSamples.value=String(samples);if(!await bakeExposure())throw new Error(statusText.textContent);
            renderExposureView();const gl=renderer.getContext();const pixel=new Uint8Array(4);
            gl.readPixels(320,180,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);pixels.push(pixel[0]);
        }
        await processImageSequenceSource(await makeTestFiles(1));setTopDownOrthographicView();const single=[];
        for(const samples of [1,30]){inputs.exposureSamples.value=String(samples);await bakeExposure();renderExposureView();
            const gl=renderer.getContext();const pixel=new Uint8Array(4);gl.readPixels(320,180,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);single.push(pixel[0]);}
        return {pixels,single};
    }''')
    assert min(exposure['pixels']) > 0 and max(exposure['pixels']) - min(exposure['pixels']) <= 3
    assert min(exposure['single']) > 0 and abs(exposure['single'][0] - exposure['single'][1]) <= 1
    passed('floating-point exposure preserves detail and single-frame brightness', exposure)

    cancellation = page.evaluate('''async()=>{
        await processImageSequenceSource(await makeTestFiles(3));setTopDownOrthographicView();inputs.exposureSamples.value='60';
        const original=renderer.render;
        renderer.render=function(s,c){const r=original.call(this,s,c);const start=performance.now();while(performance.now()-start<1){}return r};
        setTimeout(requestProcessingCancel,0);
        try{const done=await bakeExposure();return {done,busy:isProcessing||isBakingExposure,target:renderer.getRenderTarget(),enabled:controls.enabled,status:exposureStatus.textContent}}
        finally{renderer.render=original}
    }''')
    assert not cancellation['done'] and not cancellation['busy'] and cancellation['target'] is None
    assert cancellation['enabled'] and cancellation['status'] == 'BAKE CANCELLED'
    passed('bake cancellation restores renderer and controls', cancellation)

    unsupported = page.evaluate('''async()=>{
        const original=renderer.extensions.has;renderer.extensions.has=()=>false;
        try{const done=await bakeExposure();return {done,busy:isProcessing||isBakingExposure,message:statusText.textContent}}
        finally{renderer.extensions.has=original}
    }''')
    assert not unsupported['done'] and not unsupported['busy'] and 'floating-point' in unsupported['message']
    passed('unsupported exposure hardware reports a recoverable error')

    batch = page.evaluate('''async()=>{
        const get=getBatchPreviewJobs,process=processBatchPreviewJob,save=savePreviewImageForDirectory;const attempted=[];
        batchPreviewQueue=[{name:'fake',handle:{}}];
        getBatchPreviewJobs=async()=>[{name:'first',outputFilename:'a.png'},{name:'second',outputFilename:'b.png'}];
        processBatchPreviewJob=async job=>{attempted.push(job.name);return true};
        savePreviewImageForDirectory=async(_,name)=>{if(name==='a.png')throw new Error('Simulated write failure');return true};
        try{await runBatchPreviewQueue();const status=batchPreviewStatus.textContent;
            getBatchPreviewJobs=async()=>{throw new Error('Simulated unreadable directory')};await runBatchPreviewQueue();
            return {attempted,status,preflight:batchPreviewStatus.textContent,locked:isBatchPreviewRunning}}
        finally{getBatchPreviewJobs=get;processBatchPreviewJob=process;savePreviewImageForDirectory=save;batchPreviewQueue=[];updateBatchPreviewUi()}
    }''')
    assert batch['attempted'] == ['first', 'second'] and '1/2 saved, 1 failed' in batch['status']
    assert batch['preflight'].startswith('Batch failed:') and not batch['locked']
    passed('batch continues after write failures and reports preflight failures', batch)

    page.evaluate("playback.mode='static';playback.isPlaying=false;markExposureDirty();requestRender()")
    page.wait_for_timeout(150)
    before = page.evaluate('renderer.info.render.frame')
    page.wait_for_timeout(150)
    assert page.evaluate('renderer.info.render.frame') == before
    passed('static views stop rendering while idle')

    page.set_viewport_size({'width': 320, 'height': 568})
    page.wait_for_function('mainPanel.getBoundingClientRect().right <= innerWidth')
    page.set_viewport_size({'width': 640, 'height': 360})
    passed('settings panel fits narrow screens')

    rollback = page.evaluate('''async()=>{
        playback.mode='static';playback.isPlaying=false;
        const before={group:stackGroup,signature:currentSourceSignature,height:sourceGeometry.volumeHeightCm,
            count:frameMeshes.length,trim:trimEndInput.value};
        const bad=new File(['broken image'],'bad.png',{type:'image/png'});
        const ok=await processImageSequenceSource([bad]);
        const failedKept=stackGroup===before.group && currentSourceSignature===before.signature
            && frameMeshes.length===before.count && sourceGeometry.volumeHeightCm===before.height;
        const original=loadDrawableFromImageFile;
        loadDrawableFromImageFile=async file=>{await new Promise(r=>setTimeout(r,20));return original(file)};
        const files=await makeTestFiles(4);
        let cancelled;
        try{const pending=processImageSequenceSource(files);setTimeout(requestProcessingCancel,5);cancelled=await pending}
        finally{loadDrawableFromImageFile=original}
        return {ok,cancelled,failedKept,cancelKept:stackGroup===before.group&&currentSourceSignature===before.signature,
            busy:isProcessing,trimRestored:trimEndInput.value===before.trim};
    }''')
    assert not rollback['ok'] and not rollback['cancelled'] and rollback['failedKept'] and rollback['cancelKept']
    assert not rollback['busy'] and rollback['trimRestored']
    passed('failed and cancelled replacements keep the working stack', rollback)

    page.evaluate('''()=>{
        inputs.opacity.value='0.42';inputs.opacity.dispatchEvent(new Event('input',{bubbles:true}));
        document.getElementById('presetName').value='Test preset';document.getElementById('savePresetBtn').click();
        inputs.opacity.value='0.1';inputs.opacity.dispatchEvent(new Event('input',{bubbles:true}));
        document.getElementById('applyPresetBtn').click();VolumeSettings.save();
    }''')
    assert page.evaluate('inputs.opacity.value') == '0.42'
    other = page.context.new_page()
    other.goto((ROOT / 'index.html').as_uri(), wait_until='load')
    assert other.evaluate('inputs.opacity.value') == '0.42'
    assert 'Test preset' in other.locator('#presetSelect').text_content(), other.evaluate(
        '({names:VolumeSettings.names(),options:document.getElementById("presetSelect").textContent})')
    other.close()
    storage = page.evaluate('''()=>{
        const descriptor=Object.getOwnPropertyDescriptor(window,'localStorage');
        Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new Error('Storage blocked')}});
        try{return VolumeSettings.save()}finally{Object.defineProperty(window,'localStorage',descriptor)}
    }''')
    assert storage is False
    passed('presets survive reload and blocked storage is recoverable')

    trails = page.evaluate('''async()=>{
        const red=(await makeTestFiles(1,'red'))[0],blue=(await makeTestFiles(1,'blue'))[0];
        await processImageSequenceSource([red,new File([blue],'frame0001.png',{type:'image/png',lastModified:1})]);
        inputs.opacity.value='1';inputs.opacity.dispatchEvent(new Event('input'));
        inputs.threshold.value='0';inputs.threshold.dispatchEvent(new Event('input'));
        setTopDownOrthographicView();boxToggle.checked=false;updateTravelCuboidVisibility();
        playback.mode='scan';playback.isPlaying=false;smoothToggle.checked=false;lightPaintToggle.checked=true;
        const pixel=()=>{const a=new Uint8Array(4);renderer.readRenderTargetPixels(viewportTrail.target,320,180,1,1,a);return Array.from(a)};
        playback.currentIndex=0;updateVisibility();viewportTrail.invalidate();animate(performance.now());const first=pixel();
        playback.currentIndex=1;updateVisibility();animate(performance.now());const second=pixel();
        animate(performance.now());const repeated=pixel();
        lightPaintToggle.checked=false;smoothToggle.checked=true;playback.currentIndex=0.5;
        document.getElementById('interpolateToggle').checked=true;updateVisibility();animate(performance.now());
        const a=new Uint8Array(4);const gl=renderer.getContext();gl.readPixels(320,180,1,1,gl.RGBA,gl.UNSIGNED_BYTE,a);
        playback.mode='static';smoothToggle.checked=false;updateVisibility();markExposureDirty();
        return {first,second,repeated,interpolated:Array.from(a)};
    }''')
    assert trails['first'][0] > 240 and trails['first'][2] < 5
    assert trails['second'][2] > 240 and trails['second'] == trails['repeated']
    assert abs(trails['interpolated'][0] - 128) <= 3 and abs(trails['interpolated'][2] - 128) <= 3
    passed('offscreen trails retain samples and interpolation blends adjacent slices', trails)

    linear = page.evaluate('''async()=>{
        const result=[];inputs.opacity.value='0.3';inputs.threshold.value='0';
        document.getElementById('exposureModel').value='linear';document.getElementById('exposureDuration').value='2';
        for(const count of [3,6]) {
            await processImageSequenceSource(await makeTestFiles(count,'rgb(128,128,128)'));
            setTopDownOrthographicView();inputs.exposureSamples.value='30';
            if(!await bakeExposure())throw new Error(statusText.textContent);
            renderExposureView();const gl=renderer.getContext();const a=new Uint8Array(4);
            gl.readPixels(320,180,1,1,gl.RGBA,gl.UNSIGNED_BYTE,a);result.push(a[0]);
        }
        document.getElementById('exposureModel').value='artistic';document.getElementById('exposureDuration').value='0';
        return result;
    }''')
    import math
    energy = (((128/255 + 0.055)/1.055)**2.4) * 0.3 * 2
    expected = round(255 * (1.055 * (1-math.exp(-energy))**(1/2.4) - 0.055))
    assert all(abs(value-expected) <= 3 for value in linear), (linear, expected)
    assert abs(linear[0]-linear[1]) <= 2
    passed('linear-light exposure matches analytic integration across frame counts', {'pixels': linear, 'expected': expected})

    reset = page.evaluate('''()=>{
        applySpacingFromControl(0.1);document.getElementById('resetGeometryBtn').click();
        return sourceGeometry.volumeHeightCm;
    }''')
    assert abs(reset-48) < 1e-6
    passed('explicit geometry reset restores source placement')

    retry = page.evaluate('''async()=>{
        const get=getBatchPreviewJobs,process=processBatchPreviewJob,save=savePreviewImageForDirectory;
        const seen=[];let fail=true;batchPreviewQueue=[{name:'mock',handle:{}}];
        getBatchPreviewJobs=async()=>[{name:'first',outputFilename:'a.png'},{name:'second',outputFilename:'b.png'}];
        processBatchPreviewJob=async job=>{seen.push(job.name);return true};
        savePreviewImageForDirectory=async(_,name)=>{if(fail&&name==='a.png')throw new Error('Permission revoked');return true};
        try{await runBatchPreviewQueue();const text=document.getElementById('batchResults').textContent;
            const jobs=batchPreviewResults.filter(r=>r.status==='failed').map(r=>r.job);fail=false;await runBatchPreviewQueue({jobs});
            return {seen,text,status:batchPreviewStatus.textContent}}
        finally{getBatchPreviewJobs=get;processBatchPreviewJob=process;savePreviewImageForDirectory=save;batchPreviewQueue=[];updateBatchPreviewUi()}
    }''')
    assert retry['seen'] == ['first','second','first'] and 'Permission revoked' in retry['text']
    assert '1/1 saved' in retry['status']
    passed('batch retries only failed jobs after a permission error', retry)

    # Exercise the browser's actual context-loss lifecycle with a retained stack.
    page.evaluate('''()=>{
        window.expectedFrames=frameMeshes.length;
        const extension=renderer.getContext().getExtension('WEBGL_lose_context');
        if(!extension)throw new Error('Context-loss test extension unavailable');
        extension.loseContext();setTimeout(()=>extension.restoreContext(),150);
    }''')
    page.wait_for_function('!graphicsContextLost && statusText.textContent.startsWith("Graphics recovered")', timeout=10000)
    assert page.evaluate('frameMeshes.length===expectedFrames')
    passed('graphics context recovers without losing loaded frames')

    quality = page.evaluate('''async()=>{
        resolutionSelect.value='800';
        const canvas=document.createElement('canvas');canvas.width=800;canvas.height=450;
        const ctx=canvas.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,800,450);
        ctx.fillStyle='white';for(let x=0;x<800;x+=2)ctx.fillRect(x,0,1,450);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        const files=Array.from({length:750},(_,i)=>new File([blob],`detail${String(i).padStart(4,'0')}.png`,
            {type:'image/png',lastModified:1}));
        if(!await processImageSequenceSource(files))throw new Error(statusText.textContent);
        const images=frameMeshes.map(mesh=>mesh.material.uniforms.map.value.image);
        const row=images[749].getContext('2d').getImageData(0,0,4,1).data;
        exposurePreviewVisible=false;playback.mode='static';updateVisibility();
        renderer.render(scene,activeCamera);renderer.getContext().finish();
        return {count:images.length,fullResolution:images.every(image=>image.width===800&&image.height===450),
            detail:[row[0],row[4],row[8],row[12]],memory:document.getElementById('memoryEstimate').textContent};
    }''')
    assert quality['count'] == 750 and quality['fullResolution']
    assert quality['detail'] == [255, 0, 255, 0], quality
    passed('750-frame Medium stack preserves resolution and single-pixel detail', quality)

    meander = ROOT / 'meander_test.mp4'
    if meander.exists():
        page.evaluate("resolutionSelect.value='400';fpsSelect.value='30';inputs.count.value='300'")
        page.locator('#videoInput').set_input_files(str(meander))
        page.wait_for_function('!isProcessing', timeout=60000)
        if page.evaluate("statusText.textContent.includes('not supported by this browser')"):
            assert page.evaluate("frameMeshes.length===750 && currentSourceType==='sequence'")
            passed('unsupported meander codec retains the previous stack', {'engine': engine})
        else:
            page.evaluate('''window.videoFrameStats=()=>{
                const hashes=frameMeshes.map(mesh=>{
                    const image=mesh.material.uniforms.map.value.image;
                    const pixels=image.getContext('2d').getImageData(0,0,image.width,image.height).data;
                    let hash=2166136261;
                    for(const value of pixels)hash=Math.imul(hash^value,16777619);
                    return hash>>>0;
                });
                return {frames:hashes.length,unique:new Set(hashes).size,duration:currentSourceDuration,
                    source:currentVideoFile?.name};
            }''')
            result = page.evaluate('videoFrameStats()')
            assert result['frames'] == result['unique'] == 300, result
            assert result['duration'] == 10 and result['source'] == 'meander_test.mp4'
            passed('meander MP4 imports all 300 distinct frames with its missing seek index repaired', result)
            result = page.evaluate('''async()=>{
                applyTrimValues(0.2,1.2,10);inputs.count.value='30';
                if(!await processVideoSource(currentVideoFile))throw new Error(statusText.textContent);
                return {...videoFrameStats(),start:stackGenParams.start,duration:stackGenParams.duration};
            }''')
            assert result['frames'] == result['unique'] == 30, result
            assert abs(result['start'] - 0.2) < 1e-6 and abs(result['duration'] - 1) < 1e-6
            passed('trimmed video regeneration preserves distinct frames between keyframes', result)

    video = ROOT / 'examples' / 'particle_sim_rectangle.mp4'
    if video.exists():
        page.evaluate("inputs.count.max='2048';inputs.count.value='4'")
        page.locator('#videoInput').set_input_files(str(video))
        page.wait_for_function('!isProcessing', timeout=60000)
        if page.evaluate("statusText.textContent.includes('not supported by this browser')"):
            assert page.evaluate("frameMeshes.length>0 && currentSourceType==='sequence'")
            passed('unsupported example video codec reports an error and retains the stack', {'engine':engine})
        else:
            result = page.evaluate('''async()=>{
                const metadata=new File([JSON.stringify({height_cm:20,start_cm:12})],'particle_sim_rectangle.json',{type:'application/json'});
                const selected=getSelectedSource([currentVideoFile,metadata]);
                const ok=await processVideoSource(currentVideoFile,{metadataFile:selected.metadataFile});
                return {ok,height:sourceGeometry.volumeHeightCm,start:sourceGeometry.startCm,name:getMetadataFilename(),canExport:!exportSequenceJsonBtn.disabled};
            }''')
            assert result['ok'] and result['canExport'] and result['start'] == 12 and abs(result['height'] - 20) < 1e-9
            assert result['name'] == 'particle_sim_rectangle.json'
            passed('real video import and sidecar metadata', result)

    sequence = ROOT / 'examples' / 'klein_bottle'
    if sequence.exists():
        files = sorted(sequence.glob('klein_bottle_frame_*.png')) + [sequence / 'sequence.json']
        page.evaluate("resolutionSelect.value='800'")
        page.locator('#videoInput').set_input_files([str(file) for file in files])
        page.wait_for_function("!isProcessing && currentSourceType === 'sequence' && frameMeshes.length > 30", timeout=60000)
        result = page.evaluate('''()=>({count:frameMeshes.length,width:frameMeshes[0].material.uniforms.map.value.image.width,
            textureHeight:frameMeshes[0].material.uniforms.map.value.image.height,
            height:sourceGeometry.volumeHeightCm,start:sourceGeometry.startCm,memory:document.getElementById('memoryEstimate').textContent})''')
        assert result['count'] == len(files)-1 and result['width'] == 800 and result['textureHeight'] == 450
        assert abs(result['height'] - 47.55) < 1e-6 and abs(result['start'] - 0.23) < 1e-6
        passed('full example sequence retains Medium resolution', result)

        profile = page.evaluate('''()=>{
            exposurePreviewVisible=false;playback.mode='static';updateVisibility();
            const gl=renderer.getContext();const times=[];
            renderer.render(scene,activeCamera);gl.finish();
            for(let i=0;i<3;i++){const start=performance.now();renderer.render(scene,activeCamera);gl.finish();times.push(performance.now()-start)}
            times.sort((a,b)=>a-b);
            return {frames:frameMeshes.length,drawCalls:renderer.info.render.calls,medianFrameMs:times[1],
                webgl2:renderer.capabilities.isWebGL2,arrayLayers:renderer.capabilities.isWebGL2?gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS):0,
                texturePlanMiB:Math.round(getFrameTexturePlan(frameMeshes.length).estimatedBytes/1048576)};
        }''')
        passed('headless rendering profile (not a device benchmark)', profile)

    assert not errors, errors
    passed('no uncaught browser errors')
    if os.environ.get('VISUAL_REVIEW_PATH'):
        artifact = Path(os.environ['VISUAL_REVIEW_PATH'])
        page.set_viewport_size({'width': 1280, 'height': 900})
        page.screenshot(path=str(artifact))
        page.set_viewport_size({'width': 320, 'height': 720})
        page.wait_for_function('mainPanel.getBoundingClientRect().right <= innerWidth')
        page.screenshot(path=str(artifact.with_name(artifact.stem + '-mobile.png')))
    browser.close()
