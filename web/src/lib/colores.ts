// Colores de estado del nivel de riesgo. Vive fuera de los componentes cliente para que
// también pueda usarse desde componentes de servidor (un export de un módulo "use client"
// llega al servidor como referencia, no como objeto).
export const COLOR_NIVEL: Record<string, string> = {
  ALTO: "#dc2626", MEDIO: "#d97706", BAJO: "#16a34a", DETECTADO: "#6d5bd0", SIN_PUNTAJE: "#9aa0ab",
};
