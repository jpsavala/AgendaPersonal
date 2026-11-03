/*
 * Prueba de la casilla "Hecho" por ejercicio en la pestaña Gimnasio
 * (ver js/gymView.js: buildExerciseCard/isExerciseExpanded, js/state.js:
 * setGymExerciseDone).
 *
 * Cubre el pedido original: marcarla colapsa el ejercicio (con
 * palomita + resumen, aunque falten series), persiste tras recargar,
 * desplegar con la flecha para editar no la desmarca, desmarcarla
 * vuelve a dejarlo pendiente, aplica a los dos modos (series y simple)
 * con el mismo campo (no uno duplicado), no toca la cola + puntero del
 * día, un campo con foco nunca se colapsa, el aviso opcional de "todos
 * hechos", y que la casilla no quede tapada por el FAB a 375px/iPad.
 *
 * Cómo correr (requiere Node y Playwright ya instalados):
 *   node tests/gym-exercise-done.test.js
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

async function openDay3(page) {
  await page.goto(indexPath);
  await setNow(page, "2026-10-20T10:00:00");
  await page.waitForTimeout(250);
  await page.locator('.tab-button[data-tab="gimnasio"]:visible').first().click();
  await page.waitForTimeout(150);
  await page.locator(".gym-day-head h4", { hasText: "Día 3" }).click();
  await page.waitForTimeout(100);
}

// ---------- Prueba 1: marcar Hecho colapsa (con palomita + resumen,
// aunque falten series), persiste, y editar con la flecha no la
// desmarca ----------
async function testMarkDoneCollapsesAndPersists(browser) {
  const { context, page, errors } = await newPage(browser);
  await openDay3(page);

  // Hip Thrust (b6d3e1, modo series): una sola serie, a propósito sin
  // llenar el RIR (parcial) — "Hecho" debe cerrarlo igual.
  const hipThrustCard = page.locator(".gym-exercise-card", { hasText: "Hip Thrust" });
  await hipThrustCard.locator(".gym-set-actions button", { hasText: "Agregar serie" }).click();
  await page.waitForTimeout(80);
  await hipThrustCard.locator(".gym-set-weight").fill("250");
  await hipThrustCard.locator(".gym-set-reps").fill("12");
  await hipThrustCard.locator(".gym-set-reps").blur();
  await page.waitForTimeout(100);

  const doneCheckbox = hipThrustCard.locator(".gym-exercise-done-row input[type=checkbox]");
  check(await doneCheckbox.isVisible(), 'Prueba 1: la casilla "Hecho" está al final del bloque del ejercicio');
  await doneCheckbox.click();
  await page.waitForTimeout(150);

  const collapsedCard = page.locator(".gym-exercise-card", { hasText: "Hip Thrust" });
  check(await collapsedCard.evaluate((el) => el.classList.contains("collapsed")), "Prueba 1: se colapsa solo al marcar Hecho");
  const headText = await collapsedCard.locator(".gym-exercise-toggle").textContent();
  check(headText.includes("✓"), "Prueba 1: el encabezado muestra la palomita");
  const summary = await collapsedCard.locator(".gym-exercise-summary").textContent().catch(() => null);
  check(!!summary && summary.includes("250") && summary.includes("12"), `Prueba 1: muestra el resumen aunque falte el RIR ("${summary}")`);

  const doneInData = await page.evaluate(() => {
    const log = window.Agenda.state.getGymWeekDay(6, 1, 3).exercises["b6d3e1"];
    return log && log.done;
  });
  check(doneInData === true, "Prueba 1: queda guardado done=true en el mismo documento de gimnasio");

  // "Cierra y reabre" dentro de 3h: sigue colapsado.
  await setNow(page, "2026-10-20T11:00:00");
  await page.reload();
  await page.waitForTimeout(300);
  // Día 3 ya queda recordado y abierto solo (ver syncPositionOnMount:
  // la casilla "Hecho" también toca la posición), no hace falta
  // volver a abrirlo a mano.
  const afterReload = page.locator(".gym-exercise-card", { hasText: "Hip Thrust" });
  check(await afterReload.evaluate((el) => el.classList.contains("collapsed")), "Prueba 1: sigue colapsado tras recargar la app");

  // Desplegar con la flecha para editar: se ven los campos, sigue Hecho.
  await afterReload.locator(".gym-exercise-toggle").click();
  await page.waitForTimeout(80);
  const expandedCard = page.locator(".gym-exercise-card", { hasText: "Hip Thrust" });
  check(!(await expandedCard.evaluate((el) => el.classList.contains("collapsed"))), "Prueba 1: la flecha lo despliega para editar");
  check(await expandedCard.locator(".gym-set-weight").isVisible(), "Prueba 1: se ven los campos de la serie al desplegarlo");
  check(await expandedCard.locator(".gym-exercise-done-row input[type=checkbox]").isChecked(), 'Prueba 1: sigue marcado "Hecho" al desplegarlo');

  // Volver a colapsar con la flecha: sigue Hecho.
  await expandedCard.locator(".gym-exercise-toggle").click();
  await page.waitForTimeout(80);
  const recollapsed = page.locator(".gym-exercise-card", { hasText: "Hip Thrust" });
  check(await recollapsed.evaluate((el) => el.classList.contains("collapsed")), 'Prueba 1: al volver a colapsar queda como "Hecho"');

  console.log("Prueba 1 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 1: sin errores de JS");
  await context.close();
}

// ---------- Prueba 2: desmarcar vuelve a dejarlo pendiente ----------
async function testUnmarkReturnsToPending(browser) {
  const { context, page, errors } = await newPage(browser);
  await openDay3(page);

  const rdlCard = page.locator(".gym-exercise-card", { hasText: "Peso Muerto Rumano" });
  await rdlCard.locator(".gym-exercise-done-row input[type=checkbox]").click();
  await page.waitForTimeout(150);
  check(
    await page.locator(".gym-exercise-card", { hasText: "Peso Muerto Rumano" }).evaluate((el) => el.classList.contains("collapsed")),
    "Prueba 2: queda colapsado al marcarlo"
  );

  // Desplegarlo y desmarcar.
  await page.locator(".gym-exercise-card", { hasText: "Peso Muerto Rumano" }).locator(".gym-exercise-toggle").click();
  await page.waitForTimeout(80);
  await page.locator(".gym-exercise-card", { hasText: "Peso Muerto Rumano" }).locator(".gym-exercise-done-row input[type=checkbox]").click();
  await page.waitForTimeout(150);

  const doneInData = await page.evaluate(() => {
    const log = window.Agenda.state.getGymWeekDay(6, 1, 3).exercises["b6d3e2"];
    return log && log.done;
  });
  check(doneInData === false, "Prueba 2: queda done=false en el dato al desmarcarlo");
  const afterUncheck = page.locator(".gym-exercise-card", { hasText: "Peso Muerto Rumano" });
  check(!(await afterUncheck.evaluate((el) => el.classList.contains("collapsed"))), "Prueba 2: queda desplegado (pendiente) tras desmarcarlo");

  console.log("Prueba 2 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 2: sin errores de JS");
  await context.close();
}

// ---------- Prueba 3: modo "simple" reusa el mismo campo, sin duplicar ----------
async function testSimpleModeReusesSameField(browser) {
  const { context, page, errors } = await newPage(browser);
  await openDay3(page);

  // Pantorrilla Sentado (b6d3e4) es "simple" (sin peso): ya tenía su
  // propia casilla "Hecho" de toda la vida — confirma que sigue siendo
  // el mismo campo `done`, no uno nuevo por separado.
  const card = page.locator(".gym-exercise-card", { hasText: "Pantorrilla Sentado" });
  const checkboxCount = await card.locator('input[type=checkbox]').count();
  check(checkboxCount === 1, `Prueba 3: un ejercicio "simple" tiene una sola casilla "Hecho" (encontradas: ${checkboxCount})`);
  await card.locator('input[type=checkbox]').click();
  await page.waitForTimeout(150);

  const log = await page.evaluate(() => window.Agenda.state.getGymWeekDay(6, 1, 3).exercises["b6d3e4"]);
  check(log && log.done === true, 'Prueba 3: marcar la casilla "simple" de siempre guarda en el mismo campo `done`');
  check(
    await page.locator(".gym-exercise-card", { hasText: "Pantorrilla Sentado" }).evaluate((el) => el.classList.contains("collapsed")),
    'Prueba 3: también se colapsa (misma regla de "Hecho" para los dos modos)'
  );

  console.log("Prueba 3 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 3: sin errores de JS");
  await context.close();
}

// ---------- Prueba 4: no toca la cola + puntero del día ----------
async function testDoesNotAffectQueueStatus(browser) {
  const { context, page, errors } = await newPage(browser);
  await openDay3(page);

  const before = await page.evaluate(() => window.Agenda.state.getGymResolution("2026-10-20"));

  const card = page.locator(".gym-exercise-card", { hasText: "Hip Thrust" });
  await card.locator(".gym-exercise-done-row input[type=checkbox]").click();
  await page.waitForTimeout(150);

  const after = await page.evaluate(() => window.Agenda.state.getGymResolution("2026-10-20"));
  check(JSON.stringify(before) === JSON.stringify(after), "Prueba 4: marcar Hecho no cambia el estado de la sesión (cola + puntero)");

  console.log("Prueba 4 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 4: sin errores de JS");
  await context.close();
}

// ---------- Prueba 5: aviso opcional "Todos los ejercicios hechos" ----------
async function testAllDoneNotice(browser) {
  const { context, page, errors } = await newPage(browser);
  await openDay3(page);

  // Día 3 tiene 5 ejercicios (Hip Thrust, Peso Muerto Rumano, Curl
  // Femoral, Pantorrilla Sentado [simple], Crunch en Máquina).
  const names = ["Hip Thrust", "Peso Muerto Rumano", "Curl Femoral", "Pantorrilla Sentado", "Crunch en Máquina"];
  for (const name of names) {
    const card = page.locator(".gym-exercise-card", { hasText: name });
    await card.locator('input[type=checkbox]').first().click();
    await page.waitForTimeout(100);
  }

  const noticeVisible = await page.locator(".gym-day-all-done").isVisible();
  check(noticeVisible, "Prueba 5: aparece el aviso al marcar todos los ejercicios del día");

  // Desmarca uno: el aviso desaparece, y nada quedó marcado solo.
  await page.locator(".gym-exercise-card", { hasText: "Crunch en Máquina" }).locator(".gym-exercise-toggle").click();
  await page.waitForTimeout(80);
  await page
    .locator(".gym-exercise-card", { hasText: "Crunch en Máquina" })
    .locator(".gym-exercise-done-row input[type=checkbox]")
    .click();
  await page.waitForTimeout(150);
  const noticeGone = await page.locator(".gym-day-all-done").count();
  check(noticeGone === 0, "Prueba 5: el aviso desaparece apenas uno deja de estar marcado");

  console.log("Prueba 5 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 5: sin errores de JS");
  await context.close();
}

// ---------- Prueba 6: no colapsa un ejercicio con un campo enfocado ----------
async function testDoesNotCollapseFocusedField(browser) {
  const { context, page, errors } = await newPage(browser);
  await openDay3(page);

  const card = page.locator(".gym-exercise-card", { hasText: "Curl Femoral" });
  await card.locator(".gym-set-actions button", { hasText: "Agregar serie" }).click();
  await page.waitForTimeout(80);
  const repsInput = card.locator(".gym-set-reps");
  await repsInput.click();
  await repsInput.type("14", { delay: 20 }); // sin blur: queda con foco y sin flush todavía

  // Simula un "Hecho" que llega de otro dispositivo (Firebase) para
  // ESTE MISMO ejercicio mientras se sigue escribiendo acá: no debe
  // colapsarlo ni hacerle perder el foco/lo ya tecleado.
  await page.evaluate(() => window.Agenda.state.setGymExerciseDone(6, 1, 3, "b6d3e3", true));
  await page.waitForTimeout(150);

  const stillExpanded = page.locator(".gym-exercise-card", { hasText: "Curl Femoral" });
  check(!(await stillExpanded.evaluate((el) => el.classList.contains("collapsed"))), "Prueba 6: no se colapsa mientras un campo suyo tiene foco");
  const focusedKey = await page.evaluate(() => document.activeElement && document.activeElement.dataset.gymFocusKey);
  check(!!focusedKey && focusedKey.includes("b6d3e3"), "Prueba 6: el campo sigue enfocado tras el redibujado");
  const stillHasTyped = await repsInput.inputValue();
  check(stillHasTyped === "14", 'Prueba 6: no se pierde lo ya tecleado ("14")');

  console.log("Prueba 6 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 6: sin errores de JS");
  await context.close();
}

// ---------- Prueba 7: 375px e iPad — casilla visible, área táctil,
// no tapada por el FAB ----------
async function testViewports(browser) {
  for (const [label, viewport] of [
    ["375px", { width: 375, height: 812 }],
    ["iPad", { width: 1024, height: 1366 }],
  ]) {
    const { context, page, errors } = await newPage(browser, viewport);
    await openDay3(page);

    const card = page.locator(".gym-exercise-card", { hasText: "Hip Thrust" });
    const doneRow = card.locator(".gym-exercise-done-row");
    check(await doneRow.isVisible(), `Prueba 7 (${label}): la casilla "Hecho" es visible`);
    const box = await doneRow.boundingBox();
    check(box.height >= 44, `Prueba 7 (${label}): el área táctil mide al menos 44px de alto (${box.height})`);

    const fab = page.locator(".fab");
    const fabBox = await fab.boundingBox();
    const overlap = !(
      box.x + box.width <= fabBox.x ||
      fabBox.x + fabBox.width <= box.x ||
      box.y + box.height <= fabBox.y ||
      fabBox.y + fabBox.height <= box.y
    );
    check(!overlap, `Prueba 7 (${label}): la casilla no queda tapada por el FAB "+"`);

    console.log(`Prueba 7 (${label}) — errores de página:`, JSON.stringify(errors));
    check(errors.length === 0, `Prueba 7 (${label}): sin errores de JS`);
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  try {
    await testMarkDoneCollapsesAndPersists(browser);
    await testUnmarkReturnsToPending(browser);
    await testSimpleModeReusesSameField(browser);
    await testDoesNotAffectQueueStatus(browser);
    await testAllDoneNotice(browser);
    await testDoesNotCollapseFocusedField(browser);
    await testViewports(browser);
  } finally {
    await browser.close();
  }
  console.log(fails === 0 ? "\nTODO OK" : `\n${fails} FALLAS`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
