import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { AppProvider, useApp } from './context/AppContext';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Dashboard from './pages/Dashboard';
import Diagnostic from './pages/Diagnostic';
import Roadmap from './pages/Roadmap';
import FirstSteps from './pages/FirstSteps';
import Opportunities from './pages/Opportunities';
import Courses from './pages/Courses';
import Documents from './pages/Documents';
import Tracker from './pages/Tracker';
import Providers from './pages/Providers';
import MyBusiness from './pages/MyBusiness';
import Profile from './pages/Profile';
import Auth from './pages/Auth';
import Onboarding from './pages/Onboarding';

// Toast component
function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return (
    <div style={{
      position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999,
      backgroundColor: toast.type === 'error' ? '#dc2626' : '#10b981',
      color: 'white', padding: '12px 20px', borderRadius: '10px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.15)', fontWeight: 600, fontSize: '14px',
      display: 'flex', alignItems: 'center', gap: '8px',
      animation: 'slideUp 0.3s ease',
    }}>
      <span>{toast.type === 'error' ? '⚠️' : '✅'}</span> {toast.message}
    </div>
  );
}

function AppLayout({ onLogout, initialPath }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setSidebarOpen(false), [location.pathname]);

  return (
    <div className="app-layout">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="main-content">
        <Topbar toggleSidebar={() => setSidebarOpen(!sidebarOpen)} onLogout={onLogout} />
        <div className="content-area" id="main-scroll">
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/diagnostico" element={<Diagnostic />} />
            <Route path="/ruta" element={<Roadmap />} />
            <Route path="/primeros-pasos" element={<FirstSteps />} />
            <Route path="/oportunidades" element={<Opportunities />} />
            <Route path="/cursos" element={<Courses />} />
            <Route path="/documentos" element={<Documents />} />
            <Route path="/seguimiento" element={<Tracker />} />
            <Route path="/empresas-servicios" element={<Providers />} />
            <Route path="/mi-negocio" element={<MyBusiness />} />
            <Route path="/mi-perfil" element={<Profile />} />
            <Route path="/" element={<Navigate to={initialPath} replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </div>
      </div>
      <Toast />
      <style>{`@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [initialPath, setInitialPath] = useState('/dashboard');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        const done = localStorage.getItem(`onboarding_done_${session.user.id}`);
        setOnboardingDone(!!done);
      }
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) { setOnboardingDone(false); setInitialPath('/dashboard'); }
      else {
        const done = localStorage.getItem(`onboarding_done_${s.user.id}`);
        setOnboardingDone(!!done);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => { await supabase.auth.signOut(); };
  const handleOnboardingComplete = (path = '/dashboard') => {
    if (session) localStorage.setItem(`onboarding_done_${session.user.id}`, 'true');
    setInitialPath(path);
    setOnboardingDone(true);
  };

  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a', flexDirection: 'column', gap: '16px' }}>
      <div style={{ fontSize: '24px', fontWeight: 800, color: '#10b981' }}>EmprendeHub</div>
      <div style={{ width: '36px', height: '36px', border: '3px solid rgba(16,185,129,0.2)', borderTop: '3px solid #10b981', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (!session) return <Auth onLogin={setSession} />;
  if (!onboardingDone) return <Onboarding session={session} onComplete={handleOnboardingComplete} onSkip={() => handleOnboardingComplete('/dashboard')} />;

  return (
    <Router>
      <AppProvider session={session}>
        <AppLayout onLogout={handleLogout} initialPath={initialPath} />
      </AppProvider>
    </Router>
  );
}
