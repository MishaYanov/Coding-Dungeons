const WIDTH = 320;
const HEIGHT = 116;
const DEFEAT_MS = 880;

const CREATURES = {
  javascript: { name: "Ember Mimic", light: "#ffe6a1", accent: "#f3b849", shade: "#9b5429", dark: "#4a2c27", draw: drawMimic },
  typescript: { name: "Prism Sentinel", light: "#dbeeff", accent: "#82c5ff", shade: "#3b66c0", dark: "#27366e", draw: drawSentinel },
  rust: { name: "Ferric Scarab", light: "#ffdbb1", accent: "#f2a373", shade: "#ad524a", dark: "#512c38", draw: drawScarab },
  go: { name: "Relay Wyrm", light: "#d0fff3", accent: "#6ce4cc", shade: "#288984", dark: "#254c55", draw: drawWyrm },
};

const GOBLIN = { light: "#d9fff0", accent: "#8be4ba", shade: "#478e79", dark: "#244438", draw: drawGoblin };

const creature = (world) => Object.hasOwn(CREATURES, world) ? CREATURES[world] : CREATURES.javascript;
export const creatureName = (world) => creature(world).name;

function polygon(ctx, points, color, border = "#111a27") {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = "round";
    ctx.stroke();
  }
}

function line(ctx, points, color, width = 1) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

function oval(ctx, x, y, rx, ry, color) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function diamond(ctx, x, y, width, height, color, border) {
  polygon(ctx, [[x, y-height], [x+width, y], [x, y+height], [x-width, y]], color, border);
}

function drawMimic(ctx, colors, variant) {
  const { light, accent, shade, dark } = colors;
  // The tilted lid and hinged chest form the mimic's jaws.
  polygon(ctx, [[-37,15],[-51,33],[-39,41],[-17,27]], dark);
  polygon(ctx, [[30,18],[47,26],[48,38],[23,36]], shade);
  polygon(ctx, [[-42,-13],[-28,-33],[28,-32],[45,-12],[33,14],[-34,16]], "#281c29");
  polygon(ctx, [[-45,-24],[-29,-46],[24,-45],[44,-28],[36,-12],[-38,-14]], shade);
  polygon(ctx, [[-41,-25],[-28,-43],[23,-42],[39,-28],[27,-25],[-33,-24]], accent, null);
  line(ctx, [[-34,-20],[-23,-37],[20,-36],[31,-25]], "#73422f");
  line(ctx, [[-17,-43],[-24,-25],[-20,-15]], light, 2);
  line(ctx, [[17,-43],[24,-27],[24,-14]], light, 2);
  polygon(ctx, [[-37,-15],[-29,-14],[-30,-4]], light);
  polygon(ctx, [[-22,-14],[-13,-14],[-18,-2]], light);
  polygon(ctx, [[-4,-13],[5,-13],[0,-1]], light);
  polygon(ctx, [[14,-13],[23,-13],[20,-2]], light);
  polygon(ctx, [[28,-13],[37,-12],[32,-5]], light);
  polygon(ctx, [[0,7],[12,1],[22,3],[20,11],[12,16],[0,16]], "#df7577");
  polygon(ctx, [[-43,3],[-31,12],[32,11],[43,0],[39,28],[26,36],[-32,36],[-42,27]], shade);
  polygon(ctx, [[-37,14],[-28,21],[28,21],[36,15],[35,27],[26,32],[-28,32],[-36,27]], dark, null);
  line(ctx, [[-29,12],[-31,29],[-24,36]], accent, 3);
  line(ctx, [[29,12],[31,27],[25,34]], accent, 3);
  diamond(ctx, 0, 22, 9, 10, accent);
  diamond(ctx, 0, 22, 3, 4, "#332329", null);
  oval(ctx, -14, -5, 5.5, 2.7, light);
  oval(ctx, 14, -5, 5.5, 2.7, light);
  for (let i = 0; i < variant; i++) diamond(ctx, -9 + i * 9, -32, 2, 3, light, null);
  polygon(ctx, [[-52,-25],[-44,-13],[-49,-13],[-41,0],[-57,-15],[-52,-15]], light, null);
  polygon(ctx, [[49,-36],[56,-25],[52,-25],[59,-14],[45,-27],[50,-27]], accent, null);
}

