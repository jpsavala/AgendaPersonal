/*
 * Prueba del botón "Cumplido" en el panel "Pendientes no cumplidos de
 * la semana anterior" (vista Semanal, ver js/weeklyView.js:
 * markPendienteComplete / js/state.js: setPendienteDoneInWeek).
 *
 * Cubre el pedido original: marcar cumplido saca el renglón del panel
 * (con una transición breve) y lo deja tachado en su día/bloque
 * original (mismo dato, no una copia); "Deshacer" lo regresa; aplica a
 * los tres tipos (trabajo, personal, paradas); persiste y sincroniza
 * tras un reload; y los dos botones no se cortan a 375px ni en iPad.
 *
 * Cómo correr (requiere Node y Playwright ya instalados):
 *   node tests/weekly-unfinished-complete.test.js
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

async function goToWeekly(page) {
  await page.locator('.tab-button[data-tab="semanal"]:visible').first().click();
  await page.waitForTimeout(150);
}

async function newPage(browser, viewport) {
  const context = await browser.newContext({ viewport: viewport || { width: 460, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(mockDateScript("2026-11-03T10:00:00"));
  return { context, page, errors };
}

// "Hoy" mockeado = martes 3 de nov de 2026 -> semana actual (Semanal)
// arranca el lunes 2; la semana anterior (donde se siembran los
// pendientes sueltos) es la del lunes 26 de octubre.
const PREVIOUS_MONDAY = "2026-10-26";

async function seedUnfinishedItems(page) {
  await page.evaluate((previousMonday) => {
    window.Agenda.state.addWeekTrabajoPendiente(previousMonday, "Entregar reporte", ["mon"], "oficina_manana");
    window.Agenda.state.addWeekPersonalPendiente(previousMonday, "Renovar la licencia", ["wed"]);
    window.Agenda.state.addParada("2026-10-28", "Pasar por el banco"); // miércoles de esa semana
  }, PREVIOUS_MONDAY);
}

async function panelRowTexts(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".check-row.unfinished-row")).map((r) => r.querySelector("span")?.textContent)
  );
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });

  // ---------- Prueba principal: marcar, deshacer, y el dato original ----------
  {
    const { context, page, errors } = await newPage(browser);
    await page.goto(indexPath);
    await page.waitForTimeout(250);
    await seedUnfinishedItems(page);
    await goToWeekly(page);

    let rows = await panelRowTexts(page);
    check(rows.length === 3, `Prueba 1: el panel muestra los 3 pendientes sueltos sembrados (encontrados: ${rows.length})`);
    check(rows.includes("Entregar reporte"), "Prueba 1: incluye el de trabajo");
    check(rows.includes("Renovar la licencia"), "Prueba 1: incluye el de vida personal");
    check(rows.includes("Pasar por el banco"), "Prueba 1: incluye la parada");

    // Cada renglón tiene los dos botones.
    const trabajoRow = page.locator(".check-row.unfinished-row", { hasText: "Entregar reporte" });
    check(await trabajoRow.locator("button", { hasText: "Mover a esta semana" }).isVisible(), "Prueba 1: tiene \"Mover a esta semana\"");
    check(await trabajoRow.locator("button", { hasText: "Cumplido" }).isVisible(), "Prueba 1: tiene \"Cumplido\"");

    // Marca "Entregar reporte" (trabajo) como cumplido.
    await trabajoRow.locator("button", { hasText: "Cumplido" }).click();
    await page.waitForTimeout(50);
    const hasCompletingClass = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".check-row.unfinished-row")).some((r) => r.classList.contains("completing"))
    );
    check(hasCompletingClass, "Prueba 1: el renglón recibe la clase de transición al tocar \"Cumplido\"");

    await page.waitForTimeout(300);
    rows = await panelRowTexts(page);
    check(!rows.includes("Entregar reporte"), "Prueba 1: sale del panel tras marcarlo cumplido");
    check(rows.length === 2, `Prueba 1: quedan 2 en el panel (encontrados: ${rows.length})`);

    const doneInOrigin = await page.evaluate((mon) => {
      const items = window.Agenda.state.getWeekTrabajoPendientes(mon);
      const it = items.find((p) => p.text === "Entregar reporte");
      return it && it.done;
    }, PREVIOUS_MONDAY);
    check(doneInOrigin === true, "Prueba 1: queda done=true en su semana de origen (mismo dato, no copia)");

    // El mismo pendiente, visto desde su día/bloque original en la
    // Diaria, aparece tachado.
    await page.locator('.tab-button[data-tab="diaria"]:visible').first().click();
    await page.waitForTimeout(100);
    await page.locator(".date-picker").fill("2026-10-26"); // lunes 26 (dayKeys: ["mon"])
    await page.locator(".date-picker").dispatchEvent("change");
    await page.waitForTimeout(150);
    const priorityDoneInDaily = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll(".check-row")).find((r) => r.textContent.includes("Entregar reporte"));
      return !!(row && row.classList.contains("done"));
    });
    check(priorityDoneInDaily, "Prueba 1: en la Diaria (lunes 26, su día original) aparece tachado");

    // Toast con "Deshacer".
    await goToWeekly(page);
    const toastVisible = await page.locator("#quick-capture-toast.show").isVisible().catch(() => false);
    check(toastVisible, 'Prueba 1: aparece el aviso ("Marcado como cumplido")');
    const undoBtn = page.locator(".quick-capture-toast-undo");
    check(await undoBtn.isVisible(), 'Prueba 1: el aviso tiene "Deshacer"');
    await undoBtn.click();
    await page.waitForTimeout(150);

    rows = await panelRowTexts(page);
    check(rows.includes("Entregar reporte"), '"Deshacer" regresa el pendiente al panel');
    const doneAfterUndo = await page.evaluate((mon) => {
      const items = window.Agenda.state.getWeekTrabajoPendientes(mon);
      const it = items.find((p) => p.text === "Entregar reporte");
      return it && it.done;
    }, PREVIOUS_MONDAY);
    check(doneAfterUndo === false, '"Deshacer" lo regresa a no cumplido en el dato');

    console.log("Prueba 1 — errores de página:", JSON.stringify(errors));
    check(errors.length === 0, "Prueba 1: sin errores de JS");
    await context.close();
  }

  // ---------- Prueba 2: los 3 tipos, panel vacío, y persistencia tras reload ----------
  {
    const { context, page, errors } = await newPage(browser);
    await page.goto(indexPath);
    await page.waitForTimeout(250);
    await seedUnfinishedItems(page);
    await goToWeekly(page);

    for (const text of ["Entregar reporte", "Renovar la licencia", "Pasar por el banco"]) {
      const row = page.locator(".check-row.unfinished-row", { hasText: text });
      await row.locator("button", { hasText: "Cumplido" }).click();
      await page.waitForTimeout(300);
    }

    const emptyMsgVisible = await page
      .locator(".card", { hasText: "Cerraste la semana pasada sin pendientes sueltos." })
      .isVisible();
    check(emptyMsgVisible, "Prueba 2: con los 3 marcados, el panel muestra el aviso de vacío");

    // Recarga completa: confirma que persiste (localStorage) y que el
    // panel sigue vacío tras un reload real, no solo en memoria.
    await page.reload();
    await page.waitForTimeout(300);
    await goToWeekly(page);
    const emptyAfterReload = await page
      .locator(".card", { hasText: "Cerraste la semana pasada sin pendientes sueltos." })
      .isVisible();
    check(emptyAfterReload, "Prueba 2: sigue vacío después de recargar la página (persiste)");

    const allDone = await page.evaluate((mon) => {
      const trabajo = window.Agenda.state.getWeekTrabajoPendientes(mon);
      const personal = window.Agenda.state.getWeekPersonalPendientes(mon);
      const paradas = window.Agenda.state.getWeekParadas(mon);
      return (
        trabajo.every((p) => p.done) &&
        personal.every((p) => p.done) &&
        paradas.every((p) => p.done)
      );
    }, PREVIOUS_MONDAY);
    check(allDone, "Prueba 2: los tres tipos quedan cumplidos en el dato tras el reload");

    console.log("Prueba 2 — errores de página:", JSON.stringify(errors));
    check(errors.length === 0, "Prueba 2: sin errores de JS");
    await context.close();
  }

  // ---------- Prueba 3: 375px e iPad, sin cortes ni superposición ----------
  for (const [label, viewport] of [
    ["375px", { width: 375, height: 812 }],
    ["iPad", { width: 1024, height: 1366 }],
  ]) {
    const { context, page, errors } = await newPage(browser, viewport);
    await page.goto(indexPath);
    await page.waitForTimeout(250);
    await seedUnfinishedItems(page);
    await goToWeekly(page);

    const row = page.locator(".check-row.unfinished-row", { hasText: "Entregar reporte" });
    const moverBtn = row.locator("button", { hasText: "Mover a esta semana" });
    const cumplidoBtn = row.locator("button", { hasText: "Cumplido" });
    check(await moverBtn.isVisible(), `Prueba 3 (${label}): "Mover a esta semana" visible`);
    check(await cumplidoBtn.isVisible(), `Prueba 3 (${label}): "Cumplido" visible`);

    const moverBox = await moverBtn.boundingBox();
    const cumplidoBox = await cumplidoBtn.boundingBox();
    const overlap = !(
      moverBox.x + moverBox.width <= cumplidoBox.x ||
      cumplidoBox.x + cumplidoBox.width <= moverBox.x ||
      moverBox.y + moverBox.height <= cumplidoBox.y ||
      cumplidoBox.y + cumplidoBox.height <= moverBox.y
    );
    check(!overlap, `Prueba 3 (${label}): los dos botones no se superponen`);

    const rowBox = await row.boundingBox();
    const viewportWidth = viewport.width;
    check(rowBox.x + rowBox.width <= viewportWidth + 1, `Prueba 3 (${label}): el renglón no se corta del ancho de pantalla`);

    console.log(`Prueba 3 (${label}) — errores de página:`, JSON.stringify(errors));
    check(errors.length === 0, `Prueba 3 (${label}): sin errores de JS`);
    await context.close();
  }

  await browser.close();
  console.log(fails === 0 ? "\nTODO OK" : `\n${fails} FALLAS`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
