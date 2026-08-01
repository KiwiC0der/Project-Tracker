import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/**
 * Scene 3 — animated dot-matrix backdrop for the auth screen.
 *
 * The source component loaded three.js from a CDN script tag; here it's a
 * normal bundled import, which keeps the page self-contained and avoids a
 * third-party network dependency at runtime.
 */
export function DotMatrixShader({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false })
    } catch {
      return
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setSize(window.innerWidth, window.innerHeight)

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    const uniforms = {
      u_time: { value: 0 },
      u_resolution: {
        value: new THREE.Vector2(window.innerWidth * 2, window.innerHeight * 2),
      },
      u_opacities: { value: [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1.0] },
      u_colors: {
        value: [
          new THREE.Vector3(0.49, 0.36, 1.0),
          new THREE.Vector3(0.65, 0.55, 1.0),
          new THREE.Vector3(0.85, 0.85, 0.95),
          new THREE.Vector3(0.49, 0.36, 1.0),
          new THREE.Vector3(0.65, 0.55, 1.0),
          new THREE.Vector3(1.0, 1.0, 1.0),
        ],
      },
      u_total_size: { value: 20.0 },
      u_dot_size: { value: 6.0 },
    }

    const material = new THREE.ShaderMaterial({
      vertexShader: `
        precision mediump float;
        uniform vec2 u_resolution;
        out vec2 fragCoord;
        void main() {
          gl_Position = vec4(position, 1.0);
          fragCoord = (position.xy + 1.0) * 0.5 * u_resolution;
          fragCoord.y = u_resolution.y - fragCoord.y;
        }
      `,
      fragmentShader: `
        precision mediump float;
        in vec2 fragCoord;

        uniform float u_time;
        uniform float u_opacities[10];
        uniform vec3 u_colors[6];
        uniform float u_total_size;
        uniform float u_dot_size;
        uniform vec2 u_resolution;

        out vec4 fragColor;

        float PHI = 1.61803398874989484820459;
        float random(vec2 xy) {
          return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x);
        }

        void main() {
          vec2 st = fragCoord.xy;
          st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));
          st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));

          float opacity = step(0.0, st.x) * step(0.0, st.y);

          vec2 st2 = vec2(int(st.x / u_total_size), int(st.y / u_total_size));

          float frequency = 5.0;
          float show_offset = random(st2);
          float rand = random(st2 * floor((u_time / frequency) + show_offset + frequency));
          opacity *= u_opacities[int(rand * 10.0)];
          opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
          opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));

          vec3 color = u_colors[int(show_offset * 6.0)];

          float animation_speed_factor = 3.0;
          vec2 center_grid = u_resolution / 2.0 / u_total_size;
          float dist_from_center = distance(center_grid, st2);

          float timing_offset_intro = dist_from_center * 0.01 + (random(st2) * 0.15);

          opacity *= step(timing_offset_intro, u_time * animation_speed_factor);
          opacity *= clamp(
            (1.0 - step(timing_offset_intro + 0.1, u_time * animation_speed_factor)) * 1.25,
            1.0, 1.25
          );

          fragColor = vec4(color, opacity);
          fragColor.rgb *= fragColor.a;
        }
      `,
      uniforms,
      glslVersion: THREE.GLSL3,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
      transparent: true,
    })

    const geometry = new THREE.PlaneGeometry(2, 2)
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    const start = performance.now()
    let frameId = 0
    let running = true

    const animate = () => {
      if (!running) return
      frameId = requestAnimationFrame(animate)
      uniforms.u_time.value = (performance.now() - start) / 1000
      renderer.render(scene, camera)
    }
    animate()

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight)
      uniforms.u_resolution.value.set(window.innerWidth * 2, window.innerHeight * 2)
    }

    const onVisibility = () => {
      if (document.hidden) {
        running = false
        cancelAnimationFrame(frameId)
      } else if (!running) {
        running = true
        animate()
      }
    }

    window.addEventListener('resize', handleResize)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      running = false
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', handleResize)
      document.removeEventListener('visibilitychange', onVisibility)
      scene.remove(mesh)
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    }
  }, [])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
