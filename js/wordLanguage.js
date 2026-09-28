/*
 * Idioma de traducción de "Palabra del día" (el español siempre se
 * muestra aparte, ver dailyView.js): cada cuenta elige entre inglés
 * (por defecto, lo que se mostraba siempre) o portugués, desde la
 * pantalla de Configuración. Mismo patrón que js/palettes.js y
 * js/userGoal.js: un holder en memoria que userConfigSync.js carga con
 * setLanguage() al iniciar sesión y vuelve a "en" con clearLanguage()
 * al cerrar sesión (o sin sesión iniciada, igual que siempre).
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  const DEFAULT_LANGUAGE = "en";

  const LANGUAGES = {
    en: { code: "en", label: "Inglés", prefix: "EN", field: "significadoEn" },
    pt: { code: "pt", label: "Portugués", prefix: "PT", field: "significadoPt" },
  };

  let current = DEFAULT_LANGUAGE;

  function setLanguage(code) {
    current = LANGUAGES[code] ? code : DEFAULT_LANGUAGE;
  }

  function clearLanguage() {
    current = DEFAULT_LANGUAGE;
  }

  function getLanguage() {
    return current;
  }

  function getAll() {
    return Object.values(LANGUAGES);
  }

  // Texto ya armado ("EN: ..." / "PT: ...") para la segunda línea de
  // "Palabra del día", en el idioma elegido por la cuenta.
  function getTranslationLine(word) {
    const lang = LANGUAGES[current] || LANGUAGES[DEFAULT_LANGUAGE];
    return `${lang.prefix}: ${word[lang.field]}`;
  }

  ns.wordLanguage = { DEFAULT_LANGUAGE, setLanguage, clearLanguage, getLanguage, getAll, getTranslationLine };
})(window.Agenda);
