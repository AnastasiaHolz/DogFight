function number(value: string | null, fallback: number, max: number) {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(max, parsed))
    : fallback;
}

export function readNetworkSettings(search: string) {
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

export type NetworkSettings = ReturnType<typeof readNetworkSettings>;

export function mountNetworkSettings(
  settings: NetworkSettings,
  form: HTMLElement,
  signal: AbortSignal,
) {
  for (const input of form.querySelectorAll("input")) {
    const name = input.name;
    if (name === "predict" || name === "drift") {
      input.checked = settings[name];
      input.addEventListener(
        "change",
        () => {
          settings[name] = input.checked;
        },
        { signal },
      );
    } else if (
      name === "latency" ||
      name === "jitter" ||
      name === "loss" ||
      name === "interpolation"
    ) {
      input.value = String(settings[name]);
      input.addEventListener(
        "change",
        () => {
          settings[name] = number(
            input.value,
            settings[name],
            Number(input.max),
          );
          input.value = String(settings[name]);
        },
        { signal },
      );
    }
  }
}
