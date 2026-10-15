/** Aurora editorial identity. Semantic colors qualify evidence, never fabricate it. */
export function auroraIdentityMark(): string {
  return '<div class="entry-brand"><img src="/aurora-icon.svg" alt="" width="44" height="44"><div><span class="entry-brand-name">Aurora Nexus</span><small>Clareza para decidir</small></div></div>';
}

export function auroraDesignStyles(): string {
  return `
@font-face{font-family:'Source Serif 4';src:url('/assets/fonts/source-serif-4-regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}

@font-face{font-family:'Source Serif 4';src:url('/assets/fonts/source-serif-4-semibold.woff2') format('woff2');font-weight:600;font-style:normal;font-display:swap}

@font-face{font-family:'Atkinson Hyperlegible Next';src:url('/assets/fonts/atkinson-hyperlegible-next.woff2') format('woff2');font-weight:200 800;font-style:normal;font-display:swap}

:root{color-scheme:light;--bg:#f7f2e9;--panel:#fffdf8;--panel2:#efe8da;--ink:#073b4c;--text:#173f48;--muted:#53656a;--line:#d9d4c7;--gold:#c59a45;--ok:#246647;--warn:#86501a;--danger:#a53328;--info:#175a70;--shadow:0 8px 30px #073b4c08;--radius:16px}

*{box-sizing:border-box}
[hidden]{display:none!important}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 'Atkinson Hyperlegible Next',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
button,input,select,textarea{font:inherit}
a{color:var(--ink)}
button,a,input,select,textarea,summary{touch-action:manipulation}
button:disabled{cursor:default;opacity:.55}
input,select,textarea{width:100%;padding:11px 12px;border:1px solid #a6b1ad;border-radius:9px;background:#fffdf8;color:var(--ink);min-height:44px}
input[type=checkbox]{width:auto;min-height:auto}
textarea{resize:vertical}
label{display:grid;gap:7px;font-size:14px;color:var(--text)}
:focus-visible{outline:3px solid var(--info);outline-offset:4px}
::selection{background:#e8d4a6;color:var(--ink)}
.skip-link{position:fixed;top:-100px;left:20px;z-index:20;background:var(--panel);padding:12px;border-radius:8px}
.skip-link:focus{top:10px}

.top{position:sticky;top:0;z-index:8;height:80px;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px 32px;background:var(--ink);border-bottom:1px solid #c59a4560;color:var(--bg)}
.brand{display:flex;gap:12px;align-items:center;color:var(--bg);text-decoration:none}
.brand img{width:42px;height:42px;border-radius:10px}
.brand-name{font-family:'Source Serif 4',Georgia,serif;font-size:23px;line-height:1.1;font-weight:600;letter-spacing:.01em}
.brand small{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.18em;color:#d4b774;margin-top:4px}
.entry-brand{display:flex;align-items:center;gap:12px;margin-bottom:26px}
.entry-brand img{width:44px;height:44px;flex:0 0 44px;border-radius:10px}
.entry-brand-name{display:block;font:600 25px/1.15 'Source Serif 4',Georgia,serif;color:var(--ink)}
.entry-brand small{display:block;color:#81632e;font-size:10px;letter-spacing:.14em;text-transform:uppercase;margin-top:5px}
.identity{display:flex;align-items:center;gap:12px;font-size:13px;color:#d7e2e0}
.session-role{display:block;color:#d4b774;font-size:11px}
.btn{display:inline-flex;justify-content:center;align-items:center;gap:8px;min-height:44px;border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--ink);padding:10px 16px;font-weight:600;text-decoration:none;cursor:pointer;line-height:1.25;transition:background .15s,border-color .15s}
.btn:hover{background:#efe8da;border-color:#a78c51}
.btn.primary{background:var(--ink);border-color:var(--ink);color:#fffdf8}
.btn.primary:hover{background:#105064}
.top .btn{background:transparent;color:var(--bg);border-color:#ffffff40}
.top .btn:hover{background:#ffffff15}
.menu-toggle{display:none}
.layout{display:grid;grid-template-columns:248px minmax(0,1fr);min-height:calc(100vh - 80px)}
aside{background:var(--ink);border-right:1px solid #c59a4540;padding:30px 18px;color:var(--bg);position:sticky;top:80px;align-self:start;height:calc(100vh - 80px);display:flex;flex-direction:column;overflow:auto}
.nav-label{color:#c5d1cd;display:block;letter-spacing:.15em;text-transform:uppercase;font-size:10px;margin:8px 14px 12px}
.nav-label.master{margin-top:24px;color:#d4b774}
nav a{display:flex;align-items:center;gap:13px;min-height:48px;padding:11px 14px;border-radius:10px;margin:4px 0;text-decoration:none;font-size:15px;color:#d5e0dc;border:1px solid transparent}
nav a .nav-index{color:#aac0c0;font-size:11px;width:18px}
nav a:hover{color:#fffdf8;background:#ffffff0a}
nav a.active{background:#f7f2e9;color:var(--ink);font-weight:700;border-color:#c59a4550}
nav a.active .nav-index{color:#896629}
.nav-footer{margin-top:auto;padding:24px 14px 0;color:#bed0ce;font-size:12px}
.nav-footer b{display:block;color:#d4b774;letter-spacing:.12em;font-size:10px;text-transform:uppercase;margin-bottom:6px}
main{padding:34px 40px 50px;max-width:1600px;width:100%;min-width:0}
.headline{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:22px}
.eyebrow{color:#81632e;font-size:11px;text-transform:uppercase;letter-spacing:.16em;font-weight:700;margin:0 0 9px}
.headline h1{font-family:'Source Serif 4',Georgia,serif;font-size:clamp(30px,3vw,42px);font-weight:600;line-height:1.15;margin:0 0 9px;letter-spacing:-.025em}
.headline p{margin:0;color:var(--muted);max-width:600px}
.head-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.badge,.pill{display:inline-flex;align-items:center;padding:6px 10px;border:1px solid var(--line);border-radius:99px;font-size:12px;color:var(--muted);background:#fffdf890}
.sub{font-size:13px;line-height:1.55;color:var(--muted)}
.sync-line{display:flex;justify-content:space-between;gap:12px;margin:8px 0 24px;font-size:12px;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.card{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);padding:22px;min-width:0;box-shadow:var(--shadow)}
.card .label,.label{color:var(--muted);font-size:12px;font-weight:600;letter-spacing:.03em}
.value{font-size:clamp(22px,2.3vw,32px);line-height:1.2;font-weight:700;letter-spacing:-.03em;margin:12px 0 8px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.grid>.card{container-type:inline-size}
.grid>.card>.value{font-size:clamp(18px,12cqi,32px)}
.value.ok{color:var(--ok)}
.value.warn{color:var(--warn)}
.value.danger{color:var(--danger)}
.impact{position:relative;overflow:hidden}
.impact:before{content:'';position:absolute;inset:0 auto 0 0;width:3px;background:var(--info)}
.impact.ok:before{background:var(--ok)}
.impact.warn:before{background:var(--warn)}
.impact.danger:before{background:var(--danger)}
.impact.info:before{background:var(--info)}
.play-chip{display:inline-flex;font-size:11px;font-weight:600;padding:3px 8px;border-radius:99px;margin-top:10px;background:#f0e6d3;color:#75521f}
.impact.danger .play-chip{background:#fae5df;color:var(--danger)}
.impact.ok .play-chip{background:#eaf1e7;color:var(--ok)}
.section{margin-top:24px;scroll-margin-top:110px}
.section h2,.card h2{font-family:'Source Serif 4',Georgia,serif;font-size:23px;line-height:1.25;font-weight:600;margin:0 0 12px}
.section-intro{display:flex;align-items:center;justify-content:space-between;gap:15px;margin:28px 0 14px}
.section-intro h2{font-family:'Source Serif 4',Georgia,serif;font-size:24px;font-weight:600;margin:0}
.section-intro p{margin:3px 0 0;font-size:13px;color:var(--muted)}
.split{display:grid;grid-template-columns:1.25fr .75fr;gap:18px}
.action-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:0 0 20px}
.action-summary .value{font-size:30px}
.action-input-grid,.control-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:end}
.action-input-grid .wide{grid-column:span 2}
.native-actions{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}
.native-output{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65;min-height:70px;font-size:14px;padding:18px;background:#f4f0e7;border-radius:10px}
.native-meta{font-size:12px;color:var(--info);margin:12px 0}
.modules{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.module{display:flex;gap:12px;align-items:start;padding:14px;border:1px solid var(--line);border-radius:10px;font-size:13px}
.module b{color:var(--ink);min-width:20px}
.module span{color:var(--muted);overflow-wrap:anywhere}
.activity-list,.source-status-list,.release-list{display:grid;gap:10px;margin-top:16px}
.activity-row,.source-status-row{display:flex;justify-content:space-between;align-items:start;gap:16px;padding:16px 0;border-bottom:1px solid var(--line)}
.activity-row b,.source-status-row b{display:block}
.activity-row span,.source-status-row span{color:var(--muted);font-size:12px;text-align:right}
.table-wrap{overflow:auto;max-width:100%}
.table{width:100%;border-collapse:collapse;font-size:14px}
.table th,.table td{text-align:left;padding:14px 12px;border-bottom:1px solid var(--line);vertical-align:top}
.table th{color:var(--muted);font-size:11px;letter-spacing:.05em;text-transform:uppercase;font-weight:600}
.table td .btn{white-space:nowrap}
.empty{padding:30px;text-align:center;color:var(--muted)}
.error{border-color:var(--danger);color:var(--danger);background:#fff5f0}
.loading{opacity:.65}
.release-gate{display:grid;grid-template-columns:auto 1fr;gap:12px;padding:12px;border:1px solid var(--line);border-radius:10px}
.release-dot{width:8px;height:8px;border-radius:50%;background:var(--muted);margin-top:6px}
.release-dot.done{background:var(--ok)}
.release-dot.blocked{background:var(--danger)}
.release-dot.in-progress{background:var(--warn)}
.implant-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}
.implant-step{border:1px solid var(--line);border-radius:10px;padding:16px;background:var(--panel)}
.implant-step b{display:block;font-size:11px;color:#81632e;text-transform:uppercase;letter-spacing:.08em}
.implant-step span{display:block;margin-top:7px;font-size:13px;overflow-wrap:anywhere}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}

.financial-focus{display:grid;grid-template-columns:1.15fr 1fr;grid-template-areas:'heading amount' 'explanation amount';gap:12px 28px;position:relative;overflow:hidden;padding:32px 36px;border-radius:18px;background:var(--ink);color:var(--bg);border:1px solid #c59a4560}
.focus-heading{grid-area:heading}
.financial-focus .focus-explanation{grid-area:explanation;margin:0}
.financial-focus:after{content:'';position:absolute;width:480px;height:480px;border:1px solid #c59a4545;border-radius:50%;right:-240px;top:-250px;pointer-events:none}
.financial-focus .eyebrow{color:#d8b775}
.financial-focus h2{font-family:'Source Serif 4',Georgia,serif;font-size:clamp(27px,2.7vw,39px);font-weight:400;line-height:1.15;letter-spacing:-.02em;margin:12px 0 0;max-width:450px}
.financial-focus p{font-size:13px;line-height:1.6;color:#d3e0dc;max-width:530px;margin:12px 0 0}
.focus-amount{grid-area:amount;align-self:center;padding:14px 0 14px 32px;border-left:1px solid #ffffff25;position:relative;z-index:1}
.focus-amount .label{color:#d3e0dc;letter-spacing:.03em}
.focus-value{font-size:clamp(32px,3.7vw,54px);font-weight:700;letter-spacing:-.04em;line-height:1.15;color:#f3d399;margin:14px 0 10px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.financial-focus.danger .focus-value{color:#ffb8a3}
.focus-period{font-size:12px;color:#c4d5d2;display:block}
.financial-focus .btn{background:#f4e5c4;color:var(--ink);border-color:#f4e5c4;margin-top:20px}
.financial-focus .btn:hover{background:#fff5df}
.focus-ribbon{font-size:10px;border:1px solid #d8b77565;border-radius:99px;padding:4px 9px;display:inline-flex;color:#f3d399;margin-left:8px;letter-spacing:.06em;text-transform:uppercase}
.quick-links{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:20px}
.quick-link{display:flex;gap:14px;justify-content:space-between;align-items:center;border:1px solid var(--line);border-radius:12px;padding:16px 20px;background:var(--panel);text-decoration:none;font-size:14px}
.quick-link span{display:block;font-size:12px;color:var(--muted);margin-top:4px}
.quick-link:hover{border-color:#a58b53;background:#fbf7ed}
.quick-arrow{color:#81632e;font-size:21px}
.disclosure{border:1px solid var(--line);background:var(--panel);border-radius:var(--radius);margin:20px 0;padding:0 22px;box-shadow:var(--shadow)}
.disclosure>summary{min-height:56px;cursor:pointer;padding:16px 0;color:var(--ink);font-weight:600;font-size:14px}
.disclosure>summary span{font-size:12px;font-weight:400;color:var(--muted);margin-left:10px}
.disclosure[open]{padding-bottom:22px}
.disclosure .card{box-shadow:none}
.disclosure .card.section{margin-top:10px}
.guide-card{border-left:3px solid var(--gold);background:#f1e9d9;padding:18px 22px;border-radius:0 12px 12px 0;font-size:14px;margin-bottom:22px}
.guide-card b{display:block;margin-bottom:4px}
.data-alert{display:flex;align-items:start;gap:12px;padding:14px 18px;background:#f2e9d9;border:1px solid #d4bd8e;border-radius:10px;font-size:13px;color:#62471e;margin:16px 0}
.data-alert .pill{color:#62471e;border-color:#d4bd8e;white-space:nowrap}
.attention-list{display:grid;gap:10px;margin-top:16px}
.attention-item{border-left:3px solid var(--warn);padding:12px 16px;background:#f5ead9;border-radius:0 10px 10px 0}
.attention-item.danger{border-color:var(--danger);background:#fae9e3}
.attention-item b{display:block;font-size:14px}
.attention-item p{font-size:13px;margin:4px 0;color:var(--muted)}
.page-section{scroll-margin-top:110px}
.page-section>h2{font-family:'Source Serif 4',Georgia,serif;font-size:30px;font-weight:600;margin:0 0 14px}
.studio-columns{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr);gap:20px}
.studio-steps{display:flex;flex-wrap:wrap;gap:10px;padding:0;list-style:none}
.studio-steps li{background:#efe8da;border-radius:99px;padding:8px 12px;font-size:12px}
.studio-steps li[data-step-state=current]{background:var(--ink);color:var(--bg);box-shadow:inset 0 -2px 0 var(--gold);font-weight:700}
.studio-steps li[data-step-state=complete]{background:#eaf1e7;color:var(--ok)}
.studio-steps li[data-step-state=blocked]{background:#f4ead8;color:#62471e;border:1px solid #d4bd8e}
.master-onboarding{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px 22px;margin-bottom:20px;background:var(--panel2);border-left:3px solid var(--gold);border-radius:0 12px 12px 0}
.master-onboarding p{margin:4px 0 0;color:var(--muted);font-size:14px}
.master-onboarding .btn{flex-shrink:0}
.master-validation-summary{border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:0 10px 10px 0;background:var(--panel);padding:16px 18px;margin:16px 0}
.master-validation-summary[data-tone=ok]{border-left-color:var(--ok)}
.master-validation-summary[data-tone=warn]{border-left-color:var(--warn)}
.master-validation-summary[data-tone=danger]{border-left-color:var(--danger)}
.master-validation-heading{display:block;font-weight:700;color:var(--ink)}
.master-validation-detail{margin:6px 0 0;color:var(--muted);font-size:14px}
.studio-diff{font:12px/1.6 Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:#eae7df;border-radius:10px;max-height:450px;overflow:auto}
.studio-status{color:var(--muted);font-size:13px}

.control-grid .wide{grid-column:1/-1}
.headline .badge{white-space:nowrap}
.head-actions{flex-shrink:0}
.attention-empty{margin-top:16px}

@media(min-width:1400px){main{padding-right:56px;padding-left:56px}
.financial-focus{padding:36px 40px}
}

@media(max-width:1150px){.layout{grid-template-columns:216px minmax(0,1fr)}
main{padding:28px}
.grid{grid-template-columns:repeat(2,minmax(0,1fr))}
.split{grid-template-columns:1fr}
.financial-focus{gap:20px;padding:28px}
.focus-value{font-size:36px}
.quick-links{grid-template-columns:repeat(3,minmax(0,1fr))}
.quick-link{padding:14px}
.implant-strip{grid-template-columns:repeat(2,minmax(0,1fr))}
.studio-columns{grid-template-columns:1fr}
.master-onboarding{align-items:flex-start;flex-direction:column;gap:12px}
}

@media(max-width:800px){.top{height:72px;padding:12px 18px}
.brand-name{font-size:21px}
.brand img{width:36px;height:36px}
.brand small{font-size:9px}
.layout{grid-template-columns:1fr}
.menu-toggle{display:inline-flex}
.identity span{display:none}
aside{display:none;position:fixed;top:72px;bottom:0;left:0;width:min(320px,88vw);height:calc(100vh - 72px);z-index:9;box-shadow:8px 0 25px #073b4c40}
aside.menu-open{display:flex}
main{padding:25px 20px 36px}
.headline{align-items:start;flex-direction:column;gap:16px}
.headline h1{font-size:34px}
.headline p{font-size:14px}
.head-actions{width:100%;justify-content:space-between}
.financial-focus{grid-template-columns:1fr;grid-template-areas:'heading' 'amount' 'explanation';padding:26px;gap:22px}
.financial-focus h2{font-size:33px}
.focus-amount{border-left:0;border-top:1px solid #ffffff25;padding:22px 0 0}
.focus-value{font-size:42px}
.quick-links{grid-template-columns:1fr}
.quick-link{padding:14px 18px}
.section{scroll-margin-top:92px}
.action-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
.modules{grid-template-columns:1fr}
.activity-row,.source-status-row{flex-wrap:wrap}
.activity-row span,.source-status-row span{text-align:left}
.section-intro{align-items:start}
.sync-line{flex-direction:column;gap:4px}
.control-grid{grid-template-columns:1fr 1fr}
}

@media(max-width:440px){main{padding:22px 16px}
.top{padding:12px}
.brand-name{font-size:19px}
.brand small{letter-spacing:.11em}
.identity{gap:6px}
.top .btn{padding:8px 10px;font-size:13px}
.grid{grid-template-columns:1fr}
.card{padding:20px}
.action-summary{gap:10px}
.action-summary .card{padding:16px}
.action-summary .value{font-size:26px}
.action-input-grid,.control-grid{grid-template-columns:1fr}
.action-input-grid .wide{grid-column:span 1}
.focus-value{font-size:36px}
.financial-focus{padding:23px}
.implant-strip{grid-template-columns:1fr}
.disclosure{padding:0 18px}
.disclosure>summary span{display:block;margin:5px 0 0}
}

@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}
*{transition:none!important}
}

`;
}
