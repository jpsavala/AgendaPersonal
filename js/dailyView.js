window.Agenda = window.Agenda || {};
(function (ns) {
  const { state, dateUtils } = ns;
  let currentDate = new Date();
  const MEAL_BLOCK_ID = "preparar_comida";
  const ADD_NEW_MEAL_VALUE = "__add_new__";
  let addingMeal = false;

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

  const OFFICE_BLOCK_IDS = ["oficina_manana", "tarde_oficina"];
  const OFFICE_BLOCK_OPTIONS = [
    { value: "oficina_manana", label: "10:00–14:00" },
    { value: "tarde_oficina", label: "16:30–19:00" },
  ];

  function buildOfficeBlockSelect(selectedValue) {
    const select = el("select", { class: "block-select" });
    OFFICE_BLOCK_OPTIONS.forEach((opt) => {
      select.appendChild(el("option", { value: opt.value }, opt.label));
    });
    select.value = selectedValue || OFFICE_BLOCK_OPTIONS[0].value;
    return select;
  }

  function buildOfficePendientesList(dateStr, blockId) {
    const items = state.getOfficePendientes(dateStr, blockId);
    if (!items.length) return null;
    const list = el("div", { class: "office-pendientes-list" });
    items.forEach((item) => {
      list.appendChild(
        el(
          "label",
          { class: "check-row" + (item.done ? " done" : "") },
          el("input", {
            type: "checkbox",
            checked: item.done ? "checked" : null,
            onchange: () => state.toggleOfficePendiente(dateStr, item.id),
          }),
          el("span", null, item.text)
        )
      );
    });
    return list;
  }

  // Fecha (o null) cuya respuesta de gimnasio se está corrigiendo en
  // este momento: al tocar "Corregir" se vuelve a mostrar Sí/No para
  // esa fecha puntual, en vez del estado ya guardado.
  let editingGymDate = null;

  function applyGymEdit(dateStr, done) {
    const result = state.editGymDay(dateStr, done);
    editingGymDate = null;
    if (!result.ok && result.reason === "conflict") {
      showGymConflictWarning(result.conflicts);
    }
    // Siempre se vuelve a dibujar (haya cambiado algo o no), para que la
    // vista salga del modo "Corregir" y refleje el estado real: el
    // guardado silencioso o la advertencia ya lo decidieron arriba.
    render(containerRef);
  }

  function showGymConflictWarning(conflicts) {
    const lines = conflicts.map((c) => {
      const dateLabel = dateUtils.formatLong(dateUtils.fromISO(c.date));
      if (!c.newSession) {
        return `• ${dateLabel}: con este cambio, ese día ya no correspondería entrenar (tenías guardado "${c.oldSession}").`;
      }
      return `• ${dateLabel}: tenías guardado "${c.oldSession}", pero con este cambio le tocaría "${c.newSession}".`;
    });
    const plural = conflicts.length > 1;
    alert(
      `No se pudo aplicar la corrección: choca con ${plural ? conflicts.length + " fechas posteriores" : "una fecha posterior"} que ya ${plural ? "tienen" : "tiene"} su propia respuesta guardada:\n\n${lines.join("\n")}\n\nCorregí esas fechas primero (de la misma forma) y volvé a intentar.`
    );
  }

  function buildGymExtras(dateStr, block) {
    if (!block.gymStatus) return null;
    const parts = [];
    if (block.gymStatus === "done" || block.gymStatus === "skipped") {
      if (editingGymDate === dateStr) {
        parts.push(
          el(
            "div",
            { class: "gym-actions" },
            el("span", { class: "muted" }, "Corregir: ¿entrenaste ese día?"),
            el("button", { class: "btn-secondary", onclick: () => applyGymEdit(dateStr, false) }, "No"),
            el("button", { class: "btn-primary", onclick: () => applyGymEdit(dateStr, true) }, "Sí")
          )
        );
      } else {
        parts.push(
          el(
            "div",
            { class: "gym-actions" },
            el("span", { class: "muted" }, block.gymStatus === "done" ? "✓ Hecho" : "No realizada"),
            el(
              "button",
              { class: "link-btn", onclick: () => { editingGymDate = dateStr; render(containerRef); } },
              "Corregir"
            )
          )
        );
      }
    } else if (block.gymStatus === "pending") {
      parts.push(
        el(
          "div",
          { class: "gym-actions" },
          el("span", { class: "muted" }, "¿Entrenaste hoy?"),
          el("button", { class: "btn-secondary", onclick: () => state.markGymSkipped(dateStr) }, "No"),
          el("button", { class: "btn-primary", onclick: () => state.markGymDone(dateStr) }, "Sí")
        )
      );
    }
    const todayStr = dateUtils.toISO(new Date());
    if (dateStr > todayStr) {
      const unavailable = state.isGymUnavailable(dateStr);
      parts.push(
        el(
          "button",
          {
            class: "link-btn",
            onclick: () => { state.setGymUnavailable(dateStr, !unavailable); render(containerRef); },
          },
          unavailable ? 'Quitar "no disponible"' : "Marcar día como no disponible"
        )
      );
    }
    return parts;
  }

  function buildMealSelector(dateStr, currentText) {
    if (addingMeal) {
      const input = el("input", { type: "text", class: "add-input", placeholder: "Nombre de la comida nueva..." });
      const commit = () => {
        if (input.value.trim()) {
          state.addMeal(input.value);
          state.setBlockText(dateStr, MEAL_BLOCK_ID, input.value.trim());
        }
        addingMeal = false;
        render(containerRef);
      };
      const cancel = () => {
        addingMeal = false;
        render(containerRef);
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") cancel();
      });
      return el(
        "div",
        { class: "add-row" },
        input,
        el("button", { class: "btn-primary", onclick: commit }, "Guardar"),
        el("button", { class: "btn-secondary", onclick: cancel }, "Cancelar")
      );
    }

    const select = el("select", {
      class: "meal-select",
      onchange: (e) => {
        const val = e.target.value;
        if (val === ADD_NEW_MEAL_VALUE) {
          addingMeal = true;
          render(containerRef);
          const input = containerRef.querySelector(".add-input");
          if (input) input.focus();
          return;
        }
        state.setBlockText(dateStr, MEAL_BLOCK_ID, val);
      },
    });
    select.appendChild(el("option", { value: "" }, "— Elegir comida —"));
    const library = state.getMealLibrary();
    library.forEach((meal) => {
      select.appendChild(el("option", { value: meal.name }, meal.name));
    });
    if (currentText && !library.some((m) => m.name === currentText)) {
      select.appendChild(el("option", { value: currentText }, currentText));
    }
    select.appendChild(el("option", { value: ADD_NEW_MEAL_VALUE }, "+ Agregar nueva..."));
    select.value = currentText || "";
    return select;
  }

  function render(container) {
    const dateStr = dateUtils.toISO(currentDate);
    const day = state.getDay(dateStr);
    const isWeekend = dateUtils.isWeekend(currentDate);

    container.innerHTML = "";

    // Cabecera con selector de fecha
    const header = el(
      "div",
      { class: "view-header" },
      el("button", { class: "btn-icon", onclick: () => go(-1) }, "◀"),
      el("input", {
        type: "date",
        class: "date-picker",
        value: dateStr,
        onchange: (e) => {
          currentDate = dateUtils.fromISO(e.target.value);
          addingMeal = false;
          editingGymDate = null;
          render(container);
        },
      }),
      el("button", { class: "btn-icon", onclick: () => go(1) }, "▶"),
      el("button", {
        class: "btn-secondary",
        onclick: () => { currentDate = new Date(); addingMeal = false; editingGymDate = null; render(container); },
      }, "Hoy")
    );

    const subtitle = el("p", { class: "view-subtitle" }, dateUtils.formatLong(currentDate));

    // Cumpleaños y eventos especiales de este día (vista Año / Mensual)
    const events = state.getEvents(dateStr);
    const eventsBanner = events.length
      ? el(
          "div",
          { class: "event-banner" },
          events.map((ev) => el("p", { class: "event-banner-item" }, `🎉 ${ev.text}`))
        )
      : null;

    // Frase del día
    const quote = state.getQuoteForDay(dateStr);
    const quoteBox = el(
      "div",
      { class: "quote-box" },
      el("span", { class: "quote-label" }, "Frase del día"),
      el("p", { class: "quote-text" }, `“${quote.texto}”`),
      el("p", { class: "quote-author" }, `— ${quote.autor}`)
    );

    // Palabra del día
    const word = state.getWordForDay(dateStr);
    const wordBox = el(
      "div",
      { class: "quote-box" },
      el("span", { class: "quote-label" }, "Palabra del día"),
      el("p", { class: "word-text" }, word.palabra),
      el("p", { class: "word-meaning-es" }, word.significadoEs),
      el("p", { class: "word-meaning-en" }, `EN: ${word.significadoEn}`)
    );

    // Toggle "día que cocino" / "día que no cocino"
    const cookToggle = el(
      "div",
      { class: "toggle-group" },
      el(
        "button",
        {
          class: "toggle-btn" + (day.cocina ? " active" : ""),
          onclick: () => state.setDayCocina(dateStr, true),
        },
        "Día que cocino"
      ),
      el(
        "button",
        {
          class: "toggle-btn" + (!day.cocina ? " active" : ""),
          onclick: () => state.setDayCocina(dateStr, false),
        },
        "Día que no cocino"
      )
    );

    // Horario del día (bloques de duración variable)
    const timeline = el("div", { class: "schedule" });
    state.getDayBlocks(dateStr).forEach((block) => {
      if (block.marker) {
        timeline.appendChild(
          el(
            "div",
            { class: "schedule-marker" },
            el("span", { class: "schedule-marker-time" }, block.time),
            el("span", { class: "schedule-marker-label" }, block.label)
          )
        );
        return;
      }
      // Corrida: una sola línea fusionada ("hora — Correr - 3km lento"),
      // sin la etiqueta genérica "Correr" aparte ni el texto repetido
      // debajo; los días sin corrida programada no muestran nada de
      // este bloque (ni la etiqueta ni una fila vacía).
      if (block.id === "correr" && block.fixed) {
        if (!block.text) return;
        timeline.appendChild(
          el(
            "div",
            { class: "schedule-block" },
            el(
              "div",
              { class: "schedule-block-head" },
              block.time ? el("span", { class: "schedule-time" }, block.time) : null,
              el("span", { class: "schedule-label" }, block.text),
              el("input", {
                type: "checkbox",
                class: "schedule-check",
                checked: block.done ? "checked" : null,
                onchange: () => state.toggleBlockDone(dateStr, block.id),
              })
            )
          )
        );
        return;
      }

      timeline.appendChild(
        el(
          "div",
          { class: "schedule-block" + (block.highlight ? " highlight" : "") },
          el(
            "div",
            { class: "schedule-block-head" },
            block.time ? el("span", { class: "schedule-time" }, block.time) : null,
            el("span", { class: "schedule-label" }, block.label),
            block.gymStatus
              ? null
              : el("input", {
                  type: "checkbox",
                  class: "schedule-check",
                  checked: block.done ? "checked" : null,
                  onchange: () => state.toggleBlockDone(dateStr, block.id),
                }),
          ),
          block.fixed
            ? (block.text ? el("p", { class: "schedule-readonly-text" }, block.text) : null)
            : block.id === MEAL_BLOCK_ID
            ? buildMealSelector(dateStr, block.text)
            : el("input", {
                type: "text",
                class: "schedule-input",
                placeholder: "¿Qué vas a hacer en este bloque?",
                value: block.text,
                oninput: (e) => state.setBlockText(dateStr, block.id, e.target.value),
              }),
          OFFICE_BLOCK_IDS.includes(block.id) ? buildOfficePendientesList(dateStr, block.id) : null,
          block.id === "gimnasio" ? buildGymExtras(dateStr, block) : null
        )
      );
    });

    // Hábitos
    const habitsSection = el("div", { class: "card" }, el("h3", null, "Hábitos"));
    const habitsList = el("div", { class: "check-list" });
    state.getHabitsDefs().forEach((habit) => {
      habitsList.appendChild(
        el(
          "label",
          { class: "check-row" },
          el("input", {
            type: "checkbox",
            checked: day.habits[habit.id] ? "checked" : null,
            onchange: () => state.toggleDayHabit(dateStr, habit.id),
          }),
          el("span", null, habit.name),
          el("button", {
            class: "btn-remove",
            title: "Quitar hábito",
            onclick: () => state.removeHabit(habit.id),
          }, "×")
        )
      );
    });
    habitsSection.appendChild(habitsList);
    habitsSection.appendChild(addRow("Nuevo hábito...", (val) => state.addHabit(val)));

    // Prioridades del trabajo: misma lista y mismo dato que "Pendientes
    // de la semana: Trabajo" de la vista Semanal (pendientesTrabajo),
    // combinando los dos bloques de oficina para esta fecha.
    const prioritiesSection = el("div", { class: "card" }, el("h3", null, "Prioridades del trabajo"));
    const prioritiesList = el("div", { class: "check-list" });
    state.getWorkPriorities(dateStr).forEach((p) => {
      const blockLabel = (OFFICE_BLOCK_OPTIONS.find((o) => o.value === p.blockId) || {}).label || "";
      prioritiesList.appendChild(
        el(
          "label",
          { class: "check-row" + (p.done ? " done" : "") },
          el("input", {
            type: "checkbox",
            checked: p.done ? "checked" : null,
            onchange: () => state.toggleOfficePendiente(dateStr, p.id),
          }),
          el("span", null, p.text),
          el("span", { class: "muted" }, blockLabel),
          el("button", {
            class: "btn-remove",
            title: "Quitar pendiente",
            onclick: () => state.removeOfficePendienteForDate(dateStr, p.id),
          }, "×")
        )
      );
    });
    prioritiesSection.appendChild(prioritiesList);

    const newPriorityInput = el("input", { type: "text", class: "add-input", placeholder: "Nuevo pendiente..." });
    const newPriorityBlockSelect = buildOfficeBlockSelect(OFFICE_BLOCK_OPTIONS[0].value);
    const commitPriority = () => {
      if (newPriorityInput.value.trim()) {
        state.addOfficePendienteForDate(dateStr, newPriorityInput.value, newPriorityBlockSelect.value);
        newPriorityInput.value = "";
        newPriorityBlockSelect.value = OFFICE_BLOCK_OPTIONS[0].value;
      }
    };
    newPriorityInput.addEventListener("keydown", (e) => { if (e.key === "Enter") commitPriority(); });
    prioritiesSection.appendChild(
      el(
        "div",
        { class: "add-row" },
        newPriorityInput,
        newPriorityBlockSelect,
        el("button", { class: "btn-primary", onclick: commitPriority }, "Agregar")
      )
    );

    const grid = el("div", { class: "daily-grid" }, habitsSection, prioritiesSection);

    // Pendientes del fin de semana (solo sábado y domingo, por fecha específica)
    let weekendSection = null;
    if (isWeekend) {
      weekendSection = el("div", { class: "card" }, el("h3", null, "Pendientes del fin de semana"));
      const weekendList = el("div", { class: "check-list" });
      state.getWeekendChecklist(dateStr).forEach((item) => {
        const gymDone = item.gymStatus === "done";
        const gymResolved = item.gymStatus === "done" || item.gymStatus === "skipped";

        if (gymResolved && editingGymDate === dateStr) {
          weekendList.appendChild(
            el(
              "div",
              { class: "check-row" },
              el("span", null, item.text),
              el(
                "div",
                { class: "gym-actions" },
                el("button", { class: "btn-secondary", onclick: () => applyGymEdit(dateStr, false) }, "No"),
                el("button", { class: "btn-primary", onclick: () => applyGymEdit(dateStr, true) }, "Sí")
              )
            )
          );
          return;
        }

        weekendList.appendChild(
          el(
            "label",
            { class: "check-row" + (item.done || gymDone ? " done" : "") },
            el("input", {
              type: "checkbox",
              checked: item.done || gymDone ? "checked" : null,
              disabled: item.gymStatus && item.gymStatus !== "pending" ? "disabled" : null,
              onchange: (e) => {
                if (item.gymStatus === "pending") {
                  if (e.target.checked) state.markGymDone(dateStr);
                  else e.target.checked = true; // no hay "deshacer" una vez confirmado
                  return;
                }
                state.toggleWeekendItem(dateStr, item.id);
              },
            }),
            el("span", null, item.text),
            gymResolved
              ? el(
                  "button",
                  { class: "link-btn", onclick: () => { editingGymDate = dateStr; render(containerRef); } },
                  "Corregir"
                )
              : null,
            el("button", {
              class: "btn-remove",
              title: "Quitar pendiente",
              onclick: () => state.removeWeekendItem(dateStr, item.id),
            }, "×")
          )
        );
      });
      weekendSection.appendChild(weekendList);
      weekendSection.appendChild(addRow("Nuevo pendiente...", (val) => state.addWeekendItem(dateStr, val)));
    }

    const sections = [header, subtitle, eventsBanner, quoteBox, wordBox];
    if (!isWeekend) sections.push(cookToggle);
    sections.push(timeline);
    if (isWeekend) sections.push(weekendSection);
    sections.push(grid);

    container.append(...sections.filter(Boolean));
  }

  function addRow(placeholder, onAdd) {
    const input = el("input", { type: "text", class: "add-input", placeholder });
    const commit = () => {
      if (input.value.trim()) {
        onAdd(input.value);
        input.value = "";
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
    });
    return el(
      "div",
      { class: "add-row" },
      input,
      el("button", { class: "btn-primary", onclick: commit }, "Agregar")
    );
  }

  let containerRef = null;
  function go(delta) {
    currentDate = dateUtils.addDays(currentDate, delta);
    addingMeal = false;
    editingGymDate = null;
    if (containerRef) render(containerRef);
  }

  ns.dailyView = {
    mount(container) {
      containerRef = container;
      render(container);
    },
    refresh() {
      if (containerRef) render(containerRef);
    },
  };
})(window.Agenda);
