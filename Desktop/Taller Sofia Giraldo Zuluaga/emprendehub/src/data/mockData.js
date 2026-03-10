export const DEFAULT_TASKS = [
    { section: 'Formalización', title: 'Registrar RUT en DIAN', priority: 'Alta' },
    { section: 'Formalización', title: 'Crear empresa (SAS o Persona Natural)', priority: 'Alta' },
    { section: 'Formalización', title: 'Registro en Cámara de Comercio', priority: 'Alta' },
    { section: 'Formalización', title: 'Abrir cuenta bancaria empresarial', priority: 'Media' },
    { section: 'Producto / Servicio', title: 'Definir propuesta de valor', priority: 'Alta' },
    { section: 'Producto / Servicio', title: 'Construir o definir MVP', priority: 'Alta' },
    { section: 'Producto / Servicio', title: 'Realizar 10 entrevistas de usuario', priority: 'Alta' },
    { section: 'Producto / Servicio', title: 'Iterar producto con feedback recibido', priority: 'Media' },
    { section: 'Mercadeo', title: 'Definir buyer persona', priority: 'Alta' },
    { section: 'Mercadeo', title: 'Crear perfiles en redes sociales', priority: 'Media' },
    { section: 'Mercadeo', title: 'Definir canales de adquisición', priority: 'Media' },
    { section: 'Mercadeo', title: 'Diseñar identidad de marca básica', priority: 'Baja' },
    { section: 'Financiero', title: 'Definir modelo de ingresos', priority: 'Alta' },
    { section: 'Financiero', title: 'Armar proyecciones financieras básicas', priority: 'Alta' },
    { section: 'Financiero', title: 'Calcular punto de equilibrio', priority: 'Media' },
    { section: 'Inversión', title: 'Elaborar pitch deck', priority: 'Media' },
    { section: 'Inversión', title: 'Identificar fuentes de financiación', priority: 'Media' },
    { section: 'Inversión', title: 'Aplicar a una convocatoria pública', priority: 'Baja' },
];

export const MOCK_OPPORTUNITIES = [
    {
        id: 'opp-1', title: 'Fondo Emprender SENA', organization: 'SENA',
        description: 'Capital semilla no reembolsable para emprendimientos en fase de ideación o validación con modelo de negocio definido.',
        type: 'Financiación', status: 'Abierta', stages: ['Idea', 'Validación'],
        amount: 'Hasta $180M COP', deadline: '15 Abr 2026', tags: ['Capital Semilla', 'Nacional', 'SENA'],
    },
    {
        id: 'opp-2', title: 'iNNpulsa Impulsa+', organization: 'iNNpulsa Colombia',
        description: 'Programa de escalamiento para startups con tracción y ventas comprobadas. Incluye capital, mentoría y conexión con mercados internacionales.',
        type: 'Aceleración', status: 'Abierta', stages: ['Tracción', 'Crecimiento'],
        amount: 'Hasta $400M COP + mentorías', deadline: '28 Mar 2026', tags: ['Escalamiento', 'Nacional', 'iNNpulsa'],
    },
    {
        id: 'opp-3', title: 'Apps.co Cohort 2026', organization: 'MinTIC',
        description: 'Programa de emprendimiento digital del MinTIC para startups tecnológicas en etapa temprana.',
        type: 'Aceleración', status: 'Abierta', stages: ['Idea', 'Validación'],
        amount: 'Servicios y acompañamiento', deadline: '10 May 2026', tags: ['Tecnología', 'Digital', 'MinTIC'],
    },
    {
        id: 'opp-4', title: 'Bancóldex Capital Productivo', organization: 'Bancóldex',
        description: 'Crédito blando para empresas en crecimiento con tasas preferenciales y períodos de gracia.',
        type: 'Crédito', status: 'Abierta', stages: ['Tracción', 'Crecimiento', 'Escalamiento'],
        amount: 'Desde $50M hasta $2.000M COP', deadline: 'Permanente', tags: ['Crédito', 'Nacional', 'Bancóldex'],
    },
    {
        id: 'opp-5', title: 'Colfuturo Becas Empresariales', organization: 'Colfuturo',
        description: 'Becas para fundadores que quieren especializarse en negocios internacionales o MBA.',
        type: 'Beca', status: 'Próximamente', stages: ['Crecimiento', 'Escalamiento'],
        amount: 'Hasta USD 40.000', deadline: '1 Jun 2026', tags: ['Formación', 'Internacional'],
    },
    {
        id: 'opp-6', title: 'Convocatoria Endeavor Colombia', organization: 'Endeavor',
        description: 'Selección de alto impacto para emprendedores con visión global. Acceso a red de mentores y co-inversión.',
        type: 'Red / Mentoría', status: 'Abierta', stages: ['Tracción', 'Crecimiento', 'Escalamiento'],
        amount: 'Red + inversión potencial', deadline: '20 Abr 2026', tags: ['Alto Impacto', 'Global', 'Endeavor'],
    },
];

