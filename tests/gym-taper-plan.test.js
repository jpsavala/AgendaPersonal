/*
 * Prueba de "Plan Rumbo al 10k" (PDF subido el 17 nov 2026): adapta el
 * taper de las dos semanas previas a la carrera (29 nov) en Gimnasio
 * (Bloques 7 y 8, ver js/gymRoutines.js/js/state.js: migrateGymTaperPlan)
 * y en la corrida entre semana/domingos (ver js/trainingSchedule.js),
 * reflejado en la Diaria y la Semanal sin código nuevo ahí (los bloques
 * ya leen genéricamente de estas estructuras).
 *
 * Cómo correr (requiere Node y Playwright ya instalados):
 *   node tests/gym-taper-plan.test.js
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

// ---------- Prueba 1: Gimnasio — Bloques 7 y 8 existen con la rutina
// exacta del plan, sin tocar los Bloques 5/6 ----------
async function testGymBlocksSeeded(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(indexPath);
  await page.waitForTimeout(250);

  const data = await page.evaluate(() => {
    const s = window.Agenda.state;
    return {
      blockNumbers: s.getGymBlockNumbers(),
      visibleBlockNumbers: s.getVisibleGymBlockNumbers(),
      meta7: s.getGymBlockMeta(7),
      meta8: s.getGymBlockMeta(8),
      day1Torso: s.getGymRoutineDay(7, 1),
      day3Glufem: s.getGymRoutineDay(7, 3),
      day8Empuje: s.getGymRoutineDay(8, 2),
      meta6: s.getGymBlockMeta(6),
    };
  });

  check(data.blockNumbers.includes(7) && data.blockNumbers.includes(8), "Prueba 1: los Bloques 7 y 8 existen");
  check(data.meta7.startDate === "2026-11-17" && data.meta7.endDate === "2026-11-21", 'Prueba 1: Bloque 7 cubre 17-21 nov');
  check(JSON.stringify(data.meta7.dayNames) === JSON.stringify(["Torso", "Empuje", "Glúteo/Femoral", "Tracción"]), "Prueba 1: Bloque 7 tiene 4 días, sin Cuádriceps");
  check(data.day1Torso.find((e) => e.name.includes("Press de Pecho")).target === "3 x 8-10, 2 min, 105-110 lb", 'Prueba 1: Torso (mar 17) con el peso 80% correcto');
  check(data.day3Glufem.find((e) => e.name.includes("Hip Thrust")).target.includes("170-175"), "Prueba 1: Glúteo/Femoral (jue 19) al 70%, peso correcto");
  check(data.meta8.startDate === "2026-11-23" && data.meta8.endDate === "2026-11-29", "Prueba 1: Bloque 8 cubre 23-29 nov");
  check(JSON.stringify(data.meta8.dayNames) === JSON.stringify(["Torso ligero", "Empuje ligero"]), "Prueba 1: Bloque 8 tiene solo 2 días");
  check(data.day8Empuje.length === 3, "Prueba 1: Empuje ligero (mar 24) tiene menos ejercicios que el Empuje normal");

  // Reorganización pedida el 17 nov 2026: el Bloque 6 deja de
  // seleccionarse en Gimnasio, pero su historial (20 oct-16 nov) sigue
  // intacto en la cuenta; Bloques 7/8 pasan a llamarse "Bloque SP 1"/
  // "Bloque S2", cada uno con una sola semana.
  check(!!data.meta6 && data.meta6.endDate === "2026-11-16", "Prueba 1: Bloque 6 conserva su historial, sin tocarse");
  check(data.meta6.hidden === true, "Prueba 1: Bloque 6 está oculto (hidden) del selector");
  check(data.blockNumbers.includes(6) && !data.visibleBlockNumbers.includes(6), "Prueba 1: Bloque 6 sigue existiendo pero no aparece entre los visibles");
  check(data.meta7.label === "Bloque SP 1" && data.meta7.weekCount === 1, 'Prueba 1: Bloque 7 ahora es "Bloque SP 1" con una sola semana');
  check(data.meta8.label === "Bloque S2" && data.meta8.weekCount === 1, 'Prueba 1: Bloque 8 ahora es "Bloque S2" con una sola semana');

  console.log("Prueba 1 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 1: sin errores de JS");
  await context.close();
}

// ---------- Prueba 2: Diaria/Semanal muestran el gym y la corrida del
// plan para cada fecha, sin código nuevo en esas vistas ----------
async function testDailyWeeklyReflectPlan(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(indexPath);
  await page.waitForTimeout(250);

  const expected = {
    "2026-11-17": "Torso",
    "2026-11-18": "Empuje",
    "2026-11-19": "Glúteo/Femoral",
    "2026-11-20": "Tracción",
    "2026-11-23": "Torso ligero",
    "2026-11-24": "Empuje ligero",
  };
  const runExpected = {
    "2026-11-18": "Correr - 4-5km suaves",
    "2026-11-20": "Correr - 3-4km suaves",
    "2026-11-25": "Correr - 4km suaves",
    "2026-11-27": "Correr - 2-3km suaves",
  };

  await page.locator('.tab-button[data-tab="diaria"]:visible').first().click();
  await page.waitForTimeout(150);
  for (const [dateStr, session] of Object.entries(expected)) {
    await page.locator(".date-picker").fill(dateStr);
    await page.waitForTimeout(100);
    const gymBlock = page.locator(".schedule-block").filter({ has: page.locator(".schedule-label", { hasText: "Gimnasio" }) });
    const text = await gymBlock.locator(".schedule-readonly-text, .gym-actions").first().innerText().catch(() => "");
    check(text.includes(session) || (await gymBlock.innerText()).includes(session), `Prueba 2: Diaria ${dateStr} muestra "${session}"`);
  }
  for (const [dateStr, runText] of Object.entries(runExpected)) {
    await page.locator(".date-picker").fill(dateStr);
    await page.waitForTimeout(100);
    const runBlock = page.locator(".schedule-block").filter({ has: page.locator(".schedule-label", { hasText: "Correr" }) });
    check((await runBlock.innerText()).includes(runText.replace("Correr - ", "")), `Prueba 2: Diaria ${dateStr} muestra la corrida "${runText}"`);
  }

  // Semanal: la semana del 16-22 nov debe mostrar lo mismo.
  await page.locator('.tab-button[data-tab="semanal"]:visible').first().click();
  await page.waitForTimeout(150);
  await page.locator(".date-picker").fill("2026-11-17").catch(() => {});
  const weekText = await page.locator(".week-days-grid").innerText();
  check(weekText.includes("Torso") && weekText.includes("Empuje") && weekText.includes("Tracción"), "Prueba 2: la Semanal también refleja los días de gym del plan");

  console.log("Prueba 2 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 2: sin errores de JS");
  await context.close();
}

// ---------- Prueba 2b: el selector de Gimnasio ya no ofrece el Bloque
// 6, muestra "Bloque SP 1"/"Bloque S2", y cada uno con una sola pestaña
// "Semana 1" (sin Semana 2/3/4 vacías) ----------
async function testGymSelectorUI(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(indexPath);
  await page.waitForTimeout(250);

  await page.locator('.tab-button[data-tab="gimnasio"]:visible').first().click();
  await page.waitForTimeout(150);

  const blockLabels = await page.locator(".gym-block-selector .toggle-btn").allInnerTexts();
  check(!blockLabels.some((t) => t.includes("Bloque 6")), 'Prueba 2b: el selector no ofrece "Bloque 6"');
  check(blockLabels.includes("Bloque SP 1"), 'Prueba 2b: el selector ofrece "Bloque SP 1"');
  check(blockLabels.includes("Bloque S2"), 'Prueba 2b: el selector ofrece "Bloque S2"');

  await page.locator(".gym-block-selector .toggle-btn", { hasText: "Bloque SP 1" }).click();
  await page.waitForTimeout(100);
  const sp1Weeks = await page.locator(".gym-week-tabs .toggle-btn").allInnerTexts();
  check(JSON.stringify(sp1Weeks) === JSON.stringify(["Semana 1"]), `Prueba 2b: "Bloque SP 1" tiene solo "Semana 1" (fue ${JSON.stringify(sp1Weeks)})`);

  await page.locator(".gym-block-selector .toggle-btn", { hasText: "Bloque S2" }).click();
  await page.waitForTimeout(100);
  const s2Weeks = await page.locator(".gym-week-tabs .toggle-btn").allInnerTexts();
  check(JSON.stringify(s2Weeks) === JSON.stringify(["Semana 1"]), `Prueba 2b: "Bloque S2" tiene solo "Semana 1" (fue ${JSON.stringify(s2Weeks)})`);

  console.log("Prueba 2b — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 2b: sin errores de JS");
  await context.close();
}

// ---------- Prueba 3: la corrida larga del domingo 22 sube a 8km, y la
// carrera del 29 sigue igual ----------
async function testSundayRuns(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(indexPath);
  await page.waitForTimeout(250);

  const result = await page.evaluate(() => {
    const s = window.Agenda.state;
    const block22 = s.getDayBlocks("2026-11-22").find((b) => b.id === "correr");
    const block29 = s.getDayBlocks("2026-11-29").find((b) => b.id === "correr");
    return { text22: block22 && block22.text, text29: block29 && block29.text };
  });
  check(result.text22 === "Correr - 8km muy lento (~7:00/km)", `Prueba 3: domingo 22 es "8km muy lento" (fue "${result.text22}")`);
  check(result.text29 === "Carrera - 10km", `Prueba 3: la carrera del 29 sigue "Carrera - 10km" (fue "${result.text29}")`);

  console.log("Prueba 3 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 3: sin errores de JS");
  await context.close();
}

// ---------- Prueba 4: persiste tras recargar y no se vuelve a crear
// dos veces (migración idempotente) ----------
async function testPersistsAndIdempotent(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(indexPath);
  await page.waitForTimeout(250);
  await page.evaluate(() => window.Agenda.state.getGymBlockNumbers()); // fuerza la migración si no corrió

  await page.reload();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => {
    const s = window.Agenda.state;
    return { blocks: s.getGymBlockNumbers(), day1: s.getGymRoutineDay(7, 1).length };
  });
  check(after.blocks.includes(7) && after.blocks.includes(8), "Prueba 4: los Bloques 7/8 siguen ahí tras recargar");
  check(after.day1 === 6, "Prueba 4: la rutina de Torso (Bloque 7) sigue con sus 6 ejercicios, no se duplicó");

  console.log("Prueba 4 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 4: sin errores de JS");
  await context.close();
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  try {
    await testGymBlocksSeeded(browser);
    await testDailyWeeklyReflectPlan(browser);
    await testGymSelectorUI(browser);
    await testSundayRuns(browser);
    await testPersistsAndIdempotent(browser);
  } finally {
    await browser.close();
  }
  console.log(fails === 0 ? "\nTODO OK" : `\n${fails} FALLAS`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
