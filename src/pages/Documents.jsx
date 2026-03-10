import React, { useState } from 'react';
import { FolderOpen, Upload, FileText, Trash2, Edit, Check, X, Plus, Download } from 'lucide-react';
import { useApp } from '../context/AppContext';

const CATEGORIES = ['Constitución', 'Financiero', 'Legal', 'Comercial', 'Operativo'];
const STATUS_OPTIONS = ['Borrador', 'En revisión', 'Listo'];
const STATUS_COLORS = { Borrador: { bg: '#fef9c3', text: '#92400e' }, 'En revisión': { bg: '#dbeafe', text: '#1d4ed8' }, Listo: { bg: '#d1fae5', text: '#065f46' } };

const TEMPLATES = [
    { id: 'canvas', name: 'Business Model Canvas', category: 'Comercial' },
    { id: 'pitch', name: 'Pitch Deck Template', category: 'Comercial' },
    { id: 'financiero', name: 'Proyecciones Financieras 12 meses', category: 'Financiero' },
    { id: 'persona', name: 'Plantilla Buyer Persona', category: 'Comercial' },
    { id: 'contrato', name: 'Contrato de Servicios Simple', category: 'Legal' },
    { id: 'nda', name: 'Acuerdo de Confidencialidad (NDA)', category: 'Legal' },
];

