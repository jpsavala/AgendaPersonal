/*
 * Vista "Año": registro, no calendario. Dos secciones independientes:
 * metas del año por trimestre, y cumpleaños/eventos especiales (que
 * reutilizan el mismo almacén de eventos que ya usa la vista Mensual).
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  const { state, dateUtils } = ns;
  let currentYear = new Date().getFullYear();
  let containerRef = null;

  const QUARTERS = [
    ["q1", "Trimestre 1"],
    ["q2", "Trimestre 2"],
    ["q3", "Trimestre 3"],
    ["q4", "Trimestre 4"],
  ];

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
    return el("div", { class: "add-row" }, input, el("button", { class: "btn-primary", onclick: commit }, "Agregar"));
  }

  function render(container) {
    container.innerHTML = "";

    const header = el(
      "div",
      { class: "view-header" },
      el("button", { class: "btn-icon", onclick: () => go(-1) }, "◀"),
      el("span", { class: "week-range" }, String(currentYear)),
      el("button", { class: "btn-icon", onclick: () => go(1) }, "▶"),
      el("button", {
        class: "btn-secondary",
        onclick: () => { currentYear = new Date().getFullYear(); render(container); },
      }, "Este año")
    );

    // Metas del año, por trimestre
    const goalsCard = el("div", { class: "card" }, el("h3", null, "Metas del año"));
    const goals = state.getYearGoals(currentYear);
    QUARTERS.forEach(([key, label], i) => {
      goalsCard.appendChild(el("h4", { class: "pendientes-subtitle" }, label));
      const list = el("div", { class: "check-list" });
      goals[key].forEach((goal) => {
        list.appendChild(
          el(
            "label",
            { class: "check-row" + (goal.done ? " done" : "") },
            el("input", {
              type: "checkbox",
              checked: goal.done ? "checked" : null,
              onchange: () => state.toggleYearGoal(currentYear, key, goal.id),
            }),
            el("span", null, goal.text),
            el("button", {
              class: "btn-remove",
              title: "Quitar meta",
              onclick: () => state.removeYearGoal(currentYear, key, goal.id),
            }, "×")
          )
        );
      });
      goalsCard.appendChild(list);
      goalsCard.appendChild(addRow(`Nueva meta — ${label}...`, (val) => state.addYearGoal(currentYear, key, val)));
    });

    // Cumpleaños y eventos especiales (mismo almacén que la vista Mensual)
    const eventsCard = el("div", { class: "card" }, el("h3", null, "Cumpleaños y eventos especiales"));
    const events = state.getAllEvents();
    if (events.length === 0) {
      eventsCard.appendChild(el("p", { class: "muted" }, "Sin eventos registrados todavía."));
    } else {
      const list = el("div", { class: "meal-list" });
      events.forEach((ev) => {
        list.appendChild(
          el(
            "div",
            { class: "meal-row" },
            el("input", {
              type: "date",
              class: "date-picker",
              value: ev.date,
              onchange: (e) => state.moveEvent(ev.id, e.target.value),
            }),
            el("input", {
              type: "text",
              class: "meal-name-input",
              value: ev.text,
              oninput: (e) => state.updateEventText(ev.id, e.target.value),
            }),
            el("button", {
              class: "btn-remove",
              title: "Quitar evento",
              onclick: () => state.removeEvent(ev.date, ev.id),
            }, "×")
          )
        );
      });
      eventsCard.appendChild(list);
    }

    const newEventDate = el("input", { type: "date", class: "date-picker" });
    const newEventText = el("input", { type: "text", class: "add-input", placeholder: "Nombre del evento (ej. Cumpleaños de mamá)" });
    const commitEvent = () => {
      if (newEventText.value.trim() && newEventDate.value) {
        state.addEvent(newEventDate.value, newEventText.value);
        newEventText.value = "";
      }
    };
    newEventText.addEventListener("keydown", (e) => { if (e.key === "Enter") commitEvent(); });
    eventsCard.appendChild(
      el(
        "div",
        { class: "add-row" },
        newEventDate,
        newEventText,
        el("button", { class: "btn-primary", onclick: commitEvent }, "+ Agregar evento")
      )
    );

    container.append(header, goalsCard, eventsCard);
  }

  function go(delta) {
    currentYear += delta;
    if (containerRef) render(containerRef);
  }

  ns.yearView = {
    mount(container) {
      containerRef = container;
      render(container);
    },
    refresh() {
      if (containerRef) render(containerRef);
    },
  };
})(window.Agenda);
