# Weather Demo App

This demo application uses the built-in Prompt API to generate a human readable description of the weather from structured weather data provided by the [OpenWeatherMap API][1].

## Requirements
 - Node.js v20 or above.

## Prepare to run the application
 - Run `npm install` to install dependencies.
 - Sign up for the [Chrome's Built-in AI Early Preview Program][2].
 - Setup Chrome to run API, as described in the program documentation.   
 - Get an [OpenWeatherMap API][1] key.
 - Edit `src/env.js` and add your key.

Note: The configuration steps to setup the browser to run the Prompt API are changing frequently as the API is under development. The best way to stay updated on the steps is [through the EPP][2].

## Run the application
 - `npm start` to run the application.

## Running as a docker container Docker

Build the image:
```
docker build -t weather-demo:latest .
```

Run the container:
```
docker run -d  -p 8080:80 weather-demo:latest
```

[1]: https://openweathermap.org/api
[2]: https://docs.google.com/forms/d/e/1FAIpQLSfZXeiwj9KO9jMctffHPym88ln12xNWCrVkMY_u06WfSTulQg/viewform
