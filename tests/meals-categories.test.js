/*
 * Prueba de la reorganización de la pestaña "Comidas" en secciones
 * colapsables por categoría (ver js/mealsView.js, js/state.js:
 * migrateMealCategories/getMealLibraryGrouped/addMealCategory/
 * setMealCategory), y de que los selectores de Comida/Cena de la
 * Diaria y la Semanal muestren esas mismas categorías agrupadas (ver
 * js/dailyView.js y js/weeklyView.js: buildMealSelector).
 *
 * Cubre el pedido original: secciones por categoría con contador,
 * todas arrancan colapsadas, abrir una no abre las demás, agregar una
 * receta nueva con categoría aparece en su sección, las recetas ya
 * existentes quedan clasificadas por nombre o en "Sin categoría" sin
 * perder ninguna, persistencia tras recargar, los selectores de
 * Comida/Cena agrupan por categoría, y área táctil de 44px en los
 * encabezados a 375px/iPad.
 *
 * Cómo correr (requiere Node y Playwright ya instalados):
 *   node tests/meals-categories.test.js
 */
const { chromium } = require("playwright");
const path = require("path");

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
  return { context, page, errors };
}

async function gotoComidas(page) {
  await page.goto(indexPath);
  await page.waitForTimeout(250);
  await page.locator('.tab-button[data-tab="comidas"]:visible').first().click();
  await page.waitForTimeout(100);
}

function categorySection(page, title) {
  return page.locator(".meal-category-section").filter({ has: page.locator(".meal-category-title", { hasText: title }) });
}

async function addMeal(page, name, categoryLabel) {
  const input = page.locator('input.add-input[placeholder^="Nueva comida"]');
  await input.fill(name);
  if (categoryLabel) {
    const select = page.locator("select.meal-category-select").first();
    await select.selectOption({ label: categoryLabel });
  }
  await page.locator("button", { hasText: "Agregar" }).first().click();
  await page.waitForTimeout(80);
}

// ---------- Prueba 1: migración — recetas "viejas" (sin campo
// category, como las guardadas antes de esta función) se clasifican
// por nombre o quedan en "Sin categoría", sin perder ninguna; todas
// las secciones arrancan colapsadas ----------
async function testMigrationAutoClassifiesLegacyMeals(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(indexPath);
  await page.waitForTimeout(250);

  // Simula una librería guardada ANTES de que existieran las
  // categorías: ids/nombres reales, sin ningún campo `category`.
  await page.evaluate(() => {
    const raw = window.Agenda.state.getRawData();
    raw.mealLibrary = [
      { id: "legacy1", name: "Pollo al horno" },
      { id: "legacy2", name: "Bistec de res" },
      { id: "legacy3", name: "Camarones al ajillo" },
      { id: "legacy4", name: "Ensalada César" },
    ];
    delete raw.mealCategories;
    window.Agenda.state.replaceAllData(raw);
  });

  const totalAfter = await page.evaluate(() => window.Agenda.state.getMealLibrary().length);
  check(totalAfter === 4, "Prueba 1: la migración no perdió ninguna receta (siguen las 4)");

  await page.locator('.tab-button[data-tab="comidas"]:visible').first().click();
  await page.waitForTimeout(100);

  check(await categorySection(page, "Pollo (1)").isVisible(), 'Prueba 1: "Pollo al horno" se clasificó sola en "Pollo (1)"');
  check(await categorySection(page, "Carnes (1)").isVisible(), 'Prueba 1: "Bistec de res" se clasificó sola en "Carnes (1)"');
  check(await categorySection(page, "Mar (1)").isVisible(), 'Prueba 1: "Camarones al ajillo" se clasificó sola en "Mar (1)"');
  check(await categorySection(page, "Sin categoría (1)").isVisible(), 'Prueba 1: "Ensalada César" (no encaja en ninguna regla) quedó en "Sin categoría (1)"');

  // Colapsadas por defecto: ningún .meal-row visible todavía.
  check((await page.locator(".meal-row").count()) === 0, "Prueba 1: todas las secciones arrancan colapsadas (sin filas visibles)");

  console.log("Prueba 1 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 1: sin errores de JS");
  await context.close();
}

