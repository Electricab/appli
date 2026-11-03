// Notes au stylet : format des traits et dessin sur un canvas. Fichier identique sur le PC
// (CRM Electricab/public/ink.js) et sur le téléphone (dépôt appli, dossier crm/).
//
// Format enregistré (JSON) : { v: 1, w: 1000, h: <hauteur>, strokes: [{ c: couleur, s: épaisseur, a: opacité, p: "x,y,pression,…" }] }
// Les coordonnées sont en unités de page (largeur 1000), donc indépendantes de la taille de l'écran ;
// la pression va de 1 à 9 (5 quand l'appareil ne la mesure pas).
const Ink = (() => {
  const W = 1000;

  function decode(body) {
    let doc;
    try { doc = typeof body === 'string' ? JSON.parse(body || '{}') : body || {}; } catch { doc = {}; }
    return {
      v: 1, w: W, h: Number(doc.h) || 1400,
      strokes: (doc.strokes || []).map(s => ({
        c: s.c || '#1b1f24', s: Number(s.s) || 3, a: Number(s.a) || 1,
        pts: typeof s.p === 'string' ? s.p.split(',').map(Number) : (s.pts || []),
      })),
    };
  }

  const encode = doc => JSON.stringify({
    v: 1, w: W, h: Math.round(doc.h),
    strokes: doc.strokes.map(s => ({ c: s.c, s: s.s, ...(s.a !== 1 ? { a: s.a } : {}), p: s.pts.join(',') })),
  });

  const widthAt = (s, p) => s.a < 1 ? s.s : s.s * (0.45 + p / 9 * 0.9);

  // Dessine un trait ; k = pixels par unité de page
  function drawStroke(ctx, s, k) {
    const p = s.pts, n = p.length / 3;
    if (!n) return;
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = s.c;
    ctx.globalAlpha = s.a;
    ctx.lineCap = ctx.lineJoin = 'round';
    if (n === 1) {
      ctx.beginPath();
      ctx.arc(p[0] * k, p[1] * k, widthAt(s, p[2]) * k / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.a < 1) {
      // Surligneur : un seul chemin, pour que les recouvrements ne foncent pas
      ctx.lineWidth = s.s * k;
      ctx.beginPath();
      ctx.moveTo(p[0] * k, p[1] * k);
      for (let i = 1; i < n - 1; i++) {
        const mx = (p[i * 3] + p[i * 3 + 3]) / 2, my = (p[i * 3 + 1] + p[i * 3 + 4]) / 2;
        ctx.quadraticCurveTo(p[i * 3] * k, p[i * 3 + 1] * k, mx * k, my * k);
      }
      ctx.lineTo(p[(n - 1) * 3] * k, p[(n - 1) * 3 + 1] * k);
      ctx.stroke();
    } else {
      // Stylo : segments lissés dont l'épaisseur suit la pression
      let px = p[0], py = p[1];
      for (let i = 1; i < n; i++) {
        const x = p[i * 3], y = p[i * 3 + 1];
        const last = i === n - 1;
        const mx = last ? x : (x + p[i * 3 + 3]) / 2, my = last ? y : (y + p[i * 3 + 4]) / 2;
        ctx.lineWidth = widthAt(s, (p[i * 3 - 1] + p[i * 3 + 2]) / 2) * k;
        ctx.beginPath();
        ctx.moveTo(px * k, py * k);
        ctx.quadraticCurveTo(x * k, y * k, mx * k, my * k);
        ctx.stroke();
        px = mx; py = my;
      }
    }
    ctx.restore();
  }

  // Lignes de cahier, puis tous les traits
  function drawPage(ctx, doc, k, { lines = true } = {}) {
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
    if (lines) {
      ctx.save();
      ctx.strokeStyle = '#dbe4f0';
      ctx.lineWidth = Math.max(1, k);
      for (let y = 90; y < doc.h; y += 70) {
        ctx.beginPath(); ctx.moveTo(0, y * k); ctx.lineTo(W * k, y * k); ctx.stroke();
      }
      ctx.restore();
    }
    for (const s of doc.strokes) drawStroke(ctx, s, k);
  }

  // Affiche une page entière dans un canvas qui prend la largeur de son conteneur
  function render(canvas, body) {
    const doc = decode(body);
    const used = doc.strokes.reduce((m, s) => { for (let i = 1; i < s.pts.length; i += 3) m = Math.max(m, s.pts[i]); return m; }, 0);
    const h = Math.max(used + 80, 600);
    const cssW = canvas.parentElement.clientWidth || 800, dpr = window.devicePixelRatio || 1;
    const k = cssW / W;
    canvas.style.height = `${h * k}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(h * k * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPage(ctx, { ...doc, h }, k);
  }

  // Le trait passe-t-il à moins de r unités du point (x, y) ? (gomme)
  function hits(s, x, y, r) {
    const p = s.pts;
    for (let i = 0; i < p.length; i += 3) {
      const dx = p[i] - x, dy = p[i + 1] - y, rr = r + widthAt(s, p[i + 2]) / 2;
      if (dx * dx + dy * dy <= rr * rr) return true;
      if (i + 3 < p.length) {
        // distance au segment
        const ex = p[i + 3] - p[i], ey = p[i + 4] - p[i + 1], len = ex * ex + ey * ey;
        if (len) {
          const t = Math.max(0, Math.min(1, ((x - p[i]) * ex + (y - p[i + 1]) * ey) / len));
          const qx = p[i] + t * ex - x, qy = p[i + 1] + t * ey - y;
          if (qx * qx + qy * qy <= rr * rr) return true;
        }
      }
    }
    return false;
  }

  return { W, decode, encode, drawStroke, drawPage, render, hits };
})();
