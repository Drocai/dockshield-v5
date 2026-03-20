import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createClient } from '@supabase/supabase-js';

const waterVS = `
uniform float uTime;
varying vec3 vWorldPosition; varying float vElevation;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  float elevation = sin(worldPosition.x * 0.02 + uTime) * 0.5 
                  + sin(worldPosition.z * 0.03 + uTime * 0.8) * 0.4
                  + sin((worldPosition.x + worldPosition.z) * 0.05 + uTime * 1.2) * 0.2;
  worldPosition.y += elevation; vElevation = elevation; vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}`;

const waterFS = `
uniform vec3 uBaseColor; uniform vec3 uShallowColor; uniform vec3 uSunDirection; uniform vec3 uCameraPos;
varying vec3 vWorldPosition; varying float vElevation;
void main() {
  vec3 dx = dFdx(vWorldPosition); vec3 dz = dFdz(vWorldPosition);
  vec3 normal = normalize(cross(dz, dx));
  vec3 viewVector = normalize(uCameraPos - vWorldPosition);
  float fresnel = pow(1.0 - max(dot(viewVector, normal), 0.0), 4.0);
  float mixRatio = smoothstep(-0.8, 0.8, vElevation);
  vec3 albedo = mix(uBaseColor, uShallowColor, mixRatio);
  vec3 halfVector = normalize(uSunDirection + viewVector);
  float specular = pow(max(dot(normal, halfVector), 0.0), 256.0) * 1.5;
  float foam = smoothstep(0.6, 1.0, vElevation) * 0.8;
  vec3 finalColor = albedo + vec3(specular) + vec3(foam);
  float dist = length(uCameraPos - vWorldPosition);
  float fogFactor = smoothstep(100.0, 500.0, dist);
  finalColor = mix(finalColor, vec3(0.05, 0.08, 0.12), fogFactor);
  gl_FragColor = vec4(finalColor, 0.92);
}`;

const terrainVS = `varying vec3 vPos; varying vec3 vNormal; void main() { vPos = (modelMatrix * vec4(position, 1.0)).xyz; vNormal = normalMatrix * normal; gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0); }`;
const terrainFS = `
varying vec3 vPos; varying vec3 vNormal; uniform vec3 uSunDir;
void main() {
  vec3 n = normalize(vNormal); float light = max(dot(n, uSunDir), 0.2) + 0.2;
  vec3 color;
  if (vPos.y < 2.0) color = vec3(0.76, 0.70, 0.50);
  else if (vPos.y < 15.0) color = mix(vec3(0.2, 0.35, 0.15), vec3(0.3, 0.3, 0.3), smoothstep(0.3, 0.6, 1.0 - max(dot(n, vec3(0,1,0)), 0.0)));
  else color = vec3(0.3, 0.3, 0.3);
  gl_FragColor = vec4(color * light, 1.0);
}`;