// ---------- Prueba 2: abrir una sección no abre las demás ----------
async function testIndependentToggle(browser) {
  const { context, page, errors } = await newPage(browser);
  await gotoComidas(page);
  await addMeal(page, "Pollo al horno", "Pollo");
  await addMeal(page, "Bistec de res", "Carnes");
  await addMeal(page, "Camarones al ajillo", "Mar");

  await categorySection(page, "Pollo (1)").locator(".meal-category-head").click();
  await page.waitForTimeout(80);

  check(
    await categorySection(page, "Pollo (1)").locator(".meal-name-input").isVisible(),
    'Prueba 2: abrir "Pollo" muestra su receta'
  );
  check(
    (await categorySection(page, "Carnes (1)").locator(".meal-name-input").count()) === 0,
    'Prueba 2: "Carnes" sigue colapsada'
  );
  check(
    (await categorySection(page, "Mar (1)").locator(".meal-name-input").count()) === 0,
    'Prueba 2: "Mar" sigue colapsada'
  );

  console.log("Prueba 2 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 2: sin errores de JS");
  await context.close();
}

// ---------- Prueba 3: agregar una receta nueva con categoría "Mar"
// elegida a mano aparece en esa sección ----------
async function testAddWithExplicitCategory(browser) {
  const { context, page, errors } = await newPage(browser);
  await gotoComidas(page);
  await addMeal(page, "Delicia especial", "Mar");

  check(await categorySection(page, "Mar (1)").isVisible(), 'Prueba 3: "Delicia especial" (sin palabra clave) quedó en "Mar" por el selector');
  await categorySection(page, "Mar (1)").locator(".meal-category-head").click();
  await page.waitForTimeout(80);
  check(
    await categorySection(page, "Mar (1)").locator(".meal-name-input").inputValue() === "Delicia especial",
    'Prueba 3: la receta aparece dentro de la sección "Mar" al desplegarla'
  );

  console.log("Prueba 3 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 3: sin errores de JS");
  await context.close();
}

// ---------- Prueba 4: cambiar la categoría de una receta ya existente
// con su selector la mueve de sección ----------
async function testChangeCategoryMovesSection(browser) {
  const { context, page, errors } = await newPage(browser);
  await gotoComidas(page);
  await addMeal(page, "Receta sin clasificar");

  check(await categorySection(page, "Sin categoría (1)").isVisible(), 'Prueba 4: arranca en "Sin categoría (1)"');
  await categorySection(page, "Sin categoría (1)").locator(".meal-category-head").click();
  await page.waitForTimeout(80);
  await categorySection(page, "Sin categoría (1)").locator("select.meal-category-select").selectOption({ label: "Pollo" });
  await page.waitForTimeout(80);

  check(await categorySection(page, "Pollo (1)").isVisible(), 'Prueba 4: la receta se movió a "Pollo (1)"');
  check((await page.locator(".meal-category-title", { hasText: "Sin categoría" }).count()) === 0, 'Prueba 4: "Sin categoría" ya no tiene secciones (0 recetas, no ocupa espacio)');

  console.log("Prueba 4 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 4: sin errores de JS");
  await context.close();
}

// ---------- Prueba 5: "+ Categoría" agrega una categoría nueva sin
// tocar las existentes, disponible de inmediato en los selectores ----------
async function testAddNewCategory(browser) {
  const { context, page, errors } = await newPage(browser);
  await gotoComidas(page);

  await page.locator('input.add-input[placeholder^="Nueva categoría"]').fill("Vegetariano");
  await page.locator("button", { hasText: "+ Categoría" }).click();
  await page.waitForTimeout(80);

  await addMeal(page, "Tofu salteado", "Vegetariano");
  check(await categorySection(page, "Vegetariano (1)").isVisible(), 'Prueba 5: la categoría nueva "Vegetariano" funciona de inmediato');
  const categoryOptionLabels = await page
    .locator("select.meal-category-select")
    .first()
    .locator("option")
    .evaluateAll((els) => els.map((el) => el.textContent));
  check(categoryOptionLabels.includes("Pollo"), 'Prueba 5: las categorías de siempre ("Pollo") siguen disponibles, sin tocarse');
  check(categoryOptionLabels.includes("Vegetariano"), 'Prueba 5: "Vegetariano" quedó disponible en el selector');

  console.log("Prueba 5 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 5: sin errores de JS");
  await context.close();
}

