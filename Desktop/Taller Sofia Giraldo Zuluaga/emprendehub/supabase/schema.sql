-- ═══════════════════════════════════════════════════════════
-- EmprendeHub Colombia — Schema SQL para Supabase
-- Ejecutar en: https://supabase.com/dashboard/project/nbijolcytzinsncoonbn/sql/new
-- ═══════════════════════════════════════════════════════════

-- 1. Perfiles de emprendedor (extendido del user auth)
CREATE TABLE IF NOT EXISTS entrepreneur_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  full_name TEXT,
  city TEXT,
  phone TEXT,
  stage TEXT DEFAULT 'Idea' CHECK (stage IN ('Idea', 'Validación', 'Tracción', 'Crecimiento', 'Escalamiento')),
  sector TEXT,
  level TEXT DEFAULT 'Explorador',
  points INTEGER DEFAULT 0,
  progress INTEGER DEFAULT 0,
  completed_tasks INTEGER DEFAULT 0,
  completed_courses INTEGER DEFAULT 0,
  applied_programs INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Respuestas del diagnóstico
CREATE TABLE IF NOT EXISTS diagnostic_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  answers JSONB NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tareas de la ruta personalizada
CREATE TABLE IF NOT EXISTS route_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  section TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'en progreso', 'completado', 'bloqueado')),
  priority TEXT DEFAULT 'Media' CHECK (priority IN ('Alta', 'Media', 'Baja')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Oportunidades guardadas
CREATE TABLE IF NOT EXISTS saved_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  opportunity_id TEXT NOT NULL,
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, opportunity_id)
);

-- 5. Progreso en cursos
CREATE TABLE IF NOT EXISTS course_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  course_id TEXT NOT NULL,
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, course_id)
);

-- 6. Documentos del emprendedor
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  file_type TEXT,
  size_bytes BIGINT,
  status TEXT DEFAULT 'Borrador',
  storage_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Perfil público del negocio
CREATE TABLE IF NOT EXISTS business_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  stage TEXT,
  city TEXT,
  website TEXT,
  instagram TEXT,
  linkedin TEXT,
  contact_email TEXT,
  problem_solved TEXT,
  services TEXT,
  looking_for TEXT[],
  is_public BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Notificaciones
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  type TEXT DEFAULT 'info',
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════

ALTER TABLE entrepreneur_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagnostic_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Políticas: cada usuario solo ve y edita sus propios datos
CREATE POLICY "Users own their profile" ON entrepreneur_profiles
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users own their diagnostic" ON diagnostic_answers
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users own their tasks" ON route_tasks
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users own their saved opportunities" ON saved_opportunities
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users own their course progress" ON course_progress
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users own their documents" ON documents
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Public business profiles are visible to all" ON business_profiles
  FOR SELECT USING (is_public = TRUE OR auth.uid() = user_id);

CREATE POLICY "Users own their business profile" ON business_profiles
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users own their notifications" ON notifications
  FOR ALL USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════
-- AUTO-CREATE PROFILE ON SIGNUP
-- (Trigger que crea un perfil vacío cuando se registra un usuario)
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO entrepreneur_profiles (user_id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
