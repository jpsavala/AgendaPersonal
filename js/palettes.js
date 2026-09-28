/*
 * Paletas de colores elegibles por cuenta. Cada una define los mismos 8
 * roles que ya existían fijos en css/styles.css (:root): fondo,
 * superficie, texto principal, texto apagado, borde, y los 3 acentos
 * (principal — títulos/botones fuertes; secundario — cumplido/casillas;
 * terciario — frase/palabra del día). Mismo criterio en las 4:
 * minimalista, bordes finos, sin sombras ni degradados, buen contraste.
 *
 * apply(id) pisa esas variables en :root en tiempo de ejecución (no
 * toca el archivo CSS): sin sesión iniciada, o con la paleta "beige-
 * verde" (los valores de siempre), el resultado es idéntico al CSS
 * estático de toda la vida.
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  const DEFAULT_PALETTE_ID = "beige-verde";

  const PALETTES = {
    "beige-verde": {
      id: "beige-verde",
      nombre: "Beige y verde",
      vars: {
        bg: "#f3eedf",
        surface: "#eae2c8",
        textPrimary: "#1f2a1d",
        textMuted: "#6b6650",
        border: "#d8cfae",
        accentGreen: "#1b4332",
        accentGreenLight: "#4c7a5d",
        accentGold: "#a98b4a",
      },
    },
    "azul-noche": {
      id: "azul-noche",
      nombre: "Azul noche",
      vars: {
        bg: "#eef1f5",
        surface: "#dde5ee",
        textPrimary: "#182233",
        textMuted: "#5c6b7c",
        border: "#c6d1de",
        accentGreen: "#16324f",
        accentGreenLight: "#3d6b96",
        accentGold: "#b08d57",
      },
    },
    "terracota-piedra": {
      id: "terracota-piedra",
      nombre: "Terracota y piedra",
      vars: {
        bg: "#f2e9dd",
        surface: "#e8dcc8",
        textPrimary: "#3a2a1e",
        textMuted: "#7a6a58",
        border: "#d9c7ab",
        accentGreen: "#9c4a2e",
        accentGreenLight: "#7c8c6a",
        accentGold: "#b8862f",
      },
    },
    "gris-coral": {
      id: "gris-coral",
      nombre: "Gris y coral",
      vars: {
        bg: "#f4f4f3",
        surface: "#e7e7e5",
        textPrimary: "#232323",
        textMuted: "#6e6e6c",
        border: "#d4d4d1",
        accentGreen: "#333333",
        accentGreenLight: "#c9695c",
        accentGold: "#b99a54",
      },
    },
  };

  const CSS_VAR_MAP = {
    bg: "--bg",
    surface: "--surface",
    textPrimary: "--text-primary",
    textMuted: "--text-muted",
    border: "--border",
    accentGreen: "--accent-green",
    accentGreenLight: "--accent-green-light",
    accentGold: "--accent-gold",
  };

  function getAll() {
    return Object.values(PALETTES);
  }

  function get(id) {
    return PALETTES[id] || PALETTES[DEFAULT_PALETTE_ID];
  }

  function apply(id) {
    const palette = get(id);
    const root = document.documentElement.style;
    Object.entries(CSS_VAR_MAP).forEach(([key, cssVar]) => {
      root.setProperty(cssVar, palette.vars[key]);
    });
    // PWA: el color de la barra de estado/navegador sigue a la paleta
    // activa en vivo (el manifest.json en sí es estático — ver su
    // comentario — así que esto es lo que de verdad se nota día a día).
    const themeColorMeta = document.getElementById("theme-color-meta");
    if (themeColorMeta) themeColorMeta.setAttribute("content", palette.vars.accentGreen);
  }

  // Vuelve a los valores de siempre (equivalente a "beige-verde"): lo
  // usa userConfigSync al cerrar sesión, igual que clearUserSchedule
  // deja el horario como estaba antes de iniciarla.
  function reset() {
    apply(DEFAULT_PALETTE_ID);
  }

  ns.palettes = { getAll, get, apply, reset, DEFAULT_PALETTE_ID };
})(window.Agenda);
