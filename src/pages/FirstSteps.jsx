import React, { useState } from 'react';
import { CheckCircle2, Circle, ChevronDown, ChevronUp, CheckSquare, ExternalLink } from 'lucide-react';
import { useApp } from '../context/AppContext';

const FIRST_STEPS_SECTIONS = ['Formalización', 'Producto / Servicio', 'Financiero', 'Mercadeo'];

const STEP_INFO = {
    'Registrar RUT en DIAN': { emoji: '📄', url: 'https://www.dian.gov.co/', tip: 'Trámite gratuito y 100% en línea desde la página de la DIAN.' },
    'Crear empresa (SAS o Persona Natural)': { emoji: '🏛️', url: 'https://www.ccb.org.co/', tip: 'La SAS es la figura más flexible para startups en Colombia.' },
    'Registro en Cámara de Comercio': { emoji: '📋', url: 'https://www.ccb.org.co/', tip: 'La matrícula mercantil te da identidad legal como empresa.' },
    'Abrir cuenta bancaria empresarial': { emoji: '🏦', url: '#', tip: 'Separa las finanzas personales de las empresariales desde el inicio.' },
    'Definir propuesta de valor': { emoji: '💡', url: '#', tip: 'Usa el Value Proposition Canvas de Strategyzer para estructurarla.' },
    'Construir o definir MVP': { emoji: '🔧', url: '#', tip: 'El MVP debe validar tu hipótesis central con el menor esfuerzo posible.' },
    'Realizar 10 entrevistas de usuario': { emoji: '🎤', url: '#', tip: 'Usa preguntas abiertas. Nunca preguntes "¿usarías esto?" — observa comportamientos.' },
    'Iterar producto con feedback recibido': { emoji: '🔄', url: '#', tip: 'Documenta cada aprendizaje. Cada iteración debe tener una hipótesis clara.' },
    'Definir modelo de ingresos': { emoji: '💰', url: '#', tip: 'Explora: suscripción, comisión, freemium, venta directa, licencia.' },
    'Armar proyecciones financieras básicas': { emoji: '📊', url: '#', tip: 'Proyecta a 12 meses mínimo: ingresos, costos fijos, variables y punto de equilibrio.' },
    'Calcular punto de equilibrio': { emoji: '⚖️', url: '#', tip: 'Punto de equilibrio = Costos Fijos / (Precio - Costo Variable Unitario)' },
    'Definir buyer persona': { emoji: '👤', url: '#', tip: 'Incluye: nombre ficticio, edad, trabajo, frustraciones, objetivos y dónde se informa.' },
    'Crear perfiles en redes sociales': { emoji: '📱', url: '#', tip: 'Elige 1-2 plataformas donde esté tu audiencia. No intentes estar en todas.' },
    'Definir canales de adquisición': { emoji: '📡', url: '#', tip: 'Prueba 2-3 canales en paralelo. Mide y dobla en el que funcione.' },
    'Diseñar identidad de marca básica': { emoji: '🎨', url: '#', tip: 'Usa Canva para crear logo, paleta de colores y tipografía consistente.' },
};

