window.Agenda = window.Agenda || {};
(function (ns) {
  const { state, dateUtils } = ns;
  let currentMonday = dateUtils.getMonday(new Date());
  let containerRef = null;
  const MEAL_BLOCK_ID = "preparar_comida";
  const ADD_NEW_MEAL_VALUE = "__add_new__";
  let addingMealDate = null;
  let movingPendienteId = null;

  const DAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"];

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

  // Las opciones (qué bloques de oficina hay y a qué hora) se leen en
  // vivo del horario real de la cuenta, no de una lista fija.
  function buildBlockSelect(options, selectedValue, onChange) {
    const select = el("select", { class: "block-select", onchange: onChange });
    options.forEach((opt) => {
      select.appendChild(el("option", { value: opt.value }, opt.label));
    });
    select.value = selectedValue || (options[0] && options[0].value) || "";
    return select;
  }

  // Grupo de casillas L-D para asignar un pendiente a uno o varios días.
  // Si onToggle se omite (formulario de "agregar"), las casillas solo
  // guardan su propio estado nativo, a leer al confirmar.
  function buildDayCheckboxGroup(selectedDayKeys, onToggle) {
    const wrap = el("div", { class: "day-checkbox-group" });
    dateUtils.DAY_KEYS.forEach((dk, i) => {
      const checkbox = el("input", {
        type: "checkbox",
        value: dk,
        checked: selectedDayKeys.includes(dk) ? "checked" : null,
        onchange: onToggle ? () => onToggle(dk) : null,
      });
      wrap.appendChild(el("label", { class: "day-chip", title: dateUtils.DAY_LABELS_LONG[i] }, checkbox, DAY_LETTERS[i]));
    });
    return wrap;
  }

  function buildMealSelector(dateStr, currentText) {
    if (addingMealDate === dateStr) {
      const input = el("input", { type: "text", class: "add-input", placeholder: "Nombre de la comida nueva..." });
      const commit = () => {
        if (input.value.trim()) {
          state.addMeal(input.value);
          state.setBlockText(dateStr, MEAL_BLOCK_ID, input.value.trim());
        }
        addingMealDate = null;
        render(containerRef);
      };
      const cancel = () => {
        addingMealDate = null;
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
          addingMealDate = dateStr;
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
        onclick: () => { currentMonday = dateUtils.getMonday(new Date()); addingMealDate = null; movingPendienteId = null; render(container); },
      }, "Esta semana"),
      el("button", {
        class: "btn-primary",
        onclick: () => {
          const infoConfirmed = confirm(
            "Se copiarán solo los bloques flexibles. Gimnasio, corrida, meta, pendientes, hábitos y revisión del viernes no se copian."
          );
          if (!infoConfirmed) return;
          if (state.weekHasAnyBlockText(mondayStr)) {
            const overwriteConfirmed = confirm("Esto va a reemplazar lo que ya tienes capturado en esta semana, ¿continuar?");
            if (!overwriteConfirmed) return;
          }
          state.replicatePreviousWeek(mondayStr);
        },
      }, "Replicar semana anterior")
    );

    // Contador + racha: siempre relativo a "hoy" (no a la semana que se
    // esté viendo), igual que en la Diaria (ver state.getMotivationBanner).
    const banner = state.getMotivationBanner();
    const runBanner = banner
      ? el(
          "div",
          { class: "run-banner" },
          banner.countdownText ? el("span", { class: "run-banner-item" }, `🏁 ${banner.countdownText}`) : null,
          el("span", { class: "run-banner-item" }, `🔥 ${banner.streakText}`)
        )
      : null;

    const daysGrid = el("div", { class: "week-days-grid" });
    days.forEach((date, i) => {
      const isWeekend = i >= 5;
      const dateStrForDay = dateUtils.toISO(date);
      const dayCard = el(
        "div",
        { class: "card week-day-card" + (isWeekend ? " weekend" : "") },
        el("h4", null, `${dateUtils.DAY_LABELS_LONG[i]} ${date.getDate()}`)
      );
      // Cumpleaños y eventos especiales de este día (vista Año / Mensual)
      state.getEvents(dateStrForDay).forEach((ev) => {
        dayCard.appendChild(el("p", { class: "event-banner-item compact" }, `🎉 ${ev.text}`));
      });
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
        const blockTitle = block.time ? `${block.time} — ${block.label}` : block.label;
        if (block.fixed) {
          // Corrida: una sola línea fusionada ("hora — Correr - 3km
          // lento"), sin la etiqueta genérica "Correr" aparte; los días
          // sin corrida programada no muestran nada de este bloque.
          if (block.id === "correr") {
            if (block.text) {
              dayCard.appendChild(el("p", { class: "run-note" }, `🏃 ${block.time} — ${block.text}`));
            }
            return;
          }
          dayCard.appendChild(el("p", { class: "schedule-fixed-note" }, blockTitle));
          if (block.text) {
            dayCard.appendChild(el("p", { class: "schedule-readonly-text" }, block.text));
          }
          state.getOfficePendientes(dateStrForDay, block.id).forEach((item) => {
            dayCard.appendChild(
              el(
                "label",
                { class: "check-row" + (item.done ? " done" : "") },
                el("input", {
                  type: "checkbox",
                  checked: item.done ? "checked" : null,
                  onchange: () => state.toggleWeekTrabajoPendiente(mondayStr, item.id),
                }),
                el("span", null, item.text)
              )
            );
          });
          return;
        }
        dayCard.appendChild(el("label", { class: "field-label" }, blockTitle));
        if (block.id === MEAL_BLOCK_ID) {
          dayCard.appendChild(buildMealSelector(dateStrForDay, block.text));
        } else {
          dayCard.appendChild(
            el("textarea", {
              class: "block-textarea",
              rows: "2",
              oninput: (e) => state.setBlockText(dateStrForDay, block.id, e.target.value),
            }, block.text)
          );
        }
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
        dateUtils.DAY_KEYS.forEach((dayKey, i) => {
          // Mismo dato que la casilla de la Diaria para esa fecha exacta
          // (ver state.toggleWeekHabit/isDayHabitDone): no es un estado
          // propio de esta tabla.
          const checked = state.isDayHabitDone(dateUtils.toISO(days[i]), habit.id);
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

    const officeBlockOptions = state.getOfficeBlockOptions();

    // Pendientes no cumplidos de la semana INMEDIATA anterior a la que se
    // esté mirando (se recalcula solo con la fecha, cada vez que se
    // cambia de semana). "Mover a esta semana" reasigna el mismo
    // pendiente (no lo duplica): lo saca de la semana vieja y lo agrega
    // acá con el día/bloque nuevos y la casilla sin marcar de nuevo.
    const { previousMonday, items: unfinishedItems } = state.getUnfinishedPendientesFromPreviousWeek(mondayStr);
    const unfinishedCard = el(
      "div",
      { class: "card" },
      el("h3", null, `Pendientes no cumplidos del ${dateUtils.formatShortRange(dateUtils.fromISO(previousMonday))}`)
    );
    if (unfinishedItems.length === 0) {
      unfinishedCard.appendChild(el("p", { class: "muted" }, "Cerraste la semana pasada sin pendientes sueltos."));
    } else {
      const unfinishedList = el("div", { class: "check-list" });
      unfinishedItems.forEach((item) => {
        if (movingPendienteId === item.id) {
          const moveDayCheckboxes = buildDayCheckboxGroup([]);
          const moveBlockSelect =
            item.listKey === "pendientesTrabajo"
              ? buildBlockSelect(officeBlockOptions, officeBlockOptions[0] && officeBlockOptions[0].value)
              : null;
          const confirmMove = () => {
            const selectedDays = Array.from(moveDayCheckboxes.querySelectorAll("input:checked")).map((cb) => cb.value);
            movingPendienteId = null;
            state.movePendienteToWeek(
              previousMonday,
              item.listKey,
              item.id,
              mondayStr,
              selectedDays,
              moveBlockSelect ? moveBlockSelect.value : undefined
            );
          };
          const cancelMove = () => {
            movingPendienteId = null;
            render(container);
          };
          unfinishedList.appendChild(
            el(
              "div",
              { class: "check-row unfinished-row moving" },
              el("span", null, item.text),
              moveDayCheckboxes,
              moveBlockSelect,
              el("button", { class: "btn-primary", onclick: confirmMove }, "Confirmar"),
              el("button", { class: "btn-secondary", onclick: cancelMove }, "Cancelar")
            )
          );
        } else {
          unfinishedList.appendChild(
            el(
              "div",
              { class: "check-row unfinished-row" },
              el("span", null, item.text),
              el(
                "button",
                {
                  class: "btn-secondary",
                  onclick: () => {
                    movingPendienteId = item.id;
                    render(container);
                  },
                },
                "Mover a esta semana"
              )
            )
          );
        }
      });
      unfinishedCard.appendChild(unfinishedList);
    }

    // Pendientes de la semana (Trabajo funcional; Vida personal, por ahora, solo en la interfaz)
    const pendientesCard = el("div", { class: "card" }, el("h3", null, "Pendientes de la semana"));

    pendientesCard.appendChild(el("h4", { class: "pendientes-subtitle" }, "Trabajo"));
    const trabajoList = el("div", { class: "check-list" });
    state.getWeekTrabajoPendientes(mondayStr).forEach((item) => {
      const dayCheckboxes = buildDayCheckboxGroup(item.dayKeys, (dk) =>
        state.toggleWeekTrabajoPendienteDay(mondayStr, item.id, dk)
      );

      const blockSelect = buildBlockSelect(officeBlockOptions, item.blockId, (e) =>
        state.setWeekTrabajoPendienteBlock(mondayStr, item.id, e.target.value)
      );

      trabajoList.appendChild(
        el(
          "div",
          { class: "check-row trabajo-row" + (item.done ? " done" : "") },
          el("input", {
            type: "checkbox",
            checked: item.done ? "checked" : null,
            onchange: () => state.toggleWeekTrabajoPendiente(mondayStr, item.id),
          }),
          el("span", null, item.text),
          dayCheckboxes,
          blockSelect,
          el("button", {
            class: "btn-remove",
            title: "Quitar pendiente",
            onclick: () => state.removeWeekTrabajoPendiente(mondayStr, item.id),
          }, "×")
        )
      );
    });
    pendientesCard.appendChild(trabajoList);

    const newTrabajoInput = el("input", { type: "text", class: "add-input", placeholder: "Nuevo pendiente de trabajo..." });
    const newTrabajoDayCheckboxes = buildDayCheckboxGroup([]);
    const newTrabajoBlockSelect = buildBlockSelect(officeBlockOptions, officeBlockOptions[0] && officeBlockOptions[0].value);
    const commitTrabajo = () => {
      if (newTrabajoInput.value.trim()) {
        const selectedDays = Array.from(newTrabajoDayCheckboxes.querySelectorAll("input:checked")).map((cb) => cb.value);
        state.addWeekTrabajoPendiente(mondayStr, newTrabajoInput.value, selectedDays, newTrabajoBlockSelect.value);
        newTrabajoInput.value = "";
        newTrabajoDayCheckboxes.querySelectorAll("input").forEach((cb) => { cb.checked = false; });
        newTrabajoBlockSelect.value = (officeBlockOptions[0] && officeBlockOptions[0].value) || "";
      }
    };
    newTrabajoInput.addEventListener("keydown", (e) => { if (e.key === "Enter") commitTrabajo(); });
    pendientesCard.appendChild(
      el(
        "div",
        { class: "add-row trabajo-add-row" },
        newTrabajoInput,
        newTrabajoDayCheckboxes,
        // Selector + botón agrupados: si no entran en la misma línea que
        // lo anterior, pasan juntos a la línea siguiente en vez de
        // desbordar (mismo criterio que en "Prioridades del trabajo" de
        // la vista Diaria).
        el(
          "div",
          { class: "add-row-actions" },
          newTrabajoBlockSelect,
          el("button", { class: "btn-primary", onclick: commitTrabajo }, "+ Agregar pendiente")
        )
      )
    );

    pendientesCard.appendChild(el("h4", { class: "pendientes-subtitle" }, "Vida personal"));
    pendientesCard.appendChild(el("p", { class: "muted" }, "Próximamente."));

    container.append(
      ...[header, runBanner, daysGrid, metaCard, unfinishedCard, pendientesCard, habitsCard, revisionCard].filter(Boolean)
    );
  }

  function go(delta) {
    currentMonday = dateUtils.addDays(currentMonday, delta * 7);
    addingMealDate = null;
    movingPendienteId = null;
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
