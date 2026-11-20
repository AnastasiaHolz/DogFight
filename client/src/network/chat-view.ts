import { element } from "../dom.ts";
import type { RoomConnection } from "./connection.ts";
export function mountChatView(
  connection: RoomConnection,
  root: HTMLElement,
  signal: AbortSignal,
) {
  const status = element("#network-status", HTMLElement, root);
  const roster = element("#roster", HTMLElement, root);
  const entries = element("#chat-log", HTMLElement, root);
  const form = element("#chat-form", HTMLFormElement, root);
  const input = element("#chat-text", HTMLInputElement, form);
  entries.replaceChildren();
  roster.textContent = "Гравці: —";
  input.value = "";

  connection.addEventListener(
    "status",
    ({ detail }) => {
      status.textContent = detail;
    },
    { signal },
  );

  connection.addEventListener(
    "roster",
    ({ detail }) => {
      if (Array.isArray(detail.players)) {
        roster.textContent = `Гравці: ${detail.players.map((player) => player.name).join(", ")}`;
      }
    },
    { signal },
  );

  connection.addEventListener(
    "chat",
    ({ detail }) => {
      const item = document.createElement("li");
      item.textContent = `${detail.player?.name ?? "Пілот"}: ${detail.text}`;
      entries.append(item);
      if (entries.children.length > 60) entries.firstElementChild?.remove();
      entries.scrollTop = entries.scrollHeight;
    },
    { signal },
  );

  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      if (connection.send(input.value)) input.value = "";
      else
        status.textContent =
          "Повідомлення не додано. Перевірте текст або зачекайте з’єднання.";
    },
    { signal },
  );
}
