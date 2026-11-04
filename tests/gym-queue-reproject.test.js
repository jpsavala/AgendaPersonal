/*
 * Prueba del bug reportado: "Corregir" en Gimnasio deja atrapado al
 * usuario cuando una fecha posterior ya tiene su propia resolución
 * para la MISMA sesión (el lunes 2 de nov quiere "Cuádriceps S2", pero
 * el martes 3 de nov ya la tiene guardada) — corregir la fecha
 * posterior tampoco ayuda, porque sigue quedando "pegada" a ese mismo
 * índice sin importar su estado (hecho/no realizado).
 *
 * Arreglo (ver js/scheduleQueue.js: editResolution): cuando una fecha
 * posterior ya resuelta seguiría correspondiendo a una sesión VÁLIDA
 * pero DISTINTA (no cuando deja de ser válida del todo — eso sigue
 * bloqueando como antes), ya no se rechaza para siempre: se devuelve
 * una vista previa (reason: "needs-confirmation") y, confirmada
 * (confirmReprojection: true), se aplica conservando el estado propio
 * de cada fecha posterior (si estaba "hecho" sigue "hecho"), sin tocar
 * ningún peso/reps/RIR ya registrado — solo cambia a qué sesión de la
 * cola corresponde esa fecha.
 *
 * Esta prueba siembra EXACTAMENTE el caso reportado (Bloque 6: 9
 * sesiones hechas en orden del 20 al 30 de oct, y el 3 de nov marcado
 * "Sí" para el índice 9 "Cuádriceps S2" sin que el 2 de nov se hubiera
 * resuelto todavía) y confirma:
 * - Antes de confirmar, avisa con la vista previa (no un bloqueo
 *   ciego) y no cambia nada si se cancela.
 * - Confirmado, aplica: el 2 de nov queda "Cuádriceps S2" hecho, el 3
 *   de nov pasa a "Torso S3" pero SIGUE "hecho" (no se resetea).
 * - Tabla fecha -> sesión del 2 al 16 de nov coherente con el puntero.
 * - No toca el Bloque 5 ni ningún registro de peso/reps/RIR.
 * - Persiste tras recargar.
 *
 * Cómo correr (requiere Node y Playwright ya instalados):
 *   node tests/gym-queue-reproject.test.js
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
  // "Hoy" = 4 de nov de 2026, como en el reporte real.
  await page.addInitScript(mockDateScript("2026-11-04T10:00:00"));
  return { context, page, errors };
}

// Bloque 6: índices 0-8 hechos en orden (20-30 oct), y el 3 de nov
// marcado "Sí" directamente al índice 9 (Cuádriceps S2) — el 2 de nov
// (día hábil anterior) nunca se resolvió. Reproduce el caso real.
async function seedDuplicateQueue(page) {
  await page.evaluate(() => {
    const raw = window.Agenda.state.getRawData();
    const block = raw.gymBlocks && raw.gymBlocks[6];
    if (!block) throw new Error("Bloque 6 no está sembrado");
    block.resolutions = {
      "2026-10-20": { status: "done", index: 0 },
      "2026-10-21": { status: "done", index: 1 },
      "2026-10-22": { status: "done", index: 2 },
      "2026-10-23": { status: "done", index: 3 },
      "2026-10-26": { status: "done", index: 4 },
      "2026-10-27": { status: "done", index: 5 },
      "2026-10-28": { status: "done", index: 6 },
      "2026-10-29": { status: "done", index: 7 },
      "2026-10-30": { status: "done", index: 8 },
      "2026-11-03": { status: "done", index: 9 },
    };
    block.pointer = 10;
    window.Agenda.state.replaceAllData(raw);
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

async function gymBlockInfo(page) {
  return page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".schedule-block")).find(
      (b) => b.querySelector(".schedule-label")?.textContent?.includes("Gimnasio")
    );
    if (!block) return null;
    return {
      readonlyText: block.querySelector(".schedule-readonly-text")?.textContent || null,
      gymActionsText: block.querySelector(".gym-actions span")?.textContent || null,
    };
  });
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });

  // ---------- Vista previa + cancelar no cambia nada ----------
  {
    const { context, page, errors } = await newPage(browser);
    await page.goto(indexPath);
    await page.waitForTimeout(250);
    await seedDuplicateQueue(page);

    const nov2Before = await page.evaluate(() => window.Agenda.state.getGymResolution("2026-11-02"));
    check(nov2Before && nov2Before.session === "Cuádriceps S2", `el 2 de nov muestra "Cuádriceps S2" antes de corregir (${nov2Before && nov2Before.session})`);

    await goToDate(page, "2026-11-02");
    let dialogMessage = null;
    page.once("dialog", (dialog) => {
      dialogMessage = dialog.message();
      dialog.dismiss();
    });
    await clickCorregir(page);
    await clickSiNo(page, "Sí");

    check(!!dialogMessage, "muestra la vista previa (no un rechazo ciego) al chocar con el 3 de nov");
    check(
      !!dialogMessage && dialogMessage.includes("Cuádriceps S2") && dialogMessage.includes("Torso S3"),
      `la vista previa nombra la sesión antes y después ("${dialogMessage}")`
    );
    check(!!dialogMessage && !dialogMessage.includes("No se pudo aplicar"), "ya no es el mensaje de bloqueo ciego de antes");

    const resolutionsAfterCancel = await page.evaluate(() => window.Agenda.state.getRawData().gymBlocks[6].resolutions);
    check(
      !resolutionsAfterCancel["2026-11-02"] && resolutionsAfterCancel["2026-11-03"].status === "done" && resolutionsAfterCancel["2026-11-03"].index === 9,
      "cancelar no cambia nada (ni el 2 ni el 3 de nov)"
    );

    console.log("Cancelar — errores de página:", JSON.stringify(errors));
    check(errors.length === 0, "Cancelar: sin errores de JS");
    await context.close();
  }

  // ---------- Confirmar reproyecta y conserva el estado ----------
  {
    const { context, page, errors } = await newPage(browser);
    await page.goto(indexPath);
    await page.waitForTimeout(250);
    await seedDuplicateQueue(page);

    await goToDate(page, "2026-11-02");
    page.once("dialog", (dialog) => dialog.accept());
    await clickCorregir(page);
    await clickSiNo(page, "Sí");

    const info2 = await gymBlockInfo(page);
    check(info2 && info2.gymActionsText === "✓ Hecho", "el 2 de nov queda marcado Hecho tras confirmar");

    const resolutions = await page.evaluate(() => window.Agenda.state.getRawData().gymBlocks[6].resolutions);
    console.log("resolutions tras reproyectar:", JSON.stringify(resolutions));
    check(resolutions["2026-11-02"] && resolutions["2026-11-02"].status === "done" && resolutions["2026-11-02"].index === 9, "el 2 de nov queda Cuádriceps S2 (índice 9), hecho");
    check(
      resolutions["2026-11-03"] && resolutions["2026-11-03"].status === "done" && resolutions["2026-11-03"].index === 10,
      "el 3 de nov se reproyecta a índice 10 (Torso S3) y SIGUE hecho (no se resetea)"
    );

    await goToDate(page, "2026-11-03");
    const info3 = await gymBlockInfo(page);
    check(info3 && info3.readonlyText === "Día 1 - Torso S3", `el 3 de nov ahora muestra "Torso S3" (encontrado: ${info3 && info3.readonlyText})`);
    check(info3 && info3.gymActionsText === "✓ Hecho", "el 3 de nov sigue mostrando Hecho");

    // Hoy (4 de nov) también reproyecta correctamente.
    await goToDate(page, "2026-11-04");
    const resolutionToday = await page.evaluate(() => window.Agenda.state.getGymResolution("2026-11-04"));
    check(resolutionToday && resolutionToday.session === "Empuje S3", `hoy (4 nov) reproyecta a "Empuje S3" (encontrado: ${resolutionToday && resolutionToday.session})`);

    console.log("Confirmar — errores de página:", JSON.stringify(errors));
    check(errors.length === 0, "Confirmar: sin errores de JS");
    await context.close();
  }

  // ---------- Tabla fecha -> sesión del 2 al 16 de nov, coherente ----------
  {
    const { context, page, errors } = await newPage(browser);
    await page.goto(indexPath);
    await page.waitForTimeout(250);
    await seedDuplicateQueue(page);
    await goToDate(page, "2026-11-02");
    page.once("dialog", (dialog) => dialog.accept());
    await clickCorregir(page);
    await clickSiNo(page, "Sí");

    const table = await page.evaluate(() => {
      const out = {};
      for (let d = 2; d <= 16; d += 1) {
        const dateStr = `2026-11-${String(d).padStart(2, "0")}`;
        out[dateStr] = window.Agenda.state.getGymResolution(dateStr);
      }
      return out;
    });
    console.log("Tabla fecha -> sesión (2-16 nov):", JSON.stringify(table, null, 2));

    const allResolved = Object.entries(table).every(([dateStr, r]) => {
      const wd = new Date(dateStr + "T00:00:00Z").getUTCDay();
      const isWeekendDay = wd === 0 || wd === 6;
      return isWeekendDay || r !== null;
    });
    check(allResolved, "todos los días laborales del 2 al 16 de nov resuelven una sesión (ninguno null)");

    const noDuplicateIndex = new Set(Object.values(table).filter(Boolean).map((r) => r.index)).size;
    const resolvedCount = Object.values(table).filter(Boolean).length;
    console.log(`índices únicos: ${noDuplicateIndex} de ${resolvedCount} fechas resueltas`);

    console.log("Tabla — errores de página:", JSON.stringify(errors));
    check(errors.length === 0, "Tabla: sin errores de JS");
    await context.close();
  }

  // ---------- No toca el Bloque 5 ni ningún registro de peso/reps/RIR ----------
  {
    const { context, page, errors } = await newPage(browser);
    await page.goto(indexPath);
    await page.waitForTimeout(250);

    // Carga un registro real en Semana 2 / Día 5 (Cuádriceps, el
    // mismo week/day que "Cuádriceps S2" antes de reproyectar) para
    // confirmar que reproyectar la COLA no le toca un pelo a esto.
    await page.evaluate(() => {
      window.Agenda.state.addGymSet(6, 2, 5, "b6d5e1");
      window.Agenda.state.updateGymSet(6, 2, 5, "b6d5e1", window.Agenda.state.getGymWeekDay(6, 2, 5).exercises["b6d5e1"].sets[0].id, { weight: 225, reps: "10" });
    });
    const trackingBefore = await page.evaluate(() => JSON.parse(JSON.stringify(window.Agenda.state.getGymWeekDay(6, 2, 5))));
    const block5Before = await page.evaluate(() => JSON.parse(JSON.stringify(window.Agenda.state.getRawData().gymBlocks[5])));

    await seedDuplicateQueue(page);
    await goToDate(page, "2026-11-02");
    page.once("dialog", (dialog) => dialog.accept());
    await clickCorregir(page);
    await clickSiNo(page, "Sí");

    const trackingAfter = await page.evaluate(() => JSON.parse(JSON.stringify(window.Agenda.state.getGymWeekDay(6, 2, 5))));
    const block5After = await page.evaluate(() => JSON.parse(JSON.stringify(window.Agenda.state.getRawData().gymBlocks[5])));

    check(JSON.stringify(trackingBefore) === JSON.stringify(trackingAfter), "el registro de peso/reps en Semana 2 / Día 5 no se tocó");
    check(JSON.stringify(block5Before) === JSON.stringify(block5After), "el Bloque 5 queda intacto");

    console.log("Bloque 5 / tracking — errores de página:", JSON.stringify(errors));
    check(errors.length === 0, "Bloque 5 / tracking: sin errores de JS");
    await context.close();
  }

  // ---------- Persiste tras recargar ----------
  {
    const { context, page, errors } = await newPage(browser);
    await page.goto(indexPath);
    await page.waitForTimeout(250);
    await seedDuplicateQueue(page);
    await goToDate(page, "2026-11-02");
    page.once("dialog", (dialog) => dialog.accept());
    await clickCorregir(page);
    await clickSiNo(page, "Sí");

    await page.reload();
    await page.waitForTimeout(300);
    await goToDate(page, "2026-11-02");
    const info = await gymBlockInfo(page);
    check(info && info.gymActionsText === "✓ Hecho", "tras recargar, el 2 de nov sigue Hecho");

    await goToDate(page, "2026-11-03");
    const info3 = await gymBlockInfo(page);
    check(info3 && info3.readonlyText === "Día 1 - Torso S3", "tras recargar, el 3 de nov sigue reproyectado a Torso S3");

    console.log("Persistencia — errores de página:", JSON.stringify(errors));
    check(errors.length === 0, "Persistencia: sin errores de JS");
    await context.close();
  }

  await browser.close();
  console.log(fails === 0 ? "\nTODO OK" : `\n${fails} FALLAS`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
