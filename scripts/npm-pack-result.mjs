// npm <=11 returns an array; npm 12 returns an object keyed by package name.
export function parseSinglePackResult(stdout, expectedName) {
  const payload = JSON.parse(stdout);
  const results = Array.isArray(payload) ? payload
    : payload && typeof payload === 'object' ? Object.values(payload) : [];
  if (results.length !== 1 || results[0]?.name !== expectedName ||
      typeof results[0].filename !== 'string' || !Array.isArray(results[0].files)) {
    throw new Error('Expected one npm pack result with filename and files.');
  }
  return results[0];
}
