#pragma once

#include <Arduino.h>

enum class ReadStatus : uint8_t {
  NotReady,
  Ok,
  Error
};
