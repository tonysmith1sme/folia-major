import React, { useEffect, useRef } from 'react';
import * as twgl from 'twgl.js';
import { type MotionValue } from 'framer-motion';
import { type Theme, type AudioBands, type CieloTuning } from '../../../types';
import { colorWithAlpha } from '../colorMix';

interface CieloBackgroundProps {
    currentTime: MotionValue<number>;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    theme: Theme;
    coverColors?: string[];
    tuning: CieloTuning;
}

const vertexShader = `
    attribute vec2 position;
    varying vec2 vUv;
    void main() {
        vUv = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
    }
`;

const fragmentShader = `
    precision highp float;
    
    uniform vec2 u_resolution;
    uniform float u_dpr;
    uniform float u_cameraY;
    uniform vec3 u_colorBg;
    uniform vec3 u_palette[6];
    uniform float u_audioPower;
    uniform float u_densityGeo;
    uniform float u_densityParticle;
    uniform float u_colorMix;
    
    varying vec2 vUv;

    vec3 getPaletteColor(float hash) {
        float h = fract(hash) * 6.0;
        if (h < 1.0) return u_palette[0];
        if (h < 2.0) return u_palette[1];
        if (h < 3.0) return u_palette[2];
        if (h < 4.0) return u_palette[3];
        if (h < 5.0) return u_palette[4];
        return u_palette[5];
    }

    // Hash functions
    float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
    }

    vec2 hash22(vec2 p) {
        float n = hash21(p);
        return vec2(n, hash21(p + n));
    }

    // 2D Rotation matrix
    mat2 rot(float a) {
        float s = sin(a), c = cos(a);
        return mat2(c, -s, s, c);
    }

    // SDF for Rhombus (Diamond/Kite)
    float ndot(vec2 a, vec2 b) { return a.x*b.x - a.y*b.y; }
    float sdRhombus( in vec2 p, in vec2 b ) {
        p = abs(p);
        float h = clamp( ndot(b-2.0*p,b)/dot(b,b), -1.0, 1.0 );
        float d = length( p-0.5*b*vec2(1.0-h,1.0+h) );
        return d * sign( p.x*b.y + p.y*b.x - b.x*b.y );
    }

    void main() {
        // World coordinates in CSS pixels (1:1 with DOM)
        vec2 cssResolution = u_resolution / u_dpr;
        vec2 cssFragCoord = gl_FragCoord.xy / u_dpr;
        
        // Origin top-left to match DOM
        float screenY = cssResolution.y - cssFragCoord.y;
        vec2 worldPos = vec2(cssFragCoord.x, screenY + u_cameraY);
        
        // Base background color
        vec3 col = mix(u_colorBg, u_palette[0], u_colorMix * 0.1);

        // --- LAYER 1: Arcs (Thick and Thin) ---
        float gridC = 800.0;
        float aaC = 1.5 / gridC;
        vec2 cellC = worldPos / gridC;
        vec2 cellCId = floor(cellC);
        vec2 cellCUv = fract(cellC) - 0.5;
        
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 nOffset = vec2(float(x), float(y));
                vec2 nId = cellCId + nOffset;
                float hc = hash21(nId + 8.0);
                
                if (hc < 0.8 * u_densityGeo) {
                    vec2 localUv = cellCUv - nOffset;
                    localUv -= hash22(nId) - 0.5;
                    
                    float entrance = clamp((u_cameraY + cssResolution.y - nId.y * gridC) / (cssResolution.y * 0.5), 0.0, 1.0);
                    
                    float radius = 0.3 + hc * 1.5;
                    float dist = abs(length(localUv) - radius);
                    
                    // Mix of thick and thin arcs
                    float thickness = hc < 0.3 ? 0.02 : 0.003; 
                    
                    // Sweep
                    float angle = atan(localUv.y, localUv.x);
                    float sweep = smoothstep(-3.14, 3.14, angle);
                    
                    if (dist < thickness + aaC && sweep < entrance) {
                        float mask = smoothstep(thickness + aaC, thickness - aaC, dist);
                        // Colors: Palette based
                        vec3 cCol = getPaletteColor(hc * 13.0);
                        col = mix(col, cCol, mask * 0.9);
                    }
                }
            }
        }

        // --- LAYER 2: Solid Circles ---
        float gridS = 500.0;
        float aaS = 1.5 / gridS;
        vec2 cellS = worldPos / gridS;
        vec2 cellSId = floor(cellS);
        vec2 cellSUv = fract(cellS) - 0.5;
        
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 nOffset = vec2(float(x), float(y));
                vec2 nId = cellSId + nOffset;
                float hs = hash21(nId + 19.0);
                
                if (hs < 0.3 * u_densityGeo) {
                    vec2 localUv = cellSUv - nOffset;
                    localUv -= hash22(nId) - 0.5;
                    
                    // Removed entrance translation to lock shapes perfectly to the scrolling world grid
                    
                    float radius = 0.1 + hs * 0.1;
                    float dist = length(localUv) - radius;
                    
                    if (dist < aaS) {
                        float mask = smoothstep(aaS, -aaS, dist);
                        vec3 sCol = getPaletteColor(hs * 21.0);
                        col = mix(col, sCol, mask * 0.95);
                    }
                }
            }
        }

        // --- LAYER 3: Rhombus (Diamonds with center line) ---
        float gridT = 300.0;
        float aaT = 1.5 / gridT;
        vec2 cellT = worldPos / gridT;
        vec2 cellTId = floor(cellT);
        vec2 cellTUv = fract(cellT) - 0.5;
        
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 nOffset = vec2(float(x), float(y));
                vec2 nId = cellTId + nOffset;
                float ht = hash21(nId + 13.1);
                
                if (ht < 0.8 * u_densityParticle) {
                    vec2 localUv = cellTUv - nOffset;
                    localUv -= hash22(nId) - 0.5;
                    
                    // Fixed rotation (no continuous spinning)
                    float rotAngle = hash21(nId) * 6.28;
                    
                    // Pre-rotate UVs to local space of the rhombus
                    vec2 rotatedUv = localUv * rot(rotAngle);
                    
                    // Removed local translation to lock the shapes perfectly to the scrolling world grid
                    
                    // Rhombus size (width, height) - make them elongated diamonds
                    vec2 rbSize = vec2(0.1 + ht * 0.05, 0.2 + ht * 0.15);
                    
                    float d3 = sdRhombus(rotatedUv, rbSize);
                    
                    if (d3 < aaT) {
                        float triMask = smoothstep(aaT, -aaT, d3);
                        
                        // Pick color (White or Palette)
                        vec3 triCol = ht < 0.2 ? vec3(1.0) : getPaletteColor(ht * 17.0);
                        
                        // Center line slicing the diamond longitudinally (along Y axis of the rhombus)
                        float lineDist = abs(rotatedUv.x);
                        float lineThickness = 0.003;
                        float centerLineMask = smoothstep(lineThickness + aaT, lineThickness - aaT, lineDist);
                        
                        // Mix the center line color (Black) over the rhombus color
                        triCol = mix(triCol, vec3(0.0), centerLineMask);
                        
                        col = mix(col, triCol, triMask * 0.95);
                    }
                }
            }
        }

        // Output
        gl_FragColor = vec4(col, 1.0);
    }
`;

