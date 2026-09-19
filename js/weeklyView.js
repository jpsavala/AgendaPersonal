window.Agenda = window.Agenda || {};
(function (ns) {
  const { state, dateUtils } = ns;
  let currentMonday = dateUtils.getMonday(new Date());
  let containerRef = null;

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
    const mondayStr = dateUtils.toISO(currentMonday);
    const week = state.getWeek(mondayStr);
    const days = dateUtils.getWeekDates(currentMonday);

    container.innerHTML = "";

    const header = el(
      "div",
      { class: "view-header" },
      el("button", { class: "btn-icon", onclick: () => go(-1) }, "◀"),
      el("span", { class: "week-range" }, dateUtils.formatShortRange(currentMonday)),
      el("button", { class: "btn-icon", onclick: () => go(1) }, "▶"),
      el("button", {
        class: "btn-secondary",
        onclick: () => { currentMonday = dateUtils.getMonday(new Date()); render(container); },
      }, "Esta semana")
    );

    const daysGrid = el("div", { class: "week-days-grid" });
    days.forEach((date, i) => {
      const isWeekend = i >= 5;
      const dateStrForDay = dateUtils.toISO(date);
      const dayCard = el(
        "div",
        { class: "card week-day-card" + (isWeekend ? " weekend" : "") },
        el("h4", null, `${dateUtils.DAY_LABELS_LONG[i]} ${date.getDate()}`)
      );
      // Mismos bloques que la vista diaria: el texto es la plantilla de
      // este día de la semana, así que editarlo aquí también lo cambia
      // en la vista diaria (y viceversa). El toggle "día que cocino" es
      // el que ya tenga guardado esta fecha específica.
      state.getDayBlocks(dateStrForDay).forEach((block) => {
        if (block.marker) {
          dayCard.appendChild(
            el(
              "div",
              { class: "schedule-marker" },
              el("span", { class: "schedule-marker-time" }, block.time),
              el("span", { class: "schedule-marker-label" }, block.label)
            )
          );
          return;
        }
        dayCard.appendChild(el("label", { class: "field-label" }, `${block.time} — ${block.label}`));
        dayCard.appendChild(
          el("textarea", {
            class: "block-textarea",
            rows: "2",
            oninput: (e) => state.setBlockText(dateStrForDay, block.id, e.target.value),
          }, block.text)
        );
      });
      daysGrid.appendChild(dayCard);
    });

    const metaCard = el(
      "div",
      { class: "card" },
      el("h3", null, "Meta de la semana"),
      el("textarea", {
        class: "block-textarea",
        rows: "3",
        oninput: (e) => state.setWeekMeta(mondayStr, e.target.value),
      }, week.metaSemana || "")
    );

    const habitsCard = el("div", { class: "card" }, el("h3", null, "Seguimiento de hábitos"));
    const habitDefs = state.getHabitsDefs();
    if (habitDefs.length === 0) {
      habitsCard.appendChild(el("p", { class: "muted" }, "No hay hábitos definidos. Agrégalos en la vista diaria."));
    } else {
      const table = el("table", { class: "habits-table" });
      const thead = el("tr", null, el("th", null, "Hábito"));
      dateUtils.DAY_LABELS_SHORT.forEach((lbl) => thead.appendChild(el("th", null, lbl)));
      table.appendChild(el("thead", null, thead));
      const tbody = el("tbody");
      habitDefs.forEach((habit) => {
        const row = el("tr", null, el("td", { class: "habit-name" }, habit.name));
        dateUtils.DAY_KEYS.forEach((dayKey) => {
          const checked = !!(week.habits[habit.id] && week.habits[habit.id][dayKey]);
          row.appendChild(
            el(
              "td",
              null,
              el("input", {
                type: "checkbox",
                checked: checked ? "checked" : null,
                onchange: () => state.toggleWeekHabit(mondayStr, habit.id, dayKey),
              })
            )
          );
        });
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      habitsCard.appendChild(el("div", { class: "table-scroll" }, table));
    }

    const revisionCard = el(
      "div",
      { class: "card" },
      el("h3", null, "Revisión del viernes"),
      el("label", { class: "field-label" }, "¿Qué se cumplió y qué se cayó?"),
      el("textarea", {
        class: "block-textarea",
        rows: "3",
        oninput: (e) => state.setRevisionViernes(mondayStr, "cumplido", e.target.value),
      }, week.revisionViernes.cumplido || ""),
      el("label", { class: "field-label" }, "¿Qué bloque necesita ajuste la próxima semana?"),
      el("textarea", {
        class: "block-textarea",
        rows: "3",
        oninput: (e) => state.setRevisionViernes(mondayStr, "ajuste", e.target.value),
      }, week.revisionViernes.ajuste || "")
    );

    container.append(header, daysGrid, metaCard, habitsCard, revisionCard);
  }

  function go(delta) {
    currentMonday = dateUtils.addDays(currentMonday, delta * 7);
    if (containerRef) render(containerRef);
  }

  ns.weeklyView = {
    mount(container) {
      containerRef = container;
      render(container);
    },
    refresh() {
      if (containerRef) render(containerRef);
    },
  };
})(window.Agenda);
