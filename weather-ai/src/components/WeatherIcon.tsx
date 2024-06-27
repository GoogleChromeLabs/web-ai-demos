const OW_ICON_URL = 'https://openweathermap.org/img/wn'

export default function WeatherIcon({weather}: {weather: any}) {
  return (
    <img width="100" height="100" src={`${OW_ICON_URL}/${weather.icon}@2x.png`} alt={weather.description}/>
  );
}

  