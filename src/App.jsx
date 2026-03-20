import React, { Suspense, lazy, useState, Component } from 'react';

// Lazy load — Three.js and Supabase only loaded when needed
const Landing = lazy(() => import('./routes/Landing.jsx'));
const Simulation = lazy(() => import('./routes/Simulation.jsx'));

// Error boundary
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return (
      <div className="w-full h-screen bg-[#05080f] flex items-center justify-center">
        <div className="max-w-md text-center p-8">
          <div className="w-12 h-12 bg-red-500/20 border border-red-500/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          </div>
          <h2 className="text-white text-lg font-bold mb-2">Engine Error</h2>
          <p className="text-slate-400 text-sm mb-4">{this.state.error.message}</p>
          <button onClick={() => { this.setState({ error: null }); window.location.reload(); }} className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold uppercase tracking-widest px-6 py-2 rounded-full border border-white/20 transition-all">Restart</button>
        </div>
      </div>
    );
    return this.props.children;
  }
}

// Loading screen
function Loader() {
  return (
    <div className="w-full h-screen bg-[#05080f] flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-500 text-xs font-mono tracking-widest uppercase">Loading Engine</p>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState('landing');
  const [supabase, setSupabase] = useState(null);
  const [profile, setProfile] = useState(null);

  const handlePlay = () => setView('sim');
  const handleAuth = (client, prof) => { setSupabase(client); setProfile(prof); setView('sim'); };
  const handleLeave = () => setView('landing');

  return (
    <ErrorBoundary>
      <div className="w-full h-screen bg-[#05080f] text-slate-100 font-sans overflow-hidden select-none">
        <Suspense fallback={<Loader />}>
          {view === 'landing' && <Landing onPlay={handlePlay} onAuth={handleAuth} />}
          {view === 'sim' && <Simulation supabase={supabase} profile={profile} session={{ lakeId: 'lake_lanier' }} onLeave={handleLeave} />}
        </Suspense>
      </div>
    </ErrorBoundary>
  );
}
