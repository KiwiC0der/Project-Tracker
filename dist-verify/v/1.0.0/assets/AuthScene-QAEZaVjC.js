import{r as n,j as e,u as z,s as C,a as S}from"./index-qK0B_U5T.js";import{W as k,S as L,O as E,b as A,c as R,d as M,e as P,G as q,V as _,f as D,P as F,M as W}from"./three-BLg5fyTT.js";import{C as j,L as H,a as I}from"./lock-BiVcD7wv.js";import{c as v}from"./createLucideIcon-B2ONCr23.js";import"./vendor-C8w-UNLI.js";/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const V=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12",key:"1pkeuh"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16",key:"4dfq90"}]],G=v("CircleAlert",V);/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const B=[["rect",{width:"20",height:"16",x:"2",y:"4",rx:"2",key:"18n3k1"}],["path",{d:"m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7",key:"1ocrg3"}]],O=v("Mail",B);/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const U=[["circle",{cx:"12",cy:"8",r:"5",key:"1hypcn"}],["path",{d:"M20 21a8 8 0 0 0-16 0",key:"rfgkzh"}]],$=v("UserRound",U);function J({className:g=""}){const r=n.useRef(null);return n.useEffect(()=>{const i=r.current;if(!i)return;let t;try{t=new k({canvas:i,alpha:!0,antialias:!1})}catch{return}t.setPixelRatio(Math.min(window.devicePixelRatio,1.5)),t.setSize(window.innerWidth,window.innerHeight);const c=new L,a=new E(-1,1,1,-1,0,1),d={u_time:{value:0},u_resolution:{value:new D(window.innerWidth*2,window.innerHeight*2)},u_opacities:{value:[.3,.3,.3,.5,.5,.5,.8,.8,.8,1]},u_colors:{value:[new _(.49,.36,1),new _(.65,.55,1),new _(.85,.85,.95),new _(.49,.36,1),new _(.65,.55,1),new _(1,1,1)]},u_total_size:{value:20},u_dot_size:{value:6}},u=new A({vertexShader:`
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
      `,uniforms:d,glslVersion:q,blending:P,blendSrc:M,blendDst:R,transparent:!0}),f=new F(2,2),m=new W(f,u);c.add(m);const y=performance.now();let x=0,s=!0;const p=()=>{s&&(x=requestAnimationFrame(p),d.u_time.value=(performance.now()-y)/1e3,t.render(c,a))};p();const h=()=>{t.setSize(window.innerWidth,window.innerHeight),d.u_resolution.value.set(window.innerWidth*2,window.innerHeight*2)},b=()=>{document.hidden?(s=!1,cancelAnimationFrame(x)):s||(s=!0,p())};return window.addEventListener("resize",h),document.addEventListener("visibilitychange",b),()=>{s=!1,cancelAnimationFrame(x),window.removeEventListener("resize",h),document.removeEventListener("visibilitychange",b),c.remove(m),f.dispose(),u.dispose(),t.dispose()}},[]),e.jsx("canvas",{ref:r,className:g,"aria-hidden":"true"})}function Z({onAuthed:g}){const[r,i]=n.useState(!0),[t,c]=n.useState(""),[a,d]=n.useState(""),[u,f]=n.useState(""),[m,y]=n.useState(!1),[x,s]=n.useState(null),[p,h]=n.useState(null);async function b(o){if(o.preventDefault(),s(null),h(null),!t.trim()||!a){s("Email and password are required.");return}if(a.length<6){s("Password must be at least 6 characters.");return}y(!0);try{const l=r?await C(t.trim(),a):await S(t.trim(),a,u.trim()||t.split("@")[0]);l.error?s(l.error):l.needsConfirmation?(h("Check your inbox to confirm your email, then sign in."),i(!0)):l.user&&g(l.user)}catch(l){s(l instanceof Error?l.message:"Something went wrong.")}finally{y(!1)}}function N(o){i(o),s(null),h(null)}return e.jsxs("div",{className:"scene-enter relative flex min-h-dvh w-full items-center justify-center overflow-hidden px-5 py-10",children:[e.jsx(J,{className:"pointer-events-none fixed inset-0 block h-full w-full opacity-60"}),e.jsxs("div",{className:"relative w-full max-w-[26rem] rounded-2xl border border-border bg-surface/85 p-7 shadow-2xl backdrop-blur-xl",children:[e.jsxs("div",{className:"mb-6 text-center",children:[e.jsx("div",{className:"mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand/20 text-brand-soft",children:e.jsx(j,{size:20})}),e.jsx("h1",{className:"text-xl font-semibold tracking-tight",children:r?"Welcome back":"Create your account"}),e.jsx("p",{className:"mt-1 text-sm text-muted",children:r?"Sign in to reach your board.":"Start tracking in under a minute."})]}),e.jsx("div",{role:"tablist","aria-label":"Authentication mode",className:"mb-6 grid grid-cols-2 gap-1 rounded-xl bg-background p-1",children:[!0,!1].map(o=>e.jsx("button",{role:"tab",type:"button","aria-selected":r===o,onClick:()=>N(o),className:`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${r===o?"bg-surface-2 text-foreground":"text-muted hover:text-foreground"}`,children:o?"Sign in":"Sign up"},String(o)))}),e.jsxs("form",{onSubmit:b,className:"flex flex-col gap-3.5",noValidate:!0,children:[!r&&e.jsx(w,{icon:e.jsx($,{size:15}),label:"Display name",id:"displayName",type:"text",value:u,onChange:f,placeholder:"Ada Lovelace",autoComplete:"name"}),e.jsx(w,{icon:e.jsx(O,{size:15}),label:"Email",id:"email",type:"email",value:t,onChange:c,placeholder:"you@example.com",autoComplete:"email",required:!0}),e.jsx(w,{icon:e.jsx(H,{size:15}),label:"Password",id:"password",type:"password",value:a,onChange:d,placeholder:"At least 6 characters",autoComplete:r?"current-password":"new-password",required:!0}),x&&e.jsxs("p",{role:"alert",className:"flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300",children:[e.jsx(G,{size:14,className:"mt-px shrink-0"}),x]}),p&&e.jsxs("p",{role:"status",className:"flex items-start gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300",children:[e.jsx(j,{size:14,className:"mt-px shrink-0"}),p]}),e.jsxs("button",{type:"submit",disabled:m,className:"mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand text-sm font-semibold text-white transition-colors hover:bg-brand-soft disabled:opacity-60",children:[m&&e.jsx(I,{size:15,className:"animate-spin"}),r?"Sign in":"Create account"]})]}),!z&&e.jsxs("p",{className:"mt-5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[0.7rem] leading-relaxed text-amber-200/90",children:[e.jsx("strong",{className:"font-semibold",children:"Demo mode."})," No Supabase credentials are configured, so accounts and tasks are stored in this browser only. Add your keys to enable real accounts — see the README."]})]})]})}function w({icon:g,label:r,id:i,type:t,value:c,onChange:a,placeholder:d,autoComplete:u,required:f}){return e.jsxs("div",{className:"flex flex-col gap-1.5",children:[e.jsx("label",{htmlFor:i,className:"text-xs font-medium text-muted",children:r}),e.jsxs("div",{className:"relative",children:[e.jsx("span",{className:"pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted",children:g}),e.jsx("input",{id:i,type:t,value:c,required:f,autoComplete:u,placeholder:d,onChange:m=>a(m.target.value),className:"h-11 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted/50 focus:border-brand"})]})]})}export{Z as AuthScene};
