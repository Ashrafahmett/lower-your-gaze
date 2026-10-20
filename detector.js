// Local image classifier: female-face detection (face-api age/gender model)
// plus a nudity / revealing-content classifier (NSFW MobileNetV2).
// No chrome.* APIs here so it can be tested in a plain page.

/* global faceapi */
const Detector = (() => {
  const tf = faceapi.tf;
  const NSFW_CLASSES = ['drawing', 'hentai', 'neutral', 'porn', 'sexy'];

  // Thresholds per mode. "female" = minimum probability that a face is a woman.
  // "uncertain" = in strict mode a face only counts as a man when the model is
  // at least this sure; anything less is treated as a possible woman.
  const MODES = {
    normal: { female: 0.65, uncertain: 0, nsfw: 0.5, minFace: 0.7 },
    strict: { female: 0.5, uncertain: 0.75, nsfw: 0.3, minFace: 0.5 },
  };

  let ready = null;
  let nsfwModel = null;

  // baseUrl must be relative ('' here): face-api breaks chrome-extension:// URLs.
  function init(baseUrl) {
    if (!ready) {
      ready = (async () => {
        try {
          await tf.setBackend('webgl');
        } catch {
          await tf.setBackend('cpu');
        }
        await tf.ready();
        await faceapi.nets.ssdMobilenetv1.loadFromUri(baseUrl + 'models/face');
        await faceapi.nets.ageGenderNet.loadFromUri(baseUrl + 'models/face');
        nsfwModel = await tf.loadLayersModel(baseUrl + 'models/nsfw/model.json');
        // Warm-up so the first real image is not slow.
        tf.tidy(() => nsfwModel.predict(tf.zeros([1, 224, 224, 3])));
        return tf.getBackend();
      })();
    }
    return ready;
  }

  function toCanvas(source, maxSide) {
    const w = source.width || source.videoWidth || source.naturalWidth;
    const h = source.height || source.videoHeight || source.naturalHeight;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    return c;
  }

  function padded(canvas) {
    const side = Math.round(Math.max(canvas.width, canvas.height) * 2);
    const c = document.createElement('canvas');
    c.width = c.height = side;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, side, side);
    ctx.drawImage(canvas, (side - canvas.width) / 2, (side - canvas.height) / 2);
    return c;
  }

  async function nsfwScores(canvas) {
    const out = tf.tidy(() => {
      const img = tf.browser.fromPixels(canvas).toFloat().div(255);
      const resized = tf.image.resizeBilinear(img, [224, 224], true);
      return nsfwModel.predict(resized.expandDims(0));
    });
    const data = await out.data();
    out.dispose();
    const scores = {};
    NSFW_CLASSES.forEach((c, i) => (scores[c] = data[i]));
    return scores;
  }

  // source: ImageBitmap / HTMLImageElement / HTMLCanvasElement
  async function classify(source, modeName = 'strict') {
    const mode = MODES[modeName] || MODES.strict;
    const canvas = toCanvas(source, 640);

    const opts = new faceapi.SsdMobilenetv1Options({ minConfidence: mode.minFace, maxResults: 20 });
    let faces = await faceapi.detectAllFaces(canvas, opts).withAgeAndGender();
    if (!faces.length) {
      // The detector misses faces that fill the whole picture (profile photos),
      // so try again with the image shrunk inside a border.
      faces = await faceapi.detectAllFaces(padded(canvas), opts).withAgeAndGender();
    }

    const faceInfo = faces.map((f) => ({
      gender: f.gender,
      p: +f.genderProbability.toFixed(3),
      score: +f.detection.score.toFixed(3),
    }));

    const woman = faceInfo.some(
      (f) => (f.gender === 'female' && f.p >= mode.female) || (f.gender === 'male' && f.p < mode.uncertain)
    );

    const scores = await nsfwScores(canvas);
    const immodest = scores.porn + scores.sexy + scores.hentai;

    let verdict = 'safe';
    let reason = '';
    if (woman) {
      verdict = 'unsafe';
      reason = 'woman';
    } else if (immodest >= mode.nsfw) {
      verdict = 'unsafe';
      reason = 'immodest';
    }
    return { verdict, reason, faces: faceInfo, immodest: +immodest.toFixed(3) };
  }

  return { init, classify };
})();
