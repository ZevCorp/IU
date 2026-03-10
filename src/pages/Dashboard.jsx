import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ClipboardList, CheckCircle2, Circle, BookOpen, Target, AlertCircle, Zap, TrendingUp, Award } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { STAGES } from '../data/mockData';

export default function Dashboard() {
    const { profile, diagnosticCompleted, tasks, completedTasks, totalTasks, progressPercent, completedCourses, points, level, activityEvents } = useApp();
    const navigate = useNavigate();

    const name = profile?.full_name?.split(' ')[0] || 'Emprendedor';
    const stage = profile?.stage || 'Idea';
    const stageIndex = STAGES.indexOf(stage);
    const pendingTasks = tasks.filter(t => t.status !== 'completado').slice(0, 4);

    const hour = new Date().getHours();
    const greeting = hour < 12 ? '¡Buenos días' : hour < 19 ? '¡Buenas tardes' : '¡Buenas noches';

    return (
        <div className="animate-fade-in" style={{ padding: '28px', maxWidth: '1100px' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
                <div>
                    <h1 style={{ fontSize: '26px', fontWeight: 800, marginBottom: '4px' }}>{greeting}, {name}! 👋</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>
                        {diagnosticCompleted ? `Etapa actual: ${stage}` : 'Completa el diagnóstico para personalizar tu experiencia'}
                    </p>
                </div>
                <button className="btn btn-primary" onClick={() => navigate('/ruta')} style={{ gap: '8px', whiteSpace: 'nowrap' }}>
                    Ver mi ruta <ArrowRight size={16} />
                </button>
            </div>

            {/* Diagnostic reminder */}
            {!diagnosticCompleted && (
                <div onClick={() => navigate('/diagnostico')} style={{ backgroundColor: '#fefce8', border: '1px solid #fde047', borderRadius: '12px', padding: '16px 20px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
                    <AlertCircle size={20} style={{ color: '#ca8a04', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                        <p style={{ fontWeight: 700, color: '#92400e' }}>Diagnóstico pendiente</p>
                        <p style={{ fontSize: '13px', color: '#a16207' }}>Completa el diagnóstico para recibir una ruta personalizada y recomendaciones.</p>
                    </div>
                    <button className="btn btn-secondary" style={{ fontSize: '13px', padding: '8px 14px', whiteSpace: 'nowrap' }}>
                        Hacer diagnóstico →
                    </button>
                </div>
            )}

            {/* Stage progression */}
            <div className="card" style={{ padding: '20px 24px', marginBottom: '20px', background: 'linear-gradient(135deg, #f0fdf4 0%, white 100%)', border: '1px solid #bbf7d0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Etapa actual</p>
                        <p style={{ fontSize: '22px', fontWeight: 800, color: 'var(--primary)' }}>{stage}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Progreso general</p>
                        <p style={{ fontSize: '28px', fontWeight: 800 }}>{progressPercent}%</p>
                    </div>
                </div>
                <div style={{ position: 'relative' }}>
                    <div style={{ height: '8px', backgroundColor: '#e2e8f0', borderRadius: '8px' }}>
                        <div style={{ height: '100%', width: `${progressPercent}%`, backgroundColor: 'var(--primary)', borderRadius: '8px', transition: '1s ease' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
                        {STAGES.map((s, i) => (
                            <span key={s} style={{ fontSize: '11px', fontWeight: i <= stageIndex ? 700 : 400, color: i <= stageIndex ? 'var(--primary)' : 'var(--text-tertiary)', cursor: 'pointer' }}>{s}</span>
                        ))}
                    </div>
                </div>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
                {[
                    { icon: <CheckCircle2 size={22} style={{ color: '#10b981' }} />, value: completedTasks, label: 'Tareas completadas', bg: '#f0fdf4', border: '#bbf7d0', action: () => navigate('/ruta') },
                    { icon: <BookOpen size={22} style={{ color: '#6366f1' }} />, value: completedCourses, label: 'Cursos completados', bg: '#eef2ff', border: '#c7d2fe', action: () => navigate('/cursos') },
                    { icon: <Zap size={22} style={{ color: '#f59e0b' }} />, value: points, label: 'Puntos ganados', bg: '#fffbeb', border: '#fde68a', action: () => navigate('/seguimiento') },
                    { icon: <Target size={22} style={{ color: '#ec4899' }} />, value: `${totalTasks - completedTasks}`, label: 'Tareas pendientes', bg: '#fdf2f8', border: '#fbcfe8', action: () => navigate('/primeros-pasos') },
                ].map((stat, i) => (
                    <div key={i} className="card" onClick={stat.action}
                        style={{ padding: '18px', display: 'flex', gap: '14px', alignItems: 'center', backgroundColor: stat.bg, border: `1px solid ${stat.border}`, cursor: 'pointer', transition: 'var(--transition)' }}
                        onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                        onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>
                        <div style={{ padding: '10px', borderRadius: '10px', backgroundColor: 'white' }}>{stat.icon}</div>
                        <div>
                            <p style={{ fontSize: '24px', fontWeight: 800, lineHeight: 1.1 }}>{stat.value}</p>
                            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>{stat.label}</p>
                        </div>
                    </div>
                ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                {/* Next tasks */}
                <div className="card" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h2 style={{ fontWeight: 700, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Target size={18} style={{ color: 'var(--primary)' }} /> Próximas tareas
                        </h2>
                        <button className="btn-ghost" style={{ fontSize: '13px', color: 'var(--primary)' }} onClick={() => navigate('/primeros-pasos')}>Ver todas →</button>
                    </div>
                    {pendingTasks.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-tertiary)' }}>
                            <p>¡Sin tareas pendientes! 🎉</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {pendingTasks.map(task => (
                                <div key={task.id} onClick={() => navigate('/ruta')}
                                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '8px', backgroundColor: 'var(--bg-main)', cursor: 'pointer', border: '1px solid transparent', transition: 'var(--transition)' }}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary-light)'; e.currentTarget.style.backgroundColor = '#f0fdf4'; }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.backgroundColor = 'var(--bg-main)'; }}>
                                    <Circle size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                                    <div style={{ flex: 1 }}>
                                        <p style={{ fontSize: '13px', fontWeight: 600 }}>{task.title}</p>
                                        <p style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{task.section}</p>
                                    </div>
                                    <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '99px', fontWeight: 600, backgroundColor: task.priority === 'Alta' ? '#fee2e2' : task.priority === 'Media' ? '#fef9c3' : '#f1f5f9', color: task.priority === 'Alta' ? '#dc2626' : task.priority === 'Media' ? '#92400e' : 'var(--text-tertiary)' }}>
                                        {task.priority}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Activity feed */}
                <div className="card" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h2 style={{ fontWeight: 700, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <TrendingUp size={18} style={{ color: 'var(--primary)' }} /> Actividad reciente
                        </h2>
                        <button className="btn-ghost" style={{ fontSize: '13px', color: 'var(--primary)' }} onClick={() => navigate('/seguimiento')}>Ver todo →</button>
                    </div>
                    {activityEvents.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-tertiary)' }}>
                            <p style={{ marginBottom: '8px' }}>Sin actividad aún.</p>
                            <p style={{ fontSize: '13px' }}>Completa tareas y gana puntos para ver tu historial aquí.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {activityEvents.slice(0, 6).map(ev => (
                                <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                                    <span style={{ fontSize: '18px', flexShrink: 0 }}>{ev.icon || '✅'}</span>
                                    <div style={{ flex: 1 }}>
                                        <p style={{ fontSize: '13px', fontWeight: 600 }}>{ev.description}</p>
                                        <p style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{new Date(ev.timestamp).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    {activityEvents.length === 0 && (
                        <button className="btn btn-primary" onClick={() => navigate('/diagnostico')} style={{ width: '100%', marginTop: '16px' }}>
                            Empezar con el diagnóstico →
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
