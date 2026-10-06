#include "sensors/climate.h"
#include <math.h>

float climateDewPointC(float temperature_c, float humidity_pct) {
  if (isnan(temperature_c) || isnan(humidity_pct) || humidity_pct <= 0.0f) {
    return NAN;
  }
  const float a = 17.27f;
  const float b = 237.7f;
  const float g = (a * temperature_c) / (b + temperature_c) + logf(humidity_pct / 100.0f);
  return (b * g) / (a - g);
}
