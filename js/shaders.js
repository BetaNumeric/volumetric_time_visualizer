        // --- Shaders ---
        const vertexShader = `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;

        const fragmentShader = `
            uniform sampler2D map;
            uniform float globalOpacity;
            uniform float threshold;
            uniform float brightThreshold;
            varying vec2 vUv;

            void main() {
                vec4 texColor = texture2D(map, vUv);
                
                float alphaMap = 1.0;
                float luminance = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
                
                if (threshold > 0.01) {
                     alphaMap *= smoothstep(threshold, threshold + 0.15, luminance);
                }

                if (brightThreshold < 0.99) {
                    float alphaBright = 1.0 - smoothstep(brightThreshold - 0.15, brightThreshold, luminance);
                    alphaMap *= alphaBright;
                }
                
                gl_FragColor = vec4(texColor.rgb, texColor.a * globalOpacity * alphaMap);
            }
        `;

        const exposureDisplayFragmentShader = `
            uniform sampler2D map;
            uniform float linearOutput;
            varying vec2 vUv;

            void main() {
                vec4 exposure = texture2D(map, vUv);
                vec3 mapped = vec3(1.0) - exp(-exposure.rgb);
                mapped = linearOutput > 0.5
                    ? mix(12.92 * mapped, 1.055 * pow(mapped, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), mapped))
                    : pow(mapped, vec3(1.0 / 2.2));
                gl_FragColor = vec4(mapped, 1.0);
            }
        `;

        const exposureFragmentShader = fragmentShader
            .replace('uniform float globalOpacity;', 'uniform float globalOpacity; uniform float linearLight;')
            .replace('gl_FragColor = vec4(texColor.rgb,', `vec3 color = linearLight > 0.5
                ? mix(texColor.rgb / 12.92, pow((texColor.rgb + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), texColor.rgb))
                : texColor.rgb;
                gl_FragColor = vec4(color,`);

        const scannerFragmentShader = fragmentShader
            .replace('uniform sampler2D map;', 'uniform sampler2D map; uniform sampler2D mapNext; uniform float mixFactor;')
            .replace('texture2D(map, vUv);', 'mix(texture2D(map, vUv), texture2D(mapNext, vUv), mixFactor);');

