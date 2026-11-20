function number(value, fallback, max) {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(max, parsed))
    : fallback;
}

export function readNetworkSettings(search) {
  const query = new URLSearchParams(search);
  return {
    binary: query.get("codec") !== "json",
    predict: query.get("predict") !== "0",
    drift: query.get("drift") === "1",
    latency: number(query.get("latency"), 0, 500),
    jitter: number(query.get("jitter"), 0, 150),
    loss: number(query.get("loss"), 0, 25),
    interpolation: number(query.get("interp"), 120, 350),
  };
}

export function mountNetworkSettings(settings, form, signal) {
  for (const input of form.querySelectorAll("input")) {
    if (input.type === "checkbox") input.checked = settings[input.name];
    else input.value = settings[input.name];
    input.addEventListener(
      "change",
      () => {
        settings[input.name] =
          input.type === "checkbox"
            ? input.checked
            : number(input.value, settings[input.name], Number(input.max));
        if (input.type !== "checkbox") input.value = settings[input.name];
      },
      { signal },
    );
  }
}
