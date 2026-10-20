/*
 * Pestaña "Gimnasio": registro de peso, repeticiones y RIR por serie,
 * independiente de la cola + puntero de siempre (ver js/state.js,
 * sección "Registro de gimnasio" — nunca toca gymStatus/resolutions).
 * Selector de Bloque + sub-pestañas Semana 1-4; cada semana muestra sus
 * 5 días en el orden del bloque, con sus ejercicios y series.
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  const { state, dateUtils } = ns;
  let containerRef = null;
  let currentBlockNumber = null;
  let currentWeek = null;
  let defaultsApplied = false;
  // Día (o nada) forzado a expandirse en la semana/bloque actuales, por
  // fuera de la regla de "la sesión de hoy abierta por defecto" — se
  // limpia cada vez que se cambia de semana o de bloque (ver
  // setWeek/setBlock), para que esa regla vuelva a decidir sola.
  let dayExpansionOverride = {};
  // Ejercicios colapsados a mano (todo lo demás, dentro de un día
  // visible, arranca expandido — ver isExerciseExpanded).
  let collapsedExerciseIds = new Set();
  let editingExercise = null; // { day, id } o null
  let addingExerciseDay = null; // número de día (1-5) o null

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    });
    children.flat().forEach((c) => {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function todayStr() {
    return dateUtils.toISO(new Date());
  }

  function setBlock(number) {
    currentBlockNumber = number;
    currentWeek = null;
    dayExpansionOverride = {};
    collapsedExerciseIds = new Set();
    render(containerRef);
  }

  function setWeek(week) {
    currentWeek = week;
    dayExpansionOverride = {};
    render(containerRef);
  }

  function isDayExpanded(dayNum, todayLocation) {
    if (dayExpansionOverride.hasOwnProperty(dayNum)) return dayExpansionOverride[dayNum];
    return !!(
      todayLocation &&
      todayLocation.blockNumber === currentBlockNumber &&
      todayLocation.week === currentWeek &&
      todayLocation.day === dayNum
    );
  }

  function isExerciseExpanded(exerciseId) {
    return !collapsedExerciseIds.has(exerciseId);
  }

  function toggleExercise(exerciseId) {
    if (collapsedExerciseIds.has(exerciseId)) collapsedExerciseIds.delete(exerciseId);
    else collapsedExerciseIds.add(exerciseId);
    render(containerRef);
  }

  function unitLabel(unit) {
    return state.GYM_SET_UNITS[unit] || unit;
  }

  function buildRulesCard(meta) {
    if (!meta.rules && !meta.progression) return null;
    const card = el("div", { class: "card gym-rules-card" }, el("h3", null, "Reglas"));
    if (meta.rules) {
      meta.rules.split("\n").forEach((line) => {
        if (line.trim()) card.appendChild(el("p", { class: "gym-rules-line" }, line));
      });
    }
    if (meta.progression) {
      card.appendChild(el("h4", { class: "pendientes-subtitle" }, "Progresión por semana"));
      meta.progression.split("\n").forEach((line) => {
        if (line.trim()) card.appendChild(el("p", { class: "gym-rules-line" }, line));
      });
    }
    return card;
  }

  function buildSetRow(blockNumber, week, day, exercise, set) {
    const weightInput = el("input", {
      type: "number",
      step: "0.5",
      inputmode: "decimal",
      class: "gym-set-weight",
      placeholder: "Peso",
      value: set.weight === null || set.weight === undefined ? "" : String(set.weight),
      disabled: set.unit === "bodyweight" || set.unit === "none" ? "disabled" : null,
      oninput: (e) => {
        const val = e.target.value;
        state.updateGymSet(blockNumber, week, day, exercise.id, set.id, { weight: val === "" ? null : Number(val) });
      },
    });
    const unitSelect = el("select", {
      class: "gym-set-unit",
      onchange: (e) => {
        state.updateGymSet(blockNumber, week, day, exercise.id, set.id, { unit: e.target.value });
        render(containerRef);
      },
    });
    Object.keys(state.GYM_SET_UNITS).forEach((u) => {
      unitSelect.appendChild(el("option", { value: u }, state.GYM_SET_UNITS[u]));
    });
    unitSelect.value = set.unit;

    const barInput =
      set.unit === "perSideBar"
        ? el("input", {
            type: "number",
            step: "0.5",
            inputmode: "decimal",
            class: "gym-set-bar",
            placeholder: "Barra (kg)",
            value: set.barWeight === null || set.barWeight === undefined ? "" : String(set.barWeight),
            oninput: (e) => {
              const val = e.target.value;
              state.updateGymSet(blockNumber, week, day, exercise.id, set.id, { barWeight: val === "" ? null : Number(val) });
            },
          })
        : null;

    const repsInput = el("input", {
      type: "text",
      class: "gym-set-reps",
      placeholder: "Reps",
      value: set.reps || "",
      oninput: (e) => state.updateGymSet(blockNumber, week, day, exercise.id, set.id, { reps: e.target.value }),
    });
    const rirInput = el("input", {
      type: "text",
      class: "gym-set-rir",
      placeholder: "RIR",
      value: set.rir || "",
      oninput: (e) => state.updateGymSet(blockNumber, week, day, exercise.id, set.id, { rir: e.target.value }),
    });
    const noteInput = el("input", {
      type: "text",
      class: "gym-set-note add-input",
      placeholder: "Nota (opcional)",
      value: set.note || "",
      oninput: (e) => state.updateGymSet(blockNumber, week, day, exercise.id, set.id, { note: e.target.value }),
    });

    return el(
      "div",
      { class: "gym-set-row" },
      el("div", { class: "gym-set-fields" }, weightInput, unitSelect, barInput, repsInput, rirInput),
      noteInput,
      el(
        "button",
        {
          class: "btn-remove",
          title: "Quitar serie",
          onclick: () => state.removeGymSet(blockNumber, week, day, exercise.id, set.id),
        },
        "×"
      )
    );
  }

  function buildExerciseEditForm(blockNumber, day, exercise) {
    const nameInput = el("input", { type: "text", class: "add-input", value: exercise.name });
    const targetInput = el("input", { type: "text", class: "add-input", value: exercise.target || "", placeholder: "Objetivo (series x reps, descanso, peso de partida)..." });
    const modeSelect = el("select", { class: "block-select" },
      el("option", { value: "sets" }, "Series (peso/reps/RIR)"),
      el("option", { value: "simple" }, "Simple (hecho + nota)")
    );
    modeSelect.value = exercise.mode;
    const save = () => {
      state.updateGymExercise(blockNumber, day, exercise.id, {
        name: nameInput.value,
        target: targetInput.value,
        mode: modeSelect.value,
      });
      editingExercise = null;
      render(containerRef);
    };
    const cancel = () => {
      editingExercise = null;
      render(containerRef);
    };
    return el(
      "div",
      { class: "gym-exercise-edit" },
      nameInput,
      targetInput,
      modeSelect,
      el(
        "div",
        { class: "add-row-actions" },
        el("button", { class: "btn-primary", onclick: save }, "Guardar"),
        el("button", { class: "btn-secondary", onclick: cancel }, "Cancelar")
      )
    );
  }

  function buildExerciseCard(blockNumber, week, day, exercise) {
    const expanded = isExerciseExpanded(exercise.id);
    const log = state.getGymWeekDay(blockNumber, week, day).exercises[exercise.id] || { note: "", sets: [], done: false };
    const prevRef = state.getGymPreviousReference(blockNumber, week, day, exercise.id);

    const head = el(
      "div",
      { class: "gym-exercise-head" },
      el(
        "button",
        { class: "gym-exercise-toggle", onclick: () => toggleExercise(exercise.id) },
        `${expanded ? "▾" : "▸"} ${exercise.name}`
      ),
      el(
        "div",
        { class: "gym-exercise-head-actions" },
        el("button", { class: "btn-icon", title: "Subir", onclick: () => state.moveGymExercise(blockNumber, day, exercise.id, -1) }, "↑"),
        el("button", { class: "btn-icon", title: "Bajar", onclick: () => state.moveGymExercise(blockNumber, day, exercise.id, 1) }, "↓"),
        el("button", { class: "btn-remove", title: "Editar", onclick: () => { editingExercise = { day, id: exercise.id }; render(containerRef); } }, "✎"),
        el(
          "button",
          {
            class: "btn-remove",
            title: "Eliminar ejercicio",
            onclick: () => {
              if (confirm(`¿Eliminar "${exercise.name}" de este día? Esto no borra lo ya registrado, pero deja de mostrarlo.`)) {
                state.removeGymExercise(blockNumber, day, exercise.id);
              }
            },
          },
          "×"
        )
      )
    );

    const reference = el(
      "div",
      { class: "gym-exercise-reference" },
      exercise.target ? el("span", { class: "gym-exercise-target" }, exercise.target) : null,
      prevRef ? el("span", { class: "gym-exercise-prev" }, `Semana pasada: ${prevRef}`) : null
    );

    if (editingExercise && editingExercise.day === day && editingExercise.id === exercise.id) {
      return el("div", { class: "card gym-exercise-card" }, head, reference, buildExerciseEditForm(blockNumber, day, exercise));
    }

    if (!expanded) {
      return el("div", { class: "card gym-exercise-card collapsed" }, head, reference);
    }

    const body = el("div", { class: "gym-exercise-body" });

    if (exercise.mode === "simple") {
      body.appendChild(
        el(
          "label",
          { class: "check-row" + (log.done ? " done" : "") },
          el("input", {
            type: "checkbox",
            checked: log.done ? "checked" : null,
            onchange: (e) => state.setGymSimpleDone(blockNumber, week, day, exercise.id, e.target.checked),
          }),
          el("span", null, "Hecho")
        )
      );
      body.appendChild(
        el("input", {
          type: "text",
          class: "add-input gym-exercise-note-input",
          placeholder: "Nota (opcional)...",
          value: log.note || "",
          oninput: (e) => state.setGymExerciseNote(blockNumber, week, day, exercise.id, e.target.value),
        })
      );
    } else {
      log.sets.forEach((set) => {
        body.appendChild(buildSetRow(blockNumber, week, day, exercise, set));
      });
      body.appendChild(
        el(
          "div",
          { class: "gym-set-actions" },
          el("button", { class: "btn-secondary", onclick: () => state.addGymSet(blockNumber, week, day, exercise.id) }, "+ Agregar serie"),
          log.sets.length
            ? el(
                "button",
                { class: "link-btn", onclick: () => state.copyLastGymSet(blockNumber, week, day, exercise.id) },
                "Copiar serie anterior"
              )
            : null
        )
      );
      body.appendChild(
        el("input", {
          type: "text",
          class: "add-input gym-exercise-note-input",
          placeholder: "Nota del ejercicio (opcional)...",
          value: log.note || "",
          oninput: (e) => state.setGymExerciseNote(blockNumber, week, day, exercise.id, e.target.value),
        })
      );
    }

    return el("div", { class: "card gym-exercise-card" }, head, reference, body);
  }

  function buildAddExerciseForm(blockNumber, day) {
    const nameInput = el("input", { type: "text", class: "add-input", placeholder: "Nombre del ejercicio..." });
    const targetInput = el("input", { type: "text", class: "add-input", placeholder: "Objetivo (opcional)..." });
    const modeSelect = el(
      "select",
      { class: "block-select" },
      el("option", { value: "sets" }, "Series (peso/reps/RIR)"),
      el("option", { value: "simple" }, "Simple (hecho + nota)")
    );
    const commit = () => {
      if (!nameInput.value.trim()) return;
      state.addGymExercise(blockNumber, day, { name: nameInput.value, target: targetInput.value, mode: modeSelect.value });
      addingExerciseDay = null;
      render(containerRef);
    };
    const cancel = () => {
      addingExerciseDay = null;
      render(containerRef);
    };
    return el(
      "div",
      { class: "add-row gym-add-exercise-row" },
      nameInput,
      targetInput,
      el(
        "div",
        { class: "add-row-actions" },
        modeSelect,
        el("button", { class: "btn-primary", onclick: commit }, "Agregar"),
        el("button", { class: "btn-secondary", onclick: cancel }, "Cancelar")
      )
    );
  }

  function buildDayCard(meta, blockNumber, week, day, dayName, todayLocation) {
    const expanded = isDayExpanded(day, todayLocation);
    const isTodaySession = !!(
      todayLocation &&
      todayLocation.blockNumber === blockNumber &&
      todayLocation.week === week &&
      todayLocation.day === day
    );
    const header = el(
      "div",
      {
        class: "gym-day-head",
        onclick: () => {
          dayExpansionOverride[day] = !expanded;
          render(containerRef);
        },
      },
      el("h4", null, `${expanded ? "▾" : "▸"} Día ${day} · ${dayName}`),
      isTodaySession ? el("span", { class: "gym-today-badge" }, "Hoy") : null
    );

    const card = el("div", { class: "card gym-day-card" }, header);
    if (!expanded) return card;

    const weekLog = state.getGymWeekDay(blockNumber, week, day);
    const dayNoteInput = el("textarea", {
      class: "block-textarea gym-day-note",
      rows: "2",
      placeholder: "Nota del día (opcional)...",
      oninput: (e) => state.setGymDayNote(blockNumber, week, day, e.target.value),
    });
    dayNoteInput.value = weekLog.dayNote || "";
    card.appendChild(dayNoteInput);

    const exercises = state.getGymRoutineDay(blockNumber, day);
    exercises.forEach((exercise) => {
      card.appendChild(buildExerciseCard(blockNumber, week, day, exercise));
    });

    if (addingExerciseDay === day) {
      card.appendChild(buildAddExerciseForm(blockNumber, day));
    } else {
      card.appendChild(
        el(
          "button",
          { class: "link-btn", onclick: () => { addingExerciseDay = day; render(containerRef); } },
          "+ Agregar ejercicio"
        )
      );
    }

    return card;
  }

  function render(container) {
    if (!container) return;
    container.innerHTML = "";

    const blockNumbers = state.getGymBlockNumbers();
    if (!blockNumbers.length) {
      container.appendChild(el("p", { class: "muted" }, "Todavía no hay bloques de gimnasio cargados."));
      return;
    }

    const today = todayStr();
    const todayLocation = state.getGymSessionLocation(today);

    if (!defaultsApplied) {
      defaultsApplied = true;
      currentBlockNumber = (todayLocation && todayLocation.blockNumber) || blockNumbers[blockNumbers.length - 1];
      currentWeek = (todayLocation && todayLocation.blockNumber === currentBlockNumber && todayLocation.week) || 1;
    }
    if (!blockNumbers.includes(currentBlockNumber)) currentBlockNumber = blockNumbers[blockNumbers.length - 1];
    if (!currentWeek) currentWeek = 1;

    const meta = state.getGymBlockMeta(currentBlockNumber);

    const header = el(
      "div",
      { class: "view-header gym-header" },
      el("h2", null, "Gimnasio"),
      el(
        "div",
        { class: "toggle-group gym-block-selector" },
        blockNumbers.map((n) =>
          el(
            "button",
            { class: "toggle-btn" + (n === currentBlockNumber ? " active" : ""), onclick: () => setBlock(n) },
            `Bloque ${n}`
          )
        )
      )
    );

    const weekTabs = el(
      "div",
      { class: "toggle-group gym-week-tabs" },
      [1, 2, 3, 4].map((w) =>
        el("button", { class: "toggle-btn" + (w === currentWeek ? " active" : ""), onclick: () => setWeek(w) }, `Semana ${w}`)
      )
    );

    const rulesCard = buildRulesCard(meta);

    const daysWrap = el("div", { class: "gym-days-wrap" });
    meta.dayNames.forEach((dayName, i) => {
      daysWrap.appendChild(buildDayCard(meta, currentBlockNumber, currentWeek, i + 1, dayName, todayLocation));
    });

    container.append(header, weekTabs, rulesCard, daysWrap);
  }

  ns.gymView = {
    mount(container) {
      containerRef = container;
      render(container);
    },
    refresh() {
      if (containerRef) render(containerRef);
    },
    // Abre directamente una sesión puntual (ver js/app.js:
    // openGymSession, llamado desde "Registrar" en Diaria/Semanal).
    openSession({ blockNumber, week, day }) {
      currentBlockNumber = blockNumber;
      currentWeek = week;
      defaultsApplied = true;
      dayExpansionOverride = { [day]: true };
      if (containerRef) render(containerRef);
    },
  };
})(window.Agenda);
