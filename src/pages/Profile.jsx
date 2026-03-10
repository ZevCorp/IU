import React, { useState } from 'react';
import { User, Bell, Lock, Bookmark, ChevronRight, Save, Edit } from 'lucide-react';
import { useApp } from '../context/AppContext';

export default function Profile() {
    const { profile, updateProfile, savedOpportunities, savedProviders } = useApp();
    const [activeSection, setActiveSection] = useState('info');
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState({
        full_name: profile?.full_name || '',
        city: profile?.city || '',
        phone: profile?.phone || '',
        sector: profile?.sector || '',
    });
    const [saving, setSaving] = useState(false);
    const [notifications, setNotifications] = useState({ oportunidades: true, cursos: true, tareas: false, reporte: true });
    const [pwForm, setPwForm] = useState({ current: '', nueva: '', confirmar: '' });

    const handleSave = async () => {
        setSaving(true);
        await updateProfile(form);
        setSaving(false);
        setEditing(false);
    };

    const displayName = profile?.full_name || 'Mi cuenta';
    const initial = displayName.charAt(0).toUpperCase();

    const sections = [
        { id: 'info', label: 'Información personal', icon: <User size={16} /> },
        { id: 'notifications', label: 'Notificaciones', icon: <Bell size={16} /> },
        { id: 'password', label: 'Contraseña', icon: <Lock size={16} /> },
        { id: 'saved', label: 'Guardados', icon: <Bookmark size={16} /> },
    ];

    return (
        <div className="animate-fade-in" style={{ padding: '28px', maxWidth: '900px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '28px' }}>
                <div style={{ width: '52px', height: '52px', borderRadius: '14px', backgroundColor: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', fontWeight: 800, color: 'white' }}>{initial}</div>
                <div>
                    <h1 style={{ fontSize: '22px', fontWeight: 800 }}>Mi Perfil</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{profile?.stage || 'Etapa: Idea'} · {profile?.sector || 'Sector no definido'}</p>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '20px' }}>
                {/* Sidebar nav */}
                <div className="card" style={{ padding: '12px', alignSelf: 'start' }}>
                    {sections.map(s => (
                        <button key={s.id} onClick={() => setActiveSection(s.id)}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '8px', fontWeight: 500, fontSize: '13px', backgroundColor: activeSection === s.id ? 'var(--primary-light)' : 'transparent', color: activeSection === s.id ? 'var(--primary-dark)' : 'var(--text-secondary)', border: 'none', cursor: 'pointer', marginBottom: '2px', fontFamily: 'var(--font-family)', transition: 'var(--transition)' }}>
                            {s.icon} {s.label}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="card" style={{ padding: '28px' }}>
                    {activeSection === 'info' && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                                <h2 style={{ fontWeight: 700, fontSize: '17px' }}>Información Personal</h2>
                                <button className="btn btn-secondary" onClick={() => editing ? handleSave() : setEditing(true)} disabled={saving} style={{ gap: '8px' }}>
                                    {editing ? <Save size={15} /> : <Edit size={15} />}
                                    {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Editar'}
                                </button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                {[
                                    { label: 'Nombre completo', key: 'full_name', placeholder: 'Tu nombre' },
                                    { label: 'Ciudad', key: 'city', placeholder: 'Bogotá, Colombia' },
                                    { label: 'Teléfono', key: 'phone', placeholder: '+57 300 000 0000' },
                                    { label: 'Sector / Industria', key: 'sector', placeholder: 'Tecnología, Salud, etc.' },
                                ].map(f => (
                                    <div key={f.key} className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">{f.label}</label>
                                        {editing ? (
                                            <input className="form-input" value={form[f.key]} placeholder={f.placeholder}
                                                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />
                                        ) : (
                                            <p style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', fontWeight: 500, color: form[f.key] ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                                                {form[f.key] || f.placeholder}
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div style={{ marginTop: '20px', padding: '16px', backgroundColor: 'var(--bg-main)', borderRadius: '10px' }}>
                                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                    <strong>Correo:</strong> {profile?.user_id ? 'Cuenta registrada' : '—'} &nbsp;·&nbsp;
                                    <strong>Etapa:</strong> {profile?.stage || 'Idea'} &nbsp;·&nbsp;
                                    <strong>Puntos:</strong> {profile?.points || 0}
                                </p>
                            </div>
                        </div>
                    )}

                    {activeSection === 'notifications' && (
                        <div>
                            <h2 style={{ fontWeight: 700, fontSize: '17px', marginBottom: '24px' }}>Preferencias de notificación</h2>
                            {[
                                { key: 'oportunidades', label: 'Nuevas oportunidades compatibles', desc: 'Te avisamos cuando haya convocatorias para tu etapa.' },
                                { key: 'cursos', label: 'Actualizaciones de cursos', desc: 'Nuevas lecciones y contenido disponible.' },
                                { key: 'tareas', label: 'Recordatorios de tareas', desc: 'Alertas para tareas pendientes importantes.' },
                                { key: 'reporte', label: 'Reporte semanal de progreso', desc: 'Resumen de avance cada lunes.' },
                            ].map((n, idx, arr) => (
                                <div key={n.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 0', borderBottom: idx < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                    <div>
                                        <p style={{ fontWeight: 600, fontSize: '14px' }}>{n.label}</p>
                                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{n.desc}</p>
                                    </div>
                                    <div onClick={() => setNotifications(p => ({ ...p, [n.key]: !p[n.key] }))}
                                        style={{ width: '44px', height: '24px', borderRadius: '12px', backgroundColor: notifications[n.key] ? 'var(--primary)' : '#d1d5db', cursor: 'pointer', position: 'relative', transition: '0.2s', flexShrink: 0, marginLeft: '20px' }}>
                                        <div style={{ position: 'absolute', top: '3px', left: notifications[n.key] ? '23px' : '3px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: 'white', transition: '0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeSection === 'password' && (
                        <div>
                            <h2 style={{ fontWeight: 700, fontSize: '17px', marginBottom: '24px' }}>Cambiar contraseña</h2>
                            <div style={{ maxWidth: '380px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                {[['Contraseña actual', 'current'], ['Nueva contraseña', 'nueva'], ['Confirmar nueva contraseña', 'confirmar']].map(([label, key]) => (
                                    <div key={key} className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">{label}</label>
                                        <input type="password" className="form-input" placeholder="••••••••" value={pwForm[key]} onChange={e => setPwForm(p => ({ ...p, [key]: e.target.value }))} />
                                    </div>
                                ))}
                                <button className="btn btn-primary" style={{ alignSelf: 'flex-start', marginTop: '8px' }}>Actualizar contraseña</button>
                            </div>
                        </div>
                    )}

                    {activeSection === 'saved' && (
                        <div>
                            <h2 style={{ fontWeight: 700, fontSize: '17px', marginBottom: '24px' }}>Elementos guardados</h2>
                            {savedOpportunities.length === 0 && savedProviders.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>
                                    <p style={{ fontSize: '36px', marginBottom: '12px' }}>🔖</p>
                                    <p style={{ fontWeight: 600 }}>Sin guardados aún</p>
                                    <p style={{ fontSize: '13px', marginTop: '8px' }}>Guarda oportunidades y proveedores para verlos aquí.</p>
                                </div>
                            ) : (
                                <div>
                                    {savedOpportunities.length > 0 && (
                                        <div>
                                            <p style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>Oportunidades ({savedOpportunities.length})</p>
                                            {savedOpportunities.map(id => (
                                                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                                                    <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🔖</div>
                                                    <p style={{ fontSize: '14px', fontWeight: 600, flex: 1 }}>Oportunidad {id}</p>
                                                    <ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
