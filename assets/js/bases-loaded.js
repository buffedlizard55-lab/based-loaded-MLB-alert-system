/* Narrow-purpose monitor: tied games, bottom of inning 9+, three occupied bases. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const currentEl = $('current'), historyEl = $('history'), statusEl = $('status');
  const seen = new Set();
  let soundEnabled = false, audio;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const keyFor = g => `${g.gamePk}:${g.linescore.currentInning}:${g.linescore.inningState}`;
  function qualifying(g) {
    const ls = g.linescore;
    if (!ls || !ls.teams || !ls.teams.away || !ls.teams.home) return false;
    const inning = Number(ls.currentInning), state = String(ls.inningState || '').toLowerCase();
    if (!Number.isFinite(inning) || inning < 9 || !state.includes('bottom')) return false;
    const away = Number(ls.teams.away.runs), home = Number(ls.teams.home.runs);
    const offense = ls.offense || {};
    const bases = offense.first && offense.second && offense.third;
    return Number.isFinite(away) && away === home && bases;
  }
  function details(g) {
    const ls = g.linescore, away = g.teams.away.team, home = g.teams.home.team;
    const inning = Number(ls.currentInning), score = `${ls.teams.away.runs}–${ls.teams.home.runs}`;
    return {key:keyFor(g), inning, text:`${away.name} at ${home.name} · ${score} tie · Bot ${inning}`, url:`game.html?gamePk=${encodeURIComponent(g.gamePk)}`};
  }
  function card(item, fresh=false) {
    return `<article class="alert-card" ${fresh?'style="border-color:#48d597"':''}><h2>${fresh?'<span class="alert-live">● ALERT</span> ':''}${esc(item.text)}</h2><p>All three bases occupied in a tied bottom of the ${item.inning}${item.inning===9?'th':'th'} or later.</p><p><a class="btn btn-ghost" href="${item.url}">Open game</a></p></article>`;
  }
  function announce(item) {
    if ('Notification' in window && Notification.permission === 'granted') new Notification('MLB bases loaded alert', {body:item.text, tag:item.key});
    if (soundEnabled) { try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); const o=audio.createOscillator(), gain=audio.createGain(); o.frequency.value=880; gain.gain.value=.12; o.connect(gain); gain.connect(audio.destination); o.start(); o.stop(audio.currentTime+.25); } catch (_) {} }
  }
  async function poll() {
    statusEl.textContent = 'Checking MLB…';
    try {
      const date = new Date().toISOString().slice(0,10);
      const games = await MLB.getSchedule(date);
      const active = games.filter(qualifying).map(details);
      active.forEach(item => { if (!seen.has(item.key)) { seen.add(item.key); announce(item); } });
      currentEl.innerHTML = active.length ? active.map(x=>card(x,true)).join('') : '<div class="alert-empty">No tied, bases-loaded situations in the bottom of the ninth or later right now.</div>';
      const rows = [...seen].slice(-30).reverse().map(key => {
        const [gamePk, inning, state] = key.split(':');
        const g = games.find(x=>String(x.gamePk)===gamePk);
        if (g) return details({...g, linescore:{...g.linescore,currentInning:Number(inning),inningState:state}});
        return {key, inning:Number(inning), text:`Game ${gamePk} · Bot ${inning}`, url:`game.html?gamePk=${encodeURIComponent(gamePk)}`};
      });
      historyEl.innerHTML = rows.length ? rows.map(x=>card(x)).join('') : '<div class="alert-empty">No qualifying alerts observed this session.</div>';
      statusEl.textContent = `Updated ${new Date().toLocaleTimeString()} · ${games.length} games`;
    } catch (error) { statusEl.textContent = `Update failed: ${error.message || error}`; }
  }
  $('notify').addEventListener('click', async () => { if (!('Notification' in window)) return alert('Notifications are not supported by this browser.'); const p=await Notification.requestPermission(); $('notify').textContent=p==='granted'?'🔔 Notifications enabled':'🔕 Notifications blocked'; });
  $('sound').addEventListener('click', e => { soundEnabled=!soundEnabled; e.currentTarget.textContent=soundEnabled?'🔊 Sound on':'🔇 Sound off'; });
  $('refresh').addEventListener('click', poll);
  poll(); setInterval(poll, 10000);
})();