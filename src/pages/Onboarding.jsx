import React, { useState } from 'react';
import { Zap } from 'lucide-react';

export default function Onboarding({ session, onComplete, onSkip }) {
    const [choosing, setChoosing] = useState(false);
    const name = session?.user?.user_metadata?.full_name?.split(' ')[0] || 'Emprendedor';

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0f172a 0%, #065f46 50%, #0f172a 100%)', padding: '20px' }}>
            <div style={{ maxWidth: '540px', width: '100%' }}>
                {/* Logo */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '40px' }}>
                    <div style={{ width: '40px', height: '40px', backgroundColor: 'var(--primary)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Zap size={22} fill="white" color="white" />
                    </div>
                    <span style={{ fontWeight: 800, fontSize: '22px', color: 'white', letterSpacing: '-0.5px' }}>EmprendeHub Colombia</span>
                </div>

                <div style={{ backgroundColor: 'white', borderRadius: '20px', padding: '40px', textAlign: 'center', boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>
                    <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: '32px' }}>
                        👋
                    </div>
                    <h1 style={{ fontSize: '26px', fontWeight: 800, marginBottom: '8px', lineHeight: 1.2 }}>
                        ¡Bienvenido, {name}!
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '28px', lineHeight: 1.7, fontSize: '15px' }}>
                        EmprendeHub es tu sistema operativo inteligente para emprender en Colombia. Para darte una <strong>ruta personalizada</strong> y recomendaciones que realmente funcionen, necesitamos conocerte un poco.
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '28px' }}>
                        {[
                            { icon: '🎯', text: 'Ruta personalizada' },
                            { icon: '💡', text: 'Oportunidades relevantes' },
                            { icon: '📊', text: 'Seguimiento real' },
                        ].map((item, i) => (
                            <div key={i} style={{ padding: '14px 10px', backgroundColor: '#f0fdf4', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
                                <p style={{ fontSize: '24px', marginBottom: '6px' }}>{item.icon}</p>
                                <p style={{ fontSize: '12px', fontWeight: 600, color: '#065f46', lineHeight: 1.3 }}>{item.text}</p>
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <button className="btn btn-primary" onClick={() => onComplete('/diagnostico')} disabled={choosing}
                            style={{ padding: '16px', fontSize: '16px', fontWeight: 700, gap: '10px', borderRadius: '12px' }}>
                            🚀 Hacer diagnóstico ahora
                        </button>
                        <button onClick={() => onComplete('/dashboard')} disabled={choosing}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '14px', padding: '10px', fontFamily: 'var(--font-family)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                            Hacerlo después →
                        </button>
                    </div>
                    <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '16px' }}>El diagnóstico toma menos de 3 minutos y puedes actualizarlo cuando quieras.</p>
                </div>
            </div>
        </div>
    );
}
