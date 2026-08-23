import{r as n,j as e,u as k,s as z,a as C}from"./index-CrQV7OfV.js";import{W as S,S as L,O as E,b as A,c as M,d as R,e as P,G as q,V as y,f as D,P as F,M as V}from"./three-BLg5fyTT.js";import{c as g}from"./createLucideIcon-LjN2QXWK.js";import{L as W}from"./loader-circle-DK7vIN2T.js";import"./vendor-C8w-UNLI.js";/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const H=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12",key:"1pkeuh"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16",key:"4dfq90"}]],I=g("CircleAlert",H);/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]],j=g("CircleCheck",$);/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const G=[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4",key:"fwvmzm"}]],B=g("Lock",G);/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const O=[["rect",{width:"20",height:"16",x:"2",y:"4",rx:"2",key:"18n3k1"}],["path",{d:"m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7",key:"1ocrg3"}]],U=g("Mail",O);/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const J=[["circle",{cx:"12",cy:"8",r:"5",key:"1hypcn"}],["path",{d:"M20 21a8 8 0 0 0-16 0",key:"rfgkzh"}]],K=g("UserRound",J);function Q({className:_=""}){const r=n.useRef(null);return n.useEffect(()=>{const i=r.current;if(!i)return;let t;try{t=new S({canvas:i,alpha:!0,antialias:!1})}catch{return}t.setPixelRatio(Math.min(window.devicePixelRatio,1.5)),t.setSize(window.innerWidth,window.innerHeight);const c=new L,o=new E(-1,1,1,-1,0,1),d={u_time:{value:0},u_resolution:{value:new D(window.innerWidth*2,window.innerHeight*2)},u_opacities:{value:[.3,.3,.3,.5,.5,.5,.8,.8,.8,1]},u_colors:{value:[new y(.49,.36,1),new y(.65,.55,1),new y(.85,.85,.95),new y(.49,.36,1),new y(.65,.55,1),new y(1,1,1)]},u_total_size:{value:20},u_dot_size:{value:6}},u=new A({vertexShader:`
        precision mediump float;
        uniform vec2 u_resolution;
        out vec2 fragCoord;
        void main() {
          gl_Position = vec4(position, 1.0);
          fragCoord = (position.xy + 1.0) * 0.5 * u_resolution;
          fragCoord.y = u_resolution.y - fragCoord.y;
        }
      `,fragmentShader:`
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
      `,uniforms:d,glslVersion:q,blending:P,blendSrc:R,blendDst:M,transparent:!0}),f=new F(2,2),m=new V(f,u);c.add(m);const b=performance.now();let x=0,s=!0;const p=()=>{s&&(x=requestAnimationFrame(p),d.u_time.value=(performance.now()-b)/1e3,t.render(c,o))};p();const h=()=>{t.setSize(window.innerWidth,window.innerHeight),d.u_resolution.value.set(window.innerWidth*2,window.innerHeight*2)},w=()=>{document.hidden?(s=!1,cancelAnimationFrame(x)):s||(s=!0,p())};return window.addEventListener("resize",h),document.addEventListener("visibilitychange",w),()=>{s=!1,cancelAnimationFrame(x),window.removeEventListener("resize",h),document.removeEventListener("visibilitychange",w),c.remove(m),f.dispose(),u.dispose(),t.dispose()}},[]),e.jsx("canvas",{ref:r,className:_,"aria-hidden":"true"})}function te({onAuthed:_}){const[r,i]=n.useState(!0),[t,c]=n.useState(""),[o,d]=n.useState(""),[u,f]=n.useState(""),[m,b]=n.useState(!1),[x,s]=n.useState(null),[p,h]=n.useState(null);async function w(a){if(a.preventDefault(),s(null),h(null),!t.trim()||!o){s("Email and password are required.");return}if(o.length<6){s("Password must be at least 6 characters.");return}b(!0);try{const l=r?await z(t.trim(),o):await C(t.trim(),o,u.trim()||t.split("@")[0]);l.error?s(l.error):l.needsConfirmation?(h("Check your inbox to confirm your email, then sign in."),i(!0)):l.user&&_(l.user)}catch(l){s(l instanceof Error?l.message:"Something went wrong.")}finally{b(!1)}}function N(a){i(a),s(null),h(null)}return e.jsxs("div",{className:"scene-enter relative flex min-h-dvh w-full items-center justify-center overflow-hidden px-5 py-10",children:[e.jsx(Q,{className:"pointer-events-none fixed inset-0 block h-full w-full opacity-60"}),e.jsxs("div",{className:"relative w-full max-w-[26rem] rounded-2xl border border-border bg-surface/85 p-7 shadow-2xl backdrop-blur-xl",children:[e.jsxs("div",{className:"mb-6 text-center",children:[e.jsx("div",{className:"mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand/20 text-brand-soft",children:e.jsx(j,{size:20})}),e.jsx("h1",{className:"text-xl font-semibold tracking-tight",children:r?"Welcome back":"Create your account"}),e.jsx("p",{className:"mt-1 text-sm text-muted",children:r?"Sign in to reach your board.":"Start tracking in under a minute."})]}),e.jsx("div",{role:"tablist","aria-label":"Authentication mode",className:"mb-6 grid grid-cols-2 gap-1 rounded-xl bg-background p-1",children:[!0,!1].map(a=>e.jsx("button",{role:"tab",type:"button","aria-selected":r===a,onClick:()=>N(a),className:`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${r===a?"bg-surface-2 text-foreground":"text-muted hover:text-foreground"}`,children:a?"Sign in":"Sign up"},String(a)))}),e.jsxs("form",{onSubmit:w,className:"flex flex-col gap-3.5",noValidate:!0,children:[!r&&e.jsx(v,{icon:e.jsx(K,{size:15}),label:"Display name",id:"displayName",type:"text",value:u,onChange:f,placeholder:"Ada Lovelace",autoComplete:"name"}),e.jsx(v,{icon:e.jsx(U,{size:15}),label:"Email",id:"email",type:"email",value:t,onChange:c,placeholder:"you@example.com",autoComplete:"email",required:!0}),e.jsx(v,{icon:e.jsx(B,{size:15}),label:"Password",id:"password",type:"password",value:o,onChange:d,placeholder:"At least 6 characters",autoComplete:r?"current-password":"new-password",required:!0}),x&&e.jsxs("p",{role:"alert",className:"flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300",children:[e.jsx(I,{size:14,className:"mt-px shrink-0"}),x]}),p&&e.jsxs("p",{role:"status",className:"flex items-start gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300",children:[e.jsx(j,{size:14,className:"mt-px shrink-0"}),p]}),e.jsxs("button",{type:"submit",disabled:m,className:"mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand text-sm font-semibold text-white transition-colors hover:bg-brand-soft disabled:opacity-60",children:[m&&e.jsx(W,{size:15,className:"animate-spin"}),r?"Sign in":"Create account"]})]}),!k&&e.jsxs("p",{className:"mt-5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[0.7rem] leading-relaxed text-amber-200/90",children:[e.jsx("strong",{className:"font-semibold",children:"Demo mode."})," No Supabase credentials are configured, so accounts and tasks are stored in this browser only. Add your keys to enable real accounts — see the README."]})]})]})}function v({icon:_,label:r,id:i,type:t,value:c,onChange:o,placeholder:d,autoComplete:u,required:f}){return e.jsxs("div",{className:"flex flex-col gap-1.5",children:[e.jsx("label",{htmlFor:i,className:"text-xs font-medium text-muted",children:r}),e.jsxs("div",{className:"relative",children:[e.jsx("span",{className:"pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted",children:_}),e.jsx("input",{id:i,type:t,value:c,required:f,autoComplete:u,placeholder:d,onChange:m=>o(m.target.value),className:"h-11 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted/50 focus:border-brand"})]})]})}export{te as AuthScene};