function drawSentinel(ctx, colors, variant) {
  const { light, accent, shade, dark } = colors;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    line(ctx, [[22,-12],[39,-18],[51,-10]], "#526797", 2);
    polygon(ctx, [[27,-24],[45,-30],[62,-13],[51,8],[37,6]], dark);
    polygon(ctx, [[45,-28],[59,-13],[50,-5],[39,-14]], shade, null);
    polygon(ctx, [[37,-10],[51,-5],[51,4],[39,5]], accent, null);
    diamond(ctx, 53, 17, 5, 10, shade);
    diamond(ctx, 33, 21, 3, 6, accent);
    ctx.restore();
  }
  polygon(ctx, [[0,-47],[22,-34],[26,-6],[14,16],[0,27],[-14,16],[-26,-6],[-22,-34]], dark);
  polygon(ctx, [[0,-45],[20,-33],[13,-21],[0,-28],[-13,-21],[-20,-33]], accent, null);
  polygon(ctx, [[-24,-6],[-16,-22],[-11,-5],[0,0],[0,25],[-12,15]], shade, null);
  polygon(ctx, [[24,-6],[16,-22],[11,-5],[0,0],[0,25],[12,15]], "#567ed4", null);
  polygon(ctx, [[-18,-13],[-9,-20],[10,-20],[18,-13],[10,-3],[-10,-3]], "#0f1e41", accent);
  diamond(ctx, 0, -12, 8, 6, light, null);
  diamond(ctx, 0, -12, 2.2, 4, shade, null);
  line(ctx, [[-4,5],[0,9],[4,5]], light);
  diamond(ctx, 0, 34, 4, 6, accent);
  for (let i = 0; i < variant; i++) diamond(ctx, (i - (variant - 1) / 2) * 7, -34, 1.6, 2, light, null);
}

function drawScarab(ctx, colors, variant) {
  const { light, accent, shade, dark } = colors;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    line(ctx, [[12,-12],[34,-12],[46,2],[59,5]], dark, 9);
    line(ctx, [[12,0],[36,4],[41,18],[58,25]], dark, 8);
    line(ctx, [[12,10],[29,20],[35,33],[50,37]], dark, 8);
    line(ctx, [[14,-12],[34,-12],[46,2],[59,5]], accent, 3);
    line(ctx, [[12,0],[36,4],[41,18],[58,25]], shade, 3);
    line(ctx, [[12,10],[29,20],[35,33],[50,37]], accent, 2);
    polygon(ctx, [[25,-19],[36,-31],[52,-34],[62,-25],[50,-25],[44,-20],[49,-15],[61,-15],[50,-6],[35,-8]], shade);
    line(ctx, [[36,-26],[50,-31],[56,-28]], accent, 2);
    oval(ctx, 34, -11, 3, 3, light);
    oval(ctx, 37, 8, 2.5, 2.5, accent);
    ctx.restore();
  }
  if (colors.elite) {
    polygon(ctx, [[-28,-22],[-33,-45],[-14,-33],[0,-53],[14,-33],[33,-45],[28,-22]], shade, accent);
  }
  polygon(ctx, [[-26,-27],[-12,-42],[12,-42],[26,-27],[30,-4],[19,22],[0,33],[-19,22],[-30,-4]], dark);
  polygon(ctx, [[-24,-25],[-12,-39],[-2,-36],[-4,12],[-16,20],[-27,-5]], shade);
  polygon(ctx, [[24,-25],[12,-39],[2,-36],[4,12],[16,20],[27,-5]], colors.elite ? "#ab74d3" : "#c96d59");
  line(ctx, [[-23,-23],[-11,-35],[-5,-32]], accent, 2.5);
  line(ctx, [[23,-23],[11,-35],[5,-32]], accent, 2.5);
  polygon(ctx, [[-16,8],[-7,1],[7,1],[16,8],[13,21],[0,30],[-13,21]], "#733d42");
  line(ctx, [[-10,13],[-5,16],[5,16],[10,13]], light, 2);
  line(ctx, [[-7,25],[-9,31],[-4,35]], accent, 2);
  line(ctx, [[7,25],[9,31],[4,35]], accent, 2);
  for (let i = 0; i < variant; i++) diamond(ctx, 0, -26 + i * 7, 2, 3, light, null);
}

