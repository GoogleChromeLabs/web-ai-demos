/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Three tools the model can call, all on APIs that need no key and send CORS
 * headers, so the demo works from any origin without a proxy.
 *
 * `find_place` and `get_weather` are deliberately separate, even though one
 * tool taking a place name would answer the same question in a single round.
 * Splitting them is what makes the loop visible: the model has to look a city
 * up, read the coordinates out of the answer, and call again with them, so the
 * demo shows a chain rather than one lookup. In an app, prefer the tool that
 * does the whole job. Rounds cost a model turn and context each, and a chain
 * is where a small model gets lost.
 */

/**
 * Every `execute` takes the `AbortSignal` the prompting method was given as its
 * second argument, and hands it to `fetch()`, so Stop cancels the request that
 * is in flight rather than leaving it to finish unread. The default covers the
 * WebMCP path at the bottom of this file, which calls `execute` with the
 * arguments alone.
 */

/** Open-Meteo's weather codes, abridged to the ones worth naming. */
const CONDITIONS = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'freezing fog',
  51: 'light drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  80: 'rain showers',
  95: 'thunderstorm',
};

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`${response.status} from ${new URL(url).host}`);
  }
  return response.json();
}

export const tools = [
  {
    name: 'find_place',
    description:
      'Look up the coordinates of a city or town. Call this before ' +
      'get_weather, which needs coordinates rather than a name.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'A city or town, for example "Hamburg, Germany".',
        },
      },
      required: ['name'],
    },
    async execute({ name }, { signal } = {}) {
      const { results } = await fetchJson(
        'https://geocoding-api.open-meteo.com/v1/search?count=1&name=' +
          encodeURIComponent(name),
        signal
      );
      const place = results?.[0];
      if (!place) {
        // Thrown rather than returned as an empty result: the wrapper turns
        // this into a tool error the model can read and correct.
        throw new Error(`No place called ${name}.`);
      }
      return {
        place: [place.name, place.country].filter(Boolean).join(', '),
        latitude: place.latitude,
        longitude: place.longitude,
      };
    },
  },
  {
    name: 'get_weather',
    description:
      'Get the current weather at a set of coordinates, which find_place ' +
      'returns for a city name.',
    inputSchema: {
      type: 'object',
      properties: {
        latitude: { type: 'number', description: 'From find_place.' },
        longitude: { type: 'number', description: 'From find_place.' },
      },
      required: ['latitude', 'longitude'],
    },
    async execute({ latitude, longitude }, { signal } = {}) {
      const weather = await fetchJson(
        'https://api.open-meteo.com/v1/forecast' +
          `?latitude=${latitude}&longitude=${longitude}` +
          '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code',
        signal
      );
      const now = weather.current;
      return {
        temperatureC: now.temperature_2m,
        humidityPercent: now.relative_humidity_2m,
        windKmh: now.wind_speed_10m,
        conditions: CONDITIONS[now.weather_code],
      };
    },
  },
  {
    name: 'convert_currency',
    description: 'Convert an amount from one currency to another.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'How much to convert.' },
        from: { type: 'string', description: 'Currency code, e.g. "EUR".' },
        to: { type: 'string', description: 'Currency code, e.g. "JPY".' },
      },
      required: ['amount', 'from', 'to'],
    },
    async execute({ amount, from, to }, { signal } = {}) {
      const base = String(from).toUpperCase();
      const target = String(to).toUpperCase();
      const data = await fetchJson(
        `https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${target}`,
        signal
      );
      const rate = data.rates?.[target];
      if (rate === undefined) {
        throw new Error(`No rate for ${base} to ${target}.`);
      }
      return {
        amount: Number(amount),
        from: base,
        to: target,
        rate,
        converted: Number((Number(amount) * rate).toFixed(2)),
        rateDate: data.date,
      };
    },
  },
];

// Register the tools for WebMCP, if the browser supports it.
if ('modelContext' in document) {
  for (const tool of tools) {
    await document.modelContext.registerTool(tool);
  }
}
