export function mountLobbyView(lobby, root, signal) {
  const form = root.querySelector("form");
  const name = form.elements.namedItem("pilot");
  const select = form.elements.namedItem("room");
  const join = form.querySelector('[type="submit"]');
  const refresh = root.querySelector("#room-refresh");
  const summary = root.querySelector("#room-summary");
  const status = root.querySelector("#rooms-status");
  let rooms = [];

  function describeSelectedRoom() {
    const room = rooms.find((item) => item.id === select.value);
    summary.textContent = room?.description ?? "";
    join.disabled = !room;
  }

  lobby.addEventListener(
    "roomsChanged",
    ({ detail }) => {
      const previous = select.value;
      rooms = detail;
      select.replaceChildren(
        ...rooms.map((room) => new Option(room.name, room.id)),
      );
      if (rooms.some((room) => room.id === previous)) select.value = previous;
      describeSelectedRoom();
      status.textContent = rooms.length
        ? `Доступно кімнат: ${rooms.length}. Оновлено ${new Date().toLocaleTimeString("uk-UA")}.`
        : "Наразі кімнат немає.";
    },
    { signal },
  );

  lobby.addEventListener(
    "roomsError",
    ({ detail }) => {
      status.textContent =
        detail.name === "TimeoutError"
          ? "Список кімнат не відповів вчасно. Оновлення повториться."
          : "Не вдалося оновити список кімнат. Оновлення повториться.";
    },
    { signal },
  );

  lobby.addEventListener(
    "joinError",
    ({ detail }) => {
      status.textContent = detail;
    },
    { signal },
  );

  select.addEventListener("change", describeSelectedRoom, { signal });
  refresh.addEventListener("click", () => void lobby.refresh(), { signal });
  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      lobby.join(select.value, name.value);
    },
    { signal },
  );
}