// ---------- Prueba 6: persistencia tras recargar (datos y
// clasificación), secciones vuelven a colapsarse ----------
async function testPersistsAndRecollapsesAfterReload(browser) {
  const { context, page, errors } = await newPage(browser);
  await gotoComidas(page);
  await addMeal(page, "Pollo al horno", "Pollo");
  await addMeal(page, "Bistec de res", "Carnes");
  await categorySection(page, "Pollo (1)").locator(".meal-category-head").click();
  await page.waitForTimeout(80);
  check(await categorySection(page, "Pollo (1)").locator(".meal-name-input").isVisible(), 'Prueba 6: "Pollo" queda abierta antes de recargar');

  await page.reload();
  await page.waitForTimeout(250);
  await page.locator('.tab-button[data-tab="comidas"]:visible').first().click();
  await page.waitForTimeout(100);

  check(await categorySection(page, "Pollo (1)").isVisible(), 'Prueba 6: tras recargar, "Pollo al horno" sigue clasificada');
  check(await categorySection(page, "Carnes (1)").isVisible(), 'Prueba 6: tras recargar, "Bistec de res" sigue clasificada');
  check(
    (await page.locator(".meal-name-input").count()) === 0,
    "Prueba 6: tras recargar y reabrir la pestaña, las secciones vuelven a estar colapsadas"
  );

  console.log("Prueba 6 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 6: sin errores de JS");
  await context.close();
}

// ---------- Prueba 7: no se pierde ninguna receta (mismo total antes
// y después de clasificar) ----------
async function testNoMealsLost(browser) {
  const { context, page, errors } = await newPage(browser);
  await gotoComidas(page);
  const names = ["Pollo al horno", "Bistec de res", "Camarones al ajillo", "Ensalada César", "Sopa misteriosa"];
  for (const name of names) await addMeal(page, name);

  const total = await page.evaluate(() => window.Agenda.state.getMealLibrary().length);
  check(total === names.length, `Prueba 7: el total de recetas (${total}) coincide con lo agregado (${names.length})`);

  // Abre todas las secciones visibles y cuenta las filas totales.
  const headCount = await page.locator(".meal-category-head").count();
  for (let i = 0; i < headCount; i += 1) {
    await page.locator(".meal-category-head").nth(i).click();
    await page.waitForTimeout(40);
  }
  const rowsVisible = await page.locator(".meal-row").count();
  check(rowsVisible === names.length, `Prueba 7: con todas las secciones abiertas se ven las ${names.length} recetas (ninguna se perdió)`);

  console.log("Prueba 7 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 7: sin errores de JS");
  await context.close();
}

// ---------- Prueba 8: el selector de Comida/Cena en la Diaria agrupa
// por categoría (optgroup), sin cambiar la pregunta "¿Se repite?" ----------
async function testDailySelectorGrouped(browser) {
  const { context, page, errors } = await newPage(browser);
  await gotoComidas(page);
  await addMeal(page, "Pollo al horno", "Pollo");
  await addMeal(page, "Bistec de res", "Carnes");

  await page.locator('.tab-button[data-tab="diaria"]:visible').first().click();
  await page.waitForTimeout(150);
  // Un lunes puntual: en fin de semana la Diaria no muestra Comida/Cena
  // (ver js/state.js: getDayBlocks usa getWeekendBlocks en su lugar).
  await page.locator(".date-picker").fill("2026-11-09");
  await page.waitForTimeout(150);

  const comidaBlock = page.locator(".schedule-block").filter({ has: page.locator(".schedule-label", { hasText: "Comida" }) });
  check(await comidaBlock.locator("p", { hasText: "¿Se repite la comida de ayer?" }).isVisible(), 'Prueba 8: Comida sigue con su pregunta "¿Se repite?" (sin cambios)');
  await comidaBlock.locator("button", { hasText: "Cocino" }).click();
  await page.waitForTimeout(80);

  const comidaOptgroups = await comidaBlock.locator("select.meal-select optgroup").evaluateAll((els) => els.map((el) => el.label));
  check(comidaOptgroups.includes("Pollo"), 'Prueba 8: el selector de Comida tiene un grupo "Pollo"');
  check(comidaOptgroups.includes("Carnes"), 'Prueba 8: el selector de Comida tiene un grupo "Carnes"');

  const cenaBlock = page.locator(".schedule-block").filter({ has: page.locator(".schedule-label", { hasText: "Cena" }) });
  await cenaBlock.locator("button", { hasText: "Cocino" }).click();
  await page.waitForTimeout(80);
  const cenaOptgroups = await cenaBlock.locator("select.meal-select optgroup").evaluateAll((els) => els.map((el) => el.label));
  check(cenaOptgroups.includes("Pollo"), 'Prueba 8: el selector de Cena también agrupa por categoría ("Pollo")');

  console.log("Prueba 8 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 8: sin errores de JS");
  await context.close();
}

