// Hardware-accelerated WebGL 3D Planetary Globe Engine for Mars Base Decision Engine.
// Uses real NASA MGS MOLA DEM (2048x1024) for 3D vertex displacement & per-pixel normal mapping,
// composites live decision overlays (Score, SWIM 2.0 Ice, Slope, Elev, TES TI, Dust),
// and provides exact 3D-to-2D projection & raycast unprojection for full interactive parity.
(function (global) {
  'use strict';

  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;
  const MARS_R = 3389.5; // km

  const VS_GLOBE = `
    attribute vec2 a_uv;
    uniform mat4 u_mvp;
    uniform sampler2D u_elevTex;
    uniform float u_relief;
    varying vec2 v_uv;
    varying vec3 v_pos;
    varying vec3 v_norm;
    varying float v_elev;

    void main() {
      v_uv = a_uv;
      float lon = (a_uv.x - 0.5) * 6.28318530718;
      float lat = (0.5 - a_uv.y) * 3.14159265359;
      float clat = cos(lat), slat = sin(lat);
      float clon = cos(lon), slon = sin(lon);
      vec3 n = vec3(clat * slon, slat, clat * clon);
      float elevRaw = texture2D(u_elevTex, a_uv).r;
      v_elev = elevRaw;
      float r = 1.0 + (elevRaw - 0.278) * u_relief;
      vec3 p = n * r;
      v_pos = p;
      v_norm = n;
      gl_Position = u_mvp * vec4(p, 1.0);
    }
  `;

  const FS_GLOBE = `
    precision highp float;
    varying vec2 v_uv;
    varying vec3 v_pos;
    varying vec3 v_norm;
    varying float v_elev;

    uniform sampler2D u_baseTex;
    uniform sampler2D u_elevTex;
    uniform sampler2D u_ovTex;
    uniform float u_opacity;
    uniform float u_showOv;
    uniform float u_relief;
    uniform float u_lighting;
    uniform vec3 u_sunDir;
    uniform vec3 u_camPos;

    void main() {
      vec3 N = normalize(v_norm);
      float lon = (v_uv.x - 0.5) * 6.28318530718;
      float lat = (0.5 - v_uv.y) * 3.14159265359;

      // Tangent & bitangent on sphere for MOLA DEM normal perturbation
      vec3 T = normalize(vec3(cos(lon), 0.0, -sin(lon)));
      vec3 B = normalize(cross(N, T));

      vec2 texel = vec2(1.0 / 2048.0, 1.0 / 1024.0);
      float hL = texture2D(u_elevTex, v_uv - vec2(texel.x, 0.0)).r;
      float hR = texture2D(u_elevTex, v_uv + vec2(texel.x, 0.0)).r;
      float hU = texture2D(u_elevTex, v_uv - vec2(0.0, texel.y)).r;
      float hD = texture2D(u_elevTex, v_uv + vec2(0.0, texel.y)).r;

      float bumpStrength = 8.0 + u_relief * 45.0;
      float dU = (hR - hL) * bumpStrength;
      float dV = (hD - hU) * bumpStrength;
      vec3 pertN = normalize(N - dU * T + dV * B);

      // Real NASA Viking Orbiter MDIM 2.1 Colorized Global Optical Mosaic
      vec3 baseCol = texture2D(u_baseTex, v_uv).rgb;

      // Composite active decision/sensor overlay
      vec4 ov = texture2D(u_ovTex, v_uv);
      float ovAlpha = u_showOv * u_opacity * ov.a;
      vec3 surfaceCol = mix(baseCol, ov.rgb, ovAlpha);

      // Solar illumination & terrain hillshading
      vec3 V = normalize(u_camPos - v_pos);
      if (u_lighting > 0.5) {
        vec3 L = normalize(u_sunDir);
        float diffSphere = max(0.0, dot(N, L));
        float diffDetail = max(0.0, dot(pertN, L));
        float terminator = smoothstep(-0.18, 0.22, dot(N, L));
        float shade = mix(0.16, 1.08, 0.45 * diffSphere + 0.55 * diffDetail) * mix(0.22, 1.0, terminator);

        // Subtle specular sheen on high-albedo / overlay zones
        vec3 H = normalize(L + V);
        float spec = pow(max(0.0, dot(pertN, H)), 28.0) * 0.10 * terminator;
        surfaceCol = surfaceCol * shade + vec3(spec);
      } else {
        float reliefShade = clamp(0.75 + 0.45 * dot(pertN, normalize(u_camPos)), 0.45, 1.18);
        surfaceCol *= reliefShade;
      }

      // Martian atmospheric limb scattering (Rayleigh/dust Fresnel halo)
      float ndotv = max(0.0, dot(N, V));
      float rim = pow(1.0 - ndotv, 3.0);
      vec3 atmoColor = mix(vec3(0.92, 0.48, 0.28), vec3(0.35, 0.72, 0.98), 0.38);
      surfaceCol += atmoColor * rim * 0.42;

      gl_FragColor = vec4(surfaceCol, 1.0);
    }
  `;

  const VS_HALO = `
    attribute vec2 a_pos;
    varying vec2 v_p;
    void main() {
      v_p = a_pos;
      gl_Position = vec4(a_pos, 0.999, 1.0);
    }
  `;

  const FS_HALO = `
    precision highp float;
    varying vec2 v_p;
    uniform vec2 u_res;
    uniform float u_sphereScreenR;
    uniform vec2 u_camAngles; // lon, lat in radians
    uniform float u_fov;

    // Fast high-quality pseudo-random hash
    vec2 hash22(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.xx + p3.yz) * p3.zy);
    }

    // Stellar spectral classification color temperature map (O, B, A, F, G, K, M)
    vec3 spectralColor(float t) {
      if (t < 0.20) return mix(vec3(0.68, 0.78, 1.0), vec3(0.85, 0.91, 1.0), t * 5.0);       // O/B Blue-White
      if (t < 0.50) return mix(vec3(0.85, 0.91, 1.0), vec3(1.0, 1.0, 1.0), (t - 0.20) / 0.30); // A White
      if (t < 0.75) return mix(vec3(1.0, 1.0, 0.95), vec3(1.0, 0.88, 0.72), (t - 0.50) / 0.25);// F/G Yellow
      if (t < 0.90) return mix(vec3(1.0, 0.88, 0.72), vec3(1.0, 0.65, 0.45), (t - 0.75) / 0.15);// K Orange
      return mix(vec3(1.0, 0.65, 0.45), vec3(1.0, 0.42, 0.35), (t - 0.90) / 0.10);             // M Red Dwarf / Supergiant
    }

    // Layered procedural starfield with Airy disc Gaussian PSF and diffraction spikes
    vec3 renderStars(vec2 celUV, float scale, float density, float brightnessMult, bool addSpikes) {
      vec2 sp = celUV * scale;
      vec2 cellId = floor(sp);
      vec2 cellCoord = fract(sp) - 0.5;
      vec3 starsCol = vec3(0.0);

      // 3x3 search to handle stars near cell borders smoothly
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 neighbor = vec2(float(x), float(y));
          vec2 rnd = hash22(cellId + neighbor);
          
          if (rnd.x > (1.0 - density)) {
            vec2 starPos = neighbor + (rnd - 0.5) * 0.75;
            float dist = length(cellCoord - starPos);
            
            // Normalized star peak brightness
            float starMag = (rnd.x - (1.0 - density)) / density;
            float peak = pow(starMag, 2.5) * brightnessMult;

            // Airy disc / Gaussian PSF profile
            float core = exp(-dist * dist * 950.0);
            float halo = exp(-dist * 35.0) * 0.15;
            float total = (core + halo) * peak;

            // 4-point cross diffraction spikes for prominent 1st magnitude stars
            if (addSpikes && starMag > 0.82) {
              vec2 dVec = abs(cellCoord - starPos);
              float spikeX = exp(-dVec.x * 2.5) * exp(-dVec.y * 120.0);
              float spikeY = exp(-dVec.y * 2.5) * exp(-dVec.x * 120.0);
              total += (spikeX + spikeY) * peak * 0.45;
            }

            vec3 starColor = spectralColor(rnd.y);
            starsCol += total * starColor;
          }
        }
      }
      return starsCol;
    }

    void main() {
      vec2 aspect = vec2(u_res.x / u_res.y, 1.0);
      vec2 p = v_p * aspect;
      float d = length(p);

      // 1. Ray direction in camera space
      float f = 1.0 / tan(u_fov * 0.5);
      vec3 rayCam = normalize(vec3(p.x, p.y, -f));

      // 2. Rotate ray into inertial celestial sphere (Lon & Lat Euler rotation)
      float cosLat = cos(u_camAngles.y);
      float sinLat = sin(u_camAngles.y);
      float cosLon = cos(u_camAngles.x);
      float sinLon = sin(u_camAngles.x);

      // Pitch (X-axis)
      vec3 ray1 = vec3(
        rayCam.x,
        rayCam.y * cosLat - rayCam.z * sinLat,
        rayCam.y * sinLat + rayCam.z * cosLat
      );
      // Yaw (Y-axis)
      vec3 rayCel = vec3(
        ray1.x * cosLon + ray1.z * sinLon,
        ray1.y,
        -ray1.x * sinLon + ray1.z * cosLon
      );

      // Celestial spherical coordinates (Lon [-PI, PI], Lat [-PI/2, PI/2])
      float celLon = atan(rayCel.x, rayCel.z);
      float celLat = asin(clamp(rayCel.y, -0.9999, 0.9999));
      vec2 celUV = vec2(celLon * 0.1591549, celLat * 0.3183098); // Normalized 0..1 scale

      // 3. Realistic deep space background gradient
      vec3 col = mix(vec3(0.005, 0.008, 0.016), vec3(0.001, 0.002, 0.005), clamp(d * 0.65, 0.0, 1.0));

      // 4. Milky Way galactic plane diffuse dust band
      // Galactic plane tilt modeled as sinusoidal latitude ribbon
      float mwPlaneDist = abs(celLat + 0.38 * sin(celLon * 1.25 + 0.65) - 0.12);
      float mwGlow = exp(-mwPlaneDist * mwPlaneDist * 8.5);
      vec3 mwCol = mix(vec3(0.018, 0.024, 0.042), vec3(0.045, 0.042, 0.038), clamp(sin(celLon * 2.0) * 0.5 + 0.5, 0.0, 1.0));
      col += mwCol * mwGlow * 1.8;

      // 5. Multi-tiered celestial starfield (outside Martian planetary disk)
      if (d > u_sphereScreenR * 0.96) {
        // Star atmospheric extinction factor as stars approach limb
        float limbDist = d - u_sphereScreenR;
        float starAlpha = smoothstep(-0.02, 0.04, limbDist);

        vec3 starfield = vec3(0.0);
        // Tier A: Micro faint background stars (high density, faint)
        starfield += renderStars(celUV, 420.0, 0.035, 0.55, false);
        // Tier B: Medium magnitude stars
        starfield += renderStars(celUV, 190.0, 0.025, 1.35, false);
        // Tier C: Major 1st-magnitude guide stars with diffraction spikes
        starfield += renderStars(celUV, 85.0, 0.012, 3.20, true);

        // Milky Way localized stellar density boost along galactic equator
        starfield += renderStars(celUV + vec2(0.13, 0.47), 310.0, 0.045, 0.85, false) * (mwGlow * 1.4);

        col += starfield * starAlpha;
      }

      // 6. Outer Martian atmospheric corona & dust haze limb glow
      float edge = d - u_sphereScreenR;
      if (edge > -0.04) {
        float glow = exp(-max(0.0, edge) * 18.0 / max(0.2, u_sphereScreenR)) * smoothstep(-0.04, 0.005, edge);
        col += vec3(0.88, 0.42, 0.24) * glow * 0.34 + vec3(0.22, 0.68, 0.96) * glow * 0.16;
      }

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function createShader(gl, type, src) {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  function createProg(gl, vs, fs) {
    const sv = createShader(gl, gl.VERTEX_SHADER, vs);
    const sf = createShader(gl, gl.FRAGMENT_SHADER, fs);
    if (!sv || !sf) return null;
    const p = gl.createProgram();
    gl.attachShader(p, sv);
    gl.attachShader(p, sf);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(p));
      gl.deleteProgram(p);
      return null;
    }
    return p;
  }

  function createGlobe(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: false });
    if (!gl) return null;

    // Build 240 x 120 UV sphere mesh (29,241 vertices, fits in Uint16Array)
    const LON_SEGS = 240, LAT_SEGS = 120;
    const uvs = new Float32Array((LON_SEGS + 1) * (LAT_SEGS + 1) * 2);
    const indices = new Uint16Array(LON_SEGS * LAT_SEGS * 6);
    let ptr = 0;
    for (let y = 0; y <= LAT_SEGS; y++) {
      const v = y / LAT_SEGS;
      for (let x = 0; x <= LON_SEGS; x++) {
        uvs[ptr++] = x / LON_SEGS;
        uvs[ptr++] = v;
      }
    }
    let idx = 0;
    const stride = LON_SEGS + 1;
    for (let y = 0; y < LAT_SEGS; y++) {
      for (let x = 0; x < LON_SEGS; x++) {
        const a = y * stride + x;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices[idx++] = a; indices[idx++] = c; indices[idx++] = b;
        indices[idx++] = b; indices[idx++] = c; indices[idx++] = d;
      }
    }

    function makeTex(wrapX) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapX ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }

    let res = null, lastBaseImg = null;

    function initGL() {
      const progGlobe = createProg(gl, VS_GLOBE, FS_GLOBE);
      const progHalo = createProg(gl, VS_HALO, FS_HALO);
      if (!progGlobe || !progHalo) { res = null; return false; }

      const vboGlobe = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vboGlobe);
      gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);

      const iboGlobe = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iboGlobe);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

      const vboQuad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vboQuad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

      res = {
        progGlobe, progHalo, vboGlobe, iboGlobe, vboQuad,
        texBase: makeTex(true), texElev: makeTex(true), texOv: makeTex(true),
        aPos: gl.getAttribLocation(progHalo, 'a_pos'),
        aUv: gl.getAttribLocation(progGlobe, 'a_uv'),
        uHalo: {
          res: gl.getUniformLocation(progHalo, 'u_res'),
          sphereR: gl.getUniformLocation(progHalo, 'u_sphereScreenR'),
          camAngles: gl.getUniformLocation(progHalo, 'u_camAngles'),
          fov: gl.getUniformLocation(progHalo, 'u_fov'),
        },
        uGlobe: {
          baseTex: gl.getUniformLocation(progGlobe, 'u_baseTex'),
          elevTex: gl.getUniformLocation(progGlobe, 'u_elevTex'),
          ovTex: gl.getUniformLocation(progGlobe, 'u_ovTex'),
          mvp: gl.getUniformLocation(progGlobe, 'u_mvp'),
          relief: gl.getUniformLocation(progGlobe, 'u_relief'),
          opacity: gl.getUniformLocation(progGlobe, 'u_opacity'),
          showOv: gl.getUniformLocation(progGlobe, 'u_showOv'),
          lighting: gl.getUniformLocation(progGlobe, 'u_lighting'),
          camPos: gl.getUniformLocation(progGlobe, 'u_camPos'),
          sunDir: gl.getUniformLocation(progGlobe, 'u_sunDir'),
        },
      };
      return true;
    }

    if (!initGL()) return null;

    // State
    const state = {
      active: false,
      contextLost: false,
      rotLat: 16,      // degrees
      rotLon: 65,      // degrees (starts facing Syrtis / Jezero / Hellas hemisphere)
      targetLat: 16,
      targetLon: 65,
      camDist: 3.1,
      targetDist: 3.1,
      fov: 38 * DEG,
      exaggeration: 8, // 1x, 5x, 8x, 15x
      autoSpin: false,
      sunLight: true,
      sunAngle: 0.45,
      elevData: null,
      W: 2048,
      H: 1024,
      onContextLost: null,
      onContextRestored: null,
    };

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      state.contextLost = true;
      if (state.onContextLost) state.onContextLost();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      state.contextLost = false;
      if (!initGL()) return;
      if (lastBaseImg && state.elevData) setLayers(lastBaseImg, state.elevData, state.W, state.H);
      else if (lastBaseImg) setBaseTexture(lastBaseImg);
      if (state.onContextRestored) state.onContextRestored();
    });

    function getReliefScale() {
      // Physical Mars relief is ~29.5 km / 3389.5 km = 0.0087 of radius.
      return 0.0087 * state.exaggeration;
    }

    // Upload (or replace) the colour texture. Power-of-two images get mipmaps + anisotropic
    // filtering so the 4096x2048 Viking mosaic stays sharp at every zoom. Throws on a tainted image.
    function setBaseTexture(img) {
      lastBaseImg = img;
      if (!res || state.contextLost || gl.isContextLost()) return;
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.bindTexture(gl.TEXTURE_2D, res.texBase);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      const pot = (w & (w - 1)) === 0 && (h & (h - 1)) === 0;
      if (pot) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        const aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
        if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
      if (gl.getError() !== gl.NO_ERROR) throw new Error('texture upload failed');
    }

    function setLayers(baseImg, elevUint8, width, height) {
      state.W = width;
      state.H = height;
      state.elevData = elevUint8;
      if (!res || state.contextLost || gl.isContextLost()) return;

      setBaseTexture(baseImg);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

      gl.bindTexture(gl.TEXTURE_2D, res.texElev);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, width, height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, elevUint8);
    }

    function updateOverlay(ovCanvas) {
      if (!res || state.contextLost || gl.isContextLost()) return;
      gl.bindTexture(gl.TEXTURE_2D, res.texOv);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ovCanvas);
    }

    function flyTo(lat, lon, dist) {
      state.targetLat = Math.max(-82, Math.min(82, lat));
      // Shortest angular path for longitude
      let dLon = ((lon - state.rotLon + 540) % 360) - 180;
      state.targetLon = state.rotLon + dLon;
      if (dist !== undefined) state.targetDist = Math.max(1.22, Math.min(5.0, dist));
    }

    function stepPhysics() {
      if (state.autoSpin) {
        state.targetLon += 0.12;
      }
      const dLat = state.targetLat - state.rotLat;
      const dLon = state.targetLon - state.rotLon;
      const dDist = state.targetDist - state.camDist;
      const moving = Math.abs(dLat) > 0.02 || Math.abs(dLon) > 0.02 || Math.abs(dDist) > 0.001 || state.autoSpin;
      state.rotLat += dLat * 0.18;
      state.rotLon += dLon * 0.18;
      state.camDist += dDist * 0.22;
      if (!moving) {
        state.rotLat = state.targetLat;
        state.rotLon = ((state.targetLon + 540) % 360) - 180;
        state.targetLon = state.rotLon;
        state.camDist = state.targetDist;
      }
      return moving;
    }

    // Rotate world point (wx, wy, wz) into camera-aligned globe space
    function worldToRot(wx, wy, wz) {
      const rLat = state.rotLat * DEG;
      const rLon = state.rotLon * DEG;
      const cLon = Math.cos(rLon), sLon = Math.sin(rLon);
      const cLat = Math.cos(rLat), sLat = Math.sin(rLat);

      const x1 = wx * cLon - wz * sLon;
      const y1 = wy;
      const z1 = wx * sLon + wz * cLon;

      const x2 = x1;
      const y2 = y1 * cLat - z1 * sLat;
      const z2 = y1 * sLat + z1 * cLat;
      return [x2, y2, z2];
    }

    // Inverse rotate from camera-aligned globe space back to world (wx, wy, wz)
    function rotToWorld(x2, y2, z2) {
      const rLat = state.rotLat * DEG;
      const rLon = state.rotLon * DEG;
      const cLon = Math.cos(rLon), sLon = Math.sin(rLon);
      const cLat = Math.cos(rLat), sLat = Math.sin(rLat);

      const x1 = x2;
      const y1 = y2 * cLat + z2 * sLat;
      const z1 = -y2 * sLat + z2 * cLat;

      const wx = x1 * cLon + z1 * sLon;
      const wy = y1;
      const wz = -x1 * sLon + z1 * cLon;
      return [wx, wy, wz];
    }

    function elevRadiusAt(lat, lon) {
      if (!state.elevData) return 1.0;
      const W = state.W, H = state.H;
      const x = ((Math.floor((lon + 180) / 360 * W) % W) + W) % W;
      const y = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / 180 * H)));
      const elevRaw = state.elevData[y * W + x] / 255;
      return 1.0 + (elevRaw - 0.278) * getReliefScale();
    }

    // Project (lat, lon) in degrees -> [screenX, screenY, visible]
    function project(lat, lon, useElev) {
      const phi = lat * DEG, lam = lon * DEG;
      const r = useElev === false ? 1.0 : elevRadiusAt(lat, lon);
      const wx = Math.cos(phi) * Math.sin(lam) * r;
      const wy = Math.sin(phi) * r;
      const wz = Math.cos(phi) * Math.cos(lam) * r;

      const [rx, ry, rz] = worldToRot(wx, wy, wz);
      const camZ = state.camDist - rz;
      if (camZ <= 0.05) return [0, 0, false];

      // Horizon occlusion check: dot(normal, camPos - pos) > 0 => rz * camDist > r * r
      const visible = (rz * state.camDist) > (r * r * 0.96);

      const f = 1.0 / Math.tan(state.fov * 0.5);
      const aspect = canvas.width / Math.max(1, canvas.height);
      const ndcX = (rx * f / aspect) / camZ;
      const ndcY = (ry * f) / camZ;

      const sx = (ndcX * 0.5 + 0.5) * canvas.width;
      const sy = (0.5 - ndcY * 0.5) * canvas.height;
      return [sx, sy, visible];
    }

    // Raycast screen pixel (sx, sy) -> [gx, gy, lat, lon] or null if off-globe
    function unproject(sx, sy) {
      const W = state.W, H = state.H;
      const aspect = canvas.width / Math.max(1, canvas.height);
      const tanHalf = Math.tan(state.fov * 0.5);
      const ndcX = (sx / canvas.width) * 2 - 1;
      const ndcY = 1 - (sy / canvas.height) * 2;

      let dx = ndcX * aspect * tanHalf;
      let dy = ndcY * tanHalf;
      let dz = -1;
      const len = Math.hypot(dx, dy, dz);
      dx /= len; dy /= len; dz /= len;

      const oz = state.camDist;
      const b = oz * dz;
      const c = oz * oz - 1.0;
      const disc = b * b - c;
      if (disc < 0) return null;

      let t = -b - Math.sqrt(disc);
      if (t <= 0) return null;

      // Refine once with actual MOLA elevation radius at hit point
      let hx = t * dx, hy = t * dy, hz = oz + t * dz;
      let [wx, wy, wz] = rotToWorld(hx, hy, hz);
      let lat = Math.asin(Math.max(-1, Math.min(1, wy))) * RAD;
      let lon = Math.atan2(wx, wz) * RAD;
      const r = elevRadiusAt(lat, lon);
      const c2 = oz * oz - r * r;
      const disc2 = b * b - c2;
      if (disc2 >= 0) {
        t = -b - Math.sqrt(disc2);
        hx = t * dx; hy = t * dy; hz = oz + t * dz;
        [wx, wy, wz] = rotToWorld(hx, hy, hz);
        const invR = 1 / Math.hypot(wx, wy, wz);
        lat = Math.asin(Math.max(-1, Math.min(1, wy * invR))) * RAD;
        lon = Math.atan2(wx, wz) * RAD;
      }

      const gx = ((Math.floor((lon + 180) / 360 * W) % W) + W) % W;
      const gy = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / 180 * H)));
      return [gx, gy, lat, lon];
    }

    function buildMVP() {
      const aspect = canvas.width / Math.max(1, canvas.height);
      const f = 1.0 / Math.tan(state.fov * 0.5);
      const near = 0.08, far = 20.0;
      const nf = 1 / (near - far);

      const rLat = state.rotLat * DEG;
      const rLon = state.rotLon * DEG;
      const cLon = Math.cos(rLon), sLon = Math.sin(rLon);
      const cLat = Math.cos(rLat), sLat = Math.sin(rLat);

      // View rotation R = Rx(rLat) * Ry(-rLon), translation Tz = -camDist
      const r00 = cLon,          r01 = 0,     r02 = -sLon;
      const r10 = -sLat * sLon,  r11 = cLat,  r12 = -sLat * cLon;
      const r20 = cLat * sLon,   r21 = sLat,  r22 = cLat * cLon;
      const tz = -state.camDist;

      const sx = f / aspect, sy = f, sz = (far + near) * nf, sw = 2 * far * near * nf;

      // Column-major 4x4 MVP = P * V
      return new Float32Array([
        sx * r00, sy * r10, sz * r20, -r20,
        sx * r01, sy * r11, sz * r21, -r21,
        sx * r02, sy * r12, sz * r22, -r22,
        0,        0,        sz * tz + sw, -tz,
      ]);
    }

    function render(opts) {
      if (!res || state.contextLost || gl.isContextLost()) return;
      const w = canvas.width, h = canvas.height;
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.012, 0.018, 0.03, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // 1. Background starfield + atmospheric corona
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(res.progHalo);
      gl.bindBuffer(gl.ARRAY_BUFFER, res.vboQuad);
      gl.enableVertexAttribArray(res.aPos);
      gl.vertexAttribPointer(res.aPos, 2, gl.FLOAT, false, 0, 0);

      const f = 1.0 / Math.tan(state.fov * 0.5);
      const sphereScreenR = f / Math.sqrt(Math.max(1.05, state.camDist * state.camDist - 1.0));
      gl.uniform2f(res.uHalo.res, w, h);
      gl.uniform1f(res.uHalo.sphereR, sphereScreenR);
      gl.uniform2f(res.uHalo.camAngles, state.rotLon * DEG, state.rotLat * DEG);
      gl.uniform1f(res.uHalo.fov, state.fov);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // 2. 3D displaced MOLA Mars globe
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);

      gl.useProgram(res.progGlobe);
      gl.bindBuffer(gl.ARRAY_BUFFER, res.vboGlobe);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, res.iboGlobe);
      gl.enableVertexAttribArray(res.aUv);
      gl.vertexAttribPointer(res.aUv, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, res.texBase);
      gl.uniform1i(res.uGlobe.baseTex, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, res.texElev);
      gl.uniform1i(res.uGlobe.elevTex, 1);

      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, res.texOv);
      gl.uniform1i(res.uGlobe.ovTex, 2);

      const mvp = buildMVP();
      gl.uniformMatrix4fv(res.uGlobe.mvp, false, mvp);
      gl.uniform1f(res.uGlobe.relief, getReliefScale());
      gl.uniform1f(res.uGlobe.opacity, opts.opacity ?? 0.7);
      gl.uniform1f(res.uGlobe.showOv, opts.showOverlay ? 1.0 : 0.0);
      gl.uniform1f(res.uGlobe.lighting, state.sunLight ? 1.0 : 0.0);

      // Camera & Sun direction in world space (headlight-offset solar vector for optimal inspection)
      const [camWx, camWy, camWz] = rotToWorld(0, 0, state.camDist);
      const [sunWx, sunWy, sunWz] = rotToWorld(1.15, 0.75, state.camDist + 1.5);
      gl.uniform3f(res.uGlobe.camPos, camWx, camWy, camWz);
      gl.uniform3f(res.uGlobe.sunDir, sunWx, sunWy, sunWz);

      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
    }

    function equatorialKmPerCssPx() {
      const f = 1.0 / Math.tan(state.fov * 0.5);
      const screenRadiusCssPx = (f / Math.max(0.2, state.camDist - 1.0)) * (canvas.height / (window.devicePixelRatio || 1)) * 0.5;
      return MARS_R / Math.max(20, screenRadiusCssPx);
    }

    return {
      state,
      setLayers,
      setBaseTexture,
      updateOverlay,
      flyTo,
      stepPhysics,
      project,
      unproject,
      render,
      equatorialKmPerCssPx,
    };
  }

  global.GLOBE3D = { createGlobe };
})(typeof window !== 'undefined' ? window : module.exports);
