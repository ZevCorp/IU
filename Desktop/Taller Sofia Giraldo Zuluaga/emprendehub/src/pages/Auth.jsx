import React, { useState } from 'react';
import { Mail, Lock, User, ArrowRight, AlertCircle } from 'lucide-react';
import { signIn, signUp } from '../lib/supabase';

const Auth = ({ onLogin }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [form, setForm] = useState({ name: '', email: '', password: '' });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (isLogin) {
                const { data, error } = await signIn(form.email, form.password);
                if (error) throw error;
                onLogin(data.session);
            } else {
                const { data, error } = await signUp(form.email, form.password, form.name);
                if (error) throw error;
                // After signup, show message or auto-login
                if (data.session) {
                    onLogin(data.session);
                } else {
                    setError('Revisa tu correo para confirmar tu cuenta antes de ingresar.');
                }
            }
        } catch (err) {
            const msg = err.message || 'Ocurrió un error. Intenta de nuevo.';
            if (msg.includes('Invalid login credentials')) {
                setError('Correo o contraseña incorrectos.');
            } else if (msg.includes('User already registered')) {
                setError('Este correo ya tiene una cuenta. Ingresa con tus datos.');
            } else {
                setError(msg);
            }
        } finally {
            setLoading(false);
        }
    };

    const update = (key, val) => setForm(f => ({ ...f, [key]: val }));

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--bg-sidebar)',
            backgroundImage: 'radial-gradient(ellipse at 70% 10%, rgba(16,185,129,0.15) 0%, transparent 50%)',
            padding: '24px'
        }}>
            <div className="card animate-fade-in" style={{ width: '100%', maxWidth: '420px', padding: '40px' }}>
                {/* Logo */}
                <div style={{ textAlign: 'center', marginBottom: '36px' }}>
                    <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--primary)', marginBottom: '4px', letterSpacing: '-1px' }}>
                        EmprendeHub
                    </div>
                    <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', fontWeight: 500 }}>
                        {isLogin ? 'Ingresa a tu ecosistema emprendedor' : 'Crea tu cuenta gratuita'}
                    </p>
                </div>

                {/* Error Message */}
                {error && (
                    <div style={{
                        display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 16px',
                        backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)',
                        marginBottom: '20px'
                    }}>
                        <AlertCircle size={16} style={{ color: '#dc2626', flexShrink: 0, marginTop: '1px' }} />
                        <p style={{ fontSize: '13px', color: '#dc2626' }}>{error}</p>
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {!isLogin && (
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">Nombre completo</label>
                            <div style={{ position: 'relative' }}>
                                <User size={17} style={{ position: 'absolute', left: '13px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="Tu nombre"
                                    value={form.name}
                                    onChange={e => update('name', e.target.value)}
                                    style={{ paddingLeft: '40px' }}
                                    required={!isLogin}
                                />
                            </div>
                        </div>
                    )}

                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Correo electrónico</label>
                        <div style={{ position: 'relative' }}>
                            <Mail size={17} style={{ position: 'absolute', left: '13px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                            <input
                                type="email"
                                className="form-input"
                                placeholder="correo@startup.co"
                                value={form.email}
                                onChange={e => update('email', e.target.value)}
                                style={{ paddingLeft: '40px' }}
                                required
                            />
                        </div>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Contraseña</label>
                        <div style={{ position: 'relative' }}>
                            <Lock size={17} style={{ position: 'absolute', left: '13px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                            <input
                                type="password"
                                className="form-input"
                                placeholder="Mínimo 6 caracteres"
                                value={form.password}
                                onChange={e => update('password', e.target.value)}
                                style={{ paddingLeft: '40px' }}
                                required
                                minLength={6}
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: '100%', padding: '14px', fontSize: '15px', marginTop: '8px', opacity: loading ? 0.7 : 1 }}
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <div style={{ width: '18px', height: '18px', border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid white', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                                Procesando...
                            </>
                        ) : (
                            <>
                                {isLogin ? 'Ingresar' : 'Crear cuenta'} <ArrowRight size={18} />
                            </>
                        )}
                    </button>
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </form>

                {isLogin && (
                    <div style={{ textAlign: 'center', marginTop: '12px' }}>
                        <button className="btn-ghost" style={{ fontSize: '13px', color: 'var(--primary)' }}>
                            ¿Olvidaste tu contraseña?
                        </button>
                    </div>
                )}

                <div style={{ marginTop: '24px', textAlign: 'center', borderTop: '1px solid var(--border)', paddingTop: '20px' }}>
                    <button
                        className="btn-ghost"
                        style={{ fontSize: '14px', color: 'var(--text-secondary)' }}
                        onClick={() => { setIsLogin(!isLogin); setError(''); }}
                    >
                        {isLogin ? '¿No tienes cuenta? ' : '¿Ya tienes cuenta? '}
                        <span style={{ color: 'var(--primary)', fontWeight: 700 }}>
                            {isLogin ? 'Regístrate gratis' : 'Ingresa aquí'}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Auth;
