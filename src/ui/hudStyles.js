import barlow500 from './fonts/barlow-condensed-latin-500-normal.woff2?url';
import barlow600 from './fonts/barlow-condensed-latin-600-normal.woff2?url';
import barlow700 from './fonts/barlow-condensed-latin-700-normal.woff2?url';
import rajdhani600 from './fonts/rajdhani-latin-600-normal.woff2?url';
import rajdhani700 from './fonts/rajdhani-latin-700-normal.woff2?url';

const u = (n) => `calc(${n}*var(--u))`;
const FONT = `'HUD Barlow', 'Barlow Condensed', 'Arial Narrow', sans-serif`;
const NUM = `'HUD Rajdhani', 'Rajdhani', 'HUD Barlow', sans-serif`;
const SH = `0 0 ${u(3)} rgba(0,0,0,.55), 0 ${u(1)} ${u(1)} rgba(0,0,0,.45)`;

export const HUD_CSS = `
@font-face{font-family:'HUD Barlow';font-weight:500;src:url(${barlow500}) format('woff2');font-display:block}
@font-face{font-family:'HUD Barlow';font-weight:600;src:url(${barlow600}) format('woff2');font-display:block}
@font-face{font-family:'HUD Barlow';font-weight:700;src:url(${barlow700}) format('woff2');font-display:block}
@font-face{font-family:'HUD Rajdhani';font-weight:600;src:url(${rajdhani600}) format('woff2');font-display:block}
@font-face{font-family:'HUD Rajdhani';font-weight:700;src:url(${rajdhani700}) format('woff2');font-display:block}
:root{--u:1px;--hud-white:rgba(246,244,236,.96);--hud-dim:rgba(236,234,226,.62);--hud-red:#ff3b2c;--hud-amber:#f3c052;--hud-green:#9fe07a}
#ui-root{position:fixed;inset:0;pointer-events:none;z-index:10;font-family:${FONT};color:var(--hud-white);
  -webkit-font-smoothing:antialiased;user-select:none;letter-spacing:.02em}
#ui-root kbd{font-family:${FONT};font-weight:700;display:inline-flex;align-items:center;justify-content:center;min-width:${u(22)};height:${u(22)};
  padding:0 ${u(6)};border:${u(1.5)} solid rgba(255,255,255,.85);border-radius:${u(3)};font-size:${u(14)};line-height:1;background:rgba(0,0,0,.35);box-sizing:border-box}
.hud{position:absolute;inset:0;transition:opacity .25s}
.hud.dim{opacity:0}
.hud.dead{opacity:0;transition:opacity .5s .2s}

/* ---------- vignette / blood */
.vig{position:absolute;inset:0;opacity:0;pointer-events:none;
  background:radial-gradient(ellipse 72% 68% at 50% 50%,rgba(120,0,0,0) 48%,rgba(120,6,4,.32) 70%,rgba(90,0,0,.78) 100%)}
.blood{position:absolute;inset:0;opacity:0;pointer-events:none;mix-blend-mode:multiply;
  background:
   radial-gradient(ellipse 30% 42% at 0% 50%,rgba(150,10,6,.95),rgba(150,10,6,0) 70%),
   radial-gradient(ellipse 30% 42% at 100% 45%,rgba(150,10,6,.95),rgba(150,10,6,0) 70%),
   radial-gradient(ellipse 46% 28% at 50% 0%,rgba(140,8,4,.9),rgba(140,8,4,0) 70%),
   radial-gradient(ellipse 50% 30% at 50% 100%,rgba(140,8,4,.9),rgba(140,8,4,0) 70%),
   radial-gradient(circle at 8% 12%,rgba(110,0,0,.95),rgba(110,0,0,0) 18%),
   radial-gradient(circle at 93% 86%,rgba(110,0,0,.95),rgba(110,0,0,0) 20%),
   radial-gradient(circle at 90% 10%,rgba(120,0,0,.8),rgba(120,0,0,0) 14%),
   radial-gradient(circle at 6% 90%,rgba(120,0,0,.8),rgba(120,0,0,0) 16%)}

/* ---------- minimap */
.mm-wrap{position:absolute;left:${u(40)};top:${u(36)};width:${u(236)}}
.mm{position:relative;width:${u(236)};height:${u(236)};border-radius:50%;
  box-shadow:0 0 0 ${u(1)} rgba(255,255,255,.08),0 ${u(6)} ${u(26)} rgba(0,0,0,.45)}
.mm canvas{width:100%;height:100%;display:block;border-radius:50%}
.mm-ring{position:absolute;inset:0;border-radius:50%;border:${u(2)} solid rgba(255,255,255,.55);
  box-shadow:inset 0 0 ${u(18)} rgba(0,0,0,.55)}
.mm-ring::before{content:'';position:absolute;inset:${u(5)};border-radius:50%;border:${u(1)} solid rgba(255,255,255,.12)}
.mm-n{position:absolute;left:50%;top:50%;width:${u(20)};height:${u(20)};margin:${u(-10)} 0 0 ${u(-10)};border-radius:50%;
  background:rgba(12,14,16,.92);border:${u(1.5)} solid rgba(255,255,255,.7);font:700 ${u(12)}/${u(17)} ${FONT};text-align:center;color:#fff;box-sizing:border-box}
.obj{margin-top:${u(18)};text-shadow:${SH};padding-left:${u(2)}}
.obj-head{font-weight:700;font-size:${u(13)};letter-spacing:.2em;color:var(--hud-amber);display:flex;align-items:center;gap:${u(8)}}
.obj-dia{width:${u(8)};height:${u(8)};background:var(--hud-amber);transform:rotate(45deg);box-shadow:0 0 ${u(6)} rgba(243,192,82,.6)}
.obj-text{font-weight:600;font-size:${u(21)};margin-top:${u(4)};line-height:1.1;max-width:${u(320)};letter-spacing:.01em}
.obj-sub{font-weight:500;font-size:${u(16)};color:var(--hud-dim);margin-top:${u(3)};white-space:pre}

/* ---------- compass */
.cmp{position:absolute;left:50%;top:${u(26)};width:${u(560)};margin-left:${u(-280)};height:${u(64)};text-shadow:${SH}}
.cmp-view{position:absolute;left:0;right:0;top:0;height:${u(42)};overflow:hidden;
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent);mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent)}
.cmp-view::after{content:'';position:absolute;left:0;right:0;top:${u(26)};height:${u(1)};background:rgba(255,255,255,.35)}
.cmp-strip{position:absolute;left:0;top:0;height:100%;will-change:transform}
.cmp-strip i{position:absolute;top:${u(19)};width:${u(1.5)};height:${u(7)};margin-left:${u(-0.75)};background:rgba(255,255,255,.55)}
.cmp-strip i.l{height:${u(10)};top:${u(16)};background:rgba(255,255,255,.85)}
.cmp-strip span{position:absolute;top:${u(-1)};transform:translateX(-50%);white-space:nowrap}
.c-lbl{font-weight:700;font-size:${u(17)};color:#fff}
.c-lbl.major{font-size:${u(19)}}
.c-num{font-weight:600;font-size:${u(13)};color:rgba(255,255,255,.6);top:${u(1)}!important;font-family:${NUM}}
.cmp-pings i{position:absolute;top:${u(27)};width:${u(10)};height:${u(10)};margin-left:${u(-5)};background:var(--hud-red);
  transform:rotate(45deg) scale(.8);box-shadow:0 0 ${u(6)} rgba(255,40,30,.8)}
.cmp-mark{position:absolute;left:50%;top:${u(28)};margin-left:${u(-6)};width:0;height:0;border-left:${u(6)} solid transparent;border-right:${u(6)} solid transparent;
  border-bottom:${u(8)} solid #fff;filter:drop-shadow(0 0 ${u(2)} rgba(0,0,0,.6))}
.cmp-bearing{position:absolute;left:50%;top:${u(38)};transform:translateX(-50%);font:700 ${u(17)}/1 ${NUM};letter-spacing:.06em;
  padding:${u(3)} ${u(7)} ${u(2)};background:rgba(10,12,14,.55);border:${u(1)} solid rgba(255,255,255,.25)}

/* ---------- crosshair */
.xh{position:absolute;left:50%;top:50%;width:0;height:0;--gap:8;transition:opacity .12s}
.xh i{position:absolute;background:rgba(255,255,255,.95);box-shadow:0 0 0 ${u(1)} rgba(0,0,0,.42)}
.xh i.t,.xh i.b{width:${u(2)};height:${u(11)};left:${u(-1)}}
.xh i.l,.xh i.r{height:${u(2)};width:${u(11)};top:${u(-1)}}
.xh i.t{bottom:calc(var(--gap)*var(--u))}.xh i.b{top:calc(var(--gap)*var(--u))}
.xh i.l{right:calc(var(--gap)*var(--u))}.xh i.r{left:calc(var(--gap)*var(--u))}
.xh em{position:absolute;width:${u(2)};height:${u(2)};left:${u(-1)};top:${u(-1)};background:rgba(255,255,255,.9);box-shadow:0 0 0 ${u(1)} rgba(0,0,0,.35)}

/* ---------- hitmarker */
.hm{position:absolute;left:50%;top:50%;width:0;height:0;opacity:0}
.hm i{position:absolute;width:${u(3)};height:${u(13)};left:${u(-1.5)};top:${u(-6.5)};background:#fff;box-shadow:0 0 ${u(2)} rgba(0,0,0,.7)}
.hm i:nth-child(1){transform:rotate(45deg) translateY(${u(-15)})}
.hm i:nth-child(2){transform:rotate(135deg) translateY(${u(-15)})}
.hm i:nth-child(3){transform:rotate(225deg) translateY(${u(-15)})}
.hm i:nth-child(4){transform:rotate(315deg) translateY(${u(-15)})}
.hm.kill i{background:#ff2d1f;height:${u(17)};top:${u(-8.5)};width:${u(3.5)};box-shadow:0 0 ${u(4)} rgba(255,30,20,.7),0 0 ${u(1)} rgba(0,0,0,.8)}
.hm.pop{animation:hmpop .16s ease-out}
@keyframes hmpop{0%{transform:scale(1.45)}100%{transform:scale(1)}}

/* ---------- damage indicators */
.dmg-ring{position:absolute;left:50%;top:50%;width:0;height:0}
.dmg{position:absolute;left:${u(-190)};top:${u(-190)};width:${u(380)};height:${u(380)};filter:drop-shadow(0 0 ${u(6)} rgba(255,20,10,.7))}
.dmg svg{width:100%;height:100%;overflow:visible}

/* ---------- popups / prompts */
.popups{position:absolute;left:calc(50% + ${u(70)});top:calc(50% + ${u(34)});display:flex;flex-direction:column;gap:${u(2)}}
.pop{display:flex;align-items:baseline;gap:${u(8)};text-shadow:${SH};animation:popin .22s cubic-bezier(.2,1.6,.4,1);transition:opacity .4s}
.pop b{font:700 ${u(26)}/1 ${NUM};color:var(--hud-amber)}
.pop span{font-weight:700;font-size:${u(15)};letter-spacing:.14em;color:#fff}
.pop:not(:first-child) b{font-size:${u(20)};opacity:.85}.pop:not(:first-child) span{font-size:${u(13)};opacity:.8}
.pop.out{opacity:0}
@keyframes popin{0%{transform:translateX(${u(-14)}) scale(1.3);opacity:0}100%{transform:none;opacity:1}}
.prompt{position:absolute;left:50%;top:calc(50% + ${u(96)});transform:translateX(-50%);display:flex;align-items:center;gap:${u(8)};
  font-weight:700;font-size:${u(19)};letter-spacing:.14em;text-shadow:${SH}}
.prompt.urgent span{color:var(--hud-red)}
.prompt .rl{color:var(--hud-dim)} .prompt .no{color:var(--hud-red)}
.banner{position:absolute;left:50%;top:${u(150)};transform:translateX(-50%);text-align:center;opacity:0;text-shadow:${SH}}
.banner b{display:block;font:700 ${u(54)}/1 ${FONT};letter-spacing:.18em}
.banner small{display:block;font-weight:600;font-size:${u(16)};letter-spacing:.3em;color:var(--hud-amber);margin-bottom:${u(6)}}
.banner.on{animation:banner 3.6s ease-out forwards}
@keyframes banner{0%{opacity:0;letter-spacing:.5em}8%{opacity:1;letter-spacing:.18em}80%{opacity:1}100%{opacity:0}}

/* ---------- killfeed / wave */
.feed{position:absolute;left:${u(40)};bottom:${u(150)};display:flex;flex-direction:column;gap:${u(4)};align-items:flex-start}
.kf{display:flex;align-items:center;gap:${u(10)};font-weight:600;font-size:${u(17)};padding:${u(4)} ${u(12)} ${u(3)};
  background:linear-gradient(90deg,rgba(8,10,12,.62),rgba(8,10,12,.18));text-shadow:${SH};transition:opacity .5s;animation:kfin .25s ease-out}
.kf.out{opacity:0}
.kf .you{color:var(--hud-green)} .kf .foe{color:#ff6a58}
.kf .wpn{color:rgba(255,255,255,.85);font-size:${u(14)};letter-spacing:.08em;display:flex;align-items:center;gap:${u(4)}}
.kf .wpn em{display:inline-flex;width:${u(16)};height:${u(16)};color:#fff}
@keyframes kfin{0%{transform:translateX(${u(-20)});opacity:0}100%{transform:none;opacity:1}}
.wv{position:absolute;left:${u(40)};bottom:${u(40)};display:flex;align-items:stretch;text-shadow:${SH};
  background:linear-gradient(90deg,rgba(8,10,12,.55),rgba(8,10,12,.1));border-left:${u(3)} solid var(--hud-amber)}
.wv-l{padding:${u(8)} ${u(14)} ${u(6)} ${u(12)};display:flex;flex-direction:column;justify-content:center}
.wv-l small{font-weight:700;font-size:${u(12)};letter-spacing:.28em;color:var(--hud-amber)}
.wv-l b{font:700 ${u(44)}/.9 ${NUM}}
.wv-r{padding:${u(8)} ${u(18)} ${u(8)} ${u(4)};display:flex;flex-direction:column;justify-content:center;gap:${u(3)};
  font-weight:600;font-size:${u(13)};letter-spacing:.18em;color:var(--hud-dim)}
.wv-r b{font:700 ${u(19)}/1 ${NUM};color:#fff;letter-spacing:.04em;margin-left:${u(6)}}

/* ---------- ammo / loadout */
.loadout{position:absolute;right:${u(44)};bottom:${u(38)};display:flex;align-items:flex-end;gap:${u(22)};text-shadow:${SH}}
.eq{display:flex;flex-direction:column;gap:${u(8)};padding-bottom:${u(8)}}
.eq>div{display:flex;align-items:center;gap:${u(4)};height:${u(30)}}
.eq .ico{width:${u(28)};height:${u(28)};filter:drop-shadow(0 0 ${u(2)} rgba(0,0,0,.7))}
.eq b{font:700 ${u(18)}/1 ${NUM};min-width:${u(12)}}
.eq .empty{opacity:.35}
.ammo{display:flex;flex-direction:column;align-items:flex-end;min-width:${u(230)}}
.w-top{display:flex;align-items:center;gap:${u(10)};font-weight:700;font-size:${u(18)};letter-spacing:.12em}
.w-name{color:#fff}
.fm{display:inline-flex;gap:${u(2.5)};align-items:flex-end;height:${u(14)}}
.fm i{width:${u(4)};height:${u(13)};background:#fff;border-radius:${u(2)} ${u(2)} 0 0;box-shadow:0 0 ${u(2)} rgba(0,0,0,.6)}
.fm.semi i{opacity:1}.fm.burst i:nth-child(2){height:${u(13)}}
.w-count{display:flex;align-items:baseline;gap:${u(10)};margin-top:${u(-2)}}
.w-mag{font:700 ${u(72)}/.92 ${NUM};letter-spacing:-.01em;transition:color .15s}
.w-mag.low{color:var(--hud-red)}
.w-res{font:600 ${u(30)}/1 ${NUM};color:var(--hud-dim);position:relative;padding-left:${u(14)}}
.w-res::before{content:'';position:absolute;left:0;top:${u(2)};bottom:${u(2)};width:${u(2)};background:rgba(255,255,255,.45);transform:skewX(-18deg)}
.w-bar{display:flex;gap:${u(2)};margin-top:${u(6)};height:${u(9)};justify-content:flex-end}
.w-bar i{width:${u(4)};height:100%;background:rgba(255,255,255,.18)}
.w-bar i.f{background:rgba(255,255,255,.92);box-shadow:0 0 ${u(2)} rgba(0,0,0,.5)}
.w-bar i.lo{background:var(--hud-red)}
.hp{--hp:1;margin-top:${u(8)};width:${u(230)};height:${u(4)};background:rgba(255,255,255,.14);position:relative;overflow:hidden}
.hp i{position:absolute;left:0;top:0;bottom:0;width:calc(var(--hp)*100%);background:rgba(255,255,255,.9);transition:width .15s}
.hp.low i{background:var(--hud-red)}

/* ---------- death */
.death{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .8s .35s;
  background:radial-gradient(ellipse at center,rgba(40,0,0,.15),rgba(10,0,0,.82) 75%)}
.death.on{opacity:1}
.death-in{text-align:center;text-shadow:${SH}}
.death small{font-weight:700;font-size:${u(14)};letter-spacing:.4em;color:var(--hud-red)}
.death h1{margin:${u(8)} 0 0;font:700 ${u(78)}/1 ${FONT};letter-spacing:.14em}
.death-line{width:${u(440)};height:${u(2)};margin:${u(18)} auto;background:linear-gradient(90deg,transparent,rgba(255,60,40,.9),transparent)}
.death-tip{font-weight:500;font-size:${u(19)};color:var(--hud-dim);max-width:${u(640)};margin:0 auto}
.death-t{margin-top:${u(28)};font-weight:700;font-size:${u(18)};letter-spacing:.3em}

/* ---------- menu */
.menu{position:absolute;inset:0;pointer-events:auto;opacity:0;visibility:hidden;transition:opacity .35s,visibility .35s}
.menu.on{opacity:1;visibility:visible}
.m-bg{position:absolute;inset:0;background:
  linear-gradient(90deg,rgba(4,5,6,.94) 0%,rgba(6,7,8,.82) 36%,rgba(8,9,10,.38) 62%,rgba(8,9,10,.72) 100%),
  radial-gradient(ellipse at 70% 40%,rgba(255,170,90,.08),transparent 60%)}
.m-grain{position:absolute;inset:0;opacity:.07;background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.5) 0 1px,transparent 1px 3px)}
.m-left{position:absolute;left:${u(110)};top:50%;transform:translateY(-54%);width:${u(700)}}
.m-tag{display:flex;align-items:center;gap:${u(12)};font-weight:700;font-size:${u(15)};letter-spacing:.34em;color:var(--hud-amber)}
.m-tag span{width:${u(36)};height:${u(2)};background:var(--hud-amber)}
.m-title{margin:${u(16)} 0 0;font:700 ${u(124)}/.84 ${FONT};letter-spacing:.02em;color:#fff;text-shadow:0 ${u(4)} ${u(30)} rgba(0,0,0,.6)}
.m-title small{display:block;font-weight:500;font-size:${u(40)};letter-spacing:.52em;color:rgba(255,255,255,.72);margin-bottom:${u(10)}}
.m-loc{display:flex;gap:${u(18)};margin-top:${u(22)};font-weight:600;font-size:${u(15)};letter-spacing:.2em;color:var(--hud-dim)}
.m-loc span+span::before{content:'/';margin-right:${u(18)};color:rgba(255,255,255,.3)}
.m-brief{margin:${u(26)} 0 0;font-weight:500;font-size:${u(21)};line-height:1.4;color:rgba(235,232,224,.8);max-width:${u(590)};
  border-left:${u(2)} solid rgba(255,255,255,.25);padding-left:${u(18)}}
.m-deploy{all:unset;cursor:pointer;margin-top:${u(44)};display:flex;align-items:center;justify-content:space-between;width:${u(420)};
  height:${u(66)};padding:0 ${u(26)};box-sizing:border-box;background:#f2efe6;color:#0c0d0e;position:relative;
  clip-path:polygon(0 0,100% 0,100% calc(100% - ${u(14)}),calc(100% - ${u(14)}) 100%,0 100%);transition:background .15s,transform .15s}
.m-deploy span{font:700 ${u(30)}/1 ${FONT};letter-spacing:.3em}
.m-deploy em{font-style:normal;font-weight:700;font-size:${u(13)};letter-spacing:.2em;opacity:.55}
.m-deploy:hover{background:var(--hud-amber);transform:translateX(${u(4)})}
.m-hint{margin-top:${u(18)};font-weight:600;font-size:${u(15)};letter-spacing:.14em;color:var(--hud-dim);display:flex;align-items:center;gap:${u(8)}}
.m-right{position:absolute;right:${u(110)};top:50%;transform:translateY(-50%);width:${u(470)};display:flex;flex-direction:column;gap:${u(26)}}
.m-right section{background:linear-gradient(180deg,rgba(14,16,18,.78),rgba(14,16,18,.6));border:${u(1)} solid rgba(255,255,255,.1);
  padding:${u(20)} ${u(24)} ${u(22)};position:relative}
.m-right section::before{content:'';position:absolute;left:${u(-1)};top:${u(-1)};width:${u(18)};height:${u(18)};border-left:${u(2)} solid var(--hud-amber);border-top:${u(2)} solid var(--hud-amber)}
.m-right h3{margin:0 0 ${u(14)};font-weight:700;font-size:${u(15)};letter-spacing:.34em;color:rgba(255,255,255,.55)}
.kbs{display:grid;grid-template-columns:1fr;gap:${u(7)}}
.kb{display:flex;align-items:center;gap:${u(14)};font-weight:500;font-size:${u(17)};color:rgba(240,238,230,.88)}
.kb kbd{min-width:${u(96)}!important;justify-content:center;font-size:${u(13)}!important;letter-spacing:.08em}
.sl{display:grid;grid-template-columns:1fr ${u(56)};align-items:center;row-gap:${u(8)};margin-top:${u(12)};pointer-events:auto}
.sl span{grid-column:1/3;font-weight:700;font-size:${u(14)};letter-spacing:.2em;color:rgba(255,255,255,.8)}
.sl b{font:700 ${u(18)}/1 ${NUM};text-align:right}
.sl input{-webkit-appearance:none;appearance:none;width:100%;height:${u(4)};background:rgba(255,255,255,.2);outline:none;margin:0;cursor:pointer}
.sl input::-webkit-slider-thumb{-webkit-appearance:none;width:${u(14)};height:${u(22)};background:#f2efe6;border:none;border-radius:0}
.sl input::-moz-range-thumb{width:${u(14)};height:${u(22)};background:#f2efe6;border:none;border-radius:0}
.m-foot{position:absolute;left:${u(110)};right:${u(110)};bottom:${u(40)};display:flex;justify-content:space-between;
  font-weight:600;font-size:${u(13)};letter-spacing:.3em;color:rgba(255,255,255,.35);border-top:${u(1)} solid rgba(255,255,255,.12);padding-top:${u(14)}}
`;
