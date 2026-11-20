const controls = new Set([
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "KeyW",
  "KeyA",
  "KeyD",
  "KeyR",
  "Space",
  "KeyH",
]);

export function createInput(target: EventTarget) {
  const down = new Set<string>();
  const pressed = new Set<string>();

  function onKeyDown(event: Event) {
    if (!("code" in event) || typeof event.code !== "string") return;
    const field =
      typeof Element !== "undefined" && event.target instanceof Element
        ? event.target
        : null;

    if (
      field?.closest("input, textarea, select, button, a, [contenteditable]") ||
      !controls.has(event.code) ||
      ("ctrlKey" in event && event.ctrlKey === true) ||
      ("metaKey" in event && event.metaKey === true) ||
      ("altKey" in event && event.altKey === true)
    ) {
      return;
    }
    if (
      event.code.startsWith("Arrow") ||
      (event.code === "Space" && !field?.closest("button, a"))
    ) {
      event.preventDefault();
    }
    if (!("repeat" in event && event.repeat === true) && !down.has(event.code))
      pressed.add(event.code);
    down.add(event.code);
  }

  function onKeyUp(event: Event) {
    if ("code" in event && typeof event.code === "string")
      down.delete(event.code);
  }

  function onBlur() {
    down.clear();
    pressed.clear();
  }

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", onBlur);

  return {
    isDown: (code: string) => down.has(code),
    justPressed: (code: string) => pressed.delete(code),
    destroy() {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", onBlur);
      onBlur();
    },
  };
}
