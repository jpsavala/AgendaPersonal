/*
 * Prueba del bloque de Cena (20:00-21:00) replicando el comportamiento
 * de Comida (ver js/dailyView.js: buildRepeatableMealBlock/buildCenaBlock,
 * js/weeklyView.js: lo mismo, js/state.js: getCenaAnswer/setCenaCocino/
 * repeatYesterdayCena/clearCenaAnswer).
 *
 * Cubre el pedido original: pregunta "¿Se repite la cena de ayer?" con
 * "Se repite"/"Cocino", "Se repite" copia el VALOR del día anterior sin
 * vincular los días (cambiar el de ayer después no mueve el de hoy),
 * "Ayer no hay cena registrada" cuando no hay nada que copiar, el
 * selector usa la misma librería de Comidas, "Cambiar" vuelve a la
 * pregunta, persistencia tras recargar, mismo dato en Diaria y
 * Semanal, bloque fijo "Bañarme" (21:00-21:20) sin casilla ni texto, y
 * que Comida siga funcionando sin ningún cambio.
 *
 * Cómo correr (requiere Node y Playwright ya instalados):
 *   node tests/cena-repeat.test.js
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

function cenaBlock(page) {
  return page.locator(".schedule-block").filter({ has: page.locator(".schedule-label", { hasText: "Cena" }) });
}

async function gotoDiaria(page, dateStr) {
  await page.goto(indexPath);
  await setNow(page, "2026-11-09T10:00:00");
  await page.waitForTimeout(250);
  await page.locator('.tab-button[data-tab="diaria"]:visible').first().click();
  await page.waitForTimeout(100);
  if (dateStr) {
    await page.locator(".date-picker").fill(dateStr);
    await page.waitForTimeout(150);
  }
}

// Elige "+ Agregar nueva..." en el selector de cena de este día y
// guarda currentText como receta nueva (misma librería que Comidas).
async function pickNewCena(page, text) {
  const block = cenaBlock(page);
  await block.locator("select.meal-select").selectOption({ label: "+ Agregar nueva..." });
  await page.waitForTimeout(80);
  await block.locator(".add-input").fill(text);
  await block.locator(".add-input").press("Enter");
  await page.waitForTimeout(80);
}

// ---------- Prueba 1: sin respuesta, pregunta; "Cocino" abre el
// selector (misma librería que Comidas); guardar queda con "Cambiar" ----------
async function testCocinoFlow(browser) {
  const { context, page, errors } = await newPage(browser);
  await gotoDiaria(page, "2026-11-09"); // lunes

  const block = cenaBlock(page);
  check(await block.locator(".schedule-time").innerText() === "20:00–21:00", "Prueba 1: horario de Cena es 20:00–21:00");
  check(await block.locator("p", { hasText: "¿Se repite la cena de ayer?" }).isVisible(), 'Prueba 1: aparece "¿Se repite la cena de ayer?"');

  await block.locator("button", { hasText: "Cocino" }).click();
  await page.waitForTimeout(80);
  check(await block.locator("select.meal-select").isVisible(), 'Prueba 1: "Cocino" abre el selector');

  await pickNewCena(page, "Tacos");
  check(await block.locator("select.meal-select").inputValue() === "Tacos", 'Prueba 1: selector queda en "Tacos"');
  check(await block.locator("button", { hasText: "Cambiar" }).isVisible(), 'Prueba 1: aparece el enlace "Cambiar"');

  console.log("Prueba 1 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 1: sin errores de JS");
  await context.close();
}

// ---------- Prueba 2: "Se repite" copia el valor de ayer (sin
// vincular los días); cambiar ayer después no mueve el de hoy ----------
async function testSeRepiteNoLinked(browser) {
  const { context, page, errors } = await newPage(browser);
  await gotoDiaria(page, "2026-11-09"); // lunes
  await cenaBlock(page).locator("button", { hasText: "Cocino" }).click();
  await page.waitForTimeout(80);
  await pickNewCena(page, "Tacos");

  // martes: sin cena -> pregunta; "Se repite" carga la del lunes
  await page.locator(".date-picker").fill("2026-11-10");
  await page.waitForTimeout(150);
  let block = cenaBlock(page);
  check(await block.locator("p", { hasText: "¿Se repite la cena de ayer?" }).isVisible(), "Prueba 2: martes sin cena muestra la pregunta");
  await block.locator("button", { hasText: "Se repite" }).click();
  await page.waitForTimeout(100);
  block = cenaBlock(page);
  check(await block.locator(".schedule-readonly-text").innerText() === "Tacos", 'Prueba 2: "Se repite" carga "Tacos" del lunes');
  check(!(await block.locator(".comida-warning").isVisible().catch(() => false)), "Prueba 2: sin aviso (sí había cena ayer)");

  // volver al lunes y cambiar su cena
  await page.locator(".date-picker").fill("2026-11-09");
  await page.waitForTimeout(150);
  block = cenaBlock(page);
  await block.locator("button", { hasText: "Cambiar" }).click();
  await page.waitForTimeout(80);
  block = cenaBlock(page);
  await block.locator("button", { hasText: "Cocino" }).click();
  await page.waitForTimeout(80);
  await pickNewCena(page, "Sopa");
  check(await cenaBlock(page).locator("select.meal-select").inputValue() === "Sopa", 'Prueba 2: lunes ahora tiene "Sopa"');

  // el martes (ya copiado) no se mueve
  await page.locator(".date-picker").fill("2026-11-10");
  await page.waitForTimeout(150);
  block = cenaBlock(page);
  check(await block.locator(".schedule-readonly-text").innerText() === "Tacos", 'Prueba 2: martes sigue en "Tacos" (no se mueve con el cambio de ayer)');

  console.log("Prueba 2 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 2: sin errores de JS");
  await context.close();
}

// ---------- Prueba 3: día después de otro sin cena -> "Ayer no hay
// cena registrada", y queda con el selector normal ----------
async function testNoCenaYesterdayWarning(browser) {
  const { context, page, errors } = await newPage(browser);
  await gotoDiaria(page, "2026-11-11"); // miércoles, sin cena cargada

  let block = cenaBlock(page);
  await block.locator("button", { hasText: "Se repite" }).click();
  await page.waitForTimeout(100);
  block = cenaBlock(page);
  check(
    await block.locator(".comida-warning", { hasText: "Ayer no hay cena registrada" }).isVisible(),
    'Prueba 3: muestra "Ayer no hay cena registrada"'
  );
  check(await block.locator("select.meal-select").isVisible(), "Prueba 3: cae en el selector normal");

  console.log("Prueba 3 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 3: sin errores de JS");
  await context.close();
}

// ---------- Prueba 4: persistencia tras recargar ----------
async function testPersistsAfterReload(browser) {
  const { context, page, errors } = await newPage(browser);
  await gotoDiaria(page, "2026-11-09");
  await cenaBlock(page).locator("button", { hasText: "Cocino" }).click();
  await page.waitForTimeout(80);
  await pickNewCena(page, "Tacos");

  await page.reload();
  await setNow(page, "2026-11-09T10:00:00");
  await page.waitForTimeout(250);
  await page.locator('.tab-button[data-tab="diaria"]:visible').first().click();
  await page.waitForTimeout(100);
  await page.locator(".date-picker").fill("2026-11-09");
  await page.waitForTimeout(150);

  check(await cenaBlock(page).locator("select.meal-select").inputValue() === "Tacos", 'Prueba 4: tras recargar, el lunes sigue en "Tacos"');

  console.log("Prueba 4 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 4: sin errores de JS");
  await context.close();
}

// ---------- Prueba 5: mismo dato en Diaria y Semanal ----------
async function testDailyWeeklyParity(browser) {
  const { context, page, errors } = await newPage(browser);
  await gotoDiaria(page, "2026-11-09");
  await cenaBlock(page).locator("button", { hasText: "Cocino" }).click();
  await page.waitForTimeout(80);
  await pickNewCena(page, "Tacos");

  await page.locator('.tab-button[data-tab="semanal"]:visible').first().click();
  await page.waitForTimeout(150);
  // La Semanal arranca con la semana real (su currentMonday se calcula
  // al cargar el módulo, antes de que la fecha simulada esté escrita en
  // localStorage) — "Esta semana" la recalcula ya con Date() simulado.
  await page.locator("button", { hasText: "Esta semana" }).click();
  await page.waitForTimeout(150);
  const dayCard = page.locator(".week-day-card", { hasText: "Lunes 9" });
  // El bloque de cena es el que sigue al <label> "20:00–21:00 — Cena".
  const cenaLabel = dayCard.locator("label.field-label", { hasText: "Cena" });
  check(await cenaLabel.isVisible(), "Prueba 5: la Semanal muestra el bloque de Cena del lunes");
  const cenaSelectValue = await dayCard.locator("select.meal-select").last().inputValue();
  check(cenaSelectValue === "Tacos", 'Prueba 5: la Semanal muestra "Tacos" para el lunes, igual que la Diaria');

  console.log("Prueba 5 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 5: sin errores de JS");
  await context.close();
}

// ---------- Prueba 6: Comida sigue funcionando igual (independiente
// de Cena) ----------
async function testComidaUnaffected(browser) {
  const { context, page, errors } = await newPage(browser);
  await gotoDiaria(page, "2026-11-09");

  const comidaBlock = page.locator(".schedule-block").filter({ has: page.locator(".schedule-label", { hasText: "Comida" }) });
  check(await comidaBlock.locator("p", { hasText: "¿Se repite la comida de ayer?" }).isVisible(), "Prueba 6: Comida sigue con su propia pregunta");
  await comidaBlock.locator("button", { hasText: "Cocino" }).click();
  await page.waitForTimeout(80);
  await comidaBlock.locator("select.meal-select").selectOption({ label: "+ Agregar nueva..." });
  await page.waitForTimeout(80);
  await comidaBlock.locator(".add-input").fill("Ensalada");
  await comidaBlock.locator(".add-input").press("Enter");
  await page.waitForTimeout(80);
  check(await comidaBlock.locator("select.meal-select").inputValue() === "Ensalada", 'Prueba 6: Comida queda en "Ensalada"');

  // Cena del mismo día sigue sin respuesta (independiente)
  check(
    await cenaBlock(page).locator("p", { hasText: "¿Se repite la cena de ayer?" }).isVisible(),
    "Prueba 6: Cena del mismo día no se vio afectada por elegir Comida"
  );

  console.log("Prueba 6 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 6: sin errores de JS");
  await context.close();
}

// ---------- Prueba 7: bloque fijo "Bañarme" sin casilla ni texto, y
// el bloque libre 21:30-22:10 no se movió ----------
async function testBanarmeAndLibreBlock(browser) {
  const { context, page, errors } = await newPage(browser);
  await gotoDiaria(page, "2026-11-09");

  const banarme = page.locator(".schedule-block").filter({ has: page.locator(".schedule-label", { hasText: "Bañarme" }) });
  check(await banarme.locator(".schedule-time").innerText() === "21:00–21:20", 'Prueba 7: "Bañarme" es 21:00–21:20');
  check((await banarme.locator("input.schedule-check").count()) === 0, 'Prueba 7: "Bañarme" no tiene casilla de cumplido');
  check((await banarme.locator("input.schedule-input").count()) === 0, 'Prueba 7: "Bañarme" no tiene campo de texto');

  const libre = page.locator(".schedule-block").filter({ has: page.locator(".schedule-label", { hasText: "Bloque libre" }) }).last();
  check(await libre.locator(".schedule-time").innerText() === "21:30–22:10", 'Prueba 7: "Bloque libre" sigue en 21:30–22:10');
  check((await libre.locator("input.schedule-input").count()) === 1, 'Prueba 7: "Bloque libre" sigue siendo texto libre');

  console.log("Prueba 7 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 7: sin errores de JS");
  await context.close();
}

// ---------- Prueba 8: 375px e iPad, sin desborde horizontal ----------
async function testViewports(browser) {
  for (const [label, viewport] of [
    ["375px", { width: 375, height: 812 }],
    ["iPad", { width: 768, height: 1024 }],
  ]) {
    const { context, page, errors } = await newPage(browser, viewport);
    await gotoDiaria(page, "2026-11-11"); // miércoles, sin respuesta -> muestra la pregunta
    const block = cenaBlock(page);
    check(await block.locator("button", { hasText: "Se repite" }).isVisible(), `Prueba 8 (${label}): botón "Se repite" visible`);
    await block.locator("button", { hasText: "Cocino" }).click();
    await page.waitForTimeout(80);
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    check(noOverflow, `Prueba 8 (${label}): sin desborde horizontal con el selector de Cena abierto (Diaria)`);

    await page.locator('.tab-button[data-tab="semanal"]:visible').first().click();
    await page.waitForTimeout(150);
    const noOverflowWeekly = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    check(noOverflowWeekly, `Prueba 8 (${label}): sin desborde horizontal en la Semanal`);

    console.log(`Prueba 8 (${label}) — errores de página:`, JSON.stringify(errors));
    check(errors.length === 0, `Prueba 8 (${label}): sin errores de JS`);
    await context.close();
  }
}

// ---------- Prueba 9: "Replicar semana anterior" / "Deshacer
// réplica" incluyen la cena (valor y respuesta) ----------
async function testReplicateWeekIncludesCena(browser) {
  const { context, page, errors } = await newPage(browser);
  await gotoDiaria(page, "2026-11-09");

  const result = await page.evaluate(() => {
    const state = window.Agenda.state;
    const prevMonday = "2026-11-02";
    const thisMonday = "2026-11-09";
    // Semana anterior: lunes con cena "Tacos" ya elegida ("cocino").
    state.setBlockText(prevMonday, "cena", "Tacos");
    state.setCenaCocino(prevMonday);
    // Semana destino: algo previo que debería quedar respaldado y
    // restaurado por "Deshacer réplica".
    state.setBlockText(thisMonday, "cena", "Pizza vieja");
    state.setCenaCocino(thisMonday);

    state.replicatePreviousWeek(thisMonday);
    // getBlockText no está expuesto directo; se lee vía getDayBlocks.
    const blockAfter = state.getDayBlocks(thisMonday).find((b) => b.id === "cena");
    const afterReplicate = {
      text: blockAfter && blockAfter.text,
      cenaAnswer: state.getCenaAnswer(thisMonday),
    };

    state.undoReplicateWeek(thisMonday);
    const blockAfterUndo = state.getDayBlocks(thisMonday).find((b) => b.id === "cena");
    const afterUndo = {
      text: blockAfterUndo && blockAfterUndo.text,
      cenaAnswer: state.getCenaAnswer(thisMonday),
    };

    return { afterReplicate, afterUndo };
  });

  check(result.afterReplicate.text === "Tacos", '"Replicar semana anterior" copia la cena del lunes anterior ("Tacos")');
  check(result.afterReplicate.cenaAnswer === "cocino", '"Replicar semana anterior" deja la respuesta de cena lista para verse sola (sin "pending" viejo)');
  check(result.afterUndo.text === "Pizza vieja", '"Deshacer réplica" restaura la cena que había antes ("Pizza vieja")');
  check(result.afterUndo.cenaAnswer === "cocino", '"Deshacer réplica" restaura también la respuesta de cena');

  console.log("Prueba 9 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 9: sin errores de JS");
  await context.close();
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  try {
    await testCocinoFlow(browser);
    await testSeRepiteNoLinked(browser);
    await testNoCenaYesterdayWarning(browser);
    await testPersistsAfterReload(browser);
    await testDailyWeeklyParity(browser);
    await testComidaUnaffected(browser);
    await testBanarmeAndLibreBlock(browser);
    await testReplicateWeekIncludesCena(browser);
    await testViewports(browser);
  } finally {
    await browser.close();
  }
  console.log(fails === 0 ? "\nTODO OK" : `\n${fails} FALLAS`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
