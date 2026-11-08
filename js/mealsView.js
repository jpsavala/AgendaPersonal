/*
 * Vista "Comidas": catálogo permanente de comidas (sin fecha, sin
 * semana), agrupado en secciones colapsables por categoría (Pollo,
 * Carnes, Mar y las que se agreguen con "+ Categoría"). Se gestiona
 * aquí (agregar/editar/eliminar comidas, asignarles categoría, agregar
 * categorías nuevas) y alimenta el selector agrupado de los bloques
 * "Comida" y "Cena" en las vistas diaria y semanal (ver
 * state.getMealLibraryGrouped).
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  const { state } = ns;
  let containerRef = null;
  // Qué secciones están desplegadas en esta apertura de la pestaña: se
  // reinicia (todas colapsadas) cada vez que se vuelve a entrar a esta
  // vista (ver mount()) — un refresh() por un cambio de datos mientras
  // ya se está acá no la toca, para no cerrar de golpe lo que el
  // usuario tenía abierto.
  let expandedCategoryIds = new Set();
  const UNCATEGORIZED_KEY = "__sin_categoria__";

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

  function buildCategorySelect(meal, categories) {
    const select = el("select", {
      class: "block-select meal-category-select",
      onchange: (e) => state.setMealCategory(meal.id, e.target.value),
    });
    select.appendChild(el("option", { value: "" }, "Sin categoría"));
    categories.forEach((cat) => select.appendChild(el("option", { value: cat.id }, cat.name)));
    select.value = meal.category || "";
    return select;
  }

  function buildMealRow(meal, categories) {
    return el(
      "div",
      { class: "meal-row" },
      el("input", {
        type: "text",
        class: "meal-name-input",
        value: meal.name,
        oninput: (e) => state.updateMeal(meal.id, e.target.value),
      }),
      buildCategorySelect(meal, categories),
      el("button", {
        class: "btn-remove",
        title: "Quitar comida",
        onclick: () => state.removeMeal(meal.id),
      }, "×")
    );
  }

  // Encabezado con nombre + contador + flechita (área táctil de 44px,
  // ver css: .meal-category-head) que despliega/colapsa SOLO esta
  // sección, sin afectar a las demás (ver expandedCategoryIds).
  function buildCategorySection(key, title, meals, categories) {
    const expanded = expandedCategoryIds.has(key);
    const head = el(
      "button",
      {
        class: "meal-category-head",
        onclick: () => {
          if (expanded) expandedCategoryIds.delete(key);
          else expandedCategoryIds.add(key);
          render(containerRef);
        },
      },
      el("span", { class: "meal-category-title" }, `${title} (${meals.length})`),
      el("span", { class: "meal-category-arrow" }, expanded ? "▾" : "▸")
    );
    const section = el("div", { class: "meal-category-section" }, head);
    if (expanded) {
      if (meals.length === 0) {
        section.appendChild(el("p", { class: "muted meal-category-empty" }, "Sin comidas"));
      } else {
        const list = el("div", { class: "meal-list" });
        meals.forEach((meal) => list.appendChild(buildMealRow(meal, categories)));
        section.appendChild(list);
      }
    }
    return section;
  }

  function render(container) {
    container.innerHTML = "";

    const listCard = el("div", { class: "card" }, el("h3", null, "Mis comidas"));
    const meals = state.getMealLibrary();
    const categories = state.getMealCategories();

    if (meals.length === 0) {
      listCard.appendChild(el("p", { class: "muted" }, "Todavía no agregas ninguna comida. Agrega la primera abajo."));
    } else {
      // Una sección por categoría (en el orden de siempre: Pollo,
      // Carnes, Mar, las agregadas después) y "Sin categoría" al
      // final — las que no tienen ninguna comida no ocupan espacio
      // (ver state.getMealLibraryGrouped).
      state.getMealLibraryGrouped().forEach((group) => {
        if (group.meals.length === 0) return;
        const key = group.category ? group.category.id : UNCATEGORIZED_KEY;
        const title = group.category ? group.category.name : "Sin categoría";
        listCard.appendChild(buildCategorySection(key, title, group.meals, categories));
      });
    }

    const newMealInput = el("input", { type: "text", class: "add-input", placeholder: "Nueva comida... (ej. Pollo con verduras)" });
    const newMealCategorySelect = el("select", { class: "block-select meal-category-select" });
    newMealCategorySelect.appendChild(el("option", { value: "" }, "Sin categoría"));
    categories.forEach((cat) => newMealCategorySelect.appendChild(el("option", { value: cat.id }, cat.name)));
    const commitMeal = () => {
      if (newMealInput.value.trim()) {
        state.addMeal(newMealInput.value, newMealCategorySelect.value || null);
        newMealInput.value = "";
        newMealCategorySelect.value = "";
      }
    };
    newMealInput.addEventListener("keydown", (e) => { if (e.key === "Enter") commitMeal(); });
    listCard.appendChild(
      el(
        "div",
        { class: "add-row" },
        newMealInput,
        el(
          "div",
          { class: "add-row-actions" },
          newMealCategorySelect,
          el("button", { class: "btn-primary", onclick: commitMeal }, "Agregar")
        )
      )
    );

    // "+ Categoría": agrega una categoría nueva a la lista (sin tocar
    // las existentes), disponible de inmediato en los selectores de
    // arriba y en el de Comida/Cena de la Diaria/Semanal.
    const categoriesCard = el("div", { class: "card" }, el("h3", null, "Categorías"));
    const newCategoryInput = el("input", { type: "text", class: "add-input", placeholder: "Nueva categoría... (ej. Vegetariano)" });
    const commitCategory = () => {
      if (newCategoryInput.value.trim()) {
        state.addMealCategory(newCategoryInput.value);
        newCategoryInput.value = "";
      }
    };
    newCategoryInput.addEventListener("keydown", (e) => { if (e.key === "Enter") commitCategory(); });
    categoriesCard.appendChild(
      el(
        "div",
        { class: "add-row" },
        newCategoryInput,
        el("button", { class: "btn-secondary", onclick: commitCategory }, "+ Categoría")
      )
    );

    container.append(listCard, categoriesCard);
  }

  ns.mealsView = {
    mount(container) {
      containerRef = container;
      expandedCategoryIds = new Set();
      render(container);
    },
    refresh() {
      if (containerRef) render(containerRef);
    },
  };
})(window.Agenda);
