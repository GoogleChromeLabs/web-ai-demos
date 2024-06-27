import { ArrowDownward, ArrowUpward, Thermostat, WaterDrop } from "@mui/icons-material";
import { WeatherResponse } from "../lib/openweather"
import WeatherIcon from "./WeatherIcon";
import { Box, Typography } from "@mui/material";

export default function WeatherData({weatherData}: {weatherData: WeatherResponse}) {
  if (weatherData.cod === 200) {
    return (      
      <div>
        <h1>{weatherData.name}</h1>        
        <WeatherIcon weather={weatherData.weather[0]}></WeatherIcon>
        <Box>
          <Typography component="h1" variant="h1"><Thermostat fontSize="large" />{weatherData.main.temp}°C</Typography>
        </Box>

        <h3>
          <span><WaterDrop />{weatherData.main.humidity}%</span>
          <span><ArrowUpward/>{weatherData.main.temp_max}°C</span>
          <span><ArrowDownward/>{weatherData.main.temp_min}°C</span>
        </h3>
      </div> 
    );
  } else {
    return (
      <div>
        {weatherData.cod} - {weatherData.message} 
      </div>
    )
  }
}
