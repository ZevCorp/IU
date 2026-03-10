import React, { useState } from 'react';
import { Search, Bookmark, BookmarkCheck, Star, X, Mail, MapPin } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { MOCK_PROVIDERS, CATEGORIES } from '../data/mockData';

export default function Providers() {
    const { savedProviders, toggleSaveProvider } = useApp();
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('Todos');
    const [profileId, setProfileId] = useState(null);

    const filtered = MOCK_PROVIDERS.filter(p => {
        const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase());
        const matchCat = category === 'Todos' || p.category === category;
        return matchSearch && matchCat;
    });

    const providerDetail = MOCK_PROVIDERS.find(p => p.id === profileId);

    return (
        <div className="animate-fade-in" style={{ padding: '28px' }}>
            <div style={{ marginBottom: '24px' }}>
                <h1 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '4px' }}>Empresas & Servicios</h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Directorio de proveedores que apoyan a emprendedores colombianos.</p>
            </div>

            {/* Search + Filters */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
                    <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                    <input className="form-input" placeholder="Buscar por nombre o servicio..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '35px' }} />
                </div>
            </div>

            {/* Category pills */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
                {CATEGORIES.map(cat => (
                    <button key={cat} onClick={() => setCategory(cat)}
                        style={{ padding: '7px 16px', borderRadius: '99px', fontSize: '13px', fontWeight: 600, border: `2px solid ${category === cat ? 'var(--primary)' : 'var(--border)'}`, backgroundColor: category === cat ? 'var(--primary)' : 'white', color: category === cat ? 'white' : 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)', transition: 'var(--transition)' }}>
                        {cat}
                    </button>
                ))}
            </div>

            {filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-tertiary)' }}>
                    <p style={{ fontSize: '40px', marginBottom: '12px' }}>🔍</p>
                    <p style={{ fontWeight: 600 }}>Sin resultados para "{search}"</p>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                    {filtered.map(prov => {
                        const isSaved = savedProviders.includes(prov.id);
                        return (
                            <div key={prov.id} className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', transition: 'var(--transition)' }}
                                onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                                onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                        <div style={{ width: '44px', height: '44px', borderRadius: '12px', backgroundColor: prov.badgeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '15px', color: prov.badgeText, flexShrink: 0 }}>
                                            {prov.initials}
                                        </div>
                                        <div>
                                            <h3 style={{ fontWeight: 700, fontSize: '14px', marginBottom: '2px' }}>{prov.name}</h3>
                                            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '99px', backgroundColor: prov.badgeColor, color: prov.badgeText }}>{prov.category}</span>
                                        </div>
                                    </div>
                                    <button onClick={() => toggleSaveProvider(prov.id)}
                                        style={{ padding: '6px', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: isSaved ? '#f0fdf4' : 'white', cursor: 'pointer', color: isSaved ? 'var(--primary)' : 'var(--text-secondary)', transition: 'var(--transition)' }}>
                                        {isSaved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
                                    </button>
                                </div>

                                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{prov.description}</p>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                    <MapPin size={12} /> {prov.city}
                                    <span style={{ margin: '0 6px' }}>·</span>
                                    <Star size={12} style={{ color: '#f59e0b', fill: '#f59e0b' }} /> {prov.rating}
                                </div>

                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                    {prov.services.slice(0, 3).map(s => (
                                        <span key={s} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px', backgroundColor: 'var(--bg-main)', color: 'var(--text-secondary)', fontWeight: 500 }}>{s}</span>
                                    ))}
                                </div>

                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button className="btn btn-secondary" onClick={() => setProfileId(prov.id)} style={{ flex: 1, fontSize: '12px', padding: '8px' }}>Ver perfil</button>
                                    <a href={`mailto:${prov.email}`} className="btn btn-primary" style={{ flex: 1, fontSize: '12px', padding: '8px', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                        <Mail size={13} /> Contactar
                                    </a>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Profile Modal */}
            {providerDetail && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={() => setProfileId(null)}>
                    <div className="card" style={{ maxWidth: '520px', width: '100%', padding: '32px', maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                            <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                                <div style={{ width: '52px', height: '52px', borderRadius: '14px', backgroundColor: providerDetail.badgeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '18px', color: providerDetail.badgeText }}>{providerDetail.initials}</div>
                                <div>
                                    <h2 style={{ fontWeight: 800, fontSize: '18px' }}>{providerDetail.name}</h2>
                                    <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{providerDetail.category} · <Star size={12} style={{ color: '#f59e0b', fill: '#f59e0b' }} /> {providerDetail.rating}</p>
                                </div>
                            </div>
                            <button onClick={() => setProfileId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={20} /></button>
                        </div>
                        <p style={{ lineHeight: 1.7, color: 'var(--text-secondary)', marginBottom: '20px' }}>{providerDetail.description}</p>
                        <div style={{ marginBottom: '20px' }}>
                            <p style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px' }}>Servicios</p>
                            {providerDetail.services.map(s => <p key={s} style={{ fontSize: '13px', padding: '6px 0', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>• {s}</p>)}
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button className="btn btn-secondary" onClick={() => toggleSaveProvider(providerDetail.id)} style={{ flex: 1 }}>
                                {savedProviders.includes(providerDetail.id) ? '🔖 Guardado' : '🔖 Guardar'}
                            </button>
                            <a href={`mailto:${providerDetail.email}`} className="btn btn-primary" style={{ flex: 1, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                <Mail size={14} /> Contactar
                            </a>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
