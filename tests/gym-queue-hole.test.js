/*
 * Prueba del bug reportado: el bloque de Gimnasio del lunes 2 de nov
 * de 2026 aparecía como campo de texto libre en la Diaria, sin
 * Hecho/Corregir/Registrar.
 *
 * Causa real (ver el diagnóstico): "Corregir" (o simplemente seguir
 * usando la app normalmente) sobre una fecha que nunca había tenido
 * su propia resolución (auto-congelada, ver resolve() en
 * js/scheduleQueue.js), sin haber pasado antes por los días hábiles
 * de en medio, deja esos días de en medio con un "hueco": el ancla de
 * la simulación (ver antes anchorOf) era "el día después de la
 * resolución explícita MÁS RECIENTE de toda la cola", así que una
 * fecha posterior ya resuelta "tapaba" la consulta de cualquier fecha
 * anterior sin su propia resolución — resolve() devolvía null ahí en
 * vez de la sesión que le toca, y la Diaria caía al campo de texto
 * libre de siempre (ver js/state.js: getDayBlocks, solo entra a
 * fixed:true cuando getGymResolution no es null).
 *
 * Arreglo: js/scheduleQueue.js: resolve() ahora calcula el punto de
 * partida de la simulación LOCAL a cada fecha consultada (la
 * resolución explícita más reciente que sea <= esa fecha, no la más
 * reciente de toda la cola) — sin escribir ni "fijar" nada, para que
 * corregir una fecha anterior siga pudiendo reproyectar lo posterior
 * con normalidad.
 *
 * Esta prueba siembra el Bloque 6 con el patrón real que produce el
 * hueco (20 y 21 de oct hechos; 5 de nov resuelto sin haber pasado
 * por el 22 de oct al 4 de nov) y confirma:
 * - El 2 de nov (y el resto del rango 3-16 nov) queda coherente con
 *   el puntero, con Hecho/Corregir/Registrar, nunca campo de texto
 *   libre.
 * - Marcar el 2 de nov como hecho reproyectando el 5 de nov (ya
 *   cumplido, mismo índice) avisa con una vista previa — nunca lo pisa
 *   en silencio (la prueba dedicada a ese flujo es
 *   tests/gym-queue-reproject.test.js).
 * - Marcar una fecha afectada por el hueco como hecha retroactivamente
 *   funciona y reproyecta lo posterior.
 * - No toca el Bloque 5 ni los registros ya cumplidos.
 * - Persiste tras recargar.
 *
 * Cómo correr (requiere Node y Playwright ya instalados):
 *   node tests/gym-queue-hole.test.js
 */
const { chromium } = require("playwright");
const path = require("path");

function mockDateScript(isoDateTime) {
  return `(() => {
    const FIXED = new Date(${JSON.stringify(isoDateTime)});
    const RealDate = Date;
    class MockDate extends RealDate {
      constructor(...args) { if (args.length === 0) return new RealDate(FIXED.getTime()); return new RealDate(...args); }
      static now() { return FIXED.getTime(); }
    }
    window.Date = MockDate;
  })();`;
}

const indexPath = "file://" + path.resolve(__dirname, "..", "index.html");

let fails = 0;
function check(cond, msg) {
  if (!cond) {
    fails += 1;
    console.log("FAIL:", msg);
  } else {
    console.log("ok:", msg);
  }
}

async function newPage(browser, viewport) {
  const context = await browser.newContext({ viewport: viewport || { width: 460, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // "Hoy" = 10 de nov de 2026, para que el 2-9 de nov queden en el
  // pasado (auto-congelados/corregibles) y el bug se reproduzca igual
  // que en el reporte real (visto unos días después).
  await page.addInitScript(mockDateScript("2026-11-10T10:00:00"));
  return { context, page, errors };
}

// Siembra el Bloque 6 con el patrón exacto que produce el hueco: 20 y
// 21 de oct marcados "Sí" (hechos, índices 0 y 1), y el 5 de nov
// resuelto "Sí" con índice 2 — SIN que nada del 22 de oct al 4 de nov
// tenga su propia resolución (quedaron sin abrir la Diaria esos
// días, como "no abrí la app casi dos semanas y seguí el 5 de nov").
// Antes del arreglo, esto deja resolve() devolviendo null para todo
// ese tramo.
async function seedBrokenQueue(page) {
  await page.evaluate(() => {
    const raw = window.Agenda.state.getRawData();
    const block = raw.gymBlocks && raw.gymBlocks[6];
    if (!block) throw new Error("Bloque 6 no está sembrado");
    block.resolutions = {
      "2026-10-20": { status: "done", index: 0 },
      "2026-10-21": { status: "done", index: 1 },
      "2026-11-05": { status: "done", index: 2 },
    };
    block.pointer = 3;
    window.Agenda.state.replaceAllData(raw);
  });
}

async function gymBlockInfo(page) {
  return page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".schedule-block")).find(
      (b) => b.querySelector(".schedule-label")?.textContent?.includes("Gimnasio")
    );
    if (!block) return null;
    return {
      hasFreeTextInput: !!block.querySelector('input[type="text"].schedule-input'),
      readonlyText: block.querySelector(".schedule-readonly-text")?.textContent || null,
      gymActionsText: block.querySelector(".gym-actions span")?.textContent || null,
      hasCorregir: !!Array.from(block.querySelectorAll(".gym-actions button, .gym-actions .link-btn")).find(
        (b) => b.textContent === "Corregir"
      ),
      hasRegistrar: !!block.querySelector(".gym-registrar-btn"),
    };
  });
}

