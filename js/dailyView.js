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
          render(container);
        },
      }),
      el("button", { class: "btn-icon", onclick: () => go(1) }, "▶"),
      el("button", {
        class: "btn-secondary",
        onclick: () => { currentDate = new Date(); addingMeal = false; render(container); },
      }, "Hoy")
    );

    const subtitle = el("p", { class: "view-subtitle" }, dateUtils.formatLong(currentDate));

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
      timeline.appendChild(
        el(
          "div",
          { class: "schedule-block" + (block.highlight ? " highlight" : "") },
          el(
            "div",
            { class: "schedule-block-head" },
            block.time ? el("span", { class: "schedule-time" }, block.time) : null,
            el("span", { class: "schedule-label" }, block.label),
            el("input", {
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
          OFFICE_BLOCK_IDS.includes(block.id) ? buildOfficePendientesList(dateStr, block.id) : null
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

    // Prioridades del trabajo
    const prioritiesSection = el("div", { class: "card" }, el("h3", null, "Prioridades del trabajo"));
    const prioritiesList = el("div", { class: "check-list" });
    day.priorities.forEach((p) => {
      prioritiesList.appendChild(
        el(
          "label",
          { class: "check-row" + (p.done ? " done" : "") },
          el("input", {
            type: "checkbox",
            checked: p.done ? "checked" : null,
            onchange: () => state.togglePriority(dateStr, p.id),
          }),
          el("span", null, p.text),
          el("button", {
            class: "btn-remove",
            title: "Quitar pendiente",
            onclick: () => state.removePriority(dateStr, p.id),
          }, "×")
        )
      );
    });
    prioritiesSection.appendChild(prioritiesList);
    prioritiesSection.appendChild(addRow("Nuevo pendiente...", (val) => state.addPriority(dateStr, val)));

    const grid = el("div", { class: "daily-grid" }, habitsSection, prioritiesSection);

    // Pendientes del fin de semana (solo sábado y domingo, por fecha específica)
    let weekendSection = null;
    if (isWeekend) {
      weekendSection = el("div", { class: "card" }, el("h3", null, "Pendientes del fin de semana"));
      const weekendList = el("div", { class: "check-list" });
      state.getWeekendChecklist(dateStr).forEach((item) => {
        weekendList.appendChild(
          el(
            "label",
            { class: "check-row" + (item.done ? " done" : "") },
            el("input", {
              type: "checkbox",
              checked: item.done ? "checked" : null,
              onchange: () => state.toggleWeekendItem(dateStr, item.id),
            }),
            el("span", null, item.text),
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

    const sections = [header, subtitle, quoteBox, wordBox];
    if (!isWeekend) sections.push(cookToggle);
    sections.push(timeline);
    if (isWeekend) sections.push(weekendSection);
    sections.push(grid);

    container.append(...sections);
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
