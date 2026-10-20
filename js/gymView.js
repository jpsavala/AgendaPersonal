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

  // ---------- Guardado con debounce + foco que no se pierde al tipear ----------
  // Peso/reps/RIR/notas se escriben tecla por tecla: guardar (ver
  // js/state.js: updateGymSet/setGymExerciseNote/setGymDayNote, que ya
  // usan persist() y no notify() a propósito) nunca redibuja esta
  // pestaña por sí solo, así que el input nunca pierde el foco por su
  // propia escritura. Lo de acá abajo es la otra mitad del pedido:
  // - No llamar a esas funciones en CADA tecla (para no escribir en
  //   localStorage/disparar la sincronización con Firebase de más):
  //   se junta por campo con un debounce de ~700 ms desde la última
  //   tecla (ver debouncedCommit), y se vuelca de una vez al perder el
  //   foco (ver flushPending, en el onblur de cada campo) para no
  //   perder nada si se cierra la app justo después de escribir.
  // - Si de todos modos algo externo redibuja la pestaña mientras hay
  //   un campo con foco (un cambio remoto de Firebase, ver
  //   js/firebaseSync.js: applyRemote -> state.replaceAllData ->
  //   notify()), restaurar el foco, el cursor y lo que ya se tecleó en
  //   ese mismo campo después del redibujado (ver captureFocus/
  //   restoreFocus, usados solo en refresh(), el único punto de entrada
  //   que puede llegar durante una tecleada real).
  const DEBOUNCE_MS = 700;
  const pendingTimers = new Map(); // key -> id de setTimeout
  const pendingFlush = new Map(); // key -> función que falta ejecutar

  function debouncedCommit(key, commitFn) {
    const existingTimer = pendingTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);
    pendingFlush.set(key, commitFn);
    pendingTimers.set(
      key,
      setTimeout(() => {
        pendingTimers.delete(key);
        pendingFlush.delete(key);
        commitFn();
      }, DEBOUNCE_MS)
    );
  }

  function flushPending(key) {
    const timer = pendingTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      pendingTimers.delete(key);
    }
    const flush = pendingFlush.get(key);
    if (flush) {
      pendingFlush.delete(key);
      flush();
    }
  }

  // Conecta un <input>/<textarea> ya creado al guardado con debounce:
  // "key" identifica el campo (mismo Map de arriba, y mismo atributo
  // para encontrarlo de nuevo tras un redibujado externo, ver
  // captureFocus/restoreFocus). commitFn no recibe el valor como
  // argumento: lee input.value en el momento en que de verdad se
  // ejecuta (al vencer el debounce o al perder el foco), así que
  // siempre guarda lo último tecleado sin necesidad de rearmarla en
  // cada tecla.
  function wireDebouncedInput(input, key, commitFn) {
    input.dataset.gymFocusKey = key;
    input.addEventListener("input", () => debouncedCommit(key, commitFn));
    input.addEventListener("blur", () => flushPending(key));
  }

  function fieldKey(...parts) {
    return parts.join(":");
  }

  function captureFocus(container) {
    const active = document.activeElement;
    if (!active || !container.contains(active)) return null;
    const key = active.dataset && active.dataset.gymFocusKey;
    if (!key) return null;
    return {
      key,
      value: "value" in active ? active.value : undefined,
      selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : null,
      selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : null,
    };
  }

  function restoreFocus(container, snapshot) {
    if (!snapshot) return;
    const match = container.querySelector(`[data-gym-focus-key="${snapshot.key}"]`);
    if (!match) return;
    // Lo que se estaba tecleando manda sobre lo que haya traído el
    // redibujado (p. ej. un dato remoto distinto): el usuario sigue
    // viendo exactamente lo que ya había escrito, no se le borra nada.
    if (snapshot.value !== undefined && match.value !== snapshot.value) match.value = snapshot.value;
    match.focus({ preventScroll: true });
    if (snapshot.selectionStart !== null && typeof match.setSelectionRange === "function") {
      try {
        match.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
      } catch (e) {
        /* algunos tipos de input no soportan selectionRange; no es grave */
      }
    }
  }

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
    });
    wireDebouncedInput(weightInput, fieldKey(blockNumber, week, day, exercise.id, set.id, "weight"), () => {
      const val = weightInput.value;
      state.updateGymSet(blockNumber, week, day, exercise.id, set.id, { weight: val === "" ? null : Number(val) });
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

    let barInput = null;
    if (set.unit === "perSideBar") {
      barInput = el("input", {
        type: "number",
        step: "0.5",
        inputmode: "decimal",
        class: "gym-set-bar",
        placeholder: "Barra (kg)",
        value: set.barWeight === null || set.barWeight === undefined ? "" : String(set.barWeight),
      });
      wireDebouncedInput(barInput, fieldKey(blockNumber, week, day, exercise.id, set.id, "barWeight"), () => {
        const val = barInput.value;
        state.updateGymSet(blockNumber, week, day, exercise.id, set.id, { barWeight: val === "" ? null : Number(val) });
      });
    }

    const repsInput = el("input", {
      type: "text",
      inputmode: "numeric",
      class: "gym-set-reps",
      placeholder: "Reps",
      value: set.reps || "",
    });
    wireDebouncedInput(repsInput, fieldKey(blockNumber, week, day, exercise.id, set.id, "reps"), () => {
      state.updateGymSet(blockNumber, week, day, exercise.id, set.id, { reps: repsInput.value });
    });

    const rirInput = el("input", {
      type: "text",
      class: "gym-set-rir",
      placeholder: "RIR",
      value: set.rir || "",
    });
    wireDebouncedInput(rirInput, fieldKey(blockNumber, week, day, exercise.id, set.id, "rir"), () => {
      state.updateGymSet(blockNumber, week, day, exercise.id, set.id, { rir: rirInput.value });
    });

    const noteInput = el("input", {
      type: "text",
      class: "gym-set-note add-input",
      placeholder: "Nota (opcional)",
      value: set.note || "",
    });
    wireDebouncedInput(noteInput, fieldKey(blockNumber, week, day, exercise.id, set.id, "note"), () => {
      state.updateGymSet(blockNumber, week, day, exercise.id, set.id, { note: noteInput.value });
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
      const simpleNoteInput = el("input", {
        type: "text",
        class: "add-input gym-exercise-note-input",
        placeholder: "Nota (opcional)...",
        value: log.note || "",
      });
      wireDebouncedInput(simpleNoteInput, fieldKey(blockNumber, week, day, exercise.id, "note"), () => {
        state.setGymExerciseNote(blockNumber, week, day, exercise.id, simpleNoteInput.value);
      });
      body.appendChild(simpleNoteInput);
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
      const setsNoteInput = el("input", {
        type: "text",
        class: "add-input gym-exercise-note-input",
        placeholder: "Nota del ejercicio (opcional)...",
        value: log.note || "",
      });
      wireDebouncedInput(setsNoteInput, fieldKey(blockNumber, week, day, exercise.id, "note"), () => {
        state.setGymExerciseNote(blockNumber, week, day, exercise.id, setsNoteInput.value);
      });
      body.appendChild(setsNoteInput);
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
    });
    dayNoteInput.value = weekLog.dayNote || "";
    wireDebouncedInput(dayNoteInput, fieldKey(blockNumber, week, day, "dayNote"), () => {
      state.setGymDayNote(blockNumber, week, day, dayNoteInput.value);
    });
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
    // Único punto por el que puede llegar un redibujado MIENTRAS se
    // está tecleando (ver state.onChange en js/app.js): un cambio
    // remoto de Firebase que trae datos nuevos (state.replaceAllData,
    // que sí llama a notify()), o cualquier otra mutación en otra
    // parte de la app que dispare notify() mientras esta pestaña está
    // activa. Las propias teclas de esta pestaña ya no pasan por acá
    // (ver wireDebouncedInput/persist() en js/state.js), pero por si
    // acaso: conserva el foco, el cursor y el texto ya tecleado del
    // campo activo después de redibujar.
    refresh() {
      if (!containerRef) return;
      const snapshot = captureFocus(containerRef);
      render(containerRef);
      restoreFocus(containerRef, snapshot);
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
