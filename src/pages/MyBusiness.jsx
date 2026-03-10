import React, { useState } from 'react';
import { Building, Eye, EyeOff, Save, MapPin, Globe, Instagram, Linkedin, Mail, Tag, Edit } from 'lucide-react';
import { useApp } from '../context/AppContext';

const LOOKING_OPTIONS = [
    { id: 'capital', label: '💰 Capital' }, { id: 'clientes', label: '👥 Clientes' },
    { id: 'aliados', label: '🤝 Aliados' }, { id: 'proveedores', label: '📦 Proveedores' },
    { id: 'mentoria', label: '🧭 Mentoría' },
];

export default function MyBusiness() {
    const { businessProfile, saveBusinessProfile, profile } = useApp();
    const [editing, setEditing] = useState(!businessProfile);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        name: businessProfile?.name || '',
        description: businessProfile?.description || '',
        category: businessProfile?.category || '',
        stage: businessProfile?.stage || profile?.stage || 'Idea',
        city: businessProfile?.city || profile?.city || '',
        website: businessProfile?.website || '',
        instagram: businessProfile?.instagram || '',
        linkedin: businessProfile?.linkedin || '',
        contact_email: businessProfile?.contact_email || '',
        problem_solved: businessProfile?.problem_solved || '',
        services: businessProfile?.services || '',
        looking_for: businessProfile?.looking_for || [],
        is_public: businessProfile?.is_public !== false,
    });

    const update = (key, val) => setForm(p => ({ ...p, [key]: val }));
    const toggleLooking = (id) => update('looking_for', form.looking_for.includes(id) ? form.looking_for.filter(l => l !== id) : [...form.looking_for, id]);

    const handleSave = async () => {
        if (!form.name.trim()) { alert('El nombre del negocio es requerido.'); return; }
        setSaving(true);
        await saveBusinessProfile(form);
        setSaving(false);
        setEditing(false);
    };

    return (
        <div className="animate-fade-in" style={{ padding: '28px', maxWidth: '960px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ padding: '10px', backgroundColor: '#f0fdf4', borderRadius: '12px' }}>
                        <Building size={22} style={{ color: 'var(--primary)' }} />
                    </div>
                    <div>
                        <h1 style={{ fontSize: '22px', fontWeight: 800 }}>Mi Negocio</h1>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Tu perfil público en la red EmprendeHub.</p>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', borderRadius: '10px', border: '1px solid var(--border)', backgroundColor: 'white', cursor: 'pointer' }}
                        onClick={() => { if (editing) update('is_public', !form.is_public); }}>
                        {form.is_public ? <Eye size={16} style={{ color: 'var(--primary)' }} /> : <EyeOff size={16} style={{ color: 'var(--text-tertiary)' }} />}
                        <span style={{ fontSize: '13px', fontWeight: 600 }}>{form.is_public ? 'Público' : 'Privado'}</span>
                        <div style={{ width: '36px', height: '20px', borderRadius: '10px', backgroundColor: form.is_public ? 'var(--primary)' : '#d1d5db', position: 'relative', transition: '0.2s' }}>
                            <div style={{ position: 'absolute', top: '2px', left: form.is_public ? '18px' : '2px', width: '16px', height: '16px', borderRadius: '50%', backgroundColor: 'white', transition: '0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                        </div>
                    </div>
                    <button className={editing ? 'btn btn-primary' : 'btn btn-secondary'} onClick={editing ? handleSave : () => setEditing(true)} disabled={saving} style={{ gap: '8px' }}>
                        {editing ? <Save size={16} /> : <Edit size={16} />}
                        {saving ? 'Guardando...' : editing ? 'Guardar perfil' : 'Editar'}
                    </button>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px' }}>
                {/* Form */}
                <div className="card" style={{ padding: '28px' }}>
                    {!businessProfile && !editing && (
                        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                            <p style={{ fontSize: '48px', marginBottom: '12px' }}>🏢</p>
                            <h2 style={{ fontWeight: 700, marginBottom: '8px' }}>Crea tu perfil de negocio</h2>
                            <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Hazte visible en la red EmprendeHub y conecta con aliados, clientes e inversionistas.</p>
                            <button className="btn btn-primary" onClick={() => setEditing(true)}>Crear perfil ahora →</button>
                        </div>
                    )}
                    {(editing || businessProfile) && (
                        <div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                {[
                                    { label: 'Nombre del emprendimiento *', key: 'name', placeholder: 'EcoPack Colombia' },
                                    { label: 'Categoría / Sector', key: 'category', placeholder: 'Sostenibilidad, FinTech, etc.' },
                                    { label: 'Ciudad', key: 'city', placeholder: 'Bogotá, Colombia' },
                                    { label: 'Sitio web', key: 'website', placeholder: 'www.minegocio.co' },
                                    { label: 'Instagram', key: 'instagram', placeholder: '@handle' },
                                    { label: 'LinkedIn', key: 'linkedin', placeholder: 'linkedin.com/company/...' },
                                    { label: 'Email de contacto', key: 'contact_email', placeholder: 'hola@negocio.co' },
                                ].map(f => (
                                    <div key={f.key} className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">{f.label}</label>
                                        {editing ? <input className="form-input" value={form[f.key]} placeholder={f.placeholder} onChange={e => update(f.key, e.target.value)} />
                                            : <p style={{ padding: '8px 0', fontWeight: 500, borderBottom: '1px solid var(--border)', minHeight: '36px' }}>{form[f.key] || <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</p>}
                                    </div>
                                ))}
                            </div>
                            {[
                                { label: 'Descripción del negocio', key: 'description', placeholder: 'En EcoPack fabricamos empaques 100% biodegradables para e-commerce...' },
                                { label: '¿Qué problema resuelves?', key: 'problem_solved', placeholder: 'El acceso a packaging ecológico de calidad a precios accesibles.' },
                                { label: 'Productos y servicios que ofreces', key: 'services', placeholder: 'Cajas biodegradables, bolsas kraft, empaques personalizados...' },
                            ].map(f => (
                                <div key={f.key} className="form-group" style={{ marginTop: '16px' }}>
                                    <label className="form-label">{f.label}</label>
                                    {editing ? <textarea className="form-input" rows={3} value={form[f.key]} placeholder={f.placeholder} onChange={e => update(f.key, e.target.value)} style={{ resize: 'vertical' }} />
                                        : <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>{form[f.key] || <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</p>}
                                </div>
                            ))}
                            <div className="form-group">
                                <label className="form-label">¿Qué buscas actualmente?</label>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                                    {LOOKING_OPTIONS.map(opt => {
                                        const sel = form.looking_for.includes(opt.id);
                                        return (
                                            <button key={opt.id} onClick={() => editing && toggleLooking(opt.id)}
                                                style={{ padding: '7px 14px', borderRadius: '99px', fontSize: '12px', fontWeight: 700, border: `2px solid ${sel ? 'var(--primary)' : 'var(--border)'}`, backgroundColor: sel ? 'var(--primary-light)' : 'white', color: sel ? 'var(--primary-dark)' : 'var(--text-secondary)', cursor: editing ? 'pointer' : 'default', transition: 'var(--transition)', fontFamily: 'var(--font-family)' }}>
                                                {opt.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Preview */}
                <div>
                    <div className="card" style={{ padding: '24px', border: form.is_public ? '2px solid var(--primary-light)' : '2px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '16px' }}>
                            {form.is_public ? <Eye size={14} style={{ color: 'var(--primary)' }} /> : <EyeOff size={14} style={{ color: 'var(--text-tertiary)' }} />}
                            <span style={{ fontSize: '11px', fontWeight: 700, color: form.is_public ? 'var(--primary)' : 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                {form.is_public ? 'Visible en la red' : 'Solo para ti'}
                            </span>
                        </div>
                        <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
                            <div style={{ width: '56px', height: '56px', borderRadius: '14px', backgroundColor: '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', margin: '0 auto 12px' }}>🏢</div>
                            <h3 style={{ fontWeight: 800, fontSize: '16px', marginBottom: '2px' }}>{form.name || 'Nombre del negocio'}</h3>
                            <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--primary)', marginBottom: '6px' }}>{form.stage} · {form.category || 'Categoría'}</p>
                            {form.city && <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}><MapPin size={11} /> {form.city}</p>}
                        </div>
                        {form.description && <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '14px', textAlign: 'center' }}>{form.description.slice(0, 120)}{form.description.length > 120 ? '...' : ''}</p>}
                        {form.looking_for.length > 0 && (
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
                                {form.looking_for.map(id => {
                                    const opt = LOOKING_OPTIONS.find(o => o.id === id);
                                    return opt ? <span key={id} style={{ padding: '4px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, backgroundColor: 'var(--primary-light)', color: 'var(--primary-dark)' }}>{opt.label}</span> : null;
                                })}
                            </div>
                        )}
                    </div>

                    <div className="card" style={{ marginTop: '16px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', padding: '16px' }}>
                        <p style={{ fontWeight: 700, color: '#166534', fontSize: '13px', marginBottom: '6px' }}>💡 Tip de visibilidad</p>
                        <p style={{ fontSize: '12px', color: '#166534', lineHeight: 1.6 }}>Un perfil completo y público recibe <strong>3x más contactos</strong> de aliados e inversionistas en la red.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
