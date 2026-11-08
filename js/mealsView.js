/*
 * Vista "Comidas": catálogo permanente de comidas (sin fecha, sin
 * semana), agrupado en secciones colapsables por categoría (Pollo,
 * Carnes, Mar y las que se agreguen con "+ Categoría"), cada receta con
 * su propia lista de ingredientes editable, y la sección "Súper": la
 * lista de compras de la semana armada con los ingredientes de las
 * comidas/cenas elegidas esa semana, la despensa y los extras sueltos
 * (ver state.getSuperList y alrededores). Alimenta el selector
 * agrupado de los bloques "Comida" y "Cena" en las vistas diaria y
 * semanal (ver state.getMealLibraryGrouped) — eso no cambia acá.
 */
window.Agenda = window.Agenda || {};
(function (ns) {
  const { state, dateUtils } = ns;
  let containerRef = null;
  // Qué secciones de categoría y qué recetas (ingredientes) están
  // desplegadas en esta apertura de la pestaña: se reinician (todo
  // colapsado) cada vez que se vuelve a entrar a esta vista (ver
  // mount()) — un refresh() por un cambio de datos mientras ya se está
  // acá no las toca, para no cerrar de golpe lo que el usuario tenía
  // abierto.
  let expandedCategoryIds = new Set();
  let expandedIngredientsIds = new Set();
  const UNCATEGORIZED_KEY = "__sin_categoria__";

  // Semana que muestra "Súper": arranca siempre en la semana actual al
  // entrar a la pestaña (ver mount()); ◀/▶/"Esta semana" la cambian
  // mientras se sigue en la pestaña, sin resetearse con cada refresh().
  let currentSuperMonday = dateUtils.getMonday(new Date());

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

  // ---------- Recetas: categoría + ingredientes ----------
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

  function buildIngredientRow(meal, ingredient, index, total) {
    return el(
      "div",
      { class: "ingredient-row" },
      el("input", {
        type: "text",
        class: "ingredient-name-input",
        placeholder: "Ingrediente",
        value: ingredient.name,
        oninput: (e) => state.updateIngredient(meal.id, ingredient.id, { name: e.target.value }),
      }),
      el("input", {
        type: "text",
        class: "ingredient-qty-input",
        placeholder: "Cant.",
        value: ingredient.qty,
        oninput: (e) => state.updateIngredient(meal.id, ingredient.id, { qty: e.target.value }),
      }),
      el("input", {
        type: "text",
        class: "ingredient-unit-input",
        placeholder: "Unidad",
        value: ingredient.unit,
        oninput: (e) => state.updateIngredient(meal.id, ingredient.id, { unit: e.target.value }),
      }),
      el(
        "button",
        {
          class: "ingredient-move-btn",
          title: "Subir",
          disabled: index === 0 ? "disabled" : null,
          onclick: () => { state.moveIngredient(meal.id, ingredient.id, -1); render(containerRef); },
        },
        "↑"
      ),
      el(
        "button",
        {
          class: "ingredient-move-btn",
          title: "Bajar",
          disabled: index === total - 1 ? "disabled" : null,
          onclick: () => { state.moveIngredient(meal.id, ingredient.id, 1); render(containerRef); },
        },
        "↓"
      ),
      el(
        "button",
        {
          class: "btn-remove",
          title: "Quitar ingrediente",
          onclick: () => { state.removeIngredient(meal.id, ingredient.id); render(containerRef); },
        },
        "×"
      )
    );
  }

  function buildIngredientsSection(meal) {
    const expanded = expandedIngredientsIds.has(meal.id);
    const ingredients = state.getMealIngredients(meal.id);
    const toggle = el(
      "button",
      {
        class: "ingredients-toggle",
        onclick: () => {
          if (expanded) expandedIngredientsIds.delete(meal.id);
          else expandedIngredientsIds.add(meal.id);
          render(containerRef);
        },
      },
      `${expanded ? "▾" : "▸"} Ingredientes (${ingredients.length})`
    );
    const wrap = el("div", { class: "ingredients-section" }, toggle);
    if (!expanded) return wrap;

    if (ingredients.length) {
      const list = el("div", { class: "ingredient-list" });
      ingredients.forEach((ing, i) => list.appendChild(buildIngredientRow(meal, ing, i, ingredients.length)));
      wrap.appendChild(list);
    }

    const newName = el("input", { type: "text", class: "add-input ingredient-name-input", placeholder: "Nuevo ingrediente... (ej. Cebolla)" });
    const newQty = el("input", { type: "text", class: "ingredient-qty-input", placeholder: "Cant." });
    const newUnit = el("input", { type: "text", class: "ingredient-unit-input", placeholder: "Unidad" });
    const commit = () => {
      if (newName.value.trim()) {
        state.addIngredient(meal.id, { name: newName.value, qty: newQty.value, unit: newUnit.value });
        newName.value = "";
        newQty.value = "";
        newUnit.value = "";
        render(containerRef);
        const input = containerRef.querySelector(`[data-ingredient-focus="${meal.id}"]`);
        if (input) input.focus();
      }
    };
    newName.setAttribute("data-ingredient-focus", meal.id);
    newName.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
    newQty.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
    newUnit.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
    wrap.appendChild(
      el("div", { class: "add-row ingredient-row" }, newName, newQty, newUnit, el("button", { class: "btn-primary", onclick: commit }, "Agregar"))
    );
    return wrap;
  }

  function buildMealRow(meal, categories) {
    const ingredientCount = state.getMealIngredients(meal.id).length;
    return el(
      "div",
      { class: "meal-row-wrap" },
      el(
        "div",
        { class: "meal-row" },
        el("input", {
          type: "text",
          class: "meal-name-input",
          value: meal.name,
          oninput: (e) => state.updateMeal(meal.id, e.target.value),
        }),
        buildCategorySelect(meal, categories),
        ingredientCount === 0 ? el("span", { class: "muted meal-no-ingredients" }, "• Sin ingredientes") : null,
        el("button", {
          class: "btn-remove",
          title: "Quitar comida",
          onclick: () => state.removeMeal(meal.id),
        }, "×")
      ),
      buildIngredientsSection(meal)
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

  function buildMealsCard() {
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
    return listCard;
  }

  function buildCategoriesCard() {
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
    return categoriesCard;
  }

  // ---------- Súper: lista de compras de la semana ----------
  function buildPantrySection() {
    const section = el("div", { class: "pantry-section" }, el("h4", null, "Despensa"));
    const items = state.getPantryItems();
    if (!items.length) {
      section.appendChild(el("p", { class: "muted" }, "Todavía no agregas artículos de despensa."));
    } else {
      const list = el("div", { class: "pantry-list" });
      items.forEach((item) => {
        const needed = state.isPantryItemNeeded(dateUtils.toISO(currentSuperMonday), item.id);
        const checkbox = el("input", {
          type: "checkbox",
          checked: needed ? "checked" : null,
          onchange: (e) => {
            state.setPantryItemNeeded(dateUtils.toISO(currentSuperMonday), item.id, e.target.checked);
            render(containerRef);
          },
        });
        list.appendChild(
          el(
            "div",
            { class: "pantry-item-row" },
            el("label", { class: "pantry-item-check-label" }, checkbox, el("span", null, "Necesito esta semana")),
            el("input", {
              type: "text",
              class: "pantry-item-name-input",
              value: item.name,
              oninput: (e) => state.updatePantryItem(item.id, e.target.value),
            }),
            el("button", {
              class: "btn-remove",
              title: "Quitar de la despensa",
              onclick: () => { state.removePantryItem(item.id); render(containerRef); },
            }, "×")
          )
        );
      });
      section.appendChild(list);
    }

    const newPantryInput = el("input", { type: "text", class: "add-input", placeholder: "Nuevo artículo de despensa... (ej. Sal)" });
    const commitPantry = () => {
      if (newPantryInput.value.trim()) {
        state.addPantryItem(newPantryInput.value);
        newPantryInput.value = "";
        render(containerRef);
      }
    };
    newPantryInput.addEventListener("keydown", (e) => { if (e.key === "Enter") commitPantry(); });
    section.appendChild(
      el("div", { class: "add-row" }, newPantryInput, el("button", { class: "btn-primary", onclick: commitPantry }, "Agregar"))
    );
    return section;
  }

  function buildPantrySuggestions() {
    const suggestions = state.getPantrySuggestions();
    if (!suggestions.length) return null;
    const wrap = el("div", { class: "pantry-suggestions" });
    suggestions.forEach((s) => {
      wrap.appendChild(
        el(
          "div",
          { class: "pantry-suggestion" },
          el("p", null, `Agregaste "${s.label}" varias semanas. ¿Agregar a tu despensa?`),
          el(
            "div",
            { class: "gym-actions" },
            el("button", {
              class: "btn-secondary",
              onclick: () => { state.dismissPantrySuggestion(s.key); render(containerRef); },
            }, "No"),
            el("button", {
              class: "btn-primary",
              onclick: () => { state.acceptPantrySuggestion(s.key); render(containerRef); },
            }, "Sí")
          )
        )
      );
    });
    return wrap;
  }

  function buildMissingIngredientsNotice(missingIngredientRecipes) {
    if (!missingIngredientRecipes.length) return null;
    return el(
      "p",
      { class: "muted super-missing-notice" },
      `Faltan ingredientes en ${missingIngredientRecipes.length} ${missingIngredientRecipes.length === 1 ? "receta" : "recetas"}: ${missingIngredientRecipes.join(", ")}.`
    );
  }

  function buildSuperRow(mondayStr, row) {
    const checkbox = el("input", {
      type: "checkbox",
      checked: row.bought ? "checked" : null,
      onchange: () => { state.toggleSuperRowBought(mondayStr, row.key); render(containerRef); },
    });
    const qtyUnit = [row.qty, row.unit].filter(Boolean).join(" ").trim();
    const content = el(
      "span",
      { class: "super-row-content" },
      el("span", { class: "super-row-name" }, qtyUnit ? `${row.name} (${qtyUnit})` : row.name),
      row.origin.length ? el("span", { class: "super-row-origin" }, row.origin.join(", ")) : null
    );
    const children = [
      el("label", { class: "super-row-check-label" }, checkbox, content),
    ];
    if (row.source === "ingredient") {
      children.push(
        el(
          "button",
          {
            class: "link-btn",
            onclick: () => {
              state.hideSuperRow(mondayStr, row.key);
              render(containerRef);
              if (ns.quickCapture && ns.quickCapture.showUndoToast) {
                ns.quickCapture.showUndoToast("Ya tengo este artículo", () => {
                  state.unhideSuperRow(mondayStr, row.key);
                  render(containerRef);
                });
              }
            },
          },
          "Ya tengo"
        )
      );
    } else if (row.source === "extra") {
      children.push(
        el("button", {
          class: "btn-remove",
          title: "Quitar extra",
          onclick: () => { state.removeWeekExtra(mondayStr, row.key.replace("extra:", "")); render(containerRef); },
        }, "×")
      );
    }
    return el("div", { class: "super-row" + (row.bought ? " bought" : "") }, children);
  }

  function buildExtraAddRow(mondayStr) {
    const datalistId = "super-extra-suggestions";
    const input = el("input", { type: "text", class: "add-input", placeholder: "Agregar artículo...", list: datalistId });
    const qtyInput = el("input", { type: "text", class: "ingredient-qty-input", placeholder: "Cant." });
    const datalist = el("datalist", { id: datalistId });
    state.getExtraSuggestions().forEach((name) => datalist.appendChild(el("option", { value: name })));
    const commit = () => {
      if (input.value.trim()) {
        state.addWeekExtra(mondayStr, input.value, qtyInput.value);
        input.value = "";
        qtyInput.value = "";
        render(containerRef);
      }
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
    qtyInput.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
    return el(
      "div",
      { class: "add-row" },
      input,
      datalist,
      el(
        "div",
        { class: "add-row-actions" },
        qtyInput,
        el("button", { class: "btn-primary", onclick: commit }, "Agregar")
      )
    );
  }

  function buildSuperCard() {
    const mondayStr = dateUtils.toISO(currentSuperMonday);
    const card = el("div", { class: "card super-card" }, el("h3", null, "Súper"));

    const header = el(
      "div",
      { class: "view-header" },
      el("button", { class: "btn-icon", onclick: () => { currentSuperMonday = dateUtils.addDays(currentSuperMonday, -7); render(containerRef); } }, "◀"),
      el("span", { class: "week-range" }, dateUtils.formatShortRange(currentSuperMonday)),
      el("button", { class: "btn-icon", onclick: () => { currentSuperMonday = dateUtils.addDays(currentSuperMonday, 7); render(containerRef); } }, "▶"),
      el("button", {
        class: "btn-secondary",
        onclick: () => { currentSuperMonday = dateUtils.getMonday(new Date()); render(containerRef); },
      }, "Esta semana")
    );
    card.appendChild(header);

    const { rows, missingIngredientRecipes } = state.getSuperList(mondayStr);
    const missingNotice = buildMissingIngredientsNotice(missingIngredientRecipes);
    if (missingNotice) card.appendChild(missingNotice);
    const suggestions = buildPantrySuggestions();
    if (suggestions) card.appendChild(suggestions);

    if (!rows.length) {
      card.appendChild(el("p", { class: "muted" }, "Todavía no hay nada en el súper de esta semana."));
    } else {
      const list = el("div", { class: "super-list" });
      rows.forEach((row) => list.appendChild(buildSuperRow(mondayStr, row)));
      card.appendChild(list);
    }

    card.appendChild(buildExtraAddRow(mondayStr));

    const copyBtn = el(
      "button",
      {
        class: "btn-secondary super-copy-btn",
        onclick: async () => {
          const text = state.buildSuperListText(mondayStr);
          try {
            await navigator.clipboard.writeText(text);
            copyBtn.textContent = "¡Copiado!";
            setTimeout(() => { copyBtn.textContent = "Copiar lista"; }, 1500);
          } catch (err) {
            alert("No se pudo copiar la lista. Copiala a mano desde acá:\n\n" + text);
          }
        },
      },
      "Copiar lista"
    );
    card.appendChild(copyBtn);

    card.appendChild(buildPantrySection());
    return card;
  }

  function render(container) {
    container.innerHTML = "";
    container.append(
      buildMealsCard(),
      buildCategoriesCard(),
      buildSuperCard(),
      // Espacio al final (ver css: .fab-bottom-spacer) para que el
      // botón flotante "+" no tape el último renglón.
      el("div", { class: "fab-bottom-spacer" })
    );
  }

  ns.mealsView = {
    mount(container) {
      containerRef = container;
      expandedCategoryIds = new Set();
      expandedIngredientsIds = new Set();
      currentSuperMonday = dateUtils.getMonday(new Date());
      render(container);
    },
    refresh() {
      if (containerRef) render(containerRef);
    },
  };
})(window.Agenda);
