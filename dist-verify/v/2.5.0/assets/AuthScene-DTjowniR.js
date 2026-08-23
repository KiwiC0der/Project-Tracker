import{r as l,j as e,u as k,v as C,s as L,a as A}from"./index-Bfy1SkWn.js";import{W as E,S as P,O as R,b as M,c as q,d as D,e as F,G as U,V as g,f as V,P as W,M as $}from"./three-BLg5fyTT.js";import{c as b}from"./createLucideIcon-BZYo8Qae.js";import{L as H}from"./loader-circle-DBqQS91w.js";import"./vendor-C8w-UNLI.js";/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const I=[["circle",{cx:"12",cy:"12",r:"4",key:"4exip2"}],["path",{d:"M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8",key:"7n84p3"}]],G=b("AtSign",I);/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const B=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12",key:"1pkeuh"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16",key:"4dfq90"}]],O=b("CircleAlert",B);/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Y=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]],z=b("CircleCheck",Y);/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const J=[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4",key:"fwvmzm"}]],K=b("Lock",J);/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Q=[["circle",{cx:"12",cy:"8",r:"5",key:"1hypcn"}],["path",{d:"M20 21a8 8 0 0 0-16 0",key:"rfgkzh"}]],T=b("UserRound",Q);function X({className:_=""}){const t=l.useRef(null);return l.useEffect(()=>{const a=t.current;if(!a)return;let s;try{s=new E({canvas:a,alpha:!0,antialias:!1})}catch{return}s.setPixelRatio(Math.min(window.devicePixelRatio,1.5)),s.setSize(window.innerWidth,window.innerHeight);const d=new P,o=new R(-1,1,1,-1,0,1),u={u_time:{value:0},u_resolution:{value:new V(window.innerWidth*2,window.innerHeight*2)},u_opacities:{value:[.3,.3,.3,.5,.5,.5,.8,.8,.8,1]},u_colors:{value:[new g(.49,.36,1),new g(.65,.55,1),new g(.85,.85,.95),new g(.49,.36,1),new g(.65,.55,1),new g(1,1,1)]},u_total_size:{value:20},u_dot_size:{value:6}},m=new M({vertexShader:`
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
      `,uniforms:u,glslVersion:U,blending:F,blendSrc:D,blendDst:q,transparent:!0}),f=new W(2,2),n=new $(f,m);d.add(n);const x=performance.now();let p=0,r=!0;const h=()=>{r&&(p=requestAnimationFrame(h),u.u_time.value=(performance.now()-x)/1e3,s.render(d,o))};h();const y=()=>{s.setSize(window.innerWidth,window.innerHeight),u.u_resolution.value.set(window.innerWidth*2,window.innerHeight*2)},w=()=>{document.hidden?(r=!1,cancelAnimationFrame(p)):r||(r=!0,h())};return window.addEventListener("resize",y),document.addEventListener("visibilitychange",w),()=>{r=!1,cancelAnimationFrame(p),window.removeEventListener("resize",y),document.removeEventListener("visibilitychange",w),d.remove(n),f.dispose(),m.dispose(),s.dispose()}},[]),e.jsx("canvas",{ref:t,className:_,"aria-hidden":"true"})}function ae({onAuthed:_}){const[t,a]=l.useState(!0),[s,d]=l.useState(""),[o,u]=l.useState(""),[m,f]=l.useState(""),[n,x]=l.useState(!1),[p,r]=l.useState(null),[h,y]=l.useState(null);async function w(i){i.preventDefault(),r(null),y(null);const v=s.trim(),N=C(v);if(N){r(N);return}if(!o){r("Password is required.");return}if(o.length<6){r("Password must be at least 6 characters.");return}x(!0);try{const c=t?await L(v,o):await A(v,o,m.trim()||v);c.error?r(c.error):c.needsConfirmation?(y("Your account was created. Sign in to continue."),a(!0)):c.user&&_(c.user)}catch(c){r(c instanceof Error?c.message:"Something went wrong.")}finally{x(!1)}}function S(i){a(i),r(null),y(null)}return e.jsxs("div",{className:"scene-enter relative flex min-h-dvh w-full items-center justify-center overflow-hidden px-5 py-10",children:[e.jsx(X,{className:"pointer-events-none fixed inset-0 block h-full w-full opacity-60"}),e.jsxs("div",{className:"relative w-full max-w-[26rem] rounded-2xl border border-border bg-surface/85 p-7 shadow-2xl backdrop-blur-xl",children:[e.jsxs("div",{className:"mb-6 text-center",children:[e.jsx("div",{className:"mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand/20 text-brand-soft",children:e.jsx(z,{size:20})}),e.jsx("h1",{className:"text-xl font-semibold tracking-tight",children:t?"Welcome back":"Create your account"}),e.jsx("p",{className:"mt-1 text-sm text-muted",children:t?"Sign in to reach your board.":"Start tracking in under a minute."})]}),e.jsx("div",{role:"tablist","aria-label":"Authentication mode",className:"mb-6 grid grid-cols-2 gap-1 rounded-xl bg-background p-1",children:[!0,!1].map(i=>e.jsx("button",{role:"tab",type:"button","aria-selected":t===i,onClick:()=>S(i),className:`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${t===i?"bg-surface-2 text-foreground":"text-muted hover:text-foreground"}`,children:i?"Sign in":"Sign up"},String(i)))}),e.jsxs("form",{onSubmit:w,className:"flex flex-col gap-3.5",noValidate:!0,children:[!t&&e.jsx(j,{icon:e.jsx(T,{size:15}),label:"Display name",id:"displayName",type:"text",value:m,onChange:f,placeholder:"Ada Lovelace",autoComplete:"name"}),e.jsx(j,{icon:e.jsx(G,{size:15}),label:"Username",id:"username",type:"text",value:s,onChange:d,placeholder:"yourname",autoComplete:"username",required:!0,hint:t?void 0:"3–30 characters: letters, digits, underscores or hyphens. No email needed — you can add a recovery email later, and until you do, a forgotten password cannot be reset."}),e.jsx(j,{icon:e.jsx(K,{size:15}),label:"Password",id:"password",type:"password",value:o,onChange:u,placeholder:"At least 6 characters",autoComplete:t?"current-password":"new-password",required:!0}),p&&e.jsxs("p",{role:"alert",className:"flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300",children:[e.jsx(O,{size:14,className:"mt-px shrink-0"}),p]}),h&&e.jsxs("p",{role:"status",className:"flex items-start gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300",children:[e.jsx(z,{size:14,className:"mt-px shrink-0"}),h]}),e.jsxs("button",{type:"submit",disabled:n,className:"mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand text-sm font-semibold text-white transition-colors hover:bg-brand-soft disabled:opacity-60",children:[n&&e.jsx(H,{size:15,className:"animate-spin"}),t?"Sign in":"Create account"]})]}),!k&&e.jsxs("p",{className:"mt-5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[0.7rem] leading-relaxed text-amber-200/90",children:[e.jsx("strong",{className:"font-semibold",children:"Demo mode."})," No Supabase credentials are configured, so accounts and tasks are stored in this browser only. Add your keys to enable real accounts — see the README."]})]})]})}function j({icon:_,label:t,id:a,type:s,value:d,onChange:o,placeholder:u,autoComplete:m,required:f,hint:n}){return e.jsxs("div",{className:"flex flex-col gap-1.5",children:[e.jsx("label",{htmlFor:a,className:"text-xs font-medium text-muted",children:t}),e.jsxs("div",{className:"relative",children:[e.jsx("span",{className:"pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted",children:_}),e.jsx("input",{id:a,type:s,value:d,required:f,autoComplete:m,placeholder:u,"aria-describedby":n?`${a}-hint`:void 0,onChange:x=>o(x.target.value),className:"h-11 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted/50 focus:border-brand"})]}),n&&e.jsx("p",{id:`${a}-hint`,className:"text-[0.7rem] leading-relaxed text-muted",children:n})]})}export{ae as AuthScene};
