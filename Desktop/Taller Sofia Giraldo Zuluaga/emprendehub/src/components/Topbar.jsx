import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Search, Bell, LogOut, User, Settings, ChevronDown } from 'lucide-react';
import { useApp } from '../context/AppContext';

export default function Topbar({ toggleSidebar, onLogout }) {
    const { profile, points, level } = useApp();
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef(null);
    const navigate = useNavigate();

    const displayName = profile?.full_name || 'Mi cuenta';
    const initial = displayName.charAt(0).toUpperCase();

    useEffect(() => {
        const handler = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    return (
        <header className="topbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button className="btn-ghost" onClick={toggleSidebar} style={{ color: 'var(--text-secondary)' }}>
                    <Menu size={22} />
                </button>
                <div style={{ position: 'relative' }}>
                    <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                    <input type="text" placeholder="Buscar cursos, oportunidades..."
                        className="form-input"
                        style={{ paddingLeft: '36px', width: '280px', fontSize: '13px', backgroundColor: 'var(--bg-main)' }} />
                </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button className="btn-ghost" style={{ position: 'relative', color: 'var(--text-secondary)' }}>
                    <Bell size={20} />
                    <span style={{ position: 'absolute', top: '4px', right: '4px', width: '7px', height: '7px', backgroundColor: '#ef4444', borderRadius: '50%', border: '2px solid white' }} />
                </button>

                <div ref={menuRef} style={{ position: 'relative' }}>
                    <button onClick={() => setShowMenu(!showMenu)}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '10px', border: '1px solid var(--border)', backgroundColor: 'white', cursor: 'pointer' }}>
                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '12px', color: 'white' }}>
                            {initial}
                        </div>
                        <div style={{ textAlign: 'left' }}>
                            <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{displayName}</p>
                            <p style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: 600 }}>{points} pts · {level}</p>
                        </div>
                        <ChevronDown size={14} style={{ color: 'var(--text-tertiary)', marginLeft: '2px' }} />
                    </button>

                    {showMenu && (
                        <div style={{ position: 'absolute', right: 0, top: '48px', backgroundColor: 'white', borderRadius: '12px', border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: '200px', zIndex: 100, overflow: 'hidden' }}>
                            <div style={{ padding: '12px 16px', backgroundColor: 'var(--bg-main)', borderBottom: '1px solid var(--border)' }}>
                                <p style={{ fontWeight: 700, fontSize: '14px' }}>{displayName}</p>
                                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{profile?.stage || 'Etapa: Idea'}</p>
                            </div>
                            {[
                                { icon: <User size={15} />, label: 'Mi Perfil', action: () => { navigate('/mi-perfil'); setShowMenu(false); } },
                                { icon: <Settings size={15} />, label: 'Mi Negocio', action: () => { navigate('/mi-negocio'); setShowMenu(false); } },
                            ].map(item => (
                                <button key={item.label} onClick={item.action}
                                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 16px', fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', transition: 'background 0.15s', fontFamily: 'var(--font-family)', textAlign: 'left' }}
                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-main)'}
                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                    {item.icon} {item.label}
                                </button>
                            ))}
                            <div style={{ height: '1px', backgroundColor: 'var(--border)' }} />
                            <button onClick={() => { setShowMenu(false); onLogout?.(); }}
                                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 16px', fontSize: '14px', fontWeight: 600, color: '#dc2626', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-family)' }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = '#fef2f2'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                <LogOut size={15} /> Cerrar sesión
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}
