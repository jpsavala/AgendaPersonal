/*
 * Vista "Comidas": catálogo permanente de comidas (sin fecha, sin
 * semana). Se gestiona aquí (agregar/editar/eliminar) y alimenta el
 * selector del bloque "Comida" en las vistas diaria y semanal.
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  const { state } = ns;
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
    container.innerHTML = "";

    const subtitle = el(
      "p",
      { class: "view-subtitle" },
      "Tu repertorio de comidas. Se usa para elegir rápido en el bloque “Comida” de la agenda."
    );

    const listCard = el("div", { class: "card" }, el("h3", null, "Mis comidas"));
    const meals = state.getMealLibrary();

    if (meals.length === 0) {
      listCard.appendChild(el("p", { class: "muted" }, "Todavía no agregas ninguna comida. Agrega la primera abajo."));
    } else {
      const list = el("div", { class: "meal-list" });
      meals.forEach((meal) => {
        list.appendChild(
          el(
            "div",
            { class: "meal-row" },
            el("input", {
              type: "text",
              class: "meal-name-input",
              value: meal.name,
              oninput: (e) => state.updateMeal(meal.id, e.target.value),
            }),
            el("button", {
              class: "btn-remove",
              title: "Quitar comida",
              onclick: () => state.removeMeal(meal.id),
            }, "×")
          )
        );
      });
      listCard.appendChild(list);
    }

    const newMealInput = el("input", { type: "text", class: "add-input", placeholder: "Nueva comida... (ej. Pollo con verduras)" });
    const commit = () => {
      if (newMealInput.value.trim()) {
        state.addMeal(newMealInput.value);
        newMealInput.value = "";
      }
    };
    newMealInput.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
    listCard.appendChild(
      el("div", { class: "add-row" }, newMealInput, el("button", { class: "btn-secondary", onclick: commit }, "Agregar"))
    );

    container.append(subtitle, listCard);
  }

  ns.mealsView = {
    mount(container) {
      containerRef = container;
      render(container);
    },
    refresh() {
      if (containerRef) render(containerRef);
    },
  };
})(window.Agenda);
