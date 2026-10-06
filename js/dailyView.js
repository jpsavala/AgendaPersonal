window.Agenda = window.Agenda || {};
(function (ns) {
  const { state, dateUtils } = ns;
  let currentDate = new Date();
  const MEAL_BLOCK_ID = "preparar_comida";
  const ADD_NEW_MEAL_VALUE = "__add_new__";
  let addingMeal = false;

  // ---------- Diaria de hoy: bloque en curso, colapso de lo ya pasado ----------
  // Todo esto solo aplica al día de HOY (ver isToday en render()); en
  // cualquier otra fecha los bloques se muestran como siempre.
  const NOW_TIMEZONE = "America/Hermosillo";
  // Qué bloques ya se tocó manualmente (expandir uno que estaba
  // colapsado porque ya pasó): dura mientras siga abierta la Diaria de
  // ESE día puntual — cambiar de fecha (go/date-picker/swipe) la limpia,
  // ver goToDate().
  let manuallyExpandedBlockIds = new Set();
  // Fecha (dateStr) a la que ya se hizo el scroll automático al bloque
  // en curso: evita repetirlo en cada actualización por minuto o cada
  // vez que se guarda algo (ver tickCurrentBlock()), solo pasa una vez
  // por apertura de ese día.
  let lastAutoScrolledDate = null;
  let tickTimer = null;
  // blockId -> { wrapper } de la última construcción de la línea de
  // tiempo: el "tick" de cada minuto actualiza clases sobre estos
  // elementos ya existentes en vez de reconstruir toda la vista (así no
  // pierde el foco de lo que se esté escribiendo, ni hace scroll).
  let blockElementsById = {};

  // Hora actual en America/Hermosillo, en minutos desde medianoche (sin
  // importar en qué huso horario esté el dispositivo).
  function nowMinutesInHermosillo() {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: NOW_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number((parts.find((p) => p.type === "hour") || {}).value);
    const minute = Number((parts.find((p) => p.type === "minute") || {}).value);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
    return hour * 60 + minute;
  }

  // Interpreta el texto de horario de un bloque ("09:00–10:00",
  // "06:00–07:15 / 07:30" del gimnasio, o un solo "14:00" puntual) como
  // {start, end} en minutos: toma el primer y el último horario que
  // aparezca en el texto. Un bloque con un solo horario (sin rango) usa
  // +60 min como ventana de referencia solo para esta clasificación
  // visual — no cambia el horario real mostrado en ningún lado.
  function parseBlockRange(timeStr) {
    if (!timeStr) return null;
    const matches = timeStr.match(/\d{1,2}:\d{2}/g);
    if (!matches || !matches.length) return null;
    const toMinutes = (hhmm) => {
      const [h, m] = hhmm.split(":").map(Number);
      return h * 60 + m;
    };
    const values = matches.map(toMinutes);
    const start = Math.min(...values);
    let end = Math.max(...values);
    if (end <= start) end = start + 60;
    return { start, end };
  }

  // Clasifica cada bloque del día (con horario definido) como "past"
  // (ya terminó), "current" (en curso ahora) o "future"; los que no
  // tienen horario (fin de semana, marcadores) quedan sin clasificar y
  // no participan del resaltado/colapso. highlightId es el bloque en
  // curso, o si no hay ninguno (hueco entre bloques), el próximo por
  // venir.
  function classifyTodayBlocks(blocks) {
    const nowMinutes = nowMinutesInHermosillo();
    const byId = {};
    let highlightId = null;
    let firstFutureId = null;
    if (nowMinutes !== null) {
      blocks.forEach((block) => {
        const range = parseBlockRange(block.time);
        if (!range) return;
        let blockState = "future";
        if (nowMinutes >= range.end) blockState = "past";
        else if (nowMinutes >= range.start) blockState = "current";
        byId[block.id] = blockState;
        if (blockState === "current" && highlightId === null) highlightId = block.id;
        if (blockState === "future" && firstFutureId === null) firstFutureId = block.id;
      });
      if (highlightId === null) highlightId = firstFutureId;
    }
    return { byId, highlightId };
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

  const OFFICE_BLOCK_IDS = ["oficina_manana", "tarde_oficina"];

  // Las opciones (qué bloques de oficina hay y a qué hora) se leen en
  // vivo del horario real de la cuenta (state.getOfficeBlockOptions),
  // no de una lista fija: una franja o dos, con sus horas propias.
  function buildOfficeBlockSelect(options, selectedValue) {
    const select = el("select", { class: "block-select" });
    options.forEach((opt) => {
      select.appendChild(el("option", { value: opt.value }, opt.label));
    });
    select.value = selectedValue || (options[0] && options[0].value) || "";
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
          manuallyExpandedBlockIds = new Set();
          renderWithTransition(container);
        },
      }),
      el("button", { class: "btn-icon", onclick: () => go(1) }, "▶"),
      el("button", {
        class: "btn-secondary",
        onclick: () => {
          currentDate = new Date();
          addingMeal = false;
          editingGymDate = null;
          manuallyExpandedBlockIds = new Set();
          renderWithTransition(container);
        },
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

    // Palabra del día: el español siempre se muestra; la segunda línea
    // usa el idioma que la cuenta haya elegido en Configuración (inglés
    // por defecto), nunca los dos a la vez.
    const word = state.getWordForDay(dateStr);
    const wordBox = el(
      "div",
      { class: "quote-box" },
      el("span", { class: "quote-label" }, "Palabra del día"),
      el("p", { class: "word-text" }, word.palabra),
      el("p", { class: "word-meaning-es" }, word.significadoEs),
      el("p", { class: "word-meaning-en" }, ns.wordLanguage.getTranslationLine(word))
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

    // Horario del día (bloques de duración variable). Solo el día de HOY
    // (hora local America/Hermosillo) resalta el bloque en curso y
    // colapsa los ya pasados — ver classifyTodayBlocks más arriba.
    const todayStr = dateUtils.toISO(new Date());
    const isToday = dateStr === todayStr;
    const dayBlocksList = state.getDayBlocks(dateStr);
    const { byId: todayStateById, highlightId } = isToday
      ? classifyTodayBlocks(dayBlocksList)
      : { byId: {}, highlightId: null };

    blockElementsById = {};
    const timeline = el("div", { class: "schedule" });
    dayBlocksList.forEach((block) => {
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
      // este bloque (ni la etiqueta ni una fila vacía). Ya es una sola
      // línea compacta de por sí, así que no se colapsa más — solo se
      // resalta si es el bloque en curso.
      if (block.id === "correr" && block.fixed) {
        if (!block.text) return;
        const isHighlighted = isToday && highlightId === block.id;
        const wrapper = el(
          "div",
          { class: "schedule-block run-block" + (isHighlighted ? " current" : "") },
          el(
            "div",
            { class: "schedule-block-head" },
            block.time ? el("span", { class: "schedule-time" }, block.time) : null,
            el("span", { class: "schedule-label" }, `🏃 ${block.text}`),
            el("input", {
              type: "checkbox",
              class: "schedule-check",
              checked: block.done ? "checked" : null,
              onchange: () => state.toggleBlockDone(dateStr, block.id),
            })
          )
        );
        blockElementsById[block.id] = wrapper;
        timeline.appendChild(wrapper);
        return;
      }

      const autoState = todayStateById[block.id]; // "past" | "current" | "future" | undefined
      const isCollapsible = isToday && autoState === "past";
      const isCollapsedNow = isCollapsible && !manuallyExpandedBlockIds.has(block.id);
      const isHighlighted = isToday && highlightId === block.id;

      // Un bloque de gimnasio colapsado no tiene la casilla normal (su
      // "¿Entrenaste hoy?"/"Hecho" vive en el cuerpo, que queda oculto):
      // este indicador chico en la cabecera reemplaza la palomita
      // mientras está colapsado, para no perder de vista si se cumplió.
      const collapsedGymIndicator =
        isCollapsedNow && block.id === "gimnasio"
          ? el("span", { class: "schedule-collapsed-check" }, block.done ? "✓" : "")
          : null;

      const head = el(
        "div",
        {
          class: "schedule-block-head",
          onclick: isCollapsible
            ? () => {
                if (manuallyExpandedBlockIds.has(block.id)) manuallyExpandedBlockIds.delete(block.id);
                else manuallyExpandedBlockIds.add(block.id);
                render(container);
              }
            : null,
        },
        block.time ? el("span", { class: "schedule-time" }, block.time) : null,
        el("span", { class: "schedule-label" }, block.label),
        collapsedGymIndicator,
        block.gymStatus
          ? null
          : el("input", {
              type: "checkbox",
              class: "schedule-check",
              checked: block.done ? "checked" : null,
              // Sin esto, tocar la casilla de un bloque colapsable
              // también dispararía el onclick de la cabecera (burbujea)
              // y lo expandiría/colapsaría de paso, además de marcar el
              // cumplido — un solo toque no debería hacer las dos cosas.
              onclick: (e) => e.stopPropagation(),
              onchange: () => state.toggleBlockDone(dateStr, block.id),
            }),
      );

      const body = el(
        "div",
        { class: "schedule-block-body" },
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
      );

      const wrapper = el(
        "div",
        {
          class:
            "schedule-block" +
            (block.highlight ? " highlight" : "") +
            (isHighlighted ? " current" : "") +
            (isCollapsible ? " collapsible" : "") +
            (isCollapsedNow ? " collapsed" : ""),
        },
        head,
        body
      );
      blockElementsById[block.id] = wrapper;
      timeline.appendChild(wrapper);
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
    const officeBlockOptions = state.getOfficeBlockOptions();
    const prioritiesSection = el("div", { class: "card" }, el("h3", null, "Prioridades del trabajo"));
    const prioritiesList = el("div", { class: "check-list" });
    state.getWorkPriorities(dateStr).forEach((p) => {
      const blockLabel = (officeBlockOptions.find((o) => o.value === p.blockId) || {}).label || "";
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
    const newPriorityBlockSelect = buildOfficeBlockSelect(officeBlockOptions, officeBlockOptions[0] && officeBlockOptions[0].value);
    const commitPriority = () => {
      if (newPriorityInput.value.trim()) {
        state.addOfficePendienteForDate(dateStr, newPriorityInput.value, newPriorityBlockSelect.value);
        newPriorityInput.value = "";
        newPriorityBlockSelect.value = (officeBlockOptions[0] && officeBlockOptions[0].value) || "";
      }
    };
    newPriorityInput.addEventListener("keydown", (e) => { if (e.key === "Enter") commitPriority(); });
    prioritiesSection.appendChild(
      el(
        "div",
        { class: "add-row" },
        newPriorityInput,
        // Selector + botón agrupados en un solo elemento flex: si los
        // tres no entran en una línea en pantallas angostas, este grupo
        // entero pasa a la línea siguiente (nunca se separan entre sí,
        // ni se cortan) en vez de desbordar el ancho de la tarjeta.
        el(
          "div",
          { class: "add-row-actions" },
          newPriorityBlockSelect,
          el("button", { class: "btn-primary", onclick: commitPriority }, "Agregar")
        )
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
        const isRunItem = item.key === "correr";

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
            { class: "check-row" + (item.done || gymDone ? " done" : "") + (isRunItem ? " run-row" : "") },
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
            el("span", null, isRunItem ? `🏃 ${item.text}` : item.text),
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

    // Contador + racha: siempre relativo a "hoy" (no a la fecha que se
    // esté viendo), para que sea un recordatorio constante del
    // compromiso, se mire el día que se mire. Para la cuenta dueña es su
    // carrera de siempre; para una cuenta de onboarding, su propia meta
    // genérica si configuró alguna (ver state.getMotivationBanner). null
    // = no mostrar nada.
    const banner = state.getMotivationBanner();
    const runBanner = banner
      ? el(
          "div",
          { class: "run-banner" },
          banner.countdownText ? el("span", { class: "run-banner-item" }, `🏁 ${banner.countdownText}`) : null,
          el("span", { class: "run-banner-item" }, `🔥 ${banner.streakText}`)
        )
      : null;

    const sections = [header, subtitle, eventsBanner, quoteBox, wordBox];
    if (!isWeekend) sections.push(cookToggle);
    sections.push(runBanner);
    sections.push(timeline);
    if (isWeekend) sections.push(weekendSection);
    sections.push(grid);

    container.append(...sections.filter(Boolean));

    setupCurrentBlockTicker(dateStr, isToday, highlightId);
  }

  // Arma (o apaga, si ya no es hoy) la actualización por minuto del
  // bloque en curso, y hace el scroll automático una sola vez por
  // apertura de este día — nunca desde el propio "tick" (ver
  // tickCurrentBlock), que no debe mover la pantalla ni reconstruir
  // nada mientras el usuario esté escribiendo.
  function setupCurrentBlockTicker(dateStr, isToday, highlightId) {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    if (!isToday) return;

    if (lastAutoScrolledDate !== dateStr) {
      lastAutoScrolledDate = dateStr;
      const target = highlightId && blockElementsById[highlightId];
      if (target) {
        requestAnimationFrame(() => {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    }

    tickTimer = setInterval(tickCurrentBlock, 60 * 1000);
  }

  // Actualización liviana por minuto: NO reconstruye la vista (eso
  // perdería el foco/cursor de lo que se esté escribiendo) — solo ajusta
  // clases sobre los elementos ya existentes. Nunca colapsa un bloque
  // que tenga un campo enfocado adentro; ese se revisa de nuevo en el
  // siguiente tick, una vez que se deje de escribir ahí.
  function tickCurrentBlock() {
    // Si los elementos que veníamos actualizando ya no están en el DOM
    // (se cambió de pestaña, o esta Diaria ya no está montada), no hay
    // nada que actualizar: apaga el intervalo acá mismo en vez de seguir
    // corriendo para siempre en segundo plano.
    const anyBlockEl = Object.values(blockElementsById)[0];
    if (!anyBlockEl || !containerRef || !containerRef.contains(anyBlockEl)) {
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      return;
    }
    const dateStr = dateUtils.toISO(currentDate);
    const todayStr = dateUtils.toISO(new Date());
    if (dateStr !== todayStr) return;
    const blocks = state.getDayBlocks(dateStr);
    const { byId, highlightId } = classifyTodayBlocks(blocks);
    blocks.forEach((block) => {
      const wrapper = blockElementsById[block.id];
      if (!wrapper) return;
      wrapper.classList.toggle("current", block.id === highlightId);
      if (byId[block.id] === "past" && !manuallyExpandedBlockIds.has(block.id)) {
        if (!wrapper.contains(document.activeElement)) {
          wrapper.classList.add("collapsed", "collapsible");
        }
      }
    });
  }

  // Igual que render(), pero además retrigerea la transición breve de
  // cambio de día (ver css/styles.css: #view-container.date-transition).
  // Solo se usa desde los puntos de entrada que cambian de FECHA
  // (flechas, "Hoy", selector, deslizar) — las demás acciones (marcar
  // una casilla, escribir, etc.) siguen llamando a render() directo,
  // sin este efecto.
  function renderWithTransition(container) {
    render(container);
    container.classList.remove("date-transition");
    void container.offsetWidth;
    container.classList.add("date-transition");
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
    manuallyExpandedBlockIds = new Set();
    if (containerRef) renderWithTransition(containerRef);
  }

  // ---------- Deslizar para cambiar de día ----------
  // Solo cuenta como "deslizar" un gesto claramente horizontal: una
  // distancia mínima y un ángulo mucho más horizontal que vertical (si
  // no, sería interferir con el scroll normal de la página). No se
  // activa si el toque arrancó sobre un control interactivo (campo de
  // texto, selector, checkbox, botón, día L-D): ahí el gesto es para
  // interactuar con ese control, no para cambiar de día.
  const SWIPE_MIN_DISTANCE = 60;
  const SWIPE_MAX_VERTICAL_RATIO = 0.55; // |dy| como máximo ~55% de |dx|
  let touchStartX = null;
  let touchStartY = null;
  let touchStartTarget = null;

  function isInteractiveTarget(target) {
    return !!(target && target.closest && target.closest("input, textarea, select, button, label, .day-chip"));
  }

  function attachSwipeHandlers(container) {
    container.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length !== 1) {
          touchStartX = null;
          return;
        }
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTarget = e.target;
      },
      { passive: true }
    );
    container.addEventListener(
      "touchend",
      (e) => {
        if (touchStartX === null) return;
        // El contenedor donde se engancha este listener es compartido
        // por TODAS las vistas (ver js/app.js: mountActive reutiliza el
        // mismo #view-container para cada pestaña) — sin este chequeo,
        // deslizar sobre la Semanal/Mensual/etc. también cambiaría la
        // fecha interna de la Diaria sin que se vea hasta volver a ella.
        const activeTabBtn = document.querySelector(".tab-button.active");
        if (!activeTabBtn || activeTabBtn.dataset.tab !== "diaria") {
          touchStartX = null;
          touchStartY = null;
          touchStartTarget = null;
          return;
        }
        const touch = e.changedTouches[0];
        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;
        const startTarget = touchStartTarget;
        touchStartX = null;
        touchStartY = null;
        touchStartTarget = null;
        if (isInteractiveTarget(startTarget)) return;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        if (absDx < SWIPE_MIN_DISTANCE) return;
        if (absDy > absDx * SWIPE_MAX_VERTICAL_RATIO) return;
        if (dx < 0) go(1);
        else go(-1);
      },
      { passive: true }
    );
  }

  ns.dailyView = {
    mount(container) {
      const isFirstMount = containerRef !== container;
      containerRef = container;
      render(container);
      if (isFirstMount) attachSwipeHandlers(container);
    },
    refresh() {
      if (containerRef) render(containerRef);
    },
  };
})(window.Agenda);
