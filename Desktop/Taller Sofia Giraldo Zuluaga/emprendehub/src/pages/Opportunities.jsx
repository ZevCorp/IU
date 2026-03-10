import React, { useState } from 'react';
import { Search, Bookmark, BookmarkCheck, ExternalLink, Filter, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { MOCK_OPPORTUNITIES, STAGES } from '../data/mockData';

const TYPE_COLORS = {
    Financiación: { bg: '#d1fae5', text: '#065f46' }, Aceleración: { bg: '#ede9fe', text: '#5b21b6' },
    Crédito: { bg: '#dbeafe', text: '#1d4ed8' }, Beca: { bg: '#fce7f3', text: '#9d174d' },
    'Red / Mentoría': { bg: '#fef9c3', text: '#854d0e' },
};

export default function Opportunities() {
    const { savedOpportunities, toggleSaveOpportunity, profile } = useApp();
    const [search, setSearch] = useState('');
    const [stageFilter, setStageFilter] = useState('Todos');
    const [typeFilter, setTypeFilter] = useState('Todos');
    const [tab, setTab] = useState('todas'); // 'todas' | 'guardadas'
    const [detailId, setDetailId] = useState(null);

    const userStage = profile?.stage;

    const filtered = MOCK_OPPORTUNITIES.filter(opp => {
        const matchSearch = !search || opp.title.toLowerCase().includes(search.toLowerCase()) || opp.organization.toLowerCase().includes(search.toLowerCase());
        const matchStage = stageFilter === 'Todos' || (opp.stages && opp.stages.includes(stageFilter));
        const matchType = typeFilter === 'Todos' || opp.type === typeFilter;
        const matchTab = tab === 'todas' || savedOpportunities.includes(opp.id);
        return matchSearch && matchStage && matchType && matchTab;
    });

    const detail = MOCK_OPPORTUNITIES.find(o => o.id === detailId);

    return (
        <div className="animate-fade-in" style={{ padding: '28px' }}>
            <div style={{ marginBottom: '24px' }}>
                <h1 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '4px' }}>Oportunidades</h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Convocatorias y programas del ecosistema emprendedor colombiano.</p>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--bg-main)', padding: '4px', borderRadius: '10px', marginBottom: '20px', alignSelf: 'flex-start', width: 'fit-content' }}>
                {[['todas', 'Todas'], ['guardadas', `Guardadas (${savedOpportunities.length})`]].map(([val, label]) => (
                    <button key={val} onClick={() => setTab(val)}
                        style={{ padding: '8px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, border: 'none', cursor: 'pointer', backgroundColor: tab === val ? 'white' : 'transparent', color: tab === val ? 'var(--primary)' : 'var(--text-secondary)', boxShadow: tab === val ? '0 1px 4px rgba(0,0,0,0.1)' : 'none', fontFamily: 'var(--font-family)', transition: 'var(--transition)' }}>
                        {label}
                    </button>
                ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
                    <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                    <input className="form-input" placeholder="Buscar por nombre u organización..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '35px' }} />
                </div>
                <select className="form-input" value={stageFilter} onChange={e => setStageFilter(e.target.value)} style={{ width: 'auto', minWidth: '140px' }}>
                    <option value="Todos">Todas las etapas</option>
                    {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="form-input" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ width: 'auto', minWidth: '140px' }}>
                    <option value="Todos">Todos los tipos</option>
                    {['Financiación', 'Aceleración', 'Crédito', 'Beca', 'Red / Mentoría'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {(search || stageFilter !== 'Todos' || typeFilter !== 'Todos') && (
                    <button className="btn btn-secondary" style={{ gap: '6px', fontSize: '13px' }} onClick={() => { setSearch(''); setStageFilter('Todos'); setTypeFilter('Todos'); }}>
                        <X size={14} /> Limpiar
                    </button>
                )}
            </div>

            {/* Stage match banner */}
            {userStage && (
                <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '10px 16px', marginBottom: '16px', fontSize: '13px', color: '#1e40af', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Filter size={14} />
                    <span>Mostrando oportunidades compatibles con tu etapa: <strong>{userStage}</strong>. Usa los filtros para explorar más.</span>
                </div>
            )}

            {/* Grid */}
            {filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-tertiary)' }}>
                    <p style={{ fontSize: '40px', marginBottom: '12px' }}>🔍</p>
                    <p style={{ fontWeight: 600 }}>Sin resultados</p>
                    <p style={{ fontSize: '13px', marginTop: '8px' }}>Intenta con otros filtros o busca por nombre.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {filtered.map(opp => {
                        const isSaved = savedOpportunities.includes(opp.id);
                        const typeColor = TYPE_COLORS[opp.type] || { bg: '#f1f5f9', text: '#475569' };
                        const isCompatible = opp.stages && userStage && opp.stages.includes(userStage);
                        return (
                            <div key={opp.id} className="card" style={{ padding: '20px 24px', border: isCompatible ? '1px solid #bbf7d0' : '1px solid var(--border)', position: 'relative' }}>
                                {isCompatible && <div style={{ position: 'absolute', top: '12px', right: '60px', fontSize: '11px', fontWeight: 700, color: '#065f46', backgroundColor: '#d1fae5', padding: '3px 8px', borderRadius: '99px' }}>✓ Compatible contigo</div>}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                                            <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, backgroundColor: opp.status === 'Abierta' ? '#d1fae5' : opp.status === 'Próximamente' ? '#fef9c3' : '#f1f5f9', color: opp.status === 'Abierta' ? '#065f46' : opp.status === 'Próximamente' ? '#92400e' : '#64748b' }}>
                                                {opp.status}
                                            </span>
                                            <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, backgroundColor: typeColor.bg, color: typeColor.text }}>{opp.type}</span>
                                            {opp.tags?.slice(0, 2).map(tag => <span key={tag} style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: 600, backgroundColor: 'var(--bg-main)', color: 'var(--text-secondary)' }}>{tag}</span>)}
                                        </div>
                                        <h3 style={{ fontWeight: 700, fontSize: '16px', marginBottom: '4px' }}>{opp.title}</h3>
                                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '10px', lineHeight: 1.5 }}>{opp.description}</p>
                                        <div style={{ display: 'flex', gap: '20px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                            <span>💰 <strong>{opp.amount}</strong></span>
                                            <span>📅 Cierre: <strong>{opp.deadline}</strong></span>
                                            <span>🏢 <strong>{opp.organization}</strong></span>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0, alignItems: 'flex-end' }}>
                                        <button onClick={() => toggleSaveOpportunity(opp.id)}
                                            style={{ padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: isSaved ? '#f0fdf4' : 'white', cursor: 'pointer', color: isSaved ? 'var(--primary)' : 'var(--text-secondary)', transition: 'var(--transition)' }}
                                            title={isSaved ? 'Quitar de guardados' : 'Guardar oportunidad'}>
                                            {isSaved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
                                        </button>
                                        <button className="btn btn-primary" onClick={() => setDetailId(opp.id)} style={{ fontSize: '12px', padding: '8px 14px', whiteSpace: 'nowrap' }}>
                                            Más info
                                        </button>
                                        {opp.status === 'Abierta' && (
                                            <a href={opp.link || '#'} target="_blank" rel="noopener noreferrer"
                                                style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>
                                                Aplicar <ExternalLink size={12} />
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Detail Modal */}
            {detail && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={() => setDetailId(null)}>
                    <div className="card" style={{ maxWidth: '560px', width: '100%', padding: '32px', maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                            <h2 style={{ fontWeight: 800, fontSize: '18px' }}>{detail.title}</h2>
                            <button onClick={() => setDetailId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={20} /></button>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.7 }}>{detail.description}</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                            {[['Organización', detail.organization], ['Tipo', detail.type], ['Monto', detail.amount], ['Cierre', detail.deadline], ['Estado', detail.status], ['Etapas', detail.stages?.join(', ')]].map(([k, v]) => (
                                <div key={k} style={{ padding: '10px 14px', backgroundColor: 'var(--bg-main)', borderRadius: '8px' }}>
                                    <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>{k}</p>
                                    <p style={{ fontWeight: 700, fontSize: '13px' }}>{v}</p>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button className="btn btn-secondary" onClick={() => { toggleSaveOpportunity(detail.id); setDetailId(null); }}>
                                {savedOpportunities.includes(detail.id) ? '🔖 Quitar de guardados' : '🔖 Guardar'}
                            </button>
                            {detail.status === 'Abierta' && (
                                <a href={detail.link || '#'} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    Aplicar ahora <ExternalLink size={14} />
                                </a>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
