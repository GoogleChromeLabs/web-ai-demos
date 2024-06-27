import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import {useEffect, useState} from 'react';
import './App.css';
import { WeatherResponse, Location, getWeatherForLocation } from './lib/openweather';
import WeatherData from './components/WeatherData';
import BuiltinPrompting from './lib/prompting';
import { Box, Button, Card, CircularProgress, Collapse, Container, CssBaseline, Link, Snackbar, Typography } from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';

const defaultTheme = createTheme();

function App() {
  const [location, setLocation] = useState<Location>();
  const [weatherData, setWeatherData] = useState<WeatherResponse>();
  const [weatherApiError, setWeatherApierror] = useState<string>();
  const [weatherDescription, setWeatherDescription] = useState<string>();
  const [weatherDescriptionDone, setWeatherDescriptionDone] = useState<boolean>();
  const [snackbarOpen, setSnackbarOpen] = useState<boolean>(true);

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
    if (weatherData && weatherData.cod === 200) {
      const prompt = `This is JSON data about the weather conditions now. \
                      ${JSON.stringify(weatherData)}. "clouds" is the percentage of the sky covered by clouds.\
                      The "sunrise" date is ${new Date(weatherData.sys.sunrise * 1000).toISOString()}, \
                      the "sunset" date is ${new Date(weatherData.sys.sunset * 1000).toISOString()},
                      and the current date is ${new Date(weatherData.dt * 1000)}. \
                      Action: generate 1 free flow paragraph of text for a reader about the weather conditions. \
                      Don't use bullet points. `;
      const urlParams = new URLSearchParams(window.location.search);
      const streaming = urlParams.get('streaming');

      if (streaming && streaming === 'true') {
        BuiltinPrompting.createPrompting()
          .then(async prompting => {
            let reader = prompting.streamingPrompt(prompt);

            async function handleNextChunk() {
                const { value, done } = await reader.read();
                if (done) {
                  setWeatherDescriptionDone(true);
                  return;
                }
                setWeatherDescription(value);
                handleNextChunk();
            }
            handleNextChunk();
          })
          .catch(error => {
            console.error(error);
            setWeatherApierror(error.message);
          });
      } else {
        BuiltinPrompting.createPrompting()
          .then(prompting => prompting.prompt(prompt))
          .then(result => {
            setWeatherDescription(result);
            setWeatherDescriptionDone(true);
          })
          .catch(error => setWeatherApierror(error.message))
      }
    }
  }, [weatherData]);

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
      </Card>
      </Box>
      <Typography variant="body2" color="text.secondary" align="center">
          Made with ✨ by <Link color="inherit" href="https://moma.corp.google.com/team/8155109853">Chrome DevRel</Link> / <Link color="inherit" href="https://moma.corp.google.com/person/andreban">@andreban</Link>.
      </Typography>
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
