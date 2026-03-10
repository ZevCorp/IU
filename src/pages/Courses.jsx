import React, { useState } from 'react';
import { Play, RotateCcw, CheckCircle2, BookOpen, Award, Zap } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { MOCK_COURSES } from '../data/mockData';

export default function Courses() {
    const { courseProgress, updateCourseProgress, completedCourses, profile } = useApp();
    const [activeTab, setActiveTab] = useState('todos');
    const [selectedCourse, setSelectedCourse] = useState(null);
    const [starting, setStarting] = useState(null);

    const userStage = profile?.stage;

    const coursesWithProgress = MOCK_COURSES.map(c => ({
        ...c,
        progress: courseProgress[c.id] || 0,
        isCompleted: (courseProgress[c.id] || 0) >= 100,
        isStarted: (courseProgress[c.id] || 0) > 0,
    }));

    const filtered = coursesWithProgress.filter(c => {
        if (activeTab === 'progreso') return c.isStarted && !c.isCompleted;
        if (activeTab === 'completados') return c.isCompleted;
        if (activeTab === 'recomendados') return c.stages && userStage && c.stages.includes(userStage);
        return true;
    });

    const handleStart = async (course) => {
        setStarting(course.id);
        const next = course.isCompleted ? 0 : Math.min(100, (courseProgress[course.id] || 0) + 25);
        await updateCourseProgress(course.id, next);
        setStarting(null);
        setSelectedCourse(null);
    };

    const totalStarted = coursesWithProgress.filter(c => c.isStarted).length;
    const overallPct = MOCK_COURSES.length > 0 ? Math.round((completedCourses / MOCK_COURSES.length) * 100) : 0;

    return (
        <div className="animate-fade-in" style={{ padding: '28px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '4px' }}>Cursos</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Formación práctica para emprendedores colombianos.</p>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ textAlign: 'center', padding: '10px 16px', backgroundColor: '#f0fdf4', borderRadius: '10px', border: '1px solid #bbf7d0' }}>
                        <p style={{ fontSize: '22px', fontWeight: 800, color: 'var(--primary)', lineHeight: 1 }}>{completedCourses}</p>
                        <p style={{ fontSize: '11px', color: '#065f46', fontWeight: 600 }}>Completados</p>
                    </div>
                    <div style={{ textAlign: 'center', padding: '10px 16px', backgroundColor: '#eff6ff', borderRadius: '10px', border: '1px solid #bfdbfe' }}>
                        <p style={{ fontSize: '22px', fontWeight: 800, color: '#2563eb', lineHeight: 1 }}>{totalStarted}</p>
                        <p style={{ fontSize: '11px', color: '#1d4ed8', fontWeight: 600 }}>En progreso</p>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--bg-main)', padding: '4px', borderRadius: '10px', marginBottom: '20px', width: 'fit-content' }}>
                {[['todos', 'Todos'], ['recomendados', 'Recomendados'], ['progreso', 'En progreso'], ['completados', 'Completados']].map(([val, label]) => (
                    <button key={val} onClick={() => setActiveTab(val)}
                        style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, border: 'none', cursor: 'pointer', backgroundColor: activeTab === val ? 'white' : 'transparent', color: activeTab === val ? 'var(--primary)' : 'var(--text-secondary)', boxShadow: activeTab === val ? '0 1px 4px rgba(0,0,0,0.1)' : 'none', fontFamily: 'var(--font-family)', transition: 'var(--transition)', whiteSpace: 'nowrap' }}>
                        {label}
                    </button>
                ))}
            </div>

            {filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-tertiary)' }}>
                    <p style={{ fontSize: '40px', marginBottom: '12px' }}>📚</p>
                    <p style={{ fontWeight: 600 }}>Sin cursos en esta sección</p>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                    {filtered.map(course => (
                        <div key={course.id} className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', border: course.isCompleted ? '1px solid #bbf7d0' : '1px solid var(--border)', position: 'relative', transition: 'var(--transition)' }}
                            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                            onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>
                            {course.isCompleted && (
                                <div style={{ position: 'absolute', top: '12px', right: '12px' }}>
                                    <CheckCircle2 size={20} style={{ color: 'var(--primary)' }} />
                                </div>
                            )}
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                                <div style={{ fontSize: '32px', flexShrink: 0 }}>{course.emoji}</div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '99px', backgroundColor: 'var(--primary-light)', color: 'var(--primary-dark)' }}>{course.category}</span>
                                        <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '99px', backgroundColor: 'var(--bg-main)', color: 'var(--text-tertiary)' }}>{course.level}</span>
                                    </div>
                                    <h3 style={{ fontWeight: 700, fontSize: '14px', lineHeight: 1.3 }}>{course.title}</h3>
                                </div>
                            </div>

                            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{course.description}</p>

                            <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                <span>⏱ {course.duration}</span>
                                <span>📖 {course.lessons} lecciones</span>
                            </div>

                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600 }}>Progreso</span>
                                    <span style={{ fontSize: '11px', fontWeight: 700, color: course.isCompleted ? 'var(--primary)' : 'var(--text-secondary)' }}>{course.progress}%</span>
                                </div>
                                <div style={{ height: '5px', backgroundColor: 'var(--border)', borderRadius: '5px' }}>
                                    <div style={{ height: '100%', width: `${course.progress}%`, backgroundColor: course.isCompleted ? 'var(--primary)' : '#3b82f6', borderRadius: '5px', transition: '0.4s' }} />
                                </div>
                            </div>

                            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>{course.instructor}</p>

                            <button
                                className="btn btn-primary"
                                onClick={() => setSelectedCourse(course)}
                                disabled={starting === course.id}
                                style={{ fontSize: '13px', gap: '6px', opacity: starting === course.id ? 0.6 : 1 }}>
                                {starting === course.id ? 'Actualizando...' :
                                    course.isCompleted ? <><RotateCcw size={14} /> Revisar</> :
                                        course.isStarted ? <><Play size={14} /> Continuar ({course.progress}%)</> :
                                            <><Play size={14} /> Iniciar curso</>}
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Course detail modal */}
            {selectedCourse && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={() => setSelectedCourse(null)}>
                    <div className="card" style={{ maxWidth: '480px', width: '100%', padding: '32px' }} onClick={e => e.stopPropagation()}>
                        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                            <div style={{ fontSize: '48px', marginBottom: '8px' }}>{selectedCourse.emoji}</div>
                            <h2 style={{ fontWeight: 800, fontSize: '18px', marginBottom: '4px' }}>{selectedCourse.title}</h2>
                            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{selectedCourse.instructor}</p>
                        </div>
                        <p style={{ lineHeight: 1.7, marginBottom: '20px', color: 'var(--text-secondary)' }}>{selectedCourse.description}</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
                            {[['Duración', selectedCourse.duration], ['Lecciones', selectedCourse.lessons], ['Nivel', selectedCourse.level], ['Progreso actual', `${selectedCourse.progress}%`]].map(([k, v]) => (
                                <div key={k} style={{ padding: '10px', backgroundColor: 'var(--bg-main)', borderRadius: '8px', textAlign: 'center' }}>
                                    <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>{k}</p>
                                    <p style={{ fontWeight: 700, marginTop: '2px' }}>{v}</p>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button className="btn btn-secondary" onClick={() => setSelectedCourse(null)}>Cerrar</button>
                            <button className="btn btn-primary" style={{ flex: 1, gap: '8px' }}
                                onClick={() => handleStart(selectedCourse)}
                                disabled={starting === selectedCourse.id}>
                                {starting === selectedCourse.id ? 'Actualizando...' :
                                    selectedCourse.isCompleted ? '🔄 Reiniciar' :
                                        selectedCourse.isStarted ? `▶ Continuar (+25%)` : '▶ Iniciar curso'}
                            </button>
                        </div>
                        {!selectedCourse.isCompleted && (
                            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', textAlign: 'center', marginTop: '10px' }}>
                                Cada clic en "Continuar" avanza 25% del curso.
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
