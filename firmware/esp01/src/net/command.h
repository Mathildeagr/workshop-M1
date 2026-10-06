#pragma once

#include <Arduino.h>

class ICommandSink {
public:
  virtual ~ICommandSink() {}
  virtual void onCommand(const char *payload, size_t length) = 0;
};
