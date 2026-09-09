/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Two tools the model can call, both on APIs that need no key and send CORS
 * headers, so the demo works from any origin without a proxy.
 *
 * They do a whole job per call on purpose. `get_weather` takes a place name
 * rather than coordinates, even though that costs it a geocoding request,
 * because a tool that answers half a question makes the model spend a round
 * stitching the halves together. Rounds are the budget worth saving.
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

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} from ${new URL(url).host}`);
  }
  return response.json();
}

export const tools = [
  {
    name: 'get_weather',
    description:
      'Get the current weather in a place. Give the place by name; it is ' +
      'looked up for you.',
    inputSchema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'A city or town, for example "Hamburg, Germany".',
        },
      },
      required: ['location'],
    },
    async execute({ location }) {
      const { results } = await fetchJson(
        'https://geocoding-api.open-meteo.com/v1/search?count=1&name=' +
          encodeURIComponent(location)
      );
      const place = results?.[0];
      if (!place) {
        // Thrown rather than returned as an empty result: the wrapper turns
        // this into a tool error the model can read and correct.
        throw new Error(`No place called ${location}.`);
      }
      const weather = await fetchJson(
        'https://api.open-meteo.com/v1/forecast' +
          `?latitude=${place.latitude}&longitude=${place.longitude}` +
          '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code'
      );
      const now = weather.current;
      return {
        place: [place.name, place.country].filter(Boolean).join(', '),
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
    async execute({ amount, from, to }) {
      const base = String(from).toUpperCase();
      const target = String(to).toUpperCase();
      const data = await fetchJson(
        `https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${target}`
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
