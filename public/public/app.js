const $ = (s) => document.querySelector(s);

function carpSVG(){
  return `
<svg viewBox="0 0 200 120" aria-label="Carp winner">
  <defs><linearGradient id="g2" x1="0" x2="1"><stop offset="0%" stop-color="#ffd166"/><stop offset="100%" stop-color="#f6a700"/></linearGradient></defs>
  <ellipse cx="100" cy="60" rx="75" ry="38" fill="url(#g2)" stroke="#b37a00" stroke-width="2"/>
  <polygon points="160,60 192,36 192,84" fill="#f6a700" stroke="#b37a00" stroke-width="2"/>
  <circle cx="85" cy="55" r="6" fill="#4b3200"/>
</svg>`;
}

function breamSVG(){
  return `
<svg viewBox="0 0 200 120" aria-label="Bream ticket">
  <defs><linearGradient id="g1" x1="0" x2="1"><stop offset="0%" stop-color="#7aa8d4"/><stop offset="100%" stop-color="#496c9a"/></linearGradient></defs>
  <ellipse cx="100" cy="60" rx="70" ry="35" fill="url(#g1)" stroke="#355279" stroke-width="2"/>
  <polygon points="160,60 190,40 190,80" fill="#5d80ad" stroke="#355279" stroke-width="2"/>
  <circle cx="80" cy="55" r="6" fill="#0b1220"/>
</svg>`;
}

function ticketEl(kind){
  const el = document.createElement('div');
  el.className = 'ticket' + (kind === 'carp' ? ' win' : '');
  const id = `TT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
  el.innerHTML = `
    <div class="id">${id}</div>
    <div class="fish">${kind === 'carp' ? carpSVG() : breamSVG()}</div>
    ${kind === 'carp' ? '<div class="win-badge">WINNER</div>' : ''}
  `;
  return el;
}

async function draw(n){
  const res = await fetch('/api/draw?count=' + n, { method:'POST' });
  if(!res.ok){ alert('Server error: ' + res.status); return; }
  const data = await res.json(); // { results: ['bream' | 'carp', ...] }
  const wrap = $('#tickets');
  data.results.forEach(kind => {
    const el = ticketEl(kind);
    wrap.prepend(el);
    if(kind === 'carp') confetti();
  });
}

function confetti(){
  const c = document.getElementById('confetti');
  const count = 80;
  for(let i=0;i<count;i++){
    const p = document.createElement('div');
    p.className = 'piece';
    p.style.left = (Math.random()*100)+'vw';
    p.style.top = (-10 - Math.random()*40)+'vh';
    p.style.background = ['#62d1ff','#2ee6a8','#ffd166','#ffffff'][i%4];
    p.style.animationDuration = (1 + Math.random()*1.5)+'s';
    c.appendChild(p);
    setTimeout(()=>p.remove(), 2500);
  }
}

$('#draw1').addEventListener('click', ()=>draw(1));
$('#draw5').addEventListener('click', ()=>draw(5));
$('#draw10').addEventListener('click', ()=>draw(10));
$('#clear').addEventListener('click', ()=> $('#tickets').innerHTML = '');
