import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import SimWorker from '../workers/sim.worker.js?worker';

// Quality presets
const QUALITY = {
  ultra: { waterSeg: 200, shadowRes: 2048, particles: 200, pixelRatio: 2, treeCount: 60, stumpCount: 100 },
  high: { waterSeg: 150, shadowRes: 1024, particles: 120, pixelRatio: 2, treeCount: 40, stumpCount: 80 },
  medium: { waterSeg: 80, shadowRes: 512, particles: 60, pixelRatio: 1.5, treeCount: 20, stumpCount: 50 },
  low: { waterSeg: 40, shadowRes: 0, particles: 20, pixelRatio: 1, treeCount: 10, stumpCount: 30 },
};

function detectQuality() {
  const gl = document.createElement('canvas').getContext('webgl');
  if (!gl) return 'low';
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);
  if (isMobile) return 'low';
  if (/Intel|Mesa|SwiftShader/i.test(gpu)) return 'medium';
  return 'high';
}

// Shaders
const waterVS = `uniform float uTime;varying vec3 vWP;varying float vElev;
void main(){vec4 wp=modelMatrix*vec4(position,1.0);
float e=sin(wp.x*0.02+uTime)*0.5+sin(wp.z*0.03+uTime*0.8)*0.4+sin((wp.x+wp.z)*0.05+uTime*1.2)*0.2;
wp.y+=e;vElev=e;vWP=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}`;

const waterFS = `uniform vec3 uBase,uShallow,uSun,uCam;varying vec3 vWP;varying float vElev;
void main(){vec3 dx=dFdx(vWP),dz=dFdz(vWP);vec3 n=normalize(cross(dz,dx));vec3 v=normalize(uCam-vWP);
float f=pow(1.0-max(dot(v,n),0.0),4.0);vec3 c=mix(uBase,uShallow,smoothstep(-0.8,0.8,vElev));
vec3 h=normalize(uSun+v);float s=pow(max(dot(n,h),0.0),256.0)*1.5;float foam=smoothstep(0.6,1.0,vElev)*0.8;
c+=vec3(s)+vec3(foam);float d=length(uCam-vWP);c=mix(c,vec3(0.05,0.08,0.12),smoothstep(100.0,500.0,d));
gl_FragColor=vec4(c,0.92);}`;

const terrainVS = `varying vec3 vP,vN;void main(){vP=(modelMatrix*vec4(position,1.0)).xyz;vN=normalMatrix*normal;gl_Position=projectionMatrix*viewMatrix*vec4(vP,1.0);}`;
const terrainFS = `varying vec3 vP,vN;uniform vec3 uS;void main(){vec3 n=normalize(vN);float l=max(dot(n,uS),0.2)+0.2;vec3 c;
if(vP.y<2.0)c=vec3(0.76,0.7,0.5);else if(vP.y<15.0)c=mix(vec3(0.2,0.35,0.15),vec3(0.3),smoothstep(0.3,0.6,1.0-max(dot(n,vec3(0,1,0)),0.0)));else c=vec3(0.3);
gl_FragColor=vec4(c*l,1.0);}`;

