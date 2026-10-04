/* Navigation and accessible presentation shared by every workspace. No mission model changes. */
(() => {
  'use strict';
  const script = document.currentScript;
  const staticRoot = new URL('./', script.src);
  const siteRoot = new URL('../', staticRoot);
  const path = location.pathname;
  const page = path.split('/').pop();
  const isLab = path.includes('/lab/');
  const active = isLab ? (page === 'configure.html' ? 'configure' : page === 'simulate.html' ? 'simulate' : ['satellite.html','satellites.html','modules.html'].includes(page) ? 'spacecraft' : 'experiments') : /customer/.test(page) ? 'customer' : /globe/.test(page) ? 'earth' : 'console';
  const links = [
    ['console','Mission','radio-tower','index.html','Mission control'],
    ['configure','Configure','sliders-horizontal','lab/configure.html','Configure an experiment'],
    ['simulate','Simulate','play','lab/simulate.html','Mission simulation'],
    ['experiments','Research','flask-conical','lab/index.html#experiments','Experiment catalog'],
    ['spacecraft','Spacecraft','satellite','lab/satellite.html','Spacecraft and payload designs'],
    ['customer','Payload','microscope','customer.html','Customer payload operations'],
    ['earth','Earth','globe-2','globe.html','Earth and ground track']
  ];
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  // Keep the supplied artwork intact; the CSS viewport trims its black margins.
  const logoURL = new URL('brand/space-philic-logo.png', staticRoot).href;
  const logoMarkup = () => `<span class="ws-logo-lockup"><img src="${logoURL}" alt="Space Philic" width="6000" height="3375" decoding="async"></span>`;
  function brandLink(extraClass = '') {
    const link = document.createElement('a');
    link.className = `ws-header-brand ${extraClass}`.trim();
    link.href = new URL('index.html', siteRoot).href;
    link.setAttribute('aria-label', 'Space Philic mission control');
    link.innerHTML = logoMarkup();
    return link;
  }
  const consoleBrand = document.querySelector('#topbar .brand-main');
  if (consoleBrand) consoleBrand.replaceChildren(brandLink());
  const labBrand = document.querySelector('.top .brand');
  if (labBrand) {
    Array.from(labBrand.childNodes).filter(node => node.nodeType === 3).forEach(node => node.remove());
    labBrand.insertAdjacentHTML('afterbegin', logoMarkup());
    labBrand.classList.add('ws-header-brand');
  }
  const globeHeading = document.querySelector('.globe-heading');
  if (globeHeading) globeHeading.prepend(brandLink('ws-brand-over-space'));
  const loadingBrand = document.querySelector('.ld-brand');
  if (loadingBrand) loadingBrand.innerHTML = logoMarkup();
  const rail = document.createElement('aside');
  rail.className = 'ws-rail';
  rail.setAttribute('aria-label','Space Philic workspaces');
  rail.innerHTML = `<nav aria-label="Workspaces">${links.map(([key,label,glyph,url,title]) => `<a class="ws-link" data-workspace-link="${key}" href="${new URL(url,siteRoot).href}" title="${title}" ${key===active?'aria-current="page"':''}>${icon(glyph)}<span>${label}</span></a>`).join('')}</nav><div class="ws-bottom"><button type="button" class="ws-theme" aria-label="Switch to dark theme" title="Switch to dark theme">${icon('moon')}<span>Dark</span></button><button type="button" class="ws-help" title="Workspace guide" aria-haspopup="dialog">${icon('circle-help')}<span>Guide</span></button><div class="ws-local">DIGITAL TWIN</div></div>`;
  const skip = document.createElement('a');
  skip.className = 'ws-skip'; skip.href = '#workspace-content'; skip.textContent = 'Skip to workspace';
  document.body.prepend(rail); document.body.prepend(skip);
  const main = document.querySelector('main') || document.querySelector('#c');
  if (main) {
    if (!main.id) main.id = 'workspace-content';
    skip.href = '#' + main.id;
    if (!main.hasAttribute('tabindex')) main.tabIndex = -1;
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'ws-dialog'; dialog.setAttribute('aria-labelledby','ws-guide-title');
  dialog.innerHTML = `<header><div><h2 id="ws-guide-title">Your mission workspace</h2><p>One tool for each stage of the journey.</p></div><button type="button" class="ws-close" aria-label="Close guide">${icon('x')}</button></header><div class="ws-guide"><div><strong>1. Configure</strong><span>Choose your spacecraft, experiment and protocol. Review the mission before you fly.</span></div><div><strong>2. Simulate</strong><span>Run the mission from launch through laboratory operations and recovery.</span></div><div><strong>3. Inspect</strong><span>Explore the spacecraft in 3D or follow the orbital track on Earth.</span></div><div><strong>4. Operate</strong><span>Use Mission for flight telemetry and Payload for customer experiment controls.</span></div></div><p>Navigate between workspaces in this tab. Choose “Open view” when you want a second window for comparison.</p><p>Switch between Light and Dark in the navigation. Your preference is saved on this browser.</p><p>Mission replay: <kbd>Space</kbd> play/pause · <kbd>←</kbd> / <kbd>→</kbd> events · <kbd>F</kbd> fullscreen.</p><p class="ws-footnote">This is a mission digital twin. Readiness, engineering estimates and biology scenarios are model outputs and require engineering validation.</p>`;
  document.body.append(dialog);
  const help = rail.querySelector('.ws-help');
  help.addEventListener('click',()=>dialog.showModal());
  dialog.querySelector('.ws-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>help.focus());
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  const syncSimulation = () => {
    if (active==='configure') rail.querySelector('a[href*="simulate.html"]').href = new URL('lab/simulate.html'+location.hash,siteRoot).href;
  };
  syncSimulation(); window.addEventListener('hashchange',syncSimulation);
  rail.querySelector('a[href*="simulate.html"]').addEventListener('click',syncSimulation);
  const themeButton = rail.querySelector('.ws-theme');
  function syncTheme() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const target = dark ? 'light' : 'dark';
    themeButton.innerHTML = icon(dark ? 'sun' : 'moon') + `<span>${dark ? 'Light' : 'Dark'}</span>`;
    themeButton.setAttribute('aria-label', `Switch to ${target} theme`);
    themeButton.title = `Switch to ${target} theme`;
    refresh();
  }
  themeButton.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    if (window.WorkspaceTheme) window.WorkspaceTheme.set(theme);
    else { document.documentElement.dataset.theme = theme; syncTheme(); }
  });
  window.addEventListener('workspace:theme', syncTheme);
  let scheduled = false;
  function refresh() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(()=>{
      scheduled=false;
      if (window.lucide && document.querySelector('i[data-lucide]')) window.lucide.createIcons({attrs:{'aria-hidden':'true','focusable':'false'}});
      document.querySelectorAll('a[href]').forEach(a=>{
        if(a.classList.contains('ws-skip')||a.hasAttribute('download'))return;
        const href=a.getAttribute('href');if(!href||href.startsWith('#'))return;
        try{const u=new URL(href,location.href);if(u.origin===location.origin&&a.id!=='open-focused-view'&&!a.hasAttribute('data-new-tab')){a.removeAttribute('target');a.removeAttribute('rel');const title=a.getAttribute('title');if(title&&/new tab/i.test(title))a.removeAttribute('title');}}catch(_){/* Non-navigation href. */}
      });
    });
  }
  window.WorkspaceUI = {refresh};
  const library=document.createElement('script');library.src=new URL('vendor/lucide.min.js',staticRoot).href;library.onload=refresh;document.head.append(library);
  const observer=new MutationObserver(records=>{if(records.some(r=>Array.from(r.addedNodes).some(n=>n.nodeType===1&&(n.matches('i[data-lucide],a[href]')||n.querySelector('i[data-lucide],a[href]')))))refresh();});
  observer.observe(document.body,{childList:true,subtree:true});
  syncTheme();
  refresh();

  // A bounded, first-arrival welcome. Mission loading never controls its lifetime.
  function introduceBrand() {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    // Explicit autoplay links should start immediately at the requested moment.
    if (new URLSearchParams(location.search).get('play') === '1' || new URLSearchParams(location.hash.slice(1)).get('play') === '1') return;
    const sessionKey = 'space-philic:brand-welcome:v1';
    try {
      if (sessionStorage.getItem(sessionKey)) return;
      sessionStorage.setItem(sessionKey, 'seen');
    } catch (_) { return; } // Avoid replaying a welcome when storage is unavailable.
    if (motion.matches || typeof HTMLDialogElement === 'undefined') return;
    const welcome = document.createElement('dialog');
    if (typeof welcome.showModal !== 'function') return;
    welcome.className = 'ws-brand-intro';
    welcome.setAttribute('aria-label', 'Welcome to Space Philic');
    welcome.innerHTML = `<div class="ws-intro-stars" aria-hidden="true"></div><div class="ws-intro-stage"><div class="ws-intro-orbit" aria-hidden="true"><i></i></div><div class="ws-intro-logo">${logoMarkup()}</div><p class="ws-intro-caption">MISSION DIGITAL TWIN</p></div><button type="button" class="ws-intro-skip" autofocus>Enter workspace <span aria-hidden="true">↗</span></button>`;
    document.body.append(welcome);
    let timer;
    let closing = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      motion.removeEventListener('change', onMotionChange);
      welcome.remove();
    };
    const finish = (immediate = false) => {
      if (closing && !immediate) return;
      closing = true;
      window.clearTimeout(timer);
      if (immediate) { welcome.close(); cleanup(); return; }
      welcome.classList.add('ws-intro-leaving');
      timer = window.setTimeout(() => { welcome.close(); cleanup(); }, 220);
    };
    const onMotionChange = event => { if (event.matches) finish(true); };
    welcome.querySelector('button').addEventListener('click', () => finish(true));
    welcome.addEventListener('cancel', event => { event.preventDefault(); finish(true); });
    welcome.addEventListener('keydown', event => event.stopPropagation());
    welcome.addEventListener('close', cleanup, { once: true });
    motion.addEventListener('change', onMotionChange);
    try { welcome.showModal(); }
    catch (_) { cleanup(); return; }
    timer = window.setTimeout(() => finish(), 1800);
  }
  introduceBrand();
})();