// Pre-configured Supabase for DockShield
const DS_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const DS_SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export default function App() {
  const [uiState, setUiState] = useState('config');
  const [sbConfig, setSbConfig] = useState({ url: DS_SUPABASE_URL, key: DS_SUPABASE_KEY, email: '', password: '' });
  const [supabase, setSupabase] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [sessionData] = useState({ lakeId: 'lake_lanier', wx: { wind: 8 } });

  const initOffline = () => setUiState('playing');

  const authenticateEdge = async (isSignUp) => {
    if (!sbConfig.url || !sbConfig.key || !sbConfig.email || !sbConfig.password) return alert("Missing credentials");
    try {
      const client = createClient(sbConfig.url, sbConfig.key);
      setSupabase(client);
      let authRes;
      if (isSignUp) {
        authRes = await client.auth.signUp({ email: sbConfig.email, password: sbConfig.password });
        if (authRes.data.user) {
          await client.from('profiles').insert({ id: authRes.data.user.id, display_name: `Captain_${authRes.data.user.id.substring(0,4)}` });
        }
      } else {
        authRes = await client.auth.signInWithPassword({ email: sbConfig.email, password: sbConfig.password });
      }
      if (authRes.error) throw authRes.error;
      const { data: profile } = await client.from('profiles').select('*').eq('id', authRes.data.user.id).single();
      setUserProfile({ ...authRes.data.user, ...profile });
      setUiState('playing');
    } catch (e) { alert("Auth Error: " + e.message); }
  };

  return (
    <div className="w-full h-screen bg-[#05080f] text-slate-100 font-sans overflow-hidden select-none">
      {uiState === 'config' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-[url('https://images.unsplash.com/photo-1544365558-35aa4afcf11f?q=80&w=2000&auto=format&fit=crop')] bg-cover bg-center">
          <div className="absolute inset-0 bg-[#05080f]/90 backdrop-blur-xl"></div>
          <div className="relative z-10 max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="w-12 h-12 bg-gradient-to-br from-sky-500 to-cyan-400 rounded-lg flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(14,165,233,0.3)]">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              </div>
              <h1 className="text-5xl font-light tracking-tighter mb-2 text-white">Dock<span className="font-bold text-sky-400">Shield</span></h1>
              <p className="text-xs font-mono tracking-[0.3em] text-slate-500 uppercase mb-4">PierPressure Engine v5.0</p>
              <p className="text-slate-400 text-lg leading-relaxed mb-8">
                Real-time marina simulation with multiplayer, spatial audio, persistent pilot data, and live weather physics on Lake Lanier.
              </p>
              <button onClick={initOffline} className="border border-white/20 hover:bg-white/5 text-slate-300 font-bold tracking-widest uppercase text-xs px-8 py-3 rounded-full transition-all w-max">
                Launch Offline (Solo Mode)
              </button>
            </div>
            <div className="bg-white/5 border border-white/10 p-8 rounded-2xl backdrop-blur-2xl">
              <h3 className="text-sm font-bold tracking-widest uppercase text-white mb-6 flex items-center">
                <div className="w-2 h-2 bg-emerald-500 rounded-full mr-3 animate-pulse"></div> Secure Edge Uplink
              </h3>
              <div className="space-y-4">
                {!DS_SUPABASE_URL && (
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="text-[9px] text-slate-500 uppercase tracking-widest">Supabase URL</label>
                    <input type="text" value={sbConfig.url} onChange={e => setSbConfig({...sbConfig, url: e.target.value})} className="w-full mt-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-xs focus:border-sky-500 outline-none text-white font-mono" placeholder="https://..." /></div>
                    <div><label className="text-[9px] text-slate-500 uppercase tracking-widest">Anon Key</label>
                    <input type="password" value={sbConfig.key} onChange={e => setSbConfig({...sbConfig, key: e.target.value})} className="w-full mt-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-xs focus:border-sky-500 outline-none text-white font-mono" placeholder="eyJh..." /></div>
                  </div>
                )}
                <div><label className="text-[9px] text-slate-500 uppercase tracking-widest">Pilot Email</label>
                <input type="email" value={sbConfig.email} onChange={e => setSbConfig({...sbConfig, email: e.target.value})} className="w-full mt-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-sm focus:border-sky-500 outline-none text-white" /></div>
                <div><label className="text-[9px] text-slate-500 uppercase tracking-widest">Passcode</label>
                <input type="password" value={sbConfig.password} onChange={e => setSbConfig({...sbConfig, password: e.target.value})} className="w-full mt-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-sm focus:border-sky-500 outline-none text-white" /></div>
                <div className="flex gap-4 pt-4">
                  <button onClick={() => authenticateEdge(false)} className="flex-1 bg-white text-[#05080f] font-bold tracking-widest uppercase text-[10px] py-3 rounded hover:bg-slate-200 transition-all">Login</button>
                  <button onClick={() => authenticateEdge(true)} className="flex-1 border border-white/20 text-white font-bold tracking-widest uppercase text-[10px] py-3 rounded hover:bg-white/10 transition-all">Register</button>
                </div>
              </div>
              <p className="text-[10px] text-slate-600 mt-4 text-center font-mono">USACE-Compliant · Zero Discharge · Lake Lanier</p>
            </div>
          </div>
        </div>
      )}
      {uiState === 'playing' && (
        <EngineCore session={sessionData} supabase={supabase} profile={userProfile} onLeave={() => setUiState('config')} />
      )}
    </div>
  );
}

