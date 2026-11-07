// Notes au stylet : format des traits et dessin sur un canvas. Fichier identique sur le PC
// (CRM Electricab/public/ink.js) et sur le téléphone (dépôt appli, dossier crm/).
//
// Format enregistré (JSON) : { v: 1, w: 1000, h: <hauteur>, images: [{ id, x, y, w, h, c: [x, y, l, h] }],
//   strokes: [{ c: couleur, s: épaisseur, a: opacité, p: "x,y,pression,…" }] }
// Les coordonnées sont en unités de page (largeur 1000), donc indépendantes de la taille de l'écran ;
// la pression va de 1 à 9 (5 quand l'appareil ne la mesure pas). Les photos sont dans des fichiers à part
// (une seule fois dans le dépôt, même si la note change souvent) et se placent sous les traits.
// c = zone gardée d'une photo rognée, en fractions de la photo entière (le fichier reste intact).
const Ink = (() => {
  const W = 1000;
  const PHOTO_ID = /^[0-9a-f-]{36}$/i;
  const validCrop = c => Array.isArray(c) && c.length === 4 && c.every(v => Number(v) >= 0 && Number(v) <= 1) && c[2] > 0 && c[3] > 0;

  function decode(body) {
    let doc;
    try { doc = typeof body === 'string' ? JSON.parse(body || '{}') : body || {}; } catch { doc = {}; }
    return {
      v: 1, w: W, h: Number(doc.h) || 1400,
      strokes: (doc.strokes || []).map(s => ({
        c: s.c || '#1b1f24', s: Number(s.s) || 3, a: Number(s.a) || 1,
        pts: typeof s.p === 'string' ? s.p.split(',').map(Number) : (s.pts || []),
      })),
      images: (doc.images || []).filter(i => PHOTO_ID.test(i.id)).map(({ id, x, y, w, h, c }) => ({
        id, x: Number(x), y: Number(y), w: Number(w), h: Number(h), ...(validCrop(c) ? { c: c.map(Number) } : {}),
      })),
    };
  }

  const encode = doc => JSON.stringify({
    v: 1, w: W, h: Math.round(doc.h),
    ...(doc.images?.length ? { images: doc.images.map(({ id, x, y, w, h, c }) => ({
      id, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), ...(c ? { c: c.map(v => Math.round(v * 10000) / 10000) } : {}),
    })) } : {}),
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

  // Photo pas encore chargée : un cadre gris à sa place
  function drawImage(ctx, i, k, image) {
    const el = image?.(i.id);
    if (el?.complete && el.naturalWidth) {
      const [cx, cy, cw, ch] = i.c || [0, 0, 1, 1], nw = el.naturalWidth, nh = el.naturalHeight;
      ctx.drawImage(el, cx * nw, cy * nh, cw * nw, ch * nh, i.x * k, i.y * k, i.w * k, i.h * k);
      return;
    }
    ctx.save();
    ctx.fillStyle = '#eef0f3';
    ctx.fillRect(i.x * k, i.y * k, i.w * k, i.h * k);
    ctx.fillStyle = '#6b7280'; ctx.font = '14px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('📷 Photo', (i.x + i.w / 2) * k, (i.y + i.h / 2) * k);
    ctx.restore();
  }

  // Lignes de cahier, photos, puis tous les traits
  function drawPage(ctx, doc, k, { lines = true, image } = {}) {
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
    for (const i of doc.images || []) drawImage(ctx, i, k, image);
    for (const s of doc.strokes) drawStroke(ctx, s, k);
  }

  // Affiche une page entière dans un canvas qui prend la largeur de son conteneur
  function render(canvas, body, image) {
    const doc = decode(body);
    let used = doc.strokes.reduce((m, s) => { for (let i = 1; i < s.pts.length; i += 3) m = Math.max(m, s.pts[i]); return m; }, 0);
    for (const i of doc.images) used = Math.max(used, i.y + i.h);
    const h = Math.max(used + 80, 600);
    const cssW = canvas.parentElement.clientWidth || 800, dpr = window.devicePixelRatio || 1;
    const k = cssW / W;
    canvas.style.height = `${h * k}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(h * k * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPage(ctx, { ...doc, h }, k, { image });
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

  // Photo prête à enregistrer : JPEG d'au plus 1600 px et sous la taille que GitHub renvoie directement (1 Mo)
  async function preparePhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => { throw new Error('Cette image ne peut pas être lue'); });
      let scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      for (let attempt = 0; attempt < 8; attempt++) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
        if (base64.length < 1200000) return { base64, width: canvas.width, height: canvas.height };
        scale *= 0.8;
      }
      throw new Error('Photo trop volumineuse');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return { W, PHOTO_ID, decode, encode, drawStroke, drawPage, render, hits, preparePhoto };
})();
