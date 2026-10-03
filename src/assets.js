(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShooterAssets = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // User-supplied transparent atlases. Images keep their original RGBA pixels;
  // source rectangles select individual sprites without allocating cropped images.
  const manifest = Object.freeze({
    player: Object.freeze({ src: 'assets/player.png', width: 1122, height: 1402 }),
    enemies: Object.freeze({ src: 'assets/enemies.png', width: 1122, height: 1402 }),
    warships: Object.freeze({ src: 'assets/warships.png', width: 1254, height: 1254 }),
    projectiles: Object.freeze({ src: 'assets/projectiles.png', width: 1448, height: 1086 }),
    enemyVariants: Object.freeze({ src: 'assets/expansion/enemy-variants.png', width: 1122, height: 1402 }),
    fleet: Object.freeze({ src: 'assets/expansion/fleet.png', width: 1122, height: 1402 }),
  });
  function frame(rect) {
    const [x, y, w, h] = rect;
    return Object.freeze({ x: x - 2, y: y - 2, w: w + 4, h: h + 4 });
  }
  function separatedFrame(rect, regions) {
    return Object.freeze({
      ...frame(rect),
      regions: Object.freeze(regions.map(([x, y, w, h]) => Object.freeze({ x, y, w, h }))),
    });
  }
  const frames = Object.freeze({
    player: Object.freeze([
      [261, 37, 200, 232], [638, 37, 249, 231],
      [241, 293, 240, 234], [622, 289, 281, 239],
      [231, 535, 260, 258], [615, 535, 296, 257],
      [227, 810, 268, 253], [611, 809, 303, 259],
      [208, 1072, 305, 270], [599, 1070, 327, 294],
    ].map(frame)),
    enemies: Object.freeze([
      [241, 34, 219, 260], [637, 44, 289, 248],
      [212, 325, 276, 274], [625, 324, 311, 291],
      [216, 625, 269, 304], [562, 638, 442, 293],
      [114, 962, 449, 354], [585, 938, 442, 398],
    ].map(frame)),
    warships: Object.freeze([
      [236, 57, 282, 405], [709, 43, 346, 439],
      [212, 529, 335, 629], [660, 495, 451, 670],
    ].map(frame)),
    // Overlapping atlas rows use precomputed disjoint source rectangles.
    // Keep every alpha > 32 body pixel; omit neighboring sprites without changing RGBA files.
    enemyVariants: Object.freeze([
      frame([173, 10, 313, 278]),
      frame([601, 14, 371, 273]),
      separatedFrame([127, 292, 403, 254], [[125, 290, 407, 250], [125, 540, 195, 8], [339, 540, 193, 8]]),
      separatedFrame([578, 292, 417, 250], [[576, 290, 421, 248], [576, 538, 202, 6], [793, 538, 204, 6]]),
      separatedFrame([137, 542, 384, 251], [[135, 540, 138, 8], [292, 540, 73, 8], [385, 540, 138, 8], [135, 548, 388, 240], [135, 788, 77, 7], [235, 788, 80, 7], [344, 788, 79, 7], [446, 788, 77, 7]]),
      separatedFrame([581, 540, 410, 244], [[579, 538, 15, 6], [605, 538, 362, 6], [978, 538, 15, 6], [579, 544, 414, 229], [579, 773, 194, 13], [798, 773, 195, 13]]),
      separatedFrame([169, 790, 320, 253], [[167, 788, 96, 6], [279, 788, 100, 6], [396, 788, 95, 7], [167, 794, 212, 1], [167, 795, 324, 246], [167, 1041, 157, 4], [336, 1041, 155, 4]]),
      separatedFrame([580, 775, 412, 273], [[578, 773, 1, 6], [592, 773, 101, 6], [715, 773, 140, 13], [878, 773, 103, 6], [993, 773, 1, 6], [578, 779, 115, 7], [878, 779, 116, 7], [578, 786, 416, 236], [578, 1022, 150, 28], [755, 1022, 62, 28], [845, 1022, 149, 28]]),
      separatedFrame([122, 1043, 415, 298], [[120, 1041, 176, 4], [306, 1041, 46, 4], [363, 1041, 176, 4], [120, 1045, 419, 298]]),
      separatedFrame([561, 1024, 451, 318], [[559, 1022, 85, 28], [680, 1022, 84, 28], [807, 1022, 85, 28], [928, 1022, 86, 28], [559, 1050, 455, 294]]),
    ]),
    fleet: Object.freeze([
      frame([99, 53, 388, 181]),
      separatedFrame([630, 19, 417, 252], [[628, 17, 421, 248], [628, 265, 109, 8], [767, 265, 282, 8]]),
      frame([70, 310, 453, 188]),
      separatedFrame([613, 267, 432, 286], [[611, 265, 194, 8], [850, 265, 197, 8], [611, 273, 436, 282]]),
      separatedFrame([69, 536, 454, 271], [[67, 534, 458, 269], [67, 803, 304, 6], [425, 803, 100, 6]]),
      frame([589, 568, 499, 225]),
      separatedFrame([63, 805, 430, 281], [[61, 803, 204, 6], [309, 803, 186, 6], [61, 809, 434, 272], [61, 1081, 148, 7], [308, 1081, 187, 7]]),
      frame([571, 819, 499, 260]),
      separatedFrame([56, 1083, 458, 279], [[54, 1081, 319, 7], [425, 1081, 91, 7], [54, 1088, 462, 276]]),
      frame([562, 1094, 517, 275]),
    ]),
    projectiles: Object.freeze(Object.fromEntries(Object.entries({
      round: [163, 134, 62, 175], heavy: [484, 84, 100, 237],
      twin: [824, 100, 58, 211], shard: [1233, 87, 45, 110],
      energy: [140, 440, 105, 220], missile: [464, 433, 137, 262],
      rocket: [807, 372, 180, 350], beam: [1199, 369, 114, 330],
      enemyBolt: [148, 810, 79, 132], plasma: [420, 771, 223, 211],
      enemyBeam: [832, 738, 130, 268], mine: [1142, 766, 229, 217],
    }).map(([name, rect]) => [name, frame(rect)]))),
  });

  async function loadAssets(createImage, options = {}) {
    if (typeof createImage !== 'function') throw new TypeError('loadAssets requires an image factory');
    const timeoutMs = options.timeoutMs === undefined ? 15000 : options.timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('Asset timeoutMs must be positive');
    const loaded = await Promise.all(Object.entries(manifest).map(([name, descriptor]) => new Promise((resolve, reject) => {
      let image;
      let timer;
      let settled = false;
      function finish(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (image) { image.onload = null; image.onerror = null; }
        if (error) reject(error);
        else resolve([name, image]);
      }
      try {
        image = createImage();
        if (!image || typeof image !== 'object') throw new TypeError('Image factory did not return an image');
        image.onload = () => {
          if (image.width !== descriptor.width || image.height !== descriptor.height) {
            finish(new Error(`素材尺寸不符：${descriptor.src}；预期 ${descriptor.width}×${descriptor.height}，实际 ${image.width}×${image.height}`));
            return;
          }
          finish();
        };
        image.onerror = event => finish(new Error(`素材加载失败：${descriptor.src}；${event && (event.errMsg || event.message) || '无法读取或解码图片'}`));
        timer = setTimeout(() => finish(new Error(`素材加载超时：${descriptor.src}（${timeoutMs} 毫秒）`)), timeoutMs);
        image.src = descriptor.src;
      } catch (error) {
        finish(new Error(`素材初始化失败：${descriptor.src}；${error.message || String(error)}`));
      }
    })));
    return Object.freeze({ images: Object.freeze(Object.fromEntries(loaded)), frames });
  }

  return { manifest, frames, loadAssets };
});
