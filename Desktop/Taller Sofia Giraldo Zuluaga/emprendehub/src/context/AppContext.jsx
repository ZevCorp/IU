import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { DEFAULT_TASKS } from '../data/mockData';

const AppContext = createContext(null);

export const useApp = () => {
    const ctx = useContext(AppContext);
    if (!ctx) throw new Error('useApp must be used within AppProvider');
    return ctx;
};

export function AppProvider({ children, session }) {
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [diagnosticAnswers, setDiagnosticAnswers] = useState(null);
    const [diagnosticCompleted, setDiagnosticCompleted] = useState(false);
    const [tasks, setTasks] = useState([]);
    const [savedOpportunities, setSavedOpportunities] = useState([]);
    const [savedProviders, setSavedProviders] = useState([]);
    const [courseProgress, setCourseProgress] = useState({});
    const [businessProfile, setBusinessProfile] = useState(null);
    const [activityEvents, setActivityEvents] = useState([]);
    const [toast, setToast] = useState(null);

    useEffect(() => {
        if (session?.user) loadUserData(session.user.id);
    }, [session?.user?.id]);

    const showToast = useCallback((message, type = 'success') => {
        setToast({ message, type, id: Date.now() });
        setTimeout(() => setToast(null), 3500);
    }, []);

    const addActivity = useCallback((description, icon = '✅') => {
        if (!session?.user) return;
        const event = { id: Date.now(), description, icon, timestamp: new Date().toISOString() };
        setActivityEvents(prev => {
            const updated = [event, ...prev].slice(0, 50);
            localStorage.setItem(`events_${session.user.id}`, JSON.stringify(updated));
            return updated;
        });
    }, [session?.user?.id]);

    const loadUserData = async (userId) => {
        setLoading(true);
        try {
            // Profile
            const { data: profileData } = await supabase
                .from('entrepreneur_profiles').select('*').eq('user_id', userId).maybeSingle();
            if (profileData) setProfile(profileData);

            // Diagnostic
            const { data: diagData } = await supabase
                .from('diagnostic_answers').select('*').eq('user_id', userId)
                .order('created_at', { ascending: false }).limit(1).maybeSingle();
            if (diagData) { setDiagnosticAnswers(diagData.answers); setDiagnosticCompleted(true); }

            // Tasks
            const { data: tasksData } = await supabase
                .from('route_tasks').select('*').eq('user_id', userId).order('created_at');
            if (tasksData && tasksData.length > 0) {
                setTasks(tasksData);
            } else {
                await seedTasks(userId);
            }

            // Saved opportunities
            const { data: savedOpps } = await supabase
                .from('saved_opportunities').select('opportunity_id').eq('user_id', userId);
            if (savedOpps) setSavedOpportunities(savedOpps.map(r => r.opportunity_id));

            // Course progress
            const { data: courseData } = await supabase
                .from('course_progress').select('*').eq('user_id', userId);
            if (courseData) {
                const map = {};
                courseData.forEach(r => { map[r.course_id] = r.progress; });
                setCourseProgress(map);
            }

            // Business profile
            const { data: bizData } = await supabase
                .from('business_profiles').select('*').eq('user_id', userId).maybeSingle();
            if (bizData) setBusinessProfile(bizData);

            // Activity events from localStorage
            try {
                const stored = localStorage.getItem(`events_${userId}`);
                if (stored) setActivityEvents(JSON.parse(stored));
            } catch { }

        } catch (err) {
            console.error('loadUserData error:', err);
        } finally {
            setLoading(false);
        }
    };

    const seedTasks = async (userId) => {
        const toInsert = DEFAULT_TASKS.map(t => ({
            user_id: userId, section: t.section, title: t.title,
            status: 'pendiente', priority: t.priority,
        }));
        const { data } = await supabase.from('route_tasks').insert(toInsert).select();
        if (data) setTasks(data);
    };

    // ── Actions ──────────────────────────────────────────────────

    const updateProfile = async (updates) => {
        if (!session?.user) return { error: 'No session' };
        const { data, error } = await supabase
            .from('entrepreneur_profiles')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('user_id', session.user.id).select().single();
        if (!error && data) {
            setProfile(data);
            showToast('Perfil actualizado correctamente');
            addActivity('Perfil actualizado', '👤');
        }
        return { data, error };
    };

    const saveDiagnostic = async (answers) => {
        if (!session?.user) return { error: 'No session' };
        const stage = determineStage(answers);
        const { data, error } = await supabase
            .from('diagnostic_answers')
            .upsert({ user_id: session.user.id, answers, completed_at: new Date().toISOString() })
            .select().single();
        if (!error) {
            setDiagnosticAnswers(answers);
            setDiagnosticCompleted(true);
            const newPoints = (profile?.points || 0) + 50;
            await supabase.from('entrepreneur_profiles')
                .update({ stage, points: newPoints, updated_at: new Date().toISOString() })
                .eq('user_id', session.user.id);
            setProfile(prev => ({ ...prev, stage, points: newPoints }));
            showToast('¡Diagnóstico guardado! Tu ruta fue personalizada.');
            addActivity('Diagnóstico completado', '📋');
        }
        return { data, error };
    };

    const determineStage = (answers) => {
        const map = {
            idea: 'Idea', validando: 'Validación', vendiendo: 'Tracción',
            creciendo: 'Crecimiento', escalando: 'Escalamiento'
        };
        return map[answers?.etapa] || 'Idea';
    };

    const updateTask = async (taskId, status) => {
        const { data, error } = await supabase
            .from('route_tasks')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', taskId).select().single();
        if (!error && data) {
            setTasks(prev => prev.map(t => t.id === taskId ? data : t));
            if (status === 'completado') {
                const task = tasks.find(t => t.id === taskId);
                const newCompleted = tasks.filter(t => t.status === 'completado').length + 1;
                const newPoints = (profile?.points || 0) + 10;
                await supabase.from('entrepreneur_profiles')
                    .update({ completed_tasks: newCompleted, points: newPoints, updated_at: new Date().toISOString() })
                    .eq('user_id', session.user.id);
                setProfile(prev => ({ ...prev, completed_tasks: newCompleted, points: newPoints }));
                addActivity(`Tarea completada: ${task?.title || ''}`, '✅');
                showToast('+10 puntos ganados');
            }
        }
        return { data, error };
    };

    const toggleSaveOpportunity = async (opportunityId) => {
        if (!session?.user) return;
        const isSaved = savedOpportunities.includes(opportunityId);
        if (isSaved) {
            await supabase.from('saved_opportunities')
                .delete().eq('user_id', session.user.id).eq('opportunity_id', opportunityId);
            setSavedOpportunities(prev => prev.filter(id => id !== opportunityId));
            showToast('Oportunidad eliminada de guardados');
        } else {
            await supabase.from('saved_opportunities')
                .insert({ user_id: session.user.id, opportunity_id: opportunityId });
            setSavedOpportunities(prev => [...prev, opportunityId]);
            addActivity('Oportunidad guardada', '🔖');
            showToast('+5 puntos — Oportunidad guardada');
            const newPoints = (profile?.points || 0) + 5;
            await supabase.from('entrepreneur_profiles')
                .update({ points: newPoints }).eq('user_id', session.user.id);
            setProfile(prev => ({ ...prev, points: newPoints }));
        }
    };

    const toggleSaveProvider = (providerId) => {
        setSavedProviders(prev =>
            prev.includes(providerId) ? prev.filter(id => id !== providerId) : [...prev, providerId]
        );
    };

    const updateCourseProgress = async (courseId, progress) => {
        if (!session?.user) return;
        await supabase.from('course_progress')
            .upsert({ user_id: session.user.id, course_id: courseId, progress, updated_at: new Date().toISOString() });
        setCourseProgress(prev => ({ ...prev, [courseId]: progress }));
        if (progress >= 100) {
            const completedCount = Object.values({ ...courseProgress, [courseId]: progress }).filter(p => p >= 100).length;
            const newPoints = (profile?.points || 0) + 25;
            await supabase.from('entrepreneur_profiles')
                .update({ completed_courses: completedCount, points: newPoints }).eq('user_id', session.user.id);
            setProfile(prev => ({ ...prev, completed_courses: completedCount, points: newPoints }));
            addActivity('Curso completado', '🎓');
            showToast('+25 puntos — ¡Curso completado!');
        }
    };

    const saveBusinessProfile = async (bizData) => {
        if (!session?.user) return { error: 'No session' };
        const payload = { ...bizData, user_id: session.user.id };
        const { data, error } = await supabase
            .from('business_profiles').upsert(payload).select().single();
        if (!error && data) {
            setBusinessProfile(data);
            showToast('Perfil de negocio guardado');
            addActivity('Perfil de negocio actualizado', '🏢');
        }
        return { data, error };
    };

    // ── Computed ─────────────────────────────────────────────────
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'completado').length;
    const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    const completedCourses = Object.values(courseProgress).filter(p => p >= 100).length;
    const points = profile?.points || 0;
    const level = points < 100 ? 'Explorador' : points < 300 ? 'Emprendedor Activo' :
        points < 600 ? 'Constructor' : points < 1000 ? 'Validador' : 'Emprendedor Pro';
    const levelNum = points < 100 ? 1 : points < 300 ? 2 : points < 600 ? 3 : points < 1000 ? 4 : 5;
    const nextLevelPoints = [100, 300, 600, 1000, 9999][Math.min(levelNum - 1, 4)];
    const levelProgress = Math.min(100, Math.round((points / nextLevelPoints) * 100));

    const value = {
        profile, loading, diagnosticAnswers, diagnosticCompleted,
        tasks, savedOpportunities, savedProviders, courseProgress,
        businessProfile, activityEvents, toast,
        totalTasks, completedTasks, progressPercent, completedCourses,
        points, level, levelNum, nextLevelPoints, levelProgress,
        session,
        updateProfile, saveDiagnostic, updateTask,
        toggleSaveOpportunity, toggleSaveProvider,
        updateCourseProgress, saveBusinessProfile, addActivity, showToast,
    };

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
