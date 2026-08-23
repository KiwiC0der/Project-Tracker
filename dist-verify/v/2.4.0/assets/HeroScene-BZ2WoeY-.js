import{r as v,j as e}from"./index-48LH9lTK.js";import{W as S,C as N,S as k,O as R,B as A,a as C,R as E,D as L,M as z}from"./three-BLg5fyTT.js";import{c as F}from"./createLucideIcon-D3z92Qxv.js";import"./vendor-C8w-UNLI.js";function M({className:a=""}){const d=v.useRef(null);return v.useEffect(()=>{const m=d.current;if(!m)return;const w=`
      attribute vec3 position;
      void main() {
        gl_Position = vec4(position, 1.0);
      }
    `,b=`
      precision highp float;
      uniform vec2 resolution;
      uniform float time;
      uniform float xScale;
      uniform float yScale;
      uniform float distortion;

      void main() {
        vec2 p = (gl_FragCoord.xy * 2.0 - resolution) / min(resolution.x, resolution.y);

        float d = length(p) * distortion;

        float rx = p.x * (1.0 + d);
        float gx = p.x;
        float bx = p.x * (1.0 - d);

        float r = 0.05 / abs(p.y + sin((rx + time) * xScale) * yScale);
        float g = 0.05 / abs(p.y + sin((gx + time) * xScale) * yScale);
        float b = 0.05 / abs(p.y + sin((bx + time) * xScale) * yScale);

        gl_FragColor = vec4(r, g, b, 1.0);
      }
    `;let t;try{t=new S({canvas:m,antialias:!1})}catch{return}t.setPixelRatio(Math.min(window.devicePixelRatio,1.5)),t.setClearColor(new N(0));const r=new k,g=new R(-1,1,1,-1,0,-1),i={resolution:{value:[window.innerWidth,window.innerHeight]},time:{value:0},xScale:{value:1},yScale:{value:.5},distortion:{value:.05}},y=new Float32Array([-1,-1,0,1,-1,0,-1,1,0,1,-1,0,-1,1,0,1,1,0]),s=new A;s.setAttribute("position",new C(y,3));const x=new E({vertexShader:w,fragmentShader:b,uniforms:i,side:L}),u=new z(s,x);r.add(u);const o=()=>{const h=window.innerWidth,p=window.innerHeight;t.setSize(h,p,!1),i.resolution.value=[h,p]};o();const j=window.matchMedia("(prefers-reduced-motion: reduce)").matches;let l=0,n=!0;const c=()=>{n&&(j||(i.time.value+=.01),t.render(r,g),l=requestAnimationFrame(c))};c();const f=()=>{document.hidden?(n=!1,cancelAnimationFrame(l)):n||(n=!0,c())};return window.addEventListener("resize",o),document.addEventListener("visibilitychange",f),()=>{n=!1,cancelAnimationFrame(l),window.removeEventListener("resize",o),document.removeEventListener("visibilitychange",f),r.remove(u),s.dispose(),x.dispose(),t.dispose()}},[]),e.jsx("canvas",{ref:d,className:a,"aria-hidden":"true"})}/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const P=[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"m12 5 7 7-7 7",key:"xquz4c"}]],W=F("ArrowRight",P);function q({onEnter:a}){return e.jsxs("div",{className:"scene-enter relative flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden px-5",children:[e.jsx(M,{className:"pointer-events-none fixed inset-0 block h-full w-full"}),e.jsx("div",{className:"relative mx-auto w-full max-w-3xl border border-[#27272a] p-2",children:e.jsxs("main",{className:"relative overflow-hidden border border-[#27272a] bg-black/45 px-6 py-12 text-center backdrop-blur-[2px]",children:[e.jsx("h1",{className:"mb-3 text-5xl font-extrabold tracking-tighter text-white sm:text-6xl md:text-[clamp(2.5rem,8vw,5.5rem)]",children:"Project Tracker"}),e.jsx("p",{className:"mx-auto max-w-xl text-xs text-white/60 md:text-sm lg:text-base",children:"Plan projects, break them into tasks, and drag them to done. Your board, your account, synced and saved."}),e.jsxs("div",{className:"my-8 flex items-center justify-center gap-1.5",children:[e.jsxs("span",{className:"relative flex h-3 w-3 items-center justify-center",children:[e.jsx("span",{className:"absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75"}),e.jsx("span",{className:"relative inline-flex h-2 w-2 rounded-full bg-green-500"})]}),e.jsx("p",{className:"text-xs text-green-500",children:"System operational"})]}),e.jsxs("button",{type:"button",onClick:a,className:"group inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-transform hover:scale-[1.03] active:scale-95",children:["Get started",e.jsx(W,{size:16,className:"transition-transform group-hover:translate-x-0.5"})]}),e.jsx("p",{className:"mt-5 text-[0.7rem] text-white/40",children:"Sign in or create an account on the next screen."})]})})]})}export{q as HeroScene};