// ---------- Prueba 9: el selector agrupado también aparece en la
// Semanal (mismo dato) ----------
async function testWeeklySelectorGrouped(browser) {
  const { context, page, errors } = await newPage(browser);
  await gotoComidas(page);
  await addMeal(page, "Pollo al horno", "Pollo");

  await page.locator('.tab-button[data-tab="semanal"]:visible').first().click();
  await page.waitForTimeout(150);

  const comidaLabel = page.locator("label.field-label", { hasText: "Comida" }).first();
  check(await comidaLabel.isVisible(), "Prueba 9: la Semanal muestra el bloque de Comida");
  const dayCard = page.locator(".week-day-card").first();
  await dayCard.locator("button", { hasText: "Cocino" }).first().click();
  await page.waitForTimeout(80);
  const optgroups = await dayCard.locator("select.meal-select optgroup").first().evaluate((el) => el.label);
  check(optgroups === "Pollo", 'Prueba 9: el selector de Comida en la Semanal también agrupa ("Pollo")');

  console.log("Prueba 9 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 9: sin errores de JS");
  await context.close();
}

// ---------- Prueba 10: 375px e iPad — encabezados con 44px de área
// táctil, usables ----------
async function testViewports(browser) {
  for (const [label, viewport] of [
    ["375px", { width: 375, height: 812 }],
    ["iPad", { width: 768, height: 1024 }],
  ]) {
    const { context, page, errors } = await newPage(browser, viewport);
    await gotoComidas(page);
    await addMeal(page, "Pollo al horno", "Pollo");
    await addMeal(page, "Bistec de res", "Carnes");

    const head = categorySection(page, "Pollo (1)").locator(".meal-category-head");
    const box = await head.boundingBox();
    check(box.height >= 44, `Prueba 10 (${label}): el encabezado de categoría mide al menos 44px de alto (${box.height})`);

    await head.click();
    await page.waitForTimeout(80);
    check(await categorySection(page, "Pollo (1)").locator(".meal-name-input").isVisible(), `Prueba 10 (${label}): tocar el encabezado despliega la sección`);
    check(
      (await categorySection(page, "Carnes (1)").locator(".meal-name-input").count()) === 0,
      `Prueba 10 (${label}): "Carnes" sigue colapsada`
    );

    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    check(noOverflow, `Prueba 10 (${label}): sin desborde horizontal`);

    console.log(`Prueba 10 (${label}) — errores de página:`, JSON.stringify(errors));
    check(errors.length === 0, `Prueba 10 (${label}): sin errores de JS`);
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  try {
    await testMigrationAutoClassifiesLegacyMeals(browser);
    await testIndependentToggle(browser);
    await testAddWithExplicitCategory(browser);
    await testChangeCategoryMovesSection(browser);
    await testAddNewCategory(browser);
    await testPersistsAndRecollapsesAfterReload(browser);
    await testNoMealsLost(browser);
    await testDailySelectorGrouped(browser);
    await testWeeklySelectorGrouped(browser);
    await testViewports(browser);
  } finally {
    await browser.close();
  }
  console.log(fails === 0 ? "\nTODO OK" : `\n${fails} FALLAS`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
