import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, ChevronLeft, ChevronRight, CheckCircle2, Edit } from 'lucide-react';
import { useApp } from '../context/AppContext';

const QUESTIONS = [
    {
        id: 'etapa', label: '¿En qué etapa se encuentra tu emprendimiento?',
        options: [
            { value: 'idea', label: '💡 Tengo una idea', desc: 'Aún estoy explorando y definiendo el concepto' },
            { value: 'validando', label: '🔍 Estoy validando', desc: 'Tengo MVP o prototipo, hablo con clientes' },
            { value: 'vendiendo', label: '💰 Ya genero ingresos', desc: 'Tengo clientes que me pagan regularmente' },
            { value: 'creciendo', label: '📈 Estoy creciendo', desc: 'Tengo equipo, escalando operaciones' },
            { value: 'escalando', label: '🚀 Escalando', desc: 'Busco internacionalización o rondas grandes' },
        ]
    },
    {
        id: 'formalizacion', label: '¿Qué tan formalizado está tu negocio?',
        options: [
            { value: 'ninguna', label: '❌ No está formalizado', desc: 'Sin RUT ni matrícula mercantil aún' },
            { value: 'en-proceso', label: '🔄 En proceso', desc: 'Iniciando trámites de formalización' },
            { value: 'parcial', label: '⚠️ Parcialmente', desc: 'Algunos trámites completados' },
            { value: 'completa', label: '✅ Completamente formal', desc: 'RUT, Cámara de Comercio, todo listo' },
        ]
    },
    {
        id: 'necesidad', label: '¿Cuál es tu principal necesidad ahora mismo?',
        options: [
            { value: 'capital', label: '💰 Capital / Financiación', desc: 'Necesito fondos para crecer' },
            { value: 'validacion', label: '🧪 Validación de producto', desc: 'Debo confirmar si mi idea funciona' },
            { value: 'clientes', label: '👥 Conseguir más clientes', desc: 'Necesito crecer en ventas' },
            { value: 'equipo', label: '🤝 Armar un equipo', desc: 'Necesito socios o colaboradores' },
            { value: 'mentoria', label: '🧭 Mentoría y guía', desc: 'Necesito orientación estratégica' },
        ]
    },
    {
        id: 'equipo', label: '¿Tienes equipo de trabajo?',
        options: [
            { value: 'solo', label: '👤 Solo por ahora', desc: 'Soy founder individual' },
            { value: 'cofounders', label: '👥 1-2 cofundadores', desc: 'Tenemos equipo fundador' },
            { value: 'pequeno', label: '🏢 3-5 personas', desc: 'Pequeño equipo operativo' },
            { value: 'mediano', label: '🏭 Más de 5 personas', desc: 'Equipo establecido' },
        ]
    },
    {
        id: 'ingresos', label: '¿Cuánto genera tu negocio actualmente?',
        options: [
            { value: 'cero', label: '🌱 Aún no genera ingresos', desc: 'En fase pre-revenue' },
            { value: 'bajo', label: '📊 Hasta $5M COP/mes', desc: 'Primeras ventas' },
            { value: 'medio', label: '📈 $5M - $20M COP/mes', desc: 'Crecimiento temprano' },
            { value: 'alto', label: '🚀 Más de $20M COP/mes', desc: 'Tracción comprobada' },
        ]
    },
    {
        id: 'recursos', label: '¿Qué recursos te ayudarían más?',
        options: [
            { value: 'herramientas', label: '🛠️ Herramientas y plantillas', desc: 'Templates, canvas, modelos' },
            { value: 'red', label: '🌐 Red de contactos', desc: 'Connexiones, alianzas, socios' },
            { value: 'financiacion', label: '💸 Acceso a financiación', desc: 'Fondos, créditos, convocatorias' },
            { value: 'formación', label: '📚 Formación y cursos', desc: 'Aprende habilidades clave' },
        ]
    },
];