export const MOCK_COURSES = [
    {
        id: 'course-1', title: 'Cómo validar tu idea de negocio', emoji: '🔍',
        description: 'Aprende a validar hipótesis, hacer entrevistas y construir un MVP efectivo.',
        category: 'Validación', duration: '2h 30min', lessons: 8, level: 'Básico',
        instructor: 'Ana Martínez · Co-fundadora Startups Bogotá',
        tags: ['MVP', 'Investigación', 'Lean Startup'], stages: ['Idea', 'Validación'],
    },
    {
        id: 'course-2', title: 'Finanzas para emprendedores', emoji: '💰',
        description: 'Proyecciones, flujo de caja, punto de equilibrio y métricas clave en lenguaje simple.',
        category: 'Finanzas', duration: '3h', lessons: 10, level: 'Intermedio',
        instructor: 'Carlos Ruiz · CFO Emprendehub',
        tags: ['Finanzas', 'Métricas', 'Proyecciones'], stages: ['Validación', 'Tracción'],
    },
    {
        id: 'course-3', title: 'Cómo armar un Pitch Deck ganador', emoji: '🚀',
        description: 'Estructura, diseño y presentación de tu deck para inversionistas ángel y VCs.',
        category: 'Inversión', duration: '1h 45min', lessons: 6, level: 'Intermedio',
        instructor: 'Laura Gómez · Inversionista Ángel',
        tags: ['Pitch', 'Inversión', 'Storytelling'], stages: ['Validación', 'Tracción'],
    },
    {
        id: 'course-4', title: 'Marketing digital con $0 de presupuesto', emoji: '📱',
        description: 'Estrategias orgánicas para crecer en redes, SEO básico y email marketing.',
        category: 'Marketing', duration: '2h 15min', lessons: 9, level: 'Básico',
        instructor: 'Daniela Torres · Growth Marketing',
        tags: ['Marketing', 'Redes Sociales', 'Growth'], stages: ['Idea', 'Validación', 'Tracción'],
    },
    {
        id: 'course-5', title: 'Formalización legal de tu empresa', emoji: '⚖️',
        description: 'SAS, Persona Natural, RUT, Cámara de Comercio. Todo lo que necesitas saber.',
        category: 'Legal', duration: '1h 20min', lessons: 5, level: 'Básico',
        instructor: 'Andrés Mejía · Abogado Corporativo',
        tags: ['Legal', 'Registro', 'Formal'], stages: ['Idea', 'Validación'],
    },
    {
        id: 'course-6', title: 'Cómo conseguir tus primeros 100 clientes', emoji: '🎯',
        description: 'Estrategias prácticas de ventas y adquisición de clientes para B2B y B2C.',
        category: 'Ventas', duration: '2h', lessons: 7, level: 'Intermedio',
        instructor: 'Sebastián López · Co-fundador SalesHack',
        tags: ['Ventas', 'Clientes', 'B2B', 'B2C'], stages: ['Validación', 'Tracción'],
    },
];

export const MOCK_PROVIDERS = [
    {
        id: 'prov-1', initials: 'BB', name: 'Agencia Brandify', category: 'Branding',
        description: 'Especialistas en creación de marca para startups digitales en etapa temprana.',
        city: 'Medellín', rating: 4.8, email: 'hola@brandify.co',
        services: ['Naming', 'Identidad Visual', 'Branding Estratégico'],
        badgeColor: '#fce7f3', badgeText: '#be185d',
    },
    {
        id: 'prov-2', initials: 'LA', name: 'LegalApp Colombia', category: 'Legal',
        description: 'Abogados para emprendedores. Constitución de SAS, registros de marca, y contratos.',
        city: 'Bogotá (Remoto)', rating: 4.9, email: 'legal@legalapp.co',
        services: ['Constitución de empresa', 'Registro de Marca', 'Contratos'],
        badgeColor: '#dbeafe', badgeText: '#1d4ed8',
    },
    {
        id: 'prov-3', initials: 'CF', name: 'ContaFlow', category: 'Contabilidad',
        description: 'Contabilidad y declaraciones para startups en todas las etapas.',
        city: 'Bogotá', rating: 4.7, email: 'info@contaflow.co',
        services: ['Contabilidad mensual', 'Declaraciones DIAN', 'Nómina'],
        badgeColor: '#d1fae5', badgeText: '#065f46',
    },
    {
        id: 'prov-4', initials: 'DW', name: 'DevWeb Colombia', category: 'Tecnología',
        description: 'Desarrollo de apps, MVPs y plataformas web para startups.',
        city: 'Cali (Remoto)', rating: 4.6, email: 'dev@devweb.co',
        services: ['Apps Web', 'MVPs', 'E-commerce', 'APIs'],
        badgeColor: '#ede9fe', badgeText: '#6d28d9',
    },
    {
        id: 'prov-5', initials: 'GH', name: 'GrowthHack Agency', category: 'Marketing',
        description: 'Growth marketing y performance para startups que quieren crecer rápido.',
        city: 'Bogotá', rating: 4.8, email: 'hello@growthhack.co',
        services: ['Paid Media', 'SEO', 'Email Marketing', 'Analytics'],
        badgeColor: '#fef9c3', badgeText: '#854d0e',
    },
    {
        id: 'prov-6', initials: 'MC', name: 'MentorCo Colombia', category: 'Mentoría',
        description: 'Red de mentores expertos en startups, inversión y escalamiento.',
        city: 'Nacional (Remoto)', rating: 5.0, email: 'mentores@mentorco.co',
        services: ['Mentoría 1:1', 'Workshops', 'Board Advisor'],
        badgeColor: '#ffedd5', badgeText: '#c2410c',
    },
];

export const STAGES = ['Idea', 'Validación', 'Tracción', 'Crecimiento', 'Escalamiento'];
export const CATEGORIES = ['Todos', 'Branding', 'Legal', 'Contabilidad', 'Tecnología', 'Marketing', 'Mentoría'];
