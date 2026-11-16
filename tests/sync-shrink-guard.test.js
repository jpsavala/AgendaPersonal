/*
 * Prueba del freno de seguridad contra sincronizaciones que borrarían
 * datos sin avisar (ver js/firebaseSync.js: isSuspiciousShrink/
 * pushNow/applyRemote).
 *
 * Nace de un reporte real: la cuenta dueña perdió las Semanas 1 y 2 de
 * Gimnasio (solo quedó la Semana 3) — consistente con "último que
 * guarda, gana" (ver el comentario de arriba de firebaseSync.js: no
 * hay merge campo por campo) dejando que un dispositivo con una copia
 * vieja o incompleta le ganara, sin aviso, a datos mucho más ricos.
 *
 * Esta prueba reemplaza el SDK real de Firebase (js/vendor/
 * firebase-compat.js) por uno falso en memoria, para poder simular a
 * mano el escenario exacto (un "remoto" chico contra un "local" rico,
 * y viceversa) sin depender de un proyecto de Firebase real.
 *
 * Cómo correr (requiere Node y Playwright ya instalados):
 *   node tests/sync-shrink-guard.test.js
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

// SDK falso de Firebase: solo lo que firebaseSync.js usa (auth.
// onAuthStateChanged/signOut, firestore().collection().doc() con get/
// set/onSnapshot). El estado "remoto" vive en window.__remoteStore
// (en memoria, por doc path) para que la prueba lo pueda leer/escribir
// directamente, simulando "otro dispositivo" sin red real.
const FAKE_FIREBASE_SCRIPT = `
window.__remoteStore = {};
// El SDK real permite varios listeners de onAuthStateChanged a la vez
// (firebaseSync.js registra uno, userConfigSync.js otro) — un único
// slot que se sobrescribe perdería el primero en vez de avisarles a
// los dos, como hace el SDK real.
window.__authCallbacks = [];
window.__triggerAuth = function (user) {
  window.__authCallbacks.forEach((cb) => cb(user));
};
function makeDocRef(path) {
  return {
    get: function () {
      const data = window.__remoteStore[path];
      return Promise.resolve({
        exists: data !== undefined,
        data: function () { return data; },
      });
    },
    set: function (value) {
      window.__remoteStore[path] = value;
      (window.__remoteListeners && window.__remoteListeners[path] || []).forEach((cb) => {
        cb({ exists: true, data: function () { return value; } });
      });
      return Promise.resolve();
    },
    onSnapshot: function (cb) {
      window.__remoteListeners = window.__remoteListeners || {};
      window.__remoteListeners[path] = window.__remoteListeners[path] || [];
      window.__remoteListeners[path].push(cb);
      return function () {};
    },
  };
}
window.firebase = {
  initializeApp: function () {},
  firestore: function () {
    return {
      settings: function () {},
      enablePersistence: function () { return Promise.resolve().catch(() => {}); },
      collection: function (name) {
        return { doc: function (id) { return makeDocRef(name + "/" + id); } };
      },
    };
  },
  auth: function () {
    return {
      onAuthStateChanged: function (cb) { window.__authCallbacks.push(cb); },
      signOut: function () { window.__triggerAuth(null); return Promise.resolve(); },
      signInWithEmailAndPassword: function () { return Promise.resolve(); },
      createUserWithEmailAndPassword: function () { return Promise.resolve(); },
    };
  },
};
`;

async function newPage(browser) {
  const context = await browser.newContext({ viewport: { width: 460, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/js/vendor/firebase-compat.js", (route) => {
    route.fulfill({ contentType: "application/javascript", body: FAKE_FIREBASE_SCRIPT });
  });
  return { context, page, errors };
}

// Datos realistas (grandes, como los que motivaron el freno): un
// data.gymBlocks[6].weeks con N semanas de 5 días, cada uno con dos
// ejercicios de varias series — JSON.stringify de esto supera
// cómodamente el piso de 2000 caracteres del freno.
function makeGymPayload(weekNumbers) {
  function makeWeek() {
    const days = {};
    for (let d = 1; d <= 5; d++) {
      days[d] = {
        dayNote: "",
        exercises: {
          e1: { note: "", sets: [{ weight: 135, reps: 8, rir: 2 }, { weight: 135, reps: 8, rir: 2 }, { weight: 135, reps: 7, rir: 1 }] },
          e2: { note: "", sets: [{ weight: 95, reps: 10, rir: 2 }, { weight: 95, reps: 9, rir: 1 }] },
        },
      };
    }
    return days;
  }
  const weeks = {};
  weekNumbers.forEach((w) => { weeks[w] = makeWeek(); });
  return {
    habitsDefs: [],
    days: {},
    weeks: {},
    weekBlocks: {},
    mealLibrary: [],
    mealCategories: [],
    pantryItems: [],
    superWeeks: {},
    extrasHistory: {},
    events: {},
    yearGoals: {},
    monthMeta: {},
    quoteBag: { order: [], pointer: 0 },
    wordBag: { order: [], pointer: 0 },
    gymQueue: null,
    gymBlocks: { 6: { number: 6, sessions: [], startDate: "2026-10-20", endDate: "2026-11-16", pointer: 0, pointerAtSeed: 0, seedAnchor: "2026-10-20", resolutions: {}, unavailable: {}, weeks } },
    // Flags de migraciones de una sola vez (ver js/state.js:
    // runMigrations) ya aplicadas: sin esto, migrateGymBlocksStructure
    // reconstruiría data.gymBlocks desde cero (sin "weeks") al cargar
    // este payload sintético, tapando los datos que se están probando
    // antes de que la sincronización llegue a mirarlos.
    gymBlocksMigrated: true,
    gymRoutinesSeeded: true,
  };
}

const UID = "u1";

// Pasa el payload sintético por runMigrations() (ver js/state.js:
// replaceAllData) antes de usarlo: cualquier payload real, de
// cualquier dispositivo, ya pasó por ahí al menos una vez (siembra de
// hábitos por defecto, quoteBag/wordBag del año completo, etc.) — sin
// este paso, un "local" recién salido de runMigrations() (más pesado
// solo por ese relleno de siempre) se compararía en desventaja injusta
// contra un "remoto" crudo sin ese mismo relleno, y el freno de tamaño
// no reflejaría una comparación real.
async function realize(page, payload) {
  return page.evaluate((p) => {
    window.Agenda.state.replaceAllData(JSON.parse(JSON.stringify(p)));
    return window.Agenda.state.getRawData();
  }, payload);
}

async function seedLocal(page, payload) {
  const realized = await realize(page, payload);
  await page.evaluate((p) => localStorage.setItem("agenda_data_u1", JSON.stringify(p)), realized);
}

async function seedLocalSyncMeta(page, updatedAt) {
  await page.evaluate(
    (ts) => localStorage.setItem("agendaPersonal_v1_syncMeta_u1", JSON.stringify({ updatedAt: ts })),
    updatedAt
  );
}

async function seedRemote(page, payload, updatedAt) {
  const realized = await realize(page, payload);
  await page.evaluate(
    ({ p, ts }) => { window.__remoteStore["agendas/u1"] = { payload: p, updatedAt: ts }; },
    { p: realized, ts: updatedAt }
  );
}

async function triggerSignIn(page) {
  await page.evaluate((uid) => window.__triggerAuth({ uid, email: "test@example.com" }), UID);
}

// ---------- Prueba 1: un dispositivo con datos MUY pobres (solo
// Semana 3) no sobrescribe una nube con datos ricos (Semanas 1-3) al
// sincronizar — el push se frena (estado "conflict"), la nube queda
// intacta ----------
async function testPoorLocalDoesNotOverwriteRichRemote(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(indexPath);
  await page.waitForTimeout(150);

  const poorLocal = makeGymPayload([3]);
  const richRemote = makeGymPayload([1, 2, 3]);
  await seedLocal(page, poorLocal);
  // El local "piensa" que su propia versión es la más nueva (localTs
  // alto), para forzar la rama de push en vez de la de pull — así se
  // prueba específicamente el freno de pushNow(), no el de applyRemote.
  await seedLocalSyncMeta(page, 1000);
  await seedRemote(page, richRemote, 500);
  await triggerSignIn(page);
  await page.waitForTimeout(300);

  const status = await page.evaluate(() => window.Agenda.firebaseSync.getStatus());
  check(status === "conflict", `Prueba 1: el estado queda en "conflict" (fue "${status}")`);

  const remoteAfter = await page.evaluate(() => window.__remoteStore["agendas/u1"].payload);
  check(
    Object.keys(remoteAfter.gymBlocks[6].weeks).sort().join(",") === "1,2,3",
    "Prueba 1: la nube (rica, Semanas 1-3) no se tocó"
  );

  console.log("Prueba 1 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 1: sin errores de JS");
  await context.close();
}

// ---------- Prueba 2: una nube con datos MUY pobres no reemplaza los
// datos ricos que este dispositivo ya tiene — el dispositivo se queda
// con lo suyo (estado "conflict") ----------
async function testPoorRemoteDoesNotOverwriteRichLocal(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(indexPath);
  await page.waitForTimeout(150);

  const richLocal = makeGymPayload([1, 2, 3]);
  const poorRemote = makeGymPayload([3]);
  await seedLocal(page, richLocal);
  await seedLocalSyncMeta(page, 500);
  // El remoto parece más nuevo (updatedAt mayor) — simula el escenario
  // real: otro dispositivo, con menos datos, guardó después.
  await seedRemote(page, poorRemote, 1000);
  await triggerSignIn(page);
  await page.waitForTimeout(300);

  const status = await page.evaluate(() => window.Agenda.firebaseSync.getStatus());
  check(status === "conflict", `Prueba 2: el estado queda en "conflict" (fue "${status}")`);

  const localDataAfter = await page.evaluate(() => window.Agenda.state.getRawData());
  check(
    JSON.stringify(localDataAfter.gymBlocks[6].weeks) === JSON.stringify(richLocal.gymBlocks[6].weeks),
    "Prueba 2: este dispositivo conserva sus Semanas 1-3 (no las pisó la nube pobre)"
  );

  console.log("Prueba 2 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 2: sin errores de JS");
  await context.close();
}

// ---------- Prueba 3: una sincronización normal (tamaños parecidos, o
// creciendo) sigue funcionando igual que antes, sin falsos positivos ----------
async function testNormalSyncStillWorks(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(indexPath);
  await page.waitForTimeout(150);

  const localWithTwoWeeks = makeGymPayload([1, 2]);
  const remoteWithThreeWeeks = makeGymPayload([1, 2, 3]);
  await seedLocal(page, localWithTwoWeeks);
  await seedLocalSyncMeta(page, 500);
  await seedRemote(page, remoteWithThreeWeeks, 1000); // remoto más nuevo, con una semana más (creciendo)
  await triggerSignIn(page);
  await page.waitForTimeout(300);

  const status = await page.evaluate(() => window.Agenda.firebaseSync.getStatus());
  check(status === "synced", `Prueba 3: una sincronización normal (creciendo) no se frena (fue "${status}")`);
  const localDataAfter = await page.evaluate(() => window.Agenda.state.getRawData());
  check(!!localDataAfter.gymBlocks[6].weeks[3], "Prueba 3: el dispositivo recibió la Semana 3 nueva de la nube");

  console.log("Prueba 3 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 3: sin errores de JS");
  await context.close();
}

// ---------- Prueba 4: una cuenta nueva (nube vacía) sigue pudiendo
// subir sus datos locales sin que el freno la bloquee ----------
async function testFreshAccountStillPushes(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(indexPath);
  await page.waitForTimeout(150);

  const localData = makeGymPayload([1]);
  await seedLocal(page, localData);
  // Sin respaldo remoto todavía (cuenta nueva o primer dispositivo):
  // no se siembra window.__remoteStore para esta cuenta.
  await triggerSignIn(page);
  await page.waitForTimeout(300);

  const status = await page.evaluate(() => window.Agenda.firebaseSync.getStatus());
  check(status === "synced", `Prueba 4: cuenta nueva sincroniza normal, sin frenarse (fue "${status}")`);
  const remoteAfter = await page.evaluate(() => window.__remoteStore["agendas/u1"] && window.__remoteStore["agendas/u1"].payload);
  check(!!remoteAfter && !!remoteAfter.gymBlocks, "Prueba 4: subió los datos locales a la nube");

  console.log("Prueba 4 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 4: sin errores de JS");
  await context.close();
}

// ---------- Prueba 5: el aviso visible aparece cuando el estado es
// "conflict" y explica qué pasó, sin botón "Reintentar" ----------
async function testConflictBannerShows(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(indexPath);
  await page.waitForTimeout(150);

  const poorLocal = makeGymPayload([3]);
  const richRemote = makeGymPayload([1, 2, 3]);
  await seedLocal(page, poorLocal);
  await seedLocalSyncMeta(page, 1000);
  await seedRemote(page, richRemote, 500);
  await triggerSignIn(page);
  await page.waitForTimeout(300);

  const banner = page.locator("#sync-conflict-banner");
  check(await banner.isVisible(), 'Prueba 5: aparece el aviso "Sincronización pausada"');
  const text = await banner.innerText();
  check(text.includes("no se sobrescribió"), 'Prueba 5: el aviso explica que no se tocó ninguna copia');
  check((await banner.locator("button").count()) === 0, 'Prueba 5: sin botón "Reintentar" (no resuelve nada acá)');

  console.log("Prueba 5 — errores de página:", JSON.stringify(errors));
  check(errors.length === 0, "Prueba 5: sin errores de JS");
  await context.close();
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  try {
    await testPoorLocalDoesNotOverwriteRichRemote(browser);
    await testPoorRemoteDoesNotOverwriteRichLocal(browser);
    await testNormalSyncStillWorks(browser);
    await testFreshAccountStillPushes(browser);
    await testConflictBannerShows(browser);
  } finally {
    await browser.close();
  }
  console.log(fails === 0 ? "\nTODO OK" : `\n${fails} FALLAS`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
