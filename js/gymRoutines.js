/*
 * Datos de las rutinas de gimnasio por bloque: ejercicios con su
 * objetivo (referencia, no se registra ahí) y, cuando hay, el
 * historial ya registrado de alguna semana. Separado de js/state.js a
 * propósito (ver el pedido original, parte B.3: "deja la estructura
 * lista para [cargar la rutina] — por ejemplo, un archivo de datos del
 * bloque"): este archivo solo define datos, sin lógica; state.js los
 * usa como semilla UNA sola vez (ver migrateGymRoutinesSeed) y de ahí
 * en más todo vive en los datos de la cuenta (editable, sincronizado),
 * no acá — agregar un Bloque 7 más adelante es agregar otra entrada a
 * BLOCK_ROUTINES_SEED, sin tocar la de bloques anteriores.
 *
 * Cada ejercicio tiene "mode": "sets" (series con peso/reps/RIR, lo
 * normal) o "simple" (sin desglose de series: una sola casilla "hecho"
 * + una nota — ver el pedido original, parte B.2, "ejercicios que no
 * llevan peso").
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  function withIds(routineRaw, prefix) {
    const out = {};
    Object.keys(routineRaw).forEach((day) => {
      out[day] = routineRaw[day].map((e, i) => ({ id: `${prefix}d${day}e${i + 1}`, order: i, ...e }));
    });
    return out;
  }

  function ex(name, target) {
    return { name, target, mode: "sets" };
  }
  function exSimple(name, target) {
    return { name, target, mode: "simple" };
  }

  // ---------- Bloque 6 (20 oct - 16 nov 2026) ----------
  // Orden de cola de este bloque (igual al de GYM_BLOCK_6_ROUND en
  // state.js, repetido acá para que este archivo sea autocontenido):
  // Día 1 Torso, Día 2 Empuje, Día 3 Glúteo/Femoral, Día 4 Tracción,
  // Día 5 Cuádriceps.
  const BLOCK_6_DAY_NAMES = ["Torso", "Empuje", "Glúteo/Femoral", "Tracción", "Cuádriceps"];

  const BLOCK_6_RULES =
    "Nada a 0 RIR en este bloque.\n" +
    "Anotar peso, reps y RIR de cada serie.\n" +
    "Si no llegas al piso del rango, baja 5 lb.\n" +
    "Si sobran 4+ reps en la primera serie, sube 5 lb.\n" +
    "Trote suave el día después de pierna (jueves y lunes).";

  const BLOCK_6_PROGRESSION =
    "S1: pesos de partida, RIR 2-3.\n" +
    "S2: mismo peso, empujar hacia el techo del rango, RIR 2-3.\n" +
    "S3: si tocaste el techo con 2 RIR, sube 2.5-5 lb (5-10 lb en pierna). RIR 2; última serie de aislamiento a 1 RIR.\n" +
    "S4: descarga, ~70% del peso, 2 series por ejercicio, RIR 4.";

  const BLOCK_6_ROUTINE_RAW = {
    1: [
      // Día 1 Torso (martes)
      ex("Press de Pecho (Máquina)", "4 x 8-10, 2 min, 130-135 lb"),
      ex("Jalón al Pecho (Barra larga)", "4 x 8-10, 2 min, 125-130 lb"),
      ex("Press de Hombro (Mancuerna)", "3 x 10-12, 1.5 min, 40 lb/lado"),
      ex("Remo en Polea (V)", "4 x 10-12, 1.5 min, 130-135 lb"),
      ex("Tríceps en Polea (Barra)", "3 x 12-15, 1 min, 45-50 lb"),
      ex("Curl Bíceps Banco Inclinado (Manc.)", "3 x 12-15, 1 min, 20-22.5 lb/lado"),
    ],
    2: [
      // Día 2 Empuje (miércoles, día de correr)
      ex("Press Inclinado (Mancuerna)", "4 x 10-12, 2 min, 50-52.5 lb/lado"),
      ex("Aperturas en Polea", "3 x 12-15, 1 min, 25-30 lb/lado"),
      ex("Elevación Lateral (Mancuerna)", "4 x 12-15, 1 min, 15-17.5 lb/lado"),
      ex("Fondos", "3 x 10-12, 1.5 min, peso corporal"),
      ex("Tríceps Tras Nuca (Polea individual)", "3 x 12-15, 1 min, 15 lb"),
    ],
    3: [
      // Día 3 Glúteo/Femoral (jueves, trote suave)
      ex("Hip Thrust (Máquina)", "4 x 10-12, 2.5 min, 240-250 lb"),
      ex("Peso Muerto Rumano", "3 x 8-10, 2.5 min, 60 lb/lado + barra"),
      ex("Curl Femoral (Máquina)", "3 x 12-15, 2 min, 160-165 lb"),
      exSimple("Pantorrilla Sentado", "4 x 15-20, 45 seg, carga real (ajustar)"),
      ex("Crunch en Máquina", "3 x 12-15, 45 seg, 30-35 lb"),
    ],
    4: [
      // Día 4 Tracción (viernes, día de correr)
      ex("Remo con Barra (Prono)", "4 x 10-12, 2 min, 50-55 lb/lado + barra"),
      ex("Remo Unilateral (Mancuerna, en banco)", "3 x 10-12 por lado, 1.5 min, 45-50 lb"),
      ex("Face Pull", "3 x 15, 1 min, 47.5 lb"),
      ex("Curl Martillo", "3 x 12-15, 1 min, 25 lb/lado"),
      ex("Curl Predicador (Barra Z)", "3 x 12-15, 1 min, 40-45 lb"),
    ],
    5: [
      // Día 5 Cuádriceps (lunes, trote suave el domingo anterior)
      ex("Sentadilla Libre", "4 x 8-10, 2.5 min, 50-55 lb/lado + barra"),
      ex("Prensa Inclinada (pirámide)", "3 x 10-12, 2 min, 200 / 220 / 230 lb"),
      ex("Sentadilla Búlgara (Mancuerna)", "3 x 10-12 por pierna, 1.5 min, 10-12.5 lb/lado"),
      ex("Extensión de Cuádriceps", "3 x 12-15, 1 min, 150-155 lb"),
      exSimple("Pantorrilla en Prensa", "4 x 15-20, 45 seg, carga real (ajustar)"),
      exSimple("Elevación de Piernas", "3 x 12-15, 45 seg, peso corporal"),
    ],
  };

  // ---------- Bloque 5 (orden Torso, Glúteo/Femoral, Empuje,
  // Cuádriceps, Tracción — no se reordena). Sin objetivo formal: nunca
  // se dio una rutina completa de este bloque, solo el registro real de
  // la Semana 3 (ver más abajo), así que la lista de ejercicios de cada
  // día se reconstruye a partir de ese registro, sin "target".
  const BLOCK_5_DAY_NAMES = ["Torso", "Glúteo/Femoral", "Empuje", "Cuádriceps", "Tracción"];

  const BLOCK_5_ROUTINE_RAW = {
    1: [
      ex("Press Pecho Máquina", null),
      ex("Jalón al pecho", null),
      ex("Press de Hombro", null),
      ex("Remo en polea", null),
      ex("Tríceps en polea con barrita", null),
      ex("Curl de Bíceps", null),
    ],
    2: [
      ex("Hip Thrust (Máquina en Smith)", null),
      ex("Curl femoral", null),
      ex("Sentadilla Búlgara (Mancuerna)", null),
      exSimple("Pantorrilla sentado", null),
      ex("Crunch en máquina", null),
    ],
    3: [
      ex("Press inclinado", null),
      ex("Peckdeck", null),
      ex("Elevaciones laterales con polea", null),
      ex("Fondos", null),
      ex("Tríceps tras nuca individual en polea", null),
      ex("Polea alta con barrita", null),
    ],
    4: [
      ex("Sentadilla libre", null),
      ex("Prensa en máquina", null),
      ex("Extensión de cuádriceps", null),
      exSimple("Pantorrilla en prensa", null),
      exSimple("Elevación de piernas", null),
    ],
    5: [
      ex("Peso muerto (barra)", null),
      ex("Remo con barra", null),
      ex("Face pull", null),
      ex("Curl martillo", null),
      ex("Curl barra Z en predicador", null),
    ],
  };

  const BLOCK_5_ROUTINE = withIds(BLOCK_5_ROUTINE_RAW, "b5");
  const BLOCK_6_ROUTINE = withIds(BLOCK_6_ROUTINE_RAW, "b6");

  // Set simple (series con peso/reps/RIR): valores por defecto, se
  // sobreescriben los que correspondan por entrada.
  function s(fields) {
    return { weight: null, unit: "total", barWeight: null, reps: "", rir: "", note: "", ...fields };
  }

  // Historial real de la Semana 3 del Bloque 5, día por día, tal como lo
  // pasó el usuario (ver el pedido original, parte 8): se respetan
  // pesos, unidades, reps, RIR (incluidos rangos) y notas; donde una
  // línea era ambigua (una sola serie para un ejercicio que debería
  // tener varias, o la "3ra" repetida de hip thrust) se deja así,
  // marcado con una nota, sin inventar ni corregir nada.
  const BLOCK_5_WEEK_3_LOG = {
    1: {
      // Torso
      dayNote: "",
      exercises: {
        b5d1e1: {
          // Press Pecho Máquina: 145 lb totales en las 4 series
          note: "",
          sets: [
            s({ weight: 145, unit: "total", reps: "9", rir: "0-1" }),
            s({ weight: 145, unit: "total", reps: "6", rir: "0-1" }),
            s({ weight: 145, unit: "total", reps: "6", rir: "0" }),
            s({ weight: 145, unit: "total", reps: "4", rir: "0" }),
          ],
        },
        b5d1e2: {
          // Jalón al pecho: 140 lb en las 4 series
          note: "",
          sets: [
            s({ weight: 140, unit: "total", reps: "8", rir: "1-2" }),
            s({ weight: 140, unit: "total", reps: "8", rir: "2-3" }),
            s({ weight: 140, unit: "total", reps: "8", rir: "1" }),
            s({ weight: 140, unit: "total", reps: "7", rir: "0", note: "séptima rep incompleta" }),
          ],
        },
        b5d1e3: {
          // Press de Hombro: peso distinto por serie
          note: "",
          sets: [
            s({ weight: 40, unit: "perSide", reps: "10", rir: "2" }),
            s({ weight: 45, unit: "perSide", reps: "10", rir: "1" }),
            s({ weight: 45, unit: "perSide", reps: "9", rir: "0" }),
            s({ weight: 45, unit: "perSide", reps: "5", rir: "0" }),
          ],
        },
        b5d1e4: {
          // Remo en polea: una sola serie anotada en el registro original
          note: "El registro original no desglosa series individuales para este ejercicio.",
          sets: [s({ weight: 140, unit: "total", reps: "10", rir: "2" })],
        },
        b5d1e5: {
          // Tríceps en polea con barrita: una sola serie anotada
          note: "El registro original no desglosa series individuales para este ejercicio.",
          sets: [s({ weight: 50, unit: "total", reps: "10-12", rir: "2-3" })],
        },
        b5d1e6: {
          // Curl de Bíceps: una sola serie anotada
          note: "El registro original no desglosa series individuales para este ejercicio.",
          sets: [s({ weight: 30, unit: "perSide", reps: "12", rir: "2" })],
        },
      },
    },
    2: {
      // Glúteo/Femoral
      dayNote: "",
      exercises: {
        b5d2e1: {
          // Hip Thrust (Máquina en Smith)
          note:
            'Realizado con barra en Smith. En el registro original, la "3ra" serie aparece repetida (dos entradas distintas marcadas como 3ra): se conservan ambas como series separadas, sin corregir ni descartar ninguna.',
          sets: [
            s({ weight: 180, unit: "total", reps: "12", rir: "2" }),
            s({ weight: 210, unit: "total", reps: "12", rir: "2" }),
            s({ weight: 230, unit: "total", reps: "8", rir: "1", note: 'Aparece como "3ra" serie en el registro original.' }),
            s({
              weight: 230,
              unit: "total",
              reps: "10",
              rir: "2-3",
              note: 'También aparece como "3ra" serie en el registro original (duplicado/ambiguo); se conserva como serie aparte sin corregir.',
            }),
          ],
        },
        b5d2e2: {
          // Curl femoral
          note: "",
          sets: [
            s({ weight: 175, unit: "total", reps: "10", rir: "2-3" }),
            s({ weight: 175, unit: "total", reps: "8", rir: "2" }),
            s({ weight: 175, unit: "total", reps: "8", rir: "0-1" }),
          ],
        },
        b5d2e3: {
          // Búlgaras: una sola serie anotada
          note: "El registro original no desglosa series individuales para este ejercicio.",
          sets: [s({ weight: 10, unit: "perSide", reps: "10", rir: "0" })],
        },
        b5d2e4: {
          // Pantorrilla sentado: modo simple ("sí" en el registro original)
          note: "",
          done: true,
          sets: [],
        },
        b5d2e5: {
          // Crunch en máquina: no se especificaron las repeticiones
          note: "Las repeticiones no se especificaron en el registro original.",
          sets: [s({ weight: 30, unit: "total", reps: "", rir: "3" })],
        },
      },
    },
    3: {
      // Empuje
      dayNote: "",
      exercises: {
        b5d3e1: {
          // Press inclinado: 60 lb/lado en las 4 series
          note: "",
          sets: [
            s({ weight: 60, unit: "perSide", reps: "6", rir: "1-2" }),
            s({ weight: 60, unit: "perSide", reps: "7", rir: "1-2" }),
            s({ weight: 60, unit: "perSide", reps: "6", rir: "1-2" }),
            s({ weight: 60, unit: "perSide", reps: "6", rir: "1" }),
          ],
        },
        b5d3e2: {
          // Peckdeck: 150 lb totales en las 3 series
          note: "",
          sets: [
            s({ weight: 150, unit: "total", reps: "12", rir: "2-3" }),
            s({ weight: 150, unit: "total", reps: "12", rir: "1" }),
            s({ weight: 150, unit: "total", reps: "7", rir: "0" }),
          ],
        },
        b5d3e3: {
          // Elevaciones laterales con polea: RIR no especificado en el registro original
          note: "",
          sets: [
            s({ weight: 5, unit: "perSide", reps: "15", rir: "", note: "Calentamiento." }),
            s({ weight: 10, unit: "perSide", reps: "15", rir: "" }),
            s({ weight: 10, unit: "perSide", reps: "15", rir: "" }),
          ],
        },
        b5d3e4: {
          // Fondos: una sola serie anotada
          note: "El registro original no desglosa series individuales para este ejercicio.",
          sets: [s({ weight: null, unit: "bodyweight", reps: "8-10", rir: "0" })],
        },
        b5d3e5: {
          // Tríceps tras nuca individual en polea: una sola serie anotada
          note: "El registro original no desglosa series individuales para este ejercicio.",
          sets: [s({ weight: 15, unit: "total", reps: "8-10", rir: "2-3" })],
        },
        b5d3e6: {
          // Polea alta con barrita: 2 series, explícito en el registro original
          note: "",
          sets: [
            s({ weight: 50, unit: "total", reps: "8-10", rir: "2-3" }),
            s({ weight: 50, unit: "total", reps: "8-10", rir: "2-3" }),
          ],
        },
      },
    },
    4: {
      // Cuádriceps
      dayNote: "",
      exercises: {
        b5d4e1: {
          // Sentadilla libre (barra 20 kg)
          note: "",
          sets: [
            s({ weight: 55, unit: "perSideBar", barWeight: 20, reps: "6", rir: "1-2" }),
            s({
              weight: 60,
              unit: "perSideBar",
              barWeight: 20,
              reps: "5",
              rir: "1-2",
              note: "Se me cayó la barra cuando iba para la 6ta rep.",
            }),
            s({ weight: 60, unit: "perSideBar", barWeight: 20, reps: "6", rir: "1" }),
            s({ weight: 60, unit: "perSideBar", barWeight: 20, reps: "6", rir: "1-2" }),
          ],
        },
        b5d4e2: {
          // Prensa en máquina
          note: "",
          sets: [
            s({ weight: 180, unit: "total", reps: "12", rir: "2-3" }),
            s({ weight: 200, unit: "total", reps: "12", rir: "1-2" }),
            s({ weight: 220, unit: "total", reps: "12", rir: "0-1" }),
            s({ weight: 240, unit: "total", reps: "8", rir: "0" }),
          ],
        },
        b5d4e3: {
          // Extensión de cuádriceps: 3 series explícitas, todas iguales
          note: "Ya me sentía bien cansado de las piernas.",
          sets: [
            s({ weight: 130, unit: "total", reps: "12", rir: "1" }),
            s({ weight: 130, unit: "total", reps: "12", rir: "1" }),
            s({ weight: 130, unit: "total", reps: "12", rir: "1" }),
          ],
        },
        b5d4e4: {
          // Pantorrilla en prensa: modo simple ("sin peso" en el registro original)
          note: "sin peso",
          done: true,
          sets: [],
        },
        b5d4e5: {
          // Elevación de piernas: modo simple ("bien" en el registro original)
          note: "bien",
          done: true,
          sets: [],
        },
      },
    },
    5: {
      // Tracción
      dayNote: "",
      exercises: {
        b5d5e1: {
          // Peso muerto (barra): 4 series explícitas, todas iguales
          note: "",
          sets: [
            s({ weight: 65, unit: "perSideBar", barWeight: 20, reps: "6", rir: "2-3" }),
            s({ weight: 65, unit: "perSideBar", barWeight: 20, reps: "6", rir: "2-3" }),
            s({ weight: 65, unit: "perSideBar", barWeight: 20, reps: "6", rir: "2-3" }),
            s({ weight: 65, unit: "perSideBar", barWeight: 20, reps: "6", rir: "2-3" }),
          ],
        },
        b5d5e2: {
          // Remo con barra: 1 serie a 60 lb/lado + 3 series ("3 series de...") a 55 lb/lado
          note: "",
          sets: [
            s({ weight: 60, unit: "perSideBar", barWeight: 20, reps: "6", rir: "2" }),
            s({ weight: 55, unit: "perSideBar", barWeight: 20, reps: "7", rir: "2-3" }),
            s({ weight: 55, unit: "perSideBar", barWeight: 20, reps: "7", rir: "2-3" }),
            s({ weight: 55, unit: "perSideBar", barWeight: 20, reps: "7", rir: "2-3" }),
          ],
        },
        b5d5e3: {
          // Face pull: una sola serie anotada
          note: "El registro original no desglosa series individuales para este ejercicio.",
          sets: [s({ weight: 47.5, unit: "total", reps: "15", rir: "2" })],
        },
        b5d5e4: {
          // Curl martillo: una sola serie anotada
          note: "El registro original no desglosa series individuales para este ejercicio.",
          sets: [s({ weight: 30, unit: "perSide", reps: "6-8", rir: "2" })],
        },
        b5d5e5: {
          // Curl barra Z en predicador: una sola serie anotada
          note: "El registro original no desglosa series individuales para este ejercicio.",
          sets: [s({ weight: 45, unit: "total", reps: "10", rir: "2-3" })],
        },
      },
    },
  };

  // Un bloque por número: la info fija (nombre de los días, reglas,
  // progresión, rutina) y, si hay, el historial ya registrado por
  // semana (ver migrateGymRoutinesSeed en state.js, que aplica esto una
  // sola vez como semilla — después, todo se edita desde la cuenta).
  ns.gymRoutines = {
    BLOCK_SEEDS: {
      5: {
        number: 5,
        label: "Bloque 5",
        dayNames: BLOCK_5_DAY_NAMES,
        rules: "",
        progression: "",
        routine: BLOCK_5_ROUTINE,
        weeks: { 3: BLOCK_5_WEEK_3_LOG },
      },
      6: {
        number: 6,
        label: "Bloque 6",
        dayNames: BLOCK_6_DAY_NAMES,
        rules: BLOCK_6_RULES,
        progression: BLOCK_6_PROGRESSION,
        routine: BLOCK_6_ROUTINE,
        weeks: {},
      },
    },
  };
})(window.Agenda);