function drawWyrm(ctx, colors, variant) {
  const { light, accent, shade, dark } = colors;
  polygon(ctx, [[-32,20],[-52,15],[-62,0],[-57,-15],[-52,-4],[-43,0],[-34,-6],[-20,-5]], shade);
  polygon(ctx, [[-45,5],[-54,0],[-57,-8],[-57,0],[-50,11],[-42,13]], accent, null);
  polygon(ctx, [[-36,7],[-25,-3],[-5,-4],[9,9],[24,8],[33,-3],[33,-15],[47,-20],[53,-9],[49,11],[36,25],[19,32],[-12,31],[-32,23]], shade);
  polygon(ctx, [[-32,11],[-18,2],[-6,3],[8,15],[25,15],[40,6],[47,-10],[46,10],[35,23],[18,28],[-13,27],[-28,21]], dark, null);
  line(ctx, [[-32,11],[-17,3],[-5,4],[9,15],[25,15],[38,8]], accent, 2);
  polygon(ctx, [[11,10],[3,-8],[-4,-32],[11,-26],[28,-30],[22,-12],[34,1]], dark);
  polygon(ctx, [[-1,-28],[11,-22],[23,-26],[17,-9],[25,1],[11,4]], shade, null);
  line(ctx, [[-1,-28],[11,-22],[11,2]], accent, 1.5);
  polygon(ctx, [[31,-16],[27,-33],[36,-43],[41,-35],[53,-37],[64,-29],[62,-19],[52,-12],[42,-13],[34,-7]], shade);
  polygon(ctx, [[37,-41],[39,-32],[33,-33]], light);
  polygon(ctx, [[52,-36],[59,-33],[56,-28],[44,-27],[37,-24],[40,-32]], accent, null);
  polygon(ctx, [[52,-23],[63,-26],[61,-20],[52,-16],[45,-17]], light);
  line(ctx, [[47,-28],[53,-29],[55,-27]], "#162535", 2.2);
  line(ctx, [[60,-17],[67,-12],[65,-10]], accent, 1.5);
  for (let i = 0; i < variant; i++) diamond(ctx, -20 + i * 8, 16, 2.3, 3.3, accent, null);
}

function drawGoblin(ctx, colors) {
  const { light, accent, shade, dark } = colors;
  // Pointed ears and a crooked grin sit above the goblin's patchwork tunic.
  polygon(ctx, [[-22,9],[-34,26],[-26,36],[-4,22],[10,33],[28,37],[30,24],[20,6]], "#573842");
  polygon(ctx, [[-27,26],[-40,34],[-37,42],[-19,42],[-15,33]], dark);
  polygon(ctx, [[15,26],[11,40],[31,43],[38,37],[31,29]], dark);
  polygon(ctx, [[-30,-14],[-16,-21],[16,-18],[27,-1],[25,19],[12,29],[-24,24],[-30,6]], "#775443");
  line(ctx, [[-28,15],[-6,20],[23,15]], "#392e33", 7);
  polygon(ctx, [[-10,15],[1,15],[2,23],[-10,23]], "#e1a970");
  polygon(ctx, [[-19,-22],[-46,-38],[-42,-18],[-32,-11],[-20,-13]], shade);
  polygon(ctx, [[16,-23],[44,-40],[37,-16],[27,-11],[16,-15]], shade);
  line(ctx, [[-38,-29],[-32,-20],[-24,-18]], accent, 2);
  line(ctx, [[37,-31],[30,-20],[22,-17]], accent, 2);
  polygon(ctx, [[-27,-26],[-18,-41],[8,-44],[22,-34],[28,-19],[20,-7],[9,1],[-14,0],[-24,-9]], shade);
  polygon(ctx, [[-24,-27],[-17,-37],[8,-40],[20,-32],[24,-23],[12,-16],[6,-7],[-15,-10],[-22,-17]], accent);
  line(ctx, [[-17,-27],[-11,-29],[-4,-25]], dark, 3);
  line(ctx, [[8,-26],[15,-31],[20,-28]], dark, 3);
  oval(ctx, -10, -23, 3.3, 2.5, "#fff3a4");
  oval(ctx, 14, -24, 3.3, 2.5, "#fff3a4");
  polygon(ctx, [[1,-22],[6,-15],[0,-13],[-3,-15]], shade);
  line(ctx, [[-12,-12],[-5,-8],[7,-8],[14,-13]], dark, 2.5);
  polygon(ctx, [[6,-10],[10,-16],[12,-10]], light);
  // The gem-studded sack is tucked under one arm.
  polygon(ctx, [[36,-5],[46,-2],[61,5],[65,19],[60,34],[44,39],[24,35],[17,24],[24,9]], "#785746");
  polygon(ctx, [[38,-7],[34,-16],[40,-21],[54,-18],[51,-5]], "#a57955");
  line(ctx, [[35,-6],[50,-4],[55,-7]], "#ecc48c", 2.5);
  line(ctx, [[27,12],[23,22],[27,31],[43,34]], "#bd9367", 2);
  diamond(ctx, 46, 16, 9, 11, "#6af3ff");
  diamond(ctx, 53, 26, 5, 6, "#529ce3");
  diamond(ctx, 43, 12, 2.2, 3, "#f2ffff", null);
  polygon(ctx, [[14,0],[25,2],[29,12],[27,18],[19,17],[13,10]], shade);
}

