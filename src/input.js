const controls = new Set([
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "KeyW",
  "KeyA",
  "KeyD",
  "KeyR",
]);

export function createInput(target) {
  const down = new Set();
  const pressed = new Set();

  function onKeyDown(event) {
    if (
      !controls.has(event.code) ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }
    if (event.code.startsWith("Arrow")) event.preventDefault();
    if (!event.repeat && !down.has(event.code)) pressed.add(event.code);
    down.add(event.code);
  }

  function onKeyUp(event) {
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
    isDown: (code) => down.has(code),
    justPressed: (code) => pressed.delete(code),
    destroy() {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", onBlur);
      onBlur();
    },
  };
}
