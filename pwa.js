(() => {
  'use strict';
  const status = document.getElementById('pwa-status');
  const install = document.getElementById('pwa-install');
  const help = document.getElementById('pwa-help');
  const dialog = document.getElementById('pwa-dialog');
  const update = document.getElementById('pwa-update');
  let installPrompt;
  let playing = false;
  let ready = false;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  function renderStatus() {
    status.textContent = ready
      ? 'オフラインの じゅんびが できたよ' + (navigator.onLine ? '' : '（オフライン）')
      : 'オフラインの じゅんびを しているよ…';
  }
  function renderButtons() {
    install.hidden = !installPrompt || standalone();
    install.disabled = playing;
    help.disabled = playing;
  }
  document.addEventListener('mogura:playing', (event) => {
    playing = event.detail === true;
    renderButtons();
  });
  help.addEventListener('click', () => { if (!playing) dialog.showModal(); });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    renderButtons();
  });
  window.addEventListener('appinstalled', () => { installPrompt = undefined; renderButtons(); });
  install.addEventListener('click', async () => {
    if (!installPrompt || playing) return;
    const prompt = installPrompt;
    installPrompt = undefined;
    renderButtons();
    try { await prompt.prompt(); await prompt.userChoice; }
    catch { status.textContent = 'ついかできなかったよ。「アプリの つかいかた」を みてね。'; }
  });
  for (const name of ['online', 'offline']) window.addEventListener(name, () => { if (ready) renderStatus(); });
  renderButtons();

  function checkOffline(worker) {
    if (!worker) return;
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      if (!ready) status.textContent = 'じゅんびを かくにんできなかったよ。つうしんできる ときに、ひらきなおしてね。';
    }, 6000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      channel.port1.close();
      ready = event.data?.type === 'OFFLINE_STATUS' && event.data.ready === true;
      if (ready) renderStatus();
      else status.textContent = 'オフラインの じゅんびが まだだよ。つうしんできる ときに、ひらきなおしてね。';
    };
    try { worker.postMessage({ type: 'CHECK_OFFLINE' }, [channel.port2]); }
    catch { clearTimeout(timeout); channel.port1.close(); status.textContent = 'じゅんびを かくにんできなかったよ。あとで ひらきなおしてね。'; }
  }
  async function register() {
    if (!('serviceWorker' in navigator)) {
      status.textContent = 'この ブラウザでは、つうしんしながら あそんでね。';
      return;
    }
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
      const showWaiting = () => { update.hidden = !(registration.active && registration.waiting); };
      showWaiting();
      const observeInstalling = (worker) => {
        if (!worker) return;
        const inspect = () => {
          if (worker.state === 'installed') showWaiting();
          if (worker.state === 'redundant' && !ready) status.textContent = 'じゅんびが できなかったよ。つうしんを たしかめて、あとで ひらきなおしてね。';
        };
        worker.addEventListener('statechange', inspect);
        inspect();
      };
      registration.addEventListener('updatefound', () => observeInstalling(registration.installing));
      observeInstalling(registration.installing);
      const active = await navigator.serviceWorker.ready;
      checkOffline(active.active);
    } catch {
      status.textContent = 'じゅんびが できなかったよ。つうしんできる ときに、ひらきなおしてね。';
    }
  }
  // Waiting updates activate naturally only after every old controlled client closes.
  // Never force activation, claim an existing game, or reload a playing page.
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => { void register(); }, { once: true });
})();
