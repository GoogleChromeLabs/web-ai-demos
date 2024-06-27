/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OW_API_KEY } from '../../env.js'
const OW_API_URL = 'https://api.openweathermap.org/data/2.5'

export type Location = {
    lat: number;
    lng: number;
}

export type WeatherResponse = {
    base: string;
    clouds: {
        all: number;
    },
    cod: number;
    message: string;
    coord: {
        lon: number;
        lat: number;
    },
    dt: number;
    id: number;
    main: {
        temp: number;
        feels_like: number;
        temp_min: number;
        temp_max: number;
        pressure: number;
        humidity: number;
    },
    name: string;
    sys: {
        type: number;
        id: number;
        country: string;
        sunrise: number;
        sunset: number;
    },
    timezone: number;
    visibility: number;
    weather: {
        id: number;
        main: string;
        description: string;
        icon: string;
    }[],
    wind: {
        speed: number;
        deg: number;
    },
}

export async function getWeatherForLocation(location: Location): Promise<WeatherResponse> {
    console.log(OW_API_KEY)
    let response = await fetch(
        `${OW_API_URL}/weather/?lat=${location!.lat}&lon=${location!.lng}&units=metric&appid=${OW_API_KEY}`);
    let responseData = await response.json();
    console.log(responseData);
    return responseData as WeatherResponse;
}

