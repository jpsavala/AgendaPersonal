window.Agenda = window.Agenda || {};
(function (ns) {
  const { state, dateUtils } = ns;
  let currentMonday = dateUtils.getMonday(new Date());
  let containerRef = null;
  const MEAL_BLOCK_ID = "preparar_comida";
  const ADD_NEW_MEAL_VALUE = "__add_new__";
  let addingMealDate = null;
  let movingPendienteId = null;
  // Fecha (o null) para la que se acaba de tocar "Se repite" sin que el
  // día anterior tuviera comida elegida (ver buildComidaBlock) — mismo
  // criterio transitorio que addingMealDate, se limpia sola al elegir
  // una comida, al tocar "Cambiar" o al redibujar por cualquier otro motivo.
  let comidaRepeatWarningFor = null;
  // Última fecha (dateStr) de captura de paradas ya atendida: evita que
  // cada render vuelva a saltar a su semana si el usuario navegó a otra
  // semana a mano mientras la captura seguía activa (ver render(), y
  // js/app.js: startParadaCapture/getParadaCaptureSession). Se resetea
  // sola en cuanto la sesión de captura termina, para que una próxima
  // reactivación (incluso para la misma fecha) vuelva a saltar.
  let lastHandledCaptureDateStr = null;
  // Bandeja de entrada (captura rápida, ver js/quickCapture.js): arranca
  // cerrada cada vez que se carga la página (como addingMealDate/
  // movingPendienteId, estado puramente de esta sesión); "categoría"
  // elegida por ítem (trabajo/personal) antes de asignarlo, para poder
  // mostrar u ocultar el selector de bloque de oficina sin tener que
  // guardar nada todavía.
  let inboxExpanded = false;
  const inboxCategoryByItem = {};

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
          comidaRepeatWarningFor = null;
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
        comidaRepeatWarningFor = null;
        render(containerRef);
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

  // Bloque "preparar_comida" (14:00-15:00): mismo criterio que en la
  // Diaria (ver js/dailyView.js, buildComidaBlock) — pregunta "¿Se
  // repite la comida de ayer?" antes de mostrar el selector, mismo
  // dato (state.getComidaAnswer), así que queda igual en las dos vistas.
  function buildComidaBlock(dateStr, currentText) {
    const answer = state.getComidaAnswer(dateStr);
    const changeLink = el(
      "button",
      {
        class: "link-btn",
        onclick: () => {
          state.clearComidaAnswer(dateStr);
          comidaRepeatWarningFor = null;
          render(containerRef);
        },
      },
      "Cambiar"
    );

    if (!answer) {
      return el(
        "div",
        { class: "comida-pregunta" },
        el("p", null, "¿Se repite la comida de ayer?"),
        el(
          "div",
          { class: "gym-actions" },
          el(
            "button",
            {
              class: "btn-secondary",
              onclick: () => {
                const copied = state.repeatYesterdayComida(dateStr);
                comidaRepeatWarningFor = copied ? null : dateStr;
                render(containerRef);
              },
            },
            "Se repite"
          ),
          el(
            "button",
            {
              class: "btn-primary",
              onclick: () => {
                state.setComidaCocino(dateStr);
                render(containerRef);
              },
            },
            "Cocino"
          )
        )
      );
    }

    if (answer === "repite") {
      return el("div", { class: "comida-repite" }, el("p", { class: "schedule-readonly-text" }, currentText || ""), changeLink);
    }

    return el(
      "div",
      { class: "comida-cocino" },
      comidaRepeatWarningFor === dateStr ? el("p", { class: "muted comida-warning" }, "Ayer no hay comida registrada") : null,
      buildMealSelector(dateStr, currentText),
      changeLink
    );
  }

  // Bandeja de entrada: lo que se anotó con el botón flotante "+" (ver
  // js/quickCapture.js) y todavía no se asignó a trabajo/personal. Vive
  // DENTRO de "Pendientes de la semana" (discreta, colapsada, con
  // contador) y solo se muestra si hay algo sin asignar. Asignar un
  // ítem lo saca de acá y lo agrega a la lista de pendientes de la
  // semana que se esté mirando (mondayStr), con el mismo selector de
  // día(s) + bloque que ya usa "Trabajo".
  function buildInboxSection(container, mondayStr, officeBlockOptions) {
    const items = state.getInboxItems();
    if (!items.length) return null;

    const wrap = el("div", { class: "inbox-section" });
    wrap.appendChild(
      el(
        "button",
        {
          class: "inbox-toggle",
          onclick: () => {
            inboxExpanded = !inboxExpanded;
            render(container);
          },
        },
        `${inboxExpanded ? "▾" : "▸"} Bandeja de entrada (${items.length})`
      )
    );
    if (!inboxExpanded) return wrap;

    const list = el("div", { class: "check-list inbox-list" });
    items.forEach((item) => {
      const categoria = inboxCategoryByItem[item.id] || "trabajo";
      const dayCheckboxes = buildDayCheckboxGroup([]);
      const blockSelect =
        categoria === "trabajo"
          ? buildBlockSelect(officeBlockOptions, officeBlockOptions[0] && officeBlockOptions[0].value)
          : null;

      const categoryGroup = el(
        "div",
        { class: "toggle-group inbox-category-group" },
        el(
          "button",
          {
            class: "toggle-btn" + (categoria === "trabajo" ? " active" : ""),
            onclick: () => {
              inboxCategoryByItem[item.id] = "trabajo";
              render(container);
            },
          },
          "Trabajo"
        ),
        el(
          "button",
          {
            class: "toggle-btn" + (categoria === "personal" ? " active" : ""),
            onclick: () => {
              inboxCategoryByItem[item.id] = "personal";
              render(container);
            },
          },
          "Vida personal"
        )
      );

      const assign = () => {
        const selectedDays = Array.from(dayCheckboxes.querySelectorAll("input:checked")).map((cb) => cb.value);
        state.assignInboxItem(item.id, categoria, mondayStr, selectedDays, blockSelect ? blockSelect.value : undefined);
      };

      list.appendChild(
        el(
          "div",
          { class: "check-row inbox-row" },
          el("span", null, item.text),
          categoryGroup,
          dayCheckboxes,
          blockSelect,
          el("button", { class: "btn-primary", onclick: assign }, "Asignar"),
          el(
            "button",
            { class: "btn-remove", title: "Descartar", onclick: () => state.removeInboxItem(item.id) },
            "×"
          )
        )
      );
    });
    wrap.appendChild(list);
    return wrap;
  }

  // "Paradas del lunes 19: escribe cada una y agrégala" (ver nota de
  // captura en render()/pendientesCard).
  function formatCaptureDayLabel(dateStr) {
    const date = dateUtils.fromISO(dateStr);
    return `${dateUtils.DAY_LABELS_LONG[dateUtils.isoWeekday(date)].toLowerCase()} ${date.getDate()}`;
  }

  function render(container) {
    // Captura de paradas (ver js/app.js: startParadaCapture): si hay una
    // sesión activa y todavía no se saltó a su semana, se salta UNA
    // sola vez (lastHandledCaptureDateStr) — así el usuario queda libre
    // de navegar a otra semana con ◀/▶ sin que cada redibujado lo
    // regrese a la fuerza. captureActiveForThisWeek sí se recalcula en
    // cada render: controla la nota, el resaltado inicial, y que el
    // campo de agregar de "Trabajo" guarde paradas en vez de pendientes
    // de oficina, mientras la semana mostrada sea la de la captura.
    const captureSession = ns.app.getParadaCaptureSession ? ns.app.getParadaCaptureSession() : null;
    let justEnteredCapture = false;
    if (captureSession && captureSession.dateStr !== lastHandledCaptureDateStr) {
      currentMonday = dateUtils.fromISO(captureSession.mondayStr);
      lastHandledCaptureDateStr = captureSession.dateStr;
      justEnteredCapture = true;
    } else if (!captureSession) {
      lastHandledCaptureDateStr = null;
    }

    const mondayStr = dateUtils.toISO(currentMonday);
    const captureActiveForThisWeek = !!(captureSession && captureSession.mondayStr === mondayStr);
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
        onclick: () => { currentMonday = dateUtils.getMonday(new Date()); addingMealDate = null; movingPendienteId = null; comidaRepeatWarningFor = null; render(container); },
      }, "Esta semana"),
      // Un solo botón en esta posición: cambia de función según si la
      // semana que se está viendo tiene un respaldo de réplica pendiente
      // de deshacer (ver state.hasReplicateBackup), no dos botones
      // separados. El estilo "contorno" en el estado "Deshacer réplica"
      // es la única señal visual del cambio de función.
      state.hasReplicateBackup(mondayStr)
        ? el("button", {
            class: "btn-outline",
            onclick: () => {
              const confirmed = confirm(
                "Se restaurarán los bloques flexibles de esta semana al estado previo a la réplica. Cualquier cambio que hayas hecho después de replicar en esos bloques se perderá."
              );
              if (!confirmed) return;
              state.undoReplicateWeek(mondayStr);
            },
          }, "Deshacer réplica")
        : el("button", {
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
              if (block.runBadge) {
                dayCard.appendChild(el("p", { class: "run-badge" }, ns.runQueue.BADGE_LABELS[block.runBadge]));
              }
            }
            return;
          }
          // "¿Habrá paradas antes de la oficina?": con "No" no se
          // muestra nada de este bloque en absoluto (la oficina de abajo
          // ya viene con el horario corrido 09:00-14:00, ver más abajo).
          // Mismas Sí/No y misma lista de paradas (casilla nomás, igual
          // que los pendientes de oficina de acá abajo) que la Diaria;
          // agregar/editar/quitar paradas una por una queda solo en la
          // Diaria, igual que ya pasa con "Pendientes de la semana:
          // Trabajo" (acá solo se tilda, la lista completa se administra
          // aparte).
          if (block.id === "previo_oficina") {
            if (block.previoOficinaAnswer === "no") return;
            dayCard.appendChild(el("p", { class: "schedule-fixed-note" }, blockTitle));
            if (block.previoOficinaAnswer === "si") {
              state.getParadas(dateStrForDay).forEach((item) => {
                dayCard.appendChild(
                  el(
                    "label",
                    { class: "check-row" + (item.done ? " done" : "") },
                    el("input", {
                      type: "checkbox",
                      checked: item.done ? "checked" : null,
                      onchange: () => state.toggleParada(dateStrForDay, item.id),
                    }),
                    el("span", null, item.text)
                  )
                );
              });
            } else {
              dayCard.appendChild(el("p", { class: "muted previo-oficina-pregunta" }, "¿Habrá paradas antes de la oficina?"));
              dayCard.appendChild(
                el(
                  "div",
                  { class: "gym-actions" },
                  el(
                    "button",
                    { class: "btn-secondary", onclick: () => state.setPrevioOficinaAnswer(dateStrForDay, "no") },
                    "No"
                  ),
                  el(
                    "button",
                    {
                      class: "btn-primary",
                      onclick: () => {
                        state.setPrevioOficinaAnswer(dateStrForDay, "si");
                        ns.app.startParadaCapture(dateStrForDay);
                      },
                    },
                    "Sí"
                  )
                )
              );
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
          if (block.previoOficinaMerged) {
            dayCard.appendChild(
              el(
                "button",
                { class: "link-btn previo-oficina-change", onclick: () => state.clearPrevioOficinaAnswer(dateStrForDay) },
                "Cambiar: habrá paradas"
              )
            );
          }
          return;
        }
        dayCard.appendChild(el("label", { class: "field-label" }, blockTitle));
        if (block.id === MEAL_BLOCK_ID) {
          dayCard.appendChild(buildComidaBlock(dateStrForDay, block.text));
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

    // Pendientes de la semana
    const pendientesCard = el("div", { class: "card" }, el("h3", null, "Pendientes de la semana"));
    const inboxSection = buildInboxSection(container, mondayStr, officeBlockOptions);
    if (inboxSection) pendientesCard.appendChild(inboxSection);

    // "Trabajo": pendientesTrabajo de siempre + las paradas de esta
    // semana (ver state.getWeekParadas), etiquetadas "Parada" y con su
    // día para no confundirlas con pendientes de oficina reales (misma
    // casilla que el bloque de las 09:00, ver state.toggleParada: es el
    // mismo dato, se sincronizan solos). Mientras el modo de captura
    // (ver arriba, captureActiveForThisWeek) esté activo para esta
    // semana, la sección se resalta al entrar, muestra una nota, y el
    // campo de agregar guarda paradas en vez de pendientes de oficina
    // (sin selector de día/bloque: la parada ya tiene su fecha fija, la
    // de la sesión de captura).
    const trabajoSection = el(
      "div",
      { class: "trabajo-section" + (justEnteredCapture ? " parada-capture-highlight" : "") },
      el("h4", { class: "pendientes-subtitle" }, "Trabajo"),
      captureActiveForThisWeek
        ? el(
            "p",
            { class: "parada-capture-note" },
            `Paradas del ${formatCaptureDayLabel(captureSession.dateStr)}: escribe cada una y agrégala`
          )
        : null
    );
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
    state.getWeekParadas(mondayStr).forEach((item) => {
      const dayIdx = dateUtils.DAY_KEYS.indexOf(item.dayKeys[0]);
      trabajoList.appendChild(
        el(
          "div",
          { class: "check-row trabajo-row parada-row" + (item.done ? " done" : "") },
          el("input", {
            type: "checkbox",
            checked: item.done ? "checked" : null,
            onchange: () => state.toggleParadaInWeek(mondayStr, item.id),
          }),
          el("span", null, item.text),
          el("span", { class: "parada-tag" }, "Parada"),
          dayIdx === -1 ? null : el("span", { class: "parada-day-tag" }, dateUtils.DAY_LABELS_SHORT[dayIdx])
        )
      );
    });
    trabajoSection.appendChild(trabajoList);

    const newTrabajoInput = el("input", {
      type: "text",
      class: "add-input",
      placeholder: captureActiveForThisWeek ? "Nueva parada..." : "Nuevo pendiente de trabajo...",
    });
    const newTrabajoDayCheckboxes = captureActiveForThisWeek ? null : buildDayCheckboxGroup([]);
    const newTrabajoBlockSelect = captureActiveForThisWeek
      ? null
      : buildBlockSelect(officeBlockOptions, officeBlockOptions[0] && officeBlockOptions[0].value);
    const commitTrabajo = () => {
      if (!newTrabajoInput.value.trim()) return;
      if (captureActiveForThisWeek) {
        state.addParada(captureSession.dateStr, newTrabajoInput.value);
      } else {
        const selectedDays = Array.from(newTrabajoDayCheckboxes.querySelectorAll("input:checked")).map((cb) => cb.value);
        state.addWeekTrabajoPendiente(mondayStr, newTrabajoInput.value, selectedDays, newTrabajoBlockSelect.value);
      }
      newTrabajoInput.value = "";
      if (newTrabajoDayCheckboxes) newTrabajoDayCheckboxes.querySelectorAll("input").forEach((cb) => { cb.checked = false; });
      if (newTrabajoBlockSelect) newTrabajoBlockSelect.value = (officeBlockOptions[0] && officeBlockOptions[0].value) || "";
    };
    newTrabajoInput.addEventListener("keydown", (e) => { if (e.key === "Enter") commitTrabajo(); });
    trabajoSection.appendChild(
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
          el(
            "button",
            { class: "btn-primary", onclick: commitTrabajo },
            captureActiveForThisWeek ? "+ Agregar parada" : "+ Agregar pendiente"
          )
        )
      )
    );
    pendientesCard.appendChild(trabajoSection);

    // "Vida personal": mismo criterio que "Trabajo" pero sin bloque de
    // oficina (no aplica). Por ahora solo llegan acá pendientes
    // reasignados desde la semana anterior o asignados desde la Bandeja
    // de entrada (ver buildInboxSection) — sin ninguno todavía, se deja
    // el aviso de siempre en vez de una lista vacía.
    pendientesCard.appendChild(el("h4", { class: "pendientes-subtitle" }, "Vida personal"));
    const personalPendientes = state.getWeekPersonalPendientes(mondayStr);
    if (!personalPendientes.length) {
      pendientesCard.appendChild(el("p", { class: "muted" }, "Próximamente."));
    } else {
      const personalList = el("div", { class: "check-list" });
      personalPendientes.forEach((item) => {
        const dayCheckboxes = buildDayCheckboxGroup(item.dayKeys, (dk) =>
          state.toggleWeekPersonalPendienteDay(mondayStr, item.id, dk)
        );
        personalList.appendChild(
          el(
            "div",
            { class: "check-row" + (item.done ? " done" : "") },
            el("input", {
              type: "checkbox",
              checked: item.done ? "checked" : null,
              onchange: () => state.toggleWeekPersonalPendiente(mondayStr, item.id),
            }),
            el("span", null, item.text),
            dayCheckboxes,
            el("button", {
              class: "btn-remove",
              title: "Quitar pendiente",
              onclick: () => state.removeWeekPersonalPendiente(mondayStr, item.id),
            }, "×")
          )
        );
      });
      pendientesCard.appendChild(personalList);
    }

    container.append(
      ...[header, runBanner, daysGrid, metaCard, unfinishedCard, pendientesCard, habitsCard, revisionCard].filter(Boolean)
    );

    // Scroll + foco al campo de agregar mientras la captura de paradas
    // esté activa para esta semana: se repite en cada render (no solo
    // al entrar) para que, después de agregar una parada y que la lista
    // se redibuje, el foco quede listo para la siguiente — scrollIntoView
    // no hace nada si ya está visible, así que repetirlo es inofensivo.
    // requestAnimationFrame espera a que el DOM recién armado ya esté
    // en el documento (container.append de arriba) antes de medir/enfocar.
    if (captureActiveForThisWeek) {
      requestAnimationFrame(() => {
        const section = container.querySelector(".trabajo-section");
        if (section) section.scrollIntoView({ behavior: "smooth", block: "center" });
        const input = container.querySelector(".trabajo-add-row .add-input");
        if (input) input.focus({ preventScroll: true });
      });
    }
  }

  function go(delta) {
    currentMonday = dateUtils.addDays(currentMonday, delta * 7);
    addingMealDate = null;
    movingPendienteId = null;
    comidaRepeatWarningFor = null;
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