export default function FirstSteps() {
    const { tasks, updateTask, progressPercent, completedTasks, totalTasks } = useApp();
    const [expanded, setExpanded] = useState({});

    const relevantSections = FIRST_STEPS_SECTIONS;
    const sectionTasks = relevantSections.reduce((acc, sec) => {
        acc[sec] = tasks.filter(t => t.section === sec);
        return acc;
    }, {});

    const toggle = (section) => setExpanded(p => ({ ...p, [section]: !p[section] }));

    const [updatingId, setUpdatingId] = useState(null);
    const handleCheck = async (task) => {
        setUpdatingId(task.id);
        const newStatus = task.status === 'completado' ? 'pendiente' : 'completado';
        await updateTask(task.id, newStatus);
        setUpdatingId(null);
    };

    return (
        <div className="animate-fade-in" style={{ padding: '28px', maxWidth: '800px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ padding: '10px', backgroundColor: '#f0fdf4', borderRadius: '12px' }}>
                        <CheckSquare size={22} style={{ color: 'var(--primary)' }} />
                    </div>
                    <div>
                        <h1 style={{ fontSize: '22px', fontWeight: 800 }}>Primeros Pasos</h1>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Checklist de arranque para tu emprendimiento.</p>
                    </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: '26px', fontWeight: 800 }}>{completedTasks}/{totalTasks}</p>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>tareas completadas</p>
                </div>
            </div>

            {/* Progress */}
            <div className="card" style={{ padding: '18px 22px', marginBottom: '22px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>Progreso general</span>
                    <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{progressPercent}%</span>
                </div>
                <div style={{ height: '8px', backgroundColor: 'var(--border)', borderRadius: '8px' }}>
                    <div style={{ height: '100%', width: `${progressPercent}%`, backgroundColor: 'var(--primary)', borderRadius: '8px', transition: '0.6s ease' }} />
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '8px' }}>
                    💡 Marca una tarea como completada haciendo clic en el checkbox. Los cambios se sincronizan en toda la app.
                </p>
            </div>

            {relevantSections.map(section => {
                const secTasks = sectionTasks[section];
                if (!secTasks || secTasks.length === 0) return null;
                const completed = secTasks.filter(t => t.status === 'completado').length;
                const pct = Math.round((completed / secTasks.length) * 100);
                const isExpanded = expanded[section] !== false; // default open

                return (
                    <div key={section} className="card" style={{ marginBottom: '14px', overflow: 'hidden' }}>
                        <button onClick={() => toggle(section)}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px', cursor: 'pointer', border: 'none', backgroundColor: 'transparent', fontFamily: 'var(--font-family)', textAlign: 'left' }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                                    <h3 style={{ fontWeight: 700, fontSize: '15px' }}>{section}</h3>
                                    <span style={{ fontSize: '12px', padding: '2px 10px', borderRadius: '99px', fontWeight: 700, backgroundColor: pct === 100 ? '#d1fae5' : 'var(--bg-main)', color: pct === 100 ? '#065f46' : 'var(--text-secondary)' }}>
                                        {completed}/{secTasks.length} {pct === 100 ? '✅' : ''}
                                    </span>
                                </div>
                                <div style={{ height: '4px', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '180px' }}>
                                    <div style={{ height: '100%', width: `${pct}%`, backgroundColor: pct === 100 ? 'var(--primary)' : '#3b82f6', borderRadius: '4px', transition: '0.4s' }} />
                                </div>
                            </div>
                            {isExpanded ? <ChevronUp size={18} style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown size={18} style={{ color: 'var(--text-tertiary)' }} />}
                        </button>

                        {isExpanded && (
                            <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {secTasks.map(task => {
                                    const info = STEP_INFO[task.title] || {};
                                    const done = task.status === 'completado';
                                    const busy = updatingId === task.id;
                                    return (
                                        <div key={task.id} style={{ border: `1px solid ${done ? '#bbf7d0' : 'var(--border)'}`, borderRadius: '10px', backgroundColor: done ? '#f0fdf4' : 'white', overflow: 'hidden' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 16px' }}>
                                                <button onClick={() => handleCheck(task)} disabled={busy}
                                                    style={{ background: 'none', border: 'none', cursor: busy ? 'wait' : 'pointer', padding: 0, flexShrink: 0, opacity: busy ? 0.5 : 1 }}>
                                                    {done ? <CheckCircle2 size={20} style={{ color: 'var(--primary)' }} /> : <Circle size={20} style={{ color: '#cbd5e1' }} />}
                                                </button>
                                                <span style={{ fontSize: '18px', flexShrink: 0 }}>{info.emoji || '📌'}</span>
                                                <div style={{ flex: 1 }}>
                                                    <p style={{ fontWeight: 600, fontSize: '14px', textDecoration: done ? 'line-through' : 'none', color: done ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>
                                                        {task.title}
                                                    </p>
                                                    <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{task.section}</p>
                                                </div>
                                                <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '99px', fontWeight: 700, backgroundColor: task.priority === 'Alta' ? '#fee2e2' : task.priority === 'Media' ? '#fef9c3' : '#f1f5f9', color: task.priority === 'Alta' ? '#dc2626' : task.priority === 'Media' ? '#92400e' : '#64748b', flexShrink: 0 }}>
                                                    {task.priority}
                                                </span>
                                            </div>
                                            {info.tip && (
                                                <div style={{ padding: '8px 16px 12px 52px', backgroundColor: done ? '#f0fdf4' : 'var(--bg-main)', borderTop: '1px solid var(--border)' }}>
                                                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                                        💡 {info.tip}
                                                        {info.url && info.url !== '#' && (
                                                            <a href={info.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: '8px', color: 'var(--primary)', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                                                Ver recurso <ExternalLink size={11} />
                                                            </a>
                                                        )}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
