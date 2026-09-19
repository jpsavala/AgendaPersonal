window.Agenda = window.Agenda || {};
(function (ns) {
  const { state, dateUtils } = ns;
  let currentDate = new Date();

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

  function render(container) {
    const dateStr = dateUtils.toISO(currentDate);
    const day = state.getDay(dateStr);

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
          render(container);
        },
      }),
      el("button", { class: "btn-icon", onclick: () => go(1) }, "▶"),
      el("button", { class: "btn-secondary", onclick: () => { currentDate = new Date(); render(container); } }, "Hoy")
    );

    const subtitle = el("p", { class: "view-subtitle" }, dateUtils.formatLong(currentDate));

    // Frase del día
    const quoteBox = el(
      "div",
      { class: "quote-box" },
      el("span", { class: "quote-label" }, "Frase del día"),
      el("p", { class: "quote-text" }, `“${state.getQuoteForDay(dateStr)}”`)
    );

    // Línea de tiempo
    const timeline = el("div", { class: "timeline" });
    state.HOURS.forEach((hour) => {
      const row = el(
        "div",
        { class: "timeline-row" },
        el("span", { class: "timeline-hour" }, `${hour}:00`),
        el("input", {
          type: "text",
          class: "timeline-input",
          placeholder: "¿Qué vas a hacer?",
          value: day.hours[hour] || "",
          oninput: (e) => state.setHourText(dateStr, hour, e.target.value),
        })
      );
      timeline.appendChild(row);
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

    container.append(header, subtitle, quoteBox, timeline, grid);
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
      el("button", { class: "btn-secondary", onclick: commit }, "Agregar")
    );
  }

  let containerRef = null;
  function go(delta) {
    currentDate = dateUtils.addDays(currentDate, delta);
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
