import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart2, Award, Zap, TrendingUp, Target, BookOpen, CheckCircle2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { MOCK_COURSES } from '../data/mockData';

const BADGES = [
    { id: 'first-task', icon: '🏆', label: 'Primer Paso', desc: 'Completaste tu primera tarea', check: ({ completedTasks }) => completedTasks >= 1 },
    { id: 'diagnostic', icon: '📋', label: 'Diagnosticado', desc: 'Completaste el diagnóstico', check: ({ diagnosticCompleted }) => diagnosticCompleted },
    { id: 'five-tasks', icon: '⚡', label: 'Ejecutor', desc: 'Completaste 5 tareas', check: ({ completedTasks }) => completedTasks >= 5 },
    { id: 'first-course', icon: '📚', label: 'Estudiante', desc: 'Iniciaste tu primer curso', check: ({ courseProgress }) => Object.values(courseProgress).some(p => p > 0) },
    { id: 'first-course-done', icon: '🎓', label: 'Graduado', desc: 'Completaste tu primer curso', check: ({ completedCourses }) => completedCourses >= 1 },
    { id: 'saved-opp', icon: '🔖', label: 'Explorador', desc: 'Guardaste una oportunidad', check: ({ savedOpportunities }) => savedOpportunities.length >= 1 },
    { id: 'ten-tasks', icon: '🚀', label: 'Imparable', desc: 'Completaste 10 tareas', check: ({ completedTasks }) => completedTasks >= 10 },
    { id: 'biz-profile', icon: '🏢', label: 'Empresario', desc: 'Creaste tu perfil de negocio', check: ({ businessProfile }) => !!businessProfile },
];

const HEALTH_METRICS = [
    { label: 'Formalización', tasks: ['Registrar RUT en DIAN', 'Crear empresa (SAS o Persona Natural)', 'Registro en Cámara de Comercio'] },
    { label: 'Producto', tasks: ['Definir propuesta de valor', 'Construir o definir MVP', 'Realizar 10 entrevistas de usuario'] },
    { label: 'Mercadeo', tasks: ['Definir buyer persona', 'Crear perfiles en redes sociales', 'Definir canales de adquisición'] },
    { label: 'Financiero', tasks: ['Definir modelo de ingresos', 'Armar proyecciones financieras básicas'] },
];

