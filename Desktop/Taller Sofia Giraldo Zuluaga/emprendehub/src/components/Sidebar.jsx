import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
    LayoutDashboard, ClipboardList, Map, CheckSquare, Search,
    BookOpen, FolderOpen, BarChart2, Briefcase, Building, User, X, Zap
} from 'lucide-react';
import { useApp } from '../context/AppContext';

const NAV = [
    { to: '/dashboard', icon: <LayoutDashboard size={18} />, label: 'Panel de Inicio' },
    { to: '/diagnostico', icon: <ClipboardList size={18} />, label: 'Diagnóstico' },
    { to: '/ruta', icon: <Map size={18} />, label: 'Mi Ruta' },
    { to: '/primeros-pasos', icon: <CheckSquare size={18} />, label: 'Primeros Pasos' },
    { to: '/oportunidades', icon: <Search size={18} />, label: 'Oportunidades' },
    { to: '/cursos', icon: <BookOpen size={18} />, label: 'Cursos' },
    { to: '/documentos', icon: <FolderOpen size={18} />, label: 'Documentos' },
    { to: '/seguimiento', icon: <BarChart2 size={18} />, label: 'Seguimiento' },
    { to: '/empresas-servicios', icon: <Briefcase size={18} />, label: 'Empresas / Servicios' },
];

const BOTTOM_NAV = [
    { to: '/mi-negocio', icon: <Building size={18} />, label: 'Mi Negocio' },
    { to: '/mi-perfil', icon: <User size={18} />, label: 'Mi Perfil' },
];

export default function Sidebar({ isOpen, onClose }) {
    const { profile, progressPercent, points, level } = useApp();
    const navigate = useNavigate();

    const displayName = profile?.full_name || 'Mi cuenta';
    const stage = profile?.stage || 'Idea';
    const initial = displayName.charAt(0).toUpperCase();

    return (
        <>
            {/* Mobile overlay */}
            {isOpen && (
                <div onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 39, display: 'none' }}
                    className="sidebar-overlay" />
            )}
            <aside className={`sidebar ${isOpen ? 'sidebar-open' : ''}`}>
                {/* Header */}
                <div className="sidebar-header">
                    <div onClick={() => navigate('/dashboard')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '32px', height: '32px', backgroundColor: 'var(--primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Zap size={18} fill="white" color="white" />
                        </div>
                        <span style={{ fontWeight: 800, fontSize: '17px', color: 'white', letterSpacing: '-0.5px' }}>EmprendeHub</span>
                    </div>
                    <button className="btn-ghost" onClick={onClose} style={{ color: 'rgba(255,255,255,0.4)', padding: '4px' }}>
                        <X size={18} />
                    </button>
                </div>

                {/* Progress strip */}
                <div style={{ padding: '12px 16px', backgroundColor: 'rgba(16,185,129,0.08)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Progreso general</span>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--primary)' }}>{progressPercent}%</span>
                    </div>
                    <div style={{ height: '4px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '4px' }}>
                        <div style={{ height: '100%', width: `${progressPercent}%`, backgroundColor: 'var(--primary)', borderRadius: '4px', transition: '0.5s ease' }} />
                    </div>
                </div>

                {/* Nav */}
                <nav style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
                    {NAV.map(item => (
                        <NavLink key={item.to} to={item.to} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                            {item.icon} <span>{item.label}</span>
                        </NavLink>
                    ))}
                    <div style={{ height: '1px', backgroundColor: 'rgba(255,255,255,0.06)', margin: '8px 16px' }} />
                    {BOTTOM_NAV.map(item => (
                        <NavLink key={item.to} to={item.to} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                            {item.icon} <span>{item.label}</span>
                        </NavLink>
                    ))}
                </nav>

                {/* User card */}
                <div className="sidebar-footer" style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '38px', height: '38px', borderRadius: '50%', backgroundColor: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '15px', color: 'white', flexShrink: 0 }}>
                            {initial}
                        </div>
                        <div style={{ overflow: 'hidden', flex: 1 }}>
                            <p style={{ fontWeight: 700, color: 'white', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</p>
                            <p style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: 600 }}>{stage} · {level}</p>
                        </div>
                        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 700 }}>{points}pts</div>
                    </div>
                </div>
            </aside>
        </>
    );
}
