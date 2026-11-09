/* =====================================================================
   Insegnante 인트로
   1) 은하처럼 소용돌이치는 별(뉴런)들이 서로 선으로 연결됨
   2) 별들이 모여 시작 화면의 로고 "Insegnante" 모양이 됨
   3) 로고가 실제 제목으로 바뀌며 시작 화면이 나타남
   ===================================================================== */
(function () {
  const intro = document.getElementById('intro');
  if (!intro) return;
  const cv = document.getElementById('intro-canvas');
  const ctx = cv.getContext('2d');

  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W, H, DPR;
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    cv.width = W * DPR; cv.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resize();
  addEventListener('resize', resize);

  // 타이밍 (ms)
  const T_GALAXY = 2600;     // 은하/뉴런 단계
  const T_GATHER = 2200;     // 로고로 모이는 단계
  const T_HOLD = 900;        // 로고 유지
  const N = W < 600 ? 260 : 380;
  const LINK = W < 600 ? 80 : 110;

  // 배경 별
  const stars = Array.from({ length: 220 }, () => ({
    x: Math.random(), y: Math.random(), r: Math.random() * 1.2 + .2, p: Math.random() * Math.PI * 2
  }));

  // 뉴런(노드): 나선 은하 모양으로 배치
  const nodes = Array.from({ length: N }, (_, i) => {
    const arm = i % 3;
    const rad = Math.pow(Math.random(), .7) * Math.min(W, H) * .48 + 10;
    const ang = arm * (Math.PI * 2 / 3) + rad * .012 + (Math.random() - .5) * .9;
    return {
      rad, ang,
      spin: (0.00022 + Math.random() * .00018) * (1 + 60 / rad),
      jx: (Math.random() - .5) * 18, jy: (Math.random() - .5) * 18,
      hue: 205 + Math.random() * 25,      // 하늘색 ~ 파랑 (사이트 포인트 색)
      size: Math.random() * 1.6 + .8,
      tw: Math.random() * Math.PI * 2,
      x: 0, y: 0, sx: 0, sy: 0, tx: 0, ty: 0
    };
  });

  function galaxyPos(n, t) {
    const a = n.ang + t * n.spin;
    const cx = W / 2, cy = H / 2;
    return [cx + Math.cos(a) * n.rad + n.jx * Math.sin(t * .001 + n.tw),
            cy + Math.sin(a) * n.rad * .62 + n.jy * Math.cos(t * .0012 + n.tw)];
  }

  // 시작 화면 제목 글자 모양에서 목표 좌표 뽑기
  let targetsReady = false;
  function buildTargets() {
    const title = document.querySelector('.title');
    if (!title) return;
    const r = title.getBoundingClientRect();
    const cs = getComputedStyle(title);
    const off = document.createElement('canvas');
    const w = Math.max(1, Math.ceil(r.width)), h = Math.max(1, Math.ceil(r.height));
    off.width = w; off.height = h;
    const o = off.getContext('2d');
    o.fillStyle = '#fff';
    o.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    o.fillText(title.textContent.trim(), w / 2, h / 2 + parseFloat(cs.fontSize) * .04);
    const data = o.getImageData(0, 0, w, h).data;
    const gap = Math.max(3, Math.round(parseFloat(cs.fontSize) / 22));
    const pts = [];
    for (let y = 0; y < h; y += gap)
      for (let x = 0; x < w; x += gap)
        if (data[(y * w + x) * 4 + 3] > 140) pts.push([r.left + x, r.top + y]);
    if (!pts.length) return;
    // 섞은 뒤 노드마다 하나씩 배정
    for (let i = pts.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [pts[i], pts[j]] = [pts[j], pts[i]]; }
    nodes.forEach((n, i) => { const p = pts[i % pts.length]; n.tx = p[0]; n.ty = p[1]; });
    targetsReady = true;
  }

  const ease = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

  let start = null, gatherStarted = false, done = false;

  function frame(now) {
    if (done) return;
    if (start === null) start = now;
    const t = now - start;

    ctx.clearRect(0, 0, W, H);

    // 배경 별 반짝임
    for (const s of stars) {
      const a = .35 + .35 * Math.sin(now * .002 + s.p);
      ctx.fillStyle = `rgba(255,255,255,${a * .8})`;
      ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); ctx.fill();
    }

    // 단계 계산
    let g = 0;                          // 0: 은하, 1: 로고 완성
    if (t > T_GALAXY) {
      if (!gatherStarted) {
        gatherStarted = true;
        buildTargets();
        nodes.forEach(n => { n.sx = n.x; n.sy = n.y; });
      }
      g = targetsReady ? ease(Math.min(1, (t - T_GALAXY) / T_GATHER)) : 0;
    }

    // 노드 위치
    for (const n of nodes) {
      const [gx, gy] = galaxyPos(n, t);
      if (!gatherStarted) { n.x = gx; n.y = gy; }
      else {
        // 모이는 동안 살짝 휘어 들어오도록
        const swirl = Math.sin(g * Math.PI) * 40;
        n.x = n.sx + (n.tx - n.sx) * g + Math.cos(n.tw) * swirl;
        n.y = n.sy + (n.ty - n.sy) * g + Math.sin(n.tw) * swirl;
      }
    }

    // 연결선 (뉴런 시냅스처럼) — 로고에 가까워질수록 짧은 선만
    const link = LINK * (1 - g) + 14 * g;
    const link2 = link * link;
    ctx.lineWidth = .6;
    for (let i = 0; i < N; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < N; j++) {
        const b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < link2) {
          const al = (1 - d2 / link2) * (.45 + .3 * g);
          ctx.strokeStyle = `hsla(${(a.hue + b.hue) / 2},100%,${80 + 15 * g}%,${al})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }

    // 노드 (빛나는 점)
    ctx.globalCompositeOperation = 'lighter';
    for (const n of nodes) {
      const tw = .7 + .3 * Math.sin(now * .004 + n.tw);
      const r = n.size * (1 + g * .4);
      const grd = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 4);
      grd.addColorStop(0, `hsla(${n.hue},100%,${88 + 12 * g}%,${tw})`);   // 로고가 될수록 흰색
      grd.addColorStop(1, `hsla(${n.hue},100%,80%,0)`);
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(n.x, n.y, r * 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    if (t > T_GALAXY + T_GATHER + T_HOLD) return finish();
    requestAnimationFrame(frame);
  }

  function finish() {
    if (done) return;
    done = true;
    document.body.classList.remove('intro-on');   // 진짜 제목이 같은 자리에 나타남
    intro.classList.add('hide');
    setTimeout(() => intro.remove(), 1100);
  }

  document.getElementById('skip-intro').onclick = finish;
  addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'Enter') finish(); }, { once: true });

  if (reduce) { finish(); return; }

  // 필기체 폰트가 준비된 뒤 시작 (최대 1.5초 대기)
  const fontReady = (document.fonts && document.fonts.load)
    ? Promise.race([document.fonts.load('80px "Great Vibes"'), new Promise(r => setTimeout(r, 1500))])
    : Promise.resolve();
  fontReady.then(() => requestAnimationFrame(frame));
  // 애니메이션이 멈춰도(백그라운드 탭 등) 시작 화면은 반드시 나타나도록
  setTimeout(finish, T_GALAXY + T_GATHER + T_HOLD + 3500);
})();