// Simple hex to RGB parser since we are omitting full colorMix for brevity
const parseHex = (hex: string) => {
    let raw = hex.trim();
    if (raw.startsWith('#')) raw = raw.slice(1);
    if (raw.length === 3) raw = raw.split('').map(c => c + c).join('');
    if (raw.length !== 6 && raw.length !== 8) return [0, 0, 0];
    const r = parseInt(raw.slice(0, 2), 16) / 255;
    const g = parseInt(raw.slice(2, 4), 16) / 255;
    const b = parseInt(raw.slice(4, 6), 16) / 255;
    return [r, g, b];
};

export const CieloBackground: React.FC<CieloBackgroundProps> = ({
    currentTime,
    audioPower,
    audioBands,
    theme,
    coverColors,
    tuning
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const gl = canvas.getContext('webgl');
        if (!gl) {
            console.warn('WebGL not supported');
            return;
        }

        // Setup twgl
        const programInfo = twgl.createProgramInfo(gl, [vertexShader, fragmentShader]);
        
        // A full-screen quad: 2 triangles
        const arrays = {
            position: {
                numComponents: 2,
                data: [
                    -1, -1,
                     1, -1,
                    -1,  1,
                    -1,  1,
                     1, -1,
                     1,  1,
                ],
            },
        };
        const bufferInfo = twgl.createBufferInfoFromArrays(gl, arrays);

        let rafId: number;

        const render = () => {
            const dpr = window.devicePixelRatio || 1.0;
            twgl.resizeCanvasToDisplaySize(canvas, dpr);
            gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

            gl.useProgram(programInfo.program);
            twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo);

            const parseHex = (hex: string) => {
                const c = colorWithAlpha(hex, 1).match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
                if (c) return [parseInt(c[1])/255, parseInt(c[2])/255, parseInt(c[3])/255];
                return [1, 1, 1];
            };
            
            const paletteFlat = new Float32Array(18);
            const fillPalette = (index: number, hexString: string) => {
                const c = parseHex(hexString || theme.primaryColor);
                paletteFlat[index * 3] = c[0];
                paletteFlat[index * 3 + 1] = c[1];
                paletteFlat[index * 3 + 2] = c[2];
            };
            fillPalette(0, theme.primaryColor);
            fillPalette(1, theme.secondaryColor);
            fillPalette(2, theme.accentColor);
            fillPalette(3, coverColors?.[0] || theme.primaryColor);
            fillPalette(4, coverColors?.[1] || theme.secondaryColor);
            fillPalette(5, coverColors?.[2] || theme.accentColor);

            const SCROLL_SPEED = 250 * tuning.cameraSpeed;
            const currentCameraY = currentTime.get() * SCROLL_SPEED;

            const uniforms = {
                u_resolution: [gl.canvas.width, gl.canvas.height],
                u_dpr: dpr,
                u_cameraY: currentCameraY,
                u_audioPower: audioPower.get(),
                u_colorBg: parseHex(theme.backgroundColor),
                u_palette: paletteFlat,
                u_densityGeo: tuning.geometricDensity,
                u_densityParticle: tuning.particleDensity,
                u_colorMix: tuning.baseColorMix,
            };

            twgl.setUniforms(programInfo, uniforms);
            twgl.drawBufferInfo(gl, bufferInfo);

            rafId = requestAnimationFrame(render);
        };

        rafId = requestAnimationFrame(render);

        return () => {
            cancelAnimationFrame(rafId);
            gl.deleteProgram(programInfo.program);
        };
    }, [audioPower, currentTime, theme.accentColor, theme.backgroundColor, theme.primaryColor, theme.secondaryColor, coverColors, tuning.baseColorMix, tuning.cameraSpeed, tuning.geometricDensity, tuning.particleDensity]);

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ display: 'block' }}
        />
    );
};

export default CieloBackground;
