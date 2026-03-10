import React, { useState } from 'react';
import { CheckCircle2, Clock, Circle, AlertCircle, ChevronDown, ChevronUp, Map } from 'lucide-react';
import { useApp } from '../context/AppContext';

const STATUS_CONFIG = {
    completado: { label: 'Completado', color: '#10b981', bg: '#f0fdf4', icon: <CheckCircle2 size={16} style={{ color: '#10b981' }} /> },
    'en progreso': { label: 'En progreso', color: '#3b82f6', bg: '#eff6ff', icon: <Clock size={16} style={{ color: '#3b82f6' }} /> },
    pendiente: { label: 'Pendiente', color: '#94a3b8', bg: '#f8fafc', icon: <Circle size={16} style={{ color: '#94a3b8' }} /> },
    bloqueado: { label: 'Bloqueado', color: '#f59e0b', bg: '#fffbeb', icon: <AlertCircle size={16} style={{ color: '#f59e0b' }} /> },
};

function TaskCard({ task, onUpdate }) {
    const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pendiente;
    const [updating, setUpdating] = useState(false);

    const cycleStatus = async () => {
        const next = { pendiente: 'en progreso', 'en progreso': 'completado', completado: 'pendiente', bloqueado: 'pendiente' };
        setUpdating(true);
        await onUpdate(task.id, next[task.status]);
        setUpdating(false);
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderRadius: '10px', backgroundColor: cfg.bg, border: `1px solid ${task.status === 'completado' ? '#bbf7d0' : 'var(--border)'}`, opacity: updating ? 0.6 : 1, transition: 'var(--transition)' }}>
            <button onClick={cycleStatus} disabled={updating} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}
                title={task.status === 'completado' ? 'Marcar como pendiente' : 'Marcar como completado'}>
                {cfg.icon}
            </button>
            <div style={{ flex: 1 }}>
                <p style={{ fontSize: '13px', fontWeight: 600, textDecoration: task.status === 'completado' ? 'line-through' : 'none', color: task.status === 'completado' ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>
                    {task.title}
                </p>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '99px', fontWeight: 700, backgroundColor: task.priority === 'Alta' ? '#fee2e2' : task.priority === 'Media' ? '#fef9c3' : '#f1f5f9', color: task.priority === 'Alta' ? '#dc2626' : task.priority === 'Media' ? '#92400e' : '#64748b' }}>
                    {task.priority}
                </span>
                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '99px', fontWeight: 600, color: cfg.color, backgroundColor: 'white', border: `1px solid ${cfg.color}40` }}>
                    {cfg.label}
                </span>
            </div>
        </div>
    );
}

export default function Roadmap() {
    const { tasks, updateTask, progressPercent, completedTasks, totalTasks, profile } = useApp();
    const [collapsedSections, setCollapsedSections] = useState({});

    const sections = [...new Set(tasks.map(t => t.section))];
    const toggle = (section) => setCollapsedSections(p => ({ ...p, [section]: !p[section] }));

    return (
        <div className="animate-fade-in" style={{ padding: '28px', maxWidth: '900px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ padding: '10px', backgroundColor: '#f0fdf4', borderRadius: '12px' }}>
                        <Map size={22} style={{ color: 'var(--primary)' }} />
                    </div>
                    <div>
                        <h1 style={{ fontSize: '22px', fontWeight: 800 }}>Mi Ruta</h1>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Etapa: {profile?.stage || 'Idea'} · Progreso: {progressPercent}%</p>
                    </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: '28px', fontWeight: 800 }}>{progressPercent}%</p>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{completedTasks} de {totalTasks} tareas</p>
                </div>
            </div>

            {/* Progress bar */}
            <div className="card" style={{ padding: '20px', marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>Progreso general de la ruta</span>
                    <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{completedTasks}/{totalTasks} tareas</span>
                </div>
                <div style={{ height: '10px', backgroundColor: 'var(--border)', borderRadius: '10px' }}>
                    <div style={{ height: '100%', width: `${progressPercent}%`, backgroundColor: 'var(--primary)', borderRadius: '10px', transition: '0.6s ease' }} />
                </div>
                <div style={{ display: 'flex', gap: '20px', marginTop: '12px', flexWrap: 'wrap' }}>
                    {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
                        const count = tasks.filter(t => t.status === key).length;
                        return count > 0 ? (
                            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {cfg.icon}
                                <span style={{ fontSize: '12px', fontWeight: 600, color: cfg.color }}>{count} {cfg.label}</span>
                            </div>
                        ) : null;
                    })}
                </div>
            </div>

            {/* Tip */}
            <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#1d4ed8' }}>
                💡 <strong>Tip:</strong> Haz clic en el ícono de estado de cada tarea para actualizarlo (pendiente → en progreso → completado).
            </div>

            {/* Sections */}
            {sections.map(section => {
                const sectionTasks = tasks.filter(t => t.section === section);
                const sectionCompleted = sectionTasks.filter(t => t.status === 'completado').length;
                const sectionPct = Math.round((sectionCompleted / sectionTasks.length) * 100);
                const collapsed = collapsedSections[section];

                return (
                    <div key={section} className="card" style={{ marginBottom: '16px', overflow: 'hidden' }}>
                        <button onClick={() => toggle(section)}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px', cursor: 'pointer', border: 'none', backgroundColor: 'transparent', fontFamily: 'var(--font-family)', textAlign: 'left' }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                                    <h3 style={{ fontWeight: 700, fontSize: '15px' }}>{section}</h3>
                                    <span style={{ fontSize: '12px', padding: '2px 10px', borderRadius: '99px', fontWeight: 700, backgroundColor: sectionPct === 100 ? '#d1fae5' : '#f1f5f9', color: sectionPct === 100 ? '#065f46' : 'var(--text-secondary)' }}>
                                        {sectionCompleted}/{sectionTasks.length}
                                    </span>
                                    {sectionPct === 100 && <span style={{ fontSize: '16px' }}>✅</span>}
                                </div>
                                <div style={{ height: '4px', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '200px' }}>
                                    <div style={{ height: '100%', width: `${sectionPct}%`, backgroundColor: sectionPct === 100 ? 'var(--primary)' : '#3b82f6', borderRadius: '4px', transition: '0.4s' }} />
                                </div>
                            </div>
                            {collapsed ? <ChevronDown size={18} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} /> : <ChevronUp size={18} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />}
                        </button>

                        {!collapsed && (
                            <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {sectionTasks.map(task => (
                                    <TaskCard key={task.id} task={task} onUpdate={updateTask} />
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
