'use strict';

const $ = (id) => document.getElementById(id);
const bg = (msg) => chrome.runtime.sendMessage(msg);
let filledForm = false;
let lastChatLen = -1;

async function refresh() {
  const s = await bg({ cmd: 'status' });
  if (!s) return;

  if (!filledForm) {
    filledForm = true;
    const cfg = s.cfg || {};
    $('server').value = cfg.server || '';
    $('room').value = cfg.room || '';
    $('name').value = cfg.name || '';
  }

  const conn = $('conn');
  if (s.connected && s.myId) { conn.className = 'conn ok'; $('connLabel').textContent = 'Conectado'; }
  else if (s.active) { conn.className = 'conn wait'; $('connLabel').textContent = 'Conectando…'; }
  else { conn.className = 'conn'; $('connLabel').textContent = 'Desconectado'; }

  $('setup').hidden = s.active;
  $('live').hidden = !s.active;
  $('error').hidden = !s.lastError;
  $('error').textContent = s.lastError || '';
  if (s.active && s.lastError && !s.connected) {
    // mostra o erro também com a tela de "conectado"
    $('setup').hidden = false;
  }
  if (!s.active) return;

  $('roomLabel').textContent = s.cfg.room;
  $('ping').textContent = s.rtt != null ? `${s.rtt} ms` : '—';

  // Aba sincronizada
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (s.syncedTab) {
    $('tabTitle').textContent = s.syncedTab.title || s.syncedTab.url;
    $('tabTitle').className = 'tab-title ok';
  } else {
    $('tabTitle').textContent = 'Nenhuma';
    $('tabTitle').className = 'tab-title';
  }
  const isSynced = current && s.syncedTab && current.id === s.syncedTab.id;
  $('syncTabBtn').textContent = isSynced ? 'Sincronizar de novo' : 'Sincronizar esta aba';

  // O que a sala está assistindo
  if (s.partnerMedia && !s.partnerMedia.same) {
    $('partnerCard').hidden = false;
    $('partnerTitle').textContent = `${s.partnerMedia.title || s.partnerMedia.url}${s.partnerMedia.by ? ` (${s.partnerMedia.by})` : ''}`;
  } else {
    $('partnerCard').hidden = true;
  }

  // Pessoas
  const ul = $('members');
  ul.textContent = '';
  for (const m of s.members || []) {
    const li = document.createElement('li');
    const n = document.createElement('span');
    n.textContent = m.name + (m.id === s.myId ? ' (você)' : '');
    const meta = document.createElement('span');
    meta.className = 'meta';
    if (m.buffering) meta.textContent = 'carregando';
    else if (m.drift != null) {
      meta.textContent = `${Math.abs(m.drift)} ms`;
      if (Math.abs(m.drift) <= 80) meta.className = 'meta good';
    } else meta.textContent = m.client === 'ext' ? 'extensão' : 'site';
    li.append(n, meta);
    ul.appendChild(li);
  }

  // Chat
  if ((s.chat || []).length !== lastChatLen) {
    lastChatLen = s.chat.length;
    const box = $('chat');
    box.textContent = '';
    for (const m of s.chat) {
      const d = document.createElement('div');
      d.className = m.sys ? 'm sys' : 'm';
      if (m.sys) d.textContent = m.text;
      else {
        const b = document.createElement('b');
        b.textContent = m.name;
        d.append(b, document.createTextNode(m.text));
      }
      box.appendChild(d);
    }
    box.scrollTop = box.scrollHeight;
  }
}

$('connectBtn').onclick = async () => {
  const cfg = {
    server: $('server').value.trim(),
    room: $('room').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32),
    name: $('name').value.trim().slice(0, 24) || 'Anônimo',
  };
  if (!cfg.server || !cfg.room) {
    $('error').hidden = false;
    $('error').textContent = 'Preencha o servidor e a sala.';
    return;
  }
  await bg({ cmd: 'connect', cfg });
  refresh();
};

$('disconnectBtn').onclick = async () => { await bg({ cmd: 'disconnect' }); filledForm = false; refresh(); };

$('syncTabBtn').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const r = await bg({ cmd: 'syncTab', tabId: tab.id });
  if (r && !r.ok) {
    $('error').hidden = false;
    $('error').textContent = r.error || 'Não deu para sincronizar essa aba.';
  }
  refresh();
};

$('openPartnerBtn').onclick = async () => { await bg({ cmd: 'openPartner' }); refresh(); };

$('chatForm').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('chatInput').value.trim();
  if (!text) return;
  $('chatInput').value = '';
  await bg({ cmd: 'chat', text });
  refresh();
};

refresh();
setInterval(refresh, 1000);