export default function Documents() {
    const { addActivity } = useApp();
    const [docs, setDocs] = useState([
        { id: 'doc-1', name: 'Registro Cámara de Comercio', category: 'Constitución', status: 'Listo', type: 'PDF', size: '1.2 MB', date: '2026-01-15' },
        { id: 'doc-2', name: 'Proyecciones Q1 2026', category: 'Financiero', status: 'En revisión', type: 'XLSX', size: '340 KB', date: '2026-02-01' },
        { id: 'doc-3', name: 'Propuesta de Valor v2', category: 'Comercial', status: 'Borrador', type: 'DOCX', size: '200 KB', date: '2026-02-20' },
    ]);
    const [activeCategory, setActiveCategory] = useState('Todos');
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [editStatus, setEditStatus] = useState('');
    const [showUpload, setShowUpload] = useState(false);
    const [newDocName, setNewDocName] = useState('');
    const [newDocCat, setNewDocCat] = useState('Constitución');

    const filtered = docs.filter(d => activeCategory === 'Todos' || d.category === activeCategory);

    const handleStatusChange = (id, newStatus) => {
        setDocs(p => p.map(d => d.id === id ? { ...d, status: newStatus } : d));
    };

    const handleDelete = (id) => {
        setDocs(p => p.filter(d => d.id !== id));
    };

    const handleEdit = (doc) => { setEditingId(doc.id); setEditName(doc.name); setEditStatus(doc.status); };
    const handleSaveEdit = () => {
        setDocs(p => p.map(d => d.id === editingId ? { ...d, name: editName, status: editStatus } : d));
        setEditingId(null);
    };

    const handleUpload = () => {
        if (!newDocName.trim()) return;
        const newDoc = { id: `doc-${Date.now()}`, name: newDocName, category: newDocCat, status: 'Borrador', type: 'PDF', size: '—', date: new Date().toISOString().split('T')[0] };
        setDocs(p => [...p, newDoc]);
        addActivity(`Documento creado: ${newDocName}`, '📄');
        setNewDocName(''); setShowUpload(false);
    };

    const handleTemplate = (template) => {
        const newDoc = { id: `doc-${Date.now()}`, name: template.name, category: template.category, status: 'Borrador', type: 'DOCX', size: '—', date: new Date().toISOString().split('T')[0] };
        setDocs(p => [...p, newDoc]);
        addActivity(`Plantilla generada: ${template.name}`, '📋');
    };

    const TYPE_EMOJI = { PDF: '📄', XLSX: '📊', DOCX: '📝', PNG: '🖼️', JPG: '🖼️' };

    return (
        <div className="animate-fade-in" style={{ padding: '28px', maxWidth: '1000px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '26px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ padding: '10px', backgroundColor: '#eff6ff', borderRadius: '12px' }}><FolderOpen size={22} style={{ color: '#3b82f6' }} /></div>
                    <div><h1 style={{ fontSize: '22px', fontWeight: 800 }}>Documentos</h1><p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Gestiona los documentos clave de tu emprendimiento.</p></div>
                </div>
                <button className="btn btn-primary" onClick={() => setShowUpload(true)} style={{ gap: '8px' }}><Plus size={16} /> Agregar documento</button>
            </div>

            {/* Upload form */}
            {showUpload && (
                <div className="card" style={{ padding: '20px', marginBottom: '20px', border: '2px solid var(--primary-light)', backgroundColor: '#f9fffe' }}>
                    <h3 style={{ fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}><Upload size={18} style={{ color: 'var(--primary)' }} /> Agregar documento</h3>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <input className="form-input" style={{ flex: 1, minWidth: '200px' }} placeholder="Nombre del documento..." value={newDocName} onChange={e => setNewDocName(e.target.value)} />
                        <select className="form-input" style={{ width: 'auto', minWidth: '150px' }} value={newDocCat} onChange={e => setNewDocCat(e.target.value)}>
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <button className="btn btn-primary" onClick={handleUpload} style={{ gap: '6px' }}><Check size={16} /> Crear</button>
                        <button className="btn btn-secondary" onClick={() => setShowUpload(false)}><X size={16} /></button>
                    </div>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '24px' }}>
                {/* Sidebar */}
                <div>
                    <div className="card" style={{ padding: '12px', marginBottom: '16px' }}>
                        <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', padding: '4px 8px 8px', letterSpacing: '0.05em' }}>Categorías</p>
                        {['Todos', ...CATEGORIES].map(cat => {
                            const count = cat === 'Todos' ? docs.length : docs.filter(d => d.category === cat).length;
                            return (
                                <button key={cat} onClick={() => setActiveCategory(cat)}
                                    style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, border: 'none', cursor: 'pointer', backgroundColor: activeCategory === cat ? 'var(--primary-light)' : 'transparent', color: activeCategory === cat ? 'var(--primary-dark)' : 'var(--text-secondary)', fontFamily: 'var(--font-family)', marginBottom: '2px' }}>
                                    <span>{cat}</span>
                                    <span style={{ fontSize: '11px', fontWeight: 700, backgroundColor: activeCategory === cat ? 'var(--primary)' : 'var(--bg-main)', color: activeCategory === cat ? 'white' : 'var(--text-tertiary)', padding: '1px 7px', borderRadius: '99px' }}>{count}</span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Templates */}
                    <div className="card" style={{ padding: '14px' }}>
                        <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', padding: '2px 4px 10px', letterSpacing: '0.05em' }}>🔧 Plantillas</p>
                        {TEMPLATES.map(t => (
                            <button key={t.id} onClick={() => handleTemplate(t)}
                                style={{ width: '100%', display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '8px', borderRadius: '8px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-family)', textAlign: 'left', marginBottom: '2px', transition: 'var(--transition)' }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-main)'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                <span style={{ fontSize: '16px', flexShrink: 0 }}>📋</span>
                                <div>
                                    <p style={{ fontSize: '12px', fontWeight: 600, lineHeight: 1.3 }}>{t.name}</p>
                                    <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{t.category}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Docs list */}
                <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
                    {filtered.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-tertiary)' }}>
                            <p style={{ fontSize: '40px', marginBottom: '12px' }}>📂</p>
                            <p style={{ fontWeight: 600 }}>Sin documentos en esta categoría</p>
                            <button className="btn btn-primary" style={{ marginTop: '16px' }} onClick={() => setShowUpload(true)}>+ Agregar documento</button>
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                    {['Documento', 'Categoría', 'Estado', 'Fecha', 'Acciones'].map(h => (
                                        <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((doc, idx) => {
                                    const stColor = STATUS_COLORS[doc.status] || STATUS_COLORS.Borrador;
                                    const isEditing = editingId === doc.id;
                                    return (
                                        <tr key={doc.id} style={{ borderBottom: idx < filtered.length - 1 ? '1px solid var(--border)' : 'none', backgroundColor: isEditing ? '#f9fffe' : 'transparent' }}>
                                            <td style={{ padding: '12px 16px' }}>
                                                {isEditing ? (
                                                    <input className="form-input" value={editName} onChange={e => setEditName(e.target.value)} style={{ fontSize: '13px', padding: '6px 10px' }} />
                                                ) : (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <span style={{ fontSize: '20px' }}>{TYPE_EMOJI[doc.type] || '📄'}</span>
                                                        <div>
                                                            <p style={{ fontWeight: 600, fontSize: '13px' }}>{doc.name}</p>
                                                            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{doc.type} · {doc.size}</p>
                                                        </div>
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ padding: '12px 16px' }}>
                                                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>{doc.category}</span>
                                            </td>
                                            <td style={{ padding: '12px 16px' }}>
                                                {isEditing ? (
                                                    <select className="form-input" style={{ fontSize: '12px', padding: '5px 8px', width: 'auto' }} value={editStatus} onChange={e => setEditStatus(e.target.value)}>
                                                        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                                    </select>
                                                ) : (
                                                    <button onClick={() => { const idx = STATUS_OPTIONS.indexOf(doc.status); handleStatusChange(doc.id, STATUS_OPTIONS[(idx + 1) % STATUS_OPTIONS.length]); }}
                                                        style={{ fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '99px', backgroundColor: stColor.bg, color: stColor.text, border: 'none', cursor: 'pointer' }}>
                                                        {doc.status}
                                                    </button>
                                                )}
                                            </td>
                                            <td style={{ padding: '12px 16px' }}>
                                                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{doc.date}</span>
                                            </td>
                                            <td style={{ padding: '12px 16px' }}>
                                                <div style={{ display: 'flex', gap: '6px' }}>
                                                    {isEditing ? (
                                                        <>
                                                            <button onClick={handleSaveEdit} style={{ padding: '6px', borderRadius: '6px', border: '1px solid #bbf7d0', backgroundColor: '#f0fdf4', cursor: 'pointer', color: '#10b981' }}><Check size={14} /></button>
                                                            <button onClick={() => setEditingId(null)} style={{ padding: '6px', borderRadius: '6px', border: '1px solid var(--border)', backgroundColor: 'white', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={14} /></button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button onClick={() => handleEdit(doc)} style={{ padding: '6px', borderRadius: '6px', border: '1px solid var(--border)', backgroundColor: 'white', cursor: 'pointer', color: 'var(--text-secondary)' }} title="Editar"><Edit size={14} /></button>
                                                            <button style={{ padding: '6px', borderRadius: '6px', border: '1px solid var(--border)', backgroundColor: 'white', cursor: 'pointer', color: 'var(--text-secondary)' }} title="Descargar"><Download size={14} /></button>
                                                            <button onClick={() => handleDelete(doc.id)} style={{ padding: '6px', borderRadius: '6px', border: '1px solid #fee2e2', backgroundColor: '#fff5f5', cursor: 'pointer', color: '#dc2626' }} title="Eliminar"><Trash2 size={14} /></button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
