/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import { useEffect, useState } from 'react';
import './App.css';
import { WeatherResponse, Location, getWeatherForLocation } from './lib/openweather';
import WeatherData from './components/WeatherData';
import BuiltinPrompting from './lib/prompting';
import { Alert, Box, Button, Card, CircularProgress, Collapse, Container, CssBaseline, Link, Snackbar } from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';

const defaultTheme = createTheme();

function App() {
  const [location, setLocation] = useState<Location>();
  const [weatherData, setWeatherData] = useState<WeatherResponse>();
  const [weatherApiError, setWeatherApierror] = useState<string>();
  const [weatherDescription, setWeatherDescription] = useState<string>();
  const [weatherDescriptionDone, setWeatherDescriptionDone] = useState<boolean>();
  const [snackbarOpen, setSnackbarOpen] = useState<boolean>(true);
  const [promptApiSupported, setPromptApiSupported] = useState<boolean>(true);

  // Checks if the Prompt API is supported.
  useEffect(() => {
    const supported = window.ai !== undefined && window.ai.assistant !== undefined;
    setPromptApiSupported(supported);
  }, []);

  // Get the user's location from the browser.
  useEffect(() => {
    navigator.geolocation.getCurrentPosition(position => {
      let location: Location = { lat: position.coords.latitude, lng: position.coords.longitude };
      setLocation(location);
    });
  }, []);

  // Fetch weather data for the user's location.
  useEffect(() => {
    if (location) {
      getWeatherForLocation(location)
        .then(setWeatherData)
        .catch(e => {
          console.error(e);
        });
    }
  }, [location]);


  // On weather data change, prompt to get a weather description.
  useEffect(() => {
    const handleWeatherData = async () => {
      if (promptApiSupported && weatherData && weatherData.cod === 200) {
        const prompt = `This is JSON data about the weather conditions now. \
                        ${JSON.stringify(weatherData)}. "clouds" is the percentage of the sky covered by clouds.\
                        The "sunrise" date is ${new Date(weatherData.sys.sunrise * 1000).toISOString()}, \
                        the "sunset" date is ${new Date(weatherData.sys.sunset * 1000).toISOString()},
                        and the current date is ${new Date(weatherData.dt * 1000)}. \
                        Action: Describe the weather conditions in one paragraph.
                        Rules: Be concise. Don't use bullet points.`;
        const urlParams = new URLSearchParams(window.location.search);
        const streaming = urlParams.get('streaming');

        try {
          const promptApi = await BuiltinPrompting.createPrompting();
          if (streaming === 'true') {
              const reader = await promptApi.streamingPrompt(prompt);
              for await (const chunk of reader) {
                setWeatherDescription(chunk);
              }
              setWeatherDescriptionDone(true);
          } else {
            const result = await promptApi.prompt(prompt)
            setWeatherDescription(result);
            setWeatherDescriptionDone(true);
          }
        } catch (e) {
          setWeatherApierror(`${e}`);
        }
      }
    };
    handleWeatherData();
  }, [weatherData, promptApiSupported]);

  function speakIt() {
    // let voice = window.speechSynthesis.getVoices().filter(v => v.default)[0];
    let utterThis = new SpeechSynthesisUtterance(weatherDescription);
    window.speechSynthesis.speak(utterThis);
  }

  return (
    <ThemeProvider theme={defaultTheme}>
      <Container component="main" maxWidth="xs">
      <CssBaseline />
      <Box
          sx={{
            marginTop: 2,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            width: '100%',
          }}
        >
      <Card sx={{
        padding: 2,
        paddingBottom: 8,
        width: '100%',
        minHeight: 400,
      }}>
        {weatherData
          ? <WeatherData weatherData={weatherData}></WeatherData>
          : <CircularProgress />
        }
        {weatherDescription
          && <>
              <Collapse in={weatherDescriptionDone}><Button variant="outlined" onClick={speakIt}>Read Weather Report</Button></Collapse>
              <p>{weatherDescription}</p>
            </>
        }
        {!promptApiSupported &&
          <Alert
            severity='error'
          >Your browser doesn't support the Prompt API. If you're on Chrome, join the <Link href=" https://developer.chrome.com/docs/ai/built-in#get_an_early_preview">Early Preview Program</Link> and enable it.</Alert>
        }
        {promptApiSupported &&
          <Alert
            severity='info'
          >Be the first to test new AI APIs. Your feedback is invaluable to our development process. Join our <Link href=" https://developer.chrome.com/docs/ai/built-in#get_an_early_preview">Early Preview Program</Link> today.</Alert>
        }
      </Card>
      </Box>
      {weatherApiError &&
          <Snackbar
            autoHideDuration={5000}
            open={snackbarOpen}
            onClose={() => setSnackbarOpen(false)}
            message={weatherApiError}
          />
      }

      </Container>
    </ThemeProvider>
  );
}

export default App;
