// Browser side. It holds no key: it sends microphone audio to this app's own server at /live.
const $ = (id) => document.getElementById(id);
const live = $('live'), errorBox = $('error'), button = $('record');
let session = null;

function show(finals, interim) {
  live.textContent = finals.join(' ');
  if (interim) { const i = document.createElement('i'); i.textContent = ` ${interim}`; live.append(i); }
}

async function start() {
  errorBox.textContent = '';
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const context = new AudioContext();
  await context.audioWorklet.addModule('/pcm-worklet.js');
  const source = context.createMediaStreamSource(mic);
  const pcm = new AudioWorkletNode(context, 'pcm');
  source.connect(pcm);

  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${scheme}://${location.host}/live?sample_rate=${context.sampleRate}`);
  socket.binaryType = 'arraybuffer';
  const finals = [];
  pcm.port.onmessage = (e) => { if (socket.readyState === WebSocket.OPEN) socket.send(e.data); };

  socket.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'interim') show(finals, m.text);
    if (m.type === 'final') { if (m.text) finals.push(m.text); show(finals, ''); }
    if (m.type === 'error') errorBox.textContent = m.message;
    if (m.type === 'saved') { live.textContent = ''; loadNotes(); }
  };
  socket.onclose = () => { if (session) stop(); };
  session = { mic, context, socket };
  button.dataset.on = '1';
  button.textContent = 'Stop';
}

function stop() {
  const s = session;
  session = null;
  button.dataset.on = '0';
  button.textContent = 'Start recording';
  if (!s) return;
  s.mic.getTracks().forEach((t) => t.stop());
  s.context.close();
  if (s.socket.readyState === WebSocket.OPEN) s.socket.send(JSON.stringify({ type: 'stop' }));
}

async function loadNotes() {
  const notes = await (await fetch('/api/notes')).json();
  $('notes').replaceChildren(...notes.map((n) => {
    const li = document.createElement('li');
    const when = document.createElement('small');
    when.textContent = `${new Date(n.createdAt).toLocaleString()} · ${n.seconds} s`;
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.onclick = async () => { await fetch(`/api/notes/${n.id}`, { method: 'DELETE' }); loadNotes(); };
    li.append(when, n.text, document.createElement('br'), del);
    return li;
  }));
}

button.onclick = () => (session ? stop() : start().catch((e) => { errorBox.textContent = e.message; stop(); }));
loadNotes();