async function goToDate(page, dateStr) {
  await page.locator(".date-picker").fill(dateStr);
  await page.locator(".date-picker").dispatchEvent("change");
  await page.waitForTimeout(150);
}

async function clickCorregir(page) {
  await page.locator(".schedule-block .gym-actions .link-btn", { hasText: "Corregir" }).first().click();
  await page.waitForTimeout(100);
}

async function clickSiNo(page, label) {
  await page.locator(".schedule-block .gym-actions button", { hasText: label }).first().click();
  await page.waitForTimeout(150);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });

  // ---------- Diagnóstico reproducido + el bug queda arreglado ----------
  {
    const { context, page, errors } = await newPage(browser);
    await page.goto(indexPath);
    await page.waitForTimeout(250);
    await seedBrokenQueue(page);

    const resolutionNov2Raw = await page.evaluate(() => window.Agenda.state.getGymResolution("2026-11-02"));
    check(resolutionNov2Raw !== null, "getGymResolution ya no devuelve null para el 2 de nov (el hueco quedó arreglado)");
    check(
      resolutionNov2Raw && resolutionNov2Raw.status === "skipped",
      `el 2 de nov queda "No realizada" (auto-congelado, corregible) — status: ${resolutionNov2Raw && resolutionNov2Raw.status}`
    );

    await goToDate(page, "2026-11-02");
    const info = await gymBlockInfo(page);
    console.log("Bloque de gimnasio del 2 de nov:", JSON.stringify(info));
    check(info && !info.hasFreeTextInput, "el 2 de nov NO muestra el campo de texto libre");
    check(info && info.hasCorregir, "el 2 de nov muestra el botón Corregir");
    check(info && info.gymActionsText === "No realizada", 'el 2 de nov muestra "No realizada" (día pasado, auto-congelado)');
    check(info && info.hasRegistrar, "el 2 de nov muestra Registrar");

    // Marcar el 2 de nov como hecho reproyectaría el 5 de nov (ya
    // cumplido) a otra sesión válida — no es un choque irresoluble
    // (ver js/scheduleQueue.js: editResolution), así que avisa con una
    // vista previa y pregunta en vez de bloquear para siempre.
    // Cancelando, no cambia nada.
    let dialogMessage = null;
    page.once("dialog", (dialog) => {
      dialogMessage = dialog.message();
      dialog.dismiss();
    });
    await clickCorregir(page);
    await clickSiNo(page, "Sí");

    check(!!dialogMessage && dialogMessage.includes("reproyectar"), "avisa con una vista previa (no un bloqueo ciego) en vez de rechazar");
    const nov5Untouched = await page.evaluate(() => window.Agenda.state.getGymResolution("2026-11-05"));
    check(nov5Untouched && nov5Untouched.status === "done", "el 5 de nov (ya cumplido) no se tocó al cancelar");
    const nov2StillPending = await page.evaluate(() => window.Agenda.state.getGymResolution("2026-11-02"));
    check(nov2StillPending && nov2StillPending.status === "skipped", "el 2 de nov tampoco quedó a medio escribir al cancelar");

    console.log("Diagnóstico — errores de página:", JSON.stringify(errors));
    check(errors.length === 0, "Diagnóstico: sin errores de JS");
    await context.close();
  }

  // ---------- Marcar hecho retroactivamente (sin choque) + reproyección ----------
  // Mismo tramo sin resolver (22 oct al 1 nov, afectado por el hueco
  // cuando SÍ hay una fecha posterior ya resuelta, ver la prueba de
  // arriba) pero sin ninguna otra fecha que compita por el mismo
  // índice: así se puede marcar el 2 de nov como hecho de una, sin
  // tener que resolver antes un choque con otra fecha ya cumplida.
  {
    const { context, page, errors } = await newPage(browser);
    await page.goto(indexPath);
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const raw = window.Agenda.state.getRawData();
      const block = raw.gymBlocks[6];
      block.resolutions = {
        "2026-10-20": { status: "done", index: 0 },
        "2026-10-21": { status: "done", index: 1 },
      };
      block.pointer = 2;
      window.Agenda.state.replaceAllData(raw);
    });

    await goToDate(page, "2026-11-02");
    await clickCorregir(page);
    await clickSiNo(page, "Sí");

    const afterMark = await gymBlockInfo(page);
    check(afterMark && afterMark.gymActionsText === "✓ Hecho", "marcar Hecho retroactivamente funciona una vez sin choque");

    const resolutionNov2 = await page.evaluate(() => window.Agenda.state.getGymResolution("2026-11-02"));
    check(resolutionNov2 && resolutionNov2.status === "done", "queda guardado como done en el dato");

    // El puntero avanza y lo posterior se reproyecta: el 6 de nov
    // (antes "Glúteo/Femoral S1" por el hueco) pasa a "Tracción S1".
    const resolutionNov6 = await page.evaluate(() => window.Agenda.state.getGymResolution("2026-11-06"));
    console.log("Nov6 tras reproyectar:", JSON.stringify(resolutionNov6));
    check(
      resolutionNov6 && resolutionNov6.session === "Tracción S1",
      `el 6 de nov reproyecta "Tracción S1" (encontrado: ${resolutionNov6 && resolutionNov6.session})`
    );

    console.log("Retroactivo — errores de página:", JSON.stringify(errors));
    check(errors.length === 0, "Retroactivo: sin errores de JS");
    await context.close();
  }

  // ---------- Tabla fecha -> sesión del 3 al 16 de nov, coherente ----------
  {
    const { context, page, errors } = await newPage(browser);
    await page.goto(indexPath);
    await page.waitForTimeout(250);
    await seedBrokenQueue(page);

    const table = await page.evaluate(() => {
      const out = {};
      for (let d = 3; d <= 16; d += 1) {
        const dateStr = `2026-11-${String(d).padStart(2, "0")}`;
        out[dateStr] = window.Agenda.state.getGymResolution(dateStr);
      }
      return out;
    });
    console.log("Tabla fecha -> sesión (3-16 nov):", JSON.stringify(table, null, 2));

    const allResolved = Object.entries(table).every(([dateStr, r]) => {
      const wd = new Date(dateStr + "T00:00:00Z").getUTCDay();
      const isWeekendDay = wd === 0 || wd === 6;
      return isWeekendDay || r !== null;
    });
    check(allResolved, "todos los días laborales del 3 al 16 de nov resuelven una sesión (ninguno null)");

    console.log("Tabla — errores de página:", JSON.stringify(errors));
    check(errors.length === 0, "Tabla: sin errores de JS");
    await context.close();
  }

  // ---------- No toca el Bloque 5, ni lo ya cumplido ----------
  {
    const { context, page, errors } = await newPage(browser);
    await page.goto(indexPath);
    await page.waitForTimeout(250);
    const block5Before = await page.evaluate(() => JSON.parse(JSON.stringify(window.Agenda.state.getRawData().gymBlocks[5])));
    await seedBrokenQueue(page);
    const block5After = await page.evaluate(() => JSON.parse(JSON.stringify(window.Agenda.state.getRawData().gymBlocks[5])));
    check(JSON.stringify(block5Before) === JSON.stringify(block5After), "el Bloque 5 queda intacto");

    const block6Resolutions = await page.evaluate(() => window.Agenda.state.getRawData().gymBlocks[6].resolutions);
    check(
      block6Resolutions["2026-10-20"].status === "done" &&
        block6Resolutions["2026-10-21"].status === "done" &&
        block6Resolutions["2026-11-05"].status === "done",
      "lo ya cumplido (20, 21 oct y 5 nov) no se tocó al leer el 2 de nov"
    );

    console.log("Bloque 5 — errores de página:", JSON.stringify(errors));
    check(errors.length === 0, "Bloque 5: sin errores de JS");
    await context.close();
  }

  // ---------- Persiste tras recargar ----------
  {
    const { context, page, errors } = await newPage(browser);
    await page.goto(indexPath);
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const raw = window.Agenda.state.getRawData();
      const block = raw.gymBlocks[6];
      block.resolutions = {
        "2026-10-20": { status: "done", index: 0 },
        "2026-10-21": { status: "done", index: 1 },
      };
      block.pointer = 2;
      window.Agenda.state.replaceAllData(raw);
    });

    await goToDate(page, "2026-11-02");
    await clickCorregir(page);
    await clickSiNo(page, "Sí");

    await page.reload();
    await page.waitForTimeout(300);
    await goToDate(page, "2026-11-02");
    const info = await gymBlockInfo(page);
    check(info && info.gymActionsText === "✓ Hecho", "tras recargar, el 2 de nov sigue marcado Hecho");
    check(info && !info.hasFreeTextInput, "tras recargar, sigue sin ser campo de texto libre");

    console.log("Persistencia — errores de página:", JSON.stringify(errors));
    check(errors.length === 0, "Persistencia: sin errores de JS");
    await context.close();
  }

  await browser.close();
  console.log(fails === 0 ? "\nTODO OK" : `\n${fails} FALLAS`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
