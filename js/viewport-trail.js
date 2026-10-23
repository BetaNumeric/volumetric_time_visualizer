/* Owns accumulation independently of the browser's default framebuffer. */
class ViewportTrail {
    constructor(renderer) {
        this.renderer = renderer;
        this.target = null;
        this.dirty = true;
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
        this.camera.position.z = 1;
        this.material = new THREE.ShaderMaterial({
            uniforms: { map: { value: null } }, depthTest: false, depthWrite: false,
            vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.0);}',
            fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main(){gl_FragColor=texture2D(map,vUv);}'
        });
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
        this.scene.add(this.quad);
    }
    invalidate() { this.dirty = true; }
    render(scene, camera, guide, sampleKey) {
        const renderer = this.renderer;
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        if (!this.target || this.target.width !== size.x || this.target.height !== size.y) {
            this.target?.dispose();
            this.target = new THREE.WebGLRenderTarget(size.x, size.y, { depthBuffer: false, stencilBuffer: false });
            this.material.uniforms.map.value = this.target.texture;
            this.dirty = true;
        }
        const previous = { target: renderer.getRenderTarget(), autoClear: renderer.autoClear,
            color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(),
            background: scene.background, guide: guide?.visible };
        try {
            scene.background = null;
            if (guide) guide.visible = false;
            renderer.setRenderTarget(this.target);
            renderer.autoClear = false;
            const addSample = this.dirty || sampleKey !== this.lastSampleKey;
            if (this.dirty) {
                renderer.setClearColor(0x000000, 1);
                renderer.clear();
                this.dirty = false;
            }
            if (addSample) {
                renderer.render(scene, camera);
                this.lastSampleKey = sampleKey;
            }
            renderer.setRenderTarget(previous.target);
            renderer.autoClear = true;
            renderer.render(this.scene, this.camera);
            // Draw the volume guide once, without burning it into the trail.
            if (guide && previous.guide) {
                const visibility = scene.children.map(child => child.visible);
                try {
                    scene.children.forEach(child => { child.visible = child === guide; });
                    renderer.autoClear = false;
                    renderer.render(scene, camera);
                } finally {
                    scene.children.forEach((child, index) => { child.visible = visibility[index]; });
                }
            }
        } finally {
            if (guide) guide.visible = previous.guide;
            scene.background = previous.background;
            renderer.setRenderTarget(previous.target);
            renderer.setClearColor(previous.color, previous.alpha);
            renderer.autoClear = previous.autoClear;
        }
    }
    dispose() {
        this.target?.dispose();
        this.target = null;
        this.material.uniforms.map.value = null;
        this.dirty = true;
    }
}
