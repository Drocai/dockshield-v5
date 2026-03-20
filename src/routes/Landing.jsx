import React, { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const DS_URL = import.meta.env.VITE_SUPABASE_URL || '';
const DS_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export default function Landing({ onPlay, onAuth }) {
  const [cfg, setCfg] = useState({ url: DS_URL, key: DS_KEY, email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const auth = async (isSignUp) => {
    if (!cfg.email || !cfg.password) return setErr('Email and password required');
    setLoading(true); setErr('');
    try {
      const url = cfg.url || DS_URL;
      const key = cfg.key || DS_KEY;
      if (!url || !key) throw new Error('Supabase credentials required');
      const client = createClient(url, key);
      let res;
      if (isSignUp) {
        res = await client.auth.signUp({ email: cfg.email, password: cfg.password });
        if (res.data.user) {
          await client.from('profiles').insert({ id: res.data.user.id, display_name: `Captain_${res.data.user.id.substring(0, 4)}` }).select();
        }
      } else {
        res = await client.auth.signInWithPassword({ email: cfg.email, password: cfg.password });
      }
      if (res.error) throw res.error;
      const { data: profile } = await client.from('profiles').select('*').eq('id', res.data.user.id).single();
      onAuth(client, { ...res.data.user, ...profile });
    } catch (e) {
      setErr(e.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-4 md:p-6 bg-gradient-to-br from-[#020810] via-[#05101f] to-[#0a0f1a]">
      <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(ellipse at 30% 80%, rgba(14,165,233,0.08), transparent 60%), radial-gradient(ellipse at 70% 20%, rgba(16,185,129,0.06), transparent 60%)' }} />
      <div className="relative z-10 max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center">
        <div>
          <div className="w-12 h-12 bg-gradient-to-br from-sky-500 to-cyan-400 rounded-lg flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(14,165,233,0.3)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
          </div>
          <h1 className="text-4xl md:text-5xl font-light tracking-tighter mb-2 text-white">Dock<span className="font-bold text-sky-400">Shield</span></h1>
          <p className="text-xs font-mono tracking-[0.3em] text-slate-500 uppercase mb-4">PierPressure Engine v5.1</p>
          <p className="text-slate-400 text-base md:text-lg leading-relaxed mb-6">
            Real-time marina simulation with multiplayer, spatial audio, persistent pilot data, and live weather physics.
          </p>
          <button onClick={onPlay} className="border border-white/20 hover:bg-white/5 text-slate-300 font-bold tracking-widest uppercase text-xs px-8 py-3 rounded-full transition-all">
            Launch Solo Mode
          </button>
          <div className="flex items-center gap-2 mt-6">
            <svg className="w-3 h-3 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>
            <span className="text-[10px] tracking-widest uppercase text-slate-600">USACE-Compliant · Zero Discharge · Lake Lanier</span>
          </div>
        </div>

        <div className="bg-white/[0.03] border border-white/10 p-6 md:p-8 rounded-2xl backdrop-blur-2xl">
          <h3 className="text-sm font-bold tracking-widest uppercase text-white mb-5 flex items-center">
            <div className="w-2 h-2 bg-emerald-500 rounded-full mr-3 animate-pulse" /> Secure Edge Uplink
          </h3>
          {err && <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4 text-xs text-red-400">{err}</div>}
          <div className="space-y-3">
            {!DS_URL && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[9px] text-slate-500 uppercase tracking-widest">Supabase URL</label>
                  <input type="text" value={cfg.url} onChange={e => setCfg({ ...cfg, url: e.target.value })} className="w-full mt-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-xs focus:border-sky-500 outline-none text-white font-mono" placeholder="https://..." /></div>
                <div><label className="text-[9px] text-slate-500 uppercase tracking-widest">Anon Key</label>
                  <input type="password" value={cfg.key} onChange={e => setCfg({ ...cfg, key: e.target.value })} className="w-full mt-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-xs focus:border-sky-500 outline-none text-white font-mono" placeholder="eyJh..." /></div>
              </div>
            )}
            <div><label className="text-[9px] text-slate-500 uppercase tracking-widest">Pilot Email</label>
              <input type="email" value={cfg.email} onChange={e => setCfg({ ...cfg, email: e.target.value })} className="w-full mt-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-sm focus:border-sky-500 outline-none text-white" /></div>
            <div><label className="text-[9px] text-slate-500 uppercase tracking-widest">Passcode</label>
              <input type="password" value={cfg.password} onChange={e => setCfg({ ...cfg, password: e.target.value })} className="w-full mt-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-sm focus:border-sky-500 outline-none text-white" /></div>
            <div className="flex gap-3 pt-3">
              <button onClick={() => auth(false)} disabled={loading} className="flex-1 bg-white text-[#05080f] font-bold tracking-widest uppercase text-[10px] py-3 rounded hover:bg-slate-200 transition-all disabled:opacity-50">{loading ? '...' : 'Login'}</button>
              <button onClick={() => auth(true)} disabled={loading} className="flex-1 border border-white/20 text-white font-bold tracking-widest uppercase text-[10px] py-3 rounded hover:bg-white/10 transition-all disabled:opacity-50">Register</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