export default function Diagnostic() {
    const { diagnosticAnswers, diagnosticCompleted, saveDiagnostic } = useApp();
    const navigate = useNavigate();
    const [step, setStep] = useState(0);
    const [answers, setAnswers] = useState(diagnosticAnswers || {});
    const [saving, setSaving] = useState(false);
    const [showEdit, setShowEdit] = useState(false);
    const [done, setDone] = useState(diagnosticCompleted && !showEdit);

    const current = QUESTIONS[step];
    const progress = Math.round(((step) / QUESTIONS.length) * 100);
    const answeredAll = QUESTIONS.every(q => answers[q.id]);

    const selectOption = (val) => {
        const updated = { ...answers, [current.id]: val };
        setAnswers(updated);
        if (step < QUESTIONS.length - 1) {
            setTimeout(() => setStep(s => s + 1), 300);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        await saveDiagnostic(answers);
        setSaving(false);
        setDone(true);
        setShowEdit(false);
    };

    const handleEdit = () => { setShowEdit(true); setDone(false); setStep(0); };

    if (done) {
        const stageMap = { idea: 'Idea', validando: 'Validación', vendiendo: 'Tracción', creciendo: 'Crecimiento', escalando: 'Escalamiento' };
        const stage = stageMap[answers.etapa] || 'Idea';
        return (
            <div className="animate-fade-in" style={{ padding: '28px', maxWidth: '700px', margin: '0 auto' }}>
                <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
                    <div style={{ fontSize: '60px', marginBottom: '16px' }}>🎉</div>
                    <h1 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '8px' }}>¡Diagnóstico completado!</h1>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
                        Basado en tus respuestas, tu etapa es <strong style={{ color: 'var(--primary)' }}>{stage}</strong>.
                        Te hemos generado una ruta y recomendaciones personalizadas.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px', textAlign: 'left' }}>
                        {QUESTIONS.map(q => (
                            <div key={q.id} style={{ padding: '12px 16px', backgroundColor: 'var(--bg-main)', borderRadius: '10px' }}>
                                <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: '4px' }}>{q.label.replace('¿', '').replace('?', '')}</p>
                                <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--primary)' }}>
                                    {q.options.find(o => o.value === answers[q.id])?.label || '—'}
                                </p>
                            </div>
                        ))}
                    </div>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                        <button className="btn btn-secondary" onClick={handleEdit} style={{ gap: '8px' }}>
                            <Edit size={16} /> Actualizar respuestas
                        </button>
                        <button className="btn btn-primary" onClick={() => navigate('/ruta')} style={{ gap: '8px' }}>
                            Ver mi ruta personalizada →
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="animate-fade-in" style={{ padding: '28px', maxWidth: '680px', margin: '0 auto' }}>
            <div style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <ClipboardList size={22} style={{ color: 'var(--primary)' }} />
                    <h1 style={{ fontWeight: 800, fontSize: '22px' }}>Diagnóstico Emprendedor</h1>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ flex: 1, height: '6px', backgroundColor: 'var(--border)', borderRadius: '6px' }}>
                        <div style={{ height: '100%', width: `${progress}%`, backgroundColor: 'var(--primary)', borderRadius: '6px', transition: '0.4s ease' }} />
                    </div>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--primary)', whiteSpace: 'nowrap' }}>
                        {step + 1} / {QUESTIONS.length}
                    </span>
                </div>
            </div>

            <div className="card animate-fade-in" key={step} style={{ padding: '32px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '24px', lineHeight: 1.4 }}>{current.label}</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {current.options.map(opt => {
                        const selected = answers[current.id] === opt.value;
                        return (
                            <button key={opt.value} onClick={() => selectOption(opt.value)}
                                style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', borderRadius: '10px', border: `2px solid ${selected ? 'var(--primary)' : 'var(--border)'}`, backgroundColor: selected ? '#f0fdf4' : 'white', cursor: 'pointer', textAlign: 'left', transition: 'var(--transition)', fontFamily: 'var(--font-family)' }}
                                onMouseEnter={e => { if (!selected) { e.currentTarget.style.borderColor = 'var(--primary-light)'; e.currentTarget.style.backgroundColor = '#f9fafb'; } }}
                                onMouseLeave={e => { if (!selected) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.backgroundColor = 'white'; } }}>
                                {selected ? <CheckCircle2 size={20} style={{ color: 'var(--primary)', flexShrink: 0 }} /> : <div style={{ width: '20px', height: '20px', borderRadius: '50%', border: '2px solid var(--border)', flexShrink: 0 }} />}
                                <div>
                                    <p style={{ fontWeight: 700, fontSize: '14px' }}>{opt.label}</p>
                                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{opt.desc}</p>
                                </div>
                            </button>
                        );
                    })}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px' }}>
                    <button className="btn btn-secondary" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0} style={{ gap: '6px' }}>
                        <ChevronLeft size={16} /> Anterior
                    </button>
                    {step < QUESTIONS.length - 1 ? (
                        <button className="btn btn-primary" onClick={() => setStep(s => s + 1)} disabled={!answers[current.id]} style={{ gap: '6px' }}>
                            Siguiente <ChevronRight size={16} />
                        </button>
                    ) : (
                        <button className="btn btn-primary" onClick={handleSave} disabled={!answeredAll || saving} style={{ gap: '6px' }}>
                            {saving ? 'Guardando...' : '¡Finalizar diagnóstico!'} {!saving && '🎉'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