export default function Tracker() {
    const { profile, diagnosticCompleted, tasks, completedTasks, totalTasks, progressPercent, completedCourses, savedOpportunities, courseProgress, businessProfile, activityEvents, points, level, levelNum, nextLevelPoints, levelProgress } = useApp();
    const navigate = useNavigate();

    const earnedBadges = BADGES.filter(b => b.check({ completedTasks, diagnosticCompleted, courseProgress, completedCourses, savedOpportunities, businessProfile }));

    const healthScores = HEALTH_METRICS.map(m => {
        const relevant = tasks.filter(t => m.tasks.includes(t.title));
        const done = relevant.filter(t => t.status === 'completado').length;
        const pct = relevant.length > 0 ? Math.round((done / relevant.length) * 100) : 0;
        return { ...m, pct, done, total: relevant.length };
    });

    const overallHealth = healthScores.length > 0 ? Math.round(healthScores.reduce((a, s) => a + s.pct, 0) / healthScores.length) : 0;

    return (
        <div className="animate-fade-in" style={{ padding: '28px', maxWidth: '1000px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
                <div style={{ padding: '10px', backgroundColor: '#fffbeb', borderRadius: '12px' }}><BarChart2 size={22} style={{ color: '#f59e0b' }} /></div>
                <div>
                    <h1 style={{ fontSize: '22px', fontWeight: 800 }}>Seguimiento</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Tu progreso, puntos y logros en EmprendeHub.</p>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                {/* Level card */}
                <div className="card" style={{ padding: '24px', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                        <div>
                            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Nivel {levelNum}</p>
                            <p style={{ fontSize: '24px', fontWeight: 800, color: 'white' }}>{level}</p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <p style={{ fontSize: '32px', fontWeight: 800, color: '#fbbf24', lineHeight: 1 }}>{points}</p>
                            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>puntos totales</p>
                        </div>
                    </div>
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>Progreso al siguiente nivel</p>
                            <p style={{ fontSize: '12px', color: '#10b981', fontWeight: 700 }}>{levelProgress}%</p>
                        </div>
                        <div style={{ height: '6px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '6px' }}>
                            <div style={{ height: '100%', width: `${levelProgress}%`, background: 'linear-gradient(90deg, #10b981, #34d399)', borderRadius: '6px', transition: '0.6s' }} />
                        </div>
                        <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: '6px' }}>
                            {nextLevelPoints - points > 0 ? `Faltan ${nextLevelPoints - points} puntos para el siguiente nivel` : '¡Nivel máximo alcanzado!'}
                        </p>
                    </div>
                </div>

                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    {[
                        { icon: <CheckCircle2 size={20} style={{ color: '#10b981' }} />, value: completedTasks, label: 'Tareas', bg: '#f0fdf4', onClick: () => navigate('/ruta') },
                        { icon: <BookOpen size={20} style={{ color: '#6366f1' }} />, value: completedCourses, label: 'Cursos', bg: '#eef2ff', onClick: () => navigate('/cursos') },
                        { icon: <Target size={20} style={{ color: '#ec4899' }} />, value: savedOpportunities.length, label: 'Guardadas', bg: '#fdf2f8', onClick: () => navigate('/oportunidades') },
                        { icon: <TrendingUp size={20} style={{ color: '#f59e0b' }} />, value: `${progressPercent}%`, label: 'Progreso', bg: '#fffbeb', onClick: () => navigate('/ruta') },
                    ].map((s, i) => (
                        <div key={i} className="card" onClick={s.onClick}
                            style={{ padding: '16px', backgroundColor: s.bg, cursor: 'pointer', display: 'flex', gap: '10px', alignItems: 'center', border: 'none' }}
                            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
                            {s.icon}
                            <div><p style={{ fontWeight: 800, fontSize: '22px', lineHeight: 1 }}>{s.value}</p><p style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 500 }}>{s.label}</p></div>
                        </div>
                    ))}
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                {/* Health Score */}
                <div className="card" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h2 style={{ fontWeight: 700, fontSize: '16px' }}>🩺 Health Score</h2>
                        <div style={{ fontSize: '28px', fontWeight: 800, color: overallHealth >= 70 ? '#10b981' : overallHealth >= 40 ? '#f59e0b' : '#ef4444' }}>
                            {overallHealth}
                        </div>
                    </div>
                    {healthScores.map(s => (
                        <div key={s.label} style={{ marginBottom: '14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                <span style={{ fontSize: '13px', fontWeight: 600 }}>{s.label}</span>
                                <span style={{ fontSize: '12px', color: s.pct === 100 ? '#10b981' : 'var(--text-tertiary)', fontWeight: 600 }}>{s.done}/{s.total}</span>
                            </div>
                            <div style={{ height: '6px', backgroundColor: 'var(--border)', borderRadius: '6px' }}>
                                <div style={{ height: '100%', width: `${s.pct}%`, backgroundColor: s.pct >= 80 ? '#10b981' : s.pct >= 50 ? '#3b82f6' : '#f59e0b', borderRadius: '6px', transition: '0.5s' }} />
                            </div>
                        </div>
                    ))}
                </div>

                {/* Badges */}
                <div className="card" style={{ padding: '24px' }}>
                    <h2 style={{ fontWeight: 700, fontSize: '16px', marginBottom: '16px' }}>🏅 Logros ({earnedBadges.length}/{BADGES.length})</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                        {BADGES.map(badge => {
                            const earned = earnedBadges.find(b => b.id === badge.id);
                            return (
                                <div key={badge.id} title={badge.desc}
                                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '10px 4px', borderRadius: '10px', backgroundColor: earned ? '#f0fdf4' : '#f8fafc', border: `1px solid ${earned ? '#bbf7d0' : 'var(--border)'}`, opacity: earned ? 1 : 0.4, cursor: 'default', transition: 'var(--transition)' }}>
                                    <span style={{ fontSize: '24px', filter: earned ? 'none' : 'grayscale(100%)' }}>{badge.icon}</span>
                                    <p style={{ fontSize: '10px', fontWeight: 700, textAlign: 'center', lineHeight: 1.2, color: earned ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{badge.label}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Activity Timeline */}
            <div className="card" style={{ padding: '24px' }}>
                <h2 style={{ fontWeight: 700, fontSize: '16px', marginBottom: '16px' }}>📅 Actividad reciente</h2>
                {activityEvents.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-tertiary)' }}>
                        <p>Aún no hay actividad registrada.</p>
                        <p style={{ fontSize: '13px', marginTop: '8px' }}>Completa tareas, cursos y diagnóstico para ver tu historial.</p>
                        <button className="btn btn-primary" style={{ marginTop: '16px' }} onClick={() => navigate('/diagnostico')}>Comenzar ahora →</button>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                        {activityEvents.slice(0, 15).map((ev, idx) => (
                            <div key={ev.id} style={{ display: 'flex', gap: '12px', padding: '12px 0', borderBottom: idx < activityEvents.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>
                                    {ev.icon || '✅'}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <p style={{ fontWeight: 600, fontSize: '13px' }}>{ev.description}</p>
                                    <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                        {new Date(ev.timestamp).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