export default function Simulation({ supabase, profile, session, onLeave }) {
  const mountRef = useRef(null);
  const workerRef = useRef(null);
  const engineRef = useRef({});
  const [tele, setTele] = useState({ speed: 0, heading: 'N', depth: 45, nm: profile?.nautical_miles || 0 });
  const [comms, setComms] = useState('MIC_OFF');
  const [fps, setFps] = useState(60);
  const [qual, setQual] = useState(() => detectQuality());
  const frameTimesRef = useRef([]);
  const hiddenRef = useRef(false);

  // Pause sim when tab hidden
  useEffect(() => {
    const onVis = () => { hiddenRef.current = document.hidden; };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    const Q = QUALITY[qual];
    const w = window.innerWidth, h = window.innerHeight;

    // Renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050810);
    scene.fog = new THREE.FogExp2(0x050810, 0.002);
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: qual !== 'low', powerPreference: 'high-performance' });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    if (Q.shadowRes > 0) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    if (mountRef.current) mountRef.current.appendChild(renderer.domElement);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const sunDir = new THREE.Vector3(1, 0.5, 0.8).normalize();
    const dl = new THREE.DirectionalLight(0xfff0dd, 2.5);
    dl.position.copy(sunDir).multiplyScalar(100);
    if (Q.shadowRes > 0) {
      dl.castShadow = true;
      dl.shadow.mapSize.set(Q.shadowRes, Q.shadowRes);
      dl.shadow.camera.left = -300; dl.shadow.camera.right = 300;
      dl.shadow.camera.top = 300; dl.shadow.camera.bottom = -300;
    }
    scene.add(dl);

    // Terrain
    const tG = new THREE.PlaneGeometry(1000, 1000, 128, 128);
    tG.rotateX(-Math.PI / 2);
    const pos = tG.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const d = Math.sqrt(x * x + z * z);
      let y = -10 + Math.sin(x * 0.01) * Math.cos(z * 0.01) * 20 + Math.sin(x * 0.05 + z * 0.03) * 5;
      if (d > 200) y += Math.pow((d - 200) * 0.05, 2);
      pos.setY(i, y);
    }
    tG.computeVertexNormals();
    scene.add(new THREE.Mesh(tG, new THREE.ShaderMaterial({ vertexShader: terrainVS, fragmentShader: terrainFS, uniforms: { uS: { value: sunDir } } })));

    // Water
    const wG = new THREE.PlaneGeometry(2000, 2000, Q.waterSeg, Q.waterSeg);
    wG.rotateX(-Math.PI / 2);
    const wM = new THREE.ShaderMaterial({
      vertexShader: waterVS, fragmentShader: waterFS, transparent: true,
      uniforms: {
        uTime: { value: 0 }, uBase: { value: new THREE.Color(0x020f20) },
        uShallow: { value: new THREE.Color(0x0a2e3f) }, uSun: { value: sunDir }, uCam: { value: camera.position },
      },
    });
    scene.add(new THREE.Mesh(wG, wM));

    // Boat
    const mkBoat = (hex) => {
      const g = new THREE.Group();
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.lineTo(1.2, 0); shape.lineTo(1.4, 1.2); shape.lineTo(0.8, 1.4);
      shape.lineTo(0, 1.5); shape.lineTo(-0.8, 1.4); shape.lineTo(-1.4, 1.2); shape.lineTo(-1.2, 0);
      const hG = new THREE.ExtrudeGeometry(shape, { depth: 5, bevelEnabled: true, bevelSegments: 2, steps: 2, bevelSize: 0.1, bevelThickness: 0.1 });
      hG.center();
      const hP = hG.attributes.position;
      for (let i = 0; i < hP.count; i++) if (hP.getZ(i) < 0) { hP.setX(i, hP.getX(i) * Math.max(0.1, 1 - (Math.abs(hP.getZ(i)) / 2.5))); hP.setY(i, hP.getY(i) + (Math.abs(hP.getZ(i)) * 0.1)); }
      hG.computeVertexNormals();
      g.add(new THREE.Mesh(hG, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.2, metalness: 0.3 })));
      g.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 4), new THREE.MeshStandardMaterial({ color: 0xe0e0e0 })), { position: new THREE.Vector3(0, 0.6, 0.2) }));
      return g;
    };
    const myBoat = mkBoat(profile?.active_color || 0xffffff);
    myBoat.position.set(0, 0, 0);
    scene.add(myBoat);

    // Obstacles for collision worker
    const obstacles = [];
    for (let i = 0; i < Q.stumpCount; i++) {
      const sx = (Math.random() - 0.5) * 400, sz = -Math.random() * 400;
      if (Math.abs(sz) < 30) continue;
      const r = 0.4 + Math.random() * 0.6;
      const sg = new THREE.CylinderGeometry(r, r + 0.3, 1 + Math.random() * 2, 6);
      const s = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0x2a1a0a }));
      s.position.set(sx, -0.3, sz);
      scene.add(s);
      obstacles.push({ x: sx, z: sz, r });
    }

    // Billboard
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#0ea5e9'; ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 100px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('DOCKSHIELD DaaS', 512, 128);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(20, 5, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
    sign.position.set(220, 8, 0); sign.rotation.y = -Math.PI / 2; scene.add(sign);

    // Web Worker
    const worker = new SimWorker();
    workerRef.current = worker;
    worker.postMessage({
      type: 'init',
      boatClass: 'pontoon',
      spawnX: (Math.random() - 0.5) * 80,
      spawnZ: 30 + Math.random() * 40,
      rY: Math.PI + Math.random() * 0.5 - 0.25,
      obstacles,
      dockX: 0, dockZ: -250, dockR: 12,
    });

    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'state') {
        myBoat.position.set(msg.x, msg.y, msg.z);
        myBoat.rotation.set(msg.rX, msg.rY, msg.rZ);
        engineRef.current.lastState = msg;
      }
      if (msg.type === 'end') {
        engineRef.current.ended = msg;
      }
    };

    // Input
    const keys = { w: false, a: false, s: false, d: false };
    const touch = { throttle: 0, steer: 0 };
    engineRef.current = { scene, camera, renderer, wM, myBoat, mkBoat, keys, touch, clock: new THREE.Clock(), otherBoats: {}, lastState: null, ended: null, worker };

    const kd = (e) => { const k = e.key.toLowerCase(); if (keys.hasOwnProperty(k)) keys[k] = true; };
    const ku = (e) => { const k = e.key.toLowerCase(); if (keys.hasOwnProperty(k)) keys[k] = false; };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    const onResize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); };
    window.addEventListener('resize', onResize);

    // Supabase Realtime
    let channel = null;
    if (supabase && profile) {
      channel = supabase.channel(session?.lakeId || 'lake_lanier', { config: { broadcast: { self: false } } });
      channel.on('broadcast', { event: 'telemetry' }, ({ payload }) => {
        const { id, x, z, rY, color } = payload;
        const ob = engineRef.current.otherBoats;
        if (!ob[id]) { const m = mkBoat(color); m.position.set(x, 0, z); scene.add(m); ob[id] = { mesh: m, target: new THREE.Vector3(x, 0, z), tRY: rY, lastSeen: Date.now() }; }
        else { ob[id].target.set(x, 0, z); ob[id].tRY = rY; ob[id].lastSeen = Date.now(); }
      });
      channel.subscribe();
    }

    // Render loop — only renders, physics in worker
    let lastBroadcast = 0;
    const animate = () => {
      requestAnimationFrame(animate);
      if (hiddenRef.current) return; // Pause when hidden

      const t = engineRef.current.clock.getElapsedTime();
      wM.uniforms.uTime.value = t;
      wM.uniforms.uCam.value.copy(camera.position);

      // Send input to worker each frame
      worker.postMessage({ type: 'input', ...keys, touchThrottle: touch.throttle, touchSteer: touch.steer });

      // Camera follow
      const st = engineRef.current.lastState;
      if (st) {
        const spd = Math.abs(st.speed);
        const behind = new THREE.Vector3(0, 6 + spd * 3, 14);
        behind.applyAxisAngle(new THREE.Vector3(0, 1, 0), myBoat.rotation.y);
        behind.add(myBoat.position);
        camera.position.lerp(behind, 0.08);
        camera.lookAt(myBoat.position.x, myBoat.position.y + 1, myBoat.position.z);
        camera.fov = 50 + (spd / 1.8) * 12;
        camera.updateProjectionMatrix();
      }

      // Remote players
      const now = Date.now();
      const ob = engineRef.current.otherBoats;
      Object.keys(ob).forEach(id => {
        const o = ob[id];
        if (now - o.lastSeen > 5000) { scene.remove(o.mesh); delete ob[id]; }
        else { o.mesh.position.lerp(o.target, 0.1); const df = o.tRY - o.mesh.rotation.y; o.mesh.rotation.y += Math.atan2(Math.sin(df), Math.cos(df)) * 0.1; }
      });

      // FPS tracking
      frameTimesRef.current.push(performance.now());
      if (frameTimesRef.current.length > 60) {
        const first = frameTimesRef.current[0], last = frameTimesRef.current[frameTimesRef.current.length - 1];
        setFps(Math.round(60000 / (last - first)));
        frameTimesRef.current = [];
      }

      // Telemetry broadcast
      if (channel && st && t - lastBroadcast > 0.1 && (Math.abs(st.speed) > 0.01)) {
        lastBroadcast = t;
        channel.send({ type: 'broadcast', event: 'telemetry', payload: { id: profile.id, x: st.x, z: st.z, rY: st.rY, color: profile.active_color || 0xffffff } });
      }

      // UI telemetry
      if (st && Math.floor(t * 10) % 3 === 0) {
        let hd = ((myBoat.rotation.y * 180 / Math.PI) % 360); if (hd < 0) hd += 360;
        setTele(p => ({ ...p, speed: st.absSpeed.toFixed(1), heading: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(hd / 45) % 8], depth: Math.max(2, 45 - (st.x * 0.01)).toFixed(1) }));
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('resize', onResize);
      worker.terminate();
      if (channel) channel.unsubscribe();
      if (mountRef.current && renderer.domElement.parentNode === mountRef.current) mountRef.current.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [qual, supabase, profile]);

  const ta = useCallback((type, val) => () => { if (engineRef.current.touch) engineRef.current.touch[type] = val; }, []);

  return (
    <div className="relative w-full h-full">
      <div ref={mountRef} className="absolute inset-0 cursor-crosshair" />

      {/* HUD */}
      <div className="absolute top-0 left-0 right-0 p-3 md:p-5 flex justify-between items-start pointer-events-none z-10">
        <div className="bg-[#050810]/70 backdrop-blur-xl border border-white/10 rounded-xl p-3 md:p-4 w-48 md:w-64 shadow-2xl">
          <div className="flex justify-between items-center mb-2 border-b border-white/10 pb-2">
            <div>
              <h2 className="text-[10px] md:text-xs font-bold tracking-widest text-white uppercase">{profile?.display_name || 'GUEST'}</h2>
              <span className="text-[8px] text-emerald-400 font-mono">{supabase ? 'ONLINE' : 'OFFLINE'}</span>
            </div>
            <div className="text-right">
              <span className="block text-[8px] uppercase tracking-widest text-slate-500">NM</span>
              <span className="font-mono text-sm md:text-base text-sky-400">{tele.nm}</span>
            </div>
          </div>
          <div className="flex items-center justify-between text-[9px] text-slate-500">
            <span>FPS: <span className={`font-mono ${fps > 50 ? 'text-emerald-400' : fps > 30 ? 'text-amber-400' : 'text-red-400'}`}>{fps}</span></span>
            <span className="font-mono text-sky-400/60">{qual.toUpperCase()}</span>
          </div>
        </div>
        <div className="flex flex-col items-end pointer-events-auto">
          <button onClick={onLeave} className="bg-white/5 hover:bg-red-500/20 hover:text-red-400 backdrop-blur-md border border-white/20 text-[9px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full transition-all mb-2 text-white">Exit</button>
          <div className="bg-[#050810]/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4 md:p-5 text-right shadow-2xl min-w-[130px]">
            <div className="mb-2">
              <span className="block text-[9px] uppercase tracking-widest text-sky-500 mb-1">Speed</span>
              <span className="text-2xl md:text-3xl font-light font-mono text-white tracking-tighter">{tele.speed}<span className="text-[10px] text-slate-500 ml-1">KN</span></span>
            </div>
            <div className="w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent my-2" />
            <div className="flex justify-between items-end">
              <div className="text-left"><span className="block text-[8px] uppercase tracking-widest text-slate-500">Depth</span><span className="text-sm font-mono text-emerald-400">{tele.depth}<span className="text-[8px] text-slate-500 ml-0.5">FT</span></span></div>
              <div className="text-right pl-3"><span className="block text-[8px] uppercase tracking-widest text-slate-500">HDG</span><span className="text-base font-bold font-mono text-white">{tele.heading}</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Crosshair */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-15 pointer-events-none">
        <div className="w-6 h-px bg-white absolute top-1/2 -translate-y-1/2 -left-3" /><div className="w-px h-6 bg-white absolute left-1/2 -translate-x-1/2 -top-3" />
      </div>

      {/* Mobile */}
      <div className="md:hidden absolute bottom-5 left-3 right-3 flex justify-between pointer-events-none z-10">
        <div className="flex space-x-2 pointer-events-auto">
          <button onPointerDown={ta('steer', 1)} onPointerUp={ta('steer', 0)} onPointerLeave={ta('steer', 0)} className="w-12 h-12 bg-[#050810]/80 border border-white/20 rounded-full flex items-center justify-center active:bg-white/20 text-white"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg></button>
          <button onPointerDown={ta('steer', -1)} onPointerUp={ta('steer', 0)} onPointerLeave={ta('steer', 0)} className="w-12 h-12 bg-[#050810]/80 border border-white/20 rounded-full flex items-center justify-center active:bg-white/20 text-white"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg></button>
        </div>
        <button onPointerDown={ta('throttle', 1)} onPointerUp={ta('throttle', 0)} onPointerLeave={ta('throttle', 0)} className="w-12 h-12 bg-sky-500/20 border border-sky-500 rounded-full flex items-center justify-center active:bg-sky-500 text-sky-400 active:text-white shadow-[0_0_20px_rgba(14,165,233,0.3)] pointer-events-auto"><span className="text-[9px] font-bold">FWD</span></button>
      </div>
    </div>
  );
}