function fraction(value) {
  return value - Math.floor(value);
}

function seed(level, index) {
  return fraction(Math.sin((index + 1) * 78.233 + level * 37.719) * 43758.5453);
}

function drawArena(ctx, colors, level) {
  const atmosphere = ctx.createRadialGradient(160, 53, 5, 160, 54, 166);
  atmosphere.addColorStop(0, colors.dark);
  atmosphere.addColorStop(0.67, "#172233");
  atmosphere.addColorStop(1, "#0d1523");
  ctx.fillStyle = atmosphere;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const ruinedArch = (offset) => {
    const x = 160 + offset;
    line(ctx, [[x-25,90],[x-25,41],[x-15,27],[x,23],[x+15,27],[x+25,41],[x+25,90]], "#293548", 2);
    line(ctx, [[x-30,90],[x-30,40],[x-19,23],[x,18],[x+19,23],[x+30,40],[x+30,90]], "#1c293c", 2);
    line(ctx, [[x-33,89],[x-24,89]], "#354052");
    line(ctx, [[x+24,89],[x+33,89]], "#354052");
  };
  ruinedArch(-102);
  ruinedArch(102);

  for (let i = 0; i < 24; i++) {
    const x = 11 + seed(level, i) * 298;
    const y = 11 + seed(level, i + 27) * 76;
    ctx.globalAlpha = 0.16 + seed(level, i + 53) * 0.29;
    oval(ctx, x, y, i % 5 === 0 ? 1.2 : 0.65, 0.65, colors.accent);
  }
  ctx.globalAlpha = 1;
  polygon(ctx, [[0,94],[76,84],[244,84],[320,94],[320,116],[0,116]], "#111c2b", null);
  line(ctx, [[0,104],[320,104]], "#263649");
  line(ctx, [[73,116],[114,86]], "#263649");
  line(ctx, [[247,116],[206,86]], "#263649");
  oval(ctx, 160, 92, 61, 10, "#0a121f");
  ctx.globalAlpha = 0.4;
  oval(ctx, 160, 91, 47, 6, colors.shade);
  ctx.globalAlpha = 1;
  line(ctx, [[8,19],[8,8],[21,8]], "#586477");
  line(ctx, [[299,8],[312,8],[312,19]], "#586477");
  line(ctx, [[8,97],[8,108],[21,108]], "#586477");
  line(ctx, [[299,108],[312,108],[312,97]], "#586477");
}

function drawVictory(ctx, colors, opacity = 1) {
  ctx.globalAlpha = opacity;
  oval(ctx, 160, 63, 27, 27, "#193144");
  diamond(ctx, 160, 63, 21, 25, "#172837", colors.accent);
  diamond(ctx, 160, 63, 17, 20, "#233e4a", null);
  line(ctx, [[151,62],[157,68],[169,55]], colors.light, 3);
  diamond(ctx, 128, 62, 3, 6, colors.accent, null);
  diamond(ctx, 192, 62, 3, 6, colors.accent, null);
  ctx.globalAlpha = 1;
}

