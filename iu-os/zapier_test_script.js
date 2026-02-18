// Zapier Code Step (JavaScript)
// Test hardcodeado para verificar la conexión con IU OS

// Configuración
const url = 'https://iu-rw9m.onrender.com/api/zapier-command';
const token = 'test-token-change-me'; // Tu ZAPIER_TOKEN
const deviceId = 'iu-desktop-main';   // Tu DEVICE_ID

// DATOS DE PRUEBA (HARDCODED)
const TEST_INSTRUCTION = "Crea una nota nueva en Notas que diga 'Test desde Zapier exitoso'";
const TEST_CONTEXT = "El usuario está probando la integración de Zapier y quiere verificar que el sistema responda.";

try {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            token: token,
            deviceId: deviceId,
            instruction: TEST_INSTRUCTION, // Forzamos la instrucción
            context: TEST_CONTEXT          // Forzamos el contexto
        })
    });

    const body = await response.json();

    // Resultado para Zapier
    return {
        success: true,
        serverResponse: body,
        sent: {
            instruction: TEST_INSTRUCTION,
            context: TEST_CONTEXT
        }
    };
} catch (error) {
    return { success: false, error: error.message };
}