function EngineCore({ session, supabase, profile, onLeave }) {
  const mountRef = useRef(null);
  const audioContainerRef = useRef(null);
  const [telemetry, setTelemetry] = useState({ speed: 0, heading: 'N', depth: 45, nm: profile?.nautical_miles || 0 });
  const [commsState, setCommsState] = useState('MIC_OFF');
  const engine = useRef({});

  useEffect(() => {
    const w = window.innerWidth, h = window.innerHeight;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x050810); scene.fog = new THREE.FogExp2(0x050810, 0.002);
    const camera = new THREE.PerspectiveCamera(50, w/h, 0.1, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(w,h); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
    if(mountRef.current) mountRef.current.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const sunDir = new THREE.Vector3(1, 0.5, 0.8).normalize();
    const dl = new THREE.DirectionalLight(0xfff0dd, 2.5); dl.position.copy(sunDir).multiplyScalar(100); scene.add(dl);

    // Terrain
    const tG = new THREE.PlaneGeometry(1000,1000,128,128); tG.rotateX(-Math.PI/2);
    const pos = tG.attributes.position;
    for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i);const d=Math.sqrt(x*x+z*z);let y=-10+Math.sin(x*0.01)*Math.cos(z*0.01)*20+Math.sin(x*0.05+z*0.03)*5;if(d>200)y+=Math.pow((d-200)*0.05,2);pos.setY(i,y)}
    tG.computeVertexNormals();
    scene.add(new THREE.Mesh(tG, new THREE.ShaderMaterial({vertexShader:terrainVS,fragmentShader:terrainFS,uniforms:{uSunDir:{value:sunDir}}})));

    // Water
    const wG = new THREE.PlaneGeometry(2000,2000,200,200); wG.rotateX(-Math.PI/2);
    const wM = new THREE.ShaderMaterial({vertexShader:waterVS,fragmentShader:waterFS,transparent:true,
      uniforms:{uTime:{value:0},uBaseColor:{value:new THREE.Color(0x020f20)},uShallowColor:{value:new THREE.Color(0x0a2e3f)},uSunDirection:{value:sunDir},uCameraPos:{value:camera.position}}});
    scene.add(new THREE.Mesh(wG, wM));

    // Billboards
    const mkBB = (x,z,ry,txt,col) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,10), new THREE.MeshStandardMaterial({color:0x222222}));
      post.position.set(x,3,z); scene.add(post);
      const cv = document.createElement('canvas'); cv.width=1024; cv.height=256;
      const ctx = cv.getContext('2d'); ctx.fillStyle=col; ctx.fillRect(0,0,1024,256);
      ctx.fillStyle='#fff'; ctx.font='bold 100px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(txt,512,128);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(20,5,1), new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cv)}));
      sign.position.set(x,8,z); sign.rotation.y=ry; scene.add(sign);
    };
    mkBB(220,0,-Math.PI/2,"DOCKSHIELD DaaS","#0ea5e9");
    mkBB(-200,100,Math.PI/4,"LAKE LANIER MARINA","#10b981");

    // Boat
    const mkBoat = (hex) => {
      const g = new THREE.Group();
      const shape = new THREE.Shape();
      shape.moveTo(0,0);shape.lineTo(1.2,0);shape.lineTo(1.4,1.2);shape.lineTo(0.8,1.4);shape.lineTo(0,1.5);shape.lineTo(-0.8,1.4);shape.lineTo(-1.4,1.2);shape.lineTo(-1.2,0);
      const hG = new THREE.ExtrudeGeometry(shape,{depth:5,bevelEnabled:true,bevelSegments:3,steps:2,bevelSize:0.1,bevelThickness:0.1}); hG.center();
      const hP = hG.attributes.position;
      for(let i=0;i<hP.count;i++)if(hP.getZ(i)<0){hP.setX(i,hP.getX(i)*Math.max(0.1,1-(Math.abs(hP.getZ(i))/2.5)));hP.setY(i,hP.getY(i)+(Math.abs(hP.getZ(i))*0.1))}
      hG.computeVertexNormals();
      g.add(new THREE.Mesh(hG, new THREE.MeshStandardMaterial({color:hex,roughness:0.2,metalness:0.3})));
      g.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(2.2,0.2,4),new THREE.MeshStandardMaterial({color:0xe0e0e0})),{position:new THREE.Vector3(0,0.6,0.2)}));
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(1.2,1.3,0.8,16,1,false,Math.PI,Math.PI),new THREE.MeshPhysicalMaterial({color:0x000,transmission:0.9,opacity:1}));
      glass.rotation.x=-Math.PI/8;glass.position.set(0,1.2,-0.5);g.add(glass);
      return g;
    };
    const myBoat = mkBoat(profile?.active_color || 0xffffff); myBoat.position.set(0,0,0); scene.add(myBoat);

    engine.current = {scene,camera,renderer,waterMat:wM,myBoat,mkBoat,
      keys:{w:false,a:false,s:false,d:false},touch:{throttle:0,steer:0},
      physics:{speed:0,angVel:0},otherBoats:{},clock:new THREE.Clock(),
      lastBroadcast:0,channel:null,distanceAccumulator:0,
      peer:null,localStream:null,audioElements:{},activeCalls:{}};

    engine.current.initAudio = async () => {
      try{
        setCommsState('CONNECTING');
        const stream = await navigator.mediaDevices.getUserMedia({audio:true,video:false});
        const script = document.createElement('script');
        script.src="https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js";
        script.onload=()=>{
          const peerId=profile?`capn_${profile.id}`:`capn_${Math.random().toString(36).substr(2,9)}`;
          const peer=new window.Peer(peerId);
          engine.current.peer=peer;engine.current.localStream=stream;engine.current.peerId=peerId;
          peer.on('call',call=>{call.answer(stream);call.on('stream',rs=>attachRA(call.peer,rs))});
          setCommsState('LIVE');
        };
        document.body.appendChild(script);
      }catch(e){setCommsState('MIC_OFF')}
    };

    const attachRA=(rid,stream)=>{
      if(engine.current.audioElements[rid])return;
      const a=document.createElement('audio');a.srcObject=stream;a.autoplay=true;
      if(audioContainerRef.current)audioContainerRef.current.appendChild(a);
      engine.current.audioElements[rid]=a;
    };

    const kd=e=>{const k=e.key.toLowerCase();if(engine.current.keys.hasOwnProperty(k))engine.current.keys[k]=true};
    const ku=e=>{const k=e.key.toLowerCase();if(engine.current.keys.hasOwnProperty(k))engine.current.keys[k]=false};
    window.addEventListener('keydown',kd);window.addEventListener('keyup',ku);
    window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});

    // Supabase Realtime
    if(supabase&&profile){
      const ch=supabase.channel(session.lakeId,{config:{broadcast:{self:false}}});
      ch.on('broadcast',{event:'telemetry'},({payload})=>{
        const{id,x,z,rY,color,peerId}=payload;const{otherBoats,scene:sc,peer,localStream,activeCalls}=engine.current;
        if(!otherBoats[id]){const m=mkBoat(color);m.position.set(x,0,z);sc.add(m);otherBoats[id]={mesh:m,target:new THREE.Vector3(x,0,z),tRY:rY,lastSeen:Date.now(),peerId};
          if(peer&&localStream&&peerId&&!activeCalls[peerId]){const call=peer.call(peerId,localStream);if(call){activeCalls[peerId]=call;call.on('stream',rs=>attachRA(peerId,rs))}}
        }else{otherBoats[id].target.set(x,0,z);otherBoats[id].tRY=rY;otherBoats[id].lastSeen=Date.now()}
      });
      ch.subscribe();engine.current.channel=ch;
    }

    const waveY=(x,z,t)=>Math.sin(x*0.02+t)*0.5+Math.sin(z*0.03+t*0.8)*0.4+Math.sin((x+z)*0.05+t*1.2)*0.2;

    const animate=()=>{
      requestAnimationFrame(animate);
      const{scene:sc,camera:cam,renderer:rn,waterMat:wm,myBoat:mb,keys,touch,physics:ph,otherBoats:ob,clock,channel,audioElements}=engine.current;
      const dt=Math.min(clock.getDelta(),0.1),t=clock.getElapsedTime();
      wm.uniforms.uTime.value=t;wm.uniforms.uCameraPos.value.copy(cam.position);

      const throt=(keys.w?1:0)-(keys.s?0.5:0)+touch.throttle;
      const steer=(keys.a?1:0)-(keys.d?1:0)+touch.steer;
      ph.speed=Math.max(Math.min(ph.speed+throt*0.015,1.8),-0.3);ph.speed*=0.985;
      if(Math.abs(ph.speed)>0.05)ph.angVel+=steer*0.035;ph.angVel*=0.85;
      mb.rotation.y+=ph.angVel;

      const dir=new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0),mb.rotation.y);
      const prev=mb.position.clone();mb.position.addScaledVector(dir,ph.speed);

      if(profile&&supabase){
        engine.current.distanceAccumulator+=prev.distanceTo(mb.position);
        if(engine.current.distanceAccumulator>1000){engine.current.distanceAccumulator=0;const nm=telemetry.nm+1;setTelemetry(p=>({...p,nm}));supabase.from('profiles').update({nautical_miles:nm}).eq('id',profile.id)}
      }

      const bY=waveY(mb.position.x+dir.x*2.5,mb.position.z+dir.z*2.5,t);
      const sY=waveY(mb.position.x-dir.x*2.5,mb.position.z-dir.z*2.5,t);
      mb.position.y+=((bY+sY)/2-mb.position.y)*0.1;
      mb.rotation.x+=((Math.atan2(bY-sY,5)+(ph.speed*0.12))-mb.rotation.x)*0.1;
      mb.rotation.z=-ph.angVel*3;

      cam.position.lerp(mb.position.clone().add(new THREE.Vector3(0,6+Math.abs(ph.speed)*3,14).applyAxisAngle(new THREE.Vector3(0,1,0),mb.rotation.y)),0.08);
      cam.lookAt(mb.position.x,mb.position.y+1,mb.position.z);

      const now=Date.now();
      Object.keys(ob).forEach(id=>{const o=ob[id];
        if(now-o.lastSeen>5000){sc.remove(o.mesh);delete ob[id];if(o.peerId&&audioElements[o.peerId]){audioElements[o.peerId].remove();delete audioElements[o.peerId]}}
        else{o.mesh.position.lerp(o.target,0.1);const df=o.tRY-o.mesh.rotation.y;o.mesh.rotation.y+=Math.atan2(Math.sin(df),Math.cos(df))*0.1;
          o.mesh.position.y+=(waveY(o.mesh.position.x,o.mesh.position.z,t)-o.mesh.position.y)*0.1;
          if(o.peerId&&audioElements[o.peerId]){const d=mb.position.distanceTo(o.mesh.position);audioElements[o.peerId].volume=Math.max(0,1-d/150)}}
      });

      if(Math.floor(t*10)%2===0){let hd=((mb.rotation.y*180/Math.PI)%360);if(hd<0)hd+=360;
        setTelemetry(p=>({...p,speed:Math.abs(ph.speed*45).toFixed(1),heading:['N','NE','E','SE','S','SW','W','NW'][Math.round(hd/45)%8],depth:Math.max(2,45-(mb.position.x*0.01))}))}

      rn.render(sc,cam);

      if(channel&&t-engine.current.lastBroadcast>0.1&&(Math.abs(ph.speed)>0.01||Math.abs(ph.angVel)>0.01)){
        engine.current.lastBroadcast=t;
        channel.send({type:'broadcast',event:'telemetry',payload:{id:profile.id,x:mb.position.x,z:mb.position.z,rY:mb.rotation.y,color:engine.current.myColor||0xffffff,peerId:engine.current.peerId}})
      }
    };
    animate();

    return()=>{
      window.removeEventListener('keydown',kd);window.removeEventListener('keyup',ku);
      if(engine.current.channel)engine.current.channel.unsubscribe();
      if(engine.current.peer)engine.current.peer.destroy();
      if(engine.current.localStream)engine.current.localStream.getTracks().forEach(t=>t.stop());
      if(mountRef.current&&renderer.domElement.parentNode===mountRef.current)mountRef.current.removeChild(renderer.domElement);
      renderer.dispose();
    };
  },[supabase,profile]);

  const ta=(type,val)=>()=>{if(engine.current.touch)engine.current.touch[type]=val};

  return(
    <div className="relative w-full h-full">
      <div ref={mountRef} className="absolute inset-0 cursor-crosshair"/>
      <div ref={audioContainerRef} className="hidden"/>
      <div className="absolute top-0 left-0 right-0 p-4 md:p-6 flex justify-between items-start pointer-events-none z-10">
        <div className="bg-[#050810]/70 backdrop-blur-xl border border-white/10 rounded-xl p-3 md:p-4 w-56 md:w-72 shadow-2xl">
          <div className="flex justify-between items-center mb-3 border-b border-white/10 pb-2">
            <div><h2 className="text-xs md:text-sm font-bold tracking-widest text-white uppercase">{profile?.display_name||'GUEST_PILOT'}</h2><span className="text-[9px] text-emerald-400 font-mono">{supabase?'DB_SYNC':'OFFLINE'}</span></div>
            <div className="text-right"><span className="block text-[8px] uppercase tracking-widest text-slate-500">NM</span><span className="font-mono text-base md:text-lg text-sky-400">{telemetry.nm.toFixed(0)}</span></div>
          </div>
          <div className="flex items-center justify-between bg-black/50 rounded-lg p-2 border border-white/5 pointer-events-auto">
            <div className="flex items-center"><div className={`w-2 h-2 rounded-full mr-2 ${commsState==='LIVE'?'bg-emerald-500 animate-pulse':commsState==='CONNECTING'?'bg-amber-500 animate-pulse':'bg-red-500'}`}></div><span className="text-[9px] uppercase font-bold text-slate-300">Radio</span></div>
            {commsState==='MIC_OFF'&&<button onClick={()=>engine.current.initAudio?.()} className="bg-sky-500 hover:bg-sky-400 text-white text-[8px] font-bold px-2 py-1 rounded uppercase transition-colors">Mic</button>}
          </div>
        </div>
        <div className="flex flex-col items-end pointer-events-auto">
          <button onClick={onLeave} className="bg-white/5 hover:bg-red-500/20 hover:text-red-400 backdrop-blur-md border border-white/20 text-[9px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full transition-all mb-3 text-white">Exit</button>
          <div className="bg-[#050810]/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4 md:p-6 text-right shadow-2xl min-w-[140px]">
            <div className="mb-3"><span className="block text-[9px] uppercase tracking-widest text-sky-500 mb-1">Speed</span><span className="text-3xl md:text-4xl font-light font-mono text-white tracking-tighter">{telemetry.speed}<span className="text-xs text-slate-500 ml-1">KN</span></span></div>
            <div className="w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent my-3"></div>
            <div className="flex justify-between items-end">
              <div className="text-left"><span className="block text-[8px] uppercase tracking-widest text-slate-500 mb-1">Depth</span><span className="text-sm md:text-lg font-mono text-emerald-400">{telemetry.depth.toFixed(1)}<span className="text-[9px] text-slate-500 ml-1">FT</span></span></div>
              <div className="text-right pl-4"><span className="block text-[8px] uppercase tracking-widest text-slate-500 mb-1">HDG</span><span className="text-lg md:text-xl font-bold font-mono text-white">{telemetry.heading}</span></div>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-15 pointer-events-none"><div className="w-6 h-px bg-white absolute top-1/2 -translate-y-1/2 -left-3"></div><div className="w-px h-6 bg-white absolute left-1/2 -translate-x-1/2 -top-3"></div></div>
      <div className="md:hidden absolute bottom-6 left-4 right-4 flex justify-between pointer-events-none z-10">
        <div className="flex space-x-2 pointer-events-auto">
          <button onPointerDown={ta('steer',1)} onPointerUp={ta('steer',0)} onPointerLeave={ta('steer',0)} className="w-14 h-14 bg-[#050810]/80 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center active:bg-white/20 text-white"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg></button>
          <button onPointerDown={ta('steer',-1)} onPointerUp={ta('steer',0)} onPointerLeave={ta('steer',0)} className="w-14 h-14 bg-[#050810]/80 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center active:bg-white/20 text-white"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg></button>
        </div>
        <button onPointerDown={ta('throttle',1)} onPointerUp={ta('throttle',0)} onPointerLeave={ta('throttle',0)} className="w-14 h-14 bg-sky-500/20 border border-sky-500 rounded-full flex items-center justify-center active:bg-sky-500 text-sky-400 active:text-white shadow-[0_0_20px_rgba(14,165,233,0.3)] pointer-events-auto"><span className="text-[10px] font-bold tracking-widest">FWD</span></button>
      </div>
    </div>
  );
}