function drawSparks(ctx, colors, level, progress) {
  const travel = 1 - (1 - progress) ** 2;
  for (let i = 0; i < 25; i++) {
    const angle = seed(level, i + 81) * Math.PI * 2;
    const radius = (20 + seed(level, i + 117) * 67) * travel;
    const x = 160 + Math.cos(angle) * radius;
    const y = 59 + Math.sin(angle) * radius * 0.62 + 23 * progress ** 2;
    const size = (1 + seed(level, i + 147) * 3) * (1 - progress * 0.65);
    ctx.globalAlpha = Math.min(1, progress * 9) * (1 - progress);
    diamond(ctx, x, y, size, size * 1.5, i % 3 ? colors.accent : colors.light, null);
  }
  ctx.globalAlpha = (1 - progress) * 0.46;
  ctx.beginPath();
  ctx.ellipse(160, 89, 17 + travel * 74, 4 + travel * 9, 0, 0, Math.PI * 2);
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export function mountCreature(canvas, { world, level, defeated = false, elite = false, goblin = false, onStateChange = () => {} }) {
  const ctx = canvas.getContext("2d");
  const colors = goblin ? GOBLIN : elite && world === "rust"
    ? { ...creature(world), elite: true, light: "#fff0ca", accent: "#e6b9ff", shade: "#7d4b9f", dark: "#382b51" }
    : creature(world);
  const rank = Number.isSafeInteger(level) ? level : 1;
  const variant = 1 + Math.abs(rank - 1) % 3;
  const view = canvas.ownerDocument.defaultView;
  const motion = view.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let progress = defeated ? 1 : 0;
  let disposed = false;

  function paint() {
    if (!ctx) return;
    const dpr = Math.min(view.devicePixelRatio || 1, 3);
    const width = Math.round((canvas.clientWidth || WIDTH) * dpr);
    const height = Math.round(width * HEIGHT / WIDTH);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    ctx.setTransform(width / WIDTH, 0, 0, height / HEIGHT, 0, 0);
    drawArena(ctx, colors, rank);

    const collapse = Math.min(1, progress * 1.85);
    if (collapse < 1) {
      ctx.save();
      ctx.translate(160 + Math.sin(collapse * 15) * collapse * 8, 56 + collapse * 22);
      ctx.rotate(collapse * 0.24);
      ctx.scale(1 - collapse * 0.32, 1 - collapse * 0.72);
      ctx.globalAlpha = 1 - collapse ** 2;
      colors.draw(ctx, colors, variant);
      ctx.restore();
    }
    if (progress > 0 && progress < 1) drawSparks(ctx, colors, rank, progress);
    if (progress > 0.52) drawVictory(ctx, colors, Math.min(1, (progress - 0.52) / 0.48));
  }

  const resize = ctx && typeof view.ResizeObserver === "function" ? new view.ResizeObserver(paint) : null;
  resize?.observe(canvas);
  paint();
  onStateChange(defeated ? "defeated" : "ready");

  function cancelAnimation() {
    if (frame) view.cancelAnimationFrame(frame);
    frame = 0;
  }

  return {
    update(value, { animate = false } = {}) {
      if (disposed || value === defeated) return;
      defeated = value;
      cancelAnimation();
      if (!ctx || !defeated || !animate || motion.matches) {
        progress = defeated ? 1 : 0;
        paint();
        onStateChange(defeated ? "defeated" : "ready");
        return;
      }

      let start;
      function animateFrame(now) {
        frame = 0;
        if (!canvas.isConnected) return;
        start ??= now;
        progress = motion.matches ? 1 : Math.min(1, (now - start) / DEFEAT_MS);
        paint();
        if (progress < 1) frame = view.requestAnimationFrame(animateFrame);
        else onStateChange("defeated");
      }
      frame = view.requestAnimationFrame(animateFrame);
      onStateChange("defeating");
    },
    destroy() {
      disposed = true;
      cancelAnimation();
      resize?.disconnect();
    },
  };
}
