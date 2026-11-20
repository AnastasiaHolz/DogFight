export function mountChatView(connection, root, signal) {
  const status = root.querySelector("#network-status");
  const roster = root.querySelector("#roster");
  const entries = root.querySelector("#chat-log");
  const form = root.querySelector("#chat-form");
  const input = form.elements.namedItem("message");
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
      if (entries.children.length > 60) entries.firstElementChild.remove();
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
