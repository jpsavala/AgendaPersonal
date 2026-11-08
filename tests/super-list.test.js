/*
 * Prueba de la sección "Súper" dentro de la pestaña Comidas (ver
 * js/mealsView.js: buildSuperCard y alrededores, js/state.js:
 * getSuperList/getPantrySuggestions/buildSuperListText y las
 * funciones de ingredientes/despensa/extras).
 *
 * Cubre el pedido original: ingredientes por receta, la lista de la
 * semana sumando ingredientes de recetas repetidas (una sola vez) y de
 * recetas distintas con el mismo ingrediente (sumado, con origen),
 * despensa con casilla "Necesito esta semana", extras con aprendizaje
 * (propuesta de pasar a despensa tras 2+ semanas, "No" la silencia),
 * "Ya tengo" con deshacer, "Copiar lista", persistencia tras recargar,
 * y 375px/iPad.
 *
 * Cómo correr (requiere Node y Playwright ya instalados):
 *   node tests/super-list.test.js
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

// Abre Comidas con "hoy" mockeado al lunes dado, y sincroniza la
// semana que muestra "Súper" con esa fecha (su currentSuperMonday se
// calcula al cargar el módulo, antes de que la fecha simulada esté en
// localStorage — "Esta semana" la recalcula ya con Date() simulado,
// mismo caso que weeklyView en tests/cena-repeat.test.js).
async function gotoComidasAtWeek(page, mondayStr) {
  await page.goto(indexPath);
  await setNow(page, `${mondayStr}T10:00:00`);
  await page.waitForTimeout(250);
  await page.locator('.tab-button[data-tab="comidas"]:visible').first().click();
  await page.waitForTimeout(100);
  await page.locator(".super-card button", { hasText: "Esta semana" }).click();
  await page.waitForTimeout(100);
}

function superCard(page) {
  return page.locator(".super-card");
}

function superRow(page, name) {
  return superCard(page).locator(".super-row").filter({ has: page.locator(".super-row-name", { hasText: name }) });
}

// La fila "Agregar artículo..." del Súper, ubicada por :has() nativo
// (en vez de la opción `has` de Playwright, que encadena el selector
// completo del locator dado — incluido el prefijo ".super-card" con el
// que arma extraInput más abajo — y por eso nunca matchea).
function extraAddRow(page) {
  return superCard(page).locator('.add-row:has(input[placeholder="Agregar artículo..."])');
}

async function addExtraViaUi(page, name, qty) {
  const row = extraAddRow(page);
  await row.locator('input.add-input[placeholder="Agregar artículo..."]').fill(name);
  if (qty) await row.locator("input.ingredient-qty-input").fill(qty);
  await row.locator("button", { hasText: "Agregar" }).click();
}

// ---------- Prueba 1: ingredientes de dos recetas con el mismo
// ingrediente se suman en la lista, con origen de las dos; la misma
// receta elegida dos días cuenta una sola vez ----------
async function testIngredientMergeAndDedup(browser) {
  const { context, page, errors } = await newPage(browser);
  const monday = "2026-11-09";
  await gotoComidasAtWeek(page, monday);

  await page.evaluate((monday) => {
    const s = window.Agenda.state;
    const bolonesa = s.addMeal("Boloñesa", "carnes");
    s.addIngredient(bolonesa.id, { name: "Cebolla", qty: "1", unit: "" });
    s.addIngredient(bolonesa.id, { name: "Carne molida", qty: "500", unit: "g" });
    const pollo = s.addMeal("Pollo a la plancha", "pollo");
    s.addIngredient(pollo.id, { name: "cebolla", qty: "2", unit: "" });
    // Boloñesa el lunes (comida y cena) y el martes (comida): cuenta
    // una sola vez aunque aparezca en tres bloques/días distintos.
    s.setBlockText(monday, "preparar_comida", "Boloñesa");
    s.setBlockText(monday, "cena", "Boloñesa");
    const tuesday = window.Agenda.dateUtils.toISO(window.Agenda.dateUtils.addDays(window.Agenda.dateUtils.fromISO(monday), 1));
    s.setBlockText(tuesday, "preparar_comida", "Boloñesa");
    const wednesday = window.Agenda.dateUtils.toISO(window.Agenda.dateUtils.addDays(window.Agenda.dateUtils.fromISO(monday), 2));
    s.setBlockText(wednesday, "cena", "Pollo a la plancha");
  }, monday);

  await page.reload();
  await setNow(page, `${monday}T10:00:00`);
  await page.waitForTimeout(250);
  await page.locator('.tab-button[data-tab="comidas"]:visible').first().click();
  await page.waitForTimeout(100);
  await page.locator(".super-card button", { hasText: "Esta semana" }).click();
  await page.waitForTimeout(100);

  const cebollaRow = superRow(page, "Cebolla");
  check(await cebollaRow.isVisible(), 'Prueba 1: "Cebolla" aparece en el Súper');
  const cebollaText = await cebollaRow.locator(".super-row-name").innerText();
  check(cebollaText.includes("3"), `Prueba 1: "Cebolla" suma las cantidades de las dos recetas (1+2=3): "${cebollaText}"`);
  const origin = await cebollaRow.locator(".super-row-origin").innerText();
  check(origin.includes("Boloñesa") && origin.includes("Pollo a la plancha"), `Prueba 1: el origen lista las dos recetas: "${origin}"`);

  const carneRow = superRow(page, "Carne molida");
  check(await carneRow.isVisible(), 'Prueba 1: "Carne molida" aparece aparte (Pollo no la tiene)');
  const carneOrigin = await carneRow.locator(".super-row-origin").innerText();
  check(
    carneOrigin === "Boloñesa",
    `Prueba 1: "Carne molida" lista a "Boloñesa" una sola vez aunque se elija dos días distintos: "${carneOrigin}"`
  );

  console.log("Prueba 1 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 1: sin errores de JS");
  await context.close();
}

// ---------- Prueba 2: recetas elegidas sin ingredientes avisan
// "Faltan ingredientes en N recetas" ----------
async function testMissingIngredientsNotice(browser) {
  const { context, page, errors } = await newPage(browser);
  const monday = "2026-11-09";
  await gotoComidasAtWeek(page, monday);

  await page.evaluate((monday) => {
    const s = window.Agenda.state;
    s.addMeal("Sopa sin ingredientes");
    s.setBlockText(monday, "preparar_comida", "Sopa sin ingredientes");
  }, monday);
  await page.reload();
  await setNow(page, `${monday}T10:00:00`);
  await page.waitForTimeout(250);
  await page.locator('.tab-button[data-tab="comidas"]:visible').first().click();
  await page.waitForTimeout(100);
  await page.locator(".super-card button", { hasText: "Esta semana" }).click();
  await page.waitForTimeout(100);

  const notice = superCard(page).locator(".super-missing-notice");
  check(await notice.isVisible(), 'Prueba 2: aparece el aviso de ingredientes faltantes');
  const text = await notice.innerText();
  check(text.includes("1") && text.includes("Sopa sin ingredientes"), `Prueba 2: el aviso nombra la receta: "${text}"`);

  console.log("Prueba 2 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 2: sin errores de JS");
  await context.close();
}

// ---------- Prueba 3: despensa — marcar "Necesito esta semana" la
// agrega a la lista; desmarcar la quita ----------
async function testPantryNeededToggle(browser) {
  const { context, page, errors } = await newPage(browser);
  const monday = "2026-11-09";
  await gotoComidasAtWeek(page, monday);

  const pantryInput = superCard(page).locator('input.add-input[placeholder^="Nuevo artículo de despensa"]');
  await pantryInput.fill("Sal");
  await superCard(page).locator(".pantry-section button", { hasText: "Agregar" }).click();
  await page.waitForTimeout(80);

  check((await superRow(page, "Sal").count()) === 0, 'Prueba 3: "Sal" todavía no está en la lista (sin marcar)');

  const checkbox = superCard(page).locator(".pantry-item-row", { hasText: "Necesito esta semana" }).locator("input[type=checkbox]");
  await checkbox.check();
  await page.waitForTimeout(80);
  check(await superRow(page, "Sal").isVisible(), 'Prueba 3: marcar "Necesito esta semana" agrega "Sal" a la lista');

  await superCard(page).locator(".pantry-item-row").locator("input[type=checkbox]").first().uncheck();
  await page.waitForTimeout(80);
  check((await superRow(page, "Sal").count()) === 0, 'Prueba 3: desmarcar la quita de la lista');

  console.log("Prueba 3 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 3: sin errores de JS");
  await context.close();
}

// ---------- Prueba 4: extras — agregar "avena" en dos semanas distintas
// propone pasarla a la despensa; "No" la silencia ----------
async function testExtraLearningAndDismiss(browser) {
  const { context, page, errors } = await newPage(browser);
  const monday1 = "2026-11-09";
  await gotoComidasAtWeek(page, monday1);

  await addExtraViaUi(page, "avena");
  await page.waitForTimeout(80);
  check(await superRow(page, "avena").isVisible(), 'Prueba 4: "avena" se agregó como extra de esta semana');
  check((await superCard(page).locator(".pantry-suggestion").count()) === 0, "Prueba 4: con una sola semana, todavía no propone pasarla a la despensa");

  // Semana siguiente: mismo extra, segunda semana distinta -> propuesta.
  const monday2 = "2026-11-16";
  await gotoComidasAtWeek(page, monday2);
  await addExtraViaUi(page, "avena");
  await page.waitForTimeout(80);

  const suggestion = superCard(page).locator(".pantry-suggestion", { hasText: "avena" });
  check(await suggestion.isVisible(), 'Prueba 4: tras 2 semanas distintas, propone "¿Agregar a tu despensa?"');
  await suggestion.locator("button", { hasText: "No" }).click();
  await page.waitForTimeout(80);
  check((await superCard(page).locator(".pantry-suggestion", { hasText: "avena" }).count()) === 0, 'Prueba 4: "No" la silencia');
  check(
    (await superCard(page).locator(".pantry-item-row", { hasText: "avena" }).count()) === 0,
    'Prueba 4: "No" no la agregó a la despensa'
  );

  // Recargar y confirmar que sigue silenciada (no vuelve a preguntar).
  await page.reload();
  await setNow(page, `${monday2}T10:00:00`);
  await page.waitForTimeout(250);
  await page.locator('.tab-button[data-tab="comidas"]:visible').first().click();
  await page.waitForTimeout(100);
  await page.locator(".super-card button", { hasText: "Esta semana" }).click();
  await page.waitForTimeout(100);
  check(
    (await superCard(page).locator(".pantry-suggestion", { hasText: "avena" }).count()) === 0,
    "Prueba 4: tras recargar, sigue sin volver a preguntar por avena"
  );

  console.log("Prueba 4 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 4: sin errores de JS");
  await context.close();
}

// ---------- Prueba 4b: aceptar la propuesta ("Sí") la agrega a la
// despensa de verdad ----------
async function testExtraLearningAccept(browser) {
  const { context, page, errors } = await newPage(browser);
  const monday1 = "2026-11-09";
  await gotoComidasAtWeek(page, monday1);
  await addExtraViaUi(page, "quinoa");
  await page.waitForTimeout(80);

  const monday2 = "2026-11-16";
  await gotoComidasAtWeek(page, monday2);
  await addExtraViaUi(page, "quinoa");
  await page.waitForTimeout(80);

  const suggestion = superCard(page).locator(".pantry-suggestion", { hasText: "quinoa" });
  check(await suggestion.isVisible(), 'Prueba 4b: propone pasar "quinoa" a la despensa');
  await suggestion.locator("button", { hasText: "Sí" }).click();
  await page.waitForTimeout(80);
  check(
    await superCard(page).locator(".pantry-item-name-input[value='quinoa']").isVisible(),
    'Prueba 4b: "Sí" la agrega de verdad a la despensa'
  );

  console.log("Prueba 4b — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 4b: sin errores de JS");
  await context.close();
}

// ---------- Prueba 5: "Ya tengo" oculta un renglón de receta; se
// puede deshacer ----------
async function testHideAndUndo(browser) {
  const { context, page, errors } = await newPage(browser);
  const monday = "2026-11-09";
  await gotoComidasAtWeek(page, monday);
  await page.evaluate((monday) => {
    const s = window.Agenda.state;
    const meal = s.addMeal("Ensalada");
    s.addIngredient(meal.id, { name: "Lechuga", qty: "", unit: "" });
    s.setBlockText(monday, "preparar_comida", "Ensalada");
  }, monday);
  await page.reload();
  await setNow(page, `${monday}T10:00:00`);
  await page.waitForTimeout(250);
  await page.locator('.tab-button[data-tab="comidas"]:visible').first().click();
  await page.waitForTimeout(100);
  await page.locator(".super-card button", { hasText: "Esta semana" }).click();
  await page.waitForTimeout(100);

  const row = superRow(page, "Lechuga");
  check(await row.isVisible(), 'Prueba 5: "Lechuga" aparece en la lista');
  await row.locator("button", { hasText: "Ya tengo" }).click();
  await page.waitForTimeout(80);
  check((await superRow(page, "Lechuga").count()) === 0, 'Prueba 5: "Ya tengo" oculta el renglón');

  await page.locator(".quick-capture-toast-undo").click();
  await page.waitForTimeout(80);
  check(await superRow(page, "Lechuga").isVisible(), 'Prueba 5: "Deshacer" lo vuelve a mostrar');

  console.log("Prueba 5 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 5: sin errores de JS");
  await context.close();
}

// ---------- Prueba 6: "Copiar lista" produce texto correcto (sin los
// ya comprados) ----------
async function testCopyList(browser) {
  const { context, page, errors } = await newPage(browser);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const monday = "2026-11-09";
  await gotoComidasAtWeek(page, monday);
  await page.evaluate((monday) => {
    const s = window.Agenda.state;
    const meal = s.addMeal("Tacos");
    s.addIngredient(meal.id, { name: "Tortillas", qty: "10", unit: "" });
    s.setBlockText(monday, "cena", "Tacos");
    s.addWeekExtra(monday, "Papel aluminio", "");
  }, monday);
  await page.reload();
  await setNow(page, `${monday}T10:00:00`);
  await page.waitForTimeout(250);
  await page.locator('.tab-button[data-tab="comidas"]:visible').first().click();
  await page.waitForTimeout(100);
  await page.locator(".super-card button", { hasText: "Esta semana" }).click();
  await page.waitForTimeout(100);

  // Marca "Papel aluminio" como comprado: no debe aparecer en el texto.
  await superRow(page, "Papel aluminio").locator("input[type=checkbox]").check();
  await page.waitForTimeout(80);

  await superCard(page).locator("button", { hasText: "Copiar lista" }).click();
  await page.waitForTimeout(150);
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  check(clipboard.includes("Tortillas (10)"), `Prueba 6: el texto incluye "Tortillas (10)": "${clipboard}"`);
  check(!clipboard.includes("Papel aluminio"), `Prueba 6: no incluye lo ya comprado: "${clipboard}"`);

  console.log("Prueba 6 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 6: sin errores de JS");
  await context.close();
}

// ---------- Prueba 7: persistencia tras recargar (comprado, despensa
// necesitada y extras siguen igual) ----------
async function testPersistsAfterReload(browser) {
  const { context, page, errors } = await newPage(browser);
  const monday = "2026-11-09";
  await gotoComidasAtWeek(page, monday);
  await page.evaluate((monday) => {
    const s = window.Agenda.state;
    s.addWeekExtra(monday, "Servilletas", "");
  }, monday);
  await page.reload();
  await setNow(page, `${monday}T10:00:00`);
  await page.waitForTimeout(250);
  await page.locator('.tab-button[data-tab="comidas"]:visible').first().click();
  await page.waitForTimeout(100);
  await page.locator(".super-card button", { hasText: "Esta semana" }).click();
  await page.waitForTimeout(100);

  await superRow(page, "Servilletas").locator("input[type=checkbox]").check();
  await page.waitForTimeout(80);

  await page.reload();
  await setNow(page, `${monday}T10:00:00`);
  await page.waitForTimeout(250);
  await page.locator('.tab-button[data-tab="comidas"]:visible').first().click();
  await page.waitForTimeout(100);
  await page.locator(".super-card button", { hasText: "Esta semana" }).click();
  await page.waitForTimeout(100);

  const row = superRow(page, "Servilletas");
  check(await row.isVisible(), 'Prueba 7: "Servilletas" sigue en la lista tras recargar');
  check(await row.evaluate((el) => el.classList.contains("bought")), "Prueba 7: y sigue marcada como comprada");

  console.log("Prueba 7 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 7: sin errores de JS");
  await context.close();
}

// ---------- Prueba 8: 375px e iPad — casillas y campos usables, sin
// desborde ----------
async function testViewports(browser) {
  for (const [label, viewport] of [
    ["375px", { width: 375, height: 812 }],
    ["iPad", { width: 768, height: 1024 }],
  ]) {
    const { context, page, errors } = await newPage(browser, viewport);
    const monday = "2026-11-09";
    await gotoComidasAtWeek(page, monday);
    await page.evaluate((monday) => {
      const s = window.Agenda.state;
      const meal = s.addMeal("Arroz");
      s.addIngredient(meal.id, { name: "Arroz", qty: "1", unit: "kg" });
      s.setBlockText(monday, "preparar_comida", "Arroz");
      s.addPantryItem("Sal");
    }, monday);
    await page.reload();
    await setNow(page, `${monday}T10:00:00`);
    await page.waitForTimeout(250);
    await page.locator('.tab-button[data-tab="comidas"]:visible').first().click();
    await page.waitForTimeout(100);
    await page.locator(".super-card button", { hasText: "Esta semana" }).click();
    await page.waitForTimeout(100);

    const row = superRow(page, "Arroz");
    const rowBox = await row.locator(".super-row-check-label").boundingBox();
    check(rowBox.height >= 44, `Prueba 8 (${label}): el renglón del Súper mide al menos 44px (${rowBox.height})`);

    const pantryCheckLabel = superCard(page).locator(".pantry-item-check-label").first();
    const pantryBox = await pantryCheckLabel.boundingBox();
    check(pantryBox.height >= 44, `Prueba 8 (${label}): "Necesito esta semana" mide al menos 44px (${pantryBox.height})`);

    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    check(noOverflow, `Prueba 8 (${label}): sin desborde horizontal`);

    console.log(`Prueba 8 (${label}) — errores de página:`, JSON.stringify(errors));
    check(errors.length === 0, `Prueba 8 (${label}): sin errores de JS`);
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  try {
    await testIngredientMergeAndDedup(browser);
    await testMissingIngredientsNotice(browser);
    await testPantryNeededToggle(browser);
    await testExtraLearningAndDismiss(browser);
    await testExtraLearningAccept(browser);
    await testHideAndUndo(browser);
    await testCopyList(browser);
    await testPersistsAfterReload(browser);
    await testViewports(browser);
  } finally {
    await browser.close();
  }
  console.log(fails === 0 ? "\nTODO OK" : `\n${fails} FALLAS`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
