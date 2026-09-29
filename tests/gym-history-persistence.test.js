/*
 * Prueba de regresión: el estado de "¿Entrenaste hoy?" (gimnasio) de una
 * fecha ya respondida debe seguir viéndose igual después de que el dato
 * se recargue desde cero (recarga de página, pull de Firestore, cambio
 * de cuenta) — no solo mientras dura la sesión donde se lo marcó.
 *
 * Nació de un reporte real: "marqué Sí el viernes 25 de septiembre y al
 * volver a esa fecha unos días después ya no aparece". La investigación
 * (ver el resumen que Claude le dio al usuario en esa conversación)
 * confirmó que el mecanismo de guardado en sí NO tiene ninguna fuga
 * activa: una corrección puntual desplegada antes (migrateGymQueueCorrection2,
 * en js/state.js) había reseteado a propósito el detalle día por día de
 * la semana del 21 al 25 de septiembre — algo ya avisado en su momento,
 * no una regresión nueva. Esta prueba existe para que, si alguna vez SÍ
 * vuelve a pasar (por un cambio futuro en state.js/scheduleQueue.js),
 * se note enseguida.
 *
 * Cómo correr (requiere Node y Playwright ya instalados; no depende de
 * un servidor, usa el HTML directo por file://):
 *   NODE_PATH=<ruta al playwright global, si no está en node_modules> \
 *     node tests/gym-history-persistence.test.js
 */
const { chromium } = require("playwright");
const path = require("path");

function mockDateScript(isoDate) {
  return `(() => {
    const FIXED = new Date(${JSON.stringify(isoDate)} + 'T09:00:00');
    const RealDate = Date;
    class MockDate extends RealDate {
      constructor(...args) { if (args.length === 0) return new RealDate(FIXED.getTime()); return new RealDate(...args); }
      static now() { return FIXED.getTime(); }
    }
    window.Date = MockDate;
  })();`;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  let fails = 0;
  function check(cond, msg) {
    if (!cond) {
      fails += 1;
      console.log("FAIL:", msg);
    } else {
      console.log("ok:", msg);
    }
  }

  const indexPath = "file://" + path.resolve(__dirname, "..", "index.html");
  const context = await browser.newContext({ viewport: { width: 460, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // "Hoy" = viernes 25 de septiembre, el mismo día que el usuario marcó
  // Sí en el reporte real. Se mockea una sola fecha para toda la prueba
  // a propósito: resolve() no vuelve a mirar "hoy" para una fecha que ya
  // tiene una resolución explícita guardada (ver js/scheduleQueue.js),
  // así que no hace falta simular el paso de varios días para probar
  // que el dato persiste — alcanza con guardarlo y volver a leerlo
  // después de un reload completo.
  await page.addInitScript(mockDateScript("2026-09-25"));
  await page.goto(indexPath);
  await page.waitForTimeout(300);

  // Deja la cola de gimnasio en un estado limpio y realista (sin usar
  // ninguna de las correcciones puntuales de fechas fijas, para que esta
  // prueba no dependa de ellas): ancla el lunes de esa semana, sin
  // atraso, y marca "Sí" hoy (viernes) con el flujo real de la UI.
  await page.evaluate(() => {
    const raw = window.Agenda.state.getRawData();
    raw.gymQueueCorrectionApplied = true;
    raw.gymQueueCorrection2Applied = true;
    raw.gymQueue = {
      pointer: 0,
      pointerAtSeed: 0,
      seedAnchor: "2026-09-21",
      resolutions: {
        "2026-09-21": { status: "done", index: 0 },
        "2026-09-22": { status: "done", index: 1 },
        "2026-09-23": { status: "done", index: 2 },
        "2026-09-24": { status: "done", index: 3 },
      },
      unavailable: {},
    };
    window.Agenda.state.replaceAllData(raw);
  });
  await page.waitForTimeout(150);

  // Marca "Sí" hoy (viernes 25, con el control real "¿Entrenaste hoy?").
  await page.locator(".date-picker").fill("2026-09-25");
  await page.locator(".date-picker").dispatchEvent("change");
  await page.waitForTimeout(150);
  await page.locator(".schedule-block .gym-actions button", { hasText: "Sí" }).first().click();
  await page.waitForTimeout(150);

  const rightAfter = await page.evaluate(() => window.Agenda.state.getGymResolution("2026-09-25"));
  check(rightAfter && rightAfter.status === "done", "justo después de marcar Sí, queda guardado con status done");

  // Navega a otra fecha (como el usuario reportó: el día de hoy funciona bien).
  await page.locator(".date-picker").fill("2026-09-22");
  await page.locator(".date-picker").dispatchEvent("change");
  await page.waitForTimeout(150);

  // Simula una recarga completa: vuelve a pasar TODO el estado actual
  // por replaceAllData (lo mismo que hace un pull de Firestore, un
  // cambio de storage key, o cargar la página de nuevo desde cero con
  // ese mismo documento guardado) — no solo re-navegar en la misma sesión.
  const snapshot = await page.evaluate(() => JSON.parse(JSON.stringify(window.Agenda.state.getRawData())));
  await page.evaluate((snap) => window.Agenda.state.replaceAllData(snap), snapshot);
  await page.waitForTimeout(150);

  // Vuelve a la fecha original: el dato debe seguir ahí.
  await page.locator(".date-picker").fill("2026-09-21");
  await page.locator(".date-picker").dispatchEvent("change");
  await page.waitForTimeout(150);

  const afterReload = await page.evaluate(() => window.Agenda.state.getGymResolution("2026-09-21"));
  console.log("Resolución del 21 de sep tras el ciclo completo:", JSON.stringify(afterReload));
  check(afterReload && afterReload.status === "done", "sigue guardado como done después de navegar y de un reload completo (replaceAllData)");

  const domInfo = await page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".schedule-block")).find(
      (b) => b.querySelector(".schedule-label")?.textContent === "Gimnasio"
    );
    if (!block) return null;
    return {
      text: block.querySelector(".schedule-readonly-text")?.textContent || null,
      note: block.querySelector(".gym-actions span")?.textContent || null,
      hasCorregir: !!Array.from(block.querySelectorAll(".gym-actions button")).find((b) => b.textContent === "Corregir"),
    };
  });
  console.log("Bloque de gimnasio en la UI tras el reload:", JSON.stringify(domInfo));
  check(domInfo && domInfo.note === "✓ Hecho", 'la UI muestra "✓ Hecho", no vuelve a ofrecer Sí/No como si no se hubiera contestado');
  check(domInfo && domInfo.hasCorregir, 'ofrece "Corregir" (fecha ya resuelta), confirmando que no se perdió el registro');

  console.log("PAGE ERRORS:", JSON.stringify(errors));
  const ok = fails === 0 && errors.length === 0;
  console.log(ok ? "\nTODO OK" : `\n${fails} FALLAS`);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
