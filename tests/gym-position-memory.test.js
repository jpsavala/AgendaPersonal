/*
 * Prueba de "recordar dónde quedé en Gimnasio" (ver el pedido original:
 * recordar pestaña, bloque/semana/día y ejercicio, con ventana de 3
 * horas; nunca caer en la Semana 1 por inercia; "Registrar" desde la
 * Diaria sigue teniendo prioridad).
 *
 * Usa un reloj simulado controlable en caliente (vía localStorage, no
 * un valor fijo por script): a diferencia de gym-history-persistence.test.js
 * (una sola fecha fija para toda la prueba), acá se necesita mover "ahora"
 * varias veces dentro de la misma corrida — antes/después de 3 horas,
 * y de una fecha a la siguiente — tanto dentro de la misma sesión de
 * página (simulando que la PWA sigue viva en segundo plano) como entre
 * recargas completas (simulando cerrar y volver a abrir la app).
 *
 * Cómo correr (requiere Node y Playwright ya instalados):
 *   node tests/gym-position-memory.test.js
 */
const { chromium } = require("playwright");
const path = require("path");

function mockDateInitScript() {
  return `(() => {
    const RealDate = Date;
    class MockDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) {
          const ms = Number(localStorage.getItem("__mockNowMs"));
          return new RealDate(ms || RealDate.now());
        }
        return new RealDate(...args);
      }
      static now() {
        const ms = Number(localStorage.getItem("__mockNowMs"));
        return ms || RealDate.now();
      }
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

async function setNow(page, isoDateTime) {
  const ms = Date.parse(isoDateTime);
  await page.evaluate((v) => localStorage.setItem("__mockNowMs", String(v)), ms);
}

async function newPage(browser, viewport) {
  const context = await browser.newContext({ viewport: viewport || { width: 460, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(mockDateInitScript());
  return { context, page, errors };
}

// Datos reales del Bloque 6 (ver js/gymRoutines.js): día 3 "Glúteo/
// Femoral" tiene Hip Thrust (b6d3e1), Peso Muerto Rumano (b6d3e2) y
// Curl Femoral (b6d3e3) en ese orden — se usan tal cual, sin fabricar
// una rutina de prueba aparte.
async function seedAdvancedQueue(page) {
  await page.evaluate(() => {
    const raw = window.Agenda.state.getRawData();
    const block = raw.gymBlocks && raw.gymBlocks[6];
    if (!block) throw new Error("Bloque 6 no está sembrado");
    // Semana 1 completa (índices 0-4) ya resuelta como "hecha": el
    // puntero queda en 5, así que "hoy" (sin ninguna fecha explícita
    // más adelante) le corresponde la Semana 2, Día 1 — justo el caso
    // del bug reportado ("ayer abrió en la Semana 1 estando en la
    // Semana 2").
    block.resolutions = {
      "2026-10-20": { status: "done", index: 0 },
      "2026-10-21": { status: "done", index: 1 },
      "2026-10-22": { status: "done", index: 2 },
      "2026-10-23": { status: "done", index: 3 },
      "2026-10-24": { status: "done", index: 4 },
    };
    block.pointer = 5;
    window.Agenda.state.replaceAllData(raw);
  });
}

async function gymHeaderText(page) {
  return page.evaluate(() => document.querySelector(".gym-header h2")?.textContent || null);
}

async function activeTab(page) {
  return page.evaluate(() => document.querySelector(".tab-button.active")?.dataset.tab || null);
}

async function activeWeek(page) {
  return page.evaluate(() => document.querySelector(".gym-week-tabs .toggle-btn.active")?.textContent || null);
}

// ---------- Prueba 1: nunca cae en la Semana 1 por inercia ----------
// Simula la PWA quedándose viva en segundo plano: un primer montaje de
// Gimnasio con la cola "fresca" (Semana 1), después el puntero avanza
// (uso real de varios días) y pasa el tiempo, y se vuelve a la pestaña
// Gimnasio SIN recargar la página (clic a otra pestaña y de vuelta) —
// debe reflejar la Semana 2, no quedarse pegada a la Semana 1 cacheada.
async function testNeverStuckOnWeek1(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(indexPath);
  await setNow(page, "2026-10-20T10:00:00");
  await page.waitForTimeout(250);

  await page.locator('.tab-button[data-tab="gimnasio"]:visible').first().click();
  await page.waitForTimeout(150);
  check((await gymHeaderText(page)) === "Gimnasio", "Prueba 1: la pestaña Gimnasio monta");
  check((await activeWeek(page)) === "Semana 1", "Prueba 1: con la cola recién sembrada, hoy es Semana 1");

  // El puntero avanza (progreso real de varios días) y "ahora" pasa a
  // ser una fecha que le corresponde a la Semana 2 — todo dentro de la
  // MISMA sesión de página, sin reload, para reproducir el reporte
  // original (la pestaña se queda abierta en segundo plano).
  await seedAdvancedQueue(page);
  await setNow(page, "2026-10-27T10:00:00");

  // Se aleja de Gimnasio y vuelve, sin recargar: dispara un mount()
  // nuevo (ver js/gymView.js: ns.gymView.mount), que es donde corre
  // syncPositionOnMount.
  await page.locator('.tab-button[data-tab="diaria"]:visible').first().click();
  await page.waitForTimeout(100);
  await page.locator('.tab-button[data-tab="gimnasio"]:visible').first().click();
  await page.waitForTimeout(150);

  check((await activeWeek(page)) === "Semana 2", "Prueba 1: tras avanzar el puntero, vuelve a Gimnasio en Semana 2 (no se queda en Semana 1)");

  console.log("Prueba 1 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 1: sin errores de JS");
  await context.close();
}

// ---------- Prueba 2/3: recordar bloque/semana/día/ejercicio, scroll +
// resaltado, colapso de lo ya terminado, y la ventana de 3 horas (tab +
// posición) ----------
async function testRememberPositionAndWindow(browser) {
  const { context, page, errors } = await newPage(browser);
  const T0 = "2026-10-20T10:00:00";
  await page.goto(indexPath);
  await setNow(page, T0);
  await page.waitForTimeout(250);

  await page.locator('.tab-button[data-tab="gimnasio"]:visible').first().click();
  await page.waitForTimeout(150);

  // Abre el Día 3 (Glúteo/Femoral) a mano — eso ya pasa a ser lo
  // recordado (ver js/gymView.js: buildDayCard, onclick del encabezado).
  await page.locator(".gym-day-head h4", { hasText: "Día 3" }).click();
  await page.waitForTimeout(100);

  // Hip Thrust (b6d3e1): agrega una serie y la completa.
  const hipThrustCard = page.locator(".gym-exercise-card", { hasText: "Hip Thrust" });
  await hipThrustCard.locator(".gym-set-actions button", { hasText: "Agregar serie" }).click();
  await page.waitForTimeout(80);
  await hipThrustCard.locator(".gym-set-weight").fill("250");
  await hipThrustCard.locator(".gym-set-reps").fill("12");
  await hipThrustCard.locator(".gym-set-rir").fill("0");
  await hipThrustCard.locator(".gym-set-rir").blur();
  await page.waitForTimeout(100);

  // Peso Muerto Rumano (b6d3e2): también completo.
  const rdlCard = page.locator(".gym-exercise-card", { hasText: "Peso Muerto Rumano" });
  await rdlCard.locator(".gym-set-actions button", { hasText: "Agregar serie" }).click();
  await page.waitForTimeout(80);
  await rdlCard.locator(".gym-set-weight").fill("60");
  await rdlCard.locator(".gym-set-reps").fill("10");
  await rdlCard.locator(".gym-set-rir").blur();
  await page.waitForTimeout(100);

  // Curl Femoral (b6d3e3): el último donde se captura algo — queda a
  // medias a propósito (sin peso) para confirmar que uno incompleto
  // nunca se colapsa solo, y es el que debe recibir scroll + resaltado.
  const curlCard = page.locator(".gym-exercise-card", { hasText: "Curl Femoral" });
  await curlCard.locator(".gym-set-actions button", { hasText: "Agregar serie" }).click();
  await page.waitForTimeout(80);
  await curlCard.locator(".gym-set-reps").fill("14");
  await curlCard.locator(".gym-set-reps").blur();
  await page.waitForTimeout(150);

  const uiStateAfterCapture = await page.evaluate(() => window.Agenda.state.getGymUiState());
  check(
    uiStateAfterCapture && uiStateAfterCapture.exerciseId === "b6d3e3",
    "Prueba 2: queda recordado el último ejercicio donde se capturó algo (Curl Femoral)"
  );

  // "Cierra y reabre" dentro de las 3 horas: recarga completa con el
  // reloj apenas 1h adelante.
  await setNow(page, "2026-10-20T11:00:00");
  await page.reload();
  await page.waitForTimeout(300);

  check((await activeTab(page)) === "gimnasio", "Prueba 2: reabrir <3h cae directo en Gimnasio");
  check((await activeWeek(page)) === "Semana 1", "Prueba 2: restaura la Semana 1 recordada");
  const day3Visible = await page.locator(".gym-day-head h4", { hasText: "Día 3" }).isVisible();
  check(day3Visible, "Prueba 2: el Día 3 recordado está abierto");

  const hipThrustAfter = page.locator(".gym-exercise-card", { hasText: "Hip Thrust" });
  check(await hipThrustAfter.evaluate((el) => el.classList.contains("collapsed")), "Prueba 2: Hip Thrust (terminado, antes del recordado) queda colapsado");
  const hipThrustSummary = await hipThrustAfter.locator(".gym-exercise-summary").textContent().catch(() => null);
  check(!!hipThrustSummary && hipThrustSummary.includes("250") && hipThrustSummary.includes("12"), `Prueba 2: resumen de Hip Thrust colapsado ("${hipThrustSummary}")`);

  const rdlAfter = page.locator(".gym-exercise-card", { hasText: "Peso Muerto Rumano" });
  check(await rdlAfter.evaluate((el) => el.classList.contains("collapsed")), "Prueba 2: Peso Muerto Rumano (terminado) también queda colapsado");

  const curlAfter = page.locator(".gym-exercise-card", { hasText: "Curl Femoral" });
  check(!(await curlAfter.evaluate((el) => el.classList.contains("collapsed"))), "Prueba 2: Curl Femoral (a medias, el recordado) NO se colapsa");
  check(await curlAfter.locator(".gym-set-weight").isVisible(), "Prueba 2: Curl Femoral sigue expandido (se ven sus campos)");

  // El resaltado se agrega al montar y se quita solo a los 2.5s: se
  // revisa enseguida, mientras todavía debería estar.
  const highlightedSoonAfterLoad = await curlAfter.evaluate((el) => el.classList.contains("gym-exercise-highlight"));
  check(highlightedSoonAfterLoad, "Prueba 2: Curl Femoral recibe el resaltado temporal al reabrir");

  // Reabrir al día siguiente (>3h): cae en la Diaria, no en Gimnasio.
  await setNow(page, "2026-10-21T09:00:00");
  await page.reload();
  await page.waitForTimeout(300);
  check((await activeTab(page)) === "diaria", "Prueba 3: reabrir al día siguiente (>3h) cae en la Diaria");

  console.log("Prueba 2/3 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 2/3: sin errores de JS");
  await context.close();
}

// ---------- Prueba 4: "Registrar" desde la Diaria sigue funcionando y
// tiene prioridad sobre lo recordado ----------
async function testRegistrarTakesPriority(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(indexPath);
  await setNow(page, "2026-10-20T10:00:00");
  await page.waitForTimeout(250);

  // Deja algo "recordado" en Semana 1 / Día 3 (como en la prueba 2),
  // sin pasar por la UI: alcanza con touchGymPosition directo.
  await page.evaluate(() => window.Agenda.state.touchGymPosition(6, 1, 3));
  await page.waitForTimeout(80);

  // Avanza el puntero para que la sesión de HOY (según la cola) le
  // corresponda a la Semana 2 — justo lo opuesto a lo recordado arriba
  // — y "Registrar" desde la Diaria para la fecha de hoy debe abrir esa
  // Semana 2, no la Semana 1 recordada.
  await seedAdvancedQueue(page);
  await setNow(page, "2026-10-27T10:00:00");

  await page.locator('.tab-button[data-tab="diaria"]:visible').first().click();
  await page.waitForTimeout(100);
  await page.locator(".date-picker").fill("2026-10-27");
  await page.locator(".date-picker").dispatchEvent("change");
  await page.waitForTimeout(150);

  const registrarBtn = page.locator(".gym-registrar-btn").first();
  check(await registrarBtn.isVisible(), 'Prueba 4: el botón "Registrar" está visible en la Diaria');
  await registrarBtn.click();
  await page.waitForTimeout(150);

  check((await activeTab(page)) === "gimnasio", 'Prueba 4: "Registrar" lleva a la pestaña Gimnasio');
  check((await activeWeek(page)) === "Semana 2", '"Registrar" abre la sesión de HOY (Semana 2), no la Semana 1 recordada');

  console.log("Prueba 4 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 4: sin errores de JS");
  await context.close();
}

// ---------- Prueba 5: 375px e iPad ----------
async function testViewports(browser) {
  for (const [label, viewport] of [
    ["375px", { width: 375, height: 812 }],
    ["iPad", { width: 1024, height: 1366 }],
  ]) {
    const { context, page, errors } = await newPage(browser);
    await page.goto(indexPath);
    await setNow(page, "2026-10-20T10:00:00");
    await page.waitForTimeout(250);

    await page.locator('.tab-button[data-tab="gimnasio"]:visible').first().click();
    await page.waitForTimeout(150);
    check((await gymHeaderText(page)) === "Gimnasio", `Prueba 5 (${label}): monta Gimnasio`);

    await page.locator(".gym-day-head h4", { hasText: "Día 3" }).click();
    await page.waitForTimeout(100);
    const hipThrustCard = page.locator(".gym-exercise-card", { hasText: "Hip Thrust" });
    check(await hipThrustCard.isVisible(), `Prueba 5 (${label}): el Día 3 abierto muestra sus ejercicios`);
    await hipThrustCard.locator(".gym-set-actions button", { hasText: "Agregar serie" }).click();
    await page.waitForTimeout(80);
    check(await hipThrustCard.locator(".gym-set-weight").isVisible(), `Prueba 5 (${label}): los campos de una serie son usables`);

    console.log(`Prueba 5 (${label}) — errores de página:`, JSON.stringify(errors));
    check(errors.length === 0, `Prueba 5 (${label}): sin errores de JS`);
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  try {
    await testNeverStuckOnWeek1(browser);
    await testRememberPositionAndWindow(browser);
    await testRegistrarTakesPriority(browser);
    await testViewports(browser);
  } finally {
    await browser.close();
  }
  console.log(fails === 0 ? "\nTODO OK" : `\n${fails} FALLAS`);
  process.exit(fails === 0 ? 0 : 1);
})();
