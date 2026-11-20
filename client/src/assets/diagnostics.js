const gallery = new Set(["404", "timeout", "abort", "json"]);

export function readDiagnostics(search) {
  const params = new URLSearchParams(search);
  const fault = params.get("fault");
  return {
    fault: gallery.has(fault) ? fault : null,
    benchmark: params.get("bench") === "1",
    sequential: params.get("load") === "sequential",
  };
}

export function diagnosticManifest(manifest, { fault, benchmark }) {
  return manifest.map((entry) => {
    if (entry.id === "ships") {
      if (fault === "404") return { ...entry, url: "/__lab03/missing-sprite" };
      if (fault === "timeout")
        return {
          ...entry,
          url: `${entry.url}?labDelay=timeout`,
          timeoutMs: 400,
        };
      if (fault === "abort")
        return { ...entry, url: `${entry.url}?labDelay=abort` };
    }
    if (entry.id === "arena" && fault === "json") {
      return { ...entry, url: "/__lab03/bad-json" };
    }
    if (benchmark) return { ...entry, url: `${entry.url}?labDelay=bench` };
    return entry;
  });
}
