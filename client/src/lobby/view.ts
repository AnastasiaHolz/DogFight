import type { RoomInfo } from "@dogfight/shared/protocol";
import { element } from "../dom.ts";
import type { Lobby } from "./lobby.ts";

const arenaNames = {
  orbit: "Орбітальний полігон",
  nebula: "Туманність",
  debris: "Пояс уламків",
};

export function mountLobbyView(
  lobby: Lobby,
  root: HTMLElement,
  signal: AbortSignal,
) {
  const form = element("#join-form", HTMLFormElement, root);
  const create = element("#create-form", HTMLFormElement, root);
  const name = element("#pilot", HTMLInputElement, form);
  const select = element("#room", HTMLSelectElement, form);
  const join = element('[type="submit"]', HTMLButtonElement, form);
  const add = element('[type="submit"]', HTMLButtonElement, create);
  const refresh = element("#room-refresh", HTMLButtonElement, root);
  const summary = element("#room-summary", HTMLElement, root);
  const status = element("#rooms-status", HTMLElement, root);
  let rooms: RoomInfo[] = [];

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
        detail instanceof Error && detail.name === "TimeoutError"
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
        const room = element("#new-room", HTMLInputElement, create);
        const preset = element("#preset", HTMLSelectElement, create).value;
        if (preset === "orbit" || preset === "nebula" || preset === "debris") {
          await lobby.create(room.value, preset);
        }
      } finally {
        add.disabled = false;
      }
    },
    { signal },
  );
}
