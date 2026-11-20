const arenaNames = {
  orbit: "Орбітальний полігон",
  nebula: "Туманність",
  debris: "Пояс уламків",
};

export function mountLobbyView(lobby, root, signal) {
  const form = root.querySelector("#join-form");
  const create = root.querySelector("#create-form");
  const name = form.elements.namedItem("pilot");
  const select = form.elements.namedItem("room");
  const join = form.querySelector('[type="submit"]');
  const add = create.querySelector('[type="submit"]');
  const refresh = root.querySelector("#room-refresh");
  const summary = root.querySelector("#room-summary");
  const status = root.querySelector("#rooms-status");
  let rooms = [];

  function describeSelectedRoom() {
    const room = rooms.find((item) => item.id === select.value);
    summary.textContent = room
      ? `${arenaNames[room.preset]} · гравці: ${room.players}/${room.maxPlayers}`
      : "";
    join.disabled = !room || room.players >= room.maxPlayers;
  }

  lobby.addEventListener(
    "roomsChanged",
    ({ detail }) => {
      const previous = select.value;
      rooms = detail;
      select.replaceChildren(
        ...rooms.map(
          (room) =>
            new Option(
              `${room.name} (${room.players}/${room.maxPlayers})`,
              room.id,
            ),
        ),
      );
      if (rooms.some((room) => room.id === previous)) select.value = previous;
      describeSelectedRoom();
      status.textContent = rooms.length
        ? `Кімнат: ${rooms.length}. Оновлено ${new Date().toLocaleTimeString("uk-UA")}.`
        : "Кімнат ще немає. Створіть першу.";
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

  lobby.addEventListener(
    "roomCreated",
    ({ detail }) => {
      select.value = detail.id;
      describeSelectedRoom();
      create.reset();
      status.textContent = `Кімнату «${detail.name}» створено.`;
      name.focus();
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
  create.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      add.disabled = true;
      try {
        await lobby.create(
          create.elements.namedItem("name").value,
          create.elements.namedItem("preset").value,
        );
      } finally {
        add.disabled = false;
      }
    },
    { signal },
  );
}
